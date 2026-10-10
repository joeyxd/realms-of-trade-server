-- Explicit adoption of a resource world with no legacy ground domain.
-- Apply after 001-022. Installing this migration adopts no world and enables no feature.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_ground_world_adoption(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE tick jsonb; other_id uuid;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id='00000000-0000-0000-0000-000000000000'::uuid OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>3 OR
     NOT (p_request ?& ARRAY['world','expectedWorldVersion','worldData']) OR
     NOT (p_request->'worldData' ? 'resources') THEN RETURN false; END IF;
  tick:=p_request->'worldData'->'resources'->'tick';
  other_id:=CASE WHEN p_operation_id='00000000-0000-0000-0000-000000000001'::uuid
    THEN '00000000-0000-0000-0000-000000000002'::uuid ELSE '00000000-0000-0000-0000-000000000001'::uuid END;
  RETURN public.mn_valid_ground_transaction_request(p_operation_id,
    p_request||pg_catalog.jsonb_build_object('family','checkpoint','operation','{}'::jsonb,
      'clock',pg_catalog.jsonb_build_object('operationId',other_id,'expectedVersion',1,'expectedTick',tick,'tick',tick))) IS TRUE;
EXCEPTION WHEN data_exception THEN RETURN false;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_ground_world_adoptions (
  world text PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.mn_ground_clock_operations(operation_id),
  request jsonb NOT NULL CHECK (public.mn_valid_ground_world_adoption(operation_id,request) IS TRUE),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (world=request->>'world'),
  CHECK (result=pg_catalog.jsonb_build_object('ok',true,'replay',false,
    'worldVersion',(request->>'expectedWorldVersion')::integer,
    'clock',pg_catalog.jsonb_build_object('world',world,'tick',(request->'worldData'->'resources'->>'tick')::bigint,
      'version',1,'operationId',operation_id)))
);
-- This is an internal call capability, not a caller-settable GUC or a process lease.
-- Its row exists only inside a bounded SECURITY DEFINER RPC and is deleted before return.
CREATE TABLE IF NOT EXISTS public.mn_ground_world_write_context (
  transaction_id bigint NOT NULL,
  world text NOT NULL,
  PRIMARY KEY (transaction_id,world)
);
ALTER TABLE public.mn_ground_world_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_ground_world_write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_ground_world_adoptions,public.mn_ground_world_write_context FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_ground_world_adoptions TO service_role;

CREATE OR REPLACE FUNCTION public.mn_guard_ground_world_adoption_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable ground world adoption' USING ERRCODE='MNP02'; END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_ground_world_adoption_immutable ON public.mn_ground_world_adoptions;
CREATE TRIGGER mn_ground_world_adoption_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.mn_ground_world_adoptions
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_world_adoption_receipt();

CREATE OR REPLACE FUNCTION public.mn_guard_adopted_ground_world()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE old_world text; new_world text; w text;
BEGIN
  -- A transaction whose repeatable snapshot predates adoption could otherwise miss the marker.
  -- All domain writers must see the committed marker at each command, including legacy worlds.
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'unsupported ground world isolation' USING ERRCODE='MNP02'; END IF;
  IF TG_TABLE_NAME='mn_pearl_intents' THEN
    IF TG_OP<>'INSERT' THEN old_world:=OLD.scope; END IF;
    IF TG_OP<>'DELETE' THEN new_world:=NEW.scope; END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN old_world:=OLD.world; END IF;
    IF TG_OP<>'DELETE' THEN new_world:=NEW.world; END IF;
  END IF;
  FOREACH w IN ARRAY ARRAY[old_world,new_world] LOOP
    IF w IS NOT NULL AND EXISTS(SELECT 1 FROM public.mn_ground_world_adoptions WHERE world=w) AND
       NOT EXISTS(SELECT 1 FROM public.mn_ground_world_write_context
         WHERE transaction_id=pg_catalog.txid_current() AND world=w) THEN
      RAISE EXCEPTION 'world requires common ground transaction' USING ERRCODE='MNP02';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;
DO $guards$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mn_worlds','mn_ground_clocks','mn_pearl_locations','mn_death_drops',
    'mn_death_drop_states','mn_pearl_intents'] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS mn_adopted_ground_world_guard ON public.%I',t);
    EXECUTE pg_catalog.format('CREATE TRIGGER mn_adopted_ground_world_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.mn_guard_adopted_ground_world()',t);
  END LOOP;
END
$guards$;

-- The common entrypoint is the only capability that can mutate an adopted world's domain.
DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_commit_ground_transaction_adoption_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_ground_transaction(uuid,jsonb) RENAME TO mn_commit_ground_transaction_adoption_base;
  END IF;
END
$rename$;
CREATE OR REPLACE FUNCTION public.mn_commit_ground_transaction(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE r jsonb; w text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR
     public.mn_valid_ground_transaction_request(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  w:=p_request->>'world';
  INSERT INTO public.mn_ground_world_write_context(transaction_id,world) VALUES(pg_catalog.txid_current(),w);
  r:=public.mn_commit_ground_transaction_adoption_base(p_operation_id,p_request);
  DELETE FROM public.mn_ground_world_write_context WHERE transaction_id=pg_catalog.txid_current() AND world=w;
  RETURN r;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_adopt_ground_world(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $function$
DECLARE a public.mn_ground_world_adoptions%ROWTYPE; wr public.mn_worlds%ROWTYPE;
  w text; tick bigint; r jsonb; cr jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR
     public.mn_valid_ground_world_adoption(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  w:=p_request->>'world'; tick:=(p_request->'worldData'->'resources'->>'tick')::bigint;
  -- Table barriers include direct legacy DML and in-flight calls which do not use common locks.
  -- Administrative adoption is bounded and must run with the old host stopped. A lock timeout
  -- or deadlock rolls this statement back; it never adopts a partial snapshot.
  LOCK TABLE public.mn_worlds,public.mn_ground_clocks,public.mn_pearl_locations,public.mn_death_drops,
    public.mn_death_drop_states,public.mn_pearl_intents,public.mn_ground_transaction_intents,
    public.mn_ground_transactions,public.mn_ground_world_adoptions IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO a FROM public.mn_ground_world_adoptions WHERE world=w OR operation_id=p_operation_id;
  IF FOUND THEN
    IF a.operation_id<>p_operation_id OR a.request IS DISTINCT FROM p_request THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN a.result||pg_catalog.jsonb_build_object('replay',true);
  END IF;
  SELECT * INTO wr FROM public.mn_worlds WHERE world=w FOR UPDATE;
  IF NOT FOUND OR wr.version<>(p_request->>'expectedWorldVersion')::integer OR wr.economy IS DISTINCT FROM p_request->'worldData' OR
     EXISTS(SELECT 1 FROM public.mn_ground_clocks WHERE world=w) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_locations WHERE world=w) OR
     EXISTS(SELECT 1 FROM public.mn_death_drops WHERE world=w) OR
     EXISTS(SELECT 1 FROM public.mn_death_drop_states WHERE world=w) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_intents WHERE scope=w AND state='pending') OR
     EXISTS(SELECT 1 FROM public.mn_ground_transaction_intents WHERE world=w) OR
     EXISTS(SELECT 1 FROM public.mn_ground_transactions WHERE request->>'world'=w) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  cr:=public.mn_commit_ground_clock(p_operation_id,pg_catalog.jsonb_build_object('world',w,
    'expectedVersion',0,'expectedTick',0,'tick',tick));
  IF cr->'ok' IS DISTINCT FROM 'true'::jsonb OR cr->'replay' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'initial ground clock was not created' USING ERRCODE='MNP02'; END IF;
  r:=pg_catalog.jsonb_build_object('ok',true,'replay',false,'worldVersion',wr.version,'clock',cr->'clock');
  INSERT INTO public.mn_ground_world_adoptions(world,operation_id,request,result) VALUES(w,p_operation_id,p_request,r);
  RETURN r;
EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  WHEN SQLSTATE 'MNP02' OR unique_violation OR data_exception THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_ground_world_adoption(p_world text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid ground adoption world' USING ERRCODE='MNP02'; END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('operationId',operation_id,'request',request,'result',result)
    FROM public.mn_ground_world_adoptions WHERE world=p_world);
END
$function$;
CREATE OR REPLACE FUNCTION public.mn_ground_world_adoption_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_ground_world_adoption(uuid,jsonb),public.mn_guard_ground_world_adoption_receipt(),
  public.mn_guard_adopted_ground_world(),public.mn_commit_ground_transaction_adoption_base(uuid,jsonb),
  public.mn_adopt_ground_world(uuid,jsonb),public.mn_load_ground_world_adoption(text),public.mn_ground_world_adoption_ready(),
  public.mn_commit_ground_transaction(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_adopt_ground_world(uuid,jsonb),public.mn_load_ground_world_adoption(text),
  public.mn_ground_world_adoption_ready(),public.mn_commit_ground_transaction(uuid,jsonb) TO service_role;
COMMIT;

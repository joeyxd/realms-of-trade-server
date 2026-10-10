-- Durable exact-envelope journal for world, clock, and gameplay transactions.
-- Extends SQL018 without changing its envelope or legacy RPC contract.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_ground_transaction_failure(p_result jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_typeof(p_result) = 'object' AND
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_result)) = 2 AND
    p_result ?& ARRAY['ok','why'] AND p_result->'ok' = 'false'::jsonb AND
    p_result->>'why' IN ('conflict','operation','ownership','kind')
$function$;

CREATE TABLE IF NOT EXISTS public.mn_ground_transaction_intents (
  operation_id uuid PRIMARY KEY,
  world text NOT NULL CHECK (world ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  request jsonb NOT NULL CHECK (public.mn_valid_ground_transaction_request(operation_id,request) IS TRUE),
  state text NOT NULL CHECK (state IN ('pending','committing','committed','conflict','rejected')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK ((state IN ('pending','committing') AND result IS NULL) OR
         (state = 'committed' AND public.mn_valid_ground_transaction_result(result) IS TRUE) OR
         (state IN ('conflict','rejected') AND public.mn_valid_ground_transaction_failure(result) IS TRUE))
);
CREATE UNIQUE INDEX IF NOT EXISTS mn_ground_transaction_intents_one_active_world
  ON public.mn_ground_transaction_intents(world) WHERE state IN ('pending','committing');
CREATE INDEX IF NOT EXISTS mn_ground_transaction_intents_world_page
  ON public.mn_ground_transaction_intents(world,operation_id);
ALTER TABLE public.mn_ground_transaction_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_ground_transaction_intents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_ground_transaction_intents TO service_role;

CREATE OR REPLACE FUNCTION public.mn_guard_ground_transaction_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_clock uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ground transaction intents are immutable' USING ERRCODE = 'MNP02'; END IF;
  v_clock := (NEW.request->'clock'->>'operationId')::uuid;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.result IS NOT NULL OR NEW.world IS DISTINCT FROM NEW.request->>'world' OR
       public.mn_valid_ground_transaction_request(NEW.operation_id,NEW.request) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'invalid ground transaction intent' USING ERRCODE = 'MNP02';
    END IF;
  ELSE
    IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.world IS DISTINCT FROM OLD.world OR
       NEW.request IS DISTINCT FROM OLD.request OR
       NOT ((OLD.state='pending' AND NEW.state='committing' AND NEW.result IS NULL) OR
            (OLD.state='committing' AND NEW.state='committed' AND
              public.mn_valid_ground_transaction_result(NEW.result) IS TRUE) OR
            (OLD.state='committing' AND NEW.state IN ('conflict','rejected') AND
              public.mn_valid_ground_transaction_failure(NEW.result) IS TRUE)) THEN
      RAISE EXCEPTION 'ground transaction intent transition mismatch' USING ERRCODE = 'MNP02';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_ground_transaction_intent_guard ON public.mn_ground_transaction_intents;
CREATE TRIGGER mn_ground_transaction_intent_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.mn_ground_transaction_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_transaction_intent();

-- Every legacy receipt family checks reserved outer and clock UUIDs in both directions.
-- During the wrapper's transaction, only the matching nested receipt is accepted.
CREATE OR REPLACE FUNCTION public.mn_guard_ground_transaction_reserved_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_intent public.mn_ground_transaction_intents%ROWTYPE; v_clock uuid; v_family text;
  v_nested jsonb; v_expected_clock jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));

  SELECT * INTO v_intent FROM public.mn_ground_transaction_intents
    WHERE operation_id=NEW.operation_id OR
      ((request->'clock'->>'tick')::bigint > (request->'clock'->>'expectedTick')::bigint AND
       (request->'clock'->>'operationId')::uuid=NEW.operation_id)
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_clock := (v_intent.request->'clock'->>'operationId')::uuid;

  IF TG_TABLE_NAME = 'mn_ground_transactions' AND NEW.operation_id=v_intent.operation_id THEN
    IF v_intent.state <> 'committing' OR NEW.request IS DISTINCT FROM v_intent.request THEN
      RAISE EXCEPTION 'ground transaction UUID reserved by intent' USING ERRCODE = 'MNP02';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'mn_ground_clock_operations' AND NEW.operation_id=v_clock THEN
    v_expected_clock := pg_catalog.jsonb_build_object('world',v_intent.world,
      'expectedVersion',(v_intent.request->'clock'->>'expectedVersion')::integer,
      'expectedTick',(v_intent.request->'clock'->>'expectedTick')::bigint,
      'tick',(v_intent.request->'clock'->>'tick')::bigint);
    IF v_intent.state <> 'committing' OR NEW.request IS DISTINCT FROM v_expected_clock THEN
      RAISE EXCEPTION 'ground clock UUID reserved by intent' USING ERRCODE = 'MNP02';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.operation_id=v_intent.operation_id THEN
    v_family := v_intent.request->>'family';
    v_nested := v_intent.request->'operation';
    IF v_family='ground' AND TG_TABLE_NAME='mn_pearl_operations' THEN
      IF v_intent.state <> 'committing' OR NEW.request IS DISTINCT FROM (v_nested - 'world' - 'ground') THEN
        RAISE EXCEPTION 'pearl child UUID reserved by ground transaction intent' USING ERRCODE = 'MNP02';
      END IF;
      RETURN NEW;
    END IF;
    IF v_intent.state <> 'committing' OR TG_TABLE_NAME <> (CASE v_family
      WHEN 'economic' THEN 'mn_economic_operations' WHEN 'ground' THEN 'mn_pearl_ground_operations'
      WHEN 'batch' THEN 'mn_pearl_batch_operations' WHEN 'death' THEN 'mn_death_operations'
      WHEN 'drop' THEN 'mn_death_drop_operations' ELSE '' END) OR NEW.request IS DISTINCT FROM v_nested THEN
      RAISE EXCEPTION 'operation UUID reserved by ground transaction intent' USING ERRCODE = 'MNP02';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'operation UUID collides with ground transaction intent' USING ERRCODE = 'MNP02';
END
$function$;

-- Add reserved-identity checks alongside SQL018's standalone collision guards.
DO $triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['mn_pearl_operations','mn_pearl_ground_operations','mn_pearl_batch_operations',
    'mn_death_operations','mn_death_drop_operations','mn_ground_clock_operations','mn_economic_operations',
    'mn_pearl_intents','mn_ground_transactions'] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS mn_ground_transaction_intent_identity ON public.%I',v_table);
    EXECUTE pg_catalog.format('CREATE TRIGGER mn_ground_transaction_intent_identity BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_transaction_reserved_identity()',v_table);
  END LOOP;
END
$triggers$;

-- Serialize reservation across both UUIDs in the same order used by SQL018's commit wrapper.
CREATE OR REPLACE FUNCTION public.mn_prepare_ground_transaction_intent(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_ground_transaction_intents%ROWTYPE; v_clock uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
     public.mn_valid_ground_transaction_request(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid ground transaction intent' USING ERRCODE = 'MNP02';
  END IF;
  v_clock := (p_request->'clock'->>'operationId')::uuid;
  IF p_operation_id::text < v_clock::text THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||v_clock::text,0));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||v_clock::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  END IF;
  SELECT * INTO v_row FROM public.mn_ground_transaction_intents WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'ground transaction intent mismatch' USING ERRCODE = 'MNP02'; END IF;
    RETURN pg_catalog.jsonb_build_object('operationId',v_row.operation_id,'request',v_row.request,'state',v_row.state,'result',v_row.result);
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_ground_transaction_intents WHERE operation_id IN (p_operation_id,v_clock) OR
      ((request->'clock'->>'tick')::bigint > (request->'clock'->>'expectedTick')::bigint AND
       (request->'clock'->>'operationId')::uuid=p_operation_id) OR
      ((p_request->'clock'->>'tick')::bigint > (p_request->'clock'->>'expectedTick')::bigint AND
       (request->'clock'->>'tick')::bigint > (request->'clock'->>'expectedTick')::bigint AND
       (request->'clock'->>'operationId')::uuid=v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_ground_transactions WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_economic_operations WHERE operation_id IN (p_operation_id,v_clock)) OR
     EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id IN (p_operation_id,v_clock)) OR
     (p_request->'clock'->>'tick')::bigint <> (p_request->'clock'->>'expectedTick')::bigint AND
       EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id IN (p_operation_id,v_clock)) THEN
    RAISE EXCEPTION 'ground transaction intent identity collision' USING ERRCODE = 'MNP02';
  END IF;
  -- At an unchanged tick the clock UUID intentionally names the existing checkpoint receipt.
  IF (p_request->'clock'->>'tick')::bigint = (p_request->'clock'->>'expectedTick')::bigint THEN
    IF NOT EXISTS (SELECT 1 FROM public.mn_ground_clocks c JOIN public.mn_ground_clock_operations o
        ON o.operation_id=c.operation_id WHERE c.world=p_request->>'world' AND c.operation_id=v_clock AND
          c.tick=(p_request->'clock'->>'tick')::bigint AND
          c.version=(p_request->'clock'->>'expectedVersion')::integer AND
          o.result->'clock'=pg_catalog.jsonb_build_object('world',p_request->>'world',
            'tick',(p_request->'clock'->>'tick')::bigint,
            'version',(p_request->'clock'->>'expectedVersion')::integer,'operationId',v_clock)) THEN
      RAISE EXCEPTION 'ground transaction clock receipt missing' USING ERRCODE = 'MNP02';
    END IF;
  END IF;
  -- Existing legacy journal identities and receipts are never adopted implicitly.
  IF EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) OR
     EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id IN (p_operation_id,v_clock)) THEN
    RAISE EXCEPTION 'ground transaction legacy identity collision' USING ERRCODE = 'MNP02';
  END IF;
  INSERT INTO public.mn_ground_transaction_intents(operation_id,world,request,state)
    VALUES(p_operation_id,p_request->>'world',p_request,'pending') RETURNING * INTO v_row;
  RETURN pg_catalog.jsonb_build_object('operationId',v_row.operation_id,'request',v_row.request,'state',v_row.state,'result',v_row.result);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_ground_transaction_intent(p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('operationId',operation_id,'request',request,'state',state,'result',result)
  FROM public.mn_ground_transaction_intents WHERE operation_id=p_operation_id
$function$;
CREATE OR REPLACE FUNCTION public.mn_list_ground_transaction_intents(p_world text,p_after_id uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'invalid ground transaction intent page' USING ERRCODE = 'MNP02';
  END IF;
  RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operationId',q.operation_id,
      'request',q.request,'state',q.state,'result',q.result) ORDER BY q.operation_id),'[]'::jsonb)
    FROM (SELECT operation_id,request,state,result FROM public.mn_ground_transaction_intents
      WHERE world=p_world AND state='pending' AND (p_after_id IS NULL OR operation_id>p_after_id)
      ORDER BY operation_id LIMIT p_limit) q);
END
$function$;

-- Preserve SQL018's implementation for the wrapper, but remove its service entry point.
DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_commit_ground_transaction_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_ground_transaction(uuid,jsonb) RENAME TO mn_commit_ground_transaction_base;
  END IF;
END
$rename$;
REVOKE ALL ON FUNCTION public.mn_commit_ground_transaction_base(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.mn_commit_ground_transaction(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_intent public.mn_ground_transaction_intents%ROWTYPE; v_result jsonb; v_state text; v_clock uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
     public.mn_valid_ground_transaction_request(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  v_clock := (p_request->'clock'->>'operationId')::uuid;
  IF p_operation_id::text < v_clock::text THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||v_clock::text,0));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||v_clock::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  END IF;
  SELECT * INTO v_intent FROM public.mn_ground_transaction_intents WHERE operation_id=p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.mn_ground_transaction_intents
        WHERE operation_id IN (p_operation_id,v_clock) OR
          ((request->'clock'->>'tick')::bigint > (request->'clock'->>'expectedTick')::bigint AND
           (request->'clock'->>'operationId')::uuid=p_operation_id) OR
          ((p_request->'clock'->>'tick')::bigint > (p_request->'clock'->>'expectedTick')::bigint AND
           (request->'clock'->>'tick')::bigint > (request->'clock'->>'expectedTick')::bigint AND
           (request->'clock'->>'operationId')::uuid=v_clock)) THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
    END IF;
    RETURN public.mn_commit_ground_transaction_base(p_operation_id,p_request);
  END IF;
  IF v_intent.request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  IF v_intent.state IN ('conflict','rejected') THEN RETURN v_intent.result; END IF;
  IF v_intent.state='committed' THEN
    v_result := public.mn_commit_ground_transaction_base(p_operation_id,p_request);
    IF v_result->'ok' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'committed ground transaction receipt missing' USING ERRCODE='MNP02'; END IF;
    RETURN v_intent.result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  UPDATE public.mn_ground_transaction_intents SET state='committing' WHERE operation_id=p_operation_id;
  v_result := public.mn_commit_ground_transaction_base(p_operation_id,p_request);
  IF v_result->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    v_state := CASE WHEN v_result->>'why'='conflict' THEN 'conflict' ELSE 'rejected' END;
    UPDATE public.mn_ground_transaction_intents SET state=v_state,result=v_result WHERE operation_id=p_operation_id;
    RETURN v_result;
  END IF;
  UPDATE public.mn_ground_transaction_intents SET state='committed',result=v_result WHERE operation_id=p_operation_id;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_ground_transaction_journal_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1)
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_ground_transaction_failure(jsonb),public.mn_guard_ground_transaction_intent(),
  public.mn_guard_ground_transaction_reserved_identity(),public.mn_prepare_ground_transaction_intent(uuid,jsonb),
  public.mn_load_ground_transaction_intent(uuid),public.mn_list_ground_transaction_intents(text,uuid,integer),
  public.mn_commit_ground_transaction(uuid,jsonb),public.mn_ground_transaction_journal_ready(),
  public.mn_commit_ground_transaction_base(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_valid_ground_transaction_failure(jsonb),public.mn_guard_ground_transaction_intent(),
  public.mn_guard_ground_transaction_reserved_identity(),public.mn_prepare_ground_transaction_intent(uuid,jsonb),
  public.mn_load_ground_transaction_intent(uuid),public.mn_list_ground_transaction_intents(text,uuid,integer),
  public.mn_commit_ground_transaction(uuid,jsonb),public.mn_ground_transaction_journal_ready(),
  public.mn_commit_ground_transaction_base(uuid,jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.mn_prepare_ground_transaction_intent(uuid,jsonb),
  public.mn_load_ground_transaction_intent(uuid),public.mn_list_ground_transaction_intents(text,uuid,integer),
  public.mn_commit_ground_transaction(uuid,jsonb),public.mn_ground_transaction_journal_ready() TO service_role;
COMMIT;

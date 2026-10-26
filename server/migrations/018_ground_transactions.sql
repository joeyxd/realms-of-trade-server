-- Couple an existing M5 world snapshot and ground clock to one gameplay receipt.
-- Storage only: callers still own simulation, eligibility, and detached candidate construction.
-- Apply after 001-017. SQL017 remains the separate agent owner-budget authority.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_ground_transaction_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_clock jsonb; v_world_data jsonb; v_operation jsonb; v_family text; v_world text;
  v_clock_id uuid; v_resource jsonb; v_valid_resources boolean; v_town text;
BEGIN
  -- Count the full request, including operation ACKs. JSONB text includes PostgreSQL canonical spacing,
  -- so callers should leave room below this 2 MiB persisted-size cap.
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.octet_length(p_request::text) > 2097152 OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     NOT (p_request ?& ARRAY['world','expectedWorldVersion','worldData','family','operation','clock']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 6 OR
     pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
     (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
     NOT public.mn_death_int(p_request->'expectedWorldVersion',1,2147483646) OR
     pg_catalog.jsonb_typeof(p_request->'worldData') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_request->'family') IS DISTINCT FROM 'string' OR
     p_request->>'family' NOT IN ('economic','ground','batch','death','drop','checkpoint') OR
     pg_catalog.jsonb_typeof(p_request->'operation') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_request->'clock') IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  v_world := p_request->>'world'; v_world_data := p_request->'worldData';
  v_operation := p_request->'operation'; v_clock := p_request->'clock'; v_family := p_request->>'family';
  IF NOT (v_world_data ?& ARRAY['v','seed','economy']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_world_data)) NOT BETWEEN 3 AND 5 OR
     (v_world_data - ARRAY['v','seed','economy','community','resources']::text[]) <> '{}'::jsonb OR
     NOT public.mn_death_int(v_world_data->'v',1,1) OR
     NOT public.mn_death_int(v_world_data->'seed',0,4294967295) OR
     pg_catalog.jsonb_typeof(v_world_data->'economy') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF v_world_data->'economy'->'v' IS DISTINCT FROM '2'::jsonb OR
     pg_catalog.jsonb_typeof(v_world_data->'economy'->'markets') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(v_world_data->'economy'->'plots') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_world_data->'economy'->'markets')) <> 6 OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_world_data->'economy'->'plots')) <> 6 OR
     NOT (v_world_data->'economy'->'markets' ?& ARRAY['aldea','cala','sol','ceniza','corona','coral']) OR
     NOT (v_world_data->'economy'->'plots' ?& ARRAY['aldea','cala','sol','ceniza','corona','coral']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_world_data->'economy'->'markets') AS k(key)
       WHERE key NOT IN ('aldea','cala','sol','ceniza','corona','coral')) <> 0 OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_world_data->'economy'->'plots') AS k(key)
       WHERE key NOT IN ('aldea','cala','sol','ceniza','corona','coral')) <> 0 THEN RETURN false; END IF;
  FOR v_town IN SELECT unnest(ARRAY['aldea','cala','sol','ceniza','corona','coral']) LOOP
    IF pg_catalog.jsonb_typeof(v_world_data->'economy'->'markets'->v_town) IS DISTINCT FROM 'object' OR
       v_world_data->'economy'->'markets'->v_town->>'id' IS DISTINCT FROM v_town OR
       pg_catalog.jsonb_typeof(v_world_data->'economy'->'markets'->v_town->'stock') IS DISTINCT FROM 'object' OR
       pg_catalog.jsonb_typeof(v_world_data->'economy'->'markets'->v_town->'last') IS DISTINCT FROM 'object' OR
       pg_catalog.jsonb_typeof(v_world_data->'economy'->'plots'->v_town) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  END LOOP;
  IF v_world_data ? 'community' AND pg_catalog.jsonb_typeof(v_world_data->'community') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF v_world_data ? 'resources' THEN
    v_resource := v_world_data->'resources';
    v_valid_resources := COALESCE(public.mn_valid_resource_state_v1(v_resource),false) OR
      COALESCE(public.mn_valid_resource_state(v_resource),false);
    IF NOT v_valid_resources OR (v_resource->>'tick')::numeric <> (v_clock->>'tick')::numeric THEN RETURN false; END IF;
  END IF;
  IF NOT (v_clock ?& ARRAY['operationId','expectedVersion','expectedTick','tick']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_clock)) <> 4 OR
     pg_catalog.jsonb_typeof(v_clock->'operationId') IS DISTINCT FROM 'string' OR
     (v_clock->>'operationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     (v_clock->>'operationId') = '00000000-0000-0000-0000-000000000000' OR
     NOT public.mn_death_int(v_clock->'expectedVersion',1,2147483646) OR
     NOT public.mn_death_int(v_clock->'expectedTick',0,9007199254740991) OR
     NOT public.mn_death_int(v_clock->'tick',0,9007199254740991) OR
     (v_clock->>'tick')::numeric < (v_clock->>'expectedTick')::numeric THEN RETURN false; END IF;
  v_clock_id := (v_clock->>'operationId')::uuid;
  IF v_clock_id = p_operation_id THEN RETURN false; END IF;

  IF v_family = 'checkpoint' THEN RETURN COALESCE(v_operation = '{}'::jsonb,false); END IF;
  IF v_family = 'economic' THEN
    RETURN COALESCE(v_operation->>'world' = v_world AND
      v_operation->>'expectedWorldVersion' = p_request->>'expectedWorldVersion' AND
      v_operation->'worldData' = v_world_data AND
      public.mn_valid_economic_request(p_operation_id,v_operation),false);
  END IF;
  RETURN COALESCE(v_operation->>'world' = v_world AND
    CASE v_family
      WHEN 'ground' THEN public.mn_valid_pearl_intent(v_world,'ground',v_operation)
      WHEN 'batch' THEN public.mn_valid_pearl_intent(v_world,'batch',v_operation)
      WHEN 'death' THEN public.mn_valid_pearl_intent(v_world,'death',v_operation)
      WHEN 'drop' THEN public.mn_valid_pearl_intent(v_world,'drop',v_operation) AND
        public.mn_death_int(v_operation->'at',0,9007199254740991) AND
        (v_operation->>'at')::numeric = (v_clock->>'tick')::numeric
      ELSE false
    END,false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_ground_transaction_result(p_result jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_count integer; v_clock_count integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.jsonb_object_keys(p_result);
  IF v_count <> 5 OR NOT (p_result ?& ARRAY['ok','replay','worldVersion','clock','effect']) OR
     p_result->'ok' IS DISTINCT FROM 'true'::jsonb OR p_result->'replay' IS DISTINCT FROM 'false'::jsonb OR
     NOT public.mn_death_int(p_result->'worldVersion',2,2147483647) OR
     pg_catalog.jsonb_typeof(p_result->'clock') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_result->'effect') IS DISTINCT FROM 'object' OR
     p_result->'effect'->'ok' IS DISTINCT FROM 'true'::jsonb OR
     p_result->'effect'->'replay' IS DISTINCT FROM 'false'::jsonb THEN RETURN false; END IF;
  SELECT pg_catalog.count(*) INTO v_clock_count FROM pg_catalog.jsonb_object_keys(p_result->'clock');
  RETURN v_clock_count = 4 AND (p_result->'clock' ?& ARRAY['world','tick','version','operationId']) AND
    pg_catalog.jsonb_typeof(p_result->'clock'->'world') IS NOT DISTINCT FROM 'string' AND
    public.mn_death_int(p_result->'clock'->'tick',0,9007199254740991) AND
    public.mn_death_int(p_result->'clock'->'version',1,2147483647) AND
    pg_catalog.jsonb_typeof(p_result->'clock'->'operationId') IS NOT DISTINCT FROM 'string';
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_ground_transactions (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (public.mn_valid_ground_transaction_request(operation_id,request) IS TRUE),
  result jsonb NOT NULL CHECK (public.mn_valid_ground_transaction_result(result) IS TRUE),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_ground_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_ground_transactions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_ground_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.mn_guard_ground_transaction_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'immutable ground transaction receipt' USING ERRCODE = 'MNP02'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF EXISTS (SELECT 1 FROM public.mn_ground_transactions WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'ground transaction receipt already exists' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_ground_transaction_receipt_guard ON public.mn_ground_transactions;
CREATE TRIGGER mn_ground_transaction_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mn_ground_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_transaction_receipt();

-- Legacy operation families can still be used directly. Once an ID belongs to a wrapper
-- transaction, reject a later raw operation in either namespace direction.
CREATE OR REPLACE FUNCTION public.mn_guard_no_ground_transaction_collision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF EXISTS (SELECT 1 FROM public.mn_ground_transactions WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'operation belongs to ground transaction' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DO $triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['mn_pearl_operations','mn_pearl_ground_operations','mn_pearl_batch_operations',
    'mn_death_operations','mn_death_drop_operations','mn_ground_clock_operations','mn_economic_operations','mn_pearl_intents'] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS mn_ground_transaction_collision ON public.%I',v_table);
    EXECUTE pg_catalog.format('CREATE TRIGGER mn_ground_transaction_collision BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.mn_guard_no_ground_transaction_collision()',v_table);
  END LOOP;
END
$triggers$;

CREATE OR REPLACE FUNCTION public.mn_load_ground_transaction(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid ground transaction ID' USING ERRCODE = 'MNP02'; END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('request',request,'result',result)
    FROM public.mn_ground_transactions WHERE operation_id = p_operation_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_ground_transactions_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_ground_transaction(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_request jsonb; v_result jsonb; v_world_row public.mn_worlds%ROWTYPE;
  v_clock_row public.mn_ground_clocks%ROWTYPE; v_clock_id uuid; v_world text;
  v_expected_world integer; v_world_version integer; v_tick bigint; v_expected_tick bigint; v_expected_clock integer;
  v_family text; v_operation jsonb; v_clock_request jsonb; v_clock_result jsonb;
  v_effect jsonb; v_saved jsonb; v_why text; v_clock_result_value jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
     p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     public.mn_valid_ground_transaction_request(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  v_world := p_request->>'world'; v_expected_world := (p_request->>'expectedWorldVersion')::integer;
  v_family := p_request->>'family'; v_operation := p_request->'operation';
  v_clock_id := (p_request->'clock'->>'operationId')::uuid;
  v_expected_clock := (p_request->'clock'->>'expectedVersion')::integer;
  v_expected_tick := (p_request->'clock'->>'expectedTick')::bigint;
  v_tick := (p_request->'clock'->>'tick')::bigint;

  -- Hold both receipt identities in stable UUID order before any world/profile/ledger lock.
  IF p_operation_id::text < v_clock_id::text THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || v_clock_id::text,0));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || v_clock_id::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
  END IF;

  SELECT request,result INTO v_request,v_result FROM public.mn_ground_transactions
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;

  -- A checkpoint has no family receipt to arbitrate its own ID, so reject every prior owner.
  IF v_family = 'checkpoint' AND (
    EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_economic_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id=p_operation_id)) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;

  -- This exception block is a PostgreSQL subtransaction: any later failure undoes clock,
  -- profile/pearl/drop, world and provisional receipt writes together.
  BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:' || v_world,0));
    SELECT * INTO v_world_row FROM public.mn_worlds WHERE world=v_world FOR UPDATE;
    IF NOT FOUND OR v_world_row.version <> v_expected_world OR
       v_world_row.economy->>'seed' IS DISTINCT FROM p_request->'worldData'->>'seed' THEN
      RAISE EXCEPTION 'world snapshot conflict' USING ERRCODE = 'MNC01';
    END IF;
    IF (v_world_row.economy - ARRAY['v','seed','economy','community','resources']::text[]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'world snapshot contains unsupported fields' USING ERRCODE = 'MNC01';
    END IF;
    -- Only the existing community operation may change its committed projection. SQL016 already
    -- protects resources; keep commerce/raft candidates from erasing unrelated community state.
    IF v_family = 'economic' AND v_operation->'command'->>'type' IS DISTINCT FROM 'community' AND
       v_world_row.economy ? 'community' AND
       v_world_row.economy->'community' IS DISTINCT FROM p_request->'worldData'->'community' THEN
      RAISE EXCEPTION 'economic candidate rewrites unrelated community state' USING ERRCODE = 'MNC01';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-ground-clock:' || v_world,0));
    SELECT * INTO v_clock_row FROM public.mn_ground_clocks WHERE world=v_world FOR UPDATE;
    IF NOT FOUND OR v_clock_row.version <> v_expected_clock OR v_clock_row.tick <> v_expected_tick THEN
      RAISE EXCEPTION 'ground clock conflict' USING ERRCODE = 'MNC01';
    END IF;
    IF v_world_row.economy ? 'resources' AND
       (v_world_row.economy->'resources'->>'tick')::numeric IS DISTINCT FROM v_clock_row.tick::numeric THEN
      RAISE EXCEPTION 'world resource tick differs from ground clock' USING ERRCODE = 'MNC01';
    END IF;
    IF v_tick = v_expected_tick THEN
      IF v_clock_row.operation_id <> v_clock_id THEN RAISE EXCEPTION 'clock identity conflict' USING ERRCODE = 'MNC01'; END IF;
      v_clock_result_value := pg_catalog.jsonb_build_object('world',v_world,'tick',v_clock_row.tick,
        'version',v_clock_row.version,'operationId',v_clock_row.operation_id);
    ELSE
      v_clock_request := pg_catalog.jsonb_build_object('world',v_world,'expectedVersion',v_expected_clock,
        'expectedTick',v_expected_tick,'tick',v_tick);
      v_clock_result := public.mn_commit_ground_clock(v_clock_id,v_clock_request);
      IF v_clock_result->'ok' IS DISTINCT FROM 'true'::jsonb OR v_clock_result->'replay' IS DISTINCT FROM 'false'::jsonb THEN
        v_why := v_clock_result->>'why';
        IF v_why='conflict' THEN RAISE EXCEPTION 'ground clock conflict' USING ERRCODE = 'MNC01'; END IF;
        IF v_why='ownership' THEN RAISE EXCEPTION 'ground clock ownership' USING ERRCODE = 'MNP01'; END IF;
        IF v_why='kind' THEN RAISE EXCEPTION 'ground clock kind' USING ERRCODE = 'MNK01'; END IF;
        RAISE EXCEPTION 'ground clock operation failed' USING ERRCODE = 'MNP02';
      END IF;
      v_clock_result_value := v_clock_result->'clock';
    END IF;

    IF v_family='economic' THEN
      v_effect := public.mn_commit_economic_operation(p_operation_id,v_operation);
    ELSIF v_family='ground' THEN
      v_effect := public.mn_commit_pearl_ground(p_operation_id,v_operation);
    ELSIF v_family='batch' THEN
      v_effect := public.mn_commit_pearl_batch(p_operation_id,v_operation);
    ELSIF v_family='death' THEN
      v_effect := public.mn_commit_death(p_operation_id,v_operation);
    ELSIF v_family='drop' THEN
      v_effect := public.mn_commit_death_drop(p_operation_id,v_operation);
    ELSE
      v_effect := pg_catalog.jsonb_build_object('ok',true,'replay',false);
    END IF;
    IF pg_catalog.jsonb_typeof(v_effect) IS DISTINCT FROM 'object' OR
       v_effect->'ok' IS DISTINCT FROM 'true'::jsonb OR v_effect->'replay' IS DISTINCT FROM 'false'::jsonb THEN
      v_why := v_effect->>'why';
      IF v_why='conflict' THEN RAISE EXCEPTION 'family conflict' USING ERRCODE = 'MNC01'; END IF;
      IF v_why='ownership' THEN RAISE EXCEPTION 'family ownership' USING ERRCODE = 'MNP01'; END IF;
      IF v_why='kind' THEN RAISE EXCEPTION 'family kind' USING ERRCODE = 'MNK01'; END IF;
      RAISE EXCEPTION 'family operation failed or replayed' USING ERRCODE = 'MNP02';
    END IF;

    IF v_family = 'economic' THEN
      IF NOT public.mn_death_int(v_effect->'worldVersion',v_expected_world+1,v_expected_world+1) THEN
        RAISE EXCEPTION 'economic world version mismatch' USING ERRCODE = 'MNP02';
      END IF;
      v_world_version := (v_effect->>'worldVersion')::integer;
    ELSE
      v_saved := public.mn_save_world(v_world,p_request->'worldData',v_expected_world);
      IF v_saved->'ok' IS DISTINCT FROM 'true'::jsonb OR
         (v_saved->>'version')::integer <> v_expected_world + 1 THEN
        v_why := v_saved->>'why';
        IF v_why='conflict' THEN RAISE EXCEPTION 'world snapshot conflict' USING ERRCODE = 'MNC01'; END IF;
        RAISE EXCEPTION 'world snapshot operation failed' USING ERRCODE = 'MNP02';
      END IF;
      v_world_version := (v_saved->>'version')::integer;
    END IF;

    v_result := pg_catalog.jsonb_build_object('ok',true,'replay',false,
      'worldVersion',v_world_version,'clock',v_clock_result_value,'effect',v_effect);
    INSERT INTO public.mn_ground_transactions(operation_id,request,result) VALUES(p_operation_id,p_request,v_result);
    RETURN v_result;
  EXCEPTION
    WHEN SQLSTATE 'MNC01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
    WHEN SQLSTATE 'MNP01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','ownership');
    WHEN SQLSTATE 'MNK01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','kind');
    WHEN undefined_function OR undefined_table THEN RAISE;
    WHEN OTHERS THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_ground_transaction_request(uuid,jsonb),
  public.mn_valid_ground_transaction_result(jsonb),
  public.mn_guard_ground_transaction_receipt(),public.mn_guard_no_ground_transaction_collision(),
  public.mn_load_ground_transaction(uuid),public.mn_ground_transactions_ready(),
  public.mn_commit_ground_transaction(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_valid_ground_transaction_request(uuid,jsonb),
  public.mn_valid_ground_transaction_result(jsonb),public.mn_guard_ground_transaction_receipt(),
  public.mn_guard_no_ground_transaction_collision() FROM service_role;
REVOKE ALL ON FUNCTION public.mn_load_ground_transaction(uuid),public.mn_ground_transactions_ready(),
  public.mn_commit_ground_transaction(uuid,jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.mn_load_ground_transaction(uuid),public.mn_ground_transactions_ready(),
  public.mn_commit_ground_transaction(uuid,jsonb) TO service_role;
COMMIT;

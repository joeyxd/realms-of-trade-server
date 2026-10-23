-- Ground admission for authored GM resource identities (the world editor's gmResources roster).
-- Additive: new functions and one journal/receipt table. SQL018/019/023/036 stay unchanged.
-- SQL018/019 cannot hold this kind (their CHECKs admit only the six existing families), and a
-- checkpoint cannot carry it (mn_save_world freezes the roster), so this is a separate family that
-- takes the same identity, world and clock locks inside one transaction.
-- Apply after 001-039. Installing it activates nothing: a host uses it only with groundTransactions
-- and a map with gmResources, after mn_ground_gm_resources_ready() reports version 1.
BEGIN;

-- Exact request: the Ground session's world version and clock pin plus the full appended roster.
CREATE OR REPLACE FUNCTION public.mn_valid_ground_gm_admission(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_clock jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id='00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length(p_request::text) > 2097152 OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 4 OR
     NOT (p_request ?& ARRAY['world','expectedWorldVersion','clock','resources']) OR
     pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
     (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
     NOT public.mn_death_int(p_request->'expectedWorldVersion',1,2147483646) OR
     pg_catalog.jsonb_typeof(p_request->'clock') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_request->'resources') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_clock:=p_request->'clock';
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_clock)) <> 3 OR
     NOT (v_clock ?& ARRAY['operationId','version','tick']) OR
     pg_catalog.jsonb_typeof(v_clock->'operationId') IS DISTINCT FROM 'string' OR
     (v_clock->>'operationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     (v_clock->>'operationId')='00000000-0000-0000-0000-000000000000' OR
     (v_clock->>'operationId')::uuid=p_operation_id OR
     NOT public.mn_death_int(v_clock->'version',1,2147483647) OR
     NOT public.mn_death_int(v_clock->'tick',0,9007199254740991) THEN RETURN false; END IF;
  -- The SQL024 validator (kept by SQL036) covers resource states v1, v2 and v3 with GM identities.
  RETURN COALESCE(public.mn_valid_resource_state(p_request->'resources'),false) AND
    (p_request->'resources'->>'tick')::numeric=(v_clock->>'tick')::numeric;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

-- A committed receipt echoes the unchanged clock pin; failures carry one closed reason.
CREATE OR REPLACE FUNCTION public.mn_valid_ground_gm_admission_result(p_request jsonb,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF p_result->'ok' = 'false'::jsonb THEN
    RETURN (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_result))=2 AND
      pg_catalog.jsonb_typeof(p_result->'why') = 'string' AND p_result->>'why' IN ('conflict','invalid','operation');
  END IF;
  RETURN (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_result))=4 AND
    p_result ?& ARRAY['ok','worldVersion','clock','added'] AND p_result->'ok' = 'true'::jsonb AND
    public.mn_death_int(p_result->'worldVersion',2,2147483647) AND
    (p_result->>'worldVersion')::integer=(p_request->>'expectedWorldVersion')::integer+1 AND
    p_result->'clock' = pg_catalog.jsonb_build_object('world',p_request->>'world',
      'tick',(p_request->'clock'->>'tick')::bigint,'version',(p_request->'clock'->>'version')::integer,
      'operationId',p_request->'clock'->>'operationId') AND
    public.mn_death_int(p_result->'added',1,128);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

-- One row is both the journal intent (pending, written before the commit RPC) and its receipt.
CREATE TABLE IF NOT EXISTS public.mn_ground_gm_admissions (
  operation_id uuid PRIMARY KEY,
  world text NOT NULL CHECK (world ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  request jsonb NOT NULL CHECK (public.mn_valid_ground_gm_admission(operation_id,request) IS TRUE),
  state text NOT NULL CHECK (state IN ('pending','committed','conflict','rejected')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (world = request->>'world'),
  CHECK ((state='pending' AND result IS NULL) OR
         (state='committed' AND result->'ok'='true'::jsonb AND
           public.mn_valid_ground_gm_admission_result(request,result) IS TRUE) OR
         (state='conflict' AND result->'ok'='false'::jsonb AND result->>'why'='conflict' AND
           public.mn_valid_ground_gm_admission_result(request,result) IS TRUE) OR
         (state='rejected' AND result->'ok'='false'::jsonb AND result->>'why' IN ('invalid','operation') AND
           public.mn_valid_ground_gm_admission_result(request,result) IS TRUE))
);
CREATE UNIQUE INDEX IF NOT EXISTS mn_ground_gm_admissions_one_pending_world
  ON public.mn_ground_gm_admissions(world) WHERE state='pending';
ALTER TABLE public.mn_ground_gm_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_ground_gm_admissions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_ground_gm_admissions TO service_role;

CREATE OR REPLACE FUNCTION public.mn_guard_ground_gm_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ground GM admissions are immutable' USING ERRCODE = 'MNP02'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.result IS NOT NULL THEN
      RAISE EXCEPTION 'invalid ground GM admission intent' USING ERRCODE = 'MNP02';
    END IF;
  ELSIF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.world IS DISTINCT FROM OLD.world OR
        NEW.request IS DISTINCT FROM OLD.request OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RAISE EXCEPTION 'ground GM admission transition mismatch' USING ERRCODE = 'MNP02';
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_ground_gm_admission_guard ON public.mn_ground_gm_admissions;
CREATE TRIGGER mn_ground_gm_admission_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mn_ground_gm_admissions
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_gm_admission();

-- Journal first: the host records the exact request before it dispatches the commit.
CREATE OR REPLACE FUNCTION public.mn_prepare_ground_gm_admission(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_ground_gm_admissions%ROWTYPE;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     public.mn_valid_ground_gm_admission(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid ground GM admission intent' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  SELECT * INTO v_row FROM public.mn_ground_gm_admissions WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.request IS DISTINCT FROM p_request THEN
      RAISE EXCEPTION 'ground GM admission intent mismatch' USING ERRCODE = 'MNP02';
    END IF;
  ELSE
    -- One identity namespace with the common Ground receipts, journal and clock.
    IF EXISTS (SELECT 1 FROM public.mn_ground_transactions WHERE operation_id=p_operation_id) OR
       EXISTS (SELECT 1 FROM public.mn_ground_transaction_intents WHERE operation_id=p_operation_id) OR
       EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) THEN
      RAISE EXCEPTION 'ground GM admission identity collision' USING ERRCODE = 'MNP02';
    END IF;
    BEGIN
      INSERT INTO public.mn_ground_gm_admissions(operation_id,world,request,state)
        VALUES(p_operation_id,p_request->>'world',p_request,'pending') RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'another ground GM admission is pending for this world' USING ERRCODE = 'MNP02';
    END;
  END IF;
  RETURN pg_catalog.jsonb_build_object('operationId',v_row.operation_id,'request',v_row.request,
    'state',v_row.state,'result',v_row.result);
END
$function$;

-- The intent a stopped host left before its commit; resolved before any new admission.
CREATE OR REPLACE FUNCTION public.mn_pending_ground_gm_admission(p_world text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid ground GM admission world' USING ERRCODE = 'MNP02';
  END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('operationId',operation_id,'request',request,'state',state,'result',result)
    FROM public.mn_ground_gm_admissions WHERE world=p_world AND state='pending');
END
$function$;

-- One transaction under the SQL018 family commit's locks: identity, world row, clock row.
-- SQL036 mn_admit_gm_resources enforces the append-only roster inside it; SQL023's write context
-- lets that write reach an adopted world for this transaction only.
CREATE OR REPLACE FUNCTION public.mn_commit_ground_gm_admission(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_row public.mn_ground_gm_admissions%ROWTYPE; v_world_row public.mn_worlds%ROWTYPE;
  v_clock_row public.mn_ground_clocks%ROWTYPE; v_world text; v_expected integer; v_clock uuid;
  v_old jsonb; v_admitted jsonb; v_added integer; v_result jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     public.mn_valid_ground_gm_admission(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  v_world := p_request->>'world'; v_expected := (p_request->>'expectedWorldVersion')::integer;
  v_clock := (p_request->'clock'->>'operationId')::uuid;
  -- Hold both identities in the stable UUID order of mn_commit_ground_transaction.
  IF p_operation_id::text < v_clock::text THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||v_clock::text,0));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||v_clock::text,0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  END IF;
  SELECT * INTO v_row FROM public.mn_ground_gm_admissions WHERE operation_id=p_operation_id FOR UPDATE;
  -- No admission without its durable intent, and one exact request per ID.
  IF NOT FOUND OR v_row.request IS DISTINCT FROM p_request THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  -- A decided ID answers with its stored receipt, byte-for-byte, and writes nothing.
  IF v_row.state <> 'pending' THEN RETURN v_row.result; END IF;

  -- Subtransaction: a failure undoes the world write and the write context together.
  BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||v_world,0));
    SELECT * INTO v_world_row FROM public.mn_worlds WHERE world=v_world FOR UPDATE;
    IF NOT FOUND OR v_world_row.version <> v_expected THEN
      RAISE EXCEPTION 'world snapshot conflict' USING ERRCODE = 'MNC01';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-ground-clock:'||v_world,0));
    SELECT * INTO v_clock_row FROM public.mn_ground_clocks WHERE world=v_world FOR UPDATE;
    IF NOT FOUND OR v_clock_row.version <> (p_request->'clock'->>'version')::integer OR
       v_clock_row.tick <> (p_request->'clock'->>'tick')::bigint OR v_clock_row.operation_id <> v_clock THEN
      RAISE EXCEPTION 'ground clock conflict' USING ERRCODE = 'MNC01';
    END IF;
    v_old := v_world_row.economy->'resources';
    IF pg_catalog.jsonb_typeof(v_old) IS DISTINCT FROM 'object' OR
       (v_old->>'tick')::numeric IS DISTINCT FROM v_clock_row.tick::numeric THEN
      RAISE EXCEPTION 'world resource tick differs from ground clock' USING ERRCODE = 'MNC01';
    END IF;
    v_added := pg_catalog.jsonb_array_length(p_request->'resources'->'nodes') -
      pg_catalog.jsonb_array_length(v_old->'nodes');
    IF v_added < 1 THEN RAISE EXCEPTION 'nothing to admit' USING ERRCODE = 'MNI01'; END IF;
    INSERT INTO public.mn_ground_world_write_context(transaction_id,world) VALUES(pg_catalog.txid_current(),v_world);
    v_admitted := public.mn_admit_gm_resources(v_world,v_expected,p_request->'resources');
    DELETE FROM public.mn_ground_world_write_context
      WHERE transaction_id=pg_catalog.txid_current() AND world=v_world;
    IF v_admitted IS DISTINCT FROM pg_catalog.jsonb_build_object('ok',true,'version',v_expected+1) THEN
      RAISE EXCEPTION 'GM roster append rejected' USING ERRCODE = 'MNI01';
    END IF;
    v_result := pg_catalog.jsonb_build_object('ok',true,'worldVersion',v_expected+1,
      'clock',pg_catalog.jsonb_build_object('world',v_world,'tick',v_clock_row.tick,
        'version',v_clock_row.version,'operationId',v_clock_row.operation_id),
      'added',v_added);
    UPDATE public.mn_ground_gm_admissions SET state='committed',result=v_result WHERE operation_id=p_operation_id;
    RETURN v_result;
  EXCEPTION
    WHEN SQLSTATE 'MNC01' THEN v_result := pg_catalog.jsonb_build_object('ok',false,'why','conflict');
    WHEN SQLSTATE 'MNI01' THEN v_result := pg_catalog.jsonb_build_object('ok',false,'why','invalid');
    WHEN undefined_function OR undefined_table THEN RAISE;
    WHEN OTHERS THEN v_result := pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END;
  -- A terminal failure resolves the intent; the world, clock and roster are untouched.
  UPDATE public.mn_ground_gm_admissions SET result=v_result,
    state=CASE WHEN v_result->>'why'='conflict' THEN 'conflict' ELSE 'rejected' END
    WHERE operation_id=p_operation_id;
  RETURN v_result;
END
$function$;

-- Version 1 only when the installed contract matches: dependencies, DEFINER/search_path,
-- service-only grants, private helpers, receipt table RLS/grants and its guard trigger.
CREATE OR REPLACE FUNCTION public.mn_ground_gm_resources_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_name text; v_proc record; v_source text; v_rls boolean;
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_admit_gm_resources(text,integer,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_gm_resource_roster_ready()') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_commit_ground_transaction(uuid,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_valid_ground_gm_admission(uuid,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_valid_ground_gm_admission_result(jsonb,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_guard_ground_gm_admission()') IS NULL OR
     pg_catalog.to_regclass('public.mn_ground_world_write_context') IS NULL OR
     pg_catalog.to_regclass('public.mn_ground_gm_admissions') IS NULL OR
     public.mn_gm_resource_roster_ready() IS DISTINCT FROM pg_catalog.jsonb_build_object('version',1) THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  FOREACH v_name IN ARRAY ARRAY['public.mn_prepare_ground_gm_admission(uuid,jsonb)',
      'public.mn_commit_ground_gm_admission(uuid,jsonb)','public.mn_pending_ground_gm_admission(text)'] LOOP
    IF pg_catalog.to_regprocedure(v_name) IS NULL THEN RETURN pg_catalog.jsonb_build_object('version',0); END IF;
    SELECT prosecdef,proconfig INTO v_proc FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(v_name);
    IF NOT COALESCE(v_proc.prosecdef,false) OR NOT COALESCE(v_proc.proconfig @> ARRAY['search_path=""'],false) OR
       NOT has_function_privilege('service_role',v_name,'EXECUTE') OR
       has_function_privilege('anon',v_name,'EXECUTE') OR has_function_privilege('authenticated',v_name,'EXECUTE') THEN
      RETURN pg_catalog.jsonb_build_object('version',0);
    END IF;
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY['public.mn_valid_ground_gm_admission(uuid,jsonb)',
      'public.mn_valid_ground_gm_admission_result(jsonb,jsonb)','public.mn_guard_ground_gm_admission()'] LOOP
    IF has_function_privilege('service_role',v_name,'EXECUTE') OR has_function_privilege('anon',v_name,'EXECUTE') OR
       has_function_privilege('authenticated',v_name,'EXECUTE') THEN
      RETURN pg_catalog.jsonb_build_object('version',0);
    END IF;
  END LOOP;
  SELECT pg_catalog.pg_get_functiondef('public.mn_commit_ground_gm_admission(uuid,jsonb)'::pg_catalog.regprocedure)
    INTO v_source;
  SELECT relrowsecurity INTO v_rls FROM pg_catalog.pg_class WHERE oid='public.mn_ground_gm_admissions'::pg_catalog.regclass;
  IF position('mn_admit_gm_resources' in v_source)=0 OR position('mn_ground_world_write_context' in v_source)=0 OR
     NOT COALESCE(v_rls,false) OR
     NOT has_table_privilege('service_role','public.mn_ground_gm_admissions','SELECT') OR
     has_table_privilege('service_role','public.mn_ground_gm_admissions','INSERT') OR
     has_table_privilege('service_role','public.mn_ground_gm_admissions','UPDATE') OR
     has_table_privilege('service_role','public.mn_ground_gm_admissions','DELETE') OR
     has_table_privilege('anon','public.mn_ground_gm_admissions','SELECT') OR
     has_table_privilege('authenticated','public.mn_ground_gm_admissions','SELECT') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.mn_ground_gm_admissions'::pg_catalog.regclass
       AND tgname='mn_ground_gm_admission_guard' AND tgenabled <> 'D') THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_ground_gm_admission(uuid,jsonb),
  public.mn_valid_ground_gm_admission_result(jsonb,jsonb),public.mn_guard_ground_gm_admission()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mn_prepare_ground_gm_admission(uuid,jsonb),public.mn_commit_ground_gm_admission(uuid,jsonb),
  public.mn_pending_ground_gm_admission(text),public.mn_ground_gm_resources_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_prepare_ground_gm_admission(uuid,jsonb),public.mn_commit_ground_gm_admission(uuid,jsonb),
  public.mn_pending_ground_gm_admission(text),public.mn_ground_gm_resources_ready() TO service_role;
COMMIT;

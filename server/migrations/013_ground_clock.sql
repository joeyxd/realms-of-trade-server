-- Exact ground-clock checkpoints and immutable receipts. Apply after 001-012.
-- Storage only: no clock source/offline policy, host activation, backfill, tick mapping or lease.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_ground_clock_request(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT (p_request ?& ARRAY['world','expectedVersion','expectedTick','tick']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 4 OR
    pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
    (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    NOT public.mn_death_int(p_request->'expectedVersion',0,2147483646) OR
    NOT public.mn_death_int(p_request->'expectedTick',0,9007199254740991) OR
    NOT public.mn_death_int(p_request->'tick',0,9007199254740991) THEN RETURN false; END IF;
  RETURN CASE WHEN (p_request->>'expectedVersion')::integer = 0 THEN (p_request->>'expectedTick')::bigint = 0
    ELSE (p_request->>'tick')::bigint > (p_request->>'expectedTick')::bigint END;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_ground_clock_result(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('ok',true,'replay',false,'clock',pg_catalog.jsonb_build_object(
    'world',p_request->>'world','tick',(p_request->>'tick')::bigint,
    'version',(p_request->>'expectedVersion')::integer + 1,'operationId',p_operation_id));
$function$;

CREATE TABLE IF NOT EXISTS public.mn_ground_clock_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (public.mn_valid_ground_clock_request(request)),
  result jsonb NOT NULL CHECK (result = public.mn_ground_clock_result(operation_id,request)),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS public.mn_ground_clocks (
  world text PRIMARY KEY CHECK (world ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  tick bigint NOT NULL CHECK (tick BETWEEN 0 AND 9007199254740991),
  version integer NOT NULL CHECK (version > 0),
  operation_id uuid NOT NULL REFERENCES public.mn_ground_clock_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_ground_clock_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_ground_clocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_ground_clock_operations, public.mn_ground_clocks FROM PUBLIC, anon, authenticated, service_role;
-- Writes are confined to the bounded definer RPC below. Service callers may inspect recovery evidence.
GRANT SELECT ON TABLE public.mn_ground_clock_operations, public.mn_ground_clocks TO service_role;

-- The operation UUID is shared with gameplay and journal families, in both directions.
CREATE OR REPLACE FUNCTION public.mn_guard_ground_clock_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported ground clock isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF TG_TABLE_NAME = 'mn_ground_clock_operations' THEN
    IF TG_OP <> 'INSERT' OR EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'ground clock operation identity mismatch' USING ERRCODE = 'MNP02';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'operation belongs to ground clock' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_ground_clock_operations;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_ground_clock_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_pearl_operations;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_pearl_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_pearl_ground_operations;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_pearl_ground_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_pearl_batch_operations;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_pearl_batch_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_death_operations;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_death_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_death_drop_operations;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_death_drop_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();
DROP TRIGGER IF EXISTS mn_ground_clock_family ON public.mn_pearl_intents;
CREATE TRIGGER mn_ground_clock_family BEFORE INSERT OR UPDATE ON public.mn_pearl_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_ground_clock_family();

CREATE OR REPLACE FUNCTION public.mn_load_ground_clock(p_world text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid ground clock world' USING ERRCODE = 'MNP02';
  END IF;
  SELECT pg_catalog.jsonb_build_object('world',world,'tick',tick,'version',version,'operationId',operation_id)
    INTO v_result FROM public.mn_ground_clocks WHERE world = p_world;
  RETURN v_result;
END
$function$;
CREATE OR REPLACE FUNCTION public.mn_load_ground_clock_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid ground clock operation' USING ERRCODE = 'MNP02'; END IF;
  SELECT pg_catalog.jsonb_build_object('request',request,'result',result) INTO v_result
    FROM public.mn_ground_clock_operations WHERE operation_id = p_operation_id;
  RETURN v_result;
END
$function$;

-- Only this service-only, fully schema-qualified RPC can write the new tables. No wall clock is
-- consulted; a trusted future clock authority must supply a monotonic checkpoint and exact baseline.
CREATE OR REPLACE FUNCTION public.mn_commit_ground_clock(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_current public.mn_ground_clocks%ROWTYPE;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    NOT public.mn_valid_ground_clock_request(p_request) THEN
    RAISE EXCEPTION 'invalid ground clock operation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_ground_clock_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'ground clock replay mismatch' USING ERRCODE = 'MNP02'; END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = p_operation_id) THEN
    RAISE EXCEPTION 'ground clock UUID collision' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-ground-clock:' || (p_request->>'world'),0));
  SELECT * INTO v_current FROM public.mn_ground_clocks WHERE world = p_request->>'world' FOR UPDATE;
  IF COALESCE(v_current.version,0) <> (p_request->>'expectedVersion')::integer OR
    COALESCE(v_current.tick,0) <> (p_request->>'expectedTick')::bigint THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  v_result := public.mn_ground_clock_result(p_operation_id,p_request);
  INSERT INTO public.mn_ground_clocks(world,tick,version,operation_id)
    VALUES (p_request->>'world',(p_request->>'tick')::bigint,(p_request->>'expectedVersion')::integer + 1,p_operation_id)
    ON CONFLICT (world) DO UPDATE SET tick = EXCLUDED.tick,version = EXCLUDED.version,
      operation_id = EXCLUDED.operation_id,updated_at = pg_catalog.now();
  INSERT INTO public.mn_ground_clock_operations(operation_id,request,result) VALUES (p_operation_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_ground_clock_request(jsonb),public.mn_ground_clock_result(uuid,jsonb),
  public.mn_guard_ground_clock_family(),public.mn_load_ground_clock(text),public.mn_load_ground_clock_operation(uuid),
  public.mn_commit_ground_clock(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_ground_clock_request(jsonb),public.mn_ground_clock_result(uuid,jsonb),
  public.mn_guard_ground_clock_family(),public.mn_load_ground_clock(text),public.mn_load_ground_clock_operation(uuid),
  public.mn_commit_ground_clock(uuid,jsonb) TO service_role;
COMMIT;

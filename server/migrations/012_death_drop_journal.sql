-- Exact ordinary death-drop lifecycle intents in the shared operation namespace.
-- Apply after 001-011. Recovery only; no host activation, clock policy, backfill or lease.
BEGIN;

ALTER TABLE public.mn_pearl_intents DROP CONSTRAINT IF EXISTS mn_pearl_intents_family_check;
ALTER TABLE public.mn_pearl_intents ADD CONSTRAINT mn_pearl_intents_family_check
  CHECK (family IN ('pearl','ground','batch','death','drop'));

-- Preserve 010's existing pearl, ground, batch and death validation branches.
-- SQL011's death-drop request validator also enforces the exact profile delta.
CREATE OR REPLACE FUNCTION public.mn_valid_pearl_intent(p_scope text, p_family text, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_count integer; v_profiles jsonb; v_profile jsonb; v_expected integer; v_endpoint_version integer;
  v_from uuid; v_to uuid; v_id uuid; v_number numeric;
BEGIN
  IF p_family = 'death' THEN
    RETURN (p_scope IS NOT NULL AND p_scope ~ '^[a-zA-Z0-9:_-]{1,100}$' AND
      public.mn_valid_death_delta(p_request) AND p_request->>'world' = p_scope) IS TRUE;
  END IF;
  IF p_family = 'batch' THEN
    RETURN (p_scope IS NOT NULL AND p_scope ~ '^[a-zA-Z0-9:_-]{1,100}$' AND
      public.mn_valid_pearl_batch(p_request) AND p_request->>'world' = p_scope) IS TRUE;
  END IF;
  IF p_family = 'drop' THEN
    RETURN (p_scope IS NOT NULL AND p_scope ~ '^[a-zA-Z0-9:_-]{1,100}$' AND
      public.mn_valid_death_drop_request(p_request) AND p_request->>'world' = p_scope) IS TRUE;
  END IF;
  IF p_scope IS NULL OR p_scope !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    p_family IS NULL OR p_family NOT IN ('pearl', 'ground') OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF p_family = 'pearl' THEN
    IF NOT (p_request ?& ARRAY['uid','kind','from','to','expectedVersion','profiles']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 6 THEN RETURN false; END IF;
  ELSE
    IF NOT (p_request ?& ARRAY['uid','kind','from','to','expectedVersion','profiles','world','ground']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 8 OR
      pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
      p_request->>'world' IS DISTINCT FROM p_scope OR
      (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
      ((p_request->>'to' IS NULL OR p_request->>'to' = 'null') <> (p_request->'ground' IS DISTINCT FROM 'null'::jsonb)) OR
      (p_request->'ground' IS DISTINCT FROM 'null'::jsonb AND NOT public.mn_valid_pearl_ground(p_request->'ground')) THEN
      RETURN false;
    END IF;
  END IF;
  IF p_request->>'uid' IS NULL OR (p_request->>'uid') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(p_request->'uid') IS DISTINCT FROM 'string' OR
    p_request->>'kind' NOT IN ('brasa','escarcha','tormenta','tinta') OR
    pg_catalog.jsonb_typeof(p_request->'kind') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(p_request->'from') NOT IN ('string','null') OR
    pg_catalog.jsonb_typeof(p_request->'to') NOT IN ('string','null') OR
    pg_catalog.jsonb_typeof(p_request->'expectedVersion') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(p_request->'profiles') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(p_request->'from') <> 'null' THEN
    v_from := (p_request->>'from')::uuid;
    IF p_request->>'from' IS DISTINCT FROM v_from::text THEN RETURN false; END IF;
  END IF;
  IF pg_catalog.jsonb_typeof(p_request->'to') <> 'null' THEN
    v_to := (p_request->>'to')::uuid;
    IF p_request->>'to' IS DISTINCT FROM v_to::text THEN RETURN false; END IF;
  END IF;
  IF v_from IS NOT DISTINCT FROM v_to AND p_family = 'pearl' THEN RETURN false; END IF;
  v_number := (p_request->>'expectedVersion')::numeric;
  IF v_number <> pg_catalog.trunc(v_number) OR v_number < 0 OR v_number >= 2147483647 THEN RETURN false; END IF;
  v_expected := v_number::integer;
  IF v_expected < 0 OR v_expected >= 2147483647 OR (v_expected = 0 AND v_from IS NOT NULL) THEN RETURN false; END IF;
  v_profiles := p_request->'profiles'; v_count := pg_catalog.jsonb_array_length(v_profiles);
  IF v_count <> (CASE WHEN v_from IS NOT NULL AND v_from = v_to THEN 1
    WHEN v_from IS NOT NULL AND v_to IS NOT NULL THEN 2
    WHEN v_from IS NULL AND v_to IS NULL THEN 0 ELSE 1 END) THEN RETURN false; END IF;
  IF p_family = 'ground' AND v_count = 0 AND (v_from IS NOT NULL OR v_to IS NOT NULL) THEN RETURN false; END IF;
  FOR v_profile IN SELECT value FROM pg_catalog.jsonb_array_elements(v_profiles) LOOP
    IF pg_catalog.jsonb_typeof(v_profile) IS DISTINCT FROM 'object' OR
      NOT (v_profile ?& ARRAY['id','expectedVersion','data']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_profile)) <> 3 OR
      pg_catalog.jsonb_typeof(v_profile->'id') IS DISTINCT FROM 'string' OR
      pg_catalog.jsonb_typeof(v_profile->'expectedVersion') IS DISTINCT FROM 'number' OR
      pg_catalog.jsonb_typeof(v_profile->'data') IS DISTINCT FROM 'object' OR
      v_profile->'data'->>'v' IS DISTINCT FROM '1' THEN RETURN false; END IF;
    v_id := (v_profile->>'id')::uuid;
    IF v_profile->>'id' IS DISTINCT FROM v_id::text THEN RETURN false; END IF;
    v_number := (v_profile->>'expectedVersion')::numeric;
    IF v_number <> pg_catalog.trunc(v_number) OR v_number < 1 OR v_number >= 2147483647 THEN RETURN false; END IF;
    v_endpoint_version := v_number::integer;
    IF v_id IS DISTINCT FROM v_from AND v_id IS DISTINCT FROM v_to OR
      v_endpoint_version < 1 OR v_endpoint_version >= 2147483647 THEN RETURN false; END IF;
  END LOOP;
  IF v_count = 2 AND (v_profiles->0->>'id')::uuid = (v_profiles->1->>'id')::uuid THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

-- Preserve 011's operation UUID lock and receipt immutability while allowing only exact
-- drop-intent/receipt identity across the journal boundary. Keep all installed family triggers.
CREATE OR REPLACE FUNCTION public.mn_guard_death_drop_operation_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_intent public.mn_pearl_intents%ROWTYPE; v_drop_request jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported death drop isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF TG_TABLE_NAME = 'mn_death_drop_operations' THEN
    IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'death drop operation UUID collision' USING ERRCODE = 'MNP02';
    END IF;
    SELECT * INTO v_intent FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id;
    IF FOUND AND (v_intent.family <> 'drop' OR v_intent.scope IS DISTINCT FROM NEW.request->>'world' OR
      v_intent.request IS DISTINCT FROM NEW.request OR v_intent.state <> 'pending') THEN
      RAISE EXCEPTION 'death drop intent identity mismatch' USING ERRCODE = 'MNP02';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.result IS NOT NULL OR NOT public.mn_valid_death_drop_request(NEW.request) THEN
        RAISE EXCEPTION 'invalid death drop receipt' USING ERRCODE = 'MNP02';
      END IF;
    ELSIF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.request IS DISTINCT FROM OLD.request OR
      OLD.result IS NOT NULL OR NEW.result IS NULL THEN
      RAISE EXCEPTION 'immutable death drop receipt' USING ERRCODE = 'MNP02';
    ELSE NEW.created_at := OLD.created_at;
    END IF;
  ELSIF TG_TABLE_NAME = 'mn_pearl_intents' THEN
    IF NEW.family = 'drop' THEN
      IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
        EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
        EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
        EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) THEN
        RAISE EXCEPTION 'death drop intent family mismatch' USING ERRCODE = 'MNP02';
      END IF;
      SELECT request INTO v_drop_request FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id;
      IF FOUND AND (v_drop_request IS DISTINCT FROM NEW.request OR NEW.scope IS DISTINCT FROM NEW.request->>'world') THEN
        RAISE EXCEPTION 'death drop receipt identity mismatch' USING ERRCODE = 'MNP02';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'operation belongs to death drop lifecycle' USING ERRCODE = 'MNP02';
    END IF;
  ELSE
    -- Legacy receipt tables cannot claim a UUID already reserved by a drop intent,
    -- including the interval before its lifecycle receipt is written.
    IF EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id AND family = 'drop') THEN
      RAISE EXCEPTION 'operation belongs to death drop lifecycle' USING ERRCODE = 'MNP02';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_pearl_intent(text,text,jsonb),
  public.mn_guard_death_drop_operation_family() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_pearl_intent(text,text,jsonb),
  public.mn_guard_death_drop_operation_family() TO service_role;
COMMIT;

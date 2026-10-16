-- Durable, service-only pearl intent journal. It records recovery state without activating gameplay.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_pearl_intents (
  operation_id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  family text NOT NULL CHECK (family IN ('pearl', 'ground')),
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  state text NOT NULL CHECK (state IN ('pending', 'committed', 'conflict', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS mn_pearl_intents_pending_page
  ON public.mn_pearl_intents(scope, operation_id) WHERE state = 'pending';
ALTER TABLE public.mn_pearl_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_pearl_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mn_pearl_intents TO service_role;

CREATE OR REPLACE FUNCTION public.mn_valid_pearl_intent(p_scope text, p_family text, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_count integer; v_profiles jsonb; v_profile jsonb; v_expected integer; v_endpoint_version integer;
  v_from uuid; v_to uuid; v_id uuid; v_number numeric;
BEGIN
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
  IF v_count <> (CASE WHEN v_from IS NOT NULL AND v_to IS NOT NULL THEN 2
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

CREATE OR REPLACE FUNCTION public.mn_guard_pearl_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'pearl intent rows are immutable' USING ERRCODE = 'MNP02'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text, 0));
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NOT public.mn_valid_pearl_intent(NEW.scope, NEW.family, NEW.request) THEN
      RAISE EXCEPTION 'invalid pearl intent' USING ERRCODE = 'MNP02';
    END IF;
  ELSE
    IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.scope IS DISTINCT FROM OLD.scope OR
      NEW.family IS DISTINCT FROM OLD.family OR NEW.request IS DISTINCT FROM OLD.request OR
      OLD.state <> 'pending' OR NEW.state NOT IN ('committed','conflict','rejected') THEN
      RAISE EXCEPTION 'pearl intent transition mismatch' USING ERRCODE = 'MNP02';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_pearl_intent_guard ON public.mn_pearl_intents;
CREATE TRIGGER mn_pearl_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mn_pearl_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_intent();

CREATE OR REPLACE FUNCTION public.mn_prepare_pearl_intent(p_scope text, p_family text, p_operation_id uuid, p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_row public.mn_pearl_intents%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR NOT public.mn_valid_pearl_intent(p_scope, p_family, p_request) THEN
    RAISE EXCEPTION 'invalid pearl intent' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text, 0));
  SELECT * INTO v_row FROM public.mn_pearl_intents WHERE mn_pearl_intents.operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.scope IS DISTINCT FROM p_scope OR v_row.family IS DISTINCT FROM p_family OR
      v_row.request IS DISTINCT FROM p_request THEN
      RAISE EXCEPTION 'pearl intent identity mismatch' USING ERRCODE = 'MNP02';
    END IF;
  ELSE
    INSERT INTO public.mn_pearl_intents(operation_id, scope, family, request, state)
      VALUES (p_operation_id, p_scope, p_family, p_request, 'pending') RETURNING * INTO v_row;
  END IF;
  RETURN pg_catalog.jsonb_build_object('operationId', v_row.operation_id, 'scope', v_row.scope,
    'family', v_row.family, 'request', v_row.request, 'state', v_row.state);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_resolve_pearl_intent(p_scope text, p_family text, p_operation_id uuid,
  p_request jsonb, p_state text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_row public.mn_pearl_intents%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR p_state IS NULL OR p_state NOT IN ('committed','conflict','rejected') OR
    NOT public.mn_valid_pearl_intent(p_scope, p_family, p_request) THEN
    RAISE EXCEPTION 'invalid pearl intent resolution' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text, 0));
  SELECT * INTO v_row FROM public.mn_pearl_intents WHERE mn_pearl_intents.operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR v_row.scope IS DISTINCT FROM p_scope OR v_row.family IS DISTINCT FROM p_family OR
    v_row.request IS DISTINCT FROM p_request OR
    (v_row.state <> 'pending' AND v_row.state <> p_state) THEN
    RAISE EXCEPTION 'pearl intent resolution mismatch' USING ERRCODE = 'MNP02';
  END IF;
  IF v_row.state = 'pending' THEN
    UPDATE public.mn_pearl_intents SET state = p_state WHERE mn_pearl_intents.operation_id = p_operation_id RETURNING * INTO v_row;
  END IF;
  RETURN pg_catalog.jsonb_build_object('operationId', v_row.operation_id, 'scope', v_row.scope,
    'family', v_row.family, 'request', v_row.request, 'state', v_row.state);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_list_pearl_intents(p_scope text, p_after_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_scope IS NULL OR p_scope !~ '^[a-zA-Z0-9:_-]{1,100}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 256 THEN
    RAISE EXCEPTION 'invalid pearl intent page' USING ERRCODE = 'MNP02';
  END IF;
  RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operationId', q.operation_id,
      'scope', q.scope, 'family', q.family, 'request', q.request, 'state', q.state) ORDER BY q.operation_id), '[]'::jsonb)
    FROM (SELECT i.operation_id, i.scope, i.family, i.request, i.state
      FROM public.mn_pearl_intents AS i WHERE i.scope = p_scope AND i.state = 'pending' AND
        (p_after_id IS NULL OR i.operation_id > p_after_id) ORDER BY i.operation_id LIMIT p_limit) AS q);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_pearl_intent(text,text,jsonb), public.mn_guard_pearl_intent(),
  public.mn_prepare_pearl_intent(text,text,uuid,jsonb), public.mn_resolve_pearl_intent(text,text,uuid,jsonb,text),
  public.mn_list_pearl_intents(text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_pearl_intent(text,text,jsonb), public.mn_guard_pearl_intent(),
  public.mn_prepare_pearl_intent(text,text,uuid,jsonb), public.mn_resolve_pearl_intent(text,text,uuid,jsonb,text),
  public.mn_list_pearl_intents(text,uuid,integer) TO service_role;
COMMIT;

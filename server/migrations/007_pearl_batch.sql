-- Atomic pearl-only death spill and two-UID replacement. Apply after 001-006.
-- No gameplay hooks, journal/queue activation, guest adoption, clock policy or affinity credit.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_pearl_batch_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  result jsonb CHECK (result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_pearl_batch_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_pearl_batch_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mn_pearl_batch_operations TO service_role;

-- The same UUID must never name a batch and a 003/004 operation, including direct service inserts.
-- Retain 004's existing trigger that permits its provisional, exact 003 child operation.
CREATE OR REPLACE FUNCTION public.mn_guard_pearl_batch_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported pearl isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text, 0));
  IF TG_TABLE_NAME = 'mn_pearl_batch_operations' THEN
    IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'batch operation family mismatch' USING ERRCODE = 'MNP02';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'operation belongs to batch' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_pearl_batch_family ON public.mn_pearl_operations;
CREATE TRIGGER mn_pearl_batch_family BEFORE INSERT ON public.mn_pearl_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_batch_family();
DROP TRIGGER IF EXISTS mn_pearl_batch_family ON public.mn_pearl_ground_operations;
CREATE TRIGGER mn_pearl_batch_family BEFORE INSERT ON public.mn_pearl_ground_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_batch_family();
DROP TRIGGER IF EXISTS mn_pearl_batch_family ON public.mn_pearl_batch_operations;
CREATE TRIGGER mn_pearl_batch_family BEFORE INSERT ON public.mn_pearl_batch_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_batch_family();
DROP TRIGGER IF EXISTS mn_pearl_batch_family ON public.mn_pearl_intents;
CREATE TRIGGER mn_pearl_batch_family BEFORE INSERT ON public.mn_pearl_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_batch_family();

CREATE OR REPLACE FUNCTION public.mn_valid_pearl_batch(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_p jsonb; v_q jsonb; v_id uuid; v_number numeric; v_previous text; v_held integer := 0; v_count integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT (p_request ?& ARRAY['world','mode','profile','items']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 4 OR
    pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
    (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(p_request->'mode') IS DISTINCT FROM 'string' OR
    p_request->>'mode' NOT IN ('death','replace') OR
    pg_catalog.jsonb_typeof(p_request->'items') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  v_p := p_request->'profile';
  IF pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object' OR
    NOT (v_p ?& ARRAY['id','expectedVersion','data']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_p)) <> 3 OR
    pg_catalog.jsonb_typeof(v_p->'id') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(v_p->'expectedVersion') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(v_p->'data') IS DISTINCT FROM 'object' OR
    v_p->'data'->>'v' IS DISTINCT FROM '1' OR pg_catalog.octet_length((v_p->'data')::text) > 131072 THEN RETURN false; END IF;
  v_id := (v_p->>'id')::uuid;
  IF v_p->>'id' IS DISTINCT FROM v_id::text THEN RETURN false; END IF;
  v_number := (v_p->>'expectedVersion')::numeric;
  IF v_number <> pg_catalog.trunc(v_number) OR v_number < 1 OR v_number >= 2147483647 THEN RETURN false; END IF;
  v_count := pg_catalog.jsonb_array_length(p_request->'items');
  IF v_count < 1 OR v_count > 9 THEN RETURN false; END IF;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'items') LOOP
    IF pg_catalog.jsonb_typeof(v_q) IS DISTINCT FROM 'object' OR
      NOT (v_q ?& ARRAY['uid','kind','expectedVersion','ground']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_q)) <> 4 OR
      pg_catalog.jsonb_typeof(v_q->'uid') IS DISTINCT FROM 'string' OR
      (v_q->>'uid') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
      (v_previous IS NOT NULL AND (v_q->>'uid') COLLATE "C" <= v_previous COLLATE "C") OR
      pg_catalog.jsonb_typeof(v_q->'kind') IS DISTINCT FROM 'string' OR
      v_q->>'kind' NOT IN ('brasa','escarcha','tormenta','tinta') OR
      pg_catalog.jsonb_typeof(v_q->'expectedVersion') IS DISTINCT FROM 'number' OR
      (v_q->'ground' IS DISTINCT FROM 'null'::jsonb AND NOT public.mn_valid_pearl_ground(v_q->'ground')) THEN
      RETURN false;
    END IF;
    v_number := (v_q->>'expectedVersion')::numeric;
    IF v_number <> pg_catalog.trunc(v_number) OR v_number < 1 OR v_number >= 2147483647 THEN RETURN false; END IF;
    IF v_q->'ground' = 'null'::jsonb THEN v_held := v_held + 1; END IF;
    v_previous := v_q->>'uid';
  END LOOP;
  RETURN CASE WHEN p_request->>'mode' = 'death' THEN v_held = 0 ELSE v_count = 2 AND v_held = 1 END;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_pearl_batch_delta(p_before jsonb, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_q jsonb; v_all jsonb; v_count integer; v_in jsonb; v_out jsonb; v_bag jsonb; v_expected jsonb;
BEGIN
  IF NOT public.mn_valid_pearl_batch(p_request) OR pg_catalog.jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_before->'pearls') IS DISTINCT FROM 'object' OR
    NOT (p_before->'pearls' ?& ARRAY['bag','swallowed']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_before->'pearls')) <> 2 OR
    pg_catalog.jsonb_typeof(p_before->'pearls'->'bag') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_array_length(p_before->'pearls'->'bag') > 8 OR
    pg_catalog.jsonb_typeof(p_before->'pearls'->'swallowed') NOT IN ('object','null') THEN RETURN false; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(q), '[]'::jsonb) INTO v_all FROM public.mn_profile_pearls(p_before) AS q;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(v_all) LOOP
    IF pg_catalog.jsonb_typeof(v_q) IS DISTINCT FROM 'object' OR
      NOT (v_q ?& ARRAY['uid','kind']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_q)) <> 2 OR
      pg_catalog.jsonb_typeof(v_q->'uid') IS DISTINCT FROM 'string' OR
      (v_q->>'uid') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
      pg_catalog.jsonb_typeof(v_q->'kind') IS DISTINCT FROM 'string' OR
      v_q->>'kind' NOT IN ('brasa','escarcha','tormenta','tinta') THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(DISTINCT q->>'uid') FROM pg_catalog.jsonb_array_elements(v_all) AS q) <
    pg_catalog.jsonb_array_length(v_all) THEN RETURN false; END IF;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'items') LOOP
    SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.jsonb_array_elements(v_all) AS q
      WHERE q = pg_catalog.jsonb_build_object('uid', v_q->>'uid', 'kind', v_q->>'kind');
    IF v_count <> 1 THEN RETURN false; END IF;
  END LOOP;
  IF p_request->>'mode' = 'death' THEN
    IF pg_catalog.jsonb_array_length(v_all) <> pg_catalog.jsonb_array_length(p_request->'items') THEN RETURN false; END IF;
    v_expected := pg_catalog.jsonb_set(p_before, '{pearls}', '{"bag":[],"swallowed":null}'::jsonb);
  ELSE
    SELECT value INTO v_in FROM pg_catalog.jsonb_array_elements(p_request->'items') WHERE value->'ground' = 'null'::jsonb;
    SELECT value INTO v_out FROM pg_catalog.jsonb_array_elements(p_request->'items') WHERE value->'ground' <> 'null'::jsonb;
    IF p_before->'pearls'->'swallowed' IS DISTINCT FROM pg_catalog.jsonb_build_object('uid',v_out->>'uid','kind',v_out->>'kind') OR
      NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_before->'pearls'->'bag') AS q WHERE q->>'uid' = v_in->>'uid') THEN
      RETURN false;
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(q.value ORDER BY q.ord), '[]'::jsonb) INTO v_bag
      FROM pg_catalog.jsonb_array_elements(p_before->'pearls'->'bag') WITH ORDINALITY AS q(value,ord)
      WHERE q.value->>'uid' <> v_in->>'uid';
    v_expected := pg_catalog.jsonb_set(pg_catalog.jsonb_set(p_before, '{pearls,bag}', v_bag),
      '{pearls,swallowed}', pg_catalog.jsonb_build_object('uid',v_in->>'uid','kind',v_in->>'kind'));
  END IF;
  RETURN v_expected = p_request->'profile'->'data';
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_pearl_batch(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_p jsonb; v_q jsonb; v_id uuid; v_old jsonb; v_profile_version integer; v_expected integer; v_uid text;
  v_current public.mn_unique_items%ROWTYPE; v_location public.mn_pearl_locations%ROWTYPE;
  v_request jsonb; v_result jsonb; v_uniques jsonb := '[]'::jsonb; v_locations jsonb := '[]'::jsonb;
  v_ground jsonb; v_holder uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    NOT public.mn_valid_pearl_batch(p_request) THEN RAISE EXCEPTION 'invalid batch' USING ERRCODE = 'MNP02'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text, 0));
  SELECT request, result INTO v_request, v_result FROM public.mn_pearl_batch_operations
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request OR v_result IS NULL THEN
      RAISE EXCEPTION 'batch receipt mismatch' USING ERRCODE = 'MNP02';
    END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay', true);
  END IF;
  INSERT INTO public.mn_pearl_batch_operations(operation_id, request) VALUES (p_operation_id, p_request);
  v_p := p_request->'profile'; v_id := (v_p->>'id')::uuid;
  SELECT data, version INTO v_old, v_profile_version FROM public.mn_profiles WHERE player_id = v_id FOR UPDATE;
  IF NOT FOUND OR v_profile_version <> (v_p->>'expectedVersion')::integer THEN
    RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01';
  END IF;
  -- Follow 003/raw-save ordering: profile first, every old/new/operation UID sorted, then rows.
  FOR v_uid IN SELECT q->>'uid' FROM public.mn_profile_pearls(v_old) AS q WHERE q->>'uid' IS NOT NULL
    UNION SELECT q->>'uid' FROM public.mn_profile_pearls(v_p->'data') AS q WHERE q->>'uid' IS NOT NULL
    UNION SELECT q->>'uid' FROM pg_catalog.jsonb_array_elements(p_request->'items') AS q ORDER BY 1
  LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_uid, 0)); END LOOP;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'items') LOOP
    v_uid := v_q->>'uid'; v_expected := (v_q->>'expectedVersion')::integer;
    SELECT * INTO v_current FROM public.mn_unique_items WHERE uid = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing unique' USING ERRCODE = 'MNC01'; END IF;
    IF v_current.kind <> 'pearl:' || (v_q->>'kind') THEN RAISE EXCEPTION 'kind conflict' USING ERRCODE = 'MNK01'; END IF;
    IF v_current.version <> v_expected OR v_current.holder IS DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'unique conflict' USING ERRCODE = 'MNC01';
    END IF;
    SELECT * INTO v_location FROM public.mn_pearl_locations WHERE uid = v_uid FOR UPDATE;
    IF FOUND AND (v_location.world <> p_request->>'world' OR v_location.version <> v_expected OR v_location.ground IS NOT NULL) THEN
      RAISE EXCEPTION 'source location mismatch' USING ERRCODE = 'MNP01';
    END IF;
  END LOOP;
  IF NOT public.mn_valid_pearl_batch_delta(v_old, p_request) THEN
    RAISE EXCEPTION 'batch profile delta mismatch' USING ERRCODE = 'MNP01';
  END IF;
  UPDATE public.mn_profiles SET data = v_p->'data', version = v_profile_version + 1, updated_at = pg_catalog.now()
    WHERE player_id = v_id AND version = v_profile_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01'; END IF;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'items') LOOP
    v_uid := v_q->>'uid'; v_expected := (v_q->>'expectedVersion')::integer;
    v_ground := NULLIF(v_q->'ground', 'null'::jsonb);
    v_holder := CASE WHEN v_ground IS NULL THEN v_id ELSE NULL END;
    -- The incoming replacement stays with the character: preserve its original ownership timestamp.
    UPDATE public.mn_unique_items SET holder = v_holder, version = v_expected + 1,
      since = CASE WHEN v_holder IS NULL THEN NULL ELSE since END WHERE uid = v_uid;
    INSERT INTO public.mn_pearl_locations(uid, world, ground, version)
      VALUES (v_uid, p_request->>'world', v_ground, v_expected + 1)
      ON CONFLICT (uid) DO UPDATE SET ground = EXCLUDED.ground, version = EXCLUDED.version, updated_at = pg_catalog.now();
    PERFORM public.mn_assert_pearl_location(v_uid, true);
    v_uniques := v_uniques || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('uid', v_uid,
      'kind', 'pearl:' || (v_q->>'kind'), 'holder', v_holder, 'version', v_expected + 1));
    v_locations := v_locations || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('uid', v_uid,
      'world', p_request->>'world', 'ground', v_ground, 'version', v_expected + 1));
  END LOOP;
  v_result := pg_catalog.jsonb_build_object('ok', true, 'replay', false, 'profiles',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', v_id, 'version', v_profile_version + 1)),
    'uniques', v_uniques, 'locations', v_locations);
  UPDATE public.mn_pearl_batch_operations SET result = v_result WHERE operation_id = p_operation_id;
  RETURN v_result;
EXCEPTION
  -- Any error rolls back every UID, location, the profile and provisional receipt together.
  WHEN SQLSTATE 'MNC01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  WHEN SQLSTATE 'MNK01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'kind');
  WHEN SQLSTATE 'MNP01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'ownership');
  WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_pearl_batch_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid operation ID' USING ERRCODE = 'MNP02'; END IF;
  SELECT pg_catalog.jsonb_build_object('request', request, 'result', result) INTO v_result
    FROM public.mn_pearl_batch_operations WHERE operation_id = p_operation_id;
  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION public.mn_guard_pearl_batch_family(), public.mn_valid_pearl_batch(jsonb),
  public.mn_valid_pearl_batch_delta(jsonb,jsonb), public.mn_commit_pearl_batch(uuid,jsonb),
  public.mn_load_pearl_batch_operation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_guard_pearl_batch_family(), public.mn_valid_pearl_batch(jsonb),
  public.mn_valid_pearl_batch_delta(jsonb,jsonb), public.mn_commit_pearl_batch(uuid,jsonb),
  public.mn_load_pearl_batch_operation(uuid) TO service_role;
COMMIT;

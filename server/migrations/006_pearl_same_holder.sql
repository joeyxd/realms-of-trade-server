-- Same-holder bag -> empty swallowed, using the existing ground receipt/journal family.
-- Apply after 001-005. No gameplay activation, replacement, batch, guest adoption or clock policy.
BEGIN;

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

CREATE OR REPLACE FUNCTION public.mn_valid_pearl_swallow(p_before jsonb, p_after jsonb, p_uid text, p_kind text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_pearl jsonb; v_count integer; v_bag jsonb; v_expected jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_after) IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_before->'pearls'->'bag') IS DISTINCT FROM 'array' OR
    p_before->'pearls'->'swallowed' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM public.mn_profile_pearls(p_before) AS q WHERE q->>'uid' = p_uid;
  IF v_count <> 1 THEN RETURN false; END IF;
  SELECT value INTO v_pearl FROM pg_catalog.jsonb_array_elements(p_before->'pearls'->'bag')
    WHERE value->>'uid' = p_uid;
  IF v_pearl IS NULL OR v_pearl->>'kind' IS DISTINCT FROM p_kind OR
    v_pearl IS DISTINCT FROM pg_catalog.jsonb_build_object('uid', p_uid, 'kind', p_kind) THEN RETURN false; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(q.value ORDER BY q.ord), '[]'::jsonb) INTO v_bag
    FROM pg_catalog.jsonb_array_elements(p_before->'pearls'->'bag') WITH ORDINALITY AS q(value, ord)
    WHERE q.value->>'uid' IS DISTINCT FROM p_uid;
  v_expected := pg_catalog.jsonb_set(pg_catalog.jsonb_set(p_before, '{pearls,bag}', v_bag),
    '{pearls,swallowed}', v_pearl);
  RETURN v_expected = p_after;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_pearl_ground(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_uid text; v_kind text; v_world text; v_from uuid; v_to uuid; v_expected integer; v_ground jsonb;
  v_request jsonb; v_result jsonb; v_current public.mn_unique_items%ROWTYPE;
  v_location public.mn_pearl_locations%ROWTYPE; v_has_current boolean; v_has_location boolean;
  v_p jsonb; v_old jsonb; v_profile_version integer; v_expected_profile integer; v_lock_uid text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid ground operation' USING ERRCODE = 'MNP02';
  END IF;
  IF NOT (p_request ?& ARRAY['uid','kind','from','to','expectedVersion','profiles','world','ground']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 8 THEN
    RAISE EXCEPTION 'invalid ground request' USING ERRCODE = 'MNP02';
  END IF;
  v_uid := p_request->>'uid'; v_kind := p_request->>'kind'; v_world := p_request->>'world';
  v_from := (p_request->>'from')::uuid; v_to := (p_request->>'to')::uuid;
  v_ground := NULLIF(p_request->'ground', 'null'::jsonb);
  IF v_uid IS NULL OR v_uid !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    v_kind IS NULL OR v_kind NOT IN ('brasa','escarcha','tormenta','tinta') OR
    v_world IS NULL OR v_world !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(p_request->'uid') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(p_request->'kind') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(p_request->'from') NOT IN ('string','null') OR
    pg_catalog.jsonb_typeof(p_request->'to') NOT IN ('string','null') OR
    pg_catalog.jsonb_typeof(p_request->'expectedVersion') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(p_request->'profiles') IS DISTINCT FROM 'array' OR
    (v_to IS NULL) <> (v_ground IS NOT NULL) OR
    (v_ground IS NOT NULL AND NOT public.mn_valid_pearl_ground(v_ground)) THEN
    RAISE EXCEPTION 'invalid ground metadata' USING ERRCODE = 'MNP02';
  END IF;
  v_expected := (p_request->>'expectedVersion')::integer;
  IF v_expected < 0 OR v_expected >= 2147483647 OR (v_expected = 0 AND v_from IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid ground generation' USING ERRCODE = 'MNP02';
  END IF;

  -- This lock precedes profile/UID locks, just as the 003 receipt insert trigger does.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text, 0));
  SELECT request, result INTO v_request, v_result FROM public.mn_pearl_ground_operations
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request OR v_result IS NULL THEN
      RAISE EXCEPTION 'ground receipt mismatch' USING ERRCODE = 'MNP02';
    END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = p_operation_id) THEN
    RAISE EXCEPTION 'operation already belongs to 003' USING ERRCODE = 'MNP02';
  END IF;
  INSERT INTO public.mn_pearl_ground_operations(operation_id, request) VALUES (p_operation_id, p_request);

  IF v_from IS NOT NULL AND v_from = v_to THEN
    -- Same-holder is exclusively bag -> empty swallowed. The full profile delta is conserved,
    -- including unrelated bag order and progress. It is not a replacement or a multi-UID effect.
    IF NOT public.mn_valid_pearl_intent(v_world, 'ground', p_request) OR v_expected < 1 THEN
      RAISE EXCEPTION 'invalid same-holder request' USING ERRCODE = 'MNP02';
    END IF;
    v_p := p_request->'profiles'->0;
    v_expected_profile := (v_p->>'expectedVersion')::integer;
    SELECT data, version INTO v_old, v_profile_version FROM public.mn_profiles
      WHERE player_id = v_from FOR UPDATE;
    IF NOT FOUND OR v_profile_version <> v_expected_profile THEN
      RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01';
    END IF;
    -- Follow 003/raw-save ordering: profile first, every affected UID sorted, then ledger/location.
    FOR v_lock_uid IN SELECT q->>'uid' FROM public.mn_profile_pearls(v_old) AS q
      WHERE q->>'uid' IS NOT NULL UNION SELECT v_uid ORDER BY 1
    LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_lock_uid, 0)); END LOOP;
    SELECT * INTO v_current FROM public.mn_unique_items WHERE uid = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing unique' USING ERRCODE = 'MNC01'; END IF;
    IF v_current.kind <> 'pearl:' || v_kind THEN RAISE EXCEPTION 'kind conflict' USING ERRCODE = 'MNK01'; END IF;
    IF v_current.version <> v_expected OR v_current.holder IS DISTINCT FROM v_from THEN
      RAISE EXCEPTION 'unique conflict' USING ERRCODE = 'MNC01';
    END IF;
    IF NOT public.mn_valid_pearl_swallow(v_old, v_p->'data', v_uid, v_kind) THEN
      RAISE EXCEPTION 'invalid swallow delta' USING ERRCODE = 'MNP01';
    END IF;
    UPDATE public.mn_profiles SET data = v_p->'data', version = v_expected_profile + 1,
      updated_at = pg_catalog.now() WHERE player_id = v_from AND version = v_expected_profile;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01'; END IF;
    -- Ownership did not change: since remains intact while the managed-state generation advances.
    UPDATE public.mn_unique_items SET version = v_expected + 1 WHERE uid = v_uid;
    PERFORM public.mn_assert_pearl_owner(v_uid);
    v_result := pg_catalog.jsonb_build_object('ok', true, 'replay', false, 'profiles',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', v_from, 'version', v_expected_profile + 1)),
      'unique', pg_catalog.jsonb_build_object('uid', v_uid, 'kind', 'pearl:' || v_kind,
        'holder', v_from, 'version', v_expected + 1));
  ELSIF v_from IS NOT NULL OR v_to IS NOT NULL THEN
    -- 003 locks sorted endpoints, then affected UIDs and the ledger. Do not acquire location locks first.
    v_result := public.mn_commit_pearl(p_operation_id, p_request - 'world' - 'ground');
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN
      CASE v_result->>'why'
        WHEN 'conflict' THEN RAISE EXCEPTION 'profile/unique conflict' USING ERRCODE = 'MNC01';
        WHEN 'kind' THEN RAISE EXCEPTION 'kind conflict' USING ERRCODE = 'MNK01';
        WHEN 'ownership' THEN RAISE EXCEPTION 'ownership conflict' USING ERRCODE = 'MNP01';
        ELSE RAISE EXCEPTION 'invalid child operation' USING ERRCODE = 'MNP02';
      END CASE;
    END IF;
    IF v_result->>'replay' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'unexpected child replay' USING ERRCODE = 'MNP02';
    END IF;
  ELSE
    IF pg_catalog.jsonb_array_length(p_request->'profiles') <> 0 THEN
      RAISE EXCEPTION 'ground-only operation has profiles' USING ERRCODE = 'MNP02';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_uid, 0));
    SELECT * INTO v_current FROM public.mn_unique_items WHERE uid = v_uid FOR UPDATE;
    v_has_current := FOUND;
    IF v_has_current THEN
      IF v_current.kind <> 'pearl:' || v_kind THEN RAISE EXCEPTION 'kind conflict' USING ERRCODE = 'MNK01'; END IF;
      IF v_current.version <> v_expected OR v_current.holder IS NOT NULL THEN
        RAISE EXCEPTION 'unique conflict' USING ERRCODE = 'MNC01';
      END IF;
    ELSIF v_expected <> 0 THEN RAISE EXCEPTION 'missing unique' USING ERRCODE = 'MNC01';
    END IF;
  END IF;

  SELECT * INTO v_location FROM public.mn_pearl_locations WHERE uid = v_uid FOR UPDATE;
  v_has_location := FOUND;
  IF v_has_location THEN
    IF v_location.world <> v_world OR v_location.version <> v_expected OR
      (v_from IS NULL) <> (v_location.ground IS NOT NULL) THEN
      RAISE EXCEPTION 'ground ownership conflict' USING ERRCODE = 'MNP01';
    END IF;
  ELSIF v_from IS NULL AND v_expected <> 0 THEN
    RAISE EXCEPTION 'missing source ground' USING ERRCODE = 'MNP01';
  END IF;

  IF v_from IS NULL AND v_to IS NULL THEN
    IF v_has_current THEN
      UPDATE public.mn_unique_items SET version = v_expected + 1, since = NULL WHERE uid = v_uid;
    ELSE
      INSERT INTO public.mn_unique_items(uid, kind, holder, version, since)
        VALUES (v_uid, 'pearl:' || v_kind, NULL, 1, NULL);
    END IF;
    PERFORM public.mn_assert_pearl_owner(v_uid);
    v_result := pg_catalog.jsonb_build_object('ok', true, 'replay', false, 'profiles', '[]'::jsonb, 'unique',
      pg_catalog.jsonb_build_object('uid', v_uid, 'kind', 'pearl:' || v_kind, 'holder', NULL, 'version', v_expected + 1));
  END IF;
  INSERT INTO public.mn_pearl_locations(uid, world, ground, version)
    VALUES (v_uid, v_world, v_ground, v_expected + 1)
    ON CONFLICT (uid) DO UPDATE SET ground = EXCLUDED.ground, version = EXCLUDED.version, updated_at = pg_catalog.now();
  PERFORM public.mn_assert_pearl_location(v_uid, true);
  v_result := v_result || pg_catalog.jsonb_build_object('location',
    pg_catalog.jsonb_build_object('uid', v_uid, 'world', v_world, 'ground', v_ground, 'version', v_expected + 1));
  UPDATE public.mn_pearl_ground_operations SET result = v_result WHERE operation_id = p_operation_id;
  RETURN v_result;
EXCEPTION
  -- Roll back endpoints, ledger, location and both provisional receipts together.
  WHEN SQLSTATE 'MNC01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  WHEN SQLSTATE 'MNK01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'kind');
  WHEN SQLSTATE 'MNP01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'ownership');
  WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'operation');
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_pearl_swallow(jsonb,jsonb,text,text),
  public.mn_valid_pearl_intent(text,text,jsonb), public.mn_commit_pearl_ground(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_pearl_swallow(jsonb,jsonb,text,text),
  public.mn_valid_pearl_intent(text,text,jsonb), public.mn_commit_pearl_ground(uuid,jsonb) TO service_role;
COMMIT;

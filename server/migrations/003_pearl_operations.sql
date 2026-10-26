-- Atomic pearl ownership/profile transitions. Apply after 001 and 002; game wiring remains a separate cut.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_pearl_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  result jsonb CHECK (result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_pearl_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_pearl_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mn_pearl_operations TO service_role;

CREATE OR REPLACE FUNCTION public.mn_profile_pearls(p_data jsonb)
RETURNS SETOF jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT value FROM pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(p_data->'pearls'->'bag') = 'array'
      THEN p_data->'pearls'->'bag' ELSE '[]'::jsonb END)
  UNION ALL SELECT p_data->'pearls'->'swallowed'
    WHERE pg_catalog.jsonb_typeof(p_data->'pearls'->'swallowed') = 'object';
$function$;

-- Lock even unregistered UIDs so a raw save cannot cross the first managed grant unnoticed.
CREATE OR REPLACE FUNCTION public.mn_lock_profile_pearl_keys()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_old jsonb; v_new jsonb; v_uid text;
BEGIN
  -- Fresh snapshots after an advisory-lock wait are part of this boundary's contract.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported pearl isolation' USING ERRCODE = 'MNP02';
  END IF;
  IF TG_OP <> 'INSERT' THEN v_old := OLD.data; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := NEW.data; END IF;
  FOR v_uid IN SELECT q->>'uid' FROM public.mn_profile_pearls(v_old) AS q
    WHERE q->>'uid' IS NOT NULL
    UNION SELECT q->>'uid' FROM public.mn_profile_pearls(v_new) AS q
    WHERE q->>'uid' IS NOT NULL ORDER BY 1
  LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_uid, 0)); END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS mn_profile_pearl_keys ON public.mn_profiles;
CREATE TRIGGER mn_profile_pearl_keys BEFORE INSERT OR UPDATE OR DELETE ON public.mn_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mn_lock_profile_pearl_keys();

CREATE OR REPLACE FUNCTION public.mn_assert_pearl_owner(p_uid text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_kind text; v_holder uuid; v_count bigint; v_matches bigint;
BEGIN
  SELECT kind, holder INTO v_kind, v_holder FROM public.mn_unique_items WHERE uid = p_uid FOR UPDATE;
  IF NOT FOUND OR v_kind NOT LIKE 'pearl:%' THEN RETURN; END IF;
  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (
    WHERE p.player_id = v_holder AND q->>'kind' = pg_catalog.substr(v_kind, 7))
    INTO v_count, v_matches
    FROM public.mn_profiles AS p CROSS JOIN LATERAL public.mn_profile_pearls(p.data) AS q
    WHERE q->>'uid' = p_uid;
  IF (v_holder IS NULL AND v_count <> 0) OR (v_holder IS NOT NULL AND (v_count <> 1 OR v_matches <> 1)) THEN
    RAISE EXCEPTION 'managed pearl ownership mismatch' USING ERRCODE = 'MNP01';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_guard_profile_pearls()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_old jsonb; v_new jsonb; v_player uuid; v_uid text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := OLD.data; v_player := OLD.player_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := NEW.data; v_player := NEW.player_id; END IF;
  FOR v_uid IN SELECT item.uid FROM public.mn_unique_items AS item
    WHERE item.kind LIKE 'pearl:%' AND (item.holder = v_player OR item.uid IN (
      SELECT q->>'uid' FROM public.mn_profile_pearls(v_old) AS q
      UNION SELECT q->>'uid' FROM public.mn_profile_pearls(v_new) AS q))
    ORDER BY item.uid
  LOOP PERFORM public.mn_assert_pearl_owner(v_uid); END LOOP;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS mn_profile_pearl_guard ON public.mn_profiles;
CREATE CONSTRAINT TRIGGER mn_profile_pearl_guard AFTER INSERT OR UPDATE OR DELETE ON public.mn_profiles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mn_guard_profile_pearls();

CREATE OR REPLACE FUNCTION public.mn_load_unique(p_uid text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_uid IS NULL OR pg_catalog.btrim(p_uid) = '' OR pg_catalog.char_length(p_uid) > 160 THEN
    RAISE EXCEPTION 'invalid unique key' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.jsonb_build_object('kind', kind, 'holder', holder, 'version', version) INTO v_result
    FROM public.mn_unique_items WHERE uid = p_uid;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_pearl(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_uid text; v_kind text; v_from uuid; v_to uuid; v_expected integer;
  v_p jsonb; v_id uuid; v_version integer; v_data jsonb; v_old jsonb; v_old_version integer;
  v_current_kind text; v_current_holder uuid; v_current_version integer;
  v_request jsonb; v_result jsonb; v_profiles jsonb := '[]'::jsonb;
  v_count bigint; v_match bigint; v_before jsonb; v_after jsonb; v_endpoints integer;
  v_lock_uids text[] := ARRAY[]::text[]; v_lock_uid text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported pearl isolation' USING ERRCODE = 'MNP02';
  END IF;
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid operation' USING ERRCODE = 'MNP02';
  END IF;
  v_uid := p_request->>'uid'; v_kind := p_request->>'kind';
  v_from := (p_request->>'from')::uuid; v_to := (p_request->>'to')::uuid;
  IF v_uid IS NULL OR v_uid !~ '^[a-zA-Z0-9:_-]{1,100}$' OR v_kind IS NULL OR
    v_kind NOT IN ('brasa', 'escarcha', 'tormenta', 'tinta') OR v_from IS NOT DISTINCT FROM v_to OR
    NOT (p_request ?& ARRAY['uid', 'kind', 'from', 'to', 'expectedVersion', 'profiles']) OR
    pg_catalog.jsonb_typeof(p_request->'expectedVersion') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(p_request->'profiles') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid operation' USING ERRCODE = 'MNP02';
  END IF;
  v_expected := (p_request->>'expectedVersion')::integer;
  v_endpoints := CASE WHEN v_from IS NULL OR v_to IS NULL THEN 1 ELSE 2 END;
  IF v_expected < 0 OR v_expected >= 2147483647 OR (v_expected = 0 AND v_from IS NOT NULL) OR
    pg_catalog.jsonb_array_length(p_request->'profiles') <> v_endpoints OR
    (SELECT pg_catalog.count(DISTINCT (p->>'id')::uuid) FROM pg_catalog.jsonb_array_elements(p_request->'profiles') AS p) <> v_endpoints THEN
    RAISE EXCEPTION 'invalid operation' USING ERRCODE = 'MNP02';
  END IF;

  -- A concurrent retry waits on this unique insert. Failure rolls this provisional receipt back too.
  INSERT INTO public.mn_pearl_operations(operation_id, request) VALUES (p_operation_id, p_request)
    ON CONFLICT (operation_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT request, result INTO v_request, v_result FROM public.mn_pearl_operations
      WHERE operation_id = p_operation_id FOR UPDATE;
    IF v_request IS DISTINCT FROM p_request THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'operation');
    END IF;
    IF v_result IS NULL THEN RAISE EXCEPTION 'invalid receipt' USING ERRCODE = 'MNP02'; END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay', true);
  END IF;

  -- All endpoint rows lock in UUID order before the unique row; no new profile can be silently created.
  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'profiles') ORDER BY value->>'id'
  LOOP
    IF pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object' OR
      pg_catalog.jsonb_typeof(v_p->'expectedVersion') IS DISTINCT FROM 'number' OR
      pg_catalog.jsonb_typeof(v_p->'data') IS DISTINCT FROM 'object' OR v_p->'data'->>'v' IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'invalid profile' USING ERRCODE = 'MNP02';
    END IF;
    v_id := (v_p->>'id')::uuid; v_version := (v_p->>'expectedVersion')::integer; v_data := v_p->'data';
    IF v_id IS NULL OR (v_id IS DISTINCT FROM v_from AND v_id IS DISTINCT FROM v_to) OR
      v_version < 1 OR v_version >= 2147483647 THEN RAISE EXCEPTION 'invalid endpoint' USING ERRCODE = 'MNP02'; END IF;
    SELECT data, version INTO v_old, v_old_version FROM public.mn_profiles WHERE player_id = v_id FOR UPDATE;
    IF NOT FOUND OR v_old_version <> v_version THEN RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01'; END IF;
    v_lock_uids := v_lock_uids || ARRAY(SELECT q->>'uid' FROM public.mn_profile_pearls(v_old) AS q
      WHERE q->>'uid' IS NOT NULL UNION SELECT q->>'uid' FROM public.mn_profile_pearls(v_data) AS q
      WHERE q->>'uid' IS NOT NULL);

    SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE q->>'kind' = v_kind)
      INTO v_count, v_match FROM public.mn_profile_pearls(v_old) AS q WHERE q->>'uid' = v_uid;
    IF v_count <> (CASE WHEN v_id = v_from THEN 1 ELSE 0 END) OR v_match <> v_count THEN
      RAISE EXCEPTION 'source ownership mismatch' USING ERRCODE = 'MNP01';
    END IF;
    SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE q->>'kind' = v_kind)
      INTO v_count, v_match FROM public.mn_profile_pearls(v_data) AS q WHERE q->>'uid' = v_uid;
    IF v_count <> (CASE WHEN v_id = v_to THEN 1 ELSE 0 END) OR v_match <> v_count THEN
      RAISE EXCEPTION 'target ownership mismatch' USING ERRCODE = 'MNP01';
    END IF;
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('uid', q->>'uid', 'kind', q->>'kind') ORDER BY q->>'uid')
      INTO v_before FROM public.mn_profile_pearls(v_old) AS q WHERE q->>'uid' <> v_uid;
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('uid', q->>'uid', 'kind', q->>'kind') ORDER BY q->>'uid')
      INTO v_after FROM public.mn_profile_pearls(v_data) AS q WHERE q->>'uid' <> v_uid;
    IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'unrelated pearl changed' USING ERRCODE = 'MNP01'; END IF;
  END LOOP;

  -- Match the profile trigger's lock order. Endpoint row locks come first, then every affected UID.
  FOR v_lock_uid IN SELECT DISTINCT value FROM pg_catalog.unnest(v_lock_uids || ARRAY[v_uid]) AS value ORDER BY value
  LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_lock_uid, 0)); END LOOP;

  SELECT kind, holder, version INTO v_current_kind, v_current_holder, v_current_version
    FROM public.mn_unique_items WHERE uid = v_uid FOR UPDATE;
  IF FOUND THEN
    IF v_current_kind <> 'pearl:' || v_kind THEN RAISE EXCEPTION 'kind conflict' USING ERRCODE = 'MNK01'; END IF;
    IF v_current_version <> v_expected OR v_current_holder IS DISTINCT FROM v_from THEN
      RAISE EXCEPTION 'unique conflict' USING ERRCODE = 'MNC01';
    END IF;
  ELSIF v_expected <> 0 THEN RAISE EXCEPTION 'missing unique' USING ERRCODE = 'MNC01';
  END IF;

  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'profiles') ORDER BY value->>'id'
  LOOP
    v_id := (v_p->>'id')::uuid; v_version := (v_p->>'expectedVersion')::integer;
    UPDATE public.mn_profiles SET data = v_p->'data', version = v_version + 1, updated_at = pg_catalog.now()
      WHERE player_id = v_id AND version = v_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01'; END IF;
    v_profiles := v_profiles || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', v_id, 'version', v_version + 1));
  END LOOP;
  IF v_current_version IS NULL THEN
    INSERT INTO public.mn_unique_items(uid, kind, holder, version, since)
      VALUES (v_uid, 'pearl:' || v_kind, v_to, 1, CASE WHEN v_to IS NULL THEN NULL ELSE pg_catalog.now() END)
      ON CONFLICT (uid) DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'concurrent unique creation' USING ERRCODE = 'MNC01'; END IF;
  ELSE
    UPDATE public.mn_unique_items SET holder = v_to, version = v_expected + 1,
      since = CASE WHEN v_to IS NULL THEN NULL ELSE pg_catalog.now() END WHERE uid = v_uid;
  END IF;
  PERFORM public.mn_assert_pearl_owner(v_uid);
  v_result := pg_catalog.jsonb_build_object('ok', true, 'replay', false, 'profiles', v_profiles, 'unique',
    pg_catalog.jsonb_build_object('uid', v_uid, 'kind', 'pearl:' || v_kind, 'holder', v_to, 'version', v_expected + 1));
  UPDATE public.mn_pearl_operations SET result = v_result WHERE operation_id = p_operation_id;
  RETURN v_result;
EXCEPTION
  -- The exception block rolls back profile/ledger/provisional receipt together before returning a fixed reason.
  WHEN SQLSTATE 'MNC01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  WHEN SQLSTATE 'MNK01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'kind');
  WHEN SQLSTATE 'MNP01' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'ownership');
  WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'operation');
END
$function$;

-- Preserve the P1 primitives for other unique types. Managed pearls require the atomic operation.
CREATE OR REPLACE FUNCTION public.mn_claim_unique(p_uid text, p_kind text, p_holder uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_version integer; v_kind text;
BEGIN
  IF p_kind LIKE 'pearl:%' THEN RAISE EXCEPTION 'atomic operation required' USING ERRCODE = 'MNP02'; END IF;
  IF p_uid IS NULL OR pg_catalog.btrim(p_uid) = '' OR pg_catalog.char_length(p_uid) > 160 OR
    p_kind IS NULL OR pg_catalog.btrim(p_kind) = '' OR pg_catalog.char_length(p_kind) > 100 OR p_holder IS NULL THEN
    RAISE EXCEPTION 'invalid unique claim arguments' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mn_unique_items AS item(uid, kind, holder, version, since)
    VALUES (p_uid, p_kind, p_holder, 1, pg_catalog.now()) ON CONFLICT (uid) DO UPDATE SET holder = EXCLUDED.holder,
      version = CASE WHEN item.holder IS NULL THEN item.version + 1 ELSE item.version END,
      since = CASE WHEN item.holder IS NULL THEN pg_catalog.now() ELSE item.since END
    WHERE item.kind = EXCLUDED.kind AND (item.holder IS NULL OR item.holder = EXCLUDED.holder)
    RETURNING item.version INTO v_version;
  IF v_version IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version); END IF;
  SELECT kind INTO v_kind FROM public.mn_unique_items WHERE uid = p_uid;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'why', CASE WHEN v_kind IS DISTINCT FROM p_kind THEN 'kind' ELSE 'occupied' END);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_release_unique(p_uid text, p_holder uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_version integer; v_kind text;
BEGIN
  IF p_uid IS NULL OR pg_catalog.btrim(p_uid) = '' OR pg_catalog.char_length(p_uid) > 160 OR
    p_holder IS NULL OR p_version IS NULL OR p_version <= 0 THEN
    RAISE EXCEPTION 'invalid unique release arguments' USING ERRCODE = '22023';
  END IF;
  SELECT kind INTO v_kind FROM public.mn_unique_items WHERE uid = p_uid;
  IF v_kind LIKE 'pearl:%' THEN RAISE EXCEPTION 'atomic operation required' USING ERRCODE = 'MNP02'; END IF;
  UPDATE public.mn_unique_items SET holder = NULL, since = NULL, version = version + 1
    WHERE uid = p_uid AND holder = p_holder AND version = p_version AND kind NOT LIKE 'pearl:%'
    RETURNING version INTO v_version;
  IF v_version IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict'); END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_profile_pearls(jsonb), public.mn_assert_pearl_owner(text),
  public.mn_lock_profile_pearl_keys(), public.mn_guard_profile_pearls(), public.mn_load_unique(text), public.mn_commit_pearl(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_profile_pearls(jsonb), public.mn_assert_pearl_owner(text),
  public.mn_lock_profile_pearl_keys(), public.mn_guard_profile_pearls(), public.mn_load_unique(text), public.mn_commit_pearl(uuid, jsonb) TO service_role;
COMMIT;

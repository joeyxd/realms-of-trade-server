-- Durable pearl locations. Apply after 001/002/003. This storage boundary does not activate gameplay.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_pearl_ground(p_ground jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE v_key text; v_value numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_ground) IS DISTINCT FROM 'object' OR
    NOT (p_ground ?& ARRAY['x','z','availableAt','returnAt']) THEN RETURN false; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_ground)) <> 4 THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['x','z','availableAt','returnAt'] LOOP
    IF pg_catalog.jsonb_typeof(p_ground->v_key) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v_value := (p_ground->>v_key)::numeric;
    IF v_key IN ('x','z') THEN
      IF pg_catalog.abs(v_value) > 1000000 THEN RETURN false; END IF;
    ELSIF v_value < 0 OR v_value > 9007199254740991 OR v_value <> pg_catalog.trunc(v_value) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN (p_ground->>'returnAt')::numeric > (p_ground->>'availableAt')::numeric;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_pearl_locations (
  uid text PRIMARY KEY REFERENCES public.mn_unique_items(uid) ON DELETE CASCADE
    CHECK (uid ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  world text NOT NULL CHECK (world ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  ground jsonb CHECK (ground IS NULL OR public.mn_valid_pearl_ground(ground)),
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS mn_pearl_ground_page ON public.mn_pearl_locations(world, uid COLLATE "C")
  WHERE ground IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.mn_pearl_ground_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  result jsonb CHECK (result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_pearl_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_pearl_ground_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_pearl_locations, public.mn_pearl_ground_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mn_pearl_locations, public.mn_pearl_ground_operations TO service_role;

-- UUIDs are shared by the 003 and 004 receipt families. The sole allowed overlap is the 003 child
-- operation while this wrapper's provisional receipt is still incomplete in the same transaction.
CREATE OR REPLACE FUNCTION public.mn_guard_pearl_operation_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported pearl isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text, 0));
  SELECT request, result INTO v_request, v_result FROM public.mn_pearl_ground_operations
    WHERE operation_id = NEW.operation_id;
  IF FOUND AND (v_result IS NOT NULL OR
    pg_catalog.jsonb_array_length(v_request->'profiles') = 0 OR
    NEW.request IS DISTINCT FROM (v_request - 'world' - 'ground')) THEN
    RAISE EXCEPTION 'pearl operation family mismatch' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_pearl_operation_family ON public.mn_pearl_operations;
CREATE TRIGGER mn_pearl_operation_family BEFORE INSERT ON public.mn_pearl_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_operation_family();

CREATE OR REPLACE FUNCTION public.mn_assert_pearl_location(p_uid text, p_require boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_unique public.mn_unique_items%ROWTYPE; v_location public.mn_pearl_locations%ROWTYPE;
BEGIN
  SELECT * INTO v_unique FROM public.mn_unique_items WHERE uid = p_uid;
  IF NOT FOUND THEN RETURN; END IF; -- A ledger deletion cascades its location for fixture/admin cleanup.
  SELECT * INTO v_location FROM public.mn_pearl_locations WHERE uid = p_uid;
  IF NOT FOUND THEN
    IF p_require THEN RAISE EXCEPTION 'missing pearl location' USING ERRCODE = 'MNP01'; END IF;
    RETURN; -- Historical 003-managed UIDs can remain untracked until a legitimate owner movement.
  END IF;
  IF v_unique.kind NOT IN ('pearl:brasa','pearl:escarcha','pearl:tormenta','pearl:tinta') OR
    v_unique.version <> v_location.version OR
    (v_unique.holder IS NULL) <> (v_location.ground IS NOT NULL) THEN
    RAISE EXCEPTION 'pearl location mismatch' USING ERRCODE = 'MNP01';
  END IF;
  PERFORM public.mn_assert_pearl_owner(p_uid);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_lock_pearl_location()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_uid text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported pearl isolation' USING ERRCODE = 'MNP02';
  END IF;
  IF TG_OP = 'DELETE' THEN v_uid := OLD.uid; ELSE v_uid := NEW.uid; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_uid, 0));
  IF TG_OP = 'UPDATE' AND (NEW.uid <> OLD.uid OR NEW.world <> OLD.world OR
    NEW.version::bigint <> OLD.version::bigint + 1) THEN
    RAISE EXCEPTION 'invalid pearl location transition' USING ERRCODE = 'MNP01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_pearl_location_lock ON public.mn_pearl_locations;
CREATE TRIGGER mn_pearl_location_lock BEFORE INSERT OR UPDATE OR DELETE ON public.mn_pearl_locations
  FOR EACH ROW EXECUTE FUNCTION public.mn_lock_pearl_location();

CREATE OR REPLACE FUNCTION public.mn_guard_pearl_location()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_uid text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_uid := OLD.uid; ELSE v_uid := NEW.uid; END IF;
  PERFORM public.mn_assert_pearl_location(v_uid, TG_TABLE_NAME = 'mn_pearl_locations');
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS mn_unique_pearl_location_guard ON public.mn_unique_items;
CREATE CONSTRAINT TRIGGER mn_unique_pearl_location_guard AFTER INSERT OR UPDATE OR DELETE ON public.mn_unique_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_location();
DROP TRIGGER IF EXISTS mn_pearl_location_guard ON public.mn_pearl_locations;
CREATE CONSTRAINT TRIGGER mn_pearl_location_guard AFTER INSERT OR UPDATE OR DELETE ON public.mn_pearl_locations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mn_guard_pearl_location();

CREATE OR REPLACE FUNCTION public.mn_commit_pearl_ground(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_uid text; v_kind text; v_world text; v_from uuid; v_to uuid; v_expected integer; v_ground jsonb;
  v_request jsonb; v_result jsonb; v_current public.mn_unique_items%ROWTYPE;
  v_location public.mn_pearl_locations%ROWTYPE; v_has_current boolean; v_has_location boolean;
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

  IF v_from IS NOT NULL OR v_to IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION public.mn_load_pearl_location(p_uid text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_uid IS NULL OR p_uid !~ '^[a-zA-Z0-9:_-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid ground UID' USING ERRCODE = 'MNP02';
  END IF;
  SELECT pg_catalog.jsonb_build_object('world', world, 'ground', ground, 'version', version)
    INTO v_result FROM public.mn_pearl_locations WHERE uid = p_uid;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_list_pearl_ground(p_world text, p_after_uid text, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    (p_after_uid IS NOT NULL AND p_after_uid !~ '^[a-zA-Z0-9:_-]{1,100}$') OR
    p_limit IS NULL OR p_limit < 1 OR p_limit > 256 THEN
    RAISE EXCEPTION 'invalid ground page' USING ERRCODE = 'MNP02';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(q.row ORDER BY q.uid COLLATE "C"), '[]'::jsonb) INTO v_result FROM (
    SELECT l.uid, pg_catalog.jsonb_build_object('uid', l.uid, 'kind', pg_catalog.substr(u.kind, 7),
      'world', l.world, 'ground', l.ground, 'version', l.version) AS row
    FROM public.mn_pearl_locations AS l JOIN public.mn_unique_items AS u ON u.uid = l.uid
    WHERE l.world = p_world AND l.ground IS NOT NULL AND
      (p_after_uid IS NULL OR l.uid COLLATE "C" > p_after_uid COLLATE "C")
    ORDER BY l.uid COLLATE "C" LIMIT p_limit
  ) AS q;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_pearl_ground_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid operation ID' USING ERRCODE = 'MNP02'; END IF;
  SELECT pg_catalog.jsonb_build_object('request', request, 'result', result) INTO v_result
    FROM public.mn_pearl_ground_operations WHERE operation_id = p_operation_id;
  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_pearl_ground(jsonb), public.mn_guard_pearl_operation_family(),
  public.mn_assert_pearl_location(text, boolean), public.mn_lock_pearl_location(), public.mn_guard_pearl_location(),
  public.mn_commit_pearl_ground(uuid, jsonb), public.mn_load_pearl_location(text),
  public.mn_list_pearl_ground(text, text, integer), public.mn_load_pearl_ground_operation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_pearl_ground(jsonb), public.mn_guard_pearl_operation_family(),
  public.mn_assert_pearl_location(text, boolean), public.mn_lock_pearl_location(), public.mn_guard_pearl_location(),
  public.mn_commit_pearl_ground(uuid, jsonb), public.mn_load_pearl_location(text),
  public.mn_list_pearl_ground(text, text, integer), public.mn_load_pearl_ground_operation(uuid) TO service_role;
COMMIT;

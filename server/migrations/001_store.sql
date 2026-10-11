-- M5 server-owned persistence primitives.
-- P2 auth.users/player foreign keys are intentionally out of scope: the trusted game server
-- supplies player IDs, and clients must never receive the service_role key.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_profiles (
  player_id uuid PRIMARY KEY,
  data jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (pg_catalog.jsonb_typeof(data) = 'object')
);

CREATE TABLE IF NOT EXISTS public.mn_worlds (
  world text PRIMARY KEY CHECK (pg_catalog.char_length(world) BETWEEN 1 AND 100 AND pg_catalog.btrim(world) <> ''),
  economy jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (pg_catalog.jsonb_typeof(economy) = 'object')
);

CREATE TABLE IF NOT EXISTS public.mn_unique_items (
  uid text PRIMARY KEY CHECK (pg_catalog.char_length(uid) BETWEEN 1 AND 160 AND pg_catalog.btrim(uid) <> ''),
  kind text NOT NULL CHECK (pg_catalog.char_length(kind) BETWEEN 1 AND 100 AND pg_catalog.btrim(kind) <> ''),
  holder uuid,
  version integer NOT NULL CHECK (version > 0),
  since timestamptz
);

COMMENT ON TABLE public.mn_profiles IS 'Server-owned player profile JSON with optimistic versioning.';
COMMENT ON TABLE public.mn_worlds IS 'Server-owned world economy snapshots with optimistic versioning.';
COMMENT ON TABLE public.mn_unique_items IS 'Authoritative unique-item ownership and generation ledger.';

ALTER TABLE public.mn_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_unique_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mn_profiles, public.mn_worlds, public.mn_unique_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mn_profiles, public.mn_worlds, public.mn_unique_items TO service_role;

CREATE OR REPLACE FUNCTION public.mn_load_profile(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_data jsonb;
  v_version integer;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'player ID is required' USING ERRCODE = '22023';
  END IF;
  SELECT data, version INTO v_data, v_version
  FROM public.mn_profiles WHERE player_id = p_player_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object('data', v_data, 'version', v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_profile(p_player_id uuid, p_data jsonb, p_expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_version integer;
BEGIN
  IF p_player_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid profile save arguments' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version = 0 THEN
    INSERT INTO public.mn_profiles (player_id, data, version, updated_at)
    VALUES (p_player_id, p_data, 1, pg_catalog.now())
    ON CONFLICT (player_id) DO NOTHING
    RETURNING version INTO v_version;
  ELSE
    UPDATE public.mn_profiles
    SET data = p_data, version = version + 1, updated_at = pg_catalog.now()
    WHERE player_id = p_player_id AND version = p_expected_version
    RETURNING version INTO v_version;
  END IF;

  IF v_version IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_world(p_world text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_data jsonb;
  v_version integer;
BEGIN
  IF p_world IS NULL OR pg_catalog.btrim(p_world) = '' OR pg_catalog.char_length(p_world) > 100 THEN
    RAISE EXCEPTION 'invalid world key' USING ERRCODE = '22023';
  END IF;
  SELECT economy, version INTO v_data, v_version
  FROM public.mn_worlds WHERE world = p_world;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object('data', v_data, 'version', v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_world(p_world text, p_data jsonb, p_expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_version integer;
BEGIN
  IF p_world IS NULL OR pg_catalog.btrim(p_world) = '' OR pg_catalog.char_length(p_world) > 100
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid world save arguments' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version = 0 THEN
    INSERT INTO public.mn_worlds (world, economy, version, updated_at)
    VALUES (p_world, p_data, 1, pg_catalog.now())
    ON CONFLICT (world) DO NOTHING
    RETURNING version INTO v_version;
  ELSE
    UPDATE public.mn_worlds
    SET economy = p_data, version = version + 1, updated_at = pg_catalog.now()
    WHERE world = p_world AND version = p_expected_version
    RETURNING version INTO v_version;
  END IF;

  IF v_version IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_claim_unique(p_uid text, p_kind text, p_holder uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_version integer;
  v_kind text;
BEGIN
  IF p_uid IS NULL OR pg_catalog.btrim(p_uid) = '' OR pg_catalog.char_length(p_uid) > 160
     OR p_kind IS NULL OR pg_catalog.btrim(p_kind) = '' OR pg_catalog.char_length(p_kind) > 100
     OR p_holder IS NULL THEN
    RAISE EXCEPTION 'invalid unique claim arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mn_unique_items AS item (uid, kind, holder, version, since)
  VALUES (p_uid, p_kind, p_holder, 1, pg_catalog.now())
  ON CONFLICT (uid) DO UPDATE
  SET holder = EXCLUDED.holder,
      version = CASE WHEN item.holder IS NULL THEN item.version + 1 ELSE item.version END,
      since = CASE WHEN item.holder IS NULL THEN pg_catalog.now() ELSE item.since END
  WHERE item.kind = EXCLUDED.kind AND (item.holder IS NULL OR item.holder = EXCLUDED.holder)
  RETURNING item.version INTO v_version;

  IF v_version IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version);
  END IF;

  SELECT kind INTO v_kind FROM public.mn_unique_items WHERE uid = p_uid;
  IF v_kind IS DISTINCT FROM p_kind THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'kind');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'occupied');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_release_unique(p_uid text, p_holder uuid, p_version integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_version integer;
BEGIN
  IF p_uid IS NULL OR pg_catalog.btrim(p_uid) = '' OR pg_catalog.char_length(p_uid) > 160
     OR p_holder IS NULL OR p_version IS NULL OR p_version <= 0 THEN
    RAISE EXCEPTION 'invalid unique release arguments' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mn_unique_items
  SET holder = NULL, since = NULL, version = version + 1
  WHERE uid = p_uid AND holder = p_holder AND version = p_version
  RETURNING version INTO v_version;

  IF v_version IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_load_profile(uuid),
  public.mn_save_profile(uuid, jsonb, integer),
  public.mn_load_world(text),
  public.mn_save_world(text, jsonb, integer),
  public.mn_claim_unique(text, text, uuid),
  public.mn_release_unique(text, uuid, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mn_load_profile(uuid),
  public.mn_save_profile(uuid, jsonb, integer),
  public.mn_load_world(text),
  public.mn_save_world(text, jsonb, integer),
  public.mn_claim_unique(text, text, uuid),
  public.mn_release_unique(text, uuid, integer)
TO service_role;

COMMIT;

-- P2 signed-save import receipts. The trusted game server supplies verified player IDs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_legacy_imports (
  legacy_key text PRIMARY KEY CHECK (legacy_key ~ '^[0-9a-f]{64}$'),
  player_id uuid NOT NULL REFERENCES public.mn_profiles(player_id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

COMMENT ON TABLE public.mn_legacy_imports IS 'One-time receipts for importing a signed legacy profile.';

ALTER TABLE public.mn_legacy_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_legacy_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mn_legacy_imports TO service_role;

CREATE OR REPLACE FUNCTION public.mn_initialize_profile(p_player_id uuid, p_data jsonb, p_legacy_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_data jsonb;
  v_version integer;
  v_claimed_player uuid;
BEGIN
  IF p_player_id IS NULL
     OR p_data IS NULL
     OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object'
     OR p_data ->> 'v' IS DISTINCT FROM '1'
     OR (p_legacy_key IS NOT NULL AND p_legacy_key !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid profile initialization arguments' USING ERRCODE = '22023';
  END IF;

  -- All calls lock account identity before the optional legacy receipt, in one fixed order.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('player:' || p_player_id::text, 0));

  SELECT data, version INTO v_data, v_version
  FROM public.mn_profiles WHERE player_id = p_player_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('data', v_data, 'version', v_version);
  END IF;

  IF p_legacy_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('legacy:' || p_legacy_key, 0));
    SELECT player_id INTO v_claimed_player
    FROM public.mn_legacy_imports WHERE legacy_key = p_legacy_key;
    IF FOUND AND v_claimed_player IS DISTINCT FROM p_player_id THEN
      RAISE EXCEPTION 'legacy import already claimed' USING ERRCODE = 'MNL01';
    END IF;
  END IF;

  INSERT INTO public.mn_profiles (player_id, data, version, updated_at)
  VALUES (p_player_id, p_data, 1, pg_catalog.now());

  IF p_legacy_key IS NOT NULL THEN
    INSERT INTO public.mn_legacy_imports (legacy_key, player_id)
    VALUES (p_legacy_key, p_player_id)
    ON CONFLICT (legacy_key) DO NOTHING;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'legacy import already claimed' USING ERRCODE = 'MNL01';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('data', p_data, 'version', 1);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_legacy_claimed(p_legacy_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_legacy_key IS NULL OR p_legacy_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid legacy import key' USING ERRCODE = '22023';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.mn_legacy_imports WHERE legacy_key = p_legacy_key);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_initialize_profile(uuid, jsonb, text),
  public.mn_legacy_claimed(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mn_initialize_profile(uuid, jsonb, text),
  public.mn_legacy_claimed(text)
TO service_role;

COMMIT;

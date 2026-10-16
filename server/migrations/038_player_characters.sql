-- SQL038: immutable account-owned roster over existing server-owned character profiles.
-- Character profile JSON remains unchanged; the authenticated owner UUID is trusted server input.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_player_characters (
  owner_id uuid NOT NULL,
  character_id uuid NOT NULL REFERENCES public.mn_profiles(player_id) ON DELETE RESTRICT,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 2),
  name text NOT NULL CHECK (pg_catalog.char_length(name) BETWEEN 1 AND 16 AND pg_catalog.btrim(name) <> ''
    AND name !~ '[[:cntrl:]<>]'),
  skin smallint NOT NULL CHECK (skin BETWEEN 0 AND 4),
  weapon smallint NOT NULL CHECK (weapon IN (0, 1) AND weapon = CASE WHEN skin = 2 THEN 1 ELSE 0 END),
  PRIMARY KEY (owner_id, character_id),
  UNIQUE (owner_id, slot),
  UNIQUE (character_id),
  CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CHECK (character_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE IF NOT EXISTS public.mn_player_character_selected (
  owner_id uuid PRIMARY KEY CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  character_id uuid NOT NULL,
  FOREIGN KEY (owner_id, character_id)
    REFERENCES public.mn_player_characters(owner_id, character_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.mn_player_character_requests (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  legacy_key text CHECK (legacy_key IS NULL OR legacy_key ~ '^[0-9a-f]{64}$'),
  character_id uuid NOT NULL,
  PRIMARY KEY (owner_id, request_id),
  CHECK ((request->>'mode' = 'import') = (legacy_key IS NOT NULL)),
  FOREIGN KEY (owner_id, character_id)
    REFERENCES public.mn_player_characters(owner_id, character_id) ON DELETE RESTRICT
);

ALTER TABLE public.mn_player_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_player_character_selected ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_player_character_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_player_characters, public.mn_player_character_selected,
  public.mn_player_character_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_player_characters_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  RAISE EXCEPTION 'player character roster is immutable' USING ERRCODE = 'PCS08';
END $f$;

DROP TRIGGER IF EXISTS mn_player_characters_immutable ON public.mn_player_characters;
CREATE TRIGGER mn_player_characters_immutable
  BEFORE UPDATE OR DELETE ON public.mn_player_characters
  FOR EACH ROW EXECUTE FUNCTION public.mn_player_characters_immutable();

CREATE OR REPLACE FUNCTION public.mn_player_character_profile_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  -- Serialize with account profile initialization; once a roster owns child profiles,
  -- an older account-only initializer must not create a phantom legacy slot.
  -- mn_initialize_profile and the roster RPC already hold this account-key lock.
  IF EXISTS (SELECT 1 FROM public.mn_player_characters c
      WHERE c.owner_id = NEW.player_id AND c.character_id <> c.owner_id) THEN
    RAISE EXCEPTION 'account already owns character slots' USING ERRCODE = 'PCS10';
  END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS mn_player_character_profile_insert_guard ON public.mn_profiles;
CREATE TRIGGER mn_player_character_profile_insert_guard
  BEFORE INSERT ON public.mn_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mn_player_character_profile_insert_guard();

DROP TRIGGER IF EXISTS mn_player_character_requests_immutable ON public.mn_player_character_requests;
CREATE TRIGGER mn_player_character_requests_immutable
  BEFORE UPDATE OR DELETE ON public.mn_player_character_requests
  FOR EACH ROW EXECUTE FUNCTION public.mn_player_characters_immutable();

CREATE OR REPLACE FUNCTION public.mn_player_characters_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_required text[] := ARRAY[
    'public.mn_player_characters_ready()',
    'public.mn_list_player_characters(uuid)',
    'public.mn_create_player_character(uuid,uuid,jsonb,jsonb,text)',
    'public.mn_select_player_character(uuid,uuid)'
  ];
  v_signature text;
  v_table text;
  v_role text;
  v_privilege text;
BEGIN
  IF pg_catalog.to_regclass('public.mn_profiles') IS NULL OR
     pg_catalog.to_regclass('public.mn_player_characters') IS NULL OR
     pg_catalog.to_regclass('public.mn_player_character_selected') IS NULL OR
     pg_catalog.to_regclass('public.mn_player_character_requests') IS NULL OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass('public.mn_player_characters')) OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass('public.mn_player_character_selected')) OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = pg_catalog.to_regclass('public.mn_player_character_requests')) THEN
    RETURN pg_catalog.jsonb_build_object('version', 0);
  END IF;
  FOREACH v_signature IN ARRAY v_required LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NULL OR
       NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') OR
       pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') OR
       pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') OR
       NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']::text[]
         FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(v_signature)) THEN
      RETURN pg_catalog.jsonb_build_object('version', 0);
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['public.mn_player_characters', 'public.mn_player_character_selected',
      'public.mn_player_character_requests'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
          RETURN pg_catalog.jsonb_build_object('version', 0);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = pg_catalog.to_regclass('public.mn_player_characters')
      AND t.tgname = 'mn_player_characters_immutable' AND t.tgenabled <> 'D') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = pg_catalog.to_regclass('public.mn_player_character_requests')
      AND t.tgname = 'mn_player_character_requests_immutable' AND t.tgenabled <> 'D') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = pg_catalog.to_regclass('public.mn_profiles')
      AND t.tgname = 'mn_player_character_profile_insert_guard' AND t.tgenabled <> 'D') THEN
    RETURN pg_catalog.jsonb_build_object('version', 0);
  END IF;
  FOREACH v_signature IN ARRAY ARRAY['public.mn_player_characters_immutable()',
      'public.mn_player_character_profile_insert_guard()'] LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NULL OR
       NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']::text[]
         FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(v_signature)) OR
       pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') OR
       pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') OR
       pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RETURN pg_catalog.jsonb_build_object('version', 0);
    END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('version', 1);
END $f$;

CREATE OR REPLACE FUNCTION public.mn_list_player_characters(p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_characters jsonb;
  v_legacy boolean;
BEGIN
  IF p_owner IS NULL OR p_owner = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'invalid player character owner' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', c.character_id, 'slot', c.slot, 'name', c.name, 'skin', c.skin, 'weapon', c.weapon,
      'lastPlayed', (s.character_id = c.character_id)) ORDER BY c.slot), '[]'::jsonb)
    INTO v_characters
    FROM public.mn_player_characters c
    LEFT JOIN public.mn_player_character_selected s ON s.owner_id = c.owner_id
    WHERE c.owner_id = p_owner;
  SELECT EXISTS (SELECT 1 FROM public.mn_profiles p WHERE p.player_id = p_owner)
       AND NOT EXISTS (SELECT 1 FROM public.mn_player_characters c
         WHERE c.owner_id = p_owner AND c.character_id = p_owner)
    INTO v_legacy;
  RETURN pg_catalog.jsonb_build_object('characters', v_characters, 'legacy', v_legacy);
END $f$;

CREATE OR REPLACE FUNCTION public.mn_create_player_character(
  p_owner uuid, p_character_id uuid, p_request jsonb, p_profile jsonb, p_legacy_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_request_id uuid;
  v_prior jsonb;
  v_prior_key text;
  v_prior_character uuid;
  v_mode text;
  v_name text;
  v_skin integer;
  v_weapon integer;
  v_count integer;
  v_slot integer;
  v_insert jsonb;
  v_character jsonb;
  v_request_keys integer;
BEGIN
  IF p_request IS NOT NULL AND pg_catalog.jsonb_typeof(p_request) = 'object' THEN
    SELECT pg_catalog.count(*) INTO v_request_keys FROM pg_catalog.jsonb_object_keys(p_request) AS fields(key);
  ELSE
    v_request_keys := 0;
  END IF;
  IF p_owner IS NULL OR p_owner = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_character_id IS NULL OR p_character_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR v_request_keys <> 5 OR
     NOT (p_request ?& ARRAY['requestId','name','skin','weapon','mode']) OR
     pg_catalog.jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string' OR
     (p_request->>'requestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     (p_request->>'requestId') = '00000000-0000-0000-0000-000000000000' OR
     pg_catalog.jsonb_typeof(p_request->'name') IS DISTINCT FROM 'string' OR
     pg_catalog.char_length(p_request->>'name') NOT BETWEEN 1 AND 16 OR
     pg_catalog.btrim(p_request->>'name') = '' OR (p_request->>'name') ~ '[[:cntrl:]<>]' OR
     pg_catalog.jsonb_typeof(p_request->'skin') IS DISTINCT FROM 'number' OR
     (p_request->>'skin') !~ '^[0-4]$' OR
     pg_catalog.jsonb_typeof(p_request->'weapon') IS DISTINCT FROM 'number' OR
     (p_request->>'weapon') !~ '^[01]$' OR
     pg_catalog.jsonb_typeof(p_request->'mode') IS DISTINCT FROM 'string' OR
     p_request->>'mode' NOT IN ('new','legacy','import') THEN
    RAISE EXCEPTION 'invalid player character creation' USING ERRCODE = '22023';
  END IF;
  v_request_id := (p_request->>'requestId')::uuid;
  v_mode := p_request->>'mode'; v_name := p_request->>'name';
  v_skin := (p_request->>'skin')::integer; v_weapon := (p_request->>'weapon')::integer;
  IF v_weapon <> (CASE WHEN v_skin = 2 THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'invalid player character weapon' USING ERRCODE = '22023';
  END IF;
  IF (v_mode = 'legacy' AND (p_profile IS NOT NULL OR p_legacy_key IS NOT NULL OR p_character_id <> p_owner)) OR
     (v_mode = 'import' AND (p_profile IS NULL OR p_legacy_key IS NULL OR p_character_id <> p_owner)) OR
     (v_mode = 'new' AND (p_profile IS NULL OR p_legacy_key IS NOT NULL OR p_character_id = p_owner)) OR
     (v_mode <> 'legacy' AND (pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR p_profile->>'v' IS DISTINCT FROM '1' OR
       p_profile->>'pirateId' IS DISTINCT FROM 'account:' || p_character_id::text)) OR
     (v_mode = 'import' AND p_legacy_key !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid player character profile or mode' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('player:' || p_owner::text, 0));
  SELECT request, legacy_key, character_id INTO v_prior, v_prior_key, v_prior_character FROM public.mn_player_character_requests
    WHERE owner_id = p_owner AND request_id = v_request_id;
  IF FOUND THEN
    IF v_prior IS DISTINCT FROM p_request OR v_prior_key IS DISTINCT FROM p_legacy_key THEN
      RAISE EXCEPTION 'player character request reused' USING ERRCODE = 'PCS02';
    END IF;
    SELECT pg_catalog.jsonb_build_object('id', c.character_id, 'slot', c.slot, 'name', c.name,
        'skin', c.skin, 'weapon', c.weapon, 'lastPlayed', (s.character_id = c.character_id))
      INTO v_character FROM public.mn_player_characters c
      LEFT JOIN public.mn_player_character_selected s ON s.owner_id = c.owner_id
      WHERE c.owner_id = p_owner AND c.character_id = v_prior_character;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', true, 'character', v_character);
  END IF;

  SELECT pg_catalog.count(*) INTO v_count FROM public.mn_player_characters WHERE owner_id = p_owner;
  IF v_count >= 3 THEN RAISE EXCEPTION 'player character slots full' USING ERRCODE = 'PCS01'; END IF;
  IF EXISTS (SELECT 1 FROM public.mn_profiles p WHERE p.player_id = p_owner) AND
     NOT EXISTS (SELECT 1 FROM public.mn_player_characters c WHERE c.owner_id = p_owner AND c.character_id = p_owner) AND
     v_mode = 'new' THEN
    RAISE EXCEPTION 'register legacy character first' USING ERRCODE = 'PCS03';
  END IF;

  IF v_mode = 'legacy' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mn_profiles p WHERE p.player_id = p_owner) THEN
      RAISE EXCEPTION 'legacy profile missing' USING ERRCODE = 'PCS04';
    END IF;
    IF EXISTS (SELECT 1 FROM public.mn_player_characters c WHERE c.character_id = p_owner) THEN
      RAISE EXCEPTION 'legacy character already registered' USING ERRCODE = 'PCS06';
    END IF;
    v_slot := 0;
  ELSIF v_mode = 'import' THEN
    IF v_count <> 0 OR EXISTS (SELECT 1 FROM public.mn_profiles p WHERE p.player_id = p_owner) THEN
      RAISE EXCEPTION 'import requires an empty account' USING ERRCODE = 'PCS06';
    END IF;
    v_slot := 0;
    BEGIN
      v_insert := public.mn_initialize_profile(p_owner, p_profile, p_legacy_key);
    EXCEPTION WHEN SQLSTATE 'MNL01' THEN
      RAISE EXCEPTION 'legacy profile already claimed' USING ERRCODE = 'PCS05';
    END;
    IF v_insert IS NULL OR v_insert->>'version' IS DISTINCT FROM '1' OR v_insert->'data' IS DISTINCT FROM p_profile THEN
      RAISE EXCEPTION 'profile initialization mismatch' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT n INTO v_slot FROM pg_catalog.generate_series(0, 2) AS slots(n)
      WHERE NOT EXISTS (SELECT 1 FROM public.mn_player_characters c WHERE c.owner_id = p_owner AND c.slot = n)
      ORDER BY n LIMIT 1;
    IF v_slot IS NULL THEN RAISE EXCEPTION 'player character slots full' USING ERRCODE = 'PCS01'; END IF;
    IF EXISTS (SELECT 1 FROM public.mn_profiles p WHERE p.player_id = p_character_id) THEN
      RAISE EXCEPTION 'character profile already exists' USING ERRCODE = 'PCS06';
    END IF;
    v_insert := public.mn_initialize_profile(p_character_id, p_profile, NULL);
    IF v_insert IS NULL OR v_insert->>'version' IS DISTINCT FROM '1' OR v_insert->'data' IS DISTINCT FROM p_profile THEN
      RAISE EXCEPTION 'profile initialization mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.mn_player_characters c WHERE c.owner_id = p_owner AND c.slot = v_slot) THEN
    RAISE EXCEPTION 'player character slot conflict' USING ERRCODE = 'PCS06';
  END IF;
  INSERT INTO public.mn_player_characters(owner_id, character_id, slot, name, skin, weapon)
    VALUES (p_owner, p_character_id, v_slot, v_name, v_skin, v_weapon);
  INSERT INTO public.mn_player_character_selected(owner_id, character_id) VALUES (p_owner, p_character_id)
    ON CONFLICT (owner_id) DO UPDATE SET character_id = EXCLUDED.character_id;
  INSERT INTO public.mn_player_character_requests(owner_id, request_id, request, legacy_key, character_id)
    VALUES (p_owner, v_request_id, p_request, p_legacy_key, p_character_id);
  v_character := pg_catalog.jsonb_build_object('id', p_character_id, 'slot', v_slot, 'name', v_name,
    'skin', v_skin, 'weapon', v_weapon, 'lastPlayed', true);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', false, 'character', v_character);
END $f$;

CREATE OR REPLACE FUNCTION public.mn_select_player_character(p_owner uuid, p_character_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_character jsonb;
BEGIN
  IF p_owner IS NULL OR p_owner = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_character_id IS NULL OR p_character_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'invalid player character selection' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-player-character:' || p_owner::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.mn_player_characters c WHERE c.owner_id = p_owner AND c.character_id = p_character_id) THEN
    RAISE EXCEPTION 'player character not owned' USING ERRCODE = 'PCS07';
  END IF;
  INSERT INTO public.mn_player_character_selected(owner_id, character_id) VALUES (p_owner, p_character_id)
    ON CONFLICT (owner_id) DO UPDATE SET character_id = EXCLUDED.character_id;
  SELECT pg_catalog.jsonb_build_object('id', c.character_id, 'slot', c.slot, 'name', c.name,
      'skin', c.skin, 'weapon', c.weapon, 'lastPlayed', true)
    INTO v_character FROM public.mn_player_characters c
    WHERE c.owner_id = p_owner AND c.character_id = p_character_id;
  RETURN v_character;
END $f$;

REVOKE ALL ON FUNCTION public.mn_player_characters_immutable(),
  public.mn_player_character_profile_insert_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mn_player_characters_ready(),
  public.mn_list_player_characters(uuid),
  public.mn_create_player_character(uuid,uuid,jsonb,jsonb,text),
  public.mn_select_player_character(uuid,uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_player_characters_ready(),
  public.mn_list_player_characters(uuid),
  public.mn_create_player_character(uuid,uuid,jsonb,jsonb,text),
  public.mn_select_player_character(uuid,uuid)
TO service_role;

COMMIT;

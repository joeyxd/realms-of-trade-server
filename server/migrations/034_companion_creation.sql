-- Durable identity and initial documents for one prepared companion per account and world.
-- Creation never creates a gameplay profile or a runner grant.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_companion_creation_preset(p_preset jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_trait jsonb;
  v_traits text[] := ARRAY[]::text[];
  v_name text;
  v_trim_chars text := ' '||pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(13)||pg_catalog.chr(160)||
    pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||
    pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||
    pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||
    pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279);
  v_units integer := 0;
  v_index integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_preset) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_preset)) <> 6 OR
     NOT (p_preset ?& ARRAY['v','name','role','personality','traits','skin']) OR
     pg_catalog.jsonb_typeof(p_preset->'v') IS DISTINCT FROM 'number' OR p_preset->>'v' IS DISTINCT FROM '1' OR
     pg_catalog.jsonb_typeof(p_preset->'name') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(p_preset->'role') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(p_preset->'personality') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(p_preset->'traits') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(p_preset->'skin') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;
  v_name := p_preset->>'name';
  IF v_name = '' OR pg_catalog.btrim(v_name,v_trim_chars) <> v_name OR
     pg_catalog.regexp_replace(v_name,'[[:space:]]+',' ','g') <> v_name OR
     normalize(v_name,NFC) <> v_name OR pg_catalog.octet_length(v_name) > 64 OR
     v_name ~ '[[:cntrl:]]|[<>]' OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8203))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8204))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8205))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8206))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8207))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8232))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8233))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8234))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8235))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8236))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8237))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8238))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8288))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8289))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8290))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8291))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8292))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8293))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8294))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8295))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(8296))>0 OR pg_catalog.strpos(v_name,pg_catalog.chr(8297))>0 OR
     pg_catalog.strpos(v_name,pg_catalog.chr(65279))>0 OR
     v_name ~* '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\y(api[_-]?key|access[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]+|\yBearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|\ysk-[A-Za-z0-9_-]{16,}' OR
     p_preset->>'role' NOT IN ('sailor','marine','builder','harvester','resident') OR
     p_preset->>'personality' NOT IN ('warm','calm','curious','direct','playful') OR
     (p_preset->>'skin')::numeric <> pg_catalog.trunc((p_preset->>'skin')::numeric) OR
     (p_preset->>'skin')::integer NOT BETWEEN 0 AND 4 OR
     pg_catalog.jsonb_array_length(p_preset->'traits') > 3 THEN
    RETURN false;
  END IF;
  FOR v_index IN 1..pg_catalog.char_length(v_name) LOOP
    v_units := v_units + CASE WHEN pg_catalog.octet_length(pg_catalog.substr(v_name,v_index,1))=4 THEN 2 ELSE 1 END;
  END LOOP;
  IF v_units > 16 THEN RETURN false; END IF;
  FOR v_trait IN SELECT value FROM pg_catalog.jsonb_array_elements(p_preset->'traits') LOOP
    IF pg_catalog.jsonb_typeof(v_trait) IS DISTINCT FROM 'string' OR
       v_trait #>> '{}' NOT IN ('curious','prudent','kind','brave','patient','resourceful','sociable','steadfast') OR
       v_trait #>> '{}' = ANY(v_traits) THEN
      RETURN false;
    END IF;
    v_traits := pg_catalog.array_append(v_traits, v_trait #>> '{}');
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_companion_creations (
  world text NOT NULL,
  owner_id uuid NOT NULL,
  character_id uuid NOT NULL,
  creation_id uuid NOT NULL,
  preset jsonb NOT NULL,
  initial_config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT mn_companion_creations_pkey PRIMARY KEY (world, owner_id),
  CONSTRAINT mn_companion_creations_character_uq UNIQUE (character_id),
  CONSTRAINT mn_companion_creations_scope_uq UNIQUE (world, owner_id, character_id),
  CONSTRAINT mn_companion_creations_world_ck CHECK (world ~ '^[A-Za-z0-9:_-]{1,100}$'),
  CONSTRAINT mn_companion_creations_owner_ck CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_companion_creations_character_ck CHECK (
    character_id <> '00000000-0000-0000-0000-000000000000'::uuid AND character_id <> owner_id),
  CONSTRAINT mn_companion_creations_request_ck CHECK (creation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_companion_creations_preset_ck CHECK (public.mn_valid_companion_creation_preset(preset)),
  CONSTRAINT mn_companion_creations_config_ck CHECK (public.mn_valid_companion_config(initial_config)),
  CONSTRAINT mn_companion_creations_created_at_ck CHECK (
    created_at > '-infinity'::timestamptz AND created_at < 'infinity'::timestamptz)
);
ALTER TABLE public.mn_companion_creations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_companion_creations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_companion_creation_scope_valid(p_world text,p_owner uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT p_world IS NOT NULL AND p_world ~ '^[A-Za-z0-9:_-]{1,100}$' AND
    p_owner IS NOT NULL AND p_owner <> '00000000-0000-0000-0000-000000000000'::uuid
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_creation_record(
  p_world text,p_owner uuid,p_character uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'characterKey',c.character_id,'creationId',c.creation_id,'preset',c.preset,'createdAt',c.created_at,
    'configuration',pg_catalog.jsonb_build_object('revision',cfg.revision,'config',cfg.config,'savedAt',cfg.saved_at),
    'control',pg_catalog.jsonb_build_object('revision',ctl.revision,'stopped',ctl.stopped,'savedAt',ctl.saved_at))
  FROM public.mn_companion_creations c
  JOIN public.mn_companion_configs cfg USING (world,owner_id,character_id)
  JOIN public.mn_companion_controls ctl USING (world,owner_id,character_id)
  WHERE c.world=p_world AND c.owner_id=p_owner AND c.character_id=p_character
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_companion_creation(p_world text,p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_character uuid;
BEGIN
  IF NOT public.mn_companion_creation_scope_valid(p_world,p_owner) THEN
    RAISE EXCEPTION 'invalid companion creation scope' USING ERRCODE = 'CCN01';
  END IF;
  SELECT character_id INTO v_character FROM public.mn_companion_creations
    WHERE world=p_world AND owner_id=p_owner;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mn_companion_configs WHERE world=p_world AND owner_id=p_owner AND character_id=v_character) OR
     NOT EXISTS (SELECT 1 FROM public.mn_companion_controls WHERE world=p_world AND owner_id=p_owner AND character_id=v_character) THEN
    RAISE EXCEPTION 'companion creation rows incomplete' USING ERRCODE = 'CCN04';
  END IF;
  RETURN public.mn_companion_creation_record(p_world,p_owner,v_character);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_create_companion(
  p_world text,p_owner uuid,p_creation_id uuid,p_preset jsonb,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_row public.mn_companion_creations%ROWTYPE;
  v_character uuid;
  v_id_in_profiles boolean;
  v_id_in_auth boolean;
  v_record jsonb;
  v_attempt integer := 0;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     NOT public.mn_companion_creation_scope_valid(p_world,p_owner) OR
     p_creation_id IS NULL OR p_creation_id='00000000-0000-0000-0000-000000000000'::uuid OR
     NOT public.mn_valid_companion_creation_preset(p_preset) OR
     NOT public.mn_valid_companion_config(p_config) THEN
    RAISE EXCEPTION 'invalid companion creation' USING ERRCODE = 'CCN01';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_companion_creations WHERE character_id=p_owner) THEN
    RAISE EXCEPTION 'companion identity cannot be an owner' USING ERRCODE = 'CCN01';
  END IF;

  -- A global lock also fences character IDs against owner IDs in other worlds.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-companion-create',0));
  IF EXISTS (SELECT 1 FROM public.mn_companion_creations WHERE character_id=p_owner) THEN
    RAISE EXCEPTION 'companion identity cannot be an owner' USING ERRCODE = 'CCN01';
  END IF;
  SELECT * INTO v_row FROM public.mn_companion_creations WHERE world=p_world AND owner_id=p_owner;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.mn_companion_configs WHERE world=p_world AND owner_id=p_owner AND character_id=v_row.character_id) OR
       NOT EXISTS (SELECT 1 FROM public.mn_companion_controls WHERE world=p_world AND owner_id=p_owner AND character_id=v_row.character_id) THEN
      RAISE EXCEPTION 'companion creation rows incomplete' USING ERRCODE = 'CCN04';
    END IF;
    IF v_row.creation_id=p_creation_id AND v_row.preset=p_preset AND v_row.initial_config=p_config THEN
      v_record := public.mn_companion_creation_record(p_world,p_owner,v_row.character_id);
      RETURN pg_catalog.jsonb_build_object('ok',true,'replay',true,'record',v_record);
    END IF;
    v_record := public.mn_companion_creation_record(p_world,p_owner,v_row.character_id);
    RETURN pg_catalog.jsonb_build_object('ok',false,
      'why',CASE WHEN v_row.creation_id=p_creation_id THEN 'conflict' ELSE 'limit' END,'record',v_record);
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.mn_companion_creations WHERE world=p_world) >= 64 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','limit','record',NULL);
  END IF;

  LOOP
    v_character := pg_catalog.gen_random_uuid();
    v_attempt := v_attempt+1;
    IF v_character=p_owner OR EXISTS (SELECT 1 FROM public.mn_companion_creations WHERE character_id=v_character) OR
       EXISTS (SELECT 1 FROM public.mn_companion_creations WHERE owner_id=v_character) THEN
      IF v_attempt >= 8 THEN RAISE EXCEPTION 'companion identity collision' USING ERRCODE = 'CCN04'; END IF;
      CONTINUE;
    END IF;
    v_id_in_profiles := false;
    IF pg_catalog.to_regclass('public.mn_profiles') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.mn_profiles WHERE player_id=$1)' INTO v_id_in_profiles USING v_character;
    END IF;
    v_id_in_auth := false;
    IF pg_catalog.to_regclass('auth.users') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.users WHERE id=$1)' INTO v_id_in_auth USING v_character;
    END IF;
    IF v_id_in_profiles OR v_id_in_auth THEN
      IF v_attempt >= 8 THEN RAISE EXCEPTION 'companion identity collision' USING ERRCODE = 'CCN04'; END IF;
      CONTINUE;
    END IF;
    EXIT;
  END LOOP;

  INSERT INTO public.mn_companion_creations(world,owner_id,character_id,creation_id,preset,initial_config)
    VALUES(p_world,p_owner,v_character,p_creation_id,p_preset,p_config);
  INSERT INTO public.mn_companion_configs(world,owner_id,character_id,revision,config,saved_at)
    VALUES(p_world,p_owner,v_character,1,p_config,pg_catalog.now());
  INSERT INTO public.mn_companion_controls(world,owner_id,character_id,revision,stopped,saved_at)
    VALUES(p_world,p_owner,v_character,1,true,pg_catalog.now());
  v_record := public.mn_companion_creation_record(p_world,p_owner,v_character);
  IF v_record IS NULL THEN RAISE EXCEPTION 'companion creation rows incomplete' USING ERRCODE = 'CCN04'; END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replay',false,'record',v_record);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_creation_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_table oid := pg_catalog.to_regclass('public.mn_companion_creations');
BEGIN
  IF v_table IS NULL OR
    NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype='p' AND
      pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (world, owner_id)') OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attnum>0 AND NOT a.attisdropped) <> 7 OR
    EXISTS (SELECT 1 FROM (VALUES ('world','text'),('owner_id','uuid'),('character_id','uuid'),('creation_id','uuid'),
        ('preset','jsonb'),('initial_config','jsonb'),('created_at','timestamp with time zone')) AS expected(name,type_name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_table AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attname IS NULL OR NOT a.attnotnull OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.type_name) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype IN ('p','u','c')) <> 10 OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_character_uq' AND convalidated AND pg_catalog.pg_get_constraintdef(oid)='UNIQUE (character_id)') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_scope_uq' AND convalidated AND pg_catalog.pg_get_constraintdef(oid)='UNIQUE (world, owner_id, character_id)') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_world_ck' AND convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_owner_ck' AND convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_character_ck' AND convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_request_ck' AND convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_preset_ck' AND convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_config_ck' AND convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_table AND conname='mn_companion_creations_created_at_ck' AND convalidated) OR
    pg_catalog.has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    EXISTS (SELECT 1 FROM (VALUES ('service_role'),('anon'),('authenticated')) AS roles(role_name)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) AS privileges(privilege_name)
      WHERE pg_catalog.has_any_column_privilege(roles.role_name,v_table,privileges.privilege_name)) OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_companion_creation_ready()','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_companion_creation(text,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_create_companion(text,uuid,uuid,jsonb,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_creation_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_creation_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_load_companion_creation(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_load_companion_creation(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_create_companion(text,uuid,uuid,jsonb,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_create_companion(text,uuid,uuid,jsonb,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_valid_companion_creation_preset(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_valid_companion_creation_preset(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_valid_companion_creation_preset(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_creation_scope_valid(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_creation_scope_valid(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_companion_creation_scope_valid(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_creation_record(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_creation_record(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_companion_creation_record(text,uuid,uuid)','EXECUTE') OR
    (public.mn_companion_config_ready()->>'version') IS DISTINCT FROM '1' OR
    (public.mn_companion_control_ready()->>'version') IS DISTINCT FROM '1' OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_creation_ready()'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_load_companion_creation(text,uuid)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_create_companion(text,uuid,uuid,jsonb,jsonb)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_creation_scope_valid(text,uuid)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_creation_record(text,uuid,uuid)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_valid_companion_creation_preset(jsonb)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_companion_creation_preset(jsonb),
  public.mn_companion_creation_scope_valid(text,uuid),public.mn_companion_creation_record(text,uuid,uuid),
  public.mn_load_companion_creation(text,uuid),public.mn_create_companion(text,uuid,uuid,jsonb,jsonb),
  public.mn_companion_creation_ready() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_load_companion_creation(text,uuid),
  public.mn_create_companion(text,uuid,uuid,jsonb,jsonb),public.mn_companion_creation_ready() TO service_role;
COMMIT;

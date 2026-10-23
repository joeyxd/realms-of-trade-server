-- Private durable personality/goals for companions already bound by the host.
-- This migration stores no provider, model, credential, activation, or gameplay state.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_companion_controls_valid(p_text text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_index integer; v_code integer;
BEGIN
  IF p_text IS NULL THEN RETURN false; END IF;
  FOR v_index IN 1..pg_catalog.char_length(p_text) LOOP
    v_code := pg_catalog.ascii(pg_catalog.substr(p_text,v_index,1));
    IF v_code BETWEEN 0 AND 8 OR v_code IN (11,12) OR v_code BETWEEN 14 AND 31 OR v_code=127 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_companion_config(p_config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_personality text;
  v_goals jsonb;
  v_goal jsonb;
  v_constraint jsonb;
  v_count integer;
  v_goal_count integer := 0;
  v_constraint_count integer;
  v_size integer;
  v_goal_size integer;
  v_constraint_text text;
  v_trim_chars text := ' '||pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(13)||pg_catalog.chr(160)||
    pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||
    pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||
    pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||
    pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279);
  v_ids text[] := ARRAY[]::text[];
BEGIN
  IF pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_config)) <> 3 OR
    NOT (p_config ?& ARRAY['v','personality','goals']) OR
    pg_catalog.jsonb_typeof(p_config->'v') IS DISTINCT FROM 'number' OR p_config->>'v' IS DISTINCT FROM '1' OR
    pg_catalog.jsonb_typeof(p_config->'personality') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(p_config->'goals') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  v_personality := p_config->>'personality';
  v_goals := p_config->'goals';
  IF pg_catalog.octet_length(v_personality) > 8192 OR
    NOT public.mn_companion_controls_valid(v_personality) OR
    v_personality ~* '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\y(api[_-]?key|access[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]+|\yBearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|\ysk-[A-Za-z0-9_-]{16,}' OR
    pg_catalog.jsonb_array_length(v_goals) > 16 THEN
    RETURN false;
  END IF;

  -- Count compact canonical JSON bytes, matching JSON.stringify's fixed key order.
  v_size := pg_catalog.octet_length('{"v":1,"personality":') +
    pg_catalog.octet_length(pg_catalog.to_jsonb(v_personality)::text) +
    pg_catalog.octet_length(',"goals":[') + pg_catalog.octet_length(']}');

  FOR v_goal IN SELECT value FROM pg_catalog.jsonb_array_elements(v_goals) LOOP
    v_goal_count := v_goal_count + 1;
    IF pg_catalog.jsonb_typeof(v_goal) IS DISTINCT FROM 'object' OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_goal)) <> 4 OR
      NOT (v_goal ?& ARRAY['id','status','text','constraints']) OR
      pg_catalog.jsonb_typeof(v_goal->'id') IS DISTINCT FROM 'string' OR
      pg_catalog.jsonb_typeof(v_goal->'status') IS DISTINCT FROM 'string' OR
      pg_catalog.jsonb_typeof(v_goal->'text') IS DISTINCT FROM 'string' OR
      pg_catalog.jsonb_typeof(v_goal->'constraints') IS DISTINCT FROM 'array' THEN
      RETURN false;
    END IF;

    IF v_goal->>'id' !~ '^[A-Za-z0-9_-]{1,64}$' OR v_goal->>'status' NOT IN ('active','paused','completed','blocked') OR
      pg_catalog.btrim(v_goal->>'text',v_trim_chars) = '' OR pg_catalog.octet_length(v_goal->>'text') > 2000 OR
      NOT public.mn_companion_controls_valid(v_goal->>'text') OR
      v_goal->>'text' ~* '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\y(api[_-]?key|access[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]+|\yBearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|\ysk-[A-Za-z0-9_-]{16,}' OR
      v_goal->>'id' = ANY(v_ids) THEN
      RETURN false;
    END IF;
    v_ids := pg_catalog.array_append(v_ids, v_goal->>'id');

    v_constraint_count := pg_catalog.jsonb_array_length(v_goal->'constraints');
    IF v_constraint_count > 8 THEN RETURN false; END IF;
    v_goal_size := pg_catalog.octet_length('{"id":') + pg_catalog.octet_length(pg_catalog.to_jsonb(v_goal->>'id')::text) +
      pg_catalog.octet_length(',"status":') + pg_catalog.octet_length(pg_catalog.to_jsonb(v_goal->>'status')::text) +
      pg_catalog.octet_length(',"text":') + pg_catalog.octet_length(pg_catalog.to_jsonb(v_goal->>'text')::text) +
      pg_catalog.octet_length(',"constraints":[') + pg_catalog.octet_length(']}');
    v_count := 0;
    FOR v_constraint IN SELECT value FROM pg_catalog.jsonb_array_elements(v_goal->'constraints') LOOP
      v_count := v_count + 1;
      IF pg_catalog.jsonb_typeof(v_constraint) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      v_constraint_text := v_constraint #>> '{}';
      IF pg_catalog.btrim(v_constraint_text,v_trim_chars) = '' OR pg_catalog.octet_length(v_constraint_text) > 500 OR
        NOT public.mn_companion_controls_valid(v_constraint_text) OR
        v_constraint_text ~* '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\y(api[_-]?key|access[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]+|\yBearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|\ysk-[A-Za-z0-9_-]{16,}' THEN
        RETURN false;
      END IF;
      v_goal_size := v_goal_size + pg_catalog.octet_length(pg_catalog.to_jsonb(v_constraint_text)::text);
      IF v_count > 1 THEN v_goal_size := v_goal_size + 1; END IF;
    END LOOP;
    v_size := v_size + v_goal_size;
    IF v_goal_count > 1 THEN v_size := v_size + 1; END IF;
    IF v_size > 32768 THEN RETURN false; END IF;
  END LOOP;
  RETURN v_size <= 32768;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_companion_configs (
  world text NOT NULL,
  owner_id uuid NOT NULL,
  character_id uuid NOT NULL,
  revision integer NOT NULL,
  config jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT mn_companion_configs_pkey PRIMARY KEY (world, owner_id, character_id),
  CONSTRAINT mn_companion_configs_world_scope_ck CHECK (world ~ '^[A-Za-z0-9:_-]{1,100}$'),
  CONSTRAINT mn_companion_configs_owner_scope_ck CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_companion_configs_character_scope_ck CHECK (
    character_id <> '00000000-0000-0000-0000-000000000000'::uuid AND character_id <> owner_id),
  CONSTRAINT mn_companion_configs_revision_ck CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mn_companion_configs_config_ck CHECK (public.mn_valid_companion_config(config))
);
ALTER TABLE public.mn_companion_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_companion_configs FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_companion_config_scope_valid(p_world text,p_owner uuid,p_character uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT p_world IS NOT NULL AND p_world ~ '^[A-Za-z0-9:_-]{1,100}$' AND
    p_owner IS NOT NULL AND p_owner <> '00000000-0000-0000-0000-000000000000'::uuid AND
    p_character IS NOT NULL AND p_character <> '00000000-0000-0000-0000-000000000000'::uuid AND p_character <> p_owner
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_config_head(p_row public.mn_companion_configs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('revision',p_row.revision,'config',p_row.config,'savedAt',p_row.saved_at)
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_companion_config(p_world text,p_owner uuid,p_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_companion_configs%ROWTYPE;
BEGIN
  IF NOT public.mn_companion_config_scope_valid(p_world,p_owner,p_character) THEN
    RAISE EXCEPTION 'invalid companion config scope' USING ERRCODE = 'CCF01';
  END IF;
  SELECT * INTO v_row FROM public.mn_companion_configs
    WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('revision',0,'config',NULL,'savedAt',NULL); END IF;
  RETURN public.mn_companion_config_head(v_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_companion_config(
  p_world text,p_owner uuid,p_character uuid,p_expected_revision integer,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_companion_configs%ROWTYPE; v_next integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
    NOT public.mn_companion_config_scope_valid(p_world,p_owner,p_character) OR
    p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 2147483647 OR
    NOT public.mn_valid_companion_config(p_config) THEN
    RAISE EXCEPTION 'invalid companion config save' USING ERRCODE = 'CCF01';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-companion-config:'||
    pg_catalog.jsonb_build_array(p_world,p_owner::text,p_character::text)::text,0));
  SELECT * INTO v_row FROM public.mn_companion_configs
    WHERE world=p_world AND owner_id=p_owner AND character_id=p_character FOR UPDATE;

  IF FOUND AND v_row.revision=p_expected_revision+1 AND v_row.config=p_config THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'replay',true,'head',public.mn_companion_config_head(v_row));
  END IF;
  IF FOUND AND v_row.revision<>p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict','head',public.mn_companion_config_head(v_row));
  END IF;
  IF NOT FOUND AND p_expected_revision<>0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict',
      'head',pg_catalog.jsonb_build_object('revision',0,'config',NULL,'savedAt',NULL));
  END IF;

  v_next := p_expected_revision+1;
  IF v_next=1 THEN
    INSERT INTO public.mn_companion_configs(world,owner_id,character_id,revision,config)
      VALUES(p_world,p_owner,p_character,v_next,p_config);
    SELECT * INTO v_row FROM public.mn_companion_configs
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  ELSE
    UPDATE public.mn_companion_configs SET revision=v_next,config=p_config,saved_at=pg_catalog.now()
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
    SELECT * INTO v_row FROM public.mn_companion_configs
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replay',false,'head',public.mn_companion_config_head(v_row));
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_config_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_table oid := pg_catalog.to_regclass('public.mn_companion_configs');
BEGIN
  IF v_table IS NULL OR
    NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype='p' AND
      pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (world, owner_id, character_id)') OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attnum>0 AND NOT a.attisdropped) <> 6 OR
    EXISTS (SELECT 1 FROM (VALUES ('world','text'),('owner_id','uuid'),('character_id','uuid'),
        ('revision','integer'),('config','jsonb'),('saved_at','timestamp with time zone')) AS expected(name,type_name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_table AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attname IS NULL OR NOT a.attnotnull OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.type_name) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype IN ('p','c')) <> 6 OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_configs_world_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_configs_owner_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_configs_character_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_configs_revision_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_configs_config_ck' AND c.convalidated) OR
    pg_catalog.has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_companion_config_ready()','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_companion_config(text,uuid,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_save_companion_config(text,uuid,uuid,integer,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_config_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_config_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_load_companion_config(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_load_companion_config(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_save_companion_config(text,uuid,uuid,integer,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_save_companion_config(text,uuid,uuid,integer,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_valid_companion_config(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_valid_companion_config(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_valid_companion_config(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_controls_valid(text)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_controls_valid(text)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_companion_controls_valid(text)','EXECUTE') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_config_ready()'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_load_companion_config(text,uuid,uuid)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_save_companion_config(text,uuid,uuid,integer,jsonb)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_config_scope_valid(text,uuid,uuid)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_config_head(public.mn_companion_configs)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_valid_companion_config(jsonb)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_controls_valid(text)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_companion_config(jsonb),
  public.mn_companion_controls_valid(text),
  public.mn_companion_config_scope_valid(text,uuid,uuid),
  public.mn_companion_config_head(public.mn_companion_configs),
  public.mn_load_companion_config(text,uuid,uuid),
  public.mn_save_companion_config(text,uuid,uuid,integer,jsonb),
  public.mn_companion_config_ready()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_load_companion_config(text,uuid,uuid),
  public.mn_save_companion_config(text,uuid,uuid,integer,jsonb),
  public.mn_companion_config_ready() TO service_role;
COMMIT;

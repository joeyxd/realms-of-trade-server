-- Private owner configuration for admitted inference references; no credentials or spend ledger.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_inference_config(p_config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_total numeric;
  v_connection jsonb;
  v_companion jsonb;
  v_connection_id text;
  v_previous_id text;
  v_character text;
  v_previous_character text;
  v_model text;
  v_connection_count integer;
  v_companion_count integer;
  v_connection_seen boolean;
BEGIN
  IF pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_config)) <> 4 OR
     NOT (p_config ?& ARRAY['v','ceilingNanoUsd','connections','companions']) OR
     pg_catalog.jsonb_typeof(p_config->'v') IS DISTINCT FROM 'number' OR (p_config->>'v')::numeric <> 1 OR
     pg_catalog.jsonb_typeof(p_config->'ceilingNanoUsd') IS DISTINCT FROM 'number' OR
     pg_catalog.jsonb_typeof(p_config->'connections') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(p_config->'companions') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  v_total := (p_config->>'ceilingNanoUsd')::numeric;
  v_connection_count := pg_catalog.jsonb_array_length(p_config->'connections');
  v_companion_count := pg_catalog.jsonb_array_length(p_config->'companions');
  IF v_total < 0 OR v_total > 1000000000000 OR v_total <> pg_catalog.trunc(v_total) OR
     v_connection_count > 8 OR v_companion_count > 16 OR
     pg_catalog.octet_length(p_config::text) > 16384 THEN
    RETURN false;
  END IF;

  v_previous_id := NULL;
  FOR v_connection IN SELECT value FROM pg_catalog.jsonb_array_elements(p_config->'connections') LOOP
    IF pg_catalog.jsonb_typeof(v_connection) IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_connection)) <> 2 OR
       NOT (v_connection ?& ARRAY['id','ceilingNanoUsd']) OR
       pg_catalog.jsonb_typeof(v_connection->'id') IS DISTINCT FROM 'string' OR
       pg_catalog.jsonb_typeof(v_connection->'ceilingNanoUsd') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    v_connection_id := v_connection->>'id';
    v_total := (p_config->>'ceilingNanoUsd')::numeric;
    IF v_connection_id !~ '^[A-Za-z0-9_-]{1,64}$' OR
       (v_previous_id IS NOT NULL AND (v_previous_id COLLATE "C") >= (v_connection_id COLLATE "C")) OR
       (v_connection->>'ceilingNanoUsd')::numeric < 0 OR
       (v_connection->>'ceilingNanoUsd')::numeric > v_total OR
       (v_connection->>'ceilingNanoUsd')::numeric <> pg_catalog.trunc((v_connection->>'ceilingNanoUsd')::numeric) THEN
      RETURN false;
    END IF;
    v_previous_id := v_connection_id;
  END LOOP;

  v_previous_character := NULL;
  FOR v_companion IN SELECT value FROM pg_catalog.jsonb_array_elements(p_config->'companions') LOOP
    IF pg_catalog.jsonb_typeof(v_companion) IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_companion)) <> 3 OR
       NOT (v_companion ?& ARRAY['character','connectionId','modelId']) OR
       pg_catalog.jsonb_typeof(v_companion->'character') IS DISTINCT FROM 'string' OR
       pg_catalog.jsonb_typeof(v_companion->'connectionId') IS DISTINCT FROM 'string' OR
       pg_catalog.jsonb_typeof(v_companion->'modelId') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    v_character := v_companion->>'character';
    v_connection_id := v_companion->>'connectionId';
    v_model := v_companion->>'modelId';
    IF v_character !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       v_character = '00000000-0000-0000-0000-000000000000' OR
       (v_previous_character IS NOT NULL AND (v_previous_character COLLATE "C") >= (v_character COLLATE "C")) OR
       v_connection_id !~ '^[A-Za-z0-9_-]{1,64}$' OR
       v_model !~ '^[A-Za-z0-9._:/-]{1,160}$' OR v_model LIKE '%://%' OR
       v_model ~* 'sk-[A-Za-z0-9_-]{16,}' THEN
      RETURN false;
    END IF;
    v_connection_seen := false;
    FOR v_connection IN SELECT value FROM pg_catalog.jsonb_array_elements(p_config->'connections') LOOP
      IF v_connection->>'id' = v_connection_id THEN v_connection_seen := true; EXIT; END IF;
    END LOOP;
    IF NOT v_connection_seen THEN RETURN false; END IF;
    v_previous_character := v_character;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_inference_configs (
  world text NOT NULL,
  owner_id uuid NOT NULL,
  revision integer NOT NULL,
  config jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT mn_inference_configs_pkey PRIMARY KEY (world, owner_id),
  CONSTRAINT mn_inference_configs_world_scope_ck CHECK (world ~ '^[A-Za-z0-9:_-]{1,100}$'),
  CONSTRAINT mn_inference_configs_owner_scope_ck CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_inference_configs_revision_ck CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mn_inference_configs_config_ck CHECK (public.mn_valid_inference_config(config))
);
ALTER TABLE public.mn_inference_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_inference_configs FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_inference_config_scope_valid(p_world text,p_owner uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT p_world IS NOT NULL AND p_world ~ '^[A-Za-z0-9:_-]{1,100}$' AND
    p_owner IS NOT NULL AND p_owner <> '00000000-0000-0000-0000-000000000000'::uuid
$function$;

CREATE OR REPLACE FUNCTION public.mn_inference_config_head(p_row public.mn_inference_configs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('revision',p_row.revision,'config',p_row.config,'savedAt',p_row.saved_at)
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_inference_config(p_world text,p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_inference_configs%ROWTYPE;
BEGIN
  IF NOT public.mn_inference_config_scope_valid(p_world,p_owner) THEN
    RAISE EXCEPTION 'invalid inference config scope' USING ERRCODE = 'ICF01';
  END IF;
  SELECT * INTO v_row FROM public.mn_inference_configs WHERE world=p_world AND owner_id=p_owner;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('revision',0,'config',NULL,'savedAt',NULL); END IF;
  RETURN public.mn_inference_config_head(v_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_inference_config(
  p_world text,p_owner uuid,p_expected_revision integer,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_inference_configs%ROWTYPE; v_next integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     NOT public.mn_inference_config_scope_valid(p_world,p_owner) OR
     p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 2147483647 OR
     NOT public.mn_valid_inference_config(p_config) THEN
    RAISE EXCEPTION 'invalid inference config save' USING ERRCODE = 'ICF01';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-inference-config:'||
    pg_catalog.jsonb_build_array(p_world,p_owner::text)::text,0));
  SELECT * INTO v_row FROM public.mn_inference_configs WHERE world=p_world AND owner_id=p_owner FOR UPDATE;

  IF FOUND AND v_row.revision=p_expected_revision+1 AND v_row.config=p_config THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'replay',true,'head',public.mn_inference_config_head(v_row));
  END IF;
  IF FOUND AND v_row.revision<>p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict','head',public.mn_inference_config_head(v_row));
  END IF;
  IF NOT FOUND AND p_expected_revision<>0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict',
      'head',pg_catalog.jsonb_build_object('revision',0,'config',NULL,'savedAt',NULL));
  END IF;

  v_next := p_expected_revision+1;
  IF v_next=1 THEN
    INSERT INTO public.mn_inference_configs(world,owner_id,revision,config)
      VALUES(p_world,p_owner,v_next,p_config);
    SELECT * INTO v_row FROM public.mn_inference_configs WHERE world=p_world AND owner_id=p_owner;
  ELSE
    UPDATE public.mn_inference_configs SET revision=v_next,config=p_config,saved_at=pg_catalog.now()
      WHERE world=p_world AND owner_id=p_owner;
    SELECT * INTO v_row FROM public.mn_inference_configs WHERE world=p_world AND owner_id=p_owner;
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replay',false,'head',public.mn_inference_config_head(v_row));
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_inference_config_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_table oid := pg_catalog.to_regclass('public.mn_inference_configs');
BEGIN
  IF v_table IS NULL OR
    NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype='p' AND
      pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (world, owner_id)') OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attnum>0 AND NOT a.attisdropped) <> 5 OR
    EXISTS (SELECT 1 FROM (VALUES ('world','text'),('owner_id','uuid'),('revision','integer'),('config','jsonb'),
        ('saved_at','timestamp with time zone')) AS expected(name,type_name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_table AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attname IS NULL OR NOT a.attnotnull OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.type_name) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype IN ('p','c')) <> 5 OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_inference_configs_world_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_inference_configs_owner_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_inference_configs_revision_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_inference_configs_config_ck' AND c.convalidated) OR
    pg_catalog.has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    EXISTS (SELECT 1 FROM (VALUES ('service_role'),('anon'),('authenticated')) AS roles(role_name)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) AS privileges(privilege_name)
      WHERE pg_catalog.has_any_column_privilege(roles.role_name,v_table,privileges.privilege_name)) OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_inference_config_ready()','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_inference_config(text,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_save_inference_config(text,uuid,integer,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_inference_config_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_inference_config_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_load_inference_config(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_load_inference_config(text,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_save_inference_config(text,uuid,integer,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_save_inference_config(text,uuid,integer,jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_valid_inference_config(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_valid_inference_config(jsonb)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_valid_inference_config(jsonb)','EXECUTE') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_inference_config_ready()'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_load_inference_config(text,uuid)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_save_inference_config(text,uuid,integer,jsonb)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_inference_config_scope_valid(text,uuid)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_inference_config_head(public.mn_inference_configs)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_valid_inference_config(jsonb)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_inference_config(jsonb),
  public.mn_inference_config_scope_valid(text,uuid), public.mn_inference_config_head(public.mn_inference_configs),
  public.mn_load_inference_config(text,uuid), public.mn_save_inference_config(text,uuid,integer,jsonb),
  public.mn_inference_config_ready() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_load_inference_config(text,uuid),
  public.mn_save_inference_config(text,uuid,integer,jsonb), public.mn_inference_config_ready() TO service_role;
COMMIT;

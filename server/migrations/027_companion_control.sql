-- Durable owner stop state for companions provisioned by the game host.
-- Missing rows fail closed as stopped. This migration does not provision bindings or grant gameplay authority.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_companion_controls (
  world text NOT NULL,
  owner_id uuid NOT NULL,
  character_id uuid NOT NULL,
  revision integer NOT NULL,
  stopped boolean NOT NULL,
  saved_at timestamptz NOT NULL,
  CONSTRAINT mn_companion_controls_pkey PRIMARY KEY (world, owner_id, character_id),
  CONSTRAINT mn_companion_controls_world_scope_ck CHECK (world ~ '^[A-Za-z0-9:_-]{1,100}$'),
  CONSTRAINT mn_companion_controls_owner_scope_ck CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_companion_controls_character_scope_ck CHECK (
    character_id <> '00000000-0000-0000-0000-000000000000'::uuid AND character_id <> owner_id),
  CONSTRAINT mn_companion_controls_revision_ck CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mn_companion_controls_saved_at_ck CHECK (
    saved_at > '-infinity'::timestamptz AND saved_at < 'infinity'::timestamptz)
);
ALTER TABLE public.mn_companion_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_companion_controls FROM PUBLIC, anon, authenticated, service_role;
REVOKE SELECT (world,owner_id,character_id,revision,stopped,saved_at),
  INSERT (world,owner_id,character_id,revision,stopped,saved_at),
  UPDATE (world,owner_id,character_id,revision,stopped,saved_at),
  REFERENCES (world,owner_id,character_id,revision,stopped,saved_at)
  ON TABLE public.mn_companion_controls FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_companion_control_scope_valid(p_world text,p_owner uuid,p_character uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT p_world IS NOT NULL AND p_world ~ '^[A-Za-z0-9:_-]{1,100}$' AND
    p_owner IS NOT NULL AND p_owner <> '00000000-0000-0000-0000-000000000000'::uuid AND
    p_character IS NOT NULL AND p_character <> '00000000-0000-0000-0000-000000000000'::uuid AND p_character <> p_owner
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_control_head(p_row public.mn_companion_controls)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('revision',p_row.revision,'stopped',p_row.stopped,'savedAt',p_row.saved_at)
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_companion_control(p_world text,p_owner uuid,p_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_companion_controls%ROWTYPE;
BEGIN
  IF NOT public.mn_companion_control_scope_valid(p_world,p_owner,p_character) THEN
    RAISE EXCEPTION 'invalid companion control scope' USING ERRCODE = 'CCL01';
  END IF;
  SELECT * INTO v_row FROM public.mn_companion_controls
    WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('revision',0,'stopped',true,'savedAt',NULL); END IF;
  RETURN public.mn_companion_control_head(v_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_companion_control(
  p_world text,p_owner uuid,p_character uuid,p_expected_revision integer,p_stopped boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_companion_controls%ROWTYPE; v_next integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     NOT public.mn_companion_control_scope_valid(p_world,p_owner,p_character) OR
     p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 2147483647 OR
     p_stopped IS NULL THEN
    RAISE EXCEPTION 'invalid companion control save' USING ERRCODE = 'CCL01';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-companion-control:'||
    pg_catalog.jsonb_build_array(p_world,p_owner::text,p_character::text)::text,0));
  SELECT * INTO v_row FROM public.mn_companion_controls
    WHERE world=p_world AND owner_id=p_owner AND character_id=p_character FOR UPDATE;

  IF FOUND AND v_row.revision=p_expected_revision+1 AND v_row.stopped=p_stopped THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'replay',true,'head',public.mn_companion_control_head(v_row));
  END IF;
  IF FOUND AND v_row.revision<>p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict','head',public.mn_companion_control_head(v_row));
  END IF;
  IF NOT FOUND AND p_expected_revision<>0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict',
      'head',pg_catalog.jsonb_build_object('revision',0,'stopped',true,'savedAt',NULL));
  END IF;

  v_next := p_expected_revision+1;
  IF v_next=1 THEN
    INSERT INTO public.mn_companion_controls(world,owner_id,character_id,revision,stopped,saved_at)
      VALUES(p_world,p_owner,p_character,v_next,p_stopped,pg_catalog.now());
    SELECT * INTO v_row FROM public.mn_companion_controls
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  ELSE
    UPDATE public.mn_companion_controls SET revision=v_next,stopped=p_stopped,saved_at=pg_catalog.now()
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
    SELECT * INTO v_row FROM public.mn_companion_controls
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replay',false,'head',public.mn_companion_control_head(v_row));
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_control_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_table oid := pg_catalog.to_regclass('public.mn_companion_controls');
BEGIN
  IF v_table IS NULL OR
    NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype='p' AND
      pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (world, owner_id, character_id)') OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attnum>0 AND NOT a.attisdropped) <> 6 OR
    EXISTS (SELECT 1 FROM (VALUES ('world','text'),('owner_id','uuid'),('character_id','uuid'),
        ('revision','integer'),('stopped','boolean'),('saved_at','timestamp with time zone')) AS expected(name,type_name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_table AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attname IS NULL OR NOT a.attnotnull OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.type_name) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype IN ('p','c')) <> 6 OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_controls_world_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_controls_owner_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_controls_character_scope_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_controls_revision_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_controls_saved_at_ck' AND c.convalidated) OR
    pg_catalog.has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    EXISTS (SELECT 1 FROM (VALUES ('service_role'),('anon'),('authenticated')) AS roles(role_name)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) AS privileges(privilege_name)
      WHERE pg_catalog.has_any_column_privilege(roles.role_name,v_table,privileges.privilege_name)) OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_companion_control_ready()','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_companion_control(text,uuid,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_save_companion_control(text,uuid,uuid,integer,boolean)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_control_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_control_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_load_companion_control(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_load_companion_control(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_save_companion_control(text,uuid,uuid,integer,boolean)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_save_companion_control(text,uuid,uuid,integer,boolean)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_control_scope_valid(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_control_scope_valid(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_companion_control_scope_valid(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_control_head(public.mn_companion_controls)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_control_head(public.mn_companion_controls)','EXECUTE') OR
    pg_catalog.has_function_privilege('service_role','public.mn_companion_control_head(public.mn_companion_controls)','EXECUTE') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_control_ready()'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_load_companion_control(text,uuid,uuid)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_save_companion_control(text,uuid,uuid,integer,boolean)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_control_scope_valid(text,uuid,uuid)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_control_head(public.mn_companion_controls)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_companion_control_scope_valid(text,uuid,uuid),
  public.mn_companion_control_head(public.mn_companion_controls),
  public.mn_load_companion_control(text,uuid,uuid),
  public.mn_save_companion_control(text,uuid,uuid,integer,boolean),
  public.mn_companion_control_ready()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_load_companion_control(text,uuid,uuid),
  public.mn_save_companion_control(text,uuid,uuid,integer,boolean),
  public.mn_companion_control_ready() TO service_role;
COMMIT;

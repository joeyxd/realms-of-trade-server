-- Durable host-run admission gate for SQL034 companions. This records presence intent only;
-- it does not create or mutate a gameplay profile or world state.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_companion_presence (
  world text NOT NULL,
  owner_id uuid NOT NULL,
  character_id uuid NOT NULL,
  revision integer NOT NULL,
  active boolean NOT NULL,
  run_id uuid NOT NULL,
  saved_at timestamptz NOT NULL,
  CONSTRAINT mn_companion_presence_pkey PRIMARY KEY (world, owner_id, character_id),
  CONSTRAINT mn_companion_presence_creation_fk FOREIGN KEY (world, owner_id, character_id)
    REFERENCES public.mn_companion_creations(world, owner_id, character_id) ON DELETE CASCADE,
  CONSTRAINT mn_companion_presence_world_ck CHECK (world ~ '^[A-Za-z0-9:_-]{1,100}$'),
  CONSTRAINT mn_companion_presence_owner_ck CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_companion_presence_character_ck CHECK (
    character_id <> '00000000-0000-0000-0000-000000000000'::uuid AND character_id <> owner_id),
  CONSTRAINT mn_companion_presence_revision_ck CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mn_companion_presence_run_ck CHECK (run_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_companion_presence_saved_at_ck CHECK (
    saved_at > '-infinity'::timestamptz AND saved_at < 'infinity'::timestamptz)
);
ALTER TABLE public.mn_companion_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_companion_presence FROM PUBLIC, anon, authenticated, service_role;
REVOKE SELECT (world,owner_id,character_id,revision,active,run_id,saved_at),
  INSERT (world,owner_id,character_id,revision,active,run_id,saved_at),
  UPDATE (world,owner_id,character_id,revision,active,run_id,saved_at),
  REFERENCES (world,owner_id,character_id,revision,active,run_id,saved_at)
  ON TABLE public.mn_companion_presence FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_load_companion_presence(p_world text,p_owner uuid,p_character uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_companion_presence%ROWTYPE;
BEGIN
  IF p_world IS NULL OR p_world !~ '^[A-Za-z0-9:_-]{1,100}$' OR p_owner IS NULL OR
     p_owner = '00000000-0000-0000-0000-000000000000'::uuid OR p_character IS NULL OR
     p_character = '00000000-0000-0000-0000-000000000000'::uuid OR p_character = p_owner THEN
    RAISE EXCEPTION 'invalid companion presence scope' USING ERRCODE = 'CPS01';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mn_companion_creations c
      WHERE c.world=p_world AND c.owner_id=p_owner AND c.character_id=p_character) THEN
    RAISE EXCEPTION 'companion presence creation missing' USING ERRCODE = 'CPS02';
  END IF;
  SELECT * INTO v_row FROM public.mn_companion_presence
    WHERE world=p_world AND owner_id=p_owner AND character_id=p_character;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('revision',0,'active',false,'runId',NULL,'savedAt',NULL); END IF;
  RETURN pg_catalog.jsonb_build_object('revision',v_row.revision,'active',v_row.active,
    'runId',v_row.run_id,'savedAt',v_row.saved_at);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_companion_presence(
  p_world text,p_owner uuid,p_character uuid,p_expected_revision integer,p_active boolean,p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_companion_presence%ROWTYPE; v_next integer; v_has_row boolean;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     p_world IS NULL OR p_world !~ '^[A-Za-z0-9:_-]{1,100}$' OR p_owner IS NULL OR
     p_owner = '00000000-0000-0000-0000-000000000000'::uuid OR p_character IS NULL OR
     p_character = '00000000-0000-0000-0000-000000000000'::uuid OR p_character = p_owner OR
     p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 2147483647 OR
     p_active IS NULL OR p_run_id IS NULL OR p_run_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'invalid companion presence save' USING ERRCODE = 'CPS01';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mn_companion_creations c
      WHERE c.world=p_world AND c.owner_id=p_owner AND c.character_id=p_character) THEN
    RAISE EXCEPTION 'companion presence creation missing' USING ERRCODE = 'CPS02';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-companion-presence:'||
    pg_catalog.jsonb_build_array(p_world,p_owner::text,p_character::text)::text,0));
  SELECT * INTO v_row FROM public.mn_companion_presence
    WHERE world=p_world AND owner_id=p_owner AND character_id=p_character FOR UPDATE;
  v_has_row := FOUND;

  IF v_has_row AND v_row.revision=p_expected_revision+1 AND v_row.active=p_active AND v_row.run_id=p_run_id THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'replay',true,
      'head',pg_catalog.jsonb_build_object('revision',v_row.revision,'active',v_row.active,'runId',v_row.run_id,'savedAt',v_row.saved_at));
  END IF;
  IF v_has_row AND v_row.revision<>p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict',
      'head',pg_catalog.jsonb_build_object('revision',v_row.revision,'active',v_row.active,'runId',v_row.run_id,'savedAt',v_row.saved_at));
  END IF;
  IF NOT v_has_row AND p_expected_revision<>0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict',
      'head',pg_catalog.jsonb_build_object('revision',0,'active',false,'runId',NULL,'savedAt',NULL));
  END IF;

  IF (p_active AND ((v_has_row AND v_row.active) OR (v_has_row AND v_row.run_id=p_run_id))) OR
     (NOT p_active AND (NOT v_has_row OR NOT v_row.active OR v_row.run_id<>p_run_id)) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict',
      'head',CASE WHEN v_has_row THEN
        pg_catalog.jsonb_build_object('revision',v_row.revision,'active',v_row.active,'runId',v_row.run_id,'savedAt',v_row.saved_at)
        ELSE pg_catalog.jsonb_build_object('revision',0,'active',false,'runId',NULL,'savedAt',NULL) END);
  END IF;

  v_next := p_expected_revision+1;
  IF v_has_row THEN
    UPDATE public.mn_companion_presence SET revision=v_next,active=p_active,run_id=p_run_id,saved_at=pg_catalog.now()
      WHERE world=p_world AND owner_id=p_owner AND character_id=p_character RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.mn_companion_presence(world,owner_id,character_id,revision,active,run_id,saved_at)
      VALUES(p_world,p_owner,p_character,v_next,p_active,p_run_id,pg_catalog.now()) RETURNING * INTO v_row;
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replay',false,
    'head',pg_catalog.jsonb_build_object('revision',v_row.revision,'active',v_row.active,'runId',v_row.run_id,'savedAt',v_row.saved_at));
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_companion_presence_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_table oid := pg_catalog.to_regclass('public.mn_companion_presence');
BEGIN
  IF v_table IS NULL OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attnum>0 AND NOT a.attisdropped) <> 7 OR
    EXISTS (SELECT 1 FROM (VALUES ('world','text'),('owner_id','uuid'),('character_id','uuid'),('revision','integer'),
        ('active','boolean'),('run_id','uuid'),('saved_at','timestamp with time zone')) AS expected(name,type_name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_table AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attname IS NULL OR NOT a.attnotnull OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.type_name) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype='p' AND
      pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (world, owner_id, character_id)') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND
      c.conname='mn_companion_presence_creation_fk' AND c.contype='f' AND c.convalidated AND c.confdeltype='c' AND
      c.confrelid=pg_catalog.to_regclass('public.mn_companion_creations') AND
      c.conkey=ARRAY[(SELECT a.attnum::smallint FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attname='world'),
        (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attname='owner_id'),
        (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attname='character_id')]::smallint[] AND
      c.confkey=ARRAY[(SELECT a.attnum::smallint FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='world'),
        (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='owner_id'),
        (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='character_id')]::smallint[]) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype IN ('p','c')) <> 7 OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_presence_world_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_presence_owner_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_presence_character_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_presence_revision_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_presence_run_ck' AND c.convalidated) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.conname='mn_companion_presence_saved_at_ck' AND c.convalidated) OR
    pg_catalog.has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    EXISTS (SELECT 1 FROM (VALUES ('service_role'),('anon'),('authenticated')) AS roles(role_name)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) AS privileges(privilege_name)
      WHERE pg_catalog.has_any_column_privilege(roles.role_name,v_table,privileges.privilege_name)) OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_companion_presence_ready()','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_companion_presence(text,uuid,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_companion_presence_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_companion_presence_ready()','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_load_companion_presence(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_load_companion_presence(text,uuid,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('anon','public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid)','EXECUTE') OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_companion_presence_ready()'::regprocedure AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_load_companion_presence(text,uuid,uuid)'::regprocedure AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid)'::regprocedure AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_load_companion_presence(text,uuid,uuid),
  public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid),
  public.mn_companion_presence_ready() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_load_companion_presence(text,uuid,uuid),
  public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid),
  public.mn_companion_presence_ready() TO service_role;
COMMIT;

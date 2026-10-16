-- Private, durable GM editor draft heads and exact save receipts.
-- This content store is deliberately separate from M5 gameplay/world snapshots.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_gm_draft_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_document jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.octet_length(p_request::text) > 5242880 OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     NOT (p_request ?& ARRAY['world','owner','expectedRevision','document']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 4 OR
     pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
     (p_request->>'world') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' OR
     pg_catalog.jsonb_typeof(p_request->'owner') IS DISTINCT FROM 'string' OR
     (p_request->>'owner') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     NOT public.mn_death_int(p_request->'expectedRevision',0,2147483646) THEN RETURN false; END IF;
  v_document := p_request->'document';
  IF pg_catalog.octet_length(v_document::text) > 5242880 OR
     pg_catalog.jsonb_typeof(v_document) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_document)) <> 5 OR
     v_document->>'schema' IS DISTINCT FROM 'marea.gm.map-draft' OR
     v_document->'version' IS DISTINCT FROM '2'::jsonb OR
     pg_catalog.jsonb_typeof(v_document->'base') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_document->'base')) <> 2 OR
     pg_catalog.jsonb_typeof(v_document->'base'->'seed') IS DISTINCT FROM 'number' OR
     (v_document->'base'->>'seed') !~ '^(0|[1-9][0-9]*)$' OR
     (v_document->'base'->>'seed')::numeric > 4294967295 OR
     pg_catalog.jsonb_typeof(v_document->'base'->'revision') IS DISTINCT FROM 'string' OR
     pg_catalog.char_length(v_document->'base'->>'revision') NOT BETWEEN 1 AND 128 OR
     (v_document->'base'->>'revision') ~ '[[:cntrl:]]' OR
     pg_catalog.jsonb_typeof(v_document->'objects') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_document->'baseOverrides') IS DISTINCT FROM 'array' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_document->'objects')) > 5000 OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_document->'baseOverrides')) > 5000 OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_document->'objects')) +
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_document->'baseOverrides')) > 5000 THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN
  RETURN false;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_gm_drafts (
  world text NOT NULL CHECK (world ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  owner_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(document) = 'object'),
  saved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (world, owner_id),
  CHECK (pg_catalog.octet_length(document::text) <= 5242880)
);

CREATE TABLE IF NOT EXISTS public.mn_gm_draft_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (public.mn_valid_gm_draft_request(operation_id, request) IS TRUE),
  result jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.mn_gm_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_gm_draft_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_gm_drafts, public.mn_gm_draft_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.mn_gm_drafts, public.mn_gm_draft_operations TO service_role;

CREATE OR REPLACE FUNCTION public.mn_guard_gm_draft_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'immutable GM draft operation receipt' USING ERRCODE = 'MNG02'; END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_gm_draft_operation_guard ON public.mn_gm_draft_operations;
CREATE TRIGGER mn_gm_draft_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mn_gm_draft_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_gm_draft_operation();

CREATE OR REPLACE FUNCTION public.mn_gm_drafts_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_service_role text := 'service_role'; v_roles text[] := ARRAY['anon','authenticated'];
  v_tables text[] := ARRAY['public.mn_gm_drafts','public.mn_gm_draft_operations'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_table text; v_role text; v_privilege text; v_proc regprocedure;
  v_primary_key text[];
BEGIN
  IF current_user <> v_service_role THEN
    RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
  END IF;
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(v_table) IS NULL OR COALESCE((
      SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid=to_regclass(v_table)),false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
    END IF;
    IF v_table = v_tables[1] THEN
      IF (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(v_table)
          AND a.attnum>0 AND NOT a.attisdropped) <> 5 OR EXISTS (
        SELECT 1 FROM (VALUES ('world','text'::regtype),('owner_id','uuid'::regtype),
          ('revision','integer'::regtype),('document','jsonb'::regtype),('saved_at','timestamptz'::regtype)) expected(name,typ)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=to_regclass(v_table) AND a.attname=expected.name
          AND a.attnum>0 AND NOT a.attisdropped
        WHERE a.attname IS NULL OR a.atttypid<>expected.typ OR NOT a.attnotnull) THEN
        RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
      END IF;
      SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO v_primary_key
      FROM pg_catalog.pg_constraint c
      CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid=to_regclass(v_table) AND c.contype='p';
      IF v_primary_key IS DISTINCT FROM ARRAY['world','owner_id']::text[] THEN
        RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(v_table)
          AND a.attnum>0 AND NOT a.attisdropped) <> 4 OR EXISTS (
        SELECT 1 FROM (VALUES ('operation_id','uuid'::regtype),('request','jsonb'::regtype),
          ('result','jsonb'::regtype),('created_at','timestamptz'::regtype)) expected(name,typ)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=to_regclass(v_table) AND a.attname=expected.name
          AND a.attnum>0 AND NOT a.attisdropped
        WHERE a.attname IS NULL OR a.atttypid<>expected.typ OR NOT a.attnotnull) THEN
        RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
      END IF;
      SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO v_primary_key
      FROM pg_catalog.pg_constraint c
      CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid=to_regclass(v_table) AND c.contype='p';
      IF v_primary_key IS DISTINCT FROM ARRAY['operation_id']::text[] THEN
        RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
      END IF;
    END IF;
    FOREACH v_role IN ARRAY v_roles LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF has_table_privilege(v_role,v_table,v_privilege) THEN
          RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
        END IF;
      END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY v_privileges LOOP
      IF has_table_privilege(v_service_role,v_table,v_privilege) AND v_privilege <> 'SELECT' THEN
        RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege(v_service_role,v_tables[1],'SELECT') OR
     NOT has_table_privilege(v_service_role,v_tables[2],'SELECT') THEN
    RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass(v_tables[2])
      AND t.tgname='mn_gm_draft_operation_guard' AND NOT t.tgisinternal AND t.tgenabled='O'
      AND t.tgtype=31 AND t.tgfoid='public.mn_guard_gm_draft_operation()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
  END IF;
  FOREACH v_proc IN ARRAY ARRAY[
    'public.mn_gm_drafts_ready()'::regprocedure,
    'public.mn_load_gm_draft(text,uuid)'::regprocedure,
    'public.mn_save_gm_draft(uuid,jsonb)'::regprocedure
  ] LOOP
    IF NOT has_function_privilege(v_service_role,v_proc,'EXECUTE') THEN
      RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
    END IF;
    FOREACH v_role IN ARRAY v_roles LOOP
      IF has_function_privilege(v_role,v_proc,'EXECUTE') THEN
        RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      WHERE p.oid=v_proc AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_gm_draft(p_world text, p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_gm_drafts%ROWTYPE;
BEGIN
  IF p_world IS NULL OR p_world !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' OR p_owner IS NULL THEN
    RAISE EXCEPTION 'invalid GM draft scope' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.mn_gm_drafts WHERE world=p_world AND owner_id=p_owner;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object('revision',v_row.revision,'document',v_row.document,'savedAt',v_row.saved_at);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_gm_draft(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_row public.mn_gm_drafts%ROWTYPE;
  v_world text; v_owner uuid; v_expected integer; v_revision integer; v_saved_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR
     public.mn_valid_gm_draft_request(p_operation_id,p_request) IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  v_request := p_request;
  v_world := p_request->>'world'; v_owner := (p_request->>'owner')::uuid;
  v_expected := (p_request->>'expectedRevision')::integer;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-gm-op:' || p_operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_gm_draft_operations
    WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    IF v_result->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN v_result; END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-gm-draft:' || v_world || ':' || v_owner::text,0));
  SELECT * INTO v_row FROM public.mn_gm_drafts WHERE world=v_world AND owner_id=v_owner FOR UPDATE;
  IF NOT FOUND THEN
    IF v_expected <> 0 THEN
      v_result := pg_catalog.jsonb_build_object('ok',false,'why','conflict','revision',0);
      INSERT INTO public.mn_gm_draft_operations(operation_id,request,result) VALUES(p_operation_id,p_request,v_result);
      RETURN v_result;
    END IF;
    v_revision := 1;
  ELSE
    IF v_row.revision <> v_expected THEN
      v_result := pg_catalog.jsonb_build_object('ok',false,'why','conflict','revision',v_row.revision);
      INSERT INTO public.mn_gm_draft_operations(operation_id,request,result) VALUES(p_operation_id,p_request,v_result);
      RETURN v_result;
    END IF;
    v_revision := v_expected + 1;
  END IF;
  v_saved_at := pg_catalog.now();
  IF v_revision = 1 THEN
    INSERT INTO public.mn_gm_drafts(world,owner_id,revision,document,saved_at)
      VALUES(v_world,v_owner,v_revision,p_request->'document',v_saved_at);
  ELSE
    UPDATE public.mn_gm_drafts SET revision=v_revision,document=p_request->'document',saved_at=v_saved_at
      WHERE world=v_world AND owner_id=v_owner;
  END IF;
  v_result := pg_catalog.jsonb_build_object('ok',true,'replay',false,'head',
    pg_catalog.jsonb_build_object('revision',v_revision,'document',p_request->'document','savedAt',v_saved_at));
  INSERT INTO public.mn_gm_draft_operations(operation_id,request,result) VALUES(p_operation_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb), public.mn_guard_gm_draft_operation(),
  public.mn_gm_drafts_ready(), public.mn_load_gm_draft(text,uuid), public.mn_save_gm_draft(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb), public.mn_guard_gm_draft_operation()
  FROM service_role;
GRANT EXECUTE ON FUNCTION public.mn_gm_drafts_ready(), public.mn_load_gm_draft(text,uuid),
  public.mn_save_gm_draft(uuid,jsonb) TO service_role;

COMMIT;

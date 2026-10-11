-- Add canonical v3 terrain deltas to private GM draft saves without changing SQL020 receipts.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request_v2(uuid,jsonb)') IS NULL AND
     pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request(uuid,jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb) RENAME TO mn_valid_gm_draft_request_v2;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_gm_drafts_ready_v2()') IS NULL AND
     pg_catalog.to_regprocedure('public.mn_gm_drafts_ready()') IS NOT NULL THEN
    ALTER FUNCTION public.mn_gm_drafts_ready() RENAME TO mn_gm_drafts_ready_v2;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_gm_draft_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_document jsonb; v_terrain jsonb; v_samples jsonb; v_sample jsonb;
  v_index_text text; v_delta_text text; v_index numeric; v_delta numeric; v_previous integer := -1;
  v_normalized jsonb; v_count integer;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.octet_length(p_request::text) > 5242880 OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_document := p_request->'document';
  IF pg_catalog.jsonb_typeof(v_document) IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  -- Preserve the SQL020 v2 validator byte-for-byte as the historical compatibility path.
  IF v_document->>'version' IS DISTINCT FROM '3' THEN
    RETURN public.mn_valid_gm_draft_request_v2(p_operation_id,p_request);
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_document)) <> 6 OR
     NOT (v_document ?& ARRAY['schema','version','base','objects','baseOverrides','terrain']) OR
     v_document->>'schema' IS DISTINCT FROM 'marea.gm.map-draft' OR
     pg_catalog.jsonb_typeof(v_document->'version') IS DISTINCT FROM 'number' OR
     v_document->>'version' IS DISTINCT FROM '3' THEN RETURN false; END IF;

  v_terrain := v_document->'terrain';
  IF pg_catalog.jsonb_typeof(v_terrain) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_terrain)) <> 2 OR
     NOT (v_terrain ?& ARRAY['version','samples']) OR
     pg_catalog.jsonb_typeof(v_terrain->'version') IS DISTINCT FROM 'number' OR
     v_terrain->>'version' IS DISTINCT FROM '1' OR
     pg_catalog.jsonb_typeof(v_terrain->'samples') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  v_samples := v_terrain->'samples';
  v_count := pg_catalog.jsonb_array_length(v_samples);
  IF v_count > 20000 THEN RETURN false; END IF;
  FOR v_sample IN SELECT value FROM pg_catalog.jsonb_array_elements(v_samples) WITH ORDINALITY AS s(value,ordinality)
    ORDER BY ordinality LOOP
    IF pg_catalog.jsonb_typeof(v_sample) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(v_sample) <> 2 OR
       pg_catalog.jsonb_typeof(v_sample->0) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_sample->1) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v_index_text := v_sample->>0; v_delta_text := v_sample->>1;
    IF v_index_text !~ '^(0|[1-9][0-9]*)$' OR v_delta_text !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
    v_index := v_index_text::numeric; v_delta := v_delta_text::numeric;
    IF v_index < 0 OR v_index > 314720 OR v_index <= v_previous OR
       v_delta = 0 OR v_delta < -12000 OR v_delta > 12000 THEN RETURN false; END IF;
    v_previous := v_index::integer;
  END LOOP;

  -- Reuse all existing request, base, object, and override checks after removing only v3 terrain.
  v_normalized := pg_catalog.jsonb_set(p_request, '{document}',
    (v_document - 'terrain') || pg_catalog.jsonb_build_object('version',2), false);
  RETURN public.mn_valid_gm_draft_request_v2(p_operation_id,v_normalized);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN
  RETURN false;
END
$function$;

-- Rebind the receipt constraint to the new wrapper; existing v2 rows remain valid and untouched.
DO $constraint$
DECLARE v_name text;
BEGIN
  FOR v_name IN
    SELECT c.conname FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.mn_gm_draft_operations'::regclass AND c.contype='c'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%mn_valid_gm_draft_request%'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.mn_gm_draft_operations DROP CONSTRAINT %I',v_name);
  END LOOP;
END
$constraint$;
ALTER TABLE public.mn_gm_draft_operations
  ADD CONSTRAINT mn_gm_draft_operations_request_check
  CHECK (public.mn_valid_gm_draft_request(operation_id,request) IS TRUE);

CREATE OR REPLACE FUNCTION public.mn_gm_terrain_drafts_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_legacy jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'GM terrain draft storage is not ready' USING ERRCODE = '42501'; END IF;
  v_legacy := public.mn_gm_drafts_ready_v2();
  IF v_legacy IS DISTINCT FROM pg_catalog.jsonb_build_object('version',1) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.mn_gm_draft_operations'::regclass
         AND c.conname='mn_gm_draft_operations_request_check' AND c.convalidated
         AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%mn_valid_gm_draft_request%') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid='public.mn_valid_gm_draft_request(uuid,jsonb)'::regprocedure
         AND p.provolatile='i' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid='public.mn_valid_gm_draft_request_v2(uuid,jsonb)'::regprocedure
         AND p.provolatile='i' AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
     pg_catalog.has_function_privilege('service_role','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('service_role','public.mn_valid_gm_draft_request_v2(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('anon','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('anon','public.mn_valid_gm_draft_request_v2(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated','public.mn_valid_gm_draft_request_v2(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'GM terrain draft storage is not ready' USING ERRCODE = '42501';
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1,'terrainVersion',1);
END
$function$;

-- Keep the existing adapter RPC and exact response while gating it on the new v3 schema too.
CREATE OR REPLACE FUNCTION public.mn_gm_drafts_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_ready jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501'; END IF;
  v_ready := public.mn_gm_terrain_drafts_ready();
  IF v_ready IS DISTINCT FROM pg_catalog.jsonb_build_object('version',1,'terrainVersion',1) THEN
    RAISE EXCEPTION 'GM draft storage is not ready' USING ERRCODE = '42501';
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb),
  public.mn_valid_gm_draft_request_v2(uuid,jsonb), public.mn_gm_drafts_ready_v2(),
  public.mn_gm_drafts_ready(), public.mn_gm_terrain_drafts_ready()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_gm_drafts_ready_v2(), public.mn_gm_drafts_ready(),
  public.mn_gm_terrain_drafts_ready() TO service_role;

COMMIT;

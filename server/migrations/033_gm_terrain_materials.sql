-- Add v4 sparse terrain material painting while retaining v2/v3 validators and receipts.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request_v3(uuid,jsonb)') IS NULL AND
     pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request(uuid,jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb) RENAME TO mn_valid_gm_draft_request_v3;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_gm_draft_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_document jsonb; v_terrain jsonb; v_samples jsonb; v_materials jsonb;
  v_entry jsonb; v_text text; v_index numeric; v_previous integer := -1;
  v_a numeric; v_b numeric; v_c numeric; v_d numeric; v_sum numeric;
  v_sample_count integer; v_material_count integer; v_normalized jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.octet_length(p_request::text) > 5242880 OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_document := p_request->'document';
  IF pg_catalog.jsonb_typeof(v_document) IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  -- Keep SQL031 as the exact compatibility path for all existing v2 and v3 requests.
  IF v_document->>'version' IS DISTINCT FROM '4' THEN
    RETURN public.mn_valid_gm_draft_request_v3(p_operation_id,p_request);
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_document)) <> 6 OR
     NOT (v_document ?& ARRAY['schema','version','base','objects','baseOverrides','terrain']) OR
     v_document->>'schema' IS DISTINCT FROM 'marea.gm.map-draft' OR
     pg_catalog.jsonb_typeof(v_document->'version') IS DISTINCT FROM 'number' OR
     v_document->>'version' IS DISTINCT FROM '4' THEN RETURN false; END IF;

  v_terrain := v_document->'terrain';
  IF pg_catalog.jsonb_typeof(v_terrain) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_terrain)) <> 3 OR
     NOT (v_terrain ?& ARRAY['version','samples','materials']) OR
     pg_catalog.jsonb_typeof(v_terrain->'version') IS DISTINCT FROM 'number' OR
     v_terrain->>'version' IS DISTINCT FROM '2' OR
     pg_catalog.jsonb_typeof(v_terrain->'samples') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_terrain->'materials') IS DISTINCT FROM 'array' THEN RETURN false; END IF;

  -- Height deltas retain the v3 canonical representation and independent 20k limit.
  v_samples := v_terrain->'samples';
  v_sample_count := pg_catalog.jsonb_array_length(v_samples);
  IF v_sample_count > 20000 THEN RETURN false; END IF;
  v_previous := -1;
  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(v_samples) WITH ORDINALITY AS s(value,ordinality)
    ORDER BY ordinality LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(v_entry) <> 2 OR
       pg_catalog.jsonb_typeof(v_entry->0) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_entry->1) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v_text := v_entry->>0;
    IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
    v_index := v_text::numeric;
    v_text := v_entry->>1;
    IF v_text !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
    v_a := v_text::numeric;
    IF v_index < 0 OR v_index > 314720 OR v_index <= v_previous OR
       v_a = 0 OR v_a < -12000 OR v_a > 12000 THEN RETURN false; END IF;
    v_previous := v_index::integer;
  END LOOP;

  -- Material entries are [gridIndex, grass, dirt, sand, rock], with residual weight
  -- (255 - channel sum) retaining the generated base material at that cell.
  v_materials := v_terrain->'materials';
  v_material_count := pg_catalog.jsonb_array_length(v_materials);
  IF v_material_count > 20000 THEN RETURN false; END IF;
  v_previous := -1;
  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(v_materials) WITH ORDINALITY AS s(value,ordinality)
    ORDER BY ordinality LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(v_entry) <> 5 THEN
      RETURN false;
    END IF;
    FOR v_text IN SELECT value FROM pg_catalog.jsonb_array_elements_text(v_entry) WITH ORDINALITY AS n(value,ordinality)
      WHERE ordinality = 1 LOOP
      IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
      v_index := v_text::numeric;
    END LOOP;
    IF pg_catalog.jsonb_typeof(v_entry->0) IS DISTINCT FROM 'number' OR
       v_index < 0 OR v_index > 314720 OR v_index <= v_previous THEN RETURN false; END IF;
    IF pg_catalog.jsonb_typeof(v_entry->1) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_entry->2) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_entry->3) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_entry->4) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v_text := v_entry->>1; IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_a := v_text::numeric;
    v_text := v_entry->>2; IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_b := v_text::numeric;
    v_text := v_entry->>3; IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_c := v_text::numeric;
    v_text := v_entry->>4; IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_d := v_text::numeric;
    v_sum := v_a + v_b + v_c + v_d;
    IF v_a > 255 OR v_b > 255 OR v_c > 255 OR v_d > 255 OR v_sum < 1 OR v_sum > 255 THEN RETURN false; END IF;
    v_previous := v_index::integer;
  END LOOP;

  -- Reuse SQL031's v3 and SQL020's historical v2 checks for the rest of the document.
  v_normalized := pg_catalog.jsonb_set(p_request, '{document}',
    (v_document || pg_catalog.jsonb_build_object('version',3,'terrain',
      pg_catalog.jsonb_build_object('version',1,'samples',v_samples))) , false);
  RETURN public.mn_valid_gm_draft_request_v3(p_operation_id,v_normalized);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN
  RETURN false;
END
$function$;

-- Rebind the receipt constraint to the v4-aware wrapper. Existing request JSON and receipts are untouched.
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

CREATE OR REPLACE FUNCTION public.mn_gm_material_drafts_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_terrain jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'GM terrain material draft storage is not ready' USING ERRCODE = '42501'; END IF;
  v_terrain := public.mn_gm_terrain_drafts_ready();
  IF v_terrain IS DISTINCT FROM pg_catalog.jsonb_build_object('version',1,'terrainVersion',1) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='public.mn_gm_draft_operations'::regclass
         AND c.conname='mn_gm_draft_operations_request_check' AND c.convalidated
         AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%mn_valid_gm_draft_request%') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid='public.mn_valid_gm_draft_request(uuid,jsonb)'::regprocedure
         AND p.provolatile='i' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid='public.mn_valid_gm_draft_request_v3(uuid,jsonb)'::regprocedure
         AND p.provolatile='i' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
     pg_catalog.has_function_privilege('service_role','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('service_role','public.mn_valid_gm_draft_request_v3(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('anon','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('anon','public.mn_valid_gm_draft_request_v3(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated','public.mn_valid_gm_draft_request_v3(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'GM terrain material draft storage is not ready' USING ERRCODE = '42501';
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1,'terrainVersion',2);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb),
  public.mn_valid_gm_draft_request_v3(uuid,jsonb), public.mn_gm_material_drafts_ready()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_gm_material_drafts_ready() TO service_role;

COMMIT;

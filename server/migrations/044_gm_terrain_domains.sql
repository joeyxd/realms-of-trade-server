-- GM11b3b: grown terrain domains for private GM draft documents v6.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request_v5(uuid,jsonb)') IS NULL AND
     pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request(uuid,jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb) RENAME TO mn_valid_gm_draft_request_v5;
  END IF;
END
$rename$;

-- Document v6 adds a grown domain. Tile and transform rules stay those of SQL042.
CREATE OR REPLACE FUNCTION public.mn_valid_gm_draft_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_document jsonb; v_terrain jsonb; v_tiles jsonb; v_list jsonb; v_entry jsonb; v_text text;
  v_tx_min integer; v_tx_max integer; v_tz_min integer; v_tz_max integer;
  v_tx numeric; v_tz numeric; v_bytes numeric; v_y numeric; v_order numeric; v_previous numeric := -1;
  v_normalized jsonb; v_domain jsonb; v_bound numeric; v_key text;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.octet_length(p_request::text) > 5242880 OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_document := p_request->'document';
  IF pg_catalog.jsonb_typeof(v_document) IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  -- Keep SQL042 as the exact compatibility path for every non-v6 request.
  IF v_document->>'version' IS DISTINCT FROM '6' THEN
    RETURN public.mn_valid_gm_draft_request_v5(p_operation_id,p_request);
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_document)) <> 6 OR
     NOT (v_document ?& ARRAY['schema','version','base','objects','baseOverrides','terrain']) OR
     v_document->>'schema' IS DISTINCT FROM 'marea.gm.map-draft' OR
     pg_catalog.jsonb_typeof(v_document->'version') IS DISTINCT FROM 'number' OR
     v_document->>'version' IS DISTINCT FROM '6' OR
     pg_catalog.jsonb_typeof(v_document->'base') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(v_document->'base'->'revision') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(v_document->'objects') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_document->'baseOverrides') IS DISTINCT FROM 'array' THEN RETURN false; END IF;

  -- Tile key range of each base terrain revision (terrainTiles.js TERRAIN_DOMAINS and terrainTileRange):
  -- terrain-s21-v1 is X, Z [-280, 280] with 70 m tiles, so tx and tz -4..3. An unknown revision has no domain.
  CASE v_document->'base'->>'revision'
    WHEN 'terrain-s21-v1' THEN v_tx_min := -4; v_tx_max := 3; v_tz_min := -4; v_tz_max := 3;
    ELSE RETURN false;
  END CASE;

  v_terrain := v_document->'terrain';
  IF pg_catalog.jsonb_typeof(v_terrain) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_terrain)) <> 4 OR
     NOT (v_terrain ?& ARRAY['version','tileSize','domain','tiles']) OR
     pg_catalog.jsonb_typeof(v_terrain->'version') IS DISTINCT FROM 'number' OR
     v_terrain->>'version' IS DISTINCT FROM '4' OR
     pg_catalog.jsonb_typeof(v_terrain->'tileSize') IS DISTINCT FROM 'number' OR
     v_terrain->>'tileSize' IS DISTINCT FROM '70' OR
     pg_catalog.jsonb_typeof(v_terrain->'tiles') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  v_domain := v_terrain->'domain';
  IF pg_catalog.jsonb_typeof(v_domain) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_domain)) <> 4 OR
     NOT (v_domain ?& ARRAY['minTx','maxTx','minTz','maxTz']) THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['minTx','maxTx','minTz','maxTz'] LOOP
    IF pg_catalog.jsonb_typeof(v_domain->v_key) IS DISTINCT FROM 'number' OR
       (v_domain->>v_key) !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
    v_bound := (v_domain->>v_key)::numeric;
    IF v_bound < -64 OR v_bound > 63 THEN RETURN false; END IF;
  END LOOP;
  IF (v_domain->>'minTx')::integer > v_tx_min OR (v_domain->>'maxTx')::integer < v_tx_max OR
     (v_domain->>'minTz')::integer > v_tz_min OR (v_domain->>'maxTz')::integer < v_tz_max OR
     ((v_domain->>'minTx')::integer = v_tx_min AND (v_domain->>'maxTx')::integer = v_tx_max AND
      (v_domain->>'minTz')::integer = v_tz_min AND (v_domain->>'maxTz')::integer = v_tz_max) THEN RETURN false; END IF;
  v_tx_min := (v_domain->>'minTx')::integer; v_tx_max := (v_domain->>'maxTx')::integer;
  v_tz_min := (v_domain->>'minTz')::integer; v_tz_max := (v_domain->>'maxTz')::integer;
  IF v_tx_min > v_tx_max OR v_tz_min > v_tz_max OR
     v_tx_max - v_tx_min + 1 > 32 OR v_tz_max - v_tz_min + 1 > 32 THEN RETURN false; END IF;
  v_tiles := v_terrain->'tiles';
  IF pg_catalog.jsonb_array_length(v_tiles) > 256 THEN RETURN false; END IF;
  -- Entries [tx, tz, sha256, bytes]: sorted by tz then tx and unique (strictly increasing row-major order), keys in
  -- the domain, lowercase sha256 hex, bytes 13..65536 (the table's length bounds: a shorter tile cannot exist).
  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(v_tiles) WITH ORDINALITY AS t(value,ordinality)
    ORDER BY ordinality LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(v_entry) <> 4 OR
       pg_catalog.jsonb_typeof(v_entry->0) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_entry->1) IS DISTINCT FROM 'number' OR
       pg_catalog.jsonb_typeof(v_entry->2) IS DISTINCT FROM 'string' OR
       pg_catalog.jsonb_typeof(v_entry->3) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v_text := v_entry->>0; IF v_text !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_tx := v_text::numeric;
    v_text := v_entry->>1; IF v_text !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_tz := v_text::numeric;
    IF v_tx < v_tx_min OR v_tx > v_tx_max OR v_tz < v_tz_min OR v_tz > v_tz_max THEN RETURN false; END IF;
    v_order := (v_tz - v_tz_min) * (v_tx_max - v_tx_min + 1) + v_tx - v_tx_min;
    IF v_order <= v_previous THEN RETURN false; END IF;
    v_previous := v_order;
    IF (v_entry->>2) !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
    v_text := v_entry->>3; IF v_text !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF; v_bytes := v_text::numeric;
    IF v_bytes < 13 OR v_bytes > 65536 THEN RETURN false; END IF;
  END LOOP;

  -- GM07 D4: y in [-64, 256] for every transform (document.js validateTransform: placed objects and base overrides).
  FOR v_list IN SELECT v_document->'objects' UNION ALL SELECT v_document->'baseOverrides' LOOP
    FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(v_list) AS o(value) LOOP
      IF pg_catalog.jsonb_typeof(v_entry->'transform'->'position'->'y') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      v_y := (v_entry->'transform'->'position'->>'y')::numeric;
      IF v_y < -64 OR v_y > 256 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;

  -- Reuse SQL033's v4 checks (and through them SQL031's v3 and SQL020's v2) for the rest of the document.
  v_normalized := pg_catalog.jsonb_set(p_request, '{document}',
    v_document || pg_catalog.jsonb_build_object('version',4,'terrain',
      pg_catalog.jsonb_build_object('version',2,'samples','[]'::jsonb,'materials','[]'::jsonb)), false);
  RETURN public.mn_valid_gm_draft_request_v4(p_operation_id,v_normalized);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN
  RETURN false;
END
$function$;

-- Rebind the receipt constraint to the v6-aware wrapper. Existing request JSON and receipts are untouched.
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

-- SQL042 save, with only the tile-presence branch extended to document v6.
CREATE OR REPLACE FUNCTION public.mn_save_gm_draft(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_row public.mn_gm_drafts%ROWTYPE;
  v_world text; v_owner uuid; v_expected integer; v_revision integer; v_saved_at timestamptz;
  v_missing jsonb;
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

  IF p_request->'document'->>'version' IN ('5','6') THEN
    -- The shared world lock is held to commit: the collector in mn_put_gm_terrain_tiles takes it exclusively, so it
    -- cannot delete a tile checked here before the head that references it is visible.
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('mn-gm-tiles:' || v_world,0));
    SELECT pg_catalog.jsonb_agg(m.sha256 ORDER BY m.sha256 COLLATE "C") INTO v_missing FROM (
      SELECT DISTINCT r.value->>2 AS sha256
      FROM pg_catalog.jsonb_array_elements(p_request->'document'->'terrain'->'tiles') r(value)
      WHERE NOT EXISTS (SELECT 1 FROM public.mn_gm_terrain_tiles t
        WHERE t.world=v_world AND t.sha256=r.value->>2
          AND pg_catalog.octet_length(t.bytes)=(r.value->>3)::integer)) m;
    IF v_missing IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','tiles_missing','missing',v_missing);
    END IF;
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

-- Optional readiness: existing draft versions keep their own migration requirements.
CREATE OR REPLACE FUNCTION public.mn_gm_terrain_domains_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_proc regprocedure; v_signature text; v_validator boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'GM terrain domains are not ready' USING ERRCODE = '42501';
  END IF;
  IF public.mn_gm_terrain_tiles_ready() IS DISTINCT FROM pg_catalog.jsonb_build_object('version',1) THEN
    RAISE EXCEPTION 'GM terrain domains are not ready' USING ERRCODE = '42501';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.mn_valid_gm_draft_request(uuid,jsonb)',
    'public.mn_valid_gm_draft_request_v5(uuid,jsonb)',
    'public.mn_valid_gm_draft_request_v4(uuid,jsonb)',
    'public.mn_save_gm_draft(uuid,jsonb)',
    'public.mn_gm_terrain_domains_ready()'
  ] LOOP
    v_proc := pg_catalog.to_regprocedure(v_signature);
    v_validator := v_signature LIKE 'public.mn_valid_%';
    IF v_proc IS NULL OR
       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_proc
         AND p.prorettype=CASE WHEN v_validator THEN 'boolean'::regtype ELSE 'jsonb'::regtype END
         AND p.provolatile=CASE WHEN v_validator THEN 'i' WHEN v_signature LIKE '%domains_ready%' THEN 's' ELSE 'v' END
         AND p.prosecdef=(v_signature NOT LIKE '%domains_ready%') AND p.proconfig @> ARRAY['search_path=""']) OR
       pg_catalog.has_function_privilege('service_role',v_proc,'EXECUTE')=v_validator OR
       pg_catalog.has_function_privilege('anon',v_proc,'EXECUTE') OR
       pg_catalog.has_function_privilege('authenticated',v_proc,'EXECUTE') OR
       EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
         WHERE p.oid=v_proc AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'GM terrain domains are not ready' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('version',1);
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'GM terrain domains are not ready' USING ERRCODE = '42501';
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb), public.mn_valid_gm_draft_request_v5(uuid,jsonb),
  public.mn_save_gm_draft(uuid,jsonb), public.mn_gm_terrain_domains_ready()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mn_save_gm_draft(uuid,jsonb), public.mn_gm_terrain_domains_ready() TO service_role;

COMMIT;

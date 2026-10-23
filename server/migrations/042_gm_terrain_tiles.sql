-- GM07b2 (docs/briefs/gm07b2-server.md S1, S2, S9): content-addressed terrain tiles for private GM draft documents v5.
-- A client uploads tiles first (mn_put_gm_terrain_tiles); a v5 save then references them by sha256 and answers
-- tiles_missing, before any receipt is written, while one is absent, so the same operation id succeeds after the upload.
-- SQL020/031/033 receipts, validators and readiness contracts are kept unchanged.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_gm_terrain_tiles (
  world text NOT NULL CONSTRAINT mn_gm_terrain_tiles_world_check CHECK (world ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  sha256 text NOT NULL CONSTRAINT mn_gm_terrain_tiles_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bytea NOT NULL CONSTRAINT mn_gm_terrain_tiles_bytes_check
    CHECK (pg_catalog.octet_length(bytes) BETWEEN 13 AND 65536),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (world, sha256),
  CONSTRAINT mn_gm_terrain_tiles_hash_check CHECK (pg_catalog.sha256(bytes) = pg_catalog.decode(sha256, 'hex'))
);

ALTER TABLE public.mn_gm_terrain_tiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_gm_terrain_tiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.mn_gm_terrain_tiles TO service_role;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request_v4(uuid,jsonb)') IS NULL AND
     pg_catalog.to_regprocedure('public.mn_valid_gm_draft_request(uuid,jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb) RENAME TO mn_valid_gm_draft_request_v4;
  END IF;
END
$rename$;

-- Document v5 (GM07 D7): terrain {version: 3, tileSize: 70, tiles: [[tx, tz, sha256, bytes], ...]} as
-- src/editor/terrainTiles.js validateTerrainTiles checks it, plus the object y range of D4. Structural and table-free:
-- it sits in the receipt CHECK; whether the tiles exist is mn_save_gm_draft's job.
CREATE OR REPLACE FUNCTION public.mn_valid_gm_draft_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_document jsonb; v_terrain jsonb; v_tiles jsonb; v_list jsonb; v_entry jsonb; v_text text;
  v_tx_min integer; v_tx_max integer; v_tz_min integer; v_tz_max integer;
  v_tx numeric; v_tz numeric; v_bytes numeric; v_y numeric; v_order numeric; v_previous numeric := -1;
  v_normalized jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_request IS NULL OR pg_catalog.octet_length(p_request::text) > 5242880 OR
     pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_document := p_request->'document';
  IF pg_catalog.jsonb_typeof(v_document) IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  -- Keep SQL033 as the exact compatibility path for all existing v2, v3 and v4 requests.
  IF v_document->>'version' IS DISTINCT FROM '5' THEN
    RETURN public.mn_valid_gm_draft_request_v4(p_operation_id,p_request);
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_document)) <> 6 OR
     NOT (v_document ?& ARRAY['schema','version','base','objects','baseOverrides','terrain']) OR
     v_document->>'schema' IS DISTINCT FROM 'marea.gm.map-draft' OR
     pg_catalog.jsonb_typeof(v_document->'version') IS DISTINCT FROM 'number' OR
     v_document->>'version' IS DISTINCT FROM '5' OR
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
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_terrain)) <> 3 OR
     NOT (v_terrain ?& ARRAY['version','tileSize','tiles']) OR
     pg_catalog.jsonb_typeof(v_terrain->'version') IS DISTINCT FROM 'number' OR
     v_terrain->>'version' IS DISTINCT FROM '3' OR
     pg_catalog.jsonb_typeof(v_terrain->'tileSize') IS DISTINCT FROM 'number' OR
     v_terrain->>'tileSize' IS DISTINCT FROM '70' OR
     pg_catalog.jsonb_typeof(v_terrain->'tiles') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
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

-- Rebind the receipt constraint to the v5-aware wrapper. Existing request JSON and receipts are untouched.
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

-- SQL020's save with one addition: a v5 request whose tiles are not all stored for its world (with the declared
-- length) answers tiles_missing after the replay lookup and before any receipt or head is written.
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

  IF p_request->'document'->>'version' = '5' THEN
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

-- Store up to 16 tiles of one world: p_tiles = [{sha256, b64}] with standard base64 bytes. Node has already decoded
-- and re-encoded every tile (S3); SQL keeps the identity and size rules. A re-upload refreshes created_at, so the
-- collector never takes a tile a following save needs. Then the bounded collector: at most 256 tiles of this world
-- older than 24 h that no draft head of the world references (document->terrain->tiles[*][2]). No timer, no cron.
CREATE OR REPLACE FUNCTION public.mn_put_gm_terrain_tiles(p_world text, p_tiles jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_entry jsonb; v_hash text; v_bytes bytea; v_hashes text[] := ARRAY[]::text[];
  v_blobs bytea[] := ARRAY[]::bytea[]; v_stored integer;
BEGIN
  -- Read committed only (as SQL020's save): the collector's statement snapshot must follow the world lock.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'GM terrain tiles need read committed' USING ERRCODE = '25000';
  END IF;
  IF p_world IS NULL OR p_world !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' OR
     pg_catalog.jsonb_typeof(p_tiles) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(p_tiles) NOT BETWEEN 1 AND 16 THEN
    RAISE EXCEPTION 'invalid GM terrain tile batch' USING ERRCODE = 'MNG03';
  END IF;
  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_tiles) WITH ORDINALITY AS t(value,ordinality)
    ORDER BY ordinality LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_entry)) <> 2 OR
       NOT (v_entry ?& ARRAY['sha256','b64']) OR
       pg_catalog.jsonb_typeof(v_entry->'sha256') IS DISTINCT FROM 'string' OR
       pg_catalog.jsonb_typeof(v_entry->'b64') IS DISTINCT FROM 'string' OR
       (v_entry->>'sha256') !~ '^[0-9a-f]{64}$' OR
       pg_catalog.char_length(v_entry->>'b64') > 87384 THEN
      RAISE EXCEPTION 'invalid GM terrain tile' USING ERRCODE = 'MNG03';
    END IF;
    v_hash := v_entry->>'sha256';
    BEGIN
      v_bytes := pg_catalog.decode(v_entry->>'b64','base64');
    EXCEPTION WHEN data_exception THEN
      RAISE EXCEPTION 'invalid GM terrain tile' USING ERRCODE = 'MNG03';
    END;
    IF pg_catalog.octet_length(v_bytes) NOT BETWEEN 13 AND 65536 OR
       pg_catalog.sha256(v_bytes) <> pg_catalog.decode(v_hash,'hex') THEN
      RAISE EXCEPTION 'invalid GM terrain tile' USING ERRCODE = 'MNG03';
    END IF;
    IF NOT (v_hash = ANY(v_hashes)) THEN
      v_hashes := v_hashes || v_hash; v_blobs := v_blobs || v_bytes;
    END IF;
  END LOOP;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-gm-tiles:' || p_world,0));
  INSERT INTO public.mn_gm_terrain_tiles(world,sha256,bytes,created_at)
    SELECT p_world, u.sha256, u.bytes, pg_catalog.now() FROM unnest(v_hashes,v_blobs) AS u(sha256,bytes)
    ON CONFLICT (world,sha256) DO UPDATE SET created_at = pg_catalog.now();
  GET DIAGNOSTICS v_stored = ROW_COUNT;

  WITH referenced AS (
    SELECT DISTINCT r.value->>2 AS sha256
    FROM public.mn_gm_drafts h
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(h.document->'terrain'->'tiles') = 'array'
        THEN h.document->'terrain'->'tiles' ELSE '[]'::jsonb END) r(value)
    WHERE h.world = p_world
  ), doomed AS (
    SELECT t.sha256 FROM public.mn_gm_terrain_tiles t
    WHERE t.world = p_world AND t.created_at < pg_catalog.now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM referenced x WHERE x.sha256 = t.sha256)
    ORDER BY t.created_at, t.sha256 COLLATE "C"
    LIMIT 256
  )
  DELETE FROM public.mn_gm_terrain_tiles d USING doomed WHERE d.world = p_world AND d.sha256 = doomed.sha256;

  RETURN pg_catalog.jsonb_build_object('ok',true,'stored',v_stored);
END
$function$;

-- The stored tiles of one world among at most 64 hashes: [{sha256, b64}] in hash order, base64 without line breaks
-- (encode() wraps every 76 characters).
CREATE OR REPLACE FUNCTION public.mn_get_gm_terrain_tiles(p_world text, p_hashes text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_world IS NULL OR p_world !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' OR p_hashes IS NULL OR
     pg_catalog.cardinality(p_hashes) > 64 OR COALESCE(pg_catalog.array_ndims(p_hashes),1) <> 1 OR
     EXISTS (SELECT 1 FROM pg_catalog.unnest(p_hashes) AS h(value) WHERE h.value IS NULL OR h.value !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid GM terrain tile request' USING ERRCODE = 'MNG03';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('sha256',t.sha256,
      'b64',pg_catalog.replace(pg_catalog.encode(t.bytes,'base64'),E'\n','')) ORDER BY t.sha256 COLLATE "C")
    FROM public.mn_gm_terrain_tiles t WHERE t.world = p_world AND t.sha256 = ANY(p_hashes)), '[]'::jsonb);
END
$function$;

-- Readiness of draft tiles (S9), separate from mn_gm_drafts_ready so v2-v4 drafts keep working without this migration:
-- the SQL033 chain, the tile table, its rules and privileges, the three tile RPCs, the v5 validator chain and the
-- receipt constraint bound to it, and the SQL042 save.
CREATE OR REPLACE FUNCTION public.mn_gm_terrain_tiles_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_table regclass := pg_catalog.to_regclass('public.mn_gm_terrain_tiles');
  v_roles text[] := ARRAY['anon','authenticated'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_role text; v_privilege text; v_proc regprocedure; v_primary_key text[];
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501'; END IF;
  IF public.mn_gm_material_drafts_ready() IS DISTINCT FROM pg_catalog.jsonb_build_object('version',1,'terrainVersion',2) OR
     v_table IS NULL OR
     COALESCE((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid=v_table),false) IS DISTINCT FROM true OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table
       AND a.attnum>0 AND NOT a.attisdropped) <> 4 OR
     EXISTS (
       SELECT 1 FROM (VALUES ('world','text'::regtype),('sha256','text'::regtype),
         ('bytes','bytea'::regtype),('created_at','timestamptz'::regtype)) expected(name,typ)
       LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_table AND a.attname=expected.name
         AND a.attnum>0 AND NOT a.attisdropped
       WHERE a.attname IS NULL OR a.atttypid<>expected.typ OR NOT a.attnotnull) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_table AND c.contype='c'
       AND c.convalidated AND c.conname IN ('mn_gm_terrain_tiles_world_check','mn_gm_terrain_tiles_sha256_check',
         'mn_gm_terrain_tiles_bytes_check','mn_gm_terrain_tiles_hash_check')) <> 4 THEN
    RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO v_primary_key
  FROM pg_catalog.pg_constraint c
  CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.conrelid=v_table AND c.contype='p';
  IF v_primary_key IS DISTINCT FROM ARRAY['world','sha256']::text[] OR
     NOT pg_catalog.has_table_privilege('service_role',v_table,'SELECT') THEN
    RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
  END IF;
  FOREACH v_privilege IN ARRAY v_privileges LOOP
    IF v_privilege <> 'SELECT' AND pg_catalog.has_table_privilege('service_role',v_table,v_privilege) THEN
      RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
    END IF;
    FOREACH v_role IN ARRAY v_roles LOOP
      IF pg_catalog.has_table_privilege(v_role,v_table,v_privilege) THEN
        RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_proc IN ARRAY ARRAY[
    'public.mn_gm_terrain_tiles_ready()'::regprocedure,
    'public.mn_put_gm_terrain_tiles(text,jsonb)'::regprocedure,
    'public.mn_get_gm_terrain_tiles(text,text[])'::regprocedure,
    'public.mn_save_gm_draft(uuid,jsonb)'::regprocedure
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('service_role',v_proc,'EXECUTE') OR
       pg_catalog.has_function_privilege('anon',v_proc,'EXECUTE') OR
       pg_catalog.has_function_privilege('authenticated',v_proc,'EXECUTE') OR
       EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
         WHERE p.oid=v_proc AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  FOREACH v_proc IN ARRAY ARRAY[
    'public.mn_valid_gm_draft_request(uuid,jsonb)'::regprocedure,
    'public.mn_valid_gm_draft_request_v4(uuid,jsonb)'::regprocedure
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_proc
         AND p.provolatile='i' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) OR
       pg_catalog.has_function_privilege('service_role',v_proc,'EXECUTE') OR
       pg_catalog.has_function_privilege('anon',v_proc,'EXECUTE') OR
       pg_catalog.has_function_privilege('authenticated',v_proc,'EXECUTE') THEN
      RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
       WHERE p.oid IN ('public.mn_put_gm_terrain_tiles(text,jsonb)'::regprocedure,
         'public.mn_get_gm_terrain_tiles(text,text[])'::regprocedure)
         AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) <> 2 OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid='public.mn_save_gm_draft(uuid,jsonb)'::regprocedure
         AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND p.prosrc LIKE '%tiles_missing%') OR
     -- The receipt CHECK must call the v5 wrapper itself, not the renamed SQL033 function.
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_constraint'::regclass AND d.objid=c.oid
         AND d.refclassid='pg_catalog.pg_proc'::regclass
         AND d.refobjid='public.mn_valid_gm_draft_request(uuid,jsonb)'::regprocedure
       WHERE c.conrelid='public.mn_gm_draft_operations'::regclass
         AND c.conname='mn_gm_draft_operations_request_check' AND c.convalidated) THEN
    RAISE EXCEPTION 'GM terrain tile storage is not ready' USING ERRCODE = '42501';
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_gm_draft_request(uuid,jsonb), public.mn_valid_gm_draft_request_v4(uuid,jsonb),
  public.mn_save_gm_draft(uuid,jsonb), public.mn_put_gm_terrain_tiles(text,jsonb),
  public.mn_get_gm_terrain_tiles(text,text[]), public.mn_gm_terrain_tiles_ready()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mn_save_gm_draft(uuid,jsonb), public.mn_put_gm_terrain_tiles(text,jsonb),
  public.mn_get_gm_terrain_tiles(text,text[]), public.mn_gm_terrain_tiles_ready() TO service_role;

COMMIT;

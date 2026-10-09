-- W01: isolated durable registry for premium equipment and plots.
-- This migration intentionally does not reference game tables or wallet/token data.

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'W01 requires Supabase roles anon, authenticated, and service_role';
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS mn_web3_private;
REVOKE ALL ON SCHEMA mn_web3_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA mn_web3_private TO service_role;

CREATE TABLE IF NOT EXISTS mn_web3_private.assets (
  asset_id uuid PRIMARY KEY,
  world_id text NOT NULL CHECK (world_id ~ '^[A-Za-z0-9:_-]{1,100}$'),
  world_generation uuid NOT NULL CHECK (world_generation <> '00000000-0000-0000-0000-000000000000'::uuid),
  asset_class text NOT NULL CHECK (asset_class IN ('equipment', 'plot')),
  source_key text NOT NULL CHECK (source_key ~ '^[A-Za-z0-9:_-]{1,160}$'),
  content_id text NOT NULL CHECK (content_id ~ '^[A-Za-z0-9:_-]{1,100}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  rights_hash text NOT NULL CHECK (rights_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid NOT NULL CHECK (owner_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  CONSTRAINT mn_web3_assets_source_unique UNIQUE (world_id, world_generation, asset_class, source_key)
);

DO $asset_id_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'mn_web3_private.assets'::regclass AND conname = 'mn_web3_assets_nonzero_id'
  ) THEN
    ALTER TABLE mn_web3_private.assets ADD CONSTRAINT mn_web3_assets_nonzero_id
      CHECK (asset_id <> '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;
END
$asset_id_constraint$;

CREATE TABLE IF NOT EXISTS mn_web3_private.operations (
  operation_id uuid PRIMARY KEY CHECK (operation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  state text NOT NULL CHECK (state IN ('pending', 'committed', 'rejected', 'cancelled')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((state = 'pending' AND result IS NULL) OR (state <> 'pending' AND result IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS mn_web3_private.reservations (
  operation_id uuid PRIMARY KEY REFERENCES mn_web3_private.operations(operation_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  world_id text NOT NULL,
  world_generation uuid NOT NULL,
  asset_class text NOT NULL,
  source_key text NOT NULL,
  CONSTRAINT mn_web3_reservations_asset_unique UNIQUE (asset_id),
  CONSTRAINT mn_web3_reservations_source_unique UNIQUE (world_id, world_generation, asset_class, source_key)
);

CREATE INDEX IF NOT EXISTS mn_web3_operations_pending_order
  ON mn_web3_private.operations (operation_id) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS mn_web3_reservations_asset_lookup
  ON mn_web3_private.reservations (asset_id);

ALTER TABLE mn_web3_private.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mn_web3_private.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mn_web3_private.reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mn_web3_service_select_assets ON mn_web3_private.assets;
CREATE POLICY mn_web3_service_select_assets ON mn_web3_private.assets
  FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS mn_web3_service_select_operations ON mn_web3_private.operations;
CREATE POLICY mn_web3_service_select_operations ON mn_web3_private.operations
  FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS mn_web3_service_select_reservations ON mn_web3_private.reservations;
CREATE POLICY mn_web3_service_select_reservations ON mn_web3_private.reservations
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON ALL TABLES IN SCHEMA mn_web3_private FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON mn_web3_private.assets, mn_web3_private.operations, mn_web3_private.reservations TO service_role;

CREATE OR REPLACE FUNCTION mn_web3_private.validate_request(p_request jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_action text;
  v_expected text[];
  v_key text;
  v_value jsonb;
  v_text text;
  v_version numeric;
BEGIN
  IF p_request IS NULL OR pg_catalog.jsonb_typeof(p_request) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;

  v_action := p_request ->> 'action';
  IF v_action = 'register' THEN
    v_expected := ARRAY['operationId','action','assetId','worldId','worldGeneration','assetClass',
                        'sourceKey','contentId','contentHash','rightsHash','to'];
  ELSIF v_action = 'transfer' THEN
    v_expected := ARRAY['operationId','action','assetId','worldId','worldGeneration','from','to','expectedVersion'];
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> pg_catalog.cardinality(v_expected)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_request) AS k(key)
       WHERE NOT (k.key = ANY (v_expected))
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['operationId','assetId','worldGeneration','to'] ||
    CASE WHEN v_action = 'transfer' THEN ARRAY['from'] ELSE ARRAY[]::text[] END
  LOOP
    v_value := p_request -> v_key;
    IF pg_catalog.jsonb_typeof(v_value) <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
    v_text := v_value #>> '{}';
    IF v_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR v_text = '00000000-0000-0000-0000-000000000000' THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
  END LOOP;

  IF p_request ->> 'to' = p_request ->> 'from' AND v_action = 'transfer' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['worldId','sourceKey','contentId'] LOOP
    IF v_action = 'transfer' AND v_key <> 'worldId' THEN CONTINUE; END IF;
    v_value := p_request -> v_key;
    IF pg_catalog.jsonb_typeof(v_value) <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
    v_text := v_value #>> '{}';
    IF (v_key = 'sourceKey' AND v_text !~ '^[A-Za-z0-9:_-]{1,160}$')
       OR (v_key <> 'sourceKey' AND v_text !~ '^[A-Za-z0-9:_-]{1,100}$') THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
  END LOOP;

  IF v_action = 'register' THEN
    IF pg_catalog.jsonb_typeof(p_request -> 'assetClass') <> 'string'
       OR p_request ->> 'assetClass' NOT IN ('equipment','plot')
       OR pg_catalog.jsonb_typeof(p_request -> 'contentHash') <> 'string'
       OR (p_request ->> 'contentHash') !~ '^[0-9a-f]{64}$'
       OR pg_catalog.jsonb_typeof(p_request -> 'rightsHash') <> 'string'
       OR (p_request ->> 'rightsHash') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
  ELSE
    v_value := p_request -> 'expectedVersion';
    IF pg_catalog.jsonb_typeof(v_value) <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
    v_text := v_value #>> '{}';
    IF v_text !~ '^[0-9]+([.]0+)?$' THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
    BEGIN
      v_version := v_text::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END;
    IF v_version < 1 OR v_version >= 2147483647 OR v_version <> pg_catalog.trunc(v_version) THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
    END IF;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION mn_web3_private.asset_json(p_asset mn_web3_private.assets)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'assetId', p_asset.asset_id, 'worldId', p_asset.world_id,
    'worldGeneration', p_asset.world_generation, 'assetClass', p_asset.asset_class,
    'sourceKey', p_asset.source_key, 'contentId', p_asset.content_id,
    'contentHash', p_asset.content_hash, 'rightsHash', p_asset.rights_hash,
    'ownerId', p_asset.owner_id, 'version', p_asset.version
  )
$fn$;

CREATE OR REPLACE FUNCTION mn_web3_private.operation_json(p_operation mn_web3_private.operations)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_operation.operation_id, 'request', p_operation.request,
    'state', p_operation.state, 'result', p_operation.result
  )
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_prepare(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_action text;
  v_operation_id uuid;
  v_asset_id uuid;
  v_generation uuid;
  v_owner uuid;
  v_from uuid;
  v_world text;
  v_class text;
  v_source text;
  v_content text;
  v_content_hash text;
  v_rights_hash text;
  v_version integer;
  v_existing mn_web3_private.operations%ROWTYPE;
  v_asset mn_web3_private.assets%ROWTYPE;
  v_has_asset boolean := false;
  v_lock_world text;
  v_lock_generation uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW02', MESSAGE = 'isolation';
  END IF;
  PERFORM mn_web3_private.validate_request(p_request);
  v_action := p_request ->> 'action';
  v_operation_id := (p_request ->> 'operationId')::uuid;
  v_asset_id := (p_request ->> 'assetId')::uuid;
  v_generation := (p_request ->> 'worldGeneration')::uuid;
  v_world := p_request ->> 'worldId';
  v_owner := (p_request ->> 'to')::uuid;

  -- Every mutator takes operation, asset, then source locks in this order.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:operation:' || v_operation_id::text, 0));
  SELECT * INTO v_existing FROM mn_web3_private.operations WHERE operation_id = v_operation_id;
  IF FOUND THEN
    IF v_existing.request = p_request THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', true,
        'operation', mn_web3_private.operation_json(v_existing));
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'operation');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:asset:' || v_asset_id::text, 0));

  IF v_action = 'register' THEN
    v_class := p_request ->> 'assetClass';
    v_source := p_request ->> 'sourceKey';
    v_content := p_request ->> 'contentId';
    v_content_hash := p_request ->> 'contentHash';
    v_rights_hash := p_request ->> 'rightsHash';
    v_lock_world := v_world;
    v_lock_generation := v_generation;
  ELSE
    v_from := (p_request ->> 'from')::uuid;
    v_version := ((p_request ->> 'expectedVersion')::numeric)::integer;
    SELECT * INTO v_asset FROM mn_web3_private.assets WHERE asset_id = v_asset_id;
    v_has_asset := FOUND;
    IF v_has_asset THEN
      v_class := v_asset.asset_class;
      v_source := v_asset.source_key;
      v_lock_world := v_asset.world_id;
      v_lock_generation := v_asset.world_generation;
    END IF;
  END IF;

  IF v_action = 'register' OR v_has_asset THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'mn-web3:source:' || v_lock_world || ':' || v_lock_generation::text || ':' || v_class || ':' || v_source, 0));
  END IF;

  IF EXISTS (SELECT 1 FROM mn_web3_private.reservations r WHERE r.asset_id = v_asset_id)
     OR ((v_action = 'register' OR v_has_asset) AND EXISTS (SELECT 1 FROM mn_web3_private.reservations r
       WHERE r.world_id = v_lock_world AND r.world_generation = v_lock_generation
         AND r.asset_class = v_class AND r.source_key = v_source)) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'busy');
  END IF;

  IF v_action = 'register' THEN
    IF EXISTS (SELECT 1 FROM mn_web3_private.assets a WHERE a.asset_id = v_asset_id) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'conflict');
    END IF;
    IF EXISTS (SELECT 1 FROM mn_web3_private.assets a WHERE a.world_id = v_world
       AND a.world_generation = v_generation AND a.asset_class = v_class AND a.source_key = v_source) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'identity');
    END IF;
  ELSE
    IF NOT v_has_asset OR v_asset.world_id <> v_world OR v_asset.world_generation <> v_generation
       OR v_asset.version <> v_version THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'conflict');
    END IF;
    IF v_asset.owner_id <> v_from THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'ownership');
    END IF;
  END IF;

  INSERT INTO mn_web3_private.operations(operation_id, request, state, result)
  VALUES (v_operation_id, p_request, 'pending', NULL);
  INSERT INTO mn_web3_private.reservations(operation_id, asset_id, world_id, world_generation, asset_class, source_key)
  VALUES (v_operation_id, v_asset_id, v_world, v_generation, v_class, v_source);
  SELECT * INTO v_existing FROM mn_web3_private.operations WHERE operation_id = v_operation_id;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', false,
    'operation', mn_web3_private.operation_json(v_existing));
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_commit(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_operation mn_web3_private.operations%ROWTYPE;
  v_reservation mn_web3_private.reservations%ROWTYPE;
  v_asset mn_web3_private.assets%ROWTYPE;
  v_request jsonb;
  v_result jsonb;
  v_action text;
  v_owner uuid;
  v_from uuid;
  v_expected integer;
  v_why text;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW02', MESSAGE = 'isolation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:operation:' || p_operation_id::text, 0));
  SELECT * INTO v_operation FROM mn_web3_private.operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'missing'); END IF;
  IF v_operation.state <> 'pending' THEN
    RETURN v_operation.result || pg_catalog.jsonb_build_object('replay', true);
  END IF;
  SELECT * INTO v_reservation FROM mn_web3_private.reservations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'response';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:asset:' || v_reservation.asset_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'mn-web3:source:' || v_reservation.world_id || ':' || v_reservation.world_generation::text || ':' ||
    v_reservation.asset_class || ':' || v_reservation.source_key, 0));
  SELECT * INTO v_asset FROM mn_web3_private.assets WHERE asset_id = v_reservation.asset_id FOR UPDATE;
  v_request := v_operation.request;
  v_action := v_request ->> 'action';
  v_owner := (v_request ->> 'to')::uuid;

  IF v_action = 'register' THEN
    IF FOUND OR EXISTS (SELECT 1 FROM mn_web3_private.assets a WHERE a.world_id = v_reservation.world_id
       AND a.world_generation = v_reservation.world_generation AND a.asset_class = v_reservation.asset_class
       AND a.source_key = v_reservation.source_key) THEN
      v_why := CASE WHEN FOUND THEN 'conflict' ELSE 'identity' END;
    ELSE
      INSERT INTO mn_web3_private.assets(asset_id, world_id, world_generation, asset_class, source_key,
        content_id, content_hash, rights_hash, owner_id, version)
      VALUES ((v_request ->> 'assetId')::uuid, v_request ->> 'worldId',
        (v_request ->> 'worldGeneration')::uuid, v_request ->> 'assetClass', v_request ->> 'sourceKey',
        v_request ->> 'contentId', v_request ->> 'contentHash', v_request ->> 'rightsHash', v_owner, 1)
      RETURNING * INTO v_asset;
    END IF;
  ELSE
    v_from := (v_request ->> 'from')::uuid;
    v_expected := ((v_request ->> 'expectedVersion')::numeric)::integer;
    IF NOT FOUND OR v_asset.world_id <> v_request ->> 'worldId'
       OR v_asset.world_generation <> (v_request ->> 'worldGeneration')::uuid
       OR v_asset.version <> v_expected THEN
      v_why := 'conflict';
    ELSIF v_asset.owner_id <> v_from THEN
      v_why := 'ownership';
    ELSE
      UPDATE mn_web3_private.assets SET owner_id = v_owner, version = version + 1
      WHERE asset_id = v_asset.asset_id RETURNING * INTO v_asset;
    END IF;
  END IF;

  IF v_why IS NULL THEN
    v_result := pg_catalog.jsonb_build_object('ok', true, 'asset', mn_web3_private.asset_json(v_asset));
    UPDATE mn_web3_private.operations SET state = 'committed', result = v_result,
      updated_at = pg_catalog.clock_timestamp() WHERE operation_id = p_operation_id RETURNING * INTO v_operation;
    DELETE FROM mn_web3_private.reservations WHERE operation_id = p_operation_id;
    RETURN v_result || pg_catalog.jsonb_build_object('replay', false);
  END IF;

  v_result := pg_catalog.jsonb_build_object('ok', false, 'why', v_why);
  UPDATE mn_web3_private.operations SET state = 'rejected', result = v_result,
    updated_at = pg_catalog.clock_timestamp() WHERE operation_id = p_operation_id RETURNING * INTO v_operation;
  DELETE FROM mn_web3_private.reservations WHERE operation_id = p_operation_id;
  RETURN v_result || pg_catalog.jsonb_build_object('replay', false);
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_cancel(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_operation mn_web3_private.operations%ROWTYPE;
  v_reservation mn_web3_private.reservations%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW02', MESSAGE = 'isolation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:operation:' || p_operation_id::text, 0));
  SELECT * INTO v_operation FROM mn_web3_private.operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'replay', false, 'why', 'missing'); END IF;
  IF v_operation.state <> 'pending' THEN
    RETURN v_operation.result || pg_catalog.jsonb_build_object('replay', true);
  END IF;
  SELECT * INTO v_reservation FROM mn_web3_private.reservations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'response'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:asset:' || v_reservation.asset_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'mn-web3:source:' || v_reservation.world_id || ':' || v_reservation.world_generation::text || ':' ||
    v_reservation.asset_class || ':' || v_reservation.source_key, 0));
  v_result := pg_catalog.jsonb_build_object('ok', false, 'why', 'cancelled');
  UPDATE mn_web3_private.operations SET state = 'cancelled', result = v_result,
    updated_at = pg_catalog.clock_timestamp() WHERE operation_id = p_operation_id;
  DELETE FROM mn_web3_private.reservations WHERE operation_id = p_operation_id;
  RETURN v_result || pg_catalog.jsonb_build_object('replay', false);
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_load_asset(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_asset mn_web3_private.assets%ROWTYPE;
BEGIN
  IF p_asset_id IS NULL OR p_asset_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;
  SELECT * INTO v_asset FROM mn_web3_private.assets WHERE asset_id = p_asset_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN mn_web3_private.asset_json(v_asset);
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_load_operation(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_operation mn_web3_private.operations%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;
  SELECT * INTO v_operation FROM mn_web3_private.operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN mn_web3_private.operation_json(v_operation);
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_list_pending(
  p_world_id text, p_world_generation uuid, p_after_id uuid, p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF p_world_id IS NULL OR p_world_id !~ '^[A-Za-z0-9:_-]{1,100}$'
     OR p_world_generation IS NULL OR p_world_generation = '00000000-0000-0000-0000-000000000000'::uuid
     OR (p_after_id IS NOT NULL AND p_after_id = '00000000-0000-0000-0000-000000000000'::uuid)
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(mn_web3_private.operation_json(o) ORDER BY o.operation_id)
    FROM (
      SELECT op.* FROM mn_web3_private.operations op
      JOIN mn_web3_private.reservations r USING (operation_id)
      WHERE op.state = 'pending' AND r.world_id = p_world_id
        AND r.world_generation = p_world_generation
        AND (p_after_id IS NULL OR op.operation_id > p_after_id)
      ORDER BY op.operation_id LIMIT p_limit
    ) AS o
  ), '[]'::jsonb);
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_check_claim(p_asset_id uuid, p_owner_id uuid, p_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_asset mn_web3_private.assets%ROWTYPE;
BEGIN
  IF p_asset_id IS NULL OR p_asset_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_owner_id IS NULL OR p_owner_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW01', MESSAGE = 'input';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW02', MESSAGE = 'isolation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:asset:' || p_asset_id::text, 0));
  SELECT * INTO v_asset FROM mn_web3_private.assets WHERE asset_id = p_asset_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM mn_web3_private.reservations r WHERE r.asset_id = p_asset_id) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'busy');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'missing');
  END IF;
  IF EXISTS (SELECT 1 FROM mn_web3_private.reservations r WHERE r.asset_id = p_asset_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'busy');
  END IF;
  IF v_asset.owner_id <> p_owner_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'ownership');
  END IF;
  IF v_asset.version <> p_version THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true);
END
$fn$;

REVOKE ALL ON FUNCTION mn_web3_private.validate_request(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mn_web3_private.asset_json(mn_web3_private.assets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mn_web3_private.operation_json(mn_web3_private.operations) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mn_web3_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mn_web3_prepare(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_commit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_cancel(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_load_asset(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_load_operation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_list_pending(text, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_check_claim(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_web3_prepare(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_commit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_cancel(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_load_asset(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_load_operation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_list_pending(text, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_check_claim(uuid, uuid, integer) TO service_role;



COMMIT;

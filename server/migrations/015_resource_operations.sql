-- Add durable resource commands to the existing M5 operation authority.
-- Apply after 014; the existing operation table remains the receipt namespace.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_resource_state(p_resources jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_node jsonb; v_kind text; v_hits integer; v_id text; v_cap integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_resources) IS DISTINCT FROM 'object' OR
    NOT (p_resources ?& ARRAY['v','tick','nodes','cooldowns']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources)) <> 4 OR
    NOT public.mn_death_int(p_resources->'v',1,1) OR
    NOT public.mn_death_int(p_resources->'tick',0,9007199254740991) OR
    pg_catalog.jsonb_typeof(p_resources->'nodes') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_array_length(p_resources->'nodes') < 1 OR
    pg_catalog.jsonb_array_length(p_resources->'nodes') > 206 OR
    pg_catalog.jsonb_typeof(p_resources->'cooldowns') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources->'cooldowns')) > 4096 THEN
    RETURN false;
  END IF;

  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') LOOP
    IF pg_catalog.jsonb_typeof(v_node) IS DISTINCT FROM 'object' OR
      NOT (v_node ?& ARRAY['id','kind','rev','hits','readyAt']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_node)) <> 5 OR
      pg_catalog.jsonb_typeof(v_node->'id') IS DISTINCT FROM 'string' OR
      v_node->>'id' !~ '^[A-Za-z0-9_-]{1,40}$' OR
      pg_catalog.jsonb_typeof(v_node->'kind') IS DISTINCT FROM 'string' OR
      v_node->>'kind' NOT IN ('wood','stone','palm','rock','iron_ore') OR
      NOT public.mn_death_int(v_node->'rev',1,2147483647) OR
      NOT public.mn_death_int(v_node->'hits',0,5) OR
      NOT public.mn_death_int(v_node->'readyAt',0,9007199254740991) THEN RETURN false; END IF;
    v_kind := v_node->>'kind'; v_hits := (v_node->>'hits')::integer;
    v_cap := CASE v_kind WHEN 'palm' THEN 3 WHEN 'rock' THEN 4 WHEN 'iron_ore' THEN 5 ELSE 0 END;
    IF v_hits > v_cap THEN RETURN false; END IF;
    v_id := v_node->>'id';
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') n
        WHERE n->>'id' = v_id) <> 1 THEN RETURN false; END IF;
  END LOOP;

  FOR v_id IN SELECT key FROM pg_catalog.jsonb_each(p_resources->'cooldowns') LOOP
    IF v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
      v_id = '00000000-0000-0000-0000-000000000000' OR
      NOT public.mn_death_int(p_resources->'cooldowns'->v_id,0,9007199254740991) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

-- Keep 014's exact validators for every existing operation family. The wrapper removes only the
-- separately validated resources projection before delegating to that unchanged contract.
DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_command jsonb; v_ack jsonb; v_type text; v_op text; v_cmd_keys integer;
  v_base jsonb; v_world jsonb; v_recipe text; v_max integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_request->'worldData') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_world := p_request->'worldData';
  IF v_world ? 'resources' AND NOT public.mn_valid_resource_state(v_world->'resources') THEN RETURN false; END IF;
  v_command := p_request->'command'; v_ack := p_request->'ack';
  v_type := v_command->>'type'; v_op := v_command->>'op';
  IF v_type = 'resource' THEN
    IF NOT (v_world ? 'resources') OR pg_catalog.jsonb_typeof(v_command) IS DISTINCT FROM 'object' OR
      pg_catalog.jsonb_typeof(v_ack) IS DISTINCT FROM 'object' OR
      pg_catalog.octet_length(v_ack::text) > 32768 OR (v_ack ? 'to') OR
      NOT (v_ack ?& ARRAY['type','op','opId','ok','why','rev']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_ack)) < 6 OR
      v_ack->>'type' IS DISTINCT FROM 'resource' OR v_ack->>'op' IS DISTINCT FROM v_op OR
      v_ack->>'opId' IS DISTINCT FROM v_command->>'opId' OR
      pg_catalog.jsonb_typeof(v_ack->'ok') IS DISTINCT FROM 'boolean' OR
      pg_catalog.jsonb_typeof(v_ack->'why') IS DISTINCT FROM 'string' OR
      pg_catalog.char_length(v_ack->>'why') > 64 OR
      NOT public.mn_death_int(v_ack->'rev',0,2147483647) THEN RETURN false; END IF;

    v_cmd_keys := (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_command));
    IF pg_catalog.jsonb_typeof(v_command->'opId') IS DISTINCT FROM 'string' OR
      v_command->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' THEN RETURN false; END IF;
    IF v_op = 'gather' THEN
      IF v_cmd_keys <> 5 OR NOT (v_command ?& ARRAY['type','op','opId','node','expectedRev']) OR
        pg_catalog.jsonb_typeof(v_command->'node') IS DISTINCT FROM 'string' OR
        v_command->>'node' !~ '^[A-Za-z0-9_-]{1,40}$' OR
        NOT public.mn_death_int(v_command->'expectedRev',1,2147483646) THEN RETURN false; END IF;
    ELSIF v_op = 'craft' THEN
      v_recipe := v_command->>'recipe';
      v_max := CASE v_recipe WHEN 'madera' THEN 10 WHEN 'hacha_piedra' THEN 1 WHEN 'pico_piedra' THEN 1 ELSE 0 END;
      IF v_cmd_keys <> 6 OR NOT (v_command ?& ARRAY['type','op','opId','recipe','expectedRev','n']) OR
        v_max = 0 OR NOT public.mn_death_int(v_command->'expectedRev',0,2147483646) OR
        NOT public.mn_death_int(v_command->'n',1,v_max) THEN RETURN false; END IF;
    ELSE RETURN false;
    END IF;

    -- Use a harmless valid 014 command while retaining all common profile/world checks.
    v_base := p_request || pg_catalog.jsonb_build_object(
      'command',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',v_command->'opId',
        'town','aldea','g','madera','n',1,'expectedTotal',0),
      'ack',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',v_command->'opId',
        'ok',true,'why','','rev',0),
      'worldData',v_world - 'resources');
    RETURN public.mn_valid_economic_request_base(p_operation_id,v_base);
  END IF;

  v_base := p_request || pg_catalog.jsonb_build_object('worldData',v_world - 'resources');
  RETURN public.mn_valid_economic_request_base(p_operation_id,v_base);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_check;
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_request_check;
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request));

CREATE OR REPLACE FUNCTION public.mn_save_world(p_world text, p_data jsonb, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_version integer;
BEGIN
  IF p_world IS NULL OR pg_catalog.btrim(p_world) = '' OR pg_catalog.char_length(p_world) > 100
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object'
     OR (p_data ? 'resources' AND NOT public.mn_valid_resource_state(p_data->'resources')) THEN
    RAISE EXCEPTION 'invalid world save arguments' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version = 0 THEN
    INSERT INTO public.mn_worlds (world, economy, version, updated_at)
    VALUES (p_world, p_data, 1, pg_catalog.now())
    ON CONFLICT (world) DO NOTHING RETURNING version INTO v_version;
  ELSE
    UPDATE public.mn_worlds
    SET economy = p_data, version = version + 1, updated_at = pg_catalog.now()
    WHERE world = p_world AND version = p_expected_version
      AND (NOT (economy ? 'community') OR (p_data ? 'community' AND economy->'community' = p_data->'community'))
      AND (NOT (economy ? 'resources') OR (p_data ? 'resources' AND
        p_data->'resources'->'v' = economy->'resources'->'v' AND
        p_data->'resources'->'nodes' = economy->'resources'->'nodes' AND
        p_data->'resources'->'cooldowns' = economy->'resources'->'cooldowns' AND
        (p_data->'resources'->>'tick')::numeric >= (economy->'resources'->>'tick')::numeric))
    RETURNING version INTO v_version;
  END IF;
  IF v_version IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'version',v_version);
END
$function$;

-- Older economic callers may change their profile/economy snapshot, but cannot erase or
-- overwrite resource nodes after bootstrap. Resource operations carry the next exact resource state.
CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_profile jsonb; v_profile_version integer;
  v_world jsonb; v_world_version integer; v_account uuid; v_world_id text; v_type text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    NOT public.mn_valid_economic_request(p_operation_id,p_request) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_economic_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = p_operation_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;

  v_account := (p_request->>'account')::uuid; v_world_id := p_request->>'world';
  v_type := p_request->'command'->>'type';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:' || v_world_id,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:' || v_account::text,0));
  SELECT data,version INTO v_profile,v_profile_version FROM public.mn_profiles
    WHERE player_id = v_account FOR UPDATE;
  SELECT economy,version INTO v_world,v_world_version FROM public.mn_worlds
    WHERE world = v_world_id FOR UPDATE;
  IF v_profile_version IS NULL OR v_world_version IS NULL OR
    v_profile_version <> (p_request->>'expectedProfileVersion')::integer OR
    v_world_version <> (p_request->>'expectedWorldVersion')::integer OR
    v_world->>'seed' IS DISTINCT FROM p_request->'worldData'->>'seed' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  IF v_world ? 'resources' AND (NOT (p_request->'worldData' ? 'resources') OR
    (p_request->'worldData'->'resources'->>'tick')::numeric < (v_world->'resources'->>'tick')::numeric OR
    (v_type <> 'resource' AND (
      p_request->'worldData'->'resources'->'v' IS DISTINCT FROM v_world->'resources'->'v' OR
      p_request->'worldData'->'resources'->'nodes' IS DISTINCT FROM v_world->'resources'->'nodes' OR
      p_request->'worldData'->'resources'->'cooldowns' IS DISTINCT FROM v_world->'resources'->'cooldowns'))) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  IF v_world ? 'community' AND v_type = 'resource' AND
    (NOT (p_request->'worldData' ? 'community') OR
      v_world->'community' IS DISTINCT FROM p_request->'worldData'->'community') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;

  v_result := public.mn_economic_result(p_operation_id,p_request);
  UPDATE public.mn_profiles SET data = p_request->'profile', version = v_profile_version + 1,
      updated_at = pg_catalog.now() WHERE player_id = v_account;
  UPDATE public.mn_worlds SET economy = p_request->'worldData', version = v_world_version + 1,
      updated_at = pg_catalog.now() WHERE world = v_world_id;
  INSERT INTO public.mn_economic_operations(operation_id,request,result) VALUES (p_operation_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN SQLSTATE 'MNP02' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_resource_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_resource_state(jsonb),
  public.mn_valid_economic_request_base(uuid,jsonb), public.mn_valid_economic_request(uuid,jsonb),
  public.mn_save_world(text,jsonb,integer), public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_resource_operations_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_resource_state(jsonb),
  public.mn_valid_economic_request_base(uuid,jsonb), public.mn_valid_economic_request(uuid,jsonb),
  public.mn_save_world(text,jsonb,integer), public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_resource_operations_ready()
  TO service_role;
COMMIT;

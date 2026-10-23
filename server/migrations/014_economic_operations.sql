-- Atomic M5 profile/world operations for ordinary commerce and community contributions.
-- Apply after 001-013. Gameplay eligibility and detached candidate construction stay in the host.
BEGIN;

-- Ordinary legacy snapshots may advance economy fields but must not erase or rewrite an
-- economically committed community projection. Startup may add it while the prior row has none.
CREATE OR REPLACE FUNCTION public.mn_save_world(p_world text, p_data jsonb, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_version integer;
BEGIN
  IF p_world IS NULL OR pg_catalog.btrim(p_world) = '' OR pg_catalog.char_length(p_world) > 100
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid world save arguments' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version = 0 THEN
    INSERT INTO public.mn_worlds (world, economy, version, updated_at)
    VALUES (p_world, p_data, 1, pg_catalog.now())
    ON CONFLICT (world) DO NOTHING
    RETURNING version INTO v_version;
  ELSE
    UPDATE public.mn_worlds
    SET economy = p_data, version = version + 1, updated_at = pg_catalog.now()
    WHERE world = p_world AND version = p_expected_version
      AND (NOT (economy ? 'community') OR
        (p_data ? 'community' AND economy->'community' = p_data->'community'))
    RETURNING version INTO v_version;
  END IF;

  IF v_version IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'conflict');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'version', v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_command jsonb; v_ack jsonb; v_type text; v_op text; v_keys integer; v_town text; v_market jsonb;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','profile','worldData','ack']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 8 OR
    pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
    (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(p_request->'account') IS DISTINCT FROM 'string' OR
    (p_request->>'account') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
    (p_request->>'account') = '00000000-0000-0000-0000-000000000000' OR
    NOT public.mn_death_int(p_request->'expectedProfileVersion',1,2147483646) OR
    NOT public.mn_death_int(p_request->'expectedWorldVersion',1,2147483646) OR
    pg_catalog.jsonb_typeof(p_request->'profile') IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length((p_request->'profile')::text) > 131072 OR
    NOT public.mn_death_int(p_request->'profile'->'v',1,1) OR
    pg_catalog.jsonb_typeof(p_request->'profile'->'eco') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_request->'profile'->'eco'->'pack') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_request->'profile'->'eco'->'pack'->'goods') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_request->'worldData') IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length((p_request->'worldData')::text) > 2097152 OR
    NOT (p_request->'worldData' ?& ARRAY['v','seed','economy']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request->'worldData')) NOT IN (3,4) OR
    ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request->'worldData')) = 4 AND NOT (p_request->'worldData' ? 'community')) OR
    (p_request->'worldData' ? 'community' AND pg_catalog.jsonb_typeof(p_request->'worldData'->'community') IS DISTINCT FROM 'object') OR
    NOT public.mn_death_int(p_request->'worldData'->'v',1,1) OR
    NOT public.mn_death_int(p_request->'worldData'->'seed',0,4294967295) OR
    pg_catalog.jsonb_typeof(p_request->'worldData'->'economy') IS DISTINCT FROM 'object' OR
    NOT public.mn_death_int(p_request->'worldData'->'economy'->'v',2,2) OR
    pg_catalog.jsonb_typeof(p_request->'worldData'->'economy'->'markets') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_request->'worldData'->'economy'->'plots') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request->'worldData'->'economy'->'markets')) <> 6 OR
    NOT ((p_request->'worldData'->'economy'->'markets') ?& ARRAY['aldea','cala','sol','ceniza','corona','coral']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request->'worldData'->'economy'->'plots')) <> 6 OR
    NOT ((p_request->'worldData'->'economy'->'plots') ?& ARRAY['aldea','cala','sol','ceniza','corona','coral']) OR
    pg_catalog.jsonb_typeof(p_request->'command') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_request->'ack') IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length((p_request->'ack')::text) > 32768 OR
    (p_request->'ack') ? 'to' OR
    NOT (p_request->'ack' ?& ARRAY['type','op','opId','ok','why','rev']) OR
    NOT public.mn_death_int(p_request->'ack'->'rev',0,2147483647) OR
    pg_catalog.jsonb_typeof(p_request->'ack'->'ok') IS DISTINCT FROM 'boolean' OR
    pg_catalog.jsonb_typeof(p_request->'ack'->'why') IS DISTINCT FROM 'string' OR
    pg_catalog.char_length(p_request->'ack'->>'why') > 64 THEN RETURN false; END IF;

  FOREACH v_town IN ARRAY ARRAY['aldea','cala','sol','ceniza','corona','coral'] LOOP
    v_market := p_request->'worldData'->'economy'->'markets'->v_town;
    IF pg_catalog.jsonb_typeof(v_market) IS DISTINCT FROM 'object' OR v_market->>'id' IS DISTINCT FROM v_town OR
      pg_catalog.jsonb_typeof(v_market->'stock') IS DISTINCT FROM 'object' OR
      pg_catalog.jsonb_typeof(v_market->'last') IS DISTINCT FROM 'object' OR
      pg_catalog.jsonb_typeof(p_request->'worldData'->'economy'->'plots'->v_town) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  END LOOP;

  v_command := p_request->'command'; v_ack := p_request->'ack';
  v_type := v_command->>'type'; v_op := v_command->>'op';
  IF pg_catalog.jsonb_typeof(v_command->'opId') IS DISTINCT FROM 'string' OR
     (v_command->>'opId') !~ '^[A-Za-z0-9_-]{1,64}$' OR
     v_ack->>'type' IS DISTINCT FROM (CASE WHEN v_type = 'raft' AND v_op = 'supply' THEN 'raftEdit' ELSE v_type END) OR
     v_ack->>'op' IS DISTINCT FROM v_op OR
     v_ack->>'opId' IS DISTINCT FROM v_command->>'opId' THEN RETURN false; END IF;

  v_keys := (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_command));
  IF v_type = 'commerce' AND v_op IN ('buy','sell') THEN
    IF v_keys <> 7 OR NOT (v_command ?& ARRAY['type','op','opId','town','g','n','expectedTotal']) OR
      v_command->>'town' NOT IN ('aldea','cala','sol','ceniza','corona','coral') OR
      v_command->>'g' NOT IN ('pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra',
        'hierro','mineral_hierro','azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas') OR
      NOT public.mn_death_int(v_command->'n',1,500) OR
      NOT public.mn_death_int(v_command->'expectedTotal',0,1000000000) THEN RETURN false; END IF;
  ELSIF v_type = 'commerce' AND v_op = 'transfer' THEN
    IF v_keys <> 8 OR NOT (v_command ?& ARRAY['type','op','opId','id','expectedRev','g','n','side']) OR
      pg_catalog.jsonb_typeof(v_command->'id') IS DISTINCT FROM 'string' OR
      (v_command->>'id') !~ '^[a-zA-Z0-9:_-]{1,120}$' OR
      NOT public.mn_death_int(v_command->'expectedRev',1,2147483646) OR
      v_command->>'g' NOT IN ('pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra',
        'hierro','mineral_hierro','azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas') OR
      NOT public.mn_death_int(v_command->'n',1,500) OR v_command->>'side' NOT IN ('deposit','withdraw') THEN RETURN false; END IF;
  ELSIF v_type = 'community' AND v_op = 'contribute' THEN
    IF v_keys <> 7 OR NOT (v_command ?& ARRAY['type','op','opId','projectId','good','amount','expectedRev']) OR
      pg_catalog.jsonb_typeof(v_command->'projectId') IS DISTINCT FROM 'string' OR
      (v_command->>'projectId') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
      v_command->>'good' NOT IN ('cana','madera','tronco','piedra','hierro','mineral_hierro','azufre','lona') OR
      NOT public.mn_death_int(v_command->'amount',1,500) OR
      NOT public.mn_death_int(v_command->'expectedRev',1,2147483646) THEN RETURN false; END IF;
  ELSIF v_type = 'raft' AND v_op = 'supply' THEN
    IF v_keys <> 7 OR NOT (v_command ?& ARRAY['type','op','opId','id','expectedRev','g','n']) OR
      pg_catalog.jsonb_typeof(v_command->'id') IS DISTINCT FROM 'string' OR
      (v_command->>'id') !~ '^[a-zA-Z0-9:_-]{1,120}$' OR
      NOT public.mn_death_int(v_command->'expectedRev',1,2147483646) OR
      v_command->>'g' NOT IN ('madera','hierro') OR
      NOT public.mn_death_int(v_command->'n',1,10) THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_economic_result(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('ok',true,'replay',false,
    'profileVersion',(p_request->>'expectedProfileVersion')::integer + 1,
    'worldVersion',(p_request->>'expectedWorldVersion')::integer + 1,
    'ack',p_request->'ack');
$function$;

CREATE TABLE IF NOT EXISTS public.mn_economic_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (public.mn_valid_economic_request(operation_id,request)),
  result jsonb NOT NULL CHECK (result = public.mn_economic_result(operation_id,request)),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_economic_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_economic_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_economic_operations TO service_role;

-- New and existing operation families share the established operation UUID advisory lock.
CREATE OR REPLACE FUNCTION public.mn_guard_economic_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported economic isolation' USING ERRCODE = 'MNP02';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable economic receipt' USING ERRCODE = 'MNP02'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF TG_OP = 'UPDATE' THEN
    IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.request IS DISTINCT FROM OLD.request OR
      NEW.result IS DISTINCT FROM OLD.result THEN
      RAISE EXCEPTION 'immutable economic receipt' USING ERRCODE = 'MNP02';
    END IF;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'economic operation UUID collision' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_economic_family ON public.mn_economic_operations;
CREATE TRIGGER mn_economic_family BEFORE INSERT OR UPDATE OR DELETE ON public.mn_economic_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_economic_family();

-- Migration 013 installed this trigger function on every prior operation table and on pearl intents.
-- Preserve those triggers while making their namespace check reject a later economic receipt too.
CREATE OR REPLACE FUNCTION public.mn_guard_ground_clock_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported ground clock isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF TG_TABLE_NAME = 'mn_ground_clock_operations' THEN
    IF TG_OP <> 'INSERT' OR EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_economic_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'ground clock operation identity mismatch' USING ERRCODE = 'MNP02';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id = NEW.operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_economic_operations WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'operation belongs to another family' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;

-- The 013 RPC checks other families before its CAS return path. Add economics there too so a
-- reused UUID is reported as a collision even when the caller also has a stale clock revision.
CREATE OR REPLACE FUNCTION public.mn_commit_ground_clock(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_current public.mn_ground_clocks%ROWTYPE;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    NOT public.mn_valid_ground_clock_request(p_request) THEN
    RAISE EXCEPTION 'invalid ground clock operation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_ground_clock_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'ground clock replay mismatch' USING ERRCODE = 'MNP02'; END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_economic_operations WHERE operation_id = p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = p_operation_id) THEN
    RAISE EXCEPTION 'ground clock UUID collision' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-ground-clock:' || (p_request->>'world'),0));
  SELECT * INTO v_current FROM public.mn_ground_clocks WHERE world = p_request->>'world' FOR UPDATE;
  IF COALESCE(v_current.version,0) <> (p_request->>'expectedVersion')::integer OR
    COALESCE(v_current.tick,0) <> (p_request->>'expectedTick')::bigint THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  v_result := public.mn_ground_clock_result(p_operation_id,p_request);
  INSERT INTO public.mn_ground_clocks(world,tick,version,operation_id)
    VALUES (p_request->>'world',(p_request->>'tick')::bigint,(p_request->>'expectedVersion')::integer + 1,p_operation_id)
    ON CONFLICT (world) DO UPDATE SET tick = EXCLUDED.tick,version = EXCLUDED.version,
      operation_id = EXCLUDED.operation_id,updated_at = pg_catalog.now();
  INSERT INTO public.mn_ground_clock_operations(operation_id,request,result) VALUES (p_operation_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_economic_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid economic operation' USING ERRCODE = 'MNP02'; END IF;
  SELECT pg_catalog.jsonb_build_object('request',request,'result',result) INTO v_result
    FROM public.mn_economic_operations WHERE operation_id = p_operation_id;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_profile jsonb; v_profile_version integer;
  v_world jsonb; v_world_version integer; v_account uuid; v_world_id text;
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

REVOKE ALL ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_economic_result(uuid,jsonb),
  public.mn_guard_economic_family(),public.mn_load_economic_operation(uuid),public.mn_commit_economic_operation(uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_economic_result(uuid,jsonb),
  public.mn_guard_economic_family(),public.mn_load_economic_operation(uuid),public.mn_commit_economic_operation(uuid,jsonb)
  TO service_role;
COMMIT;

-- Cooperative Tala logging receipts on top of the single M5 operation namespace.
-- Resource v1 remains readable; v2 adds only the per-palm contributor ledger.
-- Apply after 001-015. Gameplay stays opt-in until the compatible host enables logging.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_resource_state_v1(p_resources jsonb)
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
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources->'cooldowns')) > 4096 THEN RETURN false; END IF;
  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') LOOP
    IF pg_catalog.jsonb_typeof(v_node) IS DISTINCT FROM 'object' OR NOT (v_node ?& ARRAY['id','kind','rev','hits','readyAt']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_node)) <> 5 OR
      pg_catalog.jsonb_typeof(v_node->'id') IS DISTINCT FROM 'string' OR v_node->>'id' !~ '^[A-Za-z0-9_-]{1,40}$' OR
      pg_catalog.jsonb_typeof(v_node->'kind') IS DISTINCT FROM 'string' OR v_node->>'kind' NOT IN ('wood','stone','palm','rock','iron_ore') OR
      NOT public.mn_death_int(v_node->'rev',1,2147483647) OR NOT public.mn_death_int(v_node->'hits',0,5) OR
      NOT public.mn_death_int(v_node->'readyAt',0,9007199254740991) THEN RETURN false; END IF;
    v_kind := v_node->>'kind'; v_hits := (v_node->>'hits')::integer;
    IF v_hits > (CASE v_kind WHEN 'palm' THEN 3 WHEN 'rock' THEN 4 WHEN 'iron_ore' THEN 5 ELSE 0 END) THEN RETURN false; END IF;
    v_id := v_node->>'id';
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') n WHERE n->>'id' = v_id) <> 1 THEN RETURN false; END IF;
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

-- Convert a v1 resource snapshot without changing its clock, nodes, or cooldowns.
-- Partial and exhausted legacy palm cycles remain explicitly uncredited (null).
CREATE OR REPLACE FUNCTION public.mn_upgrade_resource_state(p_resources jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_node jsonb; v_logging jsonb := '{}'::jsonb; v_id text; v_rev bigint; v_hits integer; v_ready bigint;
BEGIN
  IF NOT public.mn_valid_resource_state_v1(p_resources) THEN RETURN NULL; END IF;
  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') LOOP
    IF v_node->>'kind' <> 'palm' THEN CONTINUE; END IF;
    v_id := v_node->>'id'; v_rev := (v_node->>'rev')::bigint; v_hits := (v_node->>'hits')::integer;
    v_ready := (v_node->>'readyAt')::bigint;
    IF v_hits > 0 AND v_rev >= v_hits + 1 AND (v_rev - 1) % 3 = v_hits % 3 AND
       ((v_hits = 3) IS NOT DISTINCT FROM (v_ready > 0)) THEN
      v_logging := v_logging || pg_catalog.jsonb_build_object(v_id,NULL);
    ELSE
      IF v_hits <> 0 OR v_ready <> 0 OR v_rev % 3 <> 1 THEN RETURN NULL; END IF;
      v_logging := v_logging || pg_catalog.jsonb_build_object(v_id,
        pg_catalog.jsonb_build_object('cycle',((v_rev - 1) / 3) + 1,'contributors','[]'::jsonb));
    END IF;
  END LOOP;
  RETURN (p_resources - 'v') || pg_catalog.jsonb_build_object('v',2,'logging',v_logging);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_resource_state(p_resources jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_base jsonb; v_node jsonb; v_log jsonb; v_id text; v_entry jsonb; v_contrib jsonb;
  v_sum integer; v_prev text; v_cycle bigint; v_hits integer; v_rev bigint; v_ready bigint;
BEGIN
  IF pg_catalog.jsonb_typeof(p_resources) IS DISTINCT FROM 'object' OR
     NOT (p_resources ? 'v') THEN RETURN false; END IF;
  IF p_resources->>'v' = '1' THEN RETURN public.mn_valid_resource_state_v1(p_resources); END IF;
  IF NOT (p_resources ?& ARRAY['v','tick','nodes','cooldowns','logging']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources)) <> 5 OR
     NOT public.mn_death_int(p_resources->'v',2,2) OR
     pg_catalog.jsonb_typeof(p_resources->'logging') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_base := (p_resources - 'logging' - 'v') || pg_catalog.jsonb_build_object('v',1);
  IF NOT public.mn_valid_resource_state_v1(v_base) THEN RETURN false; END IF;
  SELECT pg_catalog.count(*) INTO v_sum FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') n WHERE n->>'kind' = 'palm';
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources->'logging')) <> v_sum THEN RETURN false; END IF;
  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') WHERE value->>'kind' = 'palm' LOOP
    v_id := v_node->>'id';
    IF NOT (p_resources->'logging' ? v_id) THEN RETURN false; END IF;
    v_entry := p_resources->'logging'->v_id;
    IF v_entry = 'null'::jsonb THEN
      v_hits := (v_node->>'hits')::integer; v_rev := (v_node->>'rev')::bigint; v_ready := (v_node->>'readyAt')::bigint;
      IF v_hits < 1 OR v_rev < v_hits + 1 OR (v_rev - 1) % 3 <> v_hits % 3 OR
         ((v_hits = 3) IS DISTINCT FROM (v_ready > 0)) THEN RETURN false; END IF;
      CONTINUE;
    END IF;
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'object' OR
       NOT (v_entry ?& ARRAY['cycle','contributors']) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_entry)) <> 2 OR
       NOT public.mn_death_int(v_entry->'cycle',1,715827883) OR
       pg_catalog.jsonb_typeof(v_entry->'contributors') IS DISTINCT FROM 'array' OR
       pg_catalog.jsonb_array_length(v_entry->'contributors') > 3 THEN RETURN false; END IF;
    v_cycle := (v_entry->>'cycle')::bigint; v_hits := (v_node->>'hits')::integer;
    v_rev := (v_node->>'rev')::bigint; v_ready := (v_node->>'readyAt')::bigint;
    IF v_hits < 0 OR v_rev <> 1 + 3 * (v_cycle - 1) + v_hits OR
       ((v_hits = 3) IS DISTINCT FROM (v_ready > 0)) THEN RETURN false; END IF;
    v_sum := 0; v_prev := NULL;
    FOR v_contrib IN SELECT value FROM pg_catalog.jsonb_array_elements(v_entry->'contributors') LOOP
      IF pg_catalog.jsonb_typeof(v_contrib) IS DISTINCT FROM 'object' OR
         NOT (v_contrib ?& ARRAY['actor','hits']) OR
         (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_contrib)) <> 2 OR
         pg_catalog.jsonb_typeof(v_contrib->'actor') IS DISTINCT FROM 'string' OR
         v_contrib->>'actor' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
         v_contrib->>'actor' = '00000000-0000-0000-0000-000000000000' OR
         (v_prev IS NOT NULL AND v_contrib->>'actor' <= v_prev) OR
         NOT public.mn_death_int(v_contrib->'hits',1,3) THEN RETURN false; END IF;
      v_prev := v_contrib->>'actor'; v_sum := v_sum + (v_contrib->>'hits')::integer;
    END LOOP;
    IF v_sum <> v_hits THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$function$;

-- Preserve SQL015's validator as a delegate for non-cooperative receipt history.
DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_resource_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_resource_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_logging_beneficiaries(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_rows jsonb; v_row jsonb; v_account text; v_previous text := NULL; v_actor_found boolean := false;
  v_command jsonb; v_world jsonb; v_node jsonb; v_expected_actor jsonb; v_logs bigint; v_trade_rev bigint;
BEGIN
  IF NOT (p_request ? 'beneficiaries') THEN RETURN true; END IF;
  v_rows := p_request->'beneficiaries'; v_command := p_request->'command'; v_world := p_request->'worldData';
  IF pg_catalog.jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(v_rows) < 1 OR
     pg_catalog.jsonb_array_length(v_rows) > 3 OR v_command->>'type' IS DISTINCT FROM 'resource' OR
     v_command->>'op' IS DISTINCT FROM 'gather' OR pg_catalog.jsonb_typeof(v_world->'resources') IS DISTINCT FROM 'object' OR
     (v_world->'resources'->>'v')::integer <> 2 THEN RETURN false; END IF;
  SELECT value INTO v_node FROM pg_catalog.jsonb_array_elements(v_world->'resources'->'nodes')
    WHERE value->>'id' = v_command->>'node';
  IF v_node IS NULL OR v_node->>'kind' IS DISTINCT FROM 'palm' THEN RETURN false; END IF;
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_rows) LOOP
    IF pg_catalog.jsonb_typeof(v_row) IS DISTINCT FROM 'object' OR
       NOT (v_row ?& ARRAY['account','expectedVersion','before','profile']) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_row)) <> 4 OR
       pg_catalog.jsonb_typeof(v_row->'account') IS DISTINCT FROM 'string' OR
       v_row->>'account' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       v_row->>'account' = '00000000-0000-0000-0000-000000000000' OR
       (v_previous IS NOT NULL AND v_row->>'account' <= v_previous) OR
       NOT public.mn_death_int(v_row->'expectedVersion',1,2147483646) OR
       pg_catalog.jsonb_typeof(v_row->'before') IS DISTINCT FROM 'object' OR
       pg_catalog.jsonb_typeof(v_row->'profile') IS DISTINCT FROM 'object' OR
       pg_catalog.octet_length((v_row->'before')::text) > 131072 OR
       pg_catalog.octet_length((v_row->'profile')::text) > 131072 OR
       NOT public.mn_death_int(v_row->'profile'->'v',1,1) OR
       (v_row->>'account' <> p_request->>'account' AND
        (((v_row->'before')::jsonb) - ('progression'::text)) IS DISTINCT FROM (((v_row->'profile')::jsonb) - ('progression'::text))) THEN RETURN false; END IF;
    v_account := v_row->>'account'; v_previous := v_account;
    IF v_account = p_request->>'account' THEN
      v_expected_actor := (v_row->'before') - 'progression';
      IF p_request->'ack'->'ok' = 'true'::jsonb AND v_node->'hits' = '3'::jsonb THEN
        IF p_request->'ack'->'count' IS DISTINCT FROM '2'::jsonb OR
           p_request->'ack'->>'good' IS DISTINCT FROM 'tronco' THEN RETURN false; END IF;
        v_logs := COALESCE((v_row->'before'->'eco'->'pack'->'goods'->>'tronco')::bigint,0);
        v_trade_rev := (v_row->'before'->'eco'->>'tradeRev')::bigint;
        IF v_logs < 0 OR v_trade_rev IS NULL OR v_trade_rev < 0 OR v_trade_rev >= 2147483647 THEN RETURN false; END IF;
        v_expected_actor := pg_catalog.jsonb_set(v_expected_actor,'{eco,pack,goods,tronco}',pg_catalog.to_jsonb(v_logs+2));
        v_expected_actor := pg_catalog.jsonb_set(v_expected_actor,'{eco,tradeRev}',pg_catalog.to_jsonb(v_trade_rev+1));
      END IF;
      IF v_expected_actor IS DISTINCT FROM ((v_row->'profile') - 'progression') THEN RETURN false; END IF;
    END IF;
    IF v_account = p_request->>'account' AND v_row->'expectedVersion' = p_request->'expectedProfileVersion' AND
       v_row->'profile' = p_request->'profile' THEN v_actor_found := true; END IF;
  END LOOP;
  IF NOT v_actor_found THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_logging_progression(p_progression jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p_progression) IS DISTINCT FROM 'object' OR
     NOT (p_progression ?& ARRAY['v','practice','milestones','knowledge']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_progression)) <> 4 OR
     NOT public.mn_death_int(p_progression->'v',1,2) OR
     pg_catalog.jsonb_typeof(p_progression->'practice') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_progression->'practice')) <> 1 OR
     NOT public.mn_death_int(p_progression->'practice'->'logging',0,1000000000) OR
     pg_catalog.jsonb_typeof(p_progression->'milestones') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(p_progression->'knowledge') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF pg_catalog.jsonb_array_length(p_progression->'milestones') > (p_progression->>'v')::integer OR
     EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_progression->'milestones') m
       WHERE m IS DISTINCT FROM '"logging_steady"'::jsonb AND
         (p_progression->>'v' <> '2' OR m IS DISTINCT FROM '"pilot_coastal"'::jsonb)) OR
     (SELECT pg_catalog.count(DISTINCT m) FROM pg_catalog.jsonb_array_elements(p_progression->'milestones') m)
       <> pg_catalog.jsonb_array_length(p_progression->'milestones') OR
     pg_catalog.jsonb_array_length(p_progression->'knowledge') > 1 OR
     EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_progression->'knowledge') k
       WHERE k IS DISTINCT FROM '"raft_storage"'::jsonb) THEN RETURN false; END IF;
  RETURN true;
END
$function$;

-- Verify that a completion awards exactly the fixed ten-point proportional budget.
CREATE OR REPLACE FUNCTION public.mn_valid_logging_awards(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_command jsonb; v_rows jsonb; v_resource jsonb; v_node jsonb; v_ledger jsonb;
  v_contrib jsonb; v_row jsonb; v_actor text; v_share integer; v_floor integer; v_remainder integer;
  v_left integer; v_higher integer; v_old jsonb; v_new jsonb; v_old_points bigint; v_new_points bigint;
  v_expected_milestones jsonb; v_old_milestones jsonb; v_old_knowledge jsonb; v_old_v integer;
BEGIN
  IF NOT (p_request ? 'beneficiaries') THEN RETURN true; END IF;
  v_command := p_request->'command'; v_rows := p_request->'beneficiaries';
  v_resource := p_request->'worldData'->'resources';
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_rows) LOOP
    IF (v_row->'before' ? 'progression' AND NOT public.mn_valid_logging_progression(v_row->'before'->'progression')) OR
       (v_row->'profile' ? 'progression' AND NOT public.mn_valid_logging_progression(v_row->'profile'->'progression')) THEN RETURN false; END IF;
  END LOOP;
  SELECT value INTO v_node FROM pg_catalog.jsonb_array_elements(v_resource->'nodes') WHERE value->>'id'=v_command->>'node';
  IF COALESCE((p_request->'ack'->>'ok')::boolean,false) IS NOT TRUE OR
     v_node IS NULL OR (v_node->>'hits')::integer <> 3 OR (v_node->>'readyAt')::bigint = 0 OR
     v_resource->'logging'->(v_command->>'node') = 'null'::jsonb THEN
    IF pg_catalog.jsonb_array_length(v_rows) <> 1 THEN RETURN false; END IF;
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_rows) LOOP
      IF v_row->'before'->'progression' IS DISTINCT FROM v_row->'profile'->'progression' THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF p_request->'ack'->'count' IS DISTINCT FROM '2'::jsonb THEN RETURN false; END IF;
  v_ledger := v_resource->'logging'->(v_command->>'node');
  IF pg_catalog.jsonb_array_length(v_rows) <> pg_catalog.jsonb_array_length(v_ledger->'contributors') THEN RETURN false; END IF;
  SELECT 10 - COALESCE(pg_catalog.sum((10 * (c->>'hits')::integer) / 3),0)::integer INTO v_left
    FROM pg_catalog.jsonb_array_elements(v_ledger->'contributors') c;
  FOR v_contrib IN SELECT value FROM pg_catalog.jsonb_array_elements(v_ledger->'contributors') LOOP
    v_actor := v_contrib->>'actor';
    SELECT value INTO v_row FROM pg_catalog.jsonb_array_elements(v_rows) WHERE value->>'account'=v_actor;
    IF v_row IS NULL THEN RETURN false; END IF;
    v_higher := 0; v_remainder := (10 * (v_contrib->>'hits')::integer) % 3;
    SELECT pg_catalog.count(*) INTO v_higher FROM pg_catalog.jsonb_array_elements(v_ledger->'contributors') c
      WHERE ((10 * (c->>'hits')::integer) % 3) > v_remainder OR
        (((10 * (c->>'hits')::integer) % 3) = v_remainder AND c->>'actor' < v_actor);
    v_floor := (10 * (v_contrib->>'hits')::integer) / 3;
    v_share := v_floor + CASE WHEN v_higher < v_left THEN 1 ELSE 0 END;
    v_old := v_row->'before'->'progression'; v_new := v_row->'profile'->'progression';
    IF v_old IS NULL THEN
      v_old_points := 0; v_old_milestones := '[]'::jsonb; v_old_knowledge := '[]'::jsonb; v_old_v := 1;
    ELSE
      v_old_points := (v_old->'practice'->>'logging')::bigint;
      v_old_milestones := v_old->'milestones'; v_old_knowledge := v_old->'knowledge'; v_old_v := (v_old->>'v')::integer;
    END IF;
    IF v_new IS NULL OR (v_new->>'v')::integer <> v_old_v OR v_new->'knowledge' IS DISTINCT FROM v_old_knowledge THEN RETURN false; END IF;
    v_new_points := v_old_points + LEAST(v_share::bigint,1000000000-v_old_points);
    IF (v_new->'practice'->>'logging')::bigint <> v_new_points THEN RETURN false; END IF;
    v_expected_milestones := v_old_milestones;
    IF v_new_points >= 60 AND NOT (v_old_milestones ? 'logging_steady') THEN
      v_expected_milestones := v_old_milestones || '["logging_steady"]'::jsonb;
    END IF;
    IF v_new->'milestones' IS DISTINCT FROM v_expected_milestones THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

-- Bind the request's new palm row and contributor ledger to the locked prior resource snapshot.
CREATE OR REPLACE FUNCTION public.mn_valid_logging_transition(p_request jsonb,p_before jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_command jsonb; v_account text; v_id text; v_old jsonb; v_new jsonb; v_old_entry jsonb; v_new_entry jsonb;
  v_next_node jsonb; v_expected_node jsonb; v_expected_entry jsonb; v_contributors jsonb;
  v_tick bigint; v_old_hits integer; v_next_hits integer; v_old_rev bigint; v_cycle bigint; v_start boolean;
  v_actor_progression jsonb; v_action_ticks integer; v_cooldowns jsonb; v_status jsonb;
BEGIN
  v_command:=p_request->'command'; v_account:=p_request->>'account'; v_id:=v_command->>'node';
  SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(p_before->'nodes') WHERE value->>'id'=v_id;
  SELECT value INTO v_new FROM pg_catalog.jsonb_array_elements(p_request->'worldData'->'resources'->'nodes') WHERE value->>'id'=v_id;
  IF v_old IS NULL OR v_new IS NULL OR v_old->>'kind'<>'palm' OR v_new->>'kind'<>'palm' THEN RETURN false; END IF;
  v_old_entry:=p_before->'logging'->v_id; v_new_entry:=p_request->'worldData'->'resources'->'logging'->v_id;
  v_tick:=(p_request->'worldData'->'resources'->>'tick')::bigint;
  IF COALESCE((p_request->'ack'->>'ok')::boolean,false) IS NOT TRUE THEN
    IF v_old IS DISTINCT FROM v_new OR p_before->'logging' IS DISTINCT FROM p_request->'worldData'->'resources'->'logging' OR
       p_before->'cooldowns' IS DISTINCT FROM p_request->'worldData'->'resources'->'cooldowns' OR
       p_before->'nodes' IS DISTINCT FROM p_request->'worldData'->'resources'->'nodes' THEN RETURN false; END IF;
    IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') b WHERE b->'before' IS DISTINCT FROM b->'profile') THEN RETURN false; END IF;
    RETURN true;
  END IF;
  v_old_hits:=(v_old->>'hits')::integer; v_old_rev:=(v_old->>'rev')::bigint;
  IF (v_command->>'expectedRev')::bigint<>v_old_rev OR (v_old->>'readyAt')::bigint>v_tick OR
     (v_new->>'rev')::bigint<>v_old_rev+1 THEN RETURN false; END IF;
  SELECT value->'before'->'progression' INTO v_actor_progression
    FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') WHERE value->>'account'=v_account;
  v_action_ticks := CASE WHEN COALESCE((v_actor_progression->'practice'->>'logging')::bigint,0) >= 60 OR
    COALESCE(v_actor_progression->'milestones' ? 'logging_steady',false) THEN 45 ELSE 54 END;
  v_status := pg_catalog.jsonb_build_object('practice',COALESCE((v_actor_progression->'practice'->>'logging')::bigint,0),
    'rank',CASE WHEN v_action_ticks=45 THEN 2 ELSE 1 END,'actionTicks',v_action_ticks,
    'nextAt',CASE WHEN v_action_ticks=45 THEN NULL ELSE 60 END,
    'canLearnStorage',v_action_ticks=45 AND NOT COALESCE(v_actor_progression->'knowledge' ? 'raft_storage',false));
  IF p_request->'ack' ? 'loggingStatus' AND p_request->'ack'->'loggingStatus' IS DISTINCT FROM v_status THEN RETURN false; END IF;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(key,value),'{}'::jsonb) INTO v_cooldowns
    FROM pg_catalog.jsonb_each(p_before->'cooldowns') WHERE value::bigint > v_tick;
  v_cooldowns := v_cooldowns || pg_catalog.jsonb_build_object(v_account,v_tick+v_action_ticks);
  IF p_request->'ack'->'actionTicks' IS DISTINCT FROM pg_catalog.to_jsonb(v_action_ticks) OR
     COALESCE((p_before->'cooldowns'->>v_account)::bigint,0) > v_tick OR
     v_cooldowns IS DISTINCT FROM p_request->'worldData'->'resources'->'cooldowns' OR
     p_request->'ack'->'rev' IS DISTINCT FROM v_new->'rev' OR
     p_request->'ack'->'count' IS DISTINCT FROM pg_catalog.to_jsonb(CASE WHEN (v_new->>'hits')::integer=3 THEN 2 ELSE 0 END)
     THEN RETURN false; END IF;
  v_start:=v_old_hits=3;
  IF v_start THEN v_next_hits:=1;
  ELSE v_next_hits:=v_old_hits+1; END IF;
  IF (v_new->>'hits')::integer<>v_next_hits OR
     (v_new->>'readyAt')::bigint<>(CASE WHEN v_next_hits=3 THEN v_tick+3600 ELSE 0 END) OR
     (v_new-'rev'::text-'hits'::text-'readyAt'::text) IS DISTINCT FROM (v_old-'rev'::text-'hits'::text-'readyAt'::text) THEN RETURN false; END IF;
  IF v_start THEN
    v_cycle:=((v_old_rev)/3)+1;
    v_expected_entry:=pg_catalog.jsonb_build_object('cycle',v_cycle,'contributors',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('actor',v_account,'hits',1)));
  ELSIF v_old_entry='null'::jsonb THEN
    v_expected_entry:='null'::jsonb;
  ELSE
    v_cycle:=(v_old_entry->>'cycle')::bigint;
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('actor',actor,'hits',hits) ORDER BY actor),'[]'::jsonb)
      INTO v_contributors FROM (
        SELECT c->>'actor' actor,(c->>'hits')::integer+CASE WHEN c->>'actor'=v_account THEN 1 ELSE 0 END hits
          FROM pg_catalog.jsonb_array_elements(v_old_entry->'contributors') c
        UNION ALL
        SELECT v_account,1 WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_old_entry->'contributors') c WHERE c->>'actor'=v_account)
      ) contribution;
    v_expected_entry:=pg_catalog.jsonb_build_object('cycle',v_cycle,'contributors',v_contributors);
  END IF;
  IF v_new_entry IS DISTINCT FROM v_expected_entry OR
     ((p_before->'logging') - v_id) IS DISTINCT FROM ((p_request->'worldData'->'resources'->'logging') - v_id) OR
     (p_before->'nodes' IS NULL) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_before->'nodes') old
    WHERE old->>'id'<>v_id AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_request->'worldData'->'resources'->'nodes') new
      WHERE new->>'id'=old->>'id' AND new=old)) THEN RETURN false; END IF;
  IF pg_catalog.jsonb_array_length(p_before->'nodes')<>(SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_request->'worldData'->'resources'->'nodes')) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid, p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_world jsonb; v_base jsonb; v_resource jsonb; v_upgrade jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_request->'worldData') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_world := p_request->'worldData';
  IF v_world ? 'resources' THEN
    v_resource := v_world->'resources';
    IF NOT (public.mn_valid_resource_state_v1(v_resource) OR public.mn_valid_resource_state(v_resource)) THEN RETURN false; END IF;
  END IF;
  IF NOT public.mn_valid_logging_beneficiaries(p_request) OR NOT public.mn_valid_logging_awards(p_request) THEN RETURN false; END IF;
  IF v_world ? 'resources' AND v_world->'resources'->>'v' = '2' THEN
    v_upgrade := ((v_world->'resources') - 'logging' - 'v') || pg_catalog.jsonb_build_object('v',1);
    v_world := jsonb_set(v_world,'{resources}',v_upgrade,true);
  END IF;
  v_base := p_request - 'beneficiaries';
  IF v_world IS DISTINCT FROM p_request->'worldData' THEN v_base := jsonb_set(v_base,'{worldData}',v_world,true); END IF;
  RETURN public.mn_valid_economic_request_resource_base(p_operation_id,v_base);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_economic_result(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('ok',true,'replay',false,
    'profileVersion',(p_request->>'expectedProfileVersion')::integer + 1,
    'worldVersion',(p_request->>'expectedWorldVersion')::integer + 1,
    'ack',p_request->'ack') || CASE WHEN p_request ? 'beneficiaries' THEN
      pg_catalog.jsonb_build_object('profiles',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'account',r->>'account','version',(r->>'expectedVersion')::integer + 1) ORDER BY r->>'account')
        FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') r)) ELSE '{}'::jsonb END;
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_check;
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_request_check;
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request));
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_result_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_result_check
  CHECK (result = public.mn_economic_result(operation_id,request));

CREATE OR REPLACE FUNCTION public.mn_save_world(p_world text, p_data jsonb, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_version integer; v_current jsonb; v_current_resources jsonb; v_next_resources jsonb; v_upgraded jsonb;
BEGIN
  IF p_world IS NULL OR pg_catalog.btrim(p_world) = '' OR pg_catalog.char_length(p_world) > 100 OR
     p_expected_version IS NULL OR p_expected_version < 0 OR p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR
     (p_data ? 'resources' AND NOT (public.mn_valid_resource_state_v1(p_data->'resources') OR public.mn_valid_resource_state(p_data->'resources'))) THEN
    RAISE EXCEPTION 'invalid world save arguments' USING ERRCODE = '22023'; END IF;
  IF p_expected_version = 0 THEN
    INSERT INTO public.mn_worlds(world,economy,version,updated_at) VALUES(p_world,p_data,1,pg_catalog.now())
      ON CONFLICT(world) DO NOTHING RETURNING version INTO v_version;
  ELSE
    SELECT economy INTO v_current FROM public.mn_worlds WHERE world=p_world AND version=p_expected_version FOR UPDATE;
    IF FOUND THEN
      v_current_resources := v_current->'resources'; v_next_resources := p_data->'resources';
      IF (v_current ? 'community' AND (NOT (p_data ? 'community') OR v_current->'community' IS DISTINCT FROM p_data->'community')) THEN
        v_current := NULL;
      ELSIF v_current ? 'resources' THEN
        IF NOT (p_data ? 'resources') THEN v_current := NULL;
        ELSIF v_current_resources->>'v' = '1' AND v_next_resources->>'v' = '2' THEN
          v_upgraded := public.mn_upgrade_resource_state(v_current_resources);
          IF v_upgraded IS NULL OR
             (v_upgraded - 'tick') IS DISTINCT FROM (v_next_resources - 'tick') OR
             (v_next_resources->>'tick')::numeric < (v_current_resources->>'tick')::numeric THEN v_current := NULL; END IF;
        ELSIF v_current_resources->>'v' = '2' THEN
          IF v_next_resources->>'v' IS DISTINCT FROM '2' OR
             (v_current_resources - 'tick') IS DISTINCT FROM (v_next_resources - 'tick') OR
             (v_next_resources->>'tick')::numeric < (v_current_resources->>'tick')::numeric THEN v_current := NULL; END IF;
        ELSIF v_next_resources->>'v' IS DISTINCT FROM '1' OR
             v_current_resources->'nodes' IS DISTINCT FROM v_next_resources->'nodes' OR
             v_current_resources->'cooldowns' IS DISTINCT FROM v_next_resources->'cooldowns' OR
             (v_next_resources->>'tick')::numeric < (v_current_resources->>'tick')::numeric THEN v_current := NULL;
        END IF;
      END IF;
      IF v_current IS NOT NULL THEN
        UPDATE public.mn_worlds SET economy=p_data,version=version+1,updated_at=pg_catalog.now()
          WHERE world=p_world AND version=p_expected_version RETURNING version INTO v_version;
      END IF;
    END IF;
  END IF;
  IF v_version IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'version',v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_world jsonb; v_world_version integer; v_world_id text;
  v_type text; v_account uuid; v_row jsonb; v_current jsonb; v_version integer; v_ids uuid[] := ARRAY[]::uuid[];
  v_beneficiaries jsonb; v_account_text text; v_current_resources jsonb; v_next_resources jsonb;
  v_old_node jsonb; v_new_node jsonb; v_node_id text; v_requires_beneficiaries boolean := false;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    NOT public.mn_valid_economic_request(p_operation_id,p_request) THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.mn_pearl_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_death_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_intents WHERE operation_id=p_operation_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;

  v_account := (p_request->>'account')::uuid; v_world_id := p_request->>'world'; v_type := p_request->'command'->>'type';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||v_world_id,0));
  v_beneficiaries := p_request->'beneficiaries';
  IF v_beneficiaries IS NULL THEN
    v_ids := ARRAY[v_account];
  ELSE
    SELECT pg_catalog.array_agg((r->>'account')::uuid ORDER BY r->>'account') INTO v_ids
      FROM pg_catalog.jsonb_array_elements(v_beneficiaries) r;
  END IF;
  FOREACH v_account IN ARRAY v_ids LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||v_account::text,0));
  END LOOP;
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(v_beneficiaries,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account',v_account::text,
        'expectedVersion',p_request->'expectedProfileVersion','before',NULL,'profile',p_request->'profile'))))
      ORDER BY value->>'account' LOOP
    v_account_text := v_row->>'account';
    SELECT data,version INTO v_current,v_version FROM public.mn_profiles WHERE player_id=v_account_text::uuid FOR UPDATE;
    IF v_version IS NULL OR v_version <> (CASE WHEN v_beneficiaries IS NULL THEN (p_request->>'expectedProfileVersion')::integer
        ELSE (v_row->>'expectedVersion')::integer END) OR
       (v_beneficiaries IS NOT NULL AND v_current IS DISTINCT FROM v_row->'before') THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  END LOOP;
  SELECT economy,version INTO v_world,v_world_version FROM public.mn_worlds WHERE world=v_world_id FOR UPDATE;
  IF v_world_version IS NULL OR v_world_version<>(p_request->>'expectedWorldVersion')::integer OR
     v_world->>'seed' IS DISTINCT FROM p_request->'worldData'->>'seed' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  v_current_resources := v_world->'resources'; v_next_resources := p_request->'worldData'->'resources';
  IF v_world ? 'resources' AND (NOT (p_request->'worldData' ? 'resources') OR
     (v_next_resources->>'tick')::numeric < (v_current_resources->>'tick')::numeric) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  IF (v_current_resources->>'v' = '1' AND v_next_resources->>'v' IS DISTINCT FROM '1') OR
     (v_next_resources->>'v' = '2' AND v_current_resources->>'v' IS DISTINCT FROM '2') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  IF v_world ? 'resources' AND v_current_resources->>'v'='2' THEN
    IF v_next_resources->>'v' IS DISTINCT FROM '2' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    v_node_id := p_request->'command'->>'node';
    IF v_type='resource' AND p_request->'command'->>'op'='gather' THEN
      SELECT value INTO v_old_node FROM pg_catalog.jsonb_array_elements(v_current_resources->'nodes') WHERE value->>'id'=v_node_id;
      SELECT value INTO v_new_node FROM pg_catalog.jsonb_array_elements(v_next_resources->'nodes') WHERE value->>'id'=v_node_id;
      v_requires_beneficiaries := v_old_node->>'kind'='palm';
    END IF;
    IF v_type='resource' AND v_requires_beneficiaries THEN
      IF v_beneficiaries IS NULL OR NOT public.mn_valid_logging_transition(p_request,v_current_resources) THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    ELSIF v_type='resource' THEN
      IF v_current_resources->'logging' IS DISTINCT FROM v_next_resources->'logging' OR
         (SELECT pg_catalog.jsonb_agg(value ORDER BY ordinal) FROM pg_catalog.jsonb_array_elements(v_current_resources->'nodes')
           WITH ORDINALITY AS n(value,ordinal) WHERE value->>'kind'='palm') IS DISTINCT FROM
         (SELECT pg_catalog.jsonb_agg(value ORDER BY ordinal) FROM pg_catalog.jsonb_array_elements(v_next_resources->'nodes')
           WITH ORDINALITY AS n(value,ordinal) WHERE value->>'kind'='palm') THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    ELSE
      IF v_current_resources->'logging' IS DISTINCT FROM v_next_resources->'logging' OR
         v_current_resources->'nodes' IS DISTINCT FROM v_next_resources->'nodes' OR
         v_current_resources->'cooldowns' IS DISTINCT FROM v_next_resources->'cooldowns' THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    END IF;
  ELSIF v_world ? 'resources' AND v_type<>'resource' AND
      (v_current_resources->'nodes' IS DISTINCT FROM v_next_resources->'nodes' OR
       v_current_resources->'cooldowns' IS DISTINCT FROM v_next_resources->'cooldowns') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  IF v_world ? 'community' AND v_type='resource' AND
     (NOT (p_request->'worldData' ? 'community') OR v_world->'community' IS DISTINCT FROM p_request->'worldData'->'community') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;

  v_result := public.mn_economic_result(p_operation_id,p_request);
  IF v_beneficiaries IS NULL THEN
    UPDATE public.mn_profiles SET data=p_request->'profile',version=version+1,updated_at=pg_catalog.now() WHERE player_id=v_ids[1];
  ELSE
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_beneficiaries) ORDER BY value->>'account' LOOP
      UPDATE public.mn_profiles SET data=v_row->'profile',version=version+1,updated_at=pg_catalog.now()
        WHERE player_id=(v_row->>'account')::uuid;
    END LOOP;
  END IF;
  UPDATE public.mn_worlds SET economy=p_request->'worldData',version=version+1,updated_at=pg_catalog.now() WHERE world=v_world_id;
  INSERT INTO public.mn_economic_operations(operation_id,request,result) VALUES(p_operation_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN SQLSTATE 'MNP02' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_logging_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_resource_state_v1(jsonb), public.mn_upgrade_resource_state(jsonb),
  public.mn_valid_resource_state(jsonb), public.mn_valid_logging_beneficiaries(jsonb),
  public.mn_valid_logging_progression(jsonb), public.mn_valid_logging_awards(jsonb), public.mn_valid_logging_transition(jsonb,jsonb),
  public.mn_valid_economic_request_resource_base(uuid,jsonb), public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_save_world(text,jsonb,integer), public.mn_logging_operations_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_resource_state_v1(jsonb), public.mn_upgrade_resource_state(jsonb),
  public.mn_valid_resource_state(jsonb), public.mn_valid_logging_beneficiaries(jsonb),
  public.mn_valid_logging_progression(jsonb), public.mn_valid_logging_awards(jsonb), public.mn_valid_logging_transition(jsonb,jsonb),
  public.mn_valid_economic_request_resource_base(uuid,jsonb), public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_save_world(text,jsonb,integer), public.mn_logging_operations_ready() TO service_role;
COMMIT;

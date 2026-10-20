-- SK04 skill points: one tree point raises one node one rank, or a tree is reset, through the
-- M5 economic receipt. Opens the production progression validator (SQL016, used by the logging
-- beneficiaries and SQL021's artisan request) to the v3 block that readProgression accepts.
-- Apply after 001-039. Additive and rerunnable: existing rows and receipts stay byte-for-byte intact.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_skill_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_skill_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_commit_economic_operation_skill_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_economic_operation(uuid,jsonb) RENAME TO mn_commit_economic_operation_skill_base;
  END IF;
END
$rename$;

-- v1 and v2 keep SQL016's exact rules. v3 mirrors src/sim/systems/progression.js readProgression key by
-- key, except catalog membership: node ids are checked by format and count only (6 trees x 15 cells),
-- and every grant by the 15-cell maximum (45), so new catalog nodes need no SQL.
CREATE OR REPLACE FUNCTION public.mn_valid_logging_progression(p_progression jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p_progression) = 'object' AND public.mn_death_int(p_progression->'v',3,3) THEN
    IF NOT (p_progression ?& ARRAY['v','practice','milestones','knowledge']) OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_progression) k
         WHERE k NOT IN ('v','practice','milestones','knowledge','skills','skr','skg')) OR
       pg_catalog.jsonb_typeof(p_progression->'practice') IS DISTINCT FROM 'object' OR
       NOT public.mn_death_int(p_progression->'practice'->'logging',0,1000000000) OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_progression->'practice') e
         WHERE e.key NOT IN ('logging','survival','sailing','crafting','trade') OR NOT public.mn_death_int(e.value,0,1000000000)) OR
       pg_catalog.jsonb_typeof(p_progression->'milestones') IS DISTINCT FROM 'array' OR
       pg_catalog.jsonb_array_length(p_progression->'milestones') > 2 OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_progression->'milestones') m
         WHERE m IS DISTINCT FROM '"logging_steady"'::jsonb AND m IS DISTINCT FROM '"pilot_coastal"'::jsonb) OR
       (SELECT pg_catalog.count(DISTINCT m) FROM pg_catalog.jsonb_array_elements(p_progression->'milestones') m)
         <> pg_catalog.jsonb_array_length(p_progression->'milestones') OR
       pg_catalog.jsonb_typeof(p_progression->'knowledge') IS DISTINCT FROM 'array' OR
       pg_catalog.jsonb_array_length(p_progression->'knowledge') > 1 OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_progression->'knowledge') k
         WHERE k IS DISTINCT FROM '"raft_storage"'::jsonb) THEN RETURN false; END IF;
    IF p_progression ? 'skills' AND (pg_catalog.jsonb_typeof(p_progression->'skills') IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_progression->'skills')) > 90 OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_progression->'skills') e
         WHERE e.key !~ '^[a-z][a-z0-9_]{0,39}$' OR NOT public.mn_death_int(e.value,0,3))) THEN RETURN false; END IF;
    IF p_progression ? 'skr' AND (pg_catalog.jsonb_typeof(p_progression->'skr') IS DISTINCT FROM 'object' OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_progression->'skr') e
         WHERE e.key NOT IN ('combat','survival','sailing','crafting','trade','exploration') OR
           NOT public.mn_death_int(e.value,0,1000))) THEN RETURN false; END IF;
    IF p_progression ? 'skg' AND (pg_catalog.jsonb_typeof(p_progression->'skg') IS DISTINCT FROM 'object' OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_progression->'skg') e
         WHERE e.key NOT IN ('combat','survival','sailing','crafting','trade','exploration') OR
           NOT public.mn_death_int(e.value,0,45))) THEN RETURN false; END IF;
    RETURN true;
  END IF;
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

-- Exact request shape plus the diff it can check without the catalog or the practice curves:
-- assign raises exactly cmd.node by one (0..3); reset only zeroes ranks, adds one to skr[tree] and
-- costs 150 gold after the free first reset; a first operation adopts (legacy ranks, grants: shape only).
-- The points budget (earned + grant - spent), node-in-tree, tier, draft and gate checks, and the legacy
-- adoption values stay in the JS plan (src/sim/systems/skillPlan.js), which the host re-drafts exactly.
CREATE OR REPLACE FUNCTION public.mn_valid_skill_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; cmd jsonb; ack jsonb; op text; tree text; node text; common jsonb;
  bp jsonb; np jsonb; used bigint; price bigint; adopted boolean;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','before','profile','worldData','ack']) THEN RETURN false; END IF;
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack';
  IF pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR cmd->>'type' IS DISTINCT FROM 'skills' OR
     pg_catalog.jsonb_typeof(cmd->'op') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
     NOT public.mn_death_int(cmd->'expectedRev',0,2147483645) OR
     pg_catalog.jsonb_typeof(cmd->'tree') IS DISTINCT FROM 'string' OR
     cmd->>'tree' NOT IN ('combat','survival','sailing','crafting','trade','exploration') THEN RETURN false; END IF;
  op:=cmd->>'op'; tree:=cmd->>'tree';
  IF op='assign' THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>6 OR
       pg_catalog.jsonb_typeof(cmd->'node') IS DISTINCT FROM 'string' OR cmd->>'node' !~ '^[a-z][a-z0-9_]{0,39}$' THEN RETURN false; END IF;
    node:=cmd->>'node';
  ELSIF op='reset' THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>5 THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(b) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(n) IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length(b::text)>131072 OR pg_catalog.octet_length(n::text)>131072 OR
     pg_catalog.jsonb_typeof(b->'eco') IS DISTINCT FROM 'object' OR
     NOT public.mn_death_int(b->'eco'->'tradeRev',0,2147483646) THEN RETURN false; END IF;
  -- The shared envelope (world, account, versions, profile, worldData) keeps every older validator's rules.
  common:=p_request-'before'::text;
  common:=pg_catalog.jsonb_set(common,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',cmd->'opId','town','aldea','g','madera','n',1,'expectedTotal',0),false);
  common:=pg_catalog.jsonb_set(common,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',cmd->'opId','ok',true,'why','','rev',0),false);
  IF public.mn_valid_economic_request_skill_base(p_operation_id,common) IS NOT TRUE THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(ack) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>6 OR
     NOT (ack ?& ARRAY['type','op','opId','ok','why','rev']) OR ack->>'type' IS DISTINCT FROM 'skills' OR
     ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
     pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR
     pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR pg_catalog.char_length(ack->>'why')>64 THEN RETURN false; END IF;
  -- A denial is an exact no-op receipt.
  IF ack->'ok'='false'::jsonb THEN
    RETURN n IS NOT DISTINCT FROM b AND ack->'rev' IS NOT DISTINCT FROM b->'eco'->'tradeRev' AND ack->>'why'<>'';
  END IF;
  IF ack->>'why' IS DISTINCT FROM '' OR cmd->'expectedRev' IS DISTINCT FROM b->'eco'->'tradeRev' OR
     ack->'rev' IS DISTINCT FROM pg_catalog.to_jsonb((cmd->>'expectedRev')::bigint+1) OR
     n->'eco'->'tradeRev' IS DISTINCT FROM ack->'rev' THEN RETURN false; END IF;
  -- Only progression, gold (a paid reset) and eco.tradeRev may differ.
  IF (n-'progression'::text-'gold'::text-'eco'::text) IS DISTINCT FROM (b-'progression'::text-'gold'::text-'eco'::text) OR
     ((n->'eco')-'tradeRev'::text) IS DISTINCT FROM ((b->'eco')-'tradeRev'::text) OR
     NOT public.mn_death_int(b->'gold',0,1000000000) OR NOT public.mn_death_int(n->'gold',0,1000000000) THEN RETURN false; END IF;
  bp:=COALESCE(b->'progression',pg_catalog.jsonb_build_object('v',1,'practice',pg_catalog.jsonb_build_object('logging',0),'milestones','[]'::jsonb,'knowledge','[]'::jsonb));
  np:=n->'progression';
  IF public.mn_valid_logging_progression(bp) IS NOT TRUE OR public.mn_valid_logging_progression(np) IS NOT TRUE OR
     NOT public.mn_death_int(np->'v',3,3) OR np->'practice' IS DISTINCT FROM bp->'practice' OR
     np->'milestones' IS DISTINCT FROM bp->'milestones' OR np->'knowledge' IS DISTINCT FROM bp->'knowledge' OR
     NOT (np ? 'skills') THEN RETURN false; END IF;
  adopted:=bp ? 'skills';
  IF adopted THEN
    -- v, practice, milestones, knowledge and skg stay exactly as they were.
    IF (np-'skills'::text-'skr'::text) IS DISTINCT FROM (bp-'skills'::text-'skr'::text) THEN RETURN false; END IF;
  ELSIF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(np))<>7 OR NOT (np ?& ARRAY['skr','skg']) THEN
    RETURN false;
  END IF;
  used:=COALESCE((bp->'skr'->>tree)::bigint,0);
  IF op='assign' THEN
    IF n->'gold' IS DISTINCT FROM b->'gold' OR
       np->'skr' IS DISTINCT FROM (CASE WHEN adopted THEN bp->'skr' ELSE COALESCE(bp->'skr','{}'::jsonb) END) THEN RETURN false; END IF;
    IF adopted THEN
      IF ((np->'skills')-node) IS DISTINCT FROM ((bp->'skills')-node) OR
         NOT public.mn_death_int(np->'skills'->node,1,3) OR
         (np->'skills'->>node)::numeric<>COALESCE((bp->'skills'->>node)::numeric,0)+1 THEN RETURN false; END IF;
    ELSIF NOT public.mn_death_int(np->'skills'->node,1,3) THEN RETURN false; END IF;
  ELSE
    -- src/data/skillTree.js: RESET_FREE = 1; SKILL_RESET_GOLD = 150.
    price:=CASE WHEN used>=1 THEN 150 ELSE 0 END;
    IF used>=1000 OR np->'skr' IS DISTINCT FROM (COALESCE(bp->'skr','{}'::jsonb)||pg_catalog.jsonb_build_object(tree,used+1)) OR
       (n->>'gold')::bigint<>(b->>'gold')::bigint-price THEN RETURN false; END IF;
    IF adopted AND (
       (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(np->'skills') k) IS DISTINCT FROM
         (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(bp->'skills') k) OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(np->'skills') e
         WHERE e.value IS DISTINCT FROM bp->'skills'->e.key AND (e.value)::text::numeric<>0) OR
       NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(np->'skills') e
         WHERE (e.value)::text::numeric=0 AND (bp->'skills'->>e.key)::numeric>0)) THEN RETURN false; END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_table OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_request->'command'->>'type'='skills' THEN
    -- A skill receipt never carries loot markers; every other request keeps SQL037's
    -- mn_torch_loot_normalize projection inside mn_valid_economic_request_skill_base.
    RETURN public.mn_torch_loot_normalize(p_request) IS NOT DISTINCT FROM p_request AND
      public.mn_valid_skill_request(p_operation_id,p_request) IS TRUE;
  END IF;
  RETURN public.mn_valid_economic_request_skill_base(p_operation_id,p_request);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

-- Node ranks, resets, grants and the peaceful practice counters other than logging.
CREATE OR REPLACE FUNCTION public.mn_skill_state(p_profile jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('skills',p_profile->'progression'->'skills','skr',p_profile->'progression'->'skr',
    'skg',p_profile->'progression'->'skg','practice',COALESCE(p_profile->'progression'->'practice','{}'::jsonb)-'logging'::text);
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_profile(p_player_id uuid,p_data jsonb,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_data jsonb; v_version integer;
BEGIN
  IF p_player_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_data IS NULL OR
     pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid profile save arguments' USING ERRCODE='22023'; END IF;
  IF p_expected_version=0 THEN
    IF p_data ? 'attr' OR (p_data->'progression') ?| ARRAY['skills','skr','skg'] OR
       public.mn_skill_state(p_data) IS DISTINCT FROM public.mn_skill_state('{}'::jsonb) THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    INSERT INTO public.mn_profiles(player_id,data,version,updated_at) VALUES(p_player_id,p_data,1,pg_catalog.now())
      ON CONFLICT(player_id) DO NOTHING RETURNING version INTO v_version;
  ELSE
    SELECT data INTO v_data FROM public.mn_profiles WHERE player_id=p_player_id AND version=p_expected_version FOR UPDATE;
    IF FOUND AND (v_data->'attr') IS NOT DISTINCT FROM (p_data->'attr') AND
       public.mn_skill_state(v_data) IS NOT DISTINCT FROM public.mn_skill_state(p_data) AND
       (NOT (p_data ? 'attr') OR public.mn_starter_valid_pack(p_data) IS TRUE) THEN
      UPDATE public.mn_profiles SET data=p_data,version=version+1,updated_at=pg_catalog.now()
        WHERE player_id=p_player_id AND version=p_expected_version RETURNING version INTO v_version;
    END IF;
  END IF;
  IF v_version IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'version',v_version);
END
$function$;

-- Every non-skill economic writer (logging beneficiaries and artisan included) keeps that state.
CREATE OR REPLACE FUNCTION public.mn_economic_preserves_skills(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE w text; account_ids uuid[]; a uuid; row jsonb; current_profile jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(p_request->'account') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  w:=p_request->>'world';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
  IF p_request ? 'beneficiaries' THEN
    SELECT pg_catalog.array_agg((value->>'account')::uuid ORDER BY value->>'account') INTO account_ids
      FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries');
  ELSE account_ids:=ARRAY[(p_request->>'account')::uuid]; END IF;
  FOREACH a IN ARRAY account_ids LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
  END LOOP;
  FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(p_request->'beneficiaries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account',p_request->>'account',
        'before',p_request->'before','profile',p_request->'profile')))) ORDER BY value->>'account' LOOP
    a:=(row->>'account')::uuid;
    SELECT data INTO current_profile FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF p_request ? 'beneficiaries' OR p_request ? 'before' THEN
      IF public.mn_skill_state(current_profile) IS DISTINCT FROM public.mn_skill_state(row->'before') OR
         public.mn_skill_state(row->'before') IS DISTINCT FROM public.mn_skill_state(row->'profile') THEN RETURN false; END IF;
    ELSIF public.mn_skill_state(current_profile) IS DISTINCT FROM public.mn_skill_state(row->'profile') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; cp jsonb; cw jsonb; pv integer; wv integer; rr jsonb; rs jsonb;
BEGIN
  IF p_request->'command'->>'type' IS DISTINCT FROM 'skills' THEN
    IF p_operation_id IS NULL THEN RETURN public.mn_commit_economic_operation_skill_base(p_operation_id,p_request); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    SELECT request,result INTO rr,rs FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
    -- Historical receipts replay, and invalid requests are refused, by the unchanged chain.
    IF FOUND OR public.mn_valid_economic_request(p_operation_id,p_request) IS NOT TRUE THEN
      RETURN public.mn_commit_economic_operation_skill_base(p_operation_id,p_request);
    END IF;
    IF public.mn_economic_preserves_skills(p_request) IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    RETURN public.mn_commit_economic_operation_skill_base(p_operation_id,p_request);
  END IF;
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
     public.mn_valid_economic_request(p_operation_id,p_request) IS NOT TRUE THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  SELECT request,result INTO rr,rs FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF rr IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN rs||pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.mn_pearl_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_death_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_intents WHERE operation_id=p_operation_id) THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  a:=(p_request->>'account')::uuid; w:=p_request->>'world';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
  SELECT data,version INTO cp,pv FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
  SELECT economy,version INTO cw,wv FROM public.mn_worlds WHERE world=w FOR UPDATE;
  IF cp IS NULL OR cw IS NULL OR pv<>(p_request->>'expectedProfileVersion')::integer OR
     wv<>(p_request->>'expectedWorldVersion')::integer OR cp IS DISTINCT FROM p_request->'before' OR
     cw->>'seed' IS DISTINCT FROM p_request->'worldData'->>'seed' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  -- The world's only allowed change is its monotonic resource checkpoint.
  IF ((p_request->'worldData')-'resources'::text) IS DISTINCT FROM (cw-'resources'::text) OR
     (cw ? 'resources' AND ((p_request->'worldData'->'resources')-'tick'::text) IS DISTINCT FROM ((cw->'resources')-'tick'::text)) OR
     (cw ? 'resources' AND (p_request->'worldData'->'resources'->>'tick')::numeric<(cw->'resources'->>'tick')::numeric) OR
     (NOT (cw ? 'resources') AND p_request->'worldData' ? 'resources') THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  rs:=public.mn_economic_result(p_operation_id,p_request);
  UPDATE public.mn_profiles SET data=p_request->'profile',version=pv+1,updated_at=pg_catalog.now() WHERE player_id=a;
  UPDATE public.mn_worlds SET economy=p_request->'worldData',version=wv+1,updated_at=pg_catalog.now() WHERE world=w;
  INSERT INTO public.mn_economic_operations(operation_id,request,result) VALUES(p_operation_id,p_request,rs);
  RETURN rs;
EXCEPTION WHEN SQLSTATE 'MNP02' OR data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

-- Ready only when the live progression validator accepts a full v3 block (a later migration that
-- restored SQL016's body would fail this probe), the skill lane and the autosave guard are live.
CREATE OR REPLACE FUNCTION public.mn_skill_operations_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE commit_source text; save_source text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.mn_commit_economic_operation(uuid,jsonb)'::pg_catalog.regprocedure) INTO commit_source;
  SELECT pg_catalog.pg_get_functiondef('public.mn_save_profile(uuid,jsonb,integer)'::pg_catalog.regprocedure) INTO save_source;
  IF public.mn_valid_logging_progression('{"v":3,"practice":{"logging":60,"survival":1,"sailing":2,"crafting":3,"trade":4},"milestones":["logging_steady","pilot_coastal"],"knowledge":["raft_storage"],"skills":{"lunge":2,"blast":1,"pearl_affinity":0},"skr":{"combat":1},"skg":{"combat":2,"survival":0,"sailing":0,"crafting":0,"trade":0}}'::jsonb) IS TRUE AND
     pg_catalog.to_regprocedure('public.mn_valid_skill_request(uuid,jsonb)') IS NOT NULL AND
     pg_catalog.to_regprocedure('public.mn_commit_economic_operation_skill_base(uuid,jsonb)') IS NOT NULL AND
     position('''skills''' in commit_source)>0 AND position('mn_economic_preserves_skills' in commit_source)>0 AND
     position('mn_skill_state(v_data) IS NOT DISTINCT FROM public.mn_skill_state(p_data)' in save_source)>0 AND
     position('mn_skill_state(p_data) IS DISTINCT FROM public.mn_skill_state(' in save_source)>0 THEN
    RETURN pg_catalog.jsonb_build_object('version',1);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',0);
EXCEPTION WHEN OTHERS THEN RETURN pg_catalog.jsonb_build_object('version',0);
END
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request) IS TRUE);
REVOKE ALL ON FUNCTION public.mn_commit_economic_operation_skill_base(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mn_valid_skill_request(uuid,jsonb),public.mn_valid_logging_progression(jsonb),
  public.mn_valid_economic_request_skill_base(uuid,jsonb),public.mn_skill_operations_ready() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_economic_preserves_skills(jsonb),public.mn_skill_state(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_skill_state(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_valid_skill_request(uuid,jsonb),public.mn_valid_logging_progression(jsonb),
  public.mn_valid_economic_request_skill_base(uuid,jsonb),public.mn_skill_operations_ready() TO service_role;
REVOKE ALL ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb) TO service_role;
COMMIT;

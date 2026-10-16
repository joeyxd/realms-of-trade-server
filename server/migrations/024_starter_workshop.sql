-- Starter workshop, carried-capacity, raft crate, and timed palm receipts.
-- Apply after 001-023. Installing this migration does not enable host gameplay or adopt a world.
-- This migration wraps SQL022 in place so old operation envelopes and receipts stay byte-for-byte replayable.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_starter_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_starter_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_commit_economic_operation_starter_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_economic_operation(uuid,jsonb) RENAME TO mn_commit_economic_operation_starter_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_starter_valid_goods(p_goods jsonb,p_cap bigint,p_mass bigint)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE g text; amount jsonb; volume integer; mass numeric; used_volume numeric:=0; used_mass numeric:=0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_goods) IS DISTINCT FROM 'object' OR p_cap<0 OR p_mass<0 THEN RETURN false; END IF;
  FOR g,amount IN SELECT key,value FROM pg_catalog.jsonb_each(p_goods) LOOP
    IF g NOT IN ('pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra','hierro',
      'mineral_hierro','azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas') OR
      NOT public.mn_death_int(amount,1,1000000) THEN RETURN false; END IF;
    volume:=CASE WHEN g IN ('madera','tronco','hierro','mineral_hierro','balas') THEN 3
      WHEN g IN ('cana','piedra','azufre','lona') THEN 2 ELSE 1 END;
    mass:=CASE WHEN g IN ('hierro','mineral_hierro') THEN 6 WHEN g='piedra' THEN 4
      WHEN g='balas' THEN 5 WHEN g='tabaco' THEN 0.5 WHEN g='seda' THEN 0.25
      WHEN g IN ('madera','tronco') THEN 3 WHEN g IN ('cana','azufre') THEN 2
      WHEN g IN ('pescado','fruta','harina','galleta','ron','agua','polvora','especias','coral','perlas') THEN 1
      WHEN g='lona' THEN 1 ELSE 1 END;
    used_volume:=used_volume+(amount::text)::numeric*volume;
    used_mass:=used_mass+(amount::text)::numeric*mass;
  END LOOP;
  RETURN used_volume<=p_cap AND used_mass<=p_mass;
EXCEPTION WHEN data_exception OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_valid_pack(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE pack jsonb; carry jsonb; lvl bigint; tier bigint; cap bigint; max_mass bigint; keys integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR
     NOT public.mn_death_int(p_profile->'lvl',1,1000000) OR
     pg_catalog.jsonb_typeof(p_profile->'eco') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  lvl:=(p_profile->>'lvl')::bigint; pack:=p_profile->'eco'->'pack';
  IF pg_catalog.jsonb_typeof(pack) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF p_profile ? 'carry' THEN
    carry:=p_profile->'carry';
    IF pg_catalog.jsonb_typeof(carry) IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(carry))<>2 OR
       NOT (carry ?& ARRAY['v','backpack']) OR NOT public.mn_death_int(carry->'v',1,1) OR
       NOT public.mn_death_int(carry->'backpack',0,2) THEN RETURN false; END IF;
    tier:=(carry->>'backpack')::bigint;
    cap:=CASE tier WHEN 0 THEN 18 WHEN 1 THEN 30 ELSE 42 END;
    max_mass:=18+2*(lvl-1);
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(pack))<>3 OR
       NOT (pack ?& ARRAY['cap','maxMass','goods']) OR
       NOT public.mn_death_int(pack->'cap',cap,cap) OR
       NOT public.mn_death_int(pack->'maxMass',max_mass,max_mass) THEN RETURN false; END IF;
  ELSE
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(pack))<>2 OR
       NOT (pack ?& ARRAY['cap','goods']) OR NOT public.mn_death_int(pack->'cap',10,10) THEN RETURN false; END IF;
    cap:=10; max_mass:=1000000000;
  END IF;
  RETURN public.mn_starter_valid_goods(pack->'goods',cap,max_mass);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_valid_workshop(p_workshop jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_typeof(p_workshop)='object' AND
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_workshop))=4 AND
    p_workshop ?& ARRAY['v','boards','storageCredit','crateKits'] AND
    public.mn_death_int(p_workshop->'v',1,1) AND public.mn_death_int(p_workshop->'boards',0,10) AND
    pg_catalog.jsonb_typeof(p_workshop->'storageCredit')='boolean' AND public.mn_death_int(p_workshop->'crateKits',0,99);
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_workshop(p_profile jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT CASE WHEN p_profile ? 'workshop' THEN p_profile->'workshop'
    WHEN COALESCE(p_profile->'progression'->'knowledge' ? 'raft_storage',false)
      THEN pg_catalog.jsonb_build_object('v',1,'boards',10,'storageCredit',false,'crateKits',0)
    ELSE pg_catalog.jsonb_build_object('v',1,'boards',0,'storageCredit',false,'crateKits',0) END;
$function$;

-- Resource v3 is v2's ledger plus a bounded per-cycle perfect-hit tally.
CREATE OR REPLACE FUNCTION public.mn_resource_state_v3_as_v2(p_resources jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_logging jsonb:='{}'::jsonb; v_id text; v_entry jsonb; v_node jsonb; v_hits bigint;
BEGIN
  IF pg_catalog.jsonb_typeof(p_resources) IS DISTINCT FROM 'object' OR p_resources->'v' IS DISTINCT FROM '3'::jsonb OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources))<>5 OR
     NOT (p_resources ?& ARRAY['v','tick','nodes','cooldowns','logging']) OR
     pg_catalog.jsonb_typeof(p_resources->'logging') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') WHERE value->>'kind'='palm' LOOP
    v_id:=v_node->>'id';
    IF NOT (p_resources->'logging' ? v_id) THEN RETURN NULL; END IF;
    v_entry:=p_resources->'logging'->v_id;
    IF v_entry='null'::jsonb THEN v_logging:=v_logging||pg_catalog.jsonb_build_object(v_id,NULL);
    ELSE
      v_hits:=(v_node->>'hits')::bigint;
      IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'object' OR
         (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_entry))<>3 OR
         NOT (v_entry ?& ARRAY['cycle','contributors','quality']) OR
         NOT public.mn_death_int(v_entry->'quality',0,3) OR (v_entry->>'quality')::bigint>v_hits THEN RETURN NULL; END IF;
      v_logging:=v_logging||pg_catalog.jsonb_build_object(v_id,v_entry-'quality'::text);
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources->'logging')) <>
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') WHERE value->>'kind'='palm') THEN RETURN NULL; END IF;
  RETURN (p_resources-'v'::text-'logging'::text)||pg_catalog.jsonb_build_object('v',2,'logging',v_logging);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_upgrade_resource_state_timing(p_resources jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v2 jsonb; v_logging jsonb:='{}'::jsonb; v_id text; v_entry jsonb;
BEGIN
  IF p_resources->>'v'='3' THEN RETURN p_resources; END IF;
  IF p_resources->>'v'='2' THEN v2:=p_resources;
  ELSIF p_resources->>'v'='1' THEN v2:=public.mn_upgrade_resource_state(p_resources);
  ELSE RETURN NULL; END IF;
  IF v2 IS NULL OR NOT public.mn_valid_resource_state_starter_base(v2) THEN RETURN NULL; END IF;
  FOR v_id,v_entry IN SELECT key,value FROM pg_catalog.jsonb_each(v2->'logging') LOOP
    IF v_entry='null'::jsonb THEN v_logging:=v_logging||pg_catalog.jsonb_build_object(v_id,NULL);
    ELSE v_logging:=v_logging||pg_catalog.jsonb_build_object(v_id,v_entry||pg_catalog.jsonb_build_object('quality',0)); END IF;
  END LOOP;
  RETURN (v2-'v'::text-'logging'::text)||pg_catalog.jsonb_build_object('v',3,'logging',v_logging);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN NULL;
END
$function$;

DO $rename_resource$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_resource_state_starter_base(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_resource_state(jsonb) RENAME TO mn_valid_resource_state_starter_base;
  END IF;
END
$rename_resource$;

CREATE OR REPLACE FUNCTION public.mn_valid_resource_state(p_resources jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_node jsonb; v_entry jsonb; v_v2 jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_resources) IS DISTINCT FROM 'object' OR p_resources->>'v'<>'3' THEN
    RETURN public.mn_valid_resource_state_v1(p_resources) OR public.mn_valid_resource_state_starter_base(p_resources);
  END IF;
  v_v2:=public.mn_resource_state_v3_as_v2(p_resources);
  IF v_v2 IS NULL OR NOT public.mn_valid_resource_state_starter_base(v_v2) THEN RETURN false; END IF;
  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(p_resources->'nodes') WHERE value->>'kind'='palm' LOOP
    v_entry:=p_resources->'logging'->(v_node->>'id');
    IF v_entry IS NOT NULL AND v_entry<>'null'::jsonb AND
       (NOT public.mn_death_int(v_entry->'quality',0,3) OR (v_entry->>'quality')::integer>(v_node->>'hits')::integer) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_timing_quality(p_request jsonb,p_old_node jsonb)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE t jsonb; c jsonb; width integer; practice bigint; input_tick bigint; target bigint;
BEGIN
  t:=p_request->'ack'->'timing'; c:=t->'challenge';
  IF pg_catalog.jsonb_typeof(t) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(t))<>3 OR NOT (t ?& ARRAY['challenge','receivedTick','quality']) OR
     pg_catalog.jsonb_typeof(c) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(c))<>7 OR
     NOT (c ?& ARRAY['v','node','rev','startTick','targetTick','endTick','width']) OR
     NOT public.mn_death_int(c->'v',1,1) OR c->>'node' IS DISTINCT FROM p_old_node->>'id' OR
     c->'rev' IS DISTINCT FROM p_old_node->'rev' OR
     NOT public.mn_death_int(c->'startTick',0,9007199254740905) OR
     (c->>'targetTick')::numeric<>(c->>'startTick')::numeric+45 OR
     (c->>'endTick')::numeric<>(c->>'startTick')::numeric+90 OR
     NOT public.mn_death_int(t->'receivedTick',0,9007199254740991) OR
     t->'receivedTick' IS DISTINCT FROM p_request->'worldData'->'resources'->'tick' OR
     NOT public.mn_death_int(t->'quality',0,1) THEN RETURN NULL; END IF;
  SELECT COALESCE((r->'before'->'progression'->'practice'->>'logging')::bigint,0)
    INTO practice FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') r WHERE r->>'account'=p_request->>'account';
  IF practice IS NULL THEN RETURN NULL; END IF;
  width:=CASE WHEN practice<60 THEN 5 WHEN practice<180 THEN 8 ELSE 11 END;
  IF (c->>'width')::integer<>width THEN RETURN NULL; END IF;
  input_tick:=(t->>'receivedTick')::bigint; target:=(c->>'targetTick')::bigint;
  IF input_tick < (c->>'startTick')::bigint+6 OR input_tick>(c->>'endTick')::bigint OR
     t->'quality' IS DISTINCT FROM pg_catalog.to_jsonb(CASE WHEN abs(input_tick-target)<=width THEN 1 ELSE 0 END) THEN RETURN NULL; END IF;
  RETURN (t->>'quality')::integer;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_starter_v3_transition(p_operation_id uuid,p_request jsonb,p_current jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE normalized jsonb; old_state jsonb; new_state jsonb; old_node jsonb; new_node jsonb;
  old_entry jsonb; new_entry jsonb; quality integer; expected_quality integer; node_id text;
BEGIN
  IF p_current->'resources'->>'v'<>'3' OR p_request->'worldData'->'resources'->>'v'<>'3' OR
     ((p_request->'worldData')-'resources'::text) IS DISTINCT FROM (p_current-'resources'::text) OR
     (p_request->'worldData'->'resources'->>'tick')::numeric<(p_current->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  normalized:=public.mn_starter_v3_normalize(p_request);
  IF normalized IS NULL OR NOT public.mn_valid_economic_request_starter_base(p_operation_id,normalized) THEN RETURN false; END IF;
  old_state:=public.mn_resource_state_v3_as_v2(p_current->'resources');
  new_state:=normalized->'worldData'->'resources';
  node_id:=p_request->'command'->>'node';
  IF ((p_request->'worldData'->'resources'->'logging')-node_id) IS DISTINCT FROM
     ((p_current->'resources'->'logging')-node_id) THEN RETURN false; END IF;
  IF old_state IS NULL OR NOT public.mn_valid_logging_transition(normalized,old_state) THEN RETURN false; END IF;
  SELECT value INTO old_node FROM pg_catalog.jsonb_array_elements(p_current->'resources'->'nodes') WHERE value->>'id'=node_id;
  SELECT value INTO new_node FROM pg_catalog.jsonb_array_elements(p_request->'worldData'->'resources'->'nodes') WHERE value->>'id'=node_id;
  IF old_node->>'kind'<>'palm' THEN RETURN true; END IF;
  IF p_request->'ack'->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN (p_current->'resources'->'logging') IS NOT DISTINCT FROM (p_request->'worldData'->'resources'->'logging');
  END IF;
  quality:=public.mn_starter_timing_quality(p_request,old_node);
  IF quality IS NULL THEN RETURN false; END IF;
  old_entry:=p_current->'resources'->'logging'->node_id;
  new_entry:=p_request->'worldData'->'resources'->'logging'->node_id;
  IF old_entry='null'::jsonb AND old_node->>'hits'<>'3' THEN RETURN new_entry='null'::jsonb; END IF;
  expected_quality:=CASE WHEN old_node->>'hits'='3' OR old_entry='null'::jsonb THEN 0
    ELSE COALESCE((old_entry->>'quality')::integer,0) END + quality;
  RETURN new_entry IS NOT NULL AND new_entry<>'null'::jsonb AND
    (new_entry->>'quality')::integer=expected_quality AND
    p_request->'ack'->'count' IS NOT DISTINCT FROM pg_catalog.to_jsonb(CASE WHEN new_node->>'hits'='3' THEN 3+expected_quality ELSE 0 END);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_profile_carry_frozen(p_before jsonb,p_after jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_typeof(p_before)='object' AND pg_catalog.jsonb_typeof(p_after)='object' AND
         (p_before->'carry') IS NOT DISTINCT FROM (p_after->'carry') AND
         (p_before->'workshop') IS NOT DISTINCT FROM (p_after->'workshop') AND
         (p_before->'eco'->'pack'->'cap') IS NOT DISTINCT FROM (p_after->'eco'->'pack'->'cap') AND
         (p_before->'eco'->'pack'->'maxMass') IS NOT DISTINCT FROM (p_after->'eco'->'pack'->'maxMass');
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_is_palm_gather(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_kind text;
BEGIN
  IF p_request->'command'->>'type'<>'resource' OR p_request->'command'->>'op'<>'gather' OR
     p_request->'worldData'->'resources'->>'v'<>'3' THEN RETURN false; END IF;
  SELECT value->>'kind' INTO v_kind FROM pg_catalog.jsonb_array_elements(p_request->'worldData'->'resources'->'nodes')
    WHERE value->>'id'=p_request->'command'->>'node';
  RETURN v_kind='palm';
EXCEPTION WHEN data_exception THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_v3_normalize(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE out_request jsonb; cmd jsonb; ack jsonb; resource jsonb; before_resource jsonb; v2 jsonb; old_node jsonb; new_node jsonb;
  proof_quality integer; ledger jsonb; old_ledger jsonb; actor text; row jsonb; prof jsonb; pack jsonb; goods jsonb; count integer;
BEGIN
  IF p_request->'worldData'->'resources'->>'v'<>'3' OR p_request->'command'->>'type'<>'resource' OR
     p_request->'command'->>'op'<>'gather' OR NOT public.mn_starter_is_palm_gather(p_request) THEN RETURN NULL; END IF;
  resource:=p_request->'worldData'->'resources'; v2:=public.mn_resource_state_v3_as_v2(resource);
  IF v2 IS NULL OR NOT public.mn_valid_resource_state(resource) THEN RETURN NULL; END IF;
  SELECT value INTO new_node FROM pg_catalog.jsonb_array_elements(resource->'nodes') WHERE value->>'id'=p_request->'command'->>'node';
  -- The old node is supplied by the locked world during commit; for request validation use the challenge revision.
  cmd:=p_request->'command'; ack:=p_request->'ack';
  IF p_request->'ack'->'ok'='true'::jsonb THEN
    IF pg_catalog.jsonb_typeof(cmd->'challenge') IS DISTINCT FROM 'string' OR
       pg_catalog.char_length(cmd->>'challenge') NOT BETWEEN 1 AND 128 THEN RETURN NULL; END IF;
    old_ledger:=resource->'logging'->(cmd->>'node');
    proof_quality:=public.mn_starter_timing_quality(p_request,
      pg_catalog.jsonb_build_object('id',cmd->>'node','rev',(cmd->>'expectedRev')::bigint));
    IF proof_quality IS NULL THEN RETURN NULL; END IF;
    IF new_node->'hits'='3'::jsonb THEN
      count:=3+COALESCE((resource->'logging'->(cmd->>'node')->>'quality')::integer,0);
      IF (ack->>'count')::integer<>count THEN RETURN NULL; END IF;
      ack:=pg_catalog.jsonb_set(ack,'{count}',pg_catalog.to_jsonb(2),false);
    ELSIF (ack->>'count')::integer<>0 THEN RETURN NULL;
    END IF;
    ack:=ack-'timing'::text;
  ELSE
    IF cmd ? 'challenge' AND (pg_catalog.jsonb_typeof(cmd->'challenge') IS DISTINCT FROM 'string' OR
       pg_catalog.char_length(cmd->>'challenge') NOT BETWEEN 1 AND 128) THEN RETURN NULL; END IF;
    ack:=ack-'timing'::text;
  END IF;
  cmd:=cmd-'challenge'::text;
  out_request:=p_request-'timing'::text;
  out_request:=pg_catalog.jsonb_set(out_request,'{command}',cmd,false);
  out_request:=pg_catalog.jsonb_set(out_request,'{ack}',ack,false);
  out_request:=pg_catalog.jsonb_set(out_request,'{worldData,resources}',v2,false);
  IF p_request ? 'beneficiaries' THEN
    actor:=p_request->>'account';
    FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') LOOP
      prof:=row->'profile';
      IF row->>'account'=actor AND p_request->'ack'->'ok'='true'::jsonb THEN
        new_node:=NULL;
        SELECT value INTO new_node FROM pg_catalog.jsonb_array_elements(resource->'nodes') WHERE value->>'id'=cmd->>'node';
        IF new_node->'hits'='3'::jsonb THEN
          proof_quality:=GREATEST(0,(p_request->'ack'->>'count')::integer-2);
          goods:=prof->'eco'->'pack'->'goods';
          count:=COALESCE((goods->>'tronco')::integer,0)-proof_quality;
          IF count<0 THEN RETURN NULL; END IF;
          IF count=0 THEN goods:=goods-'tronco'::text; ELSE goods:=pg_catalog.jsonb_set(goods,'{tronco}',pg_catalog.to_jsonb(count),true); END IF;
          pack:=pg_catalog.jsonb_set(prof->'eco'->'pack','{goods}',goods,false);
          prof:=pg_catalog.jsonb_set(prof,'{eco,pack}',pack,false);
          out_request:=pg_catalog.jsonb_set(out_request,ARRAY['beneficiaries',(SELECT (ord-1)::text FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') WITH ORDINALITY q(value,ord) WHERE value->>'account'=actor),'profile'],prof,false);
          out_request:=pg_catalog.jsonb_set(out_request,'{profile}',prof,false);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN out_request;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END
$function$;

-- Keep old fire, commerce, death-adjacent economic receipts, raft storage, and artisan lesson requests
-- on the exact SQL022/SQL021 code paths. New workshop and v3 requests have their own request envelopes.
CREATE OR REPLACE FUNCTION public.mn_valid_starter_workshop_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; base jsonb; op text; kind text;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     NOT (p_request ? 'before') OR p_request ? 'beneficiaries' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','profile','worldData','ack','before']) THEN RETURN false; END IF;
  cmd:=p_request->'command'; ack:=p_request->'ack'; op:=cmd->>'op'; kind:=cmd->>'type';
  IF kind NOT IN ('artisan','raft') OR (kind='artisan' AND op NOT IN ('contribute','craftCrate','upgradePack')) OR
     (kind='raft' AND (op NOT IN ('place','remove') OR cmd->>'rules'<>'2')) THEN RETURN false; END IF;
  IF public.mn_starter_valid_pack(p_request->'before') IS NOT TRUE OR public.mn_starter_valid_pack(p_request->'profile') IS NOT TRUE OR
     (p_request->'before' ? 'workshop' AND public.mn_starter_valid_workshop(p_request->'before'->'workshop') IS NOT TRUE) OR
     (p_request->'profile' ? 'workshop' AND public.mn_starter_valid_workshop(p_request->'profile'->'workshop') IS NOT TRUE) THEN RETURN false; END IF;
  IF kind='artisan' THEN
    IF pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
       NOT public.mn_death_int(cmd->'expectedRev',0,2147483646) OR
       (op='contribute' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>5) OR
       (op='craftCrate' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>4) OR
       (op='upgradePack' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>4) OR
       (op='contribute' AND (NOT (cmd ?& ARRAY['type','op','opId','expectedRev','amount']) OR NOT public.mn_death_int(cmd->'amount',1,10))) OR
       (op<>'contribute' AND NOT (cmd ?& ARRAY['type','op','opId','expectedRev'])) THEN RETURN false; END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>8 OR
       NOT (ack ?& ARRAY['type','op','opId','ok','why','rev','workshop','carry']) OR
       ack->>'type' IS DISTINCT FROM 'artisan' OR ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
       pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR
       NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  ELSE
    IF pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
       pg_catalog.jsonb_typeof(cmd->'id') IS DISTINCT FROM 'string' OR cmd->>'id' !~ '^[A-Za-z0-9_-]{0,120}$' OR
       NOT public.mn_death_int(cmd->'expectedRev',1,2147483646) OR
       pg_catalog.jsonb_typeof(cmd->'piece') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(cmd->'piece')<>5 OR
       (op='place' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>7 OR
         NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece','rules']))) OR
       (op='remove' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
         NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece','rules','index']) OR
         NOT public.mn_death_int(cmd->'index',0,599))) OR
       cmd->'piece'->>0 NOT IN ('storage','crate') OR
       NOT public.mn_death_int(cmd->'piece'->1,-128,128) OR NOT public.mn_death_int(cmd->'piece'->2,-128,128) OR
       NOT public.mn_death_int(cmd->'piece'->3,0,2) OR NOT public.mn_death_int(cmd->'piece'->4,0,3) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>7 OR
       NOT (ack ?& ARRAY['type','id','op','opId','ok','why','rev']) OR ack->>'type' IS DISTINCT FROM 'raftEdit' OR
       ack->>'id' IS DISTINCT FROM cmd->>'id' OR ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
       pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR
       NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  END IF;
  base:=p_request-'before'::text;
  base:=pg_catalog.jsonb_set(base,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',COALESCE(cmd->'opId','"workshop"'::jsonb),'town','aldea','g','madera','n',1,'expectedTotal',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',COALESCE(cmd->'opId','"workshop"'::jsonb),'ok',true,'why','','rev',0),false);
  RETURN public.mn_valid_economic_request_starter_base(p_operation_id,base);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE normalized jsonb;
BEGIN
  IF public.mn_starter_is_palm_gather(p_request) THEN
    normalized:=public.mn_starter_v3_normalize(p_request);
    RETURN normalized IS NOT NULL AND public.mn_valid_economic_request_starter_base(p_operation_id,normalized);
  END IF;
  IF p_request ? 'before' AND (p_request->'command'->>'type' IN ('artisan','raft') AND p_request->'command'->>'op' IN ('contribute','craftCrate','upgradePack') OR
       p_request->'command'->>'type'='raft' AND p_request->'command'->>'rules'='2') THEN
    RETURN public.mn_valid_starter_workshop_request(p_operation_id,p_request);
  END IF;
  RETURN public.mn_valid_economic_request_starter_base(p_operation_id,p_request);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_world(p_world text,p_data jsonb,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_version integer; v_current jsonb; v_current_resources jsonb; v_next_resources jsonb; v_upgraded jsonb;
BEGIN
  IF p_world IS NULL OR pg_catalog.btrim(p_world)='' OR pg_catalog.char_length(p_world)>100 OR
     p_expected_version IS NULL OR p_expected_version<0 OR p_data IS NULL OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR
     (p_data ? 'resources' AND NOT (public.mn_valid_resource_state_v1(p_data->'resources') OR public.mn_valid_resource_state(p_data->'resources'))) THEN
    RAISE EXCEPTION 'invalid world save arguments' USING ERRCODE='22023'; END IF;
  IF p_expected_version=0 THEN
    INSERT INTO public.mn_worlds(world,economy,version,updated_at) VALUES(p_world,p_data,1,pg_catalog.now())
      ON CONFLICT(world) DO NOTHING RETURNING version INTO v_version;
  ELSE
    SELECT economy INTO v_current FROM public.mn_worlds WHERE world=p_world AND version=p_expected_version FOR UPDATE;
    IF FOUND THEN
      v_current_resources:=v_current->'resources'; v_next_resources:=p_data->'resources';
      IF v_current ? 'community' AND (NOT (p_data ? 'community') OR v_current->'community' IS DISTINCT FROM p_data->'community') THEN
        v_current:=NULL;
      ELSIF v_current ? 'resources' THEN
        IF NOT (p_data ? 'resources') THEN v_current:=NULL;
        ELSIF v_current_resources->>'v'='1' AND v_next_resources->>'v'='2' THEN
          v_upgraded:=public.mn_upgrade_resource_state(v_current_resources);
          IF v_upgraded IS NULL OR (v_upgraded-'tick'::text) IS DISTINCT FROM (v_next_resources-'tick'::text) OR
             (v_next_resources->>'tick')::numeric<(v_current_resources->>'tick')::numeric THEN v_current:=NULL; END IF;
        ELSIF v_current_resources->>'v'='2' AND v_next_resources->>'v'='3' THEN
          v_upgraded:=public.mn_upgrade_resource_state_timing(v_current_resources);
          IF v_upgraded IS NULL OR (v_upgraded-'tick'::text) IS DISTINCT FROM (v_next_resources-'tick'::text) OR
             (v_next_resources->>'tick')::numeric<(v_current_resources->>'tick')::numeric THEN v_current:=NULL; END IF;
        ELSIF v_current_resources->>'v'='1' AND v_next_resources->>'v'='3' THEN v_current:=NULL;
        ELSIF v_current_resources->>'v'='2' THEN
          IF v_next_resources->>'v' IS DISTINCT FROM '2' OR
             (v_current_resources-'tick'::text) IS DISTINCT FROM (v_next_resources-'tick'::text) OR
             (v_next_resources->>'tick')::numeric<(v_current_resources->>'tick')::numeric THEN v_current:=NULL; END IF;
        ELSIF v_current_resources->>'v'='3' THEN
          IF v_next_resources->>'v' IS DISTINCT FROM '3' OR
             (v_current_resources-'tick'::text) IS DISTINCT FROM (v_next_resources-'tick'::text) OR
             (v_next_resources->>'tick')::numeric<(v_current_resources->>'tick')::numeric THEN v_current:=NULL; END IF;
        ELSIF v_next_resources->>'v' IS DISTINCT FROM '1' OR
             v_current_resources->'nodes' IS DISTINCT FROM v_next_resources->'nodes' OR
             v_current_resources->'cooldowns' IS DISTINCT FROM v_next_resources->'cooldowns' OR
             (v_next_resources->>'tick')::numeric<(v_current_resources->>'tick')::numeric THEN v_current:=NULL;
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

CREATE OR REPLACE FUNCTION public.mn_valid_starter_workshop_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; cmd jsonb; ack jsonb; oldws jsonb; newws jsonb; prog jsonb; nextprog jsonb;
  expected jsonb; pack jsonb; goods jsonb; count integer; boards integer; kits integer; tier integer; cap integer; mass integer; carry_view jsonb;
  costwood integer; costlona integer; carry jsonb; oldworkshop jsonb;
BEGIN
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack';
  IF ((p_request->'worldData')-'resources'::text) IS DISTINCT FROM (p_world-'resources'::text) THEN RETURN false; END IF;
  IF p_world ? 'resources' THEN
    IF NOT (p_request->'worldData' ? 'resources') OR
      ((p_request->'worldData'->'resources')-'tick'::text) IS DISTINCT FROM ((p_world->'resources')-'tick'::text) OR
      (p_request->'worldData'->'resources'->>'tick')::numeric < (p_world->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  ELSIF p_request->'worldData' ? 'resources' THEN RETURN false; END IF;
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN b IS NOT DISTINCT FROM n AND ack->'rev' IS NOT DISTINCT FROM b->'eco'->'tradeRev'; END IF;
  IF cmd->>'type'<>'artisan' OR cmd->>'expectedRev' IS DISTINCT FROM b->'eco'->>'tradeRev' OR
     (n->'eco'->>'tradeRev')::bigint<>(cmd->>'expectedRev')::bigint+1 OR
     (n-'eco'::text-'workshop'::text-'progression'::text-'carry'::text) IS DISTINCT FROM
       (b-'eco'::text-'workshop'::text-'progression'::text-'carry'::text) THEN RETURN false; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>8 OR
     NOT (ack ?& ARRAY['type','op','opId','ok','why','rev','workshop','carry']) OR
     ack->>'type'<>'artisan' OR ack->>'op' IS DISTINCT FROM cmd->>'op' OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
     ack->>'why' IS DISTINCT FROM '' THEN RETURN false; END IF;
  oldws:=public.mn_starter_workshop(b); oldworkshop:=b->'workshop';
  prog:=COALESCE(b->'progression',pg_catalog.jsonb_build_object('v',1,'practice',pg_catalog.jsonb_build_object('logging',0),'milestones','[]'::jsonb,'knowledge','[]'::jsonb));
  nextprog:=prog;
  pack:=b->'eco'->'pack'; goods:=pack->'goods'; expected:=b;
  boards:=(oldws->>'boards')::integer; kits:=(oldws->>'crateKits')::integer;
  IF cmd->>'op'='contribute' THEN
    count:=(cmd->>'amount')::integer;
    IF boards+count>10 OR COALESCE((goods->>'madera')::integer,0)<count THEN RETURN false; END IF;
    boards:=boards+count; costwood:=count; costlona:=0;
    IF boards=10 THEN
      IF COALESCE(prog->'knowledge','[]'::jsonb) ? 'raft_storage' THEN RETURN false; END IF;
      nextprog:=pg_catalog.jsonb_set(nextprog,'{knowledge}',COALESCE(prog->'knowledge','[]'::jsonb)||pg_catalog.jsonb_build_array('raft_storage'),true);
    END IF;
  ELSIF cmd->>'op'='craftCrate' THEN
    IF kits>=99 OR COALESCE((goods->>'madera')::integer,0)<2 THEN RETURN false; END IF;
    kits:=kits+1; costwood:=2; costlona:=0;
  ELSIF cmd->>'op'='upgradePack' THEN
    carry:=b->'carry'; tier:=CASE WHEN carry IS NULL THEN 0 ELSE (carry->>'backpack')::integer END;
    IF tier>=2 THEN RETURN false; END IF;
    IF tier=0 THEN costwood:=2; costlona:=3; cap:=30; ELSE costwood:=4; costlona:=5; cap:=42; END IF;
    IF COALESCE((goods->>'madera')::integer,0)<costwood OR COALESCE((goods->>'lona')::integer,0)<costlona THEN RETURN false; END IF;
    mass:=18+2*((b->>'lvl')::integer-1);
    nextprog:=prog;
  ELSE RETURN false; END IF;
  goods:=goods-'madera'::text-'lona'::text;
  IF COALESCE((pack->'goods'->>'madera')::integer,0)>costwood THEN goods:=goods||pg_catalog.jsonb_build_object('madera',(pack->'goods'->>'madera')::integer-costwood); END IF;
  IF COALESCE((pack->'goods'->>'lona')::integer,0)>costlona THEN goods:=goods||pg_catalog.jsonb_build_object('lona',(pack->'goods'->>'lona')::integer-costlona); END IF;
  IF cmd->>'op'='upgradePack' AND NOT public.mn_starter_valid_goods(goods,cap,mass) THEN RETURN false; END IF;
  expected:=pg_catalog.jsonb_set(expected,'{eco,pack,goods}',goods,false);
  expected:=pg_catalog.jsonb_set(expected,'{eco,tradeRev}',pg_catalog.to_jsonb((cmd->>'expectedRev')::bigint+1),false);
  newws:=pg_catalog.jsonb_build_object('v',1,'boards',boards,'storageCredit',COALESCE((oldws->>'storageCredit')::boolean,false) OR (cmd->>'op'='contribute' AND boards=10),'crateKits',kits);
  expected:=pg_catalog.jsonb_set(expected,'{workshop}',newws,true);
  IF cmd->>'op'='upgradePack' THEN
    carry:=pg_catalog.jsonb_build_object('v',1,'backpack',tier+1);
    expected:=pg_catalog.jsonb_set(expected,'{carry}',carry,true);
    expected:=pg_catalog.jsonb_set(expected,'{eco,pack,cap}',pg_catalog.to_jsonb(cap),false);
    expected:=pg_catalog.jsonb_set(expected,'{eco,pack,maxMass}',pg_catalog.to_jsonb(mass),true);
  ELSIF NOT (b ? 'carry') THEN
    mass:=18+2*((b->>'lvl')::integer-1);
    IF public.mn_starter_valid_goods(goods,18,mass) IS NOT TRUE THEN RETURN false; END IF;
    expected:=pg_catalog.jsonb_set(expected,'{carry}',pg_catalog.jsonb_build_object('v',1,'backpack',0),true);
    expected:=pg_catalog.jsonb_set(expected,'{eco,pack,cap}','18'::jsonb,false);
    expected:=pg_catalog.jsonb_set(expected,'{eco,pack,maxMass}',pg_catalog.to_jsonb(mass),true);
  END IF;
  IF nextprog IS DISTINCT FROM prog OR b ? 'progression' THEN expected:=pg_catalog.jsonb_set(expected,'{progression}',nextprog,true); END IF;
  tier:=CASE WHEN expected->'carry' IS NULL THEN 0 ELSE (expected->'carry'->>'backpack')::integer END;
  carry_view:=pg_catalog.jsonb_build_object('v',1,'backpack',tier,'volume',CASE tier WHEN 0 THEN 18 WHEN 1 THEN 30 ELSE 42 END,
    'strength',10+((expected->>'lvl')::integer-1),'maxMass',18+2*((expected->>'lvl')::integer-1));
  RETURN n IS NOT DISTINCT FROM expected AND ack->'rev' IS NOT DISTINCT FROM expected->'eco'->'tradeRev' AND
    ack->'workshop' IS NOT DISTINCT FROM newws AND ack->'carry' IS NOT DISTINCT FROM carry_view;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_starter_raft_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; cmd jsonb; ack jsonb; oldships jsonb; newships jsonb; os jsonb; ns jsonb;
  parts jsonb; nextparts jsonb; piece jsonb; hold0 jsonb; hold1 jsonb; pack0 jsonb; pack1 jsonb;
  condition0 jsonb; condition1 jsonb; entries jsonb; entry jsonb; expectcondition jsonb; expectship jsonb;
  expectprofile jsonb; goods0 jsonb; goods1 jsonb; holdgoods0 jsonb; holdgoods1 jsonb; packgoods0 jsonb; packgoods1 jsonb;
  ws0 jsonb; ws1 jsonb; rev bigint; cap0 integer; cap1 integer; si integer; idx integer; i integer; nextid bigint;
  refund integer:=0; woodcost integer:=0; fromhold integer:=0; g text; h0 numeric; h1 numeric; p0 numeric; p1 numeric; sal integer;
  carry jsonb; tier integer; mass bigint; maxhold integer; x integer; z integer; level integer; rotation integer;
BEGIN
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack'; piece:=cmd->'piece';
  IF ((p_request->'worldData')-'resources'::text) IS DISTINCT FROM (p_world-'resources'::text) THEN RETURN false; END IF;
  IF p_world ? 'resources' THEN
    IF NOT (p_request->'worldData' ? 'resources') OR
      ((p_request->'worldData'->'resources')-'tick'::text) IS DISTINCT FROM ((p_world->'resources')-'tick'::text) OR
      (p_request->'worldData'->'resources'->>'tick')::numeric<(p_world->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  ELSIF p_request->'worldData' ? 'resources' THEN RETURN false; END IF;
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb OR cmd->>'type'<>'raft' OR cmd->>'rules'<>'2' OR
     cmd->>'expectedRev' IS NULL OR ack->'why' IS DISTINCT FROM '""'::jsonb OR
     ack->'rev' IS DISTINCT FROM pg_catalog.to_jsonb((cmd->>'expectedRev')::bigint+1) THEN RETURN false; END IF;
  oldships:=b->'eco'->'ships'; newships:=n->'eco'->'ships';
  IF pg_catalog.jsonb_typeof(oldships)<>'array' OR pg_catalog.jsonb_array_length(oldships)<>pg_catalog.jsonb_array_length(newships) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(oldships) s WHERE s->>'id'=cmd->>'id')<>1 THEN RETURN false; END IF;
  SELECT value,ordinal::integer-1 INTO os,si FROM pg_catalog.jsonb_array_elements(oldships) WITH ORDINALITY s(value,ordinal) WHERE value->>'id'=cmd->>'id';
  ns:=newships->si; parts:=os->'grid'->'parts'; nextparts:=ns->'grid'->'parts';
  hold0:=os->'hold'; hold1:=ns->'hold'; pack0:=b->'eco'->'pack'; pack1:=n->'eco'->'pack';
  IF os->>'kind'<>'raft' OR os->>'at'<>'aldea' OR (os->>'hp')::numeric<=0 OR
     os->'rev' IS DISTINCT FROM cmd->'expectedRev' OR pg_catalog.jsonb_typeof(parts)<>'array' OR
     pg_catalog.jsonb_array_length(parts)<1 OR pg_catalog.jsonb_array_length(parts)>599 THEN RETURN false; END IF;
  SELECT COALESCE(sum(CASE p->>0 WHEN 'storage' THEN 20 WHEN 'chest' THEN 8 WHEN 'crate' THEN 6 ELSE 0 END),0)::integer INTO cap0
    FROM pg_catalog.jsonb_array_elements(parts) p;
  holdgoods0:=hold0->'goods'; packgoods0:=pack0->'goods'; packgoods1:=pack1->'goods'; holdgoods1:=hold1->'goods';
  IF cmd->>'op'='place' THEN
    IF pg_catalog.jsonb_array_length(nextparts)<>pg_catalog.jsonb_array_length(parts)+1 OR nextparts->(pg_catalog.jsonb_array_length(parts)) IS DISTINCT FROM piece THEN RETURN false; END IF;
    x:=(piece->>1)::integer; z:=(piece->>2)::integer; level:=(piece->>3)::integer; rotation:=(piece->>4)::integer;
    IF piece->>0 NOT IN ('storage','crate') OR NOT public.mn_death_int(piece->1,-128,128) OR NOT public.mn_death_int(piece->2,-128,128) OR
       NOT public.mn_death_int(piece->3,0,2) OR NOT public.mn_death_int(piece->4,0,3) OR
       NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->1=piece->1 AND p->2=piece->2 AND p->3=piece->3 AND
          ((level=0 AND p->>0 IN ('foundation','reinforcedFoundation')) OR (level>0 AND p->>0='floor'))) OR
       (piece->>0='storage' AND NOT (COALESCE(b->'progression'->'knowledge','[]'::jsonb) ? 'raft_storage')) OR
       EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->3=piece->3 AND
          ((p->>0 IN ('storage','crate','chest','stairs','ladder','sail','bigSail','engine','anchor','cropPlot','canePlot','purifier','net','grill','still','research','bed','bunk','torchFloor','campfire','lantern','turret','decor','pillar') AND
             p->1=piece->1 AND p->2=piece->2) OR
           (p->>0='bigSail' AND x BETWEEN (p->>1)::integer AND (p->>1)::integer+1 AND
             z BETWEEN (p->>2)::integer AND (p->>2)::integer+1)))
       THEN RETURN false; END IF;
  ELSIF cmd->>'op'='remove' THEN
    idx:=(cmd->>'index')::integer;
    IF idx<0 OR idx>=pg_catalog.jsonb_array_length(parts) OR parts->idx IS DISTINCT FROM piece OR
       pg_catalog.jsonb_array_length(nextparts)<>pg_catalog.jsonb_array_length(parts)-1 OR nextparts IS DISTINCT FROM (parts-idx) THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  SELECT COALESCE(sum(CASE p->>0 WHEN 'storage' THEN 20 WHEN 'chest' THEN 8 WHEN 'crate' THEN 6 ELSE 0 END),0)::integer INTO cap1
    FROM pg_catalog.jsonb_array_elements(nextparts) p;
  IF hold0->'cap' IS DISTINCT FROM pg_catalog.to_jsonb(cap0) OR hold1->'cap' IS DISTINCT FROM pg_catalog.to_jsonb(cap1) OR
     pg_catalog.jsonb_typeof(holdgoods0)<>'object' OR pg_catalog.jsonb_typeof(holdgoods1)<>'object' OR
     NOT public.mn_starter_valid_goods(holdgoods0,cap0,1000000000) THEN RETURN false; END IF;
  condition0:=os->'condition'; condition1:=ns->'condition'; expectcondition:=condition0;
  IF condition0 IS NOT NULL AND condition0<>'null'::jsonb THEN
    entries:=condition0->'entries';
    IF condition0->'v'<>'1'::jsonb OR NOT public.mn_death_int(condition0->'next',1,1000000000) OR
       pg_catalog.jsonb_typeof(entries)<>'array' OR pg_catalog.jsonb_array_length(entries)<>pg_catalog.jsonb_array_length(parts) THEN RETURN false; END IF;
    IF cmd->>'op'='place' THEN
      nextid:=(condition0->>'next')::bigint;
      IF nextid>=999999400 THEN RETURN false; END IF;
      WHILE EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(entries) e WHERE e->>0='p'||nextid::text) LOOP nextid:=nextid+1; END LOOP;
      expectcondition:=pg_catalog.jsonb_set(condition0,'{next}',pg_catalog.to_jsonb(nextid+1),false);
      expectcondition:=pg_catalog.jsonb_set(expectcondition,'{entries}',entries||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_array('p'||nextid::text,piece->0,piece->1,piece->2,piece->3,piece->4,
          CASE piece->>0 WHEN 'storage' THEN 40 ELSE 15 END)),false);
    ELSE
      entry:=entries->idx;
      IF pg_catalog.jsonb_array_length(entry)<>7 OR entry->0 IS DISTINCT FROM entries->idx->0 THEN RETURN false; END IF;
      refund:=CASE piece->>0 WHEN 'storage' THEN pg_catalog.floor(3::double precision*((entry->>6)::double precision/40)+1e-10)::integer
        ELSE pg_catalog.floor(1::double precision*((entry->>6)::double precision/15)+1e-10)::integer END;
      expectcondition:=pg_catalog.jsonb_set(condition0,'{entries}',entries-idx,false);
    END IF;
  END IF;
  IF condition1 IS DISTINCT FROM expectcondition THEN RETURN false; END IF;
  ws0:=public.mn_starter_workshop(b); ws1:=ws0;
  IF cmd->>'op'='place' THEN
    IF piece->>0='storage' THEN
      IF (ws0->'storageCredit')='true'::jsonb THEN ws1:=pg_catalog.jsonb_set(ws0,'{storageCredit}','false'::jsonb,false);
      ELSE woodcost:=10; END IF;
    ELSE
      IF (ws0->>'crateKits')::integer<1 THEN RETURN false; END IF;
      ws1:=pg_catalog.jsonb_set(ws0,'{crateKits}',pg_catalog.to_jsonb((ws0->>'crateKits')::integer-1),false);
    END IF;
    fromhold:=LEAST(COALESCE((holdgoods0->>'madera')::integer,0),woodcost);
    IF COALESCE((holdgoods0->>'madera')::integer,0)+COALESCE((packgoods0->>'madera')::integer,0)<woodcost THEN RETURN false; END IF;
    holdgoods1:=holdgoods0-'madera'::text;
    IF COALESCE((holdgoods0->>'madera')::integer,0)>fromhold THEN holdgoods1:=holdgoods1||pg_catalog.jsonb_build_object('madera',(holdgoods0->>'madera')::integer-fromhold); END IF;
    packgoods1:=packgoods0-'madera'::text;
    IF COALESCE((packgoods0->>'madera')::integer,0)>woodcost-fromhold THEN packgoods1:=packgoods1||pg_catalog.jsonb_build_object('madera',(packgoods0->>'madera')::integer-(woodcost-fromhold)); END IF;
  ELSE
    IF piece->>0='storage' THEN
      refund:=pg_catalog.floor(3::double precision*(COALESCE((entries->idx->>6)::double precision,40)/40)+1e-10)::integer;
    ELSE
      refund:=pg_catalog.floor(1::double precision*(COALESCE((entries->idx->>6)::double precision,15)/15)+1e-10)::integer;
    END IF;
    packgoods1:=pack1->'goods';
    IF pg_catalog.jsonb_typeof(packgoods1)<>'object' THEN RETURN false; END IF;
  END IF;
  mass:=CASE WHEN pack1 ? 'maxMass' THEN (pack1->>'maxMass')::bigint ELSE 1000000000 END;
  IF public.mn_starter_valid_goods(holdgoods1,cap1,1000000000) IS NOT TRUE OR
     public.mn_starter_valid_goods(packgoods1,(pack1->>'cap')::bigint,mass) IS NOT TRUE THEN RETURN false; END IF;
  expectship:=pg_catalog.jsonb_set(os,'{grid,parts}',nextparts,false);
  expectship:=pg_catalog.jsonb_set(expectship,'{hold,cap}',pg_catalog.to_jsonb(cap1),false);
  expectship:=pg_catalog.jsonb_set(expectship,'{hold,goods}',holdgoods1,false);
  expectship:=pg_catalog.jsonb_set(expectship,'{rev}',pg_catalog.to_jsonb((os->>'rev')::bigint+1),false);
  IF condition0 IS NOT NULL AND condition0<>'null'::jsonb THEN expectship:=pg_catalog.jsonb_set(expectship,'{condition}',expectcondition,false); END IF;
  IF ns IS DISTINCT FROM expectship THEN RETURN false; END IF;
  expectprofile:=pg_catalog.jsonb_set(b,'{eco,ships}',pg_catalog.jsonb_set(oldships,ARRAY[si::text],ns,false),false);
  pack1:=pg_catalog.jsonb_set(pack1,'{goods}',packgoods1,false);
  expectprofile:=pg_catalog.jsonb_set(expectprofile,'{eco,pack}',pack1,false);
  IF ws1 IS DISTINCT FROM ws0 OR b ? 'workshop' THEN expectprofile:=pg_catalog.jsonb_set(expectprofile,'{workshop}',ws1,true); END IF;
  FOR g IN SELECT key FROM pg_catalog.jsonb_each((holdgoods0)||(packgoods0)||(holdgoods1)||(packgoods1)) LOOP
    h0:=COALESCE((holdgoods0->>g)::numeric,0); p0:=COALESCE((packgoods0->>g)::numeric,0);
    h1:=COALESCE((holdgoods1->>g)::numeric,0); p1:=COALESCE((packgoods1->>g)::numeric,0);
    IF cmd->>'op'='place' THEN
      IF h0+p0-h1-p1<>(CASE WHEN g='madera' THEN woodcost ELSE 0 END) THEN RETURN false; END IF;
    ELSE
      IF h1+p1<>h0+p0+(CASE WHEN g='madera' THEN refund ELSE 0 END) OR p1<p0 OR
         h1>h0+(CASE WHEN g='madera' THEN refund ELSE 0 END) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN n IS NOT DISTINCT FROM expectprofile AND ack->'rev' IS NOT DISTINCT FROM pg_catalog.to_jsonb((os->>'rev')::bigint+1);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_workshop_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request));

REVOKE ALL ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_starter_workshop_ready(),
  public.mn_valid_starter_workshop_request(uuid,jsonb),public.mn_valid_resource_state(jsonb),
  public.mn_upgrade_resource_state_timing(jsonb),public.mn_commit_economic_operation_starter_base(uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_starter_workshop_ready()
  TO service_role;

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; current_profile jsonb; current_world jsonb; pv integer; wv integer;
  receipt_request jsonb; receipt_result jsonb; row jsonb; ids uuid[]; v_account uuid; normalized jsonb;
  current_palms jsonb; next_palms jsonb;
BEGIN
  IF ((p_request ? 'before' AND p_request->'command'->>'type'='artisan' AND
      p_request->'command'->>'op' IN ('contribute','craftCrate','upgradePack')) OR
      (p_request ? 'before' AND p_request->'command'->>'type'='raft' AND p_request->'command'->>'rules'='2') OR
      public.mn_starter_is_palm_gather(p_request)) IS NOT TRUE THEN
    -- SQL016 did not freeze v3 ledger quality metadata on unrelated economic operations.
    -- Preserve its exact request and receipt path while guarding a locked v3 world/profile.
    a:=(p_request->>'account')::uuid; w:=p_request->>'world';
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    SELECT request,result INTO receipt_request,receipt_result FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
    IF FOUND THEN RETURN public.mn_commit_economic_operation_starter_base(p_operation_id,p_request); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
    SELECT economy INTO current_world FROM public.mn_worlds WHERE world=w FOR UPDATE;
    IF current_world->'resources'->>'v'='3' THEN
      IF p_request->'worldData'->'resources'->>'v'<>'3' OR
         NOT public.mn_death_int(p_request->'worldData'->'resources'->'tick',0,9007199254740991) OR
         (p_request->'worldData'->'resources'->>'tick')::numeric < (current_world->'resources'->>'tick')::numeric THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
      IF p_request->'command'->>'type'='resource' THEN
        SELECT COALESCE(pg_catalog.jsonb_agg(value ORDER BY value->>'id'),'[]'::jsonb) INTO current_palms
          FROM pg_catalog.jsonb_array_elements(current_world->'resources'->'nodes') WHERE value->>'kind'='palm';
        SELECT COALESCE(pg_catalog.jsonb_agg(value ORDER BY value->>'id'),'[]'::jsonb) INTO next_palms
          FROM pg_catalog.jsonb_array_elements(p_request->'worldData'->'resources'->'nodes') WHERE value->>'kind'='palm';
        IF ((p_request->'worldData'->'resources')-'tick'::text-'nodes'::text-'cooldowns'::text) IS DISTINCT FROM
             ((current_world->'resources')-'tick'::text-'nodes'::text-'cooldowns'::text) OR
           p_request->'worldData'->'resources'->'logging' IS DISTINCT FROM current_world->'resources'->'logging' OR
           next_palms IS DISTINCT FROM current_palms THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
      ELSIF ((p_request->'worldData'->'resources')-'tick'::text) IS DISTINCT FROM
            ((current_world->'resources')-'tick'::text) THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
      END IF;
      IF p_request ? 'beneficiaries' THEN
        FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') LOOP
          IF public.mn_starter_profile_carry_frozen(row->'before',row->'profile') IS NOT TRUE THEN
            RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
        END LOOP;
      ELSIF p_request ? 'before' THEN
        IF public.mn_starter_profile_carry_frozen(p_request->'before',p_request->'profile') IS NOT TRUE THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
      ELSE
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
        SELECT data INTO current_profile FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
        IF current_profile IS NULL OR public.mn_starter_profile_carry_frozen(current_profile,p_request->'profile') IS NOT TRUE THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
      END IF;
    END IF;
    RETURN public.mn_commit_economic_operation_starter_base(p_operation_id,p_request);
  END IF;
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
     NOT public.mn_valid_economic_request(p_operation_id,p_request) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  SELECT request,result INTO receipt_request,receipt_result FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF receipt_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN receipt_result||pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.mn_pearl_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_death_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) OR
     EXISTS(SELECT 1 FROM public.mn_pearl_intents WHERE operation_id=p_operation_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  a:=(p_request->>'account')::uuid; w:=p_request->>'world';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
  IF p_request ? 'beneficiaries' THEN
    SELECT pg_catalog.array_agg((value->>'account')::uuid ORDER BY value->>'account') INTO ids
      FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries');
  ELSE ids:=ARRAY[a]; END IF;
  FOREACH v_account IN ARRAY ids LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||v_account::text,0));
  END LOOP;
  FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(p_request->'beneficiaries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account',a::text,'expectedVersion',p_request->'expectedProfileVersion',
        'before',p_request->'before','profile',p_request->'profile')))) ORDER BY value->>'account' LOOP
    v_account:=(row->>'account')::uuid;
    SELECT data,version INTO current_profile,pv FROM public.mn_profiles WHERE player_id=v_account FOR UPDATE;
    IF pv IS NULL OR pv<>(CASE WHEN p_request ? 'beneficiaries' THEN (row->>'expectedVersion')::integer
        ELSE (p_request->>'expectedProfileVersion')::integer END) OR current_profile IS DISTINCT FROM row->'before' THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  END LOOP;
  SELECT economy,version INTO current_world,wv FROM public.mn_worlds WHERE world=w FOR UPDATE;
  IF wv IS NULL OR wv<>(p_request->>'expectedWorldVersion')::integer OR
     current_world->>'seed' IS DISTINCT FROM p_request->'worldData'->>'seed' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  IF p_request->'command'->>'type'='artisan' THEN
    IF public.mn_valid_starter_workshop_transition(p_request,current_world) IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  ELSIF p_request->'command'->>'type'='raft' THEN
    IF public.mn_valid_starter_raft_transition(p_request,current_world) IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  ELSE
    IF NOT (p_request ? 'beneficiaries') THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    normalized:=public.mn_starter_v3_normalize(p_request);
    IF normalized IS NULL OR NOT public.mn_valid_starter_v3_transition(p_operation_id,p_request,current_world) THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  END IF;
  receipt_result:=public.mn_economic_result(p_operation_id,p_request);
  IF p_request ? 'beneficiaries' THEN
    FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') ORDER BY value->>'account' LOOP
      UPDATE public.mn_profiles SET data=row->'profile',version=version+1,updated_at=pg_catalog.now()
        WHERE player_id=(row->>'account')::uuid;
    END LOOP;
  ELSE
    UPDATE public.mn_profiles SET data=p_request->'profile',version=version+1,updated_at=pg_catalog.now() WHERE player_id=a;
  END IF;
  UPDATE public.mn_worlds SET economy=p_request->'worldData',version=wv+1,updated_at=pg_catalog.now() WHERE world=w;
  INSERT INTO public.mn_economic_operations(operation_id,request,result) VALUES(p_operation_id,p_request,receipt_result);
  RETURN receipt_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

REVOKE ALL ON FUNCTION public.mn_starter_valid_goods(jsonb,bigint,bigint),
  public.mn_starter_valid_pack(jsonb),public.mn_starter_valid_workshop(jsonb),public.mn_starter_workshop(jsonb),
  public.mn_resource_state_v3_as_v2(jsonb),public.mn_upgrade_resource_state_timing(jsonb),
  public.mn_starter_profile_carry_frozen(jsonb,jsonb),public.mn_starter_is_palm_gather(jsonb),
  public.mn_starter_timing_quality(jsonb,jsonb),public.mn_starter_v3_normalize(jsonb),
  public.mn_valid_starter_workshop_request(uuid,jsonb),public.mn_valid_starter_workshop_transition(jsonb,jsonb),
  public.mn_valid_starter_raft_transition(jsonb,jsonb),public.mn_valid_starter_v3_transition(uuid,jsonb,jsonb),
  public.mn_valid_resource_state(jsonb),public.mn_valid_economic_request_starter_base(uuid,jsonb),
  public.mn_valid_resource_state_starter_base(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_starter_valid_goods(jsonb,bigint,bigint),
  public.mn_starter_valid_pack(jsonb),public.mn_starter_valid_workshop(jsonb),public.mn_starter_workshop(jsonb),
  public.mn_resource_state_v3_as_v2(jsonb),public.mn_upgrade_resource_state_timing(jsonb),
  public.mn_starter_profile_carry_frozen(jsonb,jsonb),public.mn_starter_is_palm_gather(jsonb),
  public.mn_starter_timing_quality(jsonb,jsonb),public.mn_starter_v3_normalize(jsonb),
  public.mn_valid_starter_workshop_request(uuid,jsonb),public.mn_valid_starter_workshop_transition(jsonb,jsonb),
  public.mn_valid_starter_raft_transition(jsonb,jsonb),public.mn_valid_starter_v3_transition(uuid,jsonb,jsonb),
  public.mn_valid_resource_state(jsonb),public.mn_valid_economic_request_starter_base(uuid,jsonb),
  public.mn_valid_resource_state_starter_base(jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_starter_workshop_ready()
  TO service_role;
REVOKE ALL ON FUNCTION public.mn_commit_economic_operation_starter_base(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_starter_workshop_ready() FROM PUBLIC,anon,authenticated;

COMMIT;

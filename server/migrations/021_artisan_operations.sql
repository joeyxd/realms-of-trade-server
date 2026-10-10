-- Personal raft-storage learning and construction edits share the M5 economic receipt.
-- Apply after 001-019. Candidate construction and gameplay eligibility remain host-owned.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_artisan_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_artisan_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_commit_economic_operation_artisan_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_economic_operation(uuid,jsonb) RENAME TO mn_commit_economic_operation_artisan_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_artisan_world(p_request jsonb,p_current jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE n jsonb; c jsonb;
BEGIN
  n:=p_request->'worldData'; c:=p_current;
  IF (n-'resources'::text) IS DISTINCT FROM (c-'resources'::text) THEN RETURN false; END IF;
  IF c ? 'resources' THEN
    IF NOT (n ? 'resources') OR ((n->'resources')-'tick'::text) IS DISTINCT FROM ((c->'resources')-'tick'::text) OR
       (n->'resources'->>'tick')::numeric<(c->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  ELSIF n ? 'resources' THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_artisan_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; kind text; op text; cnt integer; base jsonb;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     NOT (p_request ? 'before') OR (p_request ? 'beneficiaries') OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion',
       'profile','worldData','ack','before']) OR
     pg_catalog.jsonb_typeof(p_request->'before') IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length((p_request->'before')::text)>131072 THEN RETURN false; END IF;
  cmd:=p_request->'command'; ack:=p_request->'ack'; kind:=cmd->>'type'; op:=cmd->>'op';
  IF pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR (cmd->>'opId') !~ '^[A-Za-z0-9_-]{1,64}$' OR
     pg_catalog.jsonb_typeof(ack) IS DISTINCT FROM 'object' OR ack ? 'to' OR
     ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
     pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR
     pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR pg_catalog.char_length(ack->>'why')>64 OR
     NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  IF kind='artisan' AND op='learn' THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>6 OR
       NOT (cmd ?& ARRAY['type','op','opId','lesson','expectedRev','expectedProjectRev']) OR
       cmd->>'lesson' IS DISTINCT FROM 'raft_storage' OR NOT public.mn_death_int(cmd->'expectedRev',0,2147483646) OR
       NOT public.mn_death_int(cmd->'expectedProjectRev',1,2147483646) OR ack->>'type' IS DISTINCT FROM 'artisan' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>8 OR
       NOT (ack ?& ARRAY['type','op','opId','lesson','ok','why','rev','project']) OR
       ack->>'lesson' IS DISTINCT FROM 'raft_storage' OR pg_catalog.jsonb_typeof(ack->'project') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  ELSIF kind='raft' AND op IN ('place','remove') THEN
    cnt:=(SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd));
    IF (op='place' AND (cnt<>6 OR NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece']))) OR
       (op='remove' AND (cnt<>7 OR NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece','index']))) OR
       pg_catalog.jsonb_typeof(cmd->'id') IS DISTINCT FROM 'string' OR (cmd->>'id') !~ '^[A-Za-z0-9:_-]{1,120}$' OR
       NOT public.mn_death_int(cmd->'expectedRev',1,2147483646) OR
       pg_catalog.jsonb_typeof(cmd->'piece') IS DISTINCT FROM 'array' OR
       pg_catalog.jsonb_array_length(cmd->'piece')<>5 OR cmd->'piece'->>0 IS DISTINCT FROM 'storage' OR
       NOT public.mn_death_int(cmd->'piece'->1,-128,128) OR NOT public.mn_death_int(cmd->'piece'->2,-128,128) OR
       NOT public.mn_death_int(cmd->'piece'->3,0,2) OR NOT public.mn_death_int(cmd->'piece'->4,0,3) OR
       (op='remove' AND NOT public.mn_death_int(cmd->'index',0,599)) OR ack->>'type' IS DISTINCT FROM 'raftEdit' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack)) NOT IN (7,8) OR
       NOT (ack ?& ARRAY['type','id','op','opId','ok','why','rev']) OR
       ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))=8 AND NOT (ack ? 'record')) OR
       (ack ? 'record' AND (ack->'ok' IS DISTINCT FROM 'false'::jsonb OR pg_catalog.jsonb_typeof(ack->'record') IS DISTINCT FROM 'object')) OR
       ack->>'id' IS DISTINCT FROM cmd->>'id'
       THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  base:=p_request-'before'::text;
  base:=pg_catalog.jsonb_set(base,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy',
    'opId',cmd->'opId','town','aldea','g','madera','n',1,'expectedTotal',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy',
    'opId',cmd->'opId','ok',true,'why','','rev',0),false);
  RETURN public.mn_valid_economic_request_artisan_base(p_operation_id,base) AND
    (NOT (p_request->'before' ? 'progression') OR public.mn_valid_logging_progression(p_request->'before'->'progression')) AND
    (NOT (p_request->'profile' ? 'progression') OR public.mn_valid_logging_progression(p_request->'profile'->'progression'));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_request ? 'before' THEN RETURN public.mn_valid_artisan_request(p_operation_id,p_request); END IF;
  RETURN public.mn_valid_economic_request_artisan_base(p_operation_id,p_request);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_artisan_teaching_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; b jsonb; n jsonb; w jsonb; oldp jsonb; newp jsonb;
  oldgoods jsonb; newgoods jsonb; expectedgoods jsonb; oldwood bigint; project jsonb; expected_project jsonb;
BEGIN
  cmd:=p_request->'command'; ack:=p_request->'ack'; b:=p_request->'before'; n:=p_request->'profile'; w:=p_request->'worldData';
  oldp:=COALESCE(b->'progression',pg_catalog.jsonb_build_object('v',1,'practice',pg_catalog.jsonb_build_object('logging',0),'milestones','[]'::jsonb,'knowledge','[]'::jsonb));
  newp:=n->'progression';
  project:=p_world->'community'->'project';
  expected_project:=project||pg_catalog.jsonb_build_object('name','Carpintería de Salty Shore',
    'complete',(project->'requirements'->'madera'=project->'contributed'->'madera' AND
      project->'requirements'->'piedra'=project->'contributed'->'piedra'));
  IF cmd->>'lesson' IS DISTINCT FROM 'raft_storage' OR
     NOT public.mn_death_int(b->'eco'->'tradeRev',0,2147483645) THEN RETURN false; END IF;
  IF (b->'eco'->>'tradeRev')::bigint<>(cmd->>'expectedRev')::bigint THEN RETURN false; END IF;
  IF (n->'eco'->>'tradeRev')::bigint<>(cmd->>'expectedRev')::bigint+1 THEN RETURN false; END IF;
  IF (COALESCE((oldp->'practice'->>'logging')::bigint,0)<60 AND NOT (oldp->'milestones' ? 'logging_steady')) THEN RETURN false; END IF;
  IF COALESCE(oldp->'knowledge','[]'::jsonb) ? 'raft_storage' THEN RETURN false; END IF;
  IF newp IS NULL THEN RETURN false; END IF;
  IF newp->'v' IS DISTINCT FROM oldp->'v' THEN RETURN false; END IF;
  IF newp->'practice' IS DISTINCT FROM oldp->'practice' THEN RETURN false; END IF;
  IF newp->'milestones' IS DISTINCT FROM oldp->'milestones' THEN RETURN false; END IF;
  IF newp->'knowledge' IS DISTINCT FROM (COALESCE(oldp->'knowledge','[]'::jsonb)||pg_catalog.jsonb_build_array('raft_storage')) THEN RETURN false; END IF;
  IF (n-'progression'::text-'eco'::text) IS DISTINCT FROM (b-'progression'::text-'eco'::text) THEN RETURN false; END IF;
  IF ((n->'eco')-'tradeRev'::text-'pack'::text) IS DISTINCT FROM ((b->'eco')-'tradeRev'::text-'pack'::text) THEN RETURN false; END IF;
  oldgoods:=COALESCE(b->'eco'->'pack'->'goods','{}'::jsonb); newgoods:=n->'eco'->'pack'->'goods';
  IF pg_catalog.jsonb_typeof(oldgoods) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(newgoods) IS DISTINCT FROM 'object' THEN
    RETURN false; END IF;
  oldwood:=COALESCE((oldgoods->>'madera')::bigint,0);
  IF oldwood<2 THEN RETURN false; END IF;
  expectedgoods:=oldgoods-'madera'::text;
  IF oldwood>2 THEN expectedgoods:=expectedgoods||pg_catalog.jsonb_build_object('madera',oldwood-2); END IF;
  IF newgoods IS DISTINCT FROM expectedgoods OR ((n->'eco'->'pack')-'goods'::text) IS DISTINCT FROM ((b->'eco'->'pack')-'goods'::text)
    THEN RETURN false; END IF;
  IF w->'community' IS DISTINCT FROM p_world->'community' THEN RETURN false; END IF;
  IF w->'economy' IS DISTINCT FROM p_world->'economy' THEN RETURN false; END IF;
  IF project->>'id' IS DISTINCT FROM 'salty-shore-carpentry' THEN RETURN false; END IF;
  IF (project->>'version')::bigint<>(cmd->>'expectedProjectRev')::bigint THEN RETURN false; END IF;
  IF expected_project->'complete' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  IF ack->'lesson' IS DISTINCT FROM '"raft_storage"'::jsonb OR ack->'project' IS DISTINCT FROM expected_project THEN RETURN false; END IF;
  IF ack->>'why' IS DISTINCT FROM '' OR ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  IF (p_request->'ack'->>'rev')::bigint<>(cmd->>'expectedRev')::bigint+1 THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

-- Bounded cargo checks use the existing catalogue volumes. No item or capacity is minted.
CREATE OR REPLACE FUNCTION public.mn_valid_artisan_hold(p_hold jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE g text; amount jsonb; used bigint := 0; volume integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_hold) IS DISTINCT FROM 'object' OR
     NOT (p_hold ?& ARRAY['cap','goods']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_hold))<>2 OR
     NOT public.mn_death_int(p_hold->'cap',0,1000000) OR
     pg_catalog.jsonb_typeof(p_hold->'goods') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR g,amount IN SELECT key,value FROM pg_catalog.jsonb_each(p_hold->'goods') LOOP
    IF g NOT IN ('pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra','hierro',
       'mineral_hierro','azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas') OR
       NOT public.mn_death_int(amount,1,1000000) THEN RETURN false; END IF;
    volume:=CASE WHEN g IN ('madera','tronco','hierro','mineral_hierro','balas') THEN 3
      WHEN g IN ('cana','piedra','azufre','lona') THEN 2 ELSE 1 END;
    used:=used+(amount::text)::bigint*volume;
  END LOOP;
  RETURN used<=(p_hold->>'cap')::bigint;
EXCEPTION WHEN data_exception THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_artisan_storage_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; b jsonb; n jsonb; os jsonb; ns jsonb; oldships jsonb; newships jsonb;
  parts jsonb; nextparts jsonb; piece jsonb; hold_old jsonb; hold_new jsonb; pack_old jsonb; pack_new jsonb;
  condition_old jsonb; condition_new jsonb; entries jsonb; entry jsonb; expected_condition jsonb;
  expected_ship jsonb; expected_profile jsonb; expected_goods jsonb; expected_pack_goods jsonb;
  ship_index integer; part_index integer; i integer; cap_old integer; cap_new integer; next_id bigint;
  refund integer := 3; wood_hold bigint; wood_pack bigint; from_hold bigint; g text;
  old_h bigint; new_h bigint; old_p bigint; new_p bigint; tuple_part jsonb; x integer; z integer; level integer;
BEGIN
  cmd:=p_request->'command'; b:=p_request->'before'; n:=p_request->'profile'; piece:=cmd->'piece';
  oldships:=b->'eco'->'ships'; newships:=n->'eco'->'ships';
  IF pg_catalog.jsonb_typeof(oldships) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(newships) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(oldships)<>pg_catalog.jsonb_array_length(newships) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(oldships) s WHERE s->>'id'=cmd->>'id')<>1 THEN RETURN false; END IF;
  SELECT value,ordinal::integer-1 INTO os,ship_index
    FROM pg_catalog.jsonb_array_elements(oldships) WITH ORDINALITY AS s(value,ordinal) WHERE value->>'id'=cmd->>'id';
  ns:=newships->ship_index; parts:=os->'grid'->'parts'; nextparts:=ns->'grid'->'parts';
  IF os->>'kind' IS DISTINCT FROM 'raft' OR os->>'at' IS DISTINCT FROM 'aldea' OR
     pg_catalog.jsonb_typeof(os->'hp') IS DISTINCT FROM 'number' OR (os->>'hp')::numeric<=0 OR
     NOT public.mn_death_int(os->'rev',1,2147483646) OR os->'rev' IS DISTINCT FROM cmd->'expectedRev' OR
     pg_catalog.jsonb_typeof(parts) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(parts)<1 OR
     pg_catalog.jsonb_array_length(parts)>600 OR pg_catalog.jsonb_typeof(nextparts) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(os->'grid'->'work') IS DISTINCT FROM 'object' OR
     p_request->'ack'->>'why' IS DISTINCT FROM '' OR
     p_request->'ack'->'rev' IS DISTINCT FROM pg_catalog.to_jsonb((os->>'rev')::bigint+1) THEN RETURN false; END IF;
  IF cmd->>'op'='place' THEN
    IF (COALESCE(b->'progression'->'knowledge','[]'::jsonb) ? 'raft_storage') IS NOT TRUE OR
       pg_catalog.jsonb_array_length(parts)>=600 OR
       nextparts IS DISTINCT FROM (parts||pg_catalog.jsonb_build_array(piece)) THEN RETURN false; END IF;
    x:=(piece->>1)::integer; z:=(piece->>2)::integer; level:=(piece->>3)::integer;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE
      p->1=piece->1 AND p->2=piece->2 AND p->3=piece->3 AND
      ((level=0 AND p->>0 IN ('foundation','reinforcedFoundation')) OR (level>0 AND p->>0='floor'))) THEN RETURN false; END IF;
    -- Keep physical layout/occupancy in the host, but reject a doubled tile or pillar in storage's cell.
    IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->3=piece->3 AND
      ((p->>0 IN ('stairs','ladder','sail','engine','anchor','storage','chest','crate','cropPlot','canePlot',
        'purifier','net','grill','still','research','bed','bunk','lantern','turret','decor','pillar') AND
        p->1=piece->1 AND p->2=piece->2) OR
       (p->>0='bigSail' AND x BETWEEN (p->>1)::integer AND (p->>1)::integer+1 AND
        z BETWEEN (p->>2)::integer AND (p->>2)::integer+1))) THEN RETURN false; END IF;
  ELSIF cmd->>'op'='remove' THEN
    part_index:=(cmd->>'index')::integer;
    IF part_index<0 OR part_index>=pg_catalog.jsonb_array_length(parts) OR parts->part_index IS DISTINCT FROM piece OR
       pg_catalog.jsonb_array_length(parts)<=1 OR nextparts IS DISTINCT FROM (parts-part_index) THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  hold_old:=os->'hold'; hold_new:=ns->'hold'; pack_old:=b->'eco'->'pack'; pack_new:=n->'eco'->'pack';
  IF NOT public.mn_valid_artisan_hold(hold_old) OR NOT public.mn_valid_artisan_hold(hold_new) OR
     NOT public.mn_valid_artisan_hold(pack_old) OR NOT public.mn_valid_artisan_hold(pack_new) OR
     pack_old->'cap' IS DISTINCT FROM '10'::jsonb OR pack_new->'cap' IS DISTINCT FROM pack_old->'cap' THEN RETURN false; END IF;
  SELECT COALESCE(pg_catalog.sum(CASE p->>0 WHEN 'storage' THEN 20 WHEN 'chest' THEN 8 WHEN 'crate' THEN 6 ELSE 0 END),0)::integer
    INTO cap_old FROM pg_catalog.jsonb_array_elements(parts) p;
  SELECT COALESCE(pg_catalog.sum(CASE p->>0 WHEN 'storage' THEN 20 WHEN 'chest' THEN 8 WHEN 'crate' THEN 6 ELSE 0 END),0)::integer
    INTO cap_new FROM pg_catalog.jsonb_array_elements(nextparts) p;
  IF hold_old->'cap' IS DISTINCT FROM pg_catalog.to_jsonb(cap_old) OR
     hold_new->'cap' IS DISTINCT FROM pg_catalog.to_jsonb(cap_new) THEN RETURN false; END IF;

  condition_old:=os->'condition'; condition_new:=ns->'condition'; expected_condition:=condition_old;
  IF condition_old IS NOT NULL AND condition_old IS DISTINCT FROM 'null'::jsonb THEN
    entries:=condition_old->'entries';
    IF pg_catalog.jsonb_typeof(condition_old) IS DISTINCT FROM 'object' OR
       NOT (condition_old ?& ARRAY['v','next','entries']) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(condition_old))<>3 OR
       NOT public.mn_death_int(condition_old->'v',1,1) OR NOT public.mn_death_int(condition_old->'next',1,1000000000) OR
       pg_catalog.jsonb_typeof(entries) IS DISTINCT FROM 'array' OR
       pg_catalog.jsonb_array_length(entries)<>pg_catalog.jsonb_array_length(parts) THEN RETURN false; END IF;
    FOR i IN 0..pg_catalog.jsonb_array_length(entries)-1 LOOP
      entry:=entries->i; tuple_part:=parts->i;
      IF pg_catalog.jsonb_typeof(entry) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(entry)<>7 OR
         pg_catalog.jsonb_typeof(entry->0) IS DISTINCT FROM 'string' OR entry->>0 !~ '^[A-Za-z0-9:_-]{1,100}$' OR
         (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(entries) e WHERE e->0=entry->0)<>1 OR
         pg_catalog.jsonb_build_array(entry->1,entry->2,entry->3,entry->4,entry->5) IS DISTINCT FROM tuple_part OR
         pg_catalog.jsonb_typeof(entry->6) IS DISTINCT FROM 'number' OR (entry->>6)::numeric<0 THEN RETURN false; END IF;
    END LOOP;
    IF cmd->>'op'='place' THEN
      next_id:=(condition_old->>'next')::bigint;
      IF next_id>=999999400 THEN RETURN false; END IF;
      WHILE EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(entries) e WHERE e->>0='p'||next_id::text) LOOP next_id:=next_id+1; END LOOP;
      expected_condition:=pg_catalog.jsonb_set(condition_old,'{next}',pg_catalog.to_jsonb(next_id+1),false);
      expected_condition:=pg_catalog.jsonb_set(expected_condition,'{entries}',entries||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_array('p'||next_id::text,'storage',piece->1,piece->2,piece->3,piece->4,40)),false);
    ELSE
      entry:=entries->part_index;
      IF (entry->>6)::numeric>40 THEN RETURN false; END IF;
      -- Match the JS salvage epsilon around representable fractional condition values.
      refund:=pg_catalog.floor(3::double precision*((entry->>6)::double precision/40)+1e-10)::integer;
      expected_condition:=pg_catalog.jsonb_set(condition_old,'{entries}',entries-part_index,false);
    END IF;
  END IF;
  IF condition_new IS DISTINCT FROM expected_condition THEN RETURN false; END IF;

  IF cmd->>'op'='place' THEN
    wood_hold:=COALESCE((hold_old->'goods'->>'madera')::bigint,0);
    wood_pack:=COALESCE((pack_old->'goods'->>'madera')::bigint,0);
    IF wood_hold+wood_pack<6 THEN RETURN false; END IF;
    from_hold:=LEAST(wood_hold,6); expected_goods:=(hold_old->'goods')-'madera'::text;
    expected_pack_goods:=(pack_old->'goods')-'madera'::text;
    IF wood_hold>from_hold THEN expected_goods:=expected_goods||pg_catalog.jsonb_build_object('madera',wood_hold-from_hold); END IF;
    IF wood_pack>6-from_hold THEN expected_pack_goods:=expected_pack_goods||pg_catalog.jsonb_build_object('madera',wood_pack-(6-from_hold)); END IF;
    IF hold_new->'goods' IS DISTINCT FROM expected_goods OR pack_new->'goods' IS DISTINCT FROM expected_pack_goods THEN RETURN false; END IF;
  ELSE
    -- Lossless redistribution is allowed only from hold to pack; the host chooses the fitting split.
    -- JSONB has no insertion order, so SQL proves conservation, direction and both bounded capacities.
    FOR g IN SELECT key FROM pg_catalog.jsonb_each((hold_old->'goods')||(pack_old->'goods')||(hold_new->'goods')||(pack_new->'goods')) LOOP
      old_h:=COALESCE((hold_old->'goods'->>g)::bigint,0); new_h:=COALESCE((hold_new->'goods'->>g)::bigint,0);
      old_p:=COALESCE((pack_old->'goods'->>g)::bigint,0); new_p:=COALESCE((pack_new->'goods'->>g)::bigint,0);
      IF new_h+new_p<>old_h+old_p+(CASE WHEN g='madera' THEN refund ELSE 0 END) OR new_p<old_p OR
         new_h>old_h+(CASE WHEN g='madera' THEN refund ELSE 0 END) THEN RETURN false; END IF;
    END LOOP;
    IF refund>0 AND NOT ((hold_new->'goods') ? 'madera' OR (pack_new->'goods') ? 'madera') THEN RETURN false; END IF;
  END IF;
  expected_ship:=pg_catalog.jsonb_set(os,'{grid,parts}',nextparts,false);
  expected_ship:=pg_catalog.jsonb_set(expected_ship,'{hold}',hold_new,false);
  expected_ship:=pg_catalog.jsonb_set(expected_ship,'{rev}',pg_catalog.to_jsonb((os->>'rev')::bigint+1),false);
  IF condition_old IS NOT NULL THEN expected_ship:=pg_catalog.jsonb_set(expected_ship,'{condition}',expected_condition,false); END IF;
  IF ns IS DISTINCT FROM expected_ship THEN RETURN false; END IF;
  expected_profile:=pg_catalog.jsonb_set(b,'{eco,ships}',pg_catalog.jsonb_set(oldships,ARRAY[ship_index::text],ns,false),false);
  expected_profile:=pg_catalog.jsonb_set(expected_profile,'{eco,pack}',pack_new,false);
  RETURN n IS NOT DISTINCT FROM expected_profile;
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_artisan_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF public.mn_valid_artisan_world(p_request,p_world) IS NOT TRUE THEN RETURN false; END IF;
  IF p_request->'ack'->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN p_request->'before' IS NOT DISTINCT FROM p_request->'profile';
  END IF;
  IF p_request->'command'->>'type'='artisan' THEN
    RETURN public.mn_valid_artisan_teaching_transition(p_request,p_world) IS TRUE;
  END IF;
  RETURN public.mn_valid_artisan_storage_transition(p_request) IS TRUE;
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request));

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; before_row jsonb; current_world jsonb; pv integer; wv integer;
BEGIN
  IF NOT (p_request ? 'before') THEN RETURN public.mn_commit_economic_operation_artisan_base(p_operation_id,p_request); END IF;
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
     NOT public.mn_valid_economic_request(p_operation_id,p_request) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  IF EXISTS(SELECT 1 FROM public.mn_economic_operations WHERE operation_id=p_operation_id) THEN
    RETURN public.mn_commit_economic_operation_artisan_base(p_operation_id,p_request);
  END IF;
  a:=(p_request->>'account')::uuid; w:=p_request->>'world';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
  SELECT data,version INTO before_row,pv FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
  SELECT economy,version INTO current_world,wv FROM public.mn_worlds WHERE world=w FOR UPDATE;
  IF pv IS NULL OR pv<>(p_request->>'expectedProfileVersion')::integer OR
     before_row IS DISTINCT FROM p_request->'before' OR wv IS NULL OR
     wv<>(p_request->>'expectedWorldVersion')::integer OR
     NOT public.mn_valid_artisan_transition(p_request,current_world) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  RETURN public.mn_commit_economic_operation_artisan_base(p_operation_id,p_request);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_artisan_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_artisan_world(jsonb,jsonb),public.mn_valid_artisan_request(uuid,jsonb),
  public.mn_valid_artisan_teaching_transition(jsonb,jsonb),
  public.mn_valid_artisan_hold(jsonb),public.mn_valid_artisan_storage_transition(jsonb),
  public.mn_valid_artisan_transition(jsonb,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_artisan_operations_ready()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_commit_economic_operation_artisan_base(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_valid_artisan_request(uuid,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_artisan_operations_ready() TO service_role;
COMMIT;

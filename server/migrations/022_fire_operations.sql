-- Bounded fuel receipts use the existing M5 economic snapshot and journal.
-- Apply after 001-021. SQL remains optional until explicitly activated by deployment.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_fire_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_fire_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_commit_economic_operation_fire_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_economic_operation(uuid,jsonb) RENAME TO mn_commit_economic_operation_fire_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_fire_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; base jsonb; op text; kind text;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     NOT (p_request ? 'before') OR p_request ? 'beneficiaries' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','profile','worldData','ack','before']) OR
     pg_catalog.jsonb_typeof(p_request->'before') IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length((p_request->'before')::text)>131072 THEN RETURN false; END IF;
  cmd:=p_request->'command'; ack:=p_request->'ack'; op:=cmd->>'op'; kind:=cmd->>'kind';
  IF pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
     NOT (cmd ?& ARRAY['type','op','opId','ship','part','kind','expectedRev','lit']) OR
     cmd->>'type' IS DISTINCT FROM 'fire' OR
     pg_catalog.jsonb_typeof(cmd->'op') IS DISTINCT FROM 'string' OR op NOT IN ('load','set') OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
     pg_catalog.jsonb_typeof(cmd->'ship') IS DISTINCT FROM 'string' OR pg_catalog.char_length(cmd->>'ship')>120 OR
     pg_catalog.jsonb_typeof(cmd->'part') IS DISTINCT FROM 'string' OR pg_catalog.char_length(cmd->>'part')>100 OR
     pg_catalog.jsonb_typeof(cmd->'kind') IS DISTINCT FROM 'string' OR
     kind NOT IN ('handTorch','lantern','torchFloor','torchWall','campfire','grill') OR
     NOT public.mn_death_int(cmd->'expectedRev',0,2147483646) OR
     pg_catalog.jsonb_typeof(cmd->'lit') IS DISTINCT FROM 'boolean' OR
     (kind='handTorch' AND (cmd->>'ship' IS DISTINCT FROM '' OR cmd->>'part' IS DISTINCT FROM 'hand')) OR
     (kind<>'handTorch' AND ((cmd->>'ship') !~ '^[A-Za-z0-9:_-]{1,120}$' OR
       (cmd->>'part') !~ '^[A-Za-z0-9:_-]{1,100}$' OR cmd->>'part'='hand')) OR
     pg_catalog.jsonb_typeof(ack) IS DISTINCT FROM 'object' OR ack ? 'to' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>6 OR
     NOT (ack ?& ARRAY['type','op','opId','ok','why','rev']) OR ack->>'type' IS DISTINCT FROM 'fire' OR
     pg_catalog.jsonb_typeof(ack->'op') IS DISTINCT FROM 'string' OR
     ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
     pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR
     pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR pg_catalog.char_length(ack->>'why')>64 OR
     NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  base:=p_request-'before'::text;
  base:=pg_catalog.jsonb_set(base,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy',
    'opId',cmd->'opId','town','aldea','g','madera','n',1,'expectedTotal',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy',
    'opId',cmd->'opId','ok',true,'why','','rev',0),false);
  RETURN public.mn_valid_economic_request_fire_base(p_operation_id,base);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_request ? 'before' AND p_request->'command'->>'type'='fire' THEN
    RETURN public.mn_valid_fire_request(p_operation_id,p_request) IS TRUE;
  END IF;
  RETURN public.mn_valid_economic_request_fire_base(p_operation_id,p_request);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_fire_world(p_request jsonb,p_current jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE n jsonb; c jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_current) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  n:=p_request->'worldData'; c:=p_current;
  IF pg_catalog.jsonb_typeof(c->'economy') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(c->'economy'->'hours') IS DISTINCT FROM 'number' OR
     (c->'economy'->>'hours')::numeric<0 THEN RETURN false; END IF;
  IF (n-'resources'::text) IS DISTINCT FROM (c-'resources'::text) THEN RETURN false; END IF;
  IF c ? 'resources' THEN
    IF NOT (n ? 'resources') OR ((n->'resources')-'tick'::text) IS DISTINCT FROM ((c->'resources')-'tick'::text) OR
       NOT public.mn_death_int(n->'resources'->'tick',0,9007199254740991) OR
       NOT public.mn_death_int(c->'resources'->'tick',0,9007199254740991) OR
       (n->'resources'->>'tick')::numeric<(c->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  ELSIF n ? 'resources' THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_fire_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; cmd jsonb; ack jsonb; oldfire jsonb; newfire jsonb; slotkey text;
  oldslot jsonb; newslot jsonb; wantedslot jsonb; wantedfire jsonb; expectedprofile jsonb;
  oldgoods jsonb; expectedgoods jsonb; holdgoods jsonb; ships jsonb; shiprow jsonb; expectedship jsonb;
  goodsfield text; station_index integer; seconds integer; remaining integer; now_sec numeric; duration integer;
  slot_name text; slot_value jsonb; slot_kind text; slot_duration integer;
BEGIN
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack';
  IF public.mn_valid_fire_world(p_request,p_world) IS NOT TRUE THEN RETURN false; END IF;
  oldfire:=COALESCE(b->'fire',pg_catalog.jsonb_build_object('v',1,'rev',0,'slots','{}'::jsonb)); newfire:=n->'fire';
  IF pg_catalog.jsonb_typeof(oldfire) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(oldfire))<>3 OR
     NOT (oldfire ?& ARRAY['v','rev','slots']) OR oldfire->'v' IS DISTINCT FROM '1'::jsonb OR
     NOT public.mn_death_int(oldfire->'rev',0,2147483646) OR pg_catalog.jsonb_typeof(oldfire->'slots') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(oldfire->'slots'))>601 THEN RETURN false; END IF;
  FOR slot_name,slot_value IN SELECT key,value FROM pg_catalog.jsonb_each(oldfire->'slots') LOOP
    slot_kind:=slot_value->>'kind';
    slot_duration:=CASE slot_kind WHEN 'handTorch' THEN 1200 WHEN 'lantern' THEN 3600 WHEN 'torchFloor' THEN 3600
      WHEN 'torchWall' THEN 3600 WHEN 'campfire' THEN 1800 WHEN 'grill' THEN 1800 ELSE NULL END;
    IF (slot_name<>'hand' AND slot_name !~ '^\["[A-Za-z0-9:_-]{1,120}","[A-Za-z0-9:_-]{1,120}"\]$') OR
       pg_catalog.jsonb_typeof(slot_value) IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(slot_value))<>4 OR
       NOT (slot_value ?& ARRAY['kind','seconds','since','lit']) OR slot_duration IS NULL OR
       NOT public.mn_death_int(slot_value->'seconds',0,slot_duration) OR
       pg_catalog.jsonb_typeof(slot_value->'since') IS DISTINCT FROM 'number' OR (slot_value->>'since')::numeric<0 OR
       pg_catalog.jsonb_typeof(slot_value->'lit') IS DISTINCT FROM 'boolean' OR
       (slot_value->'lit'='false'::jsonb AND slot_value->'since' IS DISTINCT FROM '0'::jsonb) THEN RETURN false; END IF;
  END LOOP;
  IF cmd->'expectedRev' IS DISTINCT FROM oldfire->'rev' THEN RETURN false; END IF;
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN b IS NOT DISTINCT FROM n AND ack->'rev' IS NOT DISTINCT FROM oldfire->'rev';
  END IF;
  IF pg_catalog.jsonb_typeof(newfire) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(newfire))<>3 OR
     NOT (newfire ?& ARRAY['v','rev','slots']) OR newfire->'v' IS DISTINCT FROM '1'::jsonb OR
     NOT public.mn_death_int(newfire->'rev',0,2147483646) OR pg_catalog.jsonb_typeof(newfire->'slots') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(newfire->'slots'))>601 THEN RETURN false; END IF;
  IF cmd->>'kind'='handTorch' THEN slotkey:='hand'; goodsfield:='pack';
  ELSE slotkey:=pg_catalog.replace(pg_catalog.jsonb_build_array(cmd->>'ship',cmd->>'part')::text,', ', ','); goodsfield:='hold'; END IF;
  IF goodsfield='hold' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(b->'eco'->'ships') s,
      LATERAL pg_catalog.jsonb_array_elements(s->'condition'->'entries') e
      WHERE s->>'id'=cmd->>'ship' AND s->>'kind'='raft' AND pg_catalog.jsonb_typeof(s->'hp')='number' AND (s->>'hp')::numeric>0 AND
        e->>0=cmd->>'part' AND e->>1=cmd->>'kind' AND
        (e->>6)::numeric>0 AND pg_catalog.jsonb_build_array(e->1,e->2,e->3,e->4,e->5) IN
        (SELECT p FROM pg_catalog.jsonb_array_elements(s->'grid'->'parts') p))<>1 THEN RETURN false; END IF;
  oldslot:=oldfire->'slots'->slotkey; now_sec:=pg_catalog.floor((p_world->'economy'->>'hours')::numeric*40+0.000001);
  IF oldslot->'lit'='true'::jsonb AND (oldslot->>'since')::numeric>now_sec THEN RETURN false; END IF;
  IF cmd->>'op'='load' THEN
    IF oldslot IS NOT NULL AND oldslot IS DISTINCT FROM 'null'::jsonb THEN
      seconds:=(oldslot->>'seconds')::integer;
      IF oldslot->'lit'='true'::jsonb THEN seconds:=GREATEST(0,LEAST(seconds,pg_catalog.floor(seconds-(now_sec-(oldslot->>'since')::numeric))::integer)); END IF;
      IF seconds>0 THEN RETURN false; END IF;
    END IF;
    duration:=CASE cmd->>'kind' WHEN 'handTorch' THEN 1200 WHEN 'lantern' THEN 3600 WHEN 'torchFloor' THEN 3600
      WHEN 'torchWall' THEN 3600 WHEN 'campfire' THEN 1800 WHEN 'grill' THEN 1800 END;
    wantedslot:=pg_catalog.jsonb_build_object('kind',cmd->>'kind','seconds',duration,
      'since',CASE WHEN cmd->'lit'='true'::jsonb THEN now_sec ELSE 0 END,'lit',cmd->'lit');
  ELSE
    IF oldslot IS NULL OR oldslot='null'::jsonb OR oldslot->>'kind' IS DISTINCT FROM cmd->>'kind' THEN RETURN false; END IF;
    seconds:=(oldslot->>'seconds')::integer;
    IF oldslot->'lit'='true'::jsonb THEN seconds:=GREATEST(0,LEAST(seconds,pg_catalog.floor(seconds-(now_sec-(oldslot->>'since')::numeric))::integer)); END IF;
    IF cmd->'lit'='true'::jsonb AND seconds=0 THEN RETURN false; END IF;
    IF oldslot->'lit'=cmd->'lit' AND seconds>0 THEN wantedslot:=oldslot;
    ELSE wantedslot:=pg_catalog.jsonb_build_object('kind',oldslot->>'kind','seconds',seconds,
      'since',CASE WHEN cmd->'lit'='true'::jsonb THEN now_sec ELSE 0 END,'lit',cmd->'lit'); END IF;
  END IF;
  wantedfire:=CASE WHEN wantedslot IS NOT DISTINCT FROM oldslot THEN oldfire
    ELSE pg_catalog.jsonb_set(pg_catalog.jsonb_set(oldfire,'{slots}',oldfire->'slots'||pg_catalog.jsonb_build_object(slotkey,wantedslot),false),
      '{rev}',pg_catalog.to_jsonb((oldfire->>'rev')::bigint+1),false) END;
  IF newfire IS DISTINCT FROM wantedfire OR ack->'rev' IS DISTINCT FROM wantedfire->'rev' THEN RETURN false; END IF;
  expectedprofile:=b;
  IF b ? 'fire' OR wantedfire IS DISTINCT FROM oldfire THEN expectedprofile:=pg_catalog.jsonb_set(expectedprofile,'{fire}',wantedfire,true); END IF;
  IF cmd->>'op'='load' THEN
    IF NOT public.mn_death_int(b->'eco'->'tradeRev',0,2147483645) THEN RETURN false; END IF;
    expectedprofile:=pg_catalog.jsonb_set(expectedprofile,'{eco,tradeRev}',pg_catalog.to_jsonb((b->'eco'->>'tradeRev')::bigint+1),false);
    IF goodsfield='pack' THEN
      oldgoods:=COALESCE(b->'eco'->'pack'->'goods','{}'::jsonb);
      IF pg_catalog.jsonb_typeof(oldgoods) IS DISTINCT FROM 'object' OR COALESCE((oldgoods->>'madera')::bigint,0)<1 THEN RETURN false; END IF;
      expectedgoods:=oldgoods-'madera'::text;
      IF (oldgoods->>'madera')::bigint>1 THEN expectedgoods:=expectedgoods||pg_catalog.jsonb_build_object('madera',(oldgoods->>'madera')::bigint-1); END IF;
      expectedprofile:=pg_catalog.jsonb_set(expectedprofile,'{eco,pack,goods}',expectedgoods,false);
    ELSE
      SELECT value,ordinal::integer-1 INTO shiprow,station_index FROM pg_catalog.jsonb_array_elements(b->'eco'->'ships') WITH ORDINALITY s(value,ordinal)
        WHERE value->>'id'=cmd->>'ship' AND value->>'kind'='raft' AND pg_catalog.jsonb_typeof(value->'hp')='number' AND (value->>'hp')::numeric>0;
      IF shiprow IS NULL THEN RETURN false; END IF;
      oldgoods:=shiprow->'hold'->'goods';
      IF pg_catalog.jsonb_typeof(oldgoods) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
      IF COALESCE((oldgoods->>'madera')::bigint,0)>0 THEN
        expectedgoods:=oldgoods-'madera'::text;
        IF (oldgoods->>'madera')::bigint>1 THEN expectedgoods:=expectedgoods||pg_catalog.jsonb_build_object('madera',(oldgoods->>'madera')::bigint-1); END IF;
        expectedship:=pg_catalog.jsonb_set(shiprow,'{hold,goods}',expectedgoods,false);
        ships:=pg_catalog.jsonb_set(b->'eco'->'ships',ARRAY[station_index::text],expectedship,false);
        expectedprofile:=pg_catalog.jsonb_set(expectedprofile,'{eco,ships}',ships,false);
      ELSE
        oldgoods:=COALESCE(b->'eco'->'pack'->'goods','{}'::jsonb);
        IF pg_catalog.jsonb_typeof(oldgoods) IS DISTINCT FROM 'object' OR COALESCE((oldgoods->>'madera')::bigint,0)<1 OR
           ((n->'eco'->'pack')-'goods'::text) IS DISTINCT FROM ((b->'eco'->'pack')-'goods'::text) THEN RETURN false; END IF;
        expectedgoods:=oldgoods-'madera'::text;
        IF (oldgoods->>'madera')::bigint>1 THEN expectedgoods:=expectedgoods||pg_catalog.jsonb_build_object('madera',(oldgoods->>'madera')::bigint-1); END IF;
        expectedprofile:=pg_catalog.jsonb_set(expectedprofile,'{eco,pack,goods}',expectedgoods,false);
      END IF;
    END IF;
  END IF;
  RETURN n IS NOT DISTINCT FROM expectedprofile;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request));

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; before_row jsonb; current_world jsonb; pv integer; wv integer; receipt_request jsonb; receipt_result jsonb;
  beneficiary jsonb; ids uuid[]; candidate jsonb; candidate_fire jsonb;
BEGIN
  IF NOT (p_request ? 'before') OR p_request->'command'->>'type'<>'fire' THEN
    IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
       public.mn_valid_economic_request(p_operation_id,p_request) IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    SELECT request,result INTO receipt_request,receipt_result FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
    IF FOUND THEN
      IF receipt_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
      RETURN receipt_result||pg_catalog.jsonb_build_object('replay',true);
    END IF;
    a:=(p_request->>'account')::uuid; w:=p_request->>'world';
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
    IF p_request ? 'beneficiaries' THEN
      SELECT pg_catalog.array_agg((value->>'account')::uuid ORDER BY value->>'account') INTO ids
        FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries');
    ELSE ids:=ARRAY[a]; END IF;
    FOREACH a IN ARRAY ids LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
    END LOOP;
    IF p_request ? 'beneficiaries' THEN
      FOR beneficiary IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') ORDER BY value->>'account' LOOP
        a:=(beneficiary->>'account')::uuid;
        SELECT data INTO before_row FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
        candidate:=beneficiary->'profile';
        IF (before_row->'fire') IS DISTINCT FROM (candidate->'fire') THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
        END IF;
      END LOOP;
    ELSE
      SELECT data INTO before_row FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
      candidate:=p_request->'profile';
      IF (before_row->'fire') IS DISTINCT FROM (candidate->'fire') THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
      END IF;
    END IF;
    RETURN public.mn_commit_economic_operation_fire_base(p_operation_id,p_request);
  END IF;
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
     public.mn_valid_economic_request(p_operation_id,p_request) IS NOT TRUE THEN
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
  SELECT data,version INTO before_row,pv FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
  SELECT economy,version INTO current_world,wv FROM public.mn_worlds WHERE world=w FOR UPDATE;
  IF pv IS NULL OR pv<>(p_request->>'expectedProfileVersion')::integer OR before_row IS DISTINCT FROM p_request->'before' OR
     wv IS NULL OR wv<>(p_request->>'expectedWorldVersion')::integer OR
     public.mn_valid_fire_transition(p_request,current_world) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  receipt_result:=public.mn_economic_result(p_operation_id,p_request);
  UPDATE public.mn_profiles SET data=p_request->'profile',version=pv+1,updated_at=pg_catalog.now() WHERE player_id=a;
  UPDATE public.mn_worlds SET economy=p_request->'worldData',version=wv+1,updated_at=pg_catalog.now() WHERE world=w;
  INSERT INTO public.mn_economic_operations(operation_id,request,result) VALUES(p_operation_id,p_request,receipt_result);
  RETURN receipt_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_fire_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_fire_request(uuid,jsonb),public.mn_valid_fire_world(jsonb,jsonb),
  public.mn_valid_fire_transition(jsonb,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_fire_operations_ready()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_commit_economic_operation_fire_base(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_valid_fire_request(uuid,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_fire_operations_ready() TO service_role;
COMMIT;

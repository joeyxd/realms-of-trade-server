-- Ephemeral palms and piles; only pickup rewards use the existing M5 receipt writer.
BEGIN;
DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_chop_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_chop_base;
  END IF;
END
$rename$;

-- The actor is included in the sorted rows; at most three other online contributors receive practice.
CREATE OR REPLACE FUNCTION public.mn_valid_chop_pickup(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; ack jsonb; rows jsonb; row jsonb; bp jsonb; np jsonb; expected jsonb;
  progression jsonb; old_practice bigint; new_practice bigint; total bigint:=0; previous text:='';
  actor boolean:=false; good text; amount bigint; count_goods bigint:=0; base jsonb;
BEGIN
  cmd:=p_request->'command'; ack:=p_request->'ack'; rows:=p_request->'beneficiaries';
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','profile','worldData','ack','beneficiaries']) OR
     pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>5 OR
     NOT (cmd ?& ARRAY['type','op','opId','pile','expectedRev']) OR
     cmd->>'type' IS DISTINCT FROM 'resource' OR cmd->>'op' IS DISTINCT FROM 'pickup' OR
     pg_catalog.jsonb_typeof(cmd->'pile') IS DISTINCT FROM 'string' OR cmd->>'pile' !~ '^[A-Za-z0-9_-]{1,40}$' OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
     NOT public.mn_death_int(cmd->'expectedRev',1,2147483646) OR
     pg_catalog.jsonb_typeof(ack) IS DISTINCT FROM 'object' OR
     NOT (ack ?& ARRAY['type','op','opId','ok','why','rev']) OR
     ack->>'type' IS DISTINCT FROM 'resource' OR ack->>'op' IS DISTINCT FROM 'pickup' OR
     ack->'opId' IS DISTINCT FROM cmd->'opId' OR pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR
     pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR pg_catalog.char_length(ack->>'why')>64 OR
     NOT public.mn_death_int(ack->'rev',0,2147483647) OR
     public.mn_valid_resource_state(p_request->'worldData'->'resources') IS NOT TRUE OR
     pg_catalog.jsonb_typeof(rows) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(rows) NOT BETWEEN 1 AND 4 THEN RETURN false; END IF;
  IF ack->'ok'='true'::jsonb THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>11 OR
       NOT (ack ?& ARRAY['pile','goods','count','left','profileRev']) OR ack->>'why'<>'' OR ack->'pile' IS DISTINCT FROM cmd->'pile' OR
       pg_catalog.jsonb_typeof(ack->'goods') IS DISTINCT FROM 'object' OR
       NOT public.mn_death_int(ack->'goods'->'tronco',1,8) OR
       NOT public.mn_death_int(ack->'count',1,10) OR NOT public.mn_death_int(ack->'left',0,10) OR
       NOT public.mn_death_int(ack->'profileRev',1,2147483647) THEN RETURN false; END IF;
    FOR good IN SELECT pg_catalog.jsonb_object_keys(ack->'goods') LOOP
      IF good NOT IN ('tronco','resina','coco') OR
         NOT public.mn_death_int(ack->'goods'->good,1,CASE WHEN good='tronco' THEN 8 ELSE 1 END) THEN RETURN false; END IF;
      count_goods:=count_goods+(ack->'goods'->>good)::bigint;
    END LOOP;
    IF count_goods<>(ack->>'count')::bigint THEN RETURN false; END IF;
  ELSIF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>6 THEN RETURN false; END IF;
  FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(rows) LOOP
    IF pg_catalog.jsonb_typeof(row) IS DISTINCT FROM 'object' OR
       NOT (row ?& ARRAY['account','expectedVersion','before','profile']) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(row))<>4 OR
       pg_catalog.jsonb_typeof(row->'account') IS DISTINCT FROM 'string' OR
       row->>'account' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       row->>'account'='00000000-0000-0000-0000-000000000000' OR row->>'account'<=previous OR
       NOT public.mn_death_int(row->'expectedVersion',1,2147483646) THEN RETURN false; END IF;
    previous:=row->>'account'; bp:=row->'before'; np:=row->'profile'; expected:=bp;
    IF pg_catalog.jsonb_typeof(bp) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(np) IS DISTINCT FROM 'object' OR
       pg_catalog.octet_length(bp::text)>131072 OR pg_catalog.octet_length(np::text)>131072 OR
       public.mn_starter_valid_pack(bp) IS NOT TRUE OR public.mn_starter_valid_pack(np) IS NOT TRUE OR
       (bp ? 'progression' AND public.mn_valid_logging_progression(bp->'progression') IS NOT TRUE) OR
       (np ? 'progression' AND public.mn_valid_logging_progression(np->'progression') IS NOT TRUE) THEN RETURN false; END IF;
    old_practice:=COALESCE((bp->'progression'->'practice'->>'logging')::bigint,0);
    new_practice:=COALESCE((np->'progression'->'practice'->>'logging')::bigint,0);
    amount:=new_practice-old_practice;
    IF amount<0 OR amount>10 OR (ack->'ok'='false'::jsonb AND amount<>0) THEN RETURN false; END IF;
    total:=total+amount;
    IF amount>0 THEN
      progression:=COALESCE(bp->'progression','{"v":1,"practice":{"logging":0},"milestones":[],"knowledge":[]}'::jsonb);
      progression:=pg_catalog.jsonb_set(progression,'{practice,logging}',pg_catalog.to_jsonb(new_practice),false);
      expected:=pg_catalog.jsonb_set(expected,'{progression}',progression,true);
    END IF;
    IF row->>'account'=p_request->>'account' THEN
      IF actor OR row->'expectedVersion' IS DISTINCT FROM p_request->'expectedProfileVersion' OR np IS DISTINCT FROM p_request->'profile' THEN RETURN false; END IF;
      actor:=true;
      IF ack->'ok'='true'::jsonb THEN
        IF NOT public.mn_death_int(bp->'eco'->'tradeRev',0,2147483646) OR
           (ack->>'profileRev')::bigint<>(bp->'eco'->>'tradeRev')::bigint+1 THEN RETURN false; END IF;
        FOR good IN SELECT pg_catalog.jsonb_object_keys(ack->'goods') LOOP
          expected:=pg_catalog.jsonb_set(expected,ARRAY['eco','pack','goods',good],
            pg_catalog.to_jsonb(COALESCE((bp->'eco'->'pack'->'goods'->>good)::bigint,0)+(ack->'goods'->>good)::bigint),true);
        END LOOP;
        expected:=pg_catalog.jsonb_set(expected,'{eco,tradeRev}',ack->'profileRev',false);
      END IF;
    END IF;
    IF expected IS DISTINCT FROM np THEN RETURN false; END IF;
  END LOOP;
  IF NOT actor OR total>10 THEN RETURN false; END IF;
  -- Reuse every common envelope bound from the unchanged newest validator, with a harmless legacy craft.
  base:=p_request-'beneficiaries'::text;
  base:=pg_catalog.jsonb_set(base,'{command}',pg_catalog.jsonb_build_object('type','resource','op','craft','opId',cmd->'opId','recipe','hacha_piedra','expectedRev',0,'n',1));
  base:=pg_catalog.jsonb_set(base,'{ack}',pg_catalog.jsonb_build_object('type','resource','op','craft','opId',cmd->'opId','ok',false,'why','full','rev',0));
  RETURN public.mn_valid_economic_request_chop_base(p_operation_id,base);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_request->'command'->>'type'='resource' THEN
    IF p_request->'command'->>'op'='pickup' THEN RETURN public.mn_valid_chop_pickup(p_operation_id,p_request); END IF;
    IF p_request->'command'->>'op'='craft' AND p_request->'command'->>'recipe' IN ('hacha_hierro','hacha_acero') THEN
      RETURN public.mn_valid_economic_request_chop_base(p_operation_id,
        pg_catalog.jsonb_set(p_request,'{command,recipe}','"hacha_piedra"'::jsonb,false));
    END IF;
  END IF;
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

CREATE OR REPLACE FUNCTION public.mn_chop_craft_transition(p_before jsonb,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE expected jsonb:=p_before; tier integer; good text; amount integer; remaining bigint;
  tools jsonb; inputs jsonb; ack jsonb:=p_request->'ack'; cmd jsonb:=p_request->'command';
BEGIN
  IF ack->'ok'='false'::jsonb THEN RETURN p_before IS NOT DISTINCT FROM p_request->'profile'; END IF;
  tier:=CASE cmd->>'recipe' WHEN 'hacha_hierro' THEN 2 ELSE 3 END;
  tools:=COALESCE(p_before->'tools','{"axe":0,"pickaxe":0}'::jsonb);
  IF pg_catalog.jsonb_typeof(tools) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(tools))<>2 OR NOT (tools ?& ARRAY['axe','pickaxe']) OR
     NOT public.mn_death_int(tools->'axe',0,3) OR NOT public.mn_death_int(tools->'pickaxe',0,1) OR
     (tools->>'axe')::integer>=tier OR NOT public.mn_death_int(p_before->'eco'->'tradeRev',0,2147483646) OR
     cmd->'expectedRev' IS DISTINCT FROM p_before->'eco'->'tradeRev' OR cmd->'n'<>'1'::jsonb OR
     public.mn_starter_valid_pack(p_before) IS NOT TRUE OR public.mn_starter_valid_pack(p_request->'profile') IS NOT TRUE THEN RETURN false; END IF;
  inputs:=CASE tier WHEN 2 THEN '{"madera":2,"mineral_hierro":3}'::jsonb ELSE '{"madera":3,"hierro":4}'::jsonb END;
  FOR good,amount IN SELECT key,value::integer FROM pg_catalog.jsonb_each_text(inputs) LOOP
    remaining:=COALESCE((expected->'eco'->'pack'->'goods'->>good)::bigint,0)-amount;
    IF remaining<0 THEN RETURN false; END IF;
    IF remaining=0 THEN expected:=expected#-ARRAY['eco','pack','goods',good];
    ELSE expected:=pg_catalog.jsonb_set(expected,ARRAY['eco','pack','goods',good],pg_catalog.to_jsonb(remaining),false); END IF;
  END LOOP;
  tools:=pg_catalog.jsonb_set(tools,'{axe}',pg_catalog.to_jsonb(tier),false);
  expected:=pg_catalog.jsonb_set(expected,'{tools}',tools,true);
  expected:=pg_catalog.jsonb_set(expected,'{eco,tradeRev}',pg_catalog.to_jsonb((p_before->'eco'->>'tradeRev')::bigint+1),false);
  RETURN expected IS NOT DISTINCT FROM p_request->'profile' AND ack=pg_catalog.jsonb_build_object(
    'type','resource','op','craft','opId',cmd->'opId','ok',true,'why','','rev',expected->'eco'->'tradeRev','tool','axe','tier',tier,'count',1);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; cp jsonb; cw jsonb; pv integer; wv integer; rr jsonb; rs jsonb; current_world jsonb; current_profile jsonb; cmd jsonb:=p_request->'command';
BEGIN
  IF cmd->>'type'='resource' AND (cmd->>'op'='pickup' OR cmd->>'op'='craft' AND cmd->>'recipe' IN ('hacha_hierro','hacha_acero')) THEN
    IF public.mn_valid_economic_request(p_operation_id,p_request) IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    IF NOT EXISTS(SELECT 1 FROM public.mn_economic_operations WHERE operation_id=p_operation_id) THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||(p_request->>'world'),0));
      SELECT economy INTO current_world FROM public.mn_worlds WHERE world=p_request->>'world' FOR UPDATE;
      IF cmd->>'op'='pickup' AND current_world IS DISTINCT FROM p_request->'worldData' THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
      IF cmd->>'op'='craft' THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||(p_request->>'account'),0));
        SELECT data INTO current_profile FROM public.mn_profiles WHERE player_id=(p_request->>'account')::uuid FOR UPDATE;
        IF public.mn_chop_craft_transition(current_profile,p_request) IS NOT TRUE THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
      END IF;
    END IF;
  END IF;
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

-- Rebind the CHECK to the new wrapper; renaming alone preserves the old function OID.
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request) IS TRUE);

CREATE OR REPLACE FUNCTION public.mn_chop_operations_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE bp jsonb; np jsonb; w jsonb; request jsonb; town text;
BEGIN
  bp:='{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":0,"pack":{"cap":18,"maxMass":18,"goods":{}},"ships":[]}}'::jsonb;
  np:=pg_catalog.jsonb_set(bp,'{eco,pack,goods}','{"tronco":2}'::jsonb);
  np:=pg_catalog.jsonb_set(np,'{eco,tradeRev}','1'::jsonb);
  w:='{"v":1,"seed":71,"economy":{"v":2,"markets":{},"plots":{}},"resources":{"v":3,"tick":0,"nodes":[{"id":"palm-1","kind":"palm","rev":1,"hits":0,"readyAt":0}],"cooldowns":{},"logging":{"palm-1":{"cycle":1,"contributors":[],"quality":0}}}}'::jsonb;
  FOREACH town IN ARRAY ARRAY['aldea','cala','sol','ceniza','corona','coral'] LOOP
    w:=pg_catalog.jsonb_set(w,ARRAY['economy','markets',town],pg_catalog.jsonb_build_object('id',town,'stock','{}'::jsonb,'last','{}'::jsonb));
    w:=pg_catalog.jsonb_set(w,ARRAY['economy','plots',town],'[]'::jsonb);
  END LOOP;
  request:=pg_catalog.jsonb_build_object('world','chop-ready','account','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'expectedProfileVersion',1,'expectedWorldVersion',1,'profile',np,'worldData',w,
    'command','{"type":"resource","op":"pickup","opId":"ready-pickup","pile":"pile-1","expectedRev":1}'::jsonb,
    'ack','{"type":"resource","op":"pickup","opId":"ready-pickup","ok":true,"why":"","rev":1,"pile":"pile-1","goods":{"tronco":2},"count":2,"left":0,"profileRev":1}'::jsonb,
    'beneficiaries',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('account','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','expectedVersion',1,'before',bp,'profile',np)));
  IF public.mn_valid_economic_request('f0000000-0000-4000-8000-000000000001'::uuid,request) IS TRUE AND
     public.mn_valid_economic_request('f0000000-0000-4000-8000-000000000001'::uuid,
       pg_catalog.jsonb_set(request,'{profile,gold}','100'::jsonb,true)) IS FALSE AND
     EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.mn_economic_operations'::pg_catalog.regclass
       AND conname='mn_economic_operations_resource_check' AND convalidated) THEN RETURN '{"version":1}'::jsonb; END IF;
  RETURN '{"version":0}'::jsonb;
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN '{"version":0}'::jsonb;
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_chop_pickup(uuid,jsonb),public.mn_chop_craft_transition(jsonb,jsonb),
  public.mn_chop_operations_ready(),public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_valid_economic_request_chop_base(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_chop_pickup(uuid,jsonb),public.mn_chop_craft_transition(jsonb,jsonb),
  public.mn_chop_operations_ready(),public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb),
  public.mn_valid_economic_request_chop_base(uuid,jsonb) TO service_role;
COMMIT;

-- Durable attribute points and one-time legacy backpack adoption.
-- Additive: existing profile rows and receipts remain byte-for-byte intact.
BEGIN;

-- SQL024's pack validator remains the compatibility boundary for historical profiles.
CREATE OR REPLACE FUNCTION public.mn_attr_valid_state(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE a jsonb; lvl bigint; carga bigint; re bigint;
BEGIN
  IF NOT (p_profile ? 'attr') THEN RETURN true; END IF;
  a:=p_profile->'attr';
  IF pg_catalog.jsonb_typeof(a) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(a))<>3 OR
    NOT (a ?& ARRAY['v','carga','re']) OR NOT public.mn_death_int(a->'v',1,1) OR
    NOT public.mn_death_int(a->'carga',0,9) OR NOT public.mn_death_int(a->'re',0,1) OR
    NOT public.mn_death_int(p_profile->'lvl',1,10) THEN RETURN false; END IF;
  lvl:=(p_profile->>'lvl')::bigint; carga:=(a->>'carga')::bigint; re:=(a->>'re')::bigint;
  RETURN carga<=lvl-1;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_valid_pack(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE pack jsonb; carry jsonb; lvl bigint; tier bigint; cap bigint; max_mass bigint; carga bigint;
BEGIN
  IF pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR
     NOT public.mn_death_int(p_profile->'lvl',1,1000000) OR
     pg_catalog.jsonb_typeof(p_profile->'eco') IS DISTINCT FROM 'object' OR
     public.mn_attr_valid_state(p_profile) IS NOT TRUE THEN RETURN false; END IF;
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
    IF p_profile ? 'attr' THEN
      carga:=(p_profile->'attr'->>'carga')::bigint; max_mass:=50+5*carga;
    ELSE max_mass:=18+2*(lvl-1); END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(pack))<>3 OR
       NOT (pack ?& ARRAY['cap','maxMass','goods']) OR
       NOT public.mn_death_int(pack->'cap',cap,cap) OR
       NOT public.mn_death_int(pack->'maxMass',max_mass,max_mass) THEN RETURN false; END IF;
  ELSE
    IF p_profile ? 'attr' THEN RETURN false; END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(pack))<>2 OR
       NOT (pack ?& ARRAY['cap','goods']) OR NOT public.mn_death_int(pack->'cap',10,10) THEN RETURN false; END IF;
    cap:=10; max_mass:=1000000000;
  END IF;
  RETURN public.mn_starter_valid_goods(pack->'goods',cap,max_mass);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_profile_carry_frozen(p_before jsonb,p_after jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_typeof(p_before)='object' AND pg_catalog.jsonb_typeof(p_after)='object' AND
         (p_before->'carry') IS NOT DISTINCT FROM (p_after->'carry') AND
         (p_before->'attr') IS NOT DISTINCT FROM (p_after->'attr') AND
         (p_before->'workshop') IS NOT DISTINCT FROM (p_after->'workshop') AND
         (p_before->'eco'->'pack'->'cap') IS NOT DISTINCT FROM (p_after->'eco'->'pack'->'cap') AND
         (p_before->'eco'->'pack'->'maxMass') IS NOT DISTINCT FROM (p_after->'eco'->'pack'->'maxMass');
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_attribute_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; b_shape jsonb; cmd jsonb; ack jsonb; op text; carga bigint; re bigint; earned bigint; tier bigint;
  cap bigint; mass bigint; volume_used numeric; mass_used numeric; g text; amount jsonb; unit_volume integer; unit_mass numeric;
  expected jsonb; points jsonb; limits jsonb; goods jsonb; common jsonb;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','before','profile','worldData','ack']) THEN RETURN false; END IF;
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack'; op:=cmd->>'op';
  IF cmd->>'type'<>'attributes' OR op NOT IN ('assign','reset','adopt') OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
     NOT public.mn_death_int(cmd->'expectedRev',0,2147483645) OR
     (op='assign' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>6 OR
       NOT (cmd ?& ARRAY['type','op','opId','expectedRev','stat','n']) OR cmd->>'stat'<>'carga' OR NOT public.mn_death_int(cmd->'n',1,9))) OR
     (op<>'assign' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>4 OR
       NOT (cmd ?& ARRAY['type','op','opId','expectedRev']))) THEN RETURN false; END IF;
  b_shape:=pg_catalog.jsonb_set(b,'{eco,pack,goods}','{}'::jsonb,false);
  IF public.mn_starter_valid_pack(b_shape) IS NOT TRUE OR
     NOT public.mn_starter_valid_goods(b->'eco'->'pack'->'goods',(b->'eco'->'pack'->>'cap')::bigint,1000000000) OR
     NOT public.mn_death_int(b->'eco'->'tradeRev',0,2147483645) OR
     pg_catalog.jsonb_typeof(p_request->'worldData') IS DISTINCT FROM 'object' OR
    NOT public.mn_death_int(p_request->'expectedProfileVersion',1,2147483646) OR
     NOT public.mn_death_int(p_request->'expectedWorldVersion',1,2147483646) OR
     pg_catalog.jsonb_typeof(b) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(n) IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length(b::text)>131072 OR pg_catalog.octet_length(n::text)>131072 THEN RETURN false; END IF;
  common:=p_request-'before'::text;
  common:=pg_catalog.jsonb_set(common,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',cmd->'opId','town','aldea','g','madera','n',1,'expectedTotal',0),false);
  common:=pg_catalog.jsonb_set(common,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',cmd->'opId','ok',true,'why','','rev',0),false);
  IF public.mn_valid_economic_request_attribute_base(p_operation_id,common) IS NOT TRUE THEN RETURN false; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>(CASE WHEN ack->'ok'='true'::jsonb THEN 8 ELSE 6 END) OR
     NOT (ack ?& ARRAY['type','op','opId','ok','why','rev']) OR ack->>'type'<>'attributes' OR
     ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
     pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR
     pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR pg_catalog.char_length(ack->>'why')>64 OR
     (ack->'ok'='false'::jsonb AND ack->'rev' IS DISTINCT FROM b->'eco'->'tradeRev') THEN RETURN false; END IF;
  IF ack->'ok'='false'::jsonb THEN RETURN n IS NOT DISTINCT FROM b; END IF;
  IF public.mn_starter_valid_pack(n) IS NOT TRUE THEN RETURN false; END IF;
  IF ack->'why' IS DISTINCT FROM '""'::jsonb OR cmd->'expectedRev' IS DISTINCT FROM b->'eco'->'tradeRev' THEN RETURN false; END IF;
  IF b ? 'attr' THEN
    IF public.mn_attr_valid_state(b) IS NOT TRUE THEN RETURN false; END IF;
    carga:=(b->'attr'->>'carga')::bigint; re:=(b->'attr'->>'re')::bigint;
  ELSE carga:=0; re:=0; END IF;
  earned:=(b->>'lvl')::bigint-1; expected:=b;
  IF op='adopt' THEN
    IF b ? 'attr' THEN RETURN false; END IF;
    expected:=pg_catalog.jsonb_set(expected,'{attr}',pg_catalog.jsonb_build_object('v',1,'carga',0,'re',0),true);
    IF NOT (b ? 'carry') THEN
      IF b->'eco'->'pack' IS DISTINCT FROM pg_catalog.jsonb_build_object('cap',10,'goods',b->'eco'->'pack'->'goods') THEN RETURN false; END IF;
      expected:=pg_catalog.jsonb_set(expected,'{carry}',pg_catalog.jsonb_build_object('v',1,'backpack',0),true);
      expected:=pg_catalog.jsonb_set(expected,'{eco,pack}',pg_catalog.jsonb_build_object('cap',18,'maxMass',50,'goods',b->'eco'->'pack'->'goods'),false);
    ELSE
      IF b->'carry' IS NULL THEN RETURN false; END IF;
      expected:=pg_catalog.jsonb_set(expected,'{eco,pack,maxMass}','50'::jsonb,false);
    END IF;
  ELSIF op='assign' THEN
    IF NOT (b ? 'carry') OR carga+(cmd->>'n')::bigint>earned THEN RETURN false; END IF;
    carga:=carga+(cmd->>'n')::bigint;
    expected:=pg_catalog.jsonb_set(expected,'{attr}',pg_catalog.jsonb_build_object('v',1,'carga',carga,'re',re),true);
  ELSE
    IF NOT (b ? 'attr') OR carga=0 OR re<>0 OR
       NOT public.mn_starter_valid_goods(b->'eco'->'pack'->'goods',(b->'eco'->'pack'->>'cap')::bigint,50) THEN RETURN false; END IF;
    carga:=0; re:=1;
    expected:=pg_catalog.jsonb_set(expected,'{attr}',pg_catalog.jsonb_build_object('v',1,'carga',0,'re',1),false);
  END IF;
  expected:=pg_catalog.jsonb_set(expected,'{eco,tradeRev}',pg_catalog.to_jsonb((cmd->>'expectedRev')::bigint+1),false);
  IF op<>'adopt' OR b ? 'attr' THEN
    tier:=(expected->'carry'->>'backpack')::bigint; cap:=CASE tier WHEN 0 THEN 18 WHEN 1 THEN 30 ELSE 42 END;
    mass:=50+5*carga;
    expected:=pg_catalog.jsonb_set(expected,'{eco,pack,maxMass}',pg_catalog.to_jsonb(mass),false);
    expected:=pg_catalog.jsonb_set(expected,'{eco,pack,cap}',pg_catalog.to_jsonb(cap),false);
  ELSE
    IF expected ? 'carry' THEN
      tier:=(expected->'carry'->>'backpack')::bigint; cap:=CASE tier WHEN 0 THEN 18 WHEN 1 THEN 30 ELSE 42 END;
      mass:=50;
      expected:=pg_catalog.jsonb_set(expected,'{eco,pack,cap}',pg_catalog.to_jsonb(cap),false);
    ELSE cap:=18; mass:=50; END IF;
  END IF;
  goods:=expected->'eco'->'pack'->'goods'; volume_used:=0; mass_used:=0;
  FOR g,amount IN SELECT key,value FROM pg_catalog.jsonb_each(goods) LOOP
    IF g NOT IN ('pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra','hierro','mineral_hierro','azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas') THEN RETURN false; END IF;
    unit_volume:=CASE WHEN g IN ('madera','tronco','hierro','mineral_hierro','balas') THEN 3 WHEN g IN ('cana','piedra','azufre','lona') THEN 2 ELSE 1 END;
    unit_mass:=CASE WHEN g IN ('hierro','mineral_hierro') THEN 6 WHEN g='piedra' THEN 4 WHEN g='balas' THEN 5 WHEN g='tabaco' THEN .5 WHEN g='seda' THEN .25 WHEN g IN ('madera','tronco') THEN 3 WHEN g IN ('cana','azufre') THEN 2 ELSE 1 END;
    volume_used:=volume_used+(amount::text)::numeric*unit_volume; mass_used:=mass_used+(amount::text)::numeric*unit_mass;
  END LOOP;
  IF volume_used>cap OR mass_used>mass OR n IS DISTINCT FROM expected OR
     ack->'rev' IS DISTINCT FROM pg_catalog.to_jsonb((cmd->>'expectedRev')::bigint+1) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>8 OR
     ack->'points' IS DISTINCT FROM pg_catalog.jsonb_build_object('earned',earned,'invested',carga,'available',earned-carga,'resetsLeft',1-re) OR
     ack->'limits' IS DISTINCT FROM pg_catalog.jsonb_build_object('volume',cap,'comfortableMass',40+4*carga,'maxMass',50+5*carga) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_table THEN RETURN false;
END
$function$;

-- Preserve the legacy commit path for every existing command and its receipts.
DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_starter_workshop_transition_attribute_base(jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_starter_workshop_transition(jsonb,jsonb) RENAME TO mn_valid_starter_workshop_transition_attribute_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_attribute_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_attribute_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_commit_economic_operation_attribute_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_economic_operation(uuid,jsonb) RENAME TO mn_commit_economic_operation_attribute_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_valid_starter_workshop_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; cmd jsonb; ack jsonb; expected jsonb; pack jsonb; goods jsonb;
  oldws jsonb; newws jsonb; prog jsonb; nextprog jsonb; carry jsonb; carry_view jsonb;
  count integer; boards integer; kits integer; tier integer; cap integer; mass integer; carga integer;
  costwood integer:=0; costlona integer:=0;
BEGIN
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack';
  IF ((p_request->'worldData')-'resources'::text) IS DISTINCT FROM (p_world-'resources'::text) THEN RETURN false; END IF;
  IF p_world ? 'resources' THEN
    IF NOT (p_request->'worldData' ? 'resources') OR
       ((p_request->'worldData'->'resources')-'tick'::text) IS DISTINCT FROM ((p_world->'resources')-'tick'::text) OR
       (p_request->'worldData'->'resources'->>'tick')::numeric<(p_world->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  ELSIF p_request->'worldData' ? 'resources' THEN RETURN false; END IF;
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN b IS NOT DISTINCT FROM n AND ack->'rev' IS NOT DISTINCT FROM b->'eco'->'tradeRev'; END IF;
  IF cmd->>'type'<>'artisan' OR cmd->>'expectedRev' IS DISTINCT FROM b->'eco'->>'tradeRev' OR
     (n->'eco'->>'tradeRev')::bigint<>(cmd->>'expectedRev')::bigint+1 OR
     (n-'eco'::text-'workshop'::text-'progression'::text-'carry'::text-'attr'::text) IS DISTINCT FROM
       (b-'eco'::text-'workshop'::text-'progression'::text-'carry'::text-'attr'::text) OR
     n->'attr' IS DISTINCT FROM b->'attr' THEN RETURN false; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>8 OR
     NOT (ack ?& ARRAY['type','op','opId','ok','why','rev','workshop','carry']) OR
     ack->>'type'<>'artisan' OR ack->>'op' IS DISTINCT FROM cmd->>'op' OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
     ack->>'why' IS DISTINCT FROM '' THEN RETURN false; END IF;
  oldws:=public.mn_starter_workshop(b);
  prog:=COALESCE(b->'progression',pg_catalog.jsonb_build_object('v',1,'practice',pg_catalog.jsonb_build_object('logging',0),'milestones','[]'::jsonb,'knowledge','[]'::jsonb));
  nextprog:=prog; pack:=b->'eco'->'pack'; goods:=pack->'goods'; expected:=b;
  boards:=(oldws->>'boards')::integer; kits:=(oldws->>'crateKits')::integer;
  IF cmd->>'op'='contribute' THEN
    count:=(cmd->>'amount')::integer;
    IF boards+count>10 OR COALESCE((goods->>'madera')::integer,0)<count THEN RETURN false; END IF;
    boards:=boards+count; costwood:=count;
    IF boards=10 THEN
      IF COALESCE(prog->'knowledge','[]'::jsonb) ? 'raft_storage' THEN RETURN false; END IF;
      nextprog:=pg_catalog.jsonb_set(nextprog,'{knowledge}',COALESCE(prog->'knowledge','[]'::jsonb)||pg_catalog.jsonb_build_array('raft_storage'),true);
    END IF;
  ELSIF cmd->>'op'='craftCrate' THEN
    IF kits>=99 OR COALESCE((goods->>'madera')::integer,0)<2 THEN RETURN false; END IF;
    kits:=kits+1; costwood:=2;
  ELSIF cmd->>'op'='upgradePack' THEN
    carry:=b->'carry'; tier:=CASE WHEN carry IS NULL THEN 0 ELSE (carry->>'backpack')::integer END;
    IF tier>=2 THEN RETURN false; END IF;
    IF tier=0 THEN costwood:=2; costlona:=3; cap:=30; ELSE costwood:=4; costlona:=5; cap:=42; END IF;
    IF COALESCE((goods->>'madera')::integer,0)<costwood OR COALESCE((goods->>'lona')::integer,0)<costlona THEN RETURN false; END IF;
    mass:=CASE WHEN b ? 'attr' THEN 50+5*(b->'attr'->>'carga')::integer ELSE 18+2*((b->>'lvl')::integer-1) END;
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
    tier:=CASE WHEN b->'carry' IS NULL THEN 0 ELSE (b->'carry'->>'backpack')::integer END;
    expected:=pg_catalog.jsonb_set(expected,'{carry}',pg_catalog.jsonb_build_object('v',1,'backpack',tier+1),true);
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
  carga:=CASE WHEN expected ? 'attr' THEN (expected->'attr'->>'carga')::integer ELSE 0 END;
  carry_view:=pg_catalog.jsonb_build_object('v',1,'backpack',tier,'volume',CASE tier WHEN 0 THEN 18 WHEN 1 THEN 30 ELSE 42 END,
    'strength',10+((expected->>'lvl')::integer-1),'maxMass',CASE WHEN expected ? 'attr' THEN 50+5*carga ELSE 18+2*((expected->>'lvl')::integer-1) END);
  RETURN n IS NOT DISTINCT FROM expected AND ack->'rev' IS NOT DISTINCT FROM expected->'eco'->'tradeRev' AND
    ack->'workshop' IS NOT DISTINCT FROM newws AND ack->'carry' IS NOT DISTINCT FROM carry_view;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_save_profile(p_player_id uuid,p_data jsonb,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_data jsonb; v_version integer;
BEGIN
  IF p_player_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_data IS NULL OR
     pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid profile save arguments' USING ERRCODE='22023'; END IF;
  IF p_expected_version=0 THEN
    IF p_data ? 'attr' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    INSERT INTO public.mn_profiles(player_id,data,version,updated_at) VALUES(p_player_id,p_data,1,pg_catalog.now())
      ON CONFLICT(player_id) DO NOTHING RETURNING version INTO v_version;
  ELSE
    SELECT data INTO v_data FROM public.mn_profiles WHERE player_id=p_player_id AND version=p_expected_version FOR UPDATE;
    IF FOUND AND (v_data->'attr') IS NOT DISTINCT FROM (p_data->'attr') AND
       (NOT (p_data ? 'attr') OR public.mn_starter_valid_pack(p_data) IS TRUE) THEN
      UPDATE public.mn_profiles SET data=p_data,version=version+1,updated_at=pg_catalog.now()
        WHERE player_id=p_player_id AND version=p_expected_version RETURNING version INTO v_version;
    END IF;
  END IF;
  IF v_version IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'version',v_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_request->'command'->>'type'='attributes' THEN RETURN public.mn_valid_attribute_request(p_operation_id,p_request); END IF;
  RETURN public.mn_valid_economic_request_attribute_base(p_operation_id,p_request);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_economic_preserves_attributes(p_request jsonb)
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
      IF current_profile->'attr' IS DISTINCT FROM row->'before'->'attr' OR
         row->'before'->'attr' IS DISTINCT FROM row->'profile'->'attr' THEN RETURN false; END IF;
    ELSIF current_profile->'attr' IS DISTINCT FROM row->'profile'->'attr' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; cp jsonb; cw jsonb; pv integer; wv integer; rr jsonb; rs jsonb;
BEGIN
  IF p_request->'command'->>'type' IS DISTINCT FROM 'attributes' THEN
    IF p_operation_id IS NULL THEN RETURN public.mn_commit_economic_operation_attribute_base(p_operation_id,p_request); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
    SELECT request,result INTO rr,rs FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
    IF FOUND THEN
      IF rr IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
      RETURN rs||pg_catalog.jsonb_build_object('replay',true);
    END IF;
    IF NOT public.mn_valid_economic_request_attribute_base(p_operation_id,p_request) THEN
      RETURN public.mn_commit_economic_operation_attribute_base(p_operation_id,p_request);
    END IF;
    IF public.mn_economic_preserves_attributes(p_request) IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    RETURN public.mn_commit_economic_operation_attribute_base(p_operation_id,p_request);
  END IF;
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
     NOT public.mn_valid_attribute_request(p_operation_id,p_request) THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
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

CREATE OR REPLACE FUNCTION public.mn_attribute_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check CHECK (public.mn_valid_economic_request(operation_id,request));
REVOKE ALL ON FUNCTION public.mn_commit_economic_operation_attribute_base(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mn_valid_attribute_request(uuid,jsonb),public.mn_attr_valid_state(jsonb),public.mn_attribute_operations_ready() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_economic_preserves_attributes(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_attribute_request(uuid,jsonb),public.mn_attr_valid_state(jsonb),public.mn_attribute_operations_ready() TO service_role;
REVOKE ALL ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_economic_request(uuid,jsonb),public.mn_commit_economic_operation(uuid,jsonb) TO service_role;
COMMIT;

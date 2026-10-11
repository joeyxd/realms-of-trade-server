-- Reusable freshwater vessels and commands in the existing M5 economic receipt.
-- Apply after 001-029. This does not add a table or a second writer.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_starter_valid_pack_freshwater_base(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_starter_valid_pack(jsonb) RENAME TO mn_starter_valid_pack_freshwater_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_artisan_hold_freshwater_base(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_artisan_hold(jsonb) RENAME TO mn_valid_artisan_hold_freshwater_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_freshwater_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_freshwater_base;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_commit_economic_operation_freshwater_base(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_commit_economic_operation(uuid,jsonb) RENAME TO mn_commit_economic_operation_freshwater_base;
  END IF;
END
$rename$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_vessels(p_vessels jsonb,p_kind text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v jsonb; v_id text; v_water bigint; v_count integer;
BEGIN
  IF p_vessels IS NULL THEN RETURN true; END IF;
  IF pg_catalog.jsonb_typeof(p_vessels) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(p_vessels)>32 THEN RETURN false; END IF;
  v_count:=pg_catalog.jsonb_array_length(p_vessels);
  FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_vessels) LOOP
    IF pg_catalog.jsonb_typeof(v) IS DISTINCT FROM 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v))<>3 OR
       NOT (v ?& ARRAY['id','kind','water']) OR
       pg_catalog.jsonb_typeof(v->'id') IS DISTINCT FROM 'string' OR
       pg_catalog.jsonb_typeof(v->'kind') IS DISTINCT FROM 'string' OR
       NOT public.mn_death_int(v->'water',0,20) THEN RETURN false; END IF;
    v_id:=v->>'id'; v_water:=(v->>'water')::bigint;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_vessels) x WHERE x->>'id'=v_id)<>1 THEN RETURN false; END IF;
    IF p_kind='pack' THEN
      IF v_id<>'bucket' OR v->>'kind'<>'bucket' OR v_water>4 OR v_count>1 THEN RETURN false; END IF;
    ELSIF p_kind='hold' THEN
      IF v_id !~ '^p[0-9]{1,10}$' OR v->>'kind'<>'barrel' THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_artisan_hold(p_hold jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE clean jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_hold) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF p_hold ? 'vessels' THEN
    IF NOT public.mn_freshwater_vessels(p_hold->'vessels','hold') THEN RETURN false; END IF;
    clean:=p_hold-'vessels'::text;
    IF NOT public.mn_valid_artisan_hold_freshwater_base(clean) THEN RETURN false; END IF;
    -- Each barrel occupies no cargo volume; its water contributes one mass per unit.
    IF COALESCE((SELECT pg_catalog.sum((value->>'water')::numeric) FROM pg_catalog.jsonb_array_elements(p_hold->'vessels')),0)>1000000000 THEN RETURN false; END IF;
    RETURN true;
  END IF;
  RETURN public.mn_valid_artisan_hold_freshwater_base(p_hold);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_starter_valid_pack(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE clean jsonb; pack jsonb; vessels jsonb; goods jsonb; g text; amount jsonb;
  cap bigint; mass_cap bigint; lvl bigint; tier bigint; volume numeric:=0; mass numeric:=0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_profile->'eco') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  pack:=p_profile->'eco'->'pack';
  IF pg_catalog.jsonb_typeof(pack) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  vessels:=pack->'vessels';
  IF vessels IS NOT NULL AND NOT public.mn_freshwater_vessels(vessels,'pack') THEN RETURN false; END IF;
  clean:=pg_catalog.jsonb_set(p_profile,'{eco,pack}',pack-'vessels'::text,false);
  IF NOT public.mn_starter_valid_pack_freshwater_base(clean) THEN RETURN false; END IF;
  IF vessels IS NULL OR pg_catalog.jsonb_array_length(vessels)=0 THEN RETURN true; END IF;
  SELECT (value->>'water')::bigint INTO lvl FROM pg_catalog.jsonb_array_elements(vessels) LIMIT 1;
  goods:=pack->'goods'; cap:=(pack->>'cap')::bigint;
  mass_cap:=COALESCE((pack->>'maxMass')::bigint,1000000000);
  FOR g,amount IN SELECT key,value FROM pg_catalog.jsonb_each(goods) LOOP
    volume:=volume+(amount::text)::numeric*CASE WHEN g IN ('madera','tronco','hierro','mineral_hierro','balas') THEN 3
      WHEN g IN ('cana','piedra','azufre','lona') THEN 2 ELSE 1 END;
    mass:=mass+(amount::text)::numeric*CASE WHEN g IN ('hierro','mineral_hierro') THEN 6 WHEN g='piedra' THEN 4
      WHEN g='balas' THEN 5 WHEN g='tabaco' THEN .5 WHEN g='seda' THEN .25
      WHEN g IN ('madera','tronco') THEN 3 WHEN g IN ('cana','azufre') THEN 2 ELSE 1 END;
  END LOOP;
  RETURN volume+2<=cap AND mass+1+lvl<=mass_cap;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_bucket(p_profile jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT COALESCE(p_profile->'eco'->'pack'->'vessels','[]'::jsonb);
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_valid_profile(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE s jsonb; h jsonb; parts jsonb; cond jsonb; vessel jsonb; entry jsonb; id text; i integer;
BEGIN
  IF NOT public.mn_starter_valid_pack(p_profile) THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(p_profile->'eco'->'ships') IS DISTINCT FROM 'array' THEN RETURN true; END IF;
  FOR s IN SELECT value FROM pg_catalog.jsonb_array_elements(p_profile->'eco'->'ships') LOOP
    h:=s->'hold';
    IF h IS NULL OR h='null'::jsonb THEN CONTINUE; END IF;
    IF NOT public.mn_valid_artisan_hold(h) THEN RETURN false; END IF;
    IF h ? 'vessels' THEN
      parts:=s->'grid'->'parts'; cond:=s->'condition';
      IF pg_catalog.jsonb_typeof(parts) IS DISTINCT FROM 'array' OR
         pg_catalog.jsonb_typeof(cond) IS DISTINCT FROM 'object' OR
         pg_catalog.jsonb_typeof(cond->'entries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
      FOR vessel IN SELECT value FROM pg_catalog.jsonb_array_elements(h->'vessels') LOOP
        id:=vessel->>'id'; i:=NULL;
        SELECT (ordinality-1)::integer INTO i FROM pg_catalog.jsonb_array_elements(cond->'entries') WITH ORDINALITY e(value,ordinality)
          WHERE value->>0=id AND value->>1='waterBarrel';
        IF i IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE
          p->>0='waterBarrel' AND p->>1=(cond->'entries'->i->>2) AND p->>2=(cond->'entries'->i->>3) AND
          p->>3=(cond->'entries'->i->>4) AND p->>4=(cond->'entries'->i->>5)) THEN RETURN false; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; op text; base jsonb; kind text; nkeys integer;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','profile','worldData','ack','before']) OR
     pg_catalog.jsonb_typeof(p_request->'before') IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length((p_request->'before')::text)>131072 OR
     NOT public.mn_freshwater_valid_profile(p_request->'before') OR
     NOT public.mn_freshwater_valid_profile(p_request->'profile') THEN RETURN false; END IF;
  cmd:=p_request->'command'; ack:=p_request->'ack'; op:=cmd->>'op';
  IF pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     cmd->>'type' IS NULL OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
     pg_catalog.jsonb_typeof(ack) IS DISTINCT FROM 'object' OR ack ? 'to' OR
     pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR
     pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR pg_catalog.char_length(ack->>'why')>64 OR
     NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  kind:=cmd->>'type';
  IF kind='raft' THEN
    nkeys:=(SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd));
    IF op NOT IN ('place','remove') OR (nkeys<>7 AND nkeys<>8) OR
       NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece','rules']) OR cmd->>'rules'<>'2' OR
       pg_catalog.jsonb_typeof(cmd->'id') IS DISTINCT FROM 'string' OR cmd->>'id' !~ '^[A-Za-z0-9:_-]{1,120}$' OR
       NOT public.mn_death_int(cmd->'expectedRev',1,2147483646) OR
       pg_catalog.jsonb_typeof(cmd->'piece') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(cmd->'piece')<>5 OR
       cmd->'piece'->>0<>'waterBarrel' OR NOT public.mn_death_int(cmd->'piece'->1,-128,128) OR
       NOT public.mn_death_int(cmd->'piece'->2,-128,128) OR NOT public.mn_death_int(cmd->'piece'->3,0,2) OR
       NOT public.mn_death_int(cmd->'piece'->4,0,3) OR
       (op='place' AND (nkeys<>7 OR cmd ? 'index')) OR
       (op='remove' AND (nkeys<>8 OR NOT (cmd ? 'index') OR NOT public.mn_death_int(cmd->'index',0,599))) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack)) NOT IN (7,8) OR
       NOT (ack ?& ARRAY['type','id','op','opId','ok','why','rev']) OR ack->>'type'<>'raftEdit' OR
       ack->>'id' IS DISTINCT FROM cmd->>'id' OR ack->>'op' IS DISTINCT FROM op OR
       ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
       ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))=8 AND NOT (ack ? 'record')) OR
       (ack ? 'record' AND (ack->'ok' IS DISTINCT FROM 'false'::jsonb OR pg_catalog.jsonb_typeof(ack->'record') IS DISTINCT FROM 'object')) THEN RETURN false; END IF;
  ELSIF kind='freshwater' THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
       NOT (cmd ?& ARRAY['type','op','opId','expectedRev','source','ship','part','n']) OR
       op NOT IN ('craftBucket','fill','deposit','withdraw','decant') OR
       NOT public.mn_death_int(cmd->'expectedRev',0,2147483646) OR
       pg_catalog.jsonb_typeof(cmd->'source') IS DISTINCT FROM 'string' OR pg_catalog.char_length(cmd->>'source')>100 OR
       pg_catalog.jsonb_typeof(cmd->'ship') IS DISTINCT FROM 'string' OR pg_catalog.char_length(cmd->>'ship')>120 OR
       pg_catalog.jsonb_typeof(cmd->'part') IS DISTINCT FROM 'string' OR pg_catalog.char_length(cmd->>'part')>100 OR
       NOT public.mn_death_int(cmd->'n',0,20) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>6 OR
       NOT (ack ?& ARRAY['type','op','opId','ok','why','rev']) OR ack->>'type'<>'freshwater' OR
       ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  IF kind='freshwater' AND ((op='craftBucket' AND cmd->>'source'<>'') OR
     (op='craftBucket' AND ((cmd->>'ship')<>'' OR (cmd->>'part')<>'' OR (cmd->>'n')<>'0')) OR
     (op='fill' AND (cmd->>'source'<>'salty-spring' OR cmd->>'ship'<>'' OR cmd->>'part'<>'' OR
       NOT public.mn_death_int(cmd->'n',1,4))) OR
     (op IN ('deposit','withdraw') AND (cmd->>'source'<>'' OR cmd->>'ship'='' OR cmd->>'part' !~ '^p[0-9]{1,10}$' OR
       NOT public.mn_death_int(cmd->'n',1,20))) OR
     (op='decant' AND (cmd->>'source'<>'' OR cmd->>'ship'<>'' OR cmd->>'part'<>'' OR
       NOT public.mn_death_int(cmd->'n',1,4)))) THEN RETURN false; END IF;
  IF kind='freshwater' AND ack->>'rev' IS DISTINCT FROM p_request->'profile'->'eco'->>'tradeRev' THEN RETURN false; END IF;
  base:=p_request-'before'::text;
  base:=pg_catalog.jsonb_set(base,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',cmd->'opId',
    'town','aldea','g','madera','n',1,'expectedTotal',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',cmd->'opId','ok',true,'why','','rev',0),false);
  RETURN public.mn_valid_economic_request_freshwater_base(p_operation_id,base);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_request->'command'->>'type'='freshwater' OR
     (p_request->'command'->>'type'='raft' AND p_request->'command'->'piece'->>0='waterBarrel') THEN
    RETURN public.mn_freshwater_request(p_operation_id,p_request);
  END IF;
  RETURN public.mn_valid_economic_request_freshwater_base(p_operation_id,p_request);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_raft_profile_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; b jsonb; n jsonb; op text; piece jsonb; id text; ships jsonb; ship jsonb; newship jsonb;
  idx integer; ship_index integer; parts jsonb; nextparts jsonb; cond jsonb; entries jsonb; nextcond jsonb; hold jsonb; nexthold jsonb;
  pack jsonb; nextpack jsonb; hgoods jsonb; pgoods jsonb; nhgoods jsonb; npgoods jsonb; woodh bigint; woodp bigint; nextp jsonb;
  cost integer:=4; refund integer:=0; row jsonb; barrel_index integer; oldhp numeric;
BEGIN
  cmd:=p_request->'command'; ack:=p_request->'ack'; b:=p_request->'before'; n:=p_request->'profile';
  op:=cmd->>'op'; piece:=cmd->'piece';
  IF NOT public.mn_freshwater_valid_profile(b) OR NOT public.mn_freshwater_valid_profile(n) THEN RETURN false; END IF;
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN b IS NOT DISTINCT FROM n; END IF;
  ships:=b->'eco'->'ships';
  IF pg_catalog.jsonb_typeof(ships) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT value,ordinality::integer-1 INTO ship,ship_index FROM pg_catalog.jsonb_array_elements(ships) WITH ORDINALITY s(value,ordinality)
    WHERE value->>'id'=cmd->>'id';
  IF ship IS NULL OR ship->>'kind'<>'raft' OR NOT public.mn_death_int(ship->'rev',1,2147483646) OR
     ship->'rev' IS DISTINCT FROM cmd->'expectedRev' OR pg_catalog.jsonb_typeof(ship->'grid'->'parts') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(ship->'condition') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ship->'condition'))<>3 OR
     ship->'condition'->'v' IS DISTINCT FROM '1'::jsonb OR
     NOT public.mn_death_int(ship->'condition'->'next',1,1000000000) OR
     pg_catalog.jsonb_typeof(ship->'condition'->'entries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  parts:=ship->'grid'->'parts'; cond:=ship->'condition'; entries:=cond->'entries'; hold:=ship->'hold'; pack:=b->'eco'->'pack';
  IF pg_catalog.jsonb_array_length(parts)>600 OR pg_catalog.jsonb_array_length(entries)<>pg_catalog.jsonb_array_length(parts) OR
     NOT public.mn_valid_artisan_hold(hold) OR NOT public.mn_starter_valid_pack(b) THEN RETURN false; END IF;
  IF cmd->>'expectedRev' IS NULL OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(ships) s WHERE s->>'id'=cmd->>'id')<>1 THEN RETURN false; END IF;
  nextparts:=parts; nextcond:=cond; nexthold:=hold; nextpack:=pack; hgoods:=COALESCE(hold->'goods','{}'::jsonb);
  pgoods:=COALESCE(pack->'goods','{}'::jsonb); nhgoods:=hgoods; npgoods:=pgoods;
  IF op='place' THEN
    IF pg_catalog.jsonb_array_length(parts)>=600 OR
       NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->1=piece->1 AND p->2=piece->2 AND p->3=piece->3 AND
          ((piece->3='0'::jsonb AND p->>0 IN ('foundation','reinforcedFoundation')) OR
           (piece->3<>'0'::jsonb AND p->>0='floor'))) OR
       EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->1=piece->1 AND p->2=piece->2 AND p->3=piece->3 AND
         p->>0 IN ('stairs','ladder','sail','engine','anchor','storage','chest','crate','cropPlot','canePlot','purifier','net',
          'grill','still','research','bed','bunk','lantern','turret','decor','pillar','waterBarrel')) THEN RETURN false; END IF;
    nextparts:=parts||pg_catalog.jsonb_build_array(piece);
    id:='p'||(cond->>'next');
    WHILE EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(entries) e WHERE e->>0=id) LOOP
      id:='p'||((pg_catalog.substr(id,2))::bigint+1)::text;
    END LOOP;
    IF (cond->>'next')::bigint>=999999400 THEN RETURN false; END IF;
    nextcond:=pg_catalog.jsonb_set(cond,'{next}',pg_catalog.to_jsonb((pg_catalog.substr(id,2))::bigint+1),false);
    nextcond:=pg_catalog.jsonb_set(nextcond,'{entries}',entries||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_array(id,'waterBarrel',piece->1,piece->2,piece->3,piece->4,25)),false);
    woodh:=COALESCE((hgoods->>'madera')::bigint,0); woodp:=COALESCE((pgoods->>'madera')::bigint,0);
    IF woodh+woodp<4 THEN RETURN false; END IF;
    nhgoods:=hgoods-'madera'::text; npgoods:=pgoods-'madera'::text;
    IF woodh>4 THEN nhgoods:=nhgoods||pg_catalog.jsonb_build_object('madera',woodh-4); END IF;
    IF woodp>4-LEAST(woodh,4) THEN npgoods:=npgoods||pg_catalog.jsonb_build_object('madera',woodp-(4-LEAST(woodh,4))); END IF;
  ELSIF op='remove' THEN
    idx:=(cmd->>'index')::integer;
    IF idx<0 OR idx>=pg_catalog.jsonb_array_length(parts) OR parts->idx IS DISTINCT FROM piece OR
       pg_catalog.jsonb_array_length(parts)<=1 OR entries->idx->>1<>'waterBarrel' THEN RETURN false; END IF;
    id:=entries->idx->>0; oldhp:=(entries->idx->>6)::numeric;
    IF oldhp<0 OR oldhp>25 THEN RETURN false; END IF;
    refund:=pg_catalog.floor(2::double precision*(oldhp::double precision/25)+1e-10)::integer;
    nextparts:=parts-idx; nextcond:=pg_catalog.jsonb_set(cond,'{entries}',entries-idx,false);
    IF hold ? 'vessels' THEN
      SELECT ordinality::integer-1 INTO barrel_index FROM pg_catalog.jsonb_array_elements(hold->'vessels') WITH ORDINALITY v(value,ordinality)
        WHERE value->>'id'=id AND value->>'kind'='barrel';
      IF barrel_index IS NOT NULL THEN
        IF (hold->'vessels'->barrel_index->>'water')::integer<>0 THEN RETURN false; END IF;
        nexthold:=pg_catalog.jsonb_set(hold,'{vessels}',(hold->'vessels')-barrel_index,false);
      END IF;
    END IF;
    IF refund>0 THEN
      woodh:=COALESCE((hgoods->>'madera')::bigint,0); woodp:=COALESCE((pgoods->>'madera')::bigint,0);
    END IF;
  ELSE RETURN false; END IF;
  IF op='place' THEN
    nexthold:=pg_catalog.jsonb_set(hold,'{goods}',nhgoods,false);
    nextpack:=pg_catalog.jsonb_set(pack,'{goods}',npgoods,false);
  ELSE
    IF n->'eco'->'pack'->'goods' IS NULL OR n->'eco'->'ships' IS NULL THEN RETURN false; END IF;
    nexthold:=pg_catalog.jsonb_set(nexthold,'{goods}',COALESCE(n->'eco'->'ships'->idx->'hold'->'goods','{}'::jsonb),false);
    nextpack:=n->'eco'->'pack';
    IF COALESCE((nexthold->'goods'->>'madera')::bigint,0)+COALESCE((nextpack->'goods'->>'madera')::bigint,0)<>
       COALESCE((hgoods->>'madera')::bigint,0)+COALESCE((pgoods->>'madera')::bigint,0)+refund OR
       ((nexthold->'goods')-'madera'::text) IS DISTINCT FROM (hgoods-'madera'::text) OR
       ((nextpack->'goods')-'madera'::text) IS DISTINCT FROM (pgoods-'madera'::text) THEN RETURN false; END IF;
  END IF;
  IF NOT public.mn_starter_valid_goods(nexthold->'goods',(nexthold->>'cap')::bigint,1000000000) OR
     NOT public.mn_starter_valid_goods(nextpack->'goods',(nextpack->>'cap')::bigint,COALESCE((nextpack->>'maxMass')::bigint,1000000000)) THEN RETURN false; END IF;
  newship:=pg_catalog.jsonb_set(ship,'{grid,parts}',nextparts,false);
  newship:=pg_catalog.jsonb_set(newship,'{condition}',nextcond,false);
  newship:=pg_catalog.jsonb_set(newship,'{hold}',nexthold,false);
  newship:=pg_catalog.jsonb_set(newship,'{rev}',pg_catalog.to_jsonb((ship->>'rev')::bigint+1),false);
  IF n->'eco'->'ships'->ship_index IS DISTINCT FROM newship THEN RETURN false; END IF;
  nextp:=pg_catalog.jsonb_set(b,'{eco,ships}',pg_catalog.jsonb_set(ships,ARRAY[ship_index::text],newship,false),false);
  nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',nextpack,false);
  RETURN n IS NOT DISTINCT FROM nextp AND ack->'rev' IS NOT DISTINCT FROM pg_catalog.to_jsonb((ship->>'rev')::bigint+1);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_profile_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; op text; b jsonb; n jsonb; ack jsonb; before_rev bigint; nextp jsonb;
  pack jsonb; goods jsonb; vessels jsonb; bucket jsonb; ships jsonb; ship jsonb; hold jsonb; barrel jsonb;
  idx integer; barrel_index integer; amount bigint; oldwater bigint; nextwater bigint; oldgoods jsonb; newgoods jsonb; nextship jsonb;
BEGIN
  cmd:=p_request->'command'; op:=cmd->>'op'; b:=p_request->'before'; n:=p_request->'profile'; ack:=p_request->'ack';
  IF cmd->>'type'='raft' THEN RETURN public.mn_freshwater_raft_profile_transition(p_request); END IF;
  before_rev:=(b->'eco'->>'tradeRev')::bigint;
  IF cmd->'expectedRev' IS DISTINCT FROM pg_catalog.to_jsonb(before_rev) OR ack->>'why' IS DISTINCT FROM '' OR
     ack->'ok' IS DISTINCT FROM 'true'::jsonb OR before_rev>=2147483646 OR
     (n->'eco'->>'tradeRev')::bigint<>before_rev+1 OR
     ack->'rev' IS DISTINCT FROM pg_catalog.to_jsonb(before_rev+1) THEN RETURN false; END IF;
  pack:=b->'eco'->'pack'; goods:=COALESCE(pack->'goods','{}'::jsonb); vessels:=COALESCE(pack->'vessels','[]'::jsonb);
  nextp:=b;
  IF op='craftBucket' THEN
    IF pg_catalog.jsonb_array_length(vessels)>0 OR COALESCE((goods->>'madera')::bigint,0)<2 THEN RETURN false; END IF;
    oldgoods:=goods-'madera'::text;
    IF COALESCE((goods->>'madera')::bigint,0)>2 THEN oldgoods:=oldgoods||pg_catalog.jsonb_build_object('madera',(goods->>'madera')::bigint-2); END IF;
    pack:=pg_catalog.jsonb_set(pack,'{goods}',oldgoods,false);
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','bucket','kind','bucket','water',0)),true);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  ELSIF op='fill' THEN
    IF pg_catalog.jsonb_array_length(vessels)<>1 THEN RETURN false; END IF;
    bucket:=vessels->0; oldwater:=(bucket->>'water')::bigint; amount:=(cmd->>'n')::bigint;
    IF bucket->>'id'<>'bucket' OR bucket->>'kind'<>'bucket' OR oldwater+amount>4 THEN RETURN false; END IF;
    nextwater:=oldwater+amount;
    bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb(nextwater),false);
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',pg_catalog.jsonb_build_array(bucket),false);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  ELSIF op='decant' THEN
    IF pg_catalog.jsonb_array_length(vessels)<>1 THEN RETURN false; END IF;
    bucket:=vessels->0; oldwater:=(bucket->>'water')::bigint; amount:=(cmd->>'n')::bigint;
    IF oldwater<amount THEN RETURN false; END IF;
    nextwater:=oldwater-amount;
    bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb(nextwater),false);
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',pg_catalog.jsonb_build_array(bucket),false);
    newgoods:=goods;
    IF COALESCE((goods->>'agua')::bigint,0)+amount>1000000 THEN RETURN false; END IF;
    newgoods:=newgoods||pg_catalog.jsonb_build_object('agua',COALESCE((goods->>'agua')::bigint,0)+amount);
    pack:=pg_catalog.jsonb_set(pack,'{goods}',newgoods,false);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  ELSE
    ships:=b->'eco'->'ships';
    IF pg_catalog.jsonb_typeof(ships) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    SELECT value,ordinality::integer-1 INTO ship,idx FROM pg_catalog.jsonb_array_elements(ships) WITH ORDINALITY e(value,ordinality)
      WHERE value->>'id'=cmd->>'ship';
    IF ship IS NULL OR ship->>'kind'<>'raft' OR pg_catalog.jsonb_typeof(ship->'hold') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    hold:=ship->'hold'; vessels:=COALESCE(hold->'vessels','[]'::jsonb);
    SELECT value,ordinality::integer-1 INTO barrel,barrel_index FROM pg_catalog.jsonb_array_elements(vessels) WITH ORDINALITY e(value,ordinality)
      WHERE value->>'id'=cmd->>'part';
    IF op='deposit' THEN
      IF pg_catalog.jsonb_array_length(COALESCE(pack->'vessels','[]'::jsonb))<>1 THEN RETURN false; END IF;
      bucket:=pack->'vessels'->0; oldwater:=(bucket->>'water')::bigint; amount:=(cmd->>'n')::bigint;
      IF oldwater<amount THEN RETURN false; END IF;
      IF barrel IS NULL THEN
        IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(ship->'condition'->'entries') e WHERE
          e->>0=cmd->>'part' AND e->>1='waterBarrel') OR NOT EXISTS(
          SELECT 1 FROM pg_catalog.jsonb_array_elements(ship->'grid'->'parts') p
          WHERE p->>0='waterBarrel' AND p->>1=(SELECT e->>2 FROM pg_catalog.jsonb_array_elements(ship->'condition'->'entries') e WHERE e->>0=cmd->>'part') AND
            p->>2=(SELECT e->>3 FROM pg_catalog.jsonb_array_elements(ship->'condition'->'entries') e WHERE e->>0=cmd->>'part') AND
            p->>3=(SELECT e->>4 FROM pg_catalog.jsonb_array_elements(ship->'condition'->'entries') e WHERE e->>0=cmd->>'part') AND
            p->>4=(SELECT e->>5 FROM pg_catalog.jsonb_array_elements(ship->'condition'->'entries') e WHERE e->>0=cmd->>'part')) THEN RETURN false; END IF;
        barrel:=pg_catalog.jsonb_build_object('id',cmd->>'part','kind','barrel','water',0); vessels:=vessels||pg_catalog.jsonb_build_array(barrel);
        barrel:=vessels->(pg_catalog.jsonb_array_length(vessels)-1);
      END IF;
      IF barrel->>'kind'<>'barrel' OR (barrel->>'water')::bigint+amount>20 THEN RETURN false; END IF;
      bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb(oldwater-amount),false);
      barrel:=pg_catalog.jsonb_set(barrel,'{water}',pg_catalog.to_jsonb((barrel->>'water')::bigint+amount),false);
    ELSE
      IF barrel IS NULL OR barrel->>'kind'<>'barrel' OR pg_catalog.jsonb_array_length(COALESCE(pack->'vessels','[]'::jsonb))<>1 THEN RETURN false; END IF;
      bucket:=pack->'vessels'->0; oldwater:=(barrel->>'water')::bigint; amount:=(cmd->>'n')::bigint;
      IF oldwater<amount OR (bucket->>'water')::bigint+amount>4 THEN RETURN false; END IF;
      bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb((bucket->>'water')::bigint+amount),false);
      barrel:=pg_catalog.jsonb_set(barrel,'{water}',pg_catalog.to_jsonb(oldwater-amount),false);
    END IF;
    IF op='deposit' AND barrel_index IS NULL THEN
      vessels:=pg_catalog.jsonb_set(vessels,ARRAY[(pg_catalog.jsonb_array_length(vessels)-1)::text],barrel,false);
    ELSE vessels:=pg_catalog.jsonb_set(vessels,ARRAY[barrel_index::text],barrel,false); END IF;
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',pg_catalog.jsonb_build_array(bucket),false);
    hold:=pg_catalog.jsonb_set(hold,'{vessels}',vessels,true);
    nextship:=pg_catalog.jsonb_set(ship,'{hold}',hold,false);
    nextship:=pg_catalog.jsonb_set(nextship,'{rev}',pg_catalog.to_jsonb((ship->>'rev')::bigint+1),false);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,ships}',pg_catalog.jsonb_set(ships,ARRAY[idx::text],nextship,false),false);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  END IF;
  nextp:=pg_catalog.jsonb_set(nextp,'{eco,tradeRev}',pg_catalog.to_jsonb(before_rev+1),false);
  RETURN n IS NOT DISTINCT FROM nextp;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF public.mn_valid_artisan_world(p_request,p_world) IS NOT TRUE THEN RETURN false; END IF;
  IF p_request->'ack'->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    IF p_request->'command'->>'type'='raft' THEN
      RETURN p_request->'before' IS NOT DISTINCT FROM p_request->'profile';
    END IF;
    RETURN p_request->'before' IS NOT DISTINCT FROM p_request->'profile' AND
      p_request->'ack'->>'rev' IS NOT DISTINCT FROM p_request->'before'->'eco'->>'tradeRev';
  END IF;
  RETURN public.mn_freshwater_profile_transition(p_request);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

-- Ordinary economic families may change goods and other established profile fields, but they
-- cannot create, remove, or edit reusable container contents as a side effect.
CREATE OR REPLACE FUNCTION public.mn_freshwater_vessels_frozen(p_before jsonb,p_after jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE oldships jsonb; newships jsonb; oldship jsonb; newship jsonb; id text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_after) IS DISTINCT FROM 'object' OR
     (p_before->'eco'->'pack'->'vessels') IS DISTINCT FROM (p_after->'eco'->'pack'->'vessels') THEN RETURN false; END IF;
  oldships:=COALESCE(p_before->'eco'->'ships','[]'::jsonb); newships:=COALESCE(p_after->'eco'->'ships','[]'::jsonb);
  IF pg_catalog.jsonb_typeof(oldships) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(newships) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR oldship IN SELECT value FROM pg_catalog.jsonb_array_elements(oldships) LOOP
    id:=oldship->>'id';
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(oldships) s WHERE s->>'id'=id)<>1 THEN RETURN false; END IF;
    SELECT value INTO newship FROM pg_catalog.jsonb_array_elements(newships) WHERE value->>'id'=id;
    IF newship IS NULL THEN
      IF pg_catalog.jsonb_array_length(COALESCE(oldship->'hold'->'vessels','[]'::jsonb))>0 THEN RETURN false; END IF;
    ELSIF (oldship->'hold'->'vessels') IS DISTINCT FROM (newship->'hold'->'vessels') THEN RETURN false; END IF;
  END LOOP;
  FOR newship IN SELECT value FROM pg_catalog.jsonb_array_elements(newships) LOOP
    id:=newship->>'id';
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(newships) s WHERE s->>'id'=id)<>1 THEN RETURN false; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(oldships) s WHERE s->>'id'=id) AND
       pg_catalog.jsonb_array_length(COALESCE(newship->'hold'->'vessels','[]'::jsonb))>0 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request));

CREATE OR REPLACE FUNCTION public.mn_commit_economic_operation(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE a uuid; w text; curp jsonb; curw jsonb; pv integer; wv integer; oldreq jsonb; oldresult jsonb; v_result jsonb;
BEGIN
  IF p_request->'command'->>'type'<>'freshwater' AND NOT
     (p_request->'command'->>'type'='raft' AND p_request->'command'->'piece'->>0='waterBarrel') THEN
    IF p_request ? 'before' THEN
      IF NOT public.mn_freshwater_vessels_frozen(p_request->'before',p_request->'profile') THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    ELSE
      IF p_operation_id IS NULL THEN RETURN public.mn_commit_economic_operation_freshwater_base(p_operation_id,p_request); END IF;
      a:=(p_request->>'account')::uuid; w:=p_request->>'world';
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
      SELECT request,result INTO oldreq,oldresult FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
      IF FOUND THEN RETURN public.mn_commit_economic_operation_freshwater_base(p_operation_id,p_request); END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||w,0));
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||a::text,0));
      SELECT data INTO curp FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
      IF curp IS NULL OR NOT public.mn_freshwater_vessels_frozen(curp,p_request->'profile') THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    END IF;
    RETURN public.mn_commit_economic_operation_freshwater_base(p_operation_id,p_request);
  END IF;
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' OR p_operation_id IS NULL OR
     NOT public.mn_valid_economic_request(p_operation_id,p_request) THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  SELECT request,result INTO oldreq,oldresult FROM public.mn_economic_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF oldreq IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation'); END IF;
    RETURN oldresult||pg_catalog.jsonb_build_object('replay',true);
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
  SELECT data,version INTO curp,pv FROM public.mn_profiles WHERE player_id=a FOR UPDATE;
  SELECT economy,version INTO curw,wv FROM public.mn_worlds WHERE world=w FOR UPDATE;
  IF pv IS NULL OR wv IS NULL OR pv<>(p_request->>'expectedProfileVersion')::integer OR
     wv<>(p_request->>'expectedWorldVersion')::integer OR curp IS DISTINCT FROM p_request->'before' OR
     curw->>'seed' IS DISTINCT FROM p_request->'worldData'->>'seed' OR
     NOT public.mn_freshwater_transition(p_request,curw) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  v_result:=public.mn_economic_result(p_operation_id,p_request);
  UPDATE public.mn_profiles SET data=p_request->'profile',version=pv+1,updated_at=pg_catalog.now() WHERE player_id=a;
  UPDATE public.mn_worlds SET economy=p_request->'worldData',version=wv+1,updated_at=pg_catalog.now() WHERE world=w;
  INSERT INTO public.mn_economic_operations(operation_id,request,result) VALUES(p_operation_id,p_request,v_result);
  RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

REVOKE ALL ON FUNCTION public.mn_freshwater_vessels(jsonb,text),public.mn_valid_artisan_hold(jsonb),
  public.mn_starter_valid_pack(jsonb),public.mn_freshwater_bucket(jsonb),public.mn_freshwater_valid_profile(jsonb),
  public.mn_freshwater_request(uuid,jsonb),public.mn_freshwater_raft_profile_transition(jsonb),
  public.mn_freshwater_profile_transition(jsonb),public.mn_freshwater_transition(jsonb,jsonb),
  public.mn_freshwater_vessels_frozen(jsonb,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_freshwater_operations_ready()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_commit_economic_operation_freshwater_base(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_freshwater_request(uuid,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_commit_economic_operation(uuid,jsonb),public.mn_freshwater_operations_ready() TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_freshwater_vessels(jsonb,text),public.mn_valid_artisan_hold(jsonb),
  public.mn_starter_valid_pack(jsonb),public.mn_freshwater_bucket(jsonb),public.mn_freshwater_valid_profile(jsonb),
  public.mn_freshwater_raft_profile_transition(jsonb),public.mn_freshwater_profile_transition(jsonb),public.mn_freshwater_transition(jsonb,jsonb),
  public.mn_freshwater_vessels_frozen(jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_valid_artisan_hold_freshwater_base(jsonb),
  public.mn_starter_valid_pack_freshwater_base(jsonb),public.mn_valid_economic_request_freshwater_base(uuid,jsonb)
  TO service_role;
COMMIT;

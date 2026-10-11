-- RNV07b reusable canteen and SRV01 consumption in the existing economic receipt.
-- Apply after 001-031. No row rewrite, second writer, or gameplay activation.
BEGIN;
DO $rename$ BEGIN
  IF pg_catalog.to_regprocedure('public.mn_freshwater_request_030(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_request(uuid,jsonb) RENAME TO mn_freshwater_request_030;
  END IF;
END $rename$;
CREATE OR REPLACE FUNCTION public.mn_survival_profile_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE s jsonb;
BEGIN
  IF NOT (p ? 'surv') THEN RETURN true; END IF;
  s:=p->'surv';
  IF pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['v','sat','hyd']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(s))<>3 OR s->'v' IS DISTINCT FROM '1'::jsonb OR
    pg_catalog.jsonb_typeof(s->'sat') IS DISTINCT FROM 'number' OR pg_catalog.jsonb_typeof(s->'hyd') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  RETURN (s->>'sat')::numeric BETWEEN 0 AND 100 AND (s->>'hyd')::numeric BETWEEN 0 AND 100 AND
    (s->>'sat')::numeric*100=pg_catalog.trunc((s->>'sat')::numeric*100) AND
    (s->>'hyd')::numeric*100=pg_catalog.trunc((s->>'hyd')::numeric*100);
EXCEPTION WHEN data_exception THEN RETURN false;
END $function$;

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
      IF v_count>2 OR NOT ((v_id='bucket' AND v->>'kind'='bucket' AND v_water<=4) OR
        (v_id='canteen' AND v->>'kind'='canteen' AND v_water<=3)) THEN RETURN false; END IF;
    ELSIF p_kind='hold' THEN
      IF v_id !~ '^p[0-9]{1,10}$' OR v->>'kind'<>'barrel' THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
  END LOOP;
  RETURN true;
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
  RETURN volume+COALESCE((SELECT pg_catalog.sum(CASE value->>'kind' WHEN 'bucket' THEN 2 ELSE 1 END)
      FROM pg_catalog.jsonb_array_elements(vessels)),0)<=cap AND
    mass+COALESCE((SELECT pg_catalog.sum((value->>'water')::numeric+CASE value->>'kind' WHEN 'bucket' THEN 1 ELSE .5 END)
      FROM pg_catalog.jsonb_array_elements(vessels)),0)<=mass_cap;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;
CREATE OR REPLACE FUNCTION public.mn_freshwater_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; op text; base jsonb;
BEGIN
  IF NOT public.mn_survival_profile_valid(p_request->'before') OR NOT public.mn_survival_profile_valid(p_request->'profile') THEN RETURN false; END IF;
  cmd:=p_request->'command'; op:=cmd->>'op';
  IF cmd->>'type' IS DISTINCT FROM 'freshwater' OR op NOT IN ('craftCanteen','fillCanteen','refillCanteen','drink','eat') THEN
    RETURN public.mn_freshwater_request_030(p_operation_id,p_request);
  END IF;
  IF pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
    NOT(cmd ?& ARRAY['type','op','opId','expectedRev','source','ship','part','n']) OR
    pg_catalog.jsonb_typeof(cmd->'source') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(cmd->'ship') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(cmd->'part') IS DISTINCT FROM 'string' OR
    NOT public.mn_death_int(cmd->'n',0,3) THEN RETURN false; END IF;
  IF op='craftCanteen' THEN
    IF cmd->>'source'<>'' OR cmd->>'ship'<>'' OR cmd->>'part'<>'' OR cmd->'n'<>'0'::jsonb THEN RETURN false; END IF;
  ELSIF op='fillCanteen' THEN
    IF cmd->>'source'<>'salty-spring' OR cmd->>'ship'<>'' OR cmd->>'part'<>'' OR NOT public.mn_death_int(cmd->'n',1,3) THEN RETURN false; END IF;
  ELSIF op='refillCanteen' THEN
    IF cmd->>'source' NOT IN ('bucket','provisions','barrel') OR NOT public.mn_death_int(cmd->'n',1,3) THEN RETURN false; END IF;
    IF cmd->>'source'='barrel' THEN
      IF cmd->>'ship' !~ '^[A-Za-z0-9:_-]{1,120}$' OR cmd->>'part' !~ '^p[0-9]{1,10}$' THEN RETURN false; END IF;
    ELSIF cmd->>'ship'<>'' OR cmd->>'part'<>'' THEN RETURN false; END IF;
  ELSE
    IF cmd->>'ship'<>'' OR cmd->>'part'<>'' OR cmd->'n'<>'1'::jsonb OR
      (op='drink' AND cmd->>'source'<>'') OR
      (op='eat' AND cmd->>'source' NOT IN ('pescado','galleta','fruta','agua','ron')) THEN RETURN false; END IF;
  END IF;
  IF p_request->'ack'->>'op' IS DISTINCT FROM op THEN RETURN false; END IF;
  base:=pg_catalog.jsonb_set(p_request,'{command}',cmd||pg_catalog.jsonb_build_object('op','craftBucket','source','','ship','','part','','n',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack,op}','"craftBucket"'::jsonb,false);
  RETURN public.mn_freshwater_request_030(p_operation_id,base);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_profile_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; op text; b jsonb; n jsonb; ack jsonb; before_rev bigint; nextp jsonb;
  pack jsonb; goods jsonb; vessels jsonb; bucket jsonb; ships jsonb; ship jsonb; hold jsonb; barrel jsonb;
  idx integer; barrel_index integer; amount bigint; oldwater bigint; nextwater bigint; oldgoods jsonb; newgoods jsonb; nextship jsonb;
  canteen jsonb; ci integer; bi integer; need jsonb; food_sat numeric:=0; food_hyd numeric:=0; g text; cost integer;
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
  SELECT value,ordinality::integer-1 INTO canteen,ci FROM pg_catalog.jsonb_array_elements(vessels) WITH ORDINALITY e(value,ordinality)
    WHERE value->>'kind'='canteen';
  SELECT value,ordinality::integer-1 INTO bucket,bi FROM pg_catalog.jsonb_array_elements(vessels) WITH ORDINALITY e(value,ordinality)
    WHERE value->>'kind'='bucket';
  amount:=(cmd->>'n')::bigint;
  IF op IN ('craftCanteen','fillCanteen','refillCanteen','drink','eat') THEN
    IF NOT public.mn_survival_profile_valid(b) OR NOT public.mn_survival_profile_valid(n) THEN RETURN false; END IF;
    IF op='craftCanteen' THEN
      IF canteen IS NOT NULL OR COALESCE((goods->>'madera')::bigint,0)<1 OR COALESCE((goods->>'lona')::bigint,0)<2 THEN RETURN false; END IF;
      oldgoods:=goods;
      FOREACH g IN ARRAY ARRAY['madera','lona'] LOOP
        cost:=CASE g WHEN 'madera' THEN 1 ELSE 2 END;
        oldgoods:=oldgoods-g;
        IF (goods->>g)::bigint>cost THEN oldgoods:=oldgoods||pg_catalog.jsonb_build_object(g,(goods->>g)::bigint-cost); END IF;
      END LOOP;
      pack:=pg_catalog.jsonb_set(pack,'{goods}',oldgoods,false);
      vessels:=vessels||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','canteen','kind','canteen','water',0));
    ELSIF op='eat' THEN
      g:=cmd->>'source';
      IF COALESCE((goods->>g)::bigint,0)<1 THEN RETURN false; END IF;
      food_sat:=CASE g WHEN 'pescado' THEN 35 WHEN 'galleta' THEN 25 WHEN 'fruta' THEN 15 WHEN 'ron' THEN 5 ELSE 0 END;
      food_hyd:=CASE g WHEN 'agua' THEN 40 WHEN 'fruta' THEN 10 WHEN 'ron' THEN 15 ELSE 0 END;
      oldgoods:=goods-g;
      IF (goods->>g)::bigint>1 THEN oldgoods:=oldgoods||pg_catalog.jsonb_build_object(g,(goods->>g)::bigint-1); END IF;
      pack:=pg_catalog.jsonb_set(pack,'{goods}',oldgoods,false);
    ELSE
      IF canteen IS NULL THEN RETURN false; END IF;
      oldwater:=(canteen->>'water')::bigint;
      IF op='drink' THEN
        IF oldwater<1 THEN RETURN false; END IF;
        nextwater:=oldwater-1; food_hyd:=40;
      ELSE
        IF oldwater+amount>3 THEN RETURN false; END IF;
        nextwater:=oldwater+amount;
        IF op='refillCanteen' THEN
          IF cmd->>'source'='bucket' THEN
            IF bucket IS NULL OR (bucket->>'water')::bigint<amount THEN RETURN false; END IF;
            vessels:=pg_catalog.jsonb_set(vessels,ARRAY[bi::text],bucket||pg_catalog.jsonb_build_object('water',(bucket->>'water')::bigint-amount),false);
          ELSIF cmd->>'source'='provisions' THEN
            IF COALESCE((goods->>'agua')::bigint,0)<amount THEN RETURN false; END IF;
            oldgoods:=goods-'agua'::text;
            IF (goods->>'agua')::bigint>amount THEN oldgoods:=oldgoods||pg_catalog.jsonb_build_object('agua',(goods->>'agua')::bigint-amount); END IF;
            pack:=pg_catalog.jsonb_set(pack,'{goods}',oldgoods,false);
          ELSE
            ships:=b->'eco'->'ships';
            SELECT value,ordinality::integer-1 INTO ship,idx FROM pg_catalog.jsonb_array_elements(ships) WITH ORDINALITY e(value,ordinality)
              WHERE value->>'id'=cmd->>'ship';
            IF ship IS NULL OR ship->>'kind'<>'raft' OR NOT public.mn_death_int(ship->'rev',1,2147483646) THEN RETURN false; END IF;
            hold:=ship->'hold';
            SELECT value,ordinality::integer-1 INTO barrel,barrel_index FROM pg_catalog.jsonb_array_elements(hold->'vessels') WITH ORDINALITY e(value,ordinality)
              WHERE value->>'id'=cmd->>'part' AND value->>'kind'='barrel';
            IF barrel IS NULL OR (barrel->>'water')::bigint<amount OR NOT EXISTS(
              SELECT 1 FROM pg_catalog.jsonb_array_elements(ship->'condition'->'entries') e
              WHERE e->>0=cmd->>'part' AND e->>1='waterBarrel' AND (e->>6)::numeric>0) THEN RETURN false; END IF;
            hold:=pg_catalog.jsonb_set(hold,ARRAY['vessels',barrel_index::text,'water'],pg_catalog.to_jsonb((barrel->>'water')::bigint-amount),false);
            nextship:=pg_catalog.jsonb_set(ship,'{hold}',hold,false)||pg_catalog.jsonb_build_object('rev',(ship->>'rev')::bigint+1);
            nextp:=pg_catalog.jsonb_set(nextp,ARRAY['eco','ships',idx::text],nextship,false);
          END IF;
        END IF;
      END IF;
      vessels:=pg_catalog.jsonb_set(vessels,ARRAY[ci::text],canteen||pg_catalog.jsonb_build_object('water',nextwater),false);
    END IF;
    IF op IN ('eat','drink') THEN
      need:=COALESCE(b->'surv',pg_catalog.jsonb_build_object('v',1,'sat',100,'hyd',100));
      IF ((food_sat=0 OR (need->>'sat')::numeric>=100) AND (food_hyd=0 OR (need->>'hyd')::numeric>=100)) THEN RETURN false; END IF;
      need:=pg_catalog.jsonb_build_object('v',1,'sat',LEAST(100,(need->>'sat')::numeric+food_sat),'hyd',LEAST(100,(need->>'hyd')::numeric+food_hyd));
      nextp:=pg_catalog.jsonb_set(nextp,'{surv}',need,true);
    END IF;
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',vessels,true);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  ELSIF op='craftBucket' THEN
    IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(vessels) v WHERE v->>'kind'='bucket') OR COALESCE((goods->>'madera')::bigint,0)<2 THEN RETURN false; END IF;
    oldgoods:=goods-'madera'::text;
    IF COALESCE((goods->>'madera')::bigint,0)>2 THEN oldgoods:=oldgoods||pg_catalog.jsonb_build_object('madera',(goods->>'madera')::bigint-2); END IF;
    pack:=pg_catalog.jsonb_set(pack,'{goods}',oldgoods,false);
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',vessels||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','bucket','kind','bucket','water',0)),true);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  ELSIF op='fill' THEN
    IF bucket IS NULL THEN RETURN false; END IF;
     oldwater:=(bucket->>'water')::bigint; amount:=(cmd->>'n')::bigint;
    IF bucket->>'id'<>'bucket' OR bucket->>'kind'<>'bucket' OR oldwater+amount>4 THEN RETURN false; END IF;
    nextwater:=oldwater+amount;
    bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb(nextwater),false);
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',(SELECT pg_catalog.jsonb_agg(CASE WHEN v->>'kind'='bucket' THEN bucket ELSE v END ORDER BY ord) FROM pg_catalog.jsonb_array_elements(pack->'vessels') WITH ORDINALITY e(v,ord)),false);
    nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack}',pack,false);
  ELSIF op='decant' THEN
    IF bucket IS NULL THEN RETURN false; END IF;
     oldwater:=(bucket->>'water')::bigint; amount:=(cmd->>'n')::bigint;
    IF oldwater<amount THEN RETURN false; END IF;
    nextwater:=oldwater-amount;
    bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb(nextwater),false);
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',(SELECT pg_catalog.jsonb_agg(CASE WHEN v->>'kind'='bucket' THEN bucket ELSE v END ORDER BY ord) FROM pg_catalog.jsonb_array_elements(pack->'vessels') WITH ORDINALITY e(v,ord)),false);
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
      IF bucket IS NULL THEN RETURN false; END IF;
       oldwater:=(bucket->>'water')::bigint; amount:=(cmd->>'n')::bigint;
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
      IF barrel IS NULL OR barrel->>'kind'<>'barrel' OR bucket IS NULL THEN RETURN false; END IF;
       oldwater:=(barrel->>'water')::bigint; amount:=(cmd->>'n')::bigint;
      IF oldwater<amount OR (bucket->>'water')::bigint+amount>4 THEN RETURN false; END IF;
      bucket:=pg_catalog.jsonb_set(bucket,'{water}',pg_catalog.to_jsonb((bucket->>'water')::bigint+amount),false);
      barrel:=pg_catalog.jsonb_set(barrel,'{water}',pg_catalog.to_jsonb(oldwater-amount),false);
    END IF;
    IF op='deposit' AND barrel_index IS NULL THEN
      vessels:=pg_catalog.jsonb_set(vessels,ARRAY[(pg_catalog.jsonb_array_length(vessels)-1)::text],barrel,false);
    ELSE vessels:=pg_catalog.jsonb_set(vessels,ARRAY[barrel_index::text],barrel,false); END IF;
    pack:=pg_catalog.jsonb_set(pack,'{vessels}',(SELECT pg_catalog.jsonb_agg(CASE WHEN v->>'kind'='bucket' THEN bucket ELSE v END ORDER BY ord) FROM pg_catalog.jsonb_array_elements(pack->'vessels') WITH ORDINALITY e(v,ord)),false);
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

-- Ordinary economic receipts must preserve needs as well as reusable vessels. The existing
-- SQL030 writer invokes this check against its locked profile and handles exact historical replay.
CREATE OR REPLACE FUNCTION public.mn_freshwater_vessels_frozen(p_before jsonb,p_after jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE oldships jsonb; newships jsonb; oldship jsonb; newship jsonb; id text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_after) IS DISTINCT FROM 'object' OR
     NOT public.mn_survival_profile_valid(p_before) OR NOT public.mn_survival_profile_valid(p_after) OR
     p_before->'surv' IS DISTINCT FROM p_after->'surv' OR
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

CREATE OR REPLACE FUNCTION public.mn_canteen_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
 SELECT pg_catalog.jsonb_build_object('version',1);
$function$;
REVOKE ALL ON FUNCTION public.mn_survival_profile_valid(jsonb), public.mn_freshwater_request_030(uuid,jsonb),
 public.mn_freshwater_request(uuid,jsonb),public.mn_freshwater_vessels(jsonb,text),public.mn_starter_valid_pack(jsonb),
 public.mn_freshwater_profile_transition(jsonb),public.mn_canteen_operations_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_survival_profile_valid(jsonb),public.mn_freshwater_request_030(uuid,jsonb),
 public.mn_freshwater_request(uuid,jsonb),public.mn_freshwater_vessels(jsonb,text),public.mn_starter_valid_pack(jsonb),
 public.mn_freshwater_profile_transition(jsonb),public.mn_canteen_operations_ready() TO service_role;
COMMIT;

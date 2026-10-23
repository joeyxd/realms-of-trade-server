-- Palm felling loot, coconut consumption, and the explicitly versioned hand-torch recipe.
-- Apply after 001-036. Existing fire receipts without rules retain their SQL022 contract.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_starter_valid_goods_036(jsonb,bigint,bigint)') IS NULL THEN
    ALTER FUNCTION public.mn_starter_valid_goods(jsonb,bigint,bigint) RENAME TO mn_starter_valid_goods_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_starter_valid_pack_036(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_starter_valid_pack(jsonb) RENAME TO mn_starter_valid_pack_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_freshwater_request_036(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_request(uuid,jsonb) RENAME TO mn_freshwater_request_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_freshwater_profile_transition_036(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_profile_transition(jsonb) RENAME TO mn_freshwater_profile_transition_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_036(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_attribute_request_036(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_attribute_request(uuid,jsonb) RENAME TO mn_valid_attribute_request_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_artisan_hold_036(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_artisan_hold(jsonb) RENAME TO mn_valid_artisan_hold_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_fire_transition_036(jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_fire_transition(jsonb,jsonb) RENAME TO mn_valid_fire_transition_036;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_starter_v3_transition_036(uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_starter_v3_transition(uuid,jsonb,jsonb) RENAME TO mn_valid_starter_v3_transition_036;
  END IF;
END
$rename$;

-- Reproducible ASCII hash shared with src/data/harvestLoot.js. Resource IDs are ASCII by contract.
CREATE OR REPLACE FUNCTION public.mn_torch_loot_roll(p_node text,p_final_rev bigint,p_good text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE input text; h bigint:=17; i integer; threshold integer;
BEGIN
  IF p_node IS NULL OR p_node !~ '^[A-Za-z0-9_-]{1,40}$' OR p_final_rev IS NULL OR
     p_final_rev<2 OR p_final_rev>2147483647 OR p_good IS NULL OR p_good NOT IN ('resina','coco') THEN RETURN false; END IF;
  threshold:=CASE p_good WHEN 'resina' THEN 35 ELSE 40 END;
  input:=p_node||':'||p_final_rev::text||':'||p_good;
  FOR i IN 1..pg_catalog.char_length(input) LOOP
    h:=(h*31+pg_catalog.ascii(pg_catalog.substr(input,i,1)))%2147483647;
  END LOOP;
  RETURN h%100<threshold;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_torch_loot_expected(p_node text,p_final_rev bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'resina',CASE WHEN public.mn_torch_loot_roll(p_node,p_final_rev,'resina') THEN 1 ELSE NULL END,
    'coco',CASE WHEN public.mn_torch_loot_roll(p_node,p_final_rev,'coco') THEN 1 ELSE NULL END));
$function$;

-- Add only the two known goods while retaining the old allowlist, integer bounds, and limits.
CREATE OR REPLACE FUNCTION public.mn_starter_valid_goods(p_goods jsonb,p_cap bigint,p_mass bigint)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE clean jsonb; amount jsonb; good text; qty numeric; volume numeric:=0; mass numeric:=0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_goods) IS DISTINCT FROM 'object' OR p_cap<0 OR p_mass<0 THEN RETURN false; END IF;
  clean:=p_goods-'resina'::text-'coco'::text;
  IF NOT public.mn_starter_valid_goods_036(clean,1000000000,1000000000) THEN RETURN false; END IF;
  FOR good,amount IN SELECT key,value FROM pg_catalog.jsonb_each(p_goods) LOOP
    IF good IN ('resina','coco') AND NOT public.mn_death_int(amount,1,1000000) THEN RETURN false; END IF;
    qty:=(amount::text)::numeric;
    volume:=volume+qty*CASE WHEN good IN ('madera','tronco','hierro','mineral_hierro','balas') THEN 3
      WHEN good IN ('cana','piedra','azufre','lona') THEN 2 WHEN good='resina' THEN .25 ELSE 1 END;
    mass:=mass+qty*CASE WHEN good IN ('hierro','mineral_hierro') THEN 6 WHEN good='piedra' THEN 4
      WHEN good='balas' THEN 5 WHEN good='tabaco' THEN .5 WHEN good='seda' THEN .25
      WHEN good IN ('madera','tronco') THEN 3 WHEN good IN ('cana','azufre') THEN 2
      WHEN good='resina' THEN .2 WHEN good='coco' THEN .5 ELSE 1 END;
  END LOOP;
  RETURN volume<=p_cap AND mass<=p_mass;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- SQL032's vessel-aware pack check must account for fractional resin volume and coconut mass.
CREATE OR REPLACE FUNCTION public.mn_starter_valid_pack(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE clean jsonb; pack jsonb; vessels jsonb; goods jsonb; g text; amount jsonb;
  cap bigint; mass_cap bigint; lvl bigint; volume numeric:=0; mass numeric:=0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_profile->'eco') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  pack:=p_profile->'eco'->'pack';
  IF pg_catalog.jsonb_typeof(pack) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  vessels:=pack->'vessels';
  IF vessels IS NOT NULL AND NOT public.mn_freshwater_vessels(vessels,'pack') THEN RETURN false; END IF;
  goods:=pack->'goods';
  IF NOT public.mn_starter_valid_goods(goods,(pack->>'cap')::bigint,
      COALESCE((pack->>'maxMass')::bigint,1000000000)) THEN RETURN false; END IF;
  -- Delegate all legacy item/level checks with only the two newly sized goods removed.
  clean:=pg_catalog.jsonb_set(p_profile,'{eco,pack}',
    (pack-'vessels'::text)||pg_catalog.jsonb_build_object('goods',goods-'resina'::text-'coco'::text),false);
  IF NOT public.mn_starter_valid_pack_036(clean) THEN RETURN false; END IF;
  cap:=(pack->>'cap')::bigint;
  mass_cap:=COALESCE((pack->>'maxMass')::bigint,1000000000);
  FOR g,amount IN SELECT key,value FROM pg_catalog.jsonb_each(goods) LOOP
    volume:=volume+(amount::text)::numeric*CASE WHEN g IN ('madera','tronco','hierro','mineral_hierro','balas') THEN 3
      WHEN g IN ('cana','piedra','azufre','lona') THEN 2 WHEN g='resina' THEN .25 ELSE 1 END;
    mass:=mass+(amount::text)::numeric*CASE WHEN g IN ('hierro','mineral_hierro') THEN 6 WHEN g='piedra' THEN 4
      WHEN g='balas' THEN 5 WHEN g='tabaco' THEN .5 WHEN g='seda' THEN .25
      WHEN g IN ('madera','tronco') THEN 3 WHEN g IN ('cana','azufre') THEN 2
      WHEN g='resina' THEN .2 WHEN g='coco' THEN .5 ELSE 1 END;
  END LOOP;
  RETURN volume+COALESCE((SELECT pg_catalog.sum(CASE value->>'kind' WHEN 'bucket' THEN 2 ELSE 1 END)
      FROM pg_catalog.jsonb_array_elements(vessels)),0)<=cap AND
    mass+COALESCE((SELECT pg_catalog.sum((value->>'water')::numeric+CASE value->>'kind' WHEN 'bucket' THEN 1 ELSE .5 END)
      FROM pg_catalog.jsonb_array_elements(vessels)),0)<=mass_cap;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

-- Preserve resin/coconut unchanged across attribute receipts, while validating the
-- before volume and successful after-profile capacity against their real sizing.
CREATE OR REPLACE FUNCTION public.mn_valid_attribute_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE b jsonb; n jsonb; bg jsonb; ng jsonb; projected jsonb; goods jsonb; cap bigint;
BEGIN
  b:=p_request->'before'; n:=p_request->'profile'; bg:=b->'eco'->'pack'->'goods'; ng:=n->'eco'->'pack'->'goods';
  IF pg_catalog.jsonb_typeof(b) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(n) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(bg) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(ng) IS DISTINCT FROM 'object' OR
     bg->'resina' IS DISTINCT FROM ng->'resina' OR bg->'coco' IS DISTINCT FROM ng->'coco' THEN RETURN false; END IF;
  cap:=(b->'eco'->'pack'->>'cap')::bigint;
  -- Adoption may repair an overweight legacy pack, but the old profile still needs a valid catalog and volume.
  IF NOT public.mn_starter_valid_goods(bg,cap,1000000000) THEN RETURN false; END IF;
  IF p_request->'ack'->'ok'='true'::jsonb AND NOT public.mn_starter_valid_pack(n) THEN RETURN false; END IF;
  projected:=p_request;
  goods:=bg-'resina'::text-'coco'::text;
  projected:=pg_catalog.jsonb_set(projected,'{before,eco,pack,goods}',goods,false);
  goods:=ng-'resina'::text-'coco'::text;
  projected:=pg_catalog.jsonb_set(projected,'{profile,eco,pack,goods}',goods,false);
  RETURN public.mn_valid_attribute_request_036(p_operation_id,projected);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- Extend the old strict vessel-aware hold validator with the two known cargo goods.
CREATE OR REPLACE FUNCTION public.mn_valid_artisan_hold(p_hold jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE goods jsonb; projected jsonb; g text; amount jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_hold) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_hold->'goods') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  goods:=p_hold->'goods';
  projected:=pg_catalog.jsonb_set(p_hold,'{goods}',goods-'resina'::text-'coco'::text,false);
  IF NOT public.mn_valid_artisan_hold_036(projected) THEN RETURN false; END IF;
  FOR g,amount IN SELECT key,value FROM pg_catalog.jsonb_each(goods) LOOP
    IF g IN ('resina','coco') AND NOT public.mn_death_int(amount,1,1000000) THEN RETURN false; END IF;
  END LOOP;
  RETURN public.mn_starter_valid_goods(goods,(p_hold->>'cap')::bigint,1000000000);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- The source validator continues to own the full command shape; only coco is projected as fruit.
CREATE OR REPLACE FUNCTION public.mn_freshwater_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; projected jsonb;
BEGIN
  cmd:=p_request->'command';
  IF cmd->>'type'='freshwater' AND cmd->>'op'='eat' AND cmd->>'source'='coco' THEN
    projected:=pg_catalog.jsonb_set(p_request,'{command,source}','"fruta"'::jsonb,false);
    RETURN public.mn_freshwater_request_036(p_operation_id,projected);
  END IF;
  RETURN public.mn_freshwater_request_036(p_operation_id,p_request);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- Validate the new 2-log + resin handTorch recipe only when explicitly versioned as rules:2.
-- Historical receipts without rules continue to use SQL022's one-plank cost.
CREATE OR REPLACE FUNCTION public.mn_valid_fire_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; b jsonb; goods jsonb; projected jsonb; before_goods jsonb;
  logs bigint; resin bigint; madera bigint;
BEGIN
  cmd:=p_request->'command';
  IF cmd->>'type'<>'fire' OR cmd->>'kind'<>'handTorch' OR cmd->>'op'<>'load' THEN
    IF cmd ? 'rules' THEN RETURN false; END IF;
    RETURN public.mn_valid_fire_transition_036(p_request,p_world);
  END IF;
  IF NOT (cmd ? 'rules') THEN RETURN public.mn_valid_fire_transition_036(p_request,p_world); END IF;
  IF cmd->'rules'<>'2'::jsonb OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>9 THEN RETURN false; END IF;
  b:=p_request->'before'; goods:=COALESCE(b->'eco'->'pack'->'goods','{}'::jsonb);
  logs:=COALESCE((goods->>'tronco')::bigint,0); resin:=COALESCE((goods->>'resina')::bigint,0);
  madera:=COALESCE((goods->>'madera')::bigint,0);
  IF logs<2 OR resin<1 THEN RETURN false; END IF;
  before_goods:=goods-'tronco'::text-'resina'::text-'madera'::text;
  IF logs>2 THEN before_goods:=before_goods||pg_catalog.jsonb_build_object('tronco',logs-2); END IF;
  IF resin>1 THEN before_goods:=before_goods||pg_catalog.jsonb_build_object('resina',resin-1); END IF;
  before_goods:=before_goods||pg_catalog.jsonb_build_object('madera',madera+1);
  projected:=pg_catalog.jsonb_set(p_request,'{before,eco,pack,goods}',before_goods,false);
  projected:=pg_catalog.jsonb_set(projected,'{command}',cmd-'rules'::text,false);
  RETURN public.mn_valid_fire_transition_036(projected,p_world);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- Drop values are checked before the SQL024 normalizer removes them from the legacy profile delta.
CREATE OR REPLACE FUNCTION public.mn_torch_loot_normalize(p_request jsonb,p_current jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; ack jsonb; row jsonb; resource jsonb; node jsonb; old_node jsonb;
  expected jsonb; loot jsonb; out_request jsonb; prof jsonb; goods jsonb; amount bigint; g text;
  row_index integer; final_rev bigint; is_final boolean:=false; marked boolean:=false;
BEGIN
  cmd:=p_request->'command'; ack:=p_request->'ack';
  marked:=cmd ? 'lootRules';
  IF marked AND (cmd->>'type'<>'resource' OR cmd->>'op'<>'gather' OR cmd->'lootRules'<>'1'::jsonb) THEN RETURN NULL; END IF;
  IF NOT marked THEN
    IF ack ? 'loot' THEN RETURN NULL; END IF;
    RETURN p_request;
  END IF;
  resource:=p_request->'worldData'->'resources';
  IF pg_catalog.jsonb_typeof(resource) IS DISTINCT FROM 'object' OR resource->>'v'<>'3' THEN
    RETURN NULL;
  END IF;
  SELECT value INTO node FROM pg_catalog.jsonb_array_elements(resource->'nodes') WHERE value->>'id'=cmd->>'node';
  IF node IS NULL OR node->>'kind'<>'palm' THEN RETURN NULL; END IF;
  out_request:=pg_catalog.jsonb_set(p_request,'{command}',cmd-'lootRules'::text,false);
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    IF ack ? 'loot' THEN RETURN NULL; END IF;
    RETURN out_request;
  END IF;
  final_rev:=(cmd->>'expectedRev')::bigint+1;
  is_final:=node->'hits'='3'::jsonb AND (node->>'readyAt')::bigint>0 AND
    (node->>'rev')::bigint=final_rev AND ack->'rev'=pg_catalog.to_jsonb(final_rev);
  IF p_current IS NOT NULL THEN
    SELECT value INTO old_node FROM pg_catalog.jsonb_array_elements(p_current->'resources'->'nodes') WHERE value->>'id'=cmd->>'node';
    IF old_node IS NULL OR old_node->>'kind'<>'palm' OR
       (old_node->>'rev')::bigint<>(cmd->>'expectedRev')::bigint THEN RETURN NULL; END IF;
    IF is_final AND (old_node->'hits'<>'2'::jsonb OR
       (node->>'readyAt')::bigint<=(resource->>'tick')::bigint) THEN RETURN NULL; END IF;
  END IF;
  IF NOT is_final THEN
    IF ack ? 'loot' THEN RETURN NULL; END IF;
    RETURN out_request;
  END IF;
  expected:=CASE WHEN is_final THEN public.mn_torch_loot_expected(cmd->>'node',final_rev) ELSE '{}'::jsonb END;
  loot:=ack->'loot';
  IF expected='{}'::jsonb THEN
    IF ack ? 'loot' THEN RETURN NULL; END IF;
    RETURN out_request;
  END IF;
  IF NOT is_final OR loot IS DISTINCT FROM expected THEN RETURN NULL; END IF;
  FOR g,amount IN SELECT key,value::text::bigint FROM pg_catalog.jsonb_each(expected) LOOP
    prof:=out_request->'profile'; goods:=prof->'eco'->'pack'->'goods';
    IF pg_catalog.jsonb_typeof(goods) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
    row_index:=NULL;
    IF p_request ? 'beneficiaries' THEN
      SELECT ord::integer-1 INTO row_index FROM pg_catalog.jsonb_array_elements(p_request->'beneficiaries') WITH ORDINALITY q(value,ord)
        WHERE value->>'account'=p_request->>'account';
      IF row_index IS NULL THEN RETURN NULL; END IF;
      row:=out_request->'beneficiaries'->row_index; prof:=row->'profile'; goods:=prof->'eco'->'pack'->'goods';
    END IF;
    IF COALESCE((goods->>g)::bigint,0)<amount THEN RETURN NULL; END IF;
    goods:=goods-g;
    IF (prof->'eco'->'pack'->'goods'->>g)::bigint>amount THEN
      goods:=goods||pg_catalog.jsonb_build_object(g,(prof->'eco'->'pack'->'goods'->>g)::bigint-amount);
    END IF;
    prof:=pg_catalog.jsonb_set(prof,'{eco,pack,goods}',goods,false);
    IF p_request ? 'beneficiaries' THEN
      row:=pg_catalog.jsonb_set(row,'{profile}',prof,false);
      out_request:=pg_catalog.jsonb_set(out_request,ARRAY['beneficiaries',row_index::text],row,false);
    END IF;
    out_request:=pg_catalog.jsonb_set(out_request,'{profile}',prof,false);
  END LOOP;
  ack:=ack-'loot'::text;
  RETURN pg_catalog.jsonb_set(out_request,'{ack}',ack,false);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_starter_v3_transition(p_operation_id uuid,p_request jsonb,p_current jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE normalized jsonb;
BEGIN
  normalized:=public.mn_torch_loot_normalize(p_request,p_current);
  IF normalized IS NULL THEN RETURN false; END IF;
  RETURN public.mn_valid_starter_v3_transition_036(p_operation_id,normalized,p_current);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE normalized jsonb; cmd jsonb; projected jsonb;
BEGIN
  normalized:=public.mn_torch_loot_normalize(p_request);
  IF normalized IS NULL THEN RETURN false; END IF;
  cmd:=normalized->'command';
  IF cmd->>'type'='commerce' AND cmd->>'g' IN ('resina','coco') THEN
    IF cmd->>'op' NOT IN ('transfer','buy','sell') THEN RETURN false; END IF;
    -- The legacy request validator owns the exact commerce envelope and all common bounds.
    -- Project only the schema's legacy allowlisted good; retain the real command and receipt
    -- untouched in the stored request. New goods may move to/from raft holds, while market
    -- buy/sell remains a persisted denial until those goods have explicit market rules.
    IF cmd->>'op' IN ('buy','sell') AND normalized->'ack'->'ok' IS DISTINCT FROM 'false'::jsonb THEN RETURN false; END IF;
    projected:=pg_catalog.jsonb_set(normalized,'{command,g}','"madera"'::jsonb,false);
    RETURN public.mn_valid_economic_request_036(p_operation_id,projected);
  END IF;
  IF cmd->>'type'='community' AND cmd->>'op'='contribute' AND cmd->>'good'='resina' THEN
    IF normalized->'ack'->'ok' IS DISTINCT FROM 'false'::jsonb THEN RETURN false; END IF;
    projected:=pg_catalog.jsonb_set(normalized,'{command,good}','"madera"'::jsonb,false);
    RETURN public.mn_valid_economic_request_036(p_operation_id,projected);
  END IF;
  IF cmd->>'type'='fire' AND cmd->>'kind'='handTorch' AND cmd->>'op'='load' AND cmd ? 'rules' THEN
    IF cmd->'rules'<>'2'::jsonb OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>9 THEN RETURN false; END IF;
    projected:=pg_catalog.jsonb_set(normalized,'{command}',cmd-'rules'::text,false);
    RETURN public.mn_valid_economic_request_036(p_operation_id,projected);
  END IF;
  IF cmd->>'type'='fire' AND cmd ? 'rules' THEN RETURN false; END IF;
  RETURN public.mn_valid_economic_request_036(p_operation_id,normalized);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- Recompute pack capacity and exact coconut hydration in the established freshwater receipt path.
CREATE OR REPLACE FUNCTION public.mn_freshwater_profile_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb;
BEGIN
  cmd:=p_request->'command';
  IF cmd->>'type'='freshwater' AND cmd->>'op'='eat' AND cmd->>'source'='coco' THEN
    RETURN public.mn_torch_coconut_transition(p_request);
  END IF;
  RETURN public.mn_freshwater_profile_transition_036(p_request);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- Helper is created after the wrapper above to keep the public transition's dispatch small.
CREATE OR REPLACE FUNCTION public.mn_torch_coconut_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; b jsonb; n jsonb; fake jsonb; fake_before jsonb; fake_after jsonb;
  goods jsonb; outgoods jsonb; coco bigint; fruit bigint; rev bigint; need jsonb; sat numeric; hyd numeric;
BEGIN
  cmd:=p_request->'command'; b:=p_request->'before'; n:=p_request->'profile';
  IF NOT public.mn_survival_profile_valid(b) OR NOT public.mn_survival_profile_valid(n) OR
     NOT public.mn_starter_valid_pack(b) OR NOT public.mn_starter_valid_pack(n) OR
     pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
     NOT (cmd ?& ARRAY['type','op','opId','expectedRev','source','ship','part','n']) OR
     cmd->>'ship'<>'' OR cmd->>'part'<>'' OR cmd->'n'<>'1'::jsonb OR
     cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' THEN RETURN false; END IF;
  goods:=COALESCE(b->'eco'->'pack'->'goods','{}'::jsonb);
  coco:=COALESCE((goods->>'coco')::bigint,0); fruit:=COALESCE((goods->>'fruta')::bigint,0);
  IF coco<1 THEN RETURN false; END IF;
  rev:=(b->'eco'->>'tradeRev')::bigint;
  IF cmd->'expectedRev' IS DISTINCT FROM pg_catalog.to_jsonb(rev) OR rev>=2147483646 OR
     (n->'eco'->>'tradeRev')::bigint<>rev+1 OR
     p_request->'ack'->>'type'<>'freshwater' OR p_request->'ack'->>'op'<>'eat' OR
     p_request->'ack'->>'opId' IS DISTINCT FROM cmd->>'opId' OR p_request->'ack'->>'why'<>'' OR
     p_request->'ack'->'ok' IS DISTINCT FROM 'true'::jsonb OR
     p_request->'ack'->'rev' IS DISTINCT FROM pg_catalog.to_jsonb(rev+1) THEN RETURN false; END IF;
  need:=COALESCE(b->'surv',pg_catalog.jsonb_build_object('v',1,'sat',100,'hyd',100));
  sat:=(need->>'sat')::numeric; hyd:=(need->>'hyd')::numeric;
  IF hyd>=100 THEN RETURN false; END IF;
  outgoods:=goods-'coco'::text;
  IF coco>1 THEN outgoods:=outgoods||pg_catalog.jsonb_build_object('coco',coco-1); END IF;
  fake_before:=b; goods:=goods-'coco'::text;
  IF fruit+coco>0 THEN goods:=goods||pg_catalog.jsonb_build_object('fruta',fruit+coco); END IF;
  fake_before:=pg_catalog.jsonb_set(fake_before,'{eco,pack,goods}',goods,false);
  -- The legacy fruit path models one unit of mass per fruit; coconut weighs one half.
  -- Raise only the internal projection's validation limit, while original before/after profiles
  -- were already checked with the real coconut weight above.
  IF b->'eco'->'pack' ? 'maxMass' THEN
    fake_before:=pg_catalog.jsonb_set(fake_before,'{eco,pack,maxMass}',
      pg_catalog.to_jsonb((b->'eco'->'pack'->>'maxMass')::numeric+coco),false);
  END IF;
  fake_after:=fake_before; goods:=goods-'fruta'::text;
  IF fruit+coco>1 THEN goods:=goods||pg_catalog.jsonb_build_object('fruta',fruit+coco-1); END IF;
  fake_after:=pg_catalog.jsonb_set(fake_after,'{eco,pack,goods}',goods,false);
  fake_after:=pg_catalog.jsonb_set(fake_after,'{eco,pack,vessels}',COALESCE(fake_before->'eco'->'pack'->'vessels','[]'::jsonb),true);
  fake_after:=pg_catalog.jsonb_set(fake_after,'{eco,tradeRev}',pg_catalog.to_jsonb(rev+1),false);
  fake_after:=pg_catalog.jsonb_set(fake_after,'{surv}',pg_catalog.jsonb_build_object(
    'v',1,'sat',LEAST(100,sat+15),'hyd',LEAST(100,hyd+10)),true);
  fake:=pg_catalog.jsonb_set(p_request,'{before}',fake_before,false);
  fake:=pg_catalog.jsonb_set(fake,'{profile}',fake_after,false);
  fake:=pg_catalog.jsonb_set(fake,'{command,source}','"fruta"'::jsonb,false);
  IF NOT public.mn_freshwater_profile_transition_036(fake) THEN RETURN false; END IF;
  fake_after:=b;
  fake_after:=pg_catalog.jsonb_set(fake_after,'{eco,pack,goods}',outgoods,false);
  fake_after:=pg_catalog.jsonb_set(fake_after,'{eco,pack,vessels}',COALESCE(b->'eco'->'pack'->'vessels','[]'::jsonb),true);
  fake_after:=pg_catalog.jsonb_set(fake_after,'{eco,tradeRev}',pg_catalog.to_jsonb(rev+1),false);
  fake_after:=pg_catalog.jsonb_set(fake_after,'{surv}',pg_catalog.jsonb_build_object(
    'v',1,'sat',sat,'hyd',LEAST(100,hyd+25)),true);
  RETURN n IS NOT DISTINCT FROM fake_after;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_torch_resin_coconut_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_constraint boolean; v_source text; v_rpc record; v_commit record; v_request record;
  v_commit_source text; v_survival_source text; v_fire_source text;
  v_coco_request jsonb; v_bad_coco jsonb; v_fire_request jsonb; v_bad_fire jsonb; v_fire_world jsonb;
  v_coco_ok boolean; v_coco_bad boolean; v_fire_ok boolean; v_fire_bad boolean;
BEGIN
  SELECT COALESCE(bool_or(convalidated AND contype='c'),false) INTO v_constraint
    FROM pg_catalog.pg_constraint WHERE conrelid='public.mn_economic_operations'::pg_catalog.regclass
      AND conname='mn_economic_operations_resource_check';
  SELECT pg_catalog.pg_get_functiondef('public.mn_valid_economic_request(uuid,jsonb)'::pg_catalog.regprocedure) INTO v_source;
  SELECT pg_catalog.pg_get_functiondef('public.mn_freshwater_profile_transition(jsonb)'::pg_catalog.regprocedure) INTO v_survival_source;
  SELECT pg_catalog.pg_get_functiondef('public.mn_valid_fire_transition(jsonb,jsonb)'::pg_catalog.regprocedure) INTO v_fire_source;
  SELECT prosecdef,proconfig INTO v_rpc FROM pg_catalog.pg_proc
    WHERE oid='public.mn_torch_resin_coconut_ready()'::pg_catalog.regprocedure;
  SELECT prosecdef,proconfig INTO v_commit FROM pg_catalog.pg_proc
    WHERE oid='public.mn_commit_economic_operation(uuid,jsonb)'::pg_catalog.regprocedure;
  SELECT prosecdef,proconfig INTO v_request FROM pg_catalog.pg_proc
    WHERE oid='public.mn_valid_economic_request(uuid,jsonb)'::pg_catalog.regprocedure;
  SELECT pg_catalog.pg_get_functiondef('public.mn_commit_economic_operation(uuid,jsonb)'::pg_catalog.regprocedure)
    INTO v_commit_source;
  v_coco_request:=pg_catalog.jsonb_build_object('command',
      '{"type":"freshwater","op":"eat","opId":"ready-coco","expectedRev":0,"source":"coco","ship":"","part":"","n":1}'::jsonb,
    'before','{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":0,"pack":{"cap":18,"maxMass":18,"goods":{"coco":2,"fruta":3},"vessels":[]},"ships":[]},"surv":{"v":1,"sat":47,"hyd":20}}'::jsonb,
    'profile','{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":1,"pack":{"cap":18,"maxMass":18,"goods":{"coco":1,"fruta":3},"vessels":[]},"ships":[]},"surv":{"v":1,"sat":47,"hyd":45}}'::jsonb,
    'ack','{"type":"freshwater","op":"eat","opId":"ready-coco","ok":true,"why":"","rev":1}'::jsonb);
  v_bad_coco:=pg_catalog.jsonb_set(v_coco_request,'{profile,surv,hyd}','46'::jsonb,false);
  v_fire_world:=pg_catalog.jsonb_build_object('v',1,'seed',314,'economy',pg_catalog.jsonb_build_object('v',2,'hours',0,
    'markets',pg_catalog.jsonb_build_object(
      'aldea',pg_catalog.jsonb_build_object('id','aldea','stock','{}'::jsonb,'last','{}'::jsonb),
      'cala',pg_catalog.jsonb_build_object('id','cala','stock','{}'::jsonb,'last','{}'::jsonb),
      'sol',pg_catalog.jsonb_build_object('id','sol','stock','{}'::jsonb,'last','{}'::jsonb),
      'ceniza',pg_catalog.jsonb_build_object('id','ceniza','stock','{}'::jsonb,'last','{}'::jsonb),
      'corona',pg_catalog.jsonb_build_object('id','corona','stock','{}'::jsonb,'last','{}'::jsonb),
      'coral',pg_catalog.jsonb_build_object('id','coral','stock','{}'::jsonb,'last','{}'::jsonb)),
    'plots',pg_catalog.jsonb_build_object('aldea','[]'::jsonb,'cala','[]'::jsonb,'sol','[]'::jsonb,
      'ceniza','[]'::jsonb,'corona','[]'::jsonb,'coral','[]'::jsonb)));
  v_fire_request:=pg_catalog.jsonb_build_object('world','torch-ready','account','aaaaaaaa-0000-4000-8000-000000000001',
    'command','{"type":"fire","op":"load","opId":"ready-torch","ship":"","part":"hand","kind":"handTorch","expectedRev":0,"lit":true,"rules":2}'::jsonb,
    'expectedProfileVersion',1,'expectedWorldVersion',1,
    'before','{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":0,"pack":{"cap":18,"maxMass":18,"goods":{"tronco":3,"resina":1,"madera":1}},"ships":[]}}'::jsonb,
    'profile','{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":1,"pack":{"cap":18,"maxMass":18,"goods":{"tronco":1,"madera":1}},"ships":[]},"fire":{"v":1,"rev":1,"slots":{"hand":{"kind":"handTorch","seconds":1200,"since":0,"lit":true}}}}'::jsonb,
    'worldData',v_fire_world,
    'ack','{"type":"fire","op":"load","opId":"ready-torch","ok":true,"why":"","rev":1}'::jsonb);
  v_bad_fire:=pg_catalog.jsonb_set(v_fire_request,'{profile,eco,pack,goods}',
    '{"tronco":1,"resina":1,"madera":1}'::jsonb,false);
  v_coco_ok:=public.mn_torch_coconut_transition(v_coco_request);
  v_coco_bad:=public.mn_torch_coconut_transition(v_bad_coco);
  v_fire_ok:=public.mn_valid_fire_transition(v_fire_request,v_fire_world);
  v_fire_bad:=public.mn_valid_fire_transition(v_bad_fire,v_fire_world);
  IF NOT public.mn_torch_loot_roll('palm-4',4,'resina') OR
     public.mn_torch_loot_roll('palm-4',4,'coco') OR
     NOT public.mn_torch_loot_roll('palm-4',3,'coco') OR
     NOT public.mn_starter_valid_goods('{"resina":1,"coco":1}'::jsonb,2,1) OR
     public.mn_starter_valid_goods('{"resina":1,"coco":1}'::jsonb,1,1) OR
     NOT public.mn_starter_valid_pack('{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":0,"pack":{"cap":18,"maxMass":18,"goods":{"resina":1,"coco":1}},"ships":[]}}'::jsonb) OR
     NOT COALESCE(v_coco_ok,false) OR COALESCE(v_coco_bad,true) OR
     NOT COALESCE(v_fire_ok,false) OR COALESCE(v_fire_bad,true) OR
     pg_catalog.to_regprocedure('public.mn_torch_loot_normalize(jsonb,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_torch_coconut_transition(jsonb)') IS NULL OR
     position('rules' in v_fire_source)=0 OR position('mn_torch_coconut_transition' in v_survival_source)=0 OR
     position('mn_torch_loot_normalize' in v_source)=0 OR NOT COALESCE(v_constraint,false) OR
     NOT COALESCE(v_rpc.prosecdef,false) OR NOT COALESCE(v_rpc.proconfig @> ARRAY['search_path=""'],false) OR
     NOT COALESCE(v_commit.prosecdef,false) OR NOT COALESCE(v_commit.proconfig @> ARRAY['search_path=""'],false) OR
     NOT COALESCE(v_request.proconfig @> ARRAY['search_path=""'],false) OR
     position('mn_valid_economic_request' in v_commit_source)=0 OR
     NOT pg_catalog.has_function_privilege('service_role','public.mn_commit_economic_operation(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('anon','public.mn_commit_economic_operation(uuid,jsonb)','EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated','public.mn_commit_economic_operation(uuid,jsonb)','EXECUTE') THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
EXCEPTION WHEN OTHERS THEN RETURN pg_catalog.jsonb_build_object('version',0);
END
$function$;

ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request) IS TRUE);

REVOKE ALL ON FUNCTION public.mn_starter_valid_goods_036(jsonb,bigint,bigint),
  public.mn_starter_valid_pack_036(jsonb),public.mn_freshwater_request_036(uuid,jsonb),
  public.mn_freshwater_profile_transition_036(jsonb),public.mn_valid_economic_request_036(uuid,jsonb),
  public.mn_valid_fire_transition_036(jsonb,jsonb),public.mn_valid_starter_v3_transition_036(uuid,jsonb,jsonb),
  public.mn_torch_loot_roll(text,bigint,text),public.mn_torch_loot_expected(text,bigint),
  public.mn_torch_loot_normalize(jsonb,jsonb),public.mn_torch_coconut_transition(jsonb),
  public.mn_starter_valid_goods(jsonb,bigint,bigint),public.mn_starter_valid_pack(jsonb),
  public.mn_valid_attribute_request(uuid,jsonb),public.mn_valid_artisan_hold(jsonb),
  public.mn_freshwater_request(uuid,jsonb),public.mn_freshwater_profile_transition(jsonb),
  public.mn_valid_fire_transition(jsonb,jsonb),public.mn_valid_starter_v3_transition(uuid,jsonb,jsonb),
  public.mn_valid_economic_request(uuid,jsonb),public.mn_torch_resin_coconut_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_starter_valid_goods(jsonb,bigint,bigint),
  public.mn_starter_valid_pack(jsonb),public.mn_freshwater_request(uuid,jsonb),
  public.mn_freshwater_profile_transition(jsonb),
  public.mn_valid_attribute_request(uuid,jsonb),public.mn_valid_artisan_hold(jsonb),
  public.mn_valid_starter_v3_transition(uuid,jsonb,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_torch_loot_roll(text,bigint,text),public.mn_torch_loot_expected(text,bigint),
  public.mn_torch_loot_normalize(jsonb,jsonb),public.mn_torch_coconut_transition(jsonb),
  public.mn_torch_resin_coconut_ready() TO service_role;

COMMIT;

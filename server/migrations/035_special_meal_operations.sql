-- SRV02 special meals use the existing freshwater economic receipt and profile transition.
-- Buff tuning is provisional; this migration adds no writer, table, recipe-world authority, or activation.
-- Apply after numbered migrations 001-034. Heat/range proof for ship recipes remains host-owned.
BEGIN;

DO $rename$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_survival_profile_valid_032(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_survival_profile_valid(jsonb) RENAME TO mn_survival_profile_valid_032;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_freshwater_valid_profile_032(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_valid_profile(jsonb) RENAME TO mn_freshwater_valid_profile_032;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_freshwater_request_032(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_request(uuid,jsonb) RENAME TO mn_freshwater_request_032;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_freshwater_profile_transition_032(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_profile_transition(jsonb) RENAME TO mn_freshwater_profile_transition_032;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_freshwater_vessels_frozen_032(jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_freshwater_vessels_frozen(jsonb,jsonb) RENAME TO mn_freshwater_vessels_frozen_032;
  END IF;
  IF pg_catalog.to_regprocedure('public.mn_valid_economic_request_034(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_economic_request(uuid,jsonb) RENAME TO mn_valid_economic_request_034;
  END IF;
END
$rename$;

-- Preserve the SQL032 SRV01 validator and add one exact, optional durable buff record.
CREATE OR REPLACE FUNCTION public.mn_survival_profile_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE meal jsonb; ticks numeric;
BEGIN
  IF NOT public.mn_survival_profile_valid_032(p) THEN RETURN false; END IF;
  IF NOT (p ? 'meal') THEN RETURN true; END IF;
  meal:=p->'meal';
  IF pg_catalog.jsonb_typeof(meal) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(meal))<>3 OR
     NOT (meal ?& ARRAY['v','kind','ticks']) OR
     meal->'v' IS DISTINCT FROM '1'::jsonb OR
     pg_catalog.jsonb_typeof(meal->'kind') IS DISTINCT FROM 'string' OR
     meal->>'kind' NOT IN ('roastFish','grog','heartyBiscuit') OR
     pg_catalog.jsonb_typeof(meal->'ticks') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  ticks:=(meal->>'ticks')::numeric;
  RETURN ticks BETWEEN 1 AND 54000 AND ticks=pg_catalog.trunc(ticks);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- Validate the new optional field without tightening historic SRV01 interpretation in an
-- unrelated receipt constraint. Actual writes still pass through the existing SRV01 freezer.
CREATE OR REPLACE FUNCTION public.mn_meal_profile_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  RETURN public.mn_survival_profile_valid(p-'surv'::text);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

-- The historical SQL030 profile validator predates the optional meal field. Keep its checks,
-- validating and stripping only the new field in the compatibility copy.
CREATE OR REPLACE FUNCTION public.mn_freshwater_valid_profile(p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
BEGIN
  IF NOT public.mn_survival_profile_valid(p_profile) THEN RETURN false; END IF;
  RETURN public.mn_freshwater_valid_profile_032(p_profile-'meal'::text);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; base jsonb; kind text;
BEGIN
  IF NOT public.mn_survival_profile_valid(p_request->'before') OR
     NOT public.mn_survival_profile_valid(p_request->'profile') THEN RETURN false; END IF;
  cmd:=p_request->'command';
  IF cmd->>'type' IS DISTINCT FROM 'freshwater' OR cmd->>'op' IS DISTINCT FROM 'meal' THEN
    IF (p_request->'before'->'meal') IS DISTINCT FROM (p_request->'profile'->'meal') THEN RETURN false; END IF;
    -- Pre-SRV02 request validators do not know the optional meal field. Validate it above,
    -- freeze it here, and omit only that field from the compatibility copy sent to SQL032.
    base:=pg_catalog.jsonb_set(p_request,'{before}',(p_request->'before')-'meal'::text,false);
    base:=pg_catalog.jsonb_set(base,'{profile}',(p_request->'profile')-'meal'::text,false);
    RETURN public.mn_freshwater_request_032(p_operation_id,base);
  END IF;
  IF pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
     NOT (cmd ?& ARRAY['type','op','opId','expectedRev','source','ship','part','n']) OR
     pg_catalog.jsonb_typeof(cmd->'source') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(cmd->'ship') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(cmd->'part') IS DISTINCT FROM 'string' OR
     NOT public.mn_death_int(cmd->'n',1,1) OR
     p_request->'ack'->>'op' IS DISTINCT FROM 'meal' THEN RETURN false; END IF;
  kind:=cmd->>'source';
  IF kind NOT IN ('roastFish','grog','heartyBiscuit') THEN RETURN false; END IF;
  IF kind='grog' THEN
    IF cmd->>'ship'<>'' THEN RETURN false; END IF;
    IF cmd->>'part'<>'' THEN RETURN false; END IF;
  ELSE
    IF cmd->>'ship' !~ '^[A-Za-z0-9:_-]{1,120}$' OR
       cmd->>'part' !~ '^p[0-9]{1,10}$' THEN RETURN false; END IF;
  END IF;
  -- Reuse the established SQL030 validator through SQL032's stable adapter. The original
  -- command and acknowledgement remain stored verbatim in the durable receipt.
  base:=pg_catalog.jsonb_set(p_request,'{command}',cmd||pg_catalog.jsonb_build_object(
    'op','craftBucket','source','','ship','','part','','n',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack,op}','"craftBucket"'::jsonb,false);
  RETURN public.mn_freshwater_request_032(p_operation_id,base);
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_profile_transition(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE cmd jsonb; kind text; b jsonb; n jsonb; ack jsonb; before_rev bigint;
  pack jsonb; goods jsonb; nextgoods jsonb; nextp jsonb; need jsonb;
  sat_add numeric; hyd_add numeric; sat numeric; hyd numeric; good text; count_good bigint;
BEGIN
  cmd:=p_request->'command';
  IF cmd->>'type' IS DISTINCT FROM 'freshwater' OR cmd->>'op' IS DISTINCT FROM 'meal' THEN
    IF NOT public.mn_freshwater_profile_transition_032(p_request) THEN RETURN false; END IF;
    RETURN (p_request->'before'->'meal') IS NOT DISTINCT FROM (p_request->'profile'->'meal');
  END IF;

  b:=p_request->'before'; n:=p_request->'profile'; ack:=p_request->'ack'; kind:=cmd->>'source';
  IF NOT public.mn_survival_profile_valid(b) OR NOT public.mn_survival_profile_valid(n) OR
     pg_catalog.jsonb_typeof(cmd) IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
     NOT (cmd ?& ARRAY['type','op','opId','expectedRev','source','ship','part','n']) OR
     pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR
     cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
     pg_catalog.jsonb_typeof(cmd->'expectedRev') IS DISTINCT FROM 'number' OR
     pg_catalog.jsonb_typeof(cmd->'source') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(cmd->'ship') IS DISTINCT FROM 'string' OR
     pg_catalog.jsonb_typeof(cmd->'part') IS DISTINCT FROM 'string' OR
     NOT public.mn_death_int(cmd->'n',1,1) OR
     ack->>'type' IS DISTINCT FROM 'freshwater' OR ack->>'op' IS DISTINCT FROM 'meal' OR
     ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR ack->>'why' IS DISTINCT FROM '' OR
     ack->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  IF kind NOT IN ('roastFish','grog','heartyBiscuit') THEN RETURN false; END IF;
  IF kind='grog' THEN
    IF cmd->>'ship'<>'' OR cmd->>'part'<>'' THEN RETURN false; END IF;
  ELSIF cmd->>'ship' !~ '^[A-Za-z0-9:_-]{1,120}$' OR cmd->>'part' !~ '^p[0-9]{1,10}$' THEN
    RETURN false;
  END IF;

  before_rev:=(b->'eco'->>'tradeRev')::bigint;
  IF cmd->'expectedRev' IS DISTINCT FROM pg_catalog.to_jsonb(before_rev) OR before_rev>=2147483646 OR
     (n->'eco'->>'tradeRev')::bigint<>before_rev+1 OR
     ack->'rev' IS DISTINCT FROM pg_catalog.to_jsonb(before_rev+1) THEN RETURN false; END IF;

  good:=CASE kind WHEN 'roastFish' THEN 'pescado' WHEN 'grog' THEN 'ron' ELSE 'galleta' END;
  pack:=b->'eco'->'pack'; goods:=pack->'goods'; count_good:=COALESCE((goods->>good)::bigint,0);
  IF count_good<1 THEN RETURN false; END IF;
  IF kind='grog' AND COALESCE((goods->>'agua')::bigint,0)<1 THEN RETURN false; END IF;
  IF kind='heartyBiscuit' AND COALESCE((goods->>'harina')::bigint,0)<1 THEN RETURN false; END IF;
  nextgoods:=goods;
  IF count_good=1 THEN nextgoods:=nextgoods-good;
  ELSE nextgoods:=nextgoods||pg_catalog.jsonb_build_object(good,count_good-1); END IF;
  IF kind IN ('grog','heartyBiscuit') THEN
    good:=CASE kind WHEN 'grog' THEN 'agua' ELSE 'harina' END;
    count_good:=(goods->>good)::bigint;
    IF count_good=1 THEN nextgoods:=nextgoods-good;
    ELSE nextgoods:=nextgoods||pg_catalog.jsonb_build_object(good,count_good-1); END IF;
  END IF;

  need:=COALESCE(b->'surv',pg_catalog.jsonb_build_object('v',1,'sat',100,'hyd',100));
  sat:=(need->>'sat')::numeric; hyd:=(need->>'hyd')::numeric;
  sat_add:=CASE kind WHEN 'roastFish' THEN 35 WHEN 'grog' THEN 5 ELSE 25 END;
  hyd_add:=CASE kind WHEN 'grog' THEN 55 ELSE 0 END;
  nextp:=pg_catalog.jsonb_set(b,'{eco,pack,goods}',nextgoods,false);
  nextp:=pg_catalog.jsonb_set(nextp,'{eco,pack,vessels}',COALESCE(pack->'vessels','[]'::jsonb),true);
  nextp:=pg_catalog.jsonb_set(nextp,'{surv}',pg_catalog.jsonb_build_object(
    'v',1,'sat',LEAST(100,sat+sat_add),'hyd',LEAST(100,hyd+hyd_add)),true);
  nextp:=pg_catalog.jsonb_set(nextp,'{meal}',pg_catalog.jsonb_build_object('v',1,'kind',kind,'ticks',54000),true);
  nextp:=pg_catalog.jsonb_set(nextp,'{eco,tradeRev}',pg_catalog.to_jsonb(before_rev+1),false);
  RETURN n IS NOT DISTINCT FROM nextp;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_freshwater_vessels_frozen(p_before jsonb,p_after jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
BEGIN
  RETURN public.mn_freshwater_vessels_frozen_032(p_before,p_after) AND
    (p_before->'meal') IS NOT DISTINCT FROM (p_after->'meal');
EXCEPTION WHEN data_exception OR undefined_function THEN RETURN false;
END
$function$;

-- Older economic families retain their existing validator contracts through a copy with only
-- the strict, unchanged optional meal field removed. SQL035 meal requests keep their full shape.
CREATE OR REPLACE FUNCTION public.mn_valid_economic_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE base jsonb; cmd jsonb; row jsonb; rows_out jsonb:='[]'::jsonb; rows_in jsonb;
BEGIN
  IF NOT public.mn_meal_profile_valid(p_request->'profile') OR
     (p_request ? 'before' AND NOT public.mn_meal_profile_valid(p_request->'before')) THEN RETURN false; END IF;
  cmd:=p_request->'command';
  IF cmd->>'type'='freshwater' AND cmd->>'op'='meal' THEN
    IF NOT public.mn_survival_profile_valid(p_request->'profile') OR
       NOT public.mn_survival_profile_valid(p_request->'before') THEN RETURN false; END IF;
    RETURN public.mn_valid_economic_request_034(p_operation_id,p_request);
  END IF;
  IF p_request ? 'before' AND
     (p_request->'before'->'meal') IS DISTINCT FROM (p_request->'profile'->'meal') THEN RETURN false; END IF;
  base:=pg_catalog.jsonb_set(p_request,'{profile}',(p_request->'profile')-'meal'::text,false);
  IF p_request ? 'before' THEN
    base:=pg_catalog.jsonb_set(base,'{before}',(p_request->'before')-'meal'::text,false);
  END IF;
  IF p_request ? 'beneficiaries' THEN
    rows_in:=p_request->'beneficiaries';
    IF pg_catalog.jsonb_typeof(rows_in) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(rows_in) LOOP
      IF pg_catalog.jsonb_typeof(row) IS DISTINCT FROM 'object' OR
         pg_catalog.jsonb_typeof(row->'before') IS DISTINCT FROM 'object' OR
         pg_catalog.jsonb_typeof(row->'profile') IS DISTINCT FROM 'object' OR
         NOT public.mn_meal_profile_valid(row->'before') OR
         NOT public.mn_meal_profile_valid(row->'profile') OR
         (row->'before'->'meal') IS DISTINCT FROM (row->'profile'->'meal') THEN RETURN false; END IF;
      IF row->>'account'=p_request->>'account' AND
         (row->'profile'->'meal') IS DISTINCT FROM (p_request->'profile'->'meal') THEN RETURN false; END IF;
      row:=pg_catalog.jsonb_set(row,'{before}',(row->'before')-'meal'::text,false);
      row:=pg_catalog.jsonb_set(row,'{profile}',(row->'profile')-'meal'::text,false);
      rows_out:=rows_out||pg_catalog.jsonb_build_array(row);
    END LOOP;
    base:=pg_catalog.jsonb_set(base,'{beneficiaries}',rows_out,false);
  END IF;
  RETURN public.mn_valid_economic_request_034(p_operation_id,base);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN
  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_special_meal_operations_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;

-- ALTER FUNCTION ... RENAME keeps dependent OIDs. Rebind the immutable receipt check to the
-- SQL035 validator, and make NULL invalid instead of relying on CHECK's UNKNOWN behavior.
ALTER TABLE public.mn_economic_operations DROP CONSTRAINT IF EXISTS mn_economic_operations_resource_check;
ALTER TABLE public.mn_economic_operations ADD CONSTRAINT mn_economic_operations_resource_check
  CHECK (public.mn_valid_economic_request(operation_id,request) IS TRUE);

REVOKE ALL ON FUNCTION public.mn_survival_profile_valid(jsonb),
  public.mn_survival_profile_valid_032(jsonb),public.mn_meal_profile_valid(jsonb),
  public.mn_freshwater_valid_profile(jsonb),
  public.mn_freshwater_valid_profile_032(jsonb),public.mn_freshwater_request(uuid,jsonb),
  public.mn_freshwater_request_032(uuid,jsonb),public.mn_freshwater_profile_transition(jsonb),
  public.mn_freshwater_profile_transition_032(jsonb),public.mn_freshwater_vessels_frozen(jsonb,jsonb),
  public.mn_freshwater_vessels_frozen_032(jsonb,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_valid_economic_request_034(uuid,jsonb),public.mn_special_meal_operations_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_survival_profile_valid(jsonb),
  public.mn_meal_profile_valid(jsonb),
  public.mn_freshwater_valid_profile(jsonb),
  public.mn_freshwater_request(uuid,jsonb),public.mn_freshwater_profile_transition(jsonb),
  public.mn_freshwater_vessels_frozen(jsonb,jsonb),public.mn_valid_economic_request(uuid,jsonb),
  public.mn_special_meal_operations_ready()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_survival_profile_valid_032(jsonb),
  public.mn_freshwater_valid_profile_032(jsonb),
  public.mn_freshwater_request_032(uuid,jsonb),public.mn_freshwater_profile_transition_032(jsonb),
  public.mn_freshwater_vessels_frozen_032(jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_valid_economic_request_034(uuid,jsonb) TO service_role;

COMMIT;

-- Whole-death profiles, pearl locations and ordinary ground drops in one receipt. Apply after 001-008.
-- Storage only: no gameplay hooks, death journal, pickup/expiry, clock policy or affinity credit.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_death_int(p_value jsonb, p_min numeric, p_max numeric)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  v := p_value::numeric;
  RETURN v = pg_catalog.trunc(v) AND v >= p_min AND v <= p_max;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_death_ground(p_ground jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p_ground) IS DISTINCT FROM 'object' OR
    NOT (p_ground ?& ARRAY['x','z','availableAt','expiresAt']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_ground)) <> 4 THEN RETURN false; END IF;
  RETURN public.mn_valid_pearl_ground((p_ground - 'expiresAt') ||
    pg_catalog.jsonb_build_object('returnAt', p_ground->'expiresAt'));
END
$function$;

-- Math.round for nonnegative Float64 values. floor(x + 0.5) can round the addition itself
-- up across the tie (e.g. 0.49999999999999994); compare the fractional part instead.
CREATE OR REPLACE FUNCTION public.mn_death_round_xp(p_xp double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT (pg_catalog.floor(p_xp * 100) + CASE
    WHEN p_xp * 100 - pg_catalog.floor(p_xp * 100) >= 0.5 THEN 1 ELSE 0 END) / 100;
$function$;

CREATE TABLE IF NOT EXISTS public.mn_death_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  result jsonb CHECK (result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS public.mn_death_drops (
  operation_id uuid NOT NULL REFERENCES public.mn_death_operations(operation_id),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 35),
  world text NOT NULL CHECK (world ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  victim uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('item','potion')),
  item jsonb NOT NULL,
  ground jsonb NOT NULL CHECK (public.mn_valid_death_ground(ground)),
  PRIMARY KEY (operation_id, ordinal),
  CHECK ((kind = 'potion' AND item = 'null'::jsonb) OR (kind = 'item' AND pg_catalog.jsonb_typeof(item) = 'object'))
);
CREATE INDEX IF NOT EXISTS mn_death_drops_world_page ON public.mn_death_drops(world, operation_id, ordinal);
ALTER TABLE public.mn_death_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_death_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_death_operations, public.mn_death_drops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mn_death_operations TO service_role;
GRANT SELECT, INSERT ON TABLE public.mn_death_drops TO service_role;

CREATE OR REPLACE FUNCTION public.mn_valid_death(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_p jsonb; v_q jsonb; v_rules jsonb; v_id uuid; v_victim uuid; v_killer uuid;
  v_previous text; v_number double precision; v_loss double precision; v_i integer := 0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT (p_request ?& ARRAY['world','victim','killer','rules','profiles','pearls','drops']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 7 OR
    pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
    (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(p_request->'victim') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(p_request->'killer') NOT IN ('string','null') OR
    pg_catalog.jsonb_typeof(p_request->'profiles') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_typeof(p_request->'pearls') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_typeof(p_request->'drops') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  v_rules := p_request->'rules';
  IF pg_catalog.jsonb_typeof(v_rules) IS DISTINCT FROM 'object' OR
    NOT (v_rules ?& ARRAY['lawless','xpLossFraction','xpBefore']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_rules)) <> 3 OR
    pg_catalog.jsonb_typeof(v_rules->'lawless') IS DISTINCT FROM 'boolean' OR
    pg_catalog.jsonb_typeof(v_rules->'xpLossFraction') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(v_rules->'xpBefore') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  v_number := (v_rules->>'xpBefore')::double precision; v_loss := (v_rules->>'xpLossFraction')::double precision;
  IF v_number < 0 OR v_number > 1000000 OR
    v_loss < 0 OR v_loss > 1 THEN RETURN false; END IF;
  v_victim := (p_request->>'victim')::uuid; v_killer := (p_request->>'killer')::uuid;
  IF p_request->>'victim' IS DISTINCT FROM v_victim::text OR
    (v_killer IS NOT NULL AND (p_request->>'killer' IS DISTINCT FROM v_killer::text OR
      v_killer = v_victim OR v_rules->>'lawless' <> 'true')) THEN RETURN false; END IF;
  IF pg_catalog.jsonb_array_length(p_request->'profiles') <> (CASE WHEN v_killer IS NULL THEN 1 ELSE 2 END) THEN RETURN false; END IF;
  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'profiles') LOOP
    IF pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object' OR
      NOT (v_p ?& ARRAY['id','expectedVersion','before','data']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_p)) <> 4 OR
      pg_catalog.jsonb_typeof(v_p->'id') IS DISTINCT FROM 'string' OR
      NOT public.mn_death_int(v_p->'expectedVersion',1,2147483646) OR
      pg_catalog.jsonb_typeof(v_p->'before') IS DISTINCT FROM 'object' OR
      pg_catalog.jsonb_typeof(v_p->'data') IS DISTINCT FROM 'object' OR
      v_p->'before'->'v' IS DISTINCT FROM '1'::jsonb OR v_p->'data'->'v' IS DISTINCT FROM '1'::jsonb OR
      pg_catalog.octet_length((v_p->'before')::text) > 131072 OR
      pg_catalog.octet_length((v_p->'data')::text) > 131072 THEN RETURN false; END IF;
    v_id := (v_p->>'id')::uuid;
    IF v_p->>'id' IS DISTINCT FROM v_id::text OR (v_id <> v_victim AND v_id IS DISTINCT FROM v_killer) OR
      (v_previous IS NOT NULL AND (v_p->>'id') COLLATE "C" <= v_previous COLLATE "C") THEN RETURN false; END IF;
    v_previous := v_p->>'id';
  END LOOP;
  IF pg_catalog.jsonb_array_length(p_request->'pearls') > 9 THEN RETURN false; END IF;
  v_previous := NULL;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'pearls') LOOP
    IF pg_catalog.jsonb_typeof(v_q) IS DISTINCT FROM 'object' OR
      NOT (v_q ?& ARRAY['uid','kind','expectedVersion','ground']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_q)) <> 4 OR
      pg_catalog.jsonb_typeof(v_q->'uid') IS DISTINCT FROM 'string' OR
      (v_q->>'uid') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
      pg_catalog.jsonb_typeof(v_q->'kind') IS DISTINCT FROM 'string' OR
      v_q->>'kind' NOT IN ('brasa','escarcha','tormenta','tinta') OR
      NOT public.mn_death_int(v_q->'expectedVersion',1,2147483646) OR
      NOT public.mn_valid_pearl_ground(v_q->'ground') OR
      (v_previous IS NOT NULL AND (v_q->>'uid') COLLATE "C" <= v_previous COLLATE "C") THEN RETURN false; END IF;
    v_previous := v_q->>'uid';
  END LOOP;
  IF pg_catalog.jsonb_array_length(p_request->'drops') > 35 THEN RETURN false; END IF;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'drops') LOOP
    v_i := v_i + 1;
    IF pg_catalog.jsonb_typeof(v_q) IS DISTINCT FROM 'object' OR
      NOT (v_q ?& ARRAY['ordinal','kind','item','ground']) OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_q)) <> 4 OR
      NOT public.mn_death_int(v_q->'ordinal',v_i,v_i) OR
      pg_catalog.jsonb_typeof(v_q->'kind') IS DISTINCT FROM 'string' OR
      v_q->>'kind' NOT IN ('item','potion') OR NOT public.mn_valid_death_ground(v_q->'ground') OR
      (v_q->>'kind' = 'potion' AND v_q->'item' IS DISTINCT FROM 'null'::jsonb) OR
      (v_q->>'kind' = 'item' AND pg_catalog.jsonb_typeof(v_q->'item') IS DISTINCT FROM 'object') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_death_delta(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_p jsonb; v_k jsonb; v_old jsonb; v_expected jsonb; v_eq jsonb; v_q jsonb;
  v_items jsonb := '[]'::jsonb; v_all jsonb; v_slot text; v_kit text; v_uid integer;
  v_lawless boolean; v_pots integer; v_i integer := 0; v_xp double precision; v_loss double precision;
BEGIN
  IF NOT public.mn_valid_death(p_request) THEN RETURN false; END IF;
  SELECT value INTO v_p FROM pg_catalog.jsonb_array_elements(p_request->'profiles') WHERE value->>'id' = p_request->>'victim';
  v_old := v_p->'before'; v_expected := v_old; v_eq := v_old->'eq';
  IF pg_catalog.jsonb_typeof(v_old->'bag') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(v_old->'bag') > 24 OR
    pg_catalog.jsonb_typeof(v_eq) IS DISTINCT FROM 'object' OR
    NOT (v_eq ?& ARRAY['weapon','head','chest','boots','ring1','ring2']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_eq)) <> 6 OR
    pg_catalog.jsonb_typeof(v_eq->'weapon') IS DISTINCT FROM 'object' OR
    NOT public.mn_death_int(v_old->'pot',0,5) OR NOT public.mn_death_int(v_old->'stats'->'deaths',0,999999999) OR
    pg_catalog.jsonb_typeof(v_old->'pirateId') IS DISTINCT FROM 'string' OR
    (v_old->>'pirateId') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(v_old->'xp') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(v_old->'pearls') IS DISTINCT FROM 'object' OR
    NOT (v_old->'pearls' ?& ARRAY['bag','swallowed']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_old->'pearls')) <> 2 OR
    pg_catalog.jsonb_typeof(v_old->'pearls'->'bag') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_array_length(v_old->'pearls'->'bag') > 8 OR
    pg_catalog.jsonb_typeof(v_old->'pearls'->'swallowed') NOT IN ('object','null') THEN RETURN false; END IF;
  v_xp := (p_request->'rules'->>'xpBefore')::double precision;
  IF (v_old->>'xp')::double precision <> public.mn_death_round_xp(v_xp) THEN RETURN false; END IF;
  v_loss := (p_request->'rules'->>'xpLossFraction')::double precision;
  -- The real ECS XP column is Float64; syncProfile rounds it to cents after the loss.
  v_xp := v_xp * (1::double precision - v_loss);
  v_expected := pg_catalog.jsonb_set(v_expected,'{xp}',pg_catalog.to_jsonb(public.mn_death_round_xp(v_xp)));
  v_lawless := (p_request->'rules'->>'lawless')::boolean;
  IF v_lawless THEN
    FOREACH v_slot IN ARRAY ARRAY['weapon','head','chest','boots','ring1','ring2'] LOOP
      v_q := v_eq->v_slot;
      IF v_q = 'null'::jsonb OR (v_slot = 'weapon' AND v_q->'s' = '1'::jsonb) THEN CONTINUE; END IF;
      IF pg_catalog.jsonb_typeof(v_q) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
      v_items := v_items || pg_catalog.jsonb_build_array(v_q);
      v_eq := pg_catalog.jsonb_set(v_eq,ARRAY[v_slot],'null'::jsonb);
    END LOOP;
  END IF;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(v_old->'bag') LOOP
    IF pg_catalog.jsonb_typeof(v_q) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    v_items := v_items || pg_catalog.jsonb_build_array(v_q);
  END LOOP;
  IF v_eq->'weapon' = 'null'::jsonb THEN
    IF NOT public.mn_death_int(v_old->'uid',1,2147483646) THEN RETURN false; END IF;
    v_uid := (v_old->>'uid')::integer;
    -- Same-kit starter as inventory.starterItem; extend together with the game's weapon catalog.
    v_kit := CASE WHEN v_old->'eq'->'weapon'->>'b' IN ('chispa','duelo','trabuco') THEN 'chispa' ELSE 'sable' END;
    v_eq := pg_catalog.jsonb_set(v_eq,'{weapon}',pg_catalog.jsonb_build_object('u',v_uid,'b',v_kit,'r',0,'l',1,'a','[]'::jsonb,'s',1));
    v_expected := pg_catalog.jsonb_set(v_expected,'{uid}',pg_catalog.to_jsonb(v_uid + 1));
  END IF;
  v_expected := pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_expected,'{eq}',v_eq),'{bag}','[]'::jsonb),
    '{pearls}','{"bag":[],"swallowed":null}'::jsonb);
  v_pots := CASE WHEN v_lawless THEN (v_old->>'pot')::integer ELSE 0 END;
  IF v_lawless THEN v_expected := pg_catalog.jsonb_set(v_expected,'{pot}','0'::jsonb); END IF;
  v_expected := pg_catalog.jsonb_set(v_expected,'{stats,deaths}',pg_catalog.to_jsonb((v_old->'stats'->>'deaths')::integer + 1));
  IF v_expected IS DISTINCT FROM v_p->'data' OR
    pg_catalog.jsonb_array_length(p_request->'drops') <> pg_catalog.jsonb_array_length(v_items) + v_pots THEN RETURN false; END IF;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'drops') LOOP
    IF v_i < pg_catalog.jsonb_array_length(v_items) THEN
      IF v_q->>'kind' <> 'item' OR v_q->'item' IS DISTINCT FROM v_items->v_i THEN RETURN false; END IF;
    ELSIF v_q->>'kind' <> 'potion' OR v_q->'item' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    v_i := v_i + 1;
  END LOOP;
  SELECT COALESCE(pg_catalog.jsonb_agg(q ORDER BY (q->>'uid') COLLATE "C"),'[]'::jsonb) INTO v_all
    FROM public.mn_profile_pearls(v_old) AS q;
  IF pg_catalog.jsonb_array_length(v_all) <> pg_catalog.jsonb_array_length(p_request->'pearls') THEN RETURN false; END IF;
  v_i := 0;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'pearls') LOOP
    IF v_all->v_i IS DISTINCT FROM pg_catalog.jsonb_build_object('uid',v_q->>'uid','kind',v_q->>'kind') THEN RETURN false; END IF;
    v_i := v_i + 1;
  END LOOP;
  IF p_request->'killer' <> 'null'::jsonb THEN
    SELECT value INTO v_k FROM pg_catalog.jsonb_array_elements(p_request->'profiles') WHERE value->>'id' = p_request->>'killer';
    IF NOT public.mn_death_int(v_k->'before'->'stats'->'pk',0,999999999) THEN RETURN false; END IF;
    v_expected := pg_catalog.jsonb_set(v_k->'before','{stats,pk}',pg_catalog.to_jsonb((v_k->'before'->'stats'->>'pk')::integer + 1));
    IF v_expected IS DISTINCT FROM v_k->'data' THEN RETURN false; END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

-- Both directions, including direct service inserts and legacy operation-ID updates. Existing
-- 003/004 child receipt and 008 batch intent rules remain unchanged.
CREATE OR REPLACE FUNCTION public.mn_guard_death_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported death isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF TG_TABLE_NAME = 'mn_death_operations' THEN
    IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'death operation family mismatch' USING ERRCODE = 'MNP02';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.result IS NOT NULL OR NOT public.mn_valid_death(NEW.request) THEN
        RAISE EXCEPTION 'invalid death receipt' USING ERRCODE = 'MNP02';
      END IF;
    ELSIF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.request IS DISTINCT FROM OLD.request OR
      OLD.result IS NOT NULL OR NEW.result IS NULL THEN
      RAISE EXCEPTION 'immutable death receipt' USING ERRCODE = 'MNP02';
    ELSE NEW.created_at := OLD.created_at;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'operation belongs to death' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_family ON public.mn_death_operations;
CREATE TRIGGER mn_death_family BEFORE INSERT OR UPDATE ON public.mn_death_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_family();
DROP TRIGGER IF EXISTS mn_death_family ON public.mn_pearl_operations;
CREATE TRIGGER mn_death_family BEFORE INSERT OR UPDATE ON public.mn_pearl_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_family();
DROP TRIGGER IF EXISTS mn_death_family ON public.mn_pearl_ground_operations;
CREATE TRIGGER mn_death_family BEFORE INSERT OR UPDATE ON public.mn_pearl_ground_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_family();
DROP TRIGGER IF EXISTS mn_death_family ON public.mn_pearl_batch_operations;
CREATE TRIGGER mn_death_family BEFORE INSERT OR UPDATE ON public.mn_pearl_batch_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_family();
DROP TRIGGER IF EXISTS mn_death_family ON public.mn_pearl_intents;
CREATE TRIGGER mn_death_family BEFORE INSERT OR UPDATE ON public.mn_pearl_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_family();

CREATE OR REPLACE FUNCTION public.mn_guard_death_drop()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_death_operations WHERE operation_id = NEW.operation_id FOR UPDATE;
  IF NOT FOUND OR v_result IS NOT NULL OR NEW.world IS DISTINCT FROM v_request->>'world' OR
    NEW.victim::text IS DISTINCT FROM v_request->>'victim' OR
    v_request->'drops'->(NEW.ordinal - 1) IS DISTINCT FROM pg_catalog.jsonb_build_object('ordinal',NEW.ordinal,
      'kind',NEW.kind,'item',NEW.item,'ground',NEW.ground) THEN
    RAISE EXCEPTION 'death drop identity mismatch' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_drop_guard ON public.mn_death_drops;
CREATE TRIGGER mn_death_drop_guard BEFORE INSERT ON public.mn_death_drops
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop();

-- Provisional receipts cannot escape a transaction. Verify completion explicitly inside the RPC
-- too, so an invariant error is rolled back before its success result can be returned.
CREATE OR REPLACE FUNCTION public.mn_assert_death_complete(p_operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_p jsonb; v_q jsonb; v_data jsonb; v_version integer;
  v_profiles jsonb := '[]'::jsonb; v_uniques jsonb := '[]'::jsonb; v_locations jsonb := '[]'::jsonb; v_drops jsonb := '[]'::jsonb;
BEGIN
  SELECT request,result INTO v_request,v_result FROM public.mn_death_operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_result IS NULL OR NOT public.mn_valid_death_delta(v_request) THEN
    RAISE EXCEPTION 'incomplete death receipt' USING ERRCODE = 'MNP02';
  END IF;
  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(v_request->'profiles') LOOP
    SELECT data,version INTO v_data,v_version FROM public.mn_profiles WHERE player_id = (v_p->>'id')::uuid;
    IF NOT FOUND OR v_data IS DISTINCT FROM v_p->'data' OR v_version <> (v_p->>'expectedVersion')::integer + 1 THEN
      RAISE EXCEPTION 'incomplete death profile' USING ERRCODE = 'MNP01';
    END IF;
    v_profiles := v_profiles || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_p->>'id','version',v_version));
  END LOOP;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(v_request->'pearls') LOOP
    SELECT pg_catalog.jsonb_build_object('uid',uid,'kind',kind,'holder',holder,'version',version) INTO v_data
      FROM public.mn_unique_items WHERE uid = v_q->>'uid';
    IF v_data IS DISTINCT FROM pg_catalog.jsonb_build_object('uid',v_q->>'uid','kind','pearl:' || (v_q->>'kind'),
      'holder',NULL,'version',(v_q->>'expectedVersion')::integer + 1) THEN
      RAISE EXCEPTION 'incomplete death unique' USING ERRCODE = 'MNP01';
    END IF;
    v_uniques := v_uniques || pg_catalog.jsonb_build_array(v_data);
    SELECT pg_catalog.jsonb_build_object('uid',uid,'world',world,'ground',ground,'version',version) INTO v_data
      FROM public.mn_pearl_locations WHERE uid = v_q->>'uid';
    IF v_data IS DISTINCT FROM pg_catalog.jsonb_build_object('uid',v_q->>'uid','world',v_request->>'world',
      'ground',v_q->'ground','version',(v_q->>'expectedVersion')::integer + 1) THEN
      RAISE EXCEPTION 'incomplete death location' USING ERRCODE = 'MNP01';
    END IF;
    v_locations := v_locations || pg_catalog.jsonb_build_array(v_data);
  END LOOP;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operationId',operation_id,'ordinal',ordinal,
    'world',world,'victim',victim,'kind',kind,'item',item,'ground',ground) ORDER BY ordinal),'[]'::jsonb)
    INTO v_drops FROM public.mn_death_drops WHERE operation_id = p_operation_id;
  SELECT COALESCE(pg_catalog.jsonb_agg(value || pg_catalog.jsonb_build_object('operationId',p_operation_id,
    'world',v_request->>'world','victim',v_request->>'victim') ORDER BY ord),'[]'::jsonb) INTO v_data
    FROM pg_catalog.jsonb_array_elements(v_request->'drops') WITH ORDINALITY AS q(value,ord);
  IF v_drops IS DISTINCT FROM v_data OR v_result IS DISTINCT FROM pg_catalog.jsonb_build_object('ok',true,'replay',false,
    'profiles',v_profiles,'uniques',v_uniques,'locations',v_locations,'drops',v_drops) THEN
    RAISE EXCEPTION 'incomplete death result' USING ERRCODE = 'MNP02';
  END IF;
END
$function$;
CREATE OR REPLACE FUNCTION public.mn_guard_death_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  PERFORM public.mn_assert_death_complete(NEW.operation_id); RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_complete ON public.mn_death_operations;
CREATE CONSTRAINT TRIGGER mn_death_complete AFTER INSERT OR UPDATE ON public.mn_death_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_complete();

CREATE OR REPLACE FUNCTION public.mn_commit_death(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_p jsonb; v_q jsonb; v_old jsonb; v_version integer; v_expected integer; v_uid text;
  v_current public.mn_unique_items%ROWTYPE; v_location public.mn_pearl_locations%ROWTYPE;
  v_request jsonb; v_result jsonb; v_profiles jsonb := '[]'::jsonb;
  v_uniques jsonb := '[]'::jsonb; v_locations jsonb := '[]'::jsonb; v_drops jsonb := '[]'::jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    NOT public.mn_valid_death(p_request) THEN RAISE EXCEPTION 'invalid death operation' USING ERRCODE = 'MNP02'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
  SELECT request, result INTO v_request, v_result FROM public.mn_death_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request OR v_result IS NULL THEN
      RAISE EXCEPTION 'death receipt mismatch' USING ERRCODE = 'MNP02';
    END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  INSERT INTO public.mn_death_operations(operation_id,request) VALUES (p_operation_id,p_request);
  -- Shared ordering: operation, sorted profile rows, every affected UID, then ledger/location rows.
  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'profiles') LOOP
    SELECT data,version INTO v_old,v_version FROM public.mn_profiles WHERE player_id = (v_p->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_version <> (v_p->>'expectedVersion')::integer OR v_old IS DISTINCT FROM v_p->'before' THEN
      RAISE EXCEPTION 'profile baseline conflict' USING ERRCODE = 'MNC01';
    END IF;
  END LOOP;
  FOR v_uid IN SELECT q->>'uid' FROM pg_catalog.jsonb_array_elements(p_request->'profiles') AS p
      CROSS JOIN LATERAL public.mn_profile_pearls(p->'before') AS q
    UNION SELECT q->>'uid' FROM pg_catalog.jsonb_array_elements(p_request->'profiles') AS p
      CROSS JOIN LATERAL public.mn_profile_pearls(p->'data') AS q
    UNION SELECT q->>'uid' FROM pg_catalog.jsonb_array_elements(p_request->'pearls') AS q ORDER BY 1
  LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_uid,0)); END LOOP;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'pearls') LOOP
    v_uid := v_q->>'uid'; v_expected := (v_q->>'expectedVersion')::integer;
    SELECT * INTO v_current FROM public.mn_unique_items WHERE uid = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing unique' USING ERRCODE = 'MNC01'; END IF;
    IF v_current.kind <> 'pearl:' || (v_q->>'kind') THEN RAISE EXCEPTION 'kind conflict' USING ERRCODE = 'MNK01'; END IF;
    IF v_current.version <> v_expected OR v_current.holder IS DISTINCT FROM (p_request->>'victim')::uuid THEN
      RAISE EXCEPTION 'unique conflict' USING ERRCODE = 'MNC01';
    END IF;
    SELECT * INTO v_location FROM public.mn_pearl_locations WHERE uid = v_uid FOR UPDATE;
    IF FOUND AND (v_location.world <> p_request->>'world' OR v_location.version <> v_expected OR v_location.ground IS NOT NULL) THEN
      RAISE EXCEPTION 'source location mismatch' USING ERRCODE = 'MNP01';
    END IF;
  END LOOP;
  IF NOT public.mn_valid_death_delta(p_request) THEN RAISE EXCEPTION 'death delta mismatch' USING ERRCODE = 'MNP01'; END IF;
  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'profiles') LOOP
    UPDATE public.mn_profiles SET data = v_p->'data',version = (v_p->>'expectedVersion')::integer + 1,updated_at = pg_catalog.now()
      WHERE player_id = (v_p->>'id')::uuid AND version = (v_p->>'expectedVersion')::integer;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile conflict' USING ERRCODE = 'MNC01'; END IF;
    v_profiles := v_profiles || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_p->>'id','version',(v_p->>'expectedVersion')::integer + 1));
  END LOOP;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'pearls') LOOP
    v_uid := v_q->>'uid'; v_expected := (v_q->>'expectedVersion')::integer;
    UPDATE public.mn_unique_items SET holder = NULL,version = v_expected + 1,since = NULL WHERE uid = v_uid;
    INSERT INTO public.mn_pearl_locations(uid,world,ground,version) VALUES (v_uid,p_request->>'world',v_q->'ground',v_expected + 1)
      ON CONFLICT (uid) DO UPDATE SET ground = EXCLUDED.ground,version = EXCLUDED.version,updated_at = pg_catalog.now();
    PERFORM public.mn_assert_pearl_location(v_uid,true);
    v_uniques := v_uniques || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('uid',v_uid,'kind','pearl:' || (v_q->>'kind'),'holder',NULL,'version',v_expected + 1));
    v_locations := v_locations || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('uid',v_uid,'world',p_request->>'world','ground',v_q->'ground','version',v_expected + 1));
  END LOOP;
  -- Catch orphan managed ownership even with zero declared pearls, before any result can escape.
  FOR v_p IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'profiles') LOOP
    FOR v_uid IN SELECT uid FROM public.mn_unique_items WHERE holder = (v_p->>'id')::uuid AND kind LIKE 'pearl:%' ORDER BY uid
    LOOP PERFORM public.mn_assert_pearl_owner(v_uid); END LOOP;
  END LOOP;
  FOR v_q IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'drops') LOOP
    INSERT INTO public.mn_death_drops(operation_id,ordinal,world,victim,kind,item,ground)
      VALUES (p_operation_id,(v_q->>'ordinal')::integer,p_request->>'world',(p_request->>'victim')::uuid,v_q->>'kind',v_q->'item',v_q->'ground');
    v_drops := v_drops || pg_catalog.jsonb_build_array(v_q || pg_catalog.jsonb_build_object('operationId',p_operation_id,
      'world',p_request->>'world','victim',p_request->>'victim'));
  END LOOP;
  v_result := pg_catalog.jsonb_build_object('ok',true,'replay',false,'profiles',v_profiles,'uniques',v_uniques,'locations',v_locations,'drops',v_drops);
  UPDATE public.mn_death_operations SET result = v_result WHERE operation_id = p_operation_id;
  PERFORM public.mn_assert_death_complete(p_operation_id);
  RETURN v_result;
EXCEPTION
  -- The exception block rolls back both profiles, every pearl/drop and the provisional receipt.
  WHEN SQLSTATE 'MNC01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  WHEN SQLSTATE 'MNK01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','kind');
  WHEN SQLSTATE 'MNP01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','ownership');
  WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_death_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid operation ID' USING ERRCODE = 'MNP02'; END IF;
  SELECT pg_catalog.jsonb_build_object('request',request,'result',result) INTO v_result
    FROM public.mn_death_operations WHERE operation_id = p_operation_id;
  RETURN v_result;
END
$function$;
CREATE OR REPLACE FUNCTION public.mn_list_death_drops(p_world text, p_after_operation_id uuid, p_after_ordinal integer, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 256 OR
    (p_after_operation_id IS NULL) <> (p_after_ordinal IS NULL) OR
    (p_after_ordinal IS NOT NULL AND (p_after_ordinal < 1 OR p_after_ordinal > 35)) THEN
    RAISE EXCEPTION 'invalid death drop page' USING ERRCODE = 'MNP02';
  END IF;
  RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operationId',q.operation_id,'ordinal',q.ordinal,
    'world',q.world,'victim',q.victim,'kind',q.kind,'item',q.item,'ground',q.ground) ORDER BY q.operation_id,q.ordinal),'[]'::jsonb)
    FROM (SELECT * FROM public.mn_death_drops WHERE world = p_world AND
      (p_after_operation_id IS NULL OR (operation_id,ordinal) > (p_after_operation_id,p_after_ordinal))
      ORDER BY operation_id,ordinal LIMIT p_limit) AS q);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_death_int(jsonb,numeric,numeric), public.mn_valid_death_ground(jsonb), public.mn_death_round_xp(double precision), public.mn_valid_death(jsonb),
  public.mn_valid_death_delta(jsonb), public.mn_guard_death_family(), public.mn_commit_death(uuid,jsonb),
  public.mn_guard_death_drop(), public.mn_assert_death_complete(uuid), public.mn_guard_death_complete(),
  public.mn_load_death_operation(uuid), public.mn_list_death_drops(text,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_death_int(jsonb,numeric,numeric), public.mn_valid_death_ground(jsonb), public.mn_death_round_xp(double precision), public.mn_valid_death(jsonb),
  public.mn_valid_death_delta(jsonb), public.mn_guard_death_family(), public.mn_commit_death(uuid,jsonb),
  public.mn_guard_death_drop(), public.mn_assert_death_complete(uuid), public.mn_guard_death_complete(),
  public.mn_load_death_operation(uuid), public.mn_list_death_drops(text,uuid,integer,integer) TO service_role;
COMMIT;

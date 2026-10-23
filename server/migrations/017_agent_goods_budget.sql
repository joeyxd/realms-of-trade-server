-- Lifetime owner mandates for agent commerce. Apply after migrations 001-016.
-- The existing economic receipt remains the sole gameplay authority; this table adds immutable policy and receipt linkage only.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_agent_goods_limits_valid(p_limits jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.jsonb_typeof(p_limits) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_limits)) <> 4 OR
    NOT (p_limits ?& ARRAY['buyGold','buyGoldPerTrade','sellUnits','sellUnitsPerTrade']) OR
    pg_catalog.jsonb_typeof(p_limits->'sellUnits') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_limits->'buyGold') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(p_limits->'buyGoldPerTrade') IS DISTINCT FROM 'number' OR
    pg_catalog.jsonb_typeof(p_limits->'sellUnitsPerTrade') IS DISTINCT FROM 'number' OR
    (p_limits->>'buyGold') !~ '^[0-9]+$' OR (p_limits->>'buyGoldPerTrade') !~ '^[0-9]+$' OR
    (p_limits->>'sellUnitsPerTrade') !~ '^[0-9]+$' OR (p_limits->>'buyGold')::numeric > 1000000000 OR
    (p_limits->>'buyGoldPerTrade')::numeric > (p_limits->>'buyGold')::numeric OR
    (p_limits->>'sellUnitsPerTrade')::numeric > 500 OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_limits->'sellUnits') e
      WHERE e.key NOT IN ('pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra',
        'hierro','mineral_hierro','azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas') OR
        pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'number' OR (e.value #>> '{}') !~ '^[0-9]+$' OR
        (e.value #>> '{}')::numeric > 1000000) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE TABLE IF NOT EXISTS public.mn_agent_goods_budgets (
  world text NOT NULL,
  character_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  limits jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  buy_gold_used bigint NOT NULL DEFAULT 0 CHECK (buy_gold_used >= 0),
  sell_units_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  revoked_at timestamptz,
  PRIMARY KEY (world, character_id),
  UNIQUE (world, owner_id, budget_id),
  CHECK (world ~ '^[A-Za-z0-9:_-]{1,100}$'),
  CHECK (owner_id <> character_id),
  CHECK (pg_catalog.jsonb_typeof(limits) = 'object'),
  CHECK (limits ?& ARRAY['buyGold','buyGoldPerTrade','sellUnits','sellUnitsPerTrade']),
  CHECK (pg_catalog.jsonb_typeof(limits->'sellUnits') = 'object'),
  CHECK (pg_catalog.jsonb_typeof(limits->'buyGold') = 'number' AND (limits->>'buyGold')::numeric BETWEEN 0 AND 1000000000),
  CHECK (pg_catalog.jsonb_typeof(limits->'buyGoldPerTrade') = 'number' AND
    (limits->>'buyGoldPerTrade')::numeric BETWEEN 0 AND (limits->>'buyGold')::numeric),
  CHECK (pg_catalog.jsonb_typeof(limits->'sellUnitsPerTrade') = 'number' AND
    (limits->>'sellUnitsPerTrade')::numeric BETWEEN 0 AND 500),
  CHECK (public.mn_agent_goods_limits_valid(limits)),
  CHECK (enabled OR revoked_at IS NOT NULL)
);

ALTER TABLE public.mn_agent_goods_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_agent_goods_budgets FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.mn_agent_trade_operations (
  operation_id uuid PRIMARY KEY REFERENCES public.mn_economic_operations(operation_id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL,
  world text NOT NULL,
  character_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_agent_trade_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_agent_trade_operations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mn_guard_agent_trade_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'immutable agent trade receipt' USING ERRCODE = 'MNP02'; END IF;
  SELECT request,result INTO v_request,v_result FROM public.mn_economic_operations WHERE operation_id=NEW.operation_id;
  IF NOT FOUND OR v_request IS DISTINCT FROM NEW.request OR v_result IS DISTINCT FROM NEW.result OR
    v_request->>'world' IS DISTINCT FROM NEW.world OR (v_request->>'account')::uuid IS DISTINCT FROM NEW.character_id OR
    NEW.owner_id=NEW.character_id OR v_request->'command'->>'type' IS DISTINCT FROM 'commerce' OR
    v_request->'command'->>'op' NOT IN ('buy','sell') THEN
    RAISE EXCEPTION 'agent trade receipt mismatch' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_agent_trade_immutable ON public.mn_agent_trade_operations;
CREATE TRIGGER mn_agent_trade_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.mn_agent_trade_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_agent_trade_operation();

CREATE OR REPLACE FUNCTION public.mn_agent_budget_projection(p_row public.mn_agent_goods_budgets)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('v',1,'budgetId',p_row.budget_id,'enabled',p_row.enabled,
    'limits',p_row.limits,'buyGoldUsed',p_row.buy_gold_used,'sellUnitsUsed',p_row.sell_units_used)
$function$;

CREATE OR REPLACE FUNCTION public.mn_create_agent_goods_budget(p_world text,p_owner_id uuid,p_character_id uuid,
  p_budget_id uuid,p_limits jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_agent_goods_budgets%ROWTYPE;
BEGIN
  IF p_world IS NULL OR p_world !~ '^[A-Za-z0-9:_-]{1,100}$' OR p_owner_id IS NULL OR p_character_id IS NULL OR
    p_budget_id IS NULL OR p_owner_id=p_character_id OR pg_catalog.jsonb_typeof(p_limits) IS DISTINCT FROM 'object' OR
    NOT (p_limits ?& ARRAY['buyGold','buyGoldPerTrade','sellUnits','sellUnitsPerTrade']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_limits)) <> 4 OR
    pg_catalog.jsonb_typeof(p_limits->'sellUnits') IS DISTINCT FROM 'object' OR
    NOT public.mn_agent_goods_limits_valid(p_limits) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','input');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-agent-budget:'||p_world||':'||p_character_id::text,0));
  INSERT INTO public.mn_agent_goods_budgets(world,owner_id,character_id,budget_id,limits)
    VALUES(p_world,p_owner_id,p_character_id,p_budget_id,p_limits) ON CONFLICT(world,character_id) DO NOTHING;
  SELECT * INTO v_row FROM public.mn_agent_goods_budgets WHERE world=p_world AND character_id=p_character_id FOR UPDATE;
  IF v_row.owner_id<>p_owner_id OR v_row.budget_id<>p_budget_id OR v_row.limits<>p_limits THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  RETURN public.mn_agent_budget_projection(v_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_agent_goods_budget(p_world text,p_owner_id uuid,p_character_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT public.mn_agent_budget_projection(b) FROM public.mn_agent_goods_budgets b
    WHERE b.world=p_world AND b.owner_id=p_owner_id AND b.character_id=p_character_id
$function$;

CREATE OR REPLACE FUNCTION public.mn_revoke_agent_goods_budget(p_world text,p_owner_id uuid,p_character_id uuid,p_budget_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.mn_agent_goods_budgets%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-agent-budget:'||p_world||':'||p_character_id::text,0));
  UPDATE public.mn_agent_goods_budgets SET enabled=false,revoked_at=coalesce(revoked_at,pg_catalog.now())
    WHERE world=p_world AND owner_id=p_owner_id AND character_id=p_character_id AND budget_id=p_budget_id;
  SELECT * INTO v_row FROM public.mn_agent_goods_budgets
    WHERE world=p_world AND owner_id=p_owner_id AND character_id=p_character_id AND budget_id=p_budget_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','budget'); END IF;
  RETURN public.mn_agent_budget_projection(v_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_commit_agent_trade(p_operation_id uuid,p_request jsonb,p_owner_id uuid,p_budget_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_req jsonb; v_result jsonb; v_trade public.mn_agent_trade_operations%ROWTYPE;
  v_budget public.mn_agent_goods_budgets%ROWTYPE; v_profile jsonb; v_profile_version integer;
  v_command jsonb; v_ack jsonb; v_good text; v_cost numeric; v_units numeric; v_used numeric;
  v_world text; v_character uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    p_owner_id IS NULL OR p_budget_id IS NULL OR NOT public.mn_valid_economic_request(p_operation_id,p_request) OR
    p_request->'command'->>'type' IS DISTINCT FROM 'commerce' OR
    p_request->'command'->>'op' NOT IN ('buy','sell') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:'||p_operation_id::text,0));
  SELECT * INTO v_trade FROM public.mn_agent_trade_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_trade.request IS DISTINCT FROM p_request OR v_trade.owner_id<>p_owner_id OR v_trade.budget_id<>p_budget_id THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
    END IF;
    RETURN v_trade.result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.mn_economic_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_ground_clock_operations WHERE operation_id=p_operation_id) OR
    EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id=p_operation_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  v_world:=p_request->>'world'; v_character:=(p_request->>'account')::uuid; v_command:=p_request->'command'; v_ack:=p_request->'ack';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||v_world,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-account:'||v_character::text,0));
  SELECT data,version INTO v_profile,v_profile_version FROM public.mn_profiles WHERE player_id=v_character FOR UPDATE;
  SELECT * INTO v_budget FROM public.mn_agent_goods_budgets WHERE world=v_world AND owner_id=p_owner_id AND
    character_id=v_character AND budget_id=p_budget_id FOR UPDATE;
  IF NOT FOUND OR NOT v_budget.enabled THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','budget'); END IF;
  IF v_ack->>'ok'='true' THEN
    v_good:=v_command->>'g'; v_units:=(v_command->>'n')::numeric;
    IF v_command->>'op'='buy' THEN
      v_cost:=(v_command->>'expectedTotal')::numeric;
      IF v_cost>(v_budget.limits->>'buyGoldPerTrade')::numeric OR
        v_budget.buy_gold_used+v_cost>(v_budget.limits->>'buyGold')::numeric OR
        v_profile IS NULL OR
        (v_profile->>'gold')::numeric-(p_request->'profile'->>'gold')::numeric<>v_cost OR
        coalesce(p_request->'profile'->'eco'->'pack'->'goods','{}'::jsonb)-v_good <>
          coalesce(v_profile->'eco'->'pack'->'goods','{}'::jsonb)-v_good OR
        coalesce((p_request->'profile'->'eco'->'pack'->'goods'->>v_good)::numeric,0)-
          coalesce((v_profile->'eco'->'pack'->'goods'->>v_good)::numeric,0)<>v_units THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','budget');
      END IF;
    ELSE
      v_used:=coalesce((v_budget.sell_units_used->>v_good)::numeric,0);
      IF v_units>(v_budget.limits->>'sellUnitsPerTrade')::numeric OR
        v_used+v_units>coalesce((v_budget.limits->'sellUnits'->>v_good)::numeric,0) OR v_profile IS NULL OR
        (p_request->'profile'->>'gold')::numeric-(v_profile->>'gold')::numeric <>
          (v_command->>'expectedTotal')::numeric OR
        (p_request->'profile'->>'gold')::numeric-(v_profile->>'gold')::numeric < 0 OR
        coalesce(p_request->'profile'->'eco'->'pack'->'goods','{}'::jsonb)-v_good <>
          coalesce(v_profile->'eco'->'pack'->'goods','{}'::jsonb)-v_good OR
        coalesce((v_profile->'eco'->'pack'->'goods'->>v_good)::numeric,0)-
          coalesce((p_request->'profile'->'eco'->'pack'->'goods'->>v_good)::numeric,0)<>v_units THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','budget');
      END IF;
    END IF;
  ELSIF v_profile IS NULL OR (p_request->'profile'->>'gold')::numeric<>(v_profile->>'gold')::numeric OR
    coalesce(p_request->'profile'->'eco'->'pack'->'goods','{}'::jsonb) <>
      coalesce(v_profile->'eco'->'pack'->'goods','{}'::jsonb) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','budget');
  END IF;
  v_result:=public.mn_commit_economic_operation(p_operation_id,p_request);
  IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
  IF NOT (v_result ? 'replay') OR v_result->>'replay'='false' THEN
    IF v_ack->>'ok'='true' AND v_command->>'op'='buy' THEN
      UPDATE public.mn_agent_goods_budgets SET buy_gold_used=buy_gold_used+v_cost
        WHERE world=v_world AND character_id=v_character;
    ELSIF v_ack->>'ok'='true' THEN
      UPDATE public.mn_agent_goods_budgets SET sell_units_used=sell_units_used ||
        pg_catalog.jsonb_build_object(v_good,coalesce((sell_units_used->>v_good)::numeric,0)+v_units)
        WHERE world=v_world AND character_id=v_character;
    END IF;
    INSERT INTO public.mn_agent_trade_operations(operation_id,owner_id,world,character_id,budget_id,request,result)
      VALUES(p_operation_id,p_owner_id,v_world,v_character,p_budget_id,p_request,v_result);
  END IF;
  RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_agent_trade_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('request',t.request,'result',t.result,'ownerId',t.owner_id,'budgetId',t.budget_id)
    FROM public.mn_agent_trade_operations t WHERE t.operation_id=p_operation_id
$function$;

CREATE OR REPLACE FUNCTION public.mn_agent_trade_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.to_regclass('public.mn_agent_goods_budgets') IS NULL OR
    pg_catalog.to_regclass('public.mn_agent_trade_operations') IS NULL OR
    NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.mn_agent_goods_budgets'::regclass) OR
    NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.mn_agent_trade_operations'::regclass) OR
    pg_catalog.has_table_privilege('service_role','public.mn_agent_goods_budgets','SELECT,INSERT,UPDATE,DELETE') OR
    pg_catalog.has_table_privilege('service_role','public.mn_agent_trade_operations','SELECT,INSERT,UPDATE,DELETE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_create_agent_goods_budget(text,uuid,uuid,uuid,jsonb)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_agent_goods_budget(text,uuid,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_revoke_agent_goods_budget(text,uuid,uuid,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_commit_agent_trade(uuid,jsonb,uuid,uuid)','EXECUTE') OR
    NOT pg_catalog.has_function_privilege('service_role','public.mn_load_agent_trade_operation(uuid)','EXECUTE') THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_agent_budget_projection(public.mn_agent_goods_budgets),
  public.mn_guard_agent_trade_operation(),
  public.mn_agent_goods_limits_valid(jsonb), public.mn_create_agent_goods_budget(text,uuid,uuid,uuid,jsonb),
  public.mn_load_agent_goods_budget(text,uuid,uuid),public.mn_revoke_agent_goods_budget(text,uuid,uuid,uuid),
  public.mn_commit_agent_trade(uuid,jsonb,uuid,uuid),public.mn_load_agent_trade_operation(uuid),public.mn_agent_trade_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_create_agent_goods_budget(text,uuid,uuid,uuid,jsonb),
  public.mn_load_agent_goods_budget(text,uuid,uuid),public.mn_revoke_agent_goods_budget(text,uuid,uuid,uuid),
  public.mn_commit_agent_trade(uuid,jsonb,uuid,uuid),public.mn_load_agent_trade_operation(uuid),public.mn_agent_trade_ready()
  TO service_role;
COMMIT;

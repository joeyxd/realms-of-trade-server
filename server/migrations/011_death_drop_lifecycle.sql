-- Current-state and atomic lifecycle transitions for persisted ordinary death drops.
-- Apply after 001-010. No hydration, gameplay hooks, clock policy, or death replay seeding.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_death_drop_states (
  operation_id uuid NOT NULL,
  ordinal integer NOT NULL,
  world text NOT NULL CHECK (world ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  victim uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('item','potion')),
  item jsonb NOT NULL,
  ground jsonb NOT NULL CHECK (public.mn_valid_death_ground(ground)),
  state text NOT NULL CHECK (state IN ('ground','picked','expired')),
  version integer NOT NULL CHECK (version IN (1,2)),
  holder uuid,
  transition_operation_id uuid,
  PRIMARY KEY (operation_id, ordinal),
  FOREIGN KEY (operation_id, ordinal) REFERENCES public.mn_death_drops(operation_id, ordinal),
  CHECK ((kind = 'potion' AND item = 'null'::jsonb) OR
    (kind = 'item' AND pg_catalog.jsonb_typeof(item) = 'object')),
  CHECK ((state = 'ground' AND version = 1 AND holder IS NULL AND transition_operation_id IS NULL) OR
    (state = 'picked' AND version = 2 AND holder IS NOT NULL AND transition_operation_id IS NOT NULL) OR
    (state = 'expired' AND version = 2 AND holder IS NULL AND transition_operation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mn_death_drop_states_world_page
  ON public.mn_death_drop_states(world, operation_id, ordinal) WHERE state = 'ground';
ALTER TABLE public.mn_death_drop_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_death_drop_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mn_death_drop_states TO service_role;

CREATE TABLE IF NOT EXISTS public.mn_death_drop_operations (
  operation_id uuid PRIMARY KEY,
  request jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  result jsonb CHECK (result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.mn_death_drop_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_death_drop_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mn_death_drop_operations TO service_role;
ALTER TABLE public.mn_death_drop_states DROP CONSTRAINT IF EXISTS mn_death_drop_states_transition_operation_fk;
ALTER TABLE public.mn_death_drop_states ADD CONSTRAINT mn_death_drop_states_transition_operation_fk
  FOREIGN KEY (transition_operation_id) REFERENCES public.mn_death_drop_operations(operation_id);

CREATE OR REPLACE FUNCTION public.mn_valid_death_drop_request(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_drop jsonb; v_profile jsonb; v_id uuid; v_item jsonb; v_wanted jsonb; v_stats jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT (p_request ?& ARRAY['world','mode','at','drop','profile']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 5 OR
    pg_catalog.jsonb_typeof(p_request->'world') IS DISTINCT FROM 'string' OR
    (p_request->>'world') !~ '^[a-zA-Z0-9:_-]{1,100}$' OR
    pg_catalog.jsonb_typeof(p_request->'mode') IS DISTINCT FROM 'string' OR
    p_request->>'mode' NOT IN ('pickup','expire') OR
    NOT public.mn_death_int(p_request->'at',0,9007199254740991) THEN RETURN false; END IF;
  v_drop := p_request->'drop';
  IF pg_catalog.jsonb_typeof(v_drop) IS DISTINCT FROM 'object' OR
    NOT (v_drop ?& ARRAY['operationId','ordinal','expectedVersion','world','victim','kind','item','ground']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_drop)) <> 8 OR
    pg_catalog.jsonb_typeof(v_drop->'operationId') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(v_drop->'victim') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(v_drop->'world') IS DISTINCT FROM 'string' OR
    v_drop->>'world' IS DISTINCT FROM p_request->>'world' OR
    NOT public.mn_death_int(v_drop->'ordinal',1,35) OR
    NOT public.mn_death_int(v_drop->'expectedVersion',1,2147483646) OR
    pg_catalog.jsonb_typeof(v_drop->'kind') IS DISTINCT FROM 'string' OR
    v_drop->>'kind' NOT IN ('item','potion') OR
    NOT public.mn_valid_death_ground(v_drop->'ground') OR
    (v_drop->>'kind' = 'potion' AND v_drop->'item' IS DISTINCT FROM 'null'::jsonb) OR
    (v_drop->>'kind' = 'item' AND pg_catalog.jsonb_typeof(v_drop->'item') IS DISTINCT FROM 'object') THEN RETURN false; END IF;
  IF v_drop->>'operationId' IS DISTINCT FROM ((v_drop->>'operationId')::uuid)::text OR
    v_drop->>'victim' IS DISTINCT FROM ((v_drop->>'victim')::uuid)::text THEN RETURN false; END IF;
  IF p_request->>'mode' = 'expire' THEN RETURN p_request->'profile' = 'null'::jsonb; END IF;

  v_profile := p_request->'profile';
  IF pg_catalog.jsonb_typeof(v_profile) IS DISTINCT FROM 'object' OR
    NOT (v_profile ?& ARRAY['id','expectedVersion','before','data']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_profile)) <> 4 OR
    pg_catalog.jsonb_typeof(v_profile->'id') IS DISTINCT FROM 'string' OR
    NOT public.mn_death_int(v_profile->'expectedVersion',1,2147483646) OR
    pg_catalog.jsonb_typeof(v_profile->'before') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(v_profile->'data') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(v_profile->'before'->'v') IS DISTINCT FROM 'number' OR
    v_profile->'before'->'v' IS DISTINCT FROM '1'::jsonb OR
    pg_catalog.jsonb_typeof(v_profile->'data'->'v') IS DISTINCT FROM 'number' OR
    v_profile->'data'->'v' IS DISTINCT FROM '1'::jsonb OR
    pg_catalog.octet_length((v_profile->'before')::text) > 131072 OR
    pg_catalog.octet_length((v_profile->'data')::text) > 131072 THEN RETURN false; END IF;
  v_id := (v_profile->>'id')::uuid;
  IF v_profile->>'id' IS DISTINCT FROM v_id::text OR
    v_profile->'before'->>'pirateId' IS DISTINCT FROM 'account:' || v_id::text THEN RETURN false; END IF;
  IF p_request->>'mode' = 'pickup' AND
    ((v_drop->>'kind' = 'item' AND (
      pg_catalog.jsonb_typeof(v_profile->'before'->'bag') IS DISTINCT FROM 'array' OR
      pg_catalog.jsonb_array_length(v_profile->'before'->'bag') >= 24 OR
      NOT public.mn_death_int(v_profile->'before'->'uid',1,2147483646) OR
      NOT public.mn_death_int(v_profile->'before'->'stats'->'items',0,999999999) OR
      pg_catalog.jsonb_typeof(v_drop->'item'->'u') IS DISTINCT FROM 'number' OR
      NOT public.mn_death_int(v_drop->'item'->'u',1,2147483646))) OR
     (v_drop->>'kind' = 'potion' AND NOT public.mn_death_int(v_profile->'before'->'pot',0,4))) THEN
    RETURN false;
  END IF;
  v_wanted := v_profile->'before';
  IF v_drop->>'kind' = 'item' THEN
    v_item := pg_catalog.jsonb_set(v_drop->'item','{u}',v_profile->'before'->'uid',true);
    IF pg_catalog.jsonb_typeof(v_profile->'before'->'bag') IS DISTINCT FROM 'array' OR
      pg_catalog.jsonb_array_length(v_profile->'before'->'bag') >= 24 OR
      NOT public.mn_death_int(v_profile->'before'->'uid',1,2147483646) OR
      NOT public.mn_death_int(v_profile->'before'->'stats'->'items',0,999999999) THEN RETURN false; END IF;
    v_wanted := pg_catalog.jsonb_set(v_wanted,'{bag}',(v_profile->'before'->'bag') || pg_catalog.jsonb_build_array(v_item),true);
    v_wanted := pg_catalog.jsonb_set(v_wanted,'{uid}',pg_catalog.to_jsonb((v_profile->'before'->>'uid')::bigint + 1),true);
    v_stats := pg_catalog.jsonb_set(v_profile->'before'->'stats','{items}',
      pg_catalog.to_jsonb((v_profile->'before'->'stats'->>'items')::bigint + 1),true);
    v_wanted := pg_catalog.jsonb_set(v_wanted,'{stats}',v_stats,true);
  ELSE
    IF NOT public.mn_death_int(v_profile->'before'->'pot',0,4) THEN RETURN false; END IF;
    v_wanted := pg_catalog.jsonb_set(v_wanted,'{pot}',pg_catalog.to_jsonb((v_profile->'before'->>'pot')::integer + 1),true);
  END IF;
  RETURN v_wanted = v_profile->'data';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN RETURN false;
END
$function$;

-- Every lifecycle receipt shares 003-010's operation UUID namespace. Separate triggers preserve
-- the installed family logic while also catching legacy UPDATEs and direct service writes.
CREATE OR REPLACE FUNCTION public.mn_guard_death_drop_operation_family()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'unsupported death drop isolation' USING ERRCODE = 'MNP02';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || NEW.operation_id::text,0));
  IF TG_TABLE_NAME = 'mn_death_drop_operations' THEN
    IF EXISTS (SELECT 1 FROM public.mn_pearl_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_ground_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_batch_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_death_operations WHERE operation_id = NEW.operation_id) OR
      EXISTS (SELECT 1 FROM public.mn_pearl_intents WHERE operation_id = NEW.operation_id) THEN
      RAISE EXCEPTION 'death drop operation UUID collision' USING ERRCODE = 'MNP02';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.result IS NOT NULL OR NOT public.mn_valid_death_drop_request(NEW.request) THEN
        RAISE EXCEPTION 'invalid death drop receipt' USING ERRCODE = 'MNP02';
      END IF;
    ELSIF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.request IS DISTINCT FROM OLD.request OR
      OLD.result IS NOT NULL OR NEW.result IS NULL THEN
      RAISE EXCEPTION 'immutable death drop receipt' USING ERRCODE = 'MNP02';
    ELSE NEW.created_at := OLD.created_at;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.mn_death_drop_operations WHERE operation_id = NEW.operation_id) THEN
    RAISE EXCEPTION 'operation belongs to death drop lifecycle' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_drop_family ON public.mn_death_drop_operations;
CREATE TRIGGER mn_death_drop_family BEFORE INSERT OR UPDATE ON public.mn_death_drop_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_operation_family();
DROP TRIGGER IF EXISTS mn_death_drop_family ON public.mn_pearl_operations;
CREATE TRIGGER mn_death_drop_family BEFORE INSERT OR UPDATE ON public.mn_pearl_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_operation_family();
DROP TRIGGER IF EXISTS mn_death_drop_family ON public.mn_pearl_ground_operations;
CREATE TRIGGER mn_death_drop_family BEFORE INSERT OR UPDATE ON public.mn_pearl_ground_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_operation_family();
DROP TRIGGER IF EXISTS mn_death_drop_family ON public.mn_pearl_batch_operations;
CREATE TRIGGER mn_death_drop_family BEFORE INSERT OR UPDATE ON public.mn_pearl_batch_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_operation_family();
DROP TRIGGER IF EXISTS mn_death_drop_family ON public.mn_death_operations;
CREATE TRIGGER mn_death_drop_family BEFORE INSERT OR UPDATE ON public.mn_death_operations
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_operation_family();
DROP TRIGGER IF EXISTS mn_death_drop_family ON public.mn_pearl_intents;
CREATE TRIGGER mn_death_drop_family BEFORE INSERT OR UPDATE ON public.mn_pearl_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_operation_family();

CREATE OR REPLACE FUNCTION public.mn_guard_death_drop_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_death public.mn_death_operations%ROWTYPE; v_op public.mn_death_drop_operations%ROWTYPE;
  v_source public.mn_death_drops%ROWTYPE; v_drop jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'death drop state is retained' USING ERRCODE = 'MNP02'; END IF;
  SELECT * INTO v_source FROM public.mn_death_drops WHERE operation_id = NEW.operation_id AND ordinal = NEW.ordinal;
  IF NOT FOUND OR v_source.world IS DISTINCT FROM NEW.world OR v_source.victim IS DISTINCT FROM NEW.victim OR
    v_source.kind IS DISTINCT FROM NEW.kind OR v_source.item IS DISTINCT FROM NEW.item OR v_source.ground IS DISTINCT FROM NEW.ground THEN
    RAISE EXCEPTION 'death drop state source mismatch' USING ERRCODE = 'MNP02';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_death FROM public.mn_death_operations WHERE operation_id = NEW.operation_id;
    IF NOT FOUND OR v_death.result IS NOT NULL OR NEW.state <> 'ground' OR NEW.version <> 1 OR
      NEW.holder IS NOT NULL OR NEW.transition_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid initial death drop state' USING ERRCODE = 'MNP02';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'ground' OR OLD.version <> 1 OR NEW.version <> 2 OR
    NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.ordinal IS DISTINCT FROM OLD.ordinal OR
    NEW.world IS DISTINCT FROM OLD.world OR NEW.victim IS DISTINCT FROM OLD.victim OR
    NEW.kind IS DISTINCT FROM OLD.kind OR NEW.item IS DISTINCT FROM OLD.item OR NEW.ground IS DISTINCT FROM OLD.ground OR
    NEW.transition_operation_id IS NULL OR NEW.state NOT IN ('picked','expired') OR
    (NEW.state = 'picked' AND NEW.holder IS NULL) OR (NEW.state = 'expired' AND NEW.holder IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid death drop transition' USING ERRCODE = 'MNP02';
  END IF;
  SELECT * INTO v_op FROM public.mn_death_drop_operations WHERE operation_id = NEW.transition_operation_id;
  IF NOT FOUND OR v_op.result IS NOT NULL OR NOT public.mn_valid_death_drop_request(v_op.request) THEN
    RAISE EXCEPTION 'missing provisional drop operation' USING ERRCODE = 'MNP02';
  END IF;
  v_drop := v_op.request->'drop';
  IF (v_op.request->>'mode' = 'pickup') <> (NEW.state = 'picked') OR
    v_drop->>'operationId' IS DISTINCT FROM NEW.operation_id::text OR
    (v_drop->>'ordinal')::integer <> NEW.ordinal OR
    (v_drop->>'expectedVersion')::integer <> OLD.version OR
    v_drop->>'world' IS DISTINCT FROM OLD.world OR v_drop->>'victim' IS DISTINCT FROM OLD.victim::text OR
    v_drop->>'kind' IS DISTINCT FROM OLD.kind OR v_drop->'item' IS DISTINCT FROM OLD.item OR
    v_drop->'ground' IS DISTINCT FROM OLD.ground OR
    (NEW.state = 'picked' AND NEW.holder IS DISTINCT FROM (v_op.request->'profile'->>'id')::uuid) THEN
    RAISE EXCEPTION 'drop transition receipt mismatch' USING ERRCODE = 'MNP02';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_drop_state_guard ON public.mn_death_drop_states;
CREATE TRIGGER mn_death_drop_state_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mn_death_drop_states
  FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_state();

CREATE OR REPLACE FUNCTION public.mn_seed_death_drop_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  SELECT result INTO v_result FROM public.mn_death_operations WHERE operation_id = NEW.operation_id;
  IF NOT FOUND OR v_result IS NOT NULL THEN
    RAISE EXCEPTION 'death drop seed outside provisional receipt' USING ERRCODE = 'MNP02';
  END IF;
  INSERT INTO public.mn_death_drop_states(operation_id,ordinal,world,victim,kind,item,ground,state,version,holder,transition_operation_id)
  VALUES (NEW.operation_id,NEW.ordinal,NEW.world,NEW.victim,NEW.kind,NEW.item,NEW.ground,'ground',1,NULL,NULL);
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_drop_seed ON public.mn_death_drops;
CREATE TRIGGER mn_death_drop_seed AFTER INSERT ON public.mn_death_drops
  FOR EACH ROW EXECUTE FUNCTION public.mn_seed_death_drop_state();

CREATE OR REPLACE FUNCTION public.mn_assert_death_drop_complete(p_operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_drop jsonb; v_profile jsonb; v_data jsonb; v_version integer;
  v_state public.mn_death_drop_states%ROWTYPE; v_profiles jsonb := '[]'::jsonb;
  v_out jsonb; v_holder uuid; v_state_name text;
BEGIN
  SELECT request,result INTO v_request,v_result FROM public.mn_death_drop_operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_result IS NULL OR NOT public.mn_valid_death_drop_request(v_request) THEN
    RAISE EXCEPTION 'incomplete death drop receipt' USING ERRCODE = 'MNP02';
  END IF;
  v_drop := v_request->'drop';
  SELECT * INTO v_state FROM public.mn_death_drop_states
    WHERE operation_id = (v_drop->>'operationId')::uuid AND ordinal = (v_drop->>'ordinal')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing current death drop' USING ERRCODE = 'MNP02'; END IF;
  IF v_request->>'mode' = 'pickup' THEN
    v_profile := v_request->'profile';
    SELECT data,version INTO v_data,v_version FROM public.mn_profiles WHERE player_id = (v_profile->>'id')::uuid;
    IF NOT FOUND OR v_data IS DISTINCT FROM v_profile->'data' OR
      v_version <> (v_profile->>'expectedVersion')::integer + 1 THEN
      RAISE EXCEPTION 'incomplete drop pickup profile' USING ERRCODE = 'MNC01';
    END IF;
    v_profiles := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_profile->>'id','version',v_version));
    v_holder := (v_profile->>'id')::uuid; v_state_name := 'picked';
  ELSE v_holder := NULL; v_state_name := 'expired'; END IF;
  IF v_state.operation_id IS DISTINCT FROM (v_drop->>'operationId')::uuid OR
    v_state.ordinal <> (v_drop->>'ordinal')::integer OR v_state.world IS DISTINCT FROM v_drop->>'world' OR
    v_state.victim::text IS DISTINCT FROM v_drop->>'victim' OR v_state.kind IS DISTINCT FROM v_drop->>'kind' OR
    v_state.item IS DISTINCT FROM v_drop->'item' OR v_state.ground IS DISTINCT FROM v_drop->'ground' THEN
    RAISE EXCEPTION 'death drop completion metadata mismatch' USING ERRCODE = 'MNP02';
  END IF;
  IF v_request->>'mode' = 'pickup' AND
    ((v_request->>'at')::numeric < (v_state.ground->>'availableAt')::numeric OR
     (v_request->>'at')::numeric > (v_state.ground->>'expiresAt')::numeric) THEN
    RAISE EXCEPTION 'death drop completion pickup outside window' USING ERRCODE = 'MNP01';
  ELSIF v_request->>'mode' = 'expire' AND
    (v_request->>'at')::numeric <= (v_state.ground->>'expiresAt')::numeric THEN
    RAISE EXCEPTION 'death drop completion expiry not reached' USING ERRCODE = 'MNP01';
  END IF;
  IF v_state.state IS DISTINCT FROM v_state_name OR v_state.version <> 2 OR
    v_state.holder IS DISTINCT FROM v_holder OR v_state.transition_operation_id IS DISTINCT FROM p_operation_id THEN
    RAISE EXCEPTION 'incomplete current death drop' USING ERRCODE = 'MNP02';
  END IF;
  v_out := pg_catalog.jsonb_build_object('operationId',v_state.operation_id,'ordinal',v_state.ordinal,'world',v_state.world,
    'victim',v_state.victim,'kind',v_state.kind,'item',v_state.item,'ground',v_state.ground,
    'state',v_state.state,'version',v_state.version,'holder',v_state.holder,'transitionOperationId',v_state.transition_operation_id);
  IF v_result IS DISTINCT FROM pg_catalog.jsonb_build_object('ok',true,'replay',false,'profiles',v_profiles,'drop',v_out) THEN
    RAISE EXCEPTION 'death drop result mismatch' USING ERRCODE = 'MNP02';
  END IF;
END
$function$;
CREATE OR REPLACE FUNCTION public.mn_guard_death_drop_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  PERFORM public.mn_assert_death_drop_complete(NEW.operation_id); RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS mn_death_drop_complete ON public.mn_death_drop_operations;
CREATE CONSTRAINT TRIGGER mn_death_drop_complete AFTER INSERT OR UPDATE ON public.mn_death_drop_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mn_guard_death_drop_complete();

CREATE OR REPLACE FUNCTION public.mn_commit_death_drop(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_request jsonb; v_result jsonb; v_old jsonb; v_version integer; v_profile jsonb; v_data jsonb;
  v_uid text; v_drop jsonb; v_state public.mn_death_drop_states%ROWTYPE; v_holder uuid;
  v_state_name text; v_profiles jsonb := '[]'::jsonb; v_out jsonb; v_at numeric;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR p_operation_id IS NULL OR
    pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT public.mn_valid_death_drop_request(p_request) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl-op:' || p_operation_id::text,0));
  SELECT request,result INTO v_request,v_result FROM public.mn_death_drop_operations
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_request IS DISTINCT FROM p_request OR v_result IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
    END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  INSERT INTO public.mn_death_drop_operations(operation_id,request) VALUES (p_operation_id,p_request);
  v_drop := p_request->'drop'; v_at := (p_request->>'at')::numeric;
  IF p_request->>'mode' = 'pickup' THEN
    v_profile := p_request->'profile';
    SELECT data,version INTO v_old,v_version FROM public.mn_profiles WHERE player_id = (v_profile->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_version <> (v_profile->>'expectedVersion')::integer OR v_old IS DISTINCT FROM v_profile->'before' THEN
      RAISE EXCEPTION 'drop profile conflict' USING ERRCODE = 'MNC01';
    END IF;
    FOR v_uid IN SELECT q->>'uid' FROM public.mn_profile_pearls(v_profile->'before') AS q
      UNION SELECT q->>'uid' FROM public.mn_profile_pearls(v_profile->'data') AS q ORDER BY 1
    LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-pearl:' || v_uid,0)); END LOOP;
  END IF;
  SELECT * INTO v_state FROM public.mn_death_drop_states
    WHERE operation_id = (v_drop->>'operationId')::uuid AND ordinal = (v_drop->>'ordinal')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing death drop state' USING ERRCODE = 'MNC01'; END IF;
  IF v_state.version <> (v_drop->>'expectedVersion')::integer THEN
    RAISE EXCEPTION 'drop state version conflict' USING ERRCODE = 'MNC01';
  END IF;
  IF v_state.world IS DISTINCT FROM v_drop->>'world' OR
    v_state.victim::text IS DISTINCT FROM v_drop->>'victim' OR v_state.kind IS DISTINCT FROM v_drop->>'kind' OR
    v_state.item IS DISTINCT FROM v_drop->'item' OR v_state.ground IS DISTINCT FROM v_drop->'ground' THEN
    RAISE EXCEPTION 'drop state metadata mismatch' USING ERRCODE = 'MNP01';
  END IF;
  IF v_state.state <> 'ground' THEN RAISE EXCEPTION 'drop is no longer ground' USING ERRCODE = 'MNC01'; END IF;
  IF p_request->>'mode' = 'pickup' THEN
    IF v_at < (v_state.ground->>'availableAt')::numeric OR v_at > (v_state.ground->>'expiresAt')::numeric THEN
      RAISE EXCEPTION 'drop pickup outside window' USING ERRCODE = 'MNP01';
    END IF;
    UPDATE public.mn_profiles SET data = v_profile->'data', version = v_version + 1, updated_at = pg_catalog.now()
      WHERE player_id = (v_profile->>'id')::uuid AND version = v_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'drop profile conflict' USING ERRCODE = 'MNC01'; END IF;
    v_holder := (v_profile->>'id')::uuid; v_state_name := 'picked';
    v_profiles := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_holder,'version',v_version + 1));
  ELSE
    IF v_at <= (v_state.ground->>'expiresAt')::numeric THEN RAISE EXCEPTION 'drop expiry not reached' USING ERRCODE = 'MNP01'; END IF;
    v_holder := NULL; v_state_name := 'expired';
  END IF;
  UPDATE public.mn_death_drop_states SET state = v_state_name,version = 2,holder = v_holder,
    transition_operation_id = p_operation_id WHERE operation_id = v_state.operation_id AND ordinal = v_state.ordinal;
  v_out := pg_catalog.jsonb_build_object('operationId',v_state.operation_id,'ordinal',v_state.ordinal,'world',v_state.world,
    'victim',v_state.victim,'kind',v_state.kind,'item',v_state.item,'ground',v_state.ground,
    'state',v_state_name,'version',2,'holder',v_holder,'transitionOperationId',p_operation_id);
  v_result := pg_catalog.jsonb_build_object('ok',true,'replay',false,'profiles',v_profiles,'drop',v_out);
  UPDATE public.mn_death_drop_operations SET result = v_result WHERE operation_id = p_operation_id;
  PERFORM public.mn_assert_death_drop_complete(p_operation_id);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'MNC01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  WHEN SQLSTATE 'MNP01' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','ownership');
  WHEN SQLSTATE 'MNP02' OR invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_death_drop_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid death drop operation ID' USING ERRCODE = 'MNP02'; END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('request',request,'result',result)
    FROM public.mn_death_drop_operations WHERE operation_id = p_operation_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_load_death_drop(p_operation_id uuid, p_ordinal integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_row public.mn_death_drop_states%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR p_ordinal IS NULL OR p_ordinal < 1 OR p_ordinal > 35 THEN
    RAISE EXCEPTION 'invalid death drop key' USING ERRCODE = 'MNP02';
  END IF;
  SELECT * INTO v_row FROM public.mn_death_drop_states WHERE operation_id = p_operation_id AND ordinal = p_ordinal;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object('operationId',v_row.operation_id,'ordinal',v_row.ordinal,'world',v_row.world,
    'victim',v_row.victim,'kind',v_row.kind,'item',v_row.item,'ground',v_row.ground,'state',v_row.state,
    'version',v_row.version,'holder',v_row.holder,'transitionOperationId',v_row.transition_operation_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_list_current_death_drops(p_world text,p_after_operation_id uuid,p_after_ordinal integer,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF p_world IS NULL OR p_world !~ '^[a-zA-Z0-9:_-]{1,100}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 256 OR
    (p_after_operation_id IS NULL) <> (p_after_ordinal IS NULL) OR
    (p_after_ordinal IS NOT NULL AND (p_after_ordinal < 1 OR p_after_ordinal > 35)) THEN
    RAISE EXCEPTION 'invalid current death drop page' USING ERRCODE = 'MNP02';
  END IF;
  RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operationId',q.operation_id,
    'ordinal',q.ordinal,'world',q.world,'victim',q.victim,'kind',q.kind,'item',q.item,'ground',q.ground,
    'state',q.state,'version',q.version,'holder',q.holder,'transitionOperationId',q.transition_operation_id)
    ORDER BY q.operation_id,q.ordinal),'[]'::jsonb)
    FROM (SELECT * FROM public.mn_death_drop_states WHERE world = p_world AND state = 'ground' AND
      (p_after_operation_id IS NULL OR (operation_id,ordinal) > (p_after_operation_id,p_after_ordinal))
      ORDER BY operation_id,ordinal LIMIT p_limit) AS q);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_death_drop_request(jsonb), public.mn_guard_death_drop_operation_family(),
  public.mn_guard_death_drop_state(), public.mn_seed_death_drop_state(), public.mn_assert_death_drop_complete(uuid),
  public.mn_guard_death_drop_complete(), public.mn_commit_death_drop(uuid,jsonb),
  public.mn_load_death_drop_operation(uuid), public.mn_load_death_drop(uuid,integer),
  public.mn_list_current_death_drops(text,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_valid_death_drop_request(jsonb), public.mn_guard_death_drop_operation_family(),
  public.mn_guard_death_drop_state(), public.mn_seed_death_drop_state(), public.mn_assert_death_drop_complete(uuid),
  public.mn_guard_death_drop_complete(), public.mn_commit_death_drop(uuid,jsonb),
  public.mn_load_death_drop_operation(uuid), public.mn_load_death_drop(uuid,integer),
  public.mn_list_current_death_drops(text,uuid,integer,integer) TO service_role;
COMMIT;

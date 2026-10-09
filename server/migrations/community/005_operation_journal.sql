-- Optional durable idempotency journal for scoped character operations.
-- Apply after community migrations 001-004. The journal is bounded to one pending
-- operation per character; completed rows remain immutable receipts.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_comm_operation_intents (
  operation_id uuid PRIMARY KEY,
  world_id text NOT NULL,
  world_epoch uuid NOT NULL,
  character_id uuid NOT NULL,
  account_id uuid NOT NULL,
  intent jsonb NOT NULL,
  result jsonb,
  CHECK (operation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CHECK (world_epoch <> '00000000-0000-0000-0000-000000000000'::uuid),
  CHECK (character_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CHECK (account_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CHECK (public.mn_comm_key(pg_catalog.to_jsonb(world_id)))
);
CREATE UNIQUE INDEX IF NOT EXISTS mn_comm_one_pending_operation_per_character
  ON public.mn_comm_operation_intents(world_id,world_epoch,character_id) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS mn_comm_pending_operation_world_page
  ON public.mn_comm_operation_intents(world_id,world_epoch,operation_id) WHERE result IS NULL;
ALTER TABLE public.mn_comm_operation_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_comm_operation_intents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_comm_operation_intents TO service_role;

CREATE OR REPLACE FUNCTION public.mn_comm_operation_intent_valid(p_intent jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v_binding jsonb; v_request jsonb; v_kind text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR
     NOT (p_intent ?& ARRAY['operationId','binding','kind','request']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_intent)) <> 4 OR
     NOT public.mn_comm_uuid(p_intent->'operationId') THEN RETURN false; END IF;
  v_binding := p_intent->'binding'; v_kind := p_intent->>'kind'; v_request := p_intent->'request';
  IF NOT public.mn_comm_valid_binding(v_binding) OR (v_kind IS DISTINCT FROM 'save' AND v_kind IS DISTINCT FROM 'contribution') THEN RETURN false; END IF;
  IF v_kind = 'save' THEN
    RETURN public.mn_comm_valid_character(v_request) AND
      public.mn_comm_int(v_request->'version',1,2147483646) AND
      v_request->>'worldId' = v_binding->>'worldId' AND v_request->>'worldEpoch' = v_binding->>'worldEpoch' AND
      v_request->>'characterId' = v_binding->>'characterId';
  END IF;
  RETURN public.mn_comm_valid_request(v_request) AND v_request->>'operationId' = p_intent->>'operationId' AND
    v_request->>'worldId' = v_binding->>'worldId' AND v_request->>'worldEpoch' = v_binding->>'worldEpoch' AND
    v_request->>'characterId' = v_binding->>'characterId';
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_operation_row_valid(p_row jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
BEGIN
  RETURN public.mn_comm_operation_intent_valid(p_row->'intent') AND
    p_row->>'operation_id' = p_row->'intent'->>'operationId' AND
    p_row->>'world_id' = p_row->'intent'->'binding'->>'worldId' AND
    p_row->>'world_epoch' = p_row->'intent'->'binding'->>'worldEpoch' AND
    p_row->>'character_id' = p_row->'intent'->'binding'->>'characterId' AND
    p_row->>'account_id' = p_row->'intent'->'binding'->>'accountId' AND
    (p_row->'result' = 'null'::jsonb OR pg_catalog.jsonb_typeof(p_row->'result') = 'object') IS TRUE;
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_operation_result_valid(p_intent jsonb,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v_character jsonb; v_project jsonb; v_why text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_result->'ok') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF p_result->'ok'='false'::jsonb THEN
    v_why:=p_result->>'why';
    IF p_intent->>'kind'='save' THEN
      RETURN (SELECT pg_catalog.count(*)=2 FROM pg_catalog.jsonb_object_keys(p_result)) AND p_result ?& ARRAY['ok','why']
        AND v_why=ANY(ARRAY['missing','conflict']);
    END IF;
    RETURN (SELECT pg_catalog.count(*)=3 FROM pg_catalog.jsonb_object_keys(p_result)) AND p_result ?& ARRAY['ok','why','replay']
      AND v_why=ANY(ARRAY['missing','conflict','material','complete','goods']) AND p_result->'replay'='false'::jsonb;
  END IF;
  v_character:=p_result->'character';
  IF NOT public.mn_comm_valid_character(v_character) OR
    v_character->>'worldId' IS DISTINCT FROM p_intent->'binding'->>'worldId' OR
    v_character->>'worldEpoch' IS DISTINCT FROM p_intent->'binding'->>'worldEpoch' OR
    v_character->>'characterId' IS DISTINCT FROM p_intent->'binding'->>'characterId' THEN RETURN false; END IF;
  IF p_intent->>'kind'='save' THEN
    RETURN (SELECT pg_catalog.count(*)=2 FROM pg_catalog.jsonb_object_keys(p_result)) AND p_result ?& ARRAY['ok','character'] AND
      (v_character->>'version')::numeric=(p_intent->'request'->>'version')::numeric+1 AND
      v_character->'data' IS NOT DISTINCT FROM p_intent->'request'->'data';
  END IF;
  v_project:=p_result->'project';
  RETURN (SELECT pg_catalog.count(*)=5 FROM pg_catalog.jsonb_object_keys(p_result)) AND
    p_result ?& ARRAY['ok','replay','accepted','character','project'] AND p_result->'replay'='false'::jsonb AND
    public.mn_comm_int(p_result->'accepted',1,1000000) AND
    (p_result->'accepted')::text::numeric <= (p_intent->'request'->>'amount')::numeric AND
    public.mn_comm_valid_project(v_project) AND
    v_project->>'worldId'=p_intent->'binding'->>'worldId' AND v_project->>'worldEpoch'=p_intent->'binding'->>'worldEpoch' AND
    v_project->>'projectId'=p_intent->'request'->>'projectId' AND
    (v_character->>'version')::numeric=(p_intent->'request'->>'expectedCharacterVersion')::numeric+1 AND
    (v_project->>'version')::numeric=(p_intent->'request'->>'expectedProjectVersion')::numeric+1;
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_operation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'community operation journal is append only' USING ERRCODE='CMI02'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF public.mn_comm_operation_row_valid(pg_catalog.to_jsonb(NEW)) IS NOT TRUE OR NEW.result IS NOT NULL THEN
      RAISE EXCEPTION 'invalid community operation intent' USING ERRCODE='CMI01'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.operation_id,NEW.world_id,NEW.world_epoch,NEW.character_id,NEW.account_id,NEW.intent)
       IS DISTINCT FROM ROW(OLD.operation_id,OLD.world_id,OLD.world_epoch,OLD.character_id,OLD.account_id,OLD.intent)
     OR OLD.result IS NOT NULL OR NEW.result IS NULL
     OR public.mn_comm_operation_result_valid(NEW.intent,NEW.result) IS NOT TRUE THEN
    RAISE EXCEPTION 'community operation result is immutable' USING ERRCODE='CMI02';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS mn_comm_operation_guard ON public.mn_comm_operation_intents;
CREATE TRIGGER mn_comm_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mn_comm_operation_intents
  FOR EACH ROW EXECUTE FUNCTION public.mn_comm_operation_guard();

-- Keep the shared UUID namespace safe in both insertion orders.
CREATE OR REPLACE FUNCTION public.mn_comm_contribution_operation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
DECLARE v_intent jsonb;
BEGIN
  SELECT intent INTO v_intent FROM public.mn_comm_operation_intents WHERE operation_id = NEW.operation_id;
  IF FOUND AND (v_intent->>'kind' <> 'contribution' OR v_intent->'request' IS DISTINCT FROM NEW.request) THEN
    RAISE EXCEPTION 'community operation UUID collision' USING ERRCODE='CMI02';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS mn_comm_contribution_operation_guard ON public.mn_comm_contributions;
CREATE TRIGGER mn_comm_contribution_operation_guard BEFORE INSERT OR UPDATE ON public.mn_comm_contributions
  FOR EACH ROW EXECUTE FUNCTION public.mn_comm_contribution_operation_guard();

CREATE OR REPLACE FUNCTION public.mn_comm_operation_entry(p_operation_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path = '' AS $f$
  SELECT pg_catalog.jsonb_build_object('intent',intent,
    'state',CASE WHEN result IS NULL THEN 'pending' ELSE 'complete' END,'result',result)
    FROM public.mn_comm_operation_intents WHERE operation_id=p_operation_id;
$f$;

CREATE OR REPLACE FUNCTION public.mn_comm_prepare_operation(p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_id uuid; v_world text; v_epoch uuid; v_char uuid; v_account uuid;
  v_old public.mn_comm_operation_intents%ROWTYPE; v_binding jsonb; v_character_found boolean;
  v_receipt_request jsonb; v_receipt_result jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR public.mn_comm_operation_intent_valid(p_intent) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid community operation intent' USING ERRCODE='CMI01'; END IF;
  v_id := (p_intent->>'operationId')::uuid; v_binding := p_intent->'binding';
  v_world := v_binding->>'worldId'; v_epoch := (v_binding->>'worldEpoch')::uuid;
  v_char := (v_binding->>'characterId')::uuid; v_account := (v_binding->>'accountId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-op:'||v_id::text,0));
  SELECT * INTO v_old FROM public.mn_comm_operation_intents WHERE operation_id=v_id FOR UPDATE;
  IF FOUND THEN
    IF v_old.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'community operation UUID conflict' USING ERRCODE='CMI02'; END IF;
    RETURN public.mn_comm_operation_entry(v_id);
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-char:'||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_char::text)::text,0));
  SELECT pg_catalog.jsonb_build_object('accountId',account_id,'worldId',world_id,'worldEpoch',world_epoch,'characterId',character_id)
    INTO v_binding FROM public.mn_comm_character_bindings
    WHERE account_id=v_account AND world_id=v_world AND world_epoch=v_epoch;
  IF v_binding IS DISTINCT FROM p_intent->'binding' THEN RAISE EXCEPTION 'community operation binding mismatch' USING ERRCODE='CMI02'; END IF;
  PERFORM 1 FROM public.mn_comm_characters WHERE world_id=v_world AND world_epoch=v_epoch AND character_id=v_char;
  v_character_found := FOUND;
  IF NOT v_character_found THEN RAISE EXCEPTION 'community operation character missing' USING ERRCODE='CMI02'; END IF;
  IF EXISTS (SELECT 1 FROM public.mn_comm_operation_intents WHERE world_id=v_world AND world_epoch=v_epoch AND character_id=v_char AND result IS NULL) THEN
    RAISE EXCEPTION 'community character already has a pending operation' USING ERRCODE='CMI02'; END IF;
  IF p_intent->>'kind'='contribution' THEN
    SELECT request,result INTO v_receipt_request,v_receipt_result FROM public.mn_comm_contributions WHERE operation_id=v_id;
    IF FOUND AND v_receipt_request IS DISTINCT FROM p_intent->'request' THEN RAISE EXCEPTION 'community operation UUID conflict' USING ERRCODE='CMI02'; END IF;
    IF FOUND THEN
      INSERT INTO public.mn_comm_operation_intents(operation_id,world_id,world_epoch,character_id,account_id,intent)
        VALUES(v_id,v_world,v_epoch,v_char,v_account,p_intent);
      UPDATE public.mn_comm_operation_intents SET result=v_receipt_result || pg_catalog.jsonb_build_object('replay',false)
        WHERE operation_id=v_id;
      RETURN public.mn_comm_operation_entry(v_id);
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.mn_comm_contributions WHERE operation_id=v_id) THEN
      RAISE EXCEPTION 'community operation UUID conflict' USING ERRCODE='CMI02';
    END IF;
  END IF;
  INSERT INTO public.mn_comm_operation_intents(operation_id,world_id,world_epoch,character_id,account_id,intent)
    VALUES(v_id,v_world,v_epoch,v_char,v_account,p_intent);
  RETURN public.mn_comm_operation_entry(v_id);
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_commit_operation(p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_id uuid; v_entry jsonb; v_binding jsonb; v_world text; v_epoch uuid; v_char uuid; v_result jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR public.mn_comm_operation_intent_valid(p_intent) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid community operation intent' USING ERRCODE='CMI01'; END IF;
  v_id := (p_intent->>'operationId')::uuid; v_binding := p_intent->'binding';
  v_world := v_binding->>'worldId'; v_epoch := (v_binding->>'worldEpoch')::uuid; v_char := (v_binding->>'characterId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-op:'||v_id::text,0));
  SELECT public.mn_comm_operation_entry(v_id) INTO v_entry;
  IF v_entry IS NULL OR v_entry->'intent' IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'community operation is not prepared' USING ERRCODE='CMI02'; END IF;
  IF v_entry->>'state'='complete' THEN RETURN v_entry; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-char:'||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_char::text)::text,0));
  IF p_intent->>'kind'='save' THEN v_result := public.mn_comm_save_character(p_intent->'request');
  ELSE
    v_result := public.mn_comm_commit_contribution(p_intent->'request');
    v_result := v_result || pg_catalog.jsonb_build_object('replay',false);
  END IF;
  IF public.mn_comm_operation_result_valid(p_intent,v_result) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid community operation result' USING ERRCODE='CMI01'; END IF;
  UPDATE public.mn_comm_operation_intents SET result=v_result WHERE operation_id=v_id AND result IS NULL;
  RETURN public.mn_comm_operation_entry(v_id);
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_load_operation(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  IF p_operation_id IS NULL OR p_operation_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'invalid community operation UUID' USING ERRCODE='CMI01'; END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('intent',intent,
    'state',CASE WHEN result IS NULL THEN 'pending' ELSE 'complete' END,'result',result)
    FROM public.mn_comm_operation_intents WHERE operation_id=p_operation_id);
END
$f$;

CREATE OR REPLACE FUNCTION public.mn_comm_list_pending_operations(p_world_id text,p_world_epoch uuid,p_after_operation_id uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_result jsonb;
BEGIN
  IF public.mn_comm_key(pg_catalog.to_jsonb(p_world_id)) IS NOT TRUE OR p_world_epoch IS NULL OR
     p_world_epoch='00000000-0000-0000-0000-000000000000'::uuid OR
     (p_after_operation_id IS NOT NULL AND p_after_operation_id='00000000-0000-0000-0000-000000000000'::uuid) OR
     p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid community pending-operation scope' USING ERRCODE='CMI01'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(entry ORDER BY operation_id),'[]'::jsonb) INTO v_result FROM (
    SELECT operation_id,pg_catalog.jsonb_build_object('intent',intent,
      'state',CASE WHEN result IS NULL THEN 'pending' ELSE 'complete' END,'result',result) AS entry
    FROM public.mn_comm_operation_intents
    WHERE world_id=p_world_id AND world_epoch=p_world_epoch AND result IS NULL
      AND (p_after_operation_id IS NULL OR operation_id>p_after_operation_id)
    ORDER BY operation_id LIMIT p_limit
  ) q;
  RETURN v_result;
END
$f$;

REVOKE ALL ON FUNCTION public.mn_comm_operation_intent_valid(jsonb),public.mn_comm_operation_row_valid(jsonb),
  public.mn_comm_operation_result_valid(jsonb,jsonb),
  public.mn_comm_operation_guard(),public.mn_comm_contribution_operation_guard(),public.mn_comm_operation_entry(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mn_comm_prepare_operation(jsonb),public.mn_comm_commit_operation(jsonb),
  public.mn_comm_load_operation(uuid),public.mn_comm_list_pending_operations(text,uuid,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_comm_prepare_operation(jsonb),public.mn_comm_commit_operation(jsonb),
  public.mn_comm_load_operation(uuid),public.mn_comm_list_pending_operations(text,uuid,uuid,integer)
  TO service_role;
COMMIT;

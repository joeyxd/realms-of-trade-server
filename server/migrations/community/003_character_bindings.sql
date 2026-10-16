-- A1b2b1: trusted service provisioning of immutable account/character ownership.
-- Apply after community 002. It never adopts a browser profile or claims a character over HTTP.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mn_comm_character_bindings (
  world_id text NOT NULL CHECK (world_id ~ '^[a-zA-Z0-9:_-]{1,100}$'),
  world_epoch uuid NOT NULL CHECK (world_epoch <> '00000000-0000-0000-0000-000000000000'::uuid),
  account_id uuid NOT NULL CHECK (account_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  character_id uuid NOT NULL CHECK (character_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  PRIMARY KEY (world_id, world_epoch, account_id),
  UNIQUE (world_id, world_epoch, character_id),
  FOREIGN KEY (world_id, world_epoch, character_id)
    REFERENCES public.mn_comm_characters(world_id, world_epoch, character_id)
);
ALTER TABLE public.mn_comm_character_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_comm_character_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_comm_character_bindings TO service_role;

CREATE OR REPLACE FUNCTION public.mn_comm_binding_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
  RAISE EXCEPTION 'community character bindings are immutable' USING ERRCODE = 'CMI02';
END $f$;
DROP TRIGGER IF EXISTS mn_comm_character_bindings_immutable ON public.mn_comm_character_bindings;
CREATE TRIGGER mn_comm_character_bindings_immutable
  BEFORE UPDATE OR DELETE ON public.mn_comm_character_bindings
  FOR EACH ROW EXECUTE FUNCTION public.mn_comm_binding_immutable();

CREATE OR REPLACE FUNCTION public.mn_comm_valid_binding(p_binding jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v_count integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_binding) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.jsonb_object_keys(p_binding);
  IF v_count <> 4 OR NOT (p_binding ?& ARRAY['accountId','worldId','worldEpoch','characterId']) THEN RETURN false; END IF;
  RETURN public.mn_comm_uuid(p_binding->'accountId') AND public.mn_comm_key(p_binding->'worldId')
    AND public.mn_comm_uuid(p_binding->'worldEpoch') AND public.mn_comm_uuid(p_binding->'characterId');
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_load_binding(p_account_id uuid,p_world_id text,p_world_epoch uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT pg_catalog.jsonb_build_object('accountId',account_id,'worldId',world_id,
    'worldEpoch',world_epoch,'characterId',character_id)
  FROM public.mn_comm_character_bindings
  WHERE account_id = p_account_id AND world_id = p_world_id AND world_epoch = p_world_epoch;
$f$;

CREATE OR REPLACE FUNCTION public.mn_comm_initialize_binding(p_binding jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_account uuid; v_world text; v_epoch uuid; v_character uuid;
  v_old public.mn_comm_character_bindings%ROWTYPE; v_character_found boolean;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    OR NOT public.mn_comm_valid_binding(p_binding) THEN
    RAISE EXCEPTION 'invalid community character binding' USING ERRCODE = 'CMI01';
  END IF;

  v_account := (p_binding->>'accountId')::uuid;
  v_world := p_binding->>'worldId';
  v_epoch := (p_binding->>'worldEpoch')::uuid;
  v_character := (p_binding->>'characterId')::uuid;

  -- Every writer takes the account lock before the target character lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-binding-account:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_account::text)::text,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-binding-character:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_character::text)::text,0));

  -- A binding, including an exact replay, is valid only while the scoped character exists.
  PERFORM 1 FROM public.mn_comm_characters
    WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character FOR UPDATE;
  v_character_found := FOUND;
  IF NOT v_character_found THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','missing'); END IF;

  SELECT * INTO v_old FROM public.mn_comm_character_bindings
    WHERE world_id = v_world AND world_epoch = v_epoch AND account_id = v_account;
  IF FOUND THEN
    IF v_old.character_id = v_character THEN
      RETURN pg_catalog.jsonb_build_object('ok',true,'binding',p_binding);
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;

  IF EXISTS (SELECT 1 FROM public.mn_comm_character_bindings
      WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;

  BEGIN
    INSERT INTO public.mn_comm_character_bindings(world_id,world_epoch,account_id,character_id)
      VALUES(v_world,v_epoch,v_account,v_character);
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END;
  RETURN pg_catalog.jsonb_build_object('ok',true,'binding',p_binding);
END $f$;

REVOKE ALL ON FUNCTION public.mn_comm_binding_immutable(),
  public.mn_comm_valid_binding(jsonb),
  public.mn_comm_load_binding(uuid,text,uuid),
  public.mn_comm_initialize_binding(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mn_comm_load_binding(uuid,text,uuid),
  public.mn_comm_initialize_binding(jsonb) TO service_role;
COMMIT;

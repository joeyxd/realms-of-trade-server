-- A1b2b2: atomically provision an owned first character alongside A1b2b1 bindings.
-- All later mutations continue through the existing community APIs.
-- Apply after community migrations 001, 002, and 003_character_bindings.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_comm_load_identity(p_account_id uuid, p_world_id text, p_world_epoch uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT pg_catalog.jsonb_build_object(
    'binding', pg_catalog.jsonb_build_object('accountId', b.account_id, 'worldId', b.world_id,
      'worldEpoch', b.world_epoch, 'characterId', b.character_id),
    'character', public.mn_comm_load_character(b.world_id, b.world_epoch, b.character_id))
  FROM public.mn_comm_character_bindings b
  WHERE b.account_id = p_account_id AND b.world_id = p_world_id AND b.world_epoch = p_world_epoch;
$f$;

CREATE OR REPLACE FUNCTION public.mn_comm_allocate_identity(p_binding jsonb, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_account uuid; v_world text; v_epoch uuid; v_character uuid; v_old public.mn_comm_character_bindings%ROWTYPE;
  v_character_row public.mn_comm_characters%ROWTYPE; v_binding jsonb; v_current jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
    NOT public.mn_comm_valid_binding(p_binding) OR
    NOT public.mn_comm_valid_character(pg_catalog.jsonb_build_object('worldId', p_binding->>'worldId',
      'worldEpoch', p_binding->>'worldEpoch', 'characterId', p_binding->>'characterId',
      'version', 1, 'data', p_data)) THEN
    RAISE EXCEPTION 'invalid community identity allocation' USING ERRCODE = 'CMI01';
  END IF;

  v_account := (p_binding->>'accountId')::uuid; v_world := p_binding->>'worldId';
  v_epoch := (p_binding->>'worldEpoch')::uuid; v_character := (p_binding->>'characterId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-binding-account:' ||
    pg_catalog.jsonb_build_array(v_world, v_epoch::text, v_account::text)::text, 0));

  SELECT * INTO v_old FROM public.mn_comm_character_bindings
    WHERE world_id = v_world AND world_epoch = v_epoch AND account_id = v_account;
  IF FOUND THEN
    SELECT * INTO v_character_row FROM public.mn_comm_characters
      WHERE world_id = v_old.world_id AND world_epoch = v_old.world_epoch AND character_id = v_old.character_id;
    v_binding := pg_catalog.jsonb_build_object('accountId',v_old.account_id,'worldId',v_old.world_id,
      'worldEpoch',v_old.world_epoch,'characterId',v_old.character_id);
    v_current := pg_catalog.jsonb_build_object('worldId',v_character_row.world_id,'worldEpoch',v_character_row.world_epoch,
      'characterId',v_character_row.character_id,'version',v_character_row.version,'data',v_character_row.data);
    RETURN pg_catalog.jsonb_build_object('ok',true,'binding',v_binding,'character',v_current);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-binding-character:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_character::text)::text,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-char:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_character::text)::text,0));
  IF EXISTS (SELECT 1 FROM public.mn_comm_character_bindings
      WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character)
    OR EXISTS (SELECT 1 FROM public.mn_comm_characters
      WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','occupied');
  END IF;

  INSERT INTO public.mn_comm_characters(world_id,world_epoch,character_id,version,data)
    VALUES(v_world,v_epoch,v_character,1,p_data);
  INSERT INTO public.mn_comm_character_bindings(world_id,world_epoch,account_id,character_id)
    VALUES(v_world,v_epoch,v_account,v_character);
  v_binding := pg_catalog.jsonb_build_object('accountId',v_account,'worldId',v_world,
    'worldEpoch',v_epoch,'characterId',v_character);
  v_current := pg_catalog.jsonb_build_object('worldId',v_world,'worldEpoch',v_epoch,
    'characterId',v_character,'version',1,'data',p_data);
  RETURN pg_catalog.jsonb_build_object('ok',true,'binding',v_binding,'character',v_current);
END $f$;

REVOKE ALL ON FUNCTION public.mn_comm_load_identity(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mn_comm_allocate_identity(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_comm_load_identity(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_comm_allocate_identity(jsonb,jsonb) TO service_role;
COMMIT;

-- A1b2a: optional same-authority profile snapshot CAS on the scoped community character row.
-- This does not write M5 profiles and must remain behind the explicit session authority bridge.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_comm_save_character(p_character jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_c public.mn_comm_characters%ROWTYPE;
  v_world text; v_epoch uuid; v_character uuid; v_data jsonb; v_next integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
    NOT public.mn_comm_valid_character(p_character) OR
    NOT public.mn_comm_int(p_character->'version',1,2147483646) THEN
    RAISE EXCEPTION 'invalid community character save' USING ERRCODE = 'CMI01';
  END IF;

  v_world := p_character->>'worldId';
  v_epoch := (p_character->>'worldEpoch')::uuid;
  v_character := (p_character->>'characterId')::uuid;
  v_data := p_character->'data';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-char:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_character::text)::text,0));

  SELECT * INTO v_c FROM public.mn_comm_characters
    WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','missing'); END IF;
  IF v_c.version <> (p_character->>'version')::numeric::integer THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;

  v_next := v_c.version + 1;
  UPDATE public.mn_comm_characters SET data = v_data, version = v_next
    WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character;
  SELECT * INTO v_c FROM public.mn_comm_characters
    WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_character;
  RETURN pg_catalog.jsonb_build_object('ok',true,'character',
    pg_catalog.jsonb_build_object('worldId',v_c.world_id,'worldEpoch',v_c.world_epoch,
      'characterId',v_c.character_id,'version',v_c.version,'data',v_c.data));
END $f$;

REVOKE ALL ON FUNCTION public.mn_comm_save_character(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_comm_save_character(jsonb) TO service_role;
COMMIT;

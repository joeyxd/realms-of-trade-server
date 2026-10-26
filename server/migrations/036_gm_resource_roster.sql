-- Durable append-only admission for authored GM resource identities.
BEGIN;

DO $rename_resource_v1$
BEGIN
  IF pg_catalog.to_regprocedure('public.mn_valid_resource_state_v1_pre_gm(jsonb)') IS NULL THEN
    ALTER FUNCTION public.mn_valid_resource_state_v1(jsonb) RENAME TO mn_valid_resource_state_v1_pre_gm;
  END IF;
END
$rename_resource_v1$;

CREATE OR REPLACE FUNCTION public.mn_valid_resource_state_v1(p_resources jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_node jsonb; v_id text; v_nodes jsonb; v_gm jsonb := '[]'::jsonb; v_base jsonb := '[]'::jsonb;
  v_gm_count integer := 0; v_base_count integer := 0; v_offset integer; v_chunk jsonb; v_resource jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_resources) IS DISTINCT FROM 'object' OR
     NOT (p_resources ?& ARRAY['v','tick','nodes','cooldowns']) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources)) <> 4 OR
     NOT public.mn_death_int(p_resources->'v',1,1) OR
     NOT public.mn_death_int(p_resources->'tick',0,9007199254740991) OR
     pg_catalog.jsonb_typeof(p_resources->'nodes') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(p_resources->'nodes') < 1 OR
     pg_catalog.jsonb_array_length(p_resources->'nodes') > 1024 OR
     pg_catalog.jsonb_typeof(p_resources->'cooldowns') IS DISTINCT FROM 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_resources->'cooldowns')) > 4096 THEN RETURN false; END IF;
  v_nodes := p_resources->'nodes';
  FOR v_node IN SELECT value FROM pg_catalog.jsonb_array_elements(v_nodes) LOOP
    v_id := v_node->>'id';
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_nodes) n WHERE n->>'id'=v_id) <> 1 THEN RETURN false; END IF;
    IF v_id ~ '^gm_[0-9a-f]{32}$' THEN
      IF v_node->>'kind' NOT IN ('palm','stone') OR
         (v_node->>'kind'='stone' AND v_node->'hits' IS DISTINCT FROM '0'::jsonb) THEN RETURN false; END IF;
      v_gm := v_gm || pg_catalog.jsonb_build_array(v_node); v_gm_count := v_gm_count + 1;
    ELSE
      IF v_id LIKE 'gm\_%' ESCAPE '\' THEN RETURN false; END IF;
      v_base := v_base || pg_catalog.jsonb_build_array(v_node); v_base_count := v_base_count + 1;
    END IF;
  END LOOP;
  IF v_base_count > 206 THEN RETURN false; END IF;

  -- Historical validation is retained verbatim and applied in bounded slices.
  IF v_base_count > 0 THEN
    v_resource := p_resources || pg_catalog.jsonb_build_object('nodes',v_base);
    IF NOT public.mn_valid_resource_state_v1_pre_gm(v_resource) THEN RETURN false; END IF;
  END IF;
  v_offset := 0;
  WHILE v_offset < v_gm_count LOOP
    SELECT COALESCE(pg_catalog.jsonb_agg(CASE WHEN value->>'kind'='stone' THEN pg_catalog.jsonb_set(value,'{kind}','"rock"'::jsonb) ELSE value END ORDER BY ord), '[]'::jsonb) INTO v_chunk
      FROM pg_catalog.jsonb_array_elements(v_gm) WITH ORDINALITY AS n(value,ord)
      WHERE ord > v_offset AND ord <= v_offset + 206;
    v_resource := p_resources || pg_catalog.jsonb_build_object('nodes',v_chunk);
    IF NOT public.mn_valid_resource_state_v1_pre_gm(v_resource) THEN RETURN false; END IF;
    v_offset := v_offset + 206;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_admit_gm_resources(p_world text,p_expected_version integer,p_resources jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_current jsonb; v_old jsonb; v_old_nodes jsonb; v_new_nodes jsonb; v_count integer; v_total integer;
  v_i integer; v_node jsonb; v_id text; v_kind text; v_added jsonb := '[]'::jsonb; v_logging jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR
     p_world IS NULL OR pg_catalog.btrim(p_world)='' OR pg_catalog.char_length(p_world)>100 OR
     p_expected_version IS NULL OR p_expected_version<1 OR p_expected_version>=2147483647 OR p_resources IS NULL OR
     pg_catalog.jsonb_typeof(p_resources) IS DISTINCT FROM 'object' OR
     NOT public.mn_valid_resource_state(p_resources) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','invalid');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-economic-world:'||p_world,0));
  SELECT economy,version INTO v_current,v_total FROM public.mn_worlds WHERE world=p_world FOR UPDATE;
  IF NOT FOUND OR v_total<>p_expected_version THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  IF pg_catalog.jsonb_typeof(v_current->'resources') IS DISTINCT FROM 'object' OR
     NOT public.mn_valid_resource_state(v_current->'resources') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','invalid');
  END IF;
  v_old:=v_current->'resources'; v_old_nodes:=v_old->'nodes'; v_new_nodes:=p_resources->'nodes';
  v_count:=pg_catalog.jsonb_array_length(v_old_nodes); v_total:=pg_catalog.jsonb_array_length(v_new_nodes);
  IF v_total<v_count OR v_total-v_count>128 OR v_total>1024 OR p_resources->'v' IS DISTINCT FROM v_old->'v' OR
     p_resources->'tick' IS DISTINCT FROM v_old->'tick' OR p_resources->'cooldowns' IS DISTINCT FROM v_old->'cooldowns' OR
     (v_old ? 'logging') IS DISTINCT FROM (p_resources ? 'logging') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
  END IF;
  FOR v_i IN 0..v_count-1 LOOP
    IF v_old_nodes->v_i IS DISTINCT FROM v_new_nodes->v_i THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
    END IF;
  END LOOP;
  IF v_total=v_count THEN
    IF p_resources IS DISTINCT FROM v_old THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'version',p_expected_version);
  END IF;
  IF v_old ? 'logging' THEN
    v_logging:=v_old->'logging';
    IF (p_resources->'logging') IS DISTINCT FROM (v_old->'logging') THEN
      -- Existing entries must remain identical; only the exact default entries for new palms may be added.
      FOR v_id IN SELECT key FROM pg_catalog.jsonb_each(v_old->'logging') LOOP
        IF p_resources->'logging'->v_id IS DISTINCT FROM v_old->'logging'->v_id THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict');
        END IF;
      END LOOP;
    END IF;
    FOR v_i IN v_count..v_total-1 LOOP
      v_node:=v_new_nodes->v_i; v_id:=v_node->>'id'; v_kind:=v_node->>'kind';
      IF v_kind='palm' THEN
        IF p_resources->'logging'->v_id IS DISTINCT FROM
          (CASE WHEN p_resources->>'v'='3' THEN '{"cycle":1,"contributors":[],"quality":0}'::jsonb
                ELSE '{"cycle":1,"contributors":[]}'::jsonb END) THEN
          RETURN pg_catalog.jsonb_build_object('ok',false,'why','invalid');
        END IF;
      ELSIF p_resources->'logging' ? v_id THEN
        RETURN pg_catalog.jsonb_build_object('ok',false,'why','invalid');
      END IF;
    END LOOP;
  END IF;
  FOR v_i IN v_count..v_total-1 LOOP
    v_node:=v_new_nodes->v_i; v_id:=v_node->>'id'; v_kind:=v_node->>'kind';
    IF v_id !~ '^gm_[0-9a-f]{32}$' OR v_kind NOT IN ('palm','stone') OR
       v_node->'rev' IS DISTINCT FROM '1'::jsonb OR v_node->'hits' IS DISTINCT FROM '0'::jsonb OR
       v_node->'readyAt' IS DISTINCT FROM '0'::jsonb THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'why','invalid');
    END IF;
  END LOOP;
  IF v_old ? 'logging' THEN
    v_logging:=v_old->'logging';
    FOR v_i IN v_count..v_total-1 LOOP
      v_node:=v_new_nodes->v_i;
      IF v_node->>'kind'='palm' THEN v_logging:=v_logging||pg_catalog.jsonb_build_object(v_node->>'id',p_resources->'logging'->(v_node->>'id')); END IF;
    END LOOP;
    IF v_logging IS DISTINCT FROM p_resources->'logging' THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  END IF;
  UPDATE public.mn_worlds SET economy=pg_catalog.jsonb_set(v_current,'{resources}',p_resources,true),
    version=version+1,updated_at=pg_catalog.now() WHERE world=p_world;
  RETURN pg_catalog.jsonb_build_object('ok',true,'version',p_expected_version+1);
EXCEPTION WHEN data_exception OR numeric_value_out_of_range OR undefined_function THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'why','invalid');
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_gm_resource_roster_ready()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_wrapper record; v_rpc record; v_constraint boolean; v_validator_source text;
BEGIN
  SELECT prosecdef,proconfig INTO v_wrapper FROM pg_catalog.pg_proc
    WHERE oid='public.mn_valid_resource_state_v1(jsonb)'::pg_catalog.regprocedure;
  SELECT prosecdef,proconfig INTO v_rpc FROM pg_catalog.pg_proc
    WHERE oid='public.mn_admit_gm_resources(text,integer,jsonb)'::pg_catalog.regprocedure;
  SELECT COALESCE(bool_or(convalidated AND contype='c'),false) INTO v_constraint
    FROM pg_catalog.pg_constraint WHERE conrelid='public.mn_economic_operations'::pg_catalog.regclass
      AND conname='mn_economic_operations_resource_check';
  SELECT pg_catalog.pg_get_functiondef('public.mn_valid_resource_state(jsonb)'::pg_catalog.regprocedure)
    INTO v_validator_source;
  IF pg_catalog.to_regprocedure('public.mn_valid_resource_state_v1(jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_valid_resource_state(jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_valid_resource_state_starter_base(jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_resource_state_v3_as_v2(jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('public.mn_admit_gm_resources(text,integer,jsonb)') IS NULL OR
     NOT COALESCE(v_wrapper.prosecdef,false) OR NOT COALESCE(v_wrapper.proconfig @> ARRAY['search_path=""'],false) OR
     NOT COALESCE(v_rpc.prosecdef,false) OR NOT COALESCE(v_rpc.proconfig @> ARRAY['search_path=""'],false) OR
     NOT COALESCE(v_constraint,false) OR
     position('mn_valid_resource_state_starter_base' in v_validator_source)=0 OR
     position('mn_resource_state_v3_as_v2' in v_validator_source)=0 OR
     NOT has_function_privilege('service_role','public.mn_admit_gm_resources(text,integer,jsonb)','EXECUTE') OR
     has_function_privilege('anon','public.mn_admit_gm_resources(text,integer,jsonb)','EXECUTE') OR
     has_function_privilege('authenticated','public.mn_admit_gm_resources(text,integer,jsonb)','EXECUTE') OR
     has_function_privilege('service_role','public.mn_valid_resource_state_v1_pre_gm(jsonb)','EXECUTE') THEN
    RETURN pg_catalog.jsonb_build_object('version',0);
  END IF;
  RETURN pg_catalog.jsonb_build_object('version',1);
END
$function$;

REVOKE ALL ON FUNCTION public.mn_valid_resource_state_v1_pre_gm(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.mn_valid_resource_state_v1(jsonb),public.mn_admit_gm_resources(text,integer,jsonb),
  public.mn_gm_resource_roster_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_admit_gm_resources(text,integer,jsonb),public.mn_gm_resource_roster_ready() TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_valid_resource_state_v1(jsonb) TO service_role;
COMMIT;

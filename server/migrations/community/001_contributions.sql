-- A1b1: optional, isolated scoped contribution backend. No prerequisite gameplay migrations.
-- Requires the standard anon/authenticated/service_role roles. Do not apply to a live backend
-- or mount with M5 account saves until scoped identity and session authority are integrated.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_comm_int(p_value jsonb, p_min numeric, p_max numeric)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  v := (p_value #>> '{}')::numeric;
  RETURN v = pg_catalog.trunc(v) AND v BETWEEN p_min AND p_max;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $f$;
CREATE OR REPLACE FUNCTION public.mn_comm_uuid(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v uuid;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  v := (p_value #>> '{}')::uuid;
  RETURN v::text = (p_value #>> '{}') AND v <> '00000000-0000-0000-0000-000000000000'::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $f$;
CREATE OR REPLACE FUNCTION public.mn_comm_key(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT (pg_catalog.jsonb_typeof(p_value) = 'string' AND (p_value #>> '{}') ~ '^[a-zA-Z0-9:_-]{1,100}$') IS TRUE;
$f$;
-- Mirror src/data/goods.js. A parity test must fail when that catalog changes.
CREATE OR REPLACE FUNCTION public.mn_comm_good_ids(p_material boolean)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT CASE WHEN p_material THEN ARRAY['cana','madera','tronco','piedra','hierro','mineral_hierro','azufre','lona']::text[]
    ELSE ARRAY['pescado','fruta','harina','galleta','ron','agua','cana','madera','tronco','piedra','hierro','mineral_hierro',
      'azufre','lona','polvora','balas','tabaco','especias','seda','coral','perlas']::text[] END;
$f$;
CREATE OR REPLACE FUNCTION public.mn_comm_valid_json(p_value jsonb, p_depth integer DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v jsonb; v_number double precision;
BEGIN
  IF p_value IS NULL OR p_depth > 64 THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(p_value) = 'number' THEN
    v_number := (p_value #>> '{}')::double precision;
    RETURN v_number <> 'Infinity'::double precision AND v_number <> '-Infinity'::double precision AND v_number <> 'NaN'::double precision;
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
    FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP
      IF NOT public.mn_comm_valid_json(v,p_depth + 1) THEN RETURN false; END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'object' THEN
    FOR v IN SELECT value FROM pg_catalog.jsonb_each(p_value) LOOP
      IF NOT public.mn_comm_valid_json(v,p_depth + 1) THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false;
END $f$;
-- Compact JSON for the profile byte ceiling; do not remove whitespace inside string values.
CREATE OR REPLACE FUNCTION public.mn_comm_compact(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE v text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) = 'object' THEN
    SELECT '{' || COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(key)::text || ':' || public.mn_comm_compact(value),','),'') || '}'
      INTO v FROM pg_catalog.jsonb_each(p_value);
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
    SELECT '[' || COALESCE(pg_catalog.string_agg(public.mn_comm_compact(value),',' ORDER BY ord),'') || ']'
      INTO v FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS q(value,ord);
  ELSE v := p_value::text;
  END IF;
  RETURN v;
END $f$;
CREATE OR REPLACE FUNCTION public.mn_comm_valid_character(p_row jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE g text; n jsonb; d jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR
    NOT (p_row ?& ARRAY['worldId','worldEpoch','characterId','version','data']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_row)) <> 5 OR
    NOT public.mn_comm_key(p_row->'worldId') OR NOT public.mn_comm_uuid(p_row->'worldEpoch') OR
    NOT public.mn_comm_uuid(p_row->'characterId') OR NOT public.mn_comm_int(p_row->'version',1,2147483647) THEN RETURN false; END IF;
  d := p_row->'data';
  IF pg_catalog.jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->'v' IS DISTINCT FROM '1'::jsonb OR
    pg_catalog.jsonb_typeof(d->'eco') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(d->'eco'->'pack') IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(d->'eco'->'pack'->'goods') IS DISTINCT FROM 'object' OR
    NOT public.mn_comm_valid_json(d) THEN RETURN false; END IF;
  IF pg_catalog.octet_length(public.mn_comm_compact(d)) > 131072 OR
    (d->'eco' ? 'tradeRev' AND NOT public.mn_comm_int(d->'eco'->'tradeRev',0,2147483647)) THEN RETURN false; END IF;
  FOR g,n IN SELECT key,value FROM pg_catalog.jsonb_each(d->'eco'->'pack'->'goods') LOOP
    IF NOT (g = ANY(public.mn_comm_good_ids(false))) OR NOT public.mn_comm_int(n,1,1000000) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $f$;
CREATE OR REPLACE FUNCTION public.mn_comm_valid_project(p_row jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
DECLARE g text; n jsonb; r jsonb; c jsonb; v_count integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR
    NOT (p_row ?& ARRAY['worldId','worldEpoch','projectId','version','requirements','contributed']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_row)) <> 6 OR
    NOT public.mn_comm_key(p_row->'worldId') OR NOT public.mn_comm_uuid(p_row->'worldEpoch') OR
    NOT public.mn_comm_key(p_row->'projectId') OR NOT public.mn_comm_int(p_row->'version',1,2147483647) THEN RETURN false; END IF;
  r := p_row->'requirements'; c := p_row->'contributed';
  IF pg_catalog.jsonb_typeof(r) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.jsonb_object_keys(r);
  IF v_count < 1 OR v_count > 16 OR v_count <> (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(c)) THEN RETURN false; END IF;
  FOR g,n IN SELECT key,value FROM pg_catalog.jsonb_each(r) LOOP
    IF NOT (g = ANY(public.mn_comm_good_ids(true))) OR NOT public.mn_comm_int(n,1,1000000) THEN RETURN false; END IF;
    IF NOT public.mn_comm_int(c->g,0,(n #>> '{}')::numeric) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $f$;
CREATE OR REPLACE FUNCTION public.mn_comm_valid_request(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
BEGIN
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
    NOT (p_request ?& ARRAY['operationId','worldId','worldEpoch','characterId','projectId','good','amount','expectedCharacterVersion','expectedProjectVersion']) OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 9 THEN RETURN false; END IF;
  RETURN public.mn_comm_uuid(p_request->'operationId') AND public.mn_comm_key(p_request->'worldId') AND
    public.mn_comm_uuid(p_request->'worldEpoch') AND public.mn_comm_uuid(p_request->'characterId') AND
    public.mn_comm_key(p_request->'projectId') AND pg_catalog.jsonb_typeof(p_request->'good') = 'string' AND
    p_request->>'good' = ANY(public.mn_comm_good_ids(true)) AND public.mn_comm_int(p_request->'amount',1,1000000) AND
    public.mn_comm_int(p_request->'expectedCharacterVersion',1,2147483646) AND
    public.mn_comm_int(p_request->'expectedProjectVersion',1,2147483646);
END $f$;

CREATE TABLE IF NOT EXISTS public.mn_comm_characters (
  world_id text NOT NULL, world_epoch uuid NOT NULL, character_id uuid NOT NULL, version integer NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(world_id,world_epoch,character_id),
  CHECK (public.mn_comm_valid_character(pg_catalog.jsonb_build_object('worldId',world_id,'worldEpoch',world_epoch,
    'characterId',character_id,'version',version,'data',data)))
);
CREATE TABLE IF NOT EXISTS public.mn_comm_projects (
  world_id text NOT NULL, world_epoch uuid NOT NULL, project_id text NOT NULL, version integer NOT NULL,
  requirements jsonb NOT NULL, contributed jsonb NOT NULL,
  PRIMARY KEY(world_id,world_epoch,project_id),
  CHECK (public.mn_comm_valid_project(pg_catalog.jsonb_build_object('worldId',world_id,'worldEpoch',world_epoch,
    'projectId',project_id,'version',version,'requirements',requirements,'contributed',contributed)))
);
CREATE TABLE IF NOT EXISTS public.mn_comm_contributions (
  operation_id uuid PRIMARY KEY, request jsonb NOT NULL CHECK(public.mn_comm_valid_request(request)),
  result jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(result) = 'object'),
  CHECK(operation_id = (request->>'operationId')::uuid)
);
ALTER TABLE public.mn_comm_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_comm_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_comm_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mn_comm_characters,public.mn_comm_projects,public.mn_comm_contributions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.mn_comm_characters,public.mn_comm_projects,public.mn_comm_contributions TO service_role;

CREATE OR REPLACE FUNCTION public.mn_comm_load_character(p_world_id text,p_world_epoch uuid,p_character_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT pg_catalog.jsonb_build_object('worldId',world_id,'worldEpoch',world_epoch,'characterId',character_id,'version',version,'data',data)
    FROM public.mn_comm_characters WHERE world_id = p_world_id AND world_epoch = p_world_epoch AND character_id = p_character_id;
$f$;
CREATE OR REPLACE FUNCTION public.mn_comm_load_project(p_world_id text,p_world_epoch uuid,p_project_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT pg_catalog.jsonb_build_object('worldId',world_id,'worldEpoch',world_epoch,'projectId',project_id,'version',version,
    'requirements',requirements,'contributed',contributed)
    FROM public.mn_comm_projects WHERE world_id = p_world_id AND world_epoch = p_world_epoch AND project_id = p_project_id;
$f$;
CREATE OR REPLACE FUNCTION public.mn_comm_load_receipt(p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT pg_catalog.jsonb_build_object('request',request,'result',result) FROM public.mn_comm_contributions WHERE operation_id = p_operation_id;
$f$;

-- Initialization accepts a trusted baseline only once; exact retries never overwrite later state.
CREATE OR REPLACE FUNCTION public.mn_comm_initialize_character(p_character jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_old jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR NOT public.mn_comm_valid_character(p_character) THEN
    RAISE EXCEPTION 'invalid community character' USING ERRCODE = 'CMI01'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-char:' ||
    pg_catalog.jsonb_build_array(p_character->>'worldId',p_character->>'worldEpoch',p_character->>'characterId')::text,0));
  SELECT public.mn_comm_load_character(p_character->>'worldId',(p_character->>'worldEpoch')::uuid,(p_character->>'characterId')::uuid) INTO v_old;
  IF v_old IS NOT NULL THEN
    IF v_old IS DISTINCT FROM p_character THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  ELSE
    INSERT INTO public.mn_comm_characters(world_id,world_epoch,character_id,version,data) VALUES
      (p_character->>'worldId',(p_character->>'worldEpoch')::uuid,(p_character->>'characterId')::uuid,(p_character->>'version')::numeric::integer,p_character->'data');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'character',p_character);
END $f$;
CREATE OR REPLACE FUNCTION public.mn_comm_initialize_project(p_project jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_old jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR NOT public.mn_comm_valid_project(p_project) THEN
    RAISE EXCEPTION 'invalid community project' USING ERRCODE = 'CMI01'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-project:' ||
    pg_catalog.jsonb_build_array(p_project->>'worldId',p_project->>'worldEpoch',p_project->>'projectId')::text,0));
  SELECT public.mn_comm_load_project(p_project->>'worldId',(p_project->>'worldEpoch')::uuid,p_project->>'projectId') INTO v_old;
  IF v_old IS NOT NULL THEN
    IF v_old IS DISTINCT FROM p_project THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','conflict'); END IF;
  ELSE
    INSERT INTO public.mn_comm_projects(world_id,world_epoch,project_id,version,requirements,contributed) VALUES
      (p_project->>'worldId',(p_project->>'worldEpoch')::uuid,p_project->>'projectId',(p_project->>'version')::numeric::integer,p_project->'requirements',p_project->'contributed');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'project',p_project);
END $f$;

CREATE OR REPLACE FUNCTION public.mn_comm_commit_contribution(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_id uuid; v_world text; v_epoch uuid; v_char uuid; v_project text; v_good text;
  v_prior_request jsonb; v_result jsonb; v_c public.mn_comm_characters%ROWTYPE; v_p public.mn_comm_projects%ROWTYPE;
  v_character_found boolean; v_project_found boolean; v_why text; v_accepted integer; v_available integer; v_remaining integer;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' OR NOT public.mn_comm_valid_request(p_request) THEN
    RAISE EXCEPTION 'invalid community request' USING ERRCODE = 'CMI01'; END IF;
  v_id := (p_request->>'operationId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-op:' || v_id::text,0));
  SELECT request,result INTO v_prior_request,v_result FROM public.mn_comm_contributions WHERE operation_id = v_id;
  IF FOUND THEN
    IF v_prior_request IS DISTINCT FROM p_request THEN RETURN pg_catalog.jsonb_build_object('ok',false,'why','operation','replay',false); END IF;
    RETURN v_result || pg_catalog.jsonb_build_object('replay',true);
  END IF;
  v_world := p_request->>'worldId'; v_epoch := (p_request->>'worldEpoch')::uuid;
  v_char := (p_request->>'characterId')::uuid; v_project := p_request->>'projectId'; v_good := p_request->>'good';
  -- All writers use operation -> scoped character -> scoped project -> row locks. Advisory
  -- locks also protect missing rows and initialization; READ COMMITTED rechecks after waiting.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-char:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_char::text)::text,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-community-project:' ||
    pg_catalog.jsonb_build_array(v_world,v_epoch::text,v_project)::text,0));
  SELECT * INTO v_c FROM public.mn_comm_characters WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_char FOR UPDATE;
  v_character_found := FOUND;
  SELECT * INTO v_p FROM public.mn_comm_projects WHERE world_id = v_world AND world_epoch = v_epoch AND project_id = v_project FOR UPDATE;
  v_project_found := FOUND;
  IF NOT v_character_found OR NOT v_project_found THEN v_why := 'missing';
  ELSIF v_c.version <> (p_request->>'expectedCharacterVersion')::numeric::integer OR
    v_p.version <> (p_request->>'expectedProjectVersion')::numeric::integer THEN v_why := 'conflict';
  ELSIF NOT (v_p.requirements ? v_good) THEN v_why := 'material';
  ELSE
    v_accepted := LEAST((p_request->>'amount')::numeric::integer,(v_p.requirements->>v_good)::numeric::integer - (v_p.contributed->>v_good)::numeric::integer);
    v_available := COALESCE((v_c.data->'eco'->'pack'->'goods'->>v_good)::numeric::integer,0);
    IF v_accepted = 0 THEN v_why := 'complete';
    ELSIF v_available < v_accepted THEN v_why := 'goods';
    ELSIF v_c.data->'eco'->'tradeRev' = '2147483647'::jsonb THEN v_why := 'conflict';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    v_result := pg_catalog.jsonb_build_object('ok',false,'why',v_why,'replay',false);
  ELSE
    v_remaining := v_available - v_accepted;
    IF v_remaining = 0 THEN v_c.data := v_c.data #- ARRAY['eco','pack','goods',v_good];
    ELSE v_c.data := pg_catalog.jsonb_set(v_c.data,ARRAY['eco','pack','goods',v_good],pg_catalog.to_jsonb(v_remaining)); END IF;
    IF v_c.data->'eco' ? 'tradeRev' THEN
      v_c.data := pg_catalog.jsonb_set(v_c.data,'{eco,tradeRev}',pg_catalog.to_jsonb((v_c.data->'eco'->>'tradeRev')::numeric::integer + 1));
    END IF;
    -- Even a revision digit can cross the byte ceiling. Preserve a terminal denial rather
    -- than creating an unloadable snapshot or leaving an unrecorded table-check failure.
    IF pg_catalog.octet_length(public.mn_comm_compact(v_c.data)) > 131072 THEN
      v_result := pg_catalog.jsonb_build_object('ok',false,'why','conflict','replay',false);
    ELSE
    v_c.version := v_c.version + 1; v_p.version := v_p.version + 1;
    v_p.contributed := pg_catalog.jsonb_set(v_p.contributed,ARRAY[v_good],pg_catalog.to_jsonb((v_p.contributed->>v_good)::numeric::integer + v_accepted));
    v_result := pg_catalog.jsonb_build_object('ok',true,'replay',false,'accepted',v_accepted,
      'character',pg_catalog.jsonb_build_object('worldId',v_world,'worldEpoch',v_epoch,'characterId',v_char,'version',v_c.version,'data',v_c.data),
      'project',pg_catalog.jsonb_build_object('worldId',v_world,'worldEpoch',v_epoch,'projectId',v_project,'version',v_p.version,
        'requirements',v_p.requirements,'contributed',v_p.contributed));
    UPDATE public.mn_comm_characters SET data = v_c.data,version = v_c.version
      WHERE world_id = v_world AND world_epoch = v_epoch AND character_id = v_char;
    UPDATE public.mn_comm_projects SET contributed = v_p.contributed,version = v_p.version
      WHERE world_id = v_world AND world_epoch = v_epoch AND project_id = v_project;
    END IF;
  END IF;
  -- Terminal denials are receipts too. Any SQL error aborts the whole transaction, so no
  -- partial debit, credit or provisional receipt can escape. Do not infer denial on I/O loss.
  INSERT INTO public.mn_comm_contributions(operation_id,request,result) VALUES(v_id,p_request,v_result);
  RETURN v_result;
END $f$;

REVOKE ALL ON FUNCTION public.mn_comm_int(jsonb,numeric,numeric),public.mn_comm_uuid(jsonb),public.mn_comm_key(jsonb),
  public.mn_comm_good_ids(boolean),public.mn_comm_valid_json(jsonb,integer),public.mn_comm_compact(jsonb),
  public.mn_comm_valid_character(jsonb),public.mn_comm_valid_project(jsonb),public.mn_comm_valid_request(jsonb),
  public.mn_comm_load_character(text,uuid,uuid),public.mn_comm_load_project(text,uuid,text),public.mn_comm_load_receipt(uuid),
  public.mn_comm_initialize_character(jsonb),public.mn_comm_initialize_project(jsonb),public.mn_comm_commit_contribution(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_comm_int(jsonb,numeric,numeric),public.mn_comm_uuid(jsonb),public.mn_comm_key(jsonb),
  public.mn_comm_good_ids(boolean),public.mn_comm_valid_json(jsonb,integer),public.mn_comm_compact(jsonb),
  public.mn_comm_valid_character(jsonb),public.mn_comm_valid_project(jsonb),public.mn_comm_valid_request(jsonb),
  public.mn_comm_load_character(text,uuid,uuid),public.mn_comm_load_project(text,uuid,text),public.mn_comm_load_receipt(uuid),
  public.mn_comm_initialize_character(jsonb),public.mn_comm_initialize_project(jsonb),public.mn_comm_commit_contribution(jsonb)
  TO service_role;
COMMIT;

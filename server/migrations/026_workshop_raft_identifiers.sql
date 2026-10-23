-- Repair SQL024 workshop raft IDs and unchanged gameplay denials.
-- Apply after 024 (025 may already be installed). No data or receipt rewrites.
-- Retain the original empty-ID allowance for exact historical validation.
BEGIN;

CREATE OR REPLACE FUNCTION public.mn_valid_starter_workshop_request(p_operation_id uuid,p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE cmd jsonb; ack jsonb; base jsonb; op text; kind text;
BEGIN
  IF p_operation_id IS NULL OR pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR
     NOT (p_request ? 'before') OR p_request ? 'beneficiaries' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request))<>9 OR
     NOT (p_request ?& ARRAY['world','account','command','expectedProfileVersion','expectedWorldVersion','profile','worldData','ack','before']) THEN RETURN false; END IF;
  cmd:=p_request->'command'; ack:=p_request->'ack'; op:=cmd->>'op'; kind:=cmd->>'type';
  IF kind NOT IN ('artisan','raft') OR (kind='artisan' AND op NOT IN ('contribute','craftCrate','upgradePack')) OR
     (kind='raft' AND (op NOT IN ('place','remove') OR cmd->>'rules'<>'2')) THEN RETURN false; END IF;
  IF public.mn_starter_valid_pack(p_request->'before') IS NOT TRUE OR public.mn_starter_valid_pack(p_request->'profile') IS NOT TRUE OR
     (p_request->'before' ? 'workshop' AND public.mn_starter_valid_workshop(p_request->'before'->'workshop') IS NOT TRUE) OR
     (p_request->'profile' ? 'workshop' AND public.mn_starter_valid_workshop(p_request->'profile'->'workshop') IS NOT TRUE) THEN RETURN false; END IF;
  IF kind='artisan' THEN
    IF pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
       NOT public.mn_death_int(cmd->'expectedRev',0,2147483646) OR
       (op='contribute' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>5) OR
       (op='craftCrate' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>4) OR
       (op='upgradePack' AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>4) OR
       (op='contribute' AND (NOT (cmd ?& ARRAY['type','op','opId','expectedRev','amount']) OR NOT public.mn_death_int(cmd->'amount',1,10))) OR
       (op<>'contribute' AND NOT (cmd ?& ARRAY['type','op','opId','expectedRev'])) THEN RETURN false; END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))<>8 OR
       NOT (ack ?& ARRAY['type','op','opId','ok','why','rev','workshop','carry']) OR
       ack->>'type' IS DISTINCT FROM 'artisan' OR ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
       pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR
       NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  ELSE
    IF pg_catalog.jsonb_typeof(cmd->'opId') IS DISTINCT FROM 'string' OR cmd->>'opId' !~ '^[A-Za-z0-9_-]{1,64}$' OR
       pg_catalog.jsonb_typeof(cmd->'id') IS DISTINCT FROM 'string' OR cmd->>'id' !~ '^[A-Za-z0-9:_-]{0,120}$' OR
       NOT public.mn_death_int(cmd->'expectedRev',1,2147483646) OR
       pg_catalog.jsonb_typeof(cmd->'piece') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(cmd->'piece')<>5 OR
       (op='place' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>7 OR
         NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece','rules']))) OR
       (op='remove' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(cmd))<>8 OR
         NOT (cmd ?& ARRAY['type','op','opId','id','expectedRev','piece','rules','index']) OR
         NOT public.mn_death_int(cmd->'index',0,599))) OR
       cmd->'piece'->>0 NOT IN ('storage','crate') OR
       NOT public.mn_death_int(cmd->'piece'->1,-128,128) OR NOT public.mn_death_int(cmd->'piece'->2,-128,128) OR
       NOT public.mn_death_int(cmd->'piece'->3,0,2) OR NOT public.mn_death_int(cmd->'piece'->4,0,3) OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack)) NOT IN (7,8) OR
       ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ack))=8 AND NOT (ack ? 'record')) OR
       (ack ? 'record' AND (ack->'ok' IS DISTINCT FROM 'false'::jsonb OR
         pg_catalog.jsonb_typeof(ack->'record') IS DISTINCT FROM 'object')) OR
       pg_catalog.octet_length(ack::text)>32768 OR
       NOT (ack ?& ARRAY['type','id','op','opId','ok','why','rev']) OR ack->>'type' IS DISTINCT FROM 'raftEdit' OR
       ack->>'id' IS DISTINCT FROM cmd->>'id' OR ack->>'op' IS DISTINCT FROM op OR ack->>'opId' IS DISTINCT FROM cmd->>'opId' OR
       pg_catalog.jsonb_typeof(ack->'ok') IS DISTINCT FROM 'boolean' OR pg_catalog.jsonb_typeof(ack->'why') IS DISTINCT FROM 'string' OR
       NOT public.mn_death_int(ack->'rev',0,2147483647) THEN RETURN false; END IF;
  END IF;
  base:=p_request-'before'::text;
  base:=pg_catalog.jsonb_set(base,'{command}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',COALESCE(cmd->'opId','"workshop"'::jsonb),'town','aldea','g','madera','n',1,'expectedTotal',0),false);
  base:=pg_catalog.jsonb_set(base,'{ack}',pg_catalog.jsonb_build_object('type','commerce','op','buy','opId',COALESCE(cmd->'opId','"workshop"'::jsonb),'ok',true,'why','','rev',0),false);
  RETURN public.mn_valid_economic_request_starter_base(p_operation_id,base);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception OR undefined_function THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_valid_starter_raft_transition(p_request jsonb,p_world jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE b jsonb; n jsonb; cmd jsonb; ack jsonb; oldships jsonb; newships jsonb; os jsonb; ns jsonb;
  parts jsonb; nextparts jsonb; piece jsonb; hold0 jsonb; hold1 jsonb; pack0 jsonb; pack1 jsonb;
  condition0 jsonb; condition1 jsonb; entries jsonb; entry jsonb; expectcondition jsonb; expectship jsonb;
  expectprofile jsonb; goods0 jsonb; goods1 jsonb; holdgoods0 jsonb; holdgoods1 jsonb; packgoods0 jsonb; packgoods1 jsonb;
  ws0 jsonb; ws1 jsonb; rev bigint; cap0 integer; cap1 integer; si integer; idx integer; i integer; nextid bigint;
  refund integer:=0; woodcost integer:=0; fromhold integer:=0; g text; h0 numeric; h1 numeric; p0 numeric; p1 numeric; sal integer;
  carry jsonb; tier integer; mass bigint; maxhold integer; x integer; z integer; level integer; rotation integer;
BEGIN
  b:=p_request->'before'; n:=p_request->'profile'; cmd:=p_request->'command'; ack:=p_request->'ack'; piece:=cmd->'piece';
  IF ((p_request->'worldData')-'resources'::text) IS DISTINCT FROM (p_world-'resources'::text) THEN RETURN false; END IF;
  IF p_world ? 'resources' THEN
    IF NOT (p_request->'worldData' ? 'resources') OR
      ((p_request->'worldData'->'resources')-'tick'::text) IS DISTINCT FROM ((p_world->'resources')-'tick'::text) OR
      (p_request->'worldData'->'resources'->>'tick')::numeric<(p_world->'resources'->>'tick')::numeric THEN RETURN false; END IF;
  ELSIF p_request->'worldData' ? 'resources' THEN RETURN false; END IF;
  -- A normal gameplay denial is itself a durable no-op receipt, never a world fence.
  IF ack->'ok'='false'::jsonb THEN RETURN n IS NOT DISTINCT FROM b; END IF;
  IF ack->'ok' IS DISTINCT FROM 'true'::jsonb OR cmd->>'type'<>'raft' OR cmd->>'rules'<>'2' OR
     cmd->>'expectedRev' IS NULL OR ack->'why' IS DISTINCT FROM '""'::jsonb OR
     ack->'rev' IS DISTINCT FROM pg_catalog.to_jsonb((cmd->>'expectedRev')::bigint+1) THEN RETURN false; END IF;
  oldships:=b->'eco'->'ships'; newships:=n->'eco'->'ships';
  IF pg_catalog.jsonb_typeof(oldships)<>'array' OR pg_catalog.jsonb_array_length(oldships)<>pg_catalog.jsonb_array_length(newships) OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(oldships) s WHERE s->>'id'=cmd->>'id')<>1 THEN RETURN false; END IF;
  SELECT value,ordinal::integer-1 INTO os,si FROM pg_catalog.jsonb_array_elements(oldships) WITH ORDINALITY s(value,ordinal) WHERE value->>'id'=cmd->>'id';
  ns:=newships->si; parts:=os->'grid'->'parts'; nextparts:=ns->'grid'->'parts';
  hold0:=os->'hold'; hold1:=ns->'hold'; pack0:=b->'eco'->'pack'; pack1:=n->'eco'->'pack';
  IF os->>'kind'<>'raft' OR os->>'at'<>'aldea' OR (os->>'hp')::numeric<=0 OR
     os->'rev' IS DISTINCT FROM cmd->'expectedRev' OR pg_catalog.jsonb_typeof(parts)<>'array' OR
     pg_catalog.jsonb_array_length(parts)<1 OR pg_catalog.jsonb_array_length(parts)>599 THEN RETURN false; END IF;
  SELECT COALESCE(sum(CASE p->>0 WHEN 'storage' THEN 20 WHEN 'chest' THEN 8 WHEN 'crate' THEN 6 ELSE 0 END),0)::integer INTO cap0
    FROM pg_catalog.jsonb_array_elements(parts) p;
  holdgoods0:=hold0->'goods'; packgoods0:=pack0->'goods'; packgoods1:=pack1->'goods'; holdgoods1:=hold1->'goods';
  IF cmd->>'op'='place' THEN
    IF pg_catalog.jsonb_array_length(nextparts)<>pg_catalog.jsonb_array_length(parts)+1 OR nextparts->(pg_catalog.jsonb_array_length(parts)) IS DISTINCT FROM piece THEN RETURN false; END IF;
    x:=(piece->>1)::integer; z:=(piece->>2)::integer; level:=(piece->>3)::integer; rotation:=(piece->>4)::integer;
    IF piece->>0 NOT IN ('storage','crate') OR NOT public.mn_death_int(piece->1,-128,128) OR NOT public.mn_death_int(piece->2,-128,128) OR
       NOT public.mn_death_int(piece->3,0,2) OR NOT public.mn_death_int(piece->4,0,3) OR
       NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->1=piece->1 AND p->2=piece->2 AND p->3=piece->3 AND
          ((level=0 AND p->>0 IN ('foundation','reinforcedFoundation')) OR (level>0 AND p->>0='floor'))) OR
       (piece->>0='storage' AND NOT (COALESCE(b->'progression'->'knowledge','[]'::jsonb) ? 'raft_storage')) OR
       EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(parts) p WHERE p->3=piece->3 AND
          ((p->>0 IN ('storage','crate','chest','stairs','ladder','sail','bigSail','engine','anchor','cropPlot','canePlot','purifier','net','grill','still','research','bed','bunk','torchFloor','campfire','lantern','turret','decor','pillar') AND
             p->1=piece->1 AND p->2=piece->2) OR
           (p->>0='bigSail' AND x BETWEEN (p->>1)::integer AND (p->>1)::integer+1 AND
             z BETWEEN (p->>2)::integer AND (p->>2)::integer+1)))
       THEN RETURN false; END IF;
  ELSIF cmd->>'op'='remove' THEN
    idx:=(cmd->>'index')::integer;
    IF idx<0 OR idx>=pg_catalog.jsonb_array_length(parts) OR parts->idx IS DISTINCT FROM piece OR
       pg_catalog.jsonb_array_length(nextparts)<>pg_catalog.jsonb_array_length(parts)-1 OR nextparts IS DISTINCT FROM (parts-idx) THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  SELECT COALESCE(sum(CASE p->>0 WHEN 'storage' THEN 20 WHEN 'chest' THEN 8 WHEN 'crate' THEN 6 ELSE 0 END),0)::integer INTO cap1
    FROM pg_catalog.jsonb_array_elements(nextparts) p;
  IF hold0->'cap' IS DISTINCT FROM pg_catalog.to_jsonb(cap0) OR hold1->'cap' IS DISTINCT FROM pg_catalog.to_jsonb(cap1) OR
     pg_catalog.jsonb_typeof(holdgoods0)<>'object' OR pg_catalog.jsonb_typeof(holdgoods1)<>'object' OR
     NOT public.mn_starter_valid_goods(holdgoods0,cap0,1000000000) THEN RETURN false; END IF;
  condition0:=os->'condition'; condition1:=ns->'condition'; expectcondition:=condition0;
  IF condition0 IS NOT NULL AND condition0<>'null'::jsonb THEN
    entries:=condition0->'entries';
    IF condition0->'v'<>'1'::jsonb OR NOT public.mn_death_int(condition0->'next',1,1000000000) OR
       pg_catalog.jsonb_typeof(entries)<>'array' OR pg_catalog.jsonb_array_length(entries)<>pg_catalog.jsonb_array_length(parts) THEN RETURN false; END IF;
    IF cmd->>'op'='place' THEN
      nextid:=(condition0->>'next')::bigint;
      IF nextid>=999999400 THEN RETURN false; END IF;
      WHILE EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(entries) e WHERE e->>0='p'||nextid::text) LOOP nextid:=nextid+1; END LOOP;
      expectcondition:=pg_catalog.jsonb_set(condition0,'{next}',pg_catalog.to_jsonb(nextid+1),false);
      expectcondition:=pg_catalog.jsonb_set(expectcondition,'{entries}',entries||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_array('p'||nextid::text,piece->0,piece->1,piece->2,piece->3,piece->4,
          CASE piece->>0 WHEN 'storage' THEN 40 ELSE 15 END)),false);
    ELSE
      entry:=entries->idx;
      IF pg_catalog.jsonb_array_length(entry)<>7 OR entry->0 IS DISTINCT FROM entries->idx->0 THEN RETURN false; END IF;
      refund:=CASE piece->>0 WHEN 'storage' THEN pg_catalog.floor(3::double precision*((entry->>6)::double precision/40)+1e-10)::integer
        ELSE pg_catalog.floor(1::double precision*((entry->>6)::double precision/15)+1e-10)::integer END;
      expectcondition:=pg_catalog.jsonb_set(condition0,'{entries}',entries-idx,false);
    END IF;
  END IF;
  IF condition1 IS DISTINCT FROM expectcondition THEN RETURN false; END IF;
  ws0:=public.mn_starter_workshop(b); ws1:=ws0;
  IF cmd->>'op'='place' THEN
    IF piece->>0='storage' THEN
      IF (ws0->'storageCredit')='true'::jsonb THEN ws1:=pg_catalog.jsonb_set(ws0,'{storageCredit}','false'::jsonb,false);
      ELSE woodcost:=10; END IF;
    ELSE
      IF (ws0->>'crateKits')::integer<1 THEN RETURN false; END IF;
      ws1:=pg_catalog.jsonb_set(ws0,'{crateKits}',pg_catalog.to_jsonb((ws0->>'crateKits')::integer-1),false);
    END IF;
    fromhold:=LEAST(COALESCE((holdgoods0->>'madera')::integer,0),woodcost);
    IF COALESCE((holdgoods0->>'madera')::integer,0)+COALESCE((packgoods0->>'madera')::integer,0)<woodcost THEN RETURN false; END IF;
    holdgoods1:=holdgoods0-'madera'::text;
    IF COALESCE((holdgoods0->>'madera')::integer,0)>fromhold THEN holdgoods1:=holdgoods1||pg_catalog.jsonb_build_object('madera',(holdgoods0->>'madera')::integer-fromhold); END IF;
    packgoods1:=packgoods0-'madera'::text;
    IF COALESCE((packgoods0->>'madera')::integer,0)>woodcost-fromhold THEN packgoods1:=packgoods1||pg_catalog.jsonb_build_object('madera',(packgoods0->>'madera')::integer-(woodcost-fromhold)); END IF;
  ELSE
    IF piece->>0='storage' THEN
      refund:=pg_catalog.floor(3::double precision*(COALESCE((entries->idx->>6)::double precision,40)/40)+1e-10)::integer;
    ELSE
      refund:=pg_catalog.floor(1::double precision*(COALESCE((entries->idx->>6)::double precision,15)/15)+1e-10)::integer;
    END IF;
    packgoods1:=pack1->'goods';
    IF pg_catalog.jsonb_typeof(packgoods1)<>'object' THEN RETURN false; END IF;
  END IF;
  mass:=CASE WHEN pack1 ? 'maxMass' THEN (pack1->>'maxMass')::bigint ELSE 1000000000 END;
  IF public.mn_starter_valid_goods(holdgoods1,cap1,1000000000) IS NOT TRUE OR
     public.mn_starter_valid_goods(packgoods1,(pack1->>'cap')::bigint,mass) IS NOT TRUE THEN RETURN false; END IF;
  expectship:=pg_catalog.jsonb_set(os,'{grid,parts}',nextparts,false);
  expectship:=pg_catalog.jsonb_set(expectship,'{hold,cap}',pg_catalog.to_jsonb(cap1),false);
  expectship:=pg_catalog.jsonb_set(expectship,'{hold,goods}',holdgoods1,false);
  expectship:=pg_catalog.jsonb_set(expectship,'{rev}',pg_catalog.to_jsonb((os->>'rev')::bigint+1),false);
  IF condition0 IS NOT NULL AND condition0<>'null'::jsonb THEN expectship:=pg_catalog.jsonb_set(expectship,'{condition}',expectcondition,false); END IF;
  IF ns IS DISTINCT FROM expectship THEN RETURN false; END IF;
  expectprofile:=pg_catalog.jsonb_set(b,'{eco,ships}',pg_catalog.jsonb_set(oldships,ARRAY[si::text],ns,false),false);
  pack1:=pg_catalog.jsonb_set(pack1,'{goods}',packgoods1,false);
  expectprofile:=pg_catalog.jsonb_set(expectprofile,'{eco,pack}',pack1,false);
  IF ws1 IS DISTINCT FROM ws0 OR b ? 'workshop' THEN expectprofile:=pg_catalog.jsonb_set(expectprofile,'{workshop}',ws1,true); END IF;
  FOR g IN SELECT key FROM pg_catalog.jsonb_each((holdgoods0)||(packgoods0)||(holdgoods1)||(packgoods1)) LOOP
    h0:=COALESCE((holdgoods0->>g)::numeric,0); p0:=COALESCE((packgoods0->>g)::numeric,0);
    h1:=COALESCE((holdgoods1->>g)::numeric,0); p1:=COALESCE((packgoods1->>g)::numeric,0);
    IF cmd->>'op'='place' THEN
      IF h0+p0-h1-p1<>(CASE WHEN g='madera' THEN woodcost ELSE 0 END) THEN RETURN false; END IF;
    ELSE
      IF h1+p1<>h0+p0+(CASE WHEN g='madera' THEN refund ELSE 0 END) OR p1<p0 OR
         h1>h0+(CASE WHEN g='madera' THEN refund ELSE 0 END) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN n IS NOT DISTINCT FROM expectprofile AND ack->'rev' IS NOT DISTINCT FROM pg_catalog.to_jsonb((os->>'rev')::bigint+1);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.mn_workshop_raft_identifiers_ready()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object('version',1);
$function$;
REVOKE ALL ON FUNCTION public.mn_workshop_raft_identifiers_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mn_workshop_raft_identifiers_ready() TO service_role;
COMMIT;

-- SQL027 service-RPC canary. Every fixture mutation is rolled back.
-- Uses fictional identifiers only; creates no accounts, bindings, characters, credentials, or gameplay state.
BEGIN;
SET LOCAL ROLE service_role;
DO $canary$
DECLARE
  w text := 'l03d-control-canary';
  o uuid := '9a000001-0000-4000-8000-000000000001';
  c uuid := '9a000002-0000-4000-8000-000000000002';
  other_owner uuid := '9a000003-0000-4000-8000-000000000003';
  fixture_world text := 'l03d-control-canary-isolation';
  first_result jsonb; stop_result jsonb; replay_result jsonb; conflict_result jsonb;
BEGIN
  IF public.mn_companion_control_ready() IS DISTINCT FROM '{"version":1}'::jsonb OR
     public.mn_load_companion_control(w,o,c) IS DISTINCT FROM
       '{"revision":0,"stopped":true,"savedAt":null}'::jsonb THEN
    RAISE EXCEPTION 'readiness or stopped fixture baseline failed';
  END IF;

  -- Service role must use RPCs; it cannot read the private table directly.
  BEGIN
    PERFORM 1 FROM public.mn_companion_controls;
    RAISE EXCEPTION 'service role unexpectedly read private control table';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  first_result := public.mn_save_companion_control(w,o,c,0,false);
  IF first_result->'ok' IS DISTINCT FROM 'true'::jsonb OR first_result->'replay' IS DISTINCT FROM 'false'::jsonb OR
     first_result->'head'->'revision' IS DISTINCT FROM '1'::jsonb OR
     first_result->'head'->'stopped' IS DISTINCT FROM 'false'::jsonb OR
     first_result->'head'->'savedAt' IS NOT DISTINCT FROM 'null'::jsonb OR
     public.mn_load_companion_control(w,o,c) IS DISTINCT FROM first_result->'head' THEN
    RAISE EXCEPTION 'initial owner control save/load failed';
  END IF;

  stop_result := public.mn_save_companion_control(w,o,c,1,true);
  IF stop_result->'ok' IS DISTINCT FROM 'true'::jsonb OR stop_result->'replay' IS DISTINCT FROM 'false'::jsonb OR
     stop_result->'head'->'revision' IS DISTINCT FROM '2'::jsonb OR
     stop_result->'head'->'stopped' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'durable stop save failed';
  END IF;
  replay_result := public.mn_save_companion_control(w,o,c,1,true);
  IF replay_result->'ok' IS DISTINCT FROM 'true'::jsonb OR replay_result->'replay' IS DISTINCT FROM 'true'::jsonb OR
     replay_result->'head' IS DISTINCT FROM stop_result->'head' THEN
    RAISE EXCEPTION 'immediate exact stop retry failed';
  END IF;

  conflict_result := public.mn_save_companion_control(w,o,c,1,false);
  IF conflict_result->>'why' IS DISTINCT FROM 'conflict' OR
     conflict_result->'head' IS DISTINCT FROM stop_result->'head' OR
     public.mn_load_companion_control(w,other_owner,c) IS DISTINCT FROM
       '{"revision":0,"stopped":true,"savedAt":null}'::jsonb OR
     public.mn_load_companion_control(fixture_world,o,c) IS DISTINCT FROM
       '{"revision":0,"stopped":true,"savedAt":null}'::jsonb THEN
    RAISE EXCEPTION 'CAS conflict or owner/world isolation failed';
  END IF;
END
$canary$;
ROLLBACK;

-- These post-rollback RPC reads prove the fixture is absent without direct table access.
SELECT 'SQL027 service stop/replay/conflict/isolation passed; fixture rolled back' AS passed,
  public.mn_companion_control_ready() AS readiness,
  (public.mn_load_companion_control('l03d-control-canary',
    '9a000001-0000-4000-8000-000000000001','9a000002-0000-4000-8000-000000000002') =
      '{"revision":0,"stopped":true,"savedAt":null}'::jsonb) AS fixture_absent;

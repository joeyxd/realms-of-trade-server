-- SQL025-only service RPC canary. All fixture writes are rolled back.
-- No account, companion binding, provider, budget or gameplay activation is created.
BEGIN;
SET LOCAL ROLE service_role;
DO $canary$
DECLARE
  w text := 'qa-companion-config-sql025-20261010';
  o uuid := '22222222-2222-4222-8222-222222222222';
  c uuid := '33333333-3333-4333-8333-333333333333';
  other_owner uuid := '44444444-4444-4444-8444-444444444444';
  cfg jsonb := '{"v":1,"personality":"Amable y prudente.","goals":[]}';
  first_result jsonb; replay_result jsonb; conflict_result jsonb;
BEGIN
  IF public.mn_companion_config_ready() IS DISTINCT FROM '{"version":1}'::jsonb OR
     public.mn_load_companion_config(w,o,c)->'revision' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'readiness or fixture baseline failed';
  END IF;
  first_result := public.mn_save_companion_config(w,o,c,0,cfg);
  IF first_result->'ok' IS DISTINCT FROM 'true'::jsonb OR first_result->'replay' IS DISTINCT FROM 'false'::jsonb OR
     first_result->'head'->'revision' IS DISTINCT FROM '1'::jsonb OR
     public.mn_load_companion_config(w,o,c) IS DISTINCT FROM first_result->'head' THEN
    RAISE EXCEPTION 'service save/load failed';
  END IF;
  replay_result := public.mn_save_companion_config(w,o,c,0,cfg);
  IF replay_result IS DISTINCT FROM first_result||'{"replay":true}'::jsonb THEN
    RAISE EXCEPTION 'immediate exact retry failed';
  END IF;
  conflict_result := public.mn_save_companion_config(w,o,c,0,'{"v":1,"personality":"Otra.","goals":[]}');
  IF conflict_result->>'why' IS DISTINCT FROM 'conflict' OR
     conflict_result->'head' IS DISTINCT FROM first_result->'head' OR
     public.mn_load_companion_config(w,other_owner,c)->'revision' IS DISTINCT FROM '0'::jsonb OR
     public.mn_load_companion_config(w||'-other',o,c)->'revision' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'CAS or private scope failed';
  END IF;
END
$canary$;
ROLLBACK;
SELECT 'SQL025 service save/load/replay/conflict/isolation passed; fixture rolled back' AS result,
  public.mn_companion_config_ready() AS readiness,
  public.mn_load_companion_config('qa-companion-config-sql025-20261010',
    '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333')->'revision' = '0'::jsonb AS fixture_absent;

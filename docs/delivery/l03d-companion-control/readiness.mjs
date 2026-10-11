// Read-only SQL027 readiness and fictional canary-scope probe. Never prints credentials or provider error details.
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('service environment required');

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const world = 'l03d-control-canary';
const owner = '9a000001-0000-4000-8000-000000000001';
const character = '9a000002-0000-4000-8000-000000000002';

const readiness = await client.rpc('mn_companion_control_ready');
const fixture = await client.rpc('mn_load_companion_control', {
  p_world: world, p_owner: owner, p_character: character,
});
const version = readiness.data?.version ?? null;
const fixtureAbsent = !fixture.error && fixture.data?.revision === 0 &&
  fixture.data?.stopped === true && fixture.data?.savedAt === null;
const report = {
  at: new Date().toISOString(),
  ok: !readiness.error && version === 1 && fixtureAbsent,
  version,
  fixtureAbsent,
  readinessErrorCode: typeof readiness.error?.code === 'string' ? readiness.error.code : null,
  fixtureErrorCode: typeof fixture.error?.code === 'string' ? fixture.error.code : null,
};
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;

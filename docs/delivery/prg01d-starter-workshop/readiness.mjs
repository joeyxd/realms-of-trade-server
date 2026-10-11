// Read-only check, run with the live container's existing environment. Never prints credentials.
import { createClient } from '@supabase/supabase-js';
const env = process.env;
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw Error('storage environment unavailable');
const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const checks = [];
for (const name of ['mn_ground_world_adoption_ready', 'mn_starter_workshop_ready']) {
  const { data, error } = await client.rpc(name);
  checks.push({ function: name, ready: !error && data?.version === 1, code: error?.code ?? null });
}
console.log(JSON.stringify({ at: new Date().toISOString(), scope: 'readiness only; no migrations or activation', checks }));

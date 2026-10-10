// Read-only probe. Run with the existing service environment injected; never prints credentials.
import { createClient } from '@supabase/supabase-js';
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('service environment required');
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data, error } = await client.rpc('mn_companion_config_ready');
const report = { at: new Date().toISOString(), rpc: 'mn_companion_config_ready',
  ok: !error && data?.version === 1, version: data?.version ?? null,
  code: typeof error?.code === 'string' ? error.code : null };
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;

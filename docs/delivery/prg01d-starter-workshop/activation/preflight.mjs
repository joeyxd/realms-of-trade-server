// Read-only live storage evidence. Run with the existing container environment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from './server/store.mjs';
import { upgradeTimingState } from './server/resourceState.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const readiness = [];
for (const name of ['mn_ground_world_adoption_ready', 'mn_starter_workshop_ready',
  'mn_fire_operations_ready', 'mn_artisan_operations_ready']) {
  const { data, error } = await admin.rpc(name);
  assert.equal(error, null, 'required readiness RPC unavailable');
  assert.equal(data?.version, 1);
  readiness.push({ function: name, version: data.version });
}
const { data: adoption, error } = await admin.rpc('mn_load_ground_world_adoption', { p_world: 'marea-negra' });
assert.equal(error, null);
const row = await storeFromEnv().loadWorld('marea-negra');
assert.ok(row?.data?.resources);
const resources = row.data.resources, upgraded = upgradeTimingState(resources);
console.log(JSON.stringify({ at: new Date().toISOString(), readiness, adopted: adoption !== null,
  worldVersion: row.version, resourceVersion: resources.v, tick: resources.tick,
  nodes: resources.nodes.length, palms: resources.nodes.filter(n => n.kind === 'palm').length,
  nodesHash: hash(resources.nodes), cooldownsHash: hash(resources.cooldowns),
  communityHash: hash(row.data.community), seedHash: hash(row.data.seed),
  upgradedLoggingHash: hash(upgraded.logging), currentLoggingHash: hash(resources.logging),
  flags: Object.fromEntries(['MN_ECONOMIC_OPERATIONS', 'MN_RESOURCE_OPERATIONS', 'MN_LOGGING_OPERATIONS',
    'MN_ARTISAN_OPERATIONS', 'MN_STARTER_WORKSHOP'].map(key => [key, process.env[key] === '1'])) }));

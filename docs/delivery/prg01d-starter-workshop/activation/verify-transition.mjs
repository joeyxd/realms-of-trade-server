// Read-only reconciliation of the accepted v2 baseline after the single live switch.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { storeFromEnv } from './server/store.mjs';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const before = { at: '2026-10-11T00:27:31.126Z', worldVersion: 1786, resourceVersion: 2,
  tick: 1196614, nodes: 206, palms: 96,
  nodesHash: 'd3aa97473b54bb0dc106a4b87c4551111c93f474fdccfde47c2becaaf35adf7f',
  cooldownsHash: '31353ec3ee69ca4d6faf30500dae45ac473aec4994ae70253f304401b0475139',
  communityHash: '781ca7a01c3667c00ec0d3b52ae62309c9fbf76bf5dc86f9c7578e7fd17605cc',
  seedHash: '7917b9e625509f18724bbbd564e20f80101b814d2b61c6dcf4c0aa8d3ce34c83',
  loggingV2Hash: 'd26519f1998eb31affa887176797eda66dc85c4eb5bc74b8306e5271d2d4191b' };
const row = await storeFromEnv().loadWorld('marea-negra'), r = row.data.resources;
assert.equal(r.v, 3);
const legacyLedger = Object.fromEntries(Object.entries(r.logging).map(([id, value]) => {
  if (value === null) return [id, null];
  assert.equal(value.quality, 0, 'unexpected retroactive timing reward');
  const { quality, ...prior } = value;
  return [id, prior];
}));
const after = { worldVersion: row.version, resourceVersion: r.v, tick: r.tick,
  nodes: r.nodes.length, palms: r.nodes.filter(n => n.kind === 'palm').length,
  nodesHash: hash(r.nodes), cooldownsHash: hash(r.cooldowns), communityHash: hash(row.data.community),
  seedHash: hash(row.data.seed), loggingV2Hash: hash(legacyLedger) };
for (const key of ['nodes', 'palms', 'nodesHash', 'cooldownsHash', 'communityHash', 'seedHash', 'loggingV2Hash'])
  assert.equal(after[key], before[key], 'durable baseline changed: ' + key);
assert.ok(after.tick >= before.tick);
const status = await (await fetch('http://127.0.0.1:5173/status')).json();
assert.deepEqual(status.storage.workshop, { enabled: true, ready: true });
assert.deepEqual(status.storage.artisan, { enabled: true, ready: true });
assert.equal(status.errors, 0); assert.equal(status.storage.errors, 0);
console.log(JSON.stringify({ at: new Date().toISOString(), pass: true, before, after, status,
  reconciliation: 'Initial post-switch hash compared JS insertion order with JSONB key order. The unchanged v2 projection and every added quality=0 are now verified directly.',
  limits: ['Offline pause not remeasured.', 'Authenticated gameplay canary is the next check.'] }));

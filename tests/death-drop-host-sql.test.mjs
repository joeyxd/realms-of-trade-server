import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/death-drop-journal-sql.mjs';
import { fixture, deferred, focusDrop, wireEvents } from './helpers/death-drop-host.mjs';

test('SDK/SQL012: real death source pickup persists before host apply and carries exact profile version', async () => {
  const requests = [], f = await fixture({ backend: database, wrap: store => ({ ...store, async commitDeathDrop(r) {
    requests.push(structuredClone(r)); return store.commitDeathDrop(r);
  } }) });
  try {
    const item = (await f.makeDrops()).find(d => d.kind === 'item'); focusDrop(f, item);
    assert.equal(f.server.step(), false); await f.host.deathDropStaging.settle();
    const durable = await f.db.store.loadDeathDrop(item.operationId, item.ordinal);
    assert.equal(durable.state, 'picked'); assert.equal(durable.version, 2);
    assert.equal(f.world.drops.has(item.id), true); assert.equal(wireEvents(f, 'pickup').length, 0);
    assert.equal(f.server.step(), true); assert.equal(f.world.drops.has(item.id), false);
    assert.equal(requests.length, 1); assert.equal(requests[0].drop.expectedVersion, 1);
    const saved = await f.db.store.loadProfile(requests[0].profile.id);
    assert.equal(saved.version, requests[0].profile.expectedVersion + 1);
    assert.equal(saved.data.bag.at(-1).u, requests[0].profile.before.uid);
    assert.equal(saved.data.stats.items, requests[0].profile.before.stats.items + 1);
    const intents = (await f.db.db.query("select family,scope,request,state from public.mn_pearl_intents where family='drop' and request->>'mode'='pickup'")).rows;
    assert.equal(intents.length, 1); assert.equal(intents[0].state, 'committed');
    const { operationId: _operationId, ...exact } = requests[0]; assert.deepEqual(intents[0].request, exact);
  } finally { await f.close(); }
});

test('SDK/SQL012: expiration reaches terminal journal state before source removal', async () => {
  const f = await fixture({ backend: database });
  try {
    const drops = await f.makeDrops(), drop = drops[0];
    assert.ok(drop);
    f.world.tick = Math.max(f.world.tick, ...drops.map(d => d.t + 1)); f.world.tick += (3 - f.world.tick % 3) % 3;
    const frozen = f.world.tick; assert.equal(f.server.step(), false);
    await f.host.deathDropStaging.settle();
    assert.equal(f.world.tick, frozen);
    for (let n = 0; n < drops.length * 2 + 2 && drops.some(d => f.world.drops.has(d.id)); n++) {
      if (!f.server.step()) await f.host.deathDropStaging.settle();
    }
    for (const d of drops) assert.equal((await f.db.store.loadDeathDrop(d.operationId, d.ordinal)).state, 'expired');
    assert.ok(drops.every(d => !f.world.drops.has(d.id)));
    assert.equal(f.world.tick, frozen + 1);
  } finally { await f.close(); }
});

test('SDK/SQL012: lost successful commit reply retries the exact journaled request and applies once', async () => {
  const entered = deferred(), release = deferred(), requests = [];
  const f = await fixture({ backend: database, wrap: store => ({ ...store, async commitDeathDrop(r) {
    requests.push(structuredClone(r));
    const committed = await store.commitDeathDrop(r); entered.resolve();
    if (requests.length === 1) { await release.promise; throw new Error('first reply lost after commit'); }
    return committed;
  } }) });
  try {
    const drop = (await f.makeDrops()).find(d => d.kind === 'item'); focusDrop(f, drop);
    const originalBag = structuredClone(f.world.profiles.get(f.killer).bag); assert.equal(f.server.step(), false); await entered.promise;
    assert.equal(f.world.tick % 3, 0); assert.equal(f.world.drops.has(drop.id), true);
    release.resolve(); await f.host.deathDropStaging.settle();
    assert.equal(f.world.drops.has(drop.id), true); assert.deepEqual(f.world.profiles.get(f.killer).bag, originalBag);
    assert.equal(wireEvents(f, 'pickup').length, 0);
    assert.equal(f.server.step(), true);
    assert.equal(f.world.drops.has(drop.id), false); assert.equal(wireEvents(f, 'pickup').length, 1);
    assert.ok(requests.length >= 1 && requests.length <= 2);
    assert.ok(requests.every(r => JSON.stringify(r) === JSON.stringify(requests[0])));
    assert.equal((await f.db.store.loadDeathDrop(drop.operationId, drop.ordinal)).state, 'picked');
    const journal = (await f.db.db.query("select family,scope,request,state from public.mn_pearl_intents where family='drop' and request->>'mode'='pickup'")).rows;
    assert.equal(journal.length, 1); assert.equal(journal[0].state, 'committed');
    const { operationId: _operationId, ...exact } = requests[0]; assert.deepEqual(journal[0].request, exact);
  } finally { release.resolve(); await f.close(); }
});

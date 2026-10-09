import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, WORLD } from './helpers/pearl-lifecycle-host.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';

for (const drift of ['tick', 'rng', 'allocator', 'eventBuffer', 'source', 'operationMap']) {
  test(`return wait fences ${drift} drift before a reply can authorize publication`, async () => {
    const f = await fixture({ pearls: [{ uid: 'boundary-return', kind: 'escarcha', returnIn: 9 }] });
    const gate = f.holdNextCommit();
    try {
      f.quiet(f.entities); const source = f.drops[0]; f.world.tick = 12;
      assert.equal(f.server.step(), false); await gate.entered.promise;
      const destination = await f.base.loadPearlLocation(source.pearl.uid);
      assert.equal(destination.version, 2);
      if (drift === 'tick') f.world.tick++;
      if (drift === 'rng') f.world.lootRng();
      if (drift === 'allocator') f.world.nextDrop++;
      if (drift === 'eventBuffer') f.world.events = [];
      if (drift === 'source') source.pearl.kind = 'tinta';
      if (drift === 'operationMap') f.lifecycle.returnStaging.operations.clear();
      assert.equal(f.server.step(), false, 'detect drift while the storage reply is still held');
      assert.equal(f.host.closing, true); assert.equal(f.lifecycle.failed, true);
      assert.equal(f.world.drops.get(source.id), source);
      assert.equal(f.output('pearlReturn').length, 0);
      assert.equal(f.output('loot').length, 0);
      gate.release.resolve(); await f.lifecycle.settle();
      assert.deepEqual(await f.base.loadPearlLocation(source.pearl.uid), destination);
      assert.equal(f.world.drops.get(source.id), source);
    } finally { gate.release.resolve(); await f.close(); }
  });
}

test('source reservation freezes selection, publication and the world rather than switching winners', async () => {
  const f = await fixture();
  const mutationGate = pearlMutationGate(f.host.profiles), source = f.drops[0];
  const reservation = mutationGate.reserve({ uids: [source.pearl.uid] });
  let released = false;
  try {
    f.position(f.entities[0], source); f.position(f.entities[1], source);
    assert.equal(f.server.step(), false); assert.equal(f.world.tick, 0);
    assert.equal(f.lifecycle.pending, false); assert.equal(f.lifecycle.reserved, 0);
    assert.equal(f.world.drops.get(source.id), source); assert.equal(f.output('pickup').length, 0);
    mutationGate.release(reservation); released = true;
    assert.equal(f.server.step(), false); await f.lifecycle.settle(); assert.equal(f.server.step(), true);
    assert.equal((await f.base.loadUnique(source.pearl.uid)).holder, f.host.profiles.clients.get(1).key);
  } finally { if (!released) mutationGate.release(reservation); await f.close(); }
});

for (const malformed of ['kind', 'clockAccessor', 'partialMarker', 'ordinaryIdentity']) {
  test(`malformed projected source ${malformed} cannot fall through to native pickup`, async () => {
    const f = await fixture(); let reads = 0;
    try {
      const source = f.drops[0]; f.position(f.entities[0], source);
      if (malformed === 'kind') source.kind = 'gold';
      if (malformed === 'clockAccessor') Object.defineProperty(source, 'groundClock', { enumerable: true,
        configurable: true, get() { reads++; throw new Error('must not evaluate metadata'); } });
      if (malformed === 'partialMarker') source.groundClock = { domain: 'durable-ground-v1' };
      if (malformed === 'ordinaryIdentity') { source.operationId = '77300000-0000-4000-8000-000000000001'; source.ordinal = 1; }
      assert.equal(f.server.step(), false); assert.equal(f.host.closing, true);
      assert.equal(f.world.drops.get(source.id), source); assert.equal(reads, 0);
      assert.equal(f.output('pickup').length, 0); assert.equal(f.output('unloot').length, 0);
      assert.equal((await f.base.loadUnique('host-pearl-1')).holder, null);
    } finally { await f.close(); }
  });
}

test('mount configuration accessors are rejected without running caller code', async () => {
  const f = await fixture({ mount: false }); let reads = 0;
  try {
    const options = { scope: WORLD };
    Object.defineProperty(options, 'deadlineClock', { enumerable: true, get() { reads++; return f.clock; } });
    assert.throws(() => f.host.mountPearlStaging(options), { code: 'configuration' });
    assert.equal(f.host.pearlStaging, null); assert.equal(reads, 0);
    f.host.mountPearlStaging({ scope: WORLD, deadlineClock: f.clock });
    const startup = { accountPolicy: 'accounts-only' };
    Object.defineProperty(startup, 'deathDrops', { enumerable: true, get() { reads++; return true; } });
    assert.throws(() => f.host.mountPearlStartup(startup), { code: 'configuration' });
    assert.equal(reads, 0); assert.equal(f.host.pearlStartup, null);
  } finally { await f.close(); }
});

test('joint ground ownership must mount exactly once before startup, with its ordinary owner installed', async () => {
  const f = await fixture({ mount: false });
  try {
    const h = f.host;
    h.mountPearlStaging({ scope: WORLD, deadlineClock: f.clock });
    h.mountDeathStaging({ scope: WORLD }); h.mountCombatDeaths();
    assert.throws(() => h.mountPearlGround(), { code: 'configuration' });
    h.mountDeathDrops(); assert.throws(() => h.mountPearlGround({}), { code: 'configuration' });
    const ground = h.mountPearlGround(); assert.equal(h.pearlGround, ground);
    assert.throws(() => h.mountPearlGround(), { code: 'configuration' });
    h.mountPearlStartup({ accountPolicy: 'accounts-only', deathDrops: true });
    await h.prepare(); assert.throws(() => h.mountPearlGround(), { code: 'configuration' });
  } finally { await f.close(); }
});

test('held pickup blocks all direct LocalServer publication and prevents trusted death dispatch', async () => {
  const f = await fixture(), gate = f.holdNextCommit();
  try {
    const source = f.drops[0]; f.position(f.entities[0], source);
    assert.equal(f.server.step(), false); await gate.entered.promise;
    const before = f.sockets.map(s => s.messages.length);
    assert.equal(f.server.sendProfile(1, f.server.clients.get(1)), false);
    f.server.flushEvents(); f.server.broadcastSnapshot(); f.server.waitForTick(1);
    assert.deepEqual(f.sockets.map(s => s.messages.length), before);
    assert.throws(() => f.host.requestDeath({ victim: { clientId: 2, entity: f.entities[1] }, seq: 1 }), { code: 'unavailable' });
    assert.equal(f.host.status().storage.pearlGround.pending, 1);
    gate.release.resolve(); await f.lifecycle.settle(); assert.equal(f.server.step(), true);
    assert.equal(f.host.status().storage.pearlGround.pending, 0);
  } finally { gate.release.resolve(); await f.close(); }
});

for (const replacement of ['null', 'function']) {
  test(`completion owner replaced with ${replacement} during world step cannot bypass publication hold`, async () => {
    const f = await fixture(); let calls = 0;
    try {
      f.quiet(f.entities);
      const step = f.world.stepWorld.bind(f.world);
      f.world.stepWorld = () => {
        step(); f.world.emit({ type: 'pearlReturn', uid: 'must-not-publish', x: 0, z: 0, zone: 'fixture' });
        f.server.afterTick = replacement === 'null' ? null : () => { calls++; return true; };
      };
      assert.throws(() => f.server.step(), /completion owner/);
      assert.equal(calls, 0); assert.equal(f.host.closing, true);
      assert.equal(f.output('pearlReturn').length, 0);
      const tick = f.world.tick; assert.equal(f.server.step(), false); assert.equal(f.world.tick, tick);
    } finally { await f.close(); }
  });
}

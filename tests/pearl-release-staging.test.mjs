import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { PearlGroundHydration } from '../server/pearlGroundHydration.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { GameHost } from '../server/host.mjs';
import { StoreError, createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { leavePearl } from '../src/sim/systems/pearls.js';
import { World } from '../src/sim/world.js';
import { installInventory, newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION, quantAxis } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PEARL } from '../src/data/pearls.js';
import { DT } from '../src/data/tuning.js';
import { fixture, WORLD, accounts, incomingUid, outgoingUid, deferred, state, row } from './helpers/pearl-replace-staging.mjs';
import { database as sql } from './helpers/pearl-batch-journal-sql.mjs';
import { map } from './helpers.mjs';

const copy = (v) => structuredClone(v);
const turn = () => new Promise((resolve) => setImmediate(resolve));
const source = (f, i = 0) => ({ clientId: i + 1, entity: f.entities[i] });
const request = (f, action = 'leave') => ({ action, uid: incomingUid, source: source(f) });
const held = (f, uid) => {
  assert.throws(() => f.staging.assertAvailable({ accounts: [accounts[0]] }), { code: 'busy' });
  assert.throws(() => f.staging.assertAvailable({ uids: [uid] }), { code: 'busy' });
  assert.throws(() => f.staging.gate.assertWorldAvailable(), { code: 'busy' });
};
async function apply(f, raw) {
  const handle = f.staging.request(raw); await f.staging.settle();
  assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
  await f.sessions.flush(); return handle;
}
function helperView(f) {
  const w = f.world;
  return { ecs: copy(w.ecs), map: w.map, raftDeck: w.raftDeck, tick: w.tick, nextDrop: w.nextDrop,
    drops: copy(w.drops), profiles: copy(w.profiles), pearlLedger: copy(w.pearlLedger), profileDirty: new Set(),
    events: [], emit(event) { this.events.push(copy(event)); } };
}

for (const [name, backend] of [['memory', undefined], ['SDK/SQL001-008 local', sql]]) {
  for (const action of ['leave']) {
    test(`${name}: ${action} conserves the real helper delta until receipt and one drain`, { timeout: 15000 }, async () => {
      const entered = deferred(), release = deferred(); let raw;
      const f = await fixture({ backend, wrapStore: (base) => ({ ...base, async commitPearlGround(dto) {
        raw = copy(dto); const result = await base.commitPearlGround(dto); entered.resolve(); await release.promise; return result;
      } }) });
      try {
        const e = f.entities[0], w = f.world, cmd = request(f, action), expected = helperView(f);
        assert.equal(leavePearl(expected, e, cmd.uid), true);
        const before = state(w), handle = f.staging.request(cmd); held(f, cmd.uid);
        assert.deepEqual(state(w), before); assert.deepEqual(f.staging.drain(), []);
        await entered.promise; assert.deepEqual(state(w), before); held(f, cmd.uid);
        const durable = await f.base.loadProfile(accounts[0]);
        assert.deepEqual(durable.data.pearls, expected.profiles.get(e).pearls);
        assert.equal(raw.operationId, handle.operationId); assert.equal(raw.from, accounts[0]); assert.equal(raw.to, null);
        assert.equal(raw.expectedVersion, 1); assert.equal(raw.world, WORLD);
        const plannedDrop = [...expected.drops.values()].at(-1);
        assert.deepEqual(raw.ground, { x: plannedDrop.x, z: plannedDrop.z,
          availableAt: w.tick + 30, returnAt: w.tick + Math.round(PEARL.returnAfter / DT) });
        assert.equal((await f.base.loadUnique(cmd.uid)).holder, null);
        release.resolve(); await f.staging.settle(); assert.deepEqual(state(w), before);
        assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
        assert.deepEqual(w.profiles.get(e).pearls, expected.profiles.get(e).pearls);
        assert.deepEqual(row(w.ecs, e), row(expected.ecs, e));
        assert.deepEqual(w.drops, expected.drops); assert.deepEqual(w.pearlLedger, expected.pearlLedger);
        assert.deepEqual(w.events.map((ev) => ev.type), ['loot', 'pearlChanged']); assert.equal(w.events[1].op, action);
        assert.equal(w.events[1].elem, 4);
        assert.deepEqual(w.events[0].drops[0], expected.events[0].drops[0]);
        await f.sessions.flush();
        const stored = await f.base.loadProfile(accounts[0]); assert.deepEqual(stored.data, w.profiles.get(e));
        assert.equal(stored.data.gold, 37); assert.equal(stored.data.xp, 21); assert.deepEqual(stored.data.mast[0], [3, 123]);
        assert.deepEqual(await f.base.loadUnique(cmd.uid), { kind: `pearl:${plannedDrop.pearl.kind}`, holder: null, version: 2 });
        assert.deepEqual(await f.base.loadPearlLocation(cmd.uid), { world: WORLD, ground: raw.ground, version: 2 });
        assert.deepEqual(await f.journal.list(), []);
        const after = state(w); assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(w), after);
        f.staging.gate.assertWorldAvailable();
      } finally { release.resolve(); await f.staging.settle(); await f.close(); }
    });

    test(`${name}: ${action} lost response replays the exact ground request and restart hydrates current ground`, { timeout: 15000 }, async () => {
      const sent = []; let lost = false;
      const f = await fixture({ backend, wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
        sent.push(copy(raw)); const receipt = await base.commitPearlGround(raw);
        if (!lost) { lost = true; throw new StoreError('unavailable'); } return receipt;
      } }) });
      try {
        const h = f.staging.request(request(f, action)), before = state(f.world); await f.staging.settle();
        assert.deepEqual(state(f.world), before); assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
        assert.equal(sent[0].operationId, h.operationId);
        // Reconstruct from committed authority without running the old coordinator's apply/events.
        const sessions = new ProfileSessions(f.base, () => {}, { journal: f.journal }); await sessions.recoverPearls();
        const restored = new World(42, { map, server: true }); installInventory(restored, WORLD); restored.events.length = 0;
        const rng = [restored.rng.state(), restored.lootRng.state()];
        const hydration = new PearlGroundHydration({ sessions, world: restored, worldId: WORLD,
          mapClock: (ground) => ({ availableAt: ground.availableAt, returnAt: ground.returnAt }) });
        assert.deepEqual(await hydration.start(), { state: 'ready', count: 1 }); assert.equal(restored.drops.size, 0);
        assert.deepEqual(hydration.drain(), { state: 'applied', count: 1 }); assert.deepEqual(restored.events, []);
        assert.deepEqual([restored.rng.state(), restored.lootRng.state()], rng);
        const d = [...restored.drops.values()][0]; assert.equal(d.pearl.uid, sent[0].uid);
        assert.deepEqual({ x: d.x, z: d.z, availableAt: d.pickAt, returnAt: d.t }, sent[0].ground);
        assert.equal((await sessions.open(99, accounts[0])).pearls.bag.some((q) => q.uid === d.pearl.uid), false);
        assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed?.uid === d.pearl.uid, false);
        assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]); await f.sessions.flush();
        assert.equal(f.world.drops.size, 1); assert.equal((await f.base.loadUnique(d.pearl.uid)).version, 2);
        assert.deepEqual(f.staging.drain(), []);
      } finally { await f.close(); }
    });

    test(`${name}: ${action} external ground CAS after queue verification fences without replan`, { timeout: 15000 }, async () => {
      let sends = 0;
      const f = await fixture({ backend, wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
        sends++;
        const row = await base.loadProfile(accounts[0]), data = copy(row.data);
        data.pearls.bag = data.pearls.bag.filter((q) => q.uid !== raw.uid);
        if (data.pearls.swallowed?.uid === raw.uid) data.pearls.swallowed = null;
        const external = { ...raw, operationId: '61000000-0000-4000-8000-000000009019',
          ground: { ...raw.ground, x: raw.ground.x + 1 }, profiles: [{ id: accounts[0], expectedVersion: row.version, data }] };
        assert.equal((await base.commitPearlGround(external)).ok, true);
        return base.commitPearlGround(raw);
      } }) });
      try {
        const before = state(f.world), h = f.staging.request(request(f, action)); await f.staging.settle();
        assert.equal(sends, 1); assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code: 'conflict' }]);
        assert.deepEqual(state(f.world), before); held(f, request(f, action).uid);
        assert.equal(f.staging.operations.get(h.operationId).plan.meta.expectedVersion, 1);
        assert.equal((await f.base.loadUnique(request(f, action).uid)).version, 2); assert.deepEqual(await f.journal.list(), []);
      } finally { await f.close(); }
    });
  }
}

test('managed releases use advancing generations and retain unrelated inventory order', async () => {
  const sent = [];
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) { sent.push(copy(raw)); return base.commitPearlGround(raw); } }) });
  try {
    await apply(f, { action: 'give', uid: incomingUid, source: source(f), target: source(f, 1) });
    await apply(f, { action: 'give', uid: incomingUid, source: source(f, 1), target: source(f) });
    await apply(f, request(f, 'leave')); assert.equal(sent.at(-1).expectedVersion, 3);
    assert.deepEqual(f.world.profiles.get(f.entities[0]).pearls.bag.map((q) => q.uid), ['batch-a', 'batch-c']);
    assert.throws(() => f.staging.request({ action: 'spit', uid: outgoingUid, source: source(f) }), { code: 'bound' });
    assert.equal(f.world.drops.size, 1); assert.equal(f.world.profiles.get(f.entities[0]).pearls.swallowed.uid, outgoingUid);
  } finally { await f.close(); }
});

for (const kind of ['brasa', 'escarcha', 'tormenta', 'tinta']) test(`leaving a bag pearl of ${kind} preserves the bound power and mastery`, async () => {
  const f = await fixture({ incomingKind: kind });
  try {
    const e = f.entities[0], w = f.world, p = w.profiles.get(e), mastery = copy(p.mast), active = copy(p.pearls.swallowed);
    const h = f.staging.request(request(f)); await f.staging.settle();
    w.ecs.hp[e] = 13; w.ecs.gBuf[e] = 0.9; w.ecs.waterT[e] = 2; w.ecs.castK[e] = 1;
    const current = row(w.ecs, e);
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]);
    assert.equal(w.ecs.elem[e], 4); assert.deepEqual(row(w.ecs, e), current);
    assert.deepEqual(p.pearls.swallowed, active); assert.deepEqual(p.mast, mastery);
    assert.equal((await f.base.loadUnique(incomingUid)).version, 2); await f.sessions.flush();
    assert.deepEqual((await f.base.loadProfile(accounts[0])).data.mast, mastery);
  } finally { await f.close(); }
});

for (const action of ['leave']) test(`trusted ${action} generation entry still commits and applies a known managed UID`, async () => {
  const f = await fixture();
  try {
    const { action: _action, ...q } = request(f, action), h = f.staging[action]({ ...q, expectedVersion: 1 });
    const before = state(f.world); await f.staging.settle(); assert.deepEqual(state(f.world), before);
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]); await f.sessions.flush();
    assert.equal((await f.base.loadUnique(q.uid)).holder, null); assert.equal(f.world.drops.size, 1);
  } finally { await f.close(); }
});

for (const action of ['leave']) test(`${action} freezes the existing checkpoint/deck ground decision`, async (t) => {
  for (const mode of ['checkpoint', 'deck']) await t.test(mode, async () => {
    const f = await fixture();
    try {
      const w = f.world, e = f.entities[0];
      if (mode === 'checkpoint') { w.ecs.x[e] = 100000; w.ecs.z[e] = 100000; }
      else {
        w.map = { ...w.map, groundAt: () => -20, onDock: () => false, queryColliders: () => [] };
        w.raftDeck = { surface: () => ({ y: 0.3 }), blocked: () => false };
      }
      const q = request(f, action), before = state(w), h = f.staging.request(q), plan = f.staging.operations.get(h.operationId).plan;
      const expected = mode === 'checkpoint' ? { x: w.ecs.cpX[e], z: w.ecs.cpZ[e] } :
        { x: w.ecs.x[e] + Math.sin(w.ecs.facing[e]) * 2.3, z: w.ecs.z[e] + Math.cos(w.ecs.facing[e]) * 2.3 };
      assert.deepEqual({ x: plan.drop.x, z: plan.drop.z }, expected); assert.deepEqual(state(w), before);
      await f.staging.settle(); assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]);
      assert.deepEqual((await f.base.loadPearlLocation(q.uid)).ground, plan.meta.ground); await f.sessions.flush();
    } finally { await f.close(); }
  });
});

test('release IO keeps frozen geometry and captures current ECS/profile progress at commit and apply', async () => {
  const entered = deferred(), reply = deferred(); let armed = false, raw;
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async loadUnique(uid) { if (armed) { armed = false; entered.resolve(); await reply.promise; } return base.loadUnique(uid); },
    async commitPearlGround(dto) { raw = copy(dto); return base.commitPearlGround(dto); },
  }) });
  try {
    const w = f.world, e = f.entities[0], p = w.profiles.get(e), ecs = w.ecs;
    f.staging = new PearlStaging(f.sessions, w, WORLD, { captureProfile: (_id, entity) => capturePearlProfile(w, entity) });
    armed = true; const h = f.staging.request(request(f, 'leave')); await entered.promise;
    const planned = copy(f.staging.operations.get(h.operationId).plan.drop);
    p.gold = 73; p.mast[0][0] = 7; p.stats.kills = 18; ecs.level[e] = 4; ecs.xp[e] = 33.17; ecs.potions[e] = 3;
    ecs.x[e] += 21; ecs.z[e] -= 8; ecs.regenT[e] = 0; w.tick += 80;
    // An unrelated drop ID created during the wait is preserved; geometry is not recomputed.
    w.drops.set(71, { id: 71, kind: 'gold', n: 3 }); w.nextDrop = 72;
    reply.resolve(); await f.staging.settle();
    assert.equal(raw.profiles[0].data.lvl, 4); assert.equal(raw.profiles[0].data.xp, 33.17); assert.equal(raw.profiles[0].data.pot, 3);
    assert.equal(raw.profiles[0].data.gold, 73); assert.deepEqual(raw.ground,
      { x: planned.x, z: planned.z, availableAt: planned.pickAt, returnAt: planned.t });
    p.gold = 81; ecs.xp[e] = 41.29; ecs.potions[e] = 2; ecs.gBuf[e] = 0.7; ecs.waterT[e] = 2;
    const expectedEcs = copy(ecs);
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]);
    assert.deepEqual(row(ecs, e), row(expectedEcs, e)); assert.equal(p.gold, 81); assert.equal(p.xp, 41.29);
    assert.deepEqual(w.drops.get(72), { ...planned, id: 72 }); assert.deepEqual(w.drops.get(71), { id: 71, kind: 'gold', n: 3 });
    assert.equal(w.events.at(-2).drops[0].id, 72); assert.equal(w.pearlLedger.get(incomingUid).drop, 72);
    await f.sessions.flush(); assert.deepEqual((await f.base.loadProfile(accounts[0])).data, p);
    assert.deepEqual((await f.base.loadPearlLocation(incomingUid)).ground, raw.ground);
  } finally { reply.resolve(); await f.staging.settle(); await f.close(); }
});

test('release preflight denies without IO, RNG, events or reservations', async (t) => {
  const cases = [
    ['leave', 'swallowed UID cannot be left', (_f, q) => { q.uid = outgoingUid; }],
    ['leave', 'bag UID missing', (f) => { f.world.profiles.get(f.entities[0]).pearls.bag = []; }],
    ...['leave'].flatMap((action) => [
      [action, 'combat', (f) => { f.world.ecs.regenT[f.entities[0]] = 0; }],
      [action, 'wrong owner', (f, q) => { f.world.pearlLedger.get(q.uid).owner = `account:${accounts[1]}`; }],
      [action, 'recycled actor', (f) => { f.world.ecs.clientId[f.entities[0]] = 99; }],
      [action, 'invalid ground clock', (f) => { f.world.tick = -40; }],
      [action, 'injected generation', (_f, q) => { q.expectedVersion = 1; }],
      [action, 'injected destination', (_f, q) => { q.ground = { x: 0, z: 0 }; }],
    ]),
  ];
  for (const [action, name, alter] of cases) await t.test(`${action}: ${name}`, async () => {
    let reads = 0;
    const f = await fixture({ wrapStore: (base) => ({ ...base, async loadUnique(uid) { reads++; return base.loadUnique(uid); } }) });
    try {
      reads = 0; const q = request(f, action); alter(f, q); const before = state(f.world);
      assert.throws(() => f.staging.request(q)); await f.staging.settle();
      assert.equal(reads, 0); assert.deepEqual(state(f.world), before); assert.equal(f.staging.operations.size, 0); f.staging.gate.assertWorldAvailable();
    } finally { await f.close(); }
  });
});

test('trusted release methods require generations and stale versions never apply', async (t) => {
  for (const action of ['leave']) await t.test(action, async () => {
    const f = await fixture();
    try {
      const { action: _action, ...q } = request(f, action);
      assert.throws(() => f.staging[action](q), { code: 'operation' });
      const before = state(f.world), h = f.staging[action]({ ...q, expectedVersion: 2 }); await f.staging.settle();
      assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code: 'conflict' }]);
      assert.deepEqual(state(f.world), before); held(f, q.uid); assert.equal((await f.base.loadUnique(q.uid)).version, 1);
    } finally { await f.close(); }
  });
});

test('release lifecycle changes during managed read prevent all dispatch', async (t) => {
  for (const action of ['leave']) for (const mode of ['close', 'death then revival', 'ledger changed']) await t.test(`${action}: ${mode}`, async () => {
    const entered = deferred(), reply = deferred(); let armed = false, sends = 0;
    const f = await fixture({ wrapStore: (base) => ({ ...base,
      async loadUnique(uid) { if (armed) { entered.resolve(); await reply.promise; } return base.loadUnique(uid); },
      async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); },
    }) });
    try {
      armed = true; const q = request(f, action), h = f.staging.request(q); await entered.promise;
      if (mode === 'close') f.sessions.close(1);
      else if (mode === 'death then revival') { f.staging.invalidate(accounts[0]); f.world.ecs.dead[f.entities[0]] = 0; }
      else f.world.pearlLedger.get(q.uid).entity = f.entities[1];
      const before = state(f.world); reply.resolve(); await f.staging.settle(); assert.equal(sends, 0);
      assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before); held(f, q.uid);
      assert.equal((await f.base.loadUnique(q.uid)).holder, accounts[0]); assert.equal(f.staging.operations.get(h.operationId).state, 'fenced');
    } finally { reply.resolve(); await f.staging.settle(); await f.close(); }
  });
});

test('release local apply failures conserve prior state while durable ground stays committed', async (t) => {
  for (const action of ['leave']) for (const mode of ['drop insertion throws', 'save enqueue throws', 'event decoration throws', 'drop ID occupied']) await t.test(`${action}: ${mode}`, async () => {
    const f = await fixture(); let restore = () => {};
    try {
      const q = request(f, action), h = f.staging.request(q); await f.staging.settle();
      if (mode === 'drop insertion throws') {
        const original = f.world.drops.set;
        f.world.drops.set = function (...args) { original.apply(this, args); throw new StoreError('effect'); };
        restore = () => { delete f.world.drops.set; };
      } else if (mode === 'save enqueue throws') {
        const original = f.sessions.save; f.sessions.save = () => { throw new StoreError('unavailable'); }; restore = () => { f.sessions.save = original; };
      } else if (mode === 'event decoration throws') {
        const original = f.world.emit; f.world.emit = () => { throw new StoreError('effect'); }; restore = () => { f.world.emit = original; };
      } else f.world.drops.set(f.world.nextDrop, { id: f.world.nextDrop, kind: 'gold', n: 7 });
      const before = state(f.world); assert.equal(f.staging.drain()[0].state, 'fenced');
      assert.deepEqual(state(f.world), before); assert.deepEqual(f.staging.drain(), []); held(f, q.uid);
      assert.equal((await f.base.loadUnique(q.uid)).holder, null); assert.notEqual((await f.base.loadPearlLocation(q.uid)).ground, null);
      assert.equal((await f.base.loadPearlGroundOperation(h.operationId)).result.ok, true);
    } finally { restore(); await f.close(); }
  });
});

test('legacy spit calls reject without touching inputs, reading authority or reserving', async () => {
  let reads = 0, prepares = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async loadUnique(uid) { reads++; return base.loadUnique(uid); } }) });
  try {
    f.staging = new PearlStaging(f.sessions, f.world, WORLD, { prepareInputs: () => { prepares++; throw new Error('must not run'); } });
    reads = 0; const before = state(f.world);
    assert.throws(() => f.staging.request({ action: 'spit', uid: outgoingUid, source: source(f) }), { code: 'bound' });
    let getters = 0; const raw = {}; Object.defineProperty(raw, 'uid', { get() { getters++; return outgoingUid; } });
    assert.throws(() => f.staging.spit(raw), { code: 'bound' }); await f.staging.settle();
    assert.equal(getters + reads + prepares, 0); assert.deepEqual(state(f.world), before);
    assert.equal(f.staging.operations.size, 0); f.staging.gate.assertWorldAvailable();
  } finally { await f.close(); }
});

class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

for (const action of ['leave']) test(`real host ${action} applies on its owned boundary and preserves pending combat inputs`, async () => {
  const base = createMemoryStore(), journal = createMemoryPearlJournals(base)(WORLD), uid = `release-host-${action}`;
  const p = newProfile(); p.pirateId = `account:${accounts[0]}`; await base.saveProfile(accounts[0], p, 0);
  p.pearls.bag = [{ uid, kind: 'brasa' }];
  assert.equal((await base.commitPearlGround({ operationId: '61000000-0000-4000-8000-000000009119', uid, kind: 'brasa',
    from: null, to: accounts[0], expectedVersion: 0, world: WORLD, ground: null,
    profiles: [{ id: accounts[0], expectedVersion: 1, data: p }] })).ok, true);
  const host = new GameHost({ seed: 42, bots: 0, store: base, resolvePlayer: async () => accounts[0], worldId: WORLD,
    pearlJournal: journal, log: () => {} });
  host.mountPearlStaging({ scope: WORLD });
  host.mountPearlStartup({ accountPolicy: 'accounts-only', mapClock: (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt }) });
  await host.prepare(); const socket = new Socket(); host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'fixture' } });
  socket.emit('message', JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: 'test', name: 'Release', skin: 0 }));
  await Promise.all([...host.joins]);
  try {
    const server = host.server, w = server.world, e = server.clients.get(1).entity, c = server.clients.get(1);
    w.ecs.regenT[e] = 99; w.ecs.dashT[e] = -1; w.ecs.castK[e] = 0; w.ecs.atkStage[e] = 0;
    const tick = w.tick, h = host.pearlStaging.request({ action, uid, source: { clientId: 1, entity: e } });
    server.receive(1, { t: MSG.INPUTS, cmds: [{ seq: 1, mx: 0.1, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], pt: tick, btn: BTN.ATTACK, prs: BTN.Q }] });
    assert.equal(c.queue.length, 1); server.step(); assert.equal(w.tick, tick); assert.equal(c.queue.length, 1);
    await host.pearlStaging.settle(); assert.equal(w.drops.size, 0);
    // Apply at the real boundary while tick admission is explicitly held; inspect queued inputs
    // before a later simulation tick can consume them or autonomously pick/return the drop.
    const tickAccess = server.tickAccess; server.tickAccess = () => false; server.step(); server.tickAccess = tickAccess;
    assert.equal(host.pearlStaging.operations.has(h.operationId), false); assert.equal(w.drops.size, 1);
    assert.equal(c.queue[0].btn & BTN.ATTACK, BTN.ATTACK);
    assert.equal(c.queue[0].prs & BTN.Q, BTN.Q); assert.equal(c.queue[0].mx, quantAxis(0.1));
    assert.equal(w.profiles.get(e).pearls.swallowed, null);
    assert.equal((await base.loadUnique(uid)).holder, null); await host.profiles.flush();
  } finally { await host.close(); }
});

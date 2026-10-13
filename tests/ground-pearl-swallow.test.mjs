import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundPearlSwallow } from '../server/groundPearlSwallow.mjs';
import { preparePearlInputs, PEARL_ACTION_BUFFERS, PEARL_ACTION_BITS } from '../src/net/pearlInputBoundary.js';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { refreshStats } from '../src/sim/systems/stats.js';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { StoreError } from '../server/store.mjs';
import { fixture, WORLD, incomingUid, outgoingUid, accounts, state } from './helpers/pearl-replace-staging.mjs';
import { PEARL_IDS, PEARL } from '../src/data/pearls.js';

const clock = () => new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
  epoch: new GroundClockEpoch({ localTick: 7, durableTick: 2 ** 40 }) });
const operationId = '61000000-0000-4000-8000-000000009029';
const command = (seq, btn = PEARL_ACTION_BITS | 1) => ({ seq, mx: 1, mz: 0.25, ax: 8, az: 9,
  btn, prs: btn, pt: seq, w: 0 });

async function setup({ kind } = {}) {
  const f = await fixture({ incomingKind: kind });
  f.world.tick = 11;
  const e = f.entities[0], profile = f.world.profiles.get(e), session = f.sessions.clients.get(1);
  const outgoing = profile.pearls.swallowed;
  profile.pearls.bag.push(outgoing); profile.pearls.swallowed = null;
  refreshStats(f.world, e);
  session.confirmed = structuredClone(profile); session.last = JSON.stringify(profile);
  const client = { serverProfile: true, entity: e, paused: false, queue: [command(1), command(2)],
    carry: PEARL_ACTION_BITS, last: command(0), ack: 0, lastPt: 0, fillPt: 0, starve: 0 };
  let boundaryCalls = 0, inputPreparations = 0;
  const server = { world: f.world, clients: new Map([[1, client]]),
    assertDropApplyBoundary() { boundaryCalls++; },
    preparePearlInputs(id, entity) {
      inputPreparations++;
      return preparePearlInputs(server, id, entity, () => server.assertDropApplyBoundary());
    } };
  const host = { server, profiles: f.sessions, worldState: { id: WORLD } };
  const unique = await f.base.loadUnique(incomingUid);
  const row = { uid: incomingUid, kind: unique.kind.slice(6), holder: accounts[0], version: unique.version };
  const source = { clientId: 1, entity: e };
  return { ...f, e, profile, session, client, host, row, source,
    boundaryCalls: () => boundaryCalls, inputPreparations: () => inputPreparations };
}

const plan = f => prepareGroundPearlSwallow({ host: f.host, deadlineClock: clock(), source: f.source,
  uid: incomingUid, row: f.row, preflight: false });
const receipt = p => groundResult({ ...p.operation, operationId });
const inputState = c => structuredClone({ queue: c.queue, carry: c.carry, last: c.last,
  ack: c.ack, lastPt: c.lastPt, fillPt: c.fillPt, starve: c.starve });

function helperResult(f) {
  const ecs = structuredClone(f.world.ecs), profile = structuredClone(f.profile), events = [];
  const view = { ecs, profiles: new Map([[f.e, profile]]), profileDirty: new Set(), events,
    emit(event) { events.push(structuredClone(event)); } };
  assert.equal(swallowPearl(view, f.e, incomingUid), true);
  for (const key of PEARL_ACTION_BUFFERS) ecs[key][f.e] = 0;
  return { ecs, profile, events };
}

for (const kind of PEARL_IDS) test(`swallow planner uses the real ${kind} helper and applies once`, async () => {
  const f = await setup({ kind });
  try {
    f.world.ecs.hp[f.e] = f.world.ecs.maxHp[f.e] * 0.375;
    f.world.ecs.guardSt[f.e] = 27.5;
    f.world.ecs.cdG[f.e] = PEARL.swapCd + 3;
    f.world.ecs.waterT[f.e] = 9;
    for (const key of PEARL_ACTION_BUFFERS) f.world.ecs[key][f.e] = 0.25;
    const before = state(f.world), transport = inputState(f.client), expected = helperResult(f);
    const p = plan(f);
    assert.deepEqual(state(f.world), before, 'planning is read-only');
    assert.deepEqual(inputState(f.client), transport, 'planning leaves received commands intact');
    assert.equal(p.operation.from, accounts[0]); assert.equal(p.operation.to, accounts[0]);
    assert.equal(p.operation.expectedVersion, f.row.version); assert.equal(p.operation.world, WORLD);
    assert.equal(p.operation.ground, null); assert.equal(p.operation.profiles.length, 1);
    assert.equal(p.operation.profiles[0].id, accounts[0]);
    assert.equal(p.operation.profiles[0].expectedVersion, f.session.version);
    assert.equal(p.operation.profiles[0].data.pearls.swallowed.uid, incomingUid);
    assert.deepEqual(p.operation.profiles[0].data, expected.profile);
    assert.equal(Object.isFrozen(p.operation), true);
    assert.equal(p.assertBaseline(), true); assert.equal(p.assertCurrent(), true);

    assert.equal(p.apply(receipt(p)), true);
    assert.deepEqual(f.profile.pearls, expected.profile.pearls);
    assert.equal(f.profile.elem, expected.profile.elem);
    assert.deepEqual(Object.fromEntries(Object.keys(expected.ecs).filter(k => ArrayBuffer.isView(expected.ecs[k]))
      .map(k => [k, f.world.ecs[k][f.e]])),
    Object.fromEntries(Object.keys(expected.ecs).filter(k => ArrayBuffer.isView(expected.ecs[k]))
      .map(k => [k, expected.ecs[k][f.e]])));
    for (const key of PEARL_ACTION_BUFFERS) assert.equal(f.world.ecs[key][f.e], 0);
    assert.deepEqual(f.world.pearlLedger, new Map(before.ledger));
    assert.deepEqual(f.world.drops, new Map(before.drops));
    assert.equal(f.world.rng.state(), before.rng); assert.equal(f.world.lootRng.state(), before.lootRng);
    assert.deepEqual(f.world.events.at(-1), { ...expected.events.at(-1), elem: expected.ecs.elem[f.e] });
    assert.deepEqual(f.client.queue.map(cmd => [cmd.seq, cmd.btn & PEARL_ACTION_BITS, cmd.prs & PEARL_ACTION_BITS]),
      [[1, 0, 0], [2, 0, 0]]);
    assert.equal(f.client.carry & PEARL_ACTION_BITS, 0);
    assert.equal(f.client.last.btn & PEARL_ACTION_BITS, 0); assert.equal(f.client.last.prs & PEARL_ACTION_BITS, 0);
    assert.deepEqual([f.client.ack, f.client.lastPt, f.client.fillPt, f.client.starve],
      [transport.ack, transport.lastPt, transport.fillPt, transport.starve]);
    assert.equal(f.session.version, p.operation.profiles[0].expectedVersion + 1);
    assert.ok(f.boundaryCalls() > 0, 'apply uses the server tick boundary');
    assert.throws(() => p.apply(receipt(p)), { code: 'cancelled' });
  } finally { await f.close(); }
});

test('occupied swallowed slot, combat, and malformed authority selectors reject without writes', async t => {
  for (const mode of ['occupied', 'combat', 'holder', 'kind', 'uid', 'version', 'row extra', 'source extra']) await t.test(mode, async () => {
    const f = await setup();
    try {
      if (mode === 'occupied') {
        const pearl = f.profile.pearls.bag.pop(); f.profile.pearls.swallowed = pearl;
        f.session.confirmed = structuredClone(f.profile); f.session.last = JSON.stringify(f.profile);
        refreshStats(f.world, f.e);
      }
      if (mode === 'combat') f.world.ecs.atkStage[f.e] = 1;
      if (mode === 'holder') f.row.holder = accounts[1];
      if (mode === 'kind') f.row.kind = 'tinta';
      if (mode === 'uid') f.row.uid = 'other';
      if (mode === 'version') f.row.version = 0;
      if (mode === 'row extra') f.row.extra = true;
      if (mode === 'source extra') f.source.profile = f.profile;
      const before = state(f.world), transport = inputState(f.client);
      assert.throws(() => plan(f), StoreError);
      assert.deepEqual(state(f.world), before); assert.deepEqual(inputState(f.client), transport);
      assert.equal(f.boundaryCalls(), 0); assert.equal(f.inputPreparations(), 0);
    } finally { await f.close(); }
  });
});

test('source authentication and row accessors fail closed without invoking getters', async () => {
  const f = await setup();
  try {
    const before = state(f.world); let reads = 0;
    const row = { uid: incomingUid, kind: f.row.kind, holder: accounts[0] };
    Object.defineProperty(row, 'version', { enumerable: true, get() { reads++; return f.row.version; } });
    assert.throws(() => prepareGroundPearlSwallow({ host: f.host, deadlineClock: clock(), source: f.source,
      uid: incomingUid, row }), StoreError);
    assert.equal(reads, 0);
    f.host.server.clients.get(1).serverProfile = false;
    assert.throws(() => plan(f), { code: 'session' });
    assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});

test('baseline detects profile, ECS, ledger, drops, RNG, session, and input drift', async t => {
  const edits = [
    ['profile', f => { f.profile.gold++; }], ['ECS', f => { f.world.ecs.x[f.e]++; }],
    ['ledger', f => { f.world.pearlLedger.set(outgoingUid, { owner: 'other', entity: 99, place: 'profile' }); }],
    ['drop', f => { f.world.drops.set(9900, { id: 9900, kind: 'other' }); }],
    ['RNG identity', f => { f.world.lootRng = { state: () => 1 }; }],
    ['session version', f => { f.session.version++; }],
  ];
  for (const [name, edit] of edits) await t.test(name, async () => {
    const f = await setup();
    try { const p = plan(f); edit(f); assert.throws(() => name === 'session version' ? p.assertCurrent() : p.assertBaseline(), { code: 'cancelled' }); }
    finally { await f.close(); }
  });
});

test('receipt validation and synchronous apply failures restore profile, ECS, session, events, and inputs', async t => {
  for (const mode of ['wrong receipt', 'projection write', 'partial event append']) await t.test(mode, async () => {
    const f = await setup();
    try {
      const p = plan(f), before = state(f.world), transport = inputState(f.client), s = f.session;
      const effect = receipt(p);
      if (mode === 'wrong receipt') effect.location.version++;
      const originalAdd = Set.prototype.add, originalPush = Array.prototype.push;
      if (mode === 'projection write') Set.prototype.add = function(value) {
        if (this === f.world.profileDirty) throw new Error('projection write failed');
        return originalAdd.call(this, value);
      };
      if (mode === 'partial event append') Array.prototype.push = function(...values) {
        if (this === f.world.events) { originalPush.call(this, values[0]); throw new Error('partial event append failed'); }
        return originalPush.apply(this, values);
      };
      try {
        assert.throws(() => p.apply(effect), mode === 'wrong receipt' ? { code: 'response' } : new RegExp(`${mode} failed`));
      } finally { Set.prototype.add = originalAdd; Array.prototype.push = originalPush; }
      assert.deepEqual([...f.world.events], before.events);
      assert.deepEqual(state(f.world), before);
      assert.deepEqual(inputState(f.client), transport);
      assert.equal(s.version, p.operation.profiles[0].expectedVersion);
      assert.equal(f.world.profileDirty.has(f.e), before.dirty.includes(f.e));
    } finally { await f.close(); }
  });
});

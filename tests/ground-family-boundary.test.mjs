import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newResourceState } from '../server/resourceState.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';

const WORLD = 'ground-family-unit', UID = 'boundary-unit-pearl';
const ID = n => `af240000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = structuredClone;

// Deliberately non-atomic in-memory RPC fixture. SQL atomicity is covered by the SQL/process suites.
async function fixture(t) {
  const base = createMemoryStore(), rows = new Map(), intents = new Map();
  let commits = 0;
  const journal = { scope: WORLD, durable: true,
    async check() { return { version: 1 }; },
    async prepare(raw) {
      const row = { ...clone(raw), state: 'pending', result: null };
      intents.set(raw.operationId, row); return clone(row);
    },
    async load(id) { return clone(intents.get(id) ?? null); },
    async list() { return [...intents.values()].filter(r => r.state === 'pending').map(clone); },
  };
  const store = { ...base, durable: true,
    async checkGroundTransactions() { return { version: 1 }; },
    async loadGroundTransaction(id) { return clone(rows.get(id) ?? null); },
    async commitGroundTransaction(raw) {
      commits++;
      const r = raw.request;
      const effect = r.family === 'checkpoint' ? { ok: true, replay: false }
        : await base.commitPearlGround({ operationId: raw.operationId, ...r.operation });
      const saved = await base.saveWorld(r.world, r.worldData, r.expectedWorldVersion);
      assert.equal(saved.ok, true);
      const clock = r.clock.tick === r.clock.expectedTick ? await base.loadGroundClock(WORLD)
        : (await base.commitGroundClock({ operationId: r.clock.operationId, world: WORLD,
          expectedVersion: r.clock.expectedVersion, expectedTick: r.clock.expectedTick, tick: r.clock.tick })).clock;
      const result = { ok: true, replay: false, worldVersion: saved.version, clock, effect };
      rows.set(raw.operationId, { request: clone(r), result: clone(result) });
      const row = intents.get(raw.operationId); row.state = 'committed'; row.result = clone(result);
      return result;
    },
  };
  const host = new GameHost({ seed: 91, bots: 0, store, worldId: WORLD, log() {},
    resolvePlayer: async () => ID(9), economicOperations: true, resourceOperations: true,
    groundTransactions: { journal } });
  t.after(() => host.close().catch(error => { assert.equal(error.code, 'flush'); }));
  const resources = newResourceState(host.server.world); resources.tick = 500;
  await base.saveWorld(WORLD, { v: 1, seed: 91, economy: host.server.world.economy.serialize(), resources }, 0);
  await base.commitGroundClock({ operationId: ID(1), world: WORLD, expectedVersion: 0, expectedTick: 0, tick: 500 });
  await host.prepare();
  const raw = { operationId: ID(2), family: 'ground', operation: { uid: UID, kind: 'brasa',
    from: null, to: null, expectedVersion: 0, world: WORLD, profiles: [],
    ground: { x: 2, z: 3, availableAt: 500, returnAt: 900 } } };
  return { host, raw, gate: pearlMutationGate(host.profiles), commits: () => commits };
}

test('family ingress rejects accessors, wrong worlds and unsupported families before any journal or SQL write', async t => {
  const f = await fixture(t); let read = false;
  assert.throws(() => f.host.groundAuthority.stageFamily({ get operation() { read = true; return {}; } }, () => true));
  assert.equal(read, false);
  for (const raw of [{ ...f.raw, family: 'pearl' },
    { ...f.raw, operation: { ...f.raw.operation, world: 'other-world' } }, { ...f.raw, extra: true }]) {
    assert.throws(() => f.host.groundAuthority.stageFamily(raw, () => true), { code: 'operation' });
  }
  assert.equal(f.commits(), 0); assert.equal(f.host.groundAuthority.ready, true);
});

test('family lanes exclude another operation and normal snapshots until the boundary releases them', async t => {
  const f = await fixture(t); let calls = 0;
  const pending = f.host.groundAuthority.stageFamily(f.raw, () => { calls++; return true; });
  assert.throws(() => f.gate.assertAvailable({ uids: [UID] }), { code: 'busy' });
  assert.throws(() => f.host.groundAuthority.stageFamily({ ...f.raw, operationId: ID(3) }, () => true), { code: 'busy' });
  f.host.worldState.save(f.host.server.world.economy);
  assert.equal(f.host.worldState.pending, null);
  await f.host.groundAuthority.settle(); assert.equal(calls, 0);
  assert.equal(f.host.server.step(), true); await pending;
  assert.equal(calls, 1); f.gate.assertAvailable({ uids: [UID] });
});

test('invalidating a reserved UID after SQL commit fences without applying the obsolete callback', async t => {
  const f = await fixture(t); let calls = 0;
  const pending = f.host.groundAuthority.stageFamily(f.raw, () => { calls++; return true; });
  const rejected = assert.rejects(pending);
  await f.host.groundAuthority.settle(); f.gate.invalidate({ uids: [UID] });
  assert.equal(f.host.server.step(), false); await rejected;
  assert.equal(calls, 0); assert.equal(f.host.groundAuthority.status().failed, true);
  assert.throws(() => f.gate.assertAvailable({ uids: [UID] }), { code: 'busy' });
});

test('an unexpected world mutation while SQL is pending cannot be published by a prepared family', async t => {
  const f = await fixture(t); let calls = 0;
  const pending = f.host.groundAuthority.stageFamily(f.raw, () => { calls++; return true; });
  const rejected = assert.rejects(pending);
  await f.host.groundAuthority.settle(); f.host.server.world.economy.acc += 0.25;
  assert.equal(f.host.server.step(), false); await rejected;
  assert.equal(calls, 0); assert.equal(f.host.worldState.version, 1);
  assert.equal(f.host.worldState.failed, true);
});

test('a trusted adapter releasing its capability cannot leave the result pending or bypass the world fence', async t => {
  const f = await fixture(t);
  const pending = f.host.groundAuthority.stageFamily(f.raw, (_effect, { reservation }) => {
    f.gate.release(reservation); return true;
  });
  const rejected = assert.rejects(pending);
  await f.host.groundAuthority.settle();
  assert.equal(f.host.server.step(), false); await rejected;
  assert.equal(f.host.worldState.failed, true);
  assert.equal(f.host.groundAuthority.status().failed, true);
  assert.equal(f.host.closing, true);
});

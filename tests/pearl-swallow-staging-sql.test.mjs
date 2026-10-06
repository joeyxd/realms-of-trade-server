import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/pearl-same-holder-sql.mjs';
import { fixture, accounts, scope, uid, deferred, state, row, expected } from './helpers/pearl-swallow-staging.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { StoreError } from '../server/store.mjs';
import { World } from '../src/sim/world.js';
import { installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { canonicalText } from '../server/pearlOperations.mjs';
import { map, A as arena } from './helpers.mjs';

test('SQL006 SDK staging waits for receipt/journal, rebases current progress and applies exact ECS effect once', async () => {
  const sent = deferred(), reply = deferred(), f = await fixture({ backend: database, wrapStore: (base) => ({ ...base,
    async commitPearlGround(raw) { const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result; },
  }) });
  try {
    const before = state(f.w), handle = f.staging.swallow(f.command()); await sent.promise;
    assert.deepEqual(state(f.w), before); assert.deepEqual(f.staging.drain(), []);
    const p = f.w.profiles.get(f.entities[0]); p.gold = 31; p.xp = 29; f.staging.save(1, p);
    f.w.ecs.hp[f.entities[0]] = 15; f.w.ecs.cdG[f.entities[0]] = 9;
    reply.resolve(); await f.staging.settle(); assert.deepEqual(f.w.events, []);
    const reference = expected(f); assert.equal(swallowPearl(reference, f.entities[0], uid), true);
    assert.equal(f.staging.drain()[0].state, 'applied');
    assert.deepEqual(row(f.w.ecs, f.entities[0]), row(reference.ecs, f.entities[0]));
    assert.equal(f.w.events.length, 1); assert.equal(f.w.events[0].elem, 1);
    await f.sessions.flush();
    const stored = await f.base.loadProfile(accounts[0]); assert.equal(stored.version, 6);
    assert.equal(stored.data.gold, 31); assert.equal(stored.data.xp, 29); assert.equal(stored.data.pearls.swallowed.uid, uid);
    assert.deepEqual(stored.data.pearls.bag.map((p) => p.uid), ['swallow-first', 'swallow-last']);
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal((await f.base.loadUnique(uid)).holder, accounts[0]);
    assert.deepEqual(await f.base.loadPearlLocation(uid), { world: scope, ground: null, version: 2 });
    const audit = (await f.database.db.query('select state from public.mn_pearl_intents where operation_id=$1::uuid', [handle.operationId])).rows[0];
    assert.equal(audit.state, 'committed');
    assert.equal((await f.database.db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id=$1::uuid', [handle.operationId])).rows[0].n, 0);
    assert.deepEqual(f.staging.drain(), []);
  } finally { await f.close(); }
});

test('SQL SDK lost replies replay the frozen request without a second generation or tick effect', async () => {
  const requests = [], f = await fixture({ backend: database, wrapStore: (base) => ({ ...base,
    async commitPearlGround(raw) { requests.push(canonicalText(raw)); await base.commitPearlGround(raw); throw new StoreError('unavailable'); },
  }) });
  try {
    const before = state(f.w); f.staging.swallow(f.command()); await f.staging.settle(); assert.deepEqual(state(f.w), before);
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
    assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
    assert.equal((await f.base.loadProfile(accounts[0])).version, 5); assert.equal((await f.base.loadUnique(uid)).version, 2);
    assert.equal(f.w.events.length, 1); assert.deepEqual(f.staging.drain(), []);
  } finally { await f.close(); }
});

test('new SQL-backed authority after commit before apply loads current swallowed state without replaying a gameplay event', async () => {
  const f = await fixture({ backend: database });
  try {
    f.staging.swallow(f.command()); await f.staging.settle(); assert.deepEqual(f.w.events, []);
    const callsBefore = f.database.calls.filter((c) => c.name === 'mn_commit_pearl_ground').length;
    const sessions = new ProfileSessions(f.base, null, { journal: f.database.journal }); await sessions.recoverPearls();
    const profile = await sessions.open(91, accounts[0]), w = new World(42, { map, server: true }); installInventory(w, scope);
    const e = w.spawnPlayer({ x: arena.x, z: arena.z + 4, clientId: 91 }); attachProfile(w, e, profile);
    const staging = new PearlStaging(sessions, w, scope), spawnEvents = structuredClone(w.events);
    assert.equal(profile.pearls.swallowed.uid, uid); assert.equal(w.ecs.elem[e], 1);
    assert.equal(w.events.some((event) => event.type === 'pearlChanged'), false);
    assert.deepEqual(staging.drain(), []); assert.equal(f.database.calls.filter((c) => c.name === 'mn_commit_pearl_ground').length, callsBefore);
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal(sessions.pearls.accountIds.size, 0);
    // The old process's context cannot affect the reconstructed world.
    f.staging.invalidate(accounts[0]); assert.equal(f.staging.drain()[0].state, 'fenced');
    assert.deepEqual(w.events, spawnEvents); assert.deepEqual(staging.drain(), []);
  } finally { await f.close(); }
});

test('SQL-backed enqueue failure rolls back local ECS but leaves the durable receipt and terminal journal intact', async () => {
  const f = await fixture({ backend: database });
  try {
    const before = state(f.w), handle = f.staging.swallow(f.command()); await f.staging.settle();
    f.sessions.save = () => { throw new StoreError('unavailable'); };
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
    assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, uid);
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal((await f.base.loadPearlGroundOperation(handle.operationId)).result.ok, true);
    assert.equal((await f.database.db.query('select state from public.mn_pearl_intents where operation_id=$1::uuid', [handle.operationId])).rows[0].state, 'committed');
    assert.deepEqual(f.staging.drain(), []); await assert.rejects(f.sessions.flush(), { code: 'flush' });
  } finally { await f.close(); }
});

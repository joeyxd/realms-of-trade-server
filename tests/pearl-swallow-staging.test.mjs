import test from 'node:test';
import assert from 'node:assert/strict';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { StoreError } from '../server/store.mjs';
import { pearlEcsDraft } from '../server/pearlEcsEffect.mjs';
import { canonicalText } from '../server/pearlOperations.mjs';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { PEARL, PEARL_IDS, PEARLS } from '../src/data/pearls.js';
import { fixture, accounts, scope, uid, deferred, state, row, expected } from './helpers/pearl-swallow-staging.mjs';

test('slow swallow commit and journal closure leave all world state untouched until one tick apply', async () => {
  const sent = deferred(), reply = deferred(), finished = deferred(), finishReply = deferred(); let sends = 0, raw;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(request) {
    sends++; raw = request; const result = await base.commitPearlGround(request); sent.resolve(); await reply.promise; return result;
  } }), wrapJournal: (journal) => ({ ...journal, async resolve(...args) {
    const result = await journal.resolve(...args); finished.resolve(); await finishReply.promise; return result;
  } }) });
  const before = state(f.w), handle = f.staging.swallow(f.command());
  assert.deepEqual(state(f.w), before); await sent.promise;
  assert.deepEqual(state(f.w), before); assert.deepEqual(f.staging.drain(), []);
  assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, uid);
  assert.throws(() => f.staging.give(f.give()), { code: 'busy' });
  assert.throws(() => f.staging.assertPublishable(1), { code: 'busy' });
  reply.resolve(); await finished.promise; assert.deepEqual(state(f.w), before);
  finishReply.resolve(); await f.staging.settle(); assert.equal(f.sessions.pearls.accountIds.size, 0);
  assert.deepEqual(state(f.w), before); assert.throws(() => f.staging.swallow(f.command()), { code: 'busy' });
  const reference = expected(f); assert.equal(swallowPearl(reference, f.entities[0], uid), true);
  assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
  assert.deepEqual(row(f.w.ecs, f.entities[0]), row(reference.ecs, f.entities[0]));
  assert.deepEqual(f.w.profiles.get(f.entities[0]).pearls, reference.profiles.get(f.entities[0]).pearls);
  assert.deepEqual([...f.w.pearlLedger], before.ledger);
  assert.equal(f.w.events.length, 1); assert.equal(f.w.events[0].elem, 1);
  assert.equal(f.w.events[0].op, 'swallow'); assert.equal(f.w.events[0].to, f.entities[0]);
  assert.equal(sends, 1); assert.equal(raw.operationId, handle.operationId); assert.equal(raw.from, raw.to);
  assert.equal(raw.profiles.length, 1); assert.equal(Object.isFrozen(raw), true);
  assert.deepEqual(f.staging.drain(), []); f.staging.assertPublishable(1);
  assert.deepEqual([...f.w.drops], before.drops); assert.equal(f.w.nextDrop, before.nextDrop);
  assert.equal(f.w.rng.state(), before.rng); assert.equal(f.w.lootRng.state(), before.lootRng);
  await f.sessions.flush(); assert.equal((await f.base.loadUnique(uid)).version, 2);
});

test('swallow preflight uses real calm/UID rules without writes or a journal entry; replacement is excluded', async (t) => {
  for (const [name, code, alter] of [
    ['recent damage', 'combat', (f) => { f.w.ecs.regenT[f.entities[0]] = 0; }],
    ['cast', 'combat', (f) => { f.w.ecs.castK[f.entities[0]] = 1; }],
    ['attack', 'combat', (f) => { f.w.ecs.atkStage[f.entities[0]] = 1; }],
    ['dash', 'combat', (f) => { f.w.ecs.dashT[f.entities[0]] = 0.2; }],
    ['dead', 'combat', (f) => { f.w.ecs.dead[f.entities[0]] = 1; }],
    ['despawned', 'combat', (f) => { f.w.ecs.alive[f.entities[0]] = 0; }],
    ['nearby chasing foe', 'combat', (f) => {
      const e = f.w.spawnEnemy('archer', f.w.ecs.x[f.entities[0]] + 3, f.w.ecs.z[f.entities[0]]);
      f.w.ecs.brain[e].target = f.entities[0]; f.w.ecs.brain[e].state = 'chase';
    }],
    ['unknown bag UID', 'unknown', (f) => { f.w.profiles.get(f.entities[0]).pearls.bag.splice(1, 1); }],
    ['already swallowed', 'confirm', (f) => { const p = f.w.profiles.get(f.entities[0]); p.pearls.swallowed = p.pearls.bag.pop(); }],
    ['explicit replacement', 'operation', (_f, cmd) => { cmd.replaceUid = 'swallow-last'; }],
    ['zero generation', 'operation', (_f, cmd) => { cmd.expectedVersion = 0; }],
    ['guest identity', 'session', (f) => { f.w.profiles.get(f.entities[0]).pirateId = 'guest:test'; }],
    ['foreign ledger owner', 'ownership', (f) => { f.w.pearlLedger.get(uid).owner = `account:${accounts[1]}`; }],
  ]) await t.test(name, async () => {
    let calls = 0;
    const f = await fixture({ wrapJournal: (journal) => ({ ...journal, async prepare(...args) { calls++; return journal.prepare(...args); } }) });
    const cmd = f.command(); alter(f, cmd); const before = state(f.w);
    assert.throws(() => f.staging.swallow(cmd), { code });
    assert.deepEqual(state(f.w), before); assert.equal(calls, 0); assert.equal(f.staging.operations.size, 0);
  });
});

test('apply matches every real pearl helper kind using latest HP, gear/mastery, timers and progress', async (t) => {
  for (const kind of PEARL_IDS) await t.test(kind, async () => {
    const sent = deferred(), reply = deferred(), f = await fixture({ kind, wrapStore: (base) => ({ ...base,
      async commitPearlGround(raw) { const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result; },
    }) });
    f.staging.swallow(f.command()); await sent.promise;
    const p = f.w.profiles.get(f.entities[0]), s = f.w.ecs, e = f.entities[0];
    p.gold += 8; p.xp = 13; f.staging.save(1, p);
    reply.resolve(); await f.staging.settle();
    p.gold += 3; p.xp = 21; p.mast[0][0] = 3; p.lvl = 4; s.level[e] = 4;
    p.eq.weapon.l = 4; // A current gear upgrade must contribute to refreshStats, too.
    s.hp[e] = 19; s.maxHp[e] = 137; s.guardSt[e] = 99;
    s.gBuf[e] = 0.7; s.cdG[e] = kind === 'brasa' ? 9 : 1.2; s.waterT[e] = 7;
    s.x[e] += 12; s.vx[e] = 3; s.castT[e] = 0.13; s.cdQ[e] = 8; s.cdE[e] = 2;
    f.staging.save(1, p);
    const reference = expected(f); assert.equal(swallowPearl(reference, e, uid), true);
    assert.equal(f.staging.drain()[0].state, 'applied');
    assert.deepEqual(row(s, e), row(reference.ecs, e));
    assert.equal(s.gBuf[e], 0); assert.equal(s.waterT[e], 0); assert.equal(s.cdG[e], kind === 'brasa' ? 9 : PEARL.swapCd);
    assert.equal(f.w.events[0].elem, PEARLS[kind].elem); assert.equal(f.w.events.length, 1);
    await f.sessions.flush(); const stored = await f.base.loadProfile(accounts[0]);
    assert.equal(stored.data.gold, 31); assert.equal(stored.data.xp, 21); assert.equal(stored.data.mast[0][0], 3);
    assert.deepEqual(stored.data.pearls.bag.map((q) => q.uid), ['swallow-first', 'swallow-last']);
    assert.equal(stored.data.pearls.swallowed.kind, kind);
  });
});

test('accepted calm is not re-tested after SQL: current combat continues while only the swallow effect applies', async () => {
  const sent = deferred(), reply = deferred(), f = await fixture({ wrapStore: (base) => ({ ...base,
    async commitPearlGround(raw) { const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result; },
  }) });
  f.staging.swallow(f.command()); await sent.promise;
  const e = f.entities[0], s = f.w.ecs;
  s.regenT[e] = 0; s.castK[e] = 1; s.atkStage[e] = 2; s.dashT[e] = 0.1; s.hp[e] = 17;
  reply.resolve(); await f.staging.settle(); assert.equal(f.staging.drain()[0].state, 'applied');
  assert.equal(s.regenT[e], 0); assert.equal(s.castK[e], 1); assert.equal(s.atkStage[e], 2); assert.equal(s.dashT[e], 0.1);
  assert.equal(s.hp[e], 17); assert.equal(s.elem[e], 1); assert.equal(f.w.events.length, 1);
  await f.sessions.flush();
});

test('give and swallow coordinators share one reservation; unrelated entities remain unchanged', async () => {
  const f = await fixture(), other = new PearlStaging(f.sessions, f.w, scope), before = row(f.w.ecs, f.entities[1]);
  f.staging.swallow(f.command()); assert.throws(() => other.give(f.give()), { code: 'busy' });
  assert.throws(() => f.sessions.save(1, f.w.profiles.get(f.entities[0])), { code: 'busy' });
  await f.staging.settle(); assert.throws(() => other.swallow(f.command()), { code: 'busy' });
  f.staging.drain(); await f.sessions.flush(); assert.deepEqual(row(f.w.ecs, f.entities[1]), before);
});

test('prior profile CAS drains before the single-account builder and a mutable command cannot rewrite the plan', async () => {
  const sent = deferred(), reply = deferred(), requests = [];
  const f = await fixture({ wrapStore: (base) => ({ ...base, async saveProfile(...args) {
    sent.resolve(); await reply.promise; return base.saveProfile(...args);
  }, async commitPearlGround(raw) { requests.push(structuredClone(raw)); return base.commitPearlGround(raw); } }) });
  const p = f.w.profiles.get(f.entities[0]); p.gold = 27; f.sessions.save(1, p); await sent.promise;
  const cmd = f.command(), handle = f.staging.swallow(cmd);
  cmd.uid = 'rewritten'; cmd.expectedVersion = 99; cmd.source.entity = f.entities[1];
  assert.equal(requests.length, 0); reply.resolve(); await f.staging.settle();
  assert.equal(requests.length, 1); assert.equal(requests[0].uid, uid); assert.equal(requests[0].operationId, handle.operationId);
  assert.equal(requests[0].profiles.length, 1); assert.equal(requests[0].profiles[0].expectedVersion, 5);
  assert.equal(requests[0].profiles[0].data.gold, 27);
  assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
});

test('a rejected managed generation fences without changing local stats, profile or events', async () => {
  const f = await fixture(), cmd = f.command(); cmd.expectedVersion = 2;
  const before = state(f.w); f.staging.swallow(cmd); await f.staging.settle();
  assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
  assert.equal((await f.base.loadUnique(uid)).version, 1); assert.equal(f.w.events.length, 0);
});

test('unavailable commit and receipt retain a fence; later authoritative reads never license local apply', async () => {
  let requests = 0, unreadable = true;
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async commitPearlGround(raw) { requests++; await base.commitPearlGround(raw); throw new StoreError('unavailable'); },
    async loadPearlGroundOperation(...args) { if (unreadable) throw new StoreError('unavailable'); return base.loadPearlGroundOperation(...args); },
  }) });
  const before = state(f.w), handle = f.staging.swallow(f.command()); await f.staging.settle();
  assert.equal(requests, 2); assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
  unreadable = false; assert.equal((await f.sessions.reconcilePearlGround(handle.operationId)).receipt.ok, true);
  assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(f.w), before);
  assert.throws(() => f.staging.assertPublishable(1), { code: 'session' });
  await assert.rejects(f.sessions.flush(), { code: 'flush' });
});

test('post-commit lifecycle/identity/bypass mismatches fence without any ECS apply or success event', async (t) => {
  for (const [name, alter] of [
    ['death', (f) => { f.w.ecs.dead[f.entities[0]] = 1; }],
    ['death then revival', (f) => { f.staging.invalidate(accounts[0]); f.w.ecs.dead[f.entities[0]] = 0; }],
    ['close', (f) => { f.sessions.close(1); }],
    ['client recycled', (f) => { f.w.ecs.clientId[f.entities[0]] = 99; }],
    ['profile replaced', (f) => { f.w.profiles.set(f.entities[0], structuredClone(f.w.profiles.get(f.entities[0]))); }],
    ['pearl bypass', (f) => { f.w.profiles.get(f.entities[0]).pearls.bag.reverse(); }],
    ['ledger bypass', (f) => { f.w.pearlLedger.get(uid).entity = f.entities[1]; }],
    ['save bypass', (f) => { f.sessions.clients.get(1).pending = { data: structuredClone(f.w.profiles.get(f.entities[0])), text: 'bypass' }; }],
  ]) await t.test(name, async () => {
    const f = await fixture(); f.staging.swallow(f.command()); await f.staging.settle(); alter(f); const before = state(f.w);
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.deepEqual(f.staging.drain(), []);
    assert.throws(() => f.staging.assertAvailable({ uids: [uid] }), { code: 'busy' });
    await assert.rejects(f.sessions.flush(), { code: 'flush' });
  });
});

test('journal preflight invalidation prevents first SQL send', async () => {
  const prepared = deferred(), reply = deferred(); let sends = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }),
    wrapJournal: (journal) => ({ ...journal, async prepare(...args) {
      const result = await journal.prepare(...args); prepared.resolve(); await reply.promise; return result;
    } }) });
  const before = state(f.w); f.staging.swallow(f.command()); await prepared.promise;
  f.staging.invalidate(accounts[0]); reply.resolve(); await f.staging.settle();
  assert.equal(sends, 0); assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
  assert.equal((await f.base.loadUnique(uid)).version, 1);
});

test('ambiguous duplicate replies keep exact request and apply only once when receipt recovery succeeds', async () => {
  const requests = [];
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
    requests.push(canonicalText(raw)); await base.commitPearlGround(raw); throw new StoreError('unavailable');
  } }) });
  const before = state(f.w); f.staging.swallow(f.command()); await f.staging.settle();
  assert.deepEqual(state(f.w), before); assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
  assert.equal(f.staging.drain()[0].state, 'applied'); assert.deepEqual(f.staging.drain(), []);
  assert.equal(f.w.events.length, 1); await f.sessions.flush(); assert.equal((await f.base.loadUnique(uid)).version, 2);
});

test('terminal journal failure never applies an otherwise committed swallow, even after read-only reconciliation', async () => {
  const f = await fixture({ wrapJournal: (journal) => ({ ...journal, async resolve() { throw new StoreError('unavailable'); } }) });
  const before = state(f.w), handle = f.staging.swallow(f.command()); await f.staging.settle();
  assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
  assert.equal((await f.base.loadUnique(uid)).version, 2);
  await assert.rejects(f.sessions.reconcilePearlGround(handle.operationId), { code: 'unavailable' });
  assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(f.w), before);
});

test('post-commit event/enqueue/release failures roll back every tentative profile, ECS, ledger and dirty change', async (t) => {
  for (const [name, alter] of [
    ['event decoration', (f) => { f.w.emit = function () { throw new Error('publication'); }; }],
    ['save enqueue', (f) => { f.sessions.save = () => { throw new StoreError('unavailable'); }; }],
    ['append event', (f) => { Object.defineProperty(f.w.events, 'push', { value: () => { throw new Error('append'); } }); }],
    ['release', (f) => { f.staging.gate.release = () => { throw new StoreError('busy'); }; }],
    ['row changed during decoration', (f) => {
      const original = f.w.emit; f.w.emit = function (event) { original.call(this, event); f.w.ecs.cdG[f.entities[0]] = 12; };
    }],
    ['progress changed during decoration', (f) => {
      const original = f.w.emit; f.w.emit = function (event) { original.call(this, event); f.w.profiles.get(f.entities[0]).gold = 33; };
    }],
    ['progress changed during enqueue', (f) => {
      const original = f.sessions.save.bind(f.sessions); f.sessions.save = (...args) => { original(...args); f.w.profiles.get(f.entities[0]).gold = 33; };
    }],
  ]) await t.test(name, async () => {
    const f = await fixture(); f.staging.swallow(f.command()); await f.staging.settle(); alter(f);
    const before = state(f.w); if (name === 'row changed during decoration') before.ecs.cdG[f.entities[0]] = 12;
    if (name.startsWith('progress changed')) before.profiles[0][1].gold = 33;
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
    assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, uid);
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal(f.sessions.clients.get(1).pending, null);
    await assert.rejects(f.sessions.flush(), { code: 'flush' });
  });
});

test('detached ECS row preserves typed conversion, never aliases brains, and rejects cross-entity writes/changed containers', async () => {
  const f = await fixture(), s = f.w.ecs, e = f.entities[0], other = f.entities[1];
  s.testFloat = new Float32Array(s.cap); const draft = pearlEcsDraft(s, e);
  draft.ecs.level[e] = 260; assert.equal(draft.ecs.level[e], 4); assert.equal(s.level[e], 1);
  assert.throws(() => { draft.ecs.hp[other] = 0; }, { code: 'effect' });
  assert.throws(() => { draft.ecs.cdG[e] = Infinity; }, { code: 'effect' });
  draft.ecs.testFloat[e] = 2; assert.throws(() => { draft.ecs.testFloat[e] = 1e99; }, { code: 'effect' });
  assert.equal(draft.ecs.testFloat[e], 2); assert.equal(s.testFloat[e], 0);
  s.brain[other] = { target: e, state: 'idle' }; const nested = pearlEcsDraft(s, e);
  nested.ecs.brain[other].state = 'chase'; assert.equal(s.brain[other].state, 'idle');
  assert.throws(() => draft.apply({ ...s }), { code: 'effect' });
  const original = s.hp; s.hp = s.hp.slice(); assert.throws(() => draft.apply(s), { code: 'effect' }); s.hp = original;
  draft.apply(s); assert.equal(s.level[e], 4); draft.rollback(); assert.equal(s.level[e], 1);
});

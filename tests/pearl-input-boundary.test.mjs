import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, sanitizeCmd } from '../src/net/protocol.js';
import { installRafts } from '../src/sim/systems/rafts.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PEARL_ACTION_BITS, PEARL_ACTION_BUFFERS } from '../src/net/pearlInputBoundary.js';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { StoreError } from '../server/store.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { fixture, accounts, scope, uid, deferred, state } from './helpers/pearl-swallow-staging.mjs';
import { fixture as replacementFixture, incomingUid, outgoingUid, WORLD } from './helpers/pearl-replace-staging.mjs';
import { database as swallowSql } from './helpers/pearl-same-holder-sql.mjs';
import { database as batchSql } from './helpers/pearl-batch-journal-sql.mjs';

const kept = BTN.DASH | BTN.GUARD | BTN.INTERACT | BTN.AIM | BTN.POTION;
const command = (seq, extra = {}) => sanitizeCmd({ seq, pt: seq, mx: 1, mz: 0.25, ax: 8, az: 9,
  btn: PEARL_ACTION_BITS | kept, prs: PEARL_ACTION_BITS | kept, ...extra });
const transport = (c) => structuredClone({ queue: c.queue, carry: c.carry, last: c.last,
  ack: c.ack, lastPt: c.lastPt, fillPt: c.fillPt, starve: c.starve });
const buffers = (w, e) => Object.fromEntries(PEARL_ACTION_BUFFERS.map((column) => [column, w.ecs[column][e]]));

function install(f, options = {}) {
  f.w ??= f.world;
  const output = [], gate = pearlMutationGate(f.sessions);
  let outcomes = [], prepares = 0;
  const s = new LocalServer({ seed: 42, bots: 0, enemies: false, dev: false, send: (id, msg) => output.push({ id, msg }),
    fill: true, now: () => 0, tickAccess: () => {
      try { gate.assertWorldAvailable(); return true; } catch (error) { if (error instanceof StoreError) return false; throw error; }
    }, beforeTick: () => { outcomes = f.staging.drain(); return !outcomes.some((q) => q.state === 'fenced'); },
  });
  s.world = f.w; installRafts(f.w, f.world ? WORLD : scope);
  for (const [i, entity] of f.entities.entries()) { s.connect(i + 1); const c = s.clients.get(i + 1); c.entity = entity; c.serverProfile = true; }
  output.length = 0;
  const prepare = (id, entity) => { prepares++; return s.preparePearlInputs(id, entity); };
  f.staging = new PearlStaging(f.sessions, f.w, f.world ? WORLD : scope,
    { captureProfile: (id, entity) => capturePearlProfile(f.w, entity), prepareInputs: prepare, ...options });
  return { s, output, prepare, outcomes: () => outcomes, prepares: () => prepares, c: s.clients.get(1) };
}

for (const [name, backend] of [['memory', undefined], ['SDK/SQL006', swallowSql]]) {
  test(`${name}: slow receipt keeps actions until apply, then movement/ACK survive and fresh G works`, async () => {
    const sent = deferred(), reply = deferred();
    const f = await fixture({ backend, wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
      const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result;
    } }) });
    const { s, c, output, prepares, outcomes } = install(f), e = f.entities[0];
    try {
      c.queue.push(command(1), command(2)); c.carry = PEARL_ACTION_BITS | BTN.POTION; c.last = command(0);
      for (const column of PEARL_ACTION_BUFFERS) f.w.ecs[column][e] = 0.12;
      const before = transport(c), oldBuffers = buffers(f.w, e), x = f.w.ecs.x[e];
      const h = f.staging.swallow(f.command()); await sent.promise;
      assert.equal(s.step(), false); assert.deepEqual(transport(c), before); assert.deepEqual(buffers(f.w, e), oldBuffers);
      assert.equal(prepares(), 0); assert.equal(c.ack, 0); assert.equal(output.length, 0);
      reply.resolve(); await f.staging.settle();
      // Paused pump applies the receipt without dequeue or publication.
      for (const client of s.clients.values()) client.paused = true;
      s.pump(); assert.deepEqual(outcomes(), [{ operationId: h.operationId, state: 'applied' }]);
      assert.equal(prepares(), 1); assert.equal(c.ack, 0); assert.equal(c.queue.length, 2);
      assert.deepEqual(buffers(f.w, e), Object.fromEntries(PEARL_ACTION_BUFFERS.map((column) => [column, 0])));
      for (const [i, cmd] of c.queue.entries()) assert.deepEqual(cmd, { ...before.queue[i], btn: kept, prs: kept });
      assert.equal(c.carry, BTN.POTION); assert.deepEqual(c.last, { ...before.last, btn: kept, prs: kept });
      assert.equal(f.w.ecs.x[e], x); assert.equal(output.length, 0);
      // Run the actual movement/combat helpers, keeping unrelated interaction/potion out of this check.
      for (const cmd of c.queue) { cmd.btn = BTN.AIM; cmd.prs = 0; }
      c.carry = 0; for (const client of s.clients.values()) client.paused = false;
      assert.equal(s.step(), true); assert.equal(c.ack, 1); assert.ok(f.w.ecs.x[e] > x);
      assert.equal(output.filter(({ msg }) => msg.t === MSG.EVENT && ['cast', 'swing', 'shot'].includes(msg.ev.type)).length, 0);
      assert.equal(s.step(), true); assert.equal(c.ack, 2);
      // The normal pearl swap cooldown remains in force; advance it through actual neutral combat.
      for (let i = 0; i < 300 && f.w.ecs.cdG[e] > 0; i++) assert.equal(s.step(), true);
      assert.equal(f.w.ecs.cdG[e], 0);
      s.receive(1, { t: MSG.INPUTS, cmds: [command(3, { btn: BTN.G, prs: BTN.G, mx: 0, mz: 0, pt: f.w.tick })] });
      assert.equal(s.step(), true); assert.equal(c.ack, 3);
      assert.ok(output.some(({ msg }) => msg.t === MSG.EVENT && msg.ev.type === 'cast' && msg.ev.seq === 3), 'a new received G uses the new pearl');
      await f.sessions.flush(); assert.equal((await f.base.loadUnique(uid)).version, 2);
      assert.equal(output.filter(({ msg }) => msg.t === MSG.EVENT && msg.ev.type === 'pearlChanged').length, 1);
      assert.equal(prepares(), 1, 'no input cleanup replay on later drains');
    } finally { reply.resolve(); await f.staging.settle(); await f.close(); }
  });
}

for (const [name, backend] of [['memory', undefined], ['SDK/SQL008', batchSql]]) {
  test(`${name}: replacement filters only its owner, keeps frozen drop and preserves new progress`, async () => {
    const f = await replacementFixture({ backend }), { s, c, prepares } = install(f), e = f.entities[0];
    try {
      c.queue.push(command(1)); c.carry = PEARL_ACTION_BITS; const other = s.clients.get(2);
      other.queue.push(command(9)); other.carry = PEARL_ACTION_BITS; const beforeOther = transport(other);
      for (const column of PEARL_ACTION_BUFFERS) f.w.ecs[column][e] = 0.13;
      const h = f.staging.replace(f.command()), rng = f.w.rng.state(); await f.staging.settle();
      f.w.profiles.get(e).gold += 5; f.w.ecs.xp[e] = 33;
      for (const client of s.clients.values()) client.paused = true;
      s.pump(); assert.equal(f.staging.operations.has(h.operationId), false); assert.equal(prepares(), 1);
      assert.deepEqual(transport(other), beforeOther); assert.equal(c.queue[0].seq, 1); assert.equal(c.queue[0].prs, kept);
      assert.equal(f.w.profiles.get(e).pearls.swallowed.uid, incomingUid); assert.equal(f.w.profiles.get(e).gold, 42);
      assert.equal(f.w.profiles.get(e).xp, 33); assert.equal(f.w.drops.size, 1);
      assert.equal([...f.w.drops.values()][0].pearl.uid, outgoingUid); assert.equal(f.w.rng.state(), rng);
      await f.sessions.flush(); assert.equal((await f.base.loadUnique(incomingUid)).version, 2);
      assert.equal((await f.base.loadUnique(outgoingUid)).version, 2);
    } finally { await f.close(); }
  });
}

test('give does not change active power and never prepares or filters either endpoint', async () => {
  const f = await fixture(), { s, c, prepares } = install(f);
  try {
    c.queue.push(command(1)); c.carry = PEARL_ACTION_BITS; const before = transport(c);
    const h = f.staging.give(f.give()); await f.staging.settle();
    for (const client of s.clients.values()) client.paused = true;
    s.pump(); assert.equal(f.staging.operations.has(h.operationId), false); assert.equal(prepares(), 0); assert.deepEqual(transport(c), before);
  } finally { await f.close(); }
});

test('a carried potion remains usable exactly once while old combat presses are removed', async () => {
  const f = await fixture(), { s, c, output } = install(f), e = f.entities[0];
  try {
    const potions = f.w.ecs.potions[e]; assert.ok(potions > 0);
    c.carry = PEARL_ACTION_BITS | BTN.POTION;
    c.queue.push(command(1, { btn: BTN.AIM | PEARL_ACTION_BITS, prs: PEARL_ACTION_BITS }));
    f.staging.swallow(f.command()); await f.staging.settle();
    assert.equal(s.step(), true); assert.equal(c.ack, 1); assert.equal(c.carry, 0);
    assert.equal(f.w.ecs.potions[e], potions - 1);
    assert.equal(output.filter(({ msg }) => msg.t === MSG.EVENT && ['cast', 'swing', 'shot'].includes(msg.ev.type)).length, 0);
    s.receive(1, { t: MSG.INPUTS, cmds: [command(2, { btn: BTN.AIM, prs: 0 })] });
    assert.equal(s.step(), true); assert.equal(f.w.ecs.potions[e], potions - 1);
  } finally { await f.close(); }
});

test('without adapter the accepted queue and non-G buffer behavior stays unchanged', async () => {
  const f = await fixture(), { s, c } = install(f, { prepareInputs: null }), e = f.entities[0];
  try {
    c.queue.push(command(1)); c.carry = PEARL_ACTION_BITS; const before = transport(c);
    f.w.ecs.qBuf[e] = 0.1; const q = f.w.ecs.qBuf[e];
    f.staging.swallow(f.command()); await f.staging.settle();
    for (const client of s.clients.values()) client.paused = true;
    s.pump(); assert.deepEqual(transport(c), before); assert.equal(f.w.ecs.qBuf[e], q);
    assert.equal(f.w.ecs.gBuf[e], 0, 'existing pearl change rule still clears G');
  } finally { await f.close(); }
});

test('trim/late carry cannot resurrect filtered actions; remaining movement and filler ACK are normal', async () => {
  const f = await fixture(), { s, c } = install(f);
  try {
    s.receive(1, { t: MSG.INPUTS, cmds: Array.from({ length: 35 }, (_, i) => command(i + 1)) });
    assert.equal(c.queue.length, 30); assert.equal(s.stats.trimmed, 5); c.fillPt = 12;
    f.staging.swallow(f.command()); await f.staging.settle();
    const applied = [], original = f.w.applyCommand.bind(f.w);
    f.w.applyCommand = (entity, cmd) => { applied.push(structuredClone(cmd)); original(entity, cmd); };
    assert.equal(s.step(), true); assert.equal(s.stats.late, 7); assert.equal(s.stats.trimmed, 5);
    assert.equal(c.ack, 16); assert.ok(applied.length > 0);
    for (const cmd of applied) assert.equal((cmd.btn | cmd.prs) & PEARL_ACTION_BITS, 0);
    c.queue.length = 0; const ack = c.ack;
    assert.equal(s.applyFiller(c), true); assert.equal(c.ack, ack);
    assert.deepEqual({ mx: applied.at(-1).mx, mz: applied.at(-1).mz, prs: applied.at(-1).prs }, { mx: 0, mz: 0, prs: 0 });
    assert.equal(applied.at(-1).btn, BTN.AIM);
  } finally { await f.close(); }
});

test('local save failure after filtering restores transport references and ECS buffers; SQL stays committed', async () => {
  const f = await fixture(), { s, c, outcomes } = install(f), e = f.entities[0];
  try {
    const first = command(1), last = command(0); c.queue.push(first); c.last = last; c.carry = PEARL_ACTION_BITS | BTN.POTION;
    for (const column of PEARL_ACTION_BUFFERS) f.w.ecs[column][e] = 0.11;
    const before = transport(c), oldBuffers = buffers(f.w, e), queue = c.queue, profile = f.w.profiles.get(e);
    const h = f.staging.swallow(f.command()); await f.staging.settle();
    const original = f.sessions.save.bind(f.sessions); f.sessions.save = () => { throw new StoreError('unavailable'); };
    assert.equal(s.step(), false); assert.equal(f.staging.operations.get(h.operationId).state, 'fenced'); assert.equal(outcomes()[0].code, 'unavailable');
    assert.deepEqual(transport(c), before); assert.equal(c.queue, queue); assert.equal(c.queue[0], first); assert.equal(c.last, last);
    assert.deepEqual(buffers(f.w, e), oldBuffers); assert.equal(f.w.profiles.get(e), profile); assert.equal(profile.pearls.swallowed, null);
    assert.equal(f.w.events.length, 0); assert.equal((await f.base.loadUnique(uid)).version, 2);
    assert.throws(() => pearlMutationGate(f.sessions).assertWorldAvailable(), { code: 'busy' });
    f.sessions.save = original; assert.equal(s.step(), false); assert.deepEqual(transport(c), before);
  } finally { await f.close(); }
});

test('builtin effect refuses preparation outside apply and detects changed queue or identity before its writes', async (t) => {
  for (const mode of ['queue', 'command', 'carry', 'last', 'ack', 'identity']) await t.test(mode, async () => {
    const f = await fixture(), { s, c } = install(f); c.queue.push(command(1)); c.last = command(0);
    try {
      assert.throws(() => s.preparePearlInputs(1, f.entities[0]), /tick apply/);
      s.beforeTick = () => {
        const effect = s.preparePearlInputs(1, f.entities[0]);
        if (mode === 'queue') c.queue.push(command(2));
        if (mode === 'command') c.queue[0].prs = 0;
        if (mode === 'carry') c.carry = BTN.G;
        if (mode === 'last') c.last = command(3);
        if (mode === 'ack') c.ack = 4;
        if (mode === 'identity') s.clients.set(1, { ...c });
        const afterExternal = transport(c);
        assert.throws(() => effect.apply(), /pearl input/); assert.deepEqual(transport(c), afterExternal);
        return false;
      };
      assert.equal(s.step(), false);
    } finally { await f.close(); }
  });
});

test('invalid, async and caught reentrant input adapters fence before local writes', async (t) => {
  for (const mode of ['throw', 'Promise', 'rejected Promise', 'missing method', 'reentry', 'getter reentry']) await t.test(mode, async () => {
    const f = await fixture(), { s, c } = install(f, { prepareInputs: () => {
      if (mode === 'throw') throw new StoreError('effect');
      if (mode === 'Promise') return Promise.resolve({});
      if (mode === 'rejected Promise') return Promise.reject(new Error('bad input adapter'));
      if (mode === 'missing method') return { apply() {} };
      if (mode === 'getter reentry') return { get assertCurrent() {
        try { f.staging.drain(); } catch {}
        return () => {};
      }, apply() {}, assertApplied() {}, rollback() {} };
      try { f.staging.drain(); } catch {}
      return s.preparePearlInputs(1, f.entities[0]);
    } });
    try {
      c.queue.push(command(1)); const before = transport(c), beforeWorld = state(f.w);
      const h = f.staging.swallow(f.command()); await f.staging.settle();
      assert.equal(s.step(), false); assert.equal(f.staging.operations.get(h.operationId).state, 'fenced'); assert.deepEqual(transport(c), before);
      assert.deepEqual(state(f.w), beforeWorld); assert.equal((await f.base.loadUnique(uid)).version, 2);
      await new Promise((done) => setImmediate(done));
    } finally { await f.close(); }
  });
});

test('failed input apply/assert and rollback callback cannot leave staging-owned ECS/profile writes applied', async (t) => {
  for (const mode of ['apply throw', 'apply Promise', 'assert reentry', 'rollback throw']) await t.test(mode, async () => {
    const f = await fixture(); let real;
    const { s, c } = install(f, { prepareInputs: (id, entity) => {
      real = s.preparePearlInputs(id, entity);
      return { ...real,
        apply() { real.apply(); if (mode === 'apply Promise') return Promise.resolve();
          if (mode === 'apply throw') throw new StoreError('effect'); },
        assertApplied() { real.assertApplied(); if (mode === 'assert reentry') { try { f.staging.save(1, f.w.profiles.get(entity)); } catch {} }
          if (mode === 'rollback throw') throw new StoreError('effect'); },
        rollback() { real.rollback(); if (mode === 'rollback throw') throw new StoreError('effect'); },
      };
    } });
    try {
      c.queue.push(command(1)); const before = transport(c), beforeWorld = state(f.w);
      const h = f.staging.swallow(f.command()); await f.staging.settle();
      assert.equal(s.step(), false); assert.equal(f.staging.operations.get(h.operationId).state, 'fenced'); assert.deepEqual(transport(c), before);
      assert.deepEqual(state(f.w), beforeWorld); assert.equal((await f.base.loadUnique(uid)).version, 2);
      await new Promise((done) => setImmediate(done));
    } finally { await f.close(); }
  });
});

test('invalidated death/revival, closed session and recycled profile never prepare an input effect', async (t) => {
  for (const mode of ['death/revival', 'closed', 'recycled']) await t.test(mode, async () => {
    const f = await fixture(), { s, c, prepares } = install(f), e = f.entities[0];
    try {
      c.queue.push(command(1)); f.staging.swallow(f.command()); await f.staging.settle();
      if (mode === 'death/revival') { pearlMutationGate(f.sessions).invalidate({ accounts: [accounts[0]] }); f.w.ecs.dead[e] = 0; }
      if (mode === 'closed') f.sessions.close(1);
      if (mode === 'recycled') f.w.profiles.set(e, structuredClone(f.w.profiles.get(e)));
      const before = transport(c); assert.equal(s.step(), false); assert.equal(prepares(), 0); assert.deepEqual(transport(c), before);
    } finally { await f.close(); }
  });
});

test('adapter configuration and selector validation fail closed without transport changes', async () => {
  const f = await fixture(), { s, c } = install(f); c.queue.push(command(1));
  try {
    assert.throws(() => new PearlStaging(f.sessions, f.w, scope, { prepareInputs: true }), { code: 'configuration' });
    const before = transport(c);
    s.beforeTick = () => { assert.throws(() => s.preparePearlInputs(2, f.entities[0]), /identity/); return false; };
    assert.equal(s.step(), false); assert.deepEqual(transport(c), before);
  } finally { await f.close(); }
});

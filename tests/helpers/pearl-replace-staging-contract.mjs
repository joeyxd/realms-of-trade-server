import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPearlChange } from '../../src/sim/systems/pearlEffect.js';
import { StoreError } from '../../server/store.mjs';
import { canonicalText } from '../../server/pearlOperations.mjs';
import { PearlStaging } from '../../server/pearlStaging.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { World } from '../../src/sim/world.js';
import { attachProfile, installInventory } from '../../src/sim/systems/inventory.js';
import { map, A as arena } from '../helpers.mjs';
import { PEARL, PEARL_IDS } from '../../src/data/pearls.js';
import { DT } from '../../src/data/tuning.js';
import { WORLD, accounts, incomingUid, outgoingUid, deferred, state, row, profileData } from './pearl-replace-staging.mjs';

const copy = (value) => structuredClone(value);
const pair = (f) => [incomingUid, outgoingUid];

export function replacementContract(setup) {
  test('replacement reserves both UID lanes and account through durable commit until one synchronous drain', async () => {
    const sent = deferred(), release = deferred(); let captured;
    const f = await setup({ wrapStore: (base) => ({ ...base, async commitPearlBatch(raw) {
      const result = await base.commitPearlBatch(raw); captured = copy(raw); sent.resolve(); await release.promise; return result;
    } }) });
    try {
      const before = state(f.world), handle = f.staging.replace(f.command());
      assert.deepEqual(state(f.world), before);
      assert.deepEqual(f.staging.drain(), []);
      await sent.promise;
      assert.deepEqual(state(f.world), before, 'commit completion cannot mutate World');
      assert.throws(() => f.staging.assertAvailable({ uids: [incomingUid] }), { code: 'busy' });
      assert.throws(() => f.staging.assertAvailable({ uids: [outgoingUid] }), { code: 'busy' });
      assert.throws(() => f.staging.assertAvailable({ accounts: [accounts[0]] }), { code: 'busy' });
      const durable = await f.base.loadProfile(accounts[0]);
      assert.equal(durable.data.pearls.swallowed.uid, incomingUid);
      assert.equal(durable.data.pearls.bag.some((q) => q.uid === incomingUid), false);
      assert.equal(f.world.profiles.get(f.entities[0]).pearls.swallowed.uid, outgoingUid);
      release.resolve(); await f.staging.settle();
      assert.deepEqual(state(f.world), before, 'terminal journal completion still waits for drain');
      assert.equal(captured.operationId, handle.operationId);
      assert.equal(captured.mode, 'replace'); assert.equal(captured.world, WORLD); assert.equal(captured.profile.id, accounts[0]);
      assert.equal(captured.items.length, 2);
      assert.deepEqual(captured.items.map((q) => q.uid), pair(f).sort());
      assert.equal(captured.items.find((q) => q.uid === incomingUid).ground, null);
      const outgoing = captured.items.find((q) => q.uid === outgoingUid);
      assert.equal(outgoing.ground.availableAt, f.world.tick + 30);
      assert.equal(outgoing.ground.returnAt, f.world.tick + Math.round(PEARL.returnAfter / DT));
      assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
      const live = f.world.profiles.get(f.entities[0]);
      assert.deepEqual(live.pearls, durable.data.pearls);
      assert.deepEqual(live.pearls.bag.map((q) => q.uid), [pearlsUid(0), pearlsUid(2)]);
      assert.equal(f.world.pearlLedger.get(incomingUid).place, 'profile');
      assert.equal(f.world.pearlLedger.get(incomingUid).owner, `account:${accounts[0]}`);
      assert.equal(f.world.pearlLedger.get(outgoingUid).place, 'ground');
      assert.equal(f.world.pearlLedger.get(outgoingUid).drop, [...f.world.drops.values()].find((d) => d.pearl.uid === outgoingUid).id);
      assert.deepEqual(f.world.events.map((e) => e.type), ['loot', 'pearlChanged']);
      assert.deepEqual(f.world.events[0].drops[0], {
        id: f.world.pearlLedger.get(outgoingUid).drop, kind: 'pearl', pearl: { uid: outgoingUid, kind: 'tinta' },
        x: outgoing.ground.x, z: outgoing.ground.z, pub: 1, from: f.world.ecs.names[f.entities[0]],
      });
      assert.deepEqual(f.world.drops.get(f.world.pearlLedger.get(outgoingUid).drop), {
        id: f.world.pearlLedger.get(outgoingUid).drop, to: 0, kind: 'pearl', pearl: { uid: outgoingUid, kind: 'tinta' },
        x: outgoing.ground.x, z: outgoing.ground.z, t: outgoing.ground.returnAt,
        pickAt: outgoing.ground.availableAt, from: f.entities[0], fromName: f.world.ecs.names[f.entities[0]],
      });
      assert.deepEqual(f.staging.drain(), []);
      f.staging.assertAvailable({ uids: pair(f) });
      await f.sessions.flush();
      const saved = await f.base.loadProfile(accounts[0]);
      assert.equal(saved.data.gold, 37); assert.equal(saved.data.xp, 21); assert.deepEqual(saved.data.mast[0], [3, 123]);
      assert.deepEqual(saved.data.pearls, live.pearls);
      const audit = await f.base.loadPearlBatchOperation(handle.operationId);
      assert.deepEqual(audit.request, { world: WORLD, mode: 'replace', profile: {
        id: accounts[0], expectedVersion: captured.profile.expectedVersion, data: captured.profile.data,
      }, items: captured.items });
      for (const item of captured.items) {
        assert.deepEqual(await f.base.loadUnique(item.uid), { kind: `pearl:${item.kind}`,
          holder: item.ground === null ? accounts[0] : null, version: item.expectedVersion + 1 });
        assert.deepEqual(await f.base.loadPearlLocation(item.uid), { world: WORLD, ground: item.ground,
          version: item.expectedVersion + 1 });
      }
      assert.deepEqual(await f.journal.list(), []);
    } finally { await f.close(); }
  });

  test('a prior profile CAS drains before replacement builds its immutable batch request', async () => {
    const saveEntered = deferred(), allowSave = deferred(), batchEntered = deferred(), allowBatch = deferred();
    let raw;
    const f = await setup({ wrapStore: (base) => ({ ...base,
      async saveProfile(...args) { saveEntered.resolve(); await allowSave.promise; return base.saveProfile(...args); },
      async commitPearlBatch(request) { raw = copy(request); batchEntered.resolve(); const result = await base.commitPearlBatch(request); await allowBatch.promise; return result; },
    }) });
    try {
      const profile = profileData(f.world, f.entities[0]); profile.gold = 48;
      f.sessions.save(1, profile); await saveEntered.promise;
      const command = f.command(), handle = f.staging.replace(command);
      command.uid = 'rewritten'; command.replaceUid = 'rewritten-old'; command.expectedVersion = 99;
      assert.equal(raw, undefined);
      allowSave.resolve(); await batchEntered.promise;
      assert.equal(raw.operationId, handle.operationId); assert.equal(raw.profile.data.gold, 48);
      const frozenGround = copy(raw.items.find((q) => q.uid === outgoingUid).ground);
      f.world.tick += 120; f.world.ecs.x[f.entities[0]] += 37; f.world.ecs.z[f.entities[0]] -= 11;
      f.world.ecs.regenT[f.entities[0]] = 0;
      allowBatch.resolve(); await f.staging.settle();
      assert.deepEqual(raw.items.find((q) => q.uid === outgoingUid).ground, frozenGround);
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'applied');
      assert.equal(f.world.drops.get(f.world.pearlLedger.get(outgoingUid).drop).x, frozenGround.x);
      assert.equal(f.world.drops.get(f.world.pearlLedger.get(outgoingUid).drop).z, frozenGround.z);
      assert.equal(profile.gold, 48);
      await f.sessions.flush(); assert.equal((await f.base.loadProfile(accounts[0])).data.gold, 48);
    } finally { allowSave.resolve(); allowBatch.resolve(); await f.close(); }
  });

  test('a second coordinator sees both reservations synchronously before either task reaches its first await', async () => {
    const f = await setup();
    try {
      f.staging.replace(f.command());
      const second = new PearlStaging(f.sessions, f.world, WORLD);
      assert.throws(() => second.replace(f.command()), { code: 'busy' });
      for (const uid of pair(f)) assert.throws(() => second.assertAvailable({ uids: [uid] }), { code: 'busy' });
      assert.throws(() => second.assertAvailable({ accounts: [accounts[0]] }), { code: 'busy' });
    } finally { await f.staging.settle(); await f.close(); }
  });

  for (const kind of PEARL_IDS) test(`replacement uses the shared swallow effect for ${kind} and preserves latest progress`, async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ incomingKind: kind, wrapStore: (base) => ({ ...base, async commitPearlBatch(raw) {
      const result = await base.commitPearlBatch(raw); entered.resolve(); await release.promise; return result;
    } }) });
    try {
      const handle = f.staging.replace(f.command()); await entered.promise;
      const e = f.entities[0], profile = profileData(f.world, e), ecs = f.world.ecs;
      profile.gold += 9; profile.xp = 44; profile.mast[0][0] = 7;
      f.staging.save(1, profile);
      release.resolve(); await f.staging.settle();
      profile.gold += 2; profile.xp = 55; profile.eq.weapon.l = 4;
      ecs.level[e] = 4; ecs.maxHp[e] += 10; ecs.hp[e] = 13; ecs.gBuf[e] = 0.8;
      ecs.x[e] += 2; ecs.vx[e] = 3; ecs.castK[e] = 1; ecs.atkStage[e] = 2;
      f.staging.save(1, profile);
      const expectedProfile = copy(profile); expectedProfile.pearls.bag = expectedProfile.pearls.bag.filter((q) => q.uid !== incomingUid);
      expectedProfile.pearls.swallowed = { uid: incomingUid, kind };
      const expectedEcs = copy(ecs); applyPearlChange({ ecs: expectedEcs, profiles: new Map([[e, expectedProfile]]) }, e);
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'applied');
      assert.deepEqual(row(ecs, e), row(expectedEcs, e));
      assert.deepEqual(profile.pearls, expectedProfile.pearls);
      assert.equal(profile.gold, 48); assert.equal(profile.xp, 55); assert.deepEqual(profile.mast[0], [7, 123]);
      assert.equal(f.world.events.at(-1).elem, PEARL_IDS.indexOf(kind) + 1);
      await f.sessions.flush();
      const stored = await f.base.loadProfile(accounts[0]);
      assert.equal(stored.data.gold, 48); assert.equal(stored.data.xp, 55); assert.deepEqual(stored.data.pearls, expectedProfile.pearls);
    } finally { await f.close(); }
  });

  test('preflight rejects stale confirmation, generations, ownership, combat and lifecycle without reserving or mutating', async (t) => {
    for (const [name, alter] of [
      ['wrong outgoing confirmation', (f, cmd) => { cmd.replaceUid = 'not-the-swallowed-pearl'; }],
      ['zero incoming generation', (_f, cmd) => { cmd.expectedVersion = 0; }],
      ['malformed outgoing generation', (_f, cmd) => { cmd.replaceExpectedVersion = NaN; }],
      ['wrong incoming holder', (f) => { f.world.pearlLedger.get(incomingUid).owner = `account:${accounts[1]}`; }],
      ['wrong outgoing ledger place', (f) => { f.world.pearlLedger.set(outgoingUid, { owner: '', entity: 0, place: 'ground', drop: 88 }); }],
      ['combat', (f) => { f.world.ecs.regenT[f.entities[0]] = 0; }],
      ['bag UID missing', (f) => { f.world.profiles.get(f.entities[0]).pearls.bag = []; }],
      ['dead actor', (f) => { f.world.ecs.dead[f.entities[0]] = 1; }],
      ['recycled actor', (f) => { f.world.ecs.clientId[f.entities[0]] = 99; }],
    ]) await t.test(name, async () => {
      const f = await setup();
      try {
        const command = f.command(); alter(f, command); const before = state(f.world);
        assert.throws(() => f.staging.replace(command));
        assert.deepEqual(state(f.world), before);
        assert.equal(f.staging.operations.size, 0);
      } finally { await f.close(); }
    });
  });

  test('death, close, identity recycle, bypass and invalidation after durable commit fence both UIDs without local apply', async (t) => {
    for (const [name, alter] of [
      ['death', (f) => { f.world.ecs.dead[f.entities[0]] = 1; }],
      ['close', (f) => { f.sessions.close(1); }],
      ['profile recycle', (f) => { f.world.profiles.set(f.entities[0], copy(f.world.profiles.get(f.entities[0]))); }],
      ['sticky death then revival', (f) => { f.staging.invalidate(accounts[0]); f.world.ecs.dead[f.entities[0]] = 0; }],
      ['incoming ledger bypass', (f) => { f.world.pearlLedger.get(incomingUid).entity = f.entities[1]; }],
      ['outgoing ledger bypass', (f) => { f.world.pearlLedger.get(outgoingUid).entity = f.entities[1]; }],
      ['pearl profile bypass', (f) => { f.world.profiles.get(f.entities[0]).pearls.bag.reverse(); }],
    ]) await t.test(name, async () => {
      const f = await setup();
      try {
        const handle = f.staging.replace(f.command()); await f.staging.settle(); alter(f);
        const before = state(f.world), result = f.staging.drain();
        assert.equal(result[0].operationId, handle.operationId); assert.equal(result[0].state, 'fenced');
        assert.deepEqual(state(f.world), before); assert.deepEqual(f.staging.drain(), []);
        for (const uid of pair(f)) assert.throws(() => f.staging.assertAvailable({ uids: [uid] }), { code: 'busy' });
        assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, incomingUid);
      } finally { await f.close(); }
    });
  });

  test('a store-generation mismatch is fenced after batch validation; no UID is applied locally', async (t) => {
    for (const field of ['expectedVersion', 'replaceExpectedVersion']) await t.test(field, async () => {
      const f = await setup();
      try {
        const command = f.command(); command[field]++;
        const before = state(f.world), handle = f.staging.replace(command);
        await f.staging.settle();
        const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'fenced');
        assert.deepEqual(state(f.world), before);
        for (const uid of pair(f)) assert.throws(() => f.staging.assertAvailable({ uids: [uid] }), { code: 'busy' });
      } finally { await f.close(); }
    });
  });

  test('lifecycle invalidation during journal prepare prevents SQL dispatch and keeps the pair fenced', async () => {
    const preparing = deferred(), release = deferred(); let sends = 0;
    const f = await setup({
      wrapStore: (base) => ({ ...base, async commitPearlBatch(raw) { sends++; return base.commitPearlBatch(raw); } }),
      wrapJournal: (journal) => ({ ...journal, async prepare(...args) {
        const result = await journal.prepare(...args); preparing.resolve(); await release.promise; return result;
      } }),
    });
    try {
      const before = state(f.world), handle = f.staging.replace(f.command()); await preparing.promise;
      f.staging.invalidate(accounts[0]); release.resolve(); await f.staging.settle();
      assert.equal(sends, 0);
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'fenced');
      assert.deepEqual(state(f.world), before);
      for (const uid of pair(f)) assert.throws(() => f.staging.assertAvailable({ uids: [uid] }), { code: 'busy' });
      assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, outgoingUid);
    } finally { release.resolve(); await f.close(); }
  });

  test('historical receipt reconciliation cannot publish gameplay after a terminal journal failure', async () => {
    const f = await setup({ wrapJournal: (journal) => ({ ...journal, async resolve() { throw new StoreError('unavailable'); } }) });
    try {
      const before = state(f.world), handle = f.staging.replace(f.command()); await f.staging.settle();
      assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
      assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, incomingUid);
      await assert.rejects(f.sessions.reconcilePearlBatch(handle.operationId), { code: 'unavailable' });
      assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(f.world), before);
    } finally { await f.close(); }
  });

  test('slow terminal journal closure leaves gameplay untouched and both reservations held until drain', async () => {
    const terminal = deferred(), release = deferred();
    const f = await setup({ wrapJournal: (journal) => ({ ...journal, async resolve(...args) {
      const result = await journal.resolve(...args); terminal.resolve(); await release.promise; return result;
    } }) });
    try {
      const before = state(f.world), handle = f.staging.replace(f.command()); await terminal.promise;
      assert.deepEqual(state(f.world), before);
      assert.throws(() => f.staging.assertAvailable({ uids: [incomingUid] }), { code: 'busy' });
      assert.throws(() => f.staging.assertAvailable({ uids: [outgoingUid] }), { code: 'busy' });
      release.resolve(); await f.staging.settle(); assert.deepEqual(state(f.world), before);
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'applied');
      assert.equal(f.world.events.length, 2);
    } finally { release.resolve(); await f.close(); }
  });

  test('ambiguous committed reply retries only identical batch bytes and applies one receipt once', async () => {
    const requests = [];
    const f = await setup({ wrapStore: (base) => ({ ...base, async commitPearlBatch(request) {
      requests.push(canonicalText(request)); await base.commitPearlBatch(request); throw new StoreError('unavailable');
    } }) });
    try {
      const before = state(f.world), handle = f.staging.replace(f.command()); await f.staging.settle();
      assert.deepEqual(state(f.world), before); assert.equal(requests.length, 2);
      assert.ok(requests.every((text) => text === requests[0]));
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'applied');
      assert.equal(f.world.events.length, 2); assert.equal(f.world.drops.size, 1);
      assert.deepEqual(f.staging.drain(), []);
      await f.sessions.flush();
    } finally { await f.close(); }
  });

  test('unreadable post-commit receipt fences; later read-only reconciliation never applies gameplay', async () => {
    let unreadable = true, sends = 0;
    const f = await setup({ wrapStore: (base) => ({ ...base,
      async commitPearlBatch(request) { sends++; await base.commitPearlBatch(request); throw new StoreError('unavailable'); },
      async loadPearlBatchOperation(...args) { if (unreadable) throw new StoreError('unavailable'); return base.loadPearlBatchOperation(...args); },
    }) });
    try {
      const before = state(f.world), handle = f.staging.replace(f.command()); await f.staging.settle();
      assert.equal(sends, 2); assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
      unreadable = false; await f.sessions.reconcilePearlBatch(handle.operationId);
      assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(f.world), before);
    } finally { await f.close(); }
  });

  test('a restarted authority hydrates committed profile state without historical loot or effect', async () => {
    const f = await setup();
    try {
      const oldBefore = state(f.world), handle = f.staging.replace(f.command()); await f.staging.settle();
      assert.deepEqual(state(f.world), oldBefore);
      const recovered = new ProfileSessions(f.base, () => {}, { journal: f.journal });
      await recovered.recoverPearls();
      const nextWorld = new World(99, { map, server: true }); installInventory(nextWorld, WORLD);
      const loaded = await recovered.open(41, accounts[0]);
      const entity = nextWorld.spawnPlayer({ x: arena.x, z: arena.z, clientId: 41 });
      attachProfile(nextWorld, entity, loaded);
      assert.equal(loaded.pearls.swallowed.uid, incomingUid);
      assert.equal(loaded.pearls.bag.some((q) => q.uid === incomingUid), false);
      assert.equal(nextWorld.drops.size, 0);
      assert.equal(nextWorld.events.some((event) => event.type === 'loot' || event.type === 'pearlChanged'), false);
      f.staging.invalidate(accounts[0]);
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'fenced');
      assert.deepEqual(state(f.world), oldBefore);
      assert.equal(nextWorld.drops.size, 0);
      assert.equal(nextWorld.events.some((event) => event.type === 'loot' || event.type === 'pearlChanged'), false);
    } finally { await f.close(); }
  });

  test('replacement drop search preserves existing map/deck fallback behavior and does not consume world RNG', async () => {
    const f = await setup();
    try {
      const blockedDeck = { surface: () => null, blocked: () => true };
      f.world.raftDeck = blockedDeck;
      const before = state(f.world), handle = f.staging.replace(f.command()); await f.staging.settle();
      const request = await f.base.loadPearlBatchOperation(handle.operationId);
      const ground = request.request.items.find((q) => q.uid === outgoingUid).ground;
      assert.deepEqual(ground, { x: f.world.ecs.cpX[f.entities[0]], z: f.world.ecs.cpZ[f.entities[0]],
        availableAt: f.world.tick + 30, returnAt: f.world.tick + Math.round(PEARL.returnAfter / DT) });
      assert.equal(f.world.rng.state(), before.rng); assert.equal(f.world.lootRng.state(), before.lootRng);
      assert.deepEqual(f.staging.drain()[0], { operationId: handle.operationId, state: 'applied' });
    } finally { await f.close(); }
  });

  test('a concurrent drop allocation advances the counter and replacement keeps committed geometry/time', async () => {
    const entered = deferred(), release = deferred(), requests = [];
    const f = await setup({ wrapStore: (base) => ({ ...base, async commitPearlBatch(raw) {
      requests.push(copy(raw)); const result = await base.commitPearlBatch(raw); entered.resolve(); await release.promise; return result;
    } }) });
    try {
      const handle = f.staging.replace(f.command()); await entered.promise;
      const collisionId = f.world.nextDrop;
      f.world.drops.set(collisionId, { id: collisionId, kind: 'unrelated', pearl: { uid: 'unrelated' } });
      const collision = copy(f.world.drops.get(collisionId));
      f.world.nextDrop++;
      release.resolve(); await f.staging.settle();
      const ground = copy(requests[0].items.find((q) => q.uid === outgoingUid).ground);
      const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'applied');
      const dropId = f.world.pearlLedger.get(outgoingUid).drop, drop = f.world.drops.get(dropId);
      assert.notEqual(dropId, collisionId); assert.deepEqual(f.world.drops.get(collisionId), collision);
      assert.deepEqual({ x: drop.x, z: drop.z, pickAt: drop.pickAt, t: drop.t },
        { x: ground.x, z: ground.z, pickAt: ground.availableAt, t: ground.returnAt });
    } finally { await f.close(); }
  });

  test('an occupied current nextDrop fences without overwriting another drop', async () => {
    const f = await setup();
    try {
      const handle = f.staging.replace(f.command()); await f.staging.settle();
      const collisionId = f.world.nextDrop;
      const collision = { id: collisionId, kind: 'unrelated', pearl: { uid: 'unrelated' } };
      f.world.drops.set(collisionId, collision);
      const before = state(f.world), result = f.staging.drain()[0];
      assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'fenced');
      assert.deepEqual(state(f.world), before); assert.deepEqual(f.world.drops.get(collisionId), collision);
      assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, incomingUid);
    } finally { await f.close(); }
  });

  test('publication preparation and event append failures never leak a partial replacement', async (t) => {
    for (const [name, corrupt] of [
      ['event decoration', (f) => { f.world.emit = function () { throw new StoreError('unavailable'); }; }],
      ['event append after first publication', (f) => {
        const events = f.world.events, push = events.push.bind(events);
        Object.defineProperty(events, 'push', { value(...items) { push(items[0]); throw new StoreError('unavailable'); } });
      }],
      ['drop insertion after mutation', (f) => {
        const drops = f.world.drops, set = drops.set.bind(drops);
        drops.set = (id, drop) => { set(id, drop); throw new StoreError('unavailable'); };
      }],
      ['second ledger write', (f) => {
        const ledger = f.world.pearlLedger, set = ledger.set.bind(ledger); let calls = 0;
        ledger.set = (uid, rowValue) => { if (++calls === 2) throw new StoreError('unavailable'); return set(uid, rowValue); };
      }],
      ['save enqueue', (f) => { f.sessions.save = () => { throw new StoreError('unavailable'); }; }],
      ['ledger mutation during save callback', (f) => {
        const save = f.sessions.save.bind(f.sessions);
        f.sessions.save = (...args) => {
          const result = save(...args);
          for (const uid of pair(f)) f.world.pearlLedger.get(uid).owner = 'callback-mutation';
          return result;
        };
      }],
      ['gate release', (f) => { f.staging.gate.release = () => { throw new StoreError('unavailable'); }; }],
    ]) await t.test(name, async () => {
      const f = await setup();
      try {
        const handle = f.staging.replace(f.command()); await f.staging.settle(); corrupt(f); const before = state(f.world);
        const result = f.staging.drain()[0]; assert.equal(result.operationId, handle.operationId); assert.equal(result.state, 'fenced');
        assert.deepEqual(state(f.world), before);
        assert.equal(f.world.profiles.get(f.entities[0]).pearls.swallowed.uid, outgoingUid);
        assert.equal((await f.base.loadProfile(accounts[0])).data.pearls.swallowed.uid, incomingUid);
        for (const uid of pair(f)) assert.throws(() => f.staging.assertAvailable({ uids: [uid] }), { code: 'busy' });
      } finally { await f.close(); }
    });
  });

}

function pearlsUid(index) { return ['batch-a', 'batch-b', 'batch-c', 'batch-d'][index]; }

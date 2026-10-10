import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { PILOTING } from '../src/data/progression.js';
import { NAVAL_LESSON } from '../src/data/navalLesson.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORLD = 'pilot-continuity-test';
const turn = () => new Promise(resolve => setImmediate(resolve));
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close(code = 1000) { if (this.readyState !== 1) return; this.readyState = 3; this.code = code; this.emit('close'); }
  ping() {}
}

function connect(host, name = 'Pilot continuity') {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({
    t: MSG.HELLO, v: PROTOCOL_VERSION, name,
  })), false);
  const of = type => ws.messages.filter(message => message.t === type);
  return { id, ws, hello, of };
}

function accountProfile() {
  const p = newProfile();
  p.pirateId = `account:${ACCOUNT}`;
  p.gold = 731;
  p.eco.pack.goods = { madera: 4, fruta: 2 };
  p.progression = { v: 1, practice: { logging: 30 }, milestones: [], knowledge: [] };
  return p;
}

function makeHost(store) {
  return new GameHost({ seed: 71, bots: 0, log: () => {}, store, saves: hmacSaves('pilot-continuity-test'),
    resolvePlayer: async () => ACCOUNT, initializeAccounts: true, worldId: WORLD });
}

async function openHost(t, store) {
  const h = makeHost(store);
  t.after(async () => {
    if (!h.closePromise) {
      try { await h.close(); } catch (error) { if (error.code !== 'flush') throw error; }
    }
  });
  await h.prepare();
  const c = connect(h); c.hello(); await Promise.all([...h.joins]);
  assert.equal(c.of(MSG.WELCOME).length, 1, 'the authenticated M5 account joins');
  await h.profiles.flush();
  const entity = h.server.clients.get(c.id).entity;
  return { h, c, entity };
}

function mount(h, c, entity) {
  const world = h.server.world;
  const raft = publicRafts(world).find(row => row.owner === entity);
  assert.ok(raft, 'the account has its attached raft');
  const helm = pilotPoint(raft, raft.helm), ecs = world.ecs;
  ecs.x[entity] = helm.x; ecs.y[entity] = helm.y; ecs.z[entity] = helm.z; ecs.facing[entity] = helm.f;
  assert.equal(h.server.playerCommand(h.server.clients.get(c.id),
    { type: 'navalPilot', op: 'mount', shipId: raft.id }), true);
  return { raft, epoch: world.navalPilot.snapshot(entity).epoch };
}

function completeLesson(h, c, entity) {
  const { raft, epoch } = mount(h, c, entity), world = h.server.world;
  const command = op => h.server.playerCommand(h.server.clients.get(c.id),
    { type: 'navalPilot', op, epoch });
  assert.equal(command('lessonStart'), true);
  const [first, second] = world.navalLesson.snapshot(entity).buoys;
  const route = world.navalRoute, priorCommit = route.commit.bind(route), parts = raft.parts;
  const startTick = world.tick;
  route.plan = (_owner, _shipId, candidate) => {
    const elapsed = candidate.state.tick - startTick;
    const pose = elapsed === 1 ? second : elapsed === 2 ? first
      : elapsed <= 2 + NAVAL_LESSON.stableTicks ? second : world.navalLesson.snapshot(entity).home;
    const body = createTrialBody(parts, { ...candidate.pose, ...pose }, 'pilot-continuity-fixture', candidate.state.tick,
      { navigation: true, cargo: candidate.cargo, flowOrigin: candidate.flowOrigin,
        wind: candidate.wind, structure: candidate.structure, activity: candidate.activity,
        parked: candidate.parked, helmResponse: candidate.helmResponse });
    return { body, state: { owner: entity } };
  };
  route.commit = plan => plan ? true : priorCommit(plan);
  for (let tick = 0; tick < NAVAL_LESSON.stableTicks + 3; tick++) assert.equal(h.server.step(), true);
  assert.equal(world.navalLesson.snapshot(entity).status, 'returning');
  assert.equal(command('dock'), true, 'the normal server-owned dock command accepts the return');
  assert.equal(world.navalLesson.snapshot(entity).status, 'complete');
  return world.profiles.get(entity);
}

function latestLessonSnapshot(h, c) {
  c.ws.messages.length = 0;
  h.server.broadcastSnapshot();
  return c.of(MSG.SNAPSHOT).at(-1)?.lesson;
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await turn(); }
  assert.fail(message);
}

function durableMemoryStore() {
  return { ...createMemoryStore(), durable: true };
}

test('accepted coastal dock saves one profile-only milestone and publishes pending then saved', async t => {
  const base = createMemoryStore(), entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  let hold = false;
  const store = { ...base, durable: true, async saveProfile(...args) {
    if (hold) { entered.resolve(); await release.promise; }
    return base.saveProfile(...args);
  } };
  const initial = accountProfile(); await store.initializeProfile(ACCOUNT, initial);
  const { h, c, entity } = await openHost(t, store);
  const before = copy(h.server.world.profiles.get(entity));
  hold = true;
  const after = completeLesson(h, c, entity);
  await entered.promise;
  assert.equal(after.progression.milestones.includes(PILOTING.milestone), true);
  assert.equal(after.progression.v, PILOTING.version, 'only the actual grant upgrades this profile to progression v2');
  assert.equal(after.progression.practice.logging, before.progression.practice.logging, 'Tala practice is unchanged');
  assert.deepEqual(after.eco.pack.goods, before.eco.pack.goods, 'the lesson grants no goods');
  assert.equal(after.gold, before.gold, 'the lesson grants no currency');
  assert.equal(after.progression.milestones.filter(id => id === PILOTING.milestone).length, 1);
  assert.equal(latestLessonSnapshot(h, c)?.learning?.persistence, 'pending');
  assert.equal((await store.loadProfile(ACCOUNT)).data.progression.v, 1,
    'a queued save is not reported as saved before its CAS confirms');

  hold = false; release.resolve(); await h.profiles.flush();
  assert.equal(latestLessonSnapshot(h, c)?.learning?.persistence, 'saved');
  const confirmed = await store.loadProfile(ACCOUNT);
  assert.deepEqual(confirmed.data.progression, after.progression);
  assert.equal(confirmed.data.gold, before.gold);
  assert.deepEqual(confirmed.data.eco.pack.goods, before.eco.pack.goods);
  assert.equal(confirmed.data.progression.practice.logging, before.progression.practice.logging);

  const rowVersion = confirmed.version;
  completeLesson(h, c, entity);
  await h.profiles.flush();
  const repeated = await store.loadProfile(ACCOUNT);
  assert.equal(repeated.version, rowVersion, 'repeating the lesson does not add another milestone or save');
  assert.deepEqual(repeated.data.progression, confirmed.data.progression);
});

test('confirmed coastal milestone survives account close and a new GameHost, and changes helm response', async t => {
  const store = durableMemoryStore();
  await store.initializeProfile(ACCOUNT, accountProfile());
  const first = await openHost(t, store);
  completeLesson(first.h, first.c, first.entity);
  await first.h.profiles.flush();
  assert.equal(latestLessonSnapshot(first.h, first.c)?.learning?.persistence, 'saved');
  await first.h.close();

  const second = await openHost(t, store);
  const learning = latestLessonSnapshot(second.h, second.c)?.learning;
  assert.deepEqual(learning, { learned: true, rank: 2, helmResponse: 1.15, persistence: 'saved' });
  const { raft, epoch } = mount(second.h, second.c, second.entity);
  assert.equal(second.h.server.world.navalPilot.snapshot(second.entity).body.helmResponse, 1.15,
    'the reattached boat receives the saved helm response');
  assert.equal(second.h.server.playerCommand(second.h.server.clients.get(second.c.id),
    { type: 'navalPilot', op: 'lessonStart', epoch }), true, 'the lesson can be repeated after reentry');
  assert.ok(raft);
});

test('unknown save response never claims saved before confirmation; reconnect trusts the canonical row', async t => {
  const base = createMemoryStore(), entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  let uncertain = false;
  const store = { ...base, durable: true, async saveProfile(...args) {
    if (uncertain) {
      entered.resolve(); await release.promise;
      await base.saveProfile(...args);
      throw new Error('injected lost save response after commit');
    }
    return base.saveProfile(...args);
  } };
  await store.initializeProfile(ACCOUNT, accountProfile());
  const first = await openHost(t, store), session = first.h.profiles.clients.get(first.c.id);
  uncertain = true;
  completeLesson(first.h, first.c, first.entity);
  await entered.promise;
  assert.equal(latestLessonSnapshot(first.h, first.c)?.learning?.persistence, 'pending');
  release.resolve();
  await waitFor(() => session.failed, 'the ambiguous profile write fences its session');
  await assert.rejects(first.h.profiles.flush(), { code: 'flush' });
  assert.equal(session.confirmed.progression.milestones.includes(PILOTING.milestone), false,
    'the session cannot claim a value whose write acknowledgement was lost');
  assert.equal((await store.loadProfile(ACCOUNT)).data.progression.milestones.includes(PILOTING.milestone), true,
    'the backing row records that the commit happened despite its lost response');

  await first.h.close().catch(error => { if (error.code !== 'flush') throw error; });
  const second = await openHost(t, store);
  assert.deepEqual(latestLessonSnapshot(second.h, second.c)?.learning,
    { learned: true, rank: 2, helmResponse: 1.15, persistence: 'saved' },
    'reentry reads the canonical row and restores the confirmed milestone');
});

test('malformed and future progression versions reject the profile without rewriting it', () => {
  const valid = accountProfile();
  for (const progression of [
    { v: 2, practice: { logging: -1 }, milestones: [PILOTING.milestone], knowledge: [] },
    { v: 3, practice: { logging: 30 }, milestones: [PILOTING.milestone], knowledge: [] },
  ]) {
    assert.equal(sanitizeProfile({ ...valid, progression }), null);
  }
  assert.deepEqual(sanitizeProfile(valid).progression, valid.progression,
    'the default v1 progression remains byte-compatible until the coastal milestone is earned');
});

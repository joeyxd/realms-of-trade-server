import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { map } from './helpers.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';
import { NAVAL_LESSON } from '../src/data/navalLesson.js';

function fixture({ clients = [1], tickAccess = null, holdMadera = 0 } = {}) {
  const sent = [];
  const server = new LocalServer({ seed: map.seed, bots: 0, enemies: false, dev: false,
    tickAccess, send(id, message) { sent.push({ id, message }); } });
  const owners = new Map();
  for (const id of clients) {
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Lesson ${id}`, skin: 0, weapon: 0 });
    owners.set(id, server.clients.get(id));
  }
  const ownerClient = owners.get(clients[0]), owner = ownerClient.entity, world = server.world;
  const raft = publicRafts(world).find((row) => row.owner === owner);
  assert.ok(raft, 'LocalServer attached the owner’s server-created raft');
  const source = world.rafts.get(raft.id), ship = source.ship;
  ship.hold.goods.madera = holdMadera;
  const helm = pilotPoint(raft, raft.helm), ecs = world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  assert.equal(server.playerCommand(ownerClient, { type: 'navalPilot', op: 'mount', shipId: raft.id }), true);
  const epoch = world.navalPilot.snapshot(owner).epoch;
  return { server, sent, owners, ownerClient, owner, raft, epoch, world, source, ship };
}

const lessonCommand = (f, op = 'lessonStart', fields = {}) =>
  f.server.playerCommand(f.ownerClient, { type: 'navalPilot', op, epoch: f.epoch, ...fields });

function tick(f, count = 1) {
  for (let i = 0; i < count; i++) assert.equal(f.server.step(), true, `fixed tick ${i + 1}/${count} commits`);
}

function mountOwner(f, client) {
  const owner = client.entity, raft = publicRafts(f.world).find((row) => row.owner === owner);
  const helm = pilotPoint(raft, raft.helm), ecs = f.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  assert.equal(f.server.playerCommand(client, { type: 'navalPilot', op: 'mount', shipId: raft.id }), true);
  return { owner, epoch: f.world.navalPilot.snapshot(owner).epoch, raft,
    ship: f.world.rafts.get(raft.id).ship };
}

// Test-only candidate relocation keeps the live LocalServer/trial plan/commit path while making
// objective positions deterministic. The no-op route commit prevents this helper from creating
// combat-route state; only NavalLesson evaluates and commits lesson progress.
function lessonPoseFixture(f, poseForTick) {
  const route = f.world.navalRoute;
  const commit = route.commit.bind(route);
  const parts = f.ship.grid.parts;
  route.plan = (owner, shipId, candidate) => {
    const pose = poseForTick(candidate.state.tick, candidate);
    if (!pose) return null;
    const body = createTrialBody(parts, { ...candidate.pose, ...pose }, 'lesson-live-test',
      candidate.state.tick, { navigation: true, cargo: candidate.cargo, flowOrigin: candidate.flowOrigin,
        wind: candidate.wind, structure: candidate.structure, activity: candidate.activity,
        parked: pose.parked });
    return { body, state: { owner } };
  };
  route.commit = (plan) => plan ? true : commit(plan);
}

function serverSnapshot(f, clientId) {
  f.sent.length = 0;
  f.server.broadcastSnapshot();
  return f.sent.find((entry) => entry.id === clientId && entry.message.t === MSG.SNAPSHOT)?.message;
}

test('lesson commands accept only the current owner epoch and reject forged payloads, guests, pause, and blocked ticks', () => {
  const f = fixture({ clients: [1, 2] }), guest = f.owners.get(2);
  const before = f.world.navalLesson.snapshot(f.owner);
  assert.equal(lessonCommand(f, 'lessonStart', { progress: 2 }), false);
  assert.equal(lessonCommand(f, 'lessonStart', { x: 10, z: 20 }), false);
  assert.equal(lessonCommand(f, 'lessonStart', { hp: 0, damage: 999 }), false);
  assert.equal(lessonCommand(f, 'lessonStart', { epoch: f.epoch + 1 }), false);
  assert.equal(f.server.playerCommand(guest, { type: 'navalPilot', op: 'lessonStart', epoch: f.epoch }), false);
  assert.deepEqual(f.world.navalLesson.snapshot(f.owner), before);

  f.ownerClient.paused = true;
  assert.equal(lessonCommand(f), false);
  f.ownerClient.paused = false;
  f.server.tickBlocked = true;
  assert.equal(lessonCommand(f), false);
  f.server.tickBlocked = false;
  assert.equal(lessonCommand(f), true);
  assert.equal(lessonCommand(f), false, 'an active session cannot be re-entered');

  const snapshot = serverSnapshot(f, 1);
  assert.equal(snapshot.lesson?.v, 1);
  assert.equal(snapshot.lesson?.status, 'outbound');
  assert.equal(snapshot.lesson?.active, true);
});

test('lesson and combat route cannot run at the same time in either start order', () => {
  const lessonFirst = fixture();
  assert.equal(lessonCommand(lessonFirst), true);
  assert.equal(lessonFirst.server.playerCommand(lessonFirst.ownerClient,
    { type: 'navalPilot', op: 'routeStart', epoch: lessonFirst.epoch }), false);

  const routeFirst = fixture();
  assert.equal(routeFirst.server.playerCommand(routeFirst.ownerClient,
    { type: 'navalPilot', op: 'routeStart', epoch: routeFirst.epoch }), true);
  assert.equal(lessonCommand(routeFirst), false);
  assert.equal(routeFirst.world.navalLesson.snapshot(routeFirst.owner).status, 'ready');
});

test('ordered lesson objectives reach returning, but completion requires an actual successful dock', () => {
  const f = fixture({ holdMadera: 4 });
  const blueprint = JSON.stringify(f.ship.grid), goods = JSON.stringify(f.ship.hold.goods);
  const run = () => f.world.navalLesson.snapshot(f.owner);
  assert.equal(lessonCommand(f), true);
  const [first, second] = run().buoys;
  lessonPoseFixture(f, (tickNo) => tickNo === 1 ? second : tickNo === 2 ? first
    : tickNo <= 2 + NAVAL_LESSON.stableTicks ? second : run().home);

  tick(f);
  assert.equal(run().status, 'outbound', 'the second buoy cannot be counted before the first');
  tick(f);
  assert.equal(run().status, 'maneuver');
  const condition = JSON.stringify(f.source.condition);
  tick(f, NAVAL_LESSON.stableTicks);
  assert.equal(run().status, 'returning');
  assert.equal(run().next, 2);
  assert.equal(f.world.navalPilot.snapshot(f.owner).active, true);
  tick(f);
  assert.equal(lessonCommand(f, 'dock'), true);
  assert.equal(run().status, 'complete');
  assert.equal(run().reason, 'dock');
  assert.equal(run().learning.learned, true);
  assert.equal(f.world.profiles.get(f.owner).progression.v, 2);
  assert.deepEqual(f.world.profiles.get(f.owner).progression.milestones, ['pilot_coastal']);
  assert.equal(JSON.stringify(f.ship.grid), blueprint);
  assert.equal(JSON.stringify(f.ship.hold.goods), goods);
  assert.equal(JSON.stringify(f.source.condition), condition, 'the noncombat lesson does not change hull HP');
});

test('docking before the lesson objectives aborts instead of granting completion', () => {
  const f = fixture();
  assert.equal(lessonCommand(f), true);
  assert.equal(lessonCommand(f, 'dock'), true, 'the real pilot accepts the physically valid home dock');
  const lesson = f.world.navalLesson.snapshot(f.owner);
  assert.equal(lesson.status, 'aborted');
  assert.equal(lesson.reason, 'dock');
  assert.equal(lesson.learning.learned, false);
});

test('walking on deck pauses practice and the current helm can still cancel after returning', () => {
  const f = fixture();
  assert.equal(lessonCommand(f), true);
  assert.equal(lessonCommand(f, 'walk'), true);
  assert.equal(f.world.navalLesson.snapshot(f.owner).canAbort, false);
  assert.equal(lessonCommand(f, 'lessonAbort'), false);
  assert.equal(lessonCommand(f, 'helm'), true);
  assert.equal(f.world.navalLesson.snapshot(f.owner).canAbort, true);
  assert.equal(lessonCommand(f, 'lessonAbort'), true);
});

test('cancel and restart create a fresh session without changing inventory, blueprint, or condition; detach clears it', () => {
  const f = fixture({ holdMadera: 4 });
  const blueprint = JSON.stringify(f.ship.grid), goods = JSON.stringify(f.ship.hold.goods);
  const condition = JSON.stringify(f.source.condition);
  assert.equal(lessonCommand(f), true);
  const firstRun = f.world.navalLesson.snapshot(f.owner).runId;
  assert.equal(lessonCommand(f, 'lessonAbort'), true);
  assert.equal(f.world.navalLesson.snapshot(f.owner).status, 'aborted');
  assert.equal(lessonCommand(f), true);
  const restarted = f.world.navalLesson.snapshot(f.owner);
  assert.notEqual(restarted.runId, firstRun);
  assert.equal(restarted.status, 'outbound');
  assert.equal(restarted.next, 0);
  assert.equal(JSON.stringify(f.ship.grid), blueprint);
  assert.equal(JSON.stringify(f.ship.hold.goods), goods);
  assert.equal(JSON.stringify(f.source.condition), condition);

  f.server.disconnect(1);
  assert.equal(f.world.navalLesson.snapshot(f.owner).runId, null, 'lesson state is session-only across detach');
});

test('a later fleet candidate failure leaves an earlier lesson plan uncommitted', () => {
  const f = fixture({ clients: [1, 2] }), secondClient = f.owners.get(2);
  const second = mountOwner(f, secondClient);
  assert.equal(lessonCommand(f), true);
  assert.equal(f.server.playerCommand(secondClient,
    { type: 'navalPilot', op: 'lessonStart', epoch: second.epoch }), true);
  const before = [f.world.navalLesson.snapshot(f.owner), f.world.navalLesson.snapshot(second.owner)];
  const lesson = f.world.navalLesson, plan = lesson.plan.bind(lesson);
  lesson.plan = (owner, ...args) => {
    const result = plan(owner, ...args);
    if (owner === second.owner) throw new TypeError('later lesson candidate failed');
    return result;
  };

  assert.throws(() => f.server.step(), /later lesson candidate failed/);
  assert.equal(f.world.tick, 0);
  assert.deepEqual(f.world.navalLesson.snapshot(f.owner), before[0]);
  assert.deepEqual(f.world.navalLesson.snapshot(second.owner), before[1]);
});

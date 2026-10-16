import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from './helpers.mjs';
import { World } from '../src/sim/world.js';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { attachRafts, installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { NavalPilot } from '../src/sim/naval/pilot.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';
import { liveHelmAnchor, pilotPoint } from '../src/sim/naval/pilotGeometry.js';

function liveFixture() {
  const w = new World(map.seed, { map, server: true, navalTrial: true });
  installInventory(w, 'live-voyage-test'); installTrade(w); installRafts(w, 'live-voyage-test');
  const owner = w.spawnPlayer({ name: 'Capitana', clientId: 41 }), profile = newProfile();
  assert.equal(prepareRaftProfile(w, profile), true);
  attachProfile(w, owner, profile); attachRafts(w, owner, profile);
  const source = [...w.rafts.values()].find((r) => r.owner === owner), ship = source.ship;
  const initialPose = { x: w.ecs.x[source.entity], y: w.ecs.y[source.entity], z: w.ecs.z[source.entity], yaw: w.ecs.facing[source.entity] };
  let body = createTrialBody(ship.grid.parts, initialPose, 'live-voyage-test:body');
  let parked = false, stopped = false;
  const sourceRev = ship.rev;
  w.navalTrial = {
    coast: null,
    step() {},
    start(e, id) { stopped = false; return e === owner && id === ship.id ? {} : null; },
    snapshot() { return stopped || ship.rev !== sourceRev ? null : { ack: 0, controlActive: false, body }; },
    input() { return true; },
    releaseControl() { return true; },
    park(_handle, value) { parked = value; return true; },
    stop() { stopped = true; return true; },
  };
  const pilot = w.navalPilot = new NavalPilot(w, { live: true });
  const raft = publicRafts(w).find((r) => r.owner === owner);
  const helmPoint = pilotPoint(raft, raft.helm);
  w.ecs.x[owner] = helmPoint.x; w.ecs.y[owner] = helmPoint.y; w.ecs.z[owner] = helmPoint.z; w.ecs.facing[owner] = helmPoint.f;
  w.raftDeck.update(publicRafts(w));
  return { w, owner, profile, source, ship, initialPose, pilot, get body() { return body; },
    setBody(value) { body = value; }, isParked: () => parked, isStopped: () => stopped };
}

function relocateBody(body, pose, speed = 0) {
  return { ...body, pose: { ...pose }, state: { ...body.state, x: pose.x, z: pose.z, yaw: pose.yaw,
    vx: speed, vz: 0, omega: 0 } };
}

test('live helm is a fixed station; pause neutralizes axes; nearby docking restores the saved raft', () => {
  const f = liveFixture(), { w, owner, ship, source, pilot } = f;
  const original = structuredClone(ship);
  const raft = publicRafts(w).find((r) => r.owner === owner), point = pilotPoint(raft, raft.helm);
  const otherDeck = raft.parts.filter((p) => p[0] === 'foundation').find((p) =>
    Math.hypot((p[1] + 0.5) * 2 - raft.helm.x, (p[2] + 0.5) * 2 - raft.helm.z) > 2.1);
  const centerX = (otherDeck[1] + 0.5) * 2, centerZ = (otherDeck[2] + 0.5) * 2;
  const localX = centerX + Math.sign(centerX - raft.helm.x) * 0.75;
  const localZ = centerZ + Math.sign(centerZ - raft.helm.z) * 0.75;
  const c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
  w.ecs.x[owner] = raft.x + c * localX + s * localZ;
  w.ecs.z[owner] = raft.z - s * localX + c * localZ;
  w.ecs.y[owner] = raft.y;
  assert.equal(pilot.mount(owner, ship.id), false, 'standing elsewhere on the deck cannot seize a remote helm');

  w.ecs.x[owner] = point.x; w.ecs.y[owner] = point.y; w.ecs.z[owner] = point.z; w.ecs.facing[owner] = point.f;
  assert.equal(pilot.mount(owner, ship.id), true);
  const state = pilot.snapshot(owner);
  assert.equal(state.active, true);
  assert.deepEqual(state.anchor, raft.helm);
  assert.equal(pilot.locked(owner), true);
  assert.equal(pilot.aboard(owner), true);
  assert.equal(pilot.voyageSnapshot(owner).phase, 'sailing');
  assert.equal(pilot.input(owner, { epoch: state.epoch, seq: 1, throttle: 1, brake: 0, steer: 0 }), true);
  assert.equal(pilot.neutral(owner), true);
  w.ecs.atkStage[owner] = 1;
  assert.equal(pilot.dock(owner, state.epoch), false, 'docking cannot cancel an active land combat action');
  w.ecs.atkStage[owner] = 0;
  assert.equal(pilot.dock(owner, state.epoch), true, 'stationary owner can dock at the captured home pose');
  assert.equal(f.isStopped(), true);
  assert.equal(pilot.voyageSnapshot(owner).active, false);
  assert.equal(pilot.locked(owner), false);
  assert.deepEqual(ship, original);
  assert.equal(w.rafts.get(ship.id), source, 'docking preserves the same server-owned source vessel');
});

test('walking away from helm blocks reacquisition until the owner returns to the fixed station', () => {
  const f = liveFixture(), { w, owner, ship, pilot } = f;
  const raft = publicRafts(w).find((r) => r.owner === owner), station = raft.helm;
  const stationPoint = pilotPoint(raft, station);
  assert.equal(pilot.mount(owner, ship.id), true);
  const epoch = pilot.snapshot(owner).epoch;
  assert.equal(pilot.walk(owner, epoch), true);

  const away = raft.parts.filter((p) => p[0] === 'foundation' && p[3] === 0).map((p) =>
    pilotPoint(raft, { x: (p[1] + 0.5) * 2, y: 0, z: (p[2] + 0.5) * 2, f: 0 }))
    .find((p) => Math.hypot(p.x - stationPoint.x, p.z - stationPoint.z) > 2.1);
  assert.ok(away, 'fixture provides a deck cell more than two metres from the helm');
  w.ecs.x[owner] = away.x; w.ecs.y[owner] = away.y; w.ecs.z[owner] = away.z;
  assert.equal(pilot.helm(owner, epoch), false, 'a walker cannot reclaim the helm remotely');

  w.ecs.x[owner] = stationPoint.x; w.ecs.y[owner] = stationPoint.y; w.ecs.z[owner] = stationPoint.z;
  assert.equal(pilot.helm(owner, epoch), true, 'returning to the physical helm permits control');
  assert.deepEqual(pilot.snapshot(owner).anchor, station, 'resumed helm uses its fixed anchor');
});

test('coastal landing keeps the boat live while ashore, then reboards and returns without changing profile custody', () => {
  const f = liveFixture(), { w, owner, pilot, ship, profile, initialPose } = f;
  const originalShip = structuredClone(ship), originalProfile = structuredClone(profile);
  const raft = publicRafts(w).find((r) => r.owner === owner), station = pilotPoint(raft, raft.helm);
  assert.equal(pilot.mount(owner, ship.id), true);
  const mounted = pilot.snapshot(owner);

  // Model an admitted voyage step 30 m from home, then settle the hull for a shore stop.
  const away = { ...initialPose, x: initialPose.x + 30 };
  f.setBody(relocateBody(f.body, away));
  pilot.prepare(); pilot.sync(); pilot.prepare();
  assert.equal(pilot.voyageSnapshot(owner).visited, true);

  // A small dry shoreline immediately beside the real hull gives the landing search a deterministic coast.
  const shore = pilotPoint(away, { x: 5, y: 0, z: 2, f: 0 });
  w.map.groundAt = (x, z) => Math.hypot(x - shore.x, z - shore.z) <= 1.2 ? 0.6 : -2;
  w.map.onDock = () => false;
  w.map.colliders = [];
  w.map.queryColliders = () => [];
  w.tick += 6; // the test swaps in a coast fixture after the prior no-shore query
  const ready = pilot.voyageSnapshot(owner);
  assert.equal(ready.canLand, true);
  assert.ok(ready.landing && w.map.groundAt(ready.landing.x, ready.landing.z) >= 0.2);
  assert.equal(pilot.land(owner, mounted.epoch), true);
  assert.equal(f.isParked(), true);
  assert.equal(pilot.has(owner), false);
  assert.equal(pilot.aboard(owner), false, 'normal land locomotion resumes ashore');
  assert.equal(pilot.locked(owner), true, 'cargo and blueprint stay locked for the entire voyage');
  assert.equal(pilot.snapshot(owner).active, false);
  assert.equal(pilot.voyageSnapshot(owner).phase, 'shore');
  assert.equal(pilot.recall(owner), false, 'safety recovery cannot teleport from a remote coast');
  assert.equal(pilot.walk(owner, pilot.snapshot(owner).epoch), false);
  assert.equal(pilot.land(owner, mounted.epoch), false, 'the departed helm epoch cannot be replayed ashore');
  const landing = pilot.voyageSnapshot(owner).landing;
  w.ecs.x[owner] = landing.x + 12;
  assert.equal(pilot.reboard(owner, ship.id), false, 'the coast-to-hull range is enforced');
  w.ecs.x[owner] = landing.x; w.ecs.y[owner] = landing.y; w.ecs.z[owner] = landing.z;
  w.ecs.dashT[owner] = 0;
  assert.equal(pilot.reboard(owner, ship.id), false, 'reboarding cannot cancel an active dash');
  w.ecs.dashT[owner] = -1;
  const parkedPose = { ...pilot.voyageSnapshot(owner).target };
  w.stepWorld();
  assert.equal(pilot.voyageSnapshot(owner).phase, 'shore');
  assert.equal(f.isParked(), true);
  assert.deepEqual(pilot.voyageSnapshot(owner).target, parkedPose, 'World ticks do not move the parked vessel');

  assert.equal(pilot.reboard(owner, ship.id), true);
  assert.equal(f.isParked(), false);
  assert.equal(pilot.aboard(owner), true);
  assert.equal(pilot.snapshot(owner).active, true);
  assert.notEqual(pilot.snapshot(owner).epoch, mounted.epoch, 'reboarding issues a fresh authority epoch');
  assert.equal(pilot.input(owner, { epoch: mounted.epoch, seq: 9, throttle: 1, brake: 0, steer: 0 }), false,
    'the pre-shore epoch cannot regain the helm');

  f.setBody(relocateBody(f.body, initialPose));
  pilot.prepare(); pilot.sync();
  const returning = pilot.snapshot(owner);
  assert.equal(pilot.dock(owner, returning.epoch), true);
  assert.equal(f.isStopped(), true);
  assert.deepEqual(ship, originalShip);
  assert.deepEqual(profile, originalProfile);
});

test('a full deck has no fixed helm station to seize', () => {
  const f = liveFixture(), { w, owner, ship, pilot } = f;
  const occupied = [...ship.grid.parts, ['sail', 1, 0, 0], ['sail', 0, 1, 0]];
  assert.equal(liveHelmAnchor(occupied), null);
  const source = w.rafts.get(ship.id), raft = publicRafts(w).find((r) => r.owner === owner);
  const point = pilotPoint(raft, raft.helm);
  w.ecs.x[owner] = point.x; w.ecs.y[owner] = point.y; w.ecs.z[owner] = point.z; w.ecs.facing[owner] = point.f;
  source.ship.grid.parts = occupied;
  f.setBody(createTrialBody(occupied, f.initialPose, 'live-voyage-test:full-deck'));
  assert.equal(pilot.mount(owner, ship.id), false, 'a vessel with no unoccupied helm foundation cannot launch');
});

test('death or source invalidation ashore ends only the transient voyage and never revives the owner', () => {
  for (const invalidation of ['death', 'source']) {
    const f = liveFixture(), { w, owner, ship, pilot } = f;
    const raft = publicRafts(w).find((r) => r.owner === owner), point = pilotPoint(raft, raft.helm);
    w.ecs.x[owner] = point.x; w.ecs.y[owner] = point.y; w.ecs.z[owner] = point.z; w.ecs.facing[owner] = point.f;
    assert.equal(pilot.mount(owner, ship.id), true);
    const active = pilot.snapshot(owner);
    const away = { ...f.initialPose, x: f.initialPose.x + 30 };
    f.setBody(relocateBody(f.body, away)); pilot.prepare(); pilot.sync(); pilot.prepare();
    const shore = pilotPoint(away, { x: 5, y: 0, z: 2, f: 0 });
    w.map.groundAt = (x, z) => Math.hypot(x - shore.x, z - shore.z) <= 1.2 ? 0.6 : -2;
    w.map.onDock = () => false; w.map.colliders = []; w.map.queryColliders = () => [];
    assert.equal(pilot.land(owner, active.epoch), true);
    if (invalidation === 'death') w.ecs.hp[owner] = 0;
    else ship.rev++;
    pilot.prepare();
    assert.equal(pilot.voyageSnapshot(owner).active, false);
    assert.equal(pilot.locked(owner), false);
    if (invalidation === 'death') assert.equal(w.ecs.hp[owner], 0, 'cleanup never revives the player');
    else assert.ok(w.ecs.hp[owner] > 0, 'invalid source releases the living owner without changing health');
    assert.equal(f.isStopped(), true);
  }
});

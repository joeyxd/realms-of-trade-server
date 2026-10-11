import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { map } from './helpers.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';
import { NAVAL_ROUTE as R } from '../src/data/navalRoute.js';
import { RAFT_PARTS } from '../src/data/raftparts.js';

function fixture({ clients = [1], tickAccess = null, holdMadera = 0 } = {}) {
  const sent = [];
  const server = new LocalServer({ seed: map.seed, bots: 0, enemies: false, dev: false,
    tickAccess, send(id, message) { sent.push({ id, message }); } });
  const owners = new Map();
  for (const id of clients) {
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Route ${id}`, skin: 0, weapon: 0 });
    owners.set(id, server.clients.get(id));
  }
  const ownerClient = owners.get(clients[0]), owner = ownerClient.entity, world = server.world;
  const raft = publicRafts(world).find((row) => row.owner === owner);
  assert.ok(raft, 'LocalServer attached the owner’s server-created raft');
  const source = world.rafts.get(raft.id), ship = source.ship;
  ship.hold.goods.madera = holdMadera;
  const point = pilotPoint(raft, raft.helm), ecs = world.ecs;
  ecs.x[owner] = point.x; ecs.y[owner] = point.y; ecs.z[owner] = point.z; ecs.facing[owner] = point.f;
  assert.equal(server.playerCommand(ownerClient, { type: 'navalPilot', op: 'mount', shipId: raft.id }), true,
    'owner mounts at the real helm through LocalServer');
  const epoch = world.navalPilot.snapshot(owner).epoch;
  return { server, sent, owners, ownerClient, owner, raft, epoch, world, source, ship };
}

function start(f, fields = {}) {
  return f.server.playerCommand(f.ownerClient, { type: 'navalPilot', op: 'routeStart', epoch: f.epoch, ...fields });
}

function routePoseFixture(f, poseForTick) {
  const route = f.world.navalRoute, original = route.plan.bind(route), sourceParts = f.ship.grid.parts;
  const surface = f.world.raftDeck.surface.bind(f.world.raftDeck);
  f.world.raftDeck.surface = (x, z, y) => {
    const pilot = f.world.navalPilot.snapshot(f.owner);
    if (pilot.active) {
      const helm = pilotPoint({ ...pilot.body.pose, yaw: pilot.body.pose.yaw }, pilot.anchor);
      if (Math.hypot(x - helm.x, z - helm.z, (y ?? helm.y) - helm.y) < 0.06)
        return { id: f.raft.id, kind: 'deck', y: helm.y };
    }
    return surface(x, z, y);
  };
  route.plan = (owner, shipId, candidate) => {
    const position = poseForTick(candidate.state.tick, candidate);
    if (!position) return original(owner, shipId, candidate);
    // Test-only positioning uses the actual blueprint, condition, cargo, navigation flow, and candidate tick.
    // It bypasses motion placement so route progression/combat assertions remain deterministic. The matching
    // helm surface shim keeps only this test captain supported after the artificial body placement.
    const body = createTrialBody(sourceParts, { ...candidate.pose, ...position }, 'route-test-body',
      candidate.state.tick, { navigation: true, cargo: candidate.cargo, flowOrigin: candidate.flowOrigin,
        wind: candidate.wind, structure: candidate.structure, activity: candidate.activity, parked: position.parked });
    return original(owner, shipId, body);
  };
}

function tick(f, n = 1) {
  for (let i = 0; i < n; i++) assert.equal(f.server.step(), true, `LocalServer fixed tick ${i + 1}/${n} commits`);
}

function placeGuestOnDeck(f, guest) {
  const raft = publicRafts(f.world).find((row) => row.id === f.raft.id), ecs = f.world.ecs;
  f.world.raftDeck.update(publicRafts(f.world));
  for (let x = raft.x - 24; x <= raft.x + 24; x += 0.5) for (let z = raft.z - 24; z <= raft.z + 24; z += 0.5) {
    for (let y = raft.y - 1; y <= raft.y + 8; y += 0.5) {
      const surface = f.world.raftDeck.surface(x, z, y);
      if (surface?.id === f.raft.id && surface.kind === 'deck') {
        ecs.x[guest] = x; ecs.y[guest] = surface.y; ecs.z[guest] = z;
        ecs.vx[guest] = ecs.vz[guest] = 0;
        return true;
      }
    }
  }
  return false;
}

test('route start is opt-in for the live owner helm and fences epochs and forged fields at LocalServer', () => {
  const f = fixture({ clients: [1, 2] }), guest = f.owners.get(2), stranger = guest.entity;
  const before = f.world.navalRoute.snapshot(f.owner);
  assert.equal(before.available, true);
  assert.equal(before.canStart, true);
  assert.equal(start(f, { progress: 3, hp: 0 }), false, 'route command rejects client-authored route/HP fields');
  assert.equal(start(f, { epoch: f.epoch + 1 }), false, 'stale helm epoch cannot start');
  assert.equal(start(f), true);
  assert.equal(start(f), false, 'owner cannot start a second active circuit');
  assert.equal(f.world.navalRoute.snapshot(f.owner).next, 0);
  assert.equal(f.world.navalRoute.start(stranger, f.epoch), false, 'unmounted guest has no route authority');
  assert.equal(f.world.navalRoute.start(f.owner, f.epoch + 1), false);
  const route = f.world.navalRoute.snapshot(f.owner);
  assert.equal(route.status, 'outbound');
  assert.equal(route.next, 0);
  assert.equal(route.target.id, 'buoy:1');
});

test('start eligibility matches the four-run authority cap and abort records its committed tick', () => {
  const f = fixture({ clients: [1, 2, 3, 4, 5] });
  const owners = [...f.owners.values()];
  const epochs = new Map([[f.owner, f.epoch]]);
  for (const client of owners.slice(1)) {
    const owner = client.entity, raft = publicRafts(f.world).find((row) => row.owner === owner);
    assert.ok(raft, `server created a raft for owner ${owner}`);
    if (owner === owners[R.maxRuns].entity) {
      epochs.set(owner, f.world.navalPilot.snapshot(owner).epoch);
      continue;
    }
    const helm = pilotPoint(raft, raft.helm), ecs = f.world.ecs;
    ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
    assert.equal(f.server.playerCommand(client, { type: 'navalPilot', op: 'mount', shipId: raft.id }), true);
    epochs.set(owner, f.world.navalPilot.snapshot(owner).epoch);
  }

  for (const client of owners.slice(0, R.maxRuns)) {
    const owner = client.entity;
    assert.equal(f.world.navalRoute.snapshot(owner).canStart, true);
    assert.equal(f.server.playerCommand(client, { type: 'navalPilot', op: 'routeStart', epoch: epochs.get(owner) }), true);
  }
  const fifth = owners[R.maxRuns], fifthOwner = fifth.entity, fifthEpoch = epochs.get(fifthOwner);
  const fifthRaft = publicRafts(f.world).find((row) => row.owner === fifthOwner);
  assert.ok(fifthRaft, 'the fifth connected owner has a server-created raft');
  // NavalPilot itself admits at most four mounted captains, so provide only this fifth route
  // candidate context to exercise NavalRoute's separate four-active-run gate. The route commands
  // still pass through LocalServer; the four runs above use actual mounted owners and boats.
  const routeContext = f.world.navalPilot.routeContext.bind(f.world.navalPilot);
  const mountedContext = routeContext(f.owner);
  f.world.navalPilot.routeContext = (owner) => owner === fifthOwner
    ? { ...mountedContext, shipId: fifthRaft.id, epoch: fifthEpoch }
    : routeContext(owner);
  assert.equal(f.world.navalRoute.snapshot(fifthOwner).canStart, false);
  assert.equal(f.server.playerCommand(fifth, { type: 'navalPilot', op: 'routeStart', epoch: fifthEpoch }), false);

  tick(f, 3);
  const firstOwner = owners[0].entity;
  assert.equal(f.server.playerCommand(owners[0], { type: 'navalPilot', op: 'routeAbort', epoch: epochs.get(firstOwner) }), true);
  const aborted = f.world.navalRoute.snapshot(firstOwner);
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.tick, f.world.tick);
  assert.equal(aborted.elapsedTicks, f.world.tick - 0);
  assert.equal(aborted.elapsedTicks, 3);

  assert.equal(f.world.navalRoute.snapshot(fifthOwner).canStart, true);
  assert.equal(f.server.playerCommand(fifth, { type: 'navalPilot', op: 'routeStart', epoch: fifthEpoch }), true);
});

test('a permitted deck guest can observe route guidance but cannot abort the owner’s route', () => {
  const f = fixture({ clients: [1, 2] }), guest = f.owners.get(2).entity;
  assert.equal(start(f), true);
  assert.equal(placeGuestOnDeck(f, guest), true, 'fixture places the guest on a real public deck tile');
  assert.equal(f.world.navalPilot.invite(f.owner, f.raft.id, guest), true);
  assert.equal(f.world.navalPilot.board(guest, f.raft.id), true);
  const publicRoute = f.world.navalRoute.snapshot(guest);
  assert.equal(publicRoute.active, true);
  assert.equal(publicRoute.status, 'outbound');
  assert.equal(publicRoute.canAbort, false, 'a passenger cannot cancel the owner’s run');
  assert.equal(f.world.navalRoute.abort(guest, f.epoch), false);
  f.sent.length = 0;
  f.server.broadcastSnapshot();
  const guestSnapshot = f.sent.filter((entry) => entry.id === 2 && entry.message.t === MSG.SNAPSHOT).at(-1)?.message;
  assert.equal(guestSnapshot?.route?.runId, publicRoute.runId, 'the authorized ship passenger receives public route guidance');
});

test('only the ordered three server buoys and a returning dock complete the circuit', () => {
  const f = fixture();
  assert.equal(start(f), true);
  const buoys = f.world.navalRoute.snapshot(f.owner).buoys;
  assert.equal(buoys.length, 3);
  routePoseFixture(f, (tickNo) => {
    if (tickNo === 1) return buoys[1]; // Skipping buoy 1 cannot advance progress.
    if (tickNo === 2) return buoys[0];
    if (tickNo === 3) return buoys[2]; // Skipping buoy 2 cannot advance progress.
    if (tickNo === 4) return buoys[1];
    if (tickNo === 5) return buoys[2];
    return null;
  });
  tick(f, 1); assert.equal(f.world.navalRoute.snapshot(f.owner).next, 0);
  tick(f, 1); assert.equal(f.world.navalRoute.snapshot(f.owner).next, 1);
  tick(f, 1); assert.equal(f.world.navalRoute.snapshot(f.owner).next, 1);
  tick(f, 1); assert.equal(f.world.navalRoute.snapshot(f.owner).next, 2);
  tick(f, 1);
  assert.equal(f.world.navalRoute.snapshot(f.owner).status, 'returning');
  assert.equal(f.world.navalPilot.dock(f.owner, f.epoch), false, 'cannot dock while physically away from home');
  routePoseFixture(f, () => ({ ...f.world.navalRoute.snapshot(f.owner).home, yaw: f.world.navalPilot.snapshot(f.owner).body.pose.yaw }));
  tick(f);
  assert.equal(f.server.playerCommand(f.ownerClient, { type: 'navalPilot', op: 'dock', epoch: f.epoch }), true);
  assert.equal(f.world.navalRoute.snapshot(f.owner).status, 'complete');
});

test('early dock, explicit abort, and shore each terminate an active route with the matching outcome', () => {
  const early = fixture();
  assert.equal(start(early), true);
  assert.equal(early.server.playerCommand(early.ownerClient, { type: 'navalPilot', op: 'dock', epoch: early.epoch }), true);
  assert.equal(early.world.navalRoute.snapshot(early.owner).status, 'aborted');
  assert.equal(early.world.navalRoute.snapshot(early.owner).reason, 'dock');

  const cancelled = fixture();
  assert.equal(start(cancelled), true);
  assert.equal(cancelled.server.playerCommand(cancelled.ownerClient,
    { type: 'navalPilot', op: 'routeAbort', epoch: cancelled.epoch }), true);
  assert.equal(cancelled.world.navalRoute.snapshot(cancelled.owner).status, 'aborted');
  assert.equal(cancelled.world.navalRoute.snapshot(cancelled.owner).reason, 'cancelled');

  const shore = fixture();
  assert.equal(start(shore), true);
  const target = shore.world.navalRoute.snapshot(shore.owner).buoys[0];
  routePoseFixture(shore, () => ({ ...target, parked: true }));
  tick(shore);
  assert.equal(shore.world.navalRoute.snapshot(shore.owner).status, 'aborted');
  assert.equal(shore.world.navalRoute.snapshot(shore.owner).reason, 'shore');
});

test('corsair publishes 120 tick warnings at a fixed mark, then a rotated hull can be hit and evade by moving', () => {
  const f = fixture();
  assert.equal(start(f), true);
  const threat = f.world.navalRoute.snapshot(f.owner).threat;
  routePoseFixture(f, (tickNo) => tickNo < R.firstSalvoTicks ? null :
    { x: threat.x, z: threat.z, yaw: Math.PI / 2 });
  tick(f, R.firstSalvoTicks);
  const warned = f.world.navalRoute.snapshot(f.owner);
  assert.equal(warned.shots.length, 1);
  const mark = { x: warned.shots[0].x, z: warned.shots[0].z };
  const home = { ...warned.home }, muzzle = { ...warned.shots[0].from };
  assert.equal(warned.shots[0].impactTick - warned.shots[0].t0, R.warningTicks);
  warned.home.x = 1e6; warned.home.z = -1e6;
  warned.shots[0].x = 1e6; warned.shots[0].z = -1e6;
  warned.shots[0].from.x = 1e6; warned.shots[0].from.z = -1e6;
  const unchanged = f.world.navalRoute.snapshot(f.owner);
  assert.deepEqual(unchanged.home, home, 'snapshot home is detached from authoritative route state');
  assert.deepEqual({ x: unchanged.shots[0].x, z: unchanged.shots[0].z }, mark,
    'mutating a returned shot mark cannot redirect its pending impact');
  assert.deepEqual(unchanged.shots[0].from, muzzle, 'snapshot muzzle data is detached too');
  tick(f, R.warningTicks);
  const hit = f.world.navalRoute.snapshot(f.owner);
  assert.equal(hit.hits, 1, 'the 90-degree rotated real raft footprint catches the fixed landing splash');
  assert.equal(hit.damage, R.shotDamage);
  const impact = f.sent.map((entry) => entry.message.ev).find((event) => event?.type === 'navalImpact' && event.source === 'corsair');
  assert.ok(impact, `confirmed corsair damage is emitted as a server impact (${f.sent.map((entry) => entry.message.ev?.type || entry.message.t).filter(Boolean).join(',')})`);
  assert.ok(Math.hypot(impact.x - mark.x, impact.z - mark.z) < 1e-8);

  const dodge = fixture();
  assert.equal(start(dodge), true);
  const dodgeThreat = dodge.world.navalRoute.snapshot(dodge.owner).threat;
  routePoseFixture(dodge, (tickNo) => tickNo < R.firstSalvoTicks ? null :
    tickNo < R.firstSalvoTicks + 5 ? { x: dodgeThreat.x, z: dodgeThreat.z } : { x: dodgeThreat.x + 12, z: dodgeThreat.z + 12 });
  tick(dodge, R.firstSalvoTicks);
  const aimed = dodge.world.navalRoute.snapshot(dodge.owner).shots[0];
  tick(dodge, R.warningTicks);
  const dodged = dodge.world.navalRoute.snapshot(dodge.owner);
  assert.equal(dodged.dodged, 1, 'impact resolves at the saved mark, not the vessel’s later position');
  assert.equal(dodged.hits, 0);
  assert.equal(dodged.damage, 0);
  assert.equal(dodged.shots.some((shot) => shot.id === aimed.id), false);
});

test('route damage is fixed at 6 HP, capped at 24 and 50 percent per part, and conserves cargo/economy/blueprint', () => {
  const f = fixture({ holdMadera: 3 });
  const shipRev = f.ship.rev, blueprint = JSON.stringify(f.ship.grid), goods = JSON.stringify(f.ship.hold.goods);
  const pack = JSON.stringify(f.world.profiles.get(f.owner).eco.pack.goods);
  const signedProfile = structuredClone(f.world.profiles.get(f.owner));
  const signedShip = signedProfile.eco.ships.find((ship) => ship.id === f.ship.id);
  delete signedShip.condition; delete signedShip.voyage;
  assert.equal(start(f), true);
  const threat = f.world.navalRoute.snapshot(f.owner).threat;
  routePoseFixture(f, (tickNo) => tickNo < R.firstSalvoTicks ? null : { x: threat.x, z: threat.z, yaw: Math.PI / 2 });
  tick(f, R.firstSalvoTicks + 4 * R.salvoTicks + R.warningTicks + 2);
  const state = f.world.navalRoute.snapshot(f.owner), condition = f.ship.condition;
  assert.equal(state.hits, 5, 'the fifth stopped hit still resolves after the 24 HP damage budget is spent');
  assert.equal(state.damage, R.damageBudget);
  assert.ok(state.damage <= 24);
  assert.ok(condition?.entries?.length, 'real source condition was persisted from the trial body');
  assert.ok(condition.entries.every((row) => row.at(-1) >= 0));
  assert.equal(f.ship.rev, shipRev);
  assert.equal(JSON.stringify(f.ship.grid), blueprint);
  assert.equal(JSON.stringify(f.ship.hold.goods), goods);
  assert.equal(JSON.stringify(f.world.profiles.get(f.owner).eco.pack.goods), pack);
  const afterProfile = structuredClone(f.world.profiles.get(f.owner));
  const afterShip = afterProfile.eco.ships.find((ship) => ship.id === f.ship.id);
  delete afterShip.condition; delete afterShip.voyage;
  assert.deepEqual(afterProfile, signedProfile, 'route damage does not edit signed currency, goods, revisions, or blueprint');
  assert.ok(f.ship.condition.entries.every((row) => row.at(-1) >= RAFT_PARTS[row[1]]?.hp * 0.5 - 1e-8),
    'no damaged condition entry falls below half its initial HP');
});

test('client snapshots cannot edit HP, a blocked fixed tick preserves warning and damage state, and non-live contexts cannot start', () => {
  let allowed = true;
  const f = fixture({ tickAccess: () => allowed });
  assert.equal(start(f), true);
  const threat = f.world.navalRoute.snapshot(f.owner).threat;
  routePoseFixture(f, (tickNo) => tickNo < R.firstSalvoTicks ? null : { x: threat.x, z: threat.z, yaw: Math.PI / 2 });
  tick(f, R.firstSalvoTicks);
  const before = f.world.navalRoute.snapshot(f.owner), body = f.world.navalPilot.snapshot(f.owner).body;
  const condition = JSON.stringify(f.source.condition);
  f.server.receive(1, { t: MSG.SNAPSHOT, tick: 999, route: { hp: 0, progress: 3 }, naval: { hp: 0 } });
  f.server.playerCommand(f.ownerClient, { type: 'navalPilot', op: 'routeStart', epoch: f.epoch, hp: 0, damage: 999 });
  assert.deepEqual(f.world.navalRoute.snapshot(f.owner), before);
  allowed = false;
  assert.equal(f.server.step(), false);
  assert.equal(f.world.tick, before.tick);
  assert.equal(f.world.navalPilot.snapshot(f.owner).body, body);
  assert.deepEqual(f.world.navalRoute.snapshot(f.owner), before);
  assert.equal(JSON.stringify(f.source.condition), condition);

  const guest = f.owners.get(2)?.entity;
  assert.equal(f.world.navalPilot.routeContext(guest), null);
  assert.equal(f.world.navalRoute.start(guest, f.epoch), false);
  const bot = f.world.spawnPlayer({ name: 'No es capitán', bot: true });
  assert.equal(f.world.navalRoute.start(bot, f.epoch), false);
  const disabled = new LocalServer({ seed: map.seed, bots: 0, enemies: false, navigation: false, send() {} });
  assert.equal(disabled.world.navalRoute, undefined, 'offline/non-live LocalServer context does not install route authority');
});

test('a failed later route candidate does not commit earlier route plans or consume the fixed tick', () => {
  const f = fixture({ clients: [1, 2] });
  assert.equal(start(f), true);
  const route = f.world.navalRoute, original = route.plan.bind(route), firstOwner = f.owner;
  route.plan = (owner, shipId, body) => {
    const result = original(owner, shipId, body);
    if (owner === firstOwner) return result;
    throw new TypeError('test candidate failure after the first pure route plan');
  };
  // Start the second live helm through the same public setup used for the first owner.
  const secondClient = f.owners.get(2), secondOwner = secondClient.entity;
  const secondRaft = publicRafts(f.world).find((row) => row.owner === secondOwner);
  const helm = pilotPoint(secondRaft, secondRaft.helm), ecs = f.world.ecs;
  ecs.x[secondOwner] = helm.x; ecs.y[secondOwner] = helm.y; ecs.z[secondOwner] = helm.z; ecs.facing[secondOwner] = helm.f;
  assert.equal(f.server.playerCommand(secondClient, { type: 'navalPilot', op: 'mount', shipId: secondRaft.id }), true);
  const secondEpoch = f.world.navalPilot.snapshot(secondOwner).epoch;
  assert.equal(f.server.playerCommand(secondClient, { type: 'navalPilot', op: 'routeStart', epoch: secondEpoch }), true);
  const firstBefore = f.world.navalRoute.snapshot(firstOwner), secondBefore = f.world.navalRoute.snapshot(secondOwner);
  assert.throws(() => f.server.step(), /test candidate failure/);
  assert.equal(f.world.tick, 0, 'failed fleet preparation does not consume the World fixed tick');
  assert.deepEqual(f.world.navalRoute.snapshot(firstOwner), firstBefore);
  assert.deepEqual(f.world.navalRoute.snapshot(secondOwner), secondBefore);
});

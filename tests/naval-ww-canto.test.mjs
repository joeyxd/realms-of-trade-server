import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVAL_CANTO } from '../src/data/navalCanto.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { WW_SPEED } from '../src/data/navalHandling.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { createTrialBody, stepTrialBody, parkTrialBody, damageTrialBody,
  setTrialCargo, refreshTrialPayload } from '../src/sim/naval/trialBody.js';
import { cantoHud } from '../src/ui/navalHudState.js';
import { NavalPilotPrediction } from '../src/client/navalPilotPrediction.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';

const wind = NAVAL_TRIAL.wind, sail = { throttle: 1, brake: 0, steer: 0 };
const make = (tick = 0, options = {}) => createTrialBody(STARTER_RAFT,
  { x: 0, y: 0.72, z: 0, yaw: Math.PI }, 'canto-test', tick,
  { navigation: true, flowOrigin: { x: 0, z: 0, yaw: 0 }, wind, ...options });
const step = (body, input = sail, worldWind = wind) => stepTrialBody(body, input, worldWind);
const forward = (body) => body.state.vx * Math.sin(body.state.yaw) + body.state.vz * Math.cos(body.state.yaw);

test('Canto locks the press heading for 3600 ticks and preserves world strength', () => {
  const before = make(37), body = step(before, { ...sail, canto: 1 });
  assert.deepEqual(NAVAL_CANTO, { durationTicks: 3600, cooldownTicks: 3600 });
  assert.ok(Object.isFrozen(NAVAL_CANTO) && Object.isFrozen(body.canto));
  assert.deepEqual(body.canto, { yaw: before.state.yaw, until: 3637, readyAt: 7237, latch: 1 });
  assert.deepEqual(body.wind, { yaw: Math.PI, strength: wind.strength });
  assert.deepEqual(before.canto, { yaw: 0, until: 0, readyAt: 0, latch: 0 });
  const turned = { ...body, state: { ...body.state, yaw: 1 } };
  assert.deepEqual(step(turned, sail, { yaw: 0.5, strength: 0.3 }).wind, { yaw: Math.PI, strength: 0.3 });
});

test('held input fires once, cooldown rejects edges, and ready needs a new press', () => {
  let body = step(make(), { ...sail, canto: 1 });
  const first = body.canto.until;
  for (let i = 0; i < 4; i++) body = step(body, { ...sail, canto: 1 });
  assert.equal(body.canto.until, first);
  body = step(body, { ...sail, canto: 0 });
  body = step(body, { ...sail, canto: 1 });
  assert.equal(body.canto.until, first);
  // Tick is the authoritative clock; holding across its boundary must not retrigger.
  body = { ...body, state: { ...body.state, tick: body.canto.readyAt } };
  body = step(body, { ...sail, canto: 1 });
  assert.equal(body.canto.until, first);
  body = step(body, { ...sail, canto: 0 });
  const tick = body.state.tick;
  body = step(body, { ...sail, canto: 1 });
  assert.equal(body.canto.until, tick + 3600);
  assert.equal(body.canto.readyAt, tick + 7200);
});

test('world wind returns at the expiry step after 3600 ticks', () => {
  let body = step(make(), { ...sail, canto: 1 });
  for (let i = 0; i < 3599; i++) body = step(body);
  assert.equal(body.state.tick, 3600);
  assert.equal(body.wind.yaw, Math.PI, 'last completed step started at tick 3599');
  body = step(body);
  assert.deepEqual(body.wind, wind, 'the step starting at until uses the world wind');
});

test('parked and disabled bodies cannot fire; invalid sailing canto throws', () => {
  const body = parkTrialBody(make(), true);
  const ignored = step(body, { ...sail, canto: 1 });
  assert.equal(ignored.canto.until, 0);
  assert.equal(ignored.canto.latch, 1);
  assert.throws(() => step(body, { ...sail, canto: 2 }), { name: 'TypeError', message: 'Invalid sailing input' });
  let disabled = make();
  for (const part of disabled.structure.entries)
    disabled = damageTrialBody(disabled, part.id, part.maxHp).body;
  assert.ok(disabled.operational.disabled);
  assert.equal(step(disabled, { ...sail, canto: 1 }).canto.until, 0);
});

test('lab bodies omit canto and ignore the input; navigation canto is required and validated', () => {
  const lab = createTrialBody(STARTER_RAFT, { x: 0, y: 0.72, z: 0, yaw: Math.PI }, 'lab');
  assert.ok(!Object.hasOwn(lab, 'canto'));
  assert.deepEqual(step(lab, { ...sail, canto: 1 }), step(lab));
  assert.throws(() => step({ ...lab, canto: make().canto }), TypeError);
  assert.throws(() => step({ ...make(), canto: undefined }), TypeError);
  assert.throws(() => make(0, { navigation: false, canto: {} }), TypeError);
  for (const change of [{ yaw: NaN }, { until: -1 }, { readyAt: 1.5 }, { latch: 2 }])
    assert.throws(() => make(0, { canto: { ...make().canto, ...change } }), TypeError);
});

test('Canto survives park, cargo refresh, payload rebase and damage', () => {
  const active = step(make(), { ...sail, canto: 1 }), parked = parkTrialBody(active, true);
  const cargo = setTrialCargo(parked, [{ mass: 1, x: 0, z: 0, height: 0 }]);
  const payload = refreshTrialPayload(parkTrialBody(cargo, false), []);
  const damaged = damageTrialBody(payload, payload.structure.entries[0].id, 1).body;
  for (const body of [parked, cargo, payload, damaged]) assert.deepEqual(body.canto, active.canto);
});

test('cantoHud reports off, ready, active and cooling in whole seconds', () => {
  assert.deepEqual(cantoHud(null, 0), { phase: 'off', remaining: 0 });
  assert.deepEqual(cantoHud(undefined, 0), { phase: 'off', remaining: 0 });
  assert.deepEqual(cantoHud(make().canto, 0), { phase: 'ready', remaining: 0 });
  const canto = { yaw: 1, until: 3600, readyAt: 7200, latch: 0 };
  assert.deepEqual(cantoHud(canto, 1), { phase: 'active', remaining: 60 });
  assert.deepEqual(cantoHud(canto, 3599), { phase: 'active', remaining: 1 });
  assert.deepEqual(cantoHud(canto, 3600), { phase: 'cooling', remaining: 60 });
  assert.deepEqual(cantoHud(canto, 7199), { phase: 'cooling', remaining: 1 });
  assert.deepEqual(cantoHud(canto, 7200), { phase: 'ready', remaining: 0 });
});

test('Canto unlocks the WW jump when sailing straight into the trial wind', () => {
  let headwind = make();
  for (let i = 0; i < 600; i++) headwind = step(headwind);
  assert.ok(forward(headwind) <= 16.5 * WW_SPEED);
  assert.equal(step(headwind, { ...sail, jump: 1 }).state.fly, 0);
  let song = step(headwind, { ...sail, canto: 1 });
  for (let i = 0; i < 600; i++) song = step(song);
  assert.ok(forward(song) > 16.5 * WW_SPEED, String(forward(song) / WW_SPEED));
  assert.equal(step(song, { ...sail, jump: 1 }).state.fly, 1);
});

test('prediction forwards canto and replays it from an authoritative world wind', () => {
  const prediction = new NavalPilotPrediction(), body = make();
  const snap = { active: true, epoch: 1, ack: 0, body, anchor: { x: 0, y: 0, z: 0, f: 0 }, shipId: 'raft', wind };
  assert.ok(prediction.receive(snap));
  assert.equal(prediction.step({ ...sail, canto: 2 }), null);
  assert.equal(prediction.step({ ...sail, canto: 1 }).canto, 1);
  assert.deepEqual(prediction.body, step(body, { ...sail, canto: 1 }));
  const advanced = step(body);
  assert.ok(prediction.receive({ ...snap, body: advanced }));
  assert.equal(prediction.body.canto.until, advanced.state.tick + 3600);
});

test('live SHIP_INPUT reaches the sim and an observer receives only an active marker', () => {
  const messages = new Map(), server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send(id, msg) { const list = messages.get(id) || []; list.push(structuredClone(msg)); messages.set(id, list); } });
  const clients = [], publish = () => {
    server.broadcastSnapshot();
    for (const { id, callbacks } of clients) {
      for (const msg of messages.get(id) || []) for (const cb of msg.t === MSG.SNAPSHOT ? callbacks.snap : callbacks.other) cb(msg);
      messages.set(id, []);
    }
  };
  try {
    for (const id of [1, 2]) {
      server.connect(id);
      const callbacks = { snap: [], other: [] };
      const transport = { onMessage: (cb) => callbacks.other.push(cb), onSnapshot: (cb) => callbacks.snap.push(cb),
        start() {}, send: (msg) => server.receive(id, structuredClone(msg)), flush() {} };
      const client = new GameClient(transport, server.world.map, { emit() {} });
      clients.push({ id, client, callbacks }); client.join('Canto', 0);
    }
    publish();
    const captain = clients[0].client, observer = clients[1].client, w = server.world, owner = captain.youServer;
    const raft = publicRafts(w).find((r) => r.owner === owner), helm = pilotPoint(raft, raft.helm);
    w.ecs.x[owner] = helm.x; w.ecs.y[owner] = helm.y; w.ecs.z[owner] = helm.z;
    captain.mountNaval(raft.id); publish();
    assert.ok(captain.naval.active);
    assert.ok(!observer.pred.rafts.find((r) => r.id === raft.id).canto);
    assert.ok(captain.tickNaval({ ...sail, capture: false, jump: 0, canto: 1 }));
    server.step(); publish();
    assert.equal(captain.naval.body.canto.until, 3600);
    assert.deepEqual(observer.pred.rafts.find((r) => r.id === raft.id).canto, { yaw: captain.naval.body.canto.yaw });
  } finally { server.disconnect(1); server.disconnect(2); }
});

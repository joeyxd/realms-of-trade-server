import test from 'node:test';
import assert from 'node:assert/strict';
import { SURVIVAL, readSurv, readSurvField } from '../src/data/survival.js';
import { World } from '../src/sim/world.js';
import { newProfile, installInventory, attachProfile, sanitizeProfile, syncProfile } from '../src/sim/systems/inventory.js';
import { applyNeedsProfile, consumeNeeds, respawnNeeds, stepNeeds } from '../src/sim/systems/survival.js';
import { GameClient } from '../src/client/gameClient.js';
import { guardMax } from '../src/sim/systems/stats.js';

function fixture({ enabled = true } = {}) {
  const world = new World(41, { server: true });
  world.survivalEnabled = enabled;
  installInventory(world, 'survival-core-test');
  const e = world.spawnPlayer({});
  const profile = newProfile();
  attachProfile(world, e, profile);
  return { world, e, profile };
}

test('rest and active foot/swim/aboard commands drain at the approved rates', () => {
  const { world, e } = fixture();
  const before = [world.ecs.sat[e], world.ecs.hyd[e]];
  stepNeeds(world, e, { mx: 0, mz: 0 }, 1);
  assert.ok(Math.abs((before[0] - world.ecs.sat[e]) - SURVIVAL.drain.sat) < 1e-9);
  assert.ok(Math.abs((before[1] - world.ecs.hyd[e]) - SURVIVAL.drain.hyd) < 1e-9);
  const footBefore = world.ecs.sat[e];
  stepNeeds(world, e, { mx: 1, mz: 0 }, 1);
  assert.ok(Math.abs((footBefore - world.ecs.sat[e]) - SURVIVAL.drain.sat * 1.5) < 1e-9);
  world.ecs.swim[e] = 1;
  const swimBefore = world.ecs.hyd[e];
  stepNeeds(world, e, { mx: 0, mz: 0 }, 1);
  assert.ok(Math.abs((swimBefore - world.ecs.hyd[e]) - SURVIVAL.drain.hyd * 1.5) < 1e-9);
  world.ecs.swim[e] = 0;
  world.navalPilot = { aboard: (entity) => entity === e };
  const helmBefore = world.ecs.sat[e];
  world.applyCommand(e, { seq: 1, mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: 0, w: 0 });
  assert.ok(world.ecs.sat[e] < helmBefore, 'helm early return follows needs stepping');
});

test('death and disabled survival freeze meters; offline has no stepping path', () => {
  const { world, e } = fixture();
  world.ecs.dead[e] = 1;
  const dead = [world.ecs.sat[e], world.ecs.hyd[e]];
  stepNeeds(world, e, { mx: 1, mz: 0 }, 60);
  assert.deepEqual([world.ecs.sat[e], world.ecs.hyd[e]], dead);
  world.ecs.dead[e] = 0;
  world.survivalEnabled = false;
  stepNeeds(world, e, { mx: 1, mz: 0 }, 60);
  assert.deepEqual([world.ecs.sat[e], world.ecs.hyd[e]], dead);
  const offline = new World(42);
  assert.equal(offline.isServer, false);
  assert.equal(offline.survivalEnabled, undefined);
});

test('profile field is strict and sanitizer rejects malformed present fields', () => {
  const good = { v: 1, sat: 34.25, hyd: 80 };
  assert.deepEqual(readSurvField({ surv: good }), { present: true, value: good });
  assert.deepEqual(readSurv({ v: 1, sat: 50.01, hyd: 40 }), { v: 1, sat: 50.01, hyd: 40 });
  assert.equal(readSurv({ v: 1, sat: 50, hyd: 40.000000001 }), null,
    'a value SQL would reject as more precise than a hundredth must be rejected here too');
  const generated = consumeNeeds({ ...newProfile(), surv: { v: 1, sat: 50, hyd: 20 } }, 'agua');
  assert.deepEqual(readSurvField(generated).value, { v: 1, sat: 50, hyd: 60 });
  assert.equal(sanitizeProfile({ ...newProfile(), surv: { ...good, extra: true } }), null);
  assert.equal(sanitizeProfile({ ...newProfile(), surv: { v: 1, sat: 101, hyd: 20 } }), null);
  const inherited = Object.create({ surv: good });
  Object.assign(inherited, newProfile());
  assert.equal(readSurvField(inherited).present, true);
  assert.equal(sanitizeProfile(inherited), null);
});

test('meter restore updates maxima without healing and preserves an explicit full field', () => {
  const { world, e, profile } = fixture();
  const ecs = world.ecs;
  assert.equal(applyNeedsProfile(world, e, { ...profile, surv: { v: 1, sat: 0, hyd: 0 } }), true);
  const penalizedMax = ecs.maxHp[e];
  ecs.hp[e] = Math.floor(penalizedMax / 2);
  const restored = consumeNeeds({ ...profile, surv: { v: 1, sat: 90, hyd: 90 } }, 'fruta');
  assert.ok(restored);
  assert.deepEqual(restored.surv, { v: 1, sat: 100, hyd: 100 });
  assert.equal(applyNeedsProfile(world, e, restored), true);
  assert.equal(ecs.sat[e], 100); assert.equal(ecs.hyd[e], 100);
  assert.equal(ecs.maxHp[e] > penalizedMax, true);
  assert.equal(ecs.hp[e], Math.floor(penalizedMax / 2), 'raising max HP does not heal current HP');
  assert.deepEqual(syncProfile(world, e).surv, { v: 1, sat: 100, hyd: 100 });
});

test('respawn sets both meters to 50 and profile capture agrees with live meters', () => {
  const { world, e, profile } = fixture();
  const target = { ...profile, surv: { v: 1, sat: 12.25, hyd: 8.5 } };
  applyNeedsProfile(world, e, target);
  assert.equal(respawnNeeds(world, e), true);
  assert.equal(world.ecs.sat[e], 50); assert.equal(world.ecs.hyd[e], 50);
  const captured = syncProfile(world, e);
  assert.deepEqual(captured.surv, { v: 1, sat: 50, hyd: 50 });
  assert.deepEqual(world.profiles.get(e).surv, captured.surv);
  assert.equal(sanitizeProfile(captured).surv.sat, 50);
});

test('client HUD reports the same penalized stamina maximum as combat', () => {
  const { world, e, profile } = fixture();
  const client = new GameClient({ onMessage() {}, onSnapshot() {}, start() {} }, world.map, { emit() {} });
  client.pred = world; client.youLocal = e;
  for (const meter of [100, 30, 0, 80]) {
    applyNeedsProfile(world, e, { ...profile, surv: { v: 1, sat: meter, hyd: meter } });
    const state = client.localState(1, {});
    assert.equal(state.guardMax, guardMax(world.ecs, e), `meter ${meter}: penalty applied once`);
    assert.equal(state.needs, 1); assert.equal(state.hyd, meter);
  }
});

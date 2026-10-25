// PT13: swapping weapons from the quick bar is no exploit. equipItem refuses a weapon swap while a swing or a cast
// runs (skillDenied 'busy') and setWeapon keeps the pistol cooldowns, so a sabre round trip skips no shot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../src/data/meta.js';
import { World } from '../src/sim/world.js';
import { BTN } from '../src/sim/systems/movement.js';
import { installInventory, newProfile, attachProfile, giveItem, equipItem } from '../src/sim/systems/inventory.js';
import { A, map } from './helpers.mjs';

const weapon = (b) => ({ u: 0, b, r: 0, l: 1, a: [] });

// A server world with one calm pirate holding the starter sabre (weapon 0) and a profile.
function fixture() {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'swap-test');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 5, facing: Math.PI / 2 });
  attachProfile(w, e, newProfile());
  const ecs = w.ecs;
  ecs.regenT[e] = 99;
  let seq = 0;
  const step = (cmd = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e] + 5, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...cmd });
    w.stepWorld();
    const events = w.events.slice();
    w.events.length = 0;
    return events;
  };
  const until = (done, max = 240) => { for (let i = 0; i < max && !done(); i++) step(); return done(); };
  return { w, e, ecs, step, until };
}

test('a weapon swap is refused while the sabre swings and accepted once the swing ends', () => {
  const F = fixture(), { w, e, ecs } = F;
  const pistols = giveItem(w, e, weapon('chispa'));
  F.step({ btn: BTN.ATTACK, prs: BTN.ATTACK });
  assert.ok(F.until(() => ecs.atkStage[e] > 0, 10), 'the sabre swings');
  assert.equal(equipItem(w, e, pistols.u), false, 'refused mid-swing');
  assert.equal(w.events.find((ev) => ev.type === 'skillDenied')?.why, 'busy');
  assert.equal(ecs.weapon[e], 0);
  assert.equal(w.profiles.get(e).eq.weapon.b, 'sable', 'nothing moved');
  assert.ok(F.until(() => ecs.atkStage[e] === 0), 'the swing ends by itself');
  assert.ok(equipItem(w, e, pistols.u), 'accepted once idle');
  assert.equal(ecs.weapon[e], 1);
});

test('the pistol cooldown survives a sabre round trip', () => {
  const F = fixture(), { w, e, ecs } = F;
  const pistols = giveItem(w, e, weapon('chispa'));
  const sabre = giveItem(w, e, weapon('sable'));
  assert.ok(equipItem(w, e, pistols.u));
  assert.equal(ecs.weapon[e], 1);
  F.step({ btn: BTN.ATTACK, prs: BTN.ATTACK });
  assert.ok(F.until(() => ecs.shotCd[e] > 0, 10), 'the left pistol fired');
  // Once the shot's own busy window is over the cooldown still runs: a swap must not clear it.
  assert.ok(F.until(() => ecs.atkStage[e] === 0 && ecs.castK[e] === 0, 30) && ecs.shotCd[e] > 0, 'idle with the cooldown running');
  const cd = ecs.shotCd[e];
  assert.ok(equipItem(w, e, sabre.u), 'sabre on');
  assert.equal(ecs.weapon[e], 0);
  assert.equal(ecs.shotCd[e], cd, 'the swap keeps shotCd');
  assert.ok(equipItem(w, e, pistols.u), 'pistols back');
  assert.equal(ecs.weapon[e], 1);
  assert.equal(ecs.shotCd[e], cd, 'the round trip skipped nothing');
  F.step({ btn: BTN.ATTACK, prs: BTN.ATTACK });
  assert.ok(ecs.shotCd[e] < cd, 'the trigger fires nothing while the cooldown runs: it only ticks down');
});

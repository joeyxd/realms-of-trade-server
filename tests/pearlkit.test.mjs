import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { PEARLS } from '../src/data/pearls.js';
import { GAME } from '../src/data/meta.js';
import { SKILLS, WEAPON } from '../src/data/weapons.js';
import { skillIndex } from '../src/data/tattoos.js';
import { World } from '../src/sim/world.js';
import { SHOT } from '../src/sim/projectiles.js';
import { BTN } from '../src/sim/systems/movement.js';
import { setWeapon } from '../src/sim/systems/skills.js';
import { installInventory, newProfile, attachProfile } from '../src/sim/systems/inventory.js';
import { givePearl, swallowPearl, spitPearl } from '../src/sim/systems/pearls.js';
import { map, A } from './helpers.mjs';

function pearlWorld(kind) {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'pearlkit');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 4, facing: Math.PI / 2 });
  const p = newProfile();
  for (const mast of p.mast) mast[0] = 3;
  attachProfile(w, e, p);
  w.ecs.regenT[e] = 99;
  const pearl = givePearl(w, e, kind);
  assert.ok(swallowPearl(w, e, pearl.uid));
  w.events.length = 0;
  let seq = 0;
  const step = (c = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...c });
    w.stepWorld();
    const events = w.events.slice(); w.events.length = 0;
    return events;
  };
  const run = (n, c = {}) => {
    const events = [];
    for (let i = 0; i < n; i++) events.push(...step(typeof c === 'function' ? c(i) : c));
    return events;
  };
  return { w, e, p, pearl, step, run };
}

test('each swallowed pearl colors damage from the live weapon and all three tattoos', () => {
  const runs = [
    ['melee', (A) => {
      const x = A.w.ecs.x[A.e]; const target = A.w.debugSpawn('dummy', x + 1.2, A.w.ecs.z[A.e], 0);
      const evs = A.run(50, (i) => ({ prs: i === 0 ? BTN.ATTACK : 0 }));
      return [evs, target];
    }],
    ['Estocada', (A) => {
      const { w, e, run } = A; w.ecs.skQ[e] = skillIndex('lunge');
      const target = w.debugSpawn('dummy', w.ecs.x[e] + 3, w.ecs.z[e], 0);
      return [run(24, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: w.ecs.x[e] + 4, az: w.ecs.z[e] })), target];
    }],
    ['Hoja de viento', (A) => {
      const { w, e, run } = A; w.ecs.skE[e] = skillIndex('wave');
      const target = w.debugSpawn('dummy', w.ecs.x[e] + 5, w.ecs.z[e], 0);
      return [run(45, (i) => ({ prs: i === 0 ? BTN.E : 0, ax: w.ecs.x[e] + 6, az: w.ecs.z[e] })), target];
    }],
    ['pistol', (A) => {
      const { w, e, run } = A; setWeapon(w, e, WEAPON.PISTOLAS);
      const target = w.debugSpawn('dummy', w.ecs.x[e] + 5, w.ecs.z[e], 0);
      return [run(32, (i) => ({ prs: i === 0 ? BTN.ATTACK : 0, ax: w.ecs.x[e] + 6, az: w.ecs.z[e] })), target];
    }],
    ['Descarga', (A) => {
      const { w, e, run } = A; setWeapon(w, e, WEAPON.PISTOLAS);
      const target = w.debugSpawn('dummy', w.ecs.x[e] + 2.5, w.ecs.z[e], 0);
      return [run(18, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: w.ecs.x[e] + 4, az: w.ecs.z[e] })), target];
    }],
    ['Tromba', (A) => {
      const { w, e, run } = A; w.ecs.skQ[e] = skillIndex('tromba');
      const x = w.ecs.x[e] + 6, z = w.ecs.z[e]; const target = w.debugSpawn('dummy', x, z, 0);
      return [run(65, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: x, az: z })), target];
    }],
    ['Abordaje', (A) => {
      const { w, e, run } = A; w.ecs.skE[e] = skillIndex('leap');
      const x = w.ecs.x[e] + 5, z = w.ecs.z[e]; const target = w.debugSpawn('dummy', x, z, 0);
      return [run(55, (i) => ({ prs: i === 0 ? BTN.E : 0, ax: x, az: z })), target];
    }],
    ['Timón', (A) => {
      const { w, e, run } = A; w.ecs.skQ[e] = skillIndex('wheel');
      const target = w.debugSpawn('dummy', w.ecs.x[e] + 4, w.ecs.z[e], 0);
      return [run(Math.ceil(SKILLS.wheel.life * 60), (i) => ({ prs: i === 0 ? BTN.Q : 0 })), target];
    }],
  ];

  for (const kind of Object.keys(PEARLS)) for (const [name, attack] of runs) {
    const A = pearlWorld(kind), [evs, target] = attack(A);
    const hits = evs.filter((ev) => ev.type === 'damage' && ev.id === target);
    assert.ok(hits.length, `${kind}/${name}: actual action hits the fixture`);
    assert.ok(hits.every((ev) => ev.elem === PEARLS[kind].elem), `${kind}/${name}: ${JSON.stringify(hits.map((ev) => ev.elem))}`);
  }
});

test('authoritative weapon-shot hits use the launch pearl after it is spat out', () => {
  for (const [kind, spec] of Object.entries(PEARLS)) {
    for (const shotKind of [SHOT.BULLET, SHOT.REFLECT]) {
      const { w, e, p } = pearlWorld(kind);
      const ecs = w.ecs;
      const target = w.debugSpawn('dummy', ecs.x[e] + 3.5, ecs.z[e], 0);
      const bouncedTarget = shotKind === SHOT.REFLECT
        ? w.debugSpawn('dummy', ecs.x[e] + 4.8, ecs.z[e] + 1.2, 0) : 0;
      const sid = w.spawnShot(e, {
        pid: 0, key: -1, type: 0, x: ecs.x[e] + 0.6, y: ecs.y[e] + 1.1, z: ecs.z[e],
        dx: 1, dz: 0, speed: 28, dmg: 18, life: 0.6, r: 0.2, heavy: false,
        seq: 1, bounce: bouncedTarget ? 1 : 0, homing: 0, cone: 0, kind: shotKind, pt: w.tick,
      });
      const shotSlot = w.shots.slot.get(sid);
      assert.equal(w.shots.elem[shotSlot], spec.elem, `${kind}/${shotKind}: frozen in Shots.elem`);
      const launched = w.events.find((ev) => ev.type === 'shot' && ev.sid === sid);
      assert.equal(launched.elem, spec.elem, `${kind}/${shotKind}: emitted shot packet carries launch element`);

      assert.ok(spitPearl(w, e));
      assert.equal(ecs.elem[e], 0, 'the carrier has no element after spitting');
      const evs = [];
      for (let i = 0; i < 50; i++) {
        w.stepWorld();
        evs.push(...w.events);
        w.events.length = 0;
      }
      const hit = evs.find((ev) => ev.type === 'damage' && ev.id === target && ev.kind === (shotKind === SHOT.BULLET ? 'bullet' : 'shot'));
      assert.ok(hit, `${kind}/${shotKind}: actual authoritative shot hits the first dummy`);
      assert.equal(hit.elem, spec.elem, `${kind}/${shotKind}: delayed hit keeps its launch element after spit`);
      const end = evs.find((ev) => ev.type === 'shotEnd' && ev.sid === sid);
      assert.ok(end, `${kind}/${shotKind}: server emits shot end`);
      assert.equal(end.elem, spec.elem, `${kind}/${shotKind}: shot end retains the element for clients`);
      if (bouncedTarget) {
        const bounce = evs.find((ev) => ev.type === 'shot' && ev.from === sid);
        assert.ok(bounce, `${kind}: reflected shot bounces to a second target`);
        assert.equal(bounce.elem, spec.elem, `${kind}: bounce packet inherits the original element`);
        const nextHit = evs.find((ev) => ev.type === 'damage' && ev.id === bouncedTarget && ev.kind === 'shot');
        assert.ok(nextHit, `${kind}: bounced shot hits its second target`);
        assert.equal(nextHit.elem, spec.elem, `${kind}: bounced hit keeps the launch element`);
      }
      assert.equal(p.pearls.swallowed, null);
      assert.equal(w.shots.id[shotSlot], 0, 'the completed first shot is retired');
    }
  }
});

test('remote shot packet populates client Shots.elem and the deferred impact feedback keeps it', () => {
  const shown = [];
  const transport = { onMessage() {}, onSnapshot() {}, start() {} };
  const client = new GameClient(transport, map, { emit: (_type, ev) => shown.push(ev) });
  client.youServer = 22;
  client.youLocal = 3;
  const elem = PEARLS.tormenta.elem;
  client.onEvent({
    type: 'shot', sid: 701, pid: 0, key: 0, owner: 99, elem,
    x: A.x, y: 1.1, z: A.z, dx: 1, dz: 0, speed: 14, dmg: 5, life: 1, r: 0.2,
    ptype: 0, heavy: 0, seq: 0, homing: 0, cone: 0,
  });
  const local = client.sidOf.get(701);
  const slot = client.shots.slot.get(local);
  assert.ok(slot !== undefined, 'a remote shot gets a local visual shot');
  assert.equal(client.shots.elem[slot], elem);

  client.onEvent({ type: 'shotEnd', sid: 701, owner: 99, elem, x: A.x + 2, z: A.z, hit: 0 });
  const ending = client.ending.get(slot);
  assert.equal(ending.elem, elem, 'the pending visual impact snapshots the launch element');
  client.finishEnding(slot, ending, ending.x, ending.z);
  assert.deepEqual(shown.find((ev) => ev.type === 'shotImpact'), {
    type: 'shotImpact', e: 99, elem, x: A.x + 2, z: A.z, hit: 0,
  });

  const predicted = client.spawnLocalShot(client.youLocal, {
    key: 44, seq: 9, pred: 9, type: 0, elem: PEARLS.brasa.elem,
    x: A.x, y: 1.1, z: A.z, dx: 1, dz: 0, speed: 14, dmg: 5, life: 1, r: 0.2,
  });
  const predictedSlot = client.shots.slot.get(predicted);
  client.onEvent({
    type: 'shot', sid: 702, pid: 0, key: 44, owner: 22, elem: 0,
    x: A.x, y: 1.1, z: A.z, dx: 1, dz: 0, speed: 14, dmg: 5, life: 1, r: 0.2,
    ptype: 0, heavy: 0, seq: 9, homing: 0, cone: 0,
  });
  assert.equal(client.shots.elem[predictedSlot], 0, 'the authoritative unpowered value corrects a colored prediction');
});

test('an unpowered shot stays neutral when its owner swallows a pearl before impact', () => {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'pearlkit-unpowered');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 4, facing: Math.PI / 2 });
  const p = newProfile();
  attachProfile(w, e, p);
  w.ecs.regenT[e] = 99;
  const ecs = w.ecs;
  const target = w.debugSpawn('dummy', ecs.x[e] + 3.5, ecs.z[e], 0);
  const sid = w.spawnShot(e, {
    pid: 0, key: -1, type: 0, x: ecs.x[e] + 0.6, y: ecs.y[e] + 1.1, z: ecs.z[e],
    dx: 1, dz: 0, speed: 28, dmg: 18, life: 0.6, r: 0.2, heavy: false,
    seq: 1, bounce: 0, homing: 0, cone: 0, kind: SHOT.BULLET, pt: w.tick,
  });
  const slot = w.shots.slot.get(sid);
  assert.equal(w.shots.elem[slot], 0);
  assert.equal(w.events.find((ev) => ev.type === 'shot' && ev.sid === sid).elem, 0);
  const pearl = givePearl(w, e, 'brasa');
  assert.ok(swallowPearl(w, e, pearl.uid));
  assert.equal(ecs.elem[e], PEARLS.brasa.elem);
  const events = [];
  for (let i = 0; i < 20; i++) {
    w.stepWorld();
    events.push(...w.events);
    w.events.length = 0;
  }
  const hit = events.find((ev) => ev.type === 'damage' && ev.id === target);
  assert.ok(hit, JSON.stringify(events));
  assert.equal(hit.elem ?? 0, 0, 'an unpowered hit stays visually neutral');
  assert.equal(events.find((ev) => ev.type === 'shotEnd' && ev.sid === sid).elem, 0);
});

test('neutral player attack events retain explicit zero after a later pearl swallow', () => {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'pearlkit-neutral-event');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 4 });
  attachProfile(w, e, newProfile());
  w.ecs.regenT[e] = 99;
  const ev = { type: 'fire', e, x: A.x, z: A.z, dx: 1, dz: 0 };
  w.emit(ev);
  assert.equal(ev.elem, 0);
  const pearl = givePearl(w, e, 'brasa');
  assert.ok(swallowPearl(w, e, pearl.uid));
  assert.equal(w.ecs.elem[e], PEARLS.brasa.elem);
  assert.equal(ev.elem, 0, 'queued feedback does not acquire the owner’s later power');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/data/tuning.js';
import { PTYPE, SHOT, KILL, NEVER } from '../src/sim/projectiles.js';
import { A, arena } from './helpers.mjs';

const openMap = { colliders: [], groundAt: () => 0, queryColliders: () => [] };

function crossing({ type = PTYPE.PARRY, heavy = false, y = 1.1, slope = 0, shotY = y + slope * 4, copies = 1 } = {}) {
  const { w, e } = arena();
  w.map = openMap;
  const z = A.z + 4, tick = w.tick;
  const ids = [];
  for (let i = 0; i < copies; i++) {
    const id = 700 + i;
    // Rewind the analytic hazard so it reaches A.x + 0.3 at `tick`; it is already armed.
    w.hazards.spawn(id, type, 0, A.x + 4.3, y, z, -20, 0, tick - 12, 10, openMap, slope, 2);
    ids.push(id);
  }
  const s = w.spawnShot(e, { key: -13, x: A.x - 0.3, y: shotY, z, dx: 1, dy: 0, dz: 0,
    speed: 20, dmg: 4, life: 1, r: 0.19, heavy, kind: SHOT.BULLET, homing: 0, pt: tick });
  w.events.length = 0;
  w.stepShots(DT);
  return { w, e, s, ids, events: w.events.slice() };
}

test('una bala y un proyectil se cruzan entre ticks y devuelven una trayectoria 3D al dueño', () => {
  const { w, e, ids, events } = crossing({ y: 2.1, slope: 0.5 });
  const end = events.find((ev) => ev.type === 'shotEnd');
  const parry = events.find((ev) => ev.type === 'parry');
  const returned = events.find((ev) => ev.type === 'shot');
  assert.ok(end && parry && returned, 'el contacto continuo no depende de solapamiento en extremos');
  assert.equal(parry.pid, ids[0]); assert.equal(parry.e, e); assert.equal(parry.intercept, 1);
  assert.equal(w.hazards.kill[w.hazards.slot.get(ids[0])], KILL.REFLECT);
  assert.ok(returned.dx > 0 && returned.dy < 0, 'la tangente hostil se invierte en XYZ');
  assert.ok(returned.dy < 0 && w.shots.vy[w.shots.slot.get(returned.sid)] < 0);
  assert.equal(w.shots.homing[w.shots.slot.get(returned.sid)], 0, 'la devolución no homing');
  assert.equal(events.filter((ev) => ev.type === 'parry').length, 1);
});

test('el roce en altura no devuelve la bala y un disparo ligero solo se consume contra pesado', () => {
  const high = crossing({ y: 3.5, shotY: 1.1, slope: 0 });
  assert.ok(!high.events.some((ev) => ev.type === 'parry'), 'la separación vertical cuenta en el contacto');
  assert.ok(high.w.shots.slot.has(high.s), 'el tiro continúa tras el casi-roce');

  const lightVsHeavy = crossing({ type: PTYPE.HEAVY });
  assert.ok(lightVsHeavy.events.some((ev) => ev.type === 'shotEnd'));
  assert.ok(!lightVsHeavy.events.some((ev) => ev.type === 'parry' || ev.type === 'shot'));
  const hs = lightVsHeavy.w.hazards.slot.get(lightVsHeavy.ids[0]);
  assert.equal(lightVsHeavy.w.hazards.dead[hs], NEVER, 'el proyectil pesado sigue intacto');
});

test('solo un impacto estable por tiro; el fuerte devuelve pesado, el imparable sigue su regla', () => {
  const tied = crossing({ copies: 2 });
  assert.equal(tied.events.filter((ev) => ev.type === 'parry').length, 1);
  assert.equal(tied.events.find((ev) => ev.type === 'parry').pid, Math.min(...tied.ids));
  assert.equal(tied.events.filter((ev) => ev.type === 'shot').length, 1, 'la nueva devolución no avanza en el mismo paso');

  const strong = crossing({ type: PTYPE.HEAVY, heavy: true });
  assert.ok(strong.events.some((ev) => ev.type === 'parry' && ev.heavy === 1));
  assert.ok(strong.events.some((ev) => ev.type === 'shot'));

  const unstoppable = crossing({ type: PTYPE.UNSTOP });
  assert.ok(!unstoppable.events.some((ev) => ev.type === 'parry'));
});

test('un collider y el impacto anterior de una entidad conservan prioridad sobre el choque', () => {
  const { w, e } = arena();
  const z = A.z + 4, tick = w.tick;
  const wall = { x: A.x, z, r: 1 };
  const blockedMap = { colliders: [wall], groundAt: () => 0, queryColliders: () => [0] };
  w.map = blockedMap;
  w.hazards.spawn(811, PTYPE.PARRY, 0, A.x + 4.3, 1.1, z, -20, 0, tick - 12, 10, blockedMap, 0, 2);
  w.spawnShot(e, { x: A.x - 0.3, y: 1.1, z, dx: 1, dz: 0, speed: 20, dmg: 4, life: 1, r: 0.19,
    kind: SHOT.BULLET, homing: 0, pt: tick });
  w.events.length = 0; w.stepShots(DT);
  assert.ok(!w.events.some((ev) => ev.type === 'parry'), 'la pared corta ambos trayectos antes del contacto');

  const open = { colliders: [], groundAt: () => 0, queryColliders: () => [] };
  w.map = open;
  w.hazards.spawn(812, PTYPE.PARRY, 0, A.x + 4.3, 1.1, z, -20, 0, tick - 12, 10, open, 0, 2);
  const enemy = w.debugSpawn('dummy', A.x - 0.1, z, 0);
  w.spawnShot(e, { x: A.x - 0.3, y: 1.1, z, dx: 1, dz: 0, speed: 20, dmg: 4, life: 1, r: 0.19,
    kind: SHOT.BULLET, homing: 0, pt: tick });
  w.events.length = 0; w.stepShots(DT);
  assert.ok(w.events.some((ev) => ev.type === 'shotEnd' && ev.hit === enemy));
  assert.ok(!w.events.some((ev) => ev.type === 'parry'), 'un blanco alcanzado antes consume el disparo');
});

test('el barrido de disparo respeta la altura del cuerpo del enemigo', () => {
  const { w, e } = arena();
  const open = { colliders: [], groundAt: () => 0, queryColliders: () => [] };
  w.map = open;
  const z = A.z + 4, enemy = w.debugSpawn('dummy', A.x + 0.1, z, 0);
  const y = w.ecs.y[enemy] + 2.4;
  const sid = w.spawnShot(e, { x: A.x - 0.3, y, z, dx: 1, dz: 0, speed: 20, dmg: 4, life: 1, r: 0.19,
    kind: SHOT.BULLET, homing: 0, pt: w.tick });
  w.events.length = 0; w.stepShots(DT);
  assert.ok(!w.events.some((ev) => ev.type === 'shotEnd' && ev.hit === enemy), 'pasar sobre la cabeza no cuenta como impacto');
  assert.ok(w.shots.slot.has(sid), 'la bala aérea sigue en vuelo');

  const falling = w.spawnShot(e, { x: A.x - 0.3, y: w.ecs.y[enemy] + 2.3, z, dx: 1, dy: -0.8, dz: 0,
    speed: 20, dmg: 4, life: 1, r: 0.19, kind: SHOT.BULLET, homing: 0, pt: w.tick });
  w.events.length = 0; w.stepShots(DT); w.stepShots(DT);
  assert.ok(w.events.some((ev) => ev.type === 'shotEnd' && ev.sid === falling && ev.hit === enemy), 'el barrido toca el cuerpo al entrar en su volumen vertical');
});

test('un evento de shot conserva dy para que el cliente adopte la velocidad vertical', () => {
  const { w, e } = arena();
  const sid = w.spawnShot(e, { x: A.x, y: 2, z: A.z, dx: 0, dy: -0.6, dz: 0.8, speed: 10,
    dmg: 1, life: 1, r: 0.1, homing: 0, kind: SHOT.REFLECT, pt: w.tick });
  const ev = w.events.find((x) => x.type === 'shot' && x.sid === sid);
  assert.equal(ev.dy, -0.6);
});

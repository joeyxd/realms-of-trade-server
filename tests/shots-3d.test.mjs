import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shots, PTYPE, SHOT, KILL } from '../src/sim/projectiles.js';
import { A, map, clientAndServer } from './helpers.mjs';

test('Shots normaliza dy junto a dx/dz y avanza la coordenada vertical', () => {
  const shots = new Shots(2);
  const slot = shots.spawn(1, { owner: 4, type: PTYPE.PARRY, x: 1, y: 3, z: 2,
    dx: 0, dy: -0.6, dz: 0.8, speed: 10, life: 1, dmg: 2, r: 0.2, homing: 0, kind: SHOT.REFLECT });
  assert.equal(shots.vx[slot], 0);
  assert.equal(shots.vy[slot], -6);
  assert.equal(shots.vz[slot], 8);
  shots.step(slot, 0.1, () => 0, () => false, {});
  assert.equal(shots.y[slot], 2.4);
});

test('GameClient adopta dy del evento shot autoritativo', () => {
  const { client } = clientAndServer();
  const sid = 90001;
  client.onEvent({ type: 'shot', sid, pid: 0, key: 0, owner: client.youServer, elem: 0,
    x: 1, y: 3, z: 2, dx: 0, dy: -0.6, dz: 0.8, speed: 10, dmg: 2, life: 1, r: 0.2,
    ptype: PTYPE.PARRY, heavy: 0, seq: 0, homing: 0, cone: 0, kind: SHOT.REFLECT });
  const id = client.sidOf.get(sid), slot = client.shots.slot.get(id);
  assert.ok(slot !== undefined);
  assert.equal(client.shots.vy[slot], -6);
});

test('GameClient conserva la altura del impacto durante el vuelo visual de cierre', () => {
  const { client, shown } = clientAndServer();
  const sid = client.spawnLocalShot(client.youServer, { x: 1, y: 1, z: 2, dx: 0, dy: 1, dz: 0,
    speed: 10, life: 1, dmg: 1, r: 0.1, homing: 0, server: true });
  client.sidOf.set(91001, sid);
  client.onEvent({ type: 'shotEnd', sid: 91001, owner: client.youServer, x: 1, y: 3, z: 2, hit: 0 });
  client.stepShots(0.1);
  assert.ok(!shown.some((ev) => ev.type === 'shotImpact'), 'no finaliza al comparar solo x/z');
  client.stepShots(0.1);
  const impact = shown.find((ev) => ev.type === 'shotImpact');
  assert.ok(impact);
  assert.equal(impact.y, 3);
});

test('localState expone recarga y multiplicador para el HUD de la pistola secundaria', () => {
  const { client } = clientAndServer();
  const ecs = client.pred.ecs, e = client.youLocal;
  ecs.shotAltCd[e] = 0.37; ecs.fireMul[e] = 0.85;
  const state = client.localState(0, {});
  assert.equal(state.shotAltCd, 0.37);
  assert.equal(state.fireMul, 0.85);
});

test('un intercept confirmado no se revierte al re-jugar secuencias viejas y respeta killTick del snapshot', () => {
  const { client } = clientAndServer();
  const H = client.pred.hazards, pid = 90101;
  const slot = H.spawn(pid, PTYPE.PARRY, 0, A.x, 2, A.z, 0, 0, 0, 5, map);
  client.ptCur = 80;
  client.onEvent({ type: 'parry', pid, e: client.youServer, seq: 1, tier: 2, intercept: 1, x: A.x, y: 2, z: A.z });
  assert.equal(H.dead[slot], 80, 'el evento apaga el hazard inmediatamente');
  assert.equal(H.confirmed[slot], 1);
  client.replay(0); // la secuencia 1 sigue pendiente, pero el evento ya la confirmó
  assert.equal(H.dead[slot], 80);

  const pattern = { pid0: pid, tick: 80, src: 99, pat: 'single', ptype: 'parry', n: 1, speed: 0, dmg: 5,
    x: A.x, y: 2, z: A.z, ang: 0, removed: [{ pid, tick: 85, kind: KILL.REFLECT, by: client.youServer, seq: 1 }] };
  client.onSnapshot({ tick: 81, ents: [], storm: [pattern] });
  assert.equal(H.dead[slot], 85, 'el tombstone del snapshot conserva el tick autoritativo');
  assert.equal(H.confirmed[slot], 1);
  client.replay(0);
  assert.equal(H.dead[slot], 85, 'ni el replay revierte el tombstone autoritativo');
});

// M3.5 P4: the cutlass kit. Q Estocada (lunge), E Hoja de viento (crescent), R Tormenta (riposte wave).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning, DT } from '../src/data/tuning.js';
import { SKILLS } from '../src/data/weapons.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PTYPE } from '../src/sim/projectiles.js';
import { ACT } from '../src/sim/ecs.js';
import { map, arena, incoming, clientAndServer } from './helpers.mjs';

const L = SKILLS.lunge, W = SKILLS.wave;
const run = (step, n, c = {}) => { const evs = []; for (let i = 0; i < n; i++) evs.push(...step(c)); return evs; };
const dmgTo = (evs, id) => evs.filter((ev) => ev.type === 'damage' && ev.id === id);

test('Estocada: Q lunges 4.5 u at the cursor, cannot dash out of it, then waits out its cooldown', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs, x0 = ecs.x[e];
  let evs = step({ prs: BTN.Q });
  assert.equal(evs.filter((ev) => ev.type === 'cast' && ev.skill === 'lunge').length, 1);
  assert.equal(ecs.act[e], ACT.LUNGE);
  evs = step({ prs: BTN.DASH }); // buffered: waits for the lunge to finish its active frames
  for (let i = 0; i < Math.round((L.windup + L.time) / DT) - 2; i++) { step(); assert.ok(ecs.dashT[e] < 0, 'no dash mid-lunge'); }
  assert.ok(Math.abs(ecs.lungeCov[e] - L.dist) < 0.05, `covered ${ecs.lungeCov[e]}`);
  assert.ok(Math.abs(ecs.x[e] - x0 - L.dist) < 0.1, 'along the aim (+x)');
  // The dash buffer (130 ms) ran out while locked: a fresh press dashes out of the recovery.
  run(step, 3);
  step({ prs: BTN.DASH });
  assert.ok(ecs.dashT[e] >= 0, 'dash cancels the recovery');
  assert.equal(ecs.castK[e], 0);
  run(step, 40);
  evs = step({ prs: BTN.Q });
  assert.ok(!evs.some((ev) => ev.type === 'cast'), 'on cooldown');
  assert.ok(ecs.cdQ[e] > 0 && ecs.cdQ[e] < L.cd);
  run(step, Math.ceil(ecs.cdQ[e] / DT) + 1);
  evs = step({ prs: BTN.Q });
  assert.ok(evs.some((ev) => ev.type === 'cast' && ev.skill === 'lunge'), 'ready again');
});

test('Estocada hits each enemy on its path once (heavy) and cuts down the parryables beside it', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const d1 = w.debugSpawn('dummy', ecs.x[e] + 2.2, ecs.z[e] + 0.6, 0);
  const d2 = w.debugSpawn('dummy', ecs.x[e] + 3, ecs.z[e] + 2.4, 0); // too far to the side
  run(step, 10);
  const b = incoming(w, e, PTYPE.PARRY, 3.2, 1.5, 8, -0.7); // drifting in, beside the line
  const evs = [...step({ prs: BTN.Q }), ...run(step, 30)];
  const hits = dmgTo(evs, d1);
  assert.equal(hits.length, 1, 'once');
  assert.equal(hits[0].kind, 'skill');
  assert.equal(hits[0].heavy, 1);
  assert.equal(dmgTo(evs, d2).length, 0, 'out of reach');
  assert.ok(evs.some((ev) => ev.type === 'destroy' && ev.pid === b && ev.skill === 'lunge'));
});

test('Hoja de viento: E throws a crescent that destroys the parryables it crosses (RIPOSTE capped) and hits each enemy once', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const d1 = w.debugSpawn('dummy', ecs.x[e] + 4, ecs.z[e] + 0.5, 0);
  const d2 = w.debugSpawn('dummy', ecs.x[e] + 7, ecs.z[e] - 0.4, 0);
  run(step, 10);
  const ids = [];
  for (let k = 0; k < 7; k++) ids.push(incoming(w, e, PTYPE.PARRY, 5 + k * 0.9, 2, 8, ((k % 3) - 1) * 0.6));
  const heavy = incoming(w, e, PTYPE.HEAVY, 6, 2, 8, 0.3);
  const r0 = ecs.riposte[e];
  const evs = [...step({ prs: BTN.E }), ...run(step, 70)];
  const wave = evs.find((ev) => ev.type === 'wave');
  assert.ok(wave && wave.id > 0 && wave.end > wave.tick);
  const cut = evs.filter((ev) => ev.type === 'destroy' && ev.skill === 'wave').map((ev) => ev.pid);
  for (const id of ids) assert.ok(cut.includes(id), `bullet ${id} destroyed`);
  assert.ok(!cut.includes(heavy), 'heavy orbs are not parryables');
  assert.equal(ecs.riposte[e] - r0, W.riposteMax, 'RIPOSTE from one crescent is capped');
  assert.equal(dmgTo(evs, d1).length, 1);
  assert.equal(dmgTo(evs, d2).length, 1);
  assert.equal(ecs.waveT0[e], 0, 'gone at the end of its flight');
});

test('Hoja de viento stops at a rock pillar', () => {
  const pil = map.props.find((p) => p.kind === 'pillar');
  const A = map.landmarks.arena;
  const ux = (A.x - pil.x) / Math.hypot(A.x - pil.x, A.z - pil.z), uz = (A.z - pil.z) / Math.hypot(A.x - pil.x, A.z - pil.z);
  const { w, e, step } = arena({ x: pil.x + ux * 6, z: pil.z + uz * 6 });
  const ecs = w.ecs;
  const behind = w.debugSpawn('dummy', pil.x - ux * 2.2, pil.z - uz * 2.2, 0);
  run(step, 6, { ax: pil.x, az: pil.z });
  const evs = [...step({ prs: BTN.E, ax: pil.x, az: pil.z }), ...run(step, 60, { ax: pil.x, az: pil.z })];
  const wave = evs.find((ev) => ev.type === 'wave');
  const reach = (wave.end - wave.tick) * DT * W.speed;
  assert.ok(reach < 6.2 && reach > 3, `stops at the pillar (${reach.toFixed(2)} u)`);
  assert.equal(dmgTo(evs, behind).length, 0);
});

test('R with the cutlass is the Tormenta (the riposte wave)', () => {
  const { w, e, step } = arena();
  w.ecs.riposte[e] = tuning.parry.riposte.max;
  incoming(w, e, PTYPE.PARRY, 4, 2);
  const evs = step({ prs: BTN.R });
  assert.ok(evs.some((ev) => ev.type === 'riposte' && ev.n >= 1));
  assert.equal(w.ecs.riposte[e], 0);
});

test('client prediction stays exact through lunges and crescents against an archer', () => {
  const { server, client, deliver, shown, sp, se, ecs } = clientAndServer();
  let maxErr = 0;
  for (let i = 0; i < 1000; i++) {
    // Throw at the archer every ~5 s; lunge toward it and back away from it in turns every ~7 s.
    const prs = i % 310 === 40 ? BTN.E : i % 430 === 100 ? BTN.Q : 0;
    const away = i % 860 > 430;
    const ax = away && prs === BTN.Q ? 2 * ecs.x[se] - sp.x : sp.x, az = away && prs === BTN.Q ? 2 * ecs.z[se] - sp.z : sp.z;
    client.tickInput({ mx: 0, mz: 0, ax, az, btn: BTN.AIM, prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  const pe = client.pred.ecs, me = client.youLocal;
  for (const k of ['hp', 'riposte', 'cdQ', 'cdE', 'x', 'z', 'waveT0']) assert.equal(pe[k][me], ecs[k][se], k);
  const casts = shown.filter((ev) => ev.type === 'cast');
  assert.ok(casts.length >= 5 && casts.every((ev) => ev.predicted), `casts shown once, from prediction (${casts.length})`);
  const cuts = shown.filter((ev) => ev.type === 'destroy' && ev.skill);
  assert.ok(cuts.length >= 1, `some arrows cut by skills (${cuts.length})`);
  assert.ok(shown.some((ev) => ev.type === 'damage' && ev.kind === 'skill' && ev.by === client.youServer), 'the archer was hit by a skill');
});

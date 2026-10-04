// M3.5 P5: the flintlock pistols. LMB held fire, Q Descarga, E Paso de humo, R Lluvia de plomo; the guard
// catches bullets and the next shot throws them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning, DT } from '../src/data/tuning.js';
import { SKILLS, WEAPON } from '../src/data/weapons.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PTYPE, SHOT } from '../src/sim/projectiles.js';
import { ACT } from '../src/sim/ecs.js';
import { setWeapon } from '../src/sim/systems/skills.js';
import { map, arena, incoming, clientAndServer } from './helpers.mjs';

const P = SKILLS.pistol, B = SKILLS.blast, K = SKILLS.blink, R = SKILLS.rain;
const pistols = (o) => arena({ weapon: WEAPON.PISTOLAS, ...o });
const run = (step, n, c = {}) => { const evs = []; for (let i = 0; i < n; i++) evs.push(...step(c)); return evs; };
const dmgTo = (evs, id) => evs.filter((ev) => ev.type === 'damage' && ev.id === id);

test('held LMB fires every 0.2 s from alternating hands; the bullets fly straight and slow you a little', () => {
  const { w, e, step } = pistols();
  const ecs = w.ecs;
  const evs = [...step({ prs: BTN.ATTACK, btn: BTN.ATTACK }), ...run(step, 59, { btn: BTN.ATTACK })];
  const fires = evs.filter((ev) => ev.type === 'fire');
  assert.equal(fires.length, Math.ceil(1 / P.every - 1e-9), `${fires.length} shots in 1 s`);
  assert.deepEqual(fires.slice(0, 4).map((ev) => ev.hand), [-1, 1, -1, 1]);
  const shots = evs.filter((ev) => ev.type === 'shot');
  assert.equal(shots.length, fires.length);
  assert.ok(shots.every((s) => s.kind === SHOT.BULLET && s.speed === P.speed && s.homing === 0));
  assert.equal(ecs.act[e], ACT.SHOOT);
  assert.equal(ecs.moveMul[e], P.move);
  assert.ok(!evs.some((ev) => ev.type === 'swing'), 'no sword');
  run(step, 20);
  assert.equal(ecs.act[e], ACT.IDLE, 'stops when released');
});

test('pistol bullets hit for ATK × 0.6; an armoured front stops them but not a thrown-back catch', () => {
  const { w, e, step } = pistols();
  const ecs = w.ecs;
  const d = w.debugSpawn('dummy', ecs.x[e] + 5, ecs.z[e], 0);
  run(step, 4);
  let evs = [...step({ prs: BTN.ATTACK }), ...run(step, 30)];
  const hit = dmgTo(evs, d)[0];
  assert.equal(hit.kind, 'bullet');
  assert.ok(hit.dmg >= Math.round(ecs.atk[e] * P.mult), `${hit.dmg}`);
  w.despawn(d);
  const crab = w.debugSpawn('crab', ecs.x[e] + 4, ecs.z[e], -Math.PI / 2);
  run(step, 2);
  evs = [...step({ prs: BTN.ATTACK }), ...run(step, 20)];
  assert.equal(dmgTo(evs, crab)[0].armor, 1, 'the crab shell takes the bullet');
  // A caught bullet goes back as a reflect: through the shell.
  ecs.catchN[e] = 1; ecs.catchDmg[e] = 10; ecs.catchT[e] = 0;
  run(step, 20);
  evs = [...step({ prs: BTN.ATTACK }), ...run(step, 20)];
  assert.ok(evs.some((ev) => ev.type === 'release' && ev.n === 1), 'the next shot releases the catch');
  assert.ok(evs.some((ev) => ev.type === 'shot' && ev.kind === SHOT.RELEASE));
  const kinds = dmgTo(evs, crab).map((ev) => [ev.kind, ev.armor]);
  assert.ok(kinds.some(([k, a]) => k === 'shot' && a === 0), JSON.stringify(kinds));
});

test('the pistols do not reflect with LMB: a bullet you shoot at just passes, the guard still blocks', () => {
  const { w, e, step } = pistols();
  const id = incoming(w, e, PTYPE.PARRY, 3, 8);
  const evs = [...step({ prs: BTN.ATTACK }), ...run(step, 30)];
  assert.ok(!evs.some((ev) => ev.type === 'parry' || (ev.type === 'destroy' && ev.pid === id)));
  assert.ok(evs.some((ev) => ev.type === 'phit' && ev.pid === id), 'it hits you');
  const id2 = incoming(w, e, PTYPE.PARRY, 4, 8);
  const evs2 = run(step, 40, { btn: BTN.GUARD });
  assert.ok(evs2.some((ev) => ev.type === 'guard' && (ev.st === 'block' || ev.st === 'perfect') && ev.pid === id2));
});

test('Descarga: 7 pellets in a cone, the parryables in front are blown away (not the ones behind), recoil and root', () => {
  const { w, e, step } = pistols();
  const ecs = w.ecs, x0 = ecs.x[e];
  const front = [incoming(w, e, PTYPE.PARRY, 2.5, 1, 8, 0.4), incoming(w, e, PTYPE.PARRY, 3, 1, 8, -0.8)];
  const behind = w.nextPid++;
  w.hazards.spawn(behind, PTYPE.PARRY, 0, ecs.x[e] - 2, ecs.y[e] + 1.1, ecs.z[e], -1, 0, w.tick, 8, map);
  const evs = [...step({ prs: BTN.Q }), ...run(step, 5)];
  const pellets = evs.filter((ev) => ev.type === 'shot' && ev.kind === SHOT.PELLET);
  assert.equal(pellets.length, B.n);
  const angs = pellets.map((p) => Math.atan2(p.dx, p.dz) * 180 / Math.PI);
  assert.ok(Math.abs(Math.max(...angs) - Math.min(...angs) - B.arc) < 0.01, 'spread over the cone');
  const blown = evs.filter((ev) => ev.type === 'destroy' && ev.skill === 'blast').map((ev) => ev.pid);
  for (const id of front) assert.ok(blown.includes(id));
  assert.ok(!blown.includes(behind));
  assert.equal(ecs.act[e], ACT.BLAST);
  assert.equal(ecs.moveMul[e], 0, 'rooted');
  run(step, 30);
  assert.ok(ecs.x[e] < x0 - 0.2, 'kicked back');
  assert.ok(ecs.cdQ[e] > 0 && ecs.cdQ[e] <= B.cd);
});

test('Paso de humo: E blinks 4.5 u where you walk with i-frames (a bullet passes: ESQUIVA), never through a rock', () => {
  const { w, e, step } = pistols();
  const ecs = w.ecs, z0 = ecs.z[e];
  const evs = step({ prs: BTN.E, mx: 0, mz: 1 });
  const bl = evs.find((ev) => ev.type === 'blink');
  assert.ok(bl);
  assert.ok(Math.abs(ecs.z[e] - z0 - K.dist) < 0.05, `blinked ${ecs.z[e] - z0}`);
  assert.ok(ecs.iframes[e] > 0.2);
  incoming(w, e, PTYPE.PARRY, 1.2, 12);
  const evs2 = run(step, 10);
  assert.ok(evs2.some((ev) => ev.type === 'dodge'), 'ESQUIVA');
  assert.ok(!evs2.some((ev) => ev.type === 'hurt'));
  // Standing in front of a pillar and blinking at it: you stop at its face.
  const pil = map.props.find((p) => p.kind === 'pillar');
  const A = map.landmarks.arena;
  const l = Math.hypot(A.x - pil.x, A.z - pil.z), ux = (A.x - pil.x) / l, uz = (A.z - pil.z) / l;
  const t = pistols({ x: pil.x + ux * 3, z: pil.z + uz * 3 });
  t.step({ prs: BTN.E, ax: pil.x, az: pil.z });
  const d = Math.hypot(t.w.ecs.x[t.e] - pil.x, t.w.ecs.z[t.e] - pil.z);
  const ahead = (t.w.ecs.x[t.e] - pil.x) * ux + (t.w.ecs.z[t.e] - pil.z) * uz;
  assert.ok(d >= pil.r + tuning.player.radius - 0.05 && ahead > 0, `stopped in front of it (${d.toFixed(2)})`);
});

test('Lluvia de plomo: R calls a zone at the cursor (≤ 9 u) that hits every 0.15 s for 1.5 s and erases bullets', () => {
  const { w, e, step } = pistols();
  const ecs = w.ecs;
  const d = w.debugSpawn('dummy', ecs.x[e] + 5, ecs.z[e] + 1, 0);
  const out = w.debugSpawn('dummy', ecs.x[e] + 5, ecs.z[e] + 6, 0);
  run(step, 4);
  ecs.riposte[e] = tuning.parry.riposte.max;
  const cx = ecs.x[e] + 5, cz = ecs.z[e];
  const evs = step({ prs: BTN.R, ax: cx, az: cz });
  const rain = evs.find((ev) => ev.type === 'rain');
  assert.ok(rain && Math.abs(rain.x - cx) < 1e-9 && rain.tick === w.tick - 1 + Math.round(R.delay / DT));
  assert.equal(ecs.riposte[e], 0);
  // A bullet drifting into the zone during the rain.
  evs.push(...run(step, 30));
  const b = w.nextPid++;
  w.hazards.spawn(b, PTYPE.PARRY, 0, cx + 5, ecs.y[e] + 1.1, cz, -6, 0, w.tick, 8, map);
  const rest = run(step, 120);
  const hits = dmgTo([...evs, ...rest], d);
  assert.equal(hits.length, Math.round(R.dur / R.every), `${hits.length} pulses`);
  assert.ok(hits.every((h) => h.kind === 'skill'));
  assert.equal(dmgTo(rest, out).length, 0, 'outside the zone');
  assert.ok(rest.some((ev) => ev.type === 'destroy' && ev.pid === b && ev.skill === 'rain'));
  assert.equal(ecs.rainT0[e], 0, 'over');
  // Aimed too far: it lands at the range limit.
  ecs.riposte[e] = tuning.parry.riposte.max;
  const far = step({ prs: BTN.R, ax: ecs.x[e] + 30, az: ecs.z[e] }).find((ev) => ev.type === 'rain');
  assert.ok(Math.abs(Math.hypot(far.x - ecs.x[e], far.z - ecs.z[e]) - R.range) < 0.2);
});

test('client prediction stays exact with the pistols: fire, blast, blink, rain, catches and releases', () => {
  const { server, client, deliver, shown, sp, se, ecs } = clientAndServer();
  setWeapon(server.world, se, WEAPON.PISTOLAS); // as if picked up at a rack
  for (let i = 0; i < 12; i++) { server.step(); deliver(); client.tickInput({ mx: 0, mz: 0, ax: sp.x, az: sp.z, btn: 0, prs: 0 }); }
  let maxErr = 0, shotsFired = 0;
  for (let i = 0; i < 900; i++) {
    if (i === 500) ecs.riposte[se] = tuning.parry.riposte.max; // the server fills the meter (client learns on reconcile)
    let prs = 0, btn = BTN.AIM;
    const ph = i % 300;
    if (ph < 90) btn |= BTN.ATTACK; // fire bursts
    else if (ph === 120) prs = BTN.Q;
    else if (ph === 180) prs = BTN.E;
    else if (ph > 200 && ph < 260) btn |= BTN.GUARD;
    if (i === 560) prs |= BTN.R;
    const mz = ph > 170 && ph < 190 ? 1 : 0;
    client.tickInput({ mx: 0, mz, ax: sp.x, az: sp.z, btn, prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 8; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  const pe = client.pred.ecs, me = client.youLocal;
  for (const k of ['hp', 'riposte', 'cdQ', 'cdE', 'x', 'z', 'shotN', 'rainT0']) assert.equal(pe[k][me], ecs[k][se], k);
  for (const ev of shown) if (ev.type === 'fire') shotsFired++;
  assert.ok(shotsFired >= 18, `${shotsFired} shots`);
  assert.ok(shown.filter((ev) => ev.type === 'fire').every((ev) => ev.predicted), 'shots shown from prediction');
  for (const t of ['blast', 'blink', 'rain']) assert.ok(shown.some((ev) => ev.type === t && ev.predicted), t);
  assert.ok(shown.some((ev) => ev.type === 'damage' && ev.by === client.youServer), 'the archer was hit');
  // Every server shot found its predicted copy: no duplicates on the client.
  let cl = 0, sv = 0;
  for (let s = 0; s < client.shots.cap; s++) if (client.shots.id[s] && !client.ending.has(s)) cl++;
  for (let s = 0; s < server.world.shots.cap; s++) if (server.world.shots.id[s]) sv++;
  assert.ok(cl <= sv + 2, `client shots ${cl} vs server ${sv}`);
});

// Headless playtest of La Prueba de Fuego (balance, PLAN-M3.md P7): a scripted player (god mode, but
// every hit is counted) parries, dashes through spikes and beams, steps out of circles, keeps off the
// lava and fights whatever is nearest. Usage: LV=5 SKILL=0.8 node tools/playtest.mjs
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { GAME } from '../src/data/meta.js';
import { DT, tuning } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { PTYPE, beamSeg, segDist, lavaR } from '../src/sim/projectiles.js';
const LV = +(process.env.LV || 5), SKILL = +(process.env.SKILL || 0.8);
const map = generateWorld(GAME.seed);
const w = new World(GAME.seed, { map, server: true });
w.populate();
const enc = w.encounters[0], ecs = w.ecs, H = w.hazards;
const e = w.spawnPlayer({ x: enc.cx, z: enc.cz, level: LV });
ecs.god[e] = 1;
let seq = 0, rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const bossDmg = {};
const stats = { dmg: 0, hits: 0, parry: 0, perfect: 0, dodge: 0, ghost: 0, graze: 0, bounce: 0, kills: 0, shotKills: 0, riposte: 0 };
const t0wave = {}; const log = []; const byKind = {};
const decided = new Set();
function policy() {
  const px = ecs.x[e], pz = ecs.z[e], pt = w.tick;
  let prs = 0, mx = 0, mz = 0, ax = px + 1, az = pz;
  // most imminent threat
  let best = -1, tb = 0.5;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt)) continue;
    const rx = px - H.px(s, pt), rz = pz - H.pz(s, pt), v2 = H.vx[s] ** 2 + H.vz[s] ** 2;
    const tca = (rx * H.vx[s] + rz * H.vz[s]) / v2;
    if (tca < 0 || tca > tb) continue;
    if (Math.hypot(rx - H.vx[s] * tca, rz - H.vz[s] * tca) > 0.36 + H.r[s] + 0.1) continue;
    best = s; tb = tca;
  }
  if (best >= 0 && !decided.has(H.id[best])) {
    decided.add(H.id[best]);
    const ok = rand() < SKILL;
    if (H.type[best] === PTYPE.UNSTOP || (H.type[best] === PTYPE.HEAVY)) {
      if (ok && ecs.dashCharges[e] >= 1) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
    } else if (ok && tb < 0.2) { prs |= 4; ax = H.px(best, pt); az = H.pz(best, pt); }
    else if (ok) decided.delete(H.id[best]);
  }
  // M3 hazards: a beam about to sweep over you → dash through it; a circle about to burst → step out.
  const SG = {};
  if (!(prs & 1)) for (const b of H.beams) {
    if (b.cancel || pt + 14 < b.tAct || pt > b.tEnd) continue;
    beamSeg(b, pt + 8, SG);
    const d = segDist(px, pz, SG.ax, SG.az, SG.bx, SG.bz, SG);
    if (d < b.w / 2 + 0.9 && rand() < SKILL && ecs.dashCharges[e] >= 1 && b.kind !== 'charge') {
      prs |= 1; const l = Math.max(d, 1e-3); mx = (SG.cx - px) / l; mz = (SG.cz - pz) / l; // through it
      if (d < 0.05) { mx = Math.cos(SG.ang); mz = -Math.sin(SG.ang); }
      break;
    }
    if (b.kind === 'charge' && d < b.w / 2 + 0.6) { const l = Math.max(d, 1e-3); mx = -(SG.cx - px) / l; mz = -(SG.cz - pz) / l; if (d < 0.05) { mx = Math.cos(SG.ang); mz = -Math.sin(SG.ang); } }
  }
  let inAoe = null;
  for (const a of H.aoes) if (!a.cancel && a.tAct > pt && a.tAct - pt < 40 && Math.hypot(px - a.x, pz - a.z) < a.r + 0.4) inAoe = a;
  if (inAoe && !(prs & 1) && rand() < SKILL + 0.15) { const dx = px - inAoe.x, dz = pz - inAoe.z, l = Math.hypot(dx, dz) || 1; mx = dx / l; mz = dz / l; }
  if (H.lava) { const dx = H.lava.cx - px, dz = H.lava.cz - pz, d = Math.hypot(dx, dz); if (d > lavaR(H.lava, pt) - 2.5) {
    // Inward with a sideways slide (straight lines get stuck on the rim pillars).
    const k = Math.sin(w.tick * 0.01) > 0 ? 0.8 : -0.8;
    mx = dx / d - (dz / d) * k; mz = dz / d + (dx / d) * k; inAoe = inAoe || {};
  } }
  // melee nearest grunt, otherwise drift toward the centre / around the boss
  let ne = 0, nd = 99;
  for (let o = 1; o < ecs.cap; o++) if (ecs.alive[o] && (ecs.mask[o] & C.ENEMY) && !ecs.dead[o] && ecs.brain[o]?.enc) { const d = Math.hypot(ecs.x[o] - px, ecs.z[o] - pz); if (d < nd) { nd = d; ne = o; } }
  if (!(prs & 5) && !inAoe) {
    if (ne && nd < 2) { ax = ecs.x[ne]; az = ecs.z[ne]; if (w.tick % 8 === 0) prs |= 2; }
    else if (ne && nd < 9) { const dx = ecs.x[ne] - px, dz = ecs.z[ne] - pz; mx = dx / nd; mz = dz / nd; ax = ecs.x[ne]; az = ecs.z[ne]; }
    else { const dx = enc.cx - px, dz = enc.cz - pz, d = Math.hypot(dx, dz); if (d > 4) { mx = dx / d; mz = dz / d; } }
  }
  if (ecs.riposte[e] >= 100 && best >= 0) prs |= 32;
  return { seq: ++seq, mx, mz, ax, az, prs, pt };
}
let boss = 0, end = 0;
const perf = { sum: 0, n: 0, max: 0, live: 0 };
for (let i = 0; i < 60 * 600 && !end; i++) {
  w.applyCommand(e, policy());
  const c0 = performance.now();
  w.stepWorld();
  const c1 = performance.now() - c0;
  perf.sum += c1; perf.n++; perf.max = Math.max(perf.max, c1);
  if (i % 10 === 0) { let live = 0; for (let s = 0; s < H.cap; s++) if (H.live(s, w.tick)) live++; perf.live = Math.max(perf.live, live); }
  for (const ev of w.events) {
    if (ev.type === 'damage' && ev.id === enc.bossE) { const k = 'p' + (ecs.brain[enc.bossE].phase + 1) + ':' + ev.kind; bossDmg[k] = (bossDmg[k] || 0) + ev.dmg; }
    if (ev.type === 'hurt' && ev.e === e) { stats.dmg += ev.raw; stats.hits++; const src = ev.kind === 'aoe' ? (H.aoes.find((a) => a.id === ev.src) || {}) : {};
      const who = src.owner && ecs.alive[src.owner] ? ['', 'ar', 'se', 'gr', 'im', 'sh', 'cr', 'HF'][ecs.enemy[src.owner] + 1] || '?' : src.keep ? 'shell' : '';
      const k = `${enc.st === 'boss' ? 'B' : 'W'}:${ev.kind}${who ? '/' + who : ''}`;
      byKind[k] = (byKind[k] || 0) + ev.raw; }
    else if (ev.type === 'parry' && ev.e === e) { stats.parry++; if (ev.perfect) stats.perfect++; }
    else if (ev.type === 'dodge') stats.dodge++; else if (ev.type === 'ghost') stats.ghost++; else if (ev.type === 'graze') stats.graze++;
    else if (ev.type === 'riposte') stats.riposte++;
    else if (ev.type === 'shot' && ev.from) stats.bounce++;
    else if (ev.type === 'kill') stats.kills++;
    else if (ev.type === 'phase') log.push(`${(w.tick * DT).toFixed(1)}s PHASE ${ev.phase}`);
    else if (ev.type === 'enc') { const k = ev.st + ev.wave; if (!t0wave[k]) { t0wave[k] = 1; log.push(`${(w.tick * DT).toFixed(1)}s ${ev.st} w${ev.wave + 1}`); } if (ev.st === 'victory') end = 1; }
  }
  w.events.length = 0;
}
console.log(`LV ${LV} skill ${SKILL}:`, log.join(' | '));
console.log('boss dmg by kind', JSON.stringify(bossDmg));
console.log(JSON.stringify(stats), 'dmg/HP', (stats.dmg / ecs.maxHp[e]).toFixed(1), 'by kind', JSON.stringify(byKind));
console.log(`step ${(perf.sum / perf.n).toFixed(3)} ms avg, ${perf.max.toFixed(2)} ms max · ${perf.live} live bullets max`);

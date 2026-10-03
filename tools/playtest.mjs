// Headless playtest of La Prueba de Fuego (balance, PLAN-M3.md P7, M3.5): a scripted player (god mode, but
// every hit is counted) reflects bullets with timed sword swings, catches heavy orbs with a perfect guard
// and throws them back, dashes through spikes and beams, steps out of circles, keeps off the lava and
// fights whatever is nearest. SKILL also blurs its timing. WEAPON=pistolas plays the flintlocks instead:
// it guards what comes at it (catching and firing it back), shoots from range, blasts what gets close,
// blinks out of circles and calls the lead rain on the boss. Both use their Q / E.
// Usage: LV=5 SKILL=0.8 [WEAPON=pistolas] node tools/playtest.mjs
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { GAME } from '../src/data/meta.js';
import { DT, tuning } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { PTYPE, beamSeg, segDist, lavaR } from '../src/sim/projectiles.js';
import { weaponIndex, SKILLS } from '../src/data/weapons.js';
const LV = +(process.env.LV || 5), SKILL = +(process.env.SKILL || 0.8), WEAPON = process.env.WEAPON || 'sable';
const PIST = WEAPON === 'pistolas';
const map = generateWorld(GAME.seed);
const w = new World(GAME.seed, { map, server: true });
w.populate();
const enc = w.encounters[0], ecs = w.ecs, H = w.hazards;
const e = w.spawnPlayer({ x: enc.cx, z: enc.cz, level: LV, weapon: weaponIndex(WEAPON) });
ecs.god[e] = 1;
let seq = 0, rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const bossDmg = {};
const stats = { dmg: 0, hits: 0, parry: 0, perfect: 0, good: 0, poor: 0, destroy: 0, block: 0, catch: 0, release: 0, broken: 0, dodge: 0, ghost: 0, graze: 0, bounce: 0, kills: 0, shotKills: 0, riposte: 0, fire: 0, cast: 0, rain: 0 };
let guardHold = 0;
const t0wave = {}; const log = []; const byKind = {};
const decided = new Set();
function policy() {
  const px = ecs.x[e], pz = ecs.z[e], pt = w.tick;
  let prs = 0, btn = 0, mx = 0, mz = 0, ax = px + 1, az = pz;
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
  // Swing when the bullet is this close (time to closest approach): ~EXCELENTE for a sharp player,
  // earlier (BUENO / POBRE / destroyed) the sloppier it gets.
  const swingAt = 0.17 + (1 - SKILL) * rand() * 0.18;
  if (best >= 0 && !decided.has(H.id[best])) {
    const ok = rand() < SKILL;
    if (H.type[best] === PTYPE.UNSTOP) {
      decided.add(H.id[best]);
      if (ok && ecs.dashCharges[e] >= 1) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
    } else if (PIST) {
      // Pistols: everything parryable or heavy goes to the guard, raised just before it lands.
      if (tb < 0.1) {
        decided.add(H.id[best]);
        if (ok) { guardHold = 12; ax = H.px(best, pt); az = H.pz(best, pt); }
        else if (ecs.dashCharges[e] >= 1 && rand() < 0.5) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
      }
    } else if (H.type[best] === PTYPE.HEAVY) {
      // Heavy orbs: catch them with a perfect guard (then the next swing throws them back), or dash.
      if (tb < 0.1) {
        decided.add(H.id[best]);
        if (ok) { guardHold = 14; ax = H.px(best, pt); az = H.pz(best, pt); }
        else if (ecs.dashCharges[e] >= 1) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
      }
    } else if (tb < swingAt) {
      decided.add(H.id[best]);
      if (ok || rand() < 0.5) { prs |= 2; ax = H.px(best, pt); az = H.pz(best, pt); }
    }
  }
  if (guardHold > 0) { guardHold--; btn |= 4; prs &= ~2; }
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
  if (inAoe && !(prs & 1) && rand() < SKILL + 0.15) {
    const dx = px - inAoe.x, dz = pz - inAoe.z, l = Math.hypot(dx, dz) || 1; mx = dx / l; mz = dz / l;
    if (PIST && ecs.cdE[e] <= 0 && inAoe.tAct - pt < 20) prs |= 16; // Paso de humo out of it
  }
  if (H.lava) { const dx = H.lava.cx - px, dz = H.lava.cz - pz, d = Math.hypot(dx, dz); if (d > lavaR(H.lava, pt) - 2.5) {
    // Inward with a sideways slide (straight lines get stuck on the rim pillars).
    const k = Math.sin(w.tick * 0.01) > 0 ? 0.8 : -0.8;
    mx = dx / d - (dz / d) * k; mz = dz / d + (dx / d) * k; inAoe = inAoe || {};
  } }
  // melee nearest grunt, otherwise drift toward the centre / around the boss
  let ne = 0, nd = 99;
  for (let o = 1; o < ecs.cap; o++) if (ecs.alive[o] && (ecs.mask[o] & C.ENEMY) && !ecs.dead[o] && ecs.brain[o]?.enc) { const d = Math.hypot(ecs.x[o] - px, ecs.z[o] - pz); if (d < nd) { nd = d; ne = o; } }
  // Caught bullets: throw them at the nearest enemy.
  if (!btn && ecs.catchN[e] > 0 && ne) { prs |= 2; ax = ecs.x[ne]; az = ecs.z[ne]; }
  if (PIST && ne) {
    // Shoot from range (keep 5–9 u), blast what gets close, rain on the boss with a full meter.
    if (!btn) { btn |= 2; ax = ecs.x[ne]; az = ecs.z[ne]; }
    if (!inAoe && !(prs & 1)) {
      const dx = ecs.x[ne] - px, dz = ecs.z[ne] - pz;
      if (nd < 4.5) { mx = -dx / nd; mz = -dz / nd; } else if (nd > 9) { mx = dx / nd; mz = dz / nd; }
      else { mx = -dz / nd * 0.6; mz = dx / nd * 0.6; } // strafe around it
      // ...but never out of La Caldera (leaving resets the trial).
      const cx = enc.cx - px, cz = enc.cz - pz, cd = Math.hypot(cx, cz);
      if (cd > 12) { mx = mx * 0.3 + (cx / cd) * 0.9; mz = mz * 0.3 + (cz / cd) * 0.9; }
    }
    if (nd < 3.5 && ecs.cdQ[e] <= 0 && !btn4()) { prs |= 8; ax = ecs.x[ne]; az = ecs.z[ne]; }
    if (ecs.riposte[e] >= 100) { prs |= 32; const t = enc.bossE && ecs.alive[enc.bossE] ? enc.bossE : ne; ax = ecs.x[t]; az = ecs.z[t]; }
    return { seq: ++seq, mx, mz, ax, az, btn, prs, pt };
  }
  // Cutlass skills: lunge into what is close, throw the crescent at what is farther.
  if (!PIST && ne && !btn && !(prs & 3)) {
    if (nd < 4.5 && ecs.cdQ[e] <= 0) { prs |= 8; ax = ecs.x[ne]; az = ecs.z[ne]; }
    else if (nd > 3 && nd < 10 && ecs.cdE[e] <= 0) { prs |= 16; ax = ecs.x[ne]; az = ecs.z[ne]; }
  }
  if (!(prs & 3) && !btn && !inAoe) {
    if (ne && nd < 2) { ax = ecs.x[ne]; az = ecs.z[ne]; if (w.tick % 8 === 0) prs |= 2; }
    else if (ne && nd < 9) { const dx = ecs.x[ne] - px, dz = ecs.z[ne] - pz; mx = dx / nd; mz = dz / nd; ax = ecs.x[ne]; az = ecs.z[ne]; }
    else { const dx = enc.cx - px, dz = enc.cz - pz, d = Math.hypot(dx, dz); if (d > 4) { mx = dx / d; mz = dz / d; } }
  }
  if (ecs.riposte[e] >= 100 && best >= 0) prs |= 32;
  return { seq: ++seq, mx, mz, ax, az, btn, prs, pt };
}
function btn4() { return guardHold > 0; }
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
    else if (ev.type === 'parry' && ev.e === e) { stats.parry++; if (ev.tier === 3) stats.perfect++; else if (ev.tier === 2) stats.good++; else stats.poor++; }
    else if (ev.type === 'destroy' && ev.e === e) stats.destroy++;
    else if (ev.type === 'guard' && ev.e === e) { if (ev.st === 'block') stats.block++; else if (ev.st === 'perfect') stats.catch++; else if (ev.st === 'break') stats.broken++; }
    else if (ev.type === 'release') stats.release++;
    else if (ev.type === 'dodge') stats.dodge++; else if (ev.type === 'ghost') stats.ghost++; else if (ev.type === 'graze') stats.graze++;
    else if (ev.type === 'riposte') stats.riposte++;
    else if (ev.type === 'fire') stats.fire++;
    else if (ev.type === 'cast' || ev.type === 'blink') stats.cast++;
    else if (ev.type === 'rain') stats.rain++;
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

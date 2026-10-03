// The scripted Prueba de Fuego player (PLAN-M3.md P7, M3.5, M3.6 P5), shared by tools/playtest.mjs (it reads the
// server world) and tools/nettest.mjs (it reads what one client sees over the network: its predicted self, the
// projectiles at its projectile tick, the enemies as interpolated). It reflects bullets with timed sword swings,
// catches heavy orbs with a perfect guard and throws them back, dashes through spikes and beams, steps out of
// circles, keeps off the lava and fights whatever is nearest. SKILL blurs its timing. 'pistolas' guards what
// comes at it (catching and firing it back), shoots from range, blasts what gets close, blinks out of circles
// and calls the lead rain on the boss. Both use their Q / E.
//
// view = { px, pz, pt, tick, H, me: {dashCharges, cdQ, cdE, riposte, catchN}, enemies: [{x, z}], enc: {cx, cz},
//          boss: {x, z} | null }  →  {mx, mz, ax, az, btn, prs}
import { PTYPE, beamSeg, segDist, lavaR } from '../src/sim/projectiles.js';

export function makeBrain({ weapon = 'sable', skill = 0.8, seed = 12345 } = {}) {
  const PIST = weapon === 'pistolas', SKILL = skill;
  let rnd = seed, guardHold = 0;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const decided = new Set();
  const SG = {};

  return function policy(v) {
    const { px, pz, pt, H, me, enc } = v;
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
        if (ok && me.dashCharges >= 1) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
      } else if (PIST) {
        // Pistols: everything parryable or heavy goes to the guard, raised just before it lands.
        if (tb < 0.1) {
          decided.add(H.id[best]);
          if (ok) { guardHold = 12; ax = H.px(best, pt); az = H.pz(best, pt); }
          else if (me.dashCharges >= 1 && rand() < 0.5) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
        }
      } else if (H.type[best] === PTYPE.HEAVY) {
        // Heavy orbs: catch them with a perfect guard (then the next swing throws them back), or dash.
        if (tb < 0.1) {
          decided.add(H.id[best]);
          if (ok) { guardHold = 14; ax = H.px(best, pt); az = H.pz(best, pt); }
          else if (me.dashCharges >= 1) { prs |= 1; const vx = H.vx[best], vz = H.vz[best], l = Math.hypot(vx, vz); mx = -vz / l; mz = vx / l; }
        }
      } else if (tb < swingAt) {
        decided.add(H.id[best]);
        if (ok || rand() < 0.5) { prs |= 2; ax = H.px(best, pt); az = H.pz(best, pt); }
      }
    }
    if (decided.size > 100000) decided.clear();
    if (guardHold > 0) { guardHold--; btn |= 4; prs &= ~2; }
    // M3 hazards: a beam about to sweep over you → dash through it; a circle about to burst → step out.
    if (!(prs & 1)) for (const b of H.beams) {
      if (b.cancel || pt + 14 < b.tAct || pt > b.tEnd) continue;
      beamSeg(b, pt + 8, SG);
      const d = segDist(px, pz, SG.ax, SG.az, SG.bx, SG.bz, SG);
      if (d < b.w / 2 + 0.9 && rand() < SKILL && me.dashCharges >= 1 && b.kind !== 'charge') {
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
      if (PIST && me.cdE <= 0 && inAoe.tAct - pt < 20) prs |= 16; // Paso de humo out of it
    }
    if (H.lava) { const dx = H.lava.cx - px, dz = H.lava.cz - pz, d = Math.hypot(dx, dz); if (d > lavaR(H.lava, pt) - 2.5) {
      // Inward with a sideways slide (straight lines get stuck on the rim pillars).
      const k = Math.sin(v.tick * 0.01) > 0 ? 0.8 : -0.8;
      mx = dx / d - (dz / d) * k; mz = dz / d + (dx / d) * k; inAoe = inAoe || {};
    } }
    // melee nearest grunt, otherwise drift toward the centre / around the boss
    let ne = null, nd = 99;
    for (const o of v.enemies) { const d = Math.hypot(o.x - px, o.z - pz); if (d < nd) { nd = d; ne = o; } }
    // Caught bullets: throw them at the nearest enemy.
    if (!btn && me.catchN > 0 && ne) { prs |= 2; ax = ne.x; az = ne.z; }
    if (PIST && ne) {
      // Shoot from range (keep 5–9 u), blast what gets close, rain on the boss with a full meter.
      if (!btn) { btn |= 2; ax = ne.x; az = ne.z; }
      if (!inAoe && !(prs & 1)) {
        const dx = ne.x - px, dz = ne.z - pz;
        if (nd < 4.5) { mx = -dx / nd; mz = -dz / nd; } else if (nd > 9) { mx = dx / nd; mz = dz / nd; }
        else { mx = -dz / nd * 0.6; mz = dx / nd * 0.6; } // strafe around it
        // ...but never out of La Caldera (leaving resets the trial).
        const cx = enc.cx - px, cz = enc.cz - pz, cd = Math.hypot(cx, cz);
        if (cd > 12) { mx = mx * 0.3 + (cx / cd) * 0.9; mz = mz * 0.3 + (cz / cd) * 0.9; }
      }
      if (nd < 3.5 && me.cdQ <= 0 && !(guardHold > 0)) { prs |= 8; ax = ne.x; az = ne.z; }
      if (me.riposte >= 100) { prs |= 32; const t = v.boss || ne; ax = t.x; az = t.z; }
      return { mx, mz, ax, az, btn, prs };
    }
    // Cutlass skills: lunge into what is close, throw the crescent at what is farther.
    if (!PIST && ne && !btn && !(prs & 3)) {
      if (nd < 4.5 && me.cdQ <= 0) { prs |= 8; ax = ne.x; az = ne.z; }
      else if (nd > 3 && nd < 10 && me.cdE <= 0) { prs |= 16; ax = ne.x; az = ne.z; }
    }
    if (!(prs & 3) && !btn && !inAoe) {
      if (ne && nd < 2) { ax = ne.x; az = ne.z; if (v.tick % 8 === 0) prs |= 2; }
      else if (ne && nd < 9) { const dx = ne.x - px, dz = ne.z - pz; mx = dx / nd; mz = dz / nd; ax = ne.x; az = ne.z; }
      else { const dx = enc.cx - px, dz = enc.cz - pz, d = Math.hypot(dx, dz); if (d > 4) { mx = dx / d; mz = dz / d; } }
    }
    if (me.riposte >= 100 && best >= 0) prs |= 32;
    return { mx, mz, ax, az, btn, prs };
  };
}

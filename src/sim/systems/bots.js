// Server-side bot "players": they produce the same commands a human would and go through the same
// movement pipeline, so the client can't tell them apart.
import { BTN } from './movement.js';

export const BOT_NAMES = [
  'Xochi_Marea', 'ElKraken99', 'Marisol', 'PataDePalo', 'Capi_Rubí', 'Ñandú', 'Bruma', 'Coralito',
];

export function makeBotBrain(rng) {
  return { target: -1, wait: rng.range(0.5, 3), walk: rng.range(0.45, 0.8), nextDash: rng.range(8, 20) };
}

const out = { mx: 0, mz: 0, prs: 0, btn: 0 };

export function botCommand(world, e, dt) {
  const ecs = world.ecs, brain = ecs.bot[e], wps = world.map.botWaypoints, rng = world.rng;
  out.mx = 0; out.mz = 0; out.prs = 0; out.btn = 0;
  if (brain.wait > 0) {
    brain.wait -= dt;
    if (brain.wait <= 0) {
      let next = rng.int(0, wps.length - 1);
      if (next === brain.target) next = (next + 1) % wps.length;
      brain.target = next;
      brain.walk = rng.range(0.45, 0.85);
    }
    return out;
  }
  const wp = wps[brain.target];
  const dx = wp.x - ecs.x[e], dz = wp.z - ecs.z[e];
  const d = Math.hypot(dx, dz);
  if (d < 1.2 || brain.stuck > 2.5) {
    brain.wait = rng.range(1.5, 6);
    brain.stuck = 0;
    return out;
  }
  // Detect getting stuck behind props.
  const sp = Math.hypot(ecs.vx[e], ecs.vz[e]);
  brain.stuck = sp < 0.4 ? (brain.stuck || 0) + dt : 0;
  out.mx = (dx / d) * brain.walk;
  out.mz = (dz / d) * brain.walk;
  brain.nextDash -= dt;
  if (brain.nextDash <= 0 && d > 8) {
    out.prs |= BTN.DASH;
    brain.nextDash = rng.range(10, 25);
  }
  return out;
}

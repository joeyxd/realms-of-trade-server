// Melee hit formulas, with launch projected onto the ground plane.
export const knockback = (p, d, w, bkb, kbg, r = 1) =>
  ((((p / 10 + p * d / 20) * 200 / (w + 100) * 1.4) + 18) * kbg / 100 + bkb) * r;
export const hitlagFrames = (d) => Math.min(20, Math.floor(d / 3 + 3));
export const hitstunFrames = (kb) => Math.floor(0.4 * kb);
export const launchSpeed = (kb, unit) => kb * 0.03 * unit * 60;
export const launchDecay = (unit) => 0.051 * unit * 60;
// Frames the launch slides before it stops (speed kb * 0.03 per frame, minus 0.051 each frame).
export const launchFrames = (kb) => Math.ceil(kb * 0.03 / 0.051);
// Melee percent of `hp` points: per `stamina` HP at least, so a 24-HP grunt is not at 40 percent after one jab.
export const meleePercent = (hp, maxHp, stamina) => 100 * hp / Math.max(maxHp, stamina);
// Seconds a hit locks its victim after the hitlag: the hitstun, or a tumble (KB at or over `tumble`) slides all the
// way and then lies `down` s on the ground (the fall on the back plus the get-up).
export const meleeStun = (kb, hs, tumble, down) => kb >= tumble ? Math.max(hs, launchFrames(kb)) / 60 + down : hs / 60;

export function di(vx, vz, sx, sz, maxDeg = 18) {
  const speed = Math.hypot(vx, vz);
  if (speed === 0) return { vx: 0, vz: 0 };
  const stick = Math.hypot(sx, sz);
  if (stick > 1) { sx /= stick; sz /= stick; }
  const cross = vx * sz - vz * sx;
  const q = Math.sign(cross) * cross * cross / (speed * speed);
  const angle = Math.atan2(vz, vx) + maxDeg * Math.PI / 180 * q;
  return { vx: speed * Math.cos(angle), vz: speed * Math.sin(angle) };
}

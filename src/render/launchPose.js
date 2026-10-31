// Melee damage reactions on the view (MN_MELEE): the victim shakes through the hitlag; a body drawn late (remote, by
// INTERP_DELAY) has its launch led by that delay, so it flies on the frame its attacker thaws; a tumble (KB at or over
// LAWLESS.meleeTumble) throws it off its feet, onto its back for the slide and up again. Render only: the sim's
// launch moves the body, this adds what the eye needs on top of it. Pure math, shared by CharacterView and DummyView.
import { LAWLESS } from '../data/lawless.js';
import { launchFrames } from '../sim/meleeHit.js';

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const LIE = 1.45; // rad: on the back, a little off the floor
const ELEC = 3; // the lightning element (Perla de Tormenta)

// Ultimate's hitlag shake (battle_object.prc.txt shake_data_param, docs/research/melee/11-ultimate-feel.md): offsets in
// Ultimate units (times LAWLESS.meleeUnit on the view), x along the blow, y up, played at `rate` entries per frame
// (inferred from shaker_rate: 2 on the damage tables, 1 on the attack table whose entries come in pairs). damage is
// damage_ground and damage_air (the same numbers), elec damage_elec, attack the attacker's attack_ground.
export const SHAKE = {
  damage: { rate: 2, x: [2, 0, -2], y: [0, 0, 0] },
  elec: { rate: 1, x: [0, 2, -1, 0, 0.2], y: [0, 1, 0, 5, 0] },
  attack: { rate: 1, x: [1, 1, -1, -1], y: [0, 0, 0, 0] },
};
// Entry of table T on frame F (frames since the hit).
export const shakeIndex = (T, F) => Math.floor(Math.max(0, F) * T.rate + 1e-6) % T.x.length;

// Melee units slid f frames after the hitlag (kb * 0.03 per frame, minus 0.051 each frame, as the sim moves it;
// exact on whole frames).
export function slid(kb, f) {
  const s0 = kb * 0.03, n = Math.min(Math.max(0, f), launchFrames(kb));
  return s0 * n - 0.0255 * n * (n - 1);
}

// ev: a hurt, damage or duel event of a Melee hit (kb, hl, la the launch angle, kd a tumble); lead: s drawn late. Or a
// shield-break reaction: a guard 'break' event (hl, fly, down, stand frames, h the peak height in u) plus brk: 1 and la,
// the direction the body falls toward; it starts after the hitlag and the lead.
export function startLaunch(ev, lead = 0) {
  if (ev && ev.brk && Number.isFinite(ev.la)) return { brk: true, hl: ev.hl | 0, fly: ev.fly, down: ev.down, stand: ev.stand, h: ev.h, dx: Math.cos(ev.la), dz: Math.sin(ev.la), lead, t: 0 };
  if (!(ev && ev.kb > 0)) return null;
  const a = Number.isFinite(ev.la) ? ev.la : null;
  return { kb: ev.kb, hl: ev.hl | 0, kd: !!ev.kd, dx: a === null ? 0 : Math.cos(a), dz: a === null ? 0 : Math.sin(a),
    lead: a === null ? 0 : lead, n: launchFrames(ev.kb), down: LAWLESS.meleeDown * 60, t: 0, shake: ev.elem === ELEC ? SHAKE.elec : SHAKE.damage };
}

// The attacker's side of a Melee hit: frozen for the hitlag too, it shakes along its own facing (SHAKE.attack).
export const startAtkShake = (hl) => (hl > 0 ? { hl, t: 0 } : null);
// Advances A by dt (s): the offset in u along the facing, or null once the hitlag is over.
export function stepAtkShake(A, dt) {
  A.t += dt;
  const F = A.t * 60 + 1e-6;
  return F >= A.hl ? null : SHAKE.attack.x[shakeIndex(SHAKE.attack, F)] * LAWLESS.meleeUnit;
}

// The shield break: thrown up (a parabola: 28 of 60 frames up, the rest down: ours, from Ultimate's air_accel_y and fall cap)
// while tipping onto its back, lying there for `down` frames, then standing up (smooth) over `stand`. The body stays put.
function stepBreak(L, dt, out) {
  L.t += dt;
  const f = L.t * 60 - L.hl - L.lead * 60;
  if (f > L.fly + L.down + L.stand + 1e-6) return null;
  let lift = 0, tilt = 0;
  if (f >= 0 && f < L.fly) {
    const up = L.fly * 28 / 60, q = f < up ? (up - f) / up : (f - up) / (L.fly - up);
    lift = L.h * (1 - q * q); tilt = LIE * smooth(f / L.fly);
  } else if (f >= L.fly) { tilt = LIE * (1 - smooth((f - L.fly - L.down) / L.stand)); lift = 0.12 * Math.sin(tilt); }
  out.ox = 0; out.oz = 0; out.lift = lift; out.tilt = tilt; out.dx = L.dx; out.dz = L.dz;
  return out;
}

// Advances L by dt (s). out gets { ox, oz, lift, tilt, dx, dz }: offset and lift in u, tilt in rad toward (dx, dz).
// Returns out, or null once the reaction is over.
export function stepLaunch(L, dt, out = {}) {
  if (L.brk) return stepBreak(L, dt, out);
  L.t += dt;
  const F = L.t * 60, f = F - L.hl, lead = L.lead * 60, k = Math.min(1, L.kb / LAWLESS.meleeTumble);
  if (f > L.n + Math.max(lead, L.kd ? L.down : 0) + 2) return null;
  let along, lift = 0, tilt;
  if (f < 0) {
    // Hitlag: frozen in the blow, a little snapped back, shaking by Ultimate's table along the launch (and up, lightning).
    const S = L.shake || SHAKE.damage, i = shakeIndex(S, F);
    along = S.x[i] * LAWLESS.meleeUnit; lift = S.y[i] * LAWLESS.meleeUnit;
    tilt = 0.18 * k;
  } else {
    along = LAWLESS.meleeUnit * (slid(L.kb, f) - slid(L.kb, f - lead));
    if (L.kd) {
      // Tumble: off the feet over the first 40 % of the slide, onto the back, lie there, then stand up.
      const up = 0.4 * L.n, p = f / up;
      lift = p < 1 ? Math.min(0.6, 0.2 + L.kb / 400) * 4 * p * (1 - p) : 0;
      const g = f - L.n, rise = g > 0.4 * L.down ? smooth((g - 0.4 * L.down) / (0.6 * L.down)) : 0;
      tilt = LIE * smooth(p) * (1 - rise);
      lift += 0.12 * Math.sin(tilt);
    } else tilt = 0.32 * k * (1 - smooth(f / Math.max(1, L.n))); // pushed back on the feet, easing upright
  }
  out.ox = L.dx * along; out.oz = L.dz * along; out.lift = lift; out.tilt = L.dx || L.dz ? tilt : 0; out.dx = L.dx; out.dz = L.dz;
  return out;
}

// The axis (in a body's own frame, yaw f) that tips its top toward the world direction (dx, dz) for a positive angle.
export function tiltAxis(f, dx, dz, out) {
  const c = Math.cos(f), s = Math.sin(f), lx = dx * c - dz * s, lz = dx * s + dz * c;
  return out.set(lz, 0, -lx);
}

// Character looks: adult proportions (~6.5 heads, slightly large heads and hands so they read from
// the isometric camera), layered outfits (hood + cowl, coat, vest, belts, straps, bracers, boots
// with cuffs), earthy palettes and faceted low-poly shading. One merged skinned geometry per look.
import { Builder, B, joints, loft, tbox, box, spike, ico, wedge, blade, ribbon, xf, seam, toward, sstep } from './charkit.js';

// ---- Body proportions (u ≈ m), bind pose with the arms hanging -----------------------------------
const BODY = {
  male: {
    hip: 0.93, knee: 0.5, waist: 1.0, chest: 1.2, shY: 1.47, shX: 0.205, elbow: 1.15, wrist: 0.89, neck: 1.565, legX: 0.095,
    head: 1, hand: 1, belt: [0.158, 0.116],
    leg: [0.086, 0.054, 0.056, 0.036], arm: [0.056, 0.052, 0.044, 0.046, 0.033],
    torso: [[0.98, 0.134, 0.095], [1.1, 0.14, 0.1], [1.22, 0.158, 0.11, 0.008], [1.31, 0.17, 0.114, 0.008], [1.39, 0.174, 0.112, 0.006], [1.465, 0.155, 0.096], [1.53, 0.07, 0.06, -0.005]],
    pelvis: [[0.84, 0.142, 0.1], [0.93, 0.154, 0.106], [1.03, 0.14, 0.099]],
  },
  female: {
    hip: 0.9, knee: 0.485, waist: 0.99, chest: 1.16, shY: 1.4, shX: 0.178, elbow: 1.1, wrist: 0.86, neck: 1.5, legX: 0.09,
    head: 0.95, hand: 0.9, belt: [0.142, 0.104],
    leg: [0.088, 0.05, 0.052, 0.033], arm: [0.046, 0.042, 0.036, 0.037, 0.028],
    torso: [[0.97, 0.122, 0.088], [1.06, 0.112, 0.082], [1.17, 0.13, 0.104, 0.012], [1.25, 0.144, 0.104, 0.012], [1.32, 0.146, 0.098, 0.008], [1.395, 0.13, 0.086], [1.46, 0.06, 0.052, -0.004]],
    pelvis: [[0.81, 0.142, 0.1], [0.9, 0.16, 0.108], [1.0, 0.126, 0.09]],
  },
  brute: {
    hip: 0.98, knee: 0.53, waist: 1.08, chest: 1.3, shY: 1.62, shX: 0.3, elbow: 1.28, wrist: 0.99, neck: 1.72, legX: 0.13,
    head: 1, hand: 1.5,
  },
};

// Head rings (head-local, y up from the neck pivot): [y, rx, rz, z].
const HEAD = {
  male: [[-0.02, 0.05, 0.055, 0], [0.015, 0.045, 0.045, 0.065], [0.05, 0.08, 0.085, 0.03], [0.095, 0.094, 0.1, 0.015], [0.145, 0.1, 0.108, 0.005], [0.19, 0.103, 0.112, -0.005], [0.235, 0.094, 0.106, -0.012], [0.275, 0.066, 0.08, -0.02], [0.295, 0.025, 0.03, -0.025]],
  female: [[-0.02, 0.046, 0.05, 0], [0.02, 0.034, 0.034, 0.062], [0.055, 0.07, 0.076, 0.032], [0.098, 0.088, 0.097, 0.015], [0.145, 0.097, 0.106, 0.004], [0.19, 0.1, 0.11, -0.005], [0.235, 0.092, 0.105, -0.012], [0.275, 0.064, 0.079, -0.02], [0.295, 0.024, 0.03, -0.025]],
};

// Front surface z of a head (rings above) at local (x, y): between the θ = 0 and θ = 45° vertices.
function faceZ(rings, y, x) {
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1][0] < y) i++;
  const a = rings[i], b = rings[i + 1], t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  const rx = L(1), rz = L(2), z0 = L(3);
  const zf = z0 + rz, x45 = rx * Math.SQRT1_2, z45 = z0 + rz * Math.SQRT1_2;
  return zf + (z45 - zf) * Math.min(1, Math.abs(x) / x45);
}
const ringsOf = (arr, s = 1) => arr.map(([y, rx, rz, z = 0]) => ({ y: y * s, rx: rx * s, rz: rz * s, z: z * s }));
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ---- Looks ----------------------------------------------------------------------------------------
// Player looks 0–4 (the server clamps the choice to 0–4), NPCs 5–6, enemy 7.
export const LOOKS = [
  {
    name: 'Corsario', body: 'male', accent: 0x8fd3ff, swatch: [0x3b3e45, 0x6e3f2c],
    skin: 0xc8946e, hair: 0x2e211a, beard: 0x34261d, beardStyle: 'full', hairStyle: 'short',
    headwear: 'hood', hood: 0x4d5159, hoodIn: 0x15161a, mantle: 'cowl', neck: 'scarf', scarf: 0x8c8374,
    torso: 'vest', shirt: 0xd8cbb0, vest: 0x6e3f2c, sleeves: 'shirt', bracer: 0x5a3424, glove: 0x352520,
    lower: 'coat', coat: 0x6a3a2a, coatIn: 0x3a2219, pants: 0x3e4131, boots: 'cuffed', boot: 0x5a3527,
    belts: [{ dy: 0.02, c: 0x2b1e18, buckle: 1 }, { dy: -0.06, c: 0x3d2a20, tilt: 0.12, buckle: 1, pouches: true }],
    bandolier: 0x3d2a20, metal: 0xa5adb0, weapon: 'cutlass',
  },
  {
    name: 'Exploradora', body: 'female', accent: 0x9be8b6, swatch: [0x47705a, 0xd8a892],
    skin: 0xe9bf9f, hair: 0xd8a892, hairStyle: 'long', ears: 'elf', lips: 0xb0665e,
    neck: 'collar', collar: 0x3e6b58, gem: 0x63f0c8,
    torso: 'corset', shirt: 0xe9e3d6, vest: 0x6a3d29, lacing: 0xc9ae88, sleeves: 'puffy', bracer: 0x5a3626, glove: 0x4a2e20,
    pauldrons: 0x8d9a9f, lower: 'tassets', skirt: 0x47705a, flap: 0x6a4330, pants: 0x3b2b24, legStraps: 0x5e3d2a,
    boots: 'tall', boot: 0x6b4630, kneeGuard: 0x8d9a9f,
    belts: [{ dy: 0.0, c: 0x4a2e20, buckle: 1 }, { dy: -0.09, c: 0x5a3626, tilt: -0.14, pouches: true }],
    metal: 0xb7c0c3, weapon: 'saber',
  },
  {
    name: 'Bucanero', body: 'male', accent: 0xff9a6c, swatch: [0x2e3a4e, 0x8e2b2b],
    skin: 0x7a4a33, hair: 0x15110f, beard: 0x15110f, beardStyle: 'full', hairStyle: 'tied',
    headwear: 'bandana', band: 0x8e2b2b, neck: 'none',
    torso: 'coat', shirt: 0xe4dccb, vest: 0x2e3a4e, trim: 0xb39250, sleeves: 'coat', cuff: 0x243045, glove: null,
    lower: 'coat', coat: 0x2e3a4e, coatIn: 0x1b2230, pants: 0x2b2a2f, boots: 'cuffed', boot: 0x231c19,
    belts: [{ dy: 0.01, c: 0x8e2b2b, sash: true }, { dy: -0.07, c: 0x2a1d17, tilt: -0.1, buckle: 1 }],
    metal: 0xb39250, weapon: 'cutlass',
  },
  {
    name: 'Tormenta', body: 'female', accent: 0x86f0e6, swatch: [0x3f5c60, 0x34393f],
    skin: 0xd9a888, hair: 0x5a2a22, hairStyle: 'long', lips: 0x9a5a52,
    headwear: 'hood', hood: 0x4a6d71, hoodIn: 0x121718, mantle: 'cowl', neck: 'scarf', scarf: 0x5d6b6c,
    torso: 'corset', shirt: 0x8f9597, vest: 0x40302a, lacing: 0x8a7b6a, sleeves: 'shirt', bracer: 0x3a2c26, glove: 0x2a2220,
    lower: 'coat', coat: 0x34393f, coatIn: 0x1d2024, pants: 0x2c2e33, boots: 'tall', boot: 0x2e2522,
    belts: [{ dy: 0.0, c: 0x2a2220, buckle: 1, pouches: true }], bandolier: 0x2a2220,
    metal: 0xa9b4b8, weapon: 'saber',
  },
  {
    name: 'Brasa', body: 'male', accent: 0xffb24d, swatch: [0x5a3424, 0x8c3f22], heavy: 1.06,
    skin: 0xd59a76, hair: 0x6b3a26, beard: 0x8c3f22, beardStyle: 'full', hairStyle: 'shaved',
    neck: 'none', mantle: 'fur', fur: 0x6f6152,
    torso: 'sleeveless', vest: 0x4e2f22, shirt: 0x4e2f22, sleeves: 'bare', bracer: 0x4a2c20, glove: 0x3a2620,
    lower: 'flaps', flap: 0x4a2e22, pants: 0x3a3330, boots: 'short', boot: 0x3a2a22,
    belts: [{ dy: 0.01, c: 0x7a2422, sash: true }, { dy: -0.05, c: 0x2a1d17, tilt: 0.1, buckle: 1, pouches: true }],
    bandolier: 0x2a1d17, metal: 0x9aa2a5, weapon: 'cutlass',
  },
  {
    name: 'Capitana', body: 'female', accent: 0xffc23d, swatch: [0x7a2630, 0x23202a], npc: true,
    skin: 0xd8a27c, hair: 0x9a3b25, hairStyle: 'braid', lips: 0xa0544e,
    headwear: 'tricorn', hat: 0x23202a, neck: 'cravat',
    torso: 'coat', shirt: 0xeee8dc, vest: 0x7a2630, trim: 0xc9a24a, sleeves: 'coat', cuff: 0x5e1c25, glove: null,
    lower: 'coat', coat: 0x7a2630, coatIn: 0x3d1218, hem: 0.42, pants: 0x262330, boots: 'tall', boot: 0x1e1a1c,
    belts: [{ dy: 0.0, c: 0x1e1a1c, buckle: 2 }],
    metal: 0xc9a24a, weapon: null,
  },
  {
    name: 'Vendedora', body: 'female', accent: 0x7be0a1, swatch: [0xc4622d, 0x5f6a3c], npc: true, heavy: 1.16,
    skin: 0x8d5c40, hair: 0x9a948c, hairStyle: 'bun', lips: 0x7a4a3c,
    headwear: 'headscarf', band: 0xc4622d, neck: 'none', mantle: 'shawl', shawl: 0xa4503a,
    torso: 'blouse', shirt: 0xd8b07a, vest: 0xd8b07a, sleeves: 'blouse', glove: null,
    lower: 'dress', skirt: 0x5f6a3c, apron: 0xe2d6bc, pants: 0x5f6a3c, boots: 'short', boot: 0x3a2a22,
    belts: [], metal: 0xb39250, weapon: null,
  },
  {
    name: 'Centinela', body: 'brute', accent: 0x6ff0ff, swatch: [0xe6dcc6, 0x3c566a], enemy: true,
    bone: 0xe6dcc6, slate: 0x3c566a, slateD: 0x26394a, gold: 0xd09a3c, ice: 0xa6e8f4, gemC: 0x5ff0ff, socket: 0x131118,
    weapon: 'greatsword',
  },
  {
    name: 'Arquero', body: 'male', accent: 0x8dffb0, swatch: [0xd8cdb4, 0x7a2428], enemy: true, archer: true,
    bone: 0xd8cdb4, cloth: 0x7a2428, clothD: 0x4a171c, leather: 0x5a3a26, leatherD: 0x3a2418, metal: 0xa08c62, gemC: 0x8dffb0, socket: 0x131118,
    wood: 0x6a4428, weapon: 'bow',
  },
  // ---- M2.5 «La Prueba de Fuego»: palette swaps of the two skeleton builders ----
  {
    name: 'Grumete ahogado', body: 'male', accent: 0x6affd8, swatch: [0xb4b8a0, 0x2f5a4a], enemy: true, skel: 'light', scale: 0.84,
    bone: 0xb4b8a0, cloth: 0x2f5a4a, clothD: 0x1d3a30, leather: 0x4a3a2a, leatherD: 0x2e241a, metal: 0x8a8a7a, gemC: 0x6affd8, socket: 0x101614,
    weapon: 'cutlass',
  },
  {
    name: 'Diablillo de fuego', body: 'male', accent: 0xffa030, swatch: [0x6a2a20, 0xff7a2a], enemy: true, skel: 'light', scale: 0.72, hover: true,
    bone: 0x6a2e24, cloth: 0x9a3014, clothD: 0x4a140a, leather: 0x3a1a12, leatherD: 0x24100a, metal: 0xd07a30, gemC: 0xffb040, socket: 0x120806,
    horns: 0x24120e, hornK: 1.7, weapon: null,
  },
  {
    name: 'Chamán de coral', body: 'male', accent: 0x5ff0e0, swatch: [0xe8d8c8, 0xd8604a], enemy: true, skel: 'light', scale: 1.02,
    bone: 0xe8dcc8, cloth: 0xd8604a, clothD: 0x7a2a2a, leather: 0x2a6a6a, leatherD: 0x1a4446, metal: 0x5fd0c0, gemC: 0x5ff0e0, socket: 0x101418,
    horns: 0xf08a70, weapon: 'staff',
  },
  {
    name: 'HELLFIRE', body: 'brute', accent: 0xff7a2a, swatch: [0x5a4a42, 0xd8642a], enemy: true, boss: true, scale: 1.75,
    bone: 0x5e4c44, slate: 0x2a1814, slateD: 0x160c0a, gold: 0xd8642a, ice: 0xff8a3a, gemC: 0xffb040, socket: 0x0d0606,
    horns: 0x1a0e0c, weapon: 'greatsword',
  },
];

// ---- Shared pieces --------------------------------------------------------------------------------
const side = (s, l, r) => (s > 0 ? l : r);

function legW(R, s) {
  const th = side(s, B.thighL, B.thighR), sh = side(s, B.shinL, B.shinR);
  return (x, y) => {
    const h = sstep(R.hip - 0.04, R.hip + 0.07, y), u = sstep(R.knee - 0.06, R.knee + 0.06, y);
    return [[B.hips, h], [th, (1 - h) * u], [sh, (1 - h) * (1 - u)]];
  };
}
function armW(R, s) {
  const a = side(s, B.armL, B.armR), f = side(s, B.foreL, B.foreR);
  return (x, y) => {
    const c = sstep(R.shY - 0.01, R.shY + 0.06, y) * 0.55, u = sstep(R.elbow - 0.05, R.elbow + 0.05, y);
    return [[B.chest, c], [a, (1 - c) * u], [f, (1 - c) * (1 - u)]];
  };
}
const torsoW = (R) => (x, y) => {
  const h = 1 - sstep(R.waist - 0.02, R.waist + 0.05, y), u = sstep(R.chest - 0.08, R.chest + 0.08, y);
  return [[B.hips, h], [B.chest, (1 - h) * u], [B.spine, (1 - h) * (1 - u)]];
};
// Long cloth below the waist: front panels ride the thighs, the back follows the trailing cloth bone.
const skirtW = (top, hem, { thigh = 0.9, back = 0.8, front = B.hips } = {}) => (x, y, z) => {
  const t = sstep(top - 0.05, hem, y), r = Math.hypot(x, z) || 1, fr = z / r;
  const th = t * Math.min(1, Math.max(0, 0.3 + 0.75 * fr)) * thigh;
  const bk = t * Math.max(0, -fr) * back;
  return [[front, 1 - th - bk], [x >= 0 ? B.thighL : B.thighR, th], [B.clothB, bk]];
};

function legs(k, R, L) {
  const [t, kn, c, a] = R.leg;
  const hv = L.heavy || 1;
  for (const s of [1, -1]) {
    const x = s * R.legX;
    k.add(loft([
      { y: 0.12, rx: a, rz: a * 1.1, x },
      { y: 0.25, rx: c * 0.86, rz: c * 0.95, x, z: -0.008 },
      { y: R.knee - 0.09, rx: c, rz: c * 1.1, x, z: -0.008 },
      { y: R.knee, rx: kn, rz: kn * 1.1, x, z: 0.004 },
      { y: (R.knee + R.hip) / 2, rx: ((t + kn) / 2) * 1.04 * hv, rz: ((t + kn) / 2) * 1.1 * hv, x },
      { y: R.hip - 0.05, rx: t * hv, rz: t * 1.06 * hv, x },
      { y: R.hip + 0.08, rx: t * 1.02 * hv, rz: t * 1.08 * hv, x: x * 0.8 },
    ], 7, { phase: Math.PI / 7 }), { color: L.pants, w: legW(R, s), grad: [0.1, 0.9, 0.86] });
    if (L.legStraps) {
      for (const [y, tilt] of [[R.knee + 0.2, 0.2], [R.knee + 0.12, -0.25]]) {
        k.add(xf(loft([{ y: -0.012, rx: 0.075, rz: 0.08 }, { y: 0.012, rx: 0.075, rz: 0.08 }], 7, { capTop: false, capBot: false }), { rot: [0, 0, tilt * s], pos: [x, y, 0] }), { color: L.legStraps, w: legW(R, s) });
      }
    }
    boot(k, R, L, s, x);
  }
}

function boot(k, R, L, s, x) {
  const w = seam(side(s, B.thighL, B.thighR), side(s, B.shinL, B.shinR), R.knee, 0.05);
  const dark = L.sole ?? 0x22160f;
  const sc = L.body === 'female' ? 0.92 : 1;
  // foot + sole
  k.add(tbox(x, 0.014, 0.085, 0.035, 0.048 * sc, 0.105 * sc, 0.043 * sc, 0.07 * sc, { dz: -0.02 }), { color: L.boot, w });
  k.add(tbox(x, 0, 0.016, 0.035, 0.052 * sc, 0.11 * sc), { color: dark, w });
  if (L.boots === 'short') {
    k.add(loft([{ y: 0.04, rx: 0.048 * sc, rz: 0.058 * sc, x }, { y: 0.16, rx: 0.046 * sc, rz: 0.052 * sc, x, z: -0.004 }, { y: 0.2, rx: 0.056 * sc, rz: 0.062 * sc, x, z: -0.004 }], 8, { phase: Math.PI / 8, capBot: false, capTop: false }), { color: L.boot, w, lining: dark });
    return;
  }
  const tall = L.boots === 'tall';
  const top = tall ? R.knee + 0.09 : R.knee - 0.1;
  k.add(loft([
    { y: 0.03, rx: 0.05 * sc, rz: 0.062 * sc, x },
    { y: 0.1, rx: 0.045 * sc, rz: 0.054 * sc, x, z: -0.005 },
    { y: 0.24, rx: 0.056 * sc, rz: 0.061 * sc, x, z: -0.008 },
    ...(tall ? [{ y: R.knee, rx: 0.057 * sc, rz: 0.062 * sc, x, z: 0.004 }] : []),
    { y: top, rx: (tall ? 0.07 : 0.061) * sc, rz: (tall ? 0.076 : 0.067) * sc, x, z: 0 },
  ], 8, { phase: Math.PI / 8, capBot: false, capTop: false }), { color: L.boot, w, lining: dark, grad: [0.0, 0.5, 0.82] });
  if (!tall) {
    // folded cuff below the knee
    k.add(loft([
      { y: R.knee - 0.15, rx: 0.065, rz: 0.071, x },
      { y: R.knee - 0.045, rx: 0.076, rz: 0.083, x, z: 0.002 },
      { y: R.knee - 0.03, rx: 0.076, rz: 0.083, x, z: 0.002 },
    ], 8, { phase: Math.PI / 8, capBot: false, capTop: false }), { color: L.boot, w, lining: dark, jitter: 0.07 });
  }
  if (L.kneeGuard) {
    const g = spike(0.04, 0.012, 0.15, 4);
    g.rotateZ(Math.PI); g.rotateX(-0.25);
    g.translate(x, R.knee + 0.08, 0.068);
    k.add(g, { color: L.kneeGuard, w });
    k.add(xf(box(0.07, 0.035, 0.02), { rot: [-0.2, 0, 0], pos: [x, R.knee + 0.06, 0.072] }), { color: L.kneeGuard, w });
  }
}

function pelvisAndTorso(k, R, L) {
  const hv = L.heavy || 1;
  k.add(loft(R.pelvis.map(([y, rx, rz]) => ({ y, rx: rx * hv, rz: rz * hv })), 12, { phase: Math.PI / 12, capTop: false }), { color: L.pants, w: B.hips });
  const T = R.torso.map(([y, rx, rz, z = 0]) => ({ y, rx: rx * hv, rz: rz * hv, z }));
  const top = R.torso[R.torso.length - 2][0];
  const ch = R.chest;
  let paint;
  if (L.torso === 'vest') {
    // leather vest over a shirt: a V of shirt at the front, collar line
    paint = (x, y, z) => (z > 0 && y > ch - 0.06 && Math.abs(x) < 0.012 + (y - (ch - 0.06)) * 0.3 ? L.shirt : L.vest);
  } else if (L.torso === 'corset') {
    const cTop = ch + 0.105;
    paint = (x, y, z) => {
      if (y > cTop) return z > 0.02 && y > top - 0.05 && Math.abs(x) < 0.05 ? L.skin : L.shirt;
      if (z > 0 && Math.abs(x) < 0.024 && y > R.waist - 0.02) return L.lacing;
      return L.vest;
    };
  } else if (L.torso === 'coat') {
    paint = (x, y, z) => {
      if (z > 0.04 && y > ch && Math.abs(x) < 0.02 + (y - ch) * 0.16) return L.shirt;
      if (z > 0.04 && y > ch - 0.05 && Math.abs(x) < 0.055 + (y - ch) * 0.22) return shade(L.vest, 0.72); // lapels
      return L.vest;
    };
  } else if (L.torso === 'sleeveless') {
    paint = (x, y, z) => (z > 0.04 && y > ch - 0.04 && Math.abs(x) < 0.022 + (y - ch) * 0.2 ? L.skin : L.vest);
  } else paint = () => L.shirt;
  k.add(loft(T, 12, { phase: Math.PI / 12 }), { paint, w: torsoW(R), grad: [R.waist, top, 0.88] });
  // neck
  k.add(loft([{ y: R.neck - 0.08, rx: 0.052 * R.head, rz: 0.05 * R.head, z: -0.005 }, { y: R.neck + 0.045, rx: 0.046 * R.head, rz: 0.046 * R.head, z: 0.006 }], 6, { capTop: false, capBot: false }), { color: L.skin, w: seam(B.head, B.chest, R.neck - 0.01, 0.04) });
  if (L.torso === 'coat') {
    // buttons down the coat front
    for (let i = 0; i < 4; i++) for (const s of [1, -1]) {
      const y = R.waist + 0.04 + i * 0.07;
      k.add(xf(box(0.018, 0.018, 0.012), { pos: [s * (0.045 + i * 0.012), y, faceFront(T, y) + 0.004] }), { color: L.trim, w: torsoW(R), jitter: 0 });
    }
  }
}

// z of the torso's flat front face (12-gon, phase π/12) at height y.
function faceFront(T, y) {
  let i = 0;
  while (i < T.length - 2 && T[i + 1].y < y) i++;
  const a = T[i], b = T[i + 1], t = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y)));
  return ((a.z || 0) + ((b.z || 0) - (a.z || 0)) * t) + (a.rz + (b.rz - a.rz) * t) * Math.cos(Math.PI / 12);
}

function arms(k, R, L, weapon) {
  const [sh, bi, el, fo, wr] = R.arm;
  const hv = L.heavy || 1;
  for (const s of [1, -1]) {
    const x = s * R.shX, w = armW(R, s);
    const fw = side(s, B.foreL, B.foreR);
    const puffy = L.sleeves === 'puffy', bare = L.sleeves === 'bare';
    const up = puffy ? 1.3 : 1;
    const rings = [
      { y: R.wrist - 0.005, rx: wr * 0.95, rz: wr, x },
      { y: R.wrist + 0.05, rx: wr * 1.1, rz: wr * 1.15, x },
      { y: (R.wrist + R.elbow) / 2 + 0.035, rx: fo * hv, rz: fo * 1.04 * hv, x },
      { y: R.elbow, rx: el * hv * (puffy ? 1.1 : 1), rz: el * 1.04 * hv * (puffy ? 1.1 : 1), x },
      { y: (R.elbow + R.shY) / 2, rx: bi * hv * up, rz: bi * 1.06 * hv * up, x },
      { y: R.shY - 0.045, rx: sh * hv * (puffy ? 1.2 : 1), rz: sh * 1.08 * hv * (puffy ? 1.2 : 1), x },
      { y: R.shY + 0.035, rx: sh * 0.8 * hv, rz: sh * 0.9 * hv, x: x * 0.93 },
    ];
    const sleeve = L.sleeves === 'coat' ? L.vest : L.shirt;
    const paint = (px, y) => {
      if (bare) return L.skin;
      if (L.sleeves === 'blouse' || puffy) return y > R.elbow - 0.03 ? L.shirt : L.skin;
      return sleeve;
    };
    k.add(loft(rings, 7, { phase: Math.PI / 7 }), { paint, w });
    // shoulder cap
    k.add(xf(ico(sh * 1.12 * hv, 0), { scale: [1, 1.05, 1.08], pos: [x + s * 0.008, R.shY - 0.012, 0] }), { color: bare ? L.skin : sleeve, w });
    // forearm layer
    if (L.sleeves === 'coat') {
      k.add(loft([{ y: R.wrist + 0.0, rx: 0.056, rz: 0.058, x }, { y: R.wrist + 0.1, rx: 0.06, rz: 0.062, x }, { y: R.wrist + 0.12, rx: 0.058, rz: 0.06, x }], 7, { phase: Math.PI / 7, capTop: false, capBot: false }), { paint: (px, y) => (y > R.wrist + 0.095 ? L.trim : L.cuff), w: fw, lining: L.cuff });
      k.add(loft([{ y: R.wrist - 0.025, rx: 0.04, rz: 0.042, x }, { y: R.wrist + 0.01, rx: 0.046, rz: 0.048, x }], 7, { capTop: false, capBot: false }), { color: L.shirt, w: fw, lining: L.shirt });
    } else if (L.bracer) {
      const long = puffy;
      const y1 = long ? R.elbow - 0.01 : R.wrist + 0.16;
      k.add(loft([
        { y: R.wrist - 0.012, rx: wr * 1.18, rz: wr * 1.22, x },
        { y: (R.wrist + y1) / 2, rx: fo * 1.12 * hv, rz: fo * 1.16 * hv, x },
        { y: y1, rx: fo * 1.2 * hv, rz: fo * 1.24 * hv, x },
      ], 7, { phase: Math.PI / 7, capTop: false, capBot: false }), {
        paint: (px, y) => (Math.abs(y - (R.wrist + 0.035)) < 0.015 || Math.abs(y - (y1 - 0.04)) < 0.015 ? L.glove ?? 0x2a1d17 : L.bracer),
        w: long ? w : fw, lining: 0x24170f,
      });
    }
    hand(k, R, L, s, weapon === 'pistols' || (weapon && s < 0));
    if (L.pauldrons) pauldron(k, R, L, s);
  }
}

function hand(k, R, L, s, fist) {
  const hs = R.hand, x = s * (R.shX + 0.004), y0 = R.wrist, w = side(s, B.foreL, B.foreR);
  const glove = L.glove ?? L.skin;
  k.add(tbox(x, y0 - 0.085 * hs, y0 - 0.002, 0.004, 0.017 * hs, 0.034 * hs, 0.02 * hs, 0.033 * hs), { color: glove, w });
  if (fist) {
    k.add(tbox(x - s * 0.003, y0 - 0.13 * hs, y0 - 0.07 * hs, 0.012, 0.026 * hs, 0.04 * hs, 0.024 * hs, 0.04 * hs), { color: L.glove ? L.skin : L.skin, w });
  } else {
    k.add(tbox(x, y0 - 0.15 * hs, y0 - 0.08 * hs, 0.012, 0.013 * hs, 0.03 * hs, 0.017 * hs, 0.034 * hs, { dz: -0.004 }), { color: L.skin, w });
  }
  k.add(xf(tbox(0, -0.045 * hs, 0, 0, 0.01 * hs, 0.011 * hs, 0.012 * hs, 0.012 * hs), { rot: [0.45, 0, -s * 0.25], pos: [x - s * 0.014, y0 - 0.025, 0.03 * hs] }), { color: L.skin, w });
}

function pauldron(k, R, L, s) {
  const x = s * (R.shX + 0.02), y = R.shY;
  const w = (px, py, pz) => [[side(s, B.armL, B.armR), 0.6], [B.chest, 0.4]];
  k.add(loft([{ y: y - 0.06, rx: 0.07, rz: 0.075, x }, { y: y + 0.015, rx: 0.075, rz: 0.08, x }, { y: y + 0.06, rx: 0.04, rz: 0.05, x: x - s * 0.01 }], 7, { capBot: false }), { color: L.pauldrons, w, lining: 0x3a4245 });
  // layered leaf blades fanning out and down
  [[0.0, 0.3, 0.12], [0.045, 0.55, 0.1], [-0.045, 0.55, 0.1], [0.0, 0.85, 0.08]].forEach(([dz, a, len], i) => {
    const g = spike(0.03, 0.008, len, 4);
    g.rotateY(dz * 4 * s);
    g.rotateZ(-s * (Math.PI / 2 + a + 0.2));
    g.translate(x + s * 0.03, y + 0.04 - i * 0.012, dz);
    k.add(g, { color: L.pauldrons, w, jitter: 0.08 });
  });
}

// Coat skirts, tassets, dresses and leather flaps.
function lower(k, R, L) {
  const top = R.waist + 0.045, hv = L.heavy || 1;
  const fem = L.body === 'female' ? 0.95 : 1;
  if (L.lower === 'coat') {
    const hem = L.hem ?? R.knee - 0.06;
    const bw = R.belt[0] * 0.96 * hv, bd = R.belt[1] * 0.93 * hv;
    k.add(loft([
      { y: hem, rx: 0.218 * fem * hv, rz: 0.17 * fem * hv, z: -0.024, dy: (t) => 0.06 * Math.cos(t) },
      { y: (hem + R.hip) / 2 - 0.04, rx: 0.205 * fem * hv, rz: 0.158 * fem * hv, z: -0.016, dy: (t) => 0.03 * Math.cos(t) },
      { y: R.hip - 0.03, rx: 0.178 * fem * hv, rz: 0.13 * fem * hv, z: -0.006 },
      { y: top, rx: bw * 0.95, rz: bd * 0.95 },
    ], 10, { capTop: false, capBot: false, skip: (x, y, z) => z > 0 && Math.abs(Math.atan2(x, z)) < 0.5 }), {
      color: L.coat, lining: L.coatIn, w: skirtW(top, hem), grad: [hem, R.hip, 0.7],
    });
  } else if (L.lower === 'dress') {
    k.add(loft([
      { y: 0.03, rx: 0.3 * hv, rz: 0.27 * hv, z: -0.01 },
      { y: R.knee - 0.1, rx: 0.25 * hv, rz: 0.21 * hv },
      { y: R.hip - 0.04, rx: 0.19 * hv, rz: 0.14 * hv },
      { y: top + 0.01, rx: R.belt[0] * hv, rz: R.belt[1] * hv },
    ], 12, { phase: Math.PI / 12, capTop: false, capBot: false }), { color: L.skirt, lining: 0x2f3420, w: skirtW(top, 0.1, { thigh: 0.35, back: 0.25 }), grad: [0.05, R.hip, 0.72], jitter: 0.06 });
    // apron
    const ap = tbox(0, 0.32 - top, -0.02, 0, 0.13 * hv, 0.008, 0.1 * hv, 0.008);
    k.add(xf(ap, { rot: [-0.2, 0, 0], pos: [0, top, R.belt[1] * hv + 0.01] }), { color: L.apron, w: skirtW(top, 0.1, { thigh: 0.35, back: 0.0 }), grad: [0.3, top, 0.86] });
  } else if (L.lower === 'tassets' || L.lower === 'flaps') {
    const leather = L.lower === 'flaps';
    const flapW = (bone) => (x, y, z) => { const t = sstep(top - 0.02, top - 0.2, y); return [[B.hips, 1 - t], [bone, t]]; };
    const mk = (z, yBot, hw, color, bone, tilt, lean = 0) => {
      const g = tbox(0, yBot - top, 0.005, 0, leather ? hw * 0.9 : hw * 0.25, 0.008, hw, 0.009);
      g.rotateX(tilt); g.rotateY(lean);
      g.translate(0, top, z);
      return [g, color, bone];
    };
    const d = R.belt[1] * hv;
    const parts = leather
      ? [mk(d + 0.004, R.hip - 0.2, 0.1, L.flap, B.clothF, -0.12), mk(-d - 0.004, R.hip - 0.24, 0.12, L.flap, B.clothB, 0.12)]
      : [
        mk(d + 0.004, R.hip - 0.3, 0.1, L.skirt, B.clothF, -0.14), mk(d + 0.012, R.hip - 0.12, 0.07, L.flap, B.clothF, -0.18),
        mk(-d - 0.004, R.hip - 0.38, 0.12, L.skirt, B.clothB, 0.14),
      ];
    for (const [g, color, bone] of parts) k.add(g, { color, w: flapW(bone), grad: [R.hip - 0.4, top, 0.8] });
    if (!leather) {
      // side flaps follow the thighs
      for (const s of [1, -1]) {
        const g = tbox(0, R.hip - 0.2 - top, 0, 0, 0.012, 0.06, 0.012, 0.075);
        g.rotateZ(s * 0.16);
        g.translate(s * R.belt[0] * 0.96, top, -0.005);
        k.add(g, { color: L.skirt, w: flapW(side(s, B.thighL, B.thighR)), grad: [R.hip - 0.25, top, 0.8] });
      }
    }
  }
}

function belts(k, R, L) {
  const hv = L.heavy || 1;
  for (const b of L.belts || []) {
    const y = R.waist + b.dy;
    const rx = R.belt[0] * hv * (1 + Math.max(0, -b.dy) * 0.6), rz = R.belt[1] * hv * (1 + Math.max(0, -b.dy) * 0.8);
    const h = b.sash ? 0.075 : 0.042;
    const g = loft([{ y: -h / 2, rx, rz }, { y: h / 2, rx: rx * 0.99, rz: rz * 0.99 }], 10, { capTop: false, capBot: false });
    xf(g, { rot: [0, 0, b.tilt || 0], pos: [0, y, 0] });
    k.add(g, { color: b.c, w: B.hips, lining: 0x1a120e, jitter: b.sash ? 0.08 : 0.04 });
    const front = rz;
    const by = y + (b.tilt ? -Math.sin(b.tilt) * 0.03 : 0);
    if (b.buckle) {
      const bx = b.tilt ? -0.03 * Math.sign(b.tilt) : 0;
      k.add(xf(box(0.05, 0.04, 0.012), { pos: [bx, by, front + 0.004] }), { color: b.buckle === 2 ? L.metal : L.metal, w: B.hips, jitter: 0.02 });
      k.add(xf(box(0.024, 0.016, 0.014), { pos: [bx, by, front + 0.006] }), { color: b.c, w: B.hips, jitter: 0 });
    }
    if (b.sash) {
      // knotted tail on the left hip
      const t = tbox(0, -0.23, 0, 0, 0.022, 0.008, 0.032, 0.01);
      xf(t, { rot: [0, -0.7, 0.12], pos: [rx * 0.72, y - 0.01, rz * 0.72] });
      k.add(t, { color: b.c, w: toward(B.hips, B.thighL, (x, yy) => sstep(y - 0.05, y - 0.25, yy) * 0.6), jitter: 0.08 });
    }
    if (b.pouches) {
      for (const s of [1, -1]) {
        const a = s * 1.05;
        const px = Math.sin(a) * rx * 1.02, pz = Math.cos(a) * rz * 1.02;
        const p = tbox(0, -0.065, 0.0, 0, 0.034, 0.016, 0.03, 0.019);
        xf(p, { rot: [0, a, 0], pos: [px, by - 0.005, pz] });
        k.add(p, { color: 0x4a3024, w: B.hips });
        const f = tbox(0, -0.022, 0.004, 0, 0.036, 0.02, 0.036, 0.022);
        xf(f, { rot: [0, a, 0], pos: [px, by - 0.005, pz] });
        k.add(f, { color: 0x34221a, w: B.hips });
      }
    }
  }
  if (L.bandolier) {
    const T = R.torso.map(([y, rx, rz, z0 = 0]) => ({ y, rx: rx * hv, rz: rz * hv, z: z0 }));
    const at = (y) => {
      let i = 0;
      while (i < T.length - 2 && T[i + 1].y < y) i++;
      const a = T[i], b = T[i + 1], t = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y)));
      return { rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, z: a.z + (b.z - a.z) * t };
    };
    const top = R.shY - 0.03, bot = R.waist + 0.02;
    for (const sg of [1, -1]) {
      const cs = [], ns = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, y = top + (bot - top) * t, x = (0.62 - 1.24 * t) * at(y).rx * 0.95;
        const r = at(y), u = Math.min(0.97, Math.abs(x) / r.rx);
        const zz = r.z + sg * r.rz * Math.sqrt(1 - u * u) * 0.985 + sg * 0.007;
        cs.push([x, y, zz]);
        ns.push([x / (r.rx * r.rx), 0, (zz - r.z) / (r.rz * r.rz)]);
      }
      k.add(ribbon(cs, ns, 0.044, 0.012), { color: L.bandolier, w: torsoW(R), jitter: 0.04 });
      if (sg > 0) {
        const c = cs[3];
        k.add(xf(box(0.036, 0.04, 0.012), { rot: [0, 0, 0.75], pos: [c[0], c[1], c[2] + 0.006] }), { color: L.metal, w: torsoW(R), jitter: 0.02 });
      }
    }
  }
}

function mantle(k, R, L) {
  if (!L.mantle) return;
  const y = R.shY, hv = L.heavy || 1;
  const fem = L.body === 'female' ? 0.88 : 1;
  if (L.mantle === 'cowl') {
    const c = L.hood;
    k.add(loft([
      { y: y - 0.085, rx: 0.268 * fem, rz: 0.178 * fem, z: -0.008, dy: (t) => -0.13 * Math.max(0, Math.cos(t)) ** 3 - 0.09 * Math.max(0, -Math.cos(t)) ** 2 },
      { y: y - 0.02, rx: 0.262 * fem, rz: 0.168 * fem, dy: (t) => -0.05 * Math.max(0, Math.cos(t)) ** 3 - 0.03 * Math.max(0, -Math.cos(t)) ** 2 },
      { y: y + 0.05, rx: 0.228 * fem, rz: 0.148 * fem },
      { y: y + 0.095, rx: 0.15 * fem, rz: 0.112 * fem },
      { y: R.neck + 0.01, rx: 0.088 * R.head, rz: 0.082 * R.head },
    ], 10, { capTop: false, capBot: false }), { color: c, lining: L.hoodIn, w: B.chest, grad: [y - 0.2, y + 0.1, 0.85] });
  } else if (L.mantle === 'fur') {
    // Tufted fur: scalloped rings, ragged hem, strong per-facet tone jitter.
    const tuft = (a, ph) => (t) => 1 + a * Math.sin(t * 7 + ph);
    k.add(loft([
      { y: y - 0.09, rx: 0.275 * hv, rz: 0.19 * hv, z: -0.012, f: tuft(0.07, 0), dy: (t) => -0.05 * (0.5 + 0.5 * Math.sin(t * 9 + 1)) - 0.05 * Math.max(0, Math.cos(t)) ** 2 },
      { y: y - 0.01, rx: 0.285 * hv, rz: 0.195 * hv, f: tuft(0.06, 1.7) },
      { y: y + 0.07, rx: 0.24 * hv, rz: 0.165 * hv, f: tuft(0.08, 0.6) },
      { y: y + 0.12, rx: 0.15 * hv, rz: 0.125 * hv, f: tuft(0.06, 2.4) },
      { y: R.neck + 0.02, rx: 0.098, rz: 0.094 },
    ], 14, { capTop: false, capBot: false }), { color: L.fur, lining: 0x3a3028, w: B.chest, jitter: 0.16, grad: [y - 0.12, y + 0.12, 0.72] });
  } else if (L.mantle === 'shawl') {
    k.add(loft([
      { y: y - 0.2, rx: 0.25 * hv, rz: 0.18 * hv, z: 0, dy: (t) => -0.1 * Math.max(0, -Math.cos(t)) },
      { y: y - 0.04, rx: 0.25 * hv, rz: 0.165 * hv },
      { y: y + 0.06, rx: 0.17 * hv, rz: 0.125 * hv },
      { y: R.neck - 0.02, rx: 0.085, rz: 0.08 },
    ], 10, { capTop: false, capBot: false, skip: (x, yy, z) => z > 0.05 && Math.abs(Math.atan2(x, z)) < 0.5 && yy < y - 0.02 }), { color: L.shawl, lining: 0x5a2a20, w: B.chest, jitter: 0.07 });
  }
}

function neckwear(k, R, L) {
  const n = R.neck, s = R.head;
  const w = toward(B.chest, B.head, (x, y) => sstep(n - 0.05, n + 0.04, y));
  if (L.neck === 'scarf') {
    k.add(loft([{ y: n - 0.08, rx: 0.094 * s, rz: 0.09 * s, z: 0 }, { y: n - 0.02, rx: 0.087 * s, rz: 0.09 * s, z: 0.012 }, { y: n + 0.03, rx: 0.072 * s, rz: 0.078 * s, z: 0.022 }], 8, { capTop: false, capBot: false }), { color: L.scarf, lining: 0x3a3630, w, jitter: 0.08 });
    k.add(xf(tbox(0, -0.12, 0, 0, 0.012, 0.01, 0.05, 0.012), { rot: [-0.25, 0, 0.08], pos: [0.01, n - 0.06, 0.09 * s] }), { color: L.scarf, w: B.chest, jitter: 0.08 });
  } else if (L.neck === 'collar') {
    k.add(loft([{ y: n - 0.06, rx: 0.07 * s, rz: 0.066 * s }, { y: n - 0.02, rx: 0.058 * s, rz: 0.056 * s }], 8, { capTop: false, capBot: false }), { color: L.collar, lining: 0x1f3a30, w });
    k.add(xf(ico(0.016, 0), { pos: [0, n - 0.07, 0.07 * s] }), { color: L.gem, glow: 0.5, w: B.chest, jitter: 0 });
  } else if (L.neck === 'cravat') {
    k.add(xf(tbox(0, -0.1, 0, 0, 0.018, 0.012, 0.04, 0.02), { rot: [-0.18, 0, 0], pos: [0, n - 0.05, 0.075] }), { color: L.shirt, w: B.chest, jitter: 0.06 });
    k.add(loft([{ y: n - 0.07, rx: 0.068, rz: 0.066 }, { y: n - 0.01, rx: 0.06, rz: 0.06 }], 8, { capTop: false, capBot: false }), { color: L.shirt, lining: 0xbdb5a8, w });
  }
}

// ---- Heads ------------------------------------------------------------------------------------------
function head(k, R, L, J) {
  const S = R.head, fem = L.body === 'female';
  const rings = ringsOf(HEAD[fem ? 'female' : 'male'], S);
  const raw = HEAD[fem ? 'female' : 'male'].map(([y, rx, rz, z]) => [y * S, rx * S, rz * S, z * S]);
  const at = J.head;
  const hw = B.head;
  const beard = L.beardStyle === 'full';
  const hairC = L.hairStyle === 'shaved' ? shade(L.skin, 0.86) : L.hair;
  const paint = (x, y, z) => {
    if (beard && y < 0.07 * S && z > -0.02) return L.beard;
    if (beard && y < 0.1 * S && z > 0.0 && (Math.abs(x) < 0.03 * S || Math.abs(x) > 0.07 * S)) return L.beard;
    if (beard && y < 0.15 * S && Math.abs(x) > 0.088 * S && z > -0.025 && z < 0.06) return L.beard;
    if (L.hairStyle !== 'shaved' && z < -0.02 && y > 0.07 * S) return hairC;
    if (L.hairStyle === 'shaved' && y > 0.21 * S && z < 0.06) return hairC;
    return L.skin;
  };
  k.add(loft(rings, 8), { paint, w: hw, at, jitter: 0.035 });
  const fz = (y, x) => faceZ(raw, y, x);
  const P = (x, y, dz = 0) => [x, y, fz(y, x) + dz];
  // eyes, brows, nose, mouth
  for (const s of [1, -1]) {
    const ex = s * 0.037 * S, ey = 0.148 * S;
    k.add(xf(box(0.03 * S, (fem ? 0.014 : 0.012) * S, 0.012), { pos: P(ex, ey, -0.002) }), { color: L.eyes ?? 0x18120f, w: hw, at, jitter: 0 });
    const by = 0.176 * S, bx = s * 0.04 * S;
    k.add(xf(box(0.046 * S, (fem ? 0.008 : 0.012) * S, 0.014), { rot: [0, 0, fem ? -s * 0.12 : s * 0.2], pos: P(bx, by, 0.002) }), { color: shade(L.hair === 0x9a948c ? 0x6a655e : L.hair, fem ? 0.85 : 0.75), w: hw, at, jitter: 0 });
  }
  const nb = 0.098 * S, nt = 0.168 * S;
  k.add(wedge([0, nt, fz(nt, 0) - 0.006], [-0.016 * S, nb, fz(nb, 0.016 * S) - 0.002], [0.016 * S, nb, fz(nb, 0.016 * S) - 0.002], [0, 0.104 * S, fz(0.104 * S, 0) + (fem ? 0.02 : 0.026) * S]), { color: shade(L.skin, 0.96), w: hw, at, jitter: 0 });
  if (!beard) k.add(xf(box(0.034 * S, 0.008 * S, 0.008), { pos: P(0, 0.075 * S, -0.002) }), { color: L.lips ?? shade(L.skin, 0.7), w: hw, at, jitter: 0 });
  else {
    k.add(xf(box(0.03 * S, 0.007 * S, 0.008), { pos: P(0, 0.075 * S, -0.001) }), { color: shade(L.skin, 0.62), w: hw, at, jitter: 0 });
    k.add(xf(box(0.058 * S, 0.012 * S, 0.014), { rot: [0, 0, 0], pos: P(0, 0.089 * S, 0.001) }), { color: L.beard, w: hw, at, jitter: 0 });
  }
  // ears
  for (const s of [1, -1]) {
    if (L.ears === 'elf') {
      const g = spike(0.012 * S, 0.03 * S, 0.17 * S, 4);
      g.rotateZ(-s * 1.0);
      g.rotateY(s * 0.32);
      g.translate(s * 0.094 * S, 0.135 * S, -0.012);
      k.add(g, { color: L.skin, w: hw, at, jitter: 0.03 });
    } else {
      k.add(tbox(s * 0.1 * S, 0.105 * S, 0.165 * S, -0.008, 0.01 * S, 0.02 * S, 0.012 * S, 0.026 * S), { color: shade(L.skin, 0.95), w: hw, at });
    }
  }
  hair(k, R, L, J, S);
  headwear(k, R, L, J, S, raw);
}

const shade = (hex, k) => {
  const r = Math.min(255, ((hex >> 16) & 255) * k), g = Math.min(255, ((hex >> 8) & 255) * k), b = Math.min(255, (hex & 255) * k);
  return (r << 16) | (g << 8) | b;
};

function hair(k, R, L, J, S) {
  const at = J.head, st = L.hairStyle;
  if (st === 'shaved') return;
  const hw = B.head;
  const capW = (x, y) => [[B.head, 1]];
  const hasHood = L.headwear === 'hood' || L.headwear === 'headscarf';
  // Cap: the front sits behind the forehead so the hairline shows naturally.
  if (!hasHood || st === 'long') {
    k.add(loft(ringsOf([[0.12, 0.106, 0.1, -0.036], [0.2, 0.114, 0.12, -0.02], [0.25, 0.106, 0.116, -0.015], [0.29, 0.082, 0.094, -0.022], [0.318, 0.036, 0.042, -0.025]], S), 8), { color: L.hair, w: capW, at, jitter: 0.09 });
  }
  const fall = toward(B.head, B.chest, (x, y) => sstep(J.head[1] + 0.03, J.head[1] - 0.14, y));
  if (st === 'long') {
    if (!hasHood) k.add(loft(ringsOf([[-0.42, 0.082, 0.028, -0.118], [-0.2, 0.098, 0.04, -0.118], [0.0, 0.11, 0.055, -0.1], [0.15, 0.112, 0.068, -0.07], [0.26, 0.09, 0.068, -0.05]], S), 6), { color: L.hair, w: fall, at, jitter: 0.1, grad: [J.head[1] - 0.42, J.head[1] + 0.1, 0.78] });
    for (const s of [1, -1]) {
      k.add(loft([{ y: -0.22 * S, rx: 0.022 * S, rz: 0.012 * S, x: s * 0.108 * S, z: 0.035 * S }, { y: 0.0, rx: 0.03 * S, rz: 0.02 * S, x: s * 0.106 * S, z: 0.03 * S }, { y: 0.19 * S, rx: 0.03 * S, rz: 0.03 * S, x: s * 0.098 * S, z: 0.02 * S }], 4, { phase: Math.PI / 4 }), { color: shade(L.hair, 1.05), w: fall, at, jitter: 0.1 });
    }
  } else if (st === 'tied' || st === 'braid') {
    const braid = st === 'braid';
    const len = braid ? 0.5 : 0.3;
    k.add(loft(ringsOf([[0.18 - len, 0.012, 0.012, -0.13], [0.14 - len * 0.6, 0.03, 0.03, -0.135], [0.1, 0.036, 0.036, -0.12], [0.2, 0.03, 0.03, -0.1]], S), 5), { color: L.hair, w: fall, at, jitter: 0.12 });
    k.add(xf(ico(0.02 * S, 0), { pos: [0, 0.12 * S, -0.12 * S] }), { color: braid ? L.hat ?? 0x23202a : 0x2a1d17, w: hw, at });
  } else if (st === 'bun') {
    k.add(xf(ico(0.06 * S, 0), { scale: [1, 0.85, 1], pos: [0, 0.27 * S, -0.08 * S] }), { color: L.hair, w: hw, at, jitter: 0.1 });
  }
}

function headwear(k, R, L, J, S, raw) {
  const at = J.head, hw = B.head;
  const kind = L.headwear;
  if (kind === 'hood') {
    const hood = ringsOf([[-0.04, 0.128, 0.132, -0.035], [0.05, 0.144, 0.15, -0.03], [0.16, 0.15, 0.158, -0.022], [0.27, 0.13, 0.144, -0.026], [0.35, 0.082, 0.1, -0.02], [0.405, 0.012, 0.012, 0.025]], S);
    const w = toward(B.head, B.chest, (x, y) => 1 - sstep(J.head[1] - 0.05, J.head[1] + 0.06, y));
    k.add(loft(hood, 12, { capBot: false, skip: (x, y, z) => z > -0.02 && Math.abs(Math.atan2(x, z + 0.022)) < 0.9 && y < 0.262 * S }), {
      color: L.hood, lining: L.hoodIn, w, at, jitter: 0.05, grad: [-0.05, 0.4, 0.86],
    });
  } else if (kind === 'bandana') {
    k.add(loft(ringsOf([[0.17, 0.118, 0.124, -0.02], [0.24, 0.11, 0.12, -0.016], [0.29, 0.086, 0.098, -0.022], [0.325, 0.036, 0.044, -0.025]], S), 8), { color: L.band, w: hw, at, jitter: 0.06 });
    k.add(xf(ico(0.03 * S, 0), { pos: [0, 0.21 * S, -0.13 * S] }), { color: shade(L.band, 0.85), w: hw, at });
    for (const s of [1, -1]) {
      const t = tbox(0, -0.13 * S, 0, 0, 0.018 * S, 0.006, 0.024 * S, 0.008);
      xf(t, { rot: [0.35, 0, s * 0.3], pos: [s * 0.02, 0.2 * S, -0.135 * S] });
      k.add(t, { color: L.band, w: toward(B.head, B.chest, (x, y) => sstep(J.head[1] + 0.15, J.head[1] - 0.0, y) * 0.5), at, jitter: 0.06 });
    }
  } else if (kind === 'headscarf') {
    // Covers the crown and the back of the head, knotted at the nape; the face and ears stay clear.
    k.add(loft(ringsOf([[0.09, 0.098, 0.09, -0.06], [0.16, 0.113, 0.118, -0.032], [0.235, 0.11, 0.122, -0.018], [0.295, 0.084, 0.098, -0.022], [0.33, 0.036, 0.044, -0.025]], S), 12, {
      skip: (x, y, z) => z > -0.01 && Math.abs(Math.atan2(x, z + 0.03)) < 1.15 && y < 0.2 * S,
    }), { color: L.band, w: hw, at, jitter: 0.07, lining: shade(L.band, 0.6) });
    k.add(xf(ico(0.032 * S, 0), { pos: [0, 0.12 * S, -0.13 * S] }), { color: shade(L.band, 0.88), w: hw, at });
    for (const s of [1, -1]) {
      const t = tbox(0, -0.11 * S, 0, 0, 0.016 * S, 0.006, 0.026 * S, 0.008);
      xf(t, { rot: [0.3, 0, s * 0.35], pos: [s * 0.018, 0.12 * S, -0.14 * S] });
      k.add(t, { color: L.band, w: toward(B.head, B.chest, (x, y) => sstep(J.head[1] + 0.1, J.head[1] - 0.05, y) * 0.5), at, jitter: 0.07 });
    }
  } else if (kind === 'tricorn') {
    k.add(loft(ringsOf([[0.235, 0.105, 0.112, -0.02], [0.33, 0.1, 0.108, -0.02], [0.37, 0.07, 0.078, -0.02]], S), 7), { color: L.hat, w: hw, at, jitter: 0.04 });
    // triangular brim with turned-up sides, point to the front
    k.add(loft([{ y: 0.255 * S, rx: 0.2 * S, rz: 0.2 * S, z: -0.02 }, { y: 0.335 * S, rx: 0.235 * S, rz: 0.235 * S, z: -0.02 }], 3, { capTop: false }), {
      paint: (x, y) => (y > 0.32 * S ? L.trim : L.hat), w: hw, at, lining: 0x18151c, jitter: 0.04,
    });
    k.add(xf(spike(0.012, 0.012, 0.13, 4), { rot: [-0.5, 0, 0.6], pos: [0.1 * S, 0.33 * S, 0.04 * S] }), { color: 0xeee6d6, w: hw, at });
  }
}

// ---- Weapons -----------------------------------------------------------------------------------------
function weapon(k, R, L) {
  if (!L.weapon) return;
  const x = -(R.shX + 0.002), y = R.wrist - 0.1 * R.hand, z = 0.012;
  const w = B.foreR;
  const parts = [];
  const put = (g, o) => parts.push([g, o]);
  if (L.weapon === 'cutlass' || L.weapon === 'saber') {
    const saber = L.weapon === 'saber';
    const prof = saber
      ? [[0.0, 0.02], [0.3, 0.02], [0.56, 0.017, 0.004], [0.66, 0.001, 0.008]]
      : [[0.0, 0.024], [0.22, 0.029, 0.006], [0.42, 0.032, 0.02], [0.54, 0.028, 0.034], [0.62, 0.012, 0.046], [0.65, 0.001, 0.05]];
    put(xf(blade(prof, 0.012), { rot: [0, Math.PI / 2, 0] }), { color: 0xe2e8ec, glow: 0.12, jitter: 0.06 });
    put(xf(box(saber ? 0.03 : 0.024, 0.016, saber ? 0.11 : 0.09), {}), { color: saber ? L.metal : 0x3a3532 });
    if (!saber) put(xf(tbox(0, -0.13, 0.0, 0.045, 0.006, 0.006), {}), { color: 0x3a3532 });
    put(loft([{ y: -0.13, rx: 0.015, rz: 0.015 }, { y: 0, rx: 0.016, rz: 0.016 }], 6), { color: 0x3a2418, jitter: 0.08 });
    put(xf(ico(0.02, 0), { pos: [0, -0.14, 0] }), { color: L.metal });
  } else if (L.weapon === 'staff') {
    put(loft([{ y: -0.5, rx: 0.016, rz: 0.016 }, { y: 0.55, rx: 0.019, rz: 0.019 }], 6), { color: 0x4a3426, jitter: 0.1 });
    for (const [dy, a] of [[0.6, 0.5], [0.62, -0.6], [0.58, 2.2]]) put(xf(spike(0.03, 0.02, 0.16, 4), { rot: [0, a, 0.5], pos: [0, dy, 0] }), { color: L.horns || L.cloth });
    put(xf(ico(0.06, 0), { pos: [0, 0.66, 0] }), { color: L.gemC, glow: 1, jitter: 0 });
  } else if (L.weapon === 'greatsword') {
    put(xf(blade([[0.0, 0.05], [0.55, 0.055], [0.8, 0.045], [0.96, 0.002]], 0.036), { rot: [0, Math.PI / 2, 0] }), { color: 0xe9e1cc, jitter: 0.07 });
    put(xf(box(0.06, 0.045, 0.24), {}), { color: L.slateD });
    for (const s of [1, -1]) put(xf(ico(0.03, 0), { pos: [0, 0, s * 0.13] }), { color: L.gold });
    put(loft([{ y: -0.22, rx: 0.022, rz: 0.022 }, { y: 0, rx: 0.024, rz: 0.024 }], 6), { color: 0x3a2a22 });
    put(xf(ico(0.034, 0), { pos: [0, -0.24, 0] }), { color: L.gold });
  }
  const shift = L.weapon === 'greatsword' ? 0.1 : L.weapon === 'staff' ? 0.15 : 0.065;
  for (const [g, o] of parts) {
    g.translate(0, shift, 0);
    // A staff stands upright beside the body (gem above the shoulder); blades point forward and down.
    g.rotateX(L.weapon === 'staff' ? 0.12 : Math.PI / 2 + (L.weapon === 'greatsword' ? 0.85 : 1.0));
    g.translate(x, y, z);
    k.add(g, { ...o, w });
  }
}

// Flintlock pistols (M3.5), one in each fist. Built hanging with the arm: the barrel runs down the
// forearm's line in front of the knuckles, the grip goes back through the fist, so raising the arm to
// the front (aim) points the muzzle forward with the butt below.
function pistols(k, R, L) {
  const brass = 0xc9a44c, wood = 0x6a3d22, iron = 0x34302e;
  for (const s of [1, -1]) {
    const w = side(s, B.foreL, B.foreR);
    const x = s * (R.shX + 0.004), y = R.wrist - 0.1 * R.hand, z = 0.006;
    const at = (g) => { g.translate(x, y, z); return g; };
    // barrel (brass, flared muzzle) over the wooden fore-end
    k.add(at(loft([{ y: 0.035, rx: 0.017, rz: 0.017, z: 0.045 }, { y: -0.2, rx: 0.014, rz: 0.014, z: 0.045 }, { y: -0.215, rx: 0.019, rz: 0.019, z: 0.045 }, { y: -0.245, rx: 0.018, rz: 0.018, z: 0.045 }], 6)), { color: brass, w, jitter: 0.04 });
    k.add(at(xf(box(0.026, 0.19, 0.022), { pos: [0, -0.06, 0.026] })), { color: wood, w, jitter: 0.06 });
    // grip back through the fist, brass butt cap
    k.add(at(xf(box(0.028, 0.036, 0.12), { rot: [-0.38, 0, 0], pos: [0, 0.05, -0.012] })), { color: wood, w, jitter: 0.08 });
    k.add(at(xf(ico(0.024, 0), { pos: [0, 0.075, -0.072] })), { color: brass, w });
    // lock plate and hammer on the outer side, trigger guard
    k.add(at(xf(box(0.008, 0.06, 0.03), { pos: [s * 0.017, 0.02, 0.036] })), { color: iron, w });
    k.add(at(xf(spike(0.008, 0.008, 0.045, 4), { rot: [-0.9, 0, 0], pos: [s * 0.01, 0.045, 0.05] })), { color: iron, w });
    k.add(at(xf(box(0.006, 0.04, 0.03), { pos: [0, 0.0, 0.004] })), { color: brass, w });
  }
}

// ---- Skeleton sentinel (brute body) --------------------------------------------------------------------
function skeleton(k, R, L, J) {
  const bone = L.bone, boneD = shade(L.bone, 0.84);
  const at = J.head, hw = B.head;
  // skull
  const sk = [[0.0, 0.072, 0.07, 0.06], [0.06, 0.1, 0.095, 0.05], [0.13, 0.135, 0.13, 0.022], [0.24, 0.155, 0.16, 0.0], [0.34, 0.14, 0.15, -0.012], [0.41, 0.07, 0.08, -0.012]];
  k.add(loft(ringsOf(sk), 8, { phase: Math.PI / 8 }), { color: bone, w: hw, at, jitter: 0.04 });
  const front = (y) => { const r = sk.find((q, i) => sk[i + 1] && sk[i + 1][0] >= y) || sk[sk.length - 2]; return r[3] + r[2] * Math.cos(Math.PI / 8); };
  for (const s of [1, -1]) {
    k.add(xf(box(0.072, 0.066, 0.04), { pos: [s * 0.058, 0.22, front(0.22) - 0.01] }), { color: L.socket, w: hw, at, jitter: 0 });
    k.add(xf(box(0.022, 0.022, 0.012), { pos: [s * 0.056, 0.214, front(0.22) + 0.012] }), { color: L.gemC, glow: 1, w: hw, at, jitter: 0 });
  }
  k.add(wedge([0, 0.178, front(0.17) - 0.01], [-0.022, 0.135, front(0.13) - 0.004], [0.022, 0.135, front(0.13) - 0.004], [0, 0.14, front(0.13) + 0.008]), { color: L.socket, w: hw, at });
  k.add(xf(box(0.12, 0.034, 0.02), { pos: [0, 0.085, front(0.08) - 0.008] }), { color: L.socket, w: hw, at, jitter: 0 });
  for (let i = 0; i < 5; i++) k.add(xf(box(0.017, 0.026, 0.012), { pos: [-0.042 + i * 0.021, 0.086, front(0.08) + 0.004] }), { color: bone, w: hw, at });
  if (L.horns) horns(k, L, hw, at, 1);
  // neck vertebrae, ribcage, spine, clavicles
  for (let i = 0; i < 2; i++) k.add(xf(box(0.06, 0.04, 0.06), { pos: [0, R.neck - 0.07 + i * 0.05, -0.02] }), { color: boneD, w: seam(B.head, B.chest, R.neck - 0.02, 0.04) });
  const tw = torsoW(R);
  k.add(loft([{ y: 1.12, rx: 0.1, rz: 0.07 }, { y: 1.25, rx: 0.15, rz: 0.1 }, { y: 1.45, rx: 0.185, rz: 0.125 }, { y: 1.6, rx: 0.16, rz: 0.1 }, { y: 1.68, rx: 0.08, rz: 0.06 }], 8, { phase: Math.PI / 8 }), { color: 0x24232c, w: tw, jitter: 0.02 });
  [0.19, 0.215, 0.225, 0.215, 0.18].forEach((rx, i) => {
    const y = 1.27 + i * 0.085;
    k.add(loft([{ y: y - 0.02, rx, rz: rx * 0.7, dy: (t) => -0.035 * (1 + Math.cos(t)) / 2 }, { y: y + 0.02, rx: rx * 0.99, rz: rx * 0.69, dy: (t) => -0.035 * (1 + Math.cos(t)) / 2 }], 10, {
      capTop: false, capBot: false, skip: (x, yy, z) => z > 0 && Math.abs(Math.atan2(x, z)) < 0.4,
    }), { color: bone, lining: boneD, w: tw });
  });
  k.add(tbox(0, 1.28, 1.62, 0.152, 0.024, 0.014, 0.03, 0.014), { color: bone, w: tw });
  for (const s of [1, -1]) k.add(xf(box(0.22, 0.036, 0.04), { rot: [0, 0, -s * 0.16], pos: [s * 0.13, 1.645, 0.05] }), { color: bone, w: B.chest });
  for (let i = 0; i < 4; i++) k.add(xf(box(0.06, 0.05, 0.06), { pos: [0, 1.0 + i * 0.065, -0.02] }), { color: boneD, w: tw });
  // pelvis, belt, tabard
  k.add(loft([{ y: 0.92, rx: 0.11, rz: 0.07 }, { y: 1.0, rx: 0.17, rz: 0.1 }, { y: 1.06, rx: 0.15, rz: 0.09 }], 8, { phase: Math.PI / 8 }), { color: bone, w: B.hips });
  k.add(loft([{ y: 1.02, rx: 0.19, rz: 0.13 }, { y: 1.07, rx: 0.19, rz: 0.13 }], 10, { capTop: false, capBot: false }), { paint: (x, y) => (y > 1.06 || y < 1.03 ? L.gold : L.slateD), w: B.hips, lining: 0x14161a });
  k.add(xf(box(0.07, 0.07, 0.03), { rot: [0, 0, Math.PI / 4], pos: [0, 1.045, 0.135] }), { color: L.gold, w: B.hips });
  k.add(xf(box(0.03, 0.03, 0.03), { rot: [0, 0, Math.PI / 4], pos: [0, 1.045, 0.15] }), { color: L.gemC, glow: 1, w: B.hips, jitter: 0 });
  const flapW = (bone2) => (x, y) => { const t = sstep(1.02, 0.8, y); return [[B.hips, 1 - t], [bone2, t]]; };
  for (const [z, b2, len] of [[0.13, B.clothF, 0.5], [-0.12, B.clothB, 0.56]]) {
    k.add(tbox(0, 1.03 - len, 1.03, z, 0.12, 0.012, 0.11, 0.012), { color: L.slate, w: flapW(b2), grad: [1.03 - len, 1.03, 0.75] });
    k.add(xf(spike(0.12, 0.012, 0.08, 4), { rot: [Math.PI, 0, 0], pos: [0, 1.03 - len, z] }), { color: L.slate, w: flapW(b2) });
  }
  // arms
  for (const s of [1, -1]) {
    const x = s * R.shX, aw = armW(R, s), fw = side(s, B.foreL, B.foreR), uw = side(s, B.armL, B.armR);
    k.add(loft([{ y: R.elbow, rx: 0.042, rz: 0.042, x }, { y: R.shY - 0.05, rx: 0.05, rz: 0.05, x }], 6), { color: bone, w: aw });
    k.add(xf(ico(0.058, 0), { pos: [x, R.elbow, 0] }), { color: boneD, w: aw });
    // pauldron: bone dome, gold band, ice spikes
    const pw = () => [[uw, 0.6], [B.chest, 0.4]];
    const py = R.shY;
    k.add(loft([{ y: py - 0.09, rx: 0.15, rz: 0.15, x: x + s * 0.03 }, { y: py, rx: 0.16, rz: 0.16, x: x + s * 0.03 }, { y: py + 0.08, rx: 0.12, rz: 0.13, x: x + s * 0.02 }, { y: py + 0.13, rx: 0.05, rz: 0.06, x }], 8, { capBot: false }), {
      paint: (px, yy) => (yy < py - 0.045 ? L.gold : bone), w: pw, lining: 0x2a2620, jitter: 0.05,
    });
    [[0.0, 0.12, 0.24, 0.0], [0.08, 0.5, 0.17, 0.06], [-0.07, 0.42, 0.15, -0.05]].forEach(([dx, tilt, len, dz]) => {
      const g = spike(0.04, 0.04, len, 4);
      g.rotateX(dz * 3);
      g.rotateZ(-s * tilt);
      g.translate(x + s * (0.05 + dx), py + 0.1, dz);
      k.add(g, { color: L.ice, glow: 0.35, w: pw, jitter: 0.06 });
    });
    // gauntlet
    k.add(loft([{ y: R.wrist - 0.02, rx: 0.085, rz: 0.09, x }, { y: R.wrist + 0.1, rx: 0.1, rz: 0.1, x }, { y: R.elbow - 0.04, rx: 0.096, rz: 0.096, x }, { y: R.elbow + 0.0, rx: 0.08, rz: 0.08, x }], 8, { phase: Math.PI / 8, capTop: false, capBot: false }), {
      paint: (px, yy) => (yy > R.elbow - 0.075 ? L.gold : L.slate), w: fw, lining: 0x14161a, grad: [R.wrist, R.elbow, 0.82],
    });
    k.add(xf(box(0.022, 0.07, 0.05), { pos: [x + s * 0.1, (R.wrist + R.elbow) / 2, 0] }), { color: L.gemC, glow: 1, w: fw, jitter: 0 });
    const sp = spike(0.025, 0.025, 0.12, 4);
    sp.rotateZ(-s * 1.1); sp.translate(x + s * 0.08, R.elbow - 0.06, -0.04);
    k.add(sp, { color: L.slateD, w: fw });
    // big bone hand
    const hy = R.wrist;
    k.add(tbox(x, hy - 0.11, hy - 0.01, 0.0, 0.03, 0.06, 0.034, 0.055), { color: bone, w: fw });
    if (s < 0) k.add(tbox(x, hy - 0.19, hy - 0.1, 0.02, 0.042, 0.06, 0.04, 0.062), { color: boneD, w: fw });
    else for (let i = 0; i < 3; i++) k.add(tbox(x, hy - 0.2, hy - 0.1, -0.035 + i * 0.035, 0.016, 0.014, 0.018, 0.016, { dz: 0.01 }), { color: boneD, w: fw });
    k.add(xf(tbox(0, -0.07, 0, 0, 0.016, 0.016), { rot: [0.5, 0, -s * 0.2], pos: [x - s * 0.02, hy - 0.04, 0.06] }), { color: boneD, w: fw });
  }
  // legs
  for (const s of [1, -1]) {
    const x = s * R.legX, lw = legW(R, s), shw = side(s, B.shinL, B.shinR);
    k.add(loft([{ y: R.knee + 0.03, rx: 0.042, rz: 0.042, x }, { y: R.hip, rx: 0.05, rz: 0.05, x }], 6), { color: bone, w: lw });
    k.add(loft([{ y: 0.4, rx: 0.036, rz: 0.036, x }, { y: R.knee - 0.02, rx: 0.04, rz: 0.04, x }], 6), { color: bone, w: lw });
    k.add(xf(ico(0.055, 0), { pos: [x, R.knee, 0.0] }), { color: boneD, w: lw });
    k.add(xf(spike(0.06, 0.03, 0.13, 4), { rot: [Math.PI - 0.3, 0, 0], pos: [x, R.knee + 0.08, 0.06] }), { color: L.gold, w: lw });
    // greave with jagged rim
    k.add(loft([{ y: 0.02, rx: 0.085, rz: 0.1, x, z: 0.01 }, { y: 0.12, rx: 0.078, rz: 0.088, x }, { y: 0.3, rx: 0.094, rz: 0.1, x }, { y: 0.44, rx: 0.102, rz: 0.106, x }], 8, { phase: Math.PI / 8, capTop: false }), { color: L.slate, w: shw, lining: 0x14161a, grad: [0.0, 0.44, 0.75] });
    for (const [a, len] of [[0, 0.12], [0.9, 0.09], [-0.9, 0.09]]) {
      const g = spike(0.03, 0.02, len, 4);
      g.rotateX(0.25); g.rotateY(a * s);
      g.translate(x + Math.sin(a * s) * 0.09, 0.42, Math.cos(a) * 0.09);
      k.add(g, { color: L.slateD, w: shw });
    }
    k.add(tbox(x, 0, 0.11, 0.06, 0.08, 0.14, 0.07, 0.09, { dz: -0.03 }), { color: L.slateD, w: shw });
  }
  weapon(k, R, L);
}

// ---- Skeleton archer (male body, cursed pirate) -----------------------------------------------------------
function skeletonArcher(k, R, L, J) {
  const bone = L.bone, boneD = shade(L.bone, 0.82);
  const at = J.head, hw = B.head, S = 0.8;
  // skull, a little smaller than the sentinel's, with a red bandana and green ghost-fire eyes
  const sk = [[0.0, 0.07, 0.068, 0.055], [0.06, 0.095, 0.092, 0.045], [0.13, 0.13, 0.126, 0.02], [0.24, 0.15, 0.155, 0.0], [0.34, 0.135, 0.145, -0.012], [0.41, 0.068, 0.078, -0.012]];
  k.add(loft(ringsOf(sk, S), 8, { phase: Math.PI / 8 }), { color: bone, w: hw, at, jitter: 0.05 });
  const front = (y) => { const yy = y / S; const r = sk.find((q, i) => sk[i + 1] && sk[i + 1][0] >= yy) || sk[sk.length - 2]; return (r[3] + r[2] * Math.cos(Math.PI / 8)) * S; };
  for (const sd of [1, -1]) {
    k.add(xf(box(0.058, 0.052, 0.034), { pos: [sd * 0.046, 0.176, front(0.176) - 0.008] }), { color: L.socket, w: hw, at, jitter: 0 });
    k.add(xf(box(0.02, 0.02, 0.012), { pos: [sd * 0.045, 0.172, front(0.176) + 0.01] }), { color: L.gemC, glow: 1, w: hw, at, jitter: 0 });
  }
  k.add(wedge([0, 0.142, front(0.136) - 0.008], [-0.018, 0.108, front(0.104) - 0.003], [0.018, 0.108, front(0.104) - 0.003], [0, 0.112, front(0.104) + 0.006]), { color: L.socket, w: hw, at });
  k.add(xf(box(0.096, 0.026, 0.016), { pos: [0, 0.068, front(0.064) - 0.006] }), { color: L.socket, w: hw, at, jitter: 0 });
  for (let i = 0; i < 5; i++) k.add(xf(box(0.014, 0.022, 0.01), { pos: [-0.034 + i * 0.017, 0.069, front(0.064) + 0.003] }), { color: bone, w: hw, at });
  if (L.horns) horns(k, L, hw, at, S);
  k.add(loft([{ y: 0.2, rx: 0.128, rz: 0.134, z: -0.004 }, { y: 0.27, rx: 0.13, rz: 0.136, z: -0.008 }, { y: 0.31, rx: 0.1, rz: 0.11, z: -0.012 }, { y: 0.335, rx: 0.04, rz: 0.05, z: -0.014 }], 8, { phase: Math.PI / 8 }), { color: L.cloth, w: hw, at, jitter: 0.08 });
  for (const [dx, len, tilt] of [[0.03, 0.2, 0.25], [-0.03, 0.17, -0.2]]) {
    k.add(xf(tbox(0, -len, 0, 0, 0.03, 0.008, 0.012, 0.006), { rot: [0.35, 0, tilt], pos: [dx, 0.26, -0.12] }), { color: L.clothD, w: toward(B.head, B.chest, () => 0.4), at });
  }
  // neck, ribcage, spine, clavicles
  for (let i = 0; i < 2; i++) k.add(xf(box(0.045, 0.032, 0.045), { pos: [0, R.neck - 0.06 + i * 0.04, -0.015] }), { color: boneD, w: seam(B.head, B.chest, R.neck - 0.02, 0.04) });
  const tw = torsoW(R);
  [0.13, 0.15, 0.158, 0.15, 0.125].forEach((rx, i) => {
    const y = R.waist + 0.12 + i * 0.07;
    k.add(loft([{ y: y - 0.016, rx, rz: rx * 0.72, dy: (t) => -0.03 * (1 + Math.cos(t)) / 2 }, { y: y + 0.016, rx: rx * 0.99, rz: rx * 0.71, dy: (t) => -0.03 * (1 + Math.cos(t)) / 2 }], 10, {
      capTop: false, capBot: false, skip: (x, yy, z) => z > 0 && Math.abs(Math.atan2(x, z)) < 0.42,
    }), { color: bone, lining: boneD, w: tw });
  });
  k.add(tbox(0, R.waist + 0.12, R.shY - 0.02, 0.11, 0.018, 0.01, 0.022, 0.01), { color: bone, w: tw });
  for (let i = 0; i < 5; i++) k.add(xf(box(0.045, 0.04, 0.045), { pos: [0, R.hip + 0.05 + i * 0.07, -0.03] }), { color: boneD, w: tw });
  for (const sd of [1, -1]) k.add(xf(box(0.17, 0.028, 0.03), { rot: [0, 0, -sd * 0.14], pos: [sd * 0.1, R.shY + 0.03, 0.035] }), { color: bone, w: B.chest });
  // tattered vest (open front, ragged hem) and a sash across the chest
  k.add(loft([{ y: R.waist + 0.05, rx: 0.17, rz: 0.12 }, { y: R.chest, rx: 0.18, rz: 0.125 }, { y: R.shY - 0.04, rx: 0.17, rz: 0.11 }, { y: R.shY + 0.02, rx: 0.11, rz: 0.08 }], 10, {
    capTop: false, capBot: false,
    skip: (x, y, z) => (z > 0 && Math.abs(Math.atan2(x, z)) < 0.85) || (y < R.waist + 0.12 && Math.sin(x * 61 + z * 37) > 0.35),
  }), { color: L.cloth, lining: L.clothD, w: tw, jitter: 0.1, grad: [R.waist, R.shY, 0.7] });
  {
    const pts = [], outs = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, a = -2.2 + t * 4.4;
      const y = lerpN(R.shY - 0.02, R.waist + 0.08, t);
      pts.push([Math.sin(a) * 0.17, y, Math.cos(a) * 0.125]);
      outs.push([Math.sin(a), 0, Math.cos(a)]);
    }
    k.add(ribbon(pts, outs, 0.045, 0.012), { color: L.leather, w: tw });
  }
  // pelvis, belt with a buckle, ragged loin flaps
  k.add(loft([{ y: R.hip - 0.02, rx: 0.08, rz: 0.055 }, { y: R.hip + 0.05, rx: 0.13, rz: 0.08 }, { y: R.waist - 0.01, rx: 0.11, rz: 0.07 }], 8, { phase: Math.PI / 8 }), { color: bone, w: B.hips });
  k.add(loft([{ y: R.hip + 0.04, rx: 0.15, rz: 0.11 }, { y: R.hip + 0.085, rx: 0.15, rz: 0.11 }], 10, { capTop: false, capBot: false }), { color: L.leatherD, w: B.hips, lining: 0x14161a });
  k.add(xf(box(0.05, 0.045, 0.02), { pos: [0, R.hip + 0.062, 0.112] }), { color: L.metal, w: B.hips });
  const flapW = (bone2) => (x, y) => { const t = sstep(R.hip + 0.06, R.hip - 0.25, y); return [[B.hips, 1 - t], [bone2, t]]; };
  for (const [z, b2, len, x0] of [[0.1, B.clothF, 0.34, 0.03], [-0.1, B.clothB, 0.4, -0.02]]) {
    k.add(tbox(x0, R.hip + 0.06 - len, R.hip + 0.06, z, 0.075, 0.01, 0.09, 0.01), { color: L.clothD, w: flapW(b2), grad: [R.hip - len, R.hip, 0.7] });
    k.add(xf(spike(0.075, 0.01, 0.06, 4), { rot: [Math.PI, 0, 0], pos: [x0, R.hip + 0.06 - len, z] }), { color: L.clothD, w: flapW(b2) });
  }
  // quiver across the back with a few fletchings
  if (L.weapon === 'bow') {
    const qw = B.chest;
    k.add(xf(loft([{ y: -0.26, rx: 0.05, rz: 0.045 }, { y: 0.24, rx: 0.058, rz: 0.05 }], 8, { capTop: false }), { rot: [0.12, 0, 0.42], pos: [0.02, R.chest + 0.05, -0.17] }), { color: L.leather, w: qw, lining: L.leatherD });
    for (let i = 0; i < 4; i++) {
      const g = tbox(0, 0, 0.13, 0, 0.012, 0.004, 0.005, 0.002);
      xf(g, { rot: [0.12 + i * 0.05, 0, 0.42 - i * 0.06], pos: [-0.07 + i * 0.02, R.chest + 0.27, -0.2 + i * 0.008] });
      k.add(g, { color: i % 2 ? 0xe8e0d0 : 0x9a2a2a, w: qw });
    }
  }
  // arms: thin bones, bracer on the bow arm
  for (const sd of [1, -1]) {
    const x = sd * R.shX, aw = armW(R, sd), fw = side(sd, B.foreL, B.foreR);
    k.add(loft([{ y: R.elbow, rx: 0.03, rz: 0.03, x }, { y: R.shY - 0.03, rx: 0.036, rz: 0.036, x }], 6), { color: bone, w: aw });
    k.add(loft([{ y: R.wrist + 0.02, rx: 0.024, rz: 0.024, x }, { y: R.elbow, rx: 0.028, rz: 0.028, x }], 6), { color: bone, w: aw });
    k.add(xf(ico(0.04, 0), { pos: [x, R.elbow, 0] }), { color: boneD, w: aw });
    k.add(xf(ico(0.05, 0), { pos: [x, R.shY, 0] }), { color: boneD, w: aw });
    if (sd > 0) k.add(loft([{ y: R.wrist + 0.03, rx: 0.045, rz: 0.048, x }, { y: R.elbow - 0.05, rx: 0.05, rz: 0.05, x }], 8, { capTop: false, capBot: false }), { color: L.leather, w: fw, lining: L.leatherD });
    const hy = R.wrist;
    k.add(tbox(x, hy - 0.09, hy - 0.005, 0.0, 0.022, 0.045, 0.026, 0.042), { color: bone, w: fw });
    for (let i = 0; i < 3; i++) k.add(tbox(x, hy - 0.16, hy - 0.085, -0.028 + i * 0.028, 0.011, 0.01, 0.013, 0.011, { dz: 0.012 }), { color: boneD, w: fw });
  }
  // legs and short boots
  for (const sd of [1, -1]) {
    const x = sd * R.legX, lw = legW(R, sd), shw = side(sd, B.shinL, B.shinR);
    k.add(loft([{ y: R.knee + 0.03, rx: 0.032, rz: 0.032, x }, { y: R.hip, rx: 0.04, rz: 0.04, x }], 6), { color: bone, w: lw });
    k.add(loft([{ y: 0.22, rx: 0.028, rz: 0.028, x }, { y: R.knee - 0.02, rx: 0.032, rz: 0.032, x }], 6), { color: bone, w: lw });
    k.add(xf(ico(0.042, 0), { pos: [x, R.knee, 0.0] }), { color: boneD, w: lw });
    k.add(loft([{ y: 0.0, rx: 0.06, rz: 0.075, x, z: 0.015 }, { y: 0.08, rx: 0.055, rz: 0.066, x }, { y: 0.24, rx: 0.06, rz: 0.064, x }, { y: 0.27, rx: 0.07, rz: 0.072, x }], 8, { phase: Math.PI / 8, capTop: false }), { color: L.leatherD, w: shw, lining: 0x14100c, grad: [0, 0.27, 0.75] });
    k.add(tbox(x, 0, 0.07, 0.07, 0.055, 0.075, 0.05, 0.06, { dz: -0.02 }), { color: L.leatherD, w: shw });
  }
  if (L.weapon !== 'bow') { weapon(k, R, L); return; }
  // bow in the left hand: limbs fore-aft in the bind pose (vertical once the arm aims), string behind
  {
    const fw = B.foreL, x = R.shX + 0.004, y = R.wrist - 0.06;
    const limb = [];
    const N = 7;
    for (let i = 0; i <= N; i++) {
      const t = i / N, zz = (t * 2 - 1) * 0.6;
      const bend = 0.13 * (1 - Math.cos((t * 2 - 1) * Math.PI * 0.5) ** 0.6) + 0.04 * Math.abs(t * 2 - 1) ** 3;
      limb.push([x, y + bend, zz]);
    }
    const outs = limb.map(() => [1, 0, 0]);
    k.add(ribbon(limb, outs, 0.03, 0.03), { color: L.wood, w: fw, jitter: 0.08 });
    k.add(xf(box(0.04, 0.05, 0.1), { pos: [x, y + 0.005, 0] }), { color: L.leather, w: fw });
    k.add(ribbon([[x, limb[0][1], limb[0][2]], [x, limb[0][1], 0], [x, limb[N][1], limb[N][2]]], [[1, 0, 0], [1, 0, 0], [1, 0, 0]], 0.006, 0.006), { color: 0xe8e0c8, w: fw, jitter: 0 });
    for (const t of [0, N]) k.add(xf(spike(0.012, 0.012, 0.05, 4), { rot: [t ? Math.PI / 2 : -Math.PI / 2, 0, 0], pos: [x, limb[t][1], limb[t][2]] }), { color: L.metal, w: fw });
  }
}
const lerpN = (a, b, t) => a + (b - a) * t;

// Two curved horns from the top of the skull (imp, shaman's coral crest, Hellfire). S = skull scale.
function horns(k, L, hw, at, S) {
  for (const sd of [1, -1]) {
    let prev = null;
    for (let i = 0; i < 3; i++) {
      const hk = L.hornK || 1, t = i / 3, len = 0.09 * S * hk * (1 - t * 0.25), r = 0.032 * S * hk * (1 - t * 0.55);
      const g = spike(r, r, len, 4);
      g.rotateZ(-sd * (0.55 - i * 0.35));
      g.rotateX(-0.25 - i * 0.2);
      const base = prev || [sd * 0.085 * S, 0.33 * S, -0.01 * S];
      g.translate(base[0], base[1], base[2]);
      k.add(g, { color: L.horns, w: hw, at, jitter: 0.05 });
      prev = [base[0] + sd * Math.sin(0.55 - i * 0.35) * len * 0.8, base[1] + Math.cos(0.55 - i * 0.35) * len * 0.8, base[2] - Math.sin(0.25 + i * 0.2) * len * 0.7];
    }
  }
}

// ---- Assembly ------------------------------------------------------------------------------------------
const cache = new Map();
// wpn: falsy = empty hands, true = the look's own weapon, 'pistols' = a flintlock in each fist.
export function buildLook(idx, wpn) {
  const i = Math.max(0, Math.min(LOOKS.length - 1, idx | 0));
  const pist = wpn === 'pistols';
  const armed = !!wpn && !pist;
  const key = i + (pist ? 'p' : armed ? 'a' : '');
  if (cache.has(key)) return cache.get(key);
  const L = LOOKS[i];
  const R = BODY[L.body];
  const J = joints(R);
  const k = new Builder();
  if (L.body === 'brute') skeleton(k, R, L, J);
  else if (L.archer || L.skel === 'light') skeletonArcher(k, R, L, J);
  else {
    legs(k, R, L);
    pelvisAndTorso(k, R, L);
    lower(k, R, L);
    belts(k, R, L);
    arms(k, R, L, pist ? 'pistols' : armed && L.weapon);
    mantle(k, R, L);
    neckwear(k, R, L);
    head(k, R, L, J);
    if (armed) weapon(k, R, L);
    if (pist) pistols(k, R, L);
  }
  const geo = k.build();
  const height = geo.boundingBox.max.y;
  const res = { geo, J, R, height, key: L.body, look: L };
  cache.set(key, res);
  return res;
}

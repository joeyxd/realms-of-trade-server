// Characters: adult, faceted low-poly looks (charlooks.js) on a 15-bone rig with knees, elbows and
// cloth panels. One SkinnedMesh per character (1 draw call per pass). Procedural animation:
// idle breathing and weight shift, run cycle with knee/elbow bend and hip/shoulder counter-rotation,
// dash lean and tuck, turn roll, subtle squash, spring-driven secondary motion on coats and flaps.
// Combat (M2) is a layer on top: the 3-hit combo, the parry guard, flinches, staggers, falling,
// the riposte, and the enemies' telegraphed attacks (bow draw, overhead cleave, spikes, orb).
import * as THREE from 'three';
import { blobTexture } from './geo.js';
import { toon, U, charNormalMat } from './toon.js';
import { LAYER } from './pipeline.js';
import { BONES, makeBones } from './charkit.js';
import { LOOKS, buildLook } from './charlooks.js';
import { assets } from './assets/registry.js';
import { charToon } from './assets/toonmat.js';
import { stepHarvestPose } from './harvestPose.js';
import { damp, angleDelta, clamp, spring, easeOutCubic, wrapAngle } from '../core/math.js';
import { tuning } from '../data/tuning.js';
import { ACT } from '../sim/ecs.js';
import { SKILLS } from '../data/weapons.js';

export const SKINS = LOOKS;
export const SENTINEL = LOOKS.findIndex((l) => l.enemy && l.body === 'brute');
export const ARCHER = LOOKS.findIndex((l) => l.archer);
// Enemy kind → look index (sim kinds in data/enemies.js).
export const ENEMY_LOOK = Object.fromEntries([['archer', ARCHER], ['sentinel', SENTINEL],
  ...[['grunt', 'Grumete ahogado'], ['imp', 'Diablillo de fuego'], ['shaman', 'Chamán de coral'], ['hellfire', 'HELLFIRE'],
    ['renegado', 'Desalmado'], ['pistolera', 'Desalmada']].map(([k, n]) => [k, LOOKS.findIndex((l) => l.name === n)])]);
// Attack id → pose family (enemy attack timelines).
const POSE = {
  bite: 'cleave', slam: 'cleave', wall: 'spikes', heavy: 'orb', fan5: 'orb', fan7: 'orb',
  tajo: 'cleave', medialuna: 'spikes', rafaga: 'orb', descarga: 'spread', // the Desalmados (M4.5)
  spiral: 'raise', spiral2: 'raise', flower: 'raise', summon: 'raise', ring: 'raise', rings2: 'spread', rings3: 'spread',
  charge: 'cleave', laser2: 'spread', meteors: 'raise', lanes: 'spread', curtain: 'orb', spiral3: 'raise',
};
const TAU = Math.PI * 2;
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// One material per character (same shader program for all): its own glow and hit flash.
export function characterMaterial(kind = 'base') {
  const glow = { value: kind === 'sentinel' ? 0.5 : 1 };
  const flash = { value: new THREE.Vector4(1, 1, 1, 0) };
  // Stronger rim than the props so slim adult silhouettes separate from the ground.
  const m = toon({ color: 0xffffff, vertexColors: true }, {
    rim: true, glow: true, softBand: true, key: 'char',
    uniforms: { mnGlowAmt: glow, mnRimStr: { value: 1.1 }, mnFlash: flash },
    fragPars: 'uniform vec4 mnFlash;\n',
    post: 'gl_FragColor.rgb = mix(gl_FragColor.rgb, mnFlash.rgb, mnFlash.a);\n',
    glowMask: 'max(smoothstep(0.35, 1.4, max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b)), mnFlash.a * 0.6)',
  });
  m.flatShading = true;
  m.userData.glow = glow;
  m.userData.flash = flash;
  m.userData.nm = charNormalMat(); // line weight 1 in the normal pass: characters are inked heavier than the world
  return m;
}

let blobGeo = null, blobMat = null;

export class CharacterView {
  constructor(skinIdx = 0, { sword = true, pose = null } = {}) {
    const L = LOOKS[skinIdx] || LOOKS[0];
    this.look = L;
    this.skin = skinIdx;
    this.armed = sword && !!L.weapon;
    // An imported model for this look (assets/manifest.json, render/assets/): the same rig, its own geometry.
    const ext = assets.charLook(skinIdx, this.armed);
    const built = ext || buildLook(skinIdx, this.armed);
    this.built = built;
    this.ext = ext ? ext.ext : null;
    this.debrisKey = (ext ? 'x' : '') + skinIdx + (this.armed ? 'a' : '');
    this.height = built.height;
    this.rigKey = built.key;
    this.pose = pose;
    this.root = new THREE.Group();
    this.bones = makeBones(built.J);
    BONES.forEach((n, i) => { this[n] = this.bones[i]; });
    this.restHipsY = this.hips.position.y;
    this.material = characterMaterial(L.enemy ? 'sentinel' : 'base');
    this.glow = this.material.userData.glow;
    this.flashU = this.material.userData.flash.value;
    this.mesh = new THREE.SkinnedMesh(built.geo, this.ext ? this.extMaterials() : this.material);
    if (this.ext) this.mesh.userData.nm = charNormalMat(); // a material array: the outline pass takes the mesh's pair
    this.mesh.add(this.body);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, built.height * 0.5, 0.1), built.height * 0.8);
    this.root.add(this.mesh);
    this.meshes = [this.mesh];
    // Scaled looks (small imps, the big boss): the whole skinned mesh, bones included.
    this.scale = L.scale || 1;
    if (this.scale !== 1) { this.mesh.scale.setScalar(this.scale); this.height *= this.scale; }

    if (!blobGeo) {
      blobGeo = new THREE.PlaneGeometry(1.1, 1.1);
      blobGeo.rotateX(-Math.PI / 2);
      blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    this.blob = new THREE.Mesh(blobGeo, blobMat);
    this.blob.layers.set(LAYER.NO_OUTLINE);
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 2;
    this.blobSize = (L.body === 'brute' ? 1.45 : L.heavy ? 1.12 : 1) * (L.scale || 1);
    this.root.add(this.blob);

    // Animation state.
    this.seed = Math.random() * 10;
    this.t = this.seed;
    this.stride = 2.5 * (built.height / 1.88);
    this.phase = 0;
    this.run = 0;
    this.dash = 0;
    this.lean = 0;
    this.roll = 0;
    this.lastF = null;
    this.sy = { x: 1, v: 0 };
    this.sz = { x: 1, v: 0 };
    this.cf = { x: 0, v: 0 };
    this.cb = { x: 0, v: 0 };
    this.onStep = null;
    this.wasDash = false;
    this.legYaw = 0; this.back = false; this.fwd = 1; this.side = 0;
    // Combat layer.
    this.ao = { cx: 0, cy: 0, sx: 0, sy: 0, hx: 0, hy: 0 }; // damped torso offsets
    this.parryW = 0;
    this.hitK = 0; this.hitDir = 1;
    this.flashA = 0; this.flashCol = new THREE.Color(1, 1, 1);
    this.attack = null; // enemy: {id, t (s since the wind-up began), windup, fire}
    this.dorm = pose === 'dormant' ? 1 : 0;
    this.downW = 0;
    this.weaponKind = 'sable';
    this.recoilL = 0; this.recoilR = 0; this.shootW = 0;
  }

  // An imported model's materials, one per geometry group: its own (toon-converted), then the procedural weapon's
  // group on this view's vertex-colour material. All share the view's glow and hit-flash uniforms.
  extMaterials() {
    const shared = { glow: this.material.userData.glow, flash: this.material.userData.flash };
    const list = this.ext.mats.map((m) => charToon(m, this.ext.entry, shared));
    list.push(this.material);
    return list;
  }

  // The weapon in hand (players): 'sable' (the look's own blade) or 'pistolas'. Same skeleton, new mesh.
  setWeapon(kind) {
    if (!this.armed || kind === this.weaponKind) return;
    this.weaponKind = kind;
    const w = kind === 'pistolas' ? 'pistols' : true;
    this.mesh.geometry = (this.ext && assets.charLook(this.skin, w) || buildLook(this.skin, w)).geo;
  }
  // A pistol shot kicks that arm up (hand +1 = left, −1 = right, as the sim alternates them).
  recoil(hand) { if (hand > 0) this.recoilL = 1; else this.recoilR = 1; }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }

  // The leap this view is flying (M4.7): its cast event's air time and height (a remote pirate's come from its
  // event; without one, the base Abordaje). How high the body is t s into the cast.
  setLeap(air, h) { this.leapAir = air; this.leapH = h; }
  leapLift(t) {
    const L = SKILLS.leap, air = this.leapAir || L.air, u = (t - L.windup) / air;
    return u > 0 && u < 1 ? (this.leapH || L.h) * 4 * u * (1 - u) : 0;
  }

  // Short white (or tinted) flash: hits taken, perfect parries.
  flash(color = 0xffffff, amount = 1) { this.flashCol.set(color); this.flashA = Math.max(this.flashA, amount); }
  // Flinch away from a hit (dir: +1 hit from the front).
  hit(k = 1, dir = 1) { this.hitK = Math.max(this.hitK, k); this.hitDir = dir; }

  // s: {x, y, z, f, vx, vz, st (1 = dash), wade, act, actT, dead}
  update(dt, s) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    if (this.look.hover) this.mesh.position.y = 0.32 + Math.sin(this.t * 2.6 + this.seed) * 0.08;
    this.root.position.set(s.x, s.y, s.z);
    // Abordaje (ACT.LEAP, M4.7): the body rides the jump's parabola h · 4u(1 − u), render only; the shadow stays down.
    const lift = (s.act | 0) === ACT.LEAP ? this.leapLift(s.actT || 0) : 0;
    this.root.position.y += lift;
    this.blob.position.y = 0.03 - lift;
    if (this.lastF === null) this.lastF = s.f;
    const turnRate = angleDelta(this.lastF, s.f) / Math.max(dt, 1e-4);
    this.lastF = s.f;
    this.root.rotation.y = s.f;

    const speed = Math.hypot(s.vx, s.vz);
    const dashing = s.st === 1;
    this.run = damp(this.run, dashing ? 0.25 : clamp(speed / 6.5, 0, 1), 10, dt);
    this.dash = damp(this.dash, dashing ? 1 : 0, dashing ? 26 : 8, dt);
    if (dashing && !this.wasDash) { this.sz.v += 2.2; this.sy.v -= 1.6; }
    if (!dashing && this.wasDash) this.sy.v -= 1.4;
    this.wasDash = dashing;

    // Aimed movement (M3.5): the legs follow where you walk, the torso where you aim. Walking sideways
    // turns the hips toward the motion (the chest turns back); walking backwards plays the stride in
    // reverse. Hysteresis on the backwards switch so the feet don't flicker around 110°.
    let legT = 0;
    if (speed > 0.6 && !dashing) {
      const lm = wrapAngle(Math.atan2(s.vx, s.vz) - s.f);
      const al = Math.abs(lm);
      if (this.back ? al > 1.75 : al > 2.0) { this.back = true; legT = clamp(wrapAngle(lm - Math.PI), -0.9, 0.9); }
      else { this.back = false; legT = clamp(lm, -1.1, 1.1); }
      this.fwd = damp(this.fwd, Math.cos(lm), 8, dt); this.side = damp(this.side, Math.sin(lm), 8, dt);
    } else { this.back = false; this.fwd = damp(this.fwd, 1, 6, dt); this.side = damp(this.side, 0, 6, dt); }
    this.legYaw = damp(this.legYaw, legT, 10, dt);
    // Stride: one cycle per `stride` u; a footstep when either foot plants (thigh most forward).
    const prev = this.phase;
    this.phase += dt * (speed / this.stride) * TAU * (dashing ? 0.15 : 1) * (this.back ? -1 : 1);
    const H = Math.PI;
    if (this.run > 0.3 && Math.floor((prev - H / 2) / H) !== Math.floor((this.phase - H / 2) / H)) {
      const foot = Math.floor((this.phase - H / 2) / H) & 1;
      if (this.onStep) this.onStep(foot);
      if (this.onFootprint) this.onFootprint(foot, s);
    }
    // Dormant sentinels wake up over the wake time (s.act WAKE), then stay awake.
    const act = s.act | 0;
    if (act === ACT.DORMANT) this.dorm = damp(this.dorm, 1, 6, dt);
    else if (act === ACT.WAKE) this.dorm = 1 - sm((s.actT || 0) / 1.1);
    else this.dorm = damp(this.dorm, 0, 4, dt);
    const r = this.run, d = this.dash, nd = 1 - d, ph = this.phase, sn = Math.sin(ph);
    const idle = (1 - r) * nd;
    const br = Math.sin(this.t * 1.8) * idle;
    const sway = Math.sin(this.t * 0.55 + this.seed) * idle;
    const dorm = this.dorm;
    const k = (cur, target, l = 22) => damp(cur, target, l, dt);

    // Subtle squash & stretch (adult proportions: a hint, not a cartoon).
    spring(this.sy, dashing ? 0.95 : 1, 240, 19, dt);
    spring(this.sz, dashing ? 1.05 : 1, 240, 19, dt);
    const sx = 1 / Math.sqrt(Math.max(0.5, this.sy.x * this.sz.x));
    this.body.scale.set(sx, this.sy.x, this.sz.x);
    this.lean = damp(this.lean, 0.09 * r * clamp(this.fwd, -0.5, 1) + 0.3 * d, 8, dt);
    this.roll = damp(this.roll, clamp(-turnRate * 0.025, -0.2, 0.2) * r - 0.07 * r * this.side, 7, dt);
    this.body.rotation.set(this.lean, 0, this.roll);

    // Pelvis: two bobs per stride, crouch in the dash, weight shift when idle.
    this.hips.position.y = this.restHipsY - 0.025 * r + 0.04 * r * Math.abs(sn) - 0.07 * d - 0.01 * idle * (0.5 + 0.5 * sway) - 0.04 * dorm;
    this.hips.position.x = 0.012 * sway;
    const ly = this.legYaw;
    this.hips.rotation.set(0, -0.16 * r * sn + ly, -0.035 * sway);
    this.spine.rotation.set(0.05 * r + 0.14 * d + 0.14 * dorm, 0.08 * r * sn - 0.6 * ly, 0.02 * sway);
    this.chest.rotation.set(-0.02 * br + 0.04 * r + 0.08 * dorm, 0.13 * r * sn - 0.4 * ly, 0.015 * sway);
    this.head.rotation.set(
      -(this.lean + 0.05 * r + 0.14 * d) * 0.75 + 0.015 * br + 0.45 * dorm,
      -0.1 * r * sn + 0.06 * sway * (1 - dorm),
      -this.roll * 0.45 - 0.02 * sway,
    );

    // Legs: forward swing is negative x; knees bend most just after toe-off.
    const A = 0.72 * r;
    const knee = (p) => r * (0.12 + Math.pow(Math.max(0, Math.cos(p + 0.35)), 1.4));
    this.thighL.rotation.x = k(this.thighL.rotation.x, -A * sn * nd - 0.85 * d - 0.04 * dorm);
    this.thighR.rotation.x = k(this.thighR.rotation.x, A * sn * nd + 0.55 * d + 0.02 * dorm);
    this.shinL.rotation.x = k(this.shinL.rotation.x, (knee(ph) + 0.05 + 0.04 * Math.max(0, sway)) * nd + 0.4 * d + 0.12 * dorm);
    this.shinR.rotation.x = k(this.shinR.rotation.x, (knee(ph + Math.PI) + 0.05 + 0.04 * Math.max(0, -sway)) * nd + 1.05 * d + 0.08 * dorm);
    this.thighL.rotation.z = 0.03;
    this.thighR.rotation.z = -0.03;

    // Arms: opposite to the legs, elbows bend with speed; the weapon arm swings less.
    const out = this.look.body === 'brute' ? 0.17 : this.look.body === 'female' ? 0.09 : 0.08;
    const armA = 0.6 * r, wa = this.armed ? 0.55 : 1;
    this.armL.rotation.x = k(this.armL.rotation.x, armA * sn * nd + 0.9 * d - 0.12 * dorm, 18);
    this.armR.rotation.x = k(this.armR.rotation.x, -armA * sn * wa * nd + 0.75 * d - 0.16 * dorm, 18);
    this.armL.rotation.z = k(this.armL.rotation.z, out + 0.05 * r + 0.3 * d + 0.012 * br, 14);
    this.armR.rotation.z = k(this.armR.rotation.z, -(out + 0.05 * r + 0.3 * d + 0.012 * br), 14);
    this.armL.rotation.y = k(this.armL.rotation.y, 0, 14);
    this.armR.rotation.y = k(this.armR.rotation.y, 0, 14);
    this.foreL.rotation.x = k(this.foreL.rotation.x, -(0.12 + 0.75 * r + 0.25 * r * Math.max(0, -sn)) * nd - 0.15 * d - 0.2 * dorm, 18);
    const fr = this.armed ? 0.24 + 0.5 * r : 0.12 + 0.8 * r;
    this.foreR.rotation.x = k(this.foreR.rotation.x, -(fr + 0.2 * r * Math.max(0, sn)) * nd - 0.2 * d - 0.15 * dorm, 18);

    this.combat(dt, s);
    stepHarvestPose(this, dt, s);

    // Cloth panels: the front rides the leading thigh, the back trails with speed (springs).
    const fT = clamp(Math.min(this.thighL.rotation.x, this.thighR.rotation.x) * 0.75 - 0.05 * r - 0.12 * d, -1, 0.15);
    const bT = clamp(Math.max(this.thighL.rotation.x, this.thighR.rotation.x) * 0.4 + 0.2 * r + 0.55 * d + 0.03 * Math.sin(this.t * 7) * r, -0.2, 1.1);
    spring(this.cf, fT, 120, 12, dt);
    spring(this.cb, bT, 90, 9, dt);
    this.clothF.rotation.x = this.cf.x;
    this.clothB.rotation.x = this.cb.x;

    this.blob.scale.setScalar(this.blobSize * (1 + this.dash * 0.2));
    this.blob.visible = (s.wade || 0) < 0.4;
    // Hit flash fades fast (80 ms at full, DESIGN §7).
    this.flashA = Math.max(0, this.flashA - dt * 6);
    this.flashU.set(this.flashCol.r, this.flashCol.g, this.flashCol.b, Math.min(1, this.flashA) * 0.85);
  }

  // ---- Combat layer --------------------------------------------------------------------------------------
  combat(dt, s) {
    const act = s.act | 0, t = s.actT || 0, M = tuning.melee;
    const T = { cx: 0, cy: 0, sx: 0, sy: 0, hx: 0, hy: 0 };
    const limbs = this._limbs || (this._limbs = {});
    for (const kk in limbs) limbs[kk] = null;
    let w = 0, spin = 0, lunge = 0;
    const set = (name, x, z, y) => { limbs[name] = [x, z, y]; };

    if (act >= ACT.SWING1 && act <= ACT.SWING3) {
      const stage = act - ACT.SWING1 + 1, st = M.stages[stage - 1];
      const tw = st.windup, ta = st.active, tr = st.recover;
      let p;
      if (t < tw) { p = 0; w = sm(t / tw); }
      else if (t < tw + ta) { p = easeOutCubic((t - tw) / ta); w = 1; }
      else { p = 1; w = 1 - sm((t - tw - ta) / tr); }
      lunge = w;
      const raised = stage === 1 ? 0 : stage === 2 ? 1 : 0;
      const from = raised === 0 ? -1 : 1, to = stage === 3 ? -1 : -from;
      const side = from + (to - from) * p; // −1 = sword out to the right, +1 = across to the left
      if (stage === 3) spin = p * TAU;
      T.cy = side * 0.62 * (stage === 3 ? 0.6 : 1); T.sy = side * 0.2;
      T.cx = stage === 3 ? 0.1 : 0.04; T.hy = stage === 3 ? -0.09 : -0.03;
      set('armR', -1.32 - 0.12 * Math.abs(p - 0.5), 0.15 + side * 0.98);
      set('foreR', stage === 3 ? -0.12 : -0.85 + 0.65 * p);
      set('armL', -0.25 + 0.2 * side, 0.32 + 0.1 * Math.abs(side));
      set('foreL', -0.6);
    } else if (act === ACT.RIPOSTE) {
      const p = clamp(t / 0.45, 0, 1);
      w = Math.sin(p * Math.PI);
      T.cx = -0.22; T.hx = -0.15; T.hy = -0.05;
      set('armR', -0.5, -1.35); set('armL', -0.5, 1.35); set('foreR', -0.2); set('foreL', -0.2);
    } else if (act === ACT.LUNGE) {
      // Estocada: blade arm thrust straight out, body low and forward, free arm back.
      const L = SKILLS.lunge;
      w = t < L.windup ? sm(t / L.windup) : 1 - sm((t - L.windup - L.time) / L.recover);
      lunge = w;
      T.cx = 0.2; T.cy = -0.4; T.sy = -0.15; T.hy = -0.1;
      set('armR', -1.58, 0.05); set('foreR', -0.05);
      set('armL', 0.55, 0.3); set('foreL', -0.35);
    } else if (act === ACT.THROW) {
      // Hoja de viento: wound back to the right, then a wide flat cut across.
      const Wv = SKILLS.wave;
      const p = t < Wv.windup ? 0 : easeOutCubic(clamp((t - Wv.windup) / 0.1, 0, 1));
      w = t < Wv.windup ? sm(t / Wv.windup) : 1 - sm((t - Wv.windup - 0.08) / Wv.recover);
      const side = -1 + 2 * p;
      T.cy = side * 0.7; T.sy = side * 0.25; T.cx = 0.06; T.hy = -0.04;
      set('armR', -1.45, 0.15 + side * 1.05); set('foreR', -0.3 + 0.25 * p);
      set('armL', -0.3 + 0.2 * side, 0.35); set('foreL', -0.6);
    } else if (act === ACT.BLAST) {
      // Descarga: both pistols forward together, then the kick.
      const kick = t < SKILLS.blast.windup ? 0 : Math.max(0, 1 - (t - SKILLS.blast.windup) / 0.18);
      w = 1;
      T.cx = -0.18 * kick; T.sx = -0.08 * kick; T.hy = -0.04;
      set('armR', -1.5 - 0.6 * kick, 0.22); set('foreR', -0.08 - 0.3 * kick);
      set('armL', -1.5 - 0.6 * kick, -0.22); set('foreL', -0.08 - 0.3 * kick);
    } else if (act === ACT.CAST) {
      // Lluvia / paso de humo: pistol raised to the sky.
      const p = clamp(t / 0.12, 0, 1);
      w = t < 0.25 ? sm(p) : 1 - sm((t - 0.25) / 0.15);
      T.cx = -0.12; T.hx = -0.2;
      set('armR', -2.85, -0.2); set('foreR', -0.08);
      set('armL', -0.4, 0.3); set('foreL', -0.7);
    } else if (act === ACT.CHARGE) {
      // Timón (M4.7): the wheel cocked back at the right shoulder, the free arm forward to aim; it trembles when full.
      const W = SKILLS.wheel, k = clamp(t / W.charge, 0, 1), full = k >= 1 ? Math.sin(this.t * 60) * 0.03 : 0;
      w = sm(clamp(t / 0.12, 0, 1));
      T.cy = 0.35 + 0.25 * k + full; T.sy = 0.12 * k; T.cx = -0.06; T.hy = -0.04 * k;
      set('armR', -1.0 - 0.5 * k, -0.9 - 0.35 * k + full); set('foreR', -1.5);
      set('armL', -1.35, 0.15); set('foreL', -0.25);
    } else if (act === ACT.LEAP) {
      // Abordaje: crouch (the first 15 %), stretch in the air with the blade high, squash on landing.
      const L = SKILLS.leap, air = this.leapAir || L.air, u = clamp((t - L.windup) / air, 0, 1.6);
      const crouch = u < 0.15 ? sm(u / 0.15) * (1 - u / 0.15) + (t < L.windup ? sm(t / L.windup) : 0) : 0;
      const fly = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
      const land = u >= 1 ? Math.max(0, 1 - (u - 1) / 0.35) : 0;
      w = Math.max(crouch, fly, land);
      T.cx = 0.3 * crouch - 0.25 * fly + 0.35 * land; T.hy = -0.12 * crouch - 0.1 * land; T.sx = 0.15 * land;
      set('armR', -2.4 * fly - 0.6 * land - 0.3 * crouch, -0.2); set('foreR', -0.4);
      set('armL', -0.9 * fly + 0.4 * land, 0.6 * fly + 0.3); set('foreL', -0.5);
      if (land > 0 && !this.landed) { this.landed = true; this.sy.v -= 2.4; this.sz.v += 1.2; }
      if (u < 1) this.landed = false;
    } else if (act === ACT.STAGGER) {
      w = Math.max(0, 1 - t / 0.35);
      T.sx = -0.3; T.cx = -0.2; T.hx = -0.25; T.hy = -0.06;
      set('armR', 0.35, -0.6); set('armL', 0.35, 0.6);
    } else if (act === ACT.DEAD && !this.look.enemy) {
      this.downW = damp(this.downW, 1, 5, dt);
    }
    if (act !== ACT.DEAD) this.downW = damp(this.downW, 0, 8, dt);

    const pist = this.weaponKind === 'pistolas';
    // Pistols firing: both arms out to the front, each kicking up on its own shot.
    this.shootW = damp(this.shootW, act === ACT.SHOOT ? 1 : 0, act === ACT.SHOOT ? 30 : 7, dt);
    this.recoilL = Math.max(0, this.recoilL - dt * 7); this.recoilR = Math.max(0, this.recoilR - dt * 7);
    const sw = this.shootW * (1 - w);
    if (sw > 0.01) {
      w = Math.max(w, sw);
      const rl = easeOutCubic(this.recoilL), rr = easeOutCubic(this.recoilR);
      T.cx += -0.03 * sw; T.cy += 0.05 * (rr - rl) * sw;
      set('armR', -1.52 - 0.42 * rr, 0.14); set('foreR', -0.06 - 0.35 * rr);
      set('armL', -1.52 - 0.42 * rl, -0.14); set('foreL', -0.06 - 0.35 * rl);
    }

    // Guard: blade up across the body (pistols: forearms crossed in front of the chest).
    this.parryW = damp(this.parryW, act === ACT.GUARD ? 1 : 0, act === ACT.GUARD ? 40 : 9, dt);
    const pw = this.parryW * (1 - w);
    if (pw > 0.01) {
      w = Math.max(w, pw);
      T.cy += (pist ? 0.05 : 0.3) * pw; T.sx += -0.04 * pw; T.hy += -0.04 * pw;
      if (pist) { set('armR', -1.25, 0.78); set('foreR', -1.75); set('armL', -1.25, -0.78); set('foreL', -1.75); }
      else { set('armR', -1.3, 0.5); set('foreR', -1.55); set('armL', -0.95, 0.32); set('foreL', -0.95); }
    }

    // Enemy attacks (timeline from the wind-up event, see GameScene).
    const a = this.attack;
    if (a) {
      const tt = a.t, f = a.t - a.windup;
      const ew = tt < a.windup ? sm(tt / Math.min(0.2, a.windup)) : 1 - sm((f - a.fire) / 0.35);
      if (ew <= 0 && f > a.fire) this.attack = null;
      else {
        const p = clamp(tt / a.windup, 0, 1), q = clamp(f / Math.max(0.08, a.fire * 0.5), 0, 1);
        w = Math.max(w, ew);
        const pz = POSE[a.id] || a.id;
        if (pz === 'volley') {
          // Bow arm forward, string hand pulled back to the cheek; snaps open on release.
          T.cy = -0.45; T.hy = 0;
          set('armL', -1.55, 0.05); set('foreL', 0.0);
          if (f < 0) { set('armR', -1.45, 0.3 + 0.25 * p); set('foreR', -1.2 - 1.0 * p); }
          else { set('armR', -1.3, -0.25 - 0.25 * q); set('foreR', -1.1 + 0.6 * q); }
        } else if (pz === 'cleave') {
          if (f < 0) { T.cx = -0.25 * p; T.sx = -0.1 * p; set('armR', -2.6 * p - 0.3, -0.15); set('armL', -2.4 * p - 0.3, 0.2); set('foreR', -0.4); set('foreL', -0.4); }
          else { T.cx = 0.45 * q; T.sx = 0.22 * q; T.hy = -0.12 * q; set('armR', -2.9 + 2.1 * q, -0.15); set('armL', -2.7 + 1.9 * q, 0.2); set('foreR', -0.3); set('foreL', -0.3); }
        } else if (pz === 'spikes') {
          if (f < 0) { T.cy = -0.6 * p; set('armR', -0.6, -1.0 * p - 0.2); set('foreR', -0.3); set('armL', -0.4, 0.4); }
          else { T.cy = -0.6 + 1.2 * q; set('armR', -1.3, -1.2 + 1.8 * q); set('foreR', -0.15); set('armL', -0.4, 0.4); }
        } else if (pz === 'orb') {
          T.cx = -0.15 * p;
          if (f < 0) { set('armR', -1.8 * p, -0.2); set('armL', -1.8 * p, 0.2); set('foreR', -0.5); set('foreL', -0.5); }
          else { T.cx = 0.15; set('armR', -1.55, -0.1); set('armL', -1.55, 0.1); set('foreR', -0.05); set('foreL', -0.05); }
        } else if (pz === 'raise') {
          // Both arms up (casting): the spiral / ring / summon leaves from above the head.
          T.cx = -0.12 * p; T.hy = 0.02 * p;
          if (f < 0) { set('armR', -2.7 * p, -0.25); set('armL', -2.7 * p, 0.25); set('foreR', -0.3); set('foreL', -0.3); }
          else { T.cx = 0.1; set('armR', -2.9, -0.6 - 0.5 * q); set('armL', -2.9, 0.6 + 0.5 * q); set('foreR', -0.1); set('foreL', -0.1); }
        } else if (pz === 'spread') {
          // Arms flung wide: the rings burst outward.
          if (f < 0) { T.cx = -0.2 * p; set('armR', -0.6, -0.2 - 0.4 * p); set('armL', -0.6, 0.2 + 0.4 * p); set('foreR', -1.2 * p); set('foreL', -1.2 * p); }
          else { T.cx = 0.12; T.hy = -0.06 * q; set('armR', -0.2, -1.45); set('armL', -0.2, 1.45); set('foreR', -0.1); set('foreL', -0.1); }
        } else if (pz === 'ball') {
          // the cannon has its own view; nothing to pose
        }
      }
    }
    if (a) a.t += dt;

    // Torso offsets (damped so actions blend into each other), then limbs (the next frame's damping
    // in update() eases them back).
    const ao = this.ao, lam = 26;
    for (const kk of ['cx', 'cy', 'sx', 'sy', 'hx', 'hy']) ao[kk] = damp(ao[kk], T[kk] * w + (kk === 'hy' ? 0 : 0), lam, dt);
    this.chest.rotation.x += ao.cx; this.chest.rotation.y += ao.cy;
    this.spine.rotation.x += ao.sx; this.spine.rotation.y += ao.sy;
    this.head.rotation.x += ao.hx - ao.cx * 0.5;
    this.hips.position.y += ao.hy;
    if (w > 0.001) {
      for (const name in limbs) {
        const v = limbs[name];
        if (!v) continue;
        const b = this[name];
        b.rotation.x += (v[0] - b.rotation.x) * w;
        if (v[1] !== undefined) b.rotation.z += (v[1] - b.rotation.z) * w;
      }
      if (lunge > 0) {
        this.thighL.rotation.x += (-0.4 - this.thighL.rotation.x) * lunge * 0.8;
        this.thighR.rotation.x += (0.3 - this.thighR.rotation.x) * lunge * 0.8;
        this.shinR.rotation.x += (0.4 - this.shinR.rotation.x) * lunge * 0.8;
        this.shinL.rotation.x += (0.25 - this.shinL.rotation.x) * lunge * 0.8;
      }
    }
    this.body.rotation.y = spin;

    // Flinch (hit impulse) on top of everything.
    this.hitK = Math.max(0, this.hitK - dt * 5);
    const hk = Math.sin(Math.min(1, this.hitK) * Math.PI * 0.5) * this.hitDir;
    if (hk) {
      this.spine.rotation.x -= 0.22 * hk; this.chest.rotation.x -= 0.15 * hk; this.head.rotation.x -= 0.2 * hk;
      this.armL.rotation.z += 0.25 * Math.abs(hk); this.armR.rotation.z -= 0.25 * Math.abs(hk);
    }

    // Down (players at 0 HP): kneel and slump.
    const dw = this.downW;
    if (dw > 0.001) {
      this.hips.position.y -= 0.42 * dw;
      this.thighL.rotation.x += (-1.5 - this.thighL.rotation.x) * dw; this.thighR.rotation.x += (-0.6 - this.thighR.rotation.x) * dw;
      this.shinL.rotation.x += (1.9 - this.shinL.rotation.x) * dw; this.shinR.rotation.x += (2.1 - this.shinR.rotation.x) * dw;
      this.spine.rotation.x += 0.55 * dw; this.chest.rotation.x += 0.25 * dw; this.head.rotation.x += 0.35 * dw;
      this.armL.rotation.x += (-0.25 - this.armL.rotation.x) * dw; this.armR.rotation.x += (-0.35 - this.armR.rotation.x) * dw;
    }
  }
}

// Renders a head-and-shoulders portrait of any look with the real model (HUD, skin picker).
export class PortraitStudio {
  constructor(renderer, size = 256) {
    this.r = renderer;
    this.size = size;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
    const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
    key.position.set(1.4, 2.4, 2.2);
    this.scene.add(key, new THREE.HemisphereLight(0xc9e4ff, 0x6a4a3a, 1.05));
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.buf = new Uint8Array(size * size * 4);
    this.views = new Map();
  }

  // Returns a canvas (size × size, transparent background). Cached per look (one readback each).
  render(skinIdx) {
    if (!this.done) this.done = new Map();
    if (this.done.has(skinIdx)) return this.done.get(skinIdx);
    let v = this.views.get(skinIdx);
    if (!v) {
      v = new CharacterView(skinIdx, { sword: false });
      v.blob.visible = false;
      v.update(0, { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, wade: 1 });
      this.views.set(skinIdx, v);
    }
    this.scene.add(v.root);
    v.root.updateMatrixWorld(true);
    const hy = v.head.getWorldPosition(new THREE.Vector3()).y;
    const big = v.look.body === 'brute' ? 1.45 : 1;
    this.cam.position.set(0.36 * big, hy + 0.12 * big, 1.0 * big);
    this.cam.lookAt(0, hy + 0.09 * big, 0);
    const r = this.r, prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha(), prevAuto = r.autoClear;
    // Studio light only: no cloud shadows, local lights or night fill; alpha is coverage, not glow.
    const cloud = U.mnCloud.value, nLights = U.mnLightCount.value, fill = U.mnCharFill.value.clone();
    U.mnCloud.value = 0; U.mnLightCount.value = 0; U.mnGlowOut.value = 0; U.mnCharFill.value.setRGB(0, 0, 0);
    r.autoClear = true;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.cam);
    r.readRenderTargetPixels(this.rt, 0, 0, this.size, this.size, this.buf);
    r.setRenderTarget(null);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAuto;
    U.mnCloud.value = cloud; U.mnLightCount.value = nLights; U.mnGlowOut.value = 1; U.mnCharFill.value.copy(fill);
    this.scene.remove(v.root);
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.size, this.size);
    const row = this.size * 4;
    for (let y = 0; y < this.size; y++) img.data.set(this.buf.subarray((this.size - 1 - y) * row, (this.size - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    this.done.set(skinIdx, c);
    return c;
  }
}

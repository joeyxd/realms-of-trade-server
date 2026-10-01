// Characters: adult, faceted low-poly looks (charlooks.js) on a 15-bone rig with knees, elbows and
// cloth panels. One SkinnedMesh per character (1 draw call per pass). Procedural animation:
// idle breathing and weight shift, run cycle with knee/elbow bend and hip/shoulder counter-rotation,
// dash lean and tuck, turn roll, subtle squash, spring-driven secondary motion on coats and flaps.
import * as THREE from 'three';
import { blobTexture } from './geo.js';
import { toon, U } from './toon.js';
import { LAYER } from './pipeline.js';
import { BONES, makeBones } from './charkit.js';
import { LOOKS, buildLook } from './charlooks.js';
import { damp, angleDelta, clamp, spring } from '../core/math.js';

export const SKINS = LOOKS;
export const SENTINEL = LOOKS.findIndex((l) => l.enemy);
const TAU = Math.PI * 2;

const mats = new Map();
// 'base' for people, 'sentinel' for the dormant skeletons (slow glow pulse driven by the scene).
export function characterMaterial(kind = 'base') {
  let m = mats.get(kind);
  if (!m) {
    const glow = { value: kind === 'sentinel' ? 0.5 : 1 };
    // Stronger rim than the props so slim adult silhouettes separate from the ground.
    m = toon({ color: 0xffffff, vertexColors: true }, { rim: true, glow: true, softBand: true, key: 'char', uniforms: { mnGlowAmt: glow, mnRimStr: { value: 0.85 } } });
    m.flatShading = true;
    m.userData.glow = glow;
    mats.set(kind, m);
  }
  return m;
}

let blobGeo = null, blobMat = null;

export class CharacterView {
  constructor(skinIdx = 0, { sword = true, pose = null } = {}) {
    const L = LOOKS[skinIdx] || LOOKS[0];
    this.look = L;
    this.skin = skinIdx;
    this.armed = sword && !!L.weapon;
    const built = buildLook(skinIdx, this.armed);
    this.height = built.height;
    this.rigKey = built.key;
    this.pose = pose;
    this.root = new THREE.Group();
    this.bones = makeBones(built.J);
    BONES.forEach((n, i) => { this[n] = this.bones[i]; });
    this.restHipsY = this.hips.position.y;
    this.mesh = new THREE.SkinnedMesh(built.geo, characterMaterial(L.enemy ? 'sentinel' : 'base'));
    this.mesh.add(this.body);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, built.height * 0.5, 0.1), built.height * 0.8);
    this.root.add(this.mesh);
    this.meshes = [this.mesh];

    if (!blobGeo) {
      blobGeo = new THREE.PlaneGeometry(1.1, 1.1);
      blobGeo.rotateX(-Math.PI / 2);
      blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    this.blob = new THREE.Mesh(blobGeo, blobMat);
    this.blob.layers.set(LAYER.NO_OUTLINE);
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 2;
    this.blobSize = L.body === 'brute' ? 1.45 : L.heavy ? 1.12 : 1;
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
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }

  // s: {x, y, z, f, vx, vz, st (1 = dash), wade}
  update(dt, s) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.root.position.set(s.x, s.y, s.z);
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

    // Stride: one cycle per `stride` u; a footstep when either foot plants (thigh most forward).
    const prev = this.phase;
    this.phase += dt * (speed / this.stride) * TAU * (dashing ? 0.15 : 1);
    const H = Math.PI;
    if (this.run > 0.3 && Math.floor((prev - H / 2) / H) !== Math.floor((this.phase - H / 2) / H)) {
      if (this.onStep) this.onStep(Math.floor((this.phase - H / 2) / H) & 1);
    }
    const r = this.run, d = this.dash, nd = 1 - d, ph = this.phase, sn = Math.sin(ph);
    const idle = (1 - r) * nd;
    const br = Math.sin(this.t * 1.8) * idle;
    const sway = Math.sin(this.t * 0.55 + this.seed) * idle;
    const dorm = this.pose === 'dormant' ? 1 : 0;
    const k = (cur, target, l = 22) => damp(cur, target, l, dt);

    // Subtle squash & stretch (adult proportions: a hint, not a cartoon).
    spring(this.sy, dashing ? 0.95 : 1, 240, 19, dt);
    spring(this.sz, dashing ? 1.05 : 1, 240, 19, dt);
    const sx = 1 / Math.sqrt(Math.max(0.5, this.sy.x * this.sz.x));
    this.body.scale.set(sx, this.sy.x, this.sz.x);
    this.lean = damp(this.lean, 0.09 * r + 0.3 * d, 8, dt);
    this.roll = damp(this.roll, clamp(-turnRate * 0.025, -0.2, 0.2) * r, 7, dt);
    this.body.rotation.set(this.lean, 0, this.roll);

    // Pelvis: two bobs per stride, crouch in the dash, weight shift when idle.
    this.hips.position.y = this.restHipsY - 0.025 * r + 0.04 * r * Math.abs(sn) - 0.07 * d - 0.01 * idle * (0.5 + 0.5 * sway) - 0.04 * dorm;
    this.hips.position.x = 0.012 * sway;
    this.hips.rotation.set(0, -0.16 * r * sn, -0.035 * sway);
    this.spine.rotation.set(0.05 * r + 0.14 * d + 0.14 * dorm, 0.08 * r * sn, 0.02 * sway);
    this.chest.rotation.set(-0.02 * br + 0.04 * r + 0.08 * dorm, 0.13 * r * sn, 0.015 * sway);
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
    this.foreL.rotation.x = k(this.foreL.rotation.x, -(0.12 + 0.75 * r + 0.25 * r * Math.max(0, -sn)) * nd - 0.15 * d - 0.2 * dorm, 18);
    const fr = this.armed ? 0.24 + 0.5 * r : 0.12 + 0.8 * r;
    this.foreR.rotation.x = k(this.foreR.rotation.x, -(fr + 0.2 * r * Math.max(0, sn)) * nd - 0.2 * d - 0.15 * dorm, 18);

    // Cloth panels: the front rides the leading thigh, the back trails with speed (springs).
    const fT = clamp(Math.min(this.thighL.rotation.x, this.thighR.rotation.x) * 0.75 - 0.05 * r - 0.12 * d, -1, 0.15);
    const bT = clamp(Math.max(this.thighL.rotation.x, this.thighR.rotation.x) * 0.4 + 0.2 * r + 0.55 * d + 0.03 * Math.sin(this.t * 7) * r, -0.2, 1.1);
    spring(this.cf, fT, 120, 12, dt);
    spring(this.cb, bT, 90, 9, dt);
    this.clothF.rotation.x = this.cf.x;
    this.clothB.rotation.x = this.cb.x;

    this.blob.scale.setScalar(this.blobSize * (1 + this.dash * 0.2));
    this.blob.visible = (s.wade || 0) < 0.4;
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
    const cloud = U.mnCloud.value;
    U.mnCloud.value = 0;
    r.autoClear = true;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.cam);
    r.readRenderTargetPixels(this.rt, 0, 0, this.size, this.size, this.buf);
    r.setRenderTarget(null);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAuto;
    U.mnCloud.value = cloud;
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

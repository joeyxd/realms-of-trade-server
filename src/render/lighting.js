// Sun / moon (shadow frustum follows the player, texel-snapped), hemisphere fill, fog, sky, and the
// lighting presets. Two layers are blended every frame:
//   base  = time of day: a fixed preset (day / dusk / night) or the day–night cycle
//   zone  = La Caldera's "volcanic night" on top (smoke hides the sky; lava and braziers light it)
// A preset also carries the local-light knobs, the water's light, the bloom strength, the ambient
// light on smoke and dust (fxLight) and the final grading, which GameScene copies to their owners.
import * as THREE from 'three';
import { SKY } from './sky.js';
import { U } from './toon.js';
import { damp } from '../core/math.js';

const C = (hex) => new THREE.Color(hex);
const CL = (r, g, b) => new THREE.Color().setRGB(r, g, b); // linear (light amounts)
const PRESETS = {
  day: {
    sun: C(0xfff0d6), sunI: 2.45, el: 54, az: 28,
    hemiSky: C(0xbfe4ff), hemiGround: C(0xf3d8a6), hemiI: 0.95,
    skyTop: C(0x3a9fe6), skyHorizon: C(0xc4ecf7), skyBottom: C(0x7fd3e0), fog: C(0xb9e6f2), fogNear: 220, fogFar: 950,
    cloudCol: C(0xffffff), stars: 0, sunDisc: 1,
    rim: C(0xa8dcff), fill: CL(0, 0, 0), lava: 1.0, cloud: 0.32,
    fire: 0.3, lavaLight: 0.6, windows: 0, player: 0,
    water: C(0xffffff), sparkle: 1, foam: 1,
    contrast: 0.16, sat: 1.12, vignette: 0.28, splitShadow: C(0x5a4aa0), splitHigh: C(0xffd9a0), split: 0.05,
    bloom: 0.35, glints: 0.15, fxLight: CL(1, 1, 1),
  },
  golden: {
    sun: C(0xffb36a), sunI: 2.3, el: 30, az: 44,
    hemiSky: C(0xffc6a8), hemiGround: C(0x8a5040), hemiI: 0.9,
    skyTop: C(0x5a6fd6), skyHorizon: C(0xffc28a), skyBottom: C(0xe79b7a), fog: C(0xf0b48c), fogNear: 200, fogFar: 900,
    cloudCol: C(0xffd2b8), stars: 0, sunDisc: 1,
    rim: C(0xff9ad1), fill: CL(0.12, 0.1, 0.08), lava: 1.35, cloud: 0.18,
    fire: 0.55, lavaLight: 0.9, windows: 0.45, player: 0.1,
    water: C(0xffe2d0), sparkle: 1.1, foam: 1,
    contrast: 0.19, sat: 1.1, vignette: 0.33, splitShadow: C(0x5a3c9a), splitHigh: C(0xffb070), split: 0.08,
    bloom: 0.55, glints: 0.25, fxLight: CL(1, 0.8, 0.66),
  },
  night: {
    sun: C(0x9fb2ff), sunI: 0.9, el: 58, az: -18,
    hemiSky: C(0x3c4e8e), hemiGround: C(0x1e1a34), hemiI: 0.7,
    skyTop: C(0x080c26), skyHorizon: C(0x26386a), skyBottom: C(0x0e1834), fog: C(0x18223f), fogNear: 160, fogFar: 700,
    cloudCol: C(0x3a4a72), stars: 1, sunDisc: 0.8,
    rim: C(0x86a2ff), fill: CL(0.5, 0.52, 0.72), lava: 1.25, cloud: 0.12,
    fire: 1, lavaLight: 1, windows: 1, player: 0.3,
    water: C(0x3a4c78), sparkle: 0.4, foam: 0.62,
    contrast: 0.25, sat: 0.98, vignette: 0.44, splitShadow: C(0x3438b0), splitHigh: C(0xffb060), split: 0.16,
    bloom: 0.9, glints: 0.6, fxLight: CL(0.24, 0.28, 0.45),
  },
  volcanic: {
    sun: C(0xff8c5a), sunI: 0.85, el: 40, az: 60,
    hemiSky: C(0x6c3450), hemiGround: C(0x2a1418), hemiI: 0.72,
    skyTop: C(0x1c0e18), skyHorizon: C(0x7a2c16), skyBottom: C(0x2a120e), fog: C(0x3a1a16), fogNear: 50, fogFar: 260,
    cloudCol: C(0x2e2224), stars: 0, sunDisc: 0,
    rim: C(0xff7a4a), fill: CL(0.75, 0.48, 0.38), lava: 1.55, cloud: 0.42,
    fire: 1, lavaLight: 1.2, windows: 0, player: 0.5,
    water: C(0x6a3a30), sparkle: 0.2, foam: 0.6,
    contrast: 0.28, sat: 1.12, vignette: 0.46, splitShadow: C(0x4a2a90), splitHigh: C(0xff9040), split: 0.18,
    bloom: 1.0, glints: 0.3, fxLight: CL(0.42, 0.27, 0.24),
  },
};
PRESETS.dusk = PRESETS.golden;
const KEYS = Object.keys(PRESETS.day);

// Day–night cycle keyframes on the cycle phase [0, 1): long day, dusk, long night, dawn.
const CYCLE = [[0, 'day'], [0.46, 'day'], [0.53, 'golden'], [0.6, 'night'], [0.9, 'night'], [0.96, 'golden'], [1, 'day']];

function clonePreset(p) {
  const o = {};
  for (const k of KEYS) o[k] = p[k] && p[k].isColor ? p[k].clone() : p[k];
  return o;
}
function blend(out, a, b, t) {
  for (const k of KEYS) {
    if (a[k].isColor) out[k].copy(a[k]).lerp(b[k], t);
    else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}
const ease = (t) => t * t * (3 - 2 * t);

export class Lighting {
  constructor(scene, { shadowSize = 2048, shadowHalf = 30, cycleSeconds = 960 } = {}) {
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -shadowHalf; cam.right = shadowHalf; cam.top = shadowHalf; cam.bottom = -shadowHalf;
    cam.near = 1; cam.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.shadowHalf = shadowHalf;
    this.target = new THREE.Object3D();
    this.sun.target = this.target;
    scene.add(this.sun, this.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xb9e6f2, 220, 950);
    this.dir = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.basis = new THREE.Matrix4();
    this.inv = new THREE.Matrix4();
    this.lavaU = null;
    // Time of day.
    this.tod = 'day';
    this.cycleSeconds = cycleSeconds;
    this.phase = 0.08; // morning
    this.base = clonePreset(PRESETS.day);
    this.snap = clonePreset(PRESETS.day);
    this.snapT = 1;
    this.snapSpeed = 0.5;
    this.target0 = clonePreset(PRESETS.day);
    // Zone layer.
    this.zoneW = 0;
    this.zoneTarget = 0;
    this.zoneSpeed = 0.5;
    this.cur = clonePreset(PRESETS.day);
    this.apply();
  }

  setShadowSize(size) {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  // 'cycle' | 'day' | 'dusk' | 'night'. Blends from whatever is on screen now.
  setTimeOfDay(mode, seconds = 2) {
    if (!PRESETS[mode] && mode !== 'cycle') mode = 'cycle';
    if (mode === this.tod) return;
    this.tod = mode;
    for (const k of KEYS) { if (this.base[k].isColor) this.snap[k].copy(this.base[k]); else this.snap[k] = this.base[k]; }
    this.snapT = seconds > 0 ? 0 : 1;
    this.snapSpeed = 1 / Math.max(0.01, seconds);
  }

  // Jump the cycle (0 = dawn's end, 0.5 = dusk, 0.75 = midnight).
  setPhase(p) { this.phase = ((p % 1) + 1) % 1; }

  // Zone override: volcanic night inside La Caldera.
  setZone(volcanic, seconds = 2) {
    this.zoneTarget = volcanic ? 1 : 0;
    this.zoneSpeed = 1 / Math.max(0.01, seconds);
  }

  // Kept for older callers: 'golden' meant the Caldera.
  setPreset(name, seconds = 2) { this.setZone(name === 'golden' || name === 'volcanic', seconds); }

  baseTarget() {
    if (this.tod !== 'cycle') return PRESETS[this.tod];
    const ph = this.phase;
    let i = 0;
    while (i < CYCLE.length - 2 && ph >= CYCLE[i + 1][0]) i++;
    const [p0, a] = CYCLE[i], [p1, b] = CYCLE[i + 1];
    return blend(this.target0, PRESETS[a], PRESETS[b], ease((ph - p0) / Math.max(1e-6, p1 - p0)));
  }

  // 0 = full day, 1 = full night (for audio, ambience and gameplay hints).
  get darkness() { return THREE.MathUtils.clamp((2.45 - this.cur.sunI) / 1.45, 0, 1); }

  apply() {
    const p = this.cur;
    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunI;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiI;
    SKY.skyTop.value.copy(p.skyTop);
    SKY.skyHorizon.value.copy(p.skyHorizon);
    SKY.skyBottom.value.copy(p.skyBottom);
    SKY.sunColor.value.copy(p.sun);
    SKY.skyCloud.value.copy(p.cloudCol);
    SKY.skyStars.value = p.stars;
    SKY.sunDisc.value = p.sunDisc;
    this.scene.fog.color.copy(p.fog);
    this.scene.fog.near = p.fogNear;
    this.scene.fog.far = p.fogFar;
    U.mnRimColor.value.copy(p.rim);
    U.mnCharFill.value.copy(p.fill);
    U.mnCloud.value = p.cloud;
    U.mnShadowTint.value.copy(p.splitShadow); // the grading's shadow colour also tints the toon shadow band (toon.js)
    if (this.lavaU) this.lavaU.value = p.lava;
    const el = THREE.MathUtils.degToRad(p.el);
    const az = THREE.MathUtils.degToRad(p.az);
    // From the west (screen top-left), rotated toward the south by az.
    this.dir.set(-Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    SKY.sunDir.value.copy(this.dir);
    this.basis.lookAt(this.dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    this.inv.copy(this.basis).invert();
  }

  update(dt, focus) {
    if (this.tod === 'cycle') this.phase = (this.phase + dt / this.cycleSeconds) % 1;
    const target = this.baseTarget();
    if (this.snapT < 1) {
      this.snapT = Math.min(1, this.snapT + dt * this.snapSpeed);
      blend(this.base, this.snap, target, ease(this.snapT));
    } else blend(this.base, target, target, 0);
    if (this.zoneW !== this.zoneTarget) {
      const s = this.zoneSpeed * dt;
      this.zoneW = Math.abs(this.zoneTarget - this.zoneW) <= s ? this.zoneTarget : this.zoneW + Math.sign(this.zoneTarget - this.zoneW) * s;
    }
    blend(this.cur, this.base, PRESETS.volcanic, ease(this.zoneW));
    this.apply();
    // Snap the shadow center to shadow-map texels (in light space) to kill shimmering.
    const texel = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x;
    const p = this.tmp.copy(focus).applyMatrix4(this.inv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.basis);
    this.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.dir, 90);
    this.target.updateMatrixWorld();
  }
}

export { PRESETS, damp };

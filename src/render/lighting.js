// Sun / moon (shadow frustum follows the player, texel-snapped), hemisphere fill, fog, sky, and the
// lighting presets. The sun and the moon move on arcs set by the clock phase (VR11). Two layers are blended every frame:
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
    sun: C(0xfff0d6), sunI: 2.45,
    hemiSky: C(0xbfe4ff), hemiGround: C(0xf3d8a6), hemiI: 0.95,
    skyTop: C(0x3a9fe6), skyHorizon: C(0xc4ecf7), skyBottom: C(0x7fd3e0), fog: C(0xb9e6f2), fogNear: 220, fogFar: 950,
    cloudCol: C(0xffffff), stars: 0, sunDisc: 1, moon: 0,
    rim: C(0xa8dcff), fill: CL(0, 0, 0), lava: 1.0, cloud: 0.32,
    fire: 0.3, lavaLight: 0.6, windows: 0,
    water: C(0xffffff), sparkle: 1, foam: 1,
    contrast: 0.16, sat: 1.12, vignette: 0.28, splitShadow: C(0x5a4aa0), splitHigh: C(0xffd9a0), split: 0.05,
    bloom: 0.35, glints: 0.15, fxLight: CL(1, 1, 1), lightSoft: 0.35, lightBounce: 0,
  },
  golden: {
    sun: C(0xffb36a), sunI: 2.3,
    hemiSky: C(0xffc6a8), hemiGround: C(0x8a5040), hemiI: 0.9,
    skyTop: C(0x5a6fd6), skyHorizon: C(0xffc28a), skyBottom: C(0xe79b7a), fog: C(0xf0b48c), fogNear: 200, fogFar: 900,
    cloudCol: C(0xffd2b8), stars: 0, sunDisc: 1, moon: 0,
    rim: C(0xff9ad1), fill: CL(0.12, 0.1, 0.08), lava: 1.35, cloud: 0.18,
    fire: 0.55, lavaLight: 0.9, windows: 0.45,
    water: C(0xffe2d0), sparkle: 1.1, foam: 1,
    contrast: 0.19, sat: 1.1, vignette: 0.33, splitShadow: C(0x5a3c9a), splitHigh: C(0xffb070), split: 0.08,
    bloom: 0.55, glints: 0.25, fxLight: CL(1, 0.8, 0.66), lightSoft: 0.45, lightBounce: 0.08,
  },
  night: {
    sun: C(0x25304a), sunI: 0.018,
    hemiSky: C(0x2f4287), hemiGround: C(0x141832), hemiI: 1.7,
    skyTop: C(0x080c26), skyHorizon: C(0x10172a), skyBottom: C(0x080b13), fog: C(0x0b1020), fogNear: 100, fogFar: 520,
    cloudCol: C(0x3a4a72), stars: 1, sunDisc: 1, moon: 0.8,
    rim: C(0x000000), fill: CL(0, 0, 0), lava: 1.25, cloud: 0.04,
    fire: 1, lavaLight: 1, windows: 1,
    water: C(0x080d18), sparkle: 0.08, foam: 0.04,
    contrast: 0.12, sat: 0.88, vignette: 0.30, splitShadow: C(0x1c2452), splitHigh: C(0x3a2a1e), split: 0.4,
    bloom: 0.6, glints: 0.05, fxLight: CL(0.025, 0.03, 0.045), lightSoft: 0.5, lightBounce: 0.1,
  },
  volcanic: {
    sun: C(0xff8c5a), sunI: 0.85,
    hemiSky: C(0x6c3450), hemiGround: C(0x2a1418), hemiI: 0.72,
    skyTop: C(0x1c0e18), skyHorizon: C(0x7a2c16), skyBottom: C(0x2a120e), fog: C(0x3a1a16), fogNear: 50, fogFar: 260,
    cloudCol: C(0x2e2224), stars: 0, sunDisc: 0, moon: 0,
    rim: C(0xff7a4a), fill: CL(0.75, 0.48, 0.38), lava: 1.55, cloud: 0.42,
    fire: 1, lavaLight: 1.2, windows: 0,
    water: C(0x6a3a30), sparkle: 0.2, foam: 0.6,
    contrast: 0.28, sat: 1.12, vignette: 0.46, splitShadow: C(0x4a2a90), splitHigh: C(0xff9040), split: 0.18,
    bloom: 1.0, glints: 0.3, fxLight: CL(0.42, 0.27, 0.24), lightSoft: 0.5, lightBounce: 0.12,
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

// VR11 dynamic sun (playtest R2). The clock phase (clock.js phaseAt: 0 = 06:00, 0.25 = noon) moves the sun on a real
// east-to-west arc, a great circle tilted by the latitude (north is -z, east +x): due south at noon, 66 degrees up,
// rising and setting a little north of east and west. The hour angle is stretched so the sun is up exactly while the
// cycle is not night (the night preset holds from 0.6 to 0.9). The moon rides the same arc half a day later and lower.
// A fixed time of day (menu, QA) stands at one phase; 'day' reproduces the old fixed day light (54 up, az 26).
const ARC = { lat: 35, sunDecl: 11, moonDecl: -5, noon: 0.25, halfDay: 0.35 };
const TOD_PHASE = { day: 0.385, golden: 0.53, dusk: 0.53, night: 0.75 };
// The light's elevation is the arc's squeezed into [22, 66] degrees: flat ground keeps N·L above the toon band's lit
// edge (0.30, toon.js), so a low sun never flips the whole floor to the mid tone at once; shadows still stretch to 2.5x.
const LIGHT_EL0 = 22, ARC_TOP = 90 - ARC.lat + ARC.sunDecl;
// The light turns in 0.2-degree steps: texel snapping cannot steady a rotating shadow map, a still one between steps it can.
const STEP_COS = Math.cos(THREE.MathUtils.degToRad(0.2));
// La Caldera keeps its fixed light: 40 up, az 60 (from the west toward the south, the old presets' convention).
const VOLC_EL = THREE.MathUtils.degToRad(40), VOLC_AZ = THREE.MathUtils.degToRad(60);
const VOLCANIC_LIGHT = new THREE.Vector3(-Math.cos(VOLC_EL) * Math.cos(VOLC_AZ), Math.sin(VOLC_EL), Math.cos(VOLC_EL) * Math.sin(VOLC_AZ));
// Twilight glow on the horizon under the sun: gold while it is low, red once it has set.
const TWILIGHT_LOW = C(0xff6a3d), TWILIGHT_HIGH = C(0xffa766);
const ORIGIN = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// Unit direction toward a body on the arc at a clock phase (declination in degrees).
export function arcDir(phase, decl, out = new THREE.Vector3()) {
  const D = THREE.MathUtils.DEG2RAD, f = ARC.lat * D, d = decl * D;
  const h = (((phase - ARC.noon) % 1) + 1.5) % 1 - 0.5, x = Math.abs(h);
  const h0 = Math.acos(-Math.tan(f) * Math.tan(d)); // hour angle of sunset
  const H = Math.sign(h) * (x <= ARC.halfDay ? (x / ARC.halfDay) * h0 : h0 + ((x - ARC.halfDay) / (0.5 - ARC.halfDay)) * (Math.PI - h0));
  const north = Math.cos(f) * Math.sin(d) - Math.sin(f) * Math.cos(d) * Math.cos(H);
  return out.set(-Math.cos(d) * Math.sin(H), Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H), -north);
}

// The light's direction for a body: same azimuth, elevation squeezed into [LIGHT_EL0, ARC_TOP] (LIGHT_EL0 below the horizon).
function lightFrom(out, v) {
  const el = Math.max(0, Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * THREE.MathUtils.RAD2DEG);
  const e = THREE.MathUtils.degToRad(LIGHT_EL0 + el * (1 - LIGHT_EL0 / ARC_TOP));
  const h = Math.hypot(v.x, v.z) || 1;
  return out.set((v.x / h) * Math.cos(e), Math.sin(e), (v.z / h) * Math.cos(e));
}

// Normalized lerp from a snapshot toward the arc position: a time-of-day snap glides the sun along with the colours.
function glide(v, from, t) {
  const x = from.x + (v.x - from.x) * t, y = from.y + (v.y - from.y) * t, z = from.z + (v.z - from.z) * t, l = Math.hypot(x, y, z);
  if (l > 1e-3) v.set(x / l, y / l, z / l);
  return v;
}

export class Lighting {
  constructor(scene, { shadowSize = 2048, shadowHalf = 30, shadowRadius = 0.35, cycleSeconds = 960 } = {}) {
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -shadowHalf; cam.right = shadowHalf; cam.top = shadowHalf; cam.bottom = -shadowHalf;
    cam.near = 1; cam.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    // Narrow PCF taps retain leaf holes in the painted, crisp shadow style without a larger map.
    this.sun.shadow.radius = shadowRadius;
    this.shadowHalf = shadowHalf;
    this.target = new THREE.Object3D();
    this.sun.target = this.target;
    scene.add(this.sun, this.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xb9e6f2, 220, 950);
    this.dir = new THREE.Vector3(); // the light's direction as applied (stepped)
    this.key = new THREE.Vector3(); // where it is heading this frame
    this.tmp = new THREE.Vector3();
    this.basis = new THREE.Matrix4();
    this.inv = new THREE.Matrix4();
    this.fitHalf = 0;
    // Where the sun and the moon really are (the sky draws them there), and their snapshots for a time-of-day snap.
    this.sunPos = new THREE.Vector3();
    this.moonPos = new THREE.Vector3();
    this.snapSun = new THREE.Vector3();
    this.snapMoon = new THREE.Vector3();
    this.lavaU = null;
    // Time of day.
    this.tod = 'day';
    this.gameplay = false;
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
    this.moonW = 0;
    this.place(this.todPhase());
    this.apply();
    this.aim(ORIGIN, 0);
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
    this.snapSun.copy(this.sunPos);
    this.snapMoon.copy(this.moonPos);
    this.snapT = seconds > 0 ? 0 : 1;
    this.snapSpeed = 1 / Math.max(0.01, seconds);
  }

  // Jump the cycle (0 = dawn's end, 0.5 = dusk, 0.75 = midnight).
  setPhase(p) { this.phase = ((p % 1) + 1) % 1; }

  // During play the server clock owns time of day, regardless of a saved menu preference.
  // QA/menu fixtures can explicitly opt out and use setTimeOfDay/setPhase overrides.
  setGameplay(active) { this.gameplay = !!active; }

  // Zone override: volcanic night inside La Caldera.
  setZone(volcanic, seconds = 2) {
    this.zoneTarget = volcanic ? 1 : 0;
    this.zoneSpeed = 1 / Math.max(0.01, seconds);
  }

  // Kept for older callers: 'golden' meant the Caldera.
  setPreset(name, seconds = 2) { this.setZone(name === 'golden' || name === 'volcanic', seconds); }

  baseTarget() {
    if (!this.gameplay && this.tod !== 'cycle') return PRESETS[this.tod];
    const ph = this.phase;
    let i = 0;
    while (i < CYCLE.length - 2 && ph >= CYCLE[i + 1][0]) i++;
    const [p0, a] = CYCLE[i], [p1, b] = CYCLE[i + 1];
    return blend(this.target0, PRESETS[a], PRESETS[b], ease((ph - p0) / Math.max(1e-6, p1 - p0)));
  }

  // The clock phase the sun and the moon stand at: the cycle's, or a fixed time of day's.
  todPhase() { return !this.gameplay && this.tod !== 'cycle' ? TOD_PHASE[this.tod] ?? TOD_PHASE.day : this.phase; }

  place(phase) {
    arcDir(phase, ARC.sunDecl, this.sunPos);
    arcDir(phase + 0.5, ARC.moonDecl, this.moonPos);
  }

  // Sun elevation in degrees (negative below the horizon).
  get sunEl() { return Math.asin(THREE.MathUtils.clamp(this.sunPos.y, -1, 1)) * THREE.MathUtils.RAD2DEG; }

  // 0 = full day, 1 = full night (for audio, ambience and gameplay hints).
  get darkness() { return THREE.MathUtils.clamp((2.45 - this.cur.sunI) / 1.45, 0, 1); }

  apply() {
    const p = this.cur;
    this.sun.color.copy(p.sun);
    // While the light swings from the set sun to the moon (aim) it dips to nothing, so the turn never shows.
    this.sun.intensity = p.sunI * (1 - 2 * this.moonW) ** 2;
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
    SKY.moonDisc.value = p.moon;
    SKY.skySun.value.copy(this.sunPos);
    SKY.skyMoon.value.copy(this.moonPos);
    // The twilight builds while the sun sinks from 16 to 3 degrees and dies out between 3 and 14 below the horizon;
    // La Caldera's smoke hides it with the disc.
    const el = this.sunEl;
    SKY.skyTwilightW.value = 0.75 * (1 - THREE.MathUtils.smoothstep(el, 3, 16)) * THREE.MathUtils.smoothstep(el, -14, -3) * p.sunDisc;
    SKY.skyTwilight.value.copy(TWILIGHT_LOW).lerp(TWILIGHT_HIGH, THREE.MathUtils.smoothstep(el, -6, 8));
    this.scene.fog.color.copy(p.fog);
    this.scene.fog.near = p.fogNear;
    this.scene.fog.far = p.fogFar;
    U.mnRimColor.value.copy(p.rim);
    U.mnCharFill.value.copy(p.fill);
    U.mnCloud.value = p.cloud;
    U.mnShadowTint.value.copy(p.splitShadow); // the grading's shadow colour also tints the toon shadow band (toon.js)
    if (this.lavaU) this.lavaU.value = p.lava;
  }

  // The one directional light: the sun until it has faded (moonW, from dayW), then the moon; it turns only in the middle
  // of the swap, where apply() has dimmed it to almost nothing. La Caldera's light on top. The shadow box follows the
  // focus, texel-snapped, and is refitted whenever the light steps.
  aim(focus, zoneW) {
    const key = lightFrom(this.key, this.sunPos).lerp(lightFrom(this.tmp, this.moonPos), THREE.MathUtils.smoothstep(this.moonW, 0.3, 0.7));
    key.normalize().lerp(VOLCANIC_LIGHT, zoneW).normalize();
    if (this.dir.dot(key) < STEP_COS || this.fitHalf !== this.shadowHalf) {
      this.dir.copy(key);
      SKY.sunDir.value.copy(key);
      this.basis.lookAt(this.dir, ORIGIN, UP);
      this.inv.copy(this.basis).invert();
      this.fitShadow();
    }
    const cam = this.sun.shadow.camera, size = this.sun.shadow.mapSize.x;
    const tx = (cam.right - cam.left) / size, ty = (cam.top - cam.bottom) / size;
    const p = this.tmp.copy(focus).applyMatrix4(this.inv);
    p.x = Math.round(p.x / tx) * tx;
    p.y = Math.round(p.y / ty) * ty;
    p.applyMatrix4(this.basis);
    this.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.dir, 90);
    this.target.updateMatrixWorld();
  }

  // Light-space shadow box. The ground within shadowHalf of the focus spans ±R·sin(el) across the light's up axis, so a
  // low sun gets a shallow box (denser texels) instead of a square one smeared over 1/sin(el) of ground; the top keeps
  // room for receivers up to 8 u tall on the far side. Casters toward the sun still reach in: only their part inside
  // the box can shade the ground in it.
  fitShadow() {
    const cam = this.sun.shadow.camera, R = this.shadowHalf, s = Math.max(this.dir.y, 0.05), c = Math.sqrt(1 - s * s);
    cam.left = -R; cam.right = R;
    cam.bottom = -(R * s + 1); cam.top = R * s + 8 * c;
    cam.updateProjectionMatrix();
    this.fitHalf = R;
  }

  update(dt, focus, clockPhase) {
    if (this.gameplay) {
      if (Number.isFinite(clockPhase)) this.setPhase(clockPhase);
    } else if (this.tod === 'cycle') {
      if (Number.isFinite(clockPhase)) this.setPhase(clockPhase);
      else this.phase = (this.phase + dt / this.cycleSeconds) % 1;
    }
    const target = this.baseTarget();
    this.place(this.todPhase());
    if (this.snapT < 1) {
      this.snapT = Math.min(1, this.snapT + dt * this.snapSpeed);
      blend(this.base, this.snap, target, ease(this.snapT));
      glide(this.sunPos, this.snapSun, ease(this.snapT));
      glide(this.moonPos, this.snapMoon, ease(this.snapT));
    } else blend(this.base, target, target, 0);
    if (this.zoneW !== this.zoneTarget) {
      const s = this.zoneSpeed * dt;
      this.zoneW = Math.abs(this.zoneTarget - this.zoneW) <= s ? this.zoneTarget : this.zoneW + Math.sign(this.zoneTarget - this.zoneW) * s;
    }
    const zoneW = ease(this.zoneW);
    blend(this.cur, this.base, PRESETS.volcanic, zoneW);
    // Keep the Caldera's warm sky/fog and local fire, but let its global fill recede with night.
    // Without this cap its volcanic preset would wash out the intentionally dark world.
    const dayW = 1 - THREE.MathUtils.clamp((2.45 - this.base.sunI) / 2.432, 0, 1);
    // The time of day, not the zone, decides whether there is a sun: at night its cast shadow and the comic hatching
    // fade out (the moon casts no hard shadow; toon.js) and the shadow pass is skipped.
    U.mnSunDay.value = THREE.MathUtils.smoothstep(dayW, 0.15, 0.6);
    this.sun.shadow.autoUpdate = U.mnSunDay.value > 0;
    const globalZoneW = zoneW * dayW;
    this.cur.sunI = THREE.MathUtils.lerp(this.base.sunI, PRESETS.volcanic.sunI, globalZoneW);
    this.cur.hemiI = THREE.MathUtils.lerp(this.base.hemiI, PRESETS.volcanic.hemiI, globalZoneW);
    this.cur.fill.copy(this.base.fill).lerp(PRESETS.volcanic.fill, globalZoneW);
    this.cur.rim.copy(this.base.rim).lerp(PRESETS.volcanic.rim, globalZoneW);
    this.cur.water.copy(this.base.water).lerp(PRESETS.volcanic.water, globalZoneW);
    this.cur.sparkle = THREE.MathUtils.lerp(this.base.sparkle, PRESETS.volcanic.sparkle, globalZoneW);
    this.cur.foam = THREE.MathUtils.lerp(this.base.foam, PRESETS.volcanic.foam, globalZoneW);
    this.cur.glints = THREE.MathUtils.lerp(this.base.glints, PRESETS.volcanic.glints, globalZoneW);
    this.cur.bloom = THREE.MathUtils.lerp(this.base.bloom, PRESETS.volcanic.bloom, globalZoneW);
    this.cur.fxLight.copy(this.base.fxLight).lerp(PRESETS.volcanic.fxLight, globalZoneW);
    // The moon takes the light once the sun has all but faded (sunI under 0.25).
    this.moonW = 1 - THREE.MathUtils.smoothstep(dayW, 0, 0.1);
    this.apply();
    this.aim(focus, zoneW);
  }
}

export { PRESETS, damp };

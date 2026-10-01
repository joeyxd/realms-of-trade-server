// Sun (shadow frustum follows the player, texel-snapped), hemisphere fill, fog, and lighting presets
// ("day" and the Caldera's "golden hour") blended over time.
import * as THREE from 'three';
import { SKY } from './sky.js';
import { U } from './toon.js';
import { damp } from '../core/math.js';

const C = (hex) => new THREE.Color(hex);
const PRESETS = {
  day: {
    sun: C(0xfff0d6), sunI: 2.45, el: 54, az: 28,
    hemiSky: C(0xbfe4ff), hemiGround: C(0xf3d8a6), hemiI: 0.95,
    skyTop: C(0x3a9fe6), skyHorizon: C(0xc4ecf7), skyBottom: C(0x7fd3e0), fog: C(0xb9e6f2),
    rim: C(0xa8dcff), lava: 1.0, cloud: 0.32,
  },
  golden: {
    sun: C(0xffb36a), sunI: 2.3, el: 30, az: 44,
    hemiSky: C(0xffc6a8), hemiGround: C(0x8a5040), hemiI: 0.9,
    skyTop: C(0x5a6fd6), skyHorizon: C(0xffc28a), skyBottom: C(0xe79b7a), fog: C(0xf0b48c),
    rim: C(0xff9ad1), lava: 1.35, cloud: 0.18,
  },
};

export class Lighting {
  constructor(scene, { shadowSize = 2048, shadowHalf = 30 } = {}) {
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
    this.mix = 0;
    this.mixTarget = 0;
    this.mixSpeed = 1 / 2; // 2 s transition
    this.dir = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.basis = new THREE.Matrix4();
    this.inv = new THREE.Matrix4();
    this.lavaU = null;
    this.apply();
  }

  setShadowSize(size) {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  setPreset(name, seconds = 2) {
    this.mixTarget = name === 'golden' ? 1 : 0;
    this.mixSpeed = 1 / Math.max(0.01, seconds);
  }

  apply() {
    const a = PRESETS.day, b = PRESETS.golden, t = this.mix;
    const L = (x, y) => x + (y - x) * t;
    this.sun.color.copy(a.sun).lerp(b.sun, t);
    this.sun.intensity = L(a.sunI, b.sunI);
    this.hemi.color.copy(a.hemiSky).lerp(b.hemiSky, t);
    this.hemi.groundColor.copy(a.hemiGround).lerp(b.hemiGround, t);
    this.hemi.intensity = L(a.hemiI, b.hemiI);
    SKY.skyTop.value.copy(a.skyTop).lerp(b.skyTop, t);
    SKY.skyHorizon.value.copy(a.skyHorizon).lerp(b.skyHorizon, t);
    SKY.skyBottom.value.copy(a.skyBottom).lerp(b.skyBottom, t);
    SKY.sunColor.value.copy(this.sun.color);
    this.scene.fog.color.copy(a.fog).lerp(b.fog, t);
    U.mnRimColor.value.copy(a.rim).lerp(b.rim, t);
    U.mnCloud.value = L(a.cloud, b.cloud);
    if (this.lavaU) this.lavaU.value = L(a.lava, b.lava);
    const el = THREE.MathUtils.degToRad(L(a.el, b.el));
    const az = THREE.MathUtils.degToRad(L(a.az, b.az));
    // From the west (screen top-left), rotated toward the south by az.
    this.dir.set(-Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    SKY.sunDir.value.copy(this.dir);
    this.basis.lookAt(this.dir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    this.inv.copy(this.basis).invert();
  }

  update(dt, focus) {
    if (this.mix !== this.mixTarget) {
      const s = this.mixSpeed * dt;
      this.mix = Math.abs(this.mixTarget - this.mix) <= s ? this.mixTarget : this.mix + Math.sign(this.mixTarget - this.mix) * s;
      this.apply();
    }
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

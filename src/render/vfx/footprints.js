// Cosmetic foot plants, batched in one terrain-conforming mesh. Never written to simulation or saves.
import * as THREE from 'three';
import { ACT } from '../../sim/ecs.js';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const GRID = 3, VERTS = GRID * GRID, INDICES = 24;
export const FOOTPRINT_TUNING = Object.freeze({ capacity: 256, dryLife: 18, wetLife: 5, width: 0.25, length: 0.46, stance: 0.15 });

const VERT = /* glsl */ `
attribute vec3 aLife; // birth time, lifetime, wetness
varying vec2 vUv;
varying vec3 vLife;
void main() {
  vUv = uv; vLife = aLife;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uTime;
varying vec2 vUv;
varying vec3 vLife;
void main() {
  float age = (uTime - vLife.x) / max(vLife.y, 0.001);
  if (vLife.y <= 0.0 || age >= 1.0) discard;
  vec2 p = vUv * 2.0 - 1.0;
  // A broad toe, narrow arch and separate heel; a broken bevel keeps the painted comic look.
  float toe = length((p - vec2(0.04, 0.32)) / vec2(0.78, 0.53)) - 1.0;
  float arch = length((p - vec2(-0.08, -0.05)) / vec2(0.53, 0.46)) - 1.0;
  float heel = length((p - vec2(-0.02, -0.58)) / vec2(0.57, 0.30)) - 1.0;
  float d = min(toe, min(arch, heel));
  float aa = max(fwidth(d), 0.025);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  float bevel = smoothstep(-0.22, -0.08, d);
  float hatch = step(0.78, fract(p.y * 4.5 + p.x * 0.7)) * (1.0 - bevel);
  vec3 ink = mix(vec3(0.28, 0.16, 0.065), vec3(0.19, 0.11, 0.045), vLife.z);
  vec3 col = mix(ink, vec3(0.75, 0.51, 0.23), bevel * smoothstep(-0.3, 0.5, p.x - p.y));
  col *= (1.0 - hatch * 0.13) * uFxLight;
  float a = mask * mix(0.55, 0.65, vLife.z) * (1.0 - smoothstep(0.28, 1.0, age));
  a *= fxDepthFadeBias(0.07, 0.12);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Footprints {
  constructor(scene, map, tuning = {}) {
    this.scene = scene;
    this.map = map;
    this.tuning = { ...FOOTPRINT_TUNING, ...tuning };
    this.capacity = Math.max(1, Math.min(256, this.tuning.capacity | 0));
    this.limit = this.capacity;
    this.time = 0;
    this.active = false;
    this.cursor = 0;
    this.used = 0;
    this.count = 0;
    this.steps = new Map();
    this.pool = Array.from({ length: this.capacity }, () => ({ life: 0, birth: 0 }));
    const positions = new Float32Array(this.capacity * VERTS * 3);
    const uv = new Float32Array(this.capacity * VERTS * 2);
    const life = new Float32Array(this.capacity * VERTS * 3);
    const indices = [];
    for (let k = 0; k < this.capacity; k++) {
      const base = k * VERTS;
      for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
        const v = base + j * GRID + i;
        uv[v * 2] = i / (GRID - 1); uv[v * 2 + 1] = j / (GRID - 1);
        if (i < GRID - 1 && j < GRID - 1) indices.push(v, v + GRID, v + 1, v + 1, v + GRID, v + GRID + 1);
      }
    }
    const geo = this.geometry = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(indices);
    geo.setDrawRange(0, 0);
    const mat = this.material = new THREE.ShaderMaterial({
      uniforms: { ...FXU, uTime: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
    });
    const mesh = this.mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sand-footprints';
    mesh.frustumCulled = false;
    mesh.layers.set(LAYER.FX);
    mesh.renderOrder = 1; // behind combat telegraphs
    mesh.visible = false;
    scene.add(mesh);
  }

  setQuality(particles = 1, coarsePointer = false) {
    const limit = Math.min(this.capacity, particles < 0.6 ? 96 : coarsePointer || particles < 1 ? 128 : 256);
    if (limit !== this.limit) { this.clear(); this.limit = limit; }
  }

  // The animation supplies the foot plant. Use movement direction, rather than the aiming torso.
  plant(id, side, s) {
    if (!this.active || s.dead || s.hp <= 0 || s.st === 1 || s.act === ACT.LEAP || s.wade > 0.08 ||
      ![s.x, s.y, s.z, s.vx, s.vz].every(Number.isFinite) || Math.hypot(s.vx, s.vz) < 0.6) return false;
    const prior = this.steps.get(id);
    this.steps.set(id, { x: s.x, z: s.z });
    if (prior) {
      const moved = Math.hypot(s.x - prior.x, s.z - prior.z);
      if (moved < 0.24 || moved > 3.5) return false; // idle reconciliation or a teleport is not a foot plant
    }
    const f = Math.atan2(s.vx, s.vz), rightX = Math.cos(f), rightZ = -Math.sin(f);
    const offset = (side ? 1 : -1) * this.tuning.stance;
    const x = s.x + rightX * offset, z = s.z + rightZ * offset;
    if (this.map.materialAt(x, z) !== 'sand') return false;
    const h = this.map.heightAt(x, z);
    if (h < 0.08 || h > 1.38 || Math.abs(s.y - this.map.heightAt(s.x, s.z)) > 0.18) return false; // water, grass edge or deck
    const e = 0.15;
    const slope = Math.hypot(this.map.heightAt(x + e, z) - this.map.heightAt(x - e, z),
      this.map.heightAt(x, z + e) - this.map.heightAt(x, z - e)) / (2 * e);
    const masks = this.map.masks(x, z);
    if (slope > 0.45 || masks.path > 0.2 || masks.volcanic > 0.2 || masks.arenaFloor > 0.1 || masks.lava > 0.1) return false;
    const wet = THREE.MathUtils.clamp((0.5 - h) / 0.42, 0, 1);
    const life = THREE.MathUtils.lerp(this.tuning.dryLife, this.tuning.wetLife, wet);
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    const q = this.pool[slot];
    Object.assign(q, { x, z, f, side, wet, life, birth: this.time });
    const pos = this.geometry.attributes.position, aLife = this.geometry.attributes.aLife;
    const forwardX = Math.sin(f), forwardZ = Math.cos(f);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const v = slot * VERTS + j * GRID + i;
      const u = (i / (GRID - 1) - 0.5) * this.tuning.width;
      const vForward = (j / (GRID - 1) - 0.5) * this.tuning.length;
      const px = x + rightX * u + forwardX * vForward, pz = z + rightZ * u + forwardZ * vForward;
      pos.setXYZ(v, px, this.map.heightAt(px, pz) + 0.035, pz);
      aLife.setXYZ(v, this.time, life, wet);
    }
    // Upload only this plant; several actors may queue independent ranges before the next draw.
    pos.addUpdateRange(slot * VERTS * 3, VERTS * 3);
    aLife.addUpdateRange(slot * VERTS * 3, VERTS * 3);
    pos.needsUpdate = true; aLife.needsUpdate = true;
    this.used = Math.max(this.used, slot + 1);
    this.geometry.setDrawRange(0, this.used * INDICES);
    this.mesh.visible = true;
    return true;
  }

  update(dt, playing) {
    this.active = !!playing;
    this.time += Math.max(0, dt);
    this.material.uniforms.uTime.value = this.time;
    this.count = 0;
    for (let i = 0; i < this.used; i++) {
      const q = this.pool[i];
      if (q.life > 0 && this.time - q.birth < q.life) this.count++;
    }
    this.mesh.visible = !!playing && this.count > 0;
    if (!playing && (this.used || this.steps.size)) this.clear();
  }

  forget(id) { this.steps.delete(id); }

  clear() {
    for (const q of this.pool) q.life = 0;
    this.geometry.attributes.aLife.array.fill(0);
    this.geometry.attributes.aLife.clearUpdateRanges();
    this.geometry.attributes.aLife.addUpdateRange(0, this.geometry.attributes.aLife.array.length);
    this.geometry.attributes.aLife.needsUpdate = true;
    this.geometry.setDrawRange(0, 0);
    this.steps.clear();
    this.cursor = this.used = this.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.clear(); this.scene.remove(this.mesh);
    this.geometry.dispose(); this.material.dispose();
  }
}

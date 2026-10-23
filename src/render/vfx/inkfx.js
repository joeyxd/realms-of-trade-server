// Persistent ink clouds and restrained marks. The current replicated lists own lifetime, so rollback and late joins agree.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { DT } from '../../data/tuning.js';

const CLOUD_CAPACITY = 12;
const MARK_CAPACITY = 32;
const SEGMENTS = 64;
const TAU = Math.PI * 2;

const CLOUD_VERT = /* glsl */ `
attribute vec2 aPolar;
varying vec2 vPolar;
void main() {
  vPolar = aPolar;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CLOUD_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uTime;
uniform float uAlpha;
varying vec2 vPolar;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float r = vPolar.x, a = vPolar.y;
  vec2 dir = vec2(cos(a), sin(a));
  float edgeNoise = noise(dir * 3.1 + uTime * 0.08);
  float edge = 0.90 + (edgeNoise - 0.5) * 0.16;
  float boundary = 1.0 - smoothstep(edge - 0.035, edge + 0.018, r);
  float wisp = noise(dir * (5.0 + r * 4.0) + uTime * 0.17);
  float center = smoothstep(0.04, 0.38, r);
  float alpha = uAlpha * boundary * center * (0.18 + wisp * 0.18) * fxDepthFade(0.08);
  if (alpha < 0.006) discard;
  vec3 color = mix(vec3(0.075, 0.035, 0.12), vec3(0.34, 0.13, 0.53), wisp * 0.8);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

function cloudGeometry() {
  const rings = [0, 0.34, 0.67, 0.88, 1], count = rings.length * (SEGMENTS + 1);
  const positions = new Float32Array(count * 3), polar = new Float32Array(count * 2), indices = [];
  let k = 0;
  for (const radius of rings) for (let j = 0; j <= SEGMENTS; j++) {
    polar[k * 2] = radius;
    polar[k * 2 + 1] = j / SEGMENTS * TAU;
    k++;
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < SEGMENTS; j++) {
    const a = i * (SEGMENTS + 1) + j, b = a + 1, c = a + SEGMENTS + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return geo;
}

function ringGeometry(inner, outer, segments = SEGMENTS) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array((segments + 1) * 2 * 3), idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * TAU;
    for (let j = 0; j < 2; j++) {
      const at = (i * 2 + j) * 3, r = j ? outer : inner;
      pos[at] = Math.cos(a) * r; pos[at + 1] = 0; pos[at + 2] = Math.sin(a) * r;
      if (i < segments) {
        const v = i * 2 + j, next = v + 2;
        if (!j) idx.push(v, next, v + 1, next, next + 1, v + 1);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return geo;
}

function layCloud(geo, map, x, z, r, lift) {
  const p = geo.attributes.position.array, polar = geo.attributes.aPolar.array;
  for (let i = 0; i < polar.length / 2; i++) {
    const a = polar[i * 2 + 1], d = polar[i * 2] * r;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    p[i * 3] = px; p[i * 3 + 1] = map.groundAt(px, pz) + lift; p[i * 3 + 2] = pz;
  }
  geo.attributes.position.needsUpdate = true;
}

function layRing(geo, map, x, z, radius, lift) {
  const p = geo.attributes.position.array;
  const segments = p.length / 6 - 1;
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * TAU, px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
    for (let j = 0; j < 2; j++) {
      const at = (i * 2 + j) * 3, d = radius + (j ? 0.045 : -0.045);
      const rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d;
      p[at] = rx; p[at + 1] = map.groundAt(px, pz) + lift; p[at + 2] = rz;
    }
  }
  geo.attributes.position.needsUpdate = true;
}

function fxMesh(mesh) { mesh.layers.set(LAYER.FX); mesh.frustumCulled = false; return mesh; }

export class InkFx {
  constructor(scene, map) {
    this.map = map;
    this.clouds = [];
    this.marks = [];
    for (let i = 0; i < CLOUD_CAPACITY; i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uTime: { value: 0 }, uAlpha: { value: 0 } },
        vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const disk = fxMesh(new THREE.Mesh(cloudGeometry(), material));
      disk.renderOrder = 4; disk.visible = false; scene.add(disk);
      const rimMat = new THREE.MeshBasicMaterial({ color: 0xc394fa, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const rim = fxMesh(new THREE.Mesh(ringGeometry(0.955, 1.0), rimMat));
      rim.renderOrder = 5; rim.visible = false; scene.add(rim);
      this.clouds.push({ disk, rim, material, rimMat, id: '', live: false, key: '' });
    }
    const markGeometry = ringGeometry(0.38, 0.47, 40);
    for (let i = 0; i < MARK_CAPACITY; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xc394fa, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = fxMesh(new THREE.Mesh(markGeometry, material));
      mesh.renderOrder = 9; mesh.visible = false; scene.add(mesh);
      this.marks.push({ mesh, material, id: '', live: false });
    }
  }

  // Use only current authoritative/predicted lists. Removing a cast on reconciliation hides it immediately.
  update(clouds, tick, marks, views) {
    const presentClouds = new Set(), safeTick = Number.isFinite(tick) ? tick : 0, time = safeTick * DT;
    for (const cloud of clouds || []) {
      if (!cloud || !Number.isFinite(cloud.x) || !Number.isFinite(cloud.z) || !Number.isFinite(cloud.r) || cloud.r <= 0) continue;
      if (Number.isFinite(cloud.t0) && safeTick < cloud.t0) continue;
      if (Number.isFinite(cloud.tEnd) && safeTick >= cloud.tEnd) continue;
      const owner = cloud.fieldOwner ?? cloud.e ?? 0;
      const serial = cloud.seq ?? cloud.id ?? cloud.t0 ?? `${cloud.x.toFixed(2)}:${cloud.z.toFixed(2)}`;
      const id = `${owner}:${serial}`;
      presentClouds.add(id);
      let slot = this.clouds.find((s) => s.id === id) || this.clouds.find((s) => !s.live);
      if (!slot) continue;
      const key = `${cloud.x.toFixed(2)}:${cloud.z.toFixed(2)}:${cloud.r.toFixed(2)}`;
      if (!slot.live || slot.id !== id || slot.key !== key) {
        slot.id = id; slot.key = key;
        layCloud(slot.disk.geometry, this.map, cloud.x, cloud.z, cloud.r, 0.055);
        layRing(slot.rim.geometry, this.map, cloud.x, cloud.z, cloud.r, 0.075);
      }
      slot.live = true;
      slot.disk.visible = slot.rim.visible = true;
      const left = Number.isFinite(cloud.tEnd) ? Math.max(0, (cloud.tEnd - safeTick) * DT) : 1;
      const age = Number.isFinite(cloud.t0) ? Math.max(0, (safeTick - cloud.t0) * DT) : 1;
      const fade = Math.min(1, left / 0.42, age / 0.14);
      const pulse = 0.86 + Math.sin(time * 2.7 + Number(cloud.seq || 0)) * 0.06;
      slot.material.uniforms.uTime.value = time;
      slot.material.uniforms.uAlpha.value = fade * pulse;
      slot.rimMat.opacity = 0.54 * fade;
    }
    for (const slot of this.clouds) if (slot.live && !presentClouds.has(slot.id)) {
      slot.live = false; slot.disk.visible = slot.rim.visible = false;
    }

    const presentMarks = new Set();
    let used = 0;
    for (const mark of marks || []) {
      if (!mark || !Number.isFinite(mark.e) || !Number.isFinite(mark.tEnd) || safeTick >= mark.tEnd) continue;
      const view = views && views.get(mark.e);
      if (!view || !view.root || !view.root.visible || view.dead) continue;
      const id = mark.e;
      presentMarks.add(id);
      let slot = this.marks.find((s) => s.id === id) || this.marks.find((s) => !s.live);
      if (!slot || used >= MARK_CAPACITY) continue;
      used++;
      slot.id = id; slot.live = true; slot.mesh.visible = true;
      const p = view.root.position;
      const alpha = Math.min(1, Math.max(0, (mark.tEnd - safeTick) * DT) / 0.5);
      slot.mesh.position.set(p.x, p.y + 0.07, p.z);
      slot.material.opacity = alpha * (0.66 + Math.sin(time * 5 + id) * 0.13);
    }
    for (const slot of this.marks) if (slot.live && !presentMarks.has(slot.id)) {
      slot.live = false; slot.mesh.visible = false;
    }
  }
}

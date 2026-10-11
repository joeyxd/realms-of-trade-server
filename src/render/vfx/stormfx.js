// Short pooled chain-lightning arcs for Tormenta's Rayo de mástil.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const CAPACITY = 8;
const MAX_LINKS = 5;
const SEGMENTS = 6;
const LIFE = 0.18;
const RIBBON_WIDTH = 0.055;

const VERT = /* glsl */ `
attribute float aAcross;
varying float vAcross;
void main() {
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform vec3 uColor;
uniform float uAlpha;
varying float vAcross;
void main() {
  float side = abs(vAcross);
  float edge = 1.0 - smoothstep(0.72, 1.0, side);
  float core = 1.0 - smoothstep(0.0, 0.58, side);
  float a = edge * uAlpha * fxDepthFade(0.16);
  if (a < 0.01) discard;
  vec3 color = mix(uColor * 0.7, vec3(1.0, 0.95, 0.52), core * 0.92);
  gl_FragColor = vec4(color * a * 1.6, a);
  #include <colorspace_fragment>
}`;

const ADD = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};

function boltKey(ev) {
  if (Number.isFinite(ev.id)) return `lightning:${ev.id}`;
  const path = (ev.points || []).map((p) => p?.id ?? `${p?.x?.toFixed?.(2)},${p?.z?.toFixed?.(2)}`).join('>');
  return `${ev.e}:${Number.isFinite(ev.seq) ? ev.seq : ev.tick ?? ''}:${ev.kind || ''}:${ev.x.toFixed(2)}:${ev.z.toFixed(2)}:${path}`;
}

export class StormFx {
  constructor(scene, map) {
    this.map = map;
    this.bolts = [];
    this.seen = new Set();
    for (let i = 0; i < CAPACITY; i++) {
      const geo = new THREE.BufferGeometry();
      const vertices = MAX_LINKS * SEGMENTS * 6;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aAcross', new THREE.BufferAttribute(new Float32Array(vertices), 1));
      geo.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({ ...ADD, uniforms: { ...FXU, uColor: { value: new THREE.Color(0xffdf3b) }, uAlpha: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.layers.set(LAYER.FX); mesh.frustumCulled = false; mesh.renderOrder = 31; mesh.visible = false;
      scene.add(mesh);
      this.bolts.push({ geo, mat, mesh, age: LIFE, key: '' });
    }
  }

  cast(ev) {
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.z) || !Array.isArray(ev.points) || !ev.points.length) return false;
    const key = boltKey(ev);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    const bolt = this.bolts.find((b) => b.age >= LIFE) || this.bolts.reduce((a, b) => a.age > b.age ? a : b);
    const pos = bolt.geo.attributes.position.array;
    let used = 0, x0 = ev.x, z0 = ev.z, seed = ((ev.seq || ev.tick || 1) ^ ((ev.e || 0) * 2654435761)) >>> 0;
    const nextNoise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const count = Math.min(MAX_LINKS, ev.points.length);
    for (let link = 0; link < count; link++) {
      const target = ev.points[link];
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) continue;
      const dx = target.x - x0, dz = target.z - z0, len = Math.hypot(dx, dz);
      if (len < 0.15) { x0 = target.x; z0 = target.z; continue; }
      const nx = -dz / len, nz = dx / len, y0 = this.map.groundAt(x0, z0) + 1.42, y1 = this.map.groundAt(target.x, target.z) + 1.12;
      const points = new Array(SEGMENTS + 1);
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS, amp = i === 0 || i === SEGMENTS ? 0 : Math.min(0.46, len * 0.09) * (0.45 + nextNoise() * 0.55);
        const sign = (i & 1) ? 1 : -1, x = x0 + dx * t + nx * amp * sign, z = z0 + dz * t + nz * amp * sign;
        points[i] = [x, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * (0.28 + nextNoise() * 0.18), z];
      }
      const across = bolt.geo.attributes.aAcross.array, half = RIBBON_WIDTH * 0.5;
      for (let i = 0; i < SEGMENTS; i++) {
        const a = points[i], b = points[i + 1];
        const quad = [
          [a[0] - nx * half, a[1], a[2] - nz * half, -1],
          [b[0] - nx * half, b[1], b[2] - nz * half, -1],
          [a[0] + nx * half, a[1], a[2] + nz * half, 1],
          [a[0] + nx * half, a[1], a[2] + nz * half, 1],
          [b[0] - nx * half, b[1], b[2] - nz * half, -1],
          [b[0] + nx * half, b[1], b[2] + nz * half, 1],
        ];
        for (const v of quad) {
          const at = used++ * 3;
          pos[at] = v[0]; pos[at + 1] = v[1]; pos[at + 2] = v[2];
          across[used - 1] = v[3];
        }
      }
      x0 = target.x; z0 = target.z;
    }
    if (!used) return false;
    bolt.geo.setDrawRange(0, used);
    bolt.geo.attributes.position.needsUpdate = true;
    bolt.geo.attributes.aAcross.needsUpdate = true;
    bolt.age = 0; bolt.key = key; bolt.mat.uniforms.uAlpha.value = 0.95; bolt.mesh.visible = true;
    return true;
  }

  update(dt) {
    for (const bolt of this.bolts) {
      if (bolt.age >= LIFE) continue;
      bolt.age += dt;
      bolt.mat.uniforms.uAlpha.value = Math.max(0, 0.95 * (1 - bolt.age / LIFE));
      if (bolt.age >= LIFE) bolt.mesh.visible = false;
    }
  }
}

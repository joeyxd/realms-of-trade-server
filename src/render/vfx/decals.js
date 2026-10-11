// Ground decals that hug the terrain: AoE telegraphs (a red circle that fills during the wind-up and
// bursts at its end, DESIGN §6) and the rope ring of the practice cannon. Each decal is a small polar
// mesh whose vertices are placed on the ground when it spawns (exact heights, any slope).
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { DT } from '../../data/tuning.js';

const RINGS = 7, SEGS = 56;

const VERT = /* glsl */ `
attribute vec2 aPolar; // normalized radius (0..1.08), angle 0..1
varying vec2 vPolar;
void main() {
  vPolar = aPolar;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uKind;    // 0 = AoE telegraph, 1 = practice ring, 2 = rune circle (La Prueba de Fuego)
uniform float uFill;    // 0..1 wind-up progress
uniform float uBurst;   // 0..1 after the burst (−1 before)
uniform float uTime;
uniform float uActive;  // practice ring: someone is standing in it
uniform vec3 uColor, uInk;
varying vec2 vPolar;
void main() {
  float r = vPolar.x, ang = vPolar.y;
  float w = max(fwidth(r), 1e-4);
  vec3 col; float a;
  if (uKind < 0.5) {
    float rim = smoothstep(0.9 - w, 0.92, r) * (1.0 - smoothstep(1.0, 1.0 + w, r));
    float ink = smoothstep(1.0 - w, 1.0, r) * (1.0 - smoothstep(1.06, 1.06 + w, r));
    float fill = 1.0 - smoothstep(uFill - w, uFill, r);
    float edge = smoothstep(uFill - 0.08, uFill, r) * fill;
    float inside = 1.0 - smoothstep(0.92, 0.92 + w, r);
    float hatch = step(0.5, fract((ang * 6.2832 * 6.0) + r * 3.0 - uTime * 0.8)) * 0.08;
    col = mix(uColor * 0.85, vec3(1.0, 0.75, 0.6), edge * 0.7);
    a = max(rim * 0.95, inside * (0.16 + hatch + fill * 0.32 + edge * 0.35));
    col = mix(col, uInk, ink);
    a = max(a, ink * 0.85);
    if (uBurst >= 0.0) {
      float k = 1.0 - uBurst;
      col = mix(vec3(1.0, 0.92, 0.75), uColor, uBurst);
      a = (1.0 - smoothstep(1.0, 1.0 + w, r)) * k * k * 0.9;
    }
  } else if (uKind > 1.5) {
    // Rune circle: an emissive ember band with rune ticks; pulses while the trial can be started.
    float band = smoothstep(0.84 - w, 0.86, r) * (1.0 - smoothstep(1.0, 1.0 + w, r));
    float runes = step(0.62, fract(ang * 24.0)) * step(0.9, r) * step(r, 0.96);
    float inner = smoothstep(0.3, 0.32, r) * (1.0 - smoothstep(0.34, 0.36, r));
    float spokes = step(0.97, fract(ang * 6.0 + 0.5)) * step(0.34, r) * step(r, 0.84);
    float pulse = 0.55 + 0.45 * sin(uTime * 3.0);
    col = mix(uColor, vec3(1.0, 0.9, 0.6), runes);
    a = max(band * (1.0 - runes * 0.6), max(runes, max(inner, spokes) * 0.7)) * mix(0.35, 0.75 + 0.25 * pulse, uActive);
    col *= mix(0.8, 1.5, uActive * pulse);
  } else {
    // Rope ring: braided band (alternating strands) with a soft pulse when it is in use.
    float band = smoothstep(0.88 - w, 0.9, r) * (1.0 - smoothstep(1.0, 1.0 + w, r));
    float braid = step(0.5, fract(ang * 64.0 + (r - 0.94) * 6.0));
    col = mix(uColor * 0.72, uColor, braid);
    float ink = smoothstep(0.85, 0.88, r) * (1.0 - smoothstep(0.88, 0.9, r)) + smoothstep(1.0 - w, 1.0, r) * (1.0 - smoothstep(1.04, 1.04 + w, r));
    col = mix(col, uInk, clamp(ink, 0.0, 1.0));
    float glowIn = (1.0 - smoothstep(0.0, 0.9, r)) * 0.0 + uActive * (0.12 + 0.06 * sin(uTime * 4.0)) * (1.0 - smoothstep(0.86, 0.9, r));
    a = max(band * 0.95, max(clamp(ink, 0.0, 1.0) * 0.7, glowIn));
    col = mix(col, vec3(1.0, 0.86, 0.5), glowIn * (1.0 - band));
    col *= uFxLight; // a real rope: lit like the sand it lies on (telegraphs above stay emissive)
  }
  a *= fxDepthFadeBias(0.15, 0.3);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function polarGeometry() {
  const n = (RINGS + 2) * (SEGS + 1);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), polar = new Float32Array(n * 2);
  const radii = [];
  for (let i = 0; i <= RINGS; i++) radii.push(i / RINGS);
  radii.push(1.08);
  let k = 0;
  for (const r of radii) for (let j = 0; j <= SEGS; j++) { polar[k * 2] = r; polar[k * 2 + 1] = j / SEGS; k++; }
  const idx = [];
  for (let i = 0; i < radii.length - 1; i++) for (let j = 0; j < SEGS; j++) {
    const a = i * (SEGS + 1) + j, b = a + 1, c = a + SEGS + 1, d = c + 1;
    idx.push(a, b, c, b, d, c); // counter-clockwise seen from above (front faces up)
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export class Decals {
  constructor(scene, map, count = 14) {
    this.map = map;
    this.pool = [];
    this.time = 0;
    for (let i = 0; i < count; i++) {
      const geo = polarGeometry();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...FXU, uKind: { value: 0 }, uFill: { value: 0 }, uBurst: { value: -1 }, uTime: { value: 0 }, uActive: { value: 0 },
          uColor: { value: new THREE.Color(0xff3b30) }, uInk: { value: new THREE.Color(0x1a1033) },
        },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER.FX);
      mesh.renderOrder = 3;
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, mat, geo, active: false, id: 0 });
    }
  }

  place(d, x, z, r, lift = 0.07) {
    const pos = d.geo.attributes.position.array, polar = d.geo.attributes.aPolar.array;
    for (let k = 0; k < polar.length / 2; k++) {
      const rr = polar[k * 2] * r, a = polar[k * 2 + 1] * Math.PI * 2;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      pos[k * 3] = px; pos[k * 3 + 1] = this.map.groundAt(px, pz) + lift; pos[k * 3 + 2] = pz;
    }
    d.geo.attributes.position.needsUpdate = true;
  }

  take() {
    let d = this.pool.find((q) => !q.active);
    // Full: recycle the oldest telegraph (never a fixed ring: the practice ring, the runes).
    if (!d) d = this.pool.filter((q) => !q.static).reduce((a, b) => ((a.t0 ?? 0) < (b.t0 ?? 0) ? a : b));
    return d;
  }

  // Telegraph of a ground AoE: fills from t0 to tAct (ticks), bursts over 0.3 s after.
  aoe(id, x, z, r, t0, tAct) {
    const d = this.take();
    Object.assign(d, { active: true, id, kind: 0, t0, tAct, cancel: false });
    d.mat.uniforms.uKind.value = 0;
    d.mat.uniforms.uBurst.value = -1;
    this.place(d, x, z, r);
    d.mesh.visible = true;
    return d;
  }

  cancel(id) { for (const d of this.pool) if (d.active && d.id === id && d.kind === 0) d.cancel = true; }

  ring(x, z, r, color = 0xd9a85a) {
    const d = this.take();
    Object.assign(d, { active: true, id: -1, kind: 1, t0: 0, tAct: 0, static: true });
    d.mat.uniforms.uKind.value = 1;
    d.mat.uniforms.uColor.value.set(color);
    this.place(d, x, z, r, 0.05);
    d.mesh.visible = true;
    return d;
  }

  // tick: the projectile tick shown this frame (AoEs live on the same timeline as projectiles).
  update(dt, tick) {
    this.time += dt;
    for (const d of this.pool) {
      if (!d.active) continue;
      const u = d.mat.uniforms;
      u.uTime.value = this.time;
      if (d.kind === 1) continue;
      if (d.cancel) { u.uFill.value = Math.max(0, u.uFill.value - dt * 3); if (u.uFill.value <= 0) { d.active = false; d.mesh.visible = false; } continue; }
      const span = Math.max(1, d.tAct - d.t0);
      if (tick < d.tAct) { u.uFill.value = Math.max(0, (tick - d.t0) / span); u.uBurst.value = -1; }
      else {
        const b = ((tick - d.tAct) * DT) / 0.3;
        u.uBurst.value = Math.min(1, b);
        if (b >= 1) { d.active = false; d.mesh.visible = false; }
      }
    }
  }
}

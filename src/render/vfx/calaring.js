// The border of La Cala Calavera (M4.5): a band of blood-red glow with skull-like ticks that hugs the ground along the
// ring of skull posts. Brighter (and pulsing faster) while you stand inside. One ribbon mesh, FX layer.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const SEGS = 220;

const VERT = /* glsl */ `
attribute vec2 aBand; // across (-1 inside .. 1 outside), along (0..1 around)
varying vec2 vBand;
void main() {
  vBand = aBand;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uTime, uInside;
uniform vec3 uColor;
varying vec2 vBand;
void main() {
  float x = vBand.x, s = vBand.y;
  float core = 1.0 - smoothstep(0.15, 0.55, abs(x));
  float halo = (1.0 - smoothstep(0.4, 1.0, abs(x))) * 0.35;
  // Ticks every ~2.6 u, and a slow flow toward the entrance.
  float tick = step(0.82, fract(s * 50.0 - uTime * 0.15)) * (1.0 - smoothstep(0.0, 0.9, abs(x)));
  float pulse = 0.6 + 0.4 * sin(uTime * mix(1.6, 4.0, uInside) + s * 18.0);
  vec3 col = mix(uColor, vec3(1.0, 0.75, 0.55), tick * 0.8);
  float a = (core * 0.75 + halo + tick * 0.6) * mix(0.45, 0.95, uInside) * pulse;
  a *= fxDepthFadeBias(0.2, 0.3);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * mix(1.0, 1.6, uInside), a);
  #include <colorspace_fragment>
}`;

export function createCalaRing(map) {
  const K = map.cala;
  if (!K) return null;
  const n = (SEGS + 1) * 2;
  const pos = new Float32Array(n * 3), band = new Float32Array(n * 2), idx = [];
  const W = 0.55;
  for (let j = 0; j <= SEGS; j++) {
    const a = (j / SEGS) * Math.PI * 2;
    for (let k = 0; k < 2; k++) {
      const r = K.r + (k ? W : -W), x = K.x + Math.cos(a) * r, z = K.z + Math.sin(a) * r, i = j * 2 + k;
      pos[i * 3] = x; pos[i * 3 + 1] = map.groundAt(x, z) + 0.08; pos[i * 3 + 2] = z;
      band[i * 2] = k ? 1 : -1; band[i * 2 + 1] = j / SEGS;
    }
    if (j < SEGS) { const p = j * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aBand', new THREE.BufferAttribute(band, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...FXU, uTime: { value: 0 }, uInside: { value: 0 }, uColor: { value: new THREE.Color(0xff2d2d) } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.set(LAYER.FX);
  mesh.renderOrder = 3;
  mesh.name = 'calaRing';
  let inside = 0;
  return {
    mesh,
    // dt, and whether you stand inside (the glow eases in and out).
    update(dt, isIn) {
      inside += ((isIn ? 1 : 0) - inside) * Math.min(1, dt * 3);
      mat.uniforms.uInside.value = inside;
      mat.uniforms.uTime.value += dt;
    },
  };
}

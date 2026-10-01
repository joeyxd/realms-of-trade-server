// Projectiles on screen. Shape first, color second (DESIGN §6), every one with an ink outline so it
// reads on sunlit sand and on dark basalt alike:
//   parryable    amber diamond (stretched along its flight, like a bolt) inside a thin ring
//   heavy        big pulsing orange-red orb with a halo
//   unstoppable  long violet spike with a white ✕
//   reflected    the same shape in the player's cyan, with a trail
// One instanced draw of camera-facing quads (SDF shapes) + one of soft ground shadows that tell
// where a projectile is in the isometric view. Hostile projectiles are analytic: positions are
// evaluated at the client's projectile tick every frame (no per-projectile state here).
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { PTYPE, NEVER } from '../../sim/projectiles.js';
import { tuning, DT } from '../../data/tuning.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData; // type, age (s), radius, flags (1 = reflected, 2 = high contrast)
uniform float uTime;
varying vec2 vP;
varying float vType;
varying float vAge;
varying float vR;
varying float vFlags;
void main() {
  vType = iData.x; vAge = iData.y; vR = iData.z; vFlags = iData.w;
  vec4 c = viewMatrix * vec4(iPos, 1.0);
  vec3 vel = iVel;
  float sp = length(vel);
  vec4 ahead = viewMatrix * vec4(iPos + (sp > 1e-4 ? vel / sp : vec3(0.0, 0.0, 1.0)) * 0.5, 1.0);
  vec2 dir = ahead.xy - c.xy;
  float dl = length(dir);
  dir = dl > 1e-5 ? dir / dl : vec2(0.0, 1.0);
  vec2 nrm = vec2(dir.y, -dir.x);
  float L, W;
  if (vType < 0.5) { L = 0.5; W = 0.46; }
  else if (vType < 1.5) { L = vR * 1.75; W = vR * 1.75; }
  else { L = 0.66; W = 0.32; }
  // Spawn: grows in over the 150 ms arm time.
  float grow = mix(0.35, 1.0, smoothstep(0.0, ${tuning.projectiles.armTime.toFixed(3)}, vAge));
  L *= grow; W *= grow;
  c.xy += dir * position.y * L + nrm * position.x * W;
  vP = vec2(position.y * L, position.x * W) / grow;
  gl_Position = projectionMatrix * c;
  if (iData.z <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uTime;
uniform vec3 uParry, uHeavy, uUnstop, uShot, uInk;
varying vec2 vP;
varying float vType;
varying float vAge;
varying float vR;
varying float vFlags;
float aa(float d) { float w = max(fwidth(d), 1e-4); return clamp(0.5 - d / w, 0.0, 1.0); }
void main() {
  bool shot = mod(vFlags, 2.0) > 0.5;
  bool stripes = vFlags > 1.5;
  vec3 col; float a; float glow;
  float a1 = vP.x, c1 = vP.y; // along flight, across
  float armed = smoothstep(0.1, ${tuning.projectiles.armTime.toFixed(3)}, vAge);
  if (vType < 0.5) {
    // diamond (normalized L1 distance) + ring
    float k = abs(a1) / 0.3 + abs(c1) / 0.165;
    float body = aa((k - 1.0) * 0.12);
    float ink = aa((k - 1.42) * 0.12);
    float rr = length(vP);
    float ring = aa(abs(rr - 0.38) - 0.03);
    float ringInk = aa(abs(rr - 0.38) - 0.06);
    vec3 base = shot ? uShot : uParry;
    col = mix(uInk, base, max(body, ring));
    col = mix(col, vec3(1.0, 0.97, 0.85), aa((k - 0.42) * 0.12));
    if (stripes) col = mix(col, uInk, body * step(0.5, fract((a1 + c1) * 9.0)) * 0.45);
    a = max(max(body, ink), max(ring, ringInk));
    glow = max(body, ring) * 0.9;
  } else if (vType < 1.5) {
    // heavy orb: hot core, dark rim, pulsing halo
    float rr = length(vP);
    float R = vR;
    float pulse = 0.5 + 0.5 * sin(uTime * 7.0);
    float body = aa(rr - R);
    float ink = aa(rr - R - 0.07);
    float halo = (1.0 - smoothstep(R, R + 0.38 + pulse * 0.12, rr)) * 0.55;
    vec3 base = shot ? uShot : uHeavy;
    vec3 core = mix(base, vec3(1.0, 0.95, 0.7), 1.0 - smoothstep(0.0, R * 0.6, rr));
    float bands = smoothstep(0.45, 0.55, fract(rr * 4.0 - uTime * 1.6)) * 0.18;
    col = mix(base * (0.7 + pulse * 0.3), core, 1.0 - smoothstep(R * 0.35, R * 0.9, rr)) - bands * body;
    col = mix(uInk, col, body);
    if (stripes) col = mix(col, uInk, body * step(0.5, fract(atan(vP.y, vP.x) * 1.9 + uTime)) * 0.35);
    float hal = halo * (1.0 - ink);
    col = mix(col, base, hal);
    a = max(ink, hal);
    glow = body * 0.8 + hal * 0.6;
  } else {
    // unstoppable spike: long pointed shard with a white X across its middle
    float t = clamp((a1 + 0.62) / 1.24, 0.0, 1.0);
    float hw = 0.13 * (1.0 - pow(t, 3.0)) * smoothstep(0.0, 0.18, t) + 0.012;
    float d = max(abs(c1) - hw, abs(a1) - 0.62);
    float body = aa(d);
    float ink = aa(d - 0.055);
    float x1 = abs(c1 - a1 * 0.9), x2 = abs(c1 + a1 * 0.9);
    float cross = aa(min(x1, x2) - 0.022) * step(abs(a1), 0.12) * body;
    vec3 base = shot ? uShot : uUnstop;
    col = mix(uInk, mix(base, vec3(0.86, 0.75, 1.0), smoothstep(0.2, 0.9, t) * 0.5), body);
    col = mix(col, vec3(1.0), cross);
    if (stripes) col = mix(col, uInk, body * step(0.5, fract(a1 * 7.0)) * 0.4);
    a = max(body, ink);
    glow = body * 0.75;
  }
  // Unarmed (first 150 ms): lighter, with a white spawn ring.
  float sr = length(vP);
  float spawnRing = (1.0 - armed) * aa(abs(sr - mix(0.15, 0.6, vAge / ${tuning.projectiles.armTime.toFixed(3)})) - 0.03);
  col = mix(col, vec3(1.0), spawnRing);
  a = max(a * mix(0.75, 1.0, armed), spawnRing);
  a *= fxDepthFade(0.3);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a); // coverage also lowers the glow mask: bright cores bloom, the ink does not
  #include <colorspace_fragment>
}`;

const SHADOW_VERT = /* glsl */ `
attribute vec4 iShadow; // x, y (ground), z, radius
varying vec2 vUv;
void main() {
  vUv = position.xz;
  vec3 p = vec3(iShadow.x + position.x * iShadow.w, iShadow.y + 0.06, iShadow.z + position.z * iShadow.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (iShadow.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const SHADOW_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
varying vec2 vUv;
void main() {
  float d = length(vUv);
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * 0.34 * fxDepthFade(0.25);
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.06, 0.03, 0.12, a);
}`;

const quadGeo = () => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
};

export class ProjectileView {
  constructor(scene, map, cap = tuning.projectiles.cap + tuning.projectiles.shotCap) {
    this.map = map;
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.data = new Float32Array(cap * 4);
    this.shadow = new Float32Array(cap * 4);
    const g = quadGeo();
    const inst = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = inst(this.pos, 3); this.aVel = inst(this.vel, 3); this.aData = inst(this.data, 4);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    this.uniforms = {
      ...FXU, uTime: { value: 0 },
      uParry: { value: new THREE.Color(0xffb02e) }, uHeavy: { value: new THREE.Color(0xff5a1f) },
      uUnstop: { value: new THREE.Color(0x9b4dff) }, uShot: { value: new THREE.Color(0x3bf0ff) }, uInk: { value: new THREE.Color(0x1a1033) },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      // Normal blend for color; the glow mask drops by coverage (the bloom picks up the bright colors).
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER.FX);
    this.mesh.renderOrder = 30;
    scene.add(this.mesh);

    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1], 3));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.aShadow = inst(this.shadow, 4);
    sg.setAttribute('iShadow', this.aShadow);
    sg.instanceCount = 0;
    this.shadowMesh = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: { ...FXU }, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false }));
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.layers.set(LAYER.FX);
    this.shadowMesh.renderOrder = 4;
    scene.add(this.shadowMesh);
    this.highContrast = false;
    this.count = 0;
    this.time = 0;
  }

  put(n, x, y, z, vx, vy, vz, type, age, r, flags) {
    const j = n * 3, q = n * 4;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.data[q] = type; this.data[q + 1] = age; this.data[q + 2] = r; this.data[q + 3] = flags;
    this.shadow[q] = x; this.shadow[q + 1] = this.map.groundAt(x, z); this.shadow[q + 2] = z; this.shadow[q + 3] = Math.max(0.3, r * 1.3);
  }

  // tick: the projectile tick being displayed (fractional). onShot(i, x, y, z) per reflected shot (trails).
  update(dt, hazards, shots, tick, onShot) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const H = hazards, hc = this.highContrast ? 2 : 0;
    let n = 0;
    for (let s = 0; s < H.cap && n < this.cap; s++) {
      if (H.id[s] === 0 || H.dead[s] !== NEVER || tick < H.t0[s] || tick >= H.tEnd[s]) continue;
      const t = tick;
      const x = H.x0[s] + H.vx[s] * (t - H.t0[s]) * DT;
      const z = H.z0[s] + H.vz[s] * (t - H.t0[s]) * DT;
      const y = H.y[s] + H.vy[s] * (t - H.t0[s]) * DT;
      this.put(n++, x, y, z, H.vx[s], H.vy[s], H.vz[s], H.type[s], (t - H.t0[s]) * DT, H.r[s], hc);
    }
    const S = shots;
    for (let s = 0; s < S.cap && n < this.cap; s++) {
      if (!S.id[s]) continue;
      this.put(n++, S.x[s], S.y[s], S.z[s], S.vx[s], 0, S.vz[s], S.type[s], 1, S.r[s] * (S.type[s] === PTYPE.HEAVY ? 1.05 : 1), 1 | hc);
      if (onShot) onShot(s, S.x[s], S.y[s], S.z[s]);
    }
    this.count = n;
    this.mesh.geometry.instanceCount = n;
    this.shadowMesh.geometry.instanceCount = n;
    if (n) {
      this.aPos.needsUpdate = this.aVel.needsUpdate = this.aData.needsUpdate = this.aShadow.needsUpdate = true;
    }
    this.mesh.visible = this.shadowMesh.visible = n > 0;
  }
}

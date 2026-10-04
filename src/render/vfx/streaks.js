// Velocity-stretched sparks and embers: one instanced draw of camera-facing capsules whose length
// follows the velocity (a short trail that bends as the ember wanders). Additive, hot head and a
// tail that fades and cools; every streak writes the glow mask so it blooms. Fixed pool, no
// allocation per frame.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec2 iSize; // width (u), stretch (s of velocity)
varying vec4 vColor;
varying vec2 vUv;    // x across [-1, 1], y along in widths (0 = tail end of the segment)
varying float vLen;  // segment length in widths
void main() {
  vColor = iColor;
  float w = iSize.x;
  vec4 h = viewMatrix * vec4(iPos, 1.0);
  vec4 t = viewMatrix * vec4(iPos - iVel * iSize.y, 1.0);
  vec2 dir = h.xy - t.xy;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(dir.y, -dir.x); // (nrm, dir) keeps the quad's winding front-facing
  vec4 p = mix(t, h, position.y);
  p.xy += dir * (position.y * 2.0 - 1.0) * w * 0.5 + nrm * position.x * w * 0.5;
  gl_Position = projectionMatrix * p;
  vLen = len / max(w, 1e-5);
  vUv = vec2(position.x, position.y * (vLen + 1.0) - 0.5);
  if (w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uBoost; // intensity (blending happens in linear light on medium/high)
varying vec4 vColor;
varying vec2 vUv;
varying float vLen;
void main() {
  float s = vUv.y;
  float dx = max(0.0, max(-s, s - vLen));
  float d = length(vec2(dx, vUv.x * 0.5));          // distance to the segment, in widths
  float head = vLen > 0.01 ? clamp(s / vLen, 0.0, 1.0) : 1.0;
  float a = smoothstep(0.5, 0.12, d) * mix(0.12, 1.0, head * head);
  vec3 c = mix(vColor.rgb * mix(0.55, 1.0, head), vec3(1.0, 0.92, 0.7), smoothstep(0.2, 0.0, d) * head * 0.35);
  a *= vColor.a * fxDepthFade(0.4);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a * uBoost, a);
  #include <colorspace_fragment>
}`;

export class StreakPool {
  constructor(capacity, { name = 'streaks' } = {}) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity * 2);
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.turb = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.cursor = 0;
    this.budget = 1;
    this.time = 0;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    // Base quad: x across [-1, 1], y from tail (0) to head (1).
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = inst(this.pos, 3); this.aVel = inst(this.vel, 3); this.aCol = inst(this.col, 4); this.aSize = inst(this.size, 2);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aCol);
    geo.setAttribute('iSize', this.aSize);
    geo.instanceCount = capacity;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...FXU, uBoost: { value: 2 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER.FX);
    this.mesh.renderOrder = 22;
    this.mesh.name = name;
  }

  // color → color1 over the life (hot yellow cooling to red). stretch: seconds of velocity behind the head.
  spawn(x, y, z, vx, vy, vz, { life = 1, width = 0.06, stretch = 0.08, color = [1, 0.8, 0.4], color1, alpha = 1, gravity = 0, drag = 0.5, turb = 0 } = {}) {
    if (this.budget < 1 && Math.random() > this.budget) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const j = i * 3;
    this.alive[i] = 1;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    const c1 = color1 || color;
    for (let k = 0; k < 3; k++) { this.c0[j + k] = color[k]; this.c1[j + k] = c1[k]; }
    this.life[i] = 0; this.maxLife[i] = life;
    this.width[i] = width; this.alpha0[i] = alpha;
    this.size[i * 2 + 1] = stretch;
    this.grav[i] = gravity; this.drag[i] = drag; this.turb[i] = turb;
    this.seed[i] = Math.random() * 40;
  }

  update(dt) {
    const T = (this.time += dt);
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const l = (this.life[i] += dt);
      const t = l / this.maxLife[i];
      const j = i * 3, q = i * 4;
      if (t >= 1) { this.alive[i] = 0; this.size[i * 2] = 0; continue; }
      n++;
      const k = Math.exp(-this.drag[i] * dt);
      let vx = this.vel[j] * k, vy = this.vel[j + 1] * k - this.grav[i] * dt, vz = this.vel[j + 2] * k;
      const tb = this.turb[i];
      if (tb > 0) {
        const s = this.seed[i];
        vx += (Math.sin(T * 1.7 + s) + 0.5 * Math.sin(T * 3.9 + s * 2.3)) * tb * dt;
        vz += (Math.cos(T * 1.4 + s * 1.3) + 0.5 * Math.cos(T * 3.3 + s * 0.7)) * tb * dt;
        vy += Math.sin(T * 2.3 + s * 3.3) * 0.3 * tb * dt;
      }
      this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
      this.pos[j] += vx * dt; this.pos[j + 1] += vy * dt; this.pos[j + 2] += vz * dt;
      for (let c = 0; c < 3; c++) this.col[q + c] = this.c0[j + c] + (this.c1[j + c] - this.c0[j + c]) * t;
      // Quick fade in, late fade out, and an ember's flicker.
      const fade = Math.min(1, t * 10) * (1 - Math.max(0, (t - 0.6) / 0.4));
      this.col[q + 3] = this.alpha0[i] * fade * (0.8 + 0.2 * Math.sin(T * 21 + this.seed[i] * 5));
      this.size[i * 2] = this.width[i] * (1 - 0.45 * t);
    }
    this.count = n;
    this.aPos.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

// Fixed-size particle pools rendered as Points (no allocation in the loop).
// Two blend modes: 'alpha' (dust, smoke, ash, splashes) and 'add' (fire, glow puffs).
// Rendered on the FX layer after outlines, softly occluded by the scene depth.
// Alpha particles are lit: the preset's ambient light on FX (uFxLight) + the local lights around
// them (smoke over a brazier is warm underneath, dust at night is moonlit), plus their own 'heat'
// (fire smoke and the volcano plume glow near the source). Additive particles write the glow mask.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { U, GLSL_LIGHTS } from '../toon.js';

// Shapes: 0 toon puff · 1 soft glow · 2 spark star · 3 ash flake (tumbling) · 4 smoke wisp.
export const SHAPE = { PUFF: 0, GLOW: 1, STAR: 2, FLAKE: 3, WISP: 4 };

const VERT = /* glsl */ `
${GLSL_LIGHTS}
attribute vec4 aColor;
attribute vec4 aData; // size, life01, shape + seed (fract), heat
uniform float uScale;
uniform float uLit;
uniform vec3 uFxLight;
varying vec4 vColor;
varying vec3 vLight;
varying float vLife;
varying float vShape;
varying float vSeed;
varying float vHeat;
void main() {
  vColor = aColor;
  vLife = aData.y;
  vShape = floor(aData.z + 0.001);
  vSeed = fract(aData.z);
  vHeat = aData.w * (1.0 - vLife) * (1.0 - vLife);
  vLight = uLit > 0.5 ? uFxLight + mnLocalOmni(position) * 0.4 : vec3(1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aData.x * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
  if (aData.x <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uAdditive;
uniform float uHeatK; // heat glow by preset (dim by day)
uniform float uBoost; // additive intensity (blending happens in linear light)
uniform sampler2D mnNoiseTex;
varying vec4 vColor;
varying vec3 vLight;
varying float vLife;
varying float vShape;
varying float vSeed;
varying float vHeat;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a;
  vec3 c = vColor.rgb;
  if (vShape < 0.5) {
    // toon puff: crisp disc with a lighter top-left lobe
    a = smoothstep(0.5, 0.45, d);
    float lit = smoothstep(0.32, 0.12, length(p - vec2(-0.12, -0.12)));
    c = mix(c * 0.86, min(c * 1.12, vec3(1.0)), lit);
    c = mix(c, c * 0.62, smoothstep(0.38, 0.47, d)); // toon rim so puffs read on sand too
  } else if (vShape < 1.5) {
    // soft glow (fire, embers)
    a = pow(smoothstep(0.5, 0.0, d), 1.6);
    c = mix(c, vec3(1.0, 0.9, 0.7), smoothstep(0.22, 0.0, d) * 0.45);
  } else if (vShape < 2.5) {
    // spark: 4-point star
    float s = max(smoothstep(0.08, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y)), smoothstep(0.08, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x)));
    a = max(s, smoothstep(0.18, 0.0, d));
  } else if (vShape < 3.5) {
    // ash flake: a thin ellipse that spins and tumbles (its width breathes)
    float ang = vSeed * 6.283 + vLife * (8.0 + vSeed * 10.0);
    vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
    float w = 0.18 + 0.32 * abs(sin(vLife * (14.0 + vSeed * 9.0) + vSeed * 20.0));
    a = smoothstep(0.5, 0.36, length(q / vec2(w, 1.0) * vec2(0.5, 1.1)));
    c *= 0.85 + 0.3 * step(0.0, q.y);
  } else {
    // smoke wisp: soft round body eaten by drifting noise, lighter on top
    vec2 uv = p * 0.42 + vec2(vSeed * 7.3, vSeed * 3.1 - vLife * 0.22);
    float n = texture2D(mnNoiseTex, uv).b;
    float body = smoothstep(0.5, 0.12, d);
    a = smoothstep(0.32, 0.62, body * (0.55 + 0.75 * n));
    c *= 0.82 + 0.3 * smoothstep(0.2, -0.3, p.y);
  }
  a *= vColor.a * fxDepthFade(vShape < 0.5 ? 0.2 : 0.5);
  if (a < 0.01) discard;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(c * a * uBoost, a); // alpha → glow mask (blended as dst * (1 - a))
  } else {
    gl_FragColor = vec4(c * vLight + vec3(1.0, 0.42, 0.12) * vHeat * uHeatK, a);
  }
  #include <colorspace_fragment>
}`;

export class ParticlePool {
  constructor(capacity, { additive = false, name = 'particles' } = {}) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.data = new Float32Array(capacity * 4);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.turb = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.cursor = 0;
    this.budget = 1;
    this.time = 0;
    this.wind = new THREE.Vector2(0, 0); // added to turbulent particles' velocity target (u/s)
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aData', this.aData);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...FXU, uScale: { value: 600 }, uAdditive: { value: additive ? 1 : 0 }, uLit: { value: additive ? 0 : 1 }, uHeatK: { value: 1 }, uBoost: { value: 1.8 },
        mnNoiseTex: U.mnNoiseTex, mnLightPos: U.mnLightPos, mnLightCol: U.mnLightCol, mnLightCount: U.mnLightCount,
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (additive) {
      // Color adds; the glow mask (alpha = 1 - glow) is multiplied by (1 - a).
      Object.assign(this.mat, {
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
      });
    }
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER.FX);
    this.points.renderOrder = additive ? 20 : 10;
    this.points.name = name;
  }

  // Scale point size with the target height so sizes are in ~world units.
  setViewport(heightPx, fovDeg) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(x, y, z, vx, vy, vz, { life = 0.6, size = 0.5, size1, color = [1, 1, 1], alpha = 1, gravity = 0, drag = 1.5, shape = 0, turb = 0, heat = 0 } = {}) {
    if (this.budget < 1 && Math.random() > this.budget) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    this.alive[i] = 1;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.size0[i] = size; this.size1[i] = size1 ?? size;
    this.alpha0[i] = alpha;
    this.col[i * 4] = color[0]; this.col[i * 4 + 1] = color[1]; this.col[i * 4 + 2] = color[2]; this.col[i * 4 + 3] = alpha;
    this.grav[i] = gravity; this.drag[i] = drag; this.turb[i] = turb;
    const seed = Math.random() * 0.98;
    this.seed[i] = seed * 40;
    this.data[i * 4 + 2] = shape + seed;
    this.data[i * 4 + 3] = heat;
  }

  update(dt) {
    const T = (this.time += dt);
    const wx = this.wind.x, wz = this.wind.y;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const l = (this.life[i] += dt);
      const t = l / this.maxLife[i];
      const j = i * 3, q = i * 4;
      if (t >= 1) { this.alive[i] = 0; this.data[q] = 0; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      let vx = this.vel[j] * k, vy = this.vel[j + 1] * k - this.grav[i] * dt, vz = this.vel[j + 2] * k;
      const tb = this.turb[i];
      if (tb > 0) {
        // Cheap curl-ish wander: a few incommensurate sines per particle, plus the wind.
        const s = this.seed[i];
        vx += (Math.sin(T * 1.3 + s) + 0.5 * Math.sin(T * 3.1 + s * 1.7) + wx * 0.4) * tb * dt;
        vz += (Math.cos(T * 1.1 + s * 1.3) + 0.5 * Math.cos(T * 2.7 + s * 0.6) + wz * 0.4) * tb * dt;
        vy += Math.sin(T * 1.9 + s * 2.1) * 0.35 * tb * dt;
      }
      this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
      this.pos[j] += vx * dt; this.pos[j + 1] += vy * dt; this.pos[j + 2] += vz * dt;
      // ease-out growth, fade in quickly, fade out late
      const e = 1 - (1 - t) * (1 - t);
      this.data[q] = this.size0[i] + (this.size1[i] - this.size0[i]) * e;
      this.data[q + 1] = t;
      const fade = Math.min(1, t * 8) * (1 - Math.max(0, (t - 0.55) / 0.45));
      this.col[q + 3] = this.alpha0[i] * fade;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aData.needsUpdate = true;
  }
}

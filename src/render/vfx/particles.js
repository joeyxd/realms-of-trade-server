// Fixed-size particle pools rendered as Points (no allocation in the loop).
// Two blend modes: 'alpha' (dust, smoke, splashes) and 'add' (fire, embers, sparks).
// Rendered on the FX layer after outlines, softly occluded by the scene depth.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aData; // size, life01, shape
uniform float uScale;
varying vec4 vColor;
varying float vLife;
varying float vShape;
void main() {
  vColor = aColor;
  vLife = aData.y;
  vShape = aData.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aData.x * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
  if (aData.x <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uAdditive;
varying vec4 vColor;
varying float vLife;
varying float vShape;
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
    c = mix(c, vec3(1.0, 0.95, 0.8), smoothstep(0.22, 0.0, d) * 0.7);
  } else {
    // spark: 4-point star
    float s = max(smoothstep(0.08, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y)), smoothstep(0.08, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x)));
    a = max(s, smoothstep(0.18, 0.0, d));
  }
  a *= vColor.a * fxDepthFade(vShape < 0.5 ? 0.2 : 0.5);
  if (a < 0.01) discard;
  if (uAdditive > 0.5) gl_FragColor = vec4(c * a, 1.0);
  else gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

export class ParticlePool {
  constructor(capacity, { additive = false, name = 'particles' } = {}) {
    this.cap = capacity;
    this.n = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.data = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.cursor = 0;
    this.budget = 1;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aData', this.aData);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...FXU, uScale: { value: 600 }, uAdditive: { value: additive ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (additive) {
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneFactor;
      this.mat.blendEquation = THREE.AddEquation;
    }
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER.FX);
    this.points.renderOrder = additive ? 20 : 10;
    this.points.name = name;
    for (let i = 0; i < capacity; i++) this.data[i * 3] = 0;
  }

  // Scale point size with the drawing-buffer height so sizes are in ~world units.
  setViewport(heightPx, fovDeg) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(x, y, z, vx, vy, vz, { life = 0.6, size = 0.5, size1, color = [1, 1, 1], alpha = 1, gravity = 0, drag = 1.5, shape = 0 } = {}) {
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
    this.grav[i] = gravity; this.drag[i] = drag;
    this.data[i * 3 + 2] = shape;
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const l = (this.life[i] += dt);
      const t = l / this.maxLife[i];
      if (t >= 1) { this.alive[i] = 0; this.data[i * 3] = 0; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k; this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt; this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      // ease-out growth, fade in quickly, fade out late
      const e = 1 - (1 - t) * (1 - t);
      this.data[j] = this.size0[i] + (this.size1[i] - this.size0[i]) * e;
      this.data[j + 1] = t;
      const fade = Math.min(1, t * 8) * (1 - Math.max(0, (t - 0.55) / 0.45));
      this.col[i * 4 + 3] = this.alpha0[i] * fade;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aData.needsUpdate = true;
  }
}

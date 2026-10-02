// Boss hazards of M3 (PLAN-M3.md §2.5), drawn straight from the client's hazard store on the projectile
// timeline (they freeze in the hitstop like the bullets):
//   BeamFx    telegraph lines / rectangles, the laser itself, the sliding bands of fire, the charge path
//   LavaRing  the molten ring that eats La Caldera from the rim inward in Hellfire's last phase
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { beamSeg, lavaR } from '../../sim/projectiles.js';
import { DT } from '../../data/tuning.js';

const ADD = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};
const ALPHA = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}`;

// A unit quad lying on XZ: x across (−0.5..0.5), z along (0..1 after the shift).
function quad(segAlong = 1) {
  const g = new THREE.PlaneGeometry(1, 1, 1, segAlong);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

const BEAM_VERT = /* glsl */ `
varying vec2 vL;
void main() { vL = vec2(position.x * 2.0, position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
${NOISE}
uniform float uKind;  // 0 telegraph line · 1 telegraph rectangle (fills) · 2 laser core · 3 band of fire · 4 laser scorch
uniform float uFill, uTime, uAlpha, uLen, uW;
varying vec2 vL;
void main() {
  float x = abs(vL.x), along = vL.y;
  float w = max(fwidth(x), 1e-4);
  vec3 col; float a;
  if (uKind < 0.5) {
    float line = 1.0 - smoothstep(0.35 - w, 0.35 + w, x);
    float dash = step(0.45, fract(along * uLen * 0.8 - uTime * 3.0));
    float flick = 0.65 + 0.35 * sin(uTime * 30.0);
    col = vec3(1.0, 0.18, 0.12); a = line * (0.35 + 0.45 * dash) * flick;
  } else if (uKind < 1.5) {
    float rim = smoothstep(0.86 - w, 0.9, x) * (1.0 - smoothstep(1.0 - w, 1.0, x));
    float ends = (1.0 - smoothstep(0.0, 0.02, along)) + smoothstep(0.98, 1.0, along);
    float fill = 1.0 - smoothstep(uFill - 0.02, uFill, along);
    float hatch = step(0.5, fract(along * uLen * 0.9 + vL.x * 0.6 - uTime * 1.5)) * 0.1;
    col = mix(vec3(1.0, 0.25, 0.15), vec3(1.0, 0.75, 0.55), smoothstep(uFill - 0.08, uFill, along) * fill);
    a = max(rim * 0.85, (0.12 + hatch + fill * 0.28) * (1.0 - smoothstep(0.98, 1.0, x))) + ends * 0.4;
  } else if (uKind < 2.5) {
    float core = 1.0 - smoothstep(0.0, 0.28, x);
    float halo = 1.0 - smoothstep(0.1, 1.0, x);
    float n = vnoise(vec2(along * uLen * 1.5 - uTime * 18.0, x * 3.0));
    col = mix(vec3(1.0, 0.25, 0.55), vec3(1.0, 0.95, 0.85), core) * (0.8 + 0.4 * n);
    a = max(core, halo * halo * (0.55 + 0.3 * n));
    a *= smoothstep(0.0, 0.03, along) * (1.0 - smoothstep(0.92, 1.0, along));
  } else if (uKind < 3.5) {
    // Band of fire: licking flames scrolling with the band's slide, a hot core, dark ragged edges.
    float n = vnoise(vec2(vL.x * 2.2 * uW - uTime * 3.0, along * uLen * 0.5));
    float n2 = vnoise(vec2(vL.x * 5.0 * uW + 7.0, along * uLen * 1.4 - uTime * 2.0));
    float edge = 1.0 - smoothstep(0.55 + 0.3 * n, 1.0, x);
    float hot = 1.0 - smoothstep(0.0, 0.6 + 0.3 * n2, x);
    col = mix(vec3(0.75, 0.1, 0.02), vec3(1.0, 0.55, 0.12), hot) * (0.6 + 0.35 * n2);
    a = edge * (0.5 + 0.35 * hot);
  } else {
    float s = 1.0 - smoothstep(0.0, 1.0, x);
    col = vec3(1.0, 0.35, 0.3); a = s * s * 0.45;
  }
  a *= uAlpha * fxDepthFadeBias(0.15, 0.3);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}`;

export class BeamFx {
  constructor(scene, map, count = 12) {
    this.map = map;
    this.time = 0;
    this.pool = [];
    const geo = quad(8);
    for (let i = 0; i < count * 2; i++) {
      const mat = new THREE.ShaderMaterial({
        ...ADD, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
        uniforms: { ...FXU, uKind: { value: 0 }, uFill: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 1 }, uLen: { value: 10 }, uW: { value: 1 } },
      });
      const m = new THREE.Mesh(geo, mat);
      m.layers.set(LAYER.FX);
      m.frustumCulled = false;
      m.renderOrder = 4;
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
    this.seg = { ax: 0, az: 0, bx: 0, bz: 0, ox: 0, oz: 0, ang: 0 };
  }

  meshes() { return this.pool; }

  put(m, kind, x, y, z, ang, w, len, fill = 0, alpha = 1) {
    const u = m.material.uniforms;
    u.uKind.value = kind; u.uFill.value = fill; u.uTime.value = this.time; u.uAlpha.value = alpha; u.uLen.value = len; u.uW.value = w;
    m.position.set(x, y, z);
    m.rotation.set(0, ang, 0);
    m.scale.set(w, 1, Math.max(0.01, len));
    m.visible = true;
  }

  // hz: the client hazard store; tick: the projectile tick shown this frame.
  update(dt, hz, tick) {
    this.time += dt;
    let k = 0;
    const S = this.seg, G = (x, z) => this.map.groundAt(x, z);
    for (const b of hz.beams) {
      if (k + 2 > this.pool.length) break;
      if (tick < b.t0 || tick > b.tEnd + 6) continue;
      const fade = b.cancel ? Math.max(0, 1 - (tick - b.cancelT) * DT * 5) : tick > b.tEnd ? Math.max(0, 1 - (tick - b.tEnd) / 6) : 1;
      if (fade <= 0) continue;
      const tele = tick < b.tAct;
      beamSeg(b, tick, S);
      const dx = Math.sin(S.ang), dz = Math.cos(S.ang);
      if (b.kind === 'charge') {
        if (!tele) continue;
        // The whole rush, from where he stands to where he stops; fills as the wind-up runs out.
        const fill = (tick - b.t0) / Math.max(1, b.tAct - b.t0);
        const mx = b.x0 + dx * b.tele * 0.5, mz = b.z0 + dz * b.tele * 0.5;
        this.put(this.pool[k++], 1, b.x0, G(mx, mz) + 0.08, b.z0, b.ang0, b.w, b.tele, fill, fade);
      } else if (b.kind === 'laser') {
        const y = G(S.ox, S.oz);
        if (tele) this.put(this.pool[k++], 0, S.ax, y + 0.1, S.az, S.ang, 0.5, b.len, 0, fade);
        else {
          this.put(this.pool[k++], 2, S.ax, y + 1.05, S.az, S.ang, b.w * 1.6, b.len, 0, fade);
          this.put(this.pool[k++], 4, S.ax, y + 0.09, S.az, S.ang, b.w * 2.2, b.len, 0, fade * 0.8);
        }
      } else {
        // A lane: telegraph = where it starts (dim, flickering), then the band slides across.
        const y = G(S.ax + dx * b.len * 0.5, S.az + dz * b.len * 0.5);
        if (tele) {
          const tm = this.pool[k++];
          this.put(tm, 1, S.ax, y + 0.08, S.az, S.ang, b.w, b.len, (tick - b.t0) / Math.max(1, b.tAct - b.t0), fade * 0.8);
        } else this.put(this.pool[k++], 3, S.ax, y + 0.1, S.az, S.ang, b.w * 1.15, b.len, 0, fade);
      }
    }
    for (; k < this.pool.length; k++) this.pool[k].visible = false;
  }
}

// ---- Lava ring --------------------------------------------------------------------------------------
const LAVA_VERT = /* glsl */ `
attribute vec2 aPolar; // 0 = inner edge .. 1 = outer, angle 0..1
varying vec2 vPolar; varying vec3 vW;
void main() { vPolar = aPolar; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const LAVA_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
${NOISE}
uniform float uTime, uAlpha, uWarn;
varying vec2 vPolar; varying vec3 vW;
void main() {
  vec2 p = vW.xz * 0.45;
  float n = vnoise(p + vec2(uTime * 0.12, -uTime * 0.08)) * 0.6 + vnoise(p * 2.7 - uTime * 0.2) * 0.4;
  // Dark crust plates with glowing cracks between them.
  float cell = vnoise(p * 1.6 + 3.0);
  float crack = 1.0 - smoothstep(0.04, 0.14, abs(cell - 0.5 + 0.12 * sin(uTime * 0.7 + n * 6.0)));
  vec3 molten = mix(vec3(0.7, 0.12, 0.01), vec3(0.95, 0.45, 0.08), n);
  vec3 crust = vec3(0.12, 0.04, 0.03) * (0.7 + 0.6 * n);
  float plate = smoothstep(0.4, 0.58, n) * (1.0 - crack);
  vec3 col = mix(molten, crust, plate * 0.9);
  // The advancing front: a bright rim that pulses (you can see where it is going to be).
  float edge = 1.0 - smoothstep(0.0, 0.05, vPolar.x);
  col = mix(col, vec3(1.0, 0.62, 0.2), edge * (0.55 + 0.35 * sin(uTime * 6.0)) * (0.6 + 0.4 * uWarn));
  float a = smoothstep(0.0, 0.015, vPolar.x) * 0.96 * uAlpha * fxDepthFadeBias(0.2, 0.35);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const RS = 4, AS = 120;
export class LavaRing {
  constructor(scene, map) {
    this.map = map;
    this.time = 0;
    const n = (RS + 1) * (AS + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    const polar = new Float32Array(n * 2);
    let k = 0;
    for (let i = 0; i <= RS; i++) for (let j = 0; j <= AS; j++) { polar[k * 2] = i / RS; polar[k * 2 + 1] = j / AS; k++; }
    const idx = [];
    for (let i = 0; i < RS; i++) for (let j = 0; j < AS; j++) {
      const a = i * (AS + 1) + j, b = a + 1, c = a + AS + 1, d = c + 1;
      idx.push(a, c, b, b, c, d); // counter-clockwise seen from above
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ ...ALPHA, side: THREE.DoubleSide, vertexShader: LAVA_VERT, fragmentShader: LAVA_FRAG, uniforms: { ...FXU, uTime: { value: 0 }, uAlpha: { value: 0 }, uWarn: { value: 0 } } });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.layers.set(LAYER.FX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.r = -1; this.id = 0; this.alpha = 0; this.last = null;
  }

  place(L, r) {
    const P = this.pos, outer = L.R + 1.5;
    for (let i = 0; i <= RS; i++) {
      // Denser near the front, where the ground changes most.
      const f = Math.pow(i / RS, 1.6), rr = r + (outer - r) * f;
      for (let j = 0; j <= AS; j++) {
        const a = (j / AS) * Math.PI * 2, x = L.cx + Math.sin(a) * rr, z = L.cz + Math.cos(a) * rr, k = (i * (AS + 1) + j) * 3;
        P[k] = x; P[k + 1] = this.map.groundAt(x, z) + 0.06 + f * 0.1; P[k + 2] = z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.r = r;
  }

  update(dt, hz, tick) {
    this.time += dt;
    const L = hz.lava;
    if (L) this.last = L;
    const want = L && tick >= L.t0 - 30 ? 1 : 0;
    this.alpha += (want - this.alpha) * Math.min(1, dt * (want ? 1.5 : 2.5));
    const S = this.last;
    if (!S || this.alpha < 0.01) { this.mesh.visible = false; return; }
    const r = lavaR(S, Math.max(tick, S.t0));
    if (S.id !== this.id || Math.abs(r - this.r) > 0.04) { this.id = S.id; this.place(S, r); }
    const u = this.mat.uniforms;
    u.uTime.value = this.time; u.uAlpha.value = this.alpha; u.uWarn.value = r > S.rMin + 0.05 ? 1 : 0;
    this.mesh.visible = true;
  }
}

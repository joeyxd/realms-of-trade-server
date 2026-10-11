// Aiming indicators (M4.7 P4, PLAN-M4.7.md §2.4), RTS / MOBA style, hugging the ground like the decals:
//   range ring    dashed, faint, around you at the skill's reach (only while you aim)
//   area marker   a translucent disk, a crisp inked rim, an inner dashed ring turning and a cross (radius = the
//                 form's r); the Abordaje adds a dashed arc from you to its landing point (the jump's height)
//   charge        the Timón: an arrow from you along the aim (its length and width grow with the charge) and a ring
//                 at your feet that fills with it; a flash when it is full
//   Tromba cast   everyone sees where a Tromba will land: its marker with a ring closing until the impact (violet
//                 yours, amber another pirate's; the enemies' telegraphs stay red in decals.js)
// Only you see your own aim. Meshes are pooled and made once; a hidden one costs nothing; a marker is only
// re-laid on the ground when it moves.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { DT } from '../../data/tuning.js';

export const AIM_COLOR = { mine: 0xa77bff, other: 0xffb347, frost: 0x71eaff, mastbolt: 0xffdf3b, ink: 0x1a1033 };
const RINGS = 6, SEGS = 64;

const BLEND = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};

const POLAR_VERT = /* glsl */ `
attribute vec2 aPolar; // normalized radius, angle 0..1
varying vec2 vPolar;
void main() { vPolar = aPolar; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// uKind 0 = range ring · 1 = area marker · 2 = charge ring (fills with uFill) · 3 = a cast Tromba (a ring closing
// with uFill toward the impact).
const POLAR_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uKind, uFill, uTime, uAlpha, uFlash;
uniform vec3 uColor, uInk;
varying vec2 vPolar;
float band(float r, float a, float b, float w) { return smoothstep(a - w, a, r) * (1.0 - smoothstep(b, b + w, r)); }
void main() {
  float r = vPolar.x, ang = vPolar.y, w = max(fwidth(r), 1e-4);
  vec3 col = uColor; float a = 0.0;
  if (uKind < 0.5) {
    float dash = step(0.45, fract(ang * 48.0 - uTime * 0.25));
    a = band(r, 0.965, 1.0, w) * dash * 0.55;
    a = max(a, band(r, 1.0, 1.02, w) * dash * 0.4);
    col = mix(uColor, uInk, band(r, 1.0, 1.02, w));
  } else if (uKind < 1.5 || uKind > 2.5) {
    float rim = band(r, 0.93, 0.985, w);
    float ink = band(r, 0.985, 1.04, w);
    float disk = (1.0 - smoothstep(0.93, 0.93 + w, r));
    float spin = step(0.5, fract(ang * 10.0 - uTime * 0.55)) * band(r, 0.6, 0.65, w);
    float cross = (step(0.985, fract(ang * 4.0 + 0.125 + 0.0025)) + step(fract(ang * 4.0 + 0.125), 0.015)) * step(r, 0.22) * step(0.05, r);
    float dot = 1.0 - smoothstep(0.035, 0.035 + w, r);
    float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
    a = max(rim * 0.95, disk * (0.13 + 0.05 * pulse));
    a = max(a, max(spin * 0.7, max(cross, dot) * 0.9));
    col = mix(uColor, vec3(1.0), (rim + cross + dot) * 0.35);
    if (uKind > 2.5) {
      // The ring closing toward the impact, a brighter fill behind it; a white flash as it lands.
      float c = 1.0 - uFill;
      float closing = band(r, c - 0.045, c, w) * step(0.02, c);
      float inside = smoothstep(c, c + 0.3, r) * disk * 0.18; // the part the ring has swept: brighter
      a = max(a, max(closing, inside));
      col = mix(col, vec3(1.0, 0.97, 0.9), closing * 0.6 + uFlash);
      a = max(a, disk * uFlash * 0.8);
    }
    a = max(a, ink * 0.8);
    col = mix(col, uInk, ink);
  } else {
    // The charge: a ring at your feet filling clockwise; a white pulse when full.
    float ringA = band(r, 0.8, 1.0, w);
    float lit = step(ang, uFill);
    a = ringA * mix(0.25, 0.9, lit);
    col = mix(uColor * 0.6, mix(uColor, vec3(1.0), 0.35 + uFlash * 0.65), lit);
    float ink = band(r, 1.0, 1.06, w) + band(r, 0.74, 0.8, w);
    a = max(a, clamp(ink, 0.0, 1.0) * 0.7);
    col = mix(col, uInk, clamp(ink, 0.0, 1.0));
  }
  a *= uAlpha * fxDepthFadeBias(0.15, 0.3);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

// The charge arrow and the leap arc: a strip with aUv = (along 0..1, across −1..1).
const STRIP_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STRIP_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uKind, uTime, uAlpha, uFill, uTip, uFlash;
uniform vec3 uColor, uInk;
varying vec2 vUv;
void main() {
  float u = vUv.x, v = abs(vUv.y), w = max(fwidth(v), 1e-4);
  vec3 col = uColor; float a = 0.0;
  if (uKind < 0.5) {
    // Arrow: the strip narrows to a point past uTip (the geometry does it); an inked edge, chevrons running out.
    float head = step(uTip, u);
    float ink = smoothstep(0.86 - w, 0.86, v);
    float edge = smoothstep(0.7 - w, 0.7, v) * (1.0 - ink);
    float chev = step(0.6, fract(u * 7.0 - v * 0.6 - uTime * 1.6)) * (1.0 - head) * 0.25;
    a = (0.16 + chev + uFill * 0.12 + head * 0.22) * (1.0 - ink) + edge * 0.75 + ink * 0.7;
    col = mix(mix(uColor, vec3(1.0), edge * 0.35 + uFlash * 0.5 + head * 0.2), uInk, ink);
  } else {
    // The leap arc: a dashed ribbon.
    float dash = step(0.42, fract(u * 9.0 - uTime * 1.2));
    float inside = 1.0 - smoothstep(0.7 - w, 0.7, v);
    float ink = smoothstep(0.7 - w, 0.7, v) * (1.0 - smoothstep(1.0, 1.0 + w, v));
    a = (inside * 0.85 + ink * 0.7) * dash * smoothstep(0.0, 0.06, u);
    col = mix(mix(uColor, vec3(1.0), 0.3), uInk, ink);
  }
  a *= uAlpha * fxDepthFadeBias(0.1, 0.2);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function polarGeometry(radii, segs = SEGS) {
  const n = radii.length * (segs + 1);
  const pos = new Float32Array(n * 3), polar = new Float32Array(n * 2), idx = [];
  let k = 0;
  for (const r of radii) for (let j = 0; j <= segs; j++) { polar[k * 2] = r; polar[k * 2 + 1] = j / segs; k++; }
  for (let i = 0; i < radii.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

function stripGeometry(n) {
  const pos = new Float32Array((n + 1) * 2 * 3), uv = new Float32Array((n + 1) * 2 * 2), idx = [];
  for (let i = 0; i <= n; i++) for (let s = 0; s < 2; s++) { const k = i * 2 + s; uv[k * 2] = i / n; uv[k * 2 + 1] = s ? 1 : -1; }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export class Indicators {
  constructor(scene, map, count = 6) {
    this.map = map;
    this.time = 0;
    const mk = (geo, vert, frag, order, extra = {}) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uKind: { value: 0 }, uFill: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 1 }, uFlash: { value: 0 }, uTip: { value: 0.8 }, uColor: { value: new THREE.Color(AIM_COLOR.mine) }, uInk: { value: new THREE.Color(AIM_COLOR.ink) }, ...extra },
        vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, ...BLEND,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.layers.set(LAYER.FX); mesh.renderOrder = order; mesh.visible = false;
      scene.add(mesh);
      return { mesh, mat, geo, key: '' };
    };
    const disk = [0, 0.03, 0.06, 0.2, 0.25, 0.55, 0.6, 0.66, 0.9, 0.93, 0.985, 1.04];
    this.range = mk(polarGeometry([0.95, 1.03], 128), POLAR_VERT, POLAR_FRAG, 2);
    this.marker = mk(polarGeometry(disk), POLAR_VERT, POLAR_FRAG, 4);
    this.marker.mat.uniforms.uKind.value = 1;
    this.chargeRing = mk(polarGeometry([0.72, 0.8, 1.0, 1.07], 64), POLAR_VERT, POLAR_FRAG, 4);
    this.chargeRing.mat.uniforms.uKind.value = 2;
    this.arrow = mk(stripGeometry(28), STRIP_VERT, STRIP_FRAG, 3);
    this.arc = mk(stripGeometry(32), STRIP_VERT, STRIP_FRAG, 5);
    this.arc.mat.uniforms.uKind.value = 1;
    // Cast Trombas everyone sees: {d, id, t0, tick, done}.
    this.casts = [];
    for (let i = 0; i < count; i++) {
      const d = mk(polarGeometry(disk), POLAR_VERT, POLAR_FRAG, 4);
      d.mat.uniforms.uKind.value = 3;
      this.casts.push({ d, id: 0, t0: 0, tick: 0, live: false, after: 0 });
    }
    this.full = false;
    this.onFull = null; // (k reached 1) → the client plays its tick
  }

  // Lay polar mesh d on the ground around (x, z) at radius r (only when it moved).
  lay(d, x, z, r, lift = 0.08) {
    const key = `${x.toFixed(2)}:${z.toFixed(2)}:${r.toFixed(2)}`;
    if (key === d.key) return;
    d.key = key;
    const pos = d.geo.attributes.position.array, polar = d.geo.attributes.aPolar.array, map = this.map;
    for (let k = 0; k < polar.length / 2; k++) {
      const rr = polar[k * 2] * r, a = polar[k * 2 + 1] * Math.PI * 2;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      pos[k * 3] = px; pos[k * 3 + 1] = map.groundAt(px, pz) + lift; pos[k * 3 + 2] = pz;
    }
    d.geo.attributes.position.needsUpdate = true;
  }

  // ---- your own aim (call every frame while aiming, hide() when not) -----------------------------------
  // An area: range ring around (px, pz), marker at (x, z) of radius r; arcH > 0 draws the leap arc to it.
  area(px, pz, range, x, z, r, arcH = 0, color = AIM_COLOR.mine) {
    this.lay(this.range, px, pz, Math.max(0.5, range));
    this.range.mat.uniforms.uColor.value.set(color);
    this.range.mesh.visible = range > 0.5;
    this.lay(this.marker, x, z, Math.max(0.35, r));
    this.marker.mat.uniforms.uColor.value.set(color);
    this.marker.mesh.visible = true;
    this.chargeRing.mesh.visible = false; this.arrow.mesh.visible = false;
    if (arcH > 0) this.layArc(px, pz, x, z, arcH); else this.arc.mesh.visible = false;
    this.full = false;
  }

  // The charge: arrow from (px, pz) along (dx, dz), `len` long, `w` wide; ring at your feet filled to k (0..1).
  charge(px, pz, dx, dz, len, w, k, range, color = AIM_COLOR.mine, coneAngle = 0, fullCue = true) {
    this.chargeRing.mat.uniforms.uColor.value.set(color);
    this.arrow.mat.uniforms.uColor.value.set(color);
    this.arrow.mat.uniforms.uAlpha.value = coneAngle ? 0.65 : 1;
    this.range.mat.uniforms.uColor.value.set(color);
    const U = this.chargeRing.mat.uniforms;
    this.lay(this.chargeRing, px, pz, 0.95, 0.06);
    this.chargeRing.key = ''; // follows you every frame
    U.uFill.value = k;
    if (k >= 1 && !this.full) { this.full = true; U.uFlash.value = 1; if (fullCue && this.onFull) this.onFull(); }
    if (k < 1) this.full = false;
    this.chargeRing.mesh.visible = true;
    const spread = Math.tan(coneAngle * Math.PI / 360);
    this.layArrow(px + (spread ? 0 : dx * 0.6), pz + (spread ? 0 : dz * 0.6), dx, dz, len, w, k, spread);
    if (range > 0) { this.lay(this.range, px, pz, range); this.range.key = ''; this.range.mesh.visible = true; } else this.range.mesh.visible = false;
    this.marker.mesh.visible = false; this.arc.mesh.visible = false;
  }

  hide() {
    for (const d of [this.range, this.marker, this.chargeRing, this.arrow, this.arc]) d.mesh.visible = false;
    this.full = false;
  }

  layArrow(x0, z0, dx, dz, len, w, k, spread = 0) {
    const g = this.arrow.geo, pos = g.attributes.position.array, n = pos.length / 6 - 1, map = this.map;
    const head = Math.min(1.1, len * 0.3), tip = Math.max(0.5, 1 - head / Math.max(len, 0.1));
    for (let i = 0; i <= n; i++) {
      const u = i / n, s = u * len, cx = x0 + dx * s, cz = z0 + dz * s;
      const half = spread
        ? Math.max(0.08, s * spread)
        : w * (u > tip ? 1.7 * (1 - (u - tip) / (1 - tip)) : 1);
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1, scale = spread ? 1 : 1.25, px = cx + dz * half * sg * scale, pz = cz - dx * half * sg * scale, q = (i * 2 + side) * 3;
        pos[q] = px; pos[q + 1] = map.groundAt(px, pz) + 0.09; pos[q + 2] = pz;
      }
    }
    g.attributes.position.needsUpdate = true;
    const U = this.arrow.mat.uniforms;
    U.uTip.value = tip; U.uFill.value = k;
    this.arrow.mesh.visible = len > 0.2;
  }

  // A dashed ribbon from (x0, z0) to (x1, z1) rising h at its middle (the parabola the leap flies).
  layArc(x0, z0, x1, z1, h) {
    const key = `${x0.toFixed(2)}:${z0.toFixed(2)}:${x1.toFixed(2)}:${z1.toFixed(2)}:${h}`;
    this.arc.mesh.visible = true;
    if (key === this.arc.key) return;
    this.arc.key = key;
    const g = this.arc.geo, pos = g.attributes.position.array, n = pos.length / 6 - 1, map = this.map;
    const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L, nz = (x1 - x0) / L, w = 0.09;
    const y0 = map.groundAt(x0, z0), y1 = map.groundAt(x1, z1);
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u, y = y0 + (y1 - y0) * u + h * 4 * u * (1 - u) + 0.15;
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1, q = (i * 2 + side) * 3;
        pos[q] = x + nx * w * sg; pos[q + 1] = y; pos[q + 2] = z + nz * w * sg;
      }
    }
    g.attributes.position.needsUpdate = true;
  }

  // ---- a Tromba on its way (everyone) ----------------------------------------------------------------------
  // key: unique per column (id × 2 + n); t0 → tick: the ring closes; mine: violet, else amber.
  tromba(key, x, z, r, t0, tick, mine) {
    const c = this.casts.find((q) => !q.live) || this.casts.reduce((a, b) => (a.tick < b.tick ? a : b));
    Object.assign(c, { id: key, t0, tick, live: true, after: 0 });
    c.d.key = '';
    this.lay(c.d, x, z, r);
    const U = c.d.mat.uniforms;
    U.uColor.value.set(mine ? AIM_COLOR.mine : AIM_COLOR.other);
    U.uFill.value = 0; U.uFlash.value = 0; U.uAlpha.value = mine ? 1 : 0.85;
    c.d.mesh.visible = true;
  }

  // tick: the projectile tick shown this frame.
  update(dt, tick) {
    if (this.freeze) { dt = 0; tick = this.freezeTick ?? tick; }
    this.time += dt;
    for (const d of [this.range, this.marker, this.chargeRing, this.arrow, this.arc]) d.mat.uniforms.uTime.value = this.time;
    const cu = this.chargeRing.mat.uniforms;
    cu.uFlash.value = Math.max(0, cu.uFlash.value - dt * 3);
    this.arrow.mat.uniforms.uFlash.value = cu.uFlash.value;
    for (const c of this.casts) {
      if (!c.live) continue;
      const U = c.d.mat.uniforms;
      U.uTime.value = this.time;
      if (tick < c.tick) { U.uFill.value = Math.max(0, Math.min(1, (tick - c.t0) / Math.max(1, c.tick - c.t0))); continue; }
      // Landed: a white flash, then it fades out over 0.25 s.
      c.after += dt;
      U.uFill.value = 1; U.uFlash.value = Math.max(0, 1 - c.after / 0.12);
      U.uAlpha.value = Math.max(0, 1 - c.after / 0.25);
      if (c.after >= 0.25 || tick > c.tick + 0.6 / DT) { c.live = false; c.d.mesh.visible = false; }
    }
  }
}

// Tattoo VFX (M4.7 P4, PLAN-M4.7.md §2.5): what the three tattoos look like for everyone, driven by their events.
//   Tromba     (trombaHit) a waterspout: a twisting, tapering water column (spiral foam bands scrolling up, rim
//              light at the silhouette) that slams down, spins and collapses in ~0.65 s; foam ring, droplets and a
//              splash ring at its foot. «Ojo de tormenta» leaves a whirlpool on the ground until trombaEnd.
//   Abordaje   (cast → slam) a shadow that grows on the landing point while you fly, afterimages in the air; the slam:
//              a shock ring of the blow's radius, dust thrown out, chips of ground; «Ancla» bigger and darker.
//   Timón      (wheel → wheelBack → wheelCatch / wheelDrop) a ship's wheel (8 spokes with handles, rim, brass hub;
//              toon + ink like any prop) spinning flat: out along the analytic path the sim uses, hanging at the
//              apex («Remolino»), back homing on its owner; a trail off the rim; caught: a flash; dropped: it falls
//              flat and fades. While charging, the wheel rides at your shoulder.
// Pooled, made once; nothing is allocated per frame but the particles of the shared pools.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { toon, normalMatFor } from '../toon.js';
import { DT } from '../../data/tuning.js';
import { SKILLS } from '../../data/weapons.js';
import { elementVisual } from '../../data/elements.js';

const NORMAL = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};

// ---- the waterspout ---------------------------------------------------------------------------------------
// A unit open cylinder (base at y = 0, top at 1) whose radius profile and twist the vertex shader makes.
const SPOUT_VERT = /* glsl */ `
uniform float uTime, uGrow, uSpin, uFlare;
varying vec2 vUv;
varying float vFres, vY;
void main() {
  vUv = uv;
  float y = position.y;
  // Hourglass: wide splash at the foot, a narrow waist, a flared crown; it twists with height and time.
  float prof = mix(1.0, 0.48, smoothstep(0.0, 0.4, y)) * mix(1.0, 1.45, smoothstep(0.6, 1.0, y)) * (1.0 + uFlare * (1.0 - y));
  float ang = atan(position.z, position.x) + y * 2.6 + uSpin;
  float wob = 1.0 + 0.08 * sin(ang * 3.0 + y * 9.0 - uTime * 8.0);
  vec3 p = vec3(cos(ang), 0.0, sin(ang)) * prof * wob;
  p.y = y * uGrow;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * vec3(cos(ang), 0.25, sin(ang)));
  vFres = 1.0 - abs(dot(n, normalize(-mv.xyz)));
  vY = y;
  gl_Position = projectionMatrix * mv;
}`;
const SPOUT_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uTime, uFade;
uniform vec3 uDeep, uFoam;
varying vec2 vUv;
varying float vFres, vY;
void main() {
  float bands = smoothstep(0.62, 0.8, fract(vUv.x * 3.0 + vUv.y * 2.2 - uTime * 3.4));
  float streak = smoothstep(0.86, 0.97, fract(vUv.x * 7.0 - vUv.y * 0.6 + uTime * 1.3));
  float rim = smoothstep(0.6, 1.0, vFres);
  float foam = clamp(bands * 0.6 + streak * 0.4 + rim * 0.45 + smoothstep(0.75, 1.0, vY) * 0.3, 0.0, 1.0);
  vec3 c = mix(uDeep * (0.75 + 0.35 * vY), uFoam, foam) * uFxLight;
  float a = (0.3 + 0.38 * vFres + bands * 0.22) * uFade;
  a *= smoothstep(0.0, 0.06, vY) * (1.0 - smoothstep(0.86, 1.0, vY));
  a *= fxDepthFade(0.4);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a, a * (0.12 + foam * 0.2)); // premultiplied; only the foam glows a little
  #include <colorspace_fragment>
}`;

// ---- ground disks (whirlpool, landing shadow): polar mesh laid on the ground -------------------------------
const DISK_VERT = /* glsl */ `
attribute vec2 aPolar;
varying vec2 vPolar;
void main() { vPolar = aPolar; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DISK_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uKind, uTime, uFade, uGrow;
uniform vec3 uDeep, uFoam;
varying vec2 vPolar;
void main() {
  float r = vPolar.x, ang = vPolar.y;
  vec3 c; float a;
  if (uKind < 0.5) {
    // Whirlpool: spiral arms of foam sucked toward a dark eye.
    float arms = smoothstep(0.6, 0.85, fract(ang * 4.0 + r * 2.4 + uTime * 1.6));
    float eye = 1.0 - smoothstep(0.08, 0.3, r);
    float rim = smoothstep(0.84, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
    c = mix(uDeep * 0.8, uFoam, arms * (1.0 - eye) * 0.6 + rim * 0.45) * uFxLight;
    c = mix(c, uDeep * 0.25, eye);
    a = (0.34 + arms * 0.26 + rim * 0.3) * (1.0 - smoothstep(0.92, 1.0, r)) * uFade;
  } else {
    // The landing shadow: a soft dark disk that grows while the jump flies (uGrow 0..1).
    float d = r / max(uGrow, 0.05);
    c = vec3(0.04, 0.02, 0.08);
    a = (1.0 - smoothstep(0.55, 1.0, d)) * 0.55 * uFade;
    float ring = smoothstep(0.86, 0.94, d) * (1.0 - smoothstep(0.94, 1.0, d));
    c = mix(c, uFoam, ring * 0.5); a = max(a, ring * 0.35 * uFade);
  }
  a *= fxDepthFadeBias(0.15, 0.3);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a, a * 0.08);
  #include <colorspace_fragment>
}`;

function polarGeometry(rings = 6, segs = 48) {
  const radii = [];
  for (let i = 0; i <= rings; i++) radii.push(i / rings);
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

// ---- the ship's wheel ---------------------------------------------------------------------------------------
// Radius 1 (the rim's centre line), flat in XZ, vertex coloured: oak spokes and rim, darker handles, brass hub and
// studs. One merged geometry.
function wheelGeometry() {
  const parts = [], col = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const rim = new THREE.TorusGeometry(1, 0.11, 6, 40); rim.rotateX(Math.PI / 2);
  parts.push(col(rim, 0x8a5a2e));
  const inner = new THREE.TorusGeometry(0.42, 0.05, 5, 24); inner.rotateX(Math.PI / 2);
  parts.push(col(inner, 0x7a4c26));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.CylinderGeometry(0.055, 0.07, 1.0, 6); spoke.rotateZ(Math.PI / 2); spoke.translate(0.62, 0, 0); spoke.rotateY(a);
    parts.push(col(spoke, 0xc98a4a));
    const handle = new THREE.CylinderGeometry(0.06, 0.085, 0.36, 6); handle.rotateZ(Math.PI / 2); handle.translate(1.27, 0, 0); handle.rotateY(a);
    parts.push(col(handle, 0x5a3418));
    const knob = new THREE.SphereGeometry(0.09, 6, 4); knob.translate(1.46, 0, 0); knob.rotateY(a);
    parts.push(col(knob, 0x5a3418));
    const stud = new THREE.SphereGeometry(0.06, 5, 3); stud.translate(1.0, 0.09, 0); stud.rotateY(a + Math.PI / 8);
    parts.push(col(stud, 0xe0b04a));
  }
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 10);
  parts.push(col(hub, 0xe0b04a));
  const cap = new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8);
  parts.push(col(cap, 0xffd36a));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cc = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); cc.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  g.computeBoundingSphere();
  return g;
}

const DEEP = new THREE.Color(0x1f86c0), FOAM = new THREE.Color(0xdff7ff);

export class SkillFx {
  // viewOf(e) → the CharacterView of entity e (yours too), or null.
  constructor(scene, effects, combatFx, after, map, viewOf) {
    Object.assign(this, { effects, combatFx, after, map, viewOf });
    this.time = 0;
    this.tmp = new THREE.Vector3();
    const spoutGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 10, true);
    spoutGeo.translate(0, 0.5, 0);
    this.spouts = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uTime: { value: 0 }, uGrow: { value: 0 }, uSpin: { value: 0 }, uFlare: { value: 0 }, uFade: { value: 1 }, uDeep: { value: DEEP.clone() }, uFoam: { value: FOAM.clone() } },
        vertexShader: SPOUT_VERT, fragmentShader: SPOUT_FRAG, side: THREE.DoubleSide, ...NORMAL,
      });
      const m = new THREE.Mesh(spoutGeo, mat);
      m.layers.set(LAYER.FX); m.frustumCulled = false; m.visible = false; m.renderOrder = 26;
      scene.add(m);
      this.spouts.push({ m, mat, t: -1, life: 0.65, r: 1, h: 4, x: 0, z: 0, drops: 0 });
    }
    const mkDisk = (kind) => {
      const geo = polarGeometry();
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uKind: { value: kind }, uTime: { value: 0 }, uFade: { value: 1 }, uGrow: { value: 0 }, uDeep: { value: DEEP.clone() }, uFoam: { value: FOAM.clone() } },
        vertexShader: DISK_VERT, fragmentShader: DISK_FRAG, ...NORMAL,
      });
      const m = new THREE.Mesh(geo, mat);
      m.layers.set(LAYER.FX); m.frustumCulled = false; m.visible = false; m.renderOrder = 3;
      scene.add(m);
      return { m, mat, geo, live: false };
    };
    this.vortices = [mkDisk(0), mkDisk(0), mkDisk(0)];
    this.shadows = [mkDisk(1), mkDisk(1), mkDisk(1), mkDisk(1)];
    // Wheels: toon + ink (an object, not light).
    const wg = wheelGeometry(), wnm = normalMatFor({});
    this.wheels = [];
    for (let i = 0; i < 6; i++) {
      // Use the factory: Material.clone() does not preserve the toon shader hooks.
      const wheelMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'wheel' });
      const m = new THREE.Mesh(wg, wheelMat);
      m.userData.nm = wnm; m.castShadow = true; m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.wheels.push({ m, mat: wheelMat, visual: null, elem: 0, ev: null, ph: 0, x: 0, z: 0, y: 0, back: null, fall: 0, spin: 0, trail: 0, owner: 0, hand: false });
    }
  }

  // Lay a polar disk on the ground.
  lay(d, x, z, r, lift = 0.06) {
    const pos = d.geo.attributes.position.array, polar = d.geo.attributes.aPolar.array, map = this.map;
    for (let k = 0; k < polar.length / 2; k++) {
      const rr = polar[k * 2] * r, a = polar[k * 2 + 1] * Math.PI * 2;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      pos[k * 3] = px; pos[k * 3 + 1] = map.groundAt(px, pz) + lift; pos[k * 3 + 2] = pz;
    }
    d.geo.attributes.position.needsUpdate = true;
  }

  // ---- Tromba ----------------------------------------------------------------------------------------------
  // A column lands at (x, z) of radius r. twin: the Gemelas' second (a little thinner).
  spout(x, z, r, twin = false, elem = 0) {
    const visual = elementVisual(elem);
    const s = this.spouts.find((q) => q.t < 0) || this.spouts.reduce((a, b) => (a.t > b.t ? a : b));
    Object.assign(s, { t: 0, r: r * (twin ? 0.46 : 0.55), h: 4.2 + r * 0.4, x, z, drops: 0, visual });
    s.m.position.set(x, this.map.groundAt(x, z) - 0.05, z);
    s.m.visible = true;
    s.mat.uniforms.uDeep.value.set(visual ? visual.deep : DEEP);
    s.mat.uniforms.uFoam.value.set(visual ? visual.bright : FOAM);
    const E = this.effects, y = this.map.groundAt(x, z);
    // The foot: foam ring, splash ring, droplets thrown out, a burst of spray.
    this.combatFx.ring(x, y + 0.1, z, r * 1.1, visual ? visual.accent : 0xbff6ff, 0.45, 0.18, 0.9);
    this.combatFx.ring(x, y + 0.12, z, r * 0.55, visual ? visual.bright : 0xffffff, 0.3, 0.1, 0.8);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s2 = 2 + Math.random() * 4.5;
      E.alpha.spawn(x + Math.cos(a) * r * 0.5, y + 0.3, z + Math.sin(a) * r * 0.5, Math.cos(a) * s2, 3 + Math.random() * 4, Math.sin(a) * s2,
        { life: 0.55 + Math.random() * 0.3, size: 0.16, size1: 0.07, color: visual ? visual.c0 : [0.9, 1, 1], alpha: 0.95, gravity: 14, drag: 0.6 });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      E.alpha.spawn(x + Math.cos(a) * r * 0.7, y + 0.25, z + Math.sin(a) * r * 0.7, Math.cos(a) * 1.4, 0.8 + Math.random(), Math.sin(a) * 1.4,
        { life: 0.8 + Math.random() * 0.3, size: 0.5, size1: 1.4, color: visual ? visual.c1 : [0.85, 0.95, 1], alpha: 0.45, gravity: -0.2, drag: 2.5 });
    }
  }

  // «Ojo de tormenta»: the whirlpool at (x, z) until vortexEnd (or `life` s).
  vortex(id, x, z, r, life, elem = 0) {
    const visual = elementVisual(elem);
    const v = this.vortices.find((q) => !q.live) || this.vortices[0];
    Object.assign(v, { live: true, id, x, z, r, t: 0, life, end: -1, visual });
    this.lay(v, x, z, r);
    v.mat.uniforms.uFade.value = 0;
    v.mat.uniforms.uDeep.value.set(visual ? visual.deep : DEEP);
    v.mat.uniforms.uFoam.value.set(visual ? visual.bright : FOAM);
    v.m.visible = true;
  }
  vortexEnd(id) { for (const v of this.vortices) if (v.live && v.id === id && v.end < 0) v.end = 0; }

  // ---- Abordaje --------------------------------------------------------------------------------------------
  // The jump: a shadow growing on the landing point over the air time, afterimages of the view while it flies.
  leap(e, x1, z1, r, air, color) {
    const s = this.shadows.find((q) => !q.live) || this.shadows[0];
    Object.assign(s, { live: true, e, t: 0, air, color, after: 0 });
    this.lay(s, x1, z1, r * 0.9, 0.05);
    s.mat.uniforms.uGrow.value = 0.05; s.mat.uniforms.uFade.value = 1;
    s.mat.uniforms.uFoam.value.set(color);
    s.m.visible = true;
  }

  // The landing: shock ring of radius r, dust thrown out, chips; big: «Ancla de abordaje».
  slam(x, z, r, color, big = false, elem = 0) {
    const visual = elementVisual(elem);
    const E = this.effects, y = this.map.groundAt(x, z);
    for (const s of this.shadows) if (s.live && Math.abs(s.t - s.air) < 0.3) s.t = Math.max(s.t, s.air);
    this.combatFx.ring(x, y + 0.1, z, r, visual ? visual.accent : color, 0.4, 0.2, 1);
    this.combatFx.ring(x, y + 0.08, z, r * 0.55, visual ? visual.bright : 0xfff1d0, 0.25, 0.12, 0.9);
    this.combatFx.shockwave(x, y + 0.2, z, visual ? visual.accent : (big ? 0xffb35a : color));
    const n = big ? 30 : 20;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * (big ? 6 : 4);
      E.alpha.spawn(x + Math.cos(a) * 0.4, y + 0.15, z + Math.sin(a) * 0.4, Math.cos(a) * s, 0.6 + Math.random() * 1.2, Math.sin(a) * s,
        { life: 0.55 + Math.random() * 0.35, size: 0.35, size1: big ? 1.3 : 0.95, color: big ? [0.55, 0.48, 0.44] : [0.86, 0.78, 0.62], alpha: 0.7, gravity: 0.8, drag: 4.5 });
    }
    for (let i = 0; i < (big ? 18 : 10); i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
      E.streaks.spawn(x, y + 0.2, z, Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s,
        { life: 0.4 + Math.random() * 0.3, width: 0.1, stretch: 0.05, color: visual ? visual.c0 : [0.72, 0.6, 0.46], color1: visual ? visual.c1 : [0.35, 0.26, 0.2], gravity: 16, drag: 0.6 });
    }
  }

  // ---- Timón -----------------------------------------------------------------------------------------------
  // The throw (the wheel event): ev {e, id, x, z, dx, dz, v0, R, r, hang, tick, form}.
  wheel(ev) {
    for (const w of this.wheels) if (w.ev && w.owner === ev.e && !w.hand) this.endWheel(w, false); // one per pirate
    const w = this.wheels.find((q) => q.hand && q.owner === ev.e) || this.wheels.find((q) => !q.ev && !q.hand) || this.wheels[0];
    Object.assign(w, { ev, ph: 1, back: null, fall: 0, trail: 0, owner: ev.e, hand: false, x: ev.x, z: ev.z });
    this.setWheelElement(w, ev.elem || 0);
    w.m.scale.setScalar(Math.max(0.5, ev.r * 1.15));
    w.m.visible = true;
  }
  wheelBack(ev) {
    const w = this.wheels.find((q) => q.ev && q.ev.id === ev.id && q.owner === ev.e);
    if (w) { w.ph = 3; w.back = ev; w.x = ev.x; w.z = ev.z; }
  }
  wheelEnd(ev, caught) {
    const w = this.wheels.find((q) => q.ev && q.ev.id === ev.id && q.owner === ev.e);
    if (w) this.endWheel(w, !caught);
    if (caught) {
      const y = this.map.groundAt(ev.x, ev.z) + 1.0;
      const visual = elementVisual(ev.elem);
      this.combatFx.ring(ev.x, y, ev.z, 0.9, visual ? visual.accent : 0xffe08a, 0.25, 0.12, 1);
      this.effects.sparks(ev.x, y, ev.z, 10, { color: visual ? visual.c0 : [1, 0.95, 0.7], color1: visual ? visual.c1 : [1, 0.7, 0.2], up: 2, spread: 2.4, life: 0.3 });
    }
  }
  endWheel(w, drop) {
    if (drop) { w.ph = 4; w.fall = 0; return; } // falls flat and fades
    w.ev = null; w.ph = 0; w.m.visible = false;
  }

  // While charging: the wheel rides at the right shoulder of view v, spinning slowly (k: the charge, 0..1).
  charging(e, k, elem = 0) {
    let w = this.wheels.find((q) => q.hand && q.owner === e);
    if (!w) {
      w = this.wheels.find((q) => !q.ev && !q.hand);
      if (!w) return;
      Object.assign(w, { hand: true, owner: e, ph: 0, ev: null });
    }
    this.setWheelElement(w, elem);
    w.k = k; w.seen = this.time;
  }

  // Each wheel owns its material so one pirate's element cannot tint another pirate's wheel.
  setWheelElement(w, elem) {
    if (w.elem === elem) return;
    w.elem = elem;
    w.visual = elementVisual(elem);
    const c = w.visual ? w.visual.c0 : null;
    w.mat.color.setRGB(c ? 0.82 + c[0] * 0.18 : 1, c ? 0.82 + c[1] * 0.18 : 1, c ? 0.82 + c[2] * 0.18 : 1);
  }

  // The wheel's distance along its throw at tick T (out phase): s(t) = v0·t − v0²·t² / (4R), stopping at R.
  static out(ev, T) {
    const t = Math.min(Math.max(0, T - ev.tick) * DT, (2 * ev.R) / ev.v0);
    return Math.min(ev.R, ev.v0 * t - (ev.v0 * ev.v0 * t * t) / (4 * ev.R));
  }

  // ---- per frame ---------------------------------------------------------------------------------------------
  // freeze (debug, the look tool): effects hold where they are.
  update(dt, tick) {
    if (this.freeze) { dt = 0; tick = this.frozenTick ??= tick; } else this.frozenTick = undefined;
    this.time += dt;
    const E = this.effects, map = this.map;
    for (const s of this.spouts) {
      if (s.t < 0) continue;
      s.t += dt;
      const u = s.t / s.life, U = s.mat.uniforms;
      if (u >= 1) { s.t = -1; s.m.visible = false; continue; }
      // Slams down (0–15 %), spins full (to 55 %), then thins out and falls apart.
      const grow = u < 0.15 ? 1 - Math.pow(1 - u / 0.15, 3) : 1 - Math.max(0, (u - 0.7) / 0.3) * 0.35;
      U.uGrow.value = grow; U.uTime.value = this.time; U.uSpin.value = s.t * 9;
      U.uFlare.value = Math.max(0, (u - 0.5) / 0.5) * 0.6;
      U.uFade.value = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      s.m.scale.set(s.r, s.h, s.r);
      // Spray off the crown and the waist while it stands.
      s.drops += dt * 60;
      while (s.drops >= 1 && u < 0.7) {
        s.drops -= 1;
        const a = Math.random() * Math.PI * 2, hy = Math.random() * s.h * grow, y = map.groundAt(s.x, s.z) + hy;
        const rr = s.r * (hy / s.h > 0.6 ? 1.4 : 0.6), sp = 1.5 + Math.random() * 2.5;
        E.alpha.spawn(s.x + Math.cos(a) * rr, y, s.z + Math.sin(a) * rr, Math.cos(a + 1.2) * sp, 0.5 + Math.random() * 2, Math.sin(a + 1.2) * sp,
          { life: 0.4 + Math.random() * 0.3, size: 0.12, size1: 0.05, color: s.visual ? s.visual.c0 : [0.92, 1, 1], alpha: 0.9, gravity: 12, drag: 0.8 });
      }
    }
    for (const v of this.vortices) {
      if (!v.live) continue;
      v.t += dt;
      const U = v.mat.uniforms;
      U.uTime.value = this.time;
      if (v.end >= 0) v.end += dt;
      const fade = Math.min(1, v.t / 0.25) * (v.end >= 0 ? Math.max(0, 1 - v.end / 0.35) : 1) * (v.t > v.life + 0.4 ? 0 : 1);
      U.uFade.value = fade;
      if (fade <= 0 && (v.end >= 0 || v.t > v.life)) { v.live = false; v.m.visible = false; continue; }
      // Foam flecks spiralling in.
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2, rr = v.r * (0.6 + Math.random() * 0.4), x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
        E.alpha.spawn(x, map.groundAt(x, z) + 0.12, z, (-Math.cos(a) - Math.sin(a) * 1.6) * 1.8, 0.1, (-Math.sin(a) + Math.cos(a) * 1.6) * 1.8,
          { life: 0.5, size: 0.2, size1: 0.1, color: v.visual ? v.visual.c0 : [0.9, 1, 1], alpha: 0.8, gravity: 0, drag: 1 });
      }
    }
    for (const s of this.shadows) {
      if (!s.live) continue;
      s.t += dt;
      const U = s.mat.uniforms, u = Math.min(1, s.t / s.air);
      U.uGrow.value = 0.25 + 0.75 * u;
      U.uFade.value = s.t < s.air ? 1 : Math.max(0, 1 - (s.t - s.air) / 0.25);
      // Afterimages while the body is in the air.
      const view = this.viewOf(s.e);
      s.after -= dt;
      if (view && s.t < s.air && s.after <= 0) { s.after = 0.05; this.after.capture(view, s.color, 0.22, 0.45); }
      if (s.t > s.air + 0.3) { s.live = false; s.m.visible = false; }
    }
    for (const w of this.wheels) this.stepWheel(w, dt, tick);
  }

  stepWheel(w, dt, tick) {
    const map = this.map, E = this.effects;
    if (w.hand) {
      // At the shoulder while charging; gone when the charge stops being reported.
      const view = this.viewOf(w.owner);
      if (!view || this.time - w.seen > 0.12) { w.hand = false; if (!w.ev) w.m.visible = false; return; }
      const p = view.root.position, f = view.root.rotation.y, fx = Math.sin(f), fz = Math.cos(f);
      w.m.position.set(p.x - fz * 0.5 - fx * 0.35, p.y + 1.55, p.z + fx * 0.5 - fz * 0.35);
      w.m.rotation.set(0.9, f + Math.PI / 2, 0);
      w.spin += dt * (2 + 10 * w.k);
      w.m.rotateY(w.spin);
      w.m.scale.setScalar(0.42 + 0.12 * w.k);
      w.m.visible = true;
      return;
    }
    const ev = w.ev;
    if (!ev) return;
    const W = SKILLS.wheel;
    let x = w.x, z = w.z;
    if (w.ph === 1) {
      const s = SkillFx.out(ev, tick);
      x = ev.x + ev.dx * s; z = ev.z + ev.dz * s;
      // Past the apex (+ its hang): wait for wheelBack where it is; if it never comes, home anyway.
      if (tick - ev.tick > (2 * ev.R) / ev.v0 / DT + (ev.hang || 0) / DT + 12) { w.ph = 3; w.back = { tick }; }
    } else if (w.ph === 3) {
      const view = this.viewOf(w.owner);
      const bt = w.back ? w.back.tick : tick;
      const vRet = W.ret * Math.max(ev.v0, 14), v = vRet * Math.min(1, Math.max(0, tick - bt) * DT / W.retRamp);
      if (view) {
        const p = view.root.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz), m = Math.min(d, v * dt);
        if (d > 1e-4) { x += (dx / d) * m; z += (dz / d) * m; }
        if (d < 0.4) { this.endWheel(w, false); return; }
      }
      if (tick - ev.tick > W.life / DT + 30) { this.endWheel(w, true); }
    } else if (w.ph === 4) {
      // Dropped: it falls flat to the ground and fades.
      w.fall += dt;
      w.m.position.y = Math.max(map.groundAt(x, z) + 0.08, w.m.position.y - dt * 6);
      w.m.rotation.x = Math.min(0.12, w.m.rotation.x + dt);
      if (w.fall > 0.8) { w.ev = null; w.ph = 0; w.m.visible = false; }
      return;
    }
    w.x = x; w.z = z;
    const y = map.groundAt(x, z) + 1.0;
    w.m.position.set(x, y, z);
    w.spin -= dt * 18;
    w.m.rotation.set(0, w.spin, 0);
    // A trail off the rim.
    w.trail += dt;
    if (w.trail > 0.016) {
      w.trail = 0;
      const R = w.m.scale.x * 1.2;
      for (const k of [0, Math.PI]) {
        const a = w.spin + k, px = x + Math.cos(a) * R, pz = z - Math.sin(a) * R;
        E.streaks.spawn(px, y, pz, 0, 0, 0, { life: 0.16, width: 0.07, stretch: 0.2, color: w.visual ? w.visual.c0 : [1, 0.92, 0.7], color1: w.visual ? w.visual.c1 : [0.95, 0.6, 0.25], drag: 4 });
      }
    }
  }
}

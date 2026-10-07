import * as THREE from 'three';
import { CURRENT_LANES, currentAt } from '../../src/sim/naval/navigation.js';
import { navalPose } from '../../src/sim/naval/handling.js';
import { ParticlePool } from '../../src/render/vfx/particles.js';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../../src/render/pipeline.js';
import { U } from '../../src/render/toon.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const FOAM_CELL_SIZE = 4;
const FOAM_CELL_RADIUS = Object.freeze({ mobile: 6, desktop: 9 });
const FOAM_FLECK_CAP = Object.freeze({ mobile: 338, desktop: 722 });
const FOAM_VERTICES_PER_FLECK = 6;
const WAKE_SECONDS = 4;
const WAKE_CAPACITY = Object.freeze({ mobile: 24, desktop: 40 });

// Surface coordinates use distance along the actual path and -1..1 across it. Break the
// silhouette with the existing shared noise, instead of another alpha texture or decal stack.
const FLOW_PARS = 'attribute vec2 aFlow; varying vec2 vNavFlow;';
const FLOW_CURRENT = /* glsl */ `
  float travel = vNavFlow.x - uNavTime * 2.6;
  float across = vNavFlow.y;
  vec4 n = texture2D(mnNoiseTex, vec2(travel * 0.08, across * 0.37));
  float edge = 1.0 - smoothstep(0.66, 1.0, abs(across + (n.b - 0.5) * 0.25));
  float weave = sin(across * 15.0 + (n.b - 0.5) * 7.0 + sin(travel * 0.42));
  float streak = smoothstep(0.0, 0.8, weave) * (0.15 + smoothstep(0.36, 0.62, n.b) * 0.85);
  float froth = smoothstep(0.56, 0.71, n.b) * (1.0 - smoothstep(0.25, 0.6, n.r));
  outgoingLight = mix(outgoingLight, vec3(0.9, 1.0, 1.0), froth * 0.8);
  diffuseColor.a *= edge * (0.1 + streak * 0.65 + froth * 0.3);
`;
const FLOW_WAKE = /* glsl */ `
  float across = vNavFlow.y;
  vec4 n = texture2D(mnNoiseTex, vec2(vNavFlow.x * 0.18, across * 0.58));
  float edge = 1.0 - smoothstep(0.64, 1.0, abs(across + (n.b - 0.5) * 0.26));
  float froth = smoothstep(0.38, 0.6, n.b);
  float bubbles = (1.0 - smoothstep(0.12, 0.5, n.r)) * 0.7;
  diffuseColor.a *= edge * (0.15 + max(bubbles, froth) * 0.85);
`;

function depthAware(material, flow = '', clock = null) {
  // The outlined FX target has no hardware depth. Reuse the game's opaque-depth test so
  // surface accents remain behind the hull and sail in both rendering quality modes.
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FXU);
    if (flow) {
      shader.uniforms.uNavTime = clock;
      shader.uniforms.mnNoiseTex = U.mnNoiseTex;
      shader.vertexShader = FLOW_PARS + '\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvNavFlow = aFlow;');
      shader.fragmentShader = 'varying vec2 vNavFlow; uniform float uNavTime; uniform sampler2D mnNoiseTex;\n' + shader.fragmentShader;
    }
    shader.fragmentShader = GLSL_FX_DEPTH + shader.fragmentShader.replace(
      '#include <opaque_fragment>', flow + '\ndiffuseColor.a *= fxDepthFade(0.06);\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'naval-lab-surface-depth-v2:' + (flow === FLOW_CURRENT ? 'current' : flow ? 'wake' : 'plain');
  return material;
}

function hashCell(x, z, salt = 0) {
  let h = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(z | 0, 0x119de1f3) ^ Math.imul(salt + 1, 0x3449);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeFoamField(mobile) {
  const radius = FOAM_CELL_RADIUS[mobile ? 'mobile' : 'desktop'];
  const side = radius * 2 + 1;
  const capacity = side * side * 2;
  const positions = new Float32Array(capacity * FOAM_VERTICES_PER_FLECK * 3);
  const colors = new Float32Array(capacity * FOAM_VERTICES_PER_FLECK * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.92,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  mesh.name = 'naval-lab-world-foam-references';
  mesh.layers.set(LAYER.FX);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, positions, colors, radius, capacity, originX: null, originZ: null, recycleCount: 0, fleckCount: 0 };
}

function writeFoamField(field, worldX, worldZ) {
  const centerX = Math.floor(worldX / FOAM_CELL_SIZE), centerZ = Math.floor(worldZ / FOAM_CELL_SIZE);
  const originX = centerX - field.radius, originZ = centerZ - field.radius;
  if (field.originX === originX && field.originZ === originZ) return false;
  const recycled = field.originX !== null;
  field.originX = originX; field.originZ = originZ;
  let vertexAt = 0, colorAt = 0, fleckCount = 0;
  for (let cz = originZ; cz < originZ + field.radius * 2 + 1; cz++) {
    for (let cx = originX; cx < originX + field.radius * 2 + 1; cx++) {
      const count = hashCell(cx, cz, 0) < 0.48 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const j = i + 1;
        const px = (cx + 0.12 + hashCell(cx, cz, j * 3) * 0.76) * FOAM_CELL_SIZE;
        const pz = (cz + 0.12 + hashCell(cx, cz, j * 5) * 0.76) * FOAM_CELL_SIZE;
        const angle = hashCell(cx, cz, j * 7) * Math.PI * 2;
        const length = 0.24 + hashCell(cx, cz, j * 11) * 0.54;
        const width = 0.035 + hashCell(cx, cz, j * 13) * 0.065;
        const fx = Math.cos(angle), fz = Math.sin(angle), rx = -fz, rz = fx;
        const ax = px - fx * length * 0.5, az = pz - fz * length * 0.5;
        const bx = px + fx * length * 0.5, bz = pz + fz * length * 0.5;
        const points = [
          [ax - rx * width * 0.38, az - rz * width * 0.38],
          [bx, bz],
          [ax + rx * width * 0.38, az + rz * width * 0.38],
          [ax + rx * width * 0.38, az + rz * width * 0.38],
          [bx, bz],
          [bx - rx * width, bz - rz * width],
        ];
        const shade = 0.82 + hashCell(cx, cz, j * 17) * 0.18;
        const alpha = 0.38 + hashCell(cx, cz, j * 19) * 0.24;
        for (let k = 0; k < points.length; k++) {
          const [x, z] = points[k];
          field.positions[vertexAt++] = x; field.positions[vertexAt++] = 0.065; field.positions[vertexAt++] = z;
          const tipFade = k === 1 || k === 4 ? 0.56 : 1;
          field.colors[colorAt++] = 0.72 * shade; field.colors[colorAt++] = 0.94 * shade;
          field.colors[colorAt++] = 1; field.colors[colorAt++] = alpha * tipFade;
        }
        fleckCount++;
      }
    }
  }
  field.fleckCount = fleckCount;
  field.recycleCount += recycled ? 1 : 0;
  field.mesh.geometry.setDrawRange(0, vertexAt / 3);
  field.mesh.geometry.attributes.position.needsUpdate = true;
  field.mesh.geometry.attributes.color.needsUpdate = true;
  field.mesh.geometry.computeBoundingSphere();
  return true;
}

const lanePoint = (lane, t, side = 0) => {
  const a = clamp(t, 0, 1), yaw = Number(lane.yaw) || 0;
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  const curve = (Number(lane.bend) || 0) * Math.sin(Math.PI * a);
  const distance = a * (Number(lane.length) || 0);
  const x = (Number(lane.x) || 0) + forwardX * distance + rightX * curve + rightX * side;
  const z = (Number(lane.z) || 0) + forwardZ * distance + rightZ * curve + rightZ * side;
  return [x, 0.055, z];
};

function makeCurrentBand(lanes) {
  const vertices = lanes.reduce((n, lane) => n + Math.max(2, Math.ceil(lane.length / 4)) * 6, 0);
  const positions = new Float32Array(vertices * 3);
  const flow = new Float32Array(vertices * 2);
  const colors = new Float32Array(vertices * 4);
  let offset = 0;
  for (const lane of lanes) {
    const steps = Math.max(2, Math.ceil(lane.length / 4));
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps, half = Math.max(0.5, Number(lane.halfWidth) || 1);
      const a = lanePoint(lane, t0, -half), b = lanePoint(lane, t0, half);
      const c = lanePoint(lane, t1, -half), d = lanePoint(lane, t1, half);
      const coords = [[t0, -1], [t1, -1], [t0, 1], [t0, 1], [t1, -1], [t1, 1]];
      for (const [k, p] of [a, c, b, b, c, d].entries()) {
        const vertex = offset / 3;
        flow[vertex * 2] = coords[k][0] * lane.length;
        flow[vertex * 2 + 1] = coords[k][1];
        const t = coords[k][0];
        colors[vertex * 4] = colors[vertex * 4 + 1] = colors[vertex * 4 + 2] = 1;
        colors[vertex * 4 + 3] = Math.min(1, t * 12, (1 - t) * 12);
        positions[offset++] = p[0]; positions[offset++] = p[1]; positions[offset++] = p[2];
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geometry;
}

function makeChevrons(lanes, countPerLane) {
  const positions = new Float32Array(lanes.length * countPerLane * 4 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return { geometry, positions, countPerLane };
}

function laneDirection(lane, t) {
  const yaw = Number(lane.yaw) || 0, along = Math.PI * clamp(t, 0, 1);
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const dx = fx * (Number(lane.length) || 1) + rx * (Number(lane.bend) || 0) * Math.PI * Math.cos(along);
  const dz = fz * (Number(lane.length) || 1) + rz * (Number(lane.bend) || 0) * Math.PI * Math.cos(along);
  const n = Math.max(0.001, Math.hypot(dx, dz));
  return [dx / n, dz / n];
}

function writeChevrons(target, lanes, time, reducedMotion) {
  const { positions, countPerLane } = target;
  let at = 0;
  for (const lane of lanes) {
    const yaw = Number(lane.yaw) || 0;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), length = Math.max(1, Number(lane.length) || 1);
    for (let i = 0; i < countPerLane; i++) {
      const phase = reducedMotion ? (i + 0.5) / countPerLane : ((time * 0.16 + i / countPerLane) % 1);
      const p = lanePoint(lane, phase, 0);
      const [fx, fz] = laneDirection(lane, phase);
      const wing = Math.min(0.9, Math.max(0.45, (Number(lane.halfWidth) || 1) * 0.18));
      const back = Math.min(1.2, length / 30);
      const tip = [p[0] + fx * back, p[1] + 0.008, p[2] + fz * back];
      const left = [p[0] - fx * back * 0.65 - rx * wing, p[1] + 0.008, p[2] - fz * back * 0.65 - rz * wing];
      const right = [p[0] - fx * back * 0.65 + rx * wing, p[1] + 0.008, p[2] - fz * back * 0.65 + rz * wing];
      for (const pair of [[left, tip], [tip, right]]) for (const v of pair) {
        positions[at++] = v[0]; positions[at++] = v[1]; positions[at++] = v[2];
      }
    }
  }
  target.geometry.attributes.position.needsUpdate = true;
}

function makeRibbon(side, capacity, clock) {
  const positions = new Float32Array((capacity - 1) * 6 * 3);
  const colors = new Float32Array((capacity - 1) * 6 * 4);
  const flow = new Float32Array((capacity - 1) * 6 * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, depthAware(new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.94,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }), FLOW_WAKE, clock));
  mesh.name = `naval-lab-wake-ribbon-${side}`;
  mesh.layers.set(LAYER.FX);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return { mesh, positions, colors, flow, history: [], side, capacity, distance: 0 };
}

function appendRibbon(ribbon, point) {
  const previous = ribbon.history[0];
  if (previous) {
    const distance = Math.hypot(point[0] - previous[0], point[2] - previous[2]);
    if (distance < 0.06) return false;
    // A laboratory reset/teleport never draws a stripe across the whole sea.
    if (distance > Math.max(8, point[7] * 2)) ribbon.history.length = 0;
    else ribbon.distance += distance;
  }
  point[8] = ribbon.distance;
  ribbon.history.unshift(point);
  if (ribbon.history.length > ribbon.capacity) ribbon.history.pop();
  return true;
}

function updateRibbon(ribbon, time) {
  while (ribbon.history.length && time - ribbon.history.at(-1)[3] >= WAKE_SECONDS) ribbon.history.pop();
  let out = 0;
  const sign = ribbon.side ? 1 : -1;
  const section = (p) => {
    const age = Math.max(0, time - p[3]), speed = p[6], beam = p[7];
    const spread = age * (0.18 + speed * 0.28);
    const width = beam * (0.055 + speed * 0.14) * (1 + age * 0.14);
    const x = p[0] + p[4] * sign * spread, z = p[2] + p[5] * sign * spread;
    const fade = Math.pow(Math.max(0, 1 - age / WAKE_SECONDS), 1.15);
    return { left: [x - p[4] * width, p[1], z - p[5] * width],
      right: [x + p[4] * width, p[1], z + p[5] * width], fade, along: p[8] };
  };
  for (let i = 0; i < ribbon.history.length - 1; i++) {
    const a = section(ribbon.history[i]), b = section(ribbon.history[i + 1]);
    for (const [v, q, across] of [[a.left, a, -1], [b.left, b, -1], [a.right, a, 1],
      [a.right, a, 1], [b.left, b, -1], [b.right, b, 1]]) {
      const vertex = out / 3;
      ribbon.positions[out++] = v[0]; ribbon.positions[out++] = v[1]; ribbon.positions[out++] = v[2];
      ribbon.colors[vertex * 4] = 0.88; ribbon.colors[vertex * 4 + 1] = 0.99;
      ribbon.colors[vertex * 4 + 2] = 1; ribbon.colors[vertex * 4 + 3] = q.fade;
      ribbon.flow[vertex * 2] = q.along; ribbon.flow[vertex * 2 + 1] = across;
    }
  }
  ribbon.mesh.geometry.setDrawRange(0, out / 3);
  ribbon.mesh.geometry.attributes.position.needsUpdate = true;
  ribbon.mesh.geometry.attributes.color.needsUpdate = true;
  ribbon.mesh.geometry.attributes.aFlow.needsUpdate = true;
}

function makeSpraySheet(side, segments) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 12 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segments * 12 * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.Mesh(geometry, depthAware(new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.88,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  })));
  mesh.name = `naval-lab-bow-spray-${side}`;
  mesh.layers.set(LAYER.FX); mesh.renderOrder = 6; mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, side, segments };
}

function updateSpraySheet(sheet, x, z, yaw, length, beam, speedFactor, turn, boost, time) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const sign = sheet.side ? 1 : -1;
  const loading = clamp(1 + turn * sign * 0.28, 0.65, 1.35);
  const strength = speedFactor * loading * (boost ? 1.2 : 1);
  const positions = sheet.mesh.geometry.attributes.position.array;
  const colors = sheet.mesh.geometry.attributes.color.array;
  let vertex = 0;
  const point = (t, row) => {
    const crest = Math.pow(Math.sin(Math.PI * t), 0.7);
    const chop = 0.84 + Math.sin(t * 25 + time * 8 + sign) * 0.12;
    const along = length * (-0.12 + t * 0.64);
    const spread = beam * 0.49 + row * beam * 0.12 * crest * strength;
    const y = 0.08 + Math.sin(row * Math.PI / 3) * crest * chop * strength * 0.75;
    return [x + fx * along + rx * sign * spread, y, z + fz * along + rz * sign * spread,
      crest * (row === 2 ? 0 : row === 1 ? 0.92 : 0.65)];
  };
  for (let i = 0; i < sheet.segments; i++) {
    const t0 = i / sheet.segments, t1 = (i + 1) / sheet.segments;
    for (let row = 0; row < 2; row++) {
      const a = point(t0, row), b = point(t1, row), c = point(t0, row + 1), d = point(t1, row + 1);
      for (const p of [a, b, c, c, b, d]) {
        positions[vertex * 3] = p[0]; positions[vertex * 3 + 1] = p[1]; positions[vertex * 3 + 2] = p[2];
        colors[vertex * 4] = 0.9; colors[vertex * 4 + 1] = 0.99; colors[vertex * 4 + 2] = 1;
        colors[vertex * 4 + 3] = p[3]; vertex++;
      }
    }
  }
  sheet.mesh.geometry.attributes.position.needsUpdate = true;
  sheet.mesh.geometry.attributes.color.needsUpdate = true;
  sheet.mesh.visible = true;
}

function hullCenter(state, rig) {
  const pose = navalPose(state, rig), c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  return { x: pose.x + c * (Number(rig.hullCx) || 0) + s * (Number(rig.hullCz) || 0),
    z: pose.z - s * (Number(rig.hullCx) || 0) + c * (Number(rig.hullCz) || 0) };
}

/** Visual-only feedback for the isolated naval lab; no particle state feeds the boat simulation. */
export class NavalLabEffects {
  constructor(scene, { mobile = false, reducedMotion = false } = {}) {
    if (!scene?.add) throw new TypeError('NavalLabEffects requires a Three.js scene');
    this.scene = scene;
    this.mobile = !!mobile;
    this.reducedMotion = !!reducedMotion;
    this.disposed = false;
    this.time = 0;
    this.flowClock = { value: 0 };
    this.wakeCapacity = WAKE_CAPACITY[this.mobile ? 'mobile' : 'desktop'];
    this.wakeClock = 0;
    this.breezeClock = 0;
    this.wakeCount = 0;
    this.burstCount = 0;
    this.impactCount = 0;
    this.lastCurrent = null;
    this.currentVisible = false;
    this.gustVisible = false;
    this.trails = [];
    this.spraySheets = [0, 1].map((side) => makeSpraySheet(side, this.mobile ? 6 : 9));
    for (const sheet of this.spraySheets) scene.add(sheet.mesh);
    this.pool = new ParticlePool(this.mobile ? 144 : 288, { name: 'naval-lab-spray' });
    this.pool.budget = this.mobile ? 0.75 : 1;
    this.pool.mat.uniforms.uLit.value = 0; // White foam against the dark sea; no island lighting tint.
    this.setViewport(globalThis.innerHeight || 720, 35);
    scene.add(this.pool.points);
    this.foam = makeFoamField(this.mobile);
    scene.add(this.foam.mesh);

    this.currentBand = new THREE.Mesh(makeCurrentBand(CURRENT_LANES), depthAware(new THREE.MeshBasicMaterial({
      color: 0x6eebed, vertexColors: true, transparent: true, opacity: this.mobile ? 0.58 : 0.66,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }), FLOW_CURRENT, this.flowClock));
    this.currentBand.name = 'naval-lab-current-band';
    this.currentBand.layers.set(LAYER.FX);
    this.currentBand.visible = false;
    this.currentBand.renderOrder = 3;
    scene.add(this.currentBand);
    const chevronCount = this.mobile ? 3 : 6;
    this.chevrons = makeChevrons(CURRENT_LANES, chevronCount);
    this.chevrons.mesh = new THREE.LineSegments(this.chevrons.geometry, new THREE.LineBasicMaterial({
      color: 0xbafcff, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false,
    }));
    this.chevrons.mesh.name = 'naval-lab-current-chevrons';
    this.chevrons.mesh.layers.set(LAYER.FX);
    this.chevrons.mesh.visible = false;
    this.chevrons.mesh.renderOrder = 4;
    scene.add(this.chevrons.mesh);
    writeChevrons(this.chevrons, CURRENT_LANES, 0, this.reducedMotion);

    for (let side = 0; side < 2; side++) {
      const ribbon = makeRibbon(side, this.wakeCapacity, this.flowClock);
      scene.add(ribbon.mesh);
      this.trails.push(ribbon);
    }
    for (const mesh of [this.foam.mesh, this.chevrons.mesh]) depthAware(mesh.material);
    this.reset();
  }

  reset() {
    this.time = 0; this.wakeClock = 0; this.breezeClock = 0;
    this.flowClock.value = 0;
    this.wakeCount = 0; this.burstCount = 0; this.impactCount = 0; this.lastCurrent = null;
    this.currentVisible = false; this.gustVisible = false;
    if (this.foam) {
      this.foam.originX = null; this.foam.originZ = null; this.foam.recycleCount = 0; this.foam.fleckCount = 0;
      this.foam.mesh.geometry.setDrawRange(0, 0);
      this.foam.mesh.geometry.attributes.position.needsUpdate = true;
    }
    if (this.currentBand) this.currentBand.visible = false;
    if (this.chevrons?.mesh) this.chevrons.mesh.visible = false;
    for (const trail of this.trails) {
      trail.history.length = 0; trail.distance = 0; trail.positions.fill(0); trail.colors.fill(0); trail.flow.fill(0);
      trail.mesh.geometry.setDrawRange(0, 0);
      trail.mesh.geometry.attributes.position.needsUpdate = true;
    }
    for (const sheet of this.spraySheets) sheet.mesh.visible = false;
    if (this.pool) {
      this.pool.alive.fill(0); this.pool.data.fill(0); this.pool.update(0);
    }
  }

  setViewport(heightPx, fovDeg) { this.pool.setViewport(heightPx, fovDeg); }

  event(kind, state, rig, location = null) {
    if (this.disposed) return false;
    const label = String(kind || '').toLowerCase().replace(/[^a-z]/g, '');
    let strength = 0, count = 0;
    const impact = label.includes('impact') || label.includes('destroy');
    if (impact) { strength = 0.95; count = this.mobile ? (this.reducedMotion ? 5 : 14) : (this.reducedMotion ? 8 : 26); }
    else if (label.includes('perfect')) { strength = 1; count = this.mobile ? (this.reducedMotion ? 6 : 18) : (this.reducedMotion ? 10 : 32); }
    else if (label.includes('captur') || label.includes('success')) { strength = 0.8; count = this.mobile ? (this.reducedMotion ? 5 : 11) : 20; }
    else if (label.includes('miss') || label.includes('early') || label.includes('angle')) { strength = 0.3; count = this.mobile ? 4 : 7; }
    else if (label.includes('approach') || label.includes('warning')) { this.gustVisible = true; return true; }
    else return false;
    const pose = location && Number.isFinite(location.x) && Number.isFinite(location.z) ? location :
      state && rig ? hullCenter(state, rig) : state;
    const yaw = Number(state?.yaw) || 0;
    const x = Number(pose?.x) || 0, z = Number(pose?.z) || 0;
    const speed = Math.hypot(Number(state?.vx) || 0, Number(state?.vz) || 0);
    const length = clamp(Number(rig?.length) || 4, 2, 24);
    const beam = clamp(Number(rig?.beam) || 2, 1, 16);
    this.spray(x, z, count, strength, yaw, speed, length, beam);
    if (impact) this.impactCount++; else this.burstCount++;
    this.gustVisible = false;
    return true;
  }

  spray(x, z, count, strength, yaw, speed, length = 4, beam = 2) {
    const n = Math.min(this.mobile ? 18 : 36, Math.max(0, count | 0));
    const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw);
    for (let i = 0; i < n; i++) {
      const bow = i % 2 === 0, longitudinal = bow ? length * 0.44 : -length * 0.48;
      const lateral = ((i % 5) / 4 - 0.5) * beam * 0.72;
      const px = x + Math.sin(yaw) * longitudinal + sideX * lateral;
      const pz = z + Math.cos(yaw) * longitudinal + sideZ * lateral;
      const outward = i % 4 < 2 ? -1 : 1;
      const s = 0.3 + strength * 0.42 + (i % 3) * 0.09 + Math.min(0.6, speed * 0.1);
      this.pool.spawn(px, 0.075, pz,
        -Math.sin(yaw) * (0.22 + strength * 0.2) + sideX * outward * s,
        0.5 + strength * 1.45 + (i % 3) * 0.13,
        -Math.cos(yaw) * (0.22 + strength * 0.2) + sideZ * outward * s, {
          life: 0.4 + strength * 0.19, size: 0.17 + strength * 0.09,
          size1: 0.025, color: [0.63 + strength * 0.22, 0.94, 0.99], alpha: 0.9,
          gravity: 5.4, drag: 2.2,
        });
    }
    if (speed > 0.45) this.pushWake(x, z, yaw, Math.min(1, speed / 4), length, beam);
  }

  pushWake(x, z, yaw, speedFactor, length = 4, beam = 2) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const spread = Math.max(0.75, beam * 0.42);
    let emitted = false;
    for (const trail of this.trails) {
      const side = trail.side ? 1 : -1;
      const point = [x - fx * length * 0.48 + rx * spread * side, 0.08,
        z - fz * length * 0.48 + rz * spread * side, this.time, rx, rz, speedFactor, beam];
      emitted = appendRibbon(trail, point) || emitted;
    }
    if (emitted) this.wakeCount++;
  }

  update(dt, { state, rig, wind, gust, activity, current = null, currents = false, paused = false } = {}) {
    if (this.disposed) return;
    if (paused) return;
    const step = clamp(dt, 0, 0.05);
    this.time += step;
    this.flowClock.value = this.reducedMotion ? 0 : this.time;
    const active = state && rig;
    if (active) {
      writeFoamField(this.foam, Number(state.x) || 0, Number(state.z) || 0);
      this.lastCurrent = currents ? currentAt(Number(state.x) || 0, Number(state.z) || 0, true) : null;
      this.currentBand.visible = !!currents;
      this.chevrons.mesh.visible = !!currents;
      this.currentVisible = !!currents;
      if (currents && !this.reducedMotion) writeChevrons(this.chevrons, CURRENT_LANES, this.time, false);

      const phase = String(gust?.phase || '').toLowerCase();
      const progress = Number(gust?.progress);
      const approaching = ['approach', 'warning', 'ready', 'window'].includes(phase) ||
        (Number.isFinite(progress) && progress >= 0.72 && progress < 1 && phase !== 'active');
      this.gustVisible = approaching;
      const yaw = Number(state.yaw) || 0;
      const speed = Math.hypot(Number(state.vx) || 0, Number(state.vz) || 0);
      const pose = hullCenter(state, rig);
      const x = Number(pose.x) || 0, z = Number(pose.z) || 0;
      this.wakeClock += step;
      const boostActive = Number(state.tick) < Number(activity?.boostUntil);
      const emissionBoost = boostActive ? clamp(Number(activity?.multiplier) || 1, 1, 2.5) : 1;
      for (const sheet of this.spraySheets) {
        sheet.mesh.visible = !this.reducedMotion && speed > 1.8;
        if (sheet.mesh.visible) updateSpraySheet(sheet, x, z, yaw, Number(rig.length) || 4, Number(rig.beam) || 2,
          clamp((speed - 1.8) / 7, 0, 1), clamp(Number(state.omega) || 0, -1.2, 1.2), boostActive, this.time);
      }
      if (speed > 0.4 && this.wakeClock >= (this.mobile ? 0.17 : 0.105)) {
        this.wakeClock = 0;
        const speedFactor = Math.min(1, speed / 4), length = Number(rig.length) || 4, beam = Number(rig.beam) || 2;
        this.pushWake(x, z, yaw, speedFactor, length, beam);
        const side = Math.cos(yaw), sideZ = -Math.sin(yaw);
        if (!this.reducedMotion) {
          const bowX = x + Math.sin(yaw) * length * 0.44, bowZ = z + Math.cos(yaw) * length * 0.44;
          const sternX = x - Math.sin(yaw) * length * 0.48, sternZ = z - Math.cos(yaw) * length * 0.48;
          const baseN = this.mobile ? 6 : 12;
          const n = Math.min(this.mobile ? 14 : 28, Math.round(baseN * clamp(speed / 1.5, 0.45, 1.35) * Math.min(1.7, emissionBoost)));
          for (let i = 0; i < n; i++) {
            const bow = i % 3 === 0, originX = bow ? bowX : sternX, originZ = bow ? bowZ : sternZ;
            const sign = i % 2 === 0 ? -1 : 1, spread = beam * (0.26 + (i % 4) * 0.05);
            const outward = 0.55 + speedFactor * 1.35 + (boostActive ? 0.4 : 0);
            this.pool.spawn(originX + side * sign * spread, 0.065, originZ + sideZ * sign * spread,
              -Math.sin(yaw) * (0.2 + speedFactor * 0.25) + side * sign * outward,
              0.5 + speedFactor * (0.7 + emissionBoost * 0.65) + (i % 3) * 0.12,
              -Math.cos(yaw) * (0.2 + speedFactor * 0.25) + sideZ * sign * outward, {
                life: 0.55, size: 0.12 + speedFactor * 0.12 + (boostActive ? 0.05 : 0), size1: 0.025,
                color: [0.9, 0.99, 1], alpha: 0.96,
                gravity: 6.2, drag: 1.35,
              });
          }
        }
      }
      if (!this.reducedMotion && approaching) {
        this.breezeClock += step;
        if (this.breezeClock >= (this.mobile ? 0.22 : 0.16)) {
          this.breezeClock = 0;
          const wy = Number(wind?.yaw) || 0, strength = clamp(Number(wind?.strength) || 0, 0, 1);
          const wx = Math.sin(wy), wz = Math.cos(wy);
          const n = this.reducedMotion ? 0 : this.mobile ? 1 : 2;
          for (let i = 0; i < n; i++) this.pool.spawn(x + Math.sin(yaw) * 0.7, 0.85 + i * 0.12, z + Math.cos(yaw) * 0.7,
            wx * (0.65 + strength * 0.6), 0.02, wz * (0.65 + strength * 0.6), {
              life: 0.38, size: 0.11, size1: 0.025, color: [0.73, 0.95, 1], alpha: 0.55,
              gravity: 0, drag: 1.5,
            });
        }
      }
      // Activity may brighten this bounded visual wake but never feeds the movement simulation.
    }
    for (const ribbon of this.trails) updateRibbon(ribbon, this.time);
    this.pool.update(step);
  }

  diagnostics() {
    let activeParticles = 0;
    for (let i = 0; i < this.pool.alive.length; i++) activeParticles += this.pool.alive[i] ? 1 : 0;
    return { disposed: this.disposed, poolCapacity: this.pool.cap, activeParticles,
      wakeSamples: Math.max(0, ...this.trails.map((trail) => trail.history.length)), wakeEmissions: this.wakeCount,
      wakeCapacity: this.wakeCapacity, wakeSeconds: WAKE_SECONDS,
      wakeVertices: this.trails.reduce((n, trail) => n + trail.mesh.geometry.drawRange.count, 0),
      currentTriangles: this.currentBand.geometry.attributes.position.count / 3, flowPhase: this.flowClock.value,
      spraySheetTriangles: this.spraySheets.reduce((n, sheet) => n + sheet.mesh.geometry.attributes.position.count / 3, 0),
      foamFlecks: this.foam.fleckCount, foamCapacity: this.foam.capacity, foamRecycles: this.foam.recycleCount,
      foamCellOrigin: [this.foam.originX, this.foam.originZ],
      captureBursts: this.burstCount, impactBursts: this.impactCount, currentVisible: this.currentVisible, gustVisible: this.gustVisible,
      currentStrength: this.lastCurrent?.strength ?? this.lastCurrent?.speed ?? 0 };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.pool.points, this.foam.mesh, this.currentBand, this.chevrons.mesh);
    this.scene.remove(...this.trails.map((t) => t.mesh));
    this.scene.remove(...this.spraySheets.map((sheet) => sheet.mesh));
    this.pool.points.geometry.dispose(); this.pool.mat.dispose();
    this.foam.mesh.geometry.dispose(); this.foam.mesh.material.dispose();
    this.currentBand.geometry.dispose(); this.currentBand.material.dispose();
    this.chevrons.geometry.dispose(); this.chevrons.mesh.material.dispose();
    for (const trail of this.trails) { trail.mesh.geometry.dispose(); trail.mesh.material.dispose(); }
    for (const sheet of this.spraySheets) { sheet.mesh.geometry.dispose(); sheet.mesh.material.dispose(); }
    this.trails.length = 0;
    this.spraySheets.length = 0;
  }
}

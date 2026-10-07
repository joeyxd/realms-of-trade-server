// Deterministic swept-circle contacts for the aggregate naval body.
import { navalPose } from './handling.js';
import { NAVAL_DAMAGE as D } from '../../data/navalDamage.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const MAX_COORD = 1e9;
const MAX_CONTACTS = 4;
const EPSILON = 1e-9;

function validateState(state) {
  if (!state || !Number.isSafeInteger(state.tick) || state.tick < 0 ||
    !['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((key) => finite(state[key])) ||
    Math.abs(state.x) > MAX_COORD || Math.abs(state.z) > MAX_COORD ||
    Math.hypot(state.vx, state.vz) > 100 || Math.abs(state.omega) > 10)
    throw new TypeError('Invalid naval contact state');
}

function validateRig(rig) {
  if (!rig || !['beam', 'length', 'hullCx', 'hullCz', 'cx', 'cz'].every((key) => finite(rig[key])) ||
    rig.beam <= 0 || rig.beam > 10000 || rig.length <= 0 || rig.length > 10000 ||
    Math.abs(rig.hullCx) > 1000 || Math.abs(rig.hullCz) > 1000 ||
    Math.abs(rig.cx) > 1000 || Math.abs(rig.cz) > 1000)
    throw new TypeError('Invalid naval contact rig');
}

function validateObstacles(obstacles) {
  if (!Array.isArray(obstacles) || obstacles.length > 32) throw new TypeError('Invalid naval obstacles');
  const seen = new Set();
  for (const o of obstacles) {
    if (!o || !(typeof o.id === 'string' && o.id.length > 0) || seen.has(o.id) ||
      ![o.x, o.z, o.radius].every(finite) || Math.abs(o.x) > MAX_COORD || Math.abs(o.z) > MAX_COORD ||
      o.radius <= 0 || o.radius > 10000) throw new TypeError('Invalid naval obstacle');
    seen.add(o.id);
  }
}

function hullCenter(state, rig) {
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  const offsetX = rig.hullCx - rig.cx, offsetZ = rig.hullCz - rig.cz;
  return { x: state.x + c * offsetX + s * offsetZ, z: state.z - s * offsetX + c * offsetZ };
}

function circleHit(start, end, obstacle, radius) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const ox = start.x - obstacle.x, oz = start.z - obstacle.z;
  const d0 = Math.hypot(ox, oz);
  if (d0 < radius - EPSILON) {
    const nx = d0 > EPSILON ? ox / d0 : (Math.hypot(dx, dz) > EPSILON ? -dx / Math.hypot(dx, dz) : 1);
    // A body already inside an obstacle may continue outward without acquiring a bounce.
    if (dx * nx + dz * nx > EPSILON) return { t: 0, nx, nz: d0 > EPSILON ? oz / d0 : -dz / Math.max(EPSILON, Math.hypot(dx, dz)), penetration: true, outward: true };
    const nz = d0 > EPSILON ? oz / d0 : (Math.hypot(dx, dz) > EPSILON ? -dz / Math.hypot(dx, dz) : 0);
    return { t: 0, nx, nz, penetration: true, outward: false };
  }
  const a = dx * dx + dz * dz;
  if (a <= EPSILON) return null;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(Math.max(0, disc))) / (2 * a);
  if (t < -EPSILON || t > 1 + EPSILON) return null;
  const clampedT = clamp(t, 0, 1);
  const px = start.x + dx * clampedT - obstacle.x, pz = start.z + dz * clampedT - obstacle.z;
  const length = Math.hypot(px, pz);
  if (length <= EPSILON) return null;
  const nx = px / length, nz = pz / length;
  if (dx * nx + dz * nz >= -EPSILON) return null;
  return { t: clampedT, nx, nz, penetration: false, outward: false };
}

function localImpact(state, rig, worldX, worldZ) {
  const pose = navalPose(state, rig);
  const dx = worldX - pose.x, dz = worldZ - pose.z;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const localX = c * dx - s * dz, localZ = s * dx + c * dz;
  // The circle proxy can touch beyond a hull corner; anchor foundation damage to a real hull cell.
  return { localX: clamp(localX, rig.hullCx - rig.beam / 2, rig.hullCx + rig.beam / 2),
    localZ: clamp(localZ, rig.hullCz - rig.length / 2, rig.hullCz + rig.length / 2) };
}

/** Resolve one fixed tick against up to 32 static circular obstacles. */
export function resolveNavalContact(before, next, rig, obstacles) {
  validateState(before);
  validateState(next);
  validateRig(rig);
  validateObstacles(obstacles);
  if (next.tick !== before.tick + 1) throw new TypeError('Naval contact states must be consecutive ticks');

  const state = { ...next };
  // This conservative circle proxy intentionally covers the full hull; shoreline circles should sit
  // inside visible rocks so its corners do not create invisible walls around the artwork.
  const radius = 0.5 * Math.hypot(rig.beam, rig.length);
  let start = hullCenter(before, rig), end = hullCenter(state, rig);
  const contacts = [];
  const used = new Set();
  const ordered = [...obstacles].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  while (contacts.length < MAX_CONTACTS) {
    let chosen = null;
    for (const obstacle of ordered) {
      if (used.has(obstacle.id)) continue;
      const hit = circleHit(start, end, obstacle, radius + obstacle.radius);
      if (!hit) continue;
      if (!chosen || hit.t < chosen.hit.t - EPSILON ||
        (Math.abs(hit.t - chosen.hit.t) <= EPSILON && obstacle.id < chosen.obstacle.id))
        chosen = { obstacle, hit };
    }
    if (!chosen) break;

    const { obstacle, hit } = chosen;
    used.add(obstacle.id);
    const dx = end.x - start.x, dz = end.z - start.z;
    let contactX = start.x + dx * hit.t, contactZ = start.z + dz * hit.t;
    const normalSpeed = state.vx * hit.nx + state.vz * hit.nz;
    const incoming = Math.max(0, -normalSpeed);
    const speed = incoming;
    const damage = Math.min(D.maxImpactDamage, Math.round(Math.max(0, speed - D.safeNormalSpeed) ** 2 * D.damageScale));

    if (hit.penetration) {
      contactX = obstacle.x + hit.nx * (radius + obstacle.radius);
      contactZ = obstacle.z + hit.nz * (radius + obstacle.radius);
    }

    const remaining = hit.penetration ? (hit.outward ? { x: dx, z: dz } : { x: 0, z: 0 }) :
      { x: dx * (1 - hit.t), z: dz * (1 - hit.t) };
    const remainingNormal = remaining.x * hit.nx + remaining.z * hit.nz;
    const tangentX = remaining.x - remainingNormal * hit.nx;
    const tangentZ = remaining.z - remainingNormal * hit.nz;
    const slide = { x: tangentX * D.tangentRetention, z: tangentZ * D.tangentRetention };
    const bounce = hit.outward ? Math.max(0, remainingNormal) : Math.max(0, -remainingNormal) * D.restitution;
    end = { x: contactX + slide.x + hit.nx * bounce, z: contactZ + slide.z + hit.nz * bounce };

    if (normalSpeed < -EPSILON) {
      const tangentVX = state.vx - normalSpeed * hit.nx;
      const tangentVZ = state.vz - normalSpeed * hit.nz;
      const outNormal = -normalSpeed * D.restitution;
      state.vx = tangentVX * D.tangentRetention + hit.nx * outNormal;
      state.vz = tangentVZ * D.tangentRetention + hit.nz * outNormal;
    }

    const atContact = hullCenter(state, rig);
    state.x += contactX - atContact.x;
    state.z += contactZ - atContact.z;
    const local = localImpact(state, rig, contactX - hit.nx * radius, contactZ - hit.nz * radius);
    contacts.push({ id: obstacle.id, x: contactX, z: contactZ, normalX: hit.nx, normalZ: hit.nz,
      speed, damage, ...local });
    start = { x: contactX, z: contactZ };
  }

  // hullCenter is COM plus the rotated hull offset; preserve that offset when committing position.
  const finalOffset = hullCenter(state, rig);
  state.x += end.x - finalOffset.x;
  state.z += end.z - finalOffset.z;
  return { state, contacts };
}

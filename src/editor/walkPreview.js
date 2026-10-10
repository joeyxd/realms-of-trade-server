import * as THREE from 'three';
import { DT } from '../data/tuning.js';
import { World } from '../sim/world.js';
import { canStand, stepMover } from '../sim/systems/movement.js';

const SPAWN_RADIUS = 8;
const KEY_AXES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const editable = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
/** Make a private collision view of a map without changing its terrain or collider source. */
export function createPreviewMap(map, colliders = map?.colliders || []) {
  if (!map || !Array.isArray(colliders)) throw new TypeError('A map and collider array are required');
  const copied = colliders.map((collider) => ({ ...collider }));
  for (const c of copied) {
    if (![c.x, c.z, c.r].every(Number.isFinite) || c.r < 0) throw new TypeError('Invalid preview collider');
  }
  const queryOut = [];
  const preview = { ...map, colliders: copied };
  preview.queryColliders = (x, z, radius) => {
    queryOut.length = 0;
    if (![x, z, radius].every(Number.isFinite) || radius < 0) return queryOut;
    // Preview drafts can contain legacy objects scaled to enormous sizes. A linear AABB
    // scan is bounded by collider count and cannot explode memory or miss a large circle.
    for (let i = 0; i < copied.length; i++) {
      const c = copied[i];
      if (Math.abs(c.x - x) <= radius + c.r && Math.abs(c.z - z) <= radius + c.r) queryOut.push(i);
    }
    return queryOut;
  };
  return preview;
}

function spawnCandidates(point, map) {
  const origin = point && Number.isFinite(point.x) && Number.isFinite(point.z)
    ? point : map.landmarks?.village || map.landmarks?.spawn;
  if (!origin) return [];
  const result = [{ x: origin.x, z: origin.z }];
  const step = 0.5;
  for (let radius = step; radius <= SPAWN_RADIUS; radius += step) {
    const count = Math.max(8, Math.ceil((2 * Math.PI * radius) / step));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      result.push({ x: origin.x + Math.cos(angle) * radius, z: origin.z + Math.sin(angle) * radius });
    }
  }
  return result;
}

/** Isolated local player preview for the GM draft editor. */
export class EditorWalkPreview {
  constructor({ camera, canvas, map, createView, ownsTarget = () => false } = {}) {
    if (!camera || !canvas || !map || typeof createView !== 'function')
      throw new TypeError('EditorWalkPreview requires camera, canvas, map, and createView');
    Object.assign(this, { camera, canvas, map, createView, ownsTarget });
    this.active = false;
    this.world = null; this.body = 0; this.view = null;
    this.keys = new Set(); this.accumulator = 0; this.heading = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0); this.cameraOffset = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3(); this.cameraLook = new THREE.Vector3();
    this.savedPosition = null; this.savedQuaternion = null;
    this.onKeyDown = (event) => this._keyDown(event);
    this.onKeyUp = (event) => this._keyUp(event);
    this.onBlur = () => this._clearKeys();
  }

  start({ colliders = this.map.colliders, point = this.map.landmarks?.village } = {}) {
    if (this.active) return true;
    const previewMap = createPreviewMap(this.map, colliders);
    const world = new World(this.map.seed, { map: previewMap });
    let body = 0;
    for (const candidate of spawnCandidates(point, previewMap)) {
      if (canStand(world, candidate.x, candidate.z)) { body = world.spawnPlayer({ x: candidate.x, z: candidate.z }); break; }
    }
    if (!body) throw new Error('spawn_unavailable');

    let view;
    try {
      view = this.createView();
      if (!view || typeof view.update !== 'function' || typeof view.dispose !== 'function')
        throw new TypeError('Preview view must provide update(dt, state) and dispose()');
      this.savedPosition = this.camera.position.clone();
      this.savedQuaternion = this.camera.quaternion.clone();
      this.heading.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.heading.y = 0;
      if (this.heading.lengthSq() < 1e-8) this.heading.set(0, 0, -1);
      this.heading.normalize();
      this.right.set(-this.heading.z, 0, this.heading.x).normalize();
      this.cameraOffset.copy(this.heading).multiplyScalar(-8).add(new THREE.Vector3(0, 5, 0));
      this.world = world; this.body = body; this.view = view;
      this.accumulator = 0; this.keys.clear(); this.active = true;
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('keyup', this.onKeyUp, true);
      window.addEventListener('blur', this.onBlur);
      this._syncCamera();
      this._updateView(0);
      return true;
    } catch (error) {
      this._clearKeys();
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
      if (this.savedPosition) this.camera.position.copy(this.savedPosition);
      if (this.savedQuaternion) this.camera.quaternion.copy(this.savedQuaternion);
      this.savedPosition = this.savedQuaternion = null;
      this.world = null; this.body = 0; this.view = null; this.active = false;
      try { view?.dispose?.(); } catch { /* Preserve the startup error. */ }
      throw error;
    }
  }

  _keyDown(event) {
    if (!this.active || editable(event.target) || this.ownsTarget(event.target) || !KEY_AXES.has(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.keys.add(event.code);
  }

  _keyUp(event) {
    if (!KEY_AXES.has(event.code)) return;
    const owned = this.keys.has(event.code);
    this.keys.delete(event.code);
    if (owned) { event.preventDefault(); event.stopImmediatePropagation(); }
  }

  _clearKeys() {
    this.keys.clear();
    if (this.world && this.body) {
      this.world.ecs.vx[this.body] = 0;
      this.world.ecs.vz[this.body] = 0;
      this.world.ecs.moveMag[this.body] = 0;
    }
  }

  _command() {
    let x = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let y = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const length = Math.hypot(x, y) || 1;
    x /= length; y /= length;
    return { mx: this.right.x * x + this.heading.x * y, mz: this.right.z * x + this.heading.z * y, ax: 0, az: 0, btn: 0, prs: 0 };
  }

  _state() {
    const e = this.body, ecs = this.world.ecs;
    return { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e], f: ecs.facing[e], vx: ecs.vx[e], vz: ecs.vz[e],
      st: ecs.state[e], mag: ecs.moveMag[e], wade: ecs.wade[e], act: ecs.act[e], actT: ecs.actT[e] };
  }

  _syncCamera() {
    const ecs = this.world.ecs, e = this.body;
    this.cameraLook.set(ecs.x[e], ecs.y[e] + 1.05, ecs.z[e]);
    this.cameraPosition.copy(this.cameraLook).add(this.cameraOffset);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraLook);
    this.camera.updateMatrixWorld();
  }

  _updateView(dt) { this.view.update(dt, this._state()); }

  update(dt) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.1);
    const cmd = this._command();
    while (this.accumulator >= DT) {
      stepMover(this.world, this.body, cmd, DT);
      this.accumulator -= DT;
    }
    this._syncCamera();
    this._updateView(dt);
  }

  get position() {
    if (!this.active || !this.world || !this.body) return null;
    const e = this.body, ecs = this.world.ecs;
    return { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] };
  }

  stop() {
    if (!this.active && !this.view) return;
    this._clearKeys(); this.active = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    const view = this.view;
    this.view = null; this.world = null; this.body = 0; this.accumulator = 0;
    if (this.savedPosition) this.camera.position.copy(this.savedPosition);
    if (this.savedQuaternion) this.camera.quaternion.copy(this.savedQuaternion);
    this.camera.updateMatrixWorld();
    this.savedPosition = this.savedQuaternion = null;
    view?.dispose();
  }

  dispose() { this.stop(); }
}

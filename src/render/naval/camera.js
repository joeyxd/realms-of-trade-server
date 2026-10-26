import * as THREE from 'three';
import { createBoatCamera, stepBoatCamera } from './boatCamera.js';
import { NAVAL_CAMERA } from '../../data/navalCamera.js';

const angleDelta = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// PT05 (Joi, R1 and R2: "still too close"): chase distance as a multiple of the pre-PT05 framing. The near step
// keeps the old view, the default sits 1.7 times farther (R1 asked 1.6 to 1.8). Angles do not change, so the
// horizon and the hull stay where they were on screen; only their size does.
export const NAVAL_ZOOM_LEVELS = Object.freeze([1, 1.7, 2.4]);
export const NAVAL_ZOOM_DEFAULT = 1;

/** Lab-only chase framing. Camera lag never changes helm input or simulated velocity. */
export class NavalLabCamera {
  constructor(camera, { reducedMotion = false } = {}) {
    this.camera = camera; this.reducedMotion = reducedMotion;
    this.anchor = new THREE.Vector3(); this.aim = new THREE.Vector3(); this.desired = new THREE.Vector3();
    this.yaw = 0; this.ready = false; this.mode = 'chase';
    this.orbitYaw = 0; this.orbitPitch = 0; this.look = { x: 0, y: 0 };
    this.zoomIdx = NAVAL_ZOOM_DEFAULT; this.zoom = NAVAL_ZOOM_LEVELS[this.zoomIdx];
    this.boat = createBoatCamera(); this.boatOut = null;
  }

  // The zoom step survives reset(): leaving the helm or the raft keeps the player's choice for the next voyage.
  reset() { this.ready = false; this.boat = createBoatCamera(); this.recenter(); }

  /** +1 steps farther, -1 closer; `wrap` cycles past the ends (the touch button). Returns the new index. */
  zoomStep(step, { wrap = false } = {}) {
    const count = NAVAL_ZOOM_LEVELS.length, next = this.zoomIdx + Math.sign(step || 0);
    this.zoomIdx = wrap ? (next + count) % count : Math.max(0, Math.min(count - 1, next));
    return this.zoomIdx;
  }

  setLook({ x = 0, y = 0 } = {}) {
    this.look.x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.look.y = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  }

  recenter() { this.orbitYaw = this.orbitPitch = 0; this.setLook(); }

  update(dt, { state, rig, pose, mode = 'chase', fovOffset = 0, roll = 0, paused = false }) {
    const step = paused || !Number.isFinite(dt) ? 0 : Math.min(0.1, Math.max(0, dt));
    // Camera-only orbit. The helm remains in the ship's frame, including when looking astern.
    this.orbitYaw = angleDelta(this.orbitYaw + this.look.x * step * 1.9, 0);
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + this.look.y * step * 0.85, -0.18, 0.68);
    const follow = step === 0 ? 0 : this.reducedMotion ? 1 : 1 - Math.exp(-step * 8);
    const heading = step === 0 ? 0 : this.reducedMotion ? 1 : 1 - Math.exp(-step * 5);
    const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
    // Use the hull centre rather than ballast COM: dropping ballast must not reframe the deck.
    const hx = pose.x + rig.hullCx * c + rig.hullCz * s;
    const hz = pose.z - rig.hullCx * s + rig.hullCz * c;
    const desired = this.desired.set(hx, pose.y, hz);
    const zoomTarget = NAVAL_ZOOM_LEVELS[this.zoomIdx];
    if (!this.ready || mode !== this.mode) {
      this.anchor.copy(desired); this.yaw = state.yaw; this.zoom = zoomTarget; this.ready = true;
    } else {
      this.anchor.lerp(desired, follow);
      this.yaw += angleDelta(state.yaw, this.yaw) * heading;
      // A zoom step glides over about half a second rather than cutting.
      this.zoom += (zoomTarget - this.zoom) * (step === 0 ? 0 : this.reducedMotion ? 1 : 1 - Math.exp(-step * 6));
    }
    this.mode = mode;
    const hull = Math.max(4, rig.beam, rig.length);
    const narrow = Math.max(1, 1.15 / Math.max(0.35, this.camera.aspect));
    const frame = hull / 4 * narrow * this.zoom;
    const fov = (mode === 'chase' ? 50 : 35) + (this.reducedMotion ? 0 : fovOffset);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov; this.camera.updateProjectionMatrix();
    }
    if (mode === 'isometric') {
      const distance = hull / 4 * 18;
      this.camera.position.set(this.anchor.x + distance, distance * 1.1, this.anchor.z + distance);
      this.aim.set(this.anchor.x, 0, this.anchor.z);
    } else {
      const forwardX = Math.sin(this.yaw + this.orbitYaw), forwardZ = Math.cos(this.yaw + this.orbitYaw);
      const rightX = Math.cos(this.yaw + this.orbitYaw), rightZ = -Math.sin(this.yaw + this.orbitYaw);
      // Rear three-quarter view: the deck stays low, the whole sail and forward sea remain visible.
      const behind = 7.5 * Math.cos(this.orbitPitch), side = 3.9 * Math.cos(this.orbitPitch), ahead = 4.7;
      this.camera.position.set(this.anchor.x - forwardX * behind * frame + rightX * side * frame,
        this.anchor.y + (2.8 + Math.sin(this.orbitPitch) * 7.5) * frame,
        this.anchor.z - forwardZ * behind * frame + rightZ * side * frame);
      // Extend the camera-to-hull axis: looking straight ahead would push the raft off-screen sideways.
      this.aim.set(this.anchor.x + (forwardX - rightX * side / behind) * ahead * frame,
        this.anchor.y - 0.35 * frame, this.anchor.z + (forwardZ - rightZ * side / behind) * ahead * frame);
    }
    this.camera.lookAt(this.aim);
    if (!this.reducedMotion) this.camera.rotateZ(THREE.MathUtils.clamp(roll, -0.025, 0.025));
    this.camera.updateMatrixWorld();
    return this.diagnostics();
  }

  /**
   * Wind Waker's Boat camera (N5, boatCamera.js). The default zoom step is WW's exact distance, the other steps scale it;
   * the look input offsets its targets. `from` ({ eye, center, fov }) is the view to blend from when it starts.
   */
  updateBoat(dt, { pilot, yaw = 0, windYaw = 0, stickX = 0, hull = null, ship = pilot, speed = NaN, from = null, paused = false }) {
    const step = paused || !Number.isFinite(dt) ? 0 : Math.min(0.1, Math.max(0, dt));
    this.orbitYaw = angleDelta(this.orbitYaw + this.look.x * step * 1.9, 0);
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + this.look.y * step * 0.85, -0.18, 0.68);
    if (this.mode !== 'boat' || !this.boat.started) {
      // Coming from the chase framing, blend from it; otherwise from the caller's view (the land camera).
      if (this.mode !== 'boat' && this.ready) from = { eye: this.camera.position.clone(), center: this.aim.clone(), fov: this.camera.fov };
      this.boat = createBoatCamera(); this.ready = false;
    }
    this.mode = 'boat';
    const out = this.boatOut = stepBoatCamera(this.boat, { dt: step, x: pilot.x, y: pilot.y, z: pilot.z, yaw, windYaw, stickX, hull,
      shipX: ship.x, shipZ: ship.z, from, speed, zoom: NAVAL_ZOOM_LEVELS[this.zoomIdx] / NAVAL_ZOOM_LEVELS[NAVAL_ZOOM_DEFAULT],
      lookYaw: this.orbitYaw, lookPitch: this.orbitPitch });
    // WW's FOV is vertical; wider than 16:9 keeps the 16:9 horizontal angle instead of stretching sideways.
    const aspect = Math.max(0.1, this.camera.aspect || 16 / 9), wide = 16 / 9;
    let fov = this.reducedMotion ? NAVAL_CAMERA.fov : out.fov;
    if (aspect > wide) fov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * wide / aspect) * 180 / Math.PI;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.position.set(out.eye.x, out.eye.y, out.eye.z);
    this.aim.set(out.center.x, out.center.y, out.center.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.aim);
    // WW banks the view matrix: a positive bank turns the image counter-clockwise, which is three.js's negative roll.
    if (!this.reducedMotion) this.camera.rotateZ(-out.bank);
    this.camera.updateMatrixWorld();
    return this.diagnostics();
  }

  diagnostics() {
    return { mode: this.mode, yaw: this.yaw, orbitYaw: this.orbitYaw, orbitPitch: this.orbitPitch,
      look: { ...this.look }, fov: this.camera.fov, zoomIdx: this.zoomIdx, zoom: this.zoom,
      position: this.camera.position.toArray(), target: this.aim.toArray(),
      ...(this.mode === 'boat' && this.boatOut ? { speed: this.boatOut.speed, bank: this.boatOut.bank, steady: this.boat.steady } : {}) };
  }
}

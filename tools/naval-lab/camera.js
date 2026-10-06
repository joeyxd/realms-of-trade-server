import * as THREE from 'three';

const angleDelta = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Lab-only chase framing. Camera lag never changes helm input or simulated velocity. */
export class NavalLabCamera {
  constructor(camera, { reducedMotion = false } = {}) {
    this.camera = camera; this.reducedMotion = reducedMotion;
    this.anchor = new THREE.Vector3(); this.aim = new THREE.Vector3(); this.desired = new THREE.Vector3();
    this.yaw = 0; this.ready = false; this.mode = 'chase';
  }

  reset() { this.ready = false; }

  update(dt, { state, rig, pose, mode = 'chase', fovOffset = 0, roll = 0, paused = false }) {
    const step = paused ? 0 : Math.min(0.1, Math.max(0, dt));
    const follow = step === 0 ? 0 : this.reducedMotion ? 1 : 1 - Math.exp(-step * 8);
    const heading = step === 0 ? 0 : this.reducedMotion ? 1 : 1 - Math.exp(-step * 5);
    const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
    // Use the hull centre rather than ballast COM: dropping ballast must not reframe the deck.
    const hx = pose.x + rig.hullCx * c + rig.hullCz * s;
    const hz = pose.z - rig.hullCx * s + rig.hullCz * c;
    const desired = this.desired.set(hx, pose.y, hz);
    if (!this.ready || mode !== this.mode) {
      this.anchor.copy(desired); this.yaw = state.yaw; this.ready = true;
    } else {
      this.anchor.lerp(desired, follow);
      this.yaw += angleDelta(state.yaw, this.yaw) * heading;
    }
    this.mode = mode;
    const hull = Math.max(4, rig.beam, rig.length);
    const narrow = Math.max(1, 1.15 / Math.max(0.35, this.camera.aspect));
    const frame = hull / 4 * narrow;
    const fov = (mode === 'chase' ? 50 : 35) + (this.reducedMotion ? 0 : fovOffset);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov; this.camera.updateProjectionMatrix();
    }
    if (mode === 'isometric') {
      const distance = hull / 4 * 18;
      this.camera.position.set(this.anchor.x + distance, distance * 1.1, this.anchor.z + distance);
      this.aim.set(this.anchor.x, 0, this.anchor.z);
    } else {
      const forwardX = Math.sin(this.yaw), forwardZ = Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
      // Rear three-quarter view: the deck stays low, the whole sail and forward sea remain visible.
      const behind = 7.5, side = 3.9, ahead = 4.7;
      this.camera.position.set(this.anchor.x - forwardX * behind * frame + rightX * side * frame,
        this.anchor.y + 2.8 * frame, this.anchor.z - forwardZ * behind * frame + rightZ * side * frame);
      // Extend the camera-to-hull axis: looking straight ahead would push the raft off-screen sideways.
      this.aim.set(this.anchor.x + (forwardX - rightX * side / behind) * ahead * frame,
        this.anchor.y - 0.35 * frame, this.anchor.z + (forwardZ - rightZ * side / behind) * ahead * frame);
    }
    this.camera.lookAt(this.aim);
    if (!this.reducedMotion) this.camera.rotateZ(THREE.MathUtils.clamp(roll, -0.025, 0.025));
    this.camera.updateMatrixWorld();
    return this.diagnostics();
  }

  diagnostics() {
    return { mode: this.mode, yaw: this.yaw, fov: this.camera.fov,
      position: this.camera.position.toArray(), target: this.aim.toArray() };
  }
}

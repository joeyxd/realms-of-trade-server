// MOBA-style semi-locked isometric camera: damped follow, cursor look-ahead, 3 zoom levels,
// optional 90° rotation steps, trauma shake, punch, slow-mo dolly and a reserved naval mode.
import * as THREE from 'three';
import { tuning } from '../data/tuning.js';
import { damp, clamp, easeInOutCubic } from '../core/math.js';

const D2R = Math.PI / 180;

export class CameraRig {
  constructor(camera) {
    const T = tuning.camera;
    this.cam = camera;
    camera.fov = T.fov;
    camera.near = 0.5;
    camera.far = 1400;
    camera.updateProjectionMatrix();
    this.target = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.lookWant = new THREE.Vector3();
    this.yaw = T.yaw * D2R;
    this.yawTarget = this.yaw;
    this.pitch = T.pitch * D2R;
    this.pitchTarget = this.pitch;
    this.zoomIdx = T.zoomDefault;
    this.dist = T.zoomLevels[this.zoomIdx];
    this.distTarget = this.dist;
    this.trauma = 0;
    this.punch = 0;
    this.mode = 'iso';
    this.shakeScale = 1;
    this.time = 0;
    this.blend = null; // {pos, quat, t, dur}
    this.center = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.q0 = new THREE.Quaternion();
    this.p0 = new THREE.Vector3();
    this.snapped = false;
  }

  // Ground-plane basis for camera-relative movement.
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  // Movement basis uses the *target* yaw so rotating mid-run doesn't wobble input.
  moveBasis(ix, iy, out) {
    const y = this.yawTarget;
    out.x = Math.cos(y) * ix - Math.sin(y) * iy;
    out.z = -Math.sin(y) * ix - Math.cos(y) * iy;
    return out;
  }

  zoom(step) {
    const L = tuning.camera.zoomLevels;
    this.zoomIdx = clamp(this.zoomIdx + step, 0, L.length - 1);
    if (this.mode === 'iso') this.distTarget = L[this.zoomIdx];
  }

  rotate(dir) { this.yawTarget += dir * tuning.camera.rotateStep * D2R; }

  setMode(mode) {
    const T = tuning.camera;
    this.mode = mode;
    if (mode === 'naval') { this.distTarget = T.navalDistance; this.pitchTarget = T.navalPitch * D2R; }
    else { this.distTarget = T.zoomLevels[this.zoomIdx]; this.pitchTarget = T.pitch * D2R; }
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
  punchIn(a) { this.punch = Math.max(this.punch, a); }

  snapTo(pos) {
    this.target.copy(pos);
    this.look.set(0, 0, 0);
    this.snapped = true;
  }

  // Smoothly fly from the current camera pose into the rig's pose over `dur` seconds.
  blendFromCurrent(dur) {
    this.blend = { pos: this.cam.position.clone(), quat: this.cam.quaternion.clone(), t: 0, dur };
  }

  update(dt, focus, aim, timeScale = 1) {
    const T = tuning.camera;
    this.time += dt;
    this.target.x = damp(this.target.x, focus.x, T.followLambda, dt);
    this.target.y = damp(this.target.y, focus.y, T.followLambda * 0.6, dt);
    this.target.z = damp(this.target.z, focus.z, T.followLambda, dt);
    const viewH = 2 * this.dist * Math.tan((this.cam.fov * D2R) / 2);
    if (aim) {
      this.lookWant.set((aim.x - focus.x) * T.lookAhead, 0, (aim.z - focus.z) * T.lookAhead);
      const max = viewH * T.lookAheadMaxFrac;
      const l = this.lookWant.length();
      if (l > max) this.lookWant.multiplyScalar(max / l);
    } else this.lookWant.set(0, 0, 0);
    this.look.x = damp(this.look.x, this.lookWant.x, T.lookAheadLambda, dt);
    this.look.z = damp(this.look.z, this.lookWant.z, T.lookAheadLambda, dt);
    this.yaw = damp(this.yaw, this.yawTarget, 9, dt);
    this.pitch = damp(this.pitch, this.pitchTarget, 6, dt);
    this.dist = damp(this.dist, this.distTarget, 7, dt);
    this.punch = damp(this.punch, 0, T.punchLambda, dt);
    const dolly = 1 - T.slowmoDolly * clamp(1 - timeScale, 0, 1) - this.punch * 0.08;
    const d = this.dist * dolly;

    this.center.copy(this.target).add(this.look);
    this.center.y += 0.8;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const px = this.center.x + Math.sin(this.yaw) * cp * d;
    const py = this.center.y + sp * d;
    const pz = this.center.z + Math.cos(this.yaw) * cp * d;
    this.cam.position.set(px, py, pz);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.center);

    // Trauma shake (offset in camera plane + small roll).
    this.trauma = Math.max(0, this.trauma - T.shake.decay * dt);
    const s = this.trauma * this.trauma * this.shakeScale;
    if (s > 0.0001) {
      const t = this.time * T.shake.freq;
      const ox = (Math.sin(t * 1.0) + Math.sin(t * 2.31 + 1.7) * 0.5) * 0.66;
      const oy = (Math.sin(t * 1.17 + 4.1) + Math.sin(t * 2.71 + 0.3) * 0.5) * 0.66;
      const rr = Math.sin(t * 0.83 + 2.2);
      this.cam.translateX(ox * T.shake.maxOffset * s);
      this.cam.translateY(oy * T.shake.maxOffset * s);
      this.cam.rotateZ(rr * T.shake.maxRoll * D2R * s);
    }

    if (this.blend) {
      const b = this.blend;
      b.t += dt;
      const k = easeInOutCubic(Math.min(1, b.t / b.dur));
      this.p0.copy(this.cam.position);
      this.q0.copy(this.cam.quaternion);
      this.cam.position.lerpVectors(b.pos, this.p0, k);
      this.cam.quaternion.slerpQuaternions(b.quat, this.q0, k);
      if (b.t >= b.dur) this.blend = null;
    }
    this.cam.updateMatrixWorld();
  }
}

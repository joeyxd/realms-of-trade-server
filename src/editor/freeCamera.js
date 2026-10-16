import * as THREE from 'three';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const isTyping = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Free camera controller for the world editor. It never touches the player or simulation. */
export class EditorFreeCamera {
  constructor(camera, canvas, { ownsTarget = () => false } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.ownsTarget = ownsTarget;
    this.enabled = false;
    this.lookHeld = false;
    this.keys = new Set();
    this.speed = 18;
    this.yaw = 0;
    this.pitch = 0;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this._syncAngles();

    this.onKeyDown = (event) => {
      if (!this.enabled || isTyping(event.target) || this.ownsTarget(event.target)) return;
      if (event.code === 'Escape') return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation(); this.keys.add(event.code);
      }
    };
    this.onKeyUp = (event) => {
      const owned = this.keys.has(event.code);
      this.keys.delete(event.code);
      if (this.enabled && owned) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    this.onPointerDown = (event) => {
      if (!this.enabled || event.button !== 2 || this.ownsTarget(event.target)) return;
      event.preventDefault(); this.lookHeld = true; this.canvas.focus?.({ preventScroll: true });
    };
    this.onPointerMove = (event) => {
      if (!this.enabled || !this.lookHeld) return;
      const dx = Number.isFinite(event.movementX) ? event.movementX : 0;
      const dy = Number.isFinite(event.movementY) ? event.movementY : 0;
      this.yaw -= dx * 0.0026;
      this.pitch = clamp(this.pitch - dy * 0.0022, -1.48, 1.48);
      this._applyLook();
    };
    this.onPointerUp = (event) => { if (event.button === 2) this.lookHeld = false; };
    this.onContextMenu = (event) => { if (this.enabled) event.preventDefault(); };
    this.onWheel = (event) => {
      if (!this.enabled || this.ownsTarget(event.target)) return;
      this.speed = clamp(this.speed * Math.exp(-Math.sign(event.deltaY) * 0.18), 2, 160);
      event.preventDefault();
    };
    this.onBlur = () => { this.keys.clear(); this.lookHeld = false; };
  }

  _syncAngles() {
    this.camera.getWorldDirection(this.forward).normalize();
    this.yaw = Math.atan2(this.forward.x, this.forward.z);
    this.pitch = Math.asin(clamp(this.forward.y, -1, 1));
  }

  _applyLook() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
    this.camera.lookAt(this.camera.position.clone().add(this.forward));
    this.camera.updateMatrixWorld();
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true; this._syncAngles();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false; this.keys.clear(); this.lookHeld = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  update(dt) {
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return;
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.move.set(0, 0, 0);
    if (this.keys.has('KeyW')) this.move.add(this.forward);
    if (this.keys.has('KeyS')) this.move.sub(this.forward);
    if (this.keys.has('KeyD')) this.move.add(this.right);
    if (this.keys.has('KeyA')) this.move.sub(this.right);
    if (this.keys.has('KeyE')) this.move.y += 1;
    if (this.keys.has('KeyQ')) this.move.y -= 1;
    if (this.move.lengthSq() > 0) {
      this.move.normalize().multiplyScalar(this.speed * fast * Math.min(dt, 0.1));
      this.camera.position.add(this.move);
      this.camera.updateMatrixWorld();
    }
  }

  focus(point) {
    if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return;
    this.forward.copy(point).sub(this.camera.position);
    if (this.forward.lengthSq() < 1e-6) return;
    this.forward.normalize();
    this.yaw = Math.atan2(this.forward.x, this.forward.z);
    this.pitch = Math.asin(clamp(this.forward.y, -1, 1));
    this._applyLook();
  }

  dispose() { this.disable(); }
}

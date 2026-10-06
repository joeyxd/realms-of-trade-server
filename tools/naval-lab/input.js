const PILOT_VALUES = new Set(['throttle', 'brake', 'left', 'right']);

const KEY_ACTIONS = new Map([
  ['KeyW', 'throttle'], ['ArrowUp', 'throttle'],
  ['KeyS', 'brake'], ['ArrowDown', 'brake'],
  ['KeyA', 'left'], ['ArrowLeft', 'left'],
  ['KeyD', 'right'], ['ArrowRight', 'right'],
]);

function isFormTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.contentEditable === 'true';
}

function keyFor(event) {
  if (KEY_ACTIONS.has(event.code)) return event.code;
  if (event.code === 'KeyR') return 'r';
  if (event.code === 'KeyJ') return 'j';
  const key = String(event.key || '');
  const lower = key.toLowerCase();
  if (lower === 'w' || lower === 's' || lower === 'a' || lower === 'd') return `Key${lower.toUpperCase()}`;
  return key;
}

function finiteClamp(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : 0;
}

/** Browser-only adapter for the standalone naval lab controls. */
export class NavalLabInput {
  constructor(root, {
    onReset = () => {},
    onJettison = () => {},
    onGesture = () => {},
    onCancel = () => {},
    getGamepads = () => globalThis.navigator?.getGamepads?.() || [],
  } = {}) {
    if (!root?.addEventListener || !root?.querySelectorAll) {
      throw new TypeError('NavalLabInput requires a document-like EventTarget');
    }

    this.root = root;
    this.onReset = onReset;
    this.onJettison = onJettison;
    this.onGesture = onGesture;
    this.onCancel = onCancel;
    this.getGamepads = getGamepads;
    this.keys = new Set();
    this.buttons = new Set();
    this.pointers = new Map();
    this.captureQueued = false;
    this.capturePointerOwners = new Set();
    this.capturePointerReleased = new Set();
    this.captureOtherQueued = false;
    this.captureGamepadWasDown = false;
    this.captureGamepadSuppressed = false;
    this.disposed = false;
    this.listeners = [];
    this.buttonListeners = [];
    this.windowTarget = root.defaultView || root.ownerDocument?.defaultView || null;

    this.listen(root, 'keydown', (event) => this.handleKeyDown(event));
    this.listen(root, 'keyup', (event) => this.handleKeyUp(event));
    this.listen(root, 'pointerup', (event) => this.releasePointer(event));
    this.listen(root, 'pointercancel', (event) => this.releasePointer(event));
    this.listen(root, 'lostpointercapture', (event) => this.releasePointer(event));
    this.listen(root, 'visibilitychange', () => {
      if (root.hidden || root.visibilityState === 'hidden') this.clear();
    });
    if (this.windowTarget) this.listen(this.windowTarget, 'blur', () => this.clear());

    for (const element of root.querySelectorAll('[data-pilot]')) {
      const action = element.dataset?.pilot ?? element.getAttribute?.('data-pilot');
      if (!PILOT_VALUES.has(action)) continue;
      const listener = (event) => this.handlePointerDown(event, element, action);
      element.addEventListener('pointerdown', listener);
      this.buttonListeners.push([element, 'pointerdown', listener]);
    }
    for (const element of root.querySelectorAll('[data-capture]')) {
      const listener = (event) => this.handleCapturePointerDown(event, element);
      element.addEventListener('pointerdown', listener);
      this.buttonListeners.push([element, 'pointerdown', listener]);
      const clickListener = (event) => {
        if (event.detail !== 0 || this.isCaptureDisabled(element)) return;
        this.queueCapture(true);
      };
      element.addEventListener('click', clickListener);
      this.buttonListeners.push([element, 'click', clickListener]);
    }
  }

  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  handleKeyDown(event) {
    if (event.key === 'Escape' || event.code === 'Escape') {
      this.clear();
      if (!event.repeat) this.onCancel();
      event.preventDefault?.();
      return;
    }
    if (isFormTarget(event.target)) return;

    const key = keyFor(event);
    if (KEY_ACTIONS.has(key)) {
      const firstPress = !this.keys.has(key);
      this.keys.add(key);
      if (firstPress) this.onGesture();
      event.preventDefault?.();
      return;
    }
    if (event.repeat) return;
    if (event.code === 'Space' || event.key === ' ') {
      const captureButton = event.target?.closest?.('[data-capture]') ||
        (event.target?.hasAttribute?.('data-capture') ? event.target : null);
      if (!captureButton) {
        this.queueCapture(true);
        event.preventDefault?.();
      }
    } else if (key.toLowerCase() === 'r') {
      this.onGesture();
      this.onReset();
      event.preventDefault?.();
    } else if (key.toLowerCase() === 'j') {
      this.onGesture();
      this.onJettison();
      event.preventDefault?.();
    }
  }

  handleKeyUp(event) {
    const key = keyFor(event);
    // Releases are honored even if focus moved into a form control after keydown.
    if (KEY_ACTIONS.has(key)) {
      this.keys.delete(key);
      event.preventDefault?.();
    }
  }

  handlePointerDown(event, element, action) {
    if (event.pointerType === 'mouse' && (event.button !== 0 || event.isPrimary === false)) return;
    const pointerId = event.pointerId;
    if (pointerId == null) return;
    const firstPress = !this.pointers.has(pointerId);
    this.pointers.set(pointerId, action);
    if (firstPress) this.onGesture();
    this.refreshButtons();
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is optional and can fail after the pointer has left the element.
    }
    event.preventDefault?.();
  }

  handleCapturePointerDown(event, element) {
    if (this.isCaptureDisabled(element)) return;
    if (event.pointerType === 'mouse' && (event.button !== 0 || event.isPrimary === false)) return;
    if (event.pointerId == null) return;
    const pointerId = event.pointerId;
    this.capturePointerReleased.delete(pointerId);
    this.queueCapture(true, pointerId);
    try {
      if (pointerId != null) element.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is optional and can fail after the pointer has left the element.
    }
    event.preventDefault?.();
  }

  isCaptureDisabled(element) {
    return element?.disabled === true || element?.getAttribute?.('aria-disabled') === 'true';
  }

  queueCapture(fromGesture = false, pointerId = null) {
    this.captureQueued = true;
    if (pointerId == null) this.captureOtherQueued = true;
    else this.capturePointerOwners.add(pointerId);
    if (fromGesture) this.onGesture();
  }

  releasePointer(event) {
    if (event.pointerId == null) return;
    const pilotReleased = this.pointers.delete(event.pointerId);
    if (pilotReleased) this.refreshButtons();
    if (event.type === 'pointerup') {
      if (this.capturePointerOwners.has(event.pointerId)) this.capturePointerReleased.add(event.pointerId);
      return;
    }
    if (event.type === 'lostpointercapture' && this.capturePointerReleased.has(event.pointerId)) return;
    if (this.capturePointerOwners.delete(event.pointerId)) {
      this.capturePointerReleased.delete(event.pointerId);
      if (this.capturePointerOwners.size === 0 && !this.captureOtherQueued) this.captureQueued = false;
    }
  }

  refreshButtons() {
    this.buttons = new Set(this.pointers.values());
  }

  clear() {
    this.keys.clear();
    this.pointers.clear();
    this.buttons.clear();
    this.captureQueued = false;
    this.capturePointerOwners.clear();
    this.capturePointerReleased.clear();
    this.captureOtherQueued = false;
    this.captureGamepadSuppressed = true;
  }

  consumeCapture() {
    const queued = this.captureQueued;
    this.captureQueued = false;
    this.capturePointerOwners.clear();
    this.capturePointerReleased.clear();
    this.captureOtherQueued = false;
    return queued;
  }

  poll() {
    if (this.disposed) return { throttle: 0, brake: 0, steer: 0 };
    const pressed = (action) => this.buttons.has(action) || [...this.keys].some((key) => KEY_ACTIONS.get(key) === action);
    const gamepad = [...(this.getGamepads?.() || [])].find((pad) => pad?.connected === true && pad.mapping === 'standard');
    const axes = gamepad?.axes || [];
    const triggers = gamepad?.buttons || [];
    const captureDown = finiteClamp(triggers[0]?.value, 0, 1) >= 0.5;
    if (this.captureGamepadSuppressed) {
      if (!captureDown) this.captureGamepadSuppressed = false;
    } else if (captureDown && !this.captureGamepadWasDown) {
      this.queueCapture();
    }
    this.captureGamepadWasDown = captureDown;
    const stickX = finiteClamp(axes[0], -1, 1);
    const gamepadSteer = Math.abs(stickX) > 0.15 ? stickX : 0;
    const digitalSteer = Number(pressed('right')) - Number(pressed('left'));

    return {
      throttle: Math.max(Number(pressed('throttle')), finiteClamp(triggers[7]?.value, 0, 1)),
      brake: Math.max(Number(pressed('brake')), finiteClamp(triggers[6]?.value, 0, 1)),
      steer: digitalSteer || gamepadSteer,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener);
    for (const [element, type, listener] of this.buttonListeners) element.removeEventListener(type, listener);
    this.listeners.length = 0;
    this.buttonListeners.length = 0;
    this.disposed = true;
  }
}

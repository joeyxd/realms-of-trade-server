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
    getGamepads = () => globalThis.navigator?.getGamepads?.() || [],
  } = {}) {
    if (!root?.addEventListener || !root?.querySelectorAll) {
      throw new TypeError('NavalLabInput requires a document-like EventTarget');
    }

    this.root = root;
    this.onReset = onReset;
    this.onJettison = onJettison;
    this.getGamepads = getGamepads;
    this.keys = new Set();
    this.buttons = new Set();
    this.pointers = new Map();
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
      this.buttonListeners.push([element, listener]);
    }
  }

  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  handleKeyDown(event) {
    if (event.key === 'Escape' || event.code === 'Escape') {
      this.clear();
      event.preventDefault?.();
      return;
    }
    if (isFormTarget(event.target)) return;

    const key = keyFor(event);
    if (KEY_ACTIONS.has(key)) {
      this.keys.add(key);
      event.preventDefault?.();
      return;
    }
    if (event.repeat) return;
    if (key.toLowerCase() === 'r') {
      this.onReset();
      event.preventDefault?.();
    } else if (key.toLowerCase() === 'j') {
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
    this.pointers.set(pointerId, action);
    this.refreshButtons();
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is optional and can fail after the pointer has left the element.
    }
    event.preventDefault?.();
  }

  releasePointer(event) {
    if (event.pointerId == null || !this.pointers.delete(event.pointerId)) return;
    this.refreshButtons();
  }

  refreshButtons() {
    this.buttons = new Set(this.pointers.values());
  }

  clear() {
    this.keys.clear();
    this.pointers.clear();
    this.buttons.clear();
  }

  poll() {
    if (this.disposed) return { throttle: 0, brake: 0, steer: 0 };
    const pressed = (action) => this.buttons.has(action) || [...this.keys].some((key) => KEY_ACTIONS.get(key) === action);
    const gamepad = [...(this.getGamepads?.() || [])].find((pad) => pad?.connected === true && pad.mapping === 'standard');
    const axes = gamepad?.axes || [];
    const triggers = gamepad?.buttons || [];
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
    for (const [element, listener] of this.buttonListeners) element.removeEventListener('pointerdown', listener);
    this.listeners.length = 0;
    this.buttonListeners.length = 0;
    this.disposed = true;
  }
}

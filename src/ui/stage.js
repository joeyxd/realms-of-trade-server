// The stage (M4.6): #game, #ui and #fade live inside #stage. On a phone held upright the stage is drawn
// rotated 90° so the game is always landscape (the phone is turned counter-clockwise: the stage's top edge
// is the physical right edge). Everything that measured the window measures the stage, and pointer
// coordinates (screen frame) go through toLocal / vec. No DOM access at import time (a Node test imports this).

// Stage transform: local (lx, ly) lands on screen at (W − ly, lx), W = the physical (portrait) width.
// So a screen point maps back to the stage with:
export const rotPoint = (clientX, clientY, W) => ({ x: clientY, y: W - clientX });
// ...and a screen-space delta (dx, dy) is the stage-space delta (dy, −dx).
export const rotDelta = (dx, dy) => ({ x: dy, y: -dx });

let el = null, hooked = false, enabled = () => false, pw = 0;
const listeners = new Set();

export const stage = {
  w: 0, h: 0, // logical size in CSS px, already rotated
  rotated: false,
  // Where this pointer position is on the stage (identity while not rotated).
  toLocal(clientX, clientY) { return stage.rotated ? rotPoint(clientX, clientY, pw || innerWidth) : { x: clientX, y: clientY }; },
  // A pointer delta in the stage frame.
  vec(dx, dy) { return stage.rotated ? rotDelta(dx, dy) : { x: dx, y: dy }; },
  // enabled(): may the stage rotate right now (touch device and the setting on)?
  configure(o = {}) { if (o.enabled) enabled = o.enabled; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  update() {
    const W = innerWidth, H = innerHeight;
    const rot = !!enabled() && H > W;
    const w = rot ? H : W, h = rot ? W : H;
    const changed = w !== stage.w || h !== stage.h || rot !== stage.rotated;
    pw = W;
    stage.w = w; stage.h = h; stage.rotated = rot;
    if (!el) el = document.getElementById('stage');
    if (el) {
      el.style.width = w + 'px'; el.style.height = h + 'px';
      el.style.transformOrigin = '0 0';
      el.style.transform = rot ? `translateX(${W}px) rotate(90deg)` : '';
    }
    document.body.classList.toggle('rotated', rot);
    if (!hooked) {
      hooked = true;
      const upd = () => stage.update();
      addEventListener('resize', upd);
      // Some browsers report the old size at this point: look again once the turn settles.
      addEventListener('orientationchange', () => { upd(); setTimeout(upd, 250); });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', upd);
    }
    if (changed) for (const fn of [...listeners]) fn(stage);
  },
};

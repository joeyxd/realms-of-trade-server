// Throttles a preview animation while letting the browser align every draw to a frame.
export function createFigureLoop({
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  shouldRun,
  draw,
  maxFps = 24,
  maxDelta = 0.1,
} = {}) {
  if (typeof shouldRun !== 'function' || typeof draw !== 'function') throw new TypeError('Figure loop needs shouldRun and draw callbacks');
  if (!(maxFps > 0) || !(maxDelta > 0)) throw new RangeError('Figure loop limits must be positive');

  let frameId = null;
  let previousDraw = null;
  let disposed = false;
  const interval = 1000 / maxFps;

  const stop = () => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    previousDraw = null;
  };

  const schedule = () => {
    if (frameId === null && !disposed) frameId = requestFrame(tick);
  };

  const tick = (timestamp) => {
    frameId = null;
    if (disposed || !shouldRun()) { previousDraw = null; return; }
    const now = Number.isFinite(timestamp) ? timestamp : 0;
    if (previousDraw === null) previousDraw = now;
    else if (now - previousDraw >= interval - 1e-3) {
      const delta = Math.min(Math.max(0, (now - previousDraw) / 1000), maxDelta);
      previousDraw = now;
      draw(delta);
    }
    if (shouldRun()) schedule();
    else previousDraw = null;
  };

  return {
    sync() {
      if (disposed) return;
      if (shouldRun()) schedule(); else stop();
    },
    stop,
    dispose() { disposed = true; stop(); },
    get pending() { return frameId !== null; },
  };
}

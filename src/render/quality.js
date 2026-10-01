// Quality tiers + AUTO: measures FPS every 3 s and steps down one tier below 45 fps.
export const TIERS = ['low', 'medium', 'high'];

export function tierConfig(name) {
  const dpr = window.devicePixelRatio || 1;
  switch (name) {
    case 'low':
      return { name, pixelRatio: Math.min(dpr, 1), ss: 1, outlines: false, fxaa: false, shadow: 1024, particles: 0.5, waves: 0, occluders: true };
    case 'medium':
      return { name, pixelRatio: Math.min(dpr, 1.5), ss: 1, outlines: true, fxaa: true, shadow: 2048, particles: 1, waves: 1, occluders: true };
    default:
      return { name: 'high', pixelRatio: Math.min(dpr, 2), ss: dpr <= 1.25 ? 1.5 : 1, outlines: true, fxaa: true, shadow: 2048, particles: 1, waves: 1, occluders: true };
  }
}

export class Quality {
  constructor(apply, mode, isMobile) {
    this.apply = apply;
    this.isMobile = isMobile;
    this.setMode(mode);
  }

  setMode(mode) {
    this.mode = mode;
    const start = mode === 'auto' ? (this.isMobile ? 'medium' : 'high') : mode;
    this.set(start);
  }

  set(name) {
    this.current = name;
    this.cfg = tierConfig(name);
    this.apply(this.cfg);
    this.frames = 0;
    this.elapsed = 0;
    this.warmup = 2;
  }

  // Call once per rendered frame with real dt. measuring=false while paused/loading.
  frame(dt, measuring) {
    if (this.mode !== 'auto' || !measuring) return;
    if (this.warmup > 0) { this.warmup -= dt; return; }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 3) {
      const fps = this.frames / this.elapsed;
      this.lastFps = fps;
      this.frames = 0; this.elapsed = 0;
      const i = TIERS.indexOf(this.current);
      if (fps < 45 && i > 0) this.set(TIERS[i - 1]);
    }
  }
}

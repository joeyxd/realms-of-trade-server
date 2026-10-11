// Quality tiers + AUTO: measures FPS every 3 s and steps down one tier below 45 fps (ultra -> high -> ...).
// ink: 0 none (low) / 1 comic hatching + painted detail / 2 ultra. comic: the final pass' impact frames and speed
// lines (ultra only). outlineMul: ink line weight.
export const TIERS = ['low', 'medium', 'high', 'ultra'];

export function tierConfig(name) {
  const dpr = window.devicePixelRatio || 1;
  switch (name) {
    case 'low':
      return { name, pixelRatio: Math.min(dpr, 1), ss: 1, outlines: false, fxaa: false, shadow: 1024, particles: 0.5, waves: 0, occluders: true, lights: 4, bloom: 0, ink: 0, comic: 0, outlineMul: 1 };
    case 'medium':
      return { name, pixelRatio: Math.min(dpr, 1.5), ss: 1, outlines: true, fxaa: true, shadow: 2048, particles: 1, waves: 1, occluders: true, lights: 8, bloom: 1, ink: 1, comic: 0, outlineMul: 1 };
    case 'ultra':
      return { ...tierConfig('high'), name: 'ultra', ink: 2, comic: 1, outlineMul: 1.3 };
    default:
      return { name: 'high', pixelRatio: Math.min(dpr, 2), ss: dpr <= 1.25 ? 1.5 : 1, outlines: true, fxaa: true, shadow: 2048, particles: 1, waves: 1, occluders: true, lights: 12, bloom: 1, ink: 1, comic: 0, outlineMul: 1 };
  }
}

export class Quality {
  // gpuTier: 'weak' | 'mid' | 'strong' (gpu.js). AUTO starts phones on medium, a strong GPU on ultra, the rest on high.
  constructor(apply, mode, isMobile, gpuTier = 'mid') {
    this.apply = apply;
    this.isMobile = isMobile;
    this.gpuTier = gpuTier;
    this.setMode(mode);
  }

  setMode(mode) {
    this.mode = mode;
    const start = mode === 'auto' ? (this.isMobile ? 'medium' : this.gpuTier === 'strong' ? 'ultra' : 'high') : mode;
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

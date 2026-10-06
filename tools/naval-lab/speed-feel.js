const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));

/** Presentation only. Neither camera motion nor screen accents feed the simulation. */
export class NavalSpeedFeel {
  constructor(element, { mobile = false, reducedMotion = false } = {}) {
    this.element = element; this.mobile = mobile; this.reducedMotion = reducedMotion;
    this.phase = 0; this.fov = 35; this.roll = 0; this.intensity = 0;
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('viewBox', '0 0 1000 1000');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('aria-hidden', 'true'); this.svg.classList.add('speed-ink');
    this.lines = [];
    const count = mobile ? 12 : 20;
    for (let i = 0; i < count; i++) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('fill', '#fff4cb'); path.setAttribute('stroke', '#102536');
      path.setAttribute('stroke-width', '1.5'); path.setAttribute('vector-effect', 'non-scaling-stroke');
      this.svg.append(path); this.lines.push(path);
    }
    element.prepend(this.svg);
  }

  update(dt, { speed = 0, omega = 0, boosting = false, enabled = true, paused = false } = {}) {
    const step = paused ? 0 : clamp(dt, 0, 0.1);
    const active = enabled && !this.reducedMotion;
    const fast = clamp((speed - 6) / 6, 0, 1);
    const goal = active ? (boosting ? 0.7 : fast * 0.22) : 0;
    const k = 1 - Math.exp(-step * 9);
    // Opt-out removes accents immediately, including when the lab is paused.
    this.intensity = active ? this.intensity + (goal - this.intensity) * k : 0;
    this.fov += ((active ? 35 + fast * 3 + (boosting ? 3 : 0) : 35) - this.fov) * k;
    this.roll += ((active ? clamp(omega * speed * 0.003, -0.025, 0.025) : 0) - this.roll) * k;
    if (!active) { this.fov = 35; this.roll = 0; }
    this.phase += step * (boosting ? 2.8 : 1.6);
    this.svg.style.opacity = this.intensity.toFixed(3);
    this.svg.style.visibility = this.intensity > 0.008 ? 'visible' : 'hidden';
    for (let i = 0; i < this.lines.length; i++) {
      const angle = (i + 0.3) / this.lines.length * Math.PI * 2;
      const p = (this.phase + i * 0.6180339) % 1;
      const reach = 315 + p * 240;
      // The central ship and its aiming space always remain free of ink.
      const length = 45 + p * (boosting ? 200 : 90);
      const c = Math.cos(angle), s = Math.sin(angle), width = boosting ? 4.6 : 1.6;
      const x = 500 + c * reach, y = 500 + s * reach;
      this.lines[i].setAttribute('d', `M${x - s * width},${y + c * width} L${x + c * length},${y + s * length} L${x + s * width},${y - c * width}Z`);
    }
    return { fov: this.fov, roll: this.roll };
  }

  reset() { this.phase = 0; this.fov = 35; this.roll = 0; this.intensity = 0; this.svg.style.opacity = '0'; }
  diagnostics() { return { lines: this.lines.length, intensity: this.intensity, fov: this.fov, roll: this.roll, reducedMotion: this.reducedMotion }; }
  dispose() { this.svg.remove(); this.lines.length = 0; }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));

// Fixed anchors converge toward (500, 450). The safe rectangle x=300..700,
// y=140..800 reserves room for the full sail, raft, and forward aim.
const EDGE_INK = [
  [0, 34, 0], [0, 116, 1], [0, 203, 0], [0, 298, 1], [0, 401, 0],
  [0, 512, 1], [0, 624, 0], [0, 731, 1], [0, 842, 0], [0, 956, 1],
  [1, 44, 1], [1, 132, 0], [1, 227, 1], [1, 334, 0], [1, 447, 1],
  [1, 563, 0], [1, 671, 1], [1, 779, 0], [1, 887, 1], [1, 972, 0],
  [2, 32, 0], [2, 141, 1], [2, 252, 0], [2, 363, 1], [2, 474, 0],
  [2, 585, 1], [2, 696, 0], [2, 807, 1], [2, 918, 0], [2, 972, 1],
  [3, 28, 1], [3, 137, 0], [3, 248, 1], [3, 359, 0], [3, 470, 1],
  [3, 581, 0], [3, 692, 1], [3, 803, 0], [3, 914, 1], [3, 968, 0],
];

function inkPath([edge, at, heavy], index, fast, boosting, phase) {
  const vanishing = [500, 450];
  const anchor = edge === 0 ? [0, at] : edge === 1 ? [1000, at]
    : edge === 2 ? [at, 0] : [at, 1000];
  const dx = anchor[0] - vanishing[0], dy = anchor[1] - vanishing[1];
  const safe = [];
  for (const x of [300, 700]) {
    const t = (x - vanishing[0]) / dx;
    const y = vanishing[1] + t * dy;
    if (t > 0 && t < 1 && y >= 140 && y <= 800) safe.push(t);
  }
  for (const y of [140, 800]) {
    const t = (y - vanishing[1]) / dy;
    const x = vanishing[0] + t * dx;
    if (t > 0 && t < 1 && x >= 300 && x <= 700) safe.push(t);
  }
  const safeT = Math.min(...safe);
  const wave = Math.sin(phase * 2.1 + index * 1.73) * 0.012;
  const reach = fast * 0.22 + (boosting ? 0.50 : 0);
  const nearT = Math.max(safeT + 0.085, 0.95 - reach + wave);
  const outerT = 0.995;
  const point = (t) => [vanishing[0] + dx * t, vanishing[1] + dy * t];
  const near = point(nearT), outer = point(outerT);
  const length = Math.hypot(dx, dy);
  const normal = [-dy / length, dx / length];
  const width = (heavy ? 4.8 : 1.25) * (boosting ? 1.08 : 1);
  const outerWidth = width * (heavy ? 0.58 : 0.38);
  const nearWidth = width * (heavy ? 0.1 : 0.04);
  const nudge = (heavy ? 0.8 : 0.35) * (index % 2 ? 1 : -1);
  const coords = [
    [outer[0] + normal[0] * outerWidth, outer[1] + normal[1] * outerWidth],
    [near[0] + normal[0] * nearWidth, near[1] + normal[1] * nearWidth],
    [near[0] - normal[0] * nearWidth + normal[0] * nudge, near[1] - normal[1] * nearWidth + normal[1] * nudge],
    [outer[0] - normal[0] * outerWidth * 0.7, outer[1] - normal[1] * outerWidth * 0.7],
  ];
  return `M${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}Z`;
}

/** Presentation only. Neither camera motion nor screen accents feed the simulation. */
export class NavalSpeedFeel {
  constructor(element, { mobile = false, reducedMotion = false } = {}) {
    this.element = element; this.mobile = mobile; this.reducedMotion = reducedMotion;
    this.phase = 0; this.fov = 35; this.roll = 0; this.intensity = 0; this.boosting = false;
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('viewBox', '0 0 1000 1000');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('aria-hidden', 'true'); this.svg.classList.add('speed-ink');
    this.lines = [];
    const count = mobile ? 24 : 40;
    const mobileSlots = [0, 2, 4, 5, 7, 9];
    this.layout = mobile
      ? [0, 1, 2, 3].flatMap((edge) => mobileSlots.map((slot) => EDGE_INK[edge * 10 + slot]))
      : EDGE_INK;
    for (let i = 0; i < count; i++) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('fill', '#080f13');
      path.setAttribute('data-edge', String(this.layout[i][0]));
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
    if (!paused) {
      this.phase += step * (boosting ? 2.8 : 1.6);
      this.boosting = boosting;
    }
    this.svg.style.opacity = this.intensity.toFixed(3);
    this.svg.style.visibility = this.intensity > 0.008 ? 'visible' : 'hidden';
    if (!paused) {
      for (let i = 0; i < this.lines.length; i++) {
        this.lines[i].setAttribute('d', inkPath(this.layout[i], i, fast, boosting, this.phase));
      }
    }
    return { fov: this.fov, roll: this.roll };
  }

  reset() {
    this.phase = 0; this.fov = 35; this.roll = 0; this.intensity = 0; this.boosting = false;
    this.svg.style.opacity = '0'; this.svg.style.visibility = 'hidden';
    for (const line of this.lines) line.setAttribute('d', '');
  }
  diagnostics() { return { lines: this.lines.length, intensity: this.intensity, fov: this.fov, roll: this.roll, reducedMotion: this.reducedMotion }; }
  dispose() { this.svg.remove(); this.lines.length = 0; }
}

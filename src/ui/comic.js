// Comic hits (M4.7 P1, Ultra tier only): the ink-and-paper impact frame and speed lines of the final pass
// (pipeline.impact) and onomatopoeia popping over the action (a pooled worldUI float, class `ono`).
// One singleton: main.js configures it, ui/feedback.js (and later the skills' VFX) call comic.hit(). Cosmetic only.
import * as THREE from 'three';

const v = new THREE.Vector3();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LIFE = 0.75;      // s: pop 0.12 (css) + hold ~0.35 + fade ~0.22 (worldUI fades the last 30 %)
const MIN_GAP = 0.25;   // s between words (big ones are exempt: they are the rare, important ones)
const MAX_ALIVE = 3;

// A jagged 14-point starburst (alternating long and short spikes, a little irregular) as an SVG polygon.
function burst() {
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
    const r = i % 2 ? 26 + Math.random() * 10 : 47 + Math.random() * 7;
    pts.push((Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1));
  }
  return `<svg class="ono-burst" viewBox="-60 -60 120 120" preserveAspectRatio="none" aria-hidden="true"><polygon points="${pts.join(' ')}"/></svg>`;
}

class Comic {
  constructor() {
    this.cfg = null;
    this.lastWord = -1e9;
    this.alive = []; // expiry times (performance.now) of the words on screen
  }

  // { pipeline, camera, worldUI, settings, isOn: () => boolean }
  configure(cfg) { this.cfg = cfg; }

  get on() { return !!(this.cfg && this.cfg.isOn()); }

  // A hit at a world point. color: the impact frame's tint (hex or THREE.Color); word: the onomatopoeia («¡ZAS!»);
  // big: a starburst behind it, in red-orange; frame: the impact frame (not with reduced motion); lines: speed lines
  // (half strength with reduced motion).
  hit(x, y, z, { color = 0xffffff, word, big = false, frame = false, lines = false } = {}) {
    if (!this.on) return;
    const { pipeline, camera, worldUI, settings } = this.cfg;
    const red = !!settings.reducedMotion;
    const wantFrame = frame && !red, wantLines = lines ? (red ? 0.5 : 1) : 0;
    if (wantFrame || wantLines > 0) {
      v.set(x, y, z).project(camera);
      if (v.z < 1 && v.z > -1) pipeline.impact(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, color, { frame: wantFrame, lines: wantLines });
    }
    if (word) this.word(worldUI, x, y, z, word, big);
  }

  word(worldUI, x, y, z, word, big) {
    const now = performance.now();
    this.alive = this.alive.filter((t) => t > now);
    if (this.alive.length >= MAX_ALIVE) return;
    if (!big && now - this.lastWord < MIN_GAP * 1000) return;
    this.lastWord = now;
    this.alive.push(now + LIFE * 1000);
    // The float's own element is moved by JS (`transform`), so the tilt and the pop live on an inner span (an individual
    // `rotate` / `scale` on the outer one would turn and scale its screen position about the origin).
    const tilt = ((Math.random() * 2 - 1) * 8).toFixed(1);
    worldUI.float(x, y, z, `<span class="ono-in" style="rotate:${tilt}deg">${big ? burst() : ''}<span class="ono-w">${esc(word)}</span></span>`, big ? 'ono big' : 'ono', { life: LIFE, rise: big ? 30 : 22, spread: 24 });
  }
}

export const comic = new Comic();

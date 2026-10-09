// The island map (M4, M): drawn once from the heightmap in the camera's frame (u up, v right: north-west is
// up, like on screen), with the zones, the people, the racks, the arena and your quest's goal; you and your
// crew on top, every frame while it is open.
import { gsap } from 'gsap';
import { ZONES, toUV } from '../sim/worldgen.js';
import { QUESTS, QUEST_IDS, QST } from '../data/quests.js';

const SPAN = 185; // u and v from -SPAN to +SPAN
const RES = 320;

export class MapView {
  constructor(root, map) {
    this.root = root; this.map = map; this.span = map.mapSpan || SPAN;
    this.isOpen = false;
    this.base = null;
    root.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === root) this.close(); });
  }

  // World (x, z) → map pixels (of a size × size canvas).
  px(x, z, size) {
    const SPAN = this.span;
    const { u, v } = toUV(x, z);
    return [((v + SPAN) / (2 * SPAN)) * size, ((SPAN - u) / (2 * SPAN)) * size];
  }

  build() {
    const SPAN = this.span;
    const m = this.map, c = document.createElement('canvas');
    c.width = c.height = RES;
    const ctx = c.getContext('2d'), img = ctx.createImageData(RES, RES), d = img.data;
    const S = Math.SQRT1_2;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const v = (i / RES) * 2 * SPAN - SPAN, u = SPAN - (j / RES) * 2 * SPAN;
        const x = -S * u + S * v, z = -S * u - S * v;
        const h = m.groundAt(x, z);
        let r, g, b;
        if (h < -0.05 && !m.onDock(x, z)) {
          const k = Math.max(0, Math.min(1, -h / 6));
          r = 40 - 22 * k; g = 170 - 110 * k; b = 190 - 70 * k;
        } else {
          const mk = m.masks(x, z);
          if (m.onDock(x, z)) { r = 138; g = 92; b = 52; }
          else if (mk.lava > 0.5) { r = 255; g = 110; b = 40; }
          else if (mk.arenaFloor > 0.5) { r = 104; g = 88; b = 80; }
          else if (mk.volcanic > 0.5) { r = 78 + h * 0.6; g = 70 + h * 0.5; b = 68 + h * 0.5; }
          else if (mk.path > 0.5) { r = 190; g = 145; b = 95; }
          else if (h < 1.5) { r = 236; g = 214; b = 156; }
          else { const k = Math.min(1, (h - 1.5) / 18); r = 95 - 30 * k; g = 172 - 40 * k; b = 90 - 20 * k; }
          // Hill shade, lit from the top-left of the map.
          const e = 1.5, dx = m.groundAt(x - S * e, z - S * e) - m.groundAt(x + S * e, z + S * e);
          const sh = Math.max(-0.35, Math.min(0.35, dx * 0.08));
          r *= 1 + sh; g *= 1 + sh; b *= 1 + sh;
        }
        const o = (j * RES + i) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
  }

  open() {
    const SPAN = this.span;
    if (!this.base) this.build();
    this.root.innerHTML = `<div class="mapv frame interactive" role="dialog" aria-label="Mapa">
      <div class="mapv-head"><b class="outlined">Isla de la Caldera</b><button class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
      <div class="mapv-body"><canvas width="640" height="640"></canvas><div class="mapv-labels"></div></div>
      <div class="mapv-legend"><span class="me">Tú</span><span class="crew">Tripulación</span><span class="npc">Gente</span><span class="goal">Objetivo</span><span class="law">Sin ley</span></div></div>`;
    this.canvas = this.root.querySelector('canvas');
    this.labels = this.root.querySelector('.mapv-labels');
    const L = this.map.landmarks, names = [['playa', L.spawn], ['aldea', L.village], ['camino', L.path[Math.floor(L.path.length / 2)]], ['caldera', L.arena]];
    if (this.map.cala) names.push(['calavera', this.map.cala]);
    this.labels.innerHTML = names.map(([k, p]) => {
      let [a, b] = this.px(p.x, p.z, 100);
      if (ZONES[k].lawless) b += ((p.r + 1.5) / (2 * SPAN)) * 100; // under its ring (the Sendero's name sits beside it)
      return `<span class="${ZONES[k].lawless ? 'lawless' : ''}" style="left:${a}%;top:${b}%">${ZONES[k].lawless ? '☠ ' : ''}${ZONES[k].name}</span>`; }).join('');
    this.root.hidden = false;
    this.isOpen = true;
    gsap.fromTo(this.root.querySelector('.mapv'), { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' });
  }
  close() { this.isOpen = false; this.root.hidden = true; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // Where the first active quest wants you (for the goal marker).
  goal(profile, npcs) {
    if (!profile) return null;
    const L = this.map.landmarks;
    for (const id of QUEST_IDS) {
      const q = profile.quests[id];
      if (!q || (q[0] !== QST.ACTIVE && q[0] !== QST.READY)) continue;
      const Q = QUESTS[id], g = Q.goal;
      if (q[0] === QST.READY) return npcs[Q.turnin];
      if (g.kind === 'zone') return g.zone === 'aldea' ? L.village : L.arena;
      if (g.kind === 'talk') return npcs[g.npc];
      if (g.kind === 'kill' && g.enemy && g.enemy.includes('archer')) return L.path[Math.floor(L.path.length * 0.6)];
      if (g.kind === 'kill' && g.enemy && g.enemy.includes('sentinel')) return L.path[L.path.length - 2];
      return L.arena;
    }
    return null;
  }

  // ps: you {x, z, f}; crew: [{x, z}]; profile: for the goal.
  update(ps, crew, profile, time) {
    const SPAN = this.span;
    if (!this.isOpen || !this.canvas) return;
    const c = this.canvas, ctx = c.getContext('2d'), W = c.width, m = this.map;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, W, W);
    const P = (x, z) => this.px(x, z, W);
    const npcs = {};
    for (const n of m.npcs) npcs[n.id] = n;
    const dot = (x, z, r, fill, stroke = '#1a1033', lw = 2) => { const [a, b] = P(x, z); ctx.beginPath(); ctx.arc(a, b, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); };
    // The rune circle, the racks, the dock and the ship.
    const A = m.landmarks.arena;
    { const [a, b] = P(A.x, A.z); ctx.beginPath(); ctx.arc(a, b, (m.landmarks.arenaR / (2 * SPAN)) * W, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,140,60,0.9)'; ctx.lineWidth = 3; ctx.stroke(); }
    // La Cala Calavera (M4.5): no law inside the red ring.
    if (m.cala) {
      const K = m.cala, [a, b] = P(K.x, K.z), r = (K.r / (2 * SPAN)) * W;
      ctx.beginPath(); ctx.arc(a, b, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,30,30,${0.18 + 0.06 * Math.sin(time * 3)})`; ctx.fill();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(255,60,50,0.95)'; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f2ead6'; ctx.fillText('☠', a, b);
    }
    for (const k of m.racks) dot(k.x, k.z, 4, '#c9a44c');
    dot(m.landmarks.ship.x, m.landmarks.ship.z, 6, '#8a5a2e');
    for (const n of m.npcs) dot(n.x, n.z, 6, '#ffe39a');
    // The goal pulses.
    const g = this.goal(profile, npcs);
    if (g) { const k = 0.5 + 0.5 * Math.sin(time * 5); dot(g.x, g.z, 9 + k * 4, 'rgba(255,207,74,0.25)', '#ffcf4a', 2.5); }
    for (const p of crew) dot(p.x, p.z, 5, '#9dffc8');
    // What you dropped when you fell in the Cala, while it is still there.
    if (this.spill) {
      const [a, b] = P(this.spill.x, this.spill.z), k = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.beginPath(); ctx.arc(a, b, 10 + k * 4, 0, Math.PI * 2); ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💀', a, b);
    }
    // You: an arrow the way you face (in the map's frame).
    const [a, b] = P(ps.x, ps.z), fx = Math.sin(ps.f), fz = Math.cos(ps.f), S = Math.SQRT1_2;
    const du = -S * fx - S * fz, dv = S * fx - S * fz, ang = Math.atan2(-du, dv);
    ctx.save(); ctx.translate(a, b); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath();
    ctx.fillStyle = '#3bf0ff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#1a1033'; ctx.stroke();
    ctx.restore();
  }
}

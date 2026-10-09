// The overview and local chart share active-world geometry, projection and markers.
import { gsap } from 'gsap';
import { describeMap, projectMap } from './cartography.js';
import { mapAtlas, drawMapRegions, drawChartMarkers, drawPlayer } from './mapCanvas.js';
import { QUESTS, QUEST_IDS, QST } from '../data/quests.js';

export class MapView {
  constructor(root, map) {
    this.root = root; this.isOpen = false; this.setMap(map);
    root.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === root) this.close(); });
  }

  setMap(map) {
    this.map = map; this.description = describeMap(map); this.span = this.description.frame.span;
    this.base = null; this.atlas = null;
    if (this.isOpen) this.build();
  }

  px(x, z, size) { return projectMap(this.description.frame, x, z, size); }

  build() {
    this.atlas = mapAtlas(this.map, this.root.ownerDocument); this.base = this.atlas.base;
    this.description = this.atlas.description; this.span = this.description.frame.span;
    if (this.labels) this.buildLabels();
  }

  buildLabels() {
    this.root.querySelector('.mapv-title').textContent = this.description.title;
    this.labels.replaceChildren();
    for (const p of this.description.points) {
      if (['npc', 'rack', 'ship'].includes(p.kind)) continue;
      const pos = this.px(p.x, p.z, 100);
      if (!pos || pos.some(n => n < 0 || n > 100)) continue;
      const label = this.root.ownerDocument.createElement('span');
      label.textContent = p.name; label.className = p.kind === 'danger' ? 'lawless' : '';
      label.style.left = `${pos[0]}%`; label.style.top = `${pos[1]}%`;
      this.labels.appendChild(label);
    }
  }

  open() {
    this.root.innerHTML = `<div class="mapv frame interactive" role="dialog" aria-label="Mapa">
      <div class="mapv-head"><b class="mapv-title outlined"></b><button class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
      <div class="mapv-body"><canvas width="640" height="640"></canvas><div class="mapv-labels"></div></div>
      <div class="mapv-legend"><span class="me">Tú</span><span class="crew">Compañeros</span><span class="npc">Lugares</span><span class="ship">Balsas</span><span class="goal">Destino</span><span class="law">Sin ley</span></div></div>`;
    this.canvas = this.root.querySelector('canvas'); this.labels = this.root.querySelector('.mapv-labels');
    this.build(); this.root.hidden = false; this.isOpen = true;
    gsap.fromTo(this.root.querySelector('.mapv'), { scale: .9, opacity: 0 }, { scale: 1, opacity: 1, duration: .3, ease: 'back.out(2)' });
  }

  close() { this.isOpen = false; this.root.hidden = true; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // Legacy quest targets remain an adapter for present content; new map data may omit these anchors.
  goal(profile, npcs = Object.fromEntries((this.map.npcs || []).map(p => [p.id, p]))) {
    if (!profile) return null;
    const L = this.map.landmarks || {}, path = L.path || [];
    for (const id of QUEST_IDS) {
      const q = profile.quests?.[id];
      if (!q || (q[0] !== QST.ACTIVE && q[0] !== QST.READY)) continue;
      const Q = QUESTS[id], g = Q.goal;
      if (q[0] === QST.READY) return npcs[Q.turnin] || null;
      if (g.kind === 'zone') return (g.zone === 'aldea' ? L.village : L.arena) || null;
      if (g.kind === 'talk') return npcs[g.npc] || null;
      if (g.kind === 'kill' && g.enemy?.includes('archer')) return path[Math.floor(path.length * .6)] || null;
      if (g.kind === 'kill' && g.enemy?.includes('sentinel')) return path[path.length - 2] || null;
      return L.arena || null;
    }
    return null;
  }

  update(ps, crew, profile, time, markers = {}) {
    if (!this.isOpen || !this.canvas) return;
    const atlas = mapAtlas(this.map, this.root.ownerDocument);
    if (atlas !== this.atlas) this.build();
    const c = this.canvas, ctx = c.getContext('2d'), W = c.width;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(this.base, 0, 0, W, W);
    const project = (x, z) => this.px(x, z, W);
    drawMapRegions(ctx, this.description, project, W / (2 * this.span));
    drawChartMarkers(ctx, this.description, project, { goal: this.goal(profile), spill: this.spill, ...markers, crew });
    drawPlayer(ctx, project, ps);
  }
}

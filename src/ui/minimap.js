// Local chart reads the same terrain and known markers as the full map; it grants no gameplay knowledge.
import { mapAtlas, atlasProjection, drawMapRegions, drawChartMarkers, drawPlayer, MAP_COLORS } from './mapCanvas.js';
import { mapDirection } from './cartography.js';

const SIZE = 192;
export class MiniMap {
  constructor(parent, map, { isTouch = false, onOpen = () => {} } = {}) {
    this.map = map; this.elapsed = 1; this.disposed = false; this.range = isTouch ? 65 : 80;
    this.root = parent.ownerDocument.createElement('button'); this.root.type = 'button';
    this.root.className = `world-minimap ${isTouch ? 'is-touch' : 'is-desktop'}`;
    this.root.setAttribute('aria-label', 'Minimapa · abrir mapa del mundo'); this.root.title = 'Abrir mapa (M)';
    this.root.innerHTML = `<canvas width="${SIZE}" height="${SIZE}" aria-hidden="true"></canvas><span class="minimap-cardinals" aria-hidden="true"></span><b class="minimap-caption">MAPA</b>`;
    this.root.addEventListener('click', onOpen); this.canvas = this.root.querySelector('canvas');
    this.caption = this.root.querySelector('.minimap-caption');
    const rose = this.root.querySelector('.minimap-cardinals');
    for (const [name, facing] of [['N', Math.PI], ['E', Math.PI / 2], ['S', 0], ['O', -Math.PI / 2]]) {
      const span = parent.ownerDocument.createElement('span'), angle = mapDirection(facing);
      span.textContent = name; span.style.left = `${50 + 54 * Math.cos(angle)}%`; span.style.top = `${50 + 54 * Math.sin(angle)}%`;
      rose.appendChild(span);
    }
    parent.appendChild(this.root);
  }

  setMap(map) { this.map = map; this.elapsed = 1; }

  update(dt, player, markers = {}) {
    if (this.disposed || !Number.isFinite(player?.x) || !Number.isFinite(player?.z)) return;
    this.elapsed += Math.max(0, Number(dt) || 0);
    if (this.elapsed < .1) return; this.elapsed = 0;
    const atlas = mapAtlas(this.map, this.root.ownerDocument), origin = atlasProjection(atlas, SIZE)(player.x, player.z);
    const ctx = this.canvas.getContext('2d'), scale = SIZE / (2 * this.range);
    const fullScale = SIZE / (2 * atlas.description.frame.span), magnification = scale / fullScale;
    const project = (x, z) => {
      const p = atlasProjection(atlas, SIZE)(x, z); return p && [SIZE / 2 + (p[0] - origin[0]) * magnification, SIZE / 2 + (p[1] - origin[1]) * magnification];
    };
    ctx.clearRect(0, 0, SIZE, SIZE); ctx.save(); ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = MAP_COLORS.sea; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(atlas.base, SIZE / 2 - origin[0] * magnification, SIZE / 2 - origin[1] * magnification, SIZE * magnification, SIZE * magnification);
    ctx.fillStyle = '#071e253d'; ctx.fillRect(0, 0, SIZE, SIZE);
    drawMapRegions(ctx, atlas.description, project, scale); drawChartMarkers(ctx, atlas.description, project, markers, true);
    // A real destination beyond local range remains a distinct ring at the rim.
    if (markers.target) {
      const p = project(markers.target.x, markers.target.z), dx = p?.[0] - SIZE / 2, dy = p?.[1] - SIZE / 2;
      const distance = Math.hypot(dx, dy), edge = SIZE / 2 - 10;
      if (distance > edge) {
        ctx.beginPath(); ctx.arc(SIZE / 2 + dx / distance * edge, SIZE / 2 + dy / distance * edge, 5, 0, Math.PI * 2);
        ctx.strokeStyle = MAP_COLORS.goal; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    drawPlayer(ctx, project, player, 10); ctx.restore();
    this.caption.textContent = markers.target?.label || atlas.description.title;
    this.root.dataset.revision = atlas.description.revision;
    this.root.dataset.x = player.x.toFixed(2); this.root.dataset.z = player.z.toFixed(2);
  }

  dispose() { this.disposed = true; this.root.remove(); }
}

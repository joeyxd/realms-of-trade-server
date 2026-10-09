// Shared terrain atlas and marker drawing for the local chart and the overview.
import { describeMap, projectMap, unprojectMap, mapDirection } from './cartography.js';

const atlases = new WeakMap();
export const MAP_COLORS = Object.freeze({ sea: '#123f5d', me: '#b5fff5', crew: '#9dffc8', npc: '#ffe39a',
  town: '#e6be68', spawn: '#e6be68', route: '#c8ba8d', rack: '#c9a44c', ship: '#bd9671', danger: '#ff7466',
  arena: '#ff9c51', goal: '#ffcf4a' });
const SIZE = 640;
const positive = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export function terrainColor(map, x, z) {
  const h = map.groundAt(x, z), dock = !!map.onDock?.(x, z);
  let r, g, b;
  if (!Number.isFinite(h) || (h < -0.05 && !dock)) {
    const k = Number.isFinite(h) ? positive(-h / 6) : 1;
    r = 40 - 22 * k; g = 170 - 110 * k; b = 190 - 70 * k;
  } else {
    const m = map.masks?.(x, z) || {};
    if (dock) { r = 138; g = 92; b = 52; }
    else if (m.lava > .5) { r = 255; g = 110; b = 40; }
    else if (m.arenaFloor > .5) { r = 104; g = 88; b = 80; }
    else if (m.volcanic > .5) { r = 78 + h * .6; g = 70 + h * .5; b = 68 + h * .5; }
    else if (m.path > .5) { r = 190; g = 145; b = 95; }
    else if (h < 1.5) { r = 236; g = 214; b = 156; }
    else { const k = positive((h - 1.5) / 18); r = 95 - 30 * k; g = 172 - 40 * k; b = 90 - 20 * k; }
    const S = Math.SQRT1_2, e = 1.5;
    const slope = map.groundAt(x - S * e, z - S * e) - map.groundAt(x + S * e, z + S * e);
    const shade = Number.isFinite(slope) ? 1 + Math.max(-.35, Math.min(.35, slope * .08)) : 1;
    r *= shade; g *= shade; b *= shade;
  }
  return [r, g, b, 255];
}

export function mapAtlas(map, document) {
  const description = describeMap(map);
  const signature = JSON.stringify([description, map.terrainRevision]);
  const cached = atlases.get(map);
  if (cached?.signature === signature && cached.groundAt === map.groundAt && cached.masks === map.masks && cached.onDock === map.onDock) return cached;
  const base = document.createElement('canvas'); base.width = base.height = SIZE;
  const ctx = base.getContext('2d'), img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = unprojectMap(description.frame, x + .5, y + .5, SIZE);
    img.data.set(terrainColor(map, p.x, p.z), (y * SIZE + x) * 4);
  }
  ctx.putImageData(img, 0, 0);
  const atlas = { signature, description, base, groundAt: map.groundAt, masks: map.masks, onDock: map.onDock };
  atlases.set(map, atlas); return atlas;
}

export function marker(ctx, project, p, radius, color, ring = false) {
  const q = p && project(p.x, p.z); if (!q) return;
  ctx.beginPath(); ctx.arc(q[0], q[1], radius, 0, Math.PI * 2);
  ctx.lineWidth = 1.5; ctx.strokeStyle = ring ? color : '#10252e';
  if (!ring) { ctx.fillStyle = color; ctx.fill(); }
  ctx.stroke();
}

export function drawMapRegions(ctx, description, project, scale) {
  for (const region of description.regions) {
    const q = project(region.x, region.z); if (!q) continue;
    ctx.beginPath(); ctx.arc(q[0], q[1], region.r * scale, 0, Math.PI * 2);
    ctx.fillStyle = region.kind === 'danger' ? '#c81e1e28' : '#ff8c3c12'; ctx.fill();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = MAP_COLORS[region.kind]; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
  }
}

export function drawPlayer(ctx, project, player, radius = 10) {
  const p = player && project(player.x, player.z); if (!p) return;
  ctx.save(); ctx.translate(...p); ctx.rotate(mapDirection(player.f ?? player.yaw ?? 0) || 0);
  ctx.beginPath(); ctx.moveTo(radius, 0); ctx.lineTo(-radius * .65, -radius * .65);
  ctx.lineTo(-radius * .25, 0); ctx.lineTo(-radius * .65, radius * .65); ctx.closePath();
  ctx.fillStyle = MAP_COLORS.me; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#10252e'; ctx.stroke(); ctx.restore();
}

export function drawChartMarkers(ctx, description, project, { crew = [], rafts = [], goal, spill, target } = {}, small = false) {
  for (const p of description.points) marker(ctx, project, p, small ? 2.5 : p.kind === 'town' ? 6 : 4, MAP_COLORS[p.kind] || MAP_COLORS.town);
  for (const p of rafts) marker(ctx, project, p, small ? 3 : 5, MAP_COLORS.ship);
  for (const p of crew) marker(ctx, project, p, small ? 3 : 5, MAP_COLORS.crew);
  if (goal) marker(ctx, project, goal, small ? 5 : 11, MAP_COLORS.goal, true);
  if (target) { marker(ctx, project, target, small ? 5 : 9, MAP_COLORS.goal, true); marker(ctx, project, target, 2, MAP_COLORS.goal); }
  if (spill) { marker(ctx, project, spill, small ? 5 : 10, MAP_COLORS.danger, true); marker(ctx, project, spill, 2, MAP_COLORS.danger); }
}

export const atlasProjection = (atlas, size) => (x, z) => projectMap(atlas.description.frame, x, z, size);

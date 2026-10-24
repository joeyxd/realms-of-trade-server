// GM11a (docs/briefs/gm11-world-growth-zones.md Z1): what one world costs to load at once, against the single-load
// budget a phone holds. Pure module: no DOM and no node: imports; the editor panel, publicationValidation.js and the
// server's preparation (through validateGmPublication) share it, so client and server refuse with the same code.
import { TERRAIN_DOMAINS, TILE_SIZE, isTerrainTilesDocument } from './terrainTiles.js';

// Joi, 2026-10-24: 1,000,000 terrain vertices (about a 980 m square at 1 m cells), a warning from 70 %, publication
// refused above 100 %. Raw tile bytes and added objects are measured against their own budget; the largest share wins.
// objects: publicationValidation.js MAX_PUBLICATION_EDITS (that module imports this one) until GM09 measures more.
export const WORLD_LOAD_LIMITS = Object.freeze({ vertices: 1_000_000, tileBytes: 8 * 1024 * 1024, objects: 1000 });
export const WORLD_LOAD_NEAR = 0.7;
export const WORLD_OVER_LOAD_BUDGET = 'world_over_load_budget';
// GPU bytes of the terrain mesh (src/render/terrain.js): position 12, normal 12, aMask 16 and aPaint 4 per vertex,
// six Uint32 indices per cell.
const VERTEX_BYTES = 44, CELL_INDEX_BYTES = 24;
const LEVELS = Object.freeze({ ok: 0, near: 1, over: 2 });

/**
 * The load of `document` over `domain` ({ minX, maxX, minZ, maxZ, cell }, terrainTiles.js TERRAIN_DOMAINS). Returns
 * { tiles, vertices, gpuBytes, tileBytes, objects, limits, shares: { vertices, tileBytes, objects }, share, binding, level }:
 * `share` is the largest of the three shares and `binding` names it; level is ok under 70 %, near from 70 %, over
 * above 100 % (exactly 100 % still fits, so a 1,000-edit document stays publishable as edit_limit allows).
 */
export function worldLoadBudget(domain, document, limits = WORLD_LOAD_LIMITS) {
  const columns = Math.round((domain.maxX - domain.minX) / domain.cell), rows = Math.round((domain.maxZ - domain.minZ) / domain.cell);
  const vertices = (columns + 1) * (rows + 1);
  const tiles = (Math.floor((domain.maxX - 1) / TILE_SIZE) - Math.floor(domain.minX / TILE_SIZE) + 1) *
    (Math.floor((domain.maxZ - 1) / TILE_SIZE) - Math.floor(domain.minZ / TILE_SIZE) + 1);
  let tileBytes = 0;
  if (isTerrainTilesDocument(document)) for (const entry of document.terrain?.tiles || []) tileBytes += entry[3];
  const objects = document?.objects?.length || 0;
  const shares = { vertices: vertices / limits.vertices, tileBytes: tileBytes / limits.tileBytes, objects: objects / limits.objects };
  let binding = 'vertices';
  for (const key of ['tileBytes', 'objects']) if (shares[key] > shares[binding]) binding = key;
  const share = shares[binding];
  return { tiles, vertices, gpuBytes: vertices * VERTEX_BYTES + columns * rows * CELL_INDEX_BYTES, tileBytes, objects,
    limits, shares, share, binding, level: share > 1 ? 'over' : share >= WORLD_LOAD_NEAR ? 'near' : 'ok' };
}

/** The base revision's tile domain; a base without one (older test maps) loads its own generated square. */
export function worldLoadDomain(map, baseRevision) {
  if (Object.hasOwn(TERRAIN_DOMAINS, baseRevision)) return TERRAIN_DOMAINS[baseRevision];
  return { minX: -map.half, maxX: map.half, minZ: -map.half, maxZ: map.half, cell: 1 / (map.res || 1) };
}

/** The share as a whole percent for the GM; an over world never reads 100 % (1,001 objects of 1,000 is 101 %). */
export function worldLoadPercent(budget) {
  const pct = Math.round(budget.share * 100);
  return budget.level === 'over' ? Math.max(101, pct) : Math.min(100, pct);
}

/** 0 ok, 1 near, 2 over: the editor warns when a commit raises it. */
export function worldLoadRank(level) { return LEVELS[level] ?? 0; }

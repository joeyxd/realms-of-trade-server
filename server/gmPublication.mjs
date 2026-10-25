import { createHash } from 'node:crypto';
import { compileTileTerrainForMap, validateGmPublication } from '../src/editor/publicationValidation.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { canonicalJson, PREPARATION_SCHEMA, PREPARATION_VERSION, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { createGmPublicationAssets } from './gmPublicationAssets.mjs';
import { resourceLayout } from '../src/data/resources.js';
import { projectGmContent } from '../src/editor/contentProjection.js';
import { compileAuthoredResources } from '../src/editor/resourceAdapters.js';
import { terrainGridOf } from '../src/editor/terrainData.js';
import { mapGrid } from '../src/sim/mapBounds.js';
import { isTerrainTilesDocument } from '../src/editor/terrainTiles.js';
import { WORLD_LOAD_LIMITS } from '../src/editor/worldLoad.js';

const sha256 = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const TERRAIN_TILES_CONTENT_FORMAT = 'marea.gm.terrain-tiles';

/** A terrain problem of a document v5 found while preparing (its tiles break a map rule, or a tile is missing). */
export class GmTerrainInvalidError extends Error {
  constructor(reason) {
    super(`GM terrain invalid: ${reason}`); this.name = 'GmTerrainInvalidError'; this.code = 'gm_terrain_invalid';
    this.reason = typeof reason === 'string' ? reason : 'terrain';
  }
}

// The vertex count of a compiled map's grid; a map with no valid grid is a terrain problem.
function gridCount(map, reason) {
  try { return terrainGridOf(map).count; } catch { throw new GmTerrainInvalidError(reason); }
}

// GM07b2c S7: sha256 hex of the compiled heights as bytes, each value a float32 written little-endian
// (endian-explicit, so the hash does not depend on the platform's byte order).
function heightsSha256(map) {
  const heights = map.heights;
  if (!heights || heights.length !== gridCount(map, 'heights')) throw new GmTerrainInvalidError('heights');
  const bytes = Buffer.allocUnsafe(heights.length * 4);
  for (let k = 0; k < heights.length; k++) bytes.writeFloatLE(heights[k], k * 4);
  return bytesSha256(bytes);
}

// GM07b2c S7: sha256 hex of the compiled weight bytes exactly as compileTerrainTiles returns them, the grid at
// map.terrain.weights: a Uint8Array of Nx x Nz x 4, vertex k = j * Nx + i (x = minX + i, z = minZ + j), four u8
// weights per vertex in material id order 1..4 (grass, dirt, sand, rock). Bytes, so no byte order applies.
function materialsSha256(map) {
  const weights = map.terrain?.weights;
  if (!(weights instanceof Uint8Array) || weights.length !== gridCount(map, 'weights') * 4) throw new GmTerrainInvalidError('weights');
  return bytesSha256(weights);
}

// S6: every referenced tile is present in `tiles` and hashes to its reference; then the terrain compiles and passes
// the whole-map rules. Any failure is a GmTerrainInvalidError naming the terrain code.
function checkTileTerrain(map, document, baseRevision, tiles) {
  if (!(tiles instanceof Map)) throw new GmTerrainInvalidError('tile_blobs');
  for (const [, , hash, size] of document.terrain.tiles) {
    const bytes = tiles.get(hash);
    if (!(bytes instanceof Uint8Array)) throw new GmTerrainInvalidError('tile_missing');
    if (bytes.length !== size) throw new GmTerrainInvalidError('tile_length');
    if (bytesSha256(bytes) !== hash) throw new GmTerrainInvalidError('tile_hash');
  }
  try { compileTileTerrainForMap(map, document, baseRevision, tiles); }
  catch (error) { throw new GmTerrainInvalidError(error?.code); }
}

/**
 * Read-only preparation from a confirmed draft. No gameplay or content pointer is written. `loadLimits` is the GM11a
 * single-load budget (worldLoad.js WORLD_LOAD_LIMITS by default; tests pass a smaller one).
 */
export function createGmPublicationService({ root, runtimeRoot = root, map, baseRevision, worldId, validateReferences, gameVersion, protocolVersion,
  loadLimits = WORLD_LOAD_LIMITS }) {
  const dependencies = createGmPublicationAssets({ root, runtimeRoot });
  let ready = false, base;
  return {
    async prepare() {
      await dependencies.prepare();
      base = { seed: map.seed >>> 0, revision: baseRevision, propsHash: sha256(map.props),
        collidersHash: sha256(map.colliders), resourcesHash: sha256(resourceLayout(map)) };
      ready = true;
    },
    // New preparations are schema 2. version 1 only rebuilds a retained schema 1 revision for its compatibility check.
    // A document v5 (terrain tiles, GM07b2c) needs `tiles`: a Map sha256 -> MNT1 bytes with every tile it references
    // (from the draft store at prepare, from the registry on activation and in the updater check).
    async build({ document, draftRevision, version = PREPARATION_VERSION, tiles = null }) {
      if (!ready) throw new Error('preparation_unavailable');
      if (![1, PREPARATION_VERSION].includes(version)) throw new Error('preparation_version');
      const checked = validateReferences(document);
      const tiled = isTerrainTilesDocument(checked);
      if (tiled && version !== PREPARATION_VERSION) throw new Error('preparation_version');
      // Draft saves skip the terrain of a v5 (S3): its whole-map rules run here, before any other check.
      if (tiled) checkTileTerrain(map, checked, baseRevision, tiles);
      const { colliders, ...report } = validateGmPublication({ map, document: checked, baseRevision, loadLimits, ...(tiled ? { tiles } : {}) });
      if (!report.valid) return { report, revision: null };
      const projected = checked.terrain ? projectGmContent(map, checked, baseRevision, tiled ? { tiles } : undefined) : null;
      // A v5 takes the resources its projection compiled on the compiled terrain, which is what the server installs and
      // the client hashes. v3/v4 keep their call on the projected map unchanged; that map already holds the authored
      // resources, so an authored resource protects its own site there.
      const authoredResources = tiled ? projected.gmResources : compileAuthoredResources(projected || map, checked);
      const coastal = new Set(gmEditableBaseProps(map, baseRevision).filter((entry) => entry.coastal).map((entry) => entry.id));
      const usesCoast = checked.baseOverrides.some((item) => coastal.has(item.id)) || checked.objects.some((item) => coastal.has(item.assetId));
      const assets = await dependencies.resolve(checked, usesCoast ? ['model:coast-rock-v1'] : []);
      const baselineAssets = await dependencies.resolveBaseline();
      if (assets.some((asset) => asset.status === 'candidate')) {
        report.issues.push({ severity: 'warning', code: 'candidate_assets' });
        report.summary.warnings++; report.summary.totalIssues++;
      }
      // Schema 1 hashes the whole release: every runtime file, both versions and every manifest file. Schema 2
      // (GM07b0) hashes what the content uses: its models (assets) and, of the manifest files, only the variants
      // of those models, since phones draw the mobile GLB. The release goes to preparedWith, outside the hash.
      const current = version === PREPARATION_VERSION, used = new Set(assets.map((asset) => asset.id));
      const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId, sourceRevision: draftRevision, base,
        document: checked, documentHash: sha256(checked),
        runtime: current ? { files: [] } : { ...dependencies.runtime, gameVersion, protocolVersion }, assets,
        baselineAssets: current ? baselineAssets.filter((asset) => used.has(asset.id)) : baselineAssets,
        collision: { count: colliders.length, sha256: sha256(colliders) }, validation: report };
      if (authoredResources.length) content.resources = { count: authoredResources.length, sha256: sha256(authoredResources) };
      // S7: a v5 names its tiles and hashes its compiled bytes, with this fixed key set; v3/v4 keep their rule.
      // GM11b3 replaces gridSize with the domain; until then only a square grid has a content shape.
      const { Nx, Nz } = projected ? mapGrid(projected) : {};
      if (projected && Nx !== Nz) throw new GmTerrainInvalidError('domain');
      if (projected && tiled) content.terrain = { format: TERRAIN_TILES_CONTENT_FORMAT, version: 1, tileSize: checked.terrain.tileSize,
        tiles: structuredClone(checked.terrain.tiles), heightsSha256: heightsSha256(projected),
        materialsSha256: materialsSha256(projected) };
      else if (projected) content.terrain = { gridSize: Nx, sha256: sha256(Array.from(projected.heights)),
        ...(checked.terrain.version === 2 ? { materialsSha256: sha256(checked.terrain.materials) } : {}) };
      const revision = { schema: PREPARATION_SCHEMA, version, revisionId: sha256(content), content };
      if (current) revision.preparedWith = { gameVersion, protocolVersion, runtime: dependencies.runtime, baselineAssets };
      return { report, revision };
    },
  };
}

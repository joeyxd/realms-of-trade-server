import { validateDocument } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { compileTerrainMap, terrainTileKey, validateTerrainForMap } from '../src/editor/terrainData.js';
import { TILE_MAX_BYTES, decodeTile, isTerrainTilesDocument, validateTerrainTilesForMap } from '../src/editor/terrainTiles.js';
import { resourceDescriptor, sourceAssetId, validateAuthoredResources } from '../src/editor/resourceAdapters.js';

const COAST_ROCK_ID = 'model:coast-rock-v1';

export class GmDraftValidationError extends TypeError {
  constructor(code) {
    super(`Invalid GM draft: ${code}`);
    this.name = 'GmDraftValidationError';
    this.code = code;
  }
}

function entriesOf(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.assets)) return source.assets;
  if (source?.entries instanceof Map) return [...source.entries.values()];
  if (source?.entries && typeof source.entries === 'object') return Object.values(source.entries);
  return [];
}

function approvedAssetIds(manifest, editorCatalog) {
  const ids = new Set();
  for (const entry of [...entriesOf(manifest), ...entriesOf(editorCatalog)]) {
    if (!entry || typeof entry.id !== 'string' || !/^(?:model|prop):[A-Za-z0-9][A-Za-z0-9._:-]{0,156}$/.test(entry.id)) continue;
    const prefix = entry.id.slice(0, entry.id.indexOf(':'));
    if (entry.kind === undefined || entry.kind === 'model' || entry.kind === 'prop' || prefix === 'prop') ids.add(entry.id);
  }
  return ids;
}

/** Build a synchronous validator bound to the server-generated map and shipped asset indexes. */
export function createGmDraftValidator({ map, baseRevision, manifest, editorCatalog }) {
  if (!map || !Number.isSafeInteger(map.seed) || typeof baseRevision !== 'string' || !baseRevision ||
      !Array.isArray(map.props) || !Array.isArray(map.colliders)) {
    throw new TypeError('Invalid GM draft validation context');
  }
  const assets = approvedAssetIds(manifest, editorCatalog);
  const coastAvailable = entriesOf(manifest).some((entry) => entry?.id === COAST_ROCK_ID);
  const baseIds = new Set(gmEditableBaseProps(map, baseRevision)
    .filter((entry) => !entry.coastal || coastAvailable)
    .map((entry) => entry.id));
  const checkReferences = (checked) => {
    for (const item of checked.objects) {
      if (item.assetId.startsWith('base:')) {
        if (!baseIds.has(item.assetId)) throw new GmDraftValidationError('base_reference');
      } else if (!assets.has(resourceDescriptor(item.assetId) ? sourceAssetId(item.assetId) : item.assetId)) {
        throw new GmDraftValidationError('asset_reference');
      }
    }
    for (const override of checked.baseOverrides) {
      if (!baseIds.has(override.id)) throw new GmDraftValidationError('base_reference');
    }
  };

  return function validate(doc) {
    let checked;
    try { checked = validateDocument(doc); }
    catch (error) { throw new GmDraftValidationError(error?.code || 'document'); }
    if (checked.base.seed !== (map.seed >>> 0) || checked.base.revision !== baseRevision) {
      throw new GmDraftValidationError('base_mismatch');
    }
    // GM07b2 S3: a document v5 holds tile references only. Each stored tile passed the map rules of this base on
    // upload (createGmTerrainTileValidator) and the store answers tiles_missing for absent ones, so the draft check
    // never reads tile bytes. Resources sit on the compiled terrain, which needs the bytes: prepare (S6) compiles the
    // whole map and validates them there. Model and base references are checked below as for v2-v4.
    if (isTerrainTilesDocument(checked)) {
      checkReferences(checked);
      return checked;
    }
    if (checked.terrain) {
      try { validateTerrainForMap(map, checked.terrain); }
      catch (error) { throw new GmDraftValidationError(error?.code || 'terrain'); }
    }
    const terrainMap = checked.terrain ? compileTerrainMap(map, checked.terrain) : map;
    const resourceCheck = validateAuthoredResources(terrainMap, checked);
    if (!resourceCheck.valid) throw new GmDraftValidationError(`resource_${resourceCheck.issues[0].code}`);
    checkReferences(checked);
    return checked;
  };
}

/**
 * GM07b2 S3/S4: the map rules of the base revision for one uploaded tile. The tile must decode canonically in the
 * domain of `baseRevision` (materials 1..4), then pass the edit rules of validateTerrainGridForMap on its own region
 * (the dirty-tile path: height range [-40, +200] m, after >= 0.75 m, protected ground, routes and areas, the outer
 * ring). The rules are per vertex, so a tile valid alone is valid in any document of this base. Throws
 * GmDraftValidationError('tile_invalid') with the rule in `reason`; returns the tile key { tx, tz }.
 */
export function createGmTerrainTileValidator({ map, baseRevision }) {
  if (!map || !Number.isSafeInteger(map.seed) || typeof baseRevision !== 'string' || !baseRevision) {
    throw new TypeError('Invalid GM terrain tile validation context');
  }
  return function validateTile(bytes) {
    const refuse = (error) => {
      const failure = new GmDraftValidationError('tile_invalid');
      if (typeof error?.code === 'string') failure.reason = error.code;
      return failure;
    };
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > TILE_MAX_BYTES) throw refuse(null);
    let tile;
    try { tile = decodeTile(bytes, baseRevision); } catch (error) { throw refuse(error); }
    // tilesToGrid reads the tile by its reference; the hash is not checked here (the route hashes the bytes).
    const reference = [tile.tx, tile.tz, '0'.repeat(64), bytes.length];
    try {
      validateTerrainTilesForMap(map, { tiles: [reference], blobs: new Map([[reference[2], bytes]]) }, baseRevision,
        { dirtyTiles: [terrainTileKey(tile.tx, tile.tz)] });
    } catch (error) { throw refuse(error); }
    return { tx: tile.tx, tz: tile.tz };
  };
}

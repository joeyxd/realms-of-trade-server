import { verifyPreparedRevision, canonicalJson, PREPARATION_VERSION } from './publicationArtifact.js';
import { installGmContent, projectGmContent } from './contentProjection.js';
import { resourceLayout } from '../data/resources.js';
import { TERRAIN_GRID_SIZE } from './terrainData.js';
import { isTerrainTilesDocument, tileSha256 } from './terrainTiles.js';

const TILES_FORMAT = 'marea.gm.terrain-tiles', TILE_FETCH_LIMIT = 6;
const terrainFailure = (why) => Object.assign(new Error(`content_terrain: ${why}`), { code: 'content_terrain' });

// S7: the exact key set of content.terrain of a document v5, naming the document's own tiles.
function checkTilesMetadata(metadata, document) {
  if (!metadata || Object.keys(metadata).sort().join(',') !== 'format,heightsSha256,materialsSha256,tileSize,tiles,version' ||
      metadata.format !== TILES_FORMAT || metadata.version !== 1 || metadata.tileSize !== document.terrain.tileSize ||
      !/^[a-f0-9]{64}$/.test(metadata.heightsSha256) || !/^[a-f0-9]{64}$/.test(metadata.materialsSha256) ||
      JSON.stringify(metadata.tiles) !== JSON.stringify(document.terrain.tiles)) throw terrainFailure('metadata');
}

// S10: every tile of the active revision from the public immutable route (default HTTP cache), at most 6 in flight,
// each checked against its declared byte length and sha256 before use. Returns the verified Map sha256 -> bytes.
async function fetchTerrainTiles(references, httpBase, fetchImpl) {
  const queue = [...new Map(references.map((reference) => [reference[2], reference])).values()], tiles = new Map();
  let next = 0, failed = false;
  const fetchOne = async ([, , sha256, length]) => {
    let response;
    try { response = await fetchImpl(new URL(`api/world/terrain-tiles/${sha256}`, httpBase), { signal: AbortSignal.timeout(12_000) }); }
    catch (failure) { throw terrainFailure(`tile ${sha256} fetch failed: ${failure?.message}`); }
    if (!response.ok) throw terrainFailure(`tile ${sha256} answered ${response.status}`);
    let bytes;
    try { bytes = new Uint8Array(await response.arrayBuffer()); }
    catch (failure) { throw terrainFailure(`tile ${sha256} read failed: ${failure?.message}`); }
    if (bytes.length !== length) throw terrainFailure(`tile ${sha256} length`);
    if (await tileSha256(bytes) !== sha256) throw terrainFailure(`tile ${sha256} hash`);
    tiles.set(sha256, bytes);
  };
  const worker = async () => {
    while (!failed && next < queue.length) {
      try { await fetchOne(queue[next++]); } catch (failure) { failed = true; throw failure; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TILE_FETCH_LIMIT, queue.length) }, worker));
  return tiles;
}

export async function gmContentHash(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// Transcendental functions may differ by a few ULPs between V8 versions. Accept only
// numerical noise, then use the exact hashed server arrays for IDs and collision prediction.
export function sameGmGeometry(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a), other = Object.keys(b);
  return keys.length === other.length && keys.every((key) => Object.hasOwn(b, key) && sameGmGeometry(a[key], b[key]));
}

/** Fetch and verify the server-selected projection before prediction, scene construction or HELLO. */
export async function loadGmWorldContent({ httpBase, map, baseMap, gameVersion, protocolVersion, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const response = await fetchImpl(new URL('api/world/content', httpBase), { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('content_unavailable');
  const body = await response.json();
  if (body?.ok !== true || !Number.isSafeInteger(body.generation) || body.generation < 0 ||
      body.revisionId !== null && !/^[a-f0-9]{64}$/.test(body.revisionId)) throw new Error('content_invalid');
  const revision = body.revision;
  let tiles = null;
  if (body.revisionId === null) {
    if (revision !== null) throw new Error('content_invalid');
  } else {
    const content = revision?.content, document = content?.document;
    const tiled = isTerrainTilesDocument(document);
    // Schema 2 (GM07b0) does not name a release: the hashes recomputed below decide, and HELLO checks the protocol.
    // Schema 1 still has to come from this exact game and protocol version.
    if (revision?.revisionId !== body.revisionId || revision.version !== PREPARATION_VERSION &&
        (content?.runtime?.gameVersion !== gameVersion || content?.runtime?.protocolVersion !== protocolVersion)) throw new Error('content_incompatible');
    await verifyPreparedRevision(revision, { scope: { worldId: content.worldId, seed: baseMap.seed >>> 0,
      baseRevision: 'terrain-s21-v1' }, draftRevision: content.sourceRevision, document });
    const baseline = body.baseline ?? { props: baseMap.props, colliders: baseMap.colliders, resources: resourceLayout(baseMap) };
    if (!sameGmGeometry(baseline.props, baseMap.props) || !sameGmGeometry(baseline.colliders, baseMap.colliders) ||
        !sameGmGeometry(baseline.resources, resourceLayout(baseMap)) ||
        content.base.propsHash !== await gmContentHash(baseline.props) ||
        content.base.collidersHash !== await gmContentHash(baseline.colliders) ||
        content.base.resourcesHash !== await gmContentHash(baseline.resources)) throw new Error('content_base');
    const verifiedBase = { ...baseMap, props: structuredClone(baseline.props), colliders: structuredClone(baseline.colliders),
      terrainResources: structuredClone(baseline.resources) };
    // GM07b2d: a document v5 names its tiles; every one is fetched, verified and compiled before anything is installed.
    if (tiled) {
      checkTilesMetadata(content.terrain, document);
      tiles = await fetchTerrainTiles(document.terrain.tiles, httpBase, fetchImpl);
    }
    let projected;
    try { projected = projectGmContent(verifiedBase, document, 'terrain-s21-v1', { tiles }); }
    catch (failure) { if (!tiled) throw failure; throw terrainFailure(`compile ${failure?.code ?? failure?.message}`); }
    if (projected.gmResources.length) {
      const metadata = content.resources;
      if (!metadata || Object.keys(metadata).sort().join(',') !== 'count,sha256' ||
          metadata.count !== projected.gmResources.length || !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
          metadata.sha256 !== await gmContentHash(projected.gmResources)) {
        throw Object.assign(new Error('content_resources'), { code: 'content_resources' });
      }
    } else if (content.resources !== undefined) {
      throw Object.assign(new Error('content_resources'), { code: 'content_resources' });
    }
    if (tiled) {
      // S7: the hashes of the compiled bytes: heights as float32 little-endian, weights as they are.
      const view = new DataView(new ArrayBuffer(TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4));
      if (projected.heights?.length !== TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE ||
          projected.terrain?.weights?.length !== TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4) throw terrainFailure('compiled size');
      for (let k = 0; k < projected.heights.length; k++) view.setFloat32(k * 4, projected.heights[k], true);
      if (content.terrain.heightsSha256 !== await tileSha256(new Uint8Array(view.buffer))) throw terrainFailure('heights hash');
      if (content.terrain.materialsSha256 !== await tileSha256(projected.terrain.weights)) throw terrainFailure('materials hash');
    } else if (document.terrain) {
      const metadata = content.terrain;
      const painted = document.terrain.version === 2;
      if (!metadata || Object.keys(metadata).sort().join(',') !== (painted ? 'gridSize,materialsSha256,sha256' : 'gridSize,sha256') ||
          metadata.gridSize !== TERRAIN_GRID_SIZE || !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
          projected.heights?.length !== TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE ||
          metadata.sha256 !== await gmContentHash(Array.from(projected.heights)) ||
          (painted && metadata.materialsSha256 !== await gmContentHash(document.terrain.materials))) {
        throw Object.assign(new Error('content_terrain'), { code: 'content_terrain' });
      }
    } else if (content.terrain !== undefined) {
      throw Object.assign(new Error('content_terrain'), { code: 'content_terrain' });
    }
    if (content.collision.sha256 !== await gmContentHash(projected.colliders)) throw new Error('content_collision');
    baseMap.props = structuredClone(baseline.props); baseMap.colliders = structuredClone(baseline.colliders);
    baseMap.terrainResources = structuredClone(baseline.resources);
    installGmContent(baseMap, baseMap, null);
    map.props = baseMap.props; map.terrainResources = baseMap.terrainResources;
    installGmContent(map, baseMap, document, 'terrain-s21-v1', { tiles });
  }
  map.gmContentIdentity = { generation: body.generation, revisionId: body.revisionId };
  return { ...body, tiles };
}

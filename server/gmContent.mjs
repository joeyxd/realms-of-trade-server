import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import { projectGmContent, installGmContent, validateGmRoutes } from '../src/editor/contentProjection.js';
import { createGmContentRegistry } from './gmContentRegistry.mjs';
import { validateGmContentObstacles } from './gmContentObstacles.mjs';
import { resourceLayout } from '../src/data/resources.js';
import { sameRevisionIdentity } from '../src/editor/publicationArtifact.js';
import { DOMAIN_DOCUMENT_VERSION, documentDomain, isTerrainTilesDocument } from '../src/editor/terrainTiles.js';
import { mapBounds } from '../src/sim/mapBounds.js';

const gzip = promisify(gzipCallback);
const error = (code) => Object.assign(new Error(code), { code });
const clone = (value) => structuredClone(value);

/** Content only. M5 remains the sole writer of characters, goods and world clocks. */
export function createGmContentService({ directory, root, worldId, baseMap, baseRevision, game, publication, lock, registryFault }) {
  const registry = createGmContentRegistry({ directory, root, worldId, lock, fault: registryFault });
  let active = { generation: 0, revisionId: null, revision: null }, ready = false;
  let servable = null, gzipped = new Map();
  // { revision, tiles } or { revision: null, tiles: null } for base. tiles: the verified terrain tiles of a document v5
  // from the registry blobs (GM07b2c), null for v2-v4.
  async function checked(id) {
    if (id === null) return { revision: null, tiles: null };
    const loaded = await registry.loadWithTiles(id);
    const revision = loaded?.revision;
    if (!revision) throw error('gm_content_missing');
    const tiles = isTerrainTilesDocument(revision.content.document) ? loaded.tiles : null;
    // GM11b3 D7: the running world's extent never changes at runtime (GM11c). A revision over another domain can be
    // prepared and stored, but not installed or activated; the active revision stays.
    if (revision.content.document.version === DOMAIN_DOCUMENT_VERSION) {
      const domain = documentDomain(revision.content.document), bounds = mapBounds(baseMap);
      if (domain.minX !== bounds.minX || domain.maxX !== bounds.maxX || domain.minZ !== bounds.minZ || domain.maxZ !== bounds.maxZ) {
        throw error('terrain_domain_runtime');
      }
    }
    // Rebuild with the running code under the revision's own schema (GM07b0): schema 2 survives a code change
    // when the content and its derived hashes rebuild identically; schema 1 still needs the same runtime.
    // A document v5 rebuilds from its retained tiles, with the whole-map terrain rules.
    const built = await publication.build({ document: revision.content.document, draftRevision: revision.content.sourceRevision,
      version: revision.version, ...(tiles ? { tiles } : {}) });
    if (!built.revision || built.revision.revisionId !== id || !sameRevisionIdentity(revision, built.revision)) throw error('gm_content_incompatible');
    if (revision.content.assets.some((item) => item.status === 'candidate')) throw error('gm_content_candidate');
    return { revision, tiles };
  }
  function install(state, revision, tiles = null) {
    installGmContent(game.server.world.map, baseMap, revision?.content.document ?? null, baseRevision, { tiles });
    game.installContentResources?.();
    // GM07b2d S10: the public tile route answers only the tiles the installed revision references; replaced on every
    // install (so an older revision's hash 404s at once), with the gzip cache of the previous revision dropped.
    servable = tiles && isTerrainTilesDocument(revision?.content.document)
      ? new Map(revision.content.document.terrain.tiles.map((reference) => [reference[2], tiles.get(reference[2])])) : null;
    gzipped = new Map();
    active = { generation: state.generation, revisionId: state.revisionId, revision };
    game.contentIdentity = { generation: state.generation, revisionId: state.revisionId };
  }
  return {
    async prepare() {
      await registry.prepare();
      const state = await registry.state();
      const { revision, tiles } = await checked(state.revisionId);
      install(state, revision, tiles); ready = true;
    },
    get ready() { return ready; },
    // GM07b2d S10: the bytes of a tile of the ACTIVE revision, or null (not referenced by it, or no v5 active).
    terrainTile(sha256) { return servable?.get(sha256) ?? null; },
    // The same bytes gzipped (async, so a 64 KiB tile never blocks the tick), cached until the next install.
    terrainTileGzip(sha256) {
      const bytes = servable?.get(sha256);
      if (!bytes) return Promise.resolve(null);
      const cache = gzipped;
      if (!cache.has(sha256)) cache.set(sha256, gzip(bytes).catch((failure) => { cache.delete(sha256); throw failure; }));
      return cache.get(sha256);
    },
    snapshot() { return clone({ ...active, baseline: active.revision ? {
      props: baseMap.props, colliders: baseMap.colliders, resources: resourceLayout(baseMap),
    } : null }); },
    async list() {
      if (!ready) throw error('gm_content_unavailable');
      return { active: { generation: active.generation, revisionId: active.revisionId }, revisions: await registry.list() };
    },
    // `tiles` (GM07b2c): the Map of terrain tile bytes prepare read for a document v5, retained beside the revision.
    async register(revision, { tiles = null } = {}) {
      if (!ready) throw error('gm_content_unavailable');
      await registry.retain(revision, { tiles }); return this.list();
    },
    async activate(input) {
      if (!ready) throw error('gm_content_unavailable');
      return registry.withLock(async () => {
        const before = await registry.state();
        // Replay is checked by the registry even when the current head moved again.
        if (before.operations?.[input.operationId]) return registry.switch(input);
        if (before.generation !== input.expectedGeneration) throw error('gm_content_conflict');
        const resume = game.beginContentSwitch();
        let committed = false, attempted = false;
        let revision = null, tiles = null;
        try {
          ({ revision, tiles } = await checked(input.revisionId));
          // A document v5 compiles from its registry tiles; the burial check below reads the compiled map.
          const target = projectGmContent(baseMap, revision?.content.document ?? null, baseRevision, { tiles });
          const routes = validateGmRoutes(baseMap, target);
          if (routes === false || routes?.valid === false) throw error('gm_content_routes');
          await validateGmContentObstacles({ store: game.store, map: baseMap, currentMap: game.server.world.map,
            targetMap: target, worldId });
          if (game.closing || !game.healthy()) throw error('gm_content_unavailable');
          if (target.gmResources?.length && typeof game.prepareContentResources !== 'function') throw error('gm_resource_unavailable');
          await game.prepareContentResources?.(target);
          if (game.closing || !game.healthy()) throw error('gm_content_unavailable');
          attempted = true;
          const result = await registry.switch(input);
          if (!result?.ok) {
            if (result?.why === 'conflict') throw error('gm_content_conflict');
            throw error('gm_content_operation');
          }
          committed = true;
          // No asynchronous gap between the durable pointer ACK and the in-process projection.
          install(result, revision, tiles);
          game.closeContentSpectators();
          return { ...result, active: { generation: active.generation, revisionId: active.revisionId } };
        } catch (failure) {
          // A rename/fsync can succeed even when its caller loses the result. Reconcile before reopening admission.
          if (attempted && !committed) {
            try {
              const after = await registry.state();
              const receipt = after.operations?.[input.operationId];
              if (receipt?.result.ok && after.generation === receipt.result.generation && after.revisionId === input.revisionId) {
                install(after, revision, tiles); game.closeContentSpectators();
              } else if (after.generation !== before.generation || after.revisionId !== before.revisionId) throw error('gm_content_unavailable');
            } catch { ready = false; game.fenceWorld('content_uncertain'); }
          } else if (committed) { ready = false; game.fenceWorld('content_install'); }
          throw failure;
        } finally { resume(); }
      });
    },
  };
}

export function sameContentIdentity(a, b) {
  return !!a && !!b && Number.isSafeInteger(a.generation) && a.generation >= 0 &&
    Object.keys(a).length === 2 && Object.keys(b).length === 2 && a.generation === b.generation && a.revisionId === b.revisionId;
}

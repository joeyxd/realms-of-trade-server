import { verifyPreparedRevision, canonicalJson } from './publicationArtifact.js';
import { installGmContent } from './contentProjection.js';
import { resourceLayout } from '../data/resources.js';

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
  if (body.revisionId === null) {
    if (revision !== null) throw new Error('content_invalid');
  } else {
    const content = revision?.content, document = content?.document;
    if (revision?.revisionId !== body.revisionId || content?.runtime?.gameVersion !== gameVersion ||
        content?.runtime?.protocolVersion !== protocolVersion) throw new Error('content_incompatible');
    await verifyPreparedRevision(revision, { scope: { worldId: content.worldId, seed: baseMap.seed >>> 0,
      baseRevision: 'terrain-s21-v1' }, draftRevision: content.sourceRevision, document });
    const baseline = body.baseline ?? { props: baseMap.props, colliders: baseMap.colliders, resources: resourceLayout(baseMap) };
    if (!sameGmGeometry(baseline.props, baseMap.props) || !sameGmGeometry(baseline.colliders, baseMap.colliders) ||
        !sameGmGeometry(baseline.resources, resourceLayout(baseMap)) ||
        content.base.propsHash !== await gmContentHash(baseline.props) ||
        content.base.collidersHash !== await gmContentHash(baseline.colliders) ||
        content.base.resourcesHash !== await gmContentHash(baseline.resources)) throw new Error('content_base');
    baseMap.props = structuredClone(baseline.props); baseMap.colliders = structuredClone(baseline.colliders);
    baseMap.terrainResources = structuredClone(baseline.resources);
    installGmContent(baseMap, baseMap, null);
    map.props = baseMap.props; map.terrainResources = baseMap.terrainResources;
    installGmContent(map, baseMap, document);
    if (content.collision.sha256 !== await gmContentHash(map.colliders)) throw new Error('content_collision');
  }
  map.gmContentIdentity = { generation: body.generation, revisionId: body.revisionId };
  return body;
}

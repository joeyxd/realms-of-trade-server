// GM11b3 D4: the generated base map for a document's domain, shared by the editor and the server. Pure: no three and no DOM.
// Today's square is not memoized: callers get a fresh generateWorld(seed), exactly as before. A larger world is slow to
// build (a 16 x 8 tile domain is about 630,000 vertices), so the last two are kept, keyed by seed and bounds.
import { tuning } from '../data/tuning.js';
import { generateWorld } from './worldgen.js';
import { TERRAIN_SIZE } from './terrainRevamp.js';

const KEPT = 2;
const kept = [];

/** `bounds` is { minX, maxX, minZ, maxZ } in whole metres (a domainBounds record also fits); undefined is today's square. */
export function baseMapForDomain(seed, bounds) {
  const half = Math.max(TERRAIN_SIZE, tuning.world.size) / 2; // terrainRevamp.js: today's square
  if (bounds === undefined || bounds === null ||
      bounds.minX === -half && bounds.maxX === half && bounds.minZ === -half && bounds.maxZ === half) return generateWorld(seed);
  const key = [seed, bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].join(',');
  const at = kept.findIndex((entry) => entry.key === key);
  if (at >= 0) { const [entry] = kept.splice(at, 1); kept.push(entry); return entry.map; }
  const map = generateWorld(seed, { bounds: { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ } });
  // The sampler of a grown map offsets its cell by a different float, so a prop's y (and a resource's) moves by about
  // 1e-14 m. A base id hashes y (baseIdentity.js gmBaseId), so the grown map keeps today's props and resources: base ids,
  // base hashes and published content stay the same on every domain.
  const square = generateWorld(seed);
  map.props = square.props; map.terrainResources = square.terrainResources;
  kept.push({ key, map });
  if (kept.length > KEPT) kept.shift();
  return map;
}

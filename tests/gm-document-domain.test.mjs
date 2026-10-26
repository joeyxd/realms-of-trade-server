// GM11b3 (docs/briefs/gm11-world-growth-zones.md, GM11b design; ticket T-1025-22): the world's extent as data. Document v6
// carries terrain.domain { minTx, maxTx, minTz, maxTz }; v5 stands for the base revision's square. Pure: no three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../src/sim/worldgen.js';
import { baseMapForDomain } from '../src/sim/baseMapForDomain.js';
import { addDecoration, createDecoration, createDocument, documentDomain, validateDocument, withDocumentDomain } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { TERRAIN_DOMAINS, TERRAIN_DOMAIN_LIMITS, domainBounds, isTerrainTilesDocument, validateDomain } from '../src/editor/terrainTiles.js';

const BASE = 'terrain-s21-v1', SEED = 99282957;
const SQUARE = { minTx: -4, maxTx: 3, minTz: -4, maxTz: 3 };
const DOMAIN = { minTx: -12, maxTx: 3, minTz: -4, maxTz: 3 }; // 16 x 8 tiles: x -840..280, z -280..280
const DEFAULT_HEIGHT_SHA256 = 'f0dd28e3664ce0ebb38904e706a578de962958b0767131cf92e9820032d835b5';
const hash = (n) => n.toString(16).padStart(64, '0');
const coded = (code) => (error) => error?.code === code;
const tiles5 = [[0, 0, hash(1), 100], [3, 3, hash(2), 200]];
const tilesOut = [[-6, 0, hash(3), 150], [0, 0, hash(1), 100], [3, 3, hash(2), 200]]; // one tile west of today's square
const object = (x, id = 'tree') => createDecoration({ id, assetId: 'model:palm', position: { x, y: 3, z: 10 } }, { minX: -4480, maxX: 4480, minZ: -4480, maxZ: 4480 });
const v5 = (tiles = tiles5, objects = []) => createDocument({ seed: SEED, baseRevision: BASE, objects, terrain: { version: 3, tileSize: 70, tiles } });
const v6 = (tiles = tilesOut, objects = [], domain = DOMAIN) => createDocument({ seed: SEED, baseRevision: BASE, objects,
  terrain: { version: 4, tileSize: 70, domain, tiles } });
const raw6 = (terrain) => ({ schema: 'marea.gm.map-draft', version: 6, base: { seed: SEED, revision: BASE }, objects: [], baseOverrides: [], terrain });

test('a v5 document round-trips byte-identical and its domain is the base revision\'s square', () => {
  const document = v5(), text = JSON.stringify(document);
  assert.equal(text, '{"schema":"marea.gm.map-draft","version":5,"base":{"seed":99282957,"revision":"terrain-s21-v1"},"objects":[],' +
    '"baseOverrides":[],"terrain":{"version":3,"tileSize":70,"tiles":[[0,0,"' + hash(1) + '",100],[3,3,"' + hash(2) + '",200]]}}');
  assert.equal(JSON.stringify(validateDocument(JSON.parse(text))), text);
  assert.ok(isTerrainTilesDocument(document));
  for (const doc of [document, createDocument({ seed: SEED, baseRevision: BASE })]) {
    assert.deepEqual({ ...documentDomain(doc) }, { ...TERRAIN_DOMAINS[BASE] });
    assert.deepEqual({ ...documentDomain(doc) }, { minX: -280, maxX: 280, minZ: -280, maxZ: 280, cell: 1 });
  }
});

test('a v6 document on a 16 x 8 tile domain validates, round-trips and returns to the v5 bytes', () => {
  const document = v6();
  assert.equal(document.version, 6);
  assert.deepEqual(Object.keys(document.terrain), ['version', 'tileSize', 'domain', 'tiles']);
  assert.deepEqual(document.terrain.domain, DOMAIN);
  assert.ok(isTerrainTilesDocument(document));
  assert.deepEqual({ ...documentDomain(document) }, { minX: -840, maxX: 280, minZ: -280, maxZ: 280, cell: 1 });
  const text = JSON.stringify(document);
  assert.equal(JSON.stringify(validateDocument(JSON.parse(text))), text);
  // The tile west of the square cannot be cut away; without it the same world is the v5 bytes.
  assert.throws(() => withDocumentDomain(document, SQUARE), coded('domain_cut'));
  const grown = withDocumentDomain(v5(), DOMAIN);
  assert.equal(grown.version, 6);
  assert.deepEqual(grown.terrain, { version: 4, tileSize: 70, domain: DOMAIN, tiles: tiles5 });
  assert.equal(JSON.stringify(withDocumentDomain(grown, SQUARE)), JSON.stringify(v5()));
  assert.equal(JSON.stringify(withDocumentDomain(v5(), SQUARE)), JSON.stringify(v5()));
  // A document with no terrain grows too: an empty v6, and back to the v5 with no tiles.
  const bare = createDocument({ seed: SEED, baseRevision: BASE });
  assert.deepEqual(withDocumentDomain(bare, DOMAIN).terrain, { version: 4, tileSize: 70, domain: DOMAIN, tiles: [] });
  assert.deepEqual(withDocumentDomain(withDocumentDomain(bare, DOMAIN), SQUARE).terrain, { version: 3, tileSize: 70, tiles: [] });
  assert.throws(() => withDocumentDomain(v6(), { ...DOMAIN, maxTx: 2 }), coded('domain'));
});

test('a v6 whose domain is the base revision\'s is refused: one world, one serialized form', () => {
  assert.throws(() => validateDocument(raw6({ version: 4, tileSize: 70, domain: SQUARE, tiles: [] })), coded('domain_canonical'));
  assert.throws(() => createDocument({ seed: SEED, baseRevision: BASE, terrain: { version: 4, tileSize: 70, domain: SQUARE, tiles: [] } }),
    coded('domain_canonical'));
});

test('domains outside the limits or not containing the base revision are refused', () => {
  assert.deepEqual(TERRAIN_DOMAIN_LIMITS, { min: -64, max: 63, maxTiles: 32, maxVertices: 1_000_000 });
  const terrain = (domain) => ({ version: 4, tileSize: 70, domain, tiles: [] });
  const bad = [{ ...DOMAIN, minTx: -65 }, { ...DOMAIN, maxTx: 64 }, { ...DOMAIN, minTz: -65 }, { ...DOMAIN, maxTz: 64 },
    { ...DOMAIN, minTx: -29 }, { ...DOMAIN, maxTz: 28, minTz: -4 }, // 33 tiles wide, 33 tiles high
    { ...DOMAIN, maxTx: 2 }, { ...DOMAIN, minTz: -3 }, { ...DOMAIN, minTx: -3 }, { ...DOMAIN, maxTz: 2 },
    { ...DOMAIN, minTx: 4, maxTx: 3 }, { ...DOMAIN, minTx: -12.5 }, { ...DOMAIN, minTx: '-12' },
    { minTx: -12, maxTx: 3, minTz: -4 }, { ...DOMAIN, extra: 1 }, null, [], 7];
  for (const domain of bad) {
    assert.throws(() => validateDocument(raw6(terrain(domain))), coded('domain'), JSON.stringify(domain));
    assert.throws(() => validateDomain(domain, BASE), coded('domain'), JSON.stringify(domain));
  }
  // The edges of the limits stand: 32 tiles on an axis, from -64 and up to 63; then one load (1,000,000 vertices).
  const widest = { minTx: -29, maxTx: 2 + 1, minTz: -4, maxTz: 3 };
  assert.throws(() => validateDomain(widest, BASE), coded('domain')); // 33 wide
  for (const domain of [{ minTx: -28, maxTx: 3, minTz: -4, maxTz: 27 }, { minTx: -4, maxTx: 27, minTz: -28, maxTz: 3 },
    { minTx: -22, maxTx: 3, minTz: -4, maxTz: 3 }, { minTx: -6, maxTx: 8, minTz: -6, maxTz: 7 }]) { // 26 x 8, 15 x 14
    assert.throws(() => validateDomain(domain, BASE), coded('domain_budget'), JSON.stringify(domain));
    assert.throws(() => validateDocument(raw6(terrain(domain))), coded('domain_budget'), JSON.stringify(domain));
  }
  for (const domain of [{ minTx: -21, maxTx: 3, minTz: -4, maxTz: 3 }, { minTx: -5, maxTx: 8, minTz: -6, maxTz: 7 }]) // 25 x 8, 14 x 14
    assert.deepEqual(validateDomain(domain, BASE), domain);
  assert.deepEqual(validateDomain({ minTx: -4, maxTx: 3, minTz: -4, maxTz: 3 }, BASE), SQUARE); // valid alone; a v6 may not be it
  assert.throws(() => validateDocument(raw6({ version: 3, tileSize: 70, domain: DOMAIN, tiles: [] })), coded('terrain_version'));
  assert.throws(() => validateDocument(raw6({ version: 4, tileSize: 70, tiles: [] })), coded('format'));
  assert.deepEqual({ ...domainBounds(DOMAIN) }, { minX: -840, maxX: 280, minZ: -280, maxZ: 280, cell: 1 });
});

test('tile keys and object positions are bounded by the document\'s own domain', () => {
  // Tile (-6, 0) lies outside today's square: v5 refuses it, the grown v6 takes it, and the v6 refuses what is beyond its domain.
  assert.throws(() => v5(tilesOut), coded('tile_key'));
  assert.equal(v6(tilesOut).terrain.tiles.length, 3);
  assert.throws(() => v6([[4, 0, hash(4), 100]]), coded('tile_key'));
  assert.throws(() => v6([[0, 4, hash(4), 100]]), coded('tile_key'));
  assert.throws(() => v6([[-13, 0, hash(4), 100]]), coded('tile_key'));
  // Row-major order is over the document's domain: tz first, then tx.
  assert.throws(() => v6([[0, 0, hash(1), 100], [-6, 0, hash(3), 150]]), coded('tile_order'));
  assert.throws(() => v6([[-6, 1, hash(3), 150], [0, 0, hash(1), 100]]), coded('tile_order'));
  // x = -300 is outside the +/-280 of today and inside the grown domain (x -840..280).
  assert.throws(() => v5(tiles5, [object(-300)]), coded('position'));
  const document = v6(tilesOut, [object(-300)]);
  assert.equal(document.objects[0].transform.position.x, -300);
  assert.throws(() => v6(tilesOut, [object(-841)]), coded('position'));
  assert.throws(() => v6(tilesOut, [object(281)]), coded('position'));
  assert.throws(() => v6(tilesOut, [object(-300, 'tree2')].map((item) => ({ ...item, transform: { ...item.transform,
    position: { ...item.transform.position, z: 281 } } }))), coded('position'));
  // Adding to a document follows its domain too; a decoration made without a domain keeps today's limit.
  assert.throws(() => addDecoration(v5(), object(-300)), coded('position'));
  assert.equal(addDecoration(v6(), object(-300)).objects.length, 1);
  assert.throws(() => createDecoration({ id: 'far', assetId: 'model:palm', position: { x: -300, y: 3, z: 0 } }), coded('position'));
  assert.equal(createDecoration({ id: 'far', assetId: 'model:palm', position: { x: -300, y: 3, z: 0 } }, documentDomain(v6())).id, 'far');
  // Shrinking back refuses an object left outside.
  assert.throws(() => withDocumentDomain(v6(tiles5, [object(-300)]), SQUARE), coded('position'));
  assert.equal(withDocumentDomain(v6(tiles5, [object(-100)]), SQUARE).version, 5);
});

test('generateWorld(seed) keeps its heights and a bounds world equals today\'s island on today\'s square', () => {
  const today = generateWorld(SEED);
  const h = today.heights;
  assert.equal(createHash('sha256').update(new Uint8Array(h.buffer, h.byteOffset, h.byteLength)).digest('hex'), DEFAULT_HEIGHT_SHA256);
  assert.deepEqual(generateWorld(SEED, {}).bounds, today.bounds);
  assert.equal(generateWorld(SEED, { bounds: undefined }).heights.length, 561 * 561);
  const grown = generateWorld(SEED, { bounds: { minX: -840, maxX: 280, minZ: -280, maxZ: 280 } });
  assert.equal(grown.Nx, 1121); assert.equal(grown.Nz, 561); assert.equal(grown.heights.length, 1121 * 561);
  for (let j = 0; j < 561; j++) for (let i = 0; i < 561; i++) {
    if (grown.heights[j * 1121 + i + 560] !== h[j * 561 + i]) assert.fail(`height differs at ${i},${j}`);
  }
  // The raw generator moves a prop's y by float noise only; baseMapForDomain keeps today's props, so base ids (which hash y)
  // and resources are the same on any domain, as are the colliders.
  assert.deepEqual(grown.colliders, today.colliders);
  grown.props.forEach((prop, k) => {
    for (const key of Object.keys(prop)) assert.ok(prop[key] === today.props[k][key] || Math.abs(prop[key] - today.props[k][key]) < 1e-9, `prop ${k} ${key}`);
  });
  const shared = baseMapForDomain(SEED, domainBounds(DOMAIN));
  assert.deepEqual(shared.props, today.props);
  assert.deepEqual(shared.terrainResources, today.terrainResources);
  assert.deepEqual(shared.colliders, today.colliders);
  const ids = (map) => gmEditableBaseProps(map, BASE).map((entry) => entry.id);
  assert.ok(ids(today).length > 100);
  assert.deepEqual(ids(shared), ids(today));
});

test('baseMapForDomain: today\'s square is generated fresh, a larger domain is memoized (two kept)', () => {
  const square = domainBounds(SQUARE), a = baseMapForDomain(SEED, square);
  assert.notEqual(baseMapForDomain(SEED, square), a);
  assert.notEqual(baseMapForDomain(SEED), baseMapForDomain(SEED));
  assert.equal(a.heights.length, 561 * 561);
  assert.equal(createHash('sha256').update(new Uint8Array(a.heights.buffer, a.heights.byteOffset, a.heights.byteLength)).digest('hex'), DEFAULT_HEIGHT_SHA256);
  const east = { minX: -280, maxX: 350, minZ: -280, maxZ: 280 }, south = { minX: -280, maxX: 280, minZ: -280, maxZ: 350 };
  const first = baseMapForDomain(SEED, east);
  assert.equal(first.Nx, 631); assert.equal(first.Nz, 561);
  assert.equal(baseMapForDomain(SEED, east), first);
  assert.equal(baseMapForDomain(SEED, { ...east, cell: 1 }), first);
  const second = baseMapForDomain(SEED, south);
  assert.notEqual(second, first);
  assert.equal(baseMapForDomain(SEED, east), first); assert.equal(baseMapForDomain(SEED, south), second);
  const third = baseMapForDomain(SEED, domainBounds(DOMAIN)); // evicts the least recently used: east was read last before south
  assert.equal(third.Nx, 1121);
  assert.equal(baseMapForDomain(SEED, domainBounds(DOMAIN)), third);
  assert.equal(baseMapForDomain(SEED, south), second);
  assert.notEqual(baseMapForDomain(SEED, east), first);
});

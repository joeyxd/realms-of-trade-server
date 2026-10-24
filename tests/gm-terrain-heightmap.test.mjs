// GM08d: heightmap export and import. The compiled heights leave as a 16-bit grayscale PNG with a JSON sidecar and come
// back (from the PNG alone) to within a millimetre; a PNG of any filter, 8 or 16 bits, grey or colour, or a square
// Unreal .r16 maps to a [min, max] range, resamples to the grid and applies as one region commit with the edit clip and
// clamps, which undo reverses whole. No three, no docs/ or tools/: it can run in the deploy gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument, createDocumentHistory } from '../src/editor/document.js';
import { terrainEditWeights, TERRAIN_GRID_SIZE, TERRAIN_MIN_HEIGHT } from '../src/editor/terrainData.js';
import { TerrainSession, openTerrainDocument, tileReferences } from '../src/editor/terrainSession.js';
import { GRID_FLOOR } from '../src/editor/terrainSculpt.js';
import { decodeHeightmap, exportHeightmap, HEIGHTMAP_FORMAT, heightmapTargets, sidecarRange } from '../src/editor/terrainHeightmap.js';

const BASE = 'terrain-s21-v1';
const N = TERRAIN_GRID_SIZE;
const map = generateWorld(GAME.seed);
const share = terrainEditWeights(map);
const coded = (code) => (error) => error?.code === code;
const WHOLE = { shape: 'rect', feather: 0, points: [{ x: -280, z: -280 }, { x: 280, z: 280 }] };

async function session() {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: createDocument({ seed: map.seed, baseRevision: BASE }) });
  const history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  const terrain = new TerrainSession({ map, baseRevision: BASE, grid: opened.grid, references: tileReferences(opened.document),
    lookup: (sha256) => history.tile(sha256) });
  const commit = async (options) => {
    const result = await terrain.commit({ document: history.current(), ...options });
    history.commit(result.document, { tiles: result.tiles });
    return result;
  };
  return { history, terrain, commit };
}

// A PNG built by node:zlib with a chosen filter per row (a reference encoder for the decoder).
function png({ width, height, depth, color, sample, filters = [0, 1, 2, 3, 4] }) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color], bpp = channels * depth / 8, stride = width * bpp;
  const rows = [], scan = [];
  for (let j = 0; j < height; j++) {
    const row = new Uint8Array(stride);
    for (let i = 0; i < width; i++) for (let c = 0; c < channels; c++) {
      const value = c ? 1234 * (c + i) & (depth === 16 ? 65535 : 255) : sample(i, j), at = i * bpp + c * depth / 8;
      if (depth === 16) { row[at] = value >>> 8; row[at + 1] = value & 255; } else row[at] = value;
    }
    rows.push(row);
  }
  rows.forEach((row, j) => {
    const prior = j ? rows[j - 1] : new Uint8Array(stride), filter = filters[j % filters.length], out = new Uint8Array(stride + 1);
    out[0] = filter;
    for (let n = 0; n < stride; n++) {
      const a = n >= bpp ? row[n - bpp] : 0, b = prior[n], c = n >= bpp ? prior[n - bpp] : 0, p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[n + 1] = (row[n] - [0, a, b, (a + b) >>> 1, paeth][filter]) & 255;
    }
    scan.push(out);
  });
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = color;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(scan))), chunk('IEND', Buffer.alloc(0))]));
}

test('GM08d export: a 561 x 561 16-bit PNG whose own sidecar brings the heights back within a millimetre', async () => {
  const started = process.cpuUsage();
  const { png: bytes, sidecar } = await exportHeightmap(map, { baseRevision: BASE });
  const exportMs = process.cpuUsage(started).user / 1000;
  assert.equal(sidecar.format, HEIGHTMAP_FORMAT);
  assert.deepEqual([sidecar.width, sidecar.height, sidecar.baseRevision, sidecar.origin], [N, N, BASE, { x: -280, z: -280 }]);
  assert.equal(sidecar.min, map.heights.reduce((a, b) => Math.min(a, b)));
  assert.equal(sidecar.max, map.heights.reduce((a, b) => Math.max(a, b)));
  const image = await decodeHeightmap(bytes, 'whatever.bin');
  assert.deepEqual([image.kind, image.width, image.height], ['png', N, N]);
  assert.deepEqual(image.sidecar, JSON.parse(JSON.stringify(sidecar)));
  const targets = heightmapTargets(image, sidecarRange(image.sidecar));
  let worst = 0;
  for (let k = 0; k < N * N; k++) worst = Math.max(worst, Math.abs(targets[k] - map.heights[k]));
  assert.ok(worst <= sidecar.metresPerUnit / 2 + 1e-5, `worst ${worst}`);
  // Row 0 is z = -half and column 0 is x = -half.
  assert.ok(Math.abs(targets[N * 10 + 300] - map.heightAt(300 - 280, 10 - 280)) < 1e-3);
  console.log(`GM08d export: ${bytes.length} B PNG, ${exportMs.toFixed(0)} ms CPU, range ${sidecar.min}..${sidecar.max.toFixed(2)} m, worst ${(worst * 1000).toFixed(2)} mm`);
});

test('GM08d decode: every PNG filter, 8 and 16 bits, grey and colour; .r16 square little-endian; refusals', async () => {
  const sample16 = (i, j) => (i * 977 + j * 3001 + i * j * 13) & 65535, sample8 = (i, j) => (i * 7 + j * 31) & 255;
  for (const color of [0, 2, 4, 6]) {
    const sixteen = await decodeHeightmap(png({ width: 13, height: 11, depth: 16, color, sample: sample16 }));
    assert.deepEqual([sixteen.width, sixteen.height, sixteen.sidecar], [13, 11, null]);
    for (let j = 0; j < 11; j++) for (let i = 0; i < 13; i++) assert.equal(sixteen.values[j * 13 + i], sample16(i, j), `16-bit colour ${color} at ${i},${j}`);
    const eight = await decodeHeightmap(png({ width: 9, height: 12, depth: 8, color, sample: sample8 }));
    for (let j = 0; j < 12; j++) for (let i = 0; i < 9; i++) assert.equal(eight.values[j * 9 + i], sample8(i, j) * 257, `8-bit colour ${color} at ${i},${j}`);
  }
  const raw = new Uint8Array(3 * 3 * 2), view = new DataView(raw.buffer);
  for (let n = 0; n < 9; n++) view.setUint16(n * 2, n * 7000, true);
  const r16 = await decodeHeightmap(raw, 'Landscape.r16');
  assert.deepEqual([r16.kind, r16.width, r16.height, [...r16.values]], ['r16', 3, 3, [0, 7000, 14000, 21000, 28000, 35000, 42000, 49000, 56000]]);
  await assert.rejects(decodeHeightmap(raw.subarray(0, 16), 'odd.r16'), coded('r16_size'));
  await assert.rejects(decodeHeightmap(raw, 'picture.jpg'), coded('format'));
  await assert.rejects(decodeHeightmap(png({ width: 4, height: 4, depth: 16, color: 3, sample: () => 0 })), coded('png_format'));
  const broken = png({ width: 4, height: 4, depth: 16, color: 0, sample: () => 9 }); broken[40] ^= 1;
  await assert.rejects(decodeHeightmap(broken), coded('png'));
  const huge = new Uint8Array(png({ width: 2, height: 2, depth: 8, color: 0, sample: () => 0 }));
  new DataView(huge.buffer).setUint32(16, 9000);
  await assert.rejects(decodeHeightmap(huge), coded('png'), 'the CRC catches a size edited in place');
});

test('GM08d resample: corners land on the map corners, bilinear in between; the range is checked', () => {
  const image = { width: 2, height: 2, values: Uint16Array.of(0, 65535, 65535, 0) };
  const targets = heightmapTargets(image, { min: 10, max: 30 });
  assert.equal(targets.length, N * N);
  assert.deepEqual([targets[0], targets[N - 1], targets[(N - 1) * N], targets[N * N - 1]], [10, 30, 30, 10]);
  assert.ok(Math.abs(targets[280 * N + 280] - 20) < 1e-9);
  assert.ok(Math.abs(targets[280] - 20) < 1e-9);
  for (const range of [{ min: 5, max: 5 }, { min: -41, max: 10 }, { min: 0, max: 201 }, { min: NaN, max: 1 }])
    assert.throws(() => heightmapTargets(image, range), coded('range'));
  assert.throws(() => heightmapTargets({ ...image, values: new Uint16Array(3) }, { min: 0, max: 1 }), coded('size'));
  assert.equal(sidecarRange({ format: 'other', min: 0, max: 1 }), null);
});

test('GM08d import: one commit levels editable ground to the targets with the clip and clamps; undo reverses it whole', async () => {
  const { history, terrain, commit } = await session();
  const before = history.current(), base = terrain.surface().heights;
  const flat = (metres) => heightmapTargets({ width: 2, height: 2, values: new Uint16Array(4).fill(65535) }, { min: metres - 1, max: metres });
  const started = process.cpuUsage();
  const result = await commit({ tool: 'heightmap', targets: flat(12), region: WHOLE });
  const importMs = process.cpuUsage(started).user / 1000;
  const after = result.map.heights;
  let full = 0, moved = 0;
  for (let k = 0; k < N * N; k++) {
    if (share[k] === 0) { assert.equal(after[k], base[k], `protected vertex ${k} moved`); continue; }
    moved++;
    if (share[k] === 1) { full++; assert.ok(Math.abs(after[k] - 12) <= 1e-3, `vertex ${k}: ${after[k]}`); }
    else assert.ok(Math.min(base[k], 12) - 1e-3 <= after[k] && after[k] <= Math.max(base[k], 12) + 1e-3);
  }
  assert.ok(full > 10000 && moved > full, `${full} full, ${moved} moved`);
  // The floor clamp: a target in the sea leaves editable ground at the floor (2 mm inside it, for the millimetre
  // rounding of the tiles), never below 0.75 m.
  const sunk = (await commit({ tool: 'heightmap', targets: flat(-30), region: WHOLE })).map.heights;
  let floored = 0;
  for (let k = 0; k < N * N; k++) {
    if (share[k] === 0) continue;
    assert.ok(sunk[k] >= Math.min(base[k], TERRAIN_MIN_HEIGHT) - 1e-6, `vertex ${k} under the floor`);
    if (share[k] === 1 && Math.abs(sunk[k] - GRID_FLOOR) <= 1e-3) floored++;
  }
  assert.ok(floored > 10000, `${floored} at the floor`);
  history.undo(); history.undo();
  assert.deepEqual(history.current(), before);
  assert.deepEqual([...terrain.surfaceFor(history.current()).heights.subarray(0, 2000)], [...base.subarray(0, 2000)]);
  // A held region limits the import to its outline.
  const inside = { shape: 'rect', feather: 0, points: [{ x: -20, z: -20 }, { x: 20, z: 20 }] };
  const local = (await commit({ tool: 'heightmap', targets: flat(12), region: inside })).map.heights;
  for (let k = 0; k < N * N; k++) {
    const x = k % N - 280, z = Math.floor(k / N) - 280;
    if (Math.abs(x) > 20 || Math.abs(z) > 20) assert.equal(local[k], base[k], `vertex ${x},${z} outside the region moved`);
  }
  await assert.rejects(commit({ tool: 'heightmap', targets: new Float64Array(5), region: WHOLE }), coded('parameters'));
  console.log(`GM08d import: whole map ${importMs.toFixed(0)} ms CPU, ${moved} vertices moved (${full} fully)`);
});

test('GM08d round trip on the session: exporting the draft and importing it back changes no height by more than 1 mm', async () => {
  const { terrain, commit } = await session();
  await commit({ tool: 'heightmap', targets: heightmapTargets({ width: 2, height: 2, values: Uint16Array.of(0, 65535, 30000, 9000) },
    { min: 1, max: 25 }), region: WHOLE });
  const edited = terrain.surface();
  const { png: bytes } = await exportHeightmap(edited, { baseRevision: BASE });
  const image = await decodeHeightmap(bytes);
  const back = (await commit({ tool: 'heightmap', targets: heightmapTargets(image, sidecarRange(image.sidecar)), region: WHOLE })).map.heights;
  let worst = 0;
  for (let k = 0; k < N * N; k++) worst = Math.max(worst, Math.abs(back[k] - edited.heights[k]));
  assert.ok(worst <= 1.001e-3, `worst ${worst}`);
});

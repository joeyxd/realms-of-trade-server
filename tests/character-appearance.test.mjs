import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  APPEARANCE_CHOICES, BODY_SPECS, DEFAULT_APPEARANCE, assembleAppearance,
  normalizeAppearance,
} from '../tools/character-appearance-v1/assemble.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = path.join(root, 'docs/art/source/character-appearance-v1/appearance-receipt.json');
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const array = attribute => Array.from(attribute.array);
const part = (assembly, family) => assembly.parts.find(item => item.family === family);

function assertGeometry(geometry, label) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const indices = geometry.index.array;
  assert.ok(position.count > 0 && indices.length > 0, `${label}: geometry is empty`);
  assert.equal(indices.length % 3, 0, `${label}: index count is not triangular`);
  assert.ok(array(position).every(Number.isFinite), `${label}: non-finite position`);
  assert.ok(array(normal).every(Number.isFinite), `${label}: non-finite normal`);
  assert.ok(array(uv).every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${label}: UV outside [0,1]`);
  assert.ok(array(weights).every(Number.isFinite), `${label}: non-finite skin weight`);
  assert.ok(array(geometry.getAttribute('color')).every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${label}: invalid color`);
  assert.ok(indices.every(i => i >= 0 && i < position.count), `${label}: invalid vertex index`);
  for (let i = 0; i < position.count; i++) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
    assert.ok(Math.abs(length - 1) < 0.025, `${label}: normal ${i} has length ${length}`);
    const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
    assert.ok(Math.abs(sum - 1) < 1e-6, `${label}: skin weights for vertex ${i} sum to ${sum}`);
    assert.equal(joints.getX(i), 8, `${label}: vertex ${i} is not bound to head joint 8`);
    assert.equal(weights.getX(i), 1, `${label}: vertex ${i} is not fully weighted to its head joint`);
    assert.equal(weights.getY(i) + weights.getZ(i) + weights.getW(i), 0, `${label}: unexpected secondary skin weights`);
  }

  let minArea = Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const abx = position.getX(b) - position.getX(a), aby = position.getY(b) - position.getY(a), abz = position.getZ(b) - position.getZ(a);
    const acx = position.getX(c) - position.getX(a), acy = position.getY(c) - position.getY(a), acz = position.getZ(c) - position.getZ(a);
    const area = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) / 2;
    minArea = Math.min(minArea, area);
  }
  assert.ok(minArea > 1e-12, `${label}: degenerate triangle area ${minArea}`);
  assert.ok(position.count <= 3_000, `${label}: vertex budget exceeded (${position.count})`);
  assert.ok(indices.length / 3 <= 2_000, `${label}: module triangle budget exceeded (${indices.length / 3})`);
}

function snapshot(assembly) {
  return assembly.parts.map(({ name, family, geometry }) => ({
    name, family,
    position: array(geometry.getAttribute('position')),
    index: Array.from(geometry.index.array),
    color: array(geometry.getAttribute('color')),
  }));
}

test('appearance catalog exposes the required options for both body bases', () => {
  assert.deepEqual(APPEARANCE_CHOICES.hairId.map(item => item.id), ['none', 'scout', 'swept', 'pony', 'crop']);
  assert.deepEqual(APPEARANCE_CHOICES.beardId.map(item => item.id), ['none', 'stubble', 'full']);
  assert.equal(APPEARANCE_CHOICES.eyesId.length, 3);
  assert.equal(APPEARANCE_CHOICES.browsId.length, 3);
  assert.equal(APPEARANCE_CHOICES.irisPaletteId.length, 4);
  for (const kind of ['male', 'female']) {
    for (const key of ['hairId', 'beardId', 'eyesId', 'browsId']) for (const choice of APPEARANCE_CHOICES[key]) {
      const assembled = assembleAppearance(kind, { ...DEFAULT_APPEARANCE, [key]: choice.id });
      for (const item of assembled.parts) assertGeometry(item.geometry, `${kind}/${key}/${choice.id}/${item.family}`);
    }
  }
  assert.ok(Math.abs(BODY_SPECS.male.neck - BODY_SPECS.female.neck - 0.03) < 1e-9);
});

test('malformed and unknown appearance values normalize to a closed safe descriptor', () => {
  const expected = normalizeAppearance(DEFAULT_APPEARANCE);
  for (const malformed of [null, 42, 'scout', [], { v: 100, hairId: '../arbitrary', beardId: 'made-up', eyesId: null, custom: 'field' }]) {
    assert.deepEqual(normalizeAppearance(malformed), expected);
  }
  const sanitized = normalizeAppearance({ ...DEFAULT_APPEARANCE, hairId: 'unknown', custom: 'payload', prototype: { polluted: true } });
  assert.deepEqual(sanitized, expected);
  assert.deepEqual(Object.keys(sanitized).sort(), [...new Set([...Object.keys(DEFAULT_APPEARANCE), 'v'])].sort());
  assert.equal(Object.hasOwn(sanitized, 'custom'), false);
});

test('none choices omit their geometry families', () => {
  const assembled = assembleAppearance('male', { ...DEFAULT_APPEARANCE, hairId: 'none', beardId: 'none' });
  assert.equal(part(assembled, 'hair'), undefined);
  assert.equal(part(assembled, 'beard'), undefined);
});

test('each recolor changes only its own family colors while geometry stays fixed', () => {
  const cases = [
    ['hairPaletteId', 'hair', 'copper'],
    ['beardPaletteId', 'beard', 'silver'],
    ['browPaletteId', 'brows', 'black'],
    ['irisPaletteId', 'eyes', 'sea'],
  ];
  const base = { ...DEFAULT_APPEARANCE, beardId: 'full' };
  for (const kind of ['male', 'female']) for (const [key, family, value] of cases) {
    const before = assembleAppearance(kind, base);
    const after = assembleAppearance(kind, { ...base, [key]: value });
    assert.deepEqual(after.parts.map(({ name, family: f }) => [name, f]), before.parts.map(({ name, family: f }) => [name, f]));
    let targetChanged = false;
    for (let i = 0; i < before.parts.length; i++) {
      const a = before.parts[i], b = after.parts[i];
      assert.deepEqual(array(a.geometry.getAttribute('position')), array(b.geometry.getAttribute('position')), `${kind}/${key}: positions changed`);
      assert.deepEqual(Array.from(a.geometry.index.array), Array.from(b.geometry.index.array), `${kind}/${key}: indices changed`);
      const colorsA = array(a.geometry.getAttribute('color'));
      const colorsB = array(b.geometry.getAttribute('color'));
      if (a.family === family) targetChanged ||= colorsA.some((color, index) => color !== colorsB[index]);
      else assert.deepEqual(colorsB, colorsA, `${kind}/${key}: recolor leaked into ${a.family}`);
    }
    assert.ok(targetChanged, `${kind}/${key}: selected family ${family} did not change color`);
  }
});

test('A to B to A swaps are deterministic in vertices, indices, and colors', () => {
  for (const kind of ['male', 'female']) for (const [key, a, b] of [
    ['hairId', 'scout', 'pony'], ['beardId', 'stubble', 'full'], ['browsId', 'natural', 'arched'], ['irisPaletteId', 'amber', 'slate'],
  ]) {
    const original = { ...DEFAULT_APPEARANCE, [key]: a, ...(key === 'beardId' ? {} : { beardId: 'full' }) };
    const first = snapshot(assembleAppearance(kind, original));
    snapshot(assembleAppearance(kind, { ...original, [key]: b }));
    const returned = snapshot(assembleAppearance(kind, { ...original, [key]: a }));
    assert.deepEqual(returned, first, `${kind}/${key}: A→B→A did not reproduce original geometry`);
  }
});

test('appearance receipt preserves the v3 body and head source hashes', () => {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  for (const source of ['body.mjs', 'head.mjs']) {
    assert.equal(receipt.dependencies[source], sha256(path.join(root, 'tools/characters-base-v3', source)), `${source} changed from the appearance receipt`);
  }
});

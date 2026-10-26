import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { createFilmTransform, createFilmLUT } from '../../src/render/vfx/niagara/film-color.js';
import { FILM_SOURCE_SHA256 } from '../../src/render/vfx/niagara/film-identity.js';
const bytes = fs.readFileSync(new URL('../../src/render/vfx/niagara/film-source.json', import.meta.url));
const source = JSON.parse(bytes);

test('pinned neutral Filmic profile has finite monotone grey and no capture-state input', () => {
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), FILM_SOURCE_SHA256);
  const transform = createFilmTransform(source);
  assert.deepEqual(transform.encode([0, 0, 0]), [0, 0, 0]);
  let previous = 0;
  for (const level of [.0001, .001, .01, .08, .18, .5, 1, 4, 32, 65504]) {
    const rgb = transform.encode([level, level, level]);
    assert.ok(rgb.every(Number.isFinite)); assert.ok(rgb[0] >= previous); previous = rgb[0];
    assert.ok(Math.max(...rgb)-Math.min(...rgb) < .0001);
  }
  assert.ok(transform.encode([.18, .18, .18]).every(v => Math.abs(v-.46135613) < .00001));
  for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [40, 8, .8], [.02, .8, .4]]) assert.ok(transform.encode(rgb).every(Number.isFinite));
});

test('source-derived LUT is bounded, repeatable, input-preserving and releasable', () => {
  const before = structuredClone(source), first = createFilmLUT(source), second = createFilmLUT(source);
  assert.deepEqual(source, before); assert.deepEqual(first.texture.image.data, second.texture.image.data);
  assert.equal(first.generatedBytes, 262144); assert.equal(first.texture.image.width, 32);
  assert.ok(Array.from(first.texture.image.data, THREE.DataUtils.fromHalfFloat).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  let disposed = 0; first.texture.addEventListener('dispose', () => disposed++); first.texture.dispose(); second.texture.dispose();
  assert.equal(disposed, 1);
});

test('unsupported profiles and nonfinite scene input fail before the color pipeline', () => {
  for (const mutation of [p => { p.controls.FilmSlope = .5; }, p => { p.lut.size = 64; },
    p => { p.matrices.AP0_2_XYZ_MAT[0][0] = NaN; }, p => { p.captureInputs = true; }]) {
    const other = structuredClone(source); mutation(other); assert.throws(() => createFilmTransform(other));
  }
  const transform = createFilmTransform(source);
  for (const rgb of [[NaN, 0, 0], [-1, 0, 0], [Infinity, 0, 0], [65505, 0, 0], [1, 1]]) assert.throws(() => transform.encode(rgb));
});

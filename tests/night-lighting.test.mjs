import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Lighting, PRESETS } from '../src/render/lighting.js';

const black = (color) => color.r < 1e-8 && color.g < 1e-8 && color.b < 1e-8;

test('midnight preset removes global fill while retaining independent local-source controls', () => {
  const night = PRESETS.night;
  assert.ok(night.sunI <= 0.02);
  assert.ok(night.hemiI <= 0.02);
  assert.ok(black(night.fill));
  assert.equal(night.rim.getHex(), 0);
  assert.equal(night.player, undefined, 'there is no automatic camera-side light preset');
  assert.equal(night.fire, 1);
  assert.equal(night.lavaLight, 1);
  assert.equal(night.windows, 1);
});

test('live gameplay follows the supplied server phase even when saved TOD says day', () => {
  const lighting = new Lighting(new THREE.Scene());
  lighting.setTimeOfDay('day', 0);
  lighting.setGameplay(true);
  lighting.update(0, new THREE.Vector3(), 0.75);
  assert.ok(lighting.cur.sunI <= 0.02, `server midnight phase should be dark, got ${lighting.cur.sunI}`);
  assert.ok(lighting.cur.hemiI <= 0.02);
  assert.ok(black(lighting.cur.fill));

  lighting.update(0, new THREE.Vector3(), 0.08);
  assert.ok(lighting.cur.sunI > 2, 'the server phase restores daytime');
  lighting.setGameplay(false);
  lighting.setTimeOfDay('night', 0);
  lighting.update(0, new THREE.Vector3(), 0.08);
  assert.ok(lighting.cur.sunI <= 0.02, 'explicit menu/QA override remains available outside gameplay');
});

test('Caldera night keeps local fire strength without restoring global ambient or water fill', () => {
  const lighting = new Lighting(new THREE.Scene());
  lighting.setGameplay(true);
  lighting.setZone(true, 0);
  lighting.update(0.02, new THREE.Vector3(), 0.75);
  assert.equal(lighting.zoneW, 1);
  assert.ok(lighting.cur.sunI <= 0.02);
  assert.ok(lighting.cur.hemiI <= 0.02);
  assert.ok(black(lighting.cur.fill));
  assert.equal(lighting.cur.rim.getHex(), 0);
  assert.ok(lighting.cur.water.r < 0.02 && lighting.cur.water.g < 0.02 && lighting.cur.water.b < 0.02);
  assert.equal(lighting.cur.lavaLight, PRESETS.volcanic.lavaLight);
  assert.equal(lighting.cur.fire, PRESETS.volcanic.fire);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Lighting, PRESETS } from '../src/render/lighting.js';

const black = (color) => color.r < 1e-8 && color.g < 1e-8 && color.b < 1e-8;
// VR01 night contract: no sun, no rim, no additive fill; the darkness is a dim navy hemisphere
// (blue-dominant sky colour, ground darker still) strong enough to tint the unlit areas.
const navyHemisphere = (p, tag) => {
  assert.ok(p.hemiI >= 1, `${tag}: the night keeps a strong hemisphere fill, got ${p.hemiI}`);
  assert.ok(p.hemiSky.b > 3 * Math.max(p.hemiSky.r, p.hemiSky.g), `${tag}: the hemisphere sky is navy`);
  assert.ok(p.hemiSky.b < 0.35, `${tag}: the navy stays dim`);
  assert.ok(p.hemiGround.b < p.hemiSky.b, `${tag}: the ground side is darker than the sky side`);
};

test('midnight preset keeps a dim navy hemisphere, drops sun, rim and fill, and retains independent local-source controls', () => {
  const night = PRESETS.night;
  assert.ok(night.sunI <= 0.02);
  navyHemisphere(night, 'preset');
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
  navyHemisphere(lighting.cur, 'server midnight');
  assert.ok(black(lighting.cur.fill));

  lighting.update(0, new THREE.Vector3(), 0.08);
  assert.ok(lighting.cur.sunI > 2, 'the server phase restores daytime');
  assert.ok(lighting.cur.hemiI < PRESETS.night.hemiI, 'daytime hemisphere is weaker than the night fill');
  lighting.setGameplay(false);
  lighting.setTimeOfDay('night', 0);
  lighting.update(0, new THREE.Vector3(), 0.08);
  assert.ok(lighting.cur.sunI <= 0.02, 'explicit menu/QA override remains available outside gameplay');
  navyHemisphere(lighting.cur, 'menu night');
});

test('Caldera night keeps local fire strength and the night hemisphere level without restoring sun, rim or water fill', () => {
  const lighting = new Lighting(new THREE.Scene());
  lighting.setGameplay(true);
  lighting.setZone(true, 0);
  lighting.update(0.02, new THREE.Vector3(), 0.75);
  assert.equal(lighting.zoneW, 1);
  assert.ok(lighting.cur.sunI <= 0.02);
  assert.equal(lighting.cur.hemiI, PRESETS.night.hemiI, 'the zone tints the hemisphere but does not lift its night level');
  assert.equal(lighting.cur.hemiSky.getHex(), PRESETS.volcanic.hemiSky.getHex(), 'smoke tint replaces the navy sky side');
  assert.ok(black(lighting.cur.fill));
  assert.equal(lighting.cur.rim.getHex(), 0);
  assert.ok(lighting.cur.water.r < 0.02 && lighting.cur.water.g < 0.02 && lighting.cur.water.b < 0.02);
  assert.equal(lighting.cur.lavaLight, PRESETS.volcanic.lavaLight);
  assert.equal(lighting.cur.fire, PRESETS.volcanic.fire);
});

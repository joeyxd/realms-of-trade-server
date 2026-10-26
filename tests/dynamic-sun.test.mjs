import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Lighting, arcDir } from '../src/render/lighting.js';
import { SKY, GLSL_SKY } from '../src/render/sky.js';

// VR11 (playtest R2): the sun follows the synced clock on an east-to-west arc (north is -z, east +x), the moon takes
// the light at night, the sky glows toward the low sun, and the shadow box fits a low sun.
const D = 180 / Math.PI;
const el = (v) => Math.asin(v.y) * D;
const at = (phase, zone = false) => {
  const lighting = new Lighting(new THREE.Scene());
  lighting.setGameplay(true);
  lighting.setZone(zone, 0);
  lighting.update(0.02, new THREE.Vector3(), phase);
  return lighting;
};

test('the sun rises in the east, stands due south at noon and sets in the west, up only outside the night preset', () => {
  const v = new THREE.Vector3();
  assert.ok(Math.abs(el(arcDir(0.6, 11, v))) < 0.1, 'sets as the night preset arrives (0.6)');
  assert.ok(Math.abs(el(arcDir(0.9, 11, v))) < 0.1, 'rises as the night preset ends (0.9)');
  for (let ph = 0.91; ph < 1.59; ph += 0.02) assert.ok(el(arcDir(ph % 1, 11, v)) > 0, `up at ${(ph % 1).toFixed(2)}`);
  for (let ph = 0.61; ph < 0.9; ph += 0.02) assert.ok(el(arcDir(ph, 11, v)) < 0, `down at ${ph.toFixed(2)}`);
  arcDir(0.25, 11, v);
  assert.ok(Math.abs(el(v) - 66) < 0.1 && Math.abs(v.x) < 1e-6 && v.z > 0, 'noon: due south (+z), 66 degrees');
  assert.ok(arcDir(0.95, 11, v).x > 0.9, 'morning sun in the east');
  assert.ok(arcDir(0.55, 11, v).x < -0.9, 'evening sun in the west');
  let prev = -Infinity;
  for (let ph = 0.9; ph <= 1.25; ph += 0.01) { const e = el(arcDir(ph % 1, 11, v)); assert.ok(e > prev, 'climbs until noon'); prev = e; }
});

test('the light follows the sun azimuth by day, never grazes, and the fixed day keeps the old light', () => {
  for (const ph of [0.95, 0.05, 0.15, 0.25, 0.35, 0.45, 0.55]) {
    const l = at(ph), d = l.dir, s = l.sunPos;
    const azL = Math.atan2(d.z, d.x), azS = Math.atan2(s.z, s.x);
    assert.ok(Math.abs(azL - azS) < 0.01, `same azimuth at ${ph}`);
    assert.ok(d.y > 0.37, `flat ground stays lit above the toon band edge at ${ph} (N.L ${d.y.toFixed(3)})`);
  }
  assert.ok(at(0.05).dir.x > 0.5 && at(0.45).dir.x < -0.5, 'morning light from the east, evening light from the west');
  const day = new Lighting(new THREE.Scene());
  day.setTimeOfDay('day', 0);
  day.update(0.02, new THREE.Vector3());
  assert.ok(Math.abs(el(day.dir) - 54) < 1, `fixed day elevation ${el(day.dir).toFixed(1)}`);
  assert.ok(Math.abs(Math.atan2(day.dir.z, -day.dir.x) * D - 28) < 3, 'fixed day azimuth');
});

test('the moon holds the light at night and the swap to it never turns a bright light', () => {
  const night = at(0.75);
  assert.ok(night.moonPos.y > 0.6 && night.dir.y > 0.6 && night.dir.z > 0.5, 'midnight moon high in the south');
  assert.equal(night.moonW, 1);
  const l = new Lighting(new THREE.Scene());
  l.setGameplay(true);
  for (const [a, b] of [[0.55, 0.65], [0.85, 0.95]]) {
    let prev = null;
    for (let ph = a; ph <= b; ph += 0.0005) {
      l.update(0.02, new THREE.Vector3(), ph);
      if (prev) {
        const turn = Math.acos(Math.min(1, prev.dot(l.dir))) * D;
        assert.ok(turn < 1 || l.sun.intensity < 0.1, `turns ${turn.toFixed(1)} deg at intensity ${l.sun.intensity.toFixed(3)} (phase ${ph.toFixed(4)})`);
      }
      prev = l.dir.clone();
    }
  }
});

test('the shadow box fits a low sun, covers the ground around the focus and holds still between light steps', () => {
  const noon = at(0.25), low = at(0.57);
  const depth = (l) => l.sun.shadow.camera.top - l.sun.shadow.camera.bottom;
  assert.ok(depth(low) < depth(noon) && depth(low) < 40, `low sun box ${depth(low).toFixed(1)} vs noon ${depth(noon).toFixed(1)}`);
  for (const l of [noon, low, at(0.05), at(0.45)]) {
    const cam = l.sun.shadow.camera, R = l.shadowHalf, p = new THREE.Vector3();
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) for (const h of [0, 8]) {
      p.set(Math.cos(a) * R * 0.98, h, Math.sin(a) * R * 0.98).sub(l.target.position).applyMatrix4(l.inv);
      const awayFromSun = Math.cos(a) * l.dir.x + Math.sin(a) * l.dir.z < 0;
      if (h && !awayFromSun) continue;
      assert.ok(p.x >= cam.left && p.x <= cam.right && p.y >= cam.bottom && p.y <= cam.top, `ground point ${a.toFixed(2)} h${h} inside the box`);
    }
  }
  const l = new Lighting(new THREE.Scene());
  l.setGameplay(true);
  l.update(0.02, new THREE.Vector3(3, 0, 4), 0.3);
  const dir = l.dir.clone(), pos = l.target.position.clone();
  l.update(0.02, new THREE.Vector3(3, 0, 4), 0.3002);
  assert.ok(l.dir.equals(dir) && l.target.position.equals(pos), 'a sub-step change of the sun leaves the shadow map still');
  l.update(0.02, new THREE.Vector3(3, 0, 4), 0.31);
  assert.ok(!l.dir.equals(dir), 'the light steps on');
});

test('the twilight glows toward the low sun at dusk and dawn, not by day, at midnight or in La Caldera', () => {
  assert.equal(at(0.25) && SKY.skyTwilightW.value, 0);
  at(0.75);
  assert.equal(SKY.skyTwilightW.value, 0);
  at(0.595);
  assert.ok(SKY.skyTwilightW.value > 0.7, 'sunset');
  at(0.905);
  assert.ok(SKY.skyTwilightW.value > 0.7, 'dawn');
  at(0.595, true);
  assert.ok(SKY.skyTwilightW.value < 0.05, 'the Caldera smoke hides it');
  at(0.53);
  assert.ok(SKY.skySun.value.x < -0.9 && SKY.skySun.value.y > 0.2, 'the sky draws the sun where it is');
  assert.match(GLSL_SKY, /mix\(c, skyTwilight, skyTwilightW \* toward \* toward \* toward/);
  assert.match(GLSL_SKY, /dot\(dir, skySun\)/);
  assert.match(GLSL_SKY, /dot\(dir, skyMoon\)/);
});

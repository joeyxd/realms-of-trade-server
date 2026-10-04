// Local lights and lighting presets (needs `three` from devDependencies; skipped when it is not installed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';

let mod = null;
try {
  const THREE = await import('three');
  const { LocalLights } = await import('../src/render/lights.js');
  const { U } = await import('../src/render/toon.js');
  mod = { THREE, LocalLights, U };
} catch { mod = null; }
const opts = mod ? {} : { skip: 'three is not installed (npm install)' };
const map = generateWorld(GAME.seed);

// Walk spawn → village → Caldera gate → arena centre in small steps.
function route(step = 0.25) {
  const L = map.landmarks;
  const g = map.props.find((p) => p.kind === 'gatePost');
  const pts = [L.spawn, L.village, g, L.arena];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step);
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: 0, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

test('light sources come from the island props', opts, () => {
  const lights = new mod.LocalLights(map);
  const count = (k) => lights.sources.filter((s) => s.kind === k).length;
  assert.equal(count('lantern'), map.props.filter((p) => p.kind === 'lantern').length);
  assert.ok(count('lantern') >= 8, 'path + dock lanterns');
  assert.equal(count('window'), map.props.filter((p) => p.kind === 'hut').length);
  assert.ok(count('brazier') >= 8, 'arena braziers + gate fires');
  assert.equal(count('campfire'), 2, 'the village and the Cala Calavera');
  assert.ok(count('lava') >= 3, 'lava river and crater');
  assert.equal(count('eyes'), 2);
});

test('light selection fits every tier and never pops', opts, () => {
  for (const max of [4, 8, 12]) {
    const lights = new mod.LocalLights(map);
    lights.max = max;
    Object.assign(lights.knobs, { fire: 1, lava: 1, night: 1, eyes: 1, player: 1 });
    const prev = new Map();
    let peak = 0;
    const path = route();
    lights.update(1 / 60, path[0], path[0]);
    for (const s of lights.sources) prev.set(s, s.w);
    for (const f of path) {
      lights.update(1 / 60, f, f);
      assert.ok(mod.U.mnLightCount.value <= max, `count ${mod.U.mnLightCount.value} > ${max}`);
      for (const s of lights.sources) {
        const w0 = prev.get(s) ?? 0;
        peak = Math.max(peak, Math.abs(s.w - w0));
        prev.set(s, s.w);
      }
    }
    assert.ok(peak < 0.12, `max ${max}: a light weight jumped by ${peak.toFixed(3)} in one 0.25 u step`);
  }
});

test('flashes and the player light never push a static light out', opts, () => {
  const lights = new mod.LocalLights(map);
  lights.max = 8;
  Object.assign(lights.knobs, { fire: 1, lava: 1, night: 1, eyes: 1, player: 0 });
  const f = map.landmarks.village;
  lights.update(1 / 60, f, f);
  const before = lights.sources.map((s) => s.w);
  lights.knobs.player = 1;
  lights.flash(f.x, 1, f.z, 0x3bf0ff);
  lights.flash(f.x + 1, 1, f.z, 0x3bf0ff);
  lights.update(1 / 60, f, f);
  assert.deepEqual(lights.sources.map((s) => s.w), before);
  assert.equal(mod.U.mnLightCount.value, 8);
});

test('preset knobs switch light groups off', opts, () => {
  const lights = new mod.LocalLights(map);
  lights.max = 12;
  Object.assign(lights.knobs, { fire: 1, lava: 1, night: 0, eyes: 1, player: 0 });
  const v = map.landmarks.village;
  lights.update(1 / 60, v, v);
  assert.ok(lights.sources.filter((s) => s.kind === 'window').every((s) => s.w === 0), 'no hut windows by day');
  lights.knobs.night = 1;
  lights.update(1 / 60, v, v);
  assert.ok(lights.sources.some((s) => s.kind === 'window' && s.w > 0), 'hut windows at night');
});

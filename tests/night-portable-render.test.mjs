import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { LocalLights } from '../src/render/lights.js';
import { U } from '../src/render/toon.js';
import { CharacterView } from '../src/render/characters.js';
import { personalLanternPoint, PERSONAL_LANTERN_LOCAL } from '../src/render/personalLantern.js';

const map = generateWorld(GAME.seed);

test('belt lantern mesh and light use the same yawed character-local anchor', () => {
  assert.deepEqual(personalLanternPoint({ x: 2, y: 3, z: 4, f: 0 }), {
    x: 2 + PERSONAL_LANTERN_LOCAL.x, y: 3 + PERSONAL_LANTERN_LOCAL.y, z: 4 + PERSONAL_LANTERN_LOCAL.z,
  });
  const rotated = personalLanternPoint({ x: 2, y: 3, z: 4, f: Math.PI / 2 });
  assert.ok(Math.abs(rotated.x - (2 + PERSONAL_LANTERN_LOCAL.z)) < 1e-10);
  assert.ok(Math.abs(rotated.z - (4 - PERSONAL_LANTERN_LOCAL.x)) < 1e-10);
  assert.equal(personalLanternPoint({ x: 1, y: 2, z: 3, f: NaN }), null);
});

test('portable source membership is stable while lit and disappears immediately when off', () => {
  const lights = new LocalLights(map);
  const record = { id: 'human:1', x: 3, y: 1.2, z: -5, f: 0, lit: true, own: true };
  lights.setPortableLights([record]);
  const source = lights.portableSources.get(record.id);
  assert.ok(source);
  assert.deepEqual({ x: source.x, y: source.y, z: source.z }, personalLanternPoint(record));
  lights.setPortableLights([{ ...record, x: 7, z: 2, f: Math.PI / 2 }]);
  assert.equal(lights.portableSources.get(record.id), source);
  assert.deepEqual({ x: source.x, y: source.y, z: source.z }, personalLanternPoint({ ...record, x: 7, z: 2, f: Math.PI / 2 }));
  lights.setPortableLights([{ ...record, lit: false }]);
  assert.equal(lights.portableSources.has(record.id), false);
});

test('owner lamp always occupies a uniform slot at low, high, and ultra light budgets', () => {
  const lights = new LocalLights(map);
  lights.staticSources.length = 0;
  const template = new LocalLights(map).staticSources.find((s) => s.kind === 'lantern');
  for (let i = 0; i < 20; i++) lights.staticSources.push({ ...template, x: 0, z: 0, color: template.color.clone() });
  const lamp = { id: 'self', x: 180, y: 1.2, z: 160, f: Math.PI / 3, lit: true, own: true };
  const lampPoint = personalLanternPoint(lamp);
  lights.setPortableLights([lamp]);
  Object.assign(lights.knobs, { fire: 1, lava: 1, night: 1, eyes: 1, portable: 1 });
  for (const max of [4, 8, 12]) {
    lights.max = max;
    lights.update(1 / 60, { x: 0, z: 0 });
    assert.ok(lights.picked.includes(lights.portableSources.get('self')), `owner lamp selected at ${max} slots`);
    assert.ok(lights.portableSources.get('self').w > 0.99, `owner lamp remains full strength at ${max} slots`);
    assert.ok(U.mnLightCount.value <= max);
    const found = U.mnLightPos.value.slice(0, U.mnLightCount.value).some((p) =>
      Math.abs(p.x - lampPoint.x) < 1e-8 && Math.abs(p.y - lampPoint.y) < 1e-8 && Math.abs(p.z - lampPoint.z) < 1e-8);
    assert.equal(found, true, `owner lamp reaches a shader uniform at ${max} slots`);
  }
});

test('character belt lantern stays attached and toggles its emissive core without rebuilding', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  const view = new CharacterView(0, { sword: false });
  try {
    const group = view.personalLantern;
    const core = view.personalLanternCore;
    assert.ok(group.parent === view.root);
    assert.deepEqual(group.position.toArray(), [PERSONAL_LANTERN_LOCAL.x, PERSONAL_LANTERN_LOCAL.y, PERSONAL_LANTERN_LOCAL.z]);
    assert.equal(group.visible, false, 'unconfigured NPCs do not carry the human starter lantern');
    assert.equal(core.visible, false);
    view.setLantern(false, true);
    assert.equal(group.visible, true, 'a carried but unlit lantern keeps its open cage visible');
    assert.equal(core.visible, false);
    const geometry = core.geometry;
    view.setLantern(true, true);
    assert.equal(core.visible, true);
    assert.equal(core.geometry, geometry);
    view.setLantern(false, true);
    assert.equal(core.visible, false);
  } finally {
    view.root.clear();
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

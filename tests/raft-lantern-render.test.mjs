import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { LocalLights } from '../src/render/lights.js';
import { U } from '../src/render/toon.js';
import { RaftLayer } from '../src/render/rafts.js';

const map = generateWorld(GAME.seed);
const part = ['lantern', 1, 2, 1, 3];
const raftRecord = (props = {}) => ({
  id: 'lantern-test-raft', rev: 1, x: 10, y: 0.72, z: -4, yaw: Math.PI / 2,
  parts: [['foundation', 0, 0, 0, 0], part], litLanterns: [], ...props,
});

function containsVertex(mesh, x, y, z) {
  const position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) if (Math.abs(position.getX(i) - x) < 1e-4 &&
      Math.abs(position.getY(i) - y) < 1e-4 && Math.abs(position.getZ(i) - z) < 1e-4) return true;
  return false;
}

test('raft lantern core toggles without rebuilding geometry or normal-pass pairing', () => {
  const scene = new THREE.Group();
  const layer = new RaftLayer(scene, { skin: false });
  try {
    const closed = raftRecord();
    layer.update([closed], 0);
    const view = layer.views.get(closed.id);
    const core = view.lanternCores[0];
    assert.ok(core);
    assert.equal(core.visible, false);
    assert.ok(core.userData.nm, 'glow mesh keeps a matching normal-pass material');
    assert.equal(core.material.isMeshBasicMaterial, true);
    const iron = view.visual.children.find((mesh) => mesh.isMesh && mesh.userData.raftSurface === 'iron');
    assert.ok(iron, 'metal cage uses the existing merged iron batch');
    const shellCorners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      shellCorners.push([3 + sx * 0.23, 3.84 + sy * 0.275, 5 + sz * 0.23]);
    assert.equal(shellCorners.every(([x, y, z]) => containsVertex(iron, x, y, z)), false,
      'no opaque full-volume box encloses the emissive core');
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      assert.ok(containsVertex(iron, 3 + sx * 0.2225, 3.86 + 0.26, 5 + sz * 0.2225),
        'the open cage keeps each corner bar');
    const geometry = core.geometry;
    const lit = { ...closed, litLanterns: [[...part]] };
    assert.equal(layer.update([lit], 0.1), true);
    assert.equal(layer.views.get(closed.id), view, 'lit state does not replace the raft build');
    assert.equal(view.lanternCores[0], core);
    assert.equal(core.geometry, geometry);
    assert.equal(core.visible, true);
    assert.equal(layer.update([{ ...lit, litLanterns: [] }], 0.2), true);
    assert.equal(core.visible, false);
    assert.equal(view.lanternCores[0], core);
    const stateKey = view.lanternStateKey;
    layer.update([{ ...closed, litLanterns: [['lantern', 1.5, 2, 1, 3]] }], 0.3);
    assert.equal(view.lanternStateKey, stateKey, 'fractional tuples are ignored by visual state');
    assert.equal(core.visible, false);
  } finally { layer.dispose(); }
});

test('raft lights follow the replicated raft pose and disappear when off, destroyed, or detached', () => {
  const lights = new LocalLights(map);
  const record = raftRecord({ litLanterns: [[...part]] });
  lights.setRafts([record], record.id);
  let source = lights.sources.find((s) => s.raftId === record.id);
  assert.ok(source);
  const sourceList = lights.sources;
  assert.ok(Math.abs(source.x - 15) < 1e-8);
  assert.ok(Math.abs(source.z + 7) < 1e-8);
  assert.ok(Math.abs(source.y - 4.56) < 1e-8);
  const identity = source;
  lights.setRafts([{ ...record, x: 20, z: 8, yaw: 0 }], record.id);
  source = lights.sources.find((s) => s.raftId === record.id);
  assert.equal(source, identity, 'snapshot pose updates reuse the source');
  assert.equal(lights.sources, sourceList, 'pose-only updates do not rebuild the candidate list');
  assert.ok(Math.abs(source.x - 23) < 1e-8);
  assert.ok(Math.abs(source.z - 13) < 1e-8);
  lights.setRafts([{ ...record, litLanterns: [] }], record.id);
  assert.equal(lights.sources.some((s) => s.raftId === record.id), false);
  lights.setRafts([record], record.id);
  lights.setRafts([{ ...record, parts: [['foundation', 0, 0, 0, 0]] }], record.id);
  assert.equal(lights.sources.some((s) => s.raftId === record.id), false, 'destroyed live part has no matching source');
  lights.setRafts([record], record.id);
  lights.setRafts([], record.id);
  assert.equal(lights.sources.some((s) => s.raftId === record.id), false, 'detached raft source is removed');
});

test('active raft lantern wins a dense equal-distance selection while preserving tier budget', () => {
  const lights = new LocalLights(map);
  lights.staticSources.length = 0;
  const focus = { x: 0, y: 0, z: 0 };
  const template = new LocalLights(map).staticSources.find((s) => s.kind === 'lantern');
  for (let i = 0; i < 7; i++) lights.staticSources.push({ ...template, color: template.color.clone(), x: 1, y: 1.96, z: 1 });
  const record = { id: 'active', x: 0, y: 0.72, z: 0, yaw: 0,
    parts: [['lantern', 0, 0, 0, 0]], litLanterns: [['lantern', 0, 0, 0, 0]] };
  lights.setRafts([record], 'active');
  Object.assign(lights.knobs, { fire: 1, lava: 0, night: 0, eyes: 0, player: 0 });
  for (const max of [4, 8, 12]) {
    lights.max = max;
    lights.update(1 / 60, focus, null);
    const active = lights.sources.find((s) => s.raftId === 'active');
    assert.ok(active.w >= 0.64, `active lantern stays visible at max ${max}: ${active.w}`);
    assert.ok(U.mnLightCount.value <= max, `shader light count respects max ${max}`);
  }
});

test('invalid or unplaced lantern tuples do not create raft light sources', () => {
  const lights = new LocalLights(map);
  const base = raftRecord({ parts: [['foundation', 0, 0, 0, 0]] });
  lights.setRafts([{ ...base, litLanterns: [['lantern', 0, 0, 0, 0]] }]);
  lights.setRafts([{ ...base, litLanterns: [['lantern', 0, 0, 0]] }]);
  for (const tuple of [['lantern', 0.5, 0, 0, 0], ['lantern', 0, 0, -1, 0], ['lantern', 0, 0, 0, 4]]) {
    lights.setRafts([{ ...base, parts: [tuple], litLanterns: [tuple] }]);
    assert.equal(lights.sources.some((s) => s.raftId), false, `invalid tuple ${JSON.stringify(tuple)} is ignored`);
  }
  const valid = ['lantern', 0, 0, 0, 0];
  lights.setRafts([{ ...base, x: 0, y: 0, z: 0, yaw: NaN,
    parts: [valid], litLanterns: [valid] }]);
  assert.equal(lights.sources.some((s) => s.raftId), false);
});

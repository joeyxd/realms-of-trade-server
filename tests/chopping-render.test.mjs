import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tierFromCadence, pileLayout, pileLogCount, barColor, barVisible, fallDirection } from '../src/render/chopVisuals.js';
import { ResourceNodes } from '../src/render/resourceNodes.js';
import { palmGeometry } from '../src/render/palmGeometry.js';
import { palmMaterials } from '../src/render/palmMaterials.js';
import { startChopPose, startHarvestPose, stepHarvestPose } from '../src/render/harvestPose.js';
import { buildLook } from '../src/render/charlooks.js';
import { chopSound } from '../src/audio/harvest.js';
import { audio } from '../src/audio/engine.js';

test('pure chop rules cover axe cadence, deterministic clamped piles, HP visibility and fall direction', () => {
  assert.deepEqual([54, 45, 33, 27, 24, 20, 99].map(tierFromCadence), [1, 1, 2, 2, 3, 3, 1]);
  for (const count of [0, 1, 4, 8, 20]) {
    assert.equal(pileLayout('pile-1', count).length, pileLogCount(count));
    assert.deepEqual(pileLayout('pile-1', count), pileLayout('pile-1', count));
  }
  assert.notDeepEqual(pileLayout('pile-1', 8), pileLayout('pile-2', 8));
  assert.equal(barVisible(7, 7, false, false, 2), false);
  assert.equal(barVisible(7, 7, false, true, 2), true);
  assert.equal(barVisible(3, 7, false, false, 30), true);
  for (const args of [[0, 7, false, true, 2], [3, 7, true, true, 2], [3, 7, false, true, 31], [3, 7, false, true, 2, 8]])
    assert.equal(barVisible(...args), false);
  assert.equal(new Set([barColor(.9), barColor(.5), barColor(.1)]).size, 3);
  assert.deepEqual(fallDirection({ x: 3, z: 4 }), { x: .6, z: .8 });
  assert.deepEqual(fallDirection({ x: 0, z: 0 }), fallDirection(null));
  assert.ok(Math.abs(fallDirection(null, Math.PI / 2).z - 1) < 1e-8);
});

test('chop palms, pooled bars, chips, directed falls and piles work without a GPU', () => {
  const scene = new THREE.Scene(), nodes = new ResourceNodes(scene, { palms: {
    geometries: [0, 1, 2].map(palmGeometry), mats: palmMaterials({ texture: () => null }, { value: 0 }) } });
  try {
    const palm = { id: 'palm-1', kind: 'palm', x: 2, y: 1, z: 3, rev: 1, ready: true, hits: 0, scale: .9, size: 'medium', hp: 7, maxHp: 7, rot: .7 };
    const snapshot = { chop: 1, nodes: [palm], piles: [{ id: 'pile-1', x: 1, y: 0, z: 1, goods: { tronco: 8 }, rev: 1 }] };
    const focus = { x: 0, z: 0 }; nodes.update(snapshot, focus, 1); nodes.setChopTarget(palm.id);
    assert.equal(nodes.chopBars[0].fill.visible, true);
    assert.equal(nodes.chopHit({ node: palm.id, cancelled: true }), null);
    assert.equal(nodes.chopHit({ node: 'unknown' }), null); assert.equal(nodes.particlePool.items.length, 0);
    assert.deepEqual(nodes.chopHit({ node: palm.id, hp: 6, maxHp: 7 }), { x: 2, y: 1 + 1.6 * .9, z: 3, size: 'medium' });
    assert.equal(nodes.particlePool.items.filter(Boolean).length, 8);
    nodes.setChopTarget(null); nodes.update(snapshot, focus, 1.05);
    assert.equal(nodes.palmRecords.get(palm.id).hp, 6); assert.ok(Math.abs(nodes.chopBars[0].fill.scale.x - 1.2 * 6 / 7) < 1e-8);
    nodes.chopHit({ node: palm.id, hp: 4, maxHp: 7, crit: true });
    assert.equal(nodes.particlePool.items.filter(Boolean).length, 24);
    assert.equal(nodes.palmAnimations.get(palm.id).strength, 2.2);
    nodes.chopFell({ node: palm.id, dir: { x: 3, z: 4 } });
    assert.equal(nodes.chopBars[0].fill.visible, false);
    const record = nodes.palmRecords.get(palm.id), mesh = nodes.palmMeshes[record.variant].trunk;
    snapshot.nodes = [{ ...palm, ready: false, hp: 0 }]; nodes.update(snapshot, focus, 1.1);
    assert.equal(record.felled, true, 'ready false with hits zero stays felled');
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(record.slot, matrix);
    const top = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    assert.ok(Math.abs(top.x / top.z - 3 / 4) < 1e-5, 'fall points along the server vector despite palm yaw');
    const pile = nodes.chopPiles.find((p) => p.id === 'pile-1'); assert.equal(pile.group.children.filter((m) => m.visible).length, 8);
    assert.equal(nodes.pilePickup({ pile: 'pile-1', count: 8, left: 0 }, { x: 3, y: 1, z: 3 }), true);
    assert.equal(pile.group.visible, false); assert.equal(nodes.chopFlights.filter((f) => f.mesh.visible).length, 6);
    nodes.update(snapshot, focus, 1.15); assert.equal(pile.group.visible, false, 'stale snapshot cannot resurrect a picked pile');
    for (let i = 0; i < 30; i++) nodes.update(snapshot, focus, 1.2 + i * .05);
    assert.equal(nodes.chopFlights.filter((f) => f.mesh.visible).length, 0);
    mesh.getMatrixAt(record.slot, matrix); assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).length(), 0);
    snapshot.piles = []; nodes.update(snapshot, focus, 3); assert.equal(nodes.chopPiles.some((p) => p.id !== null), false);
    snapshot.nodes = Array.from({ length: 96 }, (_, i) => ({ ...palm, id: `palm-${i}`, hp: 5 }));
    snapshot.piles = Array.from({ length: 48 }, (_, i) => ({ id: `pile-${i}`, x: i, y: 0, z: 1, goods: { tronco: 8 }, rev: 1 }));
    nodes.update(snapshot, focus, 3.1); assert.equal(nodes.chopBars.filter((b) => b.fill.visible).length, 8);
    snapshot.nodes[95].hp = 7; nodes.update(snapshot, focus, 3.12); nodes.setChopTarget('palm-95');
    assert.equal(nodes.chopBars[0].fill.scale.x, 1.2, 'target takes priority over other damaged palms');
    assert.equal(nodes.palmRecords.size, 96); assert.equal(nodes.chopPiles.filter((p) => p.id !== null).length, 48);
    const groups = nodes.chopPiles.map((p) => p.group); nodes.update(snapshot, focus, 3.15);
    assert.deepEqual(nodes.chopPiles.map((p) => p.group), groups);
    assert.equal(nodes.pilePickup({ pile: 'pile-0', count: 1, left: 7 }, null), true);
    snapshot.nodes[0].ready = false; snapshot.nodes[0].hp = 0; nodes.update(snapshot, focus, 3.2);
    assert.equal(nodes.palmRecords.get('palm-0').felled, true, 'mutable snapshot also obeys readiness');
    nodes.update({ nodes: [palm] }, focus, 3.2); assert.equal(nodes.chopGroup.visible, false);
  } finally {
    const geometries = new Set(), materials = new Set();
    scene.traverse((o) => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
  }
});

test('chop pose lasts the cadence, strikes at the end, caches tier geometry and restores legacy stone', () => {
  startChopPose(null, { cadence: 54 });
  const view = { root: new THREE.Group(), mesh: { geometry: buildLook(0, false).geo }, skin: 0, foreR: new THREE.Group() };
  for (const key of ['armR', 'armL', 'foreL', 'chest', 'spine']) view[key] = new THREE.Group();
  startChopPose(view, { cadence: 33 }); const iron = view.harvestTool;
  assert.equal(iron.userData.tier, 2); assert.equal(view.harvestPose.duration, 33 / 60);
  stepHarvestPose(view, .3, {}); assert.equal(view.armR.rotation.x, -2.35);
  stepHarvestPose(view, .24, {}); assert.ok(view.armR.rotation.x > -1); assert.ok(view.harvestPose);
  stepHarvestPose(view, .02, {}); assert.equal(view.harvestPose, null);
  startChopPose(view, { cadence: 27 }); assert.equal(view.harvestTool, iron);
  startChopPose(view, { cadence: 20 }); assert.equal(view.harvestTool.userData.tier, 3);
  startHarvestPose(view, { kind: 'palm', x: 1, z: 2 }); assert.equal(view.harvestTool.userData.tier, 1);
});

test('chop sound selects size pitch, double crit, fell, pickup and distance silence', () => {
  const saved = { ctx: audio.ctx, ready: audio.ready, noiseSource: audio.noiseSource, env: audio.env }, notes = [];
  const source = () => ({ connect() { return this; }, start() {}, stop() {}, frequency: { value: 0,
    setValueAtTime(f) { notes.push(f); }, exponentialRampToValueAtTime() {} }, Q: {}, gain: {} });
  try {
    audio.ready = true; audio.ctx = { currentTime: 0, createOscillator: source, createGain: source, createBiquadFilter: source };
    audio.noiseSource = source; audio.env = () => {};
    chopSound('hit', { size: 'small' }); assert.equal(notes.pop(), 234);
    chopSound('hit', { size: 'large' }); assert.equal(notes.pop(), 156);
    chopSound('crit'); assert.equal(notes.length, 2); notes.length = 0;
    chopSound('fell'); chopSound('pickup'); assert.deepEqual(notes, [90, 420]); notes.length = 0;
    chopSound('unknown'); chopSound('hit', {}, 23); assert.equal(notes.length, 0);
  } finally { Object.assign(audio, saved); }
});

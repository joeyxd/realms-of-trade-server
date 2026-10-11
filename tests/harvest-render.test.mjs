import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { ResourceNodes } from '../src/render/resourceNodes.js';
import { palmGeometry, palmVariant } from '../src/render/palmGeometry.js';
import { palmMaterials } from '../src/render/palmMaterials.js';
import { buildLook } from '../src/render/charlooks.js';
import { startHarvestPose, stepHarvestPose } from '../src/render/harvestPose.js';

function withEmptyAssets(fn) {
  const saved = new Map();
  for (const key of ['texture', 'data']) {
    const descriptor = Object.getOwnPropertyDescriptor(assets, key);
    saved.set(key, descriptor);
    assets[key] = () => null;
  }
  try { return fn(); }
  finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(assets, key, descriptor);
      else delete assets[key];
    }
  }
}

function buildNodes() {
  const scene = new THREE.Scene(), swayUniform = { value: 0.3 };
  const geometries = [0, 1, 2].map((i) => palmGeometry(i));
  const mats = palmMaterials({ texture: () => null }, swayUniform);
  const nodes = withEmptyAssets(() => new ResourceNodes(scene, { palms: { geometries, mats }, swayUniform }));
  return { scene, nodes, geometries, mats };
}

function disposeBuilt(built) {
  const geometries = new Set(), materials = new Set();
  built.scene.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) materials.add(m);
    if (o.customDepthMaterial) materials.add(o.customDepthMaterial);
  });
  for (const g of built.geometries) { geometries.add(g.trunk); geometries.add(g.fronds); }
  for (const m of Object.values(built.mats)) if (m?.isMaterial) materials.add(m);
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

function variantsNearOrigin() {
  const found = new Map();
  for (let x = -5; x <= 5 && found.size < 3; x += .25) {
    for (let z = -5; z <= 5 && found.size < 3; z += .25) {
      const d = Math.hypot(x, z), variant = palmVariant({ x, z });
      if (d > 1 && d < 5.5 && !found.has(variant)) found.set(variant, { x, z });
    }
  }
  assert.equal(found.size, 3, 'coordinates cover all three deterministic palm styles near the test focus');
  return [...found.entries()].map(([variant, p], i) => ({ id: `palm-test-${variant}`, kind: 'palm',
    x: p.x, y: 0, z: p.z, rev: 1, ready: true, wait: 0, propIndex: i, scale: 0.9 + i * .08,
    rot: .15 * i, hits: 0 }));
}

function matrix(mesh, slot) { const m = new THREE.Matrix4(); mesh.getMatrixAt(slot, m); return m; }
function matrixScale(m) { return new THREE.Vector3().setFromMatrixScale(m); }
function nearZero(m) { return matrixScale(m).length() < 1e-7; }

test('resource renderer builds finite stump geometry and accepts an already-depleted snapshot without replaying a fall', () => {
  const built = buildNodes();
  try {
    const { nodes } = built;
    for (const geometry of [nodes.palmStumpBody, nodes.palmStumpTop]) {
      const positions = geometry.getAttribute('position').array;
      assert.ok([...positions].every(Number.isFinite));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      assert.ok(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0);
      assert.ok(geometry.getAttribute('color')?.array.every(Number.isFinite), 'stump palette exists for every vertex');
    }
    const node = { id: 'palm-depleted', kind: 'palm', x: 1, y: 0, z: 1, rev: 8, ready: false,
      wait: 20, propIndex: 4, scale: 1, rot: .3, hits: 3 };
    nodes.update({ nodes: [node], bench: null }, { x: 1, z: 1 }, 0);
    const record = nodes.palmRecords.get(node.id), meshes = nodes.palmMeshes[record.variant];
    assert.equal(nodes.palmAnimations.has(node.id), false, 'initial depleted state does not animate');
    assert.ok(nearZero(matrix(meshes.trunk, record.slot)));
    assert.ok(!nearZero(matrix(nodes.stumpMeshes.body, record.stumpSlot)));
  } finally { disposeBuilt(built); }
});

test('palms in all three variants fall once, leave unique stumps, then regrow from a ready snapshot', () => {
  const built = buildNodes();
  try {
    const { nodes } = built, palms = variantsNearOrigin();
    nodes.update({ nodes: palms, bench: null }, { x: 0, z: 0 }, 0);
    assert.deepEqual(new Set(palms.map((p) => nodes.palmRecords.get(p.id).variant)), new Set([0, 1, 2]));
    const transformsBefore = palms.map((p) => {
      const r = nodes.palmRecords.get(p.id); return matrix(nodes.palmMeshes[r.variant].trunk, r.slot).clone();
    });
    for (let i = 0; i < palms.length; i++) {
      const p = palms[i];
      assert.equal(nodes.hit({ e: 3, node: p.id, kind: 'palm', x: p.x, y: p.y, z: p.z, rev: 2, remaining: 0, felled: true }), true);
    }
    const felled = palms.map((p) => ({ ...p, rev: 2, ready: false, wait: 30, hits: 3 }));
    for (let frame = 1; frame <= 24; frame++) nodes.update({ nodes: felled, bench: null }, { x: 0, z: 0 }, frame * .05);
    const stumpPositions = [];
    for (let i = 0; i < palms.length; i++) {
      const p = palms[i], r = nodes.palmRecords.get(p.id), tree = nodes.palmMeshes[r.variant].trunk;
      assert.ok(!nearZero(transformsBefore[i]), 'standing palm has a nonzero instance transform');
      assert.ok(nearZero(matrix(tree, r.slot)), 'felled palm is removed from its live instance');
      const stump = matrix(nodes.stumpMeshes.body, r.stumpSlot), point = new THREE.Vector3().setFromMatrixPosition(stump);
      stumpPositions.push(point.toArray());
      assert.ok(!nearZero(stump), 'persistent stump has a live instance transform');
      assert.ok(Math.abs(point.x - p.x) < 1e-6 && Math.abs(point.y - (p.y + .24 * p.scale)) < 1e-6
        && Math.abs(point.z - p.z) < 1e-6, 'stump matrix stays at its palm anchor');
    }
    assert.equal(new Set(stumpPositions.map((p) => p.join(','))).size, palms.length, 'stump instance slots remain unique');

    const regrown = palms.map((p) => ({ ...p, rev: 3, ready: true, wait: 0, hits: 0 }));
    nodes.update({ nodes: regrown, bench: null }, { x: 0, z: 0 }, 1.25);
    for (const p of palms) {
      const r = nodes.palmRecords.get(p.id), tree = nodes.palmMeshes[r.variant].trunk;
      assert.ok(!nearZero(matrix(tree, r.slot)), 'ready palm returns to the standing batch');
      assert.ok(nearZero(matrix(nodes.stumpMeshes.body, r.stumpSlot)), 'regrowth clears the old stump');
    }
  } finally { disposeBuilt(built); }
});

test('palm hit effects dedupe by node revision and markers appear only nearby', () => {
  const built = buildNodes();
  try {
    const { nodes } = built;
    const p = { id: 'palm-marker', kind: 'palm', x: 2, y: 0, z: 2, rev: 1, ready: true,
      wait: 0, propIndex: 1, scale: 1, rot: 0, hits: 0 };
    nodes.update({ nodes: [p], bench: null }, { x: 2, z: 2 }, 0);
    const record = nodes.palmRecords.get(p.id);
    assert.equal(record.marker.visible, true); assert.equal(record.gem.visible, true);
    const event = { e: 7, node: p.id, kind: 'palm', x: p.x, y: p.y, z: p.z, rev: 2, remaining: 2, felled: false };
    assert.equal(nodes.hit(event), true);
    const count = nodes.particlePool.items.filter(Boolean).length;
    assert.equal(nodes.hit(event), false);
    assert.equal(nodes.particlePool.items.filter(Boolean).length, count, 'duplicate revision adds no particles');
    nodes.update({ nodes: [p], bench: null }, { x: 9, z: 2 }, .05);
    assert.equal(record.marker.visible, false, 'the marker group is hidden beyond its close-range cutoff');
  } finally { disposeBuilt(built); }
});

test('particle instances stay bounded and expire to zero scale', () => {
  const built = buildNodes();
  try {
    const { nodes } = built;
    for (let rev = 1; rev <= 20; rev++) {
      assert.equal(nodes.hit({ e: 2, node: 'stone-pool', kind: 'stone', x: 3, y: 0, z: 4, rev }), true);
    }
    assert.ok(nodes.particlePool.items.filter(Boolean).length <= 32, 'the chip pool never exceeds its fixed capacity');
    for (let frame = 1; frame <= 18; frame++) nodes.update({ nodes: [], bench: null }, { x: 3, z: 4 }, frame * .05);
    assert.equal(nodes.group.userData.palmResources.particles, 0);
    for (let i = 0; i < 32; i++) assert.ok(nearZero(matrix(nodes.particlePool.chipMesh, i)), `expired chip ${i} has zero scale`);
    for (let i = 0; i < 16; i++) assert.ok(nearZero(matrix(nodes.particlePool.leafMesh, i)), `unused leaf ${i} has zero scale`);
  } finally { disposeBuilt(built); }
});

test('stone hits use the painted rock material without adding texture assets', () => {
  const built = buildNodes();
  try {
    const { nodes } = built;
    assert.equal(nodes.hit({ e: 4, node: 'stone-one', kind: 'stone', x: -3, y: 0, z: 6, rev: 1 }), true);
    assert.equal(nodes.rockPaint.userData.rockPaint.texturesAdded, 0);
    assert.equal(nodes.group.userData.palmResources.textures.length, 0);
    nodes.update({ nodes: [{ id: 'stone-one', kind: 'stone', x: -3, y: 0, z: 6, rev: 1, ready: true }], bench: null },
      { x: -3, z: 6 }, 0);
    assert.equal(nodes.records.get('stone-one').mesh.material, nodes.rockPaint);
  } finally { disposeBuilt(built); }
});

test('mining rocks read larger than hand stones, crack per hit, shed bounded chips, and regrow from rubble', () => {
  const built = buildNodes();
  try {
    const { nodes } = built;
    const handStone = { id: 'hand-stone', kind: 'stone', x: 2, y: 0, z: 0, rev: 1, ready: true, wait: 0 };
    const rock = { id: 'large-rock', kind: 'rock', x: 0, y: 0, z: 0, rev: 1, ready: true, wait: 0, hits: 0, remaining: 4 };
    nodes.update({ nodes: [handStone, rock], bench: null }, { x: 0, z: 0 }, 0);
    const record = nodes.records.get(rock.id), handRecord = nodes.records.get(handStone.id);
    assert.ok(record.mesh.scale.x > handRecord.mesh.scale.x * 1.5, 'mining node has a clearly larger silhouette');
    assert.equal(record.cracks.visible, false);

    const event = { e: 7, node: rock.id, kind: 'rock', x: rock.x, y: rock.y, z: rock.z,
      rev: 2, remaining: 3, broken: false, tool: 'pickaxe' };
    assert.equal(nodes.hit(event), true);
    nodes.update({ nodes: [{ ...rock, rev: 2, hits: 1, remaining: 3 }], bench: null }, { x: 0, z: 0 }, .05);
    assert.equal(record.cracks.visible, true, 'the first authoritative hit draws cracks');
    const particleCount = nodes.particlePool.items.filter(Boolean).length;
    assert.equal(nodes.hit(event), false, 'duplicate event revision is ignored');
    assert.equal(nodes.particlePool.items.filter(Boolean).length, particleCount);
    for (let rev = 3; rev <= 16; rev++) nodes.hit({ ...event, rev, remaining: 4 - (rev - 1) });
    assert.equal(nodes.particlePool.items.filter(Boolean).length, 32, 'chip instances stay within the fixed pool');

    nodes.update({ nodes: [{ ...rock, rev: 5, hits: 4, remaining: 0, ready: false, wait: 20 }], bench: null },
      { x: 0, z: 0 }, .10);
    assert.ok(record.mesh.scale.x < handRecord.mesh.scale.x, 'depleted mining rock becomes small rubble');
    assert.equal(record.cracks.visible, true);
    nodes.update({ nodes: [{ ...rock, rev: 6, hits: 0, remaining: 4, ready: true, wait: 0 }], bench: null },
      { x: 0, z: 0 }, .15);
    assert.ok(record.mesh.scale.x > handRecord.mesh.scale.x * 1.5, 'respawn restores the full rock');
    assert.equal(record.cracks.visible, false, 'regrowth clears its cracks');
  } finally { disposeBuilt(built); }
});

test('pending loose collection hides only its view and rejection restores it without touching revisions', () => {
  const built = buildNodes(), { nodes } = built;
  try {
    const stone = { id: 'stone-preview', kind: 'stone', x: 1, y: 0, z: 1, rev: 1, ready: true };
    nodes.update({ nodes: [{ ...stone, collecting: true }] }, { x: 0, z: 0 }, 0);
    assert.equal(nodes.records.get(stone.id).group.visible, false);
    assert.equal(stone.ready, true); assert.equal(stone.rev, 1);
    nodes.update({ nodes: [stone] }, { x: 0, z: 0 }, .05);
    assert.equal(nodes.records.get(stone.id).group.visible, true);
    assert.equal(nodes.records.get(stone.id).mesh.visible, true);
  } finally { disposeBuilt(built); }
});

test('pickaxe harvest pose restores the equipped character geometry after its short animation', () => {
  const weaponGeometry = buildLook(0, true).geo;
  const view = { root: new THREE.Group(), mesh: { geometry: weaponGeometry }, skin: 0, armed: true, weaponKind: 'sable',
    foreR: new THREE.Group(), armR: { rotation: new THREE.Euler() }, armL: { rotation: new THREE.Euler() },
    foreL: { rotation: new THREE.Euler() }, chest: { rotation: new THREE.Euler() }, spine: { rotation: new THREE.Euler() } };
  startHarvestPose(view, { kind: 'rock', tool: 'pickaxe', x: 1, z: 2 });
  assert.equal(view.harvestPose.mining, true);
  assert.equal(view.harvestTool.userData.tool, 'pickaxe');
  assert.equal(view.harvestTool.visible, true);
  assert.notEqual(view.mesh.geometry, weaponGeometry, 'harvesting temporarily uses the unarmed body geometry');
  stepHarvestPose(view, .69, { dead: false, act: false, vx: 0, vz: 0 });
  assert.equal(view.harvestPose, null);
  assert.equal(view.harvestTool.visible, false);
  assert.equal(view.mesh.geometry, weaponGeometry, 'the equipped weapon geometry returns after the pose');
});

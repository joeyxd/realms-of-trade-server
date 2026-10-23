import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dockWoodMaterial, dockWoodPart, DOCK_WOOD_RECTS } from '../src/render/dockWood.js';
import { RAFT_ATLAS_ID } from '../src/render/raftMaterials.js';
import { assets } from '../src/render/assets/registry.js';
import { createProps } from '../src/render/props.js';

const arrayEqual = (a, b, message) => assert.deepEqual(Array.from(a), Array.from(b), message);

function dockFixture() {
  return {
    props: [],
    npcs: [],
    dock: {
      len: 3,
      halfWidth: 1.25,
      deckY: 0.8,
      base: { x: 18, z: -9 },
      dir: { x: 0, z: 1 },
    },
  };
}

function forbidRngAccess(map) {
  Object.defineProperty(map, 'rng', {
    configurable: true,
    get() { throw new Error('rendering dock wood must not read world RNG'); },
  });
  return map;
}

function visitVertices(geometry, fn) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) fn(i, position, normal, uv);
}

test('mapped dock part preserves part geometry, colors, baked transform and vertex count', () => {
  const transform = { pos: [7, 2.5, -11], rot: [0.17, 0.31, -0.08], scale: [1.4, 0.85, 0.7] };
  const source = new THREE.BoxGeometry(4, 0.3, 1.1);
  const sourceBefore = source.clone();
  const expected = dockWoodPart(source.clone(), 0xb5834d, transform, { mapped: false });
  const mapped = dockWoodPart(source, 0xb5834d, transform, { mapped: true, variant: 2 });

  assert.equal(expected.index, null, 'part output is non-indexed');
  assert.equal(mapped.index, null);
  assert.equal(mapped.getAttribute('position').count, expected.getAttribute('position').count);
  assert.equal(mapped.getAttribute('position').count, sourceBefore.toNonIndexed().getAttribute('position').count);
  for (const name of ['position', 'normal', 'color']) {
    assert.ok(mapped.hasAttribute(name), `${name} remains on the mapped part`);
    arrayEqual(mapped.getAttribute(name).array, expected.getAttribute(name).array, `${name} matches the ordinary part`);
  }
  assert.equal(expected.hasAttribute('uv'), false);
  assert.equal(mapped.getAttribute('uv').count, mapped.getAttribute('position').count);

  // UV extraction runs on a clone; the supplied source receives only part()'s ordinary bake.
  const transformedSource = sourceBefore.clone();
  transformedSource.scale(...transform.scale);
  transformedSource.rotateX(transform.rot[0]);
  transformedSource.rotateY(transform.rot[1]);
  transformedSource.rotateZ(transform.rot[2]);
  transformedSource.translate(...transform.pos);
  for (const name of ['position', 'normal']) {
    arrayEqual(source.getAttribute(name).array, transformedSource.getAttribute(name).array,
      `source ${name} has only the standard baked transform`);
  }
  source.dispose(); sourceBefore.dispose(); expected.dispose(); mapped.dispose(); transformedSource.dispose();
});

test('wood UVs use each custom crop, wrap eight layouts, and mirror grain along the local long axis', () => {
  const cases = [0, 1, 2, 3, 4, 5, 6, 7, -1, -8];
  const bounds = new Map();

  for (const variant of cases) {
    const layout = ((variant % 8) + 8) % 8;
    const rect = DOCK_WOOD_RECTS[layout % 4];
    const mirrored = layout >= 4;
    // Translation makes the test catch accidental world-space bounds; local X is the longest top-face axis.
    const geometry = dockWoodPart(new THREE.BoxGeometry(4, 0.3, 1.1), 0xffffff,
      { pos: [23, 5, -17] }, { mapped: true, variant });
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    visitVertices(geometry, (i, p, n, uv) => {
      const u = uv.getX(i), v = uv.getY(i);
      assert.ok(Number.isFinite(u) && Number.isFinite(v));
      assert.ok(u >= rect.u0 - 1e-6 && u <= rect.u1 + 1e-6 && v >= rect.v0 - 1e-6 && v <= rect.v1 + 1e-6,
        `variant ${variant} UV lies inside its custom board crop`);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      if (Math.abs(n.getY(i)) > 0.99 && Math.abs(p.getY(i) - 5.15) < 1e-5) {
        // The top face spans local X=4 and Z=1.1, so U follows X; alternate layouts mirror it.
        const alongX = (p.getX(i) - 21) / 4;
        const expectedU = mirrored
          ? rect.u1 - alongX * (rect.u1 - rect.u0)
          : rect.u0 + alongX * (rect.u1 - rect.u0);
        assert.ok(Math.abs(u - expectedU) < 1e-5,
          `variant ${variant} U follows the ${mirrored ? 'mirrored ' : ''}long local X axis after translation`);
      }
    });
    for (const [actual, expected, axis] of [[minU, rect.u0, 'min U'], [maxU, rect.u1, 'max U'],
      [minV, rect.v0, 'min V'], [maxV, rect.v1, 'max V']]) {
      assert.ok(Math.abs(actual - expected) < 1e-5, `variant ${variant} ${axis} matches its selected crop`);
    }
    assert.ok(maxU > minU, 'the wood grain has a nonzero U span');
    bounds.set(variant, [minU, maxU, minV, maxV]);
    geometry.dispose();
  }
  assert.deepEqual(bounds.get(-1), bounds.get(7), 'negative variants wrap to the same eighth layout');
  assert.deepEqual(bounds.get(-8), bounds.get(0));
  assert.deepEqual(bounds.get(4), bounds.get(0), 'mirrored layout reuses the same atlas crop');
});

test('dock material shares the supplied atlas and disposing it does not dispose the shared texture', () => {
  const atlas = new THREE.Texture();
  let textureDisposed = false;
  atlas.addEventListener('dispose', () => { textureDisposed = true; });
  const fallback = new THREE.MeshToonMaterial({ color: 0xc08048, vertexColors: true });
  const material = dockWoodMaterial(atlas, fallback);

  assert.notEqual(material, fallback);
  assert.equal(material.map, atlas);
  assert.equal(material.vertexColors, false);
  assert.equal(material.userData.dockWood.atlas, RAFT_ATLAS_ID);
  assert.equal(material.userData.dockWood.texturesAdded, 0);
  material.dispose();
  assert.equal(textureDisposed, false, 'material disposal leaves the shared atlas alive');

  const noAtlas = dockWoodMaterial(null, fallback);
  assert.equal(noAtlas, fallback, 'missing/disabled atlas uses the exact procedural material');
  fallback.dispose(); atlas.dispose();
});

test('createProps uses the one shared atlas for the deck and falls back without mutating map state', () => {
  const originalTexture = assets.texture;
  const atlas = new THREE.Texture();
  const calls = [];
  try {
    assets.texture = (id) => { calls.push(id); return id === RAFT_ATLAS_ID ? atlas : null; };
    const map = forbidRngAccess(dockFixture());
    const before = structuredClone(map);
    const props = createProps(map);
    const deck = props.group.getObjectByName('dockDeck');
    assert.ok(deck);
    assert.deepEqual(calls, [RAFT_ATLAS_ID], 'dock rendering requests only the shared raft atlas');
    assert.equal(deck.material.map, atlas);
    assert.equal(deck.material.vertexColors, false);
    assert.deepEqual(deck.userData.dockWood, {
      family: 'dock-wood-v1', atlas: RAFT_ATLAS_ID, mapped: true,
      boards: Math.floor((map.dock.len + 1.5) / 0.5), beams: 2, texturesAdded: 0,
    });
    assert.ok(deck.geometry.getAttribute('uv'));
    assert.equal(deck.geometry.index, null);
    assert.deepEqual(map, before, 'render setup does not change the map fixture');

    props.group.traverse((object) => { if (object.geometry) object.geometry.dispose(); });
    props.group.traverse((object) => { if (object.material && !Array.isArray(object.material)) object.material.dispose(); });
  } finally {
    assets.texture = originalTexture;
    atlas.dispose();
  }

  const originalTextureAgain = assets.texture;
  try {
    const callsWithoutAtlas = [];
    assets.texture = (id) => { callsWithoutAtlas.push(id); return null; };
    const map = forbidRngAccess(dockFixture());
    const before = structuredClone(map);
    const props = createProps(map);
    const deck = props.group.getObjectByName('dockDeck');
    assert.ok(deck);
    assert.deepEqual(callsWithoutAtlas, [RAFT_ATLAS_ID]);
    assert.equal(deck.material.vertexColors, true, 'noassets uses the existing vertex-color procedural material');
    assert.equal(deck.userData.dockWood.mapped, false);
    assert.equal(deck.userData.dockWood.atlas, null);
    assert.equal(deck.geometry.getAttribute('uv'), undefined);
    assert.deepEqual(map, before);
    props.group.traverse((object) => { if (object.geometry) object.geometry.dispose(); });
    props.group.traverse((object) => { if (object.material && !Array.isArray(object.material)) object.material.dispose(); });
  } finally {
    assets.texture = originalTextureAgain;
  }
});

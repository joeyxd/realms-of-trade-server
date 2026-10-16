import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RAFT_ATLAS_ID, RAFT_ATLAS_RECTS, surface, materialKey, mapRaftUV } from '../src/render/raftMaterials.js';

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const uvLocal = (u, v, rect) => [(u - rect.u0) / (rect.u1 - rect.u0), (v - rect.v0) / (rect.v1 - rect.v0)];
const inside = (u, v, rect) => u >= rect.u0 - 1e-7 && u <= rect.u1 + 1e-7 && v >= rect.v0 - 1e-7 && v <= rect.v1 + 1e-7;

test('raft atlas contract defines inset image quadrants in Three UV coordinates', () => {
  assert.equal(RAFT_ATLAS_ID, 'tex:raft-comic-v1');
  assert.ok(RAFT_ATLAS_RECTS.wood.u0 < 0.5 && RAFT_ATLAS_RECTS.wood.v0 > 0.5, 'wood occupies image top-left');
  assert.ok(RAFT_ATLAS_RECTS.iron.u0 > 0.5 && RAFT_ATLAS_RECTS.iron.v0 > 0.5, 'iron occupies image top-right');
  assert.ok(RAFT_ATLAS_RECTS.rope.u0 < 0.5 && RAFT_ATLAS_RECTS.rope.v1 < 0.5, 'rope occupies image bottom-left');
  assert.ok(RAFT_ATLAS_RECTS.cloth.u0 > 0.5 && RAFT_ATLAS_RECTS.cloth.v1 < 0.5, 'cloth occupies image bottom-right');
  for (const rect of Object.values(RAFT_ATLAS_RECTS)) {
    assert.ok(rect.u0 >= 0.012 && rect.v0 >= 0.012 && rect.u1 <= 0.988 && rect.v1 <= 0.988);
  }
});

test('surface descriptors and material keys include semantic region, fallback, and tint', () => {
  assert.deepEqual(surface('wood', 0x9b6230), { kind: 'wood', color: 0x9b6230, tint: 0xffffff });
  const wood = surface('wood', 0x9b6230, 0xf8e5c0);
  assert.equal(materialKey(wood), materialKey({ ...wood }));
  assert.notEqual(materialKey(wood), materialKey(surface('iron', wood.color, wood.tint)));
  assert.notEqual(materialKey(wood), materialKey(surface('wood', 0x9b6231, wood.tint)));
  assert.notEqual(materialKey(wood), materialKey(surface('wood', wood.color, 0xffffff)));
  assert.equal(materialKey(0x9b6230), materialKey(0x9b6230));
  assert.notEqual(materialKey(0x9b6230), materialKey(0x9b6231));
});

test('raw atlas mapping confines every swatch, including the flipped cloth row', () => {
  for (const kind of ['wood', 'iron', 'rope', 'cloth']) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    assert.equal(mapRaftUV(g, kind), true);
    const uv = g.getAttribute('uv'), rect = RAFT_ATLAS_RECTS[kind];
    for (let i = 0; i < uv.count; i++) assert.ok(inside(uv.getX(i), uv.getY(i), rect), `${kind} uv ${i} escaped its swatch`);
    g.dispose();
  }
});

test('wood crop variants are deterministic, distinct, and remain inset inside the wood swatch', () => {
  const template = new THREE.BoxGeometry(1, 1, 1);
  const before = Array.from(template.getAttribute('uv').array);
  const first = [];
  for (let variant = 0; variant < 4; variant++) {
    const clone = template.clone();
    assert.equal(mapRaftUV(clone, 'wood', { variant }), true);
    const uv = clone.getAttribute('uv'), rect = RAFT_ATLAS_RECTS.wood;
    const local = Array.from({ length: uv.count }, (_, i) => uvLocal(uv.getX(i), uv.getY(i), rect));
    assert.ok(local.every(([, v]) => v >= 0 && v <= 0.77 + 1e-6));
    first.push(local[0][1]);
    clone.dispose();
  }
  assert.notEqual(first[0], first[1]);
  assert.notEqual(first[1], first[2]);
  const repeat = template.clone();
  mapRaftUV(repeat, 'wood', { variant: 4 });
  close(repeat.getAttribute('uv').getY(0), first[0] * (RAFT_ATLAS_RECTS.wood.v1 - RAFT_ATLAS_RECTS.wood.v0) + RAFT_ATLAS_RECTS.wood.v0);
  assert.deepEqual(Array.from(template.getAttribute('uv').array), before, 'mapping a clone never mutates the cached template');
  repeat.dispose(); template.dispose();
});

test('box grain aligns U with the longest face axis on decks and columns', () => {
  const deck = new THREE.BoxGeometry(4, 0.2, 2);
  assert.equal(mapRaftUV(deck, 'wood', { grain: 'box' }), true);
  const pos = deck.getAttribute('position'), norm = deck.getAttribute('normal'), uv = deck.getAttribute('uv');
  const rect = RAFT_ATLAS_RECTS.wood;
  for (let i = 0; i < uv.count; i++) if (Math.abs(norm.getY(i)) > 0.99) {
    const [u] = uvLocal(uv.getX(i), uv.getY(i), rect);
    close(u, (pos.getX(i) + 2) / 4);
  }
  deck.dispose();

  const column = new THREE.BoxGeometry(0.25, 3, 0.4);
  assert.equal(mapRaftUV(column, 'wood', { grain: 'box' }), true);
  const cp = column.getAttribute('position'), cn = column.getAttribute('normal'), cuv = column.getAttribute('uv');
  for (let i = 0; i < cuv.count; i++) if (Math.abs(cn.getY(i)) < 0.99) {
    const [u] = uvLocal(cuv.getX(i), cuv.getY(i), rect);
    close(u, (cp.getY(i) + 1.5) / 3);
  }
  column.dispose();
});

test('wood cylinder grain swaps side UV axes for lengthwise grain but preserves cap UVs', () => {
  const g = new THREE.CylinderGeometry(0.4, 0.4, 3, 8, 1, false);
  const before = Array.from(g.getAttribute('uv').array);
  const normal = g.getAttribute('normal');
  assert.equal(mapRaftUV(g, 'wood', { grain: 'cylinder' }), true);
  const uv = g.getAttribute('uv'), rect = RAFT_ATLAS_RECTS.wood;
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = uvLocal(uv.getX(i), uv.getY(i), rect), oldU = before[i * 2], oldV = before[i * 2 + 1];
    const crop = Math.abs(normal.getY(i)) > 0.999 ? oldV : oldU;
    close(u, Math.abs(normal.getY(i)) > 0.999 ? oldU : oldV);
    close(v, crop * 0.23);
  }
  g.dispose();
});

test('missing UVs are a safe no-op and malformed coordinates are made finite/inset', () => {
  const noUv = new THREE.BufferGeometry();
  assert.equal(mapRaftUV(noUv, 'wood'), false);
  assert.equal(mapRaftUV(noUv, 'unknown'), false);

  const malformed = new THREE.BufferGeometry();
  malformed.setAttribute('uv', new THREE.Float32BufferAttribute([NaN, Infinity, -4, 9], 2));
  assert.equal(mapRaftUV(malformed, 'cloth'), true);
  const uv = malformed.getAttribute('uv'), rect = RAFT_ATLAS_RECTS.cloth;
  for (let i = 0; i < uv.count; i++) {
    assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)));
    assert.ok(inside(uv.getX(i), uv.getY(i), rect));
  }
  noUv.dispose(); malformed.dispose();
});

// External assets (docs/ASSETS.md): the manifest contract, the bone map for the usual rig conventions, the box fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManifest, fitBox, OUR_BONES } from '../src/render/assets/manifest.js';
import { parseBoneName, boneRole, mapBones, followMap } from '../src/render/assets/bonemap.js';
import { readGlb } from '../tools/glb.mjs';

test('manifest: defaults, kinds, bad entries dropped with a message', () => {
  const m = normalizeManifest({ assets: [
    { id: 'char:corsaria', src: 'models/c.glb', looks: ['Corsaria'] },
    { id: 'prop:barrel', src: 'models/b.glb', props: ['barrel', 'nope'] },
    { id: 'ship:balandra', kind: 'model', src: 'models/s.glb', size: 9 },
    { id: 'tex:planks', src: 'textures/p.webp', repeat: [2, 3] },
    { id: 'char:x', src: 'x.glb' }, // no looks
    { id: 'prop:barrel', src: 'again.glb', props: ['crate'] }, // duplicate id
    { id: 'model:evil', src: 'https://evil.example/x.glb' },
    { id: 'model:up', src: '../secret.glb' },
    { id: 'weird:thing', src: 'a.glb' },
  ] }, { looks: ['Corsaria', 'Bucanero'] });
  assert.deepEqual([...m.entries.keys()], ['char:corsaria', 'prop:barrel', 'ship:balandra', 'tex:planks']);
  const c = m.entries.get('char:corsaria');
  assert.equal(c.kind, 'char'); assert.equal(c.weapon, 'proc'); assert.equal(c.armsDown, true); assert.equal(c.toon.rim, true); assert.equal(c.toon.comic, false);
  assert.equal(m.byLook.get('Corsaria'), 'char:corsaria');
  const p = m.entries.get('prop:barrel');
  assert.deepEqual(p.props, ['barrel']); assert.equal(p.fit, 'proc'); assert.equal(m.byProp.get('barrel'), 'prop:barrel');
  assert.equal(m.entries.get('ship:balandra').fit, 'size');
  assert.deepEqual(m.entries.get('tex:planks').repeat, [2, 3]);
  assert.ok(m.errors.length >= 5, m.errors.join('\n'));
  assert.ok(m.errors.some((e) => /nope/.test(e)));
  assert.deepEqual(normalizeManifest(null).errors, []);
  assert.equal(normalizeManifest({}).errors.length, 1);
});

test('manifest: unknown looks are reported, a char keeps the ones that exist', () => {
  const m = normalizeManifest({ assets: [{ id: 'char:a', src: 'a.glb', looks: ['Corsaria', 'Fantasma'] }] }, { looks: ['Corsaria'] });
  assert.deepEqual(m.entries.get('char:a').looks, ['Corsaria']);
  assert.ok(m.errors.some((e) => /Fantasma/.test(e)));
});

test('fitBox: height, size, the procedural size, offsets', () => {
  const f = fitBox([-1, 0, -1], [1, 4, 1], { kind: 'model', fit: 'height', height: 2, scale: 1 });
  assert.equal(f.s, 0.5); assert.equal(f.y, 0);
  const g = fitBox([0, 1, 0], [4, 3, 2], { kind: 'model', fit: 'size', size: 2, scale: 1, yOffset: 0.1 });
  assert.equal(g.s, 0.5); assert.equal(g.x, -1); assert.ok(Math.abs(g.y - (-0.5 + 0.1)) < 1e-9); assert.equal(g.z, -0.5);
  const p = fitBox([-0.5, 0, -0.5], [0.5, 2, 0.5], { kind: 'prop', fit: 'proc', scale: 1 }, { w: 0.6, h: 1.0 });
  assert.equal(p.s, 0.5); // height rules; the width (0.6 × 1.15) allows it
  const q = fitBox([-2, 0, -2], [2, 1, 2], { kind: 'prop', fit: 'proc', scale: 1 }, { w: 1, h: 1 });
  assert.ok(Math.abs(q.s - 1.15 / 4) < 1e-9); // a wide model is held to the footprint
});

test('bone names: sides and bases across conventions', () => {
  const cases = [
    ['mixamorig:LeftUpLeg', 'L', 'thigh'], ['mixamorig:RightForeArm', 'R', 'forearm'], ['mixamorig:Spine2', '', 'spine'],
    ['thigh.L', 'L', 'thigh'], ['DEF-upper_arm.R', 'R', 'arm'], ['DEF-forearm.L', 'L', 'forearm'], ['shin.R', 'R', 'shin'],
    ['calf_l', 'L', 'shin'], ['upperarm_r', 'R', 'arm'], ['lowerarm_l', 'L', 'forearm'], ['spine_03', '', 'spine'], ['neck_01', '', 'neck'],
    ['Bip01 L Thigh', 'L', 'thigh'], ['Bip01 R Calf', 'R', 'shin'], ['Bip01 L UpperArm', 'L', 'arm'], ['Bip01 Pelvis', '', 'hips'],
    ['J_Bip_L_UpperLeg', 'L', 'thigh'], ['J_Bip_C_Hips', '', 'hips'], ['J_Bip_R_LowerArm', 'R', 'forearm'],
    ['LeftHandIndex1', 'L', 'finger'], ['LeftToeBase', 'L', 'toe'], ['HeadTop_End', '', 'end'], ['Hips', '', 'hips'], ['neck', '', 'neck'],
    ['LeftShoulder', 'L', 'clavicle'], ['LThigh', 'L', 'thigh'],
  ];
  for (const [n, side, role] of cases) {
    const r = boneRole(n);
    assert.equal(r.side, side, `${n} side`); assert.equal(r.role, role, `${n} role (base ${r.base})`);
  }
  assert.equal(parseBoneName('mixamorig:Hips').base, 'hips');
});

// A Mixamo-like skeleton as names + parents.
const MIXAMO = [
  ['Hips', -1], ['Spine', 0], ['Spine1', 1], ['Spine2', 2], ['Neck', 3], ['Head', 4], ['HeadTop_End', 5],
  ['LeftShoulder', 3], ['LeftArm', 7], ['LeftForeArm', 8], ['LeftHand', 9], ['LeftHandIndex1', 10],
  ['RightShoulder', 3], ['RightArm', 12], ['RightForeArm', 13], ['RightHand', 14],
  ['LeftUpLeg', 0], ['LeftLeg', 16], ['LeftFoot', 17], ['LeftToeBase', 18],
  ['RightUpLeg', 0], ['RightLeg', 20], ['RightFoot', 21],
].map(([n, p]) => ['mixamorig:' + n, p]);

test('mapBones: a Mixamo skeleton maps fully; spine and chest from the chain; feet and hands found', () => {
  const names = MIXAMO.map((b) => b[0]), parents = MIXAMO.map((b) => b[1]);
  const r = mapBones(names, parents);
  assert.deepEqual(r.missing, []);
  const at = (k) => names[r.map[k]].replace('mixamorig:', '');
  assert.equal(at('hips'), 'Hips'); assert.equal(at('spine'), 'Spine'); assert.equal(at('chest'), 'Spine2'); assert.equal(at('head'), 'Head');
  assert.equal(at('thighL'), 'LeftUpLeg'); assert.equal(at('shinR'), 'RightLeg'); assert.equal(at('armL'), 'LeftArm'); assert.equal(at('foreR'), 'RightForeArm');
  assert.equal(names[r.foot.L], 'mixamorig:LeftFoot'); assert.equal(names[r.hand.R], 'mixamorig:RightHand');
  for (const k of OUR_BONES) assert.ok(r.map[k] >= 0, k);
});

test('mapBones: overrides, missing bones, Unreal names', () => {
  const ue = [['root', -1], ['pelvis', 0], ['spine_01', 1], ['spine_02', 2], ['spine_03', 3], ['neck_01', 4], ['head', 5],
    ['clavicle_l', 4], ['upperarm_l', 7], ['lowerarm_l', 8], ['hand_l', 9], ['clavicle_r', 4], ['upperarm_r', 11], ['lowerarm_r', 12], ['hand_r', 13],
    ['thigh_l', 1], ['calf_l', 15], ['foot_l', 16], ['thigh_r', 1], ['calf_r', 18], ['foot_r', 19]];
  const r = mapBones(ue.map((b) => b[0]), ue.map((b) => b[1]));
  assert.deepEqual(r.missing, []);
  assert.equal(ue[r.map.chest][0], 'spine_03'); assert.equal(ue[r.map.spine][0], 'spine_01');
  const broken = mapBones(['Hips', 'Body', 'Skull'], [-1, 0, 1]);
  assert.ok(broken.missing.includes('head') && broken.missing.includes('armL'));
  const fixed = mapBones(['Hips', 'Body', 'Skull'], [-1, 0, 1], { head: 'Skull', spine: 'body' });
  assert.equal(fixed.map.head, 2); assert.equal(fixed.map.spine, 1);
});

test('followMap: necks turn with the head, clavicles ride the chest, hands the forearm, roots the body', () => {
  const names = MIXAMO.map((b) => b[0]), parents = MIXAMO.map((b) => b[1]);
  const r = mapBones(names, parents);
  const ours = { body: 0, hips: 1, thighL: 2, shinL: 3, thighR: 4, shinR: 5, spine: 6, chest: 7, head: 8, armL: 9, foreL: 10, armR: 11, foreR: 12 };
  const f = followMap(names, parents, r.map, ours);
  const of = (n) => f[names.indexOf('mixamorig:' + n)];
  assert.equal(of('Neck'), ours.head); assert.equal(of('LeftShoulder'), ours.chest); assert.equal(of('Spine1'), ours.spine);
  assert.equal(of('LeftHandIndex1'), ours.foreL); assert.equal(of('LeftToeBase'), ours.shinL); assert.equal(of('HeadTop_End'), ours.head);
  const g = followMap(['Armature', ...names], [-1, ...parents.map((p) => (p < 0 ? 0 : p + 1))], Object.fromEntries(Object.entries(r.map).map(([k, v]) => [k, v + 1])), ours);
  assert.equal(g[0], ours.body);
});

test('readGlb: header, JSON chunk, accessor bounds', () => {
  const json = { asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 3, type: 'VEC3', componentType: 5126, min: [-1, 0, -2], max: [1, 2, 2] }] };
  const js = Buffer.from(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  const jsonChunk = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const bin = Buffer.alloc(36);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const g = readGlb(Buffer.concat([head, jh, jsonChunk, bh, bin]));
  assert.equal(g.json.asset.version, '2.0'); assert.equal(g.bin.length, 36);
  assert.throws(() => readGlb(Buffer.from('not a glb at all')), /glTF/);
});

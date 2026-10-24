import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import * as particlesModule from '../../src/render/vfx/niagara/particles.js';
import { NativeSimulation } from './native-simulation.js';
import { BasicHitSimulation, NAMES as BASICHIT_NAMES } from '../../src/render/vfx/niagara/basichit-simulation.js';
import { depthFactor as stageDepthFactor } from '../../src/render/vfx/niagara/depth-stage.js';
import { DEPTH_FADE_DISTANCE, depthFactor, DEPTH_FADE_GLSL } from '../../src/render/vfx/niagara/core/depth-fade.js';
import { SUBUV_ATLAS_UV_GLSL, subUVAtlasUv, validateGrid } from '../../src/render/vfx/niagara/core/subuv-atlas.js';
import { spriteLayer, SPRITE_FACINGS, SPRITE_FACING_GLSL, SPRITE_CORNER_GLSL, SPRITE_VERTEX_SHADER, SPRITE_FRAGMENT_SHADER } from '../../src/render/vfx/niagara/core/sprite-shader.js';
import { frameSpec, validateFrame as validateSpecFrame, BASICHIT_FRAME_SPEC } from '../../src/render/vfx/niagara/core/frame-spec.js';
import { createHash } from 'node:crypto';
import { SUBUV_POLICIES } from '../../src/render/vfx/niagara/core/subuv-atlas.js';
import { SPRITE_FACING_MODES, SPRITE_OPACITIES, cameraPositionBasis, RADIAL_GRADIENT_EXPONENTIAL, RADIAL_GRADIENT_EXPONENTIAL_GLSL,
  radialGradientExponential } from '../../src/render/vfx/niagara/core/sprite-shader.js';

const { PilotParticles, validateFrame } = particlesModule;
const pilotSource = JSON.parse(await fs.readFile(new URL('./pilot-source.json', import.meta.url)));
const basicHitSource = JSON.parse(await fs.readFile(new URL('../../src/render/vfx/niagara/basichit-source.json', import.meta.url)));
const particle = (extra = {}) => ({ position: [100, 200, 300], size: [120, 140], color: [40, .7, .2, 1], rotation: 20, subImage: 3, ...extra });
const pilotFrame = (schema = 'st01c-cpu-frame/v1') => ({ schema, systemAge: 1,
  emitters: ['NE_Flame_Basic_001', 'NE_Smoke_Basic'].map(name => ({ name, particles: [particle()] })) });
const typeError = property => ({ name: 'TypeError', message: `Cannot read properties of null (reading '${property}')` });

// Accept/reject table of the pilot binding, written against the pre-refactor particles.js (2b01a28).
const PILOT_REJECTS = [
  ['null frame', () => null, 'Invalid observed frame'],
  ['BasicHit schema', f => { f.schema = 'st01c-basichit-frame/v1'; }, 'Invalid observed frame'],
  ['three emitters', f => { f.emitters.push({ name: 'NE_Smoke_Basic', particles: [] }); }, 'Invalid observed frame'],
  ['one emitter', f => { f.emitters.pop(); }, 'Invalid observed frame'],
  ['no emitters', f => { delete f.emitters; }, 'Invalid observed frame'],
  ['NaN system age', f => { f.systemAge = NaN; }, 'Invalid observed frame'],
  ['negative system age', f => { f.systemAge = -1 / 60; }, 'Invalid observed frame'],
  ['string system age', f => { f.systemAge = '1'; }, 'Invalid observed frame'],
  ['emitters reversed', f => { f.emitters.reverse(); }, 'Unexpected emitter or particle bounds'],
  ['wrong emitter name', f => { f.emitters[1].name = 'NE_Basic_Flash001'; }, 'Unexpected emitter or particle bounds'],
  ['particles not an array', f => { f.emitters[0].particles = {}; }, 'Unexpected emitter or particle bounds'],
  ['513 particles', f => { f.emitters[0].particles = Array.from({ length: 513 }, () => particle()); }, 'Unexpected emitter or particle bounds'],
  ['infinite position', f => { f.emitters[0].particles[0].position[0] = Infinity; }, 'Invalid particle position'],
  ['short size', f => { f.emitters[1].particles[0].size.pop(); }, 'Invalid particle size'],
  ['short color', f => { f.emitters[1].particles[0].color.pop(); }, 'Invalid particle color'],
  ['missing color', f => { delete f.emitters[0].particles[0].color; }, 'Invalid particle color'],
  ['NaN rotation', f => { f.emitters[0].particles[0].rotation = NaN; }, 'Invalid sprite attributes'],
  ['missing subImage', f => { delete f.emitters[0].particles[0].subImage; }, 'Invalid sprite attributes'],
  ['missing smoke subImage', f => { delete f.emitters[1].particles[0].subImage; }, 'Invalid sprite attributes'],
  ['negative subImage', f => { f.emitters[1].particles[0].subImage = -1; }, 'Invalid sprite attributes'],
  ['NaN subImage', f => { f.emitters[0].particles[0].subImage = NaN; }, 'Invalid sprite attributes'],
  ['null subImage', f => { f.emitters[0].particles[0].subImage = null; }, 'Invalid sprite attributes'],
  ['negative size', f => { f.emitters[0].particles[0].size[1] = -1; }, 'Invalid sprite attributes'],
  ['null particle', f => { f.emitters[0].particles[0] = null; }, typeError('position')],
  ['null emitter', f => { f.emitters[0] = null; }, typeError('name')]
];

test('pilot binding keeps its accept/reject results and messages', () => {
  for (const schema of ['st01c-cpu-frame/v1', 'st01c-update-frame/v1', 'st01c-native-frame/v1']) {
    const f = pilotFrame(schema);
    assert.equal(validateFrame(f), f, schema);
  }
  const edge = pilotFrame();
  edge.systemAge = 0;
  edge.emitters[0].particles = Array.from({ length: 512 }, () => particle({ subImage: 0, size: [0, 0], extra: 'kept' }));
  edge.emitters[1].particles = [];
  assert.equal(validateFrame(edge), edge);
  for (const [label, mutate, expected] of PILOT_REJECTS) {
    const f = pilotFrame(), replaced = mutate(f);
    const input = replaced === undefined ? f : replaced;
    assert.throws(() => validateFrame(input), typeof expected === 'string' ? { name: 'Error', message: expected } : expected, label);
  }
});

test('pilot binding accepts every native simulation frame, steps 0..480', () => {
  const sim = new NativeSimulation(pilotSource);
  let particles = 0;
  for (let step = 0; step <= 480; step++) {
    const frame = sim.seek(step);
    assert.equal(validateFrame(frame), frame);
    particles += frame.emitters[0].particles.length + frame.emitters[1].particles.length;
  }
  assert.ok(particles > 0);
});

test('PilotParticles keeps its exports, materials and uniforms', () => {
  assert.deepEqual(Object.keys(particlesModule).sort(), ['PilotParticles', 'toScene', 'validateFrame']);
  for (const count of [1, 2, 3]) {
    const textures = Array.from({ length: count }, () => new THREE.Texture());
    const scene = new THREE.Scene(), particles = new PilotParticles(scene, textures);
    assert.equal(particles.layers.length, count);
    assert.equal(particles.count, 0);
    particles.layers.forEach((mesh, index) => {
      const m = mesh.material, u = m.uniforms;
      assert.ok(m.isShaderMaterial);
      assert.deepEqual([m.transparent, m.toneMapped, m.depthWrite, m.depthTest, m.side], [true, false, false, true, THREE.DoubleSide]);
      assert.deepEqual([mesh.renderOrder, mesh.frustumCulled, mesh.geometry.instanceCount], [index, false, 0]);
      assert.equal(u.atlas.value, textures[index]);
      assert.equal(u.opaqueDepth.value, textures[index]);
      assert.deepEqual(u.grid.value.toArray(), index ? [10, 6] : [8, 4]);
      assert.deepEqual(u.depthSize.value.toArray(), [512, 512]);
      assert.deepEqual(u.nearFar.value.toArray(), [.01, 100]);
      assert.equal(u.orthographic.value, true);
      assert.equal(u.depthFadeEnabled.value, false);
      for (const [name, size] of Object.entries({ particlePosition: 3, particleSize: 2, particleColor: 4, particleRotation: 1, particleFrame: 1 })) {
        const a = mesh.geometry.attributes[name];
        assert.ok(a.isInstancedBufferAttribute, name);
        assert.deepEqual([a.itemSize, a.count, a.usage], [size, 512, THREE.DynamicDrawUsage], name);
      }
    });
    const depth = new THREE.Texture(), camera = new THREE.PerspectiveCamera(50, 1, .5, 40);
    particles.setDepth(depth, camera, 256, 128, true);
    for (const mesh of particles.layers) {
      const u = mesh.material.uniforms;
      assert.equal(u.opaqueDepth.value, depth);
      assert.deepEqual([u.nearFar.value.toArray(), u.orthographic.value, u.depthSize.value.toArray(), u.depthFadeEnabled.value],
        [[.5, 40], false, [256, 128], true]);
    }
    if (count === 2) {
      particles.update(pilotFrame(), [true, false]);
      assert.equal(particles.count, 1);
      const a = particles.layers[0].geometry.attributes;
      assert.deepEqual([...a.particleSize.array.slice(0, 2)].map(v => Math.fround(v)), [Math.fround(1.2), Math.fround(1.4)]);
      assert.deepEqual([a.particleRotation.array[0], a.particleFrame.array[0]], [20, 3]);
      assert.deepEqual([particles.layers[0].visible, particles.layers[1].visible], [true, false]);
    }
    particles.dispose(); depth.dispose(); textures.forEach(t => t.dispose());
    assert.equal(scene.children.length, 0);
  }
});

test('DepthFade has one source: the default 100 cm span, explicit distances, and the stage re-export', () => {
  assert.equal(DEPTH_FADE_DISTANCE, 1);
  assert.equal(stageDepthFactor, depthFactor);
  for (const [gap, expected] of [[-.25, 0], [0, 0], [.25, .25], [.5, .5], [1, 1], [1.5, 1]])
    assert.equal(depthFactor(5 + gap, 5), expected);
  assert.equal(depthFactor(5.25, 5, .5), .5);
  assert.equal(depthFactor(6, 5, 2), .5);
  for (const args of [[Infinity, 5], [5, NaN], [5, 5, 0], [5, 5, -1], [5, 5, Infinity]])
    assert.throws(() => depthFactor(...args), { message: 'Invalid linear depth' });
  // The GLSL twin divides by the layer uniform, never by a literal span.
  assert.match(DEPTH_FADE_GLSL, /uniform float depthFadeDistance;/);
  assert.match(DEPTH_FADE_GLSL, /\(sceneDepth - viewDepth\(gl_FragCoord\.z\)\) \/ depthFadeDistance/);
  assert.doesNotMatch(DEPTH_FADE_GLSL, /\/ 1\.0/);
});

test('SubUV atlas UV: top-left row-major cells, floor then clamp, 1x1 is the plain quad', () => {
  const close = (actual, expected) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12, `${actual} vs ${expected}`));
  close(subUVAtlasUv(0, [8, 4], [0, 1]), [0, 1]);
  close(subUVAtlasUv(0, [8, 4], [1, 0]), [1 / 8, 3 / 4]);
  close(subUVAtlasUv(9, [8, 4], [0, 1]), [1 / 8, 3 / 4]);
  close(subUVAtlasUv(9.99, [8, 4], [0, 1]), [1 / 8, 3 / 4]);
  close(subUVAtlasUv(31, [8, 4], [1, 0]), [1, 0]);
  close(subUVAtlasUv(40, [8, 4], [1, 0]), [1, 0]);
  close(subUVAtlasUv(-3, [8, 4], [0, 1]), [0, 1]);
  close(subUVAtlasUv(59, [10, 6], [0, 0]), [9 / 10, 0]);
  for (const uv of [[0, 0], [1, 1], [.25, .75]]) close(subUVAtlasUv(7, [1, 1], uv), uv);
  assert.deepEqual(validateGrid([1, 1]), [1, 1]);
  for (const grid of [[0, 4], [8], [8, 4, 1], [1.5, 2], ['8', 4], null])
    assert.throws(() => validateGrid(grid), { message: 'Invalid SubUV grid' });
  assert.match(SUBUV_ATLAS_UV_GLSL, /clamp\(floor\(subImage\), 0\.0, grid\.x \* grid\.y - 1\.0\)/);
});

test('sprite layers are data: grid, texture and DepthFade become defines; facing stays camera-plane', () => {
  const pilot = spriteLayer({ grid: [8, 4], texture: true, depthFade: DEPTH_FADE_DISTANCE });
  assert.deepEqual(pilot, { grid: [8, 4], texture: true, depthFade: 1, facing: 'camera-plane', defines: { SPRITE_TEXTURE: '', DEPTH_FADE: '' } });
  assert.ok(Object.isFrozen(pilot) && Object.isFrozen(pilot.grid) && Object.isFrozen(pilot.defines));
  assert.deepEqual(spriteLayer({ grid: [1, 1], texture: true, depthFade: null }).defines, { SPRITE_TEXTURE: '' });
  assert.deepEqual(spriteLayer({ grid: [1, 1], texture: false, depthFade: null }).defines, {});
  assert.equal(spriteLayer({ grid: [8, 4], texture: true, depthFade: .5 }).depthFade, .5);
  assert.deepEqual(SPRITE_FACINGS, ['camera-plane']);
  assert.throws(() => spriteLayer({ grid: [8, 4], texture: true, depthFade: null, facing: 'FaceCameraPosition' }), { message: 'Unsupported sprite facing' });
  for (const [options, message] of [
    [{ texture: true, depthFade: null }, 'Invalid SubUV grid'], [{ grid: [0, 1], texture: true, depthFade: null }, 'Invalid SubUV grid'],
    [{ grid: [1, 1], texture: 1, depthFade: null }, 'Invalid sprite texture option'], [{ grid: [1, 1], depthFade: null }, 'Invalid sprite texture option'],
    [{ grid: [1, 1], texture: true }, 'Invalid DepthFade distance'], [{ grid: [1, 1], texture: true, depthFade: 0 }, 'Invalid DepthFade distance'],
    [{ grid: [1, 1], texture: true, depthFade: -1 }, 'Invalid DepthFade distance'], [{ grid: [1, 1], texture: true, depthFade: NaN }, 'Invalid DepthFade distance']
  ]) assert.throws(() => spriteLayer(options), { message }, JSON.stringify(options));
  for (const chunk of [SPRITE_CORNER_GLSL, SPRITE_FACING_GLSL, SUBUV_ATLAS_UV_GLSL]) assert.ok(SPRITE_VERTEX_SHADER.includes(chunk));
  assert.ok(SPRITE_FRAGMENT_SHADER.includes(DEPTH_FADE_GLSL));
  // The pilot materials are built from the core shader and options: both layers textured, DepthFade 100 cm.
  const textures = [new THREE.Texture(), new THREE.Texture()], particles = new PilotParticles(new THREE.Scene(), textures);
  for (const mesh of particles.layers) {
    assert.equal(mesh.material.vertexShader, SPRITE_VERTEX_SHADER);
    assert.equal(mesh.material.fragmentShader, SPRITE_FRAGMENT_SHADER);
    assert.deepEqual(mesh.material.defines, { SPRITE_TEXTURE: '', DEPTH_FADE: '' });
    assert.equal(mesh.material.uniforms.depthFadeDistance.value, DEPTH_FADE_DISTANCE);
  }
  particles.dispose(); textures.forEach(t => t.dispose());
});

test('frame specs are checked when built and only built specs validate frames', () => {
  const emitters = [{ name: 'A', subImage: 'required' }];
  const spec = frameSpec({ schemas: ['s/v1'], emitters, limit: 4 });
  assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.emitters[0]));
  emitters[0].name = 'B';
  assert.equal(spec.emitters[0].name, 'A');
  emitters[0].name = 'A';
  for (const bad of [undefined, { schemas: [], emitters, limit: 4 }, { schemas: [''], emitters, limit: 4 },
    { schemas: ['s/v1'], emitters: [], limit: 4 }, { schemas: ['s/v1'], emitters: [{ name: 'A', subImage: 'maybe' }], limit: 4 },
    { schemas: ['s/v1'], emitters: [{ name: '', subImage: 'optional' }], limit: 4 },
    { schemas: ['s/v1'], emitters: [{ name: 'A', subImage: 'optional' }, { name: 'A', subImage: 'optional' }], limit: 4 },
    { schemas: ['s/v1'], emitters, limit: 0 }, { schemas: ['s/v1'], emitters, limit: 1.5 }])
    assert.throws(() => frameSpec(bad), { message: 'Invalid frame spec' });
  const frame = { schema: 's/v1', systemAge: 0, emitters: [{ name: 'A', particles: [] }] };
  assert.equal(validateSpecFrame(frame, spec), frame);
  assert.throws(() => validateSpecFrame(frame, structuredClone(spec)), { message: 'Invalid frame spec' });
  assert.throws(() => validateSpecFrame(frame), { message: 'Invalid frame spec' });
});

test('BASICHIT spec accepts every BasicHitSimulation frame at the default seed, steps 0..240', () => {
  assert.deepEqual(BASICHIT_FRAME_SPEC.emitters.map(e => e.name), basicHitSource.emitterNames);
  assert.deepEqual(BASICHIT_FRAME_SPEC.emitters.map(e => e.name), [...BASICHIT_NAMES]);
  assert.deepEqual(BASICHIT_FRAME_SPEC.emitters.map(e => e.subImage), ['required', 'optional', 'optional']);
  const sim = new BasicHitSimulation(basicHitSource), seen = [0, 0, 0];
  for (let step = 0; step <= 240; step++) {
    const frame = sim.seek(step);
    assert.equal(validateSpecFrame(frame, BASICHIT_FRAME_SPEC), frame, `step ${step}`);
    frame.emitters.forEach((e, i) => { seen[i] += e.particles.length; });
  }
  assert.ok(seen.every(n => n > 0), `particles seen per emitter ${seen}`);
  // Each family rejects the other family's frames.
  assert.throws(() => validateFrame(sim.seek(1)), { message: 'Invalid observed frame' });
  assert.throws(() => validateSpecFrame(new NativeSimulation(pilotSource).seek(60), BASICHIT_FRAME_SPEC), { message: 'Invalid observed frame' });
});

test('BASICHIT spec rejects malformed frames and keeps subImage optional only where declared', () => {
  const base = new BasicHitSimulation(basicHitSource).seek(1);
  assert.deepEqual(base.emitters.map(e => e.particles.length), [1, 1, 250]);
  assert.ok(!('subImage' in base.emitters[1].particles[0]) && !('subImage' in base.emitters[2].particles[0]));
  const check = (mutate, expected, label) => {
    const f = structuredClone(base); mutate(f);
    if (expected === true) assert.equal(validateSpecFrame(f, BASICHIT_FRAME_SPEC), f, label);
    else assert.throws(() => validateSpecFrame(f, BASICHIT_FRAME_SPEC), { message: expected }, label);
  };
  check(() => {}, true, 'unchanged');
  check(f => { f.emitters[1].particles[0].subImage = 0; f.emitters[2].particles[5].subImage = 3.5; }, true, 'valid optional subImage');
  check(f => { f.emitters.pop(); }, 'Invalid observed frame', 'two emitters');
  check(f => { f.schema = 'st01c-native-frame/v1'; }, 'Invalid observed frame', 'pilot schema');
  check(f => { f.emitters[1].name = 'NE_Smoke_Basic'; }, 'Unexpected emitter or particle bounds', 'wrong emitter name');
  check(f => { [f.emitters[1], f.emitters[2]] = [f.emitters[2], f.emitters[1]]; }, 'Unexpected emitter or particle bounds', 'emitter order');
  check(f => { f.emitters[2].particles = Array.from({ length: 513 }, () => f.emitters[2].particles[0]); }, 'Unexpected emitter or particle bounds', '513 particles');
  check(f => { delete f.emitters[0].particles[0].subImage; }, 'Invalid sprite attributes', 'Flame without subImage');
  check(f => { f.emitters[0].particles[0].subImage = -1; }, 'Invalid sprite attributes', 'negative Flame subImage');
  for (const value of [NaN, Infinity, -Infinity, null, '1', -1])
    for (const emitter of [1, 2])
      check(f => { f.emitters[emitter].particles[0].subImage = value; }, 'Invalid sprite attributes', `emitter ${emitter} subImage ${value}`);
  check(f => { f.emitters[2].particles[0].rotation = NaN; }, 'Invalid sprite attributes', 'NaN rotation');
  check(f => { f.emitters[1].particles[0].color.pop(); }, 'Invalid particle color', 'short color');
});

// ---------- Opt-in render options for NS_BasicHit (T-1021-46). The pilot's defaults stay as above.

// Line-level #ifdef/#else/#endif for the test: the GLSL a define set leaves.
function preprocess(text, defines) {
  const out = [], stack = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#ifdef ')) { stack.push(defines.includes(t.slice(7).trim())); continue; }
    if (t === '#else') { stack.push(!stack.pop()); continue; }
    if (t === '#endif') { stack.pop(); continue; }
    if (stack.every(Boolean)) out.push(line);
  }
  assert.equal(stack.length, 0, 'balanced #ifdef');
  return out.join('\n');
}

test('pilot define sets preprocess to the exact shaders of 590687c', () => {
  // sha256 of the preprocessed SPRITE_VERTEX_SHADER / SPRITE_FRAGMENT_SHADER of core/ at 590687c, same preprocess.
  const sha = s => createHash('sha256').update(s).digest('hex');
  const vertex = '3ceece1998e6b2b1384b36d3aac77abba264c1b5f2f87d015487ad2ae5a62d44';
  for (const [defines, fragment] of [
    [['SPRITE_TEXTURE', 'DEPTH_FADE'], 'f9b80d4b905d1ab97add514d6369c15fdd6e416bb4f40c7dad366a89170c294e'],
    [['SPRITE_TEXTURE'], 'c115f8e34c07829c7c172648ccbd1415b1b43706ed65381119e9c3fc776fa68b'],
    [['DEPTH_FADE'], 'ee5efb5f7e36042a5fbf61b3029a9eb439ec86ebd729f58515dac934d2570b56'],
    [[], 'e6ad49ccf006fbb6ac3087e4043b2e053985d93e1da6d76bd3bffda50d846efe']]) {
    assert.equal(sha(preprocess(SPRITE_VERTEX_SHADER, defines)), vertex, JSON.stringify(defines));
    assert.equal(sha(preprocess(SPRITE_FRAGMENT_SHADER, defines)), fragment, JSON.stringify(defines));
  }
  const pilot = preprocess(SPRITE_VERTEX_SHADER, ['SPRITE_TEXTURE', 'DEPTH_FADE']) + preprocess(SPRITE_FRAGMENT_SHADER, ['SPRITE_TEXTURE', 'DEPTH_FADE']);
  for (const word of ['cameraPosition', 'trunc', 'radialGradientExponential']) assert.ok(!pilot.includes(word), word);
});

test('SubUV wrap policy: UE floor + 0.5, fmod column, unbounded row; equals clamp inside the grid', () => {
  const close = (actual, expected, label) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12, `${label}: ${actual} vs ${expected}`));
  assert.deepEqual(SUBUV_POLICIES, ['clamp', 'wrap']);
  for (const grid of [[8, 4], [10, 6], [1, 1]]) for (let frame = 0; frame < grid[0] * grid[1]; frame++)
    for (const fraction of [0, .25, .999]) for (const uv of [[0, 0], [1, 1], [.3, .7]])
      close(subUVAtlasUv(frame + fraction, grid, uv, 'wrap'), subUVAtlasUv(frame + fraction, grid, uv), `${grid} ${frame + fraction}`);
  // The gate frames of the Flame: subImage 3.33, 10, 20, 30 (steps 2, 6, 12, 18).
  close(subUVAtlasUv(3.3333334922790527, [8, 4], [0, 1], 'wrap'), [3 / 8, 1]);
  close(subUVAtlasUv(30.000003814697266, [8, 4], [1, 0], 'wrap'), [7 / 8, 0]);
  // Past the grid the row keeps counting: 35 = column 3, row 4 (one atlas height below), read as cell 3 by TA_WRAP.
  close(subUVAtlasUv(35, [8, 4], [0, 1], 'wrap'), [3 / 8, 0]);
  close(subUVAtlasUv(35, [8, 4], [1, 0], 'wrap'), [4 / 8, -1 / 4]);
  for (let frame = 32; frame < 64; frame++) {
    const wrapped = subUVAtlasUv(frame, [8, 4], [.25, .75], 'wrap'), cell = subUVAtlasUv(frame - 32, [8, 4], [.25, .75]);
    close([wrapped[0], wrapped[1] + 1], cell, `idx ${frame} mod 32`);
  }
  // The clamp default is unchanged; unknown policies fail.
  close(subUVAtlasUv(40, [8, 4], [1, 0], 'clamp'), [1, 0]);
  for (const policy of ['mirror', '', null, 'WRAP']) assert.throws(() => subUVAtlasUv(1, [8, 4], [0, 0], policy), { message: 'Invalid SubUV policy' });
  assert.match(SUBUV_ATLAS_UV_GLSL, /#ifdef SUBUV_WRAP\n {2}float a = subImage - fract\(subImage\) \+ 0\.5;\n {2}float column = floor\(a - grid\.x \* trunc\(a \/ grid\.x\)\);\n {2}float row = floor\(a \* \(1\.0 \/ grid\.x\)\);/);
});

test('sprite layers take the opt-in facing, SubUV policy and radial opacity as defines', () => {
  assert.deepEqual(SPRITE_FACING_MODES, ['camera-plane', 'camera-position']);
  assert.deepEqual(SPRITE_OPACITIES, ['texel-red', 'radial-gradient-exponential']);
  assert.deepEqual(spriteLayer({ grid: [8, 4], texture: true, depthFade: null, facing: 'camera-position', subUV: 'wrap' }),
    { grid: [8, 4], texture: true, depthFade: null, facing: 'camera-position', subUV: 'wrap',
      defines: { SPRITE_TEXTURE: '', SPRITE_FACING_CAMERA_POSITION: '', SUBUV_WRAP: '' } });
  assert.deepEqual(spriteLayer({ grid: [1, 1], texture: false, depthFade: null, opacity: 'radial-gradient-exponential' }),
    { grid: [1, 1], texture: false, depthFade: null, facing: 'camera-plane', opacity: 'radial-gradient-exponential',
      defines: { SPRITE_RADIAL_GRADIENT: '' } });
  // Explicit defaults give the pilot shape: no subUV or opacity key.
  assert.deepEqual(spriteLayer({ grid: [8, 4], texture: true, depthFade: 1, facing: 'camera-plane', subUV: 'clamp', opacity: 'texel-red' }),
    spriteLayer({ grid: [8, 4], texture: true, depthFade: 1 }));
  for (const [options, message] of [
    [{ facing: 'camera-velocity' }, 'Unsupported sprite facing'], [{ subUV: 'mirror' }, 'Invalid SubUV policy'],
    [{ subUV: null }, 'Invalid SubUV policy'], [{ opacity: 'texel-alpha' }, 'Unsupported sprite opacity'],
    [{ opacity: 'radial-gradient-exponential' }, 'The radial gradient layer is untextured']])
    assert.throws(() => spriteLayer({ grid: [1, 1], texture: true, depthFade: null, ...options }), { message }, JSON.stringify(options));
  const radial = preprocess(SPRITE_FRAGMENT_SHADER, ['SPRITE_RADIAL_GRADIENT']);
  assert.ok(radial.includes(RADIAL_GRADIENT_EXPONENTIAL_GLSL));
  assert.match(radial, /clamp\(tint\.a \* radialGradientExponential\(vec2\(atlasUv\.x, 1\.0 - atlasUv\.y\)\), 0\.0, 1\.0\) \* fade/);
  assert.ok(!radial.includes('texel.r * tint.a') && !radial.includes('uniform sampler2D atlas'));
  const position = preprocess(SPRITE_VERTEX_SHADER, ['SPRITE_FACING_CAMERA_POSITION']);
  assert.match(position, /vec3 direction = spriteSafeNormalize\(cameraPosition - center\);/);
  assert.match(position, /vec3 right = spriteSafeNormalize\(cross\(vec3\(0\.0, 1\.0, 0\.0\), direction\)\);/);
  assert.match(position, /vec3 up = cross\(right, direction\);/);
  assert.match(position, /viewMatrix \* vec4\(center \+ corner\.x \* right - corner\.y \* up, 1\.0\)/);
});

test('camera-position basis is UE FaceCameraPosition carried through toScene', () => {
  const { toScene } = particlesModule;
  const direction = v => toScene(v.map(x => x * 100)); // toScene without the cm-to-m scale
  const close = (a, b, label) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${label}: ${a} vs ${b}`));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = v => { const l = Math.max(Math.hypot(...v), .000001); return v.map(x => x / l); };
  const cameras = { front: [820, 0, -10], oblique: [551.5704195109398, 531.5704195109398, 263.61611466053495], side: [20.00000000000005, 800, -10] };
  for (const [view, camera] of Object.entries(cameras)) for (const particle of [[0, 0, 0], [32.7, -16.7, -41], [-28.6, 32, 44.9]]) {
    // NiagaraSpriteVertexFactory.ush 561-562, 582-583, in UE axes.
    const d = normalize(camera.map((v, i) => v - particle[i])), right = normalize(cross(d, [0, 0, 1])), up = cross(d, right);
    const basis = cameraPositionBasis(toScene(camera), toScene(particle));
    close(basis.direction, direction(d), `${view} direction`);
    close(basis.right, direction(right), `${view} right`);
    close(basis.up, direction(up), `${view} up`);
  }
  // On the camera axis of the reference cameras (roll 0) the basis is FaceCamera's: Right = view right, Up = -view up.
  const round = v => v.map(x => Math.round(x * 1e9) / 1e9 + 0);
  for (const [view, position] of Object.entries(cameras)) {
    const camera = new THREE.OrthographicCamera(-4.25, 4.25, 4.25, -4.25, .01, 100);
    camera.position.set(...toScene(position)); camera.lookAt(new THREE.Vector3(...toScene([20, 0, -10]))); camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements, basis = cameraPositionBasis(toScene(position), toScene([20, 0, -10]));
    close(round(basis.right), round([e[0], e[1], e[2]]), `${view} view right`);
    close(round(basis.up), round([-e[4], -e[5], -e[6]]), `${view} -view up`);
  }
});

test('RadialGradientExponential twin matches the RENDER-SOURCES samples and GLSL line', async () => {
  const sources = JSON.parse(await fs.readFile(new URL('../../docs/delivery/st01c/basichit/render-sources.json', import.meta.url)));
  const instance = sources.radialGradientExponential.instance;
  assert.deepEqual({ ...RADIAL_GRADIENT_EXPONENTIAL, center: [...RADIAL_GRADIENT_EXPONENTIAL.center] },
    { center: instance.unwired.CenterPosition, radius: .5, density: instance.unwired.Density, invertDensity: instance.unwired['Invert Density'] });
  assert.match(instance.wired.Radius, /DefaultValue 0\.5/);
  for (const { distanceFromCenterUv, value } of instance.samplesAlongRadius)
    for (const [du, dv] of [[1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]])
      assert.ok(Math.abs(radialGradientExponential([.5 + du * distanceFromCenterUv, .5 + dv * distanceFromCenterUv]) - value) < 5e-7, `${distanceFromCenterUv}`);
  for (const uv of [[0, 0], [1, .5], [.5, 1], [.9, .9]]) assert.equal(radialGradientExponential(uv), 0);
  const squash = s => s.replace(/\s+/g, ' ').trim();
  const statements = instance.glsl.split(';').map(squash).filter(Boolean), glsl = squash(RADIAL_GRADIENT_EXPONENTIAL_GLSL);
  assert.equal(statements.length, 4);
  for (const line of statements.slice(0, 2)) assert.ok(glsl.includes(line + ';'), line);
  assert.ok(glsl.includes('return ' + statements[2].replace(/^float grad = /, '') + ';'), statements[2]);
});

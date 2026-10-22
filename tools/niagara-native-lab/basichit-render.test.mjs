import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { BasicHitParticles, BASICHIT_LAYERS, DRAW_ORDERS } from './basichit-render.js';
import { BasicHitSimulation, NAMES } from './basichit-simulation.js';
import { BASICHIT_FRAME_SPEC } from './core/frame-spec.js';
import { SPRITE_VERTEX_SHADER, SPRITE_FRAGMENT_SHADER } from './core/sprite-shader.js';
import { toScene } from './particles.js';

const read = async path => JSON.parse(await fs.readFile(new URL(path, import.meta.url)));
const source = await read('./basichit-source.json');
const renderSources = await read('../../docs/delivery/st01c/basichit/render-sources.json');
// The render reference is basichit-reference05 under controlled-sdr/v1 (reference-profiled-checkpoint.json).
const reference = await read('../../docs/delivery/st01c/basichit/reference-profiled-checkpoint.json');
const referenceFiles = reference.runs.find(r => r.name === reference.referenceRun).files;
const textures = () => BASICHIT_LAYERS.map(d => d.texture ? new THREE.Texture() : null);

test('BasicHit layer descriptors follow the emitters, the T3D facts and the texture address modes', () => {
  assert.deepEqual(BASICHIT_LAYERS.map(d => d.emitter), [...NAMES]);
  assert.deepEqual(BASICHIT_LAYERS.map(d => d.emitter), BASICHIT_FRAME_SPEC.emitters.map(e => e.name));
  const [flame, flash, burst] = BASICHIT_LAYERS;
  assert.deepEqual([flame.layer.grid, flame.layer.facing, flame.layer.subUV, flame.layer.texture, flame.texture, flame.material],
    [[8, 4], 'camera-position', 'wrap', true, 'T_FireBall', 'MI_Fireball']);
  assert.deepEqual([flash.layer.grid, flash.layer.facing, flash.layer.subUV, flash.layer.texture, flash.texture, flash.material],
    [[1, 1], 'camera-plane', undefined, true, 'T_Hit_Circle', 'MI_Hit_1']);
  assert.deepEqual([burst.layer.grid, burst.layer.facing, burst.layer.opacity, burst.layer.texture, burst.texture, burst.material],
    [[1, 1], 'camera-plane', 'radial-gradient-exponential', false, null, 'MI_Radial_2']);
  // No DepthFade in any layer: the reference has no surface behind the effect.
  assert.ok(BASICHIT_LAYERS.every(d => d.layer.depthFade === null && !('DEPTH_FADE' in d.layer.defines)));
  // Address modes and sRGB from the engine read (render-sources.json) and the reference capture.
  for (const d of BASICHIT_LAYERS.filter(x => x.texture)) {
    const [path, t] = Object.entries(renderSources.textures).find(([p]) => p.endsWith('/' + d.texture));
    assert.ok(path && t.addressX === 'TA_WRAP' && t.addressY === 'TA_WRAP' && t.srgb === true, d.texture);
    assert.equal(d.address, 'wrap');
    assert.ok(referenceFiles.some(f => f.file === `textures/${d.texture}.png`), d.texture);
  }
  assert.deepEqual(DRAW_ORDERS, { gate: [0, 1, 2], reverse: [2, 1, 0] });
});

test('page and compare read basichit-reference05 through the profiled checkpoint and the raw RGBA16F HDR', async () => {
  assert.equal(reference.referenceRun, 'basichit-reference05');
  assert.equal(reference.profile.id, 'controlled-sdr/v1');
  const page = await fs.readFile(new URL('./basichit-lab.js', import.meta.url), 'utf8');
  const compare = await fs.readFile(new URL('./compare-basichit.py', import.meta.url), 'utf8');
  assert.match(page, /const RUN = 'basichit-reference05', PROFILE = 'controlled-sdr\/v1'/);
  assert.match(compare, /REFERENCE, PROFILE = 'basichit-reference05', 'controlled-sdr\/v1'/);
  for (const text of [page, compare]) {
    assert.ok(text.includes('reference-profiled-checkpoint.json'));
    assert.ok(!text.includes("'reference-checkpoint.json'") && !text.includes('/reference-checkpoint.json'));
    assert.ok(!/RGBELoader|_linear\.hdr|\['linear'\]|row\.linear/.test(text), 'the Radiance .hdr is not a gate input');
    assert.ok(text.includes('hdr_raw'));
  }
});

test('BasicHitParticles builds one instanced layer per emitter with the gate order and repeating textures', () => {
  const scene = new THREE.Scene(), t = textures(), particles = new BasicHitParticles(scene, t);
  assert.equal(scene.children.length, 3);
  assert.deepEqual(particles.layers.map(m => m.renderOrder), [0, 1, 2]);
  particles.layers.forEach((mesh, index) => {
    const m = mesh.material, d = BASICHIT_LAYERS[index];
    assert.ok(m.isShaderMaterial && mesh.geometry.isInstancedBufferGeometry);
    assert.equal(m.vertexShader, SPRITE_VERTEX_SHADER);
    assert.equal(m.fragmentShader, SPRITE_FRAGMENT_SHADER);
    assert.deepEqual(m.defines, { ...d.layer.defines });
    assert.deepEqual([m.transparent, m.toneMapped, m.depthWrite, m.depthTest, m.side, m.blending], [true, false, false, true, THREE.DoubleSide, THREE.NormalBlending]);
    assert.deepEqual([mesh.frustumCulled, mesh.geometry.instanceCount], [false, 0]);
    assert.deepEqual(m.uniforms.grid.value.toArray(), d.layer.grid);
    assert.equal(m.uniforms.atlas?.value, t[index] ?? undefined);
    for (const [name, size] of Object.entries({ particlePosition: 3, particleSize: 2, particleColor: 4, particleRotation: 1, particleFrame: 1 })) {
      const a = mesh.geometry.attributes[name];
      assert.deepEqual([a.isInstancedBufferAttribute, a.itemSize, a.count, a.usage], [true, size, 512, THREE.DynamicDrawUsage], name);
    }
  });
  assert.deepEqual([t[0].wrapS, t[0].wrapT, t[1].wrapS, t[1].wrapT], Array(4).fill(THREE.RepeatWrapping));
  particles.setOrder('reverse');
  assert.deepEqual(particles.layers.map(m => m.renderOrder), [2, 1, 0]);
  assert.equal(particles.order, 'reverse');
  assert.throws(() => particles.setOrder('depth'), { message: 'Unknown BasicHit draw order' });
  particles.dispose(); t.forEach(x => x?.dispose());
  assert.equal(scene.children.length, 0);
  assert.equal(new BasicHitParticles(new THREE.Scene(), textures(), 'reverse').layers[0].renderOrder, 2);
  for (const bad of [[], [new THREE.Texture(), new THREE.Texture()], [null, new THREE.Texture(), null],
    [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()], [new THREE.Texture(), {}, null]])
    assert.throws(() => new BasicHitParticles(new THREE.Scene(), bad), /BasicHit (textures per layer|layer texture mismatch)/);
});

test('update uploads the native frame per emitter; an absent subImage is 0', () => {
  const particles = new BasicHitParticles(new THREE.Scene(), textures());
  const sim = new BasicHitSimulation(source, { seed: reference.seedConfiguration.fixtureSeedBase });
  for (const step of [2, 6, 12, 18, 24]) {
    const frame = sim.seek(step);
    particles.update(frame);
    assert.deepEqual(particles.counts, frame.emitters.map(e => e.particles.length));
    particles.layers.forEach((mesh, index) => {
      const a = mesh.geometry.attributes, list = frame.emitters[index].particles;
      assert.equal(mesh.geometry.instanceCount, list.length);
      list.forEach((p, i) => {
        const f = Math.fround;
        assert.deepEqual([a.particlePosition.getX(i), a.particlePosition.getY(i), a.particlePosition.getZ(i)], toScene(p.position).map(f));
        assert.deepEqual([a.particleSize.getX(i), a.particleSize.getY(i)], [f(p.size[0] / 100), f(p.size[1] / 100)]);
        assert.deepEqual([0, 1, 2, 3].map(k => a.particleColor.array[4 * i + k]), p.color.map(f));
        assert.equal(a.particleRotation.getX(i), f(p.rotation));
        assert.equal(a.particleFrame.getX(i), index === 0 ? f(p.subImage) : 0);
      });
    });
  }
  // Every frame of the reference window uploads.
  for (let step = 0; step <= 240; step++) particles.update(sim.seek(step));
  particles.dispose();
});

test('update fails closed: BASICHIT_FRAME_SPEC rejects before any buffer changes', () => {
  const particles = new BasicHitParticles(new THREE.Scene(), textures());
  const good = new BasicHitSimulation(source).seek(12);
  particles.update(good);
  const before = particles.layers.map(m => [m.geometry.instanceCount, ...Object.values(m.geometry.attributes).map(a => a.array.slice())]);
  for (const [mutate, message] of [
    [f => { f.emitters[2].particles[3].position[1] = NaN; }, 'Invalid particle position'],
    [f => { f.emitters.pop(); }, 'Invalid observed frame'],
    [f => { delete f.emitters[0].particles[0].subImage; }, 'Invalid sprite attributes'],
    [f => { f.emitters[1].particles = Array.from({ length: 513 }, () => f.emitters[2].particles[0]); }, 'Unexpected emitter or particle bounds'],
    [f => { f.schema = 'st01c-native-frame/v1'; }, 'Invalid observed frame']]) {
    const f = structuredClone(good); mutate(f);
    assert.throws(() => particles.update(f), { message });
    const after = particles.layers.map(m => [m.geometry.instanceCount, ...Object.values(m.geometry.attributes).map(a => a.array.slice())]);
    assert.deepEqual(after, before);
  }
  particles.dispose();
});

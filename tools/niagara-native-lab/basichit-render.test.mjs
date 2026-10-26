import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { BasicHitParticles, BASICHIT_LAYERS, BASICHIT_DEPTH_LAYERS, DRAW_ORDERS } from '../../src/render/vfx/niagara/basichit-render.js';
import { BasicHitDepthStage, planeFromSurface } from './basichit-depth.js';
import { DEPTH_FADE_DISTANCE } from '../../src/render/vfx/niagara/core/depth-fade.js';
import { BasicHitSimulation, NAMES } from '../../src/render/vfx/niagara/basichit-simulation.js';
import { BASICHIT_FRAME_SPEC } from '../../src/render/vfx/niagara/core/frame-spec.js';
import { SPRITE_VERTEX_SHADER, SPRITE_FRAGMENT_SHADER } from '../../src/render/vfx/niagara/core/sprite-shader.js';
import { toScene } from '../../src/render/vfx/niagara/particles.js';

const read = async path => JSON.parse(await fs.readFile(new URL(path, import.meta.url)));
const source = await read('../../src/render/vfx/niagara/basichit-source.json');
const renderSources = await read('../../docs/delivery/st01c/basichit/render-sources.json');
// The render reference is basichit-reference05 under controlled-sdr/v1 (reference-profiled-checkpoint.json).
const reference = await read('../../docs/delivery/st01c/basichit/reference-profiled-checkpoint.json');
const referenceFiles = reference.runs.find(r => r.name === reference.referenceRun).files;
// The depth reference is basichit-reference12 (depth-reference-checkpoint.json): 13 plane poses per capture, DEPTH.md.
const depthReference = await read('../../docs/delivery/st01c/basichit/depth-reference-checkpoint.json');
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
  assert.deepEqual(DRAW_ORDERS, { gate: [0, 1, 2], reverse: [2, 1, 0], engine: [2, 0, 1] });
});

test('page and compare read basichit-reference05 (gate) and basichit-reference10 (wrap) through profiled checkpoints and the raw RGBA16F HDR', async () => {
  assert.equal(reference.referenceRun, 'basichit-reference05');
  assert.equal(reference.profile.id, 'controlled-sdr/v1');
  assert.deepEqual([reference.settings.imageSteps, reference.settings.linearStep], [[2, 6, 12, 18, 24], 12]);
  const page = await fs.readFile(new URL('./basichit-lab.js', import.meta.url), 'utf8');
  const compare = await fs.readFile(new URL('./compare-basichit.py', import.meta.url), 'utf8');
  assert.match(page, /gate: \['basichit-reference05', 'reference-profiled-checkpoint\.json'\],\s+wrap: \['basichit-reference10', 'wrap-reference-checkpoint\.json'\]/);
  assert.match(compare, /'gate': \('basichit-reference05', 'reference-profiled-checkpoint\.json'\),\s+'wrap': \('basichit-reference10', 'wrap-reference-checkpoint\.json'\)/);
  assert.match(page, /PROFILE = 'controlled-sdr\/v1'/);
  assert.match(compare, /PROFILE = 'controlled-sdr\/v1'/);
  for (const text of [page, compare]) {
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
  // SubUV diagnostic: only the wrap layer (the Flame) switches policy; the others keep their defines.
  const s = new BasicHitParticles(new THREE.Scene(), textures());
  const defines = () => s.layers.map(m => ({ ...m.material.defines }));
  const bound = defines();
  assert.equal(s.subUV, 'wrap');
  assert.ok(Object.hasOwn(bound[0], 'SUBUV_WRAP') && !Object.hasOwn(bound[1], 'SUBUV_WRAP') && !Object.hasOwn(bound[2], 'SUBUV_WRAP'));
  s.setSubUV('clamp');
  assert.equal(s.subUV, 'clamp');
  assert.ok(!Object.hasOwn(s.layers[0].material.defines, 'SUBUV_WRAP'));
  assert.deepEqual(defines().slice(1), bound.slice(1));
  s.setSubUV('wrap');
  assert.deepEqual(defines(), bound);
  assert.throws(() => s.setSubUV('mirror'), { message: 'Invalid SubUV policy' });
  s.dispose();
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

test('the Flame has DepthFade 100 cm only in the depth set; Flash and SimpleBurst never', async () => {
  const defaults = await fs.readFile(new URL('../../docs/delivery/st01c/basichit/material-defaults.json', import.meta.url), 'utf8');
  assert.match(defaults, /"fade_distance_default":\s*100\.0/);
  assert.equal(DEPTH_FADE_DISTANCE * 100, 100);
  assert.deepEqual(BASICHIT_DEPTH_LAYERS.map(d => d.layer.depthFade), [DEPTH_FADE_DISTANCE, null, null]);
  assert.deepEqual(BASICHIT_DEPTH_LAYERS.map(d => 'DEPTH_FADE' in d.layer.defines), [true, false, false]);
  assert.ok(BASICHIT_LAYERS.every(d => d.layer.depthFade === null && !('DEPTH_FADE' in d.layer.defines)));
  // Same descriptors otherwise: only the Flame's layer options gain the fade.
  const [gate, withFade] = [BASICHIT_LAYERS[0], BASICHIT_DEPTH_LAYERS[0]];
  assert.deepEqual([withFade.emitter, withFade.material, withFade.texture, withFade.address], [gate.emitter, gate.material, gate.texture, gate.address]);
  assert.deepEqual([withFade.layer.grid, withFade.layer.facing, withFade.layer.subUV, withFade.layer.texture], [gate.layer.grid, gate.layer.facing, gate.layer.subUV, gate.layer.texture]);
  assert.equal(BASICHIT_DEPTH_LAYERS[1], BASICHIT_LAYERS[1]);
  assert.equal(BASICHIT_DEPTH_LAYERS[2], BASICHIT_LAYERS[2]);
  const plain = new BasicHitParticles(new THREE.Scene(), textures()), faded = new BasicHitParticles(new THREE.Scene(), textures(), 'gate', BASICHIT_DEPTH_LAYERS);
  assert.deepEqual(plain.layers.map(m => 'depthFadeDistance' in m.material.uniforms), [false, false, false]);
  assert.deepEqual(faded.layers.map(m => 'depthFadeDistance' in m.material.uniforms), [true, false, false]);
  assert.deepEqual(faded.layers.map(m => m.material.defines), BASICHIT_DEPTH_LAYERS.map(d => ({ ...d.layer.defines })));
  assert.ok(faded.layers.every(m => m.material.fragmentShader === SPRITE_FRAGMENT_SHADER));
  assert.deepEqual([faded.layers[0].material.uniforms.depthFadeDistance.value, faded.layers[0].material.uniforms.depthFadeEnabled.value], [1, false]);
  // setDepth feeds only the layers with the fade, and only for an orthographic camera.
  const ortho = new THREE.OrthographicCamera(-4, 4, 4, -4, .01, 100), depthTexture = new THREE.DepthTexture(8, 8);
  faded.setDepth(depthTexture, ortho, 1024, 1024, true);
  const u = faded.layers[0].material.uniforms;
  assert.deepEqual([u.opaqueDepth.value, u.nearFar.value.toArray(), u.depthSize.value.toArray(), u.depthFadeEnabled.value], [depthTexture, [.01, 100], [1024, 1024], true]);
  faded.setDepth(depthTexture, ortho, 1024, 1024, false);
  assert.equal(u.depthFadeEnabled.value, false);
  plain.setDepth(depthTexture, ortho, 1024, 1024, true);
  assert.throws(() => faded.setDepth(depthTexture, new THREE.PerspectiveCamera(), 1024, 1024, true), { message: 'DepthFade needs an orthographic camera' });
  plain.dispose(); faded.dispose(); depthTexture.dispose();
});

test('the plane the lab builds from a depth row: centre, unit normal, 30 m, same offsets as the capture', () => {
  const { cameraTarget, imageSteps } = depthReference.settings, poses = depthReference.surfaces.poses;
  assert.deepEqual([poses.length, poses.filter(x => x.step === 6).length, poses.filter(x => x.step === 12).length], [26, 13, 13]);
  assert.deepEqual(imageSteps, [6, 12]);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  for (const { label, surface } of poses) {
    const plane = planeFromSurface(surface);
    assert.equal(surface.label, label);
    assert.deepEqual([plane.center, plane.size], [toScene(surface.pointCm), 30], label);
    assert.ok(Math.abs(Math.hypot(...plane.normal) - 1) < 1e-12, label);
    // UE (x, y, z) -> scene (y, z, -x), a pure axis permutation of the direction.
    assert.deepEqual(plane.normal.map(Math.abs).sort(), [surface.normal[2], surface.normal[1], surface.normal[0]].map(Math.abs).sort(), label);
    // A wall sits offsetCm behind the target along its normal; the floor is the target's z.
    if (surface.kind === 'wall') assert.ok(Math.abs(dot(surface.pointCm.map((v, i) => v - cameraTarget[i]), surface.normal) + surface.offsetCm) < 1e-9, label);
    else assert.deepEqual([surface.pointCm[2], plane.normal.map(v => v + 0)], [cameraTarget[2], [0, 1, 0]]);
  }
  assert.deepEqual(planeFromSurface({ kind: 'wall', pointCm: [20, 0, -10], normal: [1, 0, 0], sizeCm: 3000 }).normal.map(v => v + 0), [0, 0, -1]);
  for (const bad of [null, { kind: 'ceiling', pointCm: [0, 0, 0], normal: [0, 0, 1], sizeCm: 3000 },
    { kind: 'floor', pointCm: [0, 0, NaN], normal: [0, 0, 1], sizeCm: 3000 }, { kind: 'floor', pointCm: [0, 0, 0], normal: [0, 0, 2], sizeCm: 3000 },
    { kind: 'floor', pointCm: [0, 0, 0], normal: [0, 0, 1], sizeCm: 0 }])
    assert.throws(() => planeFromSurface(bad), /Invalid BasicHit surface/);
  // The stage mesh: +Z of the quad turns to the normal, the quad is 30 m, a control hides it.
  const stage = new BasicHitDepthStage(8);
  assert.equal(stage.surface.visible, false);
  for (const { surface } of poses) {
    stage.configure(surface);
    const plane = planeFromSurface(surface), facing = new THREE.Vector3(0, 0, 1).applyQuaternion(stage.surface.quaternion);
    assert.deepEqual([stage.surface.visible, stage.surface.position.toArray(), stage.surface.scale.toArray(), stage.surface.material.side],
      [true, plane.center, [30, 30, 1], THREE.DoubleSide]);
    assert.ok(facing.distanceTo(new THREE.Vector3(...plane.normal)) < 1e-9);
  }
  stage.configure(null);
  assert.equal(stage.surface.visible, false);
  stage.dispose();
});

test('the depth set reads basichit-reference12 through depth-reference-checkpoint.json, steps 6 and 12', async () => {
  assert.deepEqual([depthReference.referenceRun, depthReference.profile.id, depthReference.settings.linearStep], ['basichit-reference12', 'controlled-sdr/v1', 12]);
  const page = await fs.readFile(new URL('./basichit-lab.js', import.meta.url), 'utf8');
  const compare = await fs.readFile(new URL('./compare-basichit.py', import.meta.url), 'utf8');
  assert.match(page, /depth: \['basichit-reference12', 'depth-reference-checkpoint\.json'\]/);
  assert.match(compare, /'depth': \('basichit-reference12', 'depth-reference-checkpoint\.json'\)/);
  assert.match(page, /DEPTH \? BASICHIT_DEPTH_LAYERS : BASICHIT_LAYERS/);
});

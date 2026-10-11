import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildNavalRig, newNavalState } from '../src/sim/naval/handling.js';
import { currentAt } from '../src/sim/naval/navigation.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { NavalLabEffects } from '../tools/naval-lab/effects.js';
import { NavalLabAudio } from '../tools/naval-lab/audio.js';
import { LAYER } from '../src/render/pipeline.js';

function labState(overrides = {}) {
  return { ...newNavalState(), x: 28, z: 42, vx: 0.4, vz: 2.8, tick: 40, ...overrides };
}

test('naval lab effects stay bounded, respect pause/current controls, and use FX layer', () => {
  const scene = new THREE.Scene();
  const fx = new NavalLabEffects(scene, { mobile: true });
  const rig = buildNavalRig(STARTER_RAFT, []);
  const state = labState();
  assert.equal(fx.pool.cap, 144);
  for (const object of [fx.pool.points, fx.currentBand, fx.chevrons.mesh, ...fx.trails.map((t) => t.mesh)]) {
    assert.equal(object.layers.isEnabled(LAYER.FX), true);
  }

  fx.update(0.05, { state, rig, current: currentAt(state.x, state.z), currents: false, paused: true });
  assert.equal(fx.diagnostics().wakeSamples, 0);
  assert.equal(fx.diagnostics().activeParticles, 0);

  for (let i = 0; i < 80; i++) fx.update(0.05, { state, rig, current: currentAt(state.x, state.z), currents: false });
  const d = fx.diagnostics();
  assert.ok(d.wakeSamples > 0);
  assert.ok(d.activeParticles > 0);
  assert.ok(d.activeParticles <= d.poolCapacity);
  assert.equal(d.currentVisible, false);
  assert.equal(d.currentStrength, 0);
  assert.equal(fx.currentBand.visible, false);
  assert.equal(fx.chevrons.mesh.visible, false);
  fx.dispose();
  assert.equal(scene.children.includes(fx.pool.points), false);
  assert.equal(scene.children.includes(fx.currentBand), false);
  fx.dispose();
});

test('reduced motion keeps separated static current arrows without continuous spray', () => {
  const fx = new NavalLabEffects(new THREE.Scene(), { mobile: true, reducedMotion: true });
  const rig = buildNavalRig(STARTER_RAFT, []);
  const state = labState({ vx: 0, vz: 0 });
  fx.update(0.05, { state, rig, current: currentAt(0, 30), currents: true });
  assert.equal(fx.currentBand.visible, true);
  assert.equal(fx.chevrons.mesh.visible, true);
  const positions = fx.chevrons.geometry.attributes.position.array;
  const distinct = new Set();
  for (let i = 0; i < positions.length; i += 3) distinct.add(`${positions[i].toFixed(2)},${positions[i + 2].toFixed(2)}`);
  assert.ok(distinct.size > 12, 'static arrows remain distributed along both curved lanes');
  assert.equal(fx.diagnostics().activeParticles, 0);
  fx.dispose();
});

test('nearby foam references stay world anchored, freeze on pause, and recycle within a fixed budget', () => {
  const scene = new THREE.Scene();
  const fx = new NavalLabEffects(scene, { mobile: true, reducedMotion: true });
  const rig = buildNavalRig(STARTER_RAFT, []);
  const state = labState({ x: 0, z: 0, vx: 0, vz: 0 });
  fx.update(0.05, { state, rig });
  const mesh = fx.foam.mesh;
  const original = mesh.geometry.attributes.position.array.slice();
  const origin = fx.diagnostics().foamCellOrigin;
  assert.ok(fx.diagnostics().foamFlecks > 120);
  assert.ok(fx.diagnostics().foamFlecks <= fx.diagnostics().foamCapacity);
  assert.equal(mesh.position.length(), 0, 'vertices use absolute world coordinates');
  assert.equal(mesh.layers.isEnabled(LAYER.FX), true);

  state.x = 20;
  fx.update(0.05, { state, rig, paused: true });
  assert.deepEqual(fx.diagnostics().foamCellOrigin, origin);
  assert.deepEqual(mesh.geometry.attributes.position.array, original, 'pause preserves the field');
  state.x = 1;
  fx.update(0.05, { state, rig });
  assert.deepEqual(mesh.geometry.attributes.position.array, original, 'small movement does not drag or rebuild anchors');

  state.x = 5;
  fx.update(0.05, { state, rig });
  const next = mesh.geometry.attributes.position.array;
  assert.deepEqual(fx.diagnostics().foamCellOrigin, [origin[0] + 1, origin[1]]);
  assert.equal(fx.diagnostics().foamRecycles, 1);
  const pointKey = (array, offset) => `${array[offset].toFixed(4)},${array[offset + 2].toFixed(4)}`;
  const oldAnchors = new Set();
  const newAnchors = new Set();
  for (let i = 0; i < original.length; i += 18) oldAnchors.add(pointKey(original, i));
  for (let i = 0; i < next.length; i += 18) newAnchors.add(pointKey(next, i));
  let shared = 0;
  for (const point of oldAnchors) if (newAnchors.has(point)) shared++;
  assert.ok(shared > oldAnchors.size * 0.75, 'overlapping cells retain exactly the same world points');
  assert.ok(oldAnchors.size > newAnchors.size * 0.02, 'the shifted field also drops cells outside its bounded window');
  fx.dispose();
  assert.equal(scene.children.includes(mesh), false);
});

test('capture splash is positioned around the shifted hull centre, including negative blueprint cells', () => {
  const parts = STARTER_RAFT.map(([id, x, z, level, dir]) => [id, x - 6, z - 5, level, dir]);
  const rig = buildNavalRig(parts, []);
  assert.ok(rig.hullCx < 0 && rig.hullCz < 0);
  const fx = new NavalLabEffects(new THREE.Scene());
  const state = labState({ x: 60, z: -12, yaw: 0.73 });
  assert.equal(fx.event('perfect', state, rig), true);

  const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  const expectedX = state.x + c * (rig.hullCx - rig.cx) + s * (rig.hullCz - rig.cz);
  const expectedZ = state.z - s * (rig.hullCx - rig.cx) + c * (rig.hullCz - rig.cz);
  const lateral = -0.36 * rig.beam;
  const expectedParticleX = expectedX + s * rig.length * 0.44 + c * lateral;
  const expectedParticleZ = expectedZ + c * rig.length * 0.44 - s * lateral;
  assert.ok(Math.abs(fx.pool.pos[0] - expectedParticleX) < 1e-5);
  assert.ok(Math.abs(fx.pool.pos[2] - expectedParticleZ) < 1e-5);
  assert.ok(fx.diagnostics().activeParticles > 0);
  assert.ok(fx.diagnostics().activeParticles <= fx.pool.cap);
  fx.dispose();
});

test('impact and destruction splashes stay in the fixed particle pool and expire across display modes', () => {
  const rig = buildNavalRig(STARTER_RAFT, []), state = labState({ vx: 0, vz: 0 });
  for (const options of [
    { mobile: false, reducedMotion: false },
    { mobile: true, reducedMotion: false },
    { mobile: false, reducedMotion: true },
    { mobile: true, reducedMotion: true },
  ]) {
    const fx = new NavalLabEffects(new THREE.Scene(), options), capacity = fx.pool.cap;
    assert.equal(fx.event('impact', state, rig), true);
    assert.equal(fx.event('destroy', state, rig), true);
    const spawned = fx.diagnostics();
    assert.equal(spawned.impactBursts, 2);
    assert.equal(spawned.captureBursts, 0, 'impact diagnostics stay separate from capture');
    assert.ok(spawned.activeParticles > 0);
    assert.equal(spawned.poolCapacity, capacity, 'bursts reuse the fixed-capacity pool');
    assert.ok(spawned.activeParticles <= capacity);

    for (let i = 0; i < 14; i++) fx.update(0.05, { state, rig });
    assert.equal(fx.diagnostics().activeParticles, 0, `${JSON.stringify(options)} particles expire`);
    assert.equal(fx.diagnostics().poolCapacity, capacity);
    fx.dispose();
  }
});

class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}

class FakeNode {
  constructor() { this.gain = new FakeParam(); this.frequency = new FakeParam(); this.Q = new FakeParam(); this.connections = []; this.disconnects = 0; this.stops = 0; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnects++; }
  start() {}
  stop() { this.stops++; }
  setValueAtTime(value) { this.value = value; }
}

function fakeAudioEngine() {
  const nodes = [];
  const node = () => { const value = new FakeNode(); nodes.push(value); return value; };
  const ctx = {
    state: 'running', currentTime: 0,
    resume: async () => {},
    createBiquadFilter: node, createGain: node, createOscillator: node, createBufferSource: node,
  };
  const sfx = node(), ambience = node();
  const engine = { ready: false, ctx, sfx, ambience, vol: { muted: false }, unlock() { this.ready = true; return ctx; },
    noiseSource: node };
  Object.defineProperty(engine, 'now', { get: () => ctx.currentTime });
  return { engine, nodes, ctx };
}

test('naval lab audio is gesture-gated, limits overlaps, and disposes its graph', async () => {
  const { engine, nodes, ctx } = fakeAudioEngine();
  const sound = new NavalLabAudio({ mobile: true, engine });
  assert.equal(sound.event('window'), false);
  assert.equal(sound.diagnostics().ambienceSources, 0);
  assert.equal(await sound.unlock(), true);
  assert.equal(sound.diagnostics().ambienceSources, 1);
  for (const type of ['approach', 'window', 'capture']) {
    assert.equal(sound.event(type), true);
    ctx.currentTime += 0.2;
  }
  assert.equal(sound.event('perfect'), false);
  assert.equal(sound.diagnostics().activeOneShots, 3);
  assert.equal(sound.diagnostics().maxOneShots, 3);
  sound.dispose();
  assert.ok(nodes.some((n) => n.stops > 0));
  assert.ok(nodes.slice(2).every((n) => n.disconnects > 0));
  assert.equal(sound.diagnostics().activeOneShots, 0);
});

test('naval lab audio mute and pause gate the loop bus and reject one-shots', async () => {
  const { engine } = fakeAudioEngine();
  const sound = new NavalLabAudio({ engine });
  await sound.unlock();
  const state = labState(), rig = buildNavalRig(STARTER_RAFT, []);
  sound.setEnabled(false);
  assert.equal(sound.graph.eventBus.gain.value, 0);
  assert.equal(sound.event('capture'), false);
  sound.setEnabled(true);
  sound.update({ state, rig, paused: true });
  assert.equal(sound.graph.eventBus.gain.value, 0);
  assert.equal(sound.event('perfect'), false);
  sound.update({ state, rig, paused: false });
  assert.equal(sound.graph.eventBus.gain.value, 1);
  assert.equal(sound.event('miss'), true);
  sound.dispose();
});

test('impact and destruction audio require gesture and respect pause, mute, and overlap limits', async () => {
  const { engine, ctx } = fakeAudioEngine();
  const sound = new NavalLabAudio({ mobile: true, engine });
  assert.equal(sound.event('impact'), false, 'no one-shot before the user gesture');
  assert.equal(sound.event('destroy'), false, 'destruction is gated by the same gesture');
  assert.equal(sound.diagnostics().played.impact, 0);

  await sound.unlock();
  const state = labState(), rig = buildNavalRig(STARTER_RAFT, []);
  sound.update({ state, rig, paused: true });
  assert.equal(sound.event('impact'), false, 'pause rejects impact');
  sound.update({ state, rig, paused: false });
  engine.vol.muted = true;
  assert.equal(sound.event('destroy'), false, 'mute rejects destruction');
  engine.vol.muted = false;

  assert.equal(sound.event('impact'), true);
  ctx.currentTime += 0.15;
  assert.equal(sound.event('destroy'), true, 'destroy maps to the impact sound');
  ctx.currentTime += 0.15;
  assert.equal(sound.event('impact'), true);
  ctx.currentTime += 0.15;
  assert.equal(sound.event('destroy'), false, 'the three-one-shot overlap limit applies to impacts');
  assert.equal(sound.diagnostics().played.impact, 3);
  assert.equal(sound.diagnostics().activeOneShots, 3);
  sound.dispose();
});

test('naval lab audio tracks speed and turn load, then releases every one-shot node on completion', async () => {
  const { engine } = fakeAudioEngine();
  const sound = new NavalLabAudio({ engine });
  const rig = buildNavalRig(STARTER_RAFT, []);
  await sound.unlock();

  sound.update({ state: labState({ vx: 0.5, vz: 0, omega: 0 }), rig });
  const slowWind = sound.graph.windFilter.frequency.value;
  const slowWater = sound.graph.waterFilter.frequency.value;
  sound.update({ state: labState({ vx: 8, vz: 0, omega: 0 }), rig });
  assert.ok(sound.graph.windFilter.frequency.value > slowWind);
  assert.ok(sound.graph.waterFilter.frequency.value > slowWater);

  sound.update({ state: labState({ vx: 0, vz: 0, omega: 1.3 }), rig });
  assert.equal(sound.graph.turnGain.gain.value, 0, 'turning at rest has no hull strain');
  sound.update({ state: labState({ vx: 4.5, vz: 0, omega: 0 }), rig });
  assert.equal(sound.graph.turnGain.gain.value, 0, 'straight sailing has no hull strain');
  sound.update({ state: labState({ vx: 4.5, vz: 0, omega: 1.3 }), rig });
  assert.ok(sound.graph.turnGain.gain.value > 0, 'moving through a hard turn adds hull strain');

  assert.equal(sound.event('capture'), true);
  const event = [...sound.active][0];
  const [oscillator, oscillatorGain, noise, filter, noiseGain] = event.nodes;
  oscillator.onended();
  assert.equal(sound.diagnostics().activeOneShots, 1);
  noise.onended();
  assert.equal(sound.diagnostics().activeOneShots, 0);
  assert.equal(event.done, true);
  assert.ok([oscillator, oscillatorGain, noise, filter, noiseGain].every((node) => node.disconnects > 0));
  sound.dispose();
});

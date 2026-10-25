// Native Niagara effects in the game world (worldFx.js): the endless flame simulation and the bindings -> instances bookkeeping.
// Node only: worldFx.js loads its three-side runtime on demand, and these tests inject a fake one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeSimulation } from '../src/render/vfx/niagara/native-simulation.js';
import { NIAGARA_NATIVE, nativeEndStep } from '../src/editor/niagaraNative.js';
import { defaultPresentationBinding, emptyPresentationBindings } from '../src/data/presentationBindings.js';
import { NativeWorldFx, MAX_BURSTS, MAX_STEPS, PREWARM_STEPS, WORLD_BASE, fixedSteps, linearTint, loopSeed, mergeFrames, ringOffsets }
  from '../src/render/vfx/niagara/worldFx.js';

const FLAME = 'niagara-985a431dc6c0d1ca', HIT = 'niagara-97a82bae61b29237';
const read = (url) => JSON.parse(readFileSync(new URL(`..${url}`, import.meta.url)));
const pilot = read(NIAGARA_NATIVE[FLAME].files.simulation.url);

test('endless mode runs past the 8-second sequence with bounded live particles; the default mode is unchanged', () => {
  const plain = new NativeSimulation(pilot), endless = new NativeSimulation(pilot, {}, { endless: true });
  assert.deepEqual(endless.seek(480), plain.seek(480)); // same births through the private sequence
  assert.throws(() => plain.advance(), /Private sequence ends at 8 seconds/);
  let flameMax = 0, smokeMax = 0;
  for (let step = 481; step <= 3600; step++) {
    endless.advance();
    flameMax = Math.max(flameMax, endless.live[0].length); smokeMax = Math.max(smokeMax, endless.live[1].length);
  }
  assert.equal(endless.step, 3600);
  assert.ok(endless.live[0].length > 0 && endless.live[1].length > 0, 'still emitting after a minute');
  assert.ok(flameMax <= 4 && smokeMax <= 22, `bounded by lifetimes: ${flameMax} ${smokeMax}`);
  assert.equal(new NativeSimulation(pilot, {}, { endless: 'yes' }).endless, false);
});

test('pure helpers: seeds, ring, fixed steps, tint, merge', () => {
  assert.equal(loopSeed(6371, 3), 6374); assert.equal(loopSeed(65533, 1), 0); assert.ok(loopSeed(65533, 24) <= 65533);
  assert.deepEqual(ringOffsets(1, 0.18), [[0, 0]]);
  const ring = ringOffsets(5, 0.18);
  assert.equal(ring.length, 5); assert.deepEqual(ring[0], [0, 0]);
  for (const [x, z] of ring.slice(1)) assert.ok(Math.abs(Math.hypot(x, z) - 0.18) < 1e-9);
  assert.deepEqual(fixedSteps(0, 1 / 60, 60).steps, 1);
  const slow = fixedSteps(0, 1, 60); // a 1 s hitch: 4 steps, the rest dropped
  assert.equal(slow.steps, MAX_STEPS); assert.ok(slow.acc >= 0 && slow.acc < 1);
  assert.equal(fixedSteps(0.5, 1 / 120, 60).steps, 1); assert.equal(fixedSteps(0, -1, 60).steps, 0);
  assert.deepEqual(linearTint('#ffffff'), [1, 1, 1]); assert.ok(Math.abs(linearTint('#808080')[0] - 0.2158605) < 1e-6);
  const frame = n => ({ schema: 's', systemAge: 0, emitters: [{ name: 'a', particles: Array(n).fill({}) }] });
  const merged = mergeFrames([frame(300), frame(300), frame(100)]);
  assert.deepEqual(merged.ranges, [[[0, 300]], null, [[300, 100]]]); assert.equal(merged.dropped, 1);
  assert.equal(merged.frame.emitters[0].particles.length, 400);
  assert.deepEqual(Object.keys(WORLD_BASE), ['flame-single-v1', 'basichit-v1']);
});

// A fake three-side runtime: counts what is alive so leaks show.
function fakeRuntime({ fail = null } = {}) {
  const live = { owned: 0, sets: 0, loads: 0 };
  const runtime = {
    live,
    async loadNativeAssets(effect, { alive }) {
      live.loads++;
      if (fail === effect.id) throw new Error('Native file hash mismatch: test');
      await null;
      if (!alive()) return null;
      live.owned += 2;
      const owned = [0, 1].map(() => ({ dispose() { live.owned--; } }));
      return { source: read(effect.files.simulation.url), textures: [{ image: { width: 1, height: 1 } }, { image: { width: 1, height: 1 } }], owned, mobile: false };
    },
    createNativeParticles(effect) {
      live.sets++;
      const layers = Array.from({ length: effect.recipe === 'basichit-v1' ? 3 : 2 }, () => ({ visible: false, layers: { set() {} },
        geometry: { instanceCount: 0, attributes: { particlePosition: { array: new Float32Array(512 * 3) },
          particleSize: { array: new Float32Array(512 * 2) }, particleColor: { array: new Float32Array(512 * 4) } } } }));
      return { layers, setDepth() {}, dispose() { live.sets--; },
        update(frame) {
          frame.emitters.forEach((e, index) => {
            const a = layers[index].geometry.attributes;
            e.particles.forEach((p, i) => { a.particlePosition.array.set([p.position[1] / 100, p.position[2] / 100, -p.position[0] / 100], i * 3);
              a.particleSize.array.set([p.size[0] / 100, p.size[1] / 100], i * 2); a.particleColor.array.set(p.color, i * 4); });
            layers[index].geometry.instanceCount = e.particles.length;
          });
        } };
    },
  };
  return runtime;
}
const doc = (bindings) => ({ ...emptyPresentationBindings(), bindings });
const bind = (slot, effect, parameters = {}) => { const b = defaultPresentationBinding(slot, effect); Object.assign(b.parameters, parameters); return b; };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const anchors = [{ x: 0, y: 1, z: 0, kind: 'campfire' }, { x: 10, y: 2, z: 0, kind: 'brazier' }, { x: 200, y: 0, z: 0, kind: 'campfire' }];
const camera = { isPerspectiveCamera: true };

test('bindings -> loop instances: near anchors only, count per anchor, live rebind and unbind without leaks', async () => {
  const runtime = fakeRuntime(), fx = new NativeWorldFx({}, { runtime: async () => runtime, coarse: false });
  fx.setAnchors(anchors);
  fx.setBindings(null); fx.update(1 / 60, { x: 0, z: 0 }, camera);
  assert.equal(fx.metrics.instances, 0); assert.equal(fx.loopReady('campfire'), false);
  fx.setBindings(doc({ campfire: bind('campfire', FLAME, { count: 3 }), brazier: bind('brazier', FLAME) }));
  assert.equal(fx.loopReady('campfire'), false, 'still loading: procedural look');
  await settle();
  assert.equal(runtime.live.loads, 1, 'one shared load per effect'); assert.equal(runtime.live.sets, 1);
  assert.ok(fx.loopReady('campfire') && fx.loopReady('brazier')); assert.equal(fx.loopReady('meleeHit'), false);
  fx.update(1 / 60, { x: 0, z: 0 }, camera);
  assert.equal(fx.metrics.loops, 4, 'three flames at the campfire, one at the brazier; the far campfire stays procedural-free and empty');
  const [first] = fx.loops.get(0);
  assert.equal(first.sim.step, PREWARM_STEPS + 1); assert.equal(first.sim.options.seed, 6371);
  assert.equal(fx.loops.get(1)[0].sim.options.seed, loopSeed(6371, 5));
  assert.equal(fx.metrics.drawCalls, 2, 'one mesh set for every flame instance');
  assert.ok(fx.metrics.particles > 0);
  fx.update(1 / 60, { x: 65, z: 0 }, camera); // between 60 and 70 m: kept
  assert.equal(fx.loops.has(0), true);
  fx.update(1 / 60, { x: 75, z: 0 }, camera);
  assert.equal(fx.loops.has(0), false, 'despawned past 70 m');
  fx.update(1 / 60, { x: 0, z: 0 }, camera);
  fx.setBindings(doc({ campfire: bind('campfire', FLAME, { count: 5, seed: 9 }), brazier: bind('brazier', FLAME) }));
  assert.equal(fx.loops.has(0), false); assert.equal(fx.loops.has(1), true, 'an unchanged slot keeps its instances');
  fx.update(1 / 60, { x: 0, z: 0 }, camera);
  assert.equal(fx.loops.get(0).length, 5); assert.equal(fx.loops.get(0)[2].sim.options.seed, 11);
  fx.setBindings(doc({ brazier: bind('brazier', FLAME) }));
  assert.equal(fx.loopReady('campfire'), false, 'unbound: procedural look on the next frame');
  fx.setBindings(emptyPresentationBindings());
  fx.update(1 / 60, { x: 0, z: 0 }, camera);
  assert.deepEqual([fx.metrics.instances, fx.metrics.resources, runtime.live.owned, runtime.live.sets], [0, 0, 0, 0]);
});

test('bursts: start only when bound and ready, at most 8, end at nativeEndStep and free their slot', async () => {
  const runtime = fakeRuntime(), fx = new NativeWorldFx({}, { runtime: async () => runtime, coarse: false });
  assert.equal(fx.burst('meleeHit', 0, 1, 0), false);
  fx.setBindings(doc({ meleeHit: bind('meleeHit', HIT), damageHit: bind('damageHit', HIT, { speed: 2 }) }));
  assert.equal(fx.burst('meleeHit', 0, 1, 0), false, 'loading');
  await settle();
  assert.equal(fx.burst('campfire', 0, 0, 0), false); assert.equal(fx.burst('meleeHit', NaN, 0, 0), false);
  for (let i = 0; i < 10; i++) assert.equal(fx.burst(i % 2 ? 'damageHit' : 'meleeHit', i, 1, 0), true);
  assert.equal(fx.metrics.bursts, MAX_BURSTS);
  fx.update(1 / 60, { x: 0, z: 0 }, camera);
  assert.ok(fx.metrics.particles > 0); assert.ok(fx.metrics.drawCalls <= 3);
  const end = nativeEndStep(read(NIAGARA_NATIVE[HIT].files.simulation.url), 6371, 'basichit-v1');
  for (let frame = 0; frame < end + 2; frame++) fx.update(1 / 60, { x: 0, z: 0 }, camera);
  assert.equal(fx.metrics.bursts, 0); assert.equal(fx.metrics.drawCalls, 0);
  fx.burst('meleeHit', 0, 1, 0); fx.setBindings(null);
  assert.deepEqual([fx.metrics.bursts, fx.metrics.resources, runtime.live.owned, runtime.live.sets], [0, 0, 0, 0]);
});

test('failures fall back to the procedural look and warn once; invalid documents count as no bindings', async () => {
  const warnings = [], warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const runtime = fakeRuntime({ fail: FLAME }), fx = new NativeWorldFx({}, { runtime: async () => runtime, coarse: false });
    fx.setAnchors(anchors);
    fx.setBindings(doc({ campfire: bind('campfire', FLAME), brazier: bind('brazier', FLAME), meleeHit: bind('meleeHit', HIT) }));
    await settle();
    fx.update(1 / 60, { x: 0, z: 0 }, camera);
    assert.equal(fx.loopReady('campfire'), false); assert.equal(fx.metrics.loops, 0);
    assert.equal(fx.burst('meleeHit', 0, 1, 0), true, 'the other effect still plays');
    assert.equal(warnings.length, 1); assert.match(warnings[0], /procedural look: Native file hash mismatch/);
    fx.setBindings({ schema: 'nope' });
    assert.equal(fx.burst('meleeHit', 0, 1, 0), false); assert.equal(fx.metrics.resources, 0);
    fx.setBindings({ schema: 'nope' });
    assert.equal(warnings.length, 2);
    fx.dispose(); fx.update(1 / 60, { x: 0, z: 0 }, camera);
    assert.equal(runtime.live.owned + runtime.live.sets, 0);
  } finally { console.warn = warn; }
});

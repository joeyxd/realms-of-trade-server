import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalLabAudio } from '../src/audio/naval.js';
import { WW_ANGLE, WW_SPEED } from '../src/data/navalHandling.js';

class FakeParam {
  constructor() { this.value = 0; this.max = 0; }
  set(value) { this.value = value; this.max = Math.max(this.max, value); }
  setValueAtTime(value) { this.set(value); }
  exponentialRampToValueAtTime(value) { this.set(value); }
  setTargetAtTime(value) { this.set(value); }
}

class FakeNode {
  constructor() { this.gain = new FakeParam(); this.frequency = new FakeParam(); this.Q = new FakeParam(); this.started = []; }
  connect(node) { return node; }
  disconnect() {}
  start(at) { this.started.push(at); }
  stop() {}
}

function fakeAudioEngine() {
  const nodes = [];
  const node = () => { const value = new FakeNode(); nodes.push(value); return value; };
  const ctx = { state: 'running', currentTime: 0, resume: async () => {}, createBiquadFilter: node, createGain: node, createOscillator: node };
  const engine = { ready: false, ctx, sfx: node(), ambience: node(), vol: { muted: false }, unlock() { this.ready = true; return ctx; }, noiseSource: node };
  Object.defineProperty(engine, 'now', { get: () => ctx.currentTime });
  return { engine, nodes, ctx };
}

async function setup() {
  const { engine, nodes, ctx } = fakeAudioEngine();
  const sound = new NavalLabAudio({ engine });
  await sound.unlock();
  let tick = 0;
  // One render frame: advance the clock past the one-shot spacing, end every one-shot, feed one body state.
  const frame = (fields = {}, ticks = 1) => {
    ctx.currentTime += 0.4; tick += ticks;
    for (const n of nodes) n.onended?.();
    sound.update({ state: { tick, x: 0, z: 0, yaw: 0.5, vx: 0, vz: 0, omega: 0, helm: 0, ...fields }, rig: {} });
  };
  return { sound, frame, nodes, played: () => sound.diagnostics().played };
}

test('the mast rising plays SAIL_OUT once and dropping to 0 plays SAIL_IN', async () => {
  const { frame, played } = await setup();
  frame({ mast: 0 });
  frame({ mast: 1.5 }); frame({ mast: 3 }); frame({ mast: 30 });
  assert.equal(played().sailout, 1);
  frame({ mast: 0 });
  assert.equal(played().sailin, 1);
  assert.equal(played().sailout, 1);
});

test('the boom changing side plays SAIL_MOVE late, only with the sail ON, with WW hysteresis', async () => {
  const { frame, played, nodes } = await setup();
  frame({ mast: 30, yaw: 0.5 }); // wind at yaw 0: the boom on one side
  frame({ mast: 30, yaw: 0.05 }); // inside the 0x800 hysteresis: no change
  assert.equal(played().boom, 0);
  const before = nodes.length;
  frame({ mast: 30, yaw: -0.5 });
  assert.equal(played().boom, 1);
  assert.ok(nodes.slice(before).some((n) => n.started.some((at) => at > 0.4 * 3 + 0.25)), 'starts about 0.3 s later');
  frame({ mast: 3, yaw: 0.5 }); // sail not ON yet
  assert.equal(played().boom, 1);
});

test('the tiller creaks over 420 s16 a WW frame on one side and 525 when it reverses', async () => {
  const { frame, played } = await setup();
  const perFrame = (s16) => s16 * WW_ANGLE / 2; // one tick is half a WW frame
  frame({ helm: 0 });
  frame({ helm: perFrame(400) });
  assert.equal(played().rudder, 0);
  frame({ helm: perFrame(400) + perFrame(430) });
  assert.equal(played().rudder, 1);
  frame({ helm: perFrame(400) + perFrame(430) }, 0); // the same tick drawn again never creaks
  frame({ helm: -perFrame(10) }); // reverses by 840 in one tick
  assert.equal(played().rudder, 2);
  frame({ helm: -perFrame(10) + perFrame(510) }); // reverses by 510: under 525
  assert.equal(played().rudder, 2);
});

test('landing plays JUMP_ALIGHT louder for a harder fall', async () => {
  const soft = await setup(), hard = await setup();
  for (const [s, vy] of [[soft, -16 * WW_SPEED], [hard, -45 * WW_SPEED]]) {
    s.frame({ fly: 1, vy: 10 }); s.frame({ fly: 1, vy });
    s.before = s.nodes.length;
    s.frame({ fly: 0, vy: -15 * WW_SPEED });
    assert.equal(s.played().alight, 1);
  }
  const peak = (s) => Math.max(...s.nodes.slice(s.before).map((n) => n.gain.max));
  assert.ok(peak(hard) > peak(soft) * 2, `${peak(hard)} vs ${peak(soft)}`);
});

test('the lab body without WW fields plays no sail, boom or landing cue', async () => {
  const { frame, played } = await setup();
  for (const yaw of [0.5, -0.5, 0.5]) frame({ yaw });
  const p = played();
  assert.equal(p.sailout + p.sailin + p.boom + p.alight + p.rudder, 0);
});

test('the cruise loop scales by WW top speed, not the old 11 u/s', async () => {
  const { sound, frame } = await setup();
  frame({ vx: 11 }); const at11 = sound.diagnostics().mix.water;
  frame({ vx: 55 * WW_SPEED }); const atTop = sound.diagnostics().mix.water;
  assert.ok(atTop > at11 * 1.3, `${atTop} vs ${at11}`);
});

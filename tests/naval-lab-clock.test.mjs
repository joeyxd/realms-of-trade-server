import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalLabClock } from '../tools/naval-lab/clock.js';
import { buildNavalRig, newNavalState, stepNaval } from '../src/sim/naval/handling.js';
import { labFixture, LAB_WINDS } from '../tools/naval-lab/fixtures.js';

test('30, 60 and 120 FPS execute the same control stream and identical fixed simulation', () => {
  const f = labFixture('rim'), rig = buildNavalRig(f.parts, f.cargo);
  const run = (fps) => {
    const clock = new NavalLabClock(); let state = newNavalState();
    for (let n = 0; n < fps * 12; n++) clock.advance(1 / fps, () => {
      state = stepNaval(state, { throttle: state.tick < 480 ? 1 : 0, steer: state.tick < 240 ? 0 : 1 }, rig, LAB_WINDS[1]);
    });
    assert.equal(state.tick, 720); return state;
  };
  assert.deepEqual(run(30), run(60)); assert.deepEqual(run(60), run(120));
});

test('a stalled tab is bounded and clearing does not execute pending controls', () => {
  const clock = new NavalLabClock(); let ticks = 0;
  clock.advance(10, () => ticks++);
  assert.equal(ticks, 15); assert.equal(clock.dropped, 9.75);
  clock.advance(1 / 120, () => ticks++); clock.clear();
  assert.equal(clock.alpha, 0); assert.equal(ticks, 15);
  assert.equal(clock.advance(Number.NaN, () => ticks++), 0);
});

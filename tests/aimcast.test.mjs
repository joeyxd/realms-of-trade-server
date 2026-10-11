// M4.7 P4: the aim controller turns Q / E / R key edges into presses, held bits and an area / charge preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AimCast, SLOT_BIT } from '../src/client/aimcast.js';
import { BTN } from '../src/sim/systems/movement.js';

const none = { q: false, e: false, r: false };
const keys = (o = {}) => ({ ...none, ...o });
// One tick of the controller: down / up / held as lists of slots.
const tick = (ac, { down = [], up = [], held = [], cancel = false, kinds = { q: 'dir', e: 'dir', r: 'self' }, mode = 'indicator' } = {}) => ac.step({
  down: keys(Object.fromEntries(down.map((s) => [s, true]))), up: keys(Object.fromEntries(up.map((s) => [s, true]))),
  held: keys(Object.fromEntries(held.map((s) => [s, true]))), cancel, kinds, mode,
});

test('dir and self skills press on key down, exactly as before', () => {
  const ac = new AimCast();
  let o = tick(ac, { down: ['q'], held: ['q'] });
  assert.equal(o.prs, BTN.Q);
  assert.equal(o.preview, null);
  o = tick(ac, { held: ['q'] });
  assert.equal(o.prs, 0, 'once');
  o = tick(ac, { up: ['q'] });
  assert.equal(o.prs, 0, 'nothing on key up');
  assert.equal(tick(ac, { down: ['r'], held: ['r'] }).prs, BTN.R);
});

test('ground (indicator): key down shows the marker, key up sends the press and fires at the preview point', () => {
  const ac = new AimCast(), kinds = { q: 'ground', e: 'dir', r: 'ground' };
  let o = tick(ac, { down: ['q'], held: ['q'], kinds });
  assert.equal(o.prs, 0, 'nothing yet');
  assert.deepEqual(o.preview, { slot: 'q', kind: 'ground' });
  for (let i = 0; i < 5; i++) assert.equal(tick(ac, { held: ['q'], kinds }).prs, 0);
  o = tick(ac, { up: ['q'], kinds });
  assert.equal(o.prs, BTN.Q);
  assert.equal(o.fire, 'q');
  assert.equal(o.preview, null);
  // A tap (down and up in the same tick) still goes out.
  o = tick(ac, { down: ['r'], up: ['r'], kinds });
  assert.equal(o.prs, BTN.R);
  assert.equal(o.fire, 'r');
});

test('ground: a cancel (RMB / ESC / pad B) while aiming drops it and nothing is sent; a lost key drops it too', () => {
  const ac = new AimCast(), kinds = { q: 'ground', e: 'ground', r: 'self' };
  tick(ac, { down: ['q'], held: ['q'], kinds });
  let o = tick(ac, { held: ['q'], cancel: true, kinds });
  assert.equal(o.preview, null);
  assert.equal(o.prs, 0);
  o = tick(ac, { up: ['q'], kinds });
  assert.equal(o.prs, 0, 'the release after a cancel sends nothing');
  tick(ac, { down: ['e'], held: ['e'], kinds });
  o = tick(ac, { kinds }); // blur: not held, no up edge
  assert.equal(o.preview, null);
  assert.equal(o.prs, 0);
});

test('ground (quick): the press goes out on key down, aimed at the cursor', () => {
  const ac = new AimCast();
  const o = tick(ac, { down: ['e'], held: ['e'], kinds: { q: 'dir', e: 'ground', r: 'self' }, mode: 'quick' });
  assert.equal(o.prs, BTN.E);
  assert.equal(o.fire, 'e');
  assert.equal(o.preview, null);
});

test('charge: key down presses and holds the slot bit while the key stays down; key up lets it go', () => {
  const ac = new AimCast(), kinds = { q: 'dir', e: 'charge', r: 'self' };
  let o = tick(ac, { down: ['e'], held: ['e'], kinds });
  assert.equal(o.prs, BTN.E);
  assert.equal(o.held, BTN.E);
  assert.deepEqual(o.preview, { slot: 'e', kind: 'charge' });
  o = tick(ac, { held: ['e'], kinds });
  assert.equal(o.prs, 0);
  assert.equal(o.held, BTN.E, 'still held');
  o = tick(ac, { up: ['e'], kinds });
  assert.equal(o.held, 0, 'let go: the sim throws');
  assert.equal(o.preview, null);
  // Quick mode changes nothing for a charge.
  o = tick(ac, { down: ['e'], held: ['e'], kinds, mode: 'quick' });
  assert.equal(o.held, BTN.E);
});

test('one preview at a time: another slot going down replaces it and the first sends nothing', () => {
  const ac = new AimCast(), kinds = { q: 'ground', e: 'ground', r: 'self' };
  tick(ac, { down: ['q'], held: ['q'], kinds });
  let o = tick(ac, { down: ['e'], held: ['q', 'e'], kinds });
  assert.deepEqual(o.preview, { slot: 'e', kind: 'ground' });
  o = tick(ac, { up: ['q'], held: ['e'], kinds });
  assert.equal(o.prs, 0, 'Q released after being replaced: nothing');
  o = tick(ac, { up: ['e'], kinds });
  assert.equal(o.prs, BTN.E);
  // A dir press while aiming an area goes out and drops the area.
  tick(ac, { down: ['q'], held: ['q'], kinds: { q: 'ground', e: 'dir', r: 'self' } });
  o = tick(ac, { down: ['e'], held: ['q', 'e'], kinds: { q: 'ground', e: 'dir', r: 'self' } });
  assert.equal(o.prs, BTN.E);
  assert.equal(o.preview, null);
  assert.equal(SLOT_BIT.q, BTN.Q);
});

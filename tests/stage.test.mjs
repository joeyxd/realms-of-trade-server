// The rotated stage (M4.6): the pure pointer mapping in src/ui/stage.js. The stage is drawn with
// translateX(W) rotate(90deg), so a stage point (lx, ly) lands on screen at (W − ly, lx); rotPoint is its inverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rotPoint, rotDelta, stage } from '../src/ui/stage.js';

const W = 390, H = 844; // an upright phone: the stage is H wide and W tall
const forward = (lx, ly) => ({ x: W - ly, y: lx }); // what the CSS transform does
const z = (o) => ({ x: o.x + 0, y: o.y + 0 }); // −0 → 0 (deepStrictEqual tells them apart)

test('importing the stage touches no DOM and starts unrotated', () => {
  assert.equal(stage.rotated, false);
  assert.deepEqual(stage.toLocal(12, 34), { x: 12, y: 34 });
  assert.deepEqual(stage.vec(5, -6), { x: 5, y: -6 });
});

test('rotPoint inverts the stage transform at the corners and at a few points', () => {
  const pts = [[0, 0], [H, 0], [0, W], [H, W], [H / 2, W / 2], [100, 17], [731.5, 302.25], [1, W - 1]];
  for (const [lx, ly] of pts) {
    const s = forward(lx, ly);
    const back = rotPoint(s.x, s.y, W);
    assert.deepEqual(back, { x: lx, y: ly }, `round trip (${lx}, ${ly})`);
  }
  // And the other way round: every screen point survives screen → stage → screen.
  for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H], [123, 456]]) {
    const l = rotPoint(cx, cy, W);
    assert.deepEqual(forward(l.x, l.y), { x: cx, y: cy });
  }
});

test('the corners of the screen are the corners of the stage (top = physical right edge)', () => {
  // Physical top-left → stage bottom-left (the stage's left edge is the physical top).
  assert.deepEqual(rotPoint(0, 0, W), { x: 0, y: W });
  // Physical top-right → stage top-left: the stage's top edge is the physical right edge.
  assert.deepEqual(rotPoint(W, 0, W), { x: 0, y: 0 });
  // Physical bottom-right → stage top-right.
  assert.deepEqual(rotPoint(W, H, W), { x: H, y: 0 });
  // Physical bottom-left → stage bottom-right: the stage's bottom edge is the physical left edge.
  assert.deepEqual(rotPoint(0, H, W), { x: H, y: W });
});

test('rotDelta: a swipe physically up is a swipe to the left of the stage', () => {
  // Screen (0, -1) is "up" on the portrait screen. From the mapping, up (decreasing clientY) = decreasing local x.
  assert.deepEqual(z(rotDelta(0, -10)), { x: -10, y: 0 });
  // Physically down → stage right.
  assert.deepEqual(z(rotDelta(0, 10)), { x: 10, y: 0 });
  // Physically right (+clientX) → stage up (smaller local y): the stage's top is the physical right edge.
  assert.deepEqual(z(rotDelta(10, 0)), { x: 0, y: -10 });
  // Physically left → stage down.
  assert.deepEqual(z(rotDelta(-10, 0)), { x: 0, y: 10 });
});

test('rotDelta is the difference of two rotPoints', () => {
  const pairs = [[[10, 20], [55, 5]], [[0, 0], [W, H]], [[200, 300], [190, 310]], [[W, 0], [0, H]]];
  for (const [[ax, ay], [bx, by]] of pairs) {
    const a = rotPoint(ax, ay, W), b = rotPoint(bx, by, W);
    const d = rotDelta(bx - ax, by - ay);
    assert.equal(d.x, b.x - a.x);
    assert.equal(d.y, b.y - a.y);
  }
  // Same for another physical width: the delta does not depend on W.
  const a = rotPoint(30, 40, 412), b = rotPoint(80, 10, 412);
  assert.deepEqual(z(rotDelta(50, -30)), { x: b.x - a.x, y: b.y - a.y });
});

test('rotDelta keeps lengths and turns the vector a quarter turn', () => {
  for (const [dx, dy] of [[3, 4], [-7, 2], [0, 0], [12.5, -0.5]]) {
    const d = rotDelta(dx, dy);
    assert.equal(Math.hypot(d.x, d.y), Math.hypot(dx, dy));
    // A quarter turn: the 2D cross product with the original is −|v|².
    assert.equal(dx * d.y - dy * d.x, -(dx * dx + dy * dy));
    assert.equal(dx * d.x + dy * d.y, 0); // perpendicular
  }
});

// PT03 touch HUD layout: the pure layout (ui/touchLayout.js) over a grid of stages x size settings x safe-area insets,
// and its wiring in ui/touch.js (fake DOM, as in aim-touch.test.mjs). The geometry helpers here are written out again
// on purpose: they do not reuse the module's own checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { touchLayout, touchScale, centralZone, joyZone, keepOuts, SLOT_D, SLOTS } from '../src/ui/touchLayout.js';
import { TouchControls } from '../src/ui/touch.js';
import { stage } from '../src/ui/stage.js';

const S = [[844, 390], [915, 412], [932, 430], [1024, 768]];
const DEGRADED = [[667, 375], [740, 360]];
const U = [0.85, 1, 1.18];
const I = [{ l: 0, r: 0, t: 0, b: 0 }, { l: 47, r: 47, t: 0, b: 21 }];
const TEN = ['atk', 'dash', 'parry', 'q', 'e', 'r', 'g', 'potion', 'act', 'jump'];
const EPS = 1e-6;

const label = (w, h, u, i) => `${w}x${h} user ${u} ${i.l ? 'notch' : 'flat'}`;
function sweep(stages, fn) {
  for (const [w, h] of stages) for (const u of U) for (const i of I) fn(touchLayout({ w, h, safe: i, user: u }), { w, h, u, i, name: label(w, h, u, i) });
}
const circles = (L) => TEN.map((k) => ({ k, ...L.buttons[k] }));
const allCircles = (L) => SLOTS.map((k) => ({ k, ...L.buttons[k] }));
const hits = (c, z) => {
  const nx = Math.min(Math.max(c.x, z.x0), z.x1), ny = Math.min(Math.max(c.y, z.y0), z.y1);
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < (c.d / 2) ** 2 - EPS;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('the slots: the ten of the contract plus the freshwater button, with today\'s diameters', () => {
  for (const k of TEN) assert.ok(SLOTS.includes(k), k);
  assert.ok(SLOTS.includes('water'));
  assert.deepEqual(
    { atk: 92, dash: 70, parry: 62, q: 58, e: 58, r: 54, g: 54, potion: 48, act: 64, jump: 62, water: 54 },
    SLOT_D,
  );
  const L = touchLayout({ w: 932, h: 430, safe: I[0], user: 1 });
  for (const k of SLOTS) assert.ok(Math.abs(L.buttons[k].d - SLOT_D[k] * L.tb) < EPS, `${k} d = d x tb`);
  assert.ok(Math.abs(L.joy.d - 104 * L.tb) < EPS);
  assert.deepEqual(centralZone(1000, 500), { x0: 350, y0: 100, x1: 650, y1: 400 });
  assert.deepEqual(joyZone(1000, 500), { x0: 0, y0: 150, x1: 500, y1: 500 });
});

test('rule 1: every button, the jump slot and the resting joystick sit inside the safe box with 8 px to spare', () => {
  sweep(S.concat(DEGRADED), (L, { w, h, i, name }) => {
    for (const c of allCircles(L).concat([{ k: 'joy', ...L.joy }])) {
      const r = c.d / 2;
      assert.ok(c.x - r >= i.l + 8 - EPS, `${name}: ${c.k} left ${c.x - r}`);
      assert.ok(c.x + r <= w - i.r - 8 + EPS, `${name}: ${c.k} right ${c.x + r}`);
      assert.ok(c.y - r >= i.t + 8 - EPS, `${name}: ${c.k} top ${c.y - r}`);
      assert.ok(c.y + r <= h - i.b - 8 + EPS, `${name}: ${c.k} bottom ${c.y + r}`);
    }
  });
});

test('rule 2: no two slots overlap (centre distance >= r1 + r2 + 4 tb), on every stage including the small phones', () => {
  sweep(S.concat(DEGRADED), (L, { name }) => {
    const cs = allCircles(L);
    for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
      const need = cs[a].d / 2 + cs[b].d / 2 + 4 * L.tb;
      assert.ok(dist(cs[a], cs[b]) >= need - EPS, `${name}: ${cs[a].k} / ${cs[b].k} ${dist(cs[a], cs[b]).toFixed(2)} < ${need.toFixed(2)}`);
    }
  });
});

test('rule 3: the middle of the stage (x 35-65 %, y 20-80 %) holds no button', () => {
  sweep(S, (L, { w, h, name }) => {
    const z = centralZone(w, h);
    for (const c of allCircles(L)) assert.ok(!hits(c, z), `${name}: ${c.k} at ${c.x.toFixed(1)},${c.y.toFixed(1)} d ${c.d.toFixed(1)} enters the middle`);
  });
});

test('rule 4: the joystick half (left 50 %, below 30 % of the height) holds no button', () => {
  sweep(S, (L, { w, h, name }) => {
    const z = joyZone(w, h);
    for (const c of allCircles(L)) assert.ok(!hits(c, z), `${name}: ${c.k} enters the joystick half`);
  });
});

test('rule 5: ATK hugs the bottom-right corner of the safe box (both gaps <= 24 px)', () => {
  sweep(S, (L, { w, h, i, name }) => {
    const a = L.buttons.atk, rightGap = w - i.r - (a.x + a.d / 2), bottomGap = h - i.b - (a.y + a.d / 2);
    assert.ok(rightGap <= 24 && bottomGap <= 24, `${name}: gaps ${rightGap.toFixed(1)} / ${bottomGap.toFixed(1)}`);
  });
});

test('rule 6: thumb reach (combat buttons within 200 tb of ATK) and JUMP right next to DASH', () => {
  sweep(S, (L, { name }) => {
    const b = L.buttons;
    for (const k of ['dash', 'jump', 'parry', 'q', 'e', 'r']) assert.ok(dist(b[k], b.atk) <= 200 * L.tb, `${name}: ${k} is ${(dist(b[k], b.atk) / L.tb).toFixed(0)} tb from ATK`);
    assert.ok(dist(b.jump, b.dash) <= ((70 + 62) / 2 + 24) * L.tb, `${name}: JUMP is ${(dist(b.jump, b.dash) / L.tb).toFixed(0)} tb from DASH`);
    assert.equal(b.jump.d, 62 * L.tb, 'the jump slot is as wide as PARRY');
  });
});

test('rule 7: the scale follows both sides (non-decreasing, floor 0.78, bands per stage) and the user setting multiplies it', () => {
  const sizes = [];
  for (let w = 600; w <= 1400; w += 40) for (let h = 320; h <= 900; h += 20) sizes.push([w, h]);
  for (const [w, h] of sizes) {
    assert.ok(touchScale(w, h, 1) >= 0.78 - EPS, `${w}x${h} >= 0.78`);
    assert.ok(touchScale(w + 40, h, 1) >= touchScale(w, h, 1) - EPS, `non-decreasing in w at ${w}x${h}`);
    assert.ok(touchScale(w, h + 20, 1) >= touchScale(w, h, 1) - EPS, `non-decreasing in h at ${w}x${h}`);
  }
  const t = (w, h) => touchScale(w, h, 1);
  assert.ok(t(844, 390) >= 0.9 && t(844, 390) <= 1.0, `844x390 = ${t(844, 390)}`);
  assert.ok(t(915, 412) >= 1.0, `915x412 = ${t(915, 412)}`);
  assert.ok(t(932, 430) >= 1.08, `932x430 = ${t(932, 430)}`);
  assert.ok(t(1024, 768) >= 1.25 && t(1024, 768) <= 1.5, `1024x768 = ${t(1024, 768)}`);
  for (const [w, h] of S) for (const u of U) assert.ok(Math.abs(touchScale(w, h, u) - u * touchScale(w, h, 1)) < EPS, 'user multiplies');
  // The fit only ever reduces tb; without a notch the setting 1 is applied as it is on every landscape phone (844x390 keeps
  // its 0.93; the degraded 667x375 does shrink to 0.83 by design, see rule 8).
  sweep(S.concat(DEGRADED), (L, { u, w, h, name }) => {
    assert.ok(L.tb <= touchScale(w, h, u) + 1e-3, `${name}: tb ${L.tb} above the scale`);
    assert.ok(L.tb >= 0.4 - EPS, `${name}: tb ${L.tb}`);
  });
  assert.equal(touchLayout({ w: 844, h: 390, safe: I[0], user: 1 }).tb, 0.93, '844x390 user 1 keeps the 0.93 a small phone had');
  assert.equal(touchLayout({ w: 844, h: 390, safe: I[1], user: 1 }).tb, 0.93, '... and so does the notched one (the potion clears the account row)');
  for (const [w, h] of S) {
    const L = touchLayout({ w, h, safe: I[0], user: 1 });
    if (h <= 480) assert.ok(Math.abs(L.tb - touchScale(w, h, 1)) < 1e-3, `${w}x${h} user 1 flat is not cut`);
    else assert.ok(L.tb >= 1.2, `${w}x${h}: a tablet keeps tb ${L.tb} (the tracker reserve and the 30 % column cap it)`); // top of the buttons stays under the tracker
  }
});

test('rule 8: small phones (667x375, 740x360) keep rules 1 and 2 at every setting and inset', () => {
  // Rules 1 and 2 run in the sweeps above (DEGRADED is part of them); here: the fit never grows the arrangement.
  sweep(DEGRADED, (L, { w, h, u, name }) => {
    assert.ok(L.tb <= touchScale(w, h, u) + 1e-3, name);
    assert.ok(L.tb >= 0.5, `${name}: the buttons did not collapse (tb ${L.tb})`);
  });
});

test('rule 10: no regression on notched phones (user 1, insets 47/47/0/21), and the flat stages keep the pre-rework-2 scale', () => {
  const NOTCH = { l: 47, r: 47, t: 0, b: 21 };
  const notch = [[844, 390, 0.92], [915, 412, 1.0], [932, 430, 1.08], [1024, 768, 1.15]];
  const flat = [[844, 390, 0.93], [915, 412, 1.07], [932, 430, 1.137], [1024, 768, 1.256]];
  for (const [w, h, min] of notch) {
    const { tb } = touchLayout({ w, h, safe: NOTCH, user: 1 });
    assert.ok(tb >= min - EPS, `${w}x${h} notch: tb ${tb} < ${min}`);
  }
  for (const [w, h, min] of flat) {
    const { tb } = touchLayout({ w, h, safe: I[0], user: 1 });
    assert.ok(tb >= min - EPS, `${w}x${h} flat: tb ${tb} < ${min}`);
  }
});

test('the setting never makes the buttons smaller: tb is non-decreasing in the user setting on every stage and inset', () => {
  for (const [w, h] of S.concat(DEGRADED)) for (const i of I) {
    let prev = 0;
    for (const u of [0.85, 0.95, 1, 1.1, 1.18]) {
      const { tb } = touchLayout({ w, h, safe: i, user: u });
      assert.ok(tb >= prev - EPS, `${w}x${h} ${i.l ? 'notch' : 'flat'}: user ${u} gives ${tb} after ${prev}`);
      prev = tb;
    }
  }
});

test('keep-out lantern: gone since R1b (the lantern sits beside the Chat in the left column, away from the cluster)', () => {
  sweep(S, (L, { w, h, i, name }) => assert.ok(!keepOuts(w, h, i).some((k) => k.name === 'lantern'), `${name}: no lantern box`));
});

test('keep-out minimap: no slot touches the touch minimap or its place label (every stage the layout fits)', () => {
  sweep(S.concat(DEGRADED), (L, { w, h, i, name }) => {
    const z = keepOuts(w, h, i).find((k) => k.name === 'minimap');
    assert.ok(z, `${name}: the minimap keep-out exists`);
    // 84 px map at right 18 / top 12 plus its label 10 px below (label box 84 + 2 x 16 wide).
    assert.ok(z.x1 - z.x0 >= 84 + 2 * 16 && z.y1 >= i.t + 12 + 84 + 10 + 10, `${name}: the box covers the map and the label`);
    // The degraded stages keep rules 1 and 2 only: the zones are asserted on the stages the layout fits.
    if (DEGRADED.some(([dw, dh]) => dw === w && dh === h)) return;
    for (const c of allCircles(L)) assert.ok(!hits(c, z), `${name}: ${c.k} touches the minimap block`);
  });
});

test('keep-out toprow: on the 721-900 px compact landscape stage no slot touches the account row (top border, 44 px high)', () => {
  const lo = keepOuts(844, 390, I[0]).find((k) => k.name === 'toprow');
  assert.ok(lo, '844x390 has the account-row keep-out');
  assert.ok(lo.y0 <= 8 && lo.y1 >= 8 + 44 && lo.x1 >= 844 - 110, 'the box covers the row on the top border at 844x390 (..734 x 8..52)');
  for (const [w, h] of [[915, 412], [932, 430], [1024, 768]]) assert.ok(!keepOuts(w, h, I[0]).some((k) => k.name === 'toprow'), `${w}x${h} has no account-row keep-out (another media query)`);
  sweep(S, (L, { w, h, i, name }) => {
    for (const z of keepOuts(w, h, i).filter((k) => k.name === 'toprow')) for (const c of allCircles(L)) assert.ok(!hits(c, z), `${name}: ${c.k} touches the account row`);
  });
});

test('keep-out tracker reserve: on a tall stage every slot stays under 56 % of the height, on a compact one under 20 %', () => {
  sweep(S, (L, { h, name }) => {
    const reserve = (h > 480 ? 0.56 : 0.2) * h;
    for (const c of allCircles(L)) assert.ok(c.y - c.d / 2 >= reserve - EPS, `${name}: ${c.k} top ${(c.y - c.d / 2).toFixed(1)} above ${reserve.toFixed(1)}`);
  });
});

test('rule 9: a rotated portrait stage lays out in stage coordinates, with the remapped insets, like a landscape one', () => {
  // The viewport is 390x844. stage.js turns the stage into 844x390 and vars.css remaps the insets (stage left = physical
  // top, stage right = physical bottom), so touch.js sees the stage frame through its probe and never looks at the
  // rotation itself. The QA portrait viewport (qa-touch-layout.mjs) is the browser proof; this pins what touch.js does.
  const real = { w: stage.w, h: stage.h, rotated: stage.rotated }, hadCs = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  const inset = { l: 47, r: 34, t: 0, b: 0 }; // a physical notch of 47 at the top and a 34 px home bar at the bottom
  try {
    stage.w = 844; stage.h = 390; stage.rotated = true;
    let cur = { l: 0, r: 0, t: 0, b: 0 };
    globalThis.getComputedStyle = () => ({ paddingLeft: cur.l + 'px', paddingRight: cur.r + 'px', paddingTop: cur.t + 'px', paddingBottom: cur.b + 'px' });
    const root = new FakeEl(); root.querySelector('.safe-probe').isConnected = true;
    const touch = new TouchControls(root, { joy: {}, press() {}, pressDash() {}, pressInteract() {}, cancelAim() {}, slotDown() {}, slotUp() {} });
    const flat = { ...root.props }, base = touchLayout({ w: 844, h: 390, safe: cur, user: 1 });
    assert.equal(+flat['--tb'], +base.tb.toFixed(3));
    cur = inset; touch.update();
    const moved = touchLayout({ w: 844, h: 390, safe: inset, user: 1 });
    assert.equal(+root.props['--tb'], +moved.tb.toFixed(3));
    for (const k of SLOTS) {
      assert.equal(+root.props[`--l-${k}-x`], +moved.buttons[k].x.toFixed(1), `${k} x`);
      assert.equal(+root.props[`--l-${k}-y`], +moved.buttons[k].y.toFixed(1), `${k} y`);
    }
    // The remapped insets really move the layout: ATK sits the stage's right inset (34) plus the corner gap in from the
    // edge, the joystick keeps the stage's left inset (47) plus its gap, and the cluster moved inwards.
    const tb = +root.props['--tb'], atkRightGap = 844 - (+root.props['--l-atk-x'] + 46 * tb);
    assert.ok(Math.abs(atkRightGap - (34 + 12)) < 0.2, `ATK right gap ${atkRightGap}`);
    assert.ok(Math.abs((+root.props['--l-joy-x'] - 52 * tb) - (47 + 28)) < 0.2, 'the joystick keeps the left inset plus its gap');
    assert.ok(+root.props['--l-atk-x'] < +flat['--l-atk-x'] - 20, 'the right inset pulled the cluster inwards');
    // The same stage frame without the rotation flag gives the same numbers: the layout does not read it.
    stage.rotated = false; touch.layoutKey = null; touch.update();
    assert.equal(+root.props['--l-atk-x'], +moved.buttons.atk.x.toFixed(1));
  } finally {
    Object.assign(stage, real);
    if (hadCs) Object.defineProperty(globalThis, 'getComputedStyle', hadCs); else delete globalThis.getComputedStyle;
  }
});

// ---- touch.js wiring on a fake DOM ----------------------------------------------------------------------------
class FakeEl extends EventTarget {
  constructor() {
    super();
    this.props = {}; this.style = { setProperty: (k, v) => { this.props[k] = v; } };
    this.dataset = {}; this.attributes = {}; this.children = {}; this.hidden = false;
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; } };
  }
  setPointerCapture() {} releasePointerCapture() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  querySelector(sel) { return (this.children[sel] ||= new FakeEl()); }
  querySelectorAll() { return []; }
}
const fakeRoot = () => { const root = new FakeEl(), input = { joy: {}, press() {}, pressDash() {}, pressInteract() {}, cancelAim() {}, slotDown() {}, slotUp() {} }; root.touch = new TouchControls(root, input); return root; };

test('touch.js writes --tb and every slot centre on construction, on a size change and on the settings path', () => {
  const real = { w: stage.w, h: stage.h };
  try {
    stage.w = 932; stage.h = 430;
    const root = fakeRoot(), t = root.touch;
    const L1 = touchLayout({ w: 932, h: 430, safe: { l: 0, r: 0, t: 0, b: 0 }, user: 1 });
    assert.equal(+root.props['--tb'], +L1.tb.toFixed(3));
    assert.equal(t.tb, L1.tb);
    assert.equal(+root.props['--l-atk-x'], +L1.buttons.atk.x.toFixed(1));
    t.setScale(0.85); // the settings path
    const L2 = touchLayout({ w: 932, h: 430, safe: { l: 0, r: 0, t: 0, b: 0 }, user: 0.85 });
    assert.equal(+root.props['--tb'], +L2.tb.toFixed(3));
    assert.ok(L2.tb < L1.tb);
    stage.w = 844; stage.h = 390; t.update(); // a resize / rotation reaches update() through stage.onChange
    const L3 = touchLayout({ w: 844, h: 390, safe: { l: 0, r: 0, t: 0, b: 0 }, user: 0.85 });
    assert.equal(+root.props['--l-dash-x'], +L3.buttons.dash.x.toFixed(1));
    assert.equal(+root.props['--l-jump-y'], +L3.buttons.jump.y.toFixed(1));
  } finally { Object.assign(stage, real); }
});

test('touch.js reads the safe-area insets from the probe (the stage remaps them while rotated) and lays out inside them', () => {
  const real = { w: stage.w, h: stage.h }, hadCs = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  try {
    stage.w = 844; stage.h = 390;
    globalThis.getComputedStyle = () => ({ paddingLeft: '47px', paddingRight: '47px', paddingTop: '0px', paddingBottom: '21px' });
    const root = new FakeEl(), probe = root.querySelector('.safe-probe');
    probe.isConnected = true;
    const touch = new TouchControls(root, { joy: {}, press() {}, pressDash() {}, pressInteract() {}, cancelAim() {}, slotDown() {}, slotUp() {} });
    assert.deepEqual(touch.readInsets(), { l: 47, r: 47, t: 0, b: 21 });
    const L = touchLayout({ w: 844, h: 390, safe: { l: 47, r: 47, t: 0, b: 21 }, user: 1 });
    assert.equal(+root.props['--l-atk-x'], +L.buttons.atk.x.toFixed(1));
    assert.equal(+root.props['--l-joy-x'], +L.joy.x.toFixed(1));
    // The same stage without insets puts ATK 47 px further right: the insets really move the layout.
    globalThis.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px' });
    touch.update();
    assert.equal(+root.props['--l-atk-x'], +touchLayout({ w: 844, h: 390, safe: {}, user: 1 }).buttons.atk.x.toFixed(1));
  } finally {
    Object.assign(stage, real);
    if (hadCs) Object.defineProperty(globalThis, 'getComputedStyle', hadCs); else delete globalThis.getComputedStyle;
  }
});

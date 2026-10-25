import test from 'node:test';
import assert from 'node:assert/strict';
import { touchLayout } from '../src/ui/touchLayout.js';
import { QuickBar, sanitizeSlots, quickOptions } from '../src/ui/quickBar.js';
import { FreshwaterPanel } from '../src/ui/freshwaterPanel.js';

const stages = [[844, 390], [915, 412], [932, 430], [1024, 768], [667, 375], [740, 360]];
const users = [0.85, 1, 1.18];
const insets = [{ l: 0, r: 0, t: 0, b: 0 }, { l: 47, r: 47, t: 0, b: 21 }];
test('quick circles fit the safe bottom band and clear every existing circle in both states', () => {
  for (const [w, h] of stages) for (const user of users) for (const safe of insets) {
    const L = touchLayout({ w, h, user, safe });
    for (const n of [4, 8]) {
      const d = L.quick['d' + n], gap = L.quick['gap' + n], y = L.quick['y' + n], x = L.quick['x' + n];
      const name = JSON.stringify({ w, h, user, safe, n });
      assert.ok(d >= (n === 4 ? 32 : 28) && gap >= 2, name);
      assert.ok(y - d / 2 >= 0.8 * h - 1e-6, name);
      assert.ok(y - d / 2 >= safe.t + 8 - 1e-6, name);
      assert.ok(Math.abs(y + d / 2 - (h - safe.b - 8)) < 1e-6, name);
      for (let i = 0; i <= n; i++) {
        const cx = x + (i - n / 2) * (d + gap);
        assert.ok(cx - d / 2 >= safe.l + 8 - 1e-6 && cx + d / 2 <= w - safe.r - 8 + 1e-6, name);
        for (const c of [L.joy, ...Object.values(L.buttons)]) {
          assert.ok(Math.hypot(cx - c.x, y - c.y) >= (d + c.d) / 2 + 4 - 1e-6, name);
        }
      }
    }
  }
});
test('sanitizeSlots rejects malformed storage and returns independent defaults', () => {
  const defaults = [{ k: 'potion' }, { k: 'drink' }, ...Array(6).fill(null)];
  for (const raw of [null, '{bad', [], Array(7).fill(null), [{ k: 'tool' }, ...Array(7).fill(null)],
    [{ k: 'eat', good: 'madera' }, ...Array(7).fill(null)], [{ k: 'skill', slot: 'w' }, ...Array(7).fill(null)]]) {
    assert.deepEqual(sanitizeSlots(raw), defaults);
  }
  const valid = [{ k: 'potion' }, { k: 'drink' }, { k: 'eat', good: 'coco' }, { k: 'skill', slot: 'q' },
    { k: 'skill', slot: 'e' }, { k: 'skill', slot: 'r' }, { k: 'skill', slot: 'g' }, null];
  assert.deepEqual(sanitizeSlots(JSON.stringify({ slots: valid, open: true })), valid);
  assert.deepEqual(sanitizeSlots(valid), valid);
  const a = sanitizeSlots(null); a[0].k = 'drink'; assert.deepEqual(sanitizeSlots(null), defaults);
});
test('picker options follow goods, canteen presence and pearl availability', () => {
  const empty = quickOptions({ canteen: null, goods: { pescado: 0, fruta: 0.5, ron: -2 }, pearl: false });
  assert.deepEqual(empty, [{ k: 'potion' }, ...['q', 'e', 'r'].map(slot => ({ k: 'skill', slot }))]);
  const all = quickOptions({ canteen: 0, goods: { pescado: 1, galleta: 2, fruta: 1, agua: 1, ron: 1, coco: 1, madera: 3 }, pearl: true });
  assert.ok(all.some(e => e.k === 'drink'));
  assert.deepEqual(all.filter(e => e.k === 'eat').map(e => e.good), ['pescado', 'galleta', 'fruta', 'agua', 'ron', 'coco']);
  assert.deepEqual(all.filter(e => e.k === 'skill').map(e => e.slot), ['q', 'e', 'r', 'g']);
});
test('closed-panel quick use keeps the session, pending, retry and acknowledgement guards', () => {
  const sent = [], c = { joined: true, youServer: {}, send: command => sent.push(command) };
  let now = 0;
  const panel = Object.assign(Object.create(FreshwaterPanel.prototype), {
    active: false, owner: c, session: c.youServer, client: () => c, now: () => now,
    canteen: () => ({ water: 2 }), needs: () => ({ hyd: 50, sat: 50 }), canteenEnabled: () => true,
    pack: () => ({ goods: { pescado: 1 } }), profile: () => ({ eco: { tradeRev: 1 } }),
    status: () => ({ enabled: true }), busy: () => false, barrelActionBlocked: () => false,
    setStatus() {}, render() {}, copy: () => ({}), toast() {},
  });
  assert.equal(panel.drink(), false); assert.equal(panel.eat('pescado'), false);
  assert.equal(panel.quickDrink(), true); assert.equal(panel.quickEat('pescado'), false);
  now = 1001; panel.update(); assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]);
  assert.equal(panel.acknowledge({ type: 'freshwater', opId: sent[0].opId, ok: true }), true);
  assert.equal(panel.quickEat('pescado'), true);
  panel.pending = null; panel.needs = () => ({ hyd: 100, sat: 100 });
  assert.equal(panel.quickDrink(), false); assert.equal(panel.quickEat('pescado'), false);
  panel.needs = () => ({ hyd: 0, sat: 0 }); panel.session = {};
  assert.equal(panel.quickDrink(), false); assert.equal(panel.quickEat('pescado'), false);
});

// A minimal event surface exercises gestures without a browser or a rendering dependency.
function gestureHarness(entry, kind = 'dir') {
  const events = {}, calls = [], classes = new Set();
  const b = { addEventListener: (name, fn) => { events[name] = fn; }, setPointerCapture() {}, releasePointerCapture() {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const bar = Object.assign(Object.create(QuickBar.prototype), {
    slots: [entry], enabled: () => true, skill: e => e?.k === 'skill' ? { kind, locked: bar.locked } : null,
    input: { press: bit => calls.push(['press', bit]), slotDown: slot => calls.push(['down', slot]),
      slotUp: slot => calls.push(['up', slot]), cancelAim: () => calls.push(['cancel']) },
    freshwater: { quickDrink: () => calls.push(['drink']), quickEat: good => calls.push(['eat', good]) },
    closePicker() {}, openPicker: slot => calls.push(['picker', slot]),
  });
  bar.bind(b, 0);
  const emit = (name, extra = {}) => events[name]({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0, ...extra });
  return { bar, calls, emit };
}
test('taps use consumables, empty slots pick, and motion/cancellation never activates', () => {
  for (const [entry, result] of [[{ k: 'drink' }, ['drink']], [{ k: 'eat', good: 'fruta' }, ['eat', 'fruta']], [null, ['picker', 0]]]) {
    const h = gestureHarness(entry); h.emit('pointerdown'); h.emit('pointerup'); assert.deepEqual(h.calls, [result]);
  }
  for (const event of ['pointercancel', 'lostpointercapture', 'pointermove']) {
    const h = gestureHarness({ k: 'potion' }); h.emit('pointerdown'); h.emit(event, { clientX: 13 }); h.emit('pointerup');
    assert.deepEqual(h.calls, []);
  }
  const h = gestureHarness({ k: 'potion' }); h.emit('pointerdown'); h.emit('pointerup'); assert.equal(h.calls[0][0], 'press');
});
test('skills use tap input semantics and locked skills stay silent', () => {
  for (const kind of ['ground', 'charge']) {
    const h = gestureHarness({ k: 'skill', slot: 'g' }, kind); h.emit('pointerdown');
    assert.deepEqual(h.calls, [['down', 'g']]); h.emit('pointerup'); assert.deepEqual(h.calls, [['down', 'g'], ['up', 'g']]);
  }
  for (const kind of ['dir', 'self']) {
    const h = gestureHarness({ k: 'skill', slot: 'q' }, kind); h.emit('pointerdown'); assert.deepEqual(h.calls, []);
    h.emit('pointerup'); assert.equal(h.calls[0][0], 'press');
  }
  const h = gestureHarness({ k: 'skill', slot: 'q' }, 'charge'); h.bar.locked = true;
  h.emit('pointerdown'); h.emit('pointerup'); assert.deepEqual(h.calls, []);
});
test('long press cancels a held skill, opens the picker and never casts on release', async () => {
  const h = gestureHarness({ k: 'skill', slot: 'g' }, 'charge'); h.emit('pointerdown');
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.deepEqual(h.calls, [['down', 'g'], ['cancel'], ['up', 'g'], ['picker', 0]]);
  h.emit('pointerup'); assert.equal(h.calls.length, 4);
});
test('character storage is isolated and optional; unchanged state performs no DOM writes', () => {
  let writes = 0;
  const stored = new Map(), doc = { addEventListener() {}, defaultView: { addEventListener() {}, localStorage: {
    getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value),
  } } };
  doc.createElement = () => {
    const children = {}, classes = new Set();
    return { ownerDocument: doc, classList: { toggle: (name, on) => { writes++; if (on) classes.add(name); else classes.delete(name); } },
      set innerHTML(value) { writes++; }, set textContent(value) { writes++; },
      setAttribute() { writes++; }, addEventListener() {}, appendChild() {}, replaceChildren() {}, contains: () => false,
      querySelector: key => children[key] ||= doc.createElement(),
    };
  };
  const bar = new QuickBar(doc.createElement(), { input: {}, touch: {}, freshwater: {} });
  bar.setCharacter('first'); bar.slots[0] = { k: 'eat', good: 'coco' }; bar.open = true; bar.save();
  bar.setCharacter('second'); assert.deepEqual(bar.slots[0], { k: 'potion' }); assert.equal(bar.open, false);
  bar.setCharacter('first'); assert.deepEqual(bar.slots[0], { k: 'eat', good: 'coco' }); assert.equal(bar.open, true);
  bar.update({ potions: 1, canteen: 2, goods: { coco: 3 }, pearl: false });
  const before = writes; bar.update({ potions: 1, canteen: 2, goods: { coco: 3 }, pearl: false }); assert.equal(writes, before);
  doc.defaultView.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.doesNotThrow(() => { bar.setCharacter(null); bar.save(); });
  assert.equal(bar.key, 'mn.quickbar.v1.guest'); assert.deepEqual(bar.slots[0], { k: 'potion' });
});

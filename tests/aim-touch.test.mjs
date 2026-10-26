// PT02 aimed shooting. Part 1: the auto-aim candidate choice (client/autoAim.js, DOM-free): pirates are lockable only
// while both ends stand in the lawless zone, and the pistols lock as far as their bullet flies. Part 2: the touch
// fire buttons (ui/touchGesture.js holdAim, wired in ui/touch.js): tap = plain hold, drag = aimed continuous fire,
// release stops with no extra shot; Q / E / R keep their aim-and-release-fire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAimPoint, pickLockTarget, lockRange, MELEE_LOCK } from '../src/client/autoAim.js';
import { holdAim, DRAG_FAR } from '../src/ui/touchGesture.js';
import { TouchControls } from '../src/ui/touch.js';
import { BTN } from '../src/sim/systems/movement.js';
import { ACT } from '../src/sim/ecs.js';
import { SKILLS, WEAPON } from '../src/data/weapons.js';
import { map, A } from './helpers.mjs';

const K = map.cala;
const lawlessAt = (x, z) => !!map.lawlessAt(x, z);
const NO_HAZARDS = { cap: 0 };

const player = (x, z, weapon = WEAPON.SABLE) => ({ x, y: 1, z, f: 0, weapon });
const pirate = (id, x, z, o = {}) => ({ id, human: true, ready: true, dying: false, r: { x, z, hp: 60, act: ACT.IDLE }, ...o });
const mob = (id, x, z, o = {}) => ({ id, enemy: 'renegado', ready: true, dying: false, r: { x, z, hp: 30, act: ACT.IDLE }, ...o });
const entities = (...recs) => new Map(recs.map((r) => [r.id, r]));
const STILL = { x: 0, z: 0 };

function aimAt(ps, recs, { H = NO_HAZARDS, mv = STILL, youId = 1 } = {}) {
  const out = { x: NaN, y: NaN, z: NaN };
  autoAimPoint({ ps, H, pt: 1, reach: 1, entities: entities(...recs), youId, lawlessAt }, mv, out);
  return out;
}
const near = (a, x, z) => Math.hypot(a.x - x, a.z - z) < 1e-9;

test('lock range: 9 u for the sword kit, the pistol bullet reach (speed x life) for the pistols', () => {
  const reach = SKILLS.pistol.speed * SKILLS.pistol.life;
  assert.equal(MELEE_LOCK, 9);
  assert.equal(lockRange(WEAPON.SABLE), 9);
  assert.equal(lockRange(WEAPON.PISTOLAS), reach);
  assert.ok(reach > 9, 'the pistols reach farther than the old lock');
});

test('(a) a pirate 6 u away with both inside the Cala is the aim point', () => {
  const ps = player(K.x, K.z, WEAPON.PISTOLAS);
  const a = aimAt(ps, [pirate(1, K.x, K.z), pirate(2, K.x + 6, K.z)]);
  assert.ok(near(a, K.x + 6, K.z), `aimed at ${a.x},${a.z}`);
  assert.equal(a.y, ps.y);
  assert.ok(near(aimAt(player(K.x, K.z, WEAPON.SABLE), [pirate(2, K.x + 6, K.z)]), K.x + 6, K.z), 'the sword kit locks pirates too');
});

test('(b) local player outside the Cala, pirate inside: not chosen (falls back to facing)', () => {
  const ps = player(K.x + 21 + 5, K.z, WEAPON.PISTOLAS);
  assert.ok(!lawlessAt(ps.x, ps.z), 'the player stands just outside the ring');
  const p = pirate(2, K.x + 21 - 1, K.z);
  assert.ok(lawlessAt(p.r.x, p.r.z), 'the pirate is inside');
  const a = aimAt(ps, [p]);
  assert.ok(near(a, ps.x, ps.z + 3), 'facing fallback (f = 0: +z, 3 u)');
  // the opposite case: the player inside, the pirate just outside the ring
  const inside = player(K.x + 21 - 2, K.z, WEAPON.PISTOLAS);
  const a2 = aimAt(inside, [pirate(2, K.x + 21 + 3, K.z)]);
  assert.ok(near(a2, inside.x, inside.z + 3), 'a pirate outside the ring is not chosen from inside it');
});

test('(c) both inside La Caldera [25,0]: a pirate is not chosen', () => {
  assert.ok(!lawlessAt(A.x, A.z) && !lawlessAt(A.x + 6, A.z), 'La Caldera has no PvP');
  const ps = player(A.x, A.z, WEAPON.PISTOLAS);
  const a = aimAt(ps, [pirate(2, A.x + 6, A.z)]);
  assert.ok(near(a, A.x, A.z + 3), 'facing fallback, the pirate is ignored');
});

test('(d) a mob 15 u away: locked with the pistols, not locked with the sword kit', () => {
  const m = mob(5, A.x + 15, A.z);
  const gun = aimAt(player(A.x, A.z, WEAPON.PISTOLAS), [m]);
  assert.ok(near(gun, A.x + 15, A.z), 'pistols lock at 15 u');
  const blade = aimAt(player(A.x, A.z, WEAPON.SABLE), [m]);
  assert.ok(near(blade, A.x, A.z + 3), 'sword: 15 u is out of the 9 u lock');
  const edge = aimAt(player(A.x, A.z, WEAPON.PISTOLAS), [mob(6, A.x + 19, A.z)]);
  assert.ok(near(edge, A.x, A.z + 3), 'beyond the bullet reach (18 u) nothing locks');
});

test('(e) a hostile projectile on a collision course still wins over a nearer pirate', () => {
  const ps = player(K.x, K.z, WEAPON.PISTOLAS);
  const H = { cap: 1, live: () => true, velocityAt: () => ({ x: 0, z: -10 }), px: () => K.x, pz: () => K.z + 5, r: [0.2] };
  const a = aimAt(ps, [pirate(2, K.x + 2, K.z)], { H });
  assert.ok(near(a, K.x, K.z + 5), 'aimed at the projectile, not the pirate 2 u away');
  const away = { ...H, velocityAt: () => ({ x: 0, z: 10 }) };
  assert.ok(near(aimAt(ps, [pirate(2, K.x + 2, K.z)], { H: away }), K.x + 2, K.z), 'a projectile flying away is no threat');
});

test('(f) the local player is never its own target', () => {
  const ps = player(K.x, K.z, WEAPON.PISTOLAS);
  const me = pirate(1, K.x, K.z);
  assert.equal(pickLockTarget({ ps, entities: entities(me), youId: 1, lawlessAt, range: 18 }), null);
  assert.ok(near(aimAt(ps, [me], { youId: 1 }), K.x, K.z + 3), 'alone in the Cala: the facing fallback');
  const other = pirate(2, K.x + 8, K.z);
  assert.equal(pickLockTarget({ ps, entities: entities(me, other), youId: 1, lawlessAt, range: 18 }), other);
});

test('pirates that cannot be hurt are skipped: dying, dead, not ready, bots', () => {
  const ps = player(K.x, K.z, WEAPON.PISTOLAS);
  const bad = [
    pirate(2, K.x + 3, K.z, { dying: true }), pirate(3, K.x + 3, K.z, { ready: false }),
    pirate(4, K.x + 3, K.z, { r: { x: K.x + 3, z: K.z, hp: 0, act: ACT.IDLE } }),
    pirate(5, K.x + 3, K.z, { r: { x: K.x + 3, z: K.z, hp: 40, act: ACT.DEAD } }),
    pirate(6, K.x + 3, K.z, { human: false }),
  ];
  assert.equal(pickLockTarget({ ps, entities: entities(...bad), youId: 1, lawlessAt, range: 18 }), null);
  const live = pirate(7, K.x + 9, K.z);
  assert.equal(pickLockTarget({ ps, entities: entities(...bad, live), youId: 1, lawlessAt, range: 18 }), live);
});

test('mobs and pirates compete together: the nearest wins', () => {
  const ps = player(K.x, K.z, WEAPON.PISTOLAS);
  assert.ok(near(aimAt(ps, [pirate(2, K.x + 7, K.z), mob(3, K.x - 4, K.z)]), K.x - 4, K.z), 'the mob is nearer');
  assert.ok(near(aimAt(ps, [pirate(2, K.x + 4, K.z), mob(3, K.x - 7, K.z)]), K.x + 4, K.z), 'the pirate is nearer');
});

test('old cases hold: a mob within 9 u with the sword, a cannon is ignored, then the move and facing fallbacks', () => {
  const ps = player(A.x, A.z, WEAPON.SABLE);
  assert.ok(near(aimAt(ps, [mob(5, A.x + 8, A.z)]), A.x + 8, A.z));
  const cannon = mob(6, A.x + 2, A.z, { enemy: 'cannon' });
  assert.ok(near(aimAt(ps, [cannon]), A.x, A.z + 3), 'cannons are no candidates');
  assert.ok(near(aimAt(ps, [mob(7, A.x + 2, A.z, { dying: true }), mob(8, A.x + 2, A.z, { ready: false })]), A.x, A.z + 3));
  assert.ok(near(aimAt(ps, [], { mv: { x: 1, z: 0 } }), A.x + 3, A.z), 'stick held: 3 u along the move');
  assert.ok(near(aimAt({ ...ps, f: Math.PI / 2 }, []), A.x + 3, A.z), 'no stick: 3 u along the facing');
});

// ---- Touch: the holdAim state machine --------------------------------------------------------------------------
function fakeInput() {
  return { touchHeld: 0, touchAim: null, pressed: 0, presses: [], press(bit) { this.pressed |= bit; this.presses.push(bit); } };
}

test('(g) a tap on ATK: bit pressed and held, then cleared; touchAim never set', () => {
  const input = fakeInput(), g = holdAim(input, BTN.ATTACK);
  g.down(1);
  assert.equal(input.pressed & BTN.ATTACK, BTN.ATTACK);
  assert.equal(input.touchHeld & BTN.ATTACK, BTN.ATTACK);
  assert.equal(g.move(1, 10, -8), null, 'a wobble inside 22 px draws nothing');
  assert.equal(input.touchAim, null);
  assert.ok(!g.aimed, 'a wobble is not a drag');
  assert.equal(g.move(1, DRAG_FAR, 0), null, 'exactly 22 px is still a tap');
  assert.ok(g.up(1));
  assert.equal(input.touchHeld, 0);
  assert.equal(input.touchAim, null);
  assert.deepEqual(input.presses, [BTN.ATTACK], 'a single press, no release shot');
});

for (const [name, bit] of [['ATK', BTN.ATTACK], ['PARRY', BTN.GUARD]]) {
  test(`(h) ${name}: dragging 40 px right aims right while down and keeps firing; release stops with no shot`, () => {
    const input = fakeInput(), g = holdAim(input, bit);
    g.down(7);
    const drawn = g.move(7, 40, 0);
    assert.deepEqual(drawn, { dx: 40, dy: 0 });
    assert.ok(input.touchAim && Math.abs(input.touchAim.x - 1) < 1e-9 && Math.abs(input.touchAim.y) < 1e-9, 'direction (1, 0)');
    assert.equal(input.touchAim.release, false, 'main.js keeps the aim until release');
    assert.ok(input.touchAim.k > 0 && input.touchAim.k <= 1);
    assert.equal(input.touchHeld & bit, bit, 'the held bit stays set, the sim keeps firing');
    g.move(7, 41, 0);
    assert.equal(input.touchHeld & bit, bit);
    g.up(7);
    assert.equal(input.touchHeld, 0, 'release clears the held bit');
    assert.equal(input.touchAim, null, 'release clears the aim');
    assert.deepEqual(input.presses, [bit], 'only the press from the touch-down: no release-fire');
  });
}

test('once past 22 px the gesture stays aimed: the direction follows beyond 22 px and is kept inside it', () => {
  const input = fakeInput(), g = holdAim(input, BTN.ATTACK);
  g.down(1);
  g.move(1, 0, -50); // up on screen (y down): aim y = +1
  assert.ok(Math.abs(input.touchAim.y - 1) < 1e-9 && Math.abs(input.touchAim.x) < 1e-9);
  assert.equal(g.move(1, 5, -3), null, 'back inside 22 px: no update');
  assert.ok(input.touchAim, 'still aimed (Q / E / R would cancel here)');
  assert.ok(Math.abs(input.touchAim.y - 1) < 1e-9, 'last direction kept');
  g.move(1, -60, 0);
  assert.ok(Math.abs(input.touchAim.x + 1) < 1e-9, 'beyond 22 px again: updates to the left');
  assert.ok(g.aimed);
});

test('(D4) the pointer that last set touchAim owns it; releasing clears it only if it owns it', () => {
  const input = fakeInput(), atk = holdAim(input, BTN.ATTACK), par = holdAim(input, BTN.GUARD);
  atk.down(1); par.down(2);
  atk.move(1, 40, 0);
  const atkAim = input.touchAim;
  par.move(2, 0, -40);
  const parAim = input.touchAim;
  assert.notEqual(parAim, atkAim, 'PARRY took the aim');
  atk.up(1);
  assert.equal(input.touchAim, parAim, 'ATK no longer owns it: its release leaves PARRY aim alone');
  assert.equal(input.touchHeld, BTN.GUARD);
  atk.move(1, 0, 0);
  par.up(2);
  assert.equal(input.touchAim, null, 'the owner clears it');
  assert.equal(input.touchHeld, 0);
  // a skill drag (Q) took the aim meanwhile: the release of the fire button must not clear it
  atk.down(3); atk.move(3, 40, 0);
  const skillAim = { x: 0, y: 1, k: 1, release: false };
  input.touchAim = skillAim;
  atk.up(3);
  assert.equal(input.touchAim, skillAim);
});

test('a pointer that is not the gesture is ignored', () => {
  const input = fakeInput(), g = holdAim(input, BTN.ATTACK);
  g.down(1);
  assert.equal(g.move(2, 80, 0), null);
  assert.equal(g.up(2), false);
  assert.equal(input.touchHeld, BTN.ATTACK);
  assert.equal(input.touchAim, null);
  g.up(1);
});

// ---- Touch: TouchControls wired to a fake DOM ------------------------------------------------------------------
class FakeEvent extends Event {
  constructor(type, props = {}) {
    super(type, { cancelable: true });
    for (const [key, value] of Object.entries(props)) Object.defineProperty(this, key, { configurable: true, value });
  }
}
class FakeEl extends EventTarget {
  constructor() {
    super();
    this.style = { setProperty() {} }; this.dataset = {}; this.attributes = {}; this.children = {};
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; } };
    this.hidden = false;
  }
  setPointerCapture() {} releasePointerCapture() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getBoundingClientRect() { return { left: 100, top: 100, width: 60, height: 60 }; }
  querySelector(sel) { return (this.children[sel] ||= new FakeEl()); }
}
class FakeRoot extends FakeEl {
  constructor() {
    super();
    for (const c of ['.t-atk', '.t-dash', '.t-parry', '.t-q', '.t-e', '.t-r', '.t-g', '.t-pot', '.t-act']) this.children[c] = new FakeEl();
    for (const c of ['.joy-zone', '.joy', '.aimline']) this.children[c] = new FakeEl();
  }
  set innerHTML(_) {}
  querySelectorAll(sel) { return sel === '.tbtn' ? Object.entries(this.children).filter(([k]) => k.startsWith('.t-')).map(([, v]) => v) : []; }
}
function touchRig() {
  const root = new FakeRoot();
  const input = {
    touchHeld: 0, touchAim: null, pressed: 0, presses: [], aimDevice: '', lastDevice: '', slots: [],
    press(bit) { this.pressed |= bit; this.presses.push(bit); },
    pressDash() {}, pressInteract() {}, cancelAim() {},
    slotDown(s) { this.slots.push('down:' + s); }, slotUp(s) { this.slots.push('up:' + s); },
    joy: { active: false, x: 0, y: 0 },
  };
  new TouchControls(root, input);
  const send = (sel, type, props) => root.children[sel].dispatchEvent(new FakeEvent(type, props));
  return { root, input, send, line: root.children['.aimline'] };
}

test('wiring: a tap on .t-atk and .t-parry is the plain hold; no aim line, no touchAim', () => {
  const r = touchRig();
  for (const [sel, bit] of [['.t-atk', BTN.ATTACK], ['.t-parry', BTN.GUARD]]) {
    r.send(sel, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
    assert.equal(r.input.touchHeld & bit, bit);
    r.send(sel, 'pointermove', { pointerId: 1, clientX: 210, clientY: 195 });
    assert.equal(r.input.touchAim, null);
    r.send(sel, 'pointerup', { pointerId: 1 });
    assert.equal(r.input.touchHeld, 0);
    assert.notEqual(r.line.style.display, 'block');
  }
  assert.deepEqual(r.input.presses, [BTN.ATTACK, BTN.GUARD]);
});

test('wiring: dragging .t-atk / .t-parry 40 px right aims right, shows the aim line, release hides it and stops', () => {
  const r = touchRig();
  for (const [sel, bit] of [['.t-atk', BTN.ATTACK], ['.t-parry', BTN.GUARD]]) {
    r.send(sel, 'pointerdown', { pointerId: 3, clientX: 200, clientY: 200 });
    r.send(sel, 'pointermove', { pointerId: 3, clientX: 240, clientY: 200 });
    assert.ok(r.input.touchAim && Math.abs(r.input.touchAim.x - 1) < 1e-9, 'direction (1, 0) while down');
    assert.equal(r.input.touchHeld & bit, bit);
    assert.equal(r.line.style.display, 'block', 'the Q / E / R aim line is reused');
    assert.equal(r.line.style.width, '40px');
    r.send(sel, 'pointerup', { pointerId: 3 });
    assert.equal(r.input.touchHeld, 0);
    assert.equal(r.input.touchAim, null);
    assert.equal(r.line.style.display, 'none');
  }
  assert.deepEqual(r.input.presses, [BTN.ATTACK, BTN.GUARD], 'no shot on release');
});

test('(i) wiring: dragging Q still aims and fires on release; a Q tap fires; dragging back cancels', () => {
  const r = touchRig();
  r.send('.t-q', 'pointerdown', { pointerId: 5, clientX: 200, clientY: 200 });
  r.send('.t-q', 'pointermove', { pointerId: 5, clientX: 240, clientY: 200 });
  assert.ok(r.input.touchAim && Math.abs(r.input.touchAim.x - 1) < 1e-9);
  assert.equal(r.input.pressed, 0, 'nothing fires while dragging');
  const aim = r.input.touchAim;
  r.send('.t-q', 'pointerup', { pointerId: 5 });
  assert.deepEqual(r.input.presses, [BTN.Q], 'the press goes out on release');
  assert.equal(aim.release, true, 'main.js uses the aim for that command, then drops it');
  assert.equal(r.input.touchAim, aim);

  const t2 = touchRig();
  t2.send('.t-e', 'pointerdown', { pointerId: 6, clientX: 200, clientY: 200 });
  t2.send('.t-e', 'pointerup', { pointerId: 6 });
  assert.deepEqual(t2.input.presses, [BTN.E]);
  assert.equal(t2.input.touchAim, null);

  const t3 = touchRig();
  t3.send('.t-r', 'pointerdown', { pointerId: 8, clientX: 200, clientY: 200 });
  t3.send('.t-r', 'pointermove', { pointerId: 8, clientX: 240, clientY: 200 });
  t3.send('.t-r', 'pointermove', { pointerId: 8, clientX: 205, clientY: 200 });
  assert.equal(t3.input.touchAim, null, 'back onto the button cancels');
  t3.send('.t-r', 'pointerup', { pointerId: 8 });
  assert.deepEqual(t3.input.presses, []);
});

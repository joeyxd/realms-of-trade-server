// TA02: hold-to-chop simulation. A fake world like harvest-palm.test.mjs; the test advances w.tick and calls stepChopping the
// way LocalServer does (commands between ticks, then one world step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/data/tuning.js';
import { HARVEST, sanitizeTools } from '../src/data/resources.js';
import { AXES, CHOP, CHOP_RECIPES, palmSize, greenTicks } from '../src/data/chopping.js';
import { GOODS } from '../src/data/goods.js';
import { harvestLoot } from '../src/data/harvestLoot.js';
import { C } from '../src/sim/ecs.js';
import { installResources, publicResources, resourceCmd, clearResourceReceipts } from '../src/sim/systems/resources.js';
import { stepChopping } from '../src/sim/systems/chopping.js';
import { newProfile } from '../src/sim/systems/inventory.js';

function fixture({ players = 1, axe = 1, scale = 1, chop = true, cap = 40, palms = 1 } = {}) {
  const map = {
    seed: 17, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 30, z: 0 } },
    heightAt: () => 2, groundAt: () => 2, onDock: () => false, lawlessAt: () => false,
    colliders: [], npcs: [], racks: [], practice: { dummy: { x: 100, z: 100 }, ring: { x: 100, z: 100, r: 1 } },
    toWorld: (x, z) => ({ x, z }),
  };
  const w = { map, tick: 100, events: [], emit(ev) { this.events.push(ev); },
    raftDeck: { surface: () => null }, profiles: new Map(), profileDirty: new Set(),
    ecs: { alive: new Uint8Array(32), dead: new Float32Array(32), mask: new Uint16Array(32), hp: new Float32Array(32),
      x: new Float32Array(32), y: new Float32Array(32), z: new Float32Array(32), moveMag: new Float32Array(32),
      vx: new Float32Array(32), vz: new Float32Array(32), dashT: new Float32Array(32), dashBuffer: new Float32Array(32),
      castK: new Float32Array(32), castLock: new Float32Array(32), atkStage: new Float32Array(32), regenT: new Float32Array(32) } };
  installResources(w);
  if (chop) w.chopVersion = 1;
  w.resources.nodes = new Map([['stone-1', { id: 'stone-1', kind: 'stone', x: 5, y: 2, z: 0, rev: 1, readyTick: 0 }]]);
  for (let i = 1; i <= palms; i++) w.resources.nodes.set(`palm-${i}`, { id: `palm-${i}`, kind: 'palm', x: 0, y: 2, z: 0, propIndex: i, scale, rot: 0, rev: 1, readyTick: 0, hits: 0 });
  w.resources.bench = { x: 0, y: 2, z: 0 };
  for (let e = 1; e <= players; e++) {
    w.ecs.alive[e] = 1; w.ecs.mask[e] = C.PLAYER; w.ecs.hp[e] = 100;
    w.ecs.x[e] = -1; w.ecs.y[e] = 2; w.ecs.z[e] = 0; w.ecs.dashT[e] = -1; w.ecs.regenT[e] = 100;
    const profile = newProfile();
    profile.eco.pack = { cap, goods: {} };
    profile.tools = { axe: Array.isArray(axe) ? axe[e - 1] : axe, pickaxe: 0 };
    w.profiles.set(e, profile);
  }
  return w;
}

const tickTo = (w, tick) => { while (w.tick < tick) { w.tick++; stepChopping(w); } };
const lastAck = (w) => [...w.events].reverse().find((ev) => ev.type === 'resource');
const of = (w, type) => w.events.filter((ev) => ev.type === type);
const chop = (w, e = 1, node = 'palm-1') => { resourceCmd(w, e, { type: 'resource', op: 'chop', node }); return lastAck(w); };
const crit = (w, e = 1) => resourceCmd(w, e, { type: 'resource', op: 'crit' });
const view = (w, id = 'palm-1') => publicResources(w).nodes.find((n) => n.id === id);
const send = (w, e, msg) => { resourceCmd(w, e, { type: 'resource', ...msg }); return lastAck(w); };
// Chop on every tick it is allowed until the palm falls; returns the tick the fall event was seen.
function chopDown(w, e = 1, id = 'palm-1') {
  const node = w.resources.nodes.get(id);
  while (node.readyTick <= w.tick) { chop(w, e, id); tickTo(w, w.tick + 1); }
}

test('chop is off by default: chop, crit, pickup and the new recipes are refused schema and the snapshot is unchanged', () => {
  const w = fixture({ chop: false });
  assert.deepEqual([chop(w).why, chop(w).ok], ['schema', false]);
  assert.equal(crit(w), false); assert.equal(lastAck(w).why, 'schema');
  assert.equal(send(w, 1, { op: 'pickup', pile: 'pile-1', expectedRev: 1, opId: 'p' }).why, 'schema');
  assert.equal(send(w, 1, { op: 'craft', recipe: 'hacha_hierro', expectedRev: 0, opId: 'c' }).why, 'schema');
  const pub = publicResources(w);
  assert.equal('chop' in pub, false); assert.equal('piles' in pub, false);
  assert.deepEqual(Object.keys(view(w)).sort(), ['hits', 'id', 'kind', 'propIndex', 'ready', 'remaining', 'rev', 'rot', 'scale', 'wait', 'x', 'y', 'z']);
  assert.equal(w.resources.chop, undefined);
  assert.equal(stepChopping(w), undefined);
});

test('palmSize thresholds and the data tables', () => {
  for (const [scale, size] of [[.57, 'small'], [.73, 'small'], [.74, 'medium'], [.91, 'medium'], [.92, 'large'], [1.05, 'large'],
    [NaN, 'medium'], [undefined, 'medium'], [0, 'medium'], [-1, 'medium'], [Infinity, 'medium']]) assert.equal(palmSize(scale), size, String(scale));
  assert.deepEqual([greenTicks(1, 54), greenTicks(2, 54), greenTicks(3, 54), greenTicks(3, 24), greenTicks(2, 20)], [10, 14, 18, 12, 10]);
  assert.deepEqual(Object.values(AXES).map((a) => [a.cadence, a.learned, a.damage]), [[54, 45, 1], [33, 27, 2], [24, 20, 3]]);
  assert.equal(Object.isFrozen(CHOP_RECIPES.hacha_hierro.inputs), true);
});

test('stone, iron and steel axes fell a large palm after 12, 6 and 4 landed swings and leave a 5-log pile along the fall', () => {
  for (const [axe, swings] of [[1, 12], [2, 6], [3, 4]]) {
    const w = fixture({ axe, scale: 1 }), cadence = AXES[axe].cadence;
    const first = chop(w);
    assert.equal(first.ok, true);
    assert.deepEqual([first.start, first.strike, first.cadence, first.node], [100, 100 + cadence, cadence, 'palm-1']);
    let fellTick = 0;
    for (let i = 1; i < swings; i++) { tickTo(w, 100 + i * cadence); assert.equal(chop(w).start, 100 + i * cadence); }
    while (!fellTick) { tickTo(w, w.tick + 1); if (of(w, 'chopFell').length) fellTick = w.tick; }
    assert.equal(fellTick, 100 + swings * cadence + CHOP.slack + 1, `axe ${axe} fells at the last impact`);
    const hits = of(w, 'chopHit');
    assert.equal(hits.length, swings);
    assert.equal(hits.every((h) => !h.cancelled && h.damage === AXES[axe].damage && h.crit === false), true);
    assert.equal(hits.at(-1).hp, 0);
    const fell = of(w, 'chopFell')[0];
    assert.deepEqual([fell.e, fell.node, fell.dir, fell.pile, fell.logs], [1, 'palm-1', { x: 1, z: 0 }, 'pile-1', 5]);
    assert.deepEqual(fell.practice, [{ e: 1, amount: 10 }]);
    const pile = publicResources(w).piles[0];
    assert.deepEqual(pile, { id: 'pile-1', x: 1.5, y: 2, z: 0, goods: { tronco: 5 }, rev: 1 });
    const node = w.resources.nodes.get('palm-1');
    assert.deepEqual([node.rev, node.readyTick], [2, fellTick + HARVEST.respawnTicks]);
    assert.deepEqual([view(w).hp, view(w).maxHp, view(w).size, view(w).ready], [0, 12, 'large', false]);
    assert.equal(chop(w).why, 'depleted'); assert.equal(lastAck(w).wait, HARVEST.respawnTicks * DT);
    assert.equal(publicResources(w).chop, 1);
  }
});

test('the fall direction follows the finisher and a palm grows back to full HP', () => {
  const w = fixture({ axe: 3, scale: 1 });
  w.ecs.x[1] = 0; w.ecs.z[1] = -1;
  chopDown(w);
  assert.deepEqual(of(w, 'chopFell')[0].dir, { x: 0, z: 1 });
  assert.deepEqual([publicResources(w).piles[0].x, publicResources(w).piles[0].z], [0, 1.5]);
  tickTo(w, w.resources.nodes.get('palm-1').readyTick);
  assert.deepEqual([view(w).hp, view(w).ready], [12, true]);
  assert.equal(chop(w).ok, true);
});

test('small and medium palms have 4 and 7 HP and drop 2 and 3 logs', () => {
  for (const [scale, hp, swings, logs, size] of [[.5, 4, 4, 2, 'small'], [.8, 7, 7, 3, 'medium']]) {
    const w = fixture({ scale });
    assert.deepEqual([view(w).hp, view(w).maxHp, view(w).size], [hp, hp, size]);
    chopDown(w);
    assert.equal(of(w, 'chopHit').filter((h) => !h.cancelled).length, swings); // a swing sent just before the fall is cancelled
    assert.equal(of(w, 'chopFell')[0].logs, logs);
    assert.equal(publicResources(w).piles[0].goods.tronco, logs);
  }
});

test('spacing: early is cooldown, inside the slack starts at lastStart + cadence, never two queued past it', () => {
  const w = fixture();
  assert.equal(chop(w).start, 100);
  tickTo(w, 140);
  const early = chop(w);
  assert.deepEqual([early.ok, early.why, early.wait], [false, 'cooldown', (150 - 140) * DT]);
  tickTo(w, 150);
  const queued = chop(w);
  assert.deepEqual([queued.ok, queued.start, queued.strike], [true, 154, 208]);
  assert.equal(of(w, 'chopSwing').at(-1).start, 154);
  tickTo(w, 155);
  assert.equal(chop(w).why, 'cooldown');
  tickTo(w, 203);
  assert.equal(chop(w).why, 'cooldown');
  tickTo(w, 204);
  assert.equal(chop(w).ok, true); // lastStart 154 + 54 - 4
  assert.equal(lastAck(w).start, 208);
});

test('the learned cadence (logging rank 2) is 45 for a stone axe and 27 for an iron axe', () => {
  for (const [axe, cadence] of [[1, 45], [2, 27]]) {
    const w = fixture({ axe });
    w.profiles.get(1).progression.practice.logging = 60;
    assert.equal(chop(w).cadence, cadence);
  }
  assert.equal(chop(fixture({ axe: 1 })).cadence, 54);
});

test('crit window edges and the bonus log', () => {
  const w = fixture({ scale: .5 });
  chop(w); tickTo(w, 144); assert.equal(crit(w), true); // window opens at T - green
  tickTo(w, 160);
  assert.deepEqual(of(w, 'chopHit')[0], { type: 'chopHit', e: 1, node: 'palm-1', damage: 2, crit: true, hp: 2, maxHp: 4 });
  chopDown(w);
  assert.equal(of(w, 'chopFell')[0].logs, 3); // 2 + 1 crit bonus
  const big = fixture({ scale: 1 }); // large: every swing crits, cap +3
  for (let i = 0; i < 6; i++) { tickTo(big, 100 + i * 54); chop(big); tickTo(big, 100 + i * 54 + 54 - 10); assert.equal(crit(big), true); }
  tickTo(big, 100 + 6 * 54 + 5);
  assert.equal(of(big, 'chopHit').every((h) => h.damage === 2 && h.crit), true);
  assert.equal(of(big, 'chopFell')[0].logs, 8); // 5 + min(6, 3)
  const last = fixture({ scale: .5 }); // a crit at T + slack still counts: the impact waits one tick past it
  chop(last); tickTo(last, 158); assert.equal(crit(last), true);
  tickTo(last, 160);
  assert.equal(of(last, 'chopHit')[0].damage, 2);
});

test('a crit outside the window spends the swing; a second crit for a decided swing is ignored', () => {
  const w = fixture({ scale: 1 });
  chop(w); tickTo(w, 143);
  assert.equal(crit(w), true); // too early: that swing's attempt is spent
  tickTo(w, 150); assert.equal(crit(w), false); // in the window but already decided
  tickTo(w, 160);
  assert.deepEqual(of(w, 'chopHit').map((h) => [h.damage, h.crit]), [[1, false]]);
  const v = fixture({ scale: 1 });
  chop(v); tickTo(v, 150); assert.equal(crit(v), true); tickTo(v, 152); assert.equal(crit(v), false);
  const acks = of(v, 'resource').length;
  tickTo(v, 159);
  assert.deepEqual(of(v, 'chopHit').map((h) => [h.damage, h.crit]), [[2, true]]);
  assert.equal(crit(v), false); // nothing in flight: silently ignored
  assert.equal(of(v, 'resource').length, acks);
  assert.equal(crit(fixture()), false);
});

test('moving between the start and the strike cancels the swing and leaves the HP unchanged', () => {
  const w = fixture();
  chop(w); tickTo(w, 120);
  w.ecs.moveMag[1] = 1; tickTo(w, 121); w.ecs.moveMag[1] = 0;
  assert.deepEqual(of(w, 'chopHit'), [{ type: 'chopHit', e: 1, node: 'palm-1', damage: 0, crit: false, hp: 12, maxHp: 12, cancelled: true }]);
  tickTo(w, 200);
  assert.equal(of(w, 'chopHit').length, 1);
  assert.equal(view(w).hp, 12);
  const far = fixture(); chop(far); far.ecs.x[1] = -5; tickTo(far, 101);
  assert.equal(of(far, 'chopHit')[0].cancelled, true);
  const dead = fixture(); chop(dead); dead.ecs.dead[1] = 1; tickTo(dead, 101);
  assert.equal(of(dead, 'chopHit')[0].cancelled, true);
});

test('chop refusals: dead, busy, land, combat, tool, node, far, depleted', () => {
  const why = (mutate, node = 'palm-1', axe = 1) => { const w = fixture({ axe }); mutate(w); return chop(w, 1, node).why; };
  assert.equal(why((w) => { w.ecs.dead[1] = 1; }), 'dead');
  assert.equal(why((w) => { w.ecs.moveMag[1] = 1; }), 'busy');
  assert.equal(why((w) => { w.map.groundAt = () => 0.1; }), 'land');
  assert.equal(why((w) => { w.navalPilot = { aboard: () => true }; }), 'land');
  assert.equal(why((w) => { w.ecs.regenT[1] = 0; }), 'combat');
  assert.equal(why(() => {}, 'palm-1', 0), 'tool');
  assert.equal(why(() => {}, 'palm-9'), 'node');
  assert.equal(why(() => {}, 'stone-1'), 'node');
  assert.equal(why((w) => { w.ecs.x[1] = -3; }), 'far');
  assert.equal(why((w) => { w.ecs.y[1] = 4; w.map.groundAt = () => 4; }), 'far');
  assert.equal(why((w) => { w.resources.nodes.get('palm-1').readyTick = 500; }), 'depleted');
  const w = fixture();
  for (const bad of [{ op: 'chop' }, { op: 'chop', node: '' }, { op: 'chop', node: 'x'.repeat(41) }, { op: 'chop', node: 'palm-1', extra: 1 }, { op: 'chop', node: 'palm-1', opId: 'a' }, { op: 'crit', node: 'palm-1' }])
    assert.equal(send(w, 1, bad).why, 'schema', JSON.stringify(bad));
  assert.equal(send(w, 1, { t: 'cmd', op: 'chop', node: 'palm-1' }).ok, true);
});

test('partial damage heals to full after 1800 ticks without a swing, and the crits are forgotten', () => {
  const w = fixture({ scale: 1 });
  chop(w); tickTo(w, 150); crit(w);
  tickTo(w, 159);
  assert.deepEqual([view(w).hp, w.resources.chop.palms.get('palm-1').crits], [10, 1]);
  tickTo(w, 159 + CHOP.healTicks - 1);
  assert.equal(view(w).hp, 10);
  tickTo(w, 159 + CHOP.healTicks);
  assert.deepEqual([view(w).hp, w.resources.chop.palms.get('palm-1').crits, w.resources.chop.palms.get('palm-1').damage.size], [12, 0, 0]);
  assert.equal(w.resources.chop.damaged.size, 0);
});

test('with chop on the palm gather is refused chopMode while rocks and stones still gather', () => {
  const w = fixture();
  const palm = send(w, 1, { op: 'gather', node: 'palm-1', expectedRev: 1, opId: 'g1' });
  assert.deepEqual([palm.ok, palm.why, palm.rev], [false, 'chopMode', 1]);
  w.ecs.x[1] = 5;
  const stone = send(w, 1, { op: 'gather', node: 'stone-1', expectedRev: 1, opId: 'g2' });
  assert.deepEqual([stone.ok, stone.good], [true, 'piedra']);
  const off = fixture({ chop: false });
  assert.equal(send(off, 1, { op: 'gather', node: 'palm-1', expectedRev: 1, opId: 'g3' }).ok, true);
});

test('iron and steel axes are bench recipes: tiers are set once and never go down', () => {
  const w = fixture({ cap: 100 }), pack = w.profiles.get(1).eco.pack;
  const craft = (recipe, opId) => (w.tick += HARVEST.actionTicks, send(w, 1, { op: 'craft', recipe, expectedRev: w.profiles.get(1).eco.tradeRev, opId }));
  Object.assign(pack.goods, { madera: 5, mineral_hierro: 3, hierro: 4, tronco: 3, piedra: 2 });
  assert.equal(CHOP_RECIPES.hacha_hierro.hand, undefined);
  w.ecs.x[1] = 20; w.ecs.z[1] = 20;
  assert.equal(craft('hacha_hierro', 'c0').why, 'far');
  w.ecs.x[1] = 0; w.ecs.z[1] = 0;
  const iron = craft('hacha_hierro', 'c1');
  assert.deepEqual([iron.ok, iron.tool, iron.tier], [true, 'axe', 2]);
  assert.equal(w.profiles.get(1).tools.axe, 2);
  assert.deepEqual(w.profiles.get(1).eco.pack.goods, { madera: 3, hierro: 4, tronco: 3, piedra: 2 });
  assert.equal(craft('hacha_hierro', 'c2').why, 'alreadyOwned');
  assert.equal(craft('hacha_piedra', 'c3').why, 'alreadyOwned');
  const steel = craft('hacha_acero', 'c4');
  assert.deepEqual([steel.ok, steel.tier], [true, 3]);
  assert.equal(w.profiles.get(1).tools.axe, 3);
  assert.equal(craft('hacha_hierro', 'c5').why, 'alreadyOwned');
  assert.equal(send(w, 1, { op: 'craft', recipe: 'hacha_acero', expectedRev: w.profiles.get(1).eco.tradeRev, n: 2, opId: 'c6' }).why, 'schema');
});

test('sanitizeTools keeps the axe at 0..3 and the pickaxe at 1 only', () => {
  for (const [raw, out] of [[{ axe: 0, pickaxe: 0 }, { axe: 0, pickaxe: 0 }], [{ axe: 1, pickaxe: 1 }, { axe: 1, pickaxe: 1 }],
    [{ axe: 2, pickaxe: 0 }, { axe: 2, pickaxe: 0 }], [{ axe: 3, pickaxe: 1 }, { axe: 3, pickaxe: 1 }],
    [{ axe: 4, pickaxe: 2 }, { axe: 0, pickaxe: 0 }], [{ axe: -1, pickaxe: 3 }, { axe: 0, pickaxe: 0 }],
    [{ axe: 1.5, pickaxe: '1' }, { axe: 0, pickaxe: 0 }], [{ axe: '2' }, { axe: 0, pickaxe: 0 }],
    [null, { axe: 0, pickaxe: 0 }], [[], { axe: 0, pickaxe: 0 }]]) assert.deepEqual(sanitizeTools(raw), out, JSON.stringify(raw));
});

function felled(opts = {}) {
  const w = fixture({ scale: .5, ...opts });
  chopDown(w, 1);
  return w;
}
const standAt = (w, e, x, z) => { w.ecs.x[e] = x; w.ecs.z[e] = z; };
const pickup = (w, pile, expectedRev, opId, e = 1) => send(w, e, { op: 'pickup', pile, expectedRev, opId });

test('pickup loads the pile by walking over it, replays by opId and removes an empty pile', () => {
  const w = felled(), profile = w.profiles.get(1);
  const far = pickup(w, 'pile-1', 1, 'p0');
  assert.deepEqual([far.ok, far.why, far.rev], [false, 'far', 1]);
  standAt(w, 1, 1.4, 0);
  w.ecs.moveMag[1] = 1; // allowed while moving
  const rev = profile.eco.tradeRev;
  const ack = pickup(w, 'pile-1', 1, 'p1');
  assert.deepEqual([ack.ok, ack.pile, ack.goods, ack.count, ack.left, ack.profileRev], [true, 'pile-1', { tronco: 2 }, 2, 0, rev + 1]);
  assert.equal(profile.eco.pack.goods.tronco, 2);
  assert.equal(publicResources(w).piles.length, 0);
  assert.deepEqual(of(w, 'pilePickup'), [{ type: 'pilePickup', e: 1, pile: 'pile-1', goods: { tronco: 2 }, count: 2, left: 0 }]);
  assert.equal(w.profileDirty.has(1), true);
  const replay = pickup(w, 'pile-1', 1, 'p1');
  assert.deepEqual(replay, ack);
  assert.equal(profile.eco.pack.goods.tronco, 2);
  assert.equal(of(w, 'pilePickup').length, 1);
  assert.equal(pickup(w, 'pile-1', 1, 'p2').why, 'pile');
  assert.equal(send(w, 1, { op: 'pickup', pile: 'pile-1', expectedRev: 1, opId: 'p1', extra: 1 }).why, 'schema');
  assert.equal(send(w, 1, { op: 'pickup', pile: 'pile-x', expectedRev: 1, opId: 'p3' }).why, 'schema');
});

test('a nearly full pack takes part of a pile (rev + 1), then reports full', () => {
  const w = felled({ scale: 1, axe: 3, cap: 10, players: 2 }), profile = w.profiles.get(1);
  standAt(w, 1, 1.4, 0);
  assert.equal(pickup(w, 'pile-1', 2, 'q0').why, 'revision'); assert.equal(lastAck(w).rev, 1);
  const part = pickup(w, 'pile-1', 1, 'q1'); // tronco is 3 volume each, room for 3 of 5
  assert.deepEqual([part.ok, part.goods, part.count, part.left, part.rev], [true, { tronco: 3 }, 3, 2, 2]);
  assert.deepEqual(publicResources(w).piles[0], { id: 'pile-1', x: 1.5, y: 2, z: 0, goods: { tronco: 2 }, rev: 2 });
  assert.equal(profile.eco.pack.goods.tronco, 3);
  const full = pickup(w, 'pile-1', 2, 'q2');
  assert.deepEqual([full.ok, full.why, full.rev], [false, 'full', 2]);
  assert.equal(publicResources(w).piles[0].goods.tronco, 2);
  const other = pickup(w, 'pile-1', 2, 'q3', 2); // anyone may pick up any pile
  assert.equal(other.why, 'far'); standAt(w, 2, 1.5, 0);
  assert.deepEqual([pickup(w, 'pile-1', 2, 'q4', 2).ok, w.profiles.get(2).eco.pack.goods.tronco], [true, 2]);
  assert.equal(publicResources(w).piles.length, 0);
  assert.equal(pickup(w, 'pile-1', 2, 'q5').why, 'pile');
  w.ecs.dead[1] = 1; assert.equal(pickup(w, 'pile-1', 1, 'q6').why, 'dead');
});

test('harvest loot rides on the pile and loads after the logs', () => {
  const id = Array.from({ length: 200 }, (_, i) => `palm-${i + 1}`).find((n) => Object.keys(harvestLoot('palm', n, 2)).length);
  const w = fixture({ scale: .5, palms: 0, cap: 40 });
  w.harvestLootEnabled = true;
  w.resources.nodes.set(id, { id, kind: 'palm', x: 0, y: 2, z: 0, propIndex: 1, scale: .5, rot: 0, rev: 1, readyTick: 0, hits: 0 });
  chopDown(w, 1, id);
  const goods = publicResources(w).piles[0].goods, loot = harvestLoot('palm', id, 2);
  assert.deepEqual(goods, { tronco: 2, ...loot });
  assert.equal(Object.keys(goods)[0], 'tronco');
  standAt(w, 1, 1.4, 0);
  const ack = pickup(w, 'pile-1', 1, 'l1');
  assert.deepEqual(ack.goods, goods);
  assert.equal(Object.keys(ack.goods).every((g) => GOODS[g]), true);
});

test('piles expire after 18000 ticks and at most 48 piles exist, the oldest going first', () => {
  const w = felled({ cap: 40 });
  const expires = w.resources.chop.piles.get('pile-1').expiresTick;
  assert.equal(expires, w.tick + CHOP.pileTicks);
  tickTo(w, expires - 1); assert.equal(publicResources(w).piles.length, 1);
  tickTo(w, expires); assert.equal(publicResources(w).piles.length, 0);
  const many = fixture({ scale: .5, axe: 3, palms: 49 });
  for (let i = 1; i <= 49; i++) chopDown(many, 1, `palm-${i}`);
  const piles = publicResources(many).piles;
  assert.equal(piles.length, CHOP.maxPiles);
  assert.equal(many.resources.chop.pileSeq, 49);
  assert.equal(many.resources.chop.piles.has('pile-1'), false);
  assert.equal(many.resources.chop.piles.keys().next().value, 'pile-2');
  assert.deepEqual(piles.map((p) => p.id), [...piles.map((p) => p.id)].sort());
});

test('felling practice is split by damage with largest remainder and always sums to 10', () => {
  const run = (axes, swings, scale = 1) => {
    const w = fixture({ players: axes.length, axe: axes, scale });
    const left = swings.slice();
    while (w.resources.nodes.get('palm-1').readyTick <= w.tick) {
      for (let e = 1; e <= axes.length; e++) if (left[e - 1] > 0 && chop(w, e).ok) left[e - 1]--;
      tickTo(w, w.tick + 1);
    }
    return of(w, 'chopFell')[0].practice;
  };
  const two = run([1, 2], [4, 4]); // 4 and 8 damage of 12
  assert.deepEqual(two, [{ e: 1, amount: 3 }, { e: 2, amount: 7 }]);
  assert.equal(two.reduce((n, p) => n + p.amount, 0), 10);
  const tie = run([1, 1, 1], [4, 4, 4]); // 3.33 each: the extra unit goes to the lowest entity
  assert.deepEqual(tie, [{ e: 1, amount: 4 }, { e: 2, amount: 3 }, { e: 3, amount: 3 }]);
  const even = run([1, 1], [6, 6]);
  assert.deepEqual(even, [{ e: 1, amount: 5 }, { e: 2, amount: 5 }]);
});

test('swings still in flight when the palm falls are cancelled, and only the HP actually removed counts for practice', () => {
  const w = fixture({ players: 2, scale: .5, axe: 3 }); // small palm: 4 HP, steel hits for 3
  chop(w, 1); tickTo(w, 110); chop(w, 2); tickTo(w, 124); assert.equal(chop(w, 1).start, 124);
  tickTo(w, 145);
  assert.deepEqual(of(w, 'chopHit').map((h) => [h.e, h.damage, h.hp, !!h.cancelled]), [[1, 3, 1, false], [2, 3, 0, false], [1, 0, 0, true]]);
  assert.deepEqual(of(w, 'chopFell')[0].practice, [{ e: 1, amount: 8 }, { e: 2, amount: 2 }]); // 3 and 1 HP: a tie on the remainder goes to the lower id
});

test('clearResourceReceipts forgets the chop state of a player', () => {
  const v = fixture(); chop(v); clearResourceReceipts(v, 1);
  assert.equal(v.resources.chop.players.has(1), false);
  tickTo(v, 200); assert.equal(of(v, 'chopHit').length, 0);
  assert.equal(chop(v).start, 200);
});

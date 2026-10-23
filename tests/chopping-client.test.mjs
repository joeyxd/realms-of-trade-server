// TA03: the hold-to-chop controller (src/ui/chopping.js) against a fake client and clock; no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChopController, axeTier, chopCadence, chopGreen, pickupMessage } from '../src/ui/chopping.js';
import { greenTicks } from '../src/data/chopping.js';
import { newProgression } from '../src/sim/systems/progression.js';

const TICK = 1000 / 60;

function rig({ chop = 1, tier = 1, practice = 0, nodes, piles = [] } = {}) {
  const progression = newProgression();
  progression.practice.logging = practice;
  const profile = { tools: { axe: tier, pickaxe: 0 }, progression };
  const client = { joined: true, youServer: 7, resources: { chop,
    nodes: nodes ?? [{ id: 'palm-1', kind: 'palm', x: 0, y: 0, z: 1, rev: 1, ready: true, hp: 7, maxHp: 7, size: 'medium' }], piles } };
  const ps = { x: 0, y: 0, z: 0, vx: 0, vz: 0, mag: 0, dead: 0, swim: 0, dashT: -1, atkStage: 0, castK: 0 };
  const state = { time: 0, held: true, sent: [], accept: true, swings: [], picked: [], full: [], refused: [], n: 0 };
  const ctl = new ChopController({ client: () => client, profile: () => profile, player: () => ps, now: () => state.time,
    send: (cmd) => { state.sent.push(cmd); return state.accept; }, held: () => state.held, opId: () => `op-${++state.n}`,
    onSwing: (s) => state.swings.push(s), onPickup: (a) => state.picked.push(a), onPackFull: (id) => state.full.push(id),
    onRefuse: (why) => state.refused.push(why) });
  const run = (ticks) => { for (let i = 0; i < ticks; i++) { state.time += TICK; ctl.update(); } };
  const ops = (op) => state.sent.filter((c) => c.op === op);
  return { ctl, client, ps, state, profile, run, ops };
}

test('cadence comes from the tier and the learned logging rank', () => {
  const table = [[1, 54, 45], [2, 33, 27], [3, 24, 20]];
  for (const [tier, base, learned] of table) {
    assert.equal(chopCadence(rig({ tier, practice: 0 }).profile), base, `tier ${tier}`);
    assert.equal(chopCadence(rig({ tier, practice: 60 }).profile), learned, `tier ${tier} learned`);
  }
  assert.equal(axeTier({ tools: { axe: 3 } }), 3);
  assert.equal(chopCadence({ tools: { axe: 0 } }), 0);
});

test('the green window is the last greenTicks(rank, cadence) ticks of the swing', () => {
  for (const [practice, rank] of [[0, 1], [60, 2], [180, 3]]) {
    for (const tier of [1, 2, 3]) {
      const { profile } = rig({ tier, practice }), cadence = chopCadence(profile);
      assert.equal(chopGreen(profile, cadence), greenTicks(rank, cadence), `rank ${rank} tier ${tier}`);
    }
  }
  const r = rig({ tier: 1, practice: 0 }); // stone 54, green 10
  r.run(1);
  const bar = r.ctl.bar();
  assert.ok(Math.abs(bar.green - 10 / 54) < 1e-9);
  assert.equal(bar.inGreen, false);
  r.run(43); // 43 ticks after the send
  assert.equal(r.ctl.bar().inGreen, false);
  r.run(1); // 44 ticks after the send: green opens at 54 - 10 = 44
  assert.equal(r.ctl.bar().inGreen, true);
});

test('holding sends exactly one chop per local swing, the next only after the cadence', () => {
  const r = rig({ tier: 1 });
  r.run(1);
  assert.equal(r.ops('chop').length, 1);
  assert.deepEqual(r.ops('chop')[0], { t: 'cmd', type: 'resource', op: 'chop', node: 'palm-1' });
  r.run(52); // 53 ticks since the send
  assert.equal(r.ops('chop').length, 1);
  r.run(2);
  assert.equal(r.ops('chop').length, 2);
  r.run(54);
  assert.equal(r.ops('chop').length, 3);
  // Iron axe: a swing every 33 ticks.
  const q = rig({ tier: 2 });
  q.run(1 + 33 * 2 + 1);
  assert.equal(q.ops('chop').length, 3);
});

test('an ack with another cadence replaces the local one and starts the pose', () => {
  const r = rig({ tier: 1 });
  r.run(1);
  r.ctl.onResult({ type: 'resource', op: 'chop', ok: true, node: 'palm-1', start: 10, cadence: 40, strike: 50 });
  assert.deepEqual(r.state.swings, [{ node: 'palm-1', cadence: 40, tier: 1 }]);
  r.run(41);
  assert.equal(r.ops('chop').length, 2, 'the next swing waits for 40 ticks, not 54');
});

test('release, moving and leaving range stop the loop', () => {
  const r = rig({ tier: 2 });
  r.run(1);
  r.state.held = false;
  r.run(100);
  assert.equal(r.ops('chop').length, 1, 'release');
  assert.equal(r.ctl.bar(), null, 'the swing ends on its own');
  r.state.held = true; r.ps.mag = 0.5;
  r.run(10);
  assert.equal(r.ops('chop').length, 1, 'moving');
  r.ps.mag = 0; r.ps.x = 4;
  r.run(10);
  assert.equal(r.ops('chop').length, 1, 'out of range');
  r.ps.x = 0; r.ps.y = 3;
  r.run(10);
  assert.equal(r.ops('chop').length, 1, 'too far above');
  r.ps.y = 0;
  r.run(3);
  assert.equal(r.ops('chop').length, 2, 'back in range');
});

test('moving mid-swing cancels the local swing', () => {
  const r = rig({ tier: 1 });
  r.run(5);
  assert.ok(r.ctl.bar());
  r.ps.vx = 1;
  r.run(1);
  assert.equal(r.ctl.bar(), null);
});

test('a standing palm in reach is needed, the nearest one wins and a felled one is skipped', () => {
  const nodes = [
    { id: 'far', kind: 'palm', x: 2, y: 0, z: 0, rev: 1, ready: true, hp: 4 },
    { id: 'near', kind: 'palm', x: 0, y: 0, z: 1, rev: 1, ready: true, hp: 4 },
    { id: 'down', kind: 'palm', x: 0.2, y: 0, z: 0.2, rev: 1, ready: false, hp: 0 },
    { id: 'rock', kind: 'rock', x: 0.1, y: 0, z: 0.1, rev: 1, ready: true },
  ];
  const r = rig({ nodes });
  r.run(1);
  assert.equal(r.ops('chop')[0].node, 'near');
  r.ctl.onFell({ node: 'near' });
  assert.equal(r.ctl.target, null);
  r.run(5);
  assert.equal(r.ops('chop')[1].node, 'far', 'the felled palm is skipped until its revision changes');
  assert.equal(r.ops('chop').length, 2);
});

test('crit is sent at most once per swing and only while a swing runs', () => {
  const r = rig({ tier: 1 });
  assert.equal(r.ctl.crit(), false, 'no swing: the key stays free for the skill slot');
  assert.equal(r.ops('crit').length, 0);
  r.run(1);
  r.run(44);
  assert.equal(r.ctl.crit(), true);
  assert.equal(r.ctl.crit(), true, 'a second press is swallowed');
  assert.equal(r.ops('crit').length, 1);
  assert.deepEqual(r.ops('crit')[0], { t: 'cmd', type: 'resource', op: 'crit' });
  assert.equal(r.ctl.bar().crit, 'hit');
  r.run(12);
  r.run(1);
  assert.equal(r.ops('chop').length, 2);
  r.run(10);
  assert.equal(r.ctl.crit(), true, 'the new swing has its own attempt');
  assert.equal(r.ops('crit').length, 2);
  assert.equal(r.ctl.bar().crit, 'miss', 'outside the green');
});

test('a cooldown refusal retries after each wait while held; a second busy refusal stops the loop', () => {
  const r = rig({ tier: 1 });
  r.run(1);
  r.ctl.onResult({ type: 'resource', op: 'chop', ok: false, why: 'cooldown', wait: 0.5 });
  r.run(29); // 29 of the 30 ticks of the wait
  assert.equal(r.ops('chop').length, 1);
  r.run(2);
  assert.equal(r.ops('chop').length, 2, 'one retry');
  r.ctl.onResult({ type: 'resource', op: 'chop', ok: false, why: 'cooldown', wait: 0.5 });
  r.run(29);
  assert.equal(r.ops('chop').length, 2, 'never before the wait');
  r.run(2);
  assert.equal(r.ops('chop').length, 3, 'drift or jitter never breaks the hold');
  r.ctl.onResult({ type: 'resource', op: 'chop', ok: false, why: 'busy', wait: 0 });
  r.run(10);
  assert.equal(r.ops('chop').length, 4, 'busy retries once');
  r.ctl.onResult({ type: 'resource', op: 'chop', ok: false, why: 'busy', wait: 0 });
  r.run(120);
  assert.equal(r.ops('chop').length, 4, 'the second busy refusal stops the loop');
  r.state.held = false; r.run(1); r.state.held = true;
  r.run(1);
  assert.equal(r.ops('chop').length, 5, 'a new press starts again');
});

test('another refusal stops the loop and says why', () => {
  const r = rig({ tier: 1 });
  r.run(1);
  r.ctl.onResult({ type: 'resource', op: 'chop', ok: false, why: 'combat' });
  r.run(200);
  assert.equal(r.ops('chop').length, 1);
  assert.deepEqual(r.state.refused, ['combat']);
});

test('no axe, no chop', () => {
  const r = rig({ tier: 0 });
  r.run(30);
  assert.equal(r.ops('chop').length, 0);
});

test('pickup is sent once per pile and revision within 1.6 m, never beyond', () => {
  const pile = { id: 'pile-3', x: 1.2, y: 0, z: 0, goods: { tronco: 3 }, rev: 1 };
  const r = rig({ piles: [pile] });
  r.state.held = false;
  r.run(10);
  assert.equal(r.ops('pickup').length, 1);
  assert.deepEqual(r.ops('pickup')[0], { t: 'cmd', type: 'resource', op: 'pickup', pile: 'pile-3', expectedRev: 1, opId: 'op-1' });
  r.run(100); // 1.7 s: still waiting, no resend yet
  assert.equal(r.ops('pickup').length, 1);
  r.run(30); // past 2 s without an answer
  assert.equal(r.ops('pickup').length, 2);
  assert.equal(r.ops('pickup')[1].opId, 'op-2');
  r.ctl.onResult({ type: 'resource', op: 'pickup', opId: 'op-2', ok: true, pile: 'pile-3', goods: { tronco: 2 }, count: 2, left: 1 });
  assert.equal(r.state.picked.length, 1);
  r.run(300);
  assert.equal(r.ops('pickup').length, 2, 'answered: not sent again for the same revision');
  pile.rev = 2;
  r.run(1);
  assert.equal(r.ops('pickup').length, 3, 'the revision changed');
  assert.equal(r.ops('pickup')[2].expectedRev, 2);
  const far = rig({ piles: [{ id: 'pile-9', x: 1.7, y: 0, z: 0, goods: { tronco: 1 }, rev: 1 }] });
  far.run(60);
  assert.equal(far.ops('pickup').length, 0, 'outside 1.6 m');
});

test('a full pack toasts once per pile revision and no pickup while dead or aboard', () => {
  const pile = { id: 'pile-4', x: 0.5, y: 0, z: 0, goods: { tronco: 2 }, rev: 3 };
  const r = rig({ piles: [pile] });
  r.run(1);
  const id = r.ops('pickup')[0].opId;
  r.ctl.onResult({ type: 'resource', op: 'pickup', opId: id, ok: false, why: 'full' });
  r.ctl.onResult({ type: 'resource', op: 'pickup', opId: id, ok: false, why: 'full' });
  assert.deepEqual(r.state.full, ['pile-4']);
  const dead = rig({ piles: [pile] });
  dead.ps.dead = 1;
  dead.run(10);
  assert.equal(dead.ops('pickup').length, 0);
  const boat = rig({ piles: [pile] });
  boat.client.naval = { active: true };
  boat.ctl.aboard = () => true;
  boat.run(10);
  assert.equal(boat.ops('pickup').length, 0);
});

test('nothing is sent when chop mode is off', () => {
  const r = rig({ chop: 0, piles: [{ id: 'pile-1', x: 0.2, y: 0, z: 0, goods: { tronco: 1 }, rev: 1 }] });
  r.run(120);
  assert.equal(r.state.sent.length, 0);
  assert.equal(r.ctl.crit(), false);
  assert.equal(r.ctl.bar(), null);
});

test('the pickup message names the goods', () => {
  const html = pickupMessage({ tronco: 3, resina: 1 });
  assert.match(html, /3/);
  assert.match(html, /1/);
  assert.equal(pickupMessage({}), '');
});

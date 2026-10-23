import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillControls } from '../src/ui/skillControls.js';

const profile = (rev = 0) => ({ lvl: 3, gold: 200, eco: { tradeRev: rev, pack: { cap: 18, goods: {} } } });
function rig(p = profile(), { enabled = true } = {}) {
  let time = 0, ids = 0, changes = 0;
  const sent = [];
  const ui = new SkillControls({ profile: () => p, enabled: () => enabled, submit: (x) => sent.push(x), onChange: () => changes++,
    now: () => time, id: () => `op-${++ids}` });
  return { ui, p, sent, setTime: (n) => { time = n; }, changes: () => changes };
}
const ack = (cmd, extra = {}) => ({ type: 'skills', op: cmd.op, opId: cmd.opId, ok: true, why: '', rev: cmd.expectedRev + 1, ...extra });
const denial = (cmd, why, extra = {}) => ({ type: 'skills', op: cmd.op, opId: cmd.opId, ok: false, why, rev: 0, ...extra });

test('assign and reset send exactly the server command shape with the profile revision', () => {
  const r = rig(profile(7));
  assert.equal(r.ui.act('assign', { tree: 'combat', node: 'lunge' }), true);
  assert.deepEqual(r.sent[0], { type: 'skills', op: 'assign', opId: 'op-1', expectedRev: 7, tree: 'combat', node: 'lunge' });
  assert.equal(Object.isFrozen(r.sent[0]), true);
  const other = rig(profile(2));
  assert.equal(other.ui.act('reset', { tree: 'sailing', node: 'ignored' }), true);
  assert.deepEqual(other.sent[0], { type: 'skills', op: 'reset', opId: 'op-1', expectedRev: 2, tree: 'sailing' });
});

test('pending blocks a second act, shows busy and names the pending command', () => {
  const r = rig();
  assert.deepEqual(r.ui.view(), { enabled: true, busy: false, retryReady: false, statusKey: 'idle', statusWhy: '', pendingOp: null, pendingTree: null, pendingNode: null });
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  assert.equal(r.ui.act('reset', { tree: 'combat' }), false);
  assert.equal(r.ui.act('assign', { tree: 'combat', node: 'wave' }), false);
  assert.equal(r.sent.length, 1);
  assert.deepEqual(r.ui.view(), { enabled: true, busy: true, retryReady: false, statusKey: 'waiting', statusWhy: '', pendingOp: 'assign', pendingTree: 'combat', pendingNode: 'lunge' });
});

test('the flag, the profile and the arguments gate the send', () => {
  const off = rig(profile(), { enabled: false });
  assert.equal(off.ui.act('assign', { tree: 'combat', node: 'lunge' }), false);
  assert.deepEqual([off.sent.length, off.ui.statusKey, off.ui.statusWhy], [0, 'denial', 'disabled']);
  const r = rig();
  for (const args of [{}, { tree: 'exploration', node: 'lunge' }, { tree: 'combat' }, { tree: 'sailing', node: 'lunge' }, { tree: 'combat', node: 7 }]) {
    assert.equal(r.ui.act('assign', args), false);
    assert.equal(r.ui.statusWhy, 'command');
  }
  assert.equal(r.ui.act('reset', { tree: 'nowhere' }), false);
  assert.equal(r.ui.act('adopt', { tree: 'combat' }), false);
  const bad = rig({ lvl: 3 });
  assert.equal(bad.ui.act('reset', { tree: 'combat' }), false);
  assert.equal(bad.ui.statusWhy, 'profile');
  const negative = rig(profile(-1));
  assert.equal(negative.ui.act('reset', { tree: 'combat' }), false);
  assert.equal(r.sent.length + bad.sent.length + negative.sent.length, 0);
});

test('onResult rejects a wrong shape, wrong opId, wrong op, extra keys, a wrong type and a wrong revision', () => {
  const r = rig();
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  const cmd = r.sent[0];
  const bad = [
    { ...ack(cmd), opId: 'foreign' }, { ...ack(cmd), op: 'reset' }, { ...ack(cmd), type: 'attributes' },
    { ...ack(cmd), extra: true }, { ...ack(cmd), points: { earned: 1 } }, { ...ack(cmd), rev: 5 }, { ...ack(cmd), why: 'tier' },
    { ...ack(cmd), to: 'x' }, { ...ack(cmd), durable: 'yes' }, { ...ack(cmd), ok: 'true' }, { ...ack(cmd), rev: 1.5 },
    { ...denial(cmd, 'points'), rev: -1 }, { ...denial(cmd, 'points'), why: 7 }, { type: 'skills', op: 'assign', opId: cmd.opId, ok: true, rev: 1 },
    null, 'ack', [], Object.assign(Object.create({ ok: true }), ack(cmd)),
  ];
  for (const event of bad) assert.equal(r.ui.onResult(event), false, JSON.stringify(event));
  assert.ok(r.ui.pending);
  assert.equal(r.ui.pending.ack, null);
  assert.equal(r.ui.statusKey, 'waiting');
  // Nothing pending: every ack is ignored.
  const idle = rig();
  assert.equal(idle.ui.onResult(ack(cmd)), false);
});

test('an ok ack keeps pending until the profile reaches rev + 1, then reports synced', () => {
  const r = rig(profile(4));
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  const cmd = r.sent[0];
  assert.equal(r.ui.onResult(ack(cmd, { to: 9, durable: true, replay: false, historical: false })), true);
  assert.ok(r.ui.pending);
  assert.equal(r.ui.view().busy, true);
  r.ui.update();
  assert.ok(r.ui.pending, 'the profile is still at rev 4');
  r.p.eco.tradeRev = 5;
  r.ui.update();
  assert.equal(r.ui.pending, null);
  assert.deepEqual([r.ui.statusKey, r.ui.statusWhy, r.ui.view().busy], ['synced', '', false]);
});

test('the profile may arrive before the ack and a later profile also resolves it', () => {
  const early = rig(profile(1));
  early.ui.act('reset', { tree: 'combat' });
  early.p.eco.tradeRev = 2;
  early.ui.update();
  assert.ok(early.ui.pending, 'no ack yet');
  assert.equal(early.ui.onResult(ack(early.sent[0], { durable: true })), true);
  assert.equal(early.ui.pending, null);
  assert.equal(early.ui.statusKey, 'synced');
  const late = rig(profile(1));
  late.ui.act('reset', { tree: 'combat' });
  late.ui.onResult(ack(late.sent[0], { durable: true, replay: true, historical: true }));
  late.p.eco.tradeRev = 9;
  late.ui.update();
  assert.equal(late.ui.pending, null);
});

test('a session-only or unlabeled ok ack never claims a durable save', () => {
  const r = rig();
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  assert.equal(r.ui.onResult(ack(r.sent[0], { durable: false })), true);
  r.p.eco.tradeRev = 1;
  r.ui.update();
  assert.equal(r.ui.statusKey, 'sessionOnly');
  const plainAck = rig();
  plainAck.ui.act('assign', { tree: 'combat', node: 'lunge' });
  assert.equal(plainAck.ui.onResult(ack(plainAck.sent[0])), true);
  plainAck.p.eco.tradeRev = 1;
  plainAck.ui.update();
  assert.equal(plainAck.ui.statusKey, 'sessionOnly');
});

test('a denial clears pending, keeps the code and accepts rev 0 whatever the expected revision was', () => {
  const r = rig(profile(6));
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  assert.equal(r.ui.onResult(denial(r.sent[0], 'points', { to: 3 })), true);
  assert.equal(r.ui.pending, null);
  assert.deepEqual([r.ui.statusKey, r.ui.statusWhy], ['denial', 'points']);
  assert.equal(r.ui.view().busy, false);
  // A new act is possible and replaces the denial with waiting.
  assert.equal(r.ui.act('reset', { tree: 'combat' }), true);
  assert.deepEqual([r.ui.statusKey, r.ui.statusWhy], ['waiting', '']);
  assert.equal(r.ui.onResult(denial(r.sent[1], 'conflict', { rev: 6 })), true);
  assert.equal(r.ui.statusWhy, 'conflict');
});

test('retry resends the identical command only after five seconds and only while enabled', () => {
  let enabled = true;
  const r = rig();
  r.ui.enabled = () => enabled;
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  const cmd = r.sent[0];
  assert.equal(r.ui.retry(), false);
  r.setTime(4999);
  assert.equal(r.ui.retry(), false);
  r.setTime(5000);
  enabled = false;
  assert.equal(r.ui.retry(), false);
  enabled = true;
  assert.equal(r.ui.retry(), true);
  assert.equal(r.sent[1], cmd);
  assert.equal(r.ui.retry(), false, 'the five seconds restart after a resend');
  r.setTime(10000);
  assert.equal(r.ui.act('retry'), true);
  assert.equal(r.sent.length, 3);
  assert.equal(rig().ui.retry(), false);
});

test('a throwing submit keeps the command pending for the retry', () => {
  let time = 0;
  const ui = new SkillControls({ profile: () => profile(), enabled: true, submit: () => { throw new Error('closed'); }, now: () => time, id: () => 'x' });
  assert.equal(ui.act('reset', { tree: 'combat' }), true);
  assert.equal(ui.view().busy, true);
  time = 5001;
  assert.equal(ui.retry(), true);
});

test('resetSession clears pending and the status, and idle updates do not refresh repeatedly', () => {
  const r = rig();
  r.ui.update();
  const before = r.changes();
  for (let i = 0; i < 10; i++) r.ui.update();
  assert.equal(r.changes(), before);
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  assert.ok(r.changes() > before);
  r.ui.onResult(denial(r.sent[0], 'gate'));
  r.ui.resetSession();
  assert.deepEqual(r.ui.view(), { enabled: true, busy: false, retryReady: false, statusKey: 'idle', statusWhy: '', pendingOp: null, pendingTree: null, pendingNode: null });
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  r.ui.resetSession();
  assert.equal(r.ui.pending, null);
});

test('a throwing profile or enabled getter fails closed', () => {
  const ui = new SkillControls({ profile: () => { throw new Error('no profile'); }, enabled: () => { throw new Error('no flag'); }, submit() {}, now: () => 0 });
  assert.equal(ui.act('assign', { tree: 'combat', node: 'lunge' }), false);
  assert.equal(ui.view().enabled, false);
  assert.equal(ui.statusWhy, 'disabled');
});

test('view().retryReady flips after five seconds, the signature re-renders without a click, and act(retry) resends the same opId', () => {
  const r = rig();
  r.ui.act('assign', { tree: 'combat', node: 'lunge' });
  const cmd = r.sent[0];
  assert.equal(r.ui.view().retryReady, false, 'false right after act');
  r.setTime(4999);
  r.ui.update();
  assert.equal(r.ui.view().retryReady, false);
  const before = r.changes();
  r.setTime(5000);
  r.ui.update();
  assert.equal(r.ui.view().retryReady, true, 'true once the clock passes five seconds');
  assert.equal(r.changes(), before + 1, 'the flip alone triggers onChange');
  assert.equal(r.ui.act('retry'), true);
  assert.equal(r.sent.length, 2);
  assert.deepEqual(r.sent[1], cmd);
  assert.equal(r.sent[1].opId, cmd.opId);
  assert.equal(r.ui.view().retryReady, false, 'the five seconds restart after the resend');
  r.ui.onResult(ack(cmd));
  r.setTime(20000);
  assert.equal(r.ui.view().retryReady, false, 'an acked command is waiting for the profile, not for a retry');
  const off = rig(profile(), { enabled: false });
  assert.equal(off.ui.view().retryReady, false);
});

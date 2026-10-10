import test from 'node:test';
import assert from 'node:assert/strict';
import { RaftLanternActions } from '../src/ui/raftLanternActions.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';
import { LiveNavigationView } from '../src/client/liveNavigationView.js';

const lantern = ['lantern', 2, -1, 0, 0];
function fixture({ yaw = 0, litLanterns = [], owner = 90 } = {}) {
  let clock = 0;
  const sent = [], toasts = [];
  const record = { id: 'raft-a', owner, x: 3, y: 0, z: -2, yaw, rev: 12,
    partHealth: [{ id: 'lamp-instance', part: [...lantern], hp: 10, maxHp: 10 }],
    litLanterns: litLanterns.map((part) => [...part]) };
  const client = { joined: true, youServer: 42, cur: lanternPoint(record, lantern), pred: { rafts: [record] },
    naval: { active: false }, deck: { active: false }, send: (message) => sent.push(message) };
  const actions = new RaftLanternActions({ client: () => client, locale: () => 'es',
    toast: (message) => toasts.push(message), now: () => clock });
  return { actions, client, record, sent, toasts, setTime: (value) => { clock = value; } };
}

test('nearest rotated live lantern is usable on any nearby raft and emits an intent without lighting optimistically', () => {
  const f = fixture({ yaw: Math.PI / 2 });
  f.client.cur = lanternPoint(f.record, lantern);
  const before = structuredClone(f.record);
  const action = f.actions.interaction();
  assert.equal(action?.key, 'V');
  assert.equal(action?.icon, 'lantern');
  assert.equal(action?.verb, 'Encender farol');
  assert.equal(action.run(), true);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0], { t: 'cmd', type: 'raftLantern', id: 'raft-a', partId: 'lamp-instance', expectedRev: 12,
    expectedLit: false, lit: true, opId: f.sent[0].opId });
  assert.deepEqual(f.record, before);
});

test('only live in-range same-floor lanterns are offered and at-helm use is suppressed', () => {
  const f = fixture();
  f.client.cur = { x: 100, y: 0, z: 100 };
  assert.equal(f.actions.interaction(), null);
  f.client.cur = lanternPoint(f.record, lantern);
  f.client.cur.y += 0.61;
  assert.equal(f.actions.interaction(), null);
  f.client.cur = lanternPoint(f.record, lantern);
  f.record.partHealth[0].hp = 0;
  assert.equal(f.actions.interaction(), null);
  f.record.partHealth[0].hp = 10;
  f.client.naval.active = true;
  assert.equal(f.actions.interaction(), null);
  f.client.deck.active = true;
  assert.ok(f.actions.interaction());
});

test('lit state presents an extinguish intent and public source state stays authoritative through pending and ack', () => {
  const f = fixture({ litLanterns: [lantern] });
  const before = structuredClone(f.record);
  const action = f.actions.interaction();
  assert.equal(action.verb, 'Apagar farol');
  action.run();
  assert.deepEqual(f.sent[0], { t: 'cmd', type: 'raftLantern', id: 'raft-a', partId: 'lamp-instance', expectedRev: 12,
    expectedLit: true, lit: false, opId: f.sent[0].opId });
  assert.equal(f.actions.interaction().prompt, 'Apagando…');
  assert.deepEqual(f.record, before);
  assert.equal(f.actions.acknowledge({ type: 'raftLantern', opId: 'other', ok: true }), false);
  assert.equal(f.actions.acknowledge({ type: 'raftLantern', opId: f.sent[0].opId, ok: true, lit: false }), true);
  assert.deepEqual(f.record, before);
  assert.equal(f.toasts.at(-1), 'Farol apagado.');
});

test('pending retry sends the same exact command once and timeout releases it without another toggle', () => {
  const f = fixture(); f.actions.interaction().run();
  const command = f.sent[0];
  f.setTime(999); f.actions.update(); assert.equal(f.sent.length, 1);
  f.setTime(1000); f.actions.update(); assert.equal(f.sent.length, 2); assert.equal(f.sent[1], command);
  f.setTime(2000); f.actions.update(); assert.equal(f.sent.length, 2);
  f.setTime(5000); f.actions.update();
  assert.equal(f.actions.pending, null);
  assert.equal(f.toasts.at(-1), 'La conexión tarda. El farol sigue bajo control del servidor.');
});

test('replacement client, entity change, unjoin, removed instance, and late ack invalidate pending work', () => {
  const f = fixture(); f.actions.interaction().run();
  const oldOp = f.sent[0].opId;
  const replacement = { ...f.client, pred: { rafts: [f.record] } };
  f.actions.client = () => replacement;
  assert.equal(f.actions.acknowledge({ type: 'raftLantern', opId: oldOp, ok: true }), false);
  assert.equal(f.actions.pending, null); assert.deepEqual(f.toasts, []);
  f.actions.client = () => f.client; f.actions.interaction().run();
  f.client.youServer++;
  f.actions.update(); assert.equal(f.actions.pending, null);
  f.client.youServer--; f.actions.interaction().run();
  f.record.partHealth[0].hp = 0;
  assert.equal(f.actions.acknowledge({ type: 'raftLantern', opId: f.sent.at(-1).opId, ok: true }), false);
  assert.equal(f.actions.pending, null);
});

test('denials and success feedback are localized in Spanish and English', () => {
  const f = fixture(); f.actions.interaction().run();
  f.actions.acknowledge({ type: 'raftLantern', opId: f.sent[0].opId, ok: false, why: 'condition' });
  assert.equal(f.toasts.at(-1), 'El farol ya no está en condiciones de usarse.');
  f.actions.locale = () => 'en'; f.actions.interaction().run();
  f.actions.acknowledge({ type: 'raftLantern', opId: f.sent[1].opId, ok: false, why: 'revision' });
  assert.equal(f.toasts.at(-1), 'The raft changed. Try again.');
  f.actions.interaction().run(); f.actions.acknowledge({ type: 'raftLantern', opId: f.sent[2].opId, ok: true });
  assert.equal(f.toasts.at(-1), 'Lantern lit.');
});

test('LiveNavigationView selects the nearest V context, routes touch action through it, and preserves F/E/G', () => {
  const client = { joined: true, naval: { active: true }, deck: { active: false }, voyage: { phase: 'shore' } };
  let touchActions = [];
  const view = Object.create(LiveNavigationView.prototype);
  Object.assign(view, { getClient: () => client, input: { enabled: true }, disposed: false, paused: false, isTouch: true,
    touch: { setActions(actions) { touchActions = actions; }, instrument: { querySelector: () => null } }, actionSignature: '',
    isActive: () => true, navigationInteraction: () => ({ actions: [
      { key: 'F', verb: 'Reembarcar', run() { return 'F'; } },
      { key: 'E', verb: 'Caminar', run() { return 'E'; } },
      { key: 'G', verb: 'Desembarcar', run() { return 'G'; } },
    ] }),
    doorInteraction: () => ({ key: 'V', verb: 'Cerrar puerta', distance: 1.2, run() { return 'door'; } }),
    lanternInteraction: () => ({ key: 'V', verb: 'Apagar farol', lantern: true, distance: 0.7, run() { return 'lantern'; } }),
  });
  const interaction = view.interaction();
  assert.equal(interaction.lantern, true);
  assert.deepEqual(interaction.actions.map((action) => action.key), ['V', 'F', 'E', 'G']);
  assert.equal(view.keyAction('V').run(), 'lantern');
  assert.equal(view.runAction('lantern'), undefined, 'touch action routes to the selected V interaction');
  assert.equal(view.keyAction('F').run(), 'F');
  assert.equal(view.keyAction('E').run(), 'E');
  assert.equal(view.keyAction('G').run(), 'G');
  view.updateActions();
  assert.deepEqual(touchActions.map((action) => action.id), ['lantern', 'bag', 'mode', 'center', 'map', 'reboard', 'land']);
  assert.equal(touchActions[0].shortcut, 'V');
  assert.equal(touchActions.find((action) => action.id === 'center').shortcut, 'Y');
});

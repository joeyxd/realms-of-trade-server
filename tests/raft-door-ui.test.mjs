import test from 'node:test';
import assert from 'node:assert/strict';
import { RaftDoorActions } from '../src/ui/raftDoorActions.js';
import { doorPoint } from '../src/sim/naval/shelter.js';

const door = ['door', 0, 0, 0, 0];
function fixture({ yaw = 0, x = 0, openDoors = [], owner = 77 } = {}) {
  let clock = 0;
  const sent = [], toasts = [];
  const record = { id: 'raft-a', owner, x, y: 0, z: 0, yaw, rev: 8,
    partHealth: [{ id: 'door-id', part: [...door], hp: 10, maxHp: 10 }], openDoors: openDoors.map((p) => [...p]) };
  const client = { joined: true, youServer: 42, cur: { x: 0, y: 0, z: 0 }, pred: { rafts: [record] },
    naval: { active: false }, deck: { active: false }, send: (message) => sent.push(message) };
  const actions = new RaftDoorActions({ client: () => client, locale: () => 'es', toast: (message) => toasts.push(message), now: () => clock });
  return { actions, client, record, sent, toasts, setTime: (value) => { clock = value; } };
}

test('nearest door uses rotated edge geometry and can be used on another player raft', () => {
  const f = fixture({ yaw: Math.PI / 2, x: 3, owner: 900 });
  const point = doorPoint(f.record, door);
  f.client.cur = { ...point };
  const action = f.actions.interaction();
  assert.equal(action?.key, 'F');
  assert.equal(action?.icon, 'door');
  assert.equal(action?.verb, 'Abrir puerta');
  assert.equal(action?.run(), true);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0], { t: 'cmd', type: 'raftDoor', id: 'raft-a', partId: 'door-id', expectedRev: 8,
    expectedOpen: false, open: true, opId: f.sent[0].opId });
});

test('only live nearby doors are offered; being at helm suppresses the interaction', () => {
  const f = fixture();
  f.record.partHealth[0].hp = 0;
  assert.equal(f.actions.interaction(), null);
  f.record.partHealth[0].hp = 10;
  f.client.naval.active = true;
  assert.equal(f.actions.interaction(), null);
  f.client.deck.active = true;
  assert.ok(f.actions.interaction(), 'walking on deck remains eligible while deck mode is active');
});

test('open doors get a close intent and pending requests never change public collision state', () => {
  const f = fixture({ openDoors: [door] });
  const before = structuredClone(f.record);
  const action = f.actions.interaction();
  assert.equal(action.prompt, 'Cerrar puerta');
  action.run();
  assert.deepEqual(f.sent[0], { t: 'cmd', type: 'raftDoor', id: 'raft-a', partId: 'door-id', expectedRev: 8,
    expectedOpen: true, open: false, opId: f.sent[0].opId });
  assert.deepEqual(f.record, before);
  assert.equal(f.actions.interaction().prompt, 'Cerrando…');
  assert.equal(f.actions.acknowledge({ type: 'raftDoor', opId: 'other', ok: true }), false);
  assert.deepEqual(f.record, before);
  assert.equal(f.actions.acknowledge({ type: 'raftDoor', opId: f.sent[0].opId, ok: true }), true);
  assert.deepEqual(f.record, before, 'an acknowledgement does not predict the authoritative open-door state');
});

test('pending request retries the exact command once, then times out without a second toggle', () => {
  const f = fixture();
  f.actions.interaction().run();
  const original = f.sent[0];
  f.setTime(999); f.actions.update();
  assert.equal(f.sent.length, 1);
  f.setTime(1000); f.actions.update();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1], original);
  f.setTime(2000); f.actions.update();
  assert.equal(f.sent.length, 2, 'no unbounded retries');
  f.setTime(5000); f.actions.update();
  assert.equal(f.actions.pending, null);
  assert.equal(f.toasts.at(-1), 'La conexión tarda. La puerta sigue bajo control del servidor.');
});

test('client, join, and player entity changes invalidate pending intents', () => {
  const f = fixture();
  f.actions.interaction().run();
  const oldClient = f.client;
  const replacement = { ...oldClient, pred: { rafts: [f.record] } };
  f.actions.client = () => replacement;
  f.actions.update();
  assert.equal(f.actions.pending, null);
  f.actions.client = () => oldClient;
  f.actions.interaction().run();
  oldClient.youServer = 43;
  f.actions.update();
  assert.equal(f.actions.pending, null);
  f.actions.interaction().run();
  oldClient.joined = false;
  f.actions.update();
  assert.equal(f.actions.pending, null);
});

test('localized denials and successful feedback support English and Spanish', () => {
  const f = fixture();
  f.actions.interaction().run();
  f.actions.acknowledge({ type: 'raftDoor', opId: f.sent[0].opId, ok: false, why: 'occupied' });
  assert.equal(f.toasts.at(-1), 'La puerta está bloqueada.');
  f.actions.locale = () => 'en';
  f.actions.interaction().run();
  f.actions.acknowledge({ type: 'raftDoor', opId: f.sent[1].opId, ok: false, why: 'revision' });
  assert.equal(f.toasts.at(-1), 'The raft changed. Try again.');
  f.actions.interaction().run();
  f.actions.acknowledge({ type: 'raftDoor', opId: f.sent[2].opId, ok: true });
  assert.equal(f.toasts.at(-1), 'Door opened.');
});

test('late acknowledgement after session replacement cannot clear or toast for the new session', () => {
  const f = fixture();
  f.actions.interaction().run();
  const oldOp = f.sent[0].opId;
  const nextClient = { ...f.client, pred: { rafts: [f.record] }, send: (message) => f.sent.push(message) };
  f.actions.client = () => nextClient;
  assert.equal(f.actions.acknowledge({ type: 'raftDoor', opId: oldOp, ok: true }), false);
  assert.equal(f.actions.pending, null);
  assert.deepEqual(f.toasts, []);
});

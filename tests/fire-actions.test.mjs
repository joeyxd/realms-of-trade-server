import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalLanternActions } from '../src/ui/personalLanternActions.js';
import { RaftLanternActions } from '../src/ui/raftLanternActions.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';

function personalFixture({ locale = 'es', slots = [], enabled = true } = {}) {
  let clock = 0;
  const sent = [], opened = [], toasts = [];
  const button = { attrs: {}, hidden: true, disabled: false, setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(k, fn) { this[k] = fn; }, remove() { this.removed = true; } };
  const parent = { ownerDocument: { createElement: () => button }, appendChild() {} };
  const entity = { r: { act: 0, hp: 100 } };
  const client = { joined: true, youServer: 42, personalLantern: false, fire: { enabled, rev: 8, slots },
    entities: new Map([[42, entity]]), send: command => sent.push(command) };
  const actions = new PersonalLanternActions({ client: () => client, parent, player: () => ({ dead: false }),
    locale: () => locale, toast: message => toasts.push(message), openFuel: target => { opened.push(target); return true; }, now: () => clock });
  return { actions, button, client, sent, opened, toasts, setTime: value => { clock = value; } };
}

test('N opens the hand fuel panel while empty, and confirmed snapshots label torch duration', () => {
  const f = personalFixture(); f.actions.update();
  assert.equal(f.button.textContent, 'Antorcha N');
  assert.equal(f.actions.toggle(), true);
  assert.deepEqual(f.opened, [{ ship: '', part: 'hand', kind: 'handTorch' }]);
  assert.deepEqual(f.sent, []);
  f.client.fire = { enabled: true, rev: 8, slots: [{ key: 'hand', kind: 'handTorch', seconds: 719, lit: true }] };
  f.actions.update();
  assert.equal(f.button.textContent, 'Antorcha N · 11:59');
  assert.equal(f.button.attrs['aria-pressed'], 'true');
});

test('fueled hand torch sends exact immutable fire set command and waits for confirmation', () => {
  const f = personalFixture({ slots: [{ key: 'hand', kind: 'handTorch', seconds: 700, lit: true }] });
  f.actions.update();
  assert.equal(f.actions.toggle(), true);
  const command = f.sent[0];
  assert.deepEqual({ ...command, opId: 'id' }, { t: 'cmd', type: 'fire', op: 'set', opId: 'id', ship: '', part: 'hand',
    kind: 'handTorch', expectedRev: 8, lit: false });
  assert.equal(Object.isFrozen(command), true);
  assert.equal(f.actions.state(), true, 'confirmed snapshot remains lit until the server updates it');
  assert.equal(f.actions.acknowledge({ type: 'fire', op: 'set', opId: 'other', ok: true }), false);
  assert.equal(f.actions.pending.command, command);
  assert.equal(f.actions.acknowledge({ type: 'fire', op: 'set', opId: command.opId, ok: true }), true);
  assert.equal(f.toasts.at(-1), 'Antorcha apagada.');
  assert.equal(f.actions.state(), true, 'ACK does not optimistically change the confirmed state');
});

test('fire command retries exact request once, times out, and denial feedback is localized', () => {
  const f = personalFixture({ locale: 'en', slots: [{ key: 'hand', kind: 'handTorch', seconds: 500, lit: true }] });
  f.actions.update(); f.actions.toggle(); const command = f.sent[0];
  f.setTime(1000); f.actions.update(); assert.equal(f.sent[1], command);
  f.actions.acknowledge({ type: 'fire', op: 'set', opId: command.opId, ok: false, why: 'goods' });
  assert.equal(f.toasts.at(-1), 'You need one wood in your pack.');
  f.actions.toggle(); f.setTime(6000); f.actions.update();
  assert.equal(f.actions.pending, null);
  assert.equal(f.toasts.at(-1), 'The connection is taking longer. Fuel remains under server control.');
});

function raftFixture({ owner = 42, kind = 'torchFloor', seconds = 0, lit = false, enabled = true } = {}) {
  const part = [kind, 1, 0, 0, 0];
  const record = { id: 'raft-A', owner, x: 4, y: 0, z: -3, yaw: 0, rev: 17,
    partHealth: [{ id: 'cond-5', part, hp: 10, maxHp: 10 }], litLanterns: [] };
  const client = { joined: true, youServer: 42, cur: lanternPoint(record, part), pred: { rafts: [record] },
    fire: { enabled, rev: 8, slots: seconds ? [{ key: JSON.stringify([record.id, 'cond-5']), kind, seconds, lit }] : [] },
    naval: { active: false }, deck: { active: false }, send() {} };
  const opened = [];
  const actions = new RaftLanternActions({ client: () => client, openFuel: target => { opened.push(target); return true; } });
  return { actions, client, record, opened };
}

test('owner-only raft interaction opens fire panel for the nearest supported fixture kind', () => {
  const f = raftFixture();
  const action = f.actions.interaction();
  assert.equal(action?.verb, 'Cargar fuego');
  assert.equal(action.run(), true);
  assert.deepEqual(f.opened, [{ ship: 'raft-A', part: 'cond-5', kind: 'torchFloor' }]);
  f.record.owner = 99;
  assert.equal(f.actions.interaction(), null);
});

test('fuelled fixture prompts from confirmed fire rows and still opens its station panel', () => {
  const f = raftFixture({ kind: 'grill', seconds: 900, lit: true });
  const action = f.actions.interaction();
  assert.equal(action?.verb, 'Apagar fuego');
  assert.equal(action.run(), true);
  assert.deepEqual(f.opened[0], { ship: 'raft-A', part: 'cond-5', kind: 'grill' });
});

test('legacy lantern path remains unchanged when fire feature flag is absent', () => {
  const f = raftFixture({ kind: 'lantern', enabled: false });
  delete f.client.fire;
  const action = f.actions.interaction();
  assert.equal(action?.verb, 'Encender farol');
  assert.equal(action.run(), true);
  assert.equal(f.opened.length, 0);
});

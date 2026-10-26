import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalLanternActions } from '../src/ui/personalLanternActions.js';

function fixture({ lit = false } = {}) {
  let clock = 0;
  const sent = [], toasts = [];
  const state = { enabled: true };
  const button = {
    attrs: {}, listeners: {}, hidden: false, disabled: false,
    setAttribute(key, value) { this.attrs[key] = String(value); },
    addEventListener(key, fn) { this.listeners[key] = fn; },
    remove() { this.removed = true; },
  };
  const parent = { ownerDocument: { createElement: () => button }, appendChild(child) { this.child = child; } };
  const entity = { r: { act: 0, hp: 100 } };
  const client = { joined: true, youServer: 17, personalLantern: lit, entities: new Map([[17, entity]]),
    send: (command) => sent.push(command) };
  const player = { dead: false };
  const actions = new PersonalLanternActions({ client: () => client, parent, player: () => player,
    enabled: () => state.enabled, locale: () => 'es', toast: (message) => toasts.push(message), now: () => clock });
  return { actions, button, client, entity, player, sent, toasts, state, setTime(value) { clock = value; } };
}

test('button follows confirmed state and sends an explicit toggle without optimistic lighting', () => {
  const f = fixture();
  f.actions.update();
  assert.equal(f.button.hidden, false);
  assert.equal(f.button.attrs['aria-pressed'], 'false');
  assert.equal(f.actions.toggle(), true);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0], { t: 'cmd', type: 'personalLantern', lit: true, opId: f.sent[0].opId });
  assert.match(f.sent[0].opId, /^[A-Za-z0-9-]{16,}$/);
  assert.equal(f.client.personalLantern, false);
  assert.equal(f.button.attrs['aria-pressed'], 'false');
  assert.equal(f.button.disabled, true);
  assert.equal(f.actions.toggle(), false);
});

test('only matching private ACK clears pending; server state controls the button and feedback', () => {
  const f = fixture(); f.actions.update(); f.actions.toggle();
  const opId = f.sent[0].opId;
  assert.equal(f.actions.acknowledge({ type: 'personalLantern', opId: 'stale', ok: true, lit: true }), false);
  assert.equal(f.actions.pending.command.opId, opId);
  f.client.personalLantern = true;
  assert.equal(f.actions.acknowledge({ type: 'personalLantern', opId, ok: true, lit: true }), true);
  assert.equal(f.button.attrs['aria-pressed'], 'true');
  assert.equal(f.button.disabled, false);
  assert.equal(f.toasts.at(-1), 'Luz encendida.');
});

test('retries the exact command once at one second and stops after the five second timeout', () => {
  const f = fixture(); f.actions.update(); f.actions.toggle();
  const command = f.sent[0];
  f.setTime(999); f.actions.update(); assert.equal(f.sent.length, 1);
  f.setTime(1000); f.actions.update(); assert.equal(f.sent.length, 2); assert.equal(f.sent[1], command);
  f.setTime(2500); f.actions.update(); assert.equal(f.sent.length, 2);
  f.setTime(5000); f.actions.update();
  assert.equal(f.actions.pending, null);
  assert.equal(f.toasts.at(-1), 'La conexión tarda. La luz sigue bajo control del servidor.');
});

test('unjoin, replacement client, entity change, and death invalidate a pending command', () => {
  const f = fixture(); f.actions.update(); f.actions.toggle();
  f.client.youServer = 18;
  f.actions.update(); assert.equal(f.actions.pending, null);
  assert.equal(f.button.hidden, true);
  f.client.youServer = 17; f.actions.update(); f.actions.toggle();
  f.client.joined = false; f.actions.update(); assert.equal(f.actions.pending, null);
  f.client.joined = true; f.actions.update(); f.actions.toggle();
  f.player.dead = true; f.actions.update(); assert.equal(f.actions.pending, null);
  assert.equal(f.button.hidden, true);
  assert.equal(f.actions.acknowledge({ type: 'personalLantern', opId: f.sent.at(-1).opId, ok: true }), false);
});

test('button visibility obeys the supplied play-context callback and cleanup removes its DOM node', () => {
  const f = fixture();
  f.actions.update(); assert.equal(f.button.hidden, false);
  f.state.enabled = false; f.actions.update(); assert.equal(f.button.hidden, true);
  assert.equal(f.actions.toggle(), false, 'a hidden control cannot be triggered through its public API');
  assert.equal(f.sent.length, 0);
  f.state.enabled = true; f.actions.update(); assert.equal(f.button.hidden, false);
  assert.equal(f.button.textContent, 'Farol N');
  f.actions.locale = () => 'en'; f.actions.update(); assert.equal(f.button.textContent, 'Lantern N');
  f.actions.dispose(); assert.equal(f.button.removed, true);
});

test('denials and successful extinguish feedback are localized', () => {
  const f = fixture({ lit: true }); f.actions.update(); f.actions.toggle();
  f.actions.acknowledge({ type: 'personalLantern', opId: f.sent[0].opId, ok: false, why: 'command' });
  assert.equal(f.toasts.at(-1), 'No se pudo validar la solicitud de luz.');
  f.actions.locale = () => 'en'; f.actions.toggle();
  f.client.personalLantern = false;
  f.actions.acknowledge({ type: 'personalLantern', opId: f.sent[1].opId, ok: true, lit: false });
  assert.equal(f.toasts.at(-1), 'Lantern extinguished.');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { makeResourceStore, startResourceHost, connect, turn } from './helpers/resource-authority-fixture.mjs';

test('the protocol carries the SK04b skills flag', () => {
  assert.ok(PROTOCOL_VERSION >= 65);
});

test('skill receipts are private client events and never combat feedback', () => {
  const emitted = [];
  const client = new GameClient({ onMessage() {}, onSnapshot() {}, start() {} }, generateWorld(84),
    { emit: (type, event) => emitted.push({ type, event }) });
  client.youServer = 17;
  const receipt = { type: 'skills', to: 17, op: 'assign', opId: 'one', ok: true, why: '', rev: 2 };
  client.onEvent(receipt);
  client.onEvent({ ...receipt, to: 18 });
  client.onEvent({ ...receipt, to: undefined });
  assert.deepEqual(emitted, [{ type: 'skills', event: receipt }]);
});

test('skills capability starts closed and is replaced on every welcome including solo', () => {
  const client = new GameClient({ onMessage() {}, onSnapshot() {}, start() {} }, generateWorld(85), { emit() {} });
  assert.equal(client.skills.enabled, false);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 17, skills: { enabled: true } });
  assert.equal(client.skills.enabled, true);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 18 });
  assert.equal(client.skills.enabled, false);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 19, skills: { enabled: 'true' } });
  assert.equal(client.skills.enabled, false);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 20, skills: { enabled: 1 } });
  assert.equal(client.skills.enabled, false);
});

test('the skills flag is independent of the attributes flag', () => {
  const client = new GameClient({ onMessage() {}, onSnapshot() {}, start() {} }, generateWorld(86), { emit() {} });
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 17, attributes: { enabled: true }, skills: { enabled: false } });
  assert.deepEqual([client.attributes.enabled, client.skills.enabled], [true, false]);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 18, attributes: { enabled: false }, skills: { enabled: true } });
  assert.deepEqual([client.attributes.enabled, client.skills.enabled], [false, true]);
});

test('host announces skills only to an admitted authenticated human with the flag enabled', async t => {
  const f = await startResourceHost(t, makeResourceStore().store, { options: {
    loggingOperations: true, artisanOperations: true, workshopOperations: true, skillOperations: true,
  } });
  assert.deepEqual(f.client.of(MSG.WELCOME).at(-1).skills, { enabled: true });
  const guest = connect(f.host, 'guest'); guest.hello();
  for (let n = 0; n < 20 && !guest.of(MSG.WELCOME).length; n++) await turn();
  assert.deepEqual(guest.of(MSG.WELCOME).at(-1).skills, { enabled: false });
});

test('host disables skill controls on an unactivated installation', async t => {
  const f = await startResourceHost(t, makeResourceStore().store);
  assert.deepEqual(f.client.of(MSG.WELCOME).at(-1).skills, { enabled: false });
});

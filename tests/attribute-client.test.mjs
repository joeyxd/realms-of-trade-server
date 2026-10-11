import test from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { makeResourceStore, startResourceHost, connect, turn } from './helpers/resource-authority-fixture.mjs';

test('attribute receipts are private client events and never combat feedback', () => {
  const emitted = [];
  const client = new GameClient({ onMessage() {}, onSnapshot() {}, start() {} }, generateWorld(82),
    { emit: (type, event) => emitted.push({ type, event }) });
  client.youServer = 17;
  const receipt = { type: 'attributes', to: 17, op: 'assign', opId: 'one', ok: true, rev: 2 };
  client.onEvent(receipt);
  client.onEvent({ ...receipt, to: 18 });
  client.onEvent({ ...receipt, to: undefined });
  assert.deepEqual(emitted, [{ type: 'attributes', event: receipt }]);
});

test('attribute capability starts closed and is replaced on every welcome including solo', () => {
  const client = new GameClient({ onMessage() {}, onSnapshot() {}, start() {} }, generateWorld(83), { emit() {} });
  assert.equal(client.attributes.enabled, false);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 17, attributes: { enabled: true } });
  assert.equal(client.attributes.enabled, true);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 18 });
  assert.equal(client.attributes.enabled, false);
  client.onMessage({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 19, attributes: { enabled: 'true' } });
  assert.equal(client.attributes.enabled, false);
});

test('host announces attributes only to an admitted authenticated human with the flag enabled', async t => {
  const f = await startResourceHost(t, makeResourceStore().store, { options: {
    loggingOperations: true, artisanOperations: true, workshopOperations: true, attributeOperations: true,
  } });
  assert.deepEqual(f.client.of(MSG.WELCOME).at(-1).attributes, { enabled: true });
  const guest = connect(f.host, 'guest'); guest.hello();
  for (let n = 0; n < 20 && !guest.of(MSG.WELCOME).length; n++) await turn();
  assert.deepEqual(guest.of(MSG.WELCOME).at(-1).attributes, { enabled: false });
});

test('host disables attribute controls on an unactivated installation', async t => {
  const f = await startResourceHost(t, makeResourceStore().store);
  assert.deepEqual(f.client.of(MSG.WELCOME).at(-1).attributes, { enabled: false });
});

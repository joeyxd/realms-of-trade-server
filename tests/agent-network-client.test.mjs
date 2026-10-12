import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';

test('secure network client derives HTTPS Origin from the validated WSS endpoint', () => {
  let transportArgs;
  const transport = { ws: { readyState: 0 }, outbox: [], closed: false,
    onMessage() {}, onSnapshot() {}, onClose() {}, close() { this.closed = true; this.ws.readyState = 3; } };
  const client = new AgentNetworkClient({ url: 'wss://world.example:9443/ws', grant: fixtureGrant(),
    transportFactory: (...args) => { transportArgs = args; return transport; } });
  assert.deepEqual(transportArgs, ['wss://world.example:9443/ws', { origin: 'https://world.example:9443' }]);
  client.close();
  assert.equal(transport.closed, true);
});

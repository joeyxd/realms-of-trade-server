import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GAME } from '../../../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../../../src/net/protocol.js';

const origin = 'https://marea.62.171.136.148.sslip.io', checks = [];
const expectedVersion = process.argv[2] ?? GAME.version;
const expectedProtocol = Number(process.argv[3] ?? PROTOCOL_VERSION);
const get = async path => fetch(origin + path, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
const health = await get('/health'); assert.equal(health.status, 200); assert.equal(await health.text(), 'ok');
checks.push('health_200');
const status = await (await get('/status')).json();
assert.equal(status.version, expectedVersion); assert.equal(status.errors, 0);
assert.equal(status.storage.kind, 'supabase'); assert.equal(status.storage.durable, true);
assert.equal(status.storage.accounts, true); assert.equal(status.storage.tickBlocked, false);
assert.equal(status.storage.economic.enabled, true); assert.equal(status.storage.economic.failed, false);
assert.equal(status.storage.resources.enabled, true); assert.equal(status.storage.resources.ready, true);
assert.equal(status.storage.groundTransactions, null); checks.push('M5_economy_resources_healthy');
const protocol = await (await get('/src/net/protocol.js')).text();
assert.ok(protocol.includes('PROTOCOL_VERSION = ' + expectedProtocol)); checks.push('published_protocol');
const ws = new WebSocket(origin.replace('https:', 'wss:') + '/ws', { origin, handshakeTimeout: 12000 });
const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw))); ws.on('error', () => {});
const closed = once(ws, 'close');
async function wait(predicate) {
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    const value = messages.find(predicate); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('bounded public entry wait failed');
}
try {
  await once(ws, 'open');
  ws.send(JSON.stringify({ t: MSG.HELLO, v: expectedProtocol, name: 'AREA15 QA', skin: 0, weapon: 0 }));
  const welcome = await wait(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
  assert.equal(welcome.t, MSG.WELCOME); checks.push('ordinary_public_WSS_entry');
  await wait(m => m.t === MSG.SNAPSHOT); checks.push('world_snapshot');
  await wait(m => m.t === MSG.PROFILE); checks.push('ordinary_profile');
} finally {
  if (ws.readyState < 2) ws.close();
  const timer = setTimeout(() => ws.terminate(), 1500); await closed; clearTimeout(timer);
}
const result = { recordedAt: new Date().toISOString(), version: expectedVersion, protocol: expectedProtocol,
  checks, count: checks.length, status, scope: 'Public read-only health and ordinary guest entry; no durable gameplay action or common GameHost activation.' };
await writeFile(new URL('./public-smoke.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ count: checks.length, version: result.version, protocol: result.protocol }));

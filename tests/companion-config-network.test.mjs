import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const OWNER = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const CHARACTER = '30000000-0000-4000-8000-000000000001';
const FOREIGN = '30000000-0000-4000-8000-000000000002';
const WORLD = 'companion-config-wire';
const config = text => ({ v: 1, personality: text, goals: [{ id: 'sail', status: 'active', text: 'Navegar juntos', constraints: ['Volver al puerto'] }] });
let sequence = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function room(t, options = {}) {
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8,
    worldId: WORLD, saveSecret: 'companion-config-wire-fixture', log() {},
    store: createMemoryStore(), companionConfigAllowMemory: true,
    resolvePlayer: async (_request, { token }) => ({ owner: OWNER, other: OTHER, character: CHARACTER }[token] ?? null),
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['chat'] },
      { ownerId: OTHER, characterId: FOREIGN, capabilities: ['chat'] }] }, ...options });
  const port = await app.listen();
  const clients = [];
  t.after(async () => { for (const client of clients) client.ws.close(); await app.close(); });
  async function connect(token, agent = false) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const wait = async predicate => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) { const found = messages.find(predicate); if (found) return found; await sleep(5); }
      throw new Error('missing companion config wire result');
    };
    ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Config test', skin: 0, weapon: 0,
      ...(token ? { token } : {}), ...(agent ? { agent: true } : {}) }));
    assert.equal((await wait(m => [MSG.WELCOME, MSG.ERROR].includes(m.t))).t, MSG.WELCOME);
    const client = { ws, messages, wait, async query(extra) {
      const requestId = `config-${++sequence}`;
      ws.send(JSON.stringify({ t: MSG.AGENT_COMPANION_CONFIG, requestId, op: 'load', characterKey: CHARACTER, ...extra }));
      return wait(m => m.t === MSG.AGENT_COMPANION_CONFIG_RESULT && m.requestId === requestId);
    } };
    clients.push(client); return client;
  }
  return { app, connect };
}

test('real sockets derive config ownership, reject guests/controller/spoofing and keep metadata out of gameplay', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), other = await connect('other'), guest = await connect(null), agent = await connect('character', true);
  const beforeProfile = await app.game.store.loadProfile(OWNER), beforeWorld = await app.game.store.loadWorld(WORLD);
  for (const client of [other, guest, agent]) {
    const denied = await client.query(); assert.equal(denied.why, 'forbidden'); assert.equal(denied.head, null);
  }
  assert.equal((await owner.query({ ownerId: OTHER })).why, 'invalid_request');
  assert.equal((await owner.query({ characterKey: FOREIGN })).why, 'forbidden');
  const loaded = await owner.query(); assert.equal(loaded.ok, true); assert.equal(loaded.durable, false);
  assert.deepEqual(loaded.head, { revision: 0, config: null, savedAt: null });
  const saved = await owner.query({ op: 'save', expectedRevision: 0, config: config('Compañera prudente') });
  assert.equal(saved.ok, true); assert.equal(saved.head.revision, 1);
  assert.deepEqual((await owner.query()).head, saved.head);
  assert.deepEqual(await app.game.store.loadProfile(OWNER), beforeProfile);
  assert.deepEqual(await app.game.store.loadWorld(WORLD), beforeWorld);
  assert.equal(app.game.agentControl.listOwned(OWNER)[0].stopped, false);
  assert.equal(other.messages.some(m => m.head?.config?.personality === 'Compañera prudente'), false);
});

test('wire config CAS keeps the remote head on conflict and stop does not erase the saved metadata', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner');
  const saved = await owner.query({ op: 'save', expectedRevision: 0, config: config('Primera ficha') });
  assert.equal(saved.ok, true);
  assert.equal((await owner.query({ op: 'save', expectedRevision: 0, config: config('Primera ficha') })).head.revision, 1);
  const conflict = await owner.query({ op: 'save', expectedRevision: 0, config: config('Otra pestaña') });
  assert.equal(conflict.why, 'conflict'); assert.deepEqual(conflict.head, saved.head);
  app.game.agentControl.revoke(OWNER, CHARACTER, 'stop');
  assert.deepEqual((await owner.query()).head, saved.head);
  assert.equal((await owner.query({ op: 'save', expectedRevision: 1, config: { ...config('ok'), model: 'unadmitted' } })).why, 'invalid_request');
});

test('missing durable readiness leaves gameplay healthy and config unavailable', async t => {
  const { app, connect } = await room(t, { companionConfigAllowMemory: false });
  const owner = await connect('owner');
  assert.equal((await owner.query()).why, 'unavailable'); assert.equal(app.game.healthy(), true);
});

test('timed out saves stay bounded and their late completion cannot reply into a retired owner session', async t => {
  const base = createMemoryStore(); let finish, writes = 0;
  const store = { ...base, saveCompanionConfig: async input => {
    writes++; await new Promise(resolve => { finish = resolve; }); return base.saveCompanionConfig(input);
  } };
  const { app, connect } = await room(t, { store });
  app.game.companionConfig.timeoutMs = 30;
  const owner = await connect('owner');
  const result = await owner.query({ op: 'save', expectedRevision: 0, config: config('Respuesta perdida') });
  assert.equal(result.why, 'unavailable'); assert.equal(writes, 1);
  assert.equal((await owner.query()).why, 'busy');
  owner.ws.close(); finish(); await sleep(50);
  assert.equal(app.game.companionConfig.busy.size, 0);
  const replacement = await connect('owner');
  assert.equal((await replacement.query()).head.config.personality, 'Respuesta perdida');
  assert.equal(writes, 1);
});

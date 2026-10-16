import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';

const OWNER = '20000000-0000-4000-8000-000000000001', OTHER = '20000000-0000-4000-8000-000000000002';
const CREATION = '30000000-0000-4000-8000-000000000001';
const WORLD = 'companion-create-wire';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let sequence = 0;
async function room(t, extra = {}) {
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8,
    worldId: WORLD, saveSecret: 'companion-create-fixture', log() {}, store: createMemoryStore(),
    companionCreation: true, companionCreationAllowMemory: true,
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER, other: OTHER }[token] ?? null), ...extra });
  const port = await app.listen(), clients = [];
  t.after(async () => { for (const c of clients) c.ws.close(); await app.close(); });
  async function connect(token) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const wait = async predicate => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) { const found = messages.find(predicate); if (found) return found; await sleep(5); }
      throw new Error('missing companion creation result');
    };
    ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Creation QA', skin: 0, weapon: 0,
      ...(token ? { token } : {}) }));
    assert.equal((await wait(m => [MSG.WELCOME, MSG.ERROR].includes(m.t))).t, MSG.WELCOME);
    const client = { ws, messages, wait, async query(extra = {}) {
      const requestId = `create-${++sequence}`;
      ws.send(JSON.stringify({ t: MSG.AGENT_COMPANION_CREATE, requestId, op: 'load', ...extra }));
      return wait(m => m.t === MSG.AGENT_COMPANION_CREATE_RESULT && m.requestId === requestId);
    } };
    clients.push(client); return client;
  }
  return { app, connect };
}
const create = () => ({ op: 'create', creationId: CREATION, preset: structuredClone(DEFAULT_COMPANION_PRESET) });

test('creation derives owner/world, survives reconnect, stays private and grants no profile or controller', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), other = await connect('other'), guest = await connect(null);
  assert.equal((await guest.query()).why, 'forbidden');
  assert.equal((await owner.query({ owner: OTHER })).why, 'invalid_request');
  assert.equal((await owner.query()).record, null);
  const profile = await app.game.store.loadProfile(OWNER), world = await app.game.store.loadWorld(WORLD);
  const result = await owner.query(create());
  assert.equal(result.ok, true); assert.equal(result.available, true);
  assert.equal(result.record.preset.name, 'Brisa');
  assert.equal(result.record.control.stopped, true);
  assert.equal(result.record.configuration.revision, 1);
  assert.notEqual(result.record.characterKey, OWNER);
  assert.equal(await app.game.store.loadProfile(result.record.characterKey), null);
  assert.equal(app.game.agentControl, null);
  assert.deepEqual(await app.game.store.loadProfile(OWNER), profile);
  assert.deepEqual(await app.game.store.loadWorld(WORLD), world);
  assert.equal((await other.query()).record, null);
  assert.equal(other.messages.some(m => m.record?.characterKey === result.record.characterKey), false);
  assert.deepEqual((await owner.query(create())).record, result.record);
  const different = create(); different.preset.name = 'Otra';
  assert.equal((await owner.query(different)).why, 'conflict');
  owner.ws.close(); await new Promise(resolve => owner.ws.once('close', resolve));
  const reconnected = await connect('owner');
  assert.deepEqual((await reconnected.query()).record, result.record);
});

test('missing readiness and opt-in keep creation unavailable without breaking gameplay', async t => {
  for (const options of [{ companionCreation: false }, { companionCreationAllowMemory: false }]) {
    const { app, connect } = await room(t, options), owner = await connect('owner');
    const result = await owner.query(create());
    assert.equal(result.why, 'unavailable'); assert.equal(result.available, false);
    assert.equal(result.record, null); assert.equal(app.game.healthy(), true);
  }
});

test('invalid creation cannot pass a model URL, spoofed owner, extra fields or unsafe preset', async t => {
  const { connect } = await room(t), owner = await connect('owner');
  for (const changed of [
    { ...create(), owner: OTHER }, { ...create(), creationId: 'not-an-id' },
    { ...create(), preset: { ...create().preset, baseUrl: 'http://127.0.0.1:8080/v1' } },
    { ...create(), preset: { ...create().preset, name: '<bad>' } },
    { ...create(), preset: { ...create().preset, traits: ['curious', 'curious'] } },
  ]) assert.equal((await owner.query(changed)).why, 'invalid_request');
  assert.equal((await owner.query()).record, null);
});

test('uncertain create stays bounded; late commit is recovered after the original session closes', async t => {
  const base = createMemoryStore(); let finish, calls = 0;
  const store = { ...base, createCompanion: async args => {
    calls++; await new Promise(resolve => { finish = resolve; }); return base.createCompanion(args);
  } };
  const { app, connect } = await room(t, { store });
  app.game.companionCreation.timeoutMs = 25;
  const owner = await connect('owner');
  const first = await owner.query(create());
  assert.equal(first.why, 'unavailable'); assert.equal(calls, 1);
  assert.equal((await owner.query()).why, 'busy');
  owner.ws.close(); await new Promise(resolve => owner.ws.once('close', resolve));
  finish(); await sleep(30);
  const replacement = await connect('owner'), recovered = await replacement.query();
  assert.equal(recovered.record.creationId, CREATION);
  assert.equal(calls, 1); assert.equal(app.game.companionCreation.busy.size, 0);
  assert.equal(owner.messages.filter(m => m.t === MSG.AGENT_COMPANION_CREATE_RESULT && m.record).length, 0);
});

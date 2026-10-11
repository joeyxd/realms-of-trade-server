import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { inferenceCatalogFromEnv } from '../server/inferenceConfig.mjs';
import { validateInferenceConfig, parseInferenceUsd, formatInferenceUsd } from '../src/net/inferenceConfig.js';

const OWNER = '20000000-0000-4000-8000-000000000001', OTHER = '20000000-0000-4000-8000-000000000002';
const A = '30000000-0000-4000-8000-000000000001', B = '30000000-0000-4000-8000-000000000002';
const FOREIGN = '30000000-0000-4000-8000-000000000003', WORLD = 'inference-config-wire';
const plan = () => ({ v: 1, ceilingNanoUsd: 2000000000, connections: [{ id: 'personal', ceilingNanoUsd: 1000000000 }],
  companions: [A, B].map(character => ({ character, connectionId: 'personal', modelId: 'local/test-model' })) });
const catalog = [{ owner: OWNER, connections: [{ id: 'personal', label: 'Personal', providerId: 'local',
  maxCeilingNanoUsd: 1000000000, models: ['local/test-model'] }] },
{ owner: OTHER, connections: [{ id: 'foreign', label: 'Other account', providerId: 'private',
  maxCeilingNanoUsd: 0, models: ['another-model'] }] }];
let sequence = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function room(t, extra = {}) {
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8, worldId: WORLD,
    saveSecret: 'inference-config-local-fixture', log() {}, store: createMemoryStore(), inferenceCatalog: catalog,
    inferenceConfigAllowMemory: true, companionControlAllowMemory: true,
    resolvePlayer: async (_request, { token }) => ({ owner: OWNER, other: OTHER, character: A }[token] ?? null),
    agentControl: { worldId: WORLD, bindings: [A, B].map(characterId => ({ ownerId: OWNER, characterId, capabilities: ['chat'] }))
      .concat([{ ownerId: OTHER, characterId: FOREIGN, capabilities: ['chat'] }]) }, ...extra });
  const port = await app.listen(), clients = [];
  t.after(async () => { for (const c of clients) c.ws.close(); await app.close(); });
  async function connect(token, agent = false) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const wait = async predicate => {
      const end = Date.now() + 4000;
      while (Date.now() < end) { const value = messages.find(predicate); if (value) return value; await sleep(5); }
      throw new Error('missing inference configuration response');
    };
    ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Inference QA', skin: 0, weapon: 0,
      ...(token ? { token } : {}), ...(agent ? { agent: true } : {}) }));
    assert.equal((await wait(m => [MSG.WELCOME, MSG.ERROR].includes(m.t))).t, MSG.WELCOME);
    await wait(m => m.t === MSG.PROFILE); await wait(m => m.t === MSG.SNAPSHOT);
    await app.game.profiles.flush();
    const c = { ws, messages, wait, query: async extra => {
      const requestId = `inference-${++sequence}`;
      ws.send(JSON.stringify({ t: MSG.INFERENCE_CONFIG, requestId, op: 'load', ...extra }));
      return wait(m => m.t === MSG.INFERENCE_CONFIG_RESULT && m.requestId === requestId);
    } };
    clients.push(c); return c;
  }
  return { app, connect };
}

test('private wire catalog/head derive owner and never leak across guests, characters or other accounts', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), other = await connect('other'), guest = await connect();
  for (const c of [guest]) {
    const denied = await c.query(); assert.equal(denied.why, 'forbidden'); assert.equal(denied.head, null);
    assert.deepEqual(denied.catalog, []); assert.deepEqual(denied.characters, []);
  }
  const own = await owner.query(); assert.equal(own.ok, true); assert.deepEqual(own.characters, [A, B]);
  assert.deepEqual(own.catalog, catalog[0].connections); assert.equal(own.head.config, null);
  const foreign = await other.query(); assert.deepEqual(foreign.catalog, catalog[1].connections);
  assert.deepEqual(foreign.characters, [FOREIGN]); assert.equal(foreign.head.config, null);
  assert.equal((await owner.query({ owner: OTHER })).why, 'invalid_request');
  assert.equal((await owner.query({ world: 'foreign-world' })).why, 'invalid_request');
  // A managed character admitted under a fresh control permit still cannot act as an owner.
  app.game.agentControl.resume(OWNER, A); app.game.companionControl.entries.get(A).head.stopped = false;
  const agent = await connect('character', true);
  const denied = await agent.query(); assert.equal(denied.why, 'forbidden'); assert.equal(denied.head, null);
  assert.deepEqual(denied.catalog, []);
});

test('two characters share one connection ceiling and atomic CAS head; metadata cannot mutate gameplay or resume', async t => {
  const { app, connect } = await room(t), owner = await connect('owner');
  const profile = await app.game.store.loadProfile(OWNER), world = await app.game.store.loadWorld(WORLD);
  const saved = await owner.query({ op: 'save', expectedRevision: 0, config: plan() });
  assert.equal(saved.ok, true); assert.equal(saved.head.revision, 1);
  assert.equal(saved.head.config.connections.length, 1); assert.equal(saved.head.config.companions.length, 2);
  assert.equal(saved.head.config.connections[0].ceilingNanoUsd, 1000000000);
  assert.deepEqual((await owner.query({ op: 'save', expectedRevision: 0, config: plan() })).head, saved.head);
  const changed = plan(); changed.ceilingNanoUsd = 3000000000;
  const conflict = await owner.query({ op: 'save', expectedRevision: 0, config: changed });
  assert.equal(conflict.why, 'conflict'); assert.deepEqual(conflict.head, saved.head);
  assert.deepEqual(await app.game.store.loadProfile(OWNER), profile); assert.deepEqual(await app.game.store.loadWorld(WORLD), world);
  assert.ok(app.game.agentControl.listOwned(OWNER).every(r => r.stopped && !r.active));
});

test('catalog eligibility, own character scope, explicit stop and exact schema gate saves', async t => {
  const { app, connect } = await room(t), owner = await connect('owner');
  const save = config => owner.query({ op: 'save', expectedRevision: 0, config });
  for (const mutate of [p => { p.companions[0].character = FOREIGN; p.companions.sort((a,b) => a.character.localeCompare(b.character)); },
    p => { p.companions[0].modelId = 'another-model'; }, p => { p.connections[0].ceilingNanoUsd = 1000000001; },
    p => { p.connections[0].id = 'foreign'; for (const c of p.companions) c.connectionId = 'foreign'; }]) {
    const p = plan(); mutate(p); assert.equal((await save(p)).why, 'ineligible');
  }
  assert.equal((await save({ ...plan(), apiKey: 'fixture-secret' })).why, 'invalid_request');
  app.game.agentControl.resume(OWNER, A);
  assert.equal((await save(plan())).why, 'must_stop');
  app.game.agentControl.revoke(OWNER, A, 'stop');
  assert.equal((await save(plan())).ok, true);
  // Revocation is rechecked at each mutation. Historical selections remain visible, not runnable.
  app.game.inferenceConfig.catalogs.delete(OWNER);
  assert.equal((await owner.query()).head.revision, 1);
  assert.equal((await owner.query({ op: 'save', expectedRevision: 1, config: plan() })).why, 'ineligible');
});

test('timeout holds the account slot across sessions until real save settles and cannot deliver a late result', async t => {
  const base = createMemoryStore(); let finish, writes = 0;
  const { app, connect } = await room(t, { store: { ...base, saveInferenceConfig: async input => {
    writes++; await new Promise(resolve => { finish = resolve; }); return base.saveInferenceConfig(input);
  } } });
  app.game.inferenceConfig.timeoutMs = 20;
  const owner = await connect('owner');
  const lost = await owner.query({ op: 'save', expectedRevision: 0, config: plan() });
  assert.equal(lost.why, 'unavailable'); assert.equal(writes, 1);
  assert.equal((await owner.query()).why, 'busy');
  owner.ws.close(); await sleep(20); finish(); await sleep(40);
  const replacement = await connect('owner');
  assert.equal((await replacement.query()).head.revision, 1); assert.equal(writes, 1);
  assert.equal(owner.messages.filter(m => m.requestId === lost.requestId).length, 1);
});

test('SQL readiness absent closes only inference configuration', async t => {
  const { app, connect } = await room(t, { inferenceConfigAllowMemory: false });
  const owner = await connect('owner'); assert.equal((await owner.query()).why, 'unavailable');
  assert.equal(app.game.healthy(), true); assert.ok(owner.messages.some(m => m.t === MSG.SNAPSHOT));
});

test('USD parsing is exact with no implicit default, and catalog refuses URLs or secret fields', () => {
  for (const v of ['', ' ', '-1', '1e3', 'NaN', '0.0000000001', '1000.000000001']) assert.equal(parseInferenceUsd(v), null);
  for (const v of ['0', '0.000000001', '0.1', '1000']) assert.equal(formatInferenceUsd(parseInferenceUsd(v)), v);
  assert.deepEqual(inferenceCatalogFromEnv({}), []);
  assert.throws(() => inferenceCatalogFromEnv({ MN_INFERENCE_CATALOG: '{' }));
  const p = plan(); p.companions[0].modelId = 'http://localhost:1234'; assert.throws(() => validateInferenceConfig(p));
  assert.throws(() => createGameServer({ saveSecret: 'inference-config-validation-fixture', inferenceCatalog: [{ ...catalog[0], apiKey: 'no-secret-field' }] }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '55555555-5555-4555-8555-555555555555';
const WORLD = 'companion-control-test';
const scope = { world: WORLD, owner: OWNER, character: CHARACTER };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(10); }
  throw new Error('condition timeout');
}
class Wire {
  constructor(url) {
    this.messages = []; this.ws = new WebSocket(url);
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', bytes => this.messages.push(JSON.parse(bytes.toString())));
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  async next(predicate, after = 0) { await until(() => this.messages.slice(after).some(predicate)); return this.messages.slice(after).find(predicate); }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}
async function fixture(t, { store = createMemoryStore(), timeoutMs = 1000, allowMemory = true } = {}) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8,
    worldId: WORLD, store, companionControlAllowMemory: allowMemory,
    saveSecret: 'companion-control-test-only', log() {},
    resolvePlayer: async (_req, m) => ({ owner: OWNER, character: CHARACTER, other: OTHER, otherCharacter: OTHER_CHARACTER }[m.token] ?? null),
    agentControl: { worldId: WORLD, bindings: [
      { ownerId: OWNER, characterId: CHARACTER, capabilities: ['move', 'chat'] },
      { ownerId: OTHER, characterId: OTHER_CHARACTER, capabilities: ['chat'] },
    ] },
  });
  server.game.companionControl.timeoutMs = timeoutMs;
  const port = await server.listen();
  const clients = [];
  let closed = false;
  const close = async () => { if (!closed) { closed = true; clients.forEach(c => c.close()); await server.close(); } };
  t.after(close);
  return { server, store, close,
    async connect(token, agent = false) {
      const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
      await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, token, ...(agent ? { agent: true } : {}), name: 'Control fixture', skin: 0, weapon: 0 });
      const result = await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
      return { client, result };
    },
  };
}
let seq = 0;
async function query(client, extra = {}) {
  const requestId = `control-${++seq}`;
  await client.send({ t: MSG.AGENT_OWNER, requestId, op: 'list', ...extra });
  return client.next(m => m.t === MSG.AGENT_OWNER_RESULT && m.requestId === requestId);
}
const action = (client, row, op) => query(client, { op, characterKey: row.characterKey, epoch: row.epoch, expectedRevision: row.control.revision });
const first = reply => reply.companions[0];

test('durable mode defaults stopped, isolates owners and requires explicit CAS permission to connect', async t => {
  const f = await fixture(t), { client: owner } = await f.connect('owner');
  const row = first(await query(owner));
  assert.equal(row.stopped, true); assert.deepEqual(row.control, { status: 'ready', revision: 0, stopped: true, savedAt: null });
  assert.equal((await f.connect('character', true)).result.t, MSG.ERROR);
  const guest = await f.connect(null), other = await f.connect('other');
  assert.equal((await query(guest.client)).why, 'forbidden');
  assert.deepEqual((await query(other.client)).companions.map(r => r.characterKey), [OTHER_CHARACTER]);
  assert.equal((await action(other.client, row, 'resume')).why, 'forbidden');
  assert.equal((await query(owner, { owner: OTHER })).why, 'invalid_request');
  const resumed = await action(owner, row, 'resume');
  assert.equal(resumed.ok, true); assert.equal(first(resumed).control.revision, 1); assert.equal(first(resumed).stopped, false);
  assert.equal((await f.connect('character', true)).result.t, MSG.WELCOME);
});

test('stop clears work immediately before storage confirms; old grants and legacy resume cannot bypass it', async t => {
  const f = await fixture(t), { client: owner } = await f.connect('owner');
  await action(owner, first(await query(owner)), 'resume');
  const { client: agent, result } = await f.connect('character', true);
  const row = first(await query(owner)), epoch = row.epoch;
  await agent.send({ t: MSG.AGENT_TASK, epoch, expectedTaskRevision: 0, actionId: 'move-before-stop',
    type: 'move', args: { mx: 1, mz: 0, durationMs: 1000 }, priority: 'goal' });
  const task = await agent.next(m => m.t === MSG.AGENT_STATE && m.state?.task?.actionId === 'move-before-stop');
  const sock = [...f.server.game.sockets.values()].find(s => s.agentIdentity === CHARACTER);
  clearInterval(f.server.game.timer); f.server.game.server.step();
  await agent.send({ t: MSG.INPUTS, control: { epoch, taskRevision: task.state.taskRevision },
    cmds: [{ seq: 100, mx: 1, mz: 0, ax: 1, az: 0, btn: 0, prs: 0, pt: f.server.game.server.world.tick + 10, w: 0 }] });
  await until(() => f.server.game.server.clients.get(sock.id).queue.length === 1);
  const save = f.store.saveCompanionControl; let settle, started = false;
  f.store.saveCompanionControl = raw => { started = true; return new Promise(resolve => { settle = () => resolve(save(raw)); }); };
  const stopResult = action(owner, row, 'stop');
  await until(() => started);
  assert.equal(f.server.game.agentControl.authorize(sock.id, epoch), false);
  assert.equal(f.server.game.agentControl.byCharacter(CHARACTER).task, null);
  assert.equal(f.server.game.server.clients.get(sock.id).queue.length, 0);
  let after = owner.messages.length;
  await owner.send({ t: MSG.AGENT_CONTROL, op: 'resume', characterId: CHARACTER });
  assert.equal((await owner.next(m => m.t === MSG.AGENT_STATE, after)).why, 'durable_control_required');
  assert.equal(f.server.game.agentControl.admit(CHARACTER, 999, 0).why, 'disabled');
  settle(); const stopped = first(await stopResult);
  f.store.saveCompanionControl = save;
  assert.equal(stopped.control.stopped, true); assert.equal(stopped.control.revision, 2);
  assert.equal((await query(owner, { op: 'resume', characterKey: CHARACTER, epoch, expectedRevision: 1 })).why, 'stale_control');
  const allowed = first(await action(owner, stopped, 'resume'));
  assert.equal(allowed.stopped, false); assert.equal(f.server.game.agentControl.authorize(sock.id, epoch), false);
  agent.close(); await until(() => !f.server.game.sockets.has(sock.id));
  const fresh = await f.connect('character', true);
  assert.equal(fresh.result.t, MSG.WELCOME); assert.notEqual(fresh.result.control.grant.scope.sessionId, result.control.grant.scope.sessionId);
});

test('confirmed stop hydrates on a new host and permission survives reentry without restoring old grants', async t => {
  const store = createMemoryStore(), f = await fixture(t, { store });
  const { client: owner } = await f.connect('owner');
  let row = first(await query(owner));
  row = first(await action(owner, row, 'resume'));
  row = first(await action(owner, row, 'stop'));
  assert.equal(row.control.revision, 2);
  await f.close();
  const second = await fixture(t, { store });
  const { client: owner2 } = await second.connect('owner');
  const loaded = first(await query(owner2));
  assert.equal(loaded.stopped, true); assert.equal(loaded.control.revision, 2);
  assert.equal((await second.connect('character', true)).result.t, MSG.ERROR);
  await action(owner2, loaded, 'resume'); await second.close();
  const third = await fixture(t, { store });
  assert.equal((await third.connect('character', true)).result.t, MSG.WELCOME);
});

test('readiness failure keeps agent admission closed while ordinary gameplay and private projection stay healthy', async t => {
  const store = createMemoryStore(); store.durable = true;
  store.checkCompanionControl = async () => { throw new Error('private upstream detail'); };
  const f = await fixture(t, { store, allowMemory: false });
  const owner = await f.connect('owner'); assert.equal(owner.result.t, MSG.WELCOME);
  const unavailable = await query(owner.client);
  assert.equal(unavailable.why, 'unavailable'); assert.equal(first(unavailable).control.status, 'unavailable');
  assert.equal(first(unavailable).stopped, true); assert.equal(JSON.stringify(unavailable).includes('upstream'), false);
  assert.equal((await f.connect('character', true)).result.t, MSG.ERROR);
  assert.equal(f.server.game.errors, 0);
});

test('an uncertain resume holds its slot, never enables late, and read recovery needs explicit owner resume', async t => {
  const f = await fixture(t, { timeoutMs: 40 }), { client: owner } = await f.connect('owner');
  const row = first(await query(owner)), save = f.store.saveCompanionControl;
  let settle;
  f.store.saveCompanionControl = raw => new Promise(resolve => { settle = () => resolve(save(raw)); });
  const failed = await action(owner, row, 'resume');
  assert.equal(failed.why, 'unavailable'); assert.equal(first(failed).stopped, true);
  assert.equal((await query(owner)).why, 'busy');
  settle(); await until(() => !f.server.game.companionControl.entries.get(CHARACTER).operation);
  assert.equal(f.server.game.agentControl.listOwned(OWNER)[0].stopped, true);
  assert.equal((await f.connect('character', true)).result.t, MSG.ERROR);
  const loaded = first(await query(owner));
  assert.equal(loaded.control.revision, 1); assert.equal(loaded.control.stopped, false); assert.equal(loaded.stopped, true);
  f.store.saveCompanionControl = save;
  assert.equal((await action(owner, loaded, 'resume')).ok, true);
  assert.equal((await f.connect('character', true)).result.t, MSG.WELCOME);
});

test('storage CAS conflict adopts evidence conservatively; routine reads do not pause a permitted agent', async t => {
  const f = await fixture(t), { client: owner } = await f.connect('owner');
  let row = first(await query(owner)); await action(owner, row, 'resume');
  const { client: agent } = await f.connect('character', true);
  row = first(await query(owner));
  const load = f.store.loadCompanionControl; let settle;
  f.store.loadCompanionControl = raw => raw.character === CHARACTER ? new Promise(resolve => { settle = () => resolve(load(raw)); }) : load(raw);
  const refresh = query(owner); await until(() => !!settle);
  assert.equal(f.server.game.companionControl.allowed(CHARACTER), true);
  settle(); await refresh; f.store.loadCompanionControl = load;
  await f.store.saveCompanionControl({ ...scope, expectedRevision: row.control.revision, stopped: false });
  const conflict = await action(owner, row, 'stop');
  assert.equal(conflict.why, 'conflict'); assert.equal(first(conflict).stopped, true);
  assert.equal(first(conflict).control.stopped, false); assert.equal(first(conflict).control.revision, 2);
  assert.equal((await action(owner, first(conflict), 'stop')).ok, true);
  agent.close();
});

test('owner disconnect while a resume saves cannot enable the character or receive a late private reply', async t => {
  const f = await fixture(t), { client: owner } = await f.connect('owner');
  const row = first(await query(owner)), save = f.store.saveCompanionControl; let settle;
  f.store.saveCompanionControl = raw => new Promise(resolve => { settle = () => resolve(save(raw)); });
  await owner.send({ t: MSG.AGENT_OWNER, requestId: 'late-private', op: 'resume', characterKey: CHARACTER,
    epoch: row.epoch, expectedRevision: row.control.revision });
  await until(() => !!settle); owner.close(); await until(() => f.server.game.profiles.accounts.get(OWNER)?.closed !== false);
  settle(); await until(() => !f.server.game.companionControl.entries.get(CHARACTER).operation);
  assert.equal(f.server.game.agentControl.listOwned(OWNER)[0].stopped, true);
  assert.equal(owner.messages.some(m => m.requestId === 'late-private'), false);
});

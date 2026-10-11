import { EventEmitter } from 'node:events';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { hmacSaves } from '../../server/saves.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';

export const RESOURCE_WORLD = 'resource-authority-test';
export const ACCOUNT_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ACCOUNT_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const turn = () => new Promise((resolve) => setImmediate(resolve));
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
export const copy = (value) => structuredClone(value);

export class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    this.readyState = 3; this.code = code; this.emit('close');
  }
  ping() {}
}

export function connect(host, name = 'Resource tester') {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  return {
    id, ws,
    hello() { ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name })), false); },
    send(command) { ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...command })), false); },
    of(type) { return ws.messages.filter((message) => message.t === type); },
    events(opId) {
      return ws.messages.filter((message) => message.t === MSG.EVENT && message.ev?.opId === opId)
        .map((message) => message.ev);
    },
  };
}

export function accountProfile({ goods = {}, tools = {} } = {}) {
  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT_ONE}`;
  profile.eco.pack.goods = { ...goods };
  profile.tools = { ...profile.tools, ...tools };
  return profile;
}

export function makeResourceStore(overrides = {}) {
  const base = createMemoryStore();
  return { base, store: { ...base, ...overrides } };
}

export function makeResourceHost(store, resolvePlayer = async () => ACCOUNT_ONE, options = {}) {
  return new GameHost({ seed: 71, bots: 0, log: () => {}, store, saves: hmacSaves('resource-test-key'),
    resolvePlayer, initializeAccounts: true, worldId: RESOURCE_WORLD, economicOperations: true,
    resourceOperations: true, ...options });
}

export async function startResourceHost(t, store, { accounts = [ACCOUNT_ONE], goods = {}, tools = {},
  resolvePlayer = async (_request, hello) => hello.name === 'guest' ? null : hello.name === 'second' ? ACCOUNT_TWO : ACCOUNT_ONE,
  options = {} } = {}) {
  for (const account of accounts) {
    const profile = accountProfile({ goods, tools });
    profile.pirateId = `account:${account}`;
    await store.initializeProfile(account, profile);
  }
  await store.checkResourceOperations();
  const host = makeResourceHost(store, resolvePlayer, options);
  t.after(async () => {
    if (host.closePromise) return;
    try { await host.close(); }
    catch (error) { if (error.code !== 'flush') throw error; }
  });
  await host.prepare();
  const clients = new Map();
  for (const name of accounts.map((account, index) => index === 1 ? 'second' : 'Resource tester')) {
    const client = connect(host, name); client.hello(); await Promise.all([...host.joins]);
    clients.set(name === 'second' ? ACCOUNT_TWO : accounts[0], client);
  }
  return { host, store, clients, client: clients.get(ACCOUNT_ONE), entity(account = ACCOUNT_ONE) {
    const client = clients.get(account);
    return host.server.clients.get(client.id).entity;
  } };
}

export function calmAt(host, entity, point) {
  const world = host.server.world, ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  ecs.y[entity] = Number.isFinite(point.y) ? point.y : world.map.groundAt(point.x, point.z);
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.castK[entity] = 0;
  ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

export function findNode(host, kind = 'wood') {
  const nodes = host.server.world.resources?.nodes;
  const node = nodes instanceof Map ? [...nodes.values()].find((candidate) => candidate.kind === kind) : null;
  if (!node) throw new Error(`fixture world has no ${kind} resource node`);
  return node;
}

export async function submitAndApply(host, client, command) {
  client.send(command);
  await turn();
  await host.economicAuthority.settle();
  host.server.step();
  return client.events(command.opId).at(-1);
}

export function resourceSnapshot(host) {
  const source = host.worldState.resources ?? host.server.world.resources;
  return copy(source);
}

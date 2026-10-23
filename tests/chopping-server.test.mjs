// TA02: the MN_CHOP flag through LocalServer, GameHost, /status and the env mapping; a real LocalServer step loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { GameHost } from '../server/host.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { CHOP } from '../src/data/chopping.js';

function local(options = {}) {
  const messages = [];
  const server = new LocalServer({ seed: 17, bots: 0, enemies: false, dev: false, send: (id, m) => messages.push(structuredClone(m)), ...options });
  return { server, messages };
}
function join(server) {
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Chop', skin: 0, weapon: 0, save: '' });
  return server.clients.get(1).entity;
}
const evs = (messages, type) => messages.filter((m) => m.t === MSG.EVENT && m.ev?.type === type).map((m) => m.ev);

test('protocol 71 and the LocalServer flag defaults to off', () => {
  assert.equal(PROTOCOL_VERSION, 71);
  assert.equal(local().server.world.chopVersion, 0);
  assert.equal(local({ chop: 'yes' }).server.world.chopVersion, 0);
  assert.equal(local({ chop: true }).server.world.chopVersion, 1);
});

test('a LocalServer with chop on runs the swing from the real step loop, falls the palm and drops a pile', () => {
  const { server, messages } = local({ chop: true });
  const e = join(server), w = server.world, ecs = w.ecs;
  const palm = [...w.resources.nodes.values()].find((n) => n.kind === 'palm');
  const profile = w.profiles.get(e);
  profile.tools.axe = 3; profile.eco.pack.cap = 40;
  const stand = () => { ecs.x[e] = palm.x - 1; ecs.y[e] = palm.y; ecs.z[e] = palm.z; ecs.vx[e] = ecs.vz[e] = ecs.moveMag[e] = 0; ecs.regenT[e] = 100; ecs.dashT[e] = -1; };
  let fell = null;
  for (let i = 0; i < 600 && !fell; i++) {
    stand();
    if (i % 24 === 0) server.receive(1, { t: MSG.CMD, type: 'resource', op: 'chop', node: palm.id });
    server.step();
    fell = evs(messages, 'chopFell')[0] ?? null;
  }
  assert.ok(fell, 'the palm fell through LocalServer.step');
  assert.equal(fell.node, palm.id);
  assert.ok(evs(messages, 'chopSwing').length >= 1);
  assert.ok(evs(messages, 'chopHit').length >= 1);
  assert.equal(w.resources.chop.piles.size, 1);
  assert.equal(palm.readyTick > w.tick, true);
  const ack = messages.find((m) => m.t === MSG.EVENT && m.ev?.type === 'resource' && m.ev.op === 'chop' && m.ev.ok)?.ev;
  assert.deepEqual([ack.cadence, ack.node], [24, palm.id]);
});

test('the host refuses MN_CHOP with resource operations on (log line, chop stays off) and passes it through otherwise', () => {
  const lines = [];
  const common = { seed: 71, bots: 0, log: (...a) => lines.push(a.join(' ')), saves: hmacSaves('test-key') };
  const refused = new GameHost({ ...common, store: createMemoryStore(), resolvePlayer: async () => 'a', initializeAccounts: true,
    worldId: 'chop-test', economicOperations: true, resourceOperations: true, chop: true });
  assert.deepEqual(lines, ['[srv] MN_CHOP=1 refused: resource operations are on until the v4 economy (TA04); chopping stays off']);
  assert.equal(refused.server.world.chopVersion, 0);
  assert.deepEqual(refused.status().storage.chop, { enabled: false });
  const on = new GameHost({ ...common, chop: true });
  assert.equal(lines.length, 1);
  assert.equal(on.server.world.chopVersion, 1);
  assert.deepEqual(on.status().storage.chop, { enabled: true });
  assert.deepEqual(new GameHost(common).status().storage.chop, { enabled: false });
  for (const h of [refused, on]) h.close?.();
});

test('createGameServer forwards the chop option to /status', async () => {
  for (const chop of [true, false]) {
    const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {}, chop });
    const port = await gs.listen();
    try { assert.deepEqual((await (await fetch(`http://127.0.0.1:${port}/status`)).json()).storage.chop, { enabled: chop }); }
    finally { await gs.close(); }
  }
  assert.equal(CHOP.slack, 4);
});

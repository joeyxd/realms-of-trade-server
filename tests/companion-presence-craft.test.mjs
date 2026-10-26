// IC05b: the presence body crafts its own stone axe or stone pickaxe. "craft <recipe>" takes one hand tool recipe,
// pays it from the body's own pack where it stands and submits one craft through the lane a player's craft takes.
// The rooms run the production lanes (starter workshop on): its 18-unit pack holds the 3 tronco + 2 piedra a stone
// tool costs, which the legacy 10-unit pack of a host without the workshop cannot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAFT_RECIPES } from '../src/data/resources.js';
import { TICK_RATE } from '../src/data/tuning.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { AgentPerception, AGENT_KIT } from '../server/agentPerception.mjs';
import { validWorld, validKit, PRESENCE_ORDERS, PRESENCE_RECIPES } from '../tools/agent/contract.mjs';
import { parseDecision, CONVERSATION_BODY_RESPONSE_SCHEMA, CONVERSATION_BODY_INSTRUCTION } from '../tools/agent/mind-contract.mjs';
import { AgentNetworkClient, normalizeWorld } from '../tools/agent/network-client.mjs';
import { PresenceDriver } from '../tools/agent/presence-driver.mjs';
import { presenceMessage } from '../tools/agent/pair-companion.mjs';
import { room, presence, summoned, attachMind, pack, seedPack, run, order, ownerSide, collide, turn, pause } from './helpers/companion-presence-room.mjs';

const tools = (w, entity) => ({ ...w.profiles.get(entity).tools });
const crafts = r => r.submitted.filter(s => s.msg.op === 'craft');
const goods = (w, entity) => [pack(w, entity, 'tronco'), pack(w, entity, 'piedra')];

test('(a) owner craft: a stone axe from 3 tronco + 2 piedra through the economic lane sets the tool and debits the pack', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, characterKey, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, ecs = w.ecs;
  assert.deepEqual(CRAFT_RECIPES.hacha_piedra.inputs, { tronco: 3, piedra: 2 });
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  const at = { x: ecs.x[entity], z: ecs.z[entity] }, commitsBefore = r.commits.length;
  const ordered = await order(owner, entry, 'craft', { recipe: 'hacha_piedra' });
  assert.deepEqual([ordered.presence.order, ordered.presence.reason], ['wait', 'crafting'], 'the body stands still while it crafts');
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted', JSON.stringify(r.outcomes));
  assert.equal(entry.order, 'wait');
  assert.deepEqual({ x: ecs.x[entity], z: ecs.z[entity] }, at, 'crafted where it stands');
  assert.equal(tools(w, entity).axe, 1);
  assert.equal(tools(w, entity).pickaxe, 0);
  assert.deepEqual(goods(w, entity), [0, 0], 'exactly the recipe was paid from the body pack');
  assert.equal(crafts(r).length, 1);
  assert.deepEqual(Object.keys(crafts(r)[0].msg).sort(), ['expectedRev', 'n', 'op', 'opId', 'recipe', 't', 'type']);
  assert.deepEqual([crafts(r)[0].msg.recipe, crafts(r)[0].msg.n], ['hacha_piedra', 1]);
  const own = r.commits.slice(commitsBefore).filter(request => request.account === characterKey);
  assert.equal(own.length, 1, 'one durable CAS commit for the companion account');
  assert.equal(own[0].command.op, 'craft');
  assert.equal(own[0].profile.tools.axe, 1);
  const stored = (await r.store.loadProfile(characterKey)).data;
  assert.equal(stored.tools.axe, 1);
  assert.deepEqual(stored.eco.pack.goods, {});
  const head = await presence(owner, 'load');
  assert.deepEqual([head.presence.order, head.presence.reason], ['wait', 'crafted']);
  for (let i = 0; i < 30; i++) r.app.game.server.step();
  assert.equal(entry.reason, 'crafted', 'an outcome reason stays until the next order');
});

test('(b) a craft with missing inputs is refused and nothing changes', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world;
  seedPack(w, entity, { tronco: 3, piedra: 1 });
  const loaded = await presence(owner, 'load'), before = structuredClone(w.profiles.get(entity));
  for (const recipe of ['hacha_piedra', 'pico_piedra']) {
    const refused = await presence(owner, 'craft', loaded.presence.revision, { recipe });
    assert.deepEqual([refused.ok, refused.why], [false, 'materials']);
    assert.deepEqual([refused.presence.order, refused.presence.revision, refused.presence.reason], ['wait', loaded.presence.revision, null]);
  }
  for (let i = 0; i < 60; i++) { r.app.game.server.step(); await turn(); }
  assert.deepEqual(w.profiles.get(entity), before, 'pack, tools and revision are untouched');
  assert.equal(r.submitted.length, 0);
  assert.equal(r.commits.length, 0);
  assert.equal(entry.craft ?? null, null);
});

test('(c) a second axe is refused already_owned; the pickaxe is still craftable', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world;
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  await order(owner, entry, 'craft', { recipe: 'hacha_piedra' });
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted');
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  const loaded = await presence(owner, 'load'), before = structuredClone(w.profiles.get(entity));
  const again = await presence(owner, 'craft', loaded.presence.revision, { recipe: 'hacha_piedra' });
  assert.deepEqual([again.ok, again.why], [false, 'already_owned']);
  assert.deepEqual([again.presence.revision, again.presence.reason], [loaded.presence.revision, 'crafted']);
  assert.deepEqual(w.profiles.get(entity), before);
  assert.equal(crafts(r).length, 1, 'the second axe never reached the lane');
  await order(owner, entry, 'craft', { recipe: 'pico_piedra' });
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted');
  assert.deepEqual(tools(w, entity), { axe: 1, pickaxe: 1 });
  assert.deepEqual(goods(w, entity), [0, 0]);
});

test('(d) the attached mind may order craft; a non-tool or malformed recipe is refused', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world;
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  const mind = await attachMind(r, owner);
  const loaded = await presence(mind, 'load'), revision = loaded.presence.revision;
  const refuse = async (why, extra) => {
    const result = await presence(mind, 'craft', revision, extra);
    assert.deepEqual([result.ok, result.why], [false, why], JSON.stringify(extra));
    assert.deepEqual([result.presence.order, result.presence.revision], ['wait', revision]);
  };
  // madera is a bench recipe and the rest are not recipes of the body.
  assert.equal(CRAFT_RECIPES.madera.hand, undefined);
  await refuse('unsupported_recipe', { recipe: 'madera' });
  await refuse('unsupported_recipe', { recipe: 'espada' });
  await refuse('invalid_request', {});
  await refuse('invalid_request', { recipe: 'Hacha' });
  await refuse('invalid_request', { recipe: 7 });
  await refuse('invalid_request', { recipe: 'hacha_piedra', n: 2 });
  await refuse('invalid_request', { recipe: 'hacha_piedra', node: 'coast-4' });
  assert.equal(r.submitted.length, 0);
  const ordered = await order(mind, entry, 'craft', { recipe: 'pico_piedra' });
  assert.equal(ordered.presence.reason, 'crafting');
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted');
  assert.equal(tools(w, entity).pickaxe, 1);
  assert.deepEqual(goods(w, entity), [0, 0]);
});

test('(e) a new order before the craft is submitted cancels it; the authority still refuses a pack that changed', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world;
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  await order(owner, entry, 'craft', { recipe: 'hacha_piedra' });
  const waited = await order(owner, entry, 'wait');
  assert.deepEqual([waited.presence.order, waited.presence.reason], ['wait', null]);
  for (let i = 0; i < 60; i++) { r.app.game.server.step(); await turn(); }
  assert.equal(r.submitted.length, 0, 'the replaced craft was never submitted');
  assert.equal(tools(w, entity).axe, 0);
  // Accepted with the inputs, then the pack loses a log before the body settles: the authority answers materials.
  await order(owner, entry, 'craft', { recipe: 'hacha_piedra' });
  w.profiles.get(entity).eco.pack.goods.tronco = 2;
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'materials');
  assert.equal(crafts(r).length, 1);
  assert.equal(tools(w, entity).axe, 0);
  assert.deepEqual(goods(w, entity), [2, 2], 'a refused craft takes nothing');
});

test('(f) a busy economic lane is retried at least 1 s later, then crafts once', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, characterKey, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { sock, entity: ownerEntity } = ownerSide(r);
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  await order(owner, entry, 'craft', { recipe: 'hacha_piedra' });
  let release = null;
  await run(r, () => release !== null, 1500, () => { if (entry.craft?.opId && !release) release = collide(r, sock, ownerEntity, characterKey); });
  await turn();
  assert.equal(crafts(r).length, 1);
  assert.equal(entry.craft.tries, 1, 'busy is retried, not final');
  release();
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted');
  assert.equal(crafts(r).length, 2);
  assert.ok(crafts(r)[1].tick - crafts(r)[0].tick >= TICK_RATE);
  assert.notEqual(crafts(r)[1].msg.opId, crafts(r)[0].msg.opId);
  assert.deepEqual(goods(w, entity), [0, 0], 'paid exactly once');
});

test('(g) with economic resource operations off the direct resourceCmd path crafts too', { timeout: 60000 }, async t => {
  const r = await room(t, { economic: false }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world;
  assert.equal(r.app.game.economicAuthority, null);
  // Without the workshop a body keeps the legacy 10-unit pack, too small for 3 tronco (9) + 2 piedra (4):
  // this fixture widens that one pack so the direct lane can be shown end to end.
  w.profiles.get(entity).eco.pack.cap = 13;
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  await order(owner, entry, 'craft', { recipe: 'pico_piedra' });
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted');
  assert.equal(tools(w, entity).pickaxe, 1);
  assert.deepEqual(goods(w, entity), [0, 0]);
  assert.equal(r.commits.length, 0);
});

test('(h) the mind sees the body kit: its belt tools and its tronco and piedra, read only and absent-preserving', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world;
  assert.deepEqual(AGENT_KIT, { tools: ['axe', 'pickaxe'], goods: ['tronco', 'piedra'] });
  const mind = await attachMind(r, owner);
  // The kit of the newest snapshot the mind received, ticking until it shows the expected one (the wire is asynchronous).
  const latest = () => mind.messages.filter(m => m.t === MSG.SNAPSHOT && m.world).at(-1)?.world.kit;
  const kitBecomes = async expected => {
    for (let i = 0; i < 120 && JSON.stringify(latest()) !== JSON.stringify(expected); i++) {
      r.app.game.server.step(); await turn(); await pause(5);
    }
    return latest();
  };
  const none = { tools: { axe: 0, pickaxe: 0 }, pack: { tronco: 0, piedra: 0 } };
  assert.deepEqual(await kitBecomes(none), none);
  seedPack(w, entity, { tronco: 3, piedra: 2 });
  const stocked = { tools: { axe: 0, pickaxe: 0 }, pack: { tronco: 3, piedra: 2 } };
  assert.deepEqual(await kitBecomes(stocked), stocked);
  await order(mind, entry, 'craft', { recipe: 'hacha_piedra' });
  await run(r, () => entry.reason !== 'crafting');
  const axe = { tools: { axe: 1, pickaxe: 0 }, pack: { tronco: 0, piedra: 0 } };
  assert.deepEqual(await kitBecomes(axe), axe);
  // The server block without a profile has no kit; the runner keeps a valid kit and drops only a malformed one.
  const perception = new AgentPerception(), profiles = w.profiles;
  w.profiles = new Map();
  try {
    const projected = perception.project({ t: MSG.SNAPSHOT, tick: w.tick, ack: 0, you: [], ents: [] }, w, entity).at(-1);
    assert.equal(Object.hasOwn(projected.world, 'kit'), false);
  } finally { w.profiles = profiles; }
  const self = { x: w.ecs.x[entity], y: w.ecs.y[entity], z: w.ecs.z[entity] };
  const raw = { v: 1, tick: 1, hours: 12, nodes: [], truncated: false, water: null, bench: null };
  const kit = { tools: { axe: 1, pickaxe: 0 }, pack: { tronco: 2, piedra: 0 } };
  assert.equal(Object.hasOwn(normalizeWorld(raw, self), 'kit'), false, 'an old server sends no kit and the world stays valid');
  assert.deepEqual(normalizeWorld({ ...raw, kit }, self).kit, kit);
  for (const bad of [{ tools: { axe: 2, pickaxe: 0 }, pack: kit.pack }, { tools: kit.tools, pack: { tronco: -1, piedra: 0 } },
    { tools: kit.tools, pack: { ...kit.pack, madera: 1 } }, null]) {
    const world = normalizeWorld({ ...raw, kit: bad }, self);
    assert.ok(world && !Object.hasOwn(world, 'kit'), JSON.stringify(bad));
  }
  assert.equal(validKit(kit), true);
  assert.equal(validWorld({ hours: 12, nodes: [], truncated: false, water: null, bench: null, kit }), true);
  assert.equal(validWorld({ hours: 12, nodes: [], truncated: false, water: null, bench: null, kit: { ...kit, extra: 1 } }), false);
});

test('(i) runner: the mind keeps a craft only for a stone tool recipe, the driver sends it with its own load revision', async () => {
  const reply = args => JSON.stringify({ v: 1, decision: { type: 'reply', args } });
  const body = { body: true, world: { hours: 12, nodes: [], truncated: false, water: null, bench: null } };
  assert.deepEqual(PRESENCE_ORDERS, ['follow', 'wait', 'return', 'gather', 'craft']);
  assert.deepEqual(PRESENCE_RECIPES, ['hacha_piedra', 'pico_piedra']);
  for (const recipe of PRESENCE_RECIPES)
    assert.deepEqual(parseDecision(reply({ text: 'Hago la herramienta.', body: 'craft', recipe }), 8192, 'conversation', body),
      { type: 'reply', args: { text: 'Hago la herramienta.', body: 'craft', recipe } });
  for (const args of [{ text: 'Vale.', body: 'craft', recipe: 'madera' }, { text: 'Vale.', body: 'craft' }])
    assert.deepEqual(parseDecision(reply(args), 8192, 'conversation', body), { type: 'reply', args: { text: 'Vale.' } }, JSON.stringify(args));
  assert.equal(parseDecision(reply({ text: 'Vale.', body: 'follow', recipe: 'hacha_piedra' }), 8192, 'conversation', body), null, 'only craft takes a recipe');
  assert.equal(parseDecision(reply({ text: 'Vale.', body: 'craft', recipe: 'hacha_piedra', node: 'coast-4' }), 8192, 'conversation', body), null);
  assert.equal(parseDecision(reply({ text: 'Vale.', body: 'craft', recipe: 'hacha_piedra' }), 8192, 'conversation', { world: body.world }), null,
    'chat-only mode is unchanged');
  const args = CONVERSATION_BODY_RESPONSE_SCHEMA.properties.decision.oneOf[1].properties.args;
  assert.deepEqual(args.properties.recipe.enum, ['hacha_piedra', 'pico_piedra']);
  assert.deepEqual(args.required, ['text']);
  assert.match(CONVERSATION_BODY_INSTRUCTION, /args\.recipe "hacha_piedra"/);
  assert.match(CONVERSATION_BODY_INSTRUCTION, /kit/);
  // The driver sends the recipe with the revision of its own load; malformed crafts send nothing.
  let now = 5_000_000;
  const calls = [], driver = new PresenceDriver({ now: () => now, setTimer: (fn, ms) => { now += ms; return setImmediate(fn); },
    clearTimer: timer => clearImmediate(timer), request: async (op, options) => {
      calls.push({ op, options });
      return { ok: true, why: null, enabled: true, presence: { status: 'present', order: 'wait', revision: 4, reason: op === 'craft' ? 'crafting' : null } };
    } });
  for (const arg of [undefined, 'madera', 7, 'Hacha'])
    assert.deepEqual(await driver.order('craft', arg), { ok: false, why: 'invalid_request' }, String(arg));
  assert.deepEqual(await driver.order('follow', 'hacha_piedra'), { ok: false, why: 'invalid_request' });
  assert.equal(calls.length, 0);
  assert.equal((await driver.order('craft', 'pico_piedra')).presence.reason, 'crafting');
  assert.deepEqual(calls, [{ op: 'load', options: {} }, { op: 'craft', options: { expectedRevision: 4, recipe: 'pico_piedra' } }]);
});

test('(j) the CLI shows craft orders, their refusals and the craft outcomes in fixed Spanish lines', () => {
  const event = (op, ok, why = null, presence = null) => ({ type: 'presence_order', sessionId: 's', data: { op, ok, why, presence } });
  const body = reason => ({ status: 'present', order: 'wait', revision: 3, reason });
  assert.equal(presenceMessage(event('craft', true, null, body('crafting'))), 'Tu compañero acepta fabricar la herramienta; cuerpo presente en el mundo.');
  const lines = new Set();
  for (const why of ['materials', 'already_owned', 'unsupported_recipe']) {
    const m = presenceMessage(event('craft', false, why));
    assert.ok(m.startsWith('Tu compañero no pudo fabricar la herramienta: ') && m.length < 140, m);
    lines.add(m);
  }
  assert.equal(lines.size, 3);
  assert.equal(presenceMessage(event('craft', false, 'materials')),
    'Tu compañero no pudo fabricar la herramienta: le faltan materiales en su mochila (3 tronco y 2 piedra).');
  assert.equal(presenceMessage(event('load', true, null, body('crafting'))), 'Estado del cuerpo: presente en el mundo. Está fabricando la herramienta.');
  assert.equal(presenceMessage(event('load', true, null, body('crafted'))), 'Estado del cuerpo: presente en el mundo. Ya fabricó la herramienta que le pediste.');
  assert.equal(presenceMessage(event('load', true, null, body('materials'))), 'Estado del cuerpo: presente en el mundo. No pudo fabricar: le faltan materiales.');
});

// The scriptable transport of tests/agent-network-client.test.mjs: frames pushed through deliver reach the client.
function stubTransport() {
  return { ws: { readyState: 1 }, outbox: [], closed: false, sent: [], opened: Promise.resolve(true),
    callbacks: { message: [], snapshot: [], close: [] },
    onMessage(cb) { this.callbacks.message.push(cb); }, onSnapshot(cb) { this.callbacks.snapshot.push(cb); },
    onClose(cb) { this.callbacks.close.push(cb); }, start() {}, sendInput() {}, flush() {},
    send(message) { this.sent.push(structuredClone(message)); },
    deliver(message) { for (const cb of this.callbacks.message) cb(message); },
    close() { if (this.closed) return; this.closed = true; this.ws.readyState = 3; for (const cb of this.callbacks.close) cb({ code: 1000, reason: '' }); } };
}

test('(k) network client: craft carries exactly one stone tool recipe and its receipts report crafting and crafted', async t => {
  const SCOPE = { ownerId: 'owner-1', characterId: 'companion-1', worldId: 'lab-world', sessionId: 'local-session' };
  const grant = { v: 1, scope: SCOPE, controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: ['chat', 'presence'] };
  const transport = stubTransport();
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant, authorization: { token: 'paired-token' }, transportFactory: () => transport });
  t.after(() => client.close());
  // The handshake settles through the scripted WELCOME; its promise result is not part of this test.
  client.connect({ autoTick: false, timeoutMs: 5000 }).catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  transport.deliver({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 12, seed: 42, tick: 1,
    control: { grant: { ...grant, scope: { ...SCOPE, sessionId: 'server-session' } }, state: 'active', taskRevision: 0, task: null } });
  for (const options of [{ expectedRevision: 1 }, { expectedRevision: 1, recipe: 'madera' }, { expectedRevision: 1, recipe: 7 },
    { expectedRevision: 1, recipe: 'hacha_piedra', node: 'coast-4' }, { recipe: 'hacha_piedra' }, { expectedRevision: -1, recipe: 'pico_piedra' }])
    assert.deepEqual(await client.presence('craft', options), { ok: false, why: 'invalid_request' }, JSON.stringify(options));
  assert.deepEqual(await client.presence('gather', { expectedRevision: 1, recipe: 'hacha_piedra' }), { ok: false, why: 'invalid_request' });
  assert.equal(transport.sent.some(m => m.t === MSG.AGENT_COMPANION_PRESENCE), false);
  const crafting = client.presence('craft', { expectedRevision: 7, recipe: 'hacha_piedra' });
  const sent = transport.sent.at(-1);
  assert.deepEqual(Object.keys(sent), ['t', 'requestId', 'op', 'expectedRevision', 'recipe']);
  assert.deepEqual([sent.op, sent.expectedRevision, sent.recipe], ['craft', 7, 'hacha_piedra']);
  const body = { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'wait', revision: 8, entity: 12, reason: 'crafting' };
  transport.deliver({ t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId: sent.requestId, ok: true, why: null, enabled: true, presence: body });
  assert.deepEqual(await crafting, { ok: true, why: null, enabled: true, presence: body });
  const load = client.presence('load');
  transport.deliver({ t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId: transport.sent.at(-1).requestId, ok: true, why: null, enabled: true,
    presence: { ...body, revision: 9, reason: 'crafted' } });
  assert.equal((await load).presence.reason, 'crafted');
  assert.deepEqual(client.presenceState, { status: 'present', order: 'wait', revision: 9, reason: 'crafted' });
});

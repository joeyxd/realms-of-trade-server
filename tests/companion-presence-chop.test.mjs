// IC05b/c: the presence body works tool nodes. "gather <node>" on a palm (axe) or a rock or iron ore vein
// (pickaxe) strikes until the node's final hit, every hit its own economic op through the lane a player's
// gather takes. A body's palm hits are scored at the fixed minimum quality 0, with the server's own challenge.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { MSG } from '../src/net/protocol.js';
import { RESOURCE_KINDS } from '../src/data/resources.js';
import { TICK_RATE } from '../src/data/tuning.js';
import { harvestLoot } from '../src/data/harvestLoot.js';
import { timingYield } from '../src/sim/systems/loggingTiming.js';
import { presenceAnchor } from '../server/companionPresencePolicy.mjs';
import { connectedMessage, presenceMessage } from '../tools/agent/pair-companion.mjs';
import { room, presence, summoned, attachMind, zoneNode, pack, seedPack, run, order, ownerSide, collide, turn, pause } from './helpers/companion-presence-room.mjs';

const tools = (w, entity) => ({ ...w.profiles.get(entity).tools });
const giveTool = (w, entity, tool) => { w.profiles.get(entity).tools[tool] = 1; w.profileDirty.add(entity); };
const hits = r => r.submitted.filter(s => s.msg.op === 'gather');
const ownCommits = (r, characterKey) => r.commits.filter(request => request.account === characterKey && request.command.op === 'gather');

test('(a) a palm without an axe is refused no_tool before the body takes a step', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, ecs = w.ecs, { node } = zoneNode(w, 'palm');
  assert.equal(tools(w, entity).axe, 0);
  const loaded = await presence(owner, 'load'), at = { x: ecs.x[entity], z: ecs.z[entity] };
  const refused = await presence(owner, 'gather', loaded.presence.revision, { node: node.id });
  assert.deepEqual([refused.ok, refused.why], [false, 'no_tool']);
  assert.deepEqual([refused.presence.order, refused.presence.revision], ['wait', loaded.presence.revision]);
  for (let i = 0; i < 120; i++) { r.app.game.server.step(); await turn(); }
  assert.deepEqual({ x: ecs.x[entity], z: ecs.z[entity] }, at, 'the body did not move');
  assert.equal(entry.order, 'wait');
  assert.equal(r.submitted.length, 0, 'nothing reached the economic lane');
  assert.equal(r.app.game.loggingAim.challenges.has(entry.body.id), false, 'no challenge was issued');
  // The same holds for a rock or an ore vein without a pickaxe.
  const rock = [...w.resources.nodes.values()].find(n => n.kind === 'rock');
  const again = await presence(owner, 'gather', loaded.presence.revision, { node: rock.id });
  assert.deepEqual([again.ok, again.why], [false, 'no_tool']);
});

test('(b) the always-on chop mode refuses the companion palm gather without felling or awarding goods', { timeout: 90000 }, async t => {
  const r = await room(t, { lanes: 'torch' }), { owner, characterKey, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, { node } = zoneNode(w, 'palm');
  assert.equal(game.worldState.resources.v, 3, 'palm timing v3 is on');
  assert.equal(w.harvestLootEnabled, true, 'palm loot rules are on');
  giveTool(w, entity, 'axe');
  const mind = await attachMind(r, owner), seenFrom = mind.messages.length, ownerFrom = owner.messages.length, before = pack(w, entity, 'tronco'), rev = node.rev;
  await order(mind, entry, 'gather', { node: node.id });
  await run(r, () => entry.order === 'wait', 4000);
  assert.equal(entry.reason, 'chop_mode');
  assert.equal(pack(w, entity, 'tronco'), before);
  assert.equal(node.rev, rev); assert.equal(node.hits, 0);
  assert.equal(hits(r).length, 1);
  const receipts = ownCommits(r, characterKey);
  assert.equal(receipts.length, 1);
  assert.deepEqual([receipts[0].ack.ok, receipts[0].ack.why], [false, 'chopMode']);
  assert.equal(game.worldState.resources.logging[node.id].quality, 0, 'the palm ledger holds no perfect hit');
  assert.equal(tools(w, entity).axe, 1, 'the axe is a belt tool and stays');
  await pause(50);
  const seen = mind.messages.slice(seenFrom);
  assert.equal(seen.some(m => m.t === MSG.PROFILE || m.t === MSG.SAVE), false, 'no profile or save reaches the mind');
  assert.equal(seen.some(m => m.t === MSG.EVENT && ['resource', 'resourceHit', 'commandDenied', 'loggingAim'].includes(m.ev?.type)), false);
  assert.equal(owner.messages.slice(ownerFrom).some(m => m.ev?.type === 'loggingAim'), false, 'the body challenge goes to no client');
  assert.equal(mind.ws.readyState, WebSocket.OPEN);
  const head = await presence(mind, 'load');
  assert.deepEqual([head.presence.order, head.presence.reason], ['wait', 'chop_mode']);
});

test('(c) no client can supply, read or raise a body challenge or its timing', { timeout: 60000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, aim = game.loggingAim, { node } = zoneNode(w, 'palm');
  giveTool(w, entity, 'axe');
  const mind = await attachMind(r, owner);
  const loaded = await presence(owner, 'load'), revision = loaded.presence.revision;
  // The presence op has exact keys: a challenge, a timing or a quality is never part of an order.
  for (const extra of [{ challenge: 'forged' }, { timing: { quality: 1 } }, { quality: 1 }, { receivedTick: 1 }]) {
    for (const client of [owner, mind]) {
      const refused = await presence(client, 'gather', revision, { node: node.id, ...extra });
      assert.deepEqual([refused.ok, refused.why], [false, 'invalid_request'], JSON.stringify(extra));
    }
  }
  // A mind socket has no command lane: its aim and gather commands are dropped without a challenge or an op.
  const mindFrom = mind.messages.length;
  await mind.send({ t: MSG.CMD, type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev });
  await mind.send({ t: MSG.CMD, type: 'resource', op: 'gather', opId: 'mind-forged', node: node.id, expectedRev: node.rev, challenge: 'forged' });
  await pause(100);
  assert.equal(mind.messages.slice(mindFrom).some(m => m.ev?.type === 'loggingAim' || m.ev?.type === 'resource'), false);
  const mindSock = [...game.sockets.values()].find(s => s.companionMind);
  assert.ok(mindSock);
  assert.equal(aim.challenges.has(mindSock.id), false, 'the mind socket holds no challenge');
  assert.equal(r.submitted.length, 0, 'and the body submitted nothing');
  // The resident entry refuses every socket id, so a player's aim row can never be a body's.
  const { sock } = ownerSide(r);
  assert.deepEqual(aim.resident(sock.id, node.id, node.rev), { why: 'command' });
  // The body's own challenge: issued only through the resident entry, keyed by the body client id.
  const ecs = w.ecs;
  ecs.x[entity] = node.x + 1; ecs.z[entity] = node.z; ecs.y[entity] = w.map.groundAt(node.x + 1, node.z);
  ecs.regenT[entity] = 100;
  const issued = aim.resident(entry.body.id, node.id, node.rev);
  assert.equal(issued.why, '', JSON.stringify(issued));
  assert.equal(aim.challenges.get(entry.body.id).resident, true);
  // A proof with another challenge id or for another entity is refused; inside the perfect window it is never stamped.
  const command = { node: node.id, expectedRev: node.rev, challenge: issued.public.challengeId, opId: 'probe-1' };
  assert.equal(aim.proof(entry.body.id, entity, { ...command, challenge: 'forged' }), null);
  assert.equal(aim.proof(entry.body.id, ownerSide(r).entity, command), null);
  // A player beside the same palm aims through its own socket in the same tick: its row is keyed by its socket.
  const ownerAt = ownerSide(r), ownerFrom = owner.messages.length;
  giveTool(w, ownerAt.entity, 'axe');
  ecs.x[ownerAt.entity] = node.x - 1; ecs.z[ownerAt.entity] = node.z; ecs.y[ownerAt.entity] = w.map.groundAt(node.x - 1, node.z);
  ecs.regenT[ownerAt.entity] = 100; ecs.moveMag[ownerAt.entity] = 0; ecs.vx[ownerAt.entity] = 0; ecs.vz[ownerAt.entity] = 0;
  game.receive(ownerAt.sock, { t: MSG.CMD, type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev });
  const ownerAim = (await owner.next(m => m.ev?.type === 'loggingAim', ownerFrom)).ev;
  assert.equal(ownerAim.ok, true, JSON.stringify(ownerAim));
  assert.notEqual(ownerAim.challengeId, issued.public.challengeId);
  assert.equal(aim.challenges.get(ownerAt.sock.id).resident, undefined);
  // The owner's challenge id never proves the body's hit.
  assert.equal(aim.proof(entry.body.id, entity, { ...command, challenge: ownerAim.challengeId }), null);
  const perfect = issued.public.challenge.targetTick;
  assert.equal(ownerAim.challenge.targetTick, perfect, 'both challenges opened on the same tick');
  while (game.worldState.resourceTick() < perfect) game.server.step();
  assert.equal(aim.proof(entry.body.id, entity, command), null, 'a resident proof above quality 0 is refused');
  assert.equal(aim.challenges.get(entry.body.id).opId, undefined, 'nothing was stamped');
  // The player's proof on the very same tick keeps its perfect quality: the player path is unchanged.
  const playerProof = aim.proof(ownerAt.sock.id, ownerAt.entity, { node: node.id, expectedRev: node.rev, challenge: ownerAim.challengeId, opId: 'player-1' });
  assert.equal(playerProof.quality, 1);
  while (game.worldState.resourceTick() <= perfect + issued.public.challenge.width) game.server.step();
  assert.equal(aim.proof(entry.body.id, entity, command)?.quality, 0, 'after the perfect window the body proof is stamped at quality 0');
});

test('(d) a rock with the pickaxe: four hits, the rock yield of stone, the final hit reports broken', { timeout: 90000 }, async t => {
  // Seed 11 has a rock inside the zone (mine-786, 26.0 from the anchor); seed 42 has none.
  const r = await room(t, { seed: 11 }), { owner, characterKey, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w, 'rock');
  giveTool(w, entity, 'pickaxe');
  const before = pack(w, entity, 'piedra'), rev = node.rev, reasons = [];
  await order(owner, entry, 'gather', { node: node.id });
  await run(r, () => entry.order === 'wait', 4000, () => { if (reasons.at(-1) !== entry.reason) reasons.push(entry.reason); });
  assert.equal(entry.reason, 'broken', JSON.stringify(r.outcomes.map(o => o.why)));
  assert.deepEqual(reasons.filter(reason => /^hit_/.test(reason ?? '')), ['hit_1_of_4', 'hit_2_of_4', 'hit_3_of_4']);
  const sent = hits(r);
  assert.equal(sent.length, 4);
  for (const s of sent) assert.deepEqual(Object.keys(s.msg).sort(), ['expectedRev', 'node', 'op', 'opId', 't', 'type']);
  for (let i = 1; i < 4; i++) assert.ok(sent[i].tick - sent[i - 1].tick >= RESOURCE_KINDS.rock.actionTicks, 'each hit waits out the cooldown');
  const receipts = ownCommits(r, characterKey);
  assert.equal(receipts.length, 4);
  assert.deepEqual(receipts.map(q => [q.ack.count, q.ack.remaining, q.ack.broken]), [[0, 3, false], [0, 2, false], [0, 1, false], [2, 0, true]]);
  assert.equal(pack(w, entity, 'piedra') - before, RESOURCE_KINDS.rock.yield);
  assert.equal(node.rev, rev + 4); assert.equal(node.hits, 4); assert.ok(node.readyTick > w.tick);
  // The game rule keeps the belt tool: broken is the rock, the pickaxe flag is untouched.
  assert.equal(tools(w, entity).pickaxe, 1);
  assert.equal((await r.store.loadProfile(characterKey)).data.eco.pack.goods.piedra, before + RESOURCE_KINDS.rock.yield);
});

test('(e) a new order mid-chain stops it after the current hit', { timeout: 60000 }, async t => {
  const r = await room(t, { seed: 11 }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w, 'rock');
  giveTool(w, entity, 'pickaxe');
  await order(owner, entry, 'gather', { node: node.id });
  await run(r, () => entry.reason === 'hit_1_of_4');
  const waited = await order(owner, entry, 'wait');
  assert.deepEqual([waited.presence.order, waited.presence.reason], ['wait', null]);
  for (let i = 0; i < 400; i++) { r.app.game.server.step(); await turn(); await r.app.game.economicAuthority.settle(); }
  assert.equal(hits(r).length, 1, 'no further hit after the new order');
  assert.equal(node.hits, 1);
  assert.deepEqual([entry.order, entry.reason], ['wait', null]);
  // A new gather on the same node picks the chain up where the node is.
  await order(owner, entry, 'gather', { node: node.id });
  await run(r, () => entry.order === 'wait', 4000);
  assert.equal(entry.reason, 'broken');
  assert.equal(hits(r).length, 4);
});

test('(f) a busy companion palm gather retries and then reports chop_mode', { timeout: 90000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, characterKey, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, { node } = zoneNode(w, 'palm');
  giveTool(w, entity, 'axe');
  const { sock, entity: ownerEntity } = ownerSide(r);
  await order(owner, entry, 'gather', { node: node.id });
  let release = null;
  await run(r, () => release !== null, 3000, () => { if (entry.gather.opId && !release) release = collide(r, sock, ownerEntity, characterKey); });
  await turn();
  assert.equal(hits(r).length, 1);
  assert.equal(entry.order, 'gather', 'busy is retried, not final');
  assert.equal(entry.gather.tries, 1);
  release();
  await run(r, () => entry.reason === 'chop_mode', 3000);
  const sent = hits(r);
  assert.equal(sent.length, 2);
  assert.deepEqual(r.outcomes.slice(0, 2).map(o => o.why), ['busy', 'chopMode']);
  assert.ok(sent[1].tick - sent[0].tick >= TICK_RATE, 'the retry waits at least 1 s of ticks');
  assert.notEqual(sent[1].msg.opId, sent[0].msg.opId);
  assert.notEqual(sent[1].msg.challenge, sent[0].msg.challenge, 'the expired challenge was replaced');
  const receipt = ownCommits(r, characterKey).at(-1);
  assert.deepEqual([receipt.ack.ok, receipt.ack.why], [false, 'chopMode']);
  assert.equal(node.hits, 0);
});

test('(g) with economic resource operations off the direct path also refuses companion palm gather in chop mode', { timeout: 60000 }, async t => {
  const r = await room(t, { economic: false }), { owner, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, { node } = zoneNode(w, 'palm');
  assert.equal(game.economicAuthority, null);
  giveTool(w, entity, 'axe');
  const before = pack(w, entity, 'tronco');
  await order(owner, entry, 'gather', { node: node.id });
  await run(r, () => entry.order === 'wait', 4000);
  assert.equal(entry.reason, 'chop_mode', JSON.stringify(r.outcomes.map(o => o.why)));
  assert.equal(hits(r).length, 1);
  for (const s of hits(r)) assert.equal(Object.hasOwn(s.msg, 'challenge'), false, 'no timing on this host');
  assert.equal(pack(w, entity, 'tronco') - before, 0, 'refused gathers award no goods');
  assert.equal(r.commits.length, 0);
});

test('(h) bootstrap on one world: gather wood and stone, craft the axe, chop a palm', { timeout: 120000 }, async t => {
  const r = await room(t, { lanes: 'torch' }), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, anchor = presenceAnchor(w);
  const mind = await attachMind(r, owner);
  const back = async () => { await order(owner, entry, 'return'); await run(r, () => entry.order === 'wait'); };
  // One real wood gather and one real stone gather; the rest of the recipe is seeded as earlier gathers.
  for (const kind of ['wood', 'stone']) {
    const { node } = zoneNode(w, kind);
    await order(mind, entry, 'gather', { node: node.id });
    await run(r, () => entry.order === 'wait');
    assert.equal(entry.reason, 'gathered', kind);
    await back();
  }
  assert.deepEqual([pack(w, entity, 'tronco'), pack(w, entity, 'piedra')], [1, 1]);
  seedPack(w, entity, { tronco: 2, piedra: 1 });
  const crafted = await order(mind, entry, 'craft', { recipe: 'hacha_piedra' });
  assert.deepEqual([crafted.presence.order, crafted.presence.reason], ['wait', 'crafting']);
  await run(r, () => entry.reason !== 'crafting');
  assert.equal(entry.reason, 'crafted');
  assert.equal(tools(w, entity).axe, 1);
  assert.deepEqual([pack(w, entity, 'tronco'), pack(w, entity, 'piedra')], [0, 0]);
  const { node: palm } = zoneNode(w, 'palm');
  await order(mind, entry, 'gather', { node: palm.id });
  await run(r, () => entry.order === 'wait', 4000);
  assert.equal(entry.reason, 'chop_mode');
  assert.equal(pack(w, entity, 'tronco'), 0, 'the companion needs its own future chop path');
  assert.ok(Math.hypot(w.ecs.x[entity] - anchor.x, w.ecs.z[entity] - anchor.z) <= 30, 'still inside the zone');
});

test('(i) the CLI shows hit progress, the felled and broken outcomes and the tool node refusals in fixed Spanish lines', () => {
  const event = (op, ok, why = null, presence = null) => ({ type: 'presence_order', sessionId: 's', data: { op, ok, why, presence } });
  const body = (order, reason) => ({ status: 'present', order, revision: 5, reason });
  assert.equal(presenceMessage(event('load', true, null, body('gather', 'hit_2_of_3'))), 'Estado del cuerpo: presente en el mundo. Lleva 2 de 3 golpes.');
  assert.equal(presenceMessage(event('load', true, null, body('gather', 'hit_3_of_5'))), 'Estado del cuerpo: presente en el mundo. Lleva 3 de 5 golpes.');
  assert.equal(presenceMessage(event('load', true, null, body('wait', 'felled'))), 'Estado del cuerpo: presente en el mundo. Ya taló la palmera.');
  assert.equal(presenceMessage(event('load', true, null, body('wait', 'broken'))), 'Estado del cuerpo: presente en el mundo. Ya picó la roca hasta romperla.');
  assert.equal(presenceMessage(event('load', true, null, body('wait', 'hit_0_of_99'))), 'Estado del cuerpo: presente en el mundo.', 'malformed progress stays plain');
  assert.equal(presenceMessage(event('gather', false, 'no_tool')),
    'Tu compañero no pudo recolectar: le falta la herramienta: un hacha para la palmera, un pico para la roca.');
  assert.equal(presenceMessage(event('gather', false, 'shared_palm')),
    'Tu compañero no pudo recolectar: otro pirata ya dio golpes perfectos a esa palmera; que la termine quien la empezó.');
  assert.equal(presenceMessage(event('load', true, null, body('wait', 'shared_palm'))),
    'Estado del cuerpo: presente en el mundo. Dejó la palmera: otro pirata ya le dio golpes perfectos.');
  const connected = connectedMessage({ name: 'Luna', capabilities: ['chat', 'presence'] }, 'm1');
  for (const words of ['recoge madera o piedra', 'fabrica un hacha o un pico', 'tala esa palmera', 'pica esa roca']) assert.ok(connected.includes(words), words);
});

test('(j) a player legacy palm gather is refused chopMode and a companion cannot finish it', { timeout: 90000 }, async t => {
  const r = await room(t, { lanes: 'workshop' }), { owner, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, player = ownerSide(r), { node } = zoneNode(w, 'palm');
  giveTool(w, entity, 'axe'); giveTool(w, player.entity, 'axe');
  const ecs = w.ecs;
  ecs.x[player.entity] = node.x - 1; ecs.z[player.entity] = node.z; ecs.y[player.entity] = node.y;
  ecs.regenT[player.entity] = 100; ecs.moveMag[player.entity] = 0; ecs.vx[player.entity] = ecs.vz[player.entity] = 0;
  const from = owner.messages.length;
  game.receive(player.sock, { t: MSG.CMD, type: 'resource', op: 'gather', opId: 'owner-legacy-palm', node: node.id, expectedRev: node.rev });
  await game.economicAuthority.settle(); game.server.step();
  const ack = (await owner.next(m => m.ev?.type === 'resource' && m.ev.opId === 'owner-legacy-palm', from)).ev;
  assert.deepEqual([ack.ok, ack.why], [false, 'chopMode']);
  await order(owner, entry, 'gather', { node: node.id });
  await run(r, () => entry.order === 'wait', 4000);
  assert.equal(entry.reason, 'chop_mode'); assert.equal(node.hits, 0);
  assert.equal(pack(w, entity, 'tronco'), 0);
});

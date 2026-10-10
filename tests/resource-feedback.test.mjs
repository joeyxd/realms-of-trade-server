import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceActions } from '../src/ui/resourceActions.js';

function fixture(kind = 'stone') {
  let time = 0;
  const sent = [], sounds = [], poses = [], toasts = [];
  const node = { id: 'resource-1', kind, rev: 1, ready: true, hits: 0, x: 0, y: 2, z: 0 };
  const profile = { eco: { tradeRev: 0, pack: { cap: 40, goods: {} } }, tools: { axe: 1, pickaxe: 1 } };
  const client = { joined: true, youServer: 7, t: { closed: false }, profile, resources: { nodes: [node] },
    naval: {}, deck: {}, send: (message) => sent.push(structuredClone(message)) };
  const actions = new ResourceActions({ client: () => client, player: () => ({ x: 0, y: 2, z: 0 }), enabled: () => true,
    now: () => time, sound: () => sounds.push(time), toast: (html) => toasts.push(html), onGather: (event) => poses.push(event) });
  return { actions, client, node, profile, sent, sounds, poses, toasts, advance(ms) { time += ms; actions.update(); } };
}
const gather = (id = 'first', node = 'resource-1', rev = 1) => ({ t: 'cmd', type: 'resource', op: 'gather', opId: id, node, expectedRev: rev });
const ack = (id = 'first', extra = {}) => ({ type: 'resource', op: 'gather', opId: id, ok: true, rev: 2, profileRev: 1, good: 'piedra', count: 1, ...extra });

test('collection feels immediate at 500ms RTT without changing saved or simulation inventory', () => {
  const f = fixture(), original = structuredClone(f.profile);
  assert.equal(f.actions.send(gather()), true);
  assert.equal(f.sounds.length, 1); assert.equal(f.poses.length, 1);
  assert.match(f.toasts[0], /\+1 piedra/);
  assert.deepEqual(f.profile, original);
  assert.deepEqual(f.actions.backpack(), { pack: { cap: 40, goods: { piedra: 1 } }, pendingGoods: { piedra: 1 } });
  assert.equal(f.actions.renderResources().nodes[0].collecting, true);
  assert.equal(f.node.collecting, undefined);
  assert.doesNotMatch(f.actions.interaction().html, /Esperando|Wait/);
  f.advance(500);
  f.actions.onResult(ack());
  assert.equal(f.actions.gatherUntil, 500, 'network RTT does not start another action cooldown');
  assert.equal(f.actions.backpack().pack.goods.piedra, 1, 'ack before PROFILE keeps exactly one preview');
  f.profile.eco.tradeRev = 1; f.profile.eco.pack.goods.piedra = 1;
  f.node.rev = 2; f.node.ready = false;
  f.actions.update(); f.actions.onResult(ack());
  assert.equal(f.actions.pending, null);
  assert.deepEqual(f.actions.backpack().pendingGoods, {});
  assert.equal(f.actions.backpack().pack.goods.piedra, 1);
  assert.equal(f.sounds.length, 1, 'ack and duplicate ack do not replay collection feedback');
});

test('different nodes can be collected while the first response is delayed; the same node cannot', () => {
  const f = fixture();
  f.client.resources.nodes.push({ ...f.node, id: 'resource-2', x: 1 });
  assert.equal(f.actions.send(gather()), true);
  f.advance(501);
  assert.equal(f.actions.send(gather('duplicate')), false);
  assert.equal(f.actions.send(gather('second', 'resource-2')), true);
  assert.equal(f.sent.length, 2);
  assert.equal(f.actions.backpack().pack.goods.piedra, 2);
  // A later response/profile can include both operations; it must not count the second twice.
  f.actions.onResult(ack());
  f.actions.onResult(ack('second', { profileRev: 2 }));
  f.profile.eco.tradeRev = 2; f.profile.eco.pack.goods.piedra = 2;
  f.client.resources.nodes.forEach((n) => { n.rev = 2; n.ready = false; });
  f.actions.update();
  assert.equal(f.actions.pending, null); assert.equal(f.actions.backpack().pack.goods.piedra, 2);
});

test('a denial restores the world view and inventory while preserving unrelated confirmed goods', () => {
  const f = fixture(); f.profile.eco.pack.goods.madera = 2;
  f.actions.send(gather());
  f.actions.onResult(ack('first', { ok: false, why: 'revision' }));
  assert.equal(f.actions.pending, null);
  assert.deepEqual(f.actions.backpack().pack.goods, { madera: 2 });
  assert.equal(f.actions.renderResources(), f.client.resources);
  assert.equal(f.node.ready, true); assert.equal(f.sounds.length, 1);
  assert.match(f.toasts.at(-1), /cambiaron/);
});

test('a lost response rolls back only the preview and retries the exact receipt without new feedback', () => {
  const f = fixture(); f.actions.send(gather()); f.advance(5001);
  assert.deepEqual(f.actions.backpack().pack.goods, {});
  assert.equal(f.actions.renderResources().nodes[0].collecting, undefined);
  assert.match(f.actions.interaction().html, /Reintentar/);
  assert.equal(f.actions.send(gather()), true);
  assert.deepEqual(f.sent[1], f.sent[0]); assert.equal(f.sounds.length, 1);
  assert.equal(f.actions.send(gather()), false, 'retry rate is bounded too');
  f.actions.onResult(ack());
  f.profile.eco.tradeRev = 1; f.profile.eco.pack.goods.piedra = 1; f.node.rev = 2;
  f.actions.update();
  assert.equal(f.actions.pending, null); assert.equal(f.actions.backpack().pack.goods.piedra, 1);
});

test('tool swings respond locally but only the server grants final harvest materials', () => {
  const f = fixture('palm'); f.actions.send(gather());
  assert.equal(f.poses.length, 1); assert.equal(f.sounds.length, 0);
  assert.deepEqual(f.actions.backpack().pack.goods, {});
  assert.equal(f.actions.renderResources().nodes[0].collecting, undefined, 'tree destruction stays authoritative');
  f.advance(500);
  f.actions.onResult(ack('first', { good: 'tronco', count: 0, remaining: 2, profileRev: 0 }));
  f.node.rev = 2; f.node.hits = 1; f.actions.update();
  assert.equal(f.actions.gatherUntil, 900);
  assert.equal(f.actions.send(gather('next', f.node.id, 2)), false);
  f.advance(401);
  assert.equal(f.actions.send(gather('next', f.node.id, 2)), true);
  assert.equal(f.actions.predictedHit({ node: f.node.id, rev: 3 }), true);
  assert.equal(f.actions.predictedHit({ node: f.node.id, rev: 3 }), false);
});

test('full bags, send failures and disconnects leave no speculative materials', () => {
  const f = fixture(); f.profile.eco.pack.cap = 1;
  assert.equal(f.actions.send(gather()), false);
  assert.equal(f.sounds.length, 0); assert.equal(f.actions.pending, null);
  f.profile.eco.pack.cap = 40;
  f.client.send = () => { throw new Error('closed transport'); };
  assert.equal(f.actions.send(gather()), false);
  assert.equal(f.actions.pending, null); assert.equal(f.sounds.length, 0);
  f.client.send = (m) => f.sent.push(m); f.actions.send(gather());
  f.client.t.closed = true; f.actions.update();
  assert.equal(f.actions.pending, null); assert.deepEqual(f.actions.backpack().pendingGoods, {});
});

test('pending collections stay bounded and block crafting with a stale canonical revision', () => {
  const f = fixture(); f.profile.eco.pack.cap = 100;
  f.client.resources.nodes = Array.from({ length: 9 }, (_, i) => ({ ...f.node, id: `resource-${i}` }));
  for (let i = 0; i < 8; i++) { assert.equal(f.actions.send(gather(`op-${i}`, `resource-${i}`)), true); f.advance(501); }
  assert.equal(f.actions.send(gather('ninth', 'resource-8')), false);
  assert.equal(f.actions.send({ type: 'resource', op: 'craft', opId: 'craft', recipe: 'madera', expectedRev: 0 }), false);
  assert.equal(f.actions.gathers.size, 8); assert.equal(f.sent.length, 8);
  f.actions.reset(); assert.equal(f.actions.pending, null); assert.deepEqual(f.actions.backpack().pendingGoods, {});
});

test('legacy acknowledgements and PROFILE-before-ACK reconcile without granting a second copy', () => {
  const f = fixture(); f.actions.send(gather());
  f.profile.eco.tradeRev = 1; f.profile.eco.pack.goods.piedra = 1;
  f.actions.onResult(ack());
  assert.equal(f.actions.backpack().pack.goods.piedra, 1);
  const legacy = fixture(); legacy.actions.send(gather());
  const result = ack(); delete result.profileRev;
  legacy.actions.onResult(result); legacy.node.rev = 2; legacy.actions.update();
  assert.equal(legacy.actions.pending, null); assert.deepEqual(legacy.actions.backpack().pack.goods, {});
});

test('confirmed collections stay visible while canonical updates are late', () => {
  const f = fixture(); f.actions.send(gather()); f.actions.onResult(ack()); f.advance(6000);
  assert.equal(f.actions.backpack().pack.goods.piedra, 1);
  assert.equal(f.actions.renderResources().nodes[0].collecting, true);
  assert.equal(f.sent.length, 1); assert.equal(f.toasts.length, 1);
});

test('a successful late acknowledgement restores its preview until canonical updates arrive', () => {
  const f = fixture(); f.actions.send(gather()); f.advance(6000);
  assert.deepEqual(f.actions.backpack().pack.goods, {});
  assert.equal(f.actions.renderResources().nodes[0].collecting, undefined);
  f.actions.onResult(ack());
  assert.equal(f.actions.backpack().pack.goods.piedra, 1);
  assert.equal(f.actions.renderResources().nodes[0].collecting, true);
  assert.equal(f.sounds.length, 1, 'late success does not replay pickup feedback');
  f.profile.eco.tradeRev = 1; f.profile.eco.pack.goods.piedra = 1; f.node.rev = 2;
  f.actions.update();
  assert.equal(f.actions.pending, null); assert.deepEqual(f.actions.backpack().pendingGoods, {});
  assert.equal(f.actions.backpack().pack.goods.piedra, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAgentInventory } from '../server/agentInventory.mjs';
import { validInventory, validInventoryItem, validInventoryResult } from '../src/net/agentInventory.js';
import { AgentPerception } from '../server/agentPerception.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG } from '../src/net/protocol.js';
import { ITEMS, SLOTS } from '../src/data/items.js';
import { GOODS } from '../src/data/goods.js';
import { holdUsed } from '../src/sim/economy/cargo.js';

function fixture() {
  const profile = newProfile(0);
  profile.gold = 127;
  profile.bag.push({ u: 20, b: 'sable', r: 1, l: 2, a: [['atk', 1.2]] });
  const good = Object.keys(GOODS)[0];
  profile.eco.pack.goods[good] = 2;
  return { profile, good, world: { profiles: new Map([[9, profile]]), ecs: { potions: { 9: 1 } } } };
}

test('inventory read projects live own assets with shared catalog capacities and no profile mutation', () => {
  const { profile, world } = fixture(), before = structuredClone(profile), view = captureAgentInventory(world, 9);
  assert.equal(validInventory(view), true);
  assert.equal(view.gold, 127);
  assert.equal(view.bag.capacity, ITEMS.bag);
  assert.deepEqual(Object.keys(view.equipment), SLOTS);
  assert.deepEqual(view.bag.items, before.bag);
  assert.equal(view.potions.count, 1, 'live ECS count prevails over a stale profile count');
  assert.notEqual(view.potions.count, profile.pot);
  assert.equal(view.pack.used, holdUsed(profile.eco.pack));
  assert.deepEqual(profile, before);
  view.bag.items[0].a[0][1] = 99; view.equipment.weapon.u = 999; view.pack.goods[0].quantity = 99;
  assert.deepEqual(profile, before, 'nested response arrays are detached');
});

test('projection strips private fields from profile, equipment and bag rows', () => {
  const { profile, world } = fixture();
  profile.accountId = 'private-account'; profile.quests.private = 'private-quest';
  profile.eco.ships.push({ secret: 'private-cargo' }); profile.pearls.bag.push({ uid: 'private-pearl', kind: 'brasa' });
  profile.bag[0].private = 'private-item'; profile.eq.weapon.private = 'private-equipment';
  const text = JSON.stringify(captureAgentInventory(world, 9));
  for (const secret of ['private-account', 'private-quest', 'private-cargo', 'private-pearl', 'private-item', 'private-equipment'])
    assert.equal(text.includes(secret), false);
  assert.equal(validInventory(JSON.parse(text)), true);
});

test('reads reflect new authoritative state only when captured again', () => {
  const { profile, world } = fixture(), first = captureAgentInventory(world, 9);
  profile.gold = 42; world.ecs.potions[9] = 4; profile.bag.length = 0;
  const second = captureAgentInventory(world, 9);
  assert.equal(first.gold, 127); assert.equal(first.potions.count, 1); assert.equal(first.bag.items.length, 1);
  assert.equal(second.gold, 42); assert.equal(second.potions.count, 4); assert.equal(second.bag.items.length, 0);
});

test('invalid, missing, overfull or duplicate ownership fails closed without fabricating inventory', () => {
  const mutators = [p => { p.gold = NaN; }, p => { p.gold = -1; }, p => { p.gold = 1e9 + 1; },
    p => { p.bag[0].b = 'unknown'; }, p => { p.bag[0].u = p.eq.weapon.u; },
    p => { p.bag = Array(ITEMS.bag + 1).fill(p.bag[0]); }, p => { p.bag = new Array(1); },
    p => { p.eq.head = p.eq.weapon; }, p => { p.eco.pack.goods.unknown = 1; },
    p => { p.eco.pack.cap = 100; }, p => { p.bag[0].a = [['atk', 9999]]; }, p => { p.bag[0].u = 1.5; }];
  for (const mutate of mutators) {
    const { profile, world } = fixture(); mutate(profile);
    assert.equal(captureAgentInventory(world, 9), null, mutate.toString());
  }
  assert.equal(captureAgentInventory(fixture().world, 10), null);
  const { world } = fixture(); world.ecs.potions[9] = 6;
  assert.equal(captureAgentInventory(world, 9), null);
});

test('projection never invokes source getters, array accessors or proxies', () => {
  for (const kind of ['profile', 'item', 'affix', 'proxy']) {
    const { profile, world } = fixture(); let calls = 0;
    if (kind === 'profile') Object.defineProperty(profile, 'gold', { get() { calls++; return 1; } });
    if (kind === 'item') Object.defineProperty(profile.bag[0], 'u', { get() { calls++; return 20; } });
    if (kind === 'affix') Object.defineProperty(profile.bag[0].a[0], '1', { get() { calls++; return 1.2; } });
    if (kind === 'proxy') profile.bag[0] = new Proxy(profile.bag[0], { ownKeys() { calls++; return []; } });
    assert.equal(captureAgentInventory(world, 9), null, kind); assert.equal(calls, 0, kind);
  }
});

test('wire inventory validates exact bounded data and canonical items, not claims of ownership', () => {
  const view = captureAgentInventory(fixture().world, 9);
  assert.equal(validInventoryItem(view.equipment.weapon), true);
  const mutations = [v => { v.otherCharacter = 'foreign'; }, v => { v.bag.items[0].price = 1; },
    v => { v.bag.items[0].a[0].push('hidden'); }, v => { v.pack.used++; },
    v => { v.pack.goods.push(v.pack.goods[0]); }, v => { v.bag.items = new Array(1); },
    v => { v.bag.items[0].a = new Array(1); }, v => { v.equipment.weapon.s = 2; }];
  for (const mutate of mutations) { const bad = structuredClone(view); mutate(bad); assert.equal(validInventory(bad), false); }
  let calls = 0; const bad = structuredClone(view);
  Object.defineProperty(bad.bag.items, '0', { get() { calls++; return view.bag.items[0]; } });
  assert.equal(validInventory(bad), false); assert.equal(calls, 0);
});

test('inventory result requires correlation, exact reason and view or an explicit denial', () => {
  const result = { t: MSG.AGENT_INVENTORY_RESULT, requestId: 'read-1', epoch: 1, sessionId: 'session-1',
    ok: true, why: null, tick: 10, replay: false, inventory: captureAgentInventory(fixture().world, 9) };
  assert.equal(validInventoryResult(result), true);
  assert.equal(validInventoryResult({ ...result, replay: true }), true);
  assert.equal(validInventoryResult({ ...result, inventory: null }), false);
  assert.equal(validInventoryResult({ ...result, ok: false, why: 'forbidden', inventory: null }), true);
  assert.equal(validInventoryResult({ ...result, ok: false, why: 'forbidden' }), false);
  assert.equal(validInventoryResult({ ...result, ok: false, why: 'forbidden', inventory: null, replay: true }), false);
  assert.equal(validInventoryResult({ ...result, requestId: 'x'.repeat(101) }), false);
  assert.equal(validInventoryResult({ ...result, other: true }), false);
});

test('managed projection suppresses raw profile/save while preserving the private read result lane', () => {
  const view = new AgentPerception(), inventory = captureAgentInventory(fixture().world, 9);
  assert.deepEqual(view.project({ t: MSG.PROFILE, p: { secret: true } }, {}, 9), []);
  assert.deepEqual(view.project({ t: MSG.SAVE, blob: 'private' }, {}, 9), []);
  const message = { t: MSG.AGENT_INVENTORY_RESULT, requestId: 'read', epoch: 1, sessionId: 'session',
    ok: true, why: null, tick: 0, replay: false, inventory };
  assert.deepEqual(view.project(message, {}, 9), [message]);
});

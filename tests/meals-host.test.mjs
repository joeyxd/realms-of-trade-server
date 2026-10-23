import test from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_TICKS } from '../src/data/meals.js';
import { freshwaterAccess, freshwaterStatus } from '../src/sim/systems/freshwater.js';
import { fireSeconds } from '../src/sim/systems/fire.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';
import { restoreRaftCondition } from '../src/sim/naval/condition.js';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { applyNeedsProfile } from '../src/sim/systems/survival.js';
import { ACCOUNT_ONE, calmAt, connect, deferred, makeResourceHost, makeResourceStore,
  startResourceHost, submitAndApply, turn } from './helpers/resource-authority-fixture.mjs';

const options = { freshwaterOperations: true, canteenOperations: true, specialMealOperations: true, fireOperations: true };
const MEAL_WORLD = 'world:meal-commerce';
const cmd = (kind, id, rev, heat = {}) => ({ type: 'freshwater', op: 'meal', opId: id,
  expectedRev: rev, source: kind, ship: '', part: '', n: 1, ...heat });
function cooker(f) {
  const w = f.host.server.world, e = f.entity(), p = w.profiles.get(e), ship = p.eco.ships.find(s => s.kind === 'raft');
  const active = w.rafts.get(ship.id), part = ['campfire', 1, 0, 0, 0], id = 'p800';
  ship.grid.parts.push(part);
  ship.condition.entries.push([id, ...part, 20]);
  ship.condition.next = 801; active.conditionNext = 801;
  active.condition = structuredClone(restoreRaftCondition(ship.condition, ship.grid.parts).structure);
  p.fire = { v: 1, rev: 1, slots: { [JSON.stringify([ship.id, id])]:
    { kind: 'campfire', seconds: 1800, since: fireSeconds(w), lit: true } } };
  const pose = { x: w.ecs.x[active.entity], y: w.ecs.y[active.entity], z: w.ecs.z[active.entity], yaw: w.ecs.facing[active.entity] };
  calmAt(f.host, e, lanternPoint(pose, part));
  w.profileDirty.add(e);
  return { ship: ship.id, part: id, active, slot: p.fire.slots[JSON.stringify([ship.id, id])] };
}

test('three recipes commit with one replacing effect; replay cannot renew time, heal or spend twice', async t => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { goods: { pescado: 1, ron: 1, agua: 1, galleta: 1, harina: 1 }, options });
  const w = f.host.server.world, e = f.entity(), p = w.profiles.get(e), heat = cooker(f);
  const fish = cmd('roastFish', 'fish', 0, { ship: heat.ship, part: heat.part });
  w.ecs.hp[e] = 40;
  const cooked = await submitAndApply(f.host, f.client, fish);
  assert.equal(cooked.ok, true, JSON.stringify(cooked));
  assert.equal(p.meal.kind, 'roastFish'); assert.equal(w.ecs.maxHp[e], 110);
  assert.ok(w.ecs.hp[e] > 40 && w.ecs.hp[e] <= 45.5);
  assert.equal(p.eco.pack.goods.pescado, undefined);
  p.meal.ticks = 300; applyNeedsProfile(w, e, p); w.ecs.hp[e] = 30;
  const retry = await submitAndApply(f.host, f.client, fish);
  assert.equal(retry.replay, true); assert.ok(p.meal.ticks <= 300); assert.equal(w.ecs.hp[e], 30);
  assert.equal((await submitAndApply(f.host, f.client, { ...fish, source: 'heartyBiscuit' })).why, 'duplicate');
  assert.equal((await submitAndApply(f.host, f.client, cmd('grog', 'grog', p.eco.tradeRev))).ok, true);
  assert.equal(p.meal.kind, 'grog'); assert.equal(w.ecs.maxHp[e], 100);
  assert.equal(p.eco.pack.goods.ron, undefined); assert.equal(p.eco.pack.goods.agua, undefined);
  assert.equal((await submitAndApply(f.host, f.client, cmd('heartyBiscuit', 'biscuit', p.eco.tradeRev,
    { ship: heat.ship, part: heat.part }))).ok, true);
  assert.equal(p.meal.kind, 'heartyBiscuit'); assert.equal(p.eco.pack.goods.galleta, undefined);
  assert.equal(p.eco.pack.goods.harina, undefined);
  const receipt = await store.loadEconomicOperation(economicOperationId(f.host.worldState.id, ACCOUNT_ONE, 'biscuit'));
  assert.equal(receipt.request.profile.meal.ticks, MEAL_TICKS);
  assert.equal(receipt.request.profile.meal.kind, 'heartyBiscuit');
});

test('hot meals require real owned, living, near and lit cooker; voyage permits only dry-shore grog', async t => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { goods: { pescado: 1, ron: 1, agua: 1 }, options });
  const w = f.host.server.world, e = f.entity(), heat = cooker(f), command = cmd('roastFish', 'heat', 0, heat);
  assert.equal(freshwaterAccess(w, e, command), '');
  assert.equal(freshwaterStatus(w, e).cookers[0].lit, true);
  heat.active.owner = 0; assert.equal(freshwaterAccess(w, e, command), 'owner'); heat.active.owner = e;
  const since = heat.slot.since;
  heat.slot.lit = false; heat.slot.since = 0;
  assert.equal(freshwaterAccess(w, e, command), 'heat'); heat.slot.lit = true; heat.slot.since = since;
  heat.slot.seconds = 0; assert.equal(freshwaterAccess(w, e, command), 'heat'); heat.slot.seconds = 1800;
  const entry = heat.active.condition.entries.find(row => row.id === heat.part);
  entry.hp = 0; assert.equal(freshwaterAccess(w, e, command), 'condition'); entry.hp = 20;
  w.ecs.x[e] += 20; assert.equal(freshwaterAccess(w, e, command), 'far'); w.ecs.x[e] -= 20;
  const locked = w.navalPilot.locked, shoreStop = w.navalPilot.shoreStop;
  w.navalPilot.locked = () => true; w.navalPilot.shoreStop = () => false;
  assert.equal(freshwaterAccess(w, e, cmd('grog', 'sea', 0)), 'busy');
  w.navalPilot.shoreStop = () => true;
  assert.equal(freshwaterAccess(w, e, cmd('grog', 'shore', 0)), '');
  assert.equal(freshwaterAccess(w, e, command), 'busy');
  w.navalPilot.locked = locked; w.navalPilot.shoreStop = shoreStop;
});

test('held commit freezes meal time and inventory; disconnect and host restart retain remaining ticks', async t => {
  const gate = deferred();
  const { store, base } = makeResourceStore({ async commitEconomicOperation(a) { await gate.promise; return base.commitEconomicOperation(a); } });
  const f = await startResourceHost(t, store, { goods: { ron: 1, agua: 1 }, options });
  const w = f.host.server.world, p = w.profiles.get(f.entity());
  f.client.send(cmd('grog', 'held-meal', 0)); await turn();
  const tick = w.tick; f.host.server.step();
  assert.equal(w.tick, tick); assert.equal(p.meal, undefined); assert.equal(p.eco.pack.goods.ron, 1);
  gate.resolve(); await f.host.economicAuthority.settle(); f.host.server.step();
  assert.equal(p.meal.kind, 'grog');
  for (let i = 0; i < 10; i++) w.applyCommand(f.entity(), { seq: i + 1, mx: 0, mz: 0, ax: 1, az: 0, btn: 0, prs: 0, pt: w.tick });
  const remaining = p.meal.ticks; assert.ok(remaining < MEAL_TICKS);
  f.client.ws.close(); await turn(); await f.host.profiles.flush();
  const saved = await store.loadProfile(ACCOUNT_ONE); assert.equal(saved.data.meal.ticks, remaining);
  for (let i = 0; i < 10; i++) f.host.server.step();
  assert.equal((await store.loadProfile(ACCOUNT_ONE)).data.meal.ticks, remaining, 'offline world time cannot spend meal ticks');
  await f.host.close();
  const restarted = makeResourceHost(store, async () => ACCOUNT_ONE, options);
  t.after(() => restarted.close()); await restarted.prepare();
  const again = connect(restarted); again.hello(); await Promise.all([...restarted.joins]);
  const entity = restarted.server.clients.get(again.id).entity;
  assert.equal(restarted.server.world.ecs.mealTicks[entity], remaining);
  assert.equal(restarted.server.world.profiles.get(entity).meal.kind, 'grog');
});

test('special meal flag and SQL readiness fail closed without changing old canteen flow', async t => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { goods: { ron: 1, agua: 1 }, options: { freshwaterOperations: true, canteenOperations: true } });
  assert.equal((await submitAndApply(f.host, f.client, cmd('grog', 'off', 0))).why, 'disabled');
  assert.equal(f.host.server.world.profiles.get(f.entity()).meal, undefined);
  const broken = makeResourceStore({ async checkSpecialMealOperations() { return { version: 0 }; } }).store;
  await assert.rejects(() => startResourceHost(t, broken, { options }), { code: 'configuration' });
});

test('ordinary commerce without before preserves the database meal exactly and replays', async () => {
  const store = createMemoryStore(), seed = 901, world = { v: 1, seed, economy: new Economy(seed).serialize() };
  const profile = newProfile();
  profile.meal = { v: 1, kind: 'roastFish', ticks: 12345 };
  await store.initializeProfile(ACCOUNT_ONE, profile);
  await store.saveWorld(MEAL_WORLD, world, 0);

  const submit = async (opId, mealMutation) => {
    const next = structuredClone(profile);
    mealMutation(next);
    const command = { type: 'commerce', op: 'buy', opId, town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 };
    const operationId = economicOperationId(MEAL_WORLD, ACCOUNT_ONE, opId);
    const request = { world: MEAL_WORLD, account: ACCOUNT_ONE, command, expectedProfileVersion: 1,
      expectedWorldVersion: 1, profile: next, worldData: world,
      ack: { type: 'commerce', op: 'buy', opId, ok: true, why: '', rev: 1 } };
    return { operationId, request, result: await store.commitEconomicOperation({ operationId, request }) };
  };

  for (const [opId, mutation] of [
    ['meal-kind-tamper', p => { p.meal.kind = 'grog'; }],
    ['meal-timer-tamper', p => { p.meal.ticks--; }],
    ['meal-delete-tamper', p => { delete p.meal; }],
  ]) {
    const attempt = await submit(opId, mutation);
    assert.deepEqual(attempt.result, { ok: false, why: 'conflict' }, opId);
    assert.deepEqual(await store.loadProfile(ACCOUNT_ONE), { data: profile, version: 1 });
    assert.deepEqual(await store.loadWorld(MEAL_WORLD), { data: world, version: 1 });
    assert.equal(await store.loadEconomicOperation(attempt.operationId), null);
  }

  const accepted = await submit('meal-identical-commerce', () => {});
  assert.equal(accepted.result.ok, true);
  assert.deepEqual(await store.loadProfile(ACCOUNT_ONE), { data: profile, version: 2 });
  assert.deepEqual(await store.loadWorld(MEAL_WORLD), { data: world, version: 2 });
  assert.deepEqual(await store.loadEconomicOperation(accepted.operationId),
    { request: accepted.request, result: accepted.result });
  assert.deepEqual(await store.commitEconomicOperation({ operationId: accepted.operationId, request: accepted.request }),
    { ...accepted.result, replay: true });
});

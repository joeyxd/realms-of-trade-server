import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { Economy } from '../src/sim/economy/economy.js';
import { createMemoryStore } from '../server/store.mjs';
import { draftAttributes } from '../server/attributeOperation.mjs';
import { economicOperation, EconomicOperationError } from '../server/economicOperation.mjs';
import { upgradeTimingState } from '../server/resourceState.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const clone = structuredClone, account = id(1), world = 'attributes-contract';
async function fixture() {
  const store = createMemoryStore(), p = newProfile(), w = { v: 1, seed: 77, economy: new Economy(77).serialize(),
    resources: upgradeTimingState({ v: 1, tick: 100,
      nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} }) };
  await store.initializeProfile(account, p); await store.saveWorld(world, w, 0);
  return { store, p, w };
}
function proposal(f, op = 'adopt', opId = 'adopt-one', extra = {}) {
  const command = { type: 'attributes', op, opId, expectedRev: f.p.eco.tradeRev, ...extra };
  const changed = draftAttributes(f.p, command);
  return { operationId: id(10), request: { world, account, command, expectedProfileVersion: 1,
    expectedWorldVersion: 1, before: clone(f.p), profile: changed.profile, worldData: clone(f.w), ack: changed.ack } };
}

test('economic input requires exact attribute candidate and acknowledgement before storage', async () => {
  const f = await fixture(), input = proposal(f);
  assert.deepEqual(economicOperation(input), input);
  for (const change of [
    r => { r.profile.gold++; },
    r => { r.profile.attr.carga = 1; },
    r => { r.ack.points.available++; },
    r => { r.ack.extra = true; },
    r => { r.command.n = 1; },
    r => { delete r.before; },
  ]) {
    const forged = clone(input); change(forged.request);
    assert.throws(() => economicOperation(forged), EconomicOperationError);
  }
});

test('locked attribute receipt permits only monotonic checkpoint and rejects unrelated world edits', async () => {
  const f = await fixture(), input = proposal(f);
  for (const mutate of [
    w => { w.resources.tick--; },
    w => { w.resources.cooldowns[account] = 200; },
    w => { w.economy.markets.aldea.stock.madera++; },
  ]) {
    const forged = clone(input); mutate(forged.request.worldData);
    const result = await f.store.commitEconomicOperation(forged);
    assert.equal(result.ok, false);
    assert.equal(await f.store.loadEconomicOperation(input.operationId), null);
    assert.deepEqual((await f.store.loadProfile(account)).data, f.p);
  }
  input.request.worldData.resources.tick++;
  assert.equal((await f.store.commitEconomicOperation(input)).ok, true);
});

test('ordinary saves and economic commands cannot erase, introduce or spend attribute state', async () => {
  const f = await fixture(), input = proposal(f), adopted = input.request.profile;
  const legacySave = clone(f.p); legacySave.attr = { v: 1, carga: 0, re: 0 }; legacySave.eco.pack.maxMass = 50;
  assert.equal((await f.store.saveProfile(id(2), legacySave, 0)).ok, false,
    'an initial autosave cannot bypass explicit adoption');
  assert.deepEqual(await f.store.saveProfile(account, legacySave, 1), { ok: false, why: 'conflict' });
  assert.equal((await f.store.commitEconomicOperation(input)).ok, true);
  for (const edit of [p => { delete p.attr; p.eco.pack.maxMass = 18; }, p => { p.attr.re = 1; }]) {
    const altered = clone(adopted); edit(altered);
    assert.deepEqual(await f.store.saveProfile(account, altered, 2), { ok: false, why: 'conflict' });
    const request = { world, account, command: { type: 'commerce', op: 'buy', opId: 'cannot-erase',
      town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 }, expectedProfileVersion: 2, expectedWorldVersion: 2,
      profile: altered, worldData: clone(f.w), ack: { type: 'commerce', op: 'buy', opId: 'cannot-erase', ok: true, why: '', rev: 1 } };
    assert.equal((await f.store.commitEconomicOperation({ operationId: id(11), request })).ok, false);
  }
  const levelUp = clone(adopted); levelUp.lvl = 2;
  assert.equal((await f.store.saveProfile(account, levelUp, 2)).ok, true);
  assert.deepEqual((await f.store.loadProfile(account)).data.attr, adopted.attr);
});

test('no-op attribute denials are receipted without adopting a level-one profile', async () => {
  const f = await fixture(), denied = proposal(f, 'assign', 'no-points', { stat: 'carga', n: 1 });
  assert.equal(denied.request.ack.why, 'points');
  const result = await f.store.commitEconomicOperation(denied);
  assert.equal(result.ok, true); assert.equal(result.ack.ok, false);
  assert.deepEqual((await f.store.loadProfile(account)).data, f.p);
  assert.deepEqual(await f.store.commitEconomicOperation(denied), { ...result, replay: true });
});

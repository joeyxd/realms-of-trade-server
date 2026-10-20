import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { Economy } from '../src/sim/economy/economy.js';
import { createMemoryStore } from '../server/store.mjs';
import { draftSkills, skillStatePreserved, skillWorldTransition } from '../server/skillOperation.mjs';
import { teachStorage } from '../server/artisanOperation.mjs';
import { economicOperation, EconomicOperationError } from '../server/economicOperation.mjs';
import { economicCommand } from '../server/economicAuthority.mjs';
import { upgradeTimingState } from '../server/resourceState.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const clone = structuredClone, account = id(1), world = 'skills-contract';
const community = () => ({ v: 1, epoch: id(700), project: { id: 'salty-shore-carpentry', version: 7,
  requirements: { madera: 4, piedra: 2 }, contributed: { madera: 4, piedra: 2 } } });
async function fixture(edit = () => {}) {
  const store = createMemoryStore(), p = newProfile(), w = { v: 1, seed: 77, economy: new Economy(77).serialize(),
    community: community(), resources: upgradeTimingState({ v: 1, tick: 100,
      nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} }) };
  p.mast = [[4, 0], [1, 0]]; p.gold = 200; edit(p);
  await store.initializeProfile(account, p); await store.saveWorld(world, w, 0);
  return { store, p, w, pv: 1, wv: 1 };
}
function proposal(f, op = 'assign', opId = 'assign-lunge', extra = op === 'assign' ? { tree: 'combat', node: 'lunge' } : { tree: 'combat' }, n = 10) {
  const command = { type: 'skills', op, opId, expectedRev: f.p.eco.tradeRev, ...extra };
  const changed = draftSkills(f.p, command);
  return { operationId: id(n), request: { world, account, command, expectedProfileVersion: f.pv,
    expectedWorldVersion: f.wv, before: clone(f.p), profile: changed.profile, worldData: clone(f.w), ack: changed.ack } };
}
async function accept(f, input) {
  const result = await f.store.commitEconomicOperation(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  f.p = clone(input.request.profile); f.w = clone(input.request.worldData); f.pv = result.profileVersion; f.wv = result.worldVersion;
  return result;
}
const buy = (f, profile, opId) => ({ operationId: id(900 + opId.length), request: { world, account,
  command: { type: 'commerce', op: 'buy', opId, town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
  expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, profile, worldData: clone(f.w),
  ack: { type: 'commerce', op: 'buy', opId, ok: true, why: '', rev: profile.eco.tradeRev } } });

test('the edge command and the storage contract accept exactly the skill command shape', () => {
  const assign = { type: 'skills', op: 'assign', opId: 'a', expectedRev: 0, tree: 'combat', node: 'lunge' };
  const reset = { type: 'skills', op: 'reset', opId: 'r', expectedRev: 0, tree: 'combat' };
  assert.deepEqual(economicCommand({ t: 'cmd', ...assign }), assign);
  assert.deepEqual(economicCommand(reset), reset);
  for (const bad of [{ ...assign, n: 1 }, { ...reset, node: 'lunge' }, { ...assign, op: 'adopt' }, { ...assign, tree: 'exploration' },
    { ...assign, node: 'Bad-Id' }, { ...assign, expectedRev: 2147483646 }, (({ node, ...rest }) => rest)(assign), { ...reset, tree: 7 }]) {
    assert.throws(() => economicCommand(bad), JSON.stringify(bad));
  }
});

test('economic input requires the exact re-drafted skill candidate and acknowledgement before storage', async () => {
  const f = await fixture(), input = proposal(f);
  assert.equal(input.request.ack.ok, true, input.request.ack.why);
  assert.deepEqual(economicOperation(input), input);
  for (const change of [
    r => { r.profile.gold++; },
    r => { r.profile.progression.skills.lunge++; },
    r => { r.profile.progression.skills.wave = 3; },
    r => { r.profile.progression.skg.combat = 9; },
    r => { r.profile.progression.practice.trade = 5; },
    r => { r.ack.extra = true; },
    r => { r.ack.rev++; },
    r => { r.command.n = 1; },
    r => { r.command.node = 'wave'; },
    r => { delete r.before; },
    r => { r.before.gold = 0; },
  ]) {
    const forged = clone(input); change(forged.request);
    assert.throws(() => economicOperation(forged), EconomicOperationError);
  }
});

test('locked skill receipt permits only the monotonic checkpoint and rejects unrelated world edits', async () => {
  const f = await fixture(), input = proposal(f);
  for (const mutate of [
    w => { w.resources.tick--; },
    w => { w.resources.cooldowns[account] = 200; },
    w => { w.economy.markets.aldea.stock.madera++; },
    w => { w.community.project.version++; },
  ]) {
    const forged = clone(input); mutate(forged.request.worldData);
    assert.equal(skillWorldTransition(f.w, forged.request), false);
    const result = await f.store.commitEconomicOperation(forged);
    assert.equal(result.ok, false);
    assert.equal(await f.store.loadEconomicOperation(input.operationId), null);
    assert.deepEqual((await f.store.loadProfile(account)).data, f.p);
  }
  input.request.worldData.resources.tick++;
  assert.equal((await f.store.commitEconomicOperation(input)).ok, true);
});

test('memory store commits assign, free and paid resets, replays exactly and refuses a rebound identity', async () => {
  const f = await fixture(), first = proposal(f);
  const committed = await accept(f, first);
  assert.deepEqual(await f.store.commitEconomicOperation(first), { ...committed, replay: true });
  const rebound = clone(first); rebound.request.command.node = 'wave'; rebound.request.command.opId = 'assign-lunge';
  rebound.request.profile = draftSkills(first.request.before, rebound.request.command).profile;
  rebound.request.ack = draftSkills(first.request.before, rebound.request.command).ack;
  assert.deepEqual(await f.store.commitEconomicOperation(rebound), { ok: false, why: 'operation' });
  const stored = (await f.store.loadProfile(account)).data;
  assert.equal(stored.progression.skills.lunge, 2);
  assert.deepEqual(readProgression(stored.progression), stored.progression);

  const free = proposal(f, 'reset', 'reset-free', undefined, 11);
  await accept(f, free);
  assert.equal(f.p.gold, 200); assert.deepEqual(f.p.progression.skr, { combat: 1 });
  await accept(f, proposal(f, 'assign', 'assign-again', undefined, 12));
  const paid = proposal(f, 'reset', 'reset-paid', undefined, 13);
  await accept(f, paid);
  assert.equal((await f.store.loadProfile(account)).data.gold, 50);
  assert.deepEqual(f.p.progression.skr, { combat: 2 });
  await accept(f, proposal(f, 'assign', 'assign-third', undefined, 14));
  const short = proposal(f, 'reset', 'reset-short', undefined, 15);
  assert.equal(short.request.ack.why, 'gold');
  const denial = await accept(f, short);
  assert.equal(denial.ack.ok, false);
  assert.deepEqual((await f.store.loadProfile(account)).data, short.request.before, 'a denial receipt is an exact no-op');
});

test('ordinary economic commands cannot introduce, erase or change skill ranks, resets, grants or peaceful practice', async () => {
  const f = await fixture();
  await accept(f, proposal(f));
  const unchanged = buy(f, clone(f.p), 'keeps-skills');
  for (const edit of [
    p => { p.progression.skills.lunge = 3; },
    p => { delete p.progression.skills; },
    p => { p.progression.skr = { combat: 0, trade: 1 }; },
    p => { p.progression.skg.combat = 4; },
    p => { delete p.progression.skg; },
    p => { p.progression.practice.survival = 30; },
  ]) {
    const altered = clone(f.p); edit(altered);
    assert.equal(skillStatePreserved(f.p, altered), false);
    const input = buy(f, altered, 'cannot-alter');
    const result = await f.store.commitEconomicOperation(input);
    assert.deepEqual(result, { ok: false, why: 'conflict' });
  }
  const logging = clone(f.p); logging.progression.practice.logging += 10;
  assert.equal(skillStatePreserved(f.p, logging), true, 'logging practice is the only counter other lanes may credit');
  assert.equal((await f.store.commitEconomicOperation(unchanged)).ok, true);
  assert.deepEqual((await f.store.loadProfile(account)).data.progression, f.p.progression);
  const legacy = await fixture(), fresh = clone(legacy.p);
  fresh.progression = { v: 3, practice: { logging: 0 }, milestones: [], knowledge: [], skills: { lunge: 1 } };
  assert.deepEqual(await legacy.store.commitEconomicOperation(buy(legacy, fresh, 'cannot-adopt')), { ok: false, why: 'conflict' });
});

test('the artisan lesson keeps a v3 block exactly and a forged lesson cannot rewrite it', async () => {
  const progression = { v: 3, practice: { logging: 60, survival: 4, crafting: 2 }, milestones: ['logging_steady'], knowledge: [],
    skills: { lunge: 2, haggling: 0 }, skr: { combat: 1 }, skg: { combat: 1, survival: 0, sailing: 0, crafting: 0, trade: 0 } };
  const f = await fixture(p => { p.progression = clone(progression); p.eco.pack.goods = { madera: 3 }; });
  const taught = teachStorage(f.p);
  assert.equal(taught.why, '');
  assert.deepEqual(taught.profile.progression, { ...progression, knowledge: ['raft_storage'] });
  const lesson = (profile, opId) => ({ operationId: id(40 + opId.length), request: { world, account,
    command: { type: 'artisan', op: 'learn', opId, lesson: 'raft_storage', expectedRev: f.p.eco.tradeRev, expectedProjectRev: 7 },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, before: clone(f.p), profile, worldData: clone(f.w),
    ack: { type: 'artisan', op: 'learn', opId, lesson: 'raft_storage', ok: true, why: '', rev: profile.eco.tradeRev,
      project: { ...community().project, name: 'Carpintería de Salty Shore', complete: true } } } });
  for (const edit of [p => { p.progression.skills.lunge = 3; }, p => { p.progression.practice.survival = 40; },
    p => { p.progression.skr.combat = 0; }]) {
    const forged = clone(taught.profile); edit(forged);
    assert.equal((await f.store.commitEconomicOperation(lesson(forged, 'forged-lesson'))).ok, false);
  }
  const result = await f.store.commitEconomicOperation(lesson(taught.profile, 'v3-lesson'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual((await f.store.loadProfile(account)).data.progression, { ...progression, knowledge: ['raft_storage'] });
});

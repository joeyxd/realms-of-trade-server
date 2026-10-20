import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { Economy } from '../src/sim/economy/economy.js';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { draftSkills, skillStatePreserved, skillWorldTransition, validStoredSkillRequest } from '../server/skillOperation.mjs';
import { NODES } from '../src/data/skillTree.js';
import { teachStorage } from '../server/artisanOperation.mjs';
import { economicOperation, EconomicOperationError, checkedEconomicReceipt } from '../server/economicOperation.mjs';
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

const storedReceipt = request => ({ request: clone(request), result: { ok: true, replay: false,
  profileVersion: request.expectedProfileVersion + 1, worldVersion: request.expectedWorldVersion + 1, ack: clone(request.ack) } });
const receiptStore = raw => createSupabaseStore({ async rpc(name) {
  assert.equal(name, 'mn_load_economic_operation');
  return { data: clone(raw), error: null };
} });

test('memory loads an adopting receipt from an older catalog without re-drafting it', async () => {
  const f = await fixture(), index = NODES.findIndex(n => n.id === 'haggling');
  assert.ok(index >= 0);
  const [node] = NODES.splice(index, 1);
  let input, committed;
  try {
    input = proposal(f);
    assert.equal(Object.hasOwn(input.request.profile.progression.skills, node.id), false);
    committed = await accept(f, input);
  } finally { NODES.splice(index, 0, node); }
  assert.throws(() => economicOperation(input), EconomicOperationError, 'new input still needs today\'s exact adoption');
  assert.deepEqual(await f.store.loadEconomicOperation(input.operationId), { request: input.request, result: committed });
  assert.deepEqual(await receiptStore(storedReceipt(input.request)).loadEconomicOperation(input.operationId),
    { request: input.request, result: committed }, 'the RPC adapter uses the same historical validation');
});

test('historical skills accept retired nodes and old grants, gates and point budgets only on receipt load', async () => {
  const f = await fixture(), adoption = proposal(f);
  adoption.request.profile.progression.skills.retired_node = 1;
  adoption.request.profile.progression.skg.exploration = 4;
  for (const input of [adoption, (() => {
    const input = clone(adoption), b = input.request.profile;
    b.mast = [[1, 0], [1, 0]]; b.progression.skills.retired_node = 0;
    input.request.before = clone(b); input.request.command.node = 'retired_node';
    input.request.command.expectedRev = b.eco.tradeRev;
    b.progression.skills.retired_node = 1; b.eco.tradeRev++;
    input.request.ack.rev = b.eco.tradeRev;
    return input;
  })()]) {
    const raw = storedReceipt(input.request);
    assert.equal(validStoredSkillRequest(input.request), true);
    assert.deepEqual(checkedEconomicReceipt(raw, input.operationId), raw);
    assert.deepEqual(await receiptStore(raw).loadEconomicOperation(input.operationId), raw);
    assert.throws(() => economicOperation(input), EconomicOperationError);
  }
  await accept(f, proposal(f));
  const oldRules = proposal(f, 'assign', 'old-rules', undefined, 16);
  assert.equal(oldRules.request.ack.ok, true);
  for (const p of [oldRules.request.before, oldRules.request.profile]) p.mast = [[1, 0], [1, 0]];
  assert.equal(draftSkills(oldRules.request.before, oldRules.request.command).ack.ok, false);
  const raw = storedReceipt(oldRules.request);
  assert.deepEqual(await receiptStore(raw).loadEconomicOperation(oldRules.operationId), raw);
  assert.throws(() => economicOperation(oldRules), EconomicOperationError);
  const absentNode = clone(oldRules);
  absentNode.request.command.node = 'constructor';
  absentNode.request.profile.progression.skills = { ...clone(absentNode.request.before.progression.skills), constructor: 1 };
  assert.equal(validStoredSkillRequest(absentNode.request), true, 'absent JSON keys start at zero, including inherited JS names');
  assert.deepEqual(await receiptStore(storedReceipt(absentNode.request)).loadEconomicOperation(absentNode.operationId),
    storedReceipt(absentNode.request));
});

test('loading a forged stored skill receipt refuses altered diffs, commands and acknowledgements', async () => {
  const f = await fixture();
  await accept(f, proposal(f));
  const valid = { assign: proposal(f, 'assign', 'next', undefined, 11),
    reset: proposal(f, 'reset', 'free', undefined, 12),
    denial: proposal(f, 'assign', 'stale', { tree: 'combat', node: 'lunge', expectedRev: 0 }, 13) };
  assert.equal(valid.assign.request.ack.ok, true);
  assert.equal(valid.reset.request.ack.ok, true);
  assert.equal(valid.denial.request.ack.ok, false);
  for (const input of Object.values(valid)) {
    const raw = storedReceipt(input.request);
    assert.deepEqual(await receiptStore(raw).loadEconomicOperation(input.operationId), raw);
  }
  for (const [kind, edit] of [
    ['assign', r => { r.profile.progression.skills.wave++; }],
    ['assign', r => { r.profile.progression.skills.lunge = 1; }],
    ['assign', r => { r.profile.progression.skills.lunge = 4; }],
    ['assign', r => { r.profile.gold--; }],
    ['assign', r => { r.profile.xp++; }],
    ['assign', r => { r.profile.eco.pack.goods = { madera: 1 }; }],
    ['assign', r => { r.profile.progression.practice.trade = 1; }],
    ['assign', r => { r.profile.progression.skg.combat++; }],
    ['assign', r => { r.profile.progression.skr.combat = 1; }],
    ['assign', r => { r.command.extra = true; }],
    ['assign', r => { r.command.tree = 'pirates'; }],
    ['assign', r => { r.ack.extra = true; }],
    ['assign', r => { r.ack.why = 'points'; }],
    ['assign', r => { r.ack.rev++; r.profile.eco.tradeRev++; }],
    ['reset', r => { r.profile.gold -= 150; }],
    ['reset', r => { r.profile.progression.skr.combat++; }],
    ['reset', r => { r.profile.progression.skills.lunge = 1; }],
    ['reset', r => { r.profile.progression.skills = clone(r.before.progression.skills); }],
    ['reset', r => { delete r.profile.progression.skills.wave; }],
    ['denial', r => { r.profile.gold++; }],
    ['denial', r => { r.ack.rev++; }],
    ['denial', r => { r.ack.why = ''; }],
  ]) {
    const input = clone(valid[kind]); edit(input.request);
    const raw = storedReceipt(input.request);
    assert.equal(validStoredSkillRequest(input.request), false, `${kind}: ${edit}`);
    await assert.rejects(receiptStore(raw).loadEconomicOperation(input.operationId), { code: 'response' });
  }
  await accept(f, valid.reset);
  await accept(f, proposal(f, 'assign', 'after-free', undefined, 14));
  const paid = proposal(f, 'reset', 'paid', undefined, 15);
  assert.equal(validStoredSkillRequest(paid.request), true);
  paid.request.profile.gold = paid.request.before.gold;
  await assert.rejects(receiptStore(storedReceipt(paid.request)).loadEconomicOperation(paid.operationId), { code: 'response' });
});

test('memory autosave preserves skills, resets, grants and every non-logging practice counter', async () => {
  const f = await fixture(p => {
    p.progression = { v: 3, practice: { logging: 0, survival: 1, sailing: 2, crafting: 3, trade: 4 },
      milestones: [], knowledge: [] };
  });
  await accept(f, proposal(f));
  const edits = [p => { p.progression.skills.lunge++; }, p => { p.progression.skr.combat = 1; },
    p => { p.progression.skg.combat++; }, p => { delete p.progression; },
    ...['skills', 'skr', 'skg'].map(k => p => { delete p.progression[k]; }),
    ...['survival', 'sailing', 'crafting', 'trade'].flatMap(k => [
      p => { p.progression.practice[k]++; }, p => { delete p.progression.practice[k]; },
    ])];
  for (const edit of edits) {
    const p = clone(f.p); edit(p);
    assert.deepEqual(await f.store.saveProfile(account, p, f.pv), { ok: false, why: 'conflict' }, String(edit));
    assert.deepEqual(await f.store.loadProfile(account), { data: f.p, version: f.pv });
  }
  const equal = clone(f.p); equal.xp++; equal.progression.practice.logging++;
  assert.deepEqual(await f.store.saveProfile(account, equal, f.pv), { ok: true, version: f.pv + 1 });
  assert.deepEqual((await f.store.loadProfile(account)).data, equal);
  const legacy = await fixture(), added = clone(f.p);
  assert.deepEqual(await legacy.store.saveProfile(account, added, 1), { ok: false, why: 'conflict' });
});

test('memory autosave creation refuses skill state and preserves optional legacy omissions', async () => {
  const store = createMemoryStore(), p = newProfile();
  p.progression.v = 3;
  for (const edit of [
    p => { p.progression.skills = {}; }, p => { p.progression.skr = {}; }, p => { p.progression.skg = {}; },
    ...['survival', 'sailing', 'crafting', 'trade'].map(k => p => { p.progression.practice[k] = 0; }),
  ]) {
    const altered = clone(p); edit(altered);
    assert.deepEqual(await store.saveProfile(account, altered, 0), { ok: false, why: 'conflict' });
    assert.equal(await store.loadProfile(account), null);
  }
  for (const [n, data] of [[1, p], [2, newProfile()], [3, (({ progression, ...rest }) => rest)(newProfile())]]) {
    assert.deepEqual(await store.saveProfile(id(n), data, 0), { ok: true, version: 1 });
    assert.deepEqual(await store.saveProfile(id(n), data, 1), { ok: true, version: 2 });
    assert.deepEqual((await store.loadProfile(id(n))).data, data);
  }
});

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

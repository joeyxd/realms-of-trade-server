import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { workshopProfileDelta } from '../server/workshopOperation.mjs';
import { fireProfileDelta } from '../server/fireOperation.mjs';
import { storageProfileDelta } from '../src/sim/systems/raftEditor.js';
import { upgradeTimingState } from '../server/resourceState.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const clone = structuredClone, account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', world = 'starter-sql', seed = 91;
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const filenames = ['014_economic_operations', '015_resource_operations', '016_logging_operations',
  '017_agent_goods_budget', '018_ground_transactions', '019_ground_transaction_journal', '020_gm_drafts',
  '021_artisan_operations', '022_fire_operations', '023_ground_world_adoption'];
async function migration(name) {
  const path = `server/migrations/${name}.sql`;
  try { return await readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }
  catch { return execFileSync('git', ['show', `origin/claude/loving-lovelace-ptbif7:${path}`], { encoding: 'utf8' }); }
}
const priors = await Promise.all(filenames.map(migration));
const sql = await migration('024_starter_workshop');
const worldData = () => ({ v: 1, seed, economy: new Economy(seed).serialize(), community: { v: 1, epoch: id(900),
  project: { id: 'salty-shore-carpentry', version: 1, requirements: { madera: 50, piedra: 20 }, contributed: { madera: 0, piedra: 0 } } },
  resources: upgradeTimingState({ v: 1, tick: 100, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} }) });
async function fixture(t, { apply = true } = {}) {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE'); for (const prior of priors) await f.db.exec(prior);
  if (apply) { await f.db.exec(sql); await f.db.exec(sql); }
  f.p = newProfile(); f.p.eco.pack.goods = { madera: 5 }; f.w = worldData(); f.pv = f.wv = 1;
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, f.p]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, f.w]);
  await f.db.exec('SET ROLE service_role'); return f;
}
function proposal(f, op, opId, extra = {}) {
  const command = { type: 'artisan', op, opId, expectedRev: f.p.eco.tradeRev, ...extra };
  const delta = workshopProfileDelta(f.p, command); assert.equal(delta.why, '');
  return { world, account, command, expectedProfileVersion: f.pv, expectedWorldVersion: f.wv,
    before: clone(f.p), profile: delta.profile, worldData: clone(f.w), ack: { type: 'artisan', op, opId,
      ok: true, why: '', rev: delta.profile.eco.tradeRev, workshop: delta.workshop, carry: delta.carry } };
}
async function commit(f, operation, request) {
  return (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r', [operation, request])).rows[0].r;
}
async function accept(f, operation, request) {
  const result = await commit(f, operation, request); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.ack, request.ack);
  const receipt = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [operation])).rows[0];
  assert.deepEqual(receipt.request, request); assert.deepEqual(receipt.result, result);
  f.p = clone(request.profile); f.w = clone(request.worldData); f.pv = result.profileVersion; f.wv = result.worldVersion;
  assert.deepEqual(await commit(f, operation, request), { ...result, replay: true }); return result;
}
async function stage(f, profile) {
  f.p = clone(profile); await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, f.p]);
}
function raftProposal(f, op, opId, piece, index) {
  const ship = f.p.eco.ships[0], command = { type: 'raft', op, opId, id: ship.id, expectedRev: ship.rev, piece,
    ...(op === 'remove' ? { index } : {}), rules: 2 };
  const delta = storageProfileDelta(f.p, command); assert.equal(delta.why, '', delta.why);
  return { world, account, command, expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, before: clone(f.p),
    profile: delta.profile, worldData: clone(f.w), ack: { type: 'raftEdit', id: ship.id, op, opId,
      ok: true, why: '', rev: ship.rev + 1 } };
}

test('SQL024 partial personal project, prepaid storage, paid later storage, kits and pack use exact immutable receipts', async t => {
  const f = await fixture(t);
  await accept(f, id(901), proposal(f, 'contribute', 'five-boards', { amount: 5 }));
  const p = clone(f.p); p.eco.pack.goods.madera = 5; await stage(f, p);
  await accept(f, id(902), proposal(f, 'contribute', 'last-five', { amount: 5 }));
  assert.equal(f.p.workshop.storageCredit, true); assert.equal(f.p.progression.practice.logging, 0);
  assert.equal(f.w.community.project.contributed.madera, 0);
  await accept(f, id(903), raftProposal(f, 'place', 'prepaid-hold', ['storage', 0, 1, 0, 0]));
  assert.equal(f.p.workshop.storageCredit, false); assert.equal(f.p.eco.ships[0].hold.cap, 26);
  const paid = clone(f.p); paid.eco.ships[0].hold.goods.madera = 4; paid.eco.pack.goods.madera = 6; await stage(f, paid);
  await accept(f, id(904), raftProposal(f, 'place', 'paid-hold', ['storage', 1, 0, 0, 0]));
  assert.equal(f.p.eco.pack.goods.madera, undefined); assert.equal(f.p.eco.ships[0].hold.goods.madera, undefined);
  const craft = clone(f.p); craft.eco.pack.goods = { madera: 2 }; await stage(f, craft);
  await accept(f, id(905), proposal(f, 'craftCrate', 'make-kit'));
  assert.equal(f.p.workshop.crateKits, 1);
  await accept(f, id(910), raftProposal(f, 'remove', 'remove-starter-crate', ['crate', 1, 1, 0, 0], 5));
  await accept(f, id(907), raftProposal(f, 'place', 'place-kit', ['crate', 1, 1, 0, 0]));
  assert.equal(f.p.workshop.crateKits, 0); assert.equal(f.p.eco.ships[0].hold.cap, 46);
  await accept(f, id(908), raftProposal(f, 'remove', 'remove-crate', ['crate', 1, 1, 0, 0], 7));
  assert.equal(f.p.eco.ships[0].hold.cap, 40);
  const up = clone(f.p); up.eco.pack.goods = { madera: 2, lona: 3 }; await stage(f, up);
  await accept(f, id(906), proposal(f, 'upgradePack', 'pack-tier-1'));
  assert.equal(f.p.eco.pack.cap, 30); assert.equal(f.p.eco.pack.maxMass, 18);
  assert.deepEqual((await f.db.query('select public.mn_starter_workshop_ready() as r')).rows[0].r, { version: 1 });
});

test('SQL024 adopts a legacy pack only in its exact paid workshop receipt', async t => {
  const f = await fixture(t), legacy = newProfile({ starter: false });
  legacy.eco.pack.goods = { madera: 3 }; await stage(f, legacy);
  const request = proposal(f, 'contribute', 'legacy-adoption', { amount: 1 });
  assert.equal(request.before.carry, undefined); assert.equal(request.before.eco.pack.cap, 10);
  await accept(f, id(909), request);
  assert.deepEqual(f.p.carry, { v: 1, backpack: 0 }); assert.equal(f.p.eco.pack.cap, 18);
  assert.equal(f.p.eco.pack.maxMass, 18); assert.deepEqual(f.p.eco.pack.goods, { madera: 2 });
});

test('SQL024 v3 worlds still craft, gather ordinary resources and load paid fire while freezing unrelated carry and ledgers', async t => {
  const f = await fixture(t), p = clone(f.p); p.eco.pack.goods = { tronco: 2 }; await stage(f, p);
  f.w.resources.nodes.push({ id: 'wood-1', kind: 'wood', rev: 1, hits: 0, readyAt: 0 });
  await f.db.query('update public.mn_worlds set economy=$2::jsonb where world=$1', [world, f.w]);
  const craftProfile = clone(f.p); craftProfile.eco.pack.goods = { madera: 1 }; craftProfile.eco.tradeRev++;
  const craftWorld = clone(f.w); craftWorld.resources.cooldowns[account] = 130;
  await accept(f, id(980), { world, account, command: { type: 'resource', op: 'craft', opId: 'v3-plank', recipe: 'madera', expectedRev: 0, n: 1 },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, profile: craftProfile, worldData: craftWorld,
    ack: { type: 'resource', op: 'craft', opId: 'v3-plank', ok: true, why: '', rev: 1, good: 'madera', count: 1 } });
  const gatherProfile = clone(f.p); gatherProfile.eco.pack.goods.tronco = 1; gatherProfile.eco.tradeRev++;
  const gatherWorld = clone(f.w); gatherWorld.resources.tick = 200;
  gatherWorld.resources.cooldowns[account] = 230; gatherWorld.resources.nodes[1].rev = 2; gatherWorld.resources.nodes[1].readyAt = 3800;
  await accept(f, id(981), { world, account, command: { type: 'resource', op: 'gather', opId: 'v3-wood', node: 'wood-1', expectedRev: 1 },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, profile: gatherProfile, worldData: gatherWorld,
    ack: { type: 'resource', op: 'gather', opId: 'v3-wood', ok: true, why: '', rev: 2, good: 'tronco', count: 1, profileRev: 2, remaining: 0 } });
  const command = { type: 'fire', op: 'load', opId: 'v3-fire', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: false };
  const delta = fireProfileDelta(f.p, command, 0); assert.equal(delta.why, '');
  await accept(f, id(982), { world, account, command, expectedProfileVersion: f.pv, expectedWorldVersion: f.wv,
    before: clone(f.p), profile: delta.profile, worldData: clone(f.w),
    ack: { type: 'fire', op: 'load', opId: command.opId, ok: true, why: '', rev: 1 } });
  const commerce = { world, account, command: { type: 'commerce', op: 'buy', opId: 'no-free-upgrade', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, profile: clone(f.p), worldData: clone(f.w),
    ack: { type: 'commerce', op: 'buy', opId: 'no-free-upgrade', ok: false, why: 'gold', rev: f.p.eco.tradeRev } };
  commerce.profile.carry.backpack = 1; commerce.profile.eco.pack.cap = 30;
  assert.equal((await commit(f, id(983), commerce)).ok, false);
  const capacityForgery = clone(commerce); capacityForgery.profile = clone(f.p);
  capacityForgery.profile.eco.pack.cap = 1000; capacityForgery.profile.eco.pack.maxMass = 1000;
  assert.equal((await commit(f, id(985), capacityForgery)).ok, false);
  const ledgerForgery = clone(commerce); ledgerForgery.profile = clone(f.p);
  ledgerForgery.worldData.resources.logging['palm-1'] = null;
  assert.equal((await commit(f, id(984), ledgerForgery)).ok, false);
});

test('SQL024 world saves adopt v2 exactly once and subsequently advance only the paused resource clock', async t => {
  const f = await fixture(t), v2 = clone(f.w); v2.resources.v = 2;
  for (const entry of Object.values(v2.resources.logging)) if (entry) delete entry.quality;
  await f.db.query('update public.mn_worlds set economy=$2::jsonb where world=$1', [world, v2]);
  const save = async (data, rev) => (await f.db.query('select public.mn_save_world($1,$2::jsonb,$3) r', [world, data, rev])).rows[0].r;
  assert.deepEqual(await save(f.w, 1), { ok: true, version: 2 });
  const next = clone(f.w); next.resources.tick += 30;
  assert.deepEqual(await save(next, 2), { ok: true, version: 3 });
  const altered = clone(next); altered.resources.cooldowns[account] = 900;
  assert.equal((await save(altered, 3)).ok, false);
  const downgrade = clone(v2); downgrade.resources.tick = next.resources.tick;
  assert.equal((await save(downgrade, 3)).ok, false);
  const oldClock = clone(next); oldClock.resources.tick--;
  assert.equal((await save(oldClock, 3)).ok, false);
});

test('SQL024 rejects invented credit, changed rewards, missing payment, cargo loss and forged capacity without a receipt', async t => {
  const f = await fixture(t), valid = proposal(f, 'contribute', 'valid', { amount: 5 });
  const forgeries = [
    q => { q.profile.workshop.storageCredit = true; },
    q => { q.profile.gold++; },
    q => { q.profile.eco.pack.goods.madera = 5; },
    q => { q.profile.carry.backpack = 2; q.profile.eco.pack.cap = 42; },
    q => { q.ack.workshop.boards = 10; },
    q => { q.worldData.community.project.contributed.madera++; },
  ];
  for (const [i, forge] of forgeries.entries()) {
    const q = clone(valid); q.command.opId = q.ack.opId = `forged-${i}`; forge(q);
    assert.equal((await commit(f, id(920 + i), q)).ok, false, `forgery ${i}`);
  }
  assert.equal((await f.db.query('select count(*)::int n from public.mn_economic_operations')).rows[0].n, 0);
  assert.equal((await f.db.query('select version from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].version, 1);
  await f.db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(f.db.query('select public.mn_starter_workshop_ready()'));
  await assert.rejects(f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb)', [id(950), valid]));
});

test('SQL024 rejects malformed workshop envelopes and raft command aliases before any mutation', async t => {
  const f = await fixture(t), valid = proposal(f, 'contribute', 'strict-shape', { amount: 1 });
  const variants = [
    q => { q.before = null; },
    q => { q.profile.workshop = null; },
    q => { q.command.extra = true; },
    q => { delete q.command.amount; q.command.extra = 1; },
    q => { q.profile.eco.pack.maxMass = null; },
    q => { q.ack.extra = true; },
  ];
  for (const [i, change] of variants.entries()) {
    const q = clone(valid); change(q);
    assert.equal((await commit(f, id(990 + i), q)).ok, false, `malformed ${i}`);
  }
  const p = clone(f.p); p.workshop = { v: 1, boards: 10, storageCredit: true, crateKits: 1 };
  p.progression = { v: 1, practice: { logging: 0 }, milestones: [], knowledge: ['raft_storage'] };
  await stage(f, p);
  const raft = raftProposal(f, 'place', 'strict-raft', ['storage', 0, 1, 0, 0]);
  const extraCommand = clone(raft); extraCommand.command.unknown = 1;
  assert.equal((await commit(f, id(997), extraCommand)).ok, false);
  const missingRules = clone(raft); delete missingRules.command.rules; missingRules.command.extra = 2;
  assert.equal((await commit(f, id(998), missingRules)).ok, false);
  const extraAck = clone(raft); extraAck.ack.extra = 1;
  assert.equal((await commit(f, id(999), extraAck)).ok, false);
  const missingLesson = clone(raft);
  missingLesson.before.progression.knowledge = []; missingLesson.profile.progression.knowledge = [];
  await stage(f, missingLesson.before);
  assert.equal((await commit(f, id(1000), missingLesson)).ok, false);
  await stage(f, p);
  for (const [i, obstacle] of ['torchFloor', 'campfire', 'bigSail'].entries()) {
    const blocked = clone(raft), tuple = [obstacle, 0, 1, 0, 0];
    blocked.before.eco.ships[0].grid.parts.push(tuple);
    blocked.profile.eco.ships[0].grid.parts.splice(-1, 0, tuple);
    await stage(f, blocked.before);
    assert.equal((await commit(f, id(1001 + i), blocked)).ok, false, `${obstacle} occupied cell`);
  }
  assert.equal((await f.db.query('select count(*)::int n from public.mn_economic_operations')).rows[0].n, 0);
});

test('SQL024 timed palm receipt conserves practice and exact three-to-six yield; forged proof and extra logs reject', async t => {
  const f = await fixture(t), before = clone(f.p); before.eco.pack.goods = {};
  // Two recorded hits, one perfect, form the exact locked baseline before the final hit.
  f.w.resources.nodes[0] = { id: 'palm-1', kind: 'palm', rev: 3, hits: 2, readyAt: 0 };
  f.w.resources.logging['palm-1'] = { cycle: 1, contributors: [{ actor: account, hits: 2 }], quality: 1 };
  await stage(f, before);
  await f.db.query('update public.mn_worlds set economy=$2::jsonb where world=$1', [world, f.w]);
  const profile = clone(before); profile.eco.pack.goods.tronco = 5; profile.eco.tradeRev++;
  profile.progression = { v: 1, practice: { logging: 10 }, milestones: [], knowledge: [] };
  const nextWorld = clone(f.w); nextWorld.resources.nodes[0] = { id: 'palm-1', kind: 'palm', rev: 4, hits: 3, readyAt: 3700 };
  nextWorld.resources.logging['palm-1'] = { cycle: 1, contributors: [{ actor: account, hits: 3 }], quality: 2 };
  nextWorld.resources.cooldowns[account] = 154;
  const command = { type: 'resource', op: 'gather', opId: 'timed-final', node: 'palm-1', expectedRev: 3, challenge: 'opaque-token' };
  const timing = { challenge: { v: 1, node: 'palm-1', rev: 3, startTick: 55, targetTick: 100, endTick: 145, width: 5 }, receivedTick: 100, quality: 1 };
  const request = { world, account, command, expectedProfileVersion: 1, expectedWorldVersion: 1, profile, worldData: nextWorld,
    ack: { type: 'resource', op: 'gather', opId: command.opId, ok: true, why: '', rev: 4, good: 'tronco', count: 5, profileRev: 1,
      remaining: 0, felled: true, timing, actionTicks: 54,
      loggingStatus: { practice: 0, rank: 1, actionTicks: 54, nextAt: 60, canLearnStorage: false } },
    beneficiaries: [{ account, expectedVersion: 1, before, profile }] };
  const forged = clone(request); forged.ack.timing.quality = 0;
  assert.equal((await commit(f, id(960), forged)).ok, false);
  const extra = clone(request); extra.profile.eco.pack.goods.tronco = 6;
  assert.equal((await commit(f, id(961), extra)).ok, false);
  await accept(f, id(962), request);
});

test('SQL024 leaves a SQL021 receipt unchanged and replays it after both additive migrations', async t => {
  const f = await fixture(t, { apply: false });
  const p = newProfile(); delete p.carry; delete p.workshop; p.eco.pack = { cap: 10, goods: {} };
  const w = worldData(); w.resources = { v: 1, tick: 100, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} };
  await stage(f, p); f.w = w; await f.db.query('update public.mn_worlds set economy=$2::jsonb where world=$1', [world, w]);
  const command = { type: 'commerce', op: 'buy', opId: 'legacy-buy', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 };
  const request = { world, account, command, expectedProfileVersion: 1, expectedWorldVersion: 1, profile: p, worldData: w,
    ack: { type: 'commerce', op: 'buy', opId: command.opId, ok: true, why: '', rev: 0 } };
  const result = await commit(f, id(970), request); assert.equal(result.ok, true);
  await f.db.exec('RESET ROLE'); await f.db.exec(sql); await f.db.exec(sql); await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await commit(f, id(970), request), { ...result, replay: true });
  assert.deepEqual((await f.db.query('select request from public.mn_economic_operations where operation_id=$1::uuid', [id(970)])).rows[0].request, request);
});

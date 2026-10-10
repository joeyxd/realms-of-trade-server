import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { workshopProfileDelta } from '../server/workshopOperation.mjs';
import { storageProfileDelta } from '../src/sim/systems/raftEditor.js';
import { upgradeTimingState } from '../server/resourceState.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const clone = structuredClone, account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', world = 'starter-sql', seed = 91;
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const filenames = ['014_economic_operations', '015_resource_operations', '016_logging_operations',
  '017_agent_goods_budget', '018_ground_transactions', '019_ground_transaction_journal', '020_gm_drafts',
  '021_artisan_operations', '022_fire_operations'];
async function migration(name) {
  const path = `server/migrations/${name}.sql`;
  try { return await readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }
  catch { return execFileSync('git', ['show', `origin/claude/loving-lovelace-ptbif7:${path}`], { encoding: 'utf8' }); }
}
const priors = await Promise.all(filenames.map(migration));
const sql = await migration('023_starter_workshop');
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

test('SQL023 partial personal project, prepaid storage, paid later storage, kits and pack use exact immutable receipts', async t => {
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
  const up = clone(f.p); up.eco.pack.goods = { madera: 2, lona: 3 }; await stage(f, up);
  await accept(f, id(906), proposal(f, 'upgradePack', 'pack-tier-1'));
  assert.equal(f.p.eco.pack.cap, 30); assert.equal(f.p.eco.pack.maxMass, 18);
  assert.deepEqual((await f.db.query('select public.mn_starter_workshop_ready() as r')).rows[0].r, { version: 1 });
});

test('SQL023 rejects invented credit, changed rewards, missing payment, cargo loss and forged capacity without a receipt', async t => {
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

test('SQL023 timed palm receipt conserves practice and exact three-to-six yield; forged proof and extra logs reject', async t => {
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

test('SQL023 leaves a SQL021 receipt unchanged and replays it after both additive migrations', async t => {
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

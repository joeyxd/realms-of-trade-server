import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { loggingShares, loggingStatus, planLoggingHit } from '../src/sim/systems/progression.js';
import { database } from './helpers/ground-clock-sql.mjs';

const sql014 = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const sql015 = await readFile(new URL('../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');
const sql016 = await readFile(new URL('../server/migrations/016_logging_operations.sql', import.meta.url), 'utf8');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WORLD = 'logging-boundaries';
const accounts = [id(1), id(2), id(3)];
const baseProfile = progression => {
  const p = newProfile();
  if (progression === null) delete p.progression;
  else if (progression !== undefined) p.progression = structuredClone(progression);
  return p;
};
const pilot = points => ({ v: 2, practice: { logging: points }, milestones: ['pilot_coastal'], knowledge: [] });
const emptyEconomy = seed => new Economy(seed).serialize();
const world = resources => ({ v: 1, seed: 31, economy: emptyEconomy(31), resources });
const resource = ({ tick = 0, node = { id: 'palm-1', kind: 'palm', rev: 3, hits: 2, readyAt: 0 },
  contributors = [{ actor: accounts[0], hits: 1 }, { actor: accounts[1], hits: 1 }], cooldowns = {} } = {}) => ({
  v: 2, tick, nodes: [structuredClone(node)], cooldowns: structuredClone(cooldowns),
  logging: { 'palm-1': { cycle: 1, contributors: structuredClone(contributors) } },
});

async function fixture(t, { legacyReceipt = false } = {}) {
  const f = await database(); t.after(() => f.close()); await f.db.exec('RESET ROLE');
  await f.db.exec(sql014);
  let receipt = null;
  if (legacyReceipt) {
    const p = baseProfile(null), w = { v: 1, seed: 31, economy: emptyEconomy(31) };
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [accounts[0], p]);
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, w]);
    const request = { world: WORLD, account: accounts[0], command: { type: 'commerce', op: 'buy', opId: 'old-buy', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
      expectedProfileVersion: 1, expectedWorldVersion: 1, profile: p, worldData: w,
      ack: { type: 'commerce', op: 'buy', opId: 'old-buy', ok: true, why: '', rev: 0 } };
    receipt = { operation_id: id(90), request,
      result: (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [id(90), request])).rows[0].data };
  }
  await f.db.exec(sql015);
  let receipt015 = null;
  if (legacyReceipt) {
    const p = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [accounts[0]])).rows[0].data;
    const w = (await f.db.query('select economy from public.mn_worlds where world=$1', [WORLD])).rows[0].economy;
    const request = { world: WORLD, account: accounts[0], command: { type: 'commerce', op: 'buy', opId: 'old-buy-015', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
      expectedProfileVersion: 2, expectedWorldVersion: 2, profile: p, worldData: w,
      ack: { type: 'commerce', op: 'buy', opId: 'old-buy-015', ok: true, why: '', rev: 0 } };
    receipt015 = { operation_id: id(91), request,
      result: (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [id(91), request])).rows[0].data };
  }
  await f.db.exec(sql016); await f.db.exec(sql016);
  await f.db.exec('SET ROLE service_role');
  return { ...f, receipt, receipt015 };
}

function awardOperation({ roster = accounts.slice(0, 3), beforeProgress = {}, idNum = 101, tick = 0 } = {}) {
  const actor = roster.at(-1), oldResource = resource({ tick, contributors: roster.slice(0, 2).map(account => ({ actor: account, hits: 1 })) });
  const before = new Map(roster.map(account => [account, baseProfile(beforeProgress[account])]));
  const rawNode = { id: 'palm-1', kind: 'palm', rev: 3, cycle: 1, hits: 2, readyTick: 0,
    contributors: oldResource.logging['palm-1'].contributors };
  const plan = planLoggingHit(rawNode, { actor, expectedRev: 3, tick }, roster.map(account => ({ actor: account, progression: before.get(account).progression })));
  const nextResource = structuredClone(oldResource); nextResource.tick = tick;
  nextResource.nodes[0] = { id: 'palm-1', kind: 'palm', rev: plan.node.rev, hits: plan.node.hits, readyAt: plan.node.readyTick };
  nextResource.logging['palm-1'] = { cycle: plan.node.cycle, contributors: plan.node.contributors };
  nextResource.cooldowns[actor] = tick + plan.actionTicks;
  const awards = new Map(plan.awards.map(row => [row.actor, row]));
  const rows = [...roster].sort().map(account => {
    const profile = structuredClone(before.get(account)), award = awards.get(account);
    if (award) profile.progression = award.progression;
    return { account, expectedVersion: 1, before: before.get(account), profile };
  });
  const nextActor = rows.find(row => row.account === actor).profile;
  nextActor.eco.pack.goods.tronco = (nextActor.eco.pack.goods.tronco || 0) + 2;
  nextActor.eco.tradeRev++;
  const opId = `logging-${idNum}`;
  const request = { world: WORLD, account: actor,
    command: { type: 'resource', op: 'gather', opId, node: 'palm-1', expectedRev: 3 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: nextActor,
    worldData: world(nextResource),
    ack: { type: 'resource', op: 'gather', opId, ok: true, why: '', rev: 4, good: 'tronco', count: 2, actionTicks: plan.actionTicks },
    beneficiaries: rows };
  return { request, oldWorld: world(oldResource), rows, plan, before, result: plan.awards };
}

async function seed(t, built) {
  const f = await fixture(t), req = built.request;
  await f.db.query('insert into public.mn_profiles(player_id,data,version) select (r->>\'account\')::uuid,r->\'before\',1 from jsonb_array_elements($1::jsonb) r',
    [req.beneficiaries]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, built.oldWorld]);
  return f;
}
const commit = (f, opId, request) => f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [opId, request]);
async function unchanged(f, built, opId) {
  assert.deepEqual((await f.db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0],
    { economy: built.oldWorld, version: 1 });
  for (const row of built.request.beneficiaries) assert.deepEqual((await f.db.query(
    'select data,version from public.mn_profiles where player_id=$1::uuid', [row.account])).rows[0], { data: row.before, version: 1 });
  assert.equal((await f.db.query('select 1 from public.mn_economic_operations where operation_id=$1::uuid', [opId])).rows.length, 0);
}

test('SQL016 keeps SQL014 and SQL015 receipts byte-stable across upgrade and reapply', async t => {
  const f = await fixture(t, { legacyReceipt: true }), receipts = [f.receipt, f.receipt015];
  const stored = [];
  for (const receipt of receipts) {
    const row = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [receipt.operation_id])).rows[0];
    assert.deepEqual(row, { request: receipt.request, result: receipt.result }); stored.push(row);
  }
  await f.db.exec('RESET ROLE'); await f.db.exec(sql016); await f.db.exec('SET ROLE service_role');
  for (let i = 0; i < receipts.length; i++) {
    assert.deepEqual((await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [receipts[i].operation_id])).rows[0], stored[i]);
    assert.deepEqual((await commit(f, receipts[i].operation_id, receipts[i].request)).rows[0].data, { ...receipts[i].result, replay: true });
  }
  assert.equal((await f.db.query("select to_regprocedure('public.mn_commit_economic_operation_resource_base(uuid,jsonb)') as bypass")).rows[0].bypass, null);
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_valid_logging_transition(\'{}\'::jsonb,\'{}\'::jsonb)'), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb)', [receipts[0].operation_id, receipts[0].request]), { code: '42501' });
  }
});

test('SQL016 commits generated exact 4/3/3 awards, caps practice, and preserves pilot v2 fields', async t => {
  const built = awardOperation({ beforeProgress: { [accounts[0]]: undefined, [accounts[1]]: pilot(0), [accounts[2]]: pilot(59) } });
  const f = await seed(t, built), opId = id(101);
  const shares = loggingShares(built.request.worldData.resources.logging['palm-1'].contributors);
  assert.deepEqual(shares.map(row => row.amount), [4, 3, 3]);
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [opId, built.request])).rows[0].ok, true);
  const result = (await commit(f, opId, built.request)).rows[0].data;
  assert.equal(result.ok, true);
  assert.equal((await f.db.query('select data->\'progression\'->\'practice\'->>\'logging\' points from public.mn_profiles where player_id=$1::uuid', [accounts[0]])).rows[0].points, '4');
  const pilotRow = (await f.db.query('select data->\'progression\' progression from public.mn_profiles where player_id=$1::uuid', [accounts[1]])).rows[0].progression;
  assert.deepEqual(pilotRow, pilot(3));
  const capBuilt = awardOperation({ idNum: 102, beforeProgress: { [accounts[0]]: pilot(999_999_999), [accounts[1]]: pilot(0), [accounts[2]]: pilot(0) } });
  const capF = await seed(t, capBuilt);
  assert.equal((await commit(capF, id(102), capBuilt.request)).rows[0].data.ok, true);
  assert.equal((await capF.db.query('select data->\'progression\'->\'practice\'->>\'logging\' points from public.mn_profiles where player_id=$1::uuid', [accounts[0]])).rows[0].points, '1000000000');
});

test('legacy absent progression survives partial, denied, and expired null-ledger palm requests', async t => {
  const f = await fixture(t), account = accounts[0], p = baseProfile(null);
  const partialOld = { v: 2, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 2, hits: 1, readyAt: 0 }], cooldowns: {}, logging: { 'palm-1': null } };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, p]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, world(partialOld)]);
  const partialNext = structuredClone(partialOld); partialNext.nodes[0] = { ...partialNext.nodes[0], rev: 3, hits: 2 }; partialNext.cooldowns[account] = 54;
  const partial = { world: WORLD, account, command: { type: 'resource', op: 'gather', opId: 'legacy-partial', node: 'palm-1', expectedRev: 2 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: p, worldData: world(partialNext),
    ack: { type: 'resource', op: 'gather', opId: 'legacy-partial', ok: true, why: '', rev: 3, good: 'tronco', count: 0, actionTicks: 54 },
    beneficiaries: [{ account, expectedVersion: 1, before: p, profile: p }] };
  assert.equal((await commit(f, id(110), partial)).rows[0].data.ok, true);

  const denied = structuredClone(partial); denied.expectedWorldVersion = 2; denied.expectedProfileVersion = 2;
  denied.beneficiaries[0].expectedVersion = 2; denied.command.opId = 'legacy-denied'; denied.ack.opId = 'legacy-denied';
  denied.ack.ok = false; denied.ack.why = 'depleted'; denied.worldData.resources.tick = 1;
  denied.worldData.resources.cooldowns = partialNext.cooldowns;
  denied.worldData.resources.nodes = partialNext.nodes;
  denied.worldData.resources.logging = partialNext.logging;
  denied.beneficiaries[0].before = p; denied.beneficiaries[0].profile = p; denied.profile = p;
  assert.equal((await commit(f, id(111), denied)).rows[0].data.ok, true);

  const expiredOld = { v: 2, tick: 3600, nodes: [{ id: 'palm-1', kind: 'palm', rev: 4, hits: 3, readyAt: 3600 }], cooldowns: {}, logging: { 'palm-1': null } };
  await f.db.query('update public.mn_worlds set economy=$2::jsonb,version=3 where world=$1', [WORLD, world(expiredOld)]);
  const expiredNext = { ...structuredClone(expiredOld), nodes: [{ id: 'palm-1', kind: 'palm', rev: 5, hits: 1, readyAt: 0 }],
    logging: { 'palm-1': { cycle: 2, contributors: [{ actor: account, hits: 1 }] } }, cooldowns: { [account]: 3654 } };
  const expired = { ...partial, expectedProfileVersion: 3, expectedWorldVersion: 3,
    beneficiaries: [{ account, expectedVersion: 3, before: p, profile: p }],
    command: { ...partial.command, expectedRev: 4, opId: 'legacy-null-cycle' },
    worldData: world(expiredNext), ack: { ...partial.ack, opId: 'legacy-null-cycle', rev: 5, count: 0, actionTicks: 54 } };
  assert.equal((await commit(f, id(112), expired)).rows[0].data.ok, true);
  assert.equal((await f.db.query('select data ? \'progression\' as has_progression from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].has_progression, false);
});

test('forged awards, omitted contributors, fresh operation reuse, and downgrade saves leave rows untouched', async t => {
  const built = awardOperation(), f = await seed(t, built), opId = id(120);
  for (const mutate of [
    req => { req.beneficiaries = req.beneficiaries.filter(row => row.account !== accounts[0]); },
    req => { req.beneficiaries[0].profile.progression.practice.logging += 1; },
    req => { req.ack.count = 1; },
    req => { req.ack.loggingStatus = { practice: 999 }; },
    req => { req.worldData.resources.cooldowns[accounts[0]] += 1; },
    req => { const actorRow = req.beneficiaries.find(row => row.account === req.account);
      actorRow.profile.eco.pack.goods.tronco = 999; req.profile = actorRow.profile; },
  ]) {
    const invalid = structuredClone(built.request); mutate(invalid);
    assert.equal((await commit(f, opId, invalid)).rows[0].data.ok, false);
    await unchanged(f, built, opId);
  }
  const first = (await commit(f, opId, built.request)).rows[0].data; assert.equal(first.ok, true);
  const forged = structuredClone(built.request), nextOp = id(121);
  forged.command.opId = 'fresh-completed-ledger'; forged.ack.opId = forged.command.opId;
  forged.expectedProfileVersion = 2; forged.expectedWorldVersion = 2;
  forged.beneficiaries = forged.beneficiaries.map(row => ({ ...row, expectedVersion: 2, before: row.profile }));
  forged.profile = forged.beneficiaries.find(row => row.account === forged.account).profile;
  const beforeFreshWorld = (await f.db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0];
  const beforeFreshProfiles = await Promise.all(accounts.map(account => f.db.query(
    'select data,version from public.mn_profiles where player_id=$1::uuid', [account])));
  assert.equal((await commit(f, nextOp, forged)).rows[0].data.ok, false);
  assert.deepEqual((await f.db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0], beforeFreshWorld);
  for (let i = 0; i < accounts.length; i++) assert.deepEqual((await f.db.query(
    'select data,version from public.mn_profiles where player_id=$1::uuid', [accounts[i]])).rows[0], beforeFreshProfiles[i].rows[0]);
  const downgrade = structuredClone(built.oldWorld); downgrade.resources = { ...downgrade.resources, v: 1 }; delete downgrade.resources.logging;
  assert.equal((await f.db.query('select public.mn_save_world($1,$2::jsonb,2) data', [WORLD, downgrade])).rows[0].data.ok, false);
  const rewrite = structuredClone(built.request.worldData); rewrite.resources.logging['palm-1'] = null;
  assert.equal((await f.db.query('select public.mn_save_world($1,$2::jsonb,2) data', [WORLD, rewrite])).rows[0].data.ok, false);
});

test('a v1 to v2 adoption cannot be smuggled through an economic receipt', async t => {
  const f = await fixture(t), account = accounts[0], p = baseProfile(null);
  const old = { v: 1, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} };
  const adopted = { ...old, v: 2, logging: { 'palm-1': { cycle: 1, contributors: [] } } };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, p]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, world(old)]);
  const request = { world: WORLD, account, command: { type: 'resource', op: 'gather', opId: 'adoption-operation', node: 'palm-1', expectedRev: 1 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: p, worldData: world(adopted),
    ack: { type: 'resource', op: 'gather', opId: 'adoption-operation', ok: false, why: 'depleted', rev: 1 },
    beneficiaries: [{ account, expectedVersion: 1, before: p, profile: p }] };
  assert.equal((await commit(f, id(130), request)).rows[0].data.ok, false);
  assert.deepEqual((await f.db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0], { economy: world(old), version: 1 });
});

test('an economic receipt cannot introduce v2 resources into a world without a resource baseline', async t => {
  const f = await fixture(t), account = accounts[0], p = baseProfile(null);
  const oldWorld = { v: 1, seed: 31, economy: emptyEconomy(31) };
  const nextResources = { v: 2, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }],
    cooldowns: {}, logging: { 'palm-1': { cycle: 1, contributors: [] } } };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, p]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, oldWorld]);
  const opId = id(131), request = { world: WORLD, account,
    command: { type: 'resource', op: 'gather', opId: 'introduce-v2', node: 'palm-1', expectedRev: 1 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: p, worldData: { ...oldWorld, resources: nextResources },
    ack: { type: 'resource', op: 'gather', opId: 'introduce-v2', ok: false, why: 'depleted', rev: 1 } };
  assert.deepEqual((await commit(f, opId, request)).rows[0].data, { ok: false, why: 'conflict' });
  assert.deepEqual((await f.db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0],
    { economy: oldWorld, version: 1 });
  assert.equal((await f.db.query('select 1 from public.mn_economic_operations where operation_id=$1::uuid', [opId])).rows.length, 0);
});

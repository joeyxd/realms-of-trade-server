import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { draftAttributes } from '../server/attributeOperation.mjs';
import { upgradeTimingState } from '../server/resourceState.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const clone = structuredClone, account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', world = 'attributes-sql', seed = 91;
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const priorNames = ['014_economic_operations', '015_resource_operations', '016_logging_operations',
  '017_agent_goods_budget', '018_ground_transactions', '019_ground_transaction_journal', '020_gm_drafts',
  '021_artisan_operations', '022_fire_operations', '023_ground_world_adoption'];
async function migration(name) {
  const path = `server/migrations/${name}.sql`;
  try { return await readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }
  catch { return execFileSync('git', ['show', `origin/claude/loving-lovelace-ptbif7:${path}`], { encoding: 'utf8' }); }
}
const priors = await Promise.all(priorNames.map(migration));
const workshop = await migration('024_starter_workshop'), raft = await migration('026_workshop_raft_identifiers');
const companion = await migration('025_companion_config'), control = await migration('027_companion_control');
const inference = await migration('028_inference_config');
const attrs = await migration('029_attribute_operations');
function worldData() {
  return { v: 1, seed, economy: new Economy(seed).serialize(), community: { v: 1, epoch: id(900),
    project: { id: 'salty-shore-carpentry', version: 1, requirements: { madera: 50, piedra: 20 }, contributed: { madera: 0, piedra: 0 } } },
    resources: upgradeTimingState({ v: 1, tick: 100, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} }) };
}
async function fixture(t, { legacy = true, applyAttrs = true } = {}) {
  const f = await database(); if (t?.after) t.after(() => f.close()); await f.db.exec('RESET ROLE');
  for (const sql of priors) await f.db.exec(sql);
  await f.db.exec(workshop); await f.db.exec(companion); await f.db.exec(raft);
  await f.db.exec(control); await f.db.exec(inference);
  if (applyAttrs) { await f.db.exec(attrs); await f.db.exec(attrs); }
  f.p = newProfile();
  if (legacy) { delete f.p.carry; delete f.p.attr; f.p.eco.pack = { cap: 10, goods: { madera: 2 } }; }
  f.w = worldData(); f.pv = f.wv = 1;
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, f.p]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, f.w]);
  await f.db.exec('SET ROLE service_role'); return f;
}
function request(f, op, opId, mutator) {
  const b = clone(f.p), command = { type: 'attributes', op, opId, expectedRev: b.eco.tradeRev };
  if (op === 'assign') Object.assign(command, { stat: 'carga', n: 2 });
  const profile = clone(b); mutator(profile);
  const rev = b.eco.tradeRev, ok = profile.attr !== undefined && profile.attr !== b.attr;
  const carga = profile.attr?.carga ?? b.attr?.carga ?? 0, re = profile.attr?.re ?? b.attr?.re ?? 0;
  const earned = b.lvl - 1, tier = profile.carry?.backpack ?? 0;
  const volume = [18, 30, 42][tier];
  return { world, account, command, expectedProfileVersion: f.pv, expectedWorldVersion: f.wv,
    before: b, profile, worldData: clone(f.w), ack: { type: 'attributes', op, opId, ok, why: '', rev: ok ? rev + 1 : rev,
      ...(ok ? { points: { earned, invested: carga, available: earned - carga, resetsLeft: 1 - re },
        limits: { volume, comfortableMass: 40 + 4 * carga, maxMass: 50 + 5 * carga } } : {}) } };
}
async function commit(f, operationId, q) {
  return (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) r', [operationId, q])).rows[0].r;
}
async function accept(f, operationId, q) {
  const result = await commit(f, operationId, q); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.ack, q.ack);
  const receipt = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [operationId])).rows[0];
  assert.deepEqual(receipt.request, q); assert.deepEqual(receipt.result, result);
  f.p = clone(q.profile); f.w = clone(q.worldData); f.pv = result.profileVersion; f.wv = result.worldVersion;
  assert.deepEqual(await commit(f, operationId, q), { ...result, replay: true }); return result;
}

test('SQL029 adopts a legacy backpack durably, assigns and resets points with exact replay receipts', async t => {
  const f = await fixture(t); f.p.lvl = 3; f.p.eco.pack.goods = { madera: 2 };
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, f.p]);
  const adoption = request(f, 'adopt', 'adopt-legacy', p => {
    p.attr = { v: 1, carga: 0, re: 0 }; p.carry = { v: 1, backpack: 0 };
    p.eco.pack = { cap: 18, maxMass: 50, goods: clone(f.p.eco.pack.goods) }; p.eco.tradeRev++;
  });
  assert.equal((await f.db.query('select public.mn_valid_attribute_request($1::uuid,$2::jsonb) v', [id(1201), adoption])).rows[0].v, true);
  await accept(f, id(1201), adoption);
  assert.deepEqual(f.p.attr, { v: 1, carga: 0, re: 0 }); assert.equal(f.p.eco.pack.maxMass, 50);

  const ready = clone(f.p); ready.eco.pack.goods = { madera: 2, lona: 3 };
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, ready]); f.p = ready;
  const workshopProfile = clone(ready); workshopProfile.eco.pack.goods = {};
  workshopProfile.carry.backpack = 1; workshopProfile.eco.pack.cap = 30; workshopProfile.eco.pack.maxMass = 50;
  workshopProfile.eco.tradeRev++;
  const workshopRequest = { world, account, command: { type: 'artisan', op: 'upgradePack', opId: 'attribute-workshop', expectedRev: ready.eco.tradeRev },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, before: clone(ready), profile: workshopProfile, worldData: clone(f.w),
    ack: { type: 'artisan', op: 'upgradePack', opId: 'attribute-workshop', ok: true, why: '', rev: workshopProfile.eco.tradeRev,
      workshop: ready.workshop, carry: { v: 1, backpack: 1, volume: 30, strength: ready.lvl + 9, maxMass: 50 } } };
  await accept(f, id(1206), workshopRequest);
  assert.equal(f.p.eco.pack.cap, 30); assert.deepEqual(f.p.attr, { v: 1, carga: 0, re: 0 });

  const assign = request(f, 'assign', 'assign-carga', p => {
    p.attr = { v: 1, carga: 2, re: 0 }; p.eco.pack.maxMass = 60; p.eco.tradeRev++;
  });
  await accept(f, id(1202), assign); assert.equal(f.p.eco.pack.maxMass, 60);
  const reset = request(f, 'reset', 'reset-carga', p => {
    p.attr = { v: 1, carga: 0, re: 1 }; p.eco.pack.maxMass = 50; p.eco.tradeRev++;
  });
  await accept(f, id(1203), reset); assert.deepEqual(f.p.attr, { v: 1, carga: 0, re: 1 });
  assert.deepEqual((await f.db.query('select public.mn_attribute_operations_ready() r')).rows[0].r, { version: 1 });

  const carry = newProfile(); carry.carry.backpack = 1; carry.eco.pack.cap = 30; carry.eco.pack.maxMass = 18;
  carry.eco.pack.goods = { hierro: 6 }; await f.db.query('update public.mn_profiles set data=$2::jsonb,version=1 where player_id=$1::uuid', [account, carry]);
  f.p = carry; f.pv = 1;
  const carryAdopt = request(f, 'adopt', 'adopt-carry-mass', p => {
    p.attr = { v: 1, carga: 0, re: 0 }; p.eco.pack.maxMass = 50; p.eco.tradeRev++;
  });
  await accept(f, id(1204), carryAdopt); assert.equal(f.p.eco.pack.goods.hierro, 6);
  assert.equal(f.p.eco.pack.maxMass, 50); assert.equal(f.p.carry.backpack, 1); assert.equal(f.p.eco.pack.cap, 30);

  const heavyFixture = await fixture(t, { legacy: false }), heavy = clone(heavyFixture.p);
  heavy.carry.backpack = 2; heavy.eco.pack.cap = 42; heavy.eco.pack.goods = { hierro: 9 };
  await heavyFixture.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, heavy]);
  heavyFixture.p = heavy;
  const heavyCommand = { type: 'attributes', op: 'adopt', opId: 'heavy-denial', expectedRev: heavy.eco.tradeRev };
  const heavyDelta = draftAttributes(heavy, heavyCommand);
  assert.equal(heavyDelta.ack.why, 'heavy'); assert.deepEqual(heavyDelta.profile, heavy);
  const denied = { world, account, command: heavyCommand, expectedProfileVersion: 1, expectedWorldVersion: 1,
    before: clone(heavy), profile: heavyDelta.profile, worldData: clone(heavyFixture.w), ack: heavyDelta.ack };
  const denial = await commit(heavyFixture, id(1205), denied); assert.equal(denial.ok, true, JSON.stringify(denial));
  assert.deepEqual(denial.ack, heavyDelta.ack);
  assert.deepEqual((await heavyFixture.db.query('select data from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].data, heavy);
});

test('SQL029 rejects payload mismatch, CAS staleness, extra effects and direct profile attribute writes', async t => {
  const f = await fixture(t);
  const q = request(f, 'adopt', 'adopt-only', p => {
    p.attr = { v: 1, carga: 0, re: 0 }; p.carry = { v: 1, backpack: 0 };
    p.eco.pack = { cap: 18, maxMass: 50, goods: clone(f.p.eco.pack.goods) }; p.eco.tradeRev++;
  });
  const forged = clone(q); forged.profile.gold++;
  assert.equal((await commit(f, id(1210), forged)).ok, false);
  for (const mutate of [
    r => { r.ack.rev++; },
    r => { r.profile.v = 2; },
    r => { r.worldData.resources.tick = 9007199254740992; },
    r => { r.account = 'not-an-account'; },
    r => { r.world = ''; },
    r => { r.expectedWorldVersion = 2147483647; },
  ]) {
    const invalid = clone(q); mutate(invalid);
    assert.equal((await commit(f, id(1210), invalid)).ok, false);
  }
  await accept(f, id(1211), q);
  const original = (await f.db.query('select result from public.mn_economic_operations where operation_id=$1::uuid', [id(1211)])).rows[0].result;
  assert.deepEqual(await commit(f, id(1211), q), { ...original, replay: true });
  const mismatch = clone(q); mismatch.ack.limits.volume = 99;
  assert.equal((await commit(f, id(1211), mismatch)).ok, false);
  assert.deepEqual(await f.db.query('select public.mn_save_profile($1::uuid,$2::jsonb,2) r',
    [account, { ...f.p, attr: { v: 1, carga: 1, re: 0 } }]).then(r => r.rows[0].r), { ok: false, why: 'conflict' });
  const erased = { world, account, command: { type: 'commerce', op: 'buy', opId: 'erase-attr', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, profile: clone(f.p), worldData: clone(f.w),
    ack: { type: 'commerce', op: 'buy', opId: 'erase-attr', ok: false, why: 'gold', rev: f.p.eco.tradeRev } };
  delete erased.profile.attr;
  const eraseResult = await commit(f, id(1215), erased);
  assert.equal(eraseResult.ok, false); assert.equal(eraseResult.why, 'conflict');
  const staleCommand = { type: 'attributes', op: 'assign', opId: 'stale-command', expectedRev: f.p.eco.tradeRev - 1, stat: 'carga', n: 1 };
  const staleDelta = draftAttributes(f.p, staleCommand);
  assert.equal(staleDelta.ack.why, 'conflict'); assert.deepEqual(staleDelta.profile, f.p);
  const stale = { world, account, command: staleCommand, expectedProfileVersion: f.pv, expectedWorldVersion: f.wv,
    before: clone(f.p), profile: staleDelta.profile, worldData: clone(f.w), ack: staleDelta.ack };
  await accept(f, id(1212), stale);
  const wrongAckRev = clone(q); wrongAckRev.ack.opId = wrongAckRev.command.opId = 'wrong-rev'; wrongAckRev.ack.rev++;
  assert.equal((await commit(f, id(1213), wrongAckRev)).ok, false);
  const backwards = clone(stale); backwards.ack.opId = backwards.command.opId = 'backwards-tick';
  backwards.expectedProfileVersion = f.pv; backwards.expectedWorldVersion = f.wv;
  backwards.before = clone(f.p); backwards.profile = clone(f.p); backwards.worldData = clone(f.w);
  backwards.ack = draftAttributes(f.p, backwards.command).ack; backwards.worldData.resources.tick--;
  assert.deepEqual(await commit(f, id(1214), backwards), { ok: false, why: 'conflict' });
});

test('SQL029 assign can introduce the optional attribute record when a backpack already exists', async t => {
  const f = await fixture(t, { legacy: false });
  f.p.lvl = 3; f.p.eco.pack.maxMass = 22;
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, f.p]);
  await accept(f, id(1230), request(f, 'assign', 'first-carga', p => {
    p.attr = { v: 1, carga: 2, re: 0 }; p.eco.pack.maxMass = 60; p.eco.tradeRev++;
  }));
  assert.deepEqual(f.p.attr, { v: 1, carga: 2, re: 0 });
});

test('SQL029 validator and readiness stay service-only, and legacy economic receipts remain replayable', async t => {
  const f = await fixture(t, { applyAttrs: false });
  const legacy = { world, account, command: { type: 'commerce', op: 'buy', opId: 'old-receipt', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: clone(f.p), worldData: clone(f.w),
    ack: { type: 'commerce', op: 'buy', opId: 'old-receipt', ok: true, why: '', rev: 0 } };
  const result = await commit(f, id(1220), legacy); assert.equal(result.ok, true);
  await f.db.exec('RESET ROLE'); await f.db.exec(attrs); await f.db.exec(attrs); await f.db.exec('SET ROLE service_role');
  await f.db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(f.db.query('select public.mn_attribute_operations_ready()'));
  await assert.rejects(f.db.query('select public.mn_valid_attribute_request($1::uuid,$2::jsonb)', [id(1), legacy]));
  await f.db.exec('RESET ROLE'); await f.db.exec(attrs); await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await commit(f, id(1220), legacy), { ...result, replay: true });
});

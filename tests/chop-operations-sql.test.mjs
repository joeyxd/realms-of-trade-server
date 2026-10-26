import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP = 'f0000000-0000-4000-8000-000000000001';
const copy = structuredClone;
async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
  for (const name of (await readdir(new URL('../server/migrations/', import.meta.url))).filter(n => /^\d.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8'));
  return db;
}
function fixture() {
  const before = newProfile(), profile = copy(before), other = copy(before);
  profile.eco.pack.goods = { tronco: 3, resina: 1, coco: 1 }; profile.eco.tradeRev++;
  profile.progression.practice.logging += 6; other.progression.practice.logging += 4;
  const worldData = { v: 1, seed: 71, economy: new Economy(71).serialize(), resources: { v: 3, tick: 100,
    nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {},
    logging: { 'palm-1': { cycle: 1, contributors: [], quality: 0 } } } };
  return { before, worldData, request: { world: 'chop-sql', account: ACTOR, expectedProfileVersion: 1,
    expectedWorldVersion: 1, profile, worldData,
    command: { type: 'resource', op: 'pickup', opId: 'pickup-test', pile: 'pile-1', expectedRev: 1 },
    ack: { type: 'resource', op: 'pickup', opId: 'pickup-test', ok: true, why: '', rev: 1,
      pile: 'pile-1', goods: { tronco: 3, resina: 1, coco: 1 }, count: 5, left: 0, profileRev: 1 },
    beneficiaries: [{ account: ACTOR, expectedVersion: 1, before: copy(before), profile },
      { account: OTHER, expectedVersion: 1, before: copy(before), profile: other }] } };
}
async function valid(db, request) {
  return (await db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [OP, request])).rows[0].ok;
}
async function seed(db, f) {
  await db.exec('RESET ROLE; TRUNCATE public.mn_economic_operations CASCADE; DELETE FROM public.mn_worlds; DELETE FROM public.mn_profiles;');
  for (const row of f.request.beneficiaries ?? [{ account: ACTOR, before: f.before }])
    await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [row.account, row.before]);
  await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [f.request.world, f.worldData]);
  await db.exec('SET ROLE service_role');
}
const commit = async (db, request) => (await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, request])).rows[0].result;

test('SQL045 readiness, rerun and permissions; valid pickup, practice and replay use the existing receipt', async t => {
  const db = await database(t), f = fixture();
  await db.exec(await readFile(new URL('../server/migrations/045_chop_operations.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('select public.mn_chop_operations_ready() ready')).rows[0].ready, { version: 1 });
  assert.deepEqual((await db.query(`select has_function_privilege('service_role','public.mn_chop_operations_ready()','EXECUTE') service,
    has_function_privilege('anon','public.mn_chop_operations_ready()','EXECUTE') anon,
    has_function_privilege('authenticated','public.mn_chop_operations_ready()','EXECUTE') authenticated`)).rows[0],
  { service: true, anon: false, authenticated: false });
  assert.equal(await valid(db, f.request), true);
  await seed(db, f);
  const result = await commit(db, f.request); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.profiles.map(row => row.version), [2, 2]);
  assert.equal((await commit(db, f.request)).replay, true);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('select economy from public.mn_worlds')).rows[0].economy, f.worldData);
  assert.equal((await db.query('select version from public.mn_profiles where player_id=$1', [ACTOR])).rows[0].version, 2);
});

test('SQL045 refuses forged goods, profile fields, practice, beneficiaries and ack shapes', async t => {
  const db = await database(t), f = fixture();
  const cases = [
    r => { r.profile.eco.pack.goods.piedra = 1; r.ack.goods.piedra = 1; r.ack.count++; },
    r => { r.profile.eco.pack.goods.tronco = 9; r.ack.goods.tronco = 9; r.ack.count = 11; },
    r => { r.profile.gold++; },
    r => { r.profile.progression.practice.logging = 7; },
    r => { r.beneficiaries[1].profile.gold++; },
    r => { r.beneficiaries[1].profile.progression.milestones.push('logging_steady'); },
    r => { r.ack.extra = true; },
    r => { r.command.extra = true; },
    r => { r.profile.eco.pack.maxMass++; },
    r => { r.profile.eco.pack.goods.resina = 2; r.ack.goods.resina = 2; r.ack.count++; },
    r => { delete r.beneficiaries; },
  ];
  for (const [i, mutate] of cases.entries()) {
    const r = copy(f.request); mutate(r);
    assert.equal(await valid(db, r), false, `forgery ${i}`);
  }
  const four = copy(f.request);
  for (const account of ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'])
    four.beneficiaries.push({ account, expectedVersion: 1, before: copy(f.before), profile: copy(f.before) });
  assert.equal(await valid(db, four), true, 'actor and three other profiles fit');
  four.beneficiaries.push({ ...copy(four.beneficiaries[3]), account: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
  assert.equal(await valid(db, four), false, 'a fourth beneficiary is refused');
  const absent = copy(f.request);
  for (const row of absent.beneficiaries) { delete row.before.progression; delete row.profile.progression; }
  assert.equal(await valid(db, absent), true, 'absent progression stays absent without an award');
  const cap = copy(f.request);
  for (const row of cap.beneficiaries) row.before.progression.practice.logging = row.profile.progression.practice.logging = 1000000000;
  assert.equal(await valid(db, cap), true, 'capped contributors need no profile change');
});

test('SQL045 refuses any world change under the locked baseline', async t => {
  const db = await database(t), f = fixture(); await seed(db, f);
  for (const mutate of [r => r.worldData.economy.hours++, r => r.worldData.resources.nodes[0].rev++,
    r => r.worldData.resources.tick++, r => { r.worldData.resources.cooldowns[ACTOR] = 200; }]) {
    const r = copy(f.request); mutate(r);
    assert.equal((await commit(db, r)).ok, false);
    assert.equal((await db.query('select count(*)::integer n from public.mn_economic_operations')).rows[0].n, 0);
  }
});

test('SQL045 accepts iron and steel bench crafting and refuses already-owned tiers or forged tools', async t => {
  const db = await database(t);
  for (const [recipe, tier, goods] of [['hacha_hierro', 2, { madera: 2, mineral_hierro: 3 }], ['hacha_acero', 3, { madera: 3, hierro: 4 }]]) {
    const f = fixture(); delete f.request.beneficiaries;
    f.before.lvl = 10; f.before.carry.backpack = 1; f.before.eco.pack.cap = 30; f.before.eco.pack.maxMass = 36;
    f.before.eco.pack.goods = goods; f.request.profile = copy(f.before);
    f.request.profile.eco.pack.goods = {}; f.request.profile.eco.tradeRev = 1; f.request.profile.tools.axe = tier;
    f.request.command = { type: 'resource', op: 'craft', opId: recipe, recipe, n: 1, expectedRev: 0 };
    f.request.ack = { type: 'resource', op: 'craft', opId: recipe, ok: true, why: '', rev: 1, tool: 'axe', tier, count: 1 };
    await seed(db, f);
    const result = await commit(db, f.request);
    assert.equal(result.ok, true, JSON.stringify({ recipe, result, valid: await valid(db, f.request), transition: (await db.query('select public.mn_chop_craft_transition($1::jsonb,$2::jsonb) ok', [f.before, f.request])).rows[0] }));
    f.before.tools.axe = tier;
    await seed(db, f);
    assert.equal((await commit(db, f.request)).ok, false, `${recipe} already owned`);
    f.before.tools.axe = 0;
    await seed(db, f);
    f.request.profile.tools.pickaxe = 1;
    assert.equal((await commit(db, f.request)).ok, false, `${recipe} forged pickaxe`);
  }
});

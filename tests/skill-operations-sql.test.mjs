import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { C } from '../src/sim/ecs.js';
import { createLoggingChallenge } from '../src/sim/systems/loggingTiming.js';
import { draftResource, upgradeTimingState } from '../server/resourceState.mjs';
import { loggingParticipants } from '../server/loggingOperation.mjs';
import { teachStorage } from '../server/artisanOperation.mjs';
import { draftSkills, validStoredSkillRequest } from '../server/skillOperation.mjs';
import { RESET_FREE, SKILL_RESET_GOLD } from '../src/data/skillTree.js';

// Every migration through SQL039 really executes in PGlite, then SQL040 (twice: it must be rerunnable).
const MIGRATIONS = new URL('../server/migrations/', import.meta.url);
const NAMES = (await readdir(MIGRATIONS)).filter(n => /^\d{3}_[a-z0-9_]+\.sql$/.test(n) && n < '040').sort();
const SQL = Object.fromEntries(await Promise.all(NAMES.map(async n => [n, await readFile(new URL(n, MIGRATIONS), 'utf8')])));
const SQL040 = await readFile(new URL('040_skill_operations.sql', MIGRATIONS), 'utf8');
const OLD_VALIDATOR = SQL['016_logging_operations.sql']
  .match(/CREATE OR REPLACE FUNCTION public\.mn_valid_logging_progression[\s\S]*?\$function\$;/)[0];
const ACCOUNT = 'aaaa0000-0000-4000-8000-000000000001', CONTRIBUTOR = 'bbbb0000-0000-4000-8000-000000000002';
const WORLD = 'skills-sql-world', SEED = 91;
const copy = structuredClone;
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

async function database(t, { skills = true } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
  assert.ok(NAMES.length >= 39 && NAMES.at(-1).startsWith('039_'), NAMES.at(-1));
  for (const name of NAMES) await db.exec(SQL[name]);
  if (skills) { await db.exec(SQL040); await db.exec(SQL040); }
  return db;
}
const one = async (db, text, params = []) => (await db.query(text, params)).rows[0];
const json = value => JSON.stringify(value);
const validProgression = async (db, p) => (await one(db, 'select public.mn_valid_logging_progression($1::jsonb) ok', [json(p)])).ok;
async function seed(db, profiles, worldData) {
  await db.exec('RESET ROLE');
  for (const [account, data] of profiles)
    await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, json(data)]);
  await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, json(worldData)]);
  await db.exec('SET ROLE service_role');
}
const commit = async (db, operationId, request) =>
  (await one(db, 'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) r', [operationId, json(request)])).r;
async function stored(db, account = ACCOUNT) {
  await db.exec('RESET ROLE');
  const row = await one(db, 'select data,version from public.mn_profiles where player_id=$1::uuid', [account]);
  await db.exec('SET ROLE service_role');
  return row;
}
const receipt = async (db, operationId) => (await one(db, 'select count(*)::int n from public.mn_economic_operations where operation_id=$1::uuid', [operationId])).n;

function worldData() {
  return { v: 1, seed: SEED, economy: new Economy(SEED).serialize(), community: { v: 1, epoch: id(900),
    project: { id: 'salty-shore-carpentry', version: 1, requirements: { madera: 50, piedra: 20 }, contributed: { madera: 0, piedra: 0 } } },
    resources: upgradeTimingState({ v: 1, tick: 100, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} }) };
}
// Saber mastery 4: combat rank 4 earns 6 points; the legacy arts spend 3 on adoption.
function character() { const p = newProfile(); p.mast = [[4, 0], [1, 0]]; p.gold = 200; return p; }
function skillRequest(f, command) {
  const drafted = draftSkills(f.p, command);
  return { world: WORLD, account: ACCOUNT, command, expectedProfileVersion: f.pv, expectedWorldVersion: f.wv,
    before: copy(f.p), profile: drafted.profile, worldData: copy(f.w), ack: drafted.ack };
}
const assign = (f, opId, node = 'lunge') => ({ type: 'skills', op: 'assign', opId, expectedRev: f.p.eco.tradeRev, tree: 'combat', node });
const reset = (f, opId) => ({ type: 'skills', op: 'reset', opId, expectedRev: f.p.eco.tradeRev, tree: 'combat' });
async function accept(f, operationId, request) {
  assert.equal(validStoredSkillRequest(request), true, 'the JS historical diff accepts the SQL receipt');
  const result = await commit(f.db, operationId, request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.ack, request.ack);
  assert.deepEqual(await commit(f.db, operationId, request), { ...result, replay: true });
  f.p = copy(request.profile); f.w = copy(request.worldData); f.pv = result.profileVersion; f.wv = result.worldVersion;
  assert.deepEqual((await stored(f.db)).data, f.p);
  return result;
}
async function skillFixture(t) {
  const db = await database(t), f = { db, p: character(), w: worldData(), pv: 1, wv: 1 };
  await seed(db, [[ACCOUNT, f.p]], f.w);
  return f;
}

const V3_FULL = { v: 3, practice: { logging: 60, survival: 4, sailing: 3, crafting: 2, trade: 1 },
  milestones: ['logging_steady', 'pilot_coastal'], knowledge: ['raft_storage'], skills: { lunge: 2, tromba: 3, haggling: 0 },
  skr: { combat: 1, exploration: 1000 }, skg: { combat: 45, survival: 0, sailing: 0, crafting: 0, trade: 18 } };

test('SQL040 reset literals match RESET_FREE and SKILL_RESET_GOLD', () => {
  const price = SQL040.match(/price:=CASE WHEN used>=(\d+) THEN (\d+) ELSE 0 END;/);
  assert.ok(price);
  assert.equal(Number(price[1]), RESET_FREE);
  assert.equal(Number(price[2]), SKILL_RESET_GOLD);
});

test('SQL040 readiness detects either pre-040 writer and recovers after rerunning the migration', async t => {
  const db = await database(t, { skills: false });
  const old = await one(db, `select
    pg_get_functiondef('public.mn_commit_economic_operation(uuid,jsonb)'::regprocedure) commit,
    pg_get_functiondef('public.mn_save_profile(uuid,jsonb,integer)'::regprocedure) save`);
  await db.exec(SQL040);
  for (const body of [old.commit, old.save]) {
    await db.exec('SET ROLE service_role');
    assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 1 });
    await db.exec('RESET ROLE');
    await db.exec(body);
    await db.exec('SET ROLE service_role');
    assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 0 });
    await db.exec('RESET ROLE');
    await db.exec(SQL040);
    await db.exec('SET ROLE service_role');
    assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 1 });
    await db.exec('RESET ROLE');
  }
});

test('SQL040 autosave guards skill state on update and creation while allowing unchanged and legacy profiles', async t => {
  const db = await database(t), p = character();
  // Exercise the invoker RPC with the service role's production RLS behavior.
  await db.exec('ALTER ROLE service_role BYPASSRLS');
  p.progression = copy(V3_FULL);
  await seed(db, [[ACCOUNT, p]], worldData());
  const save = async (account, data, version) => (await one(db,
    'select public.mn_save_profile($1::uuid,$2::jsonb,$3::integer) r', [account, json(data), version])).r;
  for (const edit of [
    p => { p.progression.skills.lunge++; }, p => { p.progression.skr.combat++; },
    p => { p.progression.skg.combat--; }, p => { delete p.progression; },
    ...['skills', 'skr', 'skg'].map(k => p => { delete p.progression[k]; }),
    ...['survival', 'sailing', 'crafting', 'trade'].flatMap(k => [
      p => { p.progression.practice[k]++; }, p => { delete p.progression.practice[k]; },
    ]),
  ]) {
    const changed = copy(p); edit(changed);
    assert.deepEqual(await save(ACCOUNT, changed, 1), { ok: false, why: 'conflict' }, String(edit));
    assert.deepEqual(await stored(db), { data: p, version: 1 });
  }
  const equal = copy(p); equal.xp++; equal.progression.practice.logging++;
  assert.deepEqual(await save(ACCOUNT, equal, 1), { ok: true, version: 2 });
  assert.deepEqual(await stored(db), { data: equal, version: 2 });
  for (const edit of [
    ...['skills', 'skr', 'skg'].flatMap(k => [p => { p.progression[k] = {}; }, p => { p.progression[k] = null; }]),
    ...['survival', 'sailing', 'crafting', 'trade'].map(k => p => { p.progression.practice[k] = 0; }),
  ]) {
    const changed = character(); changed.progression.v = 3; edit(changed);
    assert.deepEqual(await save(CONTRIBUTOR, changed, 0), { ok: false, why: 'operation' });
    assert.equal(await stored(db, CONTRIBUTOR), undefined);
  }
  for (const [n, data] of [[101, character()], [102, (({ progression, ...rest }) => rest)(character())],
    [103, { ...character(), progression: { v: 3, practice: { logging: 0 }, milestones: [], knowledge: [] } }]]) {
    assert.deepEqual(await save(id(n), data, 0), { ok: true, version: 1 });
    assert.deepEqual(await save(id(n), data, 1), { ok: true, version: 2 });
    assert.deepEqual((await stored(db, id(n))).data, data);
    assert.deepEqual(await save(id(n), p, 2), { ok: false, why: 'conflict' }, 'autosave cannot adopt skills');
  }
});

test('SQL040 and JS keep historical catalog shapes valid across receipt replay and migration reapplication', async t => {
  const f = await skillFixture(t), request = skillRequest(f, assign(f, 'historical-catalog'));
  delete request.profile.progression.skills.haggling;
  request.profile.progression.skills.retired_node = 1;
  request.profile.progression.skg.exploration = 4;
  assert.equal(validStoredSkillRequest(request), true);
  assert.equal((await one(f.db, 'select public.mn_valid_skill_request($1::uuid,$2::jsonb) ok',
    [id(105), json(request)])).ok, true);
  const result = await accept(f, id(105), request);
  await f.db.exec('RESET ROLE');
  await f.db.exec(SQL040);
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await commit(f.db, id(105), request), { ...result, replay: true });
  assert.deepEqual((await stored(f.db)).data, request.profile);
});

test('SQL040 is rerunnable, service-only, keeps SQL037 readiness, and its probe fails on SQL016\'s old validator', async t => {
  const db = await database(t);
  assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 1 });
  assert.deepEqual((await one(db, 'select public.mn_torch_resin_coconut_ready() r')).r, { version: 1 },
    'the torch readiness still finds its normalizer and validated constraint behind the new wrappers');
  const acl = await one(db, `select has_function_privilege('service_role','public.mn_skill_operations_ready()','EXECUTE') ready,
    has_function_privilege('service_role','public.mn_valid_skill_request(uuid,jsonb)','EXECUTE') validator,
    has_function_privilege('service_role','public.mn_commit_economic_operation(uuid,jsonb)','EXECUTE') commit_rpc,
    has_function_privilege('service_role','public.mn_commit_economic_operation_skill_base(uuid,jsonb)','EXECUTE') base,
    has_function_privilege('anon','public.mn_skill_operations_ready()','EXECUTE') anon,
    has_function_privilege('authenticated','public.mn_valid_skill_request(uuid,jsonb)','EXECUTE') authenticated,
    has_function_privilege('authenticated','public.mn_economic_preserves_skills(jsonb)','EXECUTE') guard`);
  assert.deepEqual(acl, { ready: true, validator: true, commit_rpc: true, base: false, anon: false, authenticated: false, guard: false });
  await db.exec('SET ROLE service_role');
  assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 1 });
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(db.query('select public.mn_skill_operations_ready()'), { code: '42501' });
  }
  await db.exec('RESET ROLE');
  await db.exec(OLD_VALIDATOR);
  assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 0 });
  assert.equal(await validProgression(db, V3_FULL), false, 'SQL016 refuses every v3 block');
  await db.exec(SQL040);
  assert.deepEqual((await one(db, 'select public.mn_skill_operations_ready() r')).r, { version: 1 });
  const before = await database(t, { skills: false });
  assert.equal((await one(before, "select to_regprocedure('public.mn_skill_operations_ready()') r")).r, null);
});

test('the v1/v2 validator answers stay unchanged and v3 accepts everything readProgression accepts', async t => {
  const fresh = await database(t), legacy = await database(t, { skills: false });
  const base = { v: 1, practice: { logging: 0 }, milestones: [], knowledge: [] };
  const v1v2 = [base, { ...base, milestones: ['logging_steady'] }, { ...base, milestones: ['pilot_coastal'] },
    { ...base, v: 2, milestones: ['logging_steady', 'pilot_coastal'] }, { ...base, v: 2, milestones: ['pilot_coastal', 'pilot_coastal'] },
    { ...base, v: 2, milestones: ['logging_steady', 'pilot_coastal', 'logging_steady'] }, { ...base, knowledge: ['raft_storage'] },
    { ...base, knowledge: ['raft_storage', 'raft_storage'] }, { ...base, knowledge: ['other'] }, { ...base, practice: { logging: 1000000000 } },
    { ...base, practice: { logging: 1000000001 } }, { ...base, practice: { logging: -1 } }, { ...base, practice: { logging: 1.5 } },
    { ...base, practice: { logging: 3, survival: 1 } }, { ...base, v: 2, skills: { lunge: 1 } }, { ...base, v: 0 }, { ...base, v: '1' },
    { ...base, extra: 1 }, (({ knowledge, ...rest }) => rest)(base), { ...base, practice: [] }, { ...base, milestones: {} }, null, [], 7];
  for (const p of v1v2) {
    assert.equal(await validProgression(fresh, p), await validProgression(legacy, p), JSON.stringify(p));
    let js = true; try { readProgression(p); } catch { js = false; }
    if (p && typeof p === 'object' && !Array.isArray(p)) assert.equal(await validProgression(fresh, p), js, JSON.stringify(p));
  }
  const v3 = { v: 3, practice: { logging: 0 }, milestones: [], knowledge: [] };
  const allSkills = Object.fromEntries((await import('../src/data/skillTree.js')).NODES.map(n => [n.id, 3]));
  const accepted = [v3, V3_FULL, { ...v3, skills: {}, skr: {}, skg: {} }, { ...v3, skills: allSkills },
    { ...v3, practice: { logging: 1000000000, trade: 1000000000 } }, { ...v3, milestones: ['pilot_coastal'] }];
  const refused = [(({ practice, ...rest }) => rest)(v3), { ...v3, practice: { survival: 1 } }, { ...v3, practice: { logging: 0, combat: 1 } },
    { ...v3, practice: { logging: 0, survival: -1 } }, { ...v3, practice: { logging: 0, sailing: 1000000001 } },
    { ...v3, milestones: ['logging_steady', 'pilot_coastal', 'logging_steady'] }, { ...v3, milestones: ['x'] },
    { ...v3, milestones: ['pilot_coastal', 'pilot_coastal'] }, { ...v3, knowledge: ['raft_storage', 'raft_storage'] }, { ...v3, knowledge: ['x'] },
    { ...v3, skills: { lunge: 4 } }, { ...v3, skills: { lunge: -1 } }, { ...v3, skills: { lunge: 1.5 } }, { ...v3, skills: [] },
    { ...v3, skills: { 'Bad-Id': 1 } }, { ...v3, skr: { nope: 1 } }, { ...v3, skr: { combat: 1001 } }, { ...v3, skg: { combat: 46 } },
    { ...v3, skg: [] }, { ...v3, extra: true }, { ...v3, v: 4 }];
  // Catalog membership and per-tree grant caps stay in JS: SQL accepts these, readProgression does not.
  const looser = [{ ...v3, skills: { future_node: 1 } }, { ...v3, skg: { trade: 30 } }, { ...v3, skg: { exploration: 1 } }];
  for (const p of accepted) { assert.doesNotThrow(() => readProgression(p)); assert.equal(await validProgression(fresh, p), true, json(p)); }
  for (const p of refused) { assert.throws(() => readProgression(p)); assert.equal(await validProgression(fresh, p), false, json(p)); }
  for (const p of looser) { assert.throws(() => readProgression(p)); assert.equal(await validProgression(fresh, p), true, json(p)); }
  for (const p of [...accepted, ...looser]) assert.equal(await validProgression(legacy, p), false, 'SQL016 refused every v3 block');
});

test('SQL040 commits adoption, assign, free and paid resets, and refuses short gold as an exact no-op', async t => {
  const f = await skillFixture(t);
  const adopt = skillRequest(f, assign(f, 'assign-lunge'));
  assert.equal(adopt.ack.ok, true, adopt.ack.why);
  assert.equal((await one(f.db, 'select public.mn_valid_skill_request($1::uuid,$2::jsonb) ok', [id(1), json(adopt)])).ok, true);
  await accept(f, id(1), adopt);
  assert.equal(f.p.progression.v, 3); assert.equal(f.p.progression.skills.lunge, 2);
  assert.deepEqual(await commit(f.db, id(1), skillRequest({ ...f, p: adopt.before, pv: 1, wv: 1 }, assign({ p: adopt.before }, 'assign-lunge', 'wave'))),
    { ok: false, why: 'operation' }, 'one operation identity cannot be rebound to another node');
  await accept(f, id(2), skillRequest(f, reset(f, 'reset-free')));
  assert.equal(f.p.gold, 200); assert.deepEqual(f.p.progression.skr, { combat: 1 });
  await accept(f, id(3), skillRequest(f, assign(f, 'assign-again')));
  await accept(f, id(4), skillRequest(f, reset(f, 'reset-paid')));
  assert.equal(f.p.gold, 50); assert.deepEqual(f.p.progression.skr, { combat: 2 });
  await accept(f, id(5), skillRequest(f, assign(f, 'assign-third')));
  const short = skillRequest(f, reset(f, 'reset-short'));
  assert.equal(short.ack.why, 'gold');
  await accept(f, id(6), short);
  const stale = skillRequest(f, { ...assign(f, 'stale'), expectedRev: f.p.eco.tradeRev - 1 });
  assert.equal(stale.ack.why, 'conflict');
  await accept(f, id(7), stale);
  assert.equal((await stored(f.db)).version, 8);
});

test('SQL040 refuses forged skill receipts and leaves profile, world and receipts untouched', async t => {
  const f = await skillFixture(t);
  await accept(f, id(10), skillRequest(f, assign(f, 'setup-assign')));
  const valid = { assign: skillRequest(f, assign(f, 'forged-assign')), reset: skillRequest(f, reset(f, 'forged-reset')) };
  for (const q of Object.values(valid)) assert.equal(q.ack.ok, true, q.ack.why);
  const forgeries = [
    ['assign', q => { q.profile.gold++; }], ['assign', q => { q.profile.progression.skills.lunge++; }],
    ['assign', q => { q.profile.progression.skills.wave++; }], ['assign', q => { q.profile.progression.skr = { combat: 1 }; }],
    ['assign', q => { q.profile.progression.skg.combat++; }], ['assign', q => { q.profile.progression.practice.trade = 5; }],
    ['assign', q => { q.profile.progression.milestones = ['logging_steady']; }], ['assign', q => { q.profile.xp = 5; }],
    ['assign', q => { q.profile.eco.pack.goods = { madera: 1 }; }], ['assign', q => { q.profile.progression.v = 2; }],
    ['assign', q => { q.ack.points = { free: 1 }; }], ['assign', q => { q.ack.rev++; }], ['assign', q => { q.profile.eco.tradeRev--; q.ack.rev--; }],
    ['assign', q => { q.command.n = 1; }], ['assign', q => { q.command.node = 'Lunge'; }], ['assign', q => { q.command.tree = 'pirates'; }],
    ['assign', q => { q.ack.ok = false; q.ack.why = 'points'; q.ack.rev = q.before.eco.tradeRev; }],
    ['reset', q => { q.profile.progression.skr = {}; }], ['reset', q => { q.profile.progression.skr.trade = 1; }],
    ['reset', q => { q.profile.gold -= 150; }],
    ['reset', q => { q.profile.progression.skills.lunge = 1; }], ['reset', q => { q.profile.progression.skills = q.before.progression.skills; }],
    ['reset', q => { q.command.node = 'lunge'; }],
  ];
  for (const [kind, forge] of forgeries) {
    const forged = copy(valid[kind]); forge(forged);
    assert.equal(validStoredSkillRequest(forged), false, `JS historical diff: ${kind}: ${forge}`);
    const result = await commit(f.db, id(11), forged);
    assert.equal(result.ok, false, `${kind}: ${forge}`);
    assert.equal(await receipt(f.db, id(11)), 0);
    assert.deepEqual((await stored(f.db)).data, f.p);
  }
  const staleBefore = copy(valid.assign); staleBefore.before.gold = 1; staleBefore.profile.gold = 1;
  assert.equal((await commit(f.db, id(12), staleBefore)).ok, false);
  const worldEdit = copy(valid.assign); worldEdit.worldData.economy.markets.aldea.stock.madera = 99;
  assert.deepEqual(await commit(f.db, id(13), worldEdit), { ok: false, why: 'conflict' });
  // Paid reset needs the gold: the second reset of the tree is charged by SQL too.
  await accept(f, id(14), valid.reset);
  await accept(f, id(15), skillRequest(f, assign(f, 'after-free')));
  const unpaid = skillRequest(f, reset(f, 'unpaid')); unpaid.profile.gold = unpaid.before.gold;
  assert.equal((await commit(f.db, id(16), unpaid)).ok, false);
});

test('every other economic command keeps node ranks, resets, grants and peaceful practice', async t => {
  const f = await skillFixture(t);
  await accept(f, id(20), skillRequest(f, assign(f, 'skills-first')));
  const buy = (profile, opId) => ({ world: WORLD, account: ACCOUNT,
    command: { type: 'commerce', op: 'buy', opId, town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
    expectedProfileVersion: f.pv, expectedWorldVersion: f.wv, profile, worldData: copy(f.w),
    ack: { type: 'commerce', op: 'buy', opId, ok: false, why: 'gold', rev: profile.eco.tradeRev } });
  for (const edit of [p => { p.progression.skills.lunge = 3; }, p => { delete p.progression.skills; }, p => { p.progression.skr = { combat: 1 }; },
    p => { p.progression.skg.combat = 9; }, p => { p.progression.practice.survival = 40; }]) {
    const altered = copy(f.p); edit(altered);
    assert.deepEqual(await commit(f.db, id(21), buy(altered, 'cannot-alter')), { ok: false, why: 'conflict' });
    assert.equal(await receipt(f.db, id(21)), 0);
  }
  const unchanged = await commit(f.db, id(22), buy(copy(f.p), 'keeps-skills'));
  assert.equal(unchanged.ok, true, JSON.stringify(unchanged));
  assert.deepEqual((await stored(f.db)).data.progression, f.p.progression);

  // Control: before SQL040 nothing stopped an ordinary receipt from rewriting the block.
  const legacy = await database(t, { skills: false }), adopted = copy(f.p);
  await seed(legacy, [[ACCOUNT, adopted]], f.w);
  const rewritten = copy(adopted); rewritten.progression.skills.lunge = 3;
  f.pv = 1; f.wv = 1;
  assert.equal((await commit(legacy, id(23), buy(rewritten, 'legacy-rewrite'))).ok, true);
});

function palmProfile(progression, goods = {}) {
  const p = newProfile();
  p.tools.axe = 1; p.carry.backpack = 2; p.lvl = 10; p.attr = { v: 1, carga: 9, re: 0 };
  p.eco.pack.goods = copy(goods); p.progression = copy(progression);
  return sanitizeProfile(p);
}
function palmReceipt(actorProgression, contributorProgression) {
  const state = { v: 3, tick: 100, nodes: [{ id: 'palm-1', kind: 'palm', rev: 3, hits: 2, readyAt: 0 }], cooldowns: {},
    logging: { 'palm-1': { cycle: 1, contributors: [{ actor: ACCOUNT, hits: 1 }, { actor: CONTRIBUTOR, hits: 1 }], quality: 0 } } };
  const actor = palmProfile(actorProgression), contributor = palmProfile(contributorProgression);
  const vector = () => new Float64Array(3);
  const sim = { tick: 100, economy: new Economy(SEED), map: { groundAt: () => 2, onDock: () => false },
    raftDeck: { surface: () => null }, ecs: { alive: new Uint8Array(3), dead: vector(), mask: new Uint16Array(3),
      hp: vector(), x: vector(), y: vector(), z: vector(), moveMag: vector(), vx: vector(), vz: vector(),
      dashT: new Float64Array(3).fill(-1), dashBuffer: vector(), castK: vector(), castLock: vector(),
      atkStage: vector(), regenT: new Float64Array(3).fill(100) }, profiles: new Map([[1, copy(actor)]]),
    profileDirty: new Set(), harvestLootEnabled: false, loggingTimingVersion: 3,
    resources: { nodes: new Map([['palm-1', { id: 'palm-1', kind: 'palm', x: 0, y: 2, z: 0, rev: 3, hits: 2, readyTick: 0 }]]),
      cooldowns: new Map(), receipts: new Map(), bench: null } };
  sim.ecs.alive[1] = 1; sim.ecs.mask[1] = C.PLAYER; sim.ecs.hp[1] = 100; sim.ecs.y[1] = 2;
  const challenge = createLoggingChallenge({ node: 'palm-1', rev: 3, startTick: 100,
    practice: readProgression(actorProgression).practice.logging });
  const timing = { challenge, receivedTick: challenge.targetTick, quality: 1 };
  const command = { type: 'resource', op: 'gather', opId: 'v3-palm', node: 'palm-1', expectedRev: 3, challenge: 'challenge-v3-palm' };
  const proposal = draftResource(sim, 1, command, actor, state, ACCOUNT, timing.receivedTick,
    new Map([[ACCOUNT, actor], [CONTRIBUTOR, contributor]]), timing);
  assert.equal(proposal.ack.ok, true, JSON.stringify(proposal.ack));
  const after = new Map(proposal.profiles); after.set(ACCOUNT, copy(proposal.profile));
  const request = { world: WORLD, account: ACCOUNT, command, expectedProfileVersion: 1, expectedWorldVersion: 1,
    profile: copy(proposal.profile), worldData: { v: 1, seed: SEED, economy: new Economy(SEED).serialize(), resources: proposal.resources },
    ack: proposal.ack, beneficiaries: [...after].sort(([a], [b]) => a.localeCompare(b)).map(([account, profile]) => ({
      account, expectedVersion: 1, before: account === ACCOUNT ? actor : contributor, profile })) };
  return { request, state, actor, contributor };
}

test('logging beneficiaries accept a v3 block after SQL040 and keep its skill state (SQL016 lane)', async t => {
  const offline = { v: 3, practice: { logging: 10, sailing: 7 }, milestones: ['pilot_coastal'], knowledge: [],
    skills: { lunge: 1, blast: 2 }, skr: { trade: 2 }, skg: { combat: 3, survival: 0, sailing: 0, crafting: 0, trade: 0 } };
  const { request, state, actor, contributor } = palmReceipt(V3_FULL, offline);
  assert.deepEqual(loggingParticipants(request).map(r => r.account), [ACCOUNT, CONTRIBUTOR], 'the JS contract accepts the v3 award');
  for (const row of request.beneficiaries) {
    const { practice: before, ...beforeRest } = row.before.progression, { practice: after, ...afterRest } = row.profile.progression;
    assert.deepEqual(afterRest, beforeRest, 'the award touches neither skills, skr, skg, milestones nor knowledge here');
    assert.deepEqual({ ...after, logging: 0 }, { ...before, logging: 0 }, 'only logging practice is credited');
    assert.ok(after.logging > before.logging);
  }
  for (const forge of [r => { r.beneficiaries[1].profile.progression.skills.lunge = 3; },
    r => { r.beneficiaries[1].profile.progression.practice.sailing = 70; }, r => { r.beneficiaries[1].profile.progression.skr = {}; }]) {
    const forged = copy(request); forge(forged);
    assert.throws(() => loggingParticipants(forged), 'the JS contract recomputes the exact award');
  }
  const world = { v: 1, seed: SEED, economy: new Economy(SEED).serialize(), resources: copy(state) };

  const legacy = await database(t, { skills: false });
  await seed(legacy, [[ACCOUNT, actor], [CONTRIBUTOR, contributor]], world);
  assert.deepEqual(await commit(legacy, id(30), request), { ok: false, why: 'operation' }, 'SQL039 refuses the v3 beneficiaries');

  const db = await database(t);
  await seed(db, [[ACCOUNT, actor], [CONTRIBUTOR, contributor]], world);
  for (const forge of [r => { r.beneficiaries[1].profile.progression.skills.lunge = 3; },
    r => { r.beneficiaries[1].profile.progression.practice.sailing = 70; },
    r => { r.beneficiaries[0].profile.progression.skg.trade = 1; r.profile.progression.skg.trade = 1; }]) {
    const forged = copy(request); forge(forged);
    assert.equal((await commit(db, id(31), forged)).ok, false);
    assert.equal(await receipt(db, id(31)), 0);
  }
  const result = await commit(db, id(32), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const row of request.beneficiaries) {
    const saved = (await stored(db, row.account)).data.progression;
    assert.deepEqual(saved, row.profile.progression);
    assert.deepEqual(saved.skills, row.before.progression.skills);
    assert.deepEqual(saved.skr, row.before.progression.skr);
    assert.deepEqual(saved.skg, row.before.progression.skg);
  }
});

test('the artisan lesson accepts a v3 block after SQL040 and keeps its skill state (SQL021 lane)', async t => {
  const progression = { v: 3, practice: { logging: 60, crafting: 2 }, milestones: ['logging_steady'], knowledge: [],
    skills: { lunge: 2 }, skr: { combat: 1 }, skg: { combat: 1, survival: 0, sailing: 0, crafting: 0, trade: 0 } };
  const character = () => { const p = newProfile(); delete p.carry; delete p.workshop; p.eco.pack = { cap: 10, goods: { madera: 2 } };
    p.progression = copy(progression); return p; };
  const community = { v: 1, epoch: id(700), project: { id: 'salty-shore-carpentry', version: 7,
    requirements: { madera: 4, piedra: 2 }, contributed: { madera: 4, piedra: 2 } } };
  const world = { v: 1, seed: SEED, economy: new Economy(SEED).serialize(), community,
    resources: { v: 1, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } };
  const before = character(), taught = teachStorage(before).profile;
  assert.deepEqual(taught.progression, { ...progression, knowledge: ['raft_storage'] });
  const lesson = profile => ({ world: WORLD, account: ACCOUNT, command: { type: 'artisan', op: 'learn', opId: 'v3-lesson',
    lesson: 'raft_storage', expectedRev: 0, expectedProjectRev: 7 }, expectedProfileVersion: 1, expectedWorldVersion: 1,
    before: copy(before), profile, worldData: { ...copy(world), resources: { ...copy(world.resources), tick: 1 } },
    ack: { type: 'artisan', op: 'learn', opId: 'v3-lesson', lesson: 'raft_storage', ok: true, why: '', rev: 1,
      project: { ...community.project, name: 'Carpintería de Salty Shore', complete: true } } });
  const request = lesson(taught);

  const legacy = await database(t, { skills: false });
  await seed(legacy, [[ACCOUNT, before]], world);
  assert.equal((await one(legacy, 'select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [id(40), json(request)])).ok, false);
  assert.equal((await commit(legacy, id(40), request)).ok, false, 'SQL039 refuses the v3 lesson');

  const db = await database(t);
  await seed(db, [[ACCOUNT, before]], world);
  assert.equal((await one(db, 'select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [id(41), json(request)])).ok, true);
  for (const forge of [p => { p.progression.skills.lunge = 3; }, p => { p.progression.practice.crafting = 9; },
    p => { p.progression.skg.combat = 2; }]) {
    const forged = copy(taught); forge(forged);
    assert.equal((await commit(db, id(41), lesson(forged))).ok, false);
    assert.equal(await receipt(db, id(41)), 0);
  }
  const result = await commit(db, id(42), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual((await stored(db)).data.progression, { ...progression, knowledge: ['raft_storage'] });
});

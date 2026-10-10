import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { teachStorage } from '../server/artisanOperation.mjs';
import { storageProfileDelta } from '../src/sim/systems/raftEditor.js';
import { sanitizeRaftCondition } from '../src/sim/naval/condition.js';
import { database } from './helpers/ground-clock-sql.mjs';

const migration = await readFile(new URL('../server/migrations/021_artisan_operations.sql', import.meta.url), 'utf8');
let groundJournal;
try { groundJournal = await readFile(new URL('../server/migrations/019_ground_transaction_journal.sql', import.meta.url), 'utf8'); }
catch { groundJournal = execFileSync('git', ['show', 'origin/claude/loving-lovelace-ptbif7:server/migrations/019_ground_transaction_journal.sql'], { encoding: 'utf8' }); }
let gmDraftMigration;
try { gmDraftMigration = await readFile(new URL('../server/migrations/020_gm_drafts.sql', import.meta.url), 'utf8'); }
catch { gmDraftMigration = execFileSync('git', ['show', 'origin/claude/loving-lovelace-ptbif7:server/migrations/020_gm_drafts.sql'], { encoding: 'utf8' }); }
const priorMigrations = await Promise.all([14, 15, 16, 17, 18].map(n =>
  readFile(new URL(`../server/migrations/${String(n).padStart(3, '0')}_${{
    14: 'economic_operations', 15: 'resource_operations', 16: 'logging_operations',
    17: 'agent_goods_budget', 18: 'ground_transactions',
  }[n]}.sql`, import.meta.url), 'utf8')));
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worldId = 'world:artisan-sql', account = id(701), seed = 91;
const community = { v: 1, epoch: id(700), project: { id: 'salty-shore-carpentry', version: 7,
  requirements: { madera: 4, piedra: 2 }, contributed: { madera: 4, piedra: 2 } } };
const newWorld = () => ({ v: 1, seed, economy: new Economy(seed).serialize(), community: structuredClone(community),
  resources: { v: 1, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } });
const progression = () => ({ v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] });
const publicProject = () => ({ ...community.project, name: 'Carpintería de Salty Shore', complete: true });
function character({ eligible = true, wood = 2 } = {}) {
  const p = newProfile();
  p.eco.pack.goods.madera = wood;
  p.progression = eligible ? progression() : { ...progression(), practice: { logging: 50 }, milestones: [] };
  return p;
}

async function fixture(t, { legacy = false } = {}) {
  const f = await database();
  t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  for (const sql of priorMigrations) await f.db.exec(sql);
  await f.db.exec(groundJournal);
  await f.db.exec(gmDraftMigration);
  if (legacy) {
    const p = character();
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, p]);
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, newWorld()]);
    await f.db.exec('SET ROLE service_role');
    const oldId = id(702), cmd = { type: 'commerce', op: 'buy', opId: 'old-buy', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 };
    const request = { world: worldId, account, command: cmd, expectedProfileVersion: 1, expectedWorldVersion: 1,
      profile: p, worldData: newWorld(), ack: { type: 'commerce', op: 'buy', opId: 'old-buy', ok: true, why: '', rev: 0 } };
    assert.equal((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r', [oldId, request])).rows[0].r.ok, true);
  }
  await f.db.exec('RESET ROLE');
  await f.db.exec(migration);
  await f.db.exec(migration);
  if (!legacy) {
    const p = character();
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, p]);
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, newWorld()]);
  }
  await f.db.exec('SET ROLE service_role');
  if (!legacy) { f.profile = character(); f.worldData = newWorld(); }
  return f;
}

function lesson(f, op, { before = null, profile = null, worldData = null } = {}) {
  before ??= f.profile;
  profile ??= teachStorage(before).profile;
  worldData ??= structuredClone(f.worldData);
  const cmd = { type: 'artisan', op: 'learn', opId: `learn-${op}`, lesson: 'raft_storage',
    expectedRev: before.eco.tradeRev, expectedProjectRev: community.project.version };
  return { operationId: op, request: { world: worldId, account, command: cmd, expectedProfileVersion: 1,
    expectedWorldVersion: 1, before, profile, worldData,
    ack: { type: 'artisan', op: 'learn', opId: cmd.opId, lesson: 'raft_storage', ok: true, why: '',
      rev: before.eco.tradeRev + 1, project: publicProject() } } };
}

test('SQL021 learns raft storage once, retains the exact before/profile/world receipt and replays it', async t => {
  const f = await fixture(t);
  f.profile = character();
  f.worldData = newWorld();
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, f.profile]);
  const op = lesson(f, id(703));
  op.request.worldData.resources.tick = 1;
  const first = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [op.operationId, op.request])).rows[0].r;
  assert.deepEqual(first, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: op.request.ack });
  const replay = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [op.operationId, op.request])).rows[0].r;
  assert.deepEqual(replay, { ...first, replay: true });
  const stored = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid',
    [op.operationId])).rows[0];
  assert.deepEqual(stored.request, op.request);
  assert.deepEqual(stored.result, first);
  assert.deepEqual((await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].data,
    op.request.profile);
});

test('SQL021 rejects forged learning deltas and leaves profile, world, and receipt unchanged', async t => {
  const f = await fixture(t);
  f.profile = character();
  f.worldData = newWorld();
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, f.profile]);
  const forged = lesson(f, id(704));
  const nullLesson = structuredClone(forged.request); nullLesson.command.lesson = null;
  const unknownLessonAck = structuredClone(forged.request); unknownLessonAck.ack.unexpected = true;
  await f.db.exec('RESET ROLE');
  for (const request of [nullLesson, unknownLessonAck]) assert.equal((await f.db.query(
    'select public.mn_valid_artisan_request($1::uuid,$2::jsonb) as ok', [id(704), request])).rows[0].ok, false);
  await f.db.exec('SET ROLE service_role');
  forged.request.profile.gold++;
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [forged.operationId, forged.request])).rows[0].r;
  assert.deepEqual(result, { ok: false, why: 'conflict' });
  assert.equal((await f.db.query('select version from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].version, 1);
  assert.equal((await f.db.query('select version from public.mn_worlds where world=$1', [worldId])).rows[0].version, 1);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_economic_operations where operation_id=$1::uuid',
    [forged.operationId])).rows[0].n, 0);
  const rewritten = lesson(f, id(705));
  rewritten.request.worldData.resources.tick = 1;
  rewritten.request.worldData.resources.nodes[0].hits = 1;
  assert.deepEqual((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [rewritten.operationId, rewritten.request])).rows[0].r, { ok: false, why: 'conflict' });
});

test('SQL021 rejects incomplete carpentry, ineligible practice, wrong project revision, and already learned state', async t => {
  const f = await fixture(t);
  const baseline = character();
  f.profile = baseline; f.worldData = newWorld();
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, baseline]);
  const cases = [
    (() => { const q = lesson(f, id(710)); q.request.command.expectedProjectRev++; return q; })(),
    (() => { const q = lesson(f, id(711)); q.request.worldData.community.project.contributed.madera--; q.request.ack.project.complete = false; return q; })(),
  ];
  for (const q of cases) {
    await f.db.exec('RESET ROLE');
    assert.equal((await f.db.query('select public.mn_valid_artisan_transition($1::jsonb,$2::jsonb) as ok',
      [q.request, f.worldData])).rows[0].ok, false);
    await f.db.exec('SET ROLE service_role');
    const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
      [q.operationId, q.request])).rows[0].r;
    assert.deepEqual(result, { ok: false, why: 'conflict' });
  }
  assert.equal((await f.db.query('select version from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].version, 1);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n, 0);
  const ineligible = character({ eligible: false });
  const denied = lesson(f, id(712), { before: ineligible, profile: ineligible });
  denied.request.ack.ok = false; denied.request.ack.why = 'practice'; denied.request.ack.rev = ineligible.eco.tradeRev;
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, ineligible]);
  const versions = (await f.db.query(`select (select version from public.mn_profiles where player_id=$1::uuid) profile_version,
    (select version from public.mn_worlds where world=$2) world_version`, [account, worldId])).rows[0];
  denied.request.expectedProfileVersion = versions.profile_version;
  denied.request.expectedWorldVersion = versions.world_version;
  await f.db.exec('RESET ROLE');
  assert.equal((await f.db.query('select public.mn_valid_artisan_transition($1::jsonb,$2::jsonb) as ok',
    [denied.request, denied.request.worldData])).rows[0].ok, true);
  await f.db.exec('SET ROLE service_role');
  const deniedResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [denied.operationId, denied.request])).rows[0].r;
  assert.equal(deniedResult.ok, true, JSON.stringify(deniedResult));
  assert.deepEqual(deniedResult.ack, denied.request.ack);
  const learned = character(); learned.progression.knowledge = ['raft_storage'];
  const repeated = lesson(f, id(713), { before: learned, profile: learned });
  repeated.request.expectedProfileVersion = deniedResult.profileVersion;
  repeated.request.expectedWorldVersion = deniedResult.worldVersion;
  repeated.request.ack.ok = false; repeated.request.ack.why = 'learned'; repeated.request.ack.rev = learned.eco.tradeRev;
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, learned]);
  const repeatResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [repeated.operationId, repeated.request])).rows[0].r;
  assert.equal(repeatResult.ok, true);
  assert.deepEqual(repeatResult.ack, repeated.request.ack);
});

test('SQL021 keeps old economic receipts valid and the new readiness RPC service-only', async t => {
  const f = await fixture(t, { legacy: true });
  const oldId = id(702);
  assert.ok((await f.db.query('select public.mn_load_economic_operation($1::uuid) as r', [oldId])).rows[0].r);
  assert.deepEqual((await f.db.query('select public.mn_artisan_operations_ready() as r')).rows[0].r, { version: 1 });
  await assert.rejects(f.db.query('select public.mn_commit_economic_operation_artisan_base($1::uuid,$2::jsonb)',
    [id(714), {}]));
  await f.db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(f.db.query('select public.mn_artisan_operations_ready()'));
  await assert.rejects(f.db.query('select public.mn_commit_economic_operation_artisan_base($1::uuid,$2::jsonb)',
    [id(715), {}]));
});

test('SQL021 accepts and replays exact storage placement deltas, rejects unrelated ship edits', async t => {
  const f = await fixture(t);
  const before = character();
  before.progression.knowledge = ['raft_storage'];
  before.eco.ships[0].id = 'raft-artisan';
  before.eco.ships[0].grid.parts.push(['crate', 0, 1, 0, 0]);
  before.eco.ships[0].condition = sanitizeRaftCondition({ v: 1, next: 1, entries: [] }, before.eco.ships[0].grid.parts);
  before.eco.ships[0].hold.cap = 12;
  before.eco.ships[0].hold.goods.madera = 4;
  f.profile = before; f.worldData = newWorld();
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, before]);
  const unlearned = structuredClone(before); unlearned.progression.knowledge = [];
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, unlearned]);
  const blockedCommand = { type: 'raft', op: 'place', opId: 'storage-locked', id: 'raft-artisan', expectedRev: 1,
    piece: ['storage', 1, 0, 0, 0] };
  const blockedRequest = { world: worldId, account, command: blockedCommand, expectedProfileVersion: 1,
    expectedWorldVersion: 1, before: unlearned, profile: unlearned, worldData: f.worldData,
    ack: { type: 'raftEdit', id: blockedCommand.id, op: 'place', opId: blockedCommand.opId, ok: false,
      why: 'knowledge', rev: 1 } };
  const blockedResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [id(719), blockedRequest])).rows[0].r;
  assert.equal(blockedResult.ok, true);
  assert.deepEqual(blockedResult.ack, blockedRequest.ack);
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, before]);
  const command = { type: 'raft', op: 'place', opId: 'storage-place', id: 'raft-artisan', expectedRev: 1,
    piece: ['storage', 1, 0, 0, 0] };
  const candidate = storageProfileDelta(before, command);
  assert.equal(candidate.why, '');
  const previousNext = before.eco.ships[0].condition.next;
  const appendedCondition = candidate.profile.eco.ships[0].condition;
  assert.equal(appendedCondition.entries.at(-1)[0], `p${previousNext}`);
  assert.equal(appendedCondition.next, previousNext + 1);
  const request = { world: worldId, account, command, expectedProfileVersion: 2, expectedWorldVersion: 2,
    before, profile: candidate.profile, worldData: f.worldData,
    ack: { type: 'raftEdit', id: command.id, op: 'place', opId: command.opId, ok: true, why: '', rev: 2 } };
  await f.db.exec('RESET ROLE');
  const malformed = [
    (() => { const q = structuredClone(request); q.command.piece = ['storage', null, 0, 0, 0]; return q; })(),
    (() => { const q = structuredClone(request); q.ack.unexpected = true; return q; })(),
    (() => { const q = structuredClone(request); q.command.piece = null; return q; })(),
  ];
  for (const q of malformed) assert.equal((await f.db.query(
    'select public.mn_valid_artisan_request($1::uuid,$2::jsonb) as ok', [id(725), q])).rows[0].ok, false);
  await f.db.exec('SET ROLE service_role');
  const operationId = id(720);
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [operationId, request])).rows[0].r;
  assert.equal(result.ok, true);
  assert.deepEqual((await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].data,
    candidate.profile);
  assert.deepEqual((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [operationId, request])).rows[0].r, { ...result, replay: true });

  const removeBefore = structuredClone(candidate.profile);
  delete removeBefore.progression;
  removeBefore.eco.ships[0].hold.goods.agua = 13;
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, removeBefore]);
  const index = removeBefore.eco.ships[0].grid.parts.findIndex(part => part[0] === 'storage');
  const removeCommand = { type: 'raft', op: 'remove', opId: 'storage-remove', id: command.id,
    expectedRev: 2, index, piece: removeBefore.eco.ships[0].grid.parts[index] };
  const removed = storageProfileDelta(removeBefore, removeCommand);
  assert.equal(removed.why, '');
  assert.equal(removed.profile.eco.ships[0].condition.next, appendedCondition.next);
  assert.equal(removed.profile.eco.ships[0].hold.goods.agua, 12);
  assert.equal(removed.profile.eco.pack.goods.agua, 1);
  assert.equal(removed.profile.eco.ships[0].hold.goods.madera, undefined);
  assert.equal(removed.profile.eco.pack.goods.madera, 3);
  const removeRequest = { world: worldId, account, command: removeCommand, expectedProfileVersion: 3,
    expectedWorldVersion: 3, before: removeBefore, profile: removed.profile, worldData: f.worldData,
    ack: { type: 'raftEdit', id: command.id, op: 'remove', opId: removeCommand.opId, ok: true, why: '', rev: 3 } };
  const removeResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [id(722), removeRequest])).rows[0].r;
  assert.equal(removeResult.ok, true);

  const damagedBefore = structuredClone(candidate.profile);
  const damagedShip = damagedBefore.eco.ships[0];
  const damagedIndex = damagedShip.grid.parts.findIndex(part => part[0] === 'storage');
  damagedShip.condition.entries[damagedIndex][6] = 20;
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [account, damagedBefore]);
  const damagedCommand = { type: 'raft', op: 'remove', opId: 'storage-damaged-remove', id: command.id,
    expectedRev: 2, index: damagedIndex, piece: damagedShip.grid.parts[damagedIndex] };
  const damagedCandidate = storageProfileDelta(damagedBefore, damagedCommand);
  assert.equal(damagedCandidate.why, '');
  assert.equal(damagedCandidate.profile.eco.ships[0].hold.goods.madera, 1);
  const damagedRequest = { world: worldId, account, command: damagedCommand, expectedProfileVersion: 4,
    expectedWorldVersion: 4, before: damagedBefore, profile: damagedCandidate.profile, worldData: f.worldData,
    ack: { type: 'raftEdit', id: command.id, op: 'remove', opId: damagedCommand.opId, ok: true, why: '', rev: 3 } };
  const damagedResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [id(723), damagedRequest])).rows[0].r;
  assert.equal(damagedResult.ok, true);

  const forged = structuredClone(request); forged.command.opId = 'storage-forged';
  forged.profile.eco.ships[0].n = 'Not the same boat';
  forged.ack.opId = forged.command.opId;
  assert.deepEqual((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [id(721), forged])).rows[0].r, { ok: false, why: 'conflict' });
  const forgedDebit = structuredClone(request); forgedDebit.command.opId = 'storage-forged-debit';
  forgedDebit.profile.eco.pack.goods.madera = 1;
  forgedDebit.ack.opId = forgedDebit.command.opId;
  await f.db.exec('RESET ROLE');
  assert.equal((await f.db.query('select public.mn_valid_artisan_storage_transition($1::jsonb) as ok', [forged])).rows[0].ok, false);
  assert.equal((await f.db.query('select public.mn_valid_artisan_storage_transition($1::jsonb) as ok', [forgedDebit])).rows[0].ok, false);
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',
    [id(724), forgedDebit])).rows[0].r, { ok: false, why: 'conflict' });
});

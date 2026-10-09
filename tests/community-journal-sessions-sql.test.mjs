import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { operationDatabase } from './helpers/community-operation-sql.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'salty-shore', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3), PROJECT = 'salty:hall';
const data = (name = 'Nerea') => ({ v: 1, name, eco: { tradeRev: 0,
  pack: { cap: 40, goods: { madera: 8 } } } });
const binding = () => ({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR });
const project = () => ({ worldId: WORLD, worldEpoch: EPOCH, projectId: PROJECT, version: 1,
  requirements: { madera: 10 }, contributed: { madera: 0 } });
const contribution = (operationId, expectedProjectVersion = 1) => ({ operationId,
  projectId: PROJECT, good: 'madera', amount: 2, expectedProjectVersion });
const auth = Object.freeze({ accountId: ACCOUNT });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function uuidSequence(...values) {
  let i = 0;
  return () => values[i++] ?? id(900 + i);
}
async function provision(sql) {
  const created = await sql.identityStore.allocateIdentity({ binding: binding(), data: data() });
  assert.equal(created.ok, true);
  await sql.store.initializeProject(project());
}
function sessionsFor(sql, { resolveIdentity = () => auth, uuid = uuidSequence(id(50)) } = {}) {
  return new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity, operationStore: sql.operationStore, uuid });
}
function legacyWrites(sql) {
  return sql.calls.filter(call => ['mn_comm_save_character', 'mn_comm_commit_contribution'].includes(call.name));
}
function assertJournalOnly(sql, from = 0) {
  const writes = sql.operationCalls.slice(from).filter(call =>
    ['mn_comm_prepare_operation', 'mn_comm_commit_operation'].includes(call.name));
  assert.ok(writes.length > 0);
  assert.deepEqual(legacyWrites(sql), []);
  assert.equal(sql.operationCalls.slice(from).some(call =>
    ['mn_comm_prepare_operation', 'mn_comm_commit_operation'].includes(call.name)), true);
}
function assertOwnedTemp(parent, prefix) {
  assert.equal(path.resolve(path.dirname(parent)), path.resolve(tmpdir()));
  assert.ok(path.basename(parent).startsWith(prefix));
}

test('real SDK journal flow survives clean disk reopen and admits only the current character row', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mn-journal-sessions-'));
  assertOwnedTemp(parent, 'mn-journal-sessions-');
  const dir = path.resolve(parent, 'database');
  assert.ok(dir.startsWith(path.resolve(parent) + path.sep));
  let sql;
  t.after(async () => { await sql?.close(); await rm(parent, { recursive: true, force: true }); });
  sql = await operationDatabase(dir, { reapply: true });
  await provision(sql);
  let owner = sessionsFor(sql);
  assert.equal(owner.recoveryView().ready, false);
  assert.equal((await owner.recoverWorld()).ready, true);
  const opened = await owner.open('peer');
  const start = sql.operationCalls.length;
  assert.equal((await owner.save('peer', opened.token, { ...opened.character.data, name: 'Guardado' })).ok, true);
  owner.drain(() => {});
  const current = owner.view('peer');
  const contributionId = id(60);
  assert.equal((await owner.contribute('peer', current.token, contribution(contributionId))).ok, true);
  let event;
  assert.deepEqual(owner.drain(value => { event = value; }), ['peer']);
  assert.equal(event.character.version, 3);
  assert.equal(event.character.data.name, 'Guardado');
  assert.equal(event.character.data.eco.pack.goods.madera, 6);
  assert.equal(event.project.contributed.madera, 2);
  const saveIntent = sql.operationCalls.slice(start).find(call => call.name === 'mn_comm_prepare_operation').body.p_intent;
  assert.equal(saveIntent.kind, 'save');
  assert.equal(saveIntent.operationId, id(50));
  const contributionIntent = sql.operationCalls.slice(start).map(call => call.body.p_intent)
    .find(intent => intent?.operationId === contributionId);
  assert.equal(contributionIntent.kind, 'contribution');
  assertJournalOnly(sql, start);
  assert.equal((await sql.operationStore.loadOperation(id(50))).state, 'complete');
  assert.equal((await sql.operationStore.loadOperation(contributionId)).state, 'complete');
  owner.close('peer'); await sql.close(); sql = null;

  sql = await operationDatabase(dir);
  owner = sessionsFor(sql);
  assert.equal((await owner.recoverWorld()).ready, true);
  const fresh = await owner.open('fresh-peer');
  assert.equal(fresh.character.version, 3);
  assert.equal(fresh.character.data.name, 'Guardado');
  assert.equal(fresh.character.data.eco.pack.goods.madera, 6);
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 2);
  assert.equal((await sql.operationStore.loadOperation(contributionId)).state, 'complete');
  assert.deepEqual(owner.drain(() => assert.fail('historical journal rows are not publication events')), []);
  owner.close('fresh-peer');
});

test('lost prepare reply remains closed until exact world retry, then client recovery stages current SQL rows', async t => {
  let losePrepare = true;
  const sql = await operationDatabase(undefined, { adapterOptions: { loseReply: name => {
    if (name !== 'mn_comm_prepare_operation' || !losePrepare) return false;
    losePrepare = false; return true;
  } } });
  t.after(() => sql.close()); await provision(sql);
  const owner = sessionsFor(sql); await owner.recoverWorld();
  const opened = await owner.open('peer');
  const start = sql.operationCalls.length;
  assert.deepEqual(await owner.save('peer', opened.token, { ...opened.character.data, name: 'uncertain' }),
    { ok: false, why: 'unavailable' });
  assert.equal(owner.recoveryView().ready, false);
  assert.equal((await owner.recoverWorld()).ready, false, 'default recovery is read only');
  assert.equal(sql.operationCalls.filter(call => call.name === 'mn_comm_prepare_operation').length, 1);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 1);
  assert.equal((await owner.recoverWorld({ retry: true })).ready, true);
  assert.equal(sql.operationCalls.filter(call => call.name === 'mn_comm_prepare_operation').length, 1,
    'retry commits the already prepared exact operation without preparing it again');
  assert.equal((await owner.recover('peer')).ok, true);
  let event;
  assert.deepEqual(owner.drain(value => { event = value; }), ['peer']);
  assert.equal(event.character.version, 2);
  assert.equal(event.character.data.name, 'uncertain');
  assertJournalOnly(sql, start);
});

test('lost commit reply is read as complete without resubmission and only recovery publishes it', async t => {
  let loseCommit = true;
  const sql = await operationDatabase(undefined, { adapterOptions: { loseReply: name => {
    if (name !== 'mn_comm_commit_operation' || !loseCommit) return false;
    loseCommit = false; return true;
  } } });
  t.after(() => sql.close()); await provision(sql);
  const owner = sessionsFor(sql); await owner.recoverWorld();
  const opened = await owner.open('peer'), operationId = id(70), start = sql.operationCalls.length;
  assert.deepEqual(await owner.contribute('peer', opened.token, contribution(operationId)),
    { ok: false, why: 'unavailable' });
  assert.equal((await owner.recoverWorld()).ready, true);
  const commitsBeforeClientRecovery = sql.operationCalls.filter(call => call.name === 'mn_comm_commit_operation').length;
  assert.equal(commitsBeforeClientRecovery, 1);
  assert.equal((await owner.recover('peer')).ok, true);
  let event;
  assert.deepEqual(owner.drain(value => { event = value; }), ['peer']);
  assert.equal(event.character.version, 2);
  assert.equal(event.project.version, 2);
  assert.equal(event.character.data.eco.pack.goods.madera, 6);
  assert.equal(sql.operationCalls.filter(call => call.name === 'mn_comm_commit_operation').length, 1);
  assertJournalOnly(sql, start);
});

test('journal terminal update failure rolls back profile and contribution before explicit retry', async t => {
  const sql = await operationDatabase(); t.after(() => sql.close()); await provision(sql);
  await sql.db.exec(`RESET ROLE;
    CREATE FUNCTION public.mn_test_reject_operation_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected journal terminal failure'; END $$;
    CREATE TRIGGER mn_test_reject_operation_terminal BEFORE UPDATE ON public.mn_comm_operation_intents
      FOR EACH ROW EXECUTE FUNCTION public.mn_test_reject_operation_terminal(); SET ROLE service_role;`);
  const owner = sessionsFor(sql); await owner.recoverWorld();
  const opened = await owner.open('peer'), start = sql.operationCalls.length;
  assert.deepEqual(await owner.contribute('peer', opened.token, contribution(id(80))),
    { ok: false, why: 'unavailable' });
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 1);
  assert.deepEqual((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).contributed, { madera: 0 });
  assert.equal((await owner.recoverWorld()).ready, false);
  await sql.db.exec('RESET ROLE; DROP TRIGGER mn_test_reject_operation_terminal ON public.mn_comm_operation_intents; SET ROLE service_role;');
  assert.equal((await owner.recoverWorld({ retry: true })).ready, true);
  assert.equal((await owner.recover('peer')).ok, true);
  let event;
  assert.deepEqual(owner.drain(value => { event = value; }), ['peer']);
  assert.equal(event.character.version, 2);
  assert.equal(event.project.contributed.madera, 2);
  assertJournalOnly(sql, start);
});

test('terminal CAS conflict reloads and stages the competing current profile', async t => {
  const sql = await operationDatabase(); t.after(() => sql.close()); await provision(sql);
  const original = sql.operationStore;
  let raced = false;
  const operationStore = Object.create(original);
  operationStore.commitOperation = async intent => {
    if (!raced && intent.kind === 'save') {
      raced = true;
      const current = await sql.store.loadCharacter(WORLD, EPOCH, CHAR);
      await sql.store.saveCharacter({ ...current, data: { ...current.data, name: 'otro escritor' } });
    }
    return original.commitOperation(intent);
  };
  const owner = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => auth, operationStore, uuid: uuidSequence(id(90)) });
  await owner.recoverWorld(); const opened = await owner.open('peer'), start = sql.operationCalls.length;
  assert.deepEqual(await owner.save('peer', opened.token, { ...opened.character.data, name: 'mi cambio' }),
    { ok: false, why: 'conflict' });
  let event; owner.drain(value => { event = value; });
  assert.equal(event.character.version, 2);
  assert.equal(event.character.data.name, 'otro escritor');
  assert.deepEqual(event.outcome, { ok: false, why: 'conflict' });
  assert.equal((await sql.operationStore.loadOperation(id(90))).state, 'complete');
  assert.equal(sql.calls.filter(call => call.name === 'mn_comm_save_character').length, 1,
    'one explicit competing CAS write created the conflict; the session save used the journal');
  assert.ok(sql.operationCalls.slice(start).some(call => call.name === 'mn_comm_commit_operation'));
});

test('historical complete receipt cannot replace a newer SQL character and project snapshot', async t => {
  const sql = await operationDatabase(); t.after(() => sql.close()); await provision(sql);
  const original = sql.operationStore;
  let advance = true;
  const operationStore = Object.create(original);
  operationStore.commitOperation = async intent => {
    const entry = await original.commitOperation(intent);
    if (advance && intent.kind === 'contribution') {
      advance = false;
      await sql.store.commitContribution({ operationId: id(102), worldId: WORLD, worldEpoch: EPOCH,
        characterId: CHAR, projectId: PROJECT, good: 'madera', amount: 1,
        expectedCharacterVersion: entry.result.character.version,
        expectedProjectVersion: entry.result.project.version });
      throw new Error('operation committed but response arrived late');
    }
    return entry;
  };
  const owner = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => auth, operationStore, uuid: uuidSequence(id(101)) });
  await owner.recoverWorld(); const opened = await owner.open('peer');
  assert.deepEqual(await owner.contribute('peer', opened.token, contribution(id(101))),
    { ok: false, why: 'unavailable' });
  assert.equal((await sql.operationStore.loadOperation(id(101))).result.character.version, 2);
  assert.equal((await sql.operationStore.loadOperation(id(101))).result.project.version, 2);
  assert.equal((await owner.recoverWorld()).ready, true);
  assert.equal((await owner.recover('peer')).ok, true);
  let event; owner.drain(value => { event = value; });
  assert.equal(event.character.version, 3);
  assert.equal(event.project.version, 3);
  assert.equal(event.character.data.eco.pack.goods.madera, 5);
  assert.equal(event.project.contributed.madera, 3);
});

test('closed unknown contribution keeps account reserved until recovered and never publishes to the old identity', async t => {
  let loseCommit = true;
  const sql = await operationDatabase(undefined, { adapterOptions: { loseReply: name => {
    if (name !== 'mn_comm_commit_operation' || !loseCommit) return false;
    loseCommit = false; return true;
  } } });
  t.after(() => sql.close()); await provision(sql);
  const identities = new Map([['old', auth], ['new', auth]]);
  const owner = sessionsFor(sql, { resolveIdentity: clientId => identities.get(clientId) });
  await owner.recoverWorld(); const opened = await owner.open('old'), start = sql.operationCalls.length;
  assert.deepEqual(await owner.contribute('old', opened.token, contribution(id(100))),
    { ok: false, why: 'unavailable' });
  owner.close('old');
  await assert.rejects(owner.open('new'), error => ['session', 'startup'].includes(error.code));
  assert.equal((await owner.recoverWorld()).ready, true);
  assert.equal((await owner.recover('old')).ok, true);
  assert.deepEqual(owner.drain(() => assert.fail('closed identity must not publish')), []);
  const replacement = await owner.open('new');
  assert.equal(replacement.character.version, 2);
  assert.equal(replacement.character.data.eco.pack.goods.madera, 6);
  assertJournalOnly(sql, start);
});

test('close while prepared contribution reply is held prevents commit until explicit world retry', async t => {
  const sql = await operationDatabase(); t.after(() => sql.close()); await provision(sql);
  const entered = deferred(), release = deferred();
  const operationStore = Object.create(sql.operationStore);
  operationStore.prepareOperation = async intent => {
    const entry = await sql.operationStore.prepareOperation(intent);
    entered.resolve(entry);
    await release.promise;
    return entry;
  };
  const identities = new Map([['old', auth], ['new', auth]]);
  const owner = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: clientId => identities.get(clientId), operationStore, uuid: uuidSequence(id(110)) });
  await owner.recoverWorld();
  const opened = await owner.open('old'), start = sql.operationCalls.length;
  const saving = owner.contribute('old', opened.token, contribution(id(111)));
  const prepared = await entered.promise;
  assert.equal(prepared.state, 'pending');
  owner.close('old');
  await assert.rejects(owner.open('new'), error => ['session', 'startup'].includes(error.code));
  release.resolve();
  const result = await saving;
  assert.equal(result.ok, false);
  assert.equal(sql.operationCalls.filter(call => call.name === 'mn_comm_commit_operation').length, 0,
    'revocation after prepare must stop dispatch of the commit phase');
  assert.equal((await sql.operationStore.loadOperation(id(111))).state, 'pending');
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 1);
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).version, 1);
  assert.equal(owner.recoveryView().ready, false);
  assert.equal((await owner.recoverWorld()).ready, false, 'read-only recovery retains the prepared intent');
  assert.equal((await owner.recoverWorld({ retry: true })).ready, true);
  assert.equal(sql.operationCalls.filter(call => call.name === 'mn_comm_commit_operation').length, 1);
  assert.equal((await owner.recover('old')).ok, true);
  assert.deepEqual(owner.drain(() => assert.fail('closed session recovery is not publication')), []);
  const replacement = await owner.open('new');
  assert.equal(replacement.character.version, 2);
  assert.equal(replacement.character.data.eco.pack.goods.madera, 6);
  assertJournalOnly(sql, start);
});

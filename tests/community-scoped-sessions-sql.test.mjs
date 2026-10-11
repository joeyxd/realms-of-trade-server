import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ScopedProfileSessions } from '../server/community/scopedProfileSessions.mjs';
import { database, adapters } from './helpers/community-sql.mjs';

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope = { worldId: 'salty', worldEpoch: uuid(1), characterId: uuid(2) };
const row = () => ({ ...scope, version: 1, data: { v: 1, xp: 80, eco: {
  tradeRev: 0, pack: { cap: 40, goods: { madera: 8, piedra: 4 } },
}, raft: { cargo: { madera: 10 } }, flags: ['keep'] } });
const project = () => ({ worldId: scope.worldId, worldEpoch: scope.worldEpoch, projectId: 'carpentry',
  version: 1, requirements: { madera: 12 }, contributed: { madera: 0 } });
const intent = n => ({ operationId: uuid(n), projectId: 'carpentry', good: 'madera', amount: 3,
  expectedProjectVersion: 1 });
const binding = () => ({ accountId: uuid(100), ...scope });
const sessions = store => new ScopedProfileSessions(store, { resolveBinding: () => binding() });
async function fixture(t, options = {}) {
  const sql = await database(undefined, { sessionSaves: true, ...options });
  t.after(() => sql.close());
  await sql.store.initializeCharacter(row()); await sql.store.initializeProject(project());
  return sql;
}

test('real SDK loss after contribution recovers the receipt but publishes a newer ordinary save', async t => {
  let lose = true;
  const sql = await fixture(t, { adapterOptions: { loseReply: name => {
    if (name !== 'mn_comm_commit_contribution' || !lose) return false;
    lose = false; return true;
  } } });
  const owner = sessions(sql.store), opened = await owner.open('peer');
  assert.deepEqual(await owner.contribute('peer', opened.token, intent(10)), { ok: false, why: 'unavailable' });
  assert.equal(owner.canMutate('peer'), false);
  assert.deepEqual(owner.drain(() => assert.fail('ambiguous write published')), []);
  const committed = await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, scope.characterId);
  const newer = await sql.store.saveCharacter({ ...committed, data: { ...committed.data, xp: 90 } });
  assert.equal(newer.character.version, 3);
  const recovered = await owner.recover('peer');
  assert.equal(recovered.replay, true);
  assert.equal(recovered.character.version, 2);
  let event;
  owner.drain(value => { event = value; });
  assert.equal(event.character.version, 3);
  assert.equal(event.character.data.xp, 90);
  assert.equal(event.character.data.eco.pack.goods.madera, 5);
  assert.deepEqual(event.character.data.raft, row().data.raft);
  assert.equal(event.project.contributed.madera, 3);
  assert.equal(sql.calls.filter(c => c.name === 'mn_comm_commit_contribution').length, 1);
  assert.throws(() => owner.save('peer', opened.token, row().data), e => e.code === 'stale');
});

test('real SDK loss after ordinary save resolves by current revision without another write', async t => {
  let lose = true;
  const sql = await fixture(t, { adapterOptions: { loseReply: name => {
    if (name !== 'mn_comm_save_character' || !lose) return false;
    lose = false; return true;
  } } });
  const owner = sessions(sql.store), opened = await owner.open('peer');
  assert.deepEqual(await owner.save('peer', opened.token, { ...opened.character.data, xp: 92 }),
    { ok: false, why: 'unavailable' });
  assert.deepEqual(await owner.recover('peer'), { ok: true, recovered: true });
  owner.drain(event => { assert.equal(event.character.version, 2); assert.equal(event.character.data.xp, 92); });
  assert.equal(sql.calls.filter(c => c.name === 'mn_comm_save_character').length, 1);
  assert.equal(owner.canMutate('peer'), true);
});

test('SQL rollback leaves an uncertain session fenced until exact explicit retry', async t => {
  const sql = await fixture(t);
  await sql.db.exec(`RESET ROLE;
    CREATE FUNCTION public.reject_community_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;
    CREATE TRIGGER reject_community_receipt BEFORE INSERT ON public.mn_comm_contributions
      FOR EACH ROW EXECUTE FUNCTION public.reject_community_receipt(); SET ROLE service_role;`);
  const owner = sessions(sql.store), opened = await owner.open('peer');
  assert.deepEqual(await owner.contribute('peer', opened.token, intent(20)), { ok: false, why: 'unavailable' });
  assert.deepEqual(await owner.recover('peer'), { ok: false, why: 'pending' });
  assert.deepEqual(await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, scope.characterId), row());
  assert.deepEqual(await sql.store.loadProject(scope.worldId, scope.worldEpoch, 'carpentry'), project());
  await sql.db.exec('RESET ROLE; DROP TRIGGER reject_community_receipt ON public.mn_comm_contributions; SET ROLE service_role;');
  assert.equal((await owner.recover('peer', { retry: true })).ok, true);
  owner.drain(() => {});
  const commits = sql.calls.filter(c => c.name === 'mn_comm_commit_contribution');
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0].body, commits[1].body);
  assert.equal(owner.view('peer').character.data.eco.pack.goods.madera, 5);
});

test('fresh session after a clean disk reopen admits the current row without replaying historical state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'community-sessions-'));
  let sql;
  try {
    sql = await database(join(dir, 'db'), { sessionSaves: true });
    await sql.store.initializeCharacter(row()); await sql.store.initializeProject(project());
    let owner = sessions(sql.store), opened = await owner.open('old-peer');
    await owner.contribute('old-peer', opened.token, intent(30)); owner.drain(() => {});
    const current = owner.view('old-peer');
    await owner.save('old-peer', current.token, { ...current.character.data, xp: 98 });
    owner.drain(() => {}); owner.close('old-peer');
    await sql.close(); sql = null;
    sql = await database(join(dir, 'db'), { sessionSaves: true });
    owner = sessions(sql.store); opened = await owner.open('new-peer');
    assert.equal(opened.character.version, 3);
    assert.equal(opened.character.data.xp, 98);
    assert.equal(opened.character.data.eco.pack.goods.madera, 5);
    assert.equal((await sql.store.loadContributionReceipt(uuid(30))).result.character.version, 2);
    const replay = await owner.contribute('new-peer', opened.token, intent(30));
    assert.equal(replay.replay, true);
    owner.drain(event => assert.equal(event.character.version, 3));
    assert.equal(owner.view('new-peer').character.data.xp, 98);
  } finally {
    await sql?.close();
    const cleanup = resolve(dir);
    assert.equal(dirname(cleanup), resolve(tmpdir()));
    assert.ok(basename(cleanup).startsWith('community-sessions-'));
    await rm(cleanup, { recursive: true, force: true });
  }
});

test('UUID collision rejects without leaking the other character receipt or trapping the session', async t => {
  const sql = await fixture(t);
  const other = { ...row(), characterId: uuid(99) };
  await sql.store.initializeCharacter(other);
  await sql.store.commitContribution({ ...intent(40), worldId: scope.worldId, worldEpoch: scope.worldEpoch,
    characterId: other.characterId, expectedCharacterVersion: 1 });
  const owner = sessions(sql.store), opened = await owner.open('peer');
  assert.deepEqual(await owner.contribute('peer', opened.token, intent(40)),
    { ok: false, why: 'operation', replay: false });
  assert.deepEqual(owner.drain(event => {
    assert.equal(event.character.characterId, scope.characterId);
    assert.equal(event.character.version, 1);
    assert.equal(event.outcome.character, undefined);
  }), ['peer']);
  assert.equal(owner.canMutate('peer'), true);
  assert.equal(owner.view('peer').character.data.eco.pack.goods.madera, 8);
});

test('one CAS wins when ordinary save and contribution race on the same scoped row', async t => {
  const sql = await fixture(t);
  const other = adapters(sql.db).store;
  const results = await Promise.all([
    sql.store.saveCharacter({ ...row(), data: { ...row().data, xp: 99 } }),
    other.commitContribution({ ...intent(50), ...scope, expectedCharacterVersion: 1 }),
  ]);
  assert.equal(results.filter(r => r.ok).length, 1);
  const current = await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, scope.characterId);
  const progress = await sql.store.loadProject(scope.worldId, scope.worldEpoch, 'carpentry');
  assert.equal(current.version, 2);
  assert.equal(current.data.eco.pack.goods.madera + progress.contributed.madera, 8);
  assert.equal(progress.contributed.madera, results[1].ok ? 3 : 0);
  assert.equal(current.data.xp, results[0].ok ? 99 : 80);
});

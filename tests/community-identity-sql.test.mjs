import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContributionError } from '../server/community/contributionContract.mjs';
import { CharacterProvisioning } from '../server/community/characterProvisioning.mjs';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { identityDatabase } from './helpers/community-identity-sql.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:salty-shore', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3);
const data = (name = 'Nerea') => ({ v: 1, name, eco: { pack: { cap: 40, goods: { madera: 4 } } } });
const binding = (overrides = {}) => ({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, ...overrides });
const allocation = (b = binding(), d = data()) => ({ binding: b, data: d });
function assertOwnedTemp(parent, prefix) {
  assert.equal(path.resolve(path.dirname(parent)), path.resolve(tmpdir()));
  assert.ok(path.basename(parent).startsWith(prefix));
}

test('durable identity bootstraps once and follows the current contribution/save row', async t => {
  const sql = await identityDatabase(undefined, { reapply: true }); t.after(() => sql.close());
  assert.equal(sql.identityStore.kind, 'community-identity-supabase'); assert.equal(sql.identityStore.durable, true);
  assert.equal(await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH }), null);
  const first = await sql.identityStore.allocateIdentity(allocation());
  assert.deepEqual(first, { ok: true, binding: binding(), character: { worldId: WORLD, worldEpoch: EPOCH,
    characterId: CHAR, version: 1, data: data() } });
  await sql.identityStore.allocateIdentity(allocation(binding({ characterId: id(4) }), data('ignored')));
  assert.deepEqual(await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH }),
    { binding: binding(), character: first.character });

  const changed = { ...first.character, data: data('Saved') };
  const saved = await sql.store.saveCharacter(changed);
  assert.equal(saved.ok, true);
  const current = await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH });
  assert.equal(current.character.version, 2); assert.equal(current.character.data.name, 'Saved');
  await sql.store.initializeProject({ worldId: WORLD, worldEpoch: EPOCH, projectId: 'salty:hall', version: 1,
    requirements: { madera: 2 }, contributed: { madera: 0 } });
  await sql.store.commitContribution({ operationId: id(20), worldId: WORLD, worldEpoch: EPOCH,
    characterId: CHAR, projectId: 'salty:hall', good: 'madera', amount: 2,
    expectedCharacterVersion: 2, expectedProjectVersion: 1 });
  const contributed = await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH });
  assert.equal(contributed.character.version, 3); assert.equal(contributed.character.data.name, 'Saved');

  const legacy = { worldId: WORLD, worldEpoch: EPOCH, characterId: id(9), version: 1, data: data('Prebound') };
  await sql.store.initializeCharacter(legacy);
  const owner = { accountId: id(8), worldId: WORLD, worldEpoch: EPOCH, characterId: legacy.characterId };
  assert.deepEqual(await sql.store.initializeBinding(owner), { ok: true, binding: owner });
  await sql.store.saveCharacter({ ...legacy, data: data('Current') });
  const replay = await sql.identityStore.allocateIdentity(allocation({ ...owner, characterId: id(10) }, data('discard')));
  assert.equal(replay.binding.characterId, legacy.characterId);
  assert.equal(replay.character.version, 2); assert.equal(replay.character.data.name, 'Current');
});

test('candidate character conflicts deny without adopting or modifying either row', async t => {
  const sql = await identityDatabase(); t.after(() => sql.close());
  const other = { worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, version: 1, data: data('Legacy') };
  await sql.store.initializeCharacter(other);
  assert.deepEqual(await sql.identityStore.allocateIdentity(allocation()), { ok: false, why: 'occupied' });
  assert.equal(await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH }), null);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).data.name, 'Legacy');
  assert.equal((await sql.identityStore.allocateIdentity(allocation(binding({ accountId: id(5), characterId: id(11) }), data('Owner')))).ok, true);
  assert.deepEqual(await sql.identityStore.allocateIdentity(allocation(binding({ accountId: id(6), characterId: id(11) }), data('Collision'))),
    { ok: false, why: 'occupied' });
  const raceCandidate = id(14);
  const raced = await Promise.all([
    sql.identityStore.allocateIdentity(allocation(binding({ accountId: id(12), characterId: raceCandidate }), data('First'))),
    sql.identityStore.allocateIdentity(allocation(binding({ accountId: id(13), characterId: raceCandidate }), data('Second'))),
  ]);
  assert.equal(raced.filter(row => row.ok).length, 1);
  assert.deepEqual(raced.filter(row => !row.ok), [{ ok: false, why: 'occupied' }]);
});

test('world and epoch scopes allocate independently', async t => {
  const sql = await identityDatabase(); t.after(() => sql.close());
  const elsewhere = binding({ worldId: 'world:other' });
  const newEpoch = binding({ worldEpoch: id(7) });
  assert.equal((await sql.identityStore.allocateIdentity(allocation())).ok, true);
  assert.equal((await sql.identityStore.allocateIdentity(allocation(elsewhere))).ok, true);
  assert.equal((await sql.identityStore.allocateIdentity(allocation(newEpoch))).ok, true);
  assert.equal((await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: elsewhere.worldId, worldEpoch: EPOCH })).binding.characterId, CHAR);
  const auth = Object.freeze({ accountId: id(15) });
  const fresh = new CharacterProvisioning(sql.identityStore, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => auth, uuid: () => id(16) });
  const defaultProfile = await fresh.provision('default-profile');
  assert.deepEqual(defaultProfile.character.data.eco.pack.goods, {});
});

test('binding insert failure rolls back the newly inserted character', async t => {
  const sql = await identityDatabase(); t.after(() => sql.close());
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(`CREATE FUNCTION public.mn_identity_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected binding fault'; END $$;
    CREATE TRIGGER mn_identity_abort BEFORE INSERT ON public.mn_comm_character_bindings
      FOR EACH ROW EXECUTE FUNCTION public.mn_identity_abort();`);
  await sql.db.exec('SET ROLE service_role');
  await assert.rejects(sql.identityStore.allocateIdentity(allocation()), e => e instanceof ContributionError && e.code === 'unavailable');
  assert.equal(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), null);
  assert.equal(await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH }), null);
});

test('lost allocation reply recovers the immutable binding from a fresh adapter and disk reopen', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mn-identity-'));
  assertOwnedTemp(parent, 'mn-identity-');
  const dir = path.resolve(parent, 'database');
  assert.ok(dir.startsWith(path.resolve(parent) + path.sep));
  let sql = await identityDatabase(dir); t.after(async () => { await sql?.close(); await rm(parent, { recursive: true, force: true }); });
  let lose = true;
  const { store: lossy } = await identityDatabaseAdapter(sql.db, { loseReply: name => name === 'mn_comm_allocate_identity' && lose && (lose = false) === false });
  await assert.rejects(lossy.allocateIdentity(allocation()), e => e instanceof ContributionError && e.code === 'unavailable');
  await sql.close(); sql = null;
  sql = await identityDatabase(dir);
  const recovered = await sql.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH });
  assert.equal(recovered.binding.characterId, CHAR); assert.equal(recovered.character.version, 1);
});

test('provision, bound admission, contribution, close, and disk reopen preserve one owned current profile', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mn-identity-flow-'));
  assertOwnedTemp(parent, 'mn-identity-flow-');
  const dir = path.resolve(parent, 'database');
  assert.ok(dir.startsWith(path.resolve(parent) + path.sep));
  let sql = await identityDatabase(dir); t.after(async () => { await sql?.close(); await rm(parent, { recursive: true, force: true }); });
  const auth = Object.freeze({ accountId: ACCOUNT });
  const resolveIdentity = () => auth;
  const provisioning = new CharacterProvisioning(sql.identityStore, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity, uuid: () => CHAR, initializeProfile: () => data() });
  const initial = await provisioning.provision('provision-client');
  assert.equal(initial.binding.characterId, CHAR); assert.equal(initial.character.version, 1);

  await sql.store.initializeProject({ worldId: WORLD, worldEpoch: EPOCH, projectId: 'salty:hall', version: 1,
    requirements: { madera: 2 }, contributed: { madera: 0 } });
  const sessions = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH, resolveIdentity });
  const admitted = await sessions.open('game-client');
  assert.equal(admitted.binding.accountId, ACCOUNT); assert.equal(admitted.character.version, 1);
  const saved = await sessions.save('game-client', admitted.token, { ...admitted.character.data, name: 'Saved' });
  assert.equal(saved.ok, true);
  assert.deepEqual(sessions.drain(() => {}), ['game-client']);
  const afterSave = sessions.view('game-client');
  assert.equal(afterSave.character.version, 2); assert.equal(afterSave.character.data.name, 'Saved');
  const contribution = await sessions.contribute('game-client', afterSave.token, { operationId: id(40),
    projectId: 'salty:hall', good: 'madera', amount: 2, expectedProjectVersion: 1 });
  assert.equal(contribution.ok, true); assert.equal(contribution.accepted, 2);
  const events = [];
  assert.deepEqual(sessions.drain(event => events.push(event)), ['game-client']);
  assert.equal(events[0].character.version, 3); assert.equal(events[0].character.data.name, 'Saved');
  assert.equal(events[0].character.data.eco.pack.goods.madera, 2);
  sessions.close('game-client'); await sql.close(); sql = null;

  sql = await identityDatabase(dir);
  const afterReopen = new CharacterProvisioning(sql.identityStore, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity, uuid: () => id(99), initializeProfile: () => data('must-not-reset') });
  const loaded = await afterReopen.provision('fresh-provision-client');
  assert.equal(loaded.binding.characterId, CHAR); assert.equal(loaded.character.version, 3);
  assert.equal(loaded.character.data.name, 'Saved'); assert.equal(loaded.character.data.eco.pack.goods.madera, 2);
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, 'salty:hall')).contributed.madera, 2);
  const freshSessions = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH, resolveIdentity });
  const freshAdmission = await freshSessions.open('fresh-game-client');
  assert.equal(freshAdmission.binding.characterId, CHAR); assert.equal(freshAdmission.character.version, 3);
  assert.equal(freshAdmission.character.data.eco.pack.goods.madera, 2);
  freshSessions.close('fresh-game-client');
});

async function identityDatabaseAdapter(db, options) {
  const { createClient } = await import('@supabase/supabase-js');
  const { createSupabaseIdentityStore } = await import('../server/community/supabaseIdentityStore.mjs');
  const fetch = async (input, init = {}) => {
    const name = new URL(input).pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    const route = name === 'mn_comm_allocate_identity'
      ? ['public.mn_comm_allocate_identity($1::jsonb,$2::jsonb)', [body.p_binding, body.p_data]]
      : ['public.mn_comm_load_identity($1::uuid,$2::text,$3::uuid)', [body.p_account_id, body.p_world_id, body.p_world_epoch]];
    try {
      const data = (await db.query(`select ${route[0]} as data`, route[1])).rows[0].data;
      if (options.loseReply?.(name, body)) throw new Error('lost');
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch { return new Response(JSON.stringify({ message: 'fault' }), { status: 400 }); }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { store: createSupabaseIdentityStore(client) };
}

test('invalid contracts, forged responses, DML, anon execution, and unsupported isolation fail closed', async t => {
  const sql = await identityDatabase(); t.after(() => sql.close());
  await assert.rejects(sql.identityStore.allocateIdentity(allocation(binding({ characterId: '00000000-0000-0000-0000-000000000000' }))), e => e.code === 'input');
  const corrupted = await identityDatabase(undefined, { adapterOptions: { transformReply: (name, result) =>
    name === 'mn_comm_load_identity' && result ? { ...result, character: { ...result.character, characterId: id(99) } } : result } });
  t.after(() => corrupted.close());
  await corrupted.identityStore.allocateIdentity(allocation());
  await assert.rejects(corrupted.identityStore.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH }), e => e.code === 'response');
  await assert.rejects(sql.db.exec('insert into public.mn_comm_character_bindings default values'), e => e.code === '42501');
  await sql.db.exec('SET ROLE anon');
  await assert.rejects(sql.db.query('select public.mn_comm_load_identity($1,$2,$3)', [ACCOUNT,WORLD,EPOCH]), e => e.code === '42501');
  await assert.rejects(sql.db.query('select public.mn_comm_allocate_identity($1::jsonb,$2::jsonb)',
    [JSON.stringify(binding()),JSON.stringify(data())]), e => e.code === '42501');
  await sql.db.exec('RESET ROLE; BEGIN; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  await assert.rejects(sql.db.query('select public.mn_comm_allocate_identity($1::jsonb,$2::jsonb)', [JSON.stringify(binding()),JSON.stringify(data())]), e => e.code === 'CMI01');
  await sql.db.exec('ROLLBACK');
});

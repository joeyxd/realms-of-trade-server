import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountResolver } from '../server/auth.mjs';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { database } from './helpers/community-sql.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'salty:authenticated', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3);
const row = { worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, version: 1,
  data: { v: 1, name: 'Nerea', eco: { pack: { goods: { madera: 4 } } } } };
const binding = { accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR };

test('verified account resolver admits the SQL-owned character and never consumes HELLO identity claims', async t => {
  const sql = await database(undefined, { bindings: true }); t.after(() => sql.close());
  await sql.store.initializeCharacter(row); await sql.store.initializeBinding(binding);
  const verifiedTokens = [], auth = new Map();
  const verify = createAccountResolver({ auth: { getUser: async token => {
    verifiedTokens.push(token); return { data: { user: { id: ACCOUNT, is_anonymous: false } }, error: null };
  } } });
  const hello = { token: 'fixture-verified-token', accountId: id(50), characterId: id(51),
    worldId: 'spoof:world', worldEpoch: id(52), data: { eco: { pack: { goods: { madera: 999 } } } } };
  auth.set('socket', Object.freeze({ accountId: await verify({}, hello) }));
  const sessions = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: clientId => auth.get(clientId) });
  const opened = await sessions.open('socket');
  assert.deepEqual(verifiedTokens, ['fixture-verified-token']);
  assert.deepEqual(opened.binding, binding);
  assert.deepEqual(opened.character, row);
  assert.deepEqual(sql.calls.filter(c => c.name === 'mn_comm_load_binding').map(c => c.body),
    [{ p_account_id: ACCOUNT, p_world_id: WORLD, p_world_epoch: EPOCH }]);
  assert.equal(sql.calls.some(c => /initialize/.test(c.name) && c.body?.p_binding?.accountId === id(50)), false);
  sessions.close('socket');
});

test('guest, anonymous, and failed verification cannot create an admission auth context', async t => {
  const sql = await database(undefined, { bindings: true }); t.after(() => sql.close());
  const auth = new Map();
  const sessions = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: clientId => auth.get(clientId) });
  const guest = createAccountResolver({ auth: { getUser: async () => { throw new Error('must not call'); } } });
  assert.equal(await guest({}, {}), null);
  for (const result of [{ data: { user: { id: ACCOUNT, is_anonymous: true } } },
    { data: { user: { id: ACCOUNT } }, error: { message: 'fixture rejection' } }]) {
    const verify = createAccountResolver({ auth: { getUser: async () => result } });
    await assert.rejects(verify({}, { token: 'fixture-invalid-token' }), e => e.code === 'auth');
  }
  await assert.rejects(sessions.open('unverified'), e => e.code === 'identity');
  assert.deepEqual(sql.calls, []);
});

test('malformed binding replies and revoked identity views expose no prior profile or usable token', async t => {
  let wrong = true;
  const sql = await database(undefined, { bindings: true, adapterOptions: {
    transformReply(name, data) {
      return name === 'mn_comm_load_binding' && wrong ? { ...data, accountId: id(99) } : data;
    },
  } }); t.after(() => sql.close());
  await sql.store.initializeCharacter(row); await sql.store.initializeBinding(binding);
  const proof = Object.freeze({ accountId: ACCOUNT }), auth = new Map([['socket', proof]]);
  const sessions = new BoundProfileSessions(sql.store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: clientId => auth.get(clientId) });
  await assert.rejects(sessions.open('socket'), e => e.code === 'response');
  wrong = false; await sessions.open('socket');
  auth.delete('socket');
  assert.deepEqual(sessions.view('socket'), { phase: 'fenced', binding: null, character: null,
    token: null, reason: 'identity', pending: null });
  auth.set('socket', proof);
  assert.equal(sessions.canMutate('socket'), false);
  assert.equal(sessions.view('socket').character, null);
  sessions.close('socket');
});

test('scoped binding collisions have one owner, protected rows cannot be rewritten or deleted, and public roles cannot provision', async t => {
  const sql = await database(undefined, { bindings: true }); t.after(() => sql.close());
  await sql.store.initializeCharacter(row);
  const other = { ...binding, accountId: id(77) };
  const results = await Promise.all([sql.store.initializeBinding(binding), sql.store.initializeBinding(other)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.deepEqual(results.find(r => !r.ok), { ok: false, why: 'conflict' });
  const owner = results.find(r => r.ok).binding;
  for (const role of ['anon', 'authenticated']) {
    await sql.db.exec(`SET ROLE ${role}`);
    await assert.rejects(sql.db.query('select public.mn_comm_initialize_binding($1::jsonb)',
      [JSON.stringify(other)]), e => e.code === '42501');
    await assert.rejects(sql.db.exec('select * from public.mn_comm_character_bindings'), e => e.code === '42501');
    await sql.db.exec('RESET ROLE');
  }
  await assert.rejects(sql.db.exec('update public.mn_comm_character_bindings set account_id = account_id'),
    e => e.code === 'CMI02');
  await assert.rejects(sql.db.exec('delete from public.mn_comm_character_bindings'), e => e.code === 'CMI02');
  await assert.rejects(sql.db.exec('delete from public.mn_comm_characters'), e => e.code === '23503');
  await sql.db.exec('SET ROLE service_role');
  assert.deepEqual(await sql.store.loadBinding(owner.accountId, WORLD, EPOCH), owner);
  assert.deepEqual(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), row);
});

test('close requested inside publication is deferred until its atomic drain finishes', async () => {
  const store = createMemoryContributionStore({ characters: [row], bindings: [binding] });
  const proof = Object.freeze({ accountId: ACCOUNT });
  const sessions = new BoundProfileSessions(store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => proof });
  const opened = await sessions.open('socket');
  await sessions.save('socket', opened.token, { ...opened.character.data, name: 'Confirmed' });
  let publications = 0;
  assert.deepEqual(sessions.drain(() => {
    publications++;
    sessions.close('socket');
    assert.throws(() => sessions.drain(() => {}), e => e.code === 'busy');
  }), ['socket']);
  assert.equal(publications, 1);
  assert.equal(sessions.canMutate('socket'), false);
  assert.throws(() => sessions.view('socket'), e => e.code === 'session');
  assert.equal((await sessions.open('replacement')).character.data.name, 'Confirmed');
});

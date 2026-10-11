import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { database, walletSql } from './helpers/web3-wallet-sql.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const address = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const nonce = (n) => n.toString(16).padStart(64, '0');
const request = (n, account = 1, wallet = n, issuedAt = Date.now()) => ({
  challengeId: id(100 + n), accountId: id(account), address: address(wallet), chainId: 31337,
  nonce: nonce(n), message: `Sign-in with Ethereum for account ${account}; challenge ${n}.`,
  issuedAt, expiresAt: issuedAt + 300000,
});
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
};
const issue = (client, value) => rpc(client, 'mn_web3_wallet_issue', { p_request: value });
const complete = (client, value, account = value.accountId, verified = true) => rpc(client,
  'mn_web3_wallet_complete', { p_challenge_id: value.challengeId, p_account_id: account, p_verified: verified });

test('wallet migration stands alone, exposes only service RPCs, and round-trips exact DTOs', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const value = request(1);
  value.challengeId = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
  value.accountId = 'abcdefab-cdef-abcd-efab-cdefabcdefac';
  value.message = 'Sign-in with Ethereum for account 1;\nURI: https://game.example/web3/wallet';
  assert.deepEqual(await rpc(sql.client, 'mn_web3_wallet_link', { p_account_id: value.accountId }), null);
  const issued = await sql.store.issue(value);
  assert.deepEqual(issued, { ok: true, replay: false, challenge: value });
  assert.deepEqual(await sql.store.loadChallenge(value.challengeId),
    { challenge: value, state: 'pending', result: null });
  const finished = await sql.store.complete(value.challengeId, value.accountId, true);
  assert.deepEqual(finished, { ok: true, link: {
    accountId: value.accountId, address: value.address, chainId: value.chainId, challengeId: value.challengeId,
  } });
  assert.deepEqual(await sql.store.loadLink(value.accountId), finished.link);
  assert.deepEqual(await sql.store.loadChallenge(value.challengeId),
    { challenge: value, state: 'used', result: finished });
  assert.deepEqual(await issue(sql.client, value), { ok: false, why: 'identity' });
  assert.ok(sql.calls.some((call) => call.name === 'mn_web3_wallet_issue'));
  for (const call of sql.calls) {
    assert.equal(call.headers.apikey, 'service-role-test-key');
    assert.equal(call.headers.authorization, 'Bearer service-role-test-key');
  }

  const tables = (await sql.db.query(`select tablename from pg_tables where schemaname='mn_web3_private'`)).rows;
  assert.deepEqual(tables.map((row) => row.tablename).sort(), ['wallet_challenges', 'wallet_links']);
  await sql.db.exec('RESET ROLE');
  const functions = (await sql.db.query(`select p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') service_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'mn_web3_wallet_%' order by p.proname`)).rows;
  assert.equal(functions.length, 4);
  for (const fn of functions) {
    assert.equal(fn.anon_exec, false); assert.equal(fn.auth_exec, false); assert.equal(fn.service_exec, true);
  }
  await sql.db.exec('SET ROLE service_role');
  for (const table of ['wallet_challenges', 'wallet_links']) {
    await assert.rejects(sql.db.exec(`INSERT INTO mn_web3_private.${table} DEFAULT VALUES`), (error) => error.code === '42501');
    await assert.rejects(sql.db.exec(`UPDATE mn_web3_private.${table} SET account_id = account_id`), (error) => error.code === '42501');
    await assert.rejects(sql.db.exec(`DELETE FROM mn_web3_private.${table}`), (error) => error.code === '42501');
    await assert.rejects(sql.db.exec(`TRUNCATE mn_web3_private.${table}`), (error) => error.code === '42501');
  }
});

test('wallet SQL validates the exact DTO and rejects malformed values with MNW11', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const good = request(10);
  const malformed = [
    { ...good, extra: true }, { ...good, challengeId: `${good.challengeId}\n` },
    { ...good, accountId: '00000000-0000-0000-0000-000000000000' }, { ...good, address: good.address.toUpperCase() },
    { ...good, address: address(0) }, { ...good, chainId: 0 }, { ...good, chainId: 2147483648 },
    { ...good, chainId: 1.5 }, { ...good, nonce: good.nonce.toUpperCase() },
    { ...good, message: '' }, { ...good, message: 'ñ' }, { ...good, message: 'line\rreturn' },
    { ...good, message: 'tab\there' }, { ...good, message: 'x'.repeat(2049) },
    { ...good, issuedAt: 0 }, { ...good, expiresAt: good.issuedAt + 29999 },
    { ...good, expiresAt: good.issuedAt + 600001 }, { ...good, issuedAt: good.issuedAt + 11000 },
  ];
  for (const value of malformed) await assert.rejects(issue(sql.client, value), (error) => error.code === 'MNW11',
    JSON.stringify(value));
  for (const value of [null, [], true, { ...good, chainId: '31337' }, { ...good, issuedAt: '1' }]) {
    await assert.rejects(sql.client.rpc('mn_web3_wallet_issue', { p_request: value }).then(({ error }) => {
      if (error) throw error;
    }), (error) => error.code === 'MNW11');
  }
  const wholeNumbers = JSON.stringify(good)
    .replace(`"chainId":${good.chainId}`, `"chainId":${good.chainId}.0`)
    .replace(`"issuedAt":${good.issuedAt}`, `"issuedAt":${good.issuedAt}.0`)
    .replace(`"expiresAt":${good.expiresAt}`, `"expiresAt":${good.expiresAt}.0`);
  await sql.db.exec('BEGIN');
  const accepted = (await sql.db.query('select public.mn_web3_wallet_issue($1::jsonb) as data', [wholeNumbers])).rows[0].data;
  assert.equal(accepted.ok, true);
  await sql.db.exec('ROLLBACK');
  assert.equal((await sql.db.query('select count(*)::int as n from mn_web3_private.wallet_challenges')).rows[0].n, 0);
  await assert.rejects(sql.client.rpc('mn_web3_wallet_complete', {
    p_challenge_id: '00000000-0000-0000-0000-000000000000', p_account_id: id(1), p_verified: true,
  }).then(({ error }) => { if (error) throw error; }), (error) => error.code === 'MNW11');
  await sql.db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await assert.rejects(issue(sql.client, good), (error) => error.code === 'MNW12');
  await sql.db.exec('ROLLBACK');
});

test('wallet issue expires, allows only one pending identity, and consumes verification once', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const expired = request(20, 20, 20, Date.now() - 400000);
  assert.deepEqual(await issue(sql.client, expired), { ok: false, why: 'expired' });

  const first = request(21, 21, 21), different = request(22, 21, 22);
  assert.equal((await issue(sql.client, first)).ok, true);
  assert.deepEqual(await issue(sql.client, first), { ok: true, replay: true, challenge: first });
  assert.deepEqual(await issue(sql.client, request(25, 21, 21)), { ok: true, replay: true, challenge: first });
  assert.deepEqual(await issue(sql.client, { ...first, message: `${first.message} changed` }),
    { ok: false, why: 'identity' });
  assert.deepEqual(await issue(sql.client, different), { ok: false, why: 'busy' });
  assert.deepEqual(await complete(sql.client, first, id(99)), { ok: false, why: 'missing' });
  assert.deepEqual(await complete(sql.client, first, first.accountId, false), { ok: false, why: 'signature' });
  assert.deepEqual(await complete(sql.client, first), { ok: false, why: 'used' });
  assert.equal(await rpc(sql.client, 'mn_web3_wallet_link', { p_account_id: first.accountId }), null);

  const competing = await Promise.all([issue(sql.client, request(23, 23, 23)), issue(sql.client, request(24, 23, 24))]);
  assert.equal(competing.filter((result) => result.ok).length, 1);
  assert.equal(competing.filter((result) => result.why === 'busy').length, 1);
});

test('database clock expires challenges at completion; link conflicts never overwrite account or wallet', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const first = request(30, 30, 30);
  assert.equal((await issue(sql.client, first)).ok, true);
  const success = await complete(sql.client, first);
  assert.equal(success.ok, true);

  const conflict = request(31, 31, 30);
  await sql.db.exec('RESET ROLE');
  await sql.db.query(`insert into mn_web3_private.wallet_challenges
    (challenge_id, account_id, address, chain_id, nonce, message, issued_at_ms, expires_at_ms)
    values ($1::uuid,$2::uuid,$3::text,$4::int,$5::text,$6::text,$7::bigint,$8::bigint)`,
  [conflict.challengeId, conflict.accountId, conflict.address, conflict.chainId, conflict.nonce, conflict.message,
    conflict.issuedAt, conflict.expiresAt]);
  const expired = request(32, 32, 32, Date.now() - 400000);
  await sql.db.query(`insert into mn_web3_private.wallet_challenges
    (challenge_id, account_id, address, chain_id, nonce, message, issued_at_ms, expires_at_ms)
    values ($1::uuid,$2::uuid,$3::text,$4::int,$5::text,$6::text,$7::bigint,$8::bigint)`,
  [expired.challengeId, expired.accountId, expired.address, expired.chainId, expired.nonce, expired.message,
    expired.issuedAt, expired.expiresAt]);
  await sql.db.exec('SET ROLE service_role');
  assert.deepEqual(await complete(sql.client, conflict), { ok: false, why: 'conflict' });
  assert.deepEqual(await complete(sql.client, expired), { ok: false, why: 'expired' });
  assert.deepEqual(await rpc(sql.client, 'mn_web3_wallet_link', { p_account_id: first.accountId }), success.link);
  assert.deepEqual(await rpc(sql.client, 'mn_web3_wallet_link', { p_account_id: conflict.accountId }), null);
  assert.equal((await sql.db.query(`select state, result->>'why' why from mn_web3_private.wallet_challenges
    where challenge_id=$1::uuid`, [expired.challengeId])).rows[0].why, 'expired');
});

test('one concurrent completion wins, and account and chain-address uniqueness prevent overwrite', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const first = request(40, 40, 40); await issue(sql.client, first);
  const attempts = await Promise.all([complete(sql.client, first), complete(sql.client, first)]);
  assert.equal(attempts.filter((result) => result.ok).length, 1);
  assert.equal(attempts.filter((result) => result.why === 'used').length, 1);
  assert.deepEqual(await issue(sql.client, request(41, 40, 41)), { ok: false, why: 'linked' });

  const other = request(42, 42, 40);
  assert.equal((await issue(sql.client, other)).ok, true);
  assert.deepEqual(await complete(sql.client, other), { ok: false, why: 'conflict' });
  assert.deepEqual(await rpc(sql.client, 'mn_web3_wallet_link', { p_account_id: other.accountId }), null);
  assert.equal((await sql.db.query('select count(*)::int n from mn_web3_private.wallet_links')).rows[0].n, 1);
});

test('issue ignores a terminal challenge fixture and preserves its receipt', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const terminal = request(80, 80, 80);
  terminal.challengeId = 'abcdefab-cdef-abcd-efab-cdefabcdef80';
  await sql.db.exec('RESET ROLE');
  await sql.db.query(`insert into mn_web3_private.wallet_challenges
    (challenge_id, account_id, address, chain_id, nonce, message, issued_at_ms, expires_at_ms, state, result)
    values ($1::uuid,$2::uuid,$3::text,$4::int,$5::text,$6::text,$7::bigint,$8::bigint,'used',$9::jsonb)`,
  [terminal.challengeId, terminal.accountId, terminal.address, terminal.chainId, terminal.nonce,
    terminal.message, terminal.issuedAt, terminal.expiresAt, JSON.stringify({ ok: false, why: 'signature' })]);
  await sql.db.exec('SET ROLE service_role');
  const fresh = request(81, 80, 81);
  assert.deepEqual(await issue(sql.client, fresh), { ok: true, replay: false, challenge: fresh });
  assert.deepEqual(await sql.store.loadChallenge(terminal.challengeId), {
    challenge: terminal, state: 'used', result: { ok: false, why: 'signature' },
  });
});

test('issue expires a stale pending row before reserving a fresh challenge for that account', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const stale = request(82, 82, 82, Date.now() - 400000);
  await sql.db.exec('RESET ROLE');
  await sql.db.query(`insert into mn_web3_private.wallet_challenges
    (challenge_id, account_id, address, chain_id, nonce, message, issued_at_ms, expires_at_ms)
    values ($1::uuid,$2::uuid,$3::text,$4::int,$5::text,$6::text,$7::bigint,$8::bigint)`,
  [stale.challengeId, stale.accountId, stale.address, stale.chainId, stale.nonce,
    stale.message, stale.issuedAt, stale.expiresAt]);
  await sql.db.exec('SET ROLE service_role');
  const fresh = request(83, 82, 83);
  assert.deepEqual(await issue(sql.client, fresh), { ok: true, replay: false, challenge: fresh });
  assert.deepEqual(await sql.store.loadChallenge(stale.challengeId), {
    challenge: stale, state: 'used', result: { ok: false, why: 'expired' },
  });
});

test('a globally repeated nonce returns identity without leaking a uniqueness error', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const left = { ...request(90, 90, 90), nonce: nonce(999) };
  const right = { ...request(91, 91, 91), nonce: nonce(999) };
  const results = await Promise.all([issue(sql.client, left), issue(sql.client, right)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.filter((result) => !result.ok), [{ ok: false, why: 'identity' }]);
});

test('challenge and link survive a fresh PGlite reopen and the migration is idempotent', async () => {
  const location = path.join(await mkdtemp(path.join(tmpdir(), 'mn-web3-wallet-')), 'postgres');
  let sql = await database(location);
  const value = request(50); await issue(sql.client, value); const receipt = await complete(sql.client, value);
  await sql.close();
  sql = await database(location, { reapply: true });
  try {
    assert.deepEqual(await rpc(sql.client, 'mn_web3_wallet_challenge', { p_challenge_id: value.challengeId }),
      { challenge: value, state: 'used', result: receipt });
    assert.deepEqual(await rpc(sql.client, 'mn_web3_wallet_link', { p_account_id: value.accountId }), receipt.link);
    assert.deepEqual(await complete(sql.client, value), { ok: false, why: 'used' });
  } finally { await sql.close(); }
});

test('wallet migration coexists with W01 in either already-installed schema', async (t) => {
  const sql = await database(undefined, { coexistWithW01: true, reapply: true }); t.after(() => sql.close());
  const value = request(60);
  assert.equal((await issue(sql.client, value)).ok, true);
  assert.equal((await complete(sql.client, value)).ok, true);
  assert.equal((await sql.db.query(`select count(*)::int n from pg_tables where schemaname='mn_web3_private'`)).rows[0].n, 5);
  assert.equal((await sql.db.query(`select has_table_privilege('service_role','mn_web3_private.assets','SELECT') allowed`)).rows[0].allowed, true);
});

test('rollback cannot split a successful wallet link from its consumed challenge', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const value = request(70); await issue(sql.client, value);
  await sql.db.exec('BEGIN');
  const during = (await sql.db.query('select public.mn_web3_wallet_complete($1::uuid,$2::uuid,true) as data',
    [value.challengeId, value.accountId])).rows[0].data;
  assert.equal(during.ok, true);
  await sql.db.exec('ROLLBACK');
  assert.deepEqual(await sql.store.loadChallenge(value.challengeId), { challenge: value, state: 'pending', result: null });
  assert.equal(await sql.store.loadLink(value.accountId), null);
  assert.equal((await sql.store.complete(value.challengeId, value.accountId, true)).ok, true);
});

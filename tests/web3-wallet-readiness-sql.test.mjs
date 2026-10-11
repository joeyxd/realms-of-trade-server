import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database, walletSql } from './helpers/web3-wallet-sql.mjs';

const readinessSql = (await readFile(
  new URL('../server/migrations/web3/003_wallet_readiness.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');

async function setup(t, { coexistWithW01 = false } = {}) {
  const sql = await database(undefined, { coexistWithW01 });
  t.after(() => sql.close());
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(readinessSql);
  await sql.db.exec('SET ROLE service_role');
  return sql;
}

test('wallet readiness is a service-only read-only prerequisite probe and reapplies cleanly', async (t) => {
  const sql = await setup(t, { coexistWithW01: true });
  const now = Date.now();
  const pending = { challengeId: 'abcdefab-cdef-abcd-efab-cdefabcdefab', accountId: 'abcdefab-cdef-abcd-efab-cdefabcdefac',
    address: `0x${'1'.padStart(40, '0')}`, chainId: 31337, nonce: '1'.padStart(64, '0'),
    message: 'Pending readiness fixture', issuedAt: now, expiresAt: now + 300000 };
  const completed = { challengeId: 'abcdefab-cdef-abcd-efab-cdefabcdefad', accountId: 'abcdefab-cdef-abcd-efab-cdefabcdefae',
    address: `0x${'2'.padStart(40, '0')}`, chainId: 31337, nonce: '2'.padStart(64, '0'),
    message: 'Completed readiness fixture', issuedAt: now, expiresAt: now + 300000 };
  assert.equal((await sql.store.issue(pending)).ok, true);
  assert.equal((await sql.store.issue(completed)).ok, true);
  assert.equal((await sql.store.complete(completed.challengeId, completed.accountId, true)).ok, true);
  const snapshot = async () => (await sql.db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(c) order by c.challenge_id), '[]'::jsonb)
      from mn_web3_private.wallet_challenges c) challenges,
    (select coalesce(jsonb_agg(to_jsonb(l) order by l.account_id), '[]'::jsonb)
      from mn_web3_private.wallet_links l) links`)).rows[0];
  const before = await snapshot();
  assert.deepEqual((await sql.db.query('select public.mn_web3_wallet_ready() as ready')).rows[0].ready, { version: 1 });
  await sql.db.exec('RESET ROLE');
  await sql.db.exec('SET ROLE anon');
  await assert.rejects(sql.db.query('select public.mn_web3_wallet_ready()'), (error) => error.code === '42501');
  await sql.db.exec('SET ROLE authenticated');
  await assert.rejects(sql.db.query('select public.mn_web3_wallet_ready()'), (error) => error.code === '42501');
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(readinessSql);
  await sql.db.exec('SET ROLE service_role');
  assert.deepEqual((await sql.db.query('select public.mn_web3_wallet_ready() as ready')).rows[0].ready, { version: 1 });
  assert.deepEqual(await snapshot(), before);
  const w01 = await sql.db.query(`select
    has_table_privilege('service_role', 'mn_web3_private.assets', 'SELECT') service_select,
    has_table_privilege('anon', 'mn_web3_private.assets', 'SELECT') anon_select`);
  assert.deepEqual(w01.rows[0], { service_select: true, anon_select: false });
});

test('readiness returns only the fixed MNW13 unavailable error for missing or unhealthy prerequisites', async (t) => {
  const sql = await setup(t);
  const asService = async () => sql.db.exec('SET ROLE service_role');
  const asOwner = async () => sql.db.exec('RESET ROLE');
  const assertUnavailable = async () => assert.rejects(
    sql.db.query('select public.mn_web3_wallet_ready()'),
    (error) => error.code === 'MNW13' && error.message === 'unavailable');
  const assertHealthy = async () => assert.deepEqual(
    (await sql.db.query('select public.mn_web3_wallet_ready() as ready')).rows[0].ready, { version: 1 });

  await asOwner();
  await sql.db.exec('DROP FUNCTION public.mn_web3_wallet_link(uuid)');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec(walletSql);
  await sql.db.exec(readinessSql);
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_link(uuid) TO anon');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE EXECUTE ON FUNCTION public.mn_web3_wallet_link(uuid) FROM anon');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT UPDATE ON mn_web3_private.wallet_links TO service_role');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE UPDATE ON mn_web3_private.wallet_links FROM service_role');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT UPDATE (address) ON mn_web3_private.wallet_links TO service_role');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE UPDATE (address) ON mn_web3_private.wallet_links FROM service_role');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT SELECT (account_id) ON mn_web3_private.wallet_links TO anon');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE SELECT (account_id) ON mn_web3_private.wallet_links FROM anon');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT EXECUTE ON FUNCTION mn_web3_private.validate_wallet_request(jsonb) TO service_role');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE EXECUTE ON FUNCTION mn_web3_private.validate_wallet_request(jsonb) FROM service_role');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_ready() TO anon');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE EXECUTE ON FUNCTION public.mn_web3_wallet_ready() FROM anon');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('GRANT EXECUTE ON FUNCTION mn_web3_private.wallet_link_json(mn_web3_private.wallet_links) TO PUBLIC');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('REVOKE EXECUTE ON FUNCTION mn_web3_private.wallet_link_json(mn_web3_private.wallet_links) FROM PUBLIC');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('REVOKE EXECUTE ON FUNCTION public.mn_web3_wallet_link(uuid) FROM service_role');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_link(uuid) TO service_role');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('ALTER FUNCTION public.mn_web3_wallet_link(uuid) SET search_path = public');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec("ALTER FUNCTION public.mn_web3_wallet_link(uuid) SET search_path = ''");
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('ALTER FUNCTION public.mn_web3_wallet_link(uuid) SECURITY INVOKER');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('ALTER FUNCTION public.mn_web3_wallet_link(uuid) SECURITY DEFINER');
  await asService();
  await assertHealthy();
  await asOwner();
  await sql.db.exec('ALTER TABLE mn_web3_private.wallet_challenges DISABLE ROW LEVEL SECURITY');
  await asService();
  await assertUnavailable();
  await asOwner();
  await sql.db.exec('ALTER TABLE mn_web3_private.wallet_challenges ENABLE ROW LEVEL SECURITY');
  await asService();
  await assertHealthy();
});


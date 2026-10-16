import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { createAccountResolver } from '../server/auth.mjs';
import { createGameServer } from '../server/index.mjs';
import { createWalletLinkService, WalletLinkError } from '../server/web3/walletLink.mjs';
import { createSupabaseWalletStore, createMemoryWalletStore } from '../server/web3/walletStore.mjs';
import { createWalletHttpHandler } from '../server/web3/walletHttp.mjs';
import { equipmentRegistration } from '../server/web3/equipmentContent.mjs';
import { database } from './helpers/web3-wallet-sql.mjs';
import { adapters as assetAdapters } from './helpers/web3-asset-registry-sql.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ORIGIN = 'https://game.example';
const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
// Public local test key, never a funded wallet or production secret.
const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const resolver = createAccountResolver({ auth: { async getUser(token) {
  return token === 'local-test-account-token' ? { data: { user: { id: A } } } : { error: { code: 'invalid' } };
} } });
const request = (base, path, data) => fetch(base + path, { method: data ? 'POST' : 'GET',
  headers: { authorization: 'Bearer local-test-account-token', origin: ORIGIN, 'content-type': 'application/json' },
  ...(data ? { body: JSON.stringify(data) } : {}) });

test('real HTTP and SIWE proof recover lost SQL replies and reopen without changing a W01 asset', async (t) => {
  const location = join(await mkdtemp(join(tmpdir(), 'mn-wallet-integration-')), 'postgres');
  let loseIssue = true, loseComplete = true, app, sql;
  t.after(async () => { if (app) await app.close(); if (sql) await sql.close(); });
  sql = await database(location, { coexistWithW01: true, adapterOptions: { loseReply(name) {
    if (name === 'mn_web3_wallet_issue' && loseIssue) { loseIssue = false; return true; }
    if (name === 'mn_web3_wallet_complete' && loseComplete) { loseComplete = false; return true; }
    return false;
  } } });
  let registry = assetAdapters(sql.db).registry;
  const registration = equipmentRegistration({ operationId: id(1), assetId: id(2), worldId: 'coral',
    worldGeneration: id(3), sourceKey: 'catalog:copy:1', contentId: 'skin:1', rightsHash: 'a'.repeat(64), to: A },
  { v: 1, mode: 'appearance', baseId: 'sable', appearanceId: 'skin:1', appearanceHash: 'b'.repeat(64) });
  await registry.prepare(registration); await registry.commit(registration.operationId);
  const before = await registry.loadAsset(registration.assetId);
  const mount = async () => {
    const walletLink = createWalletLinkService({ store: sql.store, origin: ORIGIN, chainId: 31337 });
    app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {},
      saveSecret: 'local-wallet-integration-test', resolvePlayer: resolver, walletLink });
    return `http://127.0.0.1:${await app.listen()}`;
  };
  let base = await mount();
  const issueInput = { address: signer.address, chainId: 31337 };
  const lostIssue = await request(base, '/web3/wallet/challenge', issueInput);
  assert.equal(lostIssue.status, 503); assert.deepEqual(await lostIssue.json(), { ok: false, why: 'unavailable' });
  const resumedIssue = await request(base, '/web3/wallet/challenge', issueInput);
  assert.equal(resumedIssue.status, 200);
  const issued = await resumedIssue.json(); assert.equal(issued.replay, true);
  const challenge = issued.challenge, signature = await signer.signMessage({ message: challenge.message });
  const proof = { challengeId: challenge.challengeId, message: challenge.message, signature };
  const lostComplete = await request(base, '/web3/wallet/verify', proof);
  assert.equal(lostComplete.status, 503); assert.deepEqual(await lostComplete.json(), { ok: false, why: 'unavailable' });
  const recovered = await (await request(base, '/web3/wallet/link')).json();
  assert.deepEqual(recovered, { ok: true, link: { accountId: A, address: signer.address.toLowerCase(),
    chainId: 31337, challengeId: challenge.challengeId } });
  assert.deepEqual(await registry.loadAsset(registration.assetId), before);
  assert.equal((await sql.store.loadChallenge(challenge.challengeId)).state, 'used');
  await app.close(); app = null; await sql.close(); sql = null;

  sql = await database(location, { reapply: true }); registry = assetAdapters(sql.db).registry; base = await mount();
  assert.deepEqual(await (await request(base, '/web3/wallet/link')).json(), recovered);
  const replay = await request(base, '/web3/wallet/verify', proof);
  assert.equal(replay.status, 409); assert.deepEqual(await replay.json(), { ok: false, why: 'used' });
  assert.deepEqual(await registry.loadAsset(registration.assetId), before);
  const rows = await sql.db.query('select count(*)::int n from mn_web3_private.wallet_links');
  assert.equal(rows.rows[0].n, 1);
  assert.ok(sql.calls.every((call) => call.headers.authorization === 'Bearer service-role-test-key'));
});

test('RPC deadlines abort one request without automatic retries; contradictory replies fail closed', async () => {
  let calls = 0, signal;
  const stalled = createSupabaseWalletStore({ rpc() {
    calls++; return { abortSignal(value) { signal = value; return new Promise(() => {}); } };
  } }, { timeoutMs: 20 });
  await assert.rejects(stalled.loadLink(A), (e) => e instanceof WalletLinkError && e.code === 'storage');
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
  const malformed = createSupabaseWalletStore({ async rpc() { return { data: {
    accountId: id(1), address: signer.address.toLowerCase(), chainId: 31337, challengeId: id(2),
  } }; } });
  await assert.rejects(malformed.loadLink(A), (e) => e instanceof WalletLinkError && e.code === 'response');
});

async function standalone(t, service, options = {}) {
  const handler = createWalletHttpHandler({ service, resolvePlayer: resolver, ...options });
  const server = http.createServer((req, res) => { void handler.handle(req, res, new URL(req.url, 'http://local').pathname); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

test('HTTP backend waits have a deadline and return a fixed error', async (t) => {
  const service = { origin: ORIGIN, issue() {}, verify() {}, loadLink() { return new Promise(() => {}); } };
  const { base } = await standalone(t, service, { operationTimeoutMs: 20 });
  const response = await request(base, '/web3/wallet/link');
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, why: 'unavailable' });
});

test('an unfinished request body times out, and a peer abort leaves the handler usable', async (t) => {
  const store = createMemoryWalletStore(), service = createWalletLinkService({ store, origin: ORIGIN, chainId: 31337 });
  const { base, port } = await standalone(t, service, { bodyTimeoutMs: 30 });
  const headers = { authorization: 'Bearer local-test-account-token', origin: ORIGIN,
    'content-type': 'application/json', 'content-length': '100' };
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/web3/wallet/challenge', method: 'POST', headers }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on('error', reject); req.write('{');
  });
  assert.deepEqual(result, { status: 408, data: { ok: false, why: 'timeout' } });
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/web3/wallet/challenge', method: 'POST', headers });
    req.on('error', () => {}); req.on('close', resolve); req.write('{');
    req.on('socket', (socket) => socket.once('connect', () => setTimeout(() => req.destroy(), 10)));
  });
  const response = await request(base, '/web3/wallet/link');
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, link: null });
});

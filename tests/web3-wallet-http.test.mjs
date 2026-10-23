import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { createAccountResolver } from '../server/auth.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createMemoryWalletStore } from '../server/web3/walletStore.mjs';
import { createWalletLinkService } from '../server/web3/walletLink.mjs';

// Deterministic local-only test key. It must never hold funds.
const signer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'https://game.example';
const CHAIN = 84532;

function harness(t) {
  const gameStore = createMemoryStore();
  const walletStore = createMemoryWalletStore();
  const walletLink = createWalletLinkService({ store: walletStore, origin: ORIGIN, chainId: CHAIN });
  const resolvePlayer = createAccountResolver({ auth: { async getUser(token) {
    if (token === 'valid-player-token') return { data: { user: { id: A, is_anonymous: false } } };
    if (token === 'valid-player-token-b') return { data: { user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', is_anonymous: false } } };
    if (token === 'anonymous-token') return { data: { user: { id: A, is_anonymous: true } } };
    return { data: { user: null }, error: new Error('private fake provider detail') };
  } } });
  const app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {}, saveSecret: 'wallet-http-test-secret',
    store: gameStore, resolvePlayer, walletLink });
  t.after(() => app.close());
  return { app, gameStore, walletStore };
}

async function start(app) {
  const port = await app.listen();
  return `http://127.0.0.1:${port}`;
}

function request(base, path, { method = 'GET', token = 'valid-player-token', origin = ORIGIN, body, contentType = 'application/json' } = {}) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (origin !== null) headers.origin = origin;
  if (contentType !== null) headers['content-type'] = contentType;
  const requestBody = body === undefined ? undefined : body instanceof Uint8Array ? body : typeof body === 'string' ? body : JSON.stringify(body);
  return fetch(base + path, { method, headers, ...(requestBody === undefined ? {} : { body: requestBody }) });
}

async function json(response) {
  return response.json();
}

test('wallet HTTP routes are disabled unless createGameServer receives walletLink', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {}, saveSecret: 'wallet-http-off-secret' });
  t.after(() => app.close());
  const base = await start(app);
  assert.equal((await fetch(base + '/web3/wallet/link')).status, 404);
  assert.equal((await fetch(base + '/web3/wallet/challenge', { method: 'POST' })).status, 405);
});

test('authenticated challenge, verification, and GET recover a successful response', async (t) => {
  const { app, gameStore } = harness(t);
  const profile = newProfile(); profile.gold = 321; profile.pirateId = `account:${A}`;
  await gameStore.saveProfile(A, profile, 0);
  const profileBefore = await gameStore.loadProfile(A);
  const base = await start(app);
  const empty = await request(base, '/web3/wallet/link', { origin: null });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await json(empty), { ok: true, link: null });

  const issued = await request(base, '/web3/wallet/challenge', { method: 'POST', body: { address: signer.address, chainId: CHAIN } });
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  const challengeResponse = await json(issued);
  const challenge = challengeResponse.challenge ?? challengeResponse;
  assert.equal(challenge.address, signer.address.toLowerCase());

  const signature = await signer.signMessage({ message: challenge.message });
  const proof = {
    challengeId: challenge.challengeId, message: challenge.message, signature,
  };
  const crossAccount = await request(base, '/web3/wallet/verify', { method: 'POST', token: 'valid-player-token-b', body: proof });
  assert.equal(crossAccount.status, 404);
  assert.deepEqual(await json(crossAccount), { ok: false, why: 'missing' });

  const verified = await request(base, '/web3/wallet/verify', { method: 'POST', body: proof });
  assert.equal(verified.status, 200);
  const result = await json(verified);
  assert.equal(result.ok, true);

  const replay = await request(base, '/web3/wallet/verify', { method: 'POST', body: proof });
  assert.equal(replay.status, 409);
  assert.deepEqual(await json(replay), { ok: false, why: 'used' });

  const recovered = await request(base, '/web3/wallet/link');
  assert.equal(recovered.status, 200);
  assert.deepEqual(await json(recovered), { ok: true, link: result.link });
  assert.deepEqual(await gameStore.loadProfile(A), profileBefore, 'wallet linking does not mutate the existing W01 profile or version');
});

test('Bearer validation rejects guests, anonymous users, invalid tokens, and account spoofing', async (t) => {
  const { app, walletStore } = harness(t);
  const base = await start(app);
  const route = '/web3/wallet/link';

  const guest = await request(base, route, { token: null, origin: null });
  const anonymous = await request(base, route, { token: 'anonymous-token', origin: null });
  const invalid = await request(base, route, { token: 'invalid-token', origin: null });
  assert.equal(guest.status, 401);
  assert.equal(anonymous.status, 401);
  assert.equal(invalid.status, 401);
  const bodies = await Promise.all([guest, anonymous, invalid].map(json));
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[1], bodies[2]);
  assert.doesNotMatch(JSON.stringify(bodies), /private fake provider detail|invalid-token|anonymous-token/);

  const spoof = await request(base, '/web3/wallet/challenge', { method: 'POST', body: {
    accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', address: signer.address, chainId: CHAIN,
  } });
  assert.equal(spoof.status, 400);
  assert.doesNotMatch(await spoof.text(), /bbbbbbbb|accountId|private fake provider detail/);
  assert.equal(await walletStore.loadLink(A), null);
});

test('POST requires the exact configured Origin; GET accepts no Origin and rejects a mismatched one', async (t) => {
  const { app, walletStore } = harness(t);
  const base = await start(app);
  const payload = { address: signer.address, chainId: CHAIN };
  const missing = await request(base, '/web3/wallet/challenge', { method: 'POST', origin: null, body: payload });
  const wrong = await request(base, '/web3/wallet/challenge', { method: 'POST', origin: 'https://evil.example', body: payload });
  assert.equal(missing.status, 403);
  assert.equal(wrong.status, 403);
  assert.deepEqual(await json(missing), await json(wrong));
  assert.equal(await walletStore.loadLink(A), null);

  const noOriginGet = await request(base, '/web3/wallet/link', { origin: null });
  assert.equal(noOriginGet.status, 200);
  const wrongGet = await request(base, '/web3/wallet/link', { origin: 'https://evil.example' });
  assert.equal(wrongGet.status, 403);
  assert.doesNotMatch(wrongGet.headers.get('access-control-allow-origin') || '', /\*/);
});

test('wallet routes enforce strict methods, JSON content type, DTO shape, and the 4096-byte limit', async (t) => {
  const { app, walletStore } = harness(t);
  const base = await start(app);
  const wrongMethod = await request(base, '/web3/wallet/link', { method: 'DELETE' });
  const wrongContent = await request(base, '/web3/wallet/challenge', { method: 'POST', contentType: 'text/plain', body: '{}' });
  const badJson = await request(base, '/web3/wallet/challenge', { method: 'POST', body: '{' });
  const invalidUtf8 = await request(base, '/web3/wallet/challenge', { method: 'POST', body: new Uint8Array([0xff]) });
  const oversized = await request(base, '/web3/wallet/challenge', { method: 'POST', body: ' '.repeat(4097) });
  const extraField = await request(base, '/web3/wallet/challenge', { method: 'POST', body: { address: signer.address, chainId: CHAIN, unexpected: true } });

  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongContent.status, 415);
  assert.equal(badJson.status, 400);
  assert.equal(invalidUtf8.status, 400);
  assert.equal(oversized.status, 413);
  assert.equal(extraField.status, 400);
  for (const response of [wrongMethod, wrongContent, badJson, invalidUtf8, oversized, extraField]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.doesNotMatch(body, /stack|wallet-http-test-secret|private fake/i);
  }
  assert.equal(await walletStore.loadLink(A), null);
});

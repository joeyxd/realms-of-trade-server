import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { createMemoryWalletStore } from '../server/web3/walletStore.mjs';
import { createWalletLinkService, WalletLinkError } from '../server/web3/walletLink.mjs';

// Deterministic local-only keys. These well-known test keys must never hold funds.
const signer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const otherSigner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGIN = 'https://game.example';
const CHAIN = 84532;

function fixture({ initialTime = Date.parse('2030-01-02T03:04:05.000Z'), ttlMs = 300_000 } = {}) {
  let time = initialTime;
  const store = createMemoryWalletStore({ now: () => time });
  const service = createWalletLinkService({ store, origin: ORIGIN, chainId: CHAIN, ttlMs, now: () => time });
  return { store, service, get time() { return time; }, set time(value) { time = value; } };
}

async function issue(service, accountId = A, wallet = signer, chainId = CHAIN) {
  return service.issue(accountId, { address: wallet.address, chainId });
}

async function signedVerify(service, challenge, accountId = A, wallet = signer, message = challenge.message) {
  const signature = await wallet.signMessage({ message });
  return service.verify(accountId, { challengeId: challenge.challengeId, message, signature });
}

async function expectWhy(promise, why) {
  assert.deepEqual(await promise, { ok: false, why });
}

test('memory wallet service issues exact SIWE challenges and links a real EOA signature', async () => {
  const { store, service } = fixture();
  assert.equal(store.durable, false);

  const issued = await issue(service);
  assert.equal(issued.ok, true);
  const challenge = issued.challenge;
  assert.equal(challenge.address, signer.address.toLowerCase());
  assert.equal(challenge.chainId, CHAIN);
  assert.equal(typeof challenge.challengeId, 'string');
  assert.match(challenge.message, /game\.example/);
  assert.match(challenge.message, /https:\/\/game\.example\/web3\/wallet/);
  assert.match(challenge.message, new RegExp(A));
  assert.match(challenge.message, /84532/);
  assert.match(challenge.message, /nonce: [0-9a-f]{64}/i);
  assert.match(challenge.message, /expiration time:/i);
  assert.match(challenge.message, /Vincular/i);
  assert.match(challenge.message, /No autoriza compras ni transferencias/i);

  const result = await signedVerify(service, challenge);
  assert.equal(result.ok, true);
  assert.deepEqual(result.link, { accountId: A, address: signer.address.toLowerCase(), chainId: CHAIN, challengeId: challenge.challengeId });
  assert.deepEqual(await service.loadLink(A), result.link, 'the authenticated read recovers a successful write after a lost reply');
  assert.equal(await service.loadLink(B), null);
});

test('tampered message fields and a different signer fail and consume the authorized attempt', async () => {
  const mutations = [
    (message) => message.replace('game.example', 'evil.example'),
    (message) => message.replace(`${ORIGIN}/web3/wallet`, `${ORIGIN}/wrong-path`),
    (message) => message.replace(String(CHAIN), String(CHAIN + 1)),
    (message) => message.replace(A, B),
    (message) => message.replace('MAREA NEGRA', 'MAREA OSCURA'),
  ];

  for (const mutate of mutations) {
    const { service } = fixture();
    const challenge = (await issue(service)).challenge;
    const altered = mutate(challenge.message);
    assert.notEqual(altered, challenge.message);
    await expectWhy(signedVerify(service, challenge, A, signer, altered), 'signature');
    await expectWhy(signedVerify(service, challenge), 'used');
    assert.equal(await service.loadLink(A), null);
  }

  const { service } = fixture();
  const challenge = (await issue(service)).challenge;
  await expectWhy(signedVerify(service, challenge, A, otherSigner), 'signature');
  await expectWhy(signedVerify(service, challenge), 'used');
});

test('a different authenticated account cannot consume the challenge; replay is rejected after success', async () => {
  const { service } = fixture();
  const challenge = (await issue(service)).challenge;

  await expectWhy(signedVerify(service, challenge, B), 'missing');
  const linked = await signedVerify(service, challenge, A);
  assert.equal(linked.ok, true);
  await expectWhy(signedVerify(service, challenge, A), 'used');
  assert.deepEqual(await service.loadLink(A), linked.link);
  assert.equal(await service.loadLink(B), null);
});

test('two simultaneous authorized verifications have one winner and one used result', async () => {
  const { service } = fixture();
  const challenge = (await issue(service)).challenge;
  const signature = await signer.signMessage({ message: challenge.message });
  const proof = { challengeId: challenge.challengeId, message: challenge.message, signature };

  const results = await Promise.all([service.verify(A, proof), service.verify(A, proof)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.filter((result) => !result.ok), [{ ok: false, why: 'used' }]);
  assert.deepEqual(await service.loadLink(A), results.find((result) => result.ok).link);
});

test('pending issue retries replay the same challenge; another address is busy until expiry', async () => {
  const { service } = fixture();
  const original = await issue(service);
  const retry = await issue(service);
  assert.equal(original.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(original.replay, false);
  assert.equal(retry.replay, true);
  assert.deepEqual(retry.challenge, original.challenge);
  assert.equal(retry.challenge.challengeId, original.challenge.challengeId);
  assert.equal(retry.challenge.nonce, original.challenge.nonce);

  assert.deepEqual(await issue(service, A, otherSigner), { ok: false, why: 'busy' });
});

test('expiry is checked using the injected clock at verification time', async () => {
  const f = fixture();
  const challenge = (await issue(f.service)).challenge;
  f.time = challenge.expiresAt + 1;

  await expectWhy(signedVerify(f.service, challenge), 'expired');
  assert.equal(await f.service.loadLink(A), null);
  await expectWhy(signedVerify(f.service, challenge), 'used');
});

test('an expired pending challenge can be replaced and the old challenge stays used', async () => {
  const f = fixture();
  const oldChallenge = (await issue(f.service)).challenge;
  f.time = oldChallenge.expiresAt;

  const replacement = await issue(f.service);
  assert.equal(replacement.ok, true);
  assert.notEqual(replacement.challenge.challengeId, oldChallenge.challengeId);
  assert.notEqual(replacement.challenge.nonce, oldChallenge.nonce);
  await expectWhy(signedVerify(f.service, oldChallenge), 'used');

  const linked = await signedVerify(f.service, replacement.challenge);
  assert.equal(linked.ok, true);
});

test('account and wallet uniqueness prevent overwrite or rebinding', async () => {
  const { service } = fixture();
  const first = (await issue(service, A, signer)).challenge;
  const linked = await signedVerify(service, first);
  const original = await service.loadLink(A);

  assert.deepEqual(await issue(service, A, otherSigner), { ok: false, why: 'linked' });
  const secondAccountChallenge = (await issue(service, B, signer)).challenge;
  await expectWhy(signedVerify(service, secondAccountChallenge, B), 'conflict');
  assert.deepEqual(await service.loadLink(A), original);
  assert.equal(await service.loadLink(B), null);
  assert.equal(linked.link.address, signer.address.toLowerCase());
});

test('input validation and configuration failures are classified without exposing storage details', async () => {
  const { service } = fixture();
  await assert.rejects(service.issue(A, { address: 'not-an-address', chainId: CHAIN }),
    (error) => error instanceof WalletLinkError && error.code === 'input');
  assert.deepEqual(await service.issue(A, { address: signer.address, chainId: CHAIN + 1 }), { ok: false, why: 'chain' });

  const store = createMemoryWalletStore();
  for (const options of [
    { origin: 'http://game.example', chainId: CHAIN },
    { origin: ORIGIN, chainId: 0 },
    { origin: ORIGIN, chainId: 2 ** 31 },
    { origin: ORIGIN, chainId: CHAIN, ttlMs: 29_999 },
    { origin: ORIGIN, chainId: CHAIN, ttlMs: 600_001 },
  ]) {
    assert.throws(() => createWalletLinkService({ store, ...options }),
      (error) => error instanceof WalletLinkError && error.code === 'configuration');
  }
});

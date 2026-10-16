import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { createWalletLinkService } from '../server/web3/walletLink.mjs';
import { createMemoryWalletStore } from '../server/web3/walletStore.mjs';

test('ordinary server advertises wallet disabled without invoking account verification', async () => {
  let verified = 0;
  const game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'config-test-only', resolvePlayer: () => { verified++; } });
  try {
    const port = await game.listen();
    const response = await fetch(`http://127.0.0.1:${port}/web3/wallet/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(verified, 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/web3/wallet/link`)).status, 404);
  } finally { await game.close(); }
});

test('mounted wallet policy is public while link and mutations still require authentication and same origin', async () => {
  let verified = 0;
  const walletLink = createWalletLinkService({ origin: 'https://game.example', chainId: 31337, store: createMemoryWalletStore() });
  const game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'config-test-only', walletLink,
    resolvePlayer: () => { verified++; throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC'); } });
  try {
    const port = await game.listen(), base = `http://127.0.0.1:${port}`;
    const response = await fetch(`${base}/web3/wallet/config`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await response.json(), { enabled: true, origin: 'https://game.example', chainId: 31337, proof: 'eoa' });
    assert.equal(verified, 0);
    assert.equal((await fetch(`${base}/web3/wallet/config`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/web3/wallet/config`, { headers: { origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(`${base}/web3/wallet/config`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${base}/web3/wallet/link`)).status, 401);
    assert.equal((await fetch(`${base}/web3/wallet/challenge`, { method: 'POST', headers: { origin: 'https://game.example', 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal(verified, 0);
    const denied = await fetch(`${base}/web3/wallet/link`, { headers: { authorization: 'Bearer local-test' } });
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { ok: false, why: 'auth' });
    assert.equal(verified, 1);
  } finally { await game.close(); }
});

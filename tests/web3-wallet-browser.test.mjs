import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { privateKeyToAccount } from 'viem/accounts';
import { AccountAuth } from '../src/client/accountAuth.js';
import { WalletLink } from '../src/client/walletLink.js';
import { createMemoryWalletStore } from '../server/web3/walletStore.mjs';
import { createWalletLinkService } from '../server/web3/walletLink.mjs';

// Deterministic local-only signing key. It must never hold funds.
const signer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const otherSigner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGIN = 'https://game.example';
const CHAIN = 84532;
const BASE = `${ORIGIN}/`;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(status, value) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(value); } };
}

class FakeAuth {
  constructor(accountId = A) {
    this.state = { signedIn: true, guestChoice: false, accountId, email: 'same@example.test' };
    this.listeners = new Set();
    this.sessionCalls = 0;
  }
  subscribe(callback) { this.listeners.add(callback); callback({ ...this.state }); return () => this.listeners.delete(callback); }
  set(patch) { this.state = { ...this.state, ...patch }; for (const callback of this.listeners) callback({ ...this.state }); }
  async sessionIdentity() {
    this.sessionCalls++;
    if (!this.state.signedIn || this.state.guestChoice || !this.state.accountId) throw new Error('session unavailable');
    return { accountId: this.state.accountId, token: `token-${this.state.accountId}` };
  }
}

class FakeProvider extends EventEmitter {
  constructor({ address = signer.address, chainId = CHAIN, signMode = 'real', emitAccountsOnConnect = false, timeline = [] } = {}) {
    super();
    this.address = address.toLowerCase();
    this.chainId = chainId;
    this.signMode = signMode;
    this.emitAccountsOnConnect = emitAccountsOnConnect;
    this.timeline = timeline;
    this.calls = [];
    this.signStarted = deferred();
    this.signPending = deferred();
  }
  async request({ method, params = [] }) {
    this.calls.push({ method, params });
    this.timeline.push(`wallet:${method}`);
    if (method === 'eth_requestAccounts') {
      if (this.emitAccountsOnConnect) this.emit('accountsChanged', [this.address]);
      return [this.address];
    }
    if (method === 'eth_accounts') return [this.address];
    if (method === 'eth_chainId') return `0x${this.chainId.toString(16)}`;
    if (method === 'personal_sign') {
      this.signParams = params;
      this.signStarted.resolve(params);
      if (this.signMode === 'pending') return this.signPending.promise;
      if (this.signMode === 'timeout') return new Promise(() => {});
      if (this.signMode === 'private-error') throw new Error('PRIVATE_PROVIDER_DIAGNOSTIC');
      if (this.signMode === 'cancelled') throw { code: 4001, message: 'provider said no' };
      const message = Buffer.from(params[0].slice(2), 'hex').toString('utf8');
      return signer.signMessage({ message });
    }
    throw new Error(`unexpected provider method ${method}`);
  }
}

function harness({ accountId = A, providerOptions = {}, config = null, challengeTransform = null, challengeGate = null, loseVerifyReply = false,
  timeoutMs = 1000, providerTimeoutMs = 1000 } = {}) {
  let now = Date.parse('2030-01-02T03:04:05.000Z');
  const walletStore = createMemoryWalletStore({ now: () => now });
  const service = createWalletLinkService({ store: walletStore, origin: ORIGIN, chainId: CHAIN, now: () => now });
  const auth = new FakeAuth(accountId);
  const timeline = [];
  const provider = new FakeProvider({ ...providerOptions, timeline });
  const http = [];
  const challengeStarted = deferred();
  let lost = false;
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    http.push({ route, method: init.method, headers: { ...(init.headers || {}) }, body });
    timeline.push(`http:${route}`);
    if (route === '/web3/wallet/config') return response(200, config || { enabled: true, origin: ORIGIN, chainId: CHAIN, proof: 'eoa' });
    const authorization = init.headers?.authorization;
    const token = /^Bearer token-([a-f0-9-]+)$/i.exec(authorization || '')?.[1];
    if (!token) return response(401, { ok: false, why: 'auth' });
    if (route === '/web3/wallet/link') return response(200, { ok: true, link: await service.loadLink(token) });
    if (route === '/web3/wallet/challenge') {
      const result = await service.issue(token, body);
      if (result.ok && challengeTransform) challengeTransform(result.challenge);
      http.at(-1).response = structuredClone(result);
      challengeStarted.resolve(result);
      if (challengeGate) await challengeGate.promise;
      return response(result.ok ? 200 : 400, result);
    }
    if (route === '/web3/wallet/verify') {
      const result = await service.verify(token, body);
      if (loseVerifyReply && !lost && result.ok) { lost = true; throw new Error('response lost after commit'); }
      const status = result.ok ? 200 : result.why === 'used' ? 409 : result.why === 'missing' ? 404 : 403;
      return response(status, result);
    }
    return response(404, { ok: false, why: 'missing' });
  };
  const machine = new WalletLink({ auth, httpBase: BASE, origin: ORIGIN, fetchImpl, getProvider: () => provider,
    now: () => now, timeoutMs, providerTimeoutMs });
  return { machine, auth, provider, http, timeline, service, walletStore, challengeStarted, setNow(value) { now = value; } };
}

test('init and refresh use same-origin HTTP only; prepare reviews exact proof and sign is explicit', async () => {
  const f = harness();
  assert.equal(await f.machine.init(), true);
  assert.equal(await f.machine.refresh(), true);
  assert.equal(f.provider.calls.length, 0, 'initialization and refresh never contact the wallet');
  assert.deepEqual(f.http.map((request) => request.route), ['/web3/wallet/config', '/web3/wallet/link']);
  assert.equal(f.http[0].headers.authorization, undefined, 'public configuration does not carry a bearer');
  assert.equal(f.http[1].headers.authorization, `Bearer token-${A}`);

  assert.equal(await f.machine.prepare(), true);
  assert.equal(f.machine.snapshot().phase, 'review');
  assert.match(f.machine.snapshot().message, new RegExp(A));
  const challengeId = f.machine.challenge.challengeId;
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false,
    'prepare stops at a reviewable message and never prompts for a signature');
  assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false);

  assert.equal(await f.machine.sign(), true);
  assert.equal(f.machine.snapshot().phase, 'linked');
  assert.equal(f.machine.snapshot().link.accountId, A);
  assert.equal(f.machine.snapshot().link.address, signer.address.toLowerCase());
  assert.equal(f.machine.snapshot().link.chainId, CHAIN);
  assert.equal(f.machine.snapshot().link.challengeId, challengeId);
  assert.equal(f.provider.calls.filter((call) => call.method === 'personal_sign').length, 1);
  assert.equal(f.http.filter((request) => request.route === '/web3/wallet/verify').length, 1);
  f.machine.destroy();
});

test('a completed verification with a lost HTTP reply is recovered by refresh without another signature', async () => {
  const f = harness({ loseVerifyReply: true });
  await f.machine.init();
  await f.machine.refresh();
  await f.machine.prepare();
  assert.equal(await f.machine.sign(), false, 'the lost response does not claim success');
  assert.equal(f.machine.snapshot().link, null);
  assert.equal(await f.service.loadLink(A) !== null, true, 'the server committed before the reply was lost');

  assert.equal(await f.machine.refresh(), true);
  assert.equal(f.machine.snapshot().phase, 'linked');
  assert.equal(f.provider.calls.filter((call) => call.method === 'personal_sign').length, 1);
  assert.equal(f.http.filter((request) => request.route === '/web3/wallet/verify').length, 1);
  f.machine.destroy();
});

test('invalid challenge identity, exact SIWE policy, or extra fields never reach a signature prompt', async (t) => {
  const transforms = [
    (challenge) => { challenge.accountId = B; },
    (challenge) => { challenge.message = challenge.message.replace(ORIGIN, 'https://attacker.example'); },
    (challenge) => { challenge.message = challenge.message.replace('No autoriza compras ni transferencias.', 'Autoriza compras y transferencias.'); },
    (challenge) => { challenge.extra = 'unexpected'; },
  ];
  for (const challengeTransform of transforms) {
    const f = harness({ challengeTransform });
    await f.machine.init();
    assert.equal(await f.machine.prepare(), false);
    assert.notEqual(f.machine.snapshot().phase, 'review');
    assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
    assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false);
    f.machine.destroy();
  }
});

test('wrong network and wrong-origin game URLs stop before bearer requests or signatures', async () => {
  const wrongNetwork = harness({ providerOptions: { chainId: 1 } });
  await wrongNetwork.machine.init();
  assert.equal(await wrongNetwork.machine.prepare(), false);
  assert.equal(wrongNetwork.machine.snapshot().error.includes('red'), true);
  assert.equal(wrongNetwork.http.some((request) => request.route === '/web3/wallet/challenge'), false);
  assert.equal(wrongNetwork.provider.calls.some((call) => call.method === 'personal_sign'), false);
  wrongNetwork.machine.destroy();

  const foreignRequests = [];
  const foreignAuth = new FakeAuth();
  const foreign = new WalletLink({ auth: foreignAuth, httpBase: 'https://evil.example/', origin: ORIGIN,
    fetchImpl: async (...args) => { foreignRequests.push(args); return response(200, {}); }, getProvider: () => new FakeProvider() });
  assert.equal(await foreign.init(), false);
  assert.equal(await foreign.prepare(), false);
  assert.deepEqual(foreignRequests, [], 'a wrong-origin game URL makes no HTTP request and sends no bearer');
  assert.equal(foreignAuth.sessionCalls, 0);
  foreign.destroy();
});

test('accountsChanged emitted during eth_requestAccounts is ignored until identity is reread', async () => {
  const f = harness({ providerOptions: { emitAccountsOnConnect: true } });
  await f.machine.init();
  assert.equal(await f.machine.prepare(), true);
  assert.equal(f.machine.snapshot().phase, 'review');
  assert.ok(f.provider.calls.filter((call) => call.method === 'eth_accounts').length >= 1,
    'the wallet identity is explicitly read rather than inferred from the connect response');
  assert.equal(f.http.filter((request) => request.route === '/web3/wallet/challenge').length, 1);
  assert.ok(f.timeline.indexOf('wallet:eth_accounts') < f.timeline.indexOf('http:/web3/wallet/challenge'),
    'current account identity is checked before reserving a server challenge');
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
  f.machine.destroy();
});

test('closing review keeps the pending server challenge: same wallet replays, another is busy, expiry permits a new one', async () => {
  const f = harness();
  await f.machine.init();
  assert.equal(await f.machine.prepare(), true);
  const original = f.machine.challenge;
  f.machine.cancel();

  assert.equal(await f.machine.prepare(), true);
  assert.equal(f.machine.challenge.challengeId, original.challengeId);
  assert.equal(f.http.filter((request) => request.route === '/web3/wallet/challenge')[1].response.replay, true);
  f.machine.cancel();

  f.provider.address = otherSigner.address.toLowerCase();
  f.provider.emit('accountsChanged', [f.provider.address]);
  assert.equal(await f.machine.prepare(), false);
  assert.match(f.machine.snapshot().error, /pendiente/i);
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
  assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false);

  f.provider.address = signer.address.toLowerCase();
  f.provider.emit('accountsChanged', [f.provider.address]);
  assert.equal(await f.machine.prepare(), true, 'the original wallet can resume its still-live challenge');
  assert.equal(f.machine.challenge.challengeId, original.challengeId);
  f.machine.cancel();

  f.setNow(original.expiresAt);
  f.provider.address = otherSigner.address.toLowerCase();
  f.provider.emit('accountsChanged', [f.provider.address]);
  assert.equal(await f.machine.prepare(), true, 'after expiry, a different wallet can request a fresh challenge');
  assert.notEqual(f.machine.challenge.challengeId, original.challengeId);
  assert.equal(f.machine.challenge.address, otherSigner.address.toLowerCase());
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
  f.machine.destroy();
});

test('provider account changes while the challenge reply is pending leave a resumable challenge without prompting', async () => {
  const challengeGate = deferred();
  const f = harness({ challengeGate });
  await f.machine.init();
  const preparing = f.machine.prepare();
  const issued = await f.challengeStarted.promise;
  assert.equal(issued.ok, true);

  f.provider.address = otherSigner.address.toLowerCase();
  f.provider.emit('accountsChanged', [f.provider.address]);
  challengeGate.resolve();
  assert.equal(await preparing, false, 'identity reread rejects the stale address after the response arrives');
  assert.notEqual(f.machine.snapshot().phase, 'review');
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
  assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false);

  f.provider.address = signer.address.toLowerCase();
  f.provider.emit('accountsChanged', [f.provider.address]);
  assert.equal(await f.machine.prepare(), true, 'the original address resumes the reservation instead of making a second one');
  assert.equal(f.machine.challenge.challengeId, issued.challenge.challengeId);
  assert.equal(f.http.filter((request) => request.route === '/web3/wallet/challenge')[1].response.replay, true);
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
  f.machine.destroy();
});

test('an expired review challenge cannot open the signature prompt', async () => {
  const f = harness();
  await f.machine.init(); await f.machine.prepare();
  const challenge = f.machine.challenge;
  f.setNow(challenge.expiresAt);

  assert.equal(await f.machine.sign(), false);
  assert.equal(f.provider.calls.some((call) => call.method === 'personal_sign'), false);
  assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false);
  assert.match(f.machine.snapshot().error, /caduc/i);
  f.machine.destroy();
});

test('wallet or auth account/network changes and cancellation discard a late signature without verification', async () => {
  const changes = [
    ['provider accountsChanged', (f) => f.provider.emit('accountsChanged', [otherSigner.address])],
    ['transient provider chainChanged', (f) => {
      f.provider.chainId = 1;
      f.provider.emit('chainChanged', '0x1');
      f.provider.chainId = CHAIN;
    }],
    ['provider disconnect', (f) => f.provider.emit('disconnect')],
    ['same-email account switch', (f) => f.auth.set({ accountId: B, signedIn: true, guestChoice: false, email: 'same@example.test' })],
    ['explicit cancel', (f) => f.machine.cancel()],
  ];
  for (const [name, invalidate] of changes) {
    const f = harness({ providerOptions: { signMode: 'pending' } });
    await f.machine.init(); await f.machine.prepare();
    const sign = f.machine.sign();
    await f.provider.signStarted.promise;
    invalidate(f);
    const expectedMessage = Buffer.from(f.provider.signParams[0].slice(2), 'hex').toString('utf8');
    // The prompt was already issued; complete it after the authority change to test the stale result fence.
    f.provider.signPending.resolve(await signer.signMessage({ message: expectedMessage }));
    assert.equal(await sign, false, name);
    assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false, name);
    assert.equal(f.machine.snapshot().link, null, name);
    f.machine.destroy();
  }
});

test('provider timeout and provider exceptions become safe UI errors with no verification request', async () => {
  for (const options of [
    { providerOptions: { signMode: 'timeout' }, providerTimeoutMs: 10, expected: 'tiempo' },
    { providerOptions: { signMode: 'private-error' }, expected: 'wallet compatible' },
  ]) {
    const f = harness(options);
    await f.machine.init(); await f.machine.prepare();
    assert.equal(await f.machine.sign(), false);
    assert.match(f.machine.snapshot().error, new RegExp(options.expected, 'i'));
    assert.doesNotMatch(f.machine.snapshot().error, /PRIVATE_PROVIDER_DIAGNOSTIC/);
    assert.equal(f.http.some((request) => request.route === '/web3/wallet/verify'), false);
    f.machine.destroy();
  }
});

test('logout clears an existing wallet link', async () => {
  const f = harness();
  await f.machine.init(); await f.machine.prepare();
  assert.equal(await f.machine.sign(), true);
  assert.notEqual(f.machine.snapshot().link, null);

  f.auth.set({ signedIn: false, guestChoice: true, accountId: '', email: '' });
  assert.equal(f.machine.snapshot().link, null);
  assert.equal(f.machine.snapshot().phase, 'idle', 'logout must not retain a linked label after clearing the link');
  f.machine.destroy();
});

test('AccountAuth exposes only a matched current user and token pair from sessionIdentity', async () => {
  let session = { access_token: 'bearer-A-secret', user: { id: A, email: 'same@example.test' } };
  const snapshots = [];
  const authClient = { auth: {
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword() { return { data: {}, error: null }; },
    async signUp() { return { data: {}, error: null }; },
    async signOut() { return { error: null }; },
  } };
  const auth = new AccountAuth({ httpBase: BASE, fetchImpl: async () => response(200,
    { enabled: true, url: 'https://auth.example', publicKey: 'public-test-key' }), createClient: () => authClient });
  auth.subscribe((state) => snapshots.push(state));
  assert.equal(await auth.bootstrap({ online: true }), true);
  assert.deepEqual(await auth.sessionIdentity(), { accountId: A, token: 'bearer-A-secret' });
  assert.equal(snapshots.some((state) => Object.hasOwn(state, 'token') || Object.hasOwn(state, 'access_token')
    || JSON.stringify(state).includes('bearer-A-secret')), false, 'the bearer never enters published UI state');

  session = { access_token: 'bearer-B-secret', user: { id: B, email: 'same@example.test' } };
  await assert.rejects(auth.sessionIdentity(), /validar la sesi/,
    'a different UUID is rejected even when its email matches the signed-in account');

  const stale = deferred();
  authClient.auth.getSession = async () => stale.promise;
  session = { access_token: 'stale-A-secret', user: { id: A, email: 'same@example.test' } };
  const pending = auth.sessionIdentity();
  auth.applySession({ access_token: 'current-B-secret', user: { id: B, email: 'same@example.test' } });
  stale.resolve({ data: { session: { access_token: 'stale-A-secret', user: { id: A, email: 'same@example.test' } } }, error: null });
  await assert.rejects(pending, /validar la sesi/, 'a stale asynchronous session cannot return its old bearer');
  auth.useGuest();
  await assert.rejects(auth.sessionIdentity(), /validar la sesi/, 'guest state never produces an account token');
  assert.equal(snapshots.some((state) => JSON.stringify(state).includes('stale-A-secret')
    || JSON.stringify(state).includes('current-B-secret')), false);
});

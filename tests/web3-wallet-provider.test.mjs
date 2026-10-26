import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletProvider, WalletBrowserError } from '../src/client/walletProvider.js';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SIGNATURE = `0x${'ab'.repeat(65)}`;

function fakeProvider(handler = async ({ method }) => method === 'eth_chainId' ? '0x2105' : [ADDRESS]) {
  const calls = [];
  const events = new Map();
  return {
    calls,
    events,
    async request(args) { calls.push(args); return handler(args); },
    on(event, listener) { events.set(event, [...(events.get(event) ?? []), listener]); },
    removeListener(event, listener) { events.set(event, (events.get(event) ?? []).filter(item => item !== listener)); },
    emit(event, value) { for (const listener of events.get(event) ?? []) listener(value); },
  };
}

async function codeOf(promise, code) {
  await assert.rejects(promise, error => error instanceof WalletBrowserError && error.code === code);
}

test('connect, identity, and sign use the narrow EIP-1193 request sequence', async () => {
  const provider = fakeProvider(async ({ method }) => {
    if (method === 'personal_sign') return SIGNATURE;
    return method === 'eth_chainId' ? '0x2105' : [ADDRESS, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
  });
  const wallet = createWalletProvider(provider);
  assert.deepEqual(await wallet.connect(), { address: ADDRESS.toLowerCase(), chainId: 8453 });
  assert.deepEqual(await wallet.identity(), { address: ADDRESS.toLowerCase(), chainId: 8453 });
  assert.equal(await wallet.sign('héllo 🌊', ADDRESS), SIGNATURE);
  assert.deepEqual(provider.calls, [
    { method: 'eth_requestAccounts', params: undefined }, { method: 'eth_chainId', params: undefined },
    { method: 'eth_accounts', params: undefined }, { method: 'eth_chainId', params: undefined },
    { method: 'personal_sign', params: ['0x68c3a96c6c6f20f09f8c8a', ADDRESS.toLowerCase()] },
  ]);
});

test('provider requirements, account and chain validation return stable error codes', async () => {
  assert.throws(() => createWalletProvider({ request() {}, on() {} }), { code: 'provider' });
  for (const accounts of [null, '0x123', ['bad'], [`0x${'0'.repeat(40)}`]]) {
    const wallet = createWalletProvider(fakeProvider(async ({ method }) => method === 'eth_chainId' ? '0x1' : accounts));
    await codeOf(wallet.identity(), accounts?.length === 0 ? 'disconnected' : 'provider');
  }
  const empty = createWalletProvider(fakeProvider(async ({ method }) => method === 'eth_chainId' ? '0x1' : []));
  await codeOf(empty.identity(), 'disconnected');
  for (const chain of ['0x0', '0x80000000', '1', null]) {
    const wallet = createWalletProvider(fakeProvider(async ({ method }) => method === 'eth_chainId' ? chain : [ADDRESS]));
    await codeOf(wallet.identity(), 'chain');
  }
});

test('wallet errors are mapped without leaking provider details and signing has no fallback', async () => {
  for (const [providerCode, expected] of [[4001, 'cancelled'], [4900, 'disconnected'], [4901, 'disconnected'], [4200, 'unsupported'], [-32601, 'unsupported'], [999, 'provider']]) {
    const wallet = createWalletProvider(fakeProvider(async () => { const error = new Error('secret detail'); error.code = providerCode; throw error; }));
    await assert.rejects(wallet.connect(), error => {
      assert.equal(error.code, expected);
      assert.equal(error instanceof WalletBrowserError, true);
      assert.equal(error.message.includes('secret detail'), false);
      return true;
    });
  }
  const provider = fakeProvider(async ({ method }) => method === 'personal_sign' ? '0x1234' : method === 'eth_chainId' ? '0x1' : [ADDRESS]);
  const malformed = createWalletProvider(provider);
  await codeOf(malformed.sign('only this', ADDRESS), 'signature');
  assert.deepEqual(provider.calls.map(call => call.method), ['personal_sign']);
});

test('overlapping operations fail busy and timed out prompts retain the lock until settled', async () => {
  let resolvePrompt;
  const provider = fakeProvider(({ method }) => method === 'eth_requestAccounts'
    ? new Promise(resolve => { resolvePrompt = resolve; })
    : method === 'eth_chainId' ? '0x1' : [ADDRESS]);
  const wallet = createWalletProvider(provider, { timeoutMs: 15 });
  const first = wallet.connect();
  await new Promise(resolve => setTimeout(resolve, 1));
  await codeOf(wallet.identity(), 'busy');
  await codeOf(first, 'timeout');
  await codeOf(wallet.connect(), 'busy');
  assert.equal(provider.calls.filter(call => call.method === 'eth_requestAccounts').length, 1);
  resolvePrompt([ADDRESS]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await wallet.identity(), { address: ADDRESS.toLowerCase(), chainId: 1 });
});

test('subscriptions deliver safe wallet events and cleanup every listener once', () => {
  const provider = fakeProvider();
  const wallet = createWalletProvider(provider);
  const received = [];
  const cleanup = wallet.subscribe(event => received.push(event));
  provider.emit('accountsChanged', [ADDRESS]);
  provider.emit('chainChanged', '0x1');
  provider.emit('disconnect', new Error('private provider detail'));
  assert.deepEqual(received, [
    { type: 'accountsChanged', value: [ADDRESS.toLowerCase()] },
    { type: 'chainChanged', value: '0x1' },
    { type: 'disconnect' },
  ]);
  cleanup(); cleanup();
  assert.deepEqual([...provider.events.values()].map(list => list.length), [0, 0, 0]);
});

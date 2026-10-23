import test from 'node:test';
import assert from 'node:assert/strict';
import { isProxy } from 'node:util/types';
import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { createErc1155Reader, Erc1155ReadError } from '../server/web3/erc1155Reader.mjs';

const RPC_URL = 'https://rpc.example/private/path?key=rpc-secret-sentinel';
const CHAIN_ID = 80002;
const CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
const HOLDER = '0x9876543210abcdef9876543210abcdef98765432';
const HOLDER_2 = '0x1111111111111111111111111111111111111111';
const TOKEN_ID = '42';
const BLOCK_NUMBER = '0x2a';
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const PARENT_HASH = `0x${'cd'.repeat(32)}`;
const TIMESTAMP = '0x65';
const BLOCK = { number: BLOCK_NUMBER, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: TIMESTAMP };
const ERC165_ABI = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)']);
const ERC1155_ABI = parseAbi(['function balanceOf(address account, uint256 id) view returns (uint256)']);
const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const supportsData = interfaceId => encodeFunctionData({ abi: ERC165_ABI,
  functionName: 'supportsInterface', args: [interfaceId] });
const balanceData = (holderAddress, tokenId) => encodeFunctionData({ abi: ERC1155_ABI,
  functionName: 'balanceOf', args: [holderAddress, BigInt(tokenId)] });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function expectFixed(promise, code) {
  return assert.rejects(promise, error => error instanceof Erc1155ReadError && error.name === 'Erc1155ReadError'
    && error.code === code && error.message === `ERC-1155 read: ${code}` && !('cause' in error)
    && !/rpc-secret-sentinel|private\/path/.test(error.message));
}

function standardResult(request) {
  if (request.method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
  if (request.method === 'eth_getBlockByNumber') return BLOCK;
  if (request.method === 'eth_getCode') return '0x60016000';
  if (request.method === 'eth_call') {
    const data = request.params[0].data;
    if (data.startsWith(supportsData('0x01ffc9a7').slice(0, 10))) {
      const { args: [interfaceId] } = decodeFunctionData({ abi: ERC165_ABI, data });
      return word(['0x01ffc9a7', '0xd9b67a26'].includes(interfaceId.toLowerCase()));
    }
    if (data.startsWith(balanceData(HOLDER, TOKEN_ID).slice(0, 10))) {
      const { args: [holderAddress, tokenId] } = decodeFunctionData({ abi: ERC1155_ABI, data });
      if (tokenId === 0n) return word(0n);
      if (tokenId === (1n << 256n) - 1n) return word((1n << 256n) - 1n);
      if (holderAddress.toLowerCase() === HOLDER_2) return word(17n);
      return word(9007199254740993n);
    }
  }
  throw new Error(`Unexpected RPC request: ${request.method}`);
}

function createFetch({ mutate = (_request, result) => result, onRequest = () => {} } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const request = JSON.parse(init.body);
    calls.push({ url: String(url), init, request });
    onRequest(request, calls.length);
    const result = mutate(request, standardResult(request), calls.length);
    return result instanceof Response ? result : response(rpcResult(request.id, result));
  };
  return { calls, fetchFn };
}

function createReader(fetchFn, overrides = {}) {
  return createErc1155Reader({ url: RPC_URL, chainId: CHAIN_ID, contractAddress: CONTRACT,
    fetchFn, ...overrides });
}

function input(overrides = {}) {
  return { holderAddress: HOLDER, tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH, ...overrides };
}

test('reader makes the fixed ERC-165 and balanceOf calls at one explicit canonical block', async () => {
  const { calls, fetchFn } = createFetch();
  const reader = createReader(fetchFn, { contractAddress: `0x${CONTRACT.slice(2).toUpperCase()}` });
  assert.deepEqual(await reader.observeBalance(input()), {
    version: 1, chainId: CHAIN_ID, contractAddress: CONTRACT, tokenId: TOKEN_ID,
    holderAddress: HOLDER, balance: '9007199254740993',
    observedBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: TIMESTAMP },
  });
  assert.deepEqual(calls.map(({ request }) => [request.id, request.method]), [
    [1, 'eth_chainId'], [2, 'eth_getBlockByNumber'], [3, 'eth_getCode'],
    [4, 'eth_call'], [5, 'eth_call'], [6, 'eth_call'], [7, 'eth_call'], [8, 'eth_getBlockByNumber'],
  ]);
  assert.deepEqual(calls.map(({ request }) => request.params), [
    [], [BLOCK_NUMBER, false], [CONTRACT, { blockHash: BLOCK_HASH, requireCanonical: true }],
    [{ to: CONTRACT, data: supportsData('0x01ffc9a7'), gas: '0xea60' },
      { blockHash: BLOCK_HASH, requireCanonical: true }],
    [{ to: CONTRACT, data: supportsData('0xffffffff'), gas: '0xea60' },
      { blockHash: BLOCK_HASH, requireCanonical: true }],
    [{ to: CONTRACT, data: supportsData('0xd9b67a26'), gas: '0xea60' },
      { blockHash: BLOCK_HASH, requireCanonical: true }],
    [{ to: CONTRACT, data: balanceData(HOLDER, TOKEN_ID), gas: '0x30d40' },
      { blockHash: BLOCK_HASH, requireCanonical: true }],
    [BLOCK_NUMBER, false],
  ]);
  assert.ok(calls.every(({ request }) => Object.keys(request).sort().join(',') === 'id,jsonrpc,method,params'));
  assert.ok(calls.every(({ url, init }) => url === RPC_URL && init.redirect === 'error'
    && init.credentials === 'omit' && !Object.keys(init.headers).some(key => key.toLowerCase() === 'authorization')));
  assert.deepEqual(Object.keys(await reader.observeBalance(input())).sort(),
    ['balance', 'chainId', 'contractAddress', 'holderAddress', 'observedBlock', 'tokenId', 'version']);
});

test('configuration rejects unsafe RPC policy, invalid chain, contract and timeout before use', () => {
  for (const options of [
    { url: 'http://rpc.example' },
    { url: 'https://user:pass@rpc.example/path' },
    { url: 'https://rpc.example/path#fragment' },
    { url: 'https://rpc.example/has space' },
    { url: 'https://rpc.example/' + 'x'.repeat(8200) },
    { chainId: 0 }, { chainId: 1.5 }, { chainId: '80002' }, { chainId: 2147483648 },
    { contractAddress: '0x0000000000000000000000000000000000000000' },
    { contractAddress: '0x1234' }, { contractAddress: '0X1234567890abcdef1234567890abcdef12345678' },
    { timeoutMs: 9 }, { timeoutMs: 30001 }, { timeoutMs: 10.5 },
  ]) assert.throws(() => createReader(async () => { throw new Error('must not fetch'); }, options),
    error => error instanceof Erc1155ReadError && error.code === 'configuration'
      && error.message === 'ERC-1155 read: configuration' && !error.message.includes('rpc-secret-sentinel'));
});

test('holder and token inputs normalize and preserve zero and maximum uint256 values exactly', async () => {
  const mixedHolder = '0x9876543210ABCDEF9876543210ABCDEF98765432';
  const max = ((1n << 256n) - 1n).toString();
  const cases = [
    { value: input({ holderAddress: mixedHolder, tokenId: '0', blockNumber: '0x0' }),
      expectedBalance: '0', expectedHolder: HOLDER },
    { value: input({ tokenId: max, blockNumber: `0x${'f'.repeat(64)}` }),
      expectedBalance: max, expectedHolder: HOLDER },
  ];
  for (const item of cases) {
    const { calls, fetchFn } = createFetch({ mutate: (request, result) => request.method === 'eth_getBlockByNumber'
      ? { ...BLOCK, number: item.value.blockNumber } : result });
    const result = await createReader(fetchFn).observeBalance(item.value);
    assert.equal(result.tokenId, item.value.tokenId);
    assert.equal(result.balance, item.expectedBalance);
    assert.equal(result.holderAddress, item.expectedHolder);
    const call = calls.find(({ request }) => request.id === 7).request.params[0];
    assert.equal(call.data, balanceData(item.expectedHolder, item.value.tokenId));
  }
  assert.equal(Number(9007199254740993n), 9007199254740992);
});

test('zero balance is a valid exact observation and makes no claim about token existence or rights', async () => {
  const { fetchFn } = createFetch();
  const result = await createReader(fetchFn).observeBalance(input({ tokenId: '0' }));
  assert.equal(result.balance, '0');
  assert.equal(typeof result.balance, 'string');
  assert.equal(Object.hasOwn(result, 'exists'), false);
  assert.equal(Object.hasOwn(result, 'license'), false);
  assert.equal(Object.hasOwn(result, 'supply'), false);
});

test('exact four own data properties are required and invalid/accessor/proxy inputs fail before fetch', async () => {
  const invalid = [
    input({ holderAddress: '0x0000000000000000000000000000000000000000' }),
    input({ holderAddress: 'not-an-address' }),
    input({ tokenId: 42 }), input({ tokenId: '042' }), input({ tokenId: '-1' }),
    input({ tokenId: ((1n << 256n)).toString() }),
    input({ blockNumber: '0x00' }), input({ blockNumber: '0x' + 'f'.repeat(65) }),
    input({ blockHash: `0x${'0'.repeat(64)}` }), input({ blockHash: 'bad' }),
    { ...input(), extra: true }, { holderAddress: HOLDER, tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER }, null,
  ];
  for (const value of invalid) {
    let calls = 0;
    const reader = createReader(async () => { calls++; return response({}); });
    await expectFixed(reader.observeBalance(value), 'input');
    assert.equal(calls, 0);
  }

  let getterCalls = 0, fetchCalls = 0;
  const accessorInput = { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH };
  Object.defineProperty(accessorInput, 'holderAddress', { enumerable: true,
    get() { getterCalls++; return HOLDER; } });
  const reader = createReader(async () => { fetchCalls++; return response({}); });
  await expectFixed(reader.observeBalance(accessorInput), 'input');
  assert.equal(getterCalls, 0);
  assert.equal(fetchCalls, 0);

  const proxy = new Proxy(input(), { get() { getterCalls++; return HOLDER; } });
  assert.equal(isProxy(proxy), true);
  await expectFixed(reader.observeBalance(proxy), 'input');
  assert.equal(getterCalls, 0);
  assert.equal(fetchCalls, 0);

  const nullPrototype = Object.assign(Object.create(null), input());
  assert.equal((await createReader(async (_url, init) => {
    const request = JSON.parse(init.body);
    return response(rpcResult(request.id, standardResult(request)));
  }).observeBalance(nullPrototype)).balance, '9007199254740993');
});

test('wrong chain stops before requesting a block or contract data', async () => {
  const { calls, fetchFn } = createFetch({ mutate: (request, result) => request.id === 1 ? '0x89' : result });
  await expectFixed(createReader(fetchFn).observeBalance(input()), 'chain');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.method, 'eth_chainId');
});

test('wrong explicit block stops before code lookup; changed block after balance rejects the result', async () => {
  for (const mutate of [
    (request, result) => request.id === 2 ? { ...BLOCK, number: '0x2b' } : result,
    (request, result) => request.id === 2 ? { ...BLOCK, hash: `0x${'ef'.repeat(32)}` } : result,
  ]) {
    const { calls, fetchFn } = createFetch({ mutate });
    await expectFixed(createReader(fetchFn).observeBalance(input()), 'block');
    assert.equal(calls.length, 2);
  }
  const { calls, fetchFn } = createFetch({ mutate: (request, result) =>
    request.id === 8 ? { ...BLOCK, hash: `0x${'ef'.repeat(32)}` } : result });
  await expectFixed(createReader(fetchFn).observeBalance(input()), 'block');
  assert.equal(calls.length, 8);
});

test('contract bytecode must be nonempty hexadecimal code', async () => {
  for (const [result, code] of [['0x', 'contract'], ['0x0', 'response'], ['0xzz', 'response'], ['', 'response']]) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === 3 ? result : value });
    await expectFixed(createReader(fetchFn).observeBalance(input()), code);
    assert.equal(calls.length, 3);
  }
});

test('supportsInterface enforces ERC-165 handshake and rejects malformed bool words', async () => {
  for (const item of [
    { id: 4, result: word(0), count: 4 },
    { id: 5, result: word(1), count: 5 },
    { id: 6, result: word(0), count: 6 },
  ]) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === item.id ? item.result : value });
    await expectFixed(createReader(fetchFn).observeBalance(input()), 'interface');
    assert.equal(calls.length, item.count);
    assert.equal(calls.some(({ request }) => request.id === 7), false);
  }
  for (const malformed of ['0x', `0x${'0'.repeat(63)}2`, `0x01${'0'.repeat(62)}`, 'true']) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === 4 ? malformed : value });
    await expectFixed(createReader(fetchFn).observeBalance(input()), 'response');
    assert.equal(calls.length, 4);
  }
});

test('balance result requires exactly one 32-byte uint256 word', async () => {
  for (const result of [
    '0x', `0x${'0'.repeat(63)}`, `0x${'0'.repeat(65)}`, `0x${'g'.repeat(64)}`, null,
  ]) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === 7 ? result : value });
    await expectFixed(createReader(fetchFn).observeBalance(input()), 'response');
    assert.equal(calls.length, 7);
  }
});

test('RPC failures use fixed redacted errors and bound fetch/body deadlines', async () => {
  for (const body of [
    { jsonrpc: '2.0', id: 1, error: { message: 'rpc-secret-sentinel' } },
    { ...rpcResult(99, `0x${CHAIN_ID.toString(16)}`) },
    { ...rpcResult(1, `0x${CHAIN_ID.toString(16)}`), extra: 'private/path' },
  ]) await expectFixed(createReader(async () => response(body)).observeBalance(input()), 'response');
  await expectFixed(createReader(async () => { throw new Error('rpc-secret-sentinel'); })
    .observeBalance(input()), 'rpc');
  await expectFixed(createReader(() => new Promise(() => {}), { timeoutMs: 20 }).observeBalance(input()), 'rpc');
  const stalled = createReader(async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() {},
  })), { timeoutMs: 20 });
  await expectFixed(stalled.observeBalance(input()), 'rpc');
});

test('concurrent reads and caller mutation preserve each copied holder/token request', async () => {
  const calls = [];
  const reader = createReader(async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push(request);
    return response(rpcResult(request.id, standardResult(request)));
  });
  const firstInput = input({ tokenId: '1' });
  const secondInput = input({ holderAddress: HOLDER_2, tokenId: '2' });
  const firstPromise = reader.observeBalance(firstInput);
  firstInput.holderAddress = HOLDER_2;
  firstInput.tokenId = '999';
  const secondPromise = reader.observeBalance(secondInput);
  secondInput.holderAddress = HOLDER;
  secondInput.tokenId = '888';
  const [first, second] = await Promise.all([
    firstPromise,
    secondPromise,
  ]);
  assert.equal(first.tokenId, '1');
  assert.equal(first.holderAddress, HOLDER);
  assert.equal(first.balance, '9007199254740993');
  assert.equal(second.tokenId, '2');
  assert.equal(second.holderAddress, HOLDER_2);
  assert.equal(second.balance, '17');
  const balanceCalls = calls.filter(request => request.method === 'eth_call'
    && request.params[0].data.startsWith(balanceData(HOLDER, TOKEN_ID).slice(0, 10)));
  assert.equal(balanceCalls.length, 2);
  assert.ok(balanceCalls.some(request => request.params[0].data === balanceData(HOLDER, '1')));
  assert.ok(balanceCalls.some(request => request.params[0].data === balanceData(HOLDER_2, '2')));
  assert.ok(calls.every(({ method }) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)));
  assert.ok(calls.every(({ method }) => method !== 'eth_sendTransaction' && method !== 'eth_sendRawTransaction'));
});

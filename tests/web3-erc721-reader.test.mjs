import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi } from 'viem';
import { createErc721Reader, Erc721ReadError } from '../server/web3/erc721Reader.mjs';

const RPC_URL = 'https://rpc.example/private/path?key=rpc-secret-sentinel';
const CHAIN_ID = 80002;
const CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
const TOKEN_ID = '42';
const BLOCK_NUMBER = '0x2a';
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const PARENT_HASH = `0x${'cd'.repeat(32)}`;
const TIMESTAMP = '0x65';
const OWNER = '0x9876543210abcdef9876543210abcdef98765432';
const ADDRESS_WORD = `0x${'0'.repeat(24)}${OWNER.slice(2)}`;
const BLOCK = { number: BLOCK_NUMBER, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: TIMESTAMP };
const ERC165_ABI = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)']);
const ERC721_ABI = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']);
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const supportsData = (interfaceId) => encodeFunctionData({ abi: ERC165_ABI,
  functionName: 'supportsInterface', args: [interfaceId] });
const ownerData = (tokenId) => encodeFunctionData({ abi: ERC721_ABI,
  functionName: 'ownerOf', args: [BigInt(tokenId)] });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function expectFixed(promise, code) {
  return assert.rejects(promise, error => error instanceof Erc721ReadError && error.name === 'Erc721ReadError'
    && error.code === code && error.message === `ERC-721 read: ${code}` && !('cause' in error)
    && !/rpc-secret-sentinel|private\/path/.test(error.message));
}

function standardResult(request) {
  if (request.method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
  if (request.method === 'eth_getBlockByNumber') return BLOCK;
  if (request.method === 'eth_getCode') return '0x60016000';
  if (request.method === 'eth_call') {
    const data = request.params[0].data;
    if (data.startsWith('0x01ffc9a7')) return word(['01ffc9a7', '80ac58cd'].includes(data.slice(10, 18).toLowerCase()));
    if (data.startsWith('0x6352211e')) return ADDRESS_WORD;
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
  return createErc721Reader({ url: RPC_URL, chainId: CHAIN_ID, contractAddress: CONTRACT,
    fetchFn, ...overrides });
}

test('ERC-721 reader makes only the fixed checks and ownerOf call at one explicit canonical block', async () => {
  const { calls, fetchFn } = createFetch();
  const reader = createReader(fetchFn);
  assert.deepEqual(await reader.observeOwner({ tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), {
    version: 1, chainId: CHAIN_ID, contractAddress: CONTRACT, tokenId: TOKEN_ID,
    ownerAddress: OWNER, observedBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH,
      parentHash: PARENT_HASH, timestamp: TIMESTAMP },
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
    [{ to: CONTRACT, data: supportsData('0x80ac58cd'), gas: '0xea60' },
      { blockHash: BLOCK_HASH, requireCanonical: true }],
    [{ to: CONTRACT, data: ownerData(TOKEN_ID), gas: '0x30d40' },
      { blockHash: BLOCK_HASH, requireCanonical: true }],
    [BLOCK_NUMBER, false],
  ]);
  assert.ok(calls.every(({ request }) => Object.keys(request).sort().join(',') === 'id,jsonrpc,method,params'));
  assert.ok(calls.every(({ url, init }) => url === RPC_URL && init.redirect === 'error'
    && init.credentials === 'omit' && !Object.keys(init.headers).some(key => key.toLowerCase() === 'authorization')));
  assert.deepEqual(Object.keys(await reader.observeOwner({ tokenId: TOKEN_ID,
    blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH })).sort(),
  ['chainId', 'contractAddress', 'observedBlock', 'ownerAddress', 'tokenId', 'version']);
});

test('configuration rejects unsafe RPC policy, invalid chain, and zero or malformed contract before fetch', async () => {
  for (const options of [
    { url: 'http://rpc.example' },
    { url: 'https://user:pass@rpc.example/path' },
    { url: 'https://rpc.example/path#fragment' },
    { url: 'https://rpc.example/has space' },
    { chainId: 0 }, { chainId: 1.5 }, { chainId: '80002' }, { chainId: 2147483648 },
    { contractAddress: '0x0000000000000000000000000000000000000000' },
    { contractAddress: '0x1234' }, { contractAddress: '0X1234567890abcdef1234567890abcdef12345678' },
    { timeoutMs: 9 }, { timeoutMs: 30001 }, { timeoutMs: 10.5 },
  ]) assert.throws(() => createReader(async () => { throw new Error('must not fetch'); }, options),
    error => error instanceof Erc721ReadError && error.code === 'configuration'
      && error.message === 'ERC-721 read: configuration' && !error.message.includes('rpc-secret-sentinel'));
});

test('observeOwner accepts canonical uint256 and explicit nonzero hash inputs only', async () => {
  const invalid = [
    { tokenId: 42, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
    { tokenId: '042', blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
    { tokenId: '-1', blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
    { tokenId: (2n ** 256n).toString(), blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
    { tokenId: TOKEN_ID, blockNumber: '0x00', blockHash: BLOCK_HASH },
    { tokenId: TOKEN_ID, blockNumber: `0x${'f'.repeat(65)}`, blockHash: BLOCK_HASH },
    { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: `0x${'0'.repeat(64)}` },
    { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: 'not-a-hash' },
    { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH, method: 'eth_sendTransaction' },
    { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH, data: '0xdeadbeef' },
  ];
  const max = (2n ** 256n - 1n).toString();
  for (const input of [
    { tokenId: '0', blockNumber: '0x0', blockHash: BLOCK_HASH },
    { tokenId: max, blockNumber: `0x${'f'.repeat(64)}`, blockHash: BLOCK_HASH },
  ]) {
    const { calls, fetchFn } = createFetch({ mutate: (request, result) => request.method === 'eth_getBlockByNumber'
      ? { ...BLOCK, number: input.blockNumber } : result });
    assert.equal((await createReader(fetchFn).observeOwner(input)).tokenId, input.tokenId);
    assert.equal(calls.find(({ request }) => request.id === 7).request.params[0].data, ownerData(input.tokenId));
  }
  for (const input of invalid) {
    let calls = 0;
    const reader = createReader(async () => { calls++; return response({}); });
    await expectFixed(reader.observeOwner(input), 'input');
    assert.equal(calls, 0);
  }
  for (const input of [
    { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH, extra: true },
    { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER },
    null,
  ]) {
    let calls = 0;
    const reader = createReader(async () => { calls++; return response({}); });
    await expectFixed(reader.observeOwner(input), 'input');
    assert.equal(calls, 0);
  }
  let getterCalls = 0, calls = 0;
  const accessorInput = { blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH };
  Object.defineProperty(accessorInput, 'tokenId', { enumerable: true, get() { getterCalls++; return TOKEN_ID; } });
  const reader = createReader(async () => { calls++; return response({}); });
  await expectFixed(reader.observeOwner(accessorInput), 'input');
  assert.equal(getterCalls, 0);
  assert.equal(calls, 0);
  const throwingProxy = new Proxy({}, { getPrototypeOf() { throw new Error('rpc-secret-sentinel'); } });
  await expectFixed(reader.observeOwner(throwingProxy), 'input');
  assert.equal(calls, 0);
});

test('wrong chain stops before any block, contract, or call request', async () => {
  const { calls, fetchFn } = createFetch({ mutate: (request, result) => request.id === 1 ? '0x89' : result });
  await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
    blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'chain');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.method, 'eth_chainId');
});

test('explicit block mismatch stops before contract inspection; final block change rejects the read', async () => {
  for (const mutate of [
    (request, result) => request.id === 2 ? { ...BLOCK, number: '0x2b' } : result,
    (request, result) => request.id === 2 ? { ...BLOCK, hash: `0x${'ef'.repeat(32)}` } : result,
  ]) {
    const { calls, fetchFn } = createFetch({ mutate });
    await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
      blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'block');
    assert.equal(calls.length, 2);
  }
  const { calls, fetchFn } = createFetch({ mutate: (request, result) =>
    request.id === 8 ? { ...BLOCK, hash: `0x${'ef'.repeat(32)}` } : result });
  await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
    blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'block');
  assert.equal(calls.length, 8);
});

test('contract bytecode must be nonempty hexadecimal code', async () => {
  for (const [result, code] of [['0x', 'contract'], ['0x0', 'response'], ['0xzz', 'response'], ['', 'response']]) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === 3 ? result : value });
    await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
      blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), code);
    assert.equal(calls.length, 3);
  }
});

test('supportsInterface validates the ERC-165 handshake and stops before ownerOf on unsupported interfaces', async () => {
  const cases = [
    { id: 4, result: word(0), count: 4 },
    { id: 5, result: word(1), count: 5 },
    { id: 6, result: word(0), count: 6 },
  ];
  for (const item of cases) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === item.id ? item.result : value });
    await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
      blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'interface');
    assert.equal(calls.length, item.count);
    assert.ok(calls.every(({ request }) => request.id !== 7 || request.method !== 'eth_call'));
  }
  for (const malformed of ['0x', `0x${'0'.repeat(63)}2`, `0x01${'0'.repeat(62)}`, 'true']) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === 4 ? malformed : value });
    await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
      blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'response');
    assert.equal(calls.length, 4);
  }
});

test('ownerOf ABI result must be one canonical nonzero address word', async () => {
  for (const result of [
    '0x', `0x${'0'.repeat(23)}1${OWNER.slice(2)}`, `0x${'0'.repeat(64)}${OWNER.slice(2)}`,
    `0x${'0'.repeat(24)}${'0'.repeat(40)}`, `${ADDRESS_WORD}00`, '0x' + 'g'.repeat(64),
  ]) {
    const { calls, fetchFn } = createFetch({ mutate: (request, value) => request.id === 7 ? result : value });
    await expectFixed(createReader(fetchFn).observeOwner({ tokenId: TOKEN_ID,
      blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'response');
    assert.equal(calls.length, 7);
  }
});

test('fixed errors redact RPC details; transport throw and stalled body map to rpc', async () => {
  const malformed = [
    { jsonrpc: '2.0', id: 1, error: { message: 'rpc-secret-sentinel' } },
    { ...rpcResult(99, word(CHAIN_ID)) },
    { ...rpcResult(1, word(CHAIN_ID)), extra: 'private/path' },
  ];
  for (const body of malformed) {
    const reader = createReader(async () => response(body));
    await expectFixed(reader.observeOwner({ tokenId: TOKEN_ID,
      blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'response');
  }
  await expectFixed(createReader(async () => { throw new Error('rpc-secret-sentinel'); })
    .observeOwner({ tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'rpc');
  const stalled = createReader(async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() {},
  })), { timeoutMs: 20 });
  await expectFixed(stalled.observeOwner({ tokenId: TOKEN_ID,
    blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }), 'rpc');
});

test('concurrent observations return token-specific owners and never introduce write methods', async () => {
  const requests = [];
  const reader = createReader(async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    const isOwnerOf = request.method === 'eth_call' && request.params[0].data.startsWith('0x6352211e');
    const token = isOwnerOf ? BigInt(`0x${request.params[0].data.slice(-64)}`) : null;
    const owner = token === 1n ? '0x1111111111111111111111111111111111111111'
      : token === 2n ? '0x2222222222222222222222222222222222222222' : null;
    return response(rpcResult(request.id, owner ? `0x${'0'.repeat(24)}${owner.slice(2)}` : standardResult(request)));
  });
  const [first, second] = await Promise.all([
    reader.observeOwner({ tokenId: '1', blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }),
    reader.observeOwner({ tokenId: '2', blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH }),
  ]);
  assert.equal(first.tokenId, '1');
  assert.equal(second.tokenId, '2');
  assert.equal(first.ownerAddress, '0x1111111111111111111111111111111111111111');
  assert.equal(second.ownerAddress, '0x2222222222222222222222222222222222222222');
  assert.ok(requests.every(({ method }) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)));
  assert.ok(requests.every(({ method }) => method !== 'eth_sendTransaction' && method !== 'eth_sendRawTransaction'));
});

test('request is copied before RPC and all normalized response data discards unrelated fields', async () => {
  const input = { tokenId: TOKEN_ID, blockNumber: BLOCK_NUMBER.toUpperCase().replace('0X', '0x'),
    blockHash: BLOCK_HASH.toUpperCase().replace('0X', '0x') };
  const { calls, fetchFn } = createFetch({
    onRequest(_request, count) {
      if (count === 1) { input.tokenId = '99'; input.blockNumber = 'latest'; input.blockHash = 'bad'; }
    },
    mutate(request, result) {
      if (request.method === 'eth_getBlockByNumber') return { ...BLOCK, hash: inputHashUpper(),
        timestamp: '0x65', untrusted: 'rpc-secret-sentinel' };
      if (request.id === 7) return ADDRESS_WORD.toUpperCase().replace('0X', '0x');
      return result;
    },
  });
  const reader = createReader(fetchFn, { contractAddress: CONTRACT.toUpperCase().replace('0X', '0x') });
  const result = await reader.observeOwner(input);
  assert.equal(result.tokenId, TOKEN_ID);
  assert.equal(result.contractAddress, CONTRACT);
  assert.equal(result.ownerAddress, OWNER);
  assert.deepEqual(result.observedBlock, BLOCK);
  assert.equal(calls.find(({ request }) => request.id === 7).request.params[0].data, ownerData(TOKEN_ID));
  assert.doesNotMatch(JSON.stringify(result), /secret|untrusted/);
});

function inputHashUpper() { return BLOCK_HASH.toUpperCase().replace('0X', '0x'); }

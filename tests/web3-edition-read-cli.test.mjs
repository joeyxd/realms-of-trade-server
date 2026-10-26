import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, parseAbi } from 'viem';

const CLI = fileURLToPath(new URL('../tools/web3-edition-read.mjs', import.meta.url));
const CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
const HOLDER = '0x9876543210abcdef9876543210abcdef98765432';
const HASH = `0x${'ab'.repeat(32)}`, PARENT = `0x${'cd'.repeat(32)}`;
const BLOCK = { number: '0x2a', hash: HASH, parentHash: PARENT, timestamp: '0x65', extra: 'discard-me' };
const MAX = (1n << 256n) - 1n;
const abi = parseAbi(['function balanceOf(address account, uint256 id) view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)']);
const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const baseProcessEnv = () => Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const readerEnv = endpoint => ({ ...baseProcessEnv(), MN_WEB3_RPC_URL: endpoint,
  MN_WEB3_WALLET_CHAIN_ID: '80002', MN_WEB3_WALLET_ENABLED: '0', MN_WEB3_READ_CONTRACT: CONTRACT,
  MN_WEB3_READ_HOLDER: HOLDER, MN_WEB3_READ_TOKEN_ID: MAX.toString(),
  MN_WEB3_READ_BLOCK_NUMBER: '0x2a', MN_WEB3_READ_BLOCK_HASH: HASH });

async function tempDir(t) {
  const path = resolve(await mkdtemp(join(tmpdir(), 'mn-edition-read-cli-')));
  assert.ok(path.startsWith(resolve(tmpdir()) + sep));
  assert.ok(path.split(sep).at(-1).startsWith('mn-edition-read-cli-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function fixtureServer(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const entry = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    requests.push(entry);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(handler(entry, requests.length)));
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  return { requests, endpoint: `http://127.0.0.1:${server.address().port}/rpc?key=rpc-secret-sentinel` };
}
function run(args, cwd, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error('CLI fixture timeout')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', error => { clearTimeout(timer); rejectRun(error); });
    child.once('close', code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}
function rpcResult(body, balance) {
  const result = body.method === 'eth_chainId' ? '0x13882'
    : body.method === 'eth_getBlockByNumber' ? BLOCK
    : body.method === 'eth_getCode' ? '0x60006000'
    : body.id === 7 ? word(balance) : word(body.id !== 5);
  return { jsonrpc: '2.0', id: body.id, result };
}

test('edition CLI needs explicit holder/config; help, arguments and a cwd .env never trigger RPC', async t => {
  const cwd = await tempDir(t), { requests, endpoint } = await fixtureServer(t, () => ({}));
  await writeFile(join(cwd, '.env'), Object.entries(readerEnv(endpoint))
    .filter(([key]) => key.startsWith('MN_WEB3')).map(([key, value]) => `${key}=${value}`).join('\n'));
  const supplied = readerEnv(endpoint);
  const help = await run(['--help'], cwd, supplied);
  assert.equal(help.code, 0); assert.match(help.stdout, /Solo lectura ERC-1155/); assert.equal(help.stderr, '');
  for (const args of [[], ['--read', 'extra'], ['--unknown']]) {
    const result = await run(args, cwd, supplied);
    assert.equal(result.code, 2); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'arguments' });
  }
  const ignored = await run(['--read'], cwd, baseProcessEnv());
  assert.equal(ignored.code, 1); assert.equal(ignored.stdout, '');
  assert.deepEqual(JSON.parse(ignored.stderr), { ok: false, why: 'configuration' });
  for (const invalid of [{ MN_WEB3_WALLET_CHAIN_ID: '080002' }, { MN_WEB3_READ_TOKEN_ID: '042' },
    { MN_WEB3_READ_HOLDER: '' }, { MN_WEB3_READ_HOLDER: `0x${'0'.repeat(40)}` },
    { MN_WEB3_READ_BLOCK_HASH: 'latest' }, { MN_WEB3_READ_BLOCK_NUMBER: '0x02a' }]) {
    const result = await run(['--read'], cwd, { ...supplied, ...invalid });
    assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.ok(['input', 'configuration'].includes(JSON.parse(result.stderr).why));
    assert.doesNotMatch(result.stderr, /rpc-secret|\.env|127\.0\.0\.1/);
  }
  assert.equal(requests.length, 0);
});

test('edition CLI reports uint256 balances including zero exactly, through only hash-bound reads', async t => {
  const cwd = await tempDir(t);
  let balance = MAX;
  const { requests, endpoint } = await fixtureServer(t, ({ body }) => rpcResult(body, balance));
  for (balance of [MAX, 0n]) {
    const result = await run(['--read'], cwd, readerEnv(endpoint));
    assert.equal(result.code, 0); assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { version: 1, chainId: 80002,
      contractAddress: CONTRACT, tokenId: MAX.toString(), holderAddress: HOLDER, balance: balance.toString(),
      observedBlock: { number: '0x2a', hash: HASH, parentHash: PARENT, timestamp: '0x65' } });
    assert.doesNotMatch(result.stdout, /secret|discard-me|127\.0\.0\.1|SUPABASE|exists|supply|rights|ownerAddress/);
    const reads = requests.slice(-8);
    assert.deepEqual(reads.map(({ body }) => body.method), ['eth_chainId', 'eth_getBlockByNumber',
      'eth_getCode', 'eth_call', 'eth_call', 'eth_call', 'eth_call', 'eth_getBlockByNumber']);
    assert.deepEqual(reads.map(({ body }) => body.id), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const { body } of reads.filter(({ body }) => ['eth_getCode', 'eth_call'].includes(body.method))) {
      assert.deepEqual(body.params[1], { blockHash: HASH, requireCanonical: true });
    }
    assert.equal(reads[5].body.params[0].data,
      encodeFunctionData({ abi, functionName: 'supportsInterface', args: ['0xd9b67a26'] }));
    assert.deepEqual(reads[6].body.params[0], { to: CONTRACT,
      data: encodeFunctionData({ abi, functionName: 'balanceOf', args: [HOLDER, MAX] }), gas: '0x30d40' });
  }
  assert.equal(requests.length, 16);
  assert.ok(requests.every(({ headers, url }) => !headers.authorization && !headers.apikey && !headers.cookie
    && url === '/rpc?key=rpc-secret-sentinel'));
});

test('edition CLI preserves uncertainty on RPC rejection or malformed balance without retry/fallback', async t => {
  const cwd = await tempDir(t);
  let mode = 'unsupported';
  const { requests, endpoint } = await fixtureServer(t, ({ body }) => {
    if ((mode === 'unsupported' && body.id === 3) || (mode === 'revert' && body.id === 7)) {
      return { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'rpc-secret-sentinel details' } };
    }
    if (mode === 'malformed' && body.id === 7) return { jsonrpc: '2.0', id: body.id, result: '0x' };
    return rpcResult(body, 0n);
  });
  for (mode of ['unsupported', 'revert', 'malformed']) {
    const before = requests.length, result = await run(['--read'], cwd, readerEnv(endpoint));
    assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'response' });
    assert.equal(requests.length - before, mode === 'unsupported' ? 3 : 7);
    assert.deepEqual(requests.at(-1).body.params[1], { blockHash: HASH, requireCanonical: true });
    assert.doesNotMatch(result.stderr, /secret|details|EIP|127\.0\.0\.1/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, parseAbi } from 'viem';

const CLI = fileURLToPath(new URL('../tools/web3-token-read.mjs', import.meta.url));
const CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
const OWNER = '0x9876543210abcdef9876543210abcdef98765432';
const HASH = `0x${'ab'.repeat(32)}`, PARENT = `0x${'cd'.repeat(32)}`;
const BLOCK = { number: '0x2a', hash: HASH, parentHash: PARENT, timestamp: '0x65', privateExtra: 'discard-me' };
const abi = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)']);
const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const baseProcessEnv = () => Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const readerEnv = endpoint => ({ ...baseProcessEnv(), MN_WEB3_RPC_URL: endpoint,
  MN_WEB3_WALLET_CHAIN_ID: '80002', MN_WEB3_WALLET_ENABLED: '0', MN_WEB3_READ_CONTRACT: CONTRACT,
  MN_WEB3_READ_TOKEN_ID: '42', MN_WEB3_READ_BLOCK_NUMBER: '0x2a', MN_WEB3_READ_BLOCK_HASH: HASH });

async function tempDir(t) {
  const path = resolve(await mkdtemp(join(tmpdir(), 'mn-token-read-cli-')));
  assert.ok(path.startsWith(resolve(tmpdir()) + sep));
  assert.ok(path.split(sep).at(-1).startsWith('mn-token-read-cli-'));
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
    child.once('exit', code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}

test('token CLI help/arguments are inert and a valid cwd .env never enables a read', async t => {
  const cwd = await tempDir(t), { requests, endpoint } = await fixtureServer(t, () => ({}));
  await writeFile(join(cwd, '.env'), Object.entries(readerEnv(endpoint))
    .filter(([key]) => key.startsWith('MN_WEB3')).map(([key, value]) => `${key}=${value}`).join('\n'));
  const supplied = readerEnv(endpoint);
  const help = await run(['--help'], cwd, supplied);
  assert.equal(help.code, 0); assert.match(help.stdout, /Solo lectura ERC-721/); assert.equal(help.stderr, '');
  for (const args of [[], ['--read', 'extra'], ['--unknown']]) {
    const result = await run(args, cwd, supplied);
    assert.equal(result.code, 2); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'arguments' });
  }
  const ignored = await run(['--read'], cwd, baseProcessEnv());
  assert.equal(ignored.code, 1); assert.equal(ignored.stdout, '');
  assert.deepEqual(JSON.parse(ignored.stderr), { ok: false, why: 'configuration' });
  for (const invalid of [{ MN_WEB3_WALLET_CHAIN_ID: '080002' }, { MN_WEB3_READ_TOKEN_ID: '042' },
    { MN_WEB3_READ_BLOCK_HASH: 'latest' }, { MN_WEB3_READ_BLOCK_NUMBER: '0x02a' }]) {
    const result = await run(['--read'], cwd, { ...supplied, ...invalid });
    assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.ok(['input', 'configuration'].includes(JSON.parse(result.stderr).why));
    assert.doesNotMatch(result.stderr, /rpc-secret|\.env|127\.0\.0\.1/);
  }
  assert.equal(requests.length, 0);
});

test('token CLI emits only ownership observation through native loopback RPC, without wallet/SQL activation', async t => {
  const cwd = await tempDir(t);
  const { requests, endpoint } = await fixtureServer(t, ({ body }) => {
    let result;
    if (body.method === 'eth_chainId') result = '0x13882';
    else if (body.method === 'eth_getBlockByNumber') result = BLOCK;
    else if (body.method === 'eth_getCode') result = '0x60006000';
    else if (body.id === 7) result = `0x${'0'.repeat(24)}${OWNER.slice(2)}`;
    else result = word(body.id !== 5);
    return { jsonrpc: '2.0', id: body.id, result };
  });
  const result = await run(['--read'], cwd, readerEnv(endpoint));
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, chainId: 80002,
    contractAddress: CONTRACT, tokenId: '42', ownerAddress: OWNER,
    observedBlock: { number: '0x2a', hash: HASH, parentHash: PARENT, timestamp: '0x65' } });
  assert.equal(requests.length, 8);
  assert.ok(requests.every(({ headers, url, body }) => !headers.authorization && !headers.apikey
    && url === '/rpc?key=rpc-secret-sentinel'
    && ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(body.method)));
  for (const { body } of requests.filter(({ body }) => ['eth_getCode', 'eth_call'].includes(body.method))) {
    assert.deepEqual(body.params[1], { blockHash: HASH, requireCanonical: true });
  }
  assert.equal(requests.find(({ body }) => body.id === 7).body.params[0].data,
    encodeFunctionData({ abi, functionName: 'ownerOf', args: [42n] }));
  assert.doesNotMatch(result.stdout, /secret|privateExtra|discard-me|127\.0\.0\.1|SUPABASE/);
});

test('RPC rejection of a hash-bound call stops CLI without fallback or exposed provider error', async t => {
  const cwd = await tempDir(t);
  const { requests, endpoint } = await fixtureServer(t, ({ body }) => {
    if (body.id === 3) return { jsonrpc: '2.0', id: body.id,
      error: { code: -32602, message: 'EIP-1898 unsupported rpc-secret-sentinel' } };
    return { jsonrpc: '2.0', id: body.id, result: body.id === 1 ? '0x13882' : BLOCK };
  });
  const result = await run(['--read'], cwd, readerEnv(endpoint));
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'response' });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.at(-1).body.params[1], { blockHash: HASH, requireCanonical: true });
  assert.doesNotMatch(result.stderr, /secret|unsupported|EIP|127\.0\.0\.1/);
});

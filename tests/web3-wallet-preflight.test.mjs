import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRpcProbe, RpcProbeError } from '../server/web3/rpcProbe.mjs';
import { runWalletPreflight, WalletPreflightError } from '../server/web3/walletPreflight.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RPC_URL = 'https://rpc.example/private/path?key=rpc-secret-sentinel';
const ORIGIN = 'https://game.example';
const HASH = `0x${'a1'.repeat(32)}`;
const PARENT = `0x${'b2'.repeat(32)}`;
const BLOCK = { number: '0xA', hash: HASH.toUpperCase().replace('0X', '0x'),
  parentHash: PARENT, timestamp: '0xF' };
const baseEnv = () => ({ MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN,
  MN_WEB3_WALLET_CHAIN_ID: '10', MN_WEB3_WALLET_TTL_MS: '300000',
  SUPABASE_URL: 'https://project.example', SUPABASE_PUBLIC_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_KEY: 'service-secret-sentinel', MN_WEB3_RPC_URL: RPC_URL });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function expectFixed(promise, ErrorType, code, prefix) {
  return assert.rejects(promise, error => error instanceof ErrorType && error.code === code
    && error.message === `${prefix}: ${code}` && !('cause' in error));
}

test('RPC probe sends the narrow sequential calls and returns normalized block data only', async () => {
  const calls = [];
  const probe = createRpcProbe({ url: RPC_URL, chainId: 10, fetchFn: async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return response(calls.length === 1 ? rpcResult(1, '0xA') : rpcResult(2, BLOCK));
  } });
  assert.deepEqual(await probe.observe(), { chainId: 10,
    block: { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf' } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.body), [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: ['latest', false] },
  ]);
  assert.ok(calls.every(call => call.url === RPC_URL));
  assert.ok(calls.every(({ init }) => init.redirect === 'error' && init.credentials === 'omit'));
  assert.ok(calls.every(({ init }) => !('Authorization' in init.headers) && !('authorization' in init.headers)));
});

test('RPC chain mismatch stops before requesting a block', async () => {
  const calls = [];
  const probe = createRpcProbe({ url: RPC_URL, chainId: 10, fetchFn: async (_url, init) => {
    calls.push(JSON.parse(init.body)); return response(rpcResult(1, '0x1'));
  } });
  await expectFixed(probe.observe(), RpcProbeError, 'chain', 'RPC probe');
  assert.equal(calls.length, 1);
});

test('RPC envelope, status, JSON, quantities and block fields fail with fixed redacted errors', async () => {
  const invalidResponses = [
    { status: 500, body: rpcResult(1, '0xa'), expected: 'rpc' },
    { status: 200, body: { ...rpcResult(1, '0xa'), extra: 'rpc-secret-sentinel' } },
    { status: 200, body: { ...rpcResult(99, '0xa') } },
    { status: 200, body: { jsonrpc: '2.0', id: 1, error: { message: 'rpc-secret-sentinel' } } },
    { status: 200, body: rpcResult(1, '10') },
    { status: 200, body: rpcResult(1, '0xa'), raw: '{broken rpc-secret-sentinel' },
  ];
  for (const item of invalidResponses) {
    const probe = createRpcProbe({ url: RPC_URL, chainId: 10, fetchFn: async () => item.raw === undefined
      ? response(item.body, item.status) : new Response(item.raw, { status: item.status }) });
    await expectFixed(probe.observe(), RpcProbeError, item.expected ?? 'response', 'RPC probe');
  }
  const padded = createRpcProbe({ url: RPC_URL, chainId: 10, fetchFn: async () => response(rpcResult(1, '0x000a')) });
  await expectFixed(padded.observe(), RpcProbeError, 'response', 'RPC probe');
  for (const block of [null, { ...BLOCK, hash: `0x${'0'.repeat(64)}` },
    { ...BLOCK, parentHash: '0x1234' }, { ...BLOCK, timestamp: '0x' + 'f'.repeat(65) }]) {
    let count = 0;
    const probe = createRpcProbe({ url: RPC_URL, chainId: 10, fetchFn: async () =>
      response(count++ === 0 ? rpcResult(1, '0xa') : rpcResult(2, block)) });
    await expectFixed(probe.observe(), RpcProbeError, 'response', 'RPC probe');
  }
});

test('RPC configuration rejects unsafe endpoints and bounds without revealing endpoint secrets', async () => {
  for (const url of ['http://rpc.example', 'https://user:pass@rpc.example/key?x=secret',
    'https://rpc.example/path#secret', 'https://rpc.example/has space', 'https://rpc.example/' + 'x'.repeat(8200)]) {
    assert.throws(() => createRpcProbe({ url, chainId: 10 }), error => error instanceof RpcProbeError
      && error.code === 'configuration' && error.message === 'RPC probe: configuration'
      && !error.message.includes('secret'));
  }
  for (const chainId of [0, -1, 2147483648, 1.5, '10']) {
    assert.throws(() => createRpcProbe({ url: RPC_URL, chainId }), { code: 'configuration', message: 'RPC probe: configuration' });
  }
  for (const timeoutMs of [9, 30001, 10.5, '100']) {
    assert.throws(() => createRpcProbe({ url: RPC_URL, chainId: 10, timeoutMs }),
      { code: 'configuration', message: 'RPC probe: configuration' });
  }
});

test('RPC probe timeout bounds a fetch implementation that ignores abort', async () => {
  const probe = createRpcProbe({ url: RPC_URL, chainId: 10, timeoutMs: 10,
    fetchFn: () => new Promise(() => {}) });
  await expectFixed(probe.observe(), RpcProbeError, 'rpc', 'RPC probe');
});

test('RPC body byte limit, declared size, invalid UTF-8, and a stalled stream are bounded', async () => {
  const probeFor = fetchFn => createRpcProbe({ url: RPC_URL, chainId: 10, timeoutMs: 1000, fetchFn });
  for (const fetchFn of [
    async () => new Response(new Uint8Array([0xff])),
    async () => new Response('{}', { headers: { 'content-length': '1048577' } }),
    async () => new Response(new Uint8Array(1048577)),
  ]) await expectFixed(probeFor(fetchFn).observe(), RpcProbeError, 'response', 'RPC probe');
  let cancelled = 0;
  const stalled = createRpcProbe({ url: RPC_URL, chainId: 10, timeoutMs: 20,
    fetchFn: async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); },
      cancel() { cancelled++; } })) });
  await expectFixed(stalled.observe(), RpcProbeError, 'rpc', 'RPC probe');
  assert.equal(cancelled, 1);
});

test('native fetch refuses a loopback redirect', async t => {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push(req.url); res.writeHead(302, { location: '/redirect-target' }); res.end(); });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const probe = createRpcProbe({ url: `http://127.0.0.1:${server.address().port}/rpc`, chainId: 10 });
  await expectFixed(probe.observe(), RpcProbeError, 'rpc', 'RPC probe');
  assert.deepEqual(hits, ['/rpc']);
});

test('wallet preflight validates all config before creating the Supabase client', async () => {
  const mutations = [
    env => { delete env.MN_WEB3_WALLET_ENABLED; },
    env => { env.MN_WEB3_WALLET_ENABLED = '0'; },
    env => { env.MN_WEB3_WALLET_ENABLED = 'true'; },
    env => { delete env.MN_WEB3_WALLET_ORIGIN; },
    env => { env.MN_WEB3_WALLET_ORIGIN = 'http://game.example'; },
    env => { env.MN_WEB3_WALLET_CHAIN_ID = '01'; },
    env => { env.MN_WEB3_WALLET_TTL_MS = '29999'; },
    env => { delete env.SUPABASE_URL; },
    env => { env.SUPABASE_URL = 'http://supabase.example'; },
    env => { env.SUPABASE_SERVICE_KEY = env.SUPABASE_PUBLIC_KEY; },
    env => { env.MN_WEB3_RPC_URL = 'http://rpc.example'; },
  ];
  for (const mutate of mutations) {
    const env = baseEnv(); mutate(env); let factories = 0;
    await expectFixed(runWalletPreflight(env, { factory() { factories++; } }),
      WalletPreflightError, 'configuration', 'Wallet preflight');
    assert.equal(factories, 0);
  }
});

test('wallet preflight performs readiness RPC before RPC observation and returns a whitelist', async () => {
  const order = [], rpcCalls = [];
  const result = await runWalletPreflight(baseEnv(), {
    factory(url, key, options) {
      order.push('factory');
      assert.equal(url, 'https://project.example');
      assert.equal(key, 'service-secret-sentinel');
      assert.equal(options.auth.persistSession, false);
      return { async rpc(name, args) { order.push('readiness'); assert.equal(name, 'mn_web3_wallet_ready');
        assert.deepEqual(args, {}); return { data: { version: 1 }, error: null }; } };
    },
    fetchFn: async (_url, init) => { order.push('rpc'); rpcCalls.push(JSON.parse(init.body));
      return response(rpcResult(rpcCalls.length, rpcCalls.length === 1 ? '0xa' : BLOCK)); },
  });
  assert.deepEqual(order, ['factory', 'readiness', 'rpc', 'rpc']);
  assert.deepEqual(result, { version: 1, checks: { walletSql: 'passed', rpc: 'passed' },
    wallet: { origin: ORIGIN, chainId: 10, proof: 'eoa' },
    observedBlock: { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf' } });
  assert.deepEqual(Object.keys(result).sort(), ['checks', 'observedBlock', 'version', 'wallet']);
  assert.doesNotMatch(JSON.stringify(result), /secret|SUPABASE|rpc\.example/i);
});

test('wallet preflight stops before RPC when readiness is unavailable and redacts storage errors', async () => {
  let rpcCalls = 0;
  await expectFixed(runWalletPreflight(baseEnv(), { factory() { return { async rpc() {
    return { data: null, error: new Error('service-secret-sentinel') };
  } }; }, fetchFn: async () => { rpcCalls++; return response({}); } }),
  WalletPreflightError, 'storage', 'Wallet preflight');
  assert.equal(rpcCalls, 0);
});

test('wallet preflight maps RPC errors to fixed redacted diagnostics', async () => {
  await expectFixed(runWalletPreflight(baseEnv(), { factory() { return { async rpc() {
    return { data: { version: 1 }, error: null };
  } }; }, fetchFn: async () => { throw new Error('rpc-secret-sentinel'); } }),
  WalletPreflightError, 'rpc', 'Wallet preflight');
});

test('CLI help is inert and check uses only child environment without loading cwd .env', async (t) => {
  let requests = 0;
  const trap = http.createServer((_req, res) => { requests++; res.end('{}'); });
  await new Promise(resolveListen => trap.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => trap.close(resolveClose)));
  const endpoint = `http://127.0.0.1:${trap.address().port}`;
  const temp = await mkdtemp(join(tmpdir(), 'mn-wallet-preflight-'));
  const tempRoot = resolve(tmpdir()), tempTarget = resolve(temp);
  assert.ok(tempTarget.startsWith(tempRoot + sep));
  assert.ok(tempTarget.split(sep).at(-1).startsWith('mn-wallet-preflight-'));
  t.after(() => rm(tempTarget, { recursive: true, force: true }));
  await writeFile(join(temp, '.env'), [
    'MN_WEB3_WALLET_ENABLED=1', `MN_WEB3_WALLET_ORIGIN=${ORIGIN}`, 'MN_WEB3_WALLET_CHAIN_ID=10',
    `MN_WEB3_RPC_URL=${endpoint}/env-sentinel`, `SUPABASE_URL=${endpoint}`,
    'SUPABASE_PUBLIC_KEY=sb_publishable_test', 'SUPABASE_SERVICE_KEY=service-secret-sentinel', '',
  ].join('\n'));
  const cli = join(ROOT, 'tools', 'web3-wallet-preflight.mjs');
  const run = args => new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: temp, env: { PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.once('error', rejectRun); child.once('exit', code => resolveRun({ code, stdout, stderr }));
  });
  const help = await run(['--help']);
  assert.equal(help.code, 0); assert.ok(help.stdout.length > 0); assert.equal(help.stderr, '');
  const check = await run(['--check']);
  assert.equal(check.code, 1); assert.equal(check.stdout, '');
  assert.deepEqual(JSON.parse(check.stderr), { ok: false, why: 'configuration' });
  assert.doesNotMatch(check.stderr, /env-sentinel|MN_WEB3_RPC_URL|\.env/);
  for (const args of [[], ['--check', 'extra'], ['--unknown']]) {
    const invalid = await run(args); assert.equal(invalid.code, 2); assert.equal(invalid.stdout, '');
  }
  assert.equal(requests, 0);
});

test('CLI --check succeeds against explicit loopback stubs and emits only the result whitelist', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8'); requests.push({ url: req.url, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/rest/v1/rpc/mn_web3_wallet_ready') res.end(JSON.stringify({ version: 1 }));
    else {
      const call = JSON.parse(body);
      res.end(JSON.stringify(rpcResult(call.id, call.method === 'eth_chainId' ? '0xa' : BLOCK)));
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const temp = await mkdtemp(join(tmpdir(), 'mn-wallet-preflight-cli-'));
  const tempTarget = resolve(temp), tempRoot = resolve(tmpdir());
  assert.ok(tempTarget.startsWith(tempRoot + sep));
  assert.ok(tempTarget.split(sep).at(-1).startsWith('mn-wallet-preflight-cli-'));
  t.after(() => rm(tempTarget, { recursive: true, force: true }));
  const port = server.address().port;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    MN_WEB3_WALLET_ENABLED: '1', MN_WEB3_WALLET_ORIGIN: ORIGIN, MN_WEB3_WALLET_CHAIN_ID: '10',
    MN_WEB3_RPC_URL: `http://127.0.0.1:${port}/rpc?key=cli-secret-sentinel`,
    SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_PUBLIC_KEY: 'sb_publishable_cli',
    SUPABASE_SERVICE_KEY: 'service-secret-cli' };
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'web3-wallet-preflight.mjs'), '--check'],
    { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const result = await new Promise((resolveRun, rejectRun) => {
    let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.once('error', rejectRun); child.once('exit', code => resolveRun({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, checks: { walletSql: 'passed', rpc: 'passed' },
    wallet: { origin: ORIGIN, chainId: 10, proof: 'eoa' },
    observedBlock: { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf' } });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, '/rest/v1/rpc/mn_web3_wallet_ready');
  assert.equal(requests[0].headers.authorization, 'Bearer service-secret-cli');
  assert.ok(requests.slice(1).every(item => !item.headers.authorization && !item.headers.apikey));
  assert.doesNotMatch(result.stdout, /secret|supabase|rpc\.example/i);
});

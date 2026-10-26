import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAmoyRpcProbe, AmoyRpcProbeError } from '../server/web3/amoyRpcProbe.mjs';

const CLI = fileURLToPath(new URL('../tools/web3-amoy-check.mjs', import.meta.url));
const RPC_URL = 'https://rpc.example/private/path?key=rpc-secret-sentinel';
const IDENTITY = '0x0000000000000000000000000000000000000004';
const PAYLOAD = '0x00ff0a6d6e2d616d6f792d70726f62652d7631';
const HASH = `0x${'a1'.repeat(32)}`;
const PARENT = `0x${'b2'.repeat(32)}`;
const BLOCK = { number: '0xA', hash: HASH.toUpperCase().replace('0X', '0x'),
  parentHash: PARENT, timestamp: '0xF', privateExtra: 'discard-me' };
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const baseProcessEnv = () => Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function tempDir(t) {
  const path = resolve(await mkdtemp(join(tmpdir(), 'mn-amoy-check-')));
  assert.ok(path.startsWith(resolve(tmpdir()) + sep));
  assert.ok(path.split(sep).at(-1).startsWith('mn-amoy-check-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function fixtureServer(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const entry = { url: req.url, headers: req.headers,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
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
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error('CLI fixture timeout')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', error => { clearTimeout(timer); rejectRun(error); });
    child.once('close', code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}

function probeFor(fetchFn, extra = {}) {
  return createAmoyRpcProbe({ url: RPC_URL, chainId: 80002, fetchFn, ...extra });
}

test('Amoy probe requires chain 80002 and safe shared RPC transport settings', () => {
  assert.throws(() => createAmoyRpcProbe(null), { code: 'configuration', message: 'Amoy RPC probe: configuration' });
  for (const chainId of [1, 137, 0, '80002', 80002.5, undefined]) {
    assert.throws(() => createAmoyRpcProbe({ url: RPC_URL, chainId }), error => error instanceof AmoyRpcProbeError
      && error.code === 'configuration' && error.message === 'Amoy RPC probe: configuration' && !('cause' in error));
  }
  for (const url of ['http://rpc.example', 'https://user:pass@rpc.example/key',
    'https://rpc.example/path#fragment', 'https://rpc.example/has space',
    `https://rpc.example/${'x'.repeat(8200)}`]) {
    assert.throws(() => createAmoyRpcProbe({ url, chainId: 80002 }), error => error instanceof AmoyRpcProbeError
      && error.code === 'configuration' && error.message === 'Amoy RPC probe: configuration');
  }
  assert.doesNotThrow(() => createAmoyRpcProbe({ url: 'https://rpc.example/path', chainId: 80002, timeoutMs: 100 }));
  assert.throws(() => createAmoyRpcProbe({ url: 'https://rpc.example', chainId: 80002, timeoutMs: 30001 }),
    { code: 'configuration', message: 'Amoy RPC probe: configuration' });
});

test('Amoy probe makes the exact five pinned read calls and returns a normalized whitelist', async () => {
  const calls = [];
  const probe = probeFor(async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const body = calls.at(-1).body;
    const result = body.id === 1 ? '0x13882'
      : body.id === 3 ? '0x'
        : body.id === 4 ? PAYLOAD.toUpperCase().replace('0X', '0x') : BLOCK;
    return response(rpcResult(body.id, result));
  });
  assert.deepEqual(await probe.observe(), { v: 1, chainId: 80002,
    observedBlock: { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf' },
    checks: { hashSelectorsAccepted: true, identityEcho: true, blockStable: true }, finalityVerified: false });
  assert.deepEqual(calls.map(({ body }) => body), [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: ['latest', false] },
    { jsonrpc: '2.0', id: 3, method: 'eth_getCode', params: [IDENTITY, { blockHash: HASH, requireCanonical: true }] },
    { jsonrpc: '2.0', id: 4, method: 'eth_call', params: [
      { to: IDENTITY, data: PAYLOAD, gas: '0xea60' }, { blockHash: HASH, requireCanonical: true }] },
    { jsonrpc: '2.0', id: 5, method: 'eth_getBlockByNumber', params: ['0xa', false] },
  ]);
  assert.ok(calls.every(({ url }) => url === RPC_URL));
  assert.ok(calls.every(({ init }) => init.redirect === 'error' && init.credentials === 'omit'
    && !('authorization' in init.headers) && !('Authorization' in init.headers)));
});

test('chain mismatch stops before requesting latest block', async () => {
  const calls = [];
  const probe = probeFor(async (_url, init) => {
    calls.push(JSON.parse(init.body)); return response(rpcResult(1, '0x89'));
  });
  await assert.rejects(probe.observe(), error => error instanceof AmoyRpcProbeError && error.code === 'chain'
    && error.message === 'Amoy RPC probe: chain' && !('cause' in error));
  assert.equal(calls.length, 1);
});

test('malformed blocks, absent block, wrong code or echo fail at their step without fallback', async () => {
  const scenarios = [
    { name: 'malformed latest block', stopAt: 2, result: { ...BLOCK, number: '0xzz' }, code: 'response' },
    { name: 'absent latest block', stopAt: 2, result: null, code: 'response' },
    { name: 'unexpected account code', stopAt: 3, result: '0x6000', code: 'code' },
    { name: 'non-echo response', stopAt: 4, result: '0x00', code: 'identity' },
  ];
  for (const scenario of scenarios) {
    const calls = [];
    const probe = probeFor(async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      if (body.id === scenario.stopAt) return response(rpcResult(body.id, scenario.result));
      return response(rpcResult(body.id, body.id === 1 ? '0x13882'
        : body.id === 3 ? '0x' : body.id === 4 ? PAYLOAD : BLOCK));
    });
    await assert.rejects(probe.observe(), error => error instanceof AmoyRpcProbeError
      && error.code === scenario.code && error.message === `Amoy RPC probe: ${scenario.code}` && !('cause' in error), scenario.name);
    assert.equal(calls.length, scenario.stopAt, scenario.name);
    assert.deepEqual(calls.map(item => item.id), Array.from({ length: scenario.stopAt }, (_v, i) => i + 1));
  }
});

test('last block reread rejects reorg or null and hash RPC rejection never falls back', async () => {
  for (const finalBlock of [{ ...BLOCK, hash: `0x${'c3'.repeat(32)}` },
    { ...BLOCK, number: '0xb' }, { ...BLOCK, parentHash: `0x${'d4'.repeat(32)}` },
    { ...BLOCK, timestamp: '0x10' }, null]) {
    const calls = [];
    const probe = probeFor(async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      const result = body.id === 1 ? '0x13882' : body.id === 3 ? '0x' : body.id === 4 ? PAYLOAD
        : body.id === 5 ? finalBlock : BLOCK;
      return response(rpcResult(body.id, result));
    });
    await assert.rejects(probe.observe(), error => error instanceof AmoyRpcProbeError
      && error.code === (finalBlock ? 'block' : 'response')
      && error.message === `Amoy RPC probe: ${finalBlock ? 'block' : 'response'}` && !('cause' in error));
    assert.equal(calls.length, 5);
    assert.equal(calls.at(-1).method, 'eth_getBlockByNumber');
  }

  const calls = [];
  const rejected = probeFor(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.id === 3) return response({ jsonrpc: '2.0', id: body.id,
      error: { code: -32001, message: 'unknown block rpc-secret-sentinel' } });
    return response(rpcResult(body.id, body.id === 1 ? '0x13882' : BLOCK));
  });
  await assert.rejects(rejected.observe(), error => error instanceof AmoyRpcProbeError && error.code === 'response'
    && error.message === 'Amoy RPC probe: response' && !('cause' in error));
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).method, 'eth_getCode');
  assert.deepEqual(calls.at(-1).params[1], { blockHash: HASH, requireCanonical: true });
});

test('CLI help, invalid arguments, missing env and wrong chain cause no RPC and ignore cwd .env', async t => {
  const cwd = await tempDir(t), { requests, endpoint } = await fixtureServer(t, () => ({}));
  await writeFile(join(cwd, '.env'), `MN_WEB3_RPC_URL=${endpoint}\nMN_WEB3_WALLET_CHAIN_ID=80002\n`);
  const minimal = baseProcessEnv();
  const help = await run(['--help'], cwd, minimal);
  assert.equal(help.code, 0); assert.match(help.stdout, /Diagnostico Amoy solo lectura/); assert.equal(help.stderr, '');
  for (const args of [[], ['--check', 'extra'], ['--unknown']]) {
    const result = await run(args, cwd, minimal);
    assert.equal(result.code, 2); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'arguments' });
  }
  for (const env of [minimal, { ...minimal, MN_WEB3_RPC_URL: endpoint, MN_WEB3_WALLET_CHAIN_ID: '137' }]) {
    const result = await run(['--check'], cwd, env);
    assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'configuration' });
    assert.doesNotMatch(result.stderr, /secret|\.env|127\.0\.0\.1/i);
  }
  assert.equal(requests.length, 0);
});

test('CLI uses native loopback fetch and emits only the reduced diagnostic result', async t => {
  const cwd = await tempDir(t);
  const { requests, endpoint } = await fixtureServer(t, ({ body }) => {
    const result = body.id === 1 ? '0x13882' : body.id === 3 ? '0x'
      : body.id === 4 ? PAYLOAD : BLOCK;
    return rpcResult(body.id, result);
  });
  const env = { ...baseProcessEnv(), MN_WEB3_RPC_URL: endpoint, MN_WEB3_WALLET_CHAIN_ID: '80002' };
  const result = await run(['--check'], cwd, env);
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { v: 1, chainId: 80002,
    observedBlock: { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf' },
    checks: { hashSelectorsAccepted: true, identityEcho: true, blockStable: true }, finalityVerified: false });
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ url, headers }) => url === '/rpc?key=rpc-secret-sentinel'
    && !headers.authorization && !headers.apikey));
  assert.deepEqual(requests.map(({ body }) => body.method), [
    'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBlockByNumber']);
  assert.doesNotMatch(result.stdout, /secret|privateExtra|discard-me|127\.0\.0\.1|SUPABASE/i);
});

test('Amoy probe maps fetch failures and deadlines to fixed errors even when fetch ignores abort', async () => {
  for (const fetchFn of [async () => { throw new Error(RPC_URL); }, () => new Promise(() => {})]) {
    const probe = probeFor(fetchFn, { timeoutMs: 10 });
    await assert.rejects(probe.observe(), error => error instanceof AmoyRpcProbeError
      && error.code === 'rpc' && error.message === 'Amoy RPC probe: rpc' && !('cause' in error));
  }
});

test('CLI hash call rejection stops without fallback and reveals no provider message', async t => {
  const cwd = await tempDir(t);
  const { requests, endpoint } = await fixtureServer(t, ({ body }) => body.id === 4
    ? { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: RPC_URL } }
    : rpcResult(body.id, body.id === 1 ? '0x13882' : body.id === 3 ? '0x' : BLOCK));
  const env = { ...baseProcessEnv(), MN_WEB3_RPC_URL: endpoint, MN_WEB3_WALLET_CHAIN_ID: '80002' };
  const result = await run(['--check'], cwd, env);
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'response' });
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.at(-1).body.params[1], { blockHash: HASH, requireCanonical: true });
  assert.doesNotMatch(result.stderr, /secret|127\.0\.0\.1|rpc\.example/i);
});

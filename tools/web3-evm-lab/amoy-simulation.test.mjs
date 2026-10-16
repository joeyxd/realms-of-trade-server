import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'viem';
import { prepareAmoyDeployment } from './amoyDeployment.mjs';
import { simulateAmoyDeployment, AmoySimulationError } from './amoySimulation.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = fileURLToPath(new URL('./simulate-amoy-deployment.mjs', import.meta.url));
const ALICE = getAddress(`0x${'11'.repeat(20)}`), BOB = getAddress(`0x${'22'.repeat(20)}`);
const PREPARED = prepareAmoyDeployment({ chainId: 80002, deployerAddress: ALICE, mintOperatorAddress: BOB });
const HASH = `0x${'a1'.repeat(32)}`, PARENT = `0x${'b2'.repeat(32)}`;
const BLOCK = { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf', gasLimit: '0x1c9c380' };
const RPC_URL = 'http://127.0.0.1:8545/private?key=rpc-secret-sentinel';
const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const asJson = (body, headers) => response(JSON.stringify(body), 200, headers);
const INPUT = () => ({ chainId: 80002, deployerAddress: ALICE, mintOperatorAddress: BOB, simulationGasLimit: '2000000' });
const ENVELOPE = (id, value) => id === 1 || id === 7 ? result(id, '0x13882')
  : id === 2 || id === 6 ? result(id, value ?? BLOCK)
    : id === 3 ? result(id, '0x2')
      : id === 4 ? result(id, PREPARED.verification.expectedRuntimeBytecode)
        : result(id, '0x50000');

function fakeFetch({ change = {}, onRequest } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), init, body }); onRequest?.(body, calls);
    const override = change[body.id];
    if (override instanceof Error) throw override;
    if (override !== undefined) return typeof override === 'function' ? override(body) : asJson(result(body.id, override));
    const value = body.id === 2 || body.id === 6 ? (change.blockAt?.(body.id) ?? BLOCK) : undefined;
    return asJson(ENVELOPE(body.id, value));
  };
  return { calls, fetchFn };
}
function simulate(fetchFn, input = INPUT(), extraOptions = {}) {
  return simulateAmoyDeployment(input, { url: RPC_URL, fetchFn, ...extraOptions });
}
function expectedTx() {
  return { from: ALICE, data: PREPARED.transaction.data, value: '0x0', gas: '0x1e8480', gasPrice: '0x2' };
}
function testError(promise, why) {
  return assert.rejects(promise, error => error instanceof AmoySimulationError && error.why === why
    && error.message === `Amoy simulation: ${why}` && !('cause' in error));
}
function minEnv(extra = {}) {
  return { ...Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP'].filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]])), ...extra };
}
function runCli(args, cwd, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('simulation CLI timeout')); }, 20000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}
async function tempDir(t, prefix = 'amoy-simulation-') {
  const path = resolve(await mkdtemp(join(tmpdir(), prefix)));
  assert.ok(path.startsWith(resolve(tmpdir()) + sep)); assert.ok(basename(path).startsWith(prefix));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
async function localServer(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); requests.push({ body, url: req.url, headers: req.headers });
    const output = handler(body, requests.length);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(output));
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  return { requests, url: `http://127.0.0.1:${server.address().port}/rpc?key=rpc-secret-sentinel` };
}

test('makes the exact seven Amoy creation simulation requests and reports bounded readiness', async () => {
  const { calls, fetchFn } = fakeFetch();
  const report = await simulate(fetchFn);
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.map(item => [item.body.method, item.body.params]), [
    ['eth_chainId', []], ['eth_getBlockByNumber', ['latest', false]], ['eth_gasPrice', []],
    ['eth_call', [expectedTx(), { blockHash: HASH, requireCanonical: true }]],
    ['eth_estimateGas', [expectedTx(), '0xa']], ['eth_getBlockByNumber', ['0xa', false]], ['eth_chainId', []],
  ]);
  assert.ok(calls.every(({ url, init }) => url === RPC_URL && init.redirect === 'error' && init.credentials === 'omit'
    && init.headers['content-type'] === 'application/json' && !init.headers.authorization));
  assert.equal(report.transaction.data, PREPARED.transaction.data);
  assert.equal(report.transaction.from, ALICE); assert.equal(Object.hasOwn(report.transaction, 'to'), false);
  assert.deepEqual(report.observedBlock, { number: '0xa', hash: HASH, parentHash: PARENT, timestamp: '0xf', gasLimit: '0x1c9c380' });
  assert.deepEqual(report.fees, { simulationGasLimit: '2000000', estimatedGas: '327680', gasPriceWei: '2',
    estimatedFeeWei: '655360', simulationLimitFeeWei: '4000000',
    pricing: 'RPC gasPrice observation; not a transaction fee cap', gasToken: 'POL de prueba' });
  assert.deepEqual(report.readiness, { offlinePrepared: true, rpcSimulated: true, gasEstimated: true,
    signed: false, broadcast: false, deployed: false });
  assert.equal(report.network.networkVerified, false);
  assert.deepEqual(report.simulation, { callSelector: 'blockHash/requireCanonical', estimateSelector: 'blockNumber',
    runtimeMatches: true, returnedRuntimeCodeHash: PREPARED.verification.expectedRuntimeCodeHash,
    blockStable: true, chainMatchedTwice: true, finalityVerified: false });
});

test('rejects input proxies, getters, extra keys, invalid gas bounds, and endpoint configuration before RPC', async () => {
  let calls = 0; const fetchFn = async () => { calls++; throw Error('unexpected'); };
  for (const value of [null, [], { ...INPUT(), extra: 1 }, { ...INPUT(), simulationGasLimit: '0' },
    { ...INPUT(), simulationGasLimit: '52999' }, { ...INPUT(), simulationGasLimit: '30000001' },
    { ...INPUT(), simulationGasLimit: '2e6' }, { ...INPUT(), simulationGasLimit: 2000000 },
    { ...INPUT(), simulationGasLimit: '02000000' }, { ...INPUT(), chainId: '80002' },
    { ...INPUT(), chainId: 137 }, { ...INPUT(), mintOperatorAddress: `0x${'0'.repeat(40)}` },
    { ...INPUT(), deployerAddress: 'bad-address' }]) await testError(simulate(fetchFn, value), 'input');
  let getterCalls = 0; const getter = INPUT();
  Object.defineProperty(getter, 'deployerAddress', { enumerable: true, get() { getterCalls++; return ALICE; } });
  await testError(simulate(fetchFn, getter), 'input'); assert.equal(getterCalls, 0);
  let traps = 0; const proxy = new Proxy(INPUT(), { ownKeys() { traps++; throw Error(); }, getPrototypeOf() { traps++; throw Error(); } });
  await testError(simulate(fetchFn, proxy), 'input'); assert.equal(traps, 0);
  for (const url of ['https://user:pass@host/x', 'https://host/x#fragment', 'http://external.example/rpc', 'http://localhost:80/a b']) {
    await testError(simulate(fetchFn, INPUT(), { url }), 'configuration');
  }
  await testError(simulate(fetchFn, INPUT(), { timeoutMs: 30001 }), 'configuration');
  const optionGetter = { url: RPC_URL };
  Object.defineProperty(optionGetter, 'fetchFn', { get() { getterCalls++; return fetchFn; } });
  await testError(simulateAmoyDeployment(INPUT(), optionGetter), 'configuration');
  const optionProxy = new Proxy({ url: RPC_URL }, { ownKeys() { traps++; throw Error(); } });
  await testError(simulateAmoyDeployment(INPUT(), optionProxy), 'configuration');
  assert.equal(getterCalls, 0); assert.equal(traps, 0);
  assert.equal(calls, 0);
});

test('wrong chain stops before block or simulation calls', async () => {
  const { calls, fetchFn } = fakeFetch({ change: { 1: '0x89' } });
  await testError(simulate(fetchFn), 'chain'); assert.equal(calls.length, 1); assert.equal(calls[0].body.method, 'eth_chainId');
});

test('rejects malformed latest block and gas limit before price or creation calls', async () => {
  for (const block of [null, { ...BLOCK, number: '0x00' }, { ...BLOCK, hash: '0x1234' },
    { ...BLOCK, gasLimit: '0x0' }, { ...BLOCK, gasLimit: '0x1' }]) {
    const { calls, fetchFn } = fakeFetch({ change: { 2: block } });
    await testError(simulate(fetchFn), block?.gasLimit === '0x1' ? 'gas' : 'response');
    assert.equal(calls.length, 2);
  }
});

test('rejects zero gas price and fee multiplication overflow before eth_call', async () => {
  for (const [price, why] of [['0x0', 'gas'], [`0x${'f'.repeat(64)}`, 'gas']]) {
    const { calls, fetchFn } = fakeFetch({ change: { 3: price } });
    await testError(simulate(fetchFn), why); assert.equal(calls.length, 3);
  }
});

test('requires exact runtime bytes from pinned creation eth_call', async () => {
  for (const runtime of ['0x', '0xzz', `0x${'00'.repeat(24)}`]) {
    const { calls, fetchFn } = fakeFetch({ change: { 4: runtime } });
    await testError(simulate(fetchFn), 'runtime'); assert.equal(calls.length, 4);
  }
});

test('rejects estimate zero, below creation minimum, above input cap, and malformed or overflowing quantities', async () => {
  for (const gas of ['0x0', '0xcf07', '0x1e8481', '0x00', `0x1${'0'.repeat(64)}`]) {
    const { calls, fetchFn } = fakeFetch({ change: { 5: gas } });
    await testError(simulate(fetchFn), gas === '0x00' || gas.startsWith('0x1') && gas.length > 66 ? 'response' : 'gas');
    assert.equal(calls.length, 5);
  }
});

test('fee arithmetic remains exact beyond safe integers and normalizes uppercase RPC data', async () => {
  const price = 9007199254740993n;
  const { fetchFn } = fakeFetch({ change: { 3: `0x${price.toString(16)}`,
    4: PREPARED.verification.expectedRuntimeBytecode.toUpperCase().replace('0X', '0x'),
    blockAt: () => ({ ...BLOCK, number: '0xA', hash: HASH.toUpperCase().replace('0X', '0x'),
      extra: 'provider-field-not-for-output' }) } });
  const input = Object.assign(Object.create(null), INPUT());
  const report = await simulate(fetchFn, input);
  assert.equal(report.fees.gasPriceWei, price.toString());
  assert.equal(report.fees.estimatedFeeWei, (327680n * price).toString());
  assert.equal(report.fees.simulationLimitFeeWei, (2000000n * price).toString());
  assert.equal(report.observedBlock.number, '0xa');
  assert.equal(report.observedBlock.hash, HASH);
  assert.equal(Object.hasOwn(report.observedBlock, 'extra'), false);
  for (const field of ['gas', 'gasPrice', 'nonce', 'maxFeePerGas', 'maxPriorityFeePerGas', 'to'])
    assert.equal(Object.hasOwn(report.transaction, field), false);
});

test('malformed envelopes and estimate selector rejection stop without trying latest', async () => {
  for (const envelope of [{ jsonrpc: '2.0', id: 99, result: '0x13882' },
    { jsonrpc: '1.0', id: 1, result: '0x13882' }, ['0x13882'],
    { jsonrpc: '2.0', id: 1, result: '0x13882', error: { message: 'private' } }]) {
    const { calls, fetchFn } = fakeFetch({ change: { 1: () => asJson(envelope) } });
    await testError(simulate(fetchFn), 'response'); assert.equal(calls.length, 1);
  }
  const { calls, fetchFn } = fakeFetch({ change: { 5: body => asJson({ jsonrpc: '2.0', id: body.id,
    error: { code: -32602, message: 'private estimate selector rejection' } }) } });
  await testError(simulate(fetchFn), 'rpc');
  assert.equal(calls.length, 5);
  assert.equal(calls.at(-1).body.params[1], '0xa');
});

test('rejects changed block number, hash, parent, timestamp, or gasLimit after estimate', async () => {
  const changed = [{ ...BLOCK, number: '0xb' }, { ...BLOCK, hash: `0x${'c3'.repeat(32)}` },
    { ...BLOCK, parentHash: `0x${'d4'.repeat(32)}` }, { ...BLOCK, timestamp: '0x10' },
    { ...BLOCK, gasLimit: '0x1c9c381' }];
  for (const value of changed) {
    const { calls, fetchFn } = fakeFetch({ change: { blockAt: id => id === 6 ? value : BLOCK } });
    await testError(simulate(fetchFn), 'block'); assert.equal(calls.length, 6);
  }
});

test('requires final chain identity and rejects RPC errors without fallback or provider details', async () => {
  const { calls, fetchFn } = fakeFetch({ change: { 7: '0x89' } });
  await testError(simulate(fetchFn), 'chain'); assert.equal(calls.length, 7);
  const { calls: failedCalls, fetchFn: failedFetch } = fakeFetch({ change: { 4: body => asJson({ jsonrpc: '2.0', id: body.id,
    error: { code: -32000, message: 'rpc-secret-sentinel private body' } }) } });
  await testError(simulate(failedFetch), 'rpc'); assert.equal(failedCalls.length, 4);
  assert.doesNotMatch(failedCalls.at(-1).init.body, /secret/);
});

test('rejects invalid JSON-RPC envelopes, invalid UTF-8, oversized headers and streamed bodies', async () => {
  const invalid = [
    body => asJson({ jsonrpc: '2.0', id: body.id, result: '0x13882', extra: true }),
    body => response(new Uint8Array([0xff])),
    body => response('{}', 200, { 'content-length': '1048577' }),
    body => response(new Uint8Array(1048577)),
  ];
  for (const failAt of [1, 2, 3, 4]) {
    const { calls, fetchFn } = fakeFetch({ change: { [failAt]: invalid[failAt - 1] } });
    await testError(simulate(fetchFn), 'response'); assert.equal(calls.length, failAt);
  }
});

test('times out when fetch ignores abort and when response body stalls', async () => {
  await testError(simulate(() => new Promise(() => {}), INPUT(), { timeoutMs: 15 }), 'rpc');
  const stalled = () => response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
  await testError(simulate(async (_url, init) => {
    const id = JSON.parse(init.body).id; return id === 1 ? asJson(result(id, '0x13882')) : stalled();
  }, INPUT(), { timeoutMs: 15 }), 'rpc');
});

test('CLI help and argument failures do not contact RPC or expose ambient secrets', async t => {
  const cwd = await tempDir(t), env = minEnv({ MN_WEB3_PRIVATE_KEY: 'dummy-secret-sentinel', PRIVATE_KEY: 'dummy-secret-sentinel' });
  await writeFile(join(cwd, '.env'), `MN_WEB3_WALLET_RPC_URL=${RPC_URL}\nMN_WEB3_WALLET_CHAIN_ID=80002\n`);
  const help = await runCli(['--help'], cwd, env);
  assert.equal(help.code, 0); assert.match(help.stdout, /--simulate/); assert.doesNotMatch(help.stdout, /secret|key|sign/i);
  const noArgs = await runCli([], cwd, env), send = await runCli(['--send'], cwd, env);
  assert.equal(noArgs.code, 2); assert.deepEqual(JSON.parse(noArgs.stderr), { ok: false, why: 'arguments' });
  assert.equal(send.code, 2); assert.deepEqual(JSON.parse(send.stderr), { ok: false, why: 'arguments' });
  assert.doesNotMatch(noArgs.stdout + noArgs.stderr + send.stdout + send.stderr, /secret/);
});

test('CLI succeeds only through explicit loopback configuration and emits no URL or secret', async t => {
  const cwd = await tempDir(t);
  const { requests, url } = await localServer(t, body => ENVELOPE(body.id));
  await writeFile(join(cwd, '.env'), `MN_WEB3_WALLET_RPC_URL=http://127.0.0.1:1/should-not-load\nMN_WEB3_WALLET_CHAIN_ID=137\n`);
  const env = minEnv({ MN_WEB3_WALLET_CHAIN_ID: '80002', MN_WEB3_WALLET_RPC_URL: url,
    MN_WEB3_AMOY_DEPLOYER_ADDRESS: ALICE, MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS: BOB,
    MN_WEB3_AMOY_SIMULATION_GAS_LIMIT: '2000000', MN_WEB3_PRIVATE_KEY: 'dummy-secret-sentinel' });
  const run = await runCli(['--simulate'], cwd, env);
  assert.equal(run.code, 0, run.stderr); assert.equal(run.stderr, '');
  const envelope = JSON.parse(run.stdout); assert.equal(envelope.ok, true);
  assert.equal(envelope.report.readiness.rpcSimulated, true); assert.equal(envelope.report.readiness.signed, false);
  assert.equal(requests.length, 7); assert.deepEqual(requests.map(item => item.body.method),
    ['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_call', 'eth_estimateGas', 'eth_getBlockByNumber', 'eth_chainId']);
  assert.ok(requests.every(item => item.url.startsWith('/rpc?') && !item.headers.authorization));
  assert.doesNotMatch(run.stdout + run.stderr, /secret|127\.0\.0\.1|should-not-load/);
});

test('CLI failure returns only bounded category and does not retry a rejected hash selector', async t => {
  const cwd = await tempDir(t);
  const { requests, url } = await localServer(t, body => body.id === 4
    ? { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'provider private rpc-secret-sentinel' } }
    : ENVELOPE(body.id));
  const env = minEnv({ MN_WEB3_WALLET_CHAIN_ID: '80002', MN_WEB3_WALLET_RPC_URL: url,
    MN_WEB3_AMOY_DEPLOYER_ADDRESS: ALICE, MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS: BOB,
    MN_WEB3_AMOY_SIMULATION_GAS_LIMIT: '2000000' });
  const run = await runCli(['--simulate'], cwd, env);
  assert.equal(run.code, 1); assert.equal(run.stdout, ''); assert.deepEqual(JSON.parse(run.stderr), { ok: false, why: 'rpc' });
  assert.equal(requests.length, 4); assert.equal(requests.at(-1).body.method, 'eth_call');
  assert.deepEqual(requests.at(-1).body.params[1], { blockHash: HASH, requireCanonical: true });
  assert.doesNotMatch(run.stderr, /secret|127\.0\.0\.1|provider/);
});

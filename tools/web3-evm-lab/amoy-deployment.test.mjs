import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeAbiParameters, encodeAbiParameters, getAddress, keccak256, parseAbiParameters } from 'viem';
import { buildAmoyPilot, serializeAmoyPilot } from './amoyPilotBuild.mjs';
import { prepareAmoyDeployment, AmoyDeploymentError } from './amoyDeployment.mjs';
import { createEvmContractFixture } from './evmFixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LAB = fileURLToPath(new URL('.', import.meta.url));
const ARTIFACT_PATH = 'tools/web3-evm-lab/artifacts/amoy-reader-721.json';
const ALICE_LOWER = `0x${'11'.repeat(20)}`;
const BOB_LOWER = `0x${'22'.repeat(20)}`;
const ALICE = getAddress(ALICE_LOWER);
const BOB = getAddress(BOB_LOWER);
const UINT = parseAbiParameters('address');

function input(overrides = {}) {
  return { chainId: 80002, deployerAddress: ALICE_LOWER, mintOperatorAddress: BOB_LOWER, ...overrides };
}

function expectInputError(work) {
  assert.throws(work, error => error instanceof AmoyDeploymentError && error.why === 'input');
}

function minimalEnvironment(extra = {}) {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  return { ...env, ...extra };
}

function runCli(args, env, cwd = ROOT, cli = fileURLToPath(new URL('./prepare-amoy-deployment.mjs', import.meta.url))) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Amoy prepare CLI timeout')); }, 20000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function removeScratch(directory, parent, prefix) {
  const target = resolve(directory), root = resolve(parent);
  assert.ok(target.startsWith(root + sep) && basename(target).startsWith(prefix));
  await rm(target, { recursive: true, force: true });
}

function encodedConstructorAddress(data) {
  const encodedArgs = `0x${data.slice(-64)}`;
  return decodeAbiParameters(UINT, encodedArgs)[0];
}

test('prepares an exact Amoy deployment report with explicit independent deployer and operator', () => {
  const report = prepareAmoyDeployment(input());
  assert.deepEqual(Object.keys(report), ['v', 'purpose', 'network', 'contract', 'artifact', 'transaction', 'verification', 'readiness']);
  assert.equal(report.v, 1);
  assert.equal(report.purpose, 'Amoy ERC-721 deployment review; no game rights');
  assert.deepEqual(report.network, {
    name: 'Polygon Amoy', chainId: 80002, chainIdHex: '0x13882', gasToken: 'POL de prueba', networkVerified: false,
  });
  assert.deepEqual(report.contract, {
    name: 'AmoyReader721Pilot', compilerVersion: report.contract.compilerVersion, evmVersion: 'cancun',
    deployerAddress: ALICE, mintOperatorAddress: BOB, operatorImmutable: true,
  });
  assert.match(report.contract.compilerVersion, /^0\.8\.37\+commit\./);
  assert.equal(report.artifact.path, ARTIFACT_PATH);
  assert.equal(report.artifact.creationBytes, 4591);
  assert.deepEqual(report.transaction, {
    chainId: '0x13882', from: ALICE, data: report.transaction.data, value: '0x0',
  });
  assert.equal(Object.hasOwn(report.transaction, 'to'), false);
  for (const absent of ['gas', 'nonce', 'maxFeePerGas', 'maxPriorityFeePerGas', 'gasPrice']) {
    assert.equal(Object.hasOwn(report.transaction, absent), false);
  }
  assert.deepEqual(report.readiness, {
    offlinePrepared: true, rpcSimulated: false, gasEstimated: false,
    signed: false, broadcast: false, deployed: false,
  });
  assert.equal(report.network.networkVerified, false);
});

test('creation bytes decode to the requested operator and hashes use the stated schemes', () => {
  const report = prepareAmoyDeployment(input());
  const build = buildAmoyPilot();
  assert.equal(report.transaction.data.toLowerCase().startsWith(`0x${build.artifact.evm.bytecode.object}`.toLowerCase()), true);
  assert.equal(report.transaction.data.slice(-64).toLowerCase(), encodeAbiParameters(UINT, [BOB]).slice(2).toLowerCase());
  assert.equal(report.transaction.data, `0x${build.artifact.evm.bytecode.object}${encodeAbiParameters(UINT, [BOB]).slice(2)}`);
  assert.equal(encodedConstructorAddress(report.transaction.data), BOB);
  assert.equal(report.artifact.sha256.replace(/^0x/, '').toLowerCase(),
    createHash('sha256').update(serializeAmoyPilot(build), 'utf8').digest('hex'));
  assert.equal(report.artifact.creationCodeHash.toLowerCase(), keccak256(`0x${build.artifact.evm.bytecode.object}`).toLowerCase());
  assert.equal(report.artifact.creationBytes, build.artifact.evm.bytecode.object.length / 2);
  assert.match(report.verification.expectedRuntimeBytecode, /^0x[0-9a-f]+$/i);
  assert.equal(report.verification.runtimeBytes, report.verification.expectedRuntimeBytecode.slice(2).length / 2);
  assert.equal(report.verification.expectedRuntimeCodeHash.toLowerCase(),
    keccak256(report.verification.expectedRuntimeBytecode).toLowerCase());
});

test('normalizes lowercase addresses, is deterministic, and accepts null-prototype records', () => {
  const lower = input();
  const nullProto = Object.assign(Object.create(null), lower);
  const report = prepareAmoyDeployment(nullProto);
  assert.equal(report.contract.deployerAddress, ALICE);
  assert.equal(report.contract.mintOperatorAddress, BOB);
  assert.equal(prepareAmoyDeployment(input()).transaction.data, report.transaction.data);
  assert.equal(prepareAmoyDeployment(input()).artifact.sha256, report.artifact.sha256);
  const lowercase = '0x52908400098527886e0f7030069857d2e4169ee7';
  const canonical = getAddress(lowercase);
  const first = prepareAmoyDeployment(input({ mintOperatorAddress: lowercase }));
  const second = prepareAmoyDeployment(input({ mintOperatorAddress: canonical }));
  assert.equal(first.contract.mintOperatorAddress, canonical);
  assert.deepEqual(first, second);
});

test('rejects malformed, inherited, extra, missing, and wrong-chain input without evaluating accessors', () => {
  expectInputError(() => prepareAmoyDeployment(null));
  expectInputError(() => prepareAmoyDeployment([]));
  expectInputError(() => prepareAmoyDeployment(new Date()));
  expectInputError(() => prepareAmoyDeployment(Object.assign(Object.create({ inherited: true }), input())));
  expectInputError(() => prepareAmoyDeployment(input({ extra: 'ignored fields must be rejected' })));
  expectInputError(() => prepareAmoyDeployment({ chainId: 80002, deployerAddress: ALICE_LOWER }));
  expectInputError(() => prepareAmoyDeployment(input({ chainId: '80002' })));
  expectInputError(() => prepareAmoyDeployment(input({ chainId: 137 })));
  expectInputError(() => prepareAmoyDeployment(input({ deployerAddress: `0x${'0'.repeat(40)}` })));
  expectInputError(() => prepareAmoyDeployment(input({ mintOperatorAddress: `0x${'0'.repeat(40)}` })));
  const badMixedChecksum = '0x52908400098527886e0F7030069857D2E4169EE7';
  expectInputError(() => prepareAmoyDeployment(input({ deployerAddress: badMixedChecksum })));
  let getterCalls = 0;
  const accessor = input();
  Object.defineProperty(accessor, 'deployerAddress', { enumerable: true, get() { getterCalls += 1; return ALICE_LOWER; } });
  expectInputError(() => prepareAmoyDeployment(accessor));
  assert.equal(getterCalls, 0);
});

test('rejects a Proxy before invoking its traps', () => {
  let trapCalls = 0;
  const proxied = new Proxy(input(), {
    getPrototypeOf() { trapCalls += 1; throw new Error('proxy trap called'); },
    ownKeys() { trapCalls += 1; throw new Error('proxy trap called'); },
    get() { trapCalls += 1; throw new Error('proxy trap called'); },
  });
  expectInputError(() => prepareAmoyDeployment(proxied));
  assert.equal(trapCalls, 0);
});

test('runtime expected by the report matches a real local Amoy-ID EthereumJS deployment', async t => {
  const report = prepareAmoyDeployment(input());
  const build = buildAmoyPilot();
  const ctx = await createEvmContractFixture({ chainId: 80002,
    compilerVersion: build.compilerVersion, evmVersion: 'cancun',
    importedSources: Object.keys(build.standardInput.sources).filter(path => path.startsWith('@openzeppelin/')),
    deployments: [{ kind: 'pilot', artifact: build.artifact, args: [BOB] }],
  });
  t.after(() => ctx.close());
  assert.equal(ctx.simulated, true);
  assert.equal(ctx.chainId, 80002);
  const runtime = await ctx.rpc('eth_getCode', [ctx.contracts.pilot.address,
    { blockHash: ctx.head().hash, requireCanonical: true }]);
  assert.equal(runtime.toLowerCase(), report.verification.expectedRuntimeBytecode.toLowerCase());
  assert.equal(keccak256(runtime).toLowerCase(), report.verification.expectedRuntimeCodeHash.toLowerCase());
  assert.equal(report.network.networkVerified, false);
});

test('CLI prepares offline from minimal env, ignores RPC/key noise and does not load cwd .env', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'amoy-prepare-'));
  t.after(() => removeScratch(scratch, tmpdir(), 'amoy-prepare-'));
  await writeFile(join(scratch, '.env'), [
    'MN_WEB3_WALLET_CHAIN_ID=137', 'MN_WEB3_AMOY_DEPLOYER_ADDRESS=0x0000000000000000000000000000000000000000',
    'MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS=0x0000000000000000000000000000000000000000',
  ].join('\n'), 'utf8');
  const artifactPath = join(ROOT, ARTIFACT_PATH);
  const artifactBefore = await readFile(artifactPath);
  const env = minimalEnvironment({
    MN_WEB3_WALLET_CHAIN_ID: '80002', MN_WEB3_AMOY_DEPLOYER_ADDRESS: ALICE_LOWER,
    MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS: BOB_LOWER,
    MN_WEB3_RPC_URL: 'http://127.0.0.1:1/secret-sentinel',
    MN_WEB3_PRIVATE_KEY: 'dummy-secret-sentinel', PRIVATE_KEY: 'dummy-secret-sentinel',
    DOTENV_CONFIG_PATH: join(scratch, '.env'),
  });
  const result = await runCli(['--prepare'], env, scratch);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(envelope), ['ok', 'report']);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.report.network.chainId, 80002);
  assert.equal(envelope.report.contract.deployerAddress, ALICE);
  assert.equal(envelope.report.contract.mintOperatorAddress, BOB);
  assert.equal(envelope.report.readiness.signed, false);
  assert.doesNotMatch(result.stdout + result.stderr, /unused\.invalid|secret-sentinel|dummy-secret/i);
  assert.deepEqual(await readFile(artifactPath), artifactBefore);
});

test('CLI help and fixed failures preserve argument/config boundaries without leaking secrets', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'amoy-prepare-cli-'));
  t.after(() => removeScratch(scratch, tmpdir(), 'amoy-prepare-cli-'));
  const help = await runCli(['--help'], minimalEnvironment({ MN_WEB3_PRIVATE_KEY: 'help-secret' }), scratch);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--prepare/);
  assert.doesNotMatch(help.stdout + help.stderr, /help-secret|private key|signed/i);
  const badArgs = await runCli(['--broadcast'], minimalEnvironment({ MN_WEB3_PRIVATE_KEY: 'args-secret' }), scratch);
  assert.equal(badArgs.code, 2);
  assert.deepEqual(JSON.parse(badArgs.stderr), { ok: false, why: 'arguments' });
  assert.doesNotMatch(badArgs.stdout + badArgs.stderr, /args-secret/);
  const missing = await runCli(['--prepare'], minimalEnvironment({ MN_WEB3_PRIVATE_KEY: 'missing-secret' }), scratch);
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stderr), { ok: false, why: 'input' });
  const wrongChain = await runCli(['--prepare'], minimalEnvironment({
    MN_WEB3_WALLET_CHAIN_ID: '137', MN_WEB3_AMOY_DEPLOYER_ADDRESS: ALICE_LOWER,
    MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS: BOB_LOWER, MN_WEB3_PRIVATE_KEY: 'wrong-chain-secret',
  }), scratch);
  assert.equal(wrongChain.code, 1);
  assert.deepEqual(JSON.parse(wrongChain.stderr), { ok: false, why: 'input' });
  assert.doesNotMatch(missing.stdout + missing.stderr + wrongChain.stdout + wrongChain.stderr, /secret/);
});

test('offline preparation leaves the delivered source and artifact unchanged', async () => {
  const source = await readFile(join(LAB, 'contracts/AmoyReader721Pilot.sol'));
  const artifact = await readFile(join(LAB, 'artifacts/amoy-reader-721.json'));
  const report = prepareAmoyDeployment(input());
  assert.equal(report.readiness.rpcSimulated, false);
  assert.equal(report.readiness.gasEstimated, false);
  assert.equal(report.readiness.signed, false);
  assert.equal(report.readiness.broadcast, false);
  assert.equal(report.readiness.deployed, false);
  assert.deepEqual(await readFile(join(LAB, 'contracts/AmoyReader721Pilot.sol')), source);
  assert.deepEqual(await readFile(join(LAB, 'artifacts/amoy-reader-721.json')), artifact);
});

test('an isolated altered or missing artifact fails closed with bounded CLI errors', async t => {
  // Copy only the command/module. Forward compilation to the unchanged real build/toolchain.
  // A child directory of the lab resolves its installed dependencies without links or copies.
  const scratch = await mkdtemp(join(LAB, '.amoy-review-test-'));
  t.after(() => removeScratch(scratch, LAB, '.amoy-review-test-'));
  for (const name of ['amoyDeployment.mjs', 'prepare-amoy-deployment.mjs']) {
    await copyFile(join(LAB, name), join(scratch, name));
  }
  await writeFile(join(scratch, 'amoyPilotBuild.mjs'),
    `export { buildAmoyPilot, serializeAmoyPilot } from ${JSON.stringify(pathToFileURL(join(LAB, 'amoyPilotBuild.mjs')).href)};\n`, 'utf8');
  await mkdir(join(scratch, 'artifacts'));
  const copiedArtifact = join(scratch, 'artifacts/amoy-reader-721.json');
  const deliveredBefore = await readFile(join(LAB, 'artifacts/amoy-reader-721.json'));
  await writeFile(copiedArtifact, 'altered-artifact-private-path-sentinel', 'utf8');
  const env = minimalEnvironment({ MN_WEB3_WALLET_CHAIN_ID: '80002',
    MN_WEB3_AMOY_DEPLOYER_ADDRESS: ALICE_LOWER, MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS: BOB_LOWER });
  for (const state of ['altered', 'missing']) {
    if (state === 'missing') await rm(copiedArtifact);
    const result = await runCli(['--prepare'], env, scratch, join(scratch, 'prepare-amoy-deployment.mjs'));
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, why: 'artifact' });
    assert.doesNotMatch(result.stderr, /sentinel|amoy-review-test|ENOENT|Error|C:\\/i);
  }
  assert.deepEqual(await readFile(join(LAB, 'artifacts/amoy-reader-721.json')), deliveredBefore);
});

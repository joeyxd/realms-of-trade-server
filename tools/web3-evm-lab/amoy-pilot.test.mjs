import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import solc from 'solc';
import { buildAmoyPilot, serializeAmoyPilot } from './amoyPilotBuild.mjs';
import { createEvmContractFixture } from './evmFixture.mjs';
import { createErc721Reader } from '../../server/web3/erc721Reader.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const EXPECTED_URI = 'data:application/json;base64,eyJuYW1lIjoiUHJ1ZWJhIGRlIGxlY3RvciBNQVJFQSBORUdSQSAtIEFtb3kiLCJkZXNjcmlwdGlvbiI6IlRva2VuIGV4cGVyaW1lbnRhbCBkZSB0ZXN0bmV0LiBObyByZXByZXNlbnRhIGVxdWlwbywgdGllcnJhLCBsaWNlbmNpYSwgcGFnbyBuaSBwZXJtaXNvIGRlIGp1ZWdvLiJ9';
const ERROR_ABI = parseAbi([
  'error UnsupportedChain(uint256 chainId)',
  'error InvalidMintOperator()',
  'error UnauthorizedMinter(address caller)',
  'error ERC721InvalidReceiver(address receiver)',
  'error Error(string message)',
]);
const INLINE_RECEIVERS = `// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
contract AcceptingReceiver is IERC721Receiver {
  function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
    return IERC721Receiver.onERC721Received.selector;
  }
}
contract RejectingReceiver {
  function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
    return bytes4(0);
  }
}
contract RevertingReceiver {
  function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
    revert("receiver rejected");
  }
}`;

function errorData(error) {
  assert.equal(error?.code, 'revert');
  assert.match(error.returnData, /^0x[0-9a-fA-F]+$/);
  return error.returnData;
}
function decodePilotError(error) {
  return decodeErrorResult({ abi: ERROR_ABI, data: errorData(error) });
}
function event(contract, log) {
  return decodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics });
}

function compileInlineReceivers(build) {
  const standardInput = structuredClone(build.standardInput);
  standardInput.sources['InlineReceivers.sol'] = { content: INLINE_RECEIVERS };
  const output = JSON.parse(solc.compile(JSON.stringify(standardInput)));
  assert.equal((output.errors ?? []).filter(item => item.severity === 'error').length, 0);
  const contracts = output.contracts['InlineReceivers.sol'];
  return { accepting: contracts.AcceptingReceiver, rejecting: contracts.RejectingReceiver,
    reverting: contracts.RevertingReceiver };
}

async function fixture(t, { chainId = 80002, operator = 'bob', extraDeployments = [] } = {}) {
  const build = buildAmoyPilot();
  const ctx = await createEvmContractFixture({ chainId,
    compilerVersion: build.compilerVersion, evmVersion: 'cancun',
    importedSources: Object.keys(build.standardInput.sources).filter(source => source.startsWith('@openzeppelin/')),
    deployments: [
      { kind: 'pilot', artifact: build.artifact, args: [operator === 'zero' ? ZERO_ADDRESS : ctxAddress(operator)] },
      ...extraDeployments,
    ],
  });
  assert.equal(ctx.simulated, true);
  assert.equal(ctx.chainId, chainId);
  t.after(() => ctx.close());
  return { ctx, build };
}
function ctxAddress(name) {
  return ({ alice: `0x${'11'.repeat(20)}`, bob: `0x${'22'.repeat(20)}`, outsider: `0x${'33'.repeat(20)}` })[name];
}

function runCli(env) {
  const cli = fileURLToPath(new URL('../web3-token-read.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--read'], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Amoy pilot reader CLI timeout')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('build is deterministic, complete, and recompiles without import callbacks', () => {
  const first = buildAmoyPilot(), second = buildAmoyPilot();
  assert.equal(serializeAmoyPilot(first), serializeAmoyPilot(second));
  assert.deepEqual(first.sourceHashes, second.sourceHashes);
  assert.equal(readFileSync(new URL('./artifacts/amoy-reader-721.json', import.meta.url), 'utf8'), serializeAmoyPilot(first));
  for (const [source, entry] of Object.entries(first.standardInput.sources)) {
    assert.equal(first.sourceHashes[source], createHash('sha256').update(entry.content, 'utf8').digest('hex'));
  }
  assert.equal(first.targetChainId, 80002);
  assert.equal(first.purpose, 'Amoy ERC-721 reader experiment; no game rights');
  assert.equal(first.standardInput.settings.evmVersion, 'cancun');
  assert.ok(Object.keys(first.standardInput.sources).includes(first.sourceName));
  assert.ok(Object.keys(first.standardInput.sources).some(source => source.startsWith('@openzeppelin/')));
  const output = JSON.parse(solc.compile(JSON.stringify(first.standardInput)));
  assert.equal((output.errors ?? []).filter(item => item.severity === 'error').length, 0);
  assert.deepEqual(output.contracts[first.sourceName][first.contractName], first.artifact);
});

test('ABI exposes only ERC-721, immutable mint operator and constant experimental metadata', () => {
  const { artifact, targetChainId } = buildAmoyPilot();
  const names = artifact.abi.filter(item => item.type === 'function').map(item => item.name);
  assert.deepEqual(names.sort(), ['mint', 'mintOperator', 'AMOY_CHAIN_ID', 'name', 'symbol', 'tokenURI', 'ownerOf', 'balanceOf',
    'approve', 'getApproved', 'setApprovalForAll', 'isApprovedForAll', 'transferFrom', 'safeTransferFrom',
    'safeTransferFrom', 'supportsInterface'].sort());
  assert.equal(artifact.abi.some(item => ['fallback', 'receive'].includes(item.type) || item.stateMutability === 'payable'), false);
  assert.ok(Object.values(artifact.evm.deployedBytecode.immutableReferences).flat().length > 0);
  assert.equal(targetChainId, 80002);
  assert.equal(names.filter(name => name === 'tokenURI').length, 1);
});

test('constructor rejects wrong simulated chains and zero operator with custom errors', async () => {
  const build = buildAmoyPilot();
  for (const chainId of [137, 31337, 1]) {
    await assert.rejects(createEvmContractFixture({ chainId,
      compilerVersion: build.compilerVersion, evmVersion: 'cancun', importedSources: [],
      deployments: [{ kind: 'pilot', artifact: build.artifact, args: [ctxAddress('bob')] }],
    }), error => {
      const decoded = decodePilotError(error);
      assert.equal(decoded.errorName, 'UnsupportedChain');
      assert.equal(decoded.args[0], BigInt(chainId));
      return true;
    });
  }
  await assert.rejects(createEvmContractFixture({ chainId: 80002,
    compilerVersion: build.compilerVersion, evmVersion: 'cancun', importedSources: [],
    deployments: [{ kind: 'pilot', artifact: build.artifact, args: [ZERO_ADDRESS] }],
  }), error => decodePilotError(error).errorName === 'InvalidMintOperator');
});

test('explicit operator is independent of deployer; outsiders and approved accounts cannot mint', async t => {
  const { ctx, build } = await fixture(t, { operator: 'bob' });
  const pilot = ctx.contracts.pilot;
  assert.equal(ctx.simulated, true);
  assert.equal(ctx.chainId, 80002);
  const expectedCode = Buffer.from(build.artifact.evm.deployedBytecode.object, 'hex');
  assert.equal(Object.keys(build.artifact.evm.deployedBytecode.immutableReferences).length, 1);
  for (const reference of Object.values(build.artifact.evm.deployedBytecode.immutableReferences).flat()) {
    assert.equal(reference.length, 32);
    expectedCode.set(Buffer.from(ctx.addresses.bob.slice(2).padStart(64, '0'), 'hex'), reference.start);
  }
  assert.equal(await ctx.rpc('eth_getCode', [pilot.address,
    { blockHash: ctx.head().hash, requireCanonical: true }]), `0x${expectedCode.toString('hex')}`);
  await assert.rejects(ctx.write('pilot', 'mint', [ctx.addresses.alice, 41n], ctx.addresses.alice), error => {
    const decoded = decodePilotError(error);
    return decoded.errorName === 'UnauthorizedMinter' && decoded.args[0].toLowerCase() === ctx.addresses.alice;
  });
  await assert.rejects(ctx.write('pilot', 'mint', [ctx.addresses.alice, 41n], ctx.addresses.outsider), error => {
    const decoded = decodePilotError(error);
    return decoded.errorName === 'UnauthorizedMinter' && decoded.args[0].toLowerCase() === ctx.addresses.outsider;
  });
  const minted = await ctx.write('pilot', 'mint', [ctx.addresses.alice, 40n], ctx.addresses.bob);
  const transfer = minted.logs.map(log => event(pilot, log)).find(item => item.eventName === 'Transfer');
  assert.equal(transfer.args.from.toLowerCase(), ZERO_ADDRESS);
  assert.equal(transfer.args.to.toLowerCase(), ctx.addresses.alice);
  assert.equal(transfer.args.tokenId, 40n);
  await ctx.write('pilot', 'approve', [ctx.addresses.outsider, 40n], ctx.addresses.alice);
  await assert.rejects(ctx.write('pilot', 'mint', [ctx.addresses.bob, 41n], ctx.addresses.outsider), error =>
    decodePilotError(error).errorName === 'UnauthorizedMinter');
  await ctx.write('pilot', 'setApprovalForAll', [ctx.addresses.outsider, true], ctx.addresses.alice);
  await assert.rejects(ctx.write('pilot', 'mint', [ctx.addresses.bob, 42n], ctx.addresses.outsider), error =>
    decodePilotError(error).errorName === 'UnauthorizedMinter');
  const operator = await ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'mintOperator' }), gas: '0x30d40' },
  { blockHash: ctx.head().hash, requireCanonical: true }]);
  assert.equal(operator.slice(-40), ctx.addresses.bob.slice(2).toLowerCase());
});

test('mint duplicate, zero recipient and failed safe receiver revert without changing head or state root', async t => {
  const build = buildAmoyPilot();
  const helpers = compileInlineReceivers(build);
  const { ctx } = await fixture(t, { extraDeployments: [
    { kind: 'rejecting', artifact: helpers.rejecting, args: [] },
  ] });
  await ctx.write('pilot', 'mint', [ctx.addresses.alice, 51n], ctx.addresses.bob);
  for (const [to, tokenId] of [[ctx.addresses.bob, 51n], [ZERO_ADDRESS, 52n], [ctx.contracts.rejecting.address, 53n]]) {
    const beforeRoot = await ctx.stateRoot(), beforeHead = ctx.head();
    await assert.rejects(ctx.write('pilot', 'mint', [to, tokenId], ctx.addresses.bob), error => Boolean(errorData(error)));
    assert.equal(await ctx.stateRoot(), beforeRoot);
    assert.deepEqual(ctx.head(), beforeHead);
  }
});

test('standard approvals authorize transfers and are cleared when the token moves', async t => {
  const { ctx } = await fixture(t);
  const pilot = ctx.contracts.pilot;
  await ctx.write('pilot', 'mint', [ctx.addresses.alice, 61n], ctx.addresses.bob);
  const approved = await ctx.write('pilot', 'approve', [ctx.addresses.outsider, 61n], ctx.addresses.alice);
  assert.ok(approved.logs.map(log => event(pilot, log)).some(item => item.eventName === 'Approval'
    && item.args.approved.toLowerCase() === ctx.addresses.outsider));
  const movedByApproved = await ctx.write('pilot', 'transferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, 61n], ctx.addresses.outsider);
  assert.equal((await ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'getApproved', args: [61n] }), gas: '0x30d40' },
  { blockHash: movedByApproved.block.hash, requireCanonical: true }])).slice(-40), '0'.repeat(40));
  assert.equal((await ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'ownerOf', args: [61n] }), gas: '0x30d40' },
  { blockHash: movedByApproved.block.hash, requireCanonical: true }])).slice(-40), ctx.addresses.bob.slice(2).toLowerCase());
  const rootBeforeStaleApproval = await ctx.stateRoot(), headBeforeStaleApproval = ctx.head();
  await assert.rejects(ctx.write('pilot', 'transferFrom',
    [ctx.addresses.bob, ctx.addresses.alice, 61n], ctx.addresses.outsider), error => error.code === 'revert');
  assert.equal(await ctx.stateRoot(), rootBeforeStaleApproval);
  assert.deepEqual(ctx.head(), headBeforeStaleApproval);
  await ctx.write('pilot', 'setApprovalForAll', [ctx.addresses.outsider, true], ctx.addresses.bob);
  const movedByOperator = await ctx.write('pilot', 'transferFrom',
    [ctx.addresses.bob, ctx.addresses.alice, 61n], ctx.addresses.outsider);
  assert.ok(movedByOperator.logs.map(log => event(pilot, log)).some(item => item.eventName === 'Transfer'));
  assert.equal((await ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'ownerOf', args: [61n] }), gas: '0x30d40' },
  { blockHash: movedByOperator.block.hash, requireCanonical: true }])).slice(-40), ctx.addresses.alice.slice(2).toLowerCase());
  const allApproved = await ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'isApprovedForAll', args: [ctx.addresses.bob, ctx.addresses.outsider] }),
    gas: '0x30d40' }, { blockHash: movedByOperator.block.hash, requireCanonical: true }]);
  assert.equal(allApproved.slice(-1), '1');
});

test('metadata is fixed and experimental; tokenURI reverts for nonexistent IDs', async t => {
  const { ctx } = await fixture(t);
  const pilot = ctx.contracts.pilot;
  const before = await ctx.stateRoot(), head = ctx.head();
  await assert.rejects(ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'tokenURI', args: [999n] }), gas: '0x30d40' },
  { blockHash: head.hash, requireCanonical: true }]), error => Boolean(errorData(error)));
  assert.equal(await ctx.stateRoot(), before);
  assert.deepEqual(ctx.head(), head);
  await ctx.write('pilot', 'mint', [ctx.addresses.alice, 71n], ctx.addresses.bob);
  const mintBlock = ctx.head();
  const readUri = async block => ctx.rpc('eth_call', [{ to: pilot.address,
    data: encodeFunctionData({ abi: pilot.abi, functionName: 'tokenURI', args: [71n] }), gas: '0x30d40' },
  { blockHash: block.hash, requireCanonical: true }]);
  const decodeUri = data => decodeFunctionResult({ abi: pilot.abi, functionName: 'tokenURI', data });
  const uriAtMint = decodeUri(await readUri(mintBlock));
  assert.equal(uriAtMint, EXPECTED_URI);
  const transfer = await ctx.write('pilot', 'transferFrom', [ctx.addresses.alice, ctx.addresses.bob, 71n]);
  assert.equal(decodeUri(await readUri(transfer.block)), uriAtMint);
  const readConstantString = async (functionName, block) => decodeFunctionResult({ abi: pilot.abi, functionName,
    data: await ctx.rpc('eth_call', [{ to: pilot.address,
      data: encodeFunctionData({ abi: pilot.abi, functionName }), gas: '0x30d40' },
    { blockHash: block.hash, requireCanonical: true }]) });
  assert.equal(await readConstantString('name', mintBlock), 'Marea Negra Amoy Reader Test');
  assert.equal(await readConstantString('name', transfer.block), 'Marea Negra Amoy Reader Test');
  assert.equal(await readConstantString('symbol', mintBlock), 'MNTEST');
  assert.equal(await readConstantString('symbol', transfer.block), 'MNTEST');
  const metadataText = Buffer.from(uriAtMint.slice(uriAtMint.indexOf(',') + 1), 'base64').toString('utf8');
  assert.match(metadataText, /Amoy/);
  assert.match(metadataText, /Token experimental/);
  assert.match(metadataText, /No representa equipo, tierra, licencia, pago ni permiso de juego/);
});

test('safe mint accepts an ERC721 receiver and rolls back for a rejecting receiver', async t => {
  const build = buildAmoyPilot();
  const helpers = compileInlineReceivers(build);
  const { ctx } = await fixture(t, { extraDeployments: [
    { kind: 'accepting', artifact: helpers.accepting, args: [] },
    { kind: 'rejecting', artifact: helpers.rejecting, args: [] },
    { kind: 'reverting', artifact: helpers.reverting, args: [] },
  ] });
  const success = await ctx.write('pilot', 'mint', [ctx.contracts.accepting.address, 81n], ctx.addresses.bob);
  assert.ok(success.logs.map(log => event(ctx.contracts.pilot, log)).some(item => item.eventName === 'Transfer'));
  await ctx.write('pilot', 'mint', [ctx.addresses.alice, 83n], ctx.addresses.bob);
  const safeTransfer = await ctx.write('pilot', 'safeTransferFrom',
    [ctx.addresses.alice, ctx.contracts.accepting.address, 83n], ctx.addresses.alice);
  assert.ok(safeTransfer.logs.map(log => event(ctx.contracts.pilot, log)).some(item => item.eventName === 'Transfer'));
  await ctx.write('pilot', 'mint', [ctx.addresses.alice, 85n], ctx.addresses.bob);
  for (const receiver of [ctx.contracts.rejecting, ctx.contracts.reverting]) {
    const root = await ctx.stateRoot(), head = ctx.head();
    await assert.rejects(ctx.write('pilot', 'safeTransferFrom',
      [ctx.addresses.alice, receiver.address, 85n], ctx.addresses.alice), error => Boolean(errorData(error)));
    assert.equal(await ctx.stateRoot(), root);
    assert.deepEqual(ctx.head(), head);
  }
  for (const [receiver, tokenId] of [[ctx.contracts.rejecting, 82n], [ctx.contracts.reverting, 84n]]) {
    const root = await ctx.stateRoot(), head = ctx.head();
    await assert.rejects(ctx.write('pilot', 'mint', [receiver.address, tokenId], ctx.addresses.bob), error => {
      const decoded = decodeErrorResult({ abi: ERROR_ABI, data: errorData(error) });
      if (receiver === ctx.contracts.rejecting) {
        assert.equal(decoded.errorName, 'ERC721InvalidReceiver');
        assert.equal(decoded.args[0].toLowerCase(), receiver.address.toLowerCase());
      } else {
        assert.equal(decoded.errorName, 'Error');
        assert.equal(decoded.args[0], 'receiver rejected');
      }
      return true;
    });
    assert.equal(await ctx.stateRoot(), root);
    assert.deepEqual(ctx.head(), head);
  }
});

test('ERC-721 reader and CLI observe actual ownership by hash without changing fixture state', async t => {
  const { ctx } = await fixture(t);
  const pilot = ctx.contracts.pilot;
  await ctx.write('pilot', 'mint', [ctx.addresses.alice, 91n], ctx.addresses.bob);
  const mintedBlock = ctx.head();
  await ctx.write('pilot', 'transferFrom', [ctx.addresses.alice, ctx.addresses.bob, 91n]);
  const transferredBlock = ctx.head();
  const root = await ctx.stateRoot();
  const url = await ctx.start();
  const reader = createErc721Reader({ url, chainId: 80002, contractAddress: pilot.address });
  assert.equal((await reader.observeOwner({ tokenId: '91', blockNumber: mintedBlock.number, blockHash: mintedBlock.hash })).ownerAddress,
    ctx.addresses.alice.toLowerCase());
  assert.equal((await reader.observeOwner({ tokenId: '91', blockNumber: transferredBlock.number, blockHash: transferredBlock.hash })).ownerAddress,
    ctx.addresses.bob.toLowerCase());
  assert.equal(await ctx.stateRoot(), root);
  const env = Object.fromEntries([
    ...['PATH', 'SystemRoot', 'TEMP', 'TMP'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]),
    ['MN_WEB3_RPC_URL', url], ['MN_WEB3_WALLET_CHAIN_ID', '80002'], ['MN_WEB3_READ_CONTRACT', pilot.address],
    ['MN_WEB3_READ_TOKEN_ID', '91'], ['MN_WEB3_READ_BLOCK_NUMBER', transferredBlock.number],
    ['MN_WEB3_READ_BLOCK_HASH', transferredBlock.hash],
  ]);
  const result = await runCli(env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.chainId, 80002);
  assert.equal(report.ownerAddress, ctx.addresses.bob.toLowerCase());
  assert.deepEqual(report.observedBlock, transferredBlock);
  assert.equal(await ctx.stateRoot(), root);
  assert.equal(ctx.calls.length, 24);
  assert.deepEqual(ctx.calls.map(call => call.method), Array(3).fill([
    'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
    'eth_call', 'eth_call', 'eth_call', 'eth_getBlockByNumber',
  ]).flat());
  assert.doesNotMatch(result.stdout, /127\.0\.0\.1|SUPABASE|secret|private/i);
});

test('mint operator has no seizure privilege and uint256 boundary tokens transfer without remint', async t => {
  const { ctx } = await fixture(t);
  const pilot = ctx.contracts.pilot;
  const max = (1n << 256n) - 1n;
  const view = async (functionName, args) => decodeFunctionResult({ abi: pilot.abi, functionName,
    data: await ctx.rpc('eth_call', [{ to: pilot.address,
      data: encodeFunctionData({ abi: pilot.abi, functionName, args }), gas: '0x30d40' },
    { blockHash: ctx.head().hash, requireCanonical: true }]) });
  for (const tokenId of [0n, max]) {
    await ctx.write('pilot', 'mint', [ctx.addresses.alice, tokenId], ctx.addresses.bob);
    for (const caller of [ctx.addresses.bob, ctx.addresses.outsider]) {
      const root = await ctx.stateRoot(), head = ctx.head();
      await assert.rejects(ctx.write('pilot', 'transferFrom',
        [ctx.addresses.alice, caller, tokenId], caller), error => error.code === 'revert');
      assert.equal(await ctx.stateRoot(), root);
      assert.deepEqual(ctx.head(), head);
    }
    assert.equal(await view('tokenURI', [tokenId]), EXPECTED_URI);
    await ctx.write('pilot', 'transferFrom', [ctx.addresses.alice, ctx.addresses.outsider, tokenId], ctx.addresses.alice);
    const root = await ctx.stateRoot(), head = ctx.head();
    await assert.rejects(ctx.write('pilot', 'mint', [ctx.addresses.alice, tokenId], ctx.addresses.bob), error => error.code === 'revert');
    assert.equal(await ctx.stateRoot(), root);
    assert.deepEqual(ctx.head(), head);
    assert.equal((await view('ownerOf', [tokenId])).toLowerCase(), ctx.addresses.outsider);
  }
  assert.equal(await view('balanceOf', [ctx.addresses.outsider]), 2n);
  assert.equal(await view('balanceOf', [ctx.addresses.alice]), 0n);
  assert.equal(await view('balanceOf', [ctx.addresses.bob]), 0n);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, encodeFunctionData } from 'viem';
import { createErc721Reader, Erc721ReadError } from '../../server/web3/erc721Reader.mjs';
import { createErc1155Reader, Erc1155ReadError } from '../../server/web3/erc1155Reader.mjs';
import { createEvmFixture } from './evmFixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHAIN_ID = 31337;
const MAX_UINT256 = (1n << 256n) - 1n;
function address(value) { return value.toLowerCase(); }

async function fixture(t) {
  const ctx = await createEvmFixture();
  t.after(async () => { await ctx.close(); });
  assert.match(ctx.compilerVersion, /^0\.8\.37\+commit\./);
  assert.equal(ctx.evmVersion, 'cancun');
  assert.ok(ctx.importedSources.includes('@openzeppelin/contracts/token/ERC721/ERC721.sol'));
  assert.ok(ctx.importedSources.includes('@openzeppelin/contracts/token/ERC1155/ERC1155.sol'));
  const url = await ctx.start();
  return { ctx, url };
}

function getMethod(call) { return call.method; }
function getParams(call) { return call.params; }
function errorHas(errorType, code) {
  return error => error instanceof errorType && error.code === code
    && error.message === `${errorType === Erc721ReadError ? 'ERC-721 read' : 'ERC-1155 read'}: ${code}`;
}

function assertReadSequence(calls, start, data, block, contractAddress) {
  const reads = calls.slice(start);
  assert.deepEqual(reads.map(getMethod), [
    'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode',
    'eth_call', 'eth_call', 'eth_call', 'eth_call', 'eth_getBlockByNumber',
  ]);
  assert.deepEqual(getParams(reads[1]), [block.number, false]);
  assert.deepEqual(getParams(reads[2]), [contractAddress, { blockHash: block.hash, requireCanonical: true }]);
  const call = reads[6];
  const params = getParams(call);
  assert.equal(params[0].data, data);
  assert.deepEqual(params[1], { blockHash: block.hash, requireCanonical: true });
  assert.equal(params[1].blockHash.length, 66);
  assert.ok(params[1].blockHash !== `0x${'0'.repeat(64)}`);
  assert.deepEqual(reads.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(reads.every(item => !['eth_sendTransaction', 'eth_sendRawTransaction',
    'personal_sendTransaction', 'eth_signTransaction'].includes(getMethod(item))));
  return reads;
}

function ownerReader(ctx, url, contractAddress) {
  return createErc721Reader({ url, chainId: ctx.chainId, contractAddress });
}
function balanceReader(ctx, url, contractAddress) {
  return createErc1155Reader({ url, chainId: ctx.chainId, contractAddress });
}

function event(contract, log) {
  return decodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics });
}

async function readOwner(ctx, reader, tokenId, block = ctx.head()) {
  return reader.observeOwner({ tokenId: String(tokenId), blockNumber: block.number, blockHash: block.hash });
}
async function readBalance(ctx, reader, holderAddress, tokenId, block = ctx.head()) {
  return reader.observeBalance({ holderAddress, tokenId: String(tokenId),
    blockNumber: block.number, blockHash: block.hash });
}

async function expectWriteRevert(promise) {
  await assert.rejects(promise, error => error?.code === 'revert'
    && typeof error.returnData === 'string' && /^0x[0-9a-fA-F]*$/.test(error.returnData));
}

function childEnv(url, contractAddress, block, extra = {}) {
  return Object.fromEntries([
    ...['PATH', 'SystemRoot', 'TEMP', 'TMP'].filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]]),
    ['MN_WEB3_RPC_URL', url], ['MN_WEB3_WALLET_CHAIN_ID', String(CHAIN_ID)],
    ['MN_WEB3_READ_CONTRACT', contractAddress], ['MN_WEB3_READ_BLOCK_NUMBER', block.number],
    ['MN_WEB3_READ_BLOCK_HASH', block.hash], ['MN_WEB3_READ_TOKEN_ID', String(extra.tokenId ?? 42n)],
    ...(extra.holderAddress ? [['MN_WEB3_READ_HOLDER', extra.holderAddress]] : []),
  ]);
}

function runCli(script, env) {
  const cli = fileURLToPath(new URL(script, import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--read'], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('EVM reader CLI timeout')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('ERC-721 reads actual mint, historical ownership after transfer, and burn history from EVM state', async t => {
  const { ctx, url } = await fixture(t);
  const reader = ownerReader(ctx, url, ctx.contracts.erc721.address);
  const tokenId = 731n;
  const mint = await ctx.write('erc721', 'fixtureMint', [ctx.addresses.alice, tokenId]);
  const mintedBlock = mint.block;
  const mintEvent = mint.logs.map(log => event(ctx.contracts.erc721, log)).find(item => item.eventName === 'Transfer');
  assert.ok(mintEvent);
  assert.equal(address(mintEvent.args.from), '0x0000000000000000000000000000000000000000');
  assert.equal(address(mintEvent.args.to), address(ctx.addresses.alice));
  assert.equal(mintEvent.args.tokenId, tokenId);
  const stateAfterMint = await ctx.stateRoot();
  const beforeCalls = ctx.calls.length;
  const minted = await readOwner(ctx, reader, tokenId, mintedBlock);
  assert.equal(minted.chainId, CHAIN_ID);
  assert.equal(minted.ownerAddress, address(ctx.addresses.alice));
  assert.deepEqual(minted.observedBlock, mintedBlock);
  assert.equal(await ctx.stateRoot(), stateAfterMint);
  assertReadSequence(ctx.calls, beforeCalls,
    encodeFunctionData({ abi: ctx.contracts.erc721.abi, functionName: 'ownerOf', args: [tokenId] }),
    mintedBlock, ctx.contracts.erc721.address);

  const transfer = await ctx.write('erc721', 'transferFrom', [ctx.addresses.alice, ctx.addresses.bob, tokenId]);
  const transferEvent = transfer.logs.map(log => event(ctx.contracts.erc721, log)).find(item => item.eventName === 'Transfer');
  assert.ok(transferEvent);
  assert.equal(address(transferEvent.args.from), address(ctx.addresses.alice));
  assert.equal(address(transferEvent.args.to), address(ctx.addresses.bob));
  assert.equal(transferEvent.args.tokenId, tokenId);
  const afterTransferRoot = await ctx.stateRoot();
  const transferReadStart = ctx.calls.length;
  const current = await readOwner(ctx, reader, tokenId, transfer.block);
  assertReadSequence(ctx.calls, transferReadStart,
    encodeFunctionData({ abi: ctx.contracts.erc721.abi, functionName: 'ownerOf', args: [tokenId] }),
    transfer.block, ctx.contracts.erc721.address);
  const historicalReadStart = ctx.calls.length;
  const historic = await readOwner(ctx, reader, tokenId, mintedBlock);
  assertReadSequence(ctx.calls, historicalReadStart,
    encodeFunctionData({ abi: ctx.contracts.erc721.abi, functionName: 'ownerOf', args: [tokenId] }),
    mintedBlock, ctx.contracts.erc721.address);
  assert.equal(current.ownerAddress, address(ctx.addresses.bob));
  assert.equal(historic.ownerAddress, address(ctx.addresses.alice));
  assert.equal(await ctx.stateRoot(), afterTransferRoot);

  const burn = await ctx.write('erc721', 'fixtureBurn', [tokenId]);
  const afterBurnRoot = await ctx.stateRoot();
  assert.equal(burn.logs.map(log => event(ctx.contracts.erc721, log)).some(item => item.eventName === 'Transfer'), true);
  assert.equal((await readOwner(ctx, reader, tokenId, transfer.block)).ownerAddress, address(ctx.addresses.bob));
  await assert.rejects(readOwner(ctx, reader, tokenId, burn.block), errorHas(Erc721ReadError, 'response'));
  assert.equal(await ctx.stateRoot(), afterBurnRoot);
});

test('ERC-721 reader rejects absent token, wrong standard, no code, noncanonical block, and unknown hash', async t => {
  const { ctx, url } = await fixture(t);
  const reader = ownerReader(ctx, url, ctx.contracts.erc721.address);
  const head = ctx.head();
  const stateBefore = await ctx.stateRoot();
  await assert.rejects(readOwner(ctx, reader, 9001n, head), errorHas(Erc721ReadError, 'response'));

  const wrongType = ownerReader(ctx, url, ctx.contracts.erc1155.address);
  await assert.rejects(readOwner(ctx, wrongType, 1n, head), error => error instanceof Erc721ReadError
    && error.code === 'interface');

  const noCode = ownerReader(ctx, url, ctx.addresses.outsider);
  await assert.rejects(readOwner(ctx, noCode, 1n, head), error => error instanceof Erc721ReadError
    && error.code === 'contract');

  const unknownHash = { ...head, hash: `0x${'ff'.repeat(32)}` };
  const auditStart = ctx.calls.length;
  await assert.rejects(readOwner(ctx, reader, 1n, unknownHash), errorHas(Erc721ReadError, 'block'));
  assert.equal(ctx.calls.length - auditStart, 2);

  const invalidated = { ...head };
  ctx.invalidateBlock(invalidated.hash);
  const noncanonicalStart = ctx.calls.length;
  await assert.rejects(readOwner(ctx, reader, 1n, invalidated), errorHas(Erc721ReadError, 'response'));
  assert.equal(ctx.calls.length - noncanonicalStart, 3);
  assert.equal(await ctx.stateRoot(), stateBefore);
});

test('ERC-1155 reads exact uint256 balances, transfer history, sum, zero, token zero and maximum IDs', async t => {
  const { ctx, url } = await fixture(t);
  const reader = balanceReader(ctx, url, ctx.contracts.erc1155.address);
  const id = 19n, largeAmount = 9007199254740993n, partial = 111n;
  const mint = await ctx.write('erc1155', 'fixtureMint', [ctx.addresses.alice, id, largeAmount]);
  const mintEvent = mint.logs.map(log => event(ctx.contracts.erc1155, log)).find(item => item.eventName === 'TransferSingle');
  assert.ok(mintEvent);
  assert.equal(address(mintEvent.args.from), '0x0000000000000000000000000000000000000000');
  assert.equal(address(mintEvent.args.to), address(ctx.addresses.alice));
  assert.equal(mintEvent.args.id, id);
  assert.equal(mintEvent.args.value, largeAmount);
  const afterMintRoot = await ctx.stateRoot();
  const start = ctx.calls.length;
  const minted = await readBalance(ctx, reader, ctx.addresses.alice, id, mint.block);
  assert.equal(minted.balance, largeAmount.toString());
  assert.equal(minted.holderAddress, address(ctx.addresses.alice));
  assert.equal(await ctx.stateRoot(), afterMintRoot);
  assertReadSequence(ctx.calls, start,
    encodeFunctionData({ abi: ctx.contracts.erc1155.abi, functionName: 'balanceOf', args: [ctx.addresses.alice, id] }),
    mint.block, ctx.contracts.erc1155.address);

  const transfer = await ctx.write('erc1155', 'safeTransferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, id, partial, '0x']);
  const transferEvent = transfer.logs.map(log => event(ctx.contracts.erc1155, log)).find(item => item.eventName === 'TransferSingle');
  assert.ok(transferEvent);
  assert.equal(address(transferEvent.args.from), address(ctx.addresses.alice));
  assert.equal(address(transferEvent.args.to), address(ctx.addresses.bob));
  assert.equal(transferEvent.args.id, id);
  assert.equal(transferEvent.args.value, partial);
  const afterTransferRoot = await ctx.stateRoot();
  const aliceNow = await readBalance(ctx, reader, ctx.addresses.alice, id, transfer.block);
  const bobNow = await readBalance(ctx, reader, ctx.addresses.bob, id, transfer.block);
  const aliceThen = await readBalance(ctx, reader, ctx.addresses.alice, id, mint.block);
  assert.equal(aliceNow.balance, (largeAmount - partial).toString());
  assert.equal(bobNow.balance, partial.toString());
  assert.equal((BigInt(aliceNow.balance) + BigInt(bobNow.balance)).toString(), largeAmount.toString());
  assert.equal(aliceThen.balance, largeAmount.toString());
  assert.equal(await ctx.stateRoot(), afterTransferRoot);

  const zeroToken = await ctx.write('erc1155', 'fixtureMint', [ctx.addresses.alice, 0n, 0n]);
  assert.equal((await readBalance(ctx, reader, ctx.addresses.alice, 0n, zeroToken.block)).balance, '0');
  const maximumToken = await ctx.write('erc1155', 'fixtureMint', [ctx.addresses.bob, MAX_UINT256, MAX_UINT256]);
  const maximum = await readBalance(ctx, reader, ctx.addresses.bob, MAX_UINT256, maximumToken.block);
  assert.equal(maximum.tokenId, MAX_UINT256.toString());
  assert.equal(maximum.balance, MAX_UINT256.toString());
});

test('ERC-1155 reader rejects wrong standard/no code and failed transfers roll back root and head', async t => {
  const { ctx, url } = await fixture(t);
  const reader = balanceReader(ctx, url, ctx.contracts.erc1155.address);
  const head = ctx.head();
  const stateBefore = await ctx.stateRoot();
  const wrongType = balanceReader(ctx, url, ctx.contracts.erc721.address);
  await assert.rejects(readBalance(ctx, wrongType, ctx.addresses.alice, 1n, head), error => error instanceof Erc1155ReadError
    && error.code === 'interface');
  const noCode = balanceReader(ctx, url, ctx.addresses.outsider);
  await assert.rejects(readBalance(ctx, noCode, ctx.addresses.alice, 1n, head), error => error instanceof Erc1155ReadError
    && error.code === 'contract');

  const id = 22n;
  await ctx.write('erc1155', 'fixtureMint', [ctx.addresses.alice, id, 7n]);
  const previousHead = ctx.head(), previousRoot = await ctx.stateRoot();
  await expectWriteRevert(ctx.write('erc1155', 'safeTransferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, id, 8n, '0x']));
  assert.deepEqual(ctx.head(), previousHead);
  assert.equal(await ctx.stateRoot(), previousRoot);

  await expectWriteRevert(ctx.write('erc1155', 'safeTransferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, id, 1n, '0x'], ctx.addresses.outsider));
  assert.deepEqual(ctx.head(), previousHead);
  assert.equal(await ctx.stateRoot(), previousRoot);
  assert.equal((await readBalance(ctx, reader, ctx.addresses.alice, id)).balance, '7');
  assert.equal((await readBalance(ctx, reader, ctx.addresses.bob, id)).balance, '0');
  assert.equal(await ctx.stateRoot(), previousRoot);
  assert.ok(stateBefore !== previousRoot, 'the successful fixture mint should advance state before rollback checks');
});

test('ERC-721 unauthorized transfer reverts without a new fixture block or changed ownership', async t => {
  const { ctx, url } = await fixture(t);
  await ctx.write('erc721', 'fixtureMint', [ctx.addresses.alice, 10n]);
  const block = ctx.head(), rootBefore = await ctx.stateRoot();
  await expectWriteRevert(ctx.write('erc721', 'transferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, 10n], ctx.addresses.outsider));
  assert.deepEqual(ctx.head(), block);
  assert.equal(await ctx.stateRoot(), rootBefore);
  const owner = await readOwner(ctx, ownerReader(ctx, url, ctx.contracts.erc721.address), 10n);
  assert.equal(owner.ownerAddress, ctx.addresses.alice);
  assert.equal(await ctx.stateRoot(), rootBefore);
});

test('RPC fixture rejects writes and unbound block selectors; even a mutating eth_call restores its root', async t => {
  const { ctx, url } = await fixture(t);
  const block = ctx.head(), rootBefore = await ctx.stateRoot();
  const contract = ctx.contracts.erc721;
  const reference = { blockHash: block.hash, requireCanonical: true };
  for (const [method, params, code] of [
    ['eth_sendRawTransaction', ['0xdead'], 'method'],
    ['eth_sendTransaction', [{ to: contract.address }], 'method'],
    ['eth_getCode', [contract.address, block.number], 'input'],
    ['eth_getCode', [contract.address, { blockHash: block.hash, requireCanonical: false }], 'input'],
    ['eth_getCode', [contract.address, { blockHash: `0x${'ab'.repeat(32)}`, requireCanonical: true }], 'block'],
  ]) await assert.rejects(ctx.rpc(method, params), error => error.code === code);
  const mintData = encodeFunctionData({ abi: contract.abi, functionName: 'fixtureMint', args: [ctx.addresses.alice, 999n] });
  assert.equal(await ctx.rpc('eth_call', [{ to: contract.address, data: mintData, gas: '0x30d40' }, reference]), '0x');
  assert.equal(await ctx.stateRoot(), rootBefore);
  assert.deepEqual(ctx.head(), block);
  await assert.rejects(readOwner(ctx, ownerReader(ctx, url, contract.address), 999n), errorHas(Erc721ReadError, 'response'));
  assert.equal(await ctx.stateRoot(), rootBefore);
});

test('ERC-721 and ERC-1155 CLIs read transferred fixture state in separate minimal-env processes', async t => {
  const { ctx, url } = await fixture(t);
  const tokenId = 88n;
  const mint721 = await ctx.write('erc721', 'fixtureMint', [ctx.addresses.alice, tokenId]);
  const transfer721 = await ctx.write('erc721', 'transferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, tokenId]);
  const mint1155 = await ctx.write('erc1155', 'fixtureMint', [ctx.addresses.alice, 7n, 1000n]);
  const transfer1155 = await ctx.write('erc1155', 'safeTransferFrom',
    [ctx.addresses.alice, ctx.addresses.bob, 7n, 333n, '0x']);

  const callsStart = ctx.calls.length;
  const rootBeforeCliReads = await ctx.stateRoot();
  const ownerResult = await runCli('../web3-token-read.mjs', childEnv(url, ctx.contracts.erc721.address,
    transfer721.block, { tokenId }));
  assert.equal(ownerResult.code, 0);
  assert.equal(ownerResult.stderr, '');
  const ownerReport = JSON.parse(ownerResult.stdout);
  assert.equal(ownerReport.ownerAddress, address(ctx.addresses.bob));
  assert.equal(ownerReport.observedBlock.hash, transfer721.block.hash);
  assert.doesNotMatch(ownerResult.stdout, /private|127\.0\.0\.1|SUPABASE|secret/i);

  const editionResult = await runCli('../web3-edition-read.mjs', childEnv(url, ctx.contracts.erc1155.address,
    transfer1155.block, { tokenId: 7n, holderAddress: ctx.addresses.bob }));
  assert.equal(editionResult.code, 0);
  assert.equal(editionResult.stderr, '');
  const editionReport = JSON.parse(editionResult.stdout);
  assert.equal(editionReport.balance, '333');
  assert.equal(editionReport.observedBlock.hash, transfer1155.block.hash);
  assert.doesNotMatch(editionResult.stdout, /private|127\.0\.0\.1|SUPABASE|secret/i);

  const methods = ctx.calls.slice(callsStart).map(getMethod);
  assert.equal(methods.length, 16);
  assert.ok(methods.every(method => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)));
  assert.equal(methods.some(method => method.startsWith('eth_send') || method.startsWith('personal_')), false);
  assert.equal(await ctx.stateRoot(), rootBeforeCliReads);
  assert.equal((await readOwner(ctx, ownerReader(ctx, url, ctx.contracts.erc721.address), tokenId, mint721.block)).ownerAddress,
    address(ctx.addresses.alice));
  assert.equal((await readBalance(ctx, balanceReader(ctx, url, ctx.contracts.erc1155.address),
    ctx.addresses.alice, 7n, mint1155.block)).balance, '1000');
});

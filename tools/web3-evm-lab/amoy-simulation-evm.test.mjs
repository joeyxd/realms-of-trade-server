import test from 'node:test';
import assert from 'node:assert/strict';
import { createVM } from '@ethereumjs/vm';
import { createCustomCommon, Mainnet, Hardfork } from '@ethereumjs/common';
import { createAccount, createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { simulateAmoyDeployment } from './amoySimulation.mjs';

const INPUT = { chainId: 80002, deployerAddress: `0x${'11'.repeat(20)}`,
  mintOperatorAddress: `0x${'22'.repeat(20)}`, simulationGasLimit: '2000000' };
const BLOCK = { number: '0x10', hash: `0x${'a1'.repeat(32)}`, parentHash: `0x${'b2'.repeat(32)}`,
  timestamp: '0x6553f100', gasLimit: '0x1c9c380' };
const quantity = value => `0x${value.toString(16)}`;

async function localCreationRpc(chainId = 80002) {
  const common = createCustomCommon({ name: 'SIMULATED-Amoy-creation-review', chainId },
    Mainnet, { hardfork: Hardfork.Cancun });
  const vm = await createVM({ common });
  const sender = createAddressFromString(INPUT.deployerAddress);
  await vm.stateManager.putAccount(sender, createAccount({ nonce: 7n, balance: 10n ** 24n }));
  const root = () => vm.stateManager.getStateRoot();
  const baseline = await root();
  const calls = [], creations = [];
  const execute = async tx => {
    assert.deepEqual(Object.keys(tx), ['from', 'data', 'value', 'gas', 'gasPrice']);
    assert.equal(tx.from.toLowerCase(), INPUT.deployerAddress);
    assert.equal(tx.value, '0x0');
    const before = await root(), data = hexToBytes(tx.data);
    // Cancun intrinsic gas includes creation, calldata and EIP-3860 initcode words.
    const intrinsic = 53000n + data.reduce((sum, byte) => sum + (byte === 0 ? 4n : 16n), 0n)
      + 2n * BigInt(Math.ceil(data.length / 32));
    try {
      vm.evm.journal.cleanJournal();
      vm.stateManager.originalStorageCache.clear();
      if (BigInt(tx.gas) < intrinsic) throw new Error('Local intrinsic gas');
      const result = await vm.evm.runCall({ caller: sender, value: 0n, data,
        gasLimit: BigInt(tx.gas) - intrinsic, gasPrice: BigInt(tx.gasPrice) });
      await vm.evm.journal.cleanup();
      if (result.execResult.exceptionError) throw new Error('Local constructor revert');
      assert.ok(result.createdAddress);
      const runtime = bytesToHex(result.execResult.returnValue);
      assert.equal(bytesToHex(await vm.stateManager.getCode(result.createdAddress)), runtime);
      const gas = result.execResult.executionGasUsed + intrinsic;
      creations.push({ address: result.createdAddress, runtime, gas });
      return { runtime, gas };
    } finally {
      // Roll back creation, sender nonce and storage even when execution throws.
      await vm.stateManager.setStateRoot(before);
      vm.evm.journal.cleanJournal();
      vm.stateManager.originalStorageCache.clear();
      assert.deepEqual(await root(), before);
    }
  };
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    let result;
    try {
      if (body.method === 'eth_chainId') result = '0x13882'; // Deliberately a fixture claim, not consensus.
      else if (body.method === 'eth_getBlockByNumber') result = BLOCK;
      else if (body.method === 'eth_gasPrice') result = '0x77359400';
      else if (body.method === 'eth_call') {
        assert.deepEqual(body.params[1], { blockHash: BLOCK.hash, requireCanonical: true });
        result = (await execute(body.params[0])).runtime;
      } else if (body.method === 'eth_estimateGas') {
        assert.equal(body.params[1], BLOCK.number);
        // Local execution usage, not a public client's gas estimation algorithm.
        result = quantity((await execute(body.params[0])).gas);
      } else throw new Error('Unexpected local method');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    } catch {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id,
        error: { code: -32000, message: 'Synthetic EVM creation failure' } }));
    }
  };
  return { vm, sender, baseline, root, calls, creations, fetchFn };
}

test('simulation executes actual creation bytecode twice per review without retaining a contract or nonce', async () => {
  const ctx = await localCreationRpc();
  const options = { url: 'http://127.0.0.1/fixture-only', fetchFn: ctx.fetchFn };
  const first = await simulateAmoyDeployment(INPUT, options);
  const second = await simulateAmoyDeployment(INPUT, options);
  assert.deepEqual(first, second);
  assert.equal(ctx.calls.length, 14);
  assert.equal(ctx.creations.length, 4);
  assert.equal(first.verification.expectedRuntimeBytecode, ctx.creations[0].runtime);
  assert.equal(first.fees.estimatedGas, ctx.creations[1].gas.toString());
  assert.ok(BigInt(first.fees.estimatedGas) > 800000n);
  assert.equal(first.fees.estimatedFeeWei, (ctx.creations[1].gas * 2000000000n).toString());
  assert.equal(first.network.networkVerified, false);
  assert.equal(first.readiness.deployed, false);
  assert.deepEqual(await ctx.root(), ctx.baseline);
  const account = await ctx.vm.stateManager.getAccount(ctx.sender);
  assert.equal(account.nonce, 7n);
  assert.equal(account.balance, 10n ** 24n);
  for (const creation of ctx.creations) {
    assert.equal((await ctx.vm.stateManager.getCode(creation.address)).length, 0);
  }
});

test('a constructor running on a wrong simulated chain fails despite the RPC reporting Amoy', async () => {
  const ctx = await localCreationRpc(137);
  await assert.rejects(simulateAmoyDeployment(INPUT, { url: 'http://127.0.0.1/fixture-only', fetchFn: ctx.fetchFn }),
    { why: 'rpc', message: 'Amoy simulation: rpc' });
  assert.equal(ctx.calls.length, 4);
  assert.equal(ctx.creations.length, 0);
  assert.deepEqual(await ctx.root(), ctx.baseline);
  assert.equal((await ctx.vm.stateManager.getAccount(ctx.sender)).nonce, 7n);
});

test('insufficient creation gas stops before estimation and retains the local sender state', async () => {
  const ctx = await localCreationRpc();
  await assert.rejects(simulateAmoyDeployment({ ...INPUT, simulationGasLimit: '53000' },
    { url: 'http://127.0.0.1/fixture-only', fetchFn: ctx.fetchFn }), { why: 'rpc' });
  assert.equal(ctx.calls.length, 4);
  assert.equal(ctx.creations.length, 0);
  assert.deepEqual(await ctx.root(), ctx.baseline);
});

// Fixed creation simulation only. No wallet, arbitrary RPC method, state override or submission API.
import { isProxy } from 'node:util/types';
import { keccak256 } from 'viem';
import { prepareAmoyDeployment, AmoyDeploymentError } from './amoyDeployment.mjs';
import { rpcQuantity, rpcBlock, RpcProbeError } from '../../server/web3/rpcTransport.mjs';

const MAX_BYTES = 1048576;
const UINT256_MAX = (1n << 256n) - 1n;
const FIELDS = ['chainId', 'deployerAddress', 'mintOperatorAddress', 'simulationGasLimit'];

export class AmoySimulationError extends Error {
  constructor(why) {
    super(`Amoy simulation: ${why}`);
    this.name = 'AmoySimulationError';
    this.why = why;
  }
}
const fail = why => { throw new AmoySimulationError(why); };

function record(input, allowed, required, why) {
  if (!input || typeof input !== 'object' || isProxy(input)) fail(why);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) fail(why);
  const keys = Reflect.ownKeys(input);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !keys.includes(key))) fail(why);
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(why);
    values[key] = descriptor.value;
  }
  return values;
}

function transport(options) {
  const values = record(options, ['url', 'timeoutMs', 'fetchFn'], ['url'], 'configuration');
  const { url, timeoutMs = 10000, fetchFn = fetch } = values;
  let endpoint;
  try {
    if (typeof url !== 'string' || !url || url.length > 8192 || /\s/.test(url)) fail('configuration');
    endpoint = new URL(url);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash
      || (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) fail('configuration');
  } catch { fail('configuration'); }
  if (typeof fetchFn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000)
    fail('configuration');

  const request = async (method, params, id) => {
    const abort = new AbortController(); let timer;
    try {
      const work = (async () => {
        const response = await fetchFn(endpoint.href, { method: 'POST', redirect: 'error', credentials: 'omit',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: abort.signal });
        if (abort.signal.aborted || !response?.ok || !response.body
          || typeof response.body.getReader !== 'function') fail('rpc');
        const length = response.headers?.get('content-length');
        if (length !== undefined && length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('response');
        const reader = response.body.getReader();
        const cancel = () => { reader.cancel().catch(() => {}); };
        abort.signal.addEventListener('abort', cancel, { once: true });
        try {
          const parts = []; let size = 0;
          while (true) {
            if (abort.signal.aborted) fail('rpc');
            const { value, done } = await reader.read();
            if (abort.signal.aborted) fail('rpc');
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) fail('response');
            parts.push(value);
          }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
          let body;
          try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
          catch { fail('response'); }
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3
            || body.jsonrpc !== '2.0' || body.id !== id) fail('response');
          if (Object.hasOwn(body, 'error')) fail('rpc');
          if (!Object.hasOwn(body, 'result')) fail('response');
          return body.result;
        } finally {
          abort.signal.removeEventListener('abort', cancel);
          cancel();
          reader.releaseLock();
        }
      })();
      return await Promise.race([work, new Promise((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new AmoySimulationError('rpc')); }, timeoutMs);
      })]);
    } catch (error) {
      if (error instanceof AmoySimulationError && ['response', 'rpc'].includes(error.why)) throw error;
      fail('rpc');
    } finally { clearTimeout(timer); abort.abort(); }
  };
  return Object.freeze({
    chain: id => request('eth_chainId', [], id),
    block: (number, id) => request('eth_getBlockByNumber', [number, false], id),
    price: id => request('eth_gasPrice', [], id),
    creation: (tx, blockHash, id) => request('eth_call', [tx, { blockHash, requireCanonical: true }], id),
    // estimateGas's second parameter is a block number; EIP-1898 does not standardize a hash here.
    estimate: (tx, blockNumber, id) => request('eth_estimateGas', [tx, blockNumber], id),
  });
}

function observedBlock(value) {
  const block = rpcBlock(value);
  const gasLimit = rpcQuantity(value.gasLimit);
  if (BigInt(gasLimit) === 0n) fail('response');
  return { ...block, gasLimit };
}

export async function simulateAmoyDeployment(input, options) {
  const values = record(input, FIELDS, FIELDS, 'input');
  const limit = values.simulationGasLimit;
  if (typeof limit !== 'string' || !/^[1-9][0-9]{0,7}$/.test(limit)
    || BigInt(limit) < 53000n || BigInt(limit) > 30000000n) fail('input');
  const rpc = transport(options);
  let prepared;
  try {
    prepared = prepareAmoyDeployment({ chainId: values.chainId,
      deployerAddress: values.deployerAddress, mintOperatorAddress: values.mintOperatorAddress });
  } catch (error) {
    if (error instanceof AmoyDeploymentError && error.why === 'input') fail('input');
    fail('artifact');
  }
  try {
    if (BigInt(rpcQuantity(await rpc.chain(1))) !== 80002n) fail('chain');
    const block = observedBlock(await rpc.block('latest', 2));
    if (BigInt(limit) > BigInt(block.gasLimit)) fail('gas');
    const price = BigInt(rpcQuantity(await rpc.price(3)));
    if (price === 0n || price * BigInt(limit) > UINT256_MAX) fail('gas');
    const tx = { from: prepared.transaction.from, data: prepared.transaction.data, value: '0x0',
      gas: `0x${BigInt(limit).toString(16)}`, gasPrice: `0x${price.toString(16)}` };
    const runtime = await rpc.creation(tx, block.hash, 4);
    if (typeof runtime !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(runtime)
      || runtime.toLowerCase() !== prepared.verification.expectedRuntimeBytecode) fail('runtime');
    const estimatedGas = BigInt(rpcQuantity(await rpc.estimate(tx, block.number, 5)));
    if (estimatedGas < 53000n || estimatedGas > BigInt(limit)) fail('gas');
    const reread = observedBlock(await rpc.block(block.number, 6));
    if (Object.keys(block).some(key => block[key] !== reread[key])) fail('block');
    if (BigInt(rpcQuantity(await rpc.chain(7))) !== 80002n) fail('chain');
    return { ...prepared, purpose: 'Amoy ERC-721 creation simulation review; no game rights',
      network: { ...prepared.network, rpcChainIdMatched: true }, observedBlock: block,
      simulation: { callSelector: 'blockHash/requireCanonical', estimateSelector: 'blockNumber',
        runtimeMatches: true, returnedRuntimeCodeHash: keccak256(runtime.toLowerCase()),
        blockStable: true, chainMatchedTwice: true, finalityVerified: false },
      fees: { simulationGasLimit: limit, estimatedGas: estimatedGas.toString(), gasPriceWei: price.toString(),
        estimatedFeeWei: (estimatedGas * price).toString(), simulationLimitFeeWei: (BigInt(limit) * price).toString(),
        pricing: 'RPC gasPrice observation; not a transaction fee cap', gasToken: 'POL de prueba' },
      readiness: { ...prepared.readiness, rpcSimulated: true, gasEstimated: true } };
  } catch (error) {
    if (error instanceof AmoySimulationError) throw error;
    if (error instanceof RpcProbeError && error.code === 'response') fail('response');
    fail('rpc');
  }
}

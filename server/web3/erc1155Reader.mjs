import { isProxy } from 'node:util/types';
import { createRpcTransport, RpcProbeError, rpcQuantity, rpcHash, rpcBlock } from './rpcTransport.mjs';

export class Erc1155ReadError extends Error {
  constructor(code) { super(`ERC-1155 read: ${code}`); this.name = 'Erc1155ReadError'; this.code = code; }
}
const fail = (code) => { throw new Erc1155ReadError(code); };
const UINT256_MAX = (1n << 256n) - 1n;
const address = (value, code) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) fail(code);
  return value.toLowerCase();
};
function inputOf(raw) {
  const keys = ['holderAddress', 'tokenId', 'blockNumber', 'blockHash'];
  if (!raw || typeof raw !== 'object' || isProxy(raw) || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
    || Reflect.ownKeys(raw).length !== keys.length) fail('input');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (!keys.every(key => Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value'))) fail('input');
  const tokenId = fields.tokenId.value;
  if (typeof tokenId !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(tokenId) || BigInt(tokenId) > UINT256_MAX) fail('input');
  return { tokenId, holderAddress: address(fields.holderAddress.value, 'input'),
    blockNumber: rpcQuantity(fields.blockNumber.value), blockHash: rpcHash(fields.blockHash.value) };
}
function abiBool(value) {
  if (typeof value !== 'string' || !/^0x0{63}[01]$/.test(value)) fail('response');
  return value.endsWith('1');
}
function abiBalance(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('response');
  return BigInt(value).toString();
}
const supportsData = (id) => `0x01ffc9a7${id}${'0'.repeat(56)}`;

// One trusted contract is fixed by the caller. Balance is an observation, not a game entitlement.
export function createErc1155Reader({ url, chainId, contractAddress, fetchFn, timeoutMs } = {}) {
  let rpc, contract;
  try {
    contract = address(contractAddress, 'configuration');
    rpc = createRpcTransport({ url, chainId, fetchFn, timeoutMs });
  } catch { fail('configuration'); }
  return Object.freeze({
    async observeBalance(raw) {
      // Copy the complete query before network waits; do not retain mutable player input.
      let request;
      try { request = inputOf(raw); } catch { fail('input'); }
      const { tokenId, holderAddress, blockNumber, blockHash } = request;
      try {
        if (BigInt(rpcQuantity(await rpc.chainId(1))) !== BigInt(chainId)) fail('chain');
        const block = rpcBlock(await rpc.blockByNumber(blockNumber, 2));
        if (block.number !== blockNumber || block.hash !== blockHash) fail('block');
        const code = await rpc.codeAtHash(contract, blockHash, 3);
        if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) fail('response');
        if (code === '0x') fail('contract');
        // eth_call budgets include intrinsic gas; they do not prove the ERC-165 STATICCALL limit.
        if (!abiBool(await rpc.callAtHash(contract, supportsData('01ffc9a7'), blockHash, '0xea60', 4))) fail('interface');
        if (abiBool(await rpc.callAtHash(contract, supportsData('ffffffff'), blockHash, '0xea60', 5))) fail('interface');
        if (!abiBool(await rpc.callAtHash(contract, supportsData('d9b67a26'), blockHash, '0xea60', 6))) fail('interface');
        const data = `0x00fdd58e${holderAddress.slice(2).padStart(64, '0')}${BigInt(tokenId).toString(16).padStart(64, '0')}`;
        const balance = abiBalance(await rpc.callAtHash(contract, data, blockHash, '0x30d40', 7));
        const after = rpcBlock(await rpc.blockByNumber(blockNumber, 8));
        if (Object.keys(block).some(key => block[key] !== after[key])) fail('block');
        return { version: 1, chainId, contractAddress: contract, tokenId, holderAddress, balance, observedBlock: block };
      } catch (error) {
        if (error instanceof Erc1155ReadError) throw error;
        if (error instanceof RpcProbeError && ['response', 'rpc'].includes(error.code)) fail(error.code);
        fail('rpc');
      }
    },
  });
}

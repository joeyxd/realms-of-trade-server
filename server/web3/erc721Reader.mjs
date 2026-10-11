import { createRpcTransport, RpcProbeError, rpcQuantity, rpcHash, rpcBlock } from './rpcTransport.mjs';

export class Erc721ReadError extends Error {
  constructor(code) { super(`ERC-721 read: ${code}`); this.name = 'Erc721ReadError'; this.code = code; }
}
const fail = (code) => { throw new Erc721ReadError(code); };
const UINT256_MAX = (1n << 256n) - 1n;
const address = (value, code) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) fail(code);
  return value.toLowerCase();
};
function inputOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
    || Reflect.ownKeys(raw).length !== 3 || !['tokenId', 'blockNumber', 'blockHash'].every(key =>
      Object.hasOwn(raw, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(raw, key), 'value'))) fail('input');
  const { tokenId } = raw;
  if (typeof tokenId !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(tokenId) || BigInt(tokenId) > UINT256_MAX) fail('input');
  try { return { tokenId, blockNumber: rpcQuantity(raw.blockNumber), blockHash: rpcHash(raw.blockHash) }; }
  catch { fail('input'); }
}
function abiBool(value) {
  if (typeof value !== 'string' || !/^0x0{63}[01]$/.test(value)) fail('response');
  return value.endsWith('1');
}
function abiOwner(value) {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) fail('response');
  return address(`0x${value.slice(26)}`, 'response');
}
const supportsData = (id) => `0x01ffc9a7${id}${'0'.repeat(56)}`;

// A trusted caller fixes one contract; this observes RPC state and never assigns game ownership.
export function createErc721Reader({ url, chainId, contractAddress, fetchFn, timeoutMs } = {}) {
  let rpc, contract;
  try {
    contract = address(contractAddress, 'configuration');
    rpc = createRpcTransport({ url, chainId, fetchFn, timeoutMs });
  } catch { fail('configuration'); }
  return Object.freeze({
    async observeOwner(raw) {
      // Copy and validate before the first await, including the expected block identity.
      let request;
      try { request = inputOf(raw); } catch { fail('input'); }
      const { tokenId, blockNumber, blockHash } = request;
      try {
        if (BigInt(rpcQuantity(await rpc.chainId(1))) !== BigInt(chainId)) fail('chain');
        const block = rpcBlock(await rpc.blockByNumber(blockNumber, 2));
        if (block.number !== blockNumber || block.hash !== blockHash) fail('block');
        const code = await rpc.codeAtHash(contract, blockHash, 3);
        if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) fail('response');
        if (code === '0x') fail('contract');
        // eth_call includes intrinsic transaction gas; this is not a 30k STATICCALL gas proof.
        if (!abiBool(await rpc.callAtHash(contract, supportsData('01ffc9a7'), blockHash, '0xea60', 4))) fail('interface');
        if (abiBool(await rpc.callAtHash(contract, supportsData('ffffffff'), blockHash, '0xea60', 5))) fail('interface');
        if (!abiBool(await rpc.callAtHash(contract, supportsData('80ac58cd'), blockHash, '0xea60', 6))) fail('interface');
        const data = `0x6352211e${BigInt(tokenId).toString(16).padStart(64, '0')}`;
        const ownerAddress = abiOwner(await rpc.callAtHash(contract, data, blockHash, '0x30d40', 7));
        const after = rpcBlock(await rpc.blockByNumber(blockNumber, 8));
        if (Object.keys(block).some(key => block[key] !== after[key])) fail('block');
        return { version: 1, chainId, contractAddress: contract, tokenId, ownerAddress, observedBlock: block };
      } catch (error) {
        if (error instanceof Erc721ReadError) throw error;
        if (error instanceof RpcProbeError && ['response', 'rpc'].includes(error.code)) fail(error.code);
        fail('rpc');
      }
    },
  });
}

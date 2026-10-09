// Diagnostic only: selector acceptance and identity echo do not prove RPC honesty or finality.
import { createRpcTransport, RpcProbeError, rpcQuantity, rpcBlock } from './rpcTransport.mjs';

const CHAIN_ID = 80002;
const IDENTITY = '0x0000000000000000000000000000000000000004';
const PAYLOAD = '0x00ff0a6d6e2d616d6f792d70726f62652d7631';
export class AmoyRpcProbeError extends Error {
  constructor(code) { super(`Amoy RPC probe: ${code}`); this.name = 'AmoyRpcProbeError'; this.code = code; }
}
const fail = code => { throw new AmoyRpcProbeError(code); };

export function createAmoyRpcProbe(options = {}) {
  if (!options || options.chainId !== CHAIN_ID) fail('configuration');
  let rpc;
  try { rpc = createRpcTransport(options); }
  catch { fail('configuration'); }
  return Object.freeze({
    async observe() {
      try {
        if (BigInt(rpcQuantity(await rpc.chainId(1))) !== BigInt(CHAIN_ID)) fail('chain');
        const block = rpcBlock(await rpc.blockByNumber('latest', 2));
        // A precompile has native behavior even though its account has no stored bytecode.
        if (await rpc.codeAtHash(IDENTITY, block.hash, 3) !== '0x') fail('code');
        const echo = await rpc.callAtHash(IDENTITY, PAYLOAD, block.hash, '0xea60', 4);
        if (typeof echo !== 'string' || echo.toLowerCase() !== PAYLOAD) fail('identity');
        const reread = rpcBlock(await rpc.blockByNumber(block.number, 5));
        if (['number', 'hash', 'parentHash', 'timestamp'].some(key => reread[key] !== block[key])) fail('block');
        return { v: 1, chainId: CHAIN_ID, observedBlock: block,
          checks: { hashSelectorsAccepted: true, identityEcho: true, blockStable: true },
          finalityVerified: false };
      } catch (error) {
        if (error instanceof AmoyRpcProbeError) throw error;
        if (error instanceof RpcProbeError && ['rpc', 'response'].includes(error.code)) fail(error.code);
        fail('unavailable');
      }
    },
  });
}

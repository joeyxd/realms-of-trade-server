// Fixed read-only methods; an observation is not a finalized receipt or permission to use an asset.
import { createRpcTransport, RpcProbeError, rpcQuantity, rpcBlock } from './rpcTransport.mjs';
export { RpcProbeError } from './rpcTransport.mjs';

export function createRpcProbe(options = {}) {
  const rpc = createRpcTransport(options), { chainId } = options;
  return {
    async observe() {
      const reported = rpcQuantity(await rpc.chainId(1));
      if (BigInt(reported) !== BigInt(chainId)) throw new RpcProbeError('chain');
      return { chainId, block: rpcBlock(await rpc.blockByNumber('latest', 2)) };
    },
  };
}

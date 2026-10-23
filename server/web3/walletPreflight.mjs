import { walletReadinessFromEnv } from './walletRuntime.mjs';
import { createRpcProbe } from './rpcProbe.mjs';

export class WalletPreflightError extends Error {
  constructor(code) { super(`Wallet preflight: ${code}`); this.name = 'WalletPreflightError'; this.code = code; }
}
const fail = (code) => { throw new WalletPreflightError(code); };

export async function runWalletPreflight(env = process.env, { factory, fetchFn, timeoutMs } = {}) {
  let probe, wallet;
  try {
    const raw = env.MN_WEB3_WALLET_CHAIN_ID, chainId = typeof raw === 'string' ? Number(raw) : NaN;
    if (String(chainId) !== raw || env.MN_WEB3_WALLET_ENABLED !== '1') fail('configuration');
    // Validate RPC policy before creating any credentialed SQL client.
    probe = createRpcProbe({ url: env.MN_WEB3_RPC_URL, chainId, fetchFn, timeoutMs });
    wallet = walletReadinessFromEnv(env, { factory });
  } catch { fail('configuration'); }
  try { await wallet.prepare(); } catch { fail('storage'); }
  let observed;
  try { observed = await probe.observe(); }
  catch (error) { fail(['rpc', 'response', 'chain'].includes(error?.code) ? error.code : 'rpc'); }
  return { version: 1, checks: { walletSql: 'passed', rpc: 'passed' },
    wallet: { origin: wallet.origin, chainId: wallet.chainId, proof: 'eoa' }, observedBlock: observed.block };
}

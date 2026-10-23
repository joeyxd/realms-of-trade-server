// Durable RPC adapter and explicitly non-durable reference. Neither verifies cryptographic proofs.
import { canonical } from './assetContract.mjs';
import { WalletLinkError, fail, uuid, time, challengeOf, linkOf, issuedOf, outcomeOf, recordOf } from './walletContract.mjs';

const copy = (value) => value === null ? null : structuredClone(value);
const walletKey = (value) => `${value.chainId}:${value.address}`;
export function createMemoryWalletStore({ now = Date.now } = {}) {
  if (typeof now !== 'function') fail('configuration');
  const challenges = new Map(), links = new Map(), wallets = new Map(), nonces = new Set();
  const finish = (record, result) => { record.state = 'used'; record.result = result; return copy(result); };
  return {
    kind: 'memory', durable: false,
    async issue(raw) {
      const request = challengeOf(raw), current = time(now(), 'configuration');
      if (request.issuedAt > current + 10000) fail('input');
      const previous = challenges.get(request.challengeId);
      if (previous) {
        if (canonical(previous.challenge) !== canonical(request)) return { ok: false, why: 'identity' };
        if (previous.state !== 'pending') return { ok: false, why: 'identity' };
        if (previous.challenge.expiresAt <= current) { finish(previous, { ok: false, why: 'expired' }); return { ok: false, why: 'expired' }; }
        return { ok: true, replay: true, challenge: copy(previous.challenge) };
      }
      if (request.expiresAt <= current) return { ok: false, why: 'expired' };
      if (links.has(request.accountId)) return { ok: false, why: 'linked' };
      const pending = [...challenges.values()].find((r) => r.state === 'pending' && r.challenge.accountId === request.accountId);
      if (pending) {
        if (pending.challenge.expiresAt <= current) finish(pending, { ok: false, why: 'expired' });
        else if (pending.challenge.address === request.address && pending.challenge.chainId === request.chainId) return { ok: true, replay: true, challenge: copy(pending.challenge) };
        else return { ok: false, why: 'busy' };
      }
      if (nonces.has(request.nonce)) return { ok: false, why: 'identity' };
      nonces.add(request.nonce);
      challenges.set(request.challengeId, { challenge: request, state: 'pending', result: null });
      return { ok: true, replay: false, challenge: copy(request) };
    },
    async complete(challengeId, accountId, verified) {
      uuid(challengeId); uuid(accountId); if (typeof verified !== 'boolean') fail('input');
      const record = challenges.get(challengeId);
      if (!record || record.challenge.accountId !== accountId) return { ok: false, why: 'missing' };
      if (record.state !== 'pending') return { ok: false, why: 'used' };
      const current = time(now(), 'configuration');
      if (record.challenge.expiresAt <= current) return finish(record, { ok: false, why: 'expired' });
      if (!verified) return finish(record, { ok: false, why: 'signature' });
      if (links.has(accountId) || wallets.has(walletKey(record.challenge))) return finish(record, { ok: false, why: 'conflict' });
      const { address, chainId } = record.challenge, link = { accountId, address, chainId, challengeId };
      links.set(accountId, link); wallets.set(walletKey(link), accountId);
      return finish(record, { ok: true, link });
    },
    async loadChallenge(challengeId) { uuid(challengeId); return copy(challenges.get(challengeId) ?? null); },
    async loadLink(accountId) { uuid(accountId); return copy(links.get(accountId) ?? null); },
  };
}
export function createSupabaseWalletStore(client, { timeoutMs = 10000 } = {}) {
  if (typeof client?.rpc !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) fail('configuration');
  const rpc = async (name, args) => {
    const abort = new AbortController(); let timer, result;
    try {
      const query = client.rpc(name, args);
      const pending = typeof query?.abortSignal === 'function' ? query.abortSignal(abort.signal) : query;
      result = await Promise.race([pending, new Promise((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new WalletLinkError('storage')); }, timeoutMs);
      })]);
    } catch { fail('storage'); }
    finally { clearTimeout(timer); }
    if (result?.error) fail(result.error.code === 'MNW11' ? 'input' : 'storage');
    if (!result || !Object.hasOwn(result, 'data')) fail('response');
    return result.data;
  };
  return {
    kind: 'supabase', durable: true,
    async checkReady() {
      const result = await rpc('mn_web3_wallet_ready', {});
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || Object.keys(result).length !== 1 || result.version !== 1) fail('response');
      return { version: 1 };
    },
    async issue(raw) { const request = challengeOf(raw); return issuedOf(await rpc('mn_web3_wallet_issue', { p_request: request }), request); },
    async complete(challengeId, accountId, verified) {
      uuid(challengeId); uuid(accountId); if (typeof verified !== 'boolean') fail('input');
      return outcomeOf(await rpc('mn_web3_wallet_complete', { p_challenge_id: challengeId, p_account_id: accountId, p_verified: verified }), { challengeId, accountId });
    },
    async loadChallenge(challengeId) {
      uuid(challengeId); const result = await rpc('mn_web3_wallet_challenge', { p_challenge_id: challengeId });
      return result === null ? null : recordOf(result, challengeId);
    },
    async loadLink(accountId) {
      uuid(accountId); const result = await rpc('mn_web3_wallet_link', { p_account_id: accountId });
      if (result === null) return null;
      const link = linkOf(result); if (link.accountId !== accountId) fail('response'); return link;
    },
  };
}

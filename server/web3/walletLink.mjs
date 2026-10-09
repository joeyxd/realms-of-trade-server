// A proof of key control only: it never moves tokens, grants gameplay, or starts an account session.
import { randomBytes, randomUUID } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { fail, uuid, chain, time, MAX_TIME, issueInput, proofInput, challengeOf, issuedOf, recordOf, outcomeOf, linkOf } from './walletContract.mjs';
export { WalletLinkError } from './walletContract.mjs';

export function createWalletLinkService({ store, origin, chainId, ttlMs = 300000, now = Date.now } = {}) {
  let url;
  try {
    url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
  } catch { fail('configuration'); }
  chain(chainId, 'configuration');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 30000 || ttlMs > 600000 || typeof now !== 'function'
    || typeof store?.durable !== 'boolean' || ['issue', 'complete', 'loadChallenge', 'loadLink'].some((name) => typeof store?.[name] !== 'function')) fail('configuration');
  const messageFor = (challenge) => createSiweMessage({ address: challenge.address, chainId: challenge.chainId,
    domain: url.host, scheme: url.protocol.slice(0, -1), uri: `${origin}/web3/wallet`, version: '1', nonce: challenge.nonce,
    issuedAt: new Date(challenge.issuedAt), expirationTime: new Date(challenge.expiresAt), requestId: challenge.challengeId,
    statement: `Vincular esta wallet a la cuenta ${challenge.accountId} de MAREA NEGRA. No autoriza compras ni transferencias.` });
  const matchesPolicy = (challenge) => challenge.chainId === chainId && challenge.message === messageFor(challenge);
  // Fail at startup for an origin that the SIWE generator cannot represent.
  try { messageFor({ address: `0x${'1'.repeat(40)}`, chainId, nonce: 'a'.repeat(64), issuedAt: 1,
    expiresAt: 30001, challengeId: '00000000-0000-4000-8000-000000000001', accountId: '00000000-0000-4000-8000-000000000002' }); }
  catch { fail('configuration'); }
  return {
    origin, chainId, durable: store.durable,
    async issue(accountId, raw) {
      uuid(accountId); const input = issueInput(raw);
      if (input.chainId !== chainId) return { ok: false, why: 'chain' };
      const issuedAt = time(now(), 'configuration'); if (issuedAt > MAX_TIME - ttlMs) fail('configuration');
      const challenge = { challengeId: randomUUID(), accountId, address: input.address, chainId,
        nonce: randomBytes(32).toString('hex'), message: '', issuedAt, expiresAt: issuedAt + ttlMs };
      challenge.message = messageFor(challenge);
      const response = issuedOf(await store.issue(challengeOf(challenge)), challenge);
      if (response.ok && !matchesPolicy(response.challenge)) fail('response');
      return response;
    },
    async verify(accountId, raw) {
      uuid(accountId); const proof = proofInput(raw), loaded = await store.loadChallenge(proof.challengeId);
      if (loaded === null) return { ok: false, why: 'missing' };
      const record = recordOf(loaded, proof.challengeId), challenge = record.challenge;
      if (challenge.accountId !== accountId) return { ok: false, why: 'missing' };
      if (record.state !== 'pending') return { ok: false, why: 'used' };
      const current = time(now(), 'configuration'); let verified = false;
      if (current >= challenge.issuedAt && current < challenge.expiresAt && matchesPolicy(challenge) && proof.message === challenge.message) {
        try { verified = (await recoverMessageAddress({ message: proof.message, signature: proof.signature })).toLowerCase() === challenge.address; }
        catch { /* An invalid cryptographic proof is a consumed attempt, never an auth fallback. */ }
      }
      return outcomeOf(await store.complete(proof.challengeId, accountId, verified), challenge);
    },
    async loadLink(accountId) {
      uuid(accountId); const raw = await store.loadLink(accountId);
      if (raw === null) return null;
      const link = linkOf(raw); if (link.accountId !== accountId) fail('response'); return link;
    },
  };
}

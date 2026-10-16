// Internal wallet DTOs. Public callers cannot choose an account or assert a verified signature.
import { isAddress } from 'viem';
import { exact as assetExact, uuid as assetUuid, canonical } from './assetContract.mjs';

export class WalletLinkError extends Error {
  constructor(code) { super(`Wallet link: ${code}`); this.name = 'WalletLinkError'; this.code = code; }
}
export const fail = (code) => { throw new WalletLinkError(code); };
export const MAX_TIME = 253402300799999;
export function exact(raw, fields, code = 'input') {
  try { return assetExact(raw, fields, code); } catch { fail(code); }
}
export function uuid(raw, code = 'input') {
  try { return assetUuid(raw, code); } catch { fail(code); }
}
export function chain(raw, code = 'input') {
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > 2147483647) fail(code);
  return raw;
}
export function address(raw, code = 'input', normalized = false) {
  if (typeof raw !== 'string' || raw.length !== 42 || !isAddress(raw)
    || raw.toLowerCase() === `0x${'0'.repeat(40)}` || (normalized && raw !== raw.toLowerCase())) fail(code);
  return raw.toLowerCase();
}
export function time(raw, code = 'input') {
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > MAX_TIME) fail(code);
  return raw;
}
export function message(raw, code = 'input') {
  if (typeof raw !== 'string' || !raw.length || raw.length > 2048 || /[^\x20-\x7e\n]/.test(raw)) fail(code);
  return raw;
}
export function issueInput(raw) {
  exact(raw, ['address', 'chainId']);
  return { address: address(raw.address), chainId: chain(raw.chainId) };
}
export function proofInput(raw) {
  exact(raw, ['challengeId', 'message', 'signature']); uuid(raw.challengeId); message(raw.message);
  if (typeof raw.signature !== 'string' || raw.signature.length !== 132 || !/^0x[0-9a-fA-F]+$/.test(raw.signature)) fail('input');
  return { ...raw };
}
export function challengeOf(raw, code = 'input') {
  exact(raw, ['challengeId', 'accountId', 'address', 'chainId', 'nonce', 'message', 'issuedAt', 'expiresAt'], code);
  uuid(raw.challengeId, code); uuid(raw.accountId, code); address(raw.address, code, true); chain(raw.chainId, code);
  time(raw.issuedAt, code); time(raw.expiresAt, code); message(raw.message, code);
  if (typeof raw.nonce !== 'string' || raw.nonce.length !== 64 || !/^[0-9a-f]{64}$/.test(raw.nonce)
    || raw.expiresAt - raw.issuedAt < 30000 || raw.expiresAt - raw.issuedAt > 600000) fail(code);
  return { ...raw };
}
export function linkOf(raw, code = 'response') {
  exact(raw, ['accountId', 'address', 'chainId', 'challengeId'], code);
  uuid(raw.accountId, code); uuid(raw.challengeId, code); address(raw.address, code, true); chain(raw.chainId, code);
  return { ...raw };
}
export function outcomeOf(raw, expected = null, terminalOnly = false) {
  if (raw?.ok === true) {
    exact(raw, ['ok', 'link'], 'response'); const link = linkOf(raw.link);
    if (expected && ['accountId', 'challengeId', 'address', 'chainId'].some((k) => Object.hasOwn(expected, k) && link[k] !== expected[k])) fail('response');
    return { ok: true, link };
  }
  exact(raw, ['ok', 'why'], 'response');
  if (raw.ok !== false || !(terminalOnly ? ['signature', 'expired', 'conflict'] : ['signature', 'expired', 'conflict', 'missing', 'used']).includes(raw.why)) fail('response');
  return { ...raw };
}
export function recordOf(raw, expectedId = null) {
  exact(raw, ['challenge', 'state', 'result'], 'response'); const challenge = challengeOf(raw.challenge, 'response');
  if (expectedId !== null && challenge.challengeId !== expectedId) fail('response');
  if (!['pending', 'used'].includes(raw.state) || (raw.state === 'pending' && raw.result !== null)) fail('response');
  const result = raw.state === 'used' ? outcomeOf(raw.result, challenge, true) : null;
  return { challenge, state: raw.state, result };
}
export function issuedOf(raw, expected) {
  if (raw?.ok === false) {
    exact(raw, ['ok', 'why'], 'response');
    if (!['identity', 'busy', 'linked', 'expired'].includes(raw.why)) fail('response');
    return { ...raw };
  }
  exact(raw, ['ok', 'replay', 'challenge'], 'response');
  if (raw.ok !== true || typeof raw.replay !== 'boolean') fail('response');
  const challenge = challengeOf(raw.challenge, 'response');
  if (['accountId', 'address', 'chainId'].some((k) => challenge[k] !== expected[k])
    || (!raw.replay && canonical(challenge) !== canonical(expected))) fail('response');
  return { ok: true, replay: raw.replay, challenge };
}

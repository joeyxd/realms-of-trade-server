import { createHash } from 'node:crypto';
import { canonicalJson } from './contract.mjs';

const POLICY_KEYS = Object.freeze([
  'providerId', 'modelId', 'unit', 'inputNanoUsdPerToken', 'outputNanoUsdPerToken',
  'priceRef', 'priceCheckedAtMs',
]);
const providerIdValid = (value) => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(value);
const priceRefValid = (value) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(value);
const safeNonnegative = (value) => Number.isSafeInteger(value) && value >= 0;

function exactPlainDataObject(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable;
    });
  } catch {
    return false;
  }
}

export function validMetering(policy) {
  if (!exactPlainDataObject(policy, POLICY_KEYS)) return false;
  return providerIdValid(policy.providerId) && providerIdValid(policy.modelId) &&
    policy.unit === 'nano_usd' && safeNonnegative(policy.inputNanoUsdPerToken) &&
    safeNonnegative(policy.outputNanoUsdPerToken) &&
    (policy.inputNanoUsdPerToken > 0 || policy.outputNanoUsdPerToken > 0) &&
    priceRefValid(policy.priceRef) && safeNonnegative(policy.priceCheckedAtMs);
}

export function meteringHash(policy) {
  if (!validMetering(policy)) throw new TypeError('invalid_metering_policy');
  return createHash('sha256').update(canonicalJson(policy), 'utf8').digest('hex');
}

// Computes a rate-derived estimate from trusted native token counts. This is not an invoice.
export function meteredCost(policy, inputTokens, outputTokens) {
  if (!validMetering(policy) || !safeNonnegative(inputTokens) || !safeNonnegative(outputTokens)) return null;
  const amount = BigInt(inputTokens) * BigInt(policy.inputNanoUsdPerToken) +
    BigInt(outputTokens) * BigInt(policy.outputNanoUsdPerToken);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(amount);
}

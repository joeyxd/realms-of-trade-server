// Chat limits belong to the host configuration, outside deterministic gameplay and profiles.
export const CHAT_DEFAULTS = Object.freeze({
  enabled: true, localRadius: 24, maxLength: 300, burst: 4, refillPerSecond: 0.5,
  historyLimit: 100, receiptLimit: 128,
});

export function chatConfig(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      Object.keys(overrides).some((key) => !Object.hasOwn(CHAT_DEFAULTS, key))) throw new TypeError('chat configuration');
  const c = { ...CHAT_DEFAULTS, ...overrides };
  if (typeof c.enabled !== 'boolean') throw new TypeError('chat enabled');
  for (const [key, min, max, integer] of [
    ['localRadius', 1, 200, false], ['maxLength', 1, 1000, true], ['burst', 1, 20, true],
    ['refillPerSecond', 0.01, 10, false], ['historyLimit', 1, 200, true], ['receiptLimit', 1, 512, true],
  ]) {
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max || (integer && !Number.isInteger(c[key]))) {
      throw new TypeError(`chat ${key}`);
    }
  }
  return Object.freeze(c);
}

export function chatFromEnv(env = {}) {
  const fields = { CHAT_LOCAL_RADIUS: 'localRadius', CHAT_MAX_LENGTH: 'maxLength', CHAT_BURST: 'burst',
    CHAT_REFILL_PER_SECOND: 'refillPerSecond', CHAT_HISTORY_LIMIT: 'historyLimit', CHAT_RECEIPT_LIMIT: 'receiptLimit' };
  const result = {};
  for (const [key, field] of Object.entries(fields)) if (env[key] !== undefined && env[key] !== '') result[field] = Number(env[key]);
  if (env.CHAT_ENABLED !== undefined && env.CHAT_ENABLED !== '') {
    if (!['0', '1'].includes(env.CHAT_ENABLED)) throw new TypeError('CHAT_ENABLED');
    result.enabled = env.CHAT_ENABLED === '1';
  }
  return chatConfig(result);
}

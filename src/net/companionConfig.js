// Private owner-authored metadata. This is not a grant, memory journal or running mind input.
export const MAX_CONFIG_BYTES = 32768;
export const MAX_CONFIG_REVISION = 2147483647;
export const COMPANION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const companionId = value => typeof value === 'string' && COMPANION_UUID.test(value)
  && value !== '00000000-0000-0000-0000-000000000000';
const encoder = new TextEncoder();
const statuses = new Set(['active', 'paused', 'completed', 'blocked']);
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{16,}/i;
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max, required = false) => typeof v === 'string' && (!required || v.trim().length > 0)
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(v)
  && encoder.encode(v).length <= max && !secret.test(v);

export function validateCompanionConfig(value) {
  const fail = () => { throw new TypeError('invalid_config'); };
  if (!exact(value, ['v', 'personality', 'goals']) || value.v !== 1 || !text(value.personality, 8192)
      || !Array.isArray(value.goals) || value.goals.length > 16) fail();
  const ids = new Set();
  const goals = value.goals.map(goal => {
    if (!exact(goal, ['id', 'status', 'text', 'constraints']) || typeof goal.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,64}$/.test(goal.id) || ids.has(goal.id) || !statuses.has(goal.status)
        || !text(goal.text, 2000, true) || !Array.isArray(goal.constraints) || goal.constraints.length > 8
        || goal.constraints.some(c => !text(c, 500, true))) fail();
    ids.add(goal.id);
    return { id: goal.id, status: goal.status, text: goal.text, constraints: [...goal.constraints] };
  });
  const config = { v: 1, personality: value.personality, goals };
  if (encoder.encode(JSON.stringify(config)).length > MAX_CONFIG_BYTES) fail();
  return config;
}

export function validateCompanionConfigHead(value) {
  if (!exact(value, ['revision', 'config', 'savedAt']) || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || value.revision > MAX_CONFIG_REVISION) throw new TypeError('invalid_head');
  if (value.revision === 0) {
    if (value.config !== null || value.savedAt !== null) throw new TypeError('invalid_head');
    return { revision: 0, config: null, savedAt: null };
  }
  if (typeof value.savedAt !== 'string' || value.savedAt.length > 64 || !Number.isFinite(Date.parse(value.savedAt))) {
    throw new TypeError('invalid_head');
  }
  return { revision: value.revision, config: validateCompanionConfig(value.config), savedAt: value.savedAt };
}

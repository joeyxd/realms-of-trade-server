// IC08 hosted inference: request shapes and limits shared by the server service and the client panel.
// Contract: docs/briefs/ic08-hosted-inference.md. No DOM, no Node APIs.

export const HOSTED_LIMITS = Object.freeze({ maxEndpoints: 8, label: 48, baseUrl: 300, apiKey: 400, modelId: 200,
  prompt: 2000, text: 2000 });
export const HOSTED_OPS = Object.freeze(['load', 'save', 'delete', 'probe', 'test', 'start', 'stop']);
export const HOSTED_STATUSES = Object.freeze(['stopped', 'starting', 'running', 'failed']);
export const HOSTED_REASONS = Object.freeze(['disabled', 'not_allowed', 'misconfigured']);
export const HOSTED_WHY = Object.freeze(['forbidden', 'disabled', 'not_allowed', 'misconfigured', 'invalid_request', 'busy',
  'limit', 'endpoint_unknown', 'model_unknown', 'egress_blocked', 'not_created', 'stopped', 'presence_body_required',
  'unavailable', 'http_status', 'invalid_json', 'invalid_response', 'transport_error', 'timeout', 'response_too_large',
  'content_type', 'output_limit', 'truncated', 'content_filter', 'incomplete', 'storage_error']);
// Per owner and per minute: probe/test, save/delete, start/stop share one bucket each.
export const HOSTED_RATES = Object.freeze({ load: 60, save: 20, delete: 20, probe: 6, test: 6, start: 10, stop: 10 });
export const HOSTED_RATE_CLASS = Object.freeze({ load: 'load', save: 'edit', delete: 'edit', probe: 'call', test: 'call',
  start: 'run', stop: 'run' });

const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;
const ENDPOINT_ID = /^[a-f0-9]{16}$/;
const CHARACTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

export const validHostedRequestId = value => typeof value === 'string' && REQUEST_ID.test(value);
export const validEndpointId = value => typeof value === 'string' && ENDPOINT_ID.test(value);
export const validCharacter = value => typeof value === 'string' && CHARACTER.test(value);
export const validModelId = value => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= HOSTED_LIMITS.modelId && !CONTROL.test(value);
export const validLabel = value => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= HOSTED_LIMITS.label && !CONTROL.test(value);
export const validBaseUrl = value => typeof value === 'string' && value.length > 0 &&
  value.length <= HOSTED_LIMITS.baseUrl && /^https?:\/\//i.test(value) && !CONTROL.test(value);
export const validApiKey = value => typeof value === 'string' && value.length <= HOSTED_LIMITS.apiKey && !CONTROL.test(value);
export const validPrompt = value => typeof value === 'string' && value.trim().length > 0 && value.length <= HOSTED_LIMITS.prompt;

function validEndpoint(value) {
  const keys = ['id', 'label', 'baseUrl', 'defaultModel'];
  if (!exact(value, Object.hasOwn(value ?? {}, 'apiKey') ? [...keys, 'apiKey'] : keys)) return false;
  return (value.id === null || validEndpointId(value.id)) && validLabel(value.label) && validBaseUrl(value.baseUrl) &&
    (value.defaultModel === null || validModelId(value.defaultModel)) &&
    (!Object.hasOwn(value, 'apiKey') || validApiKey(value.apiKey));
}

const FIELDS = Object.freeze({ load: [], save: ['endpoint'], delete: ['id'], probe: ['id'], test: ['id', 'modelId', 'prompt'],
  start: ['character', 'endpointId', 'modelId'], stop: ['character'] });

/** True when a client -> server MSG.HOSTED_INFERENCE message has exactly the contract's keys and values. */
export function validHostedRequest(message) {
  if (!plain(message) || !HOSTED_OPS.includes(message.op) || !validHostedRequestId(message.requestId) ||
      !exact(message, ['t', 'requestId', 'op', ...FIELDS[message.op]])) return false;
  switch (message.op) {
    case 'load': return true;
    case 'save': return validEndpoint(message.endpoint);
    case 'delete': case 'probe': return validEndpointId(message.id);
    case 'test': return validEndpointId(message.id) && validModelId(message.modelId) && validPrompt(message.prompt);
    case 'start': return validCharacter(message.character) && validEndpointId(message.endpointId) && validModelId(message.modelId);
    case 'stop': return validCharacter(message.character);
    default: return false;
  }
}

/** The state of an owner who cannot use the feature: empty lists, the reason and the limits. */
export function unavailableHostedState(reason, maxRunning) {
  return { available: false, reason, endpoints: [], companions: [], limits: { maxEndpoints: HOSTED_LIMITS.maxEndpoints, maxRunning } };
}

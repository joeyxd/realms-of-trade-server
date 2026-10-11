import http from 'node:http';
import { performance } from 'node:perf_hooks';

const MAX_TOKENS = 1_000_000_000;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,160}$/;
const ABORTED_GETTER = typeof AbortSignal === 'undefined'
  ? null : Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

function dataRecord(value, required, optional = []) {
  if (!plain(value)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string') ||
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => !required.includes(key) && !optional.includes(key))) return null;
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function dataArray(value, min, max) {
  if (!Array.isArray(value)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < min || lengthDescriptor.value > max) return null;
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== length + 1) return null;
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result.push(descriptor.value);
  }
  return result;
}

function checkedOptions(options) {
  const record = dataRecord(options,
    ['baseUrl', 'modelId', 'maxCalls', 'maxOutputTokens', 'timeoutMs'],
    ['maxInputBytes', 'maxResponseBytes', 'thinkingMode']);
  if (!record) throw new TypeError('invalid transport options');
  const maxInputBytes = Object.hasOwn(record, 'maxInputBytes') ? record.maxInputBytes : 16_384;
  const maxResponseBytes = Object.hasOwn(record, 'maxResponseBytes') ? record.maxResponseBytes : 262_144;
  const thinkingMode = Object.hasOwn(record, 'thinkingMode') ? record.thinkingMode : 'server_default';
  if (typeof record.baseUrl !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/v1\/?$/.test(record.baseUrl) ||
      typeof record.modelId !== 'string' || !MODEL_ID.test(record.modelId) ||
      !['server_default', 'disabled'].includes(thinkingMode) ||
      !Number.isInteger(record.maxCalls) || record.maxCalls < 1 || record.maxCalls > 8 ||
      !Number.isInteger(record.maxOutputTokens) || record.maxOutputTokens < 1 || record.maxOutputTokens > 512 ||
      !Number.isInteger(record.timeoutMs) || record.timeoutMs < 100 || record.timeoutMs > 30_000 ||
      !Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > 65_536 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 262_144) {
    throw new TypeError('invalid transport options');
  }
  const url = new URL(record.baseUrl);
  const port = Number(url.port || 80);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !port || port > 65_535 ||
      url.username || url.password || url.search || url.hash || !['/v1', '/v1/'].includes(url.pathname)) {
    throw new TypeError('invalid transport URL');
  }
  return { port, modelId: record.modelId, maxCalls: record.maxCalls,
    maxOutputTokens: record.maxOutputTokens, timeoutMs: record.timeoutMs,
    maxInputBytes, maxResponseBytes, thinkingMode };
}

function nativeUsage(value) {
  const record = dataRecord(value, ['prompt_tokens', 'completion_tokens', 'total_tokens'],
    ['prompt_tokens_details', 'completion_tokens_details']);
  if (!record) return null;
  const inputTokens = record.prompt_tokens;
  const outputTokens = record.completion_tokens;
  const totalTokens = record.total_tokens;
  if (![inputTokens, outputTokens, totalTokens].every((item) => Number.isInteger(item) && item >= 0 && item <= MAX_TOKENS) ||
      inputTokens + outputTokens !== totalTokens) return null;

  let cachedInputTokens = null;
  let reasoningTokens = null;
  if (Object.hasOwn(value, 'prompt_tokens_details')) {
    const details = dataRecord(value.prompt_tokens_details, [], ['cached_tokens']);
    if (!details) return null;
    if (Object.hasOwn(details, 'cached_tokens')) {
      cachedInputTokens = details.cached_tokens;
      if (!Number.isInteger(cachedInputTokens) || cachedInputTokens < 0 || cachedInputTokens > inputTokens) return null;
    }
  }
  if (Object.hasOwn(value, 'completion_tokens_details')) {
    const details = dataRecord(value.completion_tokens_details, [], ['reasoning_tokens']);
    if (!details) return null;
    if (Object.hasOwn(details, 'reasoning_tokens')) {
      reasoningTokens = details.reasoning_tokens;
      if (!Number.isInteger(reasoningTokens) || reasoningTokens < 0 || reasoningTokens > outputTokens) return null;
    }
  }
  return { inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningTokens };
}

function outputResult({ ok = false, why, dispatched, usage = null, text = null, responseId = null,
  reportedModel = null, finishReason = null, latencyMs, executionMayContinue = false }) {
  return { ok, why, dispatched, usageKnown: usage !== null, usage, text, responseId,
    reportedModel, finishReason, latencyMs: Math.max(0, Math.round(latencyMs)),
    costNanoUsd: null, executionMayContinue };
}

function isAbortSignal(value) {
  if (typeof AbortSignal === 'undefined' || !(value instanceof AbortSignal)) return false;
  try {
    return typeof ABORTED_GETTER === 'function' && typeof ABORTED_GETTER.call(value) === 'boolean';
  } catch { return false; }
}

function signalAborted(signal) {
  return ABORTED_GETTER.call(signal);
}

function addAbortListener(signal, listener) {
  EventTarget.prototype.addEventListener.call(signal, 'abort', listener, { once: true });
}

function removeAbortListener(signal, listener) {
  EventTarget.prototype.removeEventListener.call(signal, 'abort', listener);
}

function decoded(result, uncertain = result.executionMayContinue) { return { result, uncertain }; }

function decodeResponse(statusCode, contentType, body, modelId, maxOutputTokens, latencyMs) {
  if (statusCode !== 200) return decoded(outputResult({ why: 'http_status', dispatched: true,
    latencyMs, executionMayContinue: true }));
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return decoded(outputResult({ why: 'content_type', dispatched: true, latencyMs, executionMayContinue: true }));
  }
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); } catch {
    return decoded(outputResult({ why: 'invalid_json', dispatched: true, latencyMs, executionMayContinue: true }));
  }
  if (!plain(payload)) return decoded(outputResult({ why: 'invalid_response', dispatched: true,
    latencyMs, executionMayContinue: true }));

  const usage = nativeUsage(payload.usage);
  if (!usage) return decoded(outputResult({ why: 'invalid_usage', dispatched: true,
    latencyMs, executionMayContinue: true }));
  const reportedModel = typeof payload.model === 'string' ? payload.model : null;
  const responseId = typeof payload.id === 'string' ? payload.id : null;
  if (reportedModel !== modelId) return decoded(outputResult({ why: 'model_mismatch', dispatched: true,
    responseId, reportedModel, latencyMs }), true);
  if (usage.outputTokens > maxOutputTokens) return decoded(outputResult({ why: 'output_limit', dispatched: true,
    usage, responseId, reportedModel, latencyMs }));

  const choices = dataArray(payload.choices, 1, 1);
  if (!choices) return decoded(outputResult({ why: 'invalid_response', dispatched: true,
    usage, responseId, reportedModel, latencyMs }));
  const choice = dataRecord(choices[0], ['index', 'message', 'finish_reason'], ['logprobs']);
  if (!choice || choice.index !== 0 || (Object.hasOwn(choice, 'logprobs') &&
      choice.logprobs !== null && !plain(choice.logprobs))) return decoded(outputResult({ why: 'invalid_response', dispatched: true,
    usage, responseId, reportedModel, latencyMs }));
  const message = dataRecord(choice.message, ['role', 'content'], ['name', 'refusal', 'reasoning_content']);
  if (!message || message.role !== 'assistant' ||
      (typeof message.content !== 'string' && !(message.content === null && choice.finish_reason === 'length')) ||
      Object.hasOwn(message, 'tool_calls') || Object.hasOwn(message, 'function_call')) {
    return decoded(outputResult({ why: 'invalid_response', dispatched: true,
      usage, responseId, reportedModel, latencyMs }));
  }
  if (choice.finish_reason === 'stop') return decoded(outputResult({ ok: true, why: 'ok', dispatched: true,
    usage, text: message.content, responseId, reportedModel, finishReason: 'stop', latencyMs }));
  if (choice.finish_reason === 'length') return decoded(outputResult({ why: 'truncated', dispatched: true,
    usage, text: message.content, responseId, reportedModel, finishReason: 'length', latencyMs }));
  return decoded(outputResult({ why: 'invalid_response', dispatched: true, usage,
    responseId, reportedModel, latencyMs }));
}

/** Creates a pinned loopback-only OpenAI-compatible transport with process-local limits. */
export function createLocalOpenAITransport(options) {
  const config = checkedOptions(options);
  let calls = 0;
  let inFlight = false;
  let uncertain = false;

  function baseResult(why, latencyMs = 0) {
    return outputResult({ why, dispatched: false, latencyMs, executionMayContinue: false });
  }

  async function generate(input) {
    const request = dataRecord(input, ['messages'], ['signal']);
    if (!request) return baseResult('invalid_request');
    const messages = dataArray(request.messages, 1, 16);
    if (!messages) return baseResult('invalid_request');
    const safeMessages = [];
    for (const item of messages) {
      const message = dataRecord(item, ['role', 'content']);
      if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
        return baseResult('invalid_request');
      }
      safeMessages.push({ role: message.role, content: message.content });
    }
    let body;
    try {
      body = Buffer.from(JSON.stringify({ model: config.modelId, messages: safeMessages,
        stream: false, temperature: 0, max_tokens: config.maxOutputTokens,
        // Explicit opt-in for a verified llama.cpp-compatible template, never automatic fallback.
        ...(config.thinkingMode === 'disabled' ? { chat_template_kwargs: { enable_thinking: false } } : {}) }), 'utf8');
    } catch { return baseResult('invalid_request'); }
    if (body.length > config.maxInputBytes) return baseResult('invalid_request');
    if (request.signal !== undefined && !isAbortSignal(request.signal)) return baseResult('invalid_request');
    if (request.signal && signalAborted(request.signal)) return baseResult('aborted');
    if (uncertain) return baseResult('uncertain_blocked');
    if (inFlight) return baseResult('busy');
    if (calls >= config.maxCalls) return baseResult('call_limit');

    inFlight = true;
    calls++;
    const started = performance.now();
    let settled = false;
    let requestClosed = false;
    let result = null;
    let responseBytes = 0;
    const chunks = [];
    let response = null;
    let timer = null;
    let signal = request.signal;
    let abortListener = null;
    let req;

    return await new Promise((resolve) => {
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        if (signal && abortListener) removeAbortListener(signal, abortListener);
        response?.removeAllListeners('data');
        response?.removeAllListeners('end');
        response?.removeAllListeners('error');
      };
      const finish = () => {
        if (!requestClosed || !settled) return;
        cleanup();
        inFlight = false;
        resolve(result);
      };
      const settle = (next, latch = false) => {
        if (settled) return;
        settled = true;
        result = next;
        if (latch) uncertain = true;
        finish();
      };
      const unknown = (why) => outputResult({ why, dispatched: true,
        latencyMs: performance.now() - started, executionMayContinue: true });

      req = http.request({ hostname: '127.0.0.1', port: config.port, path: '/v1/chat/completions',
        method: 'POST', agent: false, headers: { 'content-type': 'application/json',
          accept: 'application/json', 'content-length': String(body.length), connection: 'close' } }, (incoming) => {
        response = incoming;
        incoming.on('data', (chunk) => {
          if (settled) return;
          responseBytes += chunk.length;
          if (responseBytes > config.maxResponseBytes) {
            settle(unknown('response_too_large'), true);
            incoming.destroy();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('end', () => {
          if (settled) return;
          const next = decodeResponse(incoming.statusCode, incoming.headers['content-type'],
            Buffer.concat(chunks), config.modelId, config.maxOutputTokens, performance.now() - started);
          settle(next.result, next.uncertain);
        });
        incoming.on('error', () => {
          settle(unknown('transport_error'), true);
          req.destroy();
        });
      });
      req.on('error', () => settle(unknown('transport_error'), true));
      req.on('close', () => {
        requestClosed = true;
        if (!settled) settle(unknown('transport_error'), true);
        finish();
      });
      abortListener = () => {
        settle(unknown('aborted'), true);
        req.destroy();
      };
      if (signal) addAbortListener(signal, abortListener);
      timer = setTimeout(() => {
        settle(unknown('timeout'), true);
        req.destroy();
      }, config.timeoutMs);
      try { req.end(body); } catch {
        settle(unknown('transport_error'), true);
        req.destroy();
      }
    });
  }

  return Object.freeze({ generate, get state() { return Object.freeze({ calls, inFlight, uncertain }); } });
}

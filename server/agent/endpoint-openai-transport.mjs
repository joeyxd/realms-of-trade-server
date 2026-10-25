import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { pinnedRequestOptions } from './egress-guard.mjs';

const MAX_TOKENS = 1_000_000_000;
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

export function checkedEndpointUrl(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f?#]/.test(value)) throw new TypeError('invalid_request');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new TypeError('invalid_request');
  const normalized = url.href.replace(/\/+$/, '');
  if (normalized.length > 512) throw new TypeError('invalid_request');
  return normalized;
}

function checkedOptions(options) {
  const record = dataRecord(options, ['endpoint', 'modelId', 'maxCalls', 'maxOutputTokens', 'timeoutMs'],
    ['maxInputBytes', 'maxResponseBytes', 'thinkingMode', 'egress']);
  if (!record) throw new TypeError('invalid transport options');
  const endpoint = record.endpoint;
  if (!plain(endpoint)) throw new TypeError('invalid transport options');
  const url = new URL(checkedEndpointUrl(endpoint.baseUrl));
  const apiKey = endpoint.apiKey ?? '';
  const maxInputBytes = record.maxInputBytes ?? 16_384;
  const maxResponseBytes = record.maxResponseBytes ?? 262_144;
  const thinkingMode = record.thinkingMode ?? 'server_default';
  if (typeof apiKey !== 'string' || apiKey.length > 512 || /[\u0000-\u001f\u007f-\u009f]/.test(apiKey) ||
      typeof record.modelId !== 'string' || !record.modelId.trim() || record.modelId.length > 200 ||
      !['server_default', 'disabled'].includes(thinkingMode) ||
      !Number.isInteger(record.maxCalls) || record.maxCalls < 1 || record.maxCalls > 60 ||
      !Number.isInteger(record.maxOutputTokens) || record.maxOutputTokens < 1 || record.maxOutputTokens > 512 ||
      !Number.isInteger(record.timeoutMs) || record.timeoutMs < 100 || record.timeoutMs > 30_000 ||
      !Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > 65_536 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 262_144) throw new TypeError('invalid transport options');
  if (apiKey) http.validateHeaderValue('Authorization', `Bearer ${apiKey}`);
  // IC08: an injected egress fence vets every hosted request; absent (PC Studio) nothing changes.
  const egress = record.egress ?? null;
  if (egress !== null && typeof egress?.vet !== 'function') throw new TypeError('invalid transport options');
  return { url, apiKey, modelId: record.modelId, maxCalls: record.maxCalls,
    maxOutputTokens: record.maxOutputTokens, timeoutMs: record.timeoutMs,
    maxInputBytes, maxResponseBytes, thinkingMode, egress };
}

function nativeUsage(value) {
  if (!plain(value)) return null;
  const promptTokens = value.prompt_tokens, completionTokens = value.completion_tokens;
  return [promptTokens, completionTokens].every(item => Number.isInteger(item) && item >= 0 && item <= MAX_TOKENS)
    ? { inputTokens: promptTokens, outputTokens: completionTokens } : null;
}

function outputResult({ ok = false, why, dispatched, usage = null, text = null, responseId = null,
  reportedModel = null, modelMismatch = false, finishReason = null, latencyMs, status = null, executionMayContinue = false }) {
  return { ok, why, dispatched, status, usageKnown: usage !== null, usage, text, responseId,
    reportedModel, servedModel: reportedModel, modelMismatch, finishReason, latencyMs: Math.max(0, Math.round(latencyMs)),
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
  if (statusCode < 200 || statusCode >= 300) return decoded(outputResult({ why: 'http_status', dispatched: true,
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
  const reportedModel = typeof payload.model === 'string' ? payload.model : null;
  const responseId = typeof payload.id === 'string' ? payload.id : null;
  const modelMismatch = reportedModel !== null && reportedModel !== modelId && !reportedModel.startsWith(`${modelId}-`);
  const metadata = { dispatched: true, usage, responseId, reportedModel, modelMismatch, latencyMs };
  if (Object.hasOwn(payload, 'model') && typeof payload.model !== 'string') {
    return decoded(outputResult({ ...metadata, why: 'invalid_response' }));
  }
  if (usage && usage.outputTokens > maxOutputTokens) return decoded(outputResult({ ...metadata, why: 'output_limit' }));

  // Provider responses are open records; only fields used by this transport are validated.
  const choices = dataArray(payload.choices, 1, 1);
  const choice = choices?.[0];
  const message = choice?.message;
  if (!plain(choice) || choice.index !== 0 || !plain(message) || message.role !== 'assistant' ||
      (typeof message.content !== 'string' && message.content !== null) ||
      !['stop', 'eos', 'length', 'content_filter', null].includes(choice.finish_reason) ||
      // Empty tool_calls arrays and null function_call are plain provider metadata; real tool use fails closed.
      !(message.tool_calls == null || Array.isArray(message.tool_calls) && message.tool_calls.length === 0) ||
      message.function_call != null) {
    return decoded(outputResult({ ...metadata, why: 'invalid_response' }));
  }
  if (choice.finish_reason === 'stop' || choice.finish_reason === 'eos') return decoded(outputResult({ ...metadata, ok: true, why: 'ok',
    text: message.content, finishReason: 'stop' }));
  if (choice.finish_reason === 'length') return decoded(outputResult({ ...metadata, why: 'truncated',
    text: message.content, finishReason: 'length' }));
  return decoded(outputResult({ ...metadata, why: choice.finish_reason === 'content_filter' ? 'content_filter' : 'incomplete',
    finishReason: choice.finish_reason }));
}

/** Creates an explicitly registered HTTP(S) transport with process-local limits. */
export function createEndpointOpenAITransport(options) {
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

    let pinned = {};
    if (config.egress) {
      // inFlight covers the lookup, so a concurrent call still answers busy.
      inFlight = true;
      let vetted = null;
      try { vetted = await config.egress.vet(config.url.href); } catch { vetted = null; } finally { inFlight = false; }
      if (!vetted?.ok) return baseResult(vetted?.why === 'transport_error' ? 'transport_error' : 'egress_blocked');
      if (request.signal && signalAborted(request.signal)) return baseResult('aborted');
      pinned = pinnedRequestOptions(vetted);
    }
    inFlight = true;
    calls++;
    const started = performance.now();
    let settled = false;
    let requestClosed = false;
    let result = null;
    let responseBytes = 0;
    let status = null;
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
        result = { ...next, status };
        if (latch) uncertain = true;
        finish();
      };
      const unknown = (why) => outputResult({ why, dispatched: true,
        latencyMs: performance.now() - started, executionMayContinue: true });

      req = (config.url.protocol === 'https:' ? https : http).request({
        hostname: config.url.hostname.replace(/^\[|\]$/g, ''), port: config.url.port || undefined,
        path: `${config.url.pathname.replace(/\/$/, '')}${config.url.pathname.endsWith('/v1') ? '' : '/v1'}/chat/completions`,
        method: 'POST', agent: false, ...pinned, headers: { 'content-type': 'application/json',
          accept: 'application/json', 'user-agent': 'marea-negra-inference/1',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}), 'content-length': String(body.length), connection: 'close' } }, (incoming) => {
        response = incoming;
        status = incoming.statusCode;
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

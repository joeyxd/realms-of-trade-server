import { createHash } from 'node:crypto';
import { createLocalOpenAITransport } from './local-openai-transport.mjs';
import { createEndpointOpenAITransport } from './endpoint-openai-transport.mjs';

const bytes = text => Buffer.byteLength(text, 'utf8');
const LANGUAGE = 'Responde siempre en español natural, incluido el texto de resúmenes. Eres el personaje descrito en context.required.personality. Mantén su nombre y voz sin inventar vivencias. Si la pregunta trata de recuerdos, busca en context.memory y distingue lo recordado de lo observado ahora. Si no hay fuente, di que no lo recuerdas. Devuelve únicamente el objeto JSON del esquema, sin markdown, comentarios ni razonamiento.';

// Local compute units are token allowances, never currency or a provider invoice.
export function createLocalOpenAIMind({ baseUrl, modelId, thinkingMode = 'disabled', maxCalls = 8,
  maxOutputTokens = 512, timeoutMs = 30000 } = {}) {
  const transport = createLocalOpenAITransport({ baseUrl, modelId, thinkingMode, maxCalls,
    maxOutputTokens, timeoutMs, maxInputBytes: 65536, maxResponseBytes: 262144 });
  const localResourcePolicy = Object.freeze({ baseUrl, modelId, thinkingMode });
  return buildMind({ transport, localResourcePolicy, modelId, thinkingMode, maxOutputTokens, id: 'local-openai-mind-v1' });
}

export function createEndpointOpenAIMind({ endpointId, endpoint, modelId, thinkingMode = 'disabled', maxCalls = 8,
  maxOutputTokens = 512, timeoutMs = 30000 } = {}) {
  if (typeof endpointId !== 'string' || !/^[a-f0-9]{16}$/.test(endpointId)) throw new TypeError('invalid_endpoint_mind_policy');
  const transport = createEndpointOpenAITransport({ endpoint, modelId, thinkingMode, maxCalls,
    maxOutputTokens, timeoutMs, maxInputBytes: 65536, maxResponseBytes: 262144 });
  const localResourcePolicy = Object.freeze({ endpointId, modelId, thinkingMode });
  return buildMind({ transport, localResourcePolicy, modelId, thinkingMode, maxOutputTokens, id: 'endpoint-openai-mind-v1' });
}

function buildMind({ transport, localResourcePolicy, modelId, thinkingMode, maxOutputTokens, id }) {
  const records = [];
  function payload(request) {
    if (!request || request.v !== 1 || typeof request.instructions !== 'string' || !request.responseSchema ||
      !request.context || request.maxOutputTokens !== maxOutputTokens) throw new TypeError('invalid_local_mind_request');
    const conversation = request.context.required?.tools?.conversation;
    const maxReply = Math.min(240, request.context.required?.tools?.chat?.config?.maxLength ?? 240);
    const channelRules = conversation ? ` El mensaje seleccionado está en context.required.tools.conversation.source.text. Responde a ese mensaje. Si respondes, decision.args.text debe ser una sola línea de 1 a ${maxReply} caracteres: breve, sin saltos de línea ni espacios al principio o al final.` : '';
    return { model: modelId, messages: [
      { role: 'system', content: request.instructions + '\n' + LANGUAGE + channelRules + '\nJSON schema: ' + JSON.stringify(request.responseSchema) },
      { role: 'user', content: JSON.stringify({ context: request.context }) },
    ], stream: false, temperature: 0, max_tokens: maxOutputTokens,
    ...(thinkingMode === 'disabled' ? { chat_template_kwargs: { enable_thinking: false } } : {}) };
  }
  return Object.freeze({
    id, countMode: 'estimated_tokens', localResourcePolicy,
    countText: bytes,
    prepare(request) {
      const body = JSON.stringify(payload(request));
      // UTF-8 bytes plus a fixed framing allowance is an estimate, not a verified tokenizer.
      const inputTokens = bytes(body) + 1024;
      return { body, inputTokens, maxCostUnits: inputTokens + maxOutputTokens };
    },
    async complete({ body, signal, maxOutputTokens: output, maxResponseBytes }) {
      if (output !== maxOutputTokens || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 ||
          typeof body !== 'string' || bytes(body) > 65536) throw new TypeError('invalid_local_completion');
      const packet = JSON.parse(body);
      const expectedKeys = ['model', 'messages', 'stream', 'temperature', 'max_tokens',
        ...(thinkingMode === 'disabled' ? ['chat_template_kwargs'] : [])];
      if (Object.keys(packet).length !== expectedKeys.length || expectedKeys.some(k => !Object.hasOwn(packet, k)) ||
          packet.model !== modelId || packet.stream !== false || packet.temperature !== 0 || packet.max_tokens !== output ||
          thinkingMode === 'disabled' && JSON.stringify(packet.chat_template_kwargs) !== '{"enable_thinking":false}') {
        throw new TypeError('local_payload_mismatch');
      }
      const result = await transport.generate({ messages: packet.messages, signal });
      const { text, ...metadata } = result;
      records.push({ ...metadata, bodySha256: createHash('sha256').update(body).digest('hex'),
        resourceUnit: 'local_compute_tokens' });
      const usage = result.usageKnown ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        costUnits: result.usage.inputTokens + result.usage.outputTokens } : null;
      // Keep known native counters for malformed/truncated text; never repair or retry a proposal.
      return { text: result.ok && bytes(text) <= maxResponseBytes ? text : null, usage };
    },
    get records() { return structuredClone(records); },
    get transportState() { return transport.state; },
  });
}

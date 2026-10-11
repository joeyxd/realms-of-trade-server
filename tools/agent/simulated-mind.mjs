import { canonicalJson } from './contract.mjs';
import { bytes, copy } from './mind-contract.mjs';

// Simulated tokens are one UTF-8 byte each, and cost units are lab units, never money.
// This pure fixture uses the exact same admission and reply path as injected adapters.
export function createSimulatedMind({ decision = { type: 'wait', args: {} }, delayMs = 0, conversationReply = null, goalPolicy = false, memoryPolicy = false } = {}) {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new TypeError('invalid simulated delay');
  if (conversationReply !== null && typeof conversationReply !== 'string') throw new TypeError('invalid simulated reply');
  if (typeof goalPolicy !== 'boolean') throw new TypeError('invalid simulated goal policy');
  if (typeof memoryPolicy !== 'boolean') throw new TypeError('invalid simulated memory policy');
  const text = canonicalJson({ v: 1, decision: copy(decision) });
  return {
    id: 'simulated-mind-v1', countMode: 'simulated_tokens', countText: bytes,
    prepare(request) {
      const body = canonicalJson(request), inputTokens = bytes(body);
      return { body, inputTokens, maxCostUnits: inputTokens + request.maxOutputTokens };
    },
    async complete({ body, signal }) {
      if (signal.aborted) throw new Error('aborted');
      if (delayMs) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delayMs);
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('aborted')); };
        signal.addEventListener('abort', abort, { once: true });
      });
      // A scripted line is transport/contract evidence, not a language quality claim.
      const packet = JSON.parse(body), turn = packet.context.required.tools?.goalRevision;
      const observed = packet.context.required.observation.confirmed.self;
      const goalDecision = goalPolicy && turn ? { type: 'revise_goals', args: {
        goals: [{ id: 'stay-safe', status: 'active', text: observed.hp < observed.maxHp / 2 ? 'Mantener distancia y conservar salud.' : 'Acompañar al dueño con cautela.',
          constraints: ['Solo capacidades autorizadas', 'Conservar resultados inciertos'] }],
        reason: 'Revisión de ensayo basada en la salud recibida del servidor.', basis: [`observation:${packet.context.required.observation.revision}`] } } : null;
      const memoryTurn = packet.context.required.tools?.memoryCompaction;
      const memoryDecision = memoryPolicy && memoryTurn ? { type: 'summarize_memory', args: {
        text: 'Resumen de ensayo: revisar las observaciones históricas y sus resultados pendientes antes de planear. Ningún episodio demuestra completar un encuentro.',
        tags: memoryTurn.policy.allowedTags.slice(0, 16), basis: memoryTurn.sources.map((e) => e.id) } } : null;
      const responseText = memoryDecision ? canonicalJson({ v: 1, decision: memoryDecision }) : goalDecision ? canonicalJson({ v: 1, decision: goalDecision }) : conversationReply !== null && JSON.parse(body).context.required.tools?.conversation ?
        canonicalJson({ v: 1, decision: { type: 'reply', args: { text: conversationReply } } }) : text;
      const outputTokens = bytes(responseText);
      return { text: responseText, usage: { inputTokens: bytes(body), outputTokens, costUnits: bytes(body) + outputTokens } };
    },
  };
}

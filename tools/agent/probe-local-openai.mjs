import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLocalOpenAITransport } from './local-openai-transport.mjs';
import { MIND_INSTRUCTIONS, MIND_RESPONSE_SCHEMA, CONVERSATION_INSTRUCTIONS,
  CONVERSATION_RESPONSE_SCHEMA, parseDecision, validReplyText } from './mind-contract.mjs';

const LIMITS = Object.freeze({ maxCalls: 3, maxOutputTokens: 512, timeoutMs: 30_000,
  maxInputBytes: 16_384, maxResponseBytes: 262_144 });
const help = `Canario local sintético; no ejecuta acciones ni envía chat al juego.
node tools/agent/probe-local-openai.mjs --base-url http://127.0.0.1:8080/v1 --model MODEL --report .scratch/report.json
Opcional: --thinking-mode disabled, solo si verificaste la extensión de plantilla llama.cpp.
El informe debe ser nuevo. Máximo tres llamadas: wait, saludo propuesto y aborto final.
Solo loopback IPv4 sin clave. Sin retries, fallback, streaming o herramientas.
El uso ausente queda desconocido y bloquea la instancia; abortar HTTP no prueba detener el modelo.
El coste es null. Este laboratorio no es un ledger durable ni una conexión del alfa.
`;

function argumentsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--base-url', '--model', '--report', '--thinking-mode'].includes(key) || Object.hasOwn(args, key) ||
        typeof argv[i + 1] !== 'string' || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('invalid_arguments');
    }
    args[key] = argv[++i];
  }
  if (!['--base-url', '--model', '--report'].every(key => Object.hasOwn(args, key))) throw new Error('invalid_arguments');
  return { baseUrl: args['--base-url'], modelId: args['--model'], reportPath: resolve(args['--report']),
    thinkingMode: args['--thinking-mode'] ?? 'server_default' };
}

// Persist only transport metadata and validated synthetic proposals, never model reasoning.
function evidence(result) {
  const { text, ...metadata } = result;
  return metadata;
}

export async function runLocalProbe({ baseUrl, modelId, reportPath, thinkingMode = 'server_default' }) {
  const transport = createLocalOpenAITransport({ baseUrl, modelId, thinkingMode, ...LIMITS });
  const file = await open(reportPath, 'wx', 0o600);
  const report = { schema: 'mn.local-inference.canary.v1', at: new Date().toISOString(),
    baseUrl, modelId, thinkingMode, apiKeyUsed: false, limits: LIMITS,
    scope: 'Synthetic local proposals only; no gameplay, player context, memory, ledger or production activation',
    state: 'starting', steps: [], calls: 0, actionsExecuted: 0, chatsSent: 0,
    costNanoUsd: null, pass: false };
  async function save() {
    const body = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    // The exclusive report is an observation trace, not a crash-safe allowance.
    let written = 0;
    while (written < body.length) {
      const result = await file.write(body, written, body.length - written, written);
      if (result.bytesWritten < 1) throw new Error('report_write_failed');
      written += result.bytesWritten;
    }
    await file.truncate(body.length);
    await file.sync();
  }
  async function proposal(name, messages, validate) {
    const step = { name, state: 'inflight' };
    report.steps.push(step);
    report.state = name;
    await save();
    const result = await transport.generate({ messages });
    const parsed = result.ok && result.usageKnown ? validate(result.text) : null;
    Object.assign(step, { state: 'complete', transport: evidence(result), pass: parsed !== null });
    if (parsed) step.proposal = parsed;
    report.calls = transport.state.calls;
    await save();
    return step.pass;
  }
  try {
    await save();
    const waited = await proposal('decision', [
      { role: 'system', content: MIND_INSTRUCTIONS + '\nJSON schema: ' + JSON.stringify(MIND_RESPONSE_SCHEMA) },
      { role: 'user', content: JSON.stringify({ test: 'synthetic_closed_context', observations: [], capabilities: [],
        instruction: 'For this canary choose wait with empty args. Return the JSON object only.' }) },
    ], (text) => {
      const parsed = parseDecision(text, 8192, 'decision');
      return parsed?.type === 'wait' ? parsed : null;
    });
    const replied = waited && await proposal('conversation', [
      { role: 'system', content: CONVERSATION_INSTRUCTIONS + '\nJSON schema: ' + JSON.stringify(CONVERSATION_RESPONSE_SCHEMA) },
      { role: 'user', content: JSON.stringify({ test: 'synthetic_closed_context', personality: 'Amable; habla español.',
        deliveredMessage: { sender: 'fictional-human', text: 'Hola' },
        instruction: 'Propose a simple friendly greeting, no more than 160 characters. Choose reply. It will not be sent. Return the JSON object only.' }) },
    ], (text) => {
      const parsed = parseDecision(text, 8192, 'conversation');
      return parsed?.type === 'reply' && validReplyText(parsed.args.text, 160) ? parsed : null;
    });
    if (replied) {
      const step = { name: 'cancellation', state: 'inflight', abortAfterMs: 200 };
      report.steps.push(step);
      report.state = step.name;
      await save();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), step.abortAfterMs);
      let result;
      try {
        result = await transport.generate({ signal: controller.signal, messages: [
          { role: 'system', content: 'Synthetic transport cancellation test. No tools or real-world actions.' },
          { role: 'user', content: 'Output the complete JSON array of integers from 0 to 199, one by one, without commentary.' },
        ] });
      } finally { clearTimeout(timer); }
      const after = transport.state;
      // This invocation must be rejected locally. It never retries the cancelled request.
      const blocked = after.uncertain && result.dispatched && !result.usageKnown
        ? await transport.generate({ messages: [{ role: 'user', content: 'Guard check; must not dispatch.' }] })
        : { why: 'not_checked', dispatched: false };
      Object.assign(step, { state: 'complete', transport: evidence(result), after,
        guard: evidence(blocked), pass: result.why === 'aborted' && result.dispatched && !result.usageKnown &&
          result.executionMayContinue && after.uncertain && !after.inFlight &&
          blocked.why === 'uncertain_blocked' && !blocked.dispatched && transport.state.calls === after.calls });
      report.pass = waited && replied && step.pass;
    }
    report.calls = transport.state.calls;
    report.transportState = transport.state;
    const known = report.steps.filter((step) => step.transport?.usageKnown).map((step) => step.transport.usage);
    report.knownUsage = { calls: known.length, inputTokens: known.reduce((sum, use) => sum + use.inputTokens, 0),
      outputTokens: known.reduce((sum, use) => sum + use.outputTokens, 0) };
    report.unknownCalls = report.steps.filter((step) => step.transport?.dispatched && !step.transport.usageKnown).length;
    report.state = report.pass ? 'passed' : 'failed';
    await save();
    return report;
  } catch (error) {
    report.state = 'runtime_error';
    report.calls = transport.state.calls;
    report.transportState = transport.state;
    // Error messages may contain request/response data; do not serialize them.
    try { await save(); } catch { /* Keep the original trace if the disk is unavailable. */ }
    throw new Error('probe_runtime_error', { cause: error });
  } finally { await file.close(); }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') { process.stdout.write(help); return; }
  const report = await runLocalProbe(argumentsFrom(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({ type: 'local_inference_canary', pass: report.pass, model: report.modelId,
    calls: report.calls, knownUsage: report.knownUsage, unknownCalls: report.unknownCalls,
    checks: report.steps.map(({ name, pass, transport }) => ({ name, pass, why: transport.why,
      latencyMs: transport.latencyMs })), actionsExecuted: 0, chatsSent: 0, costNanoUsd: null }) + '\n');
  if (!report.pass) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ type: 'local_inference_canary', pass: false,
      why: 'configuration_report_or_runtime_error' }) + '\n');
    process.exitCode = 1;
  });
}

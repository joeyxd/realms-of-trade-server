import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentNetworkRunner } from './network-runner.mjs';
import { loadOwnerFiles } from './owner-files.mjs';
import { createObjectiveStore } from './objective-store.mjs';
import { createMemoryStore } from './memory-store.mjs';
import { buildRunnerContext } from './runner-context.mjs';
import { NETWORK_CAPABILITIES, validGrant } from './contract.mjs';
import { AgentMind } from './mind.mjs';
import { InferenceBudget } from './inference-budget.mjs';
import { PersistentInferenceBudget } from './persistent-budget.mjs';
import { runnerMindSnapshot } from './mind-snapshot.mjs';
import { createSimulatedMind } from './simulated-mind.mjs';

const write = (type, data) => process.stdout.write(`${JSON.stringify({ type, data })}\n`);
const help = `Cliente de desarrollo L01/L02 (invitado por defecto, sin LLM).
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files C:/ruta/brisa --owner owner-lab --character brisa-lab --world world-lab
Opcional autenticado: --account-token-env NOMBRE_VARIABLE. El valor secreto se lee solo de process.env; nunca lo pases como argumento.
En modo autenticado, --owner y --character deben ser UUID del dueño autenticado y personaje administrado; --world debe coincidir con la política server-owned.
Opcionales: --name "Brisa [IA]" --capabilities move,aim,attack_pve,body_pve,chat --minutes 5 --inspect --stay-open
JSON por stdin: observe, files, context, actions, chat, lifecycle, stop, exit; order/chat_send con campo order (sobre v1); chat_retry con requestId; cancel con actionId.
Lecturas privadas / Private reads: inventory_read y market_read con query v1; inventory y market inspeccionan el ledger. Requieren inventory_read/market_read en el grant autenticado; market_read solo admite list o quote, sin mover bienes / only list or quote, no goods movement.
Movimiento con capacidad move: go_to, follow, keep_distance; rutas directas locales y resultados inspeccionables, sin navegación global.
body_pve requiere move,aim,attack_pve,body_pve; modos aggressive/defensive/support, reservas propias y ataque suprimido cerca de otros jugadores.
Con --stay-open: reenter explícito tras cierre; modo invitado crea un cuerpo local nuevo. Modo autenticado pide un grant nuevo al servidor y nunca reanuda tareas; self-stop libera el lease y permite conexión fresca, mientras stop/revoke del dueño requiere resume explícito y conexión fresca.
L03a opt-in: --mind simulated; think inicia una consulta simulada, mind inspecciona límites/uso, mind_cancel invalida su respuesta sin detener el cuerpo.
L03b: respond con messageId responde una vez a un mensaje entregado, con una línea de fixture; no hay escucha/respuesta automática. Requiere capacidad chat.
L03c: --mind-goals habilita revise_goals para actualizar objectives.json desde feedback con una política simulada. No modifica personalidad/memoria ni declara encuentros completados.
L04a: --mind-memory habilita remember (episodio sin inferencia) y compact_memory con sourceIds (resumen simulado presupuestado). memory.jsonl conserva fuentes originales y resúmenes; lectura/búsqueda acotada entre sesiones. No hay captura por tick ni repetición automática.
L05a: --mind-budget C:/ruta/presupuesto usa el archivo ya inicializado por manage-budget.mjs; no reinicia límites al reentrar. inference_budget refresca uso/límites; avisos inference_budget_notice bloquean nuevas consultas sin parar el cuerpo. Sin esta opción, el ledger de ensayo sigue por proceso.
Política de ensayo: --conversation-channels local,whisper --conversation-max-turns 32 --conversation-max-replies 1 --conversation-cooldown 5000. Mundo requiere incluir world explícitamente.
Límites de ensayo configurables: --mind-max-calls 8 --mind-max-tokens 100000 --mind-max-cost 100000 --mind-timeout 1000. Tokens/coste son unidades simuladas, sin proveedor ni cobro real.
El modo invitado usa identificadores locales y una plaza normal. El token no se imprime ni se guarda en archivos del dueño.\n`;

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--help') { process.stdout.write(help); return; }
    if (key === '--inspect') { args.inspect = true; continue; }
    if (key === '--stay-open') { args.stayOpen = true; continue; }
    if (key === '--mind-goals') { args['mind-goals'] = true; continue; }
    if (key === '--mind-memory') { args['mind-memory'] = true; continue; }
    if (!['--url', '--files', '--owner', '--character', '--world', '--name', '--capabilities', '--minutes', '--account-token-env', '--mind', '--mind-budget', '--mind-max-calls', '--mind-max-tokens', '--mind-max-cost', '--mind-timeout', '--conversation-channels', '--conversation-max-turns', '--conversation-max-replies', '--conversation-cooldown'].includes(key) || !process.argv[i + 1] || Object.hasOwn(args, key.slice(2))) throw new Error('invalid_arguments');
    args[key.slice(2)] = process.argv[++i];
  }
  const scope = { ownerId: args.owner, characterId: args.character, worldId: args.world, sessionId: randomUUID() };
  const minutes = Number(args.minutes ?? 5), capabilities = (args.capabilities ?? 'move,aim').split(',');
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60 || !args.files || !args.url) throw new Error('invalid_arguments');
  let authorization = null;
  if (args['account-token-env'] !== undefined) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(args['account-token-env']) || !process.env[args['account-token-env']]) {
      throw Object.assign(new Error('authorization token unavailable'), { code: 'authorization_token_unavailable' });
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(scope.ownerId ?? '') || !uuid.test(scope.characterId ?? '')) throw new Error('invalid_authenticated_scope');
    authorization = { token: process.env[args['account-token-env']] };
  }
  const grant = { v: 1, scope, controlRevision: 1, expiresAtMs: Date.now() + minutes * 60000, capabilities };
  if (!validGrant(grant) || capabilities.some((c) => !NETWORK_CAPABILITIES.includes(c))) throw new Error('invalid_grant');
  const memoryScope = { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId };
  const directory = resolve(args.files);
  if (args.mind !== undefined && args.mind !== 'simulated') throw new Error('unsupported_mind');
  if (!args.mind && Object.keys(args).some((k) => k.startsWith('mind-') || k.startsWith('conversation-'))) throw new Error('mind_disabled');
  let files = await loadOwnerFiles({ directory, scope: memoryScope });
  write('owner_files', files);
  if (args.inspect) return;
  let mind = null;
  let budget = null;
  if (args['mind-budget'] && ['mind-max-calls', 'mind-max-tokens', 'mind-max-cost'].some((k) => Object.hasOwn(args, k))) throw new Error('durable_budget_has_owner_limits');
  if (args['mind-budget']) budget = await PersistentInferenceBudget.open({ directory: resolve(args['mind-budget']), scope: memoryScope });
  const agent = new AgentNetworkRunner({ url: args.url, grant, ...(authorization ? { authorization } : {}), name: args.name ?? 'Brisa [IA]', onFeedback: (event) => {
    // Idle input ticks are routine; observations and action-bearing inputs remain reviewable.
    if (event.type !== 'input' || event.data.actionId) write(event.type, event.data);
    if (event.type === 'stopped') { mind?.cancel(); if (!args.stayOpen) process.stdin.destroy(); }
  } });
  if (args.mind) {
    budget = budget ??
      new InferenceBudget({ scope: memoryScope, limits: { maxCalls: Number(args['mind-max-calls'] ?? 8),
        maxTokens: Number(args['mind-max-tokens'] ?? 100000), maxCostUnits: Number(args['mind-max-cost'] ?? 100000), maxEntries: 64 } });
    mind = new AgentMind({ adapter: createSimulatedMind({ conversationReply: 'Con calma, compañero. Te escucho.', goalPolicy: args['mind-goals'] === true, memoryPolicy: args['mind-memory'] === true }), budget,
      readSnapshot: async () => { files = await loadOwnerFiles({ directory, scope: memoryScope }); return runnerMindSnapshot(agent, files); },
      submitOrder: (order) => agent.order(order), sendChat: (order) => agent.sendChat(order),
      ...(args['mind-goals'] ? { commitGoals: createObjectiveStore({ directory, scope: memoryScope }).commit,
        readCommitSnapshot: () => runnerMindSnapshot(agent, files) } : {}),
      ...(args['mind-memory'] ? { appendMemory: createMemoryStore({ directory, scope: memoryScope }).append,
        readCommitSnapshot: () => runnerMindSnapshot(agent, files) } : {}),
      conversationPolicy: { channels: (args['conversation-channels'] ?? 'local,whisper').split(','),
        maxTurns: Number(args['conversation-max-turns'] ?? 32), maxRepliesPerPeer: Number(args['conversation-max-replies'] ?? 1),
        cooldownMs: Number(args['conversation-cooldown'] ?? 5000) },
      limits: { timeoutMs: Number(args['mind-timeout'] ?? 1000) } });
  }
  const stop = () => { mind?.cancel(); agent.stop(scope.ownerId); process.stdin.destroy(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const ready = await agent.connect();
    write('ready', { ...ready, grant: agent.grant, authority: agent.authority?.grant ? 'server_controller' : 'local_runner_only', inferenceCalls: 0, gameSpendingEnabled: false });
    if (mind) write('mind', mind.state);
    const publishMind = (type, result) => {
      write(type, result);
      if (!result.ok && /^(?:budget_|max_calls|max_tokens|max_cost_units|entry_capacity|reservation_unavailable|provider_limit_overrun)/.test(result.why ?? ''))
        write('inference_budget_notice', { why: result.why, requestBlocked: true, bodyStoppedByBudget: false, ledger: budget.snapshot });
    };
    const handle = async (raw) => {
      let message;
      try { message = JSON.parse(raw); } catch { write('rejected', { why: 'invalid_json' }); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { write('rejected', { why: 'invalid_message' }); return; }
      const keys = ['inventory_read', 'market_read'].includes(message.type) ? ['type', 'query'] : ['order', 'chat_send'].includes(message.type) ? ['type', 'order'] : message.type === 'respond' ? ['type', 'messageId'] : message.type === 'compact_memory' ? ['type', 'sourceIds'] : message.type === 'chat_retry' ? ['type', 'requestId'] : message.type === 'cancel' ? ['type', 'actionId'] : ['type'];
      if (Object.keys(message).length !== keys.length || !keys.every((key) => Object.hasOwn(message, key))) { write('rejected', { why: 'invalid_message' }); return; }
      switch (message.type) {
        case 'order': mind?.cancel(); write('order_response', agent.order(message.order)); break;
        case 'observe': write('current', { state: agent.state, observation: agent.observation }); break;
        case 'actions': write('actions', agent.actions); break;
        case 'inventory': write('inventory', agent.inventory); break;
        case 'market': write('market', agent.market); break;
        case 'inventory_read': write('inventory_read_response', agent.readInventory(message.query)); break;
        case 'market_read': write('market_read_response', agent.readMarket(message.query)); break;
        case 'cancel': mind?.cancel(); write('cancel_response', agent.cancel(message.actionId, scope.ownerId)); break;
        case 'chat': write('chat', agent.chat); break;
        case 'chat_send': write('chat_send_response', agent.sendChat(message.order)); break;
        case 'chat_retry': write('chat_retry', agent.retryChat(message.requestId)); break;
        case 'lifecycle': write('lifecycle', agent.lifecycle); break;
        case 'think':
          if (!mind) write('rejected', { why: 'mind_disabled' });
          // Do not await inference in the stdin loop: stop/exit stay responsive during I/O.
          else void mind.decide().then((result) => publishMind('mind_result', result));
          break;
        case 'revise_goals':
          if (!mind) write('rejected', { why: 'mind_disabled' });
          else void mind.reviseGoals().then((result) => publishMind('goals_result', result));
          break;
        case 'remember':
          if (!mind) write('rejected', { why: 'mind_disabled' });
          else void mind.remember().then((result) => write('memory_result', result));
          break;
        case 'compact_memory':
          if (!mind) write('rejected', { why: 'mind_disabled' });
          else void mind.compactMemory({ sourceIds: message.sourceIds }).then((result) => publishMind('compaction_result', result));
          break;
        case 'respond':
          if (!mind) write('rejected', { why: 'mind_disabled' });
          else void mind.converse({ messageId: message.messageId }).then((result) => publishMind('conversation_result', result));
          break;
        case 'mind': if (mind) write('mind', mind.state); else write('rejected', { why: 'mind_disabled' }); break;
        case 'inference_budget':
          if (!budget) write('rejected', { why: 'mind_disabled' });
          else write('inference_budget', budget.refresh ? await budget.refresh() : { ok: true, snapshot: budget.snapshot });
          break;
        case 'mind_cancel': write('mind_cancel', mind ? mind.cancel() : { ok: false, why: 'mind_disabled' }); break;
        case 'reenter': {
          if (!args.stayOpen) { write('rejected', { why: 'reentry_disabled' }); break; }
          try { files = await loadOwnerFiles({ directory, scope: memoryScope }); }
          catch (error) { write('rejected', { why: error.code ?? 'owner_files_unavailable' }); break; }
          const result = await agent.reenter(scope.ownerId);
          write('reenter_response', { ...result, inferenceCalls: 0, gameSpendingEnabled: false });
          if (result.ok) write('owner_files', files);
          break;
        }
        case 'exit': mind?.close(); agent.close(); process.stdin.destroy(); break;
        case 'files':
          try { files = await loadOwnerFiles({ directory, scope: memoryScope }); write('owner_files', files); }
          catch (error) { write('rejected', { why: error.code ?? 'owner_files_unavailable' }); }
          break;
        case 'context': {
          // Always refresh the actual files before assembling a context. Never call a provider.
          try { files = await loadOwnerFiles({ directory, scope: memoryScope }); }
          catch (error) { write('rejected', { why: error.code ?? 'owner_files_unavailable' }); break; }
          const memorySnapshot = runnerMindSnapshot(agent, files);
          const required = memorySnapshot.required;
          required.rules.inferenceEnabled = false;
          const context = buildRunnerContext({ required, memory: memorySnapshot.memory, queryTags: memorySnapshot.queryTags,
            candidateRanks: memorySnapshot.candidateRanks ?? null, scope: memoryScope, nowMs: Date.now() });
          write('context', { ...context, ownerFileHashes: Object.fromEntries(Object.entries(files.files).map(([key, file]) => [key, file.sha256])), ownerHistory: files.files.memory.report,
            memoryRetrieval: memorySnapshot.memoryRetrieval, inferenceCalls: 0 });
          break;
        }
        case 'stop': mind?.cancel(); write('stop_response', agent.stop(scope.ownerId)); break;
        default: write('rejected', { why: 'unsupported' });
      }
    };
    // Bound each JSON line before parsing; a giant partial line cannot accumulate indefinitely.
    let pending = Buffer.alloc(0);
    try {
      for await (const chunk of process.stdin) {
        if (agent.state === 'stopped' && !args.stayOpen) break;
        let offset = 0;
        while (offset < chunk.length) {
          const end = chunk.indexOf(10, offset), part = chunk.subarray(offset, end < 0 ? chunk.length : end);
          if (pending.length + part.length > 16384) { write('rejected', { why: 'input_too_large' }); stop(); return; }
          pending = Buffer.concat([pending, part]);
          if (end < 0) break;
          await handle(pending.toString('utf8')); pending = Buffer.alloc(0); offset = end + 1;
          if ((agent.state === 'stopped' && !args.stayOpen) || agent.closed) return;
        }
      }
    } catch (error) {
      if (!(error?.code === 'ERR_STREAM_PREMATURE_CLOSE' && agent.state === 'stopped' && !args.stayOpen)) throw error;
    }
    if (pending.length && (agent.state !== 'stopped' || args.stayOpen) && !agent.closed) await handle(pending.toString('utf8'));
  } finally {
    mind?.close();
    if (agent.state === 'stopping') await agent.waitClosed(2000);
    agent.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}

main().catch((error) => { write('error', { code: error.code ?? 'configuration_or_runtime_error' }); process.exitCode = 1; });

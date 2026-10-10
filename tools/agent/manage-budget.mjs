import { resolve } from 'node:path';
import { createBudgetAdministration } from './persistent-budget.mjs';

const output = (data) => process.stdout.write(JSON.stringify({ type: 'inference_budget', data }) + '\n');
const help = `Presupuesto local de inferencia simulada, sin proveedor ni red.
node tools/agent/manage-budget.mjs --files C:/ruta/presupuesto --owner owner-lab --character brisa-lab --world world-lab
JSON por stdin: initialize con allowanceId, period:{startsAtMs,endsAtMs}, limits:{maxCalls,maxTokens,maxCostUnits,maxEntries};
inspect; configure con expectedRevision, enabled y limits; reconcile con requestId y usage:{inputTokens,outputTokens,costUnits};
mark_unknown con requestId; cancel_reserved con requestId; exit.
No se reinicia el periodo ni se borran recibos. Configure conserva consumo y reservas.
Unidades de ensayo, no dinero. Reconcile declara evidencia del adaptador; no calcula costes ni llama un modelo.
Acceso local al directorio del dueño; no autentica usuarios remotos.\n`;

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') { process.stdout.write(help); return; }
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!['--files', '--owner', '--character', '--world'].includes(key) || !process.argv[i + 1] || Object.hasOwn(args, key.slice(2))) throw new Error('invalid_arguments');
    args[key.slice(2)] = process.argv[++i];
  }
  if (Object.keys(args).length !== 4) throw new Error('invalid_arguments');
  const admin = createBudgetAdministration({ directory: resolve(args.files), scope: { ownerId: args.owner, characterId: args.character, worldId: args.world } });
  let ended = false;
  const fields = { initialize: ['allowanceId', 'period', 'limits'], inspect: [], configure: ['expectedRevision', 'enabled', 'limits'],
    reconcile: ['requestId', 'usage'], mark_unknown: ['requestId'], cancel_reserved: ['requestId'], exit: [] };
  async function handle(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { output({ ok: false, why: 'invalid_json' }); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string' || !Object.hasOwn(fields, message.type) || Object.keys(message).length !== fields[message.type].length + 1 ||
        !fields[message.type].every((key) => Object.hasOwn(message, key))) { output({ ok: false, why: 'invalid_message' }); return; }
    const { type, ...request } = message;
    if (type === 'exit') { ended = true; output({ ok: true, closed: true }); return; }
    if (type === 'initialize' || type === 'configure') output(await admin[type](request));
    else if (type === 'inspect') output(await admin.inspect());
    else if (type === 'reconcile') output(await admin.settle(request.requestId, request.usage));
    else if (type === 'mark_unknown') output(await admin.markUnknown(request.requestId, 'owner_reconciliation'));
    else output(await admin.cancelBeforeDispatch(request.requestId));
  }
  let pending = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset), part = chunk.subarray(offset, end < 0 ? chunk.length : end);
      if (pending.length + part.length > 65536) { output({ ok: false, why: 'input_too_large' }); return; }
      pending = Buffer.concat([pending, part]);
      if (end < 0) break;
      await handle(pending.toString('utf8')); pending = Buffer.alloc(0); offset = end + 1;
      if (ended) return;
    }
  }
  if (pending.length && !ended) await handle(pending.toString('utf8'));
}
main().catch(() => { output({ ok: false, why: 'configuration_or_runtime_error' }); process.exitCode = 1; });

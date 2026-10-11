import { resolve } from 'node:path';
import { createOwnerPanel } from './owner-panel-server.mjs';

const help = `Panel local del dueño — L05b (inferencia simulada).
node tools/agent/owner-panel.mjs --files C:/ruta/personaje --budget C:/ruta/presupuesto --owner owner-lab --character brisa-lab --world world-lab
Opcional: --url ws://127.0.0.1:5173/ws --account-token-env NOMBRE_VARIABLE --capabilities move,aim --minutes 5 --port 5197
Sin --url permite leer archivos y administrar presupuesto. Con --url el botón Iniciar abre un runner simulado explícito.
Inicializa el presupuesto con manage-budget.mjs. La dirección de acceso que se imprime es privada y caduca al cerrar el panel.
No carga .env, llama a proveedores de inferencia ni concede permisos del juego.\n`;

async function main() {
  if (process.argv.slice(2).includes('--help')) { process.stdout.write(help); return; }
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    if (!['--files', '--budget', '--owner', '--character', '--world', '--url', '--account-token-env', '--capabilities', '--minutes', '--port'].includes(key) ||
        !process.argv[index + 1] || Object.hasOwn(args, key.slice(2))) throw new Error('invalid_arguments');
    args[key.slice(2)] = process.argv[index + 1];
  }
  if (['files', 'budget', 'owner', 'character', 'world'].some((key) => !args[key]) || !args.url &&
      ['account-token-env', 'capabilities', 'minutes'].some((key) => Object.hasOwn(args, key))) throw new Error('invalid_arguments');
  const panel = await createOwnerPanel({ directory: resolve(args.files), budgetDirectory: resolve(args.budget),
    scope: { ownerId: args.owner, characterId: args.character, worldId: args.world },
    ...(args.url ? { runnerOptions: { url: args.url, accountTokenEnv: args['account-token-env'],
      capabilities: (args.capabilities ?? 'move,aim').split(','), minutes: Number(args.minutes ?? 5) } } : {}) });
  const listening = await panel.listen(Number(args.port ?? 5197));
  process.stdout.write(`Panel del dueño: ${listening.url}\n`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await panel.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
main().catch(() => { process.stderr.write('No se pudo abrir el panel. Revisa rutas, identidad, puerto y configuración del runner.\n'); process.exitCode = 1; });

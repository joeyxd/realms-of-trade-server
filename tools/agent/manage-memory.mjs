import { resolve } from 'node:path';
import { createMemoryAdministration } from './memory-admin.mjs';

const output = (data) => process.stdout.write(JSON.stringify({ type: 'memory_admin', data }) + '\n');
const help = `Administración local del archivo de un personaje (sin red ni proveedor).
node tools/agent/manage-memory.mjs --files C:/ruta/personaje --owner owner-lab --character brisa-lab --world world-lab
JSON por stdin: files, export, inspect (query/limit/offset opcionales), preview_delete con ids,
preview_retention con retention:{expired:true,beforeMs:null}, commit_delete con previewId;
preview_migrate y commit_migrate con previewId; exit.
La vista previa muestra originales/derivados afectados; el commit exige su ID y hashes vigentes.
La retención es explícita. No hay borrado automático ni edición de personalidad/objetivos.
Export devuelve los tres archivos reales en base64 con hashes; conserva BOM y finales de línea.
Acceso local del dueño del directorio; no es un servicio autenticado para otros usuarios.\n`;
async function main() {
  const args = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === '--help' && process.argv.length === 3) { process.stdout.write(help); return; }
    if (!['--files', '--owner', '--character', '--world'].includes(key) || !process.argv[index + 1] || Object.hasOwn(args, key.slice(2))) throw new Error('invalid_arguments');
    args[key.slice(2)] = process.argv[++index];
  }
  if (Object.keys(args).length !== 4) throw new Error('invalid_arguments');
  const admin = createMemoryAdministration({ directory: resolve(args.files), scope: { ownerId: args.owner, characterId: args.character, worldId: args.world } });
  let ended = false;
  async function handle(line) {
    let message;
    try { message = JSON.parse(line); } catch { output({ ok: false, why: 'invalid_json' }); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { output({ ok: false, why: 'invalid_message' }); return; }
    const allowed = { files: [], export: [], inspect: ['query', 'limit', 'offset'], preview_delete: ['ids'], preview_retention: ['retention'],
      commit_delete: ['previewId'], preview_migrate: [], commit_migrate: ['previewId'], exit: [] };
    const fields = allowed[message.type];
    if (!Object.hasOwn(allowed, message.type) || Object.keys(message).some((key) => key !== 'type' && !fields.includes(key)) ||
        message.type !== 'inspect' && fields.some((key) => !Object.hasOwn(message, key))) { output({ ok: false, why: 'invalid_message' }); return; }
    const { type, ...request } = message;
    const methods = { files: 'files', export: 'exportFiles', inspect: 'inspect', preview_delete: 'previewRemoval', preview_retention: 'previewRemoval',
      commit_delete: 'commitRemoval', preview_migrate: 'previewMigration', commit_migrate: 'commitMigration' };
    if (type === 'exit') { ended = true; output({ ok: true, closed: true }); return; }
    output(await admin[methods[type]](request));
  }
  // Bound input before parsing, including a partial line without a newline.
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

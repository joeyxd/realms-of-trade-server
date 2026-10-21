#!/usr/bin/env node
import { emitKeypressEvents } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PairedCompanion } from './paired-companion.mjs';

export function argumentsOf(argv) {
  const values = {};
  const flags = new Set(['--url', '--directory', '--base-url', '--model', '--max-calls', '--max-tokens']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!flags.has(key) || values[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('invalid_arguments');
    values[key] = argv[++i];
  }
  if (!values['--url'] || !values['--directory']) throw new Error('invalid_arguments');
  const maxCalls = Number(values['--max-calls'] ?? 8), maxTokens = Number(values['--max-tokens'] ?? 1000000);
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 8 || !Number.isSafeInteger(maxTokens) || maxTokens < 32768 || maxTokens > 1000000)
    throw new Error('invalid_arguments');
  return { url: values['--url'], directory: path.resolve(values['--directory']),
    ...(values['--base-url'] ? { baseUrl: values['--base-url'] } : {}), ...(values['--model'] ? { modelId: values['--model'] } : {}),
    maxCalls, maxTokens };
}

export async function privateLine(input, output) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('private_terminal_required');
  emitKeypressEvents(input); input.setRawMode(true); input.resume(); output.write('Código de emparejamiento (entrada oculta): ');
  return await new Promise((resolve, reject) => {
    let value = '';
    const finish = (error = null) => {
      input.off('keypress', onKey); input.setRawMode(false); input.pause?.(); output.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') { finish(new Error('cancelled')); return; }
      if (key.name === 'return' || key.name === 'enter') { finish(); return; }
      if (key.name === 'backspace') { value = value.slice(0, -1); output.write('\b \b'); return; }
      if (typeof text === 'string' && text.length > 0 && /^[a-f0-9]+$/i.test(text) && value.length + text.length <= 64) {
        value += text.toLowerCase(); output.write('*'.repeat(text.length));
      }
    };
    input.on('keypress', onKey);
  });
}

export function statusMessage(status) {
  if (!status || typeof status !== 'object' || Array.isArray(status) || Object.getPrototypeOf(status) !== Object.prototype ||
      Reflect.ownKeys(status).length !== 2 || !Object.hasOwn(status, 'phase') || !Object.hasOwn(status, 'result')) return null;
  const phase = Object.getOwnPropertyDescriptor(status, 'phase'), result = Object.getOwnPropertyDescriptor(status, 'result');
  if (!phase || !result || !Object.hasOwn(phase, 'value') || !Object.hasOwn(result, 'value')) return null;
  if (phase.value === 'inference' && result.value === 'budget_exhausted') return 'No pude responder: se agotó el presupuesto local.';
  if (phase.value === 'inference' && result.value === 'failed') return 'No pude responder: falló el modelo local. Comprueba que esté disponible.';
  if (phase.value === 'delivery' && result.value === 'unconfirmed') return 'No se confirmó la entrega de la respuesta; no se guardó memoria.';
  if (phase.value === 'memory' && result.value === 'failed') return 'La respuesta se entregó, pero no se pudo guardar el recuerdo local.';
  return null;
}

const ORDER_NAMES = { follow: 'seguirte', wait: 'esperar', return: 'volver', gather: 'recolectar' };
const BODY_STATUS = { present: 'presente en el mundo', resting: 'descansando', recovery: 'recuperándose', unavailable: 'no disponible' };
const ORDER_WHY = { conflict: 'el cuerpo cambió mientras tanto y no se aplicó; inténtalo de nuevo', paced: 'diste demasiadas órdenes seguidas; espera un momento', superseded: 'una orden más reciente la reemplazó',
  unavailable: 'el cuerpo no está disponible', closed: 'la sesión ya se cerró', timeout: 'se agotó el tiempo de espera', busy: 'otra orden seguía en curso',
  no_node: 'no encuentra ese recurso', unsupported_node: 'por ahora solo recoge madera o piedra sueltas', depleted: 'ese recurso está agotado; vuelve a salir en un rato' };
const own = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && Object.hasOwn(d, 'value') ? d : null; };
const plain = o => !!o && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;

export function connectedMessage(result, modelId) {
  const model = modelId ?? 'qwen3.8-flash-next-coder-iq1_m';
  if (Array.isArray(result?.capabilities) && result.capabilities.includes('presence'))
    return `Conectado: ${result.name}. Tu compañero tiene cuerpo en el mundo y obedece "sígueme", "espera", "vuelve" y "recoge madera o piedra" en el chat (el servidor valida cada orden); modelo ${model}. Escribe r y Enter para actualizar contexto; Ctrl+C para detener.`;
  return `Conectado: ${result.name}. Solo chat; modelo ${model}. Escribe r y Enter para actualizar contexto; Ctrl+C para detener.`;
}

export function presenceMessage(event) {
  if (!plain(event) || !own(event, 'type') || event.type !== 'presence_order') return null;
  const dataD = own(event, 'data');
  if (!dataD || !plain(dataD.value)) return null;
  const data = dataD.value, op = own(data, 'op')?.value, ok = own(data, 'ok')?.value, why = own(data, 'why')?.value;
  const presence = own(data, 'presence')?.value, st = plain(presence) ? own(presence, 'status')?.value : undefined;
  const status = typeof st === 'string' && Object.hasOwn(BODY_STATUS, st) ? BODY_STATUS[st] : null;
  const gathered = plain(presence) && own(presence, 'reason')?.value === 'gathered' ? ' Ya recogió el recurso que le pediste.' : '';
  if (op === 'load') return ok === true ? (status ? `Estado del cuerpo: ${status}.${gathered}` : null) : ok === false ? 'No se pudo leer el estado del cuerpo de tu compañero.' : null;
  if (typeof op !== 'string' || !Object.hasOwn(ORDER_NAMES, op)) return null;
  if (ok === true) return `Tu compañero acepta ${ORDER_NAMES[op]}${status ? `; cuerpo ${status}` : ''}.`;
  if (ok === false) return `Tu compañero no pudo ${ORDER_NAMES[op]}: ${typeof why === 'string' && Object.hasOwn(ORDER_WHY, why) ? ORDER_WHY[why] : 'no se pudo completar la orden'}.`;
  return null;
}

async function main() {
  let options;
  try { options = argumentsOf(process.argv.slice(2)); }
  catch { process.stderr.write('Uso: node tools/agent/pair-companion.mjs --url wss://.../ws --directory <carpeta> [--base-url http://127.0.0.1:8080/v1] [--model <id>] [--max-calls 8] [--max-tokens 1000000]\n'); process.exitCode = 2; return; }
  let companion;
  try { companion = new PairedCompanion({ ...options, onStatus: status => {
    const message = statusMessage(status);
    if (message) process.stdout.write(`${message}\n`);
  }, onFeedback: event => { const m = presenceMessage(event); if (m) process.stdout.write(m + '\n'); } }); }
  catch { process.stderr.write('Opciones de emparejamiento inválidas. Revisa la URL segura, el modelo y la dirección local.\n'); process.exitCode = 2; return; }
  let code;
  try { code = await privateLine(process.stdin, process.stdout); }
  catch (error) { process.stderr.write(error.message === 'private_terminal_required' ? 'Se requiere una terminal interactiva para ocultar el código.\n' : 'Emparejamiento cancelado.\n'); process.exitCode = 2; return; }
  const result = await companion.start(code); code = '';
  if (!result.ok) { process.stderr.write('No se pudo iniciar la sesión emparejada. Revisa el código, el control del compañero y la conexión local.\n'); process.exitCode = 1; await companion.close(); return; }
  process.stdout.write(connectedMessage(result, options.modelId) + '\n');
  const stop = () => { companion.close(); process.exitCode = 0; };
  emitKeypressEvents(process.stdin);
  const onCommand = async (text, key = {}) => {
    if (key.ctrl && key.name === 'c') { stop(); return; }
    if (key.name === 'return' || key.name === 'enter') {
      const command = commandBuffer.trim().toLowerCase(); commandBuffer = '';
      if (command === 'r') {
        const refreshed = await companion.refreshContext();
        process.stdout.write(refreshed.ok ? 'Contexto local actualizado.\n' : 'No se pudo actualizar el contexto local.\n');
      }
      process.stdout.write('> '); return;
    }
    if (key.name === 'backspace') { commandBuffer = commandBuffer.slice(0, -1); return; }
    if (/^[rR]$/.test(text ?? '') && commandBuffer.length < 16) commandBuffer += text;
  };
  let commandBuffer = '';
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('keypress', onCommand);
  }
  const stopped = companion.waitForStop();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await stopped;
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.off('keypress', onCommand);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('El controlador local terminó con un error seguro.\n'); process.exitCode = 1; });
}

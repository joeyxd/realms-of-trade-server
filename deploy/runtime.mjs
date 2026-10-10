import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const PROBE_INTERVAL_MS = 15000;
const PROBE_TIMEOUT_MS = 3000;
const SHUTDOWN_TIMEOUT_MS = 85000;
const REQUIRED_NULL_STORAGE_FIELDS = [
  'staging', 'deathStaging', 'deathDrops', 'pearlGround', 'combatDeaths', 'startup',
];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Restart only the known durable-world failure state, after the server has drained all activity.
export function shouldRecoverWorldFailure(healthStatus, status) {
  if (healthStatus !== 503 || !object(status) || !object(status.storage) || !object(status.storage.world)) return false;
  const storage = status.storage;
  if (Object.hasOwn(storage, 'economic') && storage.economic !== null &&
      (!object(storage.economic) || storage.economic.enabled !== true ||
       storage.economic.pending !== 0 || storage.economic.failed !== false)) return false;
  if (Object.hasOwn(storage, 'profileWrites') && storage.profileWrites !== 0) return false;
  if (Object.hasOwn(storage, 'worldWriting') && storage.worldWriting !== false) return false;
  const world = storage.world;
  return world.failed === true && world.ready === false &&
    storage.durable === true && storage.unsaved === 0 &&
    status.players === 0 && status.sockets === 0 &&
    REQUIRED_NULL_STORAGE_FIELDS.every((key) => storage[key] === null);
}

function getJson(port, route, timeoutMs) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: route, timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* Unrecognized response. */ }
        resolve({ status: response.statusCode, json });
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

export async function probeRuntime(port, timeoutMs = PROBE_TIMEOUT_MS) {
  const [health, status] = await Promise.all([
    getJson(port, '/health', timeoutMs),
    getJson(port, '/status', timeoutMs),
  ]);
  if (!health || !status || status.status !== 200 || !object(status.json)) return null;
  return { healthStatus: health.status, status: status.json };
}

function signalNumber(signal) {
  return ({ SIGINT: 2, SIGTERM: 15 })[signal] || 1;
}

// The injectable seams keep lifecycle behavior testable without starting the real game authority.
export function runRuntimeGuard({
  child = spawn(process.execPath, [SERVER_ENTRY], { stdio: 'inherit', env: process.env }),
  probe = () => probeRuntime(Number(process.env.PORT) || 5173),
  intervalMs = PROBE_INTERVAL_MS,
  shutdownMs = SHUTDOWN_TIMEOUT_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  signals = process,
  onExit = (code) => { process.exitCode = code; },
  log = (...args) => console.warn(...args),
} = {}) {
  return new Promise((resolve) => {
    let failures = 0;
    let polling = true;
    let stopping = null;
    let probeInFlight = false;
    let finished = false;
    let interval;
    let killTimer;

    const closeWatcher = () => {
      if (interval !== undefined) clearIntervalFn(interval);
      interval = undefined;
    };

    const removeSignalHandlers = () => {
      signals.removeListener('SIGTERM', onSigterm);
      signals.removeListener('SIGINT', onSigint);
    };

    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      polling = false;
      closeWatcher();
      removeSignalHandlers();
      if (killTimer !== undefined) clearTimeoutFn(killTimer);
      const exitCode = stopping === 'recovery' ? 1 : code ?? (signal ? 128 + signalNumber(signal) : 1);
      onExit(exitCode);
      resolve(exitCode);
    };

    const beginShutdown = (reason) => {
      if (stopping !== null) return;
      stopping = reason;
      polling = false;
      closeWatcher();
      if (reason === 'recovery') log('[runtime] confirmed durable world failure; requesting child shutdown');
      try { child.kill('SIGTERM'); } catch { /* Escalate if the child cannot be signaled. */ }
      killTimer = setTimeoutFn(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* The child may have exited during the race. */ }
        }
      }, shutdownMs);
    };

    const onSigterm = () => beginShutdown('external');
    const onSigint = () => beginShutdown('external');
    signals.on('SIGTERM', onSigterm);
    signals.on('SIGINT', onSigint);

    child.once('exit', (code, signal) => finish(code, signal));
    child.once('error', () => {
      if (child.pid === undefined) {
        log('[runtime] unable to start server child');
        finish(1, null);
      }
    });
    interval = setIntervalFn(async () => {
      if (!polling || stopping !== null || probeInFlight) return;
      probeInFlight = true;
      try {
        const result = await probe();
        if (stopping !== null || !polling) return;
        if (result && shouldRecoverWorldFailure(result.healthStatus, result.status)) failures++;
        else failures = 0;
        if (failures >= 4) beginShutdown('recovery');
      } catch {
        failures = 0;
      } finally {
        probeInFlight = false;
      }
    }, intervalMs);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runRuntimeGuard();
}

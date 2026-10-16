#!/usr/bin/env node
// Bounded four-client alpha capacity probe for the protocol-32 host.
// Defaults to loopback. This script does not read .env, send credentials, or mutate profiles.
import WebSocket from 'ws';

const PROTOCOL_VERSION = 32;
const MSG = Object.freeze({
  HELLO: 'hello', INPUTS: 'inputs', CHAT_SEND: 'chat_send',
  WELCOME: 'welcome', SNAPSHOT: 'snap', ERROR: 'error', FULL: 'full',
  CHAT_STATE: 'chat_state', CHAT_RESULT: 'chat_result',
});
const CLIENT_COUNT = 4;
const DURATION_MS = 30_000;
const INPUT_INTERVAL_MS = 100;
const INPUTS_PER_BATCH = 6; // 60 commands/second per client, matching check-friends cadence.
const SAMPLE_INTERVAL_MS = 1_000;
const CONNECT_TIMEOUT_MS = 8_000;
const READY_TIMEOUT_MS = 8_000;
const TARGET = new URL(process.argv[2] || 'ws://127.0.0.1:5173');

if (!['ws:', 'wss:'].includes(TARGET.protocol)) throw new Error('Target must use ws:// or wss://.');
// Never echo credentials, query strings, or fragments from the input URL.
TARGET.username = '';
TARGET.password = '';
TARGET.search = '';
TARGET.hash = '';
const WS_URL = new URL(TARGET);
const socketPath = WS_URL.pathname.replace(/\/$/, '');
WS_URL.pathname = socketPath.endsWith('/ws') ? socketPath : `${socketPath}/ws`;
const HTTP_URL = new URL(WS_URL);
HTTP_URL.protocol = WS_URL.protocol === 'wss:' ? 'https:' : 'http:';
HTTP_URL.pathname = '/';
HTTP_URL.search = '';
const ORIGIN = HTTP_URL.origin;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = {
  startedAt: new Date().toISOString(),
  target: ORIGIN,
  protocolExpected: PROTOCOL_VERSION,
  durationMs: DURATION_MS,
  inputRateHzPerClient: INPUTS_PER_BATCH * 1000 / INPUT_INTERVAL_MS,
  clients: Array.from({ length: CLIENT_COUNT }, (_, index) => ({
    name: `Probe ${index + 1}`, transportOpen: false, welcomed: false,
    protocolErrors: [], hostErrors: [], full: false, snapshots: 0, postWelcomeSnapshots: 0,
    inputMessages: 0, inputCommands: 0, chatConfig: null, chatResults: [],
    disconnects: 0, unexpectedClose: false,
    lastTick: null,
  })),
  statusSamples: [], statusErrors: 0,
  health: 'unknown',
};
const clients = [];
let sampleTimer = null;
let inputTimer = null;
let stopped = false;
const statusAbort = new AbortController();
let statusSampling = false;
let statusTask = Promise.resolve();

function getJson(pathname, timeoutMs = 2_500, signal = undefined) {
  const url = new URL(pathname, HTTP_URL);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
}

async function sampleStatus() {
  if (statusSampling || statusAbort.signal.aborted) return;
  statusSampling = true;
  try {
    const response = await getJson('/status', 2_500, statusAbort.signal);
    if (!response.ok) throw new Error(`http_${response.status}`);
    const value = await response.json();
    state.statusSamples.push({
      atMs: Date.now() - startedWallMs,
      players: finite(value.players), max: finite(value.max), sockets: finite(value.sockets),
      tick: finite(value.tick), stepMs: finite(value.stepMs), errors: finite(value.errors),
      storageErrors: finite(value.storage?.errors),
      storageDurable: typeof value.storage?.durable === 'boolean' ? value.storage.durable : null,
    });
  } catch (error) {
    if (statusAbort.signal.aborted) return;
    state.statusErrors++;
    if (state.statusSamples.length < 1) state.initialStatusError = safeError(error);
  } finally {
    statusSampling = false;
  }
}

function finite(value) { return Number.isFinite(value) ? value : null; }
function safeError(error) { return error?.name === 'TimeoutError' ? 'timeout' : (error?.code || error?.name || 'error'); }

function connect(index) {
  const record = state.clients[index];
  const ws = new WebSocket(WS_URL, { origin: ORIGIN, handshakeTimeout: CONNECT_TIMEOUT_MS });
  const client = { ws, record, sequence: 0, lastServerTick: 0, lastSentTick: 0, welcomedAt: null, lastPosition: null };
  clients.push(client);
  ws.on('open', () => { record.transportOpen = true; });
  ws.on('message', (data) => {
    let message;
    try { message = JSON.parse(data.toString()); }
    catch { record.hostErrors.push('invalid_json'); return; }
    if (!message || typeof message !== 'object') return;
    if (Number.isFinite(message.tick)) client.lastServerTick = Math.max(client.lastServerTick, message.tick);
    record.lastTick = client.lastServerTick || record.lastTick;
    if (message.t === MSG.WELCOME) {
      if (message.v !== PROTOCOL_VERSION) {
        record.protocolErrors.push(`welcome_version_${String(message.v)}`);
      } else {
        record.welcomed = true;
        client.welcomedAt ??= Date.now();
        client.entityId = message.you;
        if (Number.isFinite(message.tick)) client.lastServerTick = message.tick;
      }
    } else if (message.t === MSG.ERROR) {
      const code = typeof message.code === 'string' ? message.code : 'unknown';
      if (code === 'version') record.protocolErrors.push(code);
      else record.hostErrors.push(code);
    } else if (message.t === MSG.FULL) {
      record.full = true;
    } else if (message.t === MSG.SNAPSHOT) {
      record.snapshots++;
      if (record.welcomed) record.postWelcomeSnapshots++;
      if (Number.isFinite(message.tick)) client.lastServerTick = Math.max(client.lastServerTick, message.tick);
      if (record.welcomed && Array.isArray(message.ents) && Number.isFinite(client.entityId)) {
        const own = message.ents.find((entity) => Array.isArray(entity) && entity[0] === client.entityId);
        if (own && Number.isFinite(own[2]) && Number.isFinite(own[4])) {
          if (!client.firstPosition) client.firstPosition = { x: own[2], z: own[4] };
          client.lastPosition = { x: own[2], z: own[4] };
        }
      }
    } else if (message.t === MSG.CHAT_STATE) {
      record.chatConfig = {
        enabled: message.config?.enabled === true,
        maxLength: finite(message.config?.maxLength),
      };
    } else if (message.t === MSG.CHAT_RESULT) {
      record.chatResults.push({ ok: message.ok === true, code: typeof message.code === 'string' ? message.code : null });
    }
  });
  ws.on('close', () => {
    record.disconnects++;
    if (!stopped) record.unexpectedClose = true;
  });
  ws.on('error', (error) => {
    const code = safeError(error);
    record.hostErrors.push(code);
  });
  client.open = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), CONNECT_TIMEOUT_MS);
    ws.once('open', () => { clearTimeout(timeout); resolve(true); });
    ws.once('error', () => { clearTimeout(timeout); resolve(false); });
  });
  client.waitForAdmission = new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (pollTimer !== null) clearTimeout(pollTimer);
      resolve(ready);
    };
    const timeout = setTimeout(() => finish(false), READY_TIMEOUT_MS);
    const poll = () => {
      if (settled) return;
      if (record.welcomed || record.protocolErrors.length || record.full || record.hostErrors.length) {
        finish(record.welcomed);
      } else pollTimer = setTimeout(poll, 25);
    };
    pollTimer = setTimeout(poll, 0);
  });
  return client;
}

function send(client, message) {
  if (client.ws.readyState !== WebSocket.OPEN) return false;
  client.ws.send(JSON.stringify(message));
  return true;
}

function sendInputs() {
  for (const client of clients) {
    if (!client.record.welcomed || client.ws.readyState !== WebSocket.OPEN) continue;
    const cmds = [];
    for (let index = 0; index < INPUTS_PER_BATCH; index++) {
      client.sequence++;
      client.lastSentTick = Math.max(client.lastServerTick, client.lastSentTick) + 1;
      cmds.push({ seq: client.sequence, mx: 0.35, mz: 0, ax: 0, az: 0, btn: 0, prs: 0,
        pt: client.lastSentTick, w: 0 });
    }
    if (send(client, {
      t: MSG.INPUTS,
      cmds,
    })) {
      client.record.inputMessages++;
      client.record.inputCommands += cmds.length;
    }
  }
}

async function closeClients() {
  stopped = true;
  clearInterval(sampleTimer);
  clearInterval(inputTimer);
  statusAbort.abort();
  await statusTask;
  await Promise.all(clients.map((client) => new Promise((resolve) => {
    if (client.ws.readyState === WebSocket.CLOSED) return resolve();
    const timeout = setTimeout(() => { client.ws.terminate(); resolve(); }, 1_500);
    client.ws.once('close', () => { clearTimeout(timeout); resolve(); });
    if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) client.ws.close(1000, 'probe complete');
    else { clearTimeout(timeout); resolve(); }
  })));
}

const startedWallMs = Date.now();
try {
  const health = await getJson('/health');
  state.health = health.ok ? 'ok' : `http_${health.status}`;
  if (!health.ok) throw new Error('health_check_failed');
  statusTask = sampleStatus();
  await statusTask;
  const baseline = state.statusSamples[0];
  if (!baseline || baseline.players !== 0 || baseline.max < CLIENT_COUNT) {
    throw new Error('Capacity probe requires an empty host with four available slots');
  }
  const [page] = await Promise.all([getJson('/')]);
  if (!page.ok) throw new Error(`page_http_${page.status}`);

  for (let index = 0; index < CLIENT_COUNT; index++) connect(index);
  await Promise.all(clients.map((client) => client.open));
  for (const [index, client] of clients.entries()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      send(client, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: state.clients[index].name, skin: 1, weapon: 0 });
    }
  }
  await Promise.all(clients.map((client) => client.waitForAdmission));

  // One small, benign world-channel message per admitted guest exercises chat when enabled.
  for (let index = 0; index < clients.length; index++) {
    if (state.clients[index].welcomed) {
      send(clients[index], {
        t: MSG.CHAT_SEND, id: `vps-probe-${index + 1}`, channel: 'world',
        text: 'Capacity probe: hello from a test client.',
      });
    }
  }

  statusTask = sampleStatus();
  await statusTask;
  sampleTimer = setInterval(() => { statusTask = sampleStatus(); }, SAMPLE_INTERVAL_MS);
  inputTimer = setInterval(sendInputs, INPUT_INTERVAL_MS);
  await sleep(DURATION_MS);
  statusTask = sampleStatus();
  await statusTask;
} catch (error) {
  state.fatal = safeError(error);
} finally {
  await closeClients();
}

const welcomed = state.clients.filter((client) => client.welcomed).length;
const protocolErrors = state.clients.reduce((sum, client) => sum + client.protocolErrors.length, 0);
const hostErrorCount = state.clients.reduce((sum, client) => sum + client.hostErrors.length, 0);
const full = state.clients.filter((client) => client.full).length;
const unexpectedDisconnects = state.clients.filter((client) => client.unexpectedClose).length;
const sampleSteps = state.statusSamples.map((sample) => sample.stepMs).filter(Number.isFinite).sort((a, b) => a - b);
const quantile = (sorted, q) => sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null;
const firstStatus = state.statusSamples[0] ?? null;
const lastStatus = state.statusSamples.at(-1) ?? null;
const allReceivedSnapshots = state.clients.every((client) => client.postWelcomeSnapshots > 0);
const finalStatusNoErrors = lastStatus?.errors === 0 && lastStatus?.storageErrors === 0;
const tickAdvanced = Number.isFinite(firstStatus?.tick) && Number.isFinite(lastStatus?.tick) && lastStatus.tick > firstStatus.tick;
const positions = state.clients.map((client, index) => {
  const first = clients[index]?.firstPosition ?? null;
  const last = clients[index]?.lastPosition ?? null;
  const delta = first && last ? { x: +(last.x - first.x).toFixed(3), z: +(last.z - first.z).toFixed(3) } : null;
  return { client: index + 1, first, last, delta, distance: delta ? +Math.hypot(delta.x, delta.z).toFixed(3) : null };
});
const report = {
  schema: 'marea-negra.vps-capacity-probe.v1',
  startedAt: state.startedAt,
  finishedAt: new Date().toISOString(),
  target: state.target,
  protocolExpected: state.protocolExpected,
  plannedDurationMs: state.durationMs,
  clients: {
    attempted: CLIENT_COUNT,
    transportOpen: state.clients.filter((client) => client.transportOpen).length,
    welcomed,
    protocolErrors,
    hostErrorCount,
    full,
    unexpectedDisconnects,
    inputMessages: state.clients.reduce((sum, client) => sum + client.inputMessages, 0),
    inputCommands: state.clients.reduce((sum, client) => sum + client.inputCommands, 0),
    snapshots: state.clients.reduce((sum, client) => sum + client.snapshots, 0),
    snapshotsAfterWelcome: state.clients.reduce((sum, client) => sum + client.postWelcomeSnapshots, 0),
    disconnects: state.clients.reduce((sum, client) => sum + client.disconnects, 0),
    chatConfig: state.clients.map((client, index) => ({ client: index + 1, config: client.chatConfig })),
    chatResults: state.clients.flatMap((client) => client.chatResults),
    chatRejections: state.clients.flatMap((client, index) => client.chatResults
      .filter((result) => !result.ok).map((result) => ({ client: index + 1, code: result.code }))),
    errors: state.clients.flatMap((client, index) => [
      ...client.protocolErrors.map((code) => ({ client: index + 1, kind: 'protocol', code })),
      ...client.hostErrors.map((code) => ({ client: index + 1, kind: 'host', code })),
    ]),
  },
  health: state.health,
  status: {
    samples: state.statusSamples.length,
    sampleErrors: state.statusErrors,
    stepMsStatistic: 'quantiles across one-second samples of the host stepMs field',
    medianStepMs: quantile(sampleSteps, 0.5),
    p95StepMs: quantile(sampleSteps, 0.95),
    maxStepMs: sampleSteps.length ? sampleSteps.at(-1) : null,
    first: firstStatus,
    last: lastStatus,
    finalStatusNoErrors,
    tickAdvanced,
  },
  acceptance: { ready: welcomed === CLIENT_COUNT, allReceivedSnapshots, finalStatusNoErrors, tickAdvanced,
    noProtocolErrors: protocolErrors === 0, noHostErrors: hostErrorCount === 0 },
  movementDeltaAdvisory: positions,
  fatal: state.fatal ?? null,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (state.fatal || welcomed !== CLIENT_COUNT || protocolErrors > 0 || hostErrorCount > 0 ||
    unexpectedDisconnects > 0 || !allReceivedSnapshots || !finalStatusNoErrors || !tickAdvanced) process.exitCode = 1;

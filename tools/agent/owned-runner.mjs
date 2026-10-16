import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';

const RUNNER = fileURLToPath(new URL('./run.mjs', import.meta.url));
const copy = (value) => structuredClone(value);
const fail = (why) => ({ ok: false, why });
const code = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value) ? value : null;
const fresh = () => ({ state: 'idle', processRunning: false, model: null, authority: null,
  inFlight: false, requests: null, observation: null, tasks: [], activity: [], termination: null, lastError: null });

// This bridge owns one child. Browser requests cannot choose commands, paths or process arguments.
export function createOwnedRunner({ url, directory, budgetDirectory, scope, accountTokenEnv,
  capabilities = ['move', 'aim'], minutes = 5 } = {}) {
  const endpoint = new URL(url);
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      typeof directory !== 'string' || !isAbsolute(directory) || typeof budgetDirectory !== 'string' || !isAbsolute(budgetDirectory) ||
      !scope || Object.keys(scope).length !== 3 || !['ownerId', 'characterId', 'worldId'].every((field) => code(scope[field])) ||
      !Array.isArray(capabilities) || capabilities.length < 1 || capabilities.some((v) => !['move', 'aim', 'chat', 'attack_pve', 'body_pve', 'inventory_read', 'market_read'].includes(v)) ||
      !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60 || accountTokenEnv !== undefined &&
      (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(accountTokenEnv) || !process.env[accountTokenEnv])) throw new Error('invalid_runner_configuration');
  scope = copy(scope); capabilities = [...capabilities];
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'PATHEXT']
    .filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  if (accountTokenEnv) env[accountTokenEnv] = process.env[accountTokenEnv];
  let child = null, view = fresh(), pending = null, queue = Promise.resolve(), closing = false, generation = 0, protocolFault = false;
  const serial = (operation) => {
    const next = queue.then(operation, operation); queue = next.catch(() => {}); return next;
  };
  function activity(type, data) {
    view.activity.push({ atMs: Date.now(), type, ok: typeof data?.ok === 'boolean' ? data.ok : null, why: code(data?.why) });
    if (view.activity.length > 40) view.activity.shift();
  }
  function ingest(event) {
    if (!event || typeof event.type !== 'string') return;
    const { type, data } = event;
    if (type === 'ready') {
      view.state = 'ready'; view.authority = ['server_controller', 'local_runner_only'].includes(data?.authority) ? data.authority : null;
    }
    if (type === 'current') view.state = code(data?.state) ?? 'unavailable';
    if (['observation', 'current', 'ready'].includes(type)) {
      const observation = type === 'observation' ? data : data?.observation;
      if (Number.isSafeInteger(observation?.tick)) view.observation = { tick: observation.tick,
        revision: observation.revision, receivedAtMs: observation.receivedAtMs };
    }
    if (type === 'mind') {
      view.model = data?.model === 'simulated-mind-v1' ? data.model : null;
      view.inFlight = data?.inFlight === true; view.requests = Number.isSafeInteger(data?.requests) ? data.requests : null;
    }
    if (type === 'actions' && Array.isArray(data)) view.tasks = data.slice(-64).map((entry) => ({
      actionId: code(entry.order?.actionId), type: code(entry.order?.type), state: code(entry.state) }));
    if (type === 'stopped' || type === 'lifecycle' && data?.current?.state === 'stopped') {
      view.state = 'stopped'; view.inFlight = false;
      const termination = type === 'stopped' ? data?.termination : data.current.termination;
      view.termination = termination ? { reason: code(termination.reason), localBuffersCleared: termination.localBuffersCleared === true,
        serverQueueRevocation: termination.serverQueueRevocation === 'confirmed' ? 'confirmed' : 'unproven' } : null;
    }
    if (type === 'error') view.lastError = code(data?.code) ?? 'runner_error';
    if (!['observation', 'current', 'actions', 'mind', 'lifecycle', 'owner_files', 'input'].includes(type) && code(type)) activity(type, data);
    if (pending?.types.includes(type)) { const selected = pending; pending = null; clearTimeout(selected.timer); selected.resolve(event); }
  }
  function wait(types, timeoutMs = 4000) {
    if (pending) throw new Error('runner_request_busy');
    return new Promise((resolve) => {
      pending = { types, resolve, timer: setTimeout(() => {
        pending = null; protocolFault = true; view.lastError = 'runner_response_pending';
        // Uncorrelated late replies cannot be accepted as evidence for the next command.
        child?.kill(); resolve({ type: 'timeout', data: fail('runner_response_pending') });
      }, timeoutMs) };
    });
  }
  async function request(command, replies, timeoutMs) {
    if (protocolFault || !child || !view.processRunning || child.stdin.destroyed) return { type: 'error', data: fail('runner_unavailable') };
    const response = wait([...replies, 'error', 'rejected', 'process_exit'], timeoutMs);
    child.stdin.write(JSON.stringify({ type: command }) + '\n', (error) => {
      if (error) ingest({ type: 'error', data: { code: 'runner_write_failed' } });
    });
    return response;
  }
  async function inspect() {
    if (view.processRunning && ['ready', 'stopped', 'stopping'].includes(view.state)) {
      for (const [command, type] of [['observe', 'current'], ['actions', 'actions'], ['mind', 'mind'], ['lifecycle', 'lifecycle']]) {
        const response = await request(command, [type]);
        if (response.type !== type) { view.lastError = code(response.data?.why) ?? 'runner_response_pending'; break; }
      }
    }
    return copy(view);
  }
  async function dispose() {
    const selected = child;
    if (!selected) return;
    const exited = new Promise((resolve) => selected.once('close', resolve));
    if (selected.exitCode === null && selected.signalCode === null) {
      selected.stdin.write('{"type":"exit"}\n', () => {});
      const timer = setTimeout(() => selected.kill(), 2500);
      await exited; clearTimeout(timer);
    }
    if (child === selected) child = null;
  }
  return {
    inspect: () => serial(inspect),
    start: () => serial(async () => {
      if (closing) return fail('panel_closed');
      if (view.processRunning && view.state !== 'stopped') return fail('runner_already_running');
      await dispose(); view = fresh(); view.state = 'connecting'; protocolFault = false;
      const args = [RUNNER, '--url', endpoint.href, '--files', directory, '--owner', scope.ownerId, '--character', scope.characterId,
        '--world', scope.worldId, '--capabilities', capabilities.join(','), '--minutes', String(minutes), '--mind', 'simulated',
        '--mind-budget', budgetDirectory, '--mind-memory', '--mind-goals', '--stay-open'];
      if (accountTokenEnv) args.push('--account-token-env', accountTokenEnv);
      const response = wait(['ready', 'error', 'process_exit'], 12000), epoch = ++generation;
      child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      view.processRunning = true;
      let buffer = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        if (epoch !== generation) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) { view.lastError = 'runner_output_too_large'; child?.kill(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try { ingest(JSON.parse(line)); } catch { view.lastError = 'runner_invalid_output'; child?.kill(); return; }
        }
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => { if (epoch === generation) ingest({ type: 'error', data: { code: 'runner_start_failed' } }); });
      child.on('close', () => {
        if (epoch !== generation) return;
        view.processRunning = false; view.inFlight = false;
        if (view.state !== 'stopped') view.state = 'exited';
        ingest({ type: 'process_exit', data: fail('runner_exited') });
      });
      const result = await response;
      if (result.type !== 'ready') { await dispose(); return fail(view.lastError ?? 'runner_start_failed'); }
      await inspect(); return { ok: true, runner: copy(view) };
    }),
    think: () => serial(async () => {
      if (view.state !== 'ready') return fail('runner_not_ready');
      const current = await request('mind', ['mind']);
      if (current.type !== 'mind') return fail('runner_unavailable');
      if (view.inFlight) return fail('inference_inflight');
      // The CLI starts inference asynchronously. Do not wait for a model result in the control queue.
      // Submission is distinct from completion, which remains visible in the activity and fresh state.
      const submitted = await new Promise((resolve) => child.stdin.write('{"type":"think"}\n', (error) => resolve(!error)));
      if (!submitted) return fail('runner_write_failed');
      await inspect();
      return { ok: true, submitted: true, completion: 'activity' };
    }),
    stop: () => serial(async () => {
      if (!view.processRunning) return { ...fail('runner_unavailable'), confirmed: false, confirmation: 'unproven' };
      const result = await request('stop', ['stop_response']);
      if (result.type !== 'stop_response' || result.data?.ok !== true) return { ...fail('runner_stop_pending'), confirmed: false, pending: true, confirmation: 'unproven' };
      view.state = result.data.state;
      await inspect();
      // The runner's local timeout is not a receipt from the server queue.
      if (view.state !== 'stopped') {
        await new Promise((resolve) => setTimeout(resolve, 1100)); await inspect();
      }
      const local = view.state === 'stopped' && view.termination?.localBuffersCleared === true;
      const server = local && view.authority === 'server_controller' && view.termination?.serverQueueRevocation === 'confirmed';
      const confirmed = server || local && view.authority === 'local_runner_only';
      return { ok: confirmed, confirmed, pending: !confirmed, confirmation: server ? 'server_queue' : confirmed ? 'local_runner' : 'unproven',
        ...(confirmed ? {} : { why: 'server_stop_unproven' }), runner: copy(view) };
    }),
    close: async () => { closing = true; await serial(dispose); },
  };
}

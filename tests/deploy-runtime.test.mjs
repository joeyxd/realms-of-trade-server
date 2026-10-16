import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { probeRuntime, runRuntimeGuard, shouldRecoverWorldFailure } from '../deploy/runtime.mjs';

function failedWorldStatus(overrides = {}) {
  const { storage: storageOverrides = {}, ...statusOverrides } = overrides;
  return {
    players: 0,
    sockets: 0,
    ...statusOverrides,
    storage: {
      durable: true,
      unsaved: 0,
      staging: null,
      deathStaging: null,
      deathDrops: null,
      pearlGround: null,
      combatDeaths: null,
      startup: null,
      world: { ready: false, failed: true },
      ...storageOverrides,
    },
  };
}

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  kills = [];

  kill(signal) { this.kills.push(signal); return true; }
  exit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

class FakeSignals extends EventEmitter {}

function harness(options = {}) {
  const child = new FakeChild();
  const signals = new FakeSignals();
  let poll;
  let timeout;
  let intervalClosed = false;
  let timeoutClosed = false;
  const exits = [];
  const completion = runRuntimeGuard({
    child,
    signals,
    intervalMs: 10,
    shutdownMs: 20,
    probe: async () => ({ healthStatus: 503, status: failedWorldStatus() }),
    setIntervalFn: (fn) => { poll = fn; return 1; },
    clearIntervalFn: () => { intervalClosed = true; },
    setTimeoutFn: (fn) => { timeout = fn; return 2; },
    clearTimeoutFn: () => { timeoutClosed = true; },
    onExit: (code) => exits.push(code),
    log: () => {},
    ...options,
  });
  return { child, signals, completion, exits, poll: () => poll(), fireTimeout: () => timeout(),
    get intervalClosed() { return intervalClosed; }, get timeoutClosed() { return timeoutClosed; } };
}

test('recovery decision accepts only the fully idle durable failed-world state', () => {
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus()), true);
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ storage: {
    economic: { enabled: true, pending: 0, failed: false, completed: 2, replays: 1 },
    profileWrites: 0, worldWriting: false,
  } })), true);
  assert.equal(shouldRecoverWorldFailure(200, failedWorldStatus()), false);
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ storage: { unsaved: 1 } })), false);
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ storage: { staging: { enabled: true } } })), false);
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ storage: { durable: false } })), false);
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ players: 1 })), false);
  assert.equal(shouldRecoverWorldFailure(503, { storage: { durable: true } }), false);
});

test('recovery stays closed around economic operations and pending profile or world writes', () => {
  const blocked = [
    { groundTransactions: { enabled: true, ready: false, pending: 0, failed: true } },
    { groundTransactions: { enabled: true, ready: true, pending: 1, failed: false } },
    { groundTransactions: {} },
    { economic: { enabled: true, pending: 1, failed: false, completed: 0, replays: 0 } },
    { economic: { enabled: true, pending: 0, failed: true, completed: 0, replays: 0 } },
    { economic: { enabled: true, pending: 0, completed: 0, replays: 0 } },
    { profileWrites: 1 },
    { worldWriting: true },
  ];
  for (const storage of blocked) {
    assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ storage })), false, JSON.stringify(storage));
  }
  // Older status payloads omit these fields and retain the legacy recovery behavior.
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus()), true);
  assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus({ storage: { groundTransactions: null } })), true);
});

test('HTTP probe accepts only a 200 JSON status contract', async (t) => {
  let statusCode = 200;
  let statusBody = JSON.stringify(failedWorldStatus());
  const fixture = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(503, { 'content-type': 'text/plain' }).end('storage unavailable'); return; }
    if (req.url === '/status') { res.writeHead(statusCode, { 'content-type': 'application/json' }).end(statusBody); return; }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => fixture.close());
  const result = await probeRuntime(fixture.address().port, 500);
  assert.equal(result.healthStatus, 503);
  assert.equal(shouldRecoverWorldFailure(result.healthStatus, result.status), true);
  statusCode = 503;
  assert.equal(await probeRuntime(fixture.address().port, 500), null);
  statusCode = 200;
  statusBody = '[]';
  assert.equal(await probeRuntime(fixture.address().port, 500), null);
});

test('four persistent eligible probes request one graceful recovery and exit nonzero', async () => {
  const logs = [];
  const h = harness({ log: (...args) => logs.push(args) });
  await h.poll(); await h.poll(); await h.poll();
  assert.deepEqual(h.child.kills, []);
  await h.poll();
  assert.deepEqual(h.child.kills, ['SIGTERM']);
  assert.equal(h.intervalClosed, true);
  h.child.exit(0);
  assert.equal(await h.completion, 1);
  assert.deepEqual(h.exits, [1]);
  assert.deepEqual(logs, [['[runtime] confirmed durable world failure; requesting child shutdown']]);
});

test('a healthy or unrecognized probe resets the consecutive failure count', async () => {
  let count = 0;
  const h = harness({ probe: async () => {
    count++;
    if (count === 4) return { healthStatus: 200, status: failedWorldStatus() };
    return { healthStatus: 503, status: failedWorldStatus() };
  } });
  await h.poll(); await h.poll(); await h.poll(); await h.poll();
  assert.deepEqual(h.child.kills, []);
  await h.poll(); await h.poll(); await h.poll();
  assert.deepEqual(h.child.kills, []);
  await h.poll();
  assert.deepEqual(h.child.kills, ['SIGTERM']);
  h.child.exit(0);
  assert.equal(await h.completion, 1);
});

test('pending profiles, enabled staging, hung probes, and unknown state do not trigger recovery', async () => {
  const states = [
    { healthStatus: 503, status: failedWorldStatus({ storage: { unsaved: 1 } }) },
    { healthStatus: 503, status: failedWorldStatus({ storage: { deathDrops: { enabled: true } } }) },
    null,
    { healthStatus: 503, status: { storage: { durable: true, world: { ready: false, failed: true } } } },
  ];
  const h = harness({ probe: async () => states.shift() });
  await h.poll(); await h.poll(); await h.poll(); await h.poll();
  assert.deepEqual(h.child.kills, []);
  h.signals.emit('SIGTERM');
  assert.deepEqual(h.child.kills, ['SIGTERM']);
  h.child.exit(7);
  assert.equal(await h.completion, 7);
});

test('a probe that never resolves cannot advance or fire the failure guard', async () => {
  const h = harness({ probe: () => new Promise(() => {}) });
  h.poll();
  await Promise.resolve();
  await h.poll(); await h.poll(); await h.poll();
  assert.deepEqual(h.child.kills, []);
  h.signals.emit('SIGTERM');
  h.child.exit(0);
  assert.equal(await h.completion, 0);
});

test('external shutdown closes polling, forwards termination, escalates, and preserves child exit code', async () => {
  const h = harness();
  h.signals.emit('SIGINT');
  assert.deepEqual(h.child.kills, ['SIGTERM']);
  assert.equal(h.intervalClosed, true);
  assert.equal(h.signals.listenerCount('SIGTERM'), 1, 'signal handler stays installed during child drain');
  h.signals.emit('SIGTERM');
  assert.deepEqual(h.child.kills, ['SIGTERM'], 'repeated shutdown signal does not issue another child kill');
  h.fireTimeout();
  assert.deepEqual(h.child.kills, ['SIGTERM', 'SIGKILL']);
  h.child.exit(0);
  assert.equal(await h.completion, 0);
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.timeoutClosed, true);
});

test('a child that exits on its own keeps its exit status', async () => {
  const h = harness();
  h.child.exit(23);
  assert.equal(await h.completion, 23);
  assert.deepEqual(h.exits, [23]);
  assert.equal(h.intervalClosed, true);
});

test('child launch error settles once with a nonzero code', async () => {
  const h = harness();
  h.child.emit('error', new Error('synthetic spawn failure'));
  h.child.emit('exit', null, 'SIGTERM');
  assert.equal(await h.completion, 1);
  assert.deepEqual(h.exits, [1]);
});

test('a real child completes its SIGTERM drain before recovery exits nonzero', { timeout: 5000 }, async (t) => {
  const childStatus = JSON.stringify(failedWorldStatus());
  const source = `
    const http = require('node:http');
    const status = ${childStatus};
    const server = http.createServer((req, res) => {
      if (req.url === '/health') return res.writeHead(503).end('storage unavailable');
      if (req.url === '/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status));
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
    const drain = () => setTimeout(() => {
      process.send({ type: 'drained' });
      server.close(() => process.exit(0));
    }, 10);
    process.on('SIGTERM', drain);
    process.on('message', (message) => { if (message && message.type === 'shutdown') drain(); });
  `;
  const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const childControl = {
    once: child.once.bind(child),
    get exitCode() { return child.exitCode; },
    get signalCode() { return child.signalCode; },
    kill(signal) {
      // Windows terminates a process for SIGTERM; IPC drives the same drain path there.
      if (process.platform === 'win32' && signal === 'SIGTERM') { child.send({ type: 'shutdown' }); return true; }
      return child.kill(signal);
    },
  };

  const messages = [];
  const probes = [];
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  child.on('message', (message) => {
    messages.push(message.type);
    if (message.type === 'ready') resolveReady(message.port);
  });
  child.once('exit', (code, signal) => messages.push(`exit:${code}:${signal}`));

  let poll;
  const signals = new FakeSignals();
  const completion = runRuntimeGuard({
    child: childControl,
    signals,
    probe: async () => { const result = await probeRuntime(await ready, 500); probes.push(result); return result; },
    intervalMs: 10,
    shutdownMs: 1500,
    setIntervalFn: (fn) => { poll = fn; return 1; },
    clearIntervalFn: () => {},
    onExit: () => {},
    log: () => {},
  });
  const port = await ready;
  for (let i = 0; i < 4; i++) {
    await poll();
    assert.equal(shouldRecoverWorldFailure(503, failedWorldStatus()), true);
  }
  assert.equal(await completion, 1);
  assert.ok(messages.indexOf('drained') >= 0, `the child reported completion of its shutdown drain: ${messages.join(',')}; probes=${JSON.stringify(probes)}`);
  assert.ok(messages.indexOf('drained') < messages.findIndex((message) => message.startsWith('exit:')), `drain preceded child exit: ${messages.join(',')}`);
  assert.equal(port > 0, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createGameServer } from '../server/index.mjs';

async function until(check, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(check(), `${label} timeout`);
}

async function withTimeout(promise, label, timeoutMs = 12000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

test('CLI exposes confirmed go_to feedback, rejects malformed cancel, and keeps uncertain cancellation inspectable', { timeout: 30000 }, async (t) => {
  let server = null, hostListening = false, directory = null, cli = null;
  let output = '', errors = '';
  const cleanup = async () => {
    try {
      if (cli && cli.exitCode === null) {
        const exited = once(cli, 'exit');
        cli.kill();
        try { await withTimeout(exited, 'CLI cleanup'); } catch { /* bounded cleanup */ }
      }
    } finally {
      try { if (server && hostListening) await withTimeout(server.close(), 'host cleanup'); }
      finally {
        if (directory) {
          const absolute = resolve(directory), base = resolve(tmpdir());
          assert.equal(dirname(absolute), base, 'temporary owner files stay directly inside the OS temp root');
          assert.match(basename(absolute), /^agent-movement-runner-/);
          await rm(absolute, { recursive: true, force: true });
        }
      }
    }
  };
  t.after(cleanup);

  server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, worldId: null,
    log() {}, saveSecret: 'agent-movement-runner-test-secret' });
  const port = await server.listen(); hostListening = true;
  directory = await mkdtemp(join(tmpdir(), 'agent-movement-runner-'));
  const scope = { ownerId: 'owner-movement-runner', characterId: 'brisa-movement-runner', worldId: 'world-movement-runner' };
  await writeFile(join(directory, 'personality.md'), '# Brisa\nAvanza con cuidado.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  cli = spawn(process.execPath, ['tools/agent/run.mjs', '--files', directory, '--owner', scope.ownerId,
    '--character', scope.characterId, '--world', scope.worldId, '--url', `ws://127.0.0.1:${port}/ws`,
    '--capabilities', 'move', '--stay-open'], { stdio: ['pipe', 'pipe', 'pipe'] });
  cli.stdout.on('data', (chunk) => { output += chunk; });
  cli.stderr.on('data', (chunk) => { errors += chunk; });
  const events = () => {
    const completeEnd = output.lastIndexOf('\n');
    return output.slice(0, completeEnd + 1).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  };
  const count = (type) => events().filter((event) => event.type === type).length;
  const last = (type) => events().filter((event) => event.type === type).at(-1)?.data;
  const send = (value) => cli.stdin.write(`${JSON.stringify(value)}\n`);

  await until(() => count('ready') === 1 || cli.exitCode !== null, 'initial movement guest admission');
  assert.equal(cli.exitCode, null, `CLI exited early: ${errors} ${JSON.stringify(events())}`);
  const ready = last('ready');
  const firstFiles = events().find((event) => event.type === 'owner_files').data;
  assert.equal(ready.inferenceCalls, 0);
  assert.equal(ready.gameSpendingEnabled, false);
  assert.deepEqual(ready.grant.capabilities, ['move']);

  let accepted = false;
  for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
    const before = count('order_response');
    const observation = last('observation')?.observation;
    assert.ok(observation, 'confirmed server observation precedes the decision');
    send({ type: 'order', order: { v: 1, actionId: 'cli-go-to-1', scope: ready.grant.scope,
      controlRevision: ready.grant.controlRevision, observationRevision: observation.revision,
      type: 'go_to', args: { x: observation.confirmed.self.position.x + 12,
        z: observation.confirmed.self.position.z, tolerance: 0.5, durationMs: 15000 } } });
    await until(() => count('order_response') > before, 'go_to response');
    const response = last('order_response');
    accepted = response.ok;
    if (!accepted) assert.equal(response.why, 'stale_observation');
  }
  assert.ok(accepted, 'a fresh go_to order was accepted');
  await until(() => events().some((event) => event.type === 'input' && event.data.actionId === 'cli-go-to-1'), 'action-bearing input');

  send({ type: 'actions' }); send({ type: 'context' });
  await until(() => count('actions') === 1 && count('context') === 1, 'moving action context');
  const movingAction = last('actions').find((action) => action.order.actionId === 'cli-go-to-1');
  assert.ok(movingAction);
  assert.equal(movingAction.navigation.status, 'moving');
  assert.equal(movingAction.navigation.source, 'server');
  const movingContext = last('context');
  assert.equal(movingContext.inferenceCalls, 0);
  assert.equal(movingContext.ownerFileHashes.personality, firstFiles.files.personality.sha256);
  assert.equal(movingContext.ownerFileHashes.objectives, firstFiles.files.objectives.sha256);
  assert.equal(movingContext.ownerFileHashes.memory, firstFiles.files.memory.sha256);
  assert.equal(movingContext.ok, true);
  const pendingMove = movingContext.document.required.pending.find((item) => item.actionId === 'cli-go-to-1');
  assert.equal(pendingMove.navigation.status, 'moving');
  assert.ok(events().some((event) => event.type === 'observation' &&
    event.data.observation.tick === pendingMove.navigation.observationTick &&
    event.data.observation.receivedAtMs === pendingMove.navigation.observedAtMs),
  'navigation freshness metadata is taken from the matching confirmed snapshot');
  assert.ok(pendingMove.navigation.observedAtMs <= movingContext.document.required.observation.receivedAtMs,
    'navigation time comes from a confirmed snapshot no newer than context observation');
  assert.ok(pendingMove.navigation.observationTick <= movingContext.document.required.observation.tick);

  const beforeRejectedCancel = count('rejected');
  send({ type: 'cancel', actionId: 'cli-go-to-1', reason: 'unexpected-field' });
  await until(() => count('rejected') > beforeRejectedCancel, 'strict cancel envelope rejection');
  assert.equal(last('rejected').why, 'invalid_message');
  assert.equal(count('cancel_response'), 0, 'malformed cancel does not reach the runner');

  send({ type: 'cancel', actionId: 'cli-go-to-1' });
  await until(() => count('cancel_response') === 1, 'explicit action cancel');
  const cancelled = last('cancel_response');
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.action.state, 'uncertain');
  assert.equal(cancelled.action.navigation.status, 'cancelled');
  assert.ok(cancelled.action.inputRange);
  assert.ok(cancelled.action.navigation.observedAtMs >= pendingMove.navigation.observedAtMs,
    'cancellation preserves a snapshot no older than the moving context');
  assert.ok(events().some((event) => event.type === 'observation' &&
    event.data.observation.tick === cancelled.action.navigation.observationTick &&
    event.data.observation.receivedAtMs === cancelled.action.navigation.observedAtMs),
  'cancelled navigation timestamp and tick refer to the matching confirmed snapshot');

  const inputCountAfterCancel = events().filter((event) => event.type === 'input' && event.data.actionId === 'cli-go-to-1').length;
  const observationCountAtCancel = count('observation');
  await until(() => count('observation') > observationCountAtCancel &&
    last('observation').observation.tick > pendingMove.navigation.observationTick, 'post-cancel server snapshot');
  send({ type: 'observe' }); send({ type: 'actions' }); send({ type: 'context' });
  await until(() => count('current') === 1 && count('actions') === 2 && count('context') === 2 &&
    last('current')?.observation?.tick > pendingMove.navigation.observationTick, 'fresh post-cancel inspection');
  assert.equal(last('current').state, 'ready', 'cancelling a task does not close the session');
  assert.ok(last('current').observation.tick > pendingMove.navigation.observationTick,
    'the runner continues receiving fresh snapshots after cancellation');
  const afterCancel = last('actions').find((action) => action.order.actionId === 'cli-go-to-1');
  assert.equal(afterCancel.state, 'uncertain');
  assert.equal(afterCancel.navigation.status, 'cancelled');
  const retainedContext = last('context');
  assert.equal(retainedContext.inferenceCalls, 0);
  assert.equal(retainedContext.ownerFileHashes.personality, firstFiles.files.personality.sha256);
  assert.ok(retainedContext.document.required.pending.some((item) => item.actionId === 'cli-go-to-1' &&
    item.state === 'uncertain' && item.navigation.status === 'cancelled'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(events().filter((event) => event.type === 'input' && event.data.actionId === 'cli-go-to-1').length,
    inputCountAfterCancel, 'cancelled movement never resumes');

  send({ type: 'exit' });
  const [code] = await withTimeout(once(cli, 'exit'), 'CLI exit');
  assert.equal(code, 0);
  assert.equal(errors, '');
});

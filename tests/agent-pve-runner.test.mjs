import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createGameServer } from '../server/index.mjs';
import { BTN } from '../src/sim/systems/movement.js';

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

test('CLI runs a holding body_pve action, rejects malformed orders, and keeps sent cancellation uncertain', { timeout: 30000 }, async (t) => {
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
          assert.match(basename(absolute), /^agent-pve-runner-/);
          await rm(absolute, { recursive: true, force: true });
        }
      }
    }
  };
  t.after(cleanup);

  server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, worldId: null,
    log() {}, saveSecret: 'agent-pve-runner-test-secret' });
  const port = await server.listen(); hostListening = true;
  directory = await mkdtemp(join(tmpdir(), 'agent-pve-runner-'));
  const scope = { ownerId: 'owner-pve-runner', characterId: 'brisa-pve-runner', worldId: 'world-pve-runner' };
  await writeFile(join(directory, 'personality.md'), '# Brisa\nSe mantiene alerta.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  const originalHashes = {};
  for (const name of ['personality.md', 'objectives.json', 'memory.jsonl']) {
    originalHashes[name] = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
  }
  cli = spawn(process.execPath, ['tools/agent/run.mjs', '--files', directory, '--owner', scope.ownerId,
    '--character', scope.characterId, '--world', scope.worldId, '--url', `ws://127.0.0.1:${port}/ws`,
    '--capabilities', 'move,aim,attack_pve,body_pve', '--stay-open'], { stdio: ['pipe', 'pipe', 'pipe'] });
  cli.stdout.on('data', (chunk) => { output += chunk; });
  cli.stderr.on('data', (chunk) => { errors += chunk; });
  const events = () => {
    const completeEnd = output.lastIndexOf('\n');
    return output.slice(0, completeEnd + 1).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  };
  const count = (type) => events().filter((event) => event.type === type).length;
  const last = (type) => events().filter((event) => event.type === type).at(-1)?.data;
  const send = (value) => cli.stdin.write(`${JSON.stringify(value)}\n`);
  const freshBodyOrder = async (actionId, args) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const before = count('order_response');
      const observation = last('observation')?.observation;
      assert.ok(observation, 'confirmed server observation precedes body order');
      send({ type: 'order', order: { v: 1, actionId, scope: ready.grant.scope,
        controlRevision: ready.grant.controlRevision, observationRevision: observation.revision,
        type: 'body_pve', args } });
      await until(() => count('order_response') > before, `body order response ${attempt + 1}`);
      const response = last('order_response');
      if (response.ok || response.why !== 'stale_observation') return response;
      send({ type: 'observe' });
      await until(() => count('current') > currentCount, 'fresh observation after stale body order');
      currentCount = count('current');
    }
    return last('order_response');
  };

  await until(() => count('ready') === 1 || cli.exitCode !== null, 'body runner guest admission');
  assert.equal(cli.exitCode, null, `CLI exited early: ${errors} ${JSON.stringify(events())}`);
  const ready = last('ready');
  const firstFiles = events().find((event) => event.type === 'owner_files').data;
  assert.equal(ready.inferenceCalls, 0);
  assert.equal(ready.gameSpendingEnabled, false);
  assert.deepEqual(ready.grant.capabilities, ['move', 'aim', 'attack_pve', 'body_pve']);
  let currentCount = count('current');

  const args = { mode: 'defensive', protect: null, retreatHpFraction: 0.3, allowPotion: false, durationMs: 15000 };
  const malformed = await freshBodyOrder('cli-body-bad', { ...args, unexpected: true });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.why, 'invalid_args');
  assert.equal(count('input'), 0, 'invalid body order never emits game input');

  const accepted = await freshBodyOrder('cli-body-1', args);
  assert.equal(accepted.ok, true, `body order rejected: ${JSON.stringify(accepted)}`);
  await until(() => events().some((event) => event.type === 'input' && event.data.actionId === 'cli-body-1'), 'holding body input');
  const bodyInput = events().find((event) => event.type === 'input' && event.data.actionId === 'cli-body-1').data;
  assert.equal(bodyInput.input.mx, 0);
  assert.equal(bodyInput.input.mz, 0);
  assert.equal(bodyInput.input.btn & BTN.AIM, BTN.AIM, 'body keeps ordinary AIM held while idle');

  send({ type: 'actions' }); send({ type: 'context' });
  await until(() => count('actions') === 1 && count('context') === 1, 'holding body context');
  const action = last('actions').find((entry) => entry.order.actionId === 'cli-body-1');
  assert.ok(action);
  assert.equal(action.body.status, 'holding');
  assert.equal(action.body.source, 'server');
  const context = last('context');
  assert.equal(context.inferenceCalls, 0);
  assert.equal(context.document.required.rules.gameSpendingEnabled, false);
  assert.equal(context.ownerFileHashes.personality, firstFiles.files.personality.sha256);
  assert.equal(context.ownerFileHashes.objectives, firstFiles.files.objectives.sha256);
  assert.equal(context.ownerFileHashes.memory, firstFiles.files.memory.sha256);
  assert.equal(context.ownerFileHashes.personality, originalHashes['personality.md']);
  assert.equal(context.ownerFileHashes.objectives, originalHashes['objectives.json']);
  assert.equal(context.ownerFileHashes.memory, originalHashes['memory.jsonl']);
  assert.equal(context.ok, true);
  const pendingBody = context.document.required.pending.find((item) => item.actionId === 'cli-body-1');
  assert.ok(pendingBody);
  assert.equal(pendingBody.body.status, 'holding');
  const bodyObservation = events().find((event) => event.type === 'observation' &&
    event.data.observation.tick === pendingBody.body.observationTick &&
    event.data.observation.receivedAtMs === pendingBody.body.observedAtMs)?.data.observation;
  assert.ok(bodyObservation, 'body metadata points to the matching confirmed server snapshot');
  assert.deepEqual(context.document.required.observation.confirmed.combat, bodyObservation.confirmed.combat,
    'context carries combat readings from its current confirmed observation');
  assert.ok(pendingBody.body.observedAtMs <= context.document.required.observation.receivedAtMs);
  assert.ok(pendingBody.body.observationTick <= context.document.required.observation.tick);

  const beforeMalformedCancel = count('rejected');
  send({ type: 'cancel', actionId: 'cli-body-1', reason: 'extra' });
  await until(() => count('rejected') > beforeMalformedCancel, 'strict cancel envelope rejection');
  assert.equal(last('rejected').why, 'invalid_message');
  assert.equal(count('cancel_response'), 0);

  send({ type: 'cancel', actionId: 'cli-body-1' });
  await until(() => count('cancel_response') === 1, 'body cancellation');
  const cancellation = last('cancel_response');
  assert.equal(cancellation.ok, true);
  assert.equal(cancellation.action.state, 'uncertain');
  assert.equal(cancellation.action.body.status, 'cancelled');
  assert.ok(cancellation.action.inputRange);
  const inputsAtCancel = events().filter((event) => event.type === 'input' && event.data.actionId === 'cli-body-1').length;
  const tickAtCancel = cancellation.action.body.observationTick;
  const observationsAtCancel = count('observation');
  await until(() => count('observation') > observationsAtCancel && last('observation').observation.tick > tickAtCancel,
    'fresh post-cancel server observation');
  send({ type: 'observe' }); send({ type: 'actions' }); send({ type: 'context' });
  await until(() => count('current') > currentCount && count('actions') === 2 && count('context') === 2 &&
    last('current')?.observation?.tick > tickAtCancel, 'post-cancel inspection');
  currentCount = count('current');
  assert.equal(last('current').state, 'ready');
  assert.ok(last('current').observation.tick > tickAtCancel);
  const retained = last('actions').find((entry) => entry.order.actionId === 'cli-body-1');
  assert.equal(retained.state, 'uncertain');
  assert.equal(retained.body.status, 'cancelled');
  assert.equal(last('context').inferenceCalls, 0);
  assert.ok(last('context').document.required.pending.some((item) => item.actionId === 'cli-body-1' &&
    item.state === 'uncertain' && item.body.status === 'cancelled'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(events().filter((event) => event.type === 'input' && event.data.actionId === 'cli-body-1').length,
    inputsAtCancel, 'cancelled body never resumes old action input');

  cli.stdin.end();
  const [code] = await withTimeout(once(cli, 'exit'), 'CLI EOF exit');
  assert.equal(code, 0);
  assert.equal(errors, '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createGameServer } from '../server/index.mjs';

async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(check(), `${label} timeout`);
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), 12000);
    })]);
  } finally { clearTimeout(timer); }
}

test('stay-open runner preserves uncertainty and requires explicit fresh-session reentry', async (t) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, worldId: null,
    log() {}, saveSecret: 'agent-lifecycle-local-test-secret' });
  const port = await server.listen();
  const directory = await mkdtemp(join(tmpdir(), 'agent-lifecycle-runner-'));
  const scope = { ownerId: 'owner-lifecycle', characterId: 'brisa-lifecycle', worldId: 'world-lifecycle' };
  await writeFile(join(directory, 'personality.md'), '# Brisa\nObserva con cuidado.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  const cli = spawn(process.execPath, ['tools/agent/run.mjs', '--files', directory, '--owner', scope.ownerId,
    '--character', scope.characterId, '--world', scope.worldId, '--url', `ws://127.0.0.1:${port}/ws`, '--stay-open'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  cli.stdout.on('data', (chunk) => { output += chunk; });
  cli.stderr.on('data', (chunk) => { errors += chunk; });
  const events = () => output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const send = (value) => cli.stdin.write(`${JSON.stringify(value)}\n`);
  t.after(async () => {
    try {
      if (cli.exitCode === null) {
        cli.kill();
        await withTimeout(once(cli, 'exit'), 'CLI cleanup');
      }
    } finally {
      await server.close();
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.match(basename(directory), /^agent-lifecycle-runner-/);
      await rm(directory, { recursive: true, force: true });
    }
  });
  const count = (type) => events().filter((event) => event.type === type).length;
  const last = (type) => events().filter((event) => event.type === type).at(-1)?.data;

  await until(() => count('ready') === 1 || cli.exitCode !== null, 'initial guest admission');
  assert.equal(cli.exitCode, null, `CLI exited early: ${errors} ${JSON.stringify(events())}`);
  const firstReady = last('ready');
  const firstFiles = events().find((event) => event.type === 'owner_files').data;
  assert.equal(firstReady.identity.mode, 'guest');
  assert.equal(firstReady.inferenceCalls, 0);
  assert.equal(firstReady.gameSpendingEnabled, false);

  // Decide from the latest observation, and refresh only after an explicit stale rejection.
  let accepted = false;
  for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
    const before = count('order_response');
    const observation = last('observation')?.observation;
    assert.ok(observation, 'server observation exists before ordering');
    send({ type: 'order', order: { v: 1, actionId: 'life-move-1', scope: firstReady.grant.scope,
      controlRevision: firstReady.grant.controlRevision, observationRevision: observation.revision,
      type: 'move', args: { mx: 1, mz: 0, durationMs: 1000 } } });
    await until(() => count('order_response') > before, 'move response');
    const response = last('order_response');
    accepted = response.ok;
    if (!accepted) assert.equal(response.why, 'stale_observation');
  }
  assert.ok(accepted, 'a fresh movement order was accepted');
  await until(() => events().some((event) => event.type === 'input' && event.data.actionId === 'life-move-1'), 'sent movement input');

  send({ type: 'stop' });
  await until(() => count('stop_response') === 1 && count('stopped') >= 1, 'owner stop');
  send({ type: 'lifecycle' });
  await until(() => count('lifecycle') === 1, 'stopped lifecycle');
  const stoppedLifecycle = last('lifecycle');
  const archived = stoppedLifecycle.archives.flatMap((session) => session.actions);
  const uncertain = archived.find((action) => action.order.actionId === 'life-move-1');
  assert.equal(uncertain.state, 'uncertain');
  assert.ok(uncertain.inputRange);
  assert.equal(stoppedLifecycle.current.state, 'stopped');

  send({ type: 'reenter' });
  await until(() => count('reenter_response') === 1, 'explicit reentry');
  const reentered = last('reenter_response');
  assert.equal(reentered.ok, true);
  assert.equal(reentered.taskResume, 'none');
  assert.equal(reentered.characterContinuity, 'new_guest_body');
  assert.equal(reentered.inferenceCalls, 0);
  assert.equal(reentered.gameSpendingEnabled, false);
  assert.notEqual(reentered.grant.scope.sessionId, firstReady.grant.scope.sessionId);
  assert.notEqual(reentered.grant.controlRevision, firstReady.grant.controlRevision);
  assert.equal(last('observation').observation.scope.sessionId, reentered.grant.scope.sessionId);
  assert.equal(reentered.priorUncertainty.length, 1);
  assert.equal(reentered.priorUncertainty[0].actionId, 'life-move-1');
  assert.equal(reentered.priorUncertainty[0].retryAllowed, false);
  await until(() => count('owner_files') === 2, 'reloaded owner files');
  const secondFiles = last('owner_files');
  assert.deepEqual(Object.fromEntries(Object.entries(secondFiles.files).map(([key, file]) => [key, file.sha256])),
    Object.fromEntries(Object.entries(firstFiles.files).map(([key, file]) => [key, file.sha256])));

  send({ type: 'actions' });
  send({ type: 'lifecycle' });
  send({ type: 'context' });
  await until(() => count('actions') === 1 && count('lifecycle') === 2 && count('context') === 1, 'fresh context');
  assert.deepEqual(last('actions'), [], 'the new session starts without prior actions');
  const activeLifecycle = last('lifecycle');
  assert.equal(activeLifecycle.archives.length, 1);
  assert.equal(activeLifecycle.retiredActionCount, 1);
  const context = last('context');
  assert.equal(context.inferenceCalls, 0);
  assert.equal(context.document.required.rules.gameSpendingEnabled, false);
  assert.equal(context.ok, true, 'retained uncertainty fits the bounded context');
  assert.ok(context.document.required.pending.some((item) => item.actionId === 'life-move-1' && item.state === 'uncertain'));

  // Retired IDs remain globally reserved, even if their old scope is rewritten.
  const newObservation = last('observation').observation;
  const rewrittenOldOrder = { v: 1, actionId: 'life-move-1', scope: reentered.grant.scope,
    controlRevision: reentered.grant.controlRevision, observationRevision: newObservation.revision,
    type: 'move', args: { mx: 0, mz: 1, durationMs: 100 } };
  let before = count('order_response');
  send({ type: 'order', order: rewrittenOldOrder });
  await until(() => count('order_response') > before, 'retired action response');
  assert.deepEqual(last('order_response'), { ok: false, why: 'retired_action_id' });

  // A fresh action ID cannot carry authority from the retired scope either.
  before = count('order_response');
  send({ type: 'order', order: { ...rewrittenOldOrder, actionId: 'life-move-old-scope',
    scope: firstReady.grant.scope, controlRevision: firstReady.grant.controlRevision } });
  await until(() => count('order_response') > before, 'old scope response');
  assert.equal(last('order_response').why, 'control_mismatch');

  send({ type: 'exit' });
  const [code] = await withTimeout(once(cli, 'exit'), 'CLI exit');
  assert.equal(code, 0);
  assert.equal(errors, '');
});

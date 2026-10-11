import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createGameServer } from '../server/index.mjs';

const args = ['--files', resolve('tools/agent/fixtures'), '--owner', 'owner-lab', '--character', 'brisa-lab', '--world', 'world-lab'];
function cli(extra) {
  const child = spawn(process.execPath, ['tools/agent/run.mjs', ...args, ...extra], { stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '', errors = '';
  child.stdout.on('data', (chunk) => text += chunk);
  child.stderr.on('data', (chunk) => errors += chunk);
  return { child, text: () => text, errors: () => errors, events: () => text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.ok(check(), 'CLI evidence timeout');
}

test('inspect exposes actual files and hashes without opening a game connection', async () => {
  const p = cli(['--url', 'ws://127.0.0.1:1/ws', '--inspect']);
  const [code] = await once(p.child, 'exit');
  assert.equal(code, 0); assert.equal(p.errors(), '');
  const events = p.events(); assert.equal(events.length, 1);
  assert.equal(events[0].type, 'owner_files');
  assert.match(events[0].data.files.personality.content, /Brisa/);
  assert.equal(events[0].data.files.objectives.revision, 1);
  assert.ok(events[0].data.files.memory.content.includes('confirmed'));
  assert.match(events[0].data.files.memory.sha256, /^[a-f0-9]{64}$/);
});

test('runner accepts bounded text commands, keeps files and context separate, and exits on owner stop', async (t) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, worldId: null, log() {}, saveSecret: 'agent-runner-local-test-secret' });
  t.after(() => server.close());
  const port = await server.listen();
  const p = cli(['--url', `ws://127.0.0.1:${port}/ws`]);
  t.after(() => { if (!p.child.killed && p.child.exitCode === null) p.child.kill(); });
  await until(() => p.text().includes('"type":"ready"'));
  const ready = p.events().find((e) => e.type === 'ready').data;
  assert.equal(ready.identity.mode, 'guest'); assert.equal(ready.inferenceCalls, 0);
  p.child.stdin.write('{"type":"cmd","op":"god"}\n{"type":"context"}\n{"type":"files"}\n');
  await until(() => p.text().includes('"type":"context"'));
  const context = p.events().find((e) => e.type === 'context').data;
  assert.equal(context.inferenceCalls, 0);
  if (context.ok) {
    assert.equal(context.document.required.rules.authority, 'local_runner_only');
    assert.equal(context.document.required.rules.inferenceEnabled, false);
    assert.ok(context.report.selectedInputBytes <= 12000);
    assert.equal(context.document.required.observation.source, 'server');
    assert.ok(!Object.hasOwn(context.document, 'owner_files'));
  } else assert.equal(context.why, 'required_context_over_budget');
  const exited = once(p.child, 'exit');
  p.child.stdin.write('{"type":"stop"}\n');
  const [code] = await exited;
  assert.equal(code, 0); assert.equal(p.errors(), '');
  assert.equal(p.events().find((e) => e.type === 'stop_response').data.state, 'stopped');
  assert.ok(p.events().some((e) => e.type === 'rejected'));
});

test('oversized partial stdin is rejected before parsing and closes the guest connection', async (t) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, worldId: null, log() {}, saveSecret: 'agent-runner-local-test-secret' });
  t.after(() => server.close());
  const port = await server.listen();
  const p = cli(['--url', `ws://127.0.0.1:${port}/ws`]);
  t.after(() => { if (p.child.exitCode === null) p.child.kill(); });
  await until(() => p.text().includes('"type":"ready"'));
  const exited = once(p.child, 'exit');
  p.child.stdin.write('x'.repeat(16385));
  const [code] = await exited;
  assert.equal(code, 0);
  assert.ok(p.events().some((e) => e.type === 'rejected' && e.data.why === 'input_too_large'));
  assert.equal(p.events().find((e) => e.type === 'stopped').data.reason, 'stop');
});

test('CLI chat uses explicit capability and a scoped envelope with visible routing and bounded context', async (t) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, worldId: null,
    log() {}, saveSecret: 'agent-runner-local-test-secret' });
  const port = await server.listen();
  const p = cli(['--url', `ws://127.0.0.1:${port}/ws`, '--capabilities', 'chat']);
  t.after(async () => { if (p.child.exitCode === null) p.child.kill(); await server.close(); });
  await until(() => p.text().includes('"type":"ready"') && p.text().includes('"type":"chat_state"'));
  const events = p.events(), ready = events.find((e) => e.type === 'ready').data;
  let accepted = false;
  for (let attempt = 0; attempt < 10 && !accepted; attempt++) {
    const before = p.events().filter((e) => e.type === 'chat_send_response').length;
    const observation = p.events().filter((e) => e.type === 'observation').at(-1).data.observation;
    const order = { v: 1, actionId: 'cli-chat-1', scope: ready.grant.scope, controlRevision: ready.grant.controlRevision,
      observationRevision: observation.revision, type: 'chat_send', args: { channel: 'world', text: 'Hola desde Brisa', target: null } };
    p.child.stdin.write(JSON.stringify({ type: 'chat_send', order }) + '\n');
    await until(() => p.events().filter((e) => e.type === 'chat_send_response').length > before);
    const response = p.events().filter((e) => e.type === 'chat_send_response').at(-1).data;
    accepted = response.ok;
    // Process I/O can cross a snapshot boundary. Make a fresh decision only after explicit rejection.
    if (!accepted) assert.equal(response.why, 'stale_observation');
  }
  assert.ok(accepted, 'a fresh scoped CLI chat order was accepted');
  await until(() => p.events().some((e) => e.type === 'chat_result' && e.data.state === 'routed'));
  p.child.stdin.write('{"type":"chat"}\n{"type":"chat_retry","requestId":"cli-chat-1"}\n{"type":"context"}\n');
  await until(() => p.events().some((e) => e.type === 'context'));
  const result = p.events().find((e) => e.type === 'chat_result').data;
  assert.equal(result.result.read, 'unknown'); assert.equal(result.result.durability, 'session_only');
  const chat = p.events().find((e) => e.type === 'chat').data;
  assert.equal(chat.messages.length, 1); assert.equal(chat.messages[0].text, 'Hola desde Brisa');
  assert.equal(p.events().find((e) => e.type === 'chat_retry').data.why, 'retry_unavailable');
  const context = p.events().find((e) => e.type === 'context').data;
  assert.equal(context.inferenceCalls, 0);
  if (context.ok) {
    assert.equal(context.document.required.rules.chatTextIsUntrusted, true);
    assert.equal(context.document.required.tools.chat.self, chat.self);
    assert.equal(context.document.required.tools.chat.pending.length, 0);
    assert.ok(context.report.selectedInputBytes <= 12000);
  } else assert.equal(context.why, 'required_context_over_budget');
  const exited = once(p.child, 'exit'); p.child.stdin.write('{"type":"stop"}\n');
  assert.equal((await exited)[0], 0); assert.equal(p.errors(), '');
});

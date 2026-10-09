import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMemoryAdministration } from '../tools/agent/memory-admin.mjs';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { createMemoryEpisode, buildMemoryTurn, createMemorySummary, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';
import { retrievePersistentMemory } from '../tools/agent/memory-retrieval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'tools', 'agent', 'manage-memory.mjs');
const scope = { ownerId: 'owner-admin-flow', characterId: 'agent-admin-flow', worldId: 'world-admin-flow' };
const sessionScope = { ...scope, sessionId: 'session-admin-flow' };
const jsonl = (...entries) => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function tempDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'marea-memory-admin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function objectiveDocument(forScope = scope, revision = 1) {
  return JSON.stringify({ v: 1, revision, scope: forScope, goals: [
    { id: 'return-home', status: 'active', text: 'Return to the home dock', constraints: [] },
  ] });
}

function legacy(id, revision, createdAtMs, text = `owner note ${id}`) {
  return { id, revision, scope, text, certainty: 'uncertain', createdAtMs, validUntilMs: null, tags: ['dock'], sources: [] };
}

function episode(time, { pending = [], chat = [] } = {}) {
  return createMemoryEpisode({ scope, grant: { scope: { ...sessionScope, sessionId: `session-${time}` }, controlRevision: 1 },
    observation: { source: 'server', receivedAtMs: time, revision: time, tick: time,
      confirmed: { self: { position: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100, dead: false } } },
    required: { goals: { revision: 1, goals: [{ id: 'return-home', status: 'active', text: 'Return home', constraints: [] }] }, pending },
    goalFeedback: [], chat: { messages: chat } });
}

async function writeArchive(directory, { personality = 'A careful character.', objectives = objectiveDocument(), entries = [] } = {}) {
  await writeFile(path.join(directory, 'personality.md'), personality, 'utf8');
  await writeFile(path.join(directory, 'objectives.json'), objectives, 'utf8');
  await writeFile(path.join(directory, 'memory.jsonl'), jsonl(...entries), 'utf8');
}

function admin(directory, overrides = {}) {
  return createMemoryAdministration({ directory, scope, now: () => 5000, ...overrides });
}

function childCli(directory, inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, '--files', directory, '--owner', scope.ownerId,
      '--character', scope.characterId, '--world', scope.worldId], { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}: ${stderr}`));
      try { resolve(stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))); }
      catch (error) { reject(new Error(`invalid CLI JSON: ${error.message}; stderr=${stderr}; stdout=${stdout}`)); }
    });
    child.stdin.end(inputs.map((input) => JSON.stringify(input)).join('\n') + '\n');
  });
}

function openCli(directory) {
  const child = spawn(process.execPath, [CLI, '--files', directory, '--owner', scope.ownerId,
    '--character', scope.characterId, '--world', scope.worldId], { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    async request(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      const next = await lines.next();
      if (next.done) throw new Error(`CLI closed early: ${stderr}`);
      return JSON.parse(next.value);
    },
    async close() {
      child.stdin.end(`${JSON.stringify({ type: 'exit' })}\n`);
      await closed;
    },
    waitForClose: () => closed,
  };
}

test('export is a versioned, path-free byte-exact bundle and survives reloading', async (t) => {
  const directory = await tempDirectory(t);
  const memory = Buffer.from(`\uFEFF${JSON.stringify(legacy('legacy-crlf', 1, 7))}\r\n`, 'utf8');
  const personality = Buffer.from('\uFEFFCareful captain.\r\n', 'utf8');
  const objectives = Buffer.from(`${objectiveDocument()}\r\n`, 'utf8');
  await writeFile(path.join(directory, 'personality.md'), personality);
  await writeFile(path.join(directory, 'objectives.json'), objectives);
  await writeFile(path.join(directory, 'memory.jsonl'), memory);

  const result = await admin(directory).exportFiles();
  assert.equal(result.ok, true);
  const bundle = result.bundle;
  assert.equal(bundle.schema, 'agent-owner-files-export/v1');
  assert.deepEqual(bundle.scope, scope);
  assert.deepEqual(Object.keys(bundle.files).sort(), ['memory', 'objectives', 'personality']);
  for (const [key, bytes] of Object.entries({ personality, objectives, memory })) {
    const file = bundle.files[key];
    assert.equal(Buffer.from(file.content, 'base64').equals(bytes), true, `${key} preserves BOM and line endings`);
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, hash(bytes));
    assert.equal(Object.hasOwn(file, 'path'), false);
  }
  assert.equal(JSON.stringify(bundle).includes(directory), false);
  assert.equal(JSON.stringify(bundle).includes('C:\\'), false);
});

test('removing an episode cascades to every dependent summary and fresh retrieval cannot recover it', async (t) => {
  const directory = await tempDirectory(t);
  const source = episode(1000);
  const turn = buildMemoryTurn({ memoryJournal: parseMemoryJournal(jsonl(source), scope) }, [source.id], 1100).turn;
  const summary = createMemorySummary({ type: 'summarize_memory', args: { text: 'A return-home interpretation.', tags: ['return-home'], basis: [source.id] } }, turn, scope, 1200).entry;
  await writeArchive(directory, { entries: [source, summary] });

  const manager = admin(directory);
  const preview = await manager.previewRemoval({ ids: [source.id] });
  assert.equal(preview.ok, true);
  assert.equal(preview.preview.kind, 'remove');
  assert.deepEqual(preview.preview.plan.removeIds, [source.id, summary.id].sort());
  const committed = await manager.commitRemoval({ previewId: preview.preview.id });
  assert.equal(committed.ok, true);

  const latest = await admin(directory).files();
  assert.equal(latest.ok, true);
  assert.equal(latest.files.memory.journal.entries.length, 0);
  const recovered = retrievePersistentMemory({ journal: latest.files.memory.journal, scope, nowMs: 5000,
    queryText: 'return home dock', queryTags: ['return-home'] });
  assert.equal(recovered.records.length, 0);
});

test('stale previews conflict after any owner-file change and cannot be replayed', async (t) => {
  const directory = await tempDirectory(t);
  const row = legacy('delete-me', 1, 1);
  await writeArchive(directory, { entries: [row] });
  const manager = admin(directory);
  const preview = await manager.previewRemoval({ ids: [row.id] });
  assert.equal(preview.ok, true);
  await writeFile(path.join(directory, 'personality.md'), 'Changed while preview was open.\n', 'utf8');
  const conflict = await manager.commitRemoval({ previewId: preview.preview.id });
  assert.equal(conflict.ok, false);
  assert.match(conflict.why, /conflict|changed/i);
  const replay = await manager.commitRemoval({ previewId: preview.preview.id });
  assert.equal(replay.ok, false);
});

test('a newer preview replaces the prior token and commits only its matching operation', async (t) => {
  const directory = await tempDirectory(t);
  const rows = [legacy('first', 1, 1), legacy('second', 1, 2)];
  await writeArchive(directory, { entries: rows });
  const manager = admin(directory);
  const first = await manager.previewRemoval({ ids: ['first'] });
  const second = await manager.previewRemoval({ ids: ['second'] });
  assert.equal(first.ok && second.ok, true);
  assert.notEqual(first.preview.id, second.preview.id);
  assert.equal((await manager.commitRemoval({ previewId: first.preview.id })).ok, false);
  assert.equal((await manager.commitRemoval({ previewId: second.preview.id })).ok, true);
  const latest = await admin(directory).files();
  assert.deepEqual(latest.files.memory.journal.entries.map((entry) => entry.id), ['first']);
});

test('migration preserves legacy content, uncertainty and unresolved-operation evidence without deleting data', async (t) => {
  const directory = await tempDirectory(t);
  const old = legacy('old-memory', 4, 123, 'A disputed account of the dock encounter.');
  const unresolved = episode(124, { pending: [{ actionId: 'move-in-doubt', state: 'uncertain' }] });
  await writeArchive(directory, { entries: [old, unresolved] });
  // Force a representation migration while leaving parsed records unchanged.
  await writeFile(path.join(directory, 'memory.jsonl'), Buffer.from(jsonl(old, unresolved).replaceAll('\n', '\r\n'), 'utf8'));
  const manager = admin(directory);
  const before = await manager.files();
  const migration = await manager.previewMigration();
  assert.equal(migration.ok, true);
  const committed = await manager.commitMigration({ previewId: migration.preview.id });
  assert.equal(committed.ok, true);
  const after = await admin(directory).files();
  const legacyAfter = after.files.memory.journal.entries.find((entry) => entry.id === old.id);
  assert.deepEqual(legacyAfter, old, 'migration leaves legacy fields and uncertainty intact');
  assert.deepEqual(after.files.memory.journal.pending, before.files.memory.journal.pending);
  assert.deepEqual(after.files.memory.journal.entries.map((entry) => entry.id), before.files.memory.journal.entries.map((entry) => entry.id));
});

test('CLI inspection, export and commit share one process token; malformed and cross-scope inputs fail closed', async (t) => {
  const directory = await tempDirectory(t);
  await writeArchive(directory, { entries: [legacy('cli-row', 1, 1)] });
  const outputs = await childCli(directory, [
    { type: 'inspect', query: 'cli-row', limit: 10, offset: 0 },
    { type: 'export' },
    { type: 'preview_delete', ids: ['cli-row'] },
  ]);
  assert.equal(outputs.length, 3);
  assert.ok(outputs.every((item) => item.type === 'memory_admin' && item.data.ok));
  assert.equal(outputs[0].data.records[0].id, 'cli-row');
  assert.equal(JSON.stringify(outputs[1]).includes(directory), false);
  const previewId = outputs[2].data.preview.id;
  const committed = await childCli(directory, [
    { type: 'preview_delete', ids: ['cli-row'] },
    { type: 'commit_delete', previewId: '0'.repeat(64) },
  ]);
  assert.equal(committed[0].data.ok, true);
  assert.equal(committed[1].data.ok, false);
  assert.equal((await admin(directory).files()).files.memory.journal.entries.length, 1);
  assert.match(previewId, /^[a-f0-9]{64}$/);

  const invalid = await childCli(directory, [
    { type: 'inspect', query: 'x', surprise: true },
    { type: 'preview_delete', ids: ['foreign-id'] },
  ]);
  assert.equal(invalid.length, 2);
  assert.equal(invalid[0].data.ok, false);
  assert.equal(invalid[1].data.ok, false);

  const session = openCli(directory);
  const validPreview = await session.request({ type: 'preview_delete', ids: ['cli-row'] });
  assert.equal(validPreview.data.ok, true);
  const validCommit = await session.request({ type: 'commit_delete', previewId: validPreview.data.preview.id });
  assert.equal(validCommit.data.ok, true);
  assert.equal((await session.request({ type: 'exit' })).data.closed, true);
  await session.waitForClose();
  assert.equal((await admin(directory).files()).files.memory.journal.entries.length, 0);

  const restarted = await childCli(directory, [{ type: 'inspect' }, { type: 'export' }]);
  assert.equal(restarted[0].data.records.length, 0, 'a fresh child process cannot recover the deleted row');
  assert.equal(Buffer.from(restarted[1].data.bundle.files.memory.content, 'base64').length, 0);

  const foreignDir = await tempDirectory(t);
  const foreignScope = { ...scope, ownerId: 'different-owner' };
  await writeArchive(foreignDir, { entries: [legacy('foreign-row', 1, 1)] });
  const foreignBytes = Buffer.from(jsonl({ ...legacy('foreign-row', 1, 1), scope: foreignScope }), 'utf8');
  await writeFile(path.join(foreignDir, 'memory.jsonl'), foreignBytes);
  const crossScope = await childCli(foreignDir, [{ type: 'files' }]);
  assert.equal(crossScope[0].data.ok, false);
});

test('an in-flight compaction cannot write a summary after its source is deleted', async (t) => {
  const directory = await tempDirectory(t);
  const nowMs = 5000;
  const source = episode(1000);
  await writeArchive(directory, { entries: [source] });
  const budget = new InferenceBudget({ scope, limits: { maxCalls: 8, maxTokens: 10000, maxCostUnits: 10000, maxEntries: 8 } });
  let finish;
  let appendCalls = 0;
  const adapter = { id: 'held-test-model', countMode: 'simulated_tokens', countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
    prepare: (request) => ({ body: JSON.stringify(request), inputTokens: 50, maxCostUnits: 2 }),
    complete: () => new Promise((resolve) => { finish = resolve; }) };
  let lastSnapshot;
  async function readCurrentSnapshot() {
    const files = await admin(directory).files();
    const receivedAtMs = nowMs;
    const grant = fixtureGrant({ scope: sessionScope, expiresAtMs: receivedAtMs + 60000 });
    const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs });
    lastSnapshot = { state: 'ready', grant, authority: null, observation,
      required: { rules: { grant, controlStatus: 'ready' }, personality: 'Careful.', tools: {}, observation,
        goals: { revision: 1, goals: [] },
        pending: files.files.memory.journal.pending },
      memory: files.files.memory.records, memoryJournal: files.files.memory.journal, queryTags: [], memoryQueryText: 'dock',
      scope, ownerFileHashes: Object.fromEntries(Object.entries(files.files).map(([key, file]) => [key, file.sha256])), taskFence: 'stable' };
    return lastSnapshot;
  }
  const mind = new AgentMind({ adapter, budget, submitOrder: () => ({ ok: true }), limits: { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024,
    marginTokens: 256, timeoutMs: 10000, maxDecisionAgeMs: 1500, maxRequests: 8, maxResponseBytes: 8192 }, contextLimits: {},
    readSnapshot: readCurrentSnapshot, readCommitSnapshot: () => lastSnapshot, now: () => nowMs,
    appendMemory: async (request) => {
      appendCalls++;
      const current = await admin(directory).files();
      if (request.expectedHashes.memory !== current.files.memory.sha256) return { ok: false, why: 'owner_hash_conflict' };
      return { ok: true, replay: false, revision: request.expectedRevision + 1, sha256: 'a'.repeat(64), entryId: request.entry.id };
    },
  });
  const pending = mind.compactMemory({ sourceIds: [source.id] });
  for (let attempt = 0; !finish && attempt < 200; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof finish, 'function', `compaction reached adapter: ${JSON.stringify(mind.state.records)}`);
  const manager = admin(directory);
  const preview = await manager.previewRemoval({ ids: [source.id] });
  assert.equal(preview.ok, true);
  assert.equal((await manager.commitRemoval({ previewId: preview.preview.id })).ok, true);
  finish({ text: JSON.stringify({ v: 1, decision: { type: 'summarize_memory', args: {
    text: 'At the dock.', tags: ['return-home'], basis: [source.id] } } }),
    usage: { inputTokens: 40, outputTokens: 8, costUnits: 1 } });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.why, 'owner_files_changed');
  assert.deepEqual(budget.snapshot.entries[0].usage, { inputTokens: 40, outputTokens: 8, costUnits: 1 });
  assert.equal(appendCalls, 0);
  assert.equal((await admin(directory).files()).files.memory.journal.entries.length, 0);
});

test('a selected memory expiring during a held decision blocks the action and confirms provider usage', async () => {
  let clock = 1000;
  const expiryScope = scope;
  const expiredSoon = { ...legacy('short-lived', 1, 900, 'Return home through the dock'), validUntilMs: 1100 };
  const parsed = parseMemoryJournal(jsonl(expiredSoon), expiryScope);
  const budget = new InferenceBudget({ scope: expiryScope, limits: { maxCalls: 8, maxTokens: 10000, maxCostUnits: 10000, maxEntries: 8 } });
  let finish, orderCalls = 0;
  const adapter = { id: 'held-expiry-test-model', countMode: 'simulated_tokens',
    countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
    prepare: () => ({ body: '{"context":"bounded"}', inputTokens: 40, maxCostUnits: 2 }),
    complete: () => new Promise((resolve) => { finish = resolve; }) };
  let currentSnapshot;
  const readSnapshot = async () => {
    const grant = fixtureGrant({ scope: sessionScope, expiresAtMs: 5000 });
    const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: clock });
    currentSnapshot = { state: 'ready', grant, authority: null, observation,
      required: { rules: { grant, controlStatus: 'ready' }, personality: 'Careful.', tools: {}, observation,
        goals: { revision: 1, goals: [{ id: 'return-home', status: 'active', text: 'Return home', constraints: [] }] }, pending: [] },
      memory: parsed.records, memoryJournal: parsed, queryTags: ['dock'], memoryQueryText: 'return home dock', scope: expiryScope,
      ownerFileHashes: { personality: 'a'.repeat(64), objectives: 'b'.repeat(64), memory: 'c'.repeat(64) }, taskFence: 'stable' };
    return currentSnapshot;
  };
  const mind = new AgentMind({ adapter, budget, readSnapshot, submitOrder: () => { orderCalls++; return { ok: true }; }, now: () => clock,
    limits: { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
      timeoutMs: 10000, maxDecisionAgeMs: 1500, maxRequests: 8, maxResponseBytes: 8192 }, contextLimits: {} });
  const pending = mind.decide();
  for (let attempt = 0; !finish && attempt < 200; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof finish, 'function', `decision reached adapter: ${JSON.stringify(mind.state.records)}`);
  clock = 1100;
  finish({ text: JSON.stringify({ v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 100 } } }),
    usage: { inputTokens: 40, outputTokens: 10, costUnits: 2 } });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.why, 'memory_expired');
  assert.equal(orderCalls, 0);
  assert.deepEqual(budget.snapshot.entries[0].usage, { inputTokens: 40, outputTokens: 10, costUnits: 2 });
  assert.equal(budget.snapshot.totals.settledEntries, 1);
});

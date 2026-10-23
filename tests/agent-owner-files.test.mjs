import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOwnerFiles, OwnerFilesError } from '../tools/agent/owner-files.mjs';

const scope = { ownerId: 'owner-test', characterId: 'agent-test', worldId: 'world-test' };
const fixtureDir = fileURLToPath(new URL('../tools/agent/fixtures/', import.meta.url));

async function tempDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'marea-owner-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function objectiveDocument(forScope = scope) {
  return JSON.stringify({
    v: 1,
    revision: 7,
    scope: forScope,
    goals: [{ id: 'goal-one', status: 'active', text: 'Help the owner', constraints: ['No purchases'] }],
  });
}

function memoryRecord(id, forScope = scope, overrides = {}) {
  return {
    id,
    revision: 1,
    scope: forScope,
    text: `Memory ${id}`,
    certainty: 'confirmed',
    createdAtMs: 1,
    validUntilMs: null,
    tags: ['help-owner'],
    sources: [{ id: `source-${id}`, tick: 1 }],
    ...overrides,
  };
}

async function writeOwnerFiles(directory, { personality = 'A careful character.', objectives = objectiveDocument(), records = [memoryRecord('memory-one')] } = {}) {
  await writeFile(path.join(directory, 'personality.md'), personality, 'utf8');
  await writeFile(path.join(directory, 'objectives.json'), objectives, 'utf8');
  await writeFile(path.join(directory, 'memory.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof OwnerFilesError && error.code === code);
}

test('loads actual owner-visible files with detached records, absolute paths and raw-byte hashes', async (t) => {
  const directory = await tempDirectory(t);
  await writeOwnerFiles(directory);
  const before = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(path.join(directory, name))));
  const result = await loadOwnerFiles({ directory, scope });
  assert.equal(result.ok, true);
  assert.deepEqual(result.scope, scope);
  assert.equal(result.files.personality.content, 'A careful character.');
  assert.equal(result.files.objectives.revision, 7);
  assert.equal(result.files.objectives.goals[0].id, 'goal-one');
  assert.equal(result.files.memory.records[0].id, 'memory-one');
  assert.equal(result.files.memory.report.missingHistory, false);
  for (const item of Object.values(result.files)) {
    assert.equal(path.isAbsolute(item.path), true);
    assert.equal(path.dirname(item.path), await import('node:fs/promises').then(({ realpath }) => realpath(directory)));
    assert.equal(item.bytes > 0, true);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
  }
  result.files.memory.records[0].text = 'mutated detached copy';
  const after = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(path.join(directory, name))));
  assert.deepEqual(after, before);
});

test('reads only the latest bounded candidate suffix after validating every record in the file', async (t) => {
  const directory = await tempDirectory(t);
  const many = Array.from({ length: 5 }, (_, index) => memoryRecord(`memory-${index}`));
  await writeOwnerFiles(directory, { records: many });
  const result = await loadOwnerFiles({ directory, scope, limits: { maxCandidates: 2 } });
  assert.deepEqual(result.files.memory.records.map((record) => record.id), ['memory-3', 'memory-4']);
  assert.deepEqual(result.files.memory.report, { totalRecords: 5, returnedRecords: 2, truncatedRecords: 3, missingHistory: true });

  const hiddenForeign = [...many];
  hiddenForeign[0] = memoryRecord('foreign-old', { ...scope, ownerId: 'someone-else' });
  await writeOwnerFiles(directory, { records: hiddenForeign });
  await expectCode(loadOwnerFiles({ directory, scope, limits: { maxCandidates: 2 } }), 'scope_mismatch');
});

test('rejects objective scope mismatch, malformed goals and invalid memory lines', async (t) => {
  const directory = await tempDirectory(t);
  await writeOwnerFiles(directory, { objectives: objectiveDocument({ ...scope, worldId: 'other-world' }) });
  await expectCode(loadOwnerFiles({ directory, scope }), 'scope_mismatch');

  await writeOwnerFiles(directory, { objectives: JSON.stringify({ v: 1, revision: 1, scope, goals: [{ id: 'x', status: 'active', text: 'x', constraints: [], extra: true }] }) });
  await expectCode(loadOwnerFiles({ directory, scope }), 'invalid_objectives');

  await writeOwnerFiles(directory, { records: [memoryRecord('good'), memoryRecord('foreign', { ...scope, characterId: 'other-agent' })] });
  await expectCode(loadOwnerFiles({ directory, scope }), 'scope_mismatch');

  await writeOwnerFiles(directory, { records: [memoryRecord('valid')] });
  await writeFile(path.join(directory, 'memory.jsonl'), '{malformed json}\n', 'utf8');
  await expectCode(loadOwnerFiles({ directory, scope }), 'invalid_memory_jsonl');
});

test('rejects oversize and invalid UTF-8 files before exposing content', async (t) => {
  const directory = await tempDirectory(t);
  await writeOwnerFiles(directory, { personality: 'x'.repeat(25) });
  await expectCode(loadOwnerFiles({ directory, scope, limits: { maxPersonalityBytes: 16 } }), 'file_too_large');

  await writeOwnerFiles(directory);
  await writeFile(path.join(directory, 'personality.md'), Buffer.from([0xff, 0xfe]));
  await expectCode(loadOwnerFiles({ directory, scope }), 'invalid_utf8');
});

test('rejects file symlinks that escape the explicit owner directory', async (t) => {
  const directory = await tempDirectory(t);
  const outside = await tempDirectory(t);
  await writeOwnerFiles(directory);
  const outsideFile = path.join(outside, 'personality.md');
  await writeFile(outsideFile, 'external owner secret');
  await rm(path.join(directory, 'personality.md'));
  try {
    await symlink(outsideFile, path.join(directory, 'personality.md'), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`symlink creation unavailable: ${error.code}`);
    throw error;
  }
  await expectCode(loadOwnerFiles({ directory, scope }), 'unsafe_file_type');
});

test('rejects likely credentials and unsafe directories without returning file contents', async (t) => {
  const directory = await tempDirectory(t);
  await writeOwnerFiles(directory, { personality: 'Use api_key=sk_test_12345678901234567890' });
  await expectCode(loadOwnerFiles({ directory, scope }), 'likely_secret_detected');
  await expectCode(loadOwnerFiles({ directory: path.parse(directory).root, scope }), 'unsafe_directory');
  await expectCode(loadOwnerFiles({ directory, scope: { ...scope, extra: 'widened' } }), 'invalid_scope');
  await expectCode(loadOwnerFiles({ directory, scope, limits: { maxMemoryBytes: 17 * 1024 * 1024 } }), 'invalid_limits');
});

test('loads actual repo fixtures with the requested matching scope', async () => {
  const result = await loadOwnerFiles({
    directory: fixtureDir,
    scope: { ownerId: 'owner-lab', characterId: 'brisa-lab', worldId: 'world-lab' },
  });
  assert.equal(result.files.personality.content.includes('Brisa'), true);
  assert.equal(result.files.memory.records.length, 3);
  assert.equal(result.files.memory.records[2].certainty, 'uncertain');
});

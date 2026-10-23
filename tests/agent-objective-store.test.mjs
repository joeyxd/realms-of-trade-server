import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { createObjectiveStore } from '../tools/agent/objective-store.mjs';

const scope = { ownerId: 'owner-test', characterId: 'agent-test', worldId: 'world-test' };
const initialGoals = [{ id: 'goal-one', status: 'active', text: 'Help the owner', constraints: ['No purchases'] }];

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'marea-objective-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'personality.md'), 'A careful character.', 'utf8');
  await writeFile(path.join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 7, scope, goals: initialGoals }) + '\n');
  await writeFile(path.join(directory, 'memory.jsonl'), '', 'utf8');
  const current = await loadOwnerFiles({ directory, scope });
  return { directory, current, store: createObjectiveStore({ directory, scope }) };
}

function args(current, overrides = {}) {
  return {
    expectedRevision: current.files.objectives.revision,
    expectedHashes: Object.fromEntries(Object.entries(current.files).map(([key, file]) => [key, file.sha256])),
    goals: [{ id: 'goal-two', status: 'active', text: 'Gather safe supplies', constraints: ['Ask before spending'] }],
    ...overrides,
  };
}

test('commits only bounded objective bytes with the next revision and detached results', async (t) => {
  const { directory, current, store } = await setup(t);
  const before = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(path.join(directory, name))));
  const result = await store.commit(args(current));
  assert.equal(result.ok, true);
  assert.equal(result.revision, 8);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  result.goals[0].text = 'detached mutation';
  const after = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(path.join(directory, name))));
  assert.deepEqual(after[0], before[0]);
  assert.deepEqual(after[2], before[2]);
  assert.notDeepEqual(after[1], before[1]);
  assert.equal(JSON.parse(after[1].toString()).goals[0].text, 'Gather safe supplies');
});

test('rejects stale objective revisions and any owner file hash change', async (t) => {
  const { directory, current, store } = await setup(t);
  assert.deepEqual(await store.commit(args(current, { expectedRevision: 6 })), { ok: false, why: 'objective_revision_conflict' });
  await writeFile(path.join(directory, 'personality.md'), 'Owner edited this first.', 'utf8');
  assert.deepEqual(await store.commit(args(current)), { ok: false, why: 'owner_hash_conflict' });
});

test('honors the cooperative lock and leaves a preexisting lock untouched', async (t) => {
  const { directory, current, store } = await setup(t);
  const lockPath = path.join(directory, '.objectives.lock');
  await writeFile(lockPath, 'another writer owns this');
  assert.deepEqual(await store.commit(args(current)), { ok: false, why: 'objective_locked' });
  assert.equal(await readFile(lockPath, 'utf8'), 'another writer owns this');
});

test('runs the synchronous authority guard and preserves objectives when rejected', async (t) => {
  const { directory, current, store } = await setup(t);
  const before = await readFile(path.join(directory, 'objectives.json'));
  let called = false;
  const result = await store.commit(args(current, { guard: () => { called = true; return { ok: false, why: 'mission_inactive' }; } }));
  assert.equal(called, true);
  assert.deepEqual(result, { ok: false, why: 'mission_inactive' });
  assert.deepEqual(await readFile(path.join(directory, 'objectives.json')), before);
});

test('detaches scope, goals and expected hashes before asynchronous preparation', async (t) => {
  const { directory, current } = await setup(t);
  const sourceScope = { ...scope };
  const store = createObjectiveStore({ directory, scope: sourceScope });
  const input = args(current);
  const result = await store.commit({ ...input, guard: () => {
    sourceScope.worldId = 'changed-world';
    input.goals[0].text = 'changed after call';
    input.expectedHashes.objectives = '0'.repeat(64);
    return { ok: true };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.goals[0].text, 'Gather safe supplies');
  const saved = JSON.parse(await readFile(path.join(directory, 'objectives.json'), 'utf8'));
  assert.deepEqual(saved.scope, scope);
  assert.equal(saved.goals[0].text, 'Gather safe supplies');
});

test('rejects owner edits made by the guard before the final compare-and-rename', async (t) => {
  const { directory, current, store } = await setup(t);
  const result = await store.commit(args(current, { guard: () => {
    writeFileSync(path.join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 7, scope, goals: initialGoals }) + '\nchanged');
    return { ok: true };
  } }));
  assert.deepEqual(result, { ok: false, why: 'owner_hash_conflict' });
});

test('checks temporary file bytes again after the guard', async (t) => {
  const { directory, current, store } = await setup(t);
  const result = await store.commit(args(current, { guard: () => {
    const temp = readdirSync(directory).find((name) => name.startsWith('.objectives-') && name.endsWith('.tmp'));
    assert.ok(temp);
    writeFileSync(path.join(directory, temp), 'changed temp bytes');
    return { ok: true };
  } }));
  assert.deepEqual(result, { ok: false, why: 'objective_temp_changed' });
});

test('rejects malformed, duplicate, oversized and likely-secret goal records', async (t) => {
  const { current, store } = await setup(t);
  for (const goals of [
    [{ ...initialGoals[0] }, { ...initialGoals[0] }],
    [{ ...initialGoals[0], extra: true }],
    [{ ...initialGoals[0], text: 'api_key=secret-value' }],
    [{ ...initialGoals[0], constraints: ['x'.repeat(501)] }],
    [{ ...initialGoals[0], text: 'e\u0301' }],
    [{ ...initialGoals[0], text: 'line\nbreak' }],
    [Object.assign(Object.create({ inherited: true }), initialGoals[0])],
    Array.from({ length: 33 }, (_, index) => ({ ...initialGoals[0], id: `g-${index}` })),
  ]) assert.deepEqual(await store.commit(args(current, { goals })), { ok: false, why: 'invalid_goals' });
});

test('validates and detaches the exact constructor scope', async (t) => {
  const { directory, current } = await setup(t);
  assert.throws(() => createObjectiveStore({ directory, scope: { ...scope, extra: 'widened' } }), /invalid_scope/);
  assert.throws(() => createObjectiveStore({ directory, scope: Object.assign(Object.create({ ownerId: 'inherited' }), { characterId: 'agent', worldId: 'world' }) }), /invalid_scope/);
  const source = { ...scope };
  const store = createObjectiveStore({ directory, scope: source });
  source.ownerId = 'mutated';
  const result = await store.commit(args(current));
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'objectives.json'), 'utf8')).scope, scope);
});

test('refuses unsafe owner file symlinks', async (t) => {
  const { directory, current, store } = await setup(t);
  const file = path.join(directory, 'memory.jsonl');
  const backup = path.join(directory, 'memory.backup');
  await writeFile(backup, '');
  await rm(file);
  try {
    const { symlink } = await import('node:fs/promises');
    await symlink(backup, file, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`symlink creation unavailable: ${error.code}`);
    throw error;
  }
  assert.notEqual((await store.commit(args(current))).ok, true);

});

test('rejects asynchronous guards', async (t) => {
  const { current, store } = await setup(t);
  assert.deepEqual(await store.commit(args(current, { guard: () => Promise.resolve({ ok: true }) })), { ok: false, why: 'objective_guard_invalid' });
});

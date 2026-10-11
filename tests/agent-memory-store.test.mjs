import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { createMemoryStore } from '../tools/agent/memory-store.mjs';
import { createMemoryEpisode, createMemorySummary, buildMemoryTurn, parseMemoryJournal, MEMORY_MAX_BYTES } from '../tools/agent/memory-journal.mjs';

const scope = { ownerId: 'owner-test', characterId: 'agent-test', worldId: 'world-test' };

function episode(overrides = {}) {
  const scopedGrant = { scope: { ...scope, sessionId: 'session-test' }, controlRevision: 4 };
  return createMemoryEpisode({ scope, grant: scopedGrant,
    observation: { receivedAtMs: 1000, source: 'server', revision: 2, tick: 50, confirmed: { self: { position: { x: 1, y: 2, z: 3 }, hp: 80, maxHp: 100, dead: false } } },
    required: { goals: { revision: 3, goals: [] }, pending: [] }, ...overrides });
}
async function setup(t, memory = '') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'marea-memory-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'personality.md'), 'A careful character.', 'utf8');
  await writeFile(path.join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 7, scope, goals: [] }) + '\n');
  await writeFile(path.join(directory, 'memory.jsonl'), memory, 'utf8');
  const current = await loadOwnerFiles({ directory, scope });
  return { directory, current, store: createMemoryStore({ directory, scope }) };
}
const args = (current, entry, overrides = {}) => ({ expectedRevision: parseMemoryJournal(current.files.memory.content, scope).revision, expectedHashes:
  Object.fromEntries(Object.entries(current.files).map(([key, value]) => [key, value.sha256])), entry, ...overrides });

test('appends a sealed episode atomically and reloads it after restart', async (t) => {
  const { directory, current, store } = await setup(t), item = episode();
  const result = await store.append(args(current, item));
  assert.deepEqual(result, { ok: true, replay: false, revision: 1, sha256: result.sha256, entryId: item.id });
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const text = await readFile(path.join(directory, 'memory.jsonl'), 'utf8');
  assert.equal(text, `${JSON.stringify(item)}\n`);
  const reloaded = await loadOwnerFiles({ directory, scope });
  assert.equal(reloaded.files.memory.records.length, 1);
  const fresh = await loadOwnerFiles({ directory, scope });
  const actual = await store.append(args(fresh, item));
  assert.deepEqual(actual, { ok: true, replay: true, revision: 1, sha256: result.sha256, entryId: item.id });
});

test('preserves the original JSONL prefix and adds a separator only when needed', async (t) => {
  const first = episode(), prefix = `${JSON.stringify(first)}`;
  const { directory, current, store } = await setup(t, prefix);
  const second = episode({ observation: { receivedAtMs: 2000, source: 'server', revision: 3, tick: 51, confirmed: { self: { position: { x: 1, y: 2, z: 3 }, hp: 80, maxHp: 100, dead: false } } } });
  const result = await store.append(args(current, second, { expectedRevision: 1 }));
  assert.equal(result.ok, true);
  assert.equal(await readFile(path.join(directory, 'memory.jsonl'), 'utf8'), `${prefix}\n${JSON.stringify(second)}\n`);
});

test('atomic append preserves the original UTF-8 BOM and every original byte', async (t) => {
  const initial = `\ufeff${JSON.stringify(episode())}\r\n`;
  const { directory, current, store } = await setup(t, initial);
  const next = episode({ observation: { receivedAtMs: 2000, source: 'server', revision: 3, tick: 51,
    confirmed: { self: { position: { x: 1, y: 2, z: 3 }, hp: 80, maxHp: 100, dead: false } } } });
  assert.equal((await store.append(args(current, next))).ok, true);
  const bytes = await readFile(path.join(directory, 'memory.jsonl'));
  assert.deepEqual(bytes.subarray(0, Buffer.byteLength(initial)), Buffer.from(initial));
  assert.equal((await loadOwnerFiles({ directory, scope })).files.memory.revision, 2);
});

test('rejects an unproven summary and stale revision or any of the three owner hashes', async (t) => {
  const { directory, current, store } = await setup(t), item = episode();
  const turn = buildMemoryTurn({ memoryJournal: { revision: 0, entries: [] } }, [item.id], 2000);
  assert.deepEqual(await store.append(args(current, { ...item, kind: 'summary' })), { ok: false, why: 'invalid_memory_entry' });
  assert.deepEqual(await store.append(args(current, item, { expectedRevision: 2 })), { ok: false, why: 'memory_revision_conflict' });
  await writeFile(path.join(directory, 'personality.md'), 'Edited first.');
  assert.deepEqual(await store.append(args(current, item)), { ok: false, why: 'owner_hash_conflict' });
  assert.equal(turn.ok, false);
  const legacy = { id: 'owner-note', revision: 1, scope, text: 'Historical note.', certainty: 'inferred', createdAtMs: 10, validUntilMs: null, tags: [], sources: [] };
  for (const [filename, contents] of [['personality.md', 'another personality'], ['objectives.json', `${JSON.stringify({ v: 1, revision: 7, scope, goals: [] })}\n\n`], ['memory.jsonl', `${JSON.stringify(legacy)}\n`]]) {
    const fresh = await setup(t);
    await writeFile(path.join(fresh.directory, filename), contents);
    assert.deepEqual(await fresh.store.append(args(fresh.current, episode())), { ok: false, why: 'owner_hash_conflict' });
  }
});

test('validates summary source provenance against the complete journal', async (t) => {
  const source = episode(), summary = createMemorySummary({ type: 'summarize_memory', args: { text: 'A past event.', tags: [], basis: [source.id] } }, { sources: [source] }, scope, 2000).entry;
  const empty = await setup(t);
  assert.deepEqual(await empty.store.append(args(empty.current, summary)), { ok: false, why: 'invalid_memory_entry' });
  const { current, store } = await setup(t, `${JSON.stringify(source)}\n`);
  const result = await store.append(args(current, summary, { expectedRevision: 1 }));
  assert.equal(result.ok, true);
  assert.equal(result.revision, 2);
});

test('guard rejection and a cooperative lock leave the journal unchanged', async (t) => {
  const { directory, current, store } = await setup(t), before = await readFile(path.join(directory, 'memory.jsonl'));
  assert.deepEqual(await store.append(args(current, episode(), { guard: () => ({ ok: false, why: 'mission_inactive' }) })), { ok: false, why: 'mission_inactive' });
  assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), before);
  const lock = path.join(directory, '.memory.lock'); await writeFile(lock, 'other writer');
  assert.deepEqual(await store.append(args(current, episode())), { ok: false, why: 'memory_locked' });
  assert.equal(await readFile(lock, 'utf8'), 'other writer');
});

test('guard runs twice and owner changes made by it stop the commit', async (t) => {
  const { directory, current, store } = await setup(t), item = episode(); let calls = 0;
  assert.deepEqual(await store.append(args(current, item, { guard: () => { calls += 1; return { ok: true }; } })).then((r) => ({ ok: r.ok, revision: r.revision })), { ok: true, revision: 1 });
  const next = await loadOwnerFiles({ directory, scope });
  const before = await readFile(path.join(directory, 'memory.jsonl'));
  const rejected = await store.append(args(next, episode({ observation: { receivedAtMs: 3000, source: 'server', revision: 4, tick: 52, confirmed: { self: { position: { x: 1, y: 2, z: 3 }, hp: 80, maxHp: 100, dead: false } } } }), { guard: () => {
    writeFileSync(path.join(directory, 'personality.md'), 'Changed during guard'); return { ok: true };
  } }));
  assert.equal(calls, 2);
  assert.deepEqual(rejected, { ok: false, why: 'owner_hash_conflict' });
  assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), before);
});

test('detects temp file tampering performed by the authority guard', async (t) => {
  const { directory, current, store } = await setup(t);
  const result = await store.append(args(current, episode(), { guard: () => {
    const temp = readdirSync(directory).find((name) => name.startsWith('.memory-') && name.endsWith('.tmp'));
    assert.ok(temp); writeFileSync(path.join(directory, temp), 'tampered'); return { ok: true };
  } }));
  assert.deepEqual(result, { ok: false, why: 'memory_temp_changed' });
});

test('refuses bounded capacity overflow and leaves unrelated existing records intact', async (t) => {
  const candidate = episode(), appendBytes = Buffer.byteLength(`${JSON.stringify(candidate)}\n`), targetBytes = MEMORY_MAX_BYTES - appendBytes + 1;
  const rows = []; let used = 0, index = 0;
  const make = (id, text) => JSON.stringify({ id, revision: 1, scope, text, certainty: 'inferred', createdAtMs: index, validUntilMs: null, tags: [], sources: [] });
  while (true) {
    const row = make(`note-${index}`, 'x'.repeat(7700)), size = Buffer.byteLength(row) + 1;
    if (used + size >= targetBytes) break;
    rows.push(row); used += size; index += 1;
  }
  const base = make(`note-${index}`, ''), textLength = targetBytes - used - Buffer.byteLength(base) - 1;
  assert.ok(textLength >= 0 && textLength <= 8000);
  rows.push(make(`note-${index}`, 'x'.repeat(textLength)));
  const journal = `${rows.join('\n')}\n`;
  assert.ok(Buffer.byteLength(journal) < MEMORY_MAX_BYTES);
  const { directory, current, store } = await setup(t, journal), before = await readFile(path.join(directory, 'memory.jsonl'));
  assert.equal(MEMORY_MAX_BYTES - Buffer.byteLength(journal), appendBytes - 1);
  assert.equal((await store.append(args(current, candidate, { expectedRevision: rows.length }))).why, 'memory_too_large');
  assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), before);
});

test('refuses memory symlinks when the platform permits creating one', async (t) => {
  const { directory, current, store } = await setup(t), file = path.join(directory, 'memory.jsonl'), backup = path.join(directory, 'memory.backup');
  await writeFile(backup, ''); await rm(file);
  try { const { symlink } = await import('node:fs/promises'); await symlink(backup, file, 'file'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`symlink creation unavailable: ${error.code}`); throw error; }
  assert.notEqual((await store.append(args(current, episode()))).ok, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStore } from '../tools/agent/memory-store.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { createMemoryEpisode, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';
import { proposeMemoryRemoval } from '../tools/agent/memory-management.mjs';

const scope = { ownerId: 'owner-test', characterId: 'agent-test', worldId: 'world-test' };
function episode(time, overrides = {}) {
  return createMemoryEpisode({ scope, grant: { scope: { ...scope, sessionId: 'session-test' }, controlRevision: 4 },
    observation: { receivedAtMs: time, source: 'server', revision: time, tick: time, confirmed: { self: { position: { x: 1, y: 2, z: 3 }, hp: 80, maxHp: 100, dead: false } } },
    required: { goals: { revision: 1, goals: [] }, pending: [] }, ...overrides });
}
async function setup(t, rows = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'marea-memory-admin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'personality.md'), 'A careful character.');
  await writeFile(path.join(directory, 'objectives.json'), `${JSON.stringify({ v: 1, revision: 1, scope, goals: [] })}\n`);
  await writeFile(path.join(directory, 'memory.jsonl'), rows.map((entry) => JSON.stringify(entry)).join('\n') + (rows.length ? '\n' : ''));
  return { directory, store: createMemoryStore({ directory, scope }) };
}
async function snapshot(directory) {
  const owner = await loadOwnerFiles({ directory, scope });
  return { owner, expectedRevision: owner.files.memory.revision,
    expectedHashes: Object.fromEntries(Object.entries(owner.files).map(([key, file]) => [key, file.sha256])) };
}
function planFor(owner, ids, nowMs = 10000) {
  return proposeMemoryRemoval({ journal: owner.files.memory.journal, scope, ids, nowMs }).plan;
}

test('removal retains raw BOM, CRLF, and final newline bytes for kept rows', async (t) => {
  const a = episode(1), b = episode(2), c = episode(3), { directory, store } = await setup(t, [a, b, c]);
  const raw = Buffer.from(`\ufeff${JSON.stringify(a)}\r\n${JSON.stringify(b)}\r\n${JSON.stringify(c)}\r\n`);
  await writeFile(path.join(directory, 'memory.jsonl'), raw);
  const { owner, expectedRevision, expectedHashes } = await snapshot(directory), plan = planFor(owner, [a.id]);
  const result = await store.remove({ expectedRevision, expectedHashes, plan });
  assert.equal(result.ok, true);
  assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), Buffer.from(`\ufeff${JSON.stringify(b)}\r\n${JSON.stringify(c)}\r\n`));
});

test('removal fences all three owner hashes, plan freshness, and pending evidence', async (t) => {
  for (const file of ['personality.md', 'objectives.json', 'memory.jsonl']) {
    const { directory, store } = await setup(t, [episode(1)]), snap = await snapshot(directory), plan = planFor(snap.owner, [snap.owner.files.memory.journal.entries[0].id]);
    await writeFile(path.join(directory, file), file === 'personality.md' ? 'Edited.' : file === 'objectives.json' ? `${JSON.stringify({ v: 1, revision: 2, scope, goals: [] })}\n` : '');
    assert.equal((await store.remove({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes, plan })).why, 'owner_hash_conflict');
  }
  const { directory, store } = await setup(t, [episode(1)]), snap = await snapshot(directory), id = snap.owner.files.memory.journal.entries[0].id;
  const stale = { ...planFor(snap.owner, [id]), affectedRecords: 999 };
  assert.equal((await store.remove({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes, plan: stale })).why, 'memory_plan_conflict');
  const pending = episode(2, { required: { goals: { revision: 1, goals: [] }, pending: [{ actionId: 'act-1', kind: 'move' }] } });
  const withPending = await setup(t, [pending]), current = await snapshot(withPending.directory), pendingPlan = planFor(current.owner, [pending.id]);
  assert.deepEqual(proposeMemoryRemoval({ journal: current.owner.files.memory.journal, scope, ids: [pending.id], nowMs: 10000 }), { ok: false, why: 'memory_pending_evidence' });
  assert.ok(pendingPlan === undefined);
});

test('a concurrent append and removal share the cooperative lock', async (t) => {
  const first = episode(1), second = episode(2), { directory, store } = await setup(t, [first]), snap = await snapshot(directory);
  const plan = planFor(snap.owner, [first.id]);
  const [removed, appended] = await Promise.all([
    store.remove({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes, plan }),
    store.append({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes, entry: second }),
  ]);
  assert.ok(removed.ok || appended.ok);
  assert.ok(['memory_locked', 'owner_hash_conflict', 'memory_revision_conflict'].includes(removed.why) || removed.ok);
  assert.ok(['memory_locked', 'owner_hash_conflict', 'memory_revision_conflict'].includes(appended.why) || appended.ok);
  const final = await snapshot(directory);
  assert.equal(parseMemoryJournal(final.owner.files.memory.content, scope).revision, final.expectedRevision);
});

test('guard rejection and temp tampering prevent removal; empty result commits empty bytes', async (t) => {
  const item = episode(1), { directory, store } = await setup(t, [item]), snap = await snapshot(directory), plan = planFor(snap.owner, [item.id]);
  const before = await readFile(path.join(directory, 'memory.jsonl'));
  assert.equal((await store.remove({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes, plan, guard: () => ({ ok: false, why: 'mission_inactive' }) })).why, 'mission_inactive');
  assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), before);
  const fresh = await snapshot(directory), freshPlan = planFor(fresh.owner, [item.id]);
  let guardCalls = 0;
  const tampered = await store.remove({ expectedRevision: fresh.expectedRevision, expectedHashes: fresh.expectedHashes, plan: freshPlan, guard: () => {
    guardCalls += 1;
    if (guardCalls === 2) {
      const temp = readdirSync(directory).find((name) => name.startsWith('.memory-') && name.endsWith('.tmp'));
      assert.ok(temp); writeFileSync(path.join(directory, temp), 'tampered');
    }
    return { ok: true };
  } });
  assert.equal(guardCalls, 2);
  assert.equal(tampered.why, 'memory_temp_changed');
  const finalSnap = await snapshot(directory), finalPlan = planFor(finalSnap.owner, [item.id]);
  assert.equal((await store.remove({ expectedRevision: finalSnap.expectedRevision, expectedHashes: finalSnap.expectedHashes, plan: finalPlan })).ok, true);
  assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), Buffer.alloc(0));
});

test('explicit migration canonicalizes JSONL while preserving accepted v1 semantics and replays exact bytes', async (t) => {
  const legacy = { id: 'owner-note', revision: 1, scope, text: 'Historical note.', certainty: 'uncertain', createdAtMs: 10, validUntilMs: null, tags: ['past'], sources: [] };
  const { directory, store } = await setup(t, [legacy]);
  const unusual = `  ${JSON.stringify(legacy)}  \r\n`;
  await writeFile(path.join(directory, 'memory.jsonl'), unusual);
  const before = await snapshot(directory), beforeRecords = before.owner.files.memory.journal.records;
  const migrated = await store.migrate({ expectedRevision: before.expectedRevision, expectedHashes: before.expectedHashes });
  assert.deepEqual(migrated, { ok: true, migration: 'canonical_jsonl', fromRevision: 1, revision: 1, sha256: migrated.sha256, replay: false });
  assert.equal(await readFile(path.join(directory, 'memory.jsonl'), 'utf8'), `${JSON.stringify(legacy)}\n`);
  const after = await snapshot(directory);
  assert.deepEqual(after.owner.files.memory.journal.records, beforeRecords);
  assert.deepEqual(await store.migrate({ expectedRevision: after.expectedRevision, expectedHashes: after.expectedHashes }),
    { ok: true, migration: 'canonical_jsonl', fromRevision: 1, revision: 1, sha256: after.expectedHashes.memory, replay: true });
});

test('no-op removal and migration recheck both guards and preserve raw bytes', async (t) => {
  const item = episode(1), { directory, store } = await setup(t, [item]);
  const raw = Buffer.from(`\ufeff${JSON.stringify(item)}\r\n`); await writeFile(path.join(directory, 'memory.jsonl'), raw);
  const snap = await snapshot(directory), unchangedPlan = proposeMemoryRemoval({ journal: snap.owner.files.memory.journal, scope,
    retention: { expired: true, beforeMs: null }, nowMs: 10000 }).plan;
  let removeCalls = 0;
  const noRemoval = await store.remove({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes, plan: unchangedPlan,
    guard: () => (++removeCalls === 2 ? { ok: false, why: 'mission_inactive' } : { ok: true }) });
  assert.deepEqual(noRemoval, { ok: false, why: 'mission_inactive' });
  assert.equal(removeCalls, 2); assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), raw);

  const fresh = await snapshot(directory); let migrateCalls = 0;
  const noMigration = await store.migrate({ expectedRevision: fresh.expectedRevision, expectedHashes: fresh.expectedHashes,
    guard: () => (++migrateCalls === 2 ? { ok: false, why: 'mission_inactive' } : { ok: true }) });
  assert.deepEqual(noMigration, { ok: false, why: 'mission_inactive' });
  assert.equal(migrateCalls, 2); assert.deepEqual(await readFile(path.join(directory, 'memory.jsonl')), raw);
});

test('migration fences each owner hash before doing any rewrite', async (t) => {
  for (const file of ['personality.md', 'objectives.json', 'memory.jsonl']) {
    const { directory, store } = await setup(t, [episode(1)]), snap = await snapshot(directory);
    await writeFile(path.join(directory, file), file === 'personality.md' ? 'Edited.' : file === 'objectives.json'
      ? `${JSON.stringify({ v: 1, revision: 2, scope, goals: [] })}\n` : '');
    assert.equal((await store.migrate({ expectedRevision: snap.expectedRevision, expectedHashes: snap.expectedHashes })).why, 'owner_hash_conflict');
  }
});

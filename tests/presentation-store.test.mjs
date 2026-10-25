import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPresentationStore } from '../server/presentationStore.mjs';
import { emptyPresentationBindings, defaultPresentationBinding } from '../src/data/presentationBindings.js';
const document = () => ({ ...emptyPresentationBindings(), bindings: { campfire: defaultPresentationBinding('campfire', 'niagara-985a431dc6c0d1ca') } });

test('memory store validates, copies and serializes compare-and-set', async () => {
  const store = createPresentationStore();
  assert.equal((await store.get()).revision, 0);
  assert.equal((await store.put({ expectedRevision: 0, document: {}, updatedBy: 'gm' })).error, 'invalid');
  const input = document();
  const results = await Promise.all([store.put({ expectedRevision: 0, document: input, updatedBy: 'gm' }),
    store.put({ expectedRevision: 0, document: document(), updatedBy: 'gm2' })]);
  assert.deepEqual(results, [{ ok: true, revision: 1 }, { ok: false, error: 'stale', revision: 1 }]);
  input.bindings.campfire.parameters.scale = 3;
  const first = await store.get(); first.document.bindings = {};
  assert.equal((await store.get()).document.bindings.campfire.parameters.scale, 1);
});
test('durable atomic content survives restart, caps history at 20, invalid disk falls back once', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mn-presentation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const warnings = [], store = createPresentationStore({ directory, log: line => warnings.push(line) });
  await store.prepare(); await store.get(); assert.equal(warnings.length, 1);
  for (let n = 0; n < 23; n++) assert.deepEqual(await store.put({ expectedRevision: n, document: document(), updatedBy: 'gm' }), { ok: true, revision: n + 1 });
  const folder = path.join(directory, 'presentation');
  assert.deepEqual((await readdir(path.join(folder, 'revisions'))).sort((a, b) => parseInt(a) - parseInt(b)), Array.from({ length: 20 }, (_, i) => `${i + 4}.json`));
  const raw = JSON.parse(await readFile(path.join(folder, 'current.json'), 'utf8'));
  assert.equal(raw.updatedBy, 'gm'); assert.ok(Number.isFinite(Date.parse(raw.updatedAt)));
  assert.deepEqual(await createPresentationStore({ directory }).get(), raw);
  assert.deepEqual((await readdir(folder)).sort(), ['current.json', 'revisions']);
  for (const invalid of ['{broken', JSON.stringify({ ...raw, document: {} })]) {
    await writeFile(path.join(folder, 'current.json'), invalid);
    const logs = [], broken = createPresentationStore({ directory, log: line => logs.push(line) });
    assert.deepEqual((await broken.get()).document, emptyPresentationBindings());
    assert.equal((await broken.get()).revision, 0); assert.equal(logs.length, 1);
  }
});

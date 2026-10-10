import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, PREPARATION_SCHEMA } from '../src/editor/publicationArtifact.js';
import { createGmContentRegistry } from '../server/gmContentRegistry.mjs';

const WORLD = 'registry-test-world';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const lock = { async run(callback) { return callback({ assertHeld() {} }); } };

async function fixture(run, options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'gm-content-registry-'));
  const root = path.join(base, 'release'), directory = path.join(base, 'durable');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  const sources = {
    'assets/crate.glb': Buffer.from('asset-crate-bytes'),
    'assets/base.png': Buffer.from('baseline-texture'),
    'src/runtime.js': Buffer.from('runtime-v1'),
  };
  for (const [relative, body] of Object.entries(sources)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, body);
  }
  const dependency = (relative) => ({ path: relative, sha256: sha(sources[relative]), bytes: sources[relative].length });
  const content = {
    compilerVersion: 1, worldId: WORLD, sourceRevision: 4,
    document: { schema: 'marea.gm.map-draft', version: 2, base: { seed: 1, revision: 'base-v1' },
      objects: [{ id: 'obj-1', assetId: 'prop:crate' }], baseOverrides: [{ id: 'base:rock:1:abc', visible: false }] },
    assets: [{ id: 'prop:crate', src: 'assets/crate.glb', sha256: sha(sources['assets/crate.glb']), bytes: sources['assets/crate.glb'].length }],
    baselineAssets: [{ id: 'tex:base', variant: 'default', src: 'assets/base.png', sha256: sha(sources['assets/base.png']), bytes: sources['assets/base.png'].length }],
    runtime: { sha256: sha('runtime'), files: [dependency('src/runtime.js')] },
  };
  const revision = { schema: PREPARATION_SCHEMA, version: 1,
    revisionId: sha(canonicalJson(content)), content };
  const registry = createGmContentRegistry({ directory, root, worldId: WORLD, lock, ...options });
  try { await run({ base, root, directory, registry, revision, sources }); }
  finally { await rm(base, { recursive: true, force: true }); }
}

test('empty registry has a world-scoped initial state and prepare is repeatable', async () => fixture(async ({ registry }) => {
  await registry.prepare(); await registry.prepare();
  assert.deepEqual(await registry.state(), { generation: 0, revisionId: null, operations: {} });
  assert.deepEqual(await registry.list(), []);
}));

test('restart validates an existing registry without acquiring the updater-held lock', async () => fixture(async ({ registry, directory, root }) => {
  await registry.prepare();
  const noLock = { async run() { throw Object.assign(new Error('busy'), { code: 'gm_content_lock_busy' }); } };
  const restarted = createGmContentRegistry({ directory, root, worldId: WORLD, lock: noLock });
  await restarted.prepare();
  assert.deepEqual(await restarted.state(), { generation: 0, revisionId: null, operations: {} });
}));

test('retain stores canonical revision and exact dependency bytes, then reloads after restart', async () => fixture(async ({ registry, directory, revision, sources, root }) => {
  await registry.prepare();
  const saved = await registry.retain(revision);
  assert.deepEqual(saved, { revisionId: revision.revisionId, objects: 1, baseChanges: 1 });
  assert.deepEqual((await registry.list()).map(({ revisionId, objects, baseChanges }) => ({ revisionId, objects, baseChanges })),
    [{ revisionId: revision.revisionId, objects: 1, baseChanges: 1 }]);
  for (const dependency of [...revision.content.assets, ...revision.content.baselineAssets, ...revision.content.runtime.files]) {
    assert.deepEqual(await readFile(path.join(directory, 'blobs', dependency.sha256)), sources[dependency.src ?? dependency.path]);
  }
  const restarted = createGmContentRegistry({ directory, root, worldId: WORLD, lock }); await restarted.prepare();
  assert.equal((await restarted.load(revision.revisionId)).revisionId, revision.revisionId);
}));

test('retention rejects altered source bytes and leaves revision unpublished', async () => fixture(async ({ registry, root, revision }) => {
  await registry.prepare();
  await writeFile(path.join(root, 'assets/crate.glb'), Buffer.from('tampered'));
  await assert.rejects(registry.retain(revision), { code: 'dependency' });
  assert.deepEqual(await registry.list(), []);
}));

test('retention and load reject revision hash mismatch and missing retained bytes', async () => fixture(async ({ registry, directory, revision, root }) => {
  await registry.prepare();
  const altered = structuredClone(revision); altered.content.document.objects[0].id = 'changed';
  await assert.rejects(registry.retain(altered), { code: 'artifact' });
  await registry.retain(revision);
  await rm(path.join(directory, 'blobs', revision.content.assets[0].sha256));
  const restarted = createGmContentRegistry({ directory, root, worldId: WORLD, lock });
  await assert.rejects(restarted.prepare(), { code: 'dependency' });
}));

test('retention rejects runtime paths outside the release allowlist', async () => fixture(async ({ registry, revision }) => {
  await registry.prepare();
  const escaped = structuredClone(revision);
  escaped.content.runtime.files[0].path = '../../outside.env';
  escaped.revisionId = sha(canonicalJson(escaped.content));
  await assert.rejects(registry.retain(escaped), { code: 'artifact' });
}));

test('switch uses generation CAS, records exact replay, and survives restart', async () => fixture(async ({ registry, directory, revision, root }) => {
  await registry.prepare(); await registry.retain(revision);
  const first = await registry.withLock(() => registry.switch({ operationId: 'activate-1', expectedGeneration: 0, revisionId: revision.revisionId }));
  assert.deepEqual(first, { ok: true, replay: false, generation: 1, revisionId: revision.revisionId });
  assert.deepEqual(await registry.withLock(() => registry.switch({ operationId: 'activate-1', expectedGeneration: 0, revisionId: revision.revisionId })),
    { ...first, replay: true });
  const conflict = await registry.withLock(() => registry.switch({ operationId: 'activate-stale', expectedGeneration: 0, revisionId: null }));
  assert.deepEqual(conflict, { ok: false, replay: false, generation: 1, revisionId: revision.revisionId });
  const restarted = createGmContentRegistry({ directory, root, worldId: WORLD, lock }); await restarted.prepare();
  assert.equal((await restarted.state()).revisionId, revision.revisionId);
  assert.equal((await restarted.state()).generation, 1);
}));

test('operation IDs cannot be reused with a different request', async () => fixture(async ({ registry, revision }) => {
  await registry.prepare(); await registry.retain(revision);
  await registry.withLock(() => registry.switch({ operationId: 'same-id', expectedGeneration: 0, revisionId: revision.revisionId }));
  await assert.rejects(registry.withLock(() => registry.switch({ operationId: 'same-id', expectedGeneration: 1, revisionId: null })), { code: 'operation' });
}));

test('failed state rename keeps old state and leaves only an unreachable candidate blob/revision', async () => fixture(async ({ base, directory, registry, revision, root }) => {
  await registry.prepare(); await registry.retain(revision);
  const failing = createGmContentRegistry({ directory, root, worldId: WORLD, lock,
    fault: async (point) => { if (point === 'beforeStateRename') throw new Error('injected failure'); } });
  await failing.prepare();
  await assert.rejects(failing.withLock(() => failing.switch({ operationId: 'failed-op', expectedGeneration: 0, revisionId: revision.revisionId })), /injected failure/);
  const restarted = createGmContentRegistry({ directory, root, worldId: WORLD, lock }); await restarted.prepare();
  assert.deepEqual(await restarted.state(), { generation: 0, revisionId: null, operations: {} });
}));

test('failure after state rename reports unknown outcome but durable state is recoverable', async () => fixture(async ({ directory, registry, revision, root }) => {
  await registry.prepare(); await registry.retain(revision);
  const failing = createGmContentRegistry({ directory, root, worldId: WORLD, lock,
    fault: async (point) => { if (point === 'afterStateRename') throw new Error('injected post-rename failure'); } });
  await failing.prepare();
  await assert.rejects(failing.withLock(() => failing.switch({ operationId: 'uncertain-op', expectedGeneration: 0, revisionId: revision.revisionId })), /injected post-rename failure/);
  assert.equal((await failing.state()).revisionId, revision.revisionId);
  const restarted = createGmContentRegistry({ directory, root, worldId: WORLD, lock }); await restarted.prepare();
  assert.equal((await restarted.state()).generation, 1);
}));

test('registry refuses a different world scope', async () => fixture(async ({ directory, root, registry }) => {
  await registry.prepare();
  const other = createGmContentRegistry({ directory, root, worldId: 'other-world', lock });
  await assert.rejects(other.prepare(), { code: 'state' });
}));

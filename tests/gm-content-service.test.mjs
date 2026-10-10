import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { createGmContentService, sameContentIdentity } from '../server/gmContent.mjs';

const WORLD = 'gm-content-service-test', BASE = 'terrain-s21-v1';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => sha(Buffer.from(canonicalJson(value)));

function fakeLock() {
  return { busy: false, async run(callback) {
    if (this.busy) throw Object.assign(new Error('held'), { code: 'gm_content_lock_busy' });
    return callback({ assertHeld() {} });
  } };
}

function durableStore({ profiles = [{ accountId: '00000000-0000-4000-8000-000000000001',
  profile: { cp: 'spawn', eco: { ships: [] } } }], ground = [], deaths = [] } = {}) {
  const initial = JSON.stringify({ profiles, ground, deaths });
  return { durable: true, profiles, ground, deaths, writes: [], initial,
    async listGmContentProfiles({ after, limit }) { return profiles.filter((row) => !after || row.accountId > after).slice(0, limit); },
    async listPearlGround(worldId, { afterUid, limit }) { return ground.filter((row) => row.world === worldId && (!afterUid || row.uid > afterUid)).slice(0, limit); },
    async listCurrentDeathDrops(worldId, { after, limit }) { return deaths.filter((row) => row.world === worldId && (!after || row.operationId > after.operationId || row.operationId === after.operationId && row.ordinal > after.ordinal)).slice(0, limit); },
    async saveProfile(...args) { this.writes.push(['saveProfile', ...args]); },
    async commitWorld(...args) { this.writes.push(['commitWorld', ...args]); },
    snapshot() { return JSON.stringify({ profiles: this.profiles, ground: this.ground, deaths: this.deaths }); },
  };
}

function gameFixture(baseMap, store, { busy = false } = {}) {
  const game = { store, server: { world: { map: { ...baseMap } } }, closing: false, switching: false,
    healthy() { return !this.closing; },
    beginContentSwitch() {
      if (busy || this.switching) throw Object.assign(new Error('gm_content_busy'), { code: 'gm_content_busy' });
      this.switching = true;
      return () => { this.switching = false; };
    },
    closeContentSpectators() { this.closedSpectators = (this.closedSpectators || 0) + 1; },
    fenceWorld(code) { this.fenced = code; this.closing = true; },
  };
  return game;
}

function artifact(map, objects = [], sourceRevision = 1) {
  const document = createDocument({ seed: map.seed, baseRevision: BASE, objects });
  const sourceBytes = Buffer.from(`asset-${sourceRevision}`), runtimeBytes = Buffer.from('runtime-v1');
  const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId: WORLD, sourceRevision,
    base: { seed: map.seed, revision: BASE }, document, documentHash: digest(document),
    runtime: { sha256: sha(runtimeBytes), files: [{ path: 'src/gm-runtime.js', sha256: sha(runtimeBytes), bytes: runtimeBytes.length }], gameVersion: 'test', protocolVersion: 51 },
    assets: [{ id: 'prop:crate', src: 'assets/gm-crate.glb', sha256: sha(sourceBytes), bytes: sourceBytes.length, status: 'ready' }],
    baselineAssets: [], collision: { count: map.colliders.length, sha256: digest(map.colliders) },
    validation: { valid: true, issues: [], summary: { edits: objects.length, errors: 0, warnings: 0, totalIssues: 0, omittedIssues: 0 } } };
  return { schema: PREPARATION_SCHEMA, version: 1, revisionId: digest(content), content,
    sources: { 'assets/gm-crate.glb': sourceBytes, 'src/gm-runtime.js': runtimeBytes } };
}

async function fixture(run, options = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-content-service-'));
  const root = path.join(temp, 'release'), directory = path.join(temp, 'durable');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  const map = generateWorld(424242), store = durableStore(options), lock = fakeLock(), game = gameFixture(map, store, options);
  const revisions = new Map();
  const publication = { async build({ document }) {
    const revision = revisions.get(canonicalJson(document));
    return revision ? { revision } : { revision: null };
  } };
  const service = createGmContentService({ directory, root, worldId: WORLD, baseMap: map, baseRevision: BASE, game, publication, lock,
    registryFault: options.registryFault });
  try { await run({ temp, root, directory, map, store, lock, game, service, revisions }); }
  finally { await rm(temp, { recursive: true, force: true }); }
}

async function retain({ root, service, revisions }, rev) {
  for (const [relative, bytes] of Object.entries(rev.sources)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
  }
  revisions.set(canonicalJson(rev.content.document), rev);
  const { sources, ...prepared } = rev;
  await service.register(prepared);
  return prepared;
}

test('real durable registry activates, replays exactly, reloads active state after restart, then rolls back to base', async () => fixture(async (f) => {
  await f.service.prepare();
  const revision = await retain(f, artifact(f.map, [createDecoration({ id: 'visual', assetId: 'prop:crate', position: { x: 180, y: 0, z: 180 } })]));
  const m5Before = f.store.snapshot(), activeMapBase = f.map.colliders;
  const operation = { operationId: 'activate-visual-1', expectedGeneration: 0, revisionId: revision.revisionId };
  const activated = await f.service.activate(operation);
  assert.equal(activated.ok, true);
  assert.equal(activated.active.generation, 1);
  assert.equal(f.service.snapshot().revisionId, revision.revisionId);
  assert.equal(f.game.contentIdentity.revisionId, revision.revisionId);
  assert.notEqual(f.game.server.world.map.colliders, activeMapBase);
  assert.equal(f.store.snapshot(), m5Before);
  assert.deepEqual(f.store.writes, []);

  const replay = await f.service.activate(operation);
  assert.equal(replay.replay, true);
  assert.equal(replay.generation, 1);
  assert.equal(f.game.closedSpectators, 1, 'replay does not repeat side effects');

  const restartedGame = gameFixture(f.map, f.store);
  const restarted = createGmContentService({ directory: f.directory, root: f.root, worldId: WORLD, baseMap: f.map,
    baseRevision: BASE, game: restartedGame, publication: f.servicePublication || {
      async build({ document }) { const stored = f.revisions.get(canonicalJson(document)); return stored ? { revision: stored } : { revision: null }; },
    }, lock: f.lock });
  await restarted.prepare();
  assert.equal(restarted.snapshot().generation, 1);
  assert.equal(restarted.snapshot().revisionId, revision.revisionId);
  assert.ok(restartedGame.server.world.map.colliders.length > 0);

  const rollback = await restarted.activate({ operationId: 'rollback-base-2', expectedGeneration: 1, revisionId: null });
  assert.equal(rollback.generation, 2);
  assert.equal(rollback.revisionId, null);
  assert.deepEqual(restartedGame.server.world.map.colliders, f.map.colliders);
  assert.equal(f.store.snapshot(), m5Before);
  assert.deepEqual(f.store.writes, []);
}));

test('activation rejects lock busy before beginning world exclusion and leaves durable state unchanged', async () => fixture(async (f) => {
  await f.service.prepare();
  const revision = await retain(f, artifact(f.map));
  f.lock.busy = true;
  await assert.rejects(f.service.activate({ operationId: 'busy-lock', expectedGeneration: 0, revisionId: revision.revisionId }),
    (error) => error.code === 'gm_content_busy');
  f.lock.busy = false;
  assert.equal(f.service.snapshot().generation, 0);
  assert.equal(f.game.switching, false);
}));

test('activation refuses an occupied durable item and a busy game before pointer commit', async (t) => {
  await fixture(async (f) => {
    await f.service.prepare();
    const revision = await retain(f, artifact(f.map, [createDecoration({ id: 'crate', assetId: 'prop:crate',
      position: { x: 200, y: 0, z: 200 }, collider: { type: 'circle', radius: 1 } })]));
    f.store.ground.push({ uid: 'persistent-item', world: WORLD, ground: { x: 200, z: 200 } });
    await assert.rejects(f.service.activate({ operationId: 'occupied-item', expectedGeneration: 0, revisionId: revision.revisionId }),
      (error) => error.code === 'gm_content_occupied');
    assert.equal(f.service.snapshot().generation, 0);
    assert.equal(f.game.switching, false);
    t.diagnostic('occupied preflight left the registry head and M5 state unchanged');
  });
  await fixture(async (f) => {
    await f.service.prepare();
    const revision = await retain(f, artifact(f.map));
    f.game.switching = true;
    await assert.rejects(f.service.activate({ operationId: 'busy-world', expectedGeneration: 0, revisionId: revision.revisionId }),
      (error) => error.code === 'gm_content_busy');
    assert.equal(f.service.snapshot().generation, 0);
    f.game.switching = false;
  });
});

test('lost state rename acknowledgment reconciles durable activation and restart replays the same pointer', async () => fixture(async (f) => {
  await f.service.prepare();
  const revision = await retain(f, artifact(f.map, [createDecoration({ id: 'visual', assetId: 'prop:crate', position: { x: 180, y: 0, z: 180 } })]));
  const m5Before = f.store.snapshot();
  let failAfterRename = true;
  const uncertain = createGmContentService({ directory: f.directory, root: f.root, worldId: WORLD, baseMap: f.map,
    baseRevision: BASE, game: f.game, publication: { async build({ document }) {
      const built = f.revisions.get(canonicalJson(document)); return built ? { revision: built } : { revision: null };
    } }, lock: f.lock, registryFault: async (point) => {
      if (point === 'afterStateRename' && failAfterRename) { failAfterRename = false; throw new Error('ack lost after rename'); }
    } });
  await uncertain.prepare();
  const operation = { operationId: 'uncertain-rename-1', expectedGeneration: 0, revisionId: revision.revisionId };
  await assert.rejects(uncertain.activate(operation), /ack lost after rename/);
  assert.equal(uncertain.snapshot().generation, 1, 'service reconciles the durable receipt before reopening admission');
  assert.equal(uncertain.snapshot().revisionId, revision.revisionId);
  assert.equal(f.game.contentIdentity.revisionId, revision.revisionId);
  assert.equal(f.game.closedSpectators, 1);
  assert.equal(f.store.snapshot(), m5Before);
  assert.deepEqual(f.store.writes, []);

  const restartedGame = gameFixture(f.map, f.store);
  const restarted = createGmContentService({ directory: f.directory, root: f.root, worldId: WORLD, baseMap: f.map,
    baseRevision: BASE, game: restartedGame, publication: { async build({ document }) {
      const built = f.revisions.get(canonicalJson(document)); return built ? { revision: built } : { revision: null };
    } }, lock: f.lock });
  await restarted.prepare();
  assert.equal(restarted.snapshot().generation, 1);
  assert.equal(restarted.snapshot().revisionId, revision.revisionId);
  const replay = await restarted.activate(operation);
  assert.equal(replay.replay, true);
  assert.equal(replay.generation, 1);
  assert.equal(restartedGame.closedSpectators, undefined, 'replay has no activation side effects');
  assert.equal(f.store.snapshot(), m5Before);
  assert.deepEqual(f.store.writes, []);
}));

test('strict publication fingerprint mismatch fails before installation or durable pointer change', async () => fixture(async (f) => {
  await f.service.prepare();
  const revision = await retain(f, artifact(f.map));
  // A publication rebuild that does not reproduce the registered content hash is incompatible.
  f.revisions.set(canonicalJson(revision.content.document), { ...revision, revisionId: 'f'.repeat(64) });
  const colliders = structuredClone(f.game.server.world.map.colliders);
  await assert.rejects(f.service.activate({ operationId: 'fingerprint-mismatch', expectedGeneration: 0, revisionId: revision.revisionId }),
    (error) => error.code === 'gm_content_incompatible');
  assert.equal(f.service.snapshot().generation, 0);
  assert.deepEqual(f.game.server.world.map.colliders, colliders);
  assert.equal(f.game.switching, false);
  assert.deepEqual(f.store.writes, []);
}));

test('content identity requires the exact server generation and revision pair', () => {
  const identity = { generation: 8, revisionId: 'a'.repeat(64) };
  assert.equal(sameContentIdentity(identity, structuredClone(identity)), true);
  assert.equal(sameContentIdentity(identity, { generation: 7, revisionId: identity.revisionId }), false);
  assert.equal(sameContentIdentity(identity, { generation: 8, revisionId: 'b'.repeat(64) }), false);
  assert.equal(sameContentIdentity(identity, { ...identity, switching: false }), false);
  assert.equal(sameContentIdentity(identity, null), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGmContentService } from '../server/gmContent.mjs';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { compileAuthoredResources } from '../src/editor/resourceAdapters.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { ACCOUNT_ONE, RESOURCE_WORLD, accountProfile, calmAt, connect, makeResourceHost, makeResourceStore, submitAndApply } from './helpers/resource-authority-fixture.mjs';

const BASE = 'terrain-s21-v1', ID = 'gm-12345678-1234-4234-8234-123456789abc';
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(canonicalJson(value));
const lock = { run: async fn => fn({ assertHeld() {} }) };

async function fixture(t, { admissionFault = false, pointerFault = false } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-functional-publication-'));
  const root = path.join(temp, 'release'), directory = path.join(temp, 'registry');
  await mkdir(path.join(root, 'assets'), { recursive: true }); await mkdir(path.join(root, 'src'), { recursive: true });
  const { store: memory } = makeResourceStore();
  let admits = 0;
  const store = { ...memory, durable: true, async admitGmResources(...args) {
    admits++; const result = await memory.admitGmResources(...args);
    if (admissionFault) { admissionFault = false; throw new Error('SQL response lost'); }
    return result;
  } };
  await store.initializeProfile(ACCOUNT_ONE, accountProfile({ tools: { axe: 1 } }));
  const game = makeResourceHost(store), map = { ...game.server.world.map }, revisions = new Map();
  // Source bytes/publication rebuild are fixtures; projection, registry, M5 store and host are real.
  const publication = { build: async ({ document }) => ({ revision: revisions.get(canonicalJson(document)) }) };
  const service = createGmContentService({ directory, root, worldId: RESOURCE_WORLD, baseMap: map, baseRevision: BASE,
    game, publication, lock, registryFault(point) {
      if (pointerFault && point === 'afterStateRename') { pointerFault = false; throw new Error('pointer response lost'); }
    } });
  t.after(async () => { try { await game.close(); } catch (error) { if (error.code !== 'flush') throw error; }
    await rm(temp, { recursive: true, force: true }); });
  await service.prepare(); await game.prepare();
  let object;
  for (let z = -240; z < 240 && !object; z += 8) for (let x = -240; x < 240 && !object; x += 8) {
    const candidate = createDecoration({ id: ID, assetId: 'prop:gm-resource-palm-v1',
      position: { x, y: map.groundAt(x, z), z }, collider: 'none' });
    try { compileAuthoredResources(map, { objects: [candidate] }); object = candidate; } catch {}
  }
  assert.ok(object);
  const bytes = Buffer.from('pinned-fixture'), assetPath = 'assets/gm-resource.glb', runtimePath = 'src/gm-resource.js';
  await writeFile(path.join(root, assetPath), bytes); await writeFile(path.join(root, runtimePath), bytes);
  const document = createDocument({ seed: map.seed, baseRevision: BASE, objects: [object] });
  const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId: RESOURCE_WORLD, sourceRevision: 1,
    base: { seed: map.seed, revision: BASE }, document, documentHash: digest(document),
    resources: { count: 1, sha256: digest(compileAuthoredResources(map, document)) },
    runtime: { sha256: hash(bytes), files: [{ path: runtimePath, sha256: hash(bytes), bytes: bytes.length }], gameVersion: 'test', protocolVersion: 58 },
    assets: [{ id: 'model:palm-tall-v1', src: assetPath, sha256: hash(bytes), bytes: bytes.length, status: 'ready' }],
    baselineAssets: [], collision: { count: map.colliders.length, sha256: digest(map.colliders) },
    validation: { valid: true, issues: [], summary: { edits: 1, errors: 0, warnings: 0, totalIssues: 0, omittedIssues: 0 } } };
  const revision = { schema: PREPARATION_SCHEMA, version: 1, revisionId: digest(content), content };
  revisions.set(canonicalJson(document), revision); await service.register(revision);
  const activation = { operationId: 'functional-activate', expectedGeneration: 0, revisionId: revision.revisionId };
  return { game, service, store, map, directory, root, publication, revision, activation, admits: () => admits };
}

test('content registry and M5 host activate resources, gather normally, rollback and restore on restart without pruning', async t => {
  const f = await fixture(t), { game, service, store } = f;
  assert.equal(game.server.world.map.gmResources.length, 0, 'registering a private preparation grants no resource');
  assert.equal(f.admits(), 0);
  await service.activate(f.activation);
  const id = game.server.world.map.gmResources[0].id, node = game.server.world.resources.nodes.get(id);
  assert.equal((await store.loadWorld(RESOURCE_WORLD)).data.resources.nodes.at(-1).id, id);
  const client = connect(game);
  client.ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION,
    name: 'Published resource tester', content: game.contentIdentity })), false);
  await Promise.all([...game.joins]);
  calmAt(game, game.server.clients.get(client.id).entity, node);
  assert.equal((await submitAndApply(game, client, { type: 'resource', op: 'gather', opId: 'published-palm-hit', node: id, expectedRev: 1 })).ok, true);
  client.ws.close(); await game.economicAuthority.settle(); await game.profiles.flush(); await game.worldState.flush();
  const row = structuredClone(game.worldState.resources.nodes.find(n => n.id === id));
  await service.activate({ operationId: 'functional-base', expectedGeneration: 1, revisionId: null });
  assert.equal(game.server.world.resources.nodes.has(id), false);
  game.worldState.save(game.server.world.economy); await game.worldState.flush();
  assert.deepEqual((await store.loadWorld(RESOURCE_WORLD)).data.resources.nodes.find(n => n.id === id), row);
  await service.activate({ operationId: 'functional-rollback', expectedGeneration: 2, revisionId: f.revision.revisionId });
  assert.equal(game.server.world.resources.nodes.get(id).hits, 1); assert.equal(f.admits(), 1);
  await game.close();
  const restarted = makeResourceHost(store);
  const next = createGmContentService({ directory: f.directory, root: f.root, worldId: RESOURCE_WORLD,
    baseMap: f.map, baseRevision: BASE, game: restarted, publication: f.publication, lock });
  t.after(() => restarted.close()); await next.prepare(); await restarted.prepare();
  assert.equal(restarted.server.world.resources.nodes.get(id).hits, 1);
});

test('lost pointer ACK reconciles an admitted functional layout and exact retry does not admit twice', async t => {
  const f = await fixture(t, { pointerFault: true });
  await assert.rejects(f.service.activate(f.activation), /pointer response lost/);
  assert.equal(f.service.snapshot().generation, 1); assert.equal(f.game.healthy(), true);
  const id = f.game.server.world.map.gmResources[0].id;
  assert.equal(f.game.server.world.resources.nodes.has(id), true);
  assert.equal((await f.service.activate(f.activation)).replay, true); assert.equal(f.admits(), 1);
});

test('lost SQL ACK fences gameplay before pointer switch and leaves only inactive durable rows', async t => {
  const f = await fixture(t, { admissionFault: true });
  await assert.rejects(f.service.activate(f.activation), /SQL response lost/);
  assert.equal(f.service.snapshot().generation, 0); assert.equal(f.game.worldState.ready, false);
  assert.equal(f.game.server.world.map.gmResources.length, 0);
  const saved = (await f.store.loadWorld(RESOURCE_WORLD)).data.resources;
  assert.ok(saved.nodes.some(n => n.id.startsWith('gm_')), 'SQL committed before its response was lost');
  await f.game.close().catch(() => {});
  const restarted = makeResourceHost(f.store);
  const next = createGmContentService({ directory: f.directory, root: f.root, worldId: RESOURCE_WORLD,
    baseMap: f.map, baseRevision: BASE, game: restarted, publication: f.publication, lock });
  t.after(() => restarted.close()); await next.prepare(); await restarted.prepare();
  await next.activate(f.activation);
  assert.equal(next.snapshot().generation, 1); assert.equal(f.admits(), 1, 'existing roster resumes without reset or extra SQL admission');
});

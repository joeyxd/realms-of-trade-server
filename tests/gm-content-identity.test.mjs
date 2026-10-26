// GM07b0 (D10): a schema 2 revision is named by its content only, so it survives a release that changes code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION, sameRevisionIdentity } from '../src/editor/publicationArtifact.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { validateGmRoutes, projectGmContent } from '../src/editor/contentProjection.js';
import { gmContentHash, loadGmWorldContent } from '../src/editor/activeContent.js';
import { resourceLayout } from '../src/data/resources.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';
import { createGmContentRegistry } from '../server/gmContentRegistry.mjs';
import { createGmContentService } from '../server/gmContent.mjs';
import { checkGmContentRelease } from '../server/gmContentCheck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = 'gm-content-identity-test', BASE = 'terrain-s21-v1';
const LOCK = { async run(callback) { return callback({ assertHeld() {} }); } };
// The release that prepares, and another one that differs in game version, protocol and code bytes.
const RELEASE_A = { gameVersion: '0.6.0-identity-a', protocolVersion: 7 };
const RELEASE_B = { gameVersion: '0.6.0-identity-b', protocolVersion: 8 };
const CODE_FILES = ['server/gmPublication.mjs', 'server/gmPublicationAssets.mjs', 'server/gmDraftValidation.mjs',
  'server/gmContentObstacles.mjs', 'index.html', 'package.json', 'package-lock.json'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha(Buffer.from(canonicalJson(value)));
const variants = (manifest) => manifest.assets.reduce((sum, entry) => sum + 1 + (entry.mobileSrc ? 1 : 0), 0);
const MAP = generateWorld(GAME.seed);

function publicationDocument(map, assetId = 'prop:storage-crate') {
  const village = map.landmarks.village;
  for (let ring = 15; ring <= 65; ring += 5) for (let a = 0; a < 32; a++) {
    const x = village.x + Math.cos(a * Math.PI / 16) * ring;
    const z = village.z + Math.sin(a * Math.PI / 16) * ring;
    if (Math.abs(x) > 270 || Math.abs(z) > 270 || map.groundAt(x, z) < 1 ||
        map.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3)) continue;
    const document = createDocument({ seed: map.seed, baseRevision: BASE, objects: [createDecoration({
      id: 'identity-crate', assetId, position: { x, y: map.groundAt(x, z), z }, collider: { type: 'circle', radius: 1 },
    })] });
    if (validateGmPublication({ map, document, baseRevision: BASE }).valid &&
        validateGmRoutes(map, projectGmContent(map, document)).valid) return document;
  }
  throw new Error('No safe identity fixture location');
}

async function service({ gameVersion, protocolVersion, root = ROOT, runtimeRoot = root }) {
  const validateReferences = createGmDraftValidator({ map: MAP, baseRevision: BASE,
    manifest: JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8')),
    editorCatalog: JSON.parse(await readFile(path.join(root, 'assets/editor/catalog.json'), 'utf8')) });
  const publication = createGmPublicationService({ root, runtimeRoot, map: MAP, baseRevision: BASE, worldId: WORLD,
    validateReferences, gameVersion, protocolVersion });
  await publication.prepare();
  return publication;
}

// Another release's code: a copy of every code file of the runtime list with one source file changed.
async function changedCode(dir) {
  await cp(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  for (const rel of CODE_FILES) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await cp(path.join(ROOT, rel), path.join(dir, rel));
  }
  await appendFile(path.join(dir, 'src/editor/document.js'), '\n// another release\n');
  return dir;
}

async function activeRegistry(directory, revision, root = ROOT) {
  const registry = createGmContentRegistry({ directory, root, worldId: WORLD, lock: LOCK });
  await registry.prepare();
  await registry.retain(revision);
  await registry.withLock(() => registry.switch({ operationId: 'identity-activate-1', expectedGeneration: 0,
    revisionId: revision.revisionId }));
  return registry;
}

async function activeState(directory, root = ROOT) {
  const registry = createGmContentRegistry({ directory, root, worldId: WORLD, lock: LOCK });
  await registry.prepare();
  const { generation, revisionId } = await registry.state();
  return { generation, revisionId };
}

function runChecker(directory) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'server/gmContentCheck.mjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MN_GM_CONTENT_DIR: directory } });
  if (result.error) throw result.error;
  return result;
}

const fixture = (run) => async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-content-identity-'));
  try { await run(temp); } finally { await rm(temp, { recursive: true, force: true }); }
};

test('(a) a schema 2 revision passes the release check under another game version, protocol and code digest and stays active', fixture(async (temp) => {
  const document = publicationDocument(MAP);
  const prepared = (await (await service(RELEASE_A)).build({ document, draftRevision: 1 })).revision;
  assert.equal(prepared.version, 2);
  assert.deepEqual({ gameVersion: prepared.preparedWith.gameVersion, protocolVersion: prepared.preparedWith.protocolVersion }, RELEASE_A);
  const audited = prepared.preparedWith.runtime.files.map((file) => file.path);
  for (const rel of ['src/editor/document.js', 'assets/manifest.json', 'assets/editor/catalog.json']) {
    assert.ok(audited.includes(rel), `${rel} is audit data`);
  }
  assert.deepEqual(prepared.content.runtime, { files: [] }, 'the identity names no release file');
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8'));
  assert.equal(prepared.preparedWith.baselineAssets.length, variants(manifest), 'every manifest file is audit data');
  assert.deepEqual(prepared.content.baselineAssets.map((asset) => asset.id), ['prop:storage-crate'],
    'only the manifest files of the models the content uses stay in the identity');
  assert.equal(prepared.revisionId, digest(prepared.content));

  const directory = path.join(temp, 'content');
  await activeRegistry(directory, prepared);
  const stateBytes = await readFile(path.join(directory, 'state.json'));
  const codeB = await changedCode(path.join(temp, 'release-b'));
  const rebuiltB = (await (await service({ ...RELEASE_B, runtimeRoot: codeB })).build({ document, draftRevision: 1 })).revision;
  assert.notEqual(rebuiltB.preparedWith.runtime.sha256, prepared.preparedWith.runtime.sha256, 'release B has another code digest');
  assert.equal(rebuiltB.revisionId, prepared.revisionId);

  assert.equal(await checkGmContentRelease({ directory, root: ROOT, ...RELEASE_B, runtimeRoot: codeB }), true);
  // The CLI the updater runs inside the candidate image: this checkout's own versions differ from release A.
  assert.notEqual(GAME.version, RELEASE_A.gameVersion); assert.notEqual(PROTOCOL_VERSION, RELEASE_A.protocolVersion);
  const cli = runChecker(directory);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /content compatible/);
  assert.deepEqual(await activeState(directory), { generation: 1, revisionId: prepared.revisionId });
  assert.deepEqual(await readFile(path.join(directory, 'state.json')), stateBytes, 'the check writes nothing');
}));

test('(b) a schema 1 revision keeps the old rule: another release fails with content_incompatible', fixture(async (temp) => {
  const document = publicationDocument(MAP);
  const releaseA = await service(RELEASE_A);
  const legacy = (await releaseA.build({ document, draftRevision: 1, version: 1 })).revision;
  assert.equal(legacy.version, 1);
  assert.equal(legacy.preparedWith, undefined);
  assert.equal(legacy.revisionId, digest(legacy.content));
  // Schema 1 content still names the whole release: what schema 2 keeps only for audit.
  const current = (await releaseA.build({ document, draftRevision: 1 })).revision;
  assert.deepEqual(legacy.content.runtime, { ...current.preparedWith.runtime, ...RELEASE_A });
  assert.deepEqual(legacy.content.baselineAssets, current.preparedWith.baselineAssets);
  const directory = path.join(temp, 'content');
  await activeRegistry(directory, legacy);
  const codeB = await changedCode(path.join(temp, 'release-b'));

  assert.equal(await checkGmContentRelease({ directory, root: ROOT, ...RELEASE_A }), true, 'the same release still passes');
  await assert.rejects(checkGmContentRelease({ directory, root: ROOT, ...RELEASE_B, runtimeRoot: codeB }), /content_incompatible/);
  await assert.rejects(checkGmContentRelease({ directory, root: ROOT, ...RELEASE_A, runtimeRoot: codeB }), /content_incompatible/,
    'a code change alone blocks a schema 1 revision');
  await assert.rejects(checkGmContentRelease({ directory, root: ROOT, ...RELEASE_A, protocolVersion: RELEASE_A.protocolVersion + 1 }),
    /content_incompatible/);
  const cli = runChecker(directory);
  assert.equal(cli.status, 1, cli.stdout);
  assert.match(cli.stderr, /content incompatible or unavailable; activate base before updating/);
  assert.deepEqual(await activeState(directory), { generation: 1, revisionId: legacy.revisionId });
}));

function glb(extras) {
  const text = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, extras }));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8);
  const chunk = Buffer.alloc(8); chunk.writeUInt32LE(padded.length, 0); chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, padded]);
}

// A whole small release (this code; the crate the content places, with a mobile variant; one model it does not
// use) whose data files the test can change.
const CRATE = { id: 'prop:storage-crate', src: 'models/crate.glb', mobileSrc: 'models/crate-mobile.glb', props: ['crate'] };
const OTHER = { id: 'model:identity-other', src: 'models/other.glb' };

async function writeIndexes(dir, { crate = CRATE, extra = [], catalog = [] } = {}) {
  await writeFile(path.join(dir, 'assets/manifest.json'), JSON.stringify({ version: 1, assets: [crate, OTHER, ...extra] }));
  await writeFile(path.join(dir, 'assets/editor/catalog.json'), JSON.stringify({ version: 1, assets: catalog }));
}

async function dataRelease(dir) {
  await changedCode(dir);
  await mkdir(path.join(dir, 'assets/models'), { recursive: true }); await mkdir(path.join(dir, 'assets/editor'), { recursive: true });
  await writeFile(path.join(dir, 'assets/models/crate.glb'), glb({ take: 1 }));
  await writeFile(path.join(dir, 'assets/models/crate-mobile.glb'), glb({ take: 1, mobile: true }));
  await writeFile(path.join(dir, 'assets/models/other.glb'), glb({ other: 1 }));
  await writeIndexes(dir);
  return dir;
}

test('(c) a schema 2 revision fails when its rebuild gives another derived hash or a file or entry it uses changed', fixture(async (temp) => {
  const document = publicationDocument(MAP);
  const release = await dataRelease(path.join(temp, 'release'));
  const prepared = (await (await service({ ...RELEASE_A, root: release })).build({ document, draftRevision: 1 })).revision;
  assert.deepEqual(prepared.content.assets.map((asset) => asset.src), ['assets/models/crate.glb']);
  assert.equal(prepared.content.assets[0].loader.mobileSrc, CRATE.mobileSrc);
  assert.deepEqual(prepared.content.baselineAssets.map((asset) => `${asset.id} ${asset.variant}`),
    ['prop:storage-crate default', 'prop:storage-crate mobile']);

  // A stored collision hash that the running code does not reproduce.
  const forged = structuredClone(prepared);
  forged.content.collision.sha256 = 'f'.repeat(64);
  forged.revisionId = digest(forged.content);
  const forgedDir = path.join(temp, 'forged');
  await activeRegistry(forgedDir, forged, release);
  await assert.rejects(checkGmContentRelease({ directory: forgedDir, root: release, ...RELEASE_B }), /content_incompatible/);

  const directory = path.join(temp, 'content');
  await activeRegistry(directory, prepared, release);
  const check = () => checkGmContentRelease({ directory, root: release, ...RELEASE_B });
  assert.equal(await check(), true);
  // The referenced model bytes change in the next release.
  await writeFile(path.join(release, 'assets/models/crate.glb'), glb({ take: 2 }));
  await assert.rejects(check(), /content_incompatible/);
  await writeFile(path.join(release, 'assets/models/crate.glb'), glb({ take: 1 }));
  // Its mobile variant, which phones draw, changes.
  await writeFile(path.join(release, 'assets/models/crate-mobile.glb'), glb({ take: 2, mobile: true }));
  await assert.rejects(check(), /content_incompatible/);
  await writeFile(path.join(release, 'assets/models/crate-mobile.glb'), glb({ take: 1, mobile: true }));
  assert.equal(await check(), true);
  // Same model bytes again, but its manifest entry now loads it differently.
  await writeIndexes(release, { crate: { ...CRATE, scale: 2 } });
  await assert.rejects(check(), /content_incompatible/);
  assert.deepEqual(await activeState(directory, release), { generation: 1, revisionId: prepared.revisionId });

  // The explicit comparison: an equal id is not enough when a derived hash differs.
  for (const field of ['collision', 'terrain', 'resources', 'base']) {
    const built = structuredClone(prepared);
    built.content[field] = { ...(built.content[field] ?? {}), sha256: 'e'.repeat(64) };
    assert.equal(sameRevisionIdentity(prepared, built), false, field);
  }
  assert.equal(sameRevisionIdentity(prepared, structuredClone(prepared)), true);
  assert.equal(sameRevisionIdentity(prepared, { ...structuredClone(prepared), version: 1 }), false);
}));

async function clientRevision(baseMap, document, { version = 2, gameVersion = 'older-release' } = {}) {
  const projection = projectGmContent(baseMap, document, BASE);
  const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId: 'marea-negra', sourceRevision: 1,
    base: { seed: baseMap.seed >>> 0, revision: BASE, propsHash: await gmContentHash(baseMap.props),
      collidersHash: await gmContentHash(baseMap.colliders), resourcesHash: await gmContentHash(resourceLayout(baseMap)) },
    document, documentHash: await gmContentHash(document),
    runtime: version === 2 ? { files: [] } : { sha256: digest('runtime'), files: [], gameVersion, protocolVersion: PROTOCOL_VERSION },
    assets: [], baselineAssets: [], collision: { count: projection.colliders.length, sha256: await gmContentHash(projection.colliders) },
    validation: { valid: true, issues: [], summary: { edits: document.objects.length, errors: 0, warnings: 0, totalIssues: 0, omittedIssues: 0 } } };
  const revision = { schema: PREPARATION_SCHEMA, version, revisionId: await gmContentHash(content), content };
  if (version === 2) revision.preparedWith = { gameVersion, protocolVersion: PROTOCOL_VERSION - 1,
    runtime: { sha256: 'a'.repeat(64), files: [] }, baselineAssets: [] };
  return revision;
}

const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, async json() { return structuredClone(body); } });

test('(d) the client accepts a schema 2 revision from another game version and still refuses a mismatched derived hash', async () => {
  const base = generateWorld(778902);
  const document = createDocument({ seed: base.seed, baseRevision: BASE, objects: [createDecoration({ id: 'visual', assetId: 'prop:crate',
    position: { x: 180, y: 1, z: 180 } })] });
  const load = (revision, map) => loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: base,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
    fetchImpl: async () => json({ ok: true, generation: 3, revisionId: revision.revisionId, revision }) });

  const revision = await clientRevision(base, document);
  assert.notEqual(revision.preparedWith.gameVersion, GAME.version);
  const map = { ...base };
  assert.equal((await load(revision, map)).generation, 3);
  assert.deepEqual(map.gmContentIdentity, { generation: 3, revisionId: revision.revisionId });
  assert.deepEqual(map.colliders, projectGmContent(base, document).colliders);

  const forged = structuredClone(revision);
  forged.content.collision.sha256 = 'f'.repeat(64);
  forged.revisionId = await gmContentHash(forged.content);
  const forgedMap = { ...base };
  await assert.rejects(load(forged, forgedMap), /content_collision/);
  assert.equal(forgedMap.gmContentIdentity, undefined);

  const legacy = await clientRevision(base, document, { version: 1 }), legacyMap = { ...base };
  await assert.rejects(load(legacy, legacyMap), /content_incompatible/, 'schema 1 still needs the same game version');
  assert.equal(legacyMap.gmContentIdentity, undefined);
});

function contentGame(baseMap) {
  return { store: { durable: true, async listGmContentProfiles() { return []; }, async listPearlGround() { return []; },
    async listCurrentDeathDrops() { return []; } },
  server: { world: { map: { ...baseMap } } }, closing: false, switching: false, installs: 0,
  healthy() { return !this.closing; }, installContentResources() { this.installs++; },
  beginContentSwitch() { this.switching = true; return () => { this.switching = false; }; },
  closeContentSpectators() {}, fenceWorld(code) { this.fenced = code; this.closing = true; } };
}

async function contentService(directory, publication, root = ROOT) {
  const game = contentGame(MAP);
  const content = createGmContentService({ directory, root, worldId: WORLD, baseMap: MAP, baseRevision: BASE,
    game, publication, lock: LOCK });
  return { game, content };
}

test('(e) server boot and activation keep a schema 2 revision across a release change; schema 1 keeps the old rule', fixture(async (temp) => {
  const document = publicationDocument(MAP);
  const releaseA = await service(RELEASE_A);
  const current = (await releaseA.build({ document, draftRevision: 1 })).revision;
  const legacy = (await releaseA.build({ document, draftRevision: 1, version: 1 })).revision;
  const codeB = await changedCode(path.join(temp, 'release-b'));
  const releaseB = await service({ ...RELEASE_B, runtimeRoot: codeB });

  // Boot of release B with a schema 2 revision active since release A.
  const activeDir = path.join(temp, 'active');
  await activeRegistry(activeDir, current);
  const booted = await contentService(activeDir, releaseB);
  await booted.content.prepare();
  assert.deepEqual({ generation: booted.content.snapshot().generation, revisionId: booted.content.snapshot().revisionId },
    { generation: 1, revisionId: current.revisionId });
  assert.deepEqual(booted.game.contentIdentity, { generation: 1, revisionId: current.revisionId });
  assert.deepEqual(booted.game.server.world.map.colliders, projectGmContent(MAP, document).colliders);
  // Registering the same content prepared by release B is idempotent and keeps the first audit record.
  const rebuilt = (await releaseB.build({ document, draftRevision: 1 })).revision;
  assert.equal(rebuilt.revisionId, current.revisionId);
  assert.notEqual(rebuilt.preparedWith.gameVersion, current.preparedWith.gameVersion);
  assert.deepEqual((await booted.content.register(rebuilt)).revisions.map((row) => row.revisionId), [current.revisionId]);
  const stored = JSON.parse(await readFile(path.join(activeDir, 'revisions', `${current.revisionId}.json`), 'utf8'));
  assert.equal(stored.preparedWith.gameVersion, RELEASE_A.gameVersion);

  // Boot of release B with a schema 1 revision active: refused as before.
  const legacyDir = path.join(temp, 'legacy');
  await activeRegistry(legacyDir, legacy);
  const refused = await contentService(legacyDir, releaseB);
  await assert.rejects(refused.content.prepare(), (error) => error.code === 'gm_content_incompatible');
  assert.equal(refused.content.ready, false);
  // The same schema 1 revision under its own release still boots.
  const same = await contentService(legacyDir, releaseA);
  await same.content.prepare();
  assert.equal(same.content.snapshot().revisionId, legacy.revisionId);

  // Activation by release B of retained revisions prepared by release A.
  const retainedDir = path.join(temp, 'retained');
  const registry = createGmContentRegistry({ directory: retainedDir, root: ROOT, worldId: WORLD, lock: LOCK });
  await registry.prepare(); await registry.retain(current); await registry.retain(legacy);
  const live = await contentService(retainedDir, releaseB);
  await live.content.prepare();
  await assert.rejects(live.content.activate({ operationId: 'identity-legacy-1', expectedGeneration: 0, revisionId: legacy.revisionId }),
    (error) => error.code === 'gm_content_incompatible');
  const activated = await live.content.activate({ operationId: 'identity-current-1', expectedGeneration: 0, revisionId: current.revisionId });
  assert.equal(activated.ok, true);
  assert.deepEqual(activated.active, { generation: 1, revisionId: current.revisionId });
}));

test('(f) a schema 2 revision passes the release check and stays active when a release adds or changes assets it does not use', fixture(async (temp) => {
  const document = publicationDocument(MAP);
  const release = await dataRelease(path.join(temp, 'release'));
  const releaseA = await service({ ...RELEASE_A, root: release });
  const prepared = (await releaseA.build({ document, draftRevision: 1 })).revision;
  const legacy = (await releaseA.build({ document, draftRevision: 1, version: 1 })).revision;
  assert.ok(prepared.preparedWith.baselineAssets.some((asset) => asset.id === OTHER.id), 'the unused model is audit data');
  assert.ok(!prepared.content.baselineAssets.some((asset) => asset.id === OTHER.id), 'and stays out of the identity');
  const directory = path.join(temp, 'content'), legacyDir = path.join(temp, 'legacy');
  await activeRegistry(directory, prepared, release);
  await activeRegistry(legacyDir, legacy, release);
  const stateBytes = await readFile(path.join(directory, 'state.json'));
  const check = () => checkGmContentRelease({ directory, root: release, ...RELEASE_B });

  // (i) The next release adds a manifest asset that the content does not use.
  const added = { id: 'model:identity-added', src: 'models/added.glb' };
  await writeFile(path.join(release, 'assets/models/added.glb'), glb({ added: 1 }));
  await writeIndexes(release, { extra: [added] });
  assert.equal(await check(), true);
  // (ii) It also publishes a new model to the editor catalog.
  const published = { id: 'model:identity-published', kind: 'model', src: 'editor/published.glb', status: 'ready' };
  await writeFile(path.join(release, 'assets/editor/published.glb'), glb({ published: 1 }));
  await writeIndexes(release, { extra: [added], catalog: [published] });
  assert.equal(await check(), true);
  // (iii) It also changes the bytes of a model file that the content does not reference.
  await writeFile(path.join(release, 'assets/models/other.glb'), glb({ other: 2 }));
  assert.equal(await check(), true);
  assert.deepEqual(await readFile(path.join(directory, 'state.json')), stateBytes, 'the check writes nothing');

  // The release did change: its rebuild carries another audit record under the same id.
  const releaseC = await service({ ...RELEASE_B, root: release });
  const rebuilt = (await releaseC.build({ document, draftRevision: 1 })).revision;
  assert.equal(rebuilt.revisionId, prepared.revisionId);
  assert.notEqual(rebuilt.preparedWith.runtime.sha256, prepared.preparedWith.runtime.sha256);
  assert.equal(rebuilt.preparedWith.baselineAssets.length, prepared.preparedWith.baselineAssets.length + 1);
  // A boot of that release keeps the revision active.
  const booted = await contentService(directory, releaseC, release);
  await booted.content.prepare();
  assert.deepEqual(booted.game.contentIdentity, { generation: 1, revisionId: prepared.revisionId });
  assert.deepEqual(await activeState(directory, release), { generation: 1, revisionId: prepared.revisionId });
  // The same changes still block a schema 1 revision, even under its own versions and code.
  await assert.rejects(checkGmContentRelease({ directory: legacyDir, root: release, ...RELEASE_A }), /content_incompatible/);
}));

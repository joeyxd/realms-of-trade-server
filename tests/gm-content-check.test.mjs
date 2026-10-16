import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { canonicalJson } from '../src/editor/publicationArtifact.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { validateGmRoutes, projectGmContent } from '../src/editor/contentProjection.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';
import { createGmContentRegistry } from '../server/gmContentRegistry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = 'gm-check-release-test';
const LOCK = { async run(callback) { return callback({ assertHeld() {} }); } };
const sha = (value) => createHash('sha256').update(value).digest('hex');

function publicationDocument(map) {
  const village = map.landmarks.village;
  for (let ring = 15; ring <= 65; ring += 5) for (let a = 0; a < 32; a++) {
    const x = village.x + Math.cos(a * Math.PI / 16) * ring;
    const z = village.z + Math.sin(a * Math.PI / 16) * ring;
    if (Math.abs(x) > 270 || Math.abs(z) > 270 || map.groundAt(x, z) < 1 ||
        map.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3)) continue;
    const document = createDocument({ seed: map.seed, baseRevision: 'terrain-s21-v1', objects: [createDecoration({
      id: 'checker-crate', assetId: 'prop:storage-crate', position: { x, y: map.groundAt(x, z), z }, collider: { type: 'circle', radius: 1 },
    })] });
    if (validateGmPublication({ map, document, baseRevision: 'terrain-s21-v1' }).valid &&
        validateGmRoutes(map, projectGmContent(map, document)).valid) return document;
  }
  throw new Error('No safe checker fixture location');
}

async function makePublication() {
  const map = generateWorld(GAME.seed), baseRevision = 'terrain-s21-v1';
  const validateReferences = createGmDraftValidator({ map, baseRevision,
    manifest: JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8')),
    editorCatalog: JSON.parse(await readFile(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8')) });
  const publication = createGmPublicationService({ root: ROOT, map, baseRevision, worldId: WORLD,
    validateReferences, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
  await publication.prepare();
  const result = await publication.build({ document: publicationDocument(map), draftRevision: 1 });
  assert.ok(result.revision, 'real publication service should produce a ready artifact');
  return result.revision;
}

async function newRegistry(directory, revision = null) {
  const registry = createGmContentRegistry({ directory, root: ROOT, worldId: WORLD, lock: LOCK });
  await registry.prepare();
  if (revision) {
    await registry.retain(revision);
    await registry.withLock(() => registry.switch({ operationId: 'checker-activate-1', expectedGeneration: 0,
      revisionId: revision.revisionId }));
  }
  return registry;
}

function runChecker(directory) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'server/gmContentCheck.mjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, MN_GM_CONTENT_DIR: directory },
  });
  if (result.error) throw result.error;
  return result;
}

test('release checker accepts real current artifact and an active base pointer', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-content-check-'));
  const revision = await makePublication();
  try {
    const active = path.join(temp, 'active');
    await newRegistry(active, revision);
    const accepted = runChecker(active);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /content compatible/);

    const base = path.join(temp, 'base');
    await newRegistry(base);
    const baseAccepted = runChecker(base);
    assert.equal(baseAccepted.status, 0, baseAccepted.stderr);
    assert.match(baseAccepted.stdout, /content compatible/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('release checker rejects incompatible runtime metadata and corrupted retained bytes without source changes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-content-check-'));
  const sourceFiles = ['server/gmContentCheck.mjs', 'src/editor/publicationArtifact.js', 'assets/models/prop-storage-crate.glb'];
  const originalHashes = new Map(await Promise.all(sourceFiles.map(async (relative) =>
    [relative, sha(await readFile(path.join(ROOT, relative)))])));
  const revision = await makePublication();
  try {
    const incompatible = structuredClone(revision);
    incompatible.content.runtime.protocolVersion = PROTOCOL_VERSION - 1;
    incompatible.revisionId = sha(canonicalJson(incompatible.content));
    const mismatchDir = path.join(temp, 'mismatch');
    await newRegistry(mismatchDir, incompatible);
    const rejected = runChecker(mismatchDir);
    assert.equal(rejected.status, 1, rejected.stdout);
    assert.match(rejected.stderr, /content incompatible or unavailable/);

    const tamperDir = path.join(temp, 'tampered');
    await newRegistry(tamperDir, revision);
    const blob = path.join(tamperDir, 'blobs', revision.content.assets[0].sha256);
    const original = await readFile(blob);
    await writeFile(blob, Buffer.concat([original, Buffer.from('tampered')]));
    const tampered = runChecker(tamperDir);
    assert.equal(tampered.status, 1, tampered.stdout);
    assert.match(tampered.stderr, /content incompatible or unavailable/);

    for (const [relative, expected] of originalHashes) {
      assert.equal(sha(await readFile(path.join(ROOT, relative))), expected, `${relative} remains unchanged`);
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});

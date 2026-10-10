import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGmPublicationAssets } from '../server/gmPublicationAssets.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
function glb(json = {}) {
  json = { asset: { version: '2.0' }, ...json };
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8);
  const chunk = Buffer.alloc(8); chunk.writeUInt32LE(padded.length, 0); chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, padded]);
}

async function fixture(t, { src = 'editor/rock.glb', catalogPriority = false, declaredHash = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gm-pub-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['assets/editor', 'src/core', 'src/data', 'src/sim', 'src/render', 'src/editor', 'src/net', 'server']) await mkdir(path.join(root, dir), { recursive: true });
  const runtime = ['src/editor/document.js', 'src/editor/baseIdentity.js', 'src/editor/publicationValidation.js',
    'src/editor/publicationArtifact.js', 'src/editor/modelFactory.js', 'src/net/protocol.js',
    'server/gmPublication.mjs', 'server/gmPublicationAssets.mjs', 'index.html', 'package.json', 'package-lock.json'];
  for (const rel of runtime) await writeFile(path.join(root, rel), `fixture:${rel}`);
  await writeFile(path.join(root, 'assets/manifest.json'), JSON.stringify({ version: 1, assets: [
    { id: 'model:rock', kind: 'model', src: 'models/rock.glb', fit: 'height', height: 3, scale: 0.8 },
    { id: 'model:unused', kind: 'model', src: 'unused/missing.glb' },
  ] }));
  const catalogEntry = { id: 'model:rock', kind: 'model', src, fit: 'size', size: 4, rotY: 90, yOffset: 0.2, shadow: false, status: 'approved' };
  if (declaredHash) catalogEntry.stats = { sha256: declaredHash };
  await writeFile(path.join(root, 'assets/editor/catalog.json'), JSON.stringify({ version: 1, assets: catalogPriority ? [catalogEntry] : [] }));
  const bytes = glb();
  await mkdir(path.dirname(path.join(root, 'assets', src)), { recursive: true }).catch(() => {});
  if (!src.includes('..')) await writeFile(path.join(root, 'assets', src), bytes);
  return { root, bytes, document: { objects: [{ assetId: 'model:rock' }] } };
}

test('prepares stable runtime fingerprint and resolves only used assets with catalog loader metadata', async (t) => {
  const f = await fixture(t, { catalogPriority: true });
  const assets = createGmPublicationAssets({ root: f.root });
  const first = await assets.prepare();
  const second = await assets.prepare();
  assert.deepEqual(first, second);
  assert.equal(first.sha256, digest(Buffer.from(JSON.stringify(first.files))));
  assert.deepEqual((await assets.resolve(f.document)).map(({ id, src, sha256, bytes, loader, status }) => ({ id, src, sha256, bytes, loader, status })), [{
    id: 'model:rock', src: 'assets/editor/rock.glb', sha256: digest(f.bytes), bytes: f.bytes.length,
    loader: { kind: 'model', fit: 'size', size: 4, height: 0, scale: 1, rotY: 90, yOffset: 0.2, shadow: false,
      toon: { posterize: 0, sat: 1, bright: 1, rim: false, flat: false, comic: true, alphaTest: 0 } }, status: 'approved',
  }]);
  assert.deepEqual(await assets.resolve({ objects: [
    { assetId: 'base:rock:1:abcdef01' }, { assetId: 'model:rock' },
  ] }), await assets.resolve(f.document));
  await assert.rejects(assets.resolve({ objects: [{ assetId: 'base:invalid' }] }), { code: 'asset_reference' });
  await assert.rejects(assets.resolve({ objects: [{ assetId: null }] }), { code: 'asset_reference' });
});

test('uses actual bytes and rejects a declared digest mismatch', async (t) => {
  const bytes = glb({ extras: { changed: true } });
  const f = await fixture(t, { catalogPriority: true });
  const manifest = JSON.parse(await readFile(path.join(f.root, 'assets/manifest.json'), 'utf8'));
  const catalog = { version: 1, assets: [{ id: 'model:rock', kind: 'model', src: 'editor/rock.glb', stats: { sha256: digest(f.bytes) } }] };
  await writeFile(path.join(f.root, 'assets/editor/catalog.json'), JSON.stringify(catalog));
  await writeFile(path.join(f.root, 'assets/editor/rock.glb'), bytes);
  const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
  await assert.rejects(assets.resolve(f.document), { code: 'asset_hash' });
  assert.equal(manifest.assets.length, 2);
});

test('hashes the resolved file bytes instead of trusting stale index byte counts', async (t) => {
  const f = await fixture(t, { catalogPriority: true });
  const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
  const changed = glb({ extras: { changed: true } });
  await writeFile(path.join(f.root, 'assets/editor/rock.glb'), changed);
  const [asset] = await assets.resolve(f.document);
  assert.equal(asset.sha256, digest(changed));
  assert.equal(asset.bytes, changed.length);
});

test('rejects external glTF buffer and image URIs', async (t) => {
  for (const json of [{ buffers: [{ uri: 'mesh.bin', byteLength: 4 }] }, { images: [{ uri: 'https://example.test/a.png' }] }]) {
    const f = await fixture(t, { catalogPriority: true });
    await writeFile(path.join(f.root, 'assets/editor/rock.glb'), glb(json));
    const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
    await assert.rejects(assets.resolve(f.document), { code: 'asset_format' });
  }
});

test('rejects traversal asset paths', async (t) => {
  const f = await fixture(t, { src: '../outside.glb', catalogPriority: true });
  const assets = createGmPublicationAssets({ root: f.root });
  await assert.rejects(assets.prepare(), { code: 'asset_reference' });
});

test('rechecks bytes at resolution and ignores missing unused assets', async (t) => {
  const f = await fixture(t, { catalogPriority: true });
  const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
  await writeFile(path.join(f.root, 'assets/editor/rock.glb'), glb({ images: [{ uri: 'external.png' }] }));
  await assert.rejects(assets.resolve(f.document), { code: 'asset_format' });
  assert.deepEqual(await assets.resolve({ objects: [], baseOverrides: [] }), []);
});

test('resolveBaseline hashes every normalized manifest model and texture variant', async (t) => {
  const f = await fixture(t);
  const model = glb();
  const baseTexture = Buffer.from('base-texture-bytes');
  const mobileTexture = Buffer.from('mobile-texture-bytes');
  await mkdir(path.join(f.root, 'assets/models'), { recursive: true });
  await mkdir(path.join(f.root, 'assets/textures'), { recursive: true });
  await writeFile(path.join(f.root, 'assets/models/rock.glb'), model);
  await writeFile(path.join(f.root, 'assets/textures/base.png'), baseTexture);
  await writeFile(path.join(f.root, 'assets/textures/mobile.webp'), mobileTexture);
  await writeFile(path.join(f.root, 'assets/manifest.json'), JSON.stringify({ version: 1, assets: [
    { id: 'model:rock', kind: 'model', src: 'models/rock.glb', size: 3 },
    { id: 'tex:closure', kind: 'tex', src: 'textures/base.png', mobileSrc: 'textures/mobile.webp' },
  ] }));
  const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
  assert.deepEqual(await assets.resolveBaseline(), [
    { id: 'model:rock', variant: 'default', src: 'assets/models/rock.glb', sha256: digest(model), bytes: model.length },
    { id: 'tex:closure', variant: 'default', src: 'assets/textures/base.png', sha256: digest(baseTexture), bytes: baseTexture.length },
    { id: 'tex:closure', variant: 'mobile', src: 'assets/textures/mobile.webp', sha256: digest(mobileTexture), bytes: mobileTexture.length },
  ]);
});

test('resolveBaseline fails closed when an unused manifest source is missing', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'assets/models'), { recursive: true });
  await writeFile(path.join(f.root, 'assets/models/rock.glb'), f.bytes);
  const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
  await assert.rejects(assets.resolveBaseline(), { code: 'asset_unavailable' });
  assert.equal((await assets.resolve(f.document)).length, 1);
});

test('resolve rejects an assets directory junction that escapes the assets root', async (t) => {
  const f = await fixture(t, { src: 'linked/escape.glb', catalogPriority: true });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'gm-pub-junction-'));
  await writeFile(path.join(outside, 'escape.glb'), glb());
  try {
    await rm(path.join(f.root, 'assets/linked'), { recursive: true, force: true });
    try { await symlink(outside, path.join(f.root, 'assets/linked'), 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip('directory junction creation unavailable'); throw error; }
    const assets = createGmPublicationAssets({ root: f.root }); await assets.prepare();
    await assert.rejects(assets.resolve(f.document), { code: 'asset_reference' });
  } finally { await rm(outside, { recursive: true, force: true }); }
});

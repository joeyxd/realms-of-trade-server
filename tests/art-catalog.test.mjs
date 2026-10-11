import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCatalogServer } from '../tools/art-catalog/server.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function fixture(t, rowId = 'madera-pintada') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'art-catalog-'));
  const catalogDir = path.join(root, 'tools', 'art-catalog');
  await mkdir(catalogDir, { recursive: true });
  await mkdir(path.join(root, 'assets', 'textures'), { recursive: true });
  await mkdir(path.join(root, 'shots', 'review'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'delivery'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(catalogDir, 'index.html'), '<h1>Catálogo local</h1>');
  await writeFile(path.join(root, '.env'), 'private=secret');
  await writeFile(path.join(root, 'src', 'hidden.png'), PNG);
  await writeFile(path.join(root, 'assets', 'textures', 'atlas.png'), PNG);
  await writeFile(path.join(root, 'assets', 'textures', 'unlisted.png'), PNG);
  await writeFile(path.join(root, 'shots', 'review', 'capture.png'), PNG);
  await writeFile(path.join(root, 'docs', 'delivery', 'result.md'), '# Resultado');
  await writeFile(path.join(root, 'PLAN-VISUAL-PORT.md'), '# Plan');
  const catalog = {
    version: 1, revision: 7, updatedAt: '2026-10-06T00:00:00.000Z',
    rows: [{ id: rowId, name: 'Madera', state: 'reference', notes: '', nextStep: '',
      references: [{ label: 'Plan', path: 'PLAN-VISUAL-PORT.md', role: 'reference' }],
      files: [{ label: 'Atlas', path: 'assets/textures/atlas.png', role: 'albedo' }],
      evidence: [{ label: 'Resultado', path: 'docs/delivery/result.md' }, { label: 'Captura', path: 'shots/review/capture.png' }] }],
  };
  await writeFile(path.join(catalogDir, 'catalog.json'), JSON.stringify(catalog, null, 2));
  const server = createCatalogServer({ repoRoot: root, catalogDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const request = (url, options = {}) => fetch(`${base}${url}`, { ...options, headers: { Host: `127.0.0.1:${port}`, ...options.headers } });
  return { root, catalogDir, port, request };
}

test('serves UI, registered atlas, shot, docs and plan while keeping source and unlisted files private', async (t) => {
  const { request, root } = await fixture(t);
  assert.match(await (await request('/')).text(), /Catálogo local/);
  for (const file of ['assets/textures/atlas.png', 'shots/review/capture.png', 'docs/delivery/result.md', 'PLAN-VISUAL-PORT.md']) {
    const response = await request(`/files/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), file.endsWith('.md') ? /text\/plain; charset=utf-8/ : /image\/png/);
  }
  assert.equal((await request('/files/assets/textures/unlisted.png')).status, 404);
  assert.equal((await request('/files/src/hidden.png')).status, 404);
  assert.equal((await request('/.env')).status, 404);
});

test('PATCH uses catalog-wide CAS, persists supported states and returns the UI contract', async (t) => {
  const { request, catalogDir } = await fixture(t);
  for (const [revision, state] of [[7, 'prepared'], [8, 'reference']]) {
    const response = await request('/api/rows/madera-pintada', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, state, notes: 'revisado', nextStep: 'continuar' }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.catalog.revision, revision + 1);
    assert.equal(result.row.state, state);
    assert.ok(Number.isFinite(Date.parse(result.catalog.updatedAt)));
  }
  const conflict = await request('/api/rows/madera-pintada', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 7, state: 'applied' }) });
  assert.equal(conflict.status, 409);
  const nullBody = await request('/api/rows/madera-pintada', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'null' });
  assert.equal(nullBody.status, 400);
  const arrayBody = await request('/api/rows/madera-pintada', { method: 'PATCH', body: '[]' });
  assert.equal(arrayBody.status, 400);
  const malformed = await request('/api/rows/madera-pintada', { method: 'PATCH', body: '{' });
  assert.equal(malformed.status, 400);
  const unknown = await request('/api/rows/unknown', { method: 'PATCH', body: JSON.stringify({ revision: 9, state: 'prepared' }) });
  assert.equal(unknown.status, 404);
  const invalidState = await request('/api/rows/madera-pintada', { method: 'PATCH', body: JSON.stringify({ revision: 9, state: 'accepted' }) });
  assert.equal(invalidState.status, 400);
  const saved = JSON.parse(await readFile(path.join(catalogDir, 'catalog.json'), 'utf8'));
  assert.equal(saved.revision, 9);
  assert.equal(saved.rows[0].notes, 'revisado');
});

test('uploads Unicode names with exact bytes and advances global revision', async (t) => {
  const { request, root } = await fixture(t);
  const upload = await request('/api/rows/madera-pintada/files?role=reference&name=referencia%20%C3%A1rbol.png&revision=7', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: PNG });
  assert.equal(upload.status, 201);
  const result = await upload.json();
  assert.equal(result.catalog.revision, 8);
  assert.equal(result.file.name, 'referencia árbol.png');
  assert.deepEqual(await readFile(path.join(root, result.file.path)), PNG);
  const served = await request(`/files/${result.file.path}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-disposition'), /filename\*=UTF-8''/);
});

test('validates upload role, extension, traversal, row id, GLB signature, CAS and size', async (t) => {
  const { request, port, catalogDir } = await fixture(t);
  const badTraversal = await request('/api/rows/madera-pintada/files?role=reference&name=..%2Fevil.png&revision=7', { method: 'POST', body: PNG });
  assert.equal(badTraversal.status, 400);
  const wrongRoleExtension = await request('/api/rows/madera-pintada/files?role=reference&name=doc.md&revision=7', { method: 'POST', body: '# nope' });
  assert.equal(wrongRoleExtension.status, 400);
  const badGlb = await request('/api/rows/madera-pintada/files?role=source&name=broken.glb&revision=7', { method: 'POST', body: 'not glb' });
  assert.equal(badGlb.status, 400);
  const stale = await request('/api/rows/madera-pintada/files?role=source&name=readme.md&revision=6', { method: 'POST', body: '# hi' });
  assert.equal(stale.status, 409);
  const unsafe = await fixture(t, '../escape');
  const unsafeUpload = await unsafe.request('/api/rows/..%2Fescape/files?role=reference&name=photo.png&revision=7', { method: 'POST', body: PNG });
  assert.equal(unsafeUpload.status, 400);
  const oversize = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/rows/madera-pintada/files?role=source&name=large.zip&revision=7', method: 'POST', headers: { Host: `127.0.0.1:${port}`, 'Content-Length': String(128 * 1024 * 1024 + 1) } }, resolve);
    req.on('error', reject);
    req.end();
  });
  assert.equal(oversize.statusCode, 413);
  oversize.resume();
  const unchanged = JSON.parse(await readFile(path.join(catalogDir, 'catalog.json'), 'utf8'));
  assert.equal(unchanged.revision, 7);
});

test('allows Markdown evidence to satisfy applied-state evidence gate', async (t) => {
  const { request, catalogDir } = await fixture(t);
  const catalogFile = path.join(catalogDir, 'catalog.json');
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
  catalog.rows[0].evidence = [];
  await writeFile(catalogFile, JSON.stringify(catalog));
  const withoutEvidence = await request('/api/rows/madera-pintada', { method: 'PATCH', body: JSON.stringify({ revision: 7, state: 'applied' }) });
  assert.equal(withoutEvidence.status, 400);
  const upload = await request('/api/rows/madera-pintada/files?role=evidence&name=validaci%C3%B3n.md&revision=7', { method: 'POST', body: '# Validado' });
  assert.equal(upload.status, 201);
  const result = await upload.json();
  const apply = await request('/api/rows/madera-pintada', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 8, state: 'applied' }) });
  assert.equal(apply.status, 200);
  assert.equal((await apply.json()).catalog.rows[0].state, 'applied');
});

test('empty prepared states fail and concurrent saves preserve exactly one revision', async (t) => {
  const { request, catalogDir } = await fixture(t);
  const catalogFile = path.join(catalogDir, 'catalog.json');
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
  catalog.rows[0].files = [];
  await writeFile(catalogFile, JSON.stringify(catalog));
  const emptyPrepared = await request('/api/rows/madera-pintada', { method: 'PATCH', body: JSON.stringify({ revision: 7, state: 'prepared' }) });
  assert.equal(emptyPrepared.status, 400);
  const results = await Promise.all(['one', 'two'].map((notes) => request('/api/rows/madera-pintada', { method: 'PATCH', body: JSON.stringify({ revision: 7, notes }) })));
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const saved = JSON.parse(await readFile(catalogFile, 'utf8'));
  assert.equal(saved.revision, 8);
  assert.ok(['one', 'two'].includes(saved.rows[0].notes));
});

test('rejects foreign origins and arbitrary Host headers', async (t) => {
  const { request, port } = await fixture(t);
  const foreign = await request('/api/rows/madera-pintada', { method: 'PATCH', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 7, state: 'prepared' }) });
  assert.equal(foreign.status, 403);
  const badHost = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/catalog', headers: { Host: 'evil.example' } }, resolve);
    req.on('error', reject);
    req.end();
  });
  assert.equal(badHost.statusCode, 403);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (...parts) => JSON.parse(await readFile(path.join(ROOT, ...parts), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SERVER_ID = /^(?:model|prop):[A-Za-z0-9][A-Za-z0-9._:-]{0,156}$/;
const PILOTS = ['aw-pilot-01', 'aw-pilot-05', 'aw-pilot-06', 'aw-pilot-07'];

test('published.json follows marea.asset-published.v1 with exactly the four pilots', async () => {
  const published = await readJson('assets', 'workshop', 'published.json');
  assert.equal(published.schema, 'marea.asset-published.v1');
  assert.equal(published.revision, 1);
  assert.deepEqual(published.entries.map((entry) => entry.id), PILOTS);
  for (const entry of published.entries) {
    assert.equal(entry.editorId, `model:${entry.id}`);
    assert.equal(entry.decision, 'Usar');
    assert.equal(entry.status, 'ready');
    assert.match(entry.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.sourceRevision, /^[a-f0-9]{64}$/);
    assert.ok(typeof entry.label.es === 'string' && entry.label.es && typeof entry.label.en === 'string' && entry.label.en);
    assert.ok(typeof entry.category === 'string' && entry.category);
    assert.ok(['size', 'height'].includes(entry.fit));
    assert.ok(entry[entry.fit] > 0, `${entry.id}: ${entry.fit} in metres`);
  }
});

test('every editor id is accepted by the server id rule', async () => {
  const published = await readJson('assets', 'workshop', 'published.json');
  for (const entry of published.entries) assert.match(entry.editorId, SERVER_ID);
});

test('every published entry has a prepared model whose desktop GLB hash matches the catalog stats', async () => {
  const published = await readJson('assets', 'workshop', 'published.json');
  const prepared = await readJson('assets', 'workshop', 'prepared.json');
  const catalog = await readJson('assets', 'editor', 'catalog.json');
  for (const entry of published.entries) {
    const prep = prepared.entries.find((item) => item.id === entry.id);
    assert.ok(prep, `${entry.id} in prepared.json`);
    assert.equal(prep.sourceRevision, entry.sourceRevision);
    assert.equal(prep.preview.kind, 'model');
    const bytes = await readFile(path.join(ROOT, 'assets', 'workshop', entry.id, 'desktop.glb'));
    assert.equal(hash(bytes), prep.preview.desktop.sha256);
    const item = catalog.assets.find((asset) => asset.id === entry.editorId);
    assert.ok(item, `${entry.editorId} in editor catalog`);
    assert.equal(item.stats.sha256, hash(bytes));
    assert.equal(item.stats.bytes, bytes.length);
  }
});

test('the editor catalog holds exactly the published ids among its workshop entries', async () => {
  const published = await readJson('assets', 'workshop', 'published.json');
  const catalog = await readJson('assets', 'editor', 'catalog.json');
  const workshop = catalog.assets.filter((asset) => asset.workshop);
  assert.deepEqual(workshop.map((asset) => asset.id), published.entries.map((entry) => entry.editorId));
  for (const entry of published.entries) {
    const item = workshop.find((asset) => asset.id === entry.editorId);
    assert.equal(item.kind, 'model');
    assert.equal(item.status, 'ready');
    assert.equal(item.src, `workshop/${entry.id}/desktop.glb`);
    assert.equal(item.fit, entry.fit);
    assert.equal(item[entry.fit], entry[entry.fit]);
    assert.deepEqual(item.label, entry.label);
    assert.equal(item.category, entry.category);
    assert.deepEqual(item.workshop, { id: entry.id, sourceRevision: entry.sourceRevision, publishedAt: entry.publishedAt });
    if (item.mobileSrc) assert.ok(existsSync(path.join(ROOT, 'assets', item.mobileSrc)));
  }
});

test('the editor thumbnails carry an existing image for each published id and no stale workshop keys', async () => {
  const published = await readJson('assets', 'workshop', 'published.json');
  const thumbnails = await readJson('assets', 'editor', 'thumbnails.json');
  for (const entry of published.entries) {
    const row = thumbnails.assets[entry.editorId];
    assert.ok(row, `${entry.editorId} thumbnail row`);
    assert.equal(row.thumbnail, `assets/workshop/thumbnails/${entry.id}.webp`);
    assert.ok(existsSync(path.join(ROOT, row.thumbnail)));
  }
  const owned = Object.entries(thumbnails.assets).filter(([, row]) => row.thumbnail?.startsWith('assets/workshop/thumbnails/'));
  assert.deepEqual(owned.map(([key]) => key), published.entries.map((entry) => entry.editorId));
});

test('publish-editor check mode: both editor files already equal the tool output', async () => {
  const { buildPublication } = await import(pathToFileURL(path.join(ROOT, 'tools', 'asset-workshop', 'publish-editor.mjs')).href);
  const result = buildPublication(ROOT);
  assert.equal(result.entries.length, 4);
  assert.equal(result.catalogText, result.currentCatalogText);
  assert.equal(result.thumbnailsText, result.currentThumbsText);
});

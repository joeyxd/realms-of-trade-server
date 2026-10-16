import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCompanionDocuments, COMPANION_LOOKS, DEFAULT_COMPANION_DRAFT, PERSONALITY_TEMPLATES,
  randomizeCompanionDraft, ROLE_TEMPLATES, TRAIT_TEMPLATES, validateCompanionDraft } from '../src/net/companionTemplates.js';
import { createCompanionFiles } from '../tools/agent/create-companion.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';

const scope = { ownerId: 'owner-test', characterId: 'brisa-test', worldId: 'world-test' };

test('five roles, preset keys and looks use existing player skin indexes', () => {
  assert.deepEqual(Object.keys(ROLE_TEMPLATES), ['sailor', 'marine', 'builder', 'harvester', 'resident']);
  assert.deepEqual(Object.keys(PERSONALITY_TEMPLATES), ['warm', 'calm', 'curious', 'direct', 'playful']);
  assert.ok(Object.keys(TRAIT_TEMPLATES).length >= 5);
  assert.deepEqual(COMPANION_LOOKS.map(({ name, skin }) => [name, skin]), [
    ['Corsario', 0], ['Exploradora', 1], ['Bucanero', 2], ['Tormenta', 3], ['Brasa', 4],
  ]);
});

test('draft validation is exact, sanitized, and restricted to local model endpoints', () => {
  assert.deepEqual(validateCompanionDraft(DEFAULT_COMPANION_DRAFT), DEFAULT_COMPANION_DRAFT);
  for (const changed of [
    { ...DEFAULT_COMPANION_DRAFT, extra: true },
    { ...DEFAULT_COMPANION_DRAFT, name: 'Brisa\nadmin' },
    { ...DEFAULT_COMPANION_DRAFT, name: '12345678901234567' },
    { ...DEFAULT_COMPANION_DRAFT, name: ' Brisa' },
    { ...DEFAULT_COMPANION_DRAFT, name: '<Brisa>' },
    { ...DEFAULT_COMPANION_DRAFT, name: 'sk-12345678901234567890' },
    { ...DEFAULT_COMPANION_DRAFT, baseUrl: 'http://localhost:8080/v1' },
    { ...DEFAULT_COMPANION_DRAFT, baseUrl: 'https://127.0.0.1:8080/v1' },
    { ...DEFAULT_COMPANION_DRAFT, baseUrl: 'http://127.0.0.1:8080/v1?key=secret' },
    { ...DEFAULT_COMPANION_DRAFT, traits: ['curious', 'curious'] },
    { ...DEFAULT_COMPANION_DRAFT, traits: ['curious', 'prudent', 'kind', 'patient'] },
  ]) assert.throws(() => validateCompanionDraft(changed), { name: 'TypeError', message: 'invalid_companion_draft' });
});

test('seeded random drafts are deterministic and choose only table values', () => {
  const first = randomizeCompanionDraft({ seed: 'island-42' });
  assert.deepEqual(randomizeCompanionDraft({ seed: 'island-42' }), first);
  assert.equal(validateCompanionDraft(first).role, first.role);
  assert.ok(Object.hasOwn(ROLE_TEMPLATES, first.role));
  assert.ok(Object.hasOwn(PERSONALITY_TEMPLATES, first.personality));
  assert.ok(COMPANION_LOOKS.some((look) => look.skin === first.skin));
  assert.ok(first.traits.every((trait) => Object.hasOwn(TRAIT_TEMPLATES, trait)));
});

test('role documents stay within owner-file schemas and start with empty memory', () => {
  for (const role of Object.keys(ROLE_TEMPLATES)) {
    const docs = buildCompanionDocuments({ ...DEFAULT_COMPANION_DRAFT, role }, scope);
    assert.ok(new TextEncoder().encode(docs.personality).length <= 8192);
    assert.match(docs.personality, /servidor/);
    assert.match(docs.personality, /no.*construir|no.*recolectar|no.*navegar/i);
    assert.equal(docs.memory, '');
    const objectives = JSON.parse(docs.objectives);
    assert.deepEqual(Object.keys(objectives), ['v', 'revision', 'scope', 'goals']);
    assert.equal(objectives.revision, 1);
    assert.deepEqual(objectives.scope, scope);
    assert.equal(objectives.goals.length, 1);
    assert.ok(objectives.goals[0].text.length <= 300);
    assert.ok(objectives.goals[0].constraints.length <= 8);
    const manifest = JSON.parse(docs.manifest);
    assert.equal(manifest.serverBinding, null);
    assert.deepEqual(manifest.capabilities, []);
    assert.equal(manifest.activated, false);
    assert.equal(manifest.provider.apiKey, null);
    assert.match(docs.guide, /texto no confiable/);
  }
});

test('creator writes new directory, validates loader files, and refuses overwrite', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mn-companion-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'brisa');
  const created = await createCompanionFiles({ directory, draft: DEFAULT_COMPANION_DRAFT, scope });
  assert.equal(created.manifest.schema, 'mn.local-companion.v1');
  assert.deepEqual(Object.keys(created.paths).sort(), ['guide', 'manifest', 'memory', 'objectives', 'personality']);
  const loaded = await loadOwnerFiles({ directory, scope });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.files.memory.content, '');
  assert.match(await readFile(created.paths.guide, 'utf8'), /Manual de juego/);
  await assert.rejects(createCompanionFiles({ directory, draft: DEFAULT_COMPANION_DRAFT, scope }), { code: 'EEXIST' });
  assert.equal((await loadOwnerFiles({ directory, scope })).ok, true);
});

test('creator rejects an invalid scope before creating a directory', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mn-companion-partial-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'invalid');
  const invalidScope = { ...scope, ownerId: 'bad owner' };
  await assert.rejects(createCompanionFiles({ directory, draft: DEFAULT_COMPANION_DRAFT, scope: invalidScope }), { message: 'invalid_scope' });
  await assert.rejects(readFile(path.join(directory, 'personality.md')));
});

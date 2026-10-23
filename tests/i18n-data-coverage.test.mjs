// Every player-visible string from src/data/*.js needs an English rendering in
// src/i18n/data.js, or an explicit allow-list entry with a one-word reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { DATA_ES_EN } from '../src/i18n/data.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

// Fields whose string values the client shows to the player.
export const DISPLAY_FIELDS = new Set(['name', 'label', 'title', 'text', 'desc', 'description', 'sub', 'hint', 'role']);

// Strings shown verbatim in both languages. Reason is one word: name, brand, notDisplayed, id.
export const ALLOW = new Map([
  ['HELLFIRE', 'name'], ['MAREA NEGRA', 'brand'],
  ['Don Bacalao', 'name'], ['La Tuerta', 'name'], ['Capitana Brea', 'name'], ['Tía Perla', 'name'], ['Doña Sepia', 'name'],
]);

// Collect [path, string] pairs of display-field strings in any value tree.
export function scanDisplayStrings(value, trail = '', out = [], seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const here = trail ? `${trail}.${key}` : key;
    if (typeof child === 'string') {
      if (DISPLAY_FIELDS.has(key) && /\p{L}/u.test(child)) out.push([here, child]);
    } else scanDisplayStrings(child, here, out, seen);
  }
  return out;
}

export const uncovered = (pairs) => pairs.filter(([, s]) => !(s in DATA_ES_EN) && !ALLOW.has(s));

test('scan flags a synthetic uncovered Spanish display string', () => {
  const fake = { item: { name: 'Cuchillo inventado sin traducir', id: 'x', desc: 'Resina' } };
  const missing = uncovered(scanDisplayStrings(fake));
  assert.deepEqual(missing, [['item.name', 'Cuchillo inventado sin traducir']]);
});

test('every display string in src/data has an English entry or an allow-list reason', async () => {
  const missing = [];
  for (const file of readdirSync(dataDir).filter(f => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(dataDir, file)).href);
    for (const [name, exported] of Object.entries(mod)) {
      for (const [p, s] of uncovered(scanDisplayStrings(exported))) missing.push(`${file} ${name}.${p}: ${s}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('allow-list entries carry a known one-word reason', () => {
  for (const [s, reason] of ALLOW) assert.match(reason, /^(name|brand|notDisplayed|id)$/, s);
});

test('EDITOR_REASONS in src/data/raftEditor.js is not displayed by client code', async () => {
  // The raft editor UI uses its own catalog keys (systems.raft.reason.*); if client code starts
  // showing EDITOR_REASONS text, those lines need data.js entries and this test must be revisited.
  const { readFileSync, readdirSync: ls, statSync } = await import('node:fs');
  const root = path.join(dataDir, '..');
  const files = [];
  const walk = (dir) => { for (const n of ls(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f); } };
  for (const sub of ['ui', 'editor']) { try { walk(path.join(root, sub)); } catch {} }
  files.push(path.join(root, 'main.js'));
  const users = files.filter((f) => readFileSync(f, 'utf8').includes('EDITOR_REASONS'));
  assert.deepEqual(users, []);
});

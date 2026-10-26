import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlayerCharactersError } from '../src/client/playerCharacters.js';
import { PlayerCharactersPanel } from '../src/ui/playerCharacters.js';
import { getLocale, setLocale } from '../src/core/locale.js';
import { t } from '../src/core/i18n.js';
import entry from '../src/i18n/entry.js';

class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.hidden = false; this.disabled = false; this.textContent = '';
    this.dataset = {}; this.attrs = {}; this.listeners = {}; this.style = { setProperty() {} }; this.isConnected = true;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  querySelectorAll() { return []; }
  getClientRects() { return [1]; }
  focus() {}
  remove() { this.isConnected = false; }
}

function withDocument(fn) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new El(tag), activeElement: null };
  return Promise.resolve(fn()).finally(() => { globalThis.document = previous; });
}

const SPANISH = 'No se pudo cargar la lista guardada.';
const makePanel = (extra = {}) => new PlayerCharactersPanel({
  parent: new El('body'), looks: [{ id: 0, name: 'a', label: 'A' }], ...extra,
});

test('every player-facing PlayerCharactersError in the client carries a bilingual l10nKey', () => {
  const source = readFileSync(new URL('../src/client/playerCharacters.js', import.meta.url), 'utf8');
  const sites = source.split('throw new PlayerCharactersError(').slice(1).map(chunk => chunk.slice(0, chunk.indexOf(');')));
  assert.ok(sites.length >= 40, `expected the throw sites to be scanned, got ${sites.length}`);
  const used = new Set();
  for (const site of sites) {
    const keys = [...site.matchAll(/'(roster\.err\.[A-Za-z]+)'/g)].map(m => m[1]);
    assert.ok(keys.length >= 1, `throw site without l10nKey: ${site}`);
    keys.forEach(key => used.add(key));
  }
  for (const key of used) {
    const pair = entry[key];
    assert.ok(Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1], `catalog entry missing or incomplete: ${key}`);
    assert.notEqual(pair[0], pair[1], `ES and EN identical for ${key}`);
  }
  assert.equal(new PlayerCharactersError('x', 'msg').l10nKey, 'roster.err.generic');
});

test('roster UI shows the English text for a Spanish error message and re-renders on locale change', async () => {
  const original = getLocale();
  try {
    setLocale('en');
    await withDocument(async () => {
      const panel = makePanel({ onContinue: async () => { throw new PlayerCharactersError('unavailable', SPANISH, 'roster.err.loadFailed'); } });
      panel.setRoster({ mode: 'account', characters: [{ id: 'c1', slot: 0, name: 'Ana', skin: 0, weapon: 0, lastPlayed: false }] });
      panel.open({ mode: 'account', characters: [{ id: 'c1', slot: 0, name: 'Ana', skin: 0, weapon: 0, lastPlayed: false }] });
      await panel.continueSelected();
      assert.equal(panel.status.textContent, t('roster.err.loadFailed'));
      assert.equal(panel.status.textContent, entry['roster.err.loadFailed'][1]);
      assert.notEqual(panel.status.textContent, SPANISH);
      setLocale('es');
      assert.equal(panel.status.textContent, entry['roster.err.loadFailed'][0]);
      setLocale('en');
      assert.equal(panel.status.textContent, entry['roster.err.loadFailed'][1]);
      panel.destroy();
    });
  } finally { setLocale(original); }
});

test('errors without a key fall back to the bilingual copy table, never the raw message', async () => {
  const original = getLocale();
  try {
    setLocale('en');
    await withDocument(async () => {
      const panel = makePanel({ onContinue: async () => { throw new Error('Fallo externo en español'); } });
      panel.setRoster({ mode: 'account', characters: [{ id: 'c1', slot: 0, name: 'Ana', skin: 0, weapon: 0, lastPlayed: false }] });
      await panel.continueSelected();
      assert.equal(panel.status.textContent, 'Characters could not be loaded. Your save is still intact.');
      setLocale('es');
      assert.match(panel.status.textContent, /No se pudieron cargar/);
      panel.destroy();
    });
  } finally { setLocale(original); }
});

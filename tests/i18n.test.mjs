import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogs, dataCatalog, dataParam, rich, setLocale, t, text, translateData } from '../src/core/i18n.js';
import { BASES, STATS } from '../src/data/items.js';
import { itemName } from '../src/sim/items.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { chooseLocale, getLocale, LOCALE_KEY } from '../src/core/locale.js';
import { GOOD_CATS, GOOD_IDS, GOODS } from '../src/data/goods.js';
import { TOWN_IDS, TOWNS } from '../src/data/towns.js';
import { communityRows } from '../src/ui/community.js';
import { navalHudState } from '../src/ui/navalHudState.js';
import { describeMap } from '../src/ui/cartography.js';
import { routePresentation } from '../src/render/naval/route.js';

function withLocale(locale, fn) {
  const previous = getLocale();
  setLocale(locale);
  try { return fn(); } finally { setLocale(previous); }
}

function leaves(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

function placeholders(value) {
  return [...new Set(leaves(value).flatMap((phrase) => [...phrase.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1])))].sort();
}

function filesUnder(roots) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && path.endsWith('.js')) files.push(path);
    }
  };
  for (const root of roots) visit(root);
  return files;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('UI catalogs have complete Spanish/English pairs and matching placeholders', () => {
  assert.ok(Object.keys(catalogs).length > 0);
  for (const [key, pair] of Object.entries(catalogs)) {
    assert.ok(Array.isArray(pair), `${key} is a locale pair`);
    assert.equal(pair.length, 2, `${key} has Spanish and English`);
    for (const [index, phrase] of pair.entries()) assert.ok(leaves(phrase).length && leaves(phrase).every((part) => part.length), `${key}[${index}] is populated`);
    assert.deepEqual(placeholders(pair[0]), placeholders(pair[1]), `${key} placeholders match across locales`);
  }
});

test('each source catalog key is defined only once', () => {
  const duplicates = [];
  for (const file of filesUnder(['src/i18n'])) {
    const seen = new Set();
    const source = withoutComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/['"]([A-Za-z0-9_.]+)['"]\s*:\s*\[/g)) {
      const key = match[1];
      if (seen.has(key)) duplicates.push(`${file}: ${key}`);
      seen.add(key);
    }
  }
  assert.deepEqual(duplicates, [], 'duplicate keys silently replace translations');
});

test('text and rich translations escape untrusted parameters while retaining app markup', () => {
  withLocale('en', () => {
    const params = { name: '<img src=x onerror=alert(1)>' };
    const plain = text('runtime.killed', params);
    assert.match(plain, /data-l10n-key="runtime\.killed"/);
    assert.match(plain, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(plain, /<img/);
    const markup = rich('runtime.killed', params);
    assert.match(markup, /<b class="pk">/);
    assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(markup, /<img/);
  });
});

test('locale selection accepts supported preferences and recovers from bad storage', () => {
  assert.equal(chooseLocale('es', ['en-US']), 'es');
  assert.equal(chooseLocale('en', ['es-MX']), 'en');
  assert.equal(chooseLocale('corrupt', ['es-MX', 'en-US']), 'es');
  assert.equal(chooseLocale(null, ['fr-FR', 'en-GB']), 'en');
  assert.equal(chooseLocale('corrupt', ['fr-FR']), 'es');

  const previous = getLocale();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem(key) { assert.equal(key, LOCALE_KEY); throw new Error('storage blocked'); } } });
    assert.equal(setLocale('en'), true);
    assert.equal(getLocale(), 'en', 'in-memory locale changes when storage is unavailable');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
    setLocale(previous);
  }
});

test('a bootstrap choice survives blocked storage when the module mounts', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { __mnLanguage: 'es' } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    const fresh = await import('../src/core/locale.js?blocked-bootstrap-test');
    assert.equal(fresh.getLocale(), 'es');
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else delete globalThis.window;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete globalThis.localStorage;
  }
});

test('display translation leaves stable good IDs untouched', () => {
  assert.deepEqual(Object.keys(GOODS).sort(), [...GOOD_IDS].sort());
  for (const locale of ['es', 'en']) withLocale(locale, () => {
    for (const id of GOOD_IDS) assert.equal(translateData(id), id, `${locale} keeps the ${id} data ID stable`);
  });
  assert.equal(Object.hasOwn(dataCatalog, 'madera'), false);
});

test('market categories follow the selected language while good and town identities stay stable', () => {
  const expectedEnglish = {
    food: 'Provisions', drink: 'Drink', material: 'Materials', arms: 'Arms', luxury: 'Luxury',
  };
  const expectedSpanish = {
    food: 'Víveres', drink: 'Bebida', material: 'Materiales', arms: 'Armamento', luxury: 'Lujo',
  };
  assert.deepEqual(Object.keys(GOOD_CATS).sort(), Object.keys(expectedEnglish).sort());
  assert.deepEqual(Object.keys(TOWNS), ['aldea', 'cala', 'sol', 'ceniza', 'corona', 'coral']);
  assert.deepEqual([...TOWN_IDS], ['aldea', 'cala', 'sol', 'ceniza', 'corona', 'coral']);

  const authoredTownNames = {
    aldea: 'Aldea de la Marea', cala: 'Cala Calavera', sol: 'Puerto Sol',
    ceniza: 'Bahía Ceniza', corona: 'Fuerte Real', coral: 'Arrecife',
  };
  for (const locale of ['es', 'en']) withLocale(locale, () => {
    const expected = locale === 'en' ? expectedEnglish : expectedSpanish;
    for (const [category, sourceLabel] of Object.entries(GOOD_CATS)) {
      assert.equal(translateData(sourceLabel), expected[category], `${category} market rows use a readable ${locale} label`);
    }
    assert.deepEqual(Object.fromEntries(TOWN_IDS.map((id) => [id, TOWNS[id].name])), authoredTownNames,
      'authored town names and identity fields remain unchanged in both locales');
    assert.deepEqual([...GOOD_IDS], Object.keys(GOODS), 'good IDs and their order remain stable');
  });
});

test('authored data parameters translate again while human parameters stay literal', () => {
  const params = { quest: dataParam('La Prueba de Fuego'), npc: 'Luna <b>' };
  withLocale('en', () => {
    assert.match(t('reward.quest_ready', params), /The Trial by Fire/);
    assert.match(rich('reward.quest_ready', params), /Luna &lt;b&gt;/);
    assert.doesNotMatch(rich('reward.quest_ready', params), /Luna <b>/);
    assert.match(t('adventure.tattoo_art', { weapon: dataParam('Sable', 'lower') }), /cutlass/);
  });
  withLocale('es', () => assert.match(t('reward.quest_ready', params), /La Prueba de Fuego/));
});

test('every generated gear base and affix has a display translation without changing the item', () => {
  withLocale('en', () => {
    for (const [b, base] of Object.entries(BASES)) for (const [stat, value] of Object.entries(STATS)) {
      if (!value.suffix) continue;
      const item = { b, a: [[stat, 2]], u: 1, r: 1, l: 1 }, before = JSON.stringify(item);
      const source = itemName(item);
      assert.equal(translateData(source), `${translateData(base.name)} ${translateData(value.suffix)}`);
      assert.notEqual(translateData(source), source, source);
      assert.equal(JSON.stringify(item), before);
    }
  });
});

test('literal i18n calls in UI, client navigation, and main have catalog entries', () => {
  const files = filesUnder(['src/ui', 'src/editor', 'src/render/naval']);
  files.push('src/main.js', 'src/client/liveNavigationView.js');
  const literalCall = /\b(?:t|text|ltext|rich|attr)\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`([^`$]*)`)(?=\s*[,\)])/g;
  const missing = [];
  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    if (!/from\s*['"][^'"]*core\/i18n\.js['"]/.test(source)) continue;
    for (const match of source.matchAll(literalCall)) {
      const key = match[1] ?? match[2] ?? match[3];
      if (key && !Object.hasOwn(catalogs, key)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `missing catalog entries:\n${missing.join('\n')}`);
});

test('literal static data display strings have an English dictionary entry', () => {
  const files = filesUnder(['src/ui', 'src/client', 'src/editor']); files.push('src/main.js');
  const literalData = /\b(?:dataText|translateData)\s*\(\s*(['"])((?:\\.|[^'\\])*)\1/g;
  const missing = [];
  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(literalData)) if (!Object.hasOwn(dataCatalog, match[2])) missing.push(`${file}: ${match[2]}`);
  }
  assert.deepEqual(missing, [], `static display strings missing from data dictionary:\n${missing.join('\n')}`);
});

test('source contains no invalid $5 i18n placeholder aliases', () => {
  const files = filesUnder(['src/ui', 'src/client', 'src/editor']); files.push('src/main.js');
  const bad = [];
  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    if (/\b(?:setText|setAttributeText)\s*\([^\n]*(['"])\$5\1/.test(source)) bad.push(file);
  }
  assert.deepEqual(bad, [], `invalid static translation aliases remain in: ${bad.join(', ')}`);
});

test('community, naval HUD, and cartography display the selected locale', () => {
  withLocale('es', () => {
    const rows = communityRows({ requirements: { madera: 2 }, contributed: {} }, { eco: { pack: { goods: { madera: 1 } } } });
    assert.equal(rows[0].name, 'Tabla básica');
    assert.equal(navalHudState({ wind: { strength: 0 }, current: { strength: 0 } }).gustText, 'Sin ráfagas');
    assert.equal(describeMap(null).title, 'Mapa del mundo');
    assert.equal(routePresentation({ status: 'outbound', next: 1, hits: 2, dodged: 3, damage: 7 }).stage, 'Boyas 2/3');
    assert.equal(routePresentation({ status: 'complete' }).stage, 'Ensayo completado');
    assert.equal(routePresentation({ hits: 2, dodged: 3, damage: 7 }).score, '2 impactos · 3 esquivados · 7 HP');
  });
  withLocale('en', () => {
    const rows = communityRows({ requirements: { madera: 2 }, contributed: {} }, { eco: { pack: { goods: { madera: 1 } } } });
    assert.equal(rows[0].name, 'Basic plank');
    assert.equal(navalHudState({ wind: { strength: 0 }, current: { strength: 0 } }).gustText, 'No gusts');
    assert.equal(describeMap(null).title, 'World map');
    assert.equal(routePresentation({ status: 'outbound', next: 1, hits: 2, dodged: 3, damage: 7 }).stage, 'Buoys 2/3');
    assert.equal(routePresentation({ status: 'complete' }).stage, 'Trial complete');
    assert.equal(routePresentation({ hits: 2, dodged: 3, damage: 7 }).score, '2 hits · 3 dodged · 7 HP');
  });
});

test('generated village NPC roles translate while authored names and world data stay intact', () => {
  const map = generateWorld(18743);
  const before = JSON.stringify(map.npcs);
  withLocale('es', () => {
    for (const npc of map.npcs) assert.equal(translateData(npc.title), npc.title);
  });
  withLocale('en', () => {
    for (const npc of map.npcs) {
      assert.notEqual(translateData(npc.title), npc.title, `${npc.id} role has an English label`);
      assert.equal(translateData(npc.name), npc.name, `${npc.id} retains its authored name`);
    }
  });
  assert.equal(JSON.stringify(map.npcs), before);
});

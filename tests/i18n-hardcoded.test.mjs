// Regression guard: player-visible text must exist in English and Spanish.
// The scanner lives in tools/i18n/scan-hardcoded.mjs; known offenders are in tools/i18n/baseline.json (a ratchet, it only shrinks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, scanTree, loadBaseline, diffBaseline, buildBaseline } from '../tools/i18n/scan-hardcoded.mjs';
import { catalogs } from '../src/core/i18n.js';

const scan = (source, file = 'src/ui/snippet.js') => scanSource(source, { file });
const kinds = (source, file) => scan(source, file).map((o) => `${o.kind}:${o.text}`);

test('scanner flags a bare Spanish string assigned to textContent', () => {
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla';"), ['es:Cargando la isla']);
});

test('scanner flags a bare Spanish string anywhere outside exempt contexts', () => {
  assert.deepEqual(kinds("const msg = 'Guardado en el cuaderno';"), ['es:Guardado en el cuaderno']);
});

test('scanner flags English prose only where it reaches a visible sink', () => {
  assert.deepEqual(kinds("el.textContent = 'Press the button';"), ['en:Press the button']);
  assert.deepEqual(kinds("toast('Not enough gold to buy this');"), ['en:Not enough gold to buy this']);
  assert.deepEqual(kinds("button.setAttribute('aria-label', 'Close the panel');"), ['en:Close the panel']);
  assert.deepEqual(kinds('box.innerHTML = `<p>Loading the island ${n}</p>`;'), ['en:Loading the island {}']);
  assert.deepEqual(kinds("const q = 'Press the button';"), []);
  assert.deepEqual(kinds("el.setAttribute('class', 'close the panel');"), []);
});

test('scanner reads Spanish inside HTML template literals', () => {
  assert.deepEqual(kinds('box.innerHTML = `<p>Cargando la isla ${n}</p>`;'), ['es:Cargando la isla {}']);
});

test('scanner does not flag catalog and data lookups', () => {
  for (const call of ['t', 'text', 'rich', 'attr', 'setText', 'dataText', 'translateData', 'setDataText']) {
    assert.deepEqual(kinds(`el.textContent = ${call}('Cargando la isla');`), [], call);
  }
  assert.deepEqual(kinds("setAttributeText(el, 'title', 'Cargando la isla');"), []);
  assert.deepEqual(kinds("el.textContent = t('title.loading', { name: 'Cargando la isla' });"), []);
});

test('scanner does not flag values inside an object that has both es and en', () => {
  assert.deepEqual(kinds("const copy = { es: 'Cargando la isla', en: 'Loading the island' };"), []);
  assert.deepEqual(kinds("const copy = { es: { title: 'Cargando la isla' }, en: { title: 'Loading the island' } };"), []);
  assert.deepEqual(kinds("const copy = { id: 'a', en: 'Loading the island', es: 'Cargando la isla' };"), []);
  assert.deepEqual(kinds("const pair = ['Loading the island', 'Cargando la isla'];"), []);
});

test('scanner does not flag a ternary on the locale that has both branches', () => {
  assert.deepEqual(kinds("el.textContent = locale === 'en' ? 'Loading the island' : 'Cargando la isla';"), []);
  assert.deepEqual(kinds("el.title = getLocale() === 'en' ? 'Close the panel' : 'Cerrar el panel';"), []);
  assert.deepEqual(kinds("el.title = english ? 'Close the panel' : 'Cerrar el panel';"), []);
});

test('scanner does not flag comments, console calls, logger calls, selectors and comparisons', () => {
  assert.deepEqual(kinds('// Cargando la isla\n/* Cargando la isla */\nconst a = 1;'), []);
  assert.deepEqual(kinds("console.log('Cargando la isla');"), []);
  assert.deepEqual(kinds("console.warn(`No se pudo cargar la isla ${x}`);"), []);
  assert.deepEqual(kinds("logger.info('Cargando la isla');"), []);
  assert.deepEqual(kinds("document.querySelector('.cargando la isla');"), []);
  assert.deepEqual(kinds("if (kind === 'Cargando la isla') run();"), []);
  assert.deepEqual(kinds("import x from './cargando la isla.js';"), []);
});

test('scanner honours the inline i18n-ok marker on the same line only', () => {
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla'; // i18n-ok: debug overlay, never shipped to players"), []);
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla';\nel.title = 'Cerrar la ventana'; // i18n-ok: reason"), ['es:Cargando la isla']);
  assert.deepEqual(kinds('<p>Cargando la isla</p> <!-- i18n-ok: static fallback -->', 'index.html'), []);
});

test('scanner reports html text nodes and attributes but not data-l10n elements', () => {
  const html = '<p>Cargando la isla</p>\n<p data-l10n-key="a">Cargando la isla</p>\n<button aria-label="Cerrar la ventana">x</button>\n<img alt="Loading the island">\n<button data-l10n-aria-label="b" aria-label="Cerrar la ventana">x</button>';
  assert.deepEqual(kinds(html, 'index.html'), ['es:Cargando la isla', 'es:Cerrar la ventana', 'en:Loading the island']);
});

test('scanner flags an es/en copy table whose key sets differ', () => {
  assert.deepEqual(kinds("const C = { es: { a: 'x', b: 'y' }, en: { a: 'x', c: 'z' } };"), ['parity:C: en lacks "b"', 'parity:C: es lacks "c"']);
  assert.deepEqual(kinds("const C = { es: { a: 'x', n: { p: 1, q: 2 } }, en: { a: 'x', n: { p: 1 } } };"), ['parity:C: en lacks "n.q"']);
  assert.deepEqual(kinds("const C = { es: { a: 'x', b: 'y' }, en: { a: 'x', b: 'z' } };"), []);
});

test('visible sinks win over the pair and catalog-key exemptions', () => {
  assert.deepEqual(kinds("el.setAttribute('aria-label', 'Cerrar la ventana');"), ['es:Cerrar la ventana']);
  assert.deepEqual(kinds("el.setAttribute('title', 'Abrir el mapa del tesoro');"), ['es:Abrir el mapa del tesoro']);
  assert.deepEqual(kinds("el.setAttribute('placeholder', 'Escribe tu nombre');"), ['es:Escribe tu nombre']);
  assert.deepEqual(kinds("toast('No tienes madera', 'warn');"), ['es:No tienes madera']);
  assert.deepEqual(kinds("toast('No tienes madera', 'inventory.noWood');"), ['es:No tienes madera']);
});

test('a two-string call is only a bilingual pair when one is Spanish and the other is English prose', () => {
  assert.deepEqual(kinds("f('Close the panel', 'Cerrar el panel');"), []);
  assert.deepEqual(kinds("f('Cerrar el panel', 'Close the panel');"), []);
  assert.deepEqual(kinds("f('Cerrar el panel', 'axe.png');"), ['es:Cerrar el panel']);
  assert.deepEqual(kinds("f('Cerrar el panel', 'warn');"), ['es:Cerrar el panel']);
  assert.deepEqual(kinds("f('Cerrar el panel', 'aria-label');"), ['es:Cerrar el panel']);
});

test('a catalog-key argument only exempts a call when the key really exists in the catalog', () => {
  const key = Object.keys(catalogs).find((k) => /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$/.test(k));
  assert.ok(key, 'the catalog has at least one dotted key');
  assert.deepEqual(kinds(`f('Cerrar el panel', '${key}');`), []);
  assert.deepEqual(kinds("f('Cerrar el panel', 'no.such.catalog.key');"), ['es:Cerrar el panel']);
});

test('a two-element array is only a pair when it is not Spanish twice', () => {
  assert.deepEqual(kinds("const P = ['Loading the island', 'Cargando la isla'];"), []);
  assert.deepEqual(kinds("const P = ['Cargando la isla', 'Guardado en el cuaderno'];"), ['es:Cargando la isla', 'es:Guardado en el cuaderno']);
});

test('a slash string is only bilingual when a half is not Spanish', () => {
  assert.deepEqual(kinds("const s = 'Entrar al juego / Enter the game';"), []);
  assert.deepEqual(kinds("const s = '· úsala en B / Construir.';"), ['es:· úsala en B / Construir.']);
});

test('a verb object key is a visible sink', () => {
  assert.deepEqual(kinds("const a = { id: 'chop', verb: 'Recoger' };"), ['es:Recoger']);
  assert.deepEqual(kinds("const a = { verb: retry ? 'Reintentar' : 'Esperando' };"), ['es:Reintentar']);
  assert.deepEqual(kinds("const a = { verb: 'Pick up the fruit' };"), ['en:Pick up the fruit']);
});

test('the i18n-ok marker needs a reason', () => {
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla'; // i18n-ok:"), ['es:Cargando la isla']);
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla'; // i18n-ok:   "), ['es:Cargando la isla']);
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla'; /* i18n-ok: */"), ['es:Cargando la isla']);
  assert.deepEqual(kinds("el.textContent = 'Cargando la isla'; /* i18n-ok: debug overlay */"), []);
  assert.deepEqual(kinds('<p>Cargando la isla</p> <!-- i18n-ok: -->', 'index.html'), ['es:Cargando la isla']);
  assert.deepEqual(kinds('<p>Cargando la isla</p> <!-- i18n-ok -->', 'index.html'), ['es:Cargando la isla']);
});

test('developer errors and id arguments are not prose', () => {
  assert.deepEqual(kinds("throw new PlayerCharactersError('response', 'La lista no tiene un formato valido.');"), []);
  assert.deepEqual(kinds("box.innerHTML = `<div>${itemIcon('madera', 'card-art')}</div>`;"), []);
  assert.deepEqual(kinds("box.innerHTML = `<div>${label('Cargando la isla')}</div>`;"), ['es:Cargando la isla']);
  // Only constructor names ending in Error are developer-facing; error display helpers show text to players.
  assert.deepEqual(kinds("showError('No tienes suficiente oro');"), ['es:No tienes suficiente oro']);
  assert.deepEqual(kinds("el.textContent = setError('Not enough gold to buy');"), ['en:Not enough gold to buy']);
});

test('array tuples: an id-like half or a bare Spanish list is not a bilingual pair', () => {
  assert.deepEqual(kinds("const O = [['chop', 'Talar el árbol']];"), ['es:Talar el árbol']);
  assert.deepEqual(kinds("const O = ['chop', 'Talar el árbol', 'Picar la piedra'];"), ['es:Talar el árbol', 'es:Picar la piedra']);
  assert.deepEqual(kinds("const O = ['arpon', 'Arpón de pesca', 'Fishing Spear'];"), []);
  assert.deepEqual(kinds("f('No se pudo guardar la partida.', 'Could not save the game.');"), []);
});

test('offender identity ignores line numbers', () => {
  const a = scan("el.textContent = 'Cargando la isla';");
  const b = scan("\n\n\nel.textContent = 'Cargando la isla';");
  assert.notEqual(a[0].line, b[0].line);
  assert.deepEqual(diffBaseline(b, buildBaseline(a)), { added: [], stale: [] });
});

const real = scanTree();
const baseline = loadBaseline();
const { added, stale } = diffBaseline(real.offenders, baseline);

test('the scan covers the client tree', () => {
  assert.ok(real.files.includes('src/main.js') && real.files.includes('index.html'), 'src/main.js and index.html are scanned');
  assert.ok(real.files.some((f) => f.startsWith('src/ui/')), 'src/ui is scanned');
  assert.ok(Array.isArray(baseline.entries), 'tools/i18n/baseline.json has an entries array');
});

test('no new hardcoded single-language string or es/en table mismatch beyond the baseline', () => {
  const lines = added.map((o) => {
    const where = real.offenders.filter((x) => x.file === o.file && x.kind === o.kind && x.text === o.text).map((x) => x.line).join(', ');
    return `  ${o.file} (line ${where}) [${o.kind}] ${JSON.stringify(o.text)}`;
  });
  assert.equal(added.length, 0,
    `New untranslated text (${added.length}):\n${lines.join('\n')}\n` +
    'Fix: route the text through the catalog (t(key), setText, or dataText for game data) or put it in a { es, en } table with the same keys. ' +
    'If it is not player-visible on purpose, add an inline "// i18n-ok: <reason>" comment on that line. ' +
    'Never add the entry to tools/i18n/baseline.json by hand.');
});

test('the baseline holds no stale entry', () => {
  const lines = stale.map((o) => `  ${o.file} [${o.kind}] ${JSON.stringify(o.text)}${o.count > 1 ? ` (x${o.count})` : ''}`);
  assert.equal(stale.length, 0,
    `Baseline entries that no longer occur (${stale.length}):\n${lines.join('\n')}\n` +
    'run node tools/i18n/scan-hardcoded.mjs --write-baseline to shrink the baseline');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorMessage } from '../src/editor/messages.js';
import { setLocale, t } from '../src/core/i18n.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('terrain tool hints have distinct ES and EN forms', () => {
  const source = read('src/editor/terrainInteraction.js');
  const pairs = [...source.matchAll(/editorMessage\('([^']+)', '([^']+)'\)/g)];
  const wanted = ['Ramp: click its start', 'Drag on dry ground'];
  for (const prefix of wanted) {
    const pair = pairs.find((m) => m[1].startsWith(prefix));
    assert.ok(pair, `missing hint ${prefix}`);
    assert.notEqual(pair[1], pair[2]);
  }
  assert.deepEqual(editorMessage('a', 'b'), { en: 'a', es: 'b' });
});

test('inspector rotation labels and editor aria-label are bilingual', () => {
  const source = read('src/editor/editor.js');
  for (const axis of ['X', 'Y', 'Z']) {
    assert.ok(source.includes(`rot${axis}: ['Rot ${axis}°', 'Giro ${axis}°']`));
    assert.match(source, new RegExp(`data-i18n="rot${axis}"`));
  }
  assert.doesNotMatch(source, /<span>Rot [XYZ]°<\/span>/);
  assert.match(source, /setAttribute\('aria-label', this\._t\('World editor', 'Editor del mundo'\)\)/);
});

test('the lawless sign text follows the locale', (context) => {
  context.after(() => setLocale('es'));
  setLocale('es');
  assert.equal(t('sign.lawless'), 'SIN LEY →');
  setLocale('en');
  assert.equal(t('sign.lawless'), 'LAWLESS →');
  for (const file of ['src/render/props.js', 'src/render/townFixtures.js']) {
    assert.match(read(file), /t\('sign\.lawless'\)/);
    assert.doesNotMatch(read(file), /fillText\('SIN LEY|label\('SIN LEY/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import systemsLive from '../src/i18n/systems-live.js';

test('live system catalog keeps both locales and interpolation parameters aligned', () => {
  assert.ok(Object.keys(systemsLive).length >= 60);
  for (const [key, pair] of Object.entries(systemsLive)) {
    assert.equal(pair.length, 2, `${key} has Spanish and English`);
    assert.ok(pair.every((value) => typeof value === 'string' && value.length > 0), `${key} has text in both locales`);
    const params = (value) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(params(pair[0]), params(pair[1]), `${key} preserves its interpolation parameters`);
  }
});

test('live system catalog covers the M5-facing localization surfaces', () => {
  for (const key of [
    'systems.logging.tab',
    'systems.artisan.learn',
    'systems.workbench.ready',
  ]) assert.ok(systemsLive[key], `missing ${key}`);
});

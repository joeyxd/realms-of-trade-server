// PT07: PvP is visible. The Cala is the only lawless zone and says so; La Caldera's banner and its first-visit hint
// say the law holds there, in both languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZONES } from '../src/sim/worldgen.js';
import data from '../src/i18n/data.js';
import runtime from '../src/i18n/runtime.js';

test('the Cala is the only lawless zone and its banner says so', () => {
  const lawless = Object.entries(ZONES).filter(([, z]) => z.lawless).map(([id]) => id);
  assert.deepEqual(lawless, ['calavera']);
  assert.match(ZONES.calavera.sub, /Sin ley/);
  assert.match(data[ZONES.calavera.sub], /No law/);
});

test('La Caldera says there is no PvP, banner and first-visit hint, in both languages', () => {
  assert.equal(ZONES.caldera.lawless, undefined);
  assert.match(ZONES.caldera.sub, /Sin PvP/);
  assert.match(data[ZONES.caldera.sub], /No PvP/);
  const [es, en] = runtime['runtime.calderaHint'];
  assert.match(es, /La Caldera/); assert.match(es, /Cala Calavera/); assert.match(es, /ley/);
  assert.match(en, /La Caldera/); assert.match(en, /Skull Cove/); assert.match(en, /law/);
});

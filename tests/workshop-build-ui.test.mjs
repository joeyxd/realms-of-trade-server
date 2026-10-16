import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTISAN } from '../src/data/artisan.js';
import { workshopBuildPayment } from '../src/ui/raftEditor.js';
import { workbenchPreview } from '../src/ui/workbench.js';
import { packInventoryHtml } from '../src/ui/packInventory.js';

const profile = (workshop = {}) => ({ progression: { v: 1, practice: { logging: 0 }, milestones: [], knowledge: [ARTISAN.lesson] },
  workshop: { v: 1, boards: 10, storageCredit: false, crateKits: 1, ...workshop },
  eco: { pack: { cap: 18, maxMass: 18, goods: { tronco: 4, madera: 10 } } } });

test('workshop raft payment previews first storage credit and crate kits without mutating profile', () => {
  const p = profile({ storageCredit: true }), before = structuredClone(p);
  const freeStorage = workshopBuildPayment(p, [ARTISAN.part, 0, 0, 0], true);
  assert.deepEqual(freeStorage.cost, {}); assert.equal(freeStorage.credit, true);
  assert.equal(freeStorage.workshop.storageCredit, false);
  const crate = workshopBuildPayment(p, ['crate', 0, 0, 0], true);
  assert.deepEqual(crate.cost, {}); assert.equal(crate.kit, true); assert.equal(crate.workshop.crateKits, 0);
  assert.deepEqual(p, before);
  assert.deepEqual(workshopBuildPayment(p, ['crate', 0, 0, 0], false).cost, { madera: 2 }); // legacy crate cost is unchanged
});

test('workshop raft payment uses ten boards after credit and refuses a missing kit', () => {
  const p = profile({ storageCredit: false, crateKits: 0 });
  assert.deepEqual(workshopBuildPayment(p, [ARTISAN.part, 0, 0, 0], true).cost, { madera: 10 });
  assert.equal(workshopBuildPayment(p, ['crate', 0, 0, 0], true).why, 'crateKit');
});

test('workbench preview applies declared mass and volume limits, while legacy packs retain no invented mass cap', () => {
  const loaded = { eco: { pack: { cap: 18, maxMass: 18, goods: { tronco: 4 } } } };
  const preview = workbenchPreview(loaded, 1);
  assert.equal(preview.packKnown, true); assert.equal(preview.massBefore, 12);
  assert.equal(preview.massFits, true); assert.equal(preview.canCraft, true);
  const tooHeavy = { eco: { pack: { cap: 18, maxMass: 10, goods: { tronco: 4 } } } };
  assert.equal(workbenchPreview(tooHeavy, 1).packKnown, false);
  const legacy = workbenchPreview({ eco: { pack: { cap: 18, goods: { tronco: 4 } } } }, 1);
  assert.equal(legacy.massLimit, null); assert.equal(legacy.canCraft, true);
});

test('basic plank and pack display use English label and real per-good dimensions', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: 'en' } };
  try {
    const preview = workbenchPreview({ eco: { pack: { cap: 18, maxMass: 18, goods: { tronco: 2 } } } }, 1);
    assert.equal(preview.outputName, 'Basic plank');
    const html = packInventoryHtml({ carry: { v: 1, backpack: 0 }, eco: { pack: { cap: 18, maxMass: 18, goods: { madera: 1 } } } }, {}, 'en');
    assert.match(html, /Basic plank/); assert.match(html, /3 uV · 3 uM/);
  } finally { globalThis.document = oldDocument; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FreshwaterPanel } from '../src/ui/freshwaterPanel.js';
import { packInventoryHtml } from '../src/ui/packInventory.js';

function panel({ canteenEnabled = true, vessels = [], goods = {}, sat = 62, hyd = 48, locale = 'es' } = {}) {
  const sent = [], toasts = [];
  let now = 0;
  const client = {
    joined: true, youServer: 7, profile: { eco: { tradeRev: 12, pack: { cap: 10, goods, vessels }, ships: [] }, surv: { v: 1, sat, hyd } },
    freshwaterStatus: { enabled: true, canteenEnabled, needs: canteenEnabled ? { sat, hyd, penalty: 0.1 } : undefined,
      source: { id: 'salty-spring', near: true }, barrels: [] }, send(command) { sent.push(command); },
  };
  const ui = Object.create(FreshwaterPanel.prototype);
  Object.assign(ui, {
    active: true, pending: null, owner: client, session: client.youServer, client: () => client,
    localeSource: () => locale, toast: message => toasts.push(message), now: () => now, setNow: value => { now = value; },
    root: null, statusKey: '', statusReason: '',
  });
  return { ui, client, sent, toasts, setNow: value => { now = value; } };
}

test('canteen crafting and direct spring fill use M5 freshwater commands with capped dose counts', () => {
  const f = panel({ goods: { lona: 2, madera: 1 }, vessels: [{ id: 'canteen', kind: 'canteen', water: 1 }] });
  assert.equal(f.ui.craftCanteen(), false, 'an existing canteen cannot be crafted twice');
  assert.equal(f.ui.fillCanteenAtSpring(), true);
  assert.deepEqual({ ...f.sent[0], opId: undefined }, {
    t: 'cmd', type: 'freshwater', op: 'fillCanteen', opId: undefined, expectedRev: 12,
    source: 'salty-spring', ship: '', part: '', n: 2,
  });
  assert.match(f.sent[0].opId, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(f.sent[0].expectedRev, 12);
  f.ui.pending = null;
  f.client.profile.eco.pack.vessels[0].water = 3;
  assert.equal(f.ui.fillCanteenAtSpring(), false, 'a full canteen has no fill request');
});

test('new canteen actions stay disabled while the authoritative snapshot reports another active channel', () => {
  const f = panel({ goods: { lona: 2, madera: 1 }, vessels: [{ id: 'canteen', kind: 'canteen', water: 0 }] });
  f.client.freshwaterStatus.gathering = 0.1;
  assert.equal(f.ui.craftCanteen(), false);
  assert.equal(f.ui.fillCanteenAtSpring(), false);
  assert.equal(f.ui.refillCanteen('bucket'), false);
  assert.equal(f.sent.length, 0);
});

test('canteen craft charges are gated by feature state and submitted through the existing op ID/revision path', () => {
  const f = panel({ goods: { lona: 2, madera: 1 } });
  assert.equal(f.ui.craftCanteen(), true);
  assert.equal(f.sent[0].op, 'craftCanteen');
  assert.equal(f.sent[0].source, '');
  assert.equal(f.sent[0].n, 0);
  assert.equal(f.sent[0].expectedRev, 12);
  assert.match(f.sent[0].opId, /^[A-Za-z0-9_-]{1,64}$/);

  const off = panel({ canteenEnabled: false, goods: { lona: 2, madera: 1 }, vessels: [{ id: 'canteen', kind: 'canteen', water: 1 }] });
  assert.equal(off.ui.craftCanteen(), false);
  assert.equal(off.ui.fillCanteenAtSpring(), false);
  assert.equal(off.ui.refillCanteen('bucket'), false);
  assert.equal(off.ui.drink(), false);
  assert.equal(off.ui.eat('fruta'), false);
  assert.equal(off.sent.length, 0);
});

test('bucket, provisions, and barrel refills clamp to the canteen capacity and keep the source identity', () => {
  const f = panel({ goods: { agua: 8 }, vessels: [
    { id: 'bucket', kind: 'bucket', water: 2 }, { id: 'canteen', kind: 'canteen', water: 1 },
  ] });
  assert.equal(f.ui.refillCanteen('bucket'), true);
  assert.deepEqual([f.sent[0].source, f.sent[0].n, f.sent[0].ship, f.sent[0].part], ['bucket', 2, '', '']);
  f.ui.pending = null;
  assert.equal(f.ui.refillCanteen('provisions'), true);
  assert.deepEqual([f.sent[1].source, f.sent[1].n], ['provisions', 2]);
  f.ui.pending = null;
  assert.equal(f.ui.refillCanteen('barrel', 'ship_1', 'p4', 8), true);
  assert.deepEqual([f.sent[2].source, f.sent[2].n, f.sent[2].ship, f.sent[2].part], ['barrel', 2, 'ship_1', 'p4']);
});

test('delayed retry repeats the exact pending operation ID and acknowledgement leaves displayed water snapshot-owned', () => {
  const f = panel({ vessels: [{ id: 'canteen', kind: 'canteen', water: 1 }] });
  assert.equal(f.ui.drink(), true);
  const original = f.sent[0];
  assert.deepEqual([original.op, original.source, original.ship, original.part, original.n], ['drink', '', '', '', 1]);
  f.setNow(1100); f.ui.update();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1], original);
  assert.equal(f.ui.acknowledge({ type: 'freshwater', op: 'drink', opId: original.opId, ok: true }), true);
  assert.equal(f.ui.pending, null);
  assert.equal(f.ui.canteen().water, 1, 'success acknowledgements do not invent a local hydration or inventory delta');
  assert.deepEqual(f.ui.needs(), { sat: 62, hyd: 48 });
});

test('food buttons submit one authoritative food ID and use the optional saved survival fallback', () => {
  const f = panel({ goods: { pescado: 2, fruta: 1 }, sat: 80, hyd: 100 });
  f.client.freshwaterStatus.needs = undefined;
  assert.deepEqual(f.ui.needs(), { sat: 80, hyd: 100 });
  assert.equal(f.ui.eat('pescado'), true);
  assert.deepEqual([f.sent[0].op, f.sent[0].source, f.sent[0].n], ['eat', 'pescado', 1]);
  assert.match(f.sent[0].opId, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(f.sent[0].expectedRev, 12);
  f.ui.pending = null;
  assert.equal(f.ui.eat('fruta'), true, 'fruit still helps hunger even with hydration full');
});

test('pack inventory localizes the canteen and reports its capacity, volume, and water-inclusive mass', () => {
  const profile = { eco: { pack: { cap: 10, goods: {}, vessels: [{ id: 'canteen', kind: 'canteen', water: 2 }] } } };
  const es = packInventoryHtml(profile, {}, 'es'), en = packInventoryHtml(profile, {}, 'en');
  assert.match(es, /Cantimplora reutilizable/);
  assert.match(es, /2\/3 agua dulce · 1 uV · 2\.5 uM/);
  assert.match(en, /Reusable canteen/);
  assert.match(en, /2\/3 fresh water · 1 uV · 2\.5 uM/);
});

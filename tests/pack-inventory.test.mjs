import test from 'node:test';
import assert from 'node:assert/strict';
import { GOODS } from '../src/data/goods.js';
import { packInventoryHtml } from '../src/ui/packInventory.js';

test('renders every carried good, volume, mass, and tier-one utility tools', () => {
  const profile = {
    eco: { pack: { cap: 30, goods: { tronco: 2, piedra: 3, seda: 4 } } },
    tools: { axe: 1, pickaxe: 0 },
  };
  const html = packInventoryHtml(profile);
  assert.match(html, /Tronco recogido/);
  assert.match(html, /Piedra/);
  assert.match(html, /Seda/);
  assert.match(html, /Volumen <b>16 \/ 30 uV<\/b>/);
  assert.match(html, /Masa <b>19 uM<\/b>/);
  assert.doesNotMatch(html, /Masa <b>19 \/ \d+ uM/); // legacy profiles have no declared mass cap
  assert.match(html, /Hacha de piedra/);
  assert.match(html, /Nivel I/);
  assert.doesNotMatch(html, /Pico de piedra/);
});

test('lists all catalog goods with positive counts and marks pending presentation quantities', () => {
  const goods = Object.fromEntries(Object.keys(GOODS).map((id) => [id, 1]));
  const profile = { tools: { axe: 0, pickaxe: 1 } };
  const before = structuredClone(goods);
  const html = packInventoryHtml(profile, { pack: { cap: 100, goods }, pendingGoods: { mineral_hierro: 1 } });
  for (const good of Object.values(GOODS)) assert.ok(html.includes(good.name), `shows ${good.name}`);
  assert.match(html, /Mineral de hierro[\s\S]*?class="pack-pending"/);
  assert.match(html, /Pico de piedra/);
  assert.deepEqual(goods, before, 'rendering does not mutate caller-owned goods');
  assert.deepEqual(profile, { tools: { axe: 0, pickaxe: 1 } }, 'rendering does not add pack data to profile');
});

test('supports English labels and a projected pack without changing saved inventory', () => {
  const profile = { eco: { pack: { cap: 10, goods: { tronco: 1 } } }, tools: { axe: 1, pickaxe: 1 } };
  const before = structuredClone(profile);
  const html = packInventoryHtml(profile, { pack: { cap: 12, goods: { madera: 2 } }, pendingGoods: {} }, 'en-US');
  assert.match(html, /Materials pack/);
  assert.match(html, /Basic plank/);
  assert.match(html, /Volume <b>6 \/ 12 uV<\/b>/);
  assert.match(html, /Mass <b>6 uM<\/b>/);
  assert.match(html, /3 uV · 3 uM/);
  assert.match(html, /Utility belt/);
  assert.match(html, /Stone axe/);
  assert.match(html, /Stone pickaxe/);
  assert.deepEqual(profile, before);
});

test('carry metadata supplies mass limit and strength; each item exposes both dimensions', () => {
  const html = packInventoryHtml({ carry: { v: 1, backpack: 1 }, lvl: 3,
    eco: { pack: { cap: 30, maxMass: 22, goods: { madera: 2 } } } }, {}, 'en');
  assert.match(html, /Mass <b>6 \/ 22 uM<\/b>/);
  assert.match(html, /Strength <b>12<\/b>/);
  assert.match(html, /3 uV · 3 uM/);
});

test('empty packs and unowned tools have localized empty states', () => {
  const html = packInventoryHtml({ eco: { pack: { cap: 10, goods: {} } }, tools: {} }, {}, 'en');
  assert.match(html, /No materials carried\./);
  assert.match(html, /No tools yet\./);
});

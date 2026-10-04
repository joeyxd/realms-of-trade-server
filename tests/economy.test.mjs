// The game's structure (M6–M8 scaffold, PLAN-M7.md): markets, holds, voyages, building plots, the economy clock and
// the market command on the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOODS, GOOD_IDS, LAW } from '../src/data/goods.js';
import { TOWNS, TOWN_IDS, LANES, ISLANDS } from '../src/data/towns.js';
import { HULLS, MODULES, shipStats } from '../src/data/ships.js';
import { BUILDINGS, RECIPES } from '../src/data/buildings.js';
import { MARKET, newMarket, unitPrice, quote, settle, stepMarket, board, goodsOf, equilibrium } from '../src/sim/economy/market.js';
import { newHold, load, unload, roomFor, holdUsed, rot, sanitizeHold } from '../src/sim/economy/cargo.js';
import { seaPath, planVoyage, resolveVoyage, voyageHours } from '../src/sim/economy/voyage.js';
import { newPlots, canBuild, startBuild, stepPlot, stock } from '../src/sim/economy/plots.js';
import { Economy, ECON } from '../src/sim/economy/economy.js';
import { mulberry32 } from '../src/core/rng.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';

test('data: every town trades known goods, lanes join known towns, every town is reachable, recipes and costs are known goods', () => {
  for (const id of TOWN_IDS) {
    const T = TOWNS[id];
    assert.ok(ISLANDS[T.island], id + ' island'); assert.ok(LAW[T.law], id + ' law');
    for (const k of ['produce', 'consume', 'stock']) for (const g of Object.keys(T[k] || {})) assert.ok(GOODS[g], `${id}.${k}.${g}`);
    assert.ok(seaPath('aldea', id), 'reach ' + id);
  }
  for (const [a, b, l, d] of LANES) { assert.ok(TOWNS[a] && TOWNS[b]); assert.ok(l > 0 && d >= 0 && d <= 1); }
  for (const [id, R] of Object.entries(RECIPES)) for (const g of [...Object.keys(R.in), ...Object.keys(R.out)]) assert.ok(GOODS[g], `${id}: ${g}`);
  for (const [id, B] of Object.entries(BUILDINGS)) {
    for (const g of Object.keys(B.cost)) assert.ok(g === 'gold' || GOODS[g], `${id} cost ${g}`);
    for (const r of B.recipes || []) assert.ok(RECIPES[r], `${id} recipe ${r}`);
  }
  for (const g of GOOD_IDS) assert.ok(GOODS[g].base > 0 && GOODS[g].w > 0);
});

test('market: scarcity raises the price, a glut lowers it, within the floor and the ceiling', () => {
  const T = TOWNS.aldea;
  const at = (s) => unitPrice(T, 'ron', s);
  assert.ok(at(5) > at(25) && at(25) > at(100));
  assert.ok(Math.abs(at(T.stock.ron) - GOODS.ron.base) < 1e-9, 'at its target the price is the base');
  assert.ok(at(0) <= GOODS.ron.base * MARKET.maxK + 1e-9 && at(1e6) >= GOODS.ron.base * MARKET.minK - 1e-9);
});

test('market: big trades slip, a buy-then-sell round trip loses money (spread + tax), the stock moves', () => {
  const T = TOWNS.aldea, m = newMarket('aldea', T);
  const one = quote(m, T, 'pescado', 1, 'buy'), fifty = quote(m, T, 'pescado', 50, 'buy');
  assert.ok(fifty.ok && fifty.total > one.total * 50, 'buying a lot pushes the price up as you go');
  const before = m.stock.pescado;
  settle(m, 'pescado', 50, 'buy');
  assert.equal(m.stock.pescado, before - 50);
  const back = quote(m, T, 'pescado', 50, 'sell');
  assert.ok(back.total < fifty.total, 'selling it back pays less');
  assert.equal(quote(m, T, 'pescado', 0, 'buy').why, 'n');
  assert.equal(quote(m, T, 'seda', 1, 'buy').why, 'good', 'the Aldea does not trade silk');
  assert.equal(quote(m, T, 'pescado', 9999, 'buy').why, 'n');
  assert.equal(quote(m, T, 'pescado', 400, 'buy').why, 'stock');
});

test('trade routes pay: what a town makes is cheap there and dear where it is eaten', () => {
  const aldea = TOWNS.aldea, sol = TOWNS.sol;
  const buyFish = quote(newMarket('aldea', aldea), aldea, 'pescado', 20, 'buy').total;
  const sellFish = quote(newMarket('sol', sol), sol, 'pescado', 20, 'sell').total;
  assert.ok(sellFish > buyFish * 1.3, `fish: Aldea ${buyFish} → Puerto Sol ${sellFish}`);
  const buySilk = quote(newMarket('sol', sol), sol, 'seda', 2, 'buy').total;
  const sellSilk = quote(newMarket('cala', TOWNS.cala), TOWNS.cala, 'seda', 2, 'sell').total; // small luxury markets fill fast
  assert.ok(sellSilk > buySilk, `silk: Puerto Sol ${buySilk} → Cala ${sellSilk}`);
  assert.ok(equilibrium(aldea, 'pescado') > aldea.stock.pescado && equilibrium(aldea, 'ron') < aldea.stock.ron);
});

test('law: the Crown refuses contraband, the Cala pays more for it, taxes differ', () => {
  const corona = TOWNS.corona, mc = newMarket('corona', { ...corona, stock: { ...corona.stock, polvora: 10 } });
  assert.equal(quote(mc, { ...corona, stock: { ...corona.stock, polvora: 10 } }, 'polvora', 1, 'sell').why, 'law');
  const cala = TOWNS.cala, aldea = TOWNS.aldea;
  const sellCala = quote(newMarket('cala', cala), cala, 'polvora', 1, 'sell').total;
  const sellAldea = quote(newMarket('aldea', aldea), aldea, 'polvora', 1, 'sell').total;
  assert.ok(sellCala > sellAldea, `contraband pays more in the Cala (${sellCala} vs ${sellAldea})`);
});

test('market life: a drained market refills toward its target over days, a flooded one drains; deterministic', () => {
  const T = TOWNS.aldea;
  const run = (seed) => {
    const m = newMarket('aldea', T), rng = mulberry32(seed);
    m.stock.ron = 0; m.stock.pescado = 1000;
    for (let i = 0; i < 24; i++) stepMarket(m, T, 0.5, rng);
    return m;
  };
  const a = run(7), b = run(7);
  assert.deepEqual(a.stock, b.stock, 'same seed, same market');
  assert.ok(a.stock.ron > equilibrium(T, 'ron') * 0.85, `ron back near its equilibrium: ${a.stock.ron.toFixed(1)}`);
  assert.ok(a.stock.pescado < equilibrium(T, 'pescado') * 1.3, `fish glut gone: ${a.stock.pescado.toFixed(1)}`);
  const rows = board(a, T);
  assert.equal(rows.length, goodsOf(T).length);
  for (const r of rows) assert.ok(r.buy >= r.sell, r.g);
});

test('holds: space by weight, rot, sanitize', () => {
  const h = newHold(10);
  assert.equal(roomFor(h, 'madera'), 3); // w 3
  assert.ok(load(h, 'madera', 3)); assert.equal(holdUsed(h), 9);
  assert.ok(!load(h, 'pescado', 2)); assert.ok(load(h, 'pescado', 1));
  assert.ok(!unload(h, 'madera', 4)); assert.ok(unload(h, 'madera', 3)); assert.equal(h.goods.madera, undefined);
  const f = newHold(100); load(f, 'fruta', 50);
  const lost = rot(f, 5); assert.ok(lost.fruta > 0 && f.goods.fruta < 50);
  const s = sanitizeHold({ goods: { ron: 5.7, seda: -2, oro: 9, madera: 99 } }, 10);
  assert.deepEqual(s.goods, { ron: 5, madera: 1 });
});

test('ships: modules fill slots up to the hull, holds add space, masts set the speed', () => {
  const s = shipStats('balandra', ['cannon_bronce', 'cannon_pesado', 'cannon_bronce', 'hold_pequena', 'mast_cuadra', 'nope']);
  assert.equal(s.cannons.length, 2, 'two cannon slots');
  assert.equal(s.hold, HULLS.balandra.hold + MODULES.hold_pequena.capacity);
  assert.ok(Math.abs(s.speed - HULLS.balandra.speed * 1.12) < 1e-9);
  assert.ok(shipStats('balandra', []).speed < HULLS.balandra.speed, 'no sails: slow');
  assert.equal(shipStats('bote', []).speed, HULLS.bote.speed * 0.6);
});

test('voyages: shortest path, hours by speed, seeded events, storms spill and patrols seize contraband near the Crown', () => {
  const p = seaPath('aldea', 'corona');
  assert.deepEqual(p.path, ['aldea', 'sol', 'corona']); assert.equal(p.leagues, 10);
  assert.equal(seaPath('aldea', 'aldea').leagues, 0);
  assert.ok(voyageHours(10, 5) < voyageHours(10, 2.5));
  const a = planVoyage('aldea', 'corona', { speed: 4.5 }, mulberry32(3)), b = planVoyage('aldea', 'corona', { speed: 4.5 }, mulberry32(3));
  assert.deepEqual(a, b);
  assert.equal(planVoyage('aldea', 'aldea', { speed: 4 }, mulberry32(1)).why, 'here');
  const hold = newHold(100); load(hold, 'polvora', 10); load(hold, 'ron', 10);
  const plan = { path: ['aldea', 'sol', 'corona'], events: [{ kind: 'patrol', at: 0.5 }, { kind: 'storm', at: 0.7 }] };
  const r = resolveVoyage(plan, hold, { rng: mulberry32(2), lawAt: (t) => TOWNS[t].law });
  assert.equal(hold.goods.polvora, undefined, 'contraband seized'); assert.ok(r.fine > 0); assert.ok(r.hull > 0);
  assert.ok(r.log.includes('patrol') && r.log.includes('storm'));
  const h2 = newHold(100); load(h2, 'polvora', 10);
  resolveVoyage({ path: ['aldea', 'cala'], events: [{ kind: 'patrol', at: 0.5 }] }, h2, { rng: mulberry32(2), lawAt: (t) => TOWNS[t].law });
  assert.equal(h2.goods.polvora, 10, 'no Crown on the way: no search');
});

test('plots: build with gold and goods, wait, then a workshop turns inputs into outputs batch by batch', () => {
  const plots = newPlots('aldea');
  assert.equal(plots.length, TOWNS.aldea.plots);
  const p = plots[0], wallet = { gold: 5000, hold: newHold(1000) };
  load(wallet.hold, 'madera', 30); load(wallet.hold, 'hierro', 10);
  assert.equal(canBuild(p, 'destileria', 'yo', wallet), 'owner');
  p.owner = 'yo';
  assert.equal(canBuild(p, 'destileria', 'yo', { gold: 10, hold: wallet.hold }), 'gold');
  assert.equal(canBuild(p, 'destileria', 'yo', wallet), '');
  startBuild(p, 'destileria', wallet, 0);
  assert.equal(wallet.gold, 5000 - BUILDINGS.destileria.cost.gold); assert.equal(wallet.hold.goods.madera, undefined);
  stepPlot(p, 0, 6); assert.equal(p.state, 'building');
  stepPlot(p, 6, BUILDINGS.destileria.time); assert.equal(p.state, 'ready');
  assert.equal(stock(p, 'cana', 12), 12);
  const R = RECIPES.ron;
  stepPlot(p, 12, 12 + R.hours * 3 + 0.5);
  assert.equal(p.store.ron, R.out.ron * 3, 'three batches of rum');
  assert.equal(p.store.cana || 0, 0);
  const c = newPlots('corona')[0]; c.owner = 'yo';
  assert.equal(canBuild(c, 'polvorin', 'yo', { gold: 1e5, hold: newHold(1e4) }), 'law');
});

test('economy: the clock, unpaid upkeep stops a workshop, serialize round trip', () => {
  const eco = new Economy(5);
  assert.equal(eco.hourOfDay, ECON.startHour);
  eco.step(ECON.daySec / 2);
  assert.ok(Math.abs(eco.hours - (ECON.startHour + 12)) < 1e-6);
  const p = eco.plots.aldea[0];
  Object.assign(p, { owner: 'x', b: 'panaderia', state: 'ready', recipe: 'galleta', store: { harina: 30 } });
  let paid = 0;
  eco.payUpkeep = (o, g) => { paid += g; return true; };
  eco.advance(ECON.daySec);
  assert.ok(paid >= BUILDINGS.panaderia.upkeep - 1 && paid <= BUILDINGS.panaderia.upkeep + 1, `about a day of upkeep: ${paid}`);
  assert.ok(p.store.galleta > 0);
  const before = p.store.galleta;
  eco.payUpkeep = () => false;
  eco.advance(ECON.daySec / 4);
  assert.equal(p.store.galleta, before, 'unpaid: no work');
  assert.ok(p.debt > 0);
  const back = Economy.from(JSON.parse(JSON.stringify(eco.serialize())), 5);
  assert.deepEqual(back.markets, eco.markets); assert.equal(back.plots.aldea[0].b, 'panaderia'); assert.equal(back.hours, eco.hours);
  const w = { gold: 1000, hold: newHold(10) };
  assert.ok(eco.trade('aldea', 'pescado', 5, 'buy', w).ok); assert.equal(w.hold.goods.pescado, 5);
  assert.equal(eco.trade('aldea', 'madera', 4, 'buy', w).why, 'room');
  assert.equal(eco.trade('aldea', 'ron', 1, 'sell', w).why, 'have');
});

test('profiles carry the trade state; old saves without it get an empty pack', () => {
  const p = newProfile();
  assert.deepEqual(p.eco.pack.goods, {}); assert.equal(p.eco.pack.cap, 10);
  p.eco.pack.goods = { ron: 3, x: 4 }; p.eco.ships = [{ hull: 'balandra', mods: ['cannon_bronce', 'zzz'], at: 'aldea', hold: { goods: { pescado: 4 } } }, { hull: 'nave' }];
  const q = sanitizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(q.eco.pack.goods, { ron: 3 });
  assert.equal(q.eco.ships.length, 1); assert.deepEqual(q.eco.ships[0].mods, ['cannon_bronce']); assert.equal(q.eco.ships[0].hold.goods.pescado, 4);
  const old = JSON.parse(JSON.stringify(newProfile())); delete old.eco;
  assert.deepEqual(sanitizeProfile(old).eco.pack.goods, {});
});

test('server: the market command lists, buys and sells where you stand, refuses far away, mid-fight or without gold', () => {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); } });
  const w = s.world, ecs = w.ecs;
  s.connect(1);
  s.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P1', skin: 0, weapon: 0, save: '' });
  const e = s.clients.get(1).entity;
  ecs.regenT[e] = 99;
  const ev = (type) => (sent.get(1) || []).filter((m) => m.t === MSG.EVENT && m.ev.type === type).map((m) => m.ev);
  const cmd = (o) => { s.receive(1, { t: MSG.CMD, type: 'market', ...o }); s.flushEvents(); };
  const why = (o) => { const n = ev('tradeDenied').length; cmd(o); const a = ev('tradeDenied'); return a.length > n ? a.at(-1).why : ''; };
  assert.ok(w.economy, 'the server has an economy');
  const v = w.map.landmarks.village;
  ecs.x[e] = v.x + 200; ecs.z[e] = v.z;
  assert.equal(why({ op: 'list', town: 'aldea' }), 'far');
  ecs.x[e] = v.x + 3; ecs.z[e] = v.z + 3;
  cmd({ op: 'list', town: 'aldea' });
  const list = ev('market').at(-1);
  assert.equal(list.town, 'aldea'); assert.ok(list.rows.some((r) => r.g === 'pescado' && r.buy > 0));
  assert.equal(why({ op: 'buy', town: 'aldea', g: 'pescado', n: 3 }), 'gold');
  w.profiles.get(e).gold = 500;
  assert.equal(why({ op: 'buy', town: 'aldea', g: 'pescado', n: 3 }), '');
  const t = ev('traded').at(-1);
  assert.equal(t.n, 3); assert.equal(t.pack.pescado, 3); assert.equal(t.gold, 500 - t.total);
  assert.equal(why({ op: 'sell', town: 'aldea', g: 'pescado', n: 2 }), '');
  assert.equal(w.profiles.get(e).eco.pack.goods.pescado, 1);
  ecs.regenT[e] = 0;
  assert.equal(why({ op: 'sell', town: 'aldea', g: 'pescado', n: 1 }), 'combat');
  ecs.regenT[e] = 99;
  assert.equal(why({ op: 'buy', town: 'nowhere', g: 'pescado', n: 1 }), 'town');
});

// Positive controls for the real autonomous helpers behind the host's tick safepoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { newProfile, giveItem } from '../src/sim/systems/inventory.js';
import { rollItem } from '../src/sim/items.js';
import { givePearl } from '../src/sim/systems/pearls.js';
import { newRaft, raftStats } from '../src/sim/economy/raft.js';
import { productionKey } from '../src/sim/economy/raftProduction.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { ECON } from '../src/sim/economy/economy.js';
import { C } from '../src/sim/ecs.js';
import { DT } from '../src/data/tuning.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

function setup(t, profile = newProfile()) {
  const messages = [], h = new GameHost({ seed: 173, bots: 0, log: () => {} });
  t.after(() => h.close());
  const s = h.server, w = s.world;
  // Keep real simulation systems, with no unrelated population or timed respawns in this fixture.
  w.spawners.length = 0;
  for (let e = 1; e < w.ecs.cap; e++) if (w.ecs.alive[e] && (w.ecs.mask[e] & C.ENEMY)) w.despawn(e);
  s.send = (_id, message) => messages.push(structuredClone(message));
  profile.pirateId = 'tick-effects-player';
  s.connect(1);
  s.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Tick effects', save: s.saves.store(profile) });
  const c = s.clients.get(1), e = c.entity, p = w.profiles.get(e);
  assert.ok(e);
  w.events.length = 0; w.profileDirty.clear(); messages.length = 0;
  return { h, s, w, c, e, p, messages, gate: pearlMutationGate(h.profiles) };
}

function capture(w, p) {
  return structuredClone({ tick: w.tick, profile: p, economy: w.economy.serialize(), acc: w.economy.acc,
    ledger: [...w.pearlLedger], drops: [...w.drops], burns: [...(w.burns || [])],
    rng: w.rng.state(), lootRng: w.lootRng.state(), nextDrop: w.nextDrop, nextPearl: w.nextPearl,
    events: w.events, dirty: [...w.profileDirty] });
}

test('a due net/grill production lot retains clock, work, goods and revisions until the tick resumes', (t) => {
  const raw = newProfile(), ship0 = raw.eco.ships.find(q => q.kind === 'raft');
  ship0.grid = newRaft([...STARTER_RAFT, ['net', 1, 0, 0, 0], ['grill', 0, 1, 0, 0]]);
  ship0.hold.cap = raftStats(ship0.grid).hold;
  const { s, w, p, messages, gate } = setup(t, raw), ship = p.eco.ships.find(q => q.kind === 'raft');
  const net = productionKey(['net', 1, 0, 0, 0]), grill = productionKey(['grill', 0, 1, 0, 0]);
  ship.grid.work = { [net]: 0.96875, [grill]: 0.96875 };
  ship.hold.goods = { pescado: 2 };
  w.economy.acc = ECON.tickSec - DT;
  const before = capture(w, p), revision = ship.rev, tradeRevision = p.eco.tradeRev;
  const held = gate.reserve({ uids: ['unrelated:production'] });
  try {
    for (let i = 0; i < 12; i++) assert.equal(s.step(), false);
    assert.deepEqual(capture(w, p), before);
    assert.equal(messages.length, 0);
  } finally { gate.release(held); }
  assert.equal(s.step(), true);
  assert.equal(ship.rev, revision + 1);
  assert.equal(p.eco.tradeRev, tradeRevision + 1);
  assert.deepEqual(ship.hold.goods, { pescado: 1, galleta: 2 });
  const made = messages.filter(m => m.t === MSG.EVENT && m.ev.type === 'raftProduction');
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].ev.made, { pescado: 1, galleta: 2 });
  assert.equal(s.step(), true);
  assert.equal(ship.rev, revision + 1, 'release does not turn blocked attempts into extra lots');
});

test('lethal autonomous burn retains the complete pearl and equipment death until one resumed tick', (t) => {
  const { s, w, e, p, c, messages, gate } = setup(t);
  const pearl = givePearl(w, e, 'brasa'), s2 = w.ecs;
  giveItem(w, e, rollItem(w.lootRng, { lvl: 2, rarity: 1, slot: 'hat', uid: p.uid++ }));
  assert.equal(p.bag.length, 1);
  p.mast[0] = [2, 17];
  s2.x[e] = w.map.cala.x; s2.z[e] = w.map.cala.z; s2.y[e] = w.map.groundAt(s2.x[e], s2.z[e]);
  s2.hp[e] = 1; s2.potions[e] = 2;
  w.burns = new Map([[e, { until: 100, next: 0, raw: 1000, by: 0, pirateId: '' }]]);
  w.events.length = 0; w.profileDirty.clear(); messages.length = 0;
  const before = capture(w, p), masters = structuredClone(p.mast), saveAt = c.saveAt;
  const held = gate.reserve({ uids: [pearl.uid] });
  try {
    assert.equal(s.step(), false); assert.equal(s.step(), false);
    assert.deepEqual(capture(w, p), before);
    assert.equal(s2.hp[e], 1); assert.equal(s2.dead[e], 0); assert.equal(s2.potions[e], 2);
    assert.equal(c.saveAt, saveAt); assert.equal(messages.length, 0);
  } finally { gate.release(held); }
  assert.equal(s.step(), true);
  assert.equal(s2.dead[e], 1); assert.equal(s2.hp[e], 0); assert.equal(s2.potions[e], 0);
  assert.deepEqual(p.pearls, { bag: [], swallowed: null });
  assert.equal(p.stats.deaths, 1);
  assert.deepEqual(p.mast, masters, 'existing character mastery stays with its owner');
  assert.deepEqual(p.bag, []);
  assert.equal([...w.drops.values()].filter(d => d.kind === 'item').length, 1);
  assert.equal([...w.drops.values()].filter(d => d.kind === 'potion').length, 2);
  assert.equal(w.pearlLedger.get(pearl.uid).place, 'ground');
  assert.equal([...w.drops.values()].filter(d => d.kind === 'pearl' && d.pearl.uid === pearl.uid).length, 1);
  assert.equal(messages.filter(m => m.t === MSG.EVENT && m.ev.type === 'death').length, 1);
  const count = w.nextDrop;
  assert.equal(s.step(), true);
  assert.equal(w.nextDrop, count); assert.equal(p.stats.deaths, 1);
});

test('a lethal NPC burn defers reward rolls and produces the same kill once the boundary is free', (t) => {
  const { s, w, e, p, messages, gate } = setup(t), s2 = w.ecs;
  const enemy = w.spawnEnemy('sentinel', s2.x[e] + 4, s2.z[e], 0);
  assert.ok(enemy);
  s2.hp[enemy] = 1;
  w.burns = new Map([[enemy, { until: 100, next: 0, raw: 1000, by: e, pirateId: p.pirateId }]]);
  w.events.length = 0; w.profileDirty.clear(); messages.length = 0;
  const before = capture(w, p), xp = s2.xp[e];
  const held = gate.reserve({ uids: ['unrelated:kill'] });
  try {
    for (let i = 0; i < 5; i++) assert.equal(s.step(), false);
    assert.deepEqual(capture(w, p), before);
    assert.equal(s2.alive[enemy], 1); assert.equal(s2.hp[enemy], 1); assert.equal(s2.xp[e], xp);
  } finally { gate.release(held); }
  assert.equal(s.step(), true);
  assert.equal(s2.alive[enemy], 0);
  assert.equal(p.stats.kills, before.profile.stats.kills + 1);
  assert.notEqual(w.lootRng.state(), before.lootRng, 'real loot and elite pearl rolls ran on release');
  assert.ok(s2.xp[e] > xp || s2.level[e] > before.profile.lvl);
  const after = { kills: p.stats.kills, rng: w.lootRng.state(), nextPearl: w.nextPearl };
  assert.equal(s.step(), true);
  assert.deepEqual({ kills: p.stats.kills, rng: w.lootRng.state(), nextPearl: w.nextPearl }, after);
});

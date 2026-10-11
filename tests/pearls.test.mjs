import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { PEARL, newPearls } from '../src/data/pearls.js';
import { SKILLS } from '../src/data/weapons.js';
import { skillId, SLOT_COLS } from '../src/data/tattoos.js';
import { DT, tuning } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';
import { BTN, canStand } from '../src/sim/systems/movement.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { installInventory, newProfile, sanitizeProfile, attachProfile, detachProfile, stepDrops, lootOnKill, openChest } from '../src/sim/systems/inventory.js';
import { refreshStats } from '../src/sim/systems/stats.js';
import { givePearl, dropPearl, swallowPearl, spitPearl, spillPearls, leavePearl, transferPearl, rollPearl } from '../src/sim/systems/pearls.js';
import { sanitizeCmd, MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { trustSaves } from '../src/net/saves.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { AimCast } from '../src/client/aimcast.js';
import { map, A, incoming, clientAndServer } from './helpers.mjs';

function fixture(customMap = map) {
  const w = new World(GAME.seed, { map: customMap, server: true });
  installInventory(w, 'test-session');
  const join = (p = newProfile(), x = A.x, z = A.z + 5) => {
    const e = w.spawnPlayer({ x, z, facing: Math.PI / 2 });
    attachProfile(w, e, p); w.ecs.regenT[e] = 99; return e;
  };
  const e = join(), ecs = w.ecs;
  let seq = 0;
  const step = (c = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e] + 5, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...c });
    w.stepWorld();
  };
  const equip = () => { const q = givePearl(w, e); assert.ok(swallowPearl(w, e, q.uid)); ecs.cdG[e] = 0; return q; };
  return { w, e, ecs, join, step, equip, p: w.profiles.get(e) };
}

test('old saves gain an empty pearl bag; invalid kinds, UIDs and duplicate holdings are removed', () => {
  const raw = newProfile(); delete raw.pearls; delete raw.pirateId;
  assert.deepEqual(sanitizeProfile(raw).pearls, newPearls());
  raw.pearls = { swallowed: { uid: 'ok-1', kind: 'brasa' }, bag: [
    { uid: 'ok-1', kind: 'brasa' }, { uid: 'ok-2', kind: 'brasa', extra: 'ignored' },
    { uid: '<script>', kind: 'brasa' }, { uid: 'ok-3', kind: 'kraken' }, null,
  ] };
  raw.pirateId = '<not-valid>';
  const p = sanitizeProfile(raw);
  assert.equal(p.pirateId, '');
  assert.deepEqual(p.pearls, { swallowed: { uid: 'ok-1', kind: 'brasa' }, bag: [{ uid: 'ok-2', kind: 'brasa' }] });
  assert.deepEqual(trustSaves.load(trustSaves.store(p)).pearls, p.pearls);
});

test('G is a pearl-only slot: input survives sanitizing and aiming; Q/E loadouts stay separate', () => {
  const { w, e, ecs, p, equip } = fixture();
  assert.equal(skillId(ecs.skG[e]), 'none');
  assert.equal(sanitizeCmd({ prs: BTN.G, btn: BTN.G }).prs, BTN.G);
  assert.equal(new AimCast().step({ down: { g: true }, held: { g: true }, kinds: { g: 'dir' } }).prs, BTN.G);
  const lo = structuredClone(p.sk.lo); equip();
  assert.equal(ecs.elem[e], 1); assert.equal(skillId(ecs.skG[e]), 'comet');
  refreshStats(w, e);
  assert.equal(ecs.elem[e], 1, 'gear refresh keeps the pearl');
  assert.deepEqual(p.sk.lo, lo, 'G does not occupy a Q/E loadout entry');
  assert.ok(ecs[SLOT_COLS.g.cd]);
});

test('a swallowed pearl rejects spit and even an exact confirmed replacement until death', () => {
  const { w, e, ecs, p, equip } = fixture();
  const first = equip(), second = givePearl(w, e), before = structuredClone(p), power = ecs.elem[e];
  for (const confirmation of [undefined, 'stale-confirmation', first.uid]) {
    assert.equal(swallowPearl(w, e, second.uid, confirmation), false);
    assert.deepEqual(p, before);
  }
  assert.equal(spitPearl(w, e), false); assert.equal(ecs.elem[e], power);
  assert.equal(w.drops.size, 0); assert.deepEqual(p, before);
  assert.equal(w.events.at(-1).why, 'bound');
});

test('leaving an unconsumed pearl needs calm, including nearby active foes', () => {
  const { w, e, ecs, p } = fixture(); const q = givePearl(w, e);
  const foe = w.spawnEnemy('archer', ecs.x[e] + 6, ecs.z[e]);
  ecs.brain[foe].target = e; ecs.brain[foe].state = 'chase';
  assert.equal(leavePearl(w, e, q.uid), false);
  w.despawn(foe); ecs.regenT[e] = 1;
  assert.equal(leavePearl(w, e, q.uid), false);
  ecs.regenT[e] = 99;
  assert.ok(leavePearl(w, e, q.uid)); assert.equal(p.pearls.bag.length, 0);
});

test('death outside the Cala drops swallowed and carried pearls; another pirate takes them without swallowing', () => {
  const { w, e, ecs, p, join, equip } = fixture();
  assert.equal(w.lawless(e), false);
  const a = equip(), b = givePearl(w, e), other = join(newProfile(), ecs.x[e], ecs.z[e]);
  hurtPlayer(w, e, 9999, { x: ecs.x[e], z: ecs.z[e], kind: 'test', seq: 1, knock: 0 });
  assert.deepEqual(p.pearls, newPearls()); assert.equal(ecs.elem[e], 0);
  assert.equal(w.drops.size, 2);
  w.tick += 33; stepDrops(w);
  const q = w.profiles.get(other);
  assert.deepEqual(new Set(q.pearls.bag.map((v) => v.uid)), new Set([a.uid, b.uid]));
  assert.equal(q.pearls.swallowed, null); assert.equal(ecs.elem[other], 0);
  assert.equal(w.drops.size, 0);
});

test('an expired pearl returns to reachable beach ground with the same UID and no immediate auto-pickup', () => {
  const { w, e, ecs, equip } = fixture(); const q = equip();
  spillPearls(w, e);
  const d = [...w.drops.values()][0]; w.tick = d.t + 3 - (d.t % 3);
  stepDrops(w);
  const next = [...w.drops.values()][0];
  assert.notEqual(next.id, d.id); assert.equal(next.pearl.uid, q.uid);
  assert.ok(canStand(w, next.x, next.z, 0.2));
  assert.equal(map.zoneAt(next.x, next.z), 'playa');
  assert.ok(next.t > w.tick && next.pickAt > w.tick);
  assert.ok(w.events.some((ev) => ev.type === 'pearlReturn'));
  assert.equal(ecs.elem[e], 0);
});

test('old saved holdings cannot duplicate a live pearl or restore one already dropped or transferred', () => {
  const { w, e, p, join, equip, ecs } = fixture();
  const q = equip(), saved = structuredClone(p);
  const duplicate = join(structuredClone(saved), ecs.x[e] + 5, ecs.z[e]);
  assert.equal(w.profiles.get(duplicate).pearls.swallowed, null, 'live copy refused');
  spillPearls(w, e);
  detachProfile(w, e); w.despawn(e);
  const restored = join(saved);
  assert.equal(w.profiles.get(restored).pearls.swallowed, null, 'ground claim cannot be restored');
  assert.equal(w.pearlLedger.get(q.uid).place, 'ground');
});

test('disconnect and reconnect keeps a legitimate holding; session namespaces avoid UID collisions', () => {
  const { w, e, join, equip } = fixture(); const q = equip();
  const p = structuredClone(detachProfile(w, e)); w.despawn(e);
  const next = join(p);
  assert.equal(w.profiles.get(next).pearls.swallowed.uid, q.uid);
  assert.equal(w.ecs.elem[next], 1);
  assert.equal(w.pearlLedger.get(q.uid).entity, next);
  assert.notEqual(givePearl(w, next).uid, q.uid);
});

test('giving requires two live nearby calm pirates and bag space; a stale sender cannot reclaim the gift', () => {
  const { w, e, ecs, join, p } = fixture(); const q = givePearl(w, e), saved = structuredClone(p);
  const other = join(newProfile(), ecs.x[e] + 5, ecs.z[e]);
  assert.equal(transferPearl(w, e, q.uid, other), false, 'too far');
  ecs.x[other] = ecs.x[e] + 1;
  assert.ok(transferPearl(w, e, q.uid, other));
  assert.equal(p.pearls.bag.length, 0);
  assert.equal(w.profiles.get(other).pearls.bag[0].uid, q.uid);
  const replay = join(saved);
  assert.equal(w.profiles.get(replay).pearls.bag.length, 0);
  assert.equal(transferPearl(w, other, q.uid, replay), true);
  assert.equal(w.profiles.get(replay).pearls.bag[0].uid, q.uid);
});

test('a full pearl bag cannot pick up a public pearl', () => {
  const { w, e, ecs, p } = fixture();
  for (let i = 0; i < PEARL.bag; i++) assert.ok(givePearl(w, e));
  assert.equal(givePearl(w, e), null);
  const dropped = { uid: 'outside:1', kind: 'brasa' };
  dropPearl(w, dropped, ecs.x[e], ecs.z[e]); w.tick = 33; stepDrops(w);
  assert.equal(w.drops.size, 1); assert.equal(p.pearls.bag.length, PEARL.bag);
});

test('Cometa hits once along its path, clears parryables and leaves burning ground; cooldown prevents spam', () => {
  const { w, e, ecs, equip, step } = fixture(); equip(); ecs.god[e] = 1;
  const x = ecs.x[e], z = ecs.z[e], foe = w.spawnEnemy('dummy', x + 4, z);
  const bullet = incoming(w, e, 0, 4.5, 0.1);
  step({ prs: BTN.G });
  for (let i = 0; i < 34; i++) step();
  assert.ok(ecs.x[e] > x + 7.8, 'advances to the end of the rush');
  assert.equal(w.events.filter((v) => v.type === 'damage' && v.id === foe && v.kind === 'skill').length, 1, 'one direct strike');
  assert.ok(w.events.some((v) => v.type === 'destroy' && v.pid === bullet && v.skill === 'comet'));
  assert.ok(w.events.some((v) => v.type === 'burn' && v.id === foe));
  assert.ok(w.fireTrails.length > 0);
  const casts = w.events.filter((v) => v.type === 'cast' && v.skill === 'comet').length;
  step({ prs: BTN.G }); step();
  assert.equal(w.events.filter((v) => v.type === 'cast' && v.skill === 'comet').length, casts);
  assert.ok(ecs.cdG[e] > SKILLS.comet.cd - 1);
  for (let i = 0; i < 30; i++) step();
  assert.ok(w.events.some((v) => v.type === 'damage' && v.kind === 'burn'), 'burn ticks after half a second');
});

test('Cometa cannot rush through a collider or enter deep water', () => {
  const wall = { x: A.x + 3, z: A.z + 5, r: 0.8 };
  const custom = { ...map, groundAt: () => 0, queryColliders: () => [0], colliders: [wall], onDock: () => false };
  const { w, e, ecs, step, equip } = fixture(custom); equip();
  for (let i = 0; i < 40; i++) step({ prs: i ? 0 : BTN.G });
  assert.ok(ecs.x[e] <= wall.x - wall.r - tuning.player.radius + 0.01);
  assert.ok(canStand(w, ecs.x[e], ecs.z[e]));
  const water = { ...map, groundAt: (x) => x > A.x + 3 ? -2 : 0, queryColliders: () => [], colliders: [], onDock: () => false };
  const next = fixture(water); next.equip();
  for (let i = 0; i < 40; i++) next.step({ prs: i ? 0 : BTN.G });
  assert.ok(next.ecs.x[next.e] <= A.x + 3 && canStand(next.w, next.ecs.x[next.e], next.ecs.z[next.e]));
});

test('Brasa burns on every kit strike, does not recursively reapply itself, and never crits as a DOT', () => {
  const { w, e, ecs, equip, step } = fixture(); equip();
  const foe = w.spawnEnemy('dummy', ecs.x[e] + 2, ecs.z[e]);
  w.strike(foe, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], elem: 1, knock: 0 });
  const end = w.burns.get(foe).until;
  for (let i = 0; i < 190; i++) step();
  const dots = w.events.filter((v) => v.type === 'damage' && v.id === foe && v.kind === 'burn');
  assert.equal(dots.length, Math.floor(PEARL.burnTime / PEARL.burnEvery));
  assert.ok(dots.every((v) => !v.crit && v.elem === 1));
  assert.equal(w.events.filter((v) => v.type === 'burn').length, 1, 'ticks do not start new burns');
  assert.equal(w.burns.size, 0); assert.equal(end, Math.round(PEARL.burnTime / DT));
});

test('the water curse is deterministic, ignores armour, stops on a dry dock and can kill', () => {
  const custom = { ...map, groundAt: () => -0.2, onDock: () => false, queryColliders: () => [], colliders: [] };
  const { w, e, ecs, equip, step, p } = fixture(custom); equip(); ecs.def[e] = 1000;
  const hp = ecs.hp[e];
  for (let i = 0; i < 60; i++) step();
  assert.equal(ecs.hp[e], hp - Math.round(ecs.maxHp[e] * PEARL.waterDps / 2) * 2);
  w.map = { ...custom, onDock: () => true };
  const dryHp = ecs.hp[e]; for (let i = 0; i < 60; i++) step();
  assert.equal(ecs.hp[e], dryHp); assert.equal(ecs.waterT[e], 0);
  w.map = custom; ecs.hp[e] = 1;
  for (let i = 0; i < 30; i++) step();
  assert.equal(ecs.dead[e], 1); assert.equal(p.pearls.swallowed, null);
  assert.equal(w.drops.size, 1);
});

test('pearl drop rolls increase with the Marea, and elite/boss kills and chests use real public drops', () => {
  const { w, e, ecs } = fixture();
  const old = w.lootRng;
  const fixed = () => 0.035; fixed.int = () => 0; fixed.range = (a) => a;
  w.lootRng = fixed;
  assert.equal(rollPearl(w, PEARL.eliteChance, 1), null);
  assert.ok(rollPearl(w, PEARL.eliteChance, 3));
  const foe = w.spawnEnemy('sentinel', ecs.x[e] + 4, ecs.z[e]);
  w.lootRng = () => 0; w.lootRng.int = () => 0; w.lootRng.range = (a) => a;
  lootOnKill(w, foe, e, [e]);
  assert.ok([...w.drops.values()].some((d) => d.kind === 'pearl' && d.to === 0));
  const id = w.nextDrop++;
  w.drops.set(id, { id, kind: 'chest', to: e, x: ecs.x[e], z: ecs.z[e], contents: [], rarity: 2 });
  const before = [...w.drops.values()].filter((d) => d.kind === 'pearl').length;
  assert.ok(openChest(w, e, id));
  assert.equal([...w.drops.values()].filter((d) => d.kind === 'pearl').length, before + 1);
  w.lootRng = old;
});

test('Cometa predicts identically to the server and its authoritative echo does not duplicate feedback', () => {
  const { server, client, deliver, shown, se, ecs } = clientAndServer(() => [A.x - 8, A.z + 8]);
  ecs.regenT[se] = 99;
  const q = givePearl(server.world, se);
  assert.ok(swallowPearl(server.world, se, q.uid)); ecs.cdG[se] = 0;
  server.sendProfile(1, server.clients.get(1)); server.broadcastSnapshot(); deliver();
  for (let i = 0; i < 72; i++) {
    client.tickInput({ mx: 0, mz: 0, ax: ecs.x[se] + 5, az: ecs.z[se], btn: 0, prs: i === 0 ? BTN.G : 0 });
    server.step(); deliver();
    assert.equal(client.stats.predErr, 0);
  }
  const pe = client.pred.ecs, me = client.youLocal;
  for (const k of ['x', 'z', 'cdG', 'castK', 'elem']) assert.equal(pe[k][me], ecs[k][se], k);
  assert.equal(shown.filter((v) => v.type === 'cast' && v.skill === 'comet').length, 1);
  assert.ok(shown.some((v) => v.type === 'cometTrail' && v.predicted));
});

test('pearl commands preserve string UIDs; a late client sees and recovers a circulating pearl', () => {
  const queues = new Map(), clients = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send: (id, msg) => queues.get(id).push(structuredClone(msg)) });
  const deliver = () => {
    for (const { id, client } of clients) while (queues.get(id).length) {
      const m = queues.get(id).shift();
      if (m.t === MSG.SNAPSHOT) client.onSnapshot(m); else client.onMessage(m);
    }
  };
  const advance = (n = 16) => { for (let i = 0; i < n; i++) { server.step(); deliver(); } };
  const join = (id) => {
    queues.set(id, []); const seen = [];
    const transport = { onMessage() {}, onSnapshot() {}, start() {}, send: (m) => server.receive(id, m) };
    const client = new GameClient(transport, map, { emit: (type, ev) => { if (type === 'combat') seen.push(ev); } });
    clients.push({ id, client }); server.connect(id); client.join(`Pirata ${id}`, 2, 1); deliver();
    return { client, seen, e: server.clients.get(id).entity };
  };
  const a = join(1), w = server.world, s = w.ecs;
  assert.equal(a.client.entities.get(a.e).isYou, true, 'own spawn is known at welcome');
  assert.equal(a.client.pred.ecs.names[a.client.youLocal], 'Pirata 1');
  assert.equal(a.client.pred.ecs.skin[a.client.youLocal], 2);
  assert.equal(a.client.pred.ecs.weapon[a.client.youLocal], 1);
  s.regenT[a.e] = 99;
  const pearl = givePearl(w, a.e); advance();
  a.client.send({ t: MSG.CMD, type: 'pearl', op: 'swallow', uid: pearl.uid }); advance();
  assert.equal(a.client.profile.pearls.swallowed.uid, pearl.uid);
  a.client.send({ t: MSG.CMD, type: 'loadout', slot: 'g', id: 'tromba' });
  assert.equal(skillId(s.skG[a.e]), 'comet', 'loadout commands cannot replace a pearl power');
  const oldQ = skillId(s.skQ[a.e]);
  a.client.send({ t: MSG.CMD, type: 'loadout', slot: 'q', id: 'comet' });
  assert.equal(skillId(s.skQ[a.e]), oldQ, 'pearl powers cannot be assigned as tattoos');
  a.client.send({ t: MSG.CMD, type: 'pearl', op: 'spit' }); advance();
  assert.equal(a.client.profile.pearls.swallowed.uid, pearl.uid); assert.equal(w.drops.size, 0);
  hurtPlayer(w, a.e, 9999, { x: s.x[a.e], z: s.z[a.e], kind: 'test', seq: 1, knock: 0 }); advance();
  const d = [...w.drops.values()][0], b = join(2);
  assert.ok(b.seen.some((ev) => ev.type === 'loot' && ev.late && ev.me && ev.drops.some((q) => q.pearl?.uid === pearl.uid)), 'welcome precedes the private late-join loot event');
  s.x[b.e] = d.x; s.z[b.e] = d.z;
  for (let i = 0; i < 36; i++) { server.step(); deliver(); }
  assert.equal(b.client.profile.pearls.bag[0].uid, pearl.uid);
  assert.deepEqual(a.client.profile.pearls, newPearls());
  assert.equal(w.drops.size, 0);
});

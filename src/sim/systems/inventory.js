// Profiles, personal loot and the bag (M4, PLAN-M4.md §2.3). Server only: LocalServer installs it on its world.
//   world.profiles   entity → profile (what gets saved: level, XP, gold, potions, bag, equipment, masteries…)
//   world.drops      id → {id, to (owner entity), kind: item | gold | potion | quest | chest, x, z, t (expiry tick), …}
//   world.lootRng    the loot's own RNG (combat crits and AI keep theirs)
// Everything a player owns changes here and nowhere else; the owner hears about it through private events
// (`to`: LocalServer sends them to that client only) and profile messages.
import { DT, tuning } from '../../data/tuning.js';
import { ITEMS, BASES, SLOTS, STARTER, CONSUMABLES, QUEST_ITEMS, slotFits, RARITIES } from '../../data/items.js';
import { LOOT, DROPS } from '../../data/loot.js';
import { MASTERY, WEAPON_KINDS, weaponIndex } from '../../data/weapons.js';
import { ENEMIES, ENEMY_KINDS } from '../../data/enemies.js';
import { mulberry32 } from '../../core/rng.js';
import { rollItem, itemValue, itemScore, sanitizeItem } from '../items.js';
import { refreshStats, masteryXpToNext } from './stats.js';
import { setWeapon } from './skills.js';
import { C } from '../ecs.js';
import { LAWLESS } from '../../data/lawless.js';

export const PROFILE_VERSION = 1;
const NO_TIER = { ilvl: 0, rar: 0, gold: 1, xp: 1 };

// ---- Profiles -------------------------------------------------------------------------------------------------
export function newProfile({ weapon = 0 } = {}) {
  const p = {
    v: PROFILE_VERSION, lvl: 1, xp: 0, gold: 0, pot: CONSUMABLES.potion.start, uid: 1, bag: [], eq: {},
    mast: WEAPON_KINDS.map(() => [1, 0]), quests: {}, flags: { tut: 0, tier: 1, tierSel: 1 }, items: {}, cp: 'spawn',
    stats: { kills: 0, wins: 0, gold: 0, items: 0, pk: 0, deaths: 0 },
  };
  for (const s of SLOTS) p.eq[s] = null;
  p.eq.weapon = starterItem(p, WEAPON_KINDS[weapon] || 'sable');
  return p;
}
// A saved profile made safe (P3): known items in the right slots, numbers in range. null when it is not one
// of ours (an unknown version). The save is signed online, so this is about old builds and bugs, not cheats.
export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== PROFILE_VERSION) return null;
  const int = (v, lo, hi, d = lo) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);
  const num = (v, lo, hi, d = lo) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const p = newProfile();
  p.lvl = int(raw.lvl, 1, tuning.stats.maxLevel, 1);
  p.xp = num(raw.xp, 0, 1e6, 0);
  p.gold = int(raw.gold, 0, 1e9, 0);
  p.pot = int(raw.pot, 0, CONSUMABLES.potion.max, 0);
  const used = new Set();
  const keep = (it) => {
    const x = sanitizeItem(it);
    if (!x) return null;
    if (used.has(x.u)) x.u = 0; // re-numbered below
    used.add(x.u);
    return x;
  };
  p.bag = (Array.isArray(raw.bag) ? raw.bag : []).slice(0, ITEMS.bag).map(keep).filter(Boolean);
  const eq = raw.eq && typeof raw.eq === 'object' ? raw.eq : {};
  for (const slot of SLOTS) {
    const x = eq[slot] ? keep(eq[slot]) : null;
    p.eq[slot] = x && slotFits(BASES[x.b].slot, slot) ? x : null;
  }
  p.uid = Math.max(int(raw.uid, 1, 2 ** 31, 1), ...[...used].map((u) => u + 1));
  for (const it of [...p.bag, ...SLOTS.map((s) => p.eq[s])]) if (it && it.u === 0) it.u = p.uid++;
  if (!p.eq.weapon) p.eq.weapon = starterItem(p, 'sable');
  p.mast = WEAPON_KINDS.map((_, i) => {
    const m = Array.isArray(raw.mast) && Array.isArray(raw.mast[i]) ? raw.mast[i] : [1, 0];
    return [int(m[0], 1, MASTERY.max, 1), num(m[1], 0, 1e6, 0)];
  });
  if (raw.quests && typeof raw.quests === 'object') {
    for (const [id, q] of Object.entries(raw.quests)) {
      if (typeof id === 'string' && id.length <= 24 && Array.isArray(q)) p.quests[id] = [int(q[0], 0, 9, 0), int(q[1], 0, 1e6, 0)];
    }
  }
  const f = raw.flags && typeof raw.flags === 'object' ? raw.flags : {};
  p.flags.tut = int(f.tut, 0, 99, 0);
  p.flags.tier = int(f.tier, 1, 9, 1);
  p.flags.tierSel = int(f.tierSel, 1, p.flags.tier, 1);
  if (raw.items && typeof raw.items === 'object') for (const k in QUEST_ITEMS) if (raw.items[k]) p.items[k] = int(raw.items[k], 0, 999, 0);
  p.cp = typeof raw.cp === 'string' && raw.cp.length <= 16 ? raw.cp : 'spawn';
  if (raw.stats && typeof raw.stats === 'object') for (const k in p.stats) p.stats[k] = int(raw.stats[k], 0, 1e9, 0);
  return p;
}

// A kit's common level-1 weapon (from a fresh profile or a rack). Starters are worth nothing.
const starterItem = (p, kit) => ({ u: p.uid++, b: STARTER[kit] || STARTER.sable, r: 0, l: 1, a: [], s: 1 });
export const kitOf = (item) => (item && BASES[item.b] && BASES[item.b].weapon) || 'sable';

export function installInventory(world) {
  world.profiles = new Map();
  world.drops = new Map();
  world.nextDrop = 1;
  world.profileDirty = new Set();
  world.lootRng = mulberry32((world.seed ^ 0x10075ed) >>> 0);
  world.onXp = (e, n) => masteryXp(world, e, n);
  world.onRack = (e, w) => rackWeapon(world, e, WEAPON_KINDS[w]);
  world.onDeath = (e, by) => spillOnDeath(world, e, by);
  return world;
}

const dirty = (world, e) => world.profileDirty && world.profileDirty.add(e);
const profileOf = (world, e) => (world.profiles ? world.profiles.get(e) : null);

// A player enters with a profile: its level, XP, potions, weapon kit, numbers, and its last checkpoint.
export function attachProfile(world, e, p) {
  const ecs = world.ecs;
  world.profiles.set(e, p);
  ecs.level[e] = Math.max(1, p.lvl | 0);
  ecs.xp[e] = p.xp;
  ecs.potions[e] = p.pot;
  ecs.weapon[e] = weaponIndex(kitOf(p.eq.weapon));
  refreshStats(world, e);
  ecs.hp[e] = ecs.maxHp[e];
  const cp = world.map.checkpoints[p.cp];
  if (cp && p.cp !== 'spawn') {
    ecs.cpX[e] = cp.x; ecs.cpZ[e] = cp.z;
    ecs.x[e] = cp.x; ecs.z[e] = cp.z; ecs.y[e] = world.map.groundAt(cp.x, cp.z);
  }
  dirty(world, e);
}

// What the ECS holds back into the profile (before it is sent or saved).
export function syncProfile(world, e) {
  const p = profileOf(world, e), ecs = world.ecs;
  if (!p || !ecs.alive[e]) return p;
  p.lvl = ecs.level[e]; p.xp = Math.round(ecs.xp[e] * 100) / 100; p.pot = ecs.potions[e];
  for (const [id, c] of Object.entries(world.map.checkpoints)) if (Math.abs(c.x - ecs.cpX[e]) < 1e-6 && Math.abs(c.z - ecs.cpZ[e]) < 1e-6) p.cp = id;
  return p;
}

// The player leaves: its drops go with it. Returns the final profile.
export function detachProfile(world, e) {
  const p = syncProfile(world, e);
  if (world.profiles) world.profiles.delete(e);
  if (world.drops) for (const [id, d] of world.drops) if (d.to === e) world.drops.delete(id);
  if (world.profileDirty) world.profileDirty.delete(e);
  return p;
}

// ---- Mastery -------------------------------------------------------------------------------------------------
// All XP also feeds the equipped weapon's mastery (world.onXp, from gainXp).
export function masteryXp(world, e, n) {
  const p = profileOf(world, e), ecs = world.ecs;
  if (!p || !(n > 0)) return;
  const k = ecs.weapon[e] | 0, m = p.mast[k] || (p.mast[k] = [1, 0]);
  if (m[0] >= MASTERY.max) return;
  m[1] = Math.round((m[1] + n) * 100) / 100;
  while (m[0] < MASTERY.max && m[1] >= masteryXpToNext(m[0])) {
    m[1] = Math.round((m[1] - masteryXpToNext(m[0])) * 100) / 100;
    m[0] += 1;
    refreshStats(world, e);
    const opens = Object.keys(MASTERY.unlock).find((s) => MASTERY.unlock[s] === m[0]) || '';
    const pas = (MASTERY.passives[WEAPON_KINDS[k]] || []).find((q) => q.at === m[0]);
    world.emit({ type: 'mastery', to: e, e, kit: k, level: m[0], opens, passive: pas ? pas.id : '' });
  }
  if (m[0] >= MASTERY.max) m[1] = 0;
  dirty(world, e);
}

// ---- Drops ---------------------------------------------------------------------------------------------------
// A new drop for `to` near (x, z), scattered with the loot RNG (not into deep water). to 0: a public drop (M4.5:
// the Cala Calavera's), whoever walks over it first. o: {scatter: [r0, r1], life: s}.
function addDrop(world, to, kind, x, z, extra, out, o = {}) {
  const rng = world.lootRng, map = world.map, [r0, r1] = o.scatter || DROPS.scatter;
  let dx = x, dz = z;
  for (let k = 0; k < 4; k++) {
    const a = rng() * Math.PI * 2, r = r0 + (r1 - r0) * rng();
    const tx = x + Math.sin(a) * r, tz = z + Math.cos(a) * r;
    if (map.groundAt(tx, tz) > -0.3) { dx = tx; dz = tz; break; }
  }
  const d = { id: world.nextDrop++, to, kind, x: dx, z: dz, t: world.tick + Math.round((o.life || DROPS.life) / DT), ...extra };
  world.drops.set(d.id, d);
  if (out) out.push(d);
  return d;
}
// What a client needs to draw a drop (public ones: who dropped it, if a pirate did).
export const dropView = (d) => {
  const v = { id: d.id, kind: d.kind, x: d.x, z: d.z };
  if (d.item) v.item = d.item;
  if (d.n) v.n = d.n;
  if (d.q) v.q = d.q;
  if (!d.to) { v.pub = 1; if (d.fromName) v.from = d.fromName; }
  return v;
};
function announce(world, to, list, fx, fz) {
  if (list.length) world.emit({ type: 'loot', to, e: to, fx, fz, drops: list.map(dropView) });
}
// Public drops go to everyone (no `to`).
function announcePublic(world, list, fx, fz, extra = {}) {
  if (list.length) world.emit({ type: 'loot', pub: 1, fx, fz, drops: list.map(dropView), ...extra });
}
// Every public drop on the ground (a pirate who joins now sees them too).
export const publicDrops = (world) => (world.drops ? [...world.drops.values()].filter((d) => !d.to).map(dropView) : []);
const lawlessAt = (world, x, z) => !!world.map.lawlessAt && world.map.lawlessAt(x, z);

// An enemy died: everyone with a right to its XP rolls its loot table for themselves.
// Inside the Cala Calavera (M4.5) the table is rolled once (the killer's, or the first pirate's with a right to
// it) and what falls is public; quest items stay personal.
export function lootOnKill(world, enemy, by, players) {
  const ecs = world.ecs, kind = ENEMY_KINDS[ecs.enemy[enemy]], def = ENEMIES[kind], T = LOOT[kind];
  if (!T || !world.profiles) return;
  const rng = world.lootRng, tier = (ecs.brain[enemy] && ecs.brain[enemy].tier) || NO_TIER;
  const x = ecs.x[enemy], z = ecs.z[enemy];
  const pub = lawlessAt(world, x, z), roller = players.includes(by) ? by : players.find((pl) => profileOf(world, pl));
  const shared = [], o = pub ? { life: LAWLESS.publicLife } : {};
  for (const pl of players) {
    const p = profileOf(world, pl);
    if (!p) continue;
    p.stats.kills++;
    const list = [];
    if (!pub || pl === roller) {
      const to = pub ? 0 : pl, out = pub ? shared : list;
      if (T.gold && rng() < T.gold[0]) {
        const n = Math.max(1, Math.round((T.gold[1] + Math.floor(rng() * (T.gold[2] - T.gold[1] + 1))) * ecs.goldMul[pl] * tier.gold));
        addDrop(world, to, 'gold', x, z, { n }, out, o);
      }
      if (T.item && rng() < T.item) addDrop(world, to, 'item', x, z, { item: rollItem(rng, { lvl: (def.level || 1) + tier.ilvl, uid: p.uid++, rarityBonus: tier.rar }) }, out, o);
      if (T.potion && rng() < T.potion) addDrop(world, to, 'potion', x, z, {}, out, o);
      if (T.gear) for (let k = 0; k < T.gear.n; k++) addDrop(world, to, 'item', x, z, { item: rollItem(rng, { lvl: (def.level || 1) + tier.ilvl, uid: p.uid++, rarityBonus: tier.rar + T.gear.rar, minRarity: T.gear.min[k] || 0 }) }, out, o);
    }
    if (T.quest && world.questWants) for (const q in T.quest) if (world.questWants(pl, q) && rng() < T.quest[q]) addDrop(world, pl, 'quest', x, z, { q }, list);
    announce(world, pl, list, x, z);
    // Vida al matar: the killer only.
    if (pl === by && ecs.onKill[pl] > 0 && ecs.dead[pl] <= 0) ecs.hp[pl] = Math.min(ecs.maxHp[pl], ecs.hp[pl] + ecs.onKill[pl]);
  }
  announcePublic(world, shared, x, z);
}

// A pirate fell inside the Cala Calavera (M4.5): everything they wear (a starter weapon aside) and carry, and
// their potions, spill around the body for whoever gets there first. The gold is safe. Returns how many drops.
export function spillOnDeath(world, e, by = 0) {
  const p = profileOf(world, e), ecs = world.ecs;
  if (!p || !lawlessAt(world, ecs.x[e], ecs.z[e])) return 0;
  const x = ecs.x[e], z = ecs.z[e], kit = kitOf(p.eq.weapon), items = [];
  for (const s of SLOTS) {
    const it = p.eq[s];
    if (!it || (s === 'weapon' && it.s)) continue;
    items.push(it);
    p.eq[s] = null;
  }
  items.push(...p.bag);
  p.bag = [];
  if (!p.eq.weapon) p.eq.weapon = starterItem(p, kit); // same kit: the mastery you earned stays usable
  const pots = Math.max(0, ecs.potions[e] | 0);
  ecs.potions[e] = 0;
  const list = [], o = { scatter: LAWLESS.spill.scatter, life: LAWLESS.spill.life }, from = { fromName: ecs.names[e], from: e };
  for (const it of items) addDrop(world, 0, 'item', x, z, { item: it, ...from }, list, o);
  for (let k = 0; k < pots; k++) addDrop(world, 0, 'potion', x, z, { ...from }, list, o);
  p.stats.deaths++;
  const pk = by && by !== e ? profileOf(world, by) : null;
  if (pk) { pk.stats.pk++; dirty(world, by); }
  refreshStats(world, e);
  world.emit({ type: 'spill', to: e, e, n: items.length, pot: pots, x, z, by });
  announcePublic(world, list, x, z, { spill: e });
  dirty(world, e);
  return list.length;
}

// The boss fell: a chest for every pirate in the fight (dead ones too), around the rune circle.
export function bossChests(world, enc, crew) {
  if (!world.profiles) return;
  const ecs = world.ecs, rng = world.lootRng, Cc = DROPS.chest, tier = enc.tierDef || NO_TIER;
  const mine = crew.filter((pl) => profileOf(world, pl));
  mine.forEach((pl, i) => {
    const p = profileOf(world, pl), lvl = Math.max(ENEMIES.hellfire.level || 1, ecs.level[pl]) + tier.ilvl;
    let r = Cc.minRarity;
    for (let k = 0; k < Cc.upRolls; k++) if (r < RARITIES.length - 1 && rng() < Cc.upChance) r++;
    const contents = [{ kind: 'item', item: rollItem(rng, { lvl, rarity: r, uid: p.uid++ }) }];
    for (let k = 0; k < Cc.items; k++) contents.push({ kind: 'item', item: rollItem(rng, { lvl, uid: p.uid++, rarityBonus: tier.rar }) });
    contents.push({ kind: 'gold', n: Math.round((Cc.gold[0] + Math.floor(rng() * (Cc.gold[1] - Cc.gold[0] + 1))) * ecs.goldMul[pl] * tier.gold) });
    for (let k = 0; k < Cc.potions; k++) contents.push({ kind: 'potion' });
    const a = (i / Math.max(1, mine.length)) * Math.PI * 2 + 0.6, x = enc.cx + Math.sin(a) * 2.2, z = enc.cz + Math.cos(a) * 2.2;
    const d = { id: world.nextDrop++, to: pl, kind: 'chest', x, z, t: world.tick + Math.round(DROPS.life * 2 / DT), contents, rarity: r };
    world.drops.set(d.id, d);
    world.emit({ type: 'loot', to: pl, e: pl, fx: x, fz: z, drops: [{ id: d.id, kind: 'chest', x, z, r }] });
    p.stats.wins++;
    dirty(world, pl);
  });
}

// F next to your chest: it spills what it holds around it.
export function openChest(world, e, id) {
  const d = world.drops && world.drops.get(id), ecs = world.ecs;
  if (!d || d.to !== e || d.kind !== 'chest' || ecs.dead[e] > 0) return false;
  if (Math.hypot(ecs.x[e] - d.x, ecs.z[e] - d.z) > DROPS.openR) return false;
  world.drops.delete(id);
  world.emit({ type: 'unloot', to: e, e, ids: [id], why: 'open' });
  const list = [];
  for (const c of d.contents) addDrop(world, e, c.kind, d.x, d.z, c.item ? { item: c.item } : c.n ? { n: c.n } : {}, list);
  world.emit({ type: 'chest', to: e, e, id, x: d.x, z: d.z, r: d.rarity });
  announce(world, e, list, d.x, d.z);
  return true;
}

// Every few ticks: walk over your drops (or a public one) to take them; old ones fade.
export function stepDrops(world) {
  if (!world.drops || !world.drops.size || world.tick % 3) return;
  const ecs = world.ecs, gone = new Map(), pubGone = [];
  for (const [id, d] of world.drops) {
    if (d.to && (!ecs.alive[d.to] || !(ecs.mask[d.to] & C.PLAYER))) { world.drops.delete(id); continue; }
    if (world.tick > d.t) {
      world.drops.delete(id);
      if (d.to) (gone.get(d.to) || gone.set(d.to, []).get(d.to)).push(id); else pubGone.push(id);
      continue;
    }
    if (d.kind === 'chest') continue;
    if (d.to) {
      if (ecs.dead[d.to] <= 0 && Math.hypot(ecs.x[d.to] - d.x, ecs.z[d.to] - d.z) <= DROPS.pickR) pickUp(world, d, d.to);
      continue;
    }
    // Public: the first pirate standing on it (that can carry it).
    for (const e of world.profiles.keys()) {
      if (!ecs.alive[e] || ecs.dead[e] > 0 || Math.hypot(ecs.x[e] - d.x, ecs.z[e] - d.z) > DROPS.pickR) continue;
      if (pickUp(world, d, e)) break;
    }
  }
  for (const [to, ids] of gone) world.emit({ type: 'unloot', to, e: to, ids, why: 'expire' });
  if (pubGone.length) world.emit({ type: 'unloot', pub: 1, ids: pubGone, why: 'expire' });
}

// e takes drop d (its owner, or anyone for a public one). False when it cannot carry it (and is told once).
function pickUp(world, d, e) {
  const ecs = world.ecs, p = profileOf(world, e);
  if (!p) return false;
  const full = (what) => {
    const told = d.full || (d.full = new Set());
    if (!told.has(e)) { told.add(e); world.emit({ type: 'full', to: e, e, what }); }
    return false;
  };
  if (d.kind === 'gold') { p.gold += d.n; p.stats.gold += d.n; }
  else if (d.kind === 'potion') {
    if (ecs.potions[e] >= CONSUMABLES.potion.max) return full('potion');
    ecs.potions[e] += 1;
  } else if (d.kind === 'item') {
    if (p.bag.length >= ITEMS.bag) return full('bag');
    if (!d.to) d.item.u = p.uid++; // someone else's numbering: yours now
    p.bag.push(d.item);
    p.stats.items++;
  } else if (d.kind === 'quest') p.items[d.q] = (p.items[d.q] || 0) + 1;
  world.drops.delete(d.id);
  const ev = { type: 'pickup', to: e, e, id: d.id, kind: d.kind, x: d.x, z: d.z, gold: p.gold, pot: ecs.potions[e] };
  if (d.item) ev.item = d.item;
  if (d.n) ev.n = d.n;
  if (d.q) { ev.q = d.q; ev.have = p.items[d.q]; }
  if (!d.to) { ev.pub = 1; if (d.from === e) ev.back = 1; } // back: your own spilled gear, recovered
  world.emit(ev);
  if (!d.to) world.emit({ type: 'unloot', pub: 1, ids: [d.id], why: 'pick', by: e });
  if (world.onPickup) world.onPickup(e, d);
  dirty(world, e);
  return true;
}

// ---- The bag ------------------------------------------------------------------------------------------------
function gear(world, e, slot, uid) {
  refreshStats(world, e);
  dirty(world, e);
  world.emit({ type: 'gear', to: e, e, slot, uid });
}

// Put on an item from the bag (what was there goes back into its place). Rings: the first free hoop.
export function equipItem(world, e, uid, slot) {
  const p = profileOf(world, e), ecs = world.ecs;
  if (!p || ecs.dead[e] > 0) return false;
  const i = p.bag.findIndex((it) => it.u === uid);
  if (i < 0) return false;
  const item = p.bag[i], B = BASES[item.b];
  let s = slot && slotFits(B.slot, slot) ? slot : B.slot;
  if (B.slot === 'ring' && !(slot && slotFits('ring', slot))) s = !p.eq.ring1 ? 'ring1' : !p.eq.ring2 ? 'ring2' : 'ring1';
  const old = p.eq[s];
  p.eq[s] = item;
  if (old) p.bag[i] = old; else p.bag.splice(i, 1);
  if (s === 'weapon') {
    const w = weaponIndex(kitOf(item));
    if (w !== ecs.weapon[e]) setWeapon(world, e, w, 0);
  }
  gear(world, e, s, uid);
  return true;
}

// Take off into the bag (the weapon always stays: you need one).
export function unequipItem(world, e, slot) {
  const p = profileOf(world, e);
  if (!p || slot === 'weapon' || !SLOTS.includes(slot) || !p.eq[slot] || p.bag.length >= ITEMS.bag) return false;
  const uid = p.eq[slot].u;
  p.bag.push(p.eq[slot]);
  p.eq[slot] = null;
  gear(world, e, slot, uid);
  return true;
}

// Break an item from the bag for a share of its value (selling to Tía Perla pays it all).
export function salvageItem(world, e, uid, share = ITEMS.salvage) {
  const p = profileOf(world, e);
  if (!p) return 0;
  const i = p.bag.findIndex((it) => it.u === uid);
  if (i < 0) return 0;
  const item = p.bag.splice(i, 1)[0];
  const v = itemValue(item), g = v > 0 ? Math.max(1, Math.round(v * share)) : 0;
  p.gold += g;
  world.emit({ type: 'sold', to: e, e, uid, gold: g, total: p.gold, share });
  dirty(world, e);
  return g;
}

// A rack swapped the kit (the sim did it, predicted): wear the best weapon of that kit you carry, or the
// rack's common one. With a full bag the old weapon is left at your feet (nothing is ever lost).
export function rackWeapon(world, e, kit) {
  const p = profileOf(world, e), ecs = world.ecs;
  if (!p || kitOf(p.eq.weapon) === kit) return;
  let best = -1, bs = -Infinity;
  p.bag.forEach((it, i) => { if (BASES[it.b].weapon === kit && itemScore(it) > bs) { bs = itemScore(it); best = i; } });
  const old = p.eq.weapon;
  if (best >= 0) { p.eq.weapon = p.bag[best]; p.bag[best] = old; }
  else {
    p.eq.weapon = starterItem(p, kit);
    if (p.bag.length < ITEMS.bag) p.bag.push(old);
    else announce(world, e, [addDrop(world, e, 'item', ecs.x[e], ecs.z[e], { item: old })], ecs.x[e], ecs.z[e]);
  }
  gear(world, e, 'weapon', p.eq.weapon.u);
}

// F4 / tools: a gift of gear.
export function giveItem(world, e, item) {
  const p = profileOf(world, e);
  if (!p || p.bag.length >= ITEMS.bag) return null;
  item.u = p.uid++;
  p.bag.push(item);
  dirty(world, e);
  world.emit({ type: 'pickup', to: e, e, id: 0, kind: 'item', item, gold: p.gold, pot: world.ecs.potions[e] });
  return item;
}

export function setMastery(world, e, level) {
  const p = profileOf(world, e);
  if (!p) return;
  for (const m of p.mast) { m[0] = Math.max(1, Math.min(MASTERY.max, level | 0)); m[1] = 0; }
  refreshStats(world, e);
  dirty(world, e);
}

// ---- Rewards (quests, the vendor) ------------------------------------------------------------------------
export const markProfile = (world, e) => dirty(world, e);

// An item for e: into the bag, or at its feet when the bag is full (nothing is ever lost).
export function stashItem(world, e, item) {
  const p = profileOf(world, e), ecs = world.ecs;
  if (!p) return false;
  item.u = p.uid++;
  if (p.bag.length < ITEMS.bag) {
    p.bag.push(item);
    p.stats.items++;
    world.emit({ type: 'pickup', to: e, e, id: 0, kind: 'item', item, gold: p.gold, pot: ecs.potions[e], reward: 1 });
  } else announce(world, e, [addDrop(world, e, 'item', ecs.x[e], ecs.z[e], { item })], ecs.x[e], ecs.z[e]);
  dirty(world, e);
  return true;
}

// Potions for e up to the most you can carry; the rest wait at its feet.
export function givePotions(world, e, n) {
  const ecs = world.ecs, max = CONSUMABLES.potion.max, list = [];
  for (let k = 0; k < n; k++) {
    if (ecs.potions[e] < max) ecs.potions[e] += 1;
    else addDrop(world, e, 'potion', ecs.x[e], ecs.z[e], {}, list);
  }
  announce(world, e, list, ecs.x[e], ecs.z[e]);
  dirty(world, e);
}

// F4 / tools: put a drop for e on the ground near it (screenshots, tests).
export function spawnDrop(world, e, kind, extra = {}) {
  const ecs = world.ecs, x = ecs.x[e] + Math.sin(ecs.facing[e]) * 2.5, z = ecs.z[e] + Math.cos(ecs.facing[e]) * 2.5;
  if (kind === 'chest') {
    const d = { id: world.nextDrop++, to: e, kind: 'chest', x, z, t: world.tick + Math.round(DROPS.life / DT), contents: [{ kind: 'gold', n: 50 }, { kind: 'item', item: extra.item }], rarity: extra.item ? extra.item.r : 2 };
    world.drops.set(d.id, d);
    world.emit({ type: 'loot', to: e, e, fx: x, fz: z, drops: [{ id: d.id, kind: 'chest', x, z, r: d.rarity }] });
    return d;
  }
  const list = [];
  const d = addDrop(world, e, kind, x, z, extra, list);
  announce(world, e, list, ecs.x[e], ecs.z[e]);
  return d;
}

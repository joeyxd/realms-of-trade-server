// Quests, talking to people and Tía Perla's stall (M4, PLAN-M4.md §2.5). Server only, over the profiles of
// systems/inventory.js. Progress comes from the world (kills, zones, wins, pickups) and from `cmd`s (talk,
// accept, hand in, buy, sell); the player hears about it through private `quest` / `talk` / `bought` events.
import { QUESTS, QUEST_IDS, QST, goalCount, NPC_TALK } from '../../data/quests.js';
import { CONSUMABLES } from '../../data/items.js';
import { ENEMY_KINDS } from '../../data/enemies.js';
import { rollItem } from '../items.js';
import { gainXp } from './combat.js';
import { stashItem, givePotions, markProfile, salvageItem } from './inventory.js';

export const TALK_R = 3.5;
export const SHOP_R = 4.5;
const profileOf = (world, e) => (world.profiles ? world.profiles.get(e) : null);
const stateOf = (p, id) => (p.quests[id] ? p.quests[id][0] : QST.NONE);

// The NPC `id` ('captain', 'vendor') if e stands within r of it, else 0.
export function npcNear(world, e, id, r = TALK_R) {
  const n = world.npcs && world.npcs.get(id), ecs = world.ecs;
  return n && ecs.alive[n] && Math.hypot(ecs.x[n] - ecs.x[e], ecs.z[n] - ecs.z[e]) <= r ? n : 0;
}
const npcIdOf = (world, ent) => { if (world.npcs) for (const [id, n] of world.npcs) if (n === ent) return id; return ''; };

function emitQuest(world, e, id, st, extra = {}) {
  const p = profileOf(world, e), s = p.quests[id] || [0, 0];
  world.emit({ type: 'quest', to: e, e, id, st, n: s[1], of: goalCount(QUESTS[id]), ...extra });
  markProfile(world, e);
}

function start(world, e, id) {
  const p = profileOf(world, e);
  p.quests[id] = [QST.ACTIVE, 0];
  emitQuest(world, e, id, 'start');
  // Already there / already carrying them.
  const g = QUESTS[id].goal;
  if (g.kind === 'collect') questEvent(world, e, 'collect', { item: g.item });
  if (g.kind === 'zone' && world.zoneOf && world.zoneOf.get(e) === g.zone) questEvent(world, e, 'zone', { zone: g.zone });
}

// A player enters: a fresh profile starts the chain; a loaded one picks up a chain step that should be running.
export function startQuests(world, e) {
  const p = profileOf(world, e);
  if (!p || !p.quests) return;
  if (!Object.keys(p.quests).length) { start(world, e, 'tierra'); return; }
  for (const id of QUEST_IDS) {
    const nx = QUESTS[id].next;
    if (nx && stateOf(p, id) === QST.DONE && QUESTS[nx].auto && !p.quests[nx]) start(world, e, nx);
  }
}

// Something happened that a quest may want: kind zone {zone} · talk {npc} · kill {enemy, enc} · win {enc} ·
// collect {item}.
export function questEvent(world, e, kind, o) {
  const p = profileOf(world, e);
  if (!p || !p.quests) return;
  for (const id of QUEST_IDS) {
    const q = QUESTS[id], s = p.quests[id], g = q.goal;
    if (!s || s[0] !== QST.ACTIVE || g.kind !== kind) continue;
    if (kind === 'zone' && g.zone !== o.zone) continue;
    if (kind === 'talk' && g.npc !== o.npc) continue;
    if (kind === 'kill' && ((g.enemy && !g.enemy.includes(o.enemy)) || (g.enc && g.enc !== o.enc))) continue;
    if (kind === 'win' && g.enc !== o.enc) continue;
    if (kind === 'collect' && g.item !== o.item) continue;
    const before = s[1];
    s[1] = kind === 'collect' ? Math.min(goalCount(q), p.items[g.item] || 0) : Math.min(goalCount(q), s[1] + 1);
    if (s[1] >= goalCount(q)) reach(world, e, id);
    else if (s[1] !== before) emitQuest(world, e, id, 'progress');
  }
}

function reach(world, e, id) {
  const p = profileOf(world, e);
  if (QUESTS[id].turnin) { p.quests[id][0] = QST.READY; emitQuest(world, e, id, 'ready'); }
  else finish(world, e, id);
}

function finish(world, e, id) {
  const p = profileOf(world, e), q = QUESTS[id], R = q.reward || {}, ecs = world.ecs;
  if (q.goal.kind === 'collect') p.items[q.goal.item] = Math.max(0, (p.items[q.goal.item] || 0) - goalCount(q));
  p.quests[id] = [QST.DONE, 0];
  emitQuest(world, e, id, 'done', { reward: R });
  if (R.xp) gainXp(world, e, R.xp);
  if (R.gold) p.gold += R.gold;
  if (R.potions) givePotions(world, e, R.potions);
  if (R.item) stashItem(world, e, rollItem(world.lootRng, { lvl: ecs.level[e], slot: R.item.slot, minRarity: R.item.rarity || 0 }));
  if (q.next && QUESTS[q.next].auto && !p.quests[q.next]) start(world, e, q.next);
  markProfile(world, e);
}

// Could this player take quest id from its giver right now?
export function canAccept(p, id) {
  const q = QUESTS[id], s = stateOf(p, id);
  return !!q && !!q.giver && (!q.requires || stateOf(p, q.requires) === QST.DONE) && (s === QST.NONE || (q.repeat && s === QST.DONE));
}

export function acceptQuest(world, e, id) {
  const p = profileOf(world, e), q = QUESTS[id];
  if (!p || !q || !canAccept(p, id) || !npcNear(world, e, q.giver)) return false;
  start(world, e, id);
  return true;
}

export function turnInQuest(world, e, id) {
  const p = profileOf(world, e), q = QUESTS[id];
  if (!p || !q || !q.turnin || stateOf(p, id) !== QST.READY || !npcNear(world, e, q.turnin)) return false;
  finish(world, e, id);
  return true;
}

// F next to someone: what they have for you (quests to take, quests to hand in, the shop).
export function talkTo(world, e, npcEnt) {
  const p = profileOf(world, e), id = npcIdOf(world, npcEnt);
  if (!p || !id || !npcNear(world, e, id)) return false;
  questEvent(world, e, 'talk', { npc: id });
  const offer = QUEST_IDS.filter((q) => QUESTS[q].giver === id && canAccept(p, q));
  const ready = QUEST_IDS.filter((q) => QUESTS[q].turnin === id && stateOf(p, q) === QST.READY);
  world.emit({ type: 'talk', to: e, e, npc: id, ent: npcEnt, offer, ready, shop: NPC_TALK[id] && NPC_TALK[id].shop ? 1 : 0 });
  return true;
}

// Quest items only drop while a quest still wants them.
export function questWants(world, e, item) {
  const p = profileOf(world, e);
  if (!p || !p.quests) return false;
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (q.goal.kind === 'collect' && q.goal.item === item && stateOf(p, id) === QST.ACTIVE && (p.items[item] || 0) < goalCount(q)) return true;
  }
  return false;
}

// Hooks from the world: kills (everyone with a right to the XP), wins (the whole crew), zones (every 30 ticks).
export function questKill(world, enemy, players) {
  const ecs = world.ecs, kind = ENEMY_KINDS[ecs.enemy[enemy]], b = ecs.brain[enemy];
  for (const pl of players) questEvent(world, pl, 'kill', { enemy: kind, enc: b && b.enc ? b.enc : '' });
}
export function questWin(world, enc, crew) { for (const pl of crew) questEvent(world, pl, 'win', { enc: enc.id }); }
export function zoneSweep(world) {
  if (!world.profiles || world.tick % 30) return;
  if (!world.zoneOf) world.zoneOf = new Map();
  const ecs = world.ecs;
  for (const e of world.profiles.keys()) {
    if (!ecs.alive[e]) continue;
    const z = world.map.zoneAt(ecs.x[e], ecs.z[e]);
    if (z === world.zoneOf.get(e)) continue;
    world.zoneOf.set(e, z);
    questEvent(world, e, 'zone', { zone: z });
  }
}

// ---- Tía Perla -----------------------------------------------------------------------------------------------
// buy 'potion' (25 oro) or 'crate' (120: an item of your level); sell an item from the bag for all its worth.
export function buy(world, e, what) {
  const p = profileOf(world, e), ecs = world.ecs, C = CONSUMABLES[what];
  if (!p || !C || !C.price || !npcNear(world, e, 'vendor', SHOP_R)) return false;
  const fail = (why) => { world.emit({ type: 'bought', to: e, e, what, fail: why, gold: p.gold }); return false; };
  if (p.gold < C.price) return fail('gold');
  if (what === 'potion' && ecs.potions[e] >= C.max) return fail('max');
  if (what === 'crate' && p.bag.length >= 24) return fail('bag');
  p.gold -= C.price;
  let item;
  if (what === 'potion') ecs.potions[e] += 1;
  else { item = rollItem(world.lootRng, { lvl: ecs.level[e] }); stashItem(world, e, item); }
  world.emit({ type: 'bought', to: e, e, what, gold: p.gold, pot: ecs.potions[e], ...(item ? { item } : {}) });
  markProfile(world, e);
  return true;
}
export function sell(world, e, uid) {
  if (!npcNear(world, e, 'vendor', SHOP_R)) return 0;
  return salvageItem(world, e, uid, 1);
}

// The beach tutorial is the client's, but how far you got is saved.
export function setTutorial(world, e, i) {
  const p = profileOf(world, e);
  if (!p) return;
  const v = Math.max(0, Math.min(20, i | 0));
  if (v > p.flags.tut) { p.flags.tut = v; markProfile(world, e); }
}

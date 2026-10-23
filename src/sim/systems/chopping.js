// TA02: server-authoritative hold-to-chop. One `chop` command per swing, optional `crit`, palm HP by size, a fallen palm leaves
// a log pile that `pickup` loads. All chop state lives in w.resources.chop; palm nodes only change rev/readyTick at the fell.
import { DT } from '../../data/tuning.js';
import { HARVEST, sanitizeTools } from '../../data/resources.js';
import { AXES, PALM_SIZES, CHOP, palmSize, greenTicks } from '../../data/chopping.js';
import { harvestLoot } from '../../data/harvestLoot.js';
import { LOGGING } from '../../data/progression.js';
import { TRADE } from './trade.js';
import { loggingStatus } from './progression.js';
import { loggingTimingRank } from './loggingTiming.js';
import { roomFor, load } from '../economy/cargo.js';
import { C } from '../ecs.js';
import { busy, onLand, emit, commit } from './resources.js';

const owns = (o, k) => Object.hasOwn(o, k);
const state = (w) => (w.resources.chop ||= { palms: new Map(), players: new Map(), active: new Set(), damaged: new Set(), piles: new Map(), pileSeq: 0 });
const standing = (w, node) => node.readyTick <= w.tick;
const full = (st) => { st.hp = st.maxHp; st.crits = 0; st.damage.clear(); };
const alive = (c, e) => !!c.alive[e] && !(c.dead[e] > 0) && c.hp[e] > 0;
const inRange = (c, e, node) => Math.hypot(c.x[e] - node.x, c.z[e] - node.z) <= HARVEST.radius && Math.abs(c.y[e] - node.y) <= CHOP.dy;

function palmState(w, node) {
  const palms = state(w).palms;
  let st = palms.get(node.id);
  if (!st) {
    const size = palmSize(node.scale);
    palms.set(node.id, st = { hp: PALM_SIZES[size].hp, maxHp: PALM_SIZES[size].hp, size, lastSwingTick: -Infinity, crits: 0, damage: new Map() });
  } else if (st.hp === 0 && standing(w, node)) full(st); // a palm that grew back
  return st;
}

// Read-only view for the public snapshot: never creates state.
export function palmView(w, node) {
  const st = w.resources.chop?.palms.get(node.id), size = st?.size ?? palmSize(node.scale), maxHp = PALM_SIZES[size].hp;
  return { hp: st && st.hp === 0 && !standing(w, node) ? 0 : st && st.hp > 0 ? st.hp : maxHp, maxHp, size };
}

export function publicPiles(w) {
  const out = [];
  for (const p of w.resources.chop?.piles.values() ?? []) out.push({ id: p.id, x: p.x, y: p.y, z: p.z, goods: { ...p.goods }, rev: p.rev });
  return out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function forgetChopPlayer(w, e) {
  const ch = w?.resources?.chop;
  ch?.players.delete(e); ch?.active.delete(e);
}

function cadenceOf(profile, tier) {
  let learned = false;
  try { learned = loggingStatus(profile.progression).rank === 2; } catch { /* corrupt progression: base cadence */ }
  return learned ? AXES[tier].learned : AXES[tier].cadence;
}
function timingRank(profile) {
  const practice = profile.progression?.practice?.logging;
  try { return loggingTimingRank(Number.isSafeInteger(practice) && practice >= 0 ? practice : 0); } catch { return 1; }
}

function shape(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.type !== 'resource' || (msg.t !== undefined && msg.t !== 'cmd')) return false;
  const allowed = msg.op === 'chop' ? ['type', 't', 'op', 'node'] : ['type', 't', 'op'];
  return Object.keys(msg).every((k) => allowed.includes(k))
    && (msg.op !== 'chop' || (typeof msg.node === 'string' && msg.node.length > 0 && msg.node.length <= 40));
}

// ops 'chop' and 'crit'; the caller has checked w.chopVersion === 1 and that the resource layout is installed.
export function chopCmd(w, e, msg) {
  if (!shape(msg)) { emit(w, e, msg, false, 'schema'); return false; }
  const ch = state(w), c = w.ecs, profile = w.profiles?.get(e);
  if (!alive(c, e) || !(c.mask[e] & C.PLAYER)) { emit(w, e, msg, false, 'dead'); return false; }
  if (msg.op === 'crit') return crit(w, e, ch);
  const deny = (why, rev = 0, extra = null) => { emit(w, e, msg, false, why, rev, extra); return false; };
  const node = w.resources.nodes.get(msg.node);
  if (busy(w, e)) return deny('busy', node?.rev ?? 0);
  if (!onLand(w, e) || w.navalPilot?.aboard?.(e)) return deny('land', node?.rev ?? 0);
  if (c.regenT[e] < TRADE.calm) return deny('combat', node?.rev ?? 0);
  const tier = sanitizeTools(profile?.tools).axe;
  if (tier < 1) return deny('tool', node?.rev ?? 0, { tool: 'axe' });
  if (!node || node.kind !== 'palm') return deny('node');
  if (!inRange(c, e, node)) return deny('far', node.rev);
  if (!standing(w, node)) return deny('depleted', node.rev, { wait: (node.readyTick - w.tick) * DT });
  let p = ch.players.get(e);
  if (!p) ch.players.set(e, p = { lastStart: null, lastCadence: 0, swings: [] });
  const t = w.tick, cadence = cadenceOf(profile, tier);
  let S = t;
  if (p.lastStart !== null) {
    const next = p.lastStart + p.lastCadence;
    if (t < next - CHOP.slack || p.swings.length >= 2) return deny('cooldown', node.rev, { wait: Math.max(0, next - CHOP.slack - t) * DT });
    if (t < next) S = next;
  }
  const strike = S + cadence;
  p.swings.push({ node: node.id, S, T: strike, green: greenTicks(timingRank(profile), cadence), dmg: AXES[tier].damage, crit: null });
  p.lastStart = S; p.lastCadence = cadence;
  ch.active.add(e);
  palmState(w, node).lastSwingTick = S;
  emit(w, e, msg, true, '', node.rev, { node: node.id, start: S, cadence, strike });
  w.emit({ type: 'chopSwing', e, node: node.id, start: S, cadence });
  return true;
}

function crit(w, e, ch) {
  const p = ch.players.get(e), t = w.tick;
  if (!p) return false;
  const cands = p.swings.filter((s) => s.S <= t && t <= s.T + CHOP.slack);
  const hit = cands.find((s) => t >= s.T - s.green);
  if (hit) { if (hit.crit !== null) return false; hit.crit = true; return true; }
  const spent = cands.find((s) => s.crit === null);
  if (!spent) return false;
  spent.crit = false;
  return true;
}

function cancel(w, e, s, st) {
  w.emit({ type: 'chopHit', e, node: s.node, damage: 0, crit: false, hp: st.hp, maxHp: st.maxHp, cancelled: true });
}

function shares(damage) {
  const total = [...damage.values()].reduce((n, d) => n + d, 0), P = LOGGING.practicePerPalm;
  const rows = [...damage].map(([e, d]) => ({ e, amount: Math.floor(P * d / total), remainder: P * d % total }));
  let left = P - rows.reduce((n, r) => n + r.amount, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.e - b.e);
  for (const r of rows) if (left > 0) { r.amount++; left--; }
  return rows.sort((a, b) => a.e - b.e).map(({ e, amount }) => ({ e, amount }));
}

function fell(w, e, node, st) {
  const ch = state(w), c = w.ecs, size = PALM_SIZES[st.size];
  const dx = node.x - c.x[e], dz = node.z - c.z[e], len = Math.hypot(dx, dz);
  const dir = len > 0 ? { x: Math.round(dx / len * 1000) / 1000, z: Math.round(dz / len * 1000) / 1000 } : { x: 1, z: 0 };
  const logs = size.logs + Math.min(st.crits, size.critBonusMax);
  const loot = w.harvestLootEnabled === true ? harvestLoot('palm', node.id, node.rev + 1) : {};
  const practice = shares(st.damage);
  node.rev += 1; node.readyTick = w.tick + HARVEST.respawnTicks;
  st.hp = 0; st.crits = 0; st.damage.clear(); ch.damaged.delete(node.id);
  if (ch.piles.size >= CHOP.maxPiles) ch.piles.delete(ch.piles.keys().next().value);
  const x = node.x + dir.x * CHOP.pileOffset, z = node.z + dir.z * CHOP.pileOffset, ground = w.map.groundAt(x, z);
  const pile = { id: `pile-${++ch.pileSeq}`, x, y: Number.isFinite(ground) ? ground : node.y, z, goods: { tronco: logs, ...loot }, rev: 1, expiresTick: w.tick + CHOP.pileTicks };
  ch.piles.set(pile.id, pile);
  w.emit({ type: 'chopFell', e, node: node.id, dir, pile: pile.id, logs, practice });
}

function resolve(w, e, s) {
  const node = w.resources.nodes.get(s.node), st = node && palmState(w, node);
  if (!node || !standing(w, node)) return cancel(w, e, s, st ?? { hp: 0, maxHp: 0 });
  const ch = state(w), damage = s.dmg * (s.crit === true ? 2 : 1), removed = Math.min(st.hp, damage);
  st.hp -= removed; st.damage.set(e, (st.damage.get(e) || 0) + removed); st.lastSwingTick = w.tick;
  if (s.crit === true) st.crits += 1;
  w.emit({ type: 'chopHit', e, node: node.id, damage, crit: s.crit === true, hp: st.hp, maxHp: st.maxHp });
  if (st.hp === 0) fell(w, e, node, st);
  else if (st.hp < st.maxHp) ch.damaged.add(node.id);
}

// Called by LocalServer right after w.stepWorld() (w.tick already advanced). Touches only active swings, damaged palms and piles.
export function stepChopping(w) {
  const ch = w.resources?.chop;
  if (!ch) return;
  const c = w.ecs, t = w.tick;
  for (const e of ch.active) {
    const p = ch.players.get(e);
    for (const s of p ? [...p.swings] : []) {
      const node = w.resources.nodes.get(s.node);
      // A crit sent at T + slack is still handled between ticks, so the impact resolves on the tick after that.
      if (t > s.T + CHOP.slack) { p.swings.splice(p.swings.indexOf(s), 1); resolve(w, e, s); }
      else if (t <= s.T && (!alive(c, e) || busy(w, e) || !node || !inRange(c, e, node) || !standing(w, node))) {
        p.swings.splice(p.swings.indexOf(s), 1); cancel(w, e, s, node ? palmState(w, node) : { hp: 0, maxHp: 0 });
      }
    }
    if (!p?.swings.length) ch.active.delete(e);
  }
  for (const id of ch.damaged) {
    const st = ch.palms.get(id);
    if (!st || st.hp <= 0 || st.hp >= st.maxHp) ch.damaged.delete(id);
    else if (t - st.lastSwingTick >= CHOP.healTicks) { full(st); ch.damaged.delete(id); }
  }
  for (const [id, pile] of ch.piles) { if (pile.expiresTick > t) break; ch.piles.delete(id); }
}

// op 'pickup': called by resourceCmd after the dead and pack checks, inside its receipt machinery.
export function pickupCmd(w, e, msg, profile, deny, remember, saveFits) {
  const c = w.ecs, ch = state(w), tradeRev = profile.eco.tradeRev;
  if (!onLand(w, e) || w.navalPilot?.aboard?.(e)) return deny('land', tradeRev || 0);
  const pile = ch.piles.get(msg.pile);
  if (!pile) return deny('pile', tradeRev || 0);
  if (msg.expectedRev !== pile.rev) return deny('revision', pile.rev);
  if (Math.hypot(c.x[e] - pile.x, c.z[e] - pile.z) > CHOP.pileRadius) return deny('far', pile.rev);
  if (!Number.isSafeInteger(tradeRev) || tradeRev < 0 || tradeRev > HARVEST.maxRev) return deny('revision', 0);
  if (tradeRev >= HARVEST.maxRev) return deny('revisionLimit', pile.rev);
  const pack = { ...profile.eco.pack, goods: { ...profile.eco.pack.goods } }, loaded = {};
  let count = 0;
  for (const good of ['tronco', ...Object.keys(pile.goods).filter((g) => g !== 'tronco')]) {
    if (!owns(pile.goods, good)) continue;
    const k = Math.min(pile.goods[good], roomFor(pack, good));
    if (k > 0 && load(pack, good, k)) { loaded[good] = k; count += k; }
  }
  if (!count) return deny('full', pile.rev);
  if (!commit(w, e, profile, pack, tradeRev + 1, saveFits)) return deny('saveSize', pile.rev);
  for (const [good, k] of Object.entries(loaded)) { pile.goods[good] -= k; if (!pile.goods[good]) delete pile.goods[good]; }
  const left = Object.values(pile.goods).reduce((n, k) => n + k, 0);
  if (left === 0) ch.piles.delete(pile.id); else pile.rev += 1;
  w.emit({ type: 'pilePickup', e, pile: pile.id, goods: loaded, count, left });
  return remember(emit(w, e, msg, true, '', pile.rev, { pile: pile.id, goods: loaded, count, left, profileRev: profile.eco.tradeRev }));
}

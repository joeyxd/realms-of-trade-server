// Session-local coastal gathering and the first simple material recipe.
import { DT } from '../../data/tuning.js';
import { HARVEST, RESOURCE_KINDS, CRAFT_RECIPES, sanitizeTools, resourceLayout } from '../../data/resources.js';
import { GOODS } from '../../data/goods.js';
import { TRADE } from './trade.js';
import { holdUsed, load, unload } from '../economy/cargo.js';
import { C } from '../ecs.js';

const MAX_RECEIPTS = 64;
const MAX_OWNERS = 256;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const owns = (o, k) => Object.hasOwn(o, k);

function cleanLayout(map) {
  const raw = resourceLayout(map);
  const ids = new Set();
  const nodes = [];
  for (const n of (Array.isArray(raw?.nodes) ? raw.nodes : []).slice(0, HARVEST.maxNodes)) {
    if (!n || typeof n.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(n.id) || ids.has(n.id)
        || !owns(RESOURCE_KINDS, n.kind) || ![n.x, n.y, n.z].every(Number.isFinite)) continue;
    ids.add(n.id);
    const node = { id: n.id, kind: n.kind, x: n.x, y: n.y, z: n.z, rev: 1, readyTick: 0 };
    if (n.kind === 'palm' && Number.isSafeInteger(n.propIndex) && n.propIndex >= 0
        && Number.isFinite(n.scale) && n.scale > 0) {
      node.propIndex = n.propIndex; node.scale = n.scale; node.rot = Number.isFinite(n.rot) ? n.rot : 0;
    }
    if (RESOURCE_KINDS[n.kind].hits) node.hits = 0;
    nodes.push(node);
  }
  const b = raw?.bench;
  const bench = b && [b.x, b.y, b.z].every(Number.isFinite) ? { x: b.x, y: b.y, z: b.z } : null;
  return { nodes: new Map(nodes.map((n) => [n.id, n])), bench, cooldowns: new Map(), receipts: new Map() };
}

export function installResources(w) {
  if (!w || !w.map || typeof w.emit !== 'function') throw new TypeError('resource world required');
  w.resources = cleanLayout(w.map);
  return w.resources;
}

export function publicResources(w) {
  const r = w?.resources;
  if (!r) return { nodes: [], bench: null };
  const nodes = [];
  for (const n of r.nodes.values()) {
    const remaining = Math.max(0, n.readyTick - w.tick);
    const view = { id: n.id, kind: n.kind, x: n.x, y: n.y, z: n.z, rev: n.rev,
      ready: remaining === 0, wait: remaining * DT };
    if (RESOURCE_KINDS[n.kind].hits) {
      const hits = n.readyTick > 0 && n.readyTick <= w.tick ? 0 : (n.hits || 0);
      Object.assign(view, { hits, remaining: Math.max(0, RESOURCE_KINDS[n.kind].hits - hits) });
      if (n.kind === 'palm') Object.assign(view, { propIndex: n.propIndex, scale: n.scale, rot: n.rot });
    }
    nodes.push(view);
  }
  nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { nodes, bench: r.bench ? { ...r.bench } : null };
}

export function clearResourceReceipts(w, e) {
  w?.resources?.receipts?.delete(e);
  w?.resources?.cooldowns?.delete(e);
}

function emit(w, e, msg, ok, why = '', rev = 0, extra = null) {
  const ack = { type: 'resource', to: e,
    op: typeof msg?.op === 'string' && msg.op.length <= 16 ? msg.op : '',
    opId: typeof msg?.opId === 'string' ? msg.opId.slice(0, 64) : '', ok, why, rev };
  if (extra) Object.assign(ack, extra);
  w.emit(ack);
  return ack;
}

function exactSchema(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)
      || msg.type !== 'resource'
      || (msg.t !== undefined && msg.t !== 'cmd')) return false;
  const fields = msg.op === 'gather' ? ['node', 'expectedRev']
    : msg.op === 'craft' ? ['recipe', 'expectedRev', 'n'] : null;
  if (!fields) return false;
  const allowed = new Set(['type', 't', 'op', 'opId', ...fields]);
  return Object.keys(msg).every((k) => allowed.has(k))
    && owns(msg, 'opId') && typeof msg.opId === 'string' && OP_ID.test(msg.opId)
    && owns(msg, 'expectedRev') && Number.isSafeInteger(msg.expectedRev)
    && (msg.op !== 'gather' || (typeof msg.node === 'string' && msg.node.length > 0 && msg.node.length <= 40))
    && (msg.op !== 'craft' || (typeof msg.recipe === 'string' && owns(CRAFT_RECIPES, msg.recipe)
      && (!owns(msg, 'n') || (Number.isSafeInteger(msg.n) && msg.n >= 1 && msg.n <= CRAFT_RECIPES[msg.recipe].max))));
}

function signature(msg) {
  return msg.op === 'gather'
    ? JSON.stringify([msg.op, msg.node, msg.expectedRev])
    : JSON.stringify([msg.op, msg.recipe, msg.expectedRev, msg.n ?? 1]);
}

function ownerReceipts(r, e) {
  let own = r.receipts.get(e);
  if (own) return own;
  if (r.receipts.size >= MAX_OWNERS) return null;
  own = new Map();
  r.receipts.set(e, own);
  return own;
}

function validPack(pack) {
  if (!pack || typeof pack !== 'object' || !Number.isFinite(pack.cap) || pack.cap < 0
      || !pack.goods || typeof pack.goods !== 'object' || Array.isArray(pack.goods)) return false;
  for (const [good, count] of Object.entries(pack.goods))
    if (!owns(GOODS, good) || !Number.isSafeInteger(count) || count <= 0) return false;
  return holdUsed(pack) <= pack.cap;
}

function busy(w, e) {
  const c = w.ecs;
  return c.moveMag[e] > 1e-6 || Math.hypot(c.vx[e], c.vz[e]) > 1e-6
    || c.dashT[e] >= 0 || c.dashBuffer[e] > 0 || c.castK[e] > 0 || c.castLock[e] > 0
    || c.atkStage[e] > 0;
}

function onLand(w, e) {
  const c = w.ecs;
  if (!Number.isFinite(c.x[e]) || !Number.isFinite(c.y[e]) || !Number.isFinite(c.z[e])) return false;
  const ground = w.map.groundAt(c.x[e], c.z[e]);
  if (!Number.isFinite(ground) || ground < 0.35 || Math.abs(c.y[e] - ground) >= 1.5) return false;
  if (w.raftDeck?.surface(c.x[e], c.z[e], c.y[e])) return false;
  if (w.map.onDock?.(c.x[e], c.z[e])) return false;
  return true;
}

function fits(profile, pack, newTradeRev, saveFits, tools = null) {
  let candidate;
  try {
    candidate = structuredClone(profile);
    candidate.eco.pack = pack;
    candidate.eco.tradeRev = newTradeRev;
    if (tools) candidate.tools = tools;
    if (saveFits(candidate) !== true) return false;
  } catch { return false; }
  return true;
}

function commit(w, e, profile, pack, newTradeRev, saveFits, tools = null) {
  if (!fits(profile, pack, newTradeRev, saveFits, tools)) return false;
  profile.eco.pack = pack;
  profile.eco.tradeRev = newTradeRev;
  if (tools) profile.tools = tools;
  w.profileDirty?.add(e);
  return true;
}

export function resourceCmd(w, e, msg, saveFits = () => true) {
  const r = w?.resources;
  if (!r) return false;
  if (!exactSchema(msg)) { emit(w, e, msg, false, 'schema'); return false; }

  const sig = signature(msg);
  const existing = r.receipts.get(e)?.get(msg.opId);
  if (existing) {
    if (existing.signature !== sig) { emit(w, e, msg, false, 'opIdReuse', existing.ack.rev); return false; }
    w.emit({ ...existing.ack });
    return existing.ack.ok;
  }
  const own = ownerReceipts(r, e);
  if (!own) return emit(w, e, msg, false, 'receiptLimit');
  const remember = (ack) => {
    own.set(msg.opId, { signature: sig, ack: { ...ack } });
    while (own.size > MAX_RECEIPTS) own.delete(own.keys().next().value);
    return ack.ok;
  };
  const deny = (why, rev = 0, extra = null) => remember(emit(w, e, msg, false, why, rev, extra));

  const c = w.ecs, profile = w.profiles?.get(e);
  if (!c?.alive?.[e] || c.dead[e] > 0 || !(c.mask[e] & C.PLAYER) || !(c.hp[e] > 0)) return deny('dead');
  if (!profile?.eco || !validPack(profile.eco.pack)) return deny('pack');
  if (busy(w, e)) return deny('busy', profile.eco.tradeRev || 0);
  if (!onLand(w, e)) return deny('land', profile.eco.tradeRev || 0);
  if (c.regenT[e] < TRADE.calm) return deny('combat', profile.eco.tradeRev || 0);

  const cooldown = r.cooldowns.get(e);
  if (cooldown !== undefined && w.tick < cooldown) return deny('cooldown', profile.eco.tradeRev || 0,
    { wait: (cooldown - w.tick) * DT });
  const tradeRev = profile.eco.tradeRev;
  if (!Number.isSafeInteger(tradeRev) || tradeRev < 0 || tradeRev > HARVEST.maxRev)
    return deny('revision', 0);
  if (msg.op === 'gather') {
    if (w.navalPilot?.aboard?.(e)) return deny('land', tradeRev);
    const node = r.nodes.get(msg.node);
    if (!node) return deny('node', tradeRev);
    if (msg.expectedRev !== node.rev) return deny('revision', node.rev);
    if (node.rev >= HARVEST.maxRev) return deny('revisionLimit', node.rev);
    if (node.readyTick > w.tick) return deny('depleted', node.rev,
      { wait: (node.readyTick - w.tick) * DT });
    if (Math.hypot(c.x[e] - node.x, c.z[e] - node.z) > HARVEST.radius) return deny('far', node.rev);
    if (tradeRev >= HARVEST.maxRev) return deny('revisionLimit', node.rev);
    const kind = RESOURCE_KINDS[node.kind], good = kind?.good;
    if (kind.tool && profile.tools?.[kind.tool] !== 1) return deny('tool', node.rev, { tool: kind.tool });
    const pack = { cap: profile.eco.pack.cap, goods: { ...profile.eco.pack.goods } };
    const work = !!kind.hits, isPalm = node.kind === 'palm';
    const hits = work && node.readyTick > 0 && node.readyTick <= w.tick ? 0 : (node.hits || 0);
    const finalHit = !work || hits + 1 >= kind.hits;
    const count = finalHit ? (kind.yield || 1) : 0;
    const stagedCount = kind.yield || 1;
    if (!good || !load(pack, good, stagedCount)) return deny('full', node.rev);
    if (!finalHit && !fits(profile, pack, tradeRev + 1, saveFits)) return deny('saveSize', node.rev);
    if (count > 0 && !commit(w, e, profile, pack, tradeRev + 1, saveFits)) return deny('saveSize', node.rev);
    node.rev += 1;
    if (work) {
      node.hits = hits + 1;
      node.readyTick = finalHit ? w.tick + HARVEST.respawnTicks : 0;
    } else node.readyTick = w.tick + HARVEST.respawnTicks;
    r.cooldowns.set(e, w.tick + (kind.actionTicks || HARVEST.actionTicks));
    const left = work ? Math.max(0, kind.hits - node.hits) : 0;
    w.emit({ type: 'resourceHit', e, node: node.id, kind: node.kind, x: node.x, y: node.y, z: node.z,
      rev: node.rev, remaining: left, felled: isPalm && finalHit,
      ...(work && !isPalm ? { broken: finalHit, tool: kind.tool } : {}) });
    return remember(emit(w, e, msg, true, '', node.rev,
      work ? { good, count, profileRev: profile.eco.tradeRev, remaining: left, ...(isPalm ? { felled: finalHit } : { broken: finalHit }) }
        : { good, count, profileRev: profile.eco.tradeRev }));
  }

  if (msg.expectedRev !== tradeRev) return deny('revision', tradeRev);
  if (tradeRev >= HARVEST.maxRev) return deny('revisionLimit', tradeRev);
  if (w.navalPilot?.locked?.(e)) return deny('busy', tradeRev);
  if (c.regenT[e] < TRADE.calm) return deny('combat', tradeRev);
  const bench = r.bench;
  if (!bench) return deny('bench', tradeRev);
  if (Math.hypot(c.x[e] - bench.x, c.z[e] - bench.z) > HARVEST.benchRadius) return deny('far', tradeRev);
  const pack = { cap: profile.eco.pack.cap, goods: { ...profile.eco.pack.goods } };
  const recipe = CRAFT_RECIPES[msg.recipe], n = msg.n ?? 1, count = n * recipe.count;
  const tools = recipe.tool ? sanitizeTools(profile.tools) : null;
  if (tools && tools[recipe.tool] >= recipe.tier) return deny('alreadyOwned', tradeRev);
  for (const [good, amount] of Object.entries(recipe.inputs))
    if (!unload(pack, good, amount * n)) return deny('materials', tradeRev);
  if (tools) tools[recipe.tool] = recipe.tier;
  else if (!load(pack, recipe.output, count)) return deny('full', tradeRev);
  if (!commit(w, e, profile, pack, tradeRev + 1, saveFits, tools)) return deny('saveSize', tradeRev);
  r.cooldowns.set(e, w.tick + HARVEST.actionTicks);
  return remember(emit(w, e, msg, true, '', tradeRev + 1,
    tools ? { tool: recipe.tool, tier: recipe.tier, count } : { good: recipe.output, count }));
}

// Server authority for the small, explicit raft construction palette.
import { C } from '../ecs.js';
import { SLOTS, slotSkill } from '../../data/tattoos.js';
import { RAFT, RAFT_PARTS, RAFT_REINFORCEMENT } from '../../data/raftparts.js';
import { tuning } from '../../data/tuning.js';
import { EDITOR_PARTS, EDITOR_RADIUS } from '../../data/raftEditor.js';
import { load, unload, holdUsed, roomFor, newHold, goodMass } from '../economy/cargo.js';
import { raftCapacity } from '../economy/raftCapacity.js';
import { canPlace, place, remove, raftStats } from '../economy/raft.js';
import { publicRafts } from './rafts.js';
import { raftGangplank } from '../raftGeometry.js';
import { sanitizeProduction, productionKey } from '../economy/raftProduction.js';
import { repairPart, repairPartCost, salvagePartCost, liveStructureParts } from '../naval/structure.js';
import { activeRaftParts, encodeRaftCondition, persistRaftCondition, raftConditionEntry, refitRaftCondition, restoreRaftCondition } from '../naval/condition.js';
import { ARTISAN } from '../../data/artisan.js';
import { readProgression } from './progression.js';

const allowed = new Set(EDITOR_PARTS);
const MAX_REV = 2147483647;
const RECEIPTS_PER_OWNER = 64;
const RECEIPT_OWNERS = 256;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const tuple = (p) => Array.isArray(p) && p.length === 5 && typeof p[0] === 'string'
  && p.slice(1).every(Number.isSafeInteger);
const sameTuple = (a, b) => tuple(a) && tuple(b) && a.every((v, i) => v === b[i]);
const cloneHold = (h) => ({ cap: h.cap, goods: { ...h.goods } });
const copyTuple = (p) => [...p];

// An existing hold remains usable/removable without teaching. Only a new placement requires knowledge.
export function knowsStorage(profile) {
  try { return readProgression(profile?.progression).knowledge.includes(ARTISAN.lesson); } catch { return false; }
}

function answer(w, e, msg, ok, why, rev, record = null, extra = null) {
  const out = { type: 'raftEdit', to: e,
    id: typeof msg?.id === 'string' ? msg.id.slice(0, 120) : '',
    opId: typeof msg?.opId === 'string' && OP_ID.test(msg.opId) ? msg.opId : '',
    op: ['place', 'remove', 'reinforce', 'repair', 'quote', 'supply'].includes(msg?.op) ? msg.op : '', ok, why, rev };
  if (record) out.record = record;
  if (extra) Object.assign(out, extra);
  w.emit(out);
  return out;
}

function receiptMap(w, owner) {
  if (!w.raftEditReceipts) w.raftEditReceipts = new Map();
  let cache = w.raftEditReceipts.get(owner);
  if (!cache) { cache = new Map(); w.raftEditReceipts.set(owner, cache); }
  else { w.raftEditReceipts.delete(owner); w.raftEditReceipts.set(owner, cache); }
  while (w.raftEditReceipts.size > RECEIPT_OWNERS) w.raftEditReceipts.delete(w.raftEditReceipts.keys().next().value);
  return cache;
}

function nearEditPoint(w, e, r) {
  const ecs = w.ecs, deck = w.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e]);
  if (deck?.id === r.ship.id) return true;
  const d = w.map.dock;
  const x = d.base.x + d.dir.x * Math.max(0, d.len - 10);
  const z = d.base.z + d.dir.z * Math.max(0, d.len - 10);
  const nearPoint = (ecs.x[e] - x) ** 2 + (ecs.z[e] - z) ** 2 <= EDITOR_RADIUS ** 2;
  if (!nearPoint) return false;
  const plank = publicRafts(w).find((q) => q.id === r.ship.id);
  const join = plank && raftGangplank({ ...plank, parts: r.ship.grid.parts }, w.map.dock);
  return !!join && (ecs.x[e] - join.x) ** 2 + (ecs.z[e] - join.z) ** 2 <= 2.5 ** 2;
}

function footprint(parts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [id, x, z] of parts) {
    const [ww, dd] = RAFT_PARTS[id].size || [1, 1];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + ww);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z + dd);
  }
  return { minX, maxX, minZ, maxZ };
}

function worldBounds(parts, pose) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), b = footprint(parts);
  const points = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]].map(([x, z]) => [
    pose.x + c * x * RAFT.cell + s * z * RAFT.cell,
    pose.z - s * x * RAFT.cell + c * z * RAFT.cell,
  ]);
  return { minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[1])), maxZ: Math.max(...points.map((p) => p[1])) };
}

function fitsLayout(w, r, parts) {
  const ecs = w.ecs, entity = r.entity, pose = { x: ecs.x[entity], z: ecs.z[entity], yaw: ecs.facing[entity] };
  const world = worldBounds(parts, pose), limit = w.map.half - 0.5;
  if (world.minX < -limit || world.maxX > limit || world.minZ < -limit || world.maxZ > limit) return false;
  const d = w.map.dock, bounds = footprint(parts);
  // Test each occupied cell in dock-local space, with a small clearance around the dock platform.
  for (const [, x, z] of parts) {
    const corners = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]].map(([a, b]) => {
      const wx = pose.x + Math.cos(pose.yaw) * a * RAFT.cell + Math.sin(pose.yaw) * b * RAFT.cell;
      const wz = pose.z - Math.sin(pose.yaw) * a * RAFT.cell + Math.cos(pose.yaw) * b * RAFT.cell;
      const dx = wx - d.base.x, dz = wz - d.base.z;
      return [dx * d.dir.x + dz * d.dir.z, -dx * d.dir.z + dz * d.dir.x];
    });
    const ax = corners.map((p) => p[0]), az = corners.map((p) => p[1]);
    if (Math.min(...ax) < d.len + 0.12 && Math.max(...ax) > -0.12
      && Math.min(...az) < d.halfWidth + 0.12 && Math.max(...az) > -d.halfWidth - 0.12) return false;
  }
  for (const other of publicRafts(w)) {
    if (other.id === r.ship.id) continue;
    const q = worldBounds(other.parts, other), gap = 0.12;
    if (world.minX < q.maxX + gap && world.maxX > q.minX - gap
      && world.minZ < q.maxZ + gap && world.maxZ > q.minZ - gap) return false;
  }
  return Number.isFinite(bounds.minX);
}

function safeForOccupants(w, r, parts) {
  const beforeDeck = w.raftDeck;
  const afterDeck = new w.raftDeck.constructor(w.map);
  const old = publicRafts(w).find((q) => q.id === r.ship.id);
  const changed = { ...old, rev: old.rev + 1, parts: parts.map(copyTuple) };
  afterDeck.update(publicRafts(w).map((q) => q.id === r.ship.id ? changed : q));
  const ecs = w.ecs;
  const checkPoint = (x, z, y, radius) => {
    const a = beforeDeck.surface(x, z, y), b = afterDeck.surface(x, z, y);
    if (a?.id === r.ship.id && (!b || b.id !== a.id || b.kind !== a.kind || Math.abs(b.y - a.y) > 1e-6)) return false;
    if (b?.id === r.ship.id && a?.id !== r.ship.id) return false;
    if (afterDeck.blocked(x, z, y, radius) && !beforeDeck.blocked(x, z, y, radius)) return false;
    return true;
  };
  const escapeChecks = [];
  for (const p of ecs.each(C.PLAYER)) {
    const radius = ecs.radius[p] || tuning.player.radius;
    const current = beforeDeck.surface(ecs.x[p], ecs.z[p], ecs.y[p]);
    if (!checkPoint(ecs.x[p], ecs.z[p], ecs.y[p], radius)) return false;
    if (current?.id === r.ship.id) escapeChecks.push([ecs.x[p], ecs.z[p], ecs.y[p], radius]);
    // Abordaje's target is a planned landing; do not edit support out from under an airborne visitor.
    const slot = SLOTS[ecs.castK[p] - 1];
    if (slot && slotSkill(ecs, p, slot) === 'leap') {
      const landing = beforeDeck.surface(ecs.lpX1[p], ecs.lpZ1[p], ecs.y[p]);
      if (!checkPoint(ecs.lpX1[p], ecs.lpZ1[p], ecs.y[p], radius)) return false;
      if (landing?.id === r.ship.id) escapeChecks.push([ecs.lpX1[p], ecs.lpZ1[p], ecs.y[p], radius]);
    }
  }
  for (const start of escapeChecks) {
    const hadExit = canReachGangplank(beforeDeck, r.ship.id, start);
    if (hadExit !== false && canReachGangplank(afterDeck, r.ship.id, start) !== true) return false;
  }
  return true;
}

// Search the actual shared raft surfaces and blockers, rather than treating a nearby wall as proof of entrapment.
// The lattice is finer than character collision samples and remains small for the 12-cell blueprint limit.
function canReachGangplank(deck, id, [sx, sz, sy, radius]) {
  // Every nearby character can open these unlocked doors. Path safety must allow that action,
  // otherwise placing the final cabin wall would reject a usable room as a sealed trap.
  const traversable = new deck.constructor(deck.map);
  traversable.update([...deck.entries.values()].map(({ record }) => ({ ...record,
    openDoors: record.parts.filter((p) => p[0] === 'door') })));
  deck = traversable;
  const g = deck.entries.get(id);
  if (!g || !g.plank) return false;
  const r = g.record, c = Math.cos(r.yaw), s = Math.sin(r.yaw), step = 0.25;
  const localPoints = [[g.minX, g.minZ], [g.maxX, g.minZ], [g.minX, g.maxZ], [g.maxX, g.maxZ]];
  const plank = g.plank;
  for (const [u, v] of [[-plank.width / 2, -plank.length / 2], [plank.width / 2, -plank.length / 2],
    [-plank.width / 2, plank.length / 2], [plank.width / 2, plank.length / 2]]) {
    const wx = plank.x + Math.cos(plank.yaw) * u + Math.sin(plank.yaw) * v;
    const wz = plank.z - Math.sin(plank.yaw) * u + Math.cos(plank.yaw) * v;
    const dx = wx - r.x, dz = wz - r.z;
    localPoints.push([c * dx - s * dz, s * dx + c * dz]);
  }
  let minX = Math.min(...localPoints.map((p) => p[0])) - radius;
  let maxX = Math.max(...localPoints.map((p) => p[0])) + radius;
  let minZ = Math.min(...localPoints.map((p) => p[1])) - radius;
  let maxZ = Math.max(...localPoints.map((p) => p[1])) + radius;
  // Convert the world start to local space and align the search lattice so it contains that exact point.
  const dx = sx - r.x, dz = sz - r.z, lx = c * dx - s * dz, lz = s * dx + c * dz;
  const startIx = Math.round((lx - minX) / step), startIz = Math.round((lz - minZ) / step);
  const originX = lx - startIx * step, originZ = lz - startIz * step;
  const ix0 = Math.ceil((minX - originX) / step), ix1 = Math.floor((maxX - originX) / step);
  const iz0 = Math.ceil((minZ - originZ) / step), iz1 = Math.floor((maxZ - originZ) / step);
  const width = ix1 - ix0 + 1, depth = iz1 - iz0 + 1;
  if (width <= 0 || depth <= 0) return false;
  if (width * depth > 20000) return null;
  const pointAt = (ix, iz) => [r.x + c * (originX + ix * step) + s * (originZ + iz * step),
    r.z - s * (originX + ix * step) + c * (originZ + iz * step)];
  const stand = (ix, iz, fromY) => {
    const [x, z] = pointAt(ix, iz), surface = deck.surface(x, z, fromY);
    if (!surface || surface.id !== id || deck.blocked(x, z, surface.y, radius)) return null;
    return { x, z, y: surface.y, goal: surface.kind === 'gangplank' };
  };
  const start = stand(startIx, startIz, sy);
  if (!start) return false;
  const key = (ix, iz, y) => `${ix},${iz},${Math.round(y * 1000)}`;
  const seen = new Set([key(startIx, startIz, start.y)]), queue = [[startIx, startIz, start.y]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let head = 0; head < queue.length && head < 20000; head++) {
    const [ix, iz, y] = queue[head], here = stand(ix, iz, y);
    if (here?.goal) return true;
    for (const [ox, oz] of dirs) {
      const nx = ix + ox, nz = iz + oz;
      if (nx < ix0 || nx > ix1 || nz < iz0 || nz > iz1) continue;
      // Diagonal steps must also clear both touching axial positions, so corners cannot be cut.
      if (ox && oz && (!stand(ix + ox, iz, y) || !stand(ix, iz + oz, y))) continue;
      const next = stand(nx, nz, y);
      if (!next) continue;
      const k = key(nx, nz, next.y);
      if (seen.has(k)) continue;
      const mx = (here.x + next.x) / 2, mz = (here.z + next.z) / 2;
      const mid = deck.surface(mx, mz, (here.y + next.y) / 2);
      if (!mid || mid.id !== id || deck.blocked(mx, mz, mid.y, radius)) continue;
      seen.add(k);
      queue.push([nx, nz, next.y]);
    }
  }
  return queue.length > 20000 ? null : false;
}

function debit(cost, hold, pack) {
  for (const [g, n] of Object.entries(cost)) if ((hold.goods[g] || 0) + (pack.goods[g] || 0) < n) return false;
  for (const [g, n] of Object.entries(cost)) {
    const a = Math.min(n, hold.goods[g] || 0);
    if (a) unload(hold, g, a);
    if (n > a) unload(pack, g, n - a);
  }
  return true;
}

function creditAfterRemoval(shipHold, pack, cap, cost) {
  // The sanitized pack has ten weight slots. Search its bounded transfer weights so insertion order
  // cannot force a heavy cargo transfer that leaves no room for the refund when lighter cargo would fit.
  const free = Math.max(0, Math.floor(pack.cap - holdUsed(pack)));
  let transfers = new Map([[0, {}]]);
  for (const [g, count] of Object.entries(shipHold.goods)) {
    const weight = holdUsed({ cap: 1e9, goods: { [g]: 1 } }), next = new Map(transfers);
    for (const [used, goods] of transfers) {
      const max = Math.min(count, Math.floor((free - used) / weight));
      for (let n = 1; n <= max; n++) {
        const total = used + n * weight;
        if (!next.has(total)) next.set(total, { ...goods, [g]: n });
      }
    }
    transfers = next;
  }
  for (const [weight, goods] of [...transfers].sort((a, b) => a[0] - b[0])) {
    if (holdUsed(shipHold) - weight > cap) continue;
    const nextHold = cloneHold(shipHold), nextPack = cloneHold(pack);
    for (const [g, n] of Object.entries(goods)) { unload(nextHold, g, n); load(nextPack, g, n); }
    nextHold.cap = cap;
    let fits = true;
    for (const [g, n] of Object.entries(cost)) {
      const refund = n;
      if (!refund) continue;
      const intoHold = Math.min(refund, spaceForUnits(nextHold, g));
      if (intoHold) load(nextHold, g, intoHold);
      if (refund > intoHold && !load(nextPack, g, refund - intoHold)) { fits = false; break; }
    }
    if (!fits) continue;
    Object.assign(shipHold, nextHold); Object.assign(pack, nextPack);
    return true;
  }
  return false;
}

function spaceForUnits(hold, good) {
  const used = holdUsed(hold), unitWeight = holdUsed({ cap: 1e9, goods: { [good]: 1 } });
  return unitWeight > 0 ? Math.max(0, Math.floor((hold.cap - used) / unitWeight)) : 0;
}

function reject(w, e, msg, why, ship, stale = false) {
  const record = stale && ship ? publicRafts(w).find((q) => q.id === ship.id) : null;
  return answer(w, e, msg, false, why, ship?.rev, record);
}

export function raftCmd(w, e, msg, saveFits = () => true) {
  const reading = msg?.op === 'quote';
  if (!msg || (msg.cmd !== 'raft' && msg.type !== 'raft') || (!reading && (typeof msg.opId !== 'string' || !OP_ID.test(msg.opId))) || typeof msg.id !== 'string' || msg.id.length > 120
      || !['place', 'remove', 'reinforce', 'repair', 'quote', 'supply'].includes(msg.op) || !Number.isSafeInteger(msg.expectedRev))
    return reject(w, e, msg, 'command');
  if (msg.op === 'repair' && Object.keys(msg).some((key) =>
    !['t', 'cmd', 'type', 'op', 'id', 'expectedRev', 'opId', 'index', 'piece', 'partId', 'expectedHp'].includes(key)))
    return reject(w, e, msg, 'command');
  const profile = w.profiles?.get(e);
  if (w.navalPilot?.locked?.(e)) return reject(w, e, msg, 'busy');
  if (!profile?.eco || !w.ecs.alive[e] || w.ecs.dead[e] > 0) return reject(w, e, msg, 'dead');
  const ecs = w.ecs;
  if (ecs.dashT[e] >= 0 || ecs.dashBuffer[e] > 0 || ecs.castK[e] > 0 || ecs.castLock[e] > 0 || ecs.moveMag[e] > 1e-6
      || Math.hypot(ecs.vx[e], ecs.vz[e]) > 1e-6) return reject(w, e, msg, 'busy');
  const ownerRaft = profile.eco.ships.find((s) => s.kind === 'raft' && s.at === 'aldea' && s.grid?.parts?.length && s.hp > 0);
  const active = w.rafts?.get(msg.id);
  if (!active || active.owner !== e || active.ship !== ownerRaft || active.ship.id !== msg.id)
    return reject(w, e, msg, 'owner', active?.ship);
  const ship = active.ship, hold = cloneHold(ship.hold), pack = cloneHold(profile.eco.pack);
  const cache = receiptMap(w, e), signature = JSON.stringify([msg.id, msg.op, msg.expectedRev,
    tuple(msg.piece) ? msg.piece : null, Number.isSafeInteger(msg.index) ? msg.index : null,
    typeof msg.g === 'string' ? msg.g : null, Number.isSafeInteger(msg.n) ? msg.n : null,
    typeof msg.partId === 'string' ? msg.partId : null, Number.isFinite(msg.expectedHp) ? msg.expectedHp : null]), prior = !reading && cache.get(msg.opId);
  if (prior) {
    if (prior.signature !== signature)
      return reject(w, e, msg, 'duplicate', active.ship);
    w.emit({ ...prior.ack });
    return prior.ack;
  }
  if (active.ship.rev !== msg.expectedRev) return reject(w, e, msg, 'revision', active.ship, true);
  if (!nearEditPoint(w, e, active)) return reject(w, e, msg, 'far', active.ship);
  if (!reading && (!Number.isSafeInteger(ship.rev) || ship.rev < 1 || ship.rev >= MAX_REV))
    return reject(w, e, msg, 'revisionLimit', ship);
  if (reading) {
    const supplies = ['madera', 'hierro'].map((g) => {
      const q = w.economy?.quote('aldea', g, 1, 'buy');
      return { g, n: q?.n || 0, price: q?.total || 0, stock: w.economy?.markets?.aldea?.stock?.[g] || 0 };
    });
    return answer(w, e, msg, true, '', active.ship.rev, null, { supplies });
  }
  if (msg.op === 'repair') {
    if (!Number.isSafeInteger(msg.index) || !sameTuple(ship.grid.parts[msg.index], msg.piece))
      return reject(w, e, msg, 'piece', ship);
    const entry = raftConditionEntry(active, msg.index);
    if (!entry?.id || typeof msg.partId !== 'string' || msg.partId !== entry.id)
      return reject(w, e, msg, 'condition', ship);
    if (entry.hp === entry.maxHp) return reject(w, e, msg, 'healthy', ship);
    if (typeof msg.expectedHp !== 'number' || !Number.isFinite(msg.expectedHp) || msg.expectedHp !== entry.hp)
      return reject(w, e, msg, 'condition', ship);
    const cost = repairPartCost(entry);
    if (!debit(cost, hold, pack)) return reject(w, e, msg, 'goods', ship);
    const repaired = repairPart(active.condition, entry.id), parts = liveStructureParts(repaired.structure);
    if (!fitsLayout(w, active, parts)) return reject(w, e, msg, 'layout', ship);
    if (!safeForOccupants(w, active, parts)) return reject(w, e, msg, 'occupied', ship);
    const candidate = { ...profile, eco: { ...profile.eco, pack,
      ships: profile.eco.ships.map((s) => s === ship ? { ...s, hold, rev: s.rev + 1,
        condition: encodeRaftCondition(repaired.structure, active.conditionNext) } : s) } };
    let fits = false;
    try { fits = saveFits(candidate) === true; } catch { /* Preserve goods and condition on preflight failure. */ }
    if (!fits) return reject(w, e, msg, 'saveSize', ship);
    // Condition and debit are admitted together; retry returns this receipt without restoring twice.
    active.condition = repaired.structure;
    persistRaftCondition(active);
    ship.hold = hold; profile.eco.pack = pack; ship.rev++;
    w.raftDeck.update(publicRafts(w)); w.profileDirty?.add(e);
    const ack = answer(w, e, msg, true, '', ship.rev, null,
      { repair: { partId: entry.id, hp: entry.maxHp, maxHp: entry.maxHp, cost, reconstructed: repaired.event.reconstructed } });
    cache.set(msg.opId, { signature, ack });
    while (cache.size > RECEIPTS_PER_OWNER) cache.delete(cache.keys().next().value);
    return ack;
  }
  if (msg.op === 'supply') {
    if (!['madera', 'hierro'].includes(msg.g) || !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 10)
      return reject(w, e, msg, 'market', active.ship);
    if (ecs.regenT[e] < 3) return reject(w, e, msg, 'calm', active.ship);
    const q = w.economy?.quote('aldea', msg.g, msg.n, 'buy');
    if (!q?.ok) return reject(w, e, msg, q?.why === 'stock' ? 'stock' : 'market', active.ship);
    if (profile.gold < q.total) return reject(w, e, msg, 'gold', active.ship);
    const unitWeight = holdUsed({ cap: 1e9, goods: { [msg.g]: 1 } });
    const holdRoom = Math.min(roomFor(hold, msg.g), Math.max(0, Math.floor((raftCapacity(activeRaftParts(active), hold).freeMass + 1e-8) / goodMass(msg.g))));
    const available = holdRoom + roomFor(pack, msg.g);
    if (available < msg.n) return reject(w, e, msg, 'room', active.ship);
    const inHold = Math.min(msg.n, holdRoom);
    if ((inHold && !load(hold, msg.g, inHold)) || (msg.n > inHold && !load(pack, msg.g, msg.n - inHold)))
      return reject(w, e, msg, 'room', active.ship);
    const candidate = { ...profile, gold: profile.gold - q.total, eco: { ...profile.eco, pack,
      ships: profile.eco.ships.map((s) => s === ship ? { ...s, hold, rev: s.rev + 1 } : s) } };
    if (!saveFits(candidate)) return reject(w, e, msg, 'saveSize', ship);
    const staging = newHold(available * unitWeight);
    const wallet = { gold: profile.gold, hold: staging };
    const traded = w.economy.trade('aldea', msg.g, msg.n, 'buy', wallet);
    if (!traded.ok) return reject(w, e, msg, traded.why === 'gold' ? 'gold' : traded.why === 'stock' ? 'stock' : 'market', active.ship);
    ship.hold = hold;
    profile.eco.pack = pack;
    profile.gold = wallet.gold;
    ship.rev++;
    w.raftDeck.update(publicRafts(w));
    w.profileDirty?.add(e);
    const ack = answer(w, e, msg, true, '', ship.rev, null, { g: msg.g, n: msg.n, total: traded.total, gold: profile.gold });
    cache.set(msg.opId, { signature, ack });
    while (cache.size > RECEIPTS_PER_OWNER) cache.delete(cache.keys().next().value);
    return ack;
  }
  const grid = { parts: ship.grid.parts.map(copyTuple), work: { ...ship.grid.work } };
  let why = '';
  if (msg.op === 'reinforce') {
    if (!Number.isSafeInteger(msg.index) || !tuple(msg.piece) || !sameTuple(ship.grid.parts[msg.index], msg.piece))
      return reject(w, e, msg, 'piece', ship);
    if (msg.piece[0] === 'reinforcedFoundation') return reject(w, e, msg, 'reinforced', ship);
    if (msg.piece[0] !== 'foundation') return reject(w, e, msg, 'piece', ship);
    if (!debit(RAFT_REINFORCEMENT, hold, pack)) return reject(w, e, msg, 'goods', ship);
    grid.parts[msg.index][0] = 'reinforcedFoundation';
  } else if (msg.op === 'place') {
    if (!tuple(msg.piece) || !allowed.has(msg.piece[0])) return reject(w, e, msg, 'piece', ship);
    const [id, x, z, level, dir] = msg.piece;
    if (['torchFloor', 'torchWall', 'campfire'].includes(id) && !w.fireEnabled) return reject(w, e, msg, 'disabled', ship);
    if (id === ARTISAN.part && !knowsStorage(profile)) return reject(w, e, msg, 'knowledge', ship);
    if (Math.abs(x) > 128 || Math.abs(z) > 128 || level < 0 || level >= RAFT.levels || dir < 0 || dir > 3)
      return reject(w, e, msg, 'level', ship);
    if (grid.parts.length >= 600) return reject(w, e, msg, 'size', ship);
    if (['roof', 'lantern', 'torchFloor', 'torchWall', 'campfire'].includes(id)) {
      const support = canPlace(activeRaftParts(active), msg.piece);
      if (support) return reject(w, e, msg, support, ship);
    }
    const virtual = newHold(1e9);
    for (const g of new Set([...Object.keys(hold.goods), ...Object.keys(pack.goods)]))
      virtual.goods[g] = (hold.goods[g] || 0) + (pack.goods[g] || 0);
    why = place(grid, msg.piece, virtual);
    if (why) return reject(w, e, msg, why, ship);
    if (!debit(RAFT_PARTS[id].cost, hold, pack)) return reject(w, e, msg, 'goods', ship);
    const cap = raftStats(grid).hold;
    if (holdUsed(hold) > cap) return reject(w, e, msg, 'room', ship);
    hold.cap = cap;
  } else {
    if (!Number.isSafeInteger(msg.index) || !tuple(msg.piece) || !(allowed.has(msg.piece[0]) || msg.piece[0] === 'reinforcedFoundation')
        || !sameTuple(ship.grid.parts[msg.index], msg.piece)) return reject(w, e, msg, 'piece', ship);
    const removed = grid.parts[msg.index];
    delete grid.work[productionKey(removed)];
    why = remove(grid, msg.index, null);
    if (why) return reject(w, e, msg, why, ship);
    const cap = raftStats(grid).hold;
    if (!creditAfterRemoval(hold, pack, cap, salvagePartCost(raftConditionEntry(active, msg.index)))) return reject(w, e, msg, 'room', ship);
  }
  grid.work = sanitizeProduction(grid.parts, grid.work);
  let condition;
  try { condition = active.condition ? refitRaftCondition(active, grid.parts,
    { reinforceIndex: msg.op === 'reinforce' ? msg.index : -1 }) : null; }
  catch (error) {
    if (error instanceof RangeError) return reject(w, e, msg, 'revisionLimit', ship);
    throw error;
  }
  const liveParts = condition ? liveStructureParts(condition.structure) : grid.parts;
  const priorPublic = publicRafts(w).find((q) => q.id === ship.id);
  if (priorPublic && raftGangplank(priorPublic, w.map.dock) && !raftGangplank({ ...priorPublic, parts: grid.parts }, w.map.dock))
    return reject(w, e, msg, 'layout', ship);
  if (!fitsLayout(w, active, grid.parts)) return reject(w, e, msg, 'layout', ship);
  if (!safeForOccupants(w, active, liveParts)) return reject(w, e, msg, 'occupied', ship);
  const candidate = { ...profile, eco: { ...profile.eco, pack,
    ships: profile.eco.ships.map((s) => s === ship ? { ...s, grid, hold, rev: s.rev + 1,
      ...(condition ? { condition: encodeRaftCondition(condition.structure, condition.nextId) } : {}) } : s) } };
  if (!saveFits(candidate)) return reject(w, e, msg, 'saveSize', ship);

  // Everything above operates on clones; this synchronous commit is the only mutation point.
  ship.grid = grid;
  if (condition) { active.condition = condition.structure; active.conditionNext = condition.nextId; }
  persistRaftCondition(active);
  ship.hold = hold;
  ship.rev++;
  profile.eco.pack = pack;
  w.raftDeck.update(publicRafts(w));
  w.profileDirty?.add(e);
  const ack = answer(w, e, msg, true, '', ship.rev);
  cache.set(msg.opId, { signature, ack });
  while (cache.size > RECEIPTS_PER_OWNER) cache.delete(cache.keys().next().value);
  return ack;
}

// Exact profile effect shared with the M5 receipt boundary. World access/layout/occupancy are checked
// by raftCmd before this candidate can be submitted; this pure check adds no second gameplay authority.
export function storageProfileDelta(before, command) {
  const profile = structuredClone(before), ship = profile.eco?.ships?.find(s => s.id === command.id);
  const fail = why => ({ why });
  if (!ship || ship.kind !== 'raft' || ship.at !== 'aldea' || !(ship.hp > 0)) return fail('owner');
  if (command.expectedRev !== ship.rev || ship.rev >= MAX_REV) return fail('revision');
  if (command.piece?.[0] !== ARTISAN.part || !tuple(command.piece)) return fail('piece');
  const grid = { parts: ship.grid.parts.map(copyTuple), work: { ...ship.grid.work } };
  const hold = cloneHold(ship.hold), pack = cloneHold(profile.eco.pack);
  const restored = ship.condition ? restoreRaftCondition(ship.condition, grid.parts) : null;
  const active = { ship, condition: restored?.structure, conditionNext: restored?.nextId };
  let why;
  if (command.op === 'place') {
    if (!knowsStorage(profile)) return fail('knowledge');
    const virtual = newHold(1e9);
    for (const g of new Set([...Object.keys(hold.goods), ...Object.keys(pack.goods)])) virtual.goods[g] = (hold.goods[g] || 0) + (pack.goods[g] || 0);
    why = place(grid, command.piece, virtual); if (why) return fail(why);
    if (!debit(RAFT_PARTS.storage.cost, hold, pack)) return fail('goods');
    hold.cap = raftStats(grid).hold;
  } else if (command.op === 'remove') {
    if (!sameTuple(grid.parts[command.index], command.piece)) return fail('piece');
    const refund = salvagePartCost(raftConditionEntry(active, command.index));
    delete grid.work[productionKey(command.piece)];
    why = remove(grid, command.index, null); if (why) return fail(why);
    if (!creditAfterRemoval(hold, pack, raftStats(grid).hold, refund)) return fail('room');
  } else return fail('command');
  grid.work = sanitizeProduction(grid.parts, grid.work);
  if (restored) {
    const next = refitRaftCondition(active, grid.parts);
    ship.condition = encodeRaftCondition(next.structure, next.nextId);
  }
  ship.grid = grid; ship.hold = hold; ship.rev++; profile.eco.pack = pack;
  return { profile, why: '' };
}

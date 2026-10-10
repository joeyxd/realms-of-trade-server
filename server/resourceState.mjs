// Server-side persistence for resource nodes. Simulation helpers keep using local ticks;
// stored deadlines share a durable logical tick. Offline time never advances resource timers.
import { HARVEST, RESOURCE_KINDS } from '../src/data/resources.js';
import { resourceCmd } from '../src/sim/systems/resources.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { StoreError } from './store.mjs';

const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => object(v) && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable && Object.hasOwn(d, 'value'); });
const fail = () => { throw new StoreError('world_format'); };

export function checkedResourceState(raw) {
  if (!exact(raw, ['v', 'tick', 'nodes', 'cooldowns']) || raw.v !== 1 || !integer(raw.tick) || !Array.isArray(raw.nodes)
      || raw.nodes.length < 1 || raw.nodes.length > HARVEST.maxNodes || !object(raw.cooldowns)
      || Reflect.ownKeys(raw.cooldowns).length > 4096) fail();
  const ids = new Set();
  for (const n of raw.nodes) {
    if (!exact(n, ['id', 'kind', 'rev', 'hits', 'readyAt']) || typeof n.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,40}$/.test(n.id) || ids.has(n.id) || !Object.hasOwn(RESOURCE_KINDS, n.kind)
        || !integer(n.rev, 1, HARVEST.maxRev) || !integer(n.hits, 0, RESOURCE_KINDS[n.kind].hits || 0)
        || !integer(n.readyAt)) fail();
    ids.add(n.id);
  }
  for (const key of Reflect.ownKeys(raw.cooldowns)) {
    const d = Object.getOwnPropertyDescriptor(raw.cooldowns, key);
    if (typeof key !== 'string' || !UUID.test(key) || !d.enumerable || !Object.hasOwn(d, 'value') || !integer(d.value)) fail();
  }
  return structuredClone(raw);
}

export function newResourceState(world) {
  return checkedResourceState({ v: 1, tick: world.tick, nodes: [...world.resources.nodes.values()].map(n => ({
    id: n.id, kind: n.kind, rev: n.rev, hits: n.hits || 0, readyAt: 0,
  })), cooldowns: {} });
}

export function restoreResourceState(world, raw) {
  const data = checkedResourceState(raw), updates = [];
  if (!integer(world.tick) || data.nodes.length !== world.resources.nodes.size) fail();
  for (const saved of data.nodes) {
    const node = world.resources.nodes.get(saved.id);
    if (!node || node.kind !== saved.kind) fail();
    const remaining = Math.max(0, saved.readyAt - data.tick);
    if (!integer(world.tick + remaining)) fail();
    updates.push([node, { rev: saved.rev, readyTick: remaining ? world.tick + remaining : 0,
      ...(RESOURCE_KINDS[node.kind].hits ? { hits: saved.readyAt > 0 && !remaining ? 0 : saved.hits } : {}) }]);
  }
  // Validate the entire layout before touching any live node.
  for (const [node, update] of updates) Object.assign(node, update);
  return data;
}

export function draftResource(world, entity, command, profile, state, account, tick = world.tick) {
  if (!integer(tick) || tick < state.tick || !UUID.test(account)) fail();
  const resources = checkedResourceState(state), draft = Object.create(world);
  resources.tick = tick;
  draft.profiles = new Map([[entity, structuredClone(profile)]]);
  draft.profileDirty = new Set();
  draft.resources = { ...world.resources, nodes: new Map([...world.resources.nodes].map(([id, n]) => [id, { ...n }])),
    receipts: new Map(), cooldowns: new Map(world.resources.cooldowns) };
  const until = resources.cooldowns[account] || 0;
  if (until > tick && !draft.resources.cooldowns.has(entity))
    draft.resources.cooldowns.set(entity, world.tick + until - tick);
  const events = []; draft.emit = ev => events.push(structuredClone(ev));
  resourceCmd(draft, entity, command, p => !!sanitizeProfile(p) && Buffer.byteLength(JSON.stringify(p)) <= 131072);
  const ack = events.at(-1);
  if (!ack || ack.type !== 'resource') throw new StoreError('effect');
  delete ack.to;
  if (ack.ok) {
    if (command.op === 'gather') {
      const next = draft.resources.nodes.get(command.node), row = resources.nodes.find(n => n.id === command.node);
      if (!row || row.kind !== next.kind) fail();
      row.rev = next.rev; row.hits = next.hits || 0;
      row.readyAt = next.readyTick > world.tick ? tick + next.readyTick - world.tick : 0;
    }
    resources.cooldowns = Object.fromEntries(Object.entries(resources.cooldowns).filter(([, expires]) => expires > tick));
    resources.cooldowns[account] = tick + draft.resources.cooldowns.get(entity) - world.tick;
  }
  return { profile: draft.profiles.get(entity), resources: checkedResourceState(resources),
    resourceRuntime: { tick: world.tick, nodes: draft.resources.nodes, cooldown: draft.resources.cooldowns.get(entity) },
    events: events.slice(0, -1), ack, economy: world.economy };
}

export function applyResource(world, entity, command, proposal) {
  if (world.tick !== proposal.resourceRuntime.tick) throw new StoreError('effect');
  if (!proposal.ack.ok) return;
  if (command.op === 'gather') {
    const node = world.resources.nodes.get(command.node), next = proposal.resourceRuntime.nodes.get(command.node);
    if (!node || node.kind !== next.kind || node.rev + 1 !== next.rev) throw new StoreError('effect');
    Object.assign(node, next);
  }
  if (proposal.resourceRuntime.cooldown !== undefined) world.resources.cooldowns.set(entity, proposal.resourceRuntime.cooldown);
}

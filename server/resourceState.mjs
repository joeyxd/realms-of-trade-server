// Server-side persistence for resource nodes. Simulation helpers keep using local ticks;
// stored deadlines share a durable logical tick. Offline time never advances resource timers.
import { HARVEST, RESOURCE_KINDS } from '../src/data/resources.js';
import { resourceCmd } from '../src/sim/systems/resources.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { loggingStatus, planLoggingHit } from '../src/sim/systems/progression.js';
import { evaluateLoggingChallenge } from '../src/sim/systems/loggingTiming.js';
import { StoreError } from './store.mjs';

const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => object(v) && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable && Object.hasOwn(d, 'value'); });
const fail = () => { throw new StoreError('world_format'); };
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function validateBase(raw, version, strictLegacyHistory = false) {
  if (!exact(raw, version === 1 ? ['v', 'tick', 'nodes', 'cooldowns'] : ['v', 'tick', 'nodes', 'cooldowns', 'logging'])
      || raw.v !== version || !integer(raw.tick) || !Array.isArray(raw.nodes)
      || raw.nodes.length < 1 || raw.nodes.length > HARVEST.maxNodes || !object(raw.cooldowns)
      || Reflect.ownKeys(raw.cooldowns).length > 4096) fail();
  const ids = new Set();
  for (const n of raw.nodes) {
    if (!exact(n, ['id', 'kind', 'rev', 'hits', 'readyAt']) || typeof n.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,40}$/.test(n.id) || ids.has(n.id) || !Object.hasOwn(RESOURCE_KINDS, n.kind)
        || !integer(n.rev, 1, HARVEST.maxRev) || !integer(n.hits, 0, RESOURCE_KINDS[n.kind].hits || 0)
        || !integer(n.readyAt)) fail();
    if (strictLegacyHistory && version === 1 && n.kind === 'palm' && n.hits > 0
        && (n.rev < n.hits + 1 || (n.rev - 1) % HARVEST.palmHits !== n.hits % HARVEST.palmHits)) fail();
    ids.add(n.id);
  }
  for (const key of Reflect.ownKeys(raw.cooldowns)) {
    const d = Object.getOwnPropertyDescriptor(raw.cooldowns, key);
    if (typeof key !== 'string' || !UUID.test(key) || !d.enumerable || !Object.hasOwn(d, 'value') || !integer(d.value)) fail();
  }
  return ids;
}

function checkedV2(raw) {
  const ids = validateBase(raw, 2), palms = raw.nodes.filter(n => n.kind === 'palm');
  if (!exact(raw.logging, palms.map(n => n.id)) || Reflect.ownKeys(raw.logging).some(k => !ids.has(k))) fail();
  for (const n of palms) {
    const ledger = raw.logging[n.id];
    if (ledger === null) {
      if (n.hits < 1 || n.rev < n.hits + 1
          || (n.rev - 1) % HARVEST.palmHits !== n.hits % HARVEST.palmHits
          || (n.hits === HARVEST.palmHits) !== (n.readyAt > 0)) fail();
      continue;
    }
    if (!exact(ledger, ['cycle', 'contributors']) || !integer(ledger.cycle, 1, HARVEST.maxRev)
        || !Array.isArray(ledger.contributors) || ledger.contributors.length > HARVEST.palmHits
        || Reflect.ownKeys(ledger.contributors).length !== ledger.contributors.length + 1) fail();
    let sum = 0, previous = '';
    for (const c of ledger.contributors) {
      if (!exact(c, ['actor', 'hits']) || !UUID.test(c.actor) || c.actor <= previous
          || !integer(c.hits, 1, HARVEST.palmHits)) fail();
      previous = c.actor; sum += c.hits;
    }
    if (sum !== n.hits || n.rev !== 1 + HARVEST.palmHits * (ledger.cycle - 1) + n.hits
        || (n.hits === HARVEST.palmHits ? n.readyAt === 0 : n.readyAt !== 0)) fail();
  }
  return structuredClone(raw);
}

function checkedV3(raw) {
  const ids = validateBase({ ...raw, v: 2 }, 2), palms = raw.nodes.filter(n => n.kind === 'palm');
  if (raw.v !== 3 || !exact(raw, ['v', 'tick', 'nodes', 'cooldowns', 'logging'])
      || !exact(raw.logging, palms.map(n => n.id)) || Reflect.ownKeys(raw.logging).some(k => !ids.has(k))) fail();
  for (const n of palms) {
    const ledger = raw.logging[n.id];
    if (ledger === null) {
      if (n.hits < 1 || n.rev < n.hits + 1
          || (n.rev - 1) % HARVEST.palmHits !== n.hits % HARVEST.palmHits
          || (n.hits === HARVEST.palmHits) !== (n.readyAt > 0)) fail();
      continue;
    }
    if (!exact(ledger, ['cycle', 'contributors', 'quality']) || !integer(ledger.cycle, 1, HARVEST.maxRev)
        || !integer(ledger.quality, 0, HARVEST.palmHits) || !Array.isArray(ledger.contributors)
        || ledger.contributors.length > HARVEST.palmHits
        || Reflect.ownKeys(ledger.contributors).length !== ledger.contributors.length + 1) fail();
    let sum = 0, previous = '';
    for (const c of ledger.contributors) {
      if (!exact(c, ['actor', 'hits']) || !UUID.test(c.actor) || c.actor <= previous
          || !integer(c.hits, 1, HARVEST.palmHits)) fail();
      previous = c.actor; sum += c.hits;
    }
    if (sum !== n.hits || ledger.quality > n.hits
        || n.rev !== 1 + HARVEST.palmHits * (ledger.cycle - 1) + n.hits
        || (n.hits === HARVEST.palmHits ? n.readyAt === 0 : n.readyAt !== 0)) fail();
  }
  return structuredClone(raw);
}

export function checkedResourceState(raw) {
  if (raw?.v === 1) return (validateBase(raw, 1), structuredClone(raw));
  if (raw?.v === 2) return checkedV2(raw);
  if (raw?.v === 3) return checkedV3(raw);
  fail();
}

export function upgradeLoggingState(raw) {
  if (raw?.v === 2) return checkedV2(raw);
  if (raw?.v === 3) return checkedV3(raw);
  validateBase(raw, 1, true);
  const logging = {};
  for (const n of raw.nodes) if (n.kind === 'palm') {
    if (n.hits > 0) logging[n.id] = null;
    else {
      const cycle = 1 + (n.rev - 1) / HARVEST.palmHits;
      if (!integer(cycle, 1, HARVEST.maxRev)) fail();
      logging[n.id] = { cycle, contributors: [] };
    }
  }
  return checkedV2({ ...structuredClone(raw), v: 2, logging });
}

// Opt-in timing schema upgrade. Legacy partial/exhausted cycles stay null and receive no
// retroactive quality; previously tracked v2 cycles start with zero perfect hits.
export function upgradeTimingState(raw) {
  if (raw?.v === 3) return checkedV3(raw);
  if (raw?.v === 2) {
    const v2 = checkedV2(raw), logging = {};
    for (const [id, ledger] of Object.entries(v2.logging))
      logging[id] = ledger === null ? null : { ...ledger, quality: 0 };
    return checkedV3({ ...v2, v: 3, logging });
  }
  validateBase(raw, 1, true);
  const logging = {};
  for (const n of raw.nodes) if (n.kind === 'palm') {
    if (n.hits > 0) logging[n.id] = null;
    else {
      const cycle = 1 + (n.rev - 1) / HARVEST.palmHits;
      if (!integer(cycle, 1, HARVEST.maxRev)) fail();
      logging[n.id] = { cycle, contributors: [], quality: 0 };
    }
  }
  return checkedV3({ ...structuredClone(raw), v: 3, logging });
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
  for (const [node, update] of updates) Object.assign(node, update);
  return data;
}

// Accounts needed to award a finishing hit. A legacy partial cycle is intentionally unawardable.
export function loggingAccounts(raw, command, account, tick) {
  const state = checkedResourceState(raw), row = state.nodes.find(n => n.id === command?.node);
  if (command?.op !== 'gather' || !row || row.kind !== 'palm' || command.expectedRev !== row.rev) return [];
  if (state.v === 1) return [];
  const ledger = state.logging[row.id];
  const expiredLegacy = ledger === null && row.hits === HARVEST.palmHits && row.readyAt <= tick;
  if (ledger === null && !expiredLegacy) return [];
  const effectiveHits = expiredLegacy ? 0 : row.hits;
  if (effectiveHits + 1 !== HARVEST.palmHits) return [];
  return [...new Set([account, ...(expiredLegacy ? [] : ledger.contributors.map(c => c.actor))])].sort(cmp);
}

function checkedTimingProof(proof, nodeId, rev) {
  if (!exact(proof, ['challenge', 'receivedTick', 'quality']) || !exact(proof.challenge,
      ['v', 'node', 'rev', 'startTick', 'targetTick', 'endTick', 'width'])) fail();
  let result;
  try { result = evaluateLoggingChallenge(proof.challenge, { rev, receivedTick: proof.receivedTick }); }
  catch { fail(); }
  if (proof.challenge.node !== nodeId || proof.challenge.rev !== rev || proof.quality !== result.quality) fail();
  return { challenge: { ...proof.challenge }, receivedTick: proof.receivedTick, quality: result.quality };
}

export function draftResource(world, entity, command, profile, state, account, tick = world.tick, profiles = new Map(), timingProof = null) {
  if (!integer(tick) || tick < state.tick || !UUID.test(account)) fail();
  const resources = checkedResourceState(state), draft = Object.create(world);
  resources.tick = tick;
  draft.profiles = new Map([[entity, structuredClone(profile)]]);
  draft.profileDirty = new Set();
  draft.resources = { ...world.resources, nodes: new Map([...world.resources.nodes].map(([id, n]) => [id, { ...n }])),
    receipts: new Map(), cooldowns: new Map(world.resources.cooldowns) };
  draft.loggingTimingVersion = resources.v;
  draft.loggingState = resources;
  draft.loggingProof = timingProof;
  const until = resources.cooldowns[account] || 0;
  if (until > tick && !draft.resources.cooldowns.has(entity))
    draft.resources.cooldowns.set(entity, world.tick + until - tick);
  const events = []; draft.emit = ev => events.push(structuredClone(ev));
  resourceCmd(draft, entity, command, p => !!sanitizeProfile(p) && Buffer.byteLength(JSON.stringify(p)) <= 131072);
  const ack = events.at(-1);
  if (!ack || ack.type !== 'resource') throw new StoreError('effect');
  delete ack.to;
  const resultingProfiles = new Map([[account, structuredClone(draft.profiles.get(entity))]]);
  let loggingAwards = [];
  if (ack.ok) {
    if (command.op === 'gather') {
      const next = draft.resources.nodes.get(command.node), row = resources.nodes.find(n => n.id === command.node);
      if (!row || row.kind !== next.kind) fail();
      const sourceRow = { ...row };
      row.rev = next.rev; row.hits = next.hits || 0;
      row.readyAt = next.readyTick > world.tick ? tick + next.readyTick - world.tick : 0;
      if (row.kind === 'palm' && resources.v >= 2) {
        const preAwardStatus = loggingStatus(draft.profiles.get(entity).progression);
        ack.actionTicks = preAwardStatus.actionTicks; ack.loggingStatus = preAwardStatus;
        draft.resources.cooldowns.set(entity, world.tick + preAwardStatus.actionTicks);
        let ledger = resources.logging[row.id];
        if (ledger === null) {
          if (sourceRow.hits < HARVEST.palmHits) {
            // Finish the legacy cycle without distributing practice.
          } else if (sourceRow.readyAt <= tick) {
            const cycle = 1 + (sourceRow.rev - 1) / HARVEST.palmHits;
            if (!integer(cycle, 1, HARVEST.maxRev)) fail();
            ledger = resources.v === 3 ? { cycle, contributors: [], quality: 0 } : { cycle, contributors: [] };
          }
        }
        if (ledger && (ledger === resources.logging[row.id] || next.hits === 1)) {
          const rawNode = ledger === resources.logging[row.id]
            ? { id: row.id, kind: 'palm', rev: sourceRow.rev, cycle: ledger.cycle, hits: sourceRow.hits,
              readyTick: sourceRow.readyAt, contributors: ledger.contributors }
            : { id: row.id, kind: 'palm', rev: sourceRow.rev, cycle: ledger.cycle, hits: 0,
              readyTick: 0, contributors: [] };
          const beneficiaryIds = next.hits === HARVEST.palmHits
            ? [...new Set([...ledger.contributors.map(c => c.actor), account])].sort(cmp) : [account];
          const beneficiaries = beneficiaryIds.map(actor => ({ actor,
            progression: actor === account ? draft.profiles.get(entity).progression : profiles.get(actor)?.progression }));
          const plan = planLoggingHit(rawNode, { actor: account, expectedRev: rawNode.rev, tick }, beneficiaries);
          if (plan.node.rev !== next.rev || plan.node.hits !== next.hits
              || plan.node.readyTick !== (next.hits === HARVEST.palmHits ? tick + HARVEST.respawnTicks : 0)) fail();
          let quality = 0;
          if (resources.v === 3) {
            const proof = checkedTimingProof(timingProof, row.id, sourceRow.rev);
            const sameCycle = plan.node.cycle === ledger.cycle;
            quality = (sameCycle ? ledger.quality : 0) + proof.quality;
            if (quality > plan.node.hits || ack.count !== (plan.node.hits === HARVEST.palmHits ? 3 + quality : 0)
                || !ack.timing || JSON.stringify(ack.timing) !== JSON.stringify(proof)) fail();
          }
          resources.logging[row.id] = { cycle: plan.node.cycle, contributors: plan.node.contributors,
            ...(resources.v === 3 ? { quality } : {}) };
          loggingAwards = plan.awards;
          for (const award of plan.awards) {
            const base = award.actor === account ? draft.profiles.get(entity) : profiles.get(award.actor);
            if (!base) fail();
            const candidate = { ...structuredClone(base), progression: award.progression };
            if (!sanitizeProfile(candidate) || Buffer.byteLength(JSON.stringify(candidate)) > 131072) fail();
            resultingProfiles.set(award.actor, candidate);
          }
          ack.actionTicks = plan.actionTicks;
          draft.resources.cooldowns.set(entity, world.tick + plan.actionTicks);
          if (resultingProfiles.has(account)) draft.profiles.set(entity, resultingProfiles.get(account));
        } else if (resources.v === 3) {
          const proof = checkedTimingProof(timingProof, row.id, sourceRow.rev);
          if (ack.count !== (next.hits === HARVEST.palmHits ? 3 : 0)
              || !ack.timing || JSON.stringify(ack.timing) !== JSON.stringify(proof)) fail();
        }
      }
    }
    resources.cooldowns = Object.fromEntries(Object.entries(resources.cooldowns).filter(([, expires]) => expires > tick));
    resources.cooldowns[account] = tick + draft.resources.cooldowns.get(entity) - world.tick;
  }
  for (const [actor, candidate] of resultingProfiles) {
    if (!sanitizeProfile(candidate) || Buffer.byteLength(JSON.stringify(candidate)) > 131072) fail();
    resultingProfiles.set(actor, structuredClone(candidate));
  }
  return { profile: resultingProfiles.get(account), profiles: resultingProfiles, loggingAwards,
    resources: checkedResourceState(resources),
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

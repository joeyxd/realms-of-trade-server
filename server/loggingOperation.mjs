// Bounded multi-profile extension of the existing M5 economic receipt. No second writer.
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { readProgression, loggingShares, loggingStatus, planLoggingHit } from '../src/sim/systems/progression.js';
import { LOGGING } from '../src/data/progression.js';
import { HARVEST } from '../src/data/resources.js';
import { evaluateLoggingChallenge } from '../src/sim/systems/loggingTiming.js';

const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = () => { throw new Error('logging operation'); };
const copy = structuredClone;
// Callers validate descriptor-safe JSON before entering this module.
const text = v => JSON.stringify(sort(v));
const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
const same = (a, b) => text(a) === text(b);
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));

function timingQuality(request, node) {
  const timing = request.ack.timing;
  if (!exact(timing, ['challenge', 'receivedTick', 'quality'])
      || !exact(timing.challenge, ['v', 'node', 'rev', 'startTick', 'targetTick', 'endTick', 'width'])
      || timing.challenge.node !== node.id || timing.challenge.rev !== node.rev) fail();
  let result;
  try { result = evaluateLoggingChallenge(timing.challenge, { rev: node.rev, receivedTick: timing.receivedTick }); }
  catch { fail(); }
  if (timing.quality !== result.quality || !same(request.ack.timing, timing)) fail();
  return result.quality;
}

export function loggingParticipants(request) {
  if (!Object.hasOwn(request, 'beneficiaries')) return null;
  const { beneficiaries: rows, command, worldData, account, profile, expectedProfileVersion } = request;
  const node = worldData.resources?.nodes.find(n => n.id === command.node);
  if (command.type !== 'resource' || command.op !== 'gather' || ![2, 3].includes(worldData.resources?.v)
      || node?.kind !== 'palm' || !Array.isArray(rows) || rows.length < 1 || rows.length > 3) fail();
  let previous = '', actor = null;
  const checked = rows.map(row => {
    if (!exact(row, ['account', 'expectedVersion', 'before', 'profile']) || !UUID.test(row.account)
        || row.account <= previous || !Number.isSafeInteger(row.expectedVersion)
        || row.expectedVersion < 1 || row.expectedVersion >= 2147483647) fail();
    previous = row.account;
    for (const p of [row.before, row.profile]) {
      if (!p || Buffer.byteLength(JSON.stringify(p)) > 131072 || !same(sanitizeProfile(p), p)) fail();
    }
    if (row.account === account) actor = row;
    else {
      const before = { ...row.before }, after = { ...row.profile };
      delete before.progression; delete after.progression;
      if (!same(before, after)) fail();
    }
    return copy(row);
  });
  if (!actor || actor.expectedVersion !== expectedProfileVersion || !same(actor.profile, profile)) fail();
  const expectedActor = copy(actor.before), actualActor = copy(actor.profile);
  delete expectedActor.progression; delete actualActor.progression;
  const v3 = worldData.resources.v === 3;
  if (request.ack.ok && node.hits === 3) {
    const ledger = worldData.resources.logging[node.id];
    const expectedCount = v3 ? 3 + (ledger === null ? 0 : ledger.quality) : 2;
    if (request.ack.count !== expectedCount || request.ack.good !== 'tronco') fail();
    expectedActor.eco.pack.goods.tronco = (expectedActor.eco.pack.goods.tronco || 0) + expectedCount;
    expectedActor.eco.tradeRev++;
  }
  if (!same(expectedActor, actualActor)) fail();
  // Practice can only be materialized at the end of a credited cycle. Every contributor is present.
  const ledger = worldData.resources.logging[node.id];
  const completed = request.ack.ok && node.hits === 3 && ledger !== null
    && request.ack.count === (v3 ? 3 + ledger.quality : 2);
  const shares = completed ? loggingShares(ledger.contributors) : [];
  const expectedAccounts = [...new Set([account, ...shares.map(r => r.actor)])].sort();
  if (!same(checked.map(r => r.account), expectedAccounts)) fail();
  for (const row of checked) {
    const share = shares.find(r => r.actor === row.account);
    if (!share) {
      if (!same(row.before.progression ?? null, row.profile.progression ?? null)) fail();
      continue;
    }
    const p = readProgression(row.before.progression);
    p.practice.logging = Math.min(LOGGING.maxPractice, p.practice.logging + share.amount);
    if (p.practice.logging >= LOGGING.firstMilestoneAt && !p.milestones.includes(LOGGING.milestone)) p.milestones.push(LOGGING.milestone);
    if (!same(p, row.profile.progression)) fail();
  }
  return checked;
}

export function loggingResultProfiles(request) {
  return request.beneficiaries?.map(r => ({ account: r.account, version: r.expectedVersion + 1 }));
}

function loggingV3Transition(current, request) {
  const old = current.nodes.find(n => n.id === request.command.node);
  if (old?.kind !== 'palm') return true;
  try {
    if (!request.beneficiaries) return false;
    const next = request.worldData.resources, node = next.nodes.find(n => n.id === old.id);
    if (next.v !== 3 || !node || !same(current.nodes.filter(n => n.id !== old.id), next.nodes.filter(n => n.id !== old.id))) return false;
    const expectedLogging = copy(current.logging);
    if (!request.ack.ok) return same(old, node) && same(current.logging, next.logging) && same(current.cooldowns, next.cooldowns)
      && request.beneficiaries.every(row => same(row.before, row.profile));
    if (request.command.expectedRev !== old.rev || old.readyAt > next.tick) return false;
    const actor = request.beneficiaries.find(r => r.account === request.account);
    const status = loggingStatus(actor?.before.progression), actionTicks = status.actionTicks;
    const quality = timingQuality(request, old);
    const cooldowns = Object.fromEntries(Object.entries(current.cooldowns).filter(([, until]) => until > next.tick));
    cooldowns[request.account] = next.tick + actionTicks;
    if ((current.cooldowns[request.account] || 0) > next.tick || request.ack.actionTicks !== actionTicks
        || !same(cooldowns, next.cooldowns) || request.ack.rev !== node.rev) return false;
    let ledger = current.logging[old.id], source = old, legacyUncredited = false;
    if (ledger === null) {
      if (old.hits < HARVEST.palmHits) legacyUncredited = true;
      else if (old.readyAt <= next.tick) {
        const cycle = 1 + (old.rev - 1) / HARVEST.palmHits;
        if (!Number.isSafeInteger(cycle)) return false;
        ledger = { cycle, contributors: [], quality: 0 };
        source = { ...old, hits: 0, readyAt: 0 };
      } else legacyUncredited = true;
    }
    if (ledger && !legacyUncredited) {
      const raw = { id: old.id, kind: 'palm', rev: source.rev, cycle: ledger.cycle,
        hits: source.hits, readyTick: source.readyAt, contributors: copy(ledger.contributors) };
      const actors = raw.hits === 2 ? [...new Set([request.account, ...ledger.contributors.map(c => c.actor)])].sort() : [request.account];
      const profiles = actors.map(actorId => ({ actor: actorId,
        progression: request.beneficiaries.find(r => r.account === actorId)?.before.progression }));
      const plan = planLoggingHit(raw, { actor: request.account, expectedRev: old.rev, tick: next.tick }, profiles);
      const cycleQuality = plan.node.cycle === ledger.cycle ? ledger.quality + quality : quality;
      expectedLogging[old.id] = { cycle: plan.node.cycle, contributors: plan.node.contributors, quality: cycleQuality };
      if (!same(node, { id: old.id, kind: 'palm', rev: plan.node.rev, hits: plan.node.hits, readyAt: plan.node.readyTick })) return false;
      if (request.ack.count !== (plan.node.hits === HARVEST.palmHits ? 3 + cycleQuality : 0)) return false;
    } else {
      if (request.ack.count !== (node.hits === HARVEST.palmHits ? 3 : 0)
          || node.rev !== old.rev + 1 || node.hits !== (old.hits === HARVEST.palmHits && old.readyAt <= next.tick ? 1 : old.hits + 1)
          || node.hits > HARVEST.palmHits
          || (node.hits === HARVEST.palmHits ? node.readyAt !== next.tick + HARVEST.respawnTicks : node.readyAt !== 0)) return false;
    }
    return same(expectedLogging, next.logging);
  } catch { return false; }
}

// Recompute the node/credit transition from the locked world baseline, rather than trusting a
// completed ledger supplied under a new operation ID. Eligibility (range/tool/calm) is host-owned.
export function loggingWorldTransition(current, request) {
  if (current?.v === 3 && request.command.type === 'resource' && request.command.op === 'gather')
    return loggingV3Transition(current, request);
  if (current?.v !== 2 || request.command.type !== 'resource' || request.command.op !== 'gather') return true;
  const old = current.nodes.find(n => n.id === request.command.node);
  if (old?.kind !== 'palm') return true;
  try {
    if (!request.beneficiaries) return false;
    const next = request.worldData.resources, node = next.nodes.find(n => n.id === old.id);
    if (next.v !== 2 || !node || !same(current.nodes.filter(n => n.id !== old.id), next.nodes.filter(n => n.id !== old.id))) return false;
    const expectedLogging = copy(current.logging);
    if (!request.ack.ok) return same(old, node) && same(current.logging, next.logging) && same(current.cooldowns, next.cooldowns)
      && request.beneficiaries.every(row => same(row.before, row.profile));
    if (request.command.expectedRev !== old.rev || old.readyAt > next.tick) return false;
    const actor = request.beneficiaries.find(r => r.account === request.account);
    const status = loggingStatus(actor?.before.progression), actionTicks = status.actionTicks;
    if (Object.hasOwn(request.ack, 'loggingStatus') && !same(request.ack.loggingStatus, status)) return false;
    const cooldowns = Object.fromEntries(Object.entries(current.cooldowns).filter(([, until]) => until > next.tick));
    cooldowns[request.account] = next.tick + actionTicks;
    if ((current.cooldowns[request.account] || 0) > next.tick || request.ack.actionTicks !== actionTicks
        || !same(cooldowns, next.cooldowns) || request.ack.rev !== node.rev
        || request.ack.count !== (node.hits === 3 ? 2 : 0)) return false;
    let ledger = current.logging[old.id];
    let source = old;
    if (ledger === null && old.hits === 3 && old.readyAt <= next.tick) {
      ledger = { cycle: 1 + (old.rev - 1) / 3, contributors: [] };
      source = { ...old, hits: 0, readyAt: 0 };
    }
    if (ledger) {
      const raw = { id: old.id, kind: 'palm', rev: source.rev, cycle: ledger.cycle,
        hits: source.hits, readyTick: source.readyAt, contributors: copy(ledger.contributors) };
      const actors = raw.hits === 2 ? [...new Set([request.account, ...ledger.contributors.map(c => c.actor)])].sort() : [request.account];
      const profiles = actors.map(actor => ({ actor, progression: request.beneficiaries.find(r => r.account === actor)?.before.progression }));
      const plan = planLoggingHit(raw, { actor: request.account, expectedRev: old.rev, tick: next.tick }, profiles);
      expectedLogging[old.id] = { cycle: plan.node.cycle, contributors: plan.node.contributors };
      if (!same(node, { id: old.id, kind: 'palm', rev: plan.node.rev, hits: plan.node.hits, readyAt: plan.node.readyTick })) return false;
      if (request.ack.actionTicks !== plan.actionTicks) return false;
    } else {
      // Legacy partial cycles keep their provenance explicitly unknown and distribute no practice.
      if (node.rev !== old.rev + 1 || node.hits !== old.hits + 1 || node.hits > 3
          || (node.hits === 3 ? node.readyAt !== next.tick + HARVEST.respawnTicks : node.readyAt !== 0)) return false;
    }
    return same(expectedLogging, next.logging);
  } catch { return false; }
}

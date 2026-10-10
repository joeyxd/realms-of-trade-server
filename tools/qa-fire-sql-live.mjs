// Local-only, bounded SQL022 acceptance canary. This tool is prepared for an operator to run after
// migration activation; it is deliberately not run during implementation and never prints secrets.
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { fireClockSeconds } from '../src/data/fire.js';
import { fireProfileDelta } from '../src/sim/systems/fireProfile.js';

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
};
class QaFailure extends Error { constructor(code) { super(code); this.code = code; } }
const ensure = (ok, code) => { if (!ok) throw new QaFailure(code); };
const unwrap = result => {
  if (!result || result.error) throw new QaFailure(`provider_${result?.error?.code || 'error'}`);
  return result.data;
};
const stable = value => {
  const sort = item => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
};
const same = (a, b) => stable(a) === stable(b);
const tag = randomUUID().replaceAll('-', '');
let admin = null, store = null, account = randomUUID(), world = `qa-fire-sql-${tag}`;
let profileCreated = false, worldCreated = false;
const receiptIds = new Set();
const checks = {};

function requireSharedEnv() {
  const arg = process.execArgv.find(value => value.startsWith('--env-file='));
  ensure(arg, 'explicit_env_file_required');
  let file, parsed;
  try {
    file = arg.slice('--env-file='.length);
    parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  } catch { throw new QaFailure('env_file_unavailable'); }
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])
    ensure(typeof parsed[key] === 'string' && parsed[key].length > 0 && parsed[key] === process.env[key], 'provider_env_mismatch');
  let url;
  try { url = new URL(process.env.SUPABASE_URL); } catch { throw new QaFailure('provider_url_invalid'); }
  ensure(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'provider_url_invalid');
  return url;
}

async function assertUnclaimedIdentifiers() {
  for (const [table, field, value] of [['mn_profiles', 'player_id', account], ['mn_worlds', 'world', world]]) {
    const row = unwrap(await admin.from(table).select(field).eq(field, value).maybeSingle());
    ensure(row === null, 'random_identity_collision');
  }
}

async function insertIdentity(profile, worldData) {
  unwrap(await admin.from('mn_profiles').insert({ player_id: account, data: profile, version: 1 }).select('player_id').single());
  profileCreated = true;
  unwrap(await admin.from('mn_worlds').insert({ world, economy: worldData, version: 1 }).select('world').single());
  worldCreated = true;
}

async function profileSnapshot() {
  const row = unwrap(await admin.from('mn_profiles').select('data,version').eq('player_id', account).single());
  return { data: row.data, version: row.version };
}
async function worldSnapshot() {
  const row = unwrap(await admin.from('mn_worlds').select('economy,version').eq('world', world).single());
  return { data: row.economy, version: row.version };
}
function operationId() {
  const id = randomUUID(); receiptIds.add(id); return id;
}
async function submit(command, before, delta, snapshots) {
  const id = operationId();
  ensure(await store.loadEconomicOperation(id) === null, 'receipt_identity_collision');
  const request = { world, account, command, expectedProfileVersion: snapshots.profile.version,
    expectedWorldVersion: snapshots.world.version, before, profile: delta.profile,
    worldData: snapshots.world.data,
    ack: { type: 'fire', op: command.op, opId: command.opId, ok: true, why: '', rev: delta.profile.fire.rev } };
  const result = await store.commitEconomicOperation({ operationId: id, request });
  ensure(result?.ok === true && result.replay === false, 'operation_commit_failed');
  const replay = await store.commitEconomicOperation({ operationId: id, request });
  ensure(replay?.ok === true && replay.replay === true && same(replay.ack, request.ack), 'exact_replay_failed');
  return { id, request, result, replay };
}

async function main() {
  requireSharedEnv();
  admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
  store = storeFromEnv();
  const readiness = await store.checkFireOperations();
  ensure(readiness.version === 1, 'fire_readiness_mismatch');
  checks.readiness = { pass: true, version: 1 };

  const profile = newProfile();
  profile.eco.pack.goods.madera = 2;
  const economy = new Economy(828221);
  const worldData = { v: 1, seed: 828221, economy: economy.serialize() };
  await assertUnclaimedIdentifiers();
  await insertIdentity(profile, worldData);
  checks.isolatedIdentity = { pass: true, accountCreated: true, worldCreated: true };

  let snapshots = { profile: await profileSnapshot(), world: await worldSnapshot() };
  const now = fireClockSeconds(snapshots.world.data.economy.hours);
  const handLoad = { type: 'fire', op: 'load', opId: `qa-load-${tag.slice(0, 20)}`,
    ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: true };
  const handDelta = fireProfileDelta(snapshots.profile.data, handLoad, now);
  ensure(handDelta.why === '', 'hand_load_draft_failed');
  const loadReceipt = await submit(handLoad, snapshots.profile.data, handDelta, snapshots);
  snapshots.profile = await profileSnapshot(); snapshots.world = await worldSnapshot();
  ensure(snapshots.profile.data.eco.pack.goods.madera === 1 &&
    snapshots.profile.data.fire.slots.hand.seconds === 1200 && snapshots.profile.data.fire.slots.hand.since === now,
  'hand_load_delta_mismatch');
  ensure(snapshots.profile.version === 2 && snapshots.world.version === 2, 'hand_load_versions_mismatch');
  checks.handLoad = { pass: true, receiptHash: loadReceipt.id.slice(0, 8), oneWoodSpent: true, replayNoDoubleDebit: true };

  const handSet = { type: 'fire', op: 'set', opId: `qa-set-${tag.slice(0, 20)}`,
    ship: '', part: 'hand', kind: 'handTorch', expectedRev: 1, lit: false };
  const setDelta = fireProfileDelta(snapshots.profile.data, handSet, now);
  ensure(setDelta.why === '', 'hand_set_draft_failed');
  const setReceipt = await submit(handSet, snapshots.profile.data, setDelta, snapshots);
  snapshots.profile = await profileSnapshot(); snapshots.world = await worldSnapshot();
  ensure(snapshots.profile.data.eco.pack.goods.madera === 1 && snapshots.profile.data.fire.rev === 2 &&
    snapshots.profile.data.fire.slots.hand.lit === false, 'hand_set_delta_mismatch');
  checks.handSet = { pass: true, receiptHash: setReceipt.id.slice(0, 8), noWoodSpent: true, replayExact: true };

  const stationProfile = structuredClone(snapshots.profile.data);
  const raft = stationProfile.eco.ships[0];
  ensure(raft && raft.kind === 'raft', 'station_fixture_unavailable');
  raft.id = `qa-raft-${tag.slice(0, 16)}`;
  raft.grid.parts.push(['torchFloor', 0, 0, 0, 0]);
  raft.condition = { v: 1, next: 2, entries: [['p1', 'torchFloor', 0, 0, 0, 0, 10]] };
  raft.hold.goods.madera = 1;
  stationProfile.eco.pack.goods.madera = 1;
  // Add this isolated fixture state without touching any other account or world.
  const saved = unwrap(await admin.from('mn_profiles').update({ data: stationProfile, version: snapshots.profile.version + 1 })
    .eq('player_id', account).eq('version', snapshots.profile.version)
    .select('player_id').single());
  ensure(saved.player_id === account, 'station_fixture_write_failed');
  snapshots.profile = await profileSnapshot();
  const stationLoad = { type: 'fire', op: 'load', opId: `qa-floor-${tag.slice(0, 20)}`,
    ship: raft.id, part: 'p1', kind: 'torchFloor', expectedRev: 2, lit: true };
  const stationDelta = fireProfileDelta(snapshots.profile.data, stationLoad, now);
  ensure(stationDelta.why === '', 'station_load_draft_failed');
  const stationReceipt = await submit(stationLoad, snapshots.profile.data, stationDelta, snapshots);
  snapshots.profile = await profileSnapshot(); snapshots.world = await worldSnapshot();
  const storedRaft = snapshots.profile.data.eco.ships.find(ship => ship.id === raft.id);
  ensure(storedRaft.hold.goods.madera === undefined && snapshots.profile.data.eco.pack.goods.madera === 1 &&
    snapshots.profile.data.fire.slots[JSON.stringify([raft.id, 'p1'])].seconds === 3600,
  'station_hold_first_delta_mismatch');
  checks.floorStation = { pass: true, receiptHash: stationReceipt.id.slice(0, 8), holdSpentBeforePack: true };

  const resetCandidate = structuredClone(snapshots.profile.data); delete resetCandidate.fire;
  const resetId = operationId(); ensure(await store.loadEconomicOperation(resetId) === null, 'receipt_identity_collision');
  const resetRequest = { world, account,
    command: { type: 'commerce', op: 'buy', opId: `qa-reset-${tag.slice(0, 20)}`, town: 'aldea', g: 'fruta', n: 1, expectedTotal: 0 },
    expectedProfileVersion: snapshots.profile.version, expectedWorldVersion: snapshots.world.version,
    profile: resetCandidate, worldData: snapshots.world.data,
    ack: { type: 'commerce', op: 'buy', opId: `qa-reset-${tag.slice(0, 20)}`, ok: true, why: '', rev: 1 } };
  const reset = await store.commitEconomicOperation({ operationId: resetId, request: resetRequest });
  ensure(reset?.ok === false && reset.why === 'conflict', 'commerce_reset_guard_failed');
  ensure(await store.loadEconomicOperation(resetId) === null, 'commerce_reset_receipt_created');
  checks.nonfireReset = { pass: true, denied: true };

  const malformedId = operationId(); ensure(await store.loadEconomicOperation(malformedId) === null, 'receipt_identity_collision');
  const malformedCommand = { type: 'fire', op: 'load', opId: `qa-null-${tag.slice(0, 20)}`,
    ship: '', part: 'hand', kind: null, expectedRev: snapshots.profile.data.fire.rev, lit: true };
  const malformedRequest = { world, account, command: malformedCommand,
    expectedProfileVersion: snapshots.profile.version, expectedWorldVersion: snapshots.world.version,
    before: snapshots.profile.data, profile: snapshots.profile.data, worldData: snapshots.world.data,
    ack: { type: 'fire', op: 'load', opId: malformedCommand.opId, ok: false, why: 'input', rev: 0 } };
  const malformed = unwrap(await admin.rpc('mn_commit_economic_operation', {
    p_operation_id: malformedId, p_request: malformedRequest,
  }));
  ensure(malformed?.ok === false && malformed.why === 'operation', 'null_kind_sql_rejection_failed');
  ensure(await store.loadEconomicOperation(malformedId) === null, 'malformed_receipt_created');
  checks.malformedKind = { pass: true, denied: true, nullEnumDenied: true };
}

async function cleanup() {
  const result = { receiptsDeleted: true, profileDeleted: profileCreated === false, worldDeleted: worldCreated === false };
  for (const id of receiptIds) {
    try {
      const deleted = unwrap(await admin.from('mn_economic_operations').delete().eq('operation_id', id).select('operation_id'));
      ensure(Array.isArray(deleted) && deleted.length <= 1 && deleted.every(row => row.operation_id === id), 'receipt_cleanup_identity_mismatch');
    } catch { result.receiptsDeleted = false; }
  }
  if (profileCreated) {
    try {
      const rows = unwrap(await admin.from('mn_profiles').delete().eq('player_id', account).select('player_id'));
      result.profileDeleted = Array.isArray(rows) && rows.length === 1 && rows[0].player_id === account;
    } catch { result.profileDeleted = false; }
  }
  if (worldCreated) {
    try {
      const rows = unwrap(await admin.from('mn_worlds').delete().eq('world', world).select('world'));
      result.worldDeleted = Array.isArray(rows) && rows.length === 1 && rows[0].world === world;
    } catch { result.worldDeleted = false; }
  }
  return result;
}

let failureCode = null, cleanupResult = { receiptsDeleted: true, profileDeleted: true, worldDeleted: true };
try { await main(); }
catch (error) { failureCode = error instanceof QaFailure ? error.code : 'unexpected_failure'; }
finally {
  if (admin) cleanupResult = await cleanup();
  const pass = failureCode === null && Object.values(cleanupResult).every(Boolean);
  console.log(JSON.stringify({ pass, failureCode: failureCode || undefined,
    checkNames: Object.keys(checks), cleanup: cleanupResult }));
  if (!pass) process.exitCode = 1;
}

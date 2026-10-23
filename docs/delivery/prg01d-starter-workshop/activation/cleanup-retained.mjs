#!/usr/bin/env node
// Remove only the exact disposable workshop QA identity after the public host is fully idle.
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../../../../server/store.mjs';
import { economicOperationId } from '../../../../server/economicAuthority.mjs';

const marker = 'mnQaWorkshopPublic:c59f3d35-41eb-4532-945e-f58e436b2b66';
const markerPrefix = 'mnQaWorkshopPublic:';
const tag = marker.slice(markerPrefix.length);
const timeout = ms => AbortSignal.timeout(ms);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const usage = 'usage: node docs/delivery/prg01d-starter-workshop/activation/cleanup-retained.mjs [--env-file PATH]';

let envFile = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (process.argv[i] === '--help' || process.argv[i] === '-h') { console.log(usage); process.exit(0); }
  else throw new Error(usage);
}
if (envFile) {
  try { process.loadEnvFile(envFile); } catch { throw new Error('environment file unavailable'); }
}
ensure(process.env.MN_QA_ALLOW_CLEANUP === '1', 'Cleanup guard active; set MN_QA_ALLOW_CLEANUP=1 to proceed.');
ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY,
  'Supabase cleanup configuration unavailable');
ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tag),
  'fixed QA marker is invalid');

const base = new URL(process.env.MN_WORKSHOP_TARGET || 'https://marea.62.171.136.148.sslip.io');
ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname),
  'public TLS status target required');
base.search = ''; base.hash = '';
const basePath = base.pathname.replace(/\/$/, '');
const url = suffix => new URL(`${basePath}${suffix}`, base);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) },
});
const store = storeFromEnv();
const worldId = process.env.WORLD_ID || 'marea-negra';
const expectedEmail = `mn-workshop-qa-${tag}@example.com`;
const firstReceiptIdFor = accountId => economicOperationId(worldId, accountId, 'workshop-first-storage-credit');

async function publicStatus() {
  let health, response, status;
  try {
    health = await fetch(url('/health'), { cache: 'no-store', signal: timeout(10000) });
    response = await fetch(url('/status'), { cache: 'no-store', signal: timeout(10000) });
    status = await response.json();
  } catch { throw new Error('public status unavailable; cleanup withheld'); }
  let healthText = '';
  try { healthText = await health.text(); } catch {}
  const storage = status?.storage, economic = storage?.economic, world = storage?.world;
  ensure(health.ok && healthText.trim() === 'ok' && response.ok
    && status.players === 0 && status.sockets === 0 && status.errors === 0
    && storage?.errors === 0 && storage.unsaved === 0 && storage.profileWrites === 0
    && storage.worldWriting === false
    && economic?.enabled === true && economic.failed === false && economic.pending === 0
    && storage.tickBlocked === false && world?.id === worldId && world.ready === true && world.failed === false
    && storage.workshop?.enabled === true && storage.workshop?.ready === true
    && storage.artisan?.enabled === true && storage.artisan?.ready === true
    && storage.resources?.enabled === true && storage.resources?.ready === true,
  'public host is not healthy, ready, idle, and fully drained; cleanup withheld');
  return { version: status.version, players: status.players, sockets: status.sockets,
    errors: status.errors, unsaved: storage.unsaved, profileWrites: storage.profileWrites,
    economicPending: economic.pending, workshopReady: storage.workshop.ready,
    artisanReady: storage.artisan.ready, resourcesReady: storage.resources.ready };
}

async function matchingUsers() {
  const matches = [];
  for (let page = 1; page <= 100; page++) {
    let result;
    try { result = await admin.auth.admin.listUsers({ page, perPage: 1000 }); }
    catch { throw new Error('exact QA identity lookup failed'); }
    ensure(!result.error && Array.isArray(result.data?.users), 'exact QA identity lookup failed');
    const batch = result.data.users;
    matches.push(...batch.filter(user => user.user_metadata?.mn_qa_marker === marker));
    if (batch.length < 1000) return matches;
  }
  throw new Error('bounded Auth identity scan exceeded its limit');
}

async function receiptIds(accountId) {
  const ids = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    let result;
    try {
      result = await admin.from('mn_economic_operations').select('operation_id')
        .eq('request->>account', accountId).order('operation_id', { ascending: true })
        .range(offset, offset + 999);
    } catch { throw new Error('economic receipt inventory failed'); }
    ensure(!result.error && Array.isArray(result.data), 'economic receipt inventory failed');
    for (const row of result.data) {
      ensure(typeof row.operation_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.operation_id),
      'economic receipt inventory returned an invalid row');
      ids.push(row.operation_id);
    }
    if (result.data.length < 1000) return ids;
  }
  throw new Error('bounded economic receipt inventory exceeded its limit');
}

async function verifyReceipts(accountId, expected) {
  const actual = await receiptIds(accountId);
  ensure(JSON.stringify(actual) === JSON.stringify(expected), 'economic receipt set changed during cleanup');
  for (const id of expected) {
    let receipt;
    try { receipt = await store.loadEconomicOperation(id); }
    catch { throw new Error('retained economic receipt failed validation'); }
    ensure(receipt?.request?.account === accountId, 'retained economic receipt ownership mismatch');
  }
}

async function run() {
  const initialStatus = await publicStatus();
  const ready = await admin.rpc('mn_workshop_raft_identifiers_ready');
  ensure(!ready.error && ready.data?.version === 1, 'SQL026 readiness unavailable; cleanup withheld');
  const users = await matchingUsers();
  ensure(users.length <= 1, 'QA Auth marker is ambiguous; cleanup withheld');
  if (users.length === 0) {
    console.log(JSON.stringify({ pass: true, status: 'already_absent_noop', mutated: false,
      publicVersion: initialStatus.version }));
    return;
  }

  const user = users[0], accountId = user.id;
  ensure(user.email === expectedEmail && user.user_metadata?.mn_qa_marker === marker,
    'exact QA Auth email/marker mismatch; cleanup withheld');
  const row = await store.loadProfile(accountId);
  if (row) {
    ensure(row.data?.pirateId === `account:${accountId}` && row.data?.workshop?.v === 1
      && row.data.workshop.storageCredit === true && row.data.workshop.crateKits === 1,
    'exact QA profile ownership or retained workshop credit mismatch; cleanup withheld');
  }
  const firstReceipt = await store.loadEconomicOperation(firstReceiptIdFor(accountId));
  ensure(firstReceipt === null, 'failed first storage operation unexpectedly has a receipt; cleanup withheld');
  const retainedIds = await receiptIds(accountId);
  await verifyReceipts(accountId, retainedIds);

  const beforeProfileDeleteStatus = await publicStatus();
  if (row) {
    let deleted;
    try {
      deleted = await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id');
    } catch { throw new Error('exact QA profile deletion failed'); }
    ensure(!deleted.error && deleted.data?.length === 1 && deleted.data[0].player_id === accountId,
      'exact QA profile deletion failed');
    ensure(await store.loadProfile(accountId) === null, 'QA profile remains after exact-row deletion');
  }

  await publicStatus();
  const currentUsers = await matchingUsers();
  ensure(currentUsers.length === 1 && currentUsers[0].id === accountId
    && currentUsers[0].email === expectedEmail && currentUsers[0].user_metadata?.mn_qa_marker === marker,
  'QA Auth identity changed before deletion; cleanup withheld');
  let authDelete;
  try { authDelete = await admin.auth.admin.deleteUser(accountId); }
  catch { throw new Error('exact QA Auth deletion failed'); }
  ensure(!authDelete.error, 'exact QA Auth deletion failed');
  ensure(await store.loadProfile(accountId) === null, 'QA profile reappeared after Auth deletion');
  ensure((await matchingUsers()).length === 0, 'QA Auth marker remains after deletion');
  await verifyReceipts(accountId, retainedIds);

  console.log(JSON.stringify({ pass: true, status: 'cleaned', mutated: true,
    publicVersion: beforeProfileDeleteStatus.version, profileRemoved: true, authRemoved: true,
    retainedEconomicReceiptCount: retainedIds.length, failedStorageReceiptAbsent: true }));
}

run().catch(() => {
  console.error(JSON.stringify({ pass: false, status: 'cleanup_withheld' }));
  process.exitCode = 1;
});

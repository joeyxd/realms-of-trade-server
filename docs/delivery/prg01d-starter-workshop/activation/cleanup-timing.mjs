#!/usr/bin/env node
// Remove only the exact disposable timing canary after alpha.38 is healthy and idle.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../../../../server/store.mjs';

const marker = 'mnQaWorkshopPublic:7a949137-a098-4b6d-887d-a8600c11b303';
const tag = marker.slice('mnQaWorkshopPublic:'.length);
const expectedProfileSha256 = 'af95c5025025974408b80af27a8dd9ebd276a1bd683f78be18aefed8c0bbcc5e';
const pinnedOrigin = 'https://marea.62.171.136.148.sslip.io';
const pinnedWorldId = 'marea-negra';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const timeout = ms => AbortSignal.timeout(ms);
const usage = 'usage: node docs/delivery/prg01d-starter-workshop/activation/cleanup-timing.mjs [--env-file PATH]';

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

if (process.env.MN_WORKSHOP_TARGET !== undefined) {
  let configured;
  try { configured = new URL(process.env.MN_WORKSHOP_TARGET); } catch { throw new Error('public target configuration mismatch'); }
  ensure(configured.origin === pinnedOrigin && configured.pathname === '/' && !configured.search && !configured.hash,
    'public target configuration mismatch');
}
const base = new URL(pinnedOrigin);
const url = suffix => new URL(suffix, base);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) },
});
const store = storeFromEnv();
ensure(process.env.WORLD_ID === undefined || process.env.WORLD_ID === pinnedWorldId,
  'world configuration mismatch');
const worldId = pinnedWorldId;
const expectedEmail = `mn-workshop-qa-${tag}@example.com`;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');

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
  ensure(health.ok && healthText.trim() === 'ok' && response.ok && status.version === '0.6.0-alpha.38'
    && status.players === 0 && status.sockets === 0 && status.errors === 0
    && storage?.errors === 0 && storage.unsaved === 0 && storage.profileWrites === 0
    && storage.worldWriting === false && economic?.enabled === true && economic.pending === 0
    && economic.failed === false && storage.tickBlocked === false
    && world?.id === worldId && world.ready === true && world.failed === false
    && storage.resources?.enabled === true && storage.resources?.ready === true
    && storage.workshop?.enabled === true && storage.workshop?.ready === true
    && storage.artisan?.enabled === true && storage.artisan?.ready === true,
  'public alpha.38 host is not healthy, idle, and fully drained; cleanup withheld');
  return { version: status.version, players: status.players, sockets: status.sockets,
    errors: status.errors, unsaved: storage.unsaved, profileWrites: storage.profileWrites,
    worldWriting: storage.worldWriting, economicPending: economic.pending };
}

async function matchingUsers() {
  const matches = [], ids = new Set();
  for (let page = 1; page <= 100; page++) {
    let result;
    try { result = await admin.auth.admin.listUsers({ page, perPage: 1000 }); }
    catch { throw new Error('exact QA identity lookup failed'); }
    ensure(!result.error && Array.isArray(result.data?.users), 'exact QA identity lookup failed');
    const batch = result.data.users;
    ensure(batch.length <= 1000, 'Auth page exceeded its bound');
    for (const user of batch) {
      ensure(typeof user?.id === 'string' && !ids.has(user.id), 'Auth scan returned a duplicate or invalid identity');
      ids.add(user.id);
    }
    matches.push(...batch.filter(user => user.user_metadata?.mn_qa_marker === marker));
    if (batch.length < 1000) return matches;
  }
  throw new Error('bounded Auth identity scan exceeded its limit');
}

async function receiptCount(accountId) {
  let count = 0;
  for (let offset = 0; offset < 100000; offset += 1000) {
    let result;
    try {
      result = await admin.from('mn_economic_operations').select('operation_id')
        .eq('request->>account', accountId).order('operation_id', { ascending: true })
        .range(offset, offset + 999);
    } catch { throw new Error('economic receipt inventory failed'); }
    ensure(!result.error && Array.isArray(result.data), 'economic receipt inventory failed');
    for (const row of result.data) ensure(typeof row.operation_id === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.operation_id),
    'economic receipt inventory returned an invalid row');
    count += result.data.length;
    if (result.data.length < 1000) return count;
  }
  throw new Error('bounded economic receipt inventory exceeded its limit');
}

async function run() {
  const initialStatus = await publicStatus();
  const users = await matchingUsers();
  ensure(users.length === 1, 'exact QA Auth marker must match one identity; cleanup withheld');
  const user = users[0], accountId = user.id;
  ensure(user.email === expectedEmail && user.user_metadata?.mn_qa_marker === marker,
    'exact QA Auth identity marker mismatch; cleanup withheld');

  const row = await store.loadProfile(accountId);
  ensure(row?.version === 3 && row.data?.pirateId === `account:${accountId}` && row.data?.workshop?.v === 1
    && row.data?.tools?.axe === 1 && sha256(stable(row.data)) === expectedProfileSha256,
  'exact QA profile ownership or expected v3 profile hash mismatch; cleanup withheld');
  ensure(await receiptCount(accountId) === 0,
    'economic receipts exist for the exact QA identity; cleanup withheld');

  const beforeProfileDeleteStatus = await publicStatus();
  const deleted = await admin.from('mn_profiles').delete().eq('player_id', accountId).eq('version', 3)
    .select('player_id,version');
  ensure(!deleted.error && deleted.data?.length === 1 && deleted.data[0].player_id === accountId
    && deleted.data[0].version === 3,
    'exact QA profile deletion failed');
  ensure(await store.loadProfile(accountId) === null, 'QA profile remains after exact-row deletion');

  await publicStatus();
  const currentUsers = await matchingUsers();
  ensure(currentUsers.length === 1 && currentUsers[0].id === accountId
    && currentUsers[0].email === expectedEmail && currentUsers[0].user_metadata?.mn_qa_marker === marker,
  'QA Auth identity changed before deletion; cleanup withheld');
  ensure(await receiptCount(accountId) === 0,
    'economic receipts appeared before Auth deletion; cleanup withheld');
  const authDelete = await admin.auth.admin.deleteUser(accountId);
  ensure(!authDelete.error, 'exact QA Auth deletion failed');
  ensure(await store.loadProfile(accountId) === null, 'QA profile reappeared after Auth deletion');
  ensure((await matchingUsers()).length === 0, 'QA Auth marker remains after deletion');
  ensure(await receiptCount(accountId) === 0, 'economic receipts appeared during cleanup');

  console.log(JSON.stringify({ schema: 'mn.starter-workshop.cleanup-timing.v1', at: new Date().toISOString(),
    privateIdsNeverPrinted: true, pass: true, status: 'cleaned', mutated: true,
    publicVersion: beforeProfileDeleteStatus.version, initialPlayers: initialStatus.players,
    profileRemoved: true, authRemoved: true, economicReceiptCount: 0 }));
}

run().catch(() => {
  console.error(JSON.stringify({ schema: 'mn.starter-workshop.cleanup-timing.v1', at: new Date().toISOString(),
    privateIdsNeverPrinted: true, pass: false, status: 'cleanup_withheld' }));
  process.exitCode = 1;
});

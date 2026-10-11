#!/usr/bin/env node
// Bounded authenticated public WSS acceptance for durable attributes. Uses only a marked disposable account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { storeFromEnv } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const origin = 'https://marea.62.171.136.148.sslip.io';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'usage: node tools/qa-attributes-public.mjs --env-file PATH --out NEW_DIR [--active]';
const ensure = (value, reason) => { if (!value) throw new Error(reason); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = ms => AbortSignal.timeout(ms);
const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) } };

let envFile = null, outArg = null, active = false, help = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (arg === '--out' && process.argv[i + 1] && !outArg) outArg = process.argv[++i];
  else if (arg === '--active' && !active) active = true;
  else if (arg === '--help' || arg === '-h') help = true;
  else throw new Error(usage);
}
if (help) { console.log(usage); process.exit(0); }
ensure(envFile && outArg, usage);
ensure([49, 50, 51, 52].includes(PROTOCOL_VERSION), 'local protocol is outside the reviewed attribute canary versions (49-52)');
if (envFile) { try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('environment file unavailable'); } }
ensure(process.env.MN_QA_ALLOW_PUBLIC === '1', 'Public QA guard is active; set MN_QA_ALLOW_PUBLIC=1 for this bounded acceptance.');
ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
  'Supabase QA configuration unavailable');

const out = path.resolve(outArg);
ensure(!fs.existsSync(out), 'output directory already exists; choose a new --out directory');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(out);
const options = supabaseOptions;
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
const store = storeFromEnv();
const base = new URL(process.env.MN_ATTRIBUTE_TARGET || origin);
ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname), 'public TLS target required');
const basePath = base.pathname.replace(/\/$/, ''); base.search = ''; base.hash = '';
const wsUrl = new URL(`${basePath}/ws`, base); wsUrl.protocol = 'wss:';
const worldId = process.env.WORLD_ID || 'marea-negra';
const tag = randomUUID(), email = `mn-attributes-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`, authMarker = `mnQaAttributesPublic:${tag}`;
let accountId = null, accessToken = null, socket = null, contentIdentity = null;
let profileGeneration = 0, joinCount = 0, latestProfile = null, latestWelcome = null, messages = [], waiters = [];
const receipts = new Set();
const evidence = { schema: 'mn.attributes.public.v1', startedAt: new Date().toISOString(), target: base.origin,
  mode: active ? 'active-attribute-operations' : 'feature-off-legacy-profile', identity: 'random disposable Supabase user; credentials redacted',
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, checks: [], pass: false };

const check = (name, details = {}) => { evidence.checks.push({ name, pass: true, ...details }); console.log(JSON.stringify({ check: name, pass: true })); };
const redact = value => String(value || '').replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\0', '[redacted-supabase-secret]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\0', '[redacted-supabase-key]')
  .replaceAll(accessToken || '\0', '[redacted-token]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]');
const unwrap = result => { if (!result || result.error) throw new Error('Supabase operation failed'); return result.data; };
const url = suffix => new URL(`${basePath}${suffix}`, base);
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
function receive(message) {
  messages.push(message); if (messages.length > 500) messages.splice(0, 200);
  if (message.t === 'profile') { latestProfile = message.p; profileGeneration++; }
  if (message.t === 'welcome') latestWelcome = message;
  for (const waiter of [...waiters]) if (waiter.predicate(message)) {
    waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
  }
}
function waitMessage(predicate, label, ms = 15000, fresh = false) {
  const prior = fresh ? null : messages.find(predicate);
  if (prior) return Promise.resolve(prior);
  if (messages.some(message => ['error', 'full'].includes(message.t))) return Promise.reject(new Error(`public admission rejected: ${label}`));
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: setTimeout(() => {
      waiters = waiters.filter(item => item !== waiter); reject(new Error(`bounded wait expired: ${label}`));
    }, ms) };
    waiters.push(waiter);
  });
}
async function waitProfile(predicate, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate(latestProfile)) return latestProfile; await pause(100); }
  throw new Error(`bounded wait expired: ${label}`);
}
async function publicPreflight() {
  const [healthResponse, statusResponse, authResponse, protocolResponse, contentResponse] = await Promise.all(
    ['/health', '/status', '/auth/config', '/src/net/protocol.js', '/api/world/content'].map(route =>
      fetch(url(route), { cache: 'no-store', signal: timeout(15000) })));
  ensure(healthResponse.ok && await healthResponse.text() === 'ok', 'public health check failed');
  ensure(statusResponse.ok && authResponse.ok && protocolResponse.ok && contentResponse.ok, 'public preflight endpoint unavailable');
  const status = await statusResponse.json(), auth = await authResponse.json(), protocol = await protocolResponse.text(), content = await contentResponse.json();
  const expectedAttributes = active ? status.storage?.attributes?.enabled === true && status.storage.attributes.ready === true
    : status.storage?.attributes?.enabled === false;
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && status.storage?.durable === true && status.storage?.accounts === true
    && status.storage?.economic?.enabled === true && status.storage.economic.failed === false && status.storage.economic.pending === 0
    && status.storage?.workshop?.enabled === true && status.storage.workshop.ready === true
    && status.storage?.world?.id === worldId && status.storage.world.ready === true && status.storage.world.failed === false
    && status.storage?.unsaved === 0 && status.storage?.profileWrites === 0 && status.storage.errors === 0 && expectedAttributes,
  'public version, zero-player, SQL readiness, or attribute feature state preflight failed');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), `deployed protocol differs from local protocol ${PROTOCOL_VERSION}`);
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
    'public Auth configuration mismatch');
  ensure(content.ok === true && Number.isSafeInteger(content.generation)
    && (content.revisionId === null || typeof content.revisionId === 'string'), 'public content identity unavailable');
  if (active) ensure((await store.checkAttributeOperations())?.version === 1, 'SQL attribute operation readiness RPC unavailable');
  contentIdentity = { generation: content.generation, revisionId: content.revisionId };
  check('public_health_version_protocol_and_attribute_state', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION,
    featureEnabled: status.storage.attributes.enabled, realPlayers: status.players });
}
async function createDisposableAccount() {
  const generated = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  accountId = generated.user?.id;
  ensure(accountId && generated.user.email === email, 'disposable Auth creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: authMarker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === authMarker, 'disposable account marker write failed');
  unwrap(await pub.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: 'signup' }));
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'disposable password login failed');
  accessToken = login.session.access_token;
  const profile = newProfile(); profile.pirateId = `account:${accountId}`; profile.lvl = 3;
  const normalized = sanitizeProfile(profile);
  ensure(normalized?.lvl === 3 && normalized.carry?.v === 1 && normalized.eco.pack.cap === 18,
    'level-three disposable profile failed current sanitizer');
  const saved = await store.initializeProfile(accountId, normalized);
  ensure(saved?.version === 1 && saved.data?.pirateId === `account:${accountId}` && saved.data.lvl === 3,
    'disposable level-three profile seed failed');
  check('random_disposable_account_and_level_three_profile_seed');
}
async function connect() {
  const generation = profileGeneration; messages = []; latestProfile = null; latestWelcome = null;
  socket = new WebSocket(wsUrl, { origin: base.origin, handshakeTimeout: 10000 });
  socket.on('message', data => { try { receive(JSON.parse(data.toString())); } catch { /* Ignore malformed public frames. */ } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bounded wait expired: public WSS open')), 15000);
    socket.once('open', () => { clearTimeout(timer); resolve(); });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('public WSS connection failed')); });
  });
  const welcome = waitMessage(message => message.t === 'welcome', 'authenticated join', 15000, true);
  socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Attributes QA', skin: 0, weapon: 0, save: '',
    token: accessToken, content: contentIdentity }));
  latestWelcome = await welcome;
  await waitProfile(profile => profileGeneration > generation && profile?.pirateId === `account:${accountId}`,
    'authenticated profile snapshot', 30000);
  ensure(wsUrl.protocol === 'wss:', 'acceptance did not use public WSS');
  check(joinCount++ === 0 ? 'disposable_authenticated_public_wss_join' : 'disposable_authenticated_public_wss_reconnect');
}
function send(value) {
  ensure(socket?.readyState === WebSocket.OPEN, 'public WSS is not open');
  socket.send(JSON.stringify({ t: 'cmd', ...value }));
}
async function operation(value) {
  const opId = value.opId || `attr-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const command = { ...value, opId };
  const ackWait = waitMessage(message => message.t === 'event' && message.ev?.opId === opId, `attribute ACK ${opId}`, 20000, true);
  send(command); const ack = (await ackWait).ev;
  if (ack.durable === true) receipts.add(economicOperationId(worldId, accountId, opId));
  return { command, ack };
}
async function closeAndDrain() {
  const old = socket;
  if (old && old.readyState !== WebSocket.CLOSED) {
    const closed = new Promise(resolve => {
      const timer = setTimeout(() => old.terminate(), 5000);
      old.once('close', () => { clearTimeout(timer); resolve(); });
    });
    if (old.readyState < WebSocket.CLOSING) old.close(1000, 'attribute QA phase boundary');
    await closed;
  }
  socket = null;
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const response = await fetch(url('/status'), { cache: 'no-store', signal: timeout(10000) });
    ensure(response.ok, 'public drain status unavailable');
    const status = await response.json(), storage = status.storage;
    if (status.players === 0 && status.sockets === 0 && storage?.profileWrites === 0 && storage?.unsaved === 0
        && storage?.worldWriting === false && storage?.economic?.pending === 0) return status;
    await pause(300);
  }
  throw new Error('public host did not drain the disposable session');
}
async function assertDatabaseMatchesSnapshot() {
  const row = await store.loadProfile(accountId);
  ensure(row?.data?.pirateId === `account:${accountId}` && latestProfile?.pirateId === row.data.pirateId,
    'database profile ownership differs from WSS snapshot');
  for (const field of ['lvl', 'attr', 'carry', 'eco', 'progression'])
    assert.deepEqual(row.data[field] ?? null, latestProfile[field] ?? null, `database/snapshot ${field} mismatch`);
  return row;
}
async function featureOffAcceptance() {
  await connect();
  const legacy = structuredClone(latestProfile), operationId = `attr-off-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  ensure(!Object.hasOwn(legacy, 'attr'), 'feature-off disposable profile unexpectedly has attributes');
  const { ack } = await operation({ type: 'attributes', op: 'adopt', opId: operationId, expectedRev: legacy.eco.tradeRev });
  ensure(ack.ok === false && ack.why === 'disabled', 'public attribute command was not denied while feature is off');
  ensure(await store.loadEconomicOperation(economicOperationId(worldId, accountId, operationId)) === null,
    'feature-off command unexpectedly created an economic receipt');
  ensure(canonical(latestProfile) === canonical(legacy), 'feature-off denial changed the public profile snapshot');
  await closeAndDrain();
  const saved = await store.loadProfile(accountId);
  ensure(!Object.hasOwn(saved.data, 'attr') && saved.data.lvl === 3 && saved.data.eco.pack.maxMass === 22,
    'feature-off denial changed the persisted legacy profile');
  await connect();
  ensure(!Object.hasOwn(latestProfile, 'attr') && latestProfile.eco.pack.maxMass === 22,
    'reconnect adopted or rewrote the legacy profile while attributes were disabled');
  check('feature_off_denial_no_receipt_and_legacy_reconnect');
}
async function activeAcceptance() {
  await connect();
  const adoption = { type: 'attributes', op: 'adopt', opId: `attr-adopt-${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    expectedRev: latestProfile.eco.tradeRev };
  const adopted = await operation(adoption);
  ensure(adopted.ack.ok === true && adopted.ack.durable === true && adopted.ack.rev === adoption.expectedRev + 1,
    'durable attribute adoption failed');
  await waitProfile(profile => profile?.attr?.v === 1 && profile.eco.tradeRev === adopted.ack.rev, 'adopted public profile');
  assert.equal(latestProfile.eco.pack.maxMass, 50, 'adoption did not apply the base mass limit');
  assert.equal(latestProfile.eco.pack.cap, 18, 'adoption changed pack volume');

  const assignment = { type: 'attributes', op: 'assign', opId: `attr-assign-${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    expectedRev: adopted.ack.rev, stat: 'carga', n: 2 };
  const assigned = await operation(assignment);
  ensure(assigned.ack.ok === true && assigned.ack.durable === true && assigned.ack.rev === assignment.expectedRev + 1,
    'durable two-point assignment failed');
  await waitProfile(profile => profile?.attr?.carga === 2 && profile.eco.tradeRev === assigned.ack.rev, 'assigned public profile');
  assert.equal(latestProfile.eco.pack.maxMass, 60, 'assignment did not apply the two-point mass limit');
  assert.equal(latestProfile.eco.pack.cap, 18, 'assignment changed pack volume');

  const reset = { type: 'attributes', op: 'reset', opId: `attr-reset-${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    expectedRev: assigned.ack.rev };
  const resetted = await operation(reset);
  ensure(resetted.ack.ok === true && resetted.ack.durable === true && resetted.ack.rev === reset.expectedRev + 1,
    'durable free reset failed');
  await waitProfile(profile => profile?.attr?.carga === 0 && profile.attr.re === 1
    && profile.eco.tradeRev === resetted.ack.rev, 'reset public profile');
  const afterReset = structuredClone(latestProfile);

  const historical = await operation(adoption);
  ensure(historical.ack.ok === true && historical.ack.durable === true
    && historical.ack.replay === true && historical.ack.historical === true,
  'exact adoption retry did not return a historical receipt');
  assert.deepEqual(latestProfile, afterReset, 'historical retry rolled the public profile back');

  const stale = { type: 'attributes', op: 'assign', opId: `attr-stale-${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    expectedRev: adoption.expectedRev, stat: 'carga', n: 1 };
  const staleAck = await operation(stale);
  ensure(staleAck.ack.ok === false && staleAck.ack.why === 'conflict' && staleAck.ack.durable === true,
    'stale expectedRev did not return a durable conflict');
  assert.deepEqual(latestProfile, afterReset, 'stale conflict changed the profile');
  ensure(await store.loadEconomicOperation(economicOperationId(worldId, accountId, stale.opId)),
    'stale conflict receipt is missing');
  const statusResponse = await fetch(url('/status'), { cache: 'no-store', signal: timeout(10000) });
  const status = await statusResponse.json();
  ensure(status.storage?.attributes?.ready === true && status.storage.attributes.failed !== true
    && status.storage.economic?.failed === false && status.storage.economic.pending === 0,
  'stale revision conflict fenced the public authority');

  const saved = await assertDatabaseMatchesSnapshot();
  ensure(saved.data.attr?.carga === 0 && saved.data.attr.re === 1 && saved.data.eco.pack.maxMass === 50,
    'durable profile does not reflect reset ACK and public snapshot');
  await closeAndDrain(); await connect();
  assert.deepEqual(latestProfile.attr, saved.data.attr);
  assert.equal(latestProfile.eco.pack.maxMass, saved.data.eco.pack.maxMass);
  assert.equal(latestProfile.eco.tradeRev, saved.data.eco.tradeRev);
  check('adopt_assign_reset_historical_retry_stale_conflict_and_reconnect', { receiptCount: receipts.size,
    adoptedMaxMass: 50, assignedMaxMass: 60, resetMaxMass: saved.data.eco.pack.maxMass, packVolume: 18 });
}

try {
  await publicPreflight();
  await createDisposableAccount();
  if (active) await activeAcceptance(); else await featureOffAcceptance();
  evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; details suppressed';
  process.exitCode = 1;
} finally {
  try {
    if (accountId) {
      await closeAndDrain();
      const auth = unwrap(await admin.auth.admin.getUserById(accountId));
      ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === authMarker,
        'cleanup stopped: disposable Auth identity marker mismatch');
      const row = await store.loadProfile(accountId);
      if (row) {
        ensure(row.data?.pirateId === `account:${accountId}`, 'cleanup stopped: disposable profile ownership sentinel mismatch');
        const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id'));
        ensure(deleted?.length === 1 && deleted[0].player_id === accountId, 'disposable profile exact-row cleanup failed');
      }
      unwrap(await admin.auth.admin.deleteUser(accountId));
      ensure(await store.loadProfile(accountId) === null, 'disposable profile remains after cleanup');
      let retainedReceiptCount = 0;
      for (const id of receipts) if (await store.loadEconomicOperation(id)) retainedReceiptCount++;
      ensure(retainedReceiptCount === receipts.size, 'acknowledged attribute receipt missing after account cleanup');
      evidence.cleanup = { temporaryAuthAndProfileRemoved: true, retainedReceiptCount,
        receiptPolicy: 'economic receipts intentionally retained' };
    }
  } catch (error) {
    evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1;
  }
  evidence.completedAt = new Date().toISOString();
  const file = path.join(out, 'acceptance.json');
  try { fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch { evidence.pass = false; evidence.outputFailure = 'new evidence file could not be written'; process.exitCode = 1; }
  try { fs.chmodSync(file, 0o600); } catch { /* Permissions may be fixed by the platform. */ }
  await pub.auth.signOut().catch(() => {});
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, gameVersion: evidence.gameVersion,
    protocolVersion: evidence.protocolVersion, cleanup: evidence.cleanup || null,
    failure: evidence.failure || evidence.cleanupFailure || evidence.outputFailure || null,
    evidence: fs.existsSync(file) ? file : null }));
}

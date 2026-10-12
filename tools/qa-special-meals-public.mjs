#!/usr/bin/env node
// Bounded authenticated public WSS canary for the durable grog operation.
// Roast fish and reinforced biscuit require an owned, lit cooker and are deliberately not fabricated here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { storeFromEnv } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { meterValue } from '../src/data/survival.js';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const origin = 'https://marea.62.171.136.148.sslip.io';
const usage = 'usage: node tools/qa-special-meals-public.mjs --env-file PATH --out NEW_DIR';
const ensure = (value, reason) => { if (!value) throw new Error(reason); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = ms => AbortSignal.timeout(ms);
const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) } };

let envFile = null, outArg = null, help = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (arg === '--out' && process.argv[i + 1] && !outArg) outArg = process.argv[++i];
  else if (arg === '--help' || arg === '-h') help = true;
  else throw new Error(usage);
}
if (help) { console.log(usage); process.exit(0); }
ensure(envFile && outArg, usage);
ensure(GAME.version && /^0\.6\.0-alpha\.\d+$/.test(GAME.version) && Number.isSafeInteger(PROTOCOL_VERSION),
  'local build version metadata unavailable');
try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('environment file unavailable'); }
ensure(process.env.MN_QA_ALLOW_PUBLIC === '1', 'Public QA guard is active; set MN_QA_ALLOW_PUBLIC=1 for this bounded acceptance.');
ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
  'Supabase QA configuration unavailable');

const out = path.resolve(outArg);
ensure(!fs.existsSync(out), 'output directory already exists; choose a new --out directory');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, supabaseOptions);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, supabaseOptions);
const store = storeFromEnv();
const base = new URL(process.env.MN_FRESHWATER_TARGET || origin);
ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname), 'public TLS target required');
const basePath = base.pathname.replace(/\/$/, ''); base.search = ''; base.hash = '';
const wsUrl = new URL(`${basePath}/ws`, base); wsUrl.protocol = 'wss:';
const worldId = process.env.WORLD_ID || 'marea-negra';
const tag = randomUUID(), email = `mn-meals-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`, authMarker = `mnQaSpecialMealsPublic:${tag}`;
let accountId = null, accessToken = null, socket = null, contentIdentity = null;
let profileGeneration = 0, latestProfile = null, latestSnapshot = null, messages = [], waiters = [];
let inputTimer = null, inputSequence = 0, sentTick = 0;
const receipts = new Map();
const evidence = { schema: 'mn.special-meals.public.v1', startedAt: new Date().toISOString(), target: base.origin,
  mode: 'authenticated-disposable-profile', identity: 'random disposable Supabase user; credentials redacted',
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, checks: [], pass: false,
  scope: 'grog cost, effect, timer, exact replay/collision, reload and reentry persistence; heat meals receive no fabricated proof' };

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
  if (message.t === MSG.PROFILE) { latestProfile = message.p; profileGeneration++; }
  if (message.t === MSG.SNAPSHOT) latestSnapshot = message;
  for (const waiter of [...waiters]) if (waiter.predicate(message)) {
    waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
  }
}
function waitMessage(predicate, label, ms = 15000, fresh = false) {
  const prior = fresh ? null : messages.find(predicate);
  if (prior) return Promise.resolve(prior);
  if (messages.some(message => [MSG.ERROR, MSG.FULL].includes(message.t))) return Promise.reject(new Error(`public admission rejected: ${label}`));
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: setTimeout(() => {
      waiters = waiters.filter(item => item !== waiter); reject(new Error(`bounded wait expired: ${label}`));
    }, ms) };
    waiters.push(waiter);
  });
}
async function waitProfile(predicate, label, ms = 20000) {
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
  const storage = status.storage;
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && storage?.durable === true && storage?.accounts === true
    && storage?.economic?.enabled === true && storage.economic.failed === false && storage.economic.pending === 0
    && storage?.freshwater?.enabled === true && storage.freshwater.ready === true
    && storage.freshwater.canteen === true && storage.freshwater.meals === true
    && storage?.world?.id === worldId && storage.world.ready === true && storage.world.failed === false
    && storage?.unsaved === 0 && storage?.profileWrites === 0 && storage.errors === 0,
  'public build, zero-player, SQL035/readiness, feature activation, or world readiness preflight failed');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol differs from current local protocol');
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
    'public Auth configuration mismatch');
  ensure(content.ok === true && Number.isSafeInteger(content.generation)
    && (content.revisionId === null || typeof content.revisionId === 'string'), 'public content identity unavailable');
  contentIdentity = { generation: content.generation, revisionId: content.revisionId };
  check('public_health_build_protocol_sql035_meals_readiness_and_idle_gate', {
    gameVersion: status.version, protocolVersion: PROTOCOL_VERSION, specialMealsEnabled: storage.freshwater.meals,
    realPlayers: status.players });
}
function connectSocket({ token = null, name = 'Special Meals QA' } = {}) {
  const generation = profileGeneration; messages = []; latestProfile = null; latestSnapshot = null;
  inputSequence = 0; sentTick = 0;
  socket = new WebSocket(wsUrl, { origin: base.origin, handshakeTimeout: 10000 });
  socket.on('message', data => { try { receive(JSON.parse(data.toString())); } catch { /* Ignore malformed public frames. */ } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bounded wait expired: public WSS open')), 15000);
    socket.once('open', () => { clearTimeout(timer); resolve({ generation }); });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('public WSS connection failed')); });
  }).then(async ({ generation }) => {
    const welcome = waitMessage(message => message.t === 'welcome', 'WSS join', 15000, true);
    socket.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save: '',
      ...(token ? { token } : {}), content: contentIdentity }));
    await welcome;
    const end = Date.now() + 20000;
    while (Date.now() < end && (!latestSnapshot?.freshwater || !latestProfile && token)) await pause(100);
    ensure(latestSnapshot?.freshwater && (!token || profileGeneration > generation && latestProfile?.pirateId === `account:${accountId}`),
      'authenticated freshwater snapshot/profile unavailable');
    return latestSnapshot;
  });
}
function send(value) {
  ensure(socket?.readyState === WebSocket.OPEN, 'public WSS is not open');
  socket.send(JSON.stringify({ t: MSG.CMD, ...value }));
}
function sendNeutralInputs() {
  ensure(socket?.readyState === WebSocket.OPEN, 'public WSS is not open for connected timer input');
  sentTick = Math.max(sentTick, latestSnapshot?.tick || 0);
  const cmds = Array.from({ length:6 }, () => ({ seq:++inputSequence, mx:0, mz:0, ax:0, az:0,
    btn:0, prs:0, pt:++sentTick, w:0 }));
  socket.send(JSON.stringify({ t:MSG.INPUTS, cmds }));
}
function startNeutralInputs() {
  ensure(!inputTimer, 'neutral input loop already active');
  sendNeutralInputs();
  inputTimer = setInterval(() => {
    try { if (socket?.readyState === WebSocket.OPEN) sendNeutralInputs(); }
    catch { stopNeutralInputs(); }
  }, 100);
}
function stopNeutralInputs() {
  if (inputTimer) clearInterval(inputTimer);
  inputTimer = null;
}
async function mealCommand(value) {
  const opId = value.opId || `meal-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const command = { ...value, opId };
  const ackWait = waitMessage(message => message.t === MSG.EVENT && message.ev?.type === 'freshwater' && message.ev?.opId === opId,
    `meal ACK ${opId}`, 20000, true);
  send(command); const ack = (await ackWait).ev;
  if (ack.durable === true && accountId) receipts.set(opId, economicOperationId(worldId, accountId, opId));
  return { command, ack };
}
async function closeAndDrain() {
  stopNeutralInputs();
  const old = socket;
  if (old && old.readyState !== WebSocket.CLOSED) {
    const drainEnd = Date.now() + 3000;
    while (old.readyState === WebSocket.OPEN && old.bufferedAmount > 0 && Date.now() < drainEnd) await pause(25);
    ensure(old.bufferedAmount === 0, 'public WSS input queue did not drain before close');
    const closed = new Promise(resolve => { const timer = setTimeout(() => old.terminate(), 5000); old.once('close', () => { clearTimeout(timer); resolve(); }); });
    if (old.readyState < WebSocket.CLOSING) old.close(1000, 'special meals QA phase boundary');
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
  throw new Error('public host did not drain the QA session');
}
async function publicAnonymousDenial() {
  await connectSocket({ name: 'Anonymous Meals QA' });
  const rev = latestProfile?.eco?.tradeRev ?? 0;
  const { ack } = await mealCommand({ type:'freshwater', op:'meal', opId:`anon-${randomUUID().replaceAll('-','').slice(0,20)}`,
    expectedRev:rev, source:'grog', ship:'', part:'', n:1 });
  ensure(ack.ok === false && ack.why === 'account_required',
    'anonymous meal mutation was not denied before persistence');
  await closeAndDrain(); check('anonymous_meal_denied_without_receipt');
}
async function createDisposableAccount() {
  const generated = unwrap(await admin.auth.admin.generateLink({ type:'signup', email, password }));
  accountId = generated.user?.id;
  ensure(accountId && generated.user.email === email, 'disposable Auth creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata:{ mn_qa_marker:authMarker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === authMarker, 'disposable account marker write failed');
  unwrap(await pub.auth.verifyOtp({ token_hash:generated.properties.hashed_token, type:'signup' }));
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'disposable password login failed');
  accessToken = login.session.access_token;
  const profile = newProfile(); profile.pirateId = `account:${accountId}`; profile.lvl = 3;
  profile.eco.pack.goods = { ron:1, agua:1 }; profile.surv = { v:1, sat:40, hyd:20 };
  const normalized = sanitizeProfile(profile);
  ensure(normalized?.lvl === 3 && normalized.carry?.v === 1 && normalized.eco.pack.cap === 18
    && normalized.eco.pack.goods.ron === 1 && normalized.eco.pack.goods.agua === 1
    && normalized.surv?.sat === 40 && normalized.surv?.hyd === 20,
    'disposable grog-cost and needs profile failed current sanitizer');
  const saved = await store.initializeProfile(accountId, normalized);
  ensure(saved?.version === 1 && saved.data?.pirateId === `account:${accountId}` && saved.data.lvl === 3,
    'disposable level-three profile seed failed');
  check('random_disposable_account_normal_password_login_and_exact_grog_cost_seed');
}
async function activeAcceptance() {
  await connectSocket({ token:accessToken });
  const water = latestSnapshot.freshwater;
  ensure(water.enabled === true && water.canteenEnabled === true && water.mealsEnabled === true
    && water.meal === null && !Object.hasOwn(water, 'pack') && !Object.hasOwn(water, 'vessels'),
  'authenticated special-meal status missing or exposed private inventory');
  ensure(latestProfile.eco.pack.goods?.ron === 1 && latestProfile.eco.pack.goods?.agua === 1
    && latestProfile.surv?.sat === 40 && latestProfile.surv?.hyd === 20,
    'authenticated seeded profile differs from bounded ingredients and needs');
  check('authenticated_status_and_bounded_grog_seed');
  startNeutralInputs();
  const before = structuredClone(latestProfile), opId = `grog-${randomUUID().replaceAll('-','').slice(0,20)}`;
  const command = { type:'freshwater', op:'meal', opId, expectedRev:before.eco.tradeRev, source:'grog', ship:'', part:'', n:1 };
  const first = await mealCommand(command);
  ensure(first.ack.ok === true && first.ack.durable === true && first.ack.op === 'meal'
    && first.ack.rev === command.expectedRev + 1, 'durable grog operation failed');
  const after = await waitProfile(profile => profile?.eco?.tradeRev === first.ack.rev && profile.meal?.kind === 'grog'
    && profile.meal?.v === 1 && profile.meal?.ticks > 0 && profile.meal?.ticks <= 54000 && !profile.eco.pack.goods?.ron
    && !profile.eco.pack.goods?.agua && profile.surv?.sat > before.surv.sat && profile.surv?.hyd > before.surv.hyd,
    'grog profile transition');
  const receiptTicks = after.meal.ticks;
  const receiptId = economicOperationId(worldId, accountId, opId);
  const committedReceipt = await store.loadEconomicOperation(receiptId);
  const requestBefore = committedReceipt?.request?.before, requestAfter = committedReceipt?.request?.profile;
  ensure(committedReceipt?.request?.command && canonical(committedReceipt.request.command) === canonical(command)
    && requestBefore?.eco?.pack?.goods?.ron === 1 && requestBefore?.eco?.pack?.goods?.agua === 1
    && Object.keys(requestAfter?.eco?.pack?.goods || {}).length === 0
    && requestAfter?.meal?.kind === 'grog' && requestAfter.meal.ticks === 54000
    && requestAfter.surv?.sat === meterValue(requestBefore.surv.sat + 5)
    && requestAfter.surv?.hyd === meterValue(requestBefore.surv.hyd + 55)
    && committedReceipt.request.ack?.ok === true && committedReceipt.request.ack.rev === command.expectedRev + 1
    && committedReceipt.result?.ack?.ok === true
    && canonical(committedReceipt.result.ack) === canonical(committedReceipt.request.ack),
    'durable grog receipt does not prove the exact cost, effect, timer, and acknowledgement');
  check('grog_receipt_exact_cost_effect_and_initial_timer', { operationId:receiptId, timerTicks:54000 });
  const replay = await mealCommand(command);
  ensure(replay.ack.ok === true && replay.ack.durable === true && replay.ack.replay === true,
    'exact grog retry did not return its durable receipt');
  const replayReceipt = await store.loadEconomicOperation(receiptId);
  ensure(canonical(replayReceipt) === canonical(committedReceipt), 'exact replay changed its immutable economic receipt');
  const afterReplay = await waitProfile(profile => profile?.eco?.tradeRev === first.ack.rev && profile.meal?.kind === 'grog'
    && profile.meal?.ticks > 0 && profile.meal?.ticks <= receiptTicks, 'profile unchanged except connected timer countdown');
  ensure(canonical(afterReplay.eco.pack.goods) === canonical(after.eco.pack.goods)
    && afterReplay.surv.sat <= after.surv.sat && afterReplay.surv.hyd <= after.surv.hyd,
    'grog replay changed cost or restored needs');
  check('grog_replay_returns_same_receipt_without_recharging_or_refilling_needs', { timerTicks:afterReplay.meal.ticks });
  const collision = await mealCommand({ ...command, expectedRev:first.ack.rev });
  ensure(collision.ack.ok === false && collision.ack.why === 'duplicate', 'changed grog payload with reused opId was not denied');
  ensure(latestProfile.eco.tradeRev === first.ack.rev && latestProfile.meal?.kind === 'grog'
    && latestProfile.meal.ticks <= afterReplay.meal.ticks, 'grog operation collision changed profile or renewed timer');
  const collisionReceipt = await store.loadEconomicOperation(receiptId);
  ensure(canonical(collisionReceipt) === canonical(committedReceipt), 'opId collision changed the original economic receipt');
  check('grog_opid_collision_keeps_original_receipt_and_revision');
  await closeAndDrain();
  const persisted = await store.loadProfile(accountId);
  ensure(persisted?.data?.pirateId === `account:${accountId}` && persisted.data.meal?.kind === 'grog'
    && persisted.data.meal.ticks > 0 && persisted.data.meal.ticks <= latestProfile.meal.ticks
    && canonical(persisted.data.eco.pack) === canonical(latestProfile.eco.pack)
    && persisted.data.surv?.sat <= latestProfile.surv?.sat && persisted.data.surv?.hyd <= latestProfile.surv?.hyd,
    'saved grog profile differs from public accepted state');
  const offlineTicks = persisted.data.meal.ticks;
  await pause(1200);
  const stillOffline = await store.loadProfile(accountId);
  ensure(stillOffline?.data?.meal?.kind === 'grog' && stillOffline.data.meal.ticks === offlineTicks,
    'stored grog timer advanced while disconnected');
  check('offline_grog_timer_pauses_at_exact_saved_ticks', { savedTicks:offlineTicks, laterTicks:stillOffline.data.meal.ticks });
  await connectSocket({ token:accessToken });
  ensure(latestProfile.meal?.kind === 'grog' && latestProfile.meal.ticks > 0
    && latestProfile.meal.ticks <= stillOffline.data.meal.ticks, 'reentry lost or renewed the persisted grog timer');
  assert.deepEqual(latestProfile.eco.pack, persisted.data.eco.pack, 'reentry restored grog ingredients');
  ensure(latestProfile.surv?.sat <= persisted.data.surv.sat && latestProfile.surv?.hyd <= persisted.data.surv.hyd,
    'reentry restored grog needs');
  ensure(latestSnapshot.freshwater.meal?.kind === 'grog' && latestSnapshot.freshwater.meal?.ticks > 0
    && latestSnapshot.freshwater.meal.ticks <= stillOffline.data.meal.ticks, 'reentry snapshot omitted or renewed the authoritative active timer');
  const reentryTicks = latestSnapshot.freshwater.meal.ticks;
  startNeutralInputs();
  const timerEnd = Date.now() + 12000;
  while (Date.now() < timerEnd && latestSnapshot?.freshwater?.meal?.ticks >= reentryTicks) await pause(100);
  ensure(latestSnapshot?.freshwater?.meal?.ticks > 0 && latestSnapshot.freshwater.meal.ticks < reentryTicks,
    'connected public session did not advance the authoritative grog timer');
  check('reentry_restores_timer_and_neutral_inputs_advance_connected_ticks', { reentryTicks, laterTicks:latestSnapshot.freshwater.meal.ticks });
  await closeAndDrain();
  let denial = null;
  await connectSocket({ token:accessToken });
  startNeutralInputs();
  const denied = await mealCommand({ type:'freshwater', op:'meal', opId:`heat-${randomUUID().replaceAll('-','').slice(0,18)}`,
    expectedRev:latestProfile.eco.tradeRev, source:'roastFish', ship:'qa-no-cooker', part:'p1', n:1 });
  denial = denied.ack.why;
  ensure(denied.ack.ok === false && ['owner','heat'].includes(denial),
    'heat-required recipe did not produce the expected no-cooker denial');
  const denialId = economicOperationId(worldId, accountId, denied.command.opId);
  const denialReceipt = await store.loadEconomicOperation(denialId);
  ensure(denialReceipt?.request?.command && canonical(denialReceipt.request.command) === canonical(denied.command)
    && denialReceipt.request.ack?.ok === false && denialReceipt.request.ack.why === denial
    && denialReceipt.result?.ack?.ok === false && canonical(denialReceipt.result.ack) === canonical(denialReceipt.request.ack)
    && canonical(denialReceipt.request.profile) === canonical(denialReceipt.request.before),
    'no-cooker gameplay denial was not retained as an unchanged durable receipt');
  receipts.set(denied.command.opId, denialId);
  check('heat_recipe_denial_has_unchanged_durable_gameplay_receipt', { denial, operationId:denialId });
  await closeAndDrain();
  const retainedReceipts = [];
  for (const [receiptOpId, operationId] of receipts) {
    const receipt = await store.loadEconomicOperation(operationId);
    ensure(receipt?.request?.command?.opId === receiptOpId, 'acknowledged meal receipt missing or mismatched after operation');
    retainedReceipts.push({ operationId, opId:receiptOpId, ackOk:receipt.result.ack.ok });
  }
  ensure(retainedReceipts.length === 2 && retainedReceipts.some(row => row.opId === opId && row.ackOk === true)
    && retainedReceipts.some(row => row.opId === denied.command.opId && row.ackOk === false),
    'successful meal and gameplay-denial receipts were not retained exactly once');
  check('success_and_heat_denial_receipts_retained', { receipts:retainedReceipts, tradeRev:persisted.data.eco.tradeRev,
    hotFireProof:'not attempted; no cooker ownership or live fire was fabricated' });
}

try {
  await publicPreflight();
  await publicAnonymousDenial();
  await createDisposableAccount();
  await activeAcceptance();
  evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; details suppressed';
  process.exitCode = 1;
} finally {
  try {
    if (socket) await closeAndDrain();
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
      for (const [opId, operationId] of receipts) {
        const receipt = await store.loadEconomicOperation(operationId);
        ensure(receipt?.request?.command?.opId === opId, 'acknowledged meal receipt missing after account cleanup');
        retainedReceiptCount++;
      }
      ensure(retainedReceiptCount === receipts.size, 'acknowledged meal receipt count changed after account cleanup');
      evidence.cleanup = { temporaryAuthAndProfileRemoved:true, retainedReceiptCount,
        receiptPolicy:'economic receipts intentionally retained' };
    }
  } catch (error) {
    evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1;
  }
  evidence.completedAt = new Date().toISOString();
  const file = path.join(out, 'acceptance.json');
  try { fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { flag:'wx', mode:0o600 }); }
  catch { evidence.pass = false; evidence.outputFailure = 'new evidence file could not be written'; process.exitCode = 1; }
  try { fs.chmodSync(file, 0o600); } catch { /* Permissions may be fixed by the platform. */ }
  await pub.auth.signOut().catch(() => {});
  console.log(JSON.stringify({ pass:evidence.pass, checks:evidence.checks.length, gameVersion:evidence.gameVersion,
    protocolVersion:evidence.protocolVersion, cleanup:evidence.cleanup || null,
    failure:evidence.failure || evidence.cleanupFailure || evidence.outputFailure || null,
    evidence:fs.existsSync(file) ? file : null }));
}

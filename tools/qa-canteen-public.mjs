#!/usr/bin/env node
// Bounded authenticated public WSS acceptance for private freshwater status and durable bucket receipts.
// It never moves the live player or channels at the source; fill/gather is deliberately out of scope.
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
import { freshwaterSource } from '../src/data/freshwater.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const canteenEnabled = process.env.MN_QA_CANTEEN_ENABLED === '1';
const origin = 'https://marea.62.171.136.148.sslip.io';
const usage = 'usage: node tools/qa-canteen-public.mjs --env-file PATH --out NEW_DIR';
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
ensure(GAME.version === '0.6.0-alpha.48' && PROTOCOL_VERSION === 54, 'local build is not the expected alpha48/protocol54 freshwater build');
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
const tag = randomUUID(), email = `mn-freshwater-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`, authMarker = `mnQaFreshwaterPublic:${tag}`;
let accountId = null, accessToken = null, socket = null, contentIdentity = null;
let profileGeneration = 0, latestProfile = null, latestWelcome = null, latestSnapshot = null, messages = [], waiters = [];
const receipts = new Set();
const evidence = { schema: 'mn.freshwater.public.v1', startedAt: new Date().toISOString(), target: base.origin,
  mode: 'authenticated-disposable-profile', identity: 'random disposable Supabase user; credentials redacted',
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, canteenEnabled, checks: [], pass: false,
  scope: 'bounded disposable authenticated receipt acceptance; optional canteen craft/refill/drink/food; no fill/gather, barrel construction, enemy encounter, or player relocation' };

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
  if (message.t === 'welcome') latestWelcome = message;
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
async function waitSnapshot(predicate, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate(latestSnapshot)) return latestSnapshot; await pause(100); }
  throw new Error(`bounded wait expired: ${label}`);
}
async function publicPreflight() {
  const [healthResponse, statusResponse, authResponse, protocolResponse, contentResponse] = await Promise.all(
    ['/health', '/status', '/auth/config', '/src/net/protocol.js', '/api/world/content'].map(route =>
      fetch(url(route), { cache: 'no-store', signal: timeout(15000) })));
  ensure(healthResponse.ok && await healthResponse.text() === 'ok', 'public health check failed');
  ensure(statusResponse.ok && authResponse.ok && protocolResponse.ok && contentResponse.ok, 'public preflight endpoint unavailable');
  const status = await statusResponse.json(), auth = await authResponse.json(), protocol = await protocolResponse.text(), content = await contentResponse.json();
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && status.storage?.durable === true && status.storage?.accounts === true
    && status.storage?.economic?.enabled === true && status.storage.economic.failed === false && status.storage.economic.pending === 0
    && status.storage?.freshwater?.enabled === true && status.storage.freshwater.ready === true
    && status.storage.freshwater.canteen === canteenEnabled
    && status.storage?.world?.id === worldId && status.storage.world.ready === true && status.storage.world.failed === false
    && status.storage?.unsaved === 0 && status.storage?.profileWrites === 0 && status.storage.errors === 0,
  'public alpha48, zero-player, SQL freshness, or world readiness preflight failed');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol differs from local protocol 54');
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
    'public Auth configuration mismatch');
  ensure(content.ok === true && Number.isSafeInteger(content.generation)
    && (content.revisionId === null || typeof content.revisionId === 'string'), 'public content identity unavailable');
  const sourcePoint = freshwaterSource(generateWorld(GAME.seed));
  ensure(sourcePoint?.id === 'salty-spring' && Number.isFinite(sourcePoint.y) && sourcePoint.y > 0.3
    && Number.isFinite(sourcePoint.x) && Number.isFinite(sourcePoint.z), 'generated freshwater source map position is not above water');
  contentIdentity = { generation: content.generation, revisionId: content.revisionId };
  evidence.sourceMapPosition = { y: sourcePoint.y, positive: true };
  check('public_health_alpha48_protocol54_freshwater_ready_and_source_map_position', {
    gameVersion: status.version, protocolVersion: PROTOCOL_VERSION, featureEnabled: status.storage.freshwater.enabled,
    sourceId: sourcePoint.id, sourceHeightPositive: true, realPlayers: status.players });
}
function connectSocket({ token = null, name = 'Freshwater QA' } = {}) {
  const generation = profileGeneration; messages = []; latestProfile = null; latestWelcome = null; latestSnapshot = null;
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
    latestWelcome = await welcome;
    await waitSnapshot(snapshot => snapshot.t === MSG.SNAPSHOT && snapshot.freshwater !== undefined, 'private freshwater snapshot', 30000);
    if (token) await waitProfile(profile => profileGeneration > generation && profile?.pirateId === `account:${accountId}`,
      'authenticated account profile', 30000);
    ensure(wsUrl.protocol === 'wss:', 'acceptance did not use public WSS');
    return latestSnapshot;
  });
}
function send(value) {
  ensure(socket?.readyState === WebSocket.OPEN, 'public WSS is not open');
  socket.send(JSON.stringify({ t: MSG.CMD, ...value }));
}
async function freshwaterCommand(value) {
  const opId = value.opId || `water-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const command = { ...value, opId };
  const ackWait = waitMessage(message => message.t === MSG.EVENT && message.ev?.type === 'freshwater' && message.ev?.opId === opId,
    `freshwater ACK ${opId}`, 20000, true);
  send(command); const ack = (await ackWait).ev;
  if (ack.durable === true && accountId) receipts.add(economicOperationId(worldId, accountId, opId));
  return { command, ack };
}
async function closeAndDrain() {
  const old = socket;
  if (old && old.readyState !== WebSocket.CLOSED) {
    const closed = new Promise(resolve => {
      const timer = setTimeout(() => old.terminate(), 5000);
      old.once('close', () => { clearTimeout(timer); resolve(); });
    });
    if (old.readyState < WebSocket.CLOSING) old.close(1000, 'freshwater QA phase boundary');
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
  await connectSocket({ name: 'Anonymous water QA' });
  const rev = latestProfile?.eco?.tradeRev ?? 0;
  const { ack } = await freshwaterCommand({ type:'freshwater', op:'craftBucket', opId:`anon-${randomUUID().replaceAll('-','').slice(0,20)}`,
    expectedRev:rev, source:'', ship:'', part:'', n:0 });
  ensure(ack.ok === false && ack.why === 'account_required' && ack.durable !== true,
    'anonymous freshwater mutation was not denied before persistence');
  await closeAndDrain();
  check('anonymous_freshwater_denied_without_receipt');
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
  profile.eco.pack.goods = canteenEnabled ? { madera:3,lona:2,agua:3,fruta:1 } : { madera:2 };
  if(canteenEnabled)profile.surv={v:1,sat:20,hyd:20};
  const normalized = sanitizeProfile(profile);
  ensure(normalized?.lvl === 3 && normalized.carry?.v === 1 && normalized.eco.pack.cap === 18
    && normalized.eco.pack.goods.madera === (canteenEnabled ? 3 : 2), 'disposable bucket-cost profile failed current sanitizer');
  const saved = await store.initializeProfile(accountId, normalized);
  ensure(saved?.version === 1 && saved.data?.pirateId === `account:${accountId}` && saved.data.lvl === 3,
    'disposable level-three profile seed failed');
  check('random_disposable_account_and_bounded_paid_recipe_profile_seed');
}
async function assertPrivateSnapshot() {
  const snapshot = latestSnapshot, water = snapshot?.freshwater;
  ensure(water?.enabled === true && water.source?.id === 'salty-spring'
    && typeof water.source.near === 'boolean' && Array.isArray(water.barrels), 'authenticated private freshwater status missing');
  ensure(!Object.hasOwn(water.source, 'x') && !Object.hasOwn(water.source, 'z')
    && !Object.hasOwn(water, 'vessels') && !Object.hasOwn(water, 'pack'), 'freshwater snapshot leaked a profile or map-coordinate field');
  ensure(Array.isArray(snapshot.rafts) && snapshot.rafts.every(raft => !Object.hasOwn(raft, 'hold') && !Object.hasOwn(raft, 'vessels')),
    'public raft snapshot exposed private cargo contents');
  check('owner_private_freshwater_status_and_no_public_cargo_fields', { sourceId:water.source.id,
    publicRaftCount:snapshot.rafts.length, privateBucketPresent:!!latestProfile?.eco?.pack?.vessels?.some(v=>v.kind==='bucket') });
}
async function activeAcceptance() {
  await connectSocket({ token:accessToken });
  await assertPrivateSnapshot();
  const before = structuredClone(latestProfile), bucketOpId = `water-craft-${randomUUID().replaceAll('-','').slice(0,16)}`;
  ensure(before.eco.pack.goods?.madera === 2 && !before.eco.pack.vessels?.length, 'seed profile does not have exact bucket cost and empty vessel slot');
  const command = { type:'freshwater', op:'craftBucket', opId:bucketOpId, expectedRev:before.eco.tradeRev,
    source:'', ship:'', part:'', n:0 };
  const first = await freshwaterCommand(command);
  ensure(first.ack.ok === true && first.ack.durable === true && first.ack.rev === command.expectedRev + 1,
    'durable paid bucket crafting failed');
  const after = await waitProfile(profile => profile?.eco?.tradeRev === first.ack.rev
    && profile.eco.pack.goods?.madera === undefined && profile.eco.pack.vessels?.some(v=>v.id==='bucket' && v.kind==='bucket' && v.water===0),
  'crafted private bucket profile');
  const replay = await freshwaterCommand(command);
  ensure(replay.ack.ok === true && replay.ack.durable === true && replay.ack.replay === true,
    'exact bucket retry did not return its durable receipt');
  await waitProfile(profile => canonical(profile) === canonical(after), 'profile unchanged after exact replay');
  const changed = await freshwaterCommand({ ...command, expectedRev:first.ack.rev });
  ensure(changed.ack.ok === false && changed.ack.why === 'duplicate', 'changed payload with a reused opId was not denied as a collision');
  const secondBucket = await freshwaterCommand({ ...command, opId:`water-full-${randomUUID().replaceAll('-','').slice(0,16)}`, expectedRev:first.ack.rev });
  ensure(secondBucket.ack.ok === false && secondBucket.ack.why === 'full' && secondBucket.ack.durable === true,
    'a new opId crafted a second bucket instead of receiving the full-container denial');
  assert.deepEqual(latestProfile, after, 'retry or opId collision changed the profile');
  ensure(after.eco.pack.goods?.madera === undefined && after.eco.pack.vessels.find(v=>v.id==='bucket')?.water === 0,
    'bucket replay charged wood twice or changed water');
  const receiptId = economicOperationId(worldId, accountId, bucketOpId);
  ensure(await store.loadEconomicOperation(receiptId), 'durable bucket receipt missing');
  await assertPrivateSnapshot();
  await closeAndDrain();
  const saved = await store.loadProfile(accountId);
  ensure(saved?.data?.pirateId === `account:${accountId}` && canonical(saved.data.eco.pack) === canonical(after.eco.pack),
    'durable private pack differs from the accepted WSS profile');
  await connectSocket({ token:accessToken });
  assert.deepEqual(latestProfile.eco.pack, saved.data.eco.pack, 'reconnected private profile lost the bucket');
  assert.equal(latestProfile.eco.tradeRev, saved.data.eco.tradeRev);
  await closeAndDrain();
  check('paid_craft_exact_replay_collision_and_new_opid_full_denial_reconnect', { receiptCount:receipts.size,
    tradeRev:saved.data.eco.tradeRev, packWood:saved.data.eco.pack.goods.madera ?? 0, bucketWater:saved.data.eco.pack.vessels[0].water,
    gatherPerformed:false });
}

async function activeCanteenAcceptance(){
 await connectSocket({token:accessToken});await assertPrivateSnapshot();
 ensure(latestSnapshot.freshwater.canteenEnabled===true,'canteen not enabled in authoritative snapshot');
 const run=async(op,extra={})=>{
  const cmd={type:'freshwater',op,opId:'canteen-'+randomUUID().replaceAll('-','').slice(0,16),expectedRev:latestProfile.eco.tradeRev,source:'',ship:'',part:'',n:0,...extra};
  const result=await freshwaterCommand(cmd);
  ensure(result.ack.ok===true && result.ack.durable===true,'new durable canteen command failed: '+op);
  await waitProfile(p=>p.eco.tradeRev===result.ack.rev,'confirmed '+op);
  return result;
 };
 await run('craftBucket');await run('craftCanteen');
 ensure(latestProfile.eco.pack.goods.madera===undefined&&latestProfile.eco.pack.goods.lona===undefined,'paid craft materials remain');
 await run('refillCanteen',{source:'provisions',n:3});
 ensure(latestProfile.eco.pack.goods.agua===undefined,'refill duplicated provision water');
 const drink=await run('drink',{n:1});
 const vessel=p=>p.eco.pack.vessels.find(v=>v.kind==='canteen');
 ensure(vessel(latestProfile).water===2&&latestProfile.surv.hyd>59&&latestProfile.surv.hyd<=60,'drink quantity or hydration failed');
 await run('eat',{source:'fruta',n:1});
 const after=structuredClone(latestProfile);
 ensure(after.eco.pack.goods.fruta===undefined&&after.surv.sat>34&&after.surv.sat<=35,'food failed');
 const replay=await freshwaterCommand(drink.command);
 ensure(replay.ack.replay===true&&replay.ack.ok===true,'drink exact replay failed');
 await waitProfile(p=>p.eco.tradeRev===after.eco.tradeRev,'no historical rollback');
 ensure(vessel(latestProfile).water===2&&latestProfile.surv.hyd<=after.surv.hyd,'replay consumed or rehydrated');
 const clash=await freshwaterCommand({...drink.command,n:2});
 ensure(clash.ack.ok===false,'changed drink request accepted');
 await closeAndDrain();const saved=await store.loadProfile(accountId);
 ensure(canonical(saved.data.eco.pack)===canonical(after.eco.pack),'durable canteen pack mismatch');
 await connectSocket({token:accessToken});
 ensure(canonical(latestProfile.eco.pack)===canonical(after.eco.pack)&&latestProfile.eco.tradeRev===after.eco.tradeRev,'reconnect restored stale inventory');
 ensure(latestProfile.surv.hyd<=after.surv.hyd&&latestProfile.surv.hyd>after.surv.hyd-1,'reconnect reset needs');
 await closeAndDrain();check('paid_canteen_refill_drink_food_replay_collision_and_durable_reconnect',{receiptCount:receipts.size,water:2,needsRetained:true});
}
try {
  await publicPreflight();
  await publicAnonymousDenial();
  await createDisposableAccount();
  if(canteenEnabled) await activeCanteenAcceptance(); else await activeAcceptance();
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
      for (const id of receipts) if (await store.loadEconomicOperation(id)) retainedReceiptCount++;
      ensure(retainedReceiptCount === receipts.size, 'acknowledged freshwater receipt missing after account cleanup');
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

#!/usr/bin/env node
// Bounded authenticated public WSS acceptance for the starter workshop. Never run against a real account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { storeFromEnv } from '../server/store.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { generateWorld } from '../src/sim/worldgen.js';
import { canStand } from '../src/sim/systems/movement.js';
import { tuning } from '../src/data/tuning.js';
import { RaftDeck, raftGangplank } from '../src/sim/raftGeometry.js';
import { holdUsed, holdMass } from '../src/sim/economy/cargo.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { acceptTimedLogging } from './qa-workshop-logging.mjs';

const origin = 'https://marea.62.171.136.148.sslip.io';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'usage: node tools/qa-workshop-public.mjs [--env-file PATH]';
const ensure = (value, reason) => { if (!value) throw new Error(reason); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = ms => AbortSignal.timeout(ms);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) } };
let envFile = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (process.argv[i] === '--help' || process.argv[i] === '-h') { console.log(usage); process.exit(0); }
  else throw new Error(usage);
}
if (envFile) { try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('environment file unavailable'); } }
ensure(process.env.MN_QA_ALLOW_BROWSER === '1', 'Public QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to run this acceptance.');
ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
  'Supabase QA configuration unavailable');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
const store = storeFromEnv();
const base = new URL(process.env.MN_WORKSHOP_TARGET || origin);
ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname), 'public TLS target required');
const basePath = base.pathname.replace(/\/$/, ''); base.search = ''; base.hash = '';
const wsUrl = new URL(`${basePath}/ws`, base); wsUrl.protocol = 'wss:';
const worldId = process.env.WORLD_ID || 'marea-negra';
let contentIdentity = null;
const out = path.resolve(repo, 'docs/delivery/prg01d-starter-workshop/activation');
const tag = randomUUID(), email = `mn-workshop-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`, authMarker = `mnQaWorkshopPublic:${tag}`;
let accountId = null, socket = null, profileVersion = null, currentProfile = null;
const receipts = new Set();
const evidence = { schema: 'mn.starter-workshop.public.v1', at: new Date().toISOString(), target: base.origin,
  identity: 'random disposable Supabase user; credentials redacted', protocol: PROTOCOL_VERSION, gameVersion: GAME.version,
  checks: [], errors: [] };
const check = (name, data = {}) => { evidence.checks.push({ name, pass: true, ...data }); console.log(JSON.stringify({ check: name, pass: true })); };
const redact = value => String(value || '').replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\0', '[redacted-supabase-secret]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\0', '[redacted-supabase-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]');
const unwrap = result => { if (!result || result.error) throw new Error('Supabase operation failed'); return result.data; };
const url = suffix => new URL(`${basePath}${suffix}`, base);
let sequence = 0, sentTick = 0, profileGeneration = 0;
let latest = { profile: null, snap: null, welcome: null, position: null, resources: null, map: null, rafts: [], raftDeck: null }, waiters = [], messages = [];
function receive(message) {
  messages.push(message); if (messages.length > 5000) messages.splice(0, 2000);
  if (message.t === 'profile') { latest.profile = message.p; profileGeneration++; }
  if (message.t === 'snap') latest.snap = message;
  if (message.t === 'welcome') {
    latest.welcome = message;
    if (Number.isSafeInteger(message.seed)) { latest.map = generateWorld(message.seed); latest.raftDeck = new RaftDeck(latest.map); }
  }
  if (message.t === 'snap') {
    if (message.resources) latest.resources = message.resources;
    if (Array.isArray(message.rafts)) { latest.rafts = message.rafts; latest.raftDeck?.update(latest.rafts); }
    const own = message.ents?.find(row => row[0] === latest.welcome?.you);
    if (own) latest.position = { x: own[2], y: own[3], z: own[4] };
  }
  for (const w of [...waiters]) if (w.predicate(message)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(message); }
}
function waitMessage(predicate, label, ms = 15000, fresh = false) {
  const prior = fresh ? null : messages.find(predicate); if (prior) return Promise.resolve(prior);
  if (messages.some(m => m.t === 'error' || m.t === 'full')) return Promise.reject(new Error(`public admission rejected: ${label}`));
  return new Promise((resolve, reject) => {
    const w = { predicate, resolve, timer: setTimeout(() => { waiters = waiters.filter(x => x !== w); reject(new Error(`bounded wait expired: ${label}`)); }, ms) };
    waiters.push(w);
  });
}
async function publicPreflight() {
  const [h, s, a, p, c] = await Promise.all(['/health', '/status', '/auth/config', '/src/net/protocol.js', '/api/world/content'].map(x =>
    fetch(url(x), { cache: 'no-store', signal: timeout(15000) })));
  ensure(h.ok && await h.text() === 'ok', 'public health check failed');
  const status = await s.json(), auth = await a.json(), protocol = await p.text(), content = await c.json();
  ensure(s.ok && status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && status.storage?.durable === true && status.storage?.accounts === true && status.storage?.economic?.enabled === true
    && status.storage?.economic?.failed === false && status.storage?.economic?.pending === 0
    && status.storage?.resources?.enabled === true
    && status.storage?.resources?.ready === true && status.storage?.artisan?.enabled === true
    && status.storage?.artisan?.ready === true
    && status.storage?.workshop?.enabled === true && status.storage?.workshop?.ready === true
    && status.storage?.world?.id === worldId && status.storage?.world?.ready === true && status.storage?.world?.failed === false
    && status.storage?.unsaved === 0 && status.storage?.profileWrites === 0 && status.storage.errors === 0,
  'public release, zero-player, SQL readiness, or durable-store preflight failed');
  const [resourcesReady, workshopReady] = await Promise.all([store.checkResourceOperations(), store.checkStarterWorkshop()]);
  ensure(resourcesReady?.version === 1 && workshopReady?.version === 1, 'SQL resource or starter workshop readiness RPC unavailable');
  const identifiersReady = unwrap(await admin.rpc('mn_workshop_raft_identifiers_ready'));
  ensure(identifiersReady?.version === 1, 'SQL026 workshop raft identity repair is required');
  ensure(a.ok && auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
    'public Auth configuration mismatch');
  ensure(p.ok && protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol mismatch');
  ensure(c.ok && content.ok === true && Number.isSafeInteger(content.generation)
    && (content.revisionId === null || typeof content.revisionId === 'string'), 'public world content identity unavailable');
  contentIdentity = { generation: content.generation, revisionId: content.revisionId };
  check('public_tls_release_and_sql023_024_026_readiness', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION,
    realPlayers: status.players, workshopReady: status.storage.workshop.ready, resourcesReady: status.storage.resources.ready });
}
async function createAccount() {
  const generated = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  accountId = generated.user?.id; ensure(accountId && generated.user.email === email, 'disposable Auth creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: authMarker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === authMarker, 'Auth marker write failed');
  unwrap(await pub.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: 'signup' }));
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'disposable password login failed');
  currentProfile = newProfile(); currentProfile.pirateId = `account:${accountId}`;
  currentProfile.cp = 'aldea';
  ensure(currentProfile.carry?.v === 1 && currentProfile.workshop?.v === 1
    && currentProfile.eco?.pack?.cap === 18 && Number.isFinite(currentProfile.eco.pack.maxMass),
  'starter profile does not include current carry/workshop contracts');
  putCargo(currentProfile, { madera: 3 }, 'initial QA seed');
  const normalized = sanitizeProfile(currentProfile);
  ensure(normalized && JSON.stringify(normalized.eco.pack.goods) === JSON.stringify(currentProfile.eco.pack.goods),
    'QA profile seed changed during sanitization');
  currentProfile = normalized;
  const saved = await store.initializeProfile(accountId, currentProfile);
  ensure(saved?.version === 1 && saved.data?.pirateId === `account:${accountId}`, 'QA profile seed did not persist');
  profileVersion = saved.version;
  return login.session.access_token;
}
async function connect(token) {
  const priorProfileGeneration = profileGeneration;
  sequence = 0; sentTick = 0;
  messages = [];
  latest.welcome = null; latest.position = null; latest.resources = null; latest.rafts = []; latest.raftDeck = null;
  socket = new WebSocket(wsUrl, { origin: base.origin, handshakeTimeout: 10000 });
  socket.on('message', data => { try { receive(JSON.parse(data.toString())); } catch { /* malformed public frame */ } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bounded wait expired: public WSS open')), 15000);
    socket.once('open', () => { clearTimeout(timer); resolve(); });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('public WSS connection failed')); });
  });
  const welcomed = waitMessage(m => m.t === 'welcome', 'authenticated join');
  socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Workshop QA', skin: 0, weapon: 0, save: '',
    token, content: contentIdentity }));
  await welcomed;
  await waitMessage(m => m.t === 'snap' && m.resources && profileGeneration > priorProfileGeneration
    && latest.profile?.pirateId === `account:${accountId}`, 'authenticated profile and snapshot', 30000);
  ensure(wsUrl.protocol === 'wss:', 'public session was not WSS');
  check('disposable_auth_and_public_wss_admission');
}
function send(value) { ensure(socket?.readyState === WebSocket.OPEN, 'WSS is not open'); socket.send(JSON.stringify(value)); }
function sendInputs(mx, mz) {
  sentTick = Math.max(sentTick, latest.snap?.tick || 0);
  const cmds = Array.from({ length: 6 }, () => ({ seq: ++sequence, mx, mz, ax: 0, az: 0,
    btn: 0, prs: 0, pt: ++sentTick, w: 0 }));
  send({ t: 'inputs', cmds });
}
async function awaitProfile(predicate, label, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (predicate(latest.profile)) return latest.profile; await sleep(150); }
  throw new Error(`bounded wait expired: ${label}`);
}
async function command(value) {
  const opId = value.opId || randomUUID().replaceAll('-', '').slice(0, 32);
  const cmd = { t: 'cmd', ...value, opId };
  const expected = latest.profile?.eco?.tradeRev;
  if (cmd.expectedRev === undefined) cmd.expectedRev = expected;
  const ack = waitMessage(m => m.t === 'event' && m.ev?.opId === opId, `ack ${cmd.type}/${cmd.op}`, 15000, true);
  send(cmd); const result = await ack; const ev = result.ev;
  if (ev.ok === true) {
    ensure(ev.durable === true, `successful ${cmd.type}/${cmd.op} ACK was not durable`);
    if (cmd.type !== 'raft' && ev.historical !== true && ev.replay !== true && Number.isSafeInteger(expected))
      await awaitProfile(p => p.eco?.tradeRev > expected, `durable ${cmd.type}/${cmd.op} profile revision`);
  }
  if (ev.durable === true) receipts.add(economicOperationId(worldId, accountId, opId));
  return ev;
}
async function moveTo(target, label, radius = 2.2) {
  ensure(target && latest.position && latest.map, `navigation state unavailable: ${label}`);
  const end = Date.now() + 90000;
  const edge = (from, to) => {
    const distance = Math.hypot(to.x - from.x, to.z - from.z), samples = Math.max(1, Math.ceil(distance / 0.3));
    let prior = { ...from, y: Number.isFinite(from.y) ? from.y : latest.map.groundAt(from.x, from.z) };
    for (let i = 1; i <= samples; i++) {
      const t = i / samples, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      if (!canStand({ map: latest.map, raftDeck: latest.raftDeck }, x, z, tuning.player.radius, prior.y)) return null;
      const surface = latest.raftDeck?.surface(x, z, prior.y), y = surface?.y ?? latest.map.groundAt(x, z);
      const deck0 = latest.map.onDock(prior.x, prior.z) || latest.raftDeck?.surface(prior.x, prior.z, prior.y);
      const deck1 = latest.map.onDock(x, z) || surface, step = Math.hypot(x - prior.x, z - prior.z), rise = y - prior.y;
      if ((deck0 || deck1) ? Math.abs(rise) >= 0.6 : rise / step > tuning.world.maxSlope) return null;
      prior = { x, y, z };
    }
    return prior;
  };
  const start = { ...latest.position, y: Number.isFinite(latest.position.y) ? latest.position.y : latest.map.groundAt(latest.position.x, latest.position.z) };
  const key = (x, z) => `${x},${z}`, startKey = key(0, 0), within = (x, z) => Math.hypot(x, z) < 180;
  const open = [{ ix: 0, iz: 0, ...start, g: 0, f: Math.max(0, Math.hypot(start.x-target.x, start.z-target.z)-radius), key: startKey }];
  const best = new Map([[startKey, 0]]), parent = new Map(), points = new Map([[startKey, start]]);
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = null, visited = 0;
  while (open.length && visited < 18000) {
    open.sort((a,b) => a.f-b.f); const current = open.shift();
    if (current.g !== best.get(current.key)) continue; visited++;
    if (Math.hypot(current.x-target.x,current.z-target.z) <= radius) { found=current.key; break; }
    for (const [dx,dz] of directions) {
      const ix=current.ix+dx, iz=current.iz+dz; if (!within(ix,iz)) continue;
      const x=start.x+ix*0.8, z=start.z+iz*0.8, next=edge(current,{x,z}); if(!next) continue;
      const nextKey=key(ix,iz), g=current.g+0.8*(dx&&dz?Math.SQRT2:1); if(g>=(best.get(nextKey)??Infinity)) continue;
      best.set(nextKey,g); parent.set(nextKey,current.key); points.set(nextKey,next);
      open.push({ix,iz,...next,g,key:nextKey,f:g+Math.max(0,Math.hypot(x-target.x,z-target.z)-radius)});
    }
  }
  ensure(found, visited >= 18000 ? `safe route budget exhausted: ${label}` : `no safe normal route: ${label}`);
  const route=[]; for(let cursor=found;cursor!==startKey;cursor=parent.get(cursor)) route.push(points.get(cursor)); route.reverse();
  const waypoints=[]; let anchor=start,index=0;
  while(index<route.length){let farthest=index;for(let probe=route.length-1;probe>index;probe--)if(edge(anchor,route[probe])){farthest=probe;break;}
    waypoints.push(route[farthest]);anchor=route[farthest];index=farthest+1;}
  let waypoint=0,replans=0,progressAt=Date.now(),prior={...latest.position};
  while(Date.now()<end&&Math.hypot(latest.position.x-target.x,latest.position.z-target.z)>radius){
    while(waypoint<waypoints.length&&Math.hypot(latest.position.x-waypoints[waypoint].x,latest.position.z-waypoints[waypoint].z)<=0.65) waypoint++;
    const goal=waypoints[waypoint]||target,dx=goal.x-latest.position.x,dz=goal.z-latest.position.z,d=Math.hypot(dx,dz);
    sendInputs(d>0.1?dx/d:0,d>0.1?dz/d:0); await sleep(120);
    if(Date.now()-progressAt>1400){if(Math.hypot(latest.position.x-prior.x,latest.position.z-prior.z)<0.18){
      ensure(++replans<=3,`normal movement stalled: ${label}`); throw new Error(`route blocked after bounded replans: ${label}`);}
      progressAt=Date.now();prior={...latest.position};}
  }
  sendInputs(0,0); await sleep(700);
  ensure(Math.hypot(latest.position.x-target.x,latest.position.z-target.z)<=radius+0.5,`bounded walk failed: ${label}`);
}
function artisan(op, extra = {}) { return { type: 'artisan', op, expectedRev: latest.profile.eco.tradeRev, ...extra }; }
function goods(profile = latest.profile) { return profile.eco.pack.goods || {}; }
function assertProfile(condition, label) { ensure(condition, `profile invariant failed: ${label}`); }
function putCargo(profile, values, label) {
  profile.eco.pack.goods = { ...values };
  const used = holdUsed(profile.eco.pack), mass = holdMass(profile.eco.pack);
  ensure(used <= profile.eco.pack.cap && mass <= profile.eco.pack.maxMass, `${label} exceeds seeded pack volume or mass`);
  const normalized = sanitizeProfile(profile);
  ensure(normalized && used === holdUsed(normalized.eco.pack) && mass === holdMass(normalized.eco.pack),
    `${label} cargo failed current profile sanitizer`);
  profile.eco.pack.goods = normalized.eco.pack.goods;
}
async function setSeed(goodsSeed, label, { axe = false } = {}) {
  ensure(socket?.readyState !== WebSocket.OPEN, 'profile seed attempted while connected');
  const statusResponse = await fetch(url('/status'), { cache: 'no-store', signal: timeout(10000) });
  ensure(statusResponse.ok, 'cannot verify QA profile seed is disconnected');
  const status = await statusResponse.json(), state = status.storage;
  ensure(status.players === 0 && status.sockets === 0 && state?.profileWrites === 0 && state?.unsaved === 0
    && state?.worldWriting === false && state?.economic?.pending === 0,
  'QA profile seed stopped: host is not fully drained and disconnected');
  const user = unwrap(await admin.auth.admin.getUserById(accountId));
  ensure(user.user?.email === email && user.user?.user_metadata?.mn_qa_marker === authMarker,
    'QA profile seed stopped: disposable Auth marker mismatch');
  const row = await store.loadProfile(accountId); ensure(row?.data?.pirateId === `account:${accountId}`, 'QA profile ownership mismatch before CAS seed');
  const next = structuredClone(row.data); putCargo(next, goodsSeed, label);
  if (axe) next.tools.axe = 1;
  ensure(next.carry?.v === 1 && next.workshop?.v === 1, 'seeded profile lost starter carry/workshop contracts');
  ensure(sanitizeProfile(next), 'phase seed failed profile sanitizer');
  const saved = await store.saveProfile(accountId, next, row.version);
  ensure(saved?.version === row.version + 1, 'CAS phase seed failed');
  const persisted = await store.loadProfile(accountId);
  ensure(persisted?.version === saved.version && persisted.data?.pirateId === `account:${accountId}`, 'CAS phase seed readback failed');
  assert.deepEqual(persisted.data, next);
  profileVersion = persisted.version; currentProfile = persisted.data; check(label, { cargoKinds: Object.keys(goodsSeed).length });
}
async function onRaft(label) {
  const ship = latest.profile?.eco?.ships?.find(s => s.kind === 'raft');
  ensure(ship?.id, 'QA profile has no starter raft');
  const raft = latest.rafts.find(r => r.id === ship.id && r.owner === latest.welcome?.you && r.parts?.length);
  ensure(raft, 'owned starter raft is not publicly moored');
  const plank = raftGangplank({ ...raft, pilot: null, parts: raft.parts }, latest.map?.dock);
  ensure(plank, 'owned raft has no normal dock gangplank approach');
  await moveTo(plank, `${label} gangplank`, 1.0);
  ensure(latest.position && Math.hypot(latest.position.x - plank.x, latest.position.z - plank.z) <= 1.5,
    'did not reach public gangplank approach');
  const f = raft.yaw || 0;
  const deck = { x: raft.x + Math.cos(f) + Math.sin(f), y: raft.y, z: raft.z - Math.sin(f) + Math.cos(f) };
  await moveTo(deck, `${label} deck`, 1.4);
  return ship;
}
async function placeRaft(ship, piece, opId) {
  const expectedShip = latest.profile.eco.ships.find(s => s.id === ship.id);
  const until = Date.now() + 15000;
  while (Date.now() < until && (latest.rafts.find(r => r.id === ship.id)?.rev ?? -1) < (expectedShip?.rev ?? 0)) await sleep(60);
  ensure((latest.rafts.find(r => r.id === ship.id)?.rev ?? -1) >= (expectedShip?.rev ?? 0), 'raft snapshot revision did not catch up');
  const live = latest.rafts.find(r => r.id === ship.id);
  ensure(live, 'starter raft disappeared');
  const result = await command({ type: 'raft', op: 'place', id: ship.id, expectedRev: live.rev, piece, opId });
  ensure(result.ok, `raft placement denied (${piece[0]})`);
  await awaitProfile(p => p.eco.ships.find(s => s.id === ship.id)?.rev > live.rev, 'durable raft placement profile');
  return result;
}
async function removeKitCrate(ship) {
  const profileShip = latest.profile.eco.ships.find(s => s.id === ship.id);
  const index = profileShip?.grid?.parts?.findIndex(p => p[0] === 'crate' && p[1] === 1 && p[2] === 0);
  ensure(Number.isSafeInteger(index) && index >= 0, 'placed workshop crate not found at its expected cell');
  const piece = [...profileShip.grid.parts[index]], beforePack = goods().madera || 0;
  const beforeHold = profileShip.hold.goods.madera || 0;
  const live = latest.rafts.find(r => r.id === ship.id);
  const result = await command({ type: 'raft', op: 'remove', id: ship.id, expectedRev: live.rev, piece, index,
    opId: 'workshop-remove-crate-for-second-storage' });
  ensure(result.ok, 'normal crate removal failed');
  await awaitProfile(p => !p.eco.ships.find(s => s.id === ship.id)?.grid?.parts?.some(v => v[0] === 'crate' && v[1] === 1 && v[2] === 0),
    'durable crate removal profile');
  const nextShip = latest.profile.eco.ships.find(s => s.id === ship.id);
  const delta = (goods().madera || 0) + (nextShip.hold.goods.madera || 0) - beforePack - beforeHold;
  ensure(delta >= 0 && delta <= 1 && latest.profile.workshop.crateKits === 0,
    'crate salvage exceeded one plank or refunded its workshop kit');
  check('durable_crate_removal_salvages_at_most_one_plank', { salvagedBoards: delta });
  return delta;
}
async function drainAndClose() {
  const closing = socket;
  if (closing && closing.readyState !== WebSocket.CLOSED) {
    const closed = new Promise(resolve => {
      const timer = setTimeout(() => closing.terminate(), 5000);
      closing.once('close', () => { clearTimeout(timer); resolve(); });
    });
    if (closing.readyState < WebSocket.CLOSING) closing.close(1000, 'qa phase boundary');
    await closed;
  }
  socket = null;
  let drained = false; const end = Date.now() + 30000;
  while (!drained && Date.now() < end) {
    const response = await fetch(url('/status'), { cache: 'no-store', signal: timeout(10000) }); ensure(response.ok, 'drain status unavailable');
    const status = await response.json(), state = status.storage;
    drained = status.players === 0 && status.sockets === 0 && state?.profileWrites === 0
      && state?.unsaved === 0 && state?.worldWriting === false && state?.economic?.pending === 0;
    if (!drained) await sleep(300);
  }
  ensure(drained, 'profile writes did not drain');
}

try {
  await fs.promises.mkdir(out, { recursive: true }); await publicPreflight();
  const token = await createAccount(); await connect(token);
  const bench = latest.resources?.bench;
  ensure(bench && Number.isFinite(bench.x) && Number.isFinite(bench.z), 'public snapshot has no workshop bench');
  await moveTo(bench, 'lawful carpentry bench');
  const snap = latest.snap, own = snap.ents?.find(row => row[0] === latest.welcome?.you);
  ensure(own?.[12] > 0 && Math.hypot(latest.position.x - bench.x, latest.position.z - bench.z) < 3
    && Math.abs(latest.position.y - bench.y) < 1.5,
    'bench service distance/alive gate failed');
  check('lawful_bench_navigation');

  // Stage small partial deliveries in drained phases, respecting both starter carry limits.
  const first = artisan('contribute', { amount: 3, opId: 'workshop-partial-three' });
  const firstAck = await command(first); ensure(firstAck.ok, 'first partial delivery denied');
  await awaitProfile(p => p.workshop?.boards === 3, 'partial project persisted');
  assertProfile(goods().madera === undefined && latest.profile.workshop.storageCredit === false, 'partial-five debit and no reward');
  const firstReceiptId = economicOperationId(worldId, accountId, first.opId);
  const receipt = await store.loadEconomicOperation(firstReceiptId); ensure(receipt?.request?.profile?.workshop?.boards === 3, 'partial receipt missing');
  const retryAck = await command(first); ensure(retryAck.historical === true || retryAck.replay === true, 'exact retry was not historical');
  await awaitProfile(p => p.workshop?.boards === 3, 'retry left profile unchanged');
  assertProfile(goods().madera === undefined && latest.profile.workshop.storageCredit === false, 'exact retry double-debited');
  check('partial_delivery_and_exact_retry', { historical: true, boards: 3 });

  // A rejected operation with no boards leaves the workshop profile unchanged.
  const beforeDenied = structuredClone(latest.profile);
  const denied = await command(artisan('contribute', { amount: 1, opId: 'workshop-insufficient-goods' }));
  ensure(denied.ok === false, 'insufficient goods operation unexpectedly succeeded');
  await awaitProfile(p => p.eco.tradeRev === beforeDenied.eco.tradeRev, 'denial left profile unchanged');
  assert.deepEqual(latest.profile, beforeDenied); check('insufficient_goods_unchanged');
  await drainAndClose();
  await setSeed({ madera: 2 }, 'disconnected_second_partial_seed');
  await connect(token); await moveTo(bench, 'return to lawful carpentry bench');
  const secondPartial = await command(artisan('contribute', { amount: 2, opId: 'workshop-partial-five' }));
  ensure(secondPartial.ok, 'second partial delivery denied');
  await awaitProfile(p => p.workshop?.boards === 5 && p.workshop.storageCredit === false, 'five-board partial persisted');
  await drainAndClose(); await setSeed({ madera: 3 }, 'disconnected_third_partial_seed');
  await connect(token); await moveTo(bench, 'return to lawful carpentry bench');
  const thirdPartial = await command(artisan('contribute', { amount: 3, opId: 'workshop-partial-eight' }));
  ensure(thirdPartial.ok, 'third partial delivery denied');
  await awaitProfile(p => p.workshop?.boards === 8 && p.workshop.storageCredit === false, 'eight-board partial persisted');
  await drainAndClose(); await setSeed({ madera: 2 }, 'disconnected_final_boards_seed');
  await connect(token); await moveTo(bench, 'return to lawful carpentry bench');
  const final = await command(artisan('contribute', { amount: 2, opId: 'workshop-final-ten' }));
  ensure(final.ok, 'final partial delivery denied');
  await awaitProfile(p => p.workshop?.boards === 10 && p.workshop.storageCredit === true, 'first-storage credit');
  assertProfile(latest.profile.workshop.boards === 10 && latest.profile.workshop.storageCredit === true
    && latest.profile.progression?.knowledge?.includes('raft_storage'), 'first project reward incorrect');
  check('ten_board_project_and_single_credit');

  // Seed kit materials only while this disposable QA account is disconnected and drained.
  await drainAndClose(); await setSeed({ madera: 2 }, 'disconnected_crate_material_seed'); await connect(token);
  await moveTo(bench, 'return to lawful carpentry bench');
  // Kit uses its normal artisan command; duplicate command must be a historical receipt and consume once.
  const kitCmd = artisan('craftCrate', { opId: 'workshop-crate-kit' });
  const kit = await command(kitCmd); ensure(kit.ok, 'two-board crate kit denied');
  await awaitProfile(p => p.workshop?.crateKits === 1, 'crate kit persisted');
  assertProfile(goods().madera === undefined && latest.profile.workshop.crateKits === 1, 'crate kit state mismatch');
  const kitRetry = await command(kitCmd); ensure(kitRetry.historical === true || kitRetry.replay === true, 'crate retry not historical');
  await awaitProfile(p => p.workshop?.crateKits === 1, 'crate retry did not duplicate kit');
  check('two_board_crate_kit_consumed_once');

  const ship = await onRaft('walk to lawful starter raft deck');
  await placeRaft(ship, ['storage', 0, 1, 0, 0], 'workshop-first-storage-credit');
  await awaitProfile(p => p.workshop?.storageCredit === false, 'first storage credit consumed');
  assertProfile(latest.profile.eco.ships.find(s => s.id === ship.id).hold.cap === 26, 'first storage capacity missing');
  const stableStorage = structuredClone(latest.profile), storageRev = stableStorage.eco.ships.find(s => s.id === ship.id).rev;
  const occupied = await command({ type: 'raft', op: 'place', id: ship.id, expectedRev: storageRev,
    piece: ['storage', 0, 1, 0, 0], opId: 'workshop-occupied-storage' });
  ensure(occupied.ok === false && occupied.durable === true, 'occupied placement did not produce a durable denial');
  assert.deepEqual(latest.profile, stableStorage);
  const stale = await command({ type: 'raft', op: 'place', id: ship.id, expectedRev: storageRev - 1,
    piece: ['storage', 1, 0, 0, 0], opId: 'workshop-stale-storage' });
  ensure(stale.ok === false && stale.why === 'revision' && stale.durable === true && stale.record,
    'stale placement did not produce a durable revision denial');
  assert.deepEqual(latest.profile, stableStorage);
  check('occupied_and_stale_raft_edits_are_durable_unchanged_denials');
  await placeRaft(ship, ['crate', 1, 0, 0, 0], 'workshop-crate-from-kit');
  await awaitProfile(p => p.workshop?.crateKits === 0, 'crate kit placement consumed');
  assertProfile(latest.profile.workshop.crateKits === 0, 'crate kit refunded after placement');
  check('first_credit_storage_and_crate_placement');

  // Stage five pack boards plus four in the hold, then remove the kit crate normally. Its salvage is at most one board.
  await drainAndClose(); await setSeed({ madera: 5 }, 'disconnected_paid_storage_pack_seed');
  await connect(token); let paidShip = await onRaft('return to raft for paid storage cargo');
  let live = latest.rafts.find(r => r.id === paidShip.id);
  const supplied = await command({ type: 'commerce', op: 'transfer', id: paidShip.id, expectedRev: live.rev,
    g: 'madera', n: 4, side: 'deposit', opId: 'workshop-paid-storage-hold-four' });
  ensure(supplied.ok, 'normal four-board raft deposit was denied');
  await awaitProfile(p => p.eco.ships.find(s => s.id === paidShip.id)?.rev > live.rev
    && p.eco.pack.goods.madera === 1 && p.eco.ships.find(s => s.id === paidShip.id)?.hold.goods.madera === 4,
  'normal raft deposit profile');
  await drainAndClose(); await setSeed({ madera: 5 }, 'disconnected_paid_storage_pack_completion');
  await connect(token); paidShip = await onRaft('return to remove kit crate');
  const salvage = await removeKitCrate(paidShip);
  const stagedTotal = (goods().madera || 0) + (latest.profile.eco.ships.find(s => s.id === paidShip.id).hold.goods.madera || 0);
  if (stagedTotal === 9) {
    await drainAndClose(); await setSeed({ madera: 6 }, 'disconnected_paid_storage_final_board_seed');
    await connect(token); paidShip = await onRaft('return with final paid-storage board');
  } else ensure(stagedTotal === 10 && salvage === 1, 'paid storage material staging is not exactly ten planks');
  const exactTotal = (goods().madera || 0) + (latest.profile.eco.ships.find(s => s.id === paidShip.id).hold.goods.madera || 0);
  ensure(exactTotal === 10, 'paid second storage was not staged with exactly ten planks');
  await placeRaft(paidShip, ['storage', 1, 0, 0, 0], 'workshop-paid-second-storage');
  await awaitProfile(p => p.eco.ships.find(s => s.id === paidShip.id)?.hold.cap === 46, 'paid second storage capacity');
  const postPaid = latest.profile.eco.ships.find(s => s.id === paidShip.id);
  assertProfile(goods().madera === undefined && postPaid.hold.goods.madera === undefined,
    'paid second hold did not consume ten planks');
  check('paid_second_storage_costs_ten_boards');

  await drainAndClose(); await setSeed({ madera: 2, lona: 3 }, 'disconnected_backpack_upgrade_seed');
  await connect(token); await moveTo(bench, 'return to lawful carpentry bench for backpack upgrade');
  const beforeCarry = latest.profile.carry?.backpack;
  const upgrade = await command(artisan('upgradePack', { opId: 'workshop-backpack-upgrade' }));
  ensure(upgrade.ok, 'backpack upgrade denied');
  await awaitProfile(p => p.carry?.backpack === beforeCarry + 1 && p.eco.pack.goods.madera === undefined
    && p.eco.pack.goods.lona === undefined, 'backpack upgrade debit and capacity tier');
  const upgradeReceipt = await store.loadEconomicOperation(economicOperationId(worldId, accountId, 'workshop-backpack-upgrade'));
  ensure(upgradeReceipt?.request?.before?.carry?.backpack === beforeCarry
    && upgradeReceipt?.request?.profile?.carry?.backpack === beforeCarry + 1,
  'backpack upgrade receipt does not show post-cost carry tier');
  check('backpack_upgrade_after_cost');

  // Two logs become one plank through the ordinary public resource crafting command.
  await drainAndClose(); await setSeed({ tronco: 2 }, 'disconnected_logging_material_seed');
  await connect(token); await moveTo(bench, 'return for public crafting');
  const crafted = await command({ type: 'resource', op: 'craft', recipe: 'madera', n: 1,
    expectedRev: latest.profile.eco.tradeRev, opId: 'workshop-two-logs-one-plank' });
  ensure(crafted.ok, 'two-log plank craft failed'); await awaitProfile(p => p.eco.pack.goods.madera === 1, 'crafted plank persisted');
  assertProfile(latest.profile.eco.pack.goods.tronco === undefined, 'two logs were not consumed'); check('two_logs_to_one_plank');

  // Save/reconnect verifies profile durability and immutable historical receipt identity.
  await drainAndClose();
  const stored = await store.loadProfile(accountId);
  ensure(stored?.data?.pirateId === `account:${accountId}` && stored.data.workshop?.boards === 10
    && stored.data.workshop?.crateKits === 0 && stored.data.workshop?.storageCredit === false
    && stored.data.eco.pack.goods.madera === 1,
  'disconnected persisted QA profile mismatch');
  await connect(token);
  assertProfile(latest.profile.workshop.boards === 10 && latest.profile.workshop.crateKits === 0
    && latest.profile.eco.pack.goods.madera === 1, 'reconnected profile projection mismatch');
  const historical = await command(first); ensure(historical.historical === true || historical.replay === true, 'reconnected exact retry not historical');
  const retained = await store.loadEconomicOperation(firstReceiptId);
  ensure(retained?.request?.profile?.workshop?.boards === 3 && retained.request.command.opId === first.opId,
    'historical receipt changed after reconnect');
  check('reconnect_profile_and_historical_receipt');
  await drainAndClose(); await setSeed({}, 'disconnected_timed_logging_axe_seed', { axe: true });
  await connect(token);
  await acceptTimedLogging({ getLatest: () => latest, send, waitMessage, moveTo, awaitProfile, store, worldId,
    accountId, receipts, check, ensure, sleep });
  evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; details suppressed';
  process.exitCode = 1;
} finally {
  try {
    if (accountId) {
      await drainAndClose();
      const auth = unwrap(await admin.auth.admin.getUserById(accountId));
      ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === authMarker,
        'cleanup stopped: disposable Auth identity marker mismatch');
      const row = await store.loadProfile(accountId);
      if (row) {
        ensure(row.data?.pirateId === `account:${accountId}` && row.data?.workshop?.v === 1,
          'cleanup stopped: QA profile ownership sentinel mismatch');
        const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id'));
        ensure(deleted?.length === 1 && deleted[0].player_id === accountId, 'QA profile exact-row cleanup failed');
      }
      unwrap(await admin.auth.admin.deleteUser(accountId));
      ensure(await store.loadProfile(accountId) === null, 'QA profile remains after cleanup');
      let retained = 0;
      for (const id of receipts) if (await store.loadEconomicOperation(id)) retained++;
      ensure(retained === receipts.size, 'cleanup stopped: acknowledged immutable receipt missing');
      evidence.cleanup = { temporaryAuthAndProfileRemoved: true, retainedReceiptCount: retained,
        receiptPolicy: 'economic receipts intentionally retained' };
    }
  } catch (error) { evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1; }
  evidence.completedAt = new Date().toISOString();
  await fs.promises.mkdir(out, { recursive: true });
  const file = path.join(out, `public-${tag}.json`);
  await fs.promises.writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  await pub.auth.signOut().catch(() => {});
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, gameVersion: evidence.gameVersion,
    protocolVersion: evidence.protocol, cleanup: evidence.cleanup || null, failure: evidence.failure || evidence.cleanupFailure || null }));
}

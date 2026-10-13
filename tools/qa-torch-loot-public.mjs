#!/usr/bin/env node
// Bounded, disposable-account public WSS acceptance for SQL037 palm loot.
// This changes only one marked QA profile and naturally depletes at most three palms.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { storeFromEnv } from '../server/store.mjs';
import { economicCommand, economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { carryLimits } from '../src/data/carry.js';
import { harvestLoot } from '../src/data/harvestLoot.js';
import { HARVEST } from '../src/data/resources.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { canStand } from '../src/sim/systems/movement.js';
import { PLAYER_FIELDS } from '../src/sim/ecs.js';
import { tuning } from '../src/data/tuning.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { evaluateLoggingChallenge } from '../src/sim/systems/loggingTiming.js';
import { LOGGING_TIMING } from '../src/data/loggingTiming.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'usage: node tools/qa-torch-loot-public.mjs [--env-file PATH]';
const ensure = (value, reason) => { if (!value) throw new Error(reason); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = ms => AbortSignal.timeout(ms);
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(12000) }) } };
let envFile = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (process.argv[i] === '--help' || process.argv[i] === '-h') { console.log(usage); process.exit(0); }
  else throw new Error(usage);
}
if (envFile) { try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('environment file unavailable'); } }
ensure(process.env.MN_QA_ALLOW_PUBLIC === '1', 'Public torch-loot QA launch guard is active.');
ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
  'Supabase QA configuration unavailable');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
const store = storeFromEnv();
const base = new URL(process.env.MN_WORKSHOP_TARGET || 'https://marea.62.171.136.148.sslip.io');
ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname), 'public TLS target required');
const basePath = base.pathname.replace(/\/$/, ''); base.search = ''; base.hash = '';
const url = suffix => new URL(`${basePath}${suffix}`, base);
const wsUrl = new URL(`${basePath}/ws`, base); wsUrl.protocol = 'wss:';
const worldId = process.env.WORLD_ID || 'marea-negra';
const tag = randomUUID(), email = `mn-torch-loot-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`;
const authMarker = `mnQaTorchLootPublic:${tag}`;
const out = path.resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/torch-resin-coconut/public');
const MAX_RUNTIME_MS = 10 * 60 * 1000, MAX_PALMS = 3;
const startedAt = Date.now();
const workDeadline = startedAt + MAX_RUNTIME_MS - 60_000;
let accountId = null, socket = null, token = null, contentIdentity = null, profileVersion = null;
const receiptOps = new Map();
const evidence = { schema: 'mn.torch-resin-coconut.public.v1', at: new Date().toISOString(), target: base.origin,
  identity: 'random disposable Supabase user; credentials redacted', protocol: PROTOCOL_VERSION, gameVersion: GAME.version,
  checks: [], errors: [] };
const check = (name, data = {}) => { evidence.checks.push({ name, pass: true, ...data }); console.log(JSON.stringify({ check: name, pass: true })); };
const redact = value => String(value || '').replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\0', '[redacted-supabase-secret]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\0', '[redacted-supabase-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]');
const unwrap = result => { if (!result || result.error) throw new Error('Supabase operation failed'); return result.data; };
const alive = () => ensure(Date.now() < workDeadline, 'public canary exceeded its bounded work window');

let sequence = 0, sentTick = 0, profileGeneration = 0;
let latest = { profile: null, snap: null, welcome: null, position: null, resources: null, map: null }, waiters = [], messages = [];
function receive(message) {
  messages.push(message); if (messages.length > 2500) messages.splice(0, 1000);
  if (message.t === 'profile') { latest.profile = message.p; profileGeneration++; }
  if (message.t === 'welcome') {
    latest.welcome = message;
    if (Number.isSafeInteger(message.seed)) latest.map = generateWorld(message.seed);
  }
  if (message.t === 'snap') {
    latest.snap = message;
    if (message.resources) latest.resources = message.resources;
    const own = message.ents?.find(row => row[0] === latest.welcome?.you);
    if (own) latest.position = { x: own[2], y: own[3], z: own[4] };
  }
  for (const w of [...waiters]) if (w.predicate(message)) {
    waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(message);
  }
}
function waitMessage(predicate, label, ms = 12000, fresh = false) {
  const prior = fresh ? null : messages.find(predicate); if (prior) return Promise.resolve(prior);
  if (messages.some(m => m.t === 'error' || m.t === 'full')) return Promise.reject(new Error(`public admission rejected: ${label}`));
  return new Promise((resolve, reject) => {
    const w = { predicate, resolve, timer: setTimeout(() => {
      waiters = waiters.filter(x => x !== w); reject(new Error(`bounded wait expired: ${label}`));
    }, ms) };
    waiters.push(w);
  });
}

async function publicPreflight() {
  const responses = await Promise.all(['/health', '/status', '/auth/config', '/src/net/protocol.js', '/api/world/content'].map(p =>
    fetch(url(p), { cache: 'no-store', signal: timeout(12000) })));
  const [healthResponse, statusResponse, authResponse, protocolResponse, contentResponse] = responses;
  ensure(healthResponse.ok && await healthResponse.text() === 'ok', 'public health check failed');
  ensure(statusResponse.ok && authResponse.ok && protocolResponse.ok && contentResponse.ok, 'public preflight endpoint unavailable');
  const status = await statusResponse.json(), auth = await authResponse.json(), protocol = await protocolResponse.text();
  const content = await contentResponse.json();
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && status.storage?.durable === true && status.storage?.accounts === true
    && status.storage?.economic?.enabled === true && status.storage?.economic?.failed === false
    && status.storage?.economic?.pending === 0 && status.storage?.resources?.enabled === true
    && status.storage?.resources?.ready === true && status.storage?.resources?.logging === true
    && status.storage?.workshop?.enabled === true
    && status.storage?.workshop?.ready === true && status.storage?.fire?.enabled === true
    && status.storage?.fire?.ready === true && status.storage?.freshwater?.enabled === true
    && status.storage?.freshwater?.ready === true && status.storage?.freshwater?.canteen === true
    && status.storage?.foraging?.enabled === true
    && status.storage?.foraging?.ready === true && status.storage?.fire?.torchRules === 2
    && status.storage?.world?.id === worldId && status.storage?.world?.ready === true
    && status.storage?.world?.failed === false && status.storage?.unsaved === 0
    && status.storage?.profileWrites === 0 && status.storage?.errors === 0,
  'public release, zero-player, feature flags, SQL readiness, or durable-store preflight failed');
  const ready = await store.checkTorchResinCoconutOperations();
  ensure(ready?.version === 1, 'SQL037 readiness RPC unavailable');
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
    'public Auth configuration mismatch');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol mismatch');
  ensure(Number.isSafeInteger(content.generation) && (content.revisionId === null || typeof content.revisionId === 'string'),
    'public world content identity unavailable');
  contentIdentity = { generation: content.generation, revisionId: content.revisionId };
  check('public_tls_release_and_sql037_readiness', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION,
    players: status.players, foragingReady: status.storage.foraging.ready, torchRules: status.storage.fire.torchRules });
}

async function createAccount() {
  const generated = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  accountId = generated.user?.id;
  ensure(accountId && generated.user.email === email, 'disposable Auth creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: authMarker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === authMarker, 'Auth marker write failed');
  unwrap(await pub.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: 'signup' }));
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'disposable password login failed');
  token = login.session.access_token;

  const profile = newProfile();
  profile.pirateId = `account:${accountId}`;
  profile.lvl = 10;
  profile.carry = { v: 1, backpack: 2 };
  profile.attr = { v: 1, carga: 9, re: 0 };
  const limits = carryLimits(profile.carry, profile.lvl);
  profile.eco.pack.cap = limits.volume;
  profile.eco.pack.maxMass = 50 + 5 * profile.attr.carga;
  profile.eco.pack.goods = {};
  profile.tools.axe = 1;
  ensure(profile.eco.pack.cap === 42 && profile.eco.pack.maxMass === 95,
    'seeded backpack/Carga limits are not the intended legal level-10 limits');
  ensure(sanitizeProfile(profile), 'seeded profile failed local sanitization');
  const saved = await store.initializeProfile(accountId, profile);
  ensure(saved?.version === 1 && saved.data?.pirateId === `account:${accountId}`
    && Object.keys(saved.data.eco.pack.goods).length === 0 && saved.data.tools.axe === 1,
  'empty axe-enabled disposable profile did not persist');
  profileVersion = saved.version;
  return token;
}

async function connect() {
  messages = []; latest = { profile: null, snap: null, welcome: null, position: null, resources: null, map: null };
  sequence = 0; sentTick = 0; const priorGeneration = profileGeneration;
  socket = new WebSocket(wsUrl, { origin: base.origin, handshakeTimeout: 10000 });
  socket.on('message', data => { try { receive(JSON.parse(data.toString())); } catch { /* ignore malformed public frame */ } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bounded wait expired: public WSS open')), 12000);
    socket.once('open', () => { clearTimeout(timer); resolve(); });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('public WSS connection failed')); });
  });
  const welcomed = waitMessage(m => m.t === 'welcome', 'authenticated join');
  socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Torch Loot QA', skin: 0, weapon: 0,
    save: '', token, content: contentIdentity }));
  await welcomed;
  await waitMessage(m => m.t === 'snap' && m.resources && profileGeneration > priorGeneration
    && latest.profile?.pirateId === `account:${accountId}`, 'authenticated profile and resources', 25000);
  ensure(wsUrl.protocol === 'wss:', 'public session was not WSS');
  ensure(latest.profile?.tools?.axe === 1 && latest.profile?.pirateId === `account:${accountId}`,
    'public profile did not restore the marked axe account');
  check('disposable_auth_and_public_wss_admission');
}

function send(value) { ensure(socket?.readyState === WebSocket.OPEN, 'WSS is not open'); socket.send(JSON.stringify(value)); }
function sendInputs(mx, mz) {
  sentTick = Math.max(sentTick, latest.snap?.tick || 0);
  const cmds = Array.from({ length: 6 }, () => ({ seq: ++sequence, mx, mz, ax: 0, az: 0,
    btn: 0, prs: 0, pt: ++sentTick, w: 0 }));
  send({ t: 'inputs', cmds });
}
async function awaitProfile(predicate, label, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { alive(); if (predicate(latest.profile)) return latest.profile; await sleep(120); }
  throw new Error(`bounded wait expired: ${label}`);
}

function planRoute(target, radius = 1.7) {
  alive(); ensure(latest.map && latest.position && target, 'navigation state unavailable');
  const map = latest.map, start = { ...latest.position };
  const key = (x, z) => `${x},${z}`, step = 0.8, startKey = key(0, 0);
  const within = (ix, iz) => Math.hypot(ix * step, iz * step) < 100;
  const edge = (from, to) => {
    const d = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(1, Math.ceil(d / 0.28));
    let prior = { ...from, y: Number.isFinite(from.y) ? from.y : map.groundAt(from.x, from.z) };
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      const y = map.groundAt(x, z);
      if (!Number.isFinite(y) || !canStand({ map }, x, z, tuning.player.radius, prior.y)) return null;
      const ds = Math.hypot(x - prior.x, z - prior.z);
      if (ds > 0 && (y - prior.y) / ds > tuning.world.maxSlope) return null;
      prior = { x, y, z };
    }
    return prior;
  };
  const open = [{ ix: 0, iz: 0, ...start, g: 0, f: Math.max(0, Math.hypot(start.x - target.x, start.z - target.z) - radius), k: startKey }];
  const best = new Map([[startKey, 0]]), parents = new Map(), points = new Map([[startKey, start]]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = null, visited = 0;
  while (open.length && visited < 9000) {
    alive(); open.sort((a, b) => a.f - b.f); const cur = open.shift();
    if (cur.g !== best.get(cur.k)) continue; visited++;
    if (Math.hypot(cur.x - target.x, cur.z - target.z) <= radius) { found = cur.k; break; }
    for (const [dx, dz] of dirs) {
      const ix = cur.ix + dx, iz = cur.iz + dz; if (!within(ix, iz)) continue;
      const x = start.x + ix * step, z = start.z + iz * step, next = edge(cur, { x, z }); if (!next) continue;
      const k = key(ix, iz), g = cur.g + step * (dx && dz ? Math.SQRT2 : 1);
      if (g >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g); parents.set(k, cur.k); points.set(k, next);
      open.push({ ix, iz, ...next, g, k, f: g + Math.max(0, Math.hypot(x - target.x, z - target.z) - radius) });
    }
  }
  ensure(found, 'no safe normal route');
  const route = []; for (let k = found; k !== startKey; k = parents.get(k)) route.push(points.get(k)); route.reverse();
  const waypoints = []; let anchor = start, index = 0;
  while (index < route.length) {
    let farthest = index;
    for (let probe = route.length - 1; probe > index; probe--) if (edge(anchor, route[probe])) { farthest = probe; break; }
    waypoints.push(route[farthest]); anchor = route[farthest]; index = farthest + 1;
  }
  return { start, route, waypoints, cost: route.length * 0.8, visited, plannedAtTick: latest.snap?.tick ?? 0 };
}

async function moveTo(target, label, radius = 1.7, plan = planRoute(target, radius)) {
  const { waypoints, plannedAtTick } = plan;
  await waitMessage(m => m.t === 'snap' && m.tick > plannedAtTick,
    `fresh navigation frame: ${label}`, 10000, true);
  const end = Math.min(workDeadline, Date.now() + 90000);
  let waypoint = 0, progressAt = Date.now(), prior = { ...latest.position };
  while (Date.now() < end && Math.hypot(latest.position.x - target.x, latest.position.z - target.z) > radius) {
    alive();
    while (waypoint < waypoints.length && Math.hypot(latest.position.x - waypoints[waypoint].x,
      latest.position.z - waypoints[waypoint].z) <= 0.15) waypoint++;
    const goal = waypoints[waypoint] || target;
    const dx = goal.x - latest.position.x, dz = goal.z - latest.position.z, distance = Math.hypot(dx, dz);
    const speedScale = distance < 1.5 ? distance / 1.5 : 1;
    sendInputs(distance > 0.1 ? dx / distance * speedScale : 0,
      distance > 0.1 ? dz / distance * speedScale : 0);
    await sleep(120);
    if (Date.now() - progressAt > 1400) {
      if (Math.hypot(latest.position.x - prior.x, latest.position.z - prior.z) < 0.18) {
        const p = latest.position, next = waypoints[waypoint] || target;
        evidence.navigationFailure = { label, start: plan.start, position: { x: p.x, y: p.y, z: p.z },
          target: { x: target.x, y: target.y ?? null, z: target.z }, goal: { x: next.x, y: next.y ?? null, z: next.z },
          waypoint, waypointCount: waypoints.length, radius, routeVisited: plan.visited,
          sentSequence: sequence, acknowledgedSequence: latest.snap?.ack ?? null, snapshotTick: latest.snap?.tick ?? null,
          player: Object.fromEntries(['hp', 'dead', 'stagger', 'speed', 'moveMul', 'vx', 'vz'].map(field =>
            [field, latest.snap?.you?.[PLAYER_FIELDS.indexOf(field)] ?? null])) };
        throw new Error(`normal movement stalled: ${label}`);
      }
      progressAt = Date.now(); prior = { ...latest.position };
    }
  }
  sendInputs(0, 0); await sleep(700);
  const gap = Math.hypot(latest.position.x - target.x, latest.position.z - target.z);
  evidence.navigation = { label, gap: Number(gap.toFixed(3)), radius, waypointCount: waypoints.length,
    routeVisited: plan.visited };
  ensure(gap <= radius + 0.5, `bounded normal walk failed: ${label}`);
}

async function harvestOnePalm() {
  const getNode = id => latest.resources?.nodes?.find(row => row.id === id);
  const initialProfile = structuredClone(latest.profile), position = latest.position;
  ensure(position && latest.map && latest.resources?.lootRules === 1, 'public resource rule or navigation state missing');
  const palms = (latest.resources.nodes || []).filter(n => n.kind === 'palm' && n.ready === true && n.hits === 0
    && Math.hypot(n.x - position.x, n.z - position.z) <= 65)
    .map(n => ({ node: n, expected: harvestLoot('palm', n.id, n.rev + HARVEST.palmHits) }))
    .sort((a, b) => Math.hypot(a.node.x - position.x, a.node.z - position.z)
      - Math.hypot(b.node.x - position.x, b.node.z - position.z) || a.node.id.localeCompare(b.node.id))
    .slice(0, MAX_PALMS);
  ensure(palms.length, 'no nearby available unstarted palm in public snapshot');
  const candidates = [];
  let selected = null, selectedPlan = null;
  const walkRadius = Math.min(2.2, HARVEST.radius - 0.25);
  for (const candidate of palms) {
    alive();
    const distance = Math.hypot(candidate.node.x - position.x, candidate.node.z - position.z);
    const record = { id: candidate.node.id, revision: candidate.node.rev, distance: Number(distance.toFixed(2)),
      expectedResin: candidate.expected.resina === 1, expectedCoconut: candidate.expected.coco === 1 };
    candidates.push(record);
    if (!candidate.expected.resina && !candidate.expected.coco) { record.route = 'skipped_no_bonus'; continue; }
    try {
      const plan = planRoute(candidate.node, walkRadius);
      record.route = 'reachable'; record.routeCost = Number(plan.cost.toFixed(2)); record.routeVisited = plan.visited;
      if (!selected || plan.cost < selectedPlan.cost) { selected = candidate; selectedPlan = plan; }
    } catch {
      record.route = 'unreachable_with_normal_inputs';
    }
  }
  ensure(selected, 'no reachable bonus-yield palm among the three nearest candidates');
  evidence.candidatePalms = candidates;
  await moveTo(selected.node, 'nearby reachable palm', walkRadius, selectedPlan);
  const arrived = latest.position;
  ensure(Math.hypot(arrived.x - selected.node.x, arrived.z - selected.node.z) <= HARVEST.radius
    && Math.abs(arrived.y - selected.node.y) <= 1.5, 'stopped outside normal palm reach');

  const commands = [], qualities = [];
  let expectedRev = selected.node.rev;
  for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
    alive();
    const liveNode = getNode(selected.node.id);
    ensure(liveNode?.rev === expectedRev && liveNode.hits === hit - 1 && liveNode.ready === true,
      `palm changed before timed hit ${hit}`);
    ensure(Math.hypot(latest.position.x - liveNode.x, latest.position.z - liveNode.z) <= HARVEST.radius,
      `player left normal harvest range before hit ${hit}`);
    let aim = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      alive();
      const aimWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'loggingAim'
        && m.ev.node === liveNode.id && m.ev.rev === expectedRev, `timed gather aim ${hit}`, 5000, true);
      send({ t: 'cmd', type: 'resource', op: 'aim', node: liveNode.id, expectedRev });
      const result = (await aimWait).ev;
      if (result.ok === true) { aim = result; break; }
      ensure(['busy', 'combat', 'cooldown'].includes(result.why), `timed gather aim denied: ${result.why || 'unknown'}`);
      await sleep(result.why === 'cooldown' ? 300 : 180);
    }
    ensure(aim?.challengeId && aim.challenge?.node === liveNode.id && aim.challenge?.rev === expectedRev
      && Number.isSafeInteger(aim.challenge.startTick) && Number.isSafeInteger(aim.challenge.targetTick)
      && Number.isSafeInteger(aim.challenge.endTick) && aim.challenge.targetTick === aim.challenge.startTick + LOGGING_TIMING.targetOffsetTicks
      && aim.challenge.endTick === aim.challenge.startTick + LOGGING_TIMING.endOffsetTicks
      && aim.challenge.v === LOGGING_TIMING.version
      && LOGGING_TIMING.ranks.some(rank => rank.width === aim.challenge.width),
    `server timed-gather challenge missing for hit ${hit}`);
    const challenge = aim.challenge, deadline = Date.now() + 7000;
    while (true) {
      alive(); const tick = latest.resources?.logicalTick;
      ensure(Number.isSafeInteger(tick) && tick <= challenge.endTick, `timed-gather challenge expired at hit ${hit}`);
      if (tick >= challenge.targetTick) break;
      ensure(Date.now() < deadline, `resource clock stalled before hit ${hit}`);
      await waitMessage(m => m.t === 'snap' && latest.resources?.logicalTick >= challenge.targetTick,
        `target resource tick hit ${hit}`, 1500, true);
    }
    const command = { t: 'cmd', type: 'resource', op: 'gather', opId: `torch_loot_${randomUUID()}`,
      node: liveNode.id, expectedRev, challenge: aim.challengeId, lootRules: 1 };
    const receiptId = economicOperationId(worldId, accountId, command.opId);
    receiptOps.set(receiptId, { opId: command.opId, command: structuredClone(command), acknowledged: false,
      receiptExpected: false });
    const ackWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'resource' && m.ev.opId === command.opId,
      `durable palm gather hit ${hit}`, 15000, true);
    send(command); const ack = (await ackWait).ev;
    receiptOps.get(receiptId).acknowledged = true;
    receiptOps.get(receiptId).receiptExpected = ack.ok === true || ack.durable === true;
    ensure(ack.ok === true && ack.durable === true && ack.op === 'gather' && ack.rev === expectedRev + 1
      && ack.remaining === HARVEST.palmHits - hit && Number.isSafeInteger(ack.actionTicks) && ack.actionTicks > 0,
    `durable gather acknowledgement mismatch on hit ${hit}`);
    ensure(ack.timing?.challenge && stable(ack.timing.challenge) === stable(challenge)
      && Number.isSafeInteger(ack.timing.receivedTick), `server timing proof missing on hit ${hit}`);
    const timing = evaluateLoggingChallenge(ack.timing.challenge,
      { rev: expectedRev, receivedTick: ack.timing.receivedTick });
    ensure(ack.timing.quality === timing.quality, `server timing quality mismatch on hit ${hit}`);
    qualities.push(timing.quality);
    const expectedLogs = hit === HARVEST.palmHits ? 3 + qualities.reduce((sum, q) => sum + q, 0) : 0;
    ensure(ack.count === expectedLogs, `palm timber yield mismatch on hit ${hit}`);
    if (hit < HARVEST.palmHits) ensure(!Object.hasOwn(ack, 'loot'), 'bonus loot was awarded before final hit');
    else assert.deepEqual(ack.loot || {}, selected.expected, 'final deterministic bonus loot mismatch');
    commands.push({ command, ack });

    const receipt = await store.loadEconomicOperation(receiptId);
    const receiptAck = structuredClone(ack); delete receiptAck.to; delete receiptAck.durable;
    ensure(receipt?.request?.world === worldId && receipt.request.account === accountId
      && stable(receipt.request.command) === stable(economicCommand(command))
      && stable(receipt.request.ack) === stable(receiptAck)
      && stable(receipt.result?.ack) === stable(receipt.request.ack)
      && receipt.result.ack.opId === command.opId,
    `durable SQL receipt mismatch on palm hit ${hit}`);
    expectedRev = ack.rev;
    await waitMessage(m => m.t === 'snap' && getNode(selected.node.id)?.rev === expectedRev
      && getNode(selected.node.id)?.hits === hit, `public palm revision ${hit}`, 12000, true);
    if (hit === HARVEST.palmHits) {
      const expectedGoods = structuredClone(initialProfile.eco.pack.goods);
      expectedGoods.tronco = (expectedGoods.tronco || 0) + expectedLogs;
      for (const [good, count] of Object.entries(selected.expected)) expectedGoods[good] = (expectedGoods[good] || 0) + count;
      await awaitProfile(p => stable(p.eco?.pack?.goods || {}) === stable(expectedGoods)
      && p.eco.tradeRev === initialProfile.eco.tradeRev + 1,
      'exact durable timber and bonus goods', 15000);
      evidence.yield = { palmId: liveNode.id, finalNodeRevision: expectedRev, qualities,
        logs: expectedLogs, loot: selected.expected, goods: structuredClone(latest.profile.eco.pack.goods) };
    }
  }

  const final = commands.at(-1), beforeReplay = structuredClone(latest.profile);
  const replayWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'resource' && m.ev.opId === final.command.opId,
    'exact final gather replay', 12000, true);
  send(final.command); const replayAck = (await replayWait).ev;
  ensure(replayAck.ok === true && (replayAck.historical === true || replayAck.replay === true),
    'exact final gather retry was not recognized as historical');
  const originalAck = structuredClone(final.ack), replayComparable = structuredClone(replayAck);
  for (const field of ['to', 'durable', 'historical', 'replay']) delete replayComparable[field];
  delete originalAck.to; delete originalAck.durable;
  ensure(stable(replayComparable) === stable(originalAck), 'historical replay changed the final gather acknowledgement');
  // Survival clocks advance during the network round-trip; replay must preserve the economic result.
  await awaitProfile(p => stable(p.eco.pack.goods) === stable(beforeReplay.eco.pack.goods)
    && p.eco.tradeRev === beforeReplay.eco.tradeRev, 'replay left goods and trade revision unchanged', 10000);
  evidence.replay = { historical: true, sameAcknowledgement: true, unchangedGoods: true,
    tradeRevision: beforeReplay.eco.tradeRev };

  const stored = await store.loadProfile(accountId);
  ensure(stored?.version > profileVersion && stored.data?.pirateId === `account:${accountId}`
    && stable(stored.data.eco.pack.goods) === stable(beforeReplay.eco.pack.goods),
  'durable profile readback differs after harvest');
  profileVersion = stored.version;
  check('timed_three_hit_palm_loot_and_exact_receipts', { palmId: selected.node.id,
    finalNodeRevision: expectedRev, loot: selected.expected, receiptCount: commands.length, replayHistorical: true });

  await closeSocket();
  await connect();
  ensure(stable(latest.profile.eco.pack.goods) === stable(beforeReplay.eco.pack.goods),
    'palm loot did not persist through authenticated rejoin');
  check('rejoin_preserves_exact_palm_yield', { goods: structuredClone(latest.profile.eco.pack.goods) });
}

async function closeSocket(enforceWorkBudget = true) {
  const closing = socket;
  if (!closing || closing.readyState === WebSocket.CLOSED) { socket = null; return; }
  const closed = new Promise(resolve => {
    const timer = setTimeout(() => closing.terminate(), 4000);
    closing.once('close', () => { clearTimeout(timer); resolve(); });
  });
  if (closing.readyState < WebSocket.CLOSING) closing.close(1000, 'torch loot QA phase boundary');
  await closed; socket = null;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (enforceWorkBudget) alive();
    const response = await fetch(url('/status'), { cache: 'no-store', signal: timeout(10000) });
    ensure(response.ok, 'public drain status unavailable');
    const status = await response.json(), state = status.storage;
    if (status.players === 0 && status.sockets === 0 && state?.profileWrites === 0 && state?.unsaved === 0
      && state?.worldWriting === false && state?.economic?.pending === 0) return;
    await sleep(250);
  }
  throw new Error('public profile writes did not drain');
}

async function cleanupAccount() {
  const auth = unwrap(await admin.auth.admin.getUserById(accountId));
  ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === authMarker,
    'cleanup stopped: disposable Auth identity marker mismatch');
  const row = await store.loadProfile(accountId);
  if (row) ensure(row.data?.pirateId === `account:${accountId}` && row.data?.tools?.axe === 1
    && row.data?.carry?.backpack === 2 && row.data?.lvl === 10,
  'cleanup stopped: QA profile ownership and seed sentinels mismatch');

  const retained = [];
  for (const [id, item] of receiptOps) {
    let receipt;
    try { receipt = await store.loadEconomicOperation(id); }
    catch {
      return { deferred: true, reason: 'economic receipt enumeration failed', accountId, authMarker, receipts: retained };
    }
    if (!receipt) {
      if (item.receiptExpected) return { deferred: true, reason: 'acknowledged economic receipt is missing',
        accountId, authMarker, missingReceiptOpId: item.opId, retainedReceiptCount: retained.length, receipts: retained };
      continue;
    }
    ensure(receipt.request?.world === worldId && receipt.request.account === accountId
      && stable(receipt.request.command) === stable(economicCommand(item.command)),
    'cleanup stopped: operation receipt identity mismatch');
    retained.push({ operationId: id, opId: item.opId, acknowledged: item.acknowledged,
      result: receipt.result?.ack?.ok === true ? 'accepted' : 'denied' });
  }

  let world;
  try { world = await store.loadWorld(worldId); }
  catch { return { deferred: true, reason: 'durable resource ledger read failed', accountId, authMarker,
    retainedReceiptCount: retained.length, receipts: retained }; }
  const resources = world?.data?.resources;
  if (!Array.isArray(resources?.nodes) || !resources.logging || typeof resources.logging !== 'object') {
    return { deferred: true, reason: 'durable resource ledger unavailable for cleanup safety check',
      accountId, authMarker, retainedReceiptCount: retained.length, receipts: retained };
  }
  const unfinished = resources.nodes.filter(node => node.kind === 'palm' && node.hits < HARVEST.palmHits
    && Array.isArray(resources.logging[node.id]?.contributors)
    && resources.logging[node.id].contributors.some(entry => entry.actor === accountId)).map(node => node.id);
  if (unfinished.length) return { deferred: true, reason: 'QA account contributes to unfinished shared palm cycles',
    accountId, authMarker, unfinishedPalmIds: unfinished, retainedReceiptCount: retained.length, receipts: retained };
  const unresolved = [...receiptOps.values()].filter(item => !item.acknowledged);
  if (unresolved.length) return { deferred: true, reason: 'one or more WSS operation acknowledgements were uncertain',
    accountId, authMarker, unresolvedOpIds: unresolved.map(item => item.opId),
    retainedReceiptCount: retained.length, receipts: retained };
  const completedContributorPalmIds = resources.nodes.filter(node => node.kind === 'palm' && node.hits === HARVEST.palmHits
    && Array.isArray(resources.logging[node.id]?.contributors)
    && resources.logging[node.id].contributors.some(entry => entry.actor === accountId)).map(node => node.id);

  if (row) {
    const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId)
      .eq('version', row.version).select('player_id,version'));
    ensure(deleted?.length === 1 && deleted[0].player_id === accountId && deleted[0].version === row.version,
      'QA exact profile CAS cleanup failed');
  }
  unwrap(await admin.auth.admin.deleteUser(accountId));
  ensure(await store.loadProfile(accountId) === null, 'QA profile remains after cleanup');
  return { deferred: false, temporaryAuthAndProfileRemoved: true, retainedReceiptCount: retained.length,
    completedContributorPalmIds, receiptPolicy: 'economic receipts intentionally retained', receipts: retained };
}

try {
  ensure(Date.now() - startedAt < MAX_RUNTIME_MS, 'public canary runtime bound invalid');
  await publicPreflight();
  await createAccount();
  await connect();
  await harvestOnePalm();
  evidence.pass = true;
} catch (error) {
  evidence.pass = false;
  evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; details suppressed';
  process.exitCode = 1;
} finally {
  try {
    await closeSocket(false);
    if (accountId) {
      evidence.cleanup = await cleanupAccount();
      if (evidence.cleanup.deferred) { evidence.pass = false; process.exitCode = 1; }
    }
  } catch (error) {
    evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1;
  }
  evidence.completedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - startedAt;
  try {
    await fs.promises.mkdir(out, { recursive: true });
    const file = path.join(out, `public-${tag}.json`);
    await fs.promises.writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
  } catch { process.exitCode = 1; }
  await pub.auth.signOut().catch(() => {});
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, gameVersion: evidence.gameVersion,
    protocolVersion: evidence.protocol, cleanup: evidence.cleanup || null,
    failure: evidence.failure || evidence.cleanupFailure || null }));
}

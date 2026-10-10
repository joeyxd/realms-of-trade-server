// Bounded public-TLS acceptance for the opt-in M5 economic authority. Never prints account data.
import fs from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { economicCommand, economicOperationId } from '../server/economicAuthority.mjs';
import { storeFromEnv } from '../server/store.mjs';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { raftGangplank } from '../src/sim/raftGeometry.js';

try { if (fs.existsSync('.env')) process.loadEnvFile('.env'); }
catch { console.log(JSON.stringify({ pass: false, reason: 'environment unavailable' })); process.exit(1); }

const phase = process.argv[2];
const fixturePath = '.scratch/m5-economic-live-fixture.json';
const evidencePath = 'docs/delivery/m5-economic-authority/live-acceptance.json';
const worldId = process.env.WORLD_ID || 'marea-negra';
const timeoutMs = 25000;
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
};

class QaFailure extends Error { constructor(label) { super(label); this.label = label; } }
const ensure = (condition, label) => { if (!condition) throw new QaFailure(label); };
const unwrap = result => { if (result.error) throw new QaFailure('provider operation failed'); return result.data; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profileFingerprint = value => {
  const normalized = sanitizeProfile(value);
  ensure(normalized, 'profile could not be normalized for comparison');
  return createHash('sha256').update(stable(normalized)).digest('hex');
};
const stable = value => JSON.stringify(sort(value));
const shipRevisionFingerprint = value => stable((value?.eco?.ships || []).map(ship => [ship.id, ship.rev]).sort(([a], [b]) => a.localeCompare(b)));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
}

if (!['before', 'after', 'cleanup'].includes(phase)) {
  console.log(JSON.stringify({ phase: phase || null, pass: false, reason: 'usage: before | after | cleanup' })); process.exit(1);
}
let base;
try { base = new URL(process.env.MN_M5_TARGET || 'https://marea.62.171.136.148.sslip.io'); }
catch { console.log(JSON.stringify({ phase, pass: false, reason: 'public TLS target required' })); process.exit(1); }
if (base.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
  console.log(JSON.stringify({ phase, pass: false, reason: 'public TLS target required' })); process.exit(1);
}
base.pathname = base.pathname.replace(/\/$/, '');
base.search = ''; base.hash = '';
const wsUrl = new URL(`${base.pathname}/ws`, base);
wsUrl.protocol = 'wss:';
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_PUBLIC_KEY) {
  console.log(JSON.stringify({ phase, pass: false, reason: 'provider configuration unavailable' })); process.exit(1);
}
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
let store;
try { store = storeFromEnv(); }
catch { console.log(JSON.stringify({ phase, pass: false, reason: 'durable store configuration unavailable' })); process.exit(1); }

let fixture = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
let ws = null, profile = null, entity = null, tick = 0, sentTick = 0, seq = 0;
let position = null, resources = null, map = null, rafts = [];
let messages = [];
const evidence = fs.existsSync(evidencePath)
  ? JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  : { schema: 'mn.m5-economic-live.v1', target: 'public-tls', phases: [] };

function saveFixture() {
  fs.mkdirSync('.scratch', { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(fixturePath, 0o600);
}

function record(check, data = {}) {
  const item = { check, pass: true, at: new Date().toISOString(), ...data };
  let existing = evidence.phases.find(row => row.phase === phase);
  if (!existing) { existing = { phase, checks: [] }; evidence.phases.push(existing); }
  existing.checks.push(item);
  fs.mkdirSync('docs/delivery/m5-economic-authority', { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(item));
}

async function statusGate() {
  ensure(base.hostname && wsUrl.hostname === base.hostname, 'target configuration invalid');
  const response = await fetch(new URL(`${base.pathname}/status`, base), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  ensure(response.ok, 'public status unavailable');
  const status = await response.json();
  const storage = status?.storage;
  ensure(storage?.durable === true && storage?.accounts === true && storage?.economic?.enabled === true
    && storage?.economic?.failed === false && storage?.economic?.pending === 0
    && storage?.world?.id === worldId && storage?.world?.ready === true && storage?.world?.failed === false
    && storage?.unsaved === 0 && storage?.errors === 0,
  'M5 durable economic authority is not enabled and healthy');
  return { uptime: status.uptime, worldVersion: storage.world.version, profileWrites: storage.profileWrites || 0 };
}

async function waitFor(predicate, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    if (messages.some(message => message.t === 'error' || message.t === 'full')) throw new QaFailure('public admission rejected');
    await sleep(40);
  }
  throw new QaFailure('bounded response wait expired');
}

function send(message) {
  ensure(ws?.readyState === WebSocket.OPEN, 'websocket is not open');
  ws.send(JSON.stringify(message));
}

function inputs(mx, mz) {
  sentTick = Math.max(sentTick, tick);
  const cmds = Array.from({ length: 6 }, () => ({ seq: ++seq, mx, mz, ax: 0, az: 0,
    btn: 0, prs: 0, pt: ++sentTick, w: 0 }));
  send({ t: 'inputs', cmds });
}

async function enter(token) {
  messages = []; profile = null; entity = null; position = null; resources = null; map = null; rafts = []; tick = 0; sentTick = 0;
  ws = new WebSocket(wsUrl, { origin: base.origin, handshakeTimeout: 10000 });
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    messages.push(message);
    if (messages.length > 5000) messages.splice(0, messages.length - 3000);
    if (Number.isSafeInteger(message.tick)) tick = Math.max(tick, message.tick);
    if (message.t === 'welcome') {
      entity = message.you;
      if (Number.isSafeInteger(message.seed)) map = generateWorld(message.seed);
    }
    if (message.t === 'profile') profile = message.p;
    if (message.t === 'snap') {
      if (message.resources) resources = message.resources;
      if (Array.isArray(message.rafts)) rafts = message.rafts;
    }
    const own = message.ents?.find(row => row[0] === entity);
    if (own) position = { x: own[2], z: own[4] };
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', () => reject(new QaFailure('public websocket unavailable')));
  });
  send({ t: 'hello', v: PROTOCOL_VERSION, name: 'M5 QA', skin: 1, weapon: 0, token });
  await waitFor(message => message.t === 'welcome');
  await waitFor(message => message.t === 'profile');
  await waitFor(message => message.t === 'snap' && message.resources);
  ensure(profile?.pirateId === `account:${fixture.accountId}`, 'authenticated character mismatch');
}

async function leave() {
  if (!ws) return;
  const socket = ws; ws = null;
  if (socket.readyState === WebSocket.OPEN) await new Promise(resolve => {
    const timer = setTimeout(() => { socket.terminate(); resolve(); }, 2500);
    socket.once('close', () => { clearTimeout(timer); resolve(); });
    socket.close();
  });
}

async function walk(target, radius = 1.7, limitMs = 60000) {
  ensure(target && position, 'missing movement target');
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline && Math.hypot(position.x - target.x, position.z - target.z) > radius) {
    const dx = target.x - position.x, dz = target.z - position.z, distance = Math.hypot(dx, dz);
    inputs(dx / distance, dz / distance);
    await sleep(100);
  }
  inputs(0, 0); await sleep(700);
  ensure(position && Math.hypot(position.x - target.x, position.z - target.z) <= radius + 0.5, 'walk to gameplay location failed');
}

async function waitProfileRevision(revision) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (Number.isSafeInteger(profile?.eco?.tradeRev) && profile.eco.tradeRev >= revision) return profile;
    await sleep(50);
  }
  throw new QaFailure('profile revision did not arrive');
}

async function waitForProfile(predicate, label = 'profile update did not arrive', timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (profile && predicate(profile)) return profile;
    await sleep(50);
  }
  throw new QaFailure(label);
}

async function resourceCommand(op, fields) {
  const shipRevisions = shipRevisionFingerprint(profile);
  const command = { t: 'cmd', type: 'resource', op, opId: `m5qa_${randomUUID()}`, ...fields };
  send(command);
  const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'resource' && message.ev.opId === command.opId);
  ensure(response.ev.ok === true, `normal resource ${op} rejected`);
  await waitProfileRevision(response.ev.rev);
  ensure(shipRevisionFingerprint(profile) === shipRevisions, `normal resource ${op} changed a raft revision`);
  await sleep(900);
  return response.ev;
}

async function communityList() {
  const command = { t: 'cmd', type: 'community', op: 'list', opId: `m5qa_${randomUUID()}` };
  send(command);
  const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'community' && message.ev.opId === command.opId);
  ensure(response.ev.ok === true && response.ev.durable === true && response.ev.project?.id === 'salty-shore-carpentry', 'durable community project unavailable');
  return response.ev.project;
}

async function commerceReply(command) {
  send(command);
  const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'commerce' && message.ev.opId === command.opId);
  return response.ev;
}

async function raftReply(command) {
  send(command);
  const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'raftEdit'
    && message.ev.opId === command.opId);
  return response.ev;
}

async function quote(town, good, n, side) {
  const command = { t: 'cmd', type: 'commerce', op: 'quote', town, g: good, n, side, opId: `m5qa_${randomUUID()}` };
  const ack = await commerceReply(command);
  ensure(ack.ok === true && Number.isSafeInteger(ack.total), 'market quote unavailable');
  return ack.total;
}

async function waitAtRest(ms = 3500) {
  inputs(0, 0);
  await sleep(ms);
}

async function gatherLogs(count) {
  for (let index = 0; index < count; index++) {
    let candidates = resources?.nodes?.filter(node => node.kind === 'wood' && node.ready)
      .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
    ensure(candidates?.length, 'no ready wood resource in public world');
    const node = candidates[0];
    await walk(node, 1.8);
    const before = profile.eco.pack.goods.tronco || 0;
    await resourceCommand('gather', { node: node.id, expectedRev: node.rev });
    ensure((profile.eco.pack.goods.tronco || 0) === before + 1, 'gather did not add exactly one log to the profile');
  }
}

async function sellOneMadera(town) {
  const expectedTotal = await quote(town, 'madera', 1, 'sell');
  const command = { t: 'cmd', type: 'commerce', op: 'sell', town, g: 'madera', n: 1,
    expectedTotal, opId: `m5qa_${randomUUID()}` };
  fixture.commands.sells.push(command);
  fixture.operationIds.sells.push(economicOperationId(worldId, fixture.accountId, command.opId));
  saveFixture();
  const before = profile;
  const beforeShipRevisions = shipRevisionFingerprint(before);
  const ack = await commerceReply(command);
  ensure(ack.ok === true && ack.n === 1 && ack.total === expectedTotal, 'quoted one-madera sale rejected');
  await waitProfileRevision(ack.rev);
  ensure((profile.eco.pack.goods.madera || 0) === (before.eco.pack.goods.madera || 0) - 1
    && profile.gold === before.gold + ack.total && shipRevisionFingerprint(profile) === beforeShipRevisions,
  'madera sale did not conserve exact pack, gold, and raft revision');
  return { command, ack };
}

async function secureGoldForFruitAndRaft(town) {
  ensure((profile.eco.pack.goods.madera || 0) >= 2, 'need one madera reserved for the raft deposit and one for sale');
  let frutaTotal = await quote(town, 'fruta', 1, 'buy');
  let maderaTotal = await quote(town, 'madera', 1, 'buy');
  let sales = 0;
  while (profile.gold < frutaTotal + maderaTotal && sales < 5
      && (profile.eco.pack.goods.madera || 0) > 1) {
    await sellOneMadera(town);
    sales++;
    frutaTotal = await quote(town, 'fruta', 1, 'buy');
    maderaTotal = await quote(town, 'madera', 1, 'buy');
  }
  ensure(profile.gold >= frutaTotal + maderaTotal, 'madera proceeds cannot fund fruit, raft supply, and one reserved deposit');
  return { frutaTotal, maderaTotal, sales };
}

function ownPublicRaft() {
  const ship = profile?.eco?.ships?.find(row => row.kind === 'raft' && row.at === 'aldea' && row.hp > 0);
  const visible = ship && rafts.find(row => row.id === ship.id && row.owner === entity);
  ensure(ship && visible && visible.parts?.length, 'owned moored raft is not present in public snapshots');
  const plank = raftGangplank({ ...visible, pilot: null, parts: visible.parts }, map?.dock);
  ensure(plank, 'owned raft has no normal dock gangplank approach');
  return { ship, visible, plank };
}

async function goToRaft() {
  const raft = ownPublicRaft();
  await walk(raft.plank, 1.0);
  await waitAtRest();
  ensure(position && Math.hypot(position.x - raft.plank.x, position.z - raft.plank.z) <= 1.5,
    'player did not reach the public gangplank approach');
  return ownPublicRaft();
}

async function raftSupplyQuote(id, expectedRev) {
  const opId = `m5qa_${randomUUID()}`;
  send({ t: 'cmd', type: 'raft', op: 'quote', id, expectedRev, opId });
  const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'raftEdit'
    && message.ev.op === 'quote' && message.ev.id === id && message.ev.opId === opId);
  const madera = response.ev.supplies?.find(row => row.g === 'madera');
  ensure(response.ev.ok === true && response.ev.rev === expectedRev && madera?.n === 1
    && Number.isSafeInteger(madera.price) && madera.price > 0 && madera.stock > 0,
  'normal gangplank raft supply quote is unavailable');
  return madera;
}

function amount(goods, good = 'madera') { return goods?.[good] || 0; }

async function transferMadera(id, side, expectedRev) {
  const command = { t: 'cmd', type: 'commerce', op: 'transfer', id, expectedRev,
    g: 'madera', n: 1, side, opId: `m5qa_${randomUUID()}` };
  const operationId = economicOperationId(worldId, fixture.accountId, command.opId);
  fixture.commands[side] = command;
  fixture.operationIds[side] = operationId;
  saveFixture();
  const before = profile;
  const beforePack = amount(before.eco.pack.goods);
  const beforeHold = amount(before.eco.ships.find(ship => ship.id === id)?.hold?.goods);
  const ack = await commerceReply(command);
  ensure(ack.ok === true && ack.op === 'transfer' && ack.id === id && ack.raftRev === expectedRev + 1
    && amount(ack.pack?.goods) === beforePack + (side === 'withdraw' ? 1 : -1)
    && amount(ack.hold?.goods) === beforeHold + (side === 'deposit' ? 1 : -1),
  `raft ${side} did not report exact one-madera transfer`);
  await waitProfileRevision(ack.rev);
  const afterShip = profile.eco.ships.find(ship => ship.id === id);
  ensure(amount(profile.eco.pack.goods) === beforePack + (side === 'withdraw' ? 1 : -1)
    && amount(afterShip?.hold?.goods) === beforeHold + (side === 'deposit' ? 1 : -1)
    && afterShip.rev === expectedRev + 1 && profile.gold === before.gold,
  `raft ${side} did not conserve profile, hold, gold, and revision`);
  await verifyReceipt(command, operationId, 'commerce');
  return ack;
}

async function supplyOneMadera(id, expectedRev) {
  const quoteRow = await raftSupplyQuote(id, expectedRev);
  const command = { t: 'cmd', type: 'raft', op: 'supply', id, expectedRev, g: 'madera', n: 1,
    opId: `m5qa_${randomUUID()}` };
  const operationId = economicOperationId(worldId, fixture.accountId, command.opId);
  fixture.commands.supply = command;
  fixture.operationIds.supply = operationId;
  saveFixture();
  const worldBefore = await store.loadWorld(worldId);
  const stockBefore = worldBefore?.data?.economy?.markets?.aldea?.stock?.madera;
  ensure(Number.isSafeInteger(stockBefore) && stockBefore > 0, 'durable raft supply stock unavailable');
  const before = profile;
  const beforePack = amount(before.eco.pack.goods);
  const beforeHold = amount(before.eco.ships.find(ship => ship.id === id)?.hold?.goods);
  const ack = await raftReply(command);
  ensure(ack.ok === true && ack.op === 'supply' && ack.id === id && ack.rev === expectedRev + 1
    && ack.g === 'madera' && ack.n === 1 && ack.total === quoteRow.price && ack.gold === before.gold - ack.total,
  'one-unit raft supply did not return the quoted raftEdit revision and exact gold delta');
  await waitForProfile(next => next.eco?.ships?.find(ship => ship.id === id)?.rev === expectedRev + 1
    && next.gold === before.gold - ack.total, 'raft supply profile persistence did not arrive');
  const afterShip = profile.eco.ships.find(ship => ship.id === id);
  const afterOwned = amount(profile.eco.pack.goods) + amount(afterShip?.hold?.goods);
  ensure(profile.gold === before.gold - ack.total && afterOwned === beforePack + beforeHold + 1
    && afterShip.rev === ack.rev, 'raft supply did not conserve one material and exact profile revision');
  const worldAfter = await store.loadWorld(worldId);
  ensure(worldAfter?.data?.economy?.markets?.aldea?.stock?.madera === stockBefore - 1,
    'durable market stock did not debit exactly one supplied madera');
  fixture.marketMaderaAfterSupply = stockBefore - 1;
  saveFixture();
  await verifyReceipt(command, operationId, 'raftEdit');
  return ack;
}

async function verifyReceipt(command, operationId, expectedType) {
  const receipt = await store.loadEconomicOperation(operationId);
  ensure(receipt?.request?.world === worldId && receipt.request.account === fixture.accountId
    && stable(receipt.request.command) === stable(economicCommand(command)) && receipt.result?.ack?.type === expectedType
    && receipt.result.ack.ok === true, 'durable operation receipt mismatch');
  return receipt;
}

try {
  const health = phase === 'cleanup' ? null : await statusGate();
  if (phase === 'before') {
    ensure(fixture === null, 'fixture already exists; use its after or cleanup phase');
    const email = `mn-m5-qa-${randomUUID()}@example.com`;
    const password = `Aa1!${randomBytes(24).toString('base64url')}`;
    const signup = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
    ensure(signup.user?.id && signup.properties?.hashed_token, 'disposable account creation failed');
    fixture = { schema: 'mn.m5-economic-private.v1', worldId, accountId: signup.user.id, email, password,
      commands: {}, operationIds: {}, hostUptimeBefore: health.uptime, createdAt: new Date().toISOString() };
    saveFixture();
    unwrap(await pub.auth.verifyOtp({ token_hash: signup.properties.hashed_token, type: 'signup' }));
    record('disposable account confirmed without email delivery');
  }

  ensure(fixture?.schema === 'mn.m5-economic-private.v1' && fixture.worldId === worldId
    && /^mn-m5-qa-[0-9a-f-]+@example\.com$/.test(fixture.email)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fixture.accountId), 'private fixture is invalid');

  if (phase === 'cleanup') {
    const own = unwrap(await admin.auth.admin.getUserById(fixture.accountId));
    ensure(own.user?.email === fixture.email, 'fixture Auth identity mismatch');
    const profileRow = await store.loadProfile(fixture.accountId);
    if (profileRow) ensure(profileRow.data?.pirateId === `account:${fixture.accountId}`, 'profile is not the disposable fixture');
    unwrap(await admin.from('mn_profiles').delete().eq('player_id', fixture.accountId));
    unwrap(await admin.auth.admin.deleteUser(fixture.accountId));
    fs.unlinkSync(fixturePath);
    record('only disposable profile and Auth account removed; world contribution and receipts retained');
  } else {
    const login = unwrap(await pub.auth.signInWithPassword({ email: fixture.email, password: fixture.password }));
    ensure(login.user?.id === fixture.accountId && login.session?.access_token, 'public password login failed');
    const denied = await pub.rpc('mn_load_profile', { p_player_id: fixture.accountId });
    ensure(denied.error?.code === '42501', 'authenticated direct profile RPC was not denied');
    record('public Auth login and authenticated direct RPC denial verified', { phase });
    await enter(login.session.access_token);
    record('real account token admitted through public TLS WebSocket', { phase, protocol: PROTOCOL_VERSION });

    if (phase === 'before') {
      ensure(map?.landmarks?.village && resources?.bench, 'public welcome map or workbench unavailable');
      const bench = resources.bench;
      await walk(bench);
      const goldBeforeCraft = profile.gold;
      await gatherLogs(7);
      await walk(bench);
      const packBeforeCraft = { ...profile.eco.pack.goods };
      const craft = await resourceCommand('craft', { recipe: 'madera', n: 7, expectedRev: profile.eco.tradeRev });
      ensure((profile.eco.pack.goods.madera || 0) === (packBeforeCraft.madera || 0) + 7
        && (profile.eco.pack.goods.tronco || 0) === (packBeforeCraft.tronco || 0) - 7
        && profile.gold === goldBeforeCraft, 'normal bench craft did not conserve exactly seven madera');
      record('wood gathered and seven madera crafted through ordinary gameplay commands', { profileRevision: craft.rev });

      const projectBefore = await communityList();
      ensure(projectBefore.contributed.madera < projectBefore.requirements.madera, 'community madera requirement already complete');
      const contribute = { t: 'cmd', type: 'community', op: 'contribute', opId: `m5qa_${randomUUID()}`,
        projectId: projectBefore.id, good: 'madera', amount: 1, expectedRev: projectBefore.version };
      const woodBeforeContribution = profile.eco.pack.goods.madera || 0;
      const shipRevisionsBeforeContribution = shipRevisionFingerprint(profile);
      fixture.commands.contribute = contribute;
      fixture.operationIds.contribute = economicOperationId(worldId, fixture.accountId, contribute.opId);
      fixture.projectBefore = { version: projectBefore.version, contributed: projectBefore.contributed };
      saveFixture();
      send(contribute);
      const contributionMessage = await waitFor(message => message.t === 'event' && message.ev?.type === 'community' && message.ev.opId === contribute.opId);
      const contribution = contributionMessage.ev;
      ensure(contribution.ok === true && contribution.accepted === 1 && contribution.good === 'madera'
        && contribution.project?.contributed?.madera === projectBefore.contributed.madera + 1, 'one madera contribution failed');
      await waitProfileRevision(contribution.rev);
      ensure((profile.eco.pack.goods.madera || 0) === woodBeforeContribution - contribution.accepted,
        'contribution did not debit exactly its accepted madera');
      ensure(shipRevisionFingerprint(profile) === shipRevisionsBeforeContribution,
        'community contribution unexpectedly changed a raft revision');
      fixture.projectAfter = { version: contribution.project.version, contributed: contribution.project.contributed };
      record('one madera debited and credited to the shared community project', { projectVersion: contribution.project.version });

      await walk(map.landmarks.village, 8);
      await waitAtRest();
      const sellQuote = await quote('aldea', 'madera', 1, 'sell');
      const sell = { t: 'cmd', type: 'commerce', op: 'sell', town: 'aldea', g: 'madera', n: 1,
        expectedTotal: sellQuote, opId: `m5qa_${randomUUID()}` };
      fixture.commands.sells = []; fixture.operationIds.sells = [];
      fixture.commands.sells.push(sell); fixture.operationIds.sells.push(economicOperationId(worldId, fixture.accountId, sell.opId));
      fixture.commands.sell = sell; fixture.operationIds.sell = fixture.operationIds.sells[0];
      saveFixture();
      const saleBefore = profile;
      const shipRevisionsBeforeSale = shipRevisionFingerprint(saleBefore);
      const firstSellAck = await commerceReply(sell);
      ensure(firstSellAck.ok === true && firstSellAck.n === 1 && firstSellAck.total === sellQuote,
        'initial quoted madera sale rejected');
      await waitProfileRevision(firstSellAck.rev);
      ensure((profile.eco.pack.goods.madera || 0) === (saleBefore.eco.pack.goods.madera || 0) - 1
        && profile.gold === saleBefore.gold + firstSellAck.total
        && shipRevisionFingerprint(profile) === shipRevisionsBeforeSale,
      'initial sale did not conserve exact madera, gold, and raft revision');
      const funding = await secureGoldForFruitAndRaft('aldea');
      const buy = { t: 'cmd', type: 'commerce', op: 'buy', town: 'aldea', g: 'fruta', n: 1,
        expectedTotal: funding.frutaTotal, opId: `m5qa_${randomUUID()}` };
      fixture.commands.buy = buy; fixture.operationIds.buy = economicOperationId(worldId, fixture.accountId, buy.opId);
      saveFixture();
      const buyBefore = profile;
      const shipRevisionsBeforeBuy = shipRevisionFingerprint(buyBefore);
      const buyAck = await commerceReply(buy);
      ensure(buyAck.ok === true && buyAck.n === 1 && buyAck.side === 'buy' && buyAck.total === funding.frutaTotal,
        'quoted one-fruta purchase failed');
      await waitProfileRevision(buyAck.rev);
      ensure((profile.eco.pack.goods.fruta || 0) === (buyBefore.eco.pack.goods.fruta || 0) + 1
        && profile.gold === buyBefore.gold - buyAck.total
        && shipRevisionFingerprint(profile) === shipRevisionsBeforeBuy,
      'fruit purchase did not conserve exact fruit, gold, and raft revision');
      record('quoted one-unit sales funded one fruit and a raft supply while reserving one madera', {
        profileRevision: profile.eco.tradeRev, maderaSales: fixture.commands.sells.length,
      });

      const approach = await goToRaft();
      const raftBefore = await raftSupplyQuote(approach.ship.id, approach.ship.rev);
      ensure(raftBefore.price === funding.maderaTotal, 'raft editor quote differs from the market quote used for funding');
      const deposit = await transferMadera(approach.ship.id, 'deposit', approach.ship.rev);
      const afterDeposit = profile.eco.ships.find(ship => ship.id === approach.ship.id);
      const supplyAck = await supplyOneMadera(approach.ship.id, afterDeposit.rev);
      const afterSupply = profile.eco.ships.find(ship => ship.id === approach.ship.id);
      const withdraw = await transferMadera(approach.ship.id, 'withdraw', afterSupply.rev);
      const afterWithdraw = profile.eco.ships.find(ship => ship.id === approach.ship.id);
      ensure(deposit.raftRev + 1 === supplyAck.rev && supplyAck.rev + 1 === withdraw.raftRev
        && afterWithdraw.rev === withdraw.raftRev && amount(afterWithdraw.hold?.goods) === 1,
      'raft transfer and supply revisions did not advance independently and exactly');
      record('one madera deposited, one quoted madera supplied, then the deposited unit withdrawn at the public gangplank', {
        raftRevision: afterWithdraw.rev, transferRevision: profile.eco.tradeRev,
      });

      for (let index = 0; index < fixture.commands.sells.length; index++)
        await verifyReceipt(fixture.commands.sells[index], fixture.operationIds.sells[index], 'commerce');
      const contributeReceipt = await verifyReceipt(contribute, fixture.operationIds.contribute, 'community');
      const buyReceipt = await verifyReceipt(buy, fixture.operationIds.buy, 'commerce');
      await verifyReceipt(fixture.commands.deposit, fixture.operationIds.deposit, 'commerce');
      await verifyReceipt(fixture.commands.supply, fixture.operationIds.supply, 'raftEdit');
      await verifyReceipt(fixture.commands.withdraw, fixture.operationIds.withdraw, 'commerce');
      ensure(contributeReceipt.result.ack.accepted === 1 && fixture.commands.sells.length === fixture.operationIds.sells.length
        && fixture.commands.sells.every((_, index) => fixture.operationIds.sells[index]) && buyReceipt.result.ack.n === 1,
        'durable gameplay receipts do not match accepted quantities');
      const persisted = await store.loadProfile(fixture.accountId);
      ensure(persisted?.data?.pirateId === `account:${fixture.accountId}`
        && profile.eco.pack.goods.madera === persisted.data.eco.pack.goods.madera
        && profile.eco.pack.goods.fruta === persisted.data.eco.pack.goods.fruta
        && profileFingerprint(profile) === profileFingerprint(persisted.data),
      'authoritative profile row differs from the live profile or ACK-conserved inventory');
      const world = await store.loadWorld(worldId);
      ensure(world?.data?.community?.project?.version === fixture.projectAfter.version
        && world.data.community.project.contributed.madera === fixture.projectAfter.contributed.madera, 'authoritative world row lacks community contribution');
      fixture.profileFingerprint = profileFingerprint(persisted.data);
      fixture.profileVersion = persisted.version;
      fixture.raftAfterBeforeRestart = { id: afterWithdraw.id, rev: afterWithdraw.rev,
        holdMadera: amount(afterWithdraw.hold?.goods), tradeRev: profile.eco.tradeRev };
      fixture.economicReceipts = [fixture.operationIds.contribute, ...fixture.operationIds.sells,
        fixture.operationIds.buy, fixture.operationIds.deposit, fixture.operationIds.supply, fixture.operationIds.withdraw];
      fixture.completedBefore = true;
      saveFixture();
      record('profile, world contribution, and exact economic receipts verified in durable rows', {
        profileVersion: persisted.version, worldVersion: world.version, receipts: fixture.economicReceipts.length,
      });
      await leave();
    } else if (phase === 'after') {
      ensure(fixture.completedBefore === true && fixture.commands.contribute && fixture.commands.sell && fixture.commands.buy
        && Array.isArray(fixture.commands.sells) && fixture.commands.deposit && fixture.commands.supply && fixture.commands.withdraw,
        'before phase has not completed');
      ensure(Number.isFinite(fixture.hostUptimeBefore) && Number.isFinite(health.uptime)
        && health.uptime < fixture.hostUptimeBefore, 'host restart was not observed between phases');
      record('public host restart observed between acceptance phases', { uptimeBefore: fixture.hostUptimeBefore, uptimeAfter: health.uptime });
      ensure(profileFingerprint(profile) === fixture.profileFingerprint, 'profile fingerprint changed after host restart');
      const persisted = await store.loadProfile(fixture.accountId);
      ensure(persisted?.version === fixture.profileVersion && profileFingerprint(persisted.data) === fixture.profileFingerprint,
        'durable profile did not restore after host restart');
      const worldBefore = await store.loadWorld(worldId);
      ensure(worldBefore?.data?.community?.project?.version === fixture.projectAfter.version
        && worldBefore.data.community.project.contributed.madera === fixture.projectAfter.contributed.madera
        && worldBefore.data.economy.markets.aldea.stock.madera === fixture.marketMaderaAfterSupply,
      'community progress or raft supply stock did not restore after host restart');
      ensure(profile.eco.ships.find(ship => ship.id === fixture.raftAfterBeforeRestart.id)?.rev === fixture.raftAfterBeforeRestart.rev
        && amount(profile.eco.ships.find(ship => ship.id === fixture.raftAfterBeforeRestart.id)?.hold?.goods) === fixture.raftAfterBeforeRestart.holdMadera,
      'raft cargo or ship revision did not restore after host restart');
      record('crafted inventory and community project restored after real host restart', {
        profileVersion: persisted.version, projectVersion: fixture.projectAfter.version,
      });

      await walk(resources.bench);
      const currentProject = await communityList();
      ensure(currentProject.version === fixture.projectAfter.version
        && currentProject.contributed.madera === fixture.projectAfter.contributed.madera, 'live project list does not match persisted progress');
      const beforeReplayFingerprint = profileFingerprint(profile);
      const replayCommands = [fixture.commands.contribute, ...fixture.commands.sells, fixture.commands.buy,
        fixture.commands.deposit, fixture.commands.supply, fixture.commands.withdraw];
      const observed = [];
      for (const command of replayCommands) {
        if (command.type === 'community') await walk(resources.bench);
        else if (command.op === 'transfer' || command.type === 'raft') await goToRaft();
        else { await walk(map.landmarks.village, 8); await waitAtRest(); }
        const ack = await replayEconomicCommand(command);
        ensure(ack.ok === true && (ack.historical === true || ack.replay === true), 'exact retry did not return a historical receipt');
        if (command.type === 'community') ensure(ack.currentProject?.version === fixture.projectAfter.version
          && ack.currentProject.contributed.madera === fixture.projectAfter.contributed.madera,
        'community replay returned stale project as current');
        observed.push(ack.type);
      }
      ensure(profileFingerprint(profile) === beforeReplayFingerprint && profileFingerprint(profile) === fixture.profileFingerprint,
        'exact retries changed the current client profile');
      const persistedAfterReplay = await store.loadProfile(fixture.accountId);
      const worldAfterReplay = await store.loadWorld(worldId);
      ensure(profileFingerprint(persistedAfterReplay.data) === fixture.profileFingerprint
        && worldAfterReplay.data.community.project.version === fixture.projectAfter.version
        && worldAfterReplay.data.community.project.contributed.madera === fixture.projectAfter.contributed.madera
        && worldAfterReplay.data.economy.markets.aldea.stock.madera === fixture.marketMaderaAfterSupply
        && profile.eco.ships.find(ship => ship.id === fixture.raftAfterBeforeRestart.id)?.rev === fixture.raftAfterBeforeRestart.rev,
      'exact retries changed current durable profile, raft, market, or project rows');
      for (const command of replayCommands) await verifyReceipt(command,
        economicOperationId(worldId, fixture.accountId, command.opId), command.type === 'community' ? 'community'
          : command.type === 'raft' ? 'raftEdit' : 'commerce');
      record('exact post-restart retries replay receipts without another debit or historical rollback', {
        replayed: observed.length, profileVersion: persistedAfterReplay.version, projectVersion: fixture.projectAfter.version,
      });
      await leave();
    }
  }
} catch (error) {
  console.log(JSON.stringify({ phase, pass: false, reason: error instanceof QaFailure ? error.label : 'acceptance failed; provider details suppressed' }));
  process.exitCode = 1;
} finally {
  await leave();
}

async function replayEconomicCommand(command) {
  send(command);
  const type = command.type === 'raft' ? 'raftEdit' : command.type;
  const response = await waitFor(message => message.t === 'event' && message.ev?.type === type
    && message.ev.opId === command.opId);
  return response.ev;
}

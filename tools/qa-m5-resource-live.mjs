// Bounded public-TLS acceptance for durable M5 gathering, crafting, and resource receipts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { canStand } from '../src/sim/systems/movement.js';
import { tuning } from '../src/data/tuning.js';
import { CRAFT_RECIPES, HARVEST, RESOURCE_KINDS } from '../src/data/resources.js';
import { economicCommand, economicOperationId } from '../server/economicAuthority.mjs';
import { storeFromEnv } from '../server/store.mjs';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { roomFor } from '../src/sim/economy/cargo.js';

const usage = 'usage: node tools/qa-m5-resource-live.mjs before|after|cleanup [--env-file PATH]';
const phaseArg = process.argv[2];
if (phaseArg === '--help' || phaseArg === '-h') {
  console.log(usage);
  process.exit(0);
}

class QaFailure extends Error { constructor(label) { super(label); this.label = label; } }
const ensure = (condition, label) => { if (!condition) throw new QaFailure(label); };
const stable = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
}
const unwrap = result => {
  if (!result || result.error) throw new QaFailure('provider operation failed');
  return result.data;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profileFingerprint = value => {
  const normalized = sanitizeProfile(value);
  ensure(normalized, 'profile could not be normalized');
  return createHash('sha256').update(stable(normalized)).digest('hex');
};
const profileResourceProjection = profile => ({
  pack: profile?.eco?.pack,
  tools: profile?.tools,
  tradeRev: profile?.eco?.tradeRev,
});
const resourceProjection = state => ({ nodes: state.nodes, cooldowns: state.cooldowns });

async function main() {
  const phase = phaseArg;
  if (!['before', 'after', 'cleanup'].includes(phase)) throw new QaFailure(usage);
  let envFile = null;
  for (let index = 3; index < process.argv.length; index++) {
    if (process.argv[index] !== '--env-file' || !process.argv[index + 1] || envFile) throw new QaFailure(usage);
    envFile = process.argv[++index];
  }
  if (envFile) {
    try { process.loadEnvFile(path.resolve(envFile)); }
    catch { throw new QaFailure('environment file unavailable'); }
  }

  const fixturePath = path.resolve('.scratch/m5-resource-live-fixture.json');
  const evidencePath = path.resolve('docs/delivery/m5-resource-authority/live-acceptance.json');
  const worldId = process.env.WORLD_ID || 'marea-negra';
  const timeoutMs = 25000;
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
  };

  ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
    'provider configuration unavailable');
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
  const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
  let store;
  try { store = storeFromEnv(); }
  catch { throw new QaFailure('durable store configuration unavailable'); }

  let base;
  try { base = new URL(process.env.MN_M5_TARGET || 'https://marea.62.171.136.148.sslip.io'); }
  catch { throw new QaFailure('public TLS target required'); }
  ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname),
    'public TLS target required');
  const basePath = base.pathname.replace(/\/$/, '');
  base.search = ''; base.hash = '';
  const wsUrl = new URL(`${basePath}/ws`, base); wsUrl.protocol = 'wss:';

  async function verifyPublicAuthConfig() {
    const response = await fetch(new URL(`${basePath}/auth/config`, base), {
      cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
    ensure(response.ok, 'public auth configuration unavailable');
    const auth = await response.json();
    let configuredUrl;
    try { configuredUrl = new URL(process.env.SUPABASE_URL).origin; }
    catch { throw new QaFailure('provider configuration unavailable'); }
    let publicUrl;
    try { publicUrl = new URL(auth?.url).origin; }
    catch { throw new QaFailure('public auth configuration unavailable'); }
    ensure(auth?.enabled === true && publicUrl === configuredUrl,
      'public auth provider differs from configured Supabase project');
  }

  let fixture = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
  let ws = null, profile = null, entity = null, tick = 0, sentTick = 0, seq = 0;
  let position = null, resources = null, map = null, messages = [];
  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
    : { schema: 'mn.m5-resource-live.v1', target: 'public-tls', phases: [] };

  function saveFixture() {
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(fixturePath, 0o600);
  }

  function record(check, data = {}) {
    const item = { check, pass: true, at: new Date().toISOString(), ...data };
    let existing = evidence.phases.find(row => row.phase === phase);
    if (!existing) { existing = { phase, checks: [] }; evidence.phases.push(existing); }
    existing.checks.push(item);
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(item));
  }

  async function statusGate() {
    const response = await fetch(new URL(`${basePath}/status`, base), {
      cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
    ensure(response.ok, 'public status unavailable');
    const status = await response.json(), storage = status?.storage;
    ensure(storage?.durable === true && storage?.accounts === true
      && storage?.economic?.enabled === true && storage.economic.failed === false && storage.economic.pending === 0
      && storage?.resources?.enabled === true && storage.resources.ready === true
      && storage?.world?.id === worldId && storage.world.ready === true && storage.world.failed === false
      && storage.unsaved === 0 && storage.errors === 0,
    'M5 durable resource authority is not enabled and healthy');
    return { uptime: status.uptime, worldVersion: storage.world.version };
  }

  async function waitForPostDisconnectFlush() {
    const deadline = Date.now() + 60000;
    let stableSamples = 0;
    while (Date.now() < deadline) {
      const response = await fetch(new URL(`${basePath}/status`, base), {
        cache: 'no-store', signal: AbortSignal.timeout(12000),
      });
      ensure(response.ok, 'public status unavailable while waiting for profile flush');
      const status = await response.json(), storage = status?.storage;
      ensure(storage?.durable === true && storage?.accounts === true
        && storage?.economic?.enabled === true && storage.economic.failed === false
        && storage?.resources?.enabled === true && storage.resources.ready === true
        && storage?.world?.id === worldId && storage.world.ready === true && storage.world.failed === false
        && storage.unsaved === 0 && storage.errors === 0,
      'durable resource authority became unhealthy during profile flush');
      if (storage.profileWrites === 0 && storage.worldWriting === false && storage.economic.pending === 0) {
        if (++stableSamples >= 2) return { uptime: status.uptime, worldVersion: storage.world.version };
      } else stableSamples = 0;
      await sleep(300);
    }
    throw new QaFailure('bounded profile flush wait expired');
  }

  async function waitFor(predicate, timeout = timeoutMs) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      if (messages.some(message => message.t === 'error' || message.t === 'full'))
        throw new QaFailure('public admission rejected');
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

  const NAV_CELL = 0.8, NAV_EDGE_SAMPLE = 0.3;
  function navEdge(from, to) {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    if (distance < 1e-8) return { x: to.x, z: to.z, y: from.y };
    const samples = Math.max(1, Math.ceil(distance / NAV_EDGE_SAMPLE));
    let prior = { ...from, y: Number.isFinite(from.y) ? from.y : map.groundAt(from.x, from.z) };
    for (let index = 1; index <= samples; index++) {
      const t = index / samples, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      if (!canStand({ map }, x, z, tuning.player.radius, prior.y)) return null;
      const y = map.groundAt(x, z), distanceStep = Math.hypot(x - prior.x, z - prior.z);
      if ((map.onDock(prior.x, prior.z) || map.onDock(x, z))
        ? Math.abs(y - prior.y) >= 0.6 : (y - prior.y) / distanceStep > tuning.world.maxSlope) return null;
      prior = { x, y, z };
    }
    return prior;
  }

  function routeTo(target, radius) {
    ensure(map && position, 'navigation map or player position unavailable');
    const start = { ...position, y: Number.isFinite(position.y) ? position.y : map.groundAt(position.x, position.z) };
    if (Math.hypot(start.x - target.x, start.z - target.z) <= radius) return [];
    const within = (ix, iz) => Math.hypot(ix, iz) < 180;
    const key = (ix, iz) => `${ix},${iz}`;
    const startKey = key(0, 0), open = [{ ix: 0, iz: 0, x: start.x, y: start.y, z: start.z, g: 0,
      f: Math.max(0, Math.hypot(start.x - target.x, start.z - target.z) - radius), key: startKey }];
    const best = new Map([[startKey, 0]]), parent = new Map(), point = new Map([[startKey, start]]);
    const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    let found = null, visited = 0;
    while (open.length && visited < 18000) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift();
      if (current.g !== best.get(current.key)) continue;
      visited++;
      if (Math.hypot(current.x - target.x, current.z - target.z) <= radius) { found = current.key; break; }
      for (const [dx, dz] of directions) {
        const ix = current.ix + dx, iz = current.iz + dz;
        if (!within(ix, iz)) continue;
        const x = start.x + ix * NAV_CELL, z = start.z + iz * NAV_CELL;
        const edge = navEdge(current, { x, z });
        if (!edge) continue;
        const nextKey = key(ix, iz), g = current.g + NAV_CELL * (dx && dz ? Math.SQRT2 : 1);
        if (g >= (best.get(nextKey) ?? Infinity)) continue;
        best.set(nextKey, g); parent.set(nextKey, current.key); point.set(nextKey, edge);
        open.push({ ix, iz, ...edge, g, key: nextKey,
          f: g + Math.max(0, Math.hypot(x - target.x, z - target.z) - radius) });
      }
    }
    ensure(found, 'no safe normal route to resource location');
    const route = [];
    for (let cursor = found; cursor !== startKey; cursor = parent.get(cursor)) route.push(point.get(cursor));
    route.reverse();
    const compressed = [];
    let anchor = start, index = 0;
    while (index < route.length) {
      let farthest = index;
      for (let probe = route.length - 1; probe > index; probe--) {
        if (navEdge(anchor, route[probe])) { farthest = probe; break; }
      }
      compressed.push(route[farthest]); anchor = route[farthest]; index = farthest + 1;
    }
    return compressed;
  }

  async function walk(target, radius = 1.8, limitMs = 60000) {
    ensure(target && position, 'missing movement target');
    const deadline = Date.now() + limitMs;
    let route = routeTo(target, radius), waypoint = 0, replans = 0;
    let progressAt = Date.now(), prior = { ...position };
    while (Date.now() < deadline && Math.hypot(position.x - target.x, position.z - target.z) > radius) {
      while (waypoint < route.length && Math.hypot(position.x - route[waypoint].x, position.z - route[waypoint].z) <= 0.65) waypoint++;
      const goal = route[waypoint] || target, dx = goal.x - position.x, dz = goal.z - position.z, d = Math.hypot(dx, dz);
      inputs(d > 0.1 ? dx / d : 0, d > 0.1 ? dz / d : 0);
      await sleep(120);
      if (Date.now() - progressAt > 1400) {
        if (Math.hypot(position.x - prior.x, position.z - prior.z) < 0.18) {
          ensure(++replans <= 3, 'normal movement stalled after bounded route replans');
          route = routeTo(target, radius); waypoint = 0;
        }
        progressAt = Date.now(); prior = { ...position };
      }
    }
    inputs(0, 0); await sleep(700);
    ensure(Math.hypot(position.x - target.x, position.z - target.z) <= radius + 0.5,
      'walk to gameplay location failed');
  }

  async function waitForProfile(predicate) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (profile && predicate(profile)) return profile;
      await sleep(50);
    }
    throw new QaFailure('profile update did not arrive');
  }

  async function enter(token) {
    messages = []; profile = null; entity = null; position = null; resources = null; map = null; tick = 0; sentTick = 0;
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
      if (message.t === 'snap' && message.resources) resources = message.resources;
      const own = message.ents?.find(row => row[0] === entity);
      if (own) position = { x: own[2], y: own[3], z: own[4] };
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', () => reject(new QaFailure('public websocket unavailable')));
    });
    send({ t: 'hello', v: PROTOCOL_VERSION, name: 'M5 Resource QA', skin: 1, weapon: 0, token });
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

  async function verifyReceipt(command, expectedType = 'resource') {
    const operationId = economicOperationId(worldId, fixture.accountId, command.opId);
    const receipt = await store.loadEconomicOperation(operationId);
    ensure(receipt?.request?.world === worldId && receipt.request.account === fixture.accountId
      && stable(receipt.request.command) === stable(economicCommand(command))
      && receipt.request.ack?.type === expectedType && receipt.request.ack.ok === true
      && receipt.result?.ack?.opId === command.opId && receipt.result.ack.ok === true,
    'durable resource receipt mismatch');
    return receipt;
  }

  async function verifyDurableState(command, ack) {
    if (command.op === 'gather') {
      await waitFor(message => message.t === 'snap' && message.resources?.nodes?.some(node =>
        node.id === command.node && node.rev === ack.rev));
    }
    const persistedProfile = await store.loadProfile(fixture.accountId);
    ensure(persistedProfile?.data?.pirateId === `account:${fixture.accountId}`
      && stable(profileResourceProjection(persistedProfile.data)) === stable(profileResourceProjection(profile)),
    'authenticated resource profile differs from durable SQL row');
    const receipt = await verifyReceipt(command);
    ensure(receipt.result.profileVersion === receipt.request.expectedProfileVersion + 1
      && persistedProfile.version >= receipt.result.profileVersion
      && stable(profileResourceProjection(receipt.request.profile)) === stable(profileResourceProjection(persistedProfile.data))
      && receipt.result.ack.rev === ack.rev && receipt.result.ack.op === command.op
      && receipt.result.ack.durable !== false,
    'resource receipt version, resource profile, or ACK differs from durable SQL state');
    const world = await store.loadWorld(worldId), committedResources = receipt.request.worldData.resources;
    ensure(world?.data?.resources && world.version >= receipt.request.expectedWorldVersion + 1
      && stable(resourceProjection(world.data.resources)) === stable(resourceProjection(committedResources))
      && world.data.resources.tick >= committedResources.tick,
    'durable world resource node, clock, or cooldown snapshot differs from receipt');
    const snapshots = resources?.nodes || [], target = command.op === 'gather'
      ? snapshots.find(node => node.id === command.node) : null;
    if (target) {
      const stored = committedResources.nodes.find(node => node.id === target.id);
      ensure(stored?.rev === ack.rev && target.rev === stored.rev,
        'public resource snapshot revision differs from ACK and durable row');
      if (target.kind === 'palm') ensure(target.hits === stored.hits && target.remaining === RESOURCE_KINDS.palm.hits - stored.hits,
        'public palm hit count differs from durable partial work');
    }
    fixture.lastProfileVersion = persistedProfile.version;
    fixture.lastProfileFingerprint = profileFingerprint(persistedProfile.data);
    fixture.lastWorldVersion = world.version;
    fixture.lastResources = committedResources;
    fixture.lastResourceNode = command.op === 'gather' ? command.node : fixture.lastResourceNode;
    saveFixture();
    return receipt;
  }

  async function resourceOperation(op, fields, { checkResult } = {}) {
    const beforeRev = profile.eco.tradeRev;
    const command = { t: 'cmd', type: 'resource', op, opId: `m5rq_${randomUUID()}`, ...fields };
    fixture.commands.push(command);
    fixture.operationIds.push(economicOperationId(worldId, fixture.accountId, command.opId));
    saveFixture();
    send(command);
    const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'resource'
      && message.ev.opId === command.opId);
    const ack = response.ev;
    ensure(ack.ok === true && ack.durable === true && ack.op === op, `resource ${op} was not durably accepted`);
    const expectedProfileRev = op === 'gather' && ack.count === 0 ? beforeRev : beforeRev + 1;
    await waitForProfile(next => next.eco?.tradeRev === expectedProfileRev);
    if (checkResult) checkResult(ack);
    await verifyDurableState(command, ack);
    await sleep(850);
    return { command, ack };
  }

  function nearestNodes(kind, count, excluded = new Set()) {
    return (resources?.nodes || []).filter(node => node.kind === kind && node.ready && !excluded.has(node.id))
      .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z))
      .slice(0, count);
  }

  async function gather(kind, count) {
    const nodes = nearestNodes(kind, count);
    ensure(nodes.length === count, `not enough ready ${kind} resources in public snapshots`);
    const collected = [];
    for (const node of nodes) {
      await walk(node);
      const good = RESOURCE_KINDS[kind].good, before = profile.eco.pack.goods[good] || 0;
      const result = await resourceOperation('gather', { node: node.id, expectedRev: node.rev }, {
        checkResult: ack => ensure(ack.good === good && ack.count === 1, `gather did not yield one ${good}`),
      });
      ensure((profile.eco.pack.goods[good] || 0) === before + 1, `gather did not add exactly one ${good}`);
      collected.push(result);
    }
    return collected;
  }

  async function craft(recipeId, n = 1) {
    const recipe = CRAFT_RECIPES[recipeId];
    ensure(recipe && Number.isSafeInteger(n) && n >= 1 && n <= recipe.max, 'requested recipe is outside the real recipe contract');
    if (!recipe.hand) await walk(resources.bench);
    else await walk(map.landmarks.spawn);
    const before = structuredClone(profile), recipeRev = before.eco.tradeRev;
    const result = await resourceOperation('craft', { recipe: recipeId, n, expectedRev: recipeRev }, {
      checkResult: ack => ensure(ack.count === n * recipe.count
        && (recipe.tool ? ack.tool === recipe.tool : ack.good === recipe.output), 'craft ACK differs from CRAFT_RECIPES'),
    });
    const after = profile;
    for (const [good, amount] of Object.entries(recipe.inputs)) {
      ensure((after.eco.pack.goods[good] || 0) === (before.eco.pack.goods[good] || 0) - amount * n,
        `craft ${recipeId} did not debit its declared ${good} ingredients`);
    }
    if (recipe.tool) ensure(after.tools[recipe.tool] === recipe.tier,
      `craft ${recipeId} did not grant its declared tool tier`);
    else ensure((after.eco.pack.goods[recipe.output] || 0) === (before.eco.pack.goods[recipe.output] || 0) + recipe.count * n,
      `craft ${recipeId} did not yield its declared output`);
    return result;
  }

  try {
    await verifyPublicAuthConfig();
    const health = phase === 'cleanup' ? null : await statusGate();
    if (phase === 'before') {
      ensure(fixture === null, 'fixture already exists; use after or cleanup');
      const email = `mn-m5-resource-qa-${randomUUID()}@example.com`;
      const password = `Aa1!${randomBytes(24).toString('base64url')}`;
      const signup = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
      ensure(signup.user?.id && signup.properties?.hashed_token, 'disposable account creation failed');
      fixture = { schema: 'mn.m5-resource-private.v1', worldId, accountId: signup.user.id, email, password,
        commands: [], operationIds: [], createdAt: new Date().toISOString() };
      saveFixture();
      unwrap(await pub.auth.verifyOtp({ token_hash: signup.properties.hashed_token, type: 'signup' }));
      record('temporary Auth account created and confirmed without email delivery');
    }

    ensure(fixture?.schema === 'mn.m5-resource-private.v1' && fixture.worldId === worldId
      && /^mn-m5-resource-qa-[0-9a-f-]+@example\.com$/.test(fixture.email)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fixture.accountId),
    'private fixture is invalid');

    if (phase === 'cleanup') {
      const own = unwrap(await admin.auth.admin.getUserById(fixture.accountId));
      ensure(own.user?.email === fixture.email, 'fixture Auth identity mismatch');
      const profileRow = await store.loadProfile(fixture.accountId);
      if (profileRow) ensure(profileRow.data?.pirateId === `account:${fixture.accountId}`, 'profile is not the temporary fixture');
      if (ws) await leave();
      if (profileRow) unwrap(await admin.from('mn_profiles').delete().eq('player_id', fixture.accountId));
      unwrap(await admin.auth.admin.deleteUser(fixture.accountId));
      fs.unlinkSync(fixturePath);
      record('temporary account and its profile removed; world resource history and receipts retained');
      return;
    }

    if (phase === 'after') {
      ensure(fixture.completedBefore === true, 'before phase has not completed');
      ensure(Number.isFinite(fixture.hostUptimeBefore) && Number.isFinite(health.uptime)
        && health.uptime < fixture.hostUptimeBefore, 'public host restart was not observed between phases');
      const restoredBeforeLogin = await store.loadProfile(fixture.accountId);
      ensure(restoredBeforeLogin?.version === fixture.profileVersion
        && profileFingerprint(restoredBeforeLogin.data) === fixture.profileFingerprint
        && stable(profileResourceProjection(restoredBeforeLogin.data)) === stable(fixture.profileResources),
      'complete post-disconnect profile baseline did not restore before account login');
    }
    const login = unwrap(await pub.auth.signInWithPassword({ email: fixture.email, password: fixture.password }));
    ensure(login.user?.id === fixture.accountId && login.session?.access_token, 'temporary account password login failed');
    const denied = await pub.rpc('mn_load_profile', { p_player_id: fixture.accountId });
    ensure(denied.error?.code === '42501', 'authenticated direct profile RPC was not denied');
    await enter(login.session.access_token);
    record('normal account token admitted over public TLS with resource authority ready', { phase, protocol: PROTOCOL_VERSION });

    if (phase === 'before') {
      ensure(map?.landmarks?.spawn && resources?.bench, 'public map spawn or bench is unavailable');
      const axeRecipe = CRAFT_RECIPES.hacha_piedra, woodRecipe = CRAFT_RECIPES.madera;
      ensure(axeRecipe?.tool === 'axe' && woodRecipe?.output === 'madera', 'real axe and wood recipes unavailable');
      const woodCraftCount = (axeRecipe.inputs.madera || 0) + 1;
      const logCount = (woodRecipe.inputs.tronco || 0) * woodCraftCount;
      ensure(roomFor(profile.eco.pack, 'tronco') >= logCount, 'normal backpack cannot hold the recipe inputs');
      await gather('wood', logCount);
      await gather('stone', axeRecipe.inputs.piedra || 0);
      await walk(resources.bench);
      await craft('madera', woodCraftCount);
      await craft('hacha_piedra', 1);
      ensure(profile.tools.axe === axeRecipe.tier
        && (profile.eco.pack.goods.madera || 0) === 1
        && (profile.eco.pack.goods.piedra || 0) === 0,
      'crafted materials and axe do not match the real recipe inputs');

      const palms = nearestNodes('palm', 1);
      ensure(palms.length === 1 && RESOURCE_KINDS.palm.hits > 1, 'ready palm for partial work is unavailable');
      const palm = palms[0]; await walk(palm);
      const beforeGoods = stable(profile.eco.pack.goods), beforeHits = palm.hits || 0;
      const hit = await resourceOperation('gather', { node: palm.id, expectedRev: palm.rev }, {
        checkResult: ack => ensure(ack.remaining === RESOURCE_KINDS.palm.hits - beforeHits - 1
          && ack.count === 0, 'palm hit did not remain partial'),
      });
      const durablePalm = fixture.lastResources.nodes.find(node => node.id === palm.id);
      ensure(durablePalm.hits === beforeHits + 1 && durablePalm.readyAt === 0
        && stable(profile.eco.pack.goods) === beforeGoods,
      'partial palm work changed goods or failed to persist its hit');

      const resourceProfileBeforeLeave = structuredClone(profileResourceProjection(profile));
      const worldBeforeLeave = await store.loadWorld(worldId);
      ensure(resourceProfileBeforeLeave.tools.axe === axeRecipe.tier
        && (resourceProfileBeforeLeave.pack.goods.madera || 0) === 1
        && (resourceProfileBeforeLeave.pack.goods.piedra || 0) === 0
        && worldBeforeLeave?.data?.resources?.nodes?.some(node =>
          node.id === palm.id && node.rev === hit.ack.rev && node.hits === beforeHits + 1),
      'resource profile projection or partial palm node differs before disconnect');
      await leave();
      const flushedHealth = await waitForPostDisconnectFlush();
      const persisted = await store.loadProfile(fixture.accountId), world = await store.loadWorld(worldId);
      ensure(persisted?.data?.pirateId === `account:${fixture.accountId}`
        && stable(profileResourceProjection(persisted.data)) === stable(resourceProfileBeforeLeave)
        && persisted.data.tools.axe === axeRecipe.tier
        && world.data.resources.nodes.some(node => node.id === palm.id
          && node.rev === hit.ack.rev && node.hits === beforeHits + 1),
      'disconnect or profile flush changed resource goods/tools/revision or partial palm work');
      fixture.profileFingerprint = profileFingerprint(persisted.data);
      fixture.profileVersion = persisted.version;
      fixture.profileResources = profileResourceProjection(persisted.data);
      fixture.worldVersion = world.version;
      fixture.worldResources = structuredClone(world.data.resources);
      fixture.hostUptimeBefore = flushedHealth.uptime;
      fixture.completedBefore = true;
      saveFixture();
      record('gathered declared inputs, crafted madera and hacha_piedra, and persisted one partial palm hit', {
        profileVersion: persisted.version, worldVersion: world.version, operations: fixture.commands.length,
        nodes: fixture.lastResources.nodes.length,
      });
      return;
    }

    ensure(stable(profileResourceProjection(profile)) === stable(fixture.profileResources),
      'resource goods, tools, or trade revision changed after host restart');
    const persisted = await store.loadProfile(fixture.accountId), world = await store.loadWorld(worldId);
    ensure(persisted?.version >= fixture.profileVersion
      && stable(profileResourceProjection(persisted.data)) === stable(fixture.profileResources)
      && persisted.data.tools.axe === 1, 'profile and crafted tool did not restore after restart');
    const profileVersionBeforeReplay = persisted.version;
    const expectedNodes = new Map(fixture.worldResources.nodes.map(node => [node.id, node]));
    for (const node of expectedNodes.values()) {
      const actual = world.data.resources.nodes.find(row => row.id === node.id);
      ensure(actual && actual.kind === node.kind && actual.rev === node.rev && actual.hits === node.hits
        && actual.readyAt === node.readyAt, 'resource node did not restore after restart');
    }
    ensure(world.data.resources.tick >= fixture.worldResources.tick
      && stable(world.data.resources.cooldowns) === stable(fixture.worldResources.cooldowns),
    'logical resource clock or account cooldowns did not restore after restart');
    for (let index = 0; index < fixture.commands.length; index++) {
      const command = fixture.commands[index], expectedId = economicOperationId(worldId, fixture.accountId, command.opId);
      ensure(fixture.operationIds[index] === expectedId, 'private operation identity mismatch');
      const receipt = await verifyReceipt(command);
      ensure(stable(receipt.request.command) === stable(economicCommand(command)), 'historical command differs from fixture');
    }
    const beforeReplayProfile = stable(profileResourceProjection(profile));
    const beforeReplayNodes = stable(resourceProjection(world.data.resources));
    const beforeReplayTick = world.data.resources.tick;
    const beforeReplayReceipts = [];
    for (const command of fixture.commands) beforeReplayReceipts.push(stable(await verifyReceipt(command)));
    const replayed = [];
    for (const command of fixture.commands) {
      send(command);
      const response = await waitFor(message => message.t === 'event' && message.ev?.type === 'resource'
        && message.ev.opId === command.opId);
      ensure(response.ev.ok === true && (response.ev.replay === true || response.ev.historical === true),
        'exact post-restart resource retry did not return its historical receipt');
      replayed.push(command.op);
    }
    await sleep(900);
    const afterProfile = await store.loadProfile(fixture.accountId), afterWorld = await store.loadWorld(worldId);
    ensure(stable(profileResourceProjection(profile)) === beforeReplayProfile
      && stable(profileResourceProjection(afterProfile.data)) === beforeReplayProfile
      && afterProfile.version >= fixture.profileVersion && afterProfile.version >= profileVersionBeforeReplay,
    'resource retries duplicated or rolled back profile goods/tools');
    ensure(stable(resourceProjection(afterWorld.data.resources)) === beforeReplayNodes
      && afterWorld.data.resources.tick >= beforeReplayTick && afterWorld.version >= world.version,
    'resource retries changed nodes or cooldowns, or regressed the durable world clock/version');
    ensure(fixture.commands.length === fixture.operationIds.length, 'receipt identity inventory is incomplete');
    for (let index = 0; index < fixture.commands.length; index++) {
      const receipt = await verifyReceipt(fixture.commands[index]);
      ensure(stable(receipt) === beforeReplayReceipts[index], 'resource replay changed its durable receipt');
    }
    record('restart restored profile, tools, nodes, and cooldowns; exact retries did not duplicate effects', {
      profileVersion: afterProfile.version, worldVersion: afterWorld.version, replayed: replayed.length,
    });
    await leave();
  } catch (error) {
    const failure = { phase, pass: false,
      reason: error instanceof QaFailure ? error.label : 'acceptance failed; provider details suppressed',
      at: new Date().toISOString() };
    evidence.attemptFailures ??= [];
    evidence.attemptFailures.push(failure);
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(failure));
    process.exitCode = 1;
  } finally {
    await leave();
  }
}

main().catch(error => {
  const phase = phaseArg || null;
  const failure = { phase, pass: false,
    reason: error instanceof QaFailure ? error.label : 'acceptance failed; provider details suppressed',
    at: new Date().toISOString() };
  console.log(JSON.stringify(failure));
  process.exitCode = 1;
});

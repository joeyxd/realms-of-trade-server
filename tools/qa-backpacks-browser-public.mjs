#!/usr/bin/env node
// Bounded public browser acceptance for the two existing workshop backpack upgrades.
// All purchases use the visible UI. Direct WSS sends are limited to exact replay and denial proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { newWorkshop } from '../src/sim/systems/workshop.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const usage = 'node tools/qa-backpacks-browser-public.mjs --env-file PATH --out NEW_DIRECTORY';
const ensure = (value, message) => { if (!value) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = ms => AbortSignal.timeout(ms);
const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) } };

let envFile = null, outArg = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (arg === '--out' && process.argv[i + 1] && !outArg) outArg = process.argv[++i];
  else if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
  else throw new Error(usage);
}
ensure(envFile && outArg, usage);
try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('private QA environment file unavailable'); }
ensure(process.env.MN_QA_ALLOW_BROWSER === '1', 'explicit browser QA guard required (MN_QA_ALLOW_BROWSER=1)');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) ensure(process.env[key], 'private QA configuration unavailable');
ensure(GAME.version && Number.isSafeInteger(PROTOCOL_VERSION), 'local game/protocol metadata unavailable');

const out = path.resolve(outArg);
ensure(!fs.existsSync(out), 'output directory already exists; choose a new --out directory');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = new URL(process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
ensure(target.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(target.hostname), 'public TLS target required');
const basePath = target.pathname.replace(/\/$/, ''); target.search = ''; target.hash = '';
const endpoint = suffix => new URL(`${basePath}${suffix}`, target);
const worldId = process.env.WORLD_ID || 'marea-negra';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, supabaseOptions);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, supabaseOptions);
const store = storeFromEnv();
const tag = randomUUID(), email = `mn-backpack-ui-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`, marker = `mnQaBackpackBrowser:${tag}`;
const operationIds = new Set();
let accountId = null, browser = null, context = null, page = null, pageErrors = [], consoleErrors = [], httpErrors = [], requestFailures = [];
const evidence = { schema: 'mn.inv03.backpacks.browser-public.v1', startedAt: new Date().toISOString(), target: target.origin,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, identity: 'random disposable Supabase user; credentials redacted',
  checks: [], screenshots: [], errors: [], pass: false,
  scope: 'authenticated public workshop UI; 18→30 and 30→42 purchases with adopted Carga; exact replay; insufficient-material denial; reload/reentry; ES/EN desktop/mobile layouts' };
const redact = value => String(value || '')
  .replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\0', '[redacted-key]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\0', '[redacted-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]')
  .replace(/((?:access_token|refresh_token|apikey|api_key|token|secret|password|code)=)[^&\s]+/gi, '$1[redacted]');
const redactUrl = value => { try { const u = new URL(value); for (const k of [...u.searchParams.keys()]) if (/token|key|secret|auth|code|password/i.test(k)) u.searchParams.set(k, '[redacted]'); u.username = ''; u.password = ''; return redact(u.toString()); } catch { return redact(value); } };
const unwrap = result => { if (!result || result.error) throw new Error('private QA account operation failed'); return result.data; };
const check = (name, detail = {}) => { evidence.checks.push({ name, pass: true, ...detail }); console.log(JSON.stringify({ check: name, pass: true })); };

async function publicStatus() {
  const response = await fetch(endpoint('/status'), { cache: 'no-store', signal: timeout(15000) });
  ensure(response.ok, 'public status unavailable'); return response.json();
}
async function assertIdle(status, label) {
  ensure(status.players === 0 && status.sockets === 0 && status.storage?.unsaved === 0
    && status.storage?.profileWrites === 0 && status.storage?.economic?.pending === 0
    && status.storage?.worldWriting === false, `${label}: public authority did not drain to idle`);
}
async function publicPreflight() {
  const [healthResponse, statusResponse, authResponse, protocolResponse, contentResponse] = await Promise.all(
    ['/health', '/status', '/auth/config', '/src/net/protocol.js', '/api/world/content'].map(route =>
      fetch(endpoint(route), { cache: 'no-store', signal: timeout(15000) })));
  ensure(healthResponse.ok && await healthResponse.text() === 'ok' && statusResponse.ok && authResponse.ok
    && protocolResponse.ok && contentResponse.ok, 'public health/build/auth/protocol/content endpoints unavailable');
  const status = await statusResponse.json(), auth = await authResponse.json(), protocol = await protocolResponse.text(), content = await contentResponse.json();
  const storage = status.storage;
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && storage?.durable === true && storage?.accounts === true
    && storage?.economic?.enabled === true && storage.economic.failed === false && storage.economic.pending === 0
    && storage?.artisan?.enabled === true && storage.artisan.ready === true
    && storage?.workshop?.enabled === true && storage.workshop.ready === true
    && storage?.world?.id === worldId && storage.world.ready === true && storage.world.failed === false
    && storage?.unsaved === 0 && storage?.profileWrites === 0 && storage.errors === 0,
  'public build, idle gate, durable store, workshop readiness, or world readiness preflight failed');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'public protocol differs from this checkout');
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin, 'public Auth configuration mismatch');
  ensure(content.ok === true && Number.isSafeInteger(content.generation)
    && (content.revisionId === null || typeof content.revisionId === 'string'), 'public world content identity unavailable');
  const ready = await store.checkStarterWorkshop(); ensure(ready?.version === 1, 'starter workshop readiness RPC unavailable');
  evidence.contentIdentity = { generation: content.generation, revisionId: content.revisionId };
  check('public_build_protocol_workshop_readiness_and_idle_gate', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION, worldId });
}
async function waitIdle(label) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const status = await publicStatus();
    if (status.players === 0 && status.sockets === 0 && status.storage?.unsaved === 0 && status.storage?.profileWrites === 0
      && status.storage?.economic?.pending === 0 && status.storage?.worldWriting === false) return status;
    await pause(350);
  }
  throw new Error(`${label}: bounded wait for public idle expired`);
}
function seededProfile(profile, tier, goods, label) {
  profile.lvl = 5;
  profile.attr = { v: 1, carga: 4, re: 1 };
  profile.carry = { v: 1, backpack: tier };
  profile.eco.pack.cap = [18, 30, 42][tier];
  profile.eco.pack.maxMass = 70;
  profile.eco.pack.goods = { ...goods };
  ensure(sanitizeProfile(profile), `${label}: Carga/backpack seed failed profile sanitizer`);
  const normalized = sanitizeProfile(profile);
  ensure(normalized?.lvl === 5 && normalized.attr?.carga === 4 && normalized.attr?.re === 1
    && normalized.carry?.backpack === tier && normalized.eco.pack.cap === [18, 30, 42][tier]
    && normalized.eco.pack.maxMass === 70 && normalized.eco.pack.goods.piedra === 1,
  `${label}: Carga, backpack capacity or unrelated cargo changed during sanitization`);
  return normalized;
}
async function createAccount() {
  const link = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  accountId = link.user?.id || null; ensure(accountId && link.user.email === email, 'disposable Auth identity creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: marker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === marker, 'disposable Auth marker mismatch');
  unwrap(await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'signup' }));
  let profile = newProfile(); profile.pirateId = `account:${accountId}`; profile.cp = 'aldea';
  profile = seededProfile(profile, 0, { madera: 2, lona: 3, piedra: 1 }, 'initial tier 0');
  profile.workshop = newWorkshop();
  ensure(sanitizeProfile(profile), 'initial backpack profile rejected by sanitizer');
  const saved = await store.initializeProfile(accountId, profile);
  ensure(saved?.version === 1 && saved.data?.pirateId === profile.pirateId, 'disposable profile did not persist exactly');
  check('disposable_authenticated_account_and_valid_carga4_profile_seeded', { initialVolume: 18, maxMass: 70, unrelatedGoods: ['piedra'] });
}
async function disconnectedSeed(tier, goods, label, allowedPrevious) {
  ensure(!page || page.isClosed(), `${label}: browser must close before profile seed`);
  await waitIdle(label);
  const auth = unwrap(await admin.auth.admin.getUserById(accountId));
  ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === marker, `${label}: disposable Auth marker mismatch`);
  const row = await store.loadProfile(accountId);
  ensure(row?.data?.pirateId === `account:${accountId}` && allowedPrevious(row.data), `${label}: current profile is outside the known QA phase`);
  const next = seededProfile(structuredClone(row.data), tier, goods, label);
  const saved = await store.saveProfile(accountId, next, row.version);
  ensure(saved?.version === row.version + 1, `${label}: CAS profile seed did not advance exactly once`);
  const persisted = await store.loadProfile(accountId);
  ensure(persisted?.version === saved.version && persisted.data?.pirateId === `account:${accountId}`
    && persisted.data?.lvl === 5 && persisted.data?.attr?.carga === 4 && persisted.data?.attr?.re === 1
    && persisted.data?.carry?.backpack === tier && persisted.data?.eco?.pack?.cap === [18, 30, 42][tier]
    && persisted.data?.eco?.pack?.maxMass === 70,
  `${label}: seeded profile failed durable readback`);
  assert.deepEqual(persisted.data.eco.pack.goods, goods, `${label}: seeded goods failed durable readback`);
  check(label, { backpackTier: tier, volume: [18, 30, 42][tier], maxMass: 70, unrelatedGoods: ['piedra'] });
}
async function launchBrowser(label, viewport) {
  const sibling = path.resolve(repo, '..', 'realms-of-trade-server');
  const playwrightFile = path.resolve(process.env.MN_PLAYWRIGHT || path.join(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
  const { chromium } = await import(pathToFileURL(playwrightFile).href);
  browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: path.resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
    headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const mobile = viewport.width < 600;
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  page = await context.newPage();
  const expectedGmDenied = (value, status) => { try { const u = new URL(value); return u.origin === target.origin && u.pathname === '/api/gm/session' && status === 403; } catch { return false; } };
  const expectedGmCancel = (value, error) => { try { const u = new URL(value); return u.origin === target.origin && u.pathname === '/api/gm/session' && error === 'net::ERR_ABORTED'; } catch { return false; } };
  page.on('pageerror', error => pageErrors.push(redact(error?.stack || error)));
  page.on('console', message => { if (message.type() === 'error' && !(/403/.test(message.text()) && /api\/gm\/session/.test(message.location().url))) consoleErrors.push(redact(message.text())); });
  page.on('response', response => { if (response.status() >= 400 && !expectedGmDenied(response.url(), response.status())) { try { const u = new URL(response.url()); httpErrors.push({ status: response.status(), path: u.pathname }); } catch { httpErrors.push({ status: response.status(), path: '[invalid-url]' }); } } });
  page.on('requestfailed', request => { const failure = request.failure()?.errorText || ''; if (!expectedGmCancel(request.url(), failure)) requestFailures.push({ url: redactUrl(request.url()), error: redact(failure) }); });
  page.on('websocket', socket => { evidence.websockets ||= []; evidence.websockets.push(redactUrl(socket.url())); });
  await page.goto(`${target.origin}${basePath}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
  await waitPage(() => window.__mn && !document.querySelector('#btn-play')?.disabled, `${label} client ready`, 90000);
  await page.locator('.account-open').click();
  await page.locator('.account-form input[name="email"]').fill(email);
  await page.locator('.account-form input[name="password"]').fill(password);
  await page.locator('.account-submit').click();
  await waitPage(() => { const node = document.querySelector('.account-signed'); return node && !node.hidden; }, `${label} password login`);
  await page.locator('.account-ready').click();
  await waitPage(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing'
    && window.__mn.client.profile?.pirateId, `${label} authenticated world entry`, 60000);
  await waitPage(() => !window.__mn.st.boarding && document.querySelector('#title')?.hidden, `${label} boarding`);
  const profile = await page.evaluate(() => structuredClone(window.__mn.client.profile));
  ensure(profile.pirateId === `account:${accountId}` && profile.lvl === 5 && profile.attr?.carga === 4 && profile.attr?.re === 1
    && profile.eco.pack.maxMass === 70, `${label}: authenticated profile did not retain Carga 4`);
  await page.evaluate(() => {
    const mn = window.__mn, client = mn.client;
    window.__qaBackpackRequests = [];
    window.__qaBackpackEvents = [];
    const send = client.send.bind(client);
    client.send = message => {
      if (message?.type === 'artisan' && message.op === 'upgradePack') window.__qaBackpackRequests.push(structuredClone(message));
      return send(message);
    };
    window.__qaBackpackOff = client.bus.on('artisan', event => {
      if (event?.op === 'upgradePack') window.__qaBackpackEvents.push(structuredClone(event));
    });
  });
  check(`${label}_authenticated_public_browser_entry`, { viewport, backpackTier: profile.carry.backpack, volume: profile.eco.pack.cap });
}
async function waitPage(predicate, label, ms = 30000, arg = null) {
  try { await page.waitForFunction(predicate, arg, { timeout: ms }); } catch { throw new Error(`bounded browser wait expired: ${label}`); }
}
async function closeBrowser() {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  context = null; browser = null; page = null;
}
async function setLocale(locale) {
  await page.evaluate(async value => (await import('/src/core/i18n.js')).setLocale(value), locale);
  await page.waitForTimeout(200);
  await page.evaluate(value => { document.documentElement.lang = value; }, locale);
}
async function walkToBench() {
  const endBy = Date.now() + 90000; let last = null, lastProgress = Date.now();
  while (Date.now() < endBy) {
    const state = await page.evaluate(() => {
      const mn = window.__mn, bench = mn?.client?.resources?.bench, ps = mn?.ps;
      if (!bench || !ps) return null;
      const a = { x: 0, z: 0 }, b = { x: 0, z: 0 }; mn.world.rig.moveBasis(1, 0, a); mn.world.rig.moveBasis(0, 1, b);
      return { x: ps.x, z: ps.z, bx: bench.x, bz: bench.z, d: Math.hypot(ps.x - bench.x, ps.z - bench.z), a, b };
    });
    ensure(state, 'public bench/player state unavailable');
    if (state.d <= 2.5) break;
    const dx = (state.bx - state.x) / state.d, dz = (state.bz - state.z) / state.d;
    const det = state.a.x * state.b.z - state.b.x * state.a.z; ensure(Math.abs(det) > 0.1, 'client movement basis unavailable');
    const ax = (dx * state.b.z - state.b.x * dz) / det, ay = (state.a.x * dz - dx * state.a.z) / det, keys = [];
    if (ay > 0.25) keys.push('w'); if (ay < -0.25) keys.push('s'); if (ax < -0.25) keys.push('a'); if (ax > 0.25) keys.push('d');
    for (const key of keys) await page.keyboard.down(key); await pause(220); for (const key of keys) await page.keyboard.up(key); await pause(80);
    if (!last || Math.hypot(state.x - last.x, state.z - last.z) > 0.35) lastProgress = Date.now();
    else ensure(Date.now() - lastProgress < 9000, 'normal client movement stalled near workshop bench');
    last = { x: state.x, z: state.z };
  }
  const distance = await page.evaluate(() => Math.hypot(window.__mn.ps.x - window.__mn.client.resources.bench.x,
    window.__mn.ps.z - window.__mn.client.resources.bench.z));
  ensure(Date.now() < endBy && distance <= 2.8, 'walk to the carpentry bench failed');
  check('walked_to_bench_with_normal_client_input', { distance: Number(distance.toFixed(2)) });
}
async function openWorkshop() {
  await walkToBench(); await page.keyboard.press('f');
  await waitPage(() => document.querySelector('.workbench-panel') && !document.querySelector('.workbench-panel').hidden, 'nearby workbench open');
  const entry = page.locator('.workbench-panel .community-trigger').filter({ hasText: /Taller y mochila|Workshop and backpack/ });
  await waitPage(() => [...document.querySelectorAll('.workbench-panel .community-trigger')]
    .some(button => !button.hidden && /Taller y mochila|Workshop and backpack/.test(button.textContent)), 'workshop button available');
  await entry.click();
  await waitPage(() => window.__mn.panels.artisan.active && !document.querySelector('.workshop-panel')?.hidden, 'actual workshop opened');
}
async function inspectPanel({ label, locale, viewport, expectedTier, expectedVolume, cost, enabled }) {
  const panel = page.locator('.workshop-panel'), button = panel.locator('[data-upgrade]');
  const details = await page.evaluate(() => {
    const root = document.querySelector('.workshop-panel'), read = selector => root?.querySelector(selector)?.textContent?.trim() || '';
    const upgrade = root?.querySelector('[data-upgrade]'); const rect = root?.getBoundingClientRect();
    return { hidden: root?.hidden, title: read('[data-title]'), tier: read('[data-carry-tier]'), volume: read('[data-volume]'),
      mass: read('[data-mass]'), button: upgrade?.textContent?.trim(), disabled: upgrade?.disabled,
      cost: read('[data-upgrade-cost]'), bounds: rect ? { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth };
  });
  // Read the carry tier through its exact source selector.
  details.tier = await panel.locator('[data-carry-tier]').innerText();
  assert.equal(details.hidden, false); assert.match(details.title, /Taller|Workshop/i);
  assert.equal(details.tier, `${expectedTier + 1} / 3`);
  assert.match(details.volume, new RegExp(`${expectedVolume}\\s*uV`)); assert.match(details.mass, /70\s*uM/);
  assert.equal(details.disabled, !enabled);
  if (cost) assert.match(details.cost, cost);
  const b = details.bounds, v = details.viewport;
  assert(b && b.x >= 0 && b.y >= 0 && b.right <= v.width && b.bottom <= v.height && details.documentWidth <= v.width,
    `${label}: workshop panel exceeds viewport`);
  check(`${label}_localized_workshop_bounds_and_upgrade_state`, { ...details, locale, expectedTier, expectedVolume });
  const file = `${label}.png`; await panel.screenshot({ path: path.join(out, file), animations: 'disabled' }); evidence.screenshots.push(file);
  return { button, details };
}
async function capturedState() {
  return page.evaluate(() => structuredClone(window.__mn.client.profile));
}
function goodsExactly(got, expected) { assert.deepEqual(got || {}, expected); }
function expectedUpgradeCost(tier) { return tier === 0 ? { madera: 2, lona: 3 } : { madera: 4, lona: 5 }; }
async function clickUpgrade({ label, tierBefore, tierAfter, volumeBefore, volumeAfter, cost }) {
  const before = await capturedState();
  assert.equal(before.carry?.backpack, tierBefore); assert.equal(before.eco.pack.cap, volumeBefore);
  assert.equal(before.eco.pack.maxMass, 70); assert.equal(before.attr?.carga, 4); assert.equal(before.attr?.re, 1);
  const opCount = await page.evaluate(() => window.__qaBackpackRequests.length);
  const evCount = await page.evaluate(() => window.__qaBackpackEvents.length);
  await page.locator('.workshop-panel [data-upgrade]').click();
  await waitPage((prior) => window.__qaBackpackRequests.length > prior, `${label} upgrade command capture`, 15000, opCount);
  await waitPage((tier) => window.__mn.client.profile?.carry?.backpack === tier
    && !document.querySelector('.workshop-panel')?.classList.contains('is-pending'), `${label} durable upgrade projection`, 30000, tierAfter);
  await waitPage((prior) => window.__qaBackpackEvents.length > prior, `${label} server upgrade acknowledgement`, 15000, evCount);
  const request = await page.evaluate((index) => structuredClone(window.__qaBackpackRequests[index]), opCount);
  const event = await page.evaluate((index) => structuredClone(window.__qaBackpackEvents[index]), evCount);
  const after = await capturedState();
  const expectedRev = before.eco.tradeRev;
  assert.equal(request.type, 'artisan'); assert.equal(request.op, 'upgradePack'); assert.equal(request.expectedRev, expectedRev);
  assert.equal(typeof request.opId, 'string'); assert.ok(request.opId.length >= 8);
  assert.equal(event.opId, request.opId); assert.equal(event.ok, true); assert.equal(event.rev, expectedRev + 1);
  assert.equal(after.eco.tradeRev, expectedRev + 1); assert.equal(after.carry.backpack, tierAfter);
  assert.equal(after.eco.pack.cap, volumeAfter); assert.equal(after.eco.pack.maxMass, 70);
  assert.equal(after.attr.carga, 4); assert.equal(after.attr.re, 1);
  const remaining = { piedra: 1 }; goodsExactly(after.eco.pack.goods, remaining);
  const id = economicOperationId(worldId, accountId, request.opId); operationIds.add(id);
  const receipt = await store.loadEconomicOperation(id);
  ensure(receipt?.request?.account === accountId && receipt.request.command?.type === 'artisan'
    && receipt.request.command.op === 'upgradePack' && receipt.request.command.opId === request.opId
    && receipt.request.before && receipt.request.profile && receipt.result?.ack?.ok === true,
  `${label}: durable economic receipt does not prove the upgrade`);
  const receiptBefore = receipt.request.before, receiptAfter = receipt.request.profile;
  assert.equal(receiptBefore.carry?.backpack, tierBefore); assert.equal(receiptBefore.eco.pack.cap, volumeBefore);
  assert.equal(receiptBefore.eco.pack.maxMass, 70); assert.equal(receiptBefore.attr?.carga, 4);
  assert.deepEqual(receiptBefore.eco.pack.goods, { ...cost, piedra: 1 });
  assert.equal(receiptAfter.carry?.backpack, tierAfter); assert.equal(receiptAfter.eco.pack.cap, volumeAfter);
  assert.equal(receiptAfter.eco.pack.maxMass, 70); assert.equal(receiptAfter.attr?.carga, 4); assert.equal(receiptAfter.attr?.re, 1);
  goodsExactly(receiptAfter.eco.pack.goods, remaining);
  check(`${label}_ui_purchase_exact_cost_carga_capacity_unrelated_good_and_receipt`, {
    opId: request.opId, backpackTier: tierAfter, volumeBefore, volumeAfter, maxMass: 70, cargo: ['piedra'], durableReceipt: true });
  return { before, after, request, event, receipt, operationId: id };
}
async function exactReplay({ label, request, expectedProfile, receipt: originalReceipt, operationId, priorEventCount }) {
  await page.evaluate(message => window.__mn.client.send(structuredClone(message)), request);
  await waitPage((count) => window.__qaBackpackEvents.length > count, `${label} exact replay acknowledgement`, 15000, priorEventCount);
  const replay = await page.evaluate((count) => structuredClone(window.__qaBackpackEvents[count]), priorEventCount);
  assert.equal(replay.opId, request.opId); assert.equal(replay.ok, true);
  assert.ok(replay.replay === true || replay.historical === true, `${label}: exact replay was not marked historical`);
  const live = await capturedState();
  assert.equal(live.eco.tradeRev, expectedProfile.eco.tradeRev); assert.equal(live.carry.backpack, expectedProfile.carry.backpack);
  assert.deepEqual(live.eco.pack, expectedProfile.eco.pack); assert.deepEqual(live.attr, expectedProfile.attr);
  const receipt = await store.loadEconomicOperation(operationId); assert.deepEqual(receipt, originalReceipt);
  check(`${label}_exact_replay_is_historical_and_does_not_repeat_effect`, { opId: request.opId, replay: true, unchangedTradeRev: live.eco.tradeRev });
}
async function resizePage(width, height) {
  await page.setViewportSize({ width, height });
  await waitPage(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing', 'viewport change preserved public session');
}
async function reopenWorkshop() { await openWorkshop(); }
async function runAcceptance() {
  await launchBrowser('es-desktop-tier1', { width: 1280, height: 720 });
  await setLocale('es');
  await openWorkshop();
  await inspectPanel({ label: '01-es-desktop-tier1-before-purchase', locale: 'es', viewport: { width: 1280, height: 720 },
    expectedTier: 0, expectedVolume: 18, cost: /2 tablas.*3 lona/i, enabled: true });
  const tier1 = await clickUpgrade({ label: 'tier1', tierBefore: 0, tierAfter: 1, volumeBefore: 18, volumeAfter: 30, cost: expectedUpgradeCost(0) });
  const replayCount1 = await page.evaluate(() => window.__qaBackpackEvents.length);
  await exactReplay({ label: 'tier1', request: tier1.request, expectedProfile: tier1.after, receipt: tier1.receipt,
    operationId: tier1.operationId, priorEventCount: replayCount1 });
  await closeBrowser();

  await disconnectedSeed(1, { madera: 3, lona: 5, piedra: 1 }, 'seed-tier1-insufficient', p =>
    p.carry?.backpack === 1 && p.eco?.pack?.cap === 30 && p.eco?.pack?.maxMass === 70 && p.attr?.carga === 4);
  await launchBrowser('en-desktop-insufficient', { width: 1280, height: 720 });
  await setLocale('en'); await openWorkshop();
  const insufficient = await inspectPanel({ label: '02-en-desktop-tier2-insufficient', locale: 'en', viewport: { width: 1280, height: 720 },
    expectedTier: 1, expectedVolume: 30, cost: /4 planks.*5 canvas/i, enabled: false });
  const deniedBefore = await capturedState(), denialRev = deniedBefore.eco.tradeRev;
  const denialCommand = { t: 'cmd', type: 'artisan', op: 'upgradePack', opId: `backpack-tier2-denied-${randomUUID()}`,
    expectedRev: denialRev };
  const denialEventCount = await page.evaluate(() => window.__qaBackpackEvents.length);
  await page.evaluate(message => window.__mn.client.send(structuredClone(message)), denialCommand);
  await waitPage((count) => window.__qaBackpackEvents.length > count, 'durable insufficient backpack denial', 15000, denialEventCount);
  const deniedEvent = await page.evaluate(count => structuredClone(window.__qaBackpackEvents[count]), denialEventCount);
  assert.equal(deniedEvent.opId, denialCommand.opId); assert.equal(deniedEvent.ok, false); assert.equal(deniedEvent.why, 'goods');
  const deniedAfter = await capturedState();
  assert.equal(deniedAfter.eco.tradeRev, denialRev); assert.deepEqual(deniedAfter.eco.pack, deniedBefore.eco.pack);
  assert.deepEqual(deniedAfter.carry, deniedBefore.carry); assert.deepEqual(deniedAfter.attr, deniedBefore.attr);
  await waitPage((rev) => window.__mn.client.profile.eco.tradeRev === rev, 'denial left authenticated profile revision unchanged', 8000, denialRev);
  const persistedDenied = await store.loadProfile(accountId);
  assert.equal(persistedDenied?.data?.eco?.tradeRev, denialRev); assert.deepEqual(persistedDenied.data.eco.pack, deniedBefore.eco.pack);
  const denialId = economicOperationId(worldId, accountId, denialCommand.opId);
  assert.equal(deniedEvent.durable, true, 'ready Supabase workshop denial was not acknowledged as durable');
  operationIds.add(denialId);
  const denialReceipt = await store.loadEconomicOperation(denialId);
  ensure(denialReceipt?.request?.command?.opId === denialCommand.opId && denialReceipt.request.before
    && denialReceipt.request.profile && denialReceipt.result?.ack?.ok === false && denialReceipt.result.ack.why === 'goods',
  'durable denial receipt differs');
  assert.deepEqual(denialReceipt.request.before.eco.pack, deniedBefore.eco.pack);
  assert.deepEqual(denialReceipt.request.profile.eco.pack, deniedBefore.eco.pack);
  assert.equal(denialReceipt.request.profile.carry.backpack, 1); assert.equal(denialReceipt.request.profile.attr.carga, 4);
  check('tier2_insufficient_materials_durable_denial_receipt_and_no_profile_change', { why: deniedEvent.why, durable: true });
  ensure(await insufficient.button.isDisabled(), 'upgrade button became enabled despite insufficient materials');
  await closeBrowser();

  await disconnectedSeed(1, { madera: 4, lona: 5, piedra: 1 }, 'seed-tier1-funded', p =>
    p.carry?.backpack === 1 && p.eco?.pack?.cap === 30 && p.eco?.pack?.maxMass === 70 && p.attr?.carga === 4);
  await launchBrowser('es-mobile-tier2', { width: 390, height: 844 });
  await setLocale('es'); await openWorkshop();
  await inspectPanel({ label: '03-es-mobile-tier2-before-purchase', locale: 'es', viewport: { width: 390, height: 844 },
    expectedTier: 1, expectedVolume: 30, cost: /4 tablas.*5 lona/i, enabled: true });
  const tier2 = await clickUpgrade({ label: 'tier2', tierBefore: 1, tierAfter: 2, volumeBefore: 30, volumeAfter: 42, cost: expectedUpgradeCost(1) });
  const replayCount2 = await page.evaluate(() => window.__qaBackpackEvents.length);
  await exactReplay({ label: 'tier2', request: tier2.request, expectedProfile: tier2.after, receipt: tier2.receipt,
    operationId: tier2.operationId, priorEventCount: replayCount2 });

  await page.reload({ waitUntil: 'commit', timeout: 90000 });
  await waitPage(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'public client after reload', 90000);
  await page.locator('.account-open').click();
  await waitPage(() => { const node = document.querySelector('.account-signed'); return node && !node.hidden; }, 'persisted normal login after reload');
  await page.locator('.account-ready').click();
  await waitPage(() => window.__mn?.client?.joined && window.__mn.client.profile?.carry?.backpack === 2
    && !window.__mn.st.boarding, 'tier2 profile restored after UI reentry', 60000);
  let restored = await capturedState();
  assert.equal(restored.pirateId, `account:${accountId}`); assert.equal(restored.eco.pack.cap, 42); assert.equal(restored.eco.pack.maxMass, 70);
  assert.deepEqual(restored.eco.pack.goods, { piedra: 1 }); assert.equal(restored.attr.carga, 4); assert.equal(restored.attr.re, 1);
  const stored = await store.loadProfile(accountId);
  assert.equal(stored?.data?.carry?.backpack, 2); assert.equal(stored.data.eco.pack.cap, 42);
  assert.deepEqual(stored.data.eco.pack.goods, { piedra: 1 }); assert.equal(stored.data.attr.carga, 4);
  check('reload_and_authenticated_reentry_restore_tier2_carga_and_unrelated_cargo', { volume: 42, maxMass: 70, cargo: ['piedra'], profileVersion: stored.version });

  await setLocale('en'); await resizePage(390, 844); await reopenWorkshop();
  await inspectPanel({ label: '04-en-mobile-tier2-after-reentry', locale: 'en', viewport: { width: 390, height: 844 },
    expectedTier: 2, expectedVolume: 42, enabled: false });
  assert.equal(await page.locator('.workshop-panel [data-upgrade]').innerText(), 'Backpack at maximum');
  evidence.network = { pageErrors, consoleErrors, httpErrors, requestFailures };
  assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(httpErrors, []); assert.deepEqual(requestFailures, []);
  ensure(evidence.websockets?.some(value => value.startsWith('wss://')), 'public WSS was not used');
  check('browser_network_clean_and_public_wss', { pageErrors: 0, consoleErrors: 0, httpErrors: 0, requestFailures: 0, publicWss: true });
}
async function knownProfileState(profile) {
  if (!profile || profile.pirateId !== `account:${accountId}` || profile.lvl !== 5 || profile.attr?.v !== 1
      || profile.attr.carga !== 4 || profile.attr.re !== 1 || profile.workshop?.v !== 1 || profile.workshop?.boards !== 0) return false;
  const pack = profile.eco?.pack, carry = profile.carry;
  if (!pack || !carry || pack.maxMass !== 70) return false;
  const goods = pack.goods || {};
  const cargo = Object.keys(goods).sort().map(key => `${key}:${goods[key]}`).join('|');
  const key = `${carry.backpack}/${pack.cap}/${cargo}`;
  return new Set(['0/18/lona:3|madera:2|piedra:1', '1/30/lona:5|madera:3|piedra:1',
    '1/30/lona:5|madera:4|piedra:1', '1/30/piedra:1', '2/42/piedra:1']).has(key);
}
async function cleanup() {
  await closeBrowser();
  if (!accountId) return;
  const status = await waitIdle('cleanup'); await assertIdle(status, 'cleanup');
  const auth = unwrap(await admin.auth.admin.getUserById(accountId));
  ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === marker, 'cleanup stopped: exact Auth marker mismatch');
  const row = await store.loadProfile(accountId);
  if (row) {
    ensure(await knownProfileState(row.data), 'cleanup stopped: profile does not match an explicitly seeded QA phase');
    const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id'));
    ensure(deleted.length === 1 && deleted[0].player_id === accountId, 'cleanup profile deletion did not match exact QA account');
  }
  unwrap(await admin.auth.admin.deleteUser(accountId));
  const deletedAuth = await admin.auth.admin.getUserById(accountId);
  const authAbsent = deletedAuth?.data?.user == null
    && (!deletedAuth?.error || deletedAuth.error.status === 404 || deletedAuth.error.code === 'user_not_found');
  ensure(authAbsent, 'disposable Auth identity remains or deletion could not be verified');
  ensure(await store.loadProfile(accountId) === null, 'disposable profile remains after Auth cleanup');
  let retained = 0;
  for (const id of operationIds) if (await store.loadEconomicOperation(id)) retained++;
  ensure(retained === operationIds.size, 'cleanup stopped: acknowledged immutable purchase receipt is missing');
  evidence.cleanup = { temporaryAuthAndProfileRemoved: true, retainedOperationCount: retained,
    receiptPolicy: 'economic receipts intentionally retained' };
}
try {
  await publicPreflight();
  await createAccount();
  const initialized = await store.loadProfile(accountId);
  ensure(initialized?.data?.pirateId === `account:${accountId}` && await knownProfileState(initialized.data), 'initial profile seed failed verification');
  await runAcceptance(); evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; provider details suppressed';
  if (page && !page.isClosed()) {
    await page.locator('input[name="email"], input[name="password"]').evaluateAll(nodes => nodes.forEach(node => { node.value = ''; })).catch(() => {});
    await page.screenshot({ path: path.join(out, `failure-${tag}.png`) }).then(() => evidence.screenshots.push(`failure-${tag}.png`)).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1; }
  evidence.completedAt = new Date().toISOString();
  await fs.promises.mkdir(out, { recursive: true });
  const evidencePath = path.join(out, `browser-${tag}.json`);
  await fs.promises.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(evidencePath, 0o600); } catch {}
  await pub.auth.signOut().catch(() => {});
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, screenshots: evidence.screenshots.length,
    gameVersion: evidence.gameVersion, protocolVersion: evidence.protocolVersion, cleanup: evidence.cleanup || null,
    failure: evidence.failure || evidence.cleanupFailure || null }));
}

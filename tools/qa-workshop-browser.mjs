#!/usr/bin/env node
// Public browser acceptance for the starter workshop; all gameplay actions use the visible client UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { newWorkshop } from '../src/sim/systems/workshop.js';
import { carryLimits } from '../src/data/carry.js';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const origin = process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.MN_QA_OUT || 'docs/delivery/prg01d-starter-workshop/activation/browser');
const usage = 'usage: node tools/qa-workshop-browser.mjs [--env-file PATH]';
const ensure = (condition, reason) => { if (!condition) throw new Error(reason); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
let envFile = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (process.argv[i] === '--help' || process.argv[i] === '-h') { console.log(usage); process.exit(0); }
  else throw new Error(usage);
}
if (envFile) { try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('environment file unavailable'); } }
ensure(process.env.MN_QA_ALLOW_BROWSER === '1', 'Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to run this public acceptance.');
ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
  'Supabase QA configuration unavailable');
const target = new URL(origin);
ensure(target.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(target.hostname), 'public TLS target required');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
const store = storeFromEnv();
const starterCarry = Object.freeze({ v: 1, backpack: 0 });
const starterLimits = carryLimits(starterCarry, 1);
const tag = randomUUID();
const email = `mn-workshop-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`;
const authMarker = `mnQaWorkshopBrowser:${tag}`;
let accountId = null, browser = null, context = null, activePage = null;
const operationIds = new Set();
const evidence = { schema: 'mn.starter-workshop.browser.v1', at: new Date().toISOString(), target: target.origin,
  identity: 'random disposable Supabase user; credentials redacted', gameVersion: GAME.version,
  protocolVersion: PROTOCOL_VERSION, checks: [], screenshots: [], errors: [] };
const check = (name, data = {}) => { evidence.checks.push({ name, pass: true, ...data }); console.log(JSON.stringify({ check: name, pass: true })); };
const redact = value => String(value || '').replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\u0000', '[redacted-supabase-secret]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\u0000', '[redacted-supabase-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]')
  .replace(/((?:access_token|refresh_token|apikey|api_key|token|secret|password|code)=)[^&\s]+/gi, '$1[redacted]');
const redactUrl = value => { try { const u = new URL(value); for (const k of [...u.searchParams.keys()]) if (/token|key|secret|auth|code|password/i.test(k)) u.searchParams.set(k, '[redacted]'); u.username = ''; u.password = ''; return redact(u.toString()); } catch { return redact(value); } };
const unwrap = result => { if (!result || result.error) throw new Error('Supabase operation failed'); return result.data; };
const url = suffix => new URL(suffix, target);
async function waitFor(page, predicate, label, timeout = 30000, arg = null) {
  try { await page.waitForFunction(predicate, arg, { timeout }); } catch { throw new Error(`bounded wait expired: ${label}`); }
}
async function preflight() {
  const [h, s, a, p] = await Promise.all(['/health', '/status', '/auth/config', '/src/net/protocol.js'].map(v => fetch(url(v), { cache: 'no-store', signal: AbortSignal.timeout(15000) })));
  ensure(h.ok && await h.text() === 'ok', 'public health check failed');
  const status = await s.json(), auth = await a.json();
  ensure(s.ok && status.version === GAME.version && status.errors === 0 && status.players === 0
    && status.storage?.durable === true && status.storage?.accounts === true && status.storage?.economic?.enabled === true
    && status.storage?.economic?.failed === false && status.storage?.world?.ready === true && status.storage?.world?.failed === false
    && status.storage?.economic?.pending === 0 && status.storage?.unsaved === 0 && status.storage?.errors === 0,
  'public release or durable storage is not ready');
  ensure(a.ok && auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin, 'public auth configuration mismatch');
  ensure(p.ok && (await p.text()).includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol differs from local script');
  check('public_health_and_release', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION,
    players: status.players, durable: true, worldReady: true });
}
async function createAccount() {
  const link = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  accountId = link.user?.id || null;
  ensure(accountId && link.user.email === email, 'disposable Auth identity creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: authMarker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === authMarker, 'disposable Auth marker mismatch');
  unwrap(await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'signup' }));
  const profile = newProfile();
  profile.pirateId = `account:${accountId}`;
  profile.cp = 'aldea'; // Canonical village checkpoint places this new QA character beside the workshop.
  profile.carry = { ...starterCarry };
  profile.eco.pack.cap = starterLimits.volume; profile.eco.pack.maxMass = starterLimits.maxMass;
  profile.workshop = newWorkshop(); profile.eco.pack.goods = { madera: 3 };
  ensure(sanitizeProfile(profile), 'starter workshop profile rejected by sanitizer');
  const saved = await store.initializeProfile(accountId, profile);
  ensure(saved?.version === 1 && saved.data?.pirateId === profile.pirateId && saved.data?.eco?.pack?.goods?.madera === 3
    && saved.data?.carry?.v === profile.carry.v && saved.data?.workshop?.boards === 0,
  'disposable profile did not persist exactly');
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'ordinary password login failed');
  return profile;
}
async function launchBrowser() {
  const sibling = path.resolve(repo, '..', 'realms-of-trade-server');
  const playwrightFile = path.resolve(process.env.MN_PLAYWRIGHT || path.join(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
  const { chromium } = await import(pathToFileURL(playwrightFile).href);
  browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: path.resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
    headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = activePage = await context.newPage();
  const consoleErrors = [], requestFailures = [], httpFailures = [], websockets = [], expectedDenials = [], expectedCancellations = [];
  const isGmDenial = (value, status) => { try { const u = new URL(value); return u.origin === target.origin && u.pathname === '/api/gm/session' && status === 403; } catch { return false; } };
  const isStaleGmCheckCancellation = (value, error) => {
    try { const u = new URL(value); return u.origin === target.origin && u.pathname === '/api/gm/session' && error === 'net::ERR_ABORTED'; }
    catch { return false; }
  };
  evidence.network = { consoleErrors, requestFailures, httpFailures, expectedDenials, expectedCancellations, websockets };
  page.on('pageerror', e => evidence.errors.push(redact(e?.stack || e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const source = m.location().url;
    if (isGmDenial(source, 403) && /403/.test(m.text())) return;
    consoleErrors.push({ text: redact(m.text()), source: redactUrl(source) });
  });
  page.on('requestfailed', r => {
    const failure = r.failure()?.errorText || '', item = { url: redactUrl(r.url()), error: redact(failure) };
    if (isStaleGmCheckCancellation(r.url(), failure)) expectedCancellations.push({ ...item,
      reason: 'GmEntry permission checks can become stale during auth transitions; page navigation cancels outstanding fetches and its epoch guard ignores stale results.' });
    else requestFailures.push(item);
  });
  page.on('response', r => { if (r.status() >= 400) {
    const item = { url: redactUrl(r.url()), status: r.status() };
    (isGmDenial(r.url(), r.status()) ? expectedDenials : httpFailures).push(item);
  } });
  page.on('websocket', s => websockets.push(redactUrl(s.url())));
  await page.goto(`${target.origin}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
  await waitFor(page, () => !!window.__mn && !document.querySelector('#btn-play')?.disabled, 'public game ready', 90000);
  await waitFor(page, () => window.__mn.transport.kind === 'ws' && !window.__mn.transport.closed && window.__mn.transport.ws?.readyState === 1
    && window.__mn.transport.rtt > 0 && !document.querySelector('.net-lost'), 'public WSS connected');
  await page.locator('.account-open').click();
  await page.locator('.account-form input[name="email"]').fill(email);
  await page.locator('.account-form input[name="password"]').fill(password);
  await page.locator('.account-submit').click();
  await waitFor(page, () => { const s = document.querySelector('.account-signed'); return s && !s.hidden; }, 'password login');
  await page.locator('.account-ready').click();
  await waitFor(page, () => window.__mn?.st?.mode === 'playing' && window.__mn?.client?.joined
    && !!window.__mn.client.profile?.pirateId && !!window.__mn.client.resources?.bench, 'authenticated character', 60000);
  const admitted = await page.evaluate(() => ({ pirateId: window.__mn.client.profile?.pirateId,
    pack: window.__mn.client.profile?.eco?.pack, cp: window.__mn.client.profile?.cp }));
  ensure(admitted.pirateId === `account:${accountId}` && admitted.pack?.cap === starterLimits.volume
    && admitted.pack?.maxMass === starterLimits.maxMass && admitted.cp === 'aldea', 'seed profile was not admitted with canonical carry and village checkpoint');
  await waitFor(page, () => !window.__mn.st.boarding && document.querySelector('#title')?.hidden && !document.querySelector('#hud')?.hidden, 'boarding complete');
  await page.evaluate(() => {
    const client = window.__mn.client, send = client.send.bind(client);
    window.__qaWorkshopOpId = null;
    client.send = command => { if (command?.type === 'artisan' && command?.op === 'contribute') window.__qaWorkshopOpId = command.opId; return send(command); };
  });
  ensure(websockets.some(x => x.startsWith('wss://')), 'public WSS was not used');
  const persisted = await store.loadProfile(accountId);
  ensure(persisted?.data?.eco?.pack?.goods?.madera === 3 && persisted.data.workshop?.boards === 0,
    'live profile did not start with exact starter resources');
  check('ordinary_password_login_and_public_wss', { transport: 'ws', initializedPlanks: 3, accountMarker: 'redacted' });
  return { consoleErrors, requestFailures, httpFailures, expectedDenials, expectedCancellations, websockets };
}
async function walkToBench(page) {
  const begin = Date.now(), deadline = begin + 90000;
  let lastProgress = Date.now(), last = null, stalled = 0;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const mn = window.__mn, bench = mn?.client?.resources?.bench, ps = mn?.ps;
      if (!bench || !ps) return null;
      return { x: ps.x, z: ps.z, bx: bench.x, bz: bench.z, d: Math.hypot(ps.x - bench.x, ps.z - bench.z),
        basis: (() => { const a = { x: 0, z: 0 }, b = { x: 0, z: 0 }; mn.world.rig.moveBasis(1, 0, a); mn.world.rig.moveBasis(0, 1, b); return { a, b }; })() };
    });
    ensure(s, 'public bench/player state unavailable');
    if (s.d <= 3.1) break;
    const dx = (s.bx - s.x) / s.d, dz = (s.bz - s.z) / s.d;
    const det = s.basis.a.x * s.basis.b.z - s.basis.b.x * s.basis.a.z;
    ensure(Math.abs(det) > 0.1, 'client movement basis unavailable');
    const ax = (dx * s.basis.b.z - s.basis.b.x * dz) / det, ay = (s.basis.a.x * dz - dx * s.basis.a.z) / det;
    const keys = [];
    if (ay > 0.25) keys.push('w'); if (ay < -0.25) keys.push('s'); if (ax < -0.25) keys.push('a'); if (ax > 0.25) keys.push('d');
    for (const k of keys) await page.keyboard.down(k);
    await sleep(220);
    for (const k of keys) await page.keyboard.up(k);
    await sleep(80);
    if (!last || Math.hypot(s.x - last.x, s.z - last.z) > 0.35) { lastProgress = Date.now(); stalled = 0; }
    else if (Date.now() - lastProgress > 3000 && ++stalled > 4) throw new Error('normal client movement stalled near bench');
    last = { x: s.x, z: s.z };
  }
  const end = await page.evaluate(() => { const p = window.__mn.ps, b = window.__mn.client.resources.bench; return Math.hypot(p.x - b.x, p.z - b.z); });
  ensure(Date.now() < deadline && end <= 3.6, 'walk to the carpentry bench failed');
  check('walked_to_bench_with_normal_client_input', { method: 'held WASD through public client controls', distance: Number(end.toFixed(2)) });
}
async function capture(page, label) {
  const file = `${label}.png`; await page.screenshot({ path: path.join(out, file), fullPage: false }); evidence.screenshots.push(file);
}
async function assertPanelFits(page, width, height, locale) {
  const v = await page.locator('.workshop-panel').evaluate(el => ({ hidden: el.hidden, bounds: el.getBoundingClientRect().toJSON(),
    title: el.querySelector('[data-title]')?.textContent, boards: el.querySelector('[data-board-count]')?.textContent,
    volume: el.querySelector('[data-volume]')?.textContent, mass: el.querySelector('[data-mass]')?.textContent }));
  assert.equal(v.hidden, false); assert.ok(v.bounds.x >= 0 && v.bounds.y >= 0 && v.bounds.right <= width && v.bounds.bottom <= height);
  assert.ok(v.boards && v.volume && v.mass && /workshop|taller/i.test(v.title));
  check(`workshop_panel_fits_${locale}_${width}x${height}`, { bounds: v.bounds, boards: v.boards, carryVisible: true });
}
async function runAcceptance(page, network) {
  await walkToBench(page);
  await page.keyboard.press('f');
  await waitFor(page, () => document.querySelector('.workbench-panel') && !document.querySelector('.workbench-panel').hidden, 'F opened nearby workbench');
  const workshopButton = page.locator('.workbench-panel .community-trigger').filter({ hasText: /Taller y mochila|Workshop and backpack/ });
  await waitFor(page, () => [...document.querySelectorAll('.workbench-panel .community-trigger')].some(b => !b.hidden && /Taller y mochila|Workshop and backpack/.test(b.textContent)), 'workshop button available');
  await workshopButton.click();
  await waitFor(page, () => window.__mn.panels.artisan.active && !document.querySelector('.workshop-panel')?.hidden, 'actual workshop panel opened');
  const initial = await page.evaluate(() => ({ planks: window.__mn.client.profile.eco.pack.goods.madera,
    boards: window.__mn.client.profile.workshop.boards, carry: window.__mn.client.profile.carry }));
  assert.equal(initial.planks, 3); assert.equal(initial.boards, 0); assert.ok(initial.carry);
  await assertPanelFits(page, 1280, 720, 'es'); await capture(page, '01-workshop-desktop-es');
  await page.locator('.workshop-panel [data-max]').click();
  await waitFor(page, () => window.__mn.client.profile.workshop?.boards === 3
    && (window.__mn.client.profile.eco.pack.goods.madera || 0) === 0
    && !document.querySelector('.workshop-panel')?.classList.contains('is-pending'), 'three plank UI delivery confirmed', 30000);
  const liveProfile = await page.evaluate(() => window.__mn.client.profile);
  assert.equal(liveProfile.workshop.boards, 3);
  const saved = await store.loadProfile(accountId);
  ensure(saved?.data?.workshop?.boards === 3 && (saved.data?.eco?.pack?.goods?.madera || 0) === 0,
    'authoritative saved profile does not show exactly three delivered boards');
  // Recover the acknowledged op from the public panel event bridge and retain its immutable receipt.
  const operation = await page.evaluate(() => window.__qaWorkshopOpId || null);
  ensure(operation, 'workshop UI command receipt id was not observed');
  const operationId = economicOperationId('marea-negra', accountId, operation);
  operationIds.add(operationId);
  const receipt = await store.loadEconomicOperation(operationId);
  ensure(receipt?.request?.account === accountId && receipt.request.command?.type === 'artisan'
    && receipt.request.command?.op === 'contribute' && receipt.result?.ack?.ok === true
    && receipt.result.ack.workshop?.boards === 3, 'durable workshop receipt did not confirm three boards');
  check('ui_delivered_three_boards_and_durable_profile', { boards: saved.data.workshop.boards, planksRemaining: saved.data.eco.pack.goods.madera, profileVersion: saved.version });
  await page.locator('.workshop-panel [data-close]').click();

  // Use the in-game settings language picker so English is selected through the application UI.
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__mn.panels && document.querySelector('#pause') && !document.querySelector('#pause').hidden, 'pause settings open');
  await page.locator('#pause [data-locale="en"]').click();
  await page.locator('#pause #btn-resume').click();
  await waitFor(page, () => document.querySelector('#pause')?.hidden === true, 'settings resumed');
  await page.setViewportSize({ width: 390, height: 844 });
  await waitFor(page, () => window.__mn?.client?.joined && window.__mn.st.mode === 'playing', 'portrait session remains connected');
  await page.keyboard.press('f');
  await waitFor(page, () => !document.querySelector('.workbench-panel')?.hidden, 'portrait workbench open');
  await page.locator('.workbench-panel .community-trigger').filter({ hasText: /Taller y mochila|Workshop and backpack/ }).click();
  await waitFor(page, () => window.__mn.panels.artisan.active, 'portrait workshop open');
  await assertPanelFits(page, 390, 844, 'en'); await capture(page, '02-workshop-portrait-en');
  const persistedBeforeReload = await store.loadProfile(accountId);
  ensure(persistedBeforeReload?.data?.workshop?.boards === 3 && (persistedBeforeReload.data.eco.pack.goods.madera || 0) === 0,
    'three-board profile changed before reconnect');
  await page.reload({ waitUntil: 'commit', timeout: 90000 });
  await waitFor(page, () => !!window.__mn && !document.querySelector('#btn-play')?.disabled, 'reload ready', 90000);
  await page.locator('.account-open').click();
  await waitFor(page, () => { const s = document.querySelector('.account-signed'); return s && !s.hidden; }, 'persisted auth session after reload', 60000);
  await page.locator('.account-ready').click();
  await waitFor(page, () => window.__mn?.client?.joined && window.__mn.client.profile?.workshop?.boards === 3,
    'three boards restored after UI reconnect', 60000);
  const reconnectIdentity = await page.evaluate(() => window.__mn.client.profile?.pirateId);
  ensure(reconnectIdentity === `account:${accountId}`, 'reconnect restored a different account');
  await waitFor(page, () => window.__mn.st.mode === 'playing' && !window.__mn.st.boarding, 'reconnect boarding complete');
  const reconnect = await store.loadProfile(accountId);
  ensure(reconnect?.data?.workshop?.boards === 3 && (reconnect.data?.eco?.pack?.goods?.madera || 0) === 0,
    'authoritative profile did not retain three boards after reconnect');
  check('reload_and_ui_auth_restore_three_boards', { boards: reconnect.data.workshop.boards, planksRemaining: reconnect.data.eco.pack.goods.madera, profileVersion: reconnect.version });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(network.consoleErrors, []);
  assert.deepEqual(network.requestFailures, []); assert.deepEqual(network.httpFailures, []);
  ensure(network.websockets.some(x => x.startsWith('wss://')), 'public WSS missing from browser evidence');
  check('browser_network_clean', { pageErrors: 0, consoleErrors: 0, requestFailures: 0, httpFailures: 0,
    expectedGmDenials: network.expectedDenials.length, expectedStaleGmCheckCancellations: network.expectedCancellations.length,
    publicWss: true });
}
async function cleanup() {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (!accountId) return;
  let drained = false; const deadline = Date.now() + 30000;
  while (!drained && Date.now() < deadline) {
    const response = await fetch(url('/status'), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    ensure(response.ok, 'cleanup stopped: public storage status unavailable');
    const state = (await response.json()).storage;
    drained = state?.profileWrites === 0 && state?.unsaved === 0 && state?.economic?.pending === 0;
    if (!drained) await sleep(500);
  }
  ensure(drained, 'cleanup stopped: profile writes have not drained');
  const auth = unwrap(await admin.auth.admin.getUserById(accountId));
  ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === authMarker,
    'cleanup stopped: exact Auth marker mismatch');
  const row = await store.loadProfile(accountId);
  if (row) {
    ensure(row.data?.pirateId === `account:${accountId}`
      && (row.data?.workshop?.boards === 0 && row.data?.eco?.pack?.goods?.madera === 3
        || row.data?.workshop?.boards === 3 && (row.data?.eco?.pack?.goods?.madera || 0) === 0),
    'cleanup stopped: profile marker/state mismatch');
    const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id'));
    ensure(deleted.length === 1 && deleted[0].player_id === accountId, 'cleanup profile deletion did not match exact account');
  }
  unwrap(await admin.auth.admin.deleteUser(accountId));
  ensure(await store.loadProfile(accountId) === null, 'disposable profile remains after Auth cleanup');
  let retained = 0;
  for (const id of operationIds) if (await store.loadEconomicOperation(id)) retained++;
  ensure(retained === operationIds.size, 'cleanup stopped: acknowledged workshop receipt was not retained');
  evidence.cleanup = { temporaryAuthAndProfileRemoved: true, retainedReceiptCount: retained, receiptPolicy: 'operation receipts intentionally retained' };
}
try {
  await fs.promises.mkdir(out, { recursive: true });
  await preflight();
  const seed = await createAccount();
  const stored = await store.loadProfile(accountId);
  ensure(stored?.data?.pirateId === seed.pirateId && stored.data?.eco?.pack?.goods?.madera === 3, 'seed verification failed');
  const network = await launchBrowser();
  await runAcceptance(activePage, network);
  evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; provider details suppressed';
  if (activePage && !activePage.isClosed()) {
    await activePage.locator('input[name="email"], input[name="password"]').evaluateAll(nodes => nodes.forEach(node => { node.value = ''; })).catch(() => {});
    await activePage.screenshot({ path: path.join(out, `failure-${tag}.png`) })
      .then(() => evidence.screenshots.push(`failure-${tag}.png`)).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1; }
  evidence.completedAt = new Date().toISOString();
  await fs.promises.mkdir(out, { recursive: true });
  const evidencePath = path.join(out, `browser-${tag}.json`);
  await fs.promises.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(evidencePath, 0o600); } catch {}
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, screenshots: evidence.screenshots.length,
    gameVersion: evidence.gameVersion, protocolVersion: evidence.protocolVersion, cleanup: evidence.cleanup || null,
    failure: evidence.failure || evidence.cleanupFailure || null }));
}

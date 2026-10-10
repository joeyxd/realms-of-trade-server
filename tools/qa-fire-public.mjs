#!/usr/bin/env node
// Public TLS acceptance through normal game commands; seeds only a disposable profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { newFire } from '../src/sim/economy/fire.js';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const origin = 'https://marea.62.171.136.148.sslip.io';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'usage: node tools/qa-fire-public.mjs [--env-file PATH]';
const ensure = (value, reason) => { if (!value) throw new Error(reason); };
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

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
const store = storeFromEnv();
const out = path.resolve(process.env.MN_QA_OUT || 'docs/delivery/rnv04-fire-fuel/public');
const tag = randomUUID();
const email = `mn-fire-qa-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`;
let accountId = null, authMarker = `mnQaFirePublic:${tag}`, browser = null, activePage = null;
const operationIds = new Set();
const evidence = { schema: 'mn.fire.public.v1', at: new Date().toISOString(), target: origin,
  identity: 'random disposable Supabase user; credentials redacted', checks: [], screenshots: [], errors: [],
  protocol: PROTOCOL_VERSION, gameVersion: GAME.version };
const check = (name, data = {}) => {
  evidence.checks.push({ name, pass: true, ...data });
  console.log(JSON.stringify({ check: name, pass: true }));
};
const redact = value => String(value || '').replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\u0000', '[redacted-supabase-secret]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\u0000', '[redacted-supabase-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]')
  .replace(/((?:access_token|refresh_token|apikey|api_key|token|secret|password|code)=)[^&\s]+/gi, '$1[redacted]');
const redactUrl = value => {
  try {
    const parsed = new URL(value);
    for (const key of [...parsed.searchParams.keys()])
      if (/token|key|secret|auth|code|password/i.test(key)) parsed.searchParams.set(key, '[redacted]');
    parsed.username = ''; parsed.password = '';
    return redact(parsed.toString());
  } catch { return redact(value).replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]'); }
};
const unwrap = result => { if (!result || result.error) throw new Error('Supabase operation failed'); return result.data; };
const url = suffix => new URL(suffix, origin);

async function waitFor(page, predicate, label, timeout = 30000) {
  try { await page.waitForFunction(predicate, null, { timeout }); }
  catch { throw new Error(`bounded wait expired: ${label}`); }
}
async function publicPreflight() {
  const [healthResponse, statusResponse, authResponse, protocolResponse] = await Promise.all([
    fetch(url('/health'), { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch(url('/status'), { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch(url('/auth/config'), { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch(url('/src/net/protocol.js'), { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
  ]);
  ensure(healthResponse.ok && (await healthResponse.text()) === 'ok', 'public health check failed');
  const status = await statusResponse.json();
  ensure(statusResponse.ok && status.version === GAME.version && status.errors === 0
    && status.players === 0
    && status.storage?.durable === true && status.storage?.accounts === true
    && status.storage?.economic?.failed === false && status.storage?.economic?.enabled === true
    && status.storage?.fire?.enabled === true && status.storage?.fire?.ready === true
    && status.storage?.world?.ready === true && status.storage?.world?.failed === false
    && status.storage.errors === 0, 'public game version or durable account/economic health mismatch');
  const auth = await authResponse.json();
  ensure(authResponse.ok && auth.enabled === true
    && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin, 'public auth configuration mismatch');
  ensure(protocolResponse.ok && (await protocolResponse.text()).includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`),
    'deployed protocol version differs from local acceptance script');
  check('public_health_and_release', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION,
    realPlayers: status.players, fireEnabled: status.storage.fire.enabled, fireReady: status.storage.fire.ready,
    durable: status.storage.durable, accounts: status.storage.accounts, worldReady: status.storage.world.ready });
}
async function createSyntheticAccount() {
  const generated = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  const user = generated.user;
  ensure(user?.id, 'synthetic account creation failed'); accountId = user.id;
  ensure(user.email === email, 'synthetic Auth identity mismatch');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: authMarker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === authMarker, 'synthetic Auth identity marker mismatch');
  unwrap(await pub.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: 'signup' }));
  const profile = newProfile();
  profile.pirateId = `account:${accountId}`;
  profile.fire = newFire();
  profile.eco.pack.goods = { madera: 2 };
  ensure(sanitizeProfile(profile), 'synthetic fire profile rejected by sanitizer');
  const saved = await store.initializeProfile(accountId, profile);
  ensure(saved?.version === 1 && saved.data?.pirateId === `account:${accountId}`
    && saved.data?.eco?.pack?.goods?.madera === 2 && saved.data?.fire?.v === profile.fire.v,
  'synthetic profile seed did not persist');
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'synthetic account password login failed');
  return { token: login.session.access_token, profile };
}

async function runBrowser() {
  const sibling = path.resolve(repo, '..', 'realms-of-trade-server');
  const playwrightFile = path.resolve(process.env.MN_PLAYWRIGHT || path.join(sibling,
    '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
  const { chromium } = await import(pathToFileURL(playwrightFile).href);
  browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: path.resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
    headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  activePage = page;
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.__qaSocketCloses = [];
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener('close', event => window.__qaSocketCloses.push({ code: event.code, reason: event.reason, clean: event.wasClean }));
      }
    };
  });
  const consoleErrors = [], requestFailures = [], httpFailures = [], wsUrls = [], expectedDenials = [];
  const isGmDenial = (value, status) => {
    try { const parsed = new URL(value); return parsed.origin === origin && parsed.pathname === '/api/gm/session' && status === 403; }
    catch { return false; }
  };
  evidence.network = { consoleErrors, requestFailures, httpFailures, expectedDenials, websockets: wsUrls };
  page.on('pageerror', error => evidence.errors.push(redact(error?.stack || error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const source = message.location().url;
    if (isGmDenial(source, 403) && /403/.test(message.text())) return;
    consoleErrors.push({ text: redact(message.text()), source: redactUrl(source) });
  });
  page.on('requestfailed', request => requestFailures.push({ url: redactUrl(request.url()), error: redact(request.failure()?.errorText || '') }));
  page.on('response', response => {
    if (response.status() < 400) return;
    const item = { url: redactUrl(response.url()), status: response.status() };
    (isGmDenial(response.url(), response.status()) ? expectedDenials : httpFailures).push(item);
  });
  page.on('websocket', socket => wsUrls.push(redactUrl(socket.url())));
  await page.goto(`${origin}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
  console.log(JSON.stringify({ stage: 'public_document_loaded' }));
  await waitFor(page, () => !!window.__mn && !document.querySelector('#btn-play')?.disabled, 'game ready', 90000);
  await waitFor(page, () => window.__mn.transport.kind === 'ws' && !window.__mn.transport.closed
    && window.__mn.transport.ws?.readyState === 1 && window.__mn.transport.rtt > 0
    && !document.querySelector('.net-lost'), 'healthy public WSS before login');
  await page.locator('.account-open').click();
  await page.locator('.account-form input[name="email"]').fill(email);
  await page.locator('.account-form input[name="password"]').fill(password);
  await page.locator('.account-submit').click();
  await waitFor(page, () => { const signed = document.querySelector('.account-signed'); return signed && !signed.hidden; }, 'authenticated account');
  await page.locator('.account-ready').click();
  await waitFor(page, () => window.__mn?.st?.mode === 'playing' && window.__mn?.client?.joined
    && window.__mn?.client?.fire?.enabled === true, 'authenticated game and fire projection', 60000);
  await waitFor(page, () => !window.__mn.st.boarding && document.querySelector('#title')?.hidden
    && !document.querySelector('#hud')?.hidden, 'finished boarding transition');
  const installAckObserver = () => page.evaluate(() => {
    const bus = window.__mn.client.bus, emit = bus.emit.bind(bus);
    window.__qaFireAcks = [];
    bus.emit = (name, event) => { if (name === 'fire' && event?.type === 'fire') window.__qaFireAcks.push(event); return emit(name, event); };
  });
  await installAckObserver();
  const retainObservedReceipts = async () => {
    const ids = await page.evaluate(() => (window.__qaFireAcks || [])
      .filter(event => event?.ok === true && typeof event.opId === 'string').map(event => event.opId));
    for (const uiOpId of ids) operationIds.add(economicOperationId('marea-negra', accountId, uiOpId));
  };
  const admitted = await page.evaluate(() => ({ transport: window.__mn.transport.kind,
    fire: window.__mn.client.fire, accountId: window.__mn.client.profile?.pirateId,
    errors: [...window.__mn.errors] }));
  assert.equal(admitted.transport, 'ws');
  assert.equal(admitted.fire.enabled, true);
  assert.equal(admitted.accountId, `account:${accountId}`);
  assert.deepEqual(admitted.errors, []);
  await waitFor(page, () => {
    const mini = document.querySelector('.world-minimap');
    return Boolean(mini?.getClientRects().length && mini.querySelector('canvas')?.width === 192
      && mini.dataset.revision && mini.dataset.x && mini.dataset.z);
  }, 'rendered public minimap');
  check('rendered_public_minimap', { selector: '.world-minimap canvas', visible: true, size: 192 });
  ensure(wsUrls.some(value => value.startsWith('wss://')), 'authenticated session did not use public WSS');
  check('normal_login_and_wss_admission', { transport: admitted.transport, fireEnabled: admitted.fire.enabled,
    protocolVersion: PROTOCOL_VERSION, gameVersion: GAME.version, miniMapVisible: true });

  const capture = async label => {
    const name = `${label}.png`; await page.screenshot({ path: path.join(out, name) }); evidence.screenshots.push(name);
  };
  await capture('01-public-dark-minimap');
  // N opens the personal fire panel while dark, then the actual panel button pays one wood.
  await page.keyboard.press('n');
  await waitFor(page, () => window.__mn.panels.firePanel.active, 'hand torch panel open');
  await waitFor(page, () => !document.querySelector('.fire-load')?.disabled, 'hand torch load enabled');
  const controls = await page.locator('.fire-panel').evaluate(el => ({
    visible: !el.hidden && Boolean(el.getClientRects().length),
    panel: el.getBoundingClientRect().toJSON(), load: el.querySelector('.fire-load').getBoundingClientRect().toJSON(),
  }));
  assert.equal(controls.visible, true);
  assert.ok(controls.panel.x >= 0 && controls.panel.y >= 0 && controls.panel.right <= 1280 && controls.panel.bottom <= 720);
  assert.ok(controls.load.width >= 44 && controls.load.height >= 44);
  await capture('02-public-fire-panel');
  await page.locator('.fire-load').click();
  await waitFor(page, () => window.__mn.client.fire.slots.find(slot => slot.key === 'hand')?.lit === true
    && window.__mn.client.profile.eco.pack.goods.madera === 1, 'paid torch confirmation');
  const loadAck = await page.evaluate(() => [...window.__qaFireAcks].reverse()
    .find(event => event?.op === 'load' && event.ok));
  if (loadAck?.opId) operationIds.add(economicOperationId('marea-negra', accountId, loadAck.opId));
  assert.ok(loadAck, 'server did not confirm paid hand torch load');
  const fireState = await page.evaluate(() => ({ slot: window.__mn.client.fire.slots.find(row => row.key === 'hand'),
    wood: window.__mn.client.profile.eco.pack.goods.madera, coreLit: window.__mn.client.personalLantern,
    mapVisible: Boolean(document.querySelector('.world-minimap')?.getClientRects().length) }));
  assert.equal(fireState.wood, 1); assert.equal(fireState.slot.lit, true); assert.ok(fireState.slot.seconds > 0);
  await retainObservedReceipts();
  check('paid_hand_torch', { woodBefore: 2, woodAfter: fireState.wood, seconds: fireState.slot.seconds,
    acknowledged: !!loadAck, panelBounds: controls.panel, mapVisible: fireState.mapVisible });
  await capture('03-public-hand-torch-lit');

  await page.locator('.fire-close').click();
  await page.keyboard.press('n');
  await waitFor(page, () => window.__mn.client.fire.slots.find(slot => slot.key === 'hand')?.lit === false,
    'hand torch extinguish');
  const paused = await page.evaluate(() => window.__mn.client.fire.slots.find(row => row.key === 'hand'));
  assert.ok(paused.seconds > 0 && paused.seconds <= fireState.slot.seconds);
  await retainObservedReceipts();
  await sleep(1500);
  const pausedLater = await page.evaluate(() => window.__mn.client.fire.slots.find(row => row.key === 'hand'));
  assert.ok(pausedLater.seconds > 0 && pausedLater.seconds === paused.seconds,
    'extinguished torch fuel did not remain paused');
  await page.keyboard.press('n');
  await waitFor(page, () => window.__mn.client.fire.slots.find(slot => slot.key === 'hand')?.lit === true,
    'hand torch relight');
  await waitFor(page, () => window.__mn.client.profile.eco.pack.goods.madera === 1, 'exact remaining wood');
  const relit = await page.evaluate(() => window.__mn.client.fire.slots.find(row => row.key === 'hand'));
  assert.ok(relit.seconds > 0 && relit.seconds === pausedLater.seconds);
  await retainObservedReceipts();
  check('extinguish_and_relight_reuse_paid_fuel', { secondsOff: pausedLater.seconds,
    secondsRelit: relit.seconds, woodRemaining: 1 });
  await capture('04-public-hand-torch-relit');

  // Reload resets the handheld light; the stored fuel duration and remaining wood must persist.
  const reloadStartedAt = Date.now();
  await page.reload({ waitUntil: 'commit', timeout: 90000 });
  await waitFor(page, () => window.__mn && !document.querySelector('#btn-play')?.disabled, 'reload ready', 90000);
  await page.locator('.account-open').click();
  // The form can appear briefly before getSession restores the persisted account.
  await waitFor(page, () => {
    const signed = document.querySelector('.account-signed');
    return Boolean(signed && !signed.hidden);
  }, 'persisted authenticated session after reload');
  const authBranch = 'persisted-session';
  await page.locator('.account-ready').click();
  await waitFor(page, () => window.__mn?.client?.joined && window.__mn?.client?.fire?.enabled === true
    && window.__mn.client.fire.slots.find(slot => slot.key === 'hand')?.lit === false, 'persisted extinguished torch after reconnect', 60000);
  await waitFor(page, () => window.__mn.st.mode === 'playing' && !window.__mn.st.boarding
    && document.querySelector('#title')?.hidden && !document.querySelector('#hud')?.hidden,
  'finished reconnect boarding transition');
  await installAckObserver();
  const restored = await page.evaluate(() => ({ slot: window.__mn.client.fire.slots.find(row => row.key === 'hand'),
    wood: window.__mn.client.profile.eco.pack.goods.madera, account: window.__mn.client.profile.pirateId,
    errors: [...window.__mn.errors], transport: window.__mn.transport.kind }));
  const reloadElapsedSeconds = Math.floor((Date.now() - reloadStartedAt) / 1000);
  assert.equal(restored.wood, 1);
  assert.ok(restored.slot.seconds > 0 && restored.slot.seconds <= relit.seconds
    && restored.slot.seconds >= relit.seconds - reloadElapsedSeconds - 2,
  'remaining fire fuel changed beyond elapsed burn time during reload');
  assert.equal(restored.account, `account:${accountId}`); assert.equal(restored.transport, 'ws'); assert.deepEqual(restored.errors, []);
  await retainObservedReceipts();
  check('paid_fuel_and_exact_wood_after_reload', { authBranch, handheldLitAfterReload: restored.slot.lit,
    remainingSecondsBeforeReload: relit.seconds, reloadElapsedSeconds, restoredSeconds: restored.slot.seconds,
    woodRemaining: restored.wood, transport: restored.transport });
  await capture('05-public-hand-torch-reconnected');
  const relightAfterReloadAt = Date.now();
  await page.keyboard.press('n');
  await waitFor(page, () => window.__mn.client.fire.slots.find(slot => slot.key === 'hand')?.lit === true,
    'hand torch relight after reload');
  const relitAfterReload = await page.evaluate(() => ({ slot: window.__mn.client.fire.slots.find(row => row.key === 'hand'),
    wood: window.__mn.client.profile.eco.pack.goods.madera }));
  const relightElapsedSeconds = Math.floor((Date.now() - relightAfterReloadAt) / 1000);
  assert.ok(relitAfterReload.slot.seconds > 0 && relitAfterReload.slot.seconds <= restored.slot.seconds
    && relitAfterReload.slot.seconds >= restored.slot.seconds - relightElapsedSeconds - 1,
  'relighting spent fuel beyond elapsed burning time');
  assert.equal(relitAfterReload.wood, 1);
  await retainObservedReceipts();
  check('reload_relight_reuses_saved_fuel', { secondsBefore: restored.slot.seconds,
    secondsAfter: relitAfterReload.slot.seconds, elapsedSeconds: relightElapsedSeconds, woodRemaining: relitAfterReload.wood });
  await page.keyboard.press('m');
  await waitFor(page, () => window.__mn.panels.mapView.isOpen && !document.querySelector('#mapview')?.hidden, 'map open');
  const mapCanvas = await page.locator('#mapview canvas').evaluate(el => ({
    visible: Boolean(el.getClientRects().length), width: el.width, height: el.height,
  }));
  assert.deepEqual(mapCanvas, { visible: true, width: 640, height: 640 });
  check('public_mapview_visible', { selector: '#mapview canvas', ...mapCanvas });
  await capture('06-public-map');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(consoleErrors, []);
  assert.deepEqual(httpFailures, []); assert.deepEqual(requestFailures, []);
  check('browser_clean', { pageErrors: 0, consoleErrors: 0, failedRequests: 0, websocket: true,
    expectedNonGmCapabilityDenials: expectedDenials.length });
  await context.close();
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (!accountId) return;
  // Let the normal disconnect CAS settle before removing the disposable profile.
  let drained = false;
  const drainDeadline = Date.now() + 30000;
  while (!drained && Date.now() < drainDeadline) {
    const response = await fetch(url('/status'), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    ensure(response.ok, 'cleanup stopped: public storage status unavailable');
    const state = (await response.json()).storage;
    drained = state?.profileWrites === 0 && state?.unsaved === 0 && state?.economic?.pending === 0;
    if (!drained) await sleep(500);
  }
  ensure(drained, 'cleanup stopped: profile writes have not drained');
  const auth = unwrap(await admin.auth.admin.getUserById(accountId));
  ensure(auth.user?.email === email && auth.user?.user_metadata?.mn_qa_marker === authMarker,
    'cleanup stopped: Auth identity marker mismatch');
  const row = await store.loadProfile(accountId);
  if (row) {
    ensure(row.data?.pirateId === `account:${accountId}` && [1, 2].includes(row.data?.eco?.pack?.goods?.madera)
      && (row.data?.fire?.slots?.hand === undefined || row.data?.fire?.slots?.hand?.kind === 'handTorch'),
    'cleanup stopped: profile ownership/fuel sentinel mismatch');
    const deleted = await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id');
    unwrap(deleted); ensure(deleted.data?.length === 1 && deleted.data[0].player_id === accountId,
      'temporary profile cleanup did not match exact account');
  }
  unwrap(await admin.auth.admin.deleteUser(accountId));
  ensure(await store.loadProfile(accountId) === null, 'temporary profile remains after cleanup');
  // Economic receipts are immutable history. Confirm any observed operation IDs remain queryable.
  let retained = 0;
  for (const id of operationIds) if (await store.loadEconomicOperation(id)) retained++;
  ensure(retained === operationIds.size, 'cleanup stopped: an acknowledged economic receipt was not retained');
  evidence.cleanup = { temporaryAuthAndProfileRemoved: true, retainedReceiptCount: retained,
    receiptPolicy: 'operation receipts intentionally retained' };
}

try {
  await fs.promises.mkdir(out, { recursive: true });
  await publicPreflight();
  const { profile } = await createSyntheticAccount();
  const saved = await store.loadProfile(accountId);
  assert.equal(saved?.data?.pirateId, `account:${accountId}`);
  assert.equal(saved?.data?.eco?.pack?.goods?.madera, 2);
  assert.equal(saved?.data?.fire?.slots?.hand, undefined);
  await runBrowser();
  evidence.pass = true;
} catch (error) {
  evidence.pass = false;
  evidence.failure = error?.message ? redact(error.message) : 'acceptance failed; details suppressed';
  if (activePage && !activePage.isClosed()) {
    evidence.diagnostic = await activePage.evaluate(() => ({
      closes: window.__qaSocketCloses || [], netLost: !!document.querySelector('.net-lost'),
      transport: window.__mn?.transport?.kind, closed: window.__mn?.transport?.closed,
      mode: window.__mn?.st?.mode, errors: [...(window.__mn?.errors || [])],
      readyState: document.readyState, loadingText: document.querySelector('#fade')?.textContent?.slice(0, 200),
    })).catch(() => ({ unavailable: true }));
    evidence.diagnostic = JSON.parse(redact(JSON.stringify(evidence.diagnostic)));
    await activePage.screenshot({path:path.join(out,`failure-${tag}.png`)}).then(() => evidence.screenshots.push(`failure-${tag}.png`)).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) { evidence.pass = false; evidence.cleanupFailure = error?.message ? redact(error.message) : 'cleanup failed'; process.exitCode = 1; }
  evidence.completedAt = new Date().toISOString();
  await fs.promises.mkdir(out, { recursive: true });
  await fs.promises.writeFile(path.join(out, `public-${tag}.json`), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(path.join(out, `public-${tag}.json`), 0o600); } catch {}
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length,
    screenshotCount: evidence.screenshots.length, gameVersion: evidence.gameVersion,
    protocolVersion: evidence.protocol, cleanup: evidence.cleanup || null,
    failure: evidence.failure || evidence.cleanupFailure || null }));
}

#!/usr/bin/env node
// Bounded authenticated public acceptance through the real water/provisions UI.
// This browser canary consumes only one grog; it never fabricates a cooker or heat proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { meterValue } from '../src/data/survival.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const usage = 'node tools/qa-special-meals-browser-public.mjs --env-file PATH --out NEW_DIRECTORY';
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
ensure(process.env.MN_QA_ALLOW_PUBLIC === '1', 'explicit public QA guard required (MN_QA_ALLOW_PUBLIC=1)');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) ensure(process.env[key], 'private QA configuration unavailable');
ensure(GAME.version && Number.isSafeInteger(PROTOCOL_VERSION), 'local game/protocol metadata unavailable');

const out = path.resolve(outArg);
ensure(!fs.existsSync(out), 'output directory already exists; choose a new --out directory');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
const target = new URL(process.env.MN_FRESHWATER_TARGET || process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
ensure(target.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(target.hostname), 'public TLS target required');
const basePath = target.pathname.replace(/\/$/, ''); target.search = ''; target.hash = '';
const endpoint = suffix => new URL(`${basePath}${suffix}`, target);
const worldId = process.env.WORLD_ID || 'marea-negra';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, supabaseOptions);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, supabaseOptions);
const store = storeFromEnv();
const tag = randomUUID(), email = `mn-meals-ui-${tag}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`, marker = `mnQaSpecialMealsBrowser:${tag}`;
let accountId = null, browser = null, context = null, page = null;
const operationIds = new Set();
const verifiedReceiptIds = new Set();
const evidence = { schema: 'mn.special-meals.browser-public.v1', startedAt: new Date().toISOString(), target: target.origin,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, identity: 'random disposable Supabase user; credentials redacted',
  checks: [], screenshots: [], errors: [], consoleErrors: [], httpErrors: [], pass: false,
  scope: 'authenticated public water/provisions UI, one durable grog operation, localized desktop/mobile views, heat-block presentation, reload and reentry; no live heat or cooker proof' };
const redact = value => String(value || '')
  .replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\0', '[redacted-key]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\0', '[redacted-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]');
const unwrap = result => { if (!result || result.error) throw new Error('private account operation failed'); return result.data; };
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
  const [healthResponse, statusResponse, authResponse, protocolResponse] = await Promise.all(
    ['/health', '/status', '/auth/config', '/src/net/protocol.js'].map(route => fetch(endpoint(route), { cache: 'no-store', signal: timeout(15000) })));
  ensure(healthResponse.ok && await healthResponse.text() === 'ok' && statusResponse.ok && authResponse.ok && protocolResponse.ok,
    'public health/build/auth/protocol endpoints unavailable');
  const status = await statusResponse.json(), auth = await authResponse.json(), protocol = await protocolResponse.text();
  const storage = status.storage;
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && storage?.durable === true && storage?.accounts === true
    && storage?.economic?.enabled === true && storage.economic.failed === false && storage.economic.pending === 0
    && storage?.freshwater?.enabled === true && storage.freshwater.ready === true
    && storage.freshwater.canteen === true && storage.freshwater.meals === true
    && storage?.world?.id === worldId && storage.world.ready === true && storage.world.failed === false
    && storage?.unsaved === 0 && storage?.profileWrites === 0 && storage.errors === 0,
  'public build, idle gate, SQL035/readiness, feature activation, or world readiness preflight failed');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'public protocol differs from this checkout');
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin, 'public Auth configuration mismatch');
  check('public_build_protocol_sql035_meals_readiness_and_idle_gate', { gameVersion: status.version, protocolVersion: PROTOCOL_VERSION, worldId });
}
async function waitPage(fn, label, ms = 90000) {
  try { await page.waitForFunction(fn, null, { timeout: ms }); } catch { throw new Error(`bounded browser wait expired: ${label}`); }
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
async function login(contextOptions, label) {
  context = await browser.newContext(contextOptions);
  page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(redact(message.text())); });
  page.on('response', response => {
    if (response.status() < 400) return;
    try { const u = new URL(response.url()); evidence.httpErrors.push({ status:response.status(), origin:u.origin, path:u.pathname }); }
    catch { /* Do not retain query strings or credentials from malformed URLs. */ }
  });
  await page.goto(`${target.origin}${basePath}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
  await waitPage(() => window.__mn && !document.querySelector('#btn-play')?.disabled, `${label} client ready`);
  await page.locator('.account-open').click();
  await page.locator('.account-form input[name="email"]').fill(email);
  await page.locator('.account-form input[name="password"]').fill(password);
  await page.locator('.account-submit').click();
  await waitPage(() => { const node = document.querySelector('.account-signed'); return node && !node.hidden; }, `${label} normal password login`);
  await page.locator('.account-ready').click();
  await waitPage(() => window.__mn.client.joined && window.__mn.st.mode === 'playing'
    && window.__mn.client.freshwaterStatus?.mealsEnabled === true, `${label} authenticated world entry`);
  await waitPage(() => !window.__mn.st.boarding && document.querySelector('#title')?.hidden, `${label} boarding`);
  assert.equal(await page.evaluate(() => window.__mn.client.profile.pirateId), `account:${accountId}`);
}
async function openPanel(mobile = false) {
  if (mobile) {
    const button = page.locator('.t-water'); await button.waitFor({ state: 'visible' }); await button.click();
  } else await page.keyboard.press('u');
  const panel = page.locator('.freshwater-panel'); await panel.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => !window.__mn.panels.freshwaterPanel.pending);
  return panel;
}
async function setLocale(locale) {
  await page.evaluate(async value => (await import('/src/core/i18n.js')).setLocale(value), locale);
  await page.waitForTimeout(250);
  await page.evaluate(locale => { document.documentElement.lang = locale; }, locale);
}
async function capture(label, panel) {
  const file = `${label}.png`;
  await panel.screenshot({ path: path.join(out, file), animations: 'disabled' }); evidence.screenshots.push(file);
}
async function inspectMealPanel(locale, panel, mobile, form = mobile ? 'mobile' : 'desktop') {
  const card = page.locator('[data-meal-card="grog"]');
  assert.equal(await page.locator('.freshwater-panel').isVisible(), true);
  assert.equal(await page.locator('.fresh-meals').isVisible(), true, 'special-meals section is not visible');
  assert.equal(await card.isVisible(), true, 'grog recipe card is not visible');
  assert.equal(await card.locator('.fresh-meal-name').innerText(), 'Grog');
  assert.equal(await card.locator('.fresh-meal-cost').innerText(), locale === 'es' ? '1 ron + 1 agua' : '1 rum + 1 water');
  assert.equal(await card.locator('.fresh-meal-effect').innerText(), locale === 'es' ? '+25 % de recuperación de aguante' : '+25% stamina recovery');
  assert.equal(await card.locator('.fresh-meal-duration').innerText(), locale === 'es' ? '15 min' : '15 min');
  const fishHint = page.locator('[data-meal-card="roastFish"] .fresh-meal-hint');
  await fishHint.scrollIntoViewIfNeeded();
  assert.match(await fishHint.innerText(), locale === 'es' ? /fogata o parrilla propia encendida y cercana/i : /nearby lit campfire or grill of your own/i,
    'no-cooker heat block was not visible in the real panel');
  const bounds = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right,
    bottom:r.bottom, width:r.width, height:r.height, viewportWidth:innerWidth, viewportHeight:innerHeight,
    documentWidth:document.documentElement.scrollWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight, scrollTop:el.scrollTop }; });
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.viewportWidth && bounds.bottom <= bounds.viewportHeight
    && bounds.documentWidth <= bounds.viewportWidth, `${mobile ? 'mobile' : 'desktop'} panel overflowed viewport`);
  check(`real_panel_localized_${form}_${locale}_recipe_and_visible_heat_block`, { bounds });
  const prefix = `${form}-${locale}`;
  await capture(`${prefix}-heat-block`, panel);
  await card.scrollIntoViewIfNeeded();
  await capture(`${prefix}-grog-recipe`, panel);
}
async function verifyOperation(panel) {
  const before = await page.evaluate(() => structuredClone(window.__mn.client.profile));
  const requestStart = await page.evaluate(() => {
    const client = window.__mn.client; window.__qaMealRequests = [];
    const send = client.send.bind(client);
    client.send = message => { if (message.type === 'freshwater' && message.op === 'meal') window.__qaMealRequests.push(structuredClone(message)); return send(message); };
    return client.profile.eco.tradeRev;
  });
  assert.equal(requestStart, before.eco.tradeRev);
  const grog = page.locator('[data-meal="grog"]'); assert.equal(await grog.isEnabled(), true, 'grog should be available without heat');
  await grog.click();
  await waitPage(() => window.__qaMealRequests?.length >= 1, 'real grog command dispatch', 10000);
  const request = await page.evaluate(() => window.__qaMealRequests[0]);
  operationIds.add(request.opId);
  // The real panel retries the identical immutable command after one second. A durable
  // save can take longer, so count unique commands rather than rejecting its lawful retry.
  await waitPage(() => window.__qaMealRequests?.length >= 1
    && window.__mn.panels.freshwaterPanel.pending === null
    && window.__mn.client.profile.eco.tradeRev === window.__qaMealRequests[0].expectedRev + 1
    && window.__mn.client.profile.meal?.kind === 'grog'
    && window.__mn.client.freshwaterStatus?.meal?.kind === 'grog', 'accepted grog and authoritative UI state', 30000);
  const attempts = await page.evaluate(() => window.__qaMealRequests);
  for (const attempt of attempts) operationIds.add(attempt.opId);
  for (const attempt of attempts) assert.deepEqual(attempt, request, 'panel changed the retried immutable command');
  assert.equal(request.type, 'freshwater'); assert.equal(request.op, 'meal'); assert.equal(request.source, 'grog');
  assert.equal(request.expectedRev, before.eco.tradeRev); assert.equal(request.ship, ''); assert.equal(request.part, ''); assert.equal(request.n, 1);
  assert.equal(typeof request.opId, 'string'); assert.ok(request.opId.length >= 8); operationIds.add(request.opId);
  const live = await page.evaluate(() => structuredClone(window.__mn.client.profile));
  assert.equal(live.eco.tradeRev, before.eco.tradeRev + 1);
  assert.equal(live.meal?.v, 1); assert.equal(live.meal?.kind, 'grog'); assert.ok(live.meal.ticks > 0 && live.meal.ticks <= 54000);
  assert.equal(live.eco.pack.goods.ron, undefined); assert.equal(live.eco.pack.goods.agua, undefined);
  assert.equal(live.eco.pack.goods.pescado, 1, 'heat-only display ingredient was not consumed');
  const operationId = economicOperationId(worldId, accountId, request.opId);
  const receipt = await store.loadEconomicOperation(operationId);
  assert.ok(receipt?.result?.ok && receipt.request?.command?.opId === request.opId && receipt.request.before && receipt.request.profile,
    'durable meal receipt or its immutable transition profiles are missing');
  const receiptBefore = receipt.request.before, receiptAfter = receipt.request.profile;
  assert.equal(receiptBefore.eco.pack.goods.ron, 1); assert.equal(receiptBefore.eco.pack.goods.agua, 1);
  assert.equal(receiptBefore.eco.pack.goods.pescado, 1);
  assert.equal(receiptAfter.eco.pack.goods.ron, undefined); assert.equal(receiptAfter.eco.pack.goods.agua, undefined);
  assert.equal(receiptAfter.eco.pack.goods.pescado, 1);
  const expectedSat = meterValue(receiptBefore.surv.sat + 5), expectedHyd = meterValue(receiptBefore.surv.hyd + 55);
  assert.equal(receiptAfter.surv.sat, expectedSat); assert.equal(receiptAfter.surv.hyd, expectedHyd);
  assert.equal(receiptAfter.meal?.v, 1); assert.equal(receiptAfter.meal?.kind, 'grog'); assert.equal(receiptAfter.meal?.ticks, 54000);
  // The immutable receipt proves the exact atomic meter restoration. Live meters may drain while
  // the browser is open, so only allow a bounded decay below that receipt value.
  assert.ok(live.surv.sat <= expectedSat && live.surv.sat >= expectedSat - 0.5);
  assert.ok(live.surv.hyd <= expectedHyd && live.surv.hyd >= expectedHyd - 0.5);
  const stored = await store.loadProfile(accountId);
  assert.ok(Number.isSafeInteger(stored?.version) && stored.version > 1, 'profile save version did not advance');
  assert.equal(stored.data.pirateId, `account:${accountId}`);
  assert.equal(stored.data.eco.tradeRev, live.eco.tradeRev);
  assert.deepEqual(stored.data.eco.pack, live.eco.pack);
  assert.equal(stored.data.meal.kind, 'grog');
  assert.ok(stored.data.meal.ticks > 0 && stored.data.meal.ticks <= receiptAfter.meal.ticks
    && Math.abs(stored.data.meal.ticks - live.meal.ticks) < 600,
    'saved profile timer differs from the bounded committed countdown');
  assert.ok(stored.data.surv.sat >= expectedSat - 0.5 && stored.data.surv.sat <= expectedSat);
  assert.ok(stored.data.surv.hyd >= expectedHyd - 0.5 && stored.data.surv.hyd <= expectedHyd);
  const activeText = await page.locator('.fresh-meal-active').innerText(); assert.match(activeText, /15:|14:|13:/);
  verifiedReceiptIds.add(operationId);
  check('browser_clicked_grog_cost_effect_timer_trade_revision_saved_profile_and_receipt', {
    tradeRev: live.eco.tradeRev, initialReceiptTicks: receiptAfter.meal.ticks, savedMealTicks: stored.data.meal.ticks,
    dispatchAttempts:attempts.length, uniqueCommands:1, receiptRetained: true,
    profileVersion: stored.version, sat: stored.data.surv.sat, hyd: stored.data.surv.hyd });
  await capture('desktop-es-grog-active', panel);
  return { live, stored: stored.data, operationId };
}
async function rememberDispatches() {
  if (!page || page.isClosed()) return;
  const ids = await page.evaluate(() => (window.__qaMealRequests || []).map(request => request.opId));
  for (const id of ids) if (typeof id === 'string') operationIds.add(id);
}
async function reenterAndVerify(expected, panel) {
  await page.reload({ waitUntil: 'commit', timeout: 90000 });
  await waitPage(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'reloaded public client');
  await page.locator('.account-open').click();
  await waitPage(() => { const node = document.querySelector('.account-signed'); return node && !node.hidden; }, 'reloaded retained normal login');
  await page.locator('.account-ready').click();
  await waitPage(() => window.__mn.client.joined && window.__mn.client.profile?.meal?.kind === 'grog'
    && window.__mn.client.profile.meal.ticks > 0 && !window.__mn.st.boarding, 'authenticated reentry with active grog');
  const restored = await page.evaluate(() => structuredClone(window.__mn.client.profile));
  assert.deepEqual(restored.eco.pack, expected.stored.eco.pack);
  assert.equal(restored.eco.tradeRev, expected.stored.eco.tradeRev);
  assert.equal(restored.meal.kind, 'grog'); assert.ok(restored.meal.ticks > 0 && restored.meal.ticks <= expected.stored.meal.ticks);
  assert.ok(restored.surv.sat <= expected.stored.surv.sat && restored.surv.hyd <= expected.stored.surv.hyd);
  await setLocale('es');
  await openPanel(false);
  assert.match(await page.locator('.fresh-meal-active').innerText(), /\d{2}:\d{2}/);
  check('reload_and_authenticated_reentry_keep_saved_grog_active_without_recharging', {
    tradeRev: restored.eco.tradeRev, mealTicksAfterReentry: restored.meal.ticks });
  await capture('desktop-es-reentry-active', page.locator('.freshwater-panel'));
}

try {
  await publicPreflight();
  const created = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  // Marker first, then profile; cleanup only uses this immutable random marker/account pair.
  accountId = created.user?.id;
  ensure(accountId && created.user.email === email, 'disposable Auth user creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: marker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === marker, 'disposable Auth marker failed');
  unwrap(await pub.auth.verifyOtp({ token_hash: created.properties.hashed_token, type: 'signup' }));
  const profile = newProfile(); profile.pirateId = `account:${accountId}`; profile.lvl = 3;
  profile.eco.pack.goods = { ron: 1, agua: 1, pescado: 1 };
  profile.surv = { v: 1, sat: 40, hyd: 20 };
  const normalized = sanitizeProfile(profile);
  ensure(normalized?.lvl === 3 && normalized.eco.pack.goods.ron === 1 && normalized.eco.pack.goods.agua === 1
    && normalized.eco.pack.goods.pescado === 1 && normalized.surv.sat === 40 && normalized.surv.hyd === 20,
  'bounded disposable profile failed current sanitizer');
  const seeded = await store.initializeProfile(accountId, normalized);
  ensure(seeded?.version === 1 && seeded.data?.pirateId === `account:${accountId}`, 'disposable profile seed failed');
  check('marked_disposable_level_three_profile_seeded_with_bounded_recipe_ingredients');

  const playwrightFile = path.resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightFile).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await login({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, 'desktop');
  assert.equal(await page.evaluate(() => window.__mn.client.profile.pirateId), `account:${accountId}`);
  await setLocale('es');
  const desktopPanel = await openPanel(false);
  await inspectMealPanel('es', desktopPanel, false);
  const operation = await verifyOperation(desktopPanel);
  await setLocale('en');
  await inspectMealPanel('en', desktopPanel, false);
  await reenterAndVerify(operation, desktopPanel);
  assert.deepEqual(evidence.errors, [], 'public browser raised a page error');
  await context.close(); context = null; page = null;
  const idle = await waitIdle('desktop logout'); await assertIdle(idle, 'desktop logout');

  await login({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, 'mobile');
  await setLocale('es');
  const mobilePanel = await openPanel(true);
  await inspectMealPanel('es', mobilePanel, true);
  await setLocale('en');
  await inspectMealPanel('en', mobilePanel, true);
  const mobileProfile = await page.evaluate(() => window.__mn.client.profile);
  assert.equal(mobileProfile.meal?.kind, 'grog'); assert.equal(mobileProfile.eco.tradeRev, operation.live.eco.tradeRev);
  check('mobile_touch_reentry_sees_same_persisted_active_meal');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(350);
  await setLocale('es'); await inspectMealPanel('es', mobilePanel, true, 'mobile-landscape');
  await setLocale('en'); await inspectMealPanel('en', mobilePanel, true, 'mobile-landscape');
  assert.deepEqual(evidence.errors, [], 'public browser raised a page error');
  await context.close(); context = null; page = null;
  // A normal account is deliberately outside the GM allowlist. Keep those responses
  // visible in evidence and reject any unrelated HTTP or console failure.
  assert.ok(evidence.httpErrors.every(error => error.status === 403
    && error.origin === target.origin && error.path === `${basePath}/api/gm/session`), 'unexpected public HTTP failure');
  assert.equal(evidence.consoleErrors.length, evidence.httpErrors.length, 'unaccounted browser console error');
  assert.ok(evidence.consoleErrors.every(error => /^Failed to load resource: the server responded with a status of 403/.test(error)),
    'unexpected browser console error');
  check('public_network_only_expected_non_gm_session_denials', { expectedGmDenials: evidence.httpErrors.length });
  evidence.pass = true;
} catch (error) {
  if (page && !page.isClosed()) {
    try { evidence.failureState = await page.evaluate(() => ({
      requestAttempts:window.__qaMealRequests?.length ?? 0,
      uniqueOpIds:new Set((window.__qaMealRequests || []).map(r=>r.opId)).size,
      tradeRev:window.__mn?.client?.profile?.eco?.tradeRev ?? null,
      meal:window.__mn?.client?.profile?.meal ?? null,
      statusMeal:window.__mn?.client?.freshwaterStatus?.meal ?? null,
      pending:!!window.__mn?.panels?.freshwaterPanel?.pending,
    })); } catch { /* Preserve the original failure. */ }
  }
  evidence.pass = false; evidence.failure = redact(error?.message || 'public browser acceptance failed'); process.exitCode = 1;
} finally {
  try { await rememberDispatches(); } catch { /* Preserve the original browser failure. */ }
  try { await context?.close(); } catch { /* Keep cleanup moving. */ }
  try { await browser?.close(); } catch { /* Keep cleanup moving. */ }
  if (accountId) {
    try {
      const user = unwrap(await admin.auth.admin.getUserById(accountId));
      ensure(user.user?.email === email && user.user?.user_metadata?.mn_qa_marker === marker, 'cleanup stopped: disposable Auth marker mismatch');
      await waitIdle('disposable account disconnect');
      const row = await store.loadProfile(accountId);
      if (row) {
        ensure(row.data?.pirateId === `account:${accountId}`, 'cleanup stopped: disposable profile ownership sentinel mismatch');
        const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id'));
        ensure(deleted?.length === 1 && deleted[0].player_id === accountId, 'exact disposable profile deletion failed');
      }
      unwrap(await admin.auth.admin.deleteUser(accountId));
      ensure(await store.loadProfile(accountId) === null, 'disposable profile remains after cleanup');
      const afterDelete = await admin.auth.admin.getUserById(accountId);
      ensure(afterDelete.error, 'disposable Auth account remains after cleanup');
      // Inventory the exact disposable account, including receipts from a failed
      // browser wait. A dispatched attempt may legitimately have no durable row.
      const receipts = [];
      for (let offset = 0; ; offset += 100) {
        const rows = unwrap(await admin.from('mn_economic_operations').select('operation_id,request')
          .eq('request->>account', accountId).order('operation_id').range(offset, offset + 99));
        receipts.push(...rows); if (rows.length < 100) break;
        ensure(offset < 1000, 'disposable receipt inventory exceeded the bounded canary scope');
      }
      const observedIds = new Set([...operationIds].map(id => economicOperationId(worldId, accountId, id)));
      const retainedIds = new Set(receipts.map(row => row.operation_id));
      for (const row of receipts) ensure(row.request.account === accountId && row.request.world === worldId
        && observedIds.has(row.operation_id), 'unaccounted disposable economic receipt');
      for (const id of verifiedReceiptIds) ensure(retainedIds.has(id), 'verified economic meal receipt missing after disposable cleanup');
      evidence.cleanup = { markedAuthAndExactProfileRemoved: true, retainedEconomicReceipts: receipts.length,
        dispatchedUniqueCommands: operationIds.size, verifiedReceipts: verifiedReceiptIds.size,
        uncommittedDispatches: [...observedIds].filter(id => !retainedIds.has(id)).length,
        receiptPolicy: 'immutable economic receipts retained' };
    } catch (error) { evidence.pass = false; evidence.cleanupFailure = redact(error?.message || 'disposable cleanup failed'); process.exitCode = 1; }
  }
  evidence.completedAt = new Date().toISOString();
  const file = path.join(out, 'acceptance.json');
  try { fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); fs.chmodSync(file, 0o600); }
  catch { evidence.pass = false; evidence.outputFailure = 'new evidence file could not be written'; process.exitCode = 1; }
  try { await pub.auth.signOut(); } catch { /* Auth client has no persisted session. */ }
  console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, screenshots: evidence.screenshots.length,
    cleanup: evidence.cleanup || null, failure: evidence.failure || evidence.cleanupFailure || evidence.outputFailure || null,
    evidence: fs.existsSync(file) ? file : null }));
}
process.exitCode = evidence.pass ? 0 : 1;

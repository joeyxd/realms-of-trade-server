#!/usr/bin/env node
// Authenticated public acceptance for companion setup availability; no gameplay mutations or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

let envFile, out;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file') envFile = process.argv[++i];
  else if (process.argv[i] === '--out') out = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--help') {
    console.log('node tools/qa-companion-availability-public.mjs --env-file PATH --out NEW_DIRECTORY');
    process.exit(0);
  } else throw new Error('unknown argument');
}
if (envFile) process.loadEnvFile(path.resolve(envFile));
assert.equal(process.env.MN_QA_ALLOW_PUBLIC, '1', 'explicit public QA guard required');
assert.equal(PROTOCOL_VERSION, 55, 'review the public canary after protocol changes');
assert.ok(out && !fs.existsSync(out), 'new evidence directory required');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) assert.ok(process.env[key], 'private QA configuration unavailable');

const WORLD = process.env.WORLD_ID || 'marea-negra';
const target = new URL(process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
assert.equal(target.protocol, 'https:');
assert.equal(target.origin, 'https://marea.62.171.136.148.sslip.io', 'this canary is restricted to the public alpha');
const timeoutFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timeoutFetch } };
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, supabaseOptions);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, supabaseOptions);
const store = storeFromEnv();
const marker = `mnQaCompanionAvailability:${randomUUID()}`;
const email = `mn-companion-availability-${randomUUID()}@example.com`;
const password = `Aa1!${randomBytes(28).toString('base64url')}`;
const evidence = { schema: 'mn.companion-availability.public.v1', at: new Date().toISOString(), target: target.origin,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, world: WORLD,
  production: true, simulatedAuth: false, providerCalls: false, gameplayMutations: false,
  checks: [], screenshots: [], errors: [], pass: false };
const check = (name, detail = {}) => {
  evidence.checks.push({ name, pass: true, ...detail });
  console.log(JSON.stringify({ check: name, pass: true }));
};
const unwrap = result => {
  if (!result || result.error) throw new Error('private account operation failed');
  return result.data;
};
const redact = value => String(value)
  .replaceAll(email, '[redacted-email]')
  .replaceAll(password, '[redacted-secret]')
  .replaceAll(marker, '[redacted-marker]')
  .replaceAll(accountId || '[not-created]', '[redacted-account]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY, '[redacted-key]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY, '[redacted-key]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
  .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
  .replace(/(access_token|refresh_token|token_hash|hashed_token|token|password|apikey)([=:\s"%20]+)[^&\s"']+/gi, '$1$2[redacted]');
const bounded = async (promise, label, timeoutMs = 15000) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`bounded operation timed out: ${label}`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
};
let accountId, browser, context, page, chromium;
let gameSocketSeen = false, gameSocketClosed = false;

async function fetchJson(url, label) {
  const response = await bounded(timeoutFetch(url), label);
  const body = await bounded(response.json(), `${label} JSON`);
  return { response, body };
}
async function wait(fn, label, timeoutMs = 90000) {
  try { await page.waitForFunction(fn, null, { timeout: timeoutMs }); }
  catch { throw new Error(`bounded browser wait expired: ${label}`); }
}
async function capture(label) {
  const filename = `${label}.png`;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(out, filename) });
  evidence.screenshots.push(filename);
}
async function readInferenceSnapshot() {
  return page.evaluate(() => {
    const state = window.__mn?.panels?.companionsPanel?.inferenceEditor?.client?.snapshot?.();
    if (!state) return null;
    return { status: state.status, durable: state.durable, revision: state.head?.revision ?? null,
      configPresent: state.head ? state.head.config !== null : null,
      catalogCount: state.catalog?.length ?? null, characterCount: state.characters?.length ?? null };
  });
}
function assertEmptyInferenceSnapshot(snapshot) {
  assert.deepEqual(snapshot, { status: 'ready', durable: true, revision: 0, configPresent: false, catalogCount: 0, characterCount: 0 });
}
async function openInference() {
  await page.locator('.mn-inference-open').click();
  await wait(() => {
    const panel = document.querySelector('.mn-inference-config');
    return panel && !panel.hidden && panel.dataset.status === 'ready' && !document.querySelector('.mn-inference-config-availability')?.hidden;
  }, 'inference availability loaded');
  const response = await readInferenceSnapshot();
  assertEmptyInferenceSnapshot(response);
  assert.equal(await page.locator('.mn-inference-config-account-label').isVisible(), false);
  assert.equal(await page.locator('.mn-inference-config-account-ceiling').isDisabled(), true);
  assert.equal(await page.locator('.mn-inference-config-save').isVisible(), false);
  assert.equal(await page.locator('.mn-inference-config-connections-heading').isVisible(), false);
  assert.equal(await page.locator('.mn-inference-config-characters-heading').isVisible(), false);
  assert.equal(await page.locator('.mn-inference-config-back').isEnabled(), true);
  assert.equal(await page.locator('.mn-inference-config-reload').isEnabled(), true);
  return response;
}
async function checkMobileFit() {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector), rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      panel: box('.mn-companions-panel'), editor: box('.mn-inference-config') };
  });
}
function assertMobileFit(layout) {
  assert.ok(layout.documentWidth <= layout.viewport.width, JSON.stringify(layout));
  for (const [name, box] of [['panel', layout.panel], ['editor', layout.editor]]) {
    assert.ok(box.left >= -1 && box.right <= layout.viewport.width + 1, `${name} outside mobile viewport: ${JSON.stringify(layout)}`);
    assert.ok(box.scrollWidth <= box.clientWidth + 1, `${name} has horizontal overflow: ${JSON.stringify(layout)}`);
  }
  assert.ok(layout.panel.top < layout.viewport.height && layout.editor.top < layout.viewport.height,
    `mobile panel/editor start below viewport: ${JSON.stringify(layout)}`);
}

try {
  fs.mkdirSync(out, { recursive: true });
  const { response: statusResponse, body: status } = await fetchJson(new URL('/status', target), 'public status');
  assert.ok(statusResponse.ok && status.version === GAME.version && status.errors === 0, 'public alpha release is not healthy/current');
  assert.equal(status.storage?.durable, true); assert.equal(status.storage?.accounts, true);
  assert.equal(status.storage?.world?.id, WORLD);
  const { response: authResponse, body: authConfig } = await fetchJson(new URL('/auth/config', target), 'public auth config');
  assert.ok(authResponse.ok && authConfig.enabled === true);
  assert.equal(new URL(authConfig.url).origin, new URL(process.env.SUPABASE_URL).origin, 'public auth must match QA Supabase project');
  assert.deepEqual(await store.checkCompanionControl(), { version: 1 });
  assert.deepEqual(await store.checkInferenceConfig(), { version: 1 });
  check('public_alpha_and_durable_companion_config_readiness', { version: status.version, protocol: PROTOCOL_VERSION });

  const { data: created, error: createError } = await bounded(admin.auth.admin.generateLink({ type: 'signup', email, password }), 'temporary signup link');
  if (createError || !created?.user?.id || !created?.properties?.hashed_token) throw new Error('temporary account setup failed');
  accountId = created.user.id;
  unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: marker } }));
  unwrap(await pub.auth.verifyOtp({ token_hash: created.properties.hashed_token, type: 'signup' }));
  assert.equal(await store.loadProfile(accountId), null, 'temporary account must begin without a seeded game profile');
  check('temporary_verified_account_created_without_seed_profile');

  const playwrightPath = path.resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
  ({ chromium } = await import(pathToFileURL(playwrightPath).href));
  browser = await bounded(chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] }), 'launch headless Chrome', 30000);
  context = await browser.newContext({ locale: 'es-MX', viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(redact(error.message)));
  page.on('websocket', socket => {
    let isGameSocket = false;
    try {
      const socketUrl = new URL(socket.url());
      isGameSocket = socketUrl.protocol === 'wss:' && socketUrl.host === target.host && socketUrl.pathname.endsWith('/ws');
    }
    catch { /* Ignore non-game sockets. */ }
    if (!isGameSocket) return;
    gameSocketSeen = true;
    socket.on('close', () => { gameSocketClosed = true; });
  });

  await page.goto(`${target.origin}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
  await wait(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'client ready');
  await page.locator('.account-open').click();
  await page.locator('.account-form input[name="email"]').fill(email);
  await page.locator('.account-form input[name="password"]').fill(password);
  await page.locator('.account-submit').click();
  await wait(() => { const panel = document.querySelector('.account-signed'); return panel && !panel.hidden; }, 'real UI login');
  await page.locator('.account-ready').click();
  await wait(() => window.__mn.client.joined && window.__mn.st.mode === 'playing', 'authenticated world entry');
  await wait(() => !window.__mn.st.boarding && document.querySelector('#title')?.hidden, 'normal profile entry settles');
  assert.equal(gameSocketSeen, true);
  const liveProfile = await store.loadProfile(accountId);
  assert.ok(liveProfile?.data && liveProfile.version >= 1, 'host should create the ordinary profile');
  assert.equal(liveProfile.data.pirateId, `account:${accountId}`);
  check('real_login_and_host_created_normal_profile', { profileVersion: liveProfile.version });
  const active = await fetchJson(new URL('/status', target), 'connected session status');
  assert.ok(active.body.sockets >= 1 && active.body.players >= 1, 'authenticated player should be visible to host');

  await page.locator('.mn-companions-toggle').click();
  await page.waitForSelector('.mn-companions-panel:not([hidden])');
  await wait(() => window.__mn.companions.snapshot().status === 'ready', 'authenticated companion owner response');
  const companions = await page.evaluate(() => window.__mn.companions.snapshot());
  assert.equal(companions.enabled, false); assert.deepEqual(companions.companions, []);
  assert.match(await page.locator('.mn-companions-status').textContent(), /creaci[oó]n y conexi[oó]n.*no est[aá] habilitada|creation and connection are not enabled/i);
  assert.match(await page.locator('.mn-companions-setup').first().textContent(), /volver al juego.*URL.*crear un compañero|return to the game.*URL.*create a companion/i);
  await capture('01-authenticated-no-companion-setup-desktop-es');
  check('authenticated_owner_sees_server_setup_unavailable_es');

  const emptyLoad = await openInference();
  assert.match(await page.locator('.mn-inference-config-availability').textContent(), /conexi[oó]n.*pendiente|no tiene conexiones disponibles/i);
  assert.match(await page.locator('.mn-inference-config-availability').textContent(), /no puedes a[nñ]adir una URL ni crear un compa[nñ]ero/i);
  await capture('02-authenticated-inference-unavailable-desktop-es');
  check('inference_center_reports_empty_durable_head_and_no_catalog_es', { revision: emptyLoad.revision });

  await page.locator('.mn-inference-config-reload').click();
  await wait(() => document.querySelector('.mn-inference-config')?.dataset.status === 'ready' &&
    !document.querySelector('.mn-inference-config-reload')?.disabled, 'read-only reload');
  await page.locator('.mn-inference-config-back').click();
  await wait(() => document.querySelector('.mn-inference-config').hidden, 'back to companion panel');
  await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mn-inference-open').click();
  await wait(() => document.querySelector('.mn-inference-config')?.dataset.status === 'ready' &&
    !document.querySelector('.mn-inference-config-availability')?.hidden, 'English mobile availability');
  await wait(() => window.__mn?.panels?.companionsPanel?.inferenceEditor?.client?.snapshot?.().status === 'ready', 'English inference state ready');
  const latest = await readInferenceSnapshot();
  assertEmptyInferenceSnapshot(latest);
  assert.match(await page.locator('.mn-inference-config-availability').textContent(), /model connection pending|no available connections/i);
  assert.match(await page.locator('.mn-inference-config-availability').textContent(), /cannot add a URL or create a companion/i);
  const layout = await checkMobileFit(); assertMobileFit(layout);
  check('authenticated_inference_unavailable_mobile_en_no_horizontal_overflow', { viewport: layout.viewport });
  await capture('03-authenticated-inference-unavailable-mobile-en');

  assert.deepEqual(await page.evaluate(() => [...window.__mn.errors]), [], 'no game runtime errors');
  assert.equal(evidence.errors.length, 0, 'no browser page errors');
  check('authenticated_browser_runtime_and_page_errors_empty');
  evidence.pass = true;
} catch (error) {
  evidence.pass = false;
  evidence.errors.push(redact(error.stack || error));
  console.error(redact(error.message));
} finally {
  // Observe the close handshake while the page is alive; closing its context first can
  // discard Playwright's socket-close event before the host finishes saving this session.
  if (gameSocketSeen && !gameSocketClosed && page && !page.isClosed()) {
    try {
      const transportReady = await page.evaluate(() => {
        const transport = window.__mn?.transport;
        if (transport?.kind !== 'ws' || !transport.ws) return false;
        transport.close();
        return true;
      });
      if (transportReady) {
        await page.waitForFunction(() => window.__mn.transport.ws.readyState === WebSocket.CLOSED,
          null, { timeout: 15000 });
        gameSocketClosed = true;
      } else {
        // A failed boot can create a socket before exposing __mn. Navigating this
        // page away closes only its connection and leaves its close event observable.
        await page.goto('about:blank', { waitUntil: 'commit', timeout: 15000 });
        for (let attempt = 0; attempt < 30 && !gameSocketClosed; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(gameSocketClosed, 'temporary pre-boot socket close was not observed');
      }
    } catch (error) {
      evidence.pass = false;
      evidence.errors.push(`session close: ${redact(error.message)}`);
    }
  }
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (evidence.errors.length) evidence.pass = false;

  if (accountId) {
    try {
      const current = unwrap(await admin.auth.admin.getUserById(accountId));
      assert.equal(current.user.user_metadata?.mn_qa_marker, marker, 'temporary account marker must match before cleanup');
      let profileBeforeDelete = await bounded(store.loadProfile(accountId), 'check temporary profile before cleanup');
      let settlement = { sessionClosed: !gameSocketSeen };
      if (profileBeforeDelete) assert.ok(profileBeforeDelete.data?.pirateId === `account:${accountId}`, 'temporary profile identity changed');
      if (profileBeforeDelete || gameSocketSeen) {
        let previousSignature = null, stableReads = 0, settled = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          const loaded = await bounded(store.loadProfile(accountId), 'settle temporary profile');
          if (loaded) assert.ok(loaded.data?.pirateId === `account:${accountId}`, 'temporary profile identity changed');
          profileBeforeDelete = loaded;
          const { body: health } = await fetchJson(new URL('/status', target), 'cleanup status');
          const storage = health.storage || {};
          // Host.onClose can defer profiles.close while economic work is pending.
          const writesIdle = storage.unsaved === 0 && storage.profileWrites === 0 && storage.economic?.pending === 0;
          const signature = JSON.stringify(loaded);
          stableReads = signature === previousSignature ? stableReads + 1 : 0;
          previousSignature = signature;
          const socketSettled = !gameSocketSeen || gameSocketClosed;
          if (socketSettled && stableReads >= 2 && writesIdle) {
            settlement = { sessionClosed: true, stableProfileReads: stableReads + 1,
              unsaved: storage.unsaved, profileWrites: storage.profileWrites, economicPending: storage.economic.pending };
            settled = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.ok(settled, 'temporary session/profile did not settle before cleanup');
      }
      if (profileBeforeDelete) {
        // Delete only the exact profile after the account marker and any created session are confirmed.
        const deletedProfiles = unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId).select('player_id'));
        assert.ok(Array.isArray(deletedProfiles) && deletedProfiles.length === 1 && deletedProfiles[0].player_id === accountId,
          'exact temporary profile row was not deleted');
      }
      unwrap(await admin.auth.admin.deleteUser(accountId));
      const profileAfter = await bounded(store.loadProfile(accountId), 'verify profile cleanup');
      const authAfter = await bounded(admin.auth.admin.getUserById(accountId), 'verify auth cleanup');
      evidence.cleanup = { ...settlement, markerMatchedBeforeDelete: true, profileDeleted: profileAfter === null,
        authDeleted: Boolean(authAfter?.error && authAfter.error.status === 404) };
      assert.ok(evidence.cleanup.profileDeleted && evidence.cleanup.authDeleted, 'temporary account cleanup verification failed');
    } catch (error) {
      evidence.pass = false;
      evidence.errors.push(`cleanup: ${redact(error.stack || error)}`);
    }
  }

  if (out && fs.existsSync(out)) {
    try { fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n'); }
    catch (error) { evidence.pass = false; console.error(`evidence write failed: ${redact(error.message)}`); }
  }
}

console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, screenshots: evidence.screenshots.length,
  cleanup: evidence.cleanup || null }));
process.exitCode = evidence.pass ? 0 : 1;

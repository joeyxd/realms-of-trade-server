// Real browser acceptance for the in-game owner companion panel. All identities are local fixtures.
// This script writes evidence only; review the PNGs and JSON before accepting the UX.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '66666666-6666-4666-8666-666666666666';
const GUEST = '77777777-7777-4777-8777-777777777777';
const OUTPUT = resolve(process.env.MN_COMPANIONS_QA_OUTPUT || 'docs/delivery/l03d-owner-center');
const root = resolve('.');
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
await mkdir(OUTPUT, { recursive: true });

const resolvePlayer = async (_req, hello) => ({
  'owner-fixture': OWNER,
  'other-fixture': OTHER,
  'guest-fixture': GUEST,
  'agent-fixture': CHARACTER,
}[hello.token] ?? null);
const binding = (ownerId, characterId) => ({ ownerId, characterId, capabilities: ['move', 'aim', 'attack_pve'] });
function createFixture({ controls = true, pilot = true } = {}) {
  return createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {},
    store: createMemoryStore(), resolvePlayer, worldId: 'companions-browser-fixture', saveSecret: 'companions-browser-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_companions_fixture' },
    ...(controls ? { agentControl: { worldId: 'companions-browser-fixture', bindings: [binding(OWNER, CHARACTER), binding(OTHER, OTHER_CHARACTER)] } } : {}),
    ...(controls && pilot ? { agentPilot: { maxAgents: 1 } } : {}),
  });
}

const game = createFixture();
const port = await game.listen();
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { schema: 'l03d-companions-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, production: false, checks: [], screenshots: [], errors: [], fixtures: {
    owner: OWNER, companion: CHARACTER, other: OTHER, otherCompanion: OTHER_CHARACTER,
  } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error('Timed out waiting for companion browser fixture state');
}

async function check(name, fn) {
  await fn(); evidence.checks.push(name); console.log(`PASS ${name}`);
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(OUTPUT, name), fullPage: false }); evidence.screenshots.push(name);
}
async function setup(context, { accountId = OWNER, token = 'owner-fixture', signedIn = true } = {}) {
  await context.addInitScript(({ accountId, token, signedIn }) => {
    let listener;
    let session = signedIn ? { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } } : null;
    window.__mnFixtureAuth = {
      signOut() { session = null; listener?.('SIGNED_OUT', null); },
      signIn() { session = { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } }; listener?.('SIGNED_IN', session); },
    };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (callback) => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => { window.__mnFixtureAuth.signOut(); return { error: null }; },
    } }) };
  }, { accountId, token, signedIn });
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' :
      (process.env.MN_GSAP || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/gsap-local/package'), match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(file) });
  });
}

async function openGame(context, { width = 1440, height = 900, gameOrigin = origin } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.on('pageerror', (error) => evidence.errors.push(error.stack || error.message));
  await page.goto(`${gameOrigin}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && window.__mn.companions &&
    !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  return page;
}
async function play(page) {
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await page.waitForSelector('.mn-companions-toggle');
}
async function openPanel(page) {
  await page.locator('.mn-companions-toggle').click();
  await page.waitForFunction(() => __mn.companions.snapshot().status === 'ready' ||
    ['error', 'signed_out', 'offline'].includes(__mn.companions.snapshot().status));
  await page.waitForSelector('.mn-companions-panel:not([hidden])');
}
async function joinAgent() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  socket.on('message', (data) => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
  socket.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: 'agent-fixture', agent: true,
    name: 'Brisa', skin: 0, weapon: 0 }));
  const untilWelcome = Date.now() + 10000;
  while (Date.now() < untilWelcome && !messages.some((message) => message.t === MSG.WELCOME || message.t === MSG.ERROR)) await sleep(20);
  assert.equal(messages.find((message) => [MSG.WELCOME, MSG.ERROR].includes(message.t))?.t, MSG.WELCOME,
    `fixture agent must join: ${JSON.stringify(messages.slice(-3))}`);
  return socket;
}

let disabledGame = null, guestGame = null;
let ownerContext, otherContext, guestContext, unboundContext, mobileContext;
try {
  const agent = await joinAgent();
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } }); ownerContext = owner;
  await setup(owner, { accountId: OWNER, token: 'owner-fixture' });
  const ownerPage = await openGame(owner); await play(ownerPage); await openPanel(ownerPage);
  await check('authenticated_owner_sees_only_owned_live_companion_and_public_name', async () => {
    const state = await ownerPage.evaluate(() => __mn.companions.snapshot());
    assert.equal(state.status, 'ready'); assert.equal(state.enabled, true);
    assert.deepEqual(state.companions.map((row) => row.characterKey), [CHARACTER]);
    assert.equal(state.companions[0].name, 'Brisa [IA]'); assert.equal(state.companions[0].online, true);
    assert.equal(state.companions[0].active, true);
    assert.equal(JSON.stringify(state).includes(OWNER), false);
    assert.equal(JSON.stringify(state).includes('sessionId'), false);
  });
  await shot(ownerPage, 'companions-es-active.png');
  await check('toggle_keyboard_escape_and_focus_return', async () => {
    const toggle = ownerPage.locator('.mn-companions-toggle');
    await toggle.focus(); await ownerPage.keyboard.press('Enter');
    assert.equal(await ownerPage.locator('.mn-companions-panel').isHidden(), true);
    assert.equal(await toggle.evaluate((node) => node === document.activeElement), true);
    await ownerPage.keyboard.press('Space');
    await ownerPage.waitForFunction(() => document.activeElement?.matches('.mn-companions-close'));
    await ownerPage.waitForFunction(() => !document.querySelector('.mn-companions-refresh').disabled &&
      __mn.companions.snapshot().status === 'ready');
    await ownerPage.keyboard.press('Tab');
    await ownerPage.waitForFunction(() => document.activeElement?.matches('.mn-companions-refresh'));
    await ownerPage.keyboard.press('Tab');
    await ownerPage.waitForFunction(() => document.activeElement?.matches('.mn-companions-stop'));
    await ownerPage.keyboard.press('Tab');
    await ownerPage.waitForFunction(() => document.activeElement?.matches('.mn-companions-close'));
    await ownerPage.keyboard.press('Shift+Tab');
    await ownerPage.waitForFunction(() => document.activeElement?.matches('.mn-companions-stop'));
    await ownerPage.keyboard.press('Escape');
    await ownerPage.waitForFunction(() => document.querySelector('.mn-companions-panel').hidden);
    assert.equal(await ownerPage.locator('.mn-companions-panel').isHidden(), true);
    assert.equal(await toggle.evaluate((node) => node === document.activeElement), true);
  });
  await ownerPage.locator('.mn-companions-toggle').click();
  await ownerPage.waitForSelector('.mn-companions-panel:not([hidden])');
  await ownerPage.evaluate(() => { document.documentElement.lang = 'en'; });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companions-panel h2')?.textContent === 'My companions');
  const activeEpoch = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0].epoch);
  await ownerPage.locator('.mn-companions-stop').click();
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.stopped === true);
  await check('stop_revokes_server_grant_and_updates_owner_projection', async () => {
    const state = await ownerPage.evaluate(() => __mn.companions.snapshot());
    const serverState = game.game.agentControl.byCharacter(CHARACTER);
    assert.equal(state.companions[0].active, false); assert.equal(state.companions[0].stopped, true);
    assert.equal(serverState.state, 'revoked'); assert.equal(serverState.task, null);
    const socketId = [...game.game.sockets.values()].find((s) => s.agentIdentity === CHARACTER)?.id;
    assert.equal(game.game.agentControl.authorize(socketId, state.companions[0].epoch), false);
  });
  await shot(ownerPage, 'companions-en-stopped.png');
  const staleStop = await ownerPage.evaluate((epoch) => new Promise((resolve) => {
    const requestId = `browser-stale-${Date.now()}`;
    const transport = __mn.transport;
    const timer = setTimeout(() => {
      transport.msgCbs = transport.msgCbs.filter((listener) => listener !== callback);
      resolve({ timeout: true });
    }, 7000);
    const callback = (message) => {
      if (message?.t !== 'agent_owner_result' || message.requestId !== requestId) return;
      clearTimeout(timer);
      transport.msgCbs = transport.msgCbs.filter((listener) => listener !== callback);
      resolve({ ok: message.ok, why: message.why, active: message.companions?.[0]?.active });
    };
    transport.onMessage(callback);
    transport.send({ t: 'agent_owner', requestId, op: 'stop', characterKey: '33333333-3333-4333-8333-333333333333', epoch });
  }), activeEpoch);
  await check('stale_epoch_stop_is_rejected_after_revocation', async () => {
    assert.equal(staleStop.ok, false); assert.equal(staleStop.why, 'stale_control'); assert.equal(staleStop.active, false);
    assert.equal(game.game.agentControl.byCharacter(CHARACTER).state, 'revoked');
  });

  const stale = await ownerPage.evaluate(async () => {
    const controller = __mn.companions;
    const current = controller.snapshot().companions[0];
    return new Promise((resolve) => {
      const transport = __mn.transport;
      const send = transport.send.bind(transport);
      transport.send = (message) => {
        if (message?.t === 'agent_owner' && message.op === 'list') {
          transport.send = send;
          setTimeout(() => send(message), 700);
        } else send(message);
      };
      controller.refresh();
      setTimeout(() => { window.__mnFixtureAuth.signOut(); resolve(current); }, 40);
    });
  });
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().status === 'signed_out');
  await sleep(900);
  await check('logout_clears_rows_and_ignores_delayed_list_response', async () => {
    const state = await ownerPage.evaluate(() => __mn.companions.snapshot());
    assert.equal(state.status, 'signed_out'); assert.deepEqual(state.companions, []);
    assert.equal(JSON.stringify(state).includes(CHARACTER), false);
    assert.ok(stale.characterKey === CHARACTER);
  });

  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } }); otherContext = other;
  await setup(other, { accountId: OTHER, token: 'other-fixture' });
  const otherPage = await openGame(other); await play(otherPage); await openPanel(otherPage);
  await check('second_owner_sees_only_their_offline_binding', async () => {
    const rows = await otherPage.evaluate(() => __mn.companions.snapshot().companions);
    assert.deepEqual(rows.map((row) => row.characterKey), [OTHER_CHARACTER]);
    assert.equal(rows[0].online, false); assert.equal(rows[0].active, false);
    assert.equal(JSON.stringify(rows).includes(CHARACTER), false);
  });

  const unbound = await browser.newContext({ viewport: { width: 1440, height: 900 } }); unboundContext = unbound;
  await setup(unbound, { accountId: GUEST, token: 'guest-fixture' });
  const unboundPage = await openGame(unbound); await play(unboundPage); await openPanel(unboundPage);
  await check('authenticated_unbound_account_gets_valid_empty_owned_list', async () => {
    const state = await unboundPage.evaluate(() => __mn.companions.snapshot());
    assert.equal(state.status, 'ready'); assert.equal(state.enabled, true); assert.deepEqual(state.companions, []);
  });
  await unbound.close(); unboundContext = null;

  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } }); guestContext = guest;
  await setup(guest, { accountId: GUEST, token: 'guest-fixture', signedIn: false });
  guestGame = createFixture({ pilot: false });
  const guestPort = await guestGame.listen();
  const guestPage = await openGame(guest, { gameOrigin: `http://127.0.0.1:${guestPort}` });
  await guestPage.locator('.account-open').click();
  await guestPage.locator('.account-guest').click();
  await play(guestPage); await openPanel(guestPage);
  await check('actual_guest_has_no_companion_authority_or_rows', async () => {
    const state = await guestPage.evaluate(() => __mn.companions.snapshot());
    assert.equal(state.status, 'signed_out'); assert.deepEqual(state.companions, []);
    assert.equal(await guestPage.locator('.mn-companions-stop').count(), 0);
  });
  await shot(guestPage, 'companions-guest.png');

  await otherPage.evaluate(() => __mn.transport.close());
  await otherPage.waitForFunction(() => ['offline', 'signed_out'].includes(__mn.companions.snapshot().status));
  await waitUntil(() => ![...game.game.profiles.clients.values()].some((session) => session.key === OTHER));
  await other.close(); otherContext = null;
  const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }); mobileContext = mobile;
  await setup(mobile, { accountId: OTHER, token: 'other-fixture' });
  const mobilePage = await openGame(mobile, { width: 844, height: 390 }); await play(mobilePage); await openPanel(mobilePage);
  await check('mobile_panel_fits_viewport_and_keeps_stop_reachable', async () => {
    await mobilePage.waitForFunction(() => {
      const rect = document.querySelector('.mn-companions-panel')?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
        rect.right <= innerWidth && rect.bottom <= innerHeight;
    });
    const bounds = await mobilePage.locator('.mn-companions-panel').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 844 && bounds.y + bounds.height <= 390,
      JSON.stringify(bounds));
    const rows = await mobilePage.evaluate(() => __mn.companions.snapshot().companions);
    assert.deepEqual(rows.map((row) => row.characterKey), [OTHER_CHARACTER]);
    assert.equal(rows[0].online, false); assert.equal(rows[0].stopped, false);
    assert.equal(await mobilePage.locator('.mn-companions-stop').count(), 1);
  });
  await shot(mobilePage, 'companions-mobile.png');
  await check('mobile_offline_binding_can_be_stopped_and_keyboard_reached', async () => {
    const stop = mobilePage.locator('.mn-companions-stop');
    assert.equal(await stop.count(), 1);
    await stop.focus();
    await mobilePage.waitForFunction(() => document.activeElement?.matches('.mn-companions-stop'));
    await stop.click();
    await mobilePage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.stopped === true);
  });
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await check('portrait_rotated_stage_keeps_panel_on_screen', async () => {
    await mobilePage.waitForFunction(() => {
      const panel = document.querySelector('.mn-companions-panel');
      if (!panel || panel.hidden) return false;
      const rect = panel.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
        rect.right <= innerWidth && rect.bottom <= innerHeight;
    });
  });
  await shot(mobilePage, 'companions-mobile-portrait.png');

  disabledGame = createFixture({ controls: false });
  const disabledPort = await disabledGame.listen();
  const disabledContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(disabledContext, { accountId: OWNER, token: 'owner-fixture' });
  const disabledPage = await disabledContext.newPage();
  disabledPage.on('pageerror', (error) => evidence.errors.push(error.stack || error.message));
  await disabledPage.goto(`http://127.0.0.1:${disabledPort}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await disabledPage.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
  await disabledPage.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await play(disabledPage); await openPanel(disabledPage);
  await check('disabled_host_reports_honest_unconfigured_empty_state', async () => {
    const state = await disabledPage.evaluate(() => __mn.companions.snapshot());
    assert.equal(state.status, 'ready'); assert.equal(state.enabled, false); assert.deepEqual(state.companions, []);
    assert.match(await disabledPage.locator('.mn-companions-status').textContent(), /configur|desactiv/i);
  });
  await shot(disabledPage, 'companions-disabled-host.png');

  await check('disconnect_clears_state_without_client_errors', async () => {
    await ownerPage.close();
    await mobilePage.evaluate(() => __mn.transport.close());
    await mobilePage.waitForFunction(() => ['offline', 'signed_out'].includes(__mn.companions.snapshot().status));
    assert.deepEqual(await mobilePage.evaluate(() => __mn.companions.snapshot().companions), []);
    for (const page of [guestPage, mobilePage, disabledPage])
      assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
  });
  agent.close();
  await Promise.all([owner.close(), otherContext?.close(), guest.close(), unboundContext?.close(), mobile.close(), disabledContext.close()]);
} catch (error) {
  evidence.errors.push(error.stack || String(error)); process.exitCode = 1;
} finally {
  await writeFile(resolve(OUTPUT, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close(); await game.close(); await guestGame?.close(); await disabledGame?.close();
}

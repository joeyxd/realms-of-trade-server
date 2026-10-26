// Focused browser acceptance for the durable owner stop/resume control.
// Auth is simulated; gameplay profiles use memory; only SQL027 companion control is disk-backed here.
// Evidence is local and does not claim production, public, provider, or gameplay-save durability.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryCompanionConfigMethods, createSupabaseCompanionConfigMethods } from '../server/companionConfigStore.mjs';
import { createSupabaseCompanionControlMethods } from '../server/companionControlStore.mjs';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '66666666-6666-4666-8666-666666666666';
const WORLD = 'companion-control-browser-fixture';
const OUTPUT = resolve(process.env.MN_COMPANION_CONTROL_QA_OUTPUT || 'docs/delivery/l03d-companion-control');
const angle = process.env.MN_COMPANION_CONTROL_QA_ANGLE || 'default';
assert.ok(['default', 'swiftshader'].includes(angle), 'QA ANGLE must be default or swiftshader');
const migration = await readFile(new URL('../server/migrations/027_companion_control.sql', import.meta.url), 'utf8');
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);

const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitUntil(predicate, timeoutMs = 10000, label = 'fixture state') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(25); }
  throw new Error(`Timed out waiting for ${label}`);
}

function rpcFor(db, faults) {
  return async (name, args = {}) => {
    try {
      if (name === 'mn_companion_control_ready') {
        return { data: (await db.query('select public.mn_companion_control_ready() as data')).rows[0].data, error: null };
      }
      if (name === 'mn_load_companion_control') {
        if (faults.failNextLoad) { faults.failNextLoad = false; throw new Error('injected storage read failure'); }
        return { data: (await db.query('select public.mn_load_companion_control($1,$2::uuid,$3::uuid) as data',
          [args.p_world, args.p_owner, args.p_character])).rows[0].data, error: null };
      }
      if (name === 'mn_save_companion_control') {
        if (faults.failNextSave) { faults.failNextSave = false; throw new Error('injected storage write failure'); }
        return { data: (await db.query('select public.mn_save_companion_control($1,$2::uuid,$3::uuid,$4,$5) as data',
          [args.p_world, args.p_owner, args.p_character, args.p_expected_revision, args.p_stopped])).rows[0].data, error: null };
      }
      throw new Error('unexpected control RPC');
    } catch { return { data: null, error: { code: 'XX000', message: 'local SQL fixture failure' } }; }
  };
}

const resolvePlayer = async (_req, hello) => ({ 'owner-fixture': OWNER, 'other-fixture': OTHER, 'agent-fixture': CHARACTER }[hello.token] ?? null);
const binding = (ownerId, characterId) => ({ ownerId, characterId, capabilities: ['move', 'aim', 'attack_pve'] });
function createFixture({ port = 0, faults, db } = {}) {
  const sqlMethods = createSupabaseCompanionControlMethods({ rpc: rpcFor(db, faults) });
  const store = { ...createMemoryStore(), ...createMemoryCompanionConfigMethods(), ...sqlMethods, durable: true };
  return createGameServer({ port, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {},
    store, resolvePlayer, worldId: WORLD, saveSecret: 'companion-control-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_companion_control_fixture' },
    agentControl: { worldId: WORLD, bindings: [binding(OWNER, CHARACTER), binding(OTHER, OTHER_CHARACTER)] },
    agentPilot: { maxAgents: 1 }, companionControlAllowMemory: true, companionConfigAllowMemory: true,
  });
}

async function localCDNroutes(context) {
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' :
      (process.env.MN_GSAP || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/gsap-local/package'), match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}

async function setupAuth(context, { accountId, token }) {
  await context.addInitScript(({ accountId, token }) => {
    let listener;
    let session = { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } };
    window.__mnFixtureAuth = { signOut() { session = null; listener?.('SIGNED_OUT', null); } };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => { window.__mnFixtureAuth.signOut(); return { error: null }; },
    } }) };
  }, { accountId, token });
  await localCDNroutes(context);
}

const diagnostics = [];
async function openGame(context, origin, viewport = null) {
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  const diag = { pageErrors: [], consoleErrors: [], failedRequests: [] }; diagnostics.push(diag);
  page.on('pageerror', error => { diag.pageErrors.push(error.stack || error.message); evidence.errors.push(error.stack || error.message); });
  page.on('console', message => { if (message.type() === 'error') diag.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => diag.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  await page.goto(`${origin}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn?.companions && !document.querySelector('#btn-play')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await page.waitForSelector('.mn-companions-toggle');
  return page;
}

async function openPanel(page) {
  await page.locator('.mn-companions-toggle').click();
  await page.waitForFunction(() => ['ready', 'error', 'signed_out', 'offline'].includes(__mn.companions.snapshot().status));
  await page.waitForSelector('.mn-companions-panel:not([hidden])');
}

async function joinAgent(port, timeoutMs = 8000) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
  socket.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((ok, fail) => { socket.once('open', ok); socket.once('error', fail); });
  socket.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: 'agent-fixture', agent: true, name: 'Brisa', skin: 0, weapon: 0 }));
  await waitUntil(() => messages.some(message => message.t === MSG.WELCOME || message.t === MSG.ERROR), timeoutMs, 'runner welcome/rejection');
  return { socket, welcome: messages.find(message => message.t === MSG.WELCOME || message.t === MSG.ERROR), messages };
}

async function rawOwner(page, operation) {
  const requestId = `browser-control-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return page.evaluate(({ requestId, operation }) => new Promise(resolve => {
    const transport = __mn.transport;
    const timer = setTimeout(() => resolve({ timeout: true }), 8000);
    const listener = message => {
      if (message?.t !== 'agent_owner_result' || message.requestId !== requestId) return;
      clearTimeout(timer);
      transport.msgCbs = transport.msgCbs.filter(callback => callback !== listener);
      resolve(message);
    };
    transport.onMessage(listener);
    transport.send({ t: 'agent_owner', requestId, ...operation });
  }), { requestId, operation: { ...operation, t: 'agent_owner', requestId } });
}

const evidence = {
  schema: 'l03d-companion-control-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, public: false, production: false, gameplayMemory: true, gameplayDurabilityVerified: false,
  storage: { migration: 'SQL027', durableInFixture: true, database: 'PGlite disk directory', controlStore: 'createSupabaseCompanionControlMethods RPC adapter' },
  rendering: { browser: 'Chrome headless', angle, gpuRunRequested: false },
  checks: [], screenshots: [], errors: [], fixtures: { owner: OWNER, companion: CHARACTER, other: OTHER, otherCompanion: OTHER_CHARACTER, world: WORLD },
};
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function screenshot(page, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: resolve(OUTPUT, name), fullPage: false });
  evidence.screenshots.push(name);
}
async function panelGeometry(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.mn-companions-panel');
    const rect = panel.getBoundingClientRect();
    const controls = [...panel.querySelectorAll('button')].filter(button => !button.closest('[hidden]'));
    return { viewport: { width: innerWidth, height: innerHeight }, panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      controls: controls.map(button => { const r = button.getBoundingClientRect(); return { label: button.textContent.trim(), width: r.width, height: r.height }; }),
      panelScroll: { clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, overflowY: getComputedStyle(panel).overflowY } };
  });
}
function assertPanelInViewport(layout) {
  const { width, height } = layout.viewport, panel = layout.panel;
  assert.ok(panel.left >= -1 && panel.top >= -1 && panel.right <= width + 1 && panel.bottom <= height + 1, JSON.stringify(layout));
  assert.ok(layout.controls.every(control => control.height >= 44), `touch targets below 44px: ${JSON.stringify(layout.controls)}`);
}

let tempPath = null, tempCanonical = null, db = null, game = null, browser = null;
let ownerContext = null, otherContext = null, ownerPage = null, otherPage = null, agent = null;
const faults = { failNextSave: false, failNextLoad: false };
let port = null, origin = null, controlMethods = null;
try {
  await mkdir(OUTPUT, { recursive: true });
  const tempBase = await realpath(tmpdir()), prefix = 'mn-companion-control-qa-';
  const { mkdtemp } = await import('node:fs/promises');
  tempPath = await mkdtemp(join(tempBase, prefix));
  tempCanonical = await realpath(tempPath);
  assert.equal(tempCanonical, tempPath, 'temporary SQL path must be the directory created by this run');
  assert.ok(basename(tempCanonical).startsWith(prefix), 'temporary SQL path prefix mismatch');
  assert.ok(resolve(tempCanonical).startsWith(`${resolve(tempBase)}${sep}`), 'temporary database escaped the OS temp root');

  db = new PGlite(join(tempCanonical, 'db'));
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  await db.exec(migration);
  await db.exec('SET ROLE service_role');
  controlMethods = createSupabaseCompanionControlMethods({ rpc: rpcFor(db, faults) });
  assert.deepEqual(await controlMethods.checkCompanionControl(), { version: 1 });
  game = createFixture({ db, faults });
  port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', `--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist', ...(angle === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : [])] });

  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(ownerContext, { accountId: OWNER, token: 'owner-fixture' });
  ownerPage = await openGame(ownerContext, origin); await openPanel(ownerPage);
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.control?.status === 'ready');
  await check('missing_SQL_row_is_default_stopped_and_owner_can_allow_connection', async () => {
    const state = await ownerPage.evaluate(() => __mn.companions.snapshot());
    assert.equal(state.companions.length, 1); assert.equal(state.companions[0].stopped, true);
    assert.deepEqual(state.companions[0].control, { status: 'ready', revision: 0, stopped: true, savedAt: null });
    assert.equal(await ownerPage.locator('.mn-companions-resume').count(), 1);
    assert.match(await ownerPage.locator('.mn-companions-details').textContent(), /Stopped by default|Detenido por defecto/);
    assert.doesNotMatch(await ownerPage.locator('.mn-companions-details').textContent(), /Saved stop|Detención guardada/);
    assert.equal(await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER }).then(head => head.revision), 0);
  });
  await screenshot(ownerPage, 'control-default-stopped-es.png');

  await ownerPage.locator('.mn-companions-resume').click();
  await ownerPage.waitForFunction(() => {
    const row = __mn.companions.snapshot().companions[0];
    return row?.control?.status === 'ready' && row.control.revision === 1 && row.control.stopped === false && row.stopped === false;
  });
  let saved = await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER });
  await check('resume_ack_has_canonical_SQL_timestamp_and_opens_fresh_runner_join', async () => {
    assert.equal(saved.revision, 1); assert.equal(saved.stopped, false);
    assert.ok(Number.isFinite(Date.parse(saved.savedAt)), 'raw SQL timestamp must parse');
    const joined = await joinAgent(port); assert.equal(joined.welcome.t, MSG.WELCOME); agent = joined.socket;
    await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.active === true);
    const state = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0]);
    assert.equal(state.control.revision, 1);
    assert.equal(new Date(state.control.savedAt).toISOString(), state.control.savedAt, 'wire projection must be canonical ISO');
    assert.equal(state.control.savedAt, new Date(saved.savedAt).toISOString(), 'wire timestamp must represent the SQL head');
    assert.equal(game.game.agentControl.byCharacter(CHARACTER).state, 'active');
  });

  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companions-title')?.textContent === 'My companions' || document.querySelector('.mn-companions-panel h2')?.textContent === 'My companions');
  await check('desktop_English_control_copy_and_keyboard_focus_trap_escape', async () => {
    const close = ownerPage.locator('.mn-companions-close'), refresh = ownerPage.locator('.mn-companions-refresh');
    await close.focus(); await ownerPage.keyboard.press('Shift+Tab');
    assert.equal(await ownerPage.evaluate(() => document.activeElement.matches('[data-control-op="stop"], [data-control-op="resume"]')), true);
    await ownerPage.keyboard.press('Tab'); await ownerPage.waitForFunction(() => document.activeElement?.matches('.mn-companions-close'));
    await ownerPage.keyboard.press('Escape'); await ownerPage.waitForFunction(() => document.querySelector('.mn-companions-panel').hidden);
    await ownerPage.locator('.mn-companions-toggle').click(); await ownerPage.waitForSelector('.mn-companions-panel:not([hidden])');
    assert.equal(await refresh.textContent(), 'Refresh');
    assert.deepEqual(await ownerPage.evaluate(() => [...__mn.errors]), []);
  });

  await ownerPage.locator('[data-control-op="stop"]').click();
  await ownerPage.waitForFunction(() => {
    const row = __mn.companions.snapshot().companions[0];
    return row?.control?.status === 'ready' && row.control.revision === 2 && row.control.stopped === true && row.stopped === true;
  });
  saved = await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER });
  await check('durable_stop_advances_SQL_head_and_revokes_grant', async () => {
    assert.equal(saved.revision, 2); assert.equal(saved.stopped, true); assert.ok(Number.isFinite(Date.parse(saved.savedAt)), 'raw SQL timestamp must parse');
    const projected = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0].control);
    assert.equal(new Date(projected.savedAt).toISOString(), projected.savedAt, 'stop ACK timestamp must be canonical ISO');
    assert.equal(projected.savedAt, new Date(saved.savedAt).toISOString(), 'stop ACK timestamp must represent the SQL head');
    const managed = game.game.agentControl.byCharacter(CHARACTER);
    assert.equal(managed.state, 'revoked'); assert.equal(managed.task, null);
  });
  await screenshot(ownerPage, 'control-stopped-en.png');
  if (agent?.readyState === WebSocket.OPEN) { agent.close(); agent = null; }
  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await ownerPage.waitForFunction(() => window.__mn?.companions && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
  await ownerPage.locator('#btn-play').click({ force: true });
  await ownerPage.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await openPanel(ownerPage);
  await check('page_reload_keeps_confirmed_stop_and_removes_stale_local_runner', async () => {
    const row = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0]);
    assert.equal(row.control.revision, 2); assert.equal(row.control.stopped, true); assert.equal(row.stopped, true);
    assert.equal(new Date(row.control.savedAt).toISOString(), row.control.savedAt, 'reloaded wire timestamp must be canonical ISO');
    assert.equal(row.active, false); assert.equal(await ownerPage.locator('.mn-companions-resume').count(), 1);
  });

  const otherContextTemp = await browser.newContext({ viewport: { width: 1440, height: 900 } }); otherContext = otherContextTemp;
  await setupAuth(otherContext, { accountId: OTHER, token: 'other-fixture' });
  otherPage = await openGame(otherContext, origin); await openPanel(otherPage);
  await check('second_owner_projection_isolated_and_cross_owner_resume_forbidden', async () => {
    const rows = await otherPage.evaluate(() => __mn.companions.snapshot().companions);
    assert.deepEqual(rows.map(row => row.characterKey), [OTHER_CHARACTER]);
    const denial = await rawOwner(otherPage, { op: 'resume', characterKey: CHARACTER, epoch: null, expectedRevision: 2 });
    assert.equal(denial.ok, false); assert.equal(denial.why, 'forbidden');
    assert.deepEqual((await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER })), saved);
  });

  await ownerPage.locator(`[data-config-key="${CHARACTER}"]`).click();
  await ownerPage.waitForSelector('.mn-companion-config:not([hidden])');
  await check('existing_private_profile_editor_opens_and_back_returns_to_control_panel', async () => {
    await ownerPage.locator('.mn-companion-config-back').click();
    await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config').hidden && !document.querySelector('.mn-companions-panel').hidden);
    assert.equal(await ownerPage.locator('.mn-companions-resume').count(), 1);
  });

  for (const viewport of [{ name: 'landscape-844x390', width: 844, height: 390 }, { name: 'portrait-390x844', width: 390, height: 844 }]) {
    await ownerPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await ownerPage.waitForFunction(() => {
      const r = document.querySelector('#stage').getBoundingClientRect();
      return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.top >= -1;
    });
    await ownerPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await panelGeometry(ownerPage); assertPanelInViewport(geometry);
    evidence.geometry ||= []; evidence.geometry.push({ name: viewport.name, ...geometry });
    if (viewport.name.startsWith('portrait')) await screenshot(ownerPage, 'control-portrait-390x844.png');
    else await screenshot(ownerPage, 'control-landscape-844x390.png');
  }
  await check('landscape_and_portrait_panel_bounds_and_44px_targets', async () => {
    assert.equal(evidence.geometry.length, 2);
    for (const geometry of evidence.geometry) assertPanelInViewport(geometry);
  });

  await ownerPage.setViewportSize({ width: 1440, height: 900 });
  // Force one SQL write to fail after the host has applied its immediate local stop latch.
  await ownerPage.locator('.mn-companions-resume').click();
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.control?.status === 'ready' &&
    __mn.companions.snapshot().companions[0]?.control?.stopped === false && __mn.companions.snapshot().companions[0]?.stopped === false);
  agent = (await joinAgent(port)).socket;
  await ownerPage.locator('.mn-companions-refresh').click();
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().status === 'ready' &&
    __mn.companions.snapshot().companions[0]?.active === true);
  faults.failNextSave = true;
  await ownerPage.locator('[data-control-op="stop"]').click();
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().message === 'unavailable');
  await ownerPage.locator('.mn-companions-refresh').click();
  await ownerPage.waitForFunction(() => {
    const state = __mn.companions.snapshot(), row = state.companions[0];
    return state.status === 'ready' && row?.stopped === true && row.control?.status === 'ready' && row.control.stopped === false;
  });
  await check('failed_stop_stays_uncertain_until_explicit_refresh_then_offers_both_choices', async () => {
    const row = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0]);
    assert.equal(row.stopped, true); assert.equal(row.control.stopped, false); assert.equal(row.control.revision, 3);
    assert.equal(await ownerPage.locator('[data-control-op="stop"]').textContent(), 'Confirm stop');
    assert.equal(await ownerPage.locator('.mn-companions-resume').textContent(), 'Allow connection');
    assert.equal(await ownerPage.locator('[data-control-op="stop"]').isDisabled(), false);
    assert.equal(await ownerPage.locator('.mn-companions-resume').isDisabled(), false);
  });
  await screenshot(ownerPage, 'control-unconfirmed-stop.png');
  await ownerPage.locator('[data-control-op="stop"]').click();
  await ownerPage.waitForFunction(() => {
    const row = __mn.companions.snapshot().companions[0];
    return row?.control?.status === 'ready' && row.control.revision === 4 && row.control.stopped === true;
  });

  // A failed explicit read makes the control unavailable; direct resume is still rejected by the host.
  faults.failNextLoad = true;
  await ownerPage.locator('.mn-companions-refresh').click();
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.control?.status === 'unavailable');
  const refused = await rawOwner(ownerPage, { op: 'resume', characterKey: CHARACTER,
    epoch: await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0].epoch), expectedRevision: 4 });
  await check('unavailable_control_denies_resume_and_runner_join', async () => {
    assert.equal(refused.ok, false); assert.equal(refused.why, 'unavailable');
    assert.equal(await ownerPage.locator('.mn-companions-resume').count(), 0);
    assert.equal((await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER })).revision, 4);
    const attempt = await joinAgent(port); assert.equal(attempt.welcome.t, MSG.ERROR); attempt.socket.close();
  });

  await ownerPage.evaluate(() => window.__mnFixtureAuth.signOut());
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().status === 'signed_out');
  await check('logout_clears_durable_projection_and_private_identity', async () => {
    const state = await ownerPage.evaluate(() => __mn.companions.snapshot());
    assert.deepEqual(state.companions, []); assert.equal(JSON.stringify(state).includes(CHARACTER), false);
  });
  for (const diag of diagnostics) assert.deepEqual(diag.pageErrors, []);
  evidence.diagnostics = diagnostics;

  await otherContext.close(); otherContext = null;
  await ownerContext.close(); ownerContext = null; ownerPage = null;
  if (agent?.readyState === WebSocket.OPEN) { agent.close(); agent = null; }
  await game.close(); game = null;
  await db.close(); db = null;
  db = new PGlite(join(tempCanonical, 'db')); await db.exec('SET ROLE service_role');
  controlMethods = createSupabaseCompanionControlMethods({ rpc: rpcFor(db, faults) });
  const persisted = await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER });
  await check('SQL027_disk_database_reopens_with_confirmed_revision_four_stop', async () => {
    assert.equal(persisted.revision, 4); assert.equal(persisted.stopped, true); assert.ok(Number.isFinite(Date.parse(persisted.savedAt)), 'reopened SQL timestamp must parse');
  });

  // Rebuild the game host on the same loopback port against the reopened SQL file.
  game = createFixture({ port, db, faults }); await game.listen();
  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(ownerContext, { accountId: OWNER, token: 'owner-fixture' });
  ownerPage = await openGame(ownerContext, origin); await openPanel(ownerPage);
  await check('reconstructed_host_hydrates_saved_stop_and_fails_closed_before_owner_action', async () => {
    const row = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0]);
    assert.equal(row.control.status, 'ready'); assert.equal(row.control.revision, 4); assert.equal(row.control.stopped, true);
    assert.equal(new Date(row.control.savedAt).toISOString(), row.control.savedAt, 'restarted wire timestamp must be canonical ISO');
    assert.equal(row.stopped, true); assert.equal(await ownerPage.locator('.mn-companions-resume').count(), 1);
  });
  const deniedRunner = await joinAgent(port); assert.equal(deniedRunner.welcome.t, MSG.ERROR); deniedRunner.socket.close();
  await ownerPage.locator('.mn-companions-resume').click();
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.control?.revision === 5 &&
    __mn.companions.snapshot().companions[0]?.stopped === false);
  agent = (await joinAgent(port)).socket;
  await check('post_restart_owner_resume_updates_sql_head_and_new_runner_joins', async () => {
    const head = await controlMethods.loadCompanionControl({ world: WORLD, owner: OWNER, character: CHARACTER });
    assert.equal(head.revision, 5); assert.equal(head.stopped, false); assert.ok(Number.isFinite(Date.parse(head.savedAt)), 'raw SQL timestamp must parse');
    const row = await ownerPage.evaluate(() => __mn.companions.snapshot().companions[0]);
    assert.equal(new Date(row.control.savedAt).toISOString(), row.control.savedAt, 'resumed wire timestamp must be canonical ISO');
    assert.equal(row.control.savedAt, new Date(head.savedAt).toISOString(), 'resumed wire timestamp must represent the SQL head');
    await ownerPage.waitForFunction(() => __mn.companions.snapshot().companions[0]?.active === true);
  });

  evidence.diagnostics = diagnostics;
} catch (error) {
  if (ownerPage && !ownerPage.isClosed()) {
    try { evidence.failureState = await ownerPage.evaluate(() => __mn.companions.snapshot()); } catch {}
  }
  evidence.errors.push(error.stack || String(error)); process.exitCode = 1;
} finally {
  try { if (agent && agent.readyState !== WebSocket.CLOSED) agent.close(); } catch {}
  try { await Promise.all([ownerContext?.close(), otherContext?.close()]); } catch {}
  try { await browser?.close(); } catch {}
  try { await game?.close(); } catch {}
  try { await db?.close(); } catch {}
  if (tempPath && tempCanonical) {
    try {
      const base = await realpath(tmpdir()), current = await realpath(tempPath);
      assert.equal(current, tempCanonical, 'cleanup path must still resolve to this script-owned temp directory');
      assert.ok(basename(current).startsWith('mn-companion-control-qa-'), 'cleanup prefix mismatch');
      assert.ok(resolve(current).startsWith(`${resolve(base)}${sep}`), 'cleanup target escaped OS temp root');
      await rm(current, { recursive: true, force: true });
    } catch (error) { evidence.errors.push(`temporary database cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

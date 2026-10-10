// Browser acceptance for private, durable companion personality/goals.
// Uses local fixture auth, a real local game/WSS, and SQL025 in a private temp database.
// Evidence describes simulated auth and does not claim gameplay durability or public acceptance.
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
import { createSupabaseCompanionConfigMethods } from '../server/companionConfigStore.mjs';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '66666666-6666-4666-8666-666666666666';
const WORLD = 'companion-config-browser-fixture';
const OUTPUT = resolve(process.env.MN_COMPANION_CONFIG_QA_OUTPUT || 'docs/delivery/l03d-companion-config');
const migration = await readFile(new URL('../server/migrations/025_companion_config.sql', import.meta.url), 'utf8');
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitUntil(predicate, timeoutMs = 10000, message = 'Timed out waiting for fixture state') {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await predicate()) return; await sleep(25); }
  throw new Error(message);
}

function rpcFor(db) {
  return async (name, args = {}) => {
    const calls = {
      mn_companion_config_ready: () => db.query('select public.mn_companion_config_ready() as data'),
      mn_load_companion_config: () => db.query('select public.mn_load_companion_config($1,$2::uuid,$3::uuid) as data',
        [args.p_world, args.p_owner, args.p_character]),
      mn_save_companion_config: () => db.query('select public.mn_save_companion_config($1,$2::uuid,$3::uuid,$4,$5::jsonb) as data',
        [args.p_world, args.p_owner, args.p_character, args.p_expected_revision, JSON.stringify(args.p_config)]),
    };
    try {
      if (!calls[name]) throw new Error('unexpected RPC');
      return { data: (await calls[name]()).rows[0].data, error: null };
    } catch (error) { return { data: null, error: { code: error.code ?? 'XX000', message: 'SQL fixture error' } }; }
  };
}

async function localCDNroutes(context) {
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' :
      (process.env.MN_GSAP || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/gsap-local/package'), match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(file) });
  });
}

async function setupAuth(context, { accountId, token }) {
  await context.addInitScript(({ accountId, token }) => {
    let listener;
    let session = { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } };
    window.__mnFixtureAuth = {
      signOut() { session = null; listener?.('SIGNED_OUT', null); },
    };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (callback) => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => { window.__mnFixtureAuth.signOut(); return { error: null }; },
    } }) };
  }, { accountId, token });
  await localCDNroutes(context);
}

const resolvePlayer = async (_req, hello) => ({
  'owner-fixture': OWNER,
  'other-fixture': OTHER,
  'agent-fixture': CHARACTER,
}[hello.token] ?? null);
const binding = (ownerId, characterId) => ({ ownerId, characterId, capabilities: ['move', 'aim', 'attack_pve'] });

let tempPath = null, tempCanonical = null, db = null, browser = null, game = null, agent = null;
let ownerContext = null, otherContext = null;
const evidence = {
  schema: 'l03d-companion-config-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, public: false, production: false, gameplayDurabilityNotVerified: true,
  storage: { migration: 'SQL025', durable: true, store: 'memory gameplay store + SQL-backed companion-config RPC fixture' },
  checks: [], screenshots: [], errors: [], fixtures: { owner: OWNER, character: CHARACTER, other: OTHER, otherCharacter: OTHER_CHARACTER, world: WORLD },
};
const diagnostics = [];
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function screenshot(page, name) {
  const layout = await page.locator('.mn-companion-config').evaluate(node => {
    node.scrollTop = 0;
    return { width: node.clientWidth, contentWidth: node.scrollWidth, scrollLeft: node.scrollLeft };
  });
  assert.ok(layout.contentWidth <= layout.width + 1 && Math.abs(layout.scrollLeft) < 1,
    `editor has horizontal overflow in ${name}: ${JSON.stringify(layout)}`);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.locator('.mn-companion-config').evaluate(node => {
    const rect = node.getBoundingClientRect();
    const selectors = ['.mn-companion-config-header h3', '.mn-companion-config-status',
      'label span', '.mn-companion-config-personality'];
    return { name: node.className, x: rect.x, width: rect.width, scrollLeft: node.scrollLeft,
      elements: selectors.map(selector => {
        const el = node.querySelector(selector), r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { selector, x: r.x, width: r.width, transform: style.transform, scrollLeft: el.scrollLeft };
      }) };
  });
  assert.ok(geometry.elements.every(el => el.x >= geometry.x - 1 && el.x + el.width <= geometry.x + geometry.width + 1),
    `editor child clips horizontally in ${name}: ${JSON.stringify(geometry)}`);
  (evidence.layout ??= []).push({ screenshot: name, ...geometry });
  await page.screenshot({ path: resolve(OUTPUT, name), fullPage: false }); evidence.screenshots.push(name);
}

async function openGame(context, origin, { width, height } = {}) {
  const page = await context.newPage();
  if (width && height) await page.setViewportSize({ width, height });
  const diag = { pageErrors: [], consoleErrors: [], failedRequests: [] }; diagnostics.push(diag);
  page.on('pageerror', error => { const text = error.stack || error.message; diag.pageErrors.push(text); evidence.errors.push(text); });
  page.on('console', message => { if (message.type() === 'error') diag.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => diag.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  await page.goto(`${origin}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && window.__mn.companions && !document.querySelector('#btn-play').disabled,
    null, { timeout: 90000 });
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

async function joinAgent(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
  socket.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((ok, fail) => { socket.once('open', ok); socket.once('error', fail); });
  socket.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: 'agent-fixture', agent: true,
    name: 'Brisa', skin: 0, weapon: 0 }));
  await waitUntil(() => messages.some(message => message.t === MSG.WELCOME || message.t === MSG.ERROR), 10000,
    'Fixture companion did not join the local game');
  assert.equal(messages.find(message => [MSG.WELCOME, MSG.ERROR].includes(message.t))?.t, MSG.WELCOME,
    `fixture companion must join: ${JSON.stringify(messages.slice(-3))}`);
  return socket;
}

function goalConfig(personality, text, id = 'help-village') {
  return { v: 1, personality, goals: [{ id, status: 'active', text, constraints: ['No gastar oro sin autorización'] }] };
}

try {
  await mkdir(OUTPUT, { recursive: true });
  const tempBase = await realpath(tmpdir());
  const prefix = 'mn-companion-config-qa-';
  const { mkdtemp } = await import('node:fs/promises');
  tempPath = await mkdtemp(join(tempBase, prefix));
  tempCanonical = await realpath(tempPath);
  assert.equal(tempCanonical, tempPath, 'temporary database path must resolve to the directory created by this run');
  assert.equal(basename(tempCanonical).startsWith(prefix), true, 'temporary database path must have the private QA prefix');
  assert.equal(resolve(tempCanonical).startsWith(`${resolve(tempBase)}${sep}`), true, 'temporary database must be inside the OS temp root');

  db = new PGlite(join(tempCanonical, 'db'));
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  await db.exec(migration);
  await db.exec('SET ROLE service_role');
  const configMethods = createSupabaseCompanionConfigMethods({ rpc: rpcFor(db) });
  assert.deepEqual(await configMethods.checkCompanionConfig(), { version: 1 });
  const memoryStore = createMemoryStore();
  const fixtureStore = { ...memoryStore, ...configMethods, durable: true };

  game = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {},
    store: fixtureStore, resolvePlayer, worldId: WORLD, saveSecret: 'companion-config-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_companion_config_fixture' },
    agentControl: { worldId: WORLD, bindings: [binding(OWNER, CHARACTER), binding(OTHER, OTHER_CHARACTER)] },
    agentPilot: { maxAgents: 1 },
  });
  const port = await game.listen(), origin = `http://127.0.0.1:${port}`;
  agent = await joinAgent(port);
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });

  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(ownerContext, { accountId: OWNER, token: 'owner-fixture' });
  let ownerPage = await openGame(ownerContext, origin);
  await openPanel(ownerPage);
  await ownerPage.locator(`[data-config-key="${CHARACTER}"]`).click();
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config-status')?.textContent === 'Aún no hay una ficha guardada.');
  await check('owner_can_edit_only_their_bound_companion_and_SQL025_fixture_is_ready', async () => {
    const list = await ownerPage.evaluate(() => __mn.companions.snapshot().companions.map(row => row.characterKey));
    assert.deepEqual(list, [CHARACTER]);
    assert.equal((await configMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER })).revision, 0);
    assert.deepEqual(await ownerPage.evaluate(() => [...__mn.errors]), []);
  });

  await ownerPage.locator('.mn-companion-config-personality').fill('Amable, prudente y clara.');
  await ownerPage.locator('.mn-companion-config-add').click();
  await ownerPage.locator('.mn-companion-config-goal-text').fill('Ayudar a la aldea cuando sea seguro.');
  await ownerPage.locator('.mn-companion-config-constraints').fill('No gastar oro sin autorización');
  await ownerPage.locator('.mn-companion-config-save').click();
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config-status')?.textContent === 'Configuración guardada.');
  const firstHead = await configMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER });
  assert.equal(firstHead.revision, 1);
  await check('personality_and_one_goal_saved_as_private_durable_revision_one', async () => {
    assert.match(firstHead.config.goals[0].id, /^goal-[A-Za-z0-9_-]+$/);
    assert.deepEqual(firstHead.config, goalConfig('Amable, prudente y clara.', 'Ayudar a la aldea cuando sea seguro.', firstHead.config.goals[0].id));
    assert.equal(firstHead.savedAt && Number.isFinite(Date.parse(firstHead.savedAt)), true);
    assert.match(await ownerPage.locator('.mn-companion-config-note').first().textContent(), /privada y durable/);
  });
  await screenshot(ownerPage, 'companion-config-desktop-es.png');

  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config-personality') &&
    [...document.querySelectorAll('.mn-companion-config label span')].some(node => node.textContent === 'Personality'));
  await check('editor_and_owner_surface_follow_global_english_locale', async () => {
    assert.equal(await ownerPage.locator('.mn-companion-config-save').textContent(), 'Save');
    assert.equal(await ownerPage.locator('.mn-companion-config-reload').textContent(), 'Load server version');
  });
  await screenshot(ownerPage, 'companion-config-desktop-en.png');

  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await ownerPage.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
  await ownerPage.locator('#btn-play').click({ force: true });
  await ownerPage.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await openPanel(ownerPage);
  await ownerPage.locator(`[data-config-key="${CHARACTER}"]`).click();
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config-personality')?.value === 'Amable, prudente y clara.');
  await check('browser_reload_and_game_reentry_loads_the_persisted_sql_head', async () => {
    assert.equal(await ownerPage.locator('.mn-companion-config-goal-text').inputValue(), 'Ayudar a la aldea cuando sea seguro.');
    assert.equal((await configMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER })).revision, 1);
  });

  // The global English choice survives reload; restore Spanish for the next copy checks.
  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('es'); });

  const external = await configMethods.saveCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER,
    expectedRevision: 1, config: goalConfig('Cambio externo reciente.', 'Revisar los víveres del puerto.') });
  assert.equal(external.ok, true); assert.equal(external.head.revision, 2);
  await ownerPage.locator('.mn-companion-config-personality').fill('Borrador local que debe conservarse.');
  await ownerPage.locator('.mn-companion-config-save').click();
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config-status')?.textContent.includes('Otra sesión guardó cambios.'));
  await check('stale_CAS_conflict_keeps_the_unsaved_editor_draft', async () => {
    assert.equal(await ownerPage.locator('.mn-companion-config-personality').inputValue(), 'Borrador local que debe conservarse.');
    assert.equal((await configMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER })).revision, 2);
  });
  await ownerPage.locator('.mn-companion-config-reload').click();
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-config-personality')?.value === 'Cambio externo reciente.');
  await check('manual_reload_adopts_the_current_server_head', async () => {
    assert.equal(await ownerPage.locator('.mn-companion-config-goal-text').inputValue(), 'Revisar los víveres del puerto.');
    assert.equal((await configMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER })).revision, 2);
  });

  await ownerPage.evaluate(() => window.__mnFixtureAuth.signOut());
  await ownerPage.waitForFunction(() => __mn.companions.snapshot().status === 'signed_out' &&
    document.querySelector('.mn-companion-config')?.hidden === true);
  await check('logout_hides_editor_and_clears_private_draft', async () => {
    assert.equal(await ownerPage.locator('.mn-companion-config-personality').inputValue(), '');
    assert.deepEqual(await ownerPage.evaluate(() => __mn.companions.snapshot().companions), []);
  });
  await ownerContext.close(); ownerContext = null;

  otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(otherContext, { accountId: OTHER, token: 'other-fixture' });
  const otherPage = await openGame(otherContext, origin);
  await openPanel(otherPage);
  await otherPage.locator(`[data-config-key="${OTHER_CHARACTER}"]`).click();
  await otherPage.waitForSelector('.mn-companion-config:not([hidden])');
  await check('second_owner_cannot_load_first_owners_saved_configuration', async () => {
    assert.deepEqual(await otherPage.evaluate(() => __mn.companions.snapshot().companions.map(row => row.characterKey),), [OTHER_CHARACTER]);
    assert.equal((await configMethods.loadCompanionConfig({ world: WORLD, owner: OTHER, character: OTHER_CHARACTER })).revision, 0);
    assert.equal(await otherPage.locator('.mn-companion-config-personality').inputValue(), '');
  });

  await check('tab_wraps_inside_owner_dialog_and_escape_closes_editor_and_suspends_game_input', async () => {
    assert.equal(await otherPage.evaluate(() => __mn.input.enabled), false);
    const panel = otherPage.locator('.mn-companions-panel');
    const visibleFocusables = () => otherPage.evaluate(() => [...document.querySelector('.mn-companions-panel')
      .querySelectorAll('button,input,textarea,select,[tabindex]')]
      .filter(node => !node.disabled && node.tabIndex !== -1 && !node.hidden && node.getClientRects().length > 0).length);
    const count = await visibleFocusables();
    assert.ok(count >= 5, `expected visible editor controls in focus trap, got ${count}`);
    await otherPage.evaluate(() => {
      const list = [...document.querySelector('.mn-companions-panel').querySelectorAll('button,input,textarea,select,[tabindex]')]
        .filter(node => !node.disabled && node.tabIndex !== -1 && !node.hidden && node.getClientRects().length > 0);
      list[0].focus();
    });
    await otherPage.keyboard.press('Shift+Tab');
    assert.equal(await otherPage.evaluate(() => {
      const list = [...document.querySelector('.mn-companions-panel').querySelectorAll('button,input,textarea,select,[tabindex]')]
        .filter(node => !node.disabled && node.tabIndex !== -1 && !node.hidden && node.getClientRects().length > 0);
      return list.at(-1) === document.activeElement;
    }), true);
    await otherPage.keyboard.press('Tab');
    assert.equal(await otherPage.evaluate(() => {
      const list = [...document.querySelector('.mn-companions-panel').querySelectorAll('button,input,textarea,select,[tabindex]')]
        .filter(node => !node.disabled && node.tabIndex !== -1 && !node.hidden && node.getClientRects().length > 0);
      return list[0] === document.activeElement;
    }), true);
    await otherPage.keyboard.press('Escape');
    await otherPage.waitForFunction(() => document.querySelector('.mn-companions-panel').hidden && __mn.input.enabled === true);
  });

  for (const viewport of [{ name: 'mobile-landscape', width: 844, height: 390 }, { name: 'mobile-portrait', width: 390, height: 844 }]) {
    await otherPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await otherPage.locator('.mn-companions-toggle').click();
    await otherPage.waitForSelector('.mn-companions-panel:not([hidden])');
    await otherPage.locator(`[data-config-key="${OTHER_CHARACTER}"]`).click();
    await otherPage.waitForSelector('.mn-companion-config:not([hidden])');
    await check(`viewport_stage_bounds_${viewport.name}`, async () => {
      const bounds = await otherPage.evaluate(() => {
        const panel = document.querySelector('.mn-companions-panel').getBoundingClientRect();
        const editor = document.querySelector('.mn-companion-config').getBoundingClientRect();
        const stage = document.querySelector('#stage').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight,
          panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
          editor: { left: editor.left, top: editor.top, right: editor.right, bottom: editor.bottom, height: editor.height },
          stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom } };
      });
      for (const [name, rect] of Object.entries({ panel: bounds.panel, editor: bounds.editor, stage: bounds.stage })) {
        assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= bounds.width + 1 && rect.bottom <= bounds.height + 1,
          `${name} outside ${viewport.name}: ${JSON.stringify(bounds)}`);
      }
      assert.ok(bounds.panel.right > bounds.panel.left && bounds.editor.height > 0);
    });
    await screenshot(otherPage, `companion-config-${viewport.name}.png`);
    await otherPage.keyboard.press('Escape');
    await otherPage.waitForFunction(() => document.querySelector('.mn-companions-panel').hidden);
  }

  await check('no_page_or_game_errors_and_current_SQL_head', async () => {
    for (const diag of diagnostics) assert.deepEqual(diag.pageErrors, []);
    for (const page of [ownerPage, otherPage]) if (!page.isClosed()) {
      assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
    }
    assert.equal((await configMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER })).revision, 2);
  });

  evidence.diagnostics = diagnostics.map(diag => ({ pageErrors: diag.pageErrors, consoleErrors: diag.consoleErrors,
    failedRequests: diag.failedRequests }));
  await otherContext.close(); otherContext = null;
  if (agent?.readyState === WebSocket.OPEN) { agent.close(); agent = null; }
  await game.close(); game = null;
  await browser.close(); browser = null;
  await db.close(); db = null;

  // Reopen the exact on-disk SQL fixture after the browser/server teardown to prove durability.
  const reopened = new PGlite(join(tempCanonical, 'db'));
  try {
    await reopened.exec('SET ROLE service_role');
    const reopenedMethods = createSupabaseCompanionConfigMethods({ rpc: rpcFor(reopened) });
    const head = await reopenedMethods.loadCompanionConfig({ world: WORLD, owner: OWNER, character: CHARACTER });
    assert.equal(head.revision, 2);
    assert.equal(head.config.personality, 'Cambio externo reciente.');
    evidence.checks.push('SQL025_disk_database_reopens_with_revision_two');
  } finally { await reopened.close(); }

} catch (error) {
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
      assert.equal(basename(current).startsWith('mn-companion-config-qa-'), true, 'cleanup prefix mismatch');
      assert.equal(resolve(current).startsWith(`${resolve(base)}${sep}`), true, 'cleanup target escaped OS temp root');
      await rm(current, { recursive: true, force: true });
    } catch (error) { evidence.errors.push(`temporary database cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

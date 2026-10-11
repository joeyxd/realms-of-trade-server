// Focused browser acceptance for prepared owner-scoped inference settings.
// Auth is simulated, gameplay uses memory and only SQL028 configuration is disk-backed.
// No provider is called; saved ceilings and selections do not imply usage or inference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryCompanionConfigMethods } from '../server/companionConfigStore.mjs';
import { createMemoryCompanionControlMethods } from '../server/companionControlStore.mjs';
import { createSupabaseInferenceConfigMethods } from '../server/inferenceConfigStore.mjs';
import { GAME } from '../src/data/meta.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER_A = '33333333-3333-4333-8333-333333333333';
const CHARACTER_B = '55555555-5555-4555-8555-555555555555';
const OTHER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '66666666-6666-4666-8666-666666666666';
const WORLD = 'inference-config-browser-fixture';
const OUTPUT = resolve(process.env.MN_INFERENCE_CONFIG_QA_OUTPUT || 'docs/delivery/l03d-inference-config');
const ANGLE = process.env.MN_INFERENCE_CONFIG_QA_ANGLE || 'default';
assert.ok(['default', 'swiftshader'].includes(ANGLE), 'QA ANGLE must be default or swiftshader');
const migration = await readFile(new URL('../server/migrations/028_inference_config.sql', import.meta.url), 'utf8');
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const connections = [{ id: 'fixture-local', label: 'Local', providerId: 'local', maxCeilingNanoUsd: 5000000000,
  models: ['fixture-small-v1', 'fixture-large-v1'] }];
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitUntil(predicate, timeoutMs = 10000, label = 'fixture state') {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await predicate()) return; await sleep(25); }
  throw new Error(`Timed out waiting for ${label}`);
}
function rpcFor(db) {
  return async (name, args = {}) => {
    try {
      const queries = {
        mn_companion_control_ready: () => db.query('select public.mn_companion_control_ready() as data'),
        mn_load_companion_control: () => db.query('select public.mn_load_companion_control($1,$2::uuid,$3::uuid) as data', [args.p_world, args.p_owner, args.p_character]),
        mn_save_companion_control: () => db.query('select public.mn_save_companion_control($1,$2::uuid,$3::uuid,$4,$5) as data', [args.p_world, args.p_owner, args.p_character, args.p_expected_revision, args.p_stopped]),
        mn_inference_config_ready: () => db.query('select public.mn_inference_config_ready() as data'),
        mn_load_inference_config: () => db.query('select public.mn_load_inference_config($1,$2::uuid) as data', [args.p_world, args.p_owner]),
        mn_save_inference_config: () => db.query('select public.mn_save_inference_config($1,$2::uuid,$3::integer,$4::jsonb) as data', [args.p_world, args.p_owner, args.p_expected_revision, JSON.stringify(args.p_config)]),
      };
      if (!queries[name]) throw new Error('unexpected fixture RPC');
      return { data: (await queries[name]()).rows[0].data, error: null };
    } catch { return { data: null, error: { code: 'XX000', message: 'local SQL fixture failure' } }; }
  };
}
const resolvePlayer = async (_req, hello) => ({ 'owner-fixture': OWNER, 'other-fixture': OTHER, 'agent-fixture': CHARACTER_A }[hello.token] ?? null);
const binding = (ownerId, characterId) => ({ ownerId, characterId, capabilities: ['move', 'aim', 'attack_pve'] });
function createFixture(db) {
  const rpc = rpcFor(db), store = { ...createMemoryStore(), ...createMemoryCompanionConfigMethods(),
    ...createMemoryCompanionControlMethods(), ...createSupabaseInferenceConfigMethods({ rpc }), durable: true };
  return createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {}, store,
    resolvePlayer, worldId: WORLD, saveSecret: 'inference-config-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_inference_config_fixture' },
    gmAccountIds: [OWNER, OTHER],
    agentControl: { worldId: WORLD, bindings: [binding(OWNER, CHARACTER_A), binding(OWNER, CHARACTER_B), binding(OTHER, OTHER_CHARACTER)] },
    agentPilot: { maxAgents: 2 }, companionControlAllowMemory: true, companionConfigAllowMemory: true,
    inferenceConfigAllowMemory: true, inferenceCatalog: [{ owner: OWNER, connections }, { owner: OTHER, connections: [] }],
  });
}
async function routes(context) {
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const base = match?.[1].startsWith('three') ? 'node_modules/three' : (process.env.MN_GSAP || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/gsap-local/package');
    const file = match && resolve(base, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}
async function setupAuth(context, accountId, token) {
  await context.addInitScript(({ accountId, token }) => {
    let listener, session = { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } };
    window.__mnFixtureAuth = { signOut() { session = null; listener?.('SIGNED_OUT', null); } };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => ({ data: { session }, error: null }), signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => { window.__mnFixtureAuth.signOut(); return { error: null }; },
    } }) };
  }, { accountId, token });
  await routes(context);
}

const diagnostics = [];
const evidence = { schema: 'l03d-inference-config-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, public: false, production: false, gameplayMemory: true, gameplayDurabilityVerified: false,
  providerCalls: false, generationAvailable: false,
  storage: { migration: 'SQL028', durableInFixture: true, database: 'PGlite disk directory', gameplay: 'memory store', control: 'memory default-stopped control fixture' },
  rendering: { browser: 'Chrome headless', angle: ANGLE }, checks: [], screenshots: [], errors: [],
  fixtures: { owner: OWNER, characters: [CHARACTER_A, CHARACTER_B], other: OTHER, otherCharacter: OTHER_CHARACTER, world: WORLD } };
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function shot(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: resolve(OUTPUT, name), fullPage: false }); evidence.screenshots.push(name);
}
async function openGame(context, origin, viewport) {
  const page = await context.newPage(); if (viewport) await page.setViewportSize(viewport);
  const diag = { pageErrors: [], consoleErrors: [], failedRequests: [], gmSessionStatuses: [] }; diagnostics.push(diag);
  page.on('pageerror', error => { const text = error.stack || error.message; diag.pageErrors.push(text); evidence.errors.push(text); });
  page.on('console', message => { if (message.type() === 'error') diag.consoleErrors.push(message.text()); });
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/gm/session') diag.gmSessionStatuses.push(response.status()); });
  page.on('requestfailed', request => diag.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  await page.goto(`${origin}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn?.companions && !document.querySelector('#btn-play')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  return page;
}
async function openPanel(page) {
  await page.locator('.mn-companions-toggle').click();
  await page.waitForFunction(() => ['ready', 'error', 'signed_out', 'offline'].includes(__mn.companions.snapshot().status));
}
async function openInference(page) {
  await page.locator('.mn-inference-open').click();
  await page.waitForFunction(() => !document.querySelector('.mn-inference-config')?.hidden &&
    !['loading', 'saving'].includes(document.querySelector('.mn-inference-config')?.dataset.status));
}
let tempPath = null, tempCanonical = null, db = null, game = null, browser = null;
let ownerContext = null, otherContext = null, ownerPage = null, otherPage = null, methods = null;
let port = null, origin = null;
try {
  await mkdir(OUTPUT, { recursive: true });
  const tempBase = await realpath(tmpdir()), prefix = 'mn-inference-config-qa-';
  const { mkdtemp } = await import('node:fs/promises'); tempPath = await mkdtemp(join(tempBase, prefix)); tempCanonical = await realpath(tempPath);
  assert.equal(tempCanonical, tempPath); assert.ok(basename(tempCanonical).startsWith(prefix));
  assert.ok(resolve(tempCanonical).startsWith(`${resolve(tempBase)}${sep}`));
  db = new PGlite(join(tempCanonical, 'db'));
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  await db.exec(migration); await db.exec('SET ROLE service_role');
  methods = createSupabaseInferenceConfigMethods({ rpc: rpcFor(db) });
  assert.deepEqual(await methods.checkInferenceConfig(), { version: 1 });
  game = createFixture(db); port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', `--use-angle=${ANGLE}`, '--enable-webgl', '--ignore-gpu-blocklist', ...(ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : [])] });

  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(ownerContext, OWNER, 'owner-fixture'); ownerPage = await openGame(ownerContext, origin); await openPanel(ownerPage); await openInference(ownerPage);
  await check('owner_loads_empty_private_head_and_catalog_without_secret_fields', async () => {
    const initial = await methods.loadInferenceConfig({ world: WORLD, owner: OWNER });
    assert.deepEqual(initial, { revision: 0, config: null, savedAt: null });
    assert.deepEqual(await ownerPage.locator(`[data-focus-key="connection:${CHARACTER_A}"] option`).evaluateAll(nodes => nodes.map(node => node.value)), ['', 'fixture-local']);
    assert.deepEqual(await ownerPage.locator(`[data-focus-key="connection:${CHARACTER_B}"] option`).evaluateAll(nodes => nodes.map(node => node.value)), ['', 'fixture-local']);
    assert.equal(await ownerPage.locator('.mn-inference-config select').count(), 2);
    assert.equal(await ownerPage.locator('.mn-inference-config input').first().inputValue(), '');
    assert.match(await ownerPage.locator('.mn-inference-config').textContent(), /prepared limits, not balance or usage|límites preparados, no saldo ni uso/i);
  });
  await shot(ownerPage, 'inference-config-owner-desktop-empty-es.png');

  await ownerPage.locator('.mn-inference-config input').first().fill('4.25');
  await ownerPage.locator(`[data-focus-key="connection:${CHARACTER_A}"]`).selectOption('fixture-local');
  await ownerPage.locator(`[data-focus-key="model:${CHARACTER_A}"]`).selectOption('fixture-small-v1');
  await ownerPage.locator(`[data-focus-key="connection:${CHARACTER_B}"]`).selectOption('fixture-local');
  await ownerPage.locator(`[data-focus-key="model:${CHARACTER_B}"]`).selectOption('fixture-large-v1');
  await ownerPage.locator('[data-focus-key="connection-ceiling:fixture-local"]').fill('3');
  await ownerPage.locator('.mn-inference-config-save').click();
  await ownerPage.waitForFunction(() => /Configuration saved|Configuración guardada/.test(document.querySelector('.mn-inference-config-status')?.textContent || ''));
  const saved = await methods.loadInferenceConfig({ world: WORLD, owner: OWNER });
  await check('two_characters_share_one_connection_ceiling_and_save_keeps_companions_stopped', async () => {
    assert.equal(saved.revision, 1); assert.equal(saved.config.ceilingNanoUsd, 4250000000);
    assert.deepEqual(saved.config.connections, [{ id: 'fixture-local', ceilingNanoUsd: 3000000000 }]);
    assert.equal(saved.config.companions.length, 2); assert.ok(saved.config.companions.every(row => row.connectionId === 'fixture-local'));
    const rows = await ownerPage.evaluate(() => __mn.companions.snapshot().companions);
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.stopped && !row.active));
  });
  await shot(ownerPage, 'inference-config-desktop-es.png');

  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await check('portrait_owner_form_displays_saved_populated_inputs_and_selectors', async () => {
    assert.equal(await ownerPage.locator('.mn-inference-config input').first().inputValue(), '4.25');
    assert.equal(await ownerPage.locator('[data-focus-key="connection:33333333-3333-4333-8333-333333333333"]').inputValue(), 'fixture-local');
    assert.equal(await ownerPage.locator('[data-focus-key="model:33333333-3333-4333-8333-333333333333"]').inputValue(), 'fixture-small-v1');
    assert.equal(await ownerPage.locator('.mn-inference-config select').count(), 4);
    const controls = ownerPage.locator('.mn-inference-config input,.mn-inference-config select,.mn-inference-config button');
    const count = await controls.count(), viewport = await ownerPage.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    let reachable = 0;
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i); if (!await control.isVisible()) continue;
      await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox();
      assert.ok(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 &&
        rect.y + rect.height <= viewport.height + 1, `unreachable mobile control ${i}: ${JSON.stringify({ rect, viewport })}`);
      reachable++;
    }
    assert.ok(reachable >= 7, `expected populated form controls, found ${reachable}`);
    evidence.layout = { ...(evidence.layout || {}), portrait: viewport, reachableFormControls: reachable };
  });
  await shot(ownerPage, 'inference-config-owner-portrait-controls-bottom-es.png');
  await ownerPage.locator('.mn-inference-config').evaluate(node => { node.scrollTop = 0; });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-inference-config')?.scrollTop === 0);
  await check('portrait_owner_top_shows_populated_usd_input', async () => {
    assert.equal(await ownerPage.locator('.mn-inference-config-account-ceiling').inputValue(), '4.25');
  });
  await shot(ownerPage, 'inference-config-owner-portrait-populated-es.png');
  await ownerPage.setViewportSize({ width: 1440, height: 900 });

  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-inference-config h3')?.textContent === 'Inference Center');
  await check('english_copy_keeps_prepared_limits_and_no_generation_claim', async () => {
    assert.equal(await ownerPage.locator('.mn-inference-config-save').textContent(), 'Save');
    assert.match(await ownerPage.locator('.mn-inference-config').textContent(), /inference is not available yet|not balance or usage/i);
  });
  await check('english_config_form_is_visible_and_painted_before_capture', async () => {
    await ownerPage.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    });
    await ownerPage.waitForTimeout(120);
    const visible = await ownerPage.evaluate(() => {
      const root = document.querySelector('.mn-inference-config'), title = root?.querySelector('h3');
      const amount = root?.querySelector('.mn-inference-config-account-ceiling'), status = root?.querySelector('.mn-inference-config-status');
      const bounds = element => {
        if (!element) return null;
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display,
          visibility: style.visibility, opacity: Number(style.opacity), color: style.color };
      };
      const rootRect = bounds(root), titleRect = bounds(title), amountRect = bounds(amount), statusRect = bounds(status);
      const onscreen = rect => !!rect && rect.width > 0 && rect.height > 0 && rect.display !== 'none' &&
        rect.visibility === 'visible' && rect.opacity > 0 && rect.x >= -1 && rect.y >= -1 &&
        rect.x + rect.width <= innerWidth + 1 && rect.y + rect.height <= innerHeight + 1;
      return { title: title?.textContent?.trim(), amount: amount?.value, status: status?.textContent?.trim(),
        root: rootRect, titleRect, amountRect, statusRect,
        rendered: onscreen(rootRect) && onscreen(titleRect) && onscreen(amountRect) && onscreen(statusRect) };
    });
    assert.equal(visible.title, 'Inference Center'); assert.equal(visible.amount, '4.25');
    assert.match(visible.status, /Configuration saved/); assert.equal(visible.rendered, true, JSON.stringify(visible));
    evidence.layout = { ...(evidence.layout || {}), englishCapture: visible };
  });
  await shot(ownerPage, 'inference-config-desktop-en.png');

  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await ownerPage.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
  await ownerPage.locator('#btn-play').click({ force: true });
  await ownerPage.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await openPanel(ownerPage); await openInference(ownerPage);
  await ownerPage.waitForFunction(() => document.querySelector('.mn-inference-config input')?.value === '4.25');
  await check('page_reload_reads_confirmed_SQL028_head', async () => {
    assert.equal(await ownerPage.locator('.mn-inference-config input').first().inputValue(), '4.25');
    assert.equal((await methods.loadInferenceConfig({ world: WORLD, owner: OWNER })).revision, 1);
  });

  otherContext = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await setupAuth(otherContext, OTHER, 'other-fixture'); otherPage = await openGame(otherContext, origin, { width: 844, height: 390 });
  await openPanel(otherPage); await openInference(otherPage);
  await check('other_owner_gets_empty_config_and_empty_catalog', async () => {
    assert.deepEqual(await methods.loadInferenceConfig({ world: WORLD, owner: OTHER }), { revision: 0, config: null, savedAt: null });
    assert.match(await otherPage.locator('.mn-inference-config').textContent(), /No eligible connections|No hay conexiones admitidas/);
    assert.equal(await otherPage.locator('.mn-inference-config-save').isDisabled(), true);
    assert.equal((await methods.loadInferenceConfig({ world: WORLD, owner: OTHER })).revision, 0);
  });
  const geometry = await otherPage.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const controls = [...document.querySelectorAll('.mn-inference-config button,.mn-inference-config input,.mn-inference-config select')]
      .filter(node => !node.disabled && node.getClientRects().length).map(node => ({ label: node.textContent || node.value, height: node.getBoundingClientRect().height }));
    return { viewport: { width: innerWidth, height: innerHeight }, panel: rect('.mn-companions-panel'), editor: rect('.mn-inference-config'), stage: rect('#stage'), controls };
  });
  for (const [name, rect] of Object.entries({ panel: geometry.panel, editor: geometry.editor, stage: geometry.stage }))
    assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= geometry.viewport.width + 1 && rect.bottom <= geometry.viewport.height + 1, `${name}: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.controls.every(control => control.height >= 44)); evidence.layout = { ...(evidence.layout || {}), landscape: geometry };
  await shot(otherPage, 'inference-config-landscape-es.png');
  await check('Escape_closes_center_and_returns_focus_to_open_button', async () => {
    await otherPage.locator('.mn-inference-config-back').focus(); await otherPage.keyboard.press('Escape');
    await otherPage.waitForFunction(() => document.querySelector('.mn-inference-config').hidden && document.activeElement?.matches('.mn-inference-open'));
  });

  await check('stale_CAS_conflict_preserves_draft_until_explicit_reload', async () => {
    const externalConfig = structuredClone(saved.config); externalConfig.ceilingNanoUsd = 4000000000;
    const external = await methods.saveInferenceConfig({ world: WORLD, owner: OWNER, expectedRevision: 1, config: externalConfig });
    assert.equal(external.ok, true); assert.equal(external.head.revision, 2);
    await ownerPage.locator('.mn-inference-config input').first().fill('4.5');
    await ownerPage.locator('.mn-inference-config-save').click();
    await ownerPage.waitForFunction(() => /Another session|Otra sesión/.test(document.querySelector('.mn-inference-config-status')?.textContent || ''));
    assert.equal(await ownerPage.locator('.mn-inference-config input').first().inputValue(), '4.5');
    await ownerPage.locator('.mn-inference-config-reload').click();
    await ownerPage.waitForFunction(() => document.querySelector('.mn-inference-config input')?.value === '4');
    assert.equal((await methods.loadInferenceConfig({ world: WORLD, owner: OWNER })).revision, 2);
  });
  await check('configuration_stays_out_of_gameplay_profile_world_and_provider_calls', async () => {
    assert.equal(JSON.stringify(await game.game.store.loadProfile(OWNER)).includes('fixture-local'), false);
    assert.equal(JSON.stringify(await game.game.store.loadWorld(WORLD)).includes('fixture-local'), false);
    for (const diag of diagnostics) {
      assert.deepEqual(diag.pageErrors, []); assert.deepEqual(diag.consoleErrors, []);
      assert.ok(diag.gmSessionStatuses.every(status => status !== 503), JSON.stringify(diag.gmSessionStatuses));
    }
    for (const page of [ownerPage, otherPage]) if (!page.isClosed()) assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
  });

  await ownerContext.close(); ownerContext = null;
  await otherContext.close(); otherContext = null;
  await game.close(); game = null; await browser.close(); browser = null; await db.close(); db = null;
  const reopened = new PGlite(join(tempCanonical, 'db'));
  try {
    await reopened.exec('SET ROLE service_role');
    const persisted = await createSupabaseInferenceConfigMethods({ rpc: rpcFor(reopened) }).loadInferenceConfig({ world: WORLD, owner: OWNER });
    assert.equal(persisted.revision, 2); assert.equal(persisted.config.ceilingNanoUsd, 4000000000);
    evidence.checks.push('SQL028_disk_database_reopens_at_revision_two');
  } finally { await reopened.close(); }
} catch (error) {
  evidence.errors.push(error.stack || String(error)); process.exitCode = 1;
} finally {
  try { await Promise.all([ownerContext?.close(), otherContext?.close()]); } catch {}
  try { await browser?.close(); } catch {}
  try { await game?.close(); } catch {}
  try { await db?.close(); } catch {}
  if (tempPath && tempCanonical) {
    try {
      const base = await realpath(tmpdir()), current = await realpath(tempPath);
      assert.equal(current, tempCanonical); assert.ok(basename(current).startsWith('mn-inference-config-qa-'));
      assert.ok(resolve(current).startsWith(`${resolve(base)}${sep}`)); await rm(current, { recursive: true, force: true });
    } catch (error) { evidence.errors.push(`temporary SQL cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  evidence.diagnostics = diagnostics;
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

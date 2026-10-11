// Browser acceptance for durable, owner-scoped companion creation.
// Auth is simulated; gameplay remains memory-backed; SQL034 is the durable creation registry.
// No controller, inference catalog, model call, or production service is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createSupabaseCompanionCreationMethods } from '../server/companionCreationStore.mjs';
import { companionCreationConfig, validateCompanionPreset } from '../src/net/companionCreation.js';
import { GAME } from '../src/data/meta.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const WORLD = 'companion-creation-browser-fixture';
const OUTPUT = resolve(process.env.MN_COMPANION_CREATION_QA_OUTPUT || 'docs/delivery/l03e-companion-creation');
const ANGLE = process.env.MN_COMPANION_CREATION_QA_ANGLE || 'default';
assert.equal(ANGLE, 'default', 'L03e acceptance uses Chrome ANGLE default');
const migrations = await Promise.all(['001_store.sql', '025_companion_config.sql', '027_companion_control.sql',
  '034_companion_creation.sql'].map(name => readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8')));
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitUntil(predicate, timeoutMs = 10000, label = 'fixture state') {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await predicate()) return; await sleep(25); }
  throw new Error(`Timed out waiting for ${label}`);
}

function rpcFor(db) {
  return async (name, args = {}) => {
    const queries = {
      mn_companion_creation_ready: () => db.query('select public.mn_companion_creation_ready() as data'),
      mn_load_companion_creation: () => db.query('select public.mn_load_companion_creation($1,$2::uuid) as data', [args.p_world, args.p_owner]),
      mn_create_companion: () => db.query('select public.mn_create_companion($1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb) as data',
        [args.p_world, args.p_owner, args.p_creation_id, JSON.stringify(args.p_preset), JSON.stringify(args.p_config)]),
    };
    try {
      if (!queries[name]) throw new Error('unexpected fixture RPC');
      return { data: (await queries[name]()).rows[0].data, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code || 'XX000', message: 'local SQL fixture failure' } };
    }
  };
}
async function countFixtureRows(tables) {
  await db.exec('RESET ROLE');
  try {
    const counts = {};
    for (const table of tables) {
      assert.match(table, /^[a-z_]+$/);
      counts[table] = (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n;
    }
    return counts;
  } finally { await db.exec('SET ROLE service_role'); }
}
const resolvePlayer = async (_req, hello) => ({ 'owner-fixture': OWNER, 'other-fixture': OTHER, 'guest-fixture': null }[hello.token] ?? null);
function createFixture(db) {
  const rpc = rpcFor(db);
  const store = { ...createMemoryStore(), ...createSupabaseCompanionCreationMethods({ rpc }), durable: true };
  return createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {}, store,
    resolvePlayer, worldId: WORLD, saveSecret: 'companion-creation-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_companion_creation_fixture' },
    gmAccountIds: [OWNER, OTHER], gmDraftsAllowMemory: true,
    companionCreation: true, companionCreationAllowMemory: false, inferenceCatalog: [] });
}

async function routes(context) {
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const base = match?.[1].startsWith('three') ? 'node_modules/three'
      : (process.env.MN_GSAP || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/gsap-local/package');
    const file = match && resolve(base, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}
async function setupAuth(context, accountId, token) {
  await context.addInitScript(({ accountId, token }) => {
    let listener, session = accountId ? { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } } : null;
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
const evidence = { schema: 'l03e-companion-creation-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, public: false, production: false, gameplayMemory: true, gameplayDurabilityVerified: false,
  durableSQLregistry: true, controllerConfigured: false, inferenceCatalogConfigured: false, modelNeverCalled: true,
  storage: { migrations: ['SQL001', 'SQL025', 'SQL027', 'SQL034'], durableInFixture: true,
    database: 'PGlite disk directory', gameplay: 'memory store', creation: 'SQL034 RPC' },
  rendering: { browser: 'Chrome headless', angle: ANGLE }, checks: [], screenshots: [], errors: [],
  fixtures: { owner: OWNER, other: OTHER, world: WORLD } };
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function shot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))); });
  await page.waitForTimeout(120); await page.screenshot({ path: resolve(OUTPUT, name), fullPage: false }); evidence.screenshots.push(name);
}
async function openGame(context, origin, viewport) {
  const page = await context.newPage(); if (viewport) await page.setViewportSize(viewport);
  const diag = { pageErrors: [], consoleErrors: [], failedRequests: [], gmSessionStatuses: [] }; diagnostics.push(diag);
  page.on('pageerror', error => { const value = error.stack || error.message; diag.pageErrors.push(value); evidence.errors.push(value); });
  page.on('console', message => { if (message.type() === 'error') diag.consoleErrors.push(message.text()); });
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/gm/session') diag.gmSessionStatuses.push(response.status()); });
  page.on('requestfailed', request => diag.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  await page.goto(`${origin}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn?.companions && !document.querySelector('#btn-play')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await page.waitForFunction(() => !__mn.st.boarding && document.querySelector('#title')?.hidden);
  return page;
}
async function openWizard(page) {
  const toggle = page.locator('.mn-companions-toggle');
  if (await page.locator('.mn-companions-panel').isHidden()) await toggle.click();
  await page.locator('.mn-companion-create-open').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('.mn-companion-create');
    return root && !root.hidden && (/Revisa el borrador|Review the draft/i.test(root.querySelector('.mn-companion-create-status')?.textContent || '') ||
      (root.querySelector('.mn-companion-create-saved')?.hidden === false &&
        !!root.querySelector('.mn-companion-create-saved')?.textContent?.trim()));
  });
}
function boxes(page) {
  return page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const editor = document.querySelector('.mn-companion-create');
    const panel = document.querySelector('.mn-companions-panel');
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      panel: rect('.mn-companions-panel'), panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth,
      editor: rect('.mn-companion-create'), editorScrollWidth: editor.scrollWidth,
      editorClientWidth: editor.clientWidth, controls: [...editor.querySelectorAll('button,input,select')]
        .filter(node => node.getClientRects().length).map(node => { const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, disabled: node.disabled }; }) };
  });
}
function assertFits(layout) {
  assert.ok(layout.documentWidth <= layout.viewport.width, JSON.stringify(layout));
  assert.ok(layout.panel.left >= -1 && layout.panel.right <= layout.viewport.width + 1 &&
    layout.panel.top >= -1 && layout.panel.bottom <= layout.viewport.height + 1, `panel outside viewport: ${JSON.stringify(layout)}`);
  assert.ok(layout.editor.left >= -1 && layout.editor.right <= layout.viewport.width + 1, `editor outside viewport horizontally: ${JSON.stringify(layout)}`);
  assert.ok(layout.panelScrollWidth <= layout.panelClientWidth + 1, `panel horizontal overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.editorScrollWidth <= layout.editorClientWidth + 1, JSON.stringify(layout));
  for (const control of layout.controls) assert.ok(control.left >= layout.editor.left - 1 && control.right <= layout.editor.right + 1,
    `control outside editor: ${JSON.stringify(control)}`);
}

let tempPath = null, tempCanonical = null, db = null, game = null, browser = null, ownerContext = null, ownerPage = null;
let otherContext = null, otherPage = null, guestContext = null, guestPage = null, methods = null, port = null, origin = null;
try {
  await mkdir(OUTPUT, { recursive: true });
  const tempBase = await realpath(tmpdir()), prefix = 'mn-companion-creation-qa-';
  tempPath = await mkdtemp(join(tempBase, prefix)); tempCanonical = await realpath(tempPath);
  assert.equal(tempCanonical, tempPath); assert.ok(basename(tempCanonical).startsWith(prefix));
  assert.ok(resolve(tempCanonical).startsWith(`${resolve(tempBase)}${sep}`));
  db = new PGlite(join(tempCanonical, 'db'));
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const migration of migrations) await db.exec(migration);
  await db.exec('SET ROLE service_role');
  methods = createSupabaseCompanionCreationMethods({ rpc: rpcFor(db) });
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });
  game = createFixture(db); port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(ownerContext, OWNER, 'owner-fixture'); ownerPage = await openGame(ownerContext, origin); await openWizard(ownerPage);
  await check('SQL034_readiness_and_creation_availability_are_durable', async () => {
    assert.equal((await methods.checkCompanionCreation()).version, 1);
    assert.match(await ownerPage.locator('.mn-companion-create-status').textContent(), /Revisa el borrador|Review the draft/);
    assert.equal((await methods.loadCompanionCreation({ world: WORLD, owner: OWNER })), null);
  });
  await check('randomize_then_edit_exact_reviewable_Brisa_harvester_preset', async () => {
    await ownerPage.locator('.mn-companion-create button').filter({ hasText: /Sortear opciones|Randomize choices/ }).click();
    await ownerPage.locator('.mn-companion-create [data-field="name"]').fill('Brisa');
    await ownerPage.locator('.mn-companion-create [data-field="role"]').selectOption('harvester');
    await ownerPage.locator('.mn-companion-create [data-field="personality"]').selectOption('curious');
    const randomTraits = await ownerPage.locator('.mn-companion-create [data-field="trait"]:checked').evaluateAll(nodes => nodes.map(node => node.value));
    for (const trait of randomTraits) await ownerPage.locator(`.mn-companion-create [data-field="trait"][value="${trait}"]`).uncheck();
    await ownerPage.locator('.mn-companion-create [data-field="trait"][value="prudent"]').check();
    await ownerPage.locator('.mn-companion-create [data-field="skin"][value="1"]').check();
    await ownerPage.locator('.mn-companion-create button').filter({ hasText: /Revisar documentos|Review documents/ }).click();
    await ownerPage.waitForFunction(() => !document.querySelector('.mn-companion-create-review')?.hidden);
    const preview = await ownerPage.evaluate(() => ({ name: document.querySelector('.mn-companion-create [data-field="name"]')?.value,
      role: document.querySelector('.mn-companion-create [data-field="role"]')?.value,
      personality: document.querySelector('.mn-companion-create [data-field="personality"]')?.value,
      personalityDoc: document.querySelector('.mn-companion-create-review .mn-companion-create-doc')?.textContent,
      goals: [...document.querySelectorAll('.mn-companion-create-review li')].map(node => node.textContent) }));
    assert.deepEqual([preview.name, preview.role, preview.personality], ['Brisa', 'harvester', 'curious']);
    assert.ok(preview.personalityDoc?.length > 0 && preview.goals.length > 0); evidence.preview = preview;
    await shot(ownerPage, 'companion-creation-desktop-es-review.png');
    await ownerPage.locator('.mn-companion-create-review input[type="checkbox"]').check();
    const create = ownerPage.locator('.mn-companion-create-review button').last();
    assert.equal(await create.isEnabled(), true); await create.click();
    await ownerPage.waitForFunction(() => !!document.querySelector('.mn-companion-create-saved') &&
      !document.querySelector('.mn-companion-create-saved').hidden, null, { timeout: 15000 });
    const record = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
    const expectedPreset = validateCompanionPreset({ v: 1, name: 'Brisa', role: 'harvester', personality: 'curious', traits: ['prudent'], skin: 1 });
    assert.deepEqual(record.preset, Object.fromEntries(['v', 'name', 'role', 'personality', 'traits', 'skin'].map(key => [key, expectedPreset[key]])));
    assert.deepEqual(record.configuration.config, companionCreationConfig(expectedPreset));
    assert.equal(record.control.stopped, true); assert.equal(record.control.revision, 1); assert.equal(record.configuration.revision, 1);
    evidence.created = record; evidence.expectedInitialConfig = companionCreationConfig(expectedPreset);
    const visual = await ownerPage.locator('.mn-companion-create-saved').textContent();
    assert.match(visual, /Brisa/); assert.match(visual, /preparado|prepared/i); assert.match(visual, /detenido|stopped/i);
    assert.deepEqual(await countFixtureRows(['mn_companion_creations', 'mn_companion_configs', 'mn_companion_controls']),
      { mn_companion_creations: 1, mn_companion_configs: 1, mn_companion_controls: 1 });
  });

  await check('saved_identity_and_documents_recover_after_page_reload_and_panel_reopen', async () => {
    const first = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
    await ownerPage.locator('.mn-companion-create-back').click();
    await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-create')?.hidden === true);
    await ownerPage.locator('.mn-companion-create-open').click();
    await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-create-saved')?.textContent?.includes('Brisa'));
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => window.__mn?.companions && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
    await ownerPage.locator('#btn-play').click({ force: true });
    await ownerPage.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
    await ownerPage.waitForFunction(() => !__mn.st.boarding && document.querySelector('#title')?.hidden);
    await openWizard(ownerPage);
    const recovered = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
    assert.deepEqual(recovered, first);
    const visible = await ownerPage.locator('.mn-companion-create-saved').textContent();
    assert.ok(visible.includes(first.characterKey) && visible.includes('Brisa'));
    assert.ok(visible.includes(first.configuration.config.personality));
    for (const goal of first.configuration.config.goals) assert.ok(visible.includes(goal.text));
    assert.equal(await ownerPage.locator('.mn-companion-create [data-field="name"]').count(), 1);
    assert.equal(await ownerPage.locator('.mn-companion-create [data-field="name"]').isVisible(), false);
    assert.deepEqual(await ownerPage.evaluate(() => [...__mn.errors]), []);
  });
  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Create companion');
  await shot(ownerPage, 'companion-creation-desktop-en-saved.png');
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await check('portrait_390x844_saved_view_fits_in_English', async () => { const layout = await boxes(ownerPage); assertFits(layout); evidence.layout = { ...(evidence.layout || {}), portraitEn: layout }; });
  await shot(ownerPage, 'companion-creation-portrait-en.png');
  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('es'); });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Crear compañero');
  await check('portrait_390x844_saved_view_fits_in_Spanish', async () => { const layout = await boxes(ownerPage); assertFits(layout); evidence.layout = { ...(evidence.layout || {}), portraitEs: layout }; });
  await shot(ownerPage, 'companion-creation-portrait-es.png');
  await ownerPage.setViewportSize({ width: 844, height: 390 });
  await check('landscape_844x390_saved_view_fits_in_Spanish', async () => { const layout = await boxes(ownerPage); assertFits(layout); evidence.layout = { ...(evidence.layout || {}), landscapeEs: layout }; });
  await shot(ownerPage, 'companion-creation-landscape-es.png');
  await ownerPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Create companion');
  await check('landscape_844x390_saved_view_fits_in_English', async () => { const layout = await boxes(ownerPage); assertFits(layout); evidence.layout = { ...(evidence.layout || {}), landscapeEn: layout }; });
  await shot(ownerPage, 'companion-creation-landscape-en.png');

  otherContext = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await setupAuth(otherContext, OTHER, 'other-fixture'); otherPage = await openGame(otherContext, origin); await openWizard(otherPage);
  await check('other_authenticated_owner_cannot_read_or_see_private_creation', async () => {
    assert.equal(await methods.loadCompanionCreation({ world: WORLD, owner: OTHER }), null);
    const saved = otherPage.locator('.mn-companion-create-saved');
    assert.equal(await saved.isHidden(), true);
    const text = await saved.textContent();
    assert.equal(text.includes(evidence.created.characterKey), false);
    assert.equal(text.includes(evidence.created.configuration.config.personality), false);
    for (const goal of evidence.created.configuration.config.goals) assert.equal(text.includes(goal.text), false);
    assert.equal(await methods.loadCompanionCreation({ world: WORLD, owner: OTHER }), null);
  });
  await otherPage.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await otherPage.waitForFunction(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Create companion');
  await shot(otherPage, 'companion-creation-other-owner-landscape-en.png');
  guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(guestContext, null, 'guest-fixture'); guestPage = await openGame(guestContext, origin);
  await guestPage.locator('.mn-companions-toggle').click();
  await guestPage.waitForFunction(() => /Sign in to view your companions|Inicia sesión para consultar tus compañeros/
    .test(document.querySelector('.mn-companions-status')?.textContent || ''));
  await check('guest_session_cannot_read_private_creation', async () => {
    assert.equal((await methods.loadCompanionCreation({ world: WORLD, owner: OTHER })), null);
    const creationButton = guestPage.locator('.mn-companion-create-open');
    assert.equal(await creationButton.isDisabled(), true);
    const saved = guestPage.locator('.mn-companion-create-saved');
    assert.equal(await saved.isHidden(), true);
    const text = await saved.textContent();
    assert.equal(text.includes(evidence.created.characterKey), false);
    assert.equal(text.includes(evidence.created.configuration.config.personality), false);
    for (const goal of evidence.created.configuration.config.goals) assert.equal(text.includes(goal.text), false);
  });
  await shot(guestPage, 'companion-creation-guest-panel-es.png');

  await check('creation_retry_is_idempotent_and_conflicting_preset_never_replaces_identity', async () => {
    const created = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
    const exact = await methods.createCompanion({ world: WORLD, owner: OWNER, creationId: created.creationId,
      preset: created.preset, config: created.configuration.config });
    assert.equal(exact.ok, true); assert.equal(exact.replay, true); assert.deepEqual(exact.record, created);
    const changedPreset = structuredClone(created.preset); changedPreset.name = 'Otra';
    const conflict = await methods.createCompanion({ world: WORLD, owner: OWNER, creationId: created.creationId,
      preset: changedPreset, config: companionCreationConfig(changedPreset) });
    assert.equal(conflict.ok, false); assert.equal(conflict.why, 'conflict'); assert.deepEqual(conflict.record, created);
    assert.deepEqual(await methods.loadCompanionCreation({ world: WORLD, owner: OWNER }), created);
  });

  await ownerContext.close(); ownerContext = null; ownerPage = null;
  await otherContext.close(); otherContext = null; otherPage = null;
  await guestContext.close(); guestContext = null; guestPage = null;
  await game.close(); game = null; await db.close(); db = null;
  db = new PGlite(join(tempCanonical, 'db')); await db.exec('SET ROLE service_role');
  methods = createSupabaseCompanionCreationMethods({ rpc: rpcFor(db) });
  game = createFixture(db); port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupAuth(ownerContext, OWNER, 'owner-fixture'); ownerPage = await openGame(ownerContext, origin); await openWizard(ownerPage);
  await check('reopened_PGlite_disk_and_host_recover_exact_SQL034_record', async () => {
    const diskRecord = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
    assert.deepEqual(diskRecord, evidence.created);
    await ownerPage.waitForFunction(() => document.querySelector('.mn-companion-create-saved')?.textContent?.includes('Brisa'), null, { timeout: 15000 });
    const visibleRecord = await ownerPage.locator('.mn-companion-create-saved').textContent();
    assert.ok(visibleRecord.includes(diskRecord.characterKey)); assert.ok(visibleRecord.includes('Brisa'));
    assert.equal(diskRecord.control.stopped, true);
    assert.deepEqual(await countFixtureRows(['mn_companion_creations']), { mn_companion_creations: 1 });
    const loadedRecord = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
    assert.deepEqual(loadedRecord, evidence.created);
    evidence.gameplayDurabilityVerified = false; evidence.diskReopen = { exactRecord: true, characterKey: diskRecord.characterKey,
      initialConfig: diskRecord.configuration.config, stopped: diskRecord.control.stopped, hostRecreated: true };
  });
  await shot(ownerPage, 'companion-creation-host-restart-recovered-es.png');

  await check('no_companion_profile_grant_or_inference_activation_is_created', async () => {
    const ownerProfile = await game.game.store.loadProfile?.(OWNER);
    assert.equal(JSON.stringify(ownerProfile || {}).includes(evidence.created.characterKey), false);
    assert.equal(game.game.agentControl, null);
    for (const diag of diagnostics) {
      assert.deepEqual(diag.pageErrors, []); assert.deepEqual(diag.consoleErrors, []);
      assert.ok(diag.gmSessionStatuses.every(status => status !== 503), JSON.stringify(diag.gmSessionStatuses));
    }
    assert.equal(evidence.modelNeverCalled, true);
  });
} catch (error) {
  evidence.errors.push(error.stack || String(error)); process.exitCode = 1;
  if (ownerPage && !ownerPage.isClosed()) {
    evidence.failureState = await ownerPage.evaluate(() => ({
      companions: __mn.companions.snapshot(), creation: __mn.panels.companionsPanel.creationEditor.client.snapshot(),
      panelHidden: __mn.panels.companionsPanel.panel.hidden, creatorOpen: __mn.panels.companionsPanel.creationEditor.isOpen,
      buttonHidden: __mn.panels.companionsPanel.creationButton.hidden,
      panelText: __mn.panels.companionsPanel.panel.innerText,
    })).catch(() => null);
    await shot(ownerPage, 'failure.png').catch(() => {});
  }
} finally {
  try { await Promise.all([ownerContext?.close(), otherContext?.close(), guestContext?.close()]); } catch {}
  try { await browser?.close(); } catch {}
  try { await game?.close(); } catch {}
  try { await db?.close(); } catch {}
  if (tempPath && tempCanonical) {
    try { const base = await realpath(tmpdir()), current = await realpath(tempPath);
      assert.equal(current, tempCanonical); assert.ok(basename(current).startsWith('mn-companion-creation-qa-'));
      assert.ok(resolve(current).startsWith(`${resolve(base)}${sep}`)); await rm(current, { recursive: true, force: true });
    } catch (error) { evidence.errors.push(`temporary SQL cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  evidence.diagnostics = diagnostics;
  await mkdir(OUTPUT, { recursive: true });
  await fs.promises.writeFile(resolve(OUTPUT, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

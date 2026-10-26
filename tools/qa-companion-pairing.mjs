// Local browser acceptance for the L03f owner-to-local-controller pairing flow.
// Auth is simulated, gameplay is memory-backed, and SQL001/025/027/034 run in local PGlite.
// Pairing codes are inspected only in memory and masked before every screenshot; no runner/model is started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createSupabaseCompanionConfigMethods } from '../server/companionConfigStore.mjs';
import { createSupabaseCompanionControlMethods } from '../server/companionControlStore.mjs';
import { createSupabaseCompanionCreationMethods } from '../server/companionCreationStore.mjs';
import { companionCreationConfig, validateCompanionPreset } from '../src/net/companionCreation.js';
import { GAME } from '../src/data/meta.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const WORLD = 'companion-pairing-browser-fixture';
const OUTPUT = resolve(process.env.MN_COMPANION_PAIRING_QA_OUTPUT || 'docs/delivery/l03f-local-pairing/browser');
const ANGLE = process.env.MN_COMPANION_PAIRING_QA_ANGLE || 'default';
assert.equal(ANGLE, 'default', 'L03f acceptance uses Chrome ANGLE default');
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
      mn_companion_config_ready: () => db.query('select public.mn_companion_config_ready() as data'),
      mn_load_companion_config: () => db.query('select public.mn_load_companion_config($1,$2::uuid,$3::uuid) as data',
        [args.p_world, args.p_owner, args.p_character]),
      mn_save_companion_config: () => db.query('select public.mn_save_companion_config($1,$2::uuid,$3::uuid,$4::integer,$5::jsonb) as data',
        [args.p_world, args.p_owner, args.p_character, args.p_expected_revision, JSON.stringify(args.p_config)]),
      mn_companion_control_ready: () => db.query('select public.mn_companion_control_ready() as data'),
      mn_load_companion_control: () => db.query('select public.mn_load_companion_control($1,$2::uuid,$3::uuid) as data',
        [args.p_world, args.p_owner, args.p_character]),
      mn_save_companion_control: () => db.query('select public.mn_save_companion_control($1,$2::uuid,$3::uuid,$4::integer,$5::boolean) as data',
        [args.p_world, args.p_owner, args.p_character, args.p_expected_revision, args.p_stopped]),
    };
    try {
      if (!queries[name]) throw new Error('unexpected fixture RPC');
      return { data: (await queries[name]()).rows[0].data, error: null };
    } catch (error) { return { data: null, error: { code: error.code || 'XX000', message: 'local SQL fixture failure' } }; }
  };
}
const rpc = db => rpcFor(db);
const resolvePlayer = async (_req, hello) => hello.token === 'owner-fixture' ? OWNER : null;
function createFixture(db) {
  const client = { rpc: rpc(db) };
  const store = { ...createMemoryStore(), ...createSupabaseCompanionCreationMethods(client),
    ...createSupabaseCompanionConfigMethods(client), ...createSupabaseCompanionControlMethods(client), durable: true };
  return createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {}, store,
    resolvePlayer, worldId: WORLD, saveSecret: 'pairing-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_pairing_fixture' },
    gmAccountIds: [OWNER], gmDraftsAllowMemory: true,
    companionCreation: true, companionCreationAllowMemory: false,
    companionConfigAllowMemory: false, companionControlAllowMemory: false,
    companionPairing: true, companionPairingAllowMemory: false, inferenceCatalog: [] });
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
async function setupAuth(context) {
  await context.addInitScript(({ accountId, token }) => {
    let listener, session = { access_token: token, user: { id: accountId, email: 'fixture@example.invalid' } };
    window.__mnFixtureAuth = { signOut() { session = null; listener?.('SIGNED_OUT', null); } };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => ({ data: { session }, error: null }), signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => { window.__mnFixtureAuth.signOut(); return { error: null }; },
    } }) };
  }, { accountId: OWNER, token: 'owner-fixture' });
  await routes(context);
}
const diagnostics = { pageErrors: [], consoleErrors: [], failedRequests: [] };
const evidence = { schema: 'l03f-local-pairing-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, gameplay: 'memory store; not durable', durableSQL: true, production: false,
  controllerStarted: false, modelCalled: false, codeWrittenToArtifact: false, codePersisted: false,
  storage: { migrations: ['SQL001', 'SQL025', 'SQL027', 'SQL034'], database: 'temporary local PGlite',
    creation: 'SQL034 RPC', configuration: 'SQL025 RPC adapter', control: 'SQL027 RPC adapter', gameplay: 'memory store' },
  rendering: { browser: 'Chrome headless', angle: ANGLE }, checks: [], screenshots: [], errors: [], diagnostics,
  limitations: ['Supabase auth and account token are simulated; gameplay profiles are memory-backed.',
    'No local controller process or model inference runs.'] };
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function shot(page, name, { maskPairingCode = false } = {}) {
  let code = null;
  if (maskPairingCode) {
    code = await page.locator('.mn-companion-pairing-code-value').evaluate(node => {
      const current = node.textContent; node.textContent = '[masked one-use code]'; return current;
    });
    assert.match(code, /^[0-9a-f]{64}$/i);
  }
  await page.evaluate(async () => { await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))); });
  await page.waitForTimeout(120);
  const filename = resolve(OUTPUT, name);
  await page.screenshot({ path: filename, fullPage: false }); evidence.screenshots.push(name);
  if (code !== null) await page.locator('.mn-companion-pairing-code-value').evaluate((node, value) => { node.textContent = value; }, code);
}
async function openGame(context, origin, viewport) {
  const page = await context.newPage(); await page.setViewportSize(viewport);
  page.on('pageerror', error => { const value = error.stack || error.message; diagnostics.pageErrors.push(value); evidence.errors.push(value); });
  page.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => diagnostics.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  await page.goto(`${origin}/?q=low&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn?.companions && !document.querySelector('#btn-play')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await page.waitForFunction(() => !__mn.st.boarding && document.querySelector('#title')?.hidden);
  return page;
}
async function openPanel(page) {
  if (await page.locator('.mn-companions-panel').isHidden()) await page.locator('.mn-companions-toggle').click();
  await page.waitForFunction(() => !document.querySelector('.mn-companions-panel')?.hidden);
}
async function openWizard(page) {
  await openPanel(page); await page.locator('.mn-companion-create-open').click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-create') &&
    !document.querySelector('.mn-companion-create').hidden && !!document.querySelector('.mn-companion-create [data-field="name"]'));
}
async function createBrisa(page) {
  await openWizard(page);
  await page.locator('.mn-companion-create [data-field="name"]').fill('Brisa');
  await page.locator('.mn-companion-create [data-field="role"]').selectOption('harvester');
  await page.locator('.mn-companion-create [data-field="personality"]').selectOption('curious');
  const traits = await page.locator('.mn-companion-create [data-field="trait"]:checked').evaluateAll(nodes => nodes.map(node => node.value));
  for (const trait of traits) await page.locator(`.mn-companion-create [data-field="trait"][value="${trait}"]`).uncheck();
  await page.locator('.mn-companion-create [data-field="trait"][value="prudent"]').check();
  await page.locator('.mn-companion-create [data-field="skin"][value="1"]').check();
  await page.locator('.mn-companion-create button').filter({ hasText: /Revisar documentos|Review documents/ }).click();
  await page.waitForFunction(() => !document.querySelector('.mn-companion-create-review')?.hidden);
  await page.locator('.mn-companion-create-review input[type="checkbox"]').check();
  await page.locator('.mn-companion-create-review button').last().click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-create-saved')?.hidden === false, null, { timeout: 15000 });
}
async function readCode(page) {
  const code = await page.locator('.mn-companion-pairing-code-value').textContent();
  assert.match(code, /^[0-9a-f]{64}$/i);
  return code;
}
const generateButton = page => page.locator('.mn-companion-pairing button').filter({ hasText: /Generar código de emparejamiento|Generate pairing code/ });
const revokeButton = page => page.locator('.mn-companion-pairing button').filter({ hasText: /Revocar conexión|Revoke connection/ });
async function assertPairingLayout(page, width, height) {
  const layout = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const panel = document.querySelector('.mn-companions-panel'), view = document.querySelector('.mn-companion-pairing');
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      panel: rect('.mn-companions-panel'), panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth,
      editor: rect('.mn-companion-pairing'), editorScrollWidth: view.scrollWidth, editorClientWidth: view.clientWidth,
      controls: [...view.querySelectorAll('button')].filter(node => node.getClientRects().length).map(node => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
      }) };
  });
  assert.deepEqual(layout.viewport, { width, height });
  assert.ok(layout.documentWidth <= width, JSON.stringify(layout));
  assert.ok(layout.panel.left >= -1 && layout.panel.right <= width + 1 && layout.panel.top >= -1 && layout.panel.bottom <= height + 1,
    `panel outside viewport: ${JSON.stringify(layout)}`);
  assert.ok(layout.panelScrollWidth <= layout.panelClientWidth + 1, `panel horizontal overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.editorScrollWidth <= layout.editorClientWidth + 1, `pairing horizontal overflow: ${JSON.stringify(layout)}`);
  for (const control of layout.controls) assert.ok(control.left >= layout.editor.left - 1 && control.right <= layout.editor.right + 1 && control.height >= 44,
    `pairing control outside view or below touch target: ${JSON.stringify(control)}`);
  return layout;
}

let tempPath = null, tempCanonical = null, db = null, game = null, browser = null, context = null, page = null, methods = null;
let controllerCode = null, gamePort = null, origin = null;
let stage = 'startup';
try {
  await mkdir(OUTPUT, { recursive: true });
  const tempBase = await realpath(tmpdir()), prefix = 'mn-companion-pairing-qa-';
  tempPath = await mkdtemp(join(tempBase, prefix)); tempCanonical = await realpath(tempPath);
  assert.equal(tempCanonical, tempPath); assert.ok(basename(tempCanonical).startsWith(prefix));
  assert.ok(resolve(tempCanonical).startsWith(`${resolve(tempBase)}${sep}`));
  db = new PGlite(join(tempCanonical, 'db'));
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const migration of migrations) await db.exec(migration);
  await db.exec('SET ROLE service_role');
  methods = { ...createSupabaseCompanionCreationMethods({ rpc: rpc(db) }),
    ...createSupabaseCompanionConfigMethods({ rpc: rpc(db) }), ...createSupabaseCompanionControlMethods({ rpc: rpc(db) }) };
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });
  game = createFixture(db); gamePort = await game.listen(); origin = `http://127.0.0.1:${gamePort}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'es-MX' }); await setupAuth(context);
  page = await openGame(context, origin, { width: 1280, height: 720 });
  await check('local_SQL001_025_027_034_and_pairing_prerequisites_ready', async () => {
    assert.equal(game.game.companionPairing.ready, true);
    assert.equal((await methods.checkCompanionConfig()).version, 1);
    assert.equal((await methods.checkCompanionControl()).version, 1);
  });
  stage = 'create-Brisa';
  await createBrisa(page);
  const created = await methods.loadCompanionCreation({ world: WORLD, owner: OWNER });
  const expectedPreset = validateCompanionPreset({ v: 1, name: 'Brisa', role: 'harvester', personality: 'curious', traits: ['prudent'], skin: 1 });
  assert.deepEqual(created.preset, expectedPreset);
  assert.deepEqual(created.configuration.config, companionCreationConfig(expectedPreset));
  assert.equal(created.control.stopped, true);
  evidence.created = { characterKey: created.characterKey, name: created.preset.name, role: created.preset.role,
    appearance: created.preset.skin, controlStoppedInitially: created.control.stopped,
    configRevision: created.configuration.revision, controlRevision: created.control.revision };
  await check('owner_created_Brisa_is_SQL034_prepared_and_stopped', async () => {
    const visible = await page.locator('.mn-companion-create-saved').textContent();
    assert.match(visible, /Brisa/); assert.match(visible, /detenido|stopped/i);
    assert.deepEqual(created.configuration.config, companionCreationConfig(expectedPreset));
    assert.equal(created.control.stopped, true);
  });
  await page.locator('.mn-companion-create-back').click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-create')?.hidden === true);
  await shot(page, 'pairing-desktop-es-prepared.png');

  stage = 'open-pairing';
  const connectOnPc = page.locator('.mn-companion-pair-open');
  assert.equal((await connectOnPc.textContent()).trim(), 'Conectar en mi PC');
  await connectOnPc.click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-pairing')?.hidden === false &&
    document.querySelector('.mn-companion-pairing-status')?.textContent === 'Estado actualizado.');
  await check('visible_Conectar_en_mi_PC_opens_pairing_panel', async () => {
    assert.equal(await page.locator('.mn-companion-pairing h3').textContent(), 'Conectar en mi PC');
    assert.match(await page.locator('.mn-companion-pairing-note').first().textContent(), /Permitir conexi[oó]n/);
  });
  await page.locator('.mn-companion-pairing-back').click();
  await page.waitForFunction(() => document.querySelector('.mn-companions-row')?.textContent?.includes('Brisa'));
  await check('pair_load_registers_created_owner_row_with_chat_only_and_SQL027_control', async () => {
    const registered = game.game.companionPairing.owners.get(OWNER);
    assert.equal(registered.record.characterKey, created.characterKey);
    assert.deepEqual(registered.binding.capabilities, ['chat']);
    const row = page.locator('.mn-companions-row').filter({ hasText: 'Brisa' });
    assert.match(await row.textContent(), /Detenido|Stopped/i);
    const diskControl = await methods.loadCompanionControl({ world: WORLD, owner: OWNER, character: created.characterKey });
    assert.equal(diskControl.stopped, true); assert.equal(diskControl.revision, created.control.revision);
  });
  const resume = page.locator('.mn-companions-row').filter({ hasText: 'Brisa' }).locator('button').filter({ hasText: /Permitir conexión|Allow connection/ });
  await resume.click();
  await waitUntil(async () => (await methods.loadCompanionControl({ world: WORLD, owner: OWNER, character: created.characterKey })).stopped === false,
    10000, 'SQL027 allow connection');
  await check('explicit_existing_panel_Allow_connection_commits_SQL027_before_pair_issue', async () => {
    const diskControl = await methods.loadCompanionControl({ world: WORLD, owner: OWNER, character: created.characterKey });
    assert.equal(diskControl.stopped, false); assert.equal(diskControl.revision, created.control.revision + 1);
    assert.equal(game.game.companionControl.allowed(created.characterKey), true);
    assert.equal(game.game.agentControl.byCharacter(created.characterKey), null, 'allowing does not itself admit/start a runner');
  });

  await page.locator('.mn-companion-pair-open').click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-pairing')?.hidden === false &&
    document.querySelector('.mn-companion-pairing-status')?.textContent === 'Estado actualizado.');
  await generateButton(page).click();
  await page.waitForFunction(() => /^[0-9a-f]{64}$/i.test(document.querySelector('.mn-companion-pairing-code-value')?.textContent || ''), null, { timeout: 10000 });
  controllerCode = await readCode(page);
  const initialExpiry = await page.evaluate(() => window.__mn.panels.companionsPanel.pairingEditor.client.snapshot().expiresAtMs);
  assert.ok(initialExpiry > Date.now() && initialExpiry <= Date.now() + 300000);
  await check('issue_returns_private_64_hex_one_use_code_with_five_minute_bound', async () => {
    assert.equal(controllerCode.length, 64); assert.equal(game.game.companionPairing.codes.size, 1);
    assert.ok(initialExpiry - Date.now() > 4 * 60 * 1000);
    assert.equal(game.game.companionPairing.tokens.size, 0);
  });
  await check('browser_storage_and_navigation_never_receive_pairing_code', async () => {
    const storage = await page.evaluate(() => ({ url: location.href, values: Object.entries(localStorage).map(([key, value]) => `${key}=${value}`) }));
    assert.equal(storage.url.includes(controllerCode), false);
    assert.equal(storage.url.toLowerCase().includes('code='), false);
    assert.equal(storage.values.some(value => value.includes(controllerCode) || /mncp_[0-9a-f]{64}/i.test(value)), false);
    evidence.codePersisted = false; evidence.codeWrittenToArtifact = false;
  });
  await assertPairingLayout(page, 1280, 720);
  await shot(page, 'pairing-desktop-es-code-masked.png', { maskPairingCode: true });

  await revokeButton(page).click();
  await page.waitForFunction(() => window.__mn.panels.companionsPanel.pairingEditor.client.snapshot().code === null &&
    document.querySelector('.mn-companion-pairing-status')?.textContent === 'Estado actualizado.');
  assert.equal(game.game.companionPairing.codes.size, 0);
  await check('explicit_revoke_removes_pending_code_and_clears_browser_memory', async () => {
    assert.equal(await page.locator('.mn-companion-pairing-code-value').textContent(), '');
    assert.equal(game.game.companionPairing.codes.size, 0); assert.equal(game.game.companionPairing.tokens.size, 0);
    assert.equal(game.game.agentControl.byCharacter(created.characterKey)?.state, 'revoked');
  });

  // Expiry uses an accelerated fixture clock: persistence/storage remain real for SQL, not for wall time.
  await generateButton(page).click();
  await page.waitForFunction(() => /^[0-9a-f]{64}$/i.test(document.querySelector('.mn-companion-pairing-code-value')?.textContent || ''));
  controllerCode = await readCode(page);
  const expiringAt = await page.evaluate(() => window.__mn.panels.companionsPanel.pairingEditor.client.snapshot().expiresAtMs);
  game.game.companionPairing.now = () => expiringAt + 1;
  game.game.companionPairing.sweep();
  await page.evaluate(expiringAt => {
    const client = window.__mn.panels.companionsPanel.pairingEditor.client;
    client.now = () => expiringAt - 100; client.scheduleExpiry(expiringAt);
  }, expiringAt);
  await page.waitForFunction(() => window.__mn.panels.companionsPanel.pairingEditor.client.snapshot().code === null, null, { timeout: 2000 });
  assert.equal(game.game.companionPairing.codes.size, 0);
  await check('expired_code_is_removed_from_server_RAM_and_browser_state', async () => {
    assert.equal(game.game.companionPairing.codes.size, 0);
    assert.equal(await page.locator('.mn-companion-pairing-code-value').textContent(), '');
  });
  game.game.companionPairing.now = () => Date.now();
  await page.evaluate(() => { window.__mn.panels.companionsPanel.pairingEditor.client.now = () => Date.now(); });
  stage = 'mobile-english';
  await page.locator('.mn-companion-pairing-back').click();
  await page.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mn-companion-pair-open').click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-pairing-status')?.textContent === 'Status updated.');
  await generateButton(page).click();
  await page.waitForFunction(() => /^[0-9a-f]{64}$/i.test(document.querySelector('.mn-companion-pairing-code-value')?.textContent || ''));
  controllerCode = await readCode(page);
  await check('English_mobile_390x844_pairing_view_fits_with_masked_secret', async () => {
    evidence.layout = await assertPairingLayout(page, 390, 844);
    assert.match(await page.locator('.mn-companion-pairing h3').textContent(), /Connect on my PC/);
  });
  await shot(page, 'pairing-mobile-en-code-masked.png', { maskPairingCode: true });
  await revokeButton(page).scrollIntoViewIfNeeded();
  await check('mobile_scroll_reaches_the_revoke_action', async () => {
    const revoke = page.locator('.mn-companion-pairing button').filter({ hasText: /Revoke connection/ });
    const bounds = await revoke.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844,
      `mobile revoke action is not reachable in the viewport: ${JSON.stringify(bounds)}`);
    assert.equal(await page.locator('.mn-companions-panel').evaluate(node => node.scrollTop > 0), true);
  });
  await shot(page, 'pairing-mobile-en-revoke-visible-code-masked.png', { maskPairingCode: true });
  await check('owner_logout_clears_browser_pairing_code_and_local_storage', async () => {
    await page.evaluate(() => window.__mnFixtureAuth.signOut());
    await page.waitForFunction(() => window.__mn.panels.companionsPanel.pairingEditor.client.snapshot().status === 'signed_out');
    assert.equal(await page.locator('.mn-companion-pairing-code-value').textContent(), '');
    assert.equal(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => /pair|mncp_[0-9a-f]{64}/i.test(`${key}=${value}`))), false);
    evidence.logout = { simulatedAuthEvent: true, browserCodeCleared: true,
      serverCodeClearedBeforeSocketClose: game.game.companionPairing.codes.size === 0 };
    // Closing the authenticated gameplay socket is the server-observable owner-session boundary.
    await page.evaluate(() => window.__mn.client.t.close());
    await waitUntil(() => game.game.companionPairing.codes.size === 0, 5000, 'owner socket close revokes pairing codes');
    evidence.logout.serverCodeClearedAfterOwnerSocketClose = game.game.companionPairing.codes.size === 0;
  });
  evidence.createdPairingSessionRevoked = game.game.agentControl.byCharacter(created.characterKey)?.state === 'revoked';
  await check('no_controller_admission_or_model_call_occurred', async () => {
    assert.equal(game.game.companionPairing.tokens.size, 0); assert.equal(game.game.companionPairing.admitted.size, 0);
    assert.equal(game.game.agentControl.byCharacter(created.characterKey)?.state, 'revoked');
    assert.equal(evidence.controllerStarted, false); assert.equal(evidence.modelCalled, false);
  });
  await check('browser_runtime_errors_empty_and_auth_is_fixture_only', async () => {
    assert.deepEqual(diagnostics.pageErrors, []); assert.deepEqual(diagnostics.consoleErrors, []);
    assert.ok(diagnostics.failedRequests.every(request => !/localhost|127\.0\.0\.1/.test(request.url)), JSON.stringify(diagnostics.failedRequests));
  });
  controllerCode = null;
} catch (error) {
  // Do not serialize DOM state or exception details that could contain the one-use code.
  evidence.errors.push(String(error?.message || 'browser acceptance failed').replace(/[0-9a-f]{64}/gi, '[redacted-code]'));
  evidence.failureStage = stage;
  evidence.failureState = await page?.evaluate(() => ({
    panelHidden: document.querySelector('.mn-companions-panel')?.hidden,
    createHidden: document.querySelector('.mn-companion-create')?.hidden,
    pairingHidden: document.querySelector('.mn-companion-pairing')?.hidden,
    pairingStatus: document.querySelector('.mn-companion-pairing-status')?.textContent,
    pairingState: (() => { const state = window.__mn?.panels?.companionsPanel?.pairingEditor?.client?.snapshot();
      return state && { status: state.status, enabled: state.enabled, codePresent: Boolean(state.code), message: state.message }; })(),
    creationBack: document.querySelector('.mn-companion-create-back')?.textContent,
  })).catch(() => null);
  process.exitCode = 1;
} finally {
  controllerCode = null;
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
  try { await game?.close(); } catch {}
  if (db) { try { await db.exec('RESET ROLE'); } catch {} try { await db.close(); } catch {} }
  if (tempPath && tempCanonical) {
    try { const base = await realpath(tmpdir()), current = await realpath(tempPath);
      assert.equal(current, tempCanonical); assert.ok(basename(current).startsWith('mn-companion-pairing-qa-'));
      assert.ok(resolve(current).startsWith(`${resolve(base)}${sep}`)); await rm(current, { recursive: true, force: true });
    } catch (error) { evidence.errors.push(`temporary SQL cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  await mkdir(OUTPUT, { recursive: true });
  await fs.promises.writeFile(resolve(OUTPUT, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

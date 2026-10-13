// Local full-game browser acceptance for owner-controlled Salty Shore companion presence.
// Auth is simulated and all gameplay/companion data is memory-backed; no controller or model runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { presenceSafety } from '../server/companionPresencePolicy.mjs';
import { companionCreationConfig, DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { GAME } from '../src/data/meta.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const WORLD = 'companion-presence-browser-fixture';
const CREATION = '30000000-0000-4000-8000-000000000017';
const OUTPUT = resolve(process.env.MN_COMPANION_PRESENCE_QA_OUTPUT || 'docs/delivery/l03g-companion-presence/browser');
const ANGLE = process.env.MN_COMPANION_PRESENCE_QA_ANGLE || 'default';
assert.equal(ANGLE, 'default', 'presence QA uses the default Chrome ANGLE renderer');
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function waitUntil(predicate, timeoutMs = 15000, label = 'fixture state') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(25); }
  throw new Error(`Timed out waiting for ${label}`);
}

function fixtureStore() {
  const store = createMemoryStore();
  const createCompanion = store.createCompanion.bind(store), loadCompanionCreation = store.loadCompanionCreation.bind(store);
  store.loadCompanionCreation = async scope => {
    const record = await loadCompanionCreation(scope);
    if (!record) return record;
    const control = await store.loadCompanionControl({ ...scope, character: record.characterKey });
    return { ...record, control };
  };
  store.createCompanion = async input => {
    const result = await createCompanion(input);
    if (result?.ok && !result.replay) await store.saveCompanionControl({ world: input.world, owner: input.owner,
      character: result.record.characterKey, expectedRevision: 0, stopped: true });
    return result;
  };
  return store;
}

async function routes(context) {
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const base = match?.[1].startsWith('three') ? 'node_modules/three'
      : (process.env.MN_GSAP || 'C:/DEV/real of trade/realms-of-trade-server/.scratch/gsap-local/package');
    const file = match && resolve(base, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(file) });
  });
}

async function setupAuth(context) {
  await context.addInitScript(({ accountId, token }) => {
    let listener, session = { access_token: token, user: { id: accountId, email: 'presence-fixture@example.invalid' } };
    window.__mnFixtureAuth = { signOut() { session = null; listener?.('SIGNED_OUT', null); } };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => ({ data: { session }, error: null }), signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => { window.__mnFixtureAuth.signOut(); return { error: null }; },
    } }) };
  }, { accountId: OWNER, token: 'owner-presence-fixture' });
  await routes(context);
}

const diagnostics = { pageErrors: [], consoleErrors: [], failedRequests: [] };
const evidence = { schema: 'l03g-companion-presence-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: true, gameplay: 'memory store; not durable', durableProductionGate: false, production: false,
  controllerStarted: false, modelCalled: false, inferenceCredentialsPresent: false,
  rendering: { browser: 'Chrome headless', angle: ANGLE }, checks: [], screenshots: [], errors: [], diagnostics,
  fixture: { account: OWNER, world: WORLD, startingPresence: 'resting', controlStopped: true },
  limitations: ['Authentication is simulated and companion/gameplay records use the in-memory store.',
    'The disabled-host and recovery messages are UI projections exercised locally; production SQL readiness is covered separately.',
    'No controller process, provider request, credential, or model inference is used.'] };
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function shot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))); });
  await page.waitForTimeout(120);
  await page.screenshot({ path: resolve(OUTPUT, name), fullPage: false }); evidence.screenshots.push(name);
}
async function openGame(context, origin, viewport) {
  const page = await context.newPage(); await page.setViewportSize(viewport);
  page.on('pageerror', error => diagnostics.pageErrors.push(error.stack || error.message));
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
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence-status')?.textContent === 'Estado actualizado.');
}
async function button(page, text) { return page.locator('.mn-companion-presence button').filter({ hasText: text }); }
async function presenceLayout(page, width, height) {
  const result = await page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right,
      bottom: r.bottom, width: r.width, height: r.height }; };
    const panel = document.querySelector('.mn-companions-panel'), presence = document.querySelector('.mn-companion-presence');
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      panel: rect(panel), panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth,
      presence: rect(presence), presenceScrollWidth: presence.scrollWidth, presenceClientWidth: presence.clientWidth,
      buttons: [...presence.querySelectorAll('button:not([hidden])')].map(node => { const r = node.getBoundingClientRect();
        return { text: node.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }; }) };
  });
  assert.deepEqual(result.viewport, { width, height });
  assert.ok(result.documentWidth <= width, JSON.stringify(result));
  assert.ok(result.panel.left >= -1 && result.panel.right <= width + 1 && result.panel.top >= -1 && result.panel.bottom <= height + 1,
    `companion panel outside viewport: ${JSON.stringify(result)}`);
  assert.ok(result.panelScrollWidth <= result.panelClientWidth + 1, `panel horizontal overflow: ${JSON.stringify(result)}`);
  assert.ok(result.presenceScrollWidth <= result.presenceClientWidth + 1, `presence horizontal overflow: ${JSON.stringify(result)}`);
  for (const control of result.buttons) assert.ok(control.height >= 44 && control.left >= result.presence.left - 1 && control.right <= result.presence.right + 1,
    `presence action is too small or overflows: ${JSON.stringify(control)}`);
  return result;
}

let game = null, browser = null, context = null, page = null, stage = 'startup', characterKey = null;
try {
  await mkdir(OUTPUT, { recursive: true });
  const store = fixtureStore();
  const preset = structuredClone(DEFAULT_COMPANION_PRESET);
  assert.equal(preset.name, 'Brisa');
  const seeded = await store.createCompanion({ world: WORLD, owner: OWNER, creationId: CREATION,
    preset, config: companionCreationConfig(preset) });
  assert.equal(seeded.ok, true); characterKey = seeded.record.characterKey;
  assert.equal((await store.loadCompanionControl({ world: WORLD, owner: OWNER, character: characterKey })).stopped, true);
  game = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4, dev: false, log() {}, store,
    resolvePlayer: async (_req, { token }) => token === 'owner-presence-fixture' ? OWNER : null,
    worldId: WORLD, saveSecret: 'presence-fixture-only',
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_presence_fixture' },
    gmAccountIds: [OWNER], gmDraftsAllowMemory: true,
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true,
    companionPresence: true, companionPresenceAllowMemory: true,
    agentControl: { worldId: WORLD, bindings: [] }, inferenceCatalog: [] });
  const port = await game.listen(), origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'es-MX' }); await setupAuth(context);
  page = await openGame(context, origin, { width: 1280, height: 720 });
  stage = 'seeded-Brisa';
  await check('memory_fixture_starts_with_Brisa_and_stopped_controller', async () => {
    assert.equal(seeded.record.preset.name, 'Brisa');
    assert.equal((await store.loadCompanionControl({ world: WORLD, owner: OWNER, character: characterKey })).stopped, true);
    assert.equal(game.game.companionPresence.ready, true);
  });
  await openPanel(page);
  await check('Mis_compañeros_shows_compact_safe_port_presence_before_the_list', async () => {
    const section = page.locator('.mn-companion-presence');
    assert.equal(await section.locator('h3').textContent(), 'Presencia en Salty Shore');
    assert.match(await section.textContent(), /Primero vuelve al punto de llegada de Salty Shore/);
    assert.match(await section.textContent(), /no habilita combate ni recolecci(?:ó|Ã³)n/);
    assert.match(await section.textContent(), /IA y el emparejamiento se controlan por separado/);
    assert.notEqual(await page.locator('.mn-companions-panel').evaluate(panel =>
      panel.querySelector('.mn-companion-presence').compareDocumentPosition(panel.querySelector('.mn-companions-list')) & Node.DOCUMENT_POSITION_FOLLOWING), 0,
      'presence panel precedes the companion list');
    assert.match(await section.textContent(), /Brisa: en reposo/);
  });
  await check('desktop_1280x720_ES_presence_panel_has_no_horizontal_overflow', async () => {
    evidence.layouts ||= {}; evidence.layouts.desktopEs = await presenceLayout(page, 1280, 720);
  });
  await shot(page, 'presence-desktop-es-resting.png');

  stage = 'join';
  await (await button(page, 'Salir conmigo')).click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence-state')?.textContent?.includes('Brisa: presente')
    || document.querySelector('.mn-companion-presence')?.textContent?.includes('Brisa: presente'));
  await check('Salir_conmigo_spawns_normal_host_body_without_resuming_the_mind', async () => {
    const entry = game.game.companionPresence.entries.get(OWNER);
    assert.ok(entry?.body); assert.equal(entry.record.characterKey, characterKey);
    assert.equal(entry.body.entity > 0, true);
    assert.equal(game.game.server.clients.get(entry.body.id).companionResident, true);
    assert.equal(game.game.server.humans, 2, 'owner and companion use ordinary world slots');
    assert.equal((await store.loadCompanionControl({ world: WORLD, owner: OWNER, character: characterKey })).stopped, true);
    assert.equal(game.game.companionPairing.codes.size, 0);
    assert.equal(game.game.companionPairing.admitted.size, 0);
    evidence.body = { present: true, entity: entry.body.entity, order: entry.order, slotCount: game.game.server.humans,
      controllerStopped: true, pairingCodeCount: 0, admittedControllerCount: 0 };
  });
  await shot(page, 'presence-desktop-es-present.png');

  stage = 'follow-wait-return-retire';
  const entry = game.game.companionPresence.entries.get(OWNER), world = game.game.server.world, anchor = world.map.landmarks.spawn;
  const ownerEntity = game.game.server.clients.get(entry.ownerSock.id).entity;
  const ownerOffset = [[2, 0], [0, 2], [-2, 0], [0, -2]].find(([dx, dz]) =>
    Math.hypot(world.ecs.x[ownerEntity] + dx - anchor.x, world.ecs.z[ownerEntity] + dz - anchor.z) < 10);
  assert.ok(ownerOffset);
  world.ecs.x[ownerEntity] += ownerOffset[0]; world.ecs.z[ownerEntity] += ownerOffset[1];
  await (await button(page, 'Sígueme')).click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence')?.textContent.includes('Orden: seguir'));
  await check('Sígueme_changes_only_the_server_owned_order', async () => {
    assert.equal(entry.order, 'follow'); assert.equal(entry.body.entity > 0, true);
    assert.equal((await store.loadCompanionControl({ world: WORLD, owner: OWNER, character: characterKey })).stopped, true);
  });
  await (await button(page, 'Espera aquí')).click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence')?.textContent.includes('Orden: esperar'));
  assert.equal(entry.order, 'wait');
  await check('Espera_aquí_keeps_the_body_present', async () => {
    assert.ok(entry.body); assert.equal(entry.order, 'wait');
  });

  const bodyEntity = entry.body.entity;
  await waitUntil(() => Math.hypot(world.ecs.vx[bodyEntity], world.ecs.vz[bodyEntity]) < 0.05,
    5000, 'companion momentum to settle before the return order');
  const bodyOffset = [[1.7, 0], [0, 1.7], [-1.7, 0], [0, -1.7]].find(([dx, dz]) =>
    Math.hypot(world.ecs.x[bodyEntity] + dx - anchor.x, world.ecs.z[bodyEntity] + dz - anchor.z) < 3);
  assert.ok(bodyOffset); world.ecs.x[bodyEntity] = anchor.x + bodyOffset[0]; world.ecs.z[bodyEntity] = anchor.z + bodyOffset[1];
  world.ecs.vx[bodyEntity] = 0; world.ecs.vz[bodyEntity] = 0;
  await (await button(page, 'Volver al ancla')).click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence')?.textContent.includes('Orden: volver'));
  await check('Volver_al_ancla_moves_toward_the_safe_anchor', async () => {
    assert.equal(entry.order, 'return');
    assert.ok(Math.hypot(world.ecs.x[bodyEntity] - anchor.x, world.ecs.z[bodyEntity] - anchor.z) > 0.8);
  });
  await waitUntil(() => entry.order === 'wait', 7000, 'companion to walk back to the anchor');
  await waitUntil(() => presenceSafety(world, bodyEntity, { anchor: true, fullHealth: true }) === null,
    5000, 'companion to settle safely at the anchor');
  await (await button(page, 'Actualizar presencia')).click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence')?.textContent.includes('Orden: esperar'));
  await (await button(page, 'Descansar en el puerto')).click();
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence')?.textContent.includes('Brisa: en reposo'));
  await check('Descansar_en_el_puerto_retires_only_after_returning_healthy', async () => {
    assert.equal(entry.body, null); assert.equal(entry.head.active, false);
    assert.equal(game.game.server.humans, 1);
    const control = await store.loadCompanionControl({ world: WORLD, owner: OWNER, character: characterKey });
    assert.equal(control.stopped, true); assert.equal(game.game.agentControl.byCharacter(characterKey), null);
    evidence.body = { ...evidence.body, retiredAtAnchor: true, controlStoppedAfterPresence: control.stopped,
      profileAndControllerUntouched: true };
  });

  stage = 'disabled-recovery-copy';
  const recoveryProjection = { characterKey, name: 'Brisa', status: 'recovery', order: 'return', revision: entry.revision + 1,
    entity: null, reason: 'recovery_required' };
  await page.evaluate(state => window.__mn.panels.companionsPanel.presencePanel.setState(state),
    { status: 'error', enabled: false, presence: recoveryProjection, message: 'recovery_required' });
  await check('disabled_host_hides_actions_and_preserves_recovery_message', async () => {
    const panel = page.locator('.mn-companion-presence');
    assert.match(await panel.textContent(), /El control de presencia está apagado/);
    assert.match(await panel.textContent(), /El compañero quedó fuera durante un reinicio/);
    assert.match(await panel.textContent(), /no se invocará de nuevo/);
    assert.equal(await panel.locator('.mn-companion-presence-actions').isHidden(), true);
    evidence.disabledHostAndRecovery = { projectionSimulated: true, actionsHidden: true, copyRetained: true };
  });
  await shot(page, 'presence-desktop-es-disabled-recovery.png');

  stage = 'mobile-en';
  await page.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.mn-companion-presence h3')?.textContent === 'Presence at Salty Shore');
  await check('English_mobile_390x844_copy_and_presence_layout_fit', async () => {
    const panel = page.locator('.mn-companion-presence');
    assert.match(await panel.textContent(), /AI and pairing are controlled separately/);
    assert.match(await panel.textContent(), /Safe-zone pilot: combat and harvesting are unavailable/);
    assert.match(await panel.textContent(), /will not be summoned again/);
    evidence.layouts.mobileEn = await presenceLayout(page, 390, 844);
  });
  await shot(page, 'presence-mobile-en-disabled-recovery.png');

  stage = 'mobile-layout-active';
  const ui = page.locator('.mn-companion-presence');
  await page.evaluate(state => window.__mn.panels.companionsPanel.presencePanel.setState(state),
    { status: 'ready', enabled: true, presence: { ...recoveryProjection, status: 'resting', order: 'wait', reason: null }, message: '' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(100);
  await check('landscape_844x390_actions_are_reachable_and_touch_sized', async () => {
    const layout = await presenceLayout(page, 844, 390); evidence.layouts.landscapeEn = layout;
    for (const op of ['join', 'follow', 'wait', 'return', 'retire']) {
      const action = ui.locator(`button[data-op="${op}"]`);
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox(); assert.ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 844,
        `${op} action is not reachable at landscape width: ${JSON.stringify(box)}`);
    }
  });
  await shot(page, 'presence-landscape-en-actions.png');
  await check('browser_errors_empty_and_fixture_never_started_a_model', async () => {
    assert.deepEqual(diagnostics.pageErrors, []); assert.deepEqual(diagnostics.consoleErrors, []);
    assert.equal(evidence.controllerStarted, false); assert.equal(evidence.modelCalled, false);
    assert.equal(game.game.companionPairing.tokens.size, 0); assert.equal(game.game.companionPairing.admitted.size, 0);
  });
} catch (error) {
  evidence.errors.push(String(error?.stack || error?.message || 'browser acceptance failed').replace(/[0-9a-f]{64}/gi, '[redacted]'));
  evidence.failureStage = stage;
  evidence.failureState = await page?.evaluate(() => ({
    panelHidden: document.querySelector('.mn-companions-panel')?.hidden,
    presenceHidden: document.querySelector('.mn-companion-presence')?.hidden,
    presenceText: document.querySelector('.mn-companion-presence')?.textContent?.slice(0, 600),
    client: (() => { const value = window.__mn?.panels?.companionsPanel?.presencePanel?.state;
      return value && { status: value.status, enabled: value.enabled, presenceStatus: value.presence?.status, order: value.presence?.order, message: value.message }; })(),
  })).catch(() => null);
  process.exitCode = 1;
} finally {
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
  try { await game?.close(); } catch {}
  await mkdir(OUTPUT, { recursive: true });
  await fs.promises.writeFile(resolve(OUTPUT, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

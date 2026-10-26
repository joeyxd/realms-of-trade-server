// Real-browser GM04b acceptance: simulated local auth or one-use public GM login; edits stay in local draft/library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDecoration, createDocument } from '../src/editor/document.js';

const out = resolve(process.env.MN_GM_QA_OUTPUT || 'docs/delivery/gm04b');
const publicOrigin = process.env.MN_GM_QA_ORIGIN?.replace(/\/+$/, '');
const production = !!publicOrigin;
const prefix = production ? 'public' : 'local';
const evidencePath = resolve(out, `${prefix}-browser-evidence.json`);
const GM = '77777777-7777-4777-8777-777777777777';
const evidence = { schema: 'gm04b-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: !production, production, checks: [], screenshots: [], errors: [], assetRequests: [],
  injectedScenarios: { missingAsset: 'uploaded same-base test library with an unknown model id; no project asset was changed',
    casConflict: 'second TemplateStore instance advanced the same IndexedDB world key',
    draftWrites: 'fixture and placement edits remained in the fresh browser-local draft' } };
let browser, context, guestContext, page, game, origin = publicOrigin, seededDocument;
const remoteMutations = [];
let publicBefore = null, phase = 'initializing';
function safePublicError(error) {
  return `${error?.name || 'Error'}:${error?.message || String(error)}`
    .replace(/gm_setup_token=[^\s&"'<>]+/gi, 'gm_setup_token=[REDACTED]')
    .replace(/#\S+/g, '#[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:access_token|refresh_token|token_hash|tokenHash)[=: ]+[^\s,&"'<>]+/gi, '[TOKEN_FIELD_REDACTED]');
}
async function runtimeSnapshot(base) {
  const [statusResponse, contentResponse] = await Promise.all([
    fetch(`${base}/status`, { cache: 'no-store' }), fetch(`${base}/api/world/content`, { cache: 'no-store' }),
  ]);
  assert.equal(statusResponse.status, 200); assert.equal(contentResponse.status, 200);
  const status = await statusResponse.json(), content = await contentResponse.json();
  return { version: status.version, protocolVersion: status.protocolVersion ?? null,
    content: { generation: content.generation, revisionId: content.revisionId } };
}

async function check(name, fn) {
  await fn(); evidence.checks.push(name); console.log(`PASS ${name}`);
}
async function shot(name) {
  await shotFrom(page, name);
}
async function shotFrom(target, name) {
  const file = `${prefix}-${name}`;
  await target.screenshot({ path: resolve(out, file), fullPage: true }); evidence.screenshots.push(file);
}
async function setup(ctx) {
  await ctx.addInitScript((accountId) => {
    const session = { access_token: 'gm04b-fixture', user: { id: accountId, email: 'qa@example.invalid' } };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }), onAuthStateChange() {},
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }), signOut: async () => ({ error: null }),
    } }) };
  }, GM);
  await ctx.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : (process.env.MN_GSAP || '.scratch/gsap-local/package'), match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}

try {
  phase = 'output_directory_and_public_configuration';
  await mkdir(out, { recursive: true });
  if (production && !process.env.MN_GM_SETUP_FILE) throw new Error('MN_GM_SETUP_FILE is required for public account setup');
  if (!production) {
    game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log: () => {},
      saveSecret: 'gm04b-browser-fixture-only', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_gm04b_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'gm04b-fixture' ? GM : null,
    });
    const port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  }
  phase = 'runtime_status_and_content_snapshot_before';
  publicBefore = await runtimeSnapshot(origin);
  assert.equal(publicBefore.version, GAME.version, 'server /status version must match runner checkout');
  evidence.runtimeBefore = publicBefore;
  phase = 'browser_import_and_launch';
  const playwrightPath = resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs');
  evidence.playwrightModule = playwrightPath;
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });

  if (production) {
    phase = 'public_guest_boot';
    guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guest = await guestContext.newPage(); page = guest;
    guest.on('pageerror', () => evidence.errors.push('guest_page_error'));
    await guest.goto(`${origin}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
    await guest.waitForFunction(() => !!window.__mn, null, { timeout: 90000 });
    await guest.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
    evidence.guestBoot = await guest.evaluate(() => ({ online: __mn.st.online, transport: __mn.transport.kind,
      serverMarked: !!document.querySelector('meta[name="mn-server"]'), gmButtonHidden: __mn.gmEntry.button.hidden }));
    assert.equal(await guest.evaluate(() => __mn.gmEntry.button.hidden), true);
    phase = 'public_guest_gameplay_join';
    await guest.waitForFunction(() => { const button = document.querySelector('#btn-play'); return button && !button.disabled; });
    await guest.locator('#btn-play').click({ force: true });
    await guest.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
    await guest.waitForFunction(() => document.querySelector('#title')?.hidden === true && !__mn.st.boarding &&
      !document.querySelector('#btn-play')?.textContent?.toLowerCase().includes('boarding'), null, { timeout: 10000 });
    await guest.waitForFunction(() => {
      const hud = document.querySelector('#hud');
      return hud && !hud.hidden && __mn.input.enabled && __mn.world.rig.blend === null;
    }, null, { timeout: 15000 });
    await guest.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    evidence.guestCaptureState = await guest.evaluate(() => ({ titleHidden: document.querySelector('#title')?.hidden === true,
      hudVisible: !document.querySelector('#hud')?.hidden && getComputedStyle(document.querySelector('#hud')).display !== 'none',
      gameplayInputEnabled: __mn.input.enabled, cameraBlendFinished: __mn.world.rig.blend === null,
      playerHudOpacity: getComputedStyle(document.querySelector('#hud .hud-player')).opacity,
      actionbarOpacity: getComputedStyle(document.querySelector('#hud .actionbar')).opacity }));
    assert.equal(evidence.guestCaptureState.titleHidden, true); assert.equal(evidence.guestCaptureState.hudVisible, true);
    assert.equal(evidence.guestCaptureState.gameplayInputEnabled, true); assert.equal(evidence.guestCaptureState.cameraBlendFinished, true);
    assert.equal(evidence.guestCaptureState.playerHudOpacity, '1'); assert.equal(evidence.guestCaptureState.actionbarOpacity, '1');
    assert.deepEqual(await guest.evaluate(() => [...__mn.errors]), []);
    await shotFrom(guest, 'guest-gameplay.png');
    evidence.checks.push('public_guest_boot_and_gameplay_join');
    await guestContext.close(); guestContext = null; page = null;
  }

  phase = 'gm_context_and_network_observers';
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (!production) await setup(context);
  page = await context.newPage();
  page.on('pageerror', () => evidence.errors.push('gm_page_error'));
  page.on('request', (request) => {
    const url = request.url();
    if (/\/assets\/(models|editor)\/.*\.glb/.test(url)) evidence.assetRequests.push(new URL(url).pathname);
    if (production && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
        /\/api\/(?:gm(?:\/|$)|world\/(?:content|draft|publication)(?:\/|$)|(?:draft|publication|content)(?:\/|$))/i.test(new URL(url).pathname)) {
      remoteMutations.push({ method: request.method(), path: new URL(url).pathname });
    }
  });
  let setupSuffix = '';
  if (production) {
    phase = 'consume_one_use_setup_file';
    const setupFile = resolve(process.env.MN_GM_SETUP_FILE);
    let setupRecord;
    try { setupRecord = JSON.parse(await fs.promises.readFile(setupFile, 'utf8')); }
    finally { await fs.promises.unlink(setupFile); }
    assert.match(setupRecord?.tokenHash || '', /^[a-f0-9]{32,128}$/i);
    setupSuffix = `&account-setup=1#gm_setup_token=${setupRecord.tokenHash}`;
  }
  phase = 'gm_page_boot';
  await page.goto(`${origin}/?q=${production ? 'high' : (process.env.MN_GM_QA_QUALITY || 'high')}&tod=day${setupSuffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-gm-editor').disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  const loadedRuntime = await page.evaluate(async () => {
    const [meta, protocol] = await Promise.all([import('/src/data/meta.js'), import('/src/net/protocol.js')]);
    return { version: meta.GAME.version, protocolVersion: protocol.PROTOCOL_VERSION };
  });
  assert.equal(loadedRuntime.version, GAME.version, 'browser-loaded GAME.version must match runner checkout');
  assert.equal(loadedRuntime.protocolVersion, PROTOCOL_VERSION, 'browser-loaded protocol must match runner checkout');
  evidence.loadedRuntime = loadedRuntime;
  if (publicBefore.protocolVersion !== null) assert.equal(loadedRuntime.protocolVersion, publicBefore.protocolVersion,
    'browser-loaded protocol must match /status protocol');
  if (production) {
    phase = 'gm_recovery_link_and_cancel';
    await page.waitForFunction(() => __mn.gmEntry?.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.addStyleTag({ content: '.account-status, .account-email { visibility: hidden !important; }' });
    await shot('account-setup.png');
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('.gm-account-setup-overlay')?.hidden);
    evidence.checks.push('public_one_use_account_setup_link_is_consumed_and_cancelled');
  }

  // Build a private six-piece fixture: three portable models and three real editable base decorations.
  phase = 'gm04b_fixture_and_template_panel';
  const scene = await page.evaluate(() => ({ seed: __mn.map.seed >>> 0,
    anchor: __mn.map.landmarks?.village || __mn.map.landmarks?.spawn || { x: 0, z: 0 } }));
  const map = generateWorld(scene.seed);
  let site = null;
  for (let ring = 20; ring <= 48 && !site; ring += 4) for (let a = 0; a < 32 && !site; a++) {
    const angle = a * Math.PI / 16, x = scene.anchor.x + Math.cos(angle) * ring, z = scene.anchor.z + Math.sin(angle) * ring;
    if (Math.abs(x) > 260 || Math.abs(z) > 260 || map.groundAt(x, z) < 1.5 ||
        map.props.some((prop) => Math.hypot(prop.x - x, prop.z - z) < 5) ||
        map.colliders.some((collider) => Math.hypot(collider.x - x, collider.z - z) < collider.r + 4)) continue;
    site = { x, z };
  }
  assert.ok(site, 'fixture requires a clear spot near the village');
  let secondSite = null;
  for (let ring = 10; ring <= 28 && !secondSite; ring += 3) for (let a = 0; a < 32 && !secondSite; a++) {
    const angle = a * Math.PI / 16, x = site.x + Math.cos(angle) * ring, z = site.z + Math.sin(angle) * ring;
    if (Math.abs(x) > 260 || Math.abs(z) > 260 || map.groundAt(x, z) < 1.5 ||
        map.props.some((prop) => Math.hypot(prop.x - x, prop.z - z) < 5) ||
        map.colliders.some((collider) => Math.hypot(collider.x - x, collider.z - z) < collider.r + 4)) continue;
    secondSite = { x, z };
  }
  assert.ok(secondSite, 'fixture requires a second clear ground placement site');
  evidence.fixtureSite = site;
  evidence.secondFixtureSite = secondSite;
  const specs = [
    ['qa-gm04b-crate', 'prop:storage-crate', site.x - 1.5, site.z, { type: 'circle', radius: 0.8 }],
    ['qa-gm04b-planks', 'model:beach-debris-planks-v1', site.x + 1.5, site.z, 'none'],
    ['qa-gm04b-log', 'model:beach-debris-log-v1', site.x + 1, site.z + 2, 'none'],
  ];
  const objects = specs.map(([id, assetId, x, z, collider]) => createDecoration({ id, assetId,
    position: { x, y: map.groundAt(x, z), z }, collider }));
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
  await page.waitForFunction(() => __mn.gmEditor.templatePanel?.state === 'ready');
  const editorScene = await page.evaluate(() => {
    const editor = __mn.gmEditor, anchor = editor.map.landmarks?.village || editor.map.landmarks?.spawn || { x: 0, z: 0 };
    const choose = (kind) => editor.baseEntries.filter((item) => item.kind === kind)
      .sort((a, b) => ((a.transform.position.x - anchor.x) ** 2 + (a.transform.position.z - anchor.z) ** 2) -
        ((b.transform.position.x - anchor.x) ** 2 + (b.transform.position.z - anchor.z) ** 2))[0];
    return { baseRevision: editor.baseRevision, worldId: editor.worldId,
      bases: ['rock', 'flower', 'pebble'].map(choose).filter(Boolean).map((item) => ({ id: item.id, kind: item.kind })) };
  });
  Object.assign(scene, editorScene);
  assert.equal(scene.bases.length, 3, 'fixture requires an editable base rock, flower, and pebble');
  seededDocument = createDocument({ seed: scene.seed, baseRevision: scene.baseRevision, objects });
  await page.evaluate(async ({ document, bases, site }) => {
    const editor = __mn.gmEditor;
    for (const assetId of new Set(document.objects.map((item) => item.assetId))) {
      const entry = editor._entryForAsset(assetId);
      if (!entry) throw new Error('Fixture asset missing from catalog: ' + assetId);
      await editor.assets.ensureModel(entry, { base: entry.base || 'assets/' });
      if (!editor.assets.model(assetId)) throw new Error('Fixture model failed to load: ' + assetId);
    }
    editor._commit(document);
    // Put the three generated-base samples near the prop fixture with the real selection transform contract.
    const { updateSelection } = await import('/src/editor/selection.js');
    const selected = bases.map((entry) => editor._selectedItem(entry.id, editor.history.current()));
    if (selected.length !== 3 || selected.some((item) => !item)) throw new Error('Fixture needs editable base rock, flower, and pebble entries');
    const offsets = { rock: [-2.5, 2.6], flower: [0, 2.6], pebble: [2.5, 2.6] };
    const moved = selected.map((item) => {
      const [dx, dz] = offsets[editor.baseLayer.get(item.id).kind], x = site.x + dx, z = site.z + dz;
      return { id: item.id, transform: { ...item.transform,
        position: { x, y: editor.map.groundAt(x, z), z } } };
    });
    editor._commit(updateSelection(editor.history.current(), selected, moved));
    if (!await editor.saveNow()) throw new Error('Could not save isolated GM04b fixture draft');
  }, { document: seededDocument, bases: scene.bases, site });
  seededDocument = await page.evaluate(() => __mn.gmEditor.history.current());
  await page.waitForFunction(() => ['qa-gm04b-crate', 'qa-gm04b-planks', 'qa-gm04b-log'].every((id) => __mn.gmEditor.records.has(id)));
  await check('fixture_loads_optimized_crate_and_beach_debris_with_live_base_decoration', async () => {
    const state = await page.evaluate(() => ({ joined: __mn.client.joined,
      assets: __mn.gmEditor.history.current().objects.map((item) => item.assetId),
      baseKinds: ['rock', 'flower', 'pebble'].map((kind) => __mn.gmEditor.baseEntries.some((item) => item.kind === kind)),
      models: ['qa-gm04b-crate', 'qa-gm04b-planks', 'qa-gm04b-log'].map((id) =>
        !!__mn.gmEditor.records.get(id)?.root.getObjectByProperty('isMesh', true)) }));
    assert.equal(state.joined, false);
    assert.deepEqual(state.assets.sort(), ['model:beach-debris-log-v1', 'model:beach-debris-planks-v1', 'prop:storage-crate'].sort());
    assert.deepEqual(state.baseKinds, [true, true, true]); assert.deepEqual(state.models, [true, true, true]);
    assert.ok(evidence.assetRequests.some((url) => url.includes('prop-storage-crate')));
    assert.ok(evidence.assetRequests.some((url) => url.includes('beach-debris-planks')));
  });

  const setSelection = async (ids) => {
    await page.locator('[data-action="tab-scene"]').click();
    for (const id of ids) {
      await page.locator('[data-role="scene-search"]').fill(id);
      const row = page.locator('[data-selection-id="' + id + '"]');
      await row.waitFor({ state: 'visible' });
      if (!await row.isChecked()) await row.check();
    }
  };
  const selectedBaseIds = await page.evaluate(() => {
    const editor = __mn.gmEditor, anchor = editor.map.landmarks?.village || editor.map.landmarks?.spawn || { x: 0, z: 0 };
    return ['rock', 'flower', 'pebble'].map((kind) => editor.baseEntries.filter((item) => item.kind === kind)
      .sort((a, b) => ((a.transform.position.x - anchor.x) ** 2 + (a.transform.position.z - anchor.z) ** 2) -
        ((b.transform.position.x - anchor.x) ** 2 + (b.transform.position.z - anchor.z) ** 2))[0].id);
  });
  const fixtureIds = [...specs.map(([id]) => id), ...selectedBaseIds];
  await setSelection(fixtureIds);
  const templatePreflight = await page.evaluate(async () => {
    const editor = __mn.gmEditor, items = editor._selectedItems();
    const { createTemplate } = await import('/src/editor/templates.js');
    try { createTemplate({ id: 'qa-preflight', name: 'preflight', document: editor.history.current(), items }); return { ok: true }; }
    catch (error) { return { ok: false, code: error.code || error.name, items: items.map((item) => ({ id: item.id, base: item.base, hidden: item.hidden,
      y: item.transform?.position?.y, collider: item.collider })), base: editor.history.current().base }; }
  });
  if (!templatePreflight.ok) throw new Error('Template preflight failed: ' + JSON.stringify(templatePreflight));
  await check('selects_a_real_mixed_model_and_base_rock_flower_pebble_group', async () => {
    const state = await page.evaluate(() => ({ selected: [...__mn.gmEditor.selectedIds],
      kinds: __mn.gmEditor._selectedItems().filter((item) => item.base).map((item) => item.base && __mn.gmEditor.baseLayer.get(item.id)?.kind).sort(),
      count: __mn.gmEditor.templatePanel.count.textContent }));
    assert.deepEqual(state.selected.sort(), fixtureIds.slice().sort());
    assert.deepEqual(state.kinds, ['flower', 'pebble', 'rock']);
    assert.match(state.count, /0\s*\/\s*32/);
  });

  await page.locator('[data-action="tab-templates"]').click();
  await page.locator('[data-template-name]').fill('GM04b mixed garden');
  await page.locator('[data-template-action="save"]').click();
  await page.waitForFunction(() => __mn.gmEditor.templatePanel.library.templates.length === 1);
  const sourceTemplate = await page.evaluate(() => structuredClone(__mn.gmEditor.templatePanel.library.templates[0]));
  await check('create_search_and_rename_persist_a_relative_six_piece_template', async () => {
    assert.equal(sourceTemplate.objects.length, 6);
    assert.deepEqual(sourceTemplate.objects.filter((item) => item.assetId.startsWith('base:')).map((item) => item.assetId.split(':')[1]).sort(),
      ['flower', 'pebble', 'rock']);
    assert.ok(sourceTemplate.objects.some((item) => item.assetId === 'prop:storage-crate'));
    const position = sourceTemplate.objects.map((item) => item.transform.position);
    assert.ok(Math.abs(position.reduce((n, item) => n + item.x, 0) / 6) < 1e-8);
    assert.ok(Math.abs(position.reduce((n, item) => n + item.z, 0) / 6) < 1e-8);
    assert.equal(Math.min(...position.map((item) => item.y)), 0);
    await page.locator('[data-template-search]').fill('mixed garden');
    assert.equal(await page.locator('[data-template-list] [data-template-id]').count(), 1);
    await page.locator('[data-template-search]').fill('no such template');
    assert.equal(await page.locator('[data-template-list] [data-template-id]').count(), 0);
    await page.locator('[data-template-search]').fill('');
    await page.locator('[data-template-name]').fill('GM04b named garden');
    await page.locator('[data-template-action="rename"]').click();
    await page.waitForFunction(() => __mn.gmEditor.templatePanel.library.templates[0]?.name === 'GM04b named garden');
    assert.equal(await page.evaluate(() => __mn.gmEditor.templatePanel.library.templates[0].id), sourceTemplate.id);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), seededDocument);
  });
  await page.locator('[data-template-id="' + sourceTemplate.id + '"]').click();
  await page.waitForFunction(() => !!__mn.gmEditor.pendingTemplate && !!__mn.gmEditor.ghost);
  await check('template_ghost_loads_all_model_and_base_members_without_committing', async () => {
    const state = await page.evaluate(() => ({ count: __mn.gmEditor.ghost.children.length,
      templateCount: __mn.gmEditor.pendingTemplate.template.objects.length,
      modelRequests: [...new Set(__mn.gmEditor.pendingTemplate.template.objects.map((item) => item.assetId))],
      objects: __mn.gmEditor.history.current().objects.length, baseOverrides: __mn.gmEditor.history.current().baseOverrides.length }));
    assert.equal(state.count, 6); assert.equal(state.templateCount, 6); assert.equal(state.objects, 3); assert.equal(state.baseOverrides, 3);
    assert.ok(state.modelRequests.includes('prop:storage-crate'));
    assert.ok(state.modelRequests.some((id) => id.startsWith('base:flower:')));
  });
  if (production) {
    await shot('public-lighting-before-client-capture-adjustment.png');
    const captureLighting = await page.evaluate(async () => {
      const lighting = __mn.world.lighting, before = { gameplay: lighting.gameplay, tod: lighting.tod,
        phase: lighting.phase, zoneTarget: lighting.zoneTarget, zoneW: lighting.zoneW };
      if (before.gameplay) throw new Error('Reference lighting capture requires GM editor outside gameplay');
      const setters = [];
      if (lighting.tod !== 'day') { lighting.setTimeOfDay('day', 0); setters.push('setTimeOfDay(day,0)'); }
      if (lighting.zoneTarget !== 0) { lighting.setZone(false, 0); setters.push('setZone(false,0)'); }
      if (setters.length) {
        __mn.world.pipeline.markDirty(); const frame = __mn.world.pipeline.frame;
        await new Promise((resolve) => {
          const poll = () => __mn.errors.size || __mn.world.pipeline.frame >= frame + 10 ? resolve() : requestAnimationFrame(poll);
          requestAnimationFrame(poll);
        });
      }
      return { scope: 'browser-client-renderer-only', before,
        after: { gameplay: lighting.gameplay, tod: lighting.tod, phase: lighting.phase,
          zoneTarget: lighting.zoneTarget, zoneW: lighting.zoneW,
          sunIntensity: lighting.cur.sunI, hemisphereIntensity: lighting.cur.hemiI },
        setters, remoteOrGameplayWrites: false };
    });
    assert.equal(captureLighting.after.gameplay, false);
    assert.equal(captureLighting.remoteOrGameplayWrites, false);
    evidence.captureLighting = captureLighting;
  }
  await page.locator('[data-template-search]').fill('');
  // Pointer placement uses the actual terrain ray path, preserving offsets and producing fresh IDs per copy.
  const moveGround = async (x, z, close = false) => {
    const point = await page.evaluate(({ x, z, close }) => {
      const editor = __mn.gmEditor, camera = editor.camera;
      const target = { x, y: editor.map.groundAt(x, z) + 0.04, z };
      if (close) camera.position.set(x + 12, target.y + 9, z + 12);
      editor.cameraController.focus(target);
      const v = camera.position.clone().set(target.x, target.y, target.z).project(camera);
      const rect = editor.canvas.getBoundingClientRect();
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) throw new Error('Fixture ground point is outside the camera frustum');
      return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 };
    }, { x, z, close });
    await page.mouse.move(point.x, point.y);
    return point;
  };
  const clickGround = async (x, z) => {
    const point = await moveGround(x, z);
    await page.mouse.click(point.x, point.y);
  };
  await clickGround(site.x, site.z);
  await page.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 9);
  const firstCopy = await page.evaluate(() => __mn.gmEditor.history.current());
  await check('first_pointer_place_expands_all_six_members_as_one_atomic_copy', async () => {
    assert.equal(firstCopy.objects.length, 9);
    const added = firstCopy.objects.filter((item) => !seededDocument.objects.some((source) => source.id === item.id));
    assert.equal(added.length, 6); assert.equal(new Set(added.map((item) => item.id)).size, 6);
    assert.equal(new Set(added.map((item) => item.assetId)).size, 6);
    assert.deepEqual(firstCopy.baseOverrides, seededDocument.baseOverrides);
  });
  const closePoint = await moveGround(site.x + 5, site.z + 5, true);
  await page.waitForFunction(() => __mn.gmEditor.templatePlacement?.document);
  await shot('templates-es-closeup-desktop.png');
  await page.locator('[data-role="language"]').click(); await page.waitForFunction(() => __mn.gmEditor.lang === 'en');
  await shot('templates-en-closeup-desktop.png');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.move(closePoint.x * 844 / 1440, closePoint.y * 390 / 900);
  await page.locator('[data-template-action="import"]').scrollIntoViewIfNeeded();
  await shot('templates-en-closeup-844x390.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await clickGround(secondSite.x, secondSite.z);
  await page.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 15);
  const twoCopies = await page.evaluate(() => __mn.gmEditor.history.current());
  await check('repeated_pointer_place_uses_fresh_ids_preserves_offsets_and_undo_redo_is_per_placement', async () => {
    const first = twoCopies.objects.filter((item) => !seededDocument.objects.some((source) => source.id === item.id));
    assert.equal(first.length, 12); assert.equal(new Set(first.map((item) => item.id)).size, 12);
    const a = first.slice(0, 6), b = first.slice(6);
    const translations = [];
    for (const source of sourceTemplate.objects) {
      const firstItem = a.find((item) => item.assetId === source.assetId), secondItem = b.find((item) => item.assetId === source.assetId);
      assert.ok(firstItem && secondItem);
      translations.push({ x: secondItem.transform.position.x - firstItem.transform.position.x,
        z: secondItem.transform.position.z - firstItem.transform.position.z });
      const firstOriginY = Math.min(...a.map((member) => member.transform.position.y));
      const secondOriginY = Math.min(...b.map((member) => member.transform.position.y));
      assert.ok(Math.abs((secondItem.transform.position.y - secondOriginY) - (firstItem.transform.position.y - firstOriginY)) < 1e-5);
      assert.deepEqual(firstItem.transform.rotation, secondItem.transform.rotation); assert.equal(firstItem.transform.scale, secondItem.transform.scale);
    }
    assert.ok(Math.hypot(translations[0].x, translations[0].z) > 1);
    assert.ok(translations.every((delta) => Math.abs(delta.x - translations[0].x) < 1e-5 && Math.abs(delta.z - translations[0].z) < 1e-5));
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), firstCopy);
    await page.locator('[data-action="redo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), twoCopies);
  });
  await page.keyboard.press('Escape');
  await page.locator('[data-role="language"]').click(); await page.waitForFunction(() => __mn.gmEditor.lang === 'es');
  await page.evaluate(({ site, secondSite }) => {
    const editor = __mn.gmEditor, mid = { x: (site.x + secondSite.x) / 2, z: (site.z + secondSite.z) / 2 };
    const target = { ...mid, y: editor.map.groundAt(mid.x, mid.z) + 0.2 };
    editor.selectedIds.clear(); editor.selectedId = null; editor._attachSelection(); editor._renderInspector();
    editor.camera.position.set(mid.x + 24, target.y + 18, mid.z + 24); editor.cameraController.focus(target); editor.invalidate();
  }, { site, secondSite });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await shot('templates-es-two-copies-overview.png');
  await page.locator('[data-template-name]').fill('GM04b post-placement edit');
  await page.locator('[data-template-action="rename"]').click();
  await page.waitForFunction(() => __mn.gmEditor.templatePanel.library.templates[0]?.name === 'GM04b post-placement edit');
  await check('renaming_template_does_not_change_already_placed_instances', async () => {
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), twoCopies);
    assert.equal(await page.evaluate((id) => __mn.gmEditor.templatePanel.library.templates.find((item) => item.id === id)?.name,
      sourceTemplate.id), 'GM04b post-placement edit');
  });

  // A complete invalid formation is rejected without partially adding any members.
  await page.evaluate(async ({ template, site }) => {
    const editor = __mn.gmEditor, wide = structuredClone(template);
    wide.objects[0].transform.position.x = 560;
    await editor._selectTemplate(wide);
    if (!editor.pendingTemplate || !editor.ghost) throw new Error('wide fixture template did not load');
  }, { template: sourceTemplate, site });
  await moveGround(site.x, site.z);
  const invalidPreview = await page.evaluate(() => ({ visible: __mn.gmEditor.ghost?.visible,
    error: __mn.gmEditor.templatePlacement?.error?.code || null }));
  assert.equal(invalidPreview.visible, true, 'whole-template bounds fixture must reach the visible ghost preview');
  assert.ok(invalidPreview.error, 'whole-template bounds fixture must be rejected before the click');
  const invalidPoint = await moveGround(site.x, site.z);
  await page.mouse.click(invalidPoint.x, invalidPoint.y);
  await check('invalid_composed_bounds_reject_the_whole_template_with_no_partial_commit', async () => {
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), twoCopies);
    assert.ok(await page.evaluate(() => __mn.gmEditor.templatePlacement?.error?.code));
  });
  await page.keyboard.press('Escape');

  // Upload a valid, same-base library containing one unresolved model; selection must fail as a whole.
  const badLibraryPath = resolve(out, 'gm04b-missing-asset-library.json');
  const badTemplate = structuredClone(sourceTemplate);
  badTemplate.id = 'qa-gm04b-missing-asset';
  badTemplate.name = 'GM04b missing model';
  badTemplate.objects[0].assetId = 'model:qa-gm04b-not-installed';
  await fs.promises.writeFile(badLibraryPath, JSON.stringify({ schema: 'marea.gm.template-library', version: 1, templates: [badTemplate] }, null, 2));
  const objectsBeforeMissing = await page.evaluate(() => __mn.gmEditor.history.current());
  await page.locator('[data-template-file]').setInputFiles(badLibraryPath);
  await page.waitForFunction(() => __mn.gmEditor.templatePanel.library.templates.length === 2);
  const missingId = await page.evaluate(() => __mn.gmEditor.templatePanel.library.templates.find((item) => item.name === 'GM04b missing model')?.id);
  await page.locator('[data-template-id="' + missingId + '"]').click();
  await check('missing_asset_blocks_the_entire_ghost_and_keeps_saved_template_and_document', async () => {
    await page.waitForFunction(() => !__mn.gmEditor.templateLoading);
    assert.equal(await page.evaluate(() => __mn.gmEditor.pendingTemplate === null && __mn.gmEditor.ghost === null), true);
    assert.equal(await page.evaluate(() => __mn.gmEditor.lastError?.code), 'template_asset');
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), objectsBeforeMissing);
    assert.ok(await page.evaluate((id) => __mn.gmEditor.templatePanel.library.templates.some((item) => item.id === id), missingId));
  });

  // Escape, walk preview, and a late model load all cancel placement without committing anything.
  await page.locator('[data-template-id="' + sourceTemplate.id + '"]').click();
  await page.waitForFunction(() => !!__mn.gmEditor.pendingTemplate && !!__mn.gmEditor.ghost);
  await page.locator('[data-action="walk"]').click();
  await page.waitForFunction(() => __mn.gmEditor.walkPreview.active);
  await page.locator('[data-action="walk"]').click();
  await page.waitForFunction(() => !__mn.gmEditor.walkPreview.active);
  await check('walk_preview_cancels_template_placement_and_leaves_document_unchanged', async () => {
    assert.equal(await page.evaluate(() => __mn.gmEditor.pendingTemplate === null && __mn.gmEditor.ghost === null), true);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), objectsBeforeMissing);
  });
  await page.locator('[data-template-id="' + sourceTemplate.id + '"]').click();
  await page.waitForFunction(() => !!__mn.gmEditor.pendingTemplate && !!__mn.gmEditor.ghost);
  await page.keyboard.press('Escape');
  await check('escape_cancels_loaded_template_ghost_without_document_mutation', async () => {
    assert.equal(await page.evaluate(() => __mn.gmEditor.pendingTemplate === null && __mn.gmEditor.ghost === null), true);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), objectsBeforeMissing);
  });
  await page.evaluate((template) => {
    const editor = __mn.gmEditor, originalData = editor.assets.data, originalEnsure = editor.assets.ensureModel, originalList = editor.assets.list;
    editor.__gm04bRestoreAssets = () => { editor.assets.data = originalData; editor.assets.ensureModel = originalEnsure; editor.assets.list = originalList; };
    editor.__gm04bLoadStarted = false;
    editor.__gm04bLoadGate = new Promise((resolve) => { editor.__gm04bReleaseLoad = resolve; });
    editor.assets.data = function (id, ...args) { return id === 'prop:storage-crate' ? null : originalData.call(this, id, ...args); };
    editor.assets.list = function (...args) { return originalList.apply(this, args).map((item) => item.id === 'prop:storage-crate' ? { ...item, state: 'pending' } : item); };
    editor.assets.ensureModel = async function (...args) {
      const entryId = typeof args[0] === 'string' ? args[0] : args[0]?.id;
      if (entryId === 'prop:storage-crate') {
        editor.__gm04bLoadStarted = true;
        await editor.__gm04bLoadGate;
      }
      return originalEnsure.apply(this, args);
    };
    window.__gm04bLateTemplateLoad = editor._selectTemplate(template);
  }, sourceTemplate);
  await page.waitForFunction(() => __mn.gmEditor.__gm04bLoadStarted && __mn.gmEditor.templateLoading);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { __mn.gmEditor.__gm04bReleaseLoad(); await window.__gm04bLateTemplateLoad; __mn.gmEditor.__gm04bRestoreAssets(); });
  await check('late_asset_load_finishing_after_escape_cannot_restore_ghost_or_commit', async () => {
    assert.equal(await page.evaluate(() => __mn.gmEditor.pendingTemplate === null && __mn.gmEditor.ghost === null && !__mn.gmEditor.templateLoading), true);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), objectsBeforeMissing);
    assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
  });

  // Library export and additive file upload use a real browser download and upload.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-template-action="export"]').click()]);
  const exportedPath = resolve(out, 'gm04b-downloaded-template-library.json');
  await download.saveAs(exportedPath);
  const downloadedLibrary = JSON.parse(await fs.promises.readFile(exportedPath, 'utf8'));
  const beforeImport = await page.evaluate(() => structuredClone(__mn.gmEditor.templatePanel.library));
  const beforeImportCount = beforeImport.templates.length;
  await page.locator('[data-template-file]').setInputFiles(exportedPath);
  await page.waitForFunction((count) => __mn.gmEditor.templatePanel.library.templates.length === count + 2, beforeImportCount);
  await check('downloaded_library_file_upload_imports_additively_with_new_template_ids', async () => {
    assert.equal(downloadedLibrary.templates.length, 2);
    const imported = await page.evaluate(() => __mn.gmEditor.templatePanel.library.templates);
    assert.equal(imported.length, beforeImportCount + 2);
    const importedOnly = imported.filter((item) => !beforeImport.templates.some((prior) => prior.id === item.id));
    assert.equal(importedOnly.length, 2);
    assert.deepEqual(importedOnly.map(({ id, ...template }) => template), downloadedLibrary.templates.map(({ id, ...template }) => template));
    assert.ok(importedOnly.every((item) => !beforeImport.templates.some((prior) => prior.id === item.id)));
    assert.equal(new Set(imported.map((item) => item.id)).size, imported.length);
  });
  const importedIds = await page.evaluate((prior) => __mn.gmEditor.templatePanel.library.templates
    .filter((item) => !prior.includes(item.id)).map((item) => item.id), beforeImport.templates.map((item) => item.id));
  const documentBeforeTemplateDelete = await page.evaluate(() => __mn.gmEditor.history.current());
  const countBeforeTemplateDelete = await page.evaluate(() => __mn.gmEditor.templatePanel.library.templates.length);
  await page.locator('[data-template-id="' + importedIds[0] + '"]').click();
  await page.locator('[data-template-action="delete"]').click();
  await page.locator('[data-template-action="confirm-delete"]').click();
  await page.waitForFunction((count) => __mn.gmEditor.templatePanel.library.templates.length === count - 1, countBeforeTemplateDelete);
  await check('delete_confirmation_removes_only_imported_template_and_preserves_placed_copies', async () => {
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), documentBeforeTemplateDelete);
    assert.equal(await page.evaluate((id) => __mn.gmEditor.templatePanel.library.templates.some((item) => item.id === id), importedIds[0]), false);
    assert.equal(await page.evaluate((id) => __mn.gmEditor.templatePanel.library.templates.some((item) => item.id === id), sourceTemplate.id), true);
  });

  // Make the draft durable locally, then close/reopen both editor and template panel in this browser context.
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(() => !__mn.gmEditor.dirty);
  const savedDocument = await page.evaluate(() => __mn.gmEditor.history.current());
  const savedLibrary = await page.evaluate(() => structuredClone(__mn.gmEditor.templatePanel.library));
  await page.locator('[data-action="close"]').click();
  await page.waitForFunction(() => __mn.st.mode === 'title');
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
  await page.waitForFunction(() => __mn.gmEditor.templatePanel?.state === 'ready');
  await check('local_reopen_preserves_document_v2_and_independent_template_library', async () => {
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), savedDocument);
    assert.equal(await page.evaluate(() => __mn.gmEditor.history.current().version), 2);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.templatePanel.library), savedLibrary);
  });

  // A second store advances the shared IndexedDB revision; the editor must preserve and export its pending copy.
  const conflict = await page.evaluate(async () => {
    const editor = __mn.gmEditor, panel = editor.templatePanel;
    const { TemplateStore } = await import('/src/editor/templateStore.js');
    const competitor = new TemplateStore({ worldId: editor.worldId });
    const current = await competitor.load(), next = structuredClone(current.library);
    next.templates[0] = { ...next.templates[0], name: 'GM04b external tab update' };
    await competitor.save(next, { expectedRevision: current.revision });
    return { currentRevision: current.revision, panelRevision: panel.revision };
  });
  assert.equal(conflict.panelRevision, conflict.currentRevision);
  await page.locator('[data-template-search]').fill('');
  await page.locator('[data-template-id="' + sourceTemplate.id + '"]').click();
  await page.keyboard.press('Escape');
  await page.locator('[data-template-name]').fill('GM04b pending conflict copy');
  await page.locator('[data-template-action="rename"]').click();
  await page.waitForFunction(() => !!__mn.gmEditor.templatePanel.pendingLibrary);
  await check('stale_cas_conflict_retains_pending_template_library_for_export_or_retry', async () => {
    const state = await page.evaluate(() => ({ status: __mn.gmEditor.templatePanel.status.dataset.state,
      pending: structuredClone(__mn.gmEditor.templatePanel.pendingLibrary), revision: __mn.gmEditor.templatePanel.revision }));
    assert.equal(state.status, 'conflict'); assert.ok(state.pending.templates.some((item) => item.name === 'GM04b pending conflict copy'));
    assert.equal(await page.locator('[data-template-action="retry-save"]').isVisible(), true);
    const pendingJSON = await page.evaluate(() => __mn.gmEditor.templatePanel.export());
    assert.ok(JSON.parse(pendingJSON).templates.some((item) => item.name === 'GM04b pending conflict copy'));
  });
  const [pendingDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-template-action="export"]').click()]);
  await pendingDownload.saveAs(resolve(out, 'gm04b-pending-library-export.json'));
  const pendingExport = JSON.parse(await fs.promises.readFile(resolve(out, 'gm04b-pending-library-export.json'), 'utf8'));
  assert.ok(pendingExport.templates.some((item) => item.name === 'GM04b pending conflict copy'));
  await page.locator('[data-template-action="reload-confirm"]').click();
  await page.locator('[data-template-action="discard-reload"]').click();
  await page.waitForFunction(() => !__mn.gmEditor.templatePanel.pendingLibrary && __mn.gmEditor.templatePanel.state === 'ready');
  await check('explicit_discard_reload_clears_pending_copy_and_reads_external_library_revision', async () => {
    const state = await page.evaluate(() => ({ revision: __mn.gmEditor.templatePanel.revision,
      names: __mn.gmEditor.templatePanel.library.templates.map((item) => item.name) }));
    assert.ok(state.revision > conflict.currentRevision);
    assert.ok(state.names.includes('GM04b external tab update'));
    assert.equal(state.names.includes('GM04b pending conflict copy'), false);
  });  const publicAfter = await runtimeSnapshot(origin);
  assert.equal(publicAfter.version, publicBefore.version); assert.equal(publicAfter.protocolVersion, publicBefore.protocolVersion);
  assert.deepEqual(publicAfter.content, publicBefore.content, 'public content generation/revision must remain unchanged');
  evidence.runtimeAfter = publicAfter;
  if (production) assert.deepEqual(remoteMutations, [], 'GM run must not mutate remote draft/publication/content APIs');
  evidence.remoteMutations = remoteMutations;
  phase = 'final_public_content_and_mutation_assertions';
  assert.deepEqual(evidence.errors, []);
} catch (error) {
  evidence.phase = phase;
  evidence.errors.push(production ? `acceptance_failure:${safePublicError(error)}` : (error.stack || String(error))); process.exitCode = 1;
  if (page) {
    try {
      if (production) await page.addStyleTag({ content: '.account-status, .account-email, [data-account-email] { visibility: hidden !important; }' });
      await shot('failure.png');
    } catch { /* Browser may already be closed. */ }
  }
} finally {
  try { await guestContext?.close(); } catch { /* Preserve the original acceptance failure. */ }
  try { await context?.close(); } catch { /* Preserve the original acceptance failure. */ }
  try { await browser?.close(); } catch { /* Preserve the original acceptance failure. */ }
  try { await game?.close(); } catch { /* Server may not have finished starting. */ }
  try {
    await mkdir(out, { recursive: true });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  } catch (error) { console.error(`Could not write gm04b evidence: ${error.message}`); process.exitCode = 1; }
}

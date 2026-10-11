// Real-browser GM04a acceptance: simulated local auth or one-use public GM login; edits stay in a fresh local draft.
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

const out = resolve(process.env.MN_GM_QA_OUTPUT || 'docs/delivery/gm04a');
const publicOrigin = process.env.MN_GM_QA_ORIGIN?.replace(/\/+$/, '');
const production = !!publicOrigin;
const prefix = production ? 'public' : 'local';
const evidencePath = resolve(out, `${prefix}-browser-evidence.json`);
const GM = '77777777-7777-4777-8777-777777777777';
const evidence = { schema: 'gm04a-browser/v1', version: GAME.version, at: new Date().toISOString(),
  simulatedAuth: !production, production, checks: [], screenshots: [], errors: [], assetRequests: [] };
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
    const session = { access_token: 'gm04a-fixture', user: { id: accountId, email: 'qa@example.invalid' } };
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
      saveSecret: 'gm04a-browser-fixture-only', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_gm04a_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'gm04a-fixture' ? GM : null,
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

  // Build a fixture for the current map; install it through the editor so its actual world/account draft key is used.
  const scene = await page.evaluate(() => ({ seed: __mn.map.seed >>> 0,
    anchor: __mn.map.landmarks?.village || __mn.map.landmarks?.spawn || { x: 0, z: 0 } }));
  const map = generateWorld(scene.seed);
  let site = null;
  for (let ring = 20; ring <= 48 && !site; ring += 4) for (let a = 0; a < 32 && !site; a++) {
    const angle = a * Math.PI / 16, x = scene.anchor.x + Math.cos(angle) * ring, z = scene.anchor.z + Math.sin(angle) * ring;
    if (Math.abs(x) > 270 || Math.abs(z) > 270 || map.groundAt(x, z) < 1.5 ||
        map.props.some((prop) => Math.hypot(prop.x - x, prop.z - z) < 5) ||
        map.colliders.some((collider) => Math.hypot(collider.x - x, collider.z - z) < collider.r + 4)) continue;
    site = { x, z };
  }
  assert.ok(site, 'fixture requires a clear spot near the village');
  const { x, z } = site;
  evidence.fixtureSite = site;
  const specs = [
    ['qa-gm04a-crate', 'prop:storage-crate', x - 2, z, { type: 'circle', radius: 0.8 }],
    ['qa-gm04a-planks', 'model:beach-debris-planks-v1', x, z, 'none'],
    ['qa-gm04a-log', 'model:beach-debris-log-v1', x + 2, z + 1, 'none'],
  ];
  const objects = specs.map(([id, assetId, px, pz, collider]) => createDecoration({ id, assetId,
    position: { x: px, y: map.groundAt(px, pz), z: pz }, collider }));
  seededDocument = createDocument({ seed: scene.seed, baseRevision: 'terrain-s21-v1', objects });
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
  await page.evaluate(async (document) => {
    const editor = __mn.gmEditor;
    for (const assetId of new Set(document.objects.map((item) => item.assetId))) {
      const entry = editor._entryForAsset(assetId);
      if (!entry) throw new Error(`Fixture asset missing from catalog: ${assetId}`);
      await editor.assets.ensureModel(entry, { base: entry.base || 'assets/' });
      if (!editor.assets.model(assetId)) throw new Error(`Fixture model failed to load: ${assetId}`);
    }
    editor._commit(document);
    if (!await editor.saveNow()) throw new Error('Could not save isolated GM04a fixture draft');
  }, seededDocument);
  await page.waitForFunction(() => ['qa-gm04a-crate', 'qa-gm04a-planks', 'qa-gm04a-log'].every((id) => __mn.gmEditor.records.has(id)));
  await check('fixture_uses_real_crate_and_beach_debris_models_without_gameplay_join', async () => {
    const state = await page.evaluate(() => ({ joined: __mn.client.joined, assets: __mn.gmEditor.history.current().objects.map((item) => item.assetId),
      models: [...__mn.gmEditor.records.values()].filter((record) => !record.base).map((record) => ({ id: record.id,
        meshes: record.root.getObjectByProperty('isMesh', true) ? 1 : 0 })) }));
    assert.equal(state.joined, false);
    assert.deepEqual(state.assets.sort(), ['model:beach-debris-log-v1', 'model:beach-debris-planks-v1', 'prop:storage-crate'].sort());
    assert.equal(state.models.length, 3); assert.ok(state.models.every((model) => model.meshes === 1));
    assert.ok(evidence.assetRequests.some((url) => url.includes('prop-storage-crate')));
    assert.ok(evidence.assetRequests.some((url) => url.includes('beach-debris-planks')));
  });
  await page.locator('[data-action="tab-scene"]').click();
  const setSelection = async (ids) => {
    for (const id of ids) {
      await page.locator('[data-role="scene-search"]').fill(id);
      await page.locator(`[data-selection-id="${id}"]`).check();
    }
  };
  const ids = specs.map(([id]) => id);
  await setSelection(ids);
  await check('scene_checkboxes_select_three_decorations_and_form_temporary_centroid', async () => {
    const state = await page.evaluate(() => ({ ids: [...__mn.gmEditor.selectedIds], pivot: __mn.gmEditor.groupPivot.position.toArray(),
      name: __mn.gmEditor.selectionName.textContent, groupNoteHidden: __mn.gmEditor.ui.querySelector('[data-role="group-note"]').hidden }));
    assert.deepEqual(state.ids.sort(), ids.slice().sort()); assert.equal(state.groupNoteHidden, false);
    const expected = objects.reduce((sum, item) => [sum[0] + item.transform.position.x / 3,
      sum[1] + item.transform.position.y / 3, sum[2] + item.transform.position.z / 3], [0, 0, 0]);
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(state.pivot[axis] - expected[axis]) < 1e-5);
    assert.match(state.name, /3/);
  });
  await shot('selection-es-desktop.png');
  await page.locator('[data-action="clear-selection"]').click();
  await page.locator('[data-role="scene-search"]').fill('qa-gm04a-crate');
  await page.locator('[data-selection-id="qa-gm04a-crate"]').focus();
  await page.keyboard.press('Space');
  await check('keyboard_checkbox_toggle_keeps_focus_on_the_scene_item', async () => {
    await page.waitForFunction(() => __mn.gmEditor.selectedIds.has('qa-gm04a-crate'));
    const state = await page.evaluate(() => ({ id: document.activeElement?.dataset?.selectionId,
      checked: document.activeElement?.checked, selected: [...__mn.gmEditor.selectedIds] }));
    assert.equal(state.id, 'qa-gm04a-crate'); assert.equal(state.checked, true);
    assert.deepEqual(state.selected, ['qa-gm04a-crate']);
  });
  await page.locator('[data-action="clear-selection"]').click();
  await setSelection(ids);
  await page.evaluate(() => __mn.gmEditor._focusSelection());
  await check('group_transform_gizmo_renders_at_low_and_high_quality_in_each_mode', async () => {
    evidence.rendering = [];
    for (const quality of ['low', 'high']) for (const mode of ['translate', 'rotate', 'scale']) {
      const start = await page.evaluate(({ quality, mode }) => {
        __mn.quality.setMode(quality); __mn.gmEditor.transform.setMode(mode); __mn.world.pipeline.markDirty();
        return __mn.world.pipeline.frame;
      }, { quality, mode });
      await page.waitForFunction((frame) => __mn.errors.size || __mn.world.pipeline.frame >= frame + 4, start);
      const state = await page.evaluate(() => ({ errors: [...__mn.errors], mode: __mn.gmEditor.transform.mode,
        group: __mn.gmEditor.selectedIds.size === 3 && __mn.gmEditor.transform.object === __mn.gmEditor.groupPivot,
        bounds: __mn.gmEditor.selectionBounds.visible,
        inNormalPass: __mn.world.pipeline.casters.some((mesh) => {
          for (let node = mesh; node; node = node.parent) if (node === __mn.gmEditor.transform) return true;
          return false;
        }) }));
      assert.deepEqual(state.errors, []); assert.equal(state.mode, mode); assert.equal(state.group, true);
      assert.equal(state.bounds, true); assert.equal(state.inNormalPass, false);
      evidence.rendering.push({ quality, mode });
    }
    await page.evaluate(() => { __mn.quality.setMode('high'); __mn.gmEditor.transform.setMode('translate'); });
  });
  await check('pointer_drag_of_group_x_handle_moves_all_members_by_one_delta_and_undoes_once', async () => {
    const before = await page.evaluate(() => __mn.gmEditor.history.current());
    const point = await page.evaluate(() => {
      const controls = __mn.gmEditor.transform; __mn.world.scene.updateMatrixWorld(true);
      const gizmo = controls.children.find((node) => node.isTransformControlsGizmo);
      const handles = gizmo.picker.translate.children;
      for (const mesh of handles.filter((node) => node.name === 'X')) {
        mesh.geometry.computeBoundingSphere();
        const p = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld).project(__mn.world.camera);
        controls.pointerHover({ x: p.x, y: p.y, button: -1 });
        if (controls.axis !== 'X') continue;
        const rect = __mn.gmEditor.canvas.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
      }
      return null;
    });
    assert.ok(point, 'group X handle must be raycastable');
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    assert.equal(await page.evaluate(() => __mn.gmEditor.transform.dragging), true);
    await page.mouse.move(point.x + 80, point.y, { steps: 8 }); await page.mouse.up();
    const after = await page.evaluate(() => __mn.gmEditor.history.current());
    const deltas = before.objects.map((item) => after.objects.find((next) => next.id === item.id).transform.position.x - item.transform.position.x);
    assert.ok(Math.abs(deltas[0]) > 1e-3, 'pointer drag should change group position');
    assert.ok(deltas.every((delta) => Math.abs(delta - deltas[0]) < 1e-5), 'all group members share the same translation');
    assert.deepEqual(after.objects.map((item) => item.id), before.objects.map((item) => item.id));
    assert.equal(await page.evaluate(() => __mn.gmEditor.transform.dragging), false);
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), before);
    assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
  });

  // A grouped gizmo transaction must preview all members and commit as a single history entry.
  const beforeGroup = await page.evaluate(() => __mn.gmEditor.history.current());
  const groupMove = await page.evaluate(() => {
    const editor = __mn.gmEditor, start = editor.groupPivot.position.toArray();
    editor._beginTransform(); editor.dragging = true; editor.groupPivot.position.x += 2;
    editor.groupPivot.position.z += 1; editor._onObjectChange();
    const preview = editor.history.current();
    const roots = [...editor.selectedIds].map((id) => editor.records.get(id).root.position.toArray());
    editor._finishTransform(); editor.dragging = false;
    return { start, preview, roots, current: editor.history.current(), canUndo: editor.history.canUndo() };
  });
  await check('group_gizmo_preview_moves_every_asset_then_finishes_as_one_undo', async () => {
    assert.deepEqual(groupMove.preview, beforeGroup); assert.equal(groupMove.roots.length, 3);
    for (let index = 0; index < 3; index++) {
      assert.ok(Math.abs(groupMove.roots[index][0] - objects[index].transform.position.x - 2) < 1e-5);
      assert.ok(Math.abs(groupMove.roots[index][2] - objects[index].transform.position.z - 1) < 1e-5);
    }
    assert.notDeepEqual(groupMove.current, beforeGroup); assert.equal(groupMove.canUndo, true);
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), beforeGroup);
    await page.locator('[data-action="redo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), groupMove.current);
  });
  await check('group_inspector_x_y_z_rotation_and_scale_transform_every_member', async () => {
    const start = await page.evaluate(() => __mn.gmEditor._selectedTransform());
    const fields = { x: start.position.x + 1, y: start.position.y + 0.25, z: start.position.z - 1,
      ry: 15, scale: 1.25 };
    for (const [field, value] of Object.entries(fields)) {
      await page.locator(`[data-field="${field}"]`).fill(String(value));
      await page.locator(`[data-field="${field}"]`).press('Tab');
    }
    const state = await page.evaluate(() => ({ pivot: __mn.gmEditor._selectedTransform(), objects: __mn.gmEditor.history.current().objects,
      selected: [...__mn.gmEditor.selectedIds] }));
    assert.equal(state.objects.length, 3); assert.equal(state.selected.length, 3);
    assert.ok(Math.abs(state.pivot.position.x - fields.x) < 1e-5);
    assert.ok(Math.abs(state.pivot.position.y - fields.y) < 1e-5);
    assert.ok(Math.abs(state.pivot.position.z - fields.z) < 1e-5);
    assert.ok(Math.abs(state.pivot.rotation.y) < 1e-5); assert.ok(Math.abs(state.pivot.scale - 1) < 1e-5);
    for (const item of state.objects) {
      assert.ok(Math.abs(item.transform.rotation.y - fields.ry * Math.PI / 180) < 1e-5);
      assert.ok(Math.abs(item.transform.scale - fields.scale) < 1e-5);
    }
    for (let index = 0; index < Object.keys(fields).length; index++) await page.locator('[data-action="undo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), groupMove.current);
  });

  // Mix an editable natural rock with the crate. Escape and blur must restore both document and instance matrix.
  const baseState = await page.evaluate(() => {
    const editor = __mn.gmEditor, village = editor.map.landmarks?.village || { x: 0, z: 0 };
    const item = editor.baseLayer.list().filter((entry) => entry.editable && entry.kind === 'rock')
      .sort((a, b) => ((a.transform.position.x - village.x) ** 2 + (a.transform.position.z - village.z) ** 2) -
        ((b.transform.position.x - village.x) ** 2 + (b.transform.position.z - village.z) ** 2))[0];
    if (!item) return null;
    const matrix = new item.mesh.matrix.constructor(); item.mesh.getMatrixAt(item.instanceIndex, matrix);
    return { id: item.id, matrix: matrix.toArray(), transform: item.transform };
  });
  assert.ok(baseState, 'local map must contain an editable natural rock');
  await page.locator('[data-action="clear-selection"]').click();
  await setSelection(['qa-gm04a-crate', baseState.id]);
  const mixedBaseMatrix = await page.evaluate((id) => {
    const entry = __mn.gmEditor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor(); entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
    return matrix.toArray();
  }, baseState.id);
  const mixedBefore = await page.evaluate(() => __mn.gmEditor.history.current());
  await page.evaluate(() => {
    const editor = __mn.gmEditor; editor._beginTransform(); editor.dragging = true;
    editor.groupPivot.position.x += 1.5; editor.groupPivot.rotation.y += Math.PI / 8; editor._onObjectChange();
  });
  const previewBase = await page.evaluate((id) => {
    const entry = __mn.gmEditor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor(); entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
    return matrix.toArray();
  }, baseState.id);
  await page.keyboard.press('Escape');
  await check('mixed_selection_escape_cancels_preview_and_restores_instanced_rock_matrix', async () => {
    assert.notDeepEqual(previewBase, mixedBaseMatrix);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), mixedBefore);
    const restored = await page.evaluate((id) => {
      const entry = __mn.gmEditor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor(); entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
      return { matrix: matrix.toArray(), dragging: __mn.gmEditor.dragging, groupStart: __mn.gmEditor.groupStart };
    }, baseState.id);
    assert.deepEqual(restored.matrix, mixedBaseMatrix); assert.equal(restored.dragging, false); assert.equal(restored.groupStart, null);
  });
  await page.evaluate(() => {
    const editor = __mn.gmEditor; editor._beginTransform(); editor.dragging = true;
    editor.groupPivot.position.z += 1; editor._onObjectChange(); window.dispatchEvent(new Event('blur'));
  });
  await check('window_blur_cancels_mixed_preview_and_restores_base_instance_matrix', async () => {
    assert.deepEqual(await page.evaluate((id) => {
      const entry = __mn.gmEditor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor(); entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
      return matrix.toArray();
    }, baseState.id), mixedBaseMatrix);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), mixedBefore);
  });

  // Select through Shift+click as well as the checkboxes, then exercise atomic duplicate/remove history.
  await page.locator('[data-action="clear-selection"]').click();
  await page.locator('[data-role="scene-search"]').fill('qa-gm04a-crate');
  await page.locator('[data-scene-id="qa-gm04a-crate"]').click();
  await page.locator('[data-role="scene-search"]').fill('qa-gm04a-planks');
  await page.locator('[data-scene-id="qa-gm04a-planks"]').click({ modifiers: ['Shift'] });
  await page.locator('[data-role="scene-search"]').fill('qa-gm04a-log');
  await page.locator('[data-selection-id="qa-gm04a-log"]').check();
  await check('shift_click_and_checkbox_extend_selection', async () => {
    assert.deepEqual(await page.evaluate(() => [...__mn.gmEditor.selectedIds].sort()), ids.slice().sort());
  });
  const beforeDuplicate = await page.evaluate(() => __mn.gmEditor.history.current());
  await page.locator('[data-action="duplicate"]').click();
  const duplicated = await page.evaluate(() => __mn.gmEditor.history.current());
  await check('duplicate_three_members_creates_unique_decorations_and_undoes_redoes_atomically', async () => {
    assert.equal(duplicated.objects.length, beforeDuplicate.objects.length + 3);
    const newObjects = duplicated.objects.filter((item) => !beforeDuplicate.objects.some((old) => old.id === item.id));
    assert.equal(newObjects.length, 3); assert.equal(new Set(newObjects.map((item) => item.id)).size, 3);
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), beforeDuplicate);
    await page.locator('[data-action="redo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), duplicated);
  });

  await page.locator('[data-action="clear-selection"]').click();
  await setSelection(['qa-gm04a-crate', 'qa-gm04a-planks', baseState.id]);
  const beforeRemove = await page.evaluate(() => __mn.gmEditor.history.current());
  await page.locator('[data-action="delete"]').click();
  await check('mixed_delete_removes_draft_props_and_hides_base_rock_as_one_undo', async () => {
    const removed = await page.evaluate(() => __mn.gmEditor.history.current());
    assert.equal(removed.objects.some((item) => ['qa-gm04a-crate', 'qa-gm04a-planks'].includes(item.id)), false);
    assert.equal(removed.baseOverrides.find((item) => item.id === baseState.id)?.hidden, true);
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), beforeRemove);
  });
  await page.locator('[data-action="clear-selection"]').click();
  await check('clear_selection_detaches_group_and_disables_inspector', async () => {
    assert.equal(await page.evaluate(() => __mn.gmEditor.selectedIds.size), 0);
    assert.equal(await page.locator('[data-field="x"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => !__mn.gmEditor.transform.object), true);
  });

  await setSelection(ids);
  await check('walk_preview_hides_multi_selection_bounds_and_return_restores_selection', async () => {
    assert.equal(await page.evaluate(() => __mn.gmEditor.selectionBounds.visible), true);
    await page.locator('[data-action="walk"]').click();
    await page.waitForFunction(() => __mn.gmEditor.walkPreview.active);
    const walking = await page.evaluate(() => ({ ids: [...__mn.gmEditor.selectedIds], bounds: __mn.gmEditor.selectionBounds.visible,
      joined: __mn.client.joined }));
    assert.deepEqual(walking.ids.sort(), ids.slice().sort()); assert.equal(walking.bounds, false); assert.equal(walking.joined, false);
    await page.locator('[data-action="walk"]').click();
    await page.waitForFunction(() => !__mn.gmEditor.walkPreview.active);
    const returned = await page.evaluate(() => ({ ids: [...__mn.gmEditor.selectedIds], bounds: __mn.gmEditor.selectionBounds.visible,
      attached: __mn.gmEditor.transform.object === __mn.gmEditor.groupPivot }));
    assert.deepEqual(returned.ids.sort(), ids.slice().sort()); assert.equal(returned.bounds, true); assert.equal(returned.attached, true);
  });
  await page.locator('[data-action="clear-selection"]').click();

  await page.locator('[data-role="scene-search"]').fill('qa-gm04a-crate');
  await page.locator('[data-selection-id="qa-gm04a-crate"]').check();
  await check('collision_controls_remain_individual_and_disable_for_multiple_selection', async () => {
    assert.equal(await page.locator('[data-setting="collider"]').isDisabled(), false);
    assert.equal(await page.locator('[data-setting="collider"]').inputValue(), 'circle');
    await page.locator('[data-role="scene-search"]').fill('qa-gm04a-planks');
    await page.locator('[data-selection-id="qa-gm04a-planks"]').check();
    assert.equal(await page.locator('[data-setting="collider"]').isDisabled(), true);
    assert.equal(await page.locator('[data-setting="radius"]').isDisabled(), true);
  });
  await page.locator('[data-action="clear-selection"]').click();

  // Restore the three-piece fixture after exercising duplication/removal so the delivered screenshots stay legible.
  await page.evaluate(async (document) => { __mn.gmEditor._commit(document); await __mn.gmEditor.saveNow(); }, seededDocument);
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(() => !__mn.gmEditor.dirty);
  const saved = await page.evaluate(() => __mn.gmEditor.history.current());
  await page.locator('[data-action="close"]').click(); await page.waitForFunction(() => __mn.st.mode === 'title');
  await page.locator('#btn-gm-editor').click(); await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
  await check('local_save_close_reopen_preserves_exact_document', async () => {
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), saved);
  });

  // Show the complete placed set, selection bounds, and group gizmo in both locales and narrow layout.
  await page.locator('[data-action="tab-scene"]').click();
  await setSelection(ids);
  await page.evaluate(() => {
    const editor = __mn.gmEditor; editor.transform.setMode('translate'); editor._focusSelection();
  });
  if (production) {
    const light = await page.evaluate(() => {
      const lighting = __mn.world.lighting;
      const before = { gameplay: lighting.gameplay, tod: lighting.tod, phase: lighting.phase,
        zoneTarget: lighting.zoneTarget, zoneW: lighting.zoneW };
      if (lighting.gameplay) throw new Error('Daylight screenshot override requires editor outside gameplay');
      // Client renderer only: keep the screenshot readable without changing world/game time or sending a command.
      lighting.setTimeOfDay('day', 0); lighting.setZone(false, 0); __mn.world.pipeline.markDirty();
      return { scope: 'browser-client-renderer-only', gameplay: lighting.gameplay,
        tod: lighting.tod, phase: lighting.phase, zoneTarget: lighting.zoneTarget, zoneWBefore: before.zoneW,
        setters: ['setTimeOfDay(day,0)', 'setZone(false,0)'], remoteOrGameplayWrites: false };
    });
    assert.equal(light.gameplay, false); assert.equal(light.tod, 'day'); assert.equal(light.zoneTarget, 0);
    evidence.captureLightingOverride = light;
    const frame = await page.evaluate(() => __mn.world.pipeline.frame);
    await page.waitForFunction((from) => __mn.errors.size || __mn.world.pipeline.frame >= from + 10, frame);
    const settledLight = await page.evaluate(() => ({ sunIntensity: __mn.world.lighting.cur.sunI,
      hemisphereIntensity: __mn.world.lighting.cur.hemiI, zoneWeight: __mn.world.lighting.zoneW }));
    evidence.captureLightingOverride.settled = settledLight;
  }
  await page.locator('[data-role="scene-search"]').fill('qa-gm04a');
  await shot('selection-es-final.png');
  await page.locator('[data-role="language"]').click(); await page.waitForFunction(() => __mn.gmEditor.lang === 'en');
  await shot('selection-en-desktop.png');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await shot('selection-en-844x390.png');
  await check('spanish_english_and_narrow_viewport_show_actual_debris_model_in_editor', async () => {
    assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
    assert.equal(await page.evaluate(() => __mn.gmEditor.records.get('qa-gm04a-planks').root.getObjectByProperty('isMesh', true) !== undefined), true);
    assert.equal(await page.evaluate(() => __mn.gmEditor.lang), 'en');
    const state = await page.evaluate(() => ({ selected: [...__mn.gmEditor.selectedIds], bounds: __mn.gmEditor.selectionBounds.visible,
      attached: __mn.gmEditor.transform.object === __mn.gmEditor.groupPivot,
      visibleProps: [...__mn.gmEditor.records.values()].filter((record) => !record.base && record.root.visible).length }));
    assert.deepEqual(state.selected.sort(), ids.slice().sort()); assert.equal(state.bounds, true); assert.equal(state.attached, true);
    assert.equal(state.visibleProps, 3); assert.equal(await page.locator('[data-role="scene-search"]').isVisible(), true);
  });
  const publicAfter = await runtimeSnapshot(origin);
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
  } catch (error) { console.error(`Could not write GM04a evidence: ${error.message}`); process.exitCode = 1; }
}

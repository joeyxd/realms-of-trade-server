// Real browser acceptance for GM05b terrain paint. Local mode uses a private fixture;
// Production covers authenticated private drafts; an explicit chain module enables the restored live canary.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { paintTerrainDocument } from '../src/editor/terrainPaint.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';
import { compileTerrainMap, validateTerrainForMap } from '../src/editor/terrainData.js';

const publicOrigin = process.env.MN_GM_QA_ORIGIN?.replace(/\/+$/, '') || '';
const production = !!publicOrigin;
const prefix = production ? 'public' : 'local';
const out = resolve(process.env.MN_GM05B_QA_OUTPUT || `docs/delivery/gm05b/${prefix}/${production ? 'attempt1' : 'attempt2'}`);
const evidencePath = resolve(out, `${prefix}-browser-evidence.json`);
const GM = '77777777-7777-4777-8777-777777777777';
const evidence = { schema: `gm05b-${prefix}-browser/v1`, version: GAME.version, production,
  localFixture: !production, simulatedAuth: !production,
  screenshots: [], checks: [], consoleErrors: [], pageErrors: [], errors: [], localStore503: [],
  paint: [], erase: [], runtime: null, seed: null };
let game, browser, context, page, phase = 'initializing', origin = publicOrigin, publicSession = null;

async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function screenshot(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(out, file), fullPage: true, animations: 'disabled' });
  evidence.screenshots.push(file);
}
async function setup(ctx) {
  if (!production) await ctx.addInitScript(accountId => {
      const session = { access_token: 'gm05b-local-fixture', user: { id: accountId, email: 'qa@example.invalid' } };
      window.supabase = { createClient: () => ({ auth: {
        getSession: async () => ({ data: { session }, error: null }), onAuthStateChange() {},
        signInWithPassword: async () => ({ data: { session }, error: null }),
        signUp: async () => ({ data: { session }, error: null }), signOut: async () => ({ error: null }),
      } }) };
    }, GM);
  await ctx.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
      const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
      const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : (process.env.MN_GSAP || '.scratch/gsap-local/package'), match[2]);
      if (!file || !fs.existsSync(file)) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}

function redact(value) {
  if (!production) return value;
  for (const secret of [publicSession?.accessToken].filter(Boolean)) value = value.split(secret).join('[REDACTED]');
  return value.replace(/gm_setup_token=[^\s&"'<>]+/gi, 'gm_setup_token=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:access_token|refresh_token|token_hash|tokenHash)[=: ]+[^\s,&"'<>]+/gi, '[TOKEN_FIELD_REDACTED]')
    .replace(/#\S+/g, '#[REDACTED]');
}

function verifyAssetRecord(record, label = record.id) {
  const file = resolve(record.path);
  assert.ok(fs.existsSync(file), `${label} asset file is missing: ${record.path}`);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, record.byteLength, `${label} byte length must match its receipt`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256, `${label} SHA-256 must match its receipt`);
  return { id: record.id, path: record.path, byteLength: record.byteLength, sha256: record.sha256 };
}
function verifyMaterialReceipts() {
  const ground = JSON.parse(fs.readFileSync(resolve('docs/art/ground/ground-family-v1-receipt.json'), 'utf8'));
  const sand = JSON.parse(fs.readFileSync(resolve('docs/art/sand/sand-family-v1-receipt.json'), 'utf8'));
  assert.equal(ground.family, 'ground-family-v1'); assert.equal(sand.family, 'sand-family-v1');
  const groundRecords = ground.sources.flatMap(source => [source,
    { ...source, path: source.originalPath, byteLength: source.byteLength }]);
  const groundCopies = ground.sources.map(source => ({ ...source, path: source.path, id: `${source.id}-copy` }));
  const mobileDesktopAtlases = ground.runtimeAtlases;
  const drySources = sand.sourceCopies.filter(source => ['dry-albedo', 'dry-normal'].includes(source.id));
  const dryCopies = drySources.map(source => ({ ...source, id: `${source.id}-copy` }));
  const dryOriginals = drySources.map(source => ({ ...source, path: source.originalPath, id: `${source.id}-original` }));
  const dryVariants = sand.derivatives.filter(variant => ['dry-albedo', 'dry-normal'].some(id => variant.id.startsWith(id)));
  const verified = [...groundCopies, ...groundRecords, ...mobileDesktopAtlases, ...drySources, ...dryCopies, ...dryOriginals, ...dryVariants]
    .map(record => verifyAssetRecord(record));
  return { schemas: { ground: ground.schemaVersion, sand: sand.schemaVersion }, verified };
}

function paintSites(map, initial) {
  const plan = []; let doc = initial;
  const requests = [
    { material: 'grass', shape: 'circle' }, { material: 'dirt', shape: 'square' },
    { material: 'sand', shape: 'ellipse' }, { material: 'rock', shape: 'circle' },
  ];
  for (const request of requests) {
    let found = null;
    for (let z = -232; z <= 232 && !found; z += 8) for (let x = -232; x <= 232 && !found; x += 8) {
      if (Math.hypot(x, z) > 248 || plan.some(item => Math.hypot(item.point.x - x, item.point.z - z) < 18)) continue;
      if (map.materialAt?.(x, z) !== 'grass') continue;
      const point = { x, z };
      try {
        const next = paintTerrainDocument({ map, document: doc, baseRevision: doc.base.revision, points: [point],
          tool: 'paint', material: request.material, radius: 4, strength: 1, falloff: .5,
          shape: request.shape, aspect: .5, rotation: 0 });
        if (JSON.stringify(next) !== JSON.stringify(doc)) { found = { ...request, point, document: next }; doc = next; }
      } catch { /* Continue until the painter accepts an unprotected dry patch. */ }
    }
    if (!found) throw new Error(`Painter preflight found no safe dry-ground site for ${request.material}/${request.shape}`);
    plan.push(found);
  }
  return plan;
}

function sculptSite(map, document, excluded) {
  for (let z = -232; z <= 232; z += 8) for (let x = -232; x <= 232; x += 8) {
    if (Math.hypot(x, z) > 248 || excluded.some(point => Math.hypot(point.x - x, point.z - z) < 18)) continue;
    const point = { x, z };
    try {
      const result = sculptTerrainDocument({ map, document, baseRevision: document.base.revision,
        tool: 'raise', points: [point], radius: 3, strength: .5, falloff: .5, shape: 'circle', aspect: .5, rotation: 0, level: 4 });
      if (JSON.stringify(result) !== JSON.stringify(document)) return { point, document: result };
    } catch { /* Continue until a policy-valid dry location is found. */ }
  }
  throw new Error('Sculpt preflight found no safe dry-ground site outside the paint brushes');
}

try {
  phase = production ? 'public_runtime_and_browser_setup' : 'local_server_and_browser_setup';
  await mkdir(out, { recursive: true });
  evidence.materialAssets = verifyMaterialReceipts();
  if (!production) {
    game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log: () => {},
      saveSecret: 'gm05b-local-fixture-only', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_gm05b_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'gm05b-local-fixture' ? GM : null });
    const port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  }
  const status = await fetch(`${origin}/status`, { cache: 'no-store' });
  assert.equal(status.status, 200); evidence.runtime = await status.json();
  assert.equal(evidence.runtime.version, GAME.version);
  if (evidence.runtime.protocolVersion != null) assert.equal(evidence.runtime.protocolVersion, PROTOCOL_VERSION);
  const playwrightPath = resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await setup(context);
  page = await context.newPage();
  page.on('pageerror', error => evidence.pageErrors.push(redact(`${error.name}:${error.message}`)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(redact(message.text())); });
  page.on('response', response => {
    if (response.status() === 503) evidence.localStore503.push({ path: new URL(response.url()).pathname,
      status: 503, expectedLocalUnavailable: !production });
  });
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText || 'failed';
    evidence.errors.push(`requestfailed:${new URL(request.url()).pathname}:${failure}`);
  });
  phase = production ? 'public_real_gm_recovery_session' : 'browser_boot_and_private_editor_open';
  let setupSuffix = '';
  if (production) {
    if (!process.env.MN_GM_SETUP_FILE) throw new Error('Public GM QA requires MN_GM_SETUP_FILE from the one-use production session helper');
    let setupRecord;
    const setupFile = resolve(process.env.MN_GM_SETUP_FILE);
    try { setupRecord = JSON.parse(await fs.promises.readFile(setupFile, 'utf8')); }
    finally { await fs.promises.unlink(setupFile); }
    assert.match(setupRecord?.tokenHash || '', /^[a-f0-9]{32,128}$/i);
    setupSuffix = `&account-setup=1#gm_setup_token=${setupRecord.tokenHash}`;
  }
  await page.goto(`${origin}/?q=high&tod=day${setupSuffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn, null, { timeout: 90000 });
  if (production) {
    await page.waitForFunction(() => __mn.gmEntry?.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden,
      null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => location.hash), '');
    publicSession = await page.evaluate(() => {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index), raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const value = JSON.parse(raw), accessToken = value?.access_token, accountId = value?.user?.id;
          if (typeof accessToken === 'string' && accountId) return { accessToken, accountId: String(accountId) };
        } catch { /* Other local storage records are not auth sessions. */ }
      }
      return null;
    });
    if (!publicSession) throw new Error('The real GM recovery flow did not leave a Supabase session');
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('.gm-account-setup-overlay')?.hidden);
    evidence.realAuth = { recoverySetupCancelled: true, accountId: publicSession.accountId };
  } else {
    await page.waitForFunction(() => !document.querySelector('#btn-gm-editor')?.disabled, null, { timeout: 90000 });
  }
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  const browserRuntime = await page.evaluate(async () => {
    const [meta, protocol] = await Promise.all([import('/src/data/meta.js'), import('/src/net/protocol.js')]);
    return { version: meta.GAME.version, protocolVersion: protocol.PROTOCOL_VERSION };
  });
  assert.equal(browserRuntime.version, GAME.version); assert.equal(browserRuntime.protocolVersion, PROTOCOL_VERSION);
  evidence.browserRuntime = browserRuntime;
  await page.waitForFunction(() => document.querySelector('#btn-gm-editor') && !document.querySelector('#btn-gm-editor').disabled, null, { timeout: 90000 });
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active, null, { timeout: 30000 });
  await page.locator('[data-action="tab-terrain"]').click(); await page.waitForSelector('.gm-terrain-panel');
  const initial = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  assert.equal(initial.version, 2); assert.equal(Object.hasOwn(initial, 'terrain'), false);
  const originalBuffers = await page.evaluate(() => {
    const e = __mn.gmEditor, geometry = e.scene.getObjectByName('terrain').geometry;
    const water = e.scene.getObjectByName('water'), uniforms = [];
    for (const material of [water?.material, water?.userData?.materials?.ssr, water?.userData?.materials?.simple].flat())
      if (material?.uniforms?.uHeight && !uniforms.includes(material.uniforms.uHeight.value)) uniforms.push(material.uniforms.uHeight.value);
    const checksum = array => { let value = 2166136261; for (let i = 0; i < array.length; i += 97) value = Math.imul(value ^ Math.round(array[i] * 1000), 16777619); return value >>> 0; };
    window.__gm05bOriginal = { geometry, positionArray: geometry.attributes.position.array, indexArray: geometry.index?.array,
      map: e.map, heights: e.map.heights, positionHash: checksum(geometry.attributes.position.array), heightHash: checksum(e.map.heights), uniforms };
    return { positionHash: window.__gm05bOriginal.positionHash, heightHash: window.__gm05bOriginal.heightHash, uniformCount: uniforms.length };
  });
  evidence.seed = initial.base.seed;
  const map = generateWorld(initial.base.seed);
  const plan = paintSites(map, initial);
  for (const item of plan) validateTerrainForMap(map, item.document.terrain);
  evidence.paintSites = plan.map(({ material, shape, point }) => ({ material, shape, ...point }));
  await check('preflight_selects_four_policy_valid_dry_sites_for_the_four_ground_families_and_brush_shapes', async () => {
    assert.deepEqual(plan.map(({ material }) => material), ['grass', 'dirt', 'sand', 'rock']);
    assert.deepEqual(plan.map(({ shape }) => shape), ['circle', 'square', 'ellipse', 'circle']);
    assert.ok(plan.every(item => item.document.version === 4 && item.document.terrain.materials.length > 0));
  });

  phase = 'day_lighting_and_pointer_helpers';
  await page.evaluate(() => __mn.world.lighting.setTimeOfDay('day', 0));
  const focusAt = async (point, range = 18) => page.evaluate(({ point, range }) => {
    const editor = __mn.gmEditor, y = editor.draftMap.groundAt(point.x, point.z);
    editor.camera.position.set(point.x + range, y + range * .8, point.z + range);
    editor.cameraController.focus({ x: point.x, y, z: point.z }); editor.invalidate();
  }, { point, range });
  const pointAt = async point => {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return page.evaluate(point => {
      const editor = __mn.gmEditor, y = editor.draftMap.groundAt(point.x, point.z);
      const vector = new (editor.camera.position.constructor)(point.x, y + .03, point.z).project(editor.camera);
      const rect = editor.canvas.getBoundingClientRect();
      if (vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > .96 || Math.abs(vector.y) > .96) throw new Error('Paint pointer target is outside the camera frustum');
      const xy = { x: rect.left + (vector.x + 1) * rect.width / 2, y: rect.top + (1 - vector.y) * rect.height / 2 };
      if (xy.x < rect.left || xy.x > rect.right || xy.y < rect.top || xy.y > rect.bottom) throw new Error('Paint pointer target is outside the real game canvas');
      return xy;
    }, point);
  };
  const moveTo = async point => { const xy = await pointAt(point); await page.mouse.move(xy.x, xy.y); return xy; };
  const setField = async (field, value) => page.locator(`[data-terrain-field="${field}"]`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  const setTool = async tool => page.locator('[data-terrain-tool]').selectOption(tool);
  const pointerClick = async point => { const xy = await moveTo(point); await page.mouse.down(); await page.mouse.up(); return xy; };
  const cursorBounds = () => page.evaluate(() => {
    const attribute = __mn.gmEditor.terrainInteraction.cursor.geometry.attributes.position, array = attribute.array;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < array.length; i += 3) { minX = Math.min(minX, array[i]); maxX = Math.max(maxX, array[i]); minZ = Math.min(minZ, array[i + 2]); maxZ = Math.max(maxZ, array[i + 2]); }
    return { width: maxX - minX, depth: maxZ - minZ };
  });
  const paintStroke = async ({ material, shape, point }) => {
    await setTool('paint');
    await page.locator('[data-terrain-select="material"]').selectOption(material);
    await page.locator('[data-terrain-select="shape"]').selectOption(shape);
    await setField('radius', 4); await setField('strength', 1); await setField('falloff', .5);
    await setField('aspect', .5); await setField('rotation', 0);
    await focusAt(point, 18); const before = await page.evaluate(() => JSON.stringify(__mn.gmEditor.history.current()));
    await moveTo(point); const outline = await cursorBounds();
    if (shape === 'ellipse') assert.ok(outline.depth / outline.width > .45 && outline.depth / outline.width < .55, `ellipse cursor must honor aspect .5: ${JSON.stringify(outline)}`);
    else assert.ok(Math.abs(outline.width - outline.depth) < .2, `${shape} cursor should have matching extents: ${JSON.stringify(outline)}`);
    await pointerClick(point);
    await page.waitForFunction(previous => JSON.stringify(__mn.gmEditor.history.current()) !== previous, before, { timeout: 15000 });
    const result = await page.evaluate(({ point }) => ({ document: structuredClone(__mn.gmEditor.history.current()),
      material: __mn.gmEditor.draftMap.materialAt(point.x, point.z), chart: document.querySelector('.gm-terrain-map')?.toDataURL() }), { point });
    assert.equal(result.material, material, `${material} should be the dominant material under the real pointer stroke`);
    assert.equal(result.document.version, 4);
    evidence.paint.push({ material, shape, point, ...outline, materials: result.document.terrain.materials.length });
    return result.document;
  };

  phase = 'real_pointer_paint_families_and_shapes';
  const chartBefore = await page.locator('.gm-terrain-map').evaluate(canvas => canvas.toDataURL());
  for (const item of plan) await paintStroke(item);
  const chartAfter = await page.locator('.gm-terrain-map').evaluate(canvas => canvas.toDataURL());
  assert.notEqual(chartAfter, chartBefore, 'the mini chart must reflect the material projection');
  await check('real_pointer_paints_grass_dirt_sand_rock_with_circle_square_ellipse_cursor_shapes_and_updates_mini_chart', async () => {
    assert.deepEqual(evidence.paint.map(item => item.material), ['grass', 'dirt', 'sand', 'rock']);
    assert.notEqual(chartAfter, chartBefore);
  });

  phase = 'escape_cancel_and_history_undo_redo';
  const cancelPoint = { x: plan[0].point.x + 4, z: plan[0].point.z + 4 };
  await setTool('paint'); await page.locator('[data-terrain-select="material"]').selectOption('grass');
  await setField('radius', 3); await focusAt(cancelPoint, 14);
  const beforeCancel = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await moveTo(cancelPoint); await page.mouse.down();
  await page.waitForFunction(() => !!__mn.gmEditor.terrainInteraction.stroke);
  const previewActive = await page.evaluate(() => !!__mn.gmEditor.terrainInteraction.stroke?.result);
  assert.ok(previewActive, 'pointer-down should create a visible private paint preview');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.waitForFunction(() => !__mn.gmEditor.terrainInteraction.stroke);
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), beforeCancel);
  await check('escape_cancels_the_real_pointer_paint_preview_without_history_change', async () => assert.ok(previewActive));

  const firstSite = plan[0].point;
  const weightsAt = point => page.evaluate(point => __mn.gmEditor.draftMap.materialWeightsAt(point.x, point.z), point);
  await setTool('erase'); await setField('strength', .25); await focusAt(firstSite, 18);
  const beforeErase = await weightsAt(firstSite), eraseBeforeDoc = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await pointerClick(firstSite);
  await page.waitForFunction(previous => JSON.stringify(__mn.gmEditor.history.current()) !== previous, JSON.stringify(eraseBeforeDoc), { timeout: 15000 });
  const afterLightErase = await weightsAt(firstSite), afterLightDoc = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await setField('strength', .5); const pressureBeforeDoc = await page.evaluate(() => JSON.stringify(__mn.gmEditor.history.current()));
  await pointerClick(firstSite);
  await page.waitForFunction(previous => JSON.stringify(__mn.gmEditor.history.current()) !== previous, pressureBeforeDoc, { timeout: 15000 });
  const afterStrongErase = await weightsAt(firstSite), afterStrongDoc = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  const sum = values => values.reduce((total, value) => total + value, 0);
  assert.ok(sum(beforeErase) > sum(afterLightErase) && sum(afterLightErase) > sum(afterStrongErase),
    `erase strength should reduce paint progressively: ${JSON.stringify({ beforeErase, afterLightErase, afterStrongErase })}`);
  evidence.erase = [{ strength: .25, sum: sum(afterLightErase) }, { strength: .5, sum: sum(afterStrongErase) }];
  await check('erase_strength_controls_blend_pressure_over_real_pointer_strokes', async () => {
    assert.ok(sum(beforeErase) > sum(afterLightErase) && sum(afterLightErase) > sum(afterStrongErase));
  });
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), afterLightDoc);
  await page.locator('[data-action="redo"]').click();
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), afterStrongDoc);
  await check('undo_and_redo_restore_the_exact_material_blends', async () => {});

  phase = 'sculpt_after_paint_and_private_walk';
  const sculpt = sculptSite(map, afterStrongDoc, plan.map(item => item.point));
  await setTool('raise'); await setField('radius', 3); await setField('strength', .5); await focusAt(sculpt.point, 16);
  const beforeSculpt = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await pointerClick(sculpt.point);
  await page.waitForFunction(previous => JSON.stringify(__mn.gmEditor.history.current()) !== previous, JSON.stringify(beforeSculpt), { timeout: 15000 });
  const afterSculpt = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  assert.equal(afterSculpt.version, 4); assert.ok(afterSculpt.terrain.samples.length > 0);
  assert.deepEqual(afterSculpt.terrain.materials, beforeSculpt.terrain.materials, 'sculpting should preserve all painted material rows');
  await check('real_pointer_sculpt_after_paint_keeps_the_material_layer_and_adds_height_samples', async () => {
    assert.ok(afterSculpt.terrain.samples.length > 0); assert.deepEqual(afterSculpt.terrain.materials, beforeSculpt.terrain.materials);
  });

  await page.evaluate(point => { __mn.gmEditor.terrainInteraction.lastPoint = { ...point }; }, plan[0].point);
  const walkDoc = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await page.locator('[data-action="walk"]').click(); await page.waitForFunction(() => __mn.gmEditor.walkPreview?.active);
  const walkStart = await page.evaluate(() => {
    const e = __mn.gmEditor, body = e.walkPreview.body, ecs = e.walkPreview.world.ecs;
    return { x: ecs.x[body], z: ecs.z[body], y: ecs.y[body] };
  });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
  const walkEnd = await page.evaluate(() => {
    const e = __mn.gmEditor, body = e.walkPreview.body, ecs = e.walkPreview.world.ecs;
    return { x: ecs.x[body], z: ecs.z[body], y: ecs.y[body] };
  });
  await page.locator('[data-action="walk"]').click(); await page.waitForFunction(() => !__mn.gmEditor.walkPreview?.active);
  assert.ok(Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z) > .5, 'private walk should move under real keyboard input');
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), walkDoc, 'walk preview must not alter the saved draft');
  evidence.walk = { start: walkStart, end: walkEnd };
  await check('private_walk_moves_over_the_painted_projection_then_returns_without_document_changes', async () => {
    assert.ok(Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z) > .5);
  });

  phase = 'save_local_close_reload_indexeddb';
  await page.evaluate(() => __mn.gmEditor.saveNow());
  await page.waitForFunction(() => !__mn.gmEditor.dirty && !__mn.gmEditor.saveTimer, null, { timeout: 15000 });
  const saved = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  assert.equal(saved.version, 4); assert.equal(saved.terrain.version, 2);
  assert.ok(saved.terrain.samples.length > 0 && saved.terrain.materials.length > 0);
  validateTerrainForMap(map, saved.terrain);
  const compiled = compileTerrainMap(map, saved.terrain);
  assert.equal(compiled.gmTerrain, true);
  assert.deepEqual(plan.map(item => compiled.materialAt(item.point.x, item.point.z)), ['grass', 'dirt', 'sand', 'rock']);
  evidence.document = { version: saved.version, terrainVersion: saved.terrain.version,
    heightSamples: saved.terrain.samples.length, materialSamples: saved.terrain.materials.length,
    materialAtPaintSites: plan.map(item => compiled.materialAt(item.point.x, item.point.z)) };
  await page.locator('[data-action="close"]').click();
  await page.waitForFunction(() => __mn.st.mode === 'title' && !__mn.gmEditor?.active, null, { timeout: 20000 });
  await page.locator('#btn-gm-editor').click(); await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active, null, { timeout: 30000 });
  await page.waitForFunction(expected => JSON.stringify(__mn.gmEditor.history.current()) === expected,
    JSON.stringify(saved), { timeout: 15000 });
  const reloaded = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  assert.deepEqual(reloaded, saved);
  await check('save_now_and_editor_reopen_reload_the_exact_v4_document_from_indexeddb', async () => {
    assert.equal(reloaded.version, 4); assert.deepEqual(reloaded, saved);
  });

  phase = 'restore_original_buffers_and_visual_captures';
  // References were captured before the first preview mutated scene geometry/water textures.
  await page.locator('[data-action="close"]').click();
  await page.waitForFunction(() => __mn.st.mode === 'title' && !__mn.gmEditor?.active, null, { timeout: 20000 });
  const restored = await page.evaluate(() => {
    const e = __mn.gmEditor, original = window.__gm05bOriginal, terrain = e.scene.getObjectByName('terrain');
    const checksum = array => { let value = 2166136261; for (let i = 0; i < array.length; i += 97) value = Math.imul(value ^ Math.round(array[i] * 1000), 16777619); return value >>> 0; };
    const water = e.scene.getObjectByName('water');
    const actualUniforms = [water?.material, water?.userData?.materials?.ssr, water?.userData?.materials?.simple]
      .flat().filter(material => material?.uniforms?.uHeight).map(material => material.uniforms.uHeight.value);
    return { sameGeometry: terrain.geometry === original.geometry,
      samePositionArray: terrain.geometry.attributes.position.array === original.positionArray,
      sameIndexArray: terrain.geometry.index?.array === original.indexArray,
      sameMap: e.map === original.map && e.draftMap === e.map, sameHeights: e.map.heights === original.heights,
      positionHash: checksum(terrain.geometry.attributes.position.array), heightHash: checksum(e.map.heights),
      uniformsRestored: original.uniforms.every((texture, index) => actualUniforms.includes(texture)) };
  });
  assert.ok(restored.sameGeometry && restored.samePositionArray && restored.sameMap && restored.sameHeights,
    `closing editor must restore canonical terrain buffers: ${JSON.stringify(restored)}`);
  assert.equal(restored.positionHash, originalBuffers.positionHash); assert.equal(restored.heightHash, originalBuffers.heightHash);
  assert.ok(restored.uniformsRestored, 'water height textures should be restored after closing the private editor');
  evidence.bufferRestore = { originalBuffers, restored };
  await check('leaving_editor_restores_original_terrain_geometry_arrays_height_sampler_and_water_textures', async () => {
    assert.ok(restored.sameGeometry && restored.samePositionArray && restored.sameMap && restored.sameHeights && restored.uniformsRestored);
  });

  await page.locator('#btn-gm-editor').click(); await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active, null, { timeout: 30000 });
  await page.locator('[data-action="tab-terrain"]').click();
  await page.evaluate(() => __mn.world.lighting.setTimeOfDay('day', 0));
  await setTool('paint');
  await page.locator('[data-terrain-select="material"]').selectOption('rock');
  await page.locator('[data-terrain-select="shape"]').selectOption('ellipse');
  await setField('radius', 4); await setField('strength', 1); await setField('falloff', .5);
  await setField('aspect', .5); await setField('rotation', 0);
  const focusPaintSites = async (viewportWidth = 1440) => {
    const points = plan.map(item => item.point);
    const frame = points.reduce((acc, point) => ({ minX: Math.min(acc.minX, point.x), maxX: Math.max(acc.maxX, point.x),
      minZ: Math.min(acc.minZ, point.z), maxZ: Math.max(acc.maxZ, point.z) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const center = { x: (frame.minX + frame.maxX) / 2, z: (frame.minZ + frame.maxZ) / 2 };
    const span = Math.max(frame.maxX - frame.minX, frame.maxZ - frame.minZ) + 20;
    const range = Math.max(34, span * (viewportWidth < 1000 ? 1.7 : 1.05));
    await page.evaluate(({ center, range }) => {
      const e = __mn.gmEditor, y = e.draftMap.groundAt(center.x, center.z);
      e.camera.position.set(center.x + range, y + range * 1.45, center.z + range);
      e.cameraController.focus({ x: center.x, y, z: center.z }); e.invalidate();
    }, { center, range });
    return { center, frame, range };
  };
  const prepareCaptureLayout = async width => {
    const panel = page.locator('.gm-terrain-panel');
    await panel.evaluate(node => { const root = node.closest('[data-role="terrain-panel"]'); if (root) root.scrollTop = 0; });
    const captureShape = await page.locator('[data-terrain-select="shape"]').inputValue();
    if (width < 1000) {
      const scrollTarget = captureShape === 'circle' ? '[data-terrain-select="shape"]' : '[data-terrain-field="rotation"]';
      await page.locator(scrollTarget).scrollIntoViewIfNeeded();
    }
    const controls = await page.evaluate(() => Object.fromEntries(['tool', 'material', 'shape', 'aspect', 'rotation'].map(key => {
      const selector = key === 'tool' ? '[data-terrain-tool]' :
        ['aspect', 'rotation'].includes(key) ? `[data-terrain-field="${key}"]` : `[data-terrain-select="${key}"]`;
      const element = document.querySelector(selector), rect = element?.getBoundingClientRect();
      const root = element?.closest('[data-role="terrain-panel"]'), rootRect = root?.getBoundingClientRect();
      return [key, { present: !!element, hidden: !element || !!element.closest('[hidden]'),
        top: rect?.top ?? null, bottom: rect?.bottom ?? null,
        withinPanelViewport: !!rect && !!rootRect && rect.bottom > rootRect.top && rect.top < rootRect.bottom,
        panelScrollTop: root?.scrollTop ?? null, panelScrollHeight: root?.scrollHeight ?? null,
        panelClientHeight: root?.clientHeight ?? null, value: element?.value ?? null }];
    })));
    const relevant = ['tool', 'material', 'shape', ...(captureShape === 'ellipse' ? ['aspect'] : []),
      ...(captureShape === 'circle' ? [] : ['rotation'])];
    assert.ok(Object.values(controls).every(control => control.present), `paint controls must exist: ${JSON.stringify(controls)}`);
    assert.ok(relevant.every(key => !controls[key].hidden), `active ${captureShape} controls must be visible: ${JSON.stringify({ relevant, controls })}`);
    evidence.captureControls = controls;
    evidence.captureViewport = { width, controlsWithinPanelViewport: Object.fromEntries(Object.entries(controls).map(([key, value]) => [key, value.withinPanelViewport])) };
    return controls;
  };
  const textureEvidence = async device => page.evaluate(async device => {
    const ids = ['tex:ground-atlas-albedo-v1', 'tex:ground-atlas-normal-v1', 'tex:sand-dry-albedo-v1', 'tex:sand-dry-normal-v1'];
    const records = ids.map(id => {
      const state = __mn.assets.state.get(id), texture = __mn.assets.texture(id), image = texture?.image;
      const entry = __mn.assets.entry(id);
      return { id, state: state?.state || null, selectedSrc: state?.selectedSrc || null,
        selectedUrl: state?.selectedSrc ? new URL(state.selectedSrc, new URL(__mn.assets.base, location.href)).href : null,
        desktopSrc: entry?.src || null, mobileSrc: entry?.mobileSrc || null,
        width: image?.naturalWidth || image?.videoWidth || image?.width || null,
        height: image?.naturalHeight || image?.videoHeight || image?.height || null };
    });
    return { device, coarsePointer: matchMedia('(pointer: coarse)').matches, records };
  }, device);
  const recordTextureEvidence = async device => {
    const result = await textureEvidence(device);
    assert.equal(result.records.length, 4);
    for (const record of result.records) {
      assert.equal(record.state, 'ok', `texture must be loaded: ${record.id}`);
      assert.ok(record.selectedSrc && record.width > 0 && record.height > 0, `loaded texture needs source and dimensions: ${JSON.stringify(record)}`);
      const expected = result.coarsePointer && record.mobileSrc ? record.mobileSrc : record.desktopSrc;
      assert.equal(record.selectedSrc, expected, `exactly one device variant must be selected: ${record.id}`);
    }
    evidence.deviceTextures ||= {};
    evidence.deviceTextures[device] = result;
  };
  await recordTextureEvidence('desktop');
  // Detail frame shows an actual painted ellipse with a matching, live cursor.
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.evaluate(() => __mn.gmEditor.lang) !== 'en') await page.locator('[data-role="language"]').click();
  await page.waitForFunction(() => __mn.gmEditor.lang === 'en');
  for (const item of plan.filter(item => ['sand', 'dirt', 'rock'].includes(item.material))) {
    await setTool('paint');
    await page.locator('[data-terrain-select="material"]').selectOption(item.material);
    await page.locator('[data-terrain-select="shape"]').selectOption(item.shape);
    await setField('radius', 4); await setField('aspect', .5); await setField('rotation', 0);
    await focusAt(item.point, 11); await moveTo(item.point); await prepareCaptureLayout(1440);
    await page.waitForTimeout(250);
    await screenshot(`terrain-en-${item.material}-${item.shape}-closeup-1440x900`);
  }
  for (const lang of ['en', 'es']) {
    if (await page.evaluate(() => __mn.gmEditor.lang) !== lang) await page.locator('[data-role="language"]').click();
    await page.waitForFunction(expected => __mn.gmEditor.lang === expected, lang);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTool('paint');
    await page.locator('[data-terrain-select="material"]').selectOption('rock');
    await page.locator('[data-terrain-select="shape"]').selectOption('ellipse');
    await prepareCaptureLayout(1440);
    const framing = await focusPaintSites(1440); evidence.captureFrame = { ...framing, width: 1440, lang };
    await moveTo(framing.center); await page.waitForTimeout(250); await screenshot(`terrain-${lang}-1440x900`);
  }
  // Mobile screenshots use a genuinely coarse-pointer context, so the registry loads mobileSrc assets.
  const mobileDraftSeed = await page.evaluate(async () => {
    const key = __mn.gmEditor.store.key;
    if (typeof key !== 'string' || !key.startsWith('draft:')) throw new Error('Active editor draft store key is unavailable');
    const record = await new Promise((resolve, reject) => {
    const request = indexedDB.open('marea-gm-drafts-v1', 1);
    request.onerror = () => reject(request.error);
      request.onsuccess = () => { const tx = request.result.transaction('drafts', 'readonly'); const get = tx.objectStore('drafts').get(key);
        get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); };
    });
    return { key, record };
  });
  assert.deepEqual(mobileDraftSeed.record?.document, saved, 'mobile capture must copy the exact account/server-scoped saved local draft');
  const mobileContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, ...(production ? { storageState: await context.storageState() } : {}) });
  await setup(mobileContext);
  await mobileContext.addInitScript(({ key, record, targetOrigin }) => {
    if (window !== window.top || location.origin !== targetOrigin) return;
    window.__gm05bSeedReady = new Promise((resolve, reject) => {
      const request = indexedDB.open('marea-gm-drafts-v1', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts'); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(record, key); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
    });
  }, { ...mobileDraftSeed, targetOrigin: origin });
  const mobilePage = await mobileContext.newPage();
  const previousPage = page; page = mobilePage;
  page.on('pageerror', error => evidence.pageErrors.push(redact(`${error.name}:${error.message}`)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(redact(message.text())); });
  page.on('response', response => { if (response.status() === 503) evidence.localStore503.push({ path: new URL(response.url()).pathname,
    status: 503, expectedLocalUnavailable: !production }); });
  await page.goto(`${origin}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gm05bSeedReady, null, { timeout: 15000 });
  await page.evaluate(() => window.__gm05bSeedReady);
  await page.waitForFunction(() => window.__mn && document.querySelector('#btn-gm-editor') && !document.querySelector('#btn-gm-editor').disabled,
    null, { timeout: 90000 });
  await page.locator('#btn-gm-editor').click(); await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active, null, { timeout: 30000 });
  await page.waitForFunction(expected => JSON.stringify(__mn.gmEditor.history.current()) === expected, JSON.stringify(saved), { timeout: 15000 });
  await page.locator('[data-action="tab-terrain"]').click(); await page.evaluate(() => __mn.world.lighting.setTimeOfDay('day', 0));
  await recordTextureEvidence('mobile');
  for (const lang of ['en', 'es']) {
    if (await page.evaluate(() => __mn.gmEditor.lang) !== lang) await page.locator('[data-role="language"]').click();
    await page.waitForFunction(expected => __mn.gmEditor.lang === expected, lang);
    await setTool('paint');
    await page.locator('[data-terrain-select="material"]').selectOption('sand');
    await page.locator('[data-terrain-select="shape"]').selectOption('ellipse');
    await prepareCaptureLayout(844);
    const detail = plan.find(item => item.material === 'sand');
    await focusAt(detail.point, 11); evidence.captureFrame = { center: detail.point, range: 11, width: 844, lang };
    await moveTo(detail.point); await page.waitForTimeout(250); await screenshot(`terrain-${lang}-844x390`);
  }
  await mobileContext.close(); page = previousPage;
  await check('painted_overview_and_localized_desktop_mobile_closeup_captures_saved_with_active_paint_controls', async () => {
    assert.equal(evidence.screenshots.length, 7);
    assert.ok(evidence.captureControls.tool.value === 'paint' && evidence.captureControls.shape.value === 'ellipse');
    assert.ok(['grass', 'dirt', 'sand', 'rock'].includes(evidence.captureControls.material.value));
    assert.equal(evidence.deviceTextures.desktop.records.length, 4); assert.equal(evidence.deviceTextures.mobile.records.length, 4);
  });
  if (production && process.env.MN_GM_CHAIN_MODULE) {
    phase = 'public_playerless_terrain_material_canary';
    await context.close(); context = null; page = null;
    const chainModule = resolve(process.env.MN_GM_CHAIN_MODULE);
    const { runPublicCanary } = await import(pathToFileURL(chainModule).href);
    const onActive = async ({ origin: activeOrigin, revisionId, generation, document, terrain, sample, material, timeoutMs }) => {
      const peerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        await peerContext.addInitScript(() => {
          const NativeWebSocket = window.WebSocket; window.__gm05bWelcome = [];
          window.WebSocket = new Proxy(NativeWebSocket, { construct(Target, args, NewTarget) {
            const socket = Reflect.construct(Target, args, NewTarget);
            socket.addEventListener('message', event => {
              if (typeof event.data !== 'string') return;
              try { const message = JSON.parse(event.data); if (message.t === 'welcome')
                window.__gm05bWelcome.push({ t: message.t, content: message.content ?? null }); } catch { /* Ignore non-JSON frames. */ }
            });
            return socket;
          } });
        });
        const peer = await peerContext.newPage();
        await peer.goto(`${activeOrigin}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
        await peer.waitForFunction(() => window.__mn && __mn.gmContent?.ok === true, null, { timeout: timeoutMs || 90000 });
        const loaded = await peer.evaluate(async ({ revisionId, generation, terrain, sample, material }) => {
          const { gmContentHash } = await import('/src/editor/activeContent.js');
          const content = __mn.gmContent, map = __mn.map;
          return { loaded: !!content?.ok && content.revisionId === revisionId && content.generation === generation && map.gmTerrain === true,
            terrainHash: await gmContentHash(Array.from(map.heights)),
            materialsHash: await gmContentHash(content.revision?.content?.document?.terrain?.materials || []),
            height: sample?.index == null ? null : map.heights[sample.index],
            material: map.materialAt(material.x, material.z),
            materialWeights: map.materialWeightsAt(material.x, material.z),
            documentVersion: content.revision?.content?.document?.version };
        }, { revisionId, generation, terrain, sample, material });
        assert.equal(loaded.loaded, true, 'fresh guest must load the activated revision before HELLO');
        assert.equal(loaded.terrainHash, terrain.sha256);
        assert.equal(loaded.materialsHash, terrain.materialsSha256);
        if (sample?.index != null) assert.equal(loaded.height, sample.expectedHeight);
        assert.equal(loaded.material, material.expected || 'rock');
        assert.deepEqual(loaded.materialWeights, material.expectedWeights);
        assert.equal(loaded.documentVersion, document.version);
        await peer.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
        await peer.waitForFunction(() => document.querySelector('#btn-play') && !document.querySelector('#btn-play').disabled);
        await peer.locator('#btn-play').click({ force: true });
        await peer.waitForFunction(() => __mn.client.joined && __mn.st.mode === 'playing', null, { timeout: timeoutMs || 30000 });
        const welcomeHandle = await peer.waitForFunction(() => window.__gm05bWelcome.find(message => message.t === 'welcome') || null,
          null, { timeout: timeoutMs || 30000 });
        const welcome = await welcomeHandle.jsonValue();
        assert.deepEqual(welcome.content, { generation, revisionId });
        return { browser: { loaded: true, terrainHash: loaded.terrainHash, materialsHash: loaded.materialsHash,
          height: loaded.height, material: loaded.material, materialWeights: loaded.materialWeights },
          peer: { welcomed: true, content: welcome.content } };
      } finally { await peerContext.close(); }
    };
    evidence.publicChain = await runPublicCanary({ origin, accessToken: publicSession.accessToken,
      accountId: publicSession.accountId, onActive, evidencePath: resolve(out, 'public-chain-evidence.json') });
    publicSession = null;
  } else if (production) {
    evidence.publicChain = { state: 'not_run', reason: 'MN_GM_CHAIN_MODULE release gate not supplied' };
  }
  assert.deepEqual(evidence.pageErrors, [], 'browser page must not report uncaught errors');
  const webglErrors = evidence.consoleErrors.filter(message => /webgl|shader|gl_invalid|three\.js/i.test(message));
  assert.deepEqual(webglErrors, [], `WebGL console errors: ${webglErrors.join('\n')}`);
  evidence.consoleAssessment = { pageErrors: evidence.pageErrors, webglErrors,
    localDurableStore503: evidence.localStore503.filter(record => !production && record.expectedLocalUnavailable),
    otherConsoleErrors: evidence.consoleErrors.filter(message => !/\b503\b|durable.*unavailable|unavailable.*durable/i.test(message)) };
  await check('browser_pageerrors_and_webgl_console_errors_are_empty_and_expected_local_store_503s_are_scoped', async () => {
    assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(webglErrors, []);
  });
  phase = 'complete';
} catch (error) {
  evidence.phase = phase; evidence.errors.push(redact(error?.stack || String(error))); process.exitCode = 1;
  if (page) try { await screenshot('failure'); } catch { /* Preserve the first QA failure. */ }
} finally {
  try { await context?.close(); } catch { /* Preserve first failure. */ }
  try { await browser?.close(); } catch { /* Preserve first failure. */ }
  try { await game?.close(); } catch { /* Server may still be starting. */ }
  try { await mkdir(out, { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); }
  catch (error) { console.error(`Could not write GM05b local evidence: ${error.message}`); process.exitCode = 1; }
}

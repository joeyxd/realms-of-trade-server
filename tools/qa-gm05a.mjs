// Real browser acceptance for GM05a. Local mode uses a private fixture; public mode uses real guest and GM auth.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument } from '../src/editor/document.js';
import { compileTerrainMap, validateTerrainForMap } from '../src/editor/terrainData.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';

const publicOrigin = process.env.MN_GM_QA_ORIGIN?.replace(/\/+$/, '') || '';
const production = !!publicOrigin;
const prefix = production ? 'public' : 'local';
const out = resolve(process.env.MN_GM05A_QA_OUTPUT || `docs/delivery/gm05a/${prefix}/attempt1`);
const evidencePath = resolve(out, `${prefix}-browser-evidence.json`);
const GM = '77777777-7777-4777-8777-777777777777';
const BASE_REVISION = 'terrain-s21-v1';
const evidence = { schema: `gm05a-${prefix}-browser/v1`, version: GAME.version, production,
  simulatedAuth: !production, localFixture: !production,
  screenshots: [], checks: [], errors: [], seed: null, site: null, brushes: [], runtime: null };
let game, browser, context, guestContext, page, phase = 'initializing', origin = publicOrigin, publicSession = null;

async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
function errorEvidence(error) {
  let value = error?.stack || String(error);
  if (!production) return value;
  for (const secret of [publicSession?.accessToken].filter(Boolean)) value = value.split(secret).join('[REDACTED]');
  return value.replace(/gm_setup_token=[^\s&"'<>]+/gi, 'gm_setup_token=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:access_token|refresh_token|token_hash|tokenHash)[=: ]+[^\s,&"'<>]+/gi, '[TOKEN_FIELD_REDACTED]')
    .replace(/#\S+/g, '#[REDACTED]');
}
async function shot(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(out, file), fullPage: true, animations: 'disabled' });
  evidence.screenshots.push(file);
}
async function setup(ctx) {
  await ctx.addInitScript((accountId) => {
    const session = { access_token: 'gm05a-local-fixture', user: { id: accountId, email: 'qa@example.invalid' } };
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

function strokeSites(map, priorDocument) {
  const plan = [], tools = ['raise', 'lower', 'flatten', 'smooth', 'ramp'];
  let doc = priorDocument;
  for (const tool of tools) {
    let found = null;
    for (let z = -240; z <= 240 && !found; z += 8) for (let x = -240; x <= 240 && !found; x += 8) {
      const center = { x, z };
      if (Math.hypot(x, z) > 250 || plan.some(item => Math.hypot(item.center.x - x, item.center.z - z) < 28)) continue;
      try {
        if (tool === 'ramp') {
          // Build a visible terrace at the +X endpoint, then require a safe downhill ramp to the -X endpoint.
          const highPoint = { x: x + 4, z }, lowPoint = { x: x - 4, z };
          let raisedDoc = doc; const preRaises = [];
          for (let raiseIndex = 0; raiseIndex < 2; raiseIndex++) {
            raisedDoc = sculptTerrainDocument({ map, document: raisedDoc, baseRevision: BASE_REVISION,
              tool: 'raise', points: [highPoint], radius: 4, strength: .5, falloff: .5, level: 4 });
            preRaises.push({ point: highPoint, document: raisedDoc });
          }
          const raisedMap = compileTerrainMap(map, raisedDoc.terrain);
          if (raisedMap.groundAt(highPoint.x, highPoint.z) - raisedMap.groundAt(lowPoint.x, lowPoint.z) < 1.1 ||
              raisedMap.groundAt(highPoint.x, highPoint.z) - map.groundAt(highPoint.x, highPoint.z) < .9) continue;
          const points = [highPoint, lowPoint];
          const next = sculptTerrainDocument({ map, document: raisedDoc, baseRevision: BASE_REVISION,
            tool: 'ramp', points, radius: 4, strength: .5, falloff: .5, level: 4 });
          if (JSON.stringify(next) !== JSON.stringify(doc)) { found = { tool, center, points, preRaises, document: next }; doc = next; }
        } else {
          const points = [center];
          const next = sculptTerrainDocument({ map, document: doc, baseRevision: BASE_REVISION,
            tool, points, radius: 4, strength: .5, falloff: .5, level: 4 });
          if (JSON.stringify(next) !== JSON.stringify(doc)) { found = { tool, center, points, document: next }; doc = next; }
        }
      } catch { /* Try another safe dry point for this brush. */ }
    }
    if (!found) throw new Error(`No separated policy-valid changed stroke site found for ${tool}`);
    plan.push(found);
  }
  return plan;
}

try {
  phase = production ? 'public_runtime_and_browser_setup' : 'local_server_and_browser_setup';
  await mkdir(out, { recursive: true });
  if (!production) {
    game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log: () => {},
      saveSecret: 'gm05a-local-fixture-only', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_gm05a_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'gm05a-local-fixture' ? GM : null,
    });
    const port = await game.listen(); origin = `http://127.0.0.1:${port}`;
  }
  const status = await fetch(`${origin}/status`, { cache: 'no-store' });
  assert.equal(status.status, 200);
  evidence.runtime = await status.json();
  assert.equal(evidence.runtime.version, GAME.version);
  if (evidence.runtime.protocolVersion != null) assert.equal(evidence.runtime.protocolVersion, PROTOCOL_VERSION);
  const playwrightPath = resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  if (production) {
    phase = 'public_guest_boot_and_gameplay_join';
    guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guest = await guestContext.newPage();
    guest.on('pageerror', error => evidence.errors.push(`guest_pageerror:${error.name}`));
    await guest.goto(`${origin}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
    await guest.waitForFunction(() => window.__mn, null, { timeout: 90000 });
    await guest.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
    await guest.waitForFunction(() => document.querySelector('#btn-play') && !document.querySelector('#btn-play').disabled);
    await guest.locator('#btn-play').click({ force: true });
    await guest.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
    await guest.waitForFunction(() => document.querySelector('#title')?.hidden === true && !__mn.st.boarding);
    await guest.waitForFunction(() => !document.querySelector('#hud')?.hidden && __mn.input.enabled && __mn.world.rig.blend === null, null, { timeout: 20000 });
    evidence.guestGameplay = await guest.evaluate(() => ({ joined: __mn.client.joined, mode: __mn.st.mode,
      hudVisible: !!document.querySelector('#hud') && !document.querySelector('#hud').hidden }));
    evidence.checks.push('public_guest_boot_and_gameplay_join');
    await guestContext.close(); guestContext = null;
  }
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  if (!production) await setup(context);
  page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(production ? `pageerror:${error.name}` : `pageerror:${error.name}:${error.message}`));

  phase = production ? 'public_real_gm_recovery_session' : 'browser_boot_and_v2_initial_document';
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
        } catch { /* Other browser storage entries are not auth sessions. */ }
      }
      return null;
    });
    if (!publicSession) throw new Error('The real GM recovery flow did not leave a Supabase session');
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('.gm-account-setup-overlay')?.hidden);
    evidence.realAuth = { recoverySetupCancelled: true };
  } else {
    await page.waitForFunction(() => !document.querySelector('#btn-gm-editor')?.disabled, null, { timeout: 90000 });
  }
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  const browserRuntime = await page.evaluate(async () => {
    const [meta, protocol] = await Promise.all([import('/src/data/meta.js'), import('/src/net/protocol.js')]);
    return { version: meta.GAME.version, protocolVersion: protocol.PROTOCOL_VERSION };
  });
  assert.equal(browserRuntime.version, GAME.version);
  assert.equal(browserRuntime.protocolVersion, PROTOCOL_VERSION);
  evidence.browserRuntime = browserRuntime;
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active, null, { timeout: 30000 });
  const initial = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  assert.equal(initial.version, 2); assert.equal(Object.hasOwn(initial, 'terrain'), false);
  const seed = await page.evaluate(() => __mn.gmEditor.map.seed >>> 0);
  const map = generateWorld(seed);
  evidence.seed = seed;
  const sites = strokeSites(map, initial);
  for (const { document: doc } of sites) {
    const checkMap = generateWorld(seed);
    validateTerrainForMap(checkMap, doc.terrain);
  }
  evidence.site = sites.map(item => ({ tool: item.tool, ...item.center }));
  // The site search runs the v3 reference sculpt in Node (a pure function); the browser strokes below commit v5 tiles.
  await check('real_seed_has_five_policy_valid_strokes_on_existing_dry_ground', async () => {
    assert.equal(sites.length, 5);
    assert.ok(sites.every(item => item.document.version === 3 && item.document.terrain.samples.length > 0));
  });

  phase = 'terrain_tab_and_real_pointer_tools';
  await page.locator('[data-action="tab-terrain"]').click();
  await page.waitForSelector('.gm-terrain-panel');
  const setLanguage = async lang => {
    if (await page.evaluate(() => __mn.gmEditor.lang) !== lang) {
      await page.locator('[data-role="language"]').click();
      await page.waitForFunction(expected => __mn.gmEditor.lang === expected, lang);
    }
  };
  await setLanguage('es');
  for (const [field, value] of [['radius', '2'], ['strength', '0.25'], ['falloff', '0.5']])
    await page.locator(`[data-terrain-field="${field}"]`).evaluate((input, next) => {
      input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

  const focusAt = async (point, range = 18) => page.evaluate(({ point, range }) => {
    const editor = __mn.gmEditor, y = editor.draftMap.groundAt(point.x, point.z);
    const target = { x: point.x, y, z: point.z };
    editor.camera.position.set(point.x + range, y + range * .8, point.z + range);
    editor.cameraController.focus(target); editor.invalidate();
  }, { point, range });
  const pointAt = async (point) => {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return page.evaluate(({ point }) => {
      const editor = __mn.gmEditor, v = new (editor.camera.position.constructor)(point.x,
        editor.draftMap.groundAt(point.x, point.z) + .03, point.z).project(editor.camera);
      const r = editor.canvas.getBoundingClientRect();
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > .96 || Math.abs(v.y) > .96) throw new Error('Terrain pointer sample is outside the camera frustum');
      return { x: r.left + (v.x + 1) * r.width / 2, y: r.top + (1 - v.y) * r.height / 2 };
    }, { point });
  };
  const moveTo = async point => { const xy = await pointAt(point); await page.mouse.move(xy.x, xy.y); return xy; };
  const drawStroke = async (tool, points, before) => {
    await page.locator('[data-terrain-tool]').selectOption(tool);
    // Keep both ramp endpoints in the central canvas column; focusing an endpoint
    // at range 12 can project the other endpoint beneath the right inspector.
    await focusAt(tool === 'ramp' ? { x: (points[0].x + points[1].x) / 2,
      z: (points[0].z + points[1].z) / 2 } : points[0], tool === 'ramp' ? 28 : 18);
    if (tool === 'ramp') {
      const start = await moveTo(points[0]); await page.mouse.click(start.x, start.y);
      await page.waitForFunction(() => !!__mn.gmEditor.terrainInteraction.stroke);
      const end = await moveTo(points.at(-1));
      evidence.rampBeforeEndClick = await page.evaluate(({ start, end }) => ({ start, end,
        startElement: document.elementFromPoint(start.x, start.y)?.id || document.elementFromPoint(start.x, start.y)?.className,
        endElement: document.elementFromPoint(end.x, end.y)?.id || document.elementFromPoint(end.x, end.y)?.className,
        gameRect: document.querySelector('#game').getBoundingClientRect().toJSON(),
        point: __mn.gmEditor.terrainInteraction.point,
        points: __mn.gmEditor.terrainInteraction.stroke?.points, pointerInside: __mn.gmEditor.pointerInside,
        cursorVisible: __mn.gmEditor.terrainInteraction.cursor.visible, canvasRect: __mn.gmEditor.canvas.getBoundingClientRect().toJSON() }), { start, end });
      for (const [name, xy] of [['ramp start', start], ['ramp end', end]]) {
        assert.ok(xy.x > 300 && xy.x < 1140 && xy.y > 80 && xy.y < 850,
          `${name} projected under editor chrome/outside central canvas: ${JSON.stringify(xy)}`);
      }
      await page.mouse.move(end.x, end.y, { steps: 8 }); await page.waitForTimeout(100);
      await page.mouse.click(end.x, end.y);
    } else {
      const start = await moveTo(points[0]); await page.mouse.move(start.x, start.y); await page.mouse.down();
      for (const point of points.slice(1)) {
        const xy = await moveTo(point); await page.mouse.move(xy.x, xy.y, { steps: 12 }); await page.waitForTimeout(180);
      }
      await page.mouse.up();
    }
    await page.waitForFunction(previous => JSON.stringify(__mn.gmEditor.history.current()) !== previous,
      JSON.stringify(before), { timeout: 15000 });
  };

  // The largest decoded tile delta (mm) and paint weight within `half` metres of a point in the current v5 document.
  const tileSignal = (center, half) => page.evaluate(async ({ center, half }) => {
    const { decodeTile } = await import('/src/editor/terrainTiles.js');
    const doc = __mn.gmEditor.history.current(), tiles = __mn.gmEditor.history.tilesOf(doc);
    let deltaMm = 0, weight = 0;
    for (const [tx, tz, sha256] of doc.terrain.tiles) {
      const tile = decodeTile(tiles.get(sha256), doc.base.revision);
      for (let v = 0, n = 0; v < 70; v++) for (let u = 0; u < 70; u++, n++) {
        if (Math.abs(70 * tx + u - center.x) > half || Math.abs(70 * tz + v - center.z) > half) continue;
        deltaMm = Math.max(deltaMm, Math.abs(tile.deltasMm[n]));
        for (const channel of tile.channels) weight = Math.max(weight, channel.weights[n]);
      }
    }
    return { tiles: doc.terrain.tiles.length, deltaMm, weight };
  }, { center, half });

  const brushInputs = ['raise', 'lower', 'flatten', 'smooth', 'ramp'];
  for (let i = 0; i < brushInputs.length; i++) {
    const { tool, points, center } = sites[i];
    for (const [field, value] of [['radius', '4'], ['strength', '0.5']])
      await page.locator(`[data-terrain-field="${field}"]`).evaluate((input, next) => {
        input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    if (tool === 'ramp') {
      for (const raise of sites[i].preRaises) {
        const terraceBefore = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
        await drawStroke('raise', [raise.point], terraceBefore);
      }
      evidence.rampTerrace = await page.evaluate(({ point }) => ({ point, height: __mn.gmEditor.draftMap.groundAt(point.x, point.z),
        baseHeight: __mn.gmEditor.map.groundAt(point.x, point.z), tiles: __mn.gmEditor.history.current().terrain.tiles.length }),
      { point: sites[i].preRaises.at(-1).point });
    }
    const before = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
    await drawStroke(tool, points, before);
    const current = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
    const signal = await tileSignal(center, 8);
    evidence.brushes.push({ tool, point: center, tiles: current.terrain.tiles.length, maxDeltaMm: signal.deltaMm });
    assert.equal(current.version, 5);
    assert.ok(current.terrain.tiles.length > 0 && signal.deltaMm > 0, `${tool} should leave a non-zero tile delta at the stroke: ${JSON.stringify(signal)}`);
    assert.notDeepEqual(current, before, `${tool} should commit a changed history document`);
  }
  await check('mouse_pointer_executes_raise_lower_flatten_smooth_and_two_click_ramp_as_real_history_edits', async () => {
    assert.deepEqual(evidence.brushes.map(item => item.tool), ['raise', 'lower', 'flatten', 'smooth', 'ramp']);
    assert.ok(await page.evaluate(() => __mn.gmEditor.history.canUndo()));
  });

  phase = 'invalid_stroke_escape_blur_and_undo_redo';
  await page.locator('[data-terrain-tool]').selectOption('raise');
  const beforeInvalid = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  const spawn = await page.evaluate(() => __mn.gmEditor.map.landmarks.spawn);
  let protectedPreflight = null;
  // The v3 reference sculpt takes a v3 document: the planned strokes' last document stands for the browser's v5 history.
  try { sculptTerrainDocument({ map, document: sites.at(-1).document, baseRevision: BASE_REVISION,
    tool: 'raise', points: [spawn], radius: 6, strength: .5, falloff: .5, level: 4 }); }
  catch (error) { protectedPreflight = error; }
  assert.ok(protectedPreflight, 'spawn preflight must reject this gesture');
  assert.ok(['protected_area', 'protected_ground', 'protected_route'].includes(protectedPreflight.code),
    `spawn preflight should reject: ${protectedPreflight.code}`);
  evidence.protectedPreflightCode = protectedPreflight.code;
  const protectedRadius = page.locator('[data-terrain-field="radius"]');
  await protectedRadius.evaluate(input => { input.value = '6'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  // Reuse a site that this same real-pointer run already established as editable.
  const pendingSite = sites[0].center;
  await protectedRadius.evaluate(input => { input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await drawStroke('raise', [pendingSite], beforeInvalid);
  await page.evaluate(() => {
    const editor = __mn.gmEditor;
    clearTimeout(editor.saveTimer);
    editor.saveTimer = setTimeout(() => editor.saveNow(), 5000);
  });
  const pendingSave = await page.evaluate(() => ({ dirty: __mn.gmEditor.dirty, timer: !!__mn.gmEditor.saveTimer,
    current: structuredClone(__mn.gmEditor.history.current()) }));
  assert.equal(pendingSave.dirty, true); assert.equal(pendingSave.timer, true);
  evidence.pendingSaveBeforeRejectedStroke = { point: pendingSite, dirty: pendingSave.dirty, timerPending: pendingSave.timer,
    autosaveTimer: 'QA-controlled 5000ms delay after a real edit; callback invokes the real saveNow()' };
  await focusAt(spawn, 24); const protectedXY = await pointAt(spawn);
  await page.mouse.move(protectedXY.x, protectedXY.y); await page.mouse.down();
  const invalidDuring = await page.evaluate(() => ({ code: __mn.gmEditor.terrainInteraction.stroke?.error?.code,
    status: document.querySelector('[data-role="status"]')?.textContent,
    pointerInside: __mn.gmEditor.pointerInside, point: __mn.gmEditor.terrainInteraction.point }));
  await page.mouse.up(); await page.waitForFunction(() => !__mn.gmEditor.terrainInteraction.stroke);
  const afterRejected = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  assert.deepEqual(afterRejected, pendingSave.current, 'protected rejection must not change the pending valid document');
  await page.waitForFunction(() => !__mn.gmEditor.dirty && !__mn.gmEditor.saveTimer, null, { timeout: 15000 });
  const invalid = await page.evaluate(() => ({ current: __mn.gmEditor.history.current(), code: __mn.gmEditor.lastError?.code,
    terrainCode: __mn.gmEditor.terrainInteraction.stroke?.error?.code,
    terrainPoint: __mn.gmEditor.terrainInteraction.point, pointerInside: __mn.gmEditor.pointerInside,
    hit: document.elementFromPoint(__mn.gmEditor.pointerNdc.x * innerWidth / 2 + innerWidth / 2,
      -__mn.gmEditor.pointerNdc.y * innerHeight / 2 + innerHeight / 2)?.id || null,
    status: document.querySelector('[data-role="status"]')?.textContent }));
  assert.deepEqual(invalid.current, pendingSave.current);
  assert.ok(['protected_area', 'protected_ground', 'protected_route'].includes(invalidDuring.code),
    `real protected click should reject during its pointer-down preview: ${JSON.stringify(invalidDuring)}`);
  assert.match(invalidDuring.status || '', /Trazo bloqueado|Stroke blocked/);
  assert.match(invalid.status || '', /Trazo bloqueado|Stroke blocked/,
    `successful pending autosave must not erase the blocked-stroke status: ${JSON.stringify(invalid)}`);
  evidence.delayedSaveAndProtectedRejection = { statusDuring: invalidDuring.status, statusAfterSave: invalid.status,
    savedDocumentPreserved: JSON.stringify(invalid.current) === JSON.stringify(pendingSave.current) };
  await check('pending_autosave_completes_after_atomic_protected_rejection_without_erasing_error_status', async () => {
    assert.deepEqual(invalid.current, pendingSave.current);
  });

  const escapeCenter = sites[0].center; await focusAt(escapeCenter, 12); await page.locator('[data-terrain-tool]').selectOption('raise');
  const beforeEscape = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  const a = await moveTo({ x: escapeCenter.x - 2, z: escapeCenter.z }); await page.mouse.move(a.x, a.y); await page.mouse.down();
  const b = await moveTo({ x: escapeCenter.x + 2, z: escapeCenter.z }); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.waitForFunction(() => !__mn.gmEditor.terrainInteraction.stroke);
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), beforeEscape);
  await check('escape_discards_the_preview_and_preserves_history', async () => {});

  const blurStart = { x: sites[1].center.x - 2, z: sites[1].center.z }; await focusAt(sites[1].center, 12);
  const c = await moveTo(blurStart); await page.mouse.move(c.x, c.y); await page.mouse.down();
  const d = await moveTo({ x: sites[1].center.x + 2, z: sites[1].center.z }); await page.mouse.move(d.x, d.y, { steps: 8 }); await page.waitForTimeout(200);
  const blurBefore = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await page.waitForFunction(() => !!__mn.gmEditor.terrainInteraction.stroke);
  // Headless Chrome does not consistently dispatch window blur on tab switches;
  // dispatch the same native window event the editor listens for while a real pointer stroke is active.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => !__mn.gmEditor.terrainInteraction.stroke);
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), blurBefore);
  await check('window_blur_discards_the_preview_without_history_commit', async () => {});

  const undoTarget = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await page.locator('[data-action="undo"]').click();
  const undone = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await page.locator('[data-action="redo"]').click();
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), undoTarget);
  assert.notDeepEqual(undone, undoTarget);
  await check('undo_redo_restores_exact_v5_tile_reference_and_decoration_override_state', async () => {});

  phase = 'walk_test_and_visual_evidence';
  const rampLocation = sites[4].center, rampHigh = sites[4].points[0], rampLow = sites[4].points[1];
  await page.evaluate(({ rampLocation, rampLow }) => {
    const editor = __mn.gmEditor, y = editor.draftMap.groundAt(rampLow.x, rampLow.z);
    editor.camera.position.set(rampLow.x - 20, y + 4, rampLow.z);
    editor.cameraController.focus({ x: rampLow.x, y: y + 4, z: rampLow.z }); editor.invalidate();
    // The editor intentionally starts walking at the most recent terrain point;
    // position that documented start explicitly at the ramp's low endpoint.
    editor.terrainInteraction.lastPoint = { ...rampLow };
  }, { rampLocation, rampLow });
  evidence.walkStartPositioning = 'QA sets terrainInteraction.lastPoint to rampLow; gameplay movement remains real keyboard input';
  await page.locator('[data-action="walk"]').click();
  await page.waitForFunction(() => __mn.gmEditor.walkPreview.active);
  const walkStart = await page.evaluate(() => ({ x: __mn.gmEditor.walkPreview.world.ecs.x[__mn.gmEditor.walkPreview.body],
    z: __mn.gmEditor.walkPreview.world.ecs.z[__mn.gmEditor.walkPreview.body],
    y: __mn.gmEditor.walkPreview.world.ecs.y[__mn.gmEditor.walkPreview.body] }));
  const walkTrace = [await page.evaluate(({ rampHigh }) => { const e = __mn.gmEditor, b = e.walkPreview.body, p = e.walkPreview.world.ecs;
    return { x: p.x[b], z: p.z[b], y: p.y[b], terrain: e.draftMap.groundAt(p.x[b], p.z[b]), base: e.map.groundAt(p.x[b], p.z[b]),
      high: e.draftMap.groundAt(rampHigh.x, rampHigh.z), low: e.map.groundAt(rampHigh.x, rampHigh.z) }; }, { rampHigh })];
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    walkTrace.push(await page.evaluate(() => { const e = __mn.gmEditor, b = e.walkPreview.body, p = e.walkPreview.world.ecs;
      return { x: p.x[b], z: p.z[b], y: p.y[b], terrain: e.draftMap.groundAt(p.x[b], p.z[b]), base: e.map.groundAt(p.x[b], p.z[b]) }; }));
  }
  await page.keyboard.up('KeyW');
  const walkEnd = await page.evaluate(() => ({ x: __mn.gmEditor.walkPreview.world.ecs.x[__mn.gmEditor.walkPreview.body],
    z: __mn.gmEditor.walkPreview.world.ecs.z[__mn.gmEditor.walkPreview.body],
    y: __mn.gmEditor.walkPreview.world.ecs.y[__mn.gmEditor.walkPreview.body] }));
  await page.locator('[data-action="walk"]').click(); await page.waitForFunction(() => !__mn.gmEditor.walkPreview.active);
  await check('walk_preview_runs_over_the_ramp_and_uses_the_projected_ground_sampler', async () => {
    const uplifted = walkTrace.filter(item => item.terrain - item.base > .1);
    assert.ok(Math.hypot(walkStart.x - rampLow.x, walkStart.z - rampLow.z) <= 1,
      `walk must start within 1m of rampLow: ${JSON.stringify({ walkStart, rampLow })}`);
    assert.ok(Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z) >= 5,
      `walk should traverse at least 5m: ${JSON.stringify({ walkStart, walkEnd })}`);
    const rampCrossing = uplifted.filter(item => Math.abs(item.z - rampLow.z) <= 3 &&
      item.x >= rampLow.x - 1 && item.x <= rampHigh.x + 2);
    assert.ok(rampCrossing.length > 0, `walk trace should intersect the raised ramp footprint: ${JSON.stringify({ rampLow, rampHigh, walkTrace })}`);
    assert.ok(rampCrossing.some(item => Math.hypot(item.x - rampHigh.x, item.z - rampHigh.z) <= 4),
      `walk should reach within 4m of the raised endpoint: ${JSON.stringify({ rampHigh, walkTrace })}`);
    assert.ok(Math.max(...walkTrace.map(item => item.y)) - Math.min(...walkTrace.map(item => item.y)) > .5,
      `walk Y should change across the ramp: ${JSON.stringify(walkTrace)}`);
    assert.ok(evidence.rampTerrace.height - evidence.rampTerrace.baseHeight > .6,
      `ramp should have a visible raised endpoint: ${JSON.stringify(evidence.rampTerrace)}`);
    assert.equal(walkEnd.y, await page.evaluate(({ p }) => __mn.gmEditor.draftMap.groundAt(p.x, p.z), { p: walkEnd }));
    evidence.walkTrace = walkTrace;
    evidence.walkAcceptance = { startDistanceToRampLow: Math.hypot(walkStart.x - rampLow.x, walkStart.z - rampLow.z),
      rampCrossingSamples: rampCrossing.length, nearestHighEndpointDistance: Math.min(...walkTrace.map(item => Math.hypot(item.x - rampHigh.x, item.z - rampHigh.z))) };
  });

  phase = 'place_decoration_on_raised_terrace';
  await page.locator('[data-action="tab-library"]').click();
  const assetCard = page.locator('[data-editor-asset="model:beach-debris-planks-v1"]');
  await assetCard.waitFor({ state: 'visible', timeout: 15000 });
  await assetCard.click();
  await page.waitForFunction(() => !!__mn.gmEditor.pendingEntry && __mn.gmEditor.pendingEntry.id === 'model:beach-debris-planks-v1',
    null, { timeout: 30000 });
  await focusAt(rampHigh, 14);
  const terraceXY = await pointAt(rampHigh);
  const objectCountBeforePlacement = await page.evaluate(() => __mn.gmEditor.history.current().objects.length);
  await page.mouse.move(terraceXY.x, terraceXY.y); await page.mouse.click(terraceXY.x, terraceXY.y);
  await page.waitForFunction(previous => __mn.gmEditor.history.current().objects.length > previous,
    objectCountBeforePlacement, { timeout: 15000 });
  const placedOnTerrace = await page.evaluate(() => {
    const editor = __mn.gmEditor, item = [...editor.history.current().objects].reverse()
      .find(object => object.assetId === 'model:beach-debris-planks-v1');
    if (!item) return null;
    return { id: item.id, position: item.transform.position,
      projected: editor.draftMap.groundAt(item.transform.position.x, item.transform.position.z),
      base: editor.map.groundAt(item.transform.position.x, item.transform.position.z) };
  });
  assert.ok(placedOnTerrace, 'real catalog model should be placed through the pointer');
  assert.ok(Math.abs(placedOnTerrace.position.y - placedOnTerrace.projected) < 1e-5,
    `placed model y should use projected terrain: ${JSON.stringify(placedOnTerrace)}`);
  assert.ok(placedOnTerrace.position.y > placedOnTerrace.base + .8,
    `placement must land on the raised terrace: ${JSON.stringify(placedOnTerrace)}`);
  evidence.terracePlacement = placedOnTerrace;
  await check('real_catalog_model_placement_uses_raised_draft_ground', async () => {});

  await focusAt(rampLocation, 9);
  await page.locator('[data-action="tab-terrain"]').click();
  // Leaving the Terrain tab deselects the tool, and the brush controls stay hidden until one is chosen.
  await page.locator('[data-terrain-tool]').selectOption('raise');
  await setLanguage('en');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
  await shot('terrain-en-closeup-1440x900');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(250);
  const radiusInput = page.locator('[data-terrain-field="radius"]'); await radiusInput.scrollIntoViewIfNeeded();
  const radiusBeforeEn = Number(await radiusInput.inputValue()); await radiusInput.focus(); await radiusInput.press('ArrowRight');
  const radiusAfterEn = Number(await radiusInput.inputValue()); assert.ok(radiusAfterEn > radiusBeforeEn);
  await shot('terrain-en-closeup-844x390');
  await setLanguage('es');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
  await shot('terrain-es-closeup-1440x900');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(250);
  await radiusInput.scrollIntoViewIfNeeded(); const radiusBeforeEs = Number(await radiusInput.inputValue());
  await radiusInput.focus(); await radiusInput.press('ArrowRight');
  const radiusAfterEs = Number(await radiusInput.inputValue()); assert.ok(radiusAfterEs > radiusBeforeEs);
  await shot('terrain-es-closeup-844x390');
  evidence.narrowRadiusInteraction = { en: [radiusBeforeEn, radiusAfterEn], es: [radiusBeforeEs, radiusAfterEs] };
  await page.setViewportSize({ width: 1440, height: 900 }); await focusAt(rampLocation, 12); await page.waitForTimeout(250);
  await shot('terrain-es-ramp-overview-1440x900');
  await check('spanish_english_narrow_closeup_and_ramp_overview_captures_saved', async () => {
    assert.equal(evidence.screenshots.length, 5);
  });

  phase = 'local_save_reopen_export_import_v5_and_v2_compatibility';
  // Every tile the current document references is held by the history with its declared length and sha256.
  const heldTiles = () => page.evaluate(async () => {
    const { tileSha256 } = await import('/src/editor/terrainTiles.js');
    const doc = __mn.gmEditor.history.current(), tiles = __mn.gmEditor.history.tilesOf(doc);
    let valid = 0;
    for (const [, , sha256, length] of doc.terrain.tiles) {
      const bytes = tiles.get(sha256);
      if (bytes?.length === length && await tileSha256(bytes) === sha256) valid++;
    }
    return { referenced: doc.terrain.tiles.length, valid };
  });
  await page.locator('[data-action="save"]').click(); await page.waitForFunction(() => !__mn.gmEditor.dirty, null, { timeout: 15000 });
  const savedV5 = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export"]').click()]);
  const exportPath = resolve(out, 'terrain-v5-export.json'); await download.saveAs(exportPath);
  const exported = JSON.parse(await fs.promises.readFile(exportPath, 'utf8'));
  assert.equal(exported.document.version, 5); assert.ok(exported.document.terrain.tiles.length > 0);
  assert.deepEqual(Object.keys(exported.tiles).sort(), exported.document.terrain.tiles.map(reference => reference[2]).sort());
  await page.locator('[data-action="close"]').click(); await page.waitForFunction(() => __mn.st.mode === 'title');
  await page.locator('#btn-gm-editor').click(); await page.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), savedV5);
  const reopened = await heldTiles();
  assert.deepEqual(reopened, { referenced: savedV5.terrain.tiles.length, valid: savedV5.terrain.tiles.length });
  await page.locator('[data-role="import"]').setInputFiles(exportPath);
  await page.waitForFunction(() => __mn.gmEditor.history.current().version === 5 && !__mn.gmEditor.dirty &&
    document.querySelector('[data-role="status"]')?.textContent?.includes('importado'));
  assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), savedV5);
  const imported = await heldTiles();
  assert.deepEqual(imported, reopened);
  evidence.v5Persistence = { tiles: savedV5.terrain.tiles.length, reopened, imported, exportFile: 'terrain-v5-export.json' };
  await check('local_save_reopen_export_and_import_preserve_v5_tiles_while_fresh_v2_remains_legacy_shaped', async () => {
    assert.equal(initial.version, 2); assert.equal(Object.hasOwn(initial, 'terrain'), false);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), savedV5);
  });

  if (production && process.env.MN_GM_CHAIN_MODULE) {
    phase = 'public_playerless_activation_canary';
    await context.close(); context = null; page = null;
    const chainModule = resolve(process.env.MN_GM_CHAIN_MODULE);
    const { runPublicCanary } = await import(pathToFileURL(chainModule).href);
    assert.equal(savedV5.version, 5);
    assert.ok(savedV5.terrain.tiles.length > 0, 'the public canary needs changed terrain tiles');
    const onActive = async ({ origin: activeOrigin, revisionId, generation, document, terrain, sample: activeSample, timeoutMs }) => {
      const peerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        await peerContext.addInitScript(() => {
          const NativeWebSocket = window.WebSocket;
          window.__gm05aWelcome = [];
          window.WebSocket = new Proxy(NativeWebSocket, { construct(Target, args, NewTarget) {
            const socket = Reflect.construct(Target, args, NewTarget);
            socket.addEventListener('message', event => {
              if (typeof event.data !== 'string') return;
              try { const message = JSON.parse(event.data); if (message.t === 'welcome')
                window.__gm05aWelcome.push({ t: message.t, content: message.content ?? null }); } catch { /* Ignore non-JSON frames. */ }
            });
            return socket;
          } });
        });
        const peer = await peerContext.newPage();
        await peer.goto(`${activeOrigin}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
        await peer.waitForFunction(() => window.__mn && __mn.gmContent?.ok === true, null, { timeout: timeoutMs || 90000 });
        const loaded = await peer.evaluate(async ({ revisionId, generation, terrain, sample }) => {
          const { gmContentHash } = await import('/src/editor/activeContent.js');
          const { tileSha256 } = await import('/src/editor/terrainTiles.js');
          const content = __mn.gmContent, map = __mn.map;
          // A v5 terrain hashes the heights as float32 little-endian (heightsSha256); v3 and v4 hash canonical JSON.
          const heights = new DataView(new ArrayBuffer(map.heights.length * 4));
          map.heights.forEach((height, k) => heights.setFloat32(k * 4, height, true));
          return { loaded: !!content?.ok && content.revisionId === revisionId && content.generation === generation && map.gmTerrain === true,
            terrainHash: terrain.heightsSha256 ? await tileSha256(new Uint8Array(heights.buffer)) : await gmContentHash(Array.from(map.heights)),
            height: map.heights[sample.index],
            content: { generation: content.generation, revisionId: content.revisionId } };
        }, { revisionId, generation, terrain, sample: activeSample });
        assert.equal(loaded.loaded, true, 'the fresh guest must load the activated revision before HELLO');
        assert.equal(loaded.terrainHash, terrain.heightsSha256 ?? terrain.sha256);
        assert.equal(loaded.height, activeSample.expectedHeight);
        assert.equal(await peer.evaluate(() => __mn.gmContent.revision?.content?.document?.version), document.version);
        await peer.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
        await peer.waitForFunction(() => document.querySelector('#btn-play') && !document.querySelector('#btn-play').disabled);
        await peer.locator('#btn-play').click({ force: true });
        await peer.waitForFunction(() => __mn.client.joined && __mn.st.mode === 'playing', null, { timeout: timeoutMs || 30000 });
        const welcome = await peer.waitForFunction(() => window.__gm05aWelcome.find(message => message.t === 'welcome') || null,
          null, { timeout: timeoutMs || 30000 });
        const welcomeMessage = await welcome.jsonValue();
        assert.deepEqual(welcomeMessage.content, { generation, revisionId });
        return { browser: { loaded: true, terrainHash: loaded.terrainHash, height: loaded.height },
          peer: { welcomed: true, content: welcomeMessage.content } };
      } finally { await peerContext.close(); }
    };
    evidence.publicChain = await runPublicCanary({ origin, accessToken: publicSession.accessToken,
      accountId: publicSession.accountId, onActive, evidencePath: resolve(out, 'public-chain-evidence.json') });
    publicSession = null;
  } else if (production) {
    evidence.publicChain = { state: 'not_run', reason: 'MN_GM_CHAIN_MODULE release gate not supplied' };
  }

  assert.deepEqual(evidence.errors, []);
  phase = 'complete';
} catch (error) {
  evidence.phase = phase;
  if (page) try {
    evidence.debugState = await page.evaluate(() => ({
      tool: __mn.gmEditor.terrainInteraction?.tool,
      stroke: __mn.gmEditor.terrainInteraction?.stroke && {
        points: __mn.gmEditor.terrainInteraction.stroke.points,
        error: __mn.gmEditor.terrainInteraction.stroke.error?.code || __mn.gmEditor.terrainInteraction.stroke.error?.message || null,
        resultTiles: __mn.gmEditor.terrainInteraction.stroke.result?.terrain?.tiles?.length ?? null,
      },
      lastError: __mn.gmEditor.lastError?.code || __mn.gmEditor.lastError?.message || null,
      terrainStatus: document.querySelector('[data-role="status"]')?.textContent,
      history: __mn.gmEditor.history.current(),
      windowErrors: [...__mn.errors],
    }));
  } catch { /* Preserve first acceptance error. */ }
  evidence.errors.push(errorEvidence(error)); process.exitCode = 1;
  if (page) try { await shot('failure'); } catch { /* Keep the original failure. */ }
} finally {
  try { await context?.close(); } catch { /* preserve first failure */ }
  try { await guestContext?.close(); } catch { /* preserve first failure */ }
  try { await browser?.close(); } catch { /* preserve first failure */ }
  try { await game?.close(); } catch { /* server may not have finished starting */ }
  publicSession = null;
  try { await mkdir(out, { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); }
  catch (error) { console.error(`Could not write GM05a local evidence: ${error.message}`); process.exitCode = 1; }
}

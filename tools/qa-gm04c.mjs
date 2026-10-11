// GM04c browser acceptance. Production changes only this disposable browser's private local draft.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
const production = !!process.env.MN_GM_QA_ORIGIN;
const out = resolve(process.env.MN_GM04C_QA_OUTPUT || `docs/delivery/gm04c/${production ? 'public' : 'local'}`);
const evidence = { schema: 'gm04c-browser/v1', at: new Date().toISOString(), version: GAME.version, production,
  simulatedAuth: !production, checks: [], screenshots: [], pageErrors: [], consoleErrors: [], networkFailures: [], remoteWrites: [] };
const GM = '77777777-7777-4777-8777-777777777777';
const redact = value => String(value).replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
  .replace(/((?:gm_setup_token|access_token|refresh_token|token_hash)=)[^&\s"']+/gi, '$1[redacted]');
let game, browser, page, origin = process.env.MN_GM_QA_ORIGIN, phase = 'start';
const check = async (name, fn) => { phase = name; await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); };
const shot = async name => { await page.screenshot({ path: resolve(out, name + '.png') }); evidence.screenshots.push(name + '.png'); };
const watch = p => {
  p.on('pageerror', error => evidence.pageErrors.push(redact(error.message)));
  p.on('console', msg => { if (msg.type() === 'error') evidence.consoleErrors.push(redact(msg.text())); });
  p.on('requestfailed', req => evidence.networkFailures.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText }));
  p.on('request', req => { if (req.method() !== 'GET' && /\/api\/gm\//.test(req.url())) evidence.remoteWrites.push(new URL(req.url()).pathname); });
};
async function setup(context) {
  if (!production) await context.addInitScript(accountId => {
    const session = { access_token: 'gm04c-fixture', user: { id: accountId } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }), onAuthStateChange() {},
      signInWithPassword: async () => ({ data: { session } }), signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
  }, GM);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
  });
}
async function enter(p) {
  await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-gm-editor')?.disabled, null, { timeout: 90000 });
  await p.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await p.locator('#btn-gm-editor').click();
  await p.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor?.active && __mn.gmEditor.history, null, { timeout: 30000 });
  await p.evaluate(() => __mn.world.lighting.setTimeOfDay('day', 0));
}
async function choose(id) {
  await page.locator('[data-action="tab-library"]').click();
  await page.locator(`[data-editor-asset="${id}"]`).click();
  await page.waitForFunction(id => __mn.gmEditor.scatterPanel.entry?.id === id, id);
  await page.locator('[data-action="tab-scatter"]').click();
}
async function setControl(field, value) {
  await page.locator(`[data-scatter-field="${field}"], [data-scatter-select="${field}"]`).evaluate((el, value) => {
    el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function screenPoint(point) {
  return page.evaluate(async point => {
    const THREE = await import('three'), e = __mn.gmEditor, y = e.draftMap.groundAt(point.x, point.z);
    const p = new THREE.Vector3(point.x, y, point.z).project(e.camera), r = e.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }, point);
}
async function aim(point) {
  await page.evaluate(point => {
    const e = __mn.gmEditor, h = e.draftMap.groundAt(point.x, point.z);
    e.camera.position.set(point.x + 2, h + 25, point.z + 22); e.camera.lookAt(point.x, h, point.z);
    e.camera.updateMatrixWorld(true); e.invalidate();
  }, point);
}
try {
  await mkdir(out, { recursive: true });
  if (!production) {
    game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log: () => {},
      saveSecret: 'gm04c-local-only', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'gm04c-fixture' ? GM : null });
    origin = `http://127.0.0.1:${await game.listen()}`;
  }
  evidence.runtime = await (await fetch(origin + '/status')).json();
  assert.equal(evidence.runtime.version, GAME.version);
  const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await setup(context);
  page = await context.newPage(); watch(page);
  let suffix = '';
  if (production) {
    const file = resolve(process.env.MN_GM_SETUP_FILE); let session;
    try { session = JSON.parse(await readFile(file, 'utf8')); } finally { await unlink(file); }
    assert.match(session.tokenHash, /^[a-f0-9]{32,128}$/i); suffix = `&account-setup=1#gm_setup_token=${session.tokenHash}`;
  }
  await page.goto(origin + '/?q=high&tod=day' + suffix, { waitUntil: 'domcontentloaded' });
  if (production) {
    await page.waitForFunction(() => __mn.gmEntry?.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 90000 });
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
  }
  await enter(page);
  const initial = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  await check('real_loaded_shrub_cost_and_private_brush', async () => {
    await choose('model:shrub-round-v1');
    evidence.shrub = await page.evaluate(() => __mn.gmEditor.scatterPanel.metrics);
    assert.ok(evidence.shrub.triangles > 0 && evidence.shrub.triangles < 2000);
    assert.ok(evidence.shrub.textures.length); await page.locator('[data-scatter-tool]').check();
  });
  const site = await page.evaluate(async () => {
    const { canScatterAt } = await import('/src/editor/terrainData.js'), e = __mn.gmEditor;
    for (let z = -160; z < 180; z += 8) for (let x = -170; x < 180; x += 8)
      if (canScatterAt(e.draftMap, x, z, 9)) return { x, z };
    throw new Error('No clear scatter test site');
  });
  await aim(site);
  for (const shape of ['circle', 'square', 'ellipse']) await check(`${shape}_preview_cancel_keeps_history`, async () => {
    await setControl('shape', shape); await setControl('rotation', 45); await setControl('strength', 1);
    const p = await screenPoint(site); await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.waitForFunction(() => __mn.gmEditor.scatterInteraction.stroke?.plan?.placements.length > 0);
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), initial);
    await shot(`preview-${shape}-es`); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.document), initial);
  });
  await check('stroke_commit_single_undo_redo_and_ids', async () => {
    await setControl('shape', 'circle'); const p = await screenPoint(site); await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.waitForFunction(() => __mn.gmEditor.scatterInteraction.stroke?.plan?.placements.length > 0);
    const end = await screenPoint({ x: site.x + 3, z: site.z });
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.waitForFunction(() => __mn.gmEditor.scatterInteraction.stroke?.points.length > 2 && !__mn.gmEditor.scatterInteraction.stroke.pending);
    evidence.dragPoints = await page.evaluate(() => __mn.gmEditor.scatterInteraction.stroke.points.length);
    evidence.previewIds = await page.evaluate(() => __mn.gmEditor.scatterInteraction.stroke.result.objects.map(o => o.id));
    await page.mouse.up();
    const doc = await page.evaluate(() => structuredClone(__mn.gmEditor.history.current())); evidence.objectCount = doc.objects.length - initial.objects.length;
    assert.ok(evidence.objectCount > 0 && evidence.objectCount <= 120); assert.deepEqual(doc.objects.map(o => o.id), evidence.previewIds);
    await page.locator('[data-action="undo"]').click(); assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), initial);
    await page.locator('[data-action="redo"]').click(); assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), doc);
    await shot('placed-shrubs-es');
  });
  const saved = await page.evaluate(async () => { const e = __mn.gmEditor; await e.saveNow(); return e.history.current(); });
  await check('private_save_reopen_exact_without_remote_write', async () => {
    await page.locator('[data-action="close"]').click(); await page.waitForFunction(() => !__mn.gmEditor?.active);
    await enter(page); assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), saved);
  });
  await check('palm_decorative_cost_and_english_controls', async () => {
    await choose('model:palm-short-v1'); await page.locator('[data-role="language"]').click();
    evidence.palm = await page.evaluate(() => __mn.gmEditor.scatterPanel.metrics);
    assert.ok(evidence.palm.triangles > 0 && evidence.palm.triangles < 2000);
    assert.match(await page.locator('[data-scatter-summary]').innerText(), /Selected model: Short palm/);
    await page.locator('[data-scatter-tool]').check(); await aim(site); await shot('palm-controls-en');
  });
  await check('optimized_rock_file_savings_and_real_texture_dimensions', async () => {
    await choose('model:gm-rock-1k'); evidence.rock = await page.evaluate(() => ({ metrics: __mn.gmEditor.scatterPanel.metrics, stats: __mn.gmEditor.scatterPanel.entry.stats }));
    assert.ok(evidence.rock.stats.bytes < evidence.rock.stats.sourceBytes);
    assert.ok(evidence.rock.metrics.textures.every(t => t.width <= 1024 && t.height <= 1024));
    await shot('optimized-rock-en');
  });
  await check('mobile_emulation_controls_and_loaded_model', async () => {
    const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, storageState: production ? await context.storageState() : undefined });
    await setup(mobile); const desktop = page; page = await mobile.newPage(); watch(page);
    await page.goto(origin + '/?q=low&tod=day', { waitUntil: 'domcontentloaded' }); await enter(page);
    await choose('model:shrub-round-v1'); evidence.mobileModel = await page.evaluate(() => __mn.gmEditor.scatterPanel.metrics);
    await shot('mobile-scatter'); await page.locator('[data-scatter-tool]').check();
    await page.locator('[data-scatter-select="shape"]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-scatter-select="shape"]').isVisible(), true);
    await shot('mobile-controls'); await mobile.close(); page = desktop;
  });
  await page.locator('[data-action="close"]').click();
  await check('no_remote_mutations_or_browser_render_errors', async () => {
    assert.deepEqual(evidence.remoteWrites, []); assert.deepEqual(evidence.pageErrors, []);
    assert.deepEqual(evidence.consoleErrors.filter(e => /WebGL|shader|GL_INVALID/i.test(e)), []);
  });
  phase = 'complete';
} catch (error) {
  evidence.failure = { phase, error: redact(error.message) }; process.exitCode = 1;
  if (page) try { await shot('failure'); } catch {}
} finally {
  await browser?.close(); await game?.close(); evidence.phase = phase;
  await writeFile(resolve(out, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

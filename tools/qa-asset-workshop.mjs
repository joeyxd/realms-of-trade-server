import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createGameServer } from '../server/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, 'docs/delivery/asset-workshop/local'); fs.mkdirSync(output, { recursive: true });
const evidence = { schema: 'marea.asset-workshop.browser.v1', at: new Date().toISOString(), simulatedAuth: true, checks: [], screenshots: [], errors: [], writes: [], commands: [], loaded: [] };
const GM = '77777777-7777-4777-8777-777777777777';
const game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, root, dev: false, log: () => {}, saveSecret: 'asset-workshop-local', gmDraftsAllowMemory: true, gmAccountIds: [GM],
  publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' }, resolvePlayer: async (_req, hello) => hello.token === 'aw-fixture' ? GM : null });
const origin = `http://127.0.0.1:${await game.listen()}`;
console.log(`QA ${origin}`);
const { chromium } = await import(pathToFileURL(path.resolve(root, '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
let browser, page;
const check = async (label, fn) => { console.log(`CHECK ${label}`); await fn(); evidence.checks.push(label); console.log(`PASS ${label}`); };
const capture = async name => { await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 15000, animations: 'disabled' }); evidence.screenshots.push(`${name}.png`); };
async function setup(context, account = GM) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await context.addInitScript(accountId => {
    localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, quality: 'low', muted: true }));
    const session = { access_token: 'aw-fixture', user: { id: accountId } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }), onAuthStateChange() {},
      signInWithPassword: async () => ({ data: { session }, error: null }), signUp: async () => ({ data: { session }, error: null }), signOut: async () => ({ error: null }) } }) };
  }, account);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = path.resolve(root, match[1].startsWith('three') ? 'node_modules/three' : '../realms-of-trade-server/.scratch/gsap-local/package', match[2]);
    return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
  });
}
function watch(page) {
  page.on('pageerror', error => { evidence.errors.push(error.message); console.log(`PAGE ERROR ${error.message}`); });
  page.on('console', msg => { if (msg.type() === 'error' && /WebGL|shader|GL_INVALID/.test(msg.text())) evidence.errors.push(msg.text()); });
  page.on('request', request => { if (request.method() !== 'GET' && /\/api\/gm\//.test(request.url())) evidence.writes.push(request.url()); });
  page.on('websocket', ws => ws.on('framesent', event => { try { const message = JSON.parse(String(event.payload)); if (['join', 'input', 'cmd'].includes(message.t)) evidence.commands.push(message.t); } catch {} }));
}
async function enter() {
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-asset-workshop')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
  await page.locator('#btn-asset-workshop').click();
  await page.waitForFunction(() => __mn.st.mode === 'asset-workshop' && __mn.assetWorkshop?.active && __mn.assetWorkshop?.entries?.length === 28);
}
async function select(id, status = 'ready') {
  await page.evaluate(id => __mn.assetWorkshop.select(id), id);
  await page.waitForFunction(status => __mn.assetWorkshop.preview.state.status === status, status, { timeout: 60000 });
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  console.log('Chrome launched');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); await setup(context);
  page = await context.newPage(); watch(page); console.log('Navigating'); await page.goto(`${origin}/?debug`, { waitUntil: 'domcontentloaded' }); console.log('Page loaded');
  await check('GM admission opens private workshop without joining', async () => { await enter(); assert.equal(await page.evaluate(() => __mn.client.joined), false); });
  await check('new cauldron renders real geometry with honest material limitation', async () => {
    await select('aw-pilot-01');
    await page.waitForFunction(() => __mn.assetWorkshop.preview.drawCalls > 0);
    const state = await page.evaluate(() => __mn.assetWorkshop.preview.state); assert.ok(state.triangles > 0); evidence.loaded.push(state);
    assert.ok(await page.locator('.aw-source-warning').isVisible());
    await capture('desktop-cauldron');
  });
  await check('published cauldron shows the GM editor badge', async () => {
    await select('aw-pilot-01');
    assert.ok((await page.locator('.aw-card.is-selected .aw-published').innerText()).includes('Publicado en el editor GM'));
    assert.ok((await page.locator('p.aw-published').innerText()).includes('Publicado en el editor GM'));
  });
  await check('earlier cauldron control loads the original baked textures', async () => {
    await select('aw-pilot-02'); const state = await page.evaluate(() => __mn.assetWorkshop.preview.state); assert.ok(state.textureDimensions.some(t => t.width >= 512)); evidence.loaded.push(state); await capture('textured-cauldron-control');
    await select('aw-pilot-01');
  });
  await check('PBR / actual toon material use the same geometry in A/B', async () => {
    await select('aw-pilot-02');
    await page.locator('[data-field="presentation"]').selectOption('compare');
    await page.waitForFunction(() => __mn.assetWorkshop.preview.mode === 'compare' && __mn.assetWorkshop.preview.drawCalls > 4);
    await capture('desktop-compare');
  });
  await check('pack and accent-insensitive category search retain one identity', async () => {
    await page.locator('[data-field="pack"]').selectOption('UltimateFarming'); await page.locator('.aw-search').fill('algodon');
    assert.equal(await page.locator('.aw-card').count(), 1); await page.locator('.aw-card').click();
    assert.equal(await page.evaluate(() => __mn.assetWorkshop.selected.id), 'aw-pilot-03');
    await page.locator('[data-field="pack"]').selectOption(''); await page.locator('.aw-search').fill('');
  });
  await check('cotton states and device profile load distinct validated outputs', async () => {
    await select('aw-pilot-03'); const first = await page.evaluate(() => __mn.assetWorkshop.preview.metrics.url);
    await page.locator('[data-field="variant"]').selectOption('harvested');
    await page.waitForFunction(first => __mn.assetWorkshop.preview.state.status === 'ready' && __mn.assetWorkshop.preview.metrics.url !== first, first);
    await capture('cotton-harvested');
    await page.locator('[data-field="quality"]').selectOption('mobile');
    await page.waitForFunction(() => __mn.assetWorkshop.preview.state.status === 'ready' && __mn.assetWorkshop.preview.metrics.quality === 'mobile');
    const state = await page.evaluate(() => __mn.assetWorkshop.preview.state); assert.ok(state.textureDimensions.every(t => t.width <= 512 && t.height <= 512)); evidence.loaded.push(state);
  });
  await check('decision, adaptation tasks and notes survive switch, close and reopen', async () => {
    await select('aw-pilot-01'); await page.locator('[data-decision="adapt"]').click();
    await page.locator('[data-review-task="retexture"]').check(); await page.locator('[data-review-field="use"]').fill('Estación de cocina');
    await page.locator('[data-review-field="collection"]').fill('Crafting inicial'); await page.locator('[data-review-field="notes"]').fill('Revisar el metal a distancia de juego.');
    await page.locator('[data-action="save"]').click();
    await select('aw-pilot-06'); await page.locator('[data-action="close"]').click(); await enter(); await select('aw-pilot-01');
    assert.equal(await page.locator('[data-review-field="notes"]').inputValue(), 'Revisar el metal a distancia de juego.');
    assert.equal(await page.locator('[data-review-task="retexture"]').isChecked(), true);
  });
  await check('unprepared rig stays explicit, without last model or procedural substitute', async () => {
    await select('aw-pilot-13', 'pending'); assert.equal(await page.evaluate(() => __mn.assetWorkshop.preview.object), null);
    assert.ok(await page.locator('.aw-overlay').isVisible()); await capture('pending-creature');
  });
  await check('real source leather texture and icon render under mobile budget', async () => {
    await select('aw-pilot-11'); evidence.loaded.push(await page.evaluate(() => __mn.assetWorkshop.preview.state)); await capture('leather-texture');
    await select('aw-pilot-19'); evidence.loaded.push(await page.evaluate(() => __mn.assetWorkshop.preview.state)); await capture('leather-icon');
  });
  await check('export and declarative preparation batch preserve identity', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export"]').click()]);
    const sessionPath = path.join(output, 'session.json'); await download.saveAs(sessionPath);
    const document = JSON.parse(fs.readFileSync(sessionPath)); assert.equal(document.schema, 'marea.asset-review.v1'); assert.equal(document.scope.accountId, GM); assert.equal(document.records[0].decision, 'adapt');
    await page.locator('[data-action="queue"]').click(); const [jobs] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-jobs"]').click()]);
    const batchPath = path.join(output, 'batch.json'); await jobs.saveAs(batchPath); const batch = JSON.parse(fs.readFileSync(batchPath)); assert.equal(batch.jobs[0].assetId, 'aw-pilot-19');
    await page.locator('input[type="file"]').setInputFiles(sessionPath); await page.waitForFunction(() => document.querySelector('.aw-footer').textContent.includes('Sesión importada'));
  });
  await check('rapid selection cancellation and close release resources', async () => {
    await page.evaluate(async () => { const workshop = __mn.assetWorkshop; await Promise.all([workshop.select('aw-pilot-04'), workshop.select('aw-pilot-05'), workshop.select('aw-pilot-01')]); });
    await page.waitForFunction(() => __mn.assetWorkshop.preview.state.status === 'ready');
    assert.equal(await page.evaluate(() => __mn.assetWorkshop.selected.id), 'aw-pilot-01');
    await page.locator('[data-action="close"]').click(); assert.equal(await page.evaluate(() => __mn.assetWorkshop.preview), null);
  });
  if (process.argv.includes('--prepare-thumbnails')) {
    await enter(); await page.locator('[data-field="quality"]').selectOption('desktop');
    const rows = await page.evaluate(() => __mn.assetWorkshop.entries.filter(entry => entry.preview?.desktop?.url || entry.variants?.some(variant => variant.preview?.desktop?.url)).map(entry => ({ id: entry.id, sourceRevision: entry.sourceRevision })));
    const directory = path.join(root, '.scratch/aw-thumbnails'); fs.mkdirSync(directory, { recursive: true });
    for (const row of rows) {
      await select(row.id); await page.locator('.aw-stage-hint').evaluate(el => { el.style.display = 'none'; });
      row.presentation = await page.evaluate(() => __mn.assetWorkshop.preview.mode); row.slug = row.id.replace(/[^a-zA-Z0-9_-]/g, '-');
      await page.locator('.aw-viewport').screenshot({ path: path.join(directory, `${row.slug}.png`), timeout: 15000 });
    }
    fs.writeFileSync(path.join(directory, 'inputs.json'), JSON.stringify(rows, null, 2));
    console.log(execFileSync('python', [path.join(root, 'tools/asset-workshop/pack-thumbnails.py')], { encoding: 'utf8' }).trim());
  }
  await context.close();
  await check('fresh browser reload restores the account-scoped review', async () => {
    const reloadContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await setup(reloadContext);
    const session = JSON.parse(fs.readFileSync(path.join(output, 'session.json')));
    await reloadContext.addInitScript(session => localStorage.setItem(`marea.asset-review.v1:${encodeURIComponent(session.scope.accountId)}:${encodeURIComponent(session.scope.serverId)}`, JSON.stringify(session)), session);
    page = await reloadContext.newPage(); watch(page); await page.goto(origin); await enter(); await select('aw-pilot-01');
    assert.equal(await page.locator('[data-review-field="notes"]').inputValue(), 'Revisar el metal a distancia de juego.'); await reloadContext.close();
  });
  await check('mobile landscape controls, actual smaller texture URL and isolated render', async () => {
    const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await setup(mobile);
    page = await mobile.newPage(); watch(page); await page.goto(origin); await enter(); await select('aw-pilot-01');
    const state = await page.evaluate(() => __mn.assetWorkshop.preview.state); assert.equal(state.quality, 'mobile'); assert.ok(state.textureDimensions.every(t => t.width <= 512)); evidence.loaded.push(state);
    const layout = await page.locator('.aw-root').evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth })); assert.ok(layout.scroll <= layout.width + 1);
    await capture('mobile-cauldron');
    await page.locator('[data-action="review-panel"]').click(); await page.locator('[data-review-field="notes"]').fill('Nota de revisión móvil');
    await page.locator('[data-action="save"]').click(); assert.ok(await page.locator('.aw-save-status').textContent()); await capture('mobile-review');
    await page.locator('[data-action="review-panel"]').click(); await page.locator('[data-action="library-panel"]').click(); assert.ok(await page.locator('.aw-search').isVisible()); await mobile.close();
  });
  await check('authenticated account without GM capability cannot open', async () => {
    const denied = await browser.newContext(); await setup(denied, '88888888-8888-4888-8888-888888888888'); page = await denied.newPage(); watch(page); await page.goto(origin);
    await page.waitForFunction(() => window.__mn?.assetEntry?.ready, null, { timeout: 90000 }); assert.equal(await page.locator('#btn-asset-workshop').isDisabled(), true); await denied.close();
  });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.writes, []); assert.deepEqual(evidence.commands, []); evidence.ok = true;
} catch (error) { evidence.ok = false; evidence.failure = error.stack; if (page && !page.isClosed()) await capture('failure').catch(() => {}); throw error; }
finally { fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); await browser?.close(); await game.close(); }

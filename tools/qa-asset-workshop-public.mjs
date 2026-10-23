// Public artifact + offline review acceptance. This does not assert a real authenticated GM session.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const origin = process.env.MN_ASSET_QA_ORIGIN || 'https://marea.62.171.136.148.sslip.io';
const output = path.join(root, 'docs/delivery/asset-workshop/public'); fs.mkdirSync(output, { recursive: true });
const evidence = { schema: 'marea.asset-workshop.public.v1', at: new Date().toISOString(), origin, realAuthenticatedGm: false, mode: 'solo-private-review', files: [], checks: [], screenshots: [], errors: [] };
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const prepared = JSON.parse(fs.readFileSync(path.join(root, 'assets/workshop/prepared.json'))), thumbnails = JSON.parse(fs.readFileSync(path.join(root, 'assets/workshop/thumbnails.json')));
const files = new Set(['src/main.js', 'src/editor/entry.js', 'src/editor/assetLibrary.js', 'src/editor/assetReview.js', 'src/editor/assetWorkshop.js', 'src/render/assetPreview.js', 'styles/assetWorkshop.css', 'assets/workshop/catalog.json', 'assets/workshop/prepared.json', 'assets/workshop/thumbnails.json']);
for (const entry of prepared.entries) for (const preview of [entry.preview, ...(entry.variants || []).map(v => v.preview)].filter(Boolean)) for (const quality of ['desktop', 'mobile']) if (preview[quality]) files.add(preview[quality].url);
for (const row of thumbnails.entries) files.add(row.url);
let browser;
try {
  const status = await (await fetch(`${origin}/status`, { signal: AbortSignal.timeout(15000) })).json(); assert.equal(status.version, '0.6.0-alpha.88'); evidence.status = status;
  for (const file of files) {
    const response = await fetch(`${origin}/${file}`, { cache: 'no-cache', signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200, file);
    const data = Buffer.from(await response.arrayBuffer()), local = fs.readFileSync(path.join(root, file)); assert.equal(hash(data), hash(local), file);
    evidence.files.push({ file, bytes: data.length, sha256: hash(data) });
  }
  evidence.checks.push('50 published UI, metadata, preview and thumbnail files match local SHA256');
  assert.equal((await fetch(`${origin}/api/gm/session`)).status, 401); evidence.checks.push('GM session denies missing account authorization');
  const { chromium } = await import(pathToFileURL(path.resolve(root, '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
  for (const [profile, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 844, height: 390 }]]) {
    const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile', deviceScaleFactor: 1 });
    await context.addInitScript(() => { localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ quality: 'low', muted: true })); });
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
      const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
      const file = path.resolve(root, match[1].startsWith('three') ? 'node_modules/three' : '../realms-of-trade-server/.scratch/gsap-local/package', match[2]);
      return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error' && /WebGL|shader|GL_INVALID/.test(msg.text())) evidence.errors.push(msg.text()); });
    await page.goto(`${origin}/?solo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-asset-workshop').disabled, null, { timeout: 90000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none'); await page.locator('#btn-asset-workshop').click();
    await page.waitForFunction(() => __mn.assetWorkshop?.active && __mn.assetWorkshop.preview?.state.status === 'ready');
    await page.evaluate(() => __mn.assetWorkshop.select('aw-pilot-02')); await page.waitForFunction(() => __mn.assetWorkshop.preview.state.status === 'ready');
    const metrics = await page.evaluate(() => __mn.assetWorkshop.preview.metrics); assert.equal(metrics.quality, profile); assert.ok(metrics.triangles > 0);
    if (profile === 'mobile') assert.ok(metrics.textureDimensions.every(t => t.width <= 512));
    const shot = `${profile}-published.png`; await page.screenshot({ path: path.join(output, shot), timeout: 15000 }); evidence.screenshots.push(shot);
    assert.equal(await page.evaluate(() => __mn.client.joined), false); evidence.checks.push(`${profile}: published private scene with actual ${metrics.url}`);
    if (profile === 'mobile') await page.locator('[data-action="review-panel"]').click();
    await page.locator('[data-review-field="notes"]').fill(`Prueba privada ${profile}`); await page.locator('[data-action="save"]').click();
    await page.evaluate(() => __mn.assetWorkshop.close()); await page.locator('#btn-asset-workshop').click(); await page.evaluate(() => __mn.assetWorkshop.select('aw-pilot-02'));
    assert.equal(await page.locator('[data-review-field="notes"]').inputValue(), `Prueba privada ${profile}`); evidence.checks.push(`${profile}: local review survives reopen`);
    await context.close();
  }
  assert.deepEqual(evidence.errors, []); evidence.ok = true;
} catch (error) { evidence.ok = false; evidence.failure = error.stack; throw error; }
finally { fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); await browser?.close(); }
console.log(`Public checks passed: ${evidence.files.length} files, ${evidence.checks.length} checks.`);

// Read-only public asset/release verification and normal guest entry. No profile/economic writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const base = process.env.MN_PUBLIC_BASE || 'https://marea.62.171.136.148.sslip.io';
const out = path.resolve(process.env.MN_ITEM_PUBLIC_OUT || 'docs/delivery/item-models-v1/public');
await fs.mkdir(out, { recursive: true });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { generatedAt: new Date().toISOString(), base, revision, hashes: [], viewports: [] };
const manifest = JSON.parse(await fs.readFile('assets/manifest.json', 'utf8'));
const files = ['assets/manifest.json', 'assets/editor/thumbnails.json', 'src/render/assets/manifest.js',
  'src/render/assets/registry.js', 'src/render/assets/toonmat.js', 'src/render/characters.js',
  'src/render/resourceNodes.js', 'src/render/harvestGoods.js', 'src/render/scene.js', 'src/main.js',
  ...manifest.assets.filter(entry => entry.id.startsWith('model:item-')).flatMap(entry => ['assets/' + entry.src, 'assets/' + entry.mobileSrc])];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const file of files) {
  const response = await fetch(`${base}/${file}`, { cache: 'no-store' });
  assert.equal(response.status, 200, file);
  const bytes = Buffer.from(await response.arrayBuffer()), expected = hash(execFileSync('git', ['show', `${revision}:${file}`]));
  assert.equal(hash(bytes), expected, file);
  report.hashes.push({ file, sha256: expected, bytes: bytes.length });
}
const { chromium } = await import(pathToFileURL(path.resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const spec of [{ name: 'desktop', width: 1280, height: 720, touch: false }, { name: 'mobile', width: 844, height: 390, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, isMobile: spec.touch, hasTouch: spec.touch });
    const page = await context.newPage(), result = { ...spec, errors: [], requests: [] };
    report.viewports.push(result);
    try {
      page.on('pageerror', error => result.errors.push(String(error)));
      page.on('console', event => { if (event.type() === 'error' && !/Failed to load resource|fonts\.g/.test(event.text())) result.errors.push(event.text()); });
      page.on('request', req => { if (req.url().includes('/models/items-v1/')) result.requests.push(req.url()); });
      await page.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ name: 'Modelos QA', quality: 'low', muted: true, landscape: false })));
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      result.models = await page.evaluate(() => __mn.assets.list().filter(entry => entry.id.startsWith('model:item-')).map(entry => ({ ...entry,
        sizes: (__mn.assets.data(entry.id)?.parts || []).flatMap(part => (Array.isArray(part.mat) ? part.mat : [part.mat]).map(mat => [mat.map?.image.width, mat.map?.image.height])) })));
      assert.equal(result.requests.length, 3);
      assert.equal(result.models.filter(entry => entry.state === 'ok').length, 3);
      assert.equal(result.models.filter(entry => entry.state === 'pending').length, 9);
      for (const model of result.models.filter(entry => entry.state === 'ok')) {
        assert.equal(model.selectedSrc.includes('-mobile'), spec.touch);
        assert.ok(model.sizes.every(size => size[0] === (spec.touch ? 256 : 512)));
      }
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.title-card')).opacity) > .99 && getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => __mn.client.joined && __mn.st.mode === 'playing', null, { timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('#title')?.hidden && !__mn.st.boarding
        && __mn.input.enabled && !__mn.st.paused, null, { timeout: 60000 });
      await page.waitForTimeout(2500); // Let the title-to-player camera blend finish before capturing the scene.
      result.joined = await page.evaluate(() => ({ joined: __mn.client.joined, errors: [...__mn.errors.entries()],
        torch: [...__mn.world.views.values()].some(view => view.personalLantern?.getObjectByName('model:item-antorcha-v1')),
        woodAtlas: __mn.world.resources.woodPaint.map === __mn.assets.texture('tex:raft-comic-v1') }));
      assert.equal(result.joined.joined, true); assert.equal(result.joined.torch, true); assert.equal(result.joined.woodAtlas, true);
      assert.equal(result.joined.errors.length, 0); assert.equal(result.errors.length, 0);
      await page.screenshot({ path: path.join(out, spec.name + '-entry.png') });
      result.status = 'passed';
    } catch (error) {
      result.failure = String(error);
      result.page = await page.evaluate(() => ({ url: location.href, ready: document.readyState,
        button: document.querySelector('#btn-play')?.textContent, disabled: document.querySelector('#btn-play')?.disabled,
        mode: window.__mn?.st.mode, assets: window.__mn?.assets.errors })).catch(() => null);
      await page.screenshot({ path: path.join(out, spec.name + '-failure.png') }).catch(() => {});
      await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify(report, null, 2) + '\n');
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
report.status = await (await fetch(base + '/status', { cache: 'no-store' })).json();
assert.equal(report.status.errors, 0); assert.equal(report.status.storage.errors, 0);
await fs.writeFile(path.join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ hashes: report.hashes.length, viewports: report.viewports.map(view => [view.name, view.status]), version: report.status.version }));

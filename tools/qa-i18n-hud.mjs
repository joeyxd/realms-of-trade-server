// Real client layout acceptance. Public mode uses the existing guest authority; local mode uses SoloWorker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), remote = process.env.MN_PUBLIC_URL;
const out = path.resolve('docs/delivery/i18n04b', remote ? 'hud-public' : 'hud-local');
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(pathToFileURL(path.resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
let server;
if (!remote) {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep) || name.includes('/.env') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}
const base = remote || `http://127.0.0.1:${server.address().port}`;
const report = { at: new Date().toISOString(), scope: remote ? 'Public guest HUD, real CDN and WebSocket' : 'Local real client and SoloWorker, local CDN substitutes', checks: [], errors: [], screenshots: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const clear = (a, b) => a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-MX' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', msg => { if (msg.text().includes('[i18n] Missing')) report.errors.push(msg.text()); });
  if (!remote) {
    await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
      const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
      const f = path.resolve(m[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', m[2]);
      return route.fulfill({ status: fs.existsSync(f) ? 200 : 404, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.existsSync(f) ? fs.readFileSync(f) : '' });
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.abort());
  }
  await page.goto(base + (remote ? '/?q=low&debug' : '/?solo&q=low&tod=day&debug'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
  await page.locator('#btn-play').focus(); await page.locator('#btn-play').press('Enter');
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.hud-player')).opacity) >= 0.99);
  await page.waitForTimeout(1000); // Let the entrance stagger finish before measuring the tracker.
  report.transport = await page.evaluate(() => window.__mn.transport.kind);
  report.version = await page.evaluate(async () => (await import('/src/data/meta.js')).GAME.version);
  report.protocol = await page.evaluate(async () => (await import('/src/net/protocol.js')).PROTOCOL_VERSION);
  if (remote) assert.equal(report.transport, 'ws');
  for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(({ width, height }) => {
      const b = document.querySelector('#stage').getBoundingClientRect();
      return Math.abs(b.width - width) < 1 && Math.abs(b.height - height) < 1;
    }, viewport);
    for (const locale of ['es', 'en']) {
      await page.evaluate(async locale => (await import('/src/core/i18n.js')).setLocale(locale), locale);
      await page.waitForTimeout(800); // The translated tracker title has a half-second entrance animation.
      const boxes = await page.evaluate(() => Object.fromEntries(['.tracker', '.world-minimap', '.minimap-caption'].map(selector => {
        const el = document.querySelector(selector), b = el.getBoundingClientRect();
        return [selector, { top: b.top, bottom: b.bottom, left: b.left, right: b.right, visible: getComputedStyle(el).display !== 'none' }];
      })));
      assert.equal(boxes['.tracker'].visible, true);
      assert.ok(clear(boxes['.tracker'], boxes['.world-minimap']) && clear(boxes['.tracker'], boxes['.minimap-caption']), 'Objectives clear the map and caption: ' + JSON.stringify(boxes));
      assert.ok(boxes['.tracker'].bottom <= viewport.height && boxes['.tracker'].right <= viewport.width, 'Objectives remain inside the stage: ' + JSON.stringify(boxes));
      // Presentation-only row exercises CSS-generated copy without changing crew/game state.
      const fallen = await page.evaluate(() => {
        const row = document.createElement('div'); row.className = 'party';
        row.innerHTML = '<div class="pm dead"><span class="pn">QA</span></div>';
        document.querySelector('#hud').append(row);
        const content = getComputedStyle(row.querySelector('.pn'), '::after').content;
        row.remove(); return content;
      });
      assert.match(fallen, locale === 'es' ? /caído/ : /fallen/);
      const shot = `${viewport.width}-${locale}.png`;
      await page.screenshot({ path: path.join(out, shot) }); report.screenshots.push(shot);
      report.checks.push({ viewport, locale, boxes, fallen });
    }
  }
  assert.deepEqual(report.errors, []);
  await context.close(); report.pass = true;
} finally {
  await browser.close(); server?.close();
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

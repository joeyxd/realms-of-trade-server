import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the local Playwright index.mjs path as argument 1');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const run = process.argv[3] || 'reference11';
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid capture run');
const root = new URL('../../.scratch/browser-lab/', import.meta.url);
await fs.mkdir(root, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1050 } });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(`http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=${run}`);
  await page.waitForFunction(() => window.pilot?.ready || window.pilot?.errors.length, { timeout: 20000 });
  const initial = await page.evaluate(() => ({ ready: pilot.ready, errors: pilot.errors, count: pilot.count, draws: pilot.drawCalls, textures: pilot.textures }));
  if (!initial.ready) throw new Error(JSON.stringify(initial));
  assert.equal(initial.count, 22); assert.equal(initial.draws, 3);
  await page.locator('#tone').selectOption('aces');
  await page.locator('#tone').dispatchEvent('input');
  for (const view of ['front', 'oblique', 'side']) {
    await page.evaluate(v => pilot.setCamera(v), view);
    await page.waitForFunction(() => document.querySelector('#reference').complete);
    await page.screenshot({ path: fileURLToPath(new URL(`${view}.png`, root)), fullPage: true });
    await page.locator('#preview').screenshot({ path: fileURLToPath(new URL(`render-${view}.png`, root)) });
    await fs.writeFile(new URL(`canvas-${view}.png`, root), Buffer.from(await page.locator('#preview').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  }
  await page.locator('#linear-reference').check();
  for (const view of ['front', 'oblique', 'side']) {
    await page.evaluate(v => pilot.setCamera(v), view);
    await page.screenshot({ path: fileURLToPath(new URL(`linear-${view}.png`, root)), fullPage: true });
    await fs.writeFile(new URL(`ue-linear-${view}.png`, root), Buffer.from(await page.locator('#reference').evaluate(img => img.src.split(',')[1]), 'base64'));
  }
  await page.locator('#linear-reference').uncheck();
  const stage = page.locator('#preview');
  const beforeOrbit = await stage.evaluate(c => c.toDataURL());
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 20, { steps: 5 }); await page.mouse.up();
  assert.notEqual(await stage.evaluate(c => c.toDataURL()), beforeOrbit);
  results.push({ check: 'orbit-changes-render', okay: true });
  await page.evaluate(() => pilot.setCamera('side'));
  await page.locator('#flame').uncheck();
  results.push({ check: 'smoke-only', count: await page.evaluate(() => pilot.count) });
  await page.locator('#smoke').uncheck();
  results.push({ check: 'both-hidden', count: await page.evaluate(() => pilot.count) });
  await page.locator('#flame').check(); await page.locator('#smoke').check();
  await page.locator('#play').click(); await page.waitForTimeout(400); await page.locator('#play').click();
  results.push({ check: 'play-advances', frame: await page.evaluate(() => pilot.frame) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => pilot.seek(120));
  await page.screenshot({ path: fileURLToPath(new URL('mobile.png', root)), fullPage: true });
  results.push({ check: 'mobile-no-overflow', okay: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) });
  await page.evaluate(() => pilot.dispose());
  results.push({ check: 'disposed', memory: await page.evaluate(() => pilot.resourcesAfterDispose) });
  assert.equal(results.find(r => r.check === 'smoke-only').count, 19);
  assert.equal(results.find(r => r.check === 'both-hidden').count, 0);
  assert.ok(results.find(r => r.check === 'play-advances').frame > 120);
  assert.ok(results.find(r => r.check === 'mobile-no-overflow').okay);
  assert.deepEqual(results.find(r => r.check === 'disposed').memory, { geometries: 0, textures: 0 });
  assert.deepEqual(errors, []); assert.ok(requests.every(r => r.method === 'GET' && new URL(r.url).hostname === '127.0.0.1'));
  await fs.writeFile(new URL('qa.json', root), JSON.stringify({ initial, results, errors, requests }, null, 2));
  console.log(JSON.stringify({ initial, results, errors, nonGet: requests.filter(r => r.method !== 'GET') }));
} finally { await browser.close(); }

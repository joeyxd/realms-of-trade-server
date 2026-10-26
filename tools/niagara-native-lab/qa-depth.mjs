import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
if (!process.argv[2]) throw new Error('Pass Playwright module path');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const run = process.argv[3] || 'depth02';
if (!/^[A-Za-z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid depth run');
const out = new URL(`../../.scratch/depth-lab/${run}/`, import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1250 } });
  const errors = [], requests = [], checks = [], calibration = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(`http://127.0.0.1:5197/tools/niagara-native-lab/depth.html?run=${run}`);
  await page.waitForFunction(() => window.depthLab?.ready || window.depthLab?.errors.length);
  assert.ok(await page.evaluate(() => depthLab.ready), JSON.stringify(await page.evaluate(() => depthLab.errors)));
  assert.equal(await page.evaluate(() => depthLab.count), 22);
  const save = async (label, name) => fs.writeFile(new URL(`${name}-${label}.png`, out), Buffer.from(
    await page.locator(label === 'native' ? '#preview' : '#reference').evaluate(el =>
      (el.tagName === 'CANVAS' ? el.toDataURL() : el.src).split(',')[1]), 'base64'));
  for (const gap of [-25, 0, 25, 50, 100, 150]) {
    await page.evaluate(g => depthLab.calibrate(g), gap);
    const rgb = await page.evaluate(() => depthLab.linearCenter()), expected = Math.min(1, Math.max(0, gap / 100));
    assert.ok(rgb.every(v => Math.abs(v - expected) < .01), JSON.stringify({ gap, rgb, expected }));
    calibration.push({ gapCm: gap, expected, nativeLinearRGB: rgb });
    await save('native', 'calibration'+gap); await save('ue', 'calibration'+gap);
  }
  checks.push('GPU calibration: contact/occlusion, quarter, half and full opacity match 100cm source span');
  for (const view of ['front', 'oblique', 'side']) for (const name of ['none', 'wall-25', 'wall0', 'wall50', 'wall150']) {
    await page.evaluate(([n, v]) => depthLab.select(n, v), [name, view]);
    await save('native', name+'_'+view); await save('ue', name+'_'+view);
    if (name === 'wall50') await page.screenshot({ path: fileURLToPath(new URL(`depth-${view}.png`, out)), fullPage: true });
  }
  await page.evaluate(() => depthLab.select('floor', 'oblique'));
  await save('native', 'floor_oblique'); await save('ue', 'floor_oblique');
  await page.screenshot({ path: fileURLToPath(new URL('depth-floor.png', out)), fullPage: true });
  checks.push('all 16 pilot cases: independent source-generated particles, surfaces and three cameras');
  const before = await page.evaluate(() => depthLab.snapshot);
  const fadeOn = await page.locator('#preview').evaluate(c => c.toDataURL());
  await page.locator('#fade').uncheck();
  assert.notEqual(await page.locator('#preview').evaluate(c => c.toDataURL()), fadeOn);
  assert.deepEqual(await page.evaluate(() => depthLab.snapshot), before);
  await page.screenshot({ path: fileURLToPath(new URL('depth-floor-hard.png', out)), fullPage: true });
  await page.locator('#fade').check();
  await page.locator('#flame').uncheck(); assert.equal(await page.evaluate(() => depthLab.count), 19);
  await page.locator('#smoke').uncheck(); assert.equal(await page.evaluate(() => depthLab.count), 0);
  await page.locator('#reset').click();
  await page.waitForFunction(() => depthLab.case === 'wall50' && depthLab.camera === 'oblique');
  const box = await page.locator('#preview').boundingBox();
  await page.mouse.move(box.x+100, box.y+100); await page.mouse.down(); await page.mouse.move(box.x+160, box.y+140); await page.mouse.up();
  assert.ok(await page.evaluate(() => depthLab.freeCamera));
  checks.push('fade toggle preserves state; layers, reset and camera orbit work');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#reset').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: fileURLToPath(new URL('depth-mobile.png', out)), fullPage: true });
  checks.push('390px controls fit; physical device FPS not measured');
  assert.ok(!requests.some(r => /particles\.json|particles\/step_|update-fixture/.test(r.url)));
  assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith('http://127.0.0.1:5197/')));
  assert.deepEqual(errors, []);
  const stats = await page.evaluate(() => depthLab.stats);
  await page.evaluate(() => { depthLab.dispose(); depthLab.dispose(); });
  assert.deepEqual(await page.evaluate(() => depthLab.resourcesAfterDispose), { geometries: 0, textures: 0 });
  checks.push('no particle captures as inputs, only local GET, zero errors, all GPU resources disposed');
  await fs.writeFile(new URL('browser.json', out), JSON.stringify({ run, checks, calibration, errors, requests, stats,
    resourcesAfterDispose: { geometries: 0, textures: 0 } }, null, 2)+'\n');
  console.log(JSON.stringify({ run, checks: checks.length, calibration, errors, stats }));
} finally { await browser.close(); }

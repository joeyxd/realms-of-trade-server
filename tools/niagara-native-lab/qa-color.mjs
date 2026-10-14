import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass Playwright module path');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const run = process.argv[3] || 'color07';
if (!/^[A-Za-z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid color run');
const out = new URL(`../../.scratch/color-lab/${run}/`, import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1250 } });
  const errors = [], requests = [], checks = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(`http://127.0.0.1:5197/tools/niagara-native-lab/color.html?run=${run}`);
  await page.waitForFunction(() => window.colorLab?.ready || window.colorLab?.errors.length);
  assert.ok(await page.evaluate(() => colorLab.ready), JSON.stringify(await page.evaluate(() => colorLab.errors)));
  const original = await page.evaluate(() => colorLab.snapshot);
  const save = async name => fs.writeFile(new URL(`${name}.png`, out), Buffer.from(
    await page.locator('#preview').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  for (const bias of [0, 1]) for (const kind of ['chart', 'pilot']) for (const view of kind === 'chart' ? ['front'] : ['front', 'oblique', 'side']) {
    await page.evaluate(([k,v,b]) => colorLab.select(k,v,b), [kind, view, bias]);
    await page.waitForFunction(() => document.querySelector('#reference').complete && document.querySelector('#reference').naturalWidth === 512);
    await page.locator('#use-ue-hdr').uncheck();
    await save(`${kind}EV${bias}_${view}_native`);
    if (kind === 'pilot' && bias === 0) await page.screenshot({ path: fileURLToPath(new URL(`color-${view}.png`, out)), fullPage: true });
    if (kind === 'chart') await page.screenshot({ path: fileURLToPath(new URL(`color-chart-EV${bias}.png`, out)), fullPage: true });
    await page.locator('#use-ue-hdr').check();
    await save(`${kind}EV${bias}_${view}_transfer`);
  }
  checks.push('native chart and pilot plus isolated UE HDR transfer in all eight reference cases');
  await page.locator('#reset').click();
  await page.waitForFunction(() => colorLab.case === 'pilot' && colorLab.camera === 'oblique' && colorLab.bias === 0);
  const film = await page.locator('#preview').evaluate(c => c.toDataURL());
  await page.locator('#tone').selectOption('aces');
  assert.notEqual(await page.locator('#preview').evaluate(c => c.toDataURL()), film);
  await page.screenshot({ path: fileURLToPath(new URL('color-previous-aces.png', out)), fullPage: true });
  await page.locator('#tone').selectOption('linear');
  assert.notEqual(await page.locator('#preview').evaluate(c => c.toDataURL()), film);
  await page.locator('#tone').selectOption('film');
  assert.equal(await page.locator('#preview').evaluate(c => c.toDataURL()), film);
  assert.deepEqual(await page.evaluate(() => colorLab.snapshot), original);
  checks.push('previous ACES and linear remain available; presentation never mutates native particles');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: fileURLToPath(new URL('color-mobile.png', out)), fullPage: true });
  checks.push('390px controls fit; physical phone FPS remains unmeasured');
  assert.ok(!requests.some(r => /particles\.json|particles\/step_|update-fixture/.test(r.url)));
  assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith('http://127.0.0.1:5197/')));
  assert.deepEqual(errors, []);
  const stats = await page.evaluate(() => colorLab.stats);
  await page.evaluate(() => { colorLab.dispose(); colorLab.dispose(); });
  assert.deepEqual(await page.evaluate(() => colorLab.resourcesAfterDispose), { geometries: 0, textures: 0 });
  checks.push('zero captured state inputs, local GET only, no errors, all GPU resources released');
  await fs.writeFile(new URL('browser.json', out), JSON.stringify({ run, checks, errors, requests, stats,
    resourcesAfterDispose: { geometries: 0, textures: 0 } }, null, 2)+'\n');
  console.log(JSON.stringify({ run, checks: checks.length, errors, stats }));
} finally { await browser.close(); }

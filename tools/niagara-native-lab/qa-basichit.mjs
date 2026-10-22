// Browser QA of basichit.html: saves every gate canvas into a fresh run folder (refuses an existing one).
// Saved canvases: the 15 native frames in gate order plus the empty t0000, the 3 transfer canvases (the raw RGBA16F
// SceneColor HDR of basichit-reference05 through the lab LUT) and the 15 reverse-order diagnostics. Only local GETs,
// zero console errors, GPU resources released. Run it from any shell with the server of README.md on 127.0.0.1:5197.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const USAGE = 'usage: node tools/niagara-native-lab/qa-basichit.mjs <playwright index.mjs> <new run folder name>';
if (!process.argv[2] || !process.argv[3] || process.argv.length !== 4) throw new Error(USAGE);
const run = process.argv[3];
if (!/^[A-Za-z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid run folder name');
const parent = new URL('../../.scratch/basichit-render/', import.meta.url), out = new URL(`${run}/`, parent);
await fs.mkdir(parent, { recursive: true });
await fs.mkdir(out); // EEXIST: an existing run folder is never overwritten
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const STEPS = [2, 6, 12, 18, 24], CAMERAS = ['front', 'oblique', 'side'];
const name = (step, camera, kind) => `t${String(step).padStart(4, '0')}_${camera}_${kind}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [], requests = [], checks = [], canvases = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await page.goto('http://127.0.0.1:5197/tools/niagara-native-lab/basichit.html');
  await page.waitForFunction(() => window.basicHitLab?.ready || window.basicHitLab?.errors.length, null, { timeout: 120000 });
  assert.ok(await page.evaluate(() => basicHitLab.ready), JSON.stringify(await page.evaluate(() => basicHitLab.errors)));
  async function save(step, camera, order, source, kind) {
    await page.evaluate(([s, c, o, k]) => basicHitLab.select(s, c, o, k), [step, camera, order, source]);
    const selected = await page.evaluate(() => [basicHitLab.step, basicHitLab.camera, basicHitLab.order, basicHitLab.source]);
    assert.deepEqual(selected, [step, camera, order, source]);
    await page.waitForFunction(() => document.querySelector('#reference').complete && document.querySelector('#reference').naturalWidth === 1024);
    const file = name(step, camera, kind) + '.png';
    await fs.writeFile(new URL(file, out), Buffer.from(await page.locator('#preview').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
    canvases.push(file);
    return page.evaluate(() => ({ counts: basicHitLab.counts, stats: basicHitLab.stats }));
  }
  const frames = {};
  await save(0, 'front', 'gate', 'native', 'native');
  for (const step of STEPS) for (const camera of CAMERAS) frames[name(step, camera, 'native')] = await save(step, camera, 'gate', 'native', 'native');
  checks.push('15 native canvases in gate order (Flame, Flash, SimpleBurst) plus the empty t0000, at 1024 px');
  for (const camera of CAMERAS) await save(12, camera, 'gate', 'transfer', 'transfer');
  checks.push('3 transfer canvases: Unreal raw RGBA16F SceneColor HDR at step 12 through the same Filmic LUT');
  for (const step of STEPS) for (const camera of CAMERAS) await save(step, camera, 'reverse', 'native', 'reverse');
  checks.push('15 reverse-order canvases, diagnostic only');
  // Presentation never mutates the native particles; the reset returns the gate view.
  await page.evaluate(() => basicHitLab.select(12, 'front'));
  const original = await page.evaluate(() => basicHitLab.snapshot), gate = await page.locator('#preview').evaluate(c => c.toDataURL());
  await page.locator('#use-ue-hdr').check();
  assert.notEqual(await page.locator('#preview').evaluate(c => c.toDataURL()), gate);
  await page.locator('#order').selectOption('reverse');
  await page.locator('#reset').click();
  await page.waitForFunction(() => basicHitLab.step === 12 && basicHitLab.camera === 'front' && basicHitLab.order === 'gate' && basicHitLab.source === 'native');
  assert.equal(await page.locator('#preview').evaluate(c => c.toDataURL()), gate);
  assert.deepEqual(await page.evaluate(() => basicHitLab.snapshot), original);
  checks.push('the HDR toggle, order and reset change only the presentation; native particles unchanged');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('390px controls fit (no screenshot kept: page text is not pixel evidence)');
  assert.ok(!requests.some(r => /particles\.json|particles\/step_|update-fixture/.test(r.url)), 'captured particle states requested');
  assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith('http://127.0.0.1:5197/')), 'non-local or non-GET request');
  assert.deepEqual(errors, []);
  const stats = await page.evaluate(() => basicHitLab.stats);
  await page.evaluate(() => { basicHitLab.dispose(); basicHitLab.dispose(); });
  assert.deepEqual(await page.evaluate(() => basicHitLab.resourcesAfterDispose), { geometries: 0, textures: 0 });
  checks.push('zero captured state inputs, local GET only, no errors, all GPU resources released');
  await fs.writeFile(new URL('browser.json', out), JSON.stringify({ run, browserVersion: browser.version(), checks, canvases, frames,
    errors, requests, stats, resourcesAfterDispose: { geometries: 0, textures: 0 } }, null, 2) + '\n');
  console.log(JSON.stringify({ run, canvases: canvases.length, checks: checks.length, errors, stats }));
} finally { await browser.close(); }

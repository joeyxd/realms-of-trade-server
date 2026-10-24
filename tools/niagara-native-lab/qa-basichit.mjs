// Browser QA of basichit.html: saves every canvas of one reference set into a fresh run folder (refuses an existing one).
// Sets (basichit-lab.js REFERENCES): gate (default, basichit-reference05, steps 2-24) and wrap (basichit-reference10,
// steps 20-23, the Flame's SubUV past its 8x4 grid). Saved canvases, per image step and camera: the native frames in
// gate order plus the empty t0000, the 3 transfer canvases at the linear step (the raw RGBA16F SceneColor HDR through
// the lab LUT), the reverse-order and the engine-order diagnostics (DRAW_ORDERS of basichit-render.js); the wrap set adds
// the clamp diagnostics (the pilot's SubUV policy on the Flame). The depth set (basichit-reference12, steps 6 and 12)
// saves instead the empty t0000, the 6 controls and the 26 plane poses (native, Flame with DepthFade, gate order), the
// 26 plane poses with the Flame's DepthFade off (diagnostic), and the 16 transfer canvases at step 12 (3 controls and 13
// planes, named t0012_<view>[_<plane>]_transfer); no reverse or engine canvases. Only local GETs, zero console errors, GPU resources
// released. Run it from any shell with the server of README.md on 127.0.0.1:5197.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const USAGE = 'usage: node tools/niagara-native-lab/qa-basichit.mjs <playwright index.mjs> <new run folder name> [gate|wrap|depth]';
if (!process.argv[2] || !process.argv[3] || ![4, 5].includes(process.argv.length)) throw new Error(USAGE);
const run = process.argv[3], set = process.argv[4] ?? 'gate';
if (!/^[A-Za-z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid run folder name');
if (!['gate', 'wrap', 'depth'].includes(set)) throw new Error(USAGE);
const parent = new URL('../../.scratch/basichit-render/', import.meta.url), out = new URL(`${run}/`, parent);
await fs.mkdir(parent, { recursive: true });
await fs.mkdir(out); // EEXIST: an existing run folder is never overwritten
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const CAMERAS = ['front', 'oblique', 'side'];
const POSES = ['wall-25', 'wall0', 'wall50', 'wall150', 'floor']; // the floor is oblique only
const name = (step, camera, kind) => `t${String(step).padStart(4, '0')}_${camera}_${kind}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [], requests = [], checks = [], canvases = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await page.goto('http://127.0.0.1:5197/tools/niagara-native-lab/basichit.html' + (set === 'gate' ? '' : '?reference=' + set));
  await page.waitForFunction(() => window.basicHitLab?.ready || window.basicHitLab?.errors.length, null, { timeout: 120000 });
  assert.ok(await page.evaluate(() => basicHitLab.ready), JSON.stringify(await page.evaluate(() => basicHitLab.errors)));
  const reference = await page.evaluate(() => basicHitLab.reference), STEPS = reference.steps, TRANSFER = reference.transferStep;
  assert.equal(reference.set, set);
  const frameCount = STEPS.length * CAMERAS.length;
  async function save(step, camera, order, source, kind, subUV = 'wrap', pose = 'none', fade = true) {
    await page.evaluate(([s, c, o, k, u, p, f]) => basicHitLab.select(s, c, o, k, u, p, f), [step, camera, order, source, subUV, pose, fade]);
    const selected = await page.evaluate(() => [basicHitLab.step, basicHitLab.camera, basicHitLab.order, basicHitLab.source, basicHitLab.subUV,
      basicHitLab.pose, basicHitLab.depthFade]);
    assert.deepEqual(selected, [step, camera, order, source, subUV, pose, set === 'depth' && fade]);
    await page.waitForFunction(() => document.querySelector('#reference').complete && document.querySelector('#reference').naturalWidth === 1024);
    const file = name(step, pose === 'none' ? camera : `${camera}_${pose}`, kind) + '.png';
    await fs.writeFile(new URL(file, out), Buffer.from(await page.locator('#preview').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
    canvases.push(file);
    return page.evaluate(() => ({ counts: basicHitLab.counts, stats: basicHitLab.stats }));
  }
  const frames = {};
  await save(0, 'front', 'gate', 'native', 'native');
  // Depth set: the plane poses of a view (the controls are pose 'none').
  const posesOf = camera => POSES.filter(p => p !== 'floor' || camera === 'oblique');
  for (const step of STEPS) for (const camera of CAMERAS) for (const pose of set === 'depth' ? ['none', ...posesOf(camera)] : ['none']) {
    const key = pose === 'none' ? camera : `${camera}_${pose}`;
    frames[name(step, key, 'native')] = await save(step, camera, 'gate', 'native', 'native', 'wrap', pose);
  }
  checks.push(`${frameCount} native canvases in gate order (Flame, Flash, SimpleBurst) plus the empty t0000, at 1024 px`);
  if (set === 'depth') {
    checks.push('the controls and the 26 plane poses above went through the opaque pass (plane occludes, Flame with DepthFade 100 cm)');
    for (const step of STEPS) for (const camera of CAMERAS) for (const pose of posesOf(camera)) await save(step, camera, 'gate', 'native', 'nofade', 'wrap', pose, false);
    checks.push('26 plane poses with the Flame DepthFade off (the plane still occludes), diagnostic only');
    for (const camera of CAMERAS) for (const pose of ['none', ...posesOf(camera)]) await save(TRANSFER, camera, 'gate', 'transfer', 'transfer', 'wrap', pose);
    checks.push(`16 transfer canvases: Unreal raw RGBA16F SceneColor HDR of the 3 controls and 13 planes at step ${TRANSFER} through the same Filmic LUT`);
  } else {
    for (const camera of CAMERAS) await save(TRANSFER, camera, 'gate', 'transfer', 'transfer');
    checks.push(`3 transfer canvases: Unreal raw RGBA16F SceneColor HDR at step ${TRANSFER} through the same Filmic LUT`);
    for (const step of STEPS) for (const camera of CAMERAS) await save(step, camera, 'reverse', 'native', 'reverse');
    checks.push(`${frameCount} reverse-order canvases, diagnostic only`);
    for (const step of STEPS) for (const camera of CAMERAS) await save(step, camera, 'engine', 'native', 'engine');
    checks.push(`${frameCount} engine-order canvases (Flash, SimpleBurst, Flame: RendererDrawOrder of UE 5.8), diagnostic only`);
  }
  if (set === 'wrap') {
    for (const step of STEPS) for (const camera of CAMERAS) await save(step, camera, 'gate', 'native', 'clamp', 'clamp');
    checks.push(`${frameCount} clamp canvases (the pilot's SubUV policy on the Flame past its 8x4 grid), diagnostic only`);
  }
  // Presentation never mutates the native particles; the reset returns the gate view.
  await page.evaluate(step => basicHitLab.select(step, 'front'), TRANSFER);
  const original = await page.evaluate(() => basicHitLab.snapshot), gate = await page.locator('#preview').evaluate(c => c.toDataURL());
  await page.locator('#use-ue-hdr').check();
  assert.notEqual(await page.locator('#preview').evaluate(c => c.toDataURL()), gate);
  await page.locator('#order').selectOption('reverse');
  await page.locator('#subuv').selectOption('clamp');
  if (set === 'depth') { await page.locator('#surface').selectOption('wall0'); await page.locator('#fade').uncheck(); }
  await page.locator('#reset').click();
  await page.waitForFunction(([step, depth]) => basicHitLab.step === step && basicHitLab.camera === 'front' && basicHitLab.order === 'gate' &&
    basicHitLab.source === 'native' && basicHitLab.subUV === 'wrap' && basicHitLab.pose === 'none' && basicHitLab.depthFade === depth, [TRANSFER, set === 'depth']);
  assert.equal(await page.locator('#preview').evaluate(c => c.toDataURL()), gate);
  assert.deepEqual(await page.evaluate(() => basicHitLab.snapshot), original);
  checks.push('the HDR toggle, order, SubUV and reset change only the presentation; native particles unchanged');
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
  await fs.writeFile(new URL('browser.json', out), JSON.stringify({ run, reference, browserVersion: browser.version(), checks, canvases, frames,
    errors, requests, stats, resourcesAfterDispose: { geometries: 0, textures: 0 } }, null, 2) + '\n');
  console.log(JSON.stringify({ run, canvases: canvases.length, checks: checks.length, errors, stats }));
} finally { await browser.close(); }

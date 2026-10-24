// Private GM fixture only; screenshots and evidence never enter the asset catalogs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
const run = process.argv[2];
if (!/^[A-Za-z0-9_-]{1,40}$/.test(run || '')) throw new Error('Usage: node tools/qa-native-studio.mjs <new-run>');
const out = resolve('.scratch/native-studio', run), id = 'niagara-97a82bae61b29237';
await mkdir(resolve('.scratch/native-studio'), { recursive: true });
await mkdir(out); // EEXIST refuses to overwrite any prior evidence.
const evidence = { checks: [], screenshots: [], errors: [], failedRequests: [], writes: [], gameplay: [], samples: [], release: [] };
const GM = '77777777-7777-4777-8777-777777777777';
let server, browser, page, phase = 'private server';
const check = async (name, fn) => { phase = name; await fn(); evidence.checks.push(name); console.log('PASS ' + name); };
const shot = async name => { await page.screenshot({ path: resolve(out, name + '.png') }); evidence.screenshots.push(name + '.png'); };
const ready = () => page.waitForFunction(() => __mn.skillStudio.preview.native.state === 'ready', null, { timeout: 30000 });
async function armRelease() {
  await page.evaluate(() => {
    const native = __mn.skillStudio.preview.native;
    const objects = [...native.resources, ...native.particles.layers.flatMap(m => [m.geometry, m.material])];
    const released = new Set();
    for (const object of objects) object.addEventListener?.('dispose', () => released.add(object));
    window.__nativeReleaseCheck = () => ({ resources: native.metrics.nativeResources,
      allDisposed: objects.every(o => o.addEventListener ? released.has(o) : o.width === 0),
      layersReleased: native.particles === null, count: objects.length });
  });
}
async function released() {
  const result = await page.evaluate(() => __nativeReleaseCheck()); evidence.release.push(result);
  assert.ok(result.count > 0 && result.allDisposed && result.layersReleased); assert.equal(result.resources, 0);
}
try {
  server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log() {}, saveSecret: 'native-private-fixture',
    gmDraftsAllowMemory: true, gmAccountIds: [GM], publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
    resolvePlayer: async (_request, hello) => hello.token === 'native-fixture' ? GM : null });
  const origin = `http://127.0.0.1:${await server.listen()}`;
  const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href);
  phase = 'launch Chrome';
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 45000,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  // Typography is outside this GPU fixture; use system fonts without an external network dependency.
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  evidence.fonts = 'system fonts; external Google Fonts stylesheet replaced with empty CSS';
  await context.addInitScript(account => {
    localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, quality: 'low', muted: true }));
    const session = { access_token: 'native-fixture', user: { id: account } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange() {}, signInWithPassword: async () => ({ data: { session } }),
      signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
  }, GM);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '../gm-editor-first/.scratch/gsap-local/package', match[2]);
    return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', e => evidence.errors.push(e.message));
  page.on('requestfailed', r => evidence.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('console', m => { if (m.type() === 'error') evidence.errors.push(m.text()); });
  page.on('request', r => { if (r.method() !== 'GET' && /\/api\/gm\//.test(r.url())) evidence.writes.push(r.url()); });
  page.on('websocket', ws => ws.on('framesent', e => { try {
    const frame = JSON.parse(String(e.payload)); if (['join', 'input', 'cmd'].includes(frame.t)) evidence.gameplay.push(frame.t);
  } catch {} }));
  phase = 'open workshop';
  await page.goto(origin + '/?q=low&tod=day', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-skill-studio')?.disabled
    && getComputedStyle(document.querySelector('#fade')).display === 'none', null, { timeout: 90000 });
  await page.locator('#btn-skill-studio').click();
  await page.waitForFunction(() => __mn.skillStudio?.active && __mn.skillStudio.preview.metrics.drawCalls > 0);
  await check('MyProject_native_ready_ES', async () => {
    await page.evaluate(id => __mn.skillStudio.selectEffect(id), id); await ready();
    assert.match(await page.locator('.ss-selected-role').textContent(), /Nativo · medido contra UE 5.8/);
    assert.equal(await page.locator('[data-parameter="seed"]').getAttribute('aria-label'), 'Semilla');
    assert.match(await page.locator('.ss-native-note').textContent(), /Controles de presentación: no medidos contra UE/);
    assert.match(await page.locator('.ss-compare').textContent(), /Base del adaptador/);
  });
  async function sample(step) {
    const result = await page.evaluate(async step => {
      const p = __mn.skillStudio.preview, { SKILLS } = await import('/src/data/weapons.js');
      const { BasicHitSimulation } = await import('/src/render/vfx/niagara/basichit-simulation.js');
      const { Vector3 } = await import('three');
      p.pause(); p.seek(SKILLS.tromba.windup + SKILLS.tromba.delay + step / 60);
      p.document.parameters.opacity = 0; p.render(0);
      const r = p.renderer, gl = r.getContext(), box = p.viewport.getBoundingClientRect(), ratio = r.getPixelRatio();
      const point = new Vector3(0, 1, 0).project(p.camera), side = 80;
      const x = Math.round((box.left + (point.x + 1) * box.width / 2) * ratio - side / 2);
      const y = Math.round(gl.drawingBufferHeight - (box.top + (1 - point.y) * box.height / 2) * ratio - side / 2);
      const read = () => { const a = new Uint8Array(side * side * 4); gl.readPixels(x, y, side, side, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      const background = read(); p.document.parameters.opacity = 1; p.render(0); const image = read();
      let changed = 0; for (let i = 0; i < image.length; i += 4) if ([0, 1, 2].some(c => image[i + c] !== background[i + c])) changed++;
      const simulation = new BasicHitSimulation(p.native.source, { seed: p.parameters.seed });
      return { step, seed: p.parameters.seed, quality: p.quality, actualStep: p.native.step, changedPixels: changed, counts: p.metrics.counts,
        expected: simulation.seek(step).emitters.map(e => e.particles.length), cap: p.metrics.cap, drawCalls: p.metrics.drawCalls,
        target: [p.native.hdr.width, p.native.hdr.height], viewport: [Math.round(box.width * ratio), Math.round(box.height * ratio)] };
    }, step);
    evidence.samples.push(result); assert.equal(result.actualStep, step); assert.deepEqual(result.counts, result.expected);
    assert.ok(result.changedPixels > 0); assert.equal(result.cap, 512); assert.ok(result.drawCalls > 0);
    assert.deepEqual(result.target, result.viewport); await shot(`native-step-${step}-${result.seed}-${result.quality}`);
  }
  await check('impact_plus_6_and_12_visible_exact_counts', async () => { await sample(6); await sample(12); });
  await check('switch_flipbook_and_back_releases_every_native_resource', async () => {
    await armRelease();
    await page.evaluate(() => __mn.skillStudio.selectEffect('component-26e09bd0f93cb620-7x7-luma')); await released();
    await page.waitForFunction(() => __mn.skillStudio.preview.flipbook.state === 'ready');
    await page.evaluate(id => __mn.skillStudio.selectEffect(id), id); await ready();
  });
  await check('seed_replay_mobile_and_EN', async () => {
    await page.evaluate(() => { const s = __mn.skillStudio; s.updateParameter('seed', 12345); s.endGesture(); s.preview.setQuality('mobile'); });
    await page.selectOption('.ss-inspector select[aria-label="Calidad"]', 'mobile');
    assert.equal(await page.evaluate(() => __mn.skillStudio.preview.quality), 'mobile');
    await sample(12);
    await page.locator('[data-action="language"]').click();
    assert.match(await page.locator('.ss-selected-role').textContent(), /Native · measured against UE 5.8/);
    assert.equal(await page.locator('[data-parameter="seed"]').getAttribute('aria-label'), 'Seed');
    assert.match(await page.locator('.ss-native-note').textContent(), /Presentation controls: not measured against UE/);
    await shot('native-en-mobile-quality');
  });
  await check('close_releases_resources_zero_gameplay_and_GM_writes', async () => {
    await armRelease(); await page.evaluate(() => __mn.skillStudio.close({ force: true })); await released();
    assert.equal(await page.evaluate(() => __mn.client.joined), false);
    assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.writes, []); assert.deepEqual(evidence.gameplay, []);
  });
} catch (error) {
  evidence.failure = { phase, message: error.stack }; process.exitCode = 1;
  if (page) await shot('failure').catch(() => {});
  console.error(error.stack);
} finally {
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser?.close(); await server?.close(); console.log(JSON.stringify({ out, checks: evidence.checks, failure: evidence.failure || null }));
}

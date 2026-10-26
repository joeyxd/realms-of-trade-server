// Private GM server only. Evidence stays outside git; no production publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { validatePresentationBindings } from '../src/data/presentationBindings.js';
const run = process.argv[2];
if (!/^[A-Za-z0-9_-]{1,40}$/.test(run ?? '')) throw new Error('Usage: node tools/qa-presentation-studio.mjs <new-run>');
const out = resolve('.scratch/qa-presentation-studio', run);
await mkdir(resolve('.scratch/qa-presentation-studio'), { recursive: true }); await mkdir(out);
const evidence = { checks: [], screenshots: [], errors: [] }, GM = '77777777-7777-4777-8777-777777777777';
let server, browser, page, phase = 'server';
const check = async (name, fn) => { phase = name; await fn(); evidence.checks.push(name); console.log('PASS ' + name); };
const shot = async name => { await page.locator('.ss-presentation').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, name + '.png') }); evidence.screenshots.push(name + '.png'); };
try {
  server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'presentation-private-fixture',
    gmDraftsAllowMemory: true, gmAccountIds: [GM], publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
    resolvePlayer: async (_req, hello) => hello.token === 'presentation-fixture' ? GM : null });
  const origin = `http://127.0.0.1:${await server.listen()}`;
  const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href);
  phase = 'browser';
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 45000,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.addInitScript(account => {
    localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, quality: 'low', muted: true }));
    const session = { access_token: 'presentation-fixture', user: { id: account } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange() {}, signInWithPassword: async () => ({ data: { session } }),
      signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
  }, GM);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '../gm-editor-first/.scratch/gsap-local/package', match[2]);
    return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
  await check('open_workshop', async () => {
    await page.goto(origin + '/?q=low&tod=day', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-skill-studio')?.disabled
      && getComputedStyle(document.querySelector('#fade')).display === 'none', null, { timeout: 90000 });
    await page.locator('#btn-skill-studio').click();
    await page.waitForFunction(() => __mn.skillStudio?.active && __mn.skillStudio.preview.metrics.drawCalls > 0);
  });
  await check('flame_slots_and_local_test', async () => {
    await page.evaluate(() => __mn.skillStudio.selectEffect('niagara-985a431dc6c0d1ca'));
    assert.match(await page.locator('.ss-presentation').textContent(), /Usar en el juego/);
    assert.deepEqual(await page.locator('[data-presentation-slot] option').allTextContents(), ['Hoguera', 'Braseros y antorchas']);
    await page.evaluate(() => { const studio = __mn.skillStudio; studio.updateParameter('scale', 1.5); studio.endGesture(); });
    await page.locator('[data-presentation-count]').evaluate(input => { input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('[data-action="presentation-test"]').click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mn.presentation.preview.v1')));
    assert.ok(validatePresentationBindings(stored).ok); assert.ok(stored.bindings.campfire);
    const parameters = await page.evaluate(() => __mn.skillStudio.document.parameters);
    assert.deepEqual(stored.bindings.campfire.parameters, { ...parameters, count: 3 });
    evidence.preview = stored; await shot('flame-local-test-es');
  });
  await check('publish_readback_and_remove', async () => {
    await page.locator('[data-action="presentation-publish"]').click();
    await page.waitForFunction(() => __mn.skillStudio.presentation.revision === 1);
    const published = await (await fetch(origin + '/api/world/presentation')).json();
    assert.equal(published.revision, 1); assert.deepEqual(published.document, evidence.preview);
    // A second player has no local override and receives the same publication.
    const remote = await page.evaluate(async () => {
      const { createPresentationClient } = await import('/src/net/presentationClient.js');
      const client = createPresentationClient({ httpBase: location.origin }); await client.load(); return client.effective();
    });
    assert.deepEqual(remote, published.document);
    await page.locator('[data-action="presentation-clear"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('mn.presentation.preview.v1')), null);
    await page.locator('[data-action="presentation-remove"]').click();
    await page.waitForFunction(() => __mn.skillStudio.presentation.revision === 2);
    assert.deepEqual((await (await fetch(origin + '/api/world/presentation')).json()).document.bindings, {});
  });
  await check('hit_slots_and_english', async () => {
    await page.evaluate(() => __mn.skillStudio.selectEffect('niagara-97a82bae61b29237'));
    assert.deepEqual(await page.locator('[data-presentation-slot] option').allTextContents(), ['Golpe cuerpo a cuerpo', 'Golpe confirmado']);
    assert.equal(await page.locator('[data-presentation-count]').count(), 0); await shot('hit-slots-es');
    await page.locator('[data-action="language"]').click();
    assert.match(await page.locator('.ss-presentation').textContent(), /Use in the game/);
    assert.deepEqual(await page.locator('[data-presentation-slot] option').allTextContents(), ['Melee hit', 'Confirmed hit']);
    await shot('hit-slots-en'); assert.deepEqual(evidence.errors, []);
  });
} catch (error) { evidence.failure = { phase, message: error.stack }; process.exitCode = 1; }
finally {
  await browser?.close(); await server?.close();
  await writeFile(resolve(out, 'result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
}

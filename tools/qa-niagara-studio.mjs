// Exercise the real private workshop and its catalog without entering gameplay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
const production = Boolean(process.env.MN_NIAGARA_QA_ORIGIN);
const output = resolve(process.env.MN_NIAGARA_QA_OUTPUT || 'docs/delivery/st01b/local');
const evidence = { schema: 'niagara-studio-browser/v1', at: new Date().toISOString(), version: GAME.version,
  production, simulatedAuth: !production,
  checks: [], screenshots: [], errors: [], writes: [], gameplay: [], atlasRequests: [], serverLog: [] };
const angle = process.env.MN_BROWSER_ANGLE || 'default';
evidence.angle = angle;
const GM = '77777777-7777-4777-8777-777777777777';
let server, browser, page, phase = 'setup', origin = process.env.MN_NIAGARA_QA_ORIGIN;
const check = async (name, fn) => { phase = name; await fn(); evidence.checks.push(name); console.log('PASS ' + name); };
async function shot(name) { await page.screenshot({ path: resolve(output, name + '.png') }); evidence.screenshots.push(name + '.png'); }
try {
  await mkdir(output, { recursive: true });
  if (!production) {
    console.log('SETUP private game server');
    server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log(...args) { evidence.serverLog.push(args.join(' ')); }, saveSecret: 'niagara-private-fixture',
    gmDraftsAllowMemory: true, gmAccountIds: [GM], publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
    resolvePlayer: async (_request, hello) => hello.token === 'niagara-fixture' ? GM : null });
    origin = `http://127.0.0.1:${await server.listen()}`;
  }
  evidence.runtime = await (await fetch(origin + '/status')).json();
  assert.equal(evidence.runtime.version, GAME.version);
  console.log('SETUP browser at ' + origin);
  const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
  console.log('SETUP Playwright loaded');
  phase = 'launch Chrome';
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 45000,
    args: ['--use-gl=angle', `--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist',
      ...(angle === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : [])] });
  console.log('SETUP Chrome launched');
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, quality: 'low', muted: true }));
  });
  if (!production) await context.addInitScript(account => {
    const session = { access_token: 'niagara-fixture', user: { id: account } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange() {}, signInWithPassword: async () => ({ data: { session } }),
      signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
  }, GM);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const path = resolve(match[1].startsWith('three') ? 'node_modules/three' : '../gm-editor-first/.scratch/gsap-local/package', match[2]);
    return fs.existsSync(path) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path) }) : route.abort();
  });
  page = await context.newPage();
  console.log('SETUP page ready');
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /WebGL|shader|GL_INVALID/.test(message.text())) evidence.errors.push(message.text()); });
  page.on('request', request => { if (request.method() !== 'GET' && /\/api\/gm\//.test(request.url())) evidence.writes.push(request.url()); });
  page.on('request', request => { if (/\/assets\/vfx\/niagara\/(?:niagara-[a-f0-9]{16}|component-[a-f0-9]{16}-\d+x\d+-(?:rgba|alpha|luma))-(desktop|mobile)\.webp$/.test(request.url())) evidence.atlasRequests.push(request.url()); });
  page.on('websocket', socket => socket.on('framesent', event => { try {
    const frame = JSON.parse(String(event.payload)); if (['join', 'input', 'cmd'].includes(frame.t)) evidence.gameplay.push(frame.t);
  } catch {} }));
  phase = 'load game';
  // Keep the surrounding world affordable on software CI; the private preview
  // still exercises both atlas resolutions explicitly below.
  let suffix = '';
  if (production) {
    const session = JSON.parse(await readFile(resolve(process.env.MN_NIAGARA_QA_SESSION_FILE), 'utf8'));
    assert.match(session.tokenHash, /^[a-f0-9]{32,128}$/i);
    suffix = `&account-setup=1#gm_setup_token=${session.tokenHash}`;
  }
  await page.goto(origin + '/?q=low&tod=day' + suffix, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (production) {
    await page.waitForFunction(() => window.__mn?.skillEntry?.allowed
      && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 90000 });
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
  }
  console.log('SETUP game loaded');
  phase = 'wait for authorized workshop entry';
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-skill-studio')?.disabled, null, { timeout: 90000 });
  console.log('SETUP authorized workshop entry ready');
  phase = 'wait for title fade';
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none', null, { timeout: 90000 });
  console.log('SETUP title fade complete');
  phase = 'open workshop';
  await page.locator('#btn-skill-studio').click();
  await page.waitForFunction(() => __mn.skillStudio?.active && getComputedStyle(__mn.skillStudio.root).display === 'grid'
    && __mn.skillStudio.preview?.metrics.drawCalls > 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const library = await page.evaluate(async () => {
    const { EFFECT_LIBRARY } = await import('/src/editor/effectLibrary.js');
    return EFFECT_LIBRARY.map(({ id, name, ready, role, thumbnail, category, sources }) => ({ id, name, ready, role, thumbnail, category, projects: sources.map(s => s.project) }));
  });
  evidence.catalog = { total: library.length, ready: library.filter(e => e.ready).length, sources: library.reduce((n, e) => n + e.projects.length, 0) };
  const pending = library.find(e => !e.ready && e.thumbnail && /^Spline /i.test(e.name));
  await check('complete_catalog_search_and_source_filters', async () => {
    assert.ok(library.length > 800); assert.ok(pending);
    for (const project of ['MyProject', 'ActionRPGMultiplayerStart', 'SimpleMultiplayerSurvival']) {
      const exists = await page.locator('[data-filter="project"] option').evaluateAll((options, project) => options.some(o => o.value === project), project);
      assert.equal(exists, true, `source project filter exists: ${project}`);
      await page.locator('[data-filter="project"]').selectOption(project);
      const shown = await page.locator('.ss-effect-count').textContent(); assert.match(shown, /[1-9]/);
    }
    await page.locator('[data-filter="project"]').selectOption('');
    await page.locator('[data-filter="query"]').fill(pending.name);
    assert.ok(await page.locator(`[data-effect-id="${pending.id}"]`).count());
    await shot('niagara-library-es-desktop');
  });
  await check('unconverted_source_has_no_misleading_playback_and_keeps_tromba_draft', async () => {
    await page.evaluate(() => { const s = __mn.skillStudio; s.updateParameter('height', 1.6); s.endGesture(); });
    await page.locator(`[data-effect-id="${pending.id}"]`).click();
    assert.equal(await page.locator('.ss-pending-overlay').isVisible(), true);
    assert.equal(await page.locator('[data-action="play"]').isDisabled(), true);
    assert.equal(await page.locator('[data-parameter]').count(), 0);
    await page.waitForFunction(() => { const image = document.querySelector('.ss-source-thumbnail img'); return image.complete && image.naturalWidth > 0; });
    assert.match(await page.locator('.ss-source-thumbnail figcaption').textContent(), /estática/);
    await shot('niagara-source-pending-es');
    await page.evaluate(() => __mn.skillStudio.selectEffect('tromba-current-v1'));
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.height), 1.6);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.height), 1);
  });
  const ready = library.find(e => e.id === 'component-26e09bd0f93cb620-7x7-luma' && e.ready);
  assert.ok(ready, 'at least one real source animation must be packaged');
  await check('real_exported_animation_replays_and_uses_one_quality_variant', async () => {
    await page.locator('.ss-compare input').check();
    await page.evaluate(id => __mn.skillStudio.selectEffect(id), ready.id);
    assert.equal(await page.locator('.ss-compare input').isChecked(), false);
    assert.equal(await page.evaluate(() => __mn.skillStudio.preview.original), false);
    await page.waitForFunction(() => __mn.skillStudio.preview.metrics.textureState === 'ready', null, { timeout: 30000 });
    await page.evaluate(() => { const p = __mn.skillStudio.preview; p.pause(); p.seek(1.2); });
    const frame = await page.evaluate(() => __mn.skillStudio.preview.flipbook.frame);
    assert.ok(frame >= 0);
    await page.evaluate(() => __mn.skillStudio.preview.seek(1.7));
    assert.notEqual(await page.evaluate(() => __mn.skillStudio.preview.flipbook.frame), frame);
    await shot('niagara-converted-es-desktop');
    await page.selectOption('.ss-inspector select[aria-label="Calidad"]', 'mobile');
    await page.waitForFunction(() => __mn.skillStudio.preview.metrics.textureState === 'ready');
    assert.equal(await page.evaluate(() => __mn.skillStudio.preview.flipbook.quality), 'mobile');
    await page.evaluate(() => __mn.skillStudio.preview.seek(1.7));
    await page.waitForFunction(() => __mn.skillStudio.preview.flipbook.frame >= 0 && __mn.skillStudio.preview.flipbook.sprite.visible);
    evidence.animation = { id: ready.id, role: ready.role, texture: await page.evaluate(() => {
      const p = __mn.skillStudio.preview, image = p.flipbook.texture.image;
      return { quality: p.quality, width: image.width, height: image.height, frame: p.flipbook.frame };
    }) };
    assert.ok(evidence.atlasRequests.some(url => url.endsWith(`${ready.id}-desktop.webp`)));
    assert.ok(evidence.atlasRequests.some(url => url.endsWith(`${ready.id}-mobile.webp`)));
  });
  await check('each_effect_keeps_its_draft_history_save_and_recovery', async () => {
    await page.evaluate(() => { const s = __mn.skillStudio; s.updateParameter('scale', 1.4); s.endGesture(); s.saveDraft(); });
    await page.evaluate(() => __mn.skillStudio.selectEffect('tromba-current-v1'));
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.scale), 1);
    await page.evaluate(() => { const s = __mn.skillStudio; s.updateParameter('height', 1.3); s.endGesture(); });
    await page.evaluate(id => __mn.skillStudio.selectEffect(id), ready.id);
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.scale), 1.4);
    await page.evaluate(() => { const s = __mn.skillStudio; s.updateParameter('scale', 1.8); s.endGesture(); s.saveRecovery(); s.resetDocument(); s.loadRecovery(); });
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.scale), 1.8);
    await page.evaluate(() => __mn.skillStudio.loadDraft());
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.scale), 1.4);
    await page.evaluate(() => __mn.skillStudio.selectEffect('tromba-current-v1'));
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.height), 1.3);
    await page.evaluate(() => __mn.skillStudio.undo());
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.height), 1);
    assert.equal(await page.evaluate(() => __mn.skillStudio.dirty), false, 'undo to saved state clears active and cached dirty state');
  });
  await check('pending_selection_cancels_inflight_atlas_without_replacing_drafts', async () => {
    await page.evaluate(async ({ ready, pending }) => { const s = __mn.skillStudio; await s.selectEffect(ready); await s.selectEffect(pending); }, { ready: ready.id, pending: pending.id });
    assert.equal(await page.evaluate(() => __mn.skillStudio.preview.flipbook.state), 'idle');
    assert.equal(await page.evaluate(() => __mn.skillStudio.getDocument()), null);
    await page.evaluate(id => __mn.skillStudio.selectEffect(id), ready.id);
    await page.waitForFunction(() => __mn.skillStudio.preview.metrics.textureState === 'ready');
    assert.equal(await page.evaluate(() => __mn.skillStudio.document.parameters.scale), 1.4);
  });
  await check('all_registered_derivatives_render_both_quality_variants', async () => {
    evidence.derivatives = [];
    // Native ports have their own harness (tools/qa-native-studio.mjs); this check measures flipbook atlases.
    for (const item of library.filter(effect => effect.ready && effect.adapter === 'flipbook-v1')) {
      await page.evaluate(id => __mn.skillStudio.selectEffect(id), item.id);
      for (const quality of ['desktop', 'mobile']) {
        await page.selectOption('.ss-inspector select[aria-label="Calidad"]', quality);
        const dimensions = await page.evaluate(async quality => {
          const p = __mn.skillStudio.preview; p.pause();
          const { SKILLS } = await import('/src/data/weapons.js');
          p.seek(SKILLS.tromba.windup + SKILLS.tromba.delay + p.flipbook.duration(p.parameters) * (p.document?.version === 2 && p.flipbook.effect?.role === 'system-capture' ? 0.8 : 0.2));
          return { quality };
        }, quality);
        await page.waitForFunction(() => { const f = __mn.skillStudio.preview.flipbook; return f.state === 'ready' && f.frame >= 0 && f.sprite.visible; });
        Object.assign(dimensions, await page.evaluate(() => {
          const f = __mn.skillStudio.preview.flipbook;
          return { frame: f.frame, width: f.texture.image.width, height: f.texture.image.height };
        }));
        evidence.derivatives.push({ id: item.id, role: item.role, ...dimensions });
        await shot(`${item.id}-${quality}`);
      }
    }
  });
  for (const [width, height] of [[844, 390], [390, 844]]) await check(`compact_library_is_accessible_${width}x${height}`, async () => {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => __mn.skillStudio.root.dataset.layout.startsWith('compact'));
    await page.locator('[data-action="toggle-library"]').click();
    assert.equal(await page.locator('.ss-library').isVisible(), true);
    await page.locator('[data-filter="query"]').fill(pending.name);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement === __mn.skillStudio.libraryToggle), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === __mn.skillStudio.searchInput), true);
    for (const direction of ['Tab', 'Shift+Tab']) for (let i = 0; i < 6; i++) {
      await page.keyboard.press(direction);
      assert.equal(await page.evaluate(() => { const s = __mn.skillStudio;
        return document.activeElement === s.libraryToggle || s.root.querySelector('.ss-library').contains(document.activeElement);
      }), true);
    }
    await page.locator(`[data-effect-id="${pending.id}"]`).click();
    assert.equal(await page.locator('.ss-pending-overlay').isVisible(), true);
    await shot(`niagara-pending-${width}x${height}`);
    await page.locator('[data-action="toggle-library"]').click();
    await page.locator('[data-filter="query"]').fill('Tromba');
    await page.locator('[data-effect-id="tromba-current-v1"]').click();
    assert.equal(await page.locator('.ss-viewport').isVisible(), true);
    await page.evaluate(() => { const s = __mn.skillStudio; s.updateParameter('height', 1.2); s.endGesture(); });
    await page.locator('[data-action="toggle-library"]').click();
    await page.locator('.ss-head [data-action="close"]').click();
    assert.equal(await page.evaluate(() => __mn.skillStudio.libraryOpen), false);
    assert.equal(await page.locator('.ss-confirm').isVisible(), true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => __mn.skillStudio.confirmDialog.contains(document.activeElement)), true);
    }
    await page.locator('[data-action="stay"]').click();
    await page.evaluate(() => __mn.skillStudio.undo());
  });
  await check('english_catalog_and_zero_gameplay_writes', async () => {
    await page.locator('[data-action="language"]').click();
    assert.equal(await page.locator('#skill-studio-title').textContent(), 'Skill Studio');
    await shot('niagara-library-en-mobile');
    assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.writes, []); assert.deepEqual(evidence.gameplay, []);
    assert.equal(await page.evaluate(() => __mn.client.joined), false);
    await page.evaluate(() => __mn.skillStudio.close({ force: true }));
  });
} catch (error) {
  evidence.failure = { phase, message: error.message };
  if (page) evidence.failure.dom = await page.evaluate(() => ({
    fade: (() => { const node = document.querySelector('#fade'), css = node && getComputedStyle(node); return css && { display: css.display, opacity: css.opacity, visibility: css.visibility }; })(),
    mode: window.__mn?.st.mode, allowed: window.__mn?.skillEntry?.allowed,
    active: window.__mn?.skillStudio?.active, title: document.querySelector('#title')?.hidden,
    transportClosed: window.__mn?.transport?.closed, transportStats: window.__mn?.transport?.stats,
    netLost: document.querySelector('.net-lost')?.textContent,
  })).catch(() => null);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 10000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  await Promise.race([browser?.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
  await Promise.race([server?.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
  console.log(JSON.stringify({ checks: evidence.checks.length, failure: evidence.failure || null, output }));
  process.exit(process.exitCode || 0);
}

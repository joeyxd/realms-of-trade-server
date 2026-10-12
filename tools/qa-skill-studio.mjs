// Private Skill Studio acceptance. No skill publication, join, or gameplay mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
const production = !!process.env.MN_SKILL_QA_ORIGIN;
const out = resolve(process.env.MN_SKILL_QA_OUTPUT || `docs/delivery/st01a/${production ? 'public' : 'local'}`);
const evidence = { schema: 'skill-studio-browser/v1', at: new Date().toISOString(), version: GAME.version, production,
  simulatedAuth: !production, checks: [], screenshots: [], errors: [], remoteWrites: [], gameplayCommands: [] };
let game, browser, page, origin = process.env.MN_SKILL_QA_ORIGIN, phase = 'start';
const GM = '77777777-7777-4777-8777-777777777777';
const check = async (name, fn) => { phase = name; await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); };
const shot = async name => { await page.screenshot({ path: resolve(out, name + '.png') }); evidence.screenshots.push(name + '.png'); };
async function setup(context, account = GM) {
  await context.addInitScript(() => {
    if (location.protocol === 'http:' || location.protocol === 'https:')
      localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, quality: 'low', muted: true }));
  });
  if (!production) await context.addInitScript(accountId => {
    const session = { access_token: 'skill-studio-fixture', user: { id: accountId } };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange() {}, signInWithPassword: async () => ({ data: { session } }),
      signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
  }, account);
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
  });
}
const watch = page => {
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && /WebGL|shader|GL_INVALID/.test(msg.text())) evidence.errors.push(msg.text()); });
  page.on('request', req => { if (req.method() !== 'GET' && /\/api\/gm\//.test(req.url())) evidence.remoteWrites.push(new URL(req.url()).pathname); });
  page.on('websocket', ws => ws.on('framesent', event => {
    try { const message = JSON.parse(String(event.payload)); if (['join', 'input', 'cmd'].includes(message.t)) evidence.gameplayCommands.push(message.t); } catch {}
  }));
};
async function enter() {
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-skill-studio')?.disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  await page.locator('#btn-skill-studio').click();
  await page.waitForFunction(() => __mn.st.mode === 'skill-studio' && __mn.skillStudio?.active);
}
async function input(key, value) {
  await page.locator(`[data-parameter="${key}"]`).evaluate((el, value) => {
    el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function freeze(time = 1) { await page.evaluate(time => { __mn.skillStudio.preview.pause(); __mn.skillStudio.seek(time); }, time); }
try {
  await mkdir(out, { recursive: true });
  if (!production) {
    game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log: () => {},
      saveSecret: 'skill-studio-local', gmDraftsAllowMemory: true, gmAccountIds: [GM],
      publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
      resolvePlayer: async (_req, hello) => hello.token === 'skill-studio-fixture' ? GM : null });
    origin = `http://127.0.0.1:${await game.listen()}`;
  }
  evidence.runtime = await (await fetch(origin + '/status')).json();
  assert.equal(evidence.runtime.version, GAME.version);
  const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); await setup(context);
  page = await context.newPage(); watch(page);
  let suffix = '';
  if (production) {
    const session = JSON.parse(await readFile(resolve(process.env.MN_SKILL_QA_SESSION_FILE), 'utf8'));
    assert.match(session.tokenHash, /^[a-f0-9]{32,128}$/i); suffix = `&account-setup=1#gm_setup_token=${session.tokenHash}`;
  }
  await page.goto(origin + '/?q=high&tod=day' + suffix, { waitUntil: 'domcontentloaded' });
  if (production) {
    await page.waitForFunction(() => window.__mn?.skillEntry?.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 90000 });
    await page.locator('.gm-account-setup-card [data-action="cancel"]').click();
  }
  await check('authorized_private_stage_real_character_and_shared_effect', async () => {
    await enter(); await freeze();
    await page.waitForFunction(() => __mn.skillStudio.preview.metrics.drawCalls > 0);
    const result = await page.evaluate(() => ({ joined: __mn.client.joined, ext: __mn.skillStudio.preview.character.ext?.id,
      metrics: __mn.skillStudio.preview.metrics, visible: __mn.skillStudio.preview.fx.spouts.some(s => s.m.visible) }));
    assert.equal(result.joined, false); assert.ok(result.visible); assert.ok(result.metrics.particles > 0);
    assert.ok(result.ext, 'Preview must use the loaded native character');
    assert.ok(result.metrics.drawCalls > 0, 'The stage reports the renderer draw count');
    evidence.character = result.ext; await shot('tromba-original-es-desktop');
  });
  await check('bounded_parameters_undo_redo_and_equivalent_comparison', async () => {
    await input('height', 1.6); await input('density', 1.8); await input('foam', '#9bfbe4'); await freeze();
    const document = await page.evaluate(() => __mn.skillStudio.document);
    assert.equal(document.parameters.height, 1.6); assert.equal(document.parameters.density, 1.8);
    await page.locator('.skill-studio [data-action="undo"]').click(); assert.notDeepEqual(await page.evaluate(() => __mn.skillStudio.document), document);
    await page.locator('.skill-studio [data-action="redo"]').click(); assert.deepEqual(await page.evaluate(() => __mn.skillStudio.document), document);
    await freeze(); await shot('tromba-draft-es-desktop');
    const before = await page.evaluate(() => { const p = __mn.skillStudio.preview; return { time: p.time, camera: p.camera.position.toArray(), yaw: p.yaw }; });
    await page.locator('.ss-compare input').check();
    const after = await page.evaluate(() => { const p = __mn.skillStudio.preview; return { time: p.time, camera: p.camera.position.toArray(), yaw: p.yaw }; });
    assert.deepEqual(after, before); await page.locator('.ss-compare input').uncheck();
    await page.locator('.skill-studio [data-action="reset"]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'undo');
    await page.locator('.skill-studio [data-action="close"]').click();
    await page.locator('.skill-studio [data-action="discard"]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'stay');
    await page.keyboard.press('Escape');
  });
  await check('pause_seek_speed_and_mobile_particle_cap', async () => {
    await freeze(); const time = await page.evaluate(() => __mn.skillStudio.preview.time);
    await page.waitForTimeout(250); assert.equal(await page.evaluate(() => __mn.skillStudio.preview.time), time);
    await page.locator('.ss-speed select').selectOption('2'); assert.equal(await page.evaluate(() => __mn.skillStudio.preview.speed), 2);
    await page.evaluate(() => { const p = __mn.skillStudio.preview; p.setQuality('mobile'); p.seek(1); });
    assert.ok(await page.evaluate(() => __mn.skillStudio.preview.metrics.particles <= 128));
  });
  await check('invalid_import_preserves_draft_export_and_local_save_reopen', async () => {
    const before = await page.evaluate(() => __mn.skillStudio.document);
    await page.locator('.ss-import input').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"marea.skill-presentation","script":"alert(1)"}') });
    await page.waitForFunction(() => __mn.skillStudio.statusNode.dataset.kind === 'error');
    assert.deepEqual(await page.evaluate(() => __mn.skillStudio.document), before);
    const download = page.waitForEvent('download'); await page.locator('.skill-studio [data-action="export"]').click();
    const file = await download; assert.deepEqual(JSON.parse(await readFile(await file.path(), 'utf8')), before);
    await page.locator('.skill-studio [data-action="save"]').click(); await page.locator('.skill-studio [data-action="close"]').click();
    await page.waitForFunction(() => __mn.st.mode === 'title'); await enter();
    await page.locator('.skill-studio [data-action="load"]').click(); assert.deepEqual(await page.evaluate(() => __mn.skillStudio.document), before);
    await page.locator('.skill-studio [data-action="language"]').click(); await freeze(); await shot('tromba-draft-en-desktop');
  });
  await check('camera_orbit_and_closing_restore_world_renderer', async () => {
    const viewport = page.locator('.ss-viewport'), box = await viewport.boundingBox();
    const yaw = await page.evaluate(() => __mn.skillStudio.preview.yaw);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 10); await page.mouse.up();
    assert.notEqual(await page.evaluate(() => __mn.skillStudio.preview.yaw), yaw);
    await page.locator('.skill-studio [data-action="close"]').click(); await page.waitForFunction(() => __mn.st.mode === 'title');
    await page.locator('#btn-gm-editor').click(); await page.waitForFunction(() => __mn.gmEditor?.active);
    await page.locator('.gm-editor [data-action="close"]').click(); await page.waitForFunction(() => __mn.st.mode === 'title');
  });
  await check('mobile_landscape_and_portrait_readable_stage_and_controls', async () => {
    // Release the desktop WebGL scene before booting another viewport on the same GPU.
    const desktop = page, storageState = await context.storageState();
    await desktop.goto('about:blank');
    for (const [width, height] of [[844, 390], [390, 844]]) {
      const mobile = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', storageState });
      await setup(mobile); page = await mobile.newPage(); watch(page);
      await page.goto(origin + '/?q=low&tod=day'); await enter();
      if (await page.evaluate(() => __mn.skillStudio.lang !== 'es')) await page.locator('.skill-studio [data-action="language"]').click();
      await freeze(); const box = await page.locator('.ss-viewport').boundingBox(); assert.ok(box.width > 100 && box.height > 100);
      assert.ok(await page.locator('.ss-playback').evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'Playback controls must not be clipped');
      assert.ok(await page.locator('.skill-studio').evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'Workshop must fit the logical viewport');
      await shot(`tromba-es-${width}x${height}`);
      await page.locator('.skill-studio [data-action="language"]').click(); await shot(`tromba-en-${width}x${height}`);
      await page.locator('.skill-studio [data-action="close"]').click(); await mobile.close(); page = desktop;
    }
    if (!production) await page.goto(origin + '/?q=high&tod=day', { waitUntil: 'domcontentloaded' });
  });
  if (!production) await check('recovery_scope_storage_failure_and_permission_revocation', async () => {
    await enter(); await input('height', 1.3);
    const before = await page.evaluate(() => __mn.skillStudio.document);
    await page.locator('.skill-studio [data-action="close"]').click(); await page.locator('.skill-studio [data-action="keep-recovery"]').click();
    await page.waitForFunction(() => __mn.st.mode === 'title'); await enter();
    await page.locator('.skill-studio [data-action="recover"]').click(); assert.deepEqual(await page.evaluate(() => __mn.skillStudio.document), before);
    assert.equal(await page.evaluate(() => {
      const s = __mn.skillStudio, raw = localStorage.getItem(s.recoveryKey), envelope = JSON.parse(raw);
      envelope.scope = 'other-server:other-account'; localStorage.setItem(s.recoveryKey, JSON.stringify(envelope));
      const rejected = s.readStored(s.recoveryKey, true) === null; localStorage.setItem(s.recoveryKey, raw); return rejected;
    }), true);
    await page.route('**/api/gm/session', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }));
    await page.evaluate(() => __mn.skillEntry.check()); await page.waitForFunction(() => __mn.st.mode === 'title' && !__mn.skillStudio.active);
    await page.unroute('**/api/gm/session'); await page.evaluate(() => __mn.skillEntry.check());
    await page.evaluate(() => { window.__qaGetItem = Storage.prototype.getItem; Storage.prototype.getItem = () => { throw new Error('Storage denied fixture'); }; });
    await enter(); assert.equal(await page.evaluate(() => __mn.skillStudio.active), true);
    await page.evaluate(() => { Storage.prototype.getItem = window.__qaGetItem; delete window.__qaGetItem; });
    await page.locator('.skill-studio [data-action="close"]').click(); await enter();
    await page.locator('.skill-studio [data-action="recover"]').click(); assert.deepEqual(await page.evaluate(() => __mn.skillStudio.document), before);
    assert.equal(await page.evaluate(() => {
      const previous = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Quota fixture'); };
      try { return __mn.skillStudio.saveDraft(); } finally { Storage.prototype.setItem = previous; }
    }), false);
    assert.equal(await page.evaluate(() => __mn.skillStudio.active && __mn.skillStudio.dirty), true);
    await page.locator('.skill-studio [data-action="save"]').click(); await page.locator('.skill-studio [data-action="close"]').click();
  });
  if (!production) await check('authenticated_non_gm_cannot_open_workshop', async () => {
    const denied = await browser.newContext({ viewport: { width: 1280, height: 720 } }); await setup(denied, '66666666-6666-4666-8666-666666666666');
    const p = await denied.newPage(); await p.goto(origin + '/?q=low&tod=day');
    await p.waitForFunction(() => window.__mn?.skillEntry?.ready); assert.equal(await p.locator('#btn-skill-studio').isDisabled(), true);
    assert.equal(await p.evaluate(() => __mn.skillStudio), null); await denied.close();
  });
  await check('no_remote_draft_writes_gameplay_commands_or_render_errors', async () => {
    assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.remoteWrites, []); assert.deepEqual(evidence.gameplayCommands, []);
  }); phase = 'complete';
} catch (error) {
  evidence.failure = { phase, error: error.message }; process.exitCode = 1;
  if (page) try { await shot('failure'); } catch {}
} finally {
  await browser?.close(); await game?.close(); evidence.phase = phase;
  await writeFile(resolve(out, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
}

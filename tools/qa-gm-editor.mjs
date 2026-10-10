// Real browser / loopback host acceptance. Account tokens below are isolated fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';

const root = resolve('.');
const out = resolve(process.env.MN_GM_QA_OUTPUT || 'docs/delivery/gm01');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const GM = '77777777-7777-4777-8777-777777777777';
const PLAYER = '88888888-8888-4888-8888-888888888888';
const game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: false, log() {}, saveSecret: 'gm-browser-fixture-only',
  gmAccountIds: [GM], publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_gm_fixture' },
  resolvePlayer: async (_req, hello) => hello.token === 'gm-fixture' ? GM : hello.token === 'player-fixture' ? PLAYER : null,
});
const port = await game.listen();
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { schema: 'gm01-browser/v1', version: GAME.version, at: new Date().toISOString(), simulatedAuth: true,
  production: false, checks: [], screenshots: [], errors: [] };
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
async function shot(page, name) { await page.screenshot({ path: resolve(out, name) }); evidence.screenshots.push(name); }
async function setup(context, { accountId = GM, token = 'gm-fixture' } = {}) {
  await context.addInitScript(({ accountId, token }) => {
    let listener;
    const session = { access_token: token, user: { id: accountId, email: 'gm@example.invalid' } };
    window.__gmFixtureSignOut = () => listener?.('SIGNED_OUT', null);
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (cb) => { listener = cb; },
      signInWithPassword: async () => ({ data: { session }, error: null }),
      verifyOtp: async ({ token_hash, type }) => { window.__gmFixtureLinkChecks = (window.__gmFixtureLinkChecks || 0) + 1; return { data: { session }, error: token_hash === 'a'.repeat(56) && type === 'recovery' ? null : new Error('fixture-link') }; },
      updateUser: async ({ password }) => { window.__gmFixturePasswordUpdates = (window.__gmFixturePasswordUpdates || 0) + 1; return { data: { user: session.user }, error: password.length >= 12 ? null : new Error('fixture-password') }; },
      signUp: async () => ({ data: { session }, error: null }), signOut: async () => ({ error: null }),
    } }) };
  }, { accountId, token });
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : (process.env.MN_GSAP || '.scratch/gsap-local/package'), match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}
async function ready(page, setupPassword = false) {
  await page.goto(`${origin}/?q=low&tod=day${setupPassword ? '&account-setup=1#gm_setup_token=' + 'a'.repeat(56) : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-gm-editor').disabled, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await setup(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.stack || error.message));
  const modelRequests = [];
  page.on('request', (request) => { if (/\/assets\/editor\/.*\.glb/.test(request.url())) modelRequests.push(request.url()); });
  await ready(page, true);
  await check('account_setup_consumes_link_removes_token_checks_confirmation_and_clears_fields', async () => {
    await page.waitForSelector('.gm-account-setup-overlay:not([hidden])');
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.equal(await page.evaluate(() => window.__gmFixtureLinkChecks), 1);
    await shot(page, 'account-setup.png');
    await page.locator('[name="new-password"]').fill('fixture-password-12');
    await page.locator('[name="confirm-password"]').fill('different-fixture-12');
    await page.locator('.gm-account-setup-card [type="submit"]').click();
    assert.equal(await page.evaluate(() => window.__gmFixturePasswordUpdates || 0), 0);
    await page.locator('[name="confirm-password"]').fill('fixture-password-12');
    await page.locator('.gm-account-setup-card [type="submit"]').click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('account-setup'));
    assert.equal(await page.evaluate(() => window.__gmFixturePasswordUpdates), 1);
    assert.equal(await page.locator('[name="new-password"]').inputValue(), '');
    assert.equal(await page.locator('[name="confirm-password"]').inputValue(), '');
  });
  await check('editor_model_downloads_absent_during_game_boot', async () => assert.equal(modelRequests.length, 0));
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => window.__mn.st.mode === 'editor' && window.__mn.gmEditor.active);
  await check('authorized_entry_has_no_gameplay_body_or_commands', async () => {
    assert.equal(game.game.status().players, 0);
    assert.equal(await page.evaluate(() => window.__mn.client.joined), false);
    assert.equal(await page.evaluate(() => window.__mn.input.enabled), false);
  });
  await shot(page, 'editor-es.png');
  const baseMap = await page.evaluate(() => JSON.stringify({ props: __mn.map.props, colliders: __mn.map.colliders }));
  await check('free_camera_moves_and_blur_releases_keys', async () => {
    const before = await page.evaluate(() => __mn.world.camera.position.toArray());
    await page.locator('#game').focus(); await page.keyboard.down('KeyW');
    await page.waitForFunction((before) => __mn.world.camera.position.distanceTo({ x: before[0], y: before[1], z: before[2] }) > 1, before);
    await page.evaluate(() => dispatchEvent(new Event('blur'))); await page.keyboard.up('KeyW');
    assert.equal(await page.evaluate(() => __mn.gmEditor.cameraController.keys.size), 0);
    await page.evaluate((before) => { __mn.world.camera.position.fromArray(before); __mn.world.camera.updateMatrixWorld(); }, before);
  });
  await page.locator('[data-editor-asset="model:gm-rock-1k"]').click();
  await page.waitForFunction(() => !!__mn.gmEditor.ghost);
  await page.mouse.move(700, 420); await page.mouse.click(700, 420);
  await page.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 1);
  await page.keyboard.press('Escape');
  await check('terrain_placement_fetches_only_selected_pilot', async () => {
    assert.equal(modelRequests.length, 1);
    assert.match(modelRequests[0], /gm-rock-1k/);
    assert.equal(await page.evaluate(() => __mn.gmEditor.ghost === null), true);
  });
  const object = await page.evaluate(() => __mn.gmEditor.history.current().objects[0]);
  const x = object.transform.position.x + 3;
  for (const [field, value] of [['x', x], ['ry', 45], ['scale', 1.4]]) {
    await page.locator(`[data-field="${field}"]`).fill(String(value)); await page.locator(`[data-field="${field}"]`).press('Tab');
  }
  await check('numeric_transform_and_undo_redo_round_trip', async () => {
    const expected = await page.evaluate(() => __mn.gmEditor.history.current());
    assert.ok(Math.abs(expected.objects[0].transform.position.x - x) < 1e-5);
    assert.equal(expected.objects[0].transform.scale, 1.4);
    assert.equal(expected.objects[0].transform.rotation.y, Math.PI / 4);
    for (let i = 0; i < 3; i++) await page.locator('[data-action="undo"]').click();
    assert.equal(await page.evaluate(() => __mn.gmEditor.history.current().objects[0].transform.scale), 1);
    for (let i = 0; i < 3; i++) await page.locator('[data-action="redo"]').click();
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), expected);
  });
  await page.locator('[data-action="duplicate"]').click();
  assert.equal(await page.evaluate(() => __mn.gmEditor.history.current().objects.length), 2);
  await page.locator('[data-action="delete"]').click();
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(() => !__mn.gmEditor.dirty && __mn.gmEditor.revision > 0);
  const saved = await page.evaluate(() => __mn.gmEditor.history.current());
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadEvent;
  const envelope = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(envelope.document, saved);
  await check('incompatible_import_preserves_stored_draft', async () => {
    const before = await page.evaluate(() => __mn.gmEditor.store.load());
    const bad = structuredClone(envelope); bad.document.base.seed++;
    await page.locator('[data-role="import"]').setInputFiles({ name: 'wrong-map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForFunction(() => __mn.gmEditor.statusNode.textContent.includes('Falló'));
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.store.load()), before);
  });
  await page.locator('[data-role="language"]').click();
  await page.waitForFunction(() => __mn.gmEditor.lang === 'en');
  await page.evaluate(() => {
    __mn.gmEditor.select(__mn.gmEditor.history.current().objects[0].id);
    const p = __mn.gmEditor.records.get(__mn.gmEditor.selectedId).root.position;
    __mn.world.camera.position.set(p.x + 12, p.y + 8, p.z + 12); __mn.gmEditor._focusSelection();
  });
  await shot(page, 'editor-en-placed.png');
  await page.locator('[data-action="close"]').click();
  await page.waitForFunction(() => __mn.st.mode === 'title');
  await check('close_removes_every_draft_instance_and_keeps_base_map', async () => {
    assert.equal(await page.evaluate(() => __mn.world.scene.children.filter((o) => o.userData.gmDecorationId).length), 0);
    assert.equal(await page.evaluate(() => JSON.stringify({ props: __mn.map.props, colliders: __mn.map.colliders })), baseMap);
  });
  await page.locator('#btn-gm-editor').click();
  await page.waitForFunction(() => __mn.st.mode === 'editor');
  await check('reopen_keeps_saved_transforms_and_instances', async () => {
    assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), saved);
    assert.equal(await page.evaluate(() => __mn.gmEditor.records.size), 2);
  });
  const second = await context.newPage(); await ready(second); await second.locator('#btn-gm-editor').click();
  await second.waitForFunction(() => __mn.st.mode === 'editor');
  const staleRevision = await second.evaluate(() => __mn.gmEditor.revision);
  await page.evaluate(() => { __mn.gmEditor.select(__mn.gmEditor.history.current().objects[0].id); __mn.gmEditor._duplicate(); });
  await page.locator('[data-action="save"]').click(); await page.waitForFunction(() => !__mn.gmEditor.dirty);
  await second.evaluate(() => { __mn.gmEditor.select(__mn.gmEditor.history.current().objects[0].id); __mn.gmEditor._duplicate(); });
  await second.locator('[data-action="save"]').click();
  await second.waitForFunction(() => __mn.gmEditor.statusNode.textContent.includes('revision_conflict'));
  await check('two_real_tabs_report_conflict_without_overwriting_saved_draft', async () => {
    const state = await second.evaluate(async () => ({ dirty: __mn.gmEditor.dirty, revision: __mn.gmEditor.revision, stored: await __mn.gmEditor.store.load() }));
    assert.equal(state.dirty, true); assert.equal(state.revision, staleRevision); assert.ok(state.stored.revision > staleRevision);
    assert.equal(state.stored.document.objects.length, 3);
  });
  await shot(second, 'draft-conflict.png');
  const conflicted = await second.evaluate(() => __mn.gmEditor.history.current());
  await second.evaluate(() => window.__gmFixtureSignOut());
  await second.waitForFunction(() => __mn.st.mode === 'title');
  await ready(second); await second.locator('#btn-gm-editor').click();
  await second.waitForFunction(() => __mn.st.mode === 'editor');
  await check('forced_close_conflict_recovers_after_full_page_reload_without_overwrite', async () => {
    assert.deepEqual(await second.evaluate(() => __mn.gmEditor.history.current()), conflicted);
    assert.equal(await second.evaluate(() => __mn.gmEditor.revision), staleRevision);
    assert.equal(await second.evaluate(() => __mn.gmEditor.dirty), true);
    assert.notDeepEqual(await second.evaluate(async () => (await __mn.gmEditor.store.load()).document), conflicted);
  });
  await page.evaluate(() => window.__gmFixtureSignOut());
  await page.waitForFunction(() => __mn.st.mode === 'title');
  await check('auth_revocation_closes_editor_and_removes_instances', async () => {
    assert.equal(await page.evaluate(() => __mn.gmEditor.active), false);
    assert.equal(await page.evaluate(() => __mn.world.scene.children.filter((o) => o.userData.gmDecorationId).length), 0);
    assert.equal(game.game.status().players, 0);
  });
  await second.close();
  assert.deepEqual(evidence.errors, []);
  // A normal gameplay join still works after the editor lifecycle.
  await page.locator('#btn-play').click({ force: true }); // Existing title pulse never becomes geometrically stable.
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await check('normal_gameplay_still_joins_after_editor', async () => assert.equal(game.game.status().players, 1));
  await context.close();
} catch (error) { evidence.errors.push(error.stack || String(error)); process.exitCode = 1; }
finally {
  await writeFile(resolve(out, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
  await game.close();
}

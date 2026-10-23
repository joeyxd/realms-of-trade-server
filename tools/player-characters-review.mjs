// Isolated browser acceptance: real guest saves, normal lobby inputs, no live accounts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { GAME } from '../src/data/meta.js';
import { createMemoryStore } from '../server/store.mjs';

const { chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const accountMode = process.argv.includes('--account');
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const out = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || `.scratch/player-characters-review${accountMode ? '-account' : ''}`);
await fs.mkdir(out, { recursive: true });
const old = newProfile(); old.gold = 77; old.pirateId = accountMode ? `account:${owner}` : 'character-review:legacy';
const store = createMemoryStore();
if (accountMode) await store.initializeProfile(owner, old);
const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0,
  store, initializeAccounts: accountMode,
  ...(accountMode ? { publicAuth: { enabled: true, url: 'https://character-review.invalid', publicKey: 'sb_publishable_fixture' },
    resolvePlayer: async (_req, msg) => msg.token === 'isolated-review-token' ? owner : null } : {}),
  saveSecret: 'isolated-character-review', log() {} });
const port = await server.listen(), base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], receipt = { mode: accountMode ? 'account' : 'guest', legacyPreserved: false, swordGold: null, pistolGold: null, restoredGold: null, screenshots: [] };
const blob = hmacSaves('isolated-character-review').store(old);
const legacyKey = `${GAME.saveKey}.save.online.127.0.0.1:${port}`;
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  // Avoid an unavailable font CDN blocking the page's module bootstrap.
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
  // Use the exact pinned client libraries locally when their CDNs are inaccessible to the harness.
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, async route => {
    const url = new URL(route.request().url()), match = /\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/.exec(url.pathname);
    const root = match[1].startsWith('three') ? path.resolve('node_modules/three') : process.env.MN_GSAP;
    if (!root) return route.continue();
    try { await route.fulfill({ body: await fs.readFile(path.join(root, match[2])), contentType: 'text/javascript' }); }
    catch { await route.continue(); }
  });
  page = await context.newPage(); page.on('pageerror', err => errors.push(err.message));
  if (accountMode) await page.addInitScript(({ owner }) => {
    // Only the external Auth provider is a fixture; roster HTTP, WSS and saves are real.
    const session = { access_token: 'isolated-review-token', user: { id: owner, email: 'fixture@example.invalid' } };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null }), onAuthStateChange() {},
    } }) };
  }, { owner });
  await page.addInitScript(({ legacyKey, blob }) => { if (!localStorage.getItem('character-review.seeded')) {
    localStorage.setItem(legacyKey, blob); localStorage.setItem('character-review.seeded', '1');
  } }, { legacyKey, blob });
  const boot = async () => {
    console.log('Opening character lobby');
    await page.goto(`${base}/?q=low&debug`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
    await page.waitForFunction(() => window.__mn.st.mode === 'title' && document.querySelector('#fade').style.display === 'none');
    // Freeze only WebGL rendering during form checks; real HTTP, WSS and server simulation continue.
    await page.evaluate(() => { window.__mn.loop.running = false; });
    await page.locator('#btn-play').click({ force: true });
    await page.locator('.player-characters-overlay:not([hidden])').waitFor({ timeout: 25000 });
    assert.ok((await page.locator('.player-characters-intro').innerText()).includes(accountMode ? 'Guardados en tu cuenta' : 'solo en este navegador'));
    console.log('Character lobby ready');
  };
  const play = async () => {
    await page.getByRole('button', { name: 'Jugar con este personaje', exact: true }).click();
    await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 25000 });
    await page.waitForFunction(() => window.__mn.client.profile, null, { timeout: 10000 });
    assert.equal(await page.locator('.player-characters-overlay').isVisible(), false);
    if (accountMode) assert.deepEqual([...server.game.profiles.clients.values()].map(session => session.ownerKey), [owner]);
    return page.evaluate(() => ({ gold: window.__mn.client.profile.gold, weapon: window.__mn.client.profile.eq.weapon.b, skin: window.__mn.settings.skin }));
  };
  await boot();
  await page.getByRole('button', { name: 'Conservar partida guardada', exact: true }).click();
  await page.locator('.player-characters-name').fill('Espadachin');
  await page.locator('.player-characters-look[data-skin="0"]').click();
  await page.locator('.player-characters-confirm input').check();
  await page.getByRole('button', { name: 'Crear y continuar', exact: true }).click();
  await page.locator('.player-character-card').waitFor();
  const sword = await play(); receipt.swordGold = sword.gold; assert.equal(sword.gold, 77);
  await boot();
  await page.getByRole('button', { name: 'Crear personaje', exact: true }).click();
  await page.locator('.player-characters-name').fill('Bucanero');
  await page.locator('.player-characters-look[data-skin="2"]').click();
  await page.getByRole('button', { name: 'Crear y continuar', exact: true }).click();
  await page.locator('.player-character-card').filter({ hasText: 'Bucanero' }).waitFor();
  await page.screenshot({ path: path.join(out, 'desktop-slots.png') }); receipt.screenshots.push('desktop-slots.png');
  const pistol = await play(); receipt.pistolGold = pistol.gold;
  assert.equal(pistol.gold, 0); assert.equal(pistol.skin, 2); assert.notEqual(pistol.weapon, sword.weapon);
  await boot();
  await page.locator('.player-character-card').filter({ hasText: 'Espadachin' }).click();
  const restored = await play(); receipt.restoredGold = restored.gold;
  assert.equal(restored.gold, 77); assert.equal(restored.weapon, sword.weapon);
  receipt.legacyPreserved = await page.evaluate(key => localStorage.getItem(key), legacyKey) === blob;
  assert.ok(receipt.legacyPreserved);
  await boot();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'mobile-slots.png') }); receipt.screenshots.push('mobile-slots.png');
  await page.getByRole('button', { name: 'Crear personaje', exact: true }).click();
  await page.screenshot({ path: path.join(out, 'mobile-create.png') }); receipt.screenshots.push('mobile-create.png');
  receipt.errors = errors; assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ errors, body: await page?.locator('body').innerText().catch(() => '') }));
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); await server.close(); }

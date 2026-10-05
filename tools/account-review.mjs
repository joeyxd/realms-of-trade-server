// Local P2 acceptance: real browser SDK + game WebSocket, with an isolated fake Auth HTTP service.
// No Supabase project, credentials, email delivery, or external Auth requests are used.
// MN_PLAYWRIGHT, MN_BROWSER, MN_THREE, MN_GSAP select installed browser/libraries; OUT selects evidence.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createGameServer } from '../server/index.mjs';
import { createAccountResolver } from '../server/auth.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { GAME } from '../src/data/meta.js';
import { legacyKey } from '../server/legacy.mjs';

const { chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const out = path.resolve(process.env.OUT || 'shots/review/m5-accounts');
fs.mkdirSync(out, { recursive: true });
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email = 'pirate@example.test';
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: A, exp })).toString('base64url'), 'test-signature'].join('.');
const user = { id: A, email, aud: 'authenticated', role: 'authenticated', is_anonymous: false };
let rejectVerification = false;
const authHttp = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://x');
  const json = (status, data) => res.writeHead(status).end(JSON.stringify(data));
  if (url.pathname === '/auth/v1/user') {
    if (rejectVerification || req.headers.authorization !== `Bearer ${token}`) return json(401, { msg: 'invalid token' });
    return json(200, user);
  }
  let body = ''; for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : {};
  if (url.pathname === '/auth/v1/token') {
    if (data.password !== 'local-review-password') return json(400, { error_code: 'invalid_credentials', msg: 'PRIVATE PROVIDER DETAIL' });
    return json(200, { access_token: token, refresh_token: 'local-refresh-token', expires_in: 3600, expires_at: exp, token_type: 'bearer', user });
  }
  if (url.pathname === '/auth/v1/signup') return json(200, { ...user, identities: [] });
  if (url.pathname === '/auth/v1/logout') return json(200, {});
  json(404, {});
});
await new Promise((r) => authHttp.listen(0, '127.0.0.1', r));
const authUrl = `http://127.0.0.1:${authHttp.address().port}`;
const publicKey = 'sb_publishable_local_review';
const authClient = createClient(authUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const store = createMemoryStore();
const gs = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, log: () => {}, saveSecret: 'local-review-secret', store,
  resolvePlayer: createAccountResolver(authClient), initializeAccounts: true, publicAuth: { enabled: true, url: authUrl, publicKey } });
const port = await gs.listen(), gameUrl = `http://127.0.0.1:${port}/?q=low`;
const browser = await chromium.launch({ executablePath: process.env.MN_BROWSER, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const contexts = [], results = [];
const old = { ...newProfile(), gold: 57, pirateId: 'review-world:p1' };
const blob = hmacSaves('local-review-secret').store(old);
async function pageFor(width, height, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  contexts.push(ctx);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => { if (r.url().includes('/auth/config')) console.log('Auth config request failed:', r.failure()?.errorText); });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
    const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const dir = m[1].startsWith('three') ? process.env.MN_THREE : process.env.MN_GSAP;
    if (!dir) return route.continue();
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(dir, m[2])) });
  });
  await page.addInitScript(({ slot, blob }) => { if (!localStorage.getItem(slot)) localStorage.setItem(slot, blob); }, { slot: GAME.saveKey + '.save.online.127.0.0.1:' + port, blob });
  await page.goto(gameUrl);
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
  // Keep software-rendered frames from starving unrelated network callbacks during this UI review.
  await page.evaluate(() => { window.__mn.loop.running = false; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.title-hint')).opacity === '1');
  try { await page.waitForFunction(() => document.querySelector('.account-status')?.textContent.startsWith('Invitado')); }
  catch (error) {
    console.log(JSON.stringify({ startup: await page.locator('.account-status').textContent(), pageErrors: errors,
      sdk: await page.evaluate(() => typeof globalThis.supabase?.createClient) }));
    await page.screenshot({ path: path.join(out, 'startup-failed.png') }); throw error;
  }
  return { page, errors };
}
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });
try {
  if (process.env.REVIEW_MODE !== 'mobile') {
  const { page, errors } = await pageFor(1280, 720);
  console.log('Title layout:', JSON.stringify(await page.evaluate(() => ['#stage', '#title', '.title-card', '.title-actions', '.account-open'].map((s) => {
    const e = document.querySelector(s), c = getComputedStyle(e), r = e.getBoundingClientRect();
    return { selector: s, x: r.x, y: r.y, w: r.width, h: r.height, display: c.display, opacity: c.opacity, transform: c.transform };
  }))));
  await shot(page, 'desktop-title');
  await page.locator('.account-open').click();
  await shot(page, 'desktop-login');
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=password]').fill('wrong');
  await page.locator('[data-action=login]').click();
  await page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('Revisa el correo'));
  assert.equal(await page.locator('[name=password]').inputValue(), '');
  assert.ok(!(await page.locator('.account-feedback').textContent()).includes('PRIVATE'));
  await shot(page, 'desktop-invalid-password');
  await page.locator('[name=password]').fill('local-review-password');
  await page.locator('[data-action=signup]').click();
  await page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('confirmar'));
  await shot(page, 'desktop-confirmation');
  await page.locator('[name=password]').fill('local-review-password');
  await page.locator('[data-action=login]').click();
  await page.waitForFunction(() => !document.querySelector('.account-signed').hidden);
  await page.locator('.account-import-toggle').check();
  await shot(page, 'desktop-import');
  await page.keyboard.press('Escape');
  rejectVerification = true;
  await page.locator('#btn-play').click({ force: true }); // JUGAR deliberately pulses in an infinite scale tween.
  // The real game transport still needs its pump while HELLO is pending.
  await page.evaluate(() => window.__mn.loop.start());
  await page.waitForFunction(() => document.querySelector('.title-msg')?.textContent.includes('sesión no es válida'));
  assert.equal(await store.loadProfile(A), null);
  await page.evaluate(() => { window.__mn.loop.running = false; });
  await shot(page, 'desktop-auth-rejected');
  rejectVerification = false;
  await page.locator('#btn-play').click({ force: true });
  await page.evaluate(() => window.__mn.loop.start());
  await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__mn.client.profile.gold), 57);
  assert.equal(await page.evaluate(() => window.__mn.client.profile.pirateId), `account:${A}`);
  await page.waitForFunction(() => document.querySelector('#title').hidden);
  await page.evaluate(() => { window.__mn.loop.running = false; });
  await shot(page, 'desktop-account-joined');
  await page.reload();
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('.account-status')?.textContent === 'pirate@example.test');
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__mn.client.profile.gold), 57);
  results.push({ case: 'desktop Auth SDK/login/signup/rejection/import/reload', pass: true, pageErrors: errors });
  assert.deepEqual(errors, []);
  await page.close();
  } else await store.initializeProfile(A, { ...old, pirateId: `account:${A}` }, legacyKey(old));

  const mobile = await pageFor(844, 390, true);
  await shot(mobile.page, 'mobile-title');
  await mobile.page.locator('.account-open').click();
  await shot(mobile.page, 'mobile-login');
  const bounds = await mobile.page.locator('.account-dialog').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 844 && bounds.y + bounds.height <= 390);
  await mobile.page.locator('[name=email]').fill(email);
  await mobile.page.locator('[name=password]').fill('local-review-password');
  await mobile.page.locator('[data-action=login]').click();
  await mobile.page.waitForFunction(() => !document.querySelector('.account-signed').hidden);
  await shot(mobile.page, 'mobile-signed-in');
  await mobile.page.locator('.account-logout').click();
  await mobile.page.waitForFunction(() => !document.querySelector('.account-form').hidden);
  await shot(mobile.page, 'mobile-signed-out');
  await mobile.page.locator('.account-guest').click();
  await mobile.page.evaluate(() => window.__mn.loop.start());
  await mobile.page.locator('#btn-play').click({ force: true });
  await mobile.page.waitForFunction(() => document.querySelector('.title-msg')?.textContent.includes('ya fue importada'));
  assert.equal(await mobile.page.evaluate(() => window.__mn.st.mode), 'title');
  await mobile.page.evaluate(() => { window.__mn.loop.running = false; });
  await shot(mobile.page, 'mobile-retired-guest');
  const errorBounds = await mobile.page.evaluate(() => {
    const b = document.querySelector('#btn-play').getBoundingClientRect(), m = document.querySelector('.title-msg').getBoundingClientRect();
    return { buttonBottom: b.bottom, messageTop: m.top, messageBottom: m.bottom,
      elements: ['.title-card', '.title-actions', '.title-net', '#btn-play', '.title-msg', '.title-who', '.title-row', '.title-hint'].map((selector) => {
        const e = document.querySelector(selector), r = e.getBoundingClientRect(), c = getComputedStyle(e);
        return { selector, top: r.top, bottom: r.bottom, transform: c.transform, gap: c.gap, marginTop: c.marginTop };
      }) };
  });
  console.log('Mobile error layout:', JSON.stringify(errorBounds));
  assert.ok(errorBounds.messageTop >= errorBounds.buttonBottom, 'the error must not overlap JUGAR');
  results.push({ case: 'mobile layout/login/local sign-out', pass: true, bounds, pageErrors: mobile.errors });
  assert.deepEqual(mobile.errors, []);
  fs.writeFileSync(path.join(out, process.env.REVIEW_MODE === 'mobile' ? 'mobile-results.json' : 'results.json'), JSON.stringify({ localFakeAuth: true, renderer: 'Chrome SwiftShader', results }, null, 2));
  console.log(JSON.stringify({ localFakeAuth: true, results }, null, 2));
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close(); await gs.close();
  await new Promise((r) => authHttp.close(r));
}

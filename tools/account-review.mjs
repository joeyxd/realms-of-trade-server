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
const authCalls = { signups: 0, signins: 0, resends: 0 };
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
    authCalls.signins++;
    if (data.password !== 'local-review-password') return json(400, { error_code: 'invalid_credentials', msg: 'PRIVATE PROVIDER DETAIL' });
    return json(200, { access_token: token, refresh_token: 'local-refresh-token', expires_in: 3600, expires_at: exp, token_type: 'bearer', user });
  }
  if (url.pathname === '/auth/v1/signup') { authCalls.signups++; return json(200, { ...user, identities: [] }); }
  if (url.pathname === '/auth/v1/resend') { authCalls.resends++; return json(200, {}); }
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

    const beforeInvalid = authCalls.signins;
    await page.locator('.account-submit').click();
    assert.equal(authCalls.signins, beforeInvalid, 'empty fields must not reach Auth');
    await page.locator('[name=email]').fill('not-an-email');
    await page.locator('[name=password]').fill('unused-invalid-input');
    await page.locator('.account-submit').click();
    assert.equal(authCalls.signins, beforeInvalid, 'invalid email must not reach Auth');
    await page.locator('[name=email]').fill('');
    await page.locator('[name=password]').fill('');
    await page.locator('.account-close').click();
    await page.locator('.account-open').click();

    const firstTabbable = page.locator('.account-dialog button:not([disabled]), .account-dialog input:not([disabled]), .account-dialog [tabindex="0"]').first();
    const visibleTabCount = await page.locator('.account-dialog button:not([disabled]), .account-dialog input:not([disabled])').evaluateAll((els) => els.filter((e) => e.getClientRects().length).length);
    assert.ok(visibleTabCount >= 2, 'modal exposes keyboard controls');
    await firstTabbable.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.account-dialog button:not([disabled]), .account-dialog input:not([disabled])')].filter((e) => e.getClientRects().length).at(-1) === document.activeElement), true, 'Shift+Tab wraps to the final control');
    await page.keyboard.press('Tab');
    assert.equal(await firstTabbable.evaluate((e) => e === document.activeElement), true, 'Tab wraps to the first control');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.account-overlay').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__mn.st.mode), 'title', 'Escape closes the modal without a game hotkey');
    await page.locator('.account-open').click();
    await page.locator('[name=password]').fill('temporary-review-value');
    await page.locator('.account-password-toggle').click();
    assert.equal(await page.locator('[name=password]').getAttribute('type'), 'text');
    assert.equal(await page.locator('.account-password-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('.account-close').click();
    assert.equal(await page.locator('[name=password]').inputValue(), '');
    assert.equal(await page.locator('[name=password]').getAttribute('type'), 'password');
    await page.locator('.account-open').click();

    await page.locator('[name=email]').fill(email);
    assert.equal(await page.locator('[name=password]').getAttribute('autocomplete'), 'current-password');
    await page.locator('[name=password]').fill('wrong');
    await page.locator('[name=password]').press('Enter');
    await page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('Revisa el correo'));
    assert.equal(await page.locator('[name=password]').inputValue(), '');
    assert.equal(await page.locator('[name=password]').getAttribute('type'), 'password');
    assert.equal(await page.locator('.account-password-toggle').getAttribute('aria-pressed'), 'false');
    assert.ok(!(await page.locator('.account-feedback').textContent()).includes('PRIVATE'));
    await shot(page, 'desktop-invalid-password');

    await page.locator('.account-tab[data-mode=signup]').click();
    assert.equal(await page.locator('.account-submit').getAttribute('data-action'), 'signup');
    assert.equal(await page.locator('[name=password]').getAttribute('autocomplete'), 'new-password');
    assert.equal(await page.locator('[name=confirmPassword]').isVisible(), true);
    assert.equal(await page.locator('[name=confirmPassword]').getAttribute('required'), '');
    await shot(page, 'desktop-signup');
    const signupsBeforeMismatch = authCalls.signups;
    await page.locator('[name=password]').fill('local-review-password');
    await page.locator('[name=confirmPassword]').fill('does-not-match');
    await page.locator('[name=confirmPassword]').press('Enter');
    await page.waitForFunction(() => /coincid|iguales|confirm/i.test(document.querySelector('.account-feedback').textContent));
    assert.equal(authCalls.signups, signupsBeforeMismatch, 'mismatched confirmation must not reach the provider');
    assert.equal(authCalls.signins, 1, 'only the prior failed login reached the provider');
    await page.locator('[name=password]').fill('local-review-password');
    await page.locator('[name=confirmPassword]').fill('local-review-password');
    await page.locator('[name=confirmPassword]').press('Enter');
    await page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('confirmar'));
    assert.equal(authCalls.signups, signupsBeforeMismatch + 1);
    await shot(page, 'desktop-confirmation');
    await page.locator('.account-resend').click();
    await page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('Correo enviado'));
    assert.equal(authCalls.resends, 1);
    await page.locator('.account-confirmation-login').click();
    assert.equal(await page.locator('[name=email]').inputValue(), email, 'confirmation return retains the email');
    assert.equal(await page.locator('.account-submit').getAttribute('data-action'), 'login');
    await page.locator('[name=password]').fill('local-review-password');
    await page.locator('[name=password]').press('Enter');
    await page.waitForFunction(() => !document.querySelector('.account-signed').hidden);
    assert.equal(authCalls.signins, 2, 'failed and successful login each reached the provider once');

    assert.equal(await page.locator('[name=characterName]').getAttribute('maxlength'), '16');
    await page.locator('[name=characterName]').fill('Capitana Sol');
    await page.locator('.account-look[data-skin="1"]').click();
    assert.equal(await page.locator('.account-look[data-skin="1"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.account-look img').count(), 5, 'all five looks display real portrait images');
    assert.equal(await page.locator('#title-name').inputValue(), 'Capitana Sol');
    assert.equal(await page.locator('.skin-dot[data-skin="1"]').getAttribute('aria-pressed'), 'true');
    const savedSettings = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), GAME.saveKey + '.settings');
    assert.equal(savedSettings.name, 'Capitana Sol');
    assert.equal(savedSettings.skin, 1);
    await page.locator('.account-import-toggle').check();
    await shot(page, 'desktop-chooser');
    await shot(page, 'desktop-import');
    rejectVerification = true;
    await page.locator('.account-ready').click();
    await page.evaluate(() => window.__mn.loop.start());
    await page.waitForFunction(() => document.querySelector('.title-msg')?.textContent.includes('sesión no es válida'));
    assert.equal(await store.loadProfile(A), null);
    await page.evaluate(() => { window.__mn.loop.running = false; });
    await shot(page, 'desktop-auth-rejected');
    rejectVerification = false;
    await page.locator('.account-open').click();
    await page.locator('.account-import-toggle').uncheck();
    await page.locator('.account-import-toggle').check();
    await page.locator('.account-ready').click();
    await page.evaluate(() => window.__mn.loop.start());
    await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__mn.client.profile.gold), 57);
    assert.equal(await page.evaluate(() => window.__mn.client.profile.pirateId), `account:${A}`);
    assert.deepEqual(await page.evaluate(() => {
      const c = window.__mn.client, own = c.entities.get(c.youServer);
      return { name: own?.name, skin: own?.skin };
    }), { name: 'Capitana Sol', skin: 1 }, 'the server join record receives the selected name and look');
    await page.waitForFunction(() => document.querySelector('#title').hidden);
    await page.evaluate(() => { window.__mn.loop.running = false; });
    await shot(page, 'desktop-account-joined');
    await page.reload();
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('.account-status')?.textContent === 'pirate@example.test');
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__mn.client.profile.gold), 57);
    results.push({ case: 'desktop account validation, keyboard, chooser, import, rejection and reload', pass: true, providerCalls: { ...authCalls }, pageErrors: errors });
    assert.deepEqual(errors, []);
    await page.close();
  } else {
    await store.initializeProfile(A, { ...old, pirateId: `account:${A}` }, legacyKey(old));
  }

  const mobile = await pageFor(844, 390, true);
  await shot(mobile.page, 'mobile-title');
  await mobile.page.locator('.account-open').click();
  await shot(mobile.page, 'mobile-login');
  const landscapeBounds = await mobile.page.locator('.account-dialog').boundingBox();
  assert.ok(landscapeBounds.x >= 0 && landscapeBounds.y >= 0 && landscapeBounds.x + landscapeBounds.width <= 844 && landscapeBounds.y + landscapeBounds.height <= 390);
  await mobile.page.locator('.account-tab[data-mode=signup]').click();
  await mobile.page.locator('[name=email]').fill('pirate.with.a.very.long.address.for.layout.review@example.test');
  await mobile.page.locator('[name=password]').fill('local-review-password');
  await mobile.page.locator('[name=confirmPassword]').fill('local-review-password');
  await mobile.page.locator('.account-submit').scrollIntoViewIfNeeded();
  const mobileSubmitBounds = await mobile.page.locator('.account-submit').boundingBox();
  assert.ok(mobileSubmitBounds.y >= 0 && mobileSubmitBounds.y + mobileSubmitBounds.height <= 390, 'mobile signup action is reachable after scrolling');
  await shot(mobile.page, 'mobile-signup');
  await mobile.page.locator('[name=confirmPassword]').press('Enter');
  await mobile.page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('confirmar'));
  assert.equal(await mobile.page.locator('.account-confirmation-email').textContent(), 'pirate.with.a.very.long.address.for.layout.review@example.test');
  await mobile.page.locator('.account-dialog').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  const mobileFeedback = await mobile.page.locator('.account-feedback').evaluate((e) => ({ width: e.scrollWidth, client: e.clientWidth }));
  assert.ok(mobileFeedback.width <= mobileFeedback.client, 'long email confirmation feedback wraps');
  await shot(mobile.page, 'mobile-confirmation');
  await mobile.page.locator('.account-confirmation-login').click();
  await mobile.page.locator('[name=email]').fill(email);
  await mobile.page.locator('[name=password]').fill('local-review-password');
  await mobile.page.locator('[name=password]').press('Enter');
  await mobile.page.waitForFunction(() => !document.querySelector('.account-signed').hidden);
  await shot(mobile.page, 'mobile-chooser');
  await mobile.page.locator('.account-logout').click();
  await mobile.page.waitForFunction(() => !document.querySelector('.account-form').hidden);
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
  results.push({ case: 'landscape mobile layout/login/local sign-out/retired guest', pass: true, bounds: landscapeBounds, pageErrors: mobile.errors });
  assert.deepEqual(mobile.errors, []);

  const portrait = await pageFor(390, 844, true);
  await portrait.page.locator('.account-open').click();
  const portraitBounds = await portrait.page.locator('.account-dialog').boundingBox();
  assert.ok(portraitBounds.x >= 0 && portraitBounds.y >= 0 && portraitBounds.x + portraitBounds.width <= 390 && portraitBounds.y + portraitBounds.height <= 844,
    'portrait account dialog stays within the viewport');
  assert.equal(await portrait.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'portrait has no horizontal overflow');
  await shot(portrait.page, 'mobile-portrait-login');
  await portrait.page.locator('.account-tab[data-mode=signup]').click();
  await portrait.page.locator('[name=email]').fill('pirate.with.a.very.long.address.for.layout.review@example.test');
  await portrait.page.locator('[name=password]').fill('local-review-password');
  await portrait.page.locator('[name=confirmPassword]').fill('local-review-password');
  await portrait.page.locator('.account-submit').scrollIntoViewIfNeeded();
  const portraitSubmitBounds = await portrait.page.locator('.account-submit').boundingBox();
  assert.ok(portraitSubmitBounds.y >= 0 && portraitSubmitBounds.y + portraitSubmitBounds.height <= 844, 'portrait signup action stays reachable');
  await shot(portrait.page, 'mobile-portrait-signup');
  await portrait.page.locator('[name=confirmPassword]').press('Enter');
  await portrait.page.waitForFunction(() => document.querySelector('.account-feedback').textContent.includes('confirmar'));
  await portrait.page.locator('.account-dialog').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await shot(portrait.page, 'mobile-portrait-confirmation');
  const longEmailFeedback = await portrait.page.locator('.account-feedback').evaluate((e) => ({ width: e.scrollWidth, client: e.clientWidth }));
  assert.ok(longEmailFeedback.width <= longEmailFeedback.client, 'long email confirmation feedback wraps');
  await portrait.page.locator('.account-confirmation-login').click();
  await portrait.page.locator('[name=email]').fill(email);
  await portrait.page.locator('[name=password]').fill('local-review-password');
  await portrait.page.locator('[name=password]').press('Enter');
  await portrait.page.waitForFunction(() => !document.querySelector('.account-signed').hidden);
  await shot(portrait.page, 'mobile-portrait-chooser');
  const longEmail = await portrait.page.locator('.account-email').evaluate((e) => ({ width: e.scrollWidth, client: e.clientWidth }));
  assert.ok(longEmail.width <= longEmail.client, 'long email wraps in chooser');
  results.push({ case: 'portrait mobile layout, signup scroll, long email and chooser', pass: true, bounds: portraitBounds, pageErrors: portrait.errors });
  assert.deepEqual(portrait.errors, []);

  fs.writeFileSync(path.join(out, process.env.REVIEW_MODE === 'mobile' ? 'mobile-results.json' : 'results.json'), JSON.stringify({ localFakeAuth: true, renderer: 'Chrome SwiftShader', results }, null, 2));
  console.log(JSON.stringify({ localFakeAuth: true, results }, null, 2));
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close(); await gs.close();
  await new Promise((r) => authHttp.close(r));
}

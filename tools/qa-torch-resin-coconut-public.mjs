#!/usr/bin/env node
// Bounded public browser acceptance for the torch, palm-loot, and coconut release.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ensure = (value, message) => { if (!value) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = ms => AbortSignal.timeout(ms);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: timeout(15000) }) } };
const usage = 'node tools/qa-torch-resin-coconut-public.mjs [--env-file PATH] --out NEW_DIRECTORY';
let envFile = null, outArg = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else if (process.argv[i] === '--out' && process.argv[i + 1] && !outArg) outArg = process.argv[++i];
  else if (process.argv[i] === '--help' || process.argv[i] === '-h') { console.log(usage); process.exit(0); }
  else throw new Error(usage);
}
ensure(outArg, usage);
if (envFile) { try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new Error('private QA environment file unavailable'); } }
ensure(process.env.MN_QA_ALLOW_BROWSER === '1', 'browser launch guard active; set MN_QA_ALLOW_BROWSER=1');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) ensure(process.env[key], 'Supabase QA configuration unavailable');
ensure(GAME.version && PROTOCOL_VERSION === 60, 'local acceptance checkout must be protocol 60');

const out = path.resolve(outArg);
ensure(!fs.existsSync(out), 'output directory already exists; choose a new --out directory');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
const target = new URL(process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
ensure(target.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(target.hostname), 'public TLS target required');
const basePath = target.pathname.replace(/\/$/, ''); target.search = ''; target.hash = '';
const endpoint = suffix => new URL(`${basePath}${suffix}`, target);
const worldId = process.env.WORLD_ID || 'marea-negra';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
const store = storeFromEnv();
const allSpecs = [
  { name: 'desktop-es', width: 1280, height: 720, touch: false, locale: 'es' },
  { name: 'desktop-en', width: 1280, height: 720, touch: false, locale: 'en' },
  { name: 'phone-landscape-en', width: 844, height: 390, touch: true, locale: 'en' },
  { name: 'phone-portrait-es', width: 390, height: 844, touch: true, locale: 'es' },
];
const requestedViews = process.env.MN_QA_VIEWPORTS?.split(',').filter(Boolean);
ensure(!requestedViews || requestedViews.every(name => allSpecs.some(spec => spec.name === name)), 'unknown QA viewport');
const specs = requestedViews ? allSpecs.filter(spec => requestedViews.includes(spec.name)) : allSpecs;
const evidence = { schema: 'mn.torch-resin-coconut.public-browser.v1', startedAt: new Date().toISOString(),
  target: target.origin, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
  identity: 'separate random disposable Supabase user per viewport; credentials redacted',
  scope: 'normal Auth login and public WSS, exact hand-torch cost, localized responsive UI, coconut hydration, icon variants, durable profile reentry; no palm harvesting action',
  viewports: [], pass: false };
let activePage = null;
let pendingIdentity = null;
const privateValues = new Set();

const redact = value => [...privateValues].reduce((text, secret) => text.replaceAll(secret, '[redacted-private-value]'), String(value || ''))
  .replaceAll(process.env.SUPABASE_SERVICE_KEY || '\0', '[redacted-key]')
  .replaceAll(process.env.SUPABASE_PUBLIC_KEY || '\0', '[redacted-key]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted-token]')
  .replace(/((?:access_token|refresh_token|apikey|api_key|token|secret|password|code)=)[^&\s]+/gi, '$1[redacted]');
const unwrap = result => { if (!result || result.error) throw new Error('Supabase QA operation failed'); return result.data; };
const pauseUntil = async (predicate, label, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await predicate()) return; await pause(300); }
  throw new Error(`bounded wait expired: ${label}`);
};
async function publicStatus() {
  const response = await fetch(endpoint('/status'), { cache: 'no-store', signal: timeout(15000) });
  ensure(response.ok, 'public status unavailable'); return response.json();
}
async function assertIdle(label) {
  await pauseUntil(async () => {
    const s = await publicStatus();
    return s.players === 0 && s.sockets === 0 && s.storage?.unsaved === 0 && s.storage?.profileWrites === 0
      && s.storage?.economic?.pending === 0 && s.storage?.worldWriting === false;
  }, `${label}: public authority did not drain`, 45000);
}
async function publicPreflight() {
  const routes = ['/health', '/status', '/auth/config', '/src/net/protocol.js'];
  const responses = await Promise.all(routes.map(route => fetch(endpoint(route), { cache: 'no-store', signal: timeout(15000) })));
  ensure(responses.every(response => response.ok), 'public health/build/auth/protocol endpoints unavailable');
  ensure(await responses[0].text() === 'ok', 'public health response mismatch');
  const [status, auth, protocol] = await Promise.all([responses[1].json(), responses[2].json(), responses[3].text()]);
  const s = status.storage;
  ensure(status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0
    && s?.durable === true && s?.accounts === true && s?.economic?.enabled === true && s.economic.failed === false
    && s.economic.pending === 0 && s?.fire?.enabled === true && s.fire.ready === true && s.fire.torchRules === 2
    && s?.foraging?.enabled === true && s.foraging.ready === true
    && s?.freshwater?.enabled === true && s.freshwater.ready === true
    && s?.world?.id === worldId && s.world.ready === true && s.world.failed === false
    && s.unsaved === 0 && s.profileWrites === 0 && s.errors === 0,
  'public release, idle gate, protocol-60 feature activation, SQL037 readiness, or world readiness mismatch');
  ensure(protocol.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol differs from this checkout');
  ensure(auth.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
    'public Auth configuration mismatch');
  evidence.preflight = { pass: true, gameVersion: status.version, protocolVersion: PROTOCOL_VERSION,
    players: status.players, sockets: status.sockets, worldId, foragingReady: s.foraging.ready,
    fireRules: s.fire.torchRules, economicPending: s.economic.pending };
}
async function createAccount(spec) {
  const tag = randomUUID(), email = `mn-torch-qa-${tag}@example.com`, password = `Aa1!${randomBytes(28).toString('base64url')}`;
  privateValues.add(email); privateValues.add(password);
  const marker = `mnQaTorchResinCoconutPublic:${tag}`;
  const generated = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  const accountId = generated.user?.id;
  ensure(accountId && generated.user.email === email, 'disposable Auth account creation failed');
  const marked = unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: marker } }));
  ensure(marked.user?.user_metadata?.mn_qa_marker === marker, 'disposable account marker failed');
  pendingIdentity = { accountId, email, password, marker, spec };
  unwrap(await pub.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: 'signup' }));
  const profile = newProfile(); profile.pirateId = `account:${accountId}`;
  profile.eco.pack.goods = { tronco: 3, resina: 1, coco: 1, piedra: 2 };
  profile.surv = { v: 1, sat: 50, hyd: 20 };
  const normalized = sanitizeProfile(profile);
  ensure(normalized?.pirateId === `account:${accountId}` && normalized.eco.pack.goods.tronco === 3
    && normalized.eco.pack.goods.resina === 1 && normalized.eco.pack.goods.coco === 1
    && normalized.eco.pack.goods.piedra === 2 && normalized.surv.hyd === 20,
  'bounded disposable profile rejected by current sanitizer');
  const seeded = await store.initializeProfile(accountId, normalized);
  ensure(seeded?.version === 1 && seeded.data?.pirateId === `account:${accountId}`,
    'disposable profile seed failed');
  const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
  ensure(login.user?.id === accountId && login.session?.access_token, 'normal password login failed');
  pendingIdentity.profile = normalized;
  return pendingIdentity;
}
async function waitPage(page, predicate, label, ms = 90000, arg = null) {
  try { await page.waitForFunction(predicate, arg, { timeout: ms }); }
  catch { throw new Error(`bounded browser wait expired: ${label}`); }
}
async function browserViewport(spec, identity, result, receiptIds, verifiedReceiptIds) {
  const sibling = path.resolve(repo, '..', 'realms-of-trade-server');
  const playwrightFile = path.resolve(process.env.MN_PLAYWRIGHT || path.join(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
  const { chromium } = await import(pathToFileURL(playwrightFile).href);
  const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: path.resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
    headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  let context = null, page = null;
  const closingPages = new WeakSet();
  const network = { pageErrors: [], consoleErrors: [], httpErrors: [], expectedGmDenials: [], gmProbeAborts: [], failedRequests: [], websockets: [], iconResponses: [] };
  const gmDenial = value => { try { const u = new URL(value); return u.origin === target.origin && u.pathname === `${basePath}/api/gm/session`; } catch { return false; } };
  const listen = current => {
    current.on('pageerror', error => network.pageErrors.push(redact(error?.message)));
    current.on('console', message => {
      if (message.type() !== 'error' || (gmDenial(message.location().url) && /403/.test(message.text()))) return;
      network.consoleErrors.push(redact(message.text()));
    });
    current.on('response', response => {
      if (response.status() >= 400) {
        let item; try { const u = new URL(response.url()); item = { status: response.status(), origin: u.origin, path: u.pathname }; }
        catch { item = { status: response.status(), origin: 'invalid', path: 'invalid' }; }
        if (response.status() === 403 && gmDenial(response.url())) network.expectedGmDenials.push(item);
        else network.httpErrors.push(item);
      }
      if (/(?:resina|coco)-v1.*\.webp/i.test(response.url())) {
        try { const u = new URL(response.url()); network.iconResponses.push({ url: `${u.origin}${u.pathname}`, status: response.status() }); }
        catch { network.iconResponses.push({ url: '[invalid-url]', status: response.status() }); }
      }
    });
    current.on('requestfailed', request => {
      const item = { url: (() => { try { const u = new URL(request.url()); return `${u.origin}${u.pathname}`; } catch { return 'invalid'; } })(), error: redact(request.failure()?.errorText) };
      // Ordinary-player acceptance does not certify the separate GM admission endpoint.
      // Keep cancelled/timed-out GM probes visible, and require fail-closed admission below.
      if (gmDenial(request.url()) && item.error === 'net::ERR_ABORTED') network.gmProbeAborts.push({ ...item, duringClose: closingPages.has(current) });
      else network.failedRequests.push(item);
    });
    current.on('websocket', socket => { try { network.websockets.push(new URL(socket.url()).protocol); } catch {} });
  };
  try {
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); activePage = page;
    await page.exposeFunction('__qaRecordCommand', message => {
      if (typeof message?.opId !== 'string') return;
      const id = economicOperationId(worldId, identity.accountId, message.opId);
      if (!receiptIds.includes(id)) receiptIds.push(id);
    });
    listen(page);
    await page.addInitScript(locale => localStorage.setItem('mn.locale', locale), spec.locale);
    await page.goto(`${target.origin}${basePath}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
    await waitPage(page, () => window.__mn && !document.querySelector('#btn-play')?.disabled, `${spec.name} client ready`);
    await waitPage(page, () => window.__mn.transport.kind === 'ws' && !window.__mn.transport.closed
      && window.__mn.transport.ws?.readyState === 1 && window.__mn.transport.rtt > 0 && !document.querySelector('.net-lost'),
    `${spec.name} public WSS ready`);
    await page.locator('.account-open').click();
    await page.locator('.account-form input[name="email"]').fill(identity.email);
    await page.locator('.account-form input[name="password"]').fill(identity.password);
    await page.locator('.account-submit').click();
    await waitPage(page, () => { const n = document.querySelector('.account-signed'); return n && !n.hidden; }, `${spec.name} normal Auth login`);
    await page.locator('.account-ready').click();
    await waitPage(page, () => window.__mn.client?.joined && window.__mn.st.mode === 'playing'
      && window.__mn.client.fire?.enabled === true && window.__mn.client.fire?.torchRules === 2,
    `${spec.name} authenticated join`, 60000);
    await waitPage(page, () => !window.__mn.st.boarding && document.querySelector('#title')?.hidden
      && !document.querySelector('#hud')?.hidden, `${spec.name} boarding transition`);
    assert.equal(await page.evaluate(() => window.__mn.client.profile.pirateId), `account:${identity.accountId}`);
    assert.ok(network.websockets.includes('wss:'), 'authenticated session did not use public WSS');

    await page.evaluate(() => window.__mn.panels.workbench.open({ recipe: 'hacha_piedra' }));
    await waitPage(page, () => window.__mn.panels.workbench.active, `${spec.name} axe recipe panel`);
    const axe = page.locator('.workbench-panel');
    const axeLayout = await axe.evaluate(root => {
      const detail = root.querySelector('.cr-detail'), stats = root.querySelector('[data-stats]').getBoundingClientRect();
      const action = root.querySelector('.cr-action').getBoundingClientRect(), detailBox = detail.getBoundingClientRect();
      const main = root.querySelector('.cr-main').getBoundingClientRect();
      return { statsBottom: stats.bottom, actionTop: action.top, detailBottom: detailBox.bottom,
        detailRight: detailBox.right, mainRight: main.right, scrollHeight: detail.scrollHeight,
        clientHeight: detail.clientHeight, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    await page.locator('.wb-confirm').scrollIntoViewIfNeeded();
    const axeButton = await page.locator('.wb-confirm').evaluate(el => { const r = el.getBoundingClientRect();
      return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height, disabled:el.disabled }; });
    assert.ok(axeLayout.detailRight <= axeLayout.mainRight && axeLayout.documentWidth <= axeLayout.viewportWidth,
      `axe detail overflows its panel or viewport: ${JSON.stringify(axeLayout)}`);
    assert.ok(axeButton.x >= 0 && axeButton.y >= 0 && axeButton.right <= spec.width && axeButton.bottom <= spec.height
      && Math.min(axeButton.width, axeButton.height) >= 39, `axe action button is clipped: ${JSON.stringify(axeButton)}`);
    if (!spec.touch) assert.ok(axeLayout.statsBottom <= axeLayout.actionTop + 1 && axeButton.bottom <= axeLayout.detailBottom,
      `desktop axe statistics overlap or action is clipped: ${JSON.stringify({ axeLayout, axeButton })}`);
    result.checks.axeLayout = { ...axeLayout, button: axeButton };
    await page.screenshot({ path: path.join(out, `${spec.name}-axe-layout.png`), animations: 'disabled' });
    result.screenshots.push(`${spec.name}-axe-layout.png`);
    await page.evaluate(() => window.__mn.panels.workbench.close());

    const dispatched = await page.evaluate(() => {
      const client = window.__mn.client, send = client.send.bind(client); window.__qaCommands = [];
      client.send = message => {
        if ((message.type === 'fire' && message.op === 'load') || (message.type === 'freshwater' && message.op === 'eat' && message.source === 'coco')) {
          window.__qaCommands.push(structuredClone(message)); window.__qaRecordCommand(message);
        }
        return send(message);
      };
      return { goods: structuredClone(client.profile.eco.pack.goods), hyd: window.__mn.ps.hyd };
    });
    assert.deepEqual(dispatched.goods, { tronco: 3, resina: 1, coco: 1, piedra: 2 });
    const shot = async label => { const file = `${spec.name}-${label}.png`;
      await page.evaluate(async () => {
        await document.fonts.ready;
        const urls = [...document.querySelectorAll('.kit-item-art')].filter(el => el.getClientRects().length)
          .map(el => getComputedStyle(el).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]).filter(Boolean);
        await Promise.all([...new Set(urls)].map(url => new Promise((resolve, reject) => {
          const img = new Image(); img.onload = resolve; img.onerror = () => reject(new Error('visible item art failed to load')); img.src = url;
        })));
      });
      await page.screenshot({ path: path.join(out, file), animations: 'disabled' }); result.screenshots.push(file); };
    const clickPanelOpen = async () => {
      await page.locator('#personal-lantern').click();
      await waitPage(page, () => window.__mn.panels.firePanel.active, `${spec.name} fire panel`);
    };
    await clickPanelOpen();
    const firePanel = page.locator('.fire-panel');
    const fireText = await firePanel.textContent();
    assert.ok(fireText.includes(spec.locale === 'en' ? 'Hand torch' : 'Antorcha de mano'), 'fire panel language mismatch');
    assert.ok(fireText.includes(spec.locale === 'en' ? 'Resin' : 'Resina'), 'fire panel does not show resin');
    await page.evaluate(async locale => (await import('/src/core/locale.js')).setLocale(locale), spec.locale === 'en' ? 'es' : 'en');
    assert.ok((await page.locator('.fire-title').textContent()).includes(spec.locale === 'en' ? 'Antorcha' : 'Hand torch'), 'open fire panel failed language toggle');
    await page.evaluate(async locale => (await import('/src/core/locale.js')).setLocale(locale), spec.locale);
    const bounds = await firePanel.evaluate(el => { const r = el.getBoundingClientRect(), b = el.querySelector('.fire-load')?.getBoundingClientRect();
      return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height,
        buttonWidth:b?.width ?? 0, buttonHeight:b?.height ?? 0, viewportWidth:innerWidth, viewportHeight:innerHeight,
        documentWidth:document.documentElement.scrollWidth }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.viewportWidth && bounds.bottom <= bounds.viewportHeight
      && bounds.documentWidth <= bounds.viewportWidth && Math.min(bounds.buttonWidth, bounds.buttonHeight) >= 39,
    `fire panel or action exceeds viewport bounds: ${JSON.stringify(bounds)}`);
    await shot('torch-panel');
    await page.locator('.fire-panel .fire-load').click();
    await waitPage(page, () => window.__mn.client.fire.slots.some(s => s.key === 'hand' && s.lit)
      && window.__mn.client.profile.eco.pack.goods.tronco === 1
      && !window.__mn.client.profile.eco.pack.goods.resina, `${spec.name} exact torch consumption`, 30000);
    let commands = await page.evaluate(() => window.__qaCommands);
    const fireCommand = commands.find(c => c.type === 'fire' && c.op === 'load');
    assert.ok(fireCommand?.opId, 'torch UI did not dispatch an identifiable command');
    assert.equal(fireCommand.rules, 2, 'torch command did not use protocol-60 rules');
    let profile = await page.evaluate(() => structuredClone(window.__mn.client.profile));
    assert.equal(profile.eco.pack.goods.tronco, 1); assert.equal(profile.eco.pack.goods.resina, undefined);
    assert.equal(profile.eco.pack.goods.coco, 1); assert.equal(profile.eco.pack.goods.piedra, 2);
    const fireReceiptId = economicOperationId(worldId, identity.accountId, fireCommand.opId);
    const fireReceipt = await store.loadEconomicOperation(fireReceiptId);
    assert.ok(fireReceipt?.result?.ok, 'durable torch economic receipt missing');
    assert.equal(fireReceipt.request?.before?.eco?.pack?.goods?.tronco, 3);
    assert.equal(fireReceipt.request?.before?.eco?.pack?.goods?.resina, 1);
    assert.equal(fireReceipt.request?.profile?.eco?.pack?.goods?.tronco, 1);
    assert.equal(fireReceipt.request?.profile?.eco?.pack?.goods?.resina, undefined);
    verifiedReceiptIds.add(fireReceiptId);
    result.checks.torch = { cost: { tronco: 2, resina: 1 }, goodsAfter: profile.eco.pack.goods,
      fireRules: fireCommand.rules, durableReceipt: true, panelBounds: bounds };
    await shot('torch-lit');

    await page.evaluate(() => window.__mn.panels.firePanel.close());
    await page.evaluate(() => window.__mn.panels.charPanel.open('gear'));
    const coconutButton = page.locator('[data-eat="coco"]'); await coconutButton.waitFor({ state: 'visible' });
    assert.match(await coconutButton.getAttribute('title') || '', /25/);
    const hydBefore = await page.evaluate(() => window.__mn.ps.hyd);
    await shot('coconut-inventory');
    await coconutButton.click();
    await page.locator('.freshwater-panel').waitFor({ state: 'visible' });
    await page.locator('.freshwater-panel [data-food="coco"]').click();
    await waitPage(page, () => window.__qaCommands.some(c => c.type === 'freshwater' && c.op === 'eat' && c.source === 'coco')
      && !window.__mn.client.profile.eco.pack.goods.coco, `${spec.name} coconut command accepted`, 30000);
    await waitPage(page, hyd => window.__mn.ps.hyd > hyd + 24, `${spec.name} coconut restores hydration`, 5000, hydBefore);
    commands = await page.evaluate(() => window.__qaCommands);
    const coconutCommand = commands.find(c => c.type === 'freshwater' && c.op === 'eat' && c.source === 'coco');
    assert.ok(coconutCommand?.opId, 'coconut UI command lacks operation id');
    const coconutReceiptId = economicOperationId(worldId, identity.accountId, coconutCommand.opId);
    const coconutReceipt = await store.loadEconomicOperation(coconutReceiptId);
    assert.ok(coconutReceipt?.result?.ok, 'durable coconut economic receipt missing');
    assert.equal(coconutReceipt.request?.before?.eco?.pack?.goods?.coco, 1);
    assert.equal(coconutReceipt.request?.profile?.eco?.pack?.goods?.coco, undefined);
    assert.ok(coconutReceipt.request?.profile?.surv?.hyd >= coconutReceipt.request.before.surv.hyd + 24.5,
      'coconut durable profile transition did not add 25 hydration');
    verifiedReceiptIds.add(coconutReceiptId);
    const hydAfter = await page.evaluate(() => window.__mn.ps.hyd);
    result.checks.coconut = { hydBefore, hydAfter, hydGain: hydAfter - hydBefore, durableReceipt: true };

    const iconResponses = network.iconResponses;
    result.checks.icons = iconResponses;
    assert.ok(iconResponses.some(r => r.status === 200 && /resina-v1/.test(r.url))
      && iconResponses.some(r => r.status === 200 && /coco-v1/.test(r.url)), 'resin and coconut icons did not both load');
    if (spec.touch) assert.ok(iconResponses.filter(r => /(?:resina|coco)-v1/.test(r.url)).every(r => /-mobile\.webp/.test(r.url)),
      'mobile did not use the 64px icon variants');
    await shot('coconut-consumed');

    const beforeRejoin = await store.loadProfile(identity.accountId);
    assert.ok(beforeRejoin?.version > 1, 'profile write did not persist before rejoin');
    closingPages.add(page); await context.close(); context = null; page = null; activePage = null;
    await browser.close();
    await assertIdle(`${spec.name} logout`);

    const reBrowser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: path.resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
      headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
    try {
      context = await reBrowser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
        isMobile: spec.touch, hasTouch: spec.touch });
      page = await context.newPage(); activePage = page;
      listen(page);
      await page.addInitScript(locale => localStorage.setItem('mn.locale', locale), spec.locale);
      await page.goto(`${target.origin}${basePath}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
      await waitPage(page, () => window.__mn && !document.querySelector('#btn-play')?.disabled, `${spec.name} rejoin client`);
      await page.locator('.account-open').click();
      await page.locator('.account-form input[name="email"]').fill(identity.email);
      await page.locator('.account-form input[name="password"]').fill(identity.password);
      await page.locator('.account-submit').click();
      await waitPage(page, () => { const n = document.querySelector('.account-signed'); return n && !n.hidden; }, `${spec.name} password login after rejoin`);
      await page.locator('.account-ready').click();
      await waitPage(page, () => window.__mn.client?.joined && window.__mn.st.mode === 'playing' && !window.__mn.st.boarding,
        `${spec.name} rejoined public world`, 60000);
      const restored = await page.evaluate(() => structuredClone(window.__mn.client.profile));
      assert.equal(await page.evaluate(() => window.__mn.gmEntry.allowed), false, 'ordinary QA account gained GM admission');
      assert.equal(restored.pirateId, `account:${identity.accountId}`);
      assert.equal(restored.eco.pack.goods.tronco, 1); assert.equal(restored.eco.pack.goods.resina, undefined);
      assert.equal(restored.eco.pack.goods.coco, undefined); assert.equal(restored.eco.pack.goods.piedra, 2);
      // LocalServer.leave calls hideHandFire, saving the remaining fuel extinguished.
      assert.ok(restored.fire?.slots?.hand?.seconds > 0 && restored.fire.slots.hand.lit === false,
        'saved torch fuel did not survive rejoin in extinguished state');
      assert.ok(restored.surv.hyd <= beforeRejoin.data.surv.hyd && restored.surv.hyd > hydBefore,
        'saved hydration did not retain the coconut effect');
      result.checks.rejoin = { goods: restored.eco.pack.goods, torchSeconds: restored.fire.slots.hand.seconds,
        torchLit: restored.fire.slots.hand.lit, hyd: restored.surv.hyd, profileVersion: beforeRejoin.version };
      await shot('rejoined');
      closingPages.add(page); await context.close(); context = null; page = null; activePage = null;
    } finally { await context?.close().catch(() => {}); await reBrowser.close().catch(() => {}); }
    result.network = network;
    assert.deepEqual(network.pageErrors, [], 'browser page errors');
    assert.deepEqual(network.consoleErrors, [], 'browser console errors');
    assert.deepEqual(network.httpErrors, [], 'unexpected public HTTP errors');
    assert.deepEqual(network.failedRequests, [], 'failed browser requests');
    result.network = network; result.status = 'passed';
    return { fireReceiptId, coconutReceiptId };
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    activePage = null;
  }
}

async function cleanupAccount(identity, result, receiptIds, verifiedReceiptIds) {
  const auth = unwrap(await admin.auth.admin.getUserById(identity.accountId));
  ensure(auth.user?.email === identity.email && auth.user?.user_metadata?.mn_qa_marker === identity.marker,
    'cleanup stopped: disposable Auth ownership marker mismatch');
  await assertIdle(`${identity.spec.name} disposable account disconnect`);
  const rows = unwrap(await admin.from('mn_economic_operations').select('operation_id,request')
    .eq('request->>account', identity.accountId).order('operation_id').range(0, 99));
  ensure(rows.length <= 2, 'disposable economic receipt count exceeded the bounded two-action scope');
  const allowed = new Set(receiptIds);
  for (const receipt of rows) ensure(receipt.request?.account === identity.accountId && receipt.request?.world === worldId
    && allowed.has(receipt.operation_id), 'unaccounted disposable economic receipt');
  for (const id of verifiedReceiptIds) ensure(rows.some(receipt => receipt.operation_id === id),
    'verified gameplay receipt missing before disposable identity cleanup');
  const row = await store.loadProfile(identity.accountId);
  if (row) {
    ensure(Number.isSafeInteger(row.version) && row.version > 0, 'cleanup stopped: profile version unavailable for exact delete');
    ensure(row.data?.pirateId === `account:${identity.accountId}`
      && [1, 3].includes(row.data?.eco?.pack?.goods?.tronco)
      && (row.data?.eco?.pack?.goods?.resina === undefined || row.data.eco.pack.goods.resina === 1)
      && (row.data?.eco?.pack?.goods?.coco === undefined || row.data.eco.pack.goods.coco === 1)
      && row.data?.eco?.pack?.goods?.piedra === 2,
    'cleanup stopped: profile ownership or bounded inventory sentinel mismatch');
    const deleted = unwrap(await admin.from('mn_profiles').delete().eq('player_id', identity.accountId)
      .eq('version', row.version).select('player_id'));
    ensure(deleted?.length === 1 && deleted[0].player_id === identity.accountId, 'exact disposable profile deletion failed');
  }
  unwrap(await admin.auth.admin.deleteUser(identity.accountId));
  ensure(await store.loadProfile(identity.accountId) === null, 'disposable profile remains after cleanup');
  const absent = await admin.auth.admin.getUserById(identity.accountId);
  ensure(absent.error?.status === 404, 'disposable Auth account absence was not confirmed');
  result.cleanup = { markedAuthAndExactProfileRemoved: true, retainedEconomicReceipts: rows.length,
    receiptPolicy: 'immutable gameplay receipts retained; no receipt deletion' };
}

try {
  await publicPreflight();
  for (const spec of specs) {
    const result = { viewport: spec, checks: {}, screenshots: [], status: 'running' };
    evidence.viewports.push(result);
    console.log(JSON.stringify({ stage: "viewport", name: spec.name }));
    let identity = null; const receipts = [], verifiedReceipts = new Set();
    try {
      identity = await createAccount(spec);
      await browserViewport(spec, identity, result, receipts, verifiedReceipts);
    } catch (error) {
      result.status = 'failed'; result.error = redact(error?.message || 'viewport acceptance failed');
      evidence.pass = false; evidence.failure = evidence.failure || result.error;
      if (activePage && !activePage.isClosed()) {
        try { result.failureState = await activePage.evaluate(() => ({
          joined: !!window.__mn?.client?.joined, goods: window.__mn?.client?.profile?.eco?.pack?.goods ?? null,
          hyd: window.__mn?.ps?.hyd ?? null, fire: window.__mn?.client?.fire?.slots ?? null,
          commands: (window.__qaCommands || []).map(c => ({ type:c.type, op:c.op, source:c.source, opId:c.opId })) })); } catch {}
      }
    } finally {
      identity ||= pendingIdentity?.spec === spec ? pendingIdentity : null;
      if (identity) {
        // Close the browser before touching disposable Auth/profile rows.
        try { await cleanupAccount(identity, result, receipts, verifiedReceipts); }
        catch (error) { result.cleanupFailure = redact(error?.message || 'disposable cleanup failed'); result.status = 'failed'; evidence.pass = false; process.exitCode = 1; }
        pendingIdentity = null;
        console.log(JSON.stringify({ stage: "viewport-result", name: spec.name, status: result.status, error: result.error || null, cleanup: !!result.cleanup }));
      }
      try { await pub.auth.signOut(); } catch {}
    }
  }
  evidence.pass = evidence.viewports.length === specs.length && evidence.viewports.every(v => v.status === 'passed' && v.cleanup);
} catch (error) {
  evidence.pass = false; evidence.failure = redact(error?.message || 'public acceptance failed'); process.exitCode = 1;
} finally {
  evidence.completedAt = new Date().toISOString();
  const file = path.join(out, 'acceptance.json');
  try { fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); fs.chmodSync(file, 0o600); }
  catch { evidence.pass = false; evidence.outputFailure = 'new evidence file could not be written'; process.exitCode = 1; }
  console.log(JSON.stringify({ pass: evidence.pass, viewports: evidence.viewports.map(v => ({ name: v.viewport.name,
    status: v.status, cleanup: v.cleanup?.markedAuthAndExactProfileRemoved === true })),
  failure: evidence.failure || evidence.outputFailure || null, evidence: fs.existsSync(file) ? file : null }));
}
process.exitCode = evidence.pass ? 0 : 1;

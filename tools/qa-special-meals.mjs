#!/usr/bin/env node
// Bounded local browser fixture for the SRV02 special-meals panel. No game host or account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firstExisting = paths => paths.find(path => fs.existsSync(path)) || paths[0];
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || firstExisting([
  resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
  resolve(repo, '..', 'realms-of-trade-server', '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
]));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1]
  : process.env.MN_QA_OUT || resolve(repo, 'docs/delivery/srv02-special-meals/local'));
assert(out.startsWith(repo + sep) || process.env.MN_QA_OUT || process.argv.includes('--out'), 'output path must be explicit or inside the repository');
await mkdir(out, { recursive: true });

const specs = [
  { name: 'desktop-es', locale: 'es', width: 1280, height: 900, mobile: false },
  { name: 'desktop-en', locale: 'en', width: 1280, height: 900, mobile: false },
  { name: 'mobile-es', locale: 'es', width: 390, height: 844, mobile: true },
  { name: 'mobile-en', locale: 'en', width: 390, height: 844, mobile: true },
  { name: 'mobile-rotated-es', locale: 'es', width: 390, height: 844, mobile: true, rotated: true },
  { name: 'mobile-rotated-en', locale: 'en', width: 390, height: 844, mobile: true, rotated: true },
];
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = { schema: 'mn.srv02.special-meals.local.v1', generatedAt: new Date().toISOString(),
  purpose: 'Exercise the real FreshwaterPanel DOM and freshwater stylesheet with a disposable local stub client.',
  scope: 'Serial Chromium only; no game server, account, network service, or persistent player writes. Browser checks are visual/layout and client transport fixture evidence, not server authority acceptance.',
  viewports: [], failures: [], screenshots: [] };
const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const pageHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>SRV02 meals local QA</title><link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/freshwater.css"><style>html,body{margin:0;min-height:100%;background:#102327;color:#f2f7f6}body{font:14px system-ui,sans-serif}#stage{position:fixed;left:0;top:0;width:100vw;height:100dvh;overflow:hidden;container-type:size;container-name:stage}#fixture-title{padding:12px 16px;color:#91cec2}</style></head><body><div id="stage"><div id="fixture-title">Disposable local UI fixture</div><main id="mount"></main></div><script type="module">
import { FreshwaterPanel } from '/src/ui/freshwaterPanel.js';
import { stage } from '/src/ui/stage.js';
let clock = 0;
const rotateStage = new URLSearchParams(location.search).has('rotated');
stage.configure({ enabled: () => rotateStage }); stage.update();
const client = { joined: true, youServer: 42, actionBusy: false, freshwaterStatus: {
  enabled: true, canteenEnabled: false, mealsEnabled: true, source: { id: 'spring-local', name: 'Manantial local', near: false },
  barrels: [], gathering: 0, meal: null, cookers: [],
}, profile: { eco: { tradeRev: 17, pack: { goods: { pescado: 1, ron: 1, agua: 1, galleta: 1, harina: 1 }, vessels: [] } }, surv: { sat: 100, hyd: 100 } }, sent: [],
  send(command) { this.sent.push(command); } };
const panel = new FreshwaterPanel({ parent: document.querySelector('#mount'), client: () => client, locale: () => document.documentElement.lang, now: () => clock });
panel.open();
window.qa = { client, panel, setLocale(locale) { document.documentElement.lang = locale; panel.update(); },
  setCookers(cookers) { client.freshwaterStatus.cookers = cookers; panel.update(); },
  setGoods(goods) { client.profile.eco.pack.goods = goods; panel.update(); },
  setMeal(meal) { client.freshwaterStatus.meal = meal; panel.update(); },
  advance(ms) { clock += ms; panel.update(); },
  acknowledge(ev) { return panel.acknowledge(ev); },
  profileSnapshot() { return structuredClone(client.profile); },
  lastCommand() { return client.sent.at(-1); },
};
</script></body></html>`;

const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { res.writeHead(200, { 'content-type': mime['.html'], 'cache-control': 'no-store' }); res.end(pageHtml); return; }
  const file = resolve(repo, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(repo + sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); });
const port = server.address().port;
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });

async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], consoleErrors: [], externalRequests: [], assertions: {}, screenshots: [] };
  evidence.viewports.push(result);
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.mobile, hasTouch: spec.mobile });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(String(error?.stack || error)));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && Number(url.port) === port) return route.continue();
    result.externalRequests.push(url.href); return route.abort();
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/${spec.rotated ? '?rotated=1' : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.qa?.panel?.active);
    await page.evaluate(locale => window.qa.setLocale(locale), spec.locale);
    const panel = page.locator('.freshwater-panel');
    const bounds = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= spec.width && bounds.bottom <= spec.height && bounds.documentWidth <= spec.width,
      `${spec.name} panel/document overflows viewport: ${JSON.stringify(bounds)}`);
    assert(bounds.scrollHeight > bounds.clientHeight, `${spec.name} panel does not scroll: ${JSON.stringify(bounds)}`);
    const expected = spec.locale === 'es'
      ? { fish: ['Pescado asado', '1 pescado', '+10 % de vida máxima'], grog: ['Grog', '1 ron + 1 agua', '+25 % de recuperación de aguante'], biscuit: ['Galleta reforzada', '1 galleta + 1 harina', '+10 unidades de carga cómoda; no cambia la masa máxima'], action: 'Preparar y comer' }
      : { fish: ['Roast fish', '1 fish', '+10% maximum health'], grog: ['Grog', '1 rum + 1 water', '+25% stamina recovery'], biscuit: ['Reinforced biscuit', '1 biscuit + 1 flour', '+10 units of comfortable load; maximum mass is unchanged'], action: 'Prepare and eat' };
    for (const [kind, values] of [['roastFish', expected.fish], ['grog', expected.grog], ['heartyBiscuit', expected.biscuit]]) {
      const card = page.locator(`[data-meal-card="${kind}"]`);
      await card.waitFor({ state: 'visible' });
      assert.equal(await card.locator('.fresh-meal-name').innerText(), values[0]);
      assert.equal(await card.locator('.fresh-meal-cost').innerText(), values[1]);
      assert.equal(await card.locator('.fresh-meal-effect').innerText(), values[2]);
      assert.equal(await card.locator('.fresh-meal-duration').innerText(), '15 min');
      assert.equal(await card.locator('button').innerText(), expected.action);
    }
    result.assertions.panelBounds = bounds;
    result.assertions.allThreeLocalizedRecipesAndDurations = true;
    const shotStart = `${spec.name}-${runTag}-top.png`;
    await panel.screenshot({ path: resolve(out, shotStart), animations: 'disabled' }); result.screenshots.push(shotStart);

    const fishButton = page.locator('[data-meal="roastFish"]');
    assert.equal(await fishButton.isDisabled(), true, 'hot fish action should begin disabled without a cooker');
    assert.match(await fishButton.getAttribute('title'), spec.locale === 'es' ? /fogata|parrilla/ : /campfire|grill/);
    assert.match(await page.locator('[data-meal-card="roastFish"] .fresh-meal-hint').innerText(), spec.locale === 'es' ? /fogata|parrilla/ : /campfire|grill/,
      'heat requirement should remain visible without relying on button title');
    const grogButton = page.locator('[data-meal="grog"]'); assert.equal(await grogButton.isEnabled(), true, 'grog should not need heat');
    await page.evaluate(() => window.qa.setCookers([
      { ship: 'raft-local', part: 'cold-grill', kind: 'grill', near: true, lit: false, broken: false },
      { ship: 'raft-local', part: 'broken-fire', kind: 'campfire', near: true, lit: true, broken: true },
      { ship: 'raft-local', part: 'hot-grill', kind: 'grill', near: true, lit: true, broken: false },
    ]));
    assert.equal(await fishButton.isEnabled(), true, 'hot fish should enable for eligible cooker');
    assert.match(await page.locator('[data-meal-card="roastFish"] .fresh-meal-hint').innerText(), spec.locale === 'es' ? /Fogata o parrilla encendida/ : /Lit campfire or grill required/);
    await page.evaluate(() => window.qa.setGoods({ pescado: 0, ron: 1, agua: 1, galleta: 1, harina: 1 }));
    assert.equal(await fishButton.isDisabled(), true, 'missing fish should disable recipe');
    assert.match(await fishButton.getAttribute('title'), spec.locale === 'es' ? /ingredientes/ : /missing ingredients/);
    await page.evaluate(() => window.qa.setGoods({ pescado: 1, ron: 1, agua: 1, galleta: 1, harina: 1 }));
    assert.equal(await fishButton.isEnabled(), true);
    result.assertions.heatAndGoodsDisabledThenEligibleEnabled = true;
    result.assertions.visibleHeatRequirement = true;

    const before = await page.evaluate(() => window.qa.profileSnapshot());
    await grogButton.click();
    const request = await page.evaluate(() => window.qa.lastCommand());
    assert.equal(request.type, 'freshwater'); assert.equal(request.op, 'meal'); assert.equal(request.source, 'grog');
    assert.equal(request.ship, ''); assert.equal(request.part, ''); assert.equal(request.n, 1);
    assert.deepEqual(await page.evaluate(() => window.qa.profileSnapshot()), before, 'profile mutated optimistically after meal submit');
    await page.evaluate(() => window.qa.advance(1000));
    const retry = await page.evaluate(() => window.qa.lastCommand());
    assert.deepEqual(retry, request, 'retry did not reuse exact command payload');
    assert.deepEqual(await page.evaluate(() => window.qa.profileSnapshot()), before, 'profile mutated optimistically during retry');
    assert.equal(await page.evaluate(({ opId }) => window.qa.acknowledge({ type: 'freshwater', opId, ok: true }), request), true);
    result.assertions.sameCommandRetryAndNoOptimisticProfileMutation = true;

    await page.evaluate(() => window.qa.setMeal({ v: 1, kind: 'grog', ticks: 54000 }));
    const active = page.locator('.fresh-meal-active');
    assert.match(await active.innerText(), spec.locale === 'es' ? /15:00.*reemplazará/ : /15:00.*replace it/);
    await page.evaluate(() => window.qa.setMeal({ v: 1, kind: 'grog', ticks: 3599 }));
    assert.match(await active.innerText(), /01:00/);
    result.assertions.replacementNoticeAndCountdown = true;

    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator('[data-meal="heartyBiscuit"]').scrollIntoViewIfNeeded();
    const bottomBounds = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, documentWidth: document.documentElement.scrollWidth }; });
    assert(bottomBounds.scrollTop > 0 && bottomBounds.right <= spec.width && bottomBounds.bottom <= spec.height && bottomBounds.documentWidth <= spec.width,
      `${spec.name} bottom scroll bounds invalid: ${JSON.stringify(bottomBounds)}`);
    result.assertions.bottomRecipeReachableWithScrollablePanel = bottomBounds;
    const bottomShot = `${spec.name}-${runTag}-bottom.png`;
    await page.screenshot({ path: resolve(out, bottomShot), animations: 'disabled' }); result.screenshots.push(bottomShot);
    assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.externalRequests, []);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, error: error.message });
    const failShot = `${spec.name}-${runTag}-failure.png`;
    try { await page.screenshot({ path: resolve(out, failShot), fullPage: true }); result.screenshots.push(failShot); } catch {}
  } finally {
    evidence.screenshots.push(...result.screenshots); await context.close();
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, error: result.error?.split('\n')[0] }));
  }
}

try {
  for (const spec of specs) await run(spec);
} finally {
  await browser.close(); await new Promise(resolveDone => server.close(resolveDone));
  evidence.completedAt = new Date().toISOString();
  const evidenceFile = resolve(out, `evidence-${runTag}.json`);
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ evidence: evidenceFile, screenshots: evidence.screenshots.length, failures: evidence.failures.length }));
}
process.exitCode = evidence.failures.length ? 1 : 0;

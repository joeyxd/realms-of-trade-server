#!/usr/bin/env node
// Local-only layout acceptance for the real WorkshopPanel in normal and rotated stages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, 'docs/delivery/inv03-existing-backpacks/layout');
await mkdir(out, { recursive: true });
const firstExisting = paths => paths.find(path => fs.existsSync(path)) || paths[0];
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || firstExisting([
  resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
  resolve(repo, '..', 'realms-of-trade-server', '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
]));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const specs = [
  { name: 'desktop-es', locale: 'es', width: 1280, height: 900, mobile: false },
  { name: 'desktop-en', locale: 'en', width: 1280, height: 900, mobile: false },
  { name: 'rotated-es', locale: 'es', width: 390, height: 844, mobile: true, rotated: true },
  { name: 'rotated-en', locale: 'en', width: 390, height: 844, mobile: true, rotated: true },
];
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = { schema: 'mn.inv03.workshop-layout.local.v1', generatedAt: new Date().toISOString(),
  purpose: 'Exercise the real WorkshopPanel and stage.js using a disposable local profile fixture.',
  scope: 'Local DOM/layout only; no game host, account, public endpoint, or persistent player writes.',
  outputDirectory: out, viewports: [], failures: [], screenshots: [] };
const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };

const profile = newProfile();
profile.lvl = 5;
profile.attr = { v: 1, carga: 4, re: 1 };
profile.carry = { v: 1, backpack: 1 };
profile.eco.pack.cap = 30;
profile.eco.pack.maxMass = 70;
profile.eco.pack.goods = { madera: 4, lona: 5, piedra: 1 };
assert(sanitizeProfile(profile), 'Carga 4 tier 1 fixture must pass the real profile sanitizer');
const fixtureProfile = sanitizeProfile(profile);

const pageHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>INV03 workshop layout QA</title><link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/kit.css"><link rel="stylesheet" href="/styles/workshop.css"><style>body{background:#102327}#stage{position:fixed;left:0;top:0;width:100vw;height:100dvh;overflow:hidden;container-type:size;container-name:stage}#ui{position:fixed;inset:0;pointer-events:none}#ui>*{pointer-events:auto}</style></head><body><div id="stage"><main id="ui"></main></div><script type="module">
import { WorkshopPanel } from '/src/ui/workshop.js';
import { stage } from '/src/ui/stage.js';
const profile = ${JSON.stringify(fixtureProfile)};
const rotated = new URLSearchParams(location.search).has('rotated');
stage.configure({ enabled: () => rotated }); stage.update();
const context = { profile };
const panel = new WorkshopPanel({ parent: document.querySelector('#ui'), profile: () => profile,
  context: () => context, enabled: () => true, submit: () => true,
  getLocale: () => document.documentElement.lang });
window.qa = { panel, setLocale(locale) { document.documentElement.lang = locale; panel.update(); },
  layout() { const r = panel.root.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
    scrollTop:panel.root.scrollTop,scrollHeight:panel.root.scrollHeight,clientHeight:panel.root.clientHeight,
    documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
    viewportWidth:innerWidth,viewportHeight:innerHeight,stageWidth:stage.w,stageHeight:stage.h,rotated:stage.rotated,
    title:panel.$('[data-title]').getBoundingClientRect().toJSON(),upgrade:panel.$('[data-upgrade]').getBoundingClientRect().toJSON()}; } };
panel.open();
</script></body></html>`;

const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { res.writeHead(200, { 'content-type': mime['.html'], 'cache-control': 'no-store' }); res.end(pageHtml); return; }
  const file = resolve(repo, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(repo + sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
const port = server.address().port;
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });

async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], consoleErrors: [], externalRequests: [], assertions: {}, screenshots: [] };
  evidence.viewports.push(result);
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
    isMobile: spec.mobile, hasTouch: spec.mobile });
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
    const panel = page.locator('.workshop-panel');
    const before = await page.evaluate(() => window.qa.layout());
    assert.equal(before.rotated, !!spec.rotated, `${spec.name} stage orientation mismatch`);
    assert(before.x >= 0 && before.y >= 0 && before.right <= spec.width && before.bottom <= spec.height
      && before.documentWidth <= spec.width && before.documentHeight <= spec.height,
      `${spec.name} initial workshop overflow: ${JSON.stringify(before)}`);
    if (spec.rotated) assert(before.scrollHeight > before.clientHeight, `${spec.name} workshop content is not scrollable`);
    assert.equal(await panel.locator('[data-carry-tier]').innerText(), '2 / 3');
    assert.match(await panel.locator('[data-volume]').innerText(), /24\s*\/\s*30\s*uV/);
    assert.match(await panel.locator('[data-mass]').innerText(), /70\s*uM/);
    assert.equal(await panel.locator('[data-upgrade]').isEnabled(), true, 'funded tier 2 upgrade must be available');
    const beforeShot = `${spec.name}-${runTag}-before.png`;
    await panel.screenshot({ path: resolve(out, beforeShot), animations: 'disabled' }); result.screenshots.push(beforeShot);

    const upgrade = panel.locator('[data-upgrade]');
    await upgrade.scrollIntoViewIfNeeded();
    const after = await page.evaluate(() => window.qa.layout());
    if (spec.rotated) assert(after.scrollTop > 0, `${spec.name} upgrade action did not scroll into view`);
    assert(after.x >= 0 && after.y >= 0 && after.right <= spec.width && after.bottom <= spec.height
      && after.documentWidth <= spec.width && after.documentHeight <= spec.height,
      `${spec.name} scrolled workshop overflow: ${JSON.stringify(after)}`);
    for (const [name, rect] of [['title', after.title], ['upgrade', after.upgrade]]) {
      assert(rect.x >= after.x && rect.y >= after.y && rect.right <= after.right && rect.bottom <= after.bottom,
        `${spec.name} ${name} escaped workshop panel bounds`);
      assert(rect.x >= 0 && rect.y >= 0 && rect.right <= spec.width && rect.bottom <= spec.height,
        `${spec.name} ${name} is outside viewport after scroll`);
    }
    const scrollShot = `${spec.name}-${runTag}-upgrade.png`;
    await panel.screenshot({ path: resolve(out, scrollShot), animations: 'disabled' }); result.screenshots.push(scrollShot);
    result.assertions.initialBounds = before; result.assertions.scrolledBounds = after;
    result.assertions.localizedTierAndFundedUpgrade = true;
    assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.externalRequests, []);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, error: error.message });
    const failureShot = `${spec.name}-${runTag}-failure.png`;
    try { await page.screenshot({ path: resolve(out, failureShot), fullPage: true }); result.screenshots.push(failureShot); } catch {}
  } finally {
    evidence.screenshots.push(...result.screenshots); await context.close();
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, error: result.error?.split('\n')[0] }));
  }
}

try {
  for (const spec of specs) await run(spec);
} finally {
  await browser.close(); await new Promise(done => server.close(done));
  evidence.completedAt = new Date().toISOString();
  const evidenceFile = resolve(out, `evidence-${runTag}.json`);
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ evidence: evidenceFile, screenshots: evidence.screenshots.length, failures: evidence.failures.length }));
}
process.exitCode = evidence.failures.length ? 1 : 0;

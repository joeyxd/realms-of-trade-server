#!/usr/bin/env node
// Local visual fixture for CharacterScreen provision guidance and timed carry comfort.
// It uses a disposable client profile only; no game host, account, or gameplay command is involved.
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
const outArg = process.argv.indexOf('--out');
const out = resolve(outArg >= 0 ? process.argv[outArg + 1]
  : process.env.MN_QA_OUT || resolve(repo, 'docs/delivery/food-item-completion/local/character'));
assert(out.startsWith(repo + sep) || process.env.MN_QA_OUT || outArg >= 0,
  'output path must be explicit or inside the repository');
await mkdir(out, { recursive: true });

const specs = [
  { name: 'desktop-es', locale: 'es', width: 1280, height: 900, mobile: false },
  { name: 'desktop-en', locale: 'en', width: 1280, height: 900, mobile: false },
  { name: 'mobile-es', locale: 'es', width: 390, height: 844, mobile: true },
  { name: 'mobile-en', locale: 'en', width: 390, height: 844, mobile: true },
];
const selected = process.env.MN_PROVISION_VIEWPORT;
const runs = selected ? specs.filter(spec => spec.name === selected) : specs;
assert(runs.length, `unknown MN_PROVISION_VIEWPORT: ${selected}`);
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = {
  schema: 'mn.provision-character.local.v1', generatedAt: new Date().toISOString(),
  purpose: 'Exercise real CharacterScreen render, goodsHtml, and part methods with a disposable profile fixture.',
  scope: 'Local serial Chromium over a disposable localhost static server only. No external service, account, or persistent player writes. Fixture state changes model saved meal values; they do not send gameplay commands.',
  viewports: [], failures: [], screenshots: [],
};
const mime = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const pageHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Provision CharacterScreen QA</title>
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/kit.css"><link rel="stylesheet" href="/styles/panels.css"><link rel="stylesheet" href="/styles/character.css"><link rel="stylesheet" href="/styles/attributes.css"><link rel="stylesheet" href="/styles/i18n.css">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#stage{position:fixed;inset:0;width:100vw;height:100dvh;overflow:hidden;container-type:size;container-name:stage;background:#081521}#charpanel{display:flex;justify-content:center;align-items:center;padding:0}.qa-label{position:fixed;left:8px;bottom:4px;color:#9bb3c6;font:11px system-ui,sans-serif;z-index:40;pointer-events:none}</style>
<script type="importmap">{"imports":{"gsap":"/qa/gsap.js","three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><div id="stage"><div id="charpanel"></div><small class="qa-label">Disposable local CharacterScreen fixture</small></div>
<script>const qaLocale=new URLSearchParams(location.search).get('locale')==='en'?'en':'es';window.__mnLanguage=qaLocale;document.documentElement.lang=qaLocale;window.__qaBootError='';addEventListener('error',e=>{window.__qaBootError=e.message||String(e.error||'module error')});addEventListener('unhandledrejection',e=>{window.__qaBootError=String(e.reason||'module rejection')});</script>
<script type="module">
import { CharacterScreen } from '/src/ui/characterScreen.js';
import { stage } from '/src/ui/stage.js';
stage.configure({ enabled: () => innerWidth < 600 }); stage.update();
import { newProfile } from '/src/sim/systems/inventory.js';
const profile = newProfile();
profile.surv = { v: 1, sat: 46, hyd: 32 };
profile.carry = { v:1, backpack:2 };
profile.attr = { v:1, carga:0, re:0 };
profile.eco.pack.cap = 42;
profile.eco.pack.maxMass = 50;
Object.assign(profile.eco.pack.goods, { pescado:1, fruta:1, harina:1, galleta:1, ron:1, agua:1, cana:1, especias:1, coco:1, resina:1, tronco:1, madera:1, hierro:5 });
const root = document.querySelector('#charpanel');
const screen = new CharacterScreen(root, {
  send: () => {}, profile: () => profile,
  stats: () => ({ level:profile.lvl, atk:10, def:2, maxHp:100, speed:6.5, cdr:0, weapon:0, potions:profile.pot, gold:profile.gold }),
  vitals: () => ({ name:'Provisiones QA', skin:0, hp:80, maxHp:100, guard:30, guardMax:60,
    xp:25, xpNext:100, level:1, needs:1, sat:profile.surv.sat, hyd:profile.surv.hyd, needPen:0.08 }),
  slots: () => ({}), tools: () => profile.tools, nearby: () => [],
  backpack: () => ({ pack:profile.eco.pack, pendingGoods:{} }),
  attributeEnabled: () => false, locale:() => document.documentElement.lang,
  figureAnimated:() => false, reducedMotion:() => true,
});
screen.tab = 'gear'; screen.isOpen = true; root.hidden = false; screen.render();
window.qa = {
  profile, screen,
  setMeal(kind) {
    if (kind) profile.meal = {v:1,kind,ticks:54000}; else delete profile.meal;
    screen.render();
  },
  openGuide() { root.querySelector('.provision-guide > summary')?.click(); },
  read() {
    const weight = root.querySelector('.ch-right-top .ch-meter:has(.is-weight) b');
    const meters = [...root.querySelectorAll('.ch-right-top .ch-meter b')].map(el => el.textContent.trim());
    const guide = root.querySelector('.provision-guide');
    return { weight:weight?.textContent.trim(), meters, guideOpen:!!guide?.open,
      guideRows:guide?.querySelectorAll('li').length || 0, guideText:guide?.innerText || '',
      screen:root.querySelector('.ch-screen')?.className || '', documentWidth:document.documentElement.scrollWidth,
      viewportWidth:innerWidth, viewportHeight:innerHeight };
  },
  update() { screen.render(); },
  scrollGuideEnd() { const top = root.querySelector('.ch-right-top');
    const box = getComputedStyle(top).overflowY === 'visible' ? root.querySelector('.ch-right') : top;
    box.scrollTop = box.scrollHeight; },
};
</script></body></html>`;

const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    res.writeHead(200, { 'content-type': mime['.html'], 'cache-control':'no-store' }); res.end(pageHtml); return;
  }
  if (pathname === '/qa/gsap.js') {
    res.writeHead(200, { 'content-type':mime['.js'], 'cache-control':'no-store' });
    res.end('export const gsap={fromTo(){},from(){},to(){},timeline(){return {to(){return this},fromTo(){return this},kill(){}}}};'); return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  const file = resolve(repo, `.${decoded}`);
  if (!file.startsWith(repo + sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type':mime[extname(file)] || 'application/octet-stream', 'cache-control':'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
const port = server.address().port;
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath:resolve(process.env.MN_BROWSER) } : { channel:'chrome' }),
  headless:true, args:['--use-gl=angle','--use-angle=default','--enable-webgl','--ignore-gpu-blocklist'] });

const shot = async (page, result, suffix) => {
  const file = resolve(out, `${result.name}-${suffix}-${runTag}.png`);
  await page.screenshot({ path:file }); result.screenshots.push(file);
};
const comfortNumber = value => Number(String(value || '').split('/').at(-1).trim().replace(',', '.'));

async function run(spec) {
  const result = { ...spec, status:'running', errors:[], consoleErrors:[], externalRequests:[], assertions:{}, screenshots:[] };
  evidence.viewports.push(result);
  const context = await browser.newContext({ viewport:{width:spec.width,height:spec.height}, deviceScaleFactor:1,
    isMobile:spec.mobile, hasTouch:spec.mobile });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(String(error?.stack || error)));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && Number(url.port) === port) return route.continue();
    result.externalRequests.push(url.href); return route.abort();
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/?locale=${spec.locale}`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => !!window.qa?.screen || !!window.__qaBootError, null, { timeout:10000 });
    if (result.errors.length || await page.evaluate(() => !!window.__qaBootError))
      throw new Error(`${spec.name}: module boot failed: ${result.errors[0] || await page.evaluate(() => window.__qaBootError)}`);
    await page.waitForFunction(() => !!window.qa?.screen && document.querySelector('.ch-screen.is-sheet.ch-on-gear'), null, { timeout:10000 });
    const guide = page.locator('.provision-guide');
    await guide.waitFor({ state:'visible' });
    const state = async () => page.evaluate(() => window.qa.read());
    const value = async () => comfortNumber((await state()).weight);
    const normal = await state();
    assert.equal(normal.guideRows, 12, `${spec.name}: provision guide does not include the 12 supported goods`);
    assert.equal(await value(), 40, `${spec.name}: normal comfortable load should be 40`);
    assert(normal.meters.some(text => text.includes('/ 42')), `${spec.name}: volume capacity is not shown`);
    assert(normal.documentWidth <= spec.width, `${spec.name}: document overflows horizontally`);
    await shot(page, result, 'normal-meters');
    // Scroll the inventory region in its logical coordinates (the touch stage is rotated).
    await page.evaluate(() => { const guide = document.querySelector('.provision-guide');
      const box = document.querySelector('.ch-right-top'); box.scrollTop = guide.offsetTop - box.offsetTop; });
    await guide.locator('summary').click({ timeout: 5000 });
    assert.equal((await state()).guideOpen, true, `${spec.name}: guide did not open`);
    await shot(page, result, 'normal-guide-open');

    await page.evaluate(() => window.qa.setMeal('heartyBiscuit'));
    const biscuit = await state();
    assert.equal(comfortNumber(biscuit.weight), 50, `${spec.name}: biscuit should add 10 comfortable units`);
    assert.equal(biscuit.guideOpen, true, `${spec.name}: actual CharacterScreen.part did not preserve open guide on update`);
    assert.match(biscuit.guideText, spec.locale === 'es' ? /Galleta reforzada/ : /Reinforced biscuit/);
    await page.evaluate(() => { document.querySelector('.ch-right-top').scrollTop = 0; });
    await shot(page, result, 'hearty-biscuit-plus-10');

    await page.evaluate(() => window.qa.setMeal('roastFish'));
    const replacement = await state();
    assert.equal(comfortNumber(replacement.weight), 40, `${spec.name}: replacing biscuit should remove its carry bonus`);
    assert.equal(replacement.guideOpen, true, `${spec.name}: guide closed after meal replacement update`);
    await shot(page, result, 'replacement-no-bonus');

    await page.evaluate(() => window.qa.scrollGuideEnd());
    await shot(page, result, 'guide-end');
    result.assertions = {
      guideGoods:normal.guideRows, localized:spec.locale,
      ordinaryComfort:40, heartyBiscuitComfort:50, replacementComfort:40,
      guideOpenPreservedAcrossPartUpdate:true, volumeAndWeightMetersVisible:true,
      screenshots:result.screenshots.length,
    };
    if (result.errors.length || result.consoleErrors.length || result.externalRequests.length)
      throw new Error(`${spec.name}: browser errors or external requests: ${JSON.stringify({errors:result.errors,consoleErrors:result.consoleErrors,externalRequests:result.externalRequests})}`);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport:spec.name, error:result.error });
    try { await shot(page, result, 'failure'); } catch { /* Retain the original assertion. */ }
  } finally {
    evidence.screenshots.push(...result.screenshots); await context.close();
    console.log(JSON.stringify({ viewport:spec.name, status:result.status, error:result.error?.split('\n')[0] }));
  }
}

try {
  for (const spec of runs) await run(spec);
} finally {
  await browser.close(); await new Promise(done => server.close(done));
  evidence.completedAt = new Date().toISOString();
  const file = resolve(out, `evidence-${runTag}.json`);
  await writeFile(file, `${JSON.stringify(evidence,null,2)}\n`);
  console.log(JSON.stringify({ evidence:file, screenshots:evidence.screenshots.length, failures:evidence.failures.length }));
}
process.exitCode = evidence.failures.length ? 1 : 0;

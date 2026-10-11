#!/usr/bin/env node
// Crafting menu QA: TAB opens it away from the bench, both stone tools craft by hand from raw logs (3 troncos + 2 piedras),
// the wood recipe stays at the bench, and every viewport keeps the panel and its controls on screen. Screenshots in ES and EN.
// Usage: node tools/qa-crafting.mjs   (MN_CRAFT_VIEWPORT=desktop-1280x720 to run one viewport)
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';

const out = resolve('docs/delivery/crafting-ui-v1');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const evidence = { build: GAME.version, generatedAt: new Date().toISOString(), viewports: [], failures: [] };
const check = (ok, text) => { if (!ok) throw new Error(text); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, touch: false },
  { name: 'mobile-844x390', width: 844, height: 390, touch: true },
  { name: 'portrait-390x844', width: 390, height: 844, touch: true },
];
const browser = await chromium.launch({ headless: true,
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });

async function routes(page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
}
function relocate(server, e, p) {
  const c = server.world.ecs;
  c.x[e] = p.x; c.y[e] = p.y; c.z[e] = p.z;
  c.vx[e] = c.vz[e] = c.kbx[e] = c.kbz[e] = c.moveMag[e] = 0;
  c.dashT[e] = -1; c.dashBuffer[e] = c.castK[e] = c.castLock[e] = c.atkStage[e] = 0;
  c.regenT[e] = 100;
  server.broadcastSnapshot();
}
async function position(page, server, e, p) {
  relocate(server, e, p);
  await page.waitForFunction(({ x, y, z }) => { const m = window.__mn, c = m.client.pred.ecs, e = m.client.youLocal;
    return Math.hypot(c.x[e] - x, c.y[e] - y, c.z[e] - z) < .65 && Math.hypot(m.ps.x - x, m.ps.y - y, m.ps.z - z) < .65; }, p, { timeout: 20000 });
}
async function join(page, port) {
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing'
    && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn.client.resources?.bench, null, { timeout: 30000 });
}
async function openMenu(page, spec) {
  if (spec.touch) await page.locator('#hud-craft').tap({ force: true });
  else await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__mn.panels.workbench.active);
  await page.evaluate(() => document.fonts.ready); await pause(400);
}
async function shot(page, result, suffix) {
  const file = resolve(out, `${result.name}-${suffix}.png`);
  await page.screenshot({ path: file }); result.screenshots.push(file);
}
async function layout(page) {
  return page.evaluate(() => {
    const inside = (selector) => { const el = document.querySelector(selector); if (!el || !el.offsetParent) return true;
      const r = el.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
    const portrait = innerWidth <= 600;
    return { main: portrait || inside('.cr-main'), confirm: inside('.wb-confirm'), close: inside('.wb-close'),
      overflowX: (() => { const p = document.querySelector('.workbench-panel'); return p.scrollWidth > p.clientWidth + 1; })() };
  });
}
async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], screenshots: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1,
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-crafting-${spec.name}`, chat: { enabled: false }, log() {} });
  let context, page;
  try {
    const port = await host.listen(), server = host.game.server;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    page = await context.newPage(); await routes(page);
    page.on('pageerror', (error) => result.errors.push(String(error.stack || error)));
    page.on('console', (message) => { if (message.type() === 'error' && !/fonts\.g/.test(message.text())) result.errors.push(message.text()); });
    await join(page, port);
    const e = await page.evaluate(() => window.__mn.client.youServer);
    const bench = server.world.resources.bench;
    // Away from the bench, with a varied backpack: enough logs and stones for one stone tool, not for both.
    // A gathering node is guaranteed land (no dock/deck); pick one well outside the bench radius.
    const away = [...server.world.resources.nodes.values()].find((n) => n.kind === 'stone' && Math.hypot(n.x - bench.x, n.z - bench.z) > 8);
    check(!!away, 'no land fixture away from the bench');
    await position(page, server, e, { x: away.x, y: away.y, z: away.z });
    const profile = server.world.profiles.get(e);
    profile.eco.pack = { cap: 30, goods: { madera: 1, piedra: 3, tronco: 4, pescado: 1, fruta: 3, agua: 2 } };
    server.world.profileDirty.add(e);
    await page.waitForFunction(() => window.__mn.client.profile?.eco?.pack?.goods?.fruta === 3, null, { timeout: 20000 });
    await pause(500);
    await openMenu(page, spec);
    check(await page.locator('.wb-confirm').isEnabled(), 'stone axe should be craftable by hand away from the bench');
    result.layout = await layout(page);
    check(result.layout.main && result.layout.confirm && result.layout.close && !result.layout.overflowX, `layout off screen: ${JSON.stringify(result.layout)}`);
    await shot(page, result, '01-axe-es');
    // Landscape phones: the backpack is a drawer toggled from the header (author decision, 2026-10-10).
    if (await page.locator('.cr-inv-toggle').isVisible()) {
      await page.locator('.cr-inv-toggle').tap({ force: true });
      await page.waitForFunction(() => document.querySelector('.workbench-panel.inv-open'), null, { timeout: 5000 });
      check(await page.locator('.cr-inv').isVisible(), 'inventory drawer did not open');
      await shot(page, result, '01b-inventory-drawer');
      await page.locator('.cr-inv-close').tap({ force: true });
      await page.waitForFunction(() => !document.querySelector('.workbench-panel.inv-open'), null, { timeout: 5000 });
    }
    await page.evaluate(() => { document.documentElement.lang = 'en'; window.__mn.panels.workbench.update(); });
    await pause(150); await shot(page, result, '02-axe-en');
    await page.evaluate(() => { document.documentElement.lang = 'es'; window.__mn.panels.workbench.update(); });
    // The pickaxe is a hand recipe too (author, 2026-10-10); the wood recipe is the one that needs the bench.
    await page.locator('[data-recipe="pico_piedra"]').click({ force: true });
    check(await page.locator('.wb-confirm').isEnabled(), 'stone pickaxe should be craftable by hand away from the bench');
    await shot(page, result, '03-pickaxe-far');
    await page.locator('[data-cat="building"]').click({ force: true }); await pause(100);
    if (await page.locator('[data-recipe="madera"]').count()) {
      await page.locator('[data-recipe="madera"]').click({ force: true });
      check(await page.locator('.wb-confirm').isDisabled(), 'wood must stay gated away from the bench');
    }
    await page.locator('[data-cat="food"]').click({ force: true }); await pause(100);
    await shot(page, result, '04-empty-tab');
    await page.locator('[data-cat="tools"]').click({ force: true });
    await page.locator('[data-recipe="hacha_piedra"]').click({ force: true });
    const before = profile.eco.tradeRev;
    if (spec.touch) await page.locator('.wb-confirm').tap(); else await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__mn.client.profile.tools?.axe === 1 && !window.__mn.panels.workbench.pending, null, { timeout: 20000 });
    check(profile.tools.axe === 1 && profile.eco.tradeRev === before + 1 && profile.eco.pack.goods.tronco === 1 && profile.eco.pack.goods.piedra === 1, 'hand craft did not commit on the server');
    await pause(200); await shot(page, result, '05-crafted');
    // At the bench, F opens on the wood recipe with its batch controls.
    if (spec.touch) await page.locator('.wb-close').tap(); else await page.keyboard.press('Tab');
    await position(page, server, e, bench);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Preparar', null, { timeout: 20000 });
    if (spec.touch) await page.locator('#touch .t-act').tap({ force: true }); else await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__mn.panels.workbench.active && window.__mn.panels.workbench.recipe === 'madera');
    await page.locator('[data-qty="max"]').click({ force: true }); await pause(150);
    check(await page.locator('.wb-confirm').isEnabled(), 'wood batch should be ready at the bench');
    result.benchLayout = await layout(page);
    await shot(page, result, '06-bench-wood');
    check(result.errors.length === 0, `browser errors: ${result.errors.join('; ')}`);
    result.status = 'passed'; console.log(`${spec.name}: passed`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) {
      result.debug = await page.evaluate(() => { const m = window.__mn, p = m?.panels.workbench;
        return { active: p?.active, recipe: p?.recipe, cat: p?.cat, pending: p?.pending ? { ...p.pending, command: p.pending.command } : null, lastResult: p?.lastResult,
          resourcePending: m?.resources.pending, tools: m?.client?.profile?.tools, pack: m?.client?.profile?.eco?.pack, focus: document.activeElement?.outerHTML?.slice(0, 120) }; }).catch((e) => String(e));
      await shot(page, result, 'failure').catch(() => {});
    }
    console.log(`${spec.name}: failed: ${error.message}`);
  } finally { if (context) await context.close(); await host.close(); }
}
try {
  const selected = process.env.MN_CRAFT_VIEWPORT ? specs.filter((s) => s.name === process.env.MN_CRAFT_VIEWPORT) : specs;
  check(selected.length > 0, 'unknown viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.status = evidence.failures.length ? 'failed' : 'passed';
await writeFile(resolve(out, process.env.MN_CRAFT_VIEWPORT ? `${process.env.MN_CRAFT_VIEWPORT}.json` : 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, results: evidence.viewports.map(({ name, status, failure }) => ({ name, status, failure: failure?.split('\n')[0] })) }));
if (evidence.failures.length) process.exitCode = 1;

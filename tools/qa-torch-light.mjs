#!/usr/bin/env node
// Torch-in-crafting and projectile-light visual check: at midnight, craft and light the hand torch from the crafting
// menu (TAB), read it back in the fire panel (N), then stand in the practice ring so the cannon fires and capture its
// shots with and without their moving light. Disposable memory-backed GameHost/account only; no SQL or production.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { newFire } from '../src/sim/economy/fire.js';
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Set MN_QA_ALLOW_BROWSER=1 to launch this local browser harness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || '.scratch/qa-torch-light');
await mkdir(out, { recursive: true });
const firstExisting = (paths) => paths.find((path) => fs.existsSync(path)) || paths[0];
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || firstExisting([
  resolve(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'), resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
]))).href);
const threeRoot = firstExisting([resolve(repo, 'node_modules/three'), resolve(sibling, 'node_modules/three')]);
const gsapRoot = resolve(process.env.MN_GSAP || resolve(sibling, '.scratch/gsap-local/package'));
const specs = [
  { name: 'torch-desktop-es', width: 1280, height: 720, touch: false, quality: 'high', locale: 'es' },
  { name: 'torch-phone-en', width: 844, height: 390, touch: true, quality: 'low', locale: 'en' },
].filter((spec) => !process.env.MN_QA_VIEWPORT || spec.name.includes(process.env.MN_QA_VIEWPORT));
const ACCOUNT = 'b2f6a0d4-5e3c-4b71-9a8e-7c0d1e2f3a40';
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = { generatedAt: new Date().toISOString(), viewports: [], failures: [] };

async function waitHealthy(port) {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).status === 200) return; } catch {} await pause(100); }
  throw new Error('GameHost did not become healthy');
}
async function localRoutes(page) {
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}
function relocate(world, server, entity, x, z) {
  const ecs = world.ecs;
  ecs.x[entity] = x; ecs.z[entity] = z; ecs.y[entity] = world.map.groundAt(x, z);
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  server.broadcastSnapshot();
}

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], screenshots: [], checks: {} };
  evidence.viewports.push(result);
  const store = createMemoryStore();
  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT}`; profile.fire = newFire(); profile.eco.pack.goods = { madera: 1, tronco: 4 };
  await store.initializeProfile(ACCOUNT, profile);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true, store,
    worldId: `qa-torch-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true, economicOperations: true,
    fireOperations: true, saveSecret: `qa-torch-${spec.name}`, chat: { enabled: false }, log() {} });
  let context, page;
  const shot = async (label) => { const file = `${spec.name}-${runTag}-${label}.jpg`; await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 86 }); result.screenshots.push(file); };
  try {
    const port = await host.listen(); await waitHealthy(port);
    const server = host.game.server, world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage();
    page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
    await localRoutes(page);
    await page.goto(`http://127.0.0.1:${port}/?debug&q=${spec.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.evaluate((locale) => { document.documentElement.lang = locale; }, spec.locale);
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
    const entity = await page.evaluate(() => window.__mn.client.youServer);
    world.economy.hours = 24; world.economy.acc = 0; // midnight
    await page.waitForFunction(() => window.__mn.world.lighting.cur.sunI <= 0.02 && window.__mn.client.fire?.enabled === true, null, { timeout: 20000 });

    result.stage = 'crafting-torch';
    await page.evaluate(() => window.__mn.panels.workbench.open({ recipe: 'antorcha' }));
    await page.waitForFunction(() => window.__mn.panels.workbench.active, null, { timeout: 5000 });
    await pause(400);
    result.checks.menu = await page.evaluate(() => {
      const root = document.querySelector('.workbench-panel');
      return { title: root.querySelector('[data-output-name]').textContent, needs: root.querySelector('[data-needs]').textContent,
        where: root.querySelector('[data-where]').textContent, confirm: root.querySelector('.wb-confirm').disabled,
        torchRow: !!root.querySelector('[data-recipe="antorcha"]'), feedback: root.querySelector('[data-feedback]').textContent };
    });
    check(result.checks.menu.torchRow && !result.checks.menu.confirm, `torch not craftable from the menu: ${JSON.stringify(result.checks.menu)}`);
    await shot('01-crafting-torch-ready');
    // Layout reference: the stone axe uses the same detail grid (three stats, motto, feedback).
    await page.locator('[data-recipe="hacha_piedra"]').click(); await pause(250); await shot('01b-crafting-axe-reference');
    await page.locator('[data-recipe="antorcha"]').click(); await pause(250);
    await page.locator('.wb-confirm').click();
    await page.waitForFunction(() => window.__mn.client.fire.slots.some((s) => s.key === 'hand' && s.seconds > 0 && s.lit), null, { timeout: 15000 });
    await pause(500);
    result.checks.crafted = await page.evaluate(() => ({ feedback: document.querySelector('.workbench-panel [data-feedback]').textContent,
      planks: window.__mn.client.profile.eco.pack.goods.madera || 0, logs: window.__mn.client.profile.eco.pack.goods.tronco || 0 }));
    check(result.checks.crafted.planks === 0 && result.checks.crafted.logs === 4, `the torch must spend exactly one plank: ${JSON.stringify(result.checks.crafted)}`);
    await shot('02-crafting-torch-lit');

    result.stage = 'fire-panel';
    await page.evaluate(() => { window.__mn.panels.workbench.close(); window.__mn.panels.firePanel.open({ ship: '', part: 'hand', kind: 'handTorch' }); });
    await pause(300);
    result.checks.panel = await page.evaluate(() => { const r = document.querySelector('.fire-panel').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, needHidden: document.querySelector('.fire-need').hidden,
        toggle: document.querySelector('.fire-toggle').textContent, viewport: [innerWidth, innerHeight] }; });
    check(result.checks.panel.needHidden, 'a burning torch shows no fuel card');
    await shot('03-fire-panel-burning');
    // Put the torch out from the panel so only the projectiles light the night below.
    await page.locator('.fire-toggle').click();
    await page.waitForFunction(() => window.__mn.client.fire.slots.some((s) => s.key === 'hand' && s.seconds > 0 && !s.lit), null, { timeout: 15000 });
    await pause(300); await shot('03b-fire-panel-out');
    await page.evaluate(() => window.__mn.panels.firePanel.close());

    result.stage = 'projectile-light';
    const ring = world.map.practice?.ring;
    check(ring, 'the map has no practice ring');
    relocate(world, server, entity, ring.x, ring.z);
    await page.waitForFunction(() => { const p = window.__mn.world.projectiles, g = p.glow, ps = window.__mn.ps;
      for (let i = 0; i < p.glowCount; i++) if (Math.hypot(g[i * 4] - ps.x, g[i * 4 + 2] - ps.z) < 7) return true; return false; }, null, { timeout: 30000, polling: 'raf' });
    result.checks.lit = await page.evaluate(() => ({ shots: window.__mn.world.projectiles.glowCount, lights: window.__mn.world.lights.shots ? 'on' : 'off' }));
    await shot('04-cannonball-lit');
    // Same scene without the moving light, for comparison (render-only switch; restored right after).
    await page.evaluate(() => { const L = window.__mn.world.lights; L._setShots = L.setShots; L.setShots = function () { this.shots = null; }; });
    await page.waitForFunction(() => { const p = window.__mn.world.projectiles, g = p.glow, ps = window.__mn.ps;
      for (let i = 0; i < p.glowCount; i++) if (Math.hypot(g[i * 4] - ps.x, g[i * 4 + 2] - ps.z) < 7) return true; return false; }, null, { timeout: 30000, polling: 'raf' });
    await shot('05-cannonball-without-light');
    await page.evaluate(() => { const L = window.__mn.world.lights; L.setShots = L._setShots; });
    check(!result.errors.length, `page errors: ${result.errors.join(' | ')}`);
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: String(error) });
    try { await shot(`failure-${result.stage}`); } catch {}
  } finally {
    await context?.close().catch(() => {}); try { await host.close(); } catch {}
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, ...(result.error ? { error: result.error.split('\n')[0] } : {}) }));
  }
}

const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try { for (const spec of specs) await run(browser, spec); } finally { await browser.close(); }
await writeFile(resolve(out, `evidence-${runTag}.json`), JSON.stringify(evidence, null, 2));
process.exitCode = evidence.failures.length ? 1 : 0;

#!/usr/bin/env node
// UI kit retheme tour: screenshots of the screens that only took the global tokens (title, HUD, pause, map, chat,
// market, dialog, touch controls) at desktop and landscape-phone sizes, with a console-error check.
// Usage: node tools/qa-ui-tour.mjs   (MN_TOUR_VIEWPORT=desktop-1280x720 to run one viewport)
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { TOWN_IDS } from '../src/data/towns.js';

const out = resolve('docs/delivery/ui-kit-v1/tour');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const evidence = { build: GAME.version, generatedAt: new Date().toISOString(), viewports: [], failures: [] };
const check = (ok, text) => { if (!ok) throw new Error(text); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'mobile-844x390', width: 844, height: 390, touch: true },
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
async function shot(page, result, suffix) {
  const file = resolve(out, `${result.name}-${suffix}.png`);
  await page.screenshot({ path: file }); result.screenshots.push(file);
}

async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], screenshots: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1,
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-tour-${spec.name}`, chat: { enabled: true }, log() {} });
  let context, page;
  try {
    const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    page = await context.newPage(); await routes(page);
    page.on('pageerror', (error) => result.errors.push(String(error.stack || error)));
    page.on('console', (message) => { if (message.type() === 'error' && !/fonts\.g/.test(message.text())) result.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.evaluate(() => document.fonts.ready); await pause(600);
    await shot(page, result, '01-title');
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && !window.__mn.st.paused, null, { timeout: 90000 });
    await pause(1500);
    await shot(page, result, '02-hud');
    // Map.
    await page.evaluate(() => window.__mn.panels.mapView.open()); await pause(500);
    await shot(page, result, '03-map');
    await page.evaluate(() => window.__mn.panels.mapView.close());
    // Dialog: stand next to the first titled NPC (the game closes a dialog when its speaker is out of reach).
    const npc = await page.evaluate(() => { for (const r of window.__mn.client.entities.values()) if (r.ready && r.title) return { id: r.id, x: r.r.x, y: r.r.y, z: r.r.z }; return null; });
    check(!!npc, 'no NPC in view for the dialog shot');
    const server = host.game.server, me = await page.evaluate(() => window.__mn.client.youServer), c = server.world.ecs;
    c.x[me] = npc.x + 1.6; c.y[me] = npc.y; c.z[me] = npc.z + 1.6; c.vx[me] = c.vz[me] = 0; server.broadcastSnapshot();
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.ps.x - x, window.__mn.ps.z - z) < 4, npc, { timeout: 20000 });
    await page.evaluate((id) => window.__mn.panels.dialog.show({ npc: 'merchant', ent: id, offer: [], ready: [], shop: false }, 'Madera, lona y víveres. El precio depende de lo que queda en el puerto.'), npc.id);
    await pause(500);
    await shot(page, result, '04-dialog');
    await page.evaluate(() => window.__mn.panels.dialog.hide());
    // Market.
    await page.evaluate((town) => window.__mn.panels.commercePanel.openMarket(town), TOWN_IDS[0]); await pause(1200);
    await shot(page, result, '05-market');
    await page.evaluate(() => window.__mn.panels.commercePanel.close());
    // Chat.
    await page.evaluate(() => window.__mn.panels.chatPanel.open()); await pause(400);
    await shot(page, result, '06-chat');
    await page.evaluate(() => { window.__mn.panels.chatPanel.close?.(); document.activeElement?.blur?.(); document.querySelector('#game')?.focus(); });
    await pause(200);
    // Pause / settings.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#pause').hidden, null, { timeout: 5000 }).catch(() => result.errors.push('pause menu did not open on Escape'));
    await pause(500);
    await shot(page, result, '07-pause');
    result.status = result.errors.length ? 'failed' : 'passed';
    if (result.errors.length) evidence.failures.push(`${spec.name}: ${result.errors[0].split('\n')[0]}`);
    console.log(`${spec.name}: ${result.status}`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) await shot(page, result, 'failure').catch(() => {});
    console.log(`${spec.name}: failed: ${error.message}`);
  } finally { if (context) await context.close(); await host.close(); }
}
try {
  const selected = process.env.MN_TOUR_VIEWPORT ? specs.filter((s) => s.name === process.env.MN_TOUR_VIEWPORT) : specs;
  check(selected.length > 0, 'unknown viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.status = evidence.failures.length ? 'failed' : 'passed';
await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, failures: evidence.failures }));
if (evidence.failures.length) process.exitCode = 1;

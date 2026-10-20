#!/usr/bin/env node
// Character screen QA (UI kit): C / the bag button open the sheet, the 3D figure renders and turns, a worn slot and a
// bag item show their details, Equipar commits on the server, every tab renders, ES and EN, and every viewport keeps
// the sheet on screen. Screenshots in docs/delivery/ui-kit-v1.
// Usage: node tools/qa-character.mjs   (MN_CHAR_VIEWPORT=desktop-1280x720 to run one viewport)
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { rollItem } from '../src/sim/items.js';

const out = resolve(process.env.MN_QA_OUT || 'docs/delivery/ui-kit-v1');
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
async function join(page, port) {
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  // Character-slots roster: create a character and enter with it (the picker intercepts Play since alpha.6x).
  await page.getByRole('button', { name: /Crear personaje/ }).first().click({ force: true });
  await page.getByRole('button', { name: /Crear y continuar/ }).first().click({ force: true });
  const go = page.getByRole('button', { name: /Jugar con este personaje/ }).first();
  await go.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Jugar con este personaje/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
  await go.click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing'
    && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
}
async function shot(page, result, suffix) {
  const file = resolve(out, `${result.name}-${suffix}.png`);
  await page.screenshot({ path: file }); result.screenshots.push(file);
}
const setLocale = (page, lang) => page.evaluate(async (l) => { (await import('/src/core/locale.js')).setLocale(l); }, lang);
const tap = (page, spec, selector) => (spec.touch ? page.locator(selector).first().tap({ force: true }) : page.locator(selector).first().click({ force: true }));
// Every region on screen, nothing spilling sideways, and the tab labels fit their tabs.
async function layout(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight, off = [];
    for (const sel of ['.ch-screen', '.ch-top', '.ch-left', '.ch-center', '.ch-right', '.ch-quick', '.ch-wide', '.ch-x', '.ch-tab']) {
      document.querySelectorAll(sel).forEach((el) => { if (!el.offsetParent && el !== document.querySelector('.ch-screen')) return;
        const r = el.getBoundingClientRect(); if (r.width && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) off.push(sel); });
    }
    const spill = [...document.querySelectorAll('.ch-tab > span:nth-child(2), .ch-slot-label, .ch-vital, .ch-stat, .ch-hints')].filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 2).map((el) => el.className);
    const tabs = document.querySelector('.ch-tabs');
    return { off, spill, tabsOverflow: !!tabs && tabs.scrollWidth > tabs.clientWidth + 2, kind: document.querySelector('.ch-screen')?.className };
  });
}
// Opaque pixels in the turntable canvas: the figure actually rendered.
const figurePixels = (page) => page.evaluate(() => {
  const c = document.querySelector('.ch-model canvas');
  if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
  return n;
});

function gear(profile) {
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const item = (o) => rollItem(rng, { ...o, uid: profile.uid++ });
  profile.eq.head = item({ lvl: 6, rarity: 1, slot: 'head' });
  profile.eq.chest = item({ lvl: 7, rarity: 2, slot: 'chest' });
  profile.eq.ring1 = item({ lvl: 5, rarity: 3, slot: 'ring' });
  profile.bag = [item({ lvl: 8, rarity: 3, slot: 'head' }), item({ lvl: 8, rarity: 4, slot: 'weapon' }), item({ lvl: 4, rarity: 0, slot: 'boots' }),
    item({ lvl: 6, rarity: 2, slot: 'boots' }), item({ lvl: 3, rarity: 1, slot: 'ring' }), item({ lvl: 9, rarity: 2, slot: 'chest' })];
  profile.tools = { ...(profile.tools || {}), axe: 1 };
  profile.eco.pack = { cap: profile.eco.pack.cap, goods: { tronco: 2, piedra: 3, pescado: 1, fruta: 2, agua: 1 } };
}

async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], screenshots: [], layouts: {} };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1,
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-character-${spec.name}`, chat: { enabled: false }, log() {} });
  let context, page;
  try {
    const port = await host.listen(), server = host.game.server;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    page = await context.newPage(); await routes(page);
    page.on('pageerror', (error) => result.errors.push(String(error.stack || error)));
    page.on('console', (message) => { if (message.type() === 'error' && !/fonts\.g/.test(message.text())) result.errors.push(message.text()); });
    await join(page, port);
    const e = await page.evaluate(() => window.__mn.client.youServer);
    const profile = server.world.profiles.get(e);
    gear(profile);
    server.world.profileDirty.add(e);
    await page.waitForFunction(() => window.__mn.client.profile?.bag?.length === 6 && window.__mn.client.profile.eq.ring1, null, { timeout: 20000 });
    await setLocale(page, 'es');

    // Open: C on a keyboard; the bag button on touch (it lands on Inventario), then the Personaje tab.
    if (spec.touch) { await page.locator('#hud-bag').tap({ force: true }); await page.waitForSelector('.ch-screen'); await tap(page, spec, '[data-tab="stats"]'); }
    else await page.keyboard.press('KeyC');
    await page.waitForFunction(() => window.__mn.panels.charPanel.isOpen && document.querySelector('.ch-screen.is-sheet.ch-on-stats'));
    await page.evaluate(() => document.fonts.ready); await pause(700);
    result.figure = await figurePixels(page);
    check(result.figure > 200, `the 3D figure did not render (${result.figure} opaque samples)`);
    result.layouts.character = await layout(page);
    check(!result.layouts.character.off.length && !result.layouts.character.tabsOverflow, `character sheet off screen: ${JSON.stringify(result.layouts.character)}`);
    await shot(page, result, '01-character-es');

    // Turntable: drag turns, the wheel zooms, reset brings it home.
    const box = await page.locator('.ch-model').boundingBox();
    const yaw0 = await page.evaluate(() => window.__mn.panels.charPanel.cam.yaw);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 90, { steps: 6 }); await page.mouse.up();
    if (!spec.touch) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -300); }
    await pause(250);
    const cam = await page.evaluate(() => ({ ...window.__mn.panels.charPanel.cam }));
    check(Math.abs(cam.yaw - yaw0) > 0.3, `drag did not turn the figure (${yaw0} → ${cam.yaw})`);
    if (!spec.touch) check(cam.zoom > 1, 'wheel did not zoom');
    await shot(page, result, '02-turntable');
    await tap(page, spec, '[data-view-reset]'); await pause(150);

    // A worn slot shows its card and what in the bag fits; a candidate pins with the comparison; Equipar commits.
    await tap(page, spec, '.ch-equip [data-slot="head"]'); await pause(150);
    check(await page.locator('.ch-item .ch-card').count() === 1, 'worn head card missing');
    check(await page.locator('.ch-cands [data-bag]').count() >= 1, 'no bag candidates for the head slot');
    await shot(page, result, '03-slot-head');
    const candidate = await page.locator('.ch-cands [data-bag]').first().getAttribute('data-bag');
    await tap(page, spec, `.ch-cands [data-bag="${candidate}"]`); await pause(150);
    check(await page.locator('.ch-card [data-act="equip"]').count() === 1, 'pinned bag item has no Equipar');
    await shot(page, result, '04-compare');
    await tap(page, spec, '.ch-card [data-act="equip"]');
    await page.waitForFunction((u) => window.__mn.client.profile.eq.head?.u === u, +candidate, { timeout: 20000 });
    check(profile.eq.head?.u === +candidate, 'equip did not commit on the server');

    // English.
    await setLocale(page, 'en'); await pause(300);
    check(/Character/i.test(await page.locator('[data-tab="stats"]').innerText()), 'tabs did not switch to English');
    result.layouts.english = await layout(page);
    check(!result.layouts.english.off.length && !result.layouts.english.tabsOverflow, `English sheet off screen: ${JSON.stringify(result.layouts.english)}`);
    await shot(page, result, '05-character-en');
    await setLocale(page, 'es'); await pause(200);

    // Every other tab renders on screen.
    for (const [tab, n] of [['gear', '06-inventory'], ['tattoo', '07-skills'], ['quests', '08-journal'], ['pearl', '09-pearls']]) {
      await tap(page, spec, `[data-tab="${tab}"]`); await pause(300);
      check(await page.evaluate((t) => window.__mn.panels.charPanel.tab === t, tab), `tab ${tab} did not open`);
      result.layouts[tab] = await layout(page);
      check(!result.layouts[tab].off.length, `${tab} off screen: ${JSON.stringify(result.layouts[tab])}`);
      await shot(page, result, n);
    }
    await tap(page, spec, '[data-tab="stats"]'); await pause(200);
    await tap(page, spec, '[data-all-stats]'); await pause(200);
    check(await page.locator('.ch-wide .cp-stats').count() === 1, 'all-stats view missing');
    await shot(page, result, '10-all-stats');
    await tap(page, spec, '.ch-x');
    await page.waitForFunction(() => !window.__mn.panels.charPanel.isOpen);
    check(result.errors.length === 0, `browser errors: ${result.errors.join('; ')}`);
    result.status = 'passed'; console.log(`${spec.name}: passed`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) await shot(page, result, 'failure').catch(() => {});
    console.log(`${spec.name}: failed: ${error.message}`);
  } finally { if (context) await context.close(); await host.close(); }
}
try {
  const selected = process.env.MN_CHAR_VIEWPORT ? specs.filter((s) => s.name === process.env.MN_CHAR_VIEWPORT) : specs;
  check(selected.length > 0, 'unknown viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.status = evidence.failures.length ? 'failed' : 'passed';
await writeFile(resolve(out, process.env.MN_CHAR_VIEWPORT ? `character-${process.env.MN_CHAR_VIEWPORT}.json` : 'character-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, results: evidence.viewports.map(({ name, status, failure, figure }) => ({ name, status, figure, failure: failure?.split('\n')[0] })) }));
if (evidence.failures.length) process.exitCode = 1;

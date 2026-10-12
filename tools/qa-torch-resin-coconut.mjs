#!/usr/bin/env node
// Disposable local account: real UI actions through GameHost, no production or external accounts.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { GAME } from '../src/data/meta.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/torch-resin-coconut/local');
await mkdir(out, { recursive: true });
const first = paths => paths.find(p => fs.existsSync(p)) || paths[0];
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT || first([
  resolve(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
  resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
])).href);
const three = first([resolve(repo, 'node_modules/three'), resolve(sibling, 'node_modules/three')]);
const gsap = resolve(sibling, '.scratch/gsap-local/package');
const specs = [
  { name: 'desktop-es', width: 1280, height: 720, touch: false, locale: 'es' },
  { name: 'desktop-en', width: 1280, height: 720, touch: false, locale: 'en' },
  { name: 'phone-en', width: 844, height: 390, touch: true, locale: 'en' },
  { name: 'portrait-es', width: 390, height: 844, touch: true, locale: 'es' },
].filter(s => !process.env.MN_QA_VIEWPORT || s.name === process.env.MN_QA_VIEWPORT);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const evidence = { build: GAME.version, at: new Date().toISOString(), viewports: [] };
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const spec of specs) {
    const result = { ...spec, checks: {}, screenshots: [], errors: [] };
    evidence.viewports.push(result);
    const store = createMemoryStore(), account = 'b2f6a0d4-5e3c-4b71-9a8e-7c0d1e2f3a40';
    const profile = newProfile();
    profile.pirateId = `account:${account}`;
    profile.eco.pack.goods = { tronco: 3, resina: 1, coco: 1, piedra: 2 };
    profile.surv = { v: 1, sat: 50, hyd: 20 };
    await store.initializeProfile(account, profile);
    const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
      store, worldId: `qa-foraging-${spec.name}`, resolvePlayer: async () => account, initializeAccounts: true,
      economicOperations: true, resourceOperations: true, loggingOperations: true, artisanOperations: true,
      workshopOperations: true, fireOperations: true, freshwaterOperations: true, canteenOperations: true,
      torchResinCoconutOperations: true, saveSecret: `qa-foraging-${spec.name}`, chat: { enabled: false }, log() {} });
    let context, page;
    const shot = async label => {
      const file = `${spec.name}-${label}.png`;
      await page.screenshot({ path: resolve(out, file) }); result.screenshots.push(file);
    };
    try {
      const port = await host.listen();
      context = await browser.newContext({ viewport: { width: spec.width, height: spec.height },
        deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
      page = await context.newPage();
      page.on('pageerror', e => result.errors.push(String(e)));
      const iconResponses = [];
      page.on('response', response => {
        if (/(?:resina|coco)-v1.*\.webp/.test(response.url())) iconResponses.push({ url: response.url(), status: response.status() });
      });
      await page.addInitScript(locale => localStorage.setItem('mn.locale', locale), spec.locale);
      await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
        const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        const file = match && resolve(match[1].startsWith('three') ? three : gsap, match[2]);
        if (!file || !fs.existsSync(file)) return route.abort();
        return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
      });
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, body: '' }));
      await page.goto(`http://127.0.0.1:${port}/?debug&q=${spec.touch ? 'low' : 'high'}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && window.__mn.client.fire?.torchRules === 2,
        null, { timeout: 90000 });

      // Recipe and axe detail must keep every statistic above the action in the scrollable document.
      for (const recipe of ['antorcha', 'hacha_piedra']) {
        await page.evaluate(id => window.__mn.panels.workbench.open({ recipe: id }), recipe);
        await page.waitForFunction(() => window.__mn.panels.workbench.active, null, { timeout: 5000 });
        await page.waitForTimeout(250);
        const layout = await page.evaluate(() => {
          const root = document.querySelector('.workbench-panel'), detail = root.querySelector('.cr-detail');
          const stats = root.querySelector('[data-stats]').getBoundingClientRect();
          const action = root.querySelector('.cr-action').getBoundingClientRect();
          const button = root.querySelector('.wb-confirm');
          const buttonBox = button.getBoundingClientRect(), detailBox = detail.getBoundingClientRect(), mainBox = root.querySelector('.cr-main').getBoundingClientRect();
          return { statsBottom: stats.bottom, actionTop: action.top, buttonBottom: buttonBox.bottom, detailBottom: detailBox.bottom, scrollHeight: detail.scrollHeight,
            detailRight: detailBox.right, mainRight: mainBox.right,
            height: detail.clientHeight, confirmDisabled: button.disabled,
            needs: root.querySelector('[data-needs]').textContent, title: root.querySelector('[data-output-name]').textContent };
        });
        result.checks[recipe] = layout;
        if (!spec.touch) {
          check(layout.statsBottom <= layout.actionTop + 1, `${recipe} statistics overlap craft action: ${JSON.stringify(layout)}`);
          check(layout.buttonBottom <= layout.detailBottom, `${recipe} craft button is clipped: ${JSON.stringify(layout)}`);
          check(layout.detailRight <= layout.mainRight, `${recipe} details extend beneath inventory: ${JSON.stringify(layout)}`);
        }
        if (recipe === 'antorcha') {
          check(!layout.confirmDisabled, 'torch must be craftable from raw materials without a bench');
          check(/resin/i.test(layout.needs) && /2/.test(layout.needs), 'torch must display logs and resin');
        }
        await shot(`craft-${recipe}`);
        await page.evaluate(() => window.__mn.panels.workbench.close());
      }
      await page.evaluate(() => window.__mn.panels.firePanel.open());
      await page.waitForTimeout(150);
      const fireCopy = await page.locator('.fire-panel').textContent();
      check(fireCopy.includes(spec.locale === 'en' ? 'Hand torch' : 'Antorcha de mano'), 'fire panel language must match selected game language');
      check(fireCopy.includes(spec.locale === 'en' ? 'Resin' : 'Resina'), 'fire panel displays resin');
      await shot('fire-empty');
      // Switch through the same language source used by title controls, while the panel is open.
      await page.evaluate(async locale => { const { setLocale } = await import('/src/core/locale.js'); setLocale(locale === 'en' ? 'es' : 'en'); }, spec.locale);
      check((await page.locator('.fire-title').textContent()).includes(spec.locale === 'en' ? 'Antorcha' : 'Hand torch'), 'open fire panel must update its language');
      await page.evaluate(async locale => { const { setLocale } = await import('/src/core/locale.js'); setLocale(locale); }, spec.locale);
      await page.evaluate(() => { window.__mn.panels.firePanel.close(); window.__mn.panels.workbench.open({ recipe: 'antorcha' }); });
      await page.locator('.wb-confirm').click();
      await page.waitForFunction(() => window.__mn.client.fire.slots.some(s => s.key === 'hand' && s.lit), null, { timeout: 15000 });
      result.checks.goodsAfterTorch = await page.evaluate(() => window.__mn.client.profile.eco.pack.goods);
      check(result.checks.goodsAfterTorch.tronco === 1 && !result.checks.goodsAfterTorch.resina && result.checks.goodsAfterTorch.coco === 1,
        'torch must consume exactly two logs and one resin');
      await page.evaluate(() => { window.__mn.panels.workbench.close(); window.__mn.panels.firePanel.open(); });
      await shot('fire-burning');
      await page.evaluate(() => { window.__mn.panels.firePanel.close(); window.__mn.panels.charPanel.open('gear'); });
      await page.locator('[data-eat="coco"]').waitFor({ state: 'visible' });
      const consume = page.locator('[data-eat="coco"]');
      check((await consume.getAttribute('title')).includes('25'), 'coconut consumption describes hydration');
      result.checks.hydBefore = await page.evaluate(() => window.__mn.ps.hyd);
      await shot('inventory-coconut');
      await consume.click();
      await page.locator('.freshwater-panel [data-food="coco"]').click();
      await page.waitForFunction(() => !window.__mn.client.profile.eco.pack.goods.coco, null, { timeout: 15000 });
      await page.waitForFunction(before => window.__mn.ps.hyd > before + 24, result.checks.hydBefore, { timeout: 5000 });
      result.checks.hydAfter = await page.evaluate(() => window.__mn.ps.hyd);
      check(result.checks.hydAfter - result.checks.hydBefore > 24 && result.checks.hydAfter <= 100, 'coconut must restore hydration');
      result.checks.iconResponses = iconResponses;
      result.checks.icons = iconResponses.filter(response => response.status === 200).map(response => response.url);
      check(result.checks.icons.some(url => /coco-v1/.test(url)) && result.checks.icons.some(url => /resina-v1/.test(url)), 'both new icons load');
      if (spec.touch) check(result.checks.icons.every(url => /-mobile\.webp/.test(url)), 'mobile must use only 64px icon variants');
      await shot('coconut-consumed');
      check(!result.errors.length, result.errors.join(' | '));
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.error = String(error?.stack || error);
      try { await shot('failure'); } catch {}
    } finally {
      await context?.close().catch(() => {});
      await host.close().catch(() => {});
      console.log(JSON.stringify({ viewport: spec.name, status: result.status, error: result.error?.split('\n')[0] }));
      await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
    }
  }
} finally { await browser.close(); }
process.exitCode = evidence.viewports.some(r => r.status !== 'passed') ? 1 : 0;

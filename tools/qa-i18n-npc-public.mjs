// Narrow public acceptance for the last catalog-only NPC-role correction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import data from '../src/i18n/data.js';
const { chromium } = await import(pathToFileURL(path.resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const base = process.env.MN_PUBLIC_URL || 'https://marea.62.171.136.148.sslip.io';
const out = path.resolve('docs/delivery/i18n04b/public-npc');
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), url: base, revision: process.env.MN_PUBLIC_REVISION,
  scope: 'Real public guest entry and live village NPC role translation; final change is catalog-only. Full reconnect/HUD acceptance is recorded separately.', errors: [], locales: {} };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', msg => { if (msg.text().includes('[i18n] Missing')) report.errors.push(msg.text()); });
  await page.goto(base + '/?q=low&debug', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mn?.st.online && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
  await page.locator('#btn-play').focus();
  await page.locator('#btn-play').press('Enter');
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing');
  assert.equal(await page.evaluate(() => window.__mn.transport.kind), 'ws');
  await page.waitForFunction(() => document.querySelectorAll('.nameplate.npc').length >= 4);
  const npcs = generateWorld(18743).npcs;
  for (const locale of ['es', 'en']) {
    await page.evaluate(async locale => (await import('/src/core/i18n.js')).setLocale(locale), locale);
    const plates = await page.locator('.nameplate.npc').evaluateAll(els => els.map(el => ({
      title: el.querySelector('.np-title')?.textContent?.replace(/[«»]/g, '').trim(),
      name: el.querySelector('.np-name')?.textContent?.trim(),
      visible: !el.hidden && getComputedStyle(el).display !== 'none',
    })));
    for (const npc of npcs.filter(npc => npc.id !== 'calaMerchant')) {
      const plate = plates.find(plate => plate.name === npc.name);
      assert.ok(plate, 'Public village NPC name remains intact: ' + npc.name);
      assert.equal(plate.title, locale === 'en' ? data[npc.title] : npc.title, npc.id + ' role follows ' + locale);
    }
    report.locales[locale] = plates;
  }
  // Capture the actual bound labels without moving the camera or any NPC.
  await page.screenshot({ path: path.join(out, 'bound-npc-en.png') });
  assert.deepEqual(report.errors, []);
  report.pass = true;
  await context.close();
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

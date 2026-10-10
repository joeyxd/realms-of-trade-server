// Public client acceptance against the existing authority; guest only, no account or wallet actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const base = process.env.MN_PUBLIC_URL || 'https://marea.62.171.136.148.sslip.io';
const out = path.resolve('docs/delivery/i18n04b/public'); fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), url: base, scope: 'Public guest entry, locale persistence and real WebSocket reconnect; no login, signing or durable economic commands', checks: [], errors: [], screenshots: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name + '.png') }); report.screenshots.push(name + '.png'); };
try {
  const health = await fetch(base + '/health'); assert.equal(health.ok, true);
  const status = await (await fetch(base + '/status')).json();
  report.status = { version: status.version, players: status.players, errors: status.errors,
    storage: { kind: status.storage?.kind, durable: status.storage?.durable, accounts: status.storage?.accounts,
      unsaved: status.storage?.unsaved, tickBlocked: status.storage?.tickBlocked } };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', msg => { if (msg.text().includes('[i18n] Missing')) report.errors.push(msg.text()); });
  await page.goto(base + '/?q=low&debug', { waitUntil: 'load' });
  const ready = () => page.waitForFunction(() => window.__mn?.st.online && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
  await ready(); assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await shot(page, '01-entry-en');
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing');
  assert.equal(await page.evaluate(() => window.__mn.transport.kind), 'ws');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.locator('#hud-settings').click();
  await page.locator('#pause [data-locale=es]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  await shot(page, '02-settings-es');
  await page.locator('#btn-resume').click();
  await page.evaluate(() => window.__mn.panels.charPanel.open('stats'));
  assert.match(await page.locator('#charpanel').innerText(), /Atributos/);
  await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('en'));
  assert.match(await page.locator('#charpanel').innerText(), /Attributes/);
  await page.waitForTimeout(500); await shot(page, '03-character-en');
  report.checks.push('Public English entry, real guest WebSocket, Spanish settings and live character panel switch');
  await page.evaluate(() => { window.__mn.panels.charPanel.close(); window.__mn.transport.ws.close(1000, 'i18n acceptance'); });
  await page.locator('.net-lost').waitFor({ state: 'visible' });
  assert.match(await page.locator('.net-lost').innerText(), /Reconnect/);
  await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('es'));
  assert.match(await page.locator('.net-lost').innerText(), /Reconectar/);
  await shot(page, '04-disconnect-es');
  await page.locator('#btn-reconnect').click(); await ready();
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing');
  assert.equal(await page.evaluate(() => window.__mn.transport.ws.readyState), 1);
  report.checks.push('Actual socket close, bilingual disconnect overlay, reconnect reload retains Spanish and rejoins authority');
  await shot(page, '05-reconnected-es');
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

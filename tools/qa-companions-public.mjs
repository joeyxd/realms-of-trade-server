// Public TLS browser smoke check for the real guest-facing companion panel.
// This uses no account fixtures, credentials, provider calls, or account creation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME } from '../src/data/meta.js';

const origin = 'https://marea.62.171.136.148.sslip.io';
const out = resolve(process.env.MN_COMPANIONS_QA_OUTPUT || 'docs/delivery/l03d-owner-center');
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
await mkdir(out, { recursive: true });

const evidence = { schema: 'l03d-companions-public-browser/v1', at: new Date().toISOString(), origin,
  production: true, simulatedAuth: false, checks: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
let context;
try {
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  const statusResponse = await fetch(`${origin}/status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  evidence.version = status.version;
  assert.equal(status.version, GAME.version);
  assert.equal(status.errors, 0);
  evidence.checks.push('public_tls_health_and_game_version');

  // A fresh browser context has no prior auth storage; the user explicitly chooses guest in-game.
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.stack || error.message));
  await page.goto(`${origin}/?q=low&tod=day`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
  evidence.guestBoot = await page.evaluate(() => ({ online: __mn.st.online, transport: __mn.transport.kind,
    serverMarked: !!document.querySelector('meta[name="mn-server"]'), companionStatus: __mn.companions.snapshot().status }));
  assert.equal(evidence.guestBoot.online, true);
  assert.equal(evidence.guestBoot.transport, 'ws');
  assert.equal(evidence.guestBoot.serverMarked, true);

  await page.locator('.account-open').click();
  await page.waitForSelector('.account-overlay:not([hidden]) .account-guest');
  await page.locator('.account-guest').click();
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  await page.waitForSelector('.mn-companions-toggle');
  await page.locator('.mn-companions-toggle').click();
  await page.waitForSelector('.mn-companions-panel:not([hidden])');
  await page.waitForFunction(() => __mn.companions.snapshot().status === 'signed_out' &&
    __mn.companions.snapshot().companions.length === 0);
  await page.waitForFunction(() => document.querySelector('.mn-companions-close') === document.activeElement);
  const spanish = await page.evaluate(() => ({ lang: document.documentElement.lang,
    status: document.querySelector('.mn-companions-status')?.textContent,
    setup: document.querySelector('.mn-companions-setup')?.textContent,
    controls: document.querySelectorAll('.mn-companions-stop').length,
    rows: __mn.companions.snapshot().companions }));
  assert.equal(spanish.lang.startsWith('es'), true);
  assert.match(spanish.status, /inicia sesi[oó]n/i);
  assert.match(spanish.setup, /configurar/i);
  assert.equal(spanish.controls, 0);
  assert.deepEqual(spanish.rows, []);
  await page.screenshot({ path: resolve(out, 'public-companions-desktop-es.png') });
  evidence.screenshots.push('public-companions-desktop-es.png');
  evidence.checks.push('real_guest_has_signed_out_empty_panel_and_no_stop_control_es');

  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.mn-companions-close') === document.activeElement);
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(() => document.querySelector('.mn-companions-close') === document.activeElement);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.mn-companions-panel').hidden);
  await page.waitForFunction(() => document.querySelector('.mn-companions-toggle') === document.activeElement);
  evidence.checks.push('guest_dialog_tab_wrap_escape_and_focus_return');

  await page.locator('.mn-companions-toggle').click();
  await page.waitForFunction(() => document.querySelector('.mn-companions-close') === document.activeElement);
  await page.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); });
  await page.waitForFunction(() => document.querySelector('.mn-companions-panel h2')?.textContent === 'My companions');
  const english = await page.locator('.mn-companions-status').textContent();
  assert.match(english, /sign in/i);
  await page.screenshot({ path: resolve(out, 'public-companions-desktop-en.png') });
  evidence.screenshots.push('public-companions-desktop-en.png');
  evidence.checks.push('guest_panel_tracks_document_language_en');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.mn-companions-panel');
    if (!panel || panel.hidden) return false;
    const rect = panel.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
      rect.right <= innerWidth && rect.bottom <= innerHeight;
  });
  await page.screenshot({ path: resolve(out, 'public-companions-mobile-844x390.png') });
  evidence.screenshots.push('public-companions-mobile-844x390.png');
  evidence.checks.push('public_guest_panel_fits_mobile_viewport');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.mn-companions-panel');
    if (!panel || panel.hidden) return false;
    const rect = panel.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
      rect.right <= innerWidth && rect.bottom <= innerHeight;
  });
  await page.screenshot({ path: resolve(out, 'public-companions-mobile-portrait.png') });
  evidence.screenshots.push('public-companions-mobile-portrait.png');
  evidence.checks.push('public_guest_panel_fits_portrait_viewport');

  evidence.final = await page.evaluate(() => ({ mode: __mn.st.mode, joined: __mn.client.joined,
    state: __mn.companions.snapshot(), errors: [...__mn.errors] }));
  assert.equal(evidence.final.mode, 'playing');
  assert.equal(evidence.final.joined, true);
  assert.equal(evidence.final.state.status, 'signed_out');
  assert.deepEqual(evidence.final.state.companions, []);
  assert.deepEqual(evidence.final.errors, []);
  assert.deepEqual(evidence.errors, []);
  evidence.checks.push('public_browser_runtime_and_page_errors_empty');
} catch (error) {
  evidence.errors.push(String(error.stack || error));
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser.close();
  await writeFile(resolve(out, 'public-browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}

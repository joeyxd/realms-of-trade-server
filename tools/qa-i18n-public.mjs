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
  await page.locator('#btn-play').focus();
  await page.locator('#btn-play').press('Enter');
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
  assert.match(await page.locator('#charpanel').innerText(), /Stats[\s\S]*Level[\s\S]*Attack/);
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
  await page.locator('#btn-play').focus();
  await page.locator('#btn-play').press('Enter');
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing');
  assert.equal(await page.evaluate(() => window.__mn.transport.ws.readyState), 1);
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const player = document.querySelector('#hud .hud-player');
    return player && Number(getComputedStyle(player).opacity) >= 0.99;
  });
  await page.waitForTimeout(1000);
  assert.match(await page.locator('#hud').innerText(), /Primeros pasos/);
  report.checks.push('Actual socket close, bilingual disconnect overlay, reconnect reload retains Spanish and rejoins authority');
  await shot(page, '05-reconnected-es');
  // Measure the actual deployed CSS after entrance/title animations in both layouts and languages.
  report.hud = [];
  for (const viewport of [{ width: 1280, height: 800, scale: 1 }, { width: 844, height: 390, scale: 1 }, { width: 1280, height: 500, scale: 1.3 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.locator('#hud-settings').click();
    await page.locator('#set-ui').evaluate((el, scale) => {
      el.value = String(scale); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, viewport.scale);
    await page.locator('#btn-resume').click();
    await page.locator('.personal-lantern').waitFor({ state: 'visible' });
    await page.waitForFunction(({ width, height }) => {
      const b = document.querySelector('#stage').getBoundingClientRect();
      return Math.abs(b.width - width) < 1 && Math.abs(b.height - height) < 1;
    }, viewport);
    for (const locale of ['es', 'en']) {
      await page.evaluate(async locale => (await import('/src/core/i18n.js')).setLocale(locale), locale);
      await page.waitForTimeout(800);
      assert.match(await page.locator('.net-chip .pl').innerText(), locale === 'es' ? /pirata/ : /pirate/);
      const boxes = await page.evaluate(() => Object.fromEntries(['.tracker', '.world-minimap', '.minimap-caption', '.actionbar', '.personal-lantern'].map(selector => {
        const el = document.querySelector(selector), b = el.getBoundingClientRect();
        return [selector, { top: b.top, bottom: b.bottom, left: b.left, right: b.right, visible: !el.hidden && getComputedStyle(el).display !== 'none' }];
      })));
      const a = boxes['.tracker'];
      assert.ok(Math.abs((a.right - a.left) / 250 - viewport.scale) < 0.01, 'HUD follows the live UI-size setting after entrance');
      assert.equal(a.visible, true);
      const bar = boxes['.actionbar'];
      assert.ok(Math.abs((bar.bottom - bar.top) / 82 - viewport.scale) < 0.01, 'Action bar follows live UI size');
      for (const selector of ['.world-minimap', '.minimap-caption', '.actionbar', '.personal-lantern']) {
        const b = boxes[selector];
        if (!b.visible) continue;
        assert.ok(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right, 'Objectives clear ' + selector);
      }
      assert.ok(a.bottom <= viewport.height && a.right <= viewport.width, 'Objectives remain inside the stage');
      const scroll = await page.locator('.tracker').evaluate(el => {
        el.scrollTop = el.scrollHeight;
        const last = [...el.querySelectorAll('li')].filter(li => getComputedStyle(li).display !== 'none').at(-1);
        const row = last.getBoundingClientRect(), box = el.getBoundingClientRect();
        return { height: el.clientHeight, contentHeight: el.scrollHeight, scrollTop: el.scrollTop,
          lastVisible: row.top >= box.top && row.bottom <= box.bottom };
      });
      assert.equal(scroll.lastVisible, true, 'Last objective remains reachable');
      const fallen = await page.evaluate(() => {
        const row = document.createElement('div'); row.className = 'party';
        row.innerHTML = '<div class="pm dead"><span class="pn">QA</span></div>';
        document.querySelector('#hud').append(row);
        const content = getComputedStyle(row.querySelector('.pn'), '::after').content;
        row.remove(); return content;
      });
      assert.match(fallen, locale === 'es' ? /caído/ : /fallen/);
      report.hud.push({ viewport, locale, boxes, fallen, scroll });
      await shot(page, `hud-${viewport.width}x${viewport.height}-${locale}`);
    }
  }
  report.checks.push('Deployed objectives clear minimap/caption, actions and personal lantern after live UI scaling at 1280x800, 844x390 and 1280x500 with maximum UI scale; CSS fallen label follows ES/EN');
  assert.deepEqual(report.errors, []);
  report.pass = true;
  await context.close();
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

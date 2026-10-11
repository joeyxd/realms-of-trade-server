// Portrait HUD geometry QA for the real client. Uses a local SoloWorker by default;
// MN_PUBLIC_URL opts into the existing public guest/WSS path. Presentation fixtures
// reveal transient HUD copy without changing world state or issuing game commands.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME } from '../src/data/meta.js';

const root = process.cwd();
const remote = process.env.MN_PUBLIC_URL;
const out = path.resolve(process.env.MN_QA_OUT || 'docs/delivery/hud-portrait');
fs.mkdirSync(out, { recursive: true });
const sibling = path.resolve(root, '..', 'realms-of-trade-server');
const playwrightPath = path.resolve(process.env.MN_PLAYWRIGHT || path.join(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
let server, browser;
const report = {
  at: new Date().toISOString(),
  scope: remote
    ? 'Public guest HUD via existing WSS; presentation-only zone banner and toast fixtures.'
    : 'Local real client and SoloWorker; local CDN substitutes; presentation-only zone banner and toast fixtures.',
  stateMutation: false,
  cases: [],
  failures: [],
  screenshots: [],
};

const clear = (a, b) => a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
if (!remote) {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || pathname.includes('/.env') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}
const base = remote || `http://127.0.0.1:${server.address().port}`;

async function useLocalRoutes(page) {
  if (remote) return;
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = path.resolve(match[1].startsWith('three') ? 'node_modules/three' : path.join(sibling, '.scratch/gsap-local/package'), match[2]);
    const exists = fs.existsSync(file);
    return route.fulfill({ status: exists ? 200 : 404, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: exists ? fs.readFileSync(file) : '' });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.abort());
}

async function startPage(context) {
  const page = await context.newPage();
  page.on('pageerror', error => report.failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('[i18n] Missing')) report.failures.push(`i18n: ${message.text()}`);
  });
  await useLocalRoutes(page);
  await page.goto(base + (remote ? '/?q=low&debug' : '/?solo&q=low&tod=day&debug'), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && document.querySelector('#btn-play') && !document.querySelector('#btn-play').disabled, null, { timeout: 120000 });
  await page.locator('#btn-play').focus();
  await page.locator('#btn-play').press('Enter');
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing', null, { timeout: 90000 });
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.waitForTimeout(900);
  return page;
}

async function setupPresentation(page, locale, scale) {
  await page.evaluate(async ({ locale, scale }) => {
    const i18n = await import('/src/core/i18n.js');
    i18n.setLocale(locale);
    document.documentElement.style.setProperty('--ui-scale', String(scale));

    // These DOM-only fixtures exercise transient layout without invoking the HUD's
    // game-facing zone/toast APIs or changing player, profile, or world state.
    const banner = document.querySelector('#zone-banner');
    banner.querySelector('.zname').textContent = locale === 'en' ? 'Emerald Jungle Coast' : 'Costa de la Selva Esmeralda';
    banner.querySelector('.zsub').textContent = locale === 'en' ? 'SOMETHING LONG IS HAPPENING' : 'ALGO IMPORTANTE ESTÁ OCURRIENDO';
    banner.style.opacity = '1';
    // Drop only GSAP's entrance offset; keep the responsive CSS placement.
    banner.style.removeProperty('transform');
    const toasts = document.querySelector('#toasts');
    toasts.replaceChildren();
    const toast = document.createElement('div');
    toast.className = 'toast frame-dark';
    toast.textContent = locale === 'en' ? 'A companion has joined your crew.' : 'Un compañero se ha unido a tu tripulación.';
    toasts.append(toast);

    const net = document.querySelector('.net-chip');
    if (net) {
      net.hidden = false;
      net.querySelector('.ms').textContent = '100';
      net.querySelector('.pl').textContent = locale === 'en' ? 'players' : 'jugadores';
    }
    // The signed-out local fixture normally keeps this account-only control hidden.
    // Reveal the actual control so its narrow-screen hit target is checked as well.
    window.__mn.panels.companionsPanel?.setVisible(true);
  }, { locale, scale });
  await page.waitForTimeout(120);
}

async function inspect(page, viewport, mode, locale, scale) {
  const result = await page.evaluate(() => {
    const selectors = ['.hud-player', '.hud-top-right', '.world-minimap', '.minimap-caption', '#zone-banner', '#toasts'];
    const rect = el => {
      const b = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height,
        opacity: Number.parseFloat(style.opacity),
        visible: !el.hidden && style.display !== 'none' && style.visibility !== 'hidden'
          && el.getClientRects().length > 0 && Number.parseFloat(style.opacity) > 0.01 && b.width > 0 && b.height > 0 };
    };
    const boxes = Object.fromEntries(selectors.map(selector => [selector, rect(document.querySelector(selector))]));
    const buttons = ['#hud-settings', '#hud-map', '#hud-bag', '.mn-companions-toggle'].map(selector => {
      const el = document.querySelector(selector);
      return { selector, exists: Boolean(el), ...rect(el || document.createElement('span')), label: el?.getAttribute('aria-label') || el?.textContent.trim() || '' };
    });
    const banner = document.querySelector('#zone-banner');
    const toast = document.querySelector('#toasts .toast');
    return {
      stage: rect(document.querySelector('#stage')),
      boxes,
      bannerText: `${banner.querySelector('.zname').textContent} / ${banner.querySelector('.zsub').textContent}`,
      toastText: toast?.textContent || '',
      minimapMode: document.querySelector('.world-minimap')?.className || '',
      buttons,
      combat: ['.actionbar', '#touch .t-q', '#touch .t-e', '#touch .t-r', '#touch .t-atk'].flatMap(selector => {
        const el = document.querySelector(selector);
        return el ? [{ selector, ...rect(el) }] : [];
      }),
      viewport: { width: innerWidth, height: innerHeight, coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints > 0 },
    };
  });
  const key = `${mode}-${viewport.width}x${viewport.height}-${locale}-scale${String(scale).replace('.', '_')}`;
  try {
    assert.equal(result.stage.width, viewport.width, `stage width mismatch: ${JSON.stringify(result.stage)}`);
    assert.equal(result.stage.height, viewport.height, `stage height mismatch: ${JSON.stringify(result.stage)}`);
    for (const name of ['.hud-player', '.hud-top-right', '.world-minimap', '.minimap-caption', '#zone-banner', '#toasts']) {
      assert.ok(result.boxes[name]?.visible, `${name} is not visible: ${JSON.stringify(result.boxes[name])}`);
      const b = result.boxes[name];
      assert.ok(b.left >= -1 && b.top >= -1 && b.right <= viewport.width + 1 && b.bottom <= viewport.height + 1, `${name} escapes stage: ${JSON.stringify(b)}`);
    }
    const names = Object.keys(result.boxes);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      assert.ok(clear(result.boxes[names[i]], result.boxes[names[j]]), `${names[i]} overlaps ${names[j]}: ${JSON.stringify(result.boxes)}`);
    }
    for (const button of result.buttons) {
      assert.ok(button.exists && button.visible, `essential control missing: ${button.selector}`);
      const minimum = mode === 'touch' || viewport.width <= 900 ? 44 : 24;
      assert.ok(button.width >= minimum && button.height >= minimum, `target below ${minimum}px: ${button.selector} ${button.width}x${button.height}`);
      assert.ok(button.left >= -1 && button.right <= viewport.width + 1 && button.top >= -1 && button.bottom <= viewport.height + 1,
        `essential control escapes stage: ${button.selector} ${JSON.stringify(button)}`);
    }
    for (const combat of result.combat.filter(box => box.visible && (mode === 'touch' || box.selector === '.actionbar'))) {
      assert.ok(clear(result.boxes['.hud-top-right'], combat), `account controls overlap ${combat.selector}`);
      assert.ok(clear(result.boxes['#zone-banner'], combat), `zone banner overlaps ${combat.selector}`);
    }
    const screenshot = (mode === 'desktop' && viewport.width === 1280)
      || (viewport.width === 844)
      || (viewport.width === 390 && (scale === 1.3 || mode === 'desktop' || mode === 'touch'));
    let screenshotName;
    if (screenshot) {
      screenshotName = `${key}.png`;
      await page.screenshot({ path: path.join(out, screenshotName) });
      report.screenshots.push(screenshotName);
    }
    report.cases.push({ key, viewport, mode, locale, scale, boxes: result.boxes, buttons: result.buttons, combat: result.combat, screenshot: screenshotName || null });
  } catch (error) {
    report.failures.push(`${key}: ${error.message}`);
    report.cases.push({ key, viewport, mode, locale, scale, boxes: result.boxes, buttons: result.buttons, error: error.message });
  }
}

try {
  browser = await chromium.launch({
    ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const contexts = [
    { mode: 'desktop', options: { viewport: { width: 1280, height: 800 }, locale: 'es-MX' } },
    { mode: 'touch', options: { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'es-MX' } },
  ];
  const portrait = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
  for (const spec of contexts) {
    const context = await browser.newContext(spec.options);
    await context.addInitScript(key => localStorage.setItem(key, JSON.stringify({ landscape: false, quality: 'low' })), GAME.saveKey + '.settings');
    const page = await startPage(context);
    for (const viewport of [...portrait, { width: 844, height: 390 }, ...(spec.mode === 'desktop' ? [{ width: 1280, height: 800 }] : [])]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => {
        const b = document.querySelector('#stage').getBoundingClientRect();
        return Math.abs(b.width - width) < 1 && Math.abs(b.height - height) < 1;
      }, viewport);
      for (const scale of [1, 1.3]) for (const locale of ['es', 'en']) {
        await setupPresentation(page, locale, scale);
        await inspect(page, viewport, spec.mode, locale, scale);
      }
    }
    await context.close();
  }
  report.pass = report.failures.length === 0;
} catch (error) {
  report.failures.push(`harness: ${error.stack || error.message}`);
  report.pass = false;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, screenshots: report.screenshots.length, failures: report.failures }, null, 2));
}

if (!report.pass) process.exitCode = 1;

#!/usr/bin/env node
// PT03 browser QA of the touch HUD layout in the normal game: real phone-sized viewports (touch + mobile emulation),
// one disposable memory-backed host per viewport, a fresh character from the roster, the touch HUD on screen.
// Per landscape viewport it measures the real DOM (getBoundingClientRect of every .tbtn and of the resting joystick) and
// asserts: every button inside the stage with 8 px to spare, no overlap, the middle of the stage free, the joystick half
// free, ATK hugging the bottom-right corner (insets are 0 in Playwright), the DOM equal to touchLayout(), and that no
// visible HUD element outside #touch covers a button. The measure forces every .tbtn (G, ACT and the freshwater button are
// hidden by game state) and the bound lantern visible first, so a button that only shows now and then cannot hide an overlap;
// there is no exception list. The lantern must clear every button and every other HUD element, sit inside the stage with
// 8 px to spare and stay out of the middle and the joystick half. The portrait phone (rotated stage) is checked for rules
// 1-2 and for the lantern not touching a button.
// Screenshots and evidence stay in MN_QA_OUT, which must be outside the repository.
// Usage: MN_QA_ALLOW_BROWSER=1 MN_PLAYWRIGHT=<playwright index.mjs> MN_QA_OUT=<dir outside the repo> node tools/qa-touch-layout.mjs
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this disposable local harness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.MN_QA_OUT || resolve(os.tmpdir(), 'qa-touch-layout'));
const rel = relative(repo, out);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error(`MN_QA_OUT must be outside the repository (got ${out})`);
await mkdir(out, { recursive: true });
const firstExisting = (paths) => paths.find((path) => fs.existsSync(path)) || paths[0];
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
// three comes with the worktree's node_modules; gsap from a local copy (the game loads both from a CDN, blocked here).
const siblings = fs.readdirSync(resolve(repo, '..'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => resolve(repo, '..', d.name));
const threeRoot = firstExisting([resolve(repo, 'node_modules/three'), ...siblings.map((d) => resolve(d, 'node_modules/three'))]);
const gsapRoot = resolve(process.env.MN_GSAP || firstExisting([resolve(repo, '.scratch/gsap-local/package'), ...siblings.map((d) => resolve(d, '.scratch/gsap-local/package'))]));

// Viewports of the brief: CSS px and device scale factor. The portrait phone shows a rotated 844 x 390 stage.
const specs = [
  { name: 'touch-844x390', width: 844, height: 390, dpr: 3, landscape: true },
  { name: 'touch-915x412', width: 915, height: 412, dpr: 2.625, landscape: true },
  { name: 'touch-932x430', width: 932, height: 430, dpr: 3, landscape: true },
  { name: 'touch-1024x768', width: 1024, height: 768, dpr: 2, landscape: true },
  { name: 'touch-portrait-390x844', width: 390, height: 844, dpr: 3, landscape: false },
];
// Not HUD: labels pinned to 3D things drift with the camera, and transient centre hints / toasts come and go.
const WORLD = '.nameplate, .fnum, .loot-label, .bubble';
const SKIPPED = [WORLD]; // transient centre hints and toasts are added here only if the run proves one is in the way
const evidence = { build: GAME.version, generatedAt: new Date().toISOString(), outDir: out, exceptions: [], skipped: SKIPPED, viewports: [], failures: [] };
const check = (ok, text) => { if (!ok) throw new Error(text); };

async function routes(page, result) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    result.externalRequests.push(url.href); return route.abort();
  });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}

// Join: #btn-play, then the roster path (create a character, play with it) when the character picker intercepts Play.
async function join(page, port, result) {
  page.on('pageerror', (error) => result.pageErrors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error' && !/fonts\.g/.test(message.text())) result.consoleErrors.push(message.text()); });
  await routes(page, result);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  if (await page.getByRole('button', { name: /Crear personaje/ }).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
    result.rosterUsed = true;
    await page.getByRole('button', { name: /Crear personaje/ }).first().click({ force: true });
    await page.getByRole('button', { name: /Crear y continuar/ }).first().click({ force: true });
    const go = page.getByRole('button', { name: /Jugar con este personaje/ }).first();
    await go.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Jugar con este personaje/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
    await go.click({ force: true });
  }
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 60000 });
}

// Everything is measured inside the page, in stage coordinates (stage.toLocal on the four corners of every rect).
async function measure(page) {
  return page.evaluate(async (world) => {
    const { stage } = await import('/src/ui/stage.js');
    const { touchLayout, centralZone, joyZone } = await import('/src/ui/touchLayout.js');
    const touch = document.querySelector('#touch');
    const box = (el) => {
      const r = el.getBoundingClientRect(), pts = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => stage.toLocal(x, y));
      const l = Math.min(...pts.map((p) => p.x)), rr = Math.max(...pts.map((p) => p.x)), t = Math.min(...pts.map((p) => p.y)), b = Math.max(...pts.map((p) => p.y));
      return { x: (l + rr) / 2, y: (t + b) / 2, w: rr - l, h: b - t, left: l, right: rr, top: t, bottom: b };
    };
    const SLOT = { pot: 'potion' };
    const slot = (b) => { const k = [...b.classList].map((c) => c.match(/^t-(.+)$/)?.[1]).find((c) => c && c !== 'skill'); return SLOT[k] || k; };
    // Force every button and the bound lantern visible (they show only by game state), measure, put them back.
    const btns = [...touch.querySelectorAll('.tbtn')], lantern = document.querySelector('#personal-lantern');
    const hiddenBefore = btns.map((b) => b.hidden), lanternHidden = lantern ? lantern.hidden : null;
    // forcedVisible: every element this measure set visible (the lantern always, the buttons that game state hides);
    // wasHidden says which of them really were hidden before.
    const forcedVisible = btns.filter((b, i) => hiddenBefore[i]).map((b) => slot(b)), wasHidden = Object.fromEntries(btns.map((b, i) => [slot(b), hiddenBefore[i]]));
    if (lantern) { forcedVisible.push('lantern'); wasHidden.lantern = lanternHidden; }
    for (const b of btns) b.hidden = false;
    if (lantern) lantern.hidden = false;
    // Measured synchronously (getBoundingClientRect forces the layout) so the game loop cannot hide them again in between.
    const buttons = btns.map((b, i) => ({ slot: slot(b), ...box(b), hiddenByDefault: hiddenBefore[i] }));
    const stageEl = document.querySelector('#stage'), sr = stageEl.getBoundingClientRect(), area = sr.width * sr.height;
    const painted = (el, cs) => /^(BUTTON|INPUT|IMG|SVG|CANVAS|SELECT|TEXTAREA)$/i.test(el.tagName) || cs.backgroundImage !== 'none'
      || !/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$|^transparent$/.test(cs.backgroundColor) || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none')
      || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const one = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map((c) => '.' + c).join('');
    const labelOf = (el) => [el.parentElement?.parentElement, el.parentElement, el].filter((e) => e && e !== stageEl).map(one).join(' > ');
    // Every visible painted HUD element of the stage except #touch itself (a hidden ancestor hides it; world labels are skipped).
    const hud = [];
    for (const el of document.querySelectorAll('#stage *')) {
      if (touch.contains(el) || el.contains(touch) || el.tagName === 'CANVAS' && el.id === 'game') continue;
      if (el.closest(world)) continue;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || r.width < 4 || r.height < 4) continue;
      let hiddenUp = false; for (let p = el.parentElement; p && p !== stageEl; p = p.parentElement) { const pc = getComputedStyle(p); if (pc.display === 'none' || pc.visibility === 'hidden' || +pc.opacity < 0.05) { hiddenUp = true; break; } }
      if (hiddenUp || !painted(el, cs) || r.width * r.height > 0.45 * area) continue;
      hud.push({ el, label: labelOf(el), ...box(el) });
    }
    const circleHitsRect = (c, z) => { const nx = Math.min(Math.max(c.x, z.left), z.right), ny = Math.min(Math.max(c.y, z.top), z.bottom); return Math.hypot(c.x - nx, c.y - ny) < c.w / 2; };
    const covers = [];
    for (const e of hud) for (const b of buttons) if (circleHitsRect(b, e)) covers.push({ element: e.label, rect: [e.left, e.top, e.right, e.bottom].map(Math.round), button: b.slot });
    // The lantern against every other HUD element and every button.
    let lanternInfo = null;
    if (lantern) {
      const lb = box(lantern), over = [];
      for (const e of hud) {
        if (e.el === lantern || lantern.contains(e.el) || e.el.contains(lantern)) continue;
        if (lb.left < e.right && e.left < lb.right && lb.top < e.bottom && e.top < lb.bottom) over.push({ element: e.label, rect: [e.left, e.top, e.right, e.bottom].map(Math.round) });
      }
      const overButtons = buttons.filter((b) => circleHitsRect(b, { left: lb.left, right: lb.right, top: lb.top, bottom: lb.bottom })).map((b) => b.slot);
      lanternInfo = { rect: [lb.left, lb.top, lb.right, lb.bottom], overElements: over, overButtons, wasHidden: lanternHidden };
    }
    const joyRest = box(touch.querySelector('.joy-rest'));
    const insets = (() => { const cs = getComputedStyle(touch.querySelector('.safe-probe')); return { l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight), t: parseFloat(cs.paddingTop), b: parseFloat(cs.paddingBottom) }; })();
    const w = stage.w, h = stage.h, tb = parseFloat(getComputedStyle(touch).getPropertyValue('--tb'));
    const want = touchLayout({ w, h, safe: insets, user: window.__mn.settings?.touchSize ?? 1 });
    const result = { stage: { w, h, rotated: stage.rotated }, insets, tb, wantTb: want.tb, want: Object.fromEntries(Object.entries(want.buttons).map(([k, v]) => [k, [v.x, v.y, v.d]])), wantJoy: [want.joy.x, want.joy.y, want.joy.d],
      buttons, joyRest, central: centralZone(w, h), joyZone: joyZone(w, h), covers, lantern: lanternInfo, forcedVisible, wasHidden, touchVisible: !touch.hidden && getComputedStyle(touch).display !== 'none',
      bodyClasses: document.body.className };
    btns.forEach((b, i) => { b.hidden = hiddenBefore[i]; });
    if (lantern) lantern.hidden = lanternHidden;
    return result;
  }, WORLD);
}

function judge(spec, m) {
  const fails = [], { w, h } = m.stage, circles = m.buttons.map((b) => ({ k: b.slot, x: b.x, y: b.y, r: b.w / 2 }));
  const hits = (c, z) => { const nx = Math.min(Math.max(c.x, z.x0), z.x1), ny = Math.min(Math.max(c.y, z.y0), z.y1); return Math.hypot(c.x - nx, c.y - ny) < c.r - 1e-6; };
  if (!m.touchVisible) fails.push('the touch HUD is not visible');
  if (circles.length < 10) fails.push(`only ${circles.length} .tbtn in the DOM`);
  if (spec.landscape === false && !m.stage.rotated) fails.push('the portrait stage is not rotated');
  if (spec.landscape && (m.stage.w !== spec.width || m.stage.h !== spec.height)) fails.push(`stage ${m.stage.w}x${m.stage.h} is not the viewport`);
  if (!spec.landscape && (m.stage.w !== spec.height || m.stage.h !== spec.width)) fails.push(`rotated stage ${m.stage.w}x${m.stage.h} is not ${spec.height}x${spec.width}`);
  // Rule 1: inside the stage (the insets read 0 here) with 8 px to spare, the resting joystick too.
  const jc = { k: 'joy', x: m.joyRest.x, y: m.joyRest.y, r: m.joyRest.w / 2 };
  for (const c of circles.concat([jc])) {
    const { l, r, t, b } = m.insets;
    if (c.x - c.r < l + 8 - 0.6 || c.x + c.r > w - r - 8 + 0.6 || c.y - c.r < t + 8 - 0.6 || c.y + c.r > h - b - 8 + 0.6) fails.push(`rule 1: ${c.k} leaves the safe box (${c.x.toFixed(1)}, ${c.y.toFixed(1)} r ${c.r.toFixed(1)})`);
  }
  // Rule 2: no overlap (4 tb apart as the layout promises, with half a px of rounding).
  for (let a = 0; a < circles.length; a++) for (let b = a + 1; b < circles.length; b++) {
    const need = circles[a].r + circles[b].r + 4 * m.tb - 0.6, d = Math.hypot(circles[a].x - circles[b].x, circles[a].y - circles[b].y);
    if (d < need) fails.push(`rule 2: ${circles[a].k} / ${circles[b].k} ${d.toFixed(1)} < ${need.toFixed(1)}`);
  }
  if (spec.landscape) {
    for (const c of circles) {
      if (hits(c, m.central)) fails.push(`rule 3: ${c.k} enters the middle of the stage`);
      if (hits(c, m.joyZone)) fails.push(`rule 4: ${c.k} enters the joystick half`);
    }
    const atk = circles.find((c) => c.k === 'atk'), gr = w - m.insets.r - (atk.x + atk.r), gb = h - m.insets.b - (atk.y + atk.r);
    if (gr > 24.6 || gb > 24.6) fails.push(`rule 5: ATK gaps ${gr.toFixed(1)} / ${gb.toFixed(1)} px`);
    if (m.covers.length) fails.push(`HUD elements over a button: ${JSON.stringify(m.covers)}`);
    const L = m.lantern;
    if (!L) fails.push('no #personal-lantern in the DOM to measure');
    else {
      const [l0, t0, r0, b0] = L.rect, inRect = (z) => l0 < z.x1 && z.x0 < r0 && t0 < z.y1 && z.y0 < b0;
      if (L.overButtons.length) fails.push(`the lantern covers buttons: ${L.overButtons.join(', ')}`);
      if (L.overElements.length) fails.push(`the lantern overlaps HUD elements: ${JSON.stringify(L.overElements)}`);
      if (l0 < m.insets.l + 8 - 0.6 || r0 > w - m.insets.r - 8 + 0.6 || t0 < m.insets.t + 8 - 0.6 || b0 > h - m.insets.b - 8 + 0.6) fails.push(`the lantern leaves the safe box (${L.rect.map(Math.round)})`);
      if (inRect(m.central)) fails.push(`the lantern enters the middle of the stage (${L.rect.map(Math.round)})`);
      if (inRect(m.joyZone)) fails.push(`the lantern enters the joystick half (${L.rect.map(Math.round)})`);
    }
  } else if (m.lantern?.overButtons.length) fails.push(`the lantern covers buttons: ${m.lantern.overButtons.join(', ')}`);
  // The DOM is the layout: centres within 1 px of touchLayout(), tb equal.
  if (Math.abs(m.tb - m.wantTb) > 0.0015) fails.push(`--tb ${m.tb} is not the layout's ${m.wantTb}`);
  for (const b of m.buttons) {
    const want = m.want[b.slot]; if (!want) { fails.push(`no layout slot for .t-${b.slot}`); continue; }
    if (Math.hypot(b.x - want[0], b.y - want[1]) > 1.2 || Math.abs(b.w - want[2]) > 1.5) fails.push(`DOM ${b.slot} (${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.w.toFixed(1)}) is not the layout's (${want.map((v) => v.toFixed(1))})`);
  }
  return fails;
}

async function run(spec, browser) {
  const result = { name: spec.name, spec, status: 'running', pageErrors: [], consoleErrors: [], externalRequests: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: false, worldId: null,
    store: createMemoryStore(), saveSecret: `qa-touch-layout-${spec.name}`, chat: { enabled: false }, log() {} });
  let context;
  try {
    console.log(`[${spec.name}] starting isolated dev:false memory host`);
    const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.dpr, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await join(page, port, result);
    await page.waitForFunction(() => { const t = document.querySelector('#touch'); return t && !t.hidden && t.querySelectorAll('.tbtn').length >= 10; }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    result.measured = await measure(page);
    result.forcedVisible = result.measured.forcedVisible;
    result.screenshot = resolve(out, `${spec.name}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: false });
    const fails = judge(spec, result.measured);
    check(!result.pageErrors.length, `page errors: ${JSON.stringify(result.pageErrors.slice(0, 2))}`);
    check(!fails.length, fails.join('; '));
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.failure = String(error?.message || error); evidence.failures.push({ name: spec.name, failure: result.failure });
  } finally {
    try { await context?.close(); } catch { /* closed */ }
    try { await host.close(); } catch { /* closed */ }
  }
}

const only = process.env.MN_QA_VIEWPORT?.trim().toLowerCase();
if (only) specs.splice(0, specs.length, ...specs.filter((spec) => spec.name.includes(only)));
const browser = await chromium.launch({
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'],
});
try {
  for (const spec of specs) await run(spec, browser);
} finally {
  await browser.close();
  evidence.status = evidence.viewports.length === specs.length && evidence.viewports.every((v) => v.status === 'passed') ? 'passed' : 'failed';
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify(evidence.viewports.map(({ name, status, failure }) => ({ name, status, ...(failure ? { failure } : {}) }))));
if (evidence.status !== 'passed') process.exitCode = 1;

#!/usr/bin/env node
// Real workbench UI, shared protocol and signed-save recovery on isolated local hosts.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const out = resolve('docs/delivery/d08c7b-workbench');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const evidence = { build: GAME.version, protocol: PROTOCOL_VERSION, generatedAt: new Date().toISOString(),
  setup: 'Ephemeral localhost hosts, memory store, isolated browser contexts. Server ECS relocation is a QA fixture; gathering, panel opening, quantities and crafting use real controls. No .env, SQL or external services.',
  performanceClaim: false, viewports: [], failures: [] };
const check = (ok, text) => { if (!ok) throw new Error(text); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'desktop-1280x720', width: 1280, height: 720, touch: false },
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
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.fulfill({ status: 200, body: '' }));
}
function clientFor(server, e) { return [...server.clients].find(([, c]) => c.entity === e); }
function relocate(server, e, p) {
  const c = server.world.ecs;
  c.x[e] = p.x; c.y[e] = p.y; c.z[e] = p.z;
  c.vx[e] = c.vz[e] = c.kbx[e] = c.kbz[e] = c.moveMag[e] = 0;
  c.dashT[e] = -1; c.dashBuffer[e] = c.castK[e] = c.castLock[e] = c.atkStage[e] = 0;
  c.regenT[e] = 100;
  server.broadcastSnapshot();
}
async function position(page, server, e, p) {
  relocate(server, e, p);
  await page.waitForFunction(({ x, y, z }) => { const m = window.__mn, c = m.client.pred.ecs, e = m.client.youLocal;
    return Math.hypot(c.x[e] - x, c.y[e] - y, c.z[e] - z) < .65
      && Math.hypot(m.ps.x - x, m.ps.y - y, m.ps.z - z) < .65; }, p, { timeout: 20000 });
}
async function join(page, port) {
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing'
    && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn.client.resources?.bench, null, { timeout: 30000 });
}
async function interact(page, spec) {
  if (spec.touch) await page.locator('#touch .t-act').tap({ force: true });
  else await page.keyboard.press('KeyF');
}
async function click(page, spec, selector) {
  if (spec.touch) await page.locator(selector).tap(); else await page.locator(selector).click();
}
async function screenshot(page, result, suffix) {
  const file = resolve(out, `${result.name}-${suffix}.png`);
  await page.screenshot({ path: file }); result.screenshots.push(file);
}
async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], screenshots: [], acks: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1,
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-workbench-${spec.name}`, chat: { enabled: false }, log() {} });
  let context, page;
  try {
    console.log(`${spec.name}: starting`);
    const port = await host.listen(), server = host.game.server;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    page = await context.newPage(); await routes(page);
    page.on('pageerror', (error) => result.errors.push(String(error.stack || error)));
    page.on('console', (message) => { if (message.type() === 'error') result.errors.push(message.text()); });
    await join(page, port);
    const e = await page.evaluate(() => window.__mn.client.youServer);
    const bench = server.world.resources.bench;
    await position(page, server, e, bench);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Preparar');
    await interact(page, spec);
    await page.waitForFunction(() => window.__mn.panels.workbench.active);
    check(await page.locator('.wb-confirm').isDisabled(), 'empty pack allowed crafting');
    await screenshot(page, result, '00-empty');
    await click(page, spec, '.wb-close');
    const nodes = [...server.world.resources.nodes.values()];
    // Two logs and a stone use eight of the real ten-unit pack capacity.
    for (const node of [...nodes.filter((n) => n.kind === 'wood').slice(0, 2), nodes.find((n) => n.kind === 'stone')]) {
      check(!!node, 'missing gathering fixture');
      await position(page, server, e, node);
      await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Recoger', null, { timeout: 20000 });
      const before = server.world.profiles.get(e).eco.tradeRev;
      await interact(page, spec);
      await page.waitForFunction((rev) => !window.__mn.resources.pending && window.__mn.client.profile.eco.tradeRev > rev, before, { timeout: 20000 });
      await pause(650);
    }
    await position(page, server, e, bench);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Preparar');
    await interact(page, spec); await page.waitForFunction(() => window.__mn.panels.workbench.active);
    await click(page, spec, '[data-qty="3"]');
    check(await page.locator('.wb-confirm').isDisabled(), 'insufficient batch remained submittable');
    result.insufficientBatch = 'three-unit choice disabled with only two logs; no request or debit';
    await click(page, spec, '[data-qty="max"]');
    const before = structuredClone(server.world.profiles.get(e));
    result.preview = await page.evaluate(() => { const m = window.__mn, p = m.panels.workbench;
      return { qty: p.qty, owned: p.root.querySelector('[data-owned]').textContent, needed: p.root.querySelector('[data-needed]').textContent,
        space: p.root.querySelector('[data-pack-used]').textContent, confirmDisabled: p.root.querySelector('.wb-confirm').disabled,
        stage: { width: document.querySelector('#stage').clientWidth, height: document.querySelector('#stage').clientHeight } }; });
    check(result.preview.qty === 2 && result.preview.owned === '2' && result.preview.needed === '2' && !result.preview.confirmDisabled, 'batch preview disagrees with gathered cargo');
    result.layout = await page.evaluate(() => {
      const panel = document.querySelector('.workbench-panel').getBoundingClientRect();
      const controls = ['.wb-close', '.wb-confirm', '[data-qty="1"]', '[data-qty="3"]', '[data-qty="max"]', '[data-qty-input]'];
      return { insideViewport: panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1,
        controlsInsideViewport: controls.every((selector) => { const r = document.querySelector(selector).getBoundingClientRect();
          return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }) };
    });
    check(result.layout.insideViewport && result.layout.controlsInsideViewport, 'workbench panel or controls extend outside viewport');
    await screenshot(page, result, '01-batch-ready');
    let dropped = false;
    const originalSend = host.game.sendTo.bind(host.game);
    host.game.sendTo = (id, msg) => {
      if (msg?.t === 'event' && msg.ev?.type === 'resource' && msg.ev.op === 'craft') {
        result.acks.push(structuredClone(msg.ev));
        if (!spec.touch && !dropped && msg.ev.ok) { dropped = true; return; }
      }
      originalSend(id, msg);
    };
    await click(page, spec, '.wb-confirm');
    if (!spec.touch) {
      await page.waitForFunction(() => window.__mn.panels.workbench.pending && window.__mn.client.profile.eco.pack.goods.madera === 2);
      check(await page.locator('.wb-confirm').isDisabled(), 'pending batch remained submittable');
      const firstId = await page.evaluate(() => window.__mn.panels.workbench.pending.command.opId);
      await click(page, spec, '.wb-close');
      await position(page, server, e, { ...bench, x: bench.x + 4 });
      check(await page.evaluate(() => window.__mn.resources.interaction() === null
        && !window.__mn.panels.workbench.active && !!window.__mn.panels.workbench.pending), 'distant pending batch offered an unusable prompt or lost its intent');
      await position(page, server, e, bench);
      await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Preparar');
      await interact(page, spec); await page.waitForFunction(() => window.__mn.panels.workbench.active);
      check(await page.evaluate((id) => window.__mn.panels.workbench.pending?.command.opId === id, firstId), 'reopen lost the pending intent');
      await page.locator('.wb-retry').waitFor({ state: 'visible', timeout: 12000 });
      await click(page, spec, '.wb-retry');
      result.lostAckRecovery = { firstId, exactReplay: result.acks.length >= 2 && result.acks[0].opId === result.acks[1].opId };
    }
    await page.waitForFunction(() => !window.__mn.panels.workbench.pending && window.__mn.client.profile.eco.pack.goods.madera === 2, null, { timeout: 20000 });
    const after = structuredClone(server.world.profiles.get(e));
    check(after.eco.tradeRev === before.eco.tradeRev + 1 && after.eco.pack.goods.madera === 2
      && !after.eco.pack.goods.tronco && after.eco.pack.goods.piedra === 1 && after.gold === before.gold, 'batch conservation failed');
    check(result.acks.every((ack) => ack.ok && ack.count === 2 && ack.rev === after.eco.tradeRev), 'invalid batch acknowledgement');
    result.conservation = { before: before.eco.pack.goods, after: after.eco.pack.goods, revision: after.eco.tradeRev, goldUnchanged: true };
    await screenshot(page, result, '02-confirmed');
    await click(page, spec, '.wb-close');
    const [id, client] = clientFor(server, e);
    server.sendSave(id, client);
    await page.waitForFunction((blob) => { const m = window.__mn, key = `mareanegra.v1.save.online.${new URL(m.transport.url).host}`; return localStorage.getItem(key) === blob; }, client.lastBlob, { timeout: 20000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn.client.joined && window.__mn.client.profile.eco.pack.goods.madera === 2, null, { timeout: 90000 });
    const restored = await page.evaluate(() => window.__mn.client.profile);
    check(restored.eco.tradeRev === after.eco.tradeRev && restored.eco.pack.goods.piedra === 1 && restored.gold === after.gold, 'signed rejoin changed crafted cargo');
    result.reconnect = 'exact crafted cargo and revision restored from signed online save';
    check(result.errors.length === 0, `browser errors: ${result.errors.join('; ')}`);
    result.status = 'passed'; console.log(`${spec.name}: passed`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) {
      result.debug = await page.evaluate(() => { const m = window.__mn; return { joined: m?.client?.joined, mode: m?.st?.mode,
        pending: m?.panels.workbench?.pending, active: m?.panels.workbench?.active, resourcePending: m?.resources.pending, pack: m?.client?.profile?.eco?.pack,
        errors: m?.errors ? [...m.errors] : [] }; }).catch(() => null);
      await screenshot(page, result, 'failure').catch(() => {});
    }
    console.log(`${spec.name}: failed: ${error.message}`);
  } finally { if (context) await context.close(); await host.close(); }
}
try {
  const selected = process.env.MN_WORKBENCH_VIEWPORT ? specs.filter((s) => s.name === process.env.MN_WORKBENCH_VIEWPORT) : specs;
  check(selected.length > 0, 'unknown viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.status = evidence.failures.length ? 'failed' : 'passed';
await writeFile(resolve(out, process.env.MN_WORKBENCH_VIEWPORT ? `${process.env.MN_WORKBENCH_VIEWPORT}.json` : 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, results: evidence.viewports.map(({ name, status, failure }) => ({ name, status, failure })) }));
if (evidence.failures.length) process.exitCode = 1;

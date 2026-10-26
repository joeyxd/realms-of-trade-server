// Isolated real WebSocket/browser acceptance with 250ms in each network direction.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';

const out = resolve(process.env.MN_FEEDBACK_OUT || '.scratch/resource-feedback');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { generatedAt: new Date().toISOString(), roundTripMs: 500, setup: 'Ephemeral memory worlds, server relocation/tool fixtures; real F/touch collection and canonical inventory. No production data.', views: [] };
const check = (ok, message) => { if (!ok) throw new Error(message); };
try {
  for (const spec of [{ name: 'desktop', width: 1280, height: 720, touch: false },
    { name: 'touch-landscape', width: 844, height: 390, touch: true }, { name: 'touch-portrait', width: 390, height: 844, touch: true }]) {
    const result = { ...spec, errors: [], checks: [], screenshots: [] }; evidence.views.push(result);
    const host = createGameServer({ host: '127.0.0.1', port: 0, seed: GAME.seed, bots: 0, maxPlayers: 1,
      worldId: null, store: createMemoryStore(), saveSecret: 'isolated-resource-feedback', lagMs: 250, jitterMs: 0, dev: false, chat: { enabled: false }, log() {} });
    let context;
    try {
      const port = await host.listen(), server = host.game.server;
      context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
      const page = await context.newPage();
      page.on('pageerror', (error) => result.errors.push(error.message));
      await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
        const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        const file = resolve(match[1].startsWith('three') ? (process.env.MN_THREE || 'node_modules/three') : (process.env.MN_GSAP || '.scratch/gsap-local/package'), match[2]);
        return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
      });
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 90000 });
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 60000 });
      const e = await page.evaluate(() => window.__mn.client.youServer), w = server.world, c = w.ecs;
      const [id, actor] = [...server.clients].find(([, client]) => client.entity === e);
      const profile = w.profiles.get(e); profile.tools.axe = 1; profile.tools.pickaxe = 1;
      server.sendProfile(id, actor);
      await page.waitForFunction(() => window.__mn.client.profile.tools.axe === 1);
      await page.evaluate(() => {
        const r = window.__mn.resources, change = r.onChange, send = window.__mn.client.send.bind(window.__mn.client);
        window.__feedback = [];
        window.__mn.client.send = (command) => {
          if (command.type === 'resource' && command.op === 'gather') window.__sendTime = performance.now();
          return send(command);
        };
        r.onChange = () => { change?.(); if (r.gathers.size) window.__feedback.push({ elapsed: performance.now() - window.__sendTime,
          projected: r.backpack(), canonical: structuredClone(window.__mn.client.profile.eco.pack.goods), prompt: r.interaction()?.html }); };
      });
      for (const kind of ['stone', 'wood']) {
        const node = [...w.resources.nodes.values()].find((n) => n.kind === kind && n.readyTick <= w.tick);
        check(node, `missing ${kind} fixture`);
        c.x[e] = node.x; c.y[e] = node.y; c.z[e] = node.z; c.vx[e] = c.vz[e] = c.kbx[e] = c.kbz[e] = c.moveMag[e] = 0;
        c.dashT[e] = -1; c.dashBuffer[e] = c.atkStage[e] = c.castK[e] = c.castLock[e] = 0; c.regenT[e] = 100;
        server.broadcastSnapshot();
        await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.ps.x - x, window.__mn.ps.z - z) < .3, node, { timeout: 15000 });
        await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Recoger');
        if (spec.touch) await page.locator('#touch .t-act').tap({ force: true }); else await page.keyboard.press('KeyF');
        const good = kind === 'stone' ? 'piedra' : 'tronco';
        await page.waitForFunction((g) => window.__mn.client.profile.eco.pack.goods[g] === 1 && !window.__mn.resources.pending, good, { timeout: 15000 });
        const sample = await page.evaluate((g) => window.__feedback.find((x) => x.projected.pendingGoods[g] === 1), good);
        check(sample && sample.elapsed < 100 && !sample.canonical[good] && !/Esperando|Wait/.test(sample.prompt || ''), `${kind}: no immediate feedback`);
        result.checks.push({ kind, immediateMs: sample.elapsed, canonicalAfter: profile.eco.pack.goods[good] });
      }
      if (spec.touch) await page.locator('#hud-bag').tap(); else await page.keyboard.press('KeyI');
      await page.waitForFunction(() => window.__mn.panels.charPanel.isOpen);
      await page.locator('.pack-inventory').scrollIntoViewIfNeeded();
      check(await page.locator('.pack-good').count() === 2, 'inventory must show the two gathered materials');
      check(await page.locator('.belt-tool').count() === 2, 'utility tools missing');
      const bounds = await page.locator('.pack-inventory').boundingBox();
      check(bounds.x >= 0 && bounds.x + bounds.width <= spec.width + 1, 'materials overflow viewport');
      const screenshot = resolve(out, `${spec.name}.png`); await page.screenshot({ path: screenshot }); result.screenshots.push(screenshot);
      if (!spec.touch) {
        await page.evaluate(() => { document.documentElement.lang = 'en'; window.__mn.panels.charPanel.refresh(); });
        check(await page.locator('.pack-heading h4').innerText() === 'Materials pack', 'English labels missing');
      }
      check(result.errors.length === 0, `browser errors: ${result.errors.join('; ')}`);
      result.status = 'passed'; console.log(`${spec.name}: passed`);
    } catch (error) { result.status = 'failed'; result.failure = String(error.stack || error); console.log(`${spec.name}: ${error.message}`); }
    finally { await context?.close(); await host.close(); }
  }
} finally { await browser.close(); }
await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
if (evidence.views.some((view) => view.status !== 'passed')) process.exitCode = 1;

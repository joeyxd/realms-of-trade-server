#!/usr/bin/env node
// Real bootstrap, utility tool crafting and mining, shared protocol and signed-save recovery on isolated local hosts.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const out = resolve('docs/delivery/d08c7d-tools');
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
  // Teleport fixtures must settle the normal follow camera before capturing the interaction.
  await page.evaluate(() => { window.__mn.st.snapCam = true; });
  await page.waitForFunction(() => !window.__mn.st.snapCam);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
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
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-tools-${spec.name}`, chat: { enabled: false }, log() {} });
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
    await page.evaluate(() => {
      const w = window.__mn.panels.workbench, confirm = w.confirm.bind(w);
      window.__toolQaClicks = [];
      w.confirm = () => {
        window.__toolQaClicks.push({ qty: w.qty, recipe: w.recipe, context: !!w.context(), pending: !!w.pending });
        const result = confirm(); window.__toolQaClicks.at(-1).result = result;
        window.__toolQaClicks.at(-1).lastResult = w.lastResult;
        return result;
      };
    });
    const originalSend = host.game.sendTo.bind(host.game);
    host.game.sendTo = (id, msg) => {
      if (msg?.t === 'event' && msg.ev?.type === 'resource') result.acks.push(structuredClone(msg.ev));
      originalSend(id, msg);
    };
    const nodes = [...server.world.resources.nodes.values()], profile = server.world.profiles.get(e);
    const wood = nodes.filter(n => n.kind === 'wood'), stones = nodes.filter(n => n.kind === 'stone');
    const palm = nodes.find(n => n.kind === 'palm'), rock = nodes.find(n => n.kind === 'rock'), ore = nodes.find(n => n.kind === 'iron_ore');
    result.catalogue = nodes.reduce((a, n) => (a[n.kind] = (a[n.kind] || 0) + 1, a), {});
    check(nodes.length === 206 && rock && ore, 'missing mining catalogue');
    check(profile.tools.axe === 0 && profile.tools.pickaxe === 0 && Object.keys(profile.eco.pack.goods).length === 0, 'guest did not start empty');
    const combatWeapon = structuredClone(profile.eq.weapon);
    const cooldown = () => page.waitForFunction(() => !window.__mn.resources.pending
      && performance.now() >= window.__mn.resources.gatherUntil, null, { timeout: 20000 });
    const at = async node => {
      const p = node.kind === 'palm' || node.kind === 'rock' || node.kind === 'iron_ore'
        ? { x: node.x + 1.75, z: node.z } : { x: node.x, z: node.z };
      p.y = server.world.map.groundAt(p.x, p.z); await position(page, server, e, p);
    };
    const gather = async node => {
      await cooldown(); await at(node);
      await page.waitForFunction(id => window.__mn.resources.interaction()?.html
        && window.__mn.client.resources.nodes.find(n => n.id === id)?.ready, node.id);
      const before = result.acks.length, expectedRev = node.rev + 1; await interact(page, spec);
      await page.waitForFunction(({ id, rev }) => !window.__mn.resources.pending
        && window.__mn.client.resources.nodes.find(n => n.id === id)?.rev === rev,
        { id: node.id, rev: expectedRev }, { timeout: 20000 });
      check(result.acks.length === before + 1 && result.acks.at(-1).ok, `gather denied ${node.id}: ${JSON.stringify(result.acks.at(-1))}`);
    };
    const craft = async (recipe, n = 1, capture = '') => {
      await cooldown(); await position(page, server, e, server.world.resources.bench);
      await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Preparar');
      await interact(page, spec); await page.waitForFunction(() => window.__mn.panels.workbench.active);
      await click(page, spec, `[data-recipe="${recipe}"]`);
      if (recipe === 'madera' && n > 1) await click(page, spec, '[data-qty="max"]');
      check(await page.locator('.wb-confirm').isEnabled(), `recipe disabled: ${recipe}`);
      if (capture) await screenshot(page, result, capture + '-ready');
      const before = result.acks.length, expectedRev = profile.eco.tradeRev + 1;
      await click(page, spec, '.wb-confirm');
      await page.waitForFunction(rev => !window.__mn.panels.workbench.pending
        && window.__mn.client.profile.eco.tradeRev === rev, expectedRev, { timeout: 20000 });
      check(result.acks.length === before + 1 && result.acks.at(-1).ok, `craft denied: ${recipe}`);
      check(profile.eco.tradeRev === result.acks.at(-1).rev, 'craft profile revision differs');
      if (capture) await screenshot(page, result, capture + '-done');
      await click(page, spec, '.wb-close');
      await pause(550);
    };
    await at(palm);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.html.includes('necesitas'));
    const missingBefore = result.acks.length; await interact(page, spec); await pause(200);
    check(result.acks.length === missingBefore && palm.rev === 1, 'UI did not gate missing axe');
    await screenshot(page, result, '00-tool-required');
    await gather(wood[0]); await gather(stones[0]); await craft('madera');
    await craft('hacha_piedra', 1, '01-axe');
    check(profile.tools.axe === 1 && Object.keys(profile.eco.pack.goods).length === 0, 'axe materials not conserved');
    // The actual crafted axe supplies logs for the pickaxe.
    for (let i = 0; i < 3; i++) {
      await gather(palm);
      check(result.acks.at(-1).count === (i === 2 ? 2 : 0), 'invalid tree yield');
      if (i === 0) await screenshot(page, result, '02-axe-chop');
    }
    await pause(1100); await screenshot(page, result, '03-stump');
    await craft('madera', 2);
    await gather(stones[1]); await gather(stones[2]);
    await craft('pico_piedra', 1, '04-pickaxe');
    check(profile.tools.pickaxe === 1 && profile.eco.pack.goods.madera === 1, 'pickaxe cost not conserved');
    for (const node of [rock, ore]) {
      const hits = node.kind === 'rock' ? 4 : 5;
      for (let i = 0; i < hits; i++) {
        await gather(node);
        check(result.acks.at(-1).count === (i === hits - 1 ? node.kind === 'rock' ? 2 : 1 : 0), 'invalid mining yield');
        if (i === 0) {
          result[node.kind + 'Visual'] = await page.evaluate(id => { const m = window.__mn, view = m.world.views.get(m.client.youServer), record = m.world.resources.records.get(id);
            return { tool: view.harvestTool?.userData.tool, visible: view.harvestTool?.visible, pose: !!view.harvestPose,
              scale: record?.mesh.scale.x, cracks: !!record?.cracks?.visible, meta: m.world.resources.group.userData.miningResources }; }, node.id);
          check(result[node.kind + 'Visual'].tool === 'pickaxe' && result[node.kind + 'Visual'].visible, 'pickaxe visual missing');
          await screenshot(page, result, node.kind + '-first-hit');
        }
      }
      await pause(700); await screenshot(page, result, node.kind + '-depleted');
      check(node.readyTick > server.world.tick, 'mined node did not deplete');
    }
    check(JSON.stringify(profile.eq.weapon) === JSON.stringify(combatWeapon), 'gathering replaced combat weapon');
    check(JSON.stringify(profile.eco.pack.goods) === JSON.stringify({ madera: 1, piedra: 2, mineral_hierro: 1 }), 'final inventory differs');
    // Full pack cannot damage the next rock or start a second yield.
    const next = nodes.find(n => n.kind === 'rock' && n.id !== rock.id);
    await cooldown(); await at(next);
    const before = result.acks.length; await interact(page, spec);
    for (let i = 0; i < 400 && result.acks.length === before; i++) await pause(50);
    await page.waitForFunction(() => !window.__mn.resources.pending);
    check(result.acks.length === before + 1 && result.acks.at(-1).why === 'full' && next.rev === 1, 'full pack changed next rock');
    result.conservation = { tools: structuredClone(profile.tools), goods: structuredClone(profile.eco.pack.goods), tradeRev: profile.eco.tradeRev, weaponPreserved: true };
    const saved = structuredClone(profile), [id, client] = clientFor(server, e);
    server.sendSave(id, client);
    await page.waitForFunction(blob => { const m = window.__mn, key = `mareanegra.v1.save.online.${new URL(m.transport.url).host}`;
      return localStorage.getItem(key) === blob; }, client.lastBlob);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn.client.joined && window.__mn.client.profile.tools?.pickaxe === 1, null, { timeout: 90000 });
    const restored = await page.evaluate(() => window.__mn.client.profile);
    check(JSON.stringify(restored.tools) === JSON.stringify(saved.tools) && JSON.stringify(restored.eco.pack) === JSON.stringify(saved.eco.pack)
      && restored.eco.tradeRev === saved.eco.tradeRev && restored.gold === saved.gold, 'signed rejoin changed tools or ore');
    result.reconnect = 'actual crafted axe/pickaxe, raw ore, pack and revision preserved in signed save';
    check(result.errors.length === 0, `browser errors: ${result.errors.join('; ')}`);
    result.status = 'passed'; console.log(`${spec.name}: passed`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) { result.debug = await page.evaluate(() => { const m = window.__mn;
      return { joined: m?.client?.joined, mode: m?.st?.mode, pending: m?.resources.pending, workbench: m?.panels.workbench.pending, profile: m?.client?.profile,
        metadata: m?.world?.resources?.group?.userData, clicks: window.__toolQaClicks,
        workbenchStatus: m?.panels.workbench.lastResult, errors: m?.errors ? [...m.errors] : [] }; }).catch(() => null);
      await screenshot(page, result, 'failure').catch(() => {}); }
    console.log(`${spec.name}: failed: ${error.message}`);
  } finally { if (context) await context.close(); await host.close(); }
}
try {
  const selected = process.env.MN_TOOLS_VIEWPORT ? specs.filter(s => s.name === process.env.MN_TOOLS_VIEWPORT) : specs;
  check(selected.length > 0, 'unknown viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.status = evidence.failures.length ? 'failed' : 'passed';
await writeFile(resolve(out, process.env.MN_TOOLS_VIEWPORT ? `${process.env.MN_TOOLS_VIEWPORT}.json` : 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, results: evidence.viewports.map(({ name, status, failure }) => ({ name, status, failure })) }));
if (evidence.failures.length) process.exitCode = 1;

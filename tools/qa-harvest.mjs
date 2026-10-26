#!/usr/bin/env node
// Real palm/stone gathering, shared protocol and signed-save recovery on isolated local hosts.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const out = resolve('docs/delivery/d08c7c-harvest');
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
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-harvest-${spec.name}`, chat: { enabled: false }, log() {} });
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
    // This legacy palm-only rehearsal starts with a utility axe. D08c.7d's separate QA
    // proves fabrication from an empty pack; this fixture grants no harvest materials.
    server.world.profiles.get(e).tools.axe = 1;
    const [fixtureId, fixtureClient] = clientFor(server, e);
    server.sendProfile(fixtureId, fixtureClient);
    await page.waitForFunction(() => window.__mn.client.profile.tools?.axe === 1);
    const originalSend = host.game.sendTo.bind(host.game);
    host.game.sendTo = (id, msg) => {
      if (msg?.t === 'event' && msg.ev?.type === 'resource') result.acks.push(structuredClone(msg.ev));
      originalSend(id, msg);
    };
    const nodes = [...server.world.resources.nodes.values()], spawn = server.world.map.landmarks.spawn;
    const palms = nodes.filter((n) => n.kind === 'palm').sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z));
    const palm = palms[0];
    check(palm && palms.length >= 70, 'missing dense palm catalogue');
    check(nodes.filter((n) => n.kind === 'stone').length >= 50, 'missing dense stone catalogue');
    result.catalogue = { total: nodes.length, palms: palms.length, stones: nodes.filter((n) => n.kind === 'stone').length,
      bytes: Buffer.byteLength(JSON.stringify((await page.evaluate(() => window.__mn.client.resources)))) };
    const angle = Math.atan2(spawn.x - palm.x, spawn.z - palm.z);
    const stand = { x: palm.x + Math.sin(angle) * 1.2, z: palm.z + Math.cos(angle) * 1.2 };
    stand.y = server.world.map.groundAt(stand.x, stand.z);
    await position(page, server, e, stand);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Cortar', null, { timeout: 20000 });
    await pause(400); await screenshot(page, result, '00-palm-ready');
    const profileBefore = structuredClone(server.world.profiles.get(e));
    for (let hit = 1; hit <= 3; hit++) {
      await page.waitForFunction(() => !window.__mn.resources.pending && performance.now() >= window.__mn.resources.gatherUntil, null, { timeout: 20000 });
      const before = result.acks.length;
      await interact(page, spec);
      await page.waitForFunction(({ node, hits }) => { const m = window.__mn;
        return !m.resources.pending && m.client.resources.nodes.find((n) => n.id === node)?.hits === hits; }, { node: palm.id, hits: hit }, { timeout: 20000 });
      check(result.acks.length === before + 1 && result.acks.at(-1).ok, 'real chop was denied or duplicated');
      check(result.acks.at(-1).count === (hit === 3 ? 2 : 0), 'invalid palm yield acknowledgement');
      if (hit < 3) check(!server.world.profiles.get(e).eco.pack.goods.tronco, 'logs granted before felling');
      if (hit === 1) {
        result.hitVisual = await page.evaluate(() => { const m = window.__mn, view = m.world.views.get(m.client.youServer);
          return { metadata: m.world.resources.group.userData.palmResources, pose: !!view.harvestPose,
            hatchetVisible: !!view.harvestTool?.visible }; });
        check(result.hitVisual.pose && result.hitVisual.hatchetVisible && result.hitVisual.metadata.lastHit?.rev === 2, 'chop pose, tool or authoritative impact missing');
        await screenshot(page, result, '01-first-chop');
      }
      if (hit === 3) await screenshot(page, result, '02-falling');
    }
    await pause(1150);
    result.stump = await page.evaluate((id) => { const m = window.__mn, view = m.world.resources, node = m.client.resources.nodes.find((n) => n.id === id);
      return { ready: node.ready, hits: node.hits, record: view.palmRecords.get(id)?.felled,
        metadata: view.group.userData.palmResources, prompt: m.resources.interaction()?.html }; }, palm.id);
    check(!result.stump.ready && result.stump.record && result.stump.metadata.stumps >= 1, 'felled tree did not become a stump');
    await screenshot(page, result, '03-stump');
    const afterPalm = structuredClone(server.world.profiles.get(e));
    check(afterPalm.eco.pack.goods.tronco === 2 && afterPalm.eco.tradeRev === profileBefore.eco.tradeRev + 1, 'palm inventory conservation failed');
    // This is an actual server admission denial: the full pack cannot receive another two-log yield.
    const next = palms.find((n) => n.id !== palm.id && n.readyTick === 0);
    const nextStand = { x: next.x + 1.2, z: next.z, y: server.world.map.groundAt(next.x + 1.2, next.z) };
    await position(page, server, e, nextStand);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Cortar');
    const beforeFull = result.acks.length;
    await interact(page, spec);
    await page.waitForFunction(() => !window.__mn.resources.pending);
    await pause(200);
    check(result.acks.length === beforeFull + 1 && result.acks.at(-1).why === 'full' && next.rev === 1, 'full pack damaged a second palm');
    result.fullPack = 'second full palm yield rejected; node and inventory unchanged';
    const stone = nodes.filter((n) => n.kind === 'stone').sort((a, b) => Math.hypot(a.x - palm.x, a.z - palm.z) - Math.hypot(b.x - palm.x, b.z - palm.z))[0];
    await position(page, server, e, stone);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Recoger');
    await screenshot(page, result, '04-stone-ready');
    await interact(page, spec);
    await page.waitForFunction(() => !window.__mn.resources.pending && window.__mn.client.profile.eco.pack.goods.piedra === 1);
    await pause(300); await screenshot(page, result, '05-stone-collected');
    check(stone.rev === 2 && stone.readyTick > server.world.tick, 'shared stone did not deplete');
    const after = structuredClone(server.world.profiles.get(e));
    check(after.eco.pack.goods.tronco === 2 && after.eco.pack.goods.piedra === 1 && after.gold === profileBefore.gold, 'gathered cargo or gold changed');
    result.conservation = { before: profileBefore.eco.pack.goods, after: after.eco.pack.goods, goldUnchanged: true };
    // The harvested logs feed the existing workbench through its real panel and maximum batch control.
    await position(page, server, e, server.world.resources.bench);
    await page.waitForFunction(() => window.__mn.resources.interaction()?.verb === 'Preparar');
    await interact(page, spec); await page.waitForFunction(() => window.__mn.panels.workbench.active);
    await click(page, spec, '[data-qty="max"]'); await click(page, spec, '.wb-confirm');
    await page.waitForFunction(() => !window.__mn.panels.workbench.pending && window.__mn.client.profile.eco.pack.goods.madera === 2);
    await screenshot(page, result, '06-palm-wood-crafted'); await click(page, spec, '.wb-close');
    const saved = structuredClone(server.world.profiles.get(e));
    const [id, client] = clientFor(server, e); server.sendSave(id, client);
    await page.waitForFunction((blob) => { const m = window.__mn, key = `mareanegra.v1.save.online.${new URL(m.transport.url).host}`;
      return localStorage.getItem(key) === blob; }, client.lastBlob, { timeout: 20000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn.client.joined && window.__mn.client.profile.eco.pack.goods.madera === 2, null, { timeout: 90000 });
    const restored = await page.evaluate(() => window.__mn.client.profile);
    check(restored.eco.tradeRev === saved.eco.tradeRev && restored.eco.pack.goods.piedra === 1 && restored.gold === saved.gold, 'signed rejoin changed gathered/crafted cargo');
    result.reconnect = 'two wood and one stone preserved with exact revision/gold in signed online save';
    check(result.errors.length === 0, `browser errors: ${result.errors.join('; ')}`);
    result.status = 'passed'; console.log(`${spec.name}: passed`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) {
      result.debug = await page.evaluate(() => { const m = window.__mn;
        return { joined: m?.client?.joined, mode: m?.st?.mode, pending: m?.resources.pending, pack: m?.client?.profile?.eco?.pack,
          resources: m?.world?.resources?.group?.userData, errors: m?.errors ? [...m.errors] : [] }; }).catch(() => null);
      await screenshot(page, result, 'failure').catch(() => {});
    }
    console.log(`${spec.name}: failed: ${error.message}`);
  } finally { if (context) await context.close(); await host.close(); }
}
try {
  const selected = process.env.MN_HARVEST_VIEWPORT ? specs.filter((s) => s.name === process.env.MN_HARVEST_VIEWPORT) : specs;
  check(selected.length > 0, 'unknown viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.status = evidence.failures.length ? 'failed' : 'passed';
await writeFile(resolve(out, process.env.MN_HARVEST_VIEWPORT ? `${process.env.MN_HARVEST_VIEWPORT}.json` : 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, results: evidence.viewports.map(({ name, status, failure }) => ({ name, status, failure })) }));
if (evidence.failures.length) process.exitCode = 1;

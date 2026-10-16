#!/usr/bin/env node
// RNV03 visual acceptance for near-black nights and the portable lantern.
// Optional local guard so the integrating agent can prepare the harness without launching Chrome.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { killPlayer } from '../src/sim/systems/combat.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') {
  throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to run this local harness.');
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv03-dark-night');
await mkdir(out, { recursive: true });
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const { default: WebSocket } = await import('ws');
const threeRoot = resolve(repo, 'node_modules/three');
const gsapRoot = resolve(process.env.MN_GSAP || resolve(repo, '.scratch/gsap-local/package'));
const specs = [
  { name: 'night-desktop-low-es', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'night-desktop-high-en', width: 1280, height: 720, touch: false, quality: 'high', locale: 'en' },
  { name: 'night-mobile-low-en', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
  { name: 'night-mobile-high-es', width: 390, height: 844, touch: true, quality: 'high', locale: 'es' },
];
const selectedViewport = process.env.MN_QA_VIEWPORT;
if (selectedViewport) {
  const selected = specs.filter((spec) => spec.name.includes(selectedViewport));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${selectedViewport}`);
  specs.splice(0, specs.length, ...selected);
}
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify a dark night with no automatic player fill, usable portable light on foot, authoritative light state, and day-preset resistance.',
  harness: 'Disposable GameHost and memory store per viewport; local Three.js/GSAP/fonts; Chrome4viewports. No production server, SQL, external assets, or physical-device performance claim.',
  fixture: 'The server clock is fixed to midnight and dawn in turn; camera/player projection is awaited after relocations. One test player uses an isolated coast and the actual lantern-lit dock, then a second raw WebSocket guest verifies public light visibility and death reset.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitUntil(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(25); }
  throw new Error(`timed out waiting for ${label}`);
}
async function waitForCameraAt(page, point, label) {
  await page.waitForFunction(({ x, z }) => {
    const app = window.__mn, cur = app?.client?.cur, rig = app?.world?.rig;
    return !!cur && !!rig && !rig.blend && Math.hypot(rig.target.x - cur.x, rig.target.z - cur.z) < 0.5 &&
      Math.hypot(cur.x - x, cur.z - z) < 0.5;
  }, point, { timeout: 15000 });
  await page.waitForFunction(() => {
    const app = window.__mn, view = app?.world?.views?.get(app?.client?.youServer);
    if (!view?.root?.visible || !app?.world?.camera) return false;
    const p = view.root.position.clone(); p.y += 0.9; p.project(app.world.camera);
    return p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.92;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const camera = await page.evaluate(() => {
    const app = window.__mn, cur = app.client.cur, rig = app.world.rig, view = app.world.views.get(app.client.youServer);
    const p = view.root.position.clone(); p.y += 0.9; p.project(app.world.camera);
    return { blend: !!rig.blend, target: { x: rig.target.x, y: rig.target.y, z: rig.target.z },
      player: { x: cur.x, y: cur.y, z: cur.z }, projection: { x: p.x, y: p.y, z: p.z,
        screenX: (p.x + 1) * innerWidth * 0.5, screenY: (1 - p.y) * innerHeight * 0.5 } };
  });
  if (camera.blend || Math.hypot(camera.target.x - camera.player.x, camera.target.z - camera.player.z) >= 0.5 ||
      Math.abs(camera.projection.x) >= 0.92 || Math.abs(camera.projection.y) >= 0.92 || camera.projection.z < -1 || camera.projection.z > 1)
    throw new Error(`${label} camera/player projection did not settle: ${JSON.stringify(camera)}`);
  return camera;
}
async function waitHealthy(port) {
  const deadline = Date.now() + 30000; let last = null;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); last = { status: response.status, body: await response.text() }; if (response.status === 200) return; }
    catch (error) { last = String(error); }
    await pause(100);
  }
  throw new Error(`GameHost did not become healthy: ${JSON.stringify(last)}`);
}
async function installRoutes(page, result) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    result.externalRequests.push(url.href); return route.abort();
  });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}
async function openApp(page, port, result) {
  page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', (response) => { if (response.status() >= 400) result.httpFailures.push({ url: response.url(), status: response.status() }); });
  page.on('websocket', (socket) => result.websockets.push({ url: socket.url() }));
  await installRoutes(page, result);
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ timeOfDay: 'day' })), { key: `${GAME.saveKey}.settings` });
  await page.goto(`http://127.0.0.1:${result.port}/?debug&q=${result.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.evaluate((locale) => { document.documentElement.lang = locale; }, result.locale);
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}

function chooseCoastalSite(world, staticLights) {
  const map = world.map, half = Math.floor(map.size / 2) - 12, candidates = [];
  const lights = Array.isArray(staticLights) ? staticLights.filter((source) => source.i > 0 && source.kind !== 'boss') : [];
  for (let z = -half; z <= half; z += 4) for (let x = -half; x <= half; x += 4) {
    const y = map.groundAt(x, z);
    if (!(y > 0.65 && y <= 1.7) || map.onDock?.(x, z) || map.zoneAt?.(x, z) !== 'playa') continue;
    if ((map.colliders || []).some((c) => Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 2.2)) continue;
    if ((map.props || []).some((p) => ['campfire', 'lantern', 'brazier', 'hut', 'gatePost'].includes(p.kind) && Math.hypot(x - p.x, z - p.z) < 6)) continue;
    const lightDistance = lights.reduce((best, s) => Math.min(best, Math.hypot(x - s.x, z - s.z)), Infinity);
    if (lightDistance < 18) continue;
    const spawn = map.landmarks.spawn, spawnDistance = Math.hypot(x - spawn.x, z - spawn.z);
    candidates.push({ x, y, z, lightDistance, spawnDistance });
  }
  candidates.sort((a, b) => b.lightDistance - a.lightDistance || a.spawnDistance - b.spawnDistance);
  return candidates[0] || null;
}
function choosePortPoint(world, staticLights) {
  const map = world.map, base = map.landmarks.dockBase, end = map.landmarks.dockEnd;
  const lamps = (staticLights || []).filter((source) => source.kind === 'lantern');
  let best = null;
  for (let i = 1; i < 100; i++) {
    const t = i / 100, x = base.x + (end.x - base.x) * t, z = base.z + (end.z - base.z) * t;
    if (!map.onDock(x, z)) continue;
    const y = map.groundAt(x, z), nearest = lamps.reduce((result, source) => {
      const d = Math.hypot(x - source.x, z - source.z);
      return d < result.distance ? { source, distance: d } : result;
    }, { source: null, distance: Infinity });
    if (nearest.distance <= 8 && (!best || nearest.distance < best.distance))
      best = { x, y, z, staticLamp: nearest.source.kind, lightDistance: nearest.distance };
  }
  return best;
}
function relocate(world, server, entity, point, facing = 0) {
  const e = world.ecs;
  e.x[entity] = point.x; e.y[entity] = point.y; e.z[entity] = point.z; e.facing[entity] = facing;
  e.vx[entity] = e.vz[entity] = e.kbx[entity] = e.kbz[entity] = e.moveMag[entity] = 0;
  e.dashT[entity] = -1; e.dashBuffer[entity] = 0; e.atkStage[entity] = 0; e.castK[entity] = 0; e.castLock[entity] = 0;
  server.broadcastSnapshot();
}

async function connectGuest(port, name) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  socket.on('message', (data) => { try { inbox.push(JSON.parse(String(data))); } catch {} });
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
  socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save: '' }));
  const welcome = await waitUntil(() => inbox.find((m) => m.t === 'welcome'), `${name} welcome`, 15000);
  return { socket, inbox, entity: welcome.you };
}

async function run(browser, spec) {
  const result = { ...spec, port: 0, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [],
    httpFailures: [], externalRequests: [], websockets: [], screenshots: [], acks: [], assertions: {} };
  evidence.viewports.push(result);
  const hostLogs = [];
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 3, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `qa-night-lantern-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, guest2, server, world, player, site;
  const screenshot = async (label) => {
    await page.waitForTimeout(200);
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88 });
    result.screenshots.push(file); return file;
  };
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); player = await openApp(page, result.port, result);
    const staticLights = await page.evaluate(() => window.__mn.world.lights.staticSources.map(({ x, z, i, kind }) => ({ x, z, i, kind })));
    site = chooseCoastalSite(world, staticLights);
    check(site, 'map had no isolated dry coastal fixture 18 units from static light sources');
    result.fixtureSite = site;
    world.economy.hours = 24; world.economy.acc = 0;
    relocate(world, server, player, site, 0);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < 0.5,
      { x: site.x, z: site.z }, { timeout: 15000 });
    result.cameraStates = [{ label: 'isolated-coast', ...(await waitForCameraAt(page, site, 'coastal fixture')) }];
    await page.waitForFunction(() => Math.abs(window.__mn.world.lighting.phase - 0.75) < 0.015 && window.__mn.world.lighting.cur.sunI <= 0.02,
      null, { timeout: 15000 });
    await page.evaluate(() => window.__mn.tod('day'));
    await page.waitForFunction(() => window.__mn.world.lighting.cur.sunI <= 0.02 && Math.abs(window.__mn.world.lighting.phase - 0.75) < 0.02,
      null, { timeout: 5000 });
    const night = await page.evaluate(() => ({ sunIntensity: window.__mn.world.lighting.cur.sunI,
      phase: window.__mn.world.lighting.phase, savedPreference: window.__mn.settings.timeOfDay,
      automaticPlayerFill: window.__mn.world.lights.knobs.player ?? 0,
      sourcesAtOff: window.__mn.world.lights.portableSources.size }));
    check(night.sunIntensity <= 0.02 && Math.abs(night.phase - 0.75) < 0.02, `day preference changed gameplay night: ${JSON.stringify(night)}`);
    check(night.automaticPlayerFill === 0, `automatic player fill remains enabled: ${night.automaticPlayerFill}`);
    check(night.sourcesAtOff === 0, `portable source was already on before intent: ${night.sourcesAtOff}`);
    result.nightAndPreference = night;
    result.stage = 'dark-unlit-foot';
    await screenshot('01-dark-no-personal-light');
    const button = page.locator('#personal-lantern');
    await button.waitFor({ state: 'visible', timeout: 10000 });
    const bounds = await button.boundingBox();
    check(bounds && bounds.width >= 48 && bounds.height >= 48, `portable-light control is too small: ${JSON.stringify(bounds)}`);
    const hudGeometry = await page.evaluate(() => {
      const rect = (el) => { const r = el?.getBoundingClientRect(); return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const a = rect(document.querySelector('#personal-lantern'));
      const obstacles = ['#touch .t-cluster', '.tracker', '.raft-build-launcher', '.raft-hold-launcher']
        .map((selector) => { const el = document.querySelector(selector); return { selector, visible: !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden', bounds: rect(el) }; })
        .filter((item) => item.visible);
      const overlap = (p, q) => !!p && !!q && p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
      return { control: a, obstacles, overlaps: obstacles.filter(({ bounds }) => overlap(a, bounds)).map(({ selector }) => selector) };
    });
    check(!hudGeometry.overlaps.length, `portable-light button overlaps other HUD controls: ${JSON.stringify(hudGeometry)}`);
    result.control = { bounds, hudGeometry, text: await button.textContent(), ariaLabel: await button.getAttribute('aria-label') };
    check((spec.locale === 'en' ? /Lantern/ : /Farol/).test(result.control.text), `button lacks localized name: ${result.control.text}`);

    const toggleSelf = async (lit) => {
      if (spec.touch) await button.tap(); else await page.keyboard.press('n');
      await waitUntil(() => world.ecs.lantern[player] === Number(lit), `server portable lantern ${lit ? 'on' : 'off'}`);
      await page.waitForFunction((value) => window.__mn.client.personalLantern === value, lit, { timeout: 12000 });
      if (lit) await page.waitForFunction((id) => window.__mn.world.lights.portableSources.has(String(id)), player, { timeout: 12000 });
      else await page.waitForFunction((id) => !window.__mn.world.lights.portableSources.has(String(id)), player, { timeout: 12000 });
    };
    result.stage = 'server-lit-portable-light';
    await toggleSelf(true);
    const ownSource = await page.evaluate(async (id) => {
      const source = window.__mn.world.lights.portableSources.get(String(id));
      const view = window.__mn.world.views.get(id);
      const { U } = await import('/src/render/toon.js');
      const count = U.mnLightCount.value;
      const uniform = Array.from({ length: count }, (_, i) => ({ p: U.mnLightPos.value[i].toArray(), c: U.mnLightCol.value[i].toArray() }))
        .find(({ p }) => Math.hypot(p[0] - source.x, p[2] - source.z) < 0.08);
      return { x: source.x, y: source.y, z: source.z, r: source.r, w: source.w, priority: source.priority,
        coreVisible: !!view?.personalLanternCore?.visible, uniform, lightCount: count };
    }, player);
    check(ownSource.r === 7.5 && ownSource.w >= 0.99 && ownSource.priority === 2, `own light source has wrong coverage/priority: ${JSON.stringify(ownSource)}`);
    check(ownSource.coreVisible && ownSource.uniform?.c?.[0] > ownSource.uniform?.c?.[2], `character prop or warm shader source missing: ${JSON.stringify(ownSource)}`);
    result.ownPortableSource = ownSource;
    await screenshot('02-personal-lantern-on');
    await screenshot('02b-personal-lantern-on-late');

    result.stage = 'movement-follows-player';
    const beforeMove = await page.evaluate((id) => ({ x: window.__mn.client.cur.x, z: window.__mn.client.cur.z,
      light: window.__mn.world.lights.portableSources.get(String(id)) && { ...window.__mn.world.lights.portableSources.get(String(id)) } }), player);
    if (spec.touch) {
      const zone = page.locator('#touch .joy-zone'), box = await zone.boundingBox();
      check(box, 'touch joystick zone has no layout bounds');
      // `.joy-zone` occupies the left half below 30% height; land near its lower-left thumb origin,
      // then drag upward far enough to clear the joystick's 12% dead zone without leaving its 52px radius.
      const x = box.x + Math.min(72, box.width * 0.3), y = box.y + box.height - 128;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 44, { steps: 4 }); await page.waitForTimeout(600); await page.mouse.up();
    } else {
      await page.keyboard.down('w'); await page.waitForTimeout(650); await page.keyboard.up('w');
    }
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) > 0.45,
      { x: beforeMove.x, z: beforeMove.z }, { timeout: 8000 });
    await page.waitForFunction((id) => {
      const src = window.__mn.world.lights.portableSources.get(String(id));
      return src && Math.hypot(src.x - window.__mn.client.cur.x, src.z - window.__mn.client.cur.z) < 1.2;
    }, player, { timeout: 10000 });
    const afterMove = await page.evaluate((id) => ({ x: window.__mn.client.cur.x, z: window.__mn.client.cur.z,
      light: window.__mn.world.lights.portableSources.get(String(id)) && { x: window.__mn.world.lights.portableSources.get(String(id)).x,
        z: window.__mn.world.lights.portableSources.get(String(id)).z } }), player);
    result.movement = { before: beforeMove, after: afterMove, followed: true };
    await screenshot('03-personal-lantern-moving');
    await toggleSelf(false);
    await screenshot('03b-personal-lantern-off-late');

    result.stage = 'port-lantern-midnight-and-day';
    const port = choosePortPoint(world, staticLights);
    check(port, 'no port pier point was close to an existing static lantern source');
    result.portFixture = port;
    world.economy.hours = 24; world.economy.acc = 0;
    server.broadcastSnapshot();
    relocate(world, server, player, port, 0);
    result.cameraStates.push({ label: 'port-midnight', ...(await waitForCameraAt(page, port, 'port midnight fixture')) });
    await page.waitForFunction(() => Math.abs(window.__mn.world.lighting.phase - 0.75) < 0.02 && window.__mn.world.lighting.cur.sunI <= 0.02,
      null, { timeout: 10000 });
    await screenshot('04-port-midnight-off');
    await toggleSelf(true);
    await screenshot('05-port-midnight-on');
    await toggleSelf(false);
    await screenshot('06-port-midnight-off-late');

    world.economy.hours = 6; world.economy.acc = 0;
    server.broadcastSnapshot();
    await page.waitForFunction(() => Math.min(window.__mn.world.lighting.phase, 1 - window.__mn.world.lighting.phase) < 0.02 &&
      window.__mn.world.lighting.cur.sunI > 1.5, null, { timeout: 10000 });
    result.cameraStates.push({ label: 'port-dawn', ...(await waitForCameraAt(page, port, 'port dawn fixture')) });
    await screenshot('07-port-day-off');
    await toggleSelf(true);
    await screenshot('08-port-day-on');
    await toggleSelf(false);
    await screenshot('09-port-day-off-late');
    result.portNightDay = { point: port, midnightPhase: 0.75, dawnPhase: 0, personalSourceToggledAtBothHours: true,
      staticLampDistance: port.lightDistance };

    world.economy.hours = 24; world.economy.acc = 0;
    server.broadcastSnapshot();
    await page.waitForFunction(() => Math.abs(window.__mn.world.lighting.phase - 0.75) < 0.02 &&
      window.__mn.world.lighting.cur.sunI <= 0.02, null, { timeout: 10000 });

    result.stage = 'remote-public-light-and-death-reset';
    guest2 = await connectGuest(result.port, `Luz-${spec.name.slice(-5)}`);
    const remoteEntity = guest2.entity;
    const remotePoint = { x: world.ecs.x[player] + 2.6, y: world.map.groundAt(world.ecs.x[player] + 2.6, world.ecs.z[player]), z: world.ecs.z[player] };
    relocate(world, server, remoteEntity, remotePoint, Math.PI / 2);
    const remoteCommand = { t: 'cmd', type: 'personalLantern', lit: true, opId: `qa-${runTag}-${spec.name}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) };
    guest2.socket.send(JSON.stringify(remoteCommand));
    await waitUntil(() => world.ecs.lantern[remoteEntity] === 1, 'remote guest server light command');
    server.broadcastSnapshot();
    await page.waitForFunction((id) => {
      const source = window.__mn.world.lights.portableSources.get(String(id));
      const rec = window.__mn.client.entities.get(id);
      return rec?.lantern === true && source?.w > 0.9 &&
        Math.hypot(source.x - rec.r.x, source.z - rec.r.z) < 4;
    }, remoteEntity, { timeout: 15000 });
    const remoteSource = await page.evaluate((id) => {
      const s = window.__mn.world.lights.portableSources.get(String(id));
      return s && { x: s.x, y: s.y, z: s.z, priority: s.priority, radius: s.r };
    }, remoteEntity);
    check(remoteSource && remoteSource.priority === 0 && remoteSource.radius === 7.5, `remote light did not render as a public source: ${JSON.stringify(remoteSource)}`);
    result.remoteLight = { entity: remoteEntity, source: remoteSource, serverFlag: world.ecs.lantern[remoteEntity] };
    await screenshot('04-nearby-player-lantern');
    check(killPlayer(world, remoteEntity, 0), 'death reset fixture was not admitted');
    server.broadcastSnapshot();
    await waitUntil(() => world.ecs.lantern[remoteEntity] === 0 && world.ecs.dead[remoteEntity] === 1, 'death clears remote lantern state');
    await page.waitForFunction((id) => window.__mn.client.entities.get(id)?.lantern !== true &&
      !window.__mn.world.lights.portableSources.has(String(id)), remoteEntity, { timeout: 15000 });
    result.deathReset = { dead: true, authoritativeFlagOff: world.ecs.lantern[remoteEntity] === 0, remoteSourceRemoved: true };

    result.stage = 'final-browser-checks';
    const viewport = await page.evaluate(() => {
      const b = document.querySelector('#personal-lantern')?.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > innerWidth, quality: window.__mn.quality.current,
        phase: window.__mn.world.lighting.phase, sunIntensity: window.__mn.world.lighting.cur.sunI,
        control: b && { x: b.x, y: b.y, width: b.width, height: b.height }, buttonHidden: document.querySelector('#personal-lantern')?.hidden };
    });
    check(!viewport.overflow, `portable lantern control causes horizontal overflow: ${JSON.stringify(viewport)}`);
    check(viewport.quality === spec.quality, `requested ${spec.quality} quality but active ${viewport.quality}`);
    check(viewport.sunIntensity <= 0.02 && Math.abs(viewport.phase - 0.75) < 0.02, `night changed during play: ${JSON.stringify(viewport)}`);
    check(result.websockets.some((socket) => socket.url.includes('/ws')), 'browser did not connect to local GameHost WebSocket');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 &&
      result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser faults: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors,
        requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.finalViewport = viewport;
    result.assertions = { cameraSettledAndPlayerProjected: true, midnightClockLocked: true, dawnClockFixture: true,
      savedDayPreferenceIgnoredDuringPlay: true, nearBlackSun: true, portLanternAtMidnightAndDawn: true,
      lateOnOffScreenshots: true,
      noAutomaticPlayerFill: true, buttonAtLeast48px: true, localizedButton: true, actualToggle: true,
      sourceAndPropFollowMovement: true, remotePlayerLightVisible: true, deathClearsSource: true, noHorizontalOverflow: true };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href,
      bodyText: document.body.innerText.slice(0, 1800), quality: window.__mn?.quality?.current,
      joined: window.__mn?.client?.joined, lantern: window.__mn?.client?.personalLantern,
      ownSources: [...(window.__mn?.world?.lights?.portableSources?.keys?.() || [])],
      phase: window.__mn?.world?.lighting?.phase, sunIntensity: window.__mn?.world?.lighting?.cur?.sunI,
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (diagnosticError) { result.browserState = { diagnosticError: String(diagnosticError) }; }
    result.serverState = { player, remoteEntity: guest2?.entity, playerLantern: player && world?.ecs?.lantern?.[player],
      remoteLantern: guest2?.entity && world?.ecs?.lantern?.[guest2.entity], hostLogs: hostLogs.slice(-30) };
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    guest2?.socket.close();
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close(); await host.close();
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, error: result.error?.split('\n')[0] }));
  }
}

const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try { for (const spec of specs) await run(browser, spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

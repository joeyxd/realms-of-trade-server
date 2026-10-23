#!/usr/bin/env node
// RNV04 visual acceptance for paid personal and raft fire. Disposable server/profile only.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newFire } from '../src/sim/economy/fire.js';
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') {
  throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this local harness.');
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv04-fire-fuel');
await mkdir(out, { recursive: true });
const firstExisting = paths => paths.find(path => fs.existsSync(path)) || paths[0];
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || firstExisting([
  resolve(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
  resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
]));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const threeRoot = firstExisting([resolve(repo, 'node_modules/three'), resolve(sibling, 'node_modules/three')]);
const gsapRoot = resolve(process.env.MN_GSAP || resolve(sibling, '.scratch/gsap-local/package'));
const specs = [
  { name: 'fire-desktop-es', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'fire-mobile-en', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
];
if (process.env.MN_QA_QUALITY) {
  if (!['low', 'high'].includes(process.env.MN_QA_QUALITY)) throw new Error('unsupported QA quality');
  for (const spec of specs) { spec.quality = process.env.MN_QA_QUALITY; spec.name += `-${spec.quality}`; }
}
if (process.env.MN_QA_VIEWPORT) {
  const selected = specs.filter(spec => spec.name.includes(process.env.MN_QA_VIEWPORT));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${process.env.MN_QA_VIEWPORT}`);
  specs.splice(0, specs.length, ...selected);
}
const generatedAt = new Date().toISOString();
const runTag = generatedAt.replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const evidence = {
  generatedAt,
  purpose: 'Verify paid handheld fuel, retained fuel when extinguished, simulation expiry and reload, and fueled public raft fires.',
  harness: 'One Chromium launch, isolated normal-play browser contexts, disposable memory-backed GameHost/account per viewport, local Three.js/GSAP/font routes. No SQL, external services, production writes, or physical-device performance claim.',
  fixture: 'The preseeded account owns two pack wood and a raft with floor/wall torches, campfire, and grill. The raft hold has four wood for station fuel. Player relocation and clock advancement are server-only repeatability fixtures; all fuel actions use the real panel and GameHost operation path.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const ACCOUNT = 'a707f1e0-8c42-47ef-9a18-0045b9d2c100';
const RAFT_ID = 'qa-fire-raft';
const STATION_KINDS = new Set(['torchFloor', 'torchWall', 'campfire', 'grill']);
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function waitUntil(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(25); }
  throw new Error(`timed out waiting for ${label}`);
}
async function waitHealthy(port) {
  const deadline = Date.now() + 30000; let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      last = { status: response.status, body: await response.text() };
      if (response.status === 200) return;
    } catch (error) { last = String(error); }
    await pause(100);
  }
  throw new Error(`GameHost did not become healthy: ${JSON.stringify(last)}`);
}
async function localRoutes(page, result) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    result.externalRequests.push(url.href); return route.abort();
  });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, body: '' }));
}
async function openApp(page, port, result) {
  page.on('pageerror', error => result.errors.push(String(error?.stack || error)));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', response => { if (response.status() >= 400) result.httpFailures.push({ url: response.url(), status: response.status() }); });
  page.on('websocket', socket => result.websockets.push({ url: socket.url() }));
  await localRoutes(page, result);
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ timeOfDay: 'day' })),
    { key: `${GAME.saveKey}.settings` });
  await page.goto(`http://127.0.0.1:${port}/?debug&q=${result.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.evaluate(locale => { document.documentElement.lang = locale; }, result.locale);
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled,
    null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}

function seededProfile() {
  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT}`;
  profile.fire = newFire();
  profile.eco.pack.goods = { madera: 2 };
  const ship = profile.eco.ships[0];
  ship.id = RAFT_ID;
  ship.grid = newRaft([
    ...STARTER_RAFT,
    ['foundation', 2, 0, 0, 0], ['foundation', 3, 0, 0, 0], ['foundation', 4, 0, 0, 0],
    ['grill', 2, 0, 0, 0], ['campfire', 3, 0, 0, 0], ['torchFloor', 4, 0, 0, 0],
    ['wall', 4, 0, 0, 0], ['torchWall', 4, 0, 0, 0],
  ]);
  ship.hold.cap = Math.max(ship.hold.cap, 40);
  ship.hold.goods = { madera: 4 };
  return profile;
}

function relocateToFixture(world, server, entity, raft, part) {
  const ecs = world.ecs, [_, ix, iz, level] = part;
  const localX = (ix + 0.5) * 2, localZ = (iz + 0.5) * 2, c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
  const point = { x: raft.x + c * localX + s * localZ, y: raft.y + level * 2.6,
    z: raft.z - s * localX + c * localZ };
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z; ecs.facing[entity] = raft.yaw;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.atkStage[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0;
  server.broadcastSnapshot();
  return point;
}

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [],
    httpFailures: [], externalRequests: [], websockets: [], screenshots: [], fireAcks: [], assertions: {} };
  evidence.viewports.push(result);
  const hostLogs = [];
  const store = createMemoryStore();
  await store.initializeProfile(ACCOUNT, seededProfile());
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-fire-fuel-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true,
    economicOperations: true, fireOperations: true, saveSecret: `qa-fire-fuel-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, server, world, entity, source, raftRecord;
  const screenshot = async label => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88 });
    result.screenshots.push(file); return file;
  };
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, result.port, result);
    const profile = world.profiles.get(entity);
    check(profile?.eco?.pack?.goods?.madera === 2, 'preseeded pack wood did not load into the authenticated profile');
    source = [...world.rafts.values()].find(raft => raft.owner === entity && raft.ship.id === RAFT_ID);
    check(source?.condition?.entries?.length, 'preseeded raft fixtures did not load');
    raftRecord = { id: source.ship.id, owner: entity, ...source, x: world.ecs.x[source.entity], y: world.ecs.y[source.entity],
      z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] };
    const parts = new Set(source.condition.entries.map(entry => entry.part[0]));
    for (const kind of STATION_KINDS) check(parts.has(kind), `fixture is missing ${kind}`);
    world.economy.hours = 24; world.economy.acc = 0;
    const floorPart = source.condition.entries.find(entry => entry.part[0] === 'grill').part;
    const point = relocateToFixture(world, server, entity, { ...raftRecord, x: world.ecs.x[source.entity], y: world.ecs.y[source.entity],
      z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] }, floorPart);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < 0.5,
      { x: point.x, z: point.z }, { timeout: 15000 });
    await page.waitForFunction(() => Math.abs(window.__mn.world.lighting.phase - 0.75) < 0.02 && window.__mn.world.lighting.cur.sunI <= 0.02,
      null, { timeout: 15000 });
    await page.waitForFunction(() => window.__mn.client.fire?.enabled === true, null, { timeout: 15000 });
    result.fixture = { raftId: source.ship.id, entries: source.condition.entries.filter(entry => STATION_KINDS.has(entry.part[0])
      || entry.part[0] === 'wall').map(entry => ({ id: entry.id, part: [...entry.part], hp: entry.hp })),
      packWood: 2, holdWood: 4, startHour: world.economy.hours, stationPanelOpen: 'programmatic target selection; load actions use the visible UI button' };
    result.midnight = { serverHours: world.economy.hours, ...(await page.evaluate(() => ({
      phase: window.__mn.world.lighting.phase, sunIntensity: window.__mn.world.lighting.cur.sunI }))) };
    await screenshot('01-dark-raft-before-fuel');

    const button = page.locator('#personal-lantern');
    await button.waitFor({ state: 'visible', timeout: 10000 });
    const toggleHandControl = async () => { if (spec.touch) await button.tap(); else await page.keyboard.press('n'); };
    result.stage = 'hand-torch-empty-panel';
    await toggleHandControl();
    await page.waitForFunction(() => window.__mn.panels.firePanel.active, null, { timeout: 10000 });
    const panel = page.locator('.fire-panel');
    const controls = await panel.evaluate(el => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { panel: rect(el), close: rect(el.querySelector('.fire-close')), load: rect(el.querySelector('.fire-load')),
        viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
    });
    check(controls.close.width >= 48 && controls.close.height >= 48 && controls.load.height >= 48,
      `fire panel controls are below the 48px target: ${JSON.stringify(controls)}`);
    check(controls.panel.x >= 0 && controls.panel.right <= spec.width && controls.viewport.documentWidth <= spec.width,
      `fire panel overflows viewport: ${JSON.stringify(controls)}`);
    check((await panel.locator('.fire-title').textContent()).toLowerCase().includes(spec.locale === 'en' ? 'hand' : 'mano'),
      `wrong localized hand torch panel: ${await panel.locator('.fire-title').textContent()}`);
    result.handPanelControls = controls;
    await screenshot('02-hand-torch-empty-panel');

    const originalSend = host.game.sendTo.bind(host.game);
    host.game.sendTo = (id, message) => {
      const event = message?.ev;
      if (event?.type === 'fire') result.fireAcks.push({ op: event.op, opId: event.opId, ok: event.ok, why: event.why || '', rev: event.rev });
      return originalSend(id, message);
    };
    result.stage = 'paid-hand-load';
    await page.locator('.fire-load').click();
    await waitUntil(() => profile.fire?.slots?.hand?.lit === true && profile.fire.slots.hand.seconds === 1200,
      'paid hand torch load');
    await page.waitForFunction(() => window.__mn.client.fire.slots.find(slot => slot.key === 'hand')?.lit === true &&
      window.__mn.world.lights.portableSources.has(String(window.__mn.client.youServer)), null, { timeout: 15000 });
    check(profile.eco.pack.goods.madera === 1, `hand torch did not debit exactly one wood: ${profile.eco.pack.goods.madera}`);
    check(result.fireAcks.some(ack => ack.op === 'load' && ack.ok), 'server did not confirm the paid hand load');
    const handSource = await page.evaluate(id => {
      const source = window.__mn.world.lights.portableSources.get(String(id));
      const view = window.__mn.world.views.get(id);
      return { source: source && { x: source.x, y: source.y, z: source.z, r: source.r, w: source.w, priority: source.priority },
        coreVisible: !!view?.personalLanternCore?.visible, flameVisible: !!view?.personalLanternFlame?.visible };
    }, entity);
    check(handSource.source?.r === 7.5 && handSource.source.w > 0 && handSource.coreVisible && handSource.flameVisible,
      `confirmed hand torch did not produce its public flame/light: ${JSON.stringify(handSource)}`);
    result.handLit = { woodAfterLoad: profile.eco.pack.goods.madera, source: handSource,
      serverLit: world.ecs.lantern[entity] === 1, profileSlot: structuredClone(profile.fire.slots.hand) };
    await screenshot('03-hand-torch-lit');
    await page.locator('.fire-close').click();
    await page.waitForFunction(() => !window.__mn.panels.firePanel.active, null, { timeout: 5000 });

    result.stage = 'hand-extinguish-and-relight';
    const storedSeconds = profile.fire.slots.hand.seconds;
    await toggleHandControl();
    await waitUntil(() => profile.fire.slots.hand.lit === false, 'hand torch extinguish');
    await page.waitForFunction(rev => {
      const slot = window.__mn.client.fire?.slots?.find(row => row.key === 'hand');
      const button = document.querySelector('#personal-lantern');
      return slot?.lit === false && slot.seconds > 0 && window.__mn.client.fire?.rev === rev &&
        button && !button.disabled && button.getAttribute('aria-pressed') === 'false';
    }, profile.fire.rev, { timeout: 15000 });
    const secondsAfterExtinguish = profile.fire.slots.hand.seconds;
    check(secondsAfterExtinguish <= storedSeconds && storedSeconds - secondsAfterExtinguish <= 120 &&
      profile.eco.pack.goods.madera === 1,
      `extinguishing refunded wood or refilled fuel: before=${storedSeconds}, after=${secondsAfterExtinguish}`);
    await toggleHandControl();
    await waitUntil(() => profile.fire.slots.hand.lit === true, 'hand torch relight');
    result.handToggle = { extinguishedAndRelit: true, secondsBefore: storedSeconds, secondsAfterExtinguish,
      secondsAfterRelight: profile.fire.slots.hand.seconds, wood: profile.eco.pack.goods.madera };

    result.stage = 'fueled-public-raft-fixtures';
    const stationEntries = source.condition.entries.filter(entry => STATION_KINDS.has(entry.part[0]));
    const stationEvidence = [];
    for (const entry of stationEntries) {
      const current = { id: source.ship.id, x: world.ecs.x[source.entity], y: world.ecs.y[source.entity],
        z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] };
      const stationPoint = relocateToFixture(world, server, entity, current, entry.part);
      await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < 0.5,
        { x: stationPoint.x, z: stationPoint.z }, { timeout: 15000 });
      const opened = await page.evaluate(target => window.__mn.panels.firePanel.open(target),
        { ship: source.ship.id, part: entry.id, kind: entry.part[0] });
      check(opened, `panel could not select ${entry.part[0]} target`);
      await page.waitForFunction(() => window.__mn.panels.firePanel.active, null, { timeout: 5000 });
      await page.locator('.fire-load').click();
      const slotKey = JSON.stringify([source.ship.id, entry.id]);
      await waitUntil(() => profile.fire?.slots?.[slotKey]?.lit === true, `${entry.part[0]} paid fuel load`);
      await page.waitForFunction(({ raftId, tuple }) => {
        const row = window.__mn.client.pred.rafts.find(raft => raft.id === raftId);
        return row?.litLanterns?.some(part => JSON.stringify(part) === JSON.stringify(tuple));
      }, { raftId: source.ship.id, tuple: entry.part }, { timeout: 15000 });
      await page.waitForFunction(({ raftId, tuple }) => {
        const view = window.__mn.world.rafts.views.get(String(raftId));
        const core = view?.lanternCores.find(item => JSON.stringify(item.userData.raftLanternPart) === JSON.stringify(tuple));
        const light = [...window.__mn.world.lights.raftSources.values()].find(item => JSON.stringify(item.part) === JSON.stringify(tuple));
        return !!core?.visible && !!light;
      }, { raftId: source.ship.id, tuple: entry.part }, { timeout: 15000 });
      const publicState = await page.evaluate(({ raftId, tuple }) => {
        const view = window.__mn.world.rafts.views.get(String(raftId));
        const core = view?.lanternCores.find(item => JSON.stringify(item.userData.raftLanternPart) === JSON.stringify(tuple));
        const light = [...window.__mn.world.lights.raftSources.values()].find(item => JSON.stringify(item.part) === JSON.stringify(tuple));
        return { coreVisible: !!core?.visible, source: light && { x: light.x, y: light.y, z: light.z, r: light.r, w: light.w } };
      }, { raftId: source.ship.id, tuple: entry.part });
      check(publicState.coreVisible && publicState.source?.r > 0,
        `${entry.part[0]} paid fuel did not create its public flame/light: ${JSON.stringify(publicState)}`);
      stationEvidence.push({ id: entry.id, kind: entry.part[0], tuple: [...entry.part], woodFromHold: 1, publicState });
      if (entry.part[0] === 'campfire') await screenshot('04-campfire-lit-panel');
      await page.locator('.fire-close').click();
    }
    result.stations = stationEvidence;
    const openedGrill = await page.evaluate(target => window.__mn.panels.firePanel.open(target), {
      ship: source.ship.id, part: stationEntries.find(entry => entry.part[0] === 'grill').id, kind: 'grill' });
    check(openedGrill, 'could not reopen grill fire panel for combined raft capture');
    await screenshot('05-raft-fixtures-lit-panel');
    await page.locator('.fire-close').click();
    await screenshot('06-raft-fixtures-lit');

    result.stage = 'simulation-expiry-and-reload';
    const beforeExpiry = profile.fire.slots.hand.since;
    world.economy.hours = 54; world.economy.acc = 0; server.broadcastSnapshot();
    await page.waitForFunction(() => {
      const slot = window.__mn.client.fire.slots.find(row => row.key === 'hand');
      return slot?.seconds === 0 && slot.lit === false;
    }, null, { timeout: 15000 });
    check(world.ecs.lantern[entity] === 0, 'expired server torch remained publicly lit');
    result.expiry = { startSec: beforeExpiry, nowSec: world.economy.hours * 40,
      clientSeconds: 0, serverLightOff: true, monotonicClockJump: '24 to 54 hours' };
    await toggleHandControl();
    await page.waitForFunction(() => window.__mn.panels.firePanel.active, null, { timeout: 5000 });
    const beforeReloadRev = profile.fire.rev;
    await page.locator('.fire-load').click();
    await waitUntil(() => profile.fire.rev > beforeReloadRev && profile.fire.slots.hand.since > beforeExpiry &&
      profile.fire.slots.hand.lit === true && profile.fire.slots.hand.seconds === 1200,
      'fresh hand fuel after simulation expiry');
    check(profile.eco.pack.goods.madera === undefined, 'reload did not spend the second preseeded pack wood');
    result.reload = { seconds: profile.fire.slots.hand.seconds, lit: profile.fire.slots.hand.lit,
      packWood: profile.eco.pack.goods.madera ?? 0, confirmed: result.fireAcks.some(ack => ack.op === 'load' && ack.ok) };
    await screenshot('07-hand-torch-reloaded');

    result.stage = 'final-browser-checks';
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      quality: window.__mn.quality.current, websocketReady: window.__mn.transport?.ws?.readyState === WebSocket.OPEN }));
    check(!viewport.overflow && viewport.quality === spec.quality, `viewport or quality check failed: ${JSON.stringify(viewport)}`);
    check(result.websockets.some(socket => socket.url.includes('/ws')), 'normal play did not connect to GameHost WebSocket');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 &&
      result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser errors or external requests: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors,
        requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.finalViewport = viewport;
    result.assertions = { normalPlayJoin: true, midnightServerClock: true, localizedHandPanel: true, panelControlsAtLeast48px: true,
      paidHandFuelExactlyOneWood: true, confirmedHandTorchPublicFlame: true, extinguishPreservesFuel: true,
      relightUsesLoadedFuel: true, floorWallCampfireAndGrillFuelActions: true, publicRaftFlamesAndSources: true,
      simulationExpiryAndPaidReload: true, mobilePanelFitsViewport: spec.touch, noBrowserErrors: true };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href,
      bodyText: document.body.innerText.slice(0, 1600), quality: window.__mn?.quality?.current,
      joined: window.__mn?.client?.joined, fire: window.__mn?.client?.fire,
      panelActive: window.__mn?.panels?.firePanel?.active,
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (diagnosticError) {
      result.browserState = { diagnosticError: String(diagnosticError) };
    }
    try { result.final = { pack: world?.profiles?.get(entity)?.eco?.pack?.goods,
      fire: world?.profiles?.get(entity)?.fire, raft: source?.ship?.grid?.parts,
      stationAcks: result.fireAcks, hostLogs: hostLogs.slice(-30) }; } catch {}
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close();
    try { await host.close(); } catch (error) { hostLogs.push(`close: ${String(error)}`); }
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, error: result.error?.split('\n')[0] }));
  }
}

const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try { for (const spec of specs) await run(browser, spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

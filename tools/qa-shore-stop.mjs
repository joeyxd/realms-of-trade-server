#!/usr/bin/env node
// RNV08a browser acceptance: physical dry landing, pack-only shore resupply, and reboarding.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { nearestNavalLanding, distanceToNavalHull } from '../src/sim/naval/landing.js';
import { freshwaterSource } from '../src/data/freshwater.js';
import { GAME } from '../src/data/meta.js';
import { C } from '../src/sim/ecs.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 only after backend readiness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv08a-shore-resupply/local');
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
  { name: 'shore-stop-desktop-es', width: 1280, height: 720, touch: false, locale: 'es' },
  { name: 'shore-stop-mobile-en', width: 390, height: 844, touch: true, locale: 'en' },
];
if (process.env.MN_QA_VIEWPORT) {
  const selected = specs.filter(spec => spec.name.includes(process.env.MN_QA_VIEWPORT));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${process.env.MN_QA_VIEWPORT}`);
  specs.splice(0, specs.length, ...selected);
}
const generatedAt = new Date().toISOString(), runTag = generatedAt.replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const evidence = {
  generatedAt,
  purpose: 'Verify owner-only dry shore service in the real game UI: paid market quote/buy/sell, pack water and survival actions, locked raft cargo/barrel transfers, and the same active voyage and hold after reboarding.',
  harness: 'Serial desktop ES and mobile EN Chromium sessions, each on a disposable memory-backed GameHost/account; local Three.js/GSAP/font routes only. No SQL, external services, deployment, or physical-device performance claim.',
  fixture: 'For repeatability, the disposable host moves the owned raft source to a searched real water pose more than 20 units from its retained home, with a real dry landing found by the shipping landing search. Owner mounting, landing, shore service, market/freshwater commands, and reboarding still use authoritative live-voyage paths. After landing, QA relocates only the ashore player to the existing Aldea market and spring. No navigation-driving or Puerto Sol claim is made.',
    assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const ACCOUNT = 'c08408a9-a5a1-44de-82ba-000000000708';
const RAFT_ID = 'qa-shore-stop-raft';
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
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); last = { status: response.status, body: await response.text() }; if (response.status === 200) return; }
    catch (error) { last = String(error); }
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
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
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
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator(`.title-language [data-locale="${result.locale}"]`).click();
  await page.waitForFunction(locale => document.documentElement.lang === locale, result.locale, { timeout: 5000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}
function seededProfile() {
  const profile = newProfile(); profile.pirateId = `account:${ACCOUNT}`; profile.gold = 5000;
  profile.surv = { v: 1, sat: 45, hyd: 35 };
  profile.eco.pack.goods = { madera: 2, ron: 1, agua: 1 };
  profile.eco.pack.vessels = [{ id: 'canteen', kind: 'canteen', water: 1 }];
  const ship = profile.eco.ships[0]; ship.id = RAFT_ID; ship.grid = newRaft([...STARTER_RAFT]);
  ship.hold.goods = { madera: 2 };
  return profile;
}
function currentProfile(world, entity) { return world.profiles.get(entity); }
function activeRaft(world, entity) { return [...world.rafts.values()].find(active => active.owner === entity && active.ship.id === RAFT_ID); }
function relocate(world, server, entity, point) {
  const ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.facing[entity] = point.yaw ?? 0; ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.atkStage[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.regenT[entity] = 3;
  server.world.raftDeck.update(publicRafts(server.world));
  server.broadcastSnapshot();
  return { x: point.x, y: point.y, z: point.z };
}
function dryShoreFixture(world, raft) {
  const source = world.rafts.get(RAFT_ID), home = source.home, parts = raft.ship.grid.parts;
  world.raftDeck.update([]);
  try {
    for (let radius = 25; radius <= 40; radius += 1) {
      const count = Math.ceil(2 * Math.PI * radius / 0.5);
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count;
        const pose = { x: home.x + Math.sin(angle) * radius, y: home.y,
          z: home.z + Math.cos(angle) * radius, yaw: angle };
        if (world.map.groundAt(pose.x, pose.z) >= .1) continue;
        const landing = nearestNavalLanding(world, pose, parts, 6);
        if (landing) return { pose, landing, home: { ...home }, distanceHome: radius };
      }
    }
  } finally { world.raftDeck.update(publicRafts(world)); }
  throw new Error('could not find real water beside a walkable dry landing in the nearby coast fixture search');
}
function protectSpring(world, spring) {
  const ecs = world.ecs, removed = [...ecs.each(C.ENEMY)].filter(e => Math.hypot(ecs.x[e] - spring.x, ecs.z[e] - spring.z) <= 40);
  for (const enemy of removed) world.despawn(enemy);
  world.spawners = world.spawners.filter(sp => Math.hypot(sp.x - spring.x, sp.z - spring.z) > 40);
  return removed.length;
}

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [], externalRequests: [], websockets: [], screenshots: [], assertions: {} };
  evidence.viewports.push(result);
  const hostLogs = [], store = createMemoryStore(); await store.initializeProfile(ACCOUNT, seededProfile());
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-rnv08a-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true,
    economicOperations: true, freshwaterOperations: true, canteenOperations: true, fireOperations: false,
    saveSecret: `qa-rnv08a-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, server, world, entity, profile, raft, landing, originalProfile, originalShip, originalHold;
  const integrity = (label, point = null) => {
    const current = currentProfile(world, entity), ship = current?.eco?.ships?.find(row => row.id === RAFT_ID);
    const source = world.rafts.get(RAFT_ID), ecs = world.ecs, voyage = world.navalPilot.voyageSnapshot(entity);
    return { label, profileSame: current === originalProfile, shipSame: ship === originalShip, holdSame: ship?.hold === originalHold,
      holdGoodsSame: ship?.hold?.goods === originalHold?.goods, shipHp: ecs.hp[entity], dead: ecs.dead[entity],
      clientId: ecs.clientId[entity], parked: world.navalTrial.isParked(entity, RAFT_ID), trialSize: world.navalTrial.size,
      voyageActive: voyage.active === true, phase: voyage.phase, sourcePose: source && { x: ecs.x[source.entity], y: ecs.y[source.entity], z: ecs.z[source.entity], yaw: ecs.facing[source.entity] },
      sourceRev: source?.ship?.rev, player: { x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity], groundY: point ? world.map.groundAt(point.x, point.z) : null } };
  };
  const screenshot = async label => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88 }); result.screenshots.push(file); return file;
  };
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    result.navalEvents = [];
    const emit = world.emit.bind(world);
    world.emit = event => {
      if (event?.type === 'navalPilot' && (event.to === entity || event.to === undefined))
        result.navalEvents.push({ tick: world.tick, op: event.op, active: event.active, ok: event.ok, why: event.why, epoch: event.epoch });
      return emit(event);
    };
    const preparePilot = world.navalPilot.prepare.bind(world.navalPilot);
    result.prepareChecks = [];
    world.navalPilot.prepare = (...args) => {
      const before = world.navalPilot.snapshot(entity), beforePoint = before.active ? pilotPoint(before.body.pose, before.anchor) : null;
      const beforePlayer = { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity], facing: world.ecs.facing[entity] };
      const tick = world.tick;
      const value = preparePilot(...args);
      if (result.reboardAttempt && before.active) {
        const after = world.navalPilot.snapshot(entity);
        result.prepareChecks.push({ tick, beforePoint, beforePlayer, afterActive: after.active === true,
          afterPlayer: { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity], facing: world.ecs.facing[entity] },
          voyage: world.navalPilot.voyageSnapshot(entity), trialSize: world.navalTrial.size });
      }
      return value;
    };
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, result.port, result);
    profile = currentProfile(world, entity); raft = activeRaft(world, entity);
    originalProfile = profile; originalShip = profile?.eco?.ships?.find(row => row.id === RAFT_ID); originalHold = originalShip?.hold;
    check(profile?.gold === 5000 && profile?.eco?.pack?.goods?.madera === 2, 'preseeded commerce profile did not load');
    check(raft?.ship?.id === RAFT_ID, 'preseeded starter raft did not attach');
    const coastFixture = dryShoreFixture(world, raft);
    const sourceEntity = world.rafts.get(RAFT_ID).entity;
    world.ecs.x[sourceEntity] = coastFixture.pose.x; world.ecs.y[sourceEntity] = coastFixture.pose.y;
    world.ecs.z[sourceEntity] = coastFixture.pose.z; world.ecs.facing[sourceEntity] = coastFixture.pose.yaw;
    const publicRaft = publicRafts(world).find(row => row.id === RAFT_ID);
    world.raftDeck.update(publicRafts(world));
    const station = pilotPoint(publicRaft, publicRaft.helm);
    const helm = { ...station, yaw: station.f };
    relocate(world, server, entity, helm);
    world.ecs.hyd[entity] = 35; world.ecs.sat[entity] = 45; server.broadcastSnapshot();
    result.fixture = { market: 'aldea', marketSource: 'existing walkable town landmark', spring: 'existing salty-spring source', newTownCreated: false,
      shorePose: coastFixture.pose, landingSearch: coastFixture.landing, retainedHome: coastFixture.home, distanceHome: coastFixture.distanceHome,
      profile: 'disposable memory-backed, seeded low-mass pack goods and a canteen', forcedActions: 'source-vessel placement is a repeatable server fixture; owner mount/land, market/freshwater commands, and reboarding use normal authoritative paths' };

    result.stage = 'mount-and-sail';
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.verb, null, { timeout: 15000 });
    await page.locator('.ln-prompt [data-run]').click();
    await waitUntil(() => world.navalPilot.snapshot(entity).active, 'owner helm mount');
    await waitUntil(() => world.navalPilot.voyageSnapshot(entity).canLand, 'stopped vessel beside searched dry shore', 15000);
    const sailing = world.navalPilot.voyageSnapshot(entity);
    result.navigation = { method: 'server-positioned vessel fixture; no navigation-driving claim', visited: sailing.visited,
      canLand: sailing.canLand, distanceHome: sailing.distanceHome, pose: world.navalPilot.snapshot(entity).body.pose };
    await page.evaluate(epoch => window.__mn.client.send({ t: 'cmd', type: 'navalPilot', op: 'land', epoch }), world.navalPilot.snapshot(entity).epoch);
    await waitUntil(() => world.navalPilot.voyageSnapshot(entity).phase === 'shore', 'server dry landing');
    const shore = world.navalPilot.voyageSnapshot(entity);
    check(shore.shoreService === true && world.navalPilot.shoreStop(entity) === true, `normal land did not admit shore pack service: ${JSON.stringify(shore)}`);
    landing = { x: shore.landing.x, y: shore.landing.y, z: shore.landing.z };
    result.landing = { phase: shore.phase, shoreService: shore.shoreService, canReboard: shore.canReboard, landing,
      parked: world.navalTrial.isParked(entity, RAFT_ID), startedAfter: sailing.distanceHome > 20 };
    check(result.landing.parked && result.landing.startedAfter, 'shore fixture must retain a visited, server-parked raft');
    result.integrity = [integrity('after-landing', landing)];
    const marketPoint = { ...world.map.landmarks.village, y: world.map.groundAt(world.map.landmarks.village.x, world.map.landmarks.village.z) };
    check(world.map.groundAt(marketPoint.x, marketPoint.z) >= .2, 'existing market landmark is not dry land');
    relocate(world, server, entity, marketPoint);
    await waitUntil(() => page.evaluate(() => window.__mn.client.voyage?.shoreService === true), 'shore service snapshot after market fixture relocation');
    await pause(3200);

    result.stage = 'commerce-at-existing-market';
    await page.evaluate(() => window.__mn.panels.commercePanel.openMarket('aldea'));
    await page.locator('.commerce-panel').waitFor({ state: 'visible', timeout: 10000 });
    const holdTab = page.locator('.commerce-tabs [data-view="cargo"]');
    await waitUntil(() => holdTab.isDisabled(), 'cargo tab disabled at shore');
    const note = await page.locator('.commerce-shore-note').innerText();
    check(spec.locale === 'en' ? /hold stays locked/.test(note) : /bodega permanece bloqueada/.test(note), `localized cargo lock note missing: ${note}`);
    await screenshot('01-shore-market-and-cargo-lock');
    const buyBefore = { gold: currentProfile(world, entity).gold, fruta: currentProfile(world, entity).eco.pack.goods.fruta || 0 };
    await page.locator('[data-market-side]').selectOption('sell');
    await page.locator('.commerce-panel .market-row[data-good="ron"]').click();
    await waitUntil(() => page.locator('.commerce-confirm').isEnabled(), 'server quote for rum sell');
    const sellQuote = await page.evaluate(() => window.__mn.panels.commercePanel.quote);
    const rumBefore = currentProfile(world, entity).eco.pack.goods.ron;
    await page.locator('.commerce-confirm').click();
    await waitUntil(() => (currentProfile(world, entity).eco.pack.goods.ron || 0) < rumBefore, 'authoritative rum sale');
    const sellAfter = { gold: currentProfile(world, entity).gold, ron: currentProfile(world, entity).eco.pack.goods.ron };
    check(sellAfter.gold > buyBefore.gold && sellQuote?.total > 0, 'sale did not credit a positive quoted amount');
    await page.locator('[data-market-side]').selectOption('buy');
    await page.locator('.commerce-panel .market-row[data-good="fruta"]').click();
    await waitUntil(() => page.locator('.commerce-confirm').isEnabled(), 'server quote for provisions buy');
    const buyQuote = await page.evaluate(() => window.__mn.panels.commercePanel.quote);
    await page.locator('.commerce-confirm').click();
    await waitUntil(() => (currentProfile(world, entity).eco.pack.goods.fruta || 0) > buyBefore.fruta, 'authoritative provisions purchase');
    const buyAfter = { gold: currentProfile(world, entity).gold, fruta: currentProfile(world, entity).eco.pack.goods.fruta };
    check(buyAfter.gold < sellAfter.gold && buyQuote?.total > 0, 'purchase did not pay the quoted gold amount');
    result.integrity.push(integrity('after-market', marketPoint));
    result.commerce = { town: 'aldea', fixture: 'existing walkable market at current village landmark; not Puerto Sol',
      buy: { good: 'fruta', quote: buyQuote, before: buyBefore, after: buyAfter },
      sell: { good: 'ron', quote: sellQuote, before: rumBefore, after: sellAfter.ron, goldAfter: sellAfter.gold }, cargoTransferAvailable: false };
    await page.evaluate(() => window.__mn.panels.commercePanel.close());

    result.stage = 'pack-water-and-survival';
    const spring = freshwaterSource(world.map);
    check(spring && spring.y >= .2, `existing freshwater source not valid on dry land: ${JSON.stringify(spring)}`);
    result.springEnemiesRemoved = protectSpring(world, spring);
    const springPoint = relocate(world, server, entity, spring);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .6, springPoint, { timeout: 15000 });
    await page.evaluate(() => window.__mn.panels.freshwaterPanel.open());
    await page.locator('.freshwater-panel').waitFor({ state: 'visible', timeout: 10000 });
    const freshNote = await page.locator('.fresh-shore-note').innerText();
    check(spec.locale === 'en' ? /Barrel transfers are unavailable/.test(freshNote) : /No puedes transferir agua al barril/.test(freshNote), `localized barrel lock note missing: ${freshNote}`);
    await waitUntil(() => page.locator('.fresh-canteen-drink').isEnabled(), 'pack drink remains available during normal shore service');
    await page.locator('.fresh-canteen-drink').click();
    await waitUntil(() => currentProfile(world, entity).eco.pack.vessels.find(v => v.id === 'canteen')?.water === 0, 'server-confirmed canteen drink');
    const needsAfterDrink = { hyd: world.ecs.hyd[entity], sat: world.ecs.sat[entity] };
    check(needsAfterDrink.hyd > 35, 'drinking did not restore hydration');
    await page.locator('.fresh-canteen-provisions').click();
    await waitUntil(() => currentProfile(world, entity).eco.pack.vessels.find(v => v.id === 'canteen')?.water === 1, 'canteen refill from pack provisions during shore stop');
    await page.locator('.fresh-craft').click();
    await waitUntil(() => currentProfile(world, entity).eco.pack.vessels.some(v => v.kind === 'bucket' && v.water === 0), 'pack-only bucket recipe during shore stop');
    await waitUntil(() => page.locator('.fresh-collect').isEnabled(), 'spring collection remains available during normal shore service');
    await page.locator('.fresh-collect').click();
    await waitUntil(() => currentProfile(world, entity).eco.pack.vessels.find(v => v.kind === 'bucket')?.water > 0, 'bucket fill from existing spring during shore stop', 15000);
    await page.locator('.fresh-foods [data-food="fruta"]').click();
    await waitUntil(() => (currentProfile(world, entity).eco.pack.goods.fruta || 0) < buyAfter.fruta, 'pack food action during shore stop');
    result.integrity.push(integrity('after-freshwater-and-food', spring));
    await screenshot('02-shore-freshwater-pack-actions');
    result.freshwater = { source: 'salty-spring', canteenAfterDrink: 0, canteenAfterProvisionsRefill: 1,
      bucketCraftedAndFilled: true, foodConsumed: 'fruta', shoreBarrelTransferControlsLocked: true,
      note: freshNote, needsAfterDrink };
    await page.keyboard.press('Escape');

    result.stage = 'reboard-preserves-voyage-and-hold';
    const holdBefore = structuredClone(currentProfile(world, entity).eco.ships.find(s => s.id === RAFT_ID).hold);
    const landingPoint = relocate(world, server, entity, landing);
    await waitUntil(() => page.evaluate(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .7, landingPoint), 'player returned to server landing point');
    const returnVoyage = world.navalPilot.voyageSnapshot(entity), source = world.rafts.get(RAFT_ID);
    const returnRaft = publicRafts(world).find(row => row.id === RAFT_ID);
    result.reboardEligibility = { landingDistance: Math.hypot(world.ecs.x[entity] - landing.x, world.ecs.z[entity] - landing.z),
      hullDistance: distanceToNavalHull(world.ecs.x[entity], world.ecs.z[entity], returnRaft, returnRaft.parts),
      loadCapacity: world.navalPilot.loadCapacity(RAFT_ID), parked: world.navalTrial.isParked(entity, RAFT_ID),
      trialSize: world.navalTrial.size, voyageActive: returnVoyage.active, phase: returnVoyage.phase,
      profileSame: currentProfile(world, entity) === originalProfile, shipSame: currentProfile(world, entity).eco.ships.find(row => row.id === RAFT_ID) === originalShip,
      holdSame: originalShip.hold === originalHold, shipHp: world.ecs.hp[entity], dead: world.ecs.dead[entity],
      sourcePose: { x: world.ecs.x[source.entity], y: world.ecs.y[source.entity], z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] },
      shipRev: source.ship.rev, shipHpSaved: source.ship.hp, landing, player: { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity], ground: world.map.groundAt(world.ecs.x[entity], world.ecs.z[entity]) } };
    result.integrity.push(integrity('immediately-before-reboard', landing));
    const reboard = world.navalPilot.reboard.bind(world.navalPilot);
    world.navalPilot.reboard = (...args) => {
      const accepted = reboard(...args), currentVoyage = world.navalPilot.voyageSnapshot(entity);
      result.reboardAttempt = { accepted, voyage: currentVoyage, pilot: world.navalPilot.snapshot(entity), trialSize: world.navalTrial.size,
        parked: world.navalTrial.isParked(entity, RAFT_ID), loadCapacity: world.navalPilot.loadCapacity(RAFT_ID) };
      return accepted;
    };
    await page.evaluate(id => window.__mn.client.send({ t: 'cmd', type: 'navalPilot', op: 'reboard', shipId: id }), RAFT_ID);
    result.reboardSteps = [];
    const tickEnd = Date.now() + 2500; let priorTick = -1;
    while (Date.now() < tickEnd) {
      if (world.tick !== priorTick) {
        priorTick = world.tick;
        const v = world.navalPilot.voyageSnapshot(entity), p = world.navalPilot.snapshot(entity);
        result.reboardSteps.push({ tick: world.tick, active: p.active === true, phase: v.phase || null, trialSize: world.navalTrial.size,
          parked: world.navalTrial.isParked(entity, RAFT_ID), sourcePose: { x: world.ecs.x[source.entity], y: world.ecs.y[source.entity], z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] },
          player: { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity], hp: world.ecs.hp[entity], dead: world.ecs.dead[entity] },
          loadCapacity: world.navalPilot.loadCapacity(RAFT_ID) });
        if (p.active !== true) break;
      }
      await pause(10);
    }
    check(world.navalPilot.snapshot(entity).active && world.navalPilot.voyageSnapshot(entity).phase === 'sailing',
      `normal reboard did not remain active: ${JSON.stringify({ events: result.navalEvents, steps: result.reboardSteps })}`);
    const afterReboard = world.navalPilot.voyageSnapshot(entity), holdAfter = currentProfile(world, entity).eco.ships.find(s => s.id === RAFT_ID).hold;
    check(afterReboard.active && afterReboard.shipId === RAFT_ID && JSON.stringify(holdAfter) === JSON.stringify(holdBefore), 'reboard changed voyage identity or the locked raft hold');
    result.reboard = { active: afterReboard.active, phase: afterReboard.phase, shipId: afterReboard.shipId,
      sameHome: JSON.stringify(afterReboard.home) === JSON.stringify(shore.home), sameHold: JSON.stringify(holdAfter) === JSON.stringify(holdBefore), hold: holdAfter };
    await page.waitForFunction(() => window.__mn.client.voyage?.phase === 'sailing' && window.__mn.client.naval?.active, null, { timeout: 10000 });
    await screenshot('03-reboarded-same-voyage');

    check(result.websockets.some(socket => socket.url.includes('/ws')), 'normal play did not connect to local GameHost WSS');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 && result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser/runtime failures: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors, requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.assertions = { serverPositionedDryLandingFixture: true, navigationInputPathTested: false, serverShoreServiceSnapshotAndParkedHull: true,
      existingWalkableAldeaPaidQuoteBuyAndSell: true, noPuertoSolMarketFixture: true, cargoTabAndHoldLockedAtShore: true,
      packCanteenDrinkRefillBucketRecipeSpringCollectionAndFood: true, reboardSameVoyageAndUnchangedHold: true,
      desktopEsMobileEnNoErrorsNoExternalRequests: true };
    result.final = { profile: currentProfile(world, entity).eco.pack, gold: currentProfile(world, entity).gold, hold: holdAfter,
      voyage: afterReboard, screenshots: result.screenshots };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href, bodyText: document.body.innerText.slice(0, 1800), joined: window.__mn?.client?.joined,
      voyage: window.__mn?.client?.voyage, profile: window.__mn?.client?.profile, commerceActive: window.__mn?.panels?.commercePanel?.active,
      freshwaterActive: window.__mn?.panels?.freshwaterPanel?.active, appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (e) { result.browserState = { diagnosticError: String(e) }; }
    try { result.final = { profile: entity && currentProfile(world, entity)?.eco, hostLogs: hostLogs.slice(-30), voyage: entity && world?.navalPilot?.voyageSnapshot(entity) }; } catch {}
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close(); try { await host.close(); } catch (error) { hostLogs.push(`close: ${String(error)}`); }
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, error: result.error?.split('\n')[0] }));
  }
}

const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try { for (const spec of specs) await run(browser, spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

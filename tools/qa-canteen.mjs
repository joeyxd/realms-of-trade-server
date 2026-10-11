#!/usr/bin/env node
// RNV07b local UI acceptance for the canteen, food, and survival meters.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { C } from '../src/sim/ecs.js';
import { freshwaterSource } from '../src/data/freshwater.js';
import { applyNeedsProfile } from '../src/sim/systems/survival.js';
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this disposable local harness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv07b-canteen/local');
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
  { name: 'canteen-desktop-es', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'canteen-mobile-en', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
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
  purpose: 'Verify the RNV07b canteen panel, its bucket/provisions/barrel refills, direct spring channel, food actions, needs meters, reload persistence, and desktop/mobile panel bounds.',
  harness: 'One serial Chromium launch; desktop ES 1280x720 followed by touch portrait EN 390x844; one disposable memory-backed GameHost/account per viewport; local Three.js/GSAP/font routes only. No SQL, external services, production writes, encounter acceptance, or physical-device performance claim.',
  fixture: 'Authenticated profile begins with 7 wood, 2 canvas, 2 fruit, and saved satiety/hydration 20/20. It builds the bucket, canteen, and raft barrel through their UI. The local fixture removes nearby enemy entities and spawners for the water-source loop; it does not test the encounter or interruption behavior.',
  fixtureNeedsResets: 'The harness resets meters between selected refill/drink stages to keep each UI source independently testable. It then reloads after the final server-confirmed drink; those reset values are written through the in-memory fixture and are not player actions.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const ACCOUNT = 'c08408a9-a5a1-44de-82ba-00000000070b';
const RAFT_ID = 'qa-rnv07b-canteen-raft';
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
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ timeOfDay: 'day' })), { key: `${GAME.saveKey}.settings` });
  await page.goto(`http://127.0.0.1:${port}/?debug&q=${result.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator(`.title-language [data-locale="${result.locale}"]`).click();
  await page.waitForFunction(locale => document.documentElement.lang === locale, result.locale, { timeout: 5000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}
function seededProfile() {
  const profile = newProfile(); profile.pirateId = `account:${ACCOUNT}`;
  // The requested fixture weighs 25 units before vessel crafts, so use the
  // largest starter backpack and a valid earned carry attribute allocation.
  profile.lvl = 5; profile.attr = { v: 1, carga: 4, re: 1 }; profile.carry = { v: 1, backpack: 2 };
  profile.eco.pack.cap = 42; profile.eco.pack.maxMass = 70;
  profile.eco.pack.goods = { madera: 7, lona: 2, fruta: 2 };
  profile.surv = { v: 1, sat: 20, hyd: 20 };
  const ship = profile.eco.ships[0]; ship.id = RAFT_ID; ship.grid = newRaft([...STARTER_RAFT]);
  ship.hold.cap = Math.max(ship.hold.cap, 40); ship.hold.goods = {};
  return profile;
}
function activeRaft(world, entity) { return [...world.rafts.values()].find(active => active.owner === entity && active.ship.id === RAFT_ID); }
function currentProfile(world, entity) { return world.profiles.get(entity); }
function relocate(world, server, entity, point) {
  const ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.facing[entity] = point.yaw ?? 0; ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.atkStage[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.regenT[entity] = 3;
  server.broadcastSnapshot();
  return { x: point.x, y: point.y, z: point.z };
}
function raftDeckPoint(world, active, x = 1, z = 0) {
  const raft = { x: world.ecs.x[active.entity], y: world.ecs.y[active.entity], z: world.ecs.z[active.entity], yaw: world.ecs.facing[active.entity] };
  const lx = (x + .5) * 2, lz = (z + .5) * 2, c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
  return { x: raft.x + c * lx + s * lz, y: raft.y, z: raft.z - s * lx + c * lz, yaw: raft.yaw };
}
function protectSpring(world, spring) {
  const ecs = world.ecs;
  const close = [...ecs.each(C.ENEMY)].filter(e => Math.hypot(ecs.x[e] - spring.x, ecs.z[e] - spring.z) <= 40);
  for (const e of close) world.despawn(e);
  world.spawners = world.spawners.filter(sp => Math.hypot(sp.x - spring.x, sp.z - spring.z) > 40);
  return close.length;
}
async function setFixtureNeeds(host, world, server, entity, sat, hyd) {
  // Keep the fixture mutation on the normal profile writer so the following M5
  // receipt sees the exact same baseline in memory and in the disposable store.
  await host.profiles.flush();
  const profile = currentProfile(world, entity), session = [...host.profiles.accounts.values()].find(row => row.key === ACCOUNT);
  profile.surv = { v: 1, sat, hyd };
  applyNeedsProfile(world, entity, profile);
  check(session && host.saveProfile(session.id, profile), 'fixture needs profile save was rejected');
  await host.profiles.flush(); server.broadcastSnapshot();
}

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [], externalRequests: [], websockets: [], screenshots: [], assertions: {} };
  evidence.viewports.push(result);
  const hostLogs = [], store = createMemoryStore(); await store.initializeProfile(ACCOUNT, seededProfile());
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-rnv07b-canteen-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true,
    economicOperations: true, freshwaterOperations: true, canteenOperations: true, fireOperations: false, navigation: false,
    saveSecret: `qa-rnv07b-canteen-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, server, world, entity, profile, raft, spring;
  const screenshot = async label => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 90, fullPage: false }); result.screenshots.push(file); return file;
  };
  const waitPlayer = async point => {
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .6, point, { timeout: 15000 });
  };
  const openPanel = async () => {
    if (spec.touch) await page.locator('.t-water').click(); else await page.keyboard.press('u');
    await page.locator('.freshwater-panel').waitFor({ state: 'visible', timeout: 10000 });
  };
  const closePanel = async () => {
    if (await page.locator('.freshwater-panel').isVisible()) await page.locator('.fresh-close').click();
    await page.waitForFunction(() => !window.__mn.panels.freshwaterPanel.active, null, { timeout: 5000 });
  };
  const bounds = async () => page.locator('.freshwater-panel').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
  });
  const assertBounds = async label => {
    const b = await bounds();
    check(b.x >= 0 && b.right <= spec.width && b.y >= 0 && b.bottom <= spec.height && b.viewport.documentWidth <= spec.width,
      `${label} panel exceeded viewport: ${JSON.stringify(b)}`);
    return b;
  };
  const vessels = () => profile.eco.pack.vessels || [];
  const canteen = () => vessels().find(v => v.kind === 'canteen');
  const bucket = () => vessels().find(v => v.kind === 'bucket');
  const barrel = () => raft.ship.hold.vessels?.find(v => v.kind === 'barrel');
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, result.port, result); profile = currentProfile(world, entity); raft = activeRaft(world, entity);
    check(profile && raft?.ship?.id === RAFT_ID, 'fixture account or starter raft did not attach');
    // The host grants its canonical starter kit on join; replace that disposable fixture
    // with the requested acceptance inventory after the authenticated profile is attached.
    check(profile.eco.pack.goods.madera === 7 && profile.eco.pack.goods.lona === 2 && profile.eco.pack.goods.fruta === 2, 'fixture goods did not load');
    check(profile.surv?.sat <= 20 && profile.surv.sat >= 19 && profile.surv?.hyd <= 20 && profile.surv.hyd >= 19,
      `fixture survival meters did not load near the 20/20 seed: ${JSON.stringify(profile.surv)}`);
    check(world.survivalEnabled === true, 'canteenOperations did not enable survival');
    spring = freshwaterSource(world.map); check(spring && spring.y >= .3, `spring fixture is not valid inland water: ${JSON.stringify(spring)}`);
    const raftPoint = relocate(world, server, entity, raftDeckPoint(world, raft)); await waitPlayer(raftPoint);
    result.fixture = { account: 'disposable memory-backed account', raftId: RAFT_ID, goods: { madera: 7, lona: 2, fruta: 2 }, surv: { sat: 20, hyd: 20 }, spring: { id: 'salty-spring', x: spring.x, y: spring.y, z: spring.z }, nearbyEnemiesRemoved: 0 };

    result.stage = 'craft-bucket-and-canteen';
    await openPanel();
    await page.locator('.fresh-canteen').waitFor({ state: 'visible' });
    check(await page.locator('.fresh-canteen-count').innerText() === '0/3 agua' || spec.locale === 'en', 'canteen count should start empty');
    const initialNeeds = await page.locator('.fresh-canteen-needs').innerText();
    check(initialNeeds.includes(spec.locale === 'en' ? 'Hunger 20' : 'Hambre 20'), `initial needs are missing/localization is wrong: ${initialNeeds}`);
    await page.locator('.fresh-craft').click();
    await waitUntil(() => bucket()?.water === 0, 'server-confirmed bucket craft');
    check(profile.eco.pack.goods.madera === 5, `bucket did not cost 2 wood: ${JSON.stringify(profile.eco.pack.goods)}`);
    await page.locator('.fresh-canteen-craft').click();
    await waitUntil(() => !!canteen(), 'server-confirmed canteen craft');
    check(profile.eco.pack.goods.lona === undefined && profile.eco.pack.goods.madera === 4, `canteen cost mismatch: ${JSON.stringify(profile.eco.pack.goods)}`);
    check(canteen().water === 0, 'new canteen did not start empty');
    result.crafts = { bucketWater: bucket().water, canteenWater: canteen().water, pack: structuredClone(profile.eco.pack.goods), cost: { canteen: '2 lona + 1 madera' } };
    result.desktopOrTouchPanelBounds = await assertBounds('crafting');
    await screenshot('01-canteen-craft-needs'); await closePanel();

    result.stage = 'paid-barrel-construction';
    if (spec.touch) await page.locator('.raft-build-launcher').click(); else await page.keyboard.press('b');
    await page.locator('.raft-editor').waitFor({ state: 'visible', timeout: 12000 });
    const palette = page.locator('.raft-editor [data-part="waterBarrel"]'); await palette.waitFor({ state: 'visible' });
    await palette.click();
    await page.evaluate(() => { const editor = window.__mn.panels.raftEditor; editor.target = { x: 1, z: 0, level: 0, dir: 0 }; editor.render(); });
    const cost = await page.locator('.raft-editor .re-details').innerText();
    check(/4\s+(?:Tabla|Basic plank|Plank|Madera|Wood)/i.test(cost), `barrel four-plank cost was not shown: ${cost}`);
    const editorBounds = await page.locator('.raft-editor').evaluate(el => { const r = el.getBoundingClientRect(), b = el.querySelector('.re-action').getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, action: { x: b.x, right: b.right, bottom: b.bottom }, viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } }; });
    check(editorBounds.action.x >= 0 && editorBounds.action.right <= spec.width && editorBounds.action.bottom <= spec.height && editorBounds.viewport.documentWidth <= spec.width, `barrel builder action overflowed: ${JSON.stringify(editorBounds)}`);
    await screenshot('02-barrel-cost'); await page.locator('.raft-editor .re-action').click();
    await waitUntil(() => raft.ship.grid.parts.some(part => part[0] === 'waterBarrel' && part[1] === 1 && part[2] === 0), 'paid barrel placement');
    check(!profile.eco.pack.goods.madera, `barrel did not cost last 4 wood: ${JSON.stringify(profile.eco.pack.goods)}`);
    const barrelPart = raft.ship.grid.parts.find(p => p[0] === 'waterBarrel'), barrelCondition = raft.condition.entries.find(row => row.part[0] === 'waterBarrel');
    check(barrelPart && barrelCondition?.hp > 0, 'barrel is missing its instance condition');
    result.barrelConstruction = { cost, part: barrelPart, condition: barrelCondition, editorBounds };
    await page.locator('.raft-editor .re-close').click(); await page.waitForFunction(() => !window.__mn.panels.raftEditor.active);

    result.stage = 'spring-channel-and-bucket-collection';
    const enemiesRemoved = protectSpring(world, spring); result.fixture.nearbyEnemiesRemoved = enemiesRemoved;
    const atSpring = relocate(world, server, entity, spring); await waitPlayer(atSpring);
    await page.evaluate(() => window.__mn.panels.companionsPanel?.close());
    await openPanel();
    await waitUntil(() => page.evaluate(() => window.__mn.client.freshwaterStatus?.canteenEnabled === true && window.__mn.client.freshwaterStatus?.source?.near), 'enabled survival snapshot at spring');
    const freshButton = page.locator('.fresh-canteen-spring');
    check(await freshButton.isEnabled(), 'direct spring fill was not enabled at the spring');
    const fillStart = Date.now(); await freshButton.click();
    await waitUntil(async () => (await freshButton.innerText()).includes(spec.locale === 'en' ? 'Filling at spring' : 'Llenando en el manantial'), 'immediate spring channel status');
    await waitUntil(() => canteen()?.water === 3, 'two-second direct canteen spring fill', 20000);
    const directDurationMs = Date.now() - fillStart;
    check(directDurationMs >= 1700, `spring channel resolved too quickly: ${directDurationMs}ms`);
    result.directSpring = { confirmedWater: canteen().water, expectedSeconds: 2, elapsedMs: directDurationMs,
      channelLabel: spec.locale === 'en' ? 'Filling at spring' : 'Llenando en el manantial' };
    await page.locator('.fresh-collect').click(); await waitUntil(() => bucket()?.water === 4, 'two-second bucket spring collection', 20000);
    result.bucketCollection = { confirmedWater: bucket().water, expectedSeconds: 2, enemiesRemovedForFixture: enemiesRemoved };
    await screenshot('03-spring-canteen-full');

    result.stage = 'barrel-transfer-and-refill-sources';
    const atBarrel = relocate(world, server, entity, raftDeckPoint(world, raft, 1, 0)); await waitPlayer(atBarrel);
    await waitUntil(() => page.evaluate(() => window.__mn.client.freshwaterStatus?.barrels?.[0]?.near === true), 'nearby barrel status');
    await waitUntil(() => page.locator('.fresh-deposit').isEnabled(), 'barrel deposit action enabled');
    await page.locator('.fresh-deposit').click(); await waitUntil(() => barrel()?.water === 4 && bucket()?.water === 0, 'bucket-to-barrel transfer');
    check(canteen().water === 3, 'barrel transfer changed canteen contents');
    await setFixtureNeeds(host.game, world, server, entity, 20, 20);
    await waitUntil(() => page.evaluate(() => Math.abs((window.__mn.client.freshwaterStatus?.needs?.hyd ?? 0) - 20) < .25), 'freshwater needs snapshot after fixture reset');
    await waitUntil(() => page.locator('.fresh-canteen-drink').isEnabled(), 'drink action enabled');
    await page.locator('.fresh-canteen-drink').click(); await waitUntil(() => canteen()?.water === 2 && profile.surv.hyd >= 59, 'server-confirmed drink');
    const refillBarrel = page.locator('.fresh-canteen-refill').first(); await waitUntil(() => refillBarrel.isEnabled(), 'barrel canteen refill action enabled');
    await screenshot('04-barrel-refill-available'); await refillBarrel.click();
    await waitUntil(() => canteen()?.water === 3 && barrel()?.water === 3, 'barrel-to-canteen transfer');
    result.barrelRefill = { canteen: canteen().water, barrel: barrel().water, conservedUnits: canteen().water + barrel().water };
    await page.locator('.fresh-withdraw').click(); await waitUntil(() => bucket()?.water === 3 && barrel()?.water === 0, 'barrel withdrawal for the pack');
    await setFixtureNeeds(host.game, world, server, entity, 20, 20);
    await page.locator('.fresh-canteen-drink').click(); await waitUntil(() => canteen()?.water === 2 && profile.surv.hyd >= 59, 'second server-confirmed drink');
    await page.locator('.fresh-canteen-bucket').click(); await waitUntil(() => canteen()?.water === 3 && bucket()?.water === 2, 'bucket-to-canteen refill');
    await page.locator('.fresh-decant-button').click(); await waitUntil(() => bucket()?.water === 0 && profile.eco.pack.goods.agua === 2, 'bucket water moved to provisions');
    await setFixtureNeeds(host.game, world, server, entity, 20, 20);
    await page.locator('.fresh-canteen-drink').click(); await waitUntil(() => canteen()?.water === 2 && profile.surv.hyd >= 59, 'drink before provisions refill');
    await page.locator('.fresh-canteen-provisions').click(); await waitUntil(() => canteen()?.water === 3 && profile.eco.pack.goods.agua === 1, 'provisions-to-canteen refill');
    result.refillSources = { usedBucket: true, usedBarrel: true, usedProvisions: true, canteen: canteen().water, bucket: bucket().water, barrel: barrel().water, provisions: profile.eco.pack.goods.agua || 0 };

    result.stage = 'food-actions-and-empty-canteen-persistence';
    await setFixtureNeeds(host.game, world, server, entity, 20, 20);
    await waitUntil(() => page.locator('.fresh-foods [data-food="fruta"]').isEnabled(), 'available fruit action');
    const foodLabels = await page.locator('.fresh-foods').innerText();
    check(foodLabels.includes(spec.locale === 'en' ? 'Fruit' : 'Fruta'), `fruit food button is missing/localized incorrectly: ${foodLabels}`);
    await page.locator('.fresh-foods [data-food="fruta"]').click(); await waitUntil(() => profile.eco.pack.goods.fruta === 1 && profile.surv.sat >= 34.9, 'server-confirmed fruit consumption');
    result.eatFruit = { remaining: profile.eco.pack.goods.fruta, satiety: profile.surv.sat, hydration: profile.surv.hyd };
    const springAgain = relocate(world, server, entity, spring); await waitPlayer(springAgain);
    await waitUntil(() => page.evaluate(() => window.__mn.client.freshwaterStatus?.source?.near), 'return to spring');
    await page.locator('.fresh-collect').click(); await waitUntil(() => bucket()?.water === 4, 'second bucket spring collection', 20000);
    await page.locator('.fresh-decant-button').click(); await waitUntil(() => bucket()?.water === 0 && profile.eco.pack.goods.agua === 5, 'water decanted for food use');
    await setFixtureNeeds(host.game, world, server, entity, 35, 20);
    await waitUntil(() => page.locator('.fresh-foods [data-food="agua"]').isEnabled(), 'available water food action');
    const waterLabel = await page.locator('.fresh-foods [data-food="agua"]').innerText();
    check(waterLabel.includes(spec.locale === 'en' ? 'Water' : 'Agua'), `water food button is not localized: ${waterLabel}`);
    await page.locator('.fresh-foods [data-food="agua"]').click(); await waitUntil(() => profile.eco.pack.goods.agua === 4 && profile.surv.hyd >= 59, 'server-confirmed water-food consumption');
    await screenshot('05-food-actions');
    for (let dose = 1; dose <= 3; dose++) {
      await setFixtureNeeds(host.game, world, server, entity, profile.surv.sat, 20);
      await waitUntil(() => page.locator('.fresh-canteen-drink').isEnabled(), `drink ${dose} enabled`);
      await page.locator('.fresh-canteen-drink').click();
      await waitUntil(() => canteen()?.water === 3 - dose && profile.surv.hyd >= 59, `server-confirmed final drink ${dose}`);
    }
    check(canteen() && canteen().water === 0, 'drinking the last dose removed the canteen or failed to empty it');
    result.finalDrink = { canteenRetained: true, water: canteen().water, surv: structuredClone(profile.surv), bucket: bucket().water, barrel: barrel().water, provisions: profile.eco.pack.goods.agua };
    await screenshot('06-canteen-empty-retained');
    const preReload = { canteen: canteen().water, bucket: bucket().water, barrel: barrel().water, provisions: profile.eco.pack.goods.agua, surv: structuredClone(profile.surv) };

    result.stage = 'reload-persistence-and-final-bounds';
    await host.game.profiles.flush();
    const durableBeforeReload = await store.loadProfile(ACCOUNT);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator(`.title-language [data-locale="${spec.locale}"]`).click();
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
    entity = await page.evaluate(() => window.__mn.client.youServer); profile = currentProfile(world, entity); raft = activeRaft(world, entity);
    check(profile && raft?.ship?.id === RAFT_ID, 'same account did not restore after browser reload');
    const restored = { canteen: profile.eco.pack.vessels?.find(v => v.kind === 'canteen')?.water,
      bucket: profile.eco.pack.vessels?.find(v => v.kind === 'bucket')?.water,
      barrel: raft.ship.hold.vessels?.find(v => v.kind === 'barrel')?.water, provisions: profile.eco.pack.goods.agua || 0, surv: structuredClone(profile.surv) };
    check(restored.canteen === 0 && restored.bucket === 0 && restored.barrel === 0 && restored.provisions === 4,
      `reload changed saved water counts: ${JSON.stringify(restored)}`);
    const persistedSurv = durableBeforeReload?.data?.surv;
    check(persistedSurv && Math.abs(restored.surv.sat - persistedSurv.sat) <= .25 && Math.abs(restored.surv.hyd - persistedSurv.hyd) <= .25,
      `reload did not restore the durable survival snapshot within natural tick drain: ${JSON.stringify({ persisted: persistedSurv, before: preReload.surv, after: restored.surv })}`);
    await openPanel();
    result.finalPanelBounds = await assertBounds('reloaded final');
    const renderedCount = await page.locator('.fresh-canteen-count').innerText();
    check(renderedCount === (spec.locale === 'en' ? '0/3 water' : '0/3 agua'), `empty canteen was not rendered after reload: ${renderedCount}`);
    await page.locator('.fresh-canteen').scrollIntoViewIfNeeded();
    await screenshot('07-reloaded-empty-canteen');
    check(result.websockets.some(socket => socket.url.includes('/ws')), 'normal play did not connect to local GameHost WSS');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 && result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser errors or external requests: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors, requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.assertions = { normalPlayWssJoinAndSameAccountReload: true, localizedCanteenPanelAndNeeds: true,
      paidBucketCanteenAndBarrelThroughUi: true, directSpringCanteenChannelTwoSeconds: true,
      bucketProvisionsAndBarrelRefills: true, drinkAndFoodActionsServerConfirmed: true,
      finalDoseLeavesEmptyCanteenInPack: true, inventoryAndSurvivalSnapshotPersistOnReload: true,
      desktopPortraitPanelBoundsAndNoDocumentOverflow: true, noBrowserErrorsOrExternalRequests: true,
      encounterDamageInterruptionTested: false };
    result.final = { restored, durableSurvBeforeReload: persistedSurv, panelBounds: result.finalPanelBounds, harbor: { raftId: raft.ship.id } };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href, bodyText: document.body.innerText.slice(0, 2400),
      joined: window.__mn?.client?.joined, profile: window.__mn?.client?.profile, freshwater: window.__mn?.client?.freshwaterStatus,
      freshwaterActive: window.__mn?.panels?.freshwaterPanel?.active, editorActive: window.__mn?.panels?.raftEditor?.active,
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (e) { result.browserState = { diagnosticError: String(e) }; }
    try { result.final = { profile: profile && { surv: profile.surv, pack: profile.eco.pack, ship: profile.eco.ships.find(s => s.id === RAFT_ID) }, activeShip: raft?.ship, hostLogs: hostLogs.slice(-30) }; } catch {}
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

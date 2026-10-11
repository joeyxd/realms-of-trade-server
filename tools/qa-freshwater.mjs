#!/usr/bin/env node
// RNV07a visible freshwater loop on a disposable memory-backed GameHost.
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
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this local harness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv07-freshwater/local');
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
  { name: 'freshwater-desktop-es', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'freshwater-mobile-en', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
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
  purpose: 'Verify visible freshwater source/map marker, bucket, spring collection, raft barrel construction, water transfers, decanting, reload persistence, and localized panel bounds.',
  harness: 'One serial Chromium launch; desktop ES 1280x720 and touch EN 390x844 normal-play sessions; isolated disposable memory-backed GameHost/account per viewport; local Three.js/GSAP/font routes only. No SQL, external services, production writes, or physical-device performance claim.',
  fixture: 'Authenticated profile begins with 6 pack wood and the normal starter raft. The UI pays 2 wood for a bucket and 4 wood for a water barrel. Server-side relocation provides repeatable raft/spring access. To protect this logistics happy path, the fixture removes world enemy entities and spawners; enemy interruption/damage behavior is not evidenced here.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const ACCOUNT = 'c08408a9-a5a1-44de-82ba-000000000707';
const RAFT_ID = 'qa-freshwater-raft';
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
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); last = { status: r.status, body: await r.text() }; if (r.status === 200) return; }
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
  await page.goto(`http://127.0.0.1:${result.port}/?debug&q=${result.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator(`.title-language [data-locale="${result.locale}"]`).click();
  await page.waitForFunction(locale => document.documentElement.lang === locale, result.locale, { timeout: 5000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}
function seededProfile() {
  const profile = newProfile(); profile.pirateId = `account:${ACCOUNT}`;
  profile.eco.pack.goods = { madera: 6 };
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
function protectSpring(world, server, spring) {
  const ecs = world.ecs;
  const close = [...ecs.each(C.ENEMY)].filter(e => Math.hypot(ecs.x[e] - spring.x, ecs.z[e] - spring.z) <= 40);
  for (const e of close) world.despawn(e);
  world.spawners = world.spawners.filter(sp => Math.hypot(sp.x - spring.x, sp.z - spring.z) > 40);
  return close.length;
}

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [], externalRequests: [], websockets: [], screenshots: [], assertions: {} };
  evidence.viewports.push(result);
  const hostLogs = [], store = createMemoryStore(); await store.initializeProfile(ACCOUNT, seededProfile());
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-rnv07-freshwater-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true,
    economicOperations: true, freshwaterOperations: true, fireOperations: false, navigation: false,
    saveSecret: `qa-rnv07-freshwater-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, server, world, entity, profile, raft, spring, enemiesRemoved = 0;
  const screenshot = async label => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88, fullPage: false }); result.screenshots.push(file); return file;
  };
  const joinedAtRaft = async () => {
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
    entity = await page.evaluate(() => window.__mn.client.youServer); profile = currentProfile(world, entity); raft = activeRaft(world, entity);
    check(profile && raft, 'rejoined account did not restore its profile and raft');
    const point = relocate(world, server, entity, raftDeckPoint(world, raft));
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .6, point, { timeout: 15000 });
    await page.evaluate(() => window.__mn.panels.companionsPanel?.close());
  };
  const panelBounds = async () => page.locator('.freshwater-panel').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
  });
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, result.port, result); profile = currentProfile(world, entity); raft = activeRaft(world, entity);
    check(profile?.eco?.pack?.goods?.madera === 6, 'preseeded pack wood did not load'); check(raft?.ship?.id === RAFT_ID, 'preseeded starter raft did not attach');
    spring = freshwaterSource(world.map); check(spring && spring.y >= .3, `spring fixture is not valid inland water: ${JSON.stringify(spring)}`);
    const raftPoint = relocate(world, server, entity, raftDeckPoint(world, raft));
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .6, raftPoint, { timeout: 15000 });
    result.fixture = { account: 'disposable memory-backed account', raftId: RAFT_ID, packWood: 6, spring: { id: 'salty-spring', x: spring.x, y: spring.y, z: spring.z }, enemyProtection: 'server fixture removed nearby ENEMY entities and spawners; this happy path does not verify encounter or interruption behavior' };

    result.stage = 'craft-bucket';
    if (spec.touch) await page.locator('.t-water').click(); else await page.keyboard.press('u');
    await page.locator('.freshwater-panel').waitFor({ state: 'visible' });
    await page.locator('.fresh-craft').click();
    await waitUntil(() => profile.eco.pack.vessels?.some(v => v.id === 'bucket' && v.water === 0), 'server-confirmed bucket craft');
    check(profile.eco.pack.goods.madera === 4, `bucket did not cost exactly 2 wood: ${JSON.stringify(profile.eco.pack.goods)}`);
    result.bucket = { water: profile.eco.pack.vessels.find(v => v.id === 'bucket').water, packWoodAfterCraft: profile.eco.pack.goods.madera };
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__mn.panels.freshwaterPanel.active);

    result.stage = 'paid-barrel-construction';
    if (spec.touch) await page.locator('.raft-build-launcher').click(); else await page.keyboard.press('b');
    await page.locator('.raft-editor').waitFor({ state: 'visible', timeout: 12000 });
    const barrelPalette = page.locator('.raft-editor [data-part="waterBarrel"]'); await barrelPalette.waitFor({ state: 'visible' });
    const barrelPaletteLabel = await barrelPalette.innerText(); await barrelPalette.click();
    await page.evaluate(() => { const editor = window.__mn.panels.raftEditor; editor.target = { x: 1, z: 0, level: 0, dir: 0 }; editor.render(); });
    const barrelCost = await page.locator('.raft-editor .re-details').innerText();
    check(/4\s+(?:Tabla|Basic plank|Plank|Madera|Wood)/i.test(barrelCost), `barrel four-plank cost was not shown: ${barrelCost}`);
    const editorBounds = await page.locator('.raft-editor').evaluate(el => { const r = el.getBoundingClientRect(); const b = el.querySelector('.re-action').getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, action: { x: b.x, y: b.y, right: b.right, bottom: b.bottom }, viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } }; });
    check(editorBounds.action.x >= 0 && editorBounds.action.right <= spec.width && editorBounds.action.bottom <= spec.height && editorBounds.viewport.documentWidth <= spec.width, `barrel builder action overflows: ${JSON.stringify(editorBounds)}`);
    await screenshot('01-barrel-builder-cost');
    await page.locator('.raft-editor .re-action').click();
    await waitUntil(() => raft.ship.grid.parts.some(part => part[0] === 'waterBarrel' && part[1] === 1 && part[2] === 0), 'server-confirmed water barrel placement');
    check(profile.eco.pack.goods.madera === undefined, `barrel did not debit the last 4 wood: ${JSON.stringify(profile.eco.pack.goods)}`);
    const barrelPart = raft.ship.grid.parts.find(p => p[0] === 'waterBarrel'), barrelCond = raft.condition.entries.find(c => c.part[0] === 'waterBarrel');
    check(barrelPart && barrelCond?.hp > 0, 'barrel has no persisted instance condition row');
    result.barrel = { paletteLabel: barrelPaletteLabel, cost: barrelCost, part: barrelPart, condition: barrelCond, packWoodAfterBuild: profile.eco.pack.goods.madera || 0, editorBounds };
    await page.locator('.raft-editor .re-close').click(); await page.waitForFunction(() => !window.__mn.panels.raftEditor.active);

    result.stage = 'spring-collection';
    enemiesRemoved = protectSpring(world, server, spring);
    const springPoint = relocate(world, server, entity, spring);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .6, springPoint, { timeout: 15000 });
    await page.evaluate(() => window.__mn.panels.companionsPanel?.close());
    await page.waitForFunction(() => {
      const source = window.__mn?.world?.scene?.getObjectByName('freshwater-source:salty-spring');
      return source?.visible && source.children.length >= 13;
    }, null, { timeout: 10000 });
    await pause(500);
    result.springVisual = await page.evaluate(() => {
      const source = window.__mn.world.scene.getObjectByName('freshwater-source:salty-spring');
      return { visible: !!source?.visible, geometryChildren: source?.children.length || 0,
        position: source ? { x: source.position.x, y: source.position.y, z: source.position.z } : null,
        player: { x: window.__mn.client.cur.x, z: window.__mn.client.cur.z } };
    });
    await screenshot('02-spring-visible-world');
    await page.keyboard.press('m');
    await page.locator('#mapview .mapv').waitFor({ state: 'visible', timeout: 10000 });
    const mapLabels = (await page.locator('#mapview .mapv-labels').innerText()).trim();
    check(mapLabels.includes(spec.locale === 'en' ? 'Freshwater spring' : 'Manantial de agua dulce'),
      `full map did not label the spring: ${mapLabels}`);
    result.springMap = { label: spec.locale === 'en' ? 'Freshwater spring' : 'Manantial de agua dulce', mapTitle: await page.locator('#mapview .mapv-title').innerText() };
    await screenshot('03-full-map-spring-marker');
    await page.locator('#mapview [data-close]').click();
    await page.waitForFunction(() => document.querySelector('#mapview')?.hidden);
    if (spec.touch) await page.locator('.t-water').click(); else await page.keyboard.press('u');
    await page.locator('.freshwater-panel').waitFor({ state: 'visible' });
    await waitUntil(() => page.locator('.fresh-collect').isEnabled(), 'near spring, empty bucket and enabled collection');
    check(await page.locator('.fresh-source-name').innerText() === (spec.locale === 'en' ? 'Inland spring' : 'Manantial interior'), 'spring panel title was not localized');
    const sourceView = await panelBounds();
    check(sourceView.x >= 0 && sourceView.right <= spec.width && sourceView.y >= 0 && sourceView.bottom <= spec.height && sourceView.viewport.documentWidth <= spec.width,
      `source panel exceeded viewport: ${JSON.stringify(sourceView)}`);
    await screenshot('04-spring-panel');
    await page.locator('.fresh-collect').click();
    await waitUntil(() => profile.eco.pack.vessels?.find(v => v.id === 'bucket')?.water === 4, '2-second server-confirmed spring collection', 20000);
    result.collection = { source: 'salty-spring', seconds: 2, bucketWater: profile.eco.pack.vessels.find(v => v.id === 'bucket').water,
      enemiesRemovedForFixture: enemiesRemoved, snapshotProgress: await page.evaluate(() => window.__mn.client.freshwaterStatus?.gathering) };

    result.stage = 'deposit-water-in-barrel';
    const raftPointAfterBuild = raftDeckPoint(world, raft, 1, 0);
    const atBarrel = relocate(world, server, entity, raftPointAfterBuild);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < .6, atBarrel, { timeout: 15000 });
    await waitUntil(() => page.evaluate(() => window.__mn.client.freshwaterStatus?.barrels?.[0]?.near === true), 'near barrel snapshot');
    await waitUntil(() => page.locator('.fresh-deposit').isEnabled(), 'deposit action enabled');
    await screenshot('05-barrel-before-deposit');
    await page.locator('.fresh-deposit').click();
    await waitUntil(() => raft.ship.hold.vessels?.find(v => v.id === barrelCond.id)?.water === 4, 'server-confirmed barrel deposit');
    check(profile.eco.pack.vessels.find(v => v.id === 'bucket').water === 0, 'deposit duplicated water in bucket');
    result.deposit = { bucket: profile.eco.pack.vessels.find(v => v.id === 'bucket').water, barrel: raft.ship.hold.vessels.find(v => v.id === barrelCond.id).water };
    await waitUntil(async () => (await page.locator('.fresh-barrel-title span').first().innerText()).trim() === '4/20', 'rendered barrel water 4/20');
    await waitUntil(async () => !(await page.locator('.fresh-barrel-state').first().innerText()).trim(), 'rendered barrel no longer empty');
    result.renderedDeposit = { amount: (await page.locator('.fresh-barrel-title span').first().innerText()).trim(), state: (await page.locator('.fresh-barrel-state').first().innerText()).trim() };
    await screenshot('06-barrel-with-water-4-of-20');

    result.stage = 'reload-persistence';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator(`.title-language [data-locale="${spec.locale}"]`).click();
    await page.locator('#btn-play').click({ force: true }); await joinedAtRaft();
    const persistedBarrel = raft.ship.hold.vessels?.find(v => v.id === barrelCond.id)?.water;
    check(profile.eco.pack.vessels.find(v => v.id === 'bucket')?.water === 0 && persistedBarrel === 4,
      `ordered reload lost bucket/barrel water: ${JSON.stringify({ bucket: profile.eco.pack.vessels, barrel: raft.ship.hold.vessels })}`);
    result.reload = { raftId: raft.ship.id, bucket: profile.eco.pack.vessels.find(v => v.id === 'bucket').water, barrel: persistedBarrel,
      ordered: 'browser reload -> memory GameHost save -> same account normal-play WSS rejoin' };

    result.stage = 'withdraw-and-decant';
    await page.keyboard.press('u'); await page.locator('.freshwater-panel').waitFor({ state: 'visible' });
    await waitUntil(() => page.locator('.fresh-withdraw').isEnabled(), 'withdraw action enabled');
    await page.locator('.fresh-withdraw').click();
    await waitUntil(() => profile.eco.pack.vessels.find(v => v.id === 'bucket')?.water === 4 && raft.ship.hold.vessels.find(v => v.id === barrelCond.id)?.water === 0, 'server-confirmed barrel withdrawal');
    await page.locator('.fresh-decant-button').click();
    await waitUntil(() => (profile.eco.pack.goods.agua || 0) === 4 && profile.eco.pack.vessels.find(v => v.id === 'bucket')?.water === 0, 'server-confirmed decant into provisions');
    check(!raft.ship.hold.vessels.find(v => v.id === barrelCond.id)?.water, 'barrel water remained after full withdrawal');
    result.withdrawAndDecant = { bucket: profile.eco.pack.vessels.find(v => v.id === 'bucket').water, barrel: 0, provisions: profile.eco.pack.goods.agua,
      conservation: profile.eco.pack.goods.agua + profile.eco.pack.vessels.find(v => v.id === 'bucket').water };
    check(result.withdrawAndDecant.conservation === 4, 'water quantity was lost or duplicated during transfers');
    await screenshot('07-water-in-provisions');

    result.stage = 'final-visual-checks';
    const finalPanelBounds = await panelBounds();
    check(finalPanelBounds.x >= 0 && finalPanelBounds.right <= spec.width && finalPanelBounds.y >= 0 && finalPanelBounds.bottom <= spec.height &&
      finalPanelBounds.viewport.documentWidth <= spec.width, `final freshwater panel overflow: ${JSON.stringify(finalPanelBounds)}`);
    check(result.websockets.some(socket => socket.url.includes('/ws')), 'normal play did not connect to local GameHost WSS');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 && result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser errors or external requests: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors, requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.assertions = { normalPlayWssJoinAndReload: true, localizedBucketAndSpringUI: true, exactTwoWoodBucketAndFourWoodBarrelPayments: true,
      realTwoSecondServerSpringCollection: true, serverConfirmedDepositWithdrawAndDecant: true, bucketAndBarrelWaterSurvivesOrderedReload: true,
      waterAmountConserved: true, desktopMobilePanelBoundsAndNoDocumentOverflow: true, noBrowserErrorsOrExternalRequests: true,
      encounterDamageInterruptionTested: false };
    result.final = { raftId: raft.ship.id, pack: structuredClone(profile.eco.pack), holdVessels: structuredClone(raft.ship.hold.vessels), panelBounds: finalPanelBounds };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href, bodyText: document.body.innerText.slice(0, 1800), joined: window.__mn?.client?.joined,
      profile: window.__mn?.client?.profile, clientWater: window.__mn?.client?.freshwaterStatus, freshwaterActive: window.__mn?.panels?.freshwaterPanel?.active,
      editorActive: window.__mn?.panels?.raftEditor?.active, appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (e) { result.browserState = { diagnosticError: String(e) }; }
    try { result.final = { profile: profile && { pack: profile.eco.pack, ship: profile.eco.ships.find(s => s.id === RAFT_ID) }, activeShip: raft?.ship, hostLogs: hostLogs.slice(-30) }; } catch {}
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close(); try { await host.close(); } catch (e) { hostLogs.push(`close: ${String(e)}`); }
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, error: result.error?.split('\n')[0] }));
  }
}

const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try { for (const spec of specs) await run(browser, spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

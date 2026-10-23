#!/usr/bin/env node
// RNV06 local visual acceptance for passive raft water production. Disposable memory-backed GameHost only.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { STARTER_RAFT, RAFT_PARTS } from '../src/data/raftparts.js';
import { productionKey } from '../src/sim/economy/raftProduction.js';
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') {
  throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this local harness.');
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv06-purifier/local');
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
  { name: 'purifier-desktop-es-low', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'purifier-mobile-en-low', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
];
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
  purpose: 'Verify purifier palette, paid construction, public raft rendering, localized production and cargo UI, 96-second output, UI transfer, and ordered reconnect persistence.',
  harness: 'One serial Chromium launch; desktop ES 1280x720 and mobile EN 390x844 low-quality normal-play sessions; isolated disposable memory-backed GameHost/account per viewport; local Three.js/GSAP/font routes. No SQL, external services, production writes, or physical-device performance claim.',
  fixture: 'The authenticated profile owns its starter raft, with a free foundation cell at (1,0), 3 iron and 1 wood in the hold, and 1 wood in the pack. Server-only relocation to the raft, noon clock setup, and economy.advance(48) calls provide repeatability. The disposable GameHost economy step is frozen after noon so browser and reload wall time cannot advance production; controlled seconds still enter through Economy.advance/onAdvance. The purifier target cell (1,0) is assigned through the editor fixture; the visible palette and Place button perform the actual construction intent. Cargo transfer and reload/rejoin use normal UI and WSS.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const ACCOUNT = '49bb401e-58da-4f5a-9111-000000000706';
const RAFT_ID = 'qa-purifier-raft';
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
  const language = page.locator(`.title-language [data-locale="${result.locale}"]`);
  await language.waitFor({ state: 'visible', timeout: 10000 });
  await language.click();
  await page.waitForFunction(locale => document.documentElement.lang === locale, result.locale, { timeout: 5000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled,
    null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}
function seededProfile() {
  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT}`;
  profile.eco.pack.goods = { madera: 1 };
  const ship = profile.eco.ships[0];
  ship.id = RAFT_ID;
  ship.grid = newRaft([...STARTER_RAFT]);
  ship.hold.cap = Math.max(ship.hold.cap, 40);
  ship.hold.goods = { hierro: 3, madera: 1 };
  return profile;
}
function relocateToRaft(world, server, entity, raft) {
  const ecs = world.ecs, x = (1.5) * 2, z = 0.5 * 2, c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
  const point = { x: raft.x + c * x + s * z, y: raft.y, z: raft.z - s * x + c * z };
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z; ecs.facing[entity] = raft.yaw;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.atkStage[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0;
  server.broadcastSnapshot();
  return point;
}
function currentSource(world, entity) {
  return [...world.rafts.values()].find(active => active.owner === entity && active.ship.id === RAFT_ID);
}
function currentProfile(world, entity) { return world.profiles.get(entity); }

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [],
    httpFailures: [], externalRequests: [], websockets: [], screenshots: [], assertions: {} };
  evidence.viewports.push(result);
  const hostLogs = [];
  const store = createMemoryStore();
  await store.initializeProfile(ACCOUNT, seededProfile());
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-rnv06-purifier-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true,
    economicOperations: true, fireOperations: false, navigation: false,
    saveSecret: `qa-rnv06-purifier-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, server, world, entity, profile, source;
  const screenshot = async label => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88, fullPage: false });
    result.screenshots.push(file); return file;
  };
  const waitForJoin = async () => {
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled,
      null, { timeout: 90000 });
    entity = await page.evaluate(() => window.__mn.client.youServer);
    profile = currentProfile(world, entity);
    source = currentSource(world, entity);
    check(profile && source, 'rejoined account did not restore its raft profile');
    const raftRecord = { ...source, x: world.ecs.x[source.entity], y: world.ecs.y[source.entity],
      z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] };
    const point = relocateToRaft(world, server, entity, raftRecord);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < 0.5,
      { x: point.x, z: point.z }, { timeout: 15000 });
    // M5 may replace the Economy instance while draining persisted receipts on reconnect.
    // Re-pause this disposable QA world so only explicit Economy.advance calls affect the recipe.
    world.economy.step = () => {};
  };
  const openProduction = async () => {
    await page.waitForFunction(() => { const button = document.querySelector('.commerce-cargo-launcher'); return button && !button.hidden; }, null, { timeout: 15000 });
    await page.locator('.commerce-cargo-launcher').click();
    await page.locator('.commerce-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.commerce-panel [data-view="production"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.commerce-panel [data-view="production"]').click();
    await page.locator('.production-card').waitFor({ state: 'visible', timeout: 10000 });
  };
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage();
    entity = await openApp(page, result.port, result); profile = currentProfile(world, entity); source = currentSource(world, entity);
    check(profile?.eco?.pack?.goods?.madera === 1, 'preseeded pack wood did not load into the authenticated profile');
    check(profile?.eco?.ships?.[0]?.hold?.goods?.hierro === 3 && profile.eco.ships[0].hold.goods.madera === 1,
      'preseeded hold materials did not load into the authenticated profile');
    check(source && source.ship.grid.parts.some(part => part[0] === 'foundation' && part[1] === 1 && part[2] === 0),
      'preseeded raft or free purifier foundation cell did not attach');
    world.economy.hours = 12; world.economy.acc = 0;
    const boatPoint = relocateToRaft(world, server, entity, { ...source, x: world.ecs.x[source.entity], y: world.ecs.y[source.entity],
      z: world.ecs.z[source.entity], yaw: world.ecs.facing[source.entity] });
    world.economy.step = () => {};
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < 0.5,
      { x: boatPoint.x, z: boatPoint.z }, { timeout: 15000 });
    result.fixture = { raftId: RAFT_ID, freeFoundationCell: [1, 0, 0], hold: { hierro: 3, madera: 1 }, pack: { madera: 1 },
      startHour: world.economy.hours, relocation: 'server-side repeatability fixture', economyStep: 'paused on disposable world; exact progress uses Economy.advance/onAdvance',
      targetCell: 'programmatic editor target; palette selection and Place button use visible UI' };

    result.stage = 'visible-builder-installation';
    await page.locator('.raft-build-launcher').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.raft-build-launcher').click();
    await page.locator('.raft-editor').waitFor({ state: 'visible', timeout: 10000 });
    const purifierButton = page.locator('.raft-editor [data-part="purifier"]');
    await purifierButton.waitFor({ state: 'visible', timeout: 10000 });
    const paletteLabel = await purifierButton.innerText();
    await purifierButton.click();
    await page.evaluate(() => {
      const editor = window.__mn.panels.raftEditor;
      editor.target = { x: 1, z: 0, level: 0, dir: 0 };
      editor.render();
    });
    const costText = await page.locator('.raft-editor .re-details').innerText();
    check(/3\s+Iron/i.test(costText) && /2\s+Basic plank/i.test(costText) ||
      /3\s+Hierro/i.test(costText) && /2\s+Tabla básica/i.test(costText), `purifier cost was not visible: ${costText}`);
    const editorBounds = await page.locator('.raft-editor').evaluate(el => {
      const r = el.getBoundingClientRect();
      const action = el.querySelector('.re-action').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
        action: { x: action.x, y: action.y, width: action.width, height: action.height, right: action.right, bottom: action.bottom },
        viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
    });
    check(editorBounds.action.width >= 44 && editorBounds.action.height >= 44 && editorBounds.action.x >= 0 &&
      editorBounds.action.right <= spec.width && editorBounds.action.y < spec.height &&
      editorBounds.viewport.documentWidth <= spec.width, `builder action does not fit viewport: ${JSON.stringify(editorBounds)}`);
    await screenshot('01-purifier-builder-cost');
    const stockBefore = { hold: structuredClone(profile.eco.ships[0].hold.goods), pack: structuredClone(profile.eco.pack.goods) };
    await page.locator('.raft-editor .re-action').click();
    await waitUntil(() => source.ship.grid.parts.some(part => part[0] === 'purifier' && part[1] === 1 && part[2] === 0), 'server-confirmed purifier placement');
    await page.waitForFunction(({ raftId }) => {
      const row = window.__mn.client.pred.rafts.find(raft => raft.id === raftId);
      return row?.parts?.some(part => part[0] === 'purifier' && part[1] === 1 && part[2] === 0);
    }, { raftId: RAFT_ID }, { timeout: 15000 });
    const purifier = source.ship.grid.parts.find(part => part[0] === 'purifier' && part[1] === 1 && part[2] === 0);
    const purifierIndex = source.ship.grid.parts.indexOf(purifier);
    const condition = source.condition.entries[purifierIndex];
    check(condition?.hp === RAFT_PARTS.purifier.hp, `purifier live HP was not initialized from its catalog: ${JSON.stringify(condition)}`);
    check(profile.eco.ships[0].hold.goods.hierro === undefined && profile.eco.ships[0].hold.goods.madera === undefined &&
      profile.eco.pack.goods.madera === undefined, `purifier did not debit exactly 3 iron and 2 total wood: ${JSON.stringify({ before: stockBefore, after: { hold: profile.eco.ships[0].hold.goods, pack: profile.eco.pack.goods } })}`);
    const renderer = await page.evaluate(raftId => {
      const view = window.__mn.world.rafts.views.get(String(raftId));
      const visual = view?.visual;
      return { root: !!view?.root, visualChildren: visual?.children.length || 0,
        purifierCatalogRow: window.__mn.client.pred.rafts.find(raft => raft.id === raftId)?.parts?.find(part => part[0] === 'purifier') || null };
    }, RAFT_ID);
    check(renderer.root && renderer.visualChildren > 0 && renderer.purifierCatalogRow,
      `purifier was not included in the public raft renderer/catalog projection: ${JSON.stringify(renderer)}`);
    result.installation = { paletteLabel, visibleCost: costText, holdBefore: stockBefore.hold, packBefore: stockBefore.pack,
      holdAfter: structuredClone(profile.eco.ships[0].hold.goods), packAfter: structuredClone(profile.eco.pack.goods),
      purifier: [...purifier], hp: condition.hp, publicRenderer: renderer, editorBounds };
    await page.locator('.raft-editor .re-close').click();
    await page.waitForFunction(() => !window.__mn.panels.raftEditor.active, null, { timeout: 5000 });
    await screenshot('02-purifier-installed-on-raft');

    result.stage = 'production-panel-and-partial-progress';
    const purifierKey = productionKey(purifier);
    await openProduction();
    const productionCard = page.locator('.production-card').first();
    await productionCard.waitFor({ state: 'visible', timeout: 10000 });
    const initialText = await productionCard.innerText();
    check(initialText.includes('96') && initialText.includes(spec.locale === 'en' ? 'Purifier' : 'Purificador') &&
      initialText.includes(spec.locale === 'en' ? 'Fresh water' : 'Agua dulce'), `production UI does not show localized 96-second water recipe: ${initialText}`);
    check(initialText.includes(spec.locale === 'en' ? 'No inputs' : 'Sin insumos'), `purifier is incorrectly shown with inputs: ${initialText}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__mn.panels.commercePanel.active, null, { timeout: 5000 });
    const hoursBeforeHalf = world.economy.hours;
    world.economy.advance(48);
    check(Math.abs(source.ship.grid.work[purifierKey] - 0.5) < 1e-9, `48 server simulation seconds did not save half progress: ${source.ship.grid.work[purifierKey]}`);
    await openProduction();
    const halfCard = page.locator('.production-card').first();
    await waitUntil(async () => (await halfCard.innerText()).includes('50%'), 'visible purifier 50 percent progress');
    const halfText = await halfCard.innerText();
    const productionBounds = await page.locator('.commerce-panel').evaluate(el => {
      const panel = el.getBoundingClientRect();
      const cards = [...el.querySelectorAll('.production-card')].map(card => {
        const r = card.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      });
      return { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom,
        cards, viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
    });
    check(productionBounds.x >= 0 && productionBounds.right <= spec.width && productionBounds.viewport.documentWidth <= spec.width &&
      productionBounds.cards.every(card => card.x >= 0 && card.right <= spec.width && card.y < spec.height),
      `production content does not fit viewport: ${JSON.stringify(productionBounds)}`);
    await screenshot('03-purifier-production-50-percent');
    result.progress = { startHour: hoursBeforeHalf, simSeconds: 48, savedFraction: source.ship.grid.work[purifierKey],
      visibleCard: halfText, bounds: productionBounds };

    result.stage = 'ordered-reload-partial-fraction';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await waitForJoin();
    check(source.ship.id === RAFT_ID && Math.abs(source.ship.grid.work[purifierKey] - 0.5) < 1e-9,
      `ordered reconnect did not retain the same raft and 50 percent purifier work: ${JSON.stringify({ raft: source.ship.id, work: source.ship.grid.work })}`);
    await openProduction();
    const reloadedCard = page.locator('.production-card').first();
    await waitUntil(async () => (await reloadedCard.innerText()).includes('50%'), 'reloaded visible purifier fraction');
    result.reconnect = { sameRaft: source.ship.id, work: source.ship.grid.work[purifierKey], visibleCard: await reloadedCard.innerText(),
      ordered: 'page reload disconnect -> GameHost account save -> same account normal-play WSS rejoin' };

    result.stage = 'water-output-and-cargo-transfer';
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__mn.panels.commercePanel.active, null, { timeout: 5000 });
    world.economy.advance(48);
    await waitUntil(() => source.ship.hold.goods.agua === 1 && !Object.hasOwn(source.ship.grid.work, purifierKey), 'one complete water lot after 96 seconds');
    await openProduction();
    const completedCard = page.locator('.production-card').first();
    await waitUntil(async () => (await completedCard.innerText()).includes('100%') || !(await completedCard.innerText()).includes('50%'), 'completed purifier status');
    const completedText = await completedCard.innerText();
    await screenshot('04-purifier-produced-water');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__mn.panels.commercePanel.active, null, { timeout: 5000 });
    await page.waitForFunction(() => { const button = document.querySelector('.commerce-cargo-launcher'); return button && !button.hidden; }, null, { timeout: 15000 });
    await page.locator('.commerce-cargo-launcher').click();
    await page.locator('.commerce-panel').waitFor({ state: 'visible', timeout: 10000 });
    const waterRow = page.locator('.commerce-panel .commerce-good[data-good="agua"]');
    await waterRow.waitFor({ state: 'visible', timeout: 10000 });
    const cargoTextBeforeTransfer = await waterRow.innerText();
    const cargoBounds = await page.locator('.commerce-panel').evaluate(el => {
      const panel = el.getBoundingClientRect(), confirm = el.querySelector('.commerce-confirm').getBoundingClientRect();
      return { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom,
        confirm: { x: confirm.x, y: confirm.y, width: confirm.width, height: confirm.height, right: confirm.right, bottom: confirm.bottom },
        viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
    });
    check(cargoBounds.x >= 0 && cargoBounds.right <= spec.width && cargoBounds.confirm.x >= 0 &&
      cargoBounds.confirm.right <= spec.width && cargoBounds.confirm.bottom <= spec.height &&
      cargoBounds.viewport.documentWidth <= spec.width, `cargo transfer controls do not fit viewport: ${JSON.stringify(cargoBounds)}`);
    await screenshot('05-purifier-water-in-raft-hold');
    const calmReady = await waitUntil(() => {
      const ecs = world.ecs;
      if (ecs.regenT[entity] < 3 || ecs.moveMag[entity] > 1e-6 || Math.hypot(ecs.vx[entity], ecs.vz[entity]) > 1e-6 ||
          ecs.dashT[entity] >= 0 || ecs.dashBuffer[entity] > 0 || ecs.castK[entity] > 0 || ecs.castLock[entity] > 0) return false;
      return { regenT: ecs.regenT[entity], moveMag: ecs.moveMag[entity], vx: ecs.vx[entity], vz: ecs.vz[entity],
        dashT: ecs.dashT[entity], dashBuffer: ecs.dashBuffer[entity], castK: ecs.castK[entity], castLock: ecs.castLock[entity] };
    }, 'ordinary server calm and stationary cargo precondition', 15000);
    result.transferPrecondition = { source: 'ordinary GameHost simulation; waited for the actual calm/stationary gate', ...calmReady };
    await waterRow.click();
    await page.locator('.commerce-panel [data-cargo-side]').selectOption('withdraw');
    await page.locator('.commerce-panel .commerce-confirm').click();
    await waitUntil(() => profile.eco.pack.goods.agua === 1 && source.ship.hold.goods.agua === undefined,
      'confirmed UI transfer of purifier water to pack');
    result.transfer = { visibleCargoRow: cargoTextBeforeTransfer, packWater: profile.eco.pack.goods.agua,
      holdWater: source.ship.hold.goods.agua ?? 0, operation: 'visible cargo row + withdraw selector + confirm button' };
    await screenshot('06-purifier-water-transferred-to-pack');

    result.stage = 'ordered-reload-same-raft-next-fraction';
    world.economy.advance(48);
    check(Math.abs(source.ship.grid.work[purifierKey] - 0.5) < 1e-9,
      `the purifier did not start its next persisted fraction after output: ${source.ship.grid.work[purifierKey]}`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await waitForJoin();
    check(source.ship.id === RAFT_ID && profile.eco.pack.goods.agua === 1 &&
      Math.abs(source.ship.grid.work[purifierKey] - 0.5) < 1e-9,
      `ordered reconnect lost transferred water or same-raft work: ${JSON.stringify({ raft: source.ship.id, pack: profile.eco.pack.goods, work: source.ship.grid.work })}`);
    result.finalProfile = { raftId: source.ship.id, pack: structuredClone(profile.eco.pack.goods), hold: structuredClone(source.ship.hold.goods),
      work: source.ship.grid.work[purifierKey], condition: structuredClone(source.condition.entries[purifierIndex]) };
    await openProduction();
    const finalCard = page.locator('.production-card').first();
    await waitUntil(async () => (await finalCard.innerText()).includes('50%'), 'final reloaded purifier half progress');
    await screenshot('07-purifier-reloaded-progress-and-pack-water');

    result.stage = 'final-browser-checks';
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      quality: window.__mn.quality.current, websocketReady: window.__mn.transport?.ws?.readyState === WebSocket.OPEN,
      stage: (() => { const r = window.__mn.world?.renderer?.domElement?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; })() }));
    check(!viewport.overflow && viewport.quality === spec.quality, `viewport or quality check failed: ${JSON.stringify(viewport)}`);
    check(result.websockets.some(socket => socket.url.includes('/ws')), 'normal play did not connect to GameHost WebSocket');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 &&
      result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser errors or external requests: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors,
        requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.finalViewport = viewport;
    result.assertions = { normalPlayWssJoinAndOrderedReload: true, localizedVisiblePurifierPalette: true,
      exactThreeIronTwoWoodPaymentAcrossHoldAndPack: true, publicPurifierModelAndCatalogRow: true,
      catalogHpAndNoFuelOrInputCost: true, localized96SecondProductionRow: true, serverOwned48SecondPartialProgress: true,
      savedFractionSurvivesOrderedReconnect: true, waterProducedAfter96SimulationSeconds: true,
      waterVisibleInHoldAndTransferredToPackThroughUI: true, nextWaterFractionSurvivesSecondReconnect: true,
      builderProductionAndCargoControlsFitViewport: true, noBrowserErrorsOrExternalRequests: true };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href,
      bodyText: document.body.innerText.slice(0, 1800), quality: window.__mn?.quality?.current,
      joined: window.__mn?.client?.joined, profile: window.__mn?.client?.profile,
      editorActive: window.__mn?.panels?.raftEditor?.active, commerceActive: window.__mn?.panels?.commercePanel?.active,
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (diagnosticError) {
      result.browserState = { diagnosticError: String(diagnosticError) };
    }
    try { result.final = { profile: profile && { pack: profile.eco.pack, ship: profile.eco.ships.find(s => s.id === RAFT_ID) },
      activeShip: source?.ship && { id: source.ship.id, grid: source.ship.grid, hold: source.ship.hold },
      condition: source?.condition?.entries?.map(entry => ({ part: entry.part, hp: entry.hp })), hostLogs: hostLogs.slice(-30) }; } catch {}
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

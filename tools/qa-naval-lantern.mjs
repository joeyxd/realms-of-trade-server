#!/usr/bin/env node
// RNV02 acceptance through the real raft editor, GameHost, public snapshots, navigation prompt, and local light manager.
// Starting materials, character relocation, and the damage stimulus are disposable QA fixtures.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { persistRaftCondition } from '../src/sim/naval/condition.js';
import { applyPartDamage } from '../src/sim/naval/structure.js';
import { GAME } from '../src/data/meta.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv02-naval-lantern');
await mkdir(out, { recursive: true });
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const threeRoot = resolve(repo, 'node_modules/three');
const gsapRoot = resolve(process.env.MN_GSAP || resolve(repo, '.scratch/gsap-local/package'));
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify paid raft-lantern placement, default-off state, V/touch switching, local light movement, and damage/repair behavior.',
  harness: 'Disposable GameHost, browser WebSocket, in-memory owner profile, local Three.js/GSAP/font routes. No production server or physical-device performance claim.',
  fixture: 'Starting materials are seeded into the disposable profile. ECS relocation and a direct part-damage stimulus set up repeatable interaction/repair checks; placement, switching, and repair use the actual UI/server commands.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const runTag = evidence.generatedAt.replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'lantern-desktop-low-es', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'lantern-desktop-high-en', width: 1280, height: 720, touch: false, quality: 'high', locale: 'en' },
  { name: 'lantern-mobile-low-en', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
  { name: 'lantern-mobile-high-es', width: 390, height: 844, touch: true, quality: 'high', locale: 'es' },
];
const selectedViewport = process.env.MN_QA_VIEWPORT;
if (selectedViewport) {
  const selected = specs.filter((spec) => spec.name.includes(selectedViewport));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${selectedViewport}`);
  specs.splice(0, specs.length, ...selected);
}

const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });

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
async function waitHealthy(port) {
  const deadline = Date.now() + 30000; let last = null;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); last = { status: response.status, body: await response.text() }; if (response.status === 200) return; }
    catch (error) { last = String(error); }
    await pause(100);
  }
  throw new Error(`GameHost did not become healthy: ${JSON.stringify(last)}`);
}
async function openApp(page, port, result) {
  page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', (response) => { if (response.status() >= 400) result.httpFailures.push({ url: response.url(), status: response.status() }); });
  page.on('websocket', (socket) => result.websockets.push({ url: socket.url() }));
  await installRoutes(page, result);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=${result.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn.input.enabled, null, { timeout: 90000 });
  return page.evaluate(() => window.__mn.client.youServer);
}
const serverFor = (host) => host.game.server;
const localToWorld = (raft, x, z) => { const c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
  return { x: raft.x + c * x + s * z, y: raft.y, z: raft.z - s * x + c * z }; };
function relocate(world, server, entity, raft, lx, lz) {
  const p = localToWorld(raft, lx, lz), ecs = world.ecs;
  ecs.x[entity] = p.x; ecs.y[entity] = p.y; ecs.z[entity] = p.z;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.atkStage[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0;
  server.broadcastSnapshot(); return p;
}
async function waitUntil(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(25); }
  throw new Error(`timed out waiting for ${label}`);
}

async function run(spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [],
    externalRequests: [], websockets: [], screenshots: [], lanternAcks: [], editAcks: [] };
  evidence.viewports.push(result);
  const hostLogs = [];
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `qa-naval-lantern-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, entity, server, world, source, ship;
  const screenshot = async (label) => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 85 }); result.screenshots.push(file); return file;
  };
  try {
    const port = await host.listen(); await waitHealthy(port); server = serverFor(host); world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, port, result);
    const raft = publicRafts(world).find((candidate) => candidate.owner === entity);
    check(raft, 'joined profile has no owned raft'); source = world.rafts.get(raft.id); ship = source?.ship;
    check(ship, 'owned raft has no server ship');
    const originalPose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
    const profile = world.profiles.get(entity), clientRow = [...server.clients].find(([, client]) => client.entity === entity);
    check(profile?.eco?.pack && clientRow, 'owner profile or WebSocket client is missing');
    const beforeGoods = { ...profile.eco.pack.goods };
    profile.eco.pack.cap = Math.max(profile.eco.pack.cap || 0, 100);
    profile.eco.pack.goods = { ...profile.eco.pack.goods, madera: 40, hierro: 4, lona: 4 };
    server.sendProfile(clientRow[0], clientRow[1]);
    relocate(world, server, entity, raft, 1, 1);
    const originalEmit = world.emit.bind(world);
    world.emit = (event) => {
      if (event?.type === 'raftEdit') result.editAcks.push({ op: event.op, ok: event.ok, why: event.why || '', rev: event.rev });
      if (event?.type === 'raftLantern') result.lanternAcks.push({ ok: event.ok, why: event.why || '', lit: event.lit, changed: event.changed });
      return originalEmit(event);
    };
    await page.evaluate((locale) => { document.documentElement.lang = locale; }, spec.locale);
    await page.waitForFunction(() => !!window.__mn.client.pred.raftDeck.surface(window.__mn.client.cur.x, window.__mn.client.cur.z, window.__mn.client.cur.y)?.id,
      null, { timeout: 15000 });
    await page.locator('.raft-build-launcher').click();
    await page.waitForFunction(() => window.__mn.panels.raftEditor.active, null, { timeout: 10000 });
    await page.locator('.raft-editor [data-part="lantern"]').waitFor({ state: 'visible', timeout: 10000 });
    result.stage = 'paid-placement-default-off';
    const tuple = ['lantern', 1, 0, 0, 0];
    const placePiece = async (piece) => {
      await page.evaluate((p) => { const editor = window.__mn.panels.raftEditor;
        editor.selected = p[0]; editor.level = p[3]; editor.dir = p[4]; editor.mode = 'place';
        editor.target = { x: p[1], z: p[2], level: p[3], dir: p[4] }; editor.render(); }, piece);
      await waitUntil(() => page.locator('.raft-editor .re-action').isEnabled(), `valid paid ${piece[0]} placement`);
      const old = ship.rev; await page.locator('.raft-editor .re-action').click();
      await waitUntil(() => ship.rev > old && source.condition.entries.some((entry) => JSON.stringify(entry.part) === JSON.stringify(piece)), `server ${piece[0]} placement`);
      await page.waitForFunction(() => !window.__mn.panels.raftEditor.pending, null, { timeout: 20000 });
    };
    await placePiece(tuple);
    const lamp = source.condition.entries.find((entry) => JSON.stringify(entry.part) === JSON.stringify(tuple));
    check(lamp && lamp.hp > 0 && !ship.litLanterns?.includes(lamp.id), 'placed lantern did not start live, paid, and off');
    check(profile.eco.pack.goods.hierro < 4 || profile.eco.pack.goods.madera < 40 || (ship.hold?.goods?.hierro || 0) > (beforeGoods.hierro || 0),
      'placement did not debit its materials');
    await page.locator('.raft-editor .re-close').click();
    const raftNow = publicRafts(world).find((row) => row.id === ship.id);
    const floorPoint = lanternPoint(raftNow, tuple);
    const relocateNearLamp = () => {
      const e = server.clients.get(clientRow[0]).entity, ecs = world.ecs;
      ecs.x[e] = floorPoint.x; ecs.y[e] = floorPoint.y; ecs.z[e] = floorPoint.z;
      ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = ecs.moveMag[e] = 0; server.broadcastSnapshot(); return e;
    };
    const player = relocateNearLamp();
    const night = await page.evaluate(() => window.__mn.tod('night'));
    result.nightFixture = night;
    await page.waitForFunction((expected) => window.__mn.navigation.interaction()?.actions?.some((a) => a.lantern && a.verb === expected),
      spec.locale === 'en' ? 'Light lantern' : 'Encender farol', { timeout: 15000 });
    await screenshot('01-off-prompt');
    result.stage = 'switch-on';
    const clickContext = async () => spec.touch
      ? page.locator('.ln-prompt [data-run]').tap()
      : page.keyboard.press('v');
    const actStart = result.lanternAcks.length;
    await clickContext();
    await waitUntil(() => result.lanternAcks.slice(actStart).some((ack) => ack.ok && ack.lit), 'server lantern activation');
    await page.waitForFunction(({ id, part }) => { const r = window.__mn.client.pred.rafts.find((row) => row.id === id);
      return r?.litLanterns?.some((p) => JSON.stringify(p) === JSON.stringify(part)); }, { id: ship.id, part: tuple }, { timeout: 15000 });
    const lightKey = `${ship.id}|${JSON.stringify(tuple)}`;
    await page.waitForFunction((key) => window.__mn.world.lights.raftSources.has(key), lightKey, { timeout: 15000 });
    const initialLight = await page.evaluate(async (key) => {
      const light = window.__mn.world.lights.raftSources.get(key), { U } = await import('/src/render/toon.js');
      const count = U.mnLightCount.value;
      const uniform = Array.from({ length: count }, (_, i) => ({ p: U.mnLightPos.value[i].toArray(), c: U.mnLightCol.value[i].toArray() }))
        .find(({ p }) => Math.hypot(p[0] - light.x, p[2] - light.z) < 0.02);
      return { x: light.x, y: light.y, z: light.z, uniform, count };
    }, lightKey);
    check(initialLight.uniform && initialLight.uniform.c[0] > initialLight.uniform.c[2],
      `lit lantern did not reach a warm shader uniform: ${JSON.stringify(initialLight)}`);
    await screenshot('02-lit');
    await screenshot('03-lit-same-frame');
    result.stage = 'roof-cutaway-with-lit-lantern';
    await page.locator('.raft-build-launcher').click();
    await placePiece(['wall', 1, 0, 0, 1]);
    await placePiece(['roof', 1, 0, 0, 0]);
    await page.locator('.raft-editor .re-close').click();
    const underRoof = lanternPoint(publicRafts(world).find((row) => row.id === ship.id), tuple);
    world.ecs.x[player] = underRoof.x; world.ecs.y[player] = underRoof.y; world.ecs.z[player] = underRoof.z;
    world.ecs.vx[player] = world.ecs.vz[player] = 0; server.broadcastSnapshot();
    await page.waitForFunction((id) => window.__mn.client.pred.raftDeck.shelterAt(window.__mn.client.cur.x,
      window.__mn.client.cur.z, window.__mn.client.cur.y)?.id === id, ship.id, { timeout: 15000 });
    await page.waitForFunction((id) => {
      const view = window.__mn.world.rafts.views.get(id), roofs = view?.visual.children.filter((obj) => obj.userData.raftRoof) || [];
      return roofs.length > 0 && roofs.every((roof) => !roof.visible);
    }, ship.id, { timeout: 15000 });
    check(await page.evaluate((key) => window.__mn.world.lights.raftSources.has(key), lightKey),
      'lantern source disappeared while the player was under the roof');
    result.cutaway = { roofHiddenForInterior: true, lanternWarmSourcePresent: true, playerFixturePosition: underRoof };
    await screenshot('04-lit-interior-cutaway');
    result.stage = 'moving-and-rotating-source';
    world.ecs.x[source.entity] += 4; world.ecs.z[source.entity] -= 3; world.ecs.facing[source.entity] = 0.75;
    server.broadcastSnapshot();
    const expected = lanternPoint(publicRafts(world).find((row) => row.id === ship.id), tuple);
    world.ecs.x[player] = expected.x; world.ecs.y[player] = expected.y; world.ecs.z[player] = expected.z;
    world.ecs.vx[player] = world.ecs.vz[player] = 0; server.broadcastSnapshot();
    await page.waitForFunction(async ({ key, x, z }) => {
      const light = window.__mn.world.lights.raftSources.get(key); if (!light || Math.abs(light.x - x) >= 0.01 || Math.abs(light.z - z) >= 0.01) return false;
      const { U } = await import('/src/render/toon.js'), count = U.mnLightCount.value;
      return Array.from({ length: count }, (_, i) => U.mnLightPos.value[i])
        .some((p) => Math.hypot(p.x - x, p.z - z) < 0.02);
    }, { key: lightKey, x: expected.x, z: expected.z }, { timeout: 15000 });
    result.movedLight = { initial: initialLight, moved: expected, rotatedYaw: 0.75, uniformFollowed: true };
    await screenshot('05-moved-rotated');
    result.stage = 'switch-off';
    const offStart = result.lanternAcks.length; await clickContext();
    await waitUntil(() => result.lanternAcks.slice(offStart).some((ack) => ack.ok && !ack.lit), 'server lantern deactivation');
    await page.waitForFunction(({ key, id, part }) => {
      const raft = window.__mn.client.pred.rafts.find((row) => row.id === id);
      return !window.__mn.world.lights.raftSources.has(key) &&
        !raft?.litLanterns?.some((p) => JSON.stringify(p) === JSON.stringify(part));
    }, { key: lightKey, id: ship.id, part: tuple }, { timeout: 15000 });
    await screenshot('06-off-same-frame');
    result.stage = 'switch-on-before-damage';
    const secondOnStart = result.lanternAcks.length; await clickContext();
    await waitUntil(() => result.lanternAcks.slice(secondOnStart).some((ack) => ack.ok && ack.lit), 'server lantern reactivation before damage');
    await page.waitForFunction(({ key, id, part }) => {
      const raft = window.__mn.client.pred.rafts.find((row) => row.id === id);
      return window.__mn.world.lights.raftSources.has(key) &&
        raft?.litLanterns?.some((p) => JSON.stringify(p) === JSON.stringify(part));
    }, { key: lightKey, id: ship.id, part: tuple }, { timeout: 15000 });
    await screenshot('07-on-same-frame');
    result.stage = 'damage-and-repair';
    const damaged = applyPartDamage(source.condition, lamp.id, lamp.maxHp);
    source.condition = damaged.structure; persistRaftCondition(source); world.profileDirty.add(entity); server.broadcastSnapshot();
    await page.waitForFunction(({ id, key, part, stableId }) => {
      const raft = window.__mn.client.pred.rafts.find((row) => row.id === id);
      const hp = raft?.partHealth?.find((entry) => entry.id === stableId)?.hp;
      const live = raft?.parts?.some((p) => JSON.stringify(p) === JSON.stringify(part));
      return (hp === 0 || live === false) &&
        !raft?.litLanterns?.some((p) => JSON.stringify(p) === JSON.stringify(part)) &&
        !window.__mn.world.lights.raftSources.has(key);
    }, { id: ship.id, key: lightKey, part: tuple, stableId: lamp.id }, { timeout: 15000 });
    check(!source.condition.entries.find((entry) => entry.id === lamp.id)?.hp,
      'direct damage fixture did not destroy the lantern part');
    result.damageFixture = { hpBefore: lamp.hp, damage: lamp.maxHp, hpAfter: source.condition.entries.find((entry) => entry.id === lamp.id)?.hp || 0,
      destroyedTupleRemoved: true, litTupleRemoved: true, warmSourceRemoved: true };
    world.ecs.x[source.entity] = originalPose.x; world.ecs.y[source.entity] = originalPose.y;
    world.ecs.z[source.entity] = originalPose.z; world.ecs.facing[source.entity] = originalPose.yaw;
    const restoredRaftPose = publicRafts(world).find((row) => row.id === ship.id);
    relocate(world, server, player, restoredRaftPose, 1, 1);
    await page.locator('.raft-build-launcher').click();
    await page.locator('.raft-editor [data-mode="repair"]').click();
    await page.locator(`.raft-editor [data-repair-id="${lamp.id}"]`).click();
    const repairStart = result.editAcks.length;
    await page.locator('.raft-editor .re-action').click();
    await waitUntil(() => result.editAcks.slice(repairStart).some((ack) => ack.ok && ack.op === 'repair'), 'paid lantern repair');
    await waitUntil(() => source.condition.entries.find((entry) => entry.id === lamp.id)?.hp === lamp.maxHp, 'lantern restored at full condition');
    check(!ship.litLanterns?.includes(lamp.id), 'repaired lantern incorrectly relit without an explicit switch');
    result.damageRepair = { ...result.damageFixture, repairedHp: lamp.maxHp, remainsOff: true, paidUiRepair: true };
    await screenshot('08-repaired-off');
    await page.locator('.raft-editor .re-close').click();
    if (process.env.MN_QA_CHECK_DECK === '1') {
      result.stage = 'real-deck-context-v';
      // Strip the temporary roof test pieces so the open deck path stays traversable.
      const beforeDeckCheck = publicRafts(world).find((row) => row.id === ship.id);
      source.ship.grid.parts = source.ship.grid.parts.filter((part) => part[0] !== 'wall' && part[0] !== 'roof');
      source.condition = { ...source.condition, entries: source.condition.entries.filter((entry) => entry.part[0] !== 'wall' && entry.part[0] !== 'roof') };
      ship.rev += 1; persistRaftCondition(source); world.profileDirty.add(entity);
      // Placement materials were seeded in the disposable player pack; unload their unused remainder before boarding.
      profile.eco.pack.goods = {}; ship.hold.goods = {};
      server.sendProfile(clientRow[0], clientRow[1]);
      world.raftDeck.update(publicRafts(world)); server.broadcastSnapshot();
      const helm = publicRafts(world).find((row) => row.id === ship.id)?.helm;
      check(helm, 'deck-mode verification has no live helm anchor');
      relocate(world, server, player, publicRafts(world).find((row) => row.id === ship.id), helm.x, helm.z);
      await page.keyboard.press('f');
      await page.waitForFunction((id) => window.__mn.client.naval.active && window.__mn.client.naval.shipId === id,
        ship.id, { timeout: 15000 });
      await page.keyboard.press('e');
      await page.waitForFunction((id) => window.__mn.client.deck.active && window.__mn.client.deck.shipId === id,
        ship.id, { timeout: 15000 });
      const target = lanternPoint(publicRafts(world).find((row) => row.id === ship.id), tuple);
      const localTarget = { x: Math.cos(beforeDeckCheck.yaw) * (target.x - beforeDeckCheck.x) -
          Math.sin(beforeDeckCheck.yaw) * (target.z - beforeDeckCheck.z),
        z: Math.sin(beforeDeckCheck.yaw) * (target.x - beforeDeckCheck.x) +
          Math.cos(beforeDeckCheck.yaw) * (target.z - beforeDeckCheck.z) };
      let remaining = Infinity;
      for (let step = 0; step < 8; step++) {
        const state = await page.evaluate(() => window.__mn.client.deck.state);
        const dx = localTarget.x - state.x, dz = localTarget.z - state.z;
        remaining = Math.hypot(dx, dz);
        if (remaining <= 1.35) break;
        const keys = [];
        if (dx > 0.2) keys.push('d'); else if (dx < -0.2) keys.push('a');
        if (dz > 0.2) keys.push('w'); else if (dz < -0.2) keys.push('s');
        for (const key of keys) await page.keyboard.down(key);
        await page.waitForTimeout(350);
        for (const key of keys) await page.keyboard.up(key);
      }
      await page.waitForFunction(() => window.__mn.client.deck.active &&
        window.__mn.navigation.interaction()?.actions?.some((action) => action.lantern && action.key === 'V'), null,
      { timeout: 12000 });
      const deckAckStart = result.lanternAcks.length;
      await page.keyboard.press('v');
      await waitUntil(() => result.lanternAcks.slice(deckAckStart).some((ack) => ack.ok && ack.lit), 'V command while deck.active');
      check(await page.evaluate(() => window.__mn.client.deck.active), 'deck context ended before the V acknowledgement');
      result.deckModeV = { navalActive: true, deckActive: true, key: 'V', lanternAck: 'lit', deckWalkDistanceAtStop: remaining };
      await screenshot('09-real-deck-active-v');
    }
    result.viewportCheck = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      quality: window.__mn.quality.current, websocketReady: window.__mn.transport?.ws?.readyState === WebSocket.OPEN }));
    check(!result.viewportCheck.overflow, `lantern UI overflows viewport: ${JSON.stringify(result.viewportCheck)}`);
    check(result.viewportCheck.quality === spec.quality, `requested ${spec.quality} quality but active ${result.viewportCheck.quality}`);
    check(result.websockets.some((socket) => socket.url.includes('/ws')), 'browser did not connect to local GameHost WebSocket');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 &&
      result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser faults: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors, requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.assertions = { paidPlacement: true, startsOff: true, localizedPrompt: true, vOrTouchToggle: true,
      warmSourceOnOff: true, movingAndRotatedSource: true, litInteriorCutaway: true, destroyedSourceRemoved: true,
      paidRepairStaysOff: true, horizontalOverflow: false };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href, bodyText: document.body.innerText.slice(0, 1600),
      quality: window.__mn?.quality?.current, joined: window.__mn?.client?.joined,
      interaction: window.__mn?.navigation?.interaction()?.actions?.map((a) => ({ verb: a.verb, lantern: !!a.lantern })) || [],
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (diagnosticError) { result.browserState = { diagnosticError: String(diagnosticError) }; }
    try { result.final = { ship: ship ? { rev: ship.rev, parts: ship.grid.parts, litLanterns: ship.litLanterns || [] } : null,
      lanternAcks: result.lanternAcks, editAcks: result.editAcks, clients: server?.clients?.size, hostLogs: hostLogs.slice(-30) }; } catch {}
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close(); await host.close();
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, error: result.error?.split('\n')[0] }));
  }
}

try { for (const spec of specs) await run(spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

#!/usr/bin/env node
// RNV01 shelter acceptance through isolated GameHost, WebSocket, the real raft editor and door UI.
// Character relocation and starting materials are declared disposable QA fixtures; no physical-device
// performance or unaided door-crossing claim is made.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { GAME } from '../src/data/meta.js';
import { RAFT } from '../src/data/raftparts.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv01-naval-refuge');
await mkdir(out, { recursive: true });
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const threeRoot = resolve(repo, 'node_modules/three');
const gsapRoot = resolve(process.env.MN_GSAP || resolve(repo, '.scratch/gsap-local/package'));
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify the naval refuge visual slice through real raft-editor placement, server-owned door open/blocked-close/close, and roof cutaway/restore.',
  harness: 'Fresh ephemeral GameHost per viewport; browser WebSocket and DOM; in-memory profile store; local Three.js/GSAP/font routes. No production server, durable save, or device-performance claim.',
  fixture: 'QA seeds starting wood/iron/tarp into the disposable owner profile and relocates the owner through server ECS snapshots. Foundations, walls, door, roof, rejected support preview, and door open/close are exercised via the actual UI and server commands. The fixture supplies materials and coordinates; this is not free-economy proof and direct relocations do not prove unaided walking through a doorway.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
};
const runTag = evidence.generatedAt.replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'refuge-pc-1280x720', width: 1280, height: 720, touch: false },
  { name: 'refuge-touch-844x390', width: 844, height: 390, touch: true },
  { name: 'refuge-portrait-390x844', width: 390, height: 844, touch: true },
];
const selectedViewport = process.env.MN_QA_VIEWPORT;
if (selectedViewport) {
  const selected = specs.filter((spec) => spec.name.includes(selectedViewport));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${selectedViewport}`);
  specs.splice(0, specs.length, ...selected);
}

const browser = await chromium.launch({
  ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'],
});

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

async function waitHealthy(port, timeout = 30000) {
  const deadline = Date.now() + timeout; let last = { status: 0, body: '' };
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); last = { status: response.status, body: await response.text() }; if (response.status === 200) return last; }
    catch (error) { last = { status: 0, body: String(error) }; }
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
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
  return page.evaluate(() => window.__mn.client.youServer);
}

const serverFor = (host) => host.game.server;
const localToWorld = (raft, x, z) => {
  const c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
  return { x: raft.x + c * x + s * z, y: raft.y, z: raft.z - s * x + c * z };
};
function relocate(world, server, entity, raft, lx, lz) {
  const p = localToWorld(raft, lx, lz), ecs = world.ecs;
  ecs.x[entity] = p.x; ecs.y[entity] = p.y; ecs.z[entity] = p.z;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.atkStage[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0;
  server.broadcastSnapshot();
  return p;
}
async function waitUntil(predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(20); }
  throw new Error(`timed out waiting for ${label}`);
}

async function run(spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [], externalRequests: [], websockets: [], screenshots: [], editAcks: [], doorAcks: [], overflow: [] };
  evidence.viewports.push(result);
  const hostLogs = [];
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `qa-naval-refuge-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, entity, server, world, source, ship;
  const screenshot = async (label) => {
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 85 }); result.screenshots.push(file); return file;
  };
  try {
    const port = await host.listen(); await waitHealthy(port); server = serverFor(host); world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, port, result);
    const raft = publicRafts(world).find((candidate) => candidate.owner === entity);
    check(raft, 'joined profile has no owned raft');
    source = world.rafts.get(raft.id); ship = source?.ship;
    check(ship, 'owned raft has no server ship');
    const profile = world.profiles.get(entity);
    check(profile?.eco?.pack, 'owner profile has no material pack');
    // Explicit starting-material fixture only; all subsequent placements debit the real server inventory.
    profile.gold = Math.max(profile.gold || 0, 1000);
    profile.eco.pack.cap = Math.max(profile.eco.pack.cap || 0, 100);
    profile.eco.pack.goods = { madera: 40, hierro: 4, lona: 4 };
    const ownerClient = [...server.clients].find(([, client]) => client.entity === entity);
    check(ownerClient, 'owner WebSocket client was not registered');
    server.sendProfile(ownerClient[0], ownerClient[1]);
    const fixtureStart = relocate(world, server, entity, raft, 1, 1);
    result.fixture = { materials: { madera: 40, hierro: 4, lona: 4 }, playerStart: fixtureStart,
      raftId: raft.id, initialBlueprint: structuredClone(ship.grid.parts), directMovement: true };
    const originalEmit = world.emit.bind(world);
    world.emit = (event) => {
      if (event?.type === 'raftEdit') result.editAcks.push({ op: event.op, ok: event.ok, why: event.why || '', rev: event.rev });
      if (event?.type === 'raftDoor') result.doorAcks.push({ ok: event.ok, why: event.why || '', open: event.open });
      return originalEmit(event);
    };

    result.stage = 'editor-and-support-refusal';
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForFunction(() => window.__mn.client.pred.raftDeck.surface(window.__mn.client.cur.x, window.__mn.client.cur.z, window.__mn.client.cur.y)?.id, null, { timeout: 15000 });
    const launcher = page.locator('.raft-build-launcher'); await launcher.waitFor({ state: 'visible', timeout: 15000 });
    await launcher.click();
    await page.waitForFunction(() => window.__mn.panels.raftEditor.active, null, { timeout: 10000 });
    await page.locator('.raft-editor [data-part="roof"]').waitFor({ state: 'visible', timeout: 10000 });
    const setTarget = async (piece) => page.evaluate((p) => {
      const editor = window.__mn.panels.raftEditor;
      editor.selected = p[0]; editor.level = p[3]; editor.dir = p[4];
      editor.target = { x: p[1], z: p[2], level: p[3], dir: p[4] };
      editor.render();
    }, piece);
    const place = async (piece) => {
      const button = page.locator(`.raft-editor [data-part="${piece[0]}"]`);
      await button.click(); await setTarget(piece);
      const action = page.locator('.raft-editor .re-action');
      await waitUntil(async () => await action.isEnabled(), `valid ${piece[0]} placement`);
      const oldRev = ship.rev;
      await action.click();
      await waitUntil(() => ship.rev > oldRev && ship.grid.parts.some((p) => JSON.stringify(p) === JSON.stringify(piece)), `server ${piece[0]} placement`);
      await page.waitForFunction(() => !window.__mn.panels.raftEditor.pending, null, { timeout: 20000 });
      return { piece, previousRev: oldRev, rev: ship.rev, materialsRemaining: structuredClone(profile.eco.pack.goods) };
    };

    await page.locator('.raft-editor [data-part="roof"]').click();
    await setTarget(['roof', 1, 1, 0, 0]); // Deck exists, but there is no supporting wall yet.
    const unsupported = await page.evaluate(() => ({ disabled: document.querySelector('.raft-editor .re-action').disabled,
      status: document.querySelector('.raft-editor .re-status').textContent }));
    check(unsupported.disabled && /soporte/i.test(unsupported.status), `roof support refusal was not shown: ${JSON.stringify(unsupported)}`);
    result.supportRefusal = unsupported;
    await screenshot('01-editor-support-refusal');

    result.stage = 'foundation-extension-and-cabin-placement';
    const placements = [];
    // Two paid UI foundations add conservative displacement margin for the cabin and owner load.
    placements.push(await place(['foundation', 0, 2, 0, 0]));
    placements.push(await place(['foundation', 1, 2, 0, 0]));
    // Cabin occupies the new aft cell; its door opens onto the original deck, not water.
    placements.push(await place(['door', 0, 2, 0, 0]));
    placements.push(await place(['wall', 0, 2, 0, 1]));
    placements.push(await place(['wall', 0, 2, 0, 2]));
    placements.push(await place(['wall', 0, 2, 0, 3]));
    placements.push(await place(['roof', 0, 2, 0, 0]));
    result.placements = placements;
    check(result.editAcks.filter((ack) => ack.ok).length >= placements.length, 'not all real raft editor operations received server acceptance');
    check(ship.grid.parts.length >= result.fixture.initialBlueprint.length + placements.length, 'cabin blueprint did not persist all placed pieces');
    await setTarget(['roof', 0, 2, 0, 0]);
    await screenshot('02-editor-cabin-built');
    await page.locator('.raft-editor .re-close').click();

    const localDoor = ['door', 0, 2, 0, 0];
    const waitClientDoor = async (open) => page.waitForFunction(({ id, open }) => {
      const raft = window.__mn.client.pred.rafts.find((r) => r.id === id);
      return !!raft && (raft.openDoors || []).some((p) => JSON.stringify(p) === JSON.stringify(['door', 0, 2, 0, 0])) === open;
    }, { id: raft.id, open }, { timeout: 20000 });
    const doorWorld = (lx, lz) => relocate(world, server, entity, publicRafts(world).find((r) => r.id === raft.id), lx, lz);
    const doorAction = async (verb) => {
      await page.waitForFunction((expected) => window.__mn.navigation.interaction()?.actions?.some((a) => a.door && a.verb === expected), verb, { timeout: 15000 });
      result.doorPrompts.push({ verb, actions: await page.evaluate(() => window.__mn.navigation.interaction()?.actions?.filter((a) => a.door).map((a) => ({ verb: a.verb, key: a.key })) || []) });
      const run = page.locator('.live-navigation [data-run]');
      await run.waitFor({ state: 'visible' });
      check(await run.textContent() === verb, 'nearby door action is not discoverable in the visible context prompt');
      if (spec.touch) await run.tap();
      else await page.keyboard.press('v');
    };
    result.doorPrompts = [];

    result.stage = 'exterior-and-open-door';
    doorWorld(1, 3.4);
    await screenshot('03-cabin-exterior');
    const openAckStart = result.doorAcks.length;
    await doorAction('Open door');
    await waitUntil(() => result.doorAcks.slice(openAckStart).some((ack) => ack.ok && ack.open === true), 'server accepted door opening');
    await waitClientDoor(true);
    result.openDoor = { publicTuple: localDoor, ack: result.doorAcks.slice(openAckStart).at(-1), blueprintRev: ship.rev };
    await screenshot('04-cabin-door-open');

    result.stage = 'blocked-close';
    const blockedCloseStart = result.doorAcks.length;
    const threshold = doorWorld(1, 4);
    await doorAction('Close door');
    await waitUntil(() => result.doorAcks.slice(blockedCloseStart).some((ack) => !ack.ok), 'server rejected occupied doorway close');
    const blockedAck = result.doorAcks.slice(blockedCloseStart).at(-1);
    check(blockedAck.why === 'occupied', `blocked close had unexpected result: ${JSON.stringify(blockedAck)}`);
    await waitClientDoor(true);
    result.blockedClose = { playerAtThreshold: threshold, ack: blockedAck, remainsOpen: true };
    const aside = doorWorld(1, 2.55);
    const closeAckStart = result.doorAcks.length;
    await doorAction('Close door');
    await waitUntil(() => result.doorAcks.slice(closeAckStart).some((ack) => ack.ok && ack.open === false), 'server accepted close after moving clear');
    await waitClientDoor(false);
    result.clearClose = { playerMovedAside: aside, ack: result.doorAcks.slice(closeAckStart).at(-1), remainsClosed: true };

    result.stage = 'interior-cutaway-and-roof-restore';
    doorWorld(1, 3.4);
    const reopenStart = result.doorAcks.length;
    await doorAction('Open door');
    await waitUntil(() => result.doorAcks.slice(reopenStart).some((ack) => ack.ok && ack.open === true), 'server accepted second opening');
    await waitClientDoor(true);
    const interiorPoint = doorWorld(1, 5);
    await page.waitForFunction((id) => {
      const c = window.__mn.client, p = c.cur;
      return c.pred.raftDeck.shelterAt(p.x, p.z, p.y)?.id === id;
    }, raft.id, { timeout: 15000 });
    await page.waitForFunction((id) => {
      const view = window.__mn.world.rafts.views.get(id);
      const roofs = view?.visual.children.filter((object) => object.userData.raftRoof) || [];
      return roofs.length > 0 && roofs.every((roof) => !roof.visible);
    }, raft.id, { timeout: 15000 });
    result.interior = { playerFixturePosition: interiorPoint, shelterId: raft.id, roofHidden: true, unaidedWalkClaim: false };
    await screenshot('05-cabin-interior-cutaway');
    const exit = doorWorld(3, 5);
    await page.waitForFunction(() => {
      const c = window.__mn.client, p = c.cur;
      return !c.pred.raftDeck.shelterAt(p.x, p.z, p.y);
    }, null, { timeout: 15000 });
    await page.waitForFunction((id) => {
      const view = window.__mn.world.rafts.views.get(id);
      const roofs = view?.visual.children.filter((object) => object.userData.raftRoof) || [];
      return roofs.length > 0 && roofs.every((roof) => roof.visible);
    }, raft.id, { timeout: 15000 });
    result.roofRestore = { playerFixturePosition: exit, roofVisible: true };
    await screenshot('06-cabin-exterior-roof-restored');

    result.viewportCheck = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      editorVisible: !document.querySelector('.raft-editor')?.hidden,
      websocketReady: window.__mn.transport?.ws?.readyState === WebSocket.OPEN,
      gameMode: window.__mn.st.mode }));
    result.overflow.push(result.viewportCheck);
    check(!result.viewportCheck.overflow, `refuge UI overflows viewport: ${JSON.stringify(result.viewportCheck)}`);
    check(result.websockets.some((socket) => socket.url.includes('/ws')), 'browser did not connect to the local GameHost WebSocket');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0
      && result.httpFailures.length === 0 && result.externalRequests.length === 0,
    `browser faults: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors, requestFailures: result.requestFailures,
      httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.assertions = { supportRefusal: true, realEditorPlacement: true, visibleDoorPrompt: true,
      doorInput: spec.touch ? 'context-button-tap' : 'keyboard-V', blockedClose: true,
      closeAfterMovingClear: true, roofCutaway: true, roofRestore: true, horizontalOverflow: false };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href, title: document.title,
      bodyText: document.body.innerText.slice(0, 1600), gameMode: window.__mn?.st?.mode,
      joined: window.__mn?.client?.joined, editor: window.__mn?.panels?.raftEditor?.active,
      interaction: window.__mn?.navigation?.interaction()?.actions?.map((a) => ({ verb: a.verb, door: !!a.door })) || [],
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); }
    catch (diagnosticError) { result.browserState = { diagnosticError: String(diagnosticError) }; }
    try { result.final = { ship: ship ? { rev: ship.rev, parts: ship.grid.parts, openDoors: ship.openDoors || [] } : null,
      doorAcks: result.doorAcks, editAcks: result.editAcks, clients: server?.clients?.size, hostLogs: hostLogs.slice(-30) }; }
    catch { result.final = { hostLogs: hostLogs.slice(-30) }; }
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

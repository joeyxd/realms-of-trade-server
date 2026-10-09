#!/usr/bin/env node
// D08c.12 acceptance on the real GameHost/WebSocket/UI; route movement is a declared trusted QA fixture.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';
import { GAME } from '../src/data/meta.js';

const out = resolve('docs/delivery/d08c12-naval-route');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify the optional route through the live GameHost snapshot and UI: start at berth, cross three ordered buoys, read a real telegraphed corsair salvo and its hit-or-dodge result, return, and dock through the normal command.',
  harness: 'Fresh isolated ephemeral GameHost per viewport, real browser WebSocket and game UI, in-memory store, local Three.js/GSAP/font routes, Chrome WebGL renderer; no .env, SQL, external hosts, device or FPS claim.',
  fixture: 'After helm mount and routeStart through the UI, QA wraps only world.navalRoute.plan for the owner and rebuilds each real candidate trial body at server-issued route points. This trusted relocation makes buoy and cannon acceptance deterministic; route snapshots, timing, shots, damage, ship HP, route commands, and dock completion remain server-owned. It does not claim unaided sailing/contact skill or physical-device performance.',
  expected: { buoys: 3, routeStatus: 'complete', completionCommand: 'normal navalPilot dock command', maximumDamagePerRun: 24, lootOrXp: false },
  protocolVersion: PROTOCOL_VERSION,
  performanceClaim: false,
  viewports: [], failures: [],
};
const runTag = evidence.generatedAt.replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'naval-route-desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'naval-route-touch-844x390', width: 844, height: 390, touch: true },
  { name: 'naval-route-portrait-390x844', width: 390, height: 844, touch: true },
];
const selectedViewport = process.env.MN_QA_VIEWPORT;
if (selectedViewport) {
  const selected = specs.filter((spec) => spec.name.includes(selectedViewport));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${selectedViewport}`);
  specs.splice(0, specs.length, ...selected);
}
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const serverFor = (host) => host.game.server;

async function installLocalRoutes(page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}

async function waitHealthy(port, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last = { status: 0, body: '' };
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      last = { status: response.status, body: await response.text() };
      if (response.status === 200) return last;
    } catch (error) { last = { status: 0, body: String(error) }; }
    await pause(100);
  }
  throw new Error(`GameHost did not become healthy: ${JSON.stringify(last)}`);
}

async function openApp(page, port, result) {
  page.on('pageerror', (e) => result.errors.push(String(e?.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => result.requestFailures.push({ url: r.url(), error: r.failure()?.errorText || '' }));
  page.on('response', (r) => { if (r.status() >= 400) result.httpFailures.push({ url: r.url(), status: r.status() }); });
  await installLocalRoutes(page);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').waitFor({ state: 'visible', timeout: 10000 });
  const play = await page.locator('#btn-play').boundingBox();
  check(play, 'JUGAR button has no visible click target');
  await page.mouse.click(play.x + play.width / 2, play.y + play.height / 2);
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
  return page.evaluate(() => window.__mn.client.youServer);
}

async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [], screenshots: [] };
  evidence.viewports.push(result);
  const screenshot = async (label) => {
    const file = `${spec.name}-${runTag}-${label}.png`;
    await page.screenshot({ path: resolve(out, file) }); result.screenshots.push(file); return file;
  };
  const hostLogs = [];
  const createHost = () => createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `qa-naval-route-${spec.name}`, chat: { enabled: false }, log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let host = createHost(), context, page, entity, server, world, fixturePose = null, wrapperInstalled = false;
  try {
    result.stage = 'host-start';
    const port = await host.listen(); await waitHealthy(port); server = serverFor(host); world = server.world;
    result.stage = 'browser-join';
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, port, result);
    result.stage = 'helm-fixture';
    const raft = publicRafts(world).find((candidate) => candidate.owner === entity);
    check(raft?.helm, 'joined profile has no owned helm');
    const helm = pilotPoint(raft, raft.helm), ecs = world.ecs;
    ecs.x[entity] = helm.x; ecs.y[entity] = helm.y; ecs.z[entity] = helm.z; ecs.facing[entity] = helm.f;
    ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
    world.raftDeck.update(publicRafts(world)); server.broadcastSnapshot();
    result.stage = 'mount';
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.verb === 'Pilotar', null, { timeout: 15000 });
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.locator('.ln-prompt [data-run]').click();
    await page.waitForFunction(() => window.__mn.client.naval.active, null, { timeout: 20000 });
    result.stage = 'route-available';
    await page.waitForFunction(() => window.__mn.client.route?.available && window.__mn.client.route?.canStart, null, { timeout: 15000 });
    const before = world.navalPilot.snapshot(entity), routeBefore = world.navalRoute.snapshot(entity);
    check(before.active && before.shipId === raft.id && routeBefore.available && routeBefore.canStart, 'server did not expose an eligible owner helm and route');
    result.fixture = { shipId: raft.id, home: routeBefore.home, routeLayout: { buoys: routeBefore.buoys, threat: routeBefore.threat },
      movement: 'Navigation input and authoritative body movement remain active until each owner-authorized fixture relocation is applied on the server tick.' };

    const originalPlan = world.navalRoute.plan.bind(world.navalRoute);
    world.navalRoute.plan = (owner, shipId, body) => {
      if (owner === entity && fixturePose) {
        const pose = { x: fixturePose.x, y: body.pose.y, z: fixturePose.z, yaw: body.pose.yaw };
        body = createTrialBody(body.structure.entries.map((entry) => entry.part), pose, `qa-route:${result.screenshots.length + 1}`,
          body.state.tick, { navigation: true, structure: body.structure, cargo: body.cargo, flowOrigin: body.flowOrigin,
            wind: body.wind, activity: body.activity });
      }
      return originalPlan(owner, shipId, body);
    };
    wrapperInstalled = true;

    result.stage = 'start';
    const action = page.locator('.ln-route-trial [data-route-action]');
    await page.waitForFunction(() => !document.querySelector('.ln-route-trial')?.hidden && !document.querySelector('.ln-route-trial [data-route-action]')?.disabled, null, { timeout: 15000 });
    if (spec.touch) await action.tap(); else await action.click();
    const waitRoute = async (predicate, label, timeout = 45000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { const snap = world.navalRoute.snapshot(entity); if (predicate(snap)) return snap; await pause(40); }
      throw new Error(`timed out waiting for ${label}: ${JSON.stringify(world.navalRoute.snapshot(entity))}`);
    };
    let route = await waitRoute((snap) => snap.status === 'outbound', 'route start acceptance');
    check(route.runId && route.next === 0 && route.shipId === raft.id, 'start did not create the owner run at buoy one');
    result.start = { runId: route.runId, status: route.status, next: route.next, commandPath: 'button click/tap → actual client navalPilot routeStart with epoch' };
    fixturePose = route.buoys[0];
    route = await waitRoute((snap) => snap.next === 1, 'ordered first buoy');
    check(route.status === 'outbound', 'route changed state before first buoy');
    await page.waitForFunction((label) => document.querySelector('[data-target]')?.textContent === label,
      route.buoys[1].label, { timeout: 15000 });
    result.buoys = [{ index: 1, id: route.buoys[0].id, next: route.next, status: route.status }];
    await screenshot('01-buoy-one');

    result.stage = 'salvo'; fixturePose = route.buoys[1];
    route = await waitRoute((snap) => snap.next === 2, 'ordered second buoy');
    const threatDistance = Math.hypot(route.threat.x - route.buoys[1].x, route.threat.z - route.buoys[1].z);
    check(threatDistance <= 58, `second buoy is outside real cannon range: ${threatDistance}`);
    await page.waitForFunction((label) => document.querySelector('[data-target]')?.textContent === label,
      route.buoys[2].label, { timeout: 15000 });
    result.buoys.push({ index: 2, id: route.buoys[1].id, next: route.next, status: route.status });
    route = await waitRoute((snap) => snap.shots.length > 0, 'server telegraphed cannon salvo', 45000);
    const shot = route.shots[0];
    check(shot.impactTick > route.tick && shot.from && Number.isFinite(shot.x) && Number.isFinite(shot.z), 'shot lacks a real warning window or origin');
    result.salvo = { shotId: shot.id, launchedAt: route.tick, impactTick: shot.impactTick, warningTicks: shot.impactTick - route.tick,
      from: shot.from, mark: { x: shot.x, z: shot.z }, radius: shot.radius, status: route.status };
    await screenshot('02-telegraphed-salvo');
    route = await waitRoute((snap) => snap.hits + snap.dodged > 0, 'actual salvo impact or dodge', 20000);
    check(route.damage <= 24, `route exceeded the declared 24 HP cap: ${route.damage}`);
    result.resolution = { hits: route.hits, dodged: route.dodged, damage: route.damage,
      ownerHull: world.navalPilot.snapshot(entity)?.body?.structure?.hull || null };
    await screenshot('03-salvo-resolution');

    result.stage = 'return'; fixturePose = route.buoys[2];
    route = await waitRoute((snap) => snap.next === 3 && snap.status === 'returning', 'third ordered buoy and return leg');
    result.buoys.push({ index: 3, id: route.buoys[2].id, next: route.next, status: route.status });
    await page.waitForFunction((label) => document.querySelector('[data-target]')?.textContent === label,
      route.target.label, { timeout: 15000 });
    await screenshot('04-returning');
    fixturePose = route.home;
    await page.waitForFunction(() => window.__mn.client.voyage?.canDock, null, { timeout: 20000 });
    const dockButton = page.locator('.ln-prompt [data-run]');
    check(await dockButton.textContent() === 'Amarrar', `normal dock action is not exposed: ${await dockButton.textContent()}`);
    if (spec.touch) await dockButton.tap(); else await dockButton.click();
    route = await waitRoute((snap) => snap.status === 'complete' && !snap.active, 'normal dock completion');
    result.completion = { status: route.status, reason: route.reason, hits: route.hits, dodged: route.dodged, damage: route.damage,
      voyage: world.navalPilot.voyageSnapshot(entity), dockAction: 'real prompt click/tap: Amarrar' };
    await page.waitForTimeout(250);
    await screenshot('05-complete');
    const ui = await page.evaluate(() => ({ visible: !document.querySelector('.ln-route-trial')?.hidden,
      title: document.querySelector('[data-route-title]')?.textContent, score: document.querySelector('[data-route-score]')?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth }));
    result.completion.ui = ui;
    check(ui.visible && /Ensayo completado/.test(ui.title) && /impactos?/.test(ui.score), `completed outcome/score is not visible in UI: ${JSON.stringify(ui)}`);
    check(!ui.overflow, 'route HUD overflows the viewport');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 && result.httpFailures.length === 0,
      `browser faults: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors, requestFailures: result.requestFailures, httpFailures: result.httpFailures })}`);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error); evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => {
      const app = window.__mn, transport = app?.transport, client = app?.client;
      return { url: location.href, title: document.title, bodyText: document.body.innerText.slice(0, 1200),
        gameMode: app?.st?.mode, online: app?.st?.online, playDisabled: document.querySelector('#btn-play')?.disabled,
        boarding: document.querySelector('#btn-play')?.textContent,
        client: client ? { joined: client.joined, awaitingFirst: client.awaitingFirst, youLocal: client.youLocal,
          closed: client.t?.closed, transportKind: client.t?.kind, sent: client.t?.stats?.sent, recv: client.t?.stats?.recv } : null,
        transport: transport ? { kind: transport.kind, closed: transport.closed, sent: transport.stats?.sent, recv: transport.stats?.recv } : null,
        appErrors: app?.errors?.slice?.(-10) || [] };
    }); } catch (diagnosticError) { result.browserState = { diagnosticError: String(diagnosticError) }; }
    try { result.final = { route: entity != null ? world.navalRoute.snapshot(entity) : null,
      naval: entity != null ? world.navalPilot.snapshot(entity) : null, voyage: entity != null ? world.navalPilot.voyageSnapshot(entity) : null,
      clients: server ? server.clients.size : null, hostLogs: hostLogs.slice(-30) }; } catch { result.final = { hostLogs: hostLogs.slice(-30) }; }
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    if (wrapperInstalled) { /* The wrapper belongs to this disposable host and is discarded at close. */ }
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close(); await host.close();
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage || 'complete', error: result.error?.split('\n')[0] }));
  }
}

try { for (const spec of specs) await run(spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

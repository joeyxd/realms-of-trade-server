#!/usr/bin/env node
// PRG02a acceptance on the isolated GameHost/WebSocket/UI. Objective movement is a declared QA fixture.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';
import { NAVAL_LESSON } from '../src/data/navalLesson.js';
import { GAME } from '../src/data/meta.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, 'docs/delivery/prg02a-naval-lesson');
await mkdir(out, { recursive: true });
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const gsapRoot = resolve(process.env.MN_GSAP || resolve(repo, '.scratch/gsap-local/package'));
const threeRoot = resolve(repo, 'node_modules/three');
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify the voluntary PRG02a coastal lesson through the isolated GameHost snapshot and UI: start, follow ordered buoys, hold the second maneuver, return, and dock through the normal prompt; cancel and retry once.',
  harness: 'Fresh ephemeral GameHost per viewport, real browser WebSocket and DOM/UI, in-memory profile store, local Three.js/GSAP/font routes. No .env, database, external host, production service, or device-performance claim.',
  fixture: 'After the owner mounts the real server-created raft through the UI, QA wraps only world.navalRoute.plan to relocate that owner’s fixed-tick candidate body to server-issued lesson waypoints. NavalLesson start/plan/commit, snapshots, lesson progress, cancel/retry, cargo, hull condition, and completion through the real pilot.dock command remain live server behavior. This does not verify unaided sailing or physical-device performance.',
  expected: { orderedBuoys: 2, maneuverStableTicks: NAVAL_LESSON.stableTicks, completedBy: 'actual navalPilot dock command', cancelAndRetry: true, noPracticeSalvos: true, persistentProgressionCredit: false },
  protocolVersion: PROTOCOL_VERSION,
  viewports: [],
  failures: [],
};
const runTag = evidence.generatedAt.replace(/[:.]/g, '-');
const evidenceFile = resolve(out, `evidence-${runTag}.json`);
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'naval-lesson-desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'naval-lesson-touch-844x390', width: 844, height: 390, touch: true },
  { name: 'naval-lesson-portrait-390x844', width: 390, height: 844, touch: true },
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
const serverFor = (host) => host.game.server;

async function installLocalRoutes(page, result) {
  // Permit only this ephemeral host. The specific library/font routes below fulfill locally.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    result.externalRequests.push(url.href);
    return route.abort();
  });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
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
  page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', (response) => { if (response.status() >= 400) result.httpFailures.push({ url: response.url(), status: response.status() }); });
  await installLocalRoutes(page, result);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  const play = page.locator('#btn-play');
  await play.waitFor({ state: 'visible', timeout: 10000 });
  const target = await play.boundingBox();
  check(target?.width > 0 && target?.height > 0, 'JUGAR button has no visible click target');
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
  return page.evaluate(() => window.__mn.client.youServer);
}

async function run(spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [], httpFailures: [],
    externalRequests: [], screenshots: [] };
  evidence.viewports.push(result);
  const hostLogs = [];
  const createHost = () => createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0,
    maxPlayers: 1, dev: true, store: createMemoryStore(), worldId: null,
    saveSecret: `qa-naval-lesson-${spec.name}`, chat: { enabled: false },
    log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let host = createHost(), context, page, entity, server, world, fixturePose = null, fixtureInstalled = false;
  const screenshot = async (label) => {
    const file = `${spec.name}-${runTag}-${label}.png`;
    await page.screenshot({ path: resolve(out, file) }); result.screenshots.push(file); return file;
  };
  try {
    const port = await host.listen(); await waitHealthy(port); server = serverFor(host); world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage();
    entity = await openApp(page, port, result);
    result.stage = 'helm-fixture';
    const raft = publicRafts(world).find((candidate) => candidate.owner === entity);
    check(raft?.helm, 'joined profile has no owned helm');
    const source = world.rafts.get(raft.id), ship = source?.ship;
    check(ship, 'server-created owner raft has no source ship');
    const helm = pilotPoint(raft, raft.helm), ecs = world.ecs;
    ecs.x[entity] = helm.x; ecs.y[entity] = helm.y; ecs.z[entity] = helm.z; ecs.facing[entity] = helm.f;
    ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
    world.raftDeck.update(publicRafts(world)); server.broadcastSnapshot();
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.verb === 'Pilotar', null, { timeout: 15000 });
    const helmPrompt = page.locator('.ln-prompt [data-run]');
    check((await helmPrompt.textContent())?.trim(), 'helm action has an empty click target');
    if (spec.touch) await helmPrompt.tap(); else await helmPrompt.click();
    await page.waitForFunction(() => window.__mn.client.naval.active, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__mn.client.lesson?.available && window.__mn.client.lesson?.canStart, null, { timeout: 15000 });

    result.stage = 'candidate-fixture';
    const originalPlan = world.navalRoute.plan.bind(world.navalRoute);
    const originalCommit = world.navalRoute.commit.bind(world.navalRoute);
    world.navalRoute.plan = (owner, shipId, body) => {
      if (owner !== entity || !fixturePose) return originalPlan(owner, shipId, body);
      const pose = { x: fixturePose.x, y: body.pose.y, z: fixturePose.z, yaw: body.pose.yaw };
      const relocated = createTrialBody(ship.grid.parts, pose, `qa-lesson:${spec.name}`, body.state.tick,
        { navigation: true, structure: body.structure, cargo: body.cargo, flowOrigin: body.flowOrigin,
          wind: body.wind, activity: body.activity });
      return { qaFixture: true, body: relocated, state: { owner } };
    };
    world.navalRoute.commit = (plan) => plan?.qaFixture ? true : originalCommit(plan);
    fixtureInstalled = true;

    result.baseline = {
      xp: Number(ecs.xp[entity]) || 0,
      pack: JSON.stringify(world.profiles.get(entity)?.eco?.pack || null),
      raftGoods: JSON.stringify(ship.hold.goods),
      blueprint: JSON.stringify(ship.grid),
    };

    result.stage = 'ready-and-mode-switch';
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    const switchButton = page.locator('[data-route-switch]');
    await page.waitForFunction(() => document.querySelector('.ln-route-trial')?.dataset.activity === 'lesson'
      && !document.querySelector('.ln-route-trial')?.hidden, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-route-title]')?.textContent === 'Coastal lesson',
      null, { timeout: 10000 });
    result.readyLayout = await page.evaluate(() => {
      const card = document.querySelector('.ln-route-trial').getBoundingClientRect();
      const hud = document.querySelector('.hud-player').getBoundingClientRect();
      return { card: card.toJSON(), playerHud: hud.toJSON(), overlapPlayerHud:
        Math.min(card.right, hud.right) > Math.max(card.left, hud.left) &&
        Math.min(card.bottom, hud.bottom) > Math.max(card.top, hud.top) };
    });
    check(!result.readyLayout.overlapPlayerHud, 'lesson card overlaps player HP');
    check((await page.locator('[data-route-action]').textContent())?.trim(), 'ready lesson action has no click target');
    await screenshot('01-ready');
    check(await switchButton.isVisible(), 'trial switch is missing from the ready lesson');
    if (spec.touch) await switchButton.tap(); else await switchButton.click();
    await page.waitForFunction(() => document.querySelector('.ln-route-trial')?.dataset.activity === 'trial', null, { timeout: 10000 });
    result.modeSwitch = { lessonToTrial: true, trialToLesson: false };
    check(await switchButton.isVisible(), 'lesson switch is missing from the ready combat trial');
    if (spec.touch) await switchButton.tap(); else await switchButton.click();
    await page.waitForFunction(() => document.querySelector('.ln-route-trial')?.dataset.activity === 'lesson', null, { timeout: 10000 });
    result.modeSwitch.trialToLesson = true;

    const waitLesson = async (predicate, label, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const snapshot = world.navalLesson.snapshot(entity);
        if (predicate(snapshot)) return snapshot;
        await pause(12);
      }
      throw new Error(`timed out waiting for ${label}: ${JSON.stringify(world.navalLesson.snapshot(entity))}`);
    };
    const lessonAction = page.locator('[data-route-action]');
    const clickLessonAction = async () => {
      check(await lessonAction.isVisible(), 'lesson action button is hidden');
      const target = await lessonAction.boundingBox();
      check(target?.width > 0 && target?.height > 0, 'lesson action has no click target');
      if (spec.touch) await lessonAction.tap(); else await lessonAction.click();
    };
    const assertNoLessonCombat = async () => {
      const state = await page.evaluate(() => ({ enemyVisible: !!window.__mn.navigation.routeRenderer.enemy.visible,
        visibleSalvos: window.__mn.navigation.routeRenderer.balls.filter((ball) => ball.visible).length }));
      check(!state.enemyVisible && state.visibleSalvos === 0, `lesson rendered combat threat/salvos: ${JSON.stringify(state)}`);
      return state;
    };
    // Both input modes share the reference instrument; the legacy top-strip dial is hidden.
    const speedTarget = page.locator('.naval-touch-gauge');
    const assertSpeedControl = async () => {
      const target = await speedTarget.boundingBox();
      check(target?.width > 0 && target?.height > 0, 'speedometer control disappeared');
    };

    result.stage = 'cancel-and-retry';
    await clickLessonAction();
    let lesson = await waitLesson((snapshot) => snapshot.status === 'outbound' && snapshot.active, 'lesson start');
    const firstRunId = lesson.runId;
    await screenshot('02-first-outbound');
    await assertNoLessonCombat();
    await clickLessonAction();
    lesson = await waitLesson((snapshot) => snapshot.status === 'aborted' && !snapshot.active, 'lesson cancel');
    check(lesson.reason === 'cancelled', `cancel ended for an unexpected reason: ${lesson.reason}`);
    await screenshot('03-cancelled');
    await clickLessonAction();
    lesson = await waitLesson((snapshot) => snapshot.status === 'outbound' && snapshot.active && snapshot.runId !== firstRunId, 'fresh retry');
    result.retry = { previousRunId: firstRunId, currentRunId: lesson.runId, status: lesson.status, next: lesson.next };

    result.stage = 'ordered-buoys-and-maneuver';
    const [departure, maneuver] = lesson.buoys;
    fixturePose = departure;
    lesson = await waitLesson((snapshot) => snapshot.status === 'maneuver' && snapshot.next === 1, 'first ordered buoy');
    check(lesson.target?.id === maneuver.id, 'first buoy did not route guidance to the maneuver buoy');
    await page.waitForFunction((id) => document.querySelector('[data-target]')?.textContent === id,
      'Maneuver buoy', { timeout: 12000 });
    await screenshot('04-first-buoy-maneuver-available');
    await assertNoLessonCombat();
    fixturePose = maneuver;
    lesson = await waitLesson((snapshot) => snapshot.status === 'maneuver' && snapshot.target?.id === maneuver.id,
      'second buoy maneuver state');
    await page.waitForFunction(() => {
      const progress = document.querySelector('[data-lesson-progress]');
      return progress && !progress.hidden;
    }, null, { timeout: 10000 });
    lesson = await waitLesson((snapshot) => snapshot.status === 'maneuver' && snapshot.stableTicks >= 5,
      'visible nonzero maneuver progress');
    await page.waitForFunction(() => Number(document.querySelector('[data-lesson-progress]')?.value) > 0,
      null, { timeout: 10000 });
    await assertSpeedControl();
    const progressEvidence = await page.evaluate(() => ({ status: document.querySelector('[data-route-title]')?.textContent,
      detail: document.querySelector('[data-route-score]')?.textContent,
      visible: !document.querySelector('[data-lesson-progress]')?.hidden,
      value: Number(document.querySelector('[data-lesson-progress]')?.value),
      max: Number(document.querySelector('[data-lesson-progress]')?.max) }));
    check(progressEvidence.visible && progressEvidence.value >= 0 && progressEvidence.max === 1,
      `maneuver progress meter is not visible: ${JSON.stringify(progressEvidence)}`);
    result.maneuver = { stableTicks: lesson.stableTicks, requiredStableTicks: lesson.requiredStableTicks, progress: progressEvidence };
    // Freeze only the disposable host clock after the nonzero snapshot reaches the browser, so the
    // screenshot captures a real intermediate progress value instead of missing the short window.
    server.tickBlocked = true;
    await screenshot('05-maneuver-progress');
    server.tickBlocked = false;

    lesson = await waitLesson((snapshot) => snapshot.status === 'returning' && snapshot.next === 2, 'stable maneuver completion', 30000);
    result.stage = 'returning';
    await page.waitForFunction(() => document.querySelector('[data-route-title]')?.textContent === 'Return to harbor', null, { timeout: 10000 });
    await screenshot('06-returning');
    fixturePose = lesson.home;
    await page.waitForFunction(() => window.__mn.client.voyage?.canDock, null, { timeout: 20000 });
    const dockButton = page.locator('.ln-prompt [data-run]');
    await dockButton.waitFor({ state: 'visible', timeout: 10000 });
    const dockVerb = (await dockButton.textContent())?.trim();
    const dockTarget = await dockButton.boundingBox();
    check(dockVerb && dockTarget?.width > 0 && dockTarget?.height > 0, 'normal harbor dock action has no visible click target');
    result.dockPrompt = { text: dockVerb, target: dockTarget, source: 'normal live-navigation interaction prompt' };
    if (spec.touch) await dockButton.tap(); else await dockButton.click();
    lesson = await waitLesson((snapshot) => snapshot.status === 'complete' && !snapshot.active, 'real dock completion');
    check(lesson.reason === 'dock', `completion did not come from the real dock path: ${lesson.reason}`);
    result.completion = { status: lesson.status, reason: lesson.reason,
      dockedPilotActive: world.navalPilot.snapshot(entity).active, prompt: dockVerb };
    await page.waitForFunction(() => document.querySelector('[data-route-title]')?.textContent === 'Lesson complete',
      null, { timeout: 10000 });
    await screenshot('07-complete');

    const after = {
      xp: Number(ecs.xp[entity]) || 0,
      pack: JSON.stringify(world.profiles.get(entity)?.eco?.pack || null),
      raftGoods: JSON.stringify(ship.hold.goods),
      blueprint: JSON.stringify(ship.grid),
    };
    result.after = after;
    check(JSON.stringify(after) === JSON.stringify(result.baseline), 'lesson changed player XP, carried materials, raft goods, or blueprint');
    result.noCombat = await assertNoLessonCombat();
    result.viewportCheck = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      speedLabel: document.querySelector('.naval-touch-gauge') ? 'reference-gauge-present' : null,
      lessonActivity: document.querySelector('.ln-route-trial')?.dataset.activity,
      htmlLanguage: document.documentElement.lang }));
    check(!result.viewportCheck.overflow, `navigation UI overflows viewport: ${JSON.stringify(result.viewportCheck)}`);
    check(result.viewportCheck.lessonActivity === 'lesson' && result.viewportCheck.htmlLanguage === 'en',
      `English lesson presentation was not retained through completion: ${JSON.stringify(result.viewportCheck)}`);
    check(result.modeSwitch.lessonToTrial && result.modeSwitch.trialToLesson, 'activity mode switch did not work in both directions');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0
      && result.httpFailures.length === 0 && result.externalRequests.length === 0,
    `browser faults: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors,
      requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href, title: document.title,
      bodyText: document.body.innerText.slice(0, 1200), gameMode: window.__mn?.st?.mode,
      lesson: window.__mn?.client?.lesson, route: window.__mn?.client?.route,
      voyage: window.__mn?.client?.voyage, appErrors: window.__mn?.errors?.slice?.(-10) || [] })); }
    catch (diagnosticError) { result.browserState = { diagnosticError: String(diagnosticError) }; }
    try {
      result.final = { lesson: entity != null ? world.navalLesson.snapshot(entity) : null,
        naval: entity != null ? world.navalPilot.snapshot(entity) : null,
        voyage: entity != null ? world.navalPilot.voyageSnapshot(entity) : null,
        clients: server ? server.clients.size : null, hostLogs: hostLogs.slice(-30) };
    } catch { result.final = { hostLogs: hostLogs.slice(-30) }; }
    if (page) try { await screenshot(`failure-${result.stage || 'setup'}`); } catch {}
  } finally {
    if (fixtureInstalled) { /* The trusted fixture belongs to this disposable host and is discarded at close. */ }
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close(); await host.close();
    console.log(JSON.stringify({ viewport: spec.name, status: result.status, stage: result.stage, error: result.error?.split('\n')[0] }));
  }
}

try { for (const spec of specs) await run(spec); }
finally { await browser.close(); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
process.exitCode = evidence.failures.length ? 1 : 0;

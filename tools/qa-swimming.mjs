#!/usr/bin/env node
// RNV05 coastal swimming visual QA. Disposable memory-backed GameHost only.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { GAME } from '../src/data/meta.js';
import { tuning } from '../src/data/tuning.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') {
  throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this local harness.');
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || 'docs/delivery/rnv05-coastal-swimming');
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
  { name: 'swim-desktop-es-low', width: 1280, height: 720, touch: false, quality: 'low', locale: 'es' },
  { name: 'swim-mobile-en-low', width: 390, height: 844, touch: true, quality: 'low', locale: 'en' },
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
  purpose: 'Verify real generated-coast swimming, server-owned stamina/load HUD, land return/recovery, and own-raft sail/swim/reboard through live navigation UI.',
  harness: 'One serial Chromium launch with desktop and mobile contexts, isolated disposable memory-backed GameHost/account per viewport, local Three.js/GSAP/font routes. No SQL, external services, production writes, or physical-device performance claim.',
  fixture: 'Coast point is selected from this generated server world by sampling a dry playable beach with nearby contiguous deep water. Server relocation seeds only the starting position; WASD or touch joystick performs movement. Pack load uses a valid profile cargo item and is projected by GameHost into swimLoad.',
  assertions: [], viewports: [], failures: [], performanceClaim: false,
  boatPrompt: { status: 'pending' },
};
const ACCOUNT = 'b87663e5-0d40-4f4b-8921-0b630c335508';
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
  await page.goto(`http://127.0.0.1:${result.port}/?debug&q=${result.quality}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
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
  // Two valid stones use 4/10 volume and 8/10 mass, producing a visible server-derived swim-load effect.
  profile.eco.pack.goods = { piedra: 2 };
  return profile;
}

function chooseCoastalSite(world) {
  const map = world.map, half = Math.floor(map.size / 2) - 14, candidates = [];
  const directions = [
    { dx: 0, dz: -1, key: 'KeyS' }, { dx: 0, dz: 1, key: 'KeyW' },
    { dx: -1, dz: 0, key: 'KeyA' }, { dx: 1, dz: 0, key: 'KeyD' },
  ];
  for (let z = -half; z <= half; z += 2) for (let x = -half; x <= half; x += 2) {
    const y = map.groundAt(x, z);
    if (!(y > 0.65 && y <= 1.7) || map.onDock?.(x, z) || map.zoneAt?.(x, z) !== 'playa') continue;
    if ((map.colliders || []).some(c => Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 1.5)) continue;
    for (const direction of directions) {
      let waterDistance = null, deepRun = 0, previousY = y, clear = true;
      for (let distance = 0.5; distance <= 16; distance += 0.5) {
        const wx = x + direction.dx * distance, wz = z + direction.dz * distance;
        const nextY = map.groundAt(wx, wz);
        if (map.onDock?.(wx, wz) || Math.abs(nextY - previousY) > 0.8 ||
            map.queryColliders?.(wx, wz, 0.65)?.length || world.raftDeck?.surface(wx, wz, Math.max(y, nextY))) { clear = false; break; }
        if (tuning.world.waterLevel - nextY > tuning.world.wadeMax + 0.05) {
          waterDistance ??= distance; deepRun = distance - waterDistance;
          if (deepRun >= 6) break;
        }
        previousY = nextY;
      }
      if (!clear || waterDistance === null || deepRun < 6) continue;
      // Require a contiguous, collider-free approach and six units of sustained deep water.
      candidates.push({ x, y, z, direction: { ...direction }, waterDistance,
        spawnDistance: Math.hypot(x - map.landmarks.spawn.x, z - map.landmarks.spawn.z) });
    }
  }
  candidates.sort((a, b) => a.waterDistance - b.waterDistance || a.spawnDistance - b.spawnDistance);
  return candidates[0] || null;
}

function cameraInputForWorld(dx, dz, yaw) {
  // Invert the app's camera-relative GroundPlane basis so actual keyboard/touch input follows the surveyed world vector.
  let x = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  let y = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const n = Math.hypot(x, y) || 1; x /= n; y /= n;
  const keys = [...(y > 0.35 ? ['w'] : y < -0.35 ? ['s'] : []), ...(x > 0.35 ? ['d'] : x < -0.35 ? ['a'] : [])];
  return { x, y, keys, reverseKeys: keys.map(key => ({ w: 's', s: 'w', a: 'd', d: 'a' })[key]) };
}

async function touchDrag(page, context, selector, dx, dy, duration, until = null) {
  const control = page.locator(selector), box = await control.boundingBox();
  check(box, `touch control has no visible bounds: ${selector}`);
  const cdp = await context.newCDPSession(page), x = box.x + box.width * 0.5, y = box.y + box.height * 0.5;
  const rotated = await page.evaluate(() => document.body.classList.contains('rotated'));
  // Stage pointer deltas rotate with the portrait game canvas: logical x/y become screen dy/dx.
  const screenDx = rotated ? dy : dx, screenDy = rotated ? dx : -dy;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }] });
  try {
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
        { x: x + screenDx * i / 5, y: y + screenDy * i / 5, id: 1, radiusX: 3, radiusY: 3, force: 1 },
      ] });
      await page.waitForTimeout(35);
    }
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      if (until && await until()) break;
      await page.waitForTimeout(Math.min(100, deadline - Date.now()));
    }
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

function relocate(world, server, entity, point) {
  const s = world.ecs;
  s.x[entity] = point.x; s.y[entity] = world.map.groundAt(point.x, point.z); s.z[entity] = point.z;
  s.vx[entity] = s.vz[entity] = s.kbx[entity] = s.kbz[entity] = s.moveMag[entity] = 0;
  s.swim[entity] = 0; s.swimStamina[entity] = tuning.swim.stamina; s.swimDrown[entity] = 0;
  s.dashT[entity] = -1; s.dashBuffer[entity] = 0;
  server.broadcastSnapshot();
}

async function run(browser, spec) {
  const result = { ...spec, status: 'running', stage: 'setup', errors: [], consoleErrors: [], requestFailures: [],
    httpFailures: [], externalRequests: [], websockets: [], screenshots: [], assertions: {}, port: 0 };
  evidence.viewports.push(result);
  const hostLogs = [], store = createMemoryStore();
  await store.initializeProfile(ACCOUNT, seededProfile());
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-swimming-${spec.name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true,
    saveSecret: `qa-swimming-${spec.name}`, chat: { enabled: false }, log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  let context, page, server, world, entity;
  const screenshot = async label => {
    // Server fixture teleports do not move the client camera instantly. Let the ordinary chase
    // camera/naval blend finish before collecting evidence of the play state.
    await page.waitForTimeout(label === '01-coast' || label === '06-own-raft-water-exit' || label === '07-own-raft-reboard' ? 2200 : 350);
    const file = `${spec.name}-${runTag}-${label}.jpg`;
    await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88 });
    result.screenshots.push(file); return file;
  };
  try {
    result.port = await host.listen(); await waitHealthy(result.port); server = host.game.server; world = server.world;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1,
      isMobile: spec.touch, hasTouch: spec.touch });
    page = await context.newPage(); entity = await openApp(page, result.port, result);
    const profile = world.profiles.get(entity), site = chooseCoastalSite(world);
    check(profile?.eco?.pack?.goods?.piedra === 2, 'valid preseeded pack cargo did not load into authenticated profile');
    check(site, 'generated map has no dry playa with a nearby playable deep-water approach');
    const cameraYaw = await page.evaluate(() => window.__mn.world.rig.yawTarget);
    site.input = cameraInputForWorld(site.direction.dx, site.direction.dz, cameraYaw);
    const raftPilotReady = world.navalPilot?.snapshot?.(entity) || null;
    world.economy.hours = 12; world.economy.acc = 0;
    relocate(world, server, entity, site);
    result.fixture = { coast: site, cameraYaw, cameraRelativeInput: { x: site.input.x, y: site.input.y, keys: site.input.keys },
      serverDayHours: world.economy.hours,
      pack: { goods: structuredClone(profile.eco.pack.goods), cap: profile.eco.pack.cap, maxMass: profile.eco.pack.maxMass,
        swimLoad: world.ecs.swimLoad[entity] }, navalPilot: raftPilotReady,
      boatHook: 'Live owned starter raft mounted, sailed, exited, and reboarded through normal navigation actions.' };
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.client.cur.x - x, window.__mn.client.cur.z - z) < 0.5,
      { x: site.x, z: site.z }, { timeout: 15000 });
    await page.waitForFunction(() => window.__mn.world.lighting.cur.sunI > 0.4, null, { timeout: 15000 });
    result.stage = 'coastal-approach';
    await screenshot('01-coast');

    const moveIntoWater = async (duration, until) => {
      if (!spec.touch) {
        await page.locator('#game').click({ position: { x: 30, y: 30 }, force: true });
        for (const key of site.input.keys) await page.keyboard.down(key);
        try { await waitUntil(until, 'authoritative swimming state from real keyboard input', duration); }
        finally { for (const key of site.input.keys) await page.keyboard.up(key); }
      } else {
        const zone = page.locator('.joy-zone'); await zone.waitFor({ state: 'visible', timeout: 10000 });
        await touchDrag(page, context, '.joy-zone', site.input.x * 45, site.input.y * 45, duration, until);
      }
    };
    result.stage = 'real-input-swim';
    await moveIntoWater(15000, () => world.ecs.swim[entity] === 1 &&
      (world.ecs.x[entity] - site.x) * site.direction.dx + (world.ecs.z[entity] - site.z) * site.direction.dz >= 3.2);
    check(world.ecs.swim[entity] === 1, 'real input did not hold the player in actual deep water');
    await page.waitForFunction(() => window.__mn.client.cur.swim === 1 || window.__mn.client.cur.st === 2,
      null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const node = document.querySelector('.mn-swim-status');
      return node && !node.hidden && Number(node.querySelector('progress')?.value) > 0;
    }, null, { timeout: 10000 });
    const worldActionHidden = await page.waitForFunction(() => {
      const worldPrompt = document.querySelector('.prompt');
      const touchAction = document.querySelector('#touch .t-act');
      return (!worldPrompt || worldPrompt.hidden) && (!touchAction || touchAction.hidden);
    }, null, { timeout: 10000 });
    const hud = await page.locator('.mn-swim-status').evaluate(el => {
      const r = el.getBoundingClientRect(), title = el.querySelector('[data-title]')?.textContent || '';
      const load = el.querySelector('[data-load]')?.textContent || '';
      return { title, load, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
        viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth } };
    });
    check(hud.title.trim().length > 0, 'swimming HUD title is empty for current locale');
    check(hud.x >= 0 && hud.y >= 0 && hud.right <= spec.width && hud.bottom <= spec.height && hud.viewport.documentWidth <= spec.width,
      `swimming HUD does not fit viewport: ${JSON.stringify(hud)}`);
    check(world.ecs.swimLoad[entity] > 0, 'loaded state did not come from the authoritative player profile');
    await page.waitForFunction(fragment => document.querySelector('.mn-swim-status [data-load]')?.textContent.includes(fragment),
      spec.locale === 'en' ? 'load slows' : 'carga', { timeout: 10000 });
    result.swimming = { hud, worldPromptHidden: Boolean(worldActionHidden), server: { swim: world.ecs.swim[entity], stamina: world.ecs.swimStamina[entity],
      load: world.ecs.swimLoad[entity], position: { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity] } },
      input: spec.touch ? 'touch joystick pointer gesture' : `keyboard ${site.input.keys.join('+')}` };
    await screenshot('02-swimming-loaded');

    result.stage = 'server-exhaustion-warning';
    // Server-only repeatability fixture: never edits browser prediction/client state.
    world.ecs.swimStamina[entity] = 0; world.ecs.swimDrown[entity] = 0; server.broadcastSnapshot();
    await page.waitForFunction(() => document.querySelector('.mn-swim-status')?.classList.contains('is-exhausted') &&
      !!document.querySelector('.mn-swim-status [data-warning]')?.textContent.trim(), null, { timeout: 10000 });
    const warning = await page.locator('.mn-swim-status [data-warning]').textContent();
    check(warning.trim().length > 0, 'server-seeded zero stamina did not show localized exhaustion warning');
    result.exhaustion = { serverStamina: world.ecs.swimStamina[entity], serverDrown: world.ecs.swimDrown[entity], warning: warning.trim() };
    await screenshot('03-exhaustion-warning');

    result.stage = 'return-land-and-recover';
    if (!spec.touch) {
      for (const key of site.input.reverseKeys) await page.keyboard.down(key);
      try { await waitUntil(() => world.ecs.swim[entity] === 0, 'server player leaving water with keyboard', 15000); }
      finally { for (const key of site.input.reverseKeys) await page.keyboard.up(key); }
    } else {
      await touchDrag(page, context, '.joy-zone', -site.input.x * 45, -site.input.y * 45, 15000,
        () => world.ecs.swim[entity] === 0);
    }
    await page.waitForFunction(() => window.__mn.client.cur.swim !== 1 && window.__mn.client.cur.st !== 2,
      null, { timeout: 15000 });
    await waitUntil(() => world.ecs.swimStamina[entity] > 0, 'server swimming stamina recovery', 5000);
    await page.waitForFunction(() => document.querySelector('.mn-swim-status')?.hidden === true, null, { timeout: 10000 });
    result.returnToLand = { serverSwimming: world.ecs.swim[entity], stamina: world.ecs.swimStamina[entity], hudHidden: true,
      position: { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity] } };
    await screenshot('04-land-hud-hidden');

    result.stage = 'own-raft-mount-and-sail';
    const raft = publicRafts(world).find(candidate => candidate.owner === entity);
    check(raft?.helm && raft.id, 'authenticated profile has no owned, pilot-ready starter raft');
    const helm = pilotPoint(raft, raft.helm), ecs = world.ecs;
    ecs.x[entity] = helm.x; ecs.y[entity] = helm.y; ecs.z[entity] = helm.z; ecs.facing[entity] = helm.f;
    ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
    world.raftDeck.update(publicRafts(world)); server.broadcastSnapshot();
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.key === 'F', null, { timeout: 15000 });
    const mountPrompt = await page.locator('.ln-prompt').innerText();
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.locator('.ln-prompt [data-run]').click();
    await page.waitForFunction(() => window.__mn.client.naval?.active === true, null, { timeout: 20000 });
    const initialVoyage = world.navalPilot.voyageSnapshot(entity);
    result.ownRaft = { shipId: raft.id, mountPrompt, mountedThroughVisibleAction: true,
      start: { x: initialVoyage.home.x, z: initialVoyage.home.z }, initialDistanceHome: initialVoyage.distanceHome };

    const sailingLimit = 60000;
    if (!spec.touch) {
      await page.keyboard.down('w');
      try { await waitUntil(() => world.navalPilot.voyageSnapshot(entity).distanceHome >= 22,
        'actual keyboard sailing to open water', sailingLimit); }
      finally { await page.keyboard.up('w'); }
    } else {
      // TouchHelm consumes stage-relative joystick axes; the helper maps these through phone rotation.
      await touchDrag(page, context, '.naval-touch-stick-move', 0, 44, sailingLimit,
        () => world.navalPilot.voyageSnapshot(entity).distanceHome >= 22);
    }
    const distanceAfterSail = world.navalPilot.voyageSnapshot(entity).distanceHome;
    check(distanceAfterSail >= 20, `live helm input did not sail the raft to open water: ${distanceAfterSail.toFixed(1)} units`);
    await waitUntil(() => Math.hypot(world.navalPilot.snapshot(entity)?.body?.state?.vx || 0,
      world.navalPilot.snapshot(entity)?.body?.state?.vz || 0) <= 0.8, 'raft to stop after releasing helm input', 30000);
    await waitUntil(() => world.navalPilot.voyageSnapshot(entity).canSwim === true,
      'real water exit prompt at the stopped open-water raft', 12000);
    result.ownRaft.distanceAfterSailing = distanceAfterSail;
    result.ownRaft.stopped = true;
    result.ownRaft.swimPromptState = world.navalPilot.voyageSnapshot(entity);
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.key === 'G' &&
      window.__mn.navigation.interaction()?.id === 'swim', null, { timeout: 15000 });
    await page.waitForFunction(locale => {
      const text = document.querySelector('.ln-prompt [data-prompt]')?.textContent || '';
      return locale === 'en' ? text.includes('Enter the water from your boat') : text.includes('Entra al agua desde tu barco');
    }, spec.locale, { timeout: 10000 });
    result.ownRaft.swimPrompt = await page.locator('.ln-prompt').innerText();
    await screenshot('05-own-raft-water-exit-prompt');
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.keyboard.press('g');
    await page.waitForFunction(() => window.__mn.client.voyage?.swimming === true && window.__mn.client.voyage?.canReboard === true,
      null, { timeout: 20000 });
    check(world.ecs.swim[entity] === 1, 'live G water exit did not put the authoritative player in swimming state');
    result.ownRaft.swimCommand = 'G via normal live-navigation hotkey/button';
    await screenshot('06-own-raft-water-exit');
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.key === 'F' &&
      window.__mn.client.voyage?.swimming === true && window.__mn.client.voyage?.canReboard === true,
      null, { timeout: 15000 });
    result.ownRaft.reboardPrompt = await page.locator('.ln-prompt').innerText();
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.keyboard.press('f');
    await page.waitForFunction(() => window.__mn.client.naval?.active === true && window.__mn.client.voyage?.swimming === false,
      null, { timeout: 20000 });
    check(world.navalPilot.walking(entity) && world.ecs.swim[entity] === 0,
      'live F reboard did not commit the player as a walker on the own raft');
    result.ownRaft.reboardCommand = 'F via normal live-navigation hotkey/button';
    result.ownRaft.walkingAfterReboard = world.navalPilot.walking(entity);
    result.ownRaft.finalPosition = { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity] };
    result.ownRaft.status = 'passed';
    await screenshot('07-own-raft-reboard');

    result.stage = 'final-browser-checks';
    check(result.websockets.some(socket => socket.url.includes('/ws')), 'normal play did not connect to GameHost WebSocket');
    check(result.errors.length === 0 && result.consoleErrors.length === 0 && result.requestFailures.length === 0 &&
      result.httpFailures.length === 0 && result.externalRequests.length === 0,
      `browser errors or external requests: ${JSON.stringify({ errors: result.errors, consoleErrors: result.consoleErrors,
        requestFailures: result.requestFailures, httpFailures: result.httpFailures, externalRequests: result.externalRequests })}`);
    result.assertions = { normalPlayJoin: true, generatedCoastalSite: true, serverNoonVisibility: true,
      realKeyboardOrTouchSwimming: true, localizedVisibleHudFitsViewport: true, serverProfileCargoProjectsSwimLoad: true,
      serverStaminaFixtureShowsExhaustion: true, landReturnHidesHudAndRegenerates: true, noBrowserErrorsOrExternalRequests: true,
      noWorldActionPromptWhileSwimming: true, ownRaftMountSailOpenWaterStopGSwimFReboard: true };
    result.status = 'passed'; result.stage = 'complete';
  } catch (error) {
    result.status = 'failed'; result.error = String(error?.stack || error);
    evidence.failures.push({ viewport: spec.name, stage: result.stage, error: error.message });
    if (page) try { result.browserState = await page.evaluate(() => ({ url: location.href,
      bodyText: document.body.innerText.slice(0, 1400), joined: window.__mn?.client?.joined,
      current: window.__mn?.client?.cur, swimmingHud: document.querySelector('.mn-swim-status')?.outerHTML,
      appErrors: window.__mn?.errors?.slice?.(-10) || [] })); } catch (diagnosticError) {
      result.browserState = { diagnosticError: String(diagnosticError) };
    }
    try { result.final = { player: entity && { x: world.ecs.x[entity], y: world.ecs.y[entity], z: world.ecs.z[entity],
      swim: world.ecs.swim[entity], swimStamina: world.ecs.swimStamina[entity], swimDrown: world.ecs.swimDrown[entity],
      swimLoad: world.ecs.swimLoad[entity], hp: world.ecs.hp[entity] }, hostLogs: hostLogs.slice(-25) }; } catch {}
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
evidence.boatPrompt = { status: evidence.viewports.length === specs.length && evidence.viewports.every(row => row.ownRaft?.status === 'passed')
  ? 'passed' : 'failed', viewports: evidence.viewports.filter(row => row.ownRaft?.status === 'passed').map(row => row.name) };
await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
process.exitCode = evidence.failures.length ? 1 : 0;

#!/usr/bin/env node
// Live HUD browser acceptance for the normal game on desktop and touch viewports.
// Uses an ephemeral dev:false GameHost and memory store; never reads .env or writes game files.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';

const out = resolve('docs/delivery/live-hud-publication');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify that the normal-game live naval HUD uses the reference instrument layout, stays within desktop/touch stages, and keeps its action slots and helm/deck lifecycle usable.',
  harness: 'One ephemeral dev:false GameHost with an in-memory store per viewport; normal game UI and real owner helm commands; local Three.js/GSAP/font routes; no .env, SQL, external services, or performance claim.',
  fixture: 'After a fresh guest joins, the trusted QA fixture positions the owner at the existing owned starter helm and broadcasts the snapshot. Mount, deck mode, return to helm, and dock use the normal game controls and server commands. No fake enemies, damage, skills, or cargo are created.',
  protocolVersion: PROTOCOL_VERSION,
  performanceClaim: false,
  viewports: [],
  failures: [],
};
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const specs = [
  { name: 'live-hud-desktop-1365x768', width: 1365, height: 768, touch: false },
  { name: 'live-hud-touch-landscape-844x390', width: 844, height: 390, touch: true },
  { name: 'live-hud-touch-portrait-390x844', width: 390, height: 844, touch: true },
];
const selectedViewport = process.env.MN_QA_VIEWPORT?.trim().toLowerCase();
if (selectedViewport) {
  const selected = specs.filter((spec) => spec.name.toLowerCase().includes(selectedViewport));
  if (!selected.length) throw new Error(`unknown MN_QA_VIEWPORT filter: ${process.env.MN_QA_VIEWPORT}`);
  specs.splice(0, specs.length, ...selected);
}
const browser = await chromium.launch({
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'],
});

function serverFor(host) { return host.game.server; }
async function installLocalRoutes(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    if (!match) return route.abort();
    const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}
async function openApp(page, port, result) {
  page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  await installLocalRoutes(page);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
  return page.evaluate(() => window.__mn.client.youServer);
}
function positionOwnerAtHelm(host, entity) {
  const server = serverFor(host), world = server.world;
  const raft = publicRafts(world).find((record) => record.owner === entity);
  check(raft?.helm, `fresh owner ${entity} has no starter helm`);
  const point = pilotPoint(raft, raft.helm), ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z; ecs.facing[entity] = point.f;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = ecs.castK[entity] = ecs.castLock[entity] = ecs.atkStage[entity] = 0;
  world.raftDeck.update(publicRafts(world)); server.broadcastSnapshot();
  return { raftId: raft.id, helm: raft.helm, point };
}
function recordServerNavalEvents(host, result) {
  const world = serverFor(host).world, emit = world.emit.bind(world);
  result.serverNavalEvents = [];
  world.emit = (event) => {
    if (event?.type === 'navalPilot' || event?.type === 'commandDenied') {
      result.serverNavalEvents.push({ type: event.type, op: event.op || null, ok: event.ok ?? null,
        why: event.why || null, active: event.active ?? null, mode: event.mode || null,
        epoch: event.epoch ?? null, shipId: event.shipId || null, entity: event.to ?? event.e ?? null });
    }
    return emit(event);
  };
}
async function installHudActionTrace(page) {
  await page.evaluate(() => {
    const m = window.__mn, nav = m.navigation, touch = nav.touch;
    window.__qaLiveHudTrace = [];
    const trace = (item) => window.__qaLiveHudTrace.push({ at: performance.now(), ...item });
    const oldActivate = touch.activateSlot.bind(touch);
    touch.activateSlot = (slot) => {
      const action = touch.catalog.get(touch.bindings[slot]);
      trace({ kind: 'activateSlot', slot, id: touch.bindings[slot], label: action?.label || null,
        disabled: !!action?.disabled, enabled: touch.enabled, disposed: touch.disposed });
      return oldActivate(slot);
    };
    const oldAction = touch.callbacks.onAction;
    touch.callbacks.onAction = (id) => {
      trace({ kind: 'onAction', id, enabled: touch.enabled, naval: !!m.client.naval?.active,
        deck: !!m.client.deck?.active });
      return oldAction(id);
    };
    const oldRun = nav.runAction.bind(nav);
    nav.runAction = (id) => {
      const interaction = nav.interaction(), key = id === 'mode' || id === 'leave' ? 'E' : null;
      const target = key && interaction?.actions?.find((action) => action.key === key);
      const before = { id, canAct: nav.canAct(), interaction: interaction?.actions?.map((action) => ({ key: action.key,
        verb: action.verb, disabled: !!action.disabled })), target: target && { key: target.key, verb: target.verb,
        disabled: !!target.disabled }, naval: !!m.client.naval?.active, deck: !!m.client.deck?.active };
      const value = oldRun(id);
      trace({ kind: 'runAction', ...before, returned: value ?? null,
        navalAfter: !!m.client.naval?.active, deckAfter: !!m.client.deck?.active });
      return value;
    };
    const oldSend = m.client.send.bind(m.client);
    window.__qaLiveHudCommands = [];
    m.client.send = (message) => {
      if (message?.type === 'navalPilot') window.__qaLiveHudCommands.push({ ...message });
      return oldSend(message);
    };
    touch.wrapper.addEventListener('pointerdown', (event) => {
      const slot = event.target.closest?.('.naval-touch-slot');
      if (slot) trace({ kind: 'pointerdown', slot: slot.dataset.slot, id: slot.dataset.action,
        label: slot.querySelector('.naval-touch-slot-label')?.textContent, pointerType: event.pointerType,
        enabled: touch.enabled, disabled: slot.disabled, ariaDisabled: slot.getAttribute('aria-disabled') });
    }, true);
    for (const type of ['pointerup', 'pointercancel', 'click']) touch.wrapper.addEventListener(type, (event) => {
      const slot = event.target.closest?.('.naval-touch-slot');
      if (slot) trace({ kind: type, slot: slot.dataset.slot, id: slot.dataset.action,
        label: slot.querySelector('.naval-touch-slot-label')?.textContent, pointerType: event.pointerType || null,
        detail: event.detail ?? null, enabled: touch.enabled, disabled: slot.disabled,
        ariaDisabled: slot.getAttribute('aria-disabled') });
    }, true);
  });
}
async function snapCameraToPlayer(page, point) {
  await page.waitForFunction(({ x, z }) => {
    const m = window.__mn, e = m?.client?.youLocal, c = m?.client?.pred?.ecs;
    return e != null && c && Math.hypot(c.x[e] - x, c.z[e] - z) < .8;
  }, { x: point.x, z: point.z }, { timeout: 20000 });
  await page.evaluate(async () => {
    const THREE = await import('three'), m = window.__mn, e = m.client.youLocal, c = m.client.pred.ecs;
    m.world.rig.blend = null; m.world.rig.snapTo(new THREE.Vector3(c.x[e], c.y[e], c.z[e]));
  });
  await page.waitForTimeout(300);
}
async function screenshot(page, result, label) {
  const file = resolve(out, `${result.name}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false }); result.screenshots.push(file); return file;
}
async function longPress(page, locator, touch) {
  const box = await locator.boundingBox();
  check(box, 'action slot has no visible long-press target');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1, radiusX: 5, radiusY: 5 }] });
    await pause(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await pause(650);
    await page.mouse.up();
  }
}
async function mountedHud(page, spec) {
  return page.evaluate(({ touch, width, height }) => {
    const m = window.__mn, stage = m.navigation.stage;
    const rect = (selector) => {
      const el = document.querySelector(selector), r = el?.getBoundingClientRect();
      if (!el || !r || !r.width || !r.height) return null;
      const points = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
        .map(([x, y]) => stage.toLocal(x, y));
      return { visible: getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden',
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
        local: { left: Math.min(...points.map((p) => p.x)), top: Math.min(...points.map((p) => p.y)),
          right: Math.max(...points.map((p) => p.x)), bottom: Math.max(...points.map((p) => p.y)) } };
    };
    const slots = [...document.querySelectorAll('.naval-touch-slot')].map((button, index) => ({ index,
      label: button.getAttribute('aria-label'), text: button.querySelector('.naval-touch-slot-label')?.textContent,
      shortcut: button.querySelector('.naval-touch-slot-key')?.textContent,
      ariaShortcut: button.getAttribute('aria-keyshortcuts'),
      rect: rectFor(button) }));
    function rectFor(el) {
      const r = el?.getBoundingClientRect(); if (!el || !r || !r.width || !r.height) return null;
      const points = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => stage.toLocal(x, y));
      return { x: r.x, y: r.y, width: r.width, height: r.height, local: { left: Math.min(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) } };
    }
    return { viewport: { width, height }, stage: { width: stage.w, height: stage.h, rotated: stage.rotated }, touch,
      stripDisplay: getComputedStyle(document.querySelector('.ln-strip')).display,
      root: rect('.live-navigation'), gauge: rect('.naval-touch-gauge'), hull: rect('.hud-player .bars .ln-touch-hull'),
      wind: rect('.ln-touch-wind'), compass: rect('.ln-touch-compass'),
      sticks: [...document.querySelectorAll('.naval-touch-stick')].map((el) => ({ label: el.dataset.stick, box: rectFor(el) })),
      slots, actionIds: [...(m.navigation.touch?.catalog?.keys?.() || [])],
      route: { available: !!m.client.route?.available, active: !!m.client.route?.active,
        summaryVisible: !!document.querySelector('.ln-route-trial') && !document.querySelector('.ln-route-trial').hidden,
        summaryText: document.querySelector('.ln-route-trial')?.textContent?.trim() || '' },
      carryingText: document.querySelector('[data-touch-load]')?.textContent || '',
      voyage: { active: m.client.voyage.active, phase: m.client.voyage.phase },
      capacity: m.client.capacity && { mode: m.client.capacity.mode, status: m.client.capacity.status,
        freeMass: m.client.capacity.freeMass, holdVolume: m.client.capacity.holdVolume, holdCap: m.client.capacity.holdCap },
      pointers: m.navigation.touch?.diagnostics?.().pointers ?? null,
      errors: [...(m.errors || [])] };
  }, spec);
}
function assertFits(record, item, label, minSize = 0) {
  check(item?.visible ?? !!item, `${label} is not visible`);
  const box = item.box || item;
  check(box && box.width >= minSize && box.height >= minSize, `${label} is smaller than ${minSize}px: ${JSON.stringify(item)}`);
  const p = item.local || item;
  check(p.left >= -2 && p.top >= -2 && p.right <= record.stage.width + 2 && p.bottom <= record.stage.height + 2,
    `${label} clipped from stage after rotation: ${JSON.stringify({ box, local: p, stage: record.stage })}`);
}
async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], consoleErrors: [], requestFailures: [], screenshots: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1,
    dev: false, worldId: null, store: createMemoryStore(), saveSecret: `qa-live-hud-${spec.name}`, chat: { enabled: false }, log() {} });
  let context;
  try {
    console.log(`[${spec.name}] starting isolated dev:false memory host`);
    const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage(), entity = await openApp(page, port, result);
    recordServerNavalEvents(host, result);
    await installHudActionTrace(page);
    const fixture = positionOwnerAtHelm(host, entity);
    result.fixture = { ...fixture, kind: 'owner positioned at existing server-owned starter helm; no raft/profile edits' };
    await snapCameraToPlayer(page, fixture.point);
    await page.waitForFunction(() => window.__mn.navigation.interaction()?.verb === 'Pilotar', null, { timeout: 15000 });
    await screenshot(page, result, '00-before-helm');
    if (spec.touch) await page.locator('.ln-prompt [data-run]').tap();
    else await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__mn.client.naval.active, null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const m = window.__mn;
      return m.navigation.touch && m.navigation.touch.catalog?.has('mode') &&
        document.querySelector('.naval-touch-gauge') && document.querySelector('.ln-touch-wind') && document.querySelector('.ln-touch-compass');
    }, null, { timeout: 15000 });
    result.mounted = await mountedHud(page, spec);
    check(result.mounted.stripDisplay === 'none', `legacy top strip is still rendered: ${result.mounted.stripDisplay}`);
    assertFits(result.mounted, result.mounted.gauge, 'speed gauge', 72);
    assertFits(result.mounted, result.mounted.hull, 'hull meter integrated with player bars');
    assertFits(result.mounted, result.mounted.wind, 'wind and gust widget');
    assertFits(result.mounted, result.mounted.compass, 'course compass');
    check(result.mounted.slots.length === 3, `expected three reference action slots: ${JSON.stringify(result.mounted.slots)}`);
    check(result.mounted.actionIds.includes('mode') && result.mounted.actionIds.includes('capture'),
      `helm action catalog lacks mode/capture: ${JSON.stringify(result.mounted.actionIds)}`);
    if (spec.touch) {
      check(result.mounted.sticks.length === 2 && result.mounted.sticks.every((stick) => stick.box),
        `touch movement/camera sticks missing: ${JSON.stringify(result.mounted.sticks)}`);
      for (const stick of result.mounted.sticks) assertFits(result.mounted, stick.box, `${stick.label} stick`, 44);
    } else check(result.mounted.sticks.every((stick) => !stick.box),
      `desktop reference wrapper should hide touch sticks: ${JSON.stringify(result.mounted.sticks)}`);
    for (const slot of result.mounted.slots) assertFits(result.mounted, slot.rect, `action slot ${slot.label}`, 44);
    check(result.mounted.capacity?.mode === 'sailing' && Number.isFinite(result.mounted.capacity.freeMass)
      && Number.isFinite(result.mounted.capacity.holdVolume), `live owner capacity not confirmed at helm: ${JSON.stringify(result.mounted.capacity)}`);
    check(/uM/.test(result.mounted.carryingText), `confirmed carrying capacity is missing from reference HUD: ${result.mounted.carryingText}`);
    check(result.mounted.route.available && result.mounted.route.summaryVisible && /24 HP reparables/.test(result.mounted.route.summaryText),
      `live optional route/repair cap missing from HUD: ${JSON.stringify(result.mounted.route)}`);
    check(result.mounted.errors.length === 0, `runtime errors while mounting HUD: ${JSON.stringify(result.mounted.errors)}`);
    if (spec.touch) check(result.mounted.stage.rotated === (spec.name.includes('portrait')),
      `unexpected stage rotation state: ${JSON.stringify(result.mounted.stage)}`);
    result.sailingShot = await screenshot(page, result, '01-helm-mounted');

    if (!spec.touch) {
      check(result.mounted.slots.map((slot) => slot.shortcut).join(',') === 'Q,I,E',
        `default desktop cards lack their working shortcuts: ${JSON.stringify(result.mounted.slots)}`);
      await page.keyboard.press('KeyI');
      await page.waitForFunction(() => window.__mn.panels.charPanel.isOpen, null, { timeout: 5000 });
      await page.keyboard.press('KeyI');
      await page.waitForFunction(() => !window.__mn.panels.charPanel.isOpen, null, { timeout: 5000 });
      result.desktopBagShortcut = true;
      await page.keyboard.down('KeyQ');
      await page.waitForFunction(() => window.__mn.navigation.fixedInput()?.naval?.capture === true, null, { timeout: 5000 });
      result.desktopCapture = await page.evaluate(() => ({ capture: window.__mn.navigation.fixedInput()?.naval?.capture,
        keyDown: window.__mn.input.keys?.has?.('KeyQ') || false }));
      await page.keyboard.up('KeyQ');
      check(result.desktopCapture.capture, 'desktop Q did not request naval wind capture');
    }

    const bagIndex = await page.evaluate(() => window.__mn.navigation.touch.bindings.indexOf('bag'));
    check(bagIndex >= 0, 'bag action is not assigned to a visible slot for the long-press selector check');
    await page.evaluate(() => {
      const camera = window.__mn.navigation.sceneCamera, original = camera.recenter.bind(camera);
      window.__qaLiveHudCenterCalls = 0;
      camera.recenter = (...args) => { window.__qaLiveHudCenterCalls++; return original(...args); };
      window.__qaLiveHudBagClicks = 0;
      document.querySelector('#hud-bag')?.addEventListener('click', () => { window.__qaLiveHudBagClicks++; }, true);
    });
    const bagSlot = page.locator(`.naval-touch-slot[data-slot="${bagIndex}"]`);
    await longPress(page, bagSlot, spec.touch);
    await page.waitForFunction(() => !document.querySelector('.naval-touch-picker')?.hidden, null, { timeout: 5000 });
    const pickerOpened = await page.evaluate(() => ({ visible: !document.querySelector('.naval-touch-picker').hidden,
      bagClicks: window.__qaLiveHudBagClicks, pointers: window.__mn.navigation.touch.diagnostics().pointers }));
    check(pickerOpened.visible && pickerOpened.bagClicks === 0 && pickerOpened.pointers === 0,
      `long press executed its previous bag action or retained a pointer: ${JSON.stringify(pickerOpened)}`);
    const centerOption = page.locator('.naval-touch-picker-option[data-bind-id="center"]');
    if (spec.touch) await centerOption.tap(); else await centerOption.click();
    await page.waitForFunction(() => window.__mn.navigation.touch.bindings.includes('center'), null, { timeout: 5000 });
    const centerIndex = await page.evaluate(() => window.__mn.navigation.touch.bindings.indexOf('center'));
    const centerSlot = page.locator(`.naval-touch-slot[data-slot="${centerIndex}"]`);
    if (spec.touch) await centerSlot.tap(); else {
      check(await centerSlot.locator('.naval-touch-slot-key').textContent() === 'V', 'remapping to camera did not update the visible letter');
      check(await centerSlot.getAttribute('aria-keyshortcuts') === 'V', 'remapped camera card lacks its accessible shortcut');
      await page.keyboard.press('KeyV');
    }
    result.cameraAction = await page.evaluate(() => ({ calls: window.__qaLiveHudCenterCalls,
      bagClicks: window.__qaLiveHudBagClicks, navalActive: window.__mn.client.naval.active, pointers: window.__mn.navigation.touch.diagnostics().pointers }));
    check(result.cameraAction.calls === 1 && result.cameraAction.bagClicks === 0 && result.cameraAction.navalActive && result.cameraAction.pointers === 0,
      `camera action did not complete through its slot: ${JSON.stringify(result.cameraAction)}`);
    await longPress(page, centerSlot, spec.touch);
    await page.waitForFunction(() => !document.querySelector('.naval-touch-picker')?.hidden, null, { timeout: 5000 });
    const bagOption = page.locator('.naval-touch-picker-option[data-bind-id="bag"]');
    if (spec.touch) await bagOption.tap(); else await bagOption.click();
    await page.waitForFunction(() => window.__mn.navigation.touch.bindings.includes('bag'), null, { timeout: 5000 });
    check(await page.evaluate(() => window.__qaLiveHudCenterCalls) === 1,
      'long-pressing the centered slot triggered the action before its replacement was chosen');

    const modeIndex = await page.evaluate(() => window.__mn.navigation.touch.bindings.indexOf('mode'));
    check(modeIndex >= 0, 'mode action is not assigned to a visible slot');
    const modeSlot = page.locator(`.naval-touch-slot[data-slot="${modeIndex}"]`);
    result.modeBefore = await page.evaluate((index) => {
      const m = window.__mn, touch = m.navigation.touch, action = touch.catalog.get(touch.bindings[index]),
        slot = touch.slotButtons[index].button, interaction = m.navigation.interaction(), modeAction = interaction?.actions?.find((item) => item.key === 'E');
      return { index, binding: touch.bindings[index], label: action?.label || null, actionDisabled: !!action?.disabled,
        actionAvailable: action?.available !== false && action?.unavailable !== true, enabled: touch.enabled,
        slotDisabled: slot.disabled, ariaDisabled: slot.getAttribute('aria-disabled'), unavailable: slot.getAttribute('data-unavailable'),
        modeAction: modeAction && { key: modeAction.key, verb: modeAction.verb }, inputEnabled: m.input.enabled,
        paused: m.navigation.paused, naval: !!m.client.naval?.active, deck: !!m.client.deck?.active,
        commandsSoFar: window.__qaLiveHudCommands.length, traceLength: window.__qaLiveHudTrace.length };
    }, modeIndex);
    const modeTraceStart = result.modeBefore.traceLength;
    if (spec.touch) await modeSlot.tap(); else await modeSlot.click();
    let modeWaitError = null;
    try {
      await page.waitForFunction(() => window.__mn.client.deck.active, null, { timeout: 12000 });
    } catch (error) { modeWaitError = String(error?.message || error); }
    await page.waitForTimeout(250);
    result.modeAfter = await page.evaluate((traceStart) => ({ deckActive: window.__mn.client.deck.active,
      navalActive: window.__mn.client.naval.active, voyage: { ...window.__mn.client.voyage },
      touchEnabled: window.__mn.navigation.touch.enabled, inputEnabled: window.__mn.input.enabled,
      pointers: window.__mn.navigation.touch.diagnostics().pointers, commandTrace: window.__qaLiveHudCommands.slice(-4),
      actionTrace: window.__qaLiveHudTrace.slice(traceStart),
      naval: { active: window.__mn.client.naval.active, epoch: window.__mn.client.naval.epoch,
        state: window.__mn.client.naval.body?.state },
      deck: { active: window.__mn.client.deck.active, epoch: window.__mn.client.deck.epoch } }), modeTraceStart);
    result.modeWaitError = modeWaitError;
    result.modeServerEvents = result.serverNavalEvents.filter((event) => ['walk', 'helm'].includes(event.op));
    const walkAck = [...result.modeServerEvents].reverse().find((event) => event.op === 'walk');
    check(!modeWaitError && result.modeAfter.deckActive && result.modeAfter.navalActive,
      `mode slot did not transition client state: ${JSON.stringify({ before: result.modeBefore, after: result.modeAfter, waitError: modeWaitError })}`);
    check(walkAck?.ok === true,
      `server did not acknowledge mode slot's walk command: ${JSON.stringify({ before: result.modeBefore, after: result.modeAfter, events: result.modeServerEvents })}`);
    await page.waitForFunction(() => window.__mn.navigation.touch.catalog.get('mode')?.label === 'Timón'
      && window.__mn.navigation.touch.bindings.includes('mode'), null, { timeout: 10000 });
    result.deck = await page.evaluate(() => ({ deckActive: window.__mn.client.deck.active, navalActive: window.__mn.client.naval.active,
      pointers: window.__mn.navigation.touch.diagnostics().pointers, axes: window.__mn.navigation.fixedInput(),
      actionIds: [...window.__mn.navigation.touch.catalog.keys()],
      routeTrialVisible: !document.querySelector('.ln-route-trial').hidden,
      gustText: document.querySelector('[data-touch-gust-text]')?.textContent || '' }));
    const serverDeck = serverFor(host).world.navalPilot.routeContext(entity);
    result.deck.serverRouteContext = serverDeck && { shipId: serverDeck.shipId, epoch: serverDeck.epoch,
      helm: serverDeck.helm, ashore: serverDeck.ashore, bodyPresent: !!serverDeck.body };
    check(result.deck.pointers === 0, `slot interaction left a pointer active on deck: ${result.deck.pointers}`);
    check(result.deck.navalActive && result.deck.deckActive, `mode slot did not enter deck mode while retaining the live body: ${JSON.stringify(result.deck)}`);
    check(result.deck.serverRouteContext?.bodyPresent && result.deck.serverRouteContext.helm === false,
      `server did not retain a non-helm owner route context on deck: ${JSON.stringify(result.deck.serverRouteContext)}`);
    check(!result.deck.actionIds.includes('capture') && !result.deck.routeTrialVisible && /timón/i.test(result.deck.gustText),
      `deck mode still exposes helm-only capture/route UI or lacks its helm hint: ${JSON.stringify(result.deck)}`);
    check(result.deck.axes?.deck?.mx === 0 && result.deck.axes?.deck?.mz === 0,
      `leaving helm did not neutralize movement input: ${JSON.stringify(result.deck.axes)}`);
    result.deckShot = await screenshot(page, result, '02-deck-mode');

    const helmIndex = await page.evaluate(() => window.__mn.navigation.touch.bindings.indexOf('mode'));
    const returnSlot = page.locator(`.naval-touch-slot[data-slot="${helmIndex}"]`);
    const helmEventStart = result.serverNavalEvents.length;
    if (spec.touch) await returnSlot.tap(); else await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__mn.client.naval.active && !window.__mn.client.deck.active, null, { timeout: 15000 });
    result.helmReturn = { clientActive: true,
      serverRouteContext: (() => { const context = serverFor(host).world.navalPilot.routeContext(entity);
        return context && { shipId: context.shipId, epoch: context.epoch, helm: context.helm, bodyPresent: !!context.body }; })(),
      serverEvents: result.serverNavalEvents.slice(helmEventStart).filter((event) => event.op === 'helm') };
    check(result.helmReturn.serverEvents.some((event) => event.ok === true),
      `return-to-helm slot lacked authoritative ack: ${JSON.stringify(result.helmReturn)}`);
    check(result.helmReturn.serverRouteContext?.bodyPresent && result.helmReturn.serverRouteContext.helm === true,
      `server did not restore the owner helm route context: ${JSON.stringify(result.helmReturn.serverRouteContext)}`);
    result.returnedToHelm = true;

    if (spec.touch) {
      await page.locator('#hud-settings').click({ force: true });
      await page.waitForFunction(() => document.querySelector('#pause') && !document.querySelector('#pause').hidden, null, { timeout: 10000 });
      // Settings open is also available from the normal HUD on touch; pause must neutralize the control instance.
      const pauseState = await page.evaluate(() => ({ open: !!document.querySelector('#pause') && !document.querySelector('#pause').hidden,
        pointers: window.__mn.navigation.touch.diagnostics().pointers }));
      result.pauseCleanup = pauseState;
      check(pauseState.open && pauseState.pointers === 0, `pause did not open or left touch pointers active: ${JSON.stringify(pauseState)}`);
      await page.locator('#btn-resume').click({ force: true });
      await page.waitForFunction(() => window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 10000 });
    } else {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__mn.panels && document.querySelector('#pause') && !document.querySelector('#pause').hidden, null, { timeout: 10000 });
      result.pauseCleanup = await page.evaluate(() => ({ open: !document.querySelector('#pause').hidden,
        pointers: window.__mn.navigation.touch.diagnostics().pointers, navalActive: window.__mn.client.naval.active }));
      check(result.pauseCleanup.open && result.pauseCleanup.pointers === 0, `pause cleanup failed: ${JSON.stringify(result.pauseCleanup)}`);
      await page.locator('#btn-resume').click({ force: true });
      await page.waitForFunction(() => window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 10000 });
    }

    await page.waitForFunction(() => window.__mn.client.voyage.canDock && window.__mn.navigation.canAct()
      && window.__mn.navigation.keyAction('G')?.verb === 'Amarrar', null, { timeout: 10000 });
    result.dockReady = await page.evaluate(() => ({ canDock: window.__mn.client.voyage.canDock,
      phase: window.__mn.client.voyage.phase, mode: window.__mn.client.capacity?.mode }));
    if (spec.touch) {
      await page.waitForFunction(() => {
        const button = document.querySelector('.ln-prompt [data-run]');
        return button && !button.closest('.ln-prompt').hidden && button.textContent.trim() === 'Amarrar';
      }, null, { timeout: 10000 });
      await page.locator('.ln-prompt [data-run]').tap();
    } else await page.keyboard.press('KeyG');
    try {
      await page.waitForFunction(() => !window.__mn.client.voyage.active && !window.__mn.client.naval.active, null, { timeout: 15000 });
    } catch (error) {
      result.dockFailureState = await page.evaluate(() => ({ commands: window.__qaLiveHudCommands,
        canAct: window.__mn.navigation.canAct(), paused: window.__mn.navigation.paused, input: window.__mn.input.enabled,
        voyage: window.__mn.client.voyage, navalActive: window.__mn.client.naval.active, errors: window.__mn.errors }));
      throw error;
    }
    result.docked = await page.evaluate(() => ({ voyageActive: window.__mn.client.voyage.active,
      navalActive: window.__mn.client.naval.active, touchDisposed: window.__mn.navigation.touch?.disposed,
      pointers: window.__mn.navigation.touch?.diagnostics?.().pointers ?? 0, errors: [...(window.__mn.errors || [])] }));
    check(!result.docked.voyageActive && !result.docked.navalActive, `normal G dock failed: ${JSON.stringify(result.docked)}`);
    check(result.docked.pointers === 0 && result.docked.errors.length === 0, `dock/detach cleanup failed: ${JSON.stringify(result.docked)}`);
    check(result.errors.length === 0 && result.consoleErrors.length === 0,
      `browser errors during live HUD flow: ${JSON.stringify({ page: result.errors, console: result.consoleErrors })}`);
    result.dockShot = await screenshot(page, result, '03-docked');
    result.disposal = await page.evaluate(() => {
      const navigation = window.__mn.navigation, input = window.__mn.input, shortcuts = [...navigation.panelShortcuts];
      navigation.dispose();
      return { blocked: !navigation.canAct(), restored: shortcuts.every(({ key, previous }) => input.hotkeys.get(key) === previous),
        rootRemoved: !document.querySelector('.live-navigation') };
    });
    check(result.disposal.blocked && result.disposal.restored && result.disposal.rootRemoved,
      `disposing the HUD left controls or keyboard handlers active: ${JSON.stringify(result.disposal)}`);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.failure = String(error?.stack || error); evidence.failures.push({ name: result.name, failure: result.failure });
  } finally {
    try { await context?.close(); } catch {}
    try { await host.close(); } catch {}
  }
}

try {
  for (const spec of specs) await run(spec);
} finally {
  await browser.close();
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
evidence.status = evidence.viewports.length === specs.length && evidence.viewports.every((item) => item.status === 'passed') ? 'passed' : 'failed';
await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.viewports.map(({ name, status, failure }) => ({ name, status, failure }))));
if (evidence.status !== 'passed') process.exitCode = 1;

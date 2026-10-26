#!/usr/bin/env node
// D08c.8 browser acceptance: owner capacity, distinct cargo mass/volume, editor forecast and naval HUD.
// Each viewport uses an isolated ephemeral memory host and the normal browser renderer.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { ownerRaftCapacity } from '../src/sim/systems/raftCapacity.js';
import { raftCapacity } from '../src/sim/economy/raftCapacity.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { GAME } from '../src/data/meta.js';

const out = resolve('docs/delivery/d08c8-raft-capacity');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify owner-authoritative raft carrying capacity across cargo UI, editor preview and the live naval HUD.',
  harness: 'One fresh ephemeral GameHost + memory store per viewport; local Three.js/GSAP routes; normal/default Chrome renderer; isolated browser data; no .env, SQL, external hosts or persistent storage.',
  fixture: 'After a fresh guest joins, the QA fixture adds hierro:1, lona:1 and madera:1 to the owner pack, preserving gold and all other profile fields. Expected initial pack is 5 uV / 7 uM for hierro+lona, plus 3 uV / 3 uM of build-only madera. The UI transfers hierro to the hold and spends the fixture madera on one railing. Fixture goods are not rewards or a persistence claim.',
  protocolVersion: PROTOCOL_VERSION,
  performanceClaim: false,
  previousAttempts: [
    'An earlier failed placement run exposed combat mouse-look moving the construction grid; production now suppresses that aim while the editor is active. The final run waited for neutral camera look and recomputed the valid cell projection before real pointer/touch input.',
    'An earlier naval attempt used a host seed different from GAME.seed, so the client correctly rejected the coast snapshot. Final QA uses GAME.seed; no coast-seed validation was relaxed.',
    'A first HUD read occurred before the DOM rendered the already-confirmed sailing capacity. Final QA waits for visible load text and the applicable desktop or touch gauge.'
  ],
  viewports: [],
  failures: [],
};
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const bounds = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
const specs = [
  { name: 'capacity-desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'capacity-mobile-844x390', width: 844, height: 390, touch: true },
  { name: 'capacity-portrait-390x844', width: 390, height: 844, touch: true },
];
const browser = await chromium.launch({
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'],
});

function serverFor(host) { return host.game.server; }
async function waitCalm(server, entity, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && server.world.ecs.regenT[entity] < 3) await pause(50);
  check(server.world.ecs.regenT[entity] >= 3, `owner did not reach calm before cargo transfer: regenT=${server.world.ecs.regenT[entity]}`);
}
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
async function waitSaved(server, entity, previousBlob) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const client = [...server.clients.values()].find((c) => c.entity === entity), blob = client?.lastBlob;
    if (client && client.saveAt == null && typeof blob === 'string' && blob && blob !== previousBlob) return blob;
    await pause(100);
  }
  throw new Error('profile save did not settle after the editor placement');
}
function placeOwnerAtHelm(host, entity) {
  const server = serverFor(host), world = server.world;
  const raft = publicRafts(world).find((record) => record.owner === entity);
  check(raft?.helm, `fresh profile is missing its live helm anchor for owner ${entity}`);
  const point = pilotPoint(raft, raft.helm), c = world.ecs;
  c.x[entity] = point.x; c.y[entity] = point.y; c.z[entity] = point.z; c.facing[entity] = point.f;
  c.vx[entity] = c.vz[entity] = c.kbx[entity] = c.kbz[entity] = c.moveMag[entity] = 0;
  world.raftDeck.update(publicRafts(world));
  server.broadcastSnapshot();
  return { raft, point };
}
async function snapCameraToPlayer(page, point) {
  await page.waitForFunction(({ x, z }) => { const m = window.__mn, e = m?.client?.youLocal, c = m?.client?.pred?.ecs;
    return e != null && c && Math.hypot(c.x[e] - x, c.z[e] - z) < .8; }, { x: point.x, z: point.z }, { timeout: 20000 });
  await page.evaluate(async () => {
    const THREE = await import('three'), m = window.__mn, e = m.client.youLocal, c = m.client.pred.ecs;
    m.world.rig.blend = null; m.world.rig.snapTo(new THREE.Vector3(c.x[e], c.y[e], c.z[e]));
  });
  await page.waitForTimeout(300);
}
async function openApp(page, port, result) {
  page.on('pageerror', (error) => result.errors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  await installLocalRoutes(page);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 30000 });
  await page.evaluate(() => {
    const editor = window.__mn.panels.raftEditor, apply = editor.onResult.bind(editor), send = editor.send.bind(editor);
    window.__qaRaftEditAcks = []; window.__qaRaftEditSends = [];
    editor.send = (message) => { window.__qaRaftEditSends.push({ ...message }); return send(message); };
    window.__qaRaftActionClicks = 0; window.__qaRaftActCalls = 0; window.__qaRaftPointerEvents = [];
    editor.root.querySelector('.re-action').addEventListener('click', () => { window.__qaRaftActionClicks++; }, true);
    const act = editor.act.bind(editor); editor.act = () => { window.__qaRaftActCalls++; return act(); };
    const pointer = editor.pointer.bind(editor); editor.pointer = (event) => { window.__qaRaftPointerEvents.push({ type: event.type,
      pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY }); return pointer(event); };
    editor.onResult = (event) => { window.__qaRaftEditAcks.push({ type: event?.type, op: event?.op, ok: event?.ok, why: event?.why, rev: event?.rev }); return apply(event); };
  });
  return page.evaluate(() => window.__mn.client.youServer);
}
async function state(page) {
  return page.evaluate(() => {
    const m = window.__mn, p = m.client.profile, ship = p?.eco?.ships?.find((item) => item.kind === 'raft' && item.at === 'aldea');
    return { gold: p?.gold, tradeRev: p?.eco?.tradeRev, pack: { ...(p?.eco?.pack?.goods || {}) }, packCap: p?.eco?.pack?.cap,
      shipId: ship?.id, shipRev: ship?.rev, hold: { ...(ship?.hold?.goods || {}) }, holdCap: ship?.hold?.cap,
      parts: ship?.grid?.parts?.map((part) => [...part]) || [], snapshotCapacity: m.client.capacity ? { ...m.client.capacity } : null,
      publicRaftLeaksCargo: JSON.stringify(m.client.pred.rafts).includes('"hierro"') || JSON.stringify(m.client.pred.rafts).includes('"lona"'),
      errors: [...m.errors] };
  });
}
async function shot(page, result, name) {
  await page.waitForTimeout(160);
  const file = resolve(out, `${result.name}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false }); result.screenshots.push(file);
}
function capCompact(c) {
  return c && Object.fromEntries(['dryMass', 'holdMass', 'packMass', 'cargoMass', 'totalMass', 'buoyancy', 'cargoMax', 'freeMass', 'overMass', 'holdVolume', 'holdCap', 'packVolume', 'packCap', 'mode', 'raftRev', 'tradeRev'].map((key) => [key, c[key]]));
}
function sameCapacityNumbers(a, b) {
  return !!a && !!b && ['dryMass', 'holdMass', 'packMass', 'cargoMass', 'totalMass', 'buoyancy', 'cargoMax', 'freeMass', 'overMass',
    'holdVolume', 'holdFree', 'holdCap', 'packVolume', 'packFree', 'packCap'].every((key) => a[key] === b[key]);
}
async function run(spec) {
  const result = { ...spec, status: 'running', errors: [], consoleErrors: [], screenshots: [] };
  evidence.viewports.push(result);
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store: createMemoryStore(), worldId: null, saveSecret: `qa-raft-capacity-${spec.name}`, chat: { enabled: false }, log() {} });
  let context;
  try {
    console.log(`[${spec.name}] starting isolated memory host`);
    const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage(); let entity = await openApp(page, port, result);
    const server = serverFor(host), world = server.world;
    result.protocolVersion = PROTOCOL_VERSION;
    const profile = world.profiles.get(entity), ship = profile?.eco?.ships?.find((item) => item.kind === 'raft' && item.at === 'aldea');
    check(profile && ship && ship.hp > 0, 'fresh memory guest did not receive a usable starter raft');
    result.initialGold = profile.gold;
    profile.eco.pack.goods = { ...(profile.eco.pack.goods || {}), hierro: 1, lona: 1, madera: 1 };
    profile.eco.tradeRev += 1;
    const located = placeOwnerAtHelm(host, entity);
    await snapCameraToPlayer(page, located.point);
    result.fixture = { packAdds: { hierro: 1, lona: 1, madera: 1 }, goldPreserved: profile.gold === result.initialGold,
      shipId: ship.id, anchor: located.raft.helm, point: located.point, initialGoodsOnly: { ironCanvasVolume: 5, ironCanvasMass: 7, buildWoodVolume: 3, buildWoodMass: 3 } };
    result.fixture.cameraSnapForAcceptance = true;
    await page.waitForFunction(() => window.__mn.client.capacity?.id && window.__mn.client.profile?.eco?.pack?.goods?.hierro === 1, null, { timeout: 20000 });
    const expectedInitial = ownerRaftCapacity(world, entity);
    const stateInitial = await state(page);
    check(stateInitial.snapshotCapacity?.id === ship.id && stateInitial.snapshotCapacity.mode === 'port', `owner capacity snapshot missing at port: ${JSON.stringify(stateInitial.snapshotCapacity)}`);
    check(stateInitial.snapshotCapacity.packVolume === 8 && stateInitial.snapshotCapacity.packMass === 10,
      `fixture dimensions were not reflected independently: ${JSON.stringify(stateInitial.snapshotCapacity)}`);
    check(JSON.stringify(capCompact(stateInitial.snapshotCapacity)) === JSON.stringify(capCompact(expectedInitial)), 'client owner capacity disagrees with server-derived capacity before transfer');
    check(!stateInitial.publicRaftLeaksCargo, 'private goods appeared in the public raft snapshot');
    result.initial = { state: stateInitial, authoritativeCapacity: capCompact(expectedInitial) };
    await shot(page, result, '00-owner-capacity');

    if (spec.touch) {
      await page.waitForFunction(() => { const b = document.querySelector('.commerce-cargo-launcher'); return b && !b.hidden && b.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
      await page.locator('.commerce-cargo-launcher').tap({ force: true });
    } else await page.keyboard.press('KeyH');
    await page.waitForFunction(() => window.__mn.panels.commercePanel?.active || window.__mn.panels?.commerce?.active ||
      document.querySelector('.commerce-panel:not([hidden]) .cargo-capacity'), null, { timeout: 15000 }).catch(async () => {
        await page.waitForFunction(() => document.querySelector('.commerce-panel:not([hidden]) .cargo-capacity'), null, { timeout: 8000 });
      });
    const cargo = await page.evaluate(() => {
      const panel = document.querySelector('.commerce-panel'), card = panel?.querySelector('.cargo-capacity'), body = panel?.querySelector('.commerce-body');
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, display: s.display, visibility: s.visibility }; };
      return { panel: rect(panel), body: rect(body), card: rect(card), text: card?.innerText || '', progress: [...(card?.querySelectorAll('progress') || [])].map(el => ({ max: +el.max, value: +el.value, label: el.parentElement?.innerText || '' })) };
    });
    result.cargoPanel = cargo;
    check(cargo.card && cargo.card.display !== 'none' && cargo.card.visibility !== 'hidden' && cargo.card.width > 0,
      `confirmed capacity card did not render: ${JSON.stringify(cargo)}`);
    check(cargo.card.x >= 0 && cargo.card.y >= 0 && cargo.card.right <= spec.width + 1 && cargo.card.bottom <= spec.height + 1,
      `confirmed capacity card overflows viewport: ${JSON.stringify(cargo.card)}`);
    check(/uM/.test(cargo.text) && /uV/.test(cargo.text) && cargo.progress.length >= 2,
      `capacity card does not expose separate mass and volume measures: ${JSON.stringify(cargo)}`);
    await shot(page, result, '01-cargo-panel');

    await waitCalm(server, entity);
    const beforeTransfer = await state(page);
    await page.locator('.commerce-panel [data-good="hierro"]').click({ force: true });
    await page.locator('.commerce-panel [data-cargo-side]').selectOption('deposit');
    await page.locator('.commerce-panel [data-amount]').fill('1');
    await page.waitForFunction(() => { const b = document.querySelector('.commerce-panel .commerce-confirm'); return b && !b.disabled; }, null, { timeout: 12000 });
    const transferForecast = await page.locator('.commerce-panel .commerce-transfer-note').innerText();
    await page.locator('.commerce-panel .commerce-confirm').click({ force: true });
    await page.waitForFunction(({ tradeRev, shipRev }) => { const p = window.__mn.client.profile, s = p?.eco?.ships?.find(q => q.kind === 'raft' && q.at === 'aldea');
      return p?.eco?.tradeRev > tradeRev && s?.rev > shipRev && !window.__mn.panels.commercePanel?.pending; },
    { tradeRev: beforeTransfer.tradeRev, shipRev: beforeTransfer.shipRev }, { timeout: 25000 }).catch(async () => {
      await page.waitForFunction(() => { const s = window.__mn.client.profile?.eco?.ships?.find(q => q.kind === 'raft' && q.at === 'aldea');
        return s?.hold?.goods?.hierro === 1 && !window.__mn.panels.commercePanel?.pending; }, null, { timeout: 10000 });
    });
    await page.waitForFunction(() => { const m = window.__mn, p = m.client.profile, s = p?.eco?.ships?.find(q => q.kind === 'raft' && q.at === 'aldea'), c = m.client.capacity;
      return !!c && !!s && c.id === s.id && c.raftRev === s.rev && c.tradeRev === p.eco.tradeRev; }, null, { timeout: 20000 });
    const afterTransfer = await state(page), expectedAfterTransfer = ownerRaftCapacity(world, entity);
    check((beforeTransfer.pack.hierro || 0) === 1 && (afterTransfer.pack.hierro || 0) === 0 && afterTransfer.hold.hierro === 1,
      `actual cargo UI transfer did not move iron to the hold: ${JSON.stringify({ beforeTransfer, afterTransfer })}`);
    check(afterTransfer.gold === result.initialGold, 'cargo transfer changed owner gold');
    check(afterTransfer.snapshotCapacity?.holdVolume === 3 && afterTransfer.snapshotCapacity?.holdMass === 6 &&
      afterTransfer.snapshotCapacity?.packVolume === 5 && afterTransfer.snapshotCapacity?.packMass === 4,
      `capacity snapshot did not keep mass and volume distinct after transfer: ${JSON.stringify(afterTransfer.snapshotCapacity)}`);
    check(JSON.stringify(capCompact(afterTransfer.snapshotCapacity)) === JSON.stringify(capCompact(expectedAfterTransfer)), 'owner snapshot diverged from server-derived capacity after transfer');
    result.transfer = { action: 'real cargo UI deposit', good: 'hierro', quantity: 1, forecast: transferForecast,
      before: beforeTransfer, after: afterTransfer, authoritativeCapacity: capCompact(expectedAfterTransfer) };
    await page.locator('.commerce-panel .commerce-close').click({ force: true });
    await waitCalm(server, entity);

    if (spec.touch) {
      await page.waitForFunction(() => { const b = document.querySelector('.raft-build-launcher'), r = b?.getBoundingClientRect(); return b && !b.hidden && r?.width > 0; }, null, { timeout: 15000 });
      await page.locator('.raft-build-launcher').tap({ force: true });
    } else await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.__mn.panels.raftEditor.active, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const rig = window.__mn?.world?.rig; return rig && !rig.blend && Math.hypot(rig.look.x, rig.look.z) < 0.02;
    }, null, { timeout: 2000 }).catch(() => {});
    const editorCamera = await page.evaluate(() => { const r = window.__mn.world.rig;
      return { look: { x: r.look.x, z: r.look.z }, blend: !!r.blend, mode: r.mode }; });
    result.editorCamera = { ...editorCamera, fixtureSnap: true };
    check(!editorCamera.blend && Math.hypot(editorCamera.look.x, editorCamera.look.z) < 0.08,
      `camera did not settle to neutral look while raft editor was active: ${JSON.stringify(editorCamera)}`);
    await page.locator('.raft-editor [data-part="railing"]').click({ force: true });
    const attempts = [];
    let valid = null, validPoint = null;
    for (const [x, z] of [[0, 1], [0, 0], [1, 0], [1, 1]]) {
      const point = await page.evaluate(async ({ x, z }) => {
        const THREE = await import('three'), { stage } = await import('./src/ui/stage.js'), m = window.__mn;
        const raft = m.client.pred.rafts.find(r => String(r.id) === String(m.client.capacity.id));
        const lx = (x + .5) * 2, lz = (z + .5) * 2, c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
        const v = new THREE.Vector3(raft.x + c * lx + s * lz, raft.y, raft.z - s * lx + c * lz).project(m.world.camera);
        const px = (v.x + 1) * stage.w / 2, py = (1 - v.y) * stage.h / 2;
        const screen = stage.rotated ? { x: innerWidth - py, y: px } : { x: px, y: py };
        return { cell: [x, z], screen, inside: screen.x >= 0 && screen.y >= 0 && screen.x < innerWidth && screen.y < innerHeight,
          hit: document.elementFromPoint(screen.x, screen.y)?.id || document.elementFromPoint(screen.x, screen.y)?.tagName };
      }, { x, z });
      if (!point.inside || point.hit !== 'game') { attempts.push({ ...point, skipped: 'not game canvas' }); continue; }
      if (spec.touch) await page.touchscreen.tap(point.screen.x, point.screen.y);
      else await page.mouse.move(point.screen.x, point.screen.y);
      await page.waitForTimeout(100);
      const read = await page.evaluate(() => { const editor = window.__mn.panels.raftEditor, capacity = editor.root.querySelector('.re-capacity');
        const forecast = editor.placementForecast(editor.context());
        return { target: editor.target, actionDisabled: editor.root.querySelector('.re-action').disabled, preview: capacity?.innerText || '',
          forecast, rect: (() => {
          const r = capacity?.getBoundingClientRect(); return r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        })() }; });
      attempts.push({ ...point, ...read });
      if (read.target && !read.actionDisabled && read.preview.toUpperCase().includes('TRAS COLOCAR')) { valid = read; validPoint = point; break; }
    }
    const previewBox = valid?.rect;
    check(valid, `could not get valid real editor placement preview: ${JSON.stringify(attempts)}`);
    check(previewBox && previewBox.x >= 0 && previewBox.y >= 0 && previewBox.right <= spec.width + 1 && previewBox.bottom <= spec.height + 1,
      `editor capacity forecast overflows viewport: ${JSON.stringify(previewBox)}`);
    const editorBefore = await state(page), raftBefore = publicRafts(world).find(r => r.owner === entity);
    const forecastBefore = raftCapacity(raftBefore.parts, profile.eco.ships.find(s => s.id === raftBefore.id).hold, profile.eco.pack);
    const target = valid.target, proposed = ['railing', target.x, target.z, target.level, target.dir || 0];
    const expectedForecast = raftCapacity([...raftBefore.parts, proposed], profile.eco.ships.find(s => s.id === raftBefore.id).hold,
      { ...profile.eco.pack, goods: { ...profile.eco.pack.goods, madera: Math.max(0, (profile.eco.pack.goods.madera || 0) - 1) } });
    const expectedPreviewText = `${Math.floor(forecastBefore.freeMass)} libres uM`;
    const expectedAfterPreviewText = `${Math.floor(expectedForecast.freeMass)} libres uM`;
    check(valid.preview.toUpperCase().includes('ACTUAL · CONFIRMADO') && valid.preview.toUpperCase().includes('VISTA PREVIA TRAS COLOCAR') &&
      valid.preview.includes(expectedPreviewText) && valid.preview.includes(expectedAfterPreviewText),
      `editor did not expose actual and predicted capacity values: ${JSON.stringify({ preview: valid.preview, expectedPreviewText })}`);
    check(valid.forecast?.state === 'valid' && sameCapacityNumbers(valid.forecast.before, forecastBefore) &&
      sameCapacityNumbers(valid.forecast.after, expectedForecast),
      `editor placementForecast did not match the current server raft and predicted placement: ${JSON.stringify({ observed: valid.forecast, expectedBefore: capCompact(forecastBefore), expectedAfter: capCompact(expectedForecast) })}`);
    result.editorPreview = { target, proposed, text: valid.preview, rect: previewBox,
      actual: capCompact(forecastBefore), predicted: capCompact(expectedForecast), observedForecast: valid.forecast, attempts };
    await page.waitForFunction(() => { const button = document.querySelector('.raft-editor .re-action'); return button && !button.disabled; }, null, { timeout: 15000 });
    await shot(page, result, '02-editor-capacity-preview');
    const preBuildBlob = [...server.clients.values()].find(c => c.entity === entity)?.lastBlob || '';
    const freshPoint = await page.evaluate(async ({ x, z }) => {
      const THREE = await import('three'), { stage } = await import('./src/ui/stage.js'), m = window.__mn;
      const raft = m.client.pred.rafts.find(r => String(r.id) === String(m.client.capacity.id)); m.world.camera.updateMatrixWorld(true);
      const lx = (x + .5) * 2, lz = (z + .5) * 2, c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
      const v = new THREE.Vector3(raft.x + c * lx + s * lz, raft.y, raft.z - s * lx + c * lz).project(m.world.camera);
      const px = (v.x + 1) * stage.w / 2, py = (1 - v.y) * stage.h / 2;
      const screen = stage.rotated ? { x: innerWidth - py, y: px } : { x: px, y: py };
      return { screen, raft: { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw }, camera: { x: m.world.camera.position.x,
        y: m.world.camera.position.y, z: m.world.camera.position.z }, stage: { w: stage.w, h: stage.h, rotated: stage.rotated } };
    }, { x: valid.target.x, z: valid.target.z });
    result.editorCommitInteraction = { method: spec.touch ? 'freshly projected touch on cell, then tap Colocar' : 'freshly projected mouse pointerdown on valid cell',
      screen: freshPoint.screen, target: valid.target, projection: freshPoint };
    const editAckCount = await page.evaluate(() => window.__qaRaftEditAcks.length), editSendCount = await page.evaluate(() => window.__qaRaftEditSends.length);
    if (spec.touch) {
      await page.touchscreen.tap(freshPoint.screen.x, freshPoint.screen.y);
      await page.waitForFunction(() => { const button = document.querySelector('.raft-editor .re-action'); return button && !button.disabled; }, null, { timeout: 12000 });
      await page.locator('.raft-editor .re-action').tap();
    } else {
      await page.mouse.move(freshPoint.screen.x, freshPoint.screen.y);
      result.editorCommitInteraction.reprojected = await page.evaluate(() => { const e = window.__mn.panels.raftEditor, c = e.context();
        return { target: e.target, disabled: e.root.querySelector('.re-action').disabled, status: e.root.querySelector('.re-status').textContent,
          recordRev: c?.record.rev, shipRev: c?.ship.rev }; });
      check(!result.editorCommitInteraction.reprojected.disabled && result.editorCommitInteraction.reprojected.target,
        `fresh target became invalid before pointerdown: ${JSON.stringify(result.editorCommitInteraction)}`);
      await page.mouse.down(); await page.mouse.up();
    }
    await page.waitForFunction((count) => window.__qaRaftEditSends.length > count, editSendCount, { timeout: 5000 }).catch(async () => {
      result.editorAction = await page.evaluate(() => ({ sends: window.__qaRaftEditSends, acks: window.__qaRaftEditAcks,
        pointerEvents: window.__qaRaftPointerEvents,
        pending: window.__mn.panels.raftEditor.pending, status: window.__mn.panels.raftEditor.root.querySelector('.re-status')?.textContent,
        disabled: window.__mn.panels.raftEditor.root.querySelector('.re-action')?.disabled, clicks: window.__qaRaftActionClicks,
        acts: window.__qaRaftActCalls, active: window.__mn.panels.raftEditor.active, mode: window.__mn.panels.raftEditor.mode,
        target: window.__mn.panels.raftEditor.target, context: !!window.__mn.panels.raftEditor.context(),
        revisions: (() => { const c=window.__mn.panels.raftEditor.context(); return c && { record: c.record.rev, ship: c.ship.rev }; })() }));
      throw new Error(`editor action did not send a command: ${JSON.stringify(result.editorAction)}`);
    });
    await page.waitForFunction((count) => window.__qaRaftEditAcks.length > count, editAckCount, { timeout: 15000 }).catch(() => {});
    result.editorAction = await page.evaluate(({ ackCount, sendCount }) => ({ ack: window.__qaRaftEditAcks[ackCount] || null,
      send: window.__qaRaftEditSends[sendCount] || null, pending: window.__mn.panels.raftEditor.pending,
      status: window.__mn.panels.raftEditor.root.querySelector('.re-status')?.textContent,
      disabled: window.__mn.panels.raftEditor.root.querySelector('.re-action')?.disabled,
      profile: window.__mn.client.profile?.eco?.ships?.find(s => s.kind === 'raft' && s.at === 'aldea')?.grid?.parts?.filter(p => p[0] === 'railing').length }),
    { ackCount: editAckCount, sendCount: editSendCount });
    result.editorAck = result.editorAction.ack;
    check(result.editorAck?.ok !== false && !result.editorAck?.why, `server denied the real editor placement: ${JSON.stringify(result.editorAction)}`);
    await page.waitForFunction(({ beforeParts }) => { const p = window.__mn.client.profile, s = p?.eco?.ships?.find(q => q.kind === 'raft' && q.at === 'aldea');
      return s?.grid?.parts?.filter(q => q[0] === 'railing').length > beforeParts && !window.__mn.panels.raftEditor.pending; },
    { beforeParts: editorBefore.parts.filter(p => p[0] === 'railing').length }, { timeout: 25000 });
    const afterBuild = await state(page), expectedAfterBuild = ownerRaftCapacity(world, entity);
    check((afterBuild.pack.madera || 0) === 0 && afterBuild.parts.filter(p => p[0] === 'railing').length > editorBefore.parts.filter(p => p[0] === 'railing').length,
      `editor placement did not consume build material/add a railing: ${JSON.stringify({ editorBefore, afterBuild })}`);
    check(afterBuild.gold === result.initialGold && afterBuild.snapshotCapacity?.dryMass === expectedAfterBuild.dryMass &&
      JSON.stringify(capCompact(afterBuild.snapshotCapacity)) === JSON.stringify(capCompact(expectedAfterBuild)),
      `owner capacity did not reflect the edited raft: ${JSON.stringify({ capacity: afterBuild.snapshotCapacity, expected: capCompact(expectedAfterBuild) })}`);
    result.placement = { before: editorBefore, after: afterBuild, authoritativeCapacity: capCompact(expectedAfterBuild) };
    await page.locator('.raft-editor .re-close').click({ force: true });
    const blob = await waitSaved(server, entity, preBuildBlob); result.savedProfileBlobBytes = Buffer.byteLength(blob);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 90000 });
    await page.waitForFunction(() => window.__mn.client.profile?.eco?.ships?.some(s => s.grid.parts.some(p => p[0] === 'railing')) &&
      window.__mn.client.profile.eco.pack.goods.lona === 1 && window.__mn.client.profile.eco.ships.find(s => s.kind === 'raft')?.hold?.goods?.hierro === 1,
    null, { timeout: 30000 });
    entity = await page.evaluate(() => window.__mn.client.youServer);
    const afterReentry = await state(page);
    check(afterReentry.gold === result.initialGold && afterReentry.shipRev === afterBuild.shipRev &&
      JSON.stringify(afterReentry.parts) === JSON.stringify(afterBuild.parts) && JSON.stringify(afterReentry.pack) === JSON.stringify(afterBuild.pack) &&
      JSON.stringify(afterReentry.hold) === JSON.stringify(afterBuild.hold), `signed guest reentry changed capacity fixture or edited plan: ${JSON.stringify({ afterBuild, afterReentry })}`);
    result.reentry = { profileAndBlueprintRestored: true, state: afterReentry };
    await page.evaluate(() => {
      const client = window.__mn.client, onSnapshot = client.onSnapshot.bind(client);
      window.__qaNavalEvents = []; window.__qaSnapshots = [];
      client.bus.on('navalPilot', (event) => window.__qaNavalEvents.push({ ...event }));
      client.onSnapshot = (snapshot) => {
        window.__qaSnapshots.push({ tick: snapshot.tick, naval: snapshot.naval ? structuredClone(snapshot.naval) : null,
          deck: snapshot.deck ? { active: snapshot.deck.active, epoch: snapshot.deck.epoch, tick: snapshot.deck.tick } : null,
          voyage: snapshot.voyage ? { ...snapshot.voyage } : null, capacityMode: snapshot.capacity?.mode ?? null,
          before: { lastSnapshotTick: client.lastSnapshotTick, navalEpoch: client.naval.epoch, navalActive: client.naval.active,
            authorityTick: client.naval.authorityTick } });
        if (window.__qaSnapshots.length > 5) window.__qaSnapshots.shift();
        return onSnapshot(snapshot);
      };
    });

    const helm = placeOwnerAtHelm(host, entity);
    await snapCameraToPlayer(page, helm.point);
    await page.waitForFunction(() => window.__mn?.input?.enabled && !window.__mn?.st?.paused, null, { timeout: 15000 });
    await page.waitForFunction(({ x, z }) => { const m = window.__mn, p = m?.client?.cur; return p && Math.hypot(p.x - x, p.z - z) < .8 &&
      m.navigation.interaction()?.prompt?.includes('iniciar travesía'); }, { x: helm.point.x, z: helm.point.z }, { timeout: 20000 });
    if (spec.touch) await page.waitForFunction(() => { const b = document.querySelector('.ln-prompt [data-run]'); return b && b.getBoundingClientRect().width > 0; }, null, { timeout: 12000 });
    if (spec.touch) await page.locator('.ln-prompt [data-run]').click({ force: true }); else await page.keyboard.press('f');
    await page.waitForFunction(() => window.__mn?.client?.naval?.active && window.__mn?.client?.voyage?.active, null, { timeout: 25000 });
    await page.waitForFunction(() => window.__mn.client.capacity?.mode === 'sailing', null, { timeout: 15000 });
    await page.waitForFunction((touch) => { const root = window.__mn.navigation.root;
      const load = root.querySelector('[data-touch-load]'), r = load?.getBoundingClientRect();
      return !root.hidden && load && r?.width > 0 && r.height > 0 && /Porte libre|Exceso/.test(load.textContent); }, spec.touch, { timeout: 15000 });
    const sailingCapacity = await page.evaluate((touch) => { const m = window.__mn, root = m.navigation.root;
      const load = root.querySelector('[data-touch-load]'), rect = load?.getBoundingClientRect();
      const gauge = document.querySelector('.naval-touch-gauge');
      return { capacity: m.client.capacity ? { ...m.client.capacity } : null, loadText: load?.textContent || '', mode: m.client.capacity?.mode,
        loadRect: rect && { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        hudVisible: !root.hidden && !!gauge?.getBoundingClientRect().width, viewportTouch: touch }; }, spec.touch);
    const expectedSailing = ownerRaftCapacity(world, entity);
    check(sailingCapacity.mode === 'sailing' && sailingCapacity.hudVisible && /Porte libre|Exceso/.test(sailingCapacity.loadText) &&
      (spec.touch || /uV/.test(sailingCapacity.loadText)),
      `live naval HUD did not show capacity and hold volume: ${JSON.stringify(sailingCapacity)}`);
    check(JSON.stringify(capCompact(sailingCapacity.capacity)) === JSON.stringify(capCompact(expectedSailing)),
      `live naval capacity disagrees with server-derived rig: ${JSON.stringify({ actual: capCompact(sailingCapacity.capacity), expected: capCompact(expectedSailing) })}`);
    result.navalHud = { ...sailingCapacity, authoritativeCapacity: capCompact(expectedSailing) };
    await shot(page, result, '03-sailing-capacity-hud');
    check(result.errors.length === 0 && result.consoleErrors.length === 0, `browser errors: ${JSON.stringify({ errors: result.errors, console: result.consoleErrors })}`);
    result.status = 'passed';
    await context.close(); context = null;
  } catch (error) {
    result.status = 'failed'; result.failure = String(error?.stack || error); evidence.failures.push(`${spec.name}: ${error?.message || error}`);
    const failedEntity = [...host.game.server.clients.values()].find((c) => c.entity)?.entity;
    result.hostDebug = { status: host.game.status(), clients: [...host.game.server.clients].map(([id, c]) => ({ id, entity: c.entity })),
      tick: host.game.server.world.tick, pilot: failedEntity && host.game.server.world.navalPilot?.snapshot(failedEntity),
      voyage: failedEntity && host.game.server.world.navalPilot?.voyageSnapshot?.(failedEntity),
      raft: failedEntity && [...host.game.server.world.rafts.values()].find((r) => r.owner === failedEntity)?.ship?.id };
    try { const page = context?.pages()[0]; if (page) { result.browserDebug = await page.evaluate(() => ({ joined: window.__mn?.client?.joined,
      mode: window.__mn?.st?.mode, transport: window.__mn?.transport?.ws?.readyState, capacity: window.__mn?.client?.capacity,
      errorCount: window.__mn?.errors?.length, panel: window.__mn?.panels?.commercePanel?.active, editor: window.__mn?.panels?.raftEditor?.active,
      entity: window.__mn?.client?.youServer, inputEnabled: window.__mn?.input?.enabled, paused: window.__mn?.st?.paused,
      current: window.__mn?.client?.cur && { x: window.__mn.client.cur.x, y: window.__mn.client.cur.y, z: window.__mn.client.cur.z },
      interaction: window.__mn?.navigation?.interaction?.(), naval: window.__mn?.client?.naval?.active,
      voyage: window.__mn?.client?.voyage && { ...window.__mn.client.voyage }, prompt: document.querySelector('.ln-prompt')?.textContent,
      hotkeys: window.__mn?.input?.hotkeys?.size, buildContext: window.__mn?.input?.buildContext,
      navalEvents: window.__qaNavalEvents || [], snapshots: window.__qaSnapshots || [],
      clientNaval: window.__mn?.client?.naval && { active: window.__mn.client.naval.active, epoch: window.__mn.client.naval.epoch,
        authorityTick: window.__mn.client.naval.authorityTick, shipId: window.__mn.client.naval.shipId },
      clientVoyage: window.__mn?.client?.voyage && { active: window.__mn.client.voyage.active, phase: window.__mn.client.voyage.phase },
      lastSnapshotTick: window.__mn?.client?.lastSnapshotTick, mapSeed: window.__mn?.client?.map?.seed,
      navalMapSeed: window.__mn?.client?.naval?.map?.seed, ackCoastSeed: window.__qaNavalEvents?.at(-1)?.coast?.seed }));
      const file = resolve(out, `${spec.name}-failure.png`); await page.screenshot({ path: file, fullPage: false }); result.screenshots.push(file); } } catch {}
  } finally {
    if (context) await context.close().catch(() => {});
    await host.close();
  }
}

try {
  const selected = process.env.MN_RAFT_CAPACITY_VIEWPORT ? specs.filter((spec) => spec.name === process.env.MN_RAFT_CAPACITY_VIEWPORT) : specs;
  check(selected.length > 0, 'MN_RAFT_CAPACITY_VIEWPORT did not match a configured viewport');
  for (const spec of selected) await run(spec);
} finally { await browser.close(); }
evidence.finishedAt = new Date().toISOString();
evidence.status = evidence.failures.length ? 'failed' : 'passed';
const filename = process.env.MN_RAFT_CAPACITY_VIEWPORT ? `${process.env.MN_RAFT_CAPACITY_VIEWPORT}.json` : 'raft-capacity-evidence.json';
await writeFile(resolve(out, filename), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: evidence.status, viewports: evidence.viewports.map(({ name, status, failure, screenshots }) => ({ name, status, failure, screenshots })), output: resolve(out, filename) }, null, 2));
if (evidence.status !== 'passed') process.exitCode = 1;

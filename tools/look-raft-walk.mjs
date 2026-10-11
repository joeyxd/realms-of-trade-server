// Bounded visual QA for D04 P2 walkable-raft surfaces. Each run covers one viewport (desktop or PHONE=1).
// The starter witness and walk fixture use isolated normal local Worker contexts; movement uses real UI input.
// Visual evidence is software QA only and makes no FPS or physical-device claim.
// env: OUT, PHONE=1, Q=high|low, VW, VH, DPR, TOD, ROOT, MN_PLAYWRIGHT, MN_BROWSER, MN_LIBS, MN_THREE, MN_GSAP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try {
  ({ chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.ROOT || path.join(scriptDir, '..'));
const phone = ['1', 'true', 'yes'].includes(String(process.env.PHONE || '').toLowerCase());
const quality = process.env.Q || 'high';
const tod = process.env.TOD || 'day';
const width = +(process.env.VW || (phone ? 844 : 1280));
const height = +(process.env.VH || (phone ? 390 : 720));
const dpr = +(process.env.DPR || 1);
const out = path.resolve(process.env.OUT || path.join(root, 'shots', 'review', 'raft-walk', `${quality}-${tod}-${phone ? 'phone' : 'desktop'}`));
const timeouts = { boot: 180000, join: 90000, snapshot: 60000, move: 18000, save: 30000 };
fs.mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const pageDiagnostics = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashFile = (file) => {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};
const localRelative = (file) => path.relative(root, file).split(path.sep).join('/');
const expectedTextureSrc = `textures/raft/comic-materials-v1${phone ? '-mobile' : ''}.webp`;
const fixtureParts = [
  ...Array.from({ length: 3 }, (_, x) => [-1, 0, 1].map((z) => ['foundation', x, z, 0])).flat(),
  ['sail', 0, -1, 0, 0], ['crate', 2, 1, 0, 0], ['stairs', 1, 0, 0, 0],
  ['pillar', 1, 1, 0, 0], ['floor', 1, 1, 1, 0], ['railing', 1, 1, 1, 2],
  ['wall', 0, 0, 0, 3], ['door', 0, -1, 0, 0],
];

let browser;
const contexts = [];
let closeServer;
const evidence = {
  schemaVersion: 1,
  purpose: 'D04 P2 walkability visual/software QA; one desktop or mobile-emulated case per execution.',
  base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: true,
  viewport: { width, height, dpr, phone, quality, tod },
  transportExpectation: 'Local WorkerTransport only; no online server.',
  input: { desktop: 'Playwright keyboard WASD/Space through Input key handlers', mobile: 'Playwright pointer drag over .joy-zone and touch Dash button', positionInjection: 'one debug teleport to dock before traversal only' },
  fixture: { constructedByGameNewProfile: false, passedThroughGameSanitizeRaft: false, savedBeforeJoin: false, parts: fixtureParts },
  expectedTextureSrc,
  atlas: null,
  starterWitness: null,
  dockTeleport: null,
  steps: [],
  screenshots: [],
  diagnostics: { pageErrors: [], consoleErrors: [], gameErrors: [] },
  softwareQA: { visualOnly: true, fpsOrHardwareClaim: false, physicalDeviceTest: false, humanAcceptanceClaim: false },
  renderScheduling: 'Fixed input, frame updates and Worker remain active; GPU draw occurs at screenshots to keep SwiftShader from dropping input pulses.',
};

async function configurePage(context) {
  const page = await context.newPage();
  const diag = { page, pageErrors: [], consoleErrors: [], textureRequests: [] };
  pageDiagnostics.push(diag);
  page.on('pageerror', (error) => diag.pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') diag.consoleErrors.push(message.text().slice(0, 300)); });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/assets\/textures\/raft\/comic-materials-v1.*\.webp$/.test(pathname)) diag.textureRequests.push(pathname);
  });
  const libs = process.env.MN_LIBS;
  const local = { 'three@0.160.0': 'three-0.160.0/package', 'gsap@3.12.5': 'gsap-3.12.5/package' };
  if (libs || process.env.MN_THREE) await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const packageDir = match[1] === 'three@0.160.0' ? process.env.MN_THREE : process.env.MN_GSAP;
    if (!packageDir && !libs) return route.continue();
    const file = packageDir ? path.join(packageDir, match[2]) : path.join(libs, local[match[1]], match[2]);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
  return diag;
}

async function bootAtTitle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: timeouts.boot });
}

async function joinWorker(page) {
  await page.click('#btn-play', { force: true });
  await page.waitForFunction(() => window.__mn?.client?.joined && !window.__mn.client.awaitingFirst && window.__mn.st.mode === 'playing', null, { timeout: timeouts.join });
  await page.waitForFunction(() => {
    const m = window.__mn;
    return m?.transport?.kind === 'worker' && !m.st.online && Array.isArray(m.client.pred.rafts)
      && m.client.pred.rafts.length === 1 && m.world.rafts?.views?.size === 1;
  }, null, { timeout: timeouts.snapshot });
  return page.evaluate(() => {
    const m = window.__mn, r = m.client.pred.rafts[0], g = m.client.pred.raftDeck.entries.get(String(r.id));
    return { transport: m.transport.kind, online: m.st.online, parts: r.parts.map((p) => [...p]),
      raftDeckY: r.y, yaw: r.yaw, gangplank: g?.plank ? { ...g.plank } : null,
      raftCount: m.client.pred.rafts.length, viewCount: m.world.rafts.views.size };
  });
}

async function makeLocalFixture(page) {
  return page.evaluate(async (parts) => {
    const [{ GAME }, { newProfile }, { sanitizeRaft, raftStats }] = await Promise.all([
      import('./src/data/meta.js'), import('./src/sim/systems/inventory.js'), import('./src/sim/economy/raft.js'),
    ]);
    const profile = newProfile();
    const raft = profile.eco.ships.find((ship) => ship.kind === 'raft');
    if (!raft) throw new Error('newProfile did not create the expected starter raft');
    raft.grid = sanitizeRaft({ parts });
    raft.hold.cap = raftStats(raft.grid).hold;
    raft.id = ''; raft.rev = 1; raft.berth = -1; raft.at = 'aldea'; raft.hp = 1;
    if (raft.grid.parts.length !== parts.length) throw new Error(`sanitizeRaft kept ${raft.grid.parts.length}/${parts.length} fixture pieces`);
    const saveKey = `${GAME.saveKey}.save.solo`;
    localStorage.setItem(saveKey, JSON.stringify(profile));
    const stored = JSON.parse(localStorage.getItem(saveKey));
    return { saveKey, profileVersion: stored.v, shipCount: stored.eco?.ships?.length,
      savedParts: stored.eco.ships[0].grid.parts.map((p) => [...p]), fixtureParts: raft.grid.parts.map((p) => [...p]) };
  }, fixtureParts);
}

async function stateOf(page) {
  return page.evaluate(async () => {
    const { tuning } = await import('./src/data/tuning.js');
    const m = window.__mn, client = m.client, local = client.youLocal, ecs = client.pred.ecs;
    const x = ecs.x[local], y = ecs.y[local], z = ecs.z[local], rec = client.entities.get(client.youServer);
    const server = rec?.serverState;
    const atlasEntry = m.assets.list().find((a) => a.id === 'tex:raft-comic-v1') || null;
    const atlas = m.assets.texture('tex:raft-comic-v1');
    const image = atlas?.image || atlas?.source?.data || null;
    const surface = client.pred.raftDeck.surface(x, z, y);
    return { mode: m.st.mode, transport: m.transport.kind, online: m.st.online,
      pred: { x, y, z }, server: server ? { x: server[2], y: server[3], z: server[4] } : null,
      render: { x: client.cur.x, y: client.cur.y, z: client.cur.z }, predErr: client.stats.predErr,
      seq: client.seq, ack: client.ackSeq, snapshotTick: client.lastSnapshotTick,
      surface: surface ? { kind: surface.kind, y: surface.y, idPresent: !!surface.id } : null,
      onDock: m.map.onDock(x, z), waterDepth: tuning.world.waterLevel - m.map.groundAt(x, z),
      atlasEntry, atlasImage: image ? { width: image.width || null, height: image.height || null } : null,
      textureRequests: [], gameErrors: [...(m.errors || [])] };
  });
}

async function screenshot(page, name, diag) {
  await page.evaluate(() => { const m = window.__mn; m.world.pipeline.markDirty(); (m.__walkDraw || m.world.render.bind(m.world))(); });
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  const image = { name, path: localRelative(file), ...hashFile(file) };
  evidence.screenshots.push(image);
  const state = await stateOf(page);
  evidence.steps.push({ name, player: { pred: state.pred, server: state.server, render: state.render },
    predErr: state.predErr, ack: state.ack, snapshotTick: state.snapshotTick, surface: state.surface,
    onDock: state.onDock, waterDepth: state.waterDepth, screenshot: image.path });
  state.textureRequests = diag.textureRequests;
  if (!evidence.atlas) evidence.atlas = { registry: state.atlasEntry, image: state.atlasImage, requestURLs: [...diag.textureRequests] };
  return { image, state };
}

async function positionAndCamera(page) {
  return page.evaluate(async () => {
    const THREE = await import('three'), m = window.__mn, record = m.client.pred.rafts[0];
    const plank = m.client.pred.raftDeck.entries.get(String(record.id))?.plank;
    if (!plank) throw new Error('P1 starter has no connected gangplank');
    const view = m.world.rafts.views.get(String(record.id));
    const focus = new THREE.Vector3(plank.x, plank.y + 0.4, plank.z);
    // Camera-only composition; the player and public raft records remain untouched.
    m.loop.running = false;
    m.world.nearFade(false);
    m.world.rig.blend = null; m.world.rig.snapTo(focus);
    m.world.rig.dist = m.world.rig.distTarget = 14;
    m.world.rig.update(0, focus, null, m.loop.timeScale);
    return { gangplank: { ...plank }, parts: record.parts.map((p) => [...p]),
      meshGangplank: !!view?.gangplank, recordUnchanged: m.client.pred.rafts[0] === record };
  });
}

function worldPoint(record, lx, lz) {
  const c = Math.cos(record.yaw), s = Math.sin(record.yaw);
  return { x: record.x + c * lx + s * lz, z: record.z - s * lx + c * lz };
}

async function currentMoveAxes(page, target) {
  return page.evaluate((targetPoint) => {
    const m = window.__mn, client = m.client, e = client.youLocal, ecs = client.pred.ecs;
    const dx = targetPoint.x - ecs.x[e], dz = targetPoint.z - ecs.z[e], d = Math.hypot(dx, dz);
    const yaw = m.world.rig.yawTarget, c = Math.cos(yaw), s = Math.sin(yaw);
    const ix = c * dx / Math.max(d, 1e-6) - s * dz / Math.max(d, 1e-6);
    const iy = -s * dx / Math.max(d, 1e-6) - c * dz / Math.max(d, 1e-6);
    return { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e], distance: d, ix, iy };
  }, target);
}

function keyCodesFor(ix, iy) {
  const keys = [];
  if (ix < -0.18) keys.push('KeyA'); else if (ix > 0.18) keys.push('KeyD');
  if (iy < -0.18) keys.push('KeyS'); else if (iy > 0.18) keys.push('KeyW');
  return keys;
}

async function inputPulse(page, axes) {
  if (!axes.distance || axes.distance < 0.05) return;
  if (phone) {
    const zone = page.locator('#touch .joy-zone');
    const box = await zone.boundingBox();
    if (!box) throw new Error('Mobile joystick zone is not visible');
    const ox = box.x + box.width * 0.28, oy = box.y + box.height * 0.55;
    const l = Math.hypot(axes.ix, axes.iy) || 1;
    // Slow the real analog stick near a waypoint; full pulses can oscillate around it in software QA.
    const stickDistance = 46 * Math.min(1, Math.max(0.32, axes.distance / 2));
    await page.mouse.move(ox, oy); await page.mouse.down();
    await page.mouse.move(ox + axes.ix / l * stickDistance, oy - axes.iy / l * stickDistance, { steps: 2 });
    await page.waitForTimeout(Math.min(140, Math.max(50, axes.distance * 95))); await page.mouse.up();
  } else {
    const keys = keyCodesFor(axes.ix, axes.iy);
    if (!keys.length) return;
    try {
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(140);
    } finally { for (const key of keys) await page.keyboard.up(key); }
  }
  await page.waitForTimeout(80);
}

async function walkToward(page, target, label, { maxMs = timeouts.move, tolerance = 0.42, allowBlocked = false } = {}) {
  const started = Date.now(); let last = null, stagnant = 0;
  while (Date.now() - started < maxMs) {
    const axes = await currentMoveAxes(page, target);
    if (axes.distance <= tolerance) return { reached: true, ...axes };
    if (last && Math.hypot(axes.x - last.x, axes.z - last.z) < 0.025) stagnant++; else stagnant = 0;
    if (stagnant >= 7) break;
    last = axes;
    await inputPulse(page, axes);
  }
  const final = await currentMoveAxes(page, target);
  if (!allowBlocked) throw new Error(`${label} did not reach target (remaining ${final.distance.toFixed(2)} u): ${JSON.stringify(final)}`);
  return { reached: final.distance <= tolerance, ...final };
}

async function dashToward(page, target) {
  const axes = await currentMoveAxes(page, target);
  if (phone) {
    await inputPulse(page, axes);
    await page.locator('#touch .t-dash').click();
    await page.waitForTimeout(750);
    return { before: { x: axes.x, y: axes.y, z: axes.z }, after: await currentMoveAxes(page, target) };
  }
  const keys = keyCodesFor(axes.ix, axes.iy);
  try {
    for (const key of keys) await page.keyboard.down(key);
    if (phone) await page.locator('#touch .t-dash').click();
    else await page.keyboard.press('Space');
    await page.waitForTimeout(180);
  } finally { for (const key of keys) await page.keyboard.up(key); }
  await page.waitForTimeout(750);
  return { before: { x: axes.x, y: axes.y, z: axes.z }, after: await currentMoveAxes(page, target) };
}

async function waitForSave(page, saveKey, expectedParts) {
  await page.waitForFunction(({ key, expectedParts }) => {
    try { const p = JSON.parse(localStorage.getItem(key) || 'null'); return p?.eco?.ships?.[0]?.grid?.parts?.length === expectedParts; }
    catch { return false; }
  }, { key: saveKey, expectedParts }, { timeout: timeouts.save });
}

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  browser = await chromium.launch({
    ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const contextOptions = { viewport: { width, height }, deviceScaleFactor: dpr, ...(phone ? { isMobile: true, hasTouch: true } : {}) };
  const url = `http://127.0.0.1:${server.address().port}/?${new URLSearchParams({ q: quality, debug: '', maxdt: '0.5', tod })}`;

  // Witness the ordinary newly joined P1 starter first; this context is isolated from the fixture save below.
  const starterContext = await browser.newContext(contextOptions); contexts.push(starterContext);
  const starterDiag = await configurePage(starterContext);
  await bootAtTitle(starterDiag.page, url);
  const starter = await joinWorker(starterDiag.page);
  if (starter.transport !== 'worker' || starter.online || !starter.gangplank || starter.parts.filter((p) => p[0] === 'foundation').length !== 4) {
    throw new Error(`Expected a normal P1 2x2 starter and its real gangplank: ${JSON.stringify(starter)}`);
  }
  evidence.starterWitness = { transport: starter.transport, online: starter.online, foundationCount: 4,
    gangplank: starter.gangplank, screenshot: null, cameraOnlyComposition: true };
  const witness = await positionAndCamera(starterDiag.page);
  await starterDiag.page.evaluate(() => window.__mn.world.render());
  const starterShot = path.join(out, 'starter-current-gangplank.png');
  await starterDiag.page.screenshot({ path: starterShot });
  evidence.starterWitness.screenshot = localRelative(starterShot);
  evidence.screenshots.push({ name: 'starter-current-gangplank', path: localRelative(starterShot), ...hashFile(starterShot) });
  if (!witness.meshGangplank || !witness.recordUnchanged) throw new Error('Starter gangplank witness failed without modifying its public record');
  await starterContext.close();

  // A second fresh isolated context receives only a locally-generated profile save; no global/online profile is changed.
  const fixtureContext = await browser.newContext(contextOptions); contexts.push(fixtureContext);
  const fixtureDiag = await configurePage(fixtureContext);
  await bootAtTitle(fixtureDiag.page, url);
  const fixture = await makeLocalFixture(fixtureDiag.page);
  evidence.fixture = { constructedByGameNewProfile: true, passedThroughGameSanitizeRaft: true, savedBeforeJoin: true,
    profileVersion: fixture.profileVersion, localSaveKey: fixture.saveKey, shipCount: fixture.shipCount,
    partCount: fixture.savedParts.length, parts: fixture.fixtureParts };
  // Title bootstrap caches the selected solo save; reload it after creating the isolated fixture.
  await bootAtTitle(fixtureDiag.page, url);
  await fixtureDiag.page.click('#btn-play', { force: true });
  await fixtureDiag.page.waitForFunction(() => window.__mn?.client?.joined && !window.__mn.client.awaitingFirst && window.__mn.st.mode === 'playing', null, { timeout: timeouts.join });
  await fixtureDiag.page.waitForFunction(() => {
    const m = window.__mn;
    return m?.transport?.kind === 'worker' && !m.st.online && Array.isArray(m.client.pred.rafts)
      && m.client.pred.rafts.length === 1 && m.world.rafts?.views?.size === 1;
  }, null, { timeout: timeouts.snapshot });
  await waitForSave(fixtureDiag.page, fixture.saveKey, fixtureParts.length);
  const loadedFixture = await fixtureDiag.page.evaluate(() => {
    const m = window.__mn, r = m.client.pred.rafts[0], e = m.client.youLocal, ecs = m.client.pred.ecs;
    const asset = m.assets.list().find((x) => x.id === 'tex:raft-comic-v1') || null;
    const texture = m.assets.texture('tex:raft-comic-v1'), image = texture?.image || texture?.source?.data;
    return { transport: m.transport.kind, online: m.st.online, recordParts: r.parts.map((p) => [...p]),
      player: { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] },
      registry: asset, atlasImage: image ? { width: image.width || null, height: image.height || null } : null,
      worldDock: { base: { ...m.map.dock.base }, end: { ...m.map.dock.end }, dir: { ...m.map.dock.dir }, len: m.map.dock.len, halfWidth: m.map.dock.halfWidth, deckY: m.map.dock.deckY },
      record: { x: r.x, y: r.y, z: r.z, yaw: r.yaw }, gangplank: m.client.pred.raftDeck.entries.get(String(r.id))?.plank || null,
      predErr: m.client.stats.predErr, gameErrors: [...(m.errors || [])] };
  });
  const partKey = (parts) => parts.map((p) => JSON.stringify(p)).sort().join('|');
  if (loadedFixture.transport !== 'worker' || loadedFixture.online || partKey(loadedFixture.recordParts) !== partKey(fixture.savedParts)) {
    throw new Error('Normal Worker did not restore the sanitized controlled fixture unchanged');
  }
  if (!loadedFixture.gangplank) throw new Error('Controlled fixture did not receive the connected dock gangplank');
  await fixtureDiag.page.evaluate(() => {
    const m = window.__mn;
    m.__walkDraw = m.world.render.bind(m.world);
    m.world.render = () => {};
    m.world.nearFade(false);
    m.world.rig.blend = null;
    m.world.rig.dist = m.world.rig.distTarget = 14;
  });
  evidence.atlas = { registry: loadedFixture.registry, image: loadedFixture.atlasImage, expectedTextureSrc,
    requestURLs: fixtureDiag.textureRequests };
  const expectedAtlasSize = phone ? 512 : 1024;
  if (loadedFixture.registry?.state !== 'ok' || loadedFixture.registry.selectedSrc !== expectedTextureSrc
      || loadedFixture.atlasImage?.width !== expectedAtlasSize || loadedFixture.atlasImage?.height !== expectedAtlasSize) {
    throw new Error(`Expected loaded ${expectedTextureSrc} (${expectedAtlasSize}x${expectedAtlasSize}), got ${JSON.stringify(evidence.atlas)}`);
  }
  const record = loadedFixture.record;
  const plank = loadedFixture.gangplank;
  const fwd = { x: Math.sin(plank.yaw), z: Math.cos(plank.yaw) };
  const dockStart = { x: plank.x - fwd.x * (plank.length / 2 + 0.75), z: plank.z - fwd.z * (plank.length / 2 + 0.75) };
  const dockCheck = await fixtureDiag.page.evaluate((p) => ({ onDock: window.__mn.map.onDock(p.x, p.z), ground: window.__mn.map.groundAt(p.x, p.z) }), dockStart);
  if (!dockCheck.onDock) throw new Error(`Initial permitted dock teleport target is not on the dock: ${JSON.stringify({ dockStart, dockCheck })}`);
  await fixtureDiag.page.evaluate((p) => window.__mn.teleport(p.x, p.z), dockStart);
  await fixtureDiag.page.waitForFunction((p) => {
    const m = window.__mn, e = m.client.youLocal, ecs = m.client.pred.ecs;
    return Math.hypot(ecs.x[e] - p.x, ecs.z[e] - p.z) < 0.7 && Math.abs(ecs.y[e] - m.map.dock.deckY) < 0.65;
  }, dockStart, { timeout: timeouts.snapshot });
  evidence.dockTeleport = { onlyTeleportUsed: true, target: dockStart, targetOnDock: dockCheck.onDock,
    postTeleport: await stateOf(fixtureDiag.page) };
  await screenshot(fixtureDiag.page, 'before-entry-on-dock', fixtureDiag);

  const localToWorld = (x, z) => worldPoint(record, x, z);
  const plankCenter = { x: plank.x, z: plank.z };
  const plankEnd = { x: plank.x + fwd.x * (plank.length / 2 - 0.2), z: plank.z + fwd.z * (plank.length / 2 - 0.2) };
  const localEnd = (() => { const dx = plankEnd.x - record.x, dz = plankEnd.z - record.z, c = Math.cos(record.yaw), s = Math.sin(record.yaw); return { x: c * dx - s * dz, z: s * dx + c * dz }; })();
  const entryCell = { x: Math.max(0, Math.min(2, Math.floor(localEnd.x / 2))), z: Math.max(-1, Math.min(1, Math.floor(localEnd.z / 2))) };
  const entry = localToWorld(entryCell.x * 2 + 1, entryCell.z * 2 + 1);
  const movePlank = await walkToward(fixtureDiag.page, plankCenter, 'dock-to-gangplank');
  evidence.steps.push({ name: 'walk-dock-to-gangplank', result: movePlank, after: await stateOf(fixtureDiag.page) });
  await screenshot(fixtureDiag.page, 'on-gangplank', fixtureDiag);
  const moveDeck = await walkToward(fixtureDiag.page, entry, 'gangplank-to-deck');
  evidence.steps.push({ name: 'walk-gangplank-to-deck', result: moveDeck, after: await stateOf(fixtureDiag.page) });
  await screenshot(fixtureDiag.page, 'on-raft-deck', fixtureDiag);

  await walkToward(fixtureDiag.page, localToWorld(5, -1), 'clear-stair-side');
  const stairBottom = localToWorld(3, -1);
  const stairTop = localToWorld(3, 2.8);
  const upstairs = localToWorld(3, 3);
  await walkToward(fixtureDiag.page, stairBottom, 'approach-stairs');
  await screenshot(fixtureDiag.page, 'stairs-lower-landing', fixtureDiag);
  const ascend = await walkToward(fixtureDiag.page, upstairs, 'ascend-stairs');
  const upperState = await stateOf(fixtureDiag.page);
  evidence.steps.push({ name: 'ascend-stairs', target: upstairs, result: ascend, after: upperState });
  if (upperState.pred.y < record.y + 1.8) throw new Error(`Player did not reach upper floor height: ${JSON.stringify(upperState)}`);
  await screenshot(fixtureDiag.page, 'upstairs', fixtureDiag);
  await walkToward(fixtureDiag.page, stairTop, 'upper-stair-landing');
  const descend = await walkToward(fixtureDiag.page, stairBottom, 'descend-stairs');
  const lowerState = await stateOf(fixtureDiag.page);
  evidence.steps.push({ name: 'descend-stairs', target: stairBottom, result: descend, after: lowerState });
  if (lowerState.pred.y > record.y + 0.65) throw new Error(`Player did not return to main deck height: ${JSON.stringify(lowerState)}`);
  await walkToward(fixtureDiag.page, localToWorld(5, -1), 'clear-stair-side-on-return');
  await walkToward(fixtureDiag.page, entry, 'return-to-gangplank');
  await walkToward(fixtureDiag.page, dockStart, 'return-to-dock');
  await screenshot(fixtureDiag.page, 'back-on-dock', fixtureDiag);

  // Return aboard, then test the wall and deep-water gap with actual movement/dash inputs.
  await walkToward(fixtureDiag.page, entry, 'reenter-for-blocker-tests');
  await walkToward(fixtureDiag.page, localToWorld(5, -1), 'clear-stairs-for-wall');
  await walkToward(fixtureDiag.page, localToWorld(1, -1), 'approach-wall-corridor');
  await walkToward(fixtureDiag.page, localToWorld(1, 1), 'enter-wall-corridor');
  const wallInside = localToWorld(0.62, 1);
  await walkToward(fixtureDiag.page, wallInside, 'approach-west-wall');
  const wallOutside = localToWorld(-1.4, 1);
  const wallBefore = await stateOf(fixtureDiag.page);
  const wallAttempt = await walkToward(fixtureDiag.page, wallOutside, 'wall-block', { maxMs: 2200, tolerance: 0.42, allowBlocked: true });
  const wallAfter = await stateOf(fixtureDiag.page);
  evidence.steps.push({ name: 'wall-block', start: wallBefore.pred, expectedBlockedTarget: wallOutside, movement: wallAttempt, after: wallAfter });
  if (Math.hypot(wallAfter.pred.x - wallBefore.pred.x, wallAfter.pred.z - wallBefore.pred.z) > 1.1) throw new Error('Wall attempt moved implausibly through the wall');
  await screenshot(fixtureDiag.page, 'wall-block', fixtureDiag);

  await walkToward(fixtureDiag.page, localToWorld(1, -1), 'leave-wall-corridor');
  await walkToward(fixtureDiag.page, localToWorld(5, -1), 'clear-stairs-for-water');
  await walkToward(fixtureDiag.page, localToWorld(5.25, 1), 'approach-open-water-edge');
  const edgeState = await stateOf(fixtureDiag.page);
  const waterTarget = await fixtureDiag.page.evaluate(async () => {
    const { tuning } = await import('./src/data/tuning.js');
    const m = window.__mn, r = m.client.pred.rafts[0], c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const candidates = [
      { name: 'east', lx: 7.5, lz: 1, vx: c, vz: -s },
      { name: 'far', lx: 3, lz: 5.5, vx: s, vz: c }, { name: 'near', lx: 3, lz: -2.5, vx: -s, vz: -c },
    ].map((p) => {
      const x = r.x + c * p.lx + s * p.lz, z = r.z - s * p.lx + c * p.lz;
      return { ...p, x, z, depth: tuning.world.waterLevel - m.map.groundAt(x, z), hasSurface: !!m.client.pred.raftDeck.surface(x, z, r.y), blocked: m.client.pred.raftDeck.blocked(x, z, r.y, 0.36) };
    });
    return candidates.filter((p) => !p.hasSurface && !p.blocked && p.depth > tuning.world.wadeMax).sort((a, b) => b.depth - a.depth)[0] || null;
  });
  if (!waterTarget) throw new Error('Could not find a clear deep-water edge target for the dash/gap case');
  const gapStart = localToWorld(waterTarget.name === 'east' ? 5.25 : 3,
    waterTarget.name === 'far' ? 3.2 : waterTarget.name === 'near' ? -1.2 : 1);
  if (waterTarget.name === 'far') await walkToward(fixtureDiag.page, localToWorld(5, 3), 'clear-stairs-at-far-edge');
  if (waterTarget.name === 'near') await walkToward(fixtureDiag.page, localToWorld(5, -1), 'clear-stairs-at-near-edge');
  await walkToward(fixtureDiag.page, gapStart, 'position-at-open-water-edge');
  const edgeBefore = await stateOf(fixtureDiag.page);
  const dash = await dashToward(fixtureDiag.page, { x: waterTarget.x, z: waterTarget.z });
  const edgeAfter = await stateOf(fixtureDiag.page);
  evidence.steps.push({ name: 'gap-dash', edgeBefore, waterTarget: { name: waterTarget.name, x: waterTarget.x, z: waterTarget.z, depth: waterTarget.depth }, dash, after: edgeAfter });
  if (!edgeAfter.surface) throw new Error(`Dash left the raft into the water gap: ${JSON.stringify(edgeAfter)}`);
  await screenshot(fixtureDiag.page, 'gap-dash-block', fixtureDiag);

  await waitForSave(fixtureDiag.page, fixture.saveKey, fixtureParts.length);
  const final = await fixtureDiag.page.evaluate((key) => {
    const m = window.__mn, e = m.client.youLocal, ecs = m.client.pred.ecs;
    const profile = JSON.parse(localStorage.getItem(key));
    const raft = profile.eco.ships.find((s) => s.kind === 'raft');
    return { player: { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] }, profileParts: raft.grid.parts.map((p) => [...p]),
      publicParts: m.client.pred.rafts[0].parts.map((p) => [...p]), holdCap: raft.hold.cap,
      predErr: m.client.stats.predErr, ack: m.client.ackSeq, snapshotTick: m.client.lastSnapshotTick,
      server: (() => { const s = m.client.entities.get(m.client.youServer)?.serverState; return s ? { x: s[2], y: s[3], z: s[4] } : null; })(),
      surface: m.client.pred.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e])?.kind || null, errors: [...(m.errors || [])] };
  }, fixture.saveKey);
  if (partKey(final.profileParts) !== partKey(fixture.savedParts) || partKey(final.publicParts) !== partKey(fixture.savedParts)) {
    throw new Error('Traversal changed the controlled fixture save or public raft blueprint');
  }
  evidence.final = final;
  evidence.fixture.loadedRecordPartsCount = loadedFixture.recordParts.length;
  evidence.diagnostics.pageErrors = [...starterDiag.pageErrors, ...fixtureDiag.pageErrors];
  evidence.diagnostics.consoleErrors = [...starterDiag.consoleErrors, ...fixtureDiag.consoleErrors];
  evidence.diagnostics.gameErrors = [...new Set([...(starter.gameErrors || []), ...(loadedFixture.gameErrors || []), ...(final.errors || [])])];
  evidence.input.mobileJoystickUsed = phone;
  evidence.input.actualMovementInputsUsed = true;
  evidence.fixture.onlineWorldUntouched = true;
  evidence.fixture.sourceProfileConstructedFresh = true;
  evidence.fixture.saveReusedExistingStorageShape = true;
  evidence.screenshots = evidence.screenshots.map((shot) => ({ ...shot, sha256: shot.sha256, bytes: shot.bytes }));
  fs.writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ out, screenshots: evidence.screenshots.map((s) => s.path), atlas: evidence.atlas,
    finalPlayer: final.player, predErr: final.predErr, pageErrors: evidence.diagnostics.pageErrors.length,
    gameErrors: evidence.diagnostics.gameErrors.length, mobileJoystickUsed: phone }, null, 2));
} catch (error) {
  evidence.diagnostics.pageErrors = pageDiagnostics.flatMap((d) => d.pageErrors);
  evidence.error = error.message;
  const page = contexts.flatMap((c) => c.pages())[0];
  if (page) {
    evidence.failureState = await stateOf(page).catch(() => null);
    await page.evaluate(() => { const m = window.__mn; if (m?.__walkDraw) { m.world.pipeline.markDirty(); m.__walkDraw(); } }).catch(() => {});
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  }
  fs.writeFileSync(path.join(out, 'failure.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  if (browser) await browser.close().catch(() => {});
  if (closeServer) await closeServer();
}

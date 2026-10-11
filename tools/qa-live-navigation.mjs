// Ordinary game acceptance against an isolated memory host. Never loads project .env or production storage.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const out = resolve('docs/delivery/d08c6-live-coastal-loop');
await mkdir(out, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), cases: [] };
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 8, dev: true,
  store: createMemoryStore(), worldId: null, saveSecret: 'isolated-live-navigation-qa', log() {} });
const port = await host.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const waitForMovement = async (page, key, { minDistance = 0.8, timeout = 12000 } = {}) => {
  const start = await page.evaluate(() => ({ x: window.__mn.client.naval.body?.pose.x, z: window.__mn.client.naval.body?.pose.z,
    tick: window.__mn.client.naval.body?.state.tick, ack: window.__mn.client.naval.ack, seq: window.__mn.client.naval.seq }));
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(({ start, minDistance }) => {
      const n = window.__mn?.client?.naval, p = n?.body?.pose;
      return p && Math.hypot(p.x - start.x, p.z - start.z) >= minDistance && n.body.state.tick > start.tick;
    }, { start, minDistance }, { timeout });
  } finally { await page.keyboard.up(key); }
  return page.evaluate(() => ({ pose: window.__mn.client.naval.body?.pose,
    tick: window.__mn.client.naval.body?.state.tick, ack: window.__mn.client.naval.ack, seq: window.__mn.client.naval.seq }));
};
const walkTo = async (page, target, label) => {
  let stalled = 0;
  for (let step = 0; step < 55; step++) {
    const sample = await page.evaluate(() => ({ x: window.__mn.ps.x, z: window.__mn.ps.z,
      yaw: window.__mn.world.rig.yawTarget, enabled: window.__mn.input.enabled,
      mode: window.__mn.st.mode, paused: window.__mn.panels.chatPanel.typing || window.__mn.panels.chatPanel.active }));
    const dx = target.x - sample.x, dz = target.z - sample.z, distance = Math.hypot(dx, dz);
    const tolerance = label === 'helm' ? 0.65 : 1.0;
    if (distance <= tolerance) return { label, steps: step, distance, ...sample };
    check(sample.enabled && sample.mode === 'playing' && !sample.paused, `walking controls blocked before ${label}: ${JSON.stringify(sample)}`);
    const ix = Math.cos(sample.yaw) * dx - Math.sin(sample.yaw) * dz;
    const iy = -Math.sin(sample.yaw) * dx - Math.cos(sample.yaw) * dz;
    const keys = [];
    if (ix > distance * 0.18) keys.push('KeyD'); else if (ix < -distance * 0.18) keys.push('KeyA');
    if (iy > distance * 0.18) keys.push('KeyW'); else if (iy < -distance * 0.18) keys.push('KeyS');
    const before = await page.evaluate(() => ({ x: window.__mn.ps.x, z: window.__mn.ps.z,
      seq: window.__mn.client.seq, tick: window.__mn.client.ptCur }));
    for (const key of keys) await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ before }) => {
        const m = window.__mn, p = m?.ps;
        return p && m.client.seq > before.seq && m.client.ptCur > before.tick && Math.hypot(p.x - before.x, p.z - before.z) >= 0.45;
      }, { before }, { timeout: 8000 });
    } catch { /* Recheck the position below to distinguish slow frames from blocked ground. */ }
    finally { for (const key of keys) await page.keyboard.up(key); }
    const after = await page.evaluate(() => ({ x: window.__mn.ps.x, z: window.__mn.ps.z }));
    stalled = Math.hypot(after.x - before.x, after.z - before.z) < 0.08 ? stalled + 1 : 0;
    if (stalled >= 4) throw new Error(`normal UI walking stalled en route to ${label} after 4 controls (from ${JSON.stringify(before)} toward ${JSON.stringify(target)})`);
  }
  throw new Error(`normal UI walking exceeded 55 controls toward ${label} (target ${JSON.stringify(target)})`);
};
try {
  for (const spec of [{ name: 'desktop', viewport: { width: 1365, height: 768 }, mobile: false },
    { name: 'touch-landscape', viewport: { width: 844, height: 390 }, mobile: true },
    { name: 'touch-portrait', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'fallback', viewport: { width: 1280, height: 720 }, mobile: false, mode: 'fallback' },
    { name: 'worker', viewport: { width: 1280, height: 720 }, mobile: false, mode: 'worker' }]) {
    const record = { ...spec, errors: [], textures: [], status: 'running' }; evidence.cases.push(record);
    const context = await browser.newContext({ viewport: spec.viewport, hasTouch: spec.mobile, isMobile: spec.mobile });
    const page = await context.newPage();
    page.on('pageerror', error => record.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') record.errors.push(message.text()); });
    page.on('request', request => { if (request.url().includes('/assets/textures/raft/')) record.textures.push(new URL(request.url()).pathname); });
    await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
      const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
      const pkg = match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package';
      route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(resolve(pkg, match[2])) });
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, body: '' }));
    try {
      const solo = spec.mode ? `&solo${spec.mode === 'fallback' ? '&worker=0' : ''}` : '';
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low${solo}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client.joined && window.__mn?.st.mode === 'playing', null, { timeout: 60000 });
      await page.waitForFunction(() => window.__mn?.input.enabled && !window.__mn?.st.paused && !window.__mn?.panels.chatPanel.typing,
        null, { timeout: 30000 });
      const id = await page.evaluate(() => window.__mn.client.youServer);
      let raft, point, approachPoints;
      if (spec.mode) {
        ({ raft, point } = await page.evaluate(async () => {
          const m = window.__mn, raft = m.client.pred.rafts.find(r => r.owner === m.client.youServer);
          const { raftGangplank } = await import('/src/sim/raftGeometry.js');
          const point = raft && raftGangplank(raft, m.map.dock), dock = m.map.dock;
          if (!point || !dock) return { raft, point, approachPoints: [] };
          const dx = point.x - dock.base.x, dz = point.z - dock.base.z;
          const along = Math.max(1.5, Math.min(dock.len - 1.5, dx * dock.dir.x + dz * dock.dir.z));
          const centerline = { x: dock.base.x + dock.dir.x * along, z: dock.base.z + dock.dir.z * along };
          return { raft, point, approachPoints: [
            { label: 'dock-base', x: dock.base.x, z: dock.base.z },
            { label: 'dock-centerline', ...centerline },
            { label: 'gangplank', x: point.x, z: point.z },
          ] };
        }));
        record.transport = await page.evaluate(() => window.__mn.transport.kind);
        check(record.transport === (spec.mode === 'worker' ? 'worker' : 'inprocess'), 'solo transport did not match selected mode');
      } else {
        ({ raft, point } = await page.evaluate(async () => {
          const m = window.__mn, raft = m.client.pred.rafts.find(r => r.owner === m.client.youServer);
          const { raftGangplank } = await import('/src/sim/raftGeometry.js');
          const point = raft && raftGangplank(raft, m.map.dock), dock = m.map.dock;
          if (!point || !dock) return { raft, point, approachPoints: [] };
          const dx = point.x - dock.base.x, dz = point.z - dock.base.z;
          const along = Math.max(1.5, Math.min(dock.len - 1.5, dx * dock.dir.x + dz * dock.dir.z));
          return { raft, point, approachPoints: [
            { label: 'dock-base', x: dock.base.x, z: dock.base.z },
            { label: 'dock-centerline', x: dock.base.x + dock.dir.x * along, z: dock.base.z + dock.dir.z * along },
            { label: 'gangplank', x: point.x, z: point.z },
          ] };
        }));
      }
      check(raft?.helm, 'owned starter raft has no fixed helm');
      check(point, `owned starter raft has no real dock gangplank: ${JSON.stringify({ raft, transport: record.transport })}`);
      record.approach = { playerStart: await page.evaluate(() => ({ x: window.__mn.ps.x, z: window.__mn.ps.z })), targets: approachPoints };
      for (const waypoint of approachPoints) record.approach[waypoint.label] = await walkTo(page, waypoint, waypoint.label);
      const helmPoint = await page.evaluate(async () => {
        const m = window.__mn, raft = m.client.pred.rafts.find(r => r.owner === m.client.youServer);
        const { pilotPoint } = await import('/src/sim/naval/pilotGeometry.js');
        return pilotPoint(raft, raft.helm);
      });
      record.approach.helmTarget = helmPoint;
      record.approach.helm = await walkTo(page, helmPoint, 'helm');
      record.approach.support = await page.evaluate(() => {
        const m = window.__mn, surface = m.client.pred.raftDeck.surface(m.ps.x, m.ps.z, m.ps.y);
        return surface && { id: surface.id, kind: surface.kind, y: surface.y };
      });
      check(record.approach.support?.kind === 'deck', `normal UI approach did not end on real raft deck: ${JSON.stringify(record.approach)}`);
      await page.waitForFunction(() => window.__mn.navigation.interaction()?.prompt?.includes('iniciar travesía'), null, { timeout: 10000 });
      if (spec.mobile) await page.locator('.ln-prompt [data-run]').click();
      else await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.__mn.client.naval.active, null, { timeout: 20000 });
      if (spec.mobile) {
        const points = await page.evaluate(() => {
          const m = window.__mn, r = m.navigation.touch.sticks.get('move').pad.getBoundingClientRect();
          const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          const local = m.navigation.stage.toLocal(center.x, center.y);
          const bx = m.navigation.stage.toLocal(center.x + 1, center.y), by = m.navigation.stage.toLocal(center.x, center.y + 1);
          const a = bx.x - local.x, b = by.x - local.x, c = bx.y - local.y, d = by.y - local.y, det = a * d - b * c;
          const dy = -Math.min(r.width, r.height) * .36;
          return { center, forward: { x: center.x - b * dy / det, y: center.y + a * dy / det }, rotated: document.body.classList.contains('rotated') };
        });
        const cdp = await context.newCDPSession(page);
        const sendTouch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type,
          touchPoints: point ? [{ x: point.x, y: point.y, id: 1, radiusX: 4, radiusY: 4 }] : [] });
        const before = await page.evaluate(() => ({ tick: window.__mn.client.naval.body?.state.tick, ack: window.__mn.client.naval.ack,
          x: window.__mn.client.naval.body?.pose.x, z: window.__mn.client.naval.body?.pose.z }));
        await sendTouch('touchStart', points.center); await sendTouch('touchMove', points.forward);
        await page.waitForFunction((before) => {
          const n = window.__mn?.client?.naval, p = n?.body?.pose;
          return n?.body?.state.tick > before.tick && n.body.state.vx ** 2 + n.body.state.vz ** 2 > 0.2 && p && Math.hypot(p.x - before.x, p.z - before.z) > 0.4;
        }, before, { timeout: 12000 });
        record.stick = await page.evaluate(() => ({ input: window.__mn.navigation.fixedInput(), diagnostics: window.__mn.navigation.touch.diagnostics() }));
        check(record.stick.input.naval.throttle > .5, `touch forward drag did not command forward thrust: ${JSON.stringify(record.stick)}`);
        await sendTouch('touchEnd');
        await page.waitForFunction(() => window.__mn.navigation.touch.diagnostics().pointers === 0);
        record.stick.released = await page.evaluate(() => window.__mn.navigation.fixedInput().naval);
        check(record.stick.released.throttle === 0, 'touch release left throttle held');
        await cdp.detach();
      } else {
        await waitForMovement(page, 'KeyW', { minDistance: 0.8 });
        const turnStart = await page.evaluate(() => window.__mn.client.naval.body.state.tick);
        await page.keyboard.down('KeyD');
        await page.waitForFunction((tick) => window.__mn?.client?.naval?.body?.state.tick >= tick + 12, turnStart, { timeout: 12000 });
        await page.keyboard.up('KeyD');
      }
      await page.screenshot({ path: resolve(out, `${spec.name}-sailing.png`) });
      record.sailing = await page.evaluate(() => {
        const m = window.__mn, raft = m.client.renderRafts().find(r => r.owner === m.client.youServer);
      const raftView = m.world.rafts.views.get(String(raft.id)), hullMeshes = [];
      raftView?.visual?.traverse?.(o => { if (o.isMesh && o.geometry?.attributes?.position?.count > 0 && o.visible) hullMeshes.push(o.name); });
      const helm = raftView?.helm;
        return { active: m.client.naval.active, voyage: m.client.voyage, pose: { x: raft.x, z: raft.z },
          camera: { fov: m.world.camera.fov, position: m.world.camera.position.toArray() },
          skin: m.world.rafts.surfaceSkin?.diagnostics(),
          hull: { rootVisible: !!raftView?.root.visible, visualVisible: !!raftView?.visual.visible, meshCount: hullMeshes.length, meshes: hullMeshes },
          helm: { visible: helm?.visible, tiller: helm?.userData.tiller?.rotation.y },
          avatar: (() => {
            const view = m.client.entities.get(m.client.youServer)?.view, pose = view?.navalPose;
            const target = m.navigation.helmVisuals.get(String(raft.id))?.gripWorld;
            const error = (hand, grip) => hand && grip ? Math.hypot(hand.x-grip.x, hand.y-grip.y, hand.z-grip.z) : null;
            return { active: pose?.active, handsWorld: pose?.handsWorld, requestedGrip: target,
              leftError: error(pose?.handsWorld?.left, target?.left), rightError: error(pose?.handsWorld?.right, target?.right),
              leftClamped: pose?.handsWorld?.left?.clamped, rightClamped: pose?.handsWorld?.right?.clamped };
          })(), errors: [...m.errors] };
      });
      check(record.sailing.active && record.sailing.voyage.active, 'ordinary game did not mount live voyage');
      check(Math.hypot(record.sailing.pose.x - raft.x, record.sailing.pose.z - raft.z) > .5, 'UI throttle did not move authoritative raft');
      check(record.sailing.helm.visible, 'physical helm hidden');
      check(record.sailing.hull.rootVisible && record.sailing.hull.visualVisible && record.sailing.hull.meshCount > 0,
        `local raft hull is not visible: ${JSON.stringify(record.sailing.hull)}`);
      check(record.sailing.avatar.active && record.sailing.avatar.leftError < .08 && record.sailing.avatar.rightError < .08 &&
        !record.sailing.avatar.leftClamped && !record.sailing.avatar.rightClamped,
      `own avatar hands missed the fixed helm grip: ${JSON.stringify(record.sailing.avatar)}`);
      check(record.sailing.errors.length === 0, 'main safe() reported a subsystem error');
      check(record.sailing.skin?.albedo?.width === (spec.mobile ? 512 : 1024), 'raft texture resolution does not match device budget');
      if (spec.mobile) check(!record.textures.some(path => /normal/i.test(path)), 'mobile downloaded a raft normal map');
      if (spec.mobile) {
        record.touch = await page.evaluate(() => ({
          stage: { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 },
          targets: [...document.querySelectorAll('.naval-touch-stick,.naval-touch-action')].filter(e => e.getBoundingClientRect().width).map(e => {
            const r = e.getBoundingClientRect(); return { label: e.dataset.stick || e.dataset.action, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
          }),
        }));
        check(!record.touch.stage.overflow, 'mobile document overflows');
        check(record.touch.targets.length >= 4, 'modern naval touch controls missing');
        for (const target of record.touch.targets) check(target.w >= 44 && target.h >= 44 && target.x >= -1 && target.y >= -1 &&
          target.right <= spec.viewport.width + 1 && target.bottom <= spec.viewport.height + 1, `touch target clipped: ${target.label}`);
      }
      await page.waitForFunction(() => window.__mn.navigation.interaction()?.actions?.some(a => a.key === 'E'), null, { timeout: 12000 });
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => window.__mn.client.deck.active, null, { timeout: 15000 });
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => !window.__mn.client.deck.active, null, { timeout: 15000 });
      await page.keyboard.down('KeyS');
      await page.waitForFunction(() => window.__mn.client.voyage.canDock, null, { timeout: 30000 }).finally(() => page.keyboard.up('KeyS'));
      await page.waitForFunction(() => window.__mn.client.voyage.canDock, null, { timeout: 30000 });
      await page.keyboard.press('KeyG');
      await page.waitForFunction(() => !window.__mn.client.voyage.active && !window.__mn.client.naval.active, null, { timeout: 15000 });
      await page.screenshot({ path: resolve(out, `${spec.name}-docked.png`) });
      record.docked = await page.evaluate(() => ({ voyage: window.__mn.client.voyage, errors: [...window.__mn.errors] }));
      check(record.docked.errors.length === 0 && record.errors.length === 0, 'runtime error');
      record.status = 'passed';
    } catch (error) {
      record.status = 'failed'; record.failure = String(error?.stack || error);
      try {
        await page.screenshot({ path: resolve(out, `${spec.name}-failure.png`) });
        record.diagnostics = await page.evaluate(() => {
          const m = window.__mn, n = m?.client?.naval, raft = m?.client?.pred?.rafts?.find(r => r.owner === m.client.youServer);
          return m ? { errors: [...m.errors], joined: m.client.joined, mode: m.st.mode, paused: m.st.paused,
            inputEnabled: m.input.enabled, chatTyping: m.panels.chatPanel.typing, ps: m.ps,
            transport: m.transport.kind, playerEntity: m.client.youServer, playerRecord: m.client.entities.get(m.client.youServer)?.r,
            raft: raft && { id: raft.id, x: raft.x, z: raft.z, helm: raft.helm },
            naval: { active: n.active, tick: n.body?.state.tick, ack: n.ack, seq: n.seq, pose: n.body?.pose },
            voyage: m.client.voyage, interaction: m.navigation.interaction()?.prompt,
            touch: m.navigation.touch?.diagnostics?.(), axes: m.navigation.fixedInput?.() } : null;
        });
      } catch { /* Page may have crashed. */ }
    }
    finally { await context.close(); await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
  }
} finally { await browser.close(); await host.close(); }
evidence.status = evidence.cases.every(c => c.status === 'passed') ? 'passed' : 'failed';
await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.cases.map(c => ({ name: c.name, status: c.status, failure: c.failure }))));
if (evidence.status !== 'passed') process.exitCode = 1;

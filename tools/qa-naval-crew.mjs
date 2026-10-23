#!/usr/bin/env node
// D08c.3 browser acceptance in an isolated loopback lab. These are eventual checks, not FPS claims.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'docs/delivery/d08c3-relative-crew');
const url = process.env.MN_NAVAL_PILOT_URL || 'http://127.0.0.1:5198/tools/naval-pilot/';
const { chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const evidence = { generatedAt: new Date().toISOString(), url, scenarios: [], failures: [] };
const check = (ok, message) => { if (!ok) throw new Error(message); };
const near = (a, b, label) => check(Number.isFinite(a) && Math.abs(a - b) < 0.003, `${label}: ${a} != ${b}`);
const wait = (page, fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 30000 });
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });

async function alignment(page) {
  return page.evaluate(() => {
    const lab = window.__navalPilotLab, server = lab.server, client = lab.client, guest = lab.guest;
    client.update(0, 0); guest?.update(0, 0);
    const point = (pose, a) => ({ x: pose.x + Math.cos(pose.yaw) * a.x + Math.sin(pose.yaw) * a.z,
      y: pose.y + a.y, z: pose.z - Math.sin(pose.yaw) * a.x + Math.cos(pose.yaw) * a.z });
    const naval = server.world.navalPilot.snapshot(client.youServer), raft = client.renderRafts(0.5).find((r) => r.id === naval.shipId);
    const owner = server.world.navalPilot.deckSnapshot(client.youServer), passenger = server.world.navalPilot.deckSnapshot(guest.youServer);
    const actual = (e) => ({ x: server.world.ecs.x[e], y: server.world.ecs.y[e], z: server.world.ecs.z[e] });
    const remoteRaft = client.renderRafts(1).find((r) => r.id === naval.shipId), member = remoteRaft.crew.find((c) => c.entity === guest.youServer);
    return { tick: server.world.tick, mode: owner.active ? 'walk' : 'helm', deckAck: owner.ack,
      serverOwner: actual(client.youServer), serverOwnerExpected: point(naval.body.pose, owner.active ? owner.state : naval.anchor),
      serverGuest: actual(guest.youServer), serverGuestExpected: point(naval.body.pose, passenger.state),
      ownerLocal: client.localState(0.5, {}), ownerLocalExpected: owner.active ? client.deck.position(raft, 0.5) : client.naval.position(0.5),
      remoteGuest: { ...client.entities.get(guest.youServer).r }, remoteGuestExpected: point(remoteRaft, member.anchor),
      diagnostics: lab.diagnostics() };
  });
}
function verify(a) {
  for (const [actual, expected] of [['serverOwner','serverOwnerExpected'], ['serverGuest','serverGuestExpected'],
    ['ownerLocal','ownerLocalExpected'], ['remoteGuest','remoteGuestExpected']])
    for (const key of ['x','y','z']) near(a[actual][key], a[expected][key], `${actual}.${key}`);
  check(a.diagnostics.glError === 0 && a.diagnostics.assetErrors.length === 0 && a.diagnostics.errors.length === 0,
    'WebGL, asset or lab error');
}
async function run(viewport, house = false) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1, isMobile: viewport.touch, hasTouch: viewport.touch });
  const page = await context.newPage(), errors = [], consoleErrors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => { if (e.type() === 'error') consoleErrors.push(e.text()); });
  const result = { viewport, house, pageErrors: errors, consoleErrors, screenshots: [] };
  try {
    result.stage = 'join';
    await page.goto(url + (viewport.touch ? '?mobile=1' : ''), { waitUntil: 'networkidle' });
    await wait(page, () => window.__navalPilotLab?.client?.joined && !document.querySelector('#mount').disabled);
    if (house) { await page.locator('#fixture').selectOption('house'); await wait(page, () => window.__navalPilotLab?.client?.joined && !document.querySelector('#mount').disabled); }
    const baseline = await page.evaluate(() => {
      const l = window.__navalPilotLab, e = l.client.youServer;
      return { profile: JSON.stringify(l.server.world.profiles.get(e)), source: l.diagnostics().sourceEcsPose };
    });
    result.stage = 'mount';
    await page.locator('#mount').click();
    await wait(page, () => window.__navalPilotLab.client.naval.active);
    result.stage = 'invite';
    await page.locator('#passenger').click();
    await wait(page, () => window.__navalPilotLab.guest?.deck?.active);
    result.stage = 'helm';
    await page.keyboard.down('w'); await page.keyboard.down('d');
    await wait(page, () => window.__navalPilotLab.diagnostics().ack > 30);
    await page.keyboard.up('d'); await page.keyboard.up('w');
    result.helm = await alignment(page); verify(result.helm);
    result.stage = 'walk';
    await page.locator('#walk').click();
    await wait(page, () => window.__navalPilotLab.client.deck.active);
    const initial = await page.evaluate(() => ({ ...window.__navalPilotLab.client.deck.state }));
    if (viewport.touch) {
      await page.locator('[data-axis="left"]').scrollIntoViewIfNeeded();
      const box = await page.locator('[data-axis="left"]').boundingBox(), cdp = await context.newCDPSession(page);
      await page.evaluate(() => { window.__crewTouch = []; document.addEventListener('pointerdown', (e) => window.__crewTouch.push({ type: e.pointerType, trusted: e.isTrusted }), { once: true }); });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await wait(page, (x) => window.__navalPilotLab.client.deck.state.x < x - 0.08, initial.x);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      result.touchEvents = await page.evaluate(() => window.__crewTouch);
      check(result.touchEvents.some((e) => e.type === 'touch' && e.trusted), 'Touch did not reach the real UI handler');
      await cdp.detach();
    } else {
      await page.keyboard.down('a');
      await wait(page, (x) => window.__navalPilotLab.client.deck.state.x < x - 0.08, initial.x);
      await page.keyboard.up('a');
    }
    await wait(page, () => window.__navalPilotLab.client.deck.ack > 0);
    result.walking = await alignment(page); verify(result.walking);
    check(result.walking.diagnostics.deckState.x < initial.x - 0.08, 'Walking did not change local position');
    const name = `${viewport.name}${house ? '-house' : ''}`;
    const shot = resolve(out, `${name}-ui-v1.png`); await page.screenshot({ path: shot, fullPage: true }); result.screenshots.push(shot);
    const canvas = resolve(out, `${name}-canvas-v1.png`); await page.locator('#bay').screenshot({ path: canvas }); result.screenshots.push(canvas);
    result.stage = 'blur';
    const neutral = await page.evaluate(() => {
      const l = window.__navalPilotLab; window.dispatchEvent(new Event('blur'));
      return { deck: l.client.deck.seq, naval: l.client.naval.seq };
    });
    await wait(page, (seq) => { const l = window.__navalPilotLab, e = l.client.youServer;
      return l.server.world.navalPilot.deckSnapshot(e).ack >= seq.deck && l.server.world.navalPilot.snapshot(e).ack >= seq.naval;
    }, neutral);
    result.afterBlur = await alignment(page); verify(result.afterBlur);
    check(result.afterBlur.diagnostics.controls.brake === 1, 'Focus loss must hold naval brake');
    result.stage = 'retake';
    await page.locator('#walk').click();
    await wait(page, () => !window.__navalPilotLab.client.deck.active && window.__navalPilotLab.client.naval.active);
    result.retake = await alignment(page); verify(result.retake);
    result.stage = 'leave';
    await page.locator('#leave').click();
    await wait(page, () => { const l = window.__navalPilotLab; return !l.client.naval.active && !l.client.deck.active && !l.guest.deck.active && l.server.world.navalTrial.size === 0; });
    result.conservation = await page.evaluate((before) => { const l = window.__navalPilotLab, e = l.client.youServer, d = l.diagnostics();
      return { profile: JSON.stringify(l.server.world.profiles.get(e)) === before.profile,
        source: JSON.stringify(d.sourceEcsPose) === JSON.stringify(before.source), guest: d.guest.profileBaseline,
        noBodies: l.server.world.navalTrial.size === 0, noOverflow: document.documentElement.scrollWidth <= innerWidth,
        errors: d.errors, assetErrors: d.assetErrors, gl: d.glError };
    }, baseline);
    for (const k of ['profile','source','guest','noBodies','noOverflow']) check(result.conservation[k], `Conservation/UI check failed: ${k}`);
    check(!errors.length && !consoleErrors.length && !result.conservation.errors.length, 'Browser reported errors');
    result.ok = true; result.stage = 'complete';
  } catch (error) {
    result.ok = false; result.error = error.message;
    result.failureDiagnostics = await page.evaluate(() => window.__navalPilotLab?.diagnostics()).catch(() => null);
    evidence.failures.push(`${viewport.name} (${result.stage}): ${error.message}`);
  }
  finally { evidence.scenarios.push(result); await context.close(); }
}
try {
  for (const viewport of [{ name: 'desktop-1280x800', width: 1280, height: 800, touch: false },
    { name: 'mobile-portrait-390x844', width: 390, height: 844, touch: true },
    { name: 'mobile-landscape-844x390', width: 844, height: 390, touch: true }]) await run(viewport);
  await run({ name: 'desktop-1280x800', width: 1280, height: 800, touch: false }, true);
} finally { await browser.close(); }
evidence.ok = evidence.failures.length === 0;
await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ ok: evidence.ok, scenarios: evidence.scenarios.map((s) => ({ viewport: s.viewport.name, house: s.house, ok: s.ok, error: s.error })), out }, null, 2));
if (!evidence.ok) process.exitCode = 1;

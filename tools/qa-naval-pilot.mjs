#!/usr/bin/env node
// Standalone browser QA for the isolated D08c.2 pilot lab. Touch input is Chrome CDP-emulated.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'docs/delivery/d08c2-pilot-deck');
const DEFAULT_URL = 'http://127.0.0.1:5198/tools/naval-pilot/';
// Software WebGL can spend seconds on a frame/capture; these are eventual fixed-tick checks,
// not a 1-second gameplay response or FPS benchmark.
const LIMIT_MS = 5000;

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const URL = argValue('url') || process.env.MN_NAVAL_PILOT_URL || DEFAULT_URL;
const outDir = OUT;
const evidence = { url: URL, generatedAt: new Date().toISOString(), scenarios: [], failures: [] };

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function near(a, b, label, epsilon = 0.002) {
  ensure(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon,
    `${label}: expected ${b}, got ${a}`);
}

async function waitFor(page, expression, message, timeout = 30000, arg = null) {
  try { await page.waitForFunction(expression, arg, { timeout }); }
  catch (error) { throw new Error(`${message}: ${error.message}`); }
}

async function ready(page, fixture = null) {
  await waitFor(page, () => window.__navalPilotLab?.client?.joined &&
    !document.querySelector('#mount')?.disabled, 'Pilot lab did not become mount-ready');
  if (fixture) {
    await waitFor(page, (expected) => window.__navalPilotLab?.client?.joined &&
      !document.querySelector('#mount')?.disabled && document.querySelector('#fixture')?.value === expected,
    `Fixture ${fixture} did not boot`, 30000, fixture);
  }
}

async function baseline(page) {
  return page.evaluate(() => {
    const lab = window.__navalPilotLab, d = lab.diagnostics();
    const owner = lab.server.clients.get('naval-pilot-lab')?.entity;
    const profile = owner && lab.server.world.profiles.get(owner);
    const ship = profile?.eco?.ships?.find((row) => row.id === d.shipId);
    return { shipId: d.shipId, savedShipJson: JSON.stringify(ship), profileJson: JSON.stringify(profile), sourceEcsPose: d.sourceEcsPose,
      parts: ship?.grid?.parts?.length ?? 0 };
  });
}

async function mount(page) {
  await page.locator('#mount').click();
  await waitFor(page, () => {
    const lab = window.__navalPilotLab, owner = lab?.server?.clients.get('naval-pilot-lab')?.entity;
    return !!lab?.client?.naval?.active && !!owner && lab.server.world.navalPilot.snapshot(owner)?.active;
  }, 'Mount did not activate on client and server');
}

async function driveKeyboard(page, before) {
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  try {
    await waitFor(page, (start) => {
      const d = window.__navalPilotLab?.diagnostics(), p = d?.shipPose;
      if (!d?.active || d.ack <= 0 || !p) return false;
      return Math.hypot(p.x - start.x, p.z - start.z) > 0.005 || Math.abs(p.yaw - start.yaw) > 0.001;
    }, 'W+D did not advance the pilot ACK and raft pose within the QA timeout', LIMIT_MS, before);
  } finally {
    await page.keyboard.up('d');
    await page.keyboard.up('w');
  }
}

async function driveTouch(page, context, before) {
  await page.evaluate(() => {
    window.__qaPilotPointerEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, (event) => {
      if (event.target.closest?.('.helm-key')) window.__qaPilotPointerEvents.push({ type, pointerType: event.pointerType, trusted: event.isTrusted });
    }, true);
  });
  let cdp;
  const press = async (selector, start) => {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    ensure(box, `Missing touch control ${selector}`);
    cdp ||= await context.newCDPSession(page);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 },
    ] });
    try {
      await waitFor(page, (expected) => {
        const d = window.__navalPilotLab?.diagnostics(), p = d?.shipPose;
        return !!d?.active && d.ack > expected.ack && p &&
          (Math.hypot(p.x - expected.pose.x, p.z - expected.pose.z) > 0.005 || Math.abs(p.yaw - expected.pose.yaw) > 0.001);
      }, 'Touch control did not advance pilot ACK/pose within the QA timeout', LIMIT_MS, start);
    } finally {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  };
  try {
    const start = await page.evaluate(() => { const d = window.__navalPilotLab.diagnostics(); return { ack: d.ack, pose: d.shipPose }; });
    await press('.helm-key[data-axis="throttle"]', start);
    const turnStart = await page.evaluate(() => window.__navalPilotLab.diagnostics().shipPose);
    const turnAck = await page.evaluate(() => window.__navalPilotLab.diagnostics().ack);
    await press('.helm-key[data-axis="right"]', { ack: turnAck, pose: turnStart });
    const pointerEvents = await page.evaluate(() => window.__qaPilotPointerEvents);
    ensure(pointerEvents.some((event) => event.type === 'pointerdown' && event.pointerType === 'touch' && event.trusted),
      'CDP touch did not produce a trusted touch pointerdown on a helm control');
    ensure(pointerEvents.some((event) => event.type === 'pointerup' && event.pointerType === 'touch' && event.trusted),
      'CDP touch did not produce a trusted touch pointerup on a helm control');
    const after = await page.evaluate(() => window.__navalPilotLab.diagnostics().shipPose);
    ensure(Math.hypot(after.x - before.x, after.z - before.z) > 0.005 || Math.abs(after.yaw - turnStart.yaw) > 0.001,
      'Touch controls did not move or turn the raft');
    return { method: 'Chrome CDP touchStart/touchEnd; trusted browser touch pointer events through DOM', pointerEvents };
  } finally { if (cdp) await cdp.detach(); }
}

async function assertAlignment(page) {
  return page.evaluate(async () => {
    const { pilotPoint } = await import('/src/sim/naval/pilotGeometry.js');
    const lab = window.__navalPilotLab, client = lab.client, server = lab.server;
    const owner = server.clients.get('naval-pilot-lab')?.entity;
    const state = server.world.navalPilot.snapshot(owner), record = client.renderRafts(1).find((r) => r.id === state.shipId);
    const local = client.localState(1, {}), predicted = pilotPoint(record, record.pilot.anchor);
    const serverPose = state.body.pose, serverPoint = pilotPoint(serverPose, state.anchor);
    const actual = { x: server.world.ecs.x[owner], y: server.world.ecs.y[owner], z: server.world.ecs.z[owner], f: server.world.ecs.facing[owner] };
    const serverDeck = server.world.raftDeck.surface(actual.x, actual.z, actual.y);
    const clientDeck = client.pred.raftDeck.surface(local.x, local.z, local.y);
    return { shipId: state.shipId, ack: state.ack, clientActive: client.naval.active, serverActive: state.active,
      local, predicted, serverPoint, actual, serverDeck, clientDeck,
      raftPose: { x: record.x, y: record.y, z: record.z, yaw: record.yaw },
      serverPose, pendingInputCount: client.naval.pending.length };
  });
}

function checkAlignment(alignment, { requireAck = true } = {}) {
  ensure(alignment.clientActive && alignment.serverActive, 'Pilot is not active on both peers');
  if (requireAck) ensure(alignment.ack > 0, 'Naval ACK did not advance');
  for (const key of ['x', 'y', 'z', 'f']) near(alignment.local[key], alignment.predicted[key], `client anchor ${key}`);
  for (const key of ['x', 'y', 'z', 'f']) near(alignment.actual[key], alignment.serverPoint[key], `server anchor ${key}`);
  ensure(alignment.serverDeck?.id === alignment.shipId && alignment.serverDeck.kind === 'deck', 'Server RaftDeck does not support the pilot');
  ensure(alignment.clientDeck?.id === alignment.shipId, 'Client RaftDeck does not support the pilot');
  for (const key of ['x', 'y', 'z']) near(alignment.raftPose[key], alignment.serverPose[key], `public raft ${key}`);
  near(alignment.raftPose.yaw, alignment.serverPose.yaw, 'public raft yaw');
}

async function checkConservation(page, initial) {
  const current = await page.evaluate(() => {
    const lab = window.__navalPilotLab, d = lab.diagnostics(), owner = lab.server.clients.get('naval-pilot-lab')?.entity;
    const profile = owner && lab.server.world.profiles.get(owner);
    const ship = profile?.eco?.ships?.find((row) => row.id === d.shipId);
    return { savedShipJson: JSON.stringify(ship), profileJson: JSON.stringify(profile), sourceEcsPose: d.sourceEcsPose };
  });
  ensure(current.savedShipJson === initial.savedShipJson, 'Saved ship JSON changed during the pilot trial');
  ensure(current.profileJson === initial.profileJson, 'Profile JSON changed during the pilot trial');
  ensure(JSON.stringify(current.sourceEcsPose) === JSON.stringify(initial.sourceEcsPose), 'Canonical source ECS mooring pose changed');
  return current;
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  const page = await context.newPage(), pageErrors = [], consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const result = { viewport, inputMode: viewport.mobile ? 'CDP-emulated trusted touch' : 'Playwright keyboard events',
    screenshots: [], pageErrors, consoleErrors };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await ready(page);
    const initial = await baseline(page);
    ensure(initial.shipId && initial.savedShipJson && initial.profileJson, 'Baseline lacks the real saved ship/profile');
    result.baseline = initial;
    const canvas = await page.locator('#bay').evaluate((element) => ({ width: element.width, height: element.height }));
    ensure(canvas.width > 0 && canvas.height > 0, 'Navigation canvas has no backing resolution');
    await mount(page);
    const movementStart = await page.evaluate(() => window.__navalPilotLab.diagnostics().shipPose);
    if (viewport.mobile) result.touch = await driveTouch(page, context, movementStart);
    else await driveKeyboard(page, movementStart);
    const alignment = await assertAlignment(page);
    checkAlignment(alignment);
    result.activeAlignment = alignment;

    const screenshot = resolve(outDir, `${viewport.name}-canvas-v1.png`);
    await page.locator('#bay').screenshot({ path: screenshot, animations: 'disabled' });
    result.screenshots.push(screenshot);
    await page.screenshot({ path: resolve(outDir, `${viewport.name}-ui-v1.png`), fullPage: true });
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
      height: document.documentElement.scrollHeight, viewportHeight: innerHeight }));
    ensure(overflow.width <= overflow.viewport + 1, `Horizontal overflow: ${overflow.width}px > ${overflow.viewport}px`);
    result.overflow = overflow;

    const neutral = await page.evaluate(() => {
      const lab = window.__navalPilotLab, original = lab.transport.send.bind(lab.transport), sent = [];
      lab.transport.send = (message) => { if (message.t === 'ship_input') sent.push({ ...message }); original(message); };
      window.dispatchEvent(new Event('blur'));
      lab.transport.send = original;
      return sent.find((m) => m.throttle === 0 && m.brake === 1 && m.steer === 0);
    });
    ensure(neutral, 'Blur did not send a neutral command through the real transport');
    await waitFor(page, (seq) => window.__navalPilotLab?.diagnostics()?.ack >= seq,
      'Blur neutral sequence was not consumed at a fixed tick', LIMIT_MS, neutral.seq);
    result.blurNeutralCommand = neutral;
    result.blurNeutralAck = await page.evaluate(() => window.__navalPilotLab.diagnostics().ack);
    result.runtime = await page.evaluate(() => window.__navalPilotLab.diagnostics());
    ensure(result.runtime.controls.throttle === 0 && result.runtime.controls.steer === 0 && result.runtime.controls.brake === 1,
      'Held input remained after blur');
    ensure(result.runtime.glError === 0 && result.runtime.assetErrors.length === 0 && result.runtime.errors.length === 0,
      'Runtime reported GL, asset or harness errors');

    await page.locator('#leave').click();
    await waitFor(page, () => {
      const lab = window.__navalPilotLab, owner = lab?.server?.clients.get('naval-pilot-lab')?.entity;
      return !lab?.client?.naval?.active && owner && !lab.server.world.navalPilot.snapshot(owner).active && lab.server.world.navalTrial.size === 0;
    }, 'Leave did not clear client/server pilot and transient body', LIMIT_MS);
    result.afterLeave = await checkConservation(page, initial);

    if (!viewport.mobile) {
      await page.locator('#fixture').selectOption('house');
      await ready(page, 'house');
      const houseBaseline = await baseline(page);
      result.houseBaseline = houseBaseline;
      ensure(houseBaseline.parts > initial.parts, 'House fixture did not add structure to the saved test blueprint');
      await mount(page);
      await page.waitForTimeout(200);
      const houseAlignment = await assertAlignment(page);
      checkAlignment(houseAlignment, { requireAck: false });
      result.houseAlignment = houseAlignment;
      const houseShot = resolve(outDir, 'desktop-house-canvas-v1.png');
      await page.locator('#bay').screenshot({ path: houseShot, animations: 'disabled' });
      result.screenshots.push(houseShot);
      await page.locator('#leave').click();
      await waitFor(page, () => !window.__navalPilotLab?.client?.naval?.active,
        'House fixture did not leave cleanly', LIMIT_MS);
      result.houseAfterLeave = await checkConservation(page, houseBaseline);
    }

    ensure(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    ensure(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.failure = error?.stack || String(error);
    evidence.failures.push({ viewport: viewport.name, failure: result.failure });
  } finally {
    try { await context.close(); } catch (error) {
      evidence.failures.push({ viewport: viewport.name, failure: `Context close: ${error.message}` });
      result.ok = false;
    }
    result.pageErrors = pageErrors;
    result.consoleErrors = consoleErrors;
    if (pageErrors.length) { evidence.failures.push({ viewport: viewport.name, pageErrors }); result.ok = false; }
    if (consoleErrors.length) { evidence.failures.push({ viewport: viewport.name, consoleErrors }); result.ok = false; }
  }
  evidence.scenarios.push(result);
}

let browser;
try {
  await mkdir(outDir, { recursive: true });
  const playwrightSpecifier = process.env.MN_PLAYWRIGHT
    ? (process.env.MN_PLAYWRIGHT.startsWith('file:') ? process.env.MN_PLAYWRIGHT : pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href)
    : 'playwright';
  const { chromium } = await import(playwrightSpecifier);
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const viewport of [
    { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false },
    { name: 'mobile-portrait-390x844', width: 390, height: 844, mobile: true },
    { name: 'mobile-landscape-844x390', width: 844, height: 390, mobile: true },
  ]) await runViewport(browser, viewport);
} catch (error) {
  evidence.failures.push({ failure: error?.stack || String(error) });
} finally {
  if (browser) await browser.close().catch((error) => evidence.failures.push({ failure: `Browser close: ${error.message}` }));
}

evidence.ok = evidence.failures.length === 0 && evidence.scenarios.length === 3 && evidence.scenarios.every((scenario) => scenario.ok);
evidence.outputDir = outDir;
await writeFile(resolve(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
if (!evidence.ok) process.exitCode = 1;

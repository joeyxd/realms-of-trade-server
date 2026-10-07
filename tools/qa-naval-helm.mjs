import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const baseUrl = process.env.MN_HELM_URL || 'http://127.0.0.1:5199';
const out = resolve(process.cwd(), process.env.MN_HELM_OUT || 'docs/delivery/d08c5-helm-touch');
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
await mkdir(out, { recursive: true });

const evidence = { baseUrl, startedAt: new Date().toISOString(), cases: [], status: 'running' };
const save = async () => writeFile(resolve(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const closeToZero = (value) => Number.isFinite(value) && Math.abs(value) <= 0.06;
function checkHands(helm) {
  check(helm?.active && helm.gripWorld && helm.handsWorld, 'helm grips or posed hands missing');
  for (const side of ['left', 'right']) {
    const hand = helm.handsWorld[side], grip = helm.gripWorld[side];
    check(hand && !hand.clamped && Math.hypot(hand.x - grip.x, hand.y - grip.y, hand.z - grip.z) < .08,
      `${side} hand does not reach the original helm grip`);
  }
}

function collectErrors(page, bucket) {
  page.on('pageerror', error => bucket.push({ type: 'pageerror', message: String(error) }));
  page.on('console', message => {
    if (message.type() === 'error') bucket.push({ type: 'console', message: message.text() });
  });
  page.on('requestfailed', request => bucket.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) bucket.push({ type: 'http', url: response.url(), status: response.status() }); });
}

async function diagnostics(page, kind) {
  return page.evaluate(which => {
    if (which === 'pilot') return window.__navalPilotLab?.diagnostics?.() ?? null;
    return window.__navalLab?.snapshot?.() ?? null;
  }, kind);
}

async function geometry(page, scopeSelector) {
  return page.evaluate(selector => {
    const scope = document.querySelector(selector);
    const root = document.documentElement;
    const box = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const parent = scope ? box(scope) : null;
    const targets = [...document.querySelectorAll('.naval-touch-stick, .naval-touch-action')].map(element => ({
      label: element.dataset.stick || element.dataset.action || element.className,
      ...box(element),
    }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: root.scrollWidth, height: root.scrollHeight },
      parent,
      targets,
    };
  }, scopeSelector);
}

function assertTouchGeometry(report, label) {
  const { viewport, document, parent, targets } = report;
  check(parent, `${label}: missing control bay`);
  check(document.width <= viewport.width + 1, `${label}: horizontal overflow ${document.width}px > ${viewport.width}px`);
  for (const target of targets) {
    check(target.width >= 44 && target.height >= 44, `${label}: ${target.label} target is below 44px (${target.width}x${target.height})`);
    check(target.x >= -1 && target.y >= -1 && target.right <= viewport.width + 1 && target.bottom <= viewport.height + 1,
      `${label}: ${target.label} is outside viewport`);
    check(target.x >= parent.x - 1 && target.y >= parent.y - 1 && target.right <= parent.right + 1 && target.bottom <= parent.bottom + 1,
      `${label}: ${target.label} is outside control bay`);
  }
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(out, `${name}-full.png`), fullPage: true });
  const canvas = page.locator('#bay');
  if (await canvas.count()) await canvas.screenshot({ path: resolve(out, `${name}-canvas.png`) });
}

async function runCase(browser, spec) {
  const record = { name: spec.name, viewport: spec.viewport, errors: [], checks: [], status: 'running' };
  evidence.cases.push(record);
  const context = await browser.newContext({ viewport: spec.viewport, isMobile: spec.mobile, hasTouch: spec.mobile, deviceScaleFactor: spec.mobile ? 1 : 1 });
  const page = await context.newPage();
  collectErrors(page, record.errors);
  try {
    await spec.run(page, record);
    const current = await diagnostics(page, spec.kind);
    check(record.errors.length === 0, 'browser console/page/request error');
    if (spec.kind === 'pilot') check(current.errors.length === 0 && current.assetErrors.length === 0 && current.glError === 0,
      'pilot asset/runtime/WebGL error');
    else check(current.textures.every(asset => asset.state !== 'error'), 'lab asset error');
    record.status = 'passed';
  } catch (error) {
    record.status = 'failed';
    record.failure = String(error?.stack || error);
  } finally {
    try {
      const endState = await diagnostics(page, spec.kind);
      record.finalDiagnostics = endState;
      record.runtimeAssets = await page.evaluate(() => {
        const canvas = document.querySelector('#bay');
        const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
        return { glError: gl ? gl.getError() : null };
      });
      if (spec.kind === 'pilot' && endState) {
        record.glError = endState.glError;
        record.assetErrors = endState.assetErrors;
        record.labErrors = endState.errors;
      }
      if (spec.kind === 'lab' && endState) record.assetDiagnostics = endState.textures;
    } catch (error) {
      record.finalDiagnosticsError = String(error);
    }
    await context.close();
    await save();
  }
  return record;
}

async function pilotCase(page, record, { mobile, name }) {
  const url = `${baseUrl}/tools/naval-pilot/${mobile ? '?mobile=1' : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__navalPilotLab?.ready), null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const d = window.__navalPilotLab?.diagnostics?.();
    return d?.ready && d.connected;
  }, null, { timeout: 30000 });
  await page.locator('#impact-test').click();
  await page.waitForFunction(() => {
    const d = window.__navalPilotLab?.diagnostics?.();
    return d?.active && d?.impactFixture;
  }, null, { timeout: 30000 });
  await page.locator('.stage').scrollIntoViewIfNeeded();
  const stageGeometry = await geometry(page, '.stage');
  if (mobile) {
    assertTouchGeometry(stageGeometry, name);
    record.controlGeometry = stageGeometry;
  }

  if (!mobile) {
    const before = await diagnostics(page, 'pilot');
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    await page.waitForTimeout(450);
    const moving = await diagnostics(page, 'pilot');
    record.helmInput = { before: before?.controls, moving: moving?.controls, camera: moving?.camera };
    check(moving?.controls && (Math.abs(moving.controls.throttle) > 0.1 || Math.abs(moving.controls.steer) > 0.1),
      `${name}: keyboard helm input did not reach pilot diagnostics`);
    checkHands(moving.helm); record.handPose = moving.helm;
    await screenshot(page, name);
    await page.keyboard.up('d');
    await page.keyboard.up('w');
    await page.waitForTimeout(100);
  } else {
    const cdp = await page.context().newCDPSession(page);
    const move = page.locator('[data-stick="move"]');
    const look = page.locator('[data-stick="look"]');
    const m = await move.boundingBox();
    const l = await look.boundingBox();
    check(m && l, `${name}: missing move/look touch sticks`);
    const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const mc = center(m), lc = center(l);
    const points = [
      { id: 1, x: mc.x + 20, y: mc.y - 40, radiusX: 1, radiusY: 1, force: 1 },
      { id: 2, x: lc.x + 40, y: lc.y + 10, radiusX: 1, radiusY: 1, force: 1 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { ...points[0], x: mc.x, y: mc.y }, { ...points[1], x: lc.x, y: lc.y },
    ] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points });
    await page.waitForTimeout(250);
    const both = await diagnostics(page, 'pilot');
    const orbitBeforeRelease = both?.camera?.orbitYaw;
    record.dualTouch = { axes: both?.controls, camera: both?.camera, touch: both?.touch };
    check(both?.controls && Math.abs(both.controls.throttle) > 0.1, `${name}: move stick did not steer/throttle`);
    check(Number.isFinite(orbitBeforeRelease), `${name}: camera orbit diagnostic is unavailable`);
    checkHands(both.helm); record.handPose = both.helm;
    await screenshot(page, `${name}-helm`);

    // Lift the movement finger and keep the look finger moving.
    const lookOnly = [{ ...points[1], x: lc.x + 55, y: lc.y + 18 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points[0]] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: lookOnly });
    await page.waitForTimeout(250);
    const afterMoveRelease = await diagnostics(page, 'pilot');
    record.lookOnly = { axes: afterMoveRelease?.controls, camera: afterMoveRelease?.camera, touch: afterMoveRelease?.touch };
    check(afterMoveRelease?.controls && closeToZero(afterMoveRelease.controls.throttle) && closeToZero(afterMoveRelease.controls.steer),
      `${name}: helm axes remained active after releasing move stick`);
    check(Number.isFinite(afterMoveRelease?.camera?.orbitYaw) && Math.abs(afterMoveRelease.camera.orbitYaw - orbitBeforeRelease) > 0.001,
      `${name}: camera orbit did not continue on look stick alone`);

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(100);
    const cancelled = await diagnostics(page, 'pilot');
    record.cancelled = { axes: cancelled?.controls, touch: cancelled?.touch };
    check(cancelled?.controls && closeToZero(cancelled.controls.throttle) && closeToZero(cancelled.controls.steer),
      `${name}: touchCancel did not neutralize helm axes`);
    await cdp.detach();

    await page.locator('[data-action="walk"]').tap();
    await page.waitForFunction(() => {
      const d = window.__navalPilotLab?.diagnostics?.();
      return d?.deckActive && d.deckMode === 'walking';
    }, null, { timeout: 10000 });
    record.deckToggle = await diagnostics(page, 'pilot');
    check(record.deckToggle.helm?.active === false && record.deckToggle.helm?.gripWorld && !record.deckToggle.helm?.handsWorld,
      'walking must release hands while keeping the physical helm station');
    await screenshot(page, `${name}-walking`);
    await page.locator('[data-action="walk"]').tap();
    await page.waitForFunction(() => {
      const d = window.__navalPilotLab?.diagnostics?.();
      return d && !d.deckActive && d.deckMode === 'helm';
    }, null, { timeout: 10000 });
    record.deckReturn = await diagnostics(page, 'pilot');
  }
  record.checks.push('pilot readiness, impact fixture, control geometry, real input and diagnostics');
}

async function labMobileCase(page, record) {
  await page.goto(`${baseUrl}/tools/naval-lab/?mobile=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__navalLab?.snapshot?.()), null, { timeout: 30000 });
  await page.locator('#lab-toggle').click();
  await page.selectOption('#fixture', 'empty');
  await page.selectOption('#wind', 'tail');
  const currents = page.locator('#currents');
  if (await currents.count() && await currents.isChecked()) await currents.uncheck();
  await page.locator('#cruise').uncheck();
  await page.locator('#reset').click();
  await page.waitForFunction(() => {
    const s = window.__navalLab?.snapshot?.();
    return s?.fixture?.id === 'empty' && s?.wind && s?.activity;
  }, null, { timeout: 15000 });
  await page.locator('#return-to-sea').click();
  record.controlGeometry = await geometry(page, '.bay');
  assertTouchGeometry(record.controlGeometry, record.name);

  const move = page.locator('[data-stick="move"]');
  const look = page.locator('[data-stick="look"]');
  const capture = page.locator('[data-action="capture"]');
  const m = await move.boundingBox();
  const l = await look.boundingBox();
  const a = await capture.boundingBox();
  check(m && l && a, 'lab mobile: touch controls missing');
  const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const mc = center(m), lc = center(l), ac = center(a);
  const cdp = await page.context().newCDPSession(page);
  const movePoint = { id: 11, x: mc.x, y: mc.y, radiusX: 1, radiusY: 1, force: 1 };
  const lookPoint = { id: 12, x: lc.x, y: lc.y, radiusX: 1, radiusY: 1, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [movePoint, lookPoint] });
  const activeMove = { ...movePoint, x: mc.x, y: mc.y - 42 };
  const activeLook = { ...lookPoint, x: lc.x + 40, y: lc.y + 10 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [activeMove, activeLook] });
  await page.waitForTimeout(200);
  const dual = await diagnostics(page, 'lab');
  record.dualTouch = { controls: dual?.controls, touch: dual?.touch, camera: dual?.camera };
  check(Number.isFinite(dual?.controls?.throttle) && dual.controls.throttle > 0.1, 'lab: move stick up did not apply throttle');

  // Keep the movement finger held while releasing the look finger.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [activeLook] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [activeMove] });
  await page.waitForTimeout(120);
  const moveOnly = await diagnostics(page, 'lab');
  record.moveOnly = { controls: moveOnly?.controls, touch: moveOnly?.touch, camera: moveOnly?.camera };
  check(moveOnly?.controls && moveOnly.controls.throttle > 0.1, 'lab: releasing look finger cleared held move throttle');

  // Check a real steer response, then recenter horizontally so the tailwind fixture stays aligned.
  const steeredMove = { ...activeMove, x: mc.x + 22 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [steeredMove] });
  await page.waitForFunction(() => {
    const s = window.__navalLab?.snapshot();
    return s?.controls.steer > .1 && Math.abs(s?.helm?.steerAngle || 0) > .01;
  }, null, { timeout: 15000 });
  const steered = await diagnostics(page, 'lab');
  record.helmResponse = { controls: steered?.controls, helm: steered?.helm };
  check(Number.isFinite(steered?.helm?.steerAngle) && Math.abs(steered.helm.steerAngle) > 0.001,
    'lab: helm animation did not respond to steering input');
  checkHands(steered.helm);
  await screenshot(page, `${record.name}-helm`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [activeMove] });

  const before = await diagnostics(page, 'lab');
  const baseAttempt = before?.activity?.lastAttempt ?? -1;
  record.captureBaseline = { tick: before?.state?.tick, lastAttempt: baseAttempt, gust: before?.gust, wind: before?.wind, yaw: before?.state?.yaw };
  await page.waitForFunction(() => window.__navalLab?.snapshot?.()?.gust?.phase === 'window', null, { timeout: 90000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [activeMove, {
    id: 13, x: ac.x, y: ac.y, radiusX: 1, radiusY: 1, force: 1,
  }] });
  await page.waitForTimeout(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{
    id: 13, x: ac.x, y: ac.y, radiusX: 1, radiusY: 1, force: 1,
  }] });
  await page.waitForFunction(attempt => (window.__navalLab?.snapshot?.()?.activity?.lastAttempt ?? -1) > attempt,
    baseAttempt, { timeout: 15000 });
  const attempted = await diagnostics(page, 'lab');
  record.captureAttempt = {
    activity: attempted?.activity,
    gust: attempted?.gust,
    controls: attempted?.controls,
    helm: attempted?.helm,
  };
  check(attempted?.helm && Number.isFinite(attempted.helm.steerAngle) && Array.isArray(attempted.helm.sailAngles),
    'lab: capture attempt did not produce helm/sail diagnostics');
  check(attempted.helm.sailAngles.length > 0 && attempted.helm.sailAngles.every(Number.isFinite),
    'lab: sail animation diagnostics are empty or non-finite');
  await screenshot(page, `${record.name}-capture`);

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForFunction(() => {
    const s = window.__navalLab?.snapshot();
    return s?.touch?.pointers === 0 && Math.abs(s?.controls.throttle || 0) < .01 && Math.abs(s?.controls.steer || 0) < .01;
  }, null, { timeout: 15000 });
  const cancelled = await diagnostics(page, 'lab');
  record.cancelled = { controls: cancelled?.controls, touch: cancelled?.touch };
  check(cancelled?.controls && closeToZero(cancelled.controls.throttle) && closeToZero(cancelled.controls.steer),
    'lab: touchCancel did not neutralize controls');
  await cdp.detach();
  record.checks.push('tailwind gust action, held movement, helm/sail diagnostics, cancel neutralization and mobile bounds');
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
try {
  const cases = [
    { name: 'pilot-desktop-1280x800', kind: 'pilot', viewport: { width: 1280, height: 800 }, mobile: false, run: (page, record) => pilotCase(page, record, { mobile: false, name: 'pilot-desktop-1280x800' }) },
    { name: 'pilot-mobile-390x844', kind: 'pilot', viewport: { width: 390, height: 844 }, mobile: true, run: (page, record) => pilotCase(page, record, { mobile: true, name: 'pilot-mobile-390x844' }) },
    { name: 'pilot-mobile-844x390', kind: 'pilot', viewport: { width: 844, height: 390 }, mobile: true, run: (page, record) => pilotCase(page, record, { mobile: true, name: 'pilot-mobile-844x390' }) },
    { name: 'lab-mobile-844x390', kind: 'lab', viewport: { width: 844, height: 390 }, mobile: true, run: labMobileCase },
  ];
  await save();
  for (const spec of cases) {
    const record = await runCase(browser, spec);
    await save();
    process.stdout.write(`${record.status}: ${record.name}${record.failure ? ` — ${record.failure.split('\n')[0]}` : ''}\n`);
  }
  evidence.status = evidence.cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
} finally {
  await browser.close();
  evidence.finishedAt = new Date().toISOString();
  await save();
}

if (evidence.status !== 'passed') process.exitCode = 1;

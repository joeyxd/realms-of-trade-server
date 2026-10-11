// L01a local network rehearsal: an ordinary browser client sees a guest agent move.
// This is a guest-mode QA adapter, not server authorization or production agent access.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { fixtureGrant } from './agent/fixtures.mjs';
import { AgentNetworkClient } from './agent/network-client.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/delivery/l01a-agent-network');
const playwrightPath = process.env.MN_PLAYWRIGHT || path.join(root, '.scratch/pilot-browser/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const check = (value, message) => { if (!value) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const position = (v) => ({ x: v.x, y: v.y, z: v.z });
const evidence = {
  schema: 'l01a-agent-network-qa/v1', startedAt: new Date().toISOString(), status: 'running',
  scope: 'isolated local guest-mode client rehearsal; no real server grant, LLM, paid inference, production storage, dev commands, teleport, or gameplay authority claim',
  protocolVersion: PROTOCOL_VERSION, browser: { viewport: { width: 1280, height: 720 }, headless: true },
  server: { host: '127.0.0.1', dev: false, bots: 0, worldId: null, maxPlayers: 4 }, checks: [], failures: [],
};
let host, browser, context, agent;
const browserErrors = [];
const screenshotFiles = ['normal-client-agent-before-move.png', 'normal-client-agent-after-move.png'];

try {
  await fsp.mkdir(out, { recursive: true });
  for (const name of [...screenshotFiles, 'evidence.json']) await fsp.rm(path.join(out, name), { force: true });
  host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 4, dev: false,
    worldId: null, saveSecret: 'isolated-l01a-network-qa-only', log() {} });
  const port = await host.listen();
  const baseUrl = `http://127.0.0.1:${port}/?q=low`;
  evidence.server.port = port;
  evidence.server.started = true;

  const browserArgs = ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'];
  evidence.browser = { ...evidence.browser, channel: 'chrome', headless: true, renderer: 'browser-default-angle', args: browserArgs };
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: browserArgs });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });

  // Use checked-in Three.js and the already-present local GSAP package. No CDN download is needed.
  await page.route(/https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(?:three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const url = route.request().url();
    const match = url.match(/(?:three@0\.160\.0|gsap@3\.12\.5)\/(.*)$/);
    const pkg = url.includes('three@0.160.0') ? 'node_modules/three' : '.scratch/gsap-local/package';
    const file = path.resolve(root, pkg, match?.[1] || '');
    const pkgRoot = path.resolve(root, pkg) + path.sep;
    if (!file.startsWith(pkgRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      await route.fulfill({ status: 404, body: '' }); return;
    }
    await route.fulfill({ status: 200, contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 45000 });
  await page.locator('#title-name').fill('Observador');
  await page.locator('#btn-play').click({ force: true }); // The normal play button has an intentional endless pulse tween.
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 25000 });
  await page.waitForFunction(() => window.__mn?.client?.ptCur > 0, null, { timeout: 10000 });
  await page.waitForTimeout(2200); // Let the normal title-card exit animation complete.
  const human = await page.evaluate(() => ({ id: window.__mn.client.youServer, name: window.__mn.client.entities.get(window.__mn.client.youServer)?.name,
    mode: window.__mn.st.mode, position: { x: window.__mn.ps.x, y: window.__mn.ps.y, z: window.__mn.ps.z } }));
  check(human.name === 'Observador' && human.mode === 'playing', 'browser did not join through the normal online UI');
  evidence.human = human;
  evidence.checks.push({ id: 'normal-browser-join', passed: true, mode: human.mode, characterName: human.name, entityId: human.id });

  const scope = { ownerId: 'qa-owner', characterId: 'brisa-agent', worldId: 'l01a-local', sessionId: 'l01a-session' };
  const grant = fixtureGrant({ scope, controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: ['move', 'attack_pve'] });
  const feedback = [];
  agent = new AgentNetworkClient({ url: `ws://127.0.0.1:${port}/ws`, grant, name: 'Brisa IA', skin: 0,
    onFeedback: (item) => feedback.push(structuredClone(item)) });
  const admitted = await agent.connect({ timeoutMs: 10000, autoTick: true });
  check(admitted.identity.mode === 'guest' && admitted.identity.authorization === 'local', 'agent did not identify itself as local guest');
  check(host.game.status().players === 2, 'agent did not consume an ordinary player slot');
  evidence.agent = { identity: admitted.identity, state: agent.state, grantCapabilities: agent.grant.capabilities,
    serverPlayers: host.game.status().players, observationSource: admitted.observation.source };
  evidence.checks.push({ id: 'guest-normal-slot', passed: true, playerSlotsUsed: host.game.status().players,
    serverAuthorization: 'not asserted; guest HELLO and local adapter scope only' });

  const humanNearby = agent.observation.confirmed.entities.find((entity) => entity.kind === 'player' &&
    Math.hypot(entity.position.x - agent.observation.confirmed.self.position.x, entity.position.z - agent.observation.confirmed.self.position.z) < 8);
  check(humanNearby, 'the same-spawn human was not present in the agent observation within the PvE safety radius');
  const practiceTarget = agent.observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
  check(practiceTarget, 'no observable enemy target is available for the no-pulse PvE safety check');
  const denied = agent.order({ v: 1, actionId: 'l01a-no-pve-near-human', scope, controlRevision: 1,
    observationRevision: agent.observation.revision, type: 'attack_pve', args: { target: practiceTarget.ref, durationMs: 250 } });
  check(!denied.ok && denied.why === 'pve_player_nearby', `PvE safety check did not reject the nearby human: ${JSON.stringify(denied)}`);
  evidence.checks.push({ id: 'pve-not-pulsed-near-human', passed: true, result: denied,
    nearbyHuman: { entityId: humanNearby.ref.entityId, distance: Math.hypot(humanNearby.position.x - agent.observation.confirmed.self.position.x, humanNearby.position.z - agent.observation.confirmed.self.position.z) } });

  // Use ordinary human WASD input to clear the overlapping spawn nameplate and frame the agent.
  await page.waitForFunction(() => window.__mn?.input?.enabled === true, null, { timeout: 12000 });
  const humanMoveStart = await page.evaluate(() => ({ x: window.__mn.ps.x, z: window.__mn.ps.z, tick: window.__mn.client.ptCur }));
  await page.locator('#game').focus();
  await page.locator('#game').hover();
  await page.keyboard.down('KeyD');
  try {
    await page.waitForFunction((start) => Math.hypot(window.__mn.ps.x - start.x, window.__mn.ps.z - start.z) > 4.0,
      humanMoveStart, { timeout: 10000 });
  } catch (error) {
    evidence.inputDiagnostic = await page.evaluate((start) => ({ start, end: { x: window.__mn.ps.x, z: window.__mn.ps.z },
      enabled: window.__mn.input.enabled, keys: [...window.__mn.input.keys], mode: window.__mn.st.mode,
      camera: { dist: window.__mn.world.rig.dist, distTarget: window.__mn.world.rig.distTarget, zoomIdx: window.__mn.world.rig.zoomIdx,
        blend: window.__mn.world.rig.blend } }), humanMoveStart);
    throw error;
  } finally { await page.keyboard.up('KeyD'); }
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__mn?.world?.rig?.blend === null, null, { timeout: 30000 });
  evidence.human.normalUiMovement = await page.evaluate((start) => ({ start, end: { x: window.__mn.ps.x, z: window.__mn.ps.z },
    displacement: Math.hypot(window.__mn.ps.x - start.x, window.__mn.ps.z - start.z), zoomIdx: window.__mn.world.rig.zoomIdx,
    distTarget: window.__mn.world.rig.distTarget, titleOverlay: { hidden: document.querySelector('#title')?.hidden,
      display: getComputedStyle(document.querySelector('#title')).display, opacity: getComputedStyle(document.querySelector('#title')).opacity } }), humanMoveStart);
  check(evidence.human.normalUiMovement.displacement > 4.0, 'browser human movement did not use normal input');
  await page.waitForFunction((tick) => window.__mn?.client?.ptCur > tick, humanMoveStart.tick, { timeout: 10000 });

  await page.waitForFunction((name) => [...window.__mn.client.entities.values()].some((r) => r.human && r.name === name && r.ready), 'Brisa IA', { timeout: 10000 });
  const remoteBefore = await page.evaluate((name) => {
    const rec = [...window.__mn.client.entities.values()].find((r) => r.human && r.name === name && r.ready);
    const plate = [...document.querySelectorAll('.nameplate')].find((el) => el.textContent.includes(name));
    return rec ? { id: rec.id, name: rec.name, human: rec.human, kind: rec.kind, ready: rec.ready,
      position: { x: rec.r.x, y: rec.r.y, z: rec.r.z }, viewVisible: !!rec.view?.root?.visible,
      nameplatePresent: !!plate, nameplateText: plate?.textContent?.trim() || null } : null;
  }, 'Brisa IA');
  check(remoteBefore?.human && remoteBefore.nameplatePresent, 'human browser did not render the agent as a named human player');
  evidence.checks.push({ id: 'human-sees-agent-before-move', passed: true, entity: remoteBefore });
  await page.waitForTimeout(3000); // Let the ordinary boarding toast clear before the baseline capture.
  await page.locator('#game').hover();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'normal-client-agent-before-move.png'), animations: 'disabled' });

  const start = position(agent.observation.confirmed.self.position);
  const moves = [];
  let previousRemote = remoteBefore.position, remoteAfter;
  for (let index = 0; index < 3; index++) {
    const order = { v: 1, actionId: `l01a-move-${index + 1}-500ms`, scope, controlRevision: 1,
      observationRevision: agent.observation.revision, type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } };
    const accepted = agent.order(order);
    check(accepted.ok, `agent movement order rejected: ${JSON.stringify(accepted)}`);
    const deadline = Date.now() + 12000;
    let action;
    while (Date.now() < deadline) {
      action = agent.actions.find((item) => item.order.actionId === order.actionId);
      if (action?.effects?.some((item) => item.code === 'position_observed')) break;
      if (agent.state === 'stopped') throw new Error('agent stopped before movement feedback');
      await sleep(50);
    }
    const effect = action?.effects?.find((item) => item.code === 'position_observed');
    check(effect?.outcome === 'partial' && action.state !== 'confirmed', 'movement feedback was not explicitly partial');
    const end = position(agent.observation.confirmed.self.position);
    const serverDelta = Math.hypot(end.x - start.x, end.z - start.z);
    check(serverDelta > 0.1, `server position did not show movement (${serverDelta})`);
    moves.push({ order: { actionId: order.actionId, durationMs: order.args.durationMs, accepted: accepted.ok },
      serverObserved: end, cumulativeServerDisplacement: serverDelta, feedback: effect, actionState: action.state });

    await page.waitForFunction(({ id, previous }) => {
      const rec = window.__mn?.client?.entities?.get(id);
      return rec?.ready && Math.hypot(rec.r.x - previous.x, rec.r.z - previous.z) > 0.1;
    }, { id: admitted.identity.entityId, previous: previousRemote }, { timeout: 12000 });
    await page.waitForTimeout(300);
    remoteAfter = await page.evaluate((id) => {
      const rec = window.__mn.client.entities.get(id);
      const plate = [...document.querySelectorAll('.nameplate')].find((el) => el.textContent.includes('Brisa IA'));
      const box = plate?.getBoundingClientRect();
      return { id: rec?.id, name: rec?.name, human: rec?.human, kind: rec?.kind, ready: rec?.ready,
        position: rec ? { x: rec.r.x, y: rec.r.y, z: rec.r.z } : null, viewVisible: !!rec?.view?.root?.visible,
        nameplatePresent: !!plate, nameplateText: plate?.textContent?.trim() || null,
        nameplateVisible: !!plate && !plate.hidden && getComputedStyle(plate).display !== 'none' && box.width > 0 && box.height > 0,
        nameplateBox: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null };
    }, admitted.identity.entityId);
    if (remoteAfter.nameplateVisible) break;
    previousRemote = remoteAfter.position;
  }
  const end = moves.at(-1).serverObserved;
  const serverDelta = Math.hypot(end.x - start.x, end.z - start.z);
  const effect = moves[0].feedback;
  check(remoteAfter?.nameplateVisible, 'agent nameplate stayed hidden in the normal human viewport after bounded movement');
  const clientDelta = Math.hypot(remoteAfter.position.x - remoteBefore.position.x, remoteAfter.position.z - remoteBefore.position.z);
  check(remoteAfter.human && remoteAfter.name === 'Brisa IA' && remoteAfter.nameplatePresent && remoteAfter.viewVisible,
    'browser no longer renders the remote agent character/nameplate after movement');
  const clientDot = (remoteAfter.position.x - remoteBefore.position.x) * (end.x - start.x) +
    (remoteAfter.position.z - remoteBefore.position.z) * (end.z - start.z);
  check(clientDelta > 0.1 && clientDot > 0, 'browser interpolated entity did not move in the server-observed direction');
  await page.screenshot({ path: path.join(out, 'normal-client-agent-after-move.png'), animations: 'disabled' });

  evidence.movement = { firstOrder: moves[0].order, start, serverObserved: end, serverDisplacement: serverDelta, moves,
    feedback: effect, actionState: moves[0].actionState, humanClientBefore: remoteBefore, humanClientAfter: remoteAfter,
    humanClientDisplacement: clientDelta, clientServerDisplacementGap: Math.hypot(remoteAfter.position.x - end.x, remoteAfter.position.z - end.z),
    feedbackInterpretation: 'Each result is partial observed position change only; no arrival or exclusive causality claim.' };
  evidence.checks.push({ id: '500ms-move-visible-to-human', passed: true, serverDisplacement: serverDelta,
    browserInterpolatedDisplacement: clientDelta, feedbackOutcome: effect.outcome, feedbackCode: effect.code });
  evidence.browser = { ...evidence.browser, errors: browserErrors, title: await page.title(), screenshotViewport: { width: 1280, height: 720 } };
  check(browserErrors.length === 0, `browser reported runtime errors: ${browserErrors.join(' | ')}`);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failures.push({ message: String(error?.message || error), stack: error?.stack || null });
} finally {
  const cleanupError = async (operation, fn) => {
    try { await fn(); }
    catch (error) { evidence.failures.push({ phase: 'cleanup', operation, message: String(error?.message || error) }); evidence.status = 'failed'; }
  };
  await cleanupError('agent.close', () => agent?.close());
  await cleanupError('browser-context.close', () => context?.close());
  await cleanupError('browser.close', () => browser?.close());
  if (host) {
    try { await host.close(); evidence.server.stopped = true; }
    catch (error) { evidence.failures.push({ phase: 'cleanup', operation: 'server.close', message: String(error?.message || error) }); evidence.status = 'failed'; }
  }
  evidence.browser = { ...evidence.browser, errors: browserErrors };
  evidence.screenshots = [];
  for (const name of screenshotFiles) {
    const file = path.join(out, name);
    try {
      const bytes = await fsp.readFile(file);
      evidence.screenshots.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) {
      if (error?.code !== 'ENOENT') evidence.failures.push({ phase: 'evidence', file: name, message: String(error?.message || error) });
    }
  }
  if (evidence.failures.length) evidence.status = 'failed';
  evidence.finishedAt = new Date().toISOString();
  await fsp.writeFile(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}

if (evidence.status !== 'passed') {
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: evidence.status, evidence: path.join(out, 'evidence.json'),
    screenshots: ['normal-client-agent-before-move.png', 'normal-client-agent-after-move.png'], checks: evidence.checks }, null, 2));
}

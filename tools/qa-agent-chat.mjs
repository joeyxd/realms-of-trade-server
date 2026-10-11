// L01b local C01 chat rehearsal: ordinary browser guests exchange chat with a guest agent.
// This is a scripted local QA adapter, not server authorization, an LLM, or a production pilot.
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
const out = path.join(root, 'docs/delivery/l01b-agent-chat');
const playwrightPath = process.env.MN_PLAYWRIGHT || path.join(root, '.scratch/pilot-browser/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const check = (value, message) => { if (!value) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = {
  schema: 'l01b-agent-chat-qa/v1', startedAt: new Date().toISOString(), status: 'running',
  scope: 'isolated local guest-mode C01 chat rehearsal; scripted responses, no LLM/provider, paid inference, persistent storage, dev commands, teleport, ECS mutation, or gameplay-authority claim',
  protocolVersion: PROTOCOL_VERSION,
  browser: { channel: 'chrome', headless: true, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  server: { host: '127.0.0.1', dev: false, bots: 0, worldId: null, maxPlayers: 4 }, checks: [], failures: [],
};
let host, browser, agent;
const pages = [];
const contexts = [];
const browserErrors = [];
const screenshotFiles = ['chat-world-cerca.png', 'chat-private-route.png'];
const scope = { ownerId: 'qa-owner', characterId: 'brisa-agent', worldId: 'l01b-local', sessionId: 'l01b-session' };
const messages = {
  humanWorld: 'QA humana a Brisa: ¿estás en el mundo?',
  agentWorld: 'Sí, Observador. Te leo desde el canal Mundo.',
  agentLocal: 'Aquí Brisa IA, cerca de tu personaje.',
  humanWhisper: 'Brisa, este mensaje es solo para ti.',
  agentWhisper: 'Recibido en privado, Observador.',
};

async function waitFor(predicate, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    if (agent?.state === 'stopped') throw new Error(`agent stopped while waiting for ${label}`);
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function joinHuman(name) {
  const context = await browser.newContext({ viewport: evidence.browser.viewport, deviceScaleFactor: 1 });
  contexts.push(context);
  await configureContext(context);
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (error) => browserErrors.push(`${name} pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`${name} console: ${message.text()}`); });
  await page.goto(evidence.browser.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 45000 });
  await page.locator('#title-name').fill(name);
  await page.locator('#btn-play').click({ force: true }); // The title play button has an intentional pulse tween.
  try {
    await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing', null, { timeout: 25000 });
  } catch (error) {
    evidence.joinDiagnostics ??= [];
    evidence.joinDiagnostics.push({ requestedName: name, serverPlayers: host?.game?.status?.().players ?? null,
      page: await page.evaluate(() => ({ url: location.href, title: document.title,
        mode: window.__mn?.st?.mode ?? null, joined: window.__mn?.client?.joined ?? null,
        youServer: window.__mn?.client?.youServer ?? null, inputEnabled: window.__mn?.input?.enabled ?? null,
        titleOverlay: { hidden: document.querySelector('#title')?.hidden ?? null,
          display: document.querySelector('#title') ? getComputedStyle(document.querySelector('#title')).display : null },
        playDisabled: document.querySelector('#btn-play')?.disabled ?? null,
        consoleStatus: document.querySelector('#status')?.textContent ?? null })) });
    throw error;
  }
  await page.waitForFunction(() => !!document.querySelector('.mn-chat-toggle') && !document.querySelector('.mn-chat')?.hidden, null, { timeout: 15000 });
  await page.locator('.mn-chat-toggle').click();
  await page.locator('.mn-chat-panel').waitFor({ state: 'visible' });
  const info = await page.evaluate(() => ({
    name: window.__mn.client.entities.get(window.__mn.client.youServer)?.name,
    mode: window.__mn.st.mode,
    position: { x: window.__mn.ps.x, y: window.__mn.ps.y, z: window.__mn.ps.z },
    chat: { panelOpen: !document.querySelector('.mn-chat-panel').hidden, state: document.querySelector('.mn-chat-status')?.textContent || '' },
  }));
  check(info.name === name && info.mode === 'playing' && info.chat.panelOpen, `${name} did not join through the ordinary UI with chat open`);
  return { page, info };
}

async function sendHuman(page, channel, text, recipientName = null) {
  await page.locator('.mn-chat-channel').selectOption(channel);
  if (channel === 'whisper') await page.locator('.mn-chat-target').selectOption({ label: recipientName });
  await page.locator('.mn-chat-input').fill(text);
  await page.locator('.mn-chat-send').click();
  await page.waitForFunction(() => document.querySelector('.mn-chat-status')?.dataset.tone === 'success', null, { timeout: 10000 });
  return page.locator('.mn-chat-status').textContent();
}

async function visibleLines(page) {
  return page.locator('.mn-chat-line').evaluateAll((rows) => rows.map((row) => ({
    channel: [...row.classList].find((name) => name.startsWith('mn-chat-') && name !== 'mn-chat-line')?.replace('mn-chat-', ''),
    sender: row.querySelector('.mn-chat-who')?.textContent?.trim() || '',
    text: row.querySelector('.mn-chat-text')?.textContent || '',
  })));
}

async function waitLine(page, text, label) {
  await page.waitForFunction((expected) => [...document.querySelectorAll('.mn-chat-text')].some((el) => el.textContent === expected), text, { timeout: 12000 });
  const lines = await visibleLines(page);
  const line = lines.find((item) => item.text === text);
  check(line, `${label} did not appear in the rendered chat panel`);
  return line;
}

async function configureContext(context) {
  // Reuse local packages for pinned runtime CDN requests; no network dependency is needed.
  await context.route(/https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(?:three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
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
  await context.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}

async function sendAgent(channel, text, target = null) {
  const observation = agent.observation;
  check(observation?.revision > 0, 'agent has no fresh server observation for a chat order');
  const actionId = `l01b-${channel}-${String(evidence.agent?.orders?.length + 1 || 1).padStart(2, '0')}`;
  const order = { v: 1, actionId, scope, controlRevision: agent.grant.controlRevision,
    observationRevision: observation.revision, type: 'chat_send', args: { channel, text, target } };
  const accepted = agent.sendChat(order);
  check(accepted.ok, `agent ${channel} order rejected locally: ${JSON.stringify(accepted)}`);
  const request = await waitFor(() => agent.chat.requests.find((item) => item.order?.actionId === actionId && item.state === 'routed'), `${channel} request routed`);
  check(request.result?.ok === true && request.result.read === 'unknown', `${channel} routed result did not preserve read=unknown`);
  evidence.agent.orders ??= [];
  evidence.agent.orders.push({ actionId, channel, text, target, accepted: accepted.ok, state: request.state,
    result: request.result, attempts: request.attempts });
  return request;
}

try {
  await fsp.mkdir(out, { recursive: true });
  for (const name of [...screenshotFiles, 'evidence.json']) await fsp.rm(path.join(out, name), { force: true });
  host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 4, dev: false,
    worldId: null, saveSecret: 'isolated-l01b-chat-qa-only', log() {} });
  const port = await host.listen();
  evidence.server.port = port;
  evidence.server.started = true;
  const baseUrl = `http://127.0.0.1:${port}/?q=low`;
  evidence.browser.baseUrl = baseUrl;

  const browserArgs = ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'];
  evidence.browser.args = browserArgs;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: browserArgs });

  const human = await joinHuman('Observador');
  const outsider = await joinHuman('Viajero externo');
  evidence.humans = [human.info, outsider.info];
  check(host.game.status().players === 2, 'two regular browser guests did not occupy ordinary player slots');

  const feedback = [];
  const grant = fixtureGrant({ scope, controlRevision: 1, expiresAtMs: Date.now() + 120000, capabilities: ['chat'] });
  agent = new AgentNetworkClient({ url: `ws://127.0.0.1:${port}/ws`, grant, name: 'Brisa IA', skin: 0,
    onFeedback: (item) => feedback.push(structuredClone(item)) });
  const admitted = await agent.connect({ timeoutMs: 10000, autoTick: true });
  check(admitted.identity.mode === 'guest' && admitted.identity.authorization === 'local', 'agent did not identify as local guest');
  const initialChat = await waitFor(() => {
    const state = agent.chat;
    return state?.available && state.config?.enabled ? state : null;
  }, 'agent C01 chat state');
  check(initialChat.peers.filter((peer) => ['Observador', 'Viajero externo'].includes(peer.name)).length === 2,
    'agent C01 peer list did not include both ordinary browser guests');
  evidence.agent = { identity: admitted.identity, state: agent.state, grantCapabilities: agent.grant.capabilities,
    chat: { available: initialChat.available, self: initialChat.self, peerNames: initialChat.peers.map((peer) => peer.name),
      config: initialChat.config, historyGap: initialChat.historyGap, historyBeforeSession: initialChat.historyBeforeSession,
      durability: initialChat.durability }, serverPlayers: host.game.status().players,
    observationSource: admitted.observation.source };

  await sendHuman(human.page, 'world', messages.humanWorld);
  const humanWorldReceived = await waitFor(() => agent.chat.messages.find((message) => message.text === messages.humanWorld), 'agent receives human world message');
  check(humanWorldReceived.channel === 'world' && humanWorldReceived.sender.name === 'Observador', 'agent world message lost its human identity/channel');
  await sendAgent('world', messages.agentWorld);
  const renderedAgentWorld = await waitLine(human.page, messages.agentWorld, 'named agent world response');
  const outsiderWorld = await waitLine(outsider.page, messages.agentWorld, 'outsider world delivery');

  await sendAgent('local', messages.agentLocal);
  const renderedAgentLocal = await waitLine(human.page, messages.agentLocal, 'named agent local response');
  const outsiderLocal = await waitLine(outsider.page, messages.agentLocal, 'outsider local delivery');
  check(renderedAgentWorld.sender === 'Brisa IA' && renderedAgentLocal.sender === 'Brisa IA', 'normal panel did not show the named agent sender');
  check(outsiderWorld.channel === 'world' && outsiderLocal.channel === 'local', 'outsider did not render actual world/local deliveries');
  evidence.checks.push({ id: 'ordinary-human-to-agent-world', passed: true, received: { channel: humanWorldReceived.channel,
    sender: humanWorldReceived.sender.name, text: humanWorldReceived.text } });
  evidence.checks.push({ id: 'agent-world-local-visible-to-human-and-outsider', passed: true,
    humanRendered: [renderedAgentWorld, renderedAgentLocal], outsiderRendered: [outsiderWorld, outsiderLocal] });
  await human.page.screenshot({ path: path.join(out, 'chat-world-cerca.png'), animations: 'disabled' });

  await sendHuman(human.page, 'whisper', messages.humanWhisper, 'Brisa IA');
  const humanWhisperReceived = await waitFor(() => agent.chat.messages.find((message) => message.text === messages.humanWhisper), 'agent receives human whisper');
  check(humanWhisperReceived.channel === 'whisper' && humanWhisperReceived.sender.name === 'Observador' &&
    humanWhisperReceived.target?.id === initialChat.self, 'agent whisper did not preserve sender and recipient identity');
  const humanPeer = initialChat.peers.find((peer) => peer.name === 'Observador');
  check(humanPeer?.id, 'agent did not have an opaque peer connection id for the human whisper reply');
  await sendAgent('whisper', messages.agentWhisper, humanPeer.id);
  const renderedAgentWhisper = await waitLine(human.page, messages.agentWhisper, 'human receives agent whisper reply');
  check(renderedAgentWhisper.channel === 'whisper' && renderedAgentWhisper.sender.startsWith('Brisa IA'), 'private panel reply was not attributed to Brisa IA');
  const outsiderLines = await visibleLines(outsider.page);
  check(!outsiderLines.some((line) => line.channel === 'whisper' && [messages.humanWhisper, messages.agentWhisper].includes(line.text)),
    'outsider received one of the private messages');
  check(agent.chat.messages.some((message) => message.channel === 'whisper' && message.sender.name === 'Observador' && message.text === messages.humanWhisper),
    'agent state omitted the delivered human whisper');
  evidence.checks.push({ id: 'human-agent-private-roundtrip-outsider-excluded', passed: true,
    agentReceived: { channel: humanWhisperReceived.channel, sender: humanWhisperReceived.sender.name, target: humanWhisperReceived.target.name, text: humanWhisperReceived.text },
    humanRendered: renderedAgentWhisper, outsiderPrivateLines: outsiderLines.filter((line) => line.channel === 'whisper') });
  await human.page.locator('.mn-chat-channel').selectOption('whisper');
  await human.page.waitForTimeout(200);
  await human.page.screenshot({ path: path.join(out, 'chat-private-route.png'), animations: 'disabled' });

  const resultEvents = feedback.filter((item) => item.type === 'chat_result').map((item) => item.data);
  const messageEvents = feedback.filter((item) => item.type === 'chat_message').map((item) => item.data);
  check(resultEvents.length >= 3 && resultEvents.every((item) => item.state === 'routed' && item.result?.read === 'unknown'),
    `expected routed/read-unknown feedback for all agent sends; saw ${JSON.stringify(resultEvents)}`);
  evidence.agent.feedback = { chatResultSchema: resultEvents, chatMessageSchema: messageEvents.map((item) => ({
    message: item.message, fromHistory: item.fromHistory, historyGap: item.historyGap, trust: item.trust,
  })) };
  evidence.agent.chatFinal = { state: agent.state, chat: agent.chat, observationChat: agent.observation.chat,
    pendingId: agent.chat.pendingId, historyGap: agent.chat.historyGap };
  evidence.server.playersAtEnd = host.game.status().players;
  evidence.browser = { ...evidence.browser, title: await human.page.title(), errors: browserErrors };
  evidence.checks.push({ id: 'routed-feedback-read-is-unknown', passed: true, routedResults: resultEvents.length,
    requestStates: evidence.agent.orders.map((item) => item.state), read: resultEvents.map((item) => item.result.read) });
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
  for (const page of pages) await cleanupError('browser-page.close', () => page.close());
  for (const context of contexts) await cleanupError('browser-context.close', () => context.close());
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
    screenshots: screenshotFiles, checks: evidence.checks }, null, 2));
}

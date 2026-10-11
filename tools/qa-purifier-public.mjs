#!/usr/bin/env node
// Read-only public guest smoke for the RNV06 purifier release. No authenticated account or gameplay writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const requireValue = (value, message) => { if (!value) throw new Error(message); };
requireValue(process.env.MN_QA_ALLOW_BROWSER === '1', 'Public browser QA guard is active. Set MN_QA_ALLOW_BROWSER=1 after release confirmation.');
const expectedRevision = process.env.MN_QA_EXPECT_REVISION || '';
const confirmedRevision = process.env.MN_QA_ACTIVE_REVISION || '';
requireValue(/^[0-9a-f]{7,40}$/i.test(expectedRevision) && expectedRevision === confirmedRevision,
  'Set MN_QA_EXPECT_REVISION and MN_QA_ACTIVE_REVISION to the same root-confirmed active revision before public browser QA.');
const target = new URL(process.env.MN_QA_PUBLIC_TARGET || 'https://marea.62.171.136.148.sslip.io');
requireValue(target.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(target.hostname), 'Public smoke requires an HTTPS deployment target.');
target.username = ''; target.password = ''; target.search = ''; target.hash = '';
const basePath = target.pathname.replace(/\/$/, '');
const origin = target.origin;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sibling = path.resolve(repo, '..', 'realms-of-trade-server');
const playwrightFile = path.resolve(process.env.MN_PLAYWRIGHT || path.resolve(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const output = path.resolve(repo, process.env.MN_QA_PUBLIC_OUT || 'docs/delivery/rnv06-purifier/public');
await fs.mkdir(output, { recursive: true });
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = {
  schema: 'marea.rnv06.purifier.public-guest-smoke.v1', generatedAt: new Date().toISOString(), origin,
  releaseRevision: expectedRevision, revisionConfirmation: 'supplied by root after VPS active-image confirmation',
  expectedGameVersion: GAME.version, expectedProtocol: PROTOCOL_VERSION,
  scope: 'Public unauthenticated guest page, normal play and WSS join, minimap/full map, and read-only purifier palette inspection when the normal build launcher is available. No account, database fixture, build placement, economy advance, or cargo mutation.',
  status: 'running', checks: {}, screenshots: [], browserErrors: [], consoleErrors: [], failedRequests: [], httpFailures: [], websocket: [], failure: null,
};
const evidencePath = path.resolve(output, `evidence-${runTag}.json`);
const healthUrl = new URL(`${basePath}/health`, target);
const statusUrl = new URL(`${basePath}/status`, target);
const protocolUrl = new URL(`${basePath}/src/net/protocol.js`, target);
const timeout = ms => AbortSignal.timeout(ms);
let browser, context, page;
try {
  const [healthResponse, statusResponse, protocolResponse] = await Promise.all([
    fetch(healthUrl, { cache: 'no-store', signal: timeout(15000) }),
    fetch(statusUrl, { cache: 'no-store', signal: timeout(15000) }),
    fetch(protocolUrl, { cache: 'no-store', signal: timeout(15000) }),
  ]);
  requireValue(healthResponse.ok && (await healthResponse.text()).trim() === 'ok', 'public /health is not healthy');
  const status = await statusResponse.json();
  requireValue(statusResponse.ok && status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0,
    `public preflight must be the expected release with zero current players/sockets/errors: ${JSON.stringify({ version: status.version, players: status.players, sockets: status.sockets, errors: status.errors })}`);
  const protocolText = await protocolResponse.text();
  requireValue(protocolResponse.ok && protocolText.includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`), 'deployed protocol source does not match this release');
  evidence.preflight = { health: healthResponse.status, status: { version: status.version, players: status.players,
    sockets: status.sockets, errors: status.errors, tick: status.tick }, protocolVersion: PROTOCOL_VERSION };
  evidence.checks.publicPreflight = true;

  browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: path.resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }), headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'es-MX' });
  page = await context.newPage();
  page.on('pageerror', error => evidence.browserErrors.push(String(error?.stack || error)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', response => { if (response.status() >= 400) evidence.httpFailures.push({ url: response.url(), status: response.status() }); });
  page.on('websocket', socket => {
    const record = { url: socket.url(), welcomes: [], protocolErrors: [] };
    evidence.websocket.push(record);
    socket.on('framereceived', payload => {
      try {
        const message = JSON.parse(typeof payload === 'string' ? payload : String(payload));
        if (message?.t === 'welcome') record.welcomes.push({ version: message.v, tick: message.tick, you: Number.isSafeInteger(message.you) });
        if (message?.t === 'error' && message?.code === 'version') record.protocolErrors.push(message.code);
      } catch { /* Binary or unrelated frames are not relevant to the join proof. */ }
    });
  });

  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 120000 });
  const titleVersion = await page.locator('.title-foot').innerText();
  requireValue(titleVersion.includes(GAME.version), `public title does not show expected version ${GAME.version}: ${titleVersion}`);
  await page.locator('.title-language [data-locale="es"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'es', null, { timeout: 5000 });
  await page.locator('#btn-play').click();
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn?.st?.mode === 'playing' && window.__mn?.input?.enabled,
    null, { timeout: 60000 });
  const joined = await page.evaluate(() => ({ player: window.__mn.client.youServer, online: window.__mn.st.online,
    wsOpen: window.__mn.transport?.ws?.readyState === WebSocket.OPEN, account: window.__mn.accountAuth?.state?.guestChoice,
    worldVersion: window.__mn.gameVersion, protocolVersion: window.__mn.protocolVersion }));
  requireValue(joined.online && joined.wsOpen, `normal guest play did not retain a live WSS session: ${JSON.stringify(joined)}`);
  requireValue(evidence.websocket.some(record => record.url.startsWith('wss://')),
    'normal play did not establish a public WSS connection');
  evidence.checks.normalGuestPlayAndWssJoin = true;
  evidence.join = { player: joined.player, online: joined.online, websocketOpen: joined.wsOpen,
    guestChoice: joined.account === true, protocolVersionFromPublicSource: PROTOCOL_VERSION };
  evidence.screenshots.push(`purifier-public-${runTag}-01-guest-world.jpg`);
  await page.screenshot({ path: path.resolve(output, evidence.screenshots.at(-1)), type: 'jpeg', quality: 88 });

  const mini = page.locator('.world-minimap');
  await mini.waitFor({ state: 'visible', timeout: 15000 });
  await mini.click();
  await page.locator('#mapview .mapv[role="dialog"]').waitFor({ state: 'visible', timeout: 10000 });
  const mapTitle = await page.locator('#mapview .mapv-title').innerText();
  evidence.checks.minimapOpensFullMap = true;
  evidence.map = { minimapVisible: true, fullMapVisible: true, title: mapTitle };
  evidence.screenshots.push(`purifier-public-${runTag}-02-full-map.jpg`);
  await page.screenshot({ path: path.resolve(output, evidence.screenshots.at(-1)), type: 'jpeg', quality: 88 });
  await page.locator('#mapview [data-close]').click();

  const launcher = page.locator('.raft-build-launcher');
  let purifierPalette = { available: false, reason: 'normal builder launcher was not visible in the guest spawn context' };
  if (await launcher.count() && await launcher.isVisible()) {
    await launcher.click();
    await page.locator('.raft-editor').waitFor({ state: 'visible', timeout: 10000 });
    const purifier = page.locator('.raft-editor [data-part="purifier"]');
    purifierPalette.available = await purifier.count() === 1 && await purifier.isVisible();
    purifierPalette.reason = purifierPalette.available ? '' : 'editor opened but purifier palette item was absent';
    if (purifierPalette.available) {
      purifierPalette.label = await purifier.innerText();
      evidence.screenshots.push(`purifier-public-${runTag}-03-builder-purifier-palette.jpg`);
      await page.screenshot({ path: path.resolve(output, evidence.screenshots.at(-1)), type: 'jpeg', quality: 88 });
    }
    await page.locator('.raft-editor .re-close').click();
  }
  evidence.builderPalette = purifierPalette;
  evidence.checks.builderPaletteInspectable = purifierPalette.available;

  const finalBrowser = { width: await page.evaluate(() => innerWidth), height: await page.evaluate(() => innerHeight),
    pageErrors: evidence.browserErrors.length, consoleErrors: evidence.consoleErrors.length,
    failedRequests: evidence.failedRequests.length, httpFailures: evidence.httpFailures.length };
  requireValue(!finalBrowser.pageErrors && !finalBrowser.consoleErrors && !finalBrowser.failedRequests && !finalBrowser.httpFailures,
    `browser errors or failed requests: ${JSON.stringify(finalBrowser)}`);
  evidence.finalStatus = { playerStillJoined: await page.evaluate(() => window.__mn?.client?.joined === true), browser: finalBrowser };
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = String(error?.stack || error);
  if (page && !page.isClosed()) {
    try {
      const file = `purifier-public-${runTag}-failure.jpg`;
      await page.screenshot({ path: path.resolve(output, file), type: 'jpeg', quality: 88 }); evidence.screenshots.push(file);
    } catch { /* Preserve the primary smoke failure if capture is unavailable. */ }
  }
  process.exitCode = 1;
} finally {
  try { await page?.close(); } catch {}
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
  try {
    const statusResponse = await fetch(statusUrl, { cache: 'no-store', signal: timeout(10000) });
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      evidence.afterClose = { players: status.players, sockets: status.sockets, errors: status.errors };
    }
  } catch { /* The primary report already records browser and public-service outcomes. */ }
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: evidence.status, evidence: evidencePath, checks: evidence.checks, failure: evidence.failure }));
}

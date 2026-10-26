#!/usr/bin/env node
// SK04c browser QA of the skills sheet with the skill operations flag ON (and one locked check with it OFF), local only.
// Per viewport: one disposable memory-backed host with an account, a seeded character with free combat points, the
// sheet opened, the cell `lunge` selected, "Subir" pressed, the server ack and both profiles (client, server) checked.
// Usage: MN_QA_ALLOW_BROWSER=1 [MN_PLAYWRIGHT=<playwright index.mjs>] [MN_QA_OUT=.scratch/qa-skill-ops] node tools/qa-skill-ops.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { GAME } from '../src/data/meta.js';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Browser QA launch guard is active. Set MN_QA_ALLOW_BROWSER=1 to launch this disposable local harness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(repo, '..', 'realms-of-trade-server');
const out = resolve(repo, process.env.MN_QA_OUT || '.scratch/qa-skill-ops');
await mkdir(out, { recursive: true });
const firstExisting = (paths) => paths.find((path) => fs.existsSync(path)) || paths[0];
const playwrightFile = resolve(process.env.MN_PLAYWRIGHT || firstExisting([
  resolve(repo, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
  resolve(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'),
]));
const { chromium } = await import(pathToFileURL(playwrightFile).href);
const threeRoot = firstExisting([resolve(repo, 'node_modules/three'), resolve(sibling, 'node_modules/three')]);
const gsapRoot = resolve(process.env.MN_GSAP || firstExisting([resolve(repo, '.scratch/gsap-local/package'), resolve(sibling, '.scratch/gsap-local/package')]));

const ACCOUNT = 'c08408a9-a5a1-44de-82ba-0000000004c0';
const TREE = 'combat', WANTED_NODE = 'lunge';
const specs = [
  { name: 'desktop-1280x720', width: 1280, height: 720, touch: false },
  { name: 'portrait-390x844', width: 390, height: 844, touch: true },
];
const check = (ok, text) => { if (!ok) throw new Error(text); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidence = { build: GAME.version, generatedAt: new Date().toISOString(), results: [], flagOff: null, failures: [] };
const startedAt = Date.now();

// Flag chain (server/host.mjs): skillOperations needs workshop, artisan, logging, resource and economic operations.
const flags = (skillOperations) => ({ economicOperations: true, resourceOperations: true, loggingOperations: true,
  artisanOperations: true, workshopOperations: true, attributeOperations: false, skillOperations });

function startHost(name, skillOperations, hostLogs) {
  // The memory store reports durable:false, so acks would end as "sessionOnly"; this disposable harness marks it durable
  // so the sheet reaches "synced". This flips every store.durable gate (ack flag, /status storage, host.mjs:195); the data stays in memory.
  const store = createMemoryStore(); store.durable = true;
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: true,
    store, worldId: `qa-sk04c-${name}`, resolvePlayer: async () => ACCOUNT, initializeAccounts: true, ...flags(skillOperations),
    saveSecret: `qa-sk04c-${name}`, chat: { enabled: false }, log(...args) { hostLogs.push(args.map(String).join(' ')); } });
  return { host, store };
}

async function routes(page, result) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    result.externalRequests.push(url.href); return route.abort();
  });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, body: '' }));
}

// Join: #btn-play, then the qa-character roster path (create a character, play with it) when the picker intercepts Play.
async function join(page, port, result) {
  page.on('pageerror', (error) => result.pageErrors.push(String(error?.stack || error)));
  page.on('console', (message) => { if (message.type() === 'error' && !/fonts\.g/.test(message.text())) result.consoleErrors.push(message.text()); });
  page.on('websocket', (socket) => result.websockets.push(socket.url()));
  await routes(page, result);
  await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  // Roster fallback (character slots): create a character and enter with it when the picker intercepts Play.
  if (await page.getByRole('button', { name: /Crear personaje/ }).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
    result.rosterUsed = true;
    await page.getByRole('button', { name: /Crear personaje/ }).first().click({ force: true });
    await page.getByRole('button', { name: /Crear y continuar/ }).first().click({ force: true });
    const go = page.getByRole('button', { name: /Jugar con este personaje/ }).first();
    await go.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Jugar con este personaje/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
    await go.click({ force: true });
  }
  await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 40000 });
  await page.evaluate(async () => { (await import('/src/core/locale.js')).setLocale('es'); });
  return page.evaluate(() => window.__mn.client.youServer);
}

const tap = (page, spec, selector) => (spec.touch ? page.locator(selector).first().tap({ force: true }) : page.locator(selector).first().click({ force: true }));
async function openSkills(page, spec) {
  if (spec.touch) await page.locator('#hud-bag').tap({ force: true }); else await page.keyboard.press('KeyC');
  await page.waitForFunction(() => window.__mn.panels.charPanel.isOpen, null, { timeout: 15000 });
  await tap(page, spec, '[data-tab="skills"]');
  await page.waitForFunction(() => window.__mn.panels.charPanel.tab === 'skills' && document.querySelector('.sk-grid'), null, { timeout: 15000 });
  await tap(page, spec, `button.sk-tree[data-tree="${TREE}"]`);
  await page.waitForFunction((tree) => document.querySelector(`button.sk-tree[data-tree="${tree}"]`)?.getAttribute('aria-pressed') === 'true', TREE, { timeout: 5000 });
}
// Select a cell; `lunge` when it can take a rank (not locked, below 3 pips), else the first such cell. Returns the node id used.
// (The sheet marks a cell is-open only at rank 0; a ranked cell carries is-ranked, a gated one is-locked.)
async function selectCell(page, spec) {
  const raisable = 'button.sk-cell:not(.is-locked):not(.is-empty)';
  const lungeOk = await page.locator(`${raisable}[data-node="${WANTED_NODE}"]`).evaluateAll((els) => els.filter((el) => el.querySelectorAll('.sk-pips i.on').length < 3).length);
  const node = lungeOk ? WANTED_NODE : await page.locator(raisable).evaluateAll((els) => els.find((el) => el.querySelectorAll('.sk-pips i.on').length < 3)?.dataset.node);
  check(node, 'no open cell in the combat tree');
  await tap(page, spec, `button.sk-cell[data-node="${node}"]`);
  await page.waitForFunction((n) => document.querySelector(`button.sk-cell[data-node="${n}"]`)?.classList.contains('is-selected'), node, { timeout: 5000 });
  return node;
}
// Layout probe: document horizontal overflow (asserted by the caller), off-screen regions and, on touch, targets under 44 px (findings only).
const layout = (page, spec) => page.evaluate(({ touch }) => {
  const W = innerWidth, H = innerHeight, off = [], small = [];
  for (const sel of ['.ch-screen', '.ch-top', '.ch-left', '.ch-center', '.ch-right', '.ch-x', '.sk-grid', '.sk-raise']) {
    document.querySelectorAll(sel).forEach((el) => { if (!el.offsetParent && sel !== '.ch-screen') return;
      const r = el.getBoundingClientRect(); if (r.width && (r.left < -1 || r.right > W + 1 || r.bottom > H + 1 || r.top < -1)) off.push(sel); });
  }
  if (touch) for (const sel of ['.sk-raise', '.sk-cell:not(.is-empty)', '.ch-x']) document.querySelectorAll(sel).forEach((el) => { const r = el.getBoundingClientRect(); if (el.offsetParent && r.height && (r.height < 43.5 || r.width < 43.5)) small.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`); });
  return { off, small: [...new Set(small)], overflowX: document.documentElement.scrollWidth > W + 1 };
}, { touch: spec.touch });
async function shot(page, result, file) {
  const path = resolve(out, file);
  await page.screenshot({ path });
  result.captures.push({ file, sha256: sha256(path) });
}
const read = (page, node) => page.evaluate((n) => {
  const p = window.__mn.client.profile, status = document.querySelector('.sk-status');
  // rank = the sheet's effective rank (legacy arts count until the first operation adopts them into progression.skills).
  return { tradeRev: p?.eco?.tradeRev, lungeRank: parseInt(document.querySelector('.sk-node-rank')?.textContent, 10), progressionRank: p?.progression?.skills?.[n] ?? 0, free: Number(document.querySelector('.sk-points-row.is-free b')?.textContent),
    pips: document.querySelectorAll(`button.sk-cell[data-node="${n}"] .sk-pips i.on`).length, status: status?.dataset.status ?? null };
}, node);

async function runOn(browser, spec) {
  const result = { viewport: spec.name, status: 'running', captures: [], statuses: [], pageErrors: [], consoleErrors: [], externalRequests: [], websockets: [] };
  evidence.results.push(result);
  const hostLogs = [], { host, store } = startHost(spec.name, true, hostLogs);
  let context, page;
  try {
    await store.initializeProfile(ACCOUNT, Object.assign(newProfile(), { pirateId: `account:${ACCOUNT}` }));
    const port = await host.listen(), server = host.game.server;
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, hasTouch: spec.touch, isMobile: spec.touch });
    page = await context.newPage();
    const entity = await join(page, port, result);
    result.welcomeSkills = await page.evaluate(() => window.__mn.client.skills ?? null);

    // Seed the character the qa-canteen way: edit the live profile, save it through the host writer, flush, broadcast.
    const profile = server.world.profiles.get(entity), session = [...host.game.profiles.accounts.values()].find((row) => row.key === ACCOUNT);
    check(profile && session, 'account profile did not attach');
    profile.mast = [[4, 0], [1, 0]]; profile.gold = 200;
    check(host.game.saveProfile(session.id, profile), 'seed profile save was rejected');
    server.world.profileDirty.add(entity); await host.game.profiles.flush(); server.broadcastSnapshot();
    await page.waitForFunction(() => window.__mn.client.profile?.mast?.[0]?.[0] === 4, null, { timeout: 20000 });

    await openSkills(page, spec);
    const node = result.node = await selectCell(page, spec);
    result.nodeIsLunge = node === WANTED_NODE;
    const raise = page.locator('button.sk-raise');
    check(await raise.getAttribute('data-skill-op') === 'assign' && !(await raise.isDisabled()), `Subir is not enabled for ${node}: title=${await raise.getAttribute('title')}`);
    const before = result.before = await read(page, node);
    check(before.free >= 1, `no free combat points before (free=${before.free})`);
    result.layoutSelected = await layout(page, spec);
    check(!result.layoutSelected.overflowX, `horizontal overflow (selected): ${JSON.stringify(result.layoutSelected)}`);
    await shot(page, result, `07a-skill-selected-${spec.name}.png`);

    // Listeners go in BEFORE Subir: the ack on the client bus, the sent command, and every status the sheet shows.
    await page.evaluate(async () => {
      const { bus } = await import('/src/core/events.js');
      window.__qaSkillAcks = []; window.__qaSkillCmds = []; window.__qaStatuses = [];
      bus.on('skills', (ev) => window.__qaSkillAcks.push(JSON.parse(JSON.stringify(ev))));
      const ctl = window.__mn.panels.charPanel.skills, send = ctl.submit;
      ctl.submit = (cmd) => { window.__qaSkillCmds.push(JSON.parse(JSON.stringify(cmd))); return send(cmd); };
      const note = () => { const s = document.querySelector('.sk-status')?.dataset.status; if (s && window.__qaStatuses.at(-1) !== s) window.__qaStatuses.push(s); };
      new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] });
      setInterval(note, 15); note();
    });
    await tap(page, spec, 'button.sk-raise[data-skill-op="assign"]');
    await page.waitForFunction(() => window.__qaSkillAcks.length > 0, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.sk-status')?.dataset.status === 'synced', null, { timeout: 10000 });
    const sent = (await page.evaluate(() => window.__qaSkillCmds))[0], ack = (await page.evaluate(() => window.__qaSkillAcks))[0];
    result.statuses = await page.evaluate(() => window.__qaStatuses);
    result.opId = sent?.opId; result.command = sent; result.ack = ack;
    check(sent && sent.type === 'skills' && sent.op === 'assign' && sent.tree === TREE && sent.node === node, `unexpected command ${JSON.stringify(sent)}`);
    check(ack.ok === true, `ack denied: ${JSON.stringify(ack)}`);
    check(ack.rev === before.tradeRev + 1, `ack.rev ${ack.rev} != ${before.tradeRev + 1}`);
    check(ack.opId === sent.opId, 'ack.opId does not match the sent opId');
    check(result.statuses.includes('synced'), `status never reached synced: ${result.statuses}`);

    await page.waitForFunction(({ n, rank }) => (window.__mn.client.profile.progression?.skills?.[n] ?? 0) >= rank, { n: node, rank: before.lungeRank + 1 }, { timeout: 10000 });
    const after = result.after = await read(page, node);
    result.serverRank = server.world.profiles.get(entity).progression?.skills?.[node] ?? 0;
    result.serverTradeRev = server.world.profiles.get(entity).eco?.tradeRev;
    check(after.tradeRev === before.tradeRev + 1, `tradeRev ${before.tradeRev} -> ${after.tradeRev}`);
    check(after.lungeRank === before.lungeRank + 1, `rank ${before.lungeRank} -> ${after.lungeRank}`);
    check(result.serverRank === after.lungeRank, `server rank ${result.serverRank} != client rank ${after.lungeRank}`);
    check(result.serverTradeRev === after.tradeRev, `server tradeRev ${result.serverTradeRev} != client ${after.tradeRev}`);
    check(after.progressionRank === after.lungeRank, `client progression rank ${after.progressionRank} != sheet rank ${after.lungeRank}`);
    check(after.pips === after.lungeRank, `pips ${after.pips} != rank ${after.lungeRank}`);
    check(after.free === before.free - 1, `free ${before.free} -> ${after.free}`);
    result.layoutRaised = await layout(page, spec);
    check(!result.layoutRaised.overflowX, `horizontal overflow (raised): ${JSON.stringify(result.layoutRaised)}`);
    await shot(page, result, `07b-skill-raised-${spec.name}.png`);
    check(result.pageErrors.length === 0 && result.externalRequests.length === 0, `browser errors: ${JSON.stringify({ pageErrors: result.pageErrors, external: result.externalRequests })}`);
    check(result.websockets.some((url) => url.includes('/ws')), 'no local WSS connection seen');
    result.status = 'passed';
    // Off-screen regions and sub-44 px targets are findings, not failures: the sheet scrolls inside its panel.
    for (const [label, found] of [['selected', result.layoutSelected], ['raised', result.layoutRaised]]) {
      if (found.off.length || found.small.length) console.log(`${spec.name}: layout finding (${label}): off=[${found.off}] small=[${found.small}]`);
    }
    console.log(`${spec.name}: ack.ok=${ack.ok} rev=${ack.rev} status=${after.status} node=${node} rank ${before.lungeRank}->${after.lungeRank} free ${before.free}->${after.free} tradeRev ${before.tradeRev}->${after.tradeRev} server=${result.serverRank} statuses=${result.statuses.join('>')}`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error?.stack || error); result.hostLogs = hostLogs.slice(-20);
    evidence.failures.push(`${spec.name}: ${error.message}`);
    if (page) {
      result.browserState = await page.evaluate(() => ({ joined: window.__mn?.client?.joined, skills: window.__mn?.client?.skills, acks: window.__qaSkillAcks, cmds: window.__qaSkillCmds,
        pending: window.__mn?.panels?.charPanel?.skills?.pending ?? null, status: document.querySelector('.sk-status')?.dataset.status, body: document.body.innerText.slice(0, 600) })).catch(() => null);
      await shot(page, result, `failure-${spec.name}.png`).catch(() => {});
    }
    console.log(`${spec.name}: FAILED ${error.message}`);
  } finally { await context?.close().catch(() => {}); try { await host.close(); } catch {} }
}

// Flag OFF: the same account, no seed, desktop only; the sheet must say the actions are locked.
async function runFlagOff(browser, spec) {
  const result = { viewport: spec.name, status: 'running', captures: [], pageErrors: [], consoleErrors: [], externalRequests: [], websockets: [] };
  evidence.flagOff = result;
  const hostLogs = [], { host, store } = startHost(`${spec.name}-off`, false, hostLogs);
  let context, page;
  try {
    await store.initializeProfile(ACCOUNT, Object.assign(newProfile(), { pirateId: `account:${ACCOUNT}` }));
    const port = await host.listen();
    context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await join(page, port, result);
    await openSkills(page, spec);
    await tap(page, spec, 'button.sk-cell:not(.is-empty)');
    await page.waitForFunction(() => document.querySelector('button.sk-raise'), null, { timeout: 5000 });
    const raise = page.locator('button.sk-raise');
    result.raiseDisabled = await raise.isDisabled();
    result.title = await raise.getAttribute('title');
    result.note = (await page.locator('p.sk-note').count()) ? await page.locator('p.sk-note').first().innerText() : null;
    check(result.raiseDisabled === true, 'flag OFF: Subir is not disabled');
    check(result.title === 'Disponible pronto', `flag OFF: title is "${result.title}"`);
    check(result.note, 'flag OFF: p.sk-note missing');
    result.status = 'passed';
    console.log(`flag-off ${spec.name}: raiseDisabled=${result.raiseDisabled} title="${result.title}" note="${result.note}"`);
  } catch (error) {
    result.status = 'failed'; result.failure = String(error?.stack || error); result.hostLogs = hostLogs.slice(-20);
    evidence.failures.push(`flag-off: ${error.message}`);
    console.log(`flag-off: FAILED ${error.message}`);
  } finally { await context?.close().catch(() => {}); try { await host.close(); } catch {} }
}

const browser = await chromium.launch({ headless: true, ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const spec of specs) await runOn(browser, spec);
  await runFlagOff(browser, specs[0]);
} finally {
  await browser.close();
  evidence.status = evidence.failures.length ? 'failed' : 'passed'; evidence.durationMs = Date.now() - startedAt;
  await writeFile(resolve(out, 'skill-ops-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(`${evidence.status}: ${evidence.results.length} viewports, ${evidence.durationMs} ms, evidence ${resolve(out, 'skill-ops-evidence.json')}`);
process.exitCode = evidence.failures.length ? 1 : 0;

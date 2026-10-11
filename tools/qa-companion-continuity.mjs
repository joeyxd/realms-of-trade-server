// Local browser acceptance with a simulated provider and real C01/GameHost sockets.
// Never opens the author's saved companion or contacts an inference endpoint.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_COMPANION_DRAFT } from '../src/net/companionTemplates.js';
import { LocalCompanion } from './agent/local-companion.mjs';
import { createCompanionStudio } from './agent/companion-studio-server.mjs';

const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT ||
  'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const output = resolve(process.env.MN_CONTINUITY_QA_OUTPUT || 'docs/delivery/l04c-companion-continuity');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'mn-continuity-browser-'));
let release = null;
const calls = [];
const adapterFactory = ({ baseUrl, modelId, thinkingMode }) => ({
  id: 'local-continuity-browser-fixture', countMode: 'estimated_tokens',
  localResourcePolicy: { baseUrl, modelId, thinkingMode },
  countText: text => Buffer.byteLength(text),
  prepare(request) { const body = JSON.stringify(request); const count = Buffer.byteLength(body) + 1024;
    return { body, inputTokens: count, maxCostUnits: count + request.maxOutputTokens }; },
  async complete({ body }) {
    const packet = JSON.parse(body); calls.push(packet);
    const sources = packet.context.required.tools.memoryCompaction?.sources;
    if (packet.context.required.tools.conversation?.source.text === 'Espera un momento, Brisa.')
      await new Promise(done => { release = done; });
    return { text: JSON.stringify({ v: 1, decision: sources ? { type: 'summarize_memory', args: {
      text: 'El dueño propone la balsa Faro de Jade; todavía es un plan comunicado.', tags: [], basis: sources.map(source => source.id) } } :
      { type: 'reply', args: { text: 'Me gusta Faro de Jade para nuestra balsa. Guardemos ese plan.' } } }),
    usage: { inputTokens: 500, outputTokens: 50, costUnits: 550 } };
  }, get records() { return []; },
});
const companion = await LocalCompanion.create({ directory: join(directory, 'brisa'), adapterFactory,
  draft: { ...DEFAULT_COMPANION_DRAFT, name: 'Brisa', modelId: 'fixture-only', baseUrl: 'http://127.0.0.1:8080/v1' },
  limits: { maxCalls: 8, maxTokens: 200000 } });
const studio = await createCompanionStudio({ directory: companion.directory, initialCompanion: companion,
  baseUrl: companion.draft.baseUrl, modelId: companion.draft.modelId });
const access = await studio.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { schema: 'mn.companion-continuity-browser.v1', at: new Date().toISOString(),
  production: false, model: 'simulated', gameTransport: 'real_local_C01', checks: [], screenshots: [], errors: [] };
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => evidence.errors.push(error.message));
async function check(name, fn) { await fn(); evidence.checks.push({ name, ok: true }); process.stdout.write(`ok ${name}\n`); }
async function shot(name, selector = '.continuity-panel') {
  await page.locator(selector).screenshot({ path: join(output, name) }); evidence.screenshots.push(name);
}
try {
  await page.goto(access.url);
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await check('opening is stopped and makes no inference', async () => {
    assert.equal((await companion.view()).status.state, 'stopped'); assert.equal(calls.length, 0);
    assert.equal(await page.locator('#summarize-episodes').isEnabled(), false);
  });
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('runner-state').textContent === 'En servicio');
  const sessionId = (await companion.view()).status.sessionId;
  await page.locator('#chat-input').fill('Prepararemos una balsa llamada Faro de Jade.');
  await page.locator('#send').click();
  await page.waitForFunction(() => document.getElementById('capture-detail').textContent.startsWith('Guardada'));
  await check('confirmed conversation is captured automatically with no second inference', async () => {
    const state = await companion.view(); assert.equal(calls.length, 1); assert.equal(state.continuity.journal.episodes, 1);
    assert.equal(state.continuity.autoCompact, false); assert.equal(await page.locator('#episode-list input').count(), 1);
    assert.match(await page.locator('#context-detail').innerText(), /Estimación conservadora/);
  });
  await shot('context-measured-desktop.png');
  await page.locator('#episode-list input').first().check();
  const original = await readFile(join(companion.directory, 'memory.jsonl'), 'utf8');
  await page.locator('#summarize-episodes').click();
  await page.waitForFunction(() => document.getElementById('summary-detail').textContent.startsWith('Completado'));
  await check('selected episode summary is appended, sources retained and usage settled', async () => {
    const state = await companion.view(); assert.equal(calls.length, 2); assert.equal(state.continuity.journal.summaries, 1);
    assert.equal(state.continuity.automaticSummaryRemaining, 0); assert.equal(state.budget.totals.unresolvedTokens, 0);
    assert.ok((await readFile(join(companion.directory, 'memory.jsonl'), 'utf8')).startsWith(original));
  });
  await page.locator('#context-refresh').click();
  await page.waitForFunction(() => document.getElementById('refresh-detail').textContent.includes('refresco manual'));
  await check('manual refresh keeps admission, quota and source files and makes no call', async () => {
    const state = await companion.view(); assert.equal(state.status.sessionId, sessionId);
    assert.equal(state.budget.totals.calls, 2); assert.equal(calls.length, 2);
    assert.equal(state.continuity.journal.episodes, 1); assert.equal(state.continuity.context, null);
  });
  await page.locator('#auto-compact').check();
  await page.waitForFunction(() => document.getElementById('auto-compact-budget').textContent.startsWith('Activo:'));
  await check('paid automation opt-in reports conservative remaining quota without inference', async () => {
    assert.equal((await companion.view()).continuity.autoCompact, true); assert.equal(calls.length, 2);
    assert.match(await page.locator('#auto-compact-budget').innerText(), /0 resumen/);
  });
  await shot('continuity-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.continuity-panel').scrollIntoViewIfNeeded();
  await check('portrait continuity panel fits viewport', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.locator('#context-refresh').isEnabled(), true);
  });
  await shot('continuity-portrait.png');
  await page.setViewportSize({ width: 844, height: 390 });
  await check('landscape continuity panel fits viewport', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });
  await shot('continuity-landscape.png');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#chat-input').fill('Espera un momento, Brisa.');
  await page.locator('#send').click();
  const deadline = Date.now() + 10000;
  while (!release && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
  assert.ok(release, 'held inference entered');
  await check('refresh remains actionable during a held conversation', async () => {
    assert.equal(await page.locator('#context-refresh').isEnabled(), true);
    await page.locator('#context-refresh').click();
    release();
    await page.waitForFunction(() => document.getElementById('chat-input').disabled === false);
    const deadline = Date.now() + 10000;
    while (companion.diagnostics.mind.inFlight && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    const state = await companion.view(); assert.equal(state.status.sessionId, sessionId);
    assert.equal(state.budget.totals.calls, 3);
    assert.equal(state.transcript.filter(message => message.sender === 'companion').length, 1, 'late reply fenced');
    assert.equal(state.continuity.journal.episodes, 1);
  });
  await page.locator('#stop').click();
  await page.waitForFunction(() => document.getElementById('runner-state').textContent === 'Detenido');
  await check('stopped refresh keeps stop and disables summary', async () => {
    await page.locator('#context-refresh').click();
    assert.equal((await companion.view()).status.state, 'stopped');
    assert.equal(await page.locator('#summarize-episodes').isEnabled(), false);
  });
  assert.deepEqual(evidence.errors, []);
  evidence.accepted = true;
} catch (error) { evidence.accepted = false; evidence.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  process.stdout.write(JSON.stringify({ phase: 'cleanup', accepted: evidence.accepted, failure: evidence.failure ?? null }) + '\n');
  await writeFile(join(output, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  release?.(); await context.close(); await browser.close(); await studio.close();
  await rm(directory, { recursive: true, force: true });
  await writeFile(join(output, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ accepted: evidence.accepted, checks: evidence.checks.length,
    errors: evidence.errors, failure: evidence.failure?.message ?? null, output }) + '\n');
}

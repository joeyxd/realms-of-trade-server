// Public acceptance: guest entry and owner/agent denial. No account or spending.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GAME } from '../../../src/data/meta.js';
import { PROTOCOL_VERSION, MSG } from '../../../src/net/protocol.js';
const origin = 'https://marea.62.171.136.148.sslip.io', checks = [];
const record = (check, extra = {}) => checks.push({ check, pass: true, ...extra });
async function get(path) { return fetch(origin + path, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
async function wire(hello, use) {
  const ws = new WebSocket(origin.replace('https:', 'wss:') + '/ws', { origin, handshakeTimeout: 12000 });
  const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw))); ws.on('error', () => {});
  const closed = once(ws, 'close');
  const wait = async predicate => {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate); if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error('bounded wire wait failed');
  };
  try { await once(ws, 'open'); ws.send(JSON.stringify(hello)); return await use({ ws, messages, wait }); }
  finally {
    if (ws.readyState < 2) ws.close();
    const timer = setTimeout(() => ws.terminate(), 1500); await closed; clearTimeout(timer);
  }
}
try {
  const h = await get('/health'); assert.equal(h.status, 200); assert.equal(await h.text(), 'ok'); record('public_health_200');
  const s = await (await get('/status')).json();
  assert.equal(s.version, GAME.version); assert.equal(s.errors, 0); assert.equal(s.storage.kind, 'supabase');
  assert.equal(s.storage.durable, true); assert.equal(s.storage.accounts, true);
  assert.equal(s.storage.economic.enabled, true); assert.equal(s.storage.economic.failed, false);
  assert.equal(s.storage.resources.enabled, true); assert.equal(s.storage.resources.ready, true);
  assert.equal(s.storage.tickBlocked, false); record('durable_M5_resources_healthy', { version: s.version, logging: s.storage.resources.logging });
  const protocol = await (await get('/src/net/protocol.js')).text();
  assert.ok(protocol.includes('PROTOCOL_VERSION = ' + PROTOCOL_VERSION)); record('published_protocol', { protocol: PROTOCOL_VERSION });
  assert.ok(protocol.includes("AGENT_OWNER: 'agent_owner'"));
  assert.deepEqual(s.storage.workshop, { enabled: false, ready: false }); record('starter_workshop_off_pending_SQL024');
  const workshopUi = await get('/src/ui/workshop.js'); assert.equal(workshopUi.status, 200); record('published_workshop_panel');
  const ui = await get('/src/ui/companions.js'); assert.equal(ui.status, 200);
  assert.ok((await ui.text()).includes('serverDisabled')); record('published_companions_panel');
  assert.equal((await get('/tools/agent/run.mjs')).status, 404); record('operator_tools_not_public');
  const contentResponse = await get('/api/world/content'); assert.equal(contentResponse.status, 200);
  const content = await contentResponse.json(); assert.equal(content.ok, true);
  assert.equal(Number.isSafeInteger(content.generation) && content.generation >= 0, true);
  assert.equal(content.revisionId === null || /^[0-9a-f]{64}$/.test(content.revisionId), true);
  const hello = { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'PRG01d QA', skin: 0, weapon: 0,
    content: { generation: content.generation, revisionId: content.revisionId } };
  await wire(hello, async ({ ws, wait }) => {
    const welcome = await wait(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
    assert.equal(welcome.t, MSG.WELCOME); assert.equal(welcome.control, undefined);
    await wait(m => m.t === MSG.SNAPSHOT); await wait(m => m.t === MSG.PROFILE); record('ordinary_guest_real_public_entry');
    ws.send(JSON.stringify({ t: MSG.AGENT_OWNER, requestId: 'public-owner-denied', op: 'list' }));
    const owner = await wait(m => m.t === MSG.AGENT_OWNER_RESULT && m.requestId === 'public-owner-denied');
    assert.equal(owner.ok, false); assert.equal(owner.why, 'forbidden');
    assert.equal(owner.enabled, false); assert.deepEqual(owner.companions, []); record('public_guest_companions_forbidden');
    ws.send(JSON.stringify({ t: MSG.AGENT_MARKET, requestId: 'public-market-check', epoch: 1, sessionId: 'public-test-session', op: 'list' }));
    const market = await wait(m => m.t === MSG.AGENT_MARKET_RESULT);
    assert.equal(market.ok, false); assert.equal(market.why, 'forbidden'); assert.equal(market.market, null); record('public_guest_market_forbidden');
    const sessionId = '00000000-0000-4000-8000-000000000017';
    ws.send(JSON.stringify({ t: MSG.AGENT_TRADE, opId: 'public-trade-denied', epoch: 1, sessionId, op: 'buy', g: 'madera', n: 1, expectedTotal: 1 }));
    const trade = await wait(m => m.t === MSG.AGENT_TRADE_RESULT);
    assert.equal(trade.ok, false); assert.equal(trade.why, 'forbidden'); assert.equal(trade.receipt, null); assert.equal(trade.budget, null);
    record('public_guest_trade_forbidden_without_receipt');
    ws.send(JSON.stringify({ t: MSG.AGENT_GOODS_BUDGET, op: 'read', characterId: sessionId }));
    const budget = await wait(m => m.t === MSG.AGENT_GOODS_BUDGET_RESULT);
    assert.equal(budget.ok, false); assert.equal(budget.why, 'forbidden'); assert.equal(budget.budget, null); record('public_guest_budget_forbidden');
  });
  await wire({ ...hello, agent: true }, async ({ wait }) => {
    const denied = await wait(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
    assert.equal(denied.t, MSG.ERROR); record('unconfigured_public_agent_admission_denied');
  });
  await wire({ ...hello, v: PROTOCOL_VERSION - 1 }, async ({ wait }) => {
    const denied = await wait(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
    assert.equal(denied.t, MSG.ERROR); record('old_protocol_requires_reload');
  });
  const report = { schema: 'mn.prg01d.public.v1', at: new Date().toISOString(), target: 'public TLS', pass: true, checks,
    limits: ['Guest wire entry only; this does not verify authenticated workshop gameplay.', 'Starter workshop flag remains off; SQL024 and authenticated new-gameplay acceptance remain pending.'] };
  await writeFile(new URL('./public-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch { console.error(JSON.stringify({ pass: false, checks, why: 'bounded public smoke failed' })); process.exitCode = 1; }

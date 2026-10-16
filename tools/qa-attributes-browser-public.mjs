#!/usr/bin/env node
// Authenticated public acceptance through the real character panel; credentials stay private.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

let envFile, out;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file') envFile = process.argv[++i];
  else if (process.argv[i] === '--out') out = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--help') { console.log('node tools/qa-attributes-browser-public.mjs --env-file PATH --out NEW_DIRECTORY'); process.exit(0); }
  else throw new Error('unknown argument');
}
if (envFile) process.loadEnvFile(path.resolve(envFile));
assert.equal(process.env.MN_QA_ALLOW_PUBLIC, '1', 'explicit public QA guard required');
assert.equal(PROTOCOL_VERSION, 52, 'review the canary after protocol changes');
assert.ok(out && !fs.existsSync(out), 'new evidence directory required');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) assert.ok(process.env[key], 'private QA configuration unavailable');
const target = new URL(process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
assert.equal(target.protocol, 'https:');
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, opts);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, opts);
const store = storeFromEnv();
const marker = `mnQaAttributesUI:${randomUUID()}`;
const email = `mn-attributes-ui-${randomUUID()}@example.com`, password = `Aa1!${randomBytes(28).toString('base64url')}`;
const evidence = { schema: 'mn.attributes.browser.v1', at: new Date().toISOString(), target: target.origin,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, checks: [], screenshots: [], errors: [], pass: false };
const check = (name, detail = {}) => { evidence.checks.push({ name, pass: true, ...detail }); console.log(JSON.stringify({ check: name, pass: true })); };
const unwrap = r => { if (r?.error || !r) throw new Error('private account operation failed'); return r.data; };
const redact = s => String(s).replaceAll(email, '[redacted-email]').replaceAll(password, '[redacted-secret]')
  .replaceAll(process.env.SUPABASE_SERVICE_KEY, '[redacted-key]').replaceAll(process.env.SUPABASE_PUBLIC_KEY, '[redacted-key]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
let accountId, browser, context, page;
const opIds = new Set();
async function wait(fn, label) {
  try { await page.waitForFunction(fn, null, { timeout: 60000 }); } catch { throw new Error(`bounded wait expired: ${label}`); }
}
async function snapshot() {
  return page.evaluate(() => { const p = window.__mn.client.profile; return { attr: p.attr ?? null, pack: p.eco.pack, rev: p.eco.tradeRev }; });
}
async function capture(label) {
  const file = `${label}.png`; await page.screenshot({ path: path.join(out, file) }); evidence.screenshots.push(file);
}
async function receiptAndProfile(op, previous) {
  await wait(() => window.__mn.panels.charPanel.attributes.pending === null, `${op} saved confirmation`);
  const state = await snapshot();
  assert.equal(state.rev, previous.rev + 1);
  const request = await page.evaluate(() => window.__qaAttributeRequests.at(-1));
  assert.equal(request.op, op); opIds.add(request.opId);
  const receipt = await store.loadEconomicOperation(economicOperationId(process.env.WORLD_ID || 'marea-negra', accountId, request.opId));
  assert.ok(receipt?.result?.ok, 'receipt persisted');
  assert.equal(receipt.request.command.opId, request.opId);
  const stored = await store.loadProfile(accountId);
  assert.deepEqual(stored.data.attr, state.attr); assert.deepEqual(stored.data.eco.pack, state.pack);
  assert.deepEqual(state.pack.goods, previous.pack.goods);
  assert.deepEqual(state.pack.vessels, previous.pack.vessels);
  check(`visible_${op}_confirmed_in_profile_and_receipt`, { rev: state.rev, attr: state.attr, maxMass: state.pack.maxMass, volume: state.pack.cap, water: state.pack.vessels[0].water });
  return state;
}
try {
  fs.mkdirSync(out, { recursive: true });
  const statusResponse = await fetch(new URL('/status', target), { signal: AbortSignal.timeout(15000) });
  const status = await statusResponse.json();
  assert.ok(statusResponse.ok && status.version === GAME.version && status.players === 0 && status.sockets === 0 && status.errors === 0);
  assert.ok(status.storage?.durable && status.storage?.accounts && status.storage?.attributes?.enabled && status.storage?.attributes?.ready);
  assert.equal(status.storage.world.id, process.env.WORLD_ID || 'marea-negra');
  assert.equal(status.storage.economic.pending, 0); assert.equal(status.storage.economic.failed, false);
  assert.equal(status.storage.errors, 0); assert.equal(status.storage.unsaved, 0);
  const auth = await (await fetch(new URL('/auth/config', target))).json();
  assert.ok(auth.enabled && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin);
  check('public_release_durable_attributes_ready', { version: status.version, protocol: PROTOCOL_VERSION });
  const created = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
  accountId = created.user.id;
  unwrap(await admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: marker } }));
  unwrap(await pub.auth.verifyOtp({ token_hash: created.properties.hashed_token, type: 'signup' }));
  const profile = newProfile(); profile.pirateId = `account:${accountId}`; profile.cp = 'aldea'; profile.lvl = 3;
  profile.carry = { v: 1, backpack: 0 };
  profile.eco.pack = { cap: 18, maxMass: 22, goods: { madera: 3 }, vessels: [{ id: 'bucket', kind: 'bucket', water: 3 }] };
  assert.ok(sanitizeProfile(profile));
  assert.equal((await store.initializeProfile(accountId, profile)).version, 1);
  check('disposable_level_three_bucket_profile_created');
  const playwright = path.resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwright).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  page.on('pageerror', e => evidence.errors.push(redact(e.message)));
  await page.goto(`${target.origin}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
  await wait(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'client ready');
  await page.locator('.account-open').click();
  await page.locator('.account-form input[name="email"]').fill(email);
  await page.locator('.account-form input[name="password"]').fill(password);
  await page.locator('.account-submit').click();
  await wait(() => { const e = document.querySelector('.account-signed'); return e && !e.hidden; }, 'login');
  await page.locator('.account-ready').click();
  await wait(() => window.__mn.client.joined && window.__mn.st.mode === 'playing' && window.__mn.client.attributes.enabled, 'authenticated attribute capability');
  await wait(() => !window.__mn.st.boarding && document.querySelector('#title')?.hidden, 'boarding');
  assert.equal(await page.evaluate(() => window.__mn.client.profile.pirateId), `account:${accountId}`);
  await page.evaluate(() => {
    window.__qaAttributeRequests = [];
    const c = window.__mn.client, send = c.send.bind(c);
    c.send = m => { if (m.type === 'attributes') window.__qaAttributeRequests.push(structuredClone(m)); return send(m); };
  });
  await page.keyboard.press('c');
  await page.locator('[data-attribute-op="adopt"]').waitFor({ state: 'visible' });
  let state = await snapshot(); assert.equal(state.attr, null); assert.equal(state.pack.maxMass, 22);
  await capture('01-desktop-es-adoption');
  await page.locator('[data-attribute-op="adopt"]').click(); state = await receiptAndProfile('adopt', state);
  assert.deepEqual(state.attr, { v: 1, carga: 0, re: 0 }); assert.equal(state.pack.maxMass, 50);
  await page.locator('[data-attribute-op="assign"]').click(); state = await receiptAndProfile('assign', state);
  assert.deepEqual(state.attr, { v: 1, carga: 1, re: 0 }); assert.equal(state.pack.maxMass, 55);
  await capture('02-desktop-es-assigned');
  await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-attribute-op="reset"]').click();
  assert.equal(await page.evaluate(() => window.__qaAttributeRequests.length), 2, 'inline confirmation does not spend reset');
  await capture('03-portrait-en-reset-confirm');
  await page.locator('[data-attribute-op="cancelReset"]').click();
  await page.locator('[data-attribute-op="reset"]').click();
  await page.locator('[data-attribute-op="confirmReset"]').click(); state = await receiptAndProfile('reset', state);
  assert.deepEqual(state.attr, { v: 1, carga: 0, re: 1 }); assert.equal(state.pack.maxMass, 50);
  await capture('04-portrait-en-reset-saved');
  assert.ok(await page.locator('[data-attribute-op="reset"]').isDisabled());
  await page.reload({ waitUntil: 'commit', timeout: 90000 });
  await wait(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'reloaded client');
  await page.locator('.account-open').click();
  await wait(() => { const e = document.querySelector('.account-signed'); return e && !e.hidden; }, 'retained auth');
  await page.locator('.account-ready').click();
  await wait(() => window.__mn.client.joined && window.__mn.client.profile?.attr?.re === 1 && !window.__mn.st.boarding, 'profile restored');
  await page.locator('#hud-bag').click();
  await page.locator('[data-tab="stats"]').click();
  assert.deepEqual(await snapshot(), state);
  await capture('05-portrait-en-reconnected');
  check('browser_reconnect_preserves_reset_bucket_and_backpack', { attr: state.attr, maxMass: state.pack.maxMass, water: 3 });
  assert.equal(evidence.errors.length, 0, 'no page errors');
  evidence.pass = true;
} catch (error) {
  evidence.errors.push(redact(error.stack || error));
  console.error(redact(error.message));
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  if (accountId) {
    try {
      const user = unwrap(await admin.auth.admin.getUserById(accountId));
      assert.equal(user.user.user_metadata.mn_qa_marker, marker);
      // Wait for disconnect autosave before removing only this exact disposable profile.
      let settled = false;
      for (let n = 0; n < 30; n++) {
        const s = await (await fetch(new URL('/status', target))).json();
        if (s.players === 0 && s.sockets === 0 && s.storage.unsaved === 0 && s.storage.economic.pending === 0) { settled = true; break; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.ok(settled, 'QA disconnect did not settle');
      const receipts = unwrap(await admin.from('mn_economic_operations').select('operation_id').eq('request->>account', accountId));
      unwrap(await admin.from('mn_profiles').delete().eq('player_id', accountId));
      unwrap(await admin.auth.admin.deleteUser(accountId));
      evidence.cleanup = { profileDeleted: (await store.loadProfile(accountId)) === null,
        authDeleted: !!(await admin.auth.admin.getUserById(accountId)).error, receiptsRetained: receipts.length };
      assert.ok(evidence.cleanup.profileDeleted && evidence.cleanup.authDeleted);
    } catch (error) { evidence.pass = false; evidence.errors.push(`cleanup: ${redact(error.message)}`); }
  }
  if (out && fs.existsSync(out)) fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks.length, screenshots: evidence.screenshots.length, cleanup: evidence.cleanup }));
process.exitCode = evidence.pass ? 0 : 1;

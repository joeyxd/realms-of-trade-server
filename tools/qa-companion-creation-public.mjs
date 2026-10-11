#!/usr/bin/env node
// Real public-alpha acceptance for account-owned companion creation.
// This creates one marked canary and deliberately retains it until separate registry cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { companionCreationConfig, validateCompanionPreset } from '../src/net/companionCreation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requiredManifestKeys = ['accountId', 'marker', 'world', 'characterKey', 'creationId'];
let envFile, out, cleanupManifestPath;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file') envFile = process.argv[++i];
  else if (process.argv[i] === '--out') out = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--cleanup') cleanupManifestPath = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--help') {
    console.log('Create:  node tools/qa-companion-creation-public.mjs --env-file PATH --out NEW_DIRECTORY');
    console.log('Cleanup: node tools/qa-companion-creation-public.mjs --env-file PATH --out EXISTING_DIRECTORY --cleanup MANIFEST');
    process.exit(0);
  } else throw new Error('unknown argument');
}
if (envFile) process.loadEnvFile(path.resolve(envFile));
assert.equal(process.env.MN_QA_ALLOW_PUBLIC, '1', 'explicit public QA guard required');
assert.equal(PROTOCOL_VERSION, 56, 'review the public canary after protocol changes');
if (cleanupManifestPath) assert.ok(out && fs.existsSync(out), 'existing evidence directory required for cleanup mode');
else assert.ok(out && !fs.existsSync(out), 'new evidence directory required');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) assert.ok(process.env[key], 'private QA configuration unavailable');

const WORLD = process.env.WORLD_ID || 'marea-negra';
const target = new URL(process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
assert.equal(target.protocol, 'https:');
assert.equal(target.origin, 'https://marea.62.171.136.148.sslip.io', 'this canary is restricted to the public alpha');
const timeoutFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timeoutFetch } };
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, supabaseOptions);
const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, supabaseOptions);
const store = storeFromEnv();
const bounded = async (promise, label, timeoutMs = 15000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`bounded operation timed out: ${label}`)), timeoutMs);
  })]); } finally { clearTimeout(timer); }
};
const unwrap = result => {
  if (!result || result.error) throw new Error('private account operation failed');
  return result.data;
};
const redact = value => {
  let text = String(value);
  for (const [secret, label] of [[email, '[redacted-email]'], [password, '[redacted-secret]'],
    [marker, '[redacted-marker]'], [accountId, '[redacted-account]'],
    [process.env.SUPABASE_SERVICE_KEY, '[redacted-key]'], [process.env.SUPABASE_PUBLIC_KEY, '[redacted-key]']]) {
    if (secret) text = text.replaceAll(secret, label);
  }
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(/(access_token|refresh_token|token_hash|hashed_token|token|password|apikey)([=:\s"%20]+)[^&\s"']+/gi, '$1$2[redacted]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted-id]');
};
async function fetchJson(url, label) {
  const response = await bounded(timeoutFetch(url), label);
  const body = await bounded(response.json(), `${label} JSON`);
  return { response, body };
}
async function checkPublicReadiness() {
  const { response: statusResponse, body: status } = await fetchJson(new URL('/status', target), 'public status');
  assert.ok(statusResponse.ok && status.version === GAME.version && status.errors === 0, 'public alpha release is not healthy/current');
  assert.equal(status.storage?.durable, true); assert.equal(status.storage?.accounts, true);
  assert.equal(status.storage?.world?.id, WORLD);
  const { response: authResponse, body: authConfig } = await fetchJson(new URL('/auth/config', target), 'public auth config');
  assert.ok(authResponse.ok && authConfig.enabled === true);
  assert.equal(new URL(authConfig.url).origin, new URL(process.env.SUPABASE_URL).origin, 'public auth must match QA Supabase project');
  assert.deepEqual(await store.checkCompanionCreation(), { version: 1 });
  return status;
}
async function settleProfile(accountId, { requireClosedSocket = false, gameSocketClosed = true } = {}) {
  let previousSignature = null, stableReads = 0, profile = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    profile = await bounded(store.loadProfile(accountId), 'settle temporary profile');
    if (profile) assert.equal(profile.data?.pirateId, `account:${accountId}`, 'temporary profile identity changed');
    const { body: health } = await fetchJson(new URL('/status', target), 'cleanup status');
    const storage = health.storage || {};
    const writesIdle = storage.unsaved === 0 && storage.profileWrites === 0 && storage.economic?.pending === 0;
    const signature = JSON.stringify(profile);
    stableReads = signature === previousSignature ? stableReads + 1 : 0;
    previousSignature = signature;
    const socketSettled = !requireClosedSocket || gameSocketClosed;
    if (socketSettled && stableReads >= 2 && writesIdle) return { profile, settlement: {
      stableProfileReads: stableReads + 1, unsaved: storage.unsaved, profileWrites: storage.profileWrites,
      economicPending: storage.economic.pending, socketClosed: socketSettled } };
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('temporary session/profile did not settle before cleanup');
}
async function verifyMarkedAccount(accountId, marker) {
  const current = unwrap(await bounded(admin.auth.admin.getUserById(accountId), 'verify temporary account'));
  assert.equal(current.user.id, accountId);
  assert.equal(current.user.user_metadata?.mn_qa_marker, marker, 'temporary account marker must match');
  return current.user;
}
function check(name) {
  evidence.checks.push({ name, pass: true });
  console.log(JSON.stringify({ check: name, pass: true }));
}
async function wait(fn, label, timeoutMs = 90000) {
  try { await page.waitForFunction(fn, null, { timeout: timeoutMs }); }
  catch { throw new Error(`bounded browser wait expired: ${label}`); }
}
async function capture(label) {
  const filename = `${label}.png`;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(out, filename) }); evidence.screenshots.push(filename);
}
async function readCreationSnapshot() {
  return page.evaluate(() => window.__mn?.panels?.companionsPanel?.creationEditor?.client?.snapshot?.() ?? null);
}
async function openCreationWizard(expectCharacterKey = null) {
  await page.locator('.mn-companion-create-open').click();
  await page.waitForFunction(expectCharacterKey => {
    const snapshot = window.__mn?.panels?.companionsPanel?.creationEditor?.client?.snapshot?.();
    return snapshot?.status === 'ready' && snapshot.available === true && snapshot.durable === true &&
      (expectCharacterKey ? snapshot.record?.characterKey === expectCharacterKey : snapshot.record === null);
  }, expectCharacterKey, { timeout: 30000 });
  await wait(() => {
    const editor = document.querySelector('.mn-companion-create');
    return editor && !editor.hidden;
  }, 'creation wizard visible');
}
function assertMobileFit(layout) {
  assert.ok(layout.documentWidth <= layout.viewport.width, JSON.stringify(layout));
  for (const [name, box] of [['companions panel', layout.panel], ['creation editor', layout.editor]]) {
    assert.ok(box.left >= -1 && box.right <= layout.viewport.width + 1, `${name} outside mobile viewport: ${JSON.stringify(layout)}`);
    assert.ok(box.scrollWidth <= box.clientWidth + 1, `${name} has horizontal overflow: ${JSON.stringify(layout)}`);
  }
  assert.ok(layout.panel.top < layout.viewport.height && layout.editor.top < layout.viewport.height,
    `mobile panel/editor start below viewport: ${JSON.stringify(layout)}`);
}
async function mobileLayout() {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector), rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      panel: box('.mn-companions-panel'), editor: box('.mn-companion-create') };
  });
}
function persistPrivateManifest(accountId, marker, characterKey = null, creationId = null) {
  const privateRoot = path.join(ROOT, '.scratch', 'qa-companion-creation');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const targetPath = manifestPath || path.join(privateRoot, 'cleanup-pending.json');
  if (!manifestPath) assert.ok(!fs.existsSync(targetPath), 'an earlier canary cleanup manifest is still pending');
  const manifest = { accountId, marker, world: WORLD, characterKey, creationId };
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, targetPath);
    if (!manifestPath) manifestPath = targetPath;
  } catch (error) { try { fs.rmSync(temporaryPath, { force: true }); } catch {} throw error; }
}

let accountId = null, marker = null, email = null, password = null, browser, context, page, chromium;
let gameSocketSeen = false, gameSocketClosed = false, gameSocketSequence = 0, attemptedCreation = false, attemptedIntent = null;
let stagedRecord = null, manifestPath = null;
let evidence = { schema: 'mn.companion-creation.public.v1', at: new Date().toISOString(), target: target.origin,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, world: WORLD,
  production: true, simulatedAuth: false, modelCalls: false, otherGameplayCommands: false,
  checks: [], screenshots: [], errors: [], acceptancePass: false, cleanupPending: false, cleanupComplete: false, pass: false };

async function runCleanupMode() {
  const privateRoot = path.resolve(ROOT, '.scratch', 'qa-companion-creation');
  assert.ok(cleanupManifestPath.startsWith(`${privateRoot}${path.sep}`), 'cleanup manifest must be inside the private .scratch directory');
  const manifest = JSON.parse(fs.readFileSync(cleanupManifestPath, 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), [...requiredManifestKeys].sort(), 'cleanup manifest schema mismatch');
  assert.match(manifest.accountId, UUID); assert.match(manifest.marker, /^mnQaCompanionCreation:[0-9a-f-]{36}$/i);
  assert.equal(manifest.world, WORLD);
  for (const key of ['characterKey', 'creationId']) assert.ok(manifest[key] === null || UUID.test(manifest[key]), `invalid ${key} in cleanup manifest`);
  const evidencePath = path.join(out, 'acceptance.json');
  evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.schema, 'mn.companion-creation.public.v1');
  assert.equal(evidence.cleanupPending, true); assert.equal(evidence.cleanupComplete, false);
  assert.equal(evidence.target, target.origin); assert.equal(evidence.world, manifest.world);
  if (manifest.characterKey !== null) assert.equal(evidence.created?.characterKey, manifest.characterKey);
  if (manifest.creationId !== null) assert.equal(evidence.created?.creationId, manifest.creationId);
  let cleanupError = null;
  try {
    await checkPublicReadiness();
    await verifyMarkedAccount(manifest.accountId, manifest.marker);
    const record = await bounded(store.loadCompanionCreation({ world: manifest.world, owner: manifest.accountId }), 'verify creation registry cleanup');
    assert.equal(record, null, 'refusing account deletion while a companion creation registry record exists');
    const { profile, settlement } = await settleProfile(manifest.accountId);
    if (profile) assert.equal(profile.data?.pirateId, `account:${manifest.accountId}`);
    if (profile) {
      const deletedProfiles = unwrap(await bounded(admin.from('mn_profiles').delete()
        .eq('player_id', manifest.accountId).select('player_id'), 'delete exact temporary profile'));
      assert.ok(Array.isArray(deletedProfiles) && deletedProfiles.length === 1 && deletedProfiles[0].player_id === manifest.accountId,
        'exact temporary profile row was not deleted');
    }
    unwrap(await bounded(admin.auth.admin.deleteUser(manifest.accountId), 'delete marked temporary account'));
    const profileAfter = await bounded(store.loadProfile(manifest.accountId), 'verify deleted profile');
    const authAfter = await bounded(admin.auth.admin.getUserById(manifest.accountId), 'verify deleted auth account');
    assert.equal(profileAfter, null);
    assert.ok(authAfter?.error && authAfter.error.status === 404, 'temporary auth account deletion was not verified');
    evidence.cleanupPending = false; evidence.cleanupComplete = true;
    evidence.cleanup = { markerMatchedBeforeDelete: true, registryAbsentBeforeDelete: true,
      profileDeleted: true, authDeleted: true, ...settlement };
    evidence.pass = evidence.acceptancePass === true;
    check('marked_account_and_profile_deleted_after_registry_absence_verified');
  } catch (error) {
    cleanupError = redact(error.stack || error);
    evidence.pass = false; evidence.cleanupPending = true; evidence.cleanupComplete = false;
    evidence.cleanupError = cleanupError;
    console.error(redact(error.message));
  } finally {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  }
  if (!cleanupError && evidence.cleanupComplete) {
    fs.unlinkSync(cleanupManifestPath);
    console.log('cleanup complete; evidence updated');
  }
  process.exitCode = evidence.pass ? 0 : 1;
}

async function runAcceptanceMode() {
  marker = `mnQaCompanionCreation:${randomUUID()}`;
  email = `mn-companion-creation-${randomUUID()}@example.com`;
  password = `Aa1!${randomBytes(28).toString('base64url')}`;
  let activeStatus = null, accountCreated = false, signedInProfile = null;
  try {
    fs.mkdirSync(out, { recursive: true });
    assert.ok(!fs.existsSync(path.join(ROOT, '.scratch', 'qa-companion-creation', 'cleanup-pending.json')),
      'an earlier canary cleanup manifest is still pending');
    activeStatus = await checkPublicReadiness();
    check('public_alpha_SQL034_readiness_and_storage');
    const { data: created, error: createError } = await bounded(admin.auth.admin.generateLink({ type: 'signup', email, password }), 'temporary signup link');
    if (createError || !created?.user?.id || !created?.properties?.hashed_token) throw new Error('temporary account setup failed');
    accountId = created.user.id; accountCreated = true;
    unwrap(await bounded(admin.auth.admin.updateUserById(accountId, { user_metadata: { mn_qa_marker: marker } }), 'mark temporary account'));
    persistPrivateManifest(accountId, marker);
    unwrap(await bounded(pub.auth.verifyOtp({ token_hash: created.properties.hashed_token, type: 'signup' }), 'verify temporary account'));
    assert.equal(await bounded(store.loadProfile(accountId), 'check new account profile'), null, 'temporary account must begin without a game profile');
    check('marked_verified_account_starts_without_game_profile');

    const playwrightPath = path.resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
    ({ chromium } = await import(pathToFileURL(playwrightPath).href));
    browser = await bounded(chromium.launch({ channel: 'chrome', headless: true,
      args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] }), 'launch headless Chrome', 30000);
    context = await browser.newContext({ locale: 'es-MX', viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    page.on('pageerror', error => evidence.errors.push(redact(error.message)));
    page.on('websocket', socket => {
      let isGameSocket = false;
      try { const socketUrl = new URL(socket.url());
        isGameSocket = socketUrl.protocol === 'wss:' && socketUrl.host === target.host && socketUrl.pathname.endsWith('/ws'); }
      catch { /* Ignore non-game sockets. */ }
      if (!isGameSocket) return;
      const sequence = ++gameSocketSequence;
      gameSocketSeen = true; gameSocketClosed = false;
      socket.on('close', () => { if (sequence === gameSocketSequence) gameSocketClosed = true; });
    });

    await page.goto(`${target.origin}/?q=low`, { waitUntil: 'commit', timeout: 90000 });
    await wait(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'client ready');
    await page.locator('.account-open').click();
    await page.locator('.account-form input[name="email"]').fill(email);
    await page.locator('.account-form input[name="password"]').fill(password);
    await page.locator('.account-submit').click();
    await wait(() => { const panel = document.querySelector('.account-signed'); return panel && !panel.hidden; }, 'real UI login');
    await page.locator('.account-ready').click();
    await wait(() => window.__mn.client.joined && window.__mn.st.mode === 'playing', 'authenticated world entry');
    await wait(() => !window.__mn.st.boarding && document.querySelector('#title')?.hidden, 'normal profile entry settles');
    assert.equal(gameSocketSeen, true);
    signedInProfile = await bounded(store.loadProfile(accountId), 'read host-created profile');
    assert.ok(signedInProfile?.data && signedInProfile.version >= 1, 'host should create the ordinary profile');
    assert.equal(signedInProfile.data.pirateId, `account:${accountId}`);
    check('real_login_and_host_created_normal_profile');
    const connected = await fetchJson(new URL('/status', target), 'connected session status');
    assert.ok(connected.body.sockets >= 1 && connected.body.players >= 1, 'authenticated player should be visible to host');

    await page.locator('.mn-companions-toggle').click();
    await page.waitForSelector('.mn-companions-panel:not([hidden])');
    await wait(() => window.__mn.companions.snapshot().status === 'ready', 'authenticated companion owner response');
    await openCreationWizard();
    check('authenticated_creation_client_reports_available_and_durable');
    await capture('01-companion-creation-desktop-es-draft');

    await page.locator('.mn-companion-create [data-field="name"]').fill('Brisa QA');
    await page.locator('.mn-companion-create [data-field="role"]').selectOption('harvester');
    await page.locator('.mn-companion-create [data-field="personality"]').selectOption('warm');
    const selectedTraits = await page.locator('.mn-companion-create [data-field="trait"]:checked').evaluateAll(nodes => nodes.map(node => node.value));
    for (const trait of selectedTraits) await page.locator(`.mn-companion-create [data-field="trait"][value="${trait}"]`).uncheck();
    await page.locator('.mn-companion-create [data-field="trait"][value="prudent"]').check();
    await page.locator('.mn-companion-create [data-field="trait"][value="kind"]').check();
    await page.locator('.mn-companion-create-review').waitFor({ state: 'hidden' });
    await page.locator('.mn-companion-create button').filter({ hasText: /Revisar documentos|Review documents/ }).click();
    await wait(() => !document.querySelector('.mn-companion-create-review')?.hidden, 'review documents visible');
    const preview = await page.evaluate(() => ({ name: document.querySelector('.mn-companion-create [data-field="name"]')?.value,
      role: document.querySelector('.mn-companion-create [data-field="role"]')?.value,
      personality: document.querySelector('.mn-companion-create [data-field="personality"]')?.value,
      personalityDoc: document.querySelector('.mn-companion-create-review .mn-companion-create-doc')?.textContent,
      goals: [...document.querySelectorAll('.mn-companion-create-review li')].map(node => node.textContent) }));
    assert.deepEqual([preview.name, preview.role, preview.personality], ['Brisa QA', 'harvester', 'warm']);
    assert.ok(preview.personalityDoc?.length > 0 && preview.goals.length > 0);
    evidence.preview = preview;
    check('Brisa_QA_harvester_warm_prudent_kind_reviewed');
    await capture('02-companion-creation-desktop-es-review');
    await page.locator('.mn-companion-create-review input[type="checkbox"]').check();
    const createButton = page.locator('.mn-companion-create-review button').last();
    assert.equal(await createButton.isEnabled(), true);
    await createButton.click(); attemptedCreation = true;
    attemptedIntent = await page.evaluate(() => window.__mn.panels.companionsPanel.creationEditor.client.creationIntent);
    persistPrivateManifest(accountId, marker, null, attemptedIntent?.creationId ?? null);
    await wait(() => {
      const snapshot = window.__mn?.panels?.companionsPanel?.creationEditor?.client?.snapshot?.();
      return snapshot?.status === 'ready' && snapshot.durable === true && snapshot.record?.preset?.name === 'Brisa QA';
    }, 'durable creation receipt', 30000);
    const clientSnapshot = await readCreationSnapshot();
    assert.ok(clientSnapshot?.record?.characterKey);
    const publicRecord = await bounded(store.loadCompanionCreation({ world: WORLD, owner: accountId }), 'read public creation record');
    assert.deepEqual(publicRecord, clientSnapshot.record);
    assert.equal(publicRecord.preset.name, 'Brisa QA'); assert.equal(publicRecord.preset.role, 'harvester');
    assert.equal(publicRecord.preset.personality, 'warm'); assert.deepEqual(publicRecord.preset.traits, ['prudent', 'kind']);
    assert.equal(publicRecord.configuration.revision, 1); assert.equal(publicRecord.control.revision, 1);
    assert.equal(publicRecord.control.stopped, true);
    const expectedPreset = validateCompanionPreset({ v: 1, name: 'Brisa QA', role: 'harvester', personality: 'warm', traits: ['prudent', 'kind'], skin: publicRecord.preset.skin });
    assert.deepEqual(publicRecord.preset, expectedPreset);
    assert.deepEqual(publicRecord.configuration.config, companionCreationConfig(expectedPreset));
    const savedText = await page.locator('.mn-companion-create-saved').textContent();
    assert.ok(savedText.includes(publicRecord.characterKey)); assert.ok(savedText.includes('Brisa QA'));
    assert.ok(savedText.includes(publicRecord.configuration.config.personality));
    for (const goal of publicRecord.configuration.config.goals) assert.ok(savedText.includes(goal.text));
    stagedRecord = publicRecord;
    persistPrivateManifest(accountId, marker, publicRecord.characterKey, publicRecord.creationId);
    evidence.created = { characterKey: publicRecord.characterKey, creationId: publicRecord.creationId,
      preset: publicRecord.preset, configuration: publicRecord.configuration, control: publicRecord.control };
    check('public_SQL034_record_matches_visible_ID_documents_and_stopped_revisions');

    await capture('03-companion-creation-desktop-es-saved');
    await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('en'));
    await wait(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Create companion', 'English creation copy');
    await capture('04-companion-creation-desktop-en-saved');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('es'));
    await wait(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Crear compañero', 'Spanish mobile copy');
    let layout = await mobileLayout(); assertMobileFit(layout);
    check('companion_creation_portrait_390x844_es_fits'); await capture('05-companion-creation-mobile-es-saved');
    await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('en'));
    await wait(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Create companion', 'English mobile copy');
    layout = await mobileLayout(); assertMobileFit(layout);
    check('companion_creation_portrait_390x844_en_fits'); await capture('06-companion-creation-mobile-en-saved');

    await page.reload({ waitUntil: 'commit', timeout: 90000 });
    await wait(() => window.__mn && !document.querySelector('#btn-play')?.disabled, 'client after reload');
    await wait(() => { const panel = document.querySelector('.account-signed'); return panel && !panel.hidden; }, 'persisted real UI login');
    await page.locator('#btn-play').click();
    await wait(() => window.__mn.client.joined && window.__mn.st.mode === 'playing', 'rejoined authenticated world');
    await wait(() => !window.__mn.st.boarding && document.querySelector('#title')?.hidden, 'rejoined profile entry settles');
    await page.locator('.mn-companions-toggle').click();
    await page.waitForSelector('.mn-companions-panel:not([hidden])');
    await wait(() => window.__mn.companions.snapshot().status === 'ready', 'companion list after rejoin');
    await openCreationWizard(publicRecord.characterKey);
    const recovered = await readCreationSnapshot();
    assert.deepEqual(recovered.record, publicRecord);
    const recoveredText = await page.locator('.mn-companion-create-saved').textContent();
    assert.ok(recoveredText.includes(publicRecord.characterKey) && recoveredText.includes('Brisa QA'));
    assert.ok(recoveredText.includes(publicRecord.configuration.config.personality));
    for (const goal of publicRecord.configuration.config.goals) assert.ok(recoveredText.includes(goal.text));
    assert.deepEqual(await bounded(store.loadCompanionCreation({ world: WORLD, owner: accountId }), 'verify rejoined public record'), publicRecord);
    check('page_reload_and_rejoin_recover_same_character_and_documents');
    await page.evaluate(async () => (await import('/src/core/i18n.js')).setLocale('es'));
    await wait(() => document.querySelector('.mn-companion-create h3')?.textContent === 'Crear compañero', 'final Spanish copy');
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture('07-companion-creation-rejoined-desktop-es');
    assert.deepEqual(await page.evaluate(() => [...window.__mn.errors]), [], 'no game runtime errors');
    assert.equal(evidence.errors.length, 0, 'no browser page errors');
    evidence.acceptancePass = true;
    check('public_browser_runtime_and_page_errors_empty');
  } catch (error) {
    evidence.acceptancePass = false; evidence.errors.push(redact(error.stack || error));
    console.error(redact(error.message));
  } finally {
    if (gameSocketSeen && !gameSocketClosed && page && !page.isClosed()) {
      try {
        const transportReady = await page.evaluate(() => {
          const transport = window.__mn?.transport;
          if (transport?.kind !== 'ws' || !transport.ws) return false;
          transport.close(); return true;
        });
        if (transportReady) {
          await page.waitForFunction(() => window.__mn.transport.ws.readyState === WebSocket.CLOSED, null, { timeout: 15000 });
          gameSocketClosed = true;
        } else {
          await page.goto('about:blank', { waitUntil: 'commit', timeout: 15000 });
          for (let attempt = 0; attempt < 30 && !gameSocketClosed; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
          assert.ok(gameSocketClosed, 'temporary pre-boot socket close was not observed');
        }
      } catch (error) { evidence.acceptancePass = false; evidence.errors.push(`session close: ${redact(error.message)}`); }
    }
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    if (evidence.errors.length) evidence.acceptancePass = false;

    if (accountCreated && accountId) {
      try {
        await verifyMarkedAccount(accountId, marker);
        const { profile, settlement } = await settleProfile(accountId, { requireClosedSocket: gameSocketSeen, gameSocketClosed });
        assert.ok(!profile || profile.data?.pirateId === `account:${accountId}`);
        stagedRecord = await bounded(store.loadCompanionCreation({ world: WORLD, owner: accountId }), 'read creation before staged cleanup');
        persistPrivateManifest(accountId, marker, stagedRecord?.characterKey ?? null,
          stagedRecord?.creationId ?? attemptedIntent?.creationId ?? null);
        evidence.cleanupPending = true; evidence.cleanupComplete = false; evidence.pass = false;
        evidence.canaryRetained = { account: true, ordinaryProfile: profile !== null,
          creationRecord: stagedRecord !== null, sessionClosed: !gameSocketSeen || gameSocketClosed,
          stableProfileReads: settlement.stableProfileReads, storageIdle: settlement.unsaved === 0 && settlement.profileWrites === 0 && settlement.economicPending === 0 };
        evidence.cleanup = { required: true, completed: false, manifest: path.relative(ROOT, manifestPath).replaceAll(path.sep, '/') };
      } catch (error) {
        evidence.acceptancePass = false; evidence.pass = false;
        evidence.errors.push(`staged cleanup preparation: ${redact(error.stack || error)}`);
      }
    }
    if (accountCreated && accountId && !manifestPath) {
      evidence.cleanupPending = true; evidence.cleanupComplete = false; evidence.pass = false;
    }
    evidence.pass = evidence.acceptancePass === true && evidence.cleanupComplete === true;
    if (out && fs.existsSync(out)) {
      try { fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n'); }
      catch (error) { evidence.pass = false; console.error(`evidence write failed: ${redact(error.message)}`); }
    }
  }
  if (manifestPath) console.log(manifestPath);
  else console.log('cleanup manifest unavailable; inspect acceptance evidence');
  process.exitCode = evidence.pass ? 0 : 1;
}

if (cleanupManifestPath) await runCleanupMode();
else await runAcceptanceMode();

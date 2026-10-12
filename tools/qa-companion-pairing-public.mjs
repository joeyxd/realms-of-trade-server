#!/usr/bin/env node
// Public WSS acceptance for one SQL034-owned local companion pairing.
// The marked canary is retained until a separate registry cleanup is verified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { storeFromEnv } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { claimPairCode, PairedCompanion } from './agent/paired-companion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = path.join(ROOT, '.scratch', 'qa-companion-pairing');
const MANIFEST_PATH = path.join(PRIVATE, 'cleanup-pending.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_MANIFEST_KEYS = ['ownerId', 'characterId', 'creationId', 'marker'];
const EXPECTED_VERSION = '0.6.0-alpha.60';
const STUB_REPLY = 'Brisa te responde.';
const CHAT_TEXT = 'Brisa, comparte una palabra sobre el mar.';
let envFile, out, cleanupPath;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--env-file') envFile = process.argv[++i];
  else if (process.argv[i] === '--out') out = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--cleanup') cleanupPath = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--help') {
    console.log('Create:  node tools/qa-companion-pairing-public.mjs --env-file PATH --out NEW_DIRECTORY');
    console.log('Cleanup: node tools/qa-companion-pairing-public.mjs --env-file PATH --out EXISTING_DIRECTORY --cleanup MANIFEST');
    process.exit(0);
  } else throw new Error('unknown argument');
}
if (envFile) process.loadEnvFile(path.resolve(envFile));
const WORLD = process.env.WORLD_ID || 'marea-negra';
assert.equal(process.env.MN_QA_ALLOW_PUBLIC, '1', 'explicit public QA guard required');
assert.equal(GAME.version, EXPECTED_VERSION, 'review the public pairing canary after release changes');
assert.equal(PROTOCOL_VERSION, 59, 'review the public pairing canary after protocol changes');
const expectedVersion = process.env.MN_QA_EXPECTED_VERSION || EXPECTED_VERSION;
assert.equal(expectedVersion, EXPECTED_VERSION, 'explicit alpha.60 release version required');
if (cleanupPath) assert.ok(out && fs.existsSync(out), 'existing evidence directory required for cleanup mode');
else assert.ok(out && !fs.existsSync(out), 'new evidence directory required');
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY', 'SUPABASE_SERVICE_KEY']) {
  assert.ok(process.env[key], 'private QA configuration unavailable');
}
const target = new URL(process.env.MN_QA_TARGET || 'https://marea.62.171.136.148.sslip.io');
assert.equal(target.protocol, 'https:');
assert.equal(target.origin, 'https://marea.62.171.136.148.sslip.io', 'canary is restricted to the public alpha');
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
let ownerId = null, marker = null, email = null, password = null, accessToken = null, pairCode = null, bootstrapToken = null;
const redact = value => {
  let text = String(value ?? 'public canary failed');
  for (const [secret, label] of [[email, '[redacted-email]'], [password, '[redacted-secret]'],
    [accessToken, '[redacted-auth]'], [pairCode, '[redacted-code]'], [bootstrapToken, '[redacted-token]'],
    [marker, '[redacted-marker]'], [ownerId, '[redacted-owner]'],
    [process.env.SUPABASE_SERVICE_KEY, '[redacted-key]'], [process.env.SUPABASE_PUBLIC_KEY, '[redacted-key]'],
    [CHAT_TEXT, '[redacted-chat]'], [STUB_REPLY, '[redacted-chat]']]) {
    if (secret) text = text.replaceAll(secret, label);
  }
  return text.replace(/mncp_[0-9a-f]{64}/gi, '[redacted-token]')
    .replace(/[0-9a-f]{64}/gi, '[redacted-secret]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted-id]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(/(access_token|refresh_token|token_hash|hashed_token|token|password|apikey)([=:\s"%20]+)[^&\s"']+/gi, '$1$2[redacted]');
};
async function fetchJson(url, label) {
  const response = await bounded(timeoutFetch(url), label);
  const body = await bounded(response.json(), `${label} JSON`);
  return { response, body };
}
async function checkPublicReadiness() {
  const { response: statusResponse, body: status } = await fetchJson(new URL('/status', target), 'public status');
  assert.ok(statusResponse.ok && status.version === expectedVersion && status.errors === 0, 'public alpha release is not healthy/current');
  assert.equal(status.storage?.durable, true); assert.equal(status.storage?.accounts, true);
  assert.equal(status.storage?.world?.id, WORLD);
  assert.equal(status.storage?.companionCreation?.ready, true);
  assert.equal(status.storage?.companionPairing?.enabled, true); assert.equal(status.storage?.companionPairing?.ready, true);
  const { response: authResponse, body: authConfig } = await fetchJson(new URL('/auth/config', target), 'public auth config');
  assert.ok(authResponse.ok && authConfig.enabled === true);
  assert.equal(new URL(authConfig.url).origin, new URL(process.env.SUPABASE_URL).origin,
    'public auth must match the QA Supabase project');
  assert.deepEqual(await store.checkCompanionCreation(), { version: 1 });
  assert.deepEqual(await store.checkCompanionConfig(), { version: 1 });
  assert.deepEqual(await store.checkCompanionControl(), { version: 1 });
  const content = status.content ?? { generation: 0, revisionId: null };
  assert.ok(content && Number.isSafeInteger(content.generation) &&
    (content.revisionId === null || /^[a-f0-9]{64}$/.test(content.revisionId)), 'public content identity unavailable');
  return { status, content: { generation: content.generation, revisionId: content.revisionId } };
}
function persistManifest(characterId = null, creationId = null) {
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  fs.chmodSync(PRIVATE, 0o700);
  const manifest = { ownerId, characterId, creationId, marker };
  const temporary = `${MANIFEST_PATH}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, MANIFEST_PATH);
  } catch (error) { try { fs.rmSync(temporary, { force: true }); } catch {} throw error; }
}
async function verifyMarkedAccount(id, expectedMarker) {
  const current = unwrap(await bounded(admin.auth.admin.getUserById(id), 'verify marked canary account'));
  assert.equal(current.user.id, id);
  assert.equal(current.user.user_metadata?.mn_qa_marker, expectedMarker, 'temporary account marker mismatch');
  return current.user;
}
async function settleProfile(id, socketClosed) {
  let previous = null, stable = 0, profile = null, storage = {};
  for (let attempt = 0; attempt < 60; attempt++) {
    profile = await bounded(store.loadProfile(id), 'settle canary profile');
    if (profile) assert.equal(profile.data?.pirateId, `account:${id}`, 'canary profile identity changed');
    const { body } = await fetchJson(new URL('/status', target), 'settle public storage');
    storage = body.storage || {};
    const signature = JSON.stringify(profile);
    stable = signature === previous ? stable + 1 : 0; previous = signature;
    if (socketClosed && stable >= 2 && storage.unsaved === 0 && storage.profileWrites === 0 &&
        storage.economic?.pending === 0) return { profile, stableReads: stable + 1, storage };
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('canary profiles did not settle');
}
const canaryOwnerName = id => `QA-${id.slice(0, 8)}`;
async function waitCanarySocketsClosed(id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { body } = await fetchJson(new URL('/status', target), 'verify canary sockets closed');
    const names = body.names;
    assert.ok(Array.isArray(names), 'public socket names unavailable for cleanup fence');
    if (!names.includes(canaryOwnerName(id)) && !names.includes('Brisa [IA]')) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('canary WSS sessions remain active');
}
function check(name) {
  evidence.checks.push({ name, pass: true });
  console.log(JSON.stringify({ check: name, pass: true }));
}
async function waitForClose(ws, label) {
  if (ws.readyState === WebSocket.CLOSED) return;
  await bounded(new Promise(resolve => ws.once('close', resolve)), label, 10000);
}

class Wire {
  constructor(url) {
    this.ws = new WebSocket(url); this.messages = []; this.waiters = [];
    this.opened = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', raw => {
      let message; try { message = JSON.parse(raw.toString()); } catch { return; }
      this.messages.push(message);
      if (this.messages.length > 500) this.messages.shift();
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
      }
    });
  }
  async send(message) { await this.opened; this.ws.send(JSON.stringify(message)); }
  wait(predicate, label, timeoutMs = 12000) {
    const found = this.messages.find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error(`public WSS wait timed out: ${label}`));
      }, timeoutMs) };
      this.waiters.push(waiter);
    });
  }
  async join(token, content) {
    await this.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, token, name: canaryOwnerName(ownerId), skin: 0, weapon: 0, content });
    const admitted = await this.wait(message => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(message.t), 'owner admission');
    assert.equal(admitted.t, MSG.WELCOME, 'public owner WSS admission failed');
    const chat = await this.wait(message => message.t === MSG.CHAT_STATE && typeof message.self === 'string', 'owner chat identity');
    this.self = chat.self;
  }
  async request(type, op, extra = {}) {
    const requestId = randomUUID();
    await this.send({ t: type, requestId, op, ...extra });
    return this.wait(message => message.requestId === requestId &&
      [MSG.AGENT_COMPANION_CREATE_RESULT, MSG.AGENT_OWNER_RESULT, MSG.AGENT_COMPANION_PAIR_RESULT].includes(message.t), op);
  }
  async close() {
    if (this.ws.readyState < WebSocket.CLOSING) this.ws.close();
    await waitForClose(this.ws, 'owner WSS close');
  }
}
async function ownerOperation(wire, type, op, extra = {}) {
  const result = await wire.request(type, op, extra);
  assert.equal(result.ok, true, `owner ${op} rejected`);
  return result;
}
async function controlOperation(wire, op, row = null) {
  return ownerOperation(wire, MSG.AGENT_OWNER, op, row ? { characterKey: row.characterKey,
    epoch: row.epoch, expectedRevision: row.control.revision } : {});
}
async function controlRow(wire, characterId) {
  const listed = await controlOperation(wire, 'list');
  const row = listed.companions?.find(value => value.characterKey === characterId);
  assert.ok(row, 'created companion missing from owner list');
  return row;
}
async function runLocalModelStub() {
  let calls = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    try {
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions' || body.stream !== false) {
        response.writeHead(404).end(); return;
      }
      calls++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `local-qa-${calls}`, object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ v: 1,
          decision: { type: 'reply', args: { text: STUB_REPLY } } }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, get calls() { return calls; }, url: `http://127.0.0.1:${server.address().port}/v1` };
}
async function assertNoCredentialFiles(directory, credentials) {
  const walk = async current => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      assert.equal(credentials.some(secret => secret && entry.name.includes(secret)), false,
        'pairing credential appeared in a local filename');
      const stat = await fsp.lstat(file);
      assert.equal(stat.isSymbolicLink(), false, 'unexpected symlink in local companion files');
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) {
        const contents = await fsp.readFile(file, 'utf8');
        assert.equal(credentials.some(secret => secret && contents.includes(secret)), false,
          'pairing credential appeared in a local companion file');
      }
    }
  };
  await walk(directory);
}
async function settlePair(pair, ownerWire, localStub, runnerRoot) {
  try { await pair?.close(); } catch {}
  try { await ownerWire?.close(); } catch {}
  try {
    if (localStub?.server.listening) {
      localStub.server.closeAllConnections();
      await new Promise(resolve => localStub.server.close(resolve));
    }
  } catch {}
  if (runnerRoot) {
    const absolute = path.resolve(runnerRoot);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()), 'temporary runner escaped the intended directory');
    assert.ok(path.basename(absolute).startsWith('mn-pairing-public-'), 'unexpected temporary runner path');
    try { await fsp.rm(absolute, { recursive: true, force: true }); } catch {}
  }
}

let evidence = { schema: 'mn.companion-pairing.public.v1', at: new Date().toISOString(), target: target.origin,
  gameVersion: expectedVersion, sourceVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, world: WORLD,
  production: true, publicWss: true, localModelStub: true, realModelCalls: false,
  checks: [], errors: [], acceptancePass: false, cleanupPending: false, cleanupComplete: false, pass: false };
let accountCreated = false, record = null;

async function runCleanup() {
  assert.ok(cleanupPath && out && fs.existsSync(out), 'cleanup evidence directory unavailable');
  const privateRoot = path.resolve(PRIVATE);
  assert.ok(cleanupPath.startsWith(`${privateRoot}${path.sep}`), 'cleanup manifest must be inside private .scratch');
  assert.equal(cleanupPath, MANIFEST_PATH, 'cleanup may only use the pending public pairing canary manifest');
  const manifest = JSON.parse(fs.readFileSync(cleanupPath, 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), [...REQUIRED_MANIFEST_KEYS].sort(), 'cleanup manifest schema mismatch');
  assert.match(manifest.ownerId, UUID); assert.match(manifest.marker, /^mnQaCompanionPairing:[0-9a-f-]{36}$/i);
  for (const key of ['characterId', 'creationId']) assert.ok(manifest[key] === null || UUID.test(manifest[key]), `invalid ${key}`);
  if (manifest.characterId) assert.notEqual(manifest.characterId, manifest.ownerId);
  const evidencePath = path.join(out, 'acceptance.json');
  evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.schema, 'mn.companion-pairing.public.v1');
  assert.equal(evidence.cleanupPending, true); assert.equal(evidence.cleanupComplete, false);
  assert.equal(evidence.target, target.origin); assert.equal(evidence.world, WORLD);
  if (manifest.characterId) assert.equal(evidence.created?.characterId, manifest.characterId);
  if (manifest.creationId) assert.equal(evidence.created?.creationId, manifest.creationId);
  try {
    await checkPublicReadiness(); await verifyMarkedAccount(manifest.ownerId, manifest.marker);
    const registered = await bounded(store.loadCompanionCreation({ world: WORLD, owner: manifest.ownerId }), 'verify SQL034 cleanup');
    assert.equal(registered, null, 'refusing profile deletion while the SQL034 creation registry row exists');
    await waitCanarySocketsClosed(manifest.ownerId);
    const settled = await Promise.all([settleProfile(manifest.ownerId, true),
      ...(manifest.characterId ? [settleProfile(manifest.characterId, true)] : [])]);
    let ownerProfileDeleted = settled[0].profile === null;
    let characterProfileDeleted = !manifest.characterId || settled[1]?.profile === null;
    for (const [index, id] of [manifest.ownerId, ...(manifest.characterId ? [manifest.characterId] : [])].entries()) {
      const profile = settled[index].profile;
      if (profile) assert.equal(profile.data?.pirateId, `account:${id}`, 'refusing deletion of an unexpected profile identity');
      if (profile) {
        const deleted = unwrap(await bounded(admin.from('mn_profiles').delete().eq('player_id', id).select('player_id'), 'delete exact canary profile'));
        assert.ok(Array.isArray(deleted) && deleted.length === 1 && deleted[0].player_id === id,
          'exact canary profile row was not deleted');
        if (index === 0) ownerProfileDeleted = true; else characterProfileDeleted = true;
      }
    }
    for (const id of [manifest.ownerId, ...(manifest.characterId ? [manifest.characterId] : [])]) {
      assert.equal(await bounded(store.loadProfile(id), 'verify canary profile deletion'), null);
    }
    unwrap(await bounded(admin.auth.admin.deleteUser(manifest.ownerId), 'delete marked canary auth account'));
    const authAfter = await bounded(admin.auth.admin.getUserById(manifest.ownerId), 'verify canary auth deletion');
    assert.ok(authAfter?.error && authAfter.error.status === 404, 'temporary auth deletion was not verified');
    evidence.cleanupPending = false; evidence.cleanupComplete = true; evidence.pass = evidence.acceptancePass === true;
    evidence.cleanup = { markerMatched: true, registryAbsentBeforeProfileDelete: true,
      ownerProfileDeleted, characterProfileDeleted, authDeleted: true };
    check('registry_absent_then_exact_canary_profiles_and_auth_deleted');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    fs.unlinkSync(cleanupPath);
    console.log('cleanup complete');
  } catch (error) {
    evidence.pass = false; evidence.cleanupPending = true; evidence.cleanupComplete = false;
    evidence.errors.push(redact(error?.message));
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.error(redact(error?.message));
    process.exitCode = 1;
  }
}

async function runAcceptance() {
  let ownerWire = null, pair = null, stub = null, runnerRoot = null, wsUrl = null;
  let ownerSocketClosed = false, runnerStopped = false, canarySocketsClosed = false;
  const manifestExists = () => fs.existsSync(MANIFEST_PATH);
  try {
    fs.mkdirSync(out, { recursive: false });
    assert.equal(manifestExists(), false, 'an earlier pairing canary cleanup manifest is pending');
    const { content } = await checkPublicReadiness();
    wsUrl = new URL('/ws', target); wsUrl.protocol = 'wss:';
    check('public_alpha_auth_SQL034_SQL027_pairing_and_content_ready');

    marker = `mnQaCompanionPairing:${randomUUID()}`;
    email = `mn-pairing-${randomUUID()}@example.com`;
    password = `Aa1!${randomBytes(28).toString('base64url')}`;
    const generated = await bounded(admin.auth.admin.generateLink({ type: 'signup', email, password,
      options: { data: { mn_qa_marker: marker } } }), 'create marked canary auth');
    if (generated.error || !generated.data?.user?.id || !generated.data?.properties?.hashed_token) throw new Error('temporary auth setup failed');
    ownerId = generated.data.user.id; accountCreated = true;
    assert.match(ownerId, UUID);
    persistManifest();
    await verifyMarkedAccount(ownerId, marker);
    const verified = unwrap(await bounded(pub.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: 'signup' }), 'verify canary signup'));
    accessToken = verified.session?.access_token;
    assert.equal(typeof accessToken, 'string');
    assert.equal(await bounded(store.loadProfile(ownerId), 'check initial canary profile'), null,
      'new marked account must not have a game profile before WSS login');
    check('marked_verified_canary_account_starts_without_game_profile');

    ownerWire = new Wire(wsUrl.href);
    await ownerWire.join(accessToken, content);
    const ownerProfile = await bounded(store.loadProfile(ownerId), 'verify public WSS owner profile');
    assert.equal(ownerProfile?.data?.pirateId, `account:${ownerId}`, 'public WSS login did not create the owner profile');
    check('authenticated_owner_joined_public_WSS_with_current_content');

    const creationId = randomUUID();
    const created = await ownerOperation(ownerWire, MSG.AGENT_COMPANION_CREATE, 'create', {
      creationId, preset: structuredClone(DEFAULT_COMPANION_PRESET) });
    record = created.record;
    assert.equal(record?.preset?.name, 'Brisa');
    assert.equal(record?.creationId, creationId);
    assert.equal(record?.control?.stopped, true);
    const durableRecord = await bounded(store.loadCompanionCreation({ world: WORLD, owner: ownerId }), 'verify SQL034 Brisa record');
    assert.equal(durableRecord?.characterKey, record.characterKey);
    persistManifest(record.characterKey, record.creationId);
    evidence.created = { characterId: record.characterKey, creationId: record.creationId,
      name: record.preset.name, controlStoppedInitially: true };
    check('public_WSS_created_Brisa_as_stopped_SQL034_canary');

    const loaded = await ownerOperation(ownerWire, MSG.AGENT_COMPANION_PAIR, 'load');
    assert.equal(loaded.enabled, true);
    let row = await controlRow(ownerWire, record.characterKey);
    assert.deepEqual(row.capabilities, ['chat']);
    const resumed = await controlOperation(ownerWire, 'resume', row);
    row = resumed.companions.find(value => value.characterKey === record.characterKey);
    const durableAllowed = await bounded(store.loadCompanionControl({ world: WORLD, owner: ownerId,
      character: record.characterKey }), 'verify durable allow');
    assert.equal(durableAllowed.stopped, false);
    check('pair_load_registered_chat_only_owner_and_SQL027_resume_committed');

    const issued = await ownerOperation(ownerWire, MSG.AGENT_COMPANION_PAIR, 'issue');
    pairCode = issued.code;
    assert.match(pairCode, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(issued.expiresAtMs) && issued.expiresAtMs > Date.now() &&
      issued.expiresAtMs <= Date.now() + 5 * 60 * 1000);
    stub = await runLocalModelStub();
    runnerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mn-pairing-public-'));
    await fsp.chmod(runnerRoot, 0o700);
    pair = new PairedCompanion({ directory: path.join(runnerRoot, 'Brisa'), url: wsUrl.href,
      baseUrl: stub.url, modelId: 'qwen3.8-flash-next-coder-iq1_m', thinkingMode: 'disabled', maxCalls: 2, maxTokens: 262144,
      claim: async options => { const bootstrap = await claimPairCode(options); bootstrapToken = bootstrap.token; return bootstrap; } });
    const started = await pair.start(pairCode);
    assert.equal(started.ok, true, 'paired controller did not claim and join the public WSS');
    const chatState = await ownerWire.wait(message => message.t === MSG.CHAT_STATE &&
      message.peers?.some(peer => peer.name === 'Brisa [IA]'), 'paired companion peer presence');
    const pairedPeer = chatState.peers.find(peer => peer.name === 'Brisa [IA]');
    assert.equal(typeof pairedPeer?.id, 'string');
    check('one_use_code_claimed_by_real_local_controller_over_public_WSS');

    const chatId = randomUUID();
    await ownerWire.send({ t: MSG.CHAT_SEND, id: chatId, channel: 'world', text: CHAT_TEXT });
    const sent = await ownerWire.wait(message => message.t === MSG.CHAT_RESULT && message.requestId === chatId,
      'owner chat result');
    assert.equal(sent.ok, true, 'owner chat was not accepted');
    const reply = await ownerWire.wait(message => message.t === MSG.CHAT_MESSAGE && message.sender?.id === pairedPeer.id &&
      message.sender?.name === 'Brisa [IA]' &&
      message.text === STUB_REPLY, 'Brisa local model reply', 20000);
    assert.equal(reply.channel, 'world');
    assert.equal(stub.calls, 1, 'exactly one local stub inference expected');
    const memoryPath = path.join(runnerRoot, 'Brisa', 'memory.jsonl');
    let memoryText = '';
    for (let attempt = 0; attempt < 80 && !memoryText.trim(); attempt++) {
      try { memoryText = await fsp.readFile(memoryPath, 'utf8'); } catch { /* pending episode write */ }
      if (!memoryText.trim()) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(memoryText.trim(), 'chat episode was not persisted locally');
    const episodes = memoryText.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.ok(episodes.some(episode => episode.scope?.ownerId === ownerId &&
      episode.scope?.characterId === record.characterKey &&
      episode.payload?.chat?.some(message => message.text === CHAT_TEXT) &&
      episode.payload?.chat?.some(message => message.text === STUB_REPLY)), 'persisted memory episode scope or exchange mismatch');
    await assertNoCredentialFiles(runnerRoot, [pairCode, bootstrapToken]);
    check('owner_chat_received_local_stub_reply_and_scoped_memory_persisted_without_pair_credentials');

    const waitingForStop = pair.waitForStop();
    row = await controlRow(ownerWire, record.characterKey);
    await controlOperation(ownerWire, 'stop', row);
    await bounded(waitingForStop, 'paired runner stop after owner revoke', 15000);
    runnerStopped = pair.state === 'stopped';
    assert.equal(runnerStopped, true);
    const stoppedHead = await bounded(store.loadCompanionControl({ world: WORLD, owner: ownerId,
      character: record.characterKey }), 'verify durable stop');
    assert.equal(stoppedHead.stopped, true);
    const postStop = (await fetchJson(new URL('/status', target), 'post-stop public status')).body;
    assert.ok(Array.isArray(postStop.names) && postStop.names.includes(canaryOwnerName(ownerId)) &&
      !postStop.names.includes('Brisa [IA]'), 'owner stop did not retain the owner session and remove the paired session');
    check('owner_stop_revoked_runner_and_SQL027_is_stopped');
    evidence.acceptancePass = true;
  } catch (error) {
    evidence.acceptancePass = false;
    evidence.errors.push(redact(error?.message));
    console.error(redact(error?.message));
  } finally {
    await settlePair(pair, ownerWire, stub, runnerRoot);
    if (ownerWire) {
      try { await waitForClose(ownerWire.ws, 'owner socket settled'); ownerSocketClosed = true; } catch {}
    }
    if (ownerId) {
      try { canarySocketsClosed = await waitCanarySocketsClosed(ownerId); } catch (error) {
        evidence.acceptancePass = false; evidence.errors.push(`socket settlement: ${redact(error?.message)}`);
      }
    }
    if (accountCreated && ownerId && marker) {
      try {
        await verifyMarkedAccount(ownerId, marker);
        const recovered = await bounded(store.loadCompanionCreation({ world: WORLD, owner: ownerId }), 'recover retained canary record');
        if (recovered) { record = recovered; persistManifest(record.characterKey, record.creationId); }
        const profiles = [];
        const ownerResult = await settleProfile(ownerId, ownerSocketClosed);
        profiles.push(ownerResult);
        let characterProfile = null;
        if (record?.characterKey) {
          characterProfile = await settleProfile(record.characterKey, true);
          profiles.push(characterProfile);
        }
        evidence.cleanupPending = true; evidence.cleanupComplete = false;
        evidence.canaryRetained = { account: true, ownerProfile: ownerResult.profile !== null,
          characterProfile: Boolean(characterProfile?.profile), creationRecord: recovered !== null,
          ownerSocketClosed, runnerStopped: runnerStopped || pair?.state === 'stopped', canarySocketsClosed,
          profilesStable: profiles.every(item => item.stableReads >= 3 && item.storage.unsaved === 0 &&
            item.storage.profileWrites === 0 && item.storage.economic?.pending === 0) };
        evidence.cleanup = { required: true, completed: false,
          manifest: path.relative(ROOT, MANIFEST_PATH).replaceAll(path.sep, '/') };
      } catch (error) {
        evidence.acceptancePass = false; evidence.errors.push(`retention settlement: ${redact(error?.message)}`);
        evidence.cleanupPending = true; evidence.cleanupComplete = false;
      }
    }
    pairCode = null; bootstrapToken = null; accessToken = null; password = null;
    evidence.pass = false;
    if (out) {
      try { fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n'); }
      catch (error) { evidence.pass = false; console.error(`evidence write failed: ${redact(error?.message)}`); }
    }
  }
  console.log(MANIFEST_PATH);
  process.exitCode = evidence.pass ? 0 : 1;
}

if (cleanupPath) await runCleanup();
else await runAcceptance();

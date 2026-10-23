import { constants } from 'node:fs';
import { mkdir, writeFile, lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { validateCompanionRecord } from '../../src/net/companionCreation.js';
import { DEFAULT_COMPANION_DRAFT, validateCompanionDraft, buildCompanionDocuments } from '../../src/net/companionTemplates.js';
import { AgentNetworkRunner } from './network-runner.mjs';
import { AgentMind } from './mind.mjs';
import { runnerMindSnapshot } from './mind-snapshot.mjs';
import { createCompanionFiles } from './create-companion.mjs';
import { loadOwnerFiles } from './owner-files.mjs';
import { createMemoryStore } from './memory-store.mjs';
import { LocalResourceBudget } from './local-resource-budget.mjs';
import { createLocalOpenAIMind, createEndpointOpenAIMind } from './local-openai-mind.mjs';
import { WsTransport } from '../../src/net/wsTransport.js';
import { PresenceDriver } from './presence-driver.mjs';
import { PRESENCE_ORDERS } from './contract.mjs';

const fail = why => ({ ok: false, why });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const MAX_MINUTES = 120;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_TOKEN_TTL_MS = 60 * 60_000 + MAX_CLOCK_SKEW_MS;
const DEFAULTS = Object.freeze({ baseUrl: 'http://127.0.0.1:8080/v1', modelId: 'qwen3.8-flash-next-coder-iq1_m', thinkingMode: 'server_default' });
const BUDGET_FAILURES = new Set(['max_calls', 'max_tokens', 'max_cost_units', 'local_resource_budget_expired',
  'local_resource_outcome_unresolved', 'budget_overrun', 'provider_limit_overrun', 'response_over_budget']);
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) &&
  value.toLowerCase() !== '00000000-0000-0000-0000-000000000000';

function validPairResponse(message, requestId, now = Date.now()) {
  if (!exact(message, ['t', 'requestId', 'ok', 'why', 'enabled', 'code', 'expiresAtMs', 'bootstrap']) ||
      message.t !== 'agent_companion_pair_result' || message.requestId !== requestId || message.ok !== true ||
      message.why !== null || message.enabled !== true || message.code !== null || message.expiresAtMs !== null ||
      !exact(message.bootstrap, ['scope', 'record', 'token', 'expiresAtMs', 'content', 'ownerPeer'])) return null;
  const { scope, record: rawRecord, token, expiresAtMs, content, ownerPeer } = message.bootstrap;
  if (!exact(scope, ['ownerId', 'characterId', 'worldId']) || !uuid(scope.ownerId) || !uuid(scope.characterId) ||
      scope.ownerId.toLowerCase() === scope.characterId.toLowerCase() ||
      typeof scope.worldId !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(scope.worldId)) return null;
  let record;
  try { record = validateCompanionRecord(rawRecord); } catch { return null; }
  if (!exact(content, ['generation', 'revisionId']) || !Number.isSafeInteger(content.generation) || content.generation < 0 ||
      !(content.revisionId === null || (typeof content.revisionId === 'string' && /^[a-f0-9]{64}$/.test(content.revisionId))) ||
      typeof ownerPeer !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerPeer) ||
      record.characterKey !== scope.characterId || !/^mncp_[a-f0-9]{64}$/.test(token) ||
      !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now || expiresAtMs > now + MAX_TOKEN_TTL_MS) return null;
  return { scope: structuredClone(scope), record, token, expiresAtMs, content: structuredClone(content), ownerPeer };
}

// IC08: the hosted controller dials its own server on loopback and presents the public origin explicitly.
const HOSTED_URL = /^ws:\/\/127\.0\.0\.1:[0-9]{1,5}\/ws$/;
const validOrigin = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.origin === value; } catch { return false; }
};

/** Claim a one-use pairing code on an outgoing WSS socket; never returns the code in errors.
 * With an explicit `origin` (hosted mode only) the socket is ws://127.0.0.1:<port>/ws instead, plus `headers`. */
export async function claimPairCode({ url, code, timeoutMs = 10000, WebSocketClass = WebSocket, now = Date.now, origin = null,
  headers = null } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('pair_unavailable'); }
  const hosted = origin !== null;
  if ((hosted ? !validOrigin(origin) || !HOSTED_URL.test(url) : endpoint.protocol !== 'wss:') ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^[a-f0-9]{64}$/.test(code ?? '') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('pair_unavailable');
  const socket = new WebSocketClass(endpoint.href, { origin: hosted ? origin : `https://${endpoint.host}`, ...(hosted && headers ? { headers } : {}) });
  const requestId = randomUUID();
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = value => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { socket.close(); } catch {}
      if (!value) reject(new Error('pair_unavailable')); else resolve(value);
    };
    socket.on('open', () => {
      try { socket.send(JSON.stringify({ t: 'agent_companion_pair', requestId, op: 'claim', code })); }
      catch { finish(null); }
    });
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { finish(null); return; }
      if (message?.requestId !== requestId) return;
      finish(validPairResponse(message, requestId, now()));
    });
    socket.on('error', () => finish(null));
    socket.on('close', () => { if (!settled) finish(null); });
  });
}

async function readManifest(file) {
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || await realpath(file) !== file) throw new Error('paired_files_invalid');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size > 16384) throw new Error('paired_files_invalid');
      const content = await handle.readFile('utf8'), after = await lstat(file);
      if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino) throw new Error('paired_files_invalid');
      return JSON.parse(content);
    } finally { await handle.close(); }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('paired_files_invalid');
  }
}

/** Local controller for an existing public companion. It never creates a GameHost. */
export class PairedCompanion {
  #directory; #url; #policy; #limits; #claim; #runnerFactory; #adapterFactory; #driverFactory;
  #onStatus; #onFeedback; #hosted = false;
  #runner = null; #mind = null; #driver = null; #budget = null; #scope = null; #record = null; #ownerPeer = null; #latestFiles = null; #contextRevision = 0; #state = 'stopped';
  #closed = false; #generation = 0; #queue = Promise.resolve(); #prepareTail = Promise.resolve(); #seen = new Set(); #waiters = new Set();
  #stopWaiters = new Set();
  constructor({ directory, url, baseUrl = DEFAULTS.baseUrl, modelId = DEFAULTS.modelId, thinkingMode = DEFAULTS.thinkingMode,
    maxCalls = 8, maxTokens = 1_000_000, claim, runnerFactory, adapterFactory, onStatus = () => {}, onFeedback = () => {},
    presenceDriverFactory = options => new PresenceDriver(options), hosted = null } = {}) {
    // IC08 hosted mode: an explicit option, a loopback ws URL, an explicit origin and the owner's registered endpoint.
    if (hosted !== null) {
      // The egress fence is mandatory: a hosted mind must never reach a user URL unfenced.
      if (!exact(hosted, ['origin', 'endpointId', 'endpoint', 'egress', 'socketToken']) ||
          !validOrigin(hosted.origin) || typeof url !== 'string' || !HOSTED_URL.test(url) ||
          typeof hosted.endpointId !== 'string' || !/^[a-f0-9]{16}$/.test(hosted.endpointId) ||
          !hosted.endpoint || typeof hosted.endpoint.baseUrl !== 'string' ||
          typeof modelId !== 'string' || !modelId.trim() || modelId.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(modelId) ||
          typeof hosted.egress?.vet !== 'function' || typeof hosted.socketToken !== 'string' ||
          !/^[a-f0-9]{64}$/.test(hosted.socketToken)) throw new TypeError('invalid_paired_companion_options');
      const { origin, endpointId, endpoint, egress } = hosted, headers = { 'x-marea-hosted': hosted.socketToken };
      claim ??= ({ url: address, code }) => claimPairCode({ url: address, code, origin, headers });
      runnerFactory ??= options => new AgentNetworkRunner({ ...options, transportFactory: address => new WsTransport(address,
        { WebSocketImpl: class HostedSocket extends WebSocket { constructor(target) { super(target, { origin, headers }); } } }) });
      adapterFactory ??= options => createEndpointOpenAIMind({ ...options, endpoint: { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey ?? '' },
        egress });
      this.#hosted = true;
      this.#directory = path.resolve(directory); this.#url = url;
      this.#policy = { endpointId, modelId, thinkingMode: 'server_default' };
    }
    claim ??= claimPairCode; runnerFactory ??= options => new AgentNetworkRunner(options); adapterFactory ??= createLocalOpenAIMind;
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof url !== 'string' ||
        !(this.#hosted || /^wss:\/\//i.test(url)) || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 8 ||
        !Number.isSafeInteger(maxTokens) || maxTokens < 32768 || maxTokens > 1_000_000 ||
        typeof claim !== 'function' || typeof runnerFactory !== 'function' || typeof adapterFactory !== 'function' ||
        typeof onStatus !== 'function' || typeof onFeedback !== 'function' || typeof presenceDriverFactory !== 'function')
      throw new TypeError('invalid_paired_companion_options');
    if (!this.#hosted) {
      let endpoint;
      try { endpoint = new URL(url); } catch { throw new TypeError('invalid_paired_companion_options'); }
      if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.hostname)
        throw new TypeError('invalid_paired_companion_options');
      // Reuse the strict loopback validator used by the Studio adapter.
      const draft = validateCompanionDraft({ ...DEFAULT_COMPANION_DRAFT, modelId, baseUrl, thinkingMode });
      this.#directory = path.resolve(directory); this.#url = url; this.#policy = { baseUrl: draft.baseUrl, modelId: draft.modelId, thinkingMode: draft.thinkingMode };
    }
    this.#limits = { maxCalls, maxTokens }; this.#claim = claim; this.#runnerFactory = runnerFactory; this.#adapterFactory = adapterFactory;
    this.#onStatus = onStatus; this.#onFeedback = onFeedback; this.#driverFactory = presenceDriverFactory;
  }
  get state() { return this.#state; }
  get scope() { return this.#scope && structuredClone(this.#scope); }
  get budget() { return this.#budget?.snapshot ?? null; }
  get diagnostics() { return { state: this.#state, scope: this.scope, sessionId: this.#runner?.grant?.scope?.sessionId ?? null,
    mind: this.#mind?.state ?? null, budget: this.budget }; }
  waitForStop() { return this.#state !== 'ready' ? Promise.resolve() : new Promise(resolve => this.#stopWaiters.add(resolve)); }
  #notifyStopped() { for (const resolve of this.#stopWaiters) resolve(); this.#stopWaiters.clear(); }
  #status(phase, result) {
    try { this.#onStatus(Object.freeze({ phase, result })); } catch {}
  }
  // IC03b: presence receipts ('presence', from the runner) and order outcomes ('presence_order', from the driver).
  #forward(event) {
    try { this.#onFeedback(structuredClone(event)); } catch {}
  }
  #isCurrentPairing(generation) { return generation === this.#generation && !this.#closed && this.#state === 'pairing'; }
  #isCurrentSession(generation, runner) { return generation === this.#generation && !this.#closed &&
    ['pairing', 'ready'].includes(this.#state) && this.#runner === runner; }
  #queuePrepare(bootstrap) {
    const preparation = this.#prepareTail.then(() => this.#prepare(bootstrap));
    this.#prepareTail = preparation.catch(() => {});
    return preparation;
  }

  async #prepare(bootstrap) {
    const { scope, record } = bootstrap;
    let budget;
    const dir = this.#directory;
    await mkdir(path.dirname(dir), { recursive: true });
    const existing = await readManifest(path.join(dir, 'paired-runtime.json'));
    // Hosted documents keep the template's loopback fields; the real provider policy lives in the manifests only.
    const draft = validateCompanionDraft({ ...record.preset, modelId: this.#hosted ? DEFAULT_COMPANION_DRAFT.modelId : this.#policy.modelId,
      baseUrl: this.#hosted ? DEFAULT_COMPANION_DRAFT.baseUrl : this.#policy.baseUrl, thinkingMode: this.#policy.thinkingMode });
    const generated = buildCompanionDocuments(draft, scope);
    const saved = record.configuration.config;
    const objectives = JSON.stringify({ v: 1, revision: record.configuration.revision, scope: structuredClone(scope), goals: saved.goals }, null, 2) + '\n';
    const docs = { ...generated, personality: saved.personality, objectives };
    if (existing) {
      if (!exact(existing, ['schema', 'scope', 'creationId', 'configurationRevision', 'personalitySha256', 'objectivesSha256',
        'budgetExpiresAtMs', 'limits', 'policy']) || existing.schema !== 'mn.paired-companion.v1' ||
          JSON.stringify(existing.scope) !== JSON.stringify(scope) || existing.creationId !== record.creationId ||
          existing.configurationRevision !== record.configuration.revision || existing.personalitySha256 !== hash(docs.personality) ||
          existing.objectivesSha256 !== hash(docs.objectives) || JSON.stringify(existing.limits) !== JSON.stringify(this.#limits) ||
          JSON.stringify(existing.policy) !== JSON.stringify(this.#policy)) throw new Error('paired_identity_or_config_changed');
      const loaded = await loadOwnerFiles({ directory: dir, scope });
      if (!loaded.ok || loaded.files.personality.content !== docs.personality || loaded.files.objectives.content !== docs.objectives) throw new Error('paired_documents_changed');
      budget = await LocalResourceBudget.open({ directory: path.join(dir, 'resource-budget'), scope,
        expiresAtMs: existing.budgetExpiresAtMs, ...this.#policy });
    } else {
      if (bootstrap.expiresAtMs > Date.now() + MAX_TOKEN_TTL_MS) throw new Error('pair_expiry_invalid');
      await createCompanionFiles({ directory: dir, draft, scope });
      // New directory only: seed the latest owner-authored SQL configuration, preserving the empty journal.
      await writeFile(path.join(dir, 'personality.md'), docs.personality, { mode: 0o600 });
      await writeFile(path.join(dir, 'objectives.json'), docs.objectives, { mode: 0o600 });
      await writeFile(path.join(dir, 'companion-manifest.json'), JSON.stringify({ schema: 'mn.paired-companion.v1',
        authority: 'public_world_agent_control', scope, creationId: record.creationId,
        provider: { kind: this.#hosted ? 'hosted-openai-compatible' : 'loopback-openai-compatible', ...this.#policy, apiKey: null },
        serverBinding: { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId,
          configurationRevision: record.configuration.revision, controlRevision: record.control.revision },
        requestedCapabilities: ['chat', 'presence'], activated: true }, null, 2) + '\n', { mode: 0o600 });
      const budgetExpiresAtMs = Date.now() + MAX_MINUTES * 60_000;
      await mkdir(path.join(dir, 'resource-budget'));
      budget = await LocalResourceBudget.initialize({ directory: path.join(dir, 'resource-budget'), scope,
        limits: { maxCalls: this.#limits.maxCalls, maxTokens: this.#limits.maxTokens,
          maxCostUnits: this.#limits.maxTokens, maxEntries: 16 }, expiresAtMs: budgetExpiresAtMs, ...this.#policy });
      const manifest = { schema: 'mn.paired-companion.v1', scope, creationId: record.creationId,
        configurationRevision: record.configuration.revision, personalitySha256: hash(docs.personality),
        objectivesSha256: hash(docs.objectives), budgetExpiresAtMs, limits: this.#limits, policy: this.#policy };
      await writeFile(path.join(dir, 'paired-runtime.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    return budget;
  }

  async start(code) {
    if (this.#closed) return fail('paired_companion_closed');
    if (this.#state !== 'stopped' || this.#runner) return fail('session_active');
    if (!/^[a-f0-9]{64}$/.test(code ?? '')) return fail('invalid_pair_code');
    this.#state = 'pairing'; const generation = ++this.#generation;
    let runner = null, mind = null, driver = null;
    const disposeAttempt = () => {
      driver?.close(); mind?.close(); runner?.close();
      if (this.#runner === runner) this.#runner = null;
      if (this.#mind === mind) this.#mind = null;
      if (this.#driver === driver) this.#driver = null;
    };
    try {
      const bootstrap = await this.#claim({ url: this.#url, code });
      if (!this.#isCurrentPairing(generation)) return fail('pair_cancelled');
      const budget = await this.#queuePrepare(bootstrap);
      if (!this.#isCurrentPairing(generation)) return fail('pair_cancelled');
      this.#budget = budget;
      this.#scope = bootstrap.scope; this.#record = bootstrap.record; this.#ownerPeer = bootstrap.ownerPeer;
      // The server answers ['chat','presence'] for a mind attached to a live body and ['chat'] otherwise;
      // WELCOME adopts the intersection, so a flag-off server keeps this runner chat-only.
      const grant = { v: 1, scope: { ...bootstrap.scope, sessionId: randomUUID() }, controlRevision: 1,
        expiresAtMs: bootstrap.expiresAtMs, capabilities: ['chat', 'presence'] };
      runner = this.#runnerFactory({ url: this.#url, grant, name: bootstrap.record.preset.name,
        skin: bootstrap.record.preset.skin, authorization: { token: bootstrap.token }, content: bootstrap.content,
        onFeedback: event => this.#feedback(event, generation) });
      this.#runner = runner;
      const loaded = await loadOwnerFiles({ directory: this.#directory, scope: bootstrap.scope });
      if (!this.#isCurrentPairing(generation)) { disposeAttempt(); return fail('pair_cancelled'); }
      if (!loaded.ok) throw new Error('paired_documents_invalid');
      this.#latestFiles = loaded;
      let sessionFiles = loaded;
      const readSnapshot = async () => {
        const latest = await loadOwnerFiles({ directory: this.#directory, scope: bootstrap.scope });
        if (!latest.ok) throw new Error('paired_documents_invalid');
        if (!this.#isCurrentSession(generation, runner)) throw new Error('pair_session_stopped');
        sessionFiles = latest; this.#latestFiles = latest;
        return this.#snapshot(runner, sessionFiles);
      };
      const adapter = this.#adapterFactory({ ...this.#policy, maxCalls: this.#limits.maxCalls, maxOutputTokens: 512, timeoutMs: 30000 });
      mind = new AgentMind({ adapter, budget: this.#budget, readSnapshot,
        readCommitSnapshot: () => this.#snapshot(runner, sessionFiles), appendMemory: createMemoryStore({ directory: this.#directory, scope: bootstrap.scope }).append,
        submitOrder: () => fail('chat_only'), sendChat: order => runner.sendChat(order),
        conversationPolicy: { channels: ['world', 'local', 'whisper'], maxRepliesPerPeer: 32, maxTurns: 32,
          cooldownMs: 5000, maxMessageAgeTicks: 1800 },
        limits: { timeoutMs: 30000, maxReflectionAgeMs: 30000, maxRequests: 32, maxOutputTokens: 512 },
        contextLimits: { maxMemoryUnits: 8192, maxCandidates: 128, maxSelected: 8 } });
      if (!this.#isCurrentPairing(generation)) { disposeAttempt(); return fail('pair_cancelled'); }
      this.#mind = mind;
      if (!this.#isCurrentPairing(generation)) { disposeAttempt(); return fail('pair_cancelled'); }
      await runner.connect();
      if (!this.#isCurrentPairing(generation) || runner.state !== 'ready') throw new Error('pair_session_stopped');
      // Body mode only when the server adopted the presence capability for this attached mind.
      if (runner.authority?.grant && runner.grant.capabilities.includes('presence')) {
        const sessionId = runner.grant.scope.sessionId;
        driver = this.#driverFactory({ request: (op, options) => runner.presence(op, options),
          onEvent: data => this.#forward({ type: 'presence_order', data, sessionId }) });
        this.#driver = driver;
      }
      this.#state = 'ready';
      // One load populates the body state; every later load precedes an owner-turn order.
      if (driver) void driver.load().catch(() => {});
      return { ok: true, scope: this.scope, sessionId: runner.grant.scope.sessionId, name: bootstrap.record.preset.name,
        expiresAtMs: bootstrap.expiresAtMs, authority: runner.authority?.grant ? 'server_controller' : 'server_admitted',
        capabilities: [...runner.grant.capabilities] };
    } catch {
      disposeAttempt();
      if (this.#isCurrentPairing(generation)) this.#state = 'stopped';
      return fail(generation !== this.#generation || this.#closed ? 'pair_cancelled' : 'pair_start_failed');
    }
  }

  #feedback(event, generation) {
    if (generation !== this.#generation) return;
    if (event.type === 'presence') this.#forward(event);
    if (event.type === 'chat_message') {
      const message = event.data?.message;
      if (message && !event.data.fromHistory && message.sender?.id === this.#ownerPeer &&
          ['world', 'local', 'whisper'].includes(message.channel) && !this.#seen.has(message.id)) {
        this.#seen.add(message.id); if (this.#seen.size > 512) this.#seen.delete(this.#seen.values().next().value);
        this.#queue = this.#queue.then(() => this.#respond(message, generation)).catch(() => {});
      }
    }
    if (event.type === 'stopped') {
      this.#generation++;
      const runner = this.#runner, mind = this.#mind, driver = this.#driver;
      this.#runner = null; this.#mind = null; this.#driver = null;
      driver?.close(); mind?.close(); runner?.close();
      this.#state = 'stopped'; this.#notifyStopped();
    }
    for (const notify of this.#waiters) notify(event);
  }
  async #waitForReply(requestId, generation, timeoutMs = 7000) {
    const present = this.#runner?.chat.messages.some(message => message.requestId === requestId && message.sender.id === this.#runner.chat.self);
    if (present) return true;
    return await new Promise(resolve => {
      let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); this.#waiters.delete(check); resolve(value); };
      const check = event => {
        if (generation !== this.#generation) return finish(false);
        if (event.type === 'chat_message' && event.data?.message?.sender?.id === this.#runner?.chat.self &&
            event.data.message.requestId === requestId) finish(true);
        if (event.type === 'stopped') finish(false);
      };
      const timer = setTimeout(() => finish(false), timeoutMs); this.#waiters.add(check);
    });
  }
  async #waitForObservedMessage(messageId, generation, timeoutMs = 5000) {
    const observed = () => {
      const runner = this.#runner;
      const message = runner?.chat?.messages?.find(item => item.id === messageId);
      const observation = runner?.observation;
      const projected = observation?.chat?.find(item => item.id === messageId);
      if (!message || !projected || !Number.isSafeInteger(observation?.tick) || message.tick > observation.tick) return false;
      const sender = message.sender.id === runner.chat.self ? runner.grant.scope.characterId : `chat:${message.sender.id}`;
      const recipient = message.target ? (message.target.id === runner.chat.self ? runner.grant.scope.characterId : `chat:${message.target.id}`) : null;
      return projected.channel === message.channel && projected.text === message.text && projected.tick === message.tick &&
        projected.sender === sender && projected.recipient === recipient;
    };
    if (observed()) return true;
    return await new Promise(resolve => {
      let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); this.#waiters.delete(check); resolve(value); };
      const check = event => {
        if (generation !== this.#generation || event.type === 'stopped') return finish(false);
        if (event.type === 'observation' && observed()) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs); this.#waiters.add(check);
    });
  }
  async #respond(message, generation) {
    if (this.#state !== 'ready' || generation !== this.#generation) return;
    if (!await this.#waitForObservedMessage(message.id, generation) || generation !== this.#generation) return;
    const result = await this.#mind.converse({ messageId: message.id });
    if (generation !== this.#generation || this.#state !== 'ready') return;
    if (!result?.ok) {
      this.#status('inference', BUDGET_FAILURES.has(result?.why) ? 'budget_exhausted' : 'failed');
      return;
    }
    if (result.body) this.#order(result.body, generation, result.body === 'craft' ? result.recipe : result.node);
    const requestId = result?.action?.request?.order?.actionId ?? result?.action?.order?.actionId;
    const delivered = requestId ? await this.#waitForReply(requestId, generation) : false;
    if (generation !== this.#generation || this.#state !== 'ready') return;
    if (!delivered) { this.#status('delivery', 'unconfirmed'); return; }
    if (generation === this.#generation && this.#state === 'ready') {
      try {
        const remembered = await this.#mind.remember();
        if (!remembered?.ok) this.#status('memory', 'failed');
      } catch { this.#status('memory', 'failed'); }
    }
  }
  // The body order rides on the accepted reply of this owner turn. Not awaited: the driver paces,
  // supersedes and reports it, and the server validates and executes it.
  #order(op, generation, arg) {
    const driver = this.#driver;
    if (!driver || generation !== this.#generation || this.#state !== 'ready' || !PRESENCE_ORDERS.includes(op)) return;
    void driver.order(op, arg).catch(() => {});
  }
  #snapshot(runner = this.#runner, files = this.#latestFiles) {
    if (!runner || !files?.ok) throw new Error('paired_documents_invalid');
    const snapshot = runnerMindSnapshot(runner, files);
    snapshot.taskFence += `:paired-context:${this.#contextRevision}`;
    return snapshot;
  }
  async refreshContext() {
    if (this.#state !== 'ready' || !this.#scope) return fail('not_connected');
    const generation = this.#generation, scope = this.scope;
    this.#contextRevision++; this.#mind?.cancel();
    try {
      const latest = await loadOwnerFiles({ directory: this.#directory, scope });
      if (generation !== this.#generation || this.#state !== 'ready') return fail('not_connected');
      if (!latest.ok) return fail('paired_documents_invalid');
      this.#latestFiles = latest;
      return { ok: true, scope, files: Object.fromEntries(Object.entries(latest.files).map(([key, file]) => [key,
        { bytes: file.bytes, sha256: file.sha256, revision: file.revision ?? null }])) };
    } catch { return fail('paired_documents_invalid'); }
  }
  async remember() { return this.#state === 'ready' ? this.#mind.remember() : fail('not_connected'); }
  async compactMemory(sourceIds) { return this.#state === 'ready' ? this.#mind.compactMemory({ sourceIds }) : fail('not_connected'); }
  stop() {
    if (this.#state === 'stopped') return { ok: true, state: 'stopped' };
    ++this.#generation; this.#driver?.close(); this.#mind?.close(); this.#state = 'stopping';
    const runner = this.#runner;
    if (runner) { runner.stop(this.#scope.ownerId); runner.close(); }
    this.#runner = null; this.#mind = null; this.#driver = null; this.#state = 'stopped'; this.#notifyStopped();
    return { ok: true, state: 'stopped' };
  }
  close() { this.#closed = true; return this.stop(); }
}


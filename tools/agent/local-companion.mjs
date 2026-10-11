import { mkdir, writeFile, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import WebSocket from 'ws';
import { createGameServer } from '../../server/index.mjs';
import { createMemoryStore as createGameStore } from '../../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { validateCompanionDraft } from '../../src/net/companionTemplates.js';
import { createCompanionFiles } from './create-companion.mjs';
import { AgentNetworkRunner } from './network-runner.mjs';
import { AgentMind } from './mind.mjs';
import { runnerMindSnapshot } from './mind-snapshot.mjs';
import { loadOwnerFiles } from './owner-files.mjs';
import { createMemoryStore } from './memory-store.mjs';
import { LocalResourceBudget } from './local-resource-budget.mjs';
import { createLocalOpenAIMind } from './local-openai-mind.mjs';
import { LOCAL_CONTEXT_LIMITS, SUMMARY_IDLE_MS, continuationCue, measuredContinuityContext,
  automaticSummaryRemaining, automaticSummarySources, summaryCandidates, sameCapture, journalUsage } from './companion-continuity.mjs';

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
async function until(check, why, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = check(); if (value) return value; await sleep(15); }
  throw new Error(why);
}
async function readLocalFile(directory, filename, max = 32768) {
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const root = await lstat(directory), path = join(directory, filename);
  if (!root.isDirectory() || root.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('local_document_invalid');
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > max) throw new Error('local_document_invalid');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!same(before, opened)) throw new Error('local_document_changed');
    const buffer = Buffer.alloc(max + 1); let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break; total += bytesRead;
    }
    const after = await lstat(path), rootAfter = await lstat(directory);
    if (total > max || !after.isFile() || after.isSymbolicLink() || !same(opened, after) ||
        !same(root, rootAfter) || rootAfter.isSymbolicLink() || await realpath(path) !== path ||
        await realpath(directory) !== directory) throw new Error('local_document_changed');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
  } finally { await handle.close(); }
}
const hash = text => createHash('sha256').update(text).digest('hex');
const failure = why => ({ ok: false, why });

// A real local GameHost and C01 sockets; its account resolver is explicitly a local fixture.
// This never starts another authority for the public world or sends a public account token.
export class LocalCompanion {
  #directory; #draft; #scope; #budget; #adapterFactory; #server = null; #owner = null;
  #runner = null; #mind = null; #adapter = null; #files = null; #messages = [];
  #transcript = []; #state = 'stopped'; #busy = false; #generation = 0; #url = null;
  #agentToken = randomBytes(32).toString('hex'); #ownerToken = randomBytes(32).toString('hex');
  #closed = false; #startFlight = null; #sessions = 0; #ownerPeer = null;
  #contextRevision = 0; #autoCompact = false; #summaryTimer = null; #summaryRevision = 0;
  #summaryBlocked = false; #automaticSummaryActive = false;
  #lastRefresh = { atMs: Date.now(), reason: 'process_open', revision: 0 };
  #lastCapture = null; #lastSummary = null; #contextReport = null;

  static async create({ directory, draft, limits, adapterFactory = createLocalOpenAIMind }) {
    const checked = validateCompanionDraft(draft);
    if (!limits || Object.keys(limits).length !== 2 || !Number.isInteger(limits.maxCalls) || limits.maxCalls < 1 || limits.maxCalls > 8 ||
      !Number.isSafeInteger(limits.maxTokens) || limits.maxTokens < 32768 || limits.maxTokens > 1000000) throw new TypeError('invalid_local_limits');
    const scope = { ownerId: randomUUID(), characterId: randomUUID(), worldId: `companion-local-${randomUUID().slice(0, 8)}` };
    const root = resolve(directory);
    await createCompanionFiles({ directory: root, draft: checked, scope });
    const expiresAtMs = Date.now() + 2 * 60 * 60 * 1000;
    await mkdir(join(root, 'resource-budget'));
    const budget = await LocalResourceBudget.initialize({ directory: join(root, 'resource-budget'), scope,
      limits: { ...limits, maxCostUnits: limits.maxTokens, maxEntries: 16 }, expiresAtMs,
      baseUrl: checked.baseUrl, modelId: checked.modelId, thinkingMode: checked.thinkingMode });
    await writeFile(join(root, 'local-runtime.json'), JSON.stringify({ schema: 'mn.local-companion-runtime.v1', scope, expiresAtMs }, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    return new LocalCompanion({ directory: root, draft: checked, scope, budget, adapterFactory });
  }
  static async open({ directory, adapterFactory = createLocalOpenAIMind }) {
    const root = resolve(directory), manifest = JSON.parse(await readLocalFile(root, 'companion-manifest.json'));
    const runtime = JSON.parse(await readLocalFile(root, 'local-runtime.json'));
    const draft = validateCompanionDraft(manifest.draft), scope = runtime.scope;
    if (manifest.schema !== 'mn.local-companion.v1' || runtime.schema !== 'mn.local-companion-runtime.v1' ||
        JSON.stringify(scope) !== JSON.stringify(manifest.scope) || Object.keys(scope ?? {}).length !== 3 ||
        !['ownerId', 'characterId', 'worldId'].every(k => typeof scope[k] === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(scope[k]))) {
      throw new Error('local_companion_scope_mismatch');
    }
    await loadOwnerFiles({ directory: root, scope });
    const budget = await LocalResourceBudget.open({ directory: join(root, 'resource-budget'), scope,
      expiresAtMs: runtime.expiresAtMs, baseUrl: draft.baseUrl, modelId: draft.modelId, thinkingMode: draft.thinkingMode });
    return new LocalCompanion({ directory: root, draft, scope, budget, adapterFactory });
  }
  constructor({ directory, draft, scope, budget, adapterFactory }) {
    this.#directory = directory; this.#draft = draft; this.#scope = scope;
    this.#budget = budget; this.#adapterFactory = adapterFactory;
  }
  get scope() { return structuredClone(this.#scope); }
  get draft() { return structuredClone(this.#draft); }
  get directory() { return this.#directory; }
  get diagnostics() { return { mind: this.#mind?.state ?? null, transport: this.#adapter?.records ?? [],
    sessions: this.#sessions, runnerSessionId: this.#runner?.grant.scope.sessionId ?? null,
    actions: this.#runner?.actions ?? [], budget: this.#budget.snapshot }; }

  async #ensureWorld() {
    if (this.#server) return;
    this.#server = createGameServer({ port: 0, host: '127.0.0.1', seed: 19, bots: 0, maxPlayers: 4,
      dev: false, worldId: this.#scope.worldId, saveSecret: randomBytes(32).toString('hex'), store: createGameStore(),
      log() {}, inferenceCatalog: [], chat: { localRadius: 200, burst: 20, refillPerSecond: 10 },
      resolvePlayer: async (_request, message) => message.token === this.#ownerToken ? this.#scope.ownerId :
        message.token === this.#agentToken ? this.#scope.characterId : null,
      agentControl: { worldId: this.#scope.worldId, ttlMs: 3600000, bindings: [
        { ownerId: this.#scope.ownerId, characterId: this.#scope.characterId, capabilities: ['chat'] },
      ] },
    });
    const port = await this.#server.listen(); this.#url = `ws://127.0.0.1:${port}/ws`;
    this.#owner = new WebSocket(this.#url);
    this.#owner.on('message', data => {
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.t === MSG.CHAT_STATE) this.#ownerPeer = message.self;
      this.#messages.push(message); if (this.#messages.length > 128) this.#messages.shift();
      if (message.t === MSG.CHAT_MESSAGE) {
        this.#transcript.push({ id: message.id, sender: message.sender.id === this.#ownerIdentity() ? 'owner' : 'companion',
          text: message.text, tick: message.tick, sessionId: this.#runner?.grant.scope.sessionId ?? null, delivered: true });
        if (this.#transcript.length > 64) this.#transcript.shift();
      }
    });
    this.#owner.on('error', () => {});
    await until(() => this.#owner.readyState === WebSocket.OPEN, 'local_owner_connection_failed');
    this.#owner.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: this.#ownerToken, name: 'Dueño local', skin: 0, weapon: 0 }));
    const welcome = await until(() => this.#messages.find(m => m.t === MSG.WELCOME || m.t === MSG.ERROR), 'local_owner_admission_failed');
    if (welcome.t !== MSG.WELCOME) throw new Error('local_owner_admission_failed');
    await until(() => this.#messages.some(m => m.t === MSG.CHAT_STATE), 'local_chat_unavailable');
  }
  #ownerIdentity() { return this.#ownerPeer; }
  #snapshot() {
    const snapshot = runnerMindSnapshot(this.#runner, this.#files);
    snapshot.required.tools.continuity = continuationCue(snapshot.memoryJournal, Date.now());
    snapshot.taskFence += `:context:${this.#contextRevision}`;
    return snapshot;
  }
  async #readSnapshot() {
    this.#files = await loadOwnerFiles({ directory: this.#directory, scope: this.#scope });
    return this.#snapshot();
  }
  #cancelSummaryTimer() { clearTimeout(this.#summaryTimer); this.#summaryTimer = null; ++this.#summaryRevision; }
  async start() {
    if (this.#closed) return failure('local_companion_closed');
    if (this.#startFlight || this.#state === 'ready') return failure('session_active');
    if (this.#busy) return failure('inference_busy');
    if (this.#sessions >= 8) return failure('session_capacity');
    const generation = ++this.#generation; this.#state = 'starting';
    const start = (async () => {
      try {
        await this.#ensureWorld();
        if (generation !== this.#generation || this.#closed) return failure('start_cancelled');
        const grant = { v: 1, scope: { ...this.#scope, sessionId: randomUUID() }, controlRevision: 1,
          expiresAtMs: Date.now() + 3600000, capabilities: ['chat'] };
        this.#runner = new AgentNetworkRunner({ url: this.#url, grant, name: this.#draft.name,
          skin: this.#draft.skin, authorization: { token: this.#agentToken },
          onFeedback: event => { if (event.type === 'stopped') { this.#cancelSummaryTimer(); this.#mind?.cancel(); this.#state = 'stopped'; } } });
        await this.#runner.connect();
        if (generation !== this.#generation || this.#closed) { this.#runner.close(); return failure('start_cancelled'); }
        this.#sessions++;
        this.#files = await loadOwnerFiles({ directory: this.#directory, scope: this.#scope });
        this.#adapter = this.#adapterFactory({ baseUrl: this.#draft.baseUrl, modelId: this.#draft.modelId,
          thinkingMode: this.#draft.thinkingMode, maxCalls: 8, maxOutputTokens: 512, timeoutMs: 30000 });
        this.#mind = new AgentMind({ adapter: this.#adapter, budget: this.#budget,
          readSnapshot: () => this.#readSnapshot(),
          readCommitSnapshot: () => this.#snapshot(),
          appendMemory: createMemoryStore({ directory: this.#directory, scope: this.#scope }).append,
          submitOrder: () => failure('local_body_disabled'), sendChat: order => this.#runner.sendChat(order),
          conversationPolicy: { channels: ['world', 'local', 'whisper'], maxRepliesPerPeer: 8, maxTurns: 8,
            cooldownMs: 0, maxMessageAgeTicks: 1800 },
          limits: { timeoutMs: 30000, maxReflectionAgeMs: 30000, ...LOCAL_CONTEXT_LIMITS, maxRequests: 32 },
          contextLimits: { maxMemoryUnits: 8192, maxCandidates: 128, maxSelected: 8 },
        });
        this.#lastRefresh = { atMs: Date.now(), reason: 'session_start', revision: this.#contextRevision };
        this.#state = 'ready'; return { ok: true, sessionId: this.#runner.grant.scope.sessionId };
      } catch { this.#state = 'error'; this.#runner?.close(); return failure('local_start_failed'); }
    })();
    this.#startFlight = start;
    try { return await start; } finally { this.#startFlight = null; }
  }
  async stop() {
    this.#cancelSummaryTimer();
    ++this.#generation; this.#mind?.close(); this.#state = 'stopped';
    const runner = this.#runner;
    runner?.stop(this.#scope.ownerId);
    if (runner) {
      await until(() => runner.state === 'stopped', 'local_stop_pending').catch(() => {});
      runner.close();
      // Wait for the old managed socket/profile to retire before an explicit new admission.
      await until(() => !this.#server.game.profiles.accounts.has(this.#scope.characterId), 'profile_retirement_pending').catch(() => {});
    }
    return { ok: true, state: 'stopped', sessionRetired: runner?.state === 'stopped' };
  }
  async reenter() { if (this.#busy) return failure('inference_busy'); await this.stop(); return this.start(); }
  async chat(text) {
    if (this.#state !== 'ready' || this.#runner?.state !== 'ready') return failure('not_connected');
    if (this.#busy) return failure('inference_busy');
    if (typeof text !== 'string' || text.normalize('NFC') !== text || text.trim() !== text ||
      !text || [...text].length > 280 || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return failure('invalid_message');
    this.#cancelSummaryTimer();
    const generation = this.#generation, contextRevision = this.#contextRevision;
    this.#busy = true;
    let completed = false;
    try {
      const id = `owner_${randomUUID()}`;
      this.#owner.send(JSON.stringify({ t: MSG.CHAT_SEND, id, channel: 'world', text }));
      const source = await until(() => this.#runner?.observation?.chat.find(m => m.id && m.text === text &&
        this.#messages.some(raw => raw.t === MSG.CHAT_MESSAGE && raw.requestId === id && raw.id === m.id)), 'message_delivery_unknown');
      const result = await this.#mind.converse({ messageId: source.id });
      this.#contextReport = measuredContinuityContext(result.report);
      if (!result.ok) return result;
      if (!result.action) {
        const memory = await this.#capture('delivered_message', generation, contextRevision);
        completed = true; return { ...result, memory };
      }
      const delivered = await until(() => this.#messages.find(m => m.t === MSG.CHAT_MESSAGE &&
        m.requestId === result.action.request.order.actionId), 'reply_delivery_unknown');
      // Both sockets must observe the same delivered reply before capturing it.
      await until(() => this.#runner?.chat.messages.some(message => message.id === delivered.id), 'reply_observation_unknown');
      const memory = await this.#capture('delivered_exchange', generation, contextRevision);
      completed = true;
      return { ok: true, reply: delivered.text, messageId: delivered.id, sessionId: this.#runner.grant.scope.sessionId,
        memory,
        inference: { requestId: result.requestId, latencyMs: result.finishedAtMs - result.startedAtMs,
          memoryRetrieval: result.report?.memoryRetrieval ?? null } };
    } catch { return failure('chat_outcome_unresolved'); }
    finally { this.#busy = false; if (completed) this.#scheduleSummary(); }
  }
  async #capture(reason, generation = this.#generation, contextRevision = this.#contextRevision) {
    if (generation !== this.#generation || contextRevision !== this.#contextRevision || this.#state !== 'ready')
      return failure('capture_superseded');
    let result;
    try {
      const snapshot = await this.#readSnapshot();
      if (generation !== this.#generation || contextRevision !== this.#contextRevision || this.#state !== 'ready')
        return failure('capture_superseded');
      const previous = sameCapture(snapshot.memoryJournal, snapshot);
      result = previous ? { ok: true, memory: { replay: true, entryId: previous.id, revision: snapshot.memoryJournal.revision } }
        : await this.#mind.remember();
    } catch { result = failure('memory_capture_failed'); }
    this.#lastCapture = { ok: result.ok, ...(result.why ? { why: result.why } : {}),
      entryId: result.memory?.entryId ?? null, replay: result.memory?.replay === true, atMs: Date.now(), reason };
    // A rejected/unknown capture must not turn already delivered chat into a failure or a retry.
    return structuredClone(this.#lastCapture);
  }
  async remember() {
    if (this.#state !== 'ready') return failure('not_connected');
    if (this.#busy) return failure('inference_busy');
    this.#cancelSummaryTimer();
    this.#busy = true;
    try { const result = await this.#capture('manual_capture'); return { ...result, memory: { entryId: result.entryId, replay: result.replay } }; }
    finally { this.#busy = false; }
  }
  async compactMemory(sourceIds, reason = 'manual_summary') {
    if (this.#state !== 'ready' || this.#busy) return failure('not_ready');
    this.#cancelSummaryTimer();
    this.#busy = true;
    try {
      let result = await this.#mind.compactMemory({ sourceIds });
      if (result.ok && !result.memory?.entryId) result = { ...result, ok: false, why: 'memory_summary_declined' };
      this.#lastSummary = { ok: result.ok, ...(result.why ? { why: result.why } : {}),
        atMs: Date.now(), reason, sourceIds: Array.isArray(sourceIds) ? sourceIds.slice(0, 8) : [],
        entryId: result.memory?.entryId ?? null };
      return result;
    } finally { this.#busy = false; }
  }
  setContinuity(options) {
    if (!options || Object.keys(options).length !== 1 || typeof options.autoCompact !== 'boolean') return failure('invalid_continuity_policy');
    this.#autoCompact = options.autoCompact;
    // Disabling also cancels an active automatic summary, without clearing its usage hold.
    if (!options.autoCompact) {
      this.#cancelSummaryTimer();
      if (this.#automaticSummaryActive) this.#mind?.cancel();
    }
    return { ok: true, autoCompact: this.#autoCompact };
  }
  async refreshContext() {
    if (this.#closed) return failure('local_companion_closed');
    this.#cancelSummaryTimer();
    ++this.#contextRevision; this.#mind?.cancel();
    try { this.#files = await loadOwnerFiles({ directory: this.#directory, scope: this.#scope }); }
    catch { return failure('context_reload_failed'); }
    this.#contextReport = null;
    this.#lastRefresh = { atMs: Date.now(), reason: 'manual_refresh', revision: this.#contextRevision };
    return { ok: true, ...this.#lastRefresh, sessionId: this.#runner?.grant.scope.sessionId ?? null,
      state: this.#state, budgetReset: false, ordersResumed: false };
  }
  #scheduleSummary() {
    const budget = this.#budget.snapshot;
    if (!this.#autoCompact || this.#summaryBlocked || this.#summaryTimer || this.#state !== 'ready' || this.#busy ||
        !this.#contextReport?.pressure || budget.persistence.admissionWhy || !automaticSummaryRemaining(budget)) return;
    const revision = this.#summaryRevision;
    this.#summaryTimer = setTimeout(() => {
      this.#summaryTimer = null;
      void this.#automaticSummary(revision).catch(() => { this.#summaryBlocked = true; });
    }, SUMMARY_IDLE_MS);
    this.#summaryTimer.unref?.();
  }
  async #automaticSummary(revision) {
    const budget = this.#budget.snapshot, generation = this.#generation, contextRevision = this.#contextRevision;
    if (revision !== this.#summaryRevision || !this.#autoCompact || this.#summaryBlocked || this.#busy || this.#state !== 'ready' ||
        !this.#contextReport?.pressure || budget.persistence.admissionWhy || !automaticSummaryRemaining(budget)) return;
    const snapshot = await this.#readSnapshot();
    const sourceIds = automaticSummarySources(snapshot, Date.now());
    if (revision !== this.#summaryRevision || generation !== this.#generation || contextRevision !== this.#contextRevision || !this.#autoCompact ||
        this.#busy || this.#state !== 'ready' || sourceIds.length < 2) return;
    // One background attempt per process too: even a pre-dispatch rejection cannot loop.
    this.#summaryBlocked = true;
    this.#automaticSummaryActive = true;
    try { await this.compactMemory(sourceIds, 'context_pressure'); }
    finally { this.#automaticSummaryActive = false; }
  }
  async view() {
    const loaded = await loadOwnerFiles({ directory: this.#directory, scope: this.#scope });
    const files = Object.fromEntries(Object.entries(loaded.files).map(([key, entry]) => [key,
      { filename: key === 'personality' ? 'personality.md' : key === 'objectives' ? 'objectives.json' : 'memory.jsonl',
        content: entry.content, sha256: entry.sha256, revision: entry.revision ?? null }]));
    const guide = await readLocalFile(this.#directory, 'gameplay-guide.md');
    files.guide = { filename: 'gameplay-guide.md', content: guide, sha256: hash(guide) };
    const journal = loaded.files.memory.journal;
    const latestEpisode = journal.entries.findLast(entry => entry.kind === 'episode');
    const latestSummary = journal.entries.findLast(entry => entry.kind === 'summary');
    const lastCapture = this.#lastCapture ?? (latestEpisode ? { ok: true, entryId: latestEpisode.id,
      atMs: latestEpisode.createdAtMs, reason: 'loaded_from_files' } : null);
    const lastSummary = this.#lastSummary ?? (latestSummary ? { ok: true, entryId: latestSummary.id,
      atMs: latestSummary.createdAtMs, reason: 'loaded_from_files', sourceIds: latestSummary.payload.sources.map(source => source.id) } : null);
    return { ok: true, created: true, draft: this.draft, scope: this.scope, files,
      models: [this.#draft.modelId], transcript: structuredClone(this.#transcript),
      status: { state: this.#state, connected: this.#state === 'ready' && this.#runner?.state === 'ready',
        name: this.#draft.name, inFlight: this.#busy, sessionId: this.#runner?.grant.scope.sessionId ?? null,
        worldUrl: this.#url?.replace('ws:', 'http:').replace('/ws', '/') ?? null, public: false,
        accountAuthentication: 'local_fixture', worldPersistence: 'ephemeral', memoryPersistence: 'local_files' },
      continuity: { autoCapture: true, autoCompact: this.#autoCompact,
        context: structuredClone(this.#contextReport), lastRefresh: structuredClone(this.#lastRefresh),
        lastCapture: structuredClone(lastCapture), lastSummary: structuredClone(lastSummary),
        summaryScheduled: this.#summaryTimer !== null, journal: journalUsage(loaded),
        sources: summaryCandidates(loaded.files.memory.journal, Date.now()), automaticSummaryLimit: 1,
        automaticSummaryRemaining: this.#summaryBlocked ? 0 : automaticSummaryRemaining(this.#budget.snapshot) },
      budget: { ...this.#budget.snapshot, unit: 'local_compute_tokens', costNanoUsd: null } };
  }
  async close() {
    this.#closed = true; await this.stop();
    await this.#startFlight?.catch(() => {});
    if (this.#owner?.readyState < WebSocket.CLOSING) this.#owner.close();
    await this.#server?.close();
  }
}

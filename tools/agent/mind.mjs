import { randomUUID } from 'node:crypto';
import { validGrant, validObservation, validateOrder, sameScope, canonicalJson, LAB_LIMITS, integer } from './contract.mjs';
import { InferenceBudget } from './inference-budget.mjs';
import { buildMindContext } from './mind-context.mjs';
import { mindLimits, validateAdapter, parseDecision, validReplyText, exact, plain, copy } from './mind-contract.mjs';
import { ConversationPolicy } from './conversation.mjs';
import { buildGoalTurn, validateGoalProposal } from './goals.mjs';
import { createMemoryEpisode, buildMemoryTurn, createMemorySummary } from './memory-journal.mjs';
import { refreshMemoryRetrieval } from './mind-snapshot.mjs';

const clock = () => Math.floor(performance.timeOrigin + performance.now());
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

// Inference is an async proposal producer. It never owns a tick, socket or gameplay grant.
export class AgentMind {
  #adapter; #budget; #read; #submit; #now; #limits; #contextLimits; #flight = null; #closed = false;
  #requests = 0; #records = []; #sendChat; #conversation; #chatUncertain = false; #commitGoals; #readCommit; #goalsUncertain = false; #appendMemory; #memoryUncertain = false;
  constructor({ adapter, budget, readSnapshot, submitOrder, sendChat = null, conversationPolicy = {}, commitGoals = null, appendMemory = null, readCommitSnapshot = null, now = clock, limits = {}, contextLimits = {} }) {
    this.#adapter = validateAdapter(adapter); this.#limits = mindLimits(limits);
    if (!(budget instanceof InferenceBudget) || typeof readSnapshot !== 'function' || typeof submitOrder !== 'function' || typeof now !== 'function')
      throw new TypeError('invalid mind configuration');
    if (sendChat !== null && typeof sendChat !== 'function') throw new TypeError('invalid chat submission');
    if (commitGoals !== null && (typeof commitGoals !== 'function' || typeof readCommitSnapshot !== 'function')) throw new TypeError('invalid goal commit configuration');
    if (appendMemory !== null && (typeof appendMemory !== 'function' || typeof readCommitSnapshot !== 'function')) throw new TypeError('invalid memory commit configuration');
    this.#appendMemory = appendMemory;
    this.#commitGoals = commitGoals; this.#readCommit = readCommitSnapshot;
    this.#budget = budget; this.#read = readSnapshot; this.#submit = submitOrder; this.#now = now; this.#contextLimits = copy(contextLimits);
    this.#sendChat = sendChat; this.#conversation = new ConversationPolicy({ policy: conversationPolicy });
  }
  get state() { return copy({ closed: this.#closed, inFlight: !!this.#flight, model: this.#adapter.id,
    requests: this.#requests, records: this.#records, ledger: this.#budget.snapshot,
    conversation: { ...this.#conversation.state, submissionUncertain: this.#chatUncertain },
    goals: { enabled: !!this.#commitGoals, submissionUncertain: this.#goalsUncertain },
    memory: { enabled: !!this.#appendMemory, submissionUncertain: this.#memoryUncertain } }); }
  decide() { return this.#start('decision'); }
  remember() {
    if (!this.#appendMemory) return Promise.resolve({ ok: false, why: 'memory_disabled' });
    if (this.#memoryUncertain) return Promise.resolve({ ok: false, why: 'memory_commit_uncertain' });
    return this.#start('remember');
  }
  compactMemory(options) {
    if (!exact(options, ['sourceIds']) || !Array.isArray(options.sourceIds) || options.sourceIds.length < 1 || options.sourceIds.length > 8 ||
        !options.sourceIds.every((id) => typeof id === 'string' && id.length <= 160)) return Promise.resolve({ ok: false, why: 'invalid_memory_sources' });
    if (!this.#appendMemory) return Promise.resolve({ ok: false, why: 'memory_disabled' });
    if (this.#memoryUncertain) return Promise.resolve({ ok: false, why: 'memory_commit_uncertain' });
    return this.#start('compaction', copy(options.sourceIds));
  }
  reviseGoals() {
    if (!this.#commitGoals) return Promise.resolve({ ok: false, why: 'goals_disabled' });
    if (this.#goalsUncertain) return Promise.resolve({ ok: false, why: 'objective_commit_uncertain' });
    return this.#start('goals');
  }
  converse(options) {
    if (!exact(options, ['messageId']) || typeof options.messageId !== 'string') return Promise.resolve({ ok: false, why: 'invalid_conversation' });
    if (!this.#sendChat) return Promise.resolve({ ok: false, why: 'conversation_disabled' });
    if (this.#chatUncertain) return Promise.resolve({ ok: false, why: 'chat_submission_uncertain' });
    return this.#start('conversation', options.messageId);
  }
  #start(mode, messageId = null) {
    if (this.#closed) return Promise.resolve({ ok: false, why: 'mind_closed' });
    if (this.#flight) return Promise.resolve({ ok: false, why: 'inference_busy' });
    if (this.#requests >= this.#limits.maxRequests) return Promise.resolve({ ok: false, why: 'request_capacity' });
    const startedAtMs = this.#now();
    if (!integer(startedAtMs)) return Promise.resolve({ ok: false, why: 'invalid_clock' });
    this.#requests++;
    const flight = { requestId: `mind:${randomUUID()}`, startedAtMs, cancelled: false, completed: false,
      controller: new AbortController(), dispatched: false, report: null, timer: null, resolve: null, mode, messageId, turn: null, providerContext: null };
    const result = new Promise((resolve) => { flight.resolve = resolve; });
    this.#flight = flight;
    flight.timer = setTimeout(() => this.#interrupt(flight, 'inference_timeout'), this.#limits.timeoutMs);
    // Keep the slot occupied even if an adapter ignores abort. No overlapping paid calls.
    void this.#work(flight).catch(() => {
      if (flight.dispatched) this.#budget.markUnknown(flight.requestId, 'inference_error');
      this.#finish(flight, { ok: false, why: 'inference_error' });
    }).finally(() => { clearTimeout(flight.timer); if (this.#flight === flight) this.#flight = null; });
    return result;
  }
  #finish(flight, result) {
    if (flight.completed) return;
    flight.completed = true; clearTimeout(flight.timer);
    const record = { ...result, mode: flight.mode, messageId: flight.messageId, requestId: flight.requestId, report: flight.report,
      ...(flight.mode !== 'decision' ? { providerContext: flight.providerContext } : {}), startedAtMs: flight.startedAtMs,
      finishedAtMs: this.#now(), dispatched: flight.dispatched };
    if (!flight.cancelled && this.#flight === flight) this.#flight = null;
    this.#records.push(copy(record)); flight.resolve(copy(record));
  }
  #interrupt(flight, why) {
    if (flight.completed) return;
    flight.cancelled = true;
    if (flight.dispatched) this.#budget.markUnknown(flight.requestId, why);
    if (flight.goalCommitStarted) this.#goalsUncertain = true;
    if (flight.memoryCommitStarted) this.#memoryUncertain = true;
    flight.controller.abort(); this.#finish(flight, { ok: false, why,
      ...(flight.goalCommitStarted ? { objective: { state: 'uncertain', retryAllowed: false } } : {}),
      ...(flight.memoryCommitStarted ? { memory: { state: 'uncertain', retryAllowed: false } } : {}) });
  }
  cancel() {
    if (this.#flight && !this.#flight.completed) this.#interrupt(this.#flight, 'inference_cancelled');
    return { ok: true, inFlight: !!this.#flight };
  }
  close() { this.#closed = true; this.cancel(); }
  #snapshotWhy(snapshot, nowMs) {
    const grant = snapshot?.grant, observation = snapshot?.observation;
    if (snapshot?.state !== 'ready' || !validGrant(grant) || !validObservation(observation, LAB_LIMITS, 'server')) return 'not_ready';
    if (!sameScope(grant.scope, observation.scope) || observation.controlRevision !== grant.controlRevision) return 'control_mismatch';
    if (['ownerId', 'characterId', 'worldId'].some((key) => snapshot.scope?.[key] !== grant.scope[key] ||
        snapshot.scope?.[key] !== this.#budget.snapshot.scope[key])) return 'scope_mismatch';
    if (!integer(nowMs) || nowMs >= grant.expiresAtMs) return 'authorization_expired';
    if (observation.confirmed.self.dead) return 'dead';
    if (observation.receivedAtMs > nowMs || nowMs - observation.receivedAtMs > this.#limits.maxDecisionAgeMs) return 'stale_observation';
    if (snapshot.authority && (snapshot.authority.state !== 'active' || snapshot.authority.task?.priority === 'direct')) return 'owner_priority';
    if (!same(snapshot.required?.observation, observation) || typeof snapshot.taskFence !== 'string' || !snapshot.ownerFileHashes) return 'invalid_snapshot';
    return null;
  }
  #deadline(flight) {
    const nowMs = this.#now();
    if (!integer(nowMs) || nowMs < flight.startedAtMs || nowMs - flight.startedAtMs >= this.#limits.timeoutMs)
      this.#interrupt(flight, 'inference_timeout');
    return flight.cancelled;
  }
  #fenceWhy(before, current, nowMs) {
    const invalid = this.#snapshotWhy(current, nowMs);
    if (invalid) return invalid;
    if (!sameScope(before.grant.scope, current.grant.scope) || before.grant.controlRevision !== current.grant.controlRevision ||
        !same(before.grant.capabilities, current.grant.capabilities)) return 'control_mismatch';
    if (before.taskFence !== current.taskFence) return 'task_changed';
    if (!same(before.ownerFileHashes, current.ownerFileHashes)) return 'owner_files_changed';
    if (nowMs - before.observation.receivedAtMs > this.#limits.maxDecisionAgeMs) return 'stale_decision';
    return null;
  }
  async #work(flight) {
    const snapshot = copy(await this.#read());
    if (this.#deadline(flight)) return;
    const invalid = this.#snapshotWhy(snapshot, this.#now());
    if (invalid) { this.#finish(flight, { ok: false, why: invalid }); return; }
    for (const record of this.#records.filter((r) => ['order_submission_uncertain', 'chat_submission_uncertain', 'objective_commit_uncertain', 'memory_commit_uncertain'].includes(r.why) || r.objective?.state === 'uncertain' || r.memory?.state === 'uncertain')) {
      const actionId = record.action?.actionId ?? record.requestId;
      if (!snapshot.required.pending.some((a) => a.actionId === actionId)) snapshot.required.pending.push({ actionId,
        state: 'uncertain', kind: record.mode === 'conversation' ? 'chat_submission' : record.mode === 'goals' ? 'objective_commit' : ['remember', 'compaction'].includes(record.mode) ? 'memory_commit' : 'mind_submission', effects: 'unknown', retryAllowed: false });
    }
    if (flight.mode === 'remember') {
      if (!snapshot.memoryJournal) { this.#finish(flight, { ok: false, why: 'invalid_memory_snapshot' }); return; }
      let entry;
      try { entry = createMemoryEpisode(snapshot); } catch (error) { this.#finish(flight, { ok: false, why: error.message === 'memory_pending_capacity' ? error.message : 'invalid_memory_episode' }); return; }
      flight.report = { capture: 'bounded_server_delivered_episode', providerCalls: 0, costUnits: 0, ownerFileHashes: copy(snapshot.ownerFileHashes) };
      if (snapshot.memoryJournal.entries.some((e) => e.id === entry.id)) { this.#finish(flight, { ok: true, memory: { replay: true, entryId: entry.id, revision: snapshot.memoryJournal.revision } }); return; }
      await this.#commitMemory(flight, snapshot, entry); return;
    }
    if (flight.mode === 'conversation') {
      const admitted = this.#conversation.begin(snapshot, flight.messageId, this.#now());
      if (!admitted.ok) { this.#finish(flight, { ok: false, why: admitted.why }); return; }
      flight.turn = admitted.turn;
      // Protect the selected message, route and policy even if optional chat is pruned.
      snapshot.required.tools = { ...(plain(snapshot.required.tools) ? snapshot.required.tools : { body: snapshot.required.tools }),
        conversation: { ...copy(flight.turn), policy: this.#conversation.state.policy,
          transmission: 'provider receives this delivered message plus the measured selected context; chat is not an authorized gameplay order' } };
    }
    if (flight.mode === 'goals') {
      const built = buildGoalTurn(snapshot);
      if (!built.ok) { this.#finish(flight, { ok: false, why: built.why }); return; }
      flight.turn = built.turn;
      snapshot.required.tools = { ...(plain(snapshot.required.tools) ? snapshot.required.tools : { body: snapshot.required.tools }),
        goalRevision: copy(flight.turn) };
    }
    if (flight.mode === 'compaction') {
      const built = buildMemoryTurn(snapshot, flight.messageId, this.#now());
      if (!built.ok) { this.#finish(flight, { ok: false, why: built.why }); return; }
      flight.turn = built.turn;
      snapshot.required.tools = { ...(plain(snapshot.required.tools) ? snapshot.required.tools : { body: snapshot.required.tools }), memoryCompaction: copy(flight.turn) };
      // Sources are pinned once in the mandatory block, never repeated as optional retrieval.
      snapshot.memory = [];
    }
    if (flight.mode !== 'compaction' && snapshot.memoryJournal) refreshMemoryRetrieval(snapshot,
      [flight.turn?.source?.text ?? '', snapshot.memoryQueryText ?? '', ...(snapshot.goalFeedback ?? []).map((f) => `${f.type} ${f.state}`)].join(' ').slice(0, 8000), this.#now());
    const context = buildMindContext({ snapshot, adapter: this.#adapter, requestId: flight.requestId,
      limits: this.#limits, contextLimits: this.#contextLimits, nowMs: this.#now(), mode: flight.mode });
    flight.report = context.report ?? null;
    if (!context.ok) { this.#finish(flight, { ok: false, why: context.why }); return; }
    if (flight.mode !== 'decision') flight.providerContext = copy(context.document);
    if (this.#deadline(flight)) return;
    const expired = this.#snapshotWhy(snapshot, this.#now());
    if (expired) { this.#finish(flight, { ok: false, why: expired }); return; }
    const reserved = this.#budget.reserve({ requestId: flight.requestId, kind: flight.mode === 'compaction' ? 'compaction' : 'decision', inputTokens: context.prepared.inputTokens,
      outputTokens: this.#limits.maxOutputTokens, maxCostUnits: context.prepared.maxCostUnits, countMode: this.#adapter.countMode });
    if (!reserved.ok) { this.#finish(flight, { ok: false, why: reserved.why }); return; }
    if (!this.#budget.markDispatched(flight.requestId).ok) {
      this.#budget.cancelBeforeDispatch(flight.requestId);
      this.#finish(flight, { ok: false, why: 'reservation_unavailable' }); return;
    }
    flight.dispatched = true;
    let response;
    try {
      response = await this.#adapter.complete({ body: context.prepared.body, signal: flight.controller.signal,
        requestId: flight.requestId, maxOutputTokens: this.#limits.maxOutputTokens, maxResponseBytes: this.#limits.maxResponseBytes });
    } catch {
      this.#budget.markUnknown(flight.requestId, 'inference_error');
      this.#finish(flight, { ok: false, why: 'inference_error' }); return;
    }
    // Reconcile native usage even for malformed, cancelled, superseded or late responses.
    // The adapter, not generated JSON text, is the trusted usage source.
    const settlement = response?.usage ? this.#budget.settle(flight.requestId, response.usage) : { ok: false };
    if (!settlement.ok) this.#budget.markUnknown(flight.requestId, 'usage_unknown');
    if (this.#deadline(flight)) return;
    if (settlement.overrun) { this.#finish(flight, { ok: false, why: 'provider_limit_overrun' }); return; }
    const decision = parseDecision(response?.text, this.#limits.maxResponseBytes, flight.mode);
    if (!decision) { this.#finish(flight, { ok: false, why: 'invalid_decision' }); return; }
    const outputTokens = this.#adapter.countText(response.text);
    if (!integer(outputTokens) || outputTokens > this.#limits.maxOutputTokens) {
      this.#finish(flight, { ok: false, why: 'response_over_budget' }); return;
    }
    const current = copy(await this.#read());
    if (this.#deadline(flight)) return;
    const nowMs = this.#now(), fence = this.#fenceWhy(snapshot, current, nowMs);
    if (fence) { this.#finish(flight, { ok: false, why: fence }); return; }
    if (flight.mode === 'compaction') {
      if (decision.type === 'wait') { this.#finish(flight, { ok: true, action: null, memory: null }); return; }
      const result = createMemorySummary(decision, flight.turn, snapshot.scope, nowMs);
      if (!result.ok) { this.#finish(flight, { ok: false, why: result.why }); return; }
      await this.#commitMemory(flight, snapshot, result.entry); return;
    }
    if (flight.mode === 'goals') {
      if (!same(snapshot.required.goals, current.required.goals)) { this.#finish(flight, { ok: false, why: 'owner_files_changed' }); return; }
      if (decision.type === 'wait') { this.#finish(flight, { ok: true, action: null, objective: null }); return; }
      const proposal = validateGoalProposal(decision, flight.turn);
      if (!proposal.ok) { this.#finish(flight, { ok: false, why: proposal.why }); return; }
      let guarded = false, receipt;
      const guard = () => {
        guarded = false;
        if (flight.cancelled || this.#deadline(flight)) return { ok: false, why: 'inference_cancelled' };
        const latest = this.#readCommit();
        if (!latest || typeof latest.then === 'function') return { ok: false, why: 'invalid_commit_snapshot' };
        const why = this.#fenceWhy(snapshot, copy(latest), this.#now()) ?? (!same(snapshot.required.goals, latest.required?.goals) ? 'owner_files_changed' : null);
        if (why) return { ok: false, why };
        guarded = true;
        return { ok: true };
      };
      try {
        flight.goalCommitStarted = true;
        receipt = await this.#commitGoals({ expectedRevision: flight.turn.expectedRevision,
          expectedHashes: copy(snapshot.ownerFileHashes), goals: copy(proposal.goals), guard });
        if (!receipt || typeof receipt.ok !== 'boolean' || receipt.uncertain ||
            (receipt.ok && (!guarded || receipt.revision !== flight.turn.expectedRevision + 1 ||
              typeof receipt.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !same(receipt.goals, proposal.goals))))
          throw new Error('unknown objective commit');
      } catch {
        this.#goalsUncertain = true;
        if (flight.cancelled) {
          const record = this.#records.find((r) => r.requestId === flight.requestId);
          if (record) record.lateObjective = { state: 'uncertain', retryAllowed: false, afterInterruption: true };
        }
        this.#finish(flight, { ok: false, why: 'objective_commit_uncertain', objective: { state: 'uncertain', retryAllowed: false } });
        return;
      }
      if (flight.cancelled) {
        // A trusted writer may finish a commit before interruption but deliver its receipt late.
        // Preserve that known outcome; cancelling inference cannot undo a completed file write.
        this.#goalsUncertain = false;
        const record = this.#records.find((r) => r.requestId === flight.requestId);
        const late = { ...copy(receipt), state: receipt.ok ? 'committed' : 'rejected', afterInterruption: true,
          reason: proposal.reason, basis: proposal.basis, feedbackSha256: flight.turn.feedbackSha256,
          assessment: 'model_proposal', gameplaySuccess: false };
        if (record) { record.objective = copy(late); record.lateObjective = copy(late); }
        return;
      }
      this.#finish(flight, { ok: receipt.ok, ...(receipt.ok ? {} : { why: receipt.why ?? 'objective_commit_rejected' }), action: null,
        objective: { ...copy(receipt), reason: proposal.reason, basis: proposal.basis,
          feedbackSha256: flight.turn.feedbackSha256, assessment: 'model_proposal', gameplaySuccess: false } });
      return;
    }
    if (flight.mode === 'conversation') {
      const valid = this.#conversation.revalidate(flight.turn, current, nowMs);
      if (!valid.ok) { this.#finish(flight, { ok: false, why: valid.why }); return; }
      if (decision.type === 'wait') { this.#finish(flight, { ok: true, action: null }); return; }
      if (!validReplyText(decision.args.text, current.chat.config.maxLength)) {
        this.#finish(flight, { ok: false, why: 'invalid_reply_text' }); return;
      }
      const order = { v: 1, actionId: `mind_${flight.requestId.slice(5)}`, scope: current.grant.scope,
        controlRevision: current.grant.controlRevision, observationRevision: current.observation.revision,
        type: 'chat_send', args: { channel: flight.turn.channel, text: decision.args.text, target: flight.turn.target } };
      let action;
      try {
        action = this.#sendChat(copy(order));
        if (!action || typeof action.ok !== 'boolean' || typeof action.then === 'function') throw new Error('unknown chat submission');
      } catch {
        this.#chatUncertain = true;
        this.#finish(flight, { ok: false, why: 'chat_submission_uncertain', action: { ok: false, state: 'uncertain', actionId: order.actionId } });
        return;
      }
      this.#finish(flight, { ok: action.ok === true, ...(action.ok ? {} : { why: action.why ?? 'chat_rejected' }), action });
      return;
    }
    if (decision.type === 'wait') { this.#finish(flight, { ok: true, action: null }); return; }
    const order = { v: 1, actionId: flight.requestId, scope: snapshot.grant.scope, controlRevision: snapshot.grant.controlRevision,
      observationRevision: snapshot.observation.revision, type: decision.type, args: decision.args };
    const original = validateOrder(order, { grant: snapshot.grant, observation: snapshot.observation, nowMs, source: 'server' });
    if (!original.ok) { this.#finish(flight, { ok: false, why: original.why }); return; }
    // Ordinary new snapshots are allowed within the original freshness window. Revalidate the
    // same proposal using current target life/position/resources; the model cannot rebase it.
    order.observationRevision = current.observation.revision;
    const fresh = validateOrder(order, { grant: current.grant, observation: current.observation, nowMs, source: 'server' });
    if (!fresh.ok) { this.#finish(flight, { ok: false, why: fresh.why }); return; }
    let action;
    try { action = this.#submit(copy(order)); }
    catch {
      this.#finish(flight, { ok: false, why: 'order_submission_uncertain', action: { ok: false, state: 'uncertain', actionId: order.actionId } });
      return;
    }
    this.#finish(flight, { ok: action.ok === true, ...(action.ok ? {} : { why: action.why ?? 'order_rejected' }), action });
  }
  async #commitMemory(flight, before, entry) {
    const current = copy(await this.#read());
    if (this.#deadline(flight)) return;
    const fence = this.#fenceWhy(before, current, this.#now());
    if (fence) { this.#finish(flight, { ok: false, why: fence }); return; }
    let guarded = false, receipt;
    const guard = () => {
      guarded = false;
      if (flight.cancelled || this.#deadline(flight)) return { ok: false, why: 'inference_cancelled' };
      const latest = this.#readCommit();
      if (!latest || typeof latest.then === 'function') return { ok: false, why: 'invalid_commit_snapshot' };
      const why = this.#fenceWhy(before, copy(latest), this.#now());
      if (why) return { ok: false, why };
      guarded = true; return { ok: true };
    };
    try {
      flight.memoryCommitStarted = true;
      receipt = await this.#appendMemory({ expectedRevision: before.memoryJournal.revision, expectedHashes: copy(before.ownerFileHashes), entry: copy(entry), guard });
      if (!receipt || typeof receipt.ok !== 'boolean' || receipt.uncertain || (receipt.ok && (!guarded || receipt.revision !== before.memoryJournal.revision + 1 ||
          !/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.entryId !== entry.id || receipt.replay !== false))) throw new Error('unknown memory commit');
    } catch {
      this.#memoryUncertain = true;
      if (flight.cancelled) {
        const record = this.#records.find((r) => r.requestId === flight.requestId);
        if (record) record.lateMemory = { state: 'uncertain', retryAllowed: false, afterInterruption: true };
      }
      this.#finish(flight, { ok: false, why: 'memory_commit_uncertain', memory: { state: 'uncertain', retryAllowed: false } }); return;
    }
    const outcome = { ...copy(receipt), state: receipt.ok ? 'committed' : 'rejected', entryKind: entry.kind,
      certainty: entry.kind === 'summary' ? entry.payload.certainty : 'historical_observation', gameplaySuccess: false };
    if (flight.cancelled) {
      this.#memoryUncertain = false;
      const record = this.#records.find((r) => r.requestId === flight.requestId);
      if (record) { record.memory = { ...copy(outcome), afterInterruption: true }; record.lateMemory = copy(record.memory); }
      return;
    }
    this.#finish(flight, { ok: receipt.ok, ...(receipt.ok ? {} : { why: receipt.why ?? 'memory_commit_rejected' }), action: null, memory: outcome });
  }
}

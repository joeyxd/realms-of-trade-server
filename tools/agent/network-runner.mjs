import { randomUUID } from 'node:crypto';
import { AgentNetworkClient } from './network-client.mjs';
import { validGrant, integer } from './contract.mjs';

const copy = (v) => structuredClone(v);
const clock = () => Math.floor(performance.timeOrigin + performance.now());

// Process-local coordinator. Reentry is an explicit owner command, never a model tool or retry.
// Terminal clients remain terminal; archives cannot write into a subsequent connection.
export class AgentNetworkRunner {
  #options; #active; #archives = []; #retiredIds = new Set(); #sessions = new Set();
  #now; #feedback; #opening = false; #closed = false; #maxSessions; #connectOptions = {}; #transition = 0; #attempts = 0;
  constructor({ maxSessions = 8, onFeedback = () => {}, now = clock, ...options }) {
    if (!validGrant(options.grant) || !integer(maxSessions) || maxSessions < 1 || maxSessions > 16 ||
        typeof now !== 'function' || typeof onFeedback !== 'function') throw new TypeError('invalid runner configuration');
    // A finite archive must also bound each session's ledger independently of lab overrides.
    if (options.limits?.maxActions > 256) throw new TypeError('runner action capacity exceeded');
    this.#options = { ...options, grant: copy(options.grant), ...(options.limits ? { limits: copy(options.limits) } : {}) }; this.#now = now;
    this.#feedback = onFeedback; this.#maxSessions = maxSessions;
    this.#active = this.#create(options.grant);
  }
  #create(grant) {
    this.#attempts++;
    const client = new AgentNetworkClient({ ...this.#options, grant, now: this.#now, onFeedback: (event) => {
      if (this.#active !== client) return;
      if (event.type === 'stopped') this.#archive(client);
      this.#feedback({ ...event, sessionId: client.grant.scope.sessionId });
    } });
    return client;
  }
  #trackSession(client) { this.#sessions.add(client.grant.scope.sessionId); }
  #archive(client) {
    const sessionId = client.grant.scope.sessionId;
    if (this.#archives.some((a) => a.scope.sessionId === sessionId)) return;
    const actions = client.actions, requests = client.chat.requests;
    for (const entry of [...actions, ...requests]) this.#retiredIds.add(entry.order.actionId);
    this.#archives.push(copy({ scope: client.grant.scope, controlRevision: client.grant.controlRevision,
      identity: client.identity, termination: client.termination, actions, chatRequests: requests }));
  }
  get state() { return this.#active.state; }
  get closed() { return this.#closed; }
  get identity() { return this.#active.identity; }
  get authority() { return this.#active.authority; }
  get observation() { return this.#active.observation; }
  get grant() { return this.#active.grant; }
  get actions() { return this.#active.actions; }
  get chat() { return this.#active.chat; }
  get viewReport() { return this.#active.viewReport; }
  waitClosed(timeoutMs = 2000) { return this.#active.waitClosed(timeoutMs); }
  get lifecycle() {
    return copy({ v: 1, policy: 'explicit_fresh_session', authority: this.authority?.grant ? 'server_controller' : 'local_runner_only', durability: 'process_only',
      closed: this.#closed, opening: this.#opening, sessionsUsed: this.#attempts, maxSessions: this.#maxSessions,
      current: { scope: this.grant.scope, state: this.state, termination: this.#active.termination },
      archives: this.#archives, retiredActionCount: this.#retiredIds.size });
  }
  get priorUncertainty() {
    return this.#archives.flatMap((s) => [
      ...s.actions.filter((a) => a.state === 'uncertain').map((a) => ({ sessionId: s.scope.sessionId,
        actionId: a.order.actionId, kind: 'body', state: a.state, why: a.why, effects: a.effects, inputRange: a.inputRange })),
      ...s.chatRequests.filter((r) => r.state === 'uncertain').map((r) => ({ sessionId: s.scope.sessionId,
        actionId: r.order.actionId, kind: 'chat', state: r.state, why: r.why, attempts: r.attempts,
        result: r.result, read: 'unknown' })),
    ]).map((v) => ({ ...copy(v), retryAllowed: false, active: false }));
  }
  async connect(options = {}) {
    if (this.#closed || this.#opening || this.state !== 'idle') throw new TypeError('invalid runner connect');
    this.#opening = true; this.#connectOptions = { ...options };
    try {
      const ready = await this.#active.connect(options);
      this.#trackSession(this.#active);
      return ready;
    }
    finally { this.#opening = false; }
  }
  async reenter(ownerId) {
    if (ownerId !== this.#options.grant.scope.ownerId) return { ok: false, why: 'owner_mismatch' };
    if (this.#closed) return { ok: false, why: 'runner_closed' };
    if (this.#opening || this.state !== 'stopped') return { ok: false, why: 'session_active' };
    const authenticated = !!this.#options.authorization;
    const reason = this.#active.termination?.reason;
    if (!['death', 'disconnect', 'stop', 'revoke', 'revoked'].includes(reason)) return { ok: false, why: 'new_authorization_required' };
    if (!authenticated && this.#now() >= this.grant.expiresAtMs) return { ok: false, why: 'authorization_expired' };
    if (this.#attempts >= this.#maxSessions) return { ok: false, why: 'session_capacity' };
    if (!authenticated && !Number.isSafeInteger(this.grant.controlRevision + 1)) return { ok: false, why: 'new_authorization_required' };
    this.#opening = true;
    const transition = ++this.#transition;
    try {
      if (!await this.#active.waitClosed()) return { ok: false, why: 'transport_close_pending' };
      if (this.#closed) return { ok: false, why: 'runner_closed' };
      if (transition !== this.#transition) return { ok: false, why: 'reentry_cancelled' };
      if (!authenticated && this.#now() >= this.grant.expiresAtMs) return { ok: false, why: 'authorization_expired' };
      let grant;
      if (authenticated) grant = this.#options.grant;
      else {
        let sessionId;
        do { sessionId = randomUUID(); } while (this.#sessions.has(sessionId));
        grant = { ...this.grant, scope: { ...this.grant.scope, sessionId }, controlRevision: this.grant.controlRevision + 1 };
      }
      this.#active = this.#create(grant);
      try {
        const ready = await this.#active.connect(this.#connectOptions);
        this.#trackSession(this.#active);
        return { ...ready, grant: this.grant, priorUncertainty: this.priorUncertainty,
          taskResume: 'none', characterContinuity: authenticated ? 'server_admitted_fresh_epoch' : 'new_guest_body' };
      } catch (error) { return { ok: false, why: error.code ?? 'admission_failed', priorUncertainty: this.priorUncertainty }; }
    } finally { this.#opening = false; }
  }
  #retired(order) { return this.#retiredIds.has(order?.actionId); }
  order(order) { return this.#retired(order) ? { ok: false, why: 'retired_action_id' } : this.#active.order(order); }
  sendChat(order) { return this.#retired(order) ? { ok: false, why: 'retired_action_id' } : this.#active.sendChat(order); }
  retryChat(requestId) { return this.#retiredIds.has(requestId) ? { ok: false, why: 'retired_action_id' } : this.#active.retryChat(requestId); }
  cancel(actionId, ownerId) { return this.#active.cancel(actionId, ownerId); }
  pump() { return this.#active.pump(); }
  stop(ownerId) {
    if (ownerId !== this.#options.grant.scope.ownerId) return { ok: false, why: 'owner_mismatch' };
    ++this.#transition;
    return this.#active.stop(ownerId);
  }
  close() { this.#closed = true; ++this.#transition; this.#active.close(); }
}

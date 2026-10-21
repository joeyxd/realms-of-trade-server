import { PRESENCE_ORDERS } from './contract.mjs';

// IC03b: paced, latest-wins sender of the presence orders that one owner-message turn produced.
// It never decides or polls: one load on connect, then load + order (+ one CAS retry) per turn.
// The server validates and executes every order; a receipt reports state, never an arrival.
export const PRESENCE_PACING = Object.freeze({ minGapMs: 1000, maxSends: 20, windowMs: 60000 });
const fail = (why) => ({ ok: false, why });
const clock = () => Math.floor(performance.timeOrigin + performance.now());
const view = (p) => p && typeof p === 'object' ? { status: p.status, order: p.order, revision: p.revision, reason: p.reason } : null;

export class PresenceDriver {
  #request; #now; #setTimer; #clearTimer; #onEvent;
  #sends = []; #lastSendAt = null; #lane = Promise.resolve(); #current = null; #tokens = new Set(); #closed = false; #presence = null;
  constructor({ request, now = clock, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (timer) => clearTimeout(timer), onEvent = () => {} } = {}) {
    if ([request, now, setTimer, clearTimer, onEvent].some((f) => typeof f !== 'function')) throw new TypeError('invalid presence driver');
    this.#request = request; this.#now = now; this.#setTimer = setTimer; this.#clearTimer = clearTimer; this.#onEvent = onEvent;
  }
  get closed() { return this.#closed; }
  get presence() { return view(this.#presence); }
  load() { return this.#run(null); }
  order(op) { return PRESENCE_ORDERS.includes(op) ? this.#run(op) : Promise.resolve(this.#report('invalid', fail('invalid_request'))); }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const token of this.#tokens) token.wake?.();
  }
  async #run(op) {
    if (this.#closed) return this.#report(op, fail('closed'));
    const token = { op, superseded: false, wake: null };
    if (op !== null) {
      // Latest wins: the earlier order stops after its current send, or at once if it is not sending.
      if (this.#current) { this.#current.superseded = true; this.#current.wake?.(); }
      this.#current = token;
    }
    this.#tokens.add(token);
    const previous = this.#lane;
    let release;
    const mine = new Promise((resolve) => { release = resolve; });
    // Never two sends in flight: every run waits for all earlier runs, also those that left early.
    this.#lane = Promise.all([previous, mine]);
    try {
      const result = await this.#pause(token, previous) ? await this.#execute(token) : this.#stopped();
      return this.#report(op, result);
    } finally {
      release(); this.#tokens.delete(token);
      if (this.#current === token) this.#current = null;
    }
  }
  #stopped() { return fail(this.#closed ? 'closed' : 'superseded'); }
  // Resolves true when the promise settles, false as soon as the run is superseded or the driver closes.
  #pause(token, promise) {
    if (token.superseded || this.#closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; token.wake = null; resolve(value); } };
      token.wake = () => finish(false);
      promise.then(() => finish(!token.superseded && !this.#closed));
    });
  }
  async #execute(token) {
    const op = token.op;
    // An order needs room for its load and its op: a capped order sends nothing at all.
    const loaded = await this.#send(token, 'load', null, op === null ? 1 : 2);
    if (op === null || !loaded.ok) return loaded;
    if (!loaded.presence) return fail('no_companion');
    const sent = await this.#send(token, op, loaded.presence.revision, 1);
    if (sent.ok || sent.why !== 'conflict' || !sent.presence) return sent;
    // One retry with the revision the conflict receipt carries; a second conflict is final.
    return this.#send(token, op, sent.presence.revision, 1);
  }
  async #send(token, op, expectedRevision, needed) {
    if (token.superseded || this.#closed) return this.#stopped();
    const gap = this.#lastSendAt === null ? 0 : this.#lastSendAt + PRESENCE_PACING.minGapMs - this.#now();
    if (gap > 0) {
      let timer;
      const slept = new Promise((resolve) => { timer = this.#setTimer(resolve, gap); });
      const go = await this.#pause(token, slept);
      this.#clearTimer(timer);
      if (!go) return this.#stopped();
    }
    const now = this.#now();
    this.#sends = this.#sends.filter((at) => now - at < PRESENCE_PACING.windowMs);
    if (this.#sends.length + needed > PRESENCE_PACING.maxSends) return fail('paced');
    this.#sends.push(now); this.#lastSendAt = now;
    let receipt;
    try { receipt = await this.#request(op, op === 'load' ? {} : { expectedRevision }); }
    catch { receipt = null; }
    if (!receipt || typeof receipt !== 'object' || typeof receipt.ok !== 'boolean') receipt = fail('request_failed');
    if (receipt.presence) this.#presence = view(receipt.presence);
    return token.superseded ? fail('superseded') : receipt;
  }
  #report(op, result) {
    try { this.#onEvent({ op: op ?? 'load', ok: result.ok, why: result.why ?? null, presence: view(result.presence) }); } catch {}
    return structuredClone(result);
  }
}

// Dormant whole-death coordinator. Capture and reserve before IO; only drain writes/publishes.
// A host must freeze the affected actors and route lifecycle/mutation/publication through the gate.
import { randomUUID } from 'node:crypto';
import { StoreError, playerKey } from './store.mjs';
import { C, KIND } from '../src/sim/ecs.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { captureDeathPlan } from './deathPlan.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { prepareDeathApply } from './deathApply.mjs';
import { canonicalText, profilePearls, pearlKind } from './pearlOperations.mjs';
import { groundKey } from './pearlGround.mjs';
import { deathOperation, checkedDeathResult } from './deathOperation.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const normalized = (raw) => {
  const data = sanitizeProfile(raw);
  if (!data || !same(data, raw)) throw new StoreError('profile');
  return data;
};
const record = (raw, keys) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new StoreError('operation');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).some((key) => typeof key !== 'string' || !Object.hasOwn(fields[key], 'value')) ||
      Object.keys(fields).sort().join(',') !== keys) throw new StoreError('operation');
  return Object.fromEntries(Object.entries(fields).map(([key, d]) => [key, d.value]));
};
const numeric = (ecs, entity) => Object.entries(ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
  .map(([key, column]) => ({ key, column, value: column[entity] }));
const codeOf = (e) => e instanceof StoreError ? e.code : 'unavailable';

export class DeathStaging {
  #capturing = false; #captureViolation = false;
  constructor(sessions, world, scope, { limit = 64 } = {}) {
    this.scope = groundKey(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 256 ||
        (sessions.pearls.journal && sessions.pearls.journal.scope !== this.scope)) throw new StoreError('configuration');
    this.sessions = sessions; this.world = world; this.limit = limit;
    this.gate = pearlMutationGate(sessions);
    this.operations = new Map(); this.accounts = new Map(); this.tasks = new Set(); this.completed = [];
    this.sequence = 0; this.draining = false;
  }

  endpoint(raw) {
    const { clientId, entity } = record(raw, 'clientId,entity'), w = this.world, session = this.sessions.clients.get(clientId);
    const profile = w.profiles.get(entity), ecs = w.ecs;
    if (!Number.isSafeInteger(clientId) || clientId < 0 || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
        !session || session.closed || session.failed || session.id !== clientId || ecs.clientId[entity] !== clientId ||
        !ecs.alive[entity] || ecs.dead[entity] > 0 || ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
        !profile || profile.pirateId !== 'account:' + session.key) throw new StoreError('session');
    normalized(profile);
    return { clientId, entity, key: session.key, session, profile, text: canonicalText(profile),
      columns: numeric(ecs, entity), name: ecs.names[entity] };
  }

  // Trusted selector-only request. Its UUID acknowledges pending work, never a completed death.
  request(raw) {
    if (this.#capturing) { this.#captureViolation = true; throw new StoreError('busy'); }
    this.#capturing = true; this.#captureViolation = false;
    try { return this.#request(raw); } finally { this.#capturing = false; }
  }

  #request(raw) {
    if (this.draining) throw new StoreError('busy');
    const keys = raw && Object.hasOwn(raw, 'killer') ? 'killer,seq,victim' : 'seq,victim';
    const data = record(raw, keys);
    if (!Number.isSafeInteger(data.seq) || data.seq < 0 || data.seq > 2147483647) throw new StoreError('operation');
    if (this.operations.size >= this.limit) throw new StoreError('busy');
    const victim = this.endpoint(data.victim), killer = data.killer === undefined || data.killer === null ? null : this.endpoint(data.killer);
    if (killer && (killer.entity === victim.entity || killer.key === victim.key)) throw new StoreError('operation');
    const bindings = [victim, ...(killer ? [killer] : [])], w = this.world;
    // Determine the existing Cala PK participant, then reserve every affected baseline UID before
    // invoking gameplay helpers/map callbacks. The detached plan must agree with this role set.
    const lawless = !!w.map.lawlessAt?.(w.ecs.x[victim.entity],w.ecs.z[victim.entity]);
    if (this.#captureViolation) throw new StoreError('effect');
    const endpoints = [victim, ...(killer && lawless ? [killer] : [])];
    const uids = [...new Set(endpoints.flatMap((e) => profilePearls(normalized(e.profile)).map((q) => q.uid)))];
    const reservation = this.gate.reserve({ accounts: endpoints.map((e) => e.key), uids });
    const operationId = randomUUID();
    let plan;
    const ctx = { operationId, endpoints, bindings, uids, reservation, state: 'pending', sequence: ++this.sequence,
      ecs: w.ecs, names: w.ecs.names, profiles: w.profiles, ledger: w.pearlLedger, ledgers: new Map() };
    try {
      plan = captureDeathPlan(w, victim.entity, { seq: data.seq, by: killer?.entity ?? 0 });
      if (this.#captureViolation || plan.rules.lawless !== lawless || plan.profiles.length !== endpoints.length ||
          plan.profiles.some((p) => !endpoints.some((e) => e.entity === p.entity))) throw new StoreError('effect');
      ctx.plan = plan;
      for (const p of plan.profiles) for (const q of profilePearls(p.before)) ctx.ledgers.set(q.uid, clone(w.pearlLedger.get(q.uid)));
      this.assertBaseline(ctx);
    } catch (error) {
      if (this.gate.active(reservation)) this.gate.release(reservation); else this.gate.fence(reservation);
      throw error;
    }
    this.operations.set(operationId, ctx);
    for (const e of endpoints) this.accounts.set(e.key, ctx);
    const task = Promise.resolve().then(async () => {
      try {
        this.assertBaseline(ctx);
        // Settle the captured pre-death progress, including any older in-flight autosave. The
        // plan never changes across the wait; choose profile versions only after those writes.
        for (const e of endpoints) this.sessions.save(e.clientId, plan.profiles.find((p) => p.entity === e.entity).before, reservation);
        for (const e of endpoints) while (e.session.running || e.session.pending) {
          if (!e.session.running) this.sessions.kick(e.session);
          if (e.session.running) await e.session.running;
          this.assertBaseline(ctx);
          if (e.session.pending && !e.session.running) throw new StoreError('busy');
        }
        this.assertBaseline(ctx);
        const generations = await Promise.allSettled(plan.drops.filter((d) => d.kind === 'pearl').map(async (d) => {
          const row = await this.sessions.store.loadUnique(d.pearl.uid);
          const checked = record(row, 'holder,kind,version');
          if (checked.kind !== pearlKind(d.pearl.kind)) throw new StoreError('kind');
          if (checked.holder !== victim.key) throw new StoreError('ownership');
          if (!Number.isSafeInteger(checked.version) || checked.version < 1 || checked.version >= 2147483647) throw new StoreError('response');
          return { ...clone(d.pearl), expectedVersion: checked.version,
            ground: { x: d.x, z: d.z, availableAt: d.pickAt, returnAt: d.t } };
        }));
        this.assertBaseline(ctx);
        const pearls = generations.map((r) => { if (r.status === 'rejected') throw r.reason; return r.value; })
          .sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
        const profiles = plan.profiles.map((p) => {
          const e = endpoints.find((q) => q.entity === p.entity), s = e.session;
          if (s.running || s.pending || s.pearlBusy || !same(s.confirmed, p.before)) throw new StoreError('conflict');
          return { id: e.key, expectedVersion: s.version, before: clone(p.before), data: clone(p.after) };
        }).sort((a, b) => a.id < b.id ? -1 : 1);
        const concrete = { operationId, world: this.scope, victim: victim.key,
          killer: endpoints.find((e) => e !== victim)?.key ?? null,
          rules: { lawless: plan.rules.lawless, xpLossFraction: plan.rules.xpLossFraction, xpBefore: plan.ecs.before.xp },
          profiles, pearls, drops: plan.drops.filter((d) => d.kind !== 'pearl').map((d, i) => ({ ordinal: i + 1,
            kind: d.kind, item: d.item ? clone(d.item) : null,
            ground: { x: d.x, z: d.z, availableAt: plan.tick, expiresAt: d.t } })) };
        ctx.request = freeze(deathOperation(concrete).request);
        const result = await this.sessions.commitDeath(concrete, reservation);
        const receipt = checkedDeathResult(result?.receipt, ctx.request, operationId);
        if (!receipt.ok) throw new StoreError('response');
        ctx.receipt = freeze(clone(receipt)); ctx.state = 'ready';
      } catch (error) { ctx.state = 'failed'; ctx.code = codeOf(error); }
      this.completed.push(ctx);
    });
    this.tasks.add(task); task.finally(() => this.tasks.delete(task));
    return Object.freeze({ operationId });
  }

  assertIdentity(ctx) {
    const w = this.world;
    if (!this.gate.active(ctx.reservation) || w.ecs !== ctx.ecs || w.ecs.names !== ctx.names ||
        w.profiles !== ctx.profiles || w.pearlLedger !== ctx.ledger) throw new StoreError('cancelled');
    for (const e of ctx.bindings) if (this.sessions.clients.get(e.clientId) !== e.session ||
        this.sessions.accounts.get(e.key) !== e.session || e.session.closed || e.session.failed ||
        w.profiles.get(e.entity) !== e.profile || e.profile.pirateId !== 'account:' + e.key ||
        w.ecs.clientId[e.entity] !== e.clientId || w.ecs.names[e.entity] !== e.name) throw new StoreError('cancelled');
  }

  assertBaseline(ctx) {
    this.assertIdentity(ctx);
    const w = this.world;
    for (const e of ctx.bindings) if (canonicalText(e.profile) !== e.text ||
        numeric(w.ecs, e.entity).length !== e.columns.length ||
        e.columns.some((q) => w.ecs[q.key] !== q.column || q.column[e.entity] !== q.value)) throw new StoreError('cancelled');
    for (const [uid, row] of ctx.ledgers) if (!same(w.pearlLedger.get(uid), row)) throw new StoreError('ownership');
    // Catch an orphan/reassigned UID inserted while waiting, including unchanged killer ownership.
    for (const e of ctx.endpoints) {
      const held = new Set(profilePearls(ctx.plan.profiles.find((p) => p.entity === e.entity).before).map((q) => q.uid));
      for (const [uid, row] of w.pearlLedger) if (row?.place === 'profile' && (row.owner === e.profile.pirateId || row.entity === e.entity) &&
          (!held.has(uid) || row.owner !== e.profile.pirateId || row.entity !== e.entity)) throw new StoreError('ownership');
      for (const uid of held) {
        const row = w.pearlLedger.get(uid);
        if (row?.place !== 'profile' || row.owner !== e.profile.pirateId || row.entity !== e.entity ||
            Object.keys(row).sort().join(',') !== 'entity,owner,place') throw new StoreError('ownership');
      }
    }
  }

  invalidate(account) { this.gate.invalidate({ accounts: [playerKey(account)] }); }
  assertPublishable(clientId) {
    const s = this.sessions.clients.get(clientId);
    if (!s || s.closed || s.failed) throw new StoreError('session');
    this.gate.assertAvailable({ accounts: [s.key] });
  }
  save(clientId, raw) {
    if (this.#capturing) { this.#captureViolation = true; throw new StoreError('busy'); }
    if (this.draining) throw new StoreError('busy');
    const s = this.sessions.clients.get(clientId), ctx = s && this.accounts.get(s.key);
    if (!ctx) { this.assertPublishable(clientId); this.sessions.save(clientId, raw); return; }
    if (ctx.state === 'fenced') throw new StoreError('busy');
    this.assertBaseline(ctx);
    const p = ctx.plan.profiles.find((p) => p.entity === ctx.endpoints.find((e) => e.key === s.key).entity);
    if (!same(normalized(raw), p.before) || !same(capturePearlProfile(this.world, p.entity), p.before)) throw new StoreError('profile');
    // The exact old snapshot is buffered through the receipt -> drain gap, never re-saved.
  }
  fence(ctx, code) {
    this.gate.fence(ctx.reservation); ctx.state = 'fenced'; ctx.code = code;
    for (const e of ctx.endpoints) { try { this.sessions.fail(e.session, code); } catch { /* Retain both authorities. */ } }
    return { operationId: ctx.operationId, state: 'fenced', code };
  }

  drain() {
    if (this.#capturing) { this.#captureViolation = true; throw new StoreError('busy'); }
    if (this.draining) throw new StoreError('busy');
    this.draining = true;
    try {
      const results = [];
      for (const ctx of this.completed.splice(0).sort((a, b) => a.sequence - b.sequence)) {
        if (ctx.state !== 'ready') { results.push(this.fence(ctx, ctx.code ?? 'cancelled')); continue; }
        let effect;
        try {
          this.assertBaseline(ctx);
          for (const e of ctx.endpoints) {
            const p = ctx.request.profiles.find((p) => p.id === e.key);
            if (e.session.running || e.session.pending || e.session.pearlBusy ||
                e.session.version !== p.expectedVersion + 1 || !same(e.session.confirmed, p.data)) throw new StoreError('conflict');
          }
          effect = prepareDeathApply(this.world, ctx.plan, ctx.operationId);
          this.assertBaseline(ctx); effect.assertCurrent(); effect.apply(); effect.assertApplied();
          this.assertIdentity(ctx);
          // Any synchronous container callback that invalidated authority makes this a local rollback.
          if (ctx.endpoints.some((e) => e.session.running || e.session.pending || e.session.pearlBusy ||
              !same(e.session.confirmed, ctx.request.profiles.find((p) => p.id === e.key).data))) throw new StoreError('conflict');
          effect.publish(); this.assertIdentity(ctx); effect.assertApplied();
          this.gate.release(ctx.reservation);
        } catch (error) {
          try { effect?.rollback(); } catch { /* Durable state stays committed; never retry local effects. */ }
          results.push(this.fence(ctx, codeOf(error))); continue;
        }
        ctx.state = 'applied'; this.operations.delete(ctx.operationId);
        for (const e of ctx.endpoints) this.accounts.delete(e.key);
        results.push({ operationId: ctx.operationId, state: 'applied' });
      }
      return results;
    } finally { this.draining = false; }
  }
  // Shutdown/checks only. Waiting does not apply death, release a fence or authorize historical replay.
  async settle() { while (this.tasks.size) await Promise.all([...this.tasks]); }
}

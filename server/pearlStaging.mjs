// Dormant server-side give staging. Storage completion only queues work; the caller drains it at a
// tick boundary before events/snapshots. Every profile mutation route must honor this gate to enable it.
import { randomUUID } from 'node:crypto';
import { transferPearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { groundKey, groundOperation, checkedGroundResult } from './pearlGround.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';

const clone = (value) => structuredClone(value);
const frozen = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};
const normalized = (raw) => {
  const data = sanitizeProfile(raw);
  if (!data || canonicalText(data) !== canonicalText(raw)) throw new StoreError('profile');
  return data;
};
const codeOf = (error) => error instanceof StoreError ? error.code : 'unavailable';

export class PearlStaging {
  constructor(sessions, world, scope, { limit = 64 } = {}) {
    this.sessions = sessions; this.world = world; this.scope = groundKey(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 256 ||
        (sessions.pearls.journal && sessions.pearls.journal.scope !== this.scope)) throw new StoreError('configuration');
    this.limit = limit; this.accounts = new Map(); this.uids = new Map(); this.operations = new Map();
    this.gate = pearlMutationGate(sessions);
    this.tasks = new Set(); this.completed = []; this.sequence = 0;
  }

  // Trusted adapters pass account keys/UIDs before commerce, death, mint, join or any other mutation.
  assertAvailable({ accounts = [], uids = [] } = {}) {
    this.gate.assertAvailable({ accounts, uids });
  }

  endpoint({ clientId, entity } = {}) {
    const session = this.sessions.clients.get(clientId), profile = this.world.profiles.get(entity);
    if (!session || session.closed || session.failed || !Number.isInteger(entity) || entity < 1 ||
        entity >= this.world.ecs.cap || this.world.ecs.clientId[entity] !== clientId ||
        !profile || profile.pirateId !== `account:${session.key}`) throw new StoreError('session');
    normalized(profile);
    return { clientId, entity, session, key: session.key, profile };
  }

  // No caller-supplied holder, kind or UUID crosses this boundary. expectedVersion comes from the
  // authority's managed ledger read; the storage queue rechecks it before dispatch.
  give({ uid, source, target, expectedVersion } = {}) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2147483647) throw new StoreError('operation');
    const endpoints = [this.endpoint(source), this.endpoint(target)], [from, to] = endpoints, w = this.world;
    if (from.key === to.key || from.entity === to.entity) throw new StoreError('operation');
    this.assertAvailable({ accounts: endpoints.map((e) => e.key), uids: [uid] });
    if (this.operations.size >= this.limit) throw new StoreError('busy');
    const ledger = w.pearlLedger.get(uid);
    if (ledger?.place !== 'profile' || ledger.owner !== from.profile.pirateId || ledger.entity !== from.entity) throw new StoreError('ownership');

    // The existing synchronous helper is the sole eligibility/effect definition. Its writes and
    // deny/success events land in detached containers; ECS is only read by transferPearl.
    const view = { ecs: w.ecs, profiles: new Map(endpoints.map((e) => [e.entity, clone(e.profile)])),
      pearlLedger: new Map(), profileDirty: new Set(), events: [], emit(event) { this.events.push(clone(event)); } };
    if (!transferPearl(view, from.entity, uid, to.entity)) throw new StoreError(view.events.at(-1)?.why ?? 'operation');
    const pearl = view.profiles.get(to.entity).pearls.bag.at(-1);
    const plan = frozen({ meta: { operationId: randomUUID(), uid: pearl.uid, kind: pearl.kind,
      from: from.key, to: to.key, expectedVersion, world: this.scope, ground: null },
    profiles: endpoints.map((e) => ({ id: e.key, before: clone(e.profile.pearls), after: clone(view.profiles.get(e.entity).pearls) })),
    ledger: { owner: to.profile.pirateId, entity: to.entity, place: 'profile' }, events: view.events });
    const reservation = this.gate.reserve({ accounts: endpoints.map((e) => e.key), uids: [uid] });
    const ctx = { plan, endpoints, reservation, ledger: clone(ledger), state: 'pending', sequence: ++this.sequence };
    this.operations.set(plan.meta.operationId, ctx); this.uids.set(uid, ctx);
    for (const e of endpoints) this.accounts.set(e.key, ctx);

    // Save current pre-command progress into the CAS baseline. Later saves stay in this gate even
    // after PearlQueue releases its lanes, so an old live UID snapshot cannot bypass tick apply.
    const task = Promise.resolve().then(async () => {
      try {
        if (!this.current(ctx)) throw new StoreError('cancelled');
        for (const e of endpoints) this.sessions.save(e.clientId, clone(e.profile), ctx.reservation);
        const result = await this.sessions.commitPearlGround(plan.meta, (rows) => {
          if (!this.current(ctx)) throw new StoreError('cancelled');
          const built = rows.map(({ id, data }) => {
            const delta = plan.profiles.find((p) => p.id === id);
            if (!delta || canonicalText(data.pearls) !== canonicalText(delta.before)) throw new StoreError('ownership');
            return { id, data: { ...data, pearls: clone(delta.after) } };
          });
          ctx.request = groundOperation({ ...plan.meta, profiles: built.map((p) => ({ ...p,
            expectedVersion: rows.find((row) => row.id === p.id).version })) }).request;
          return built;
        }, ctx.reservation);
        if (!ctx.request || !checkedGroundResult(result?.receipt, ctx.request).ok) throw new StoreError('response');
        ctx.receipt = clone(result.receipt);
        ctx.state = 'ready';
      } catch (error) { ctx.state = 'failed'; ctx.code = codeOf(error); }
      this.completed.push(ctx);
    });
    this.tasks.add(task); task.finally(() => this.tasks.delete(task));
    return Object.freeze({ operationId: plan.meta.operationId });
  }

  current(ctx) {
    if (!this.gate.active(ctx.reservation)) return false;
    const w = this.world;
    return ctx.endpoints.every((e) => this.sessions.clients.get(e.clientId) === e.session &&
      this.sessions.accounts.get(e.key) === e.session && !e.session.closed && !e.session.failed &&
      w.profiles.get(e.entity) === e.profile && e.profile.pirateId === `account:${e.key}` &&
      w.ecs.clientId[e.entity] === e.clientId && w.ecs.alive[e.entity] && !(w.ecs.dead[e.entity] > 0));
  }

  // Lifecycle callers must invalidate before close/death/despawn, including death followed by revival
  // before the next drain. This does not cancel an in-flight SQL transaction or release its fence.
  invalidate(account) {
    this.gate.invalidate({ accounts: [playerKey(account)] });
  }

  // A live profile can still contain the pre-commit UID while storage has already moved it. Adapters
  // must guard before syncProfile/send, leaving dirty/save scheduling intact when publication waits.
  assertPublishable(clientId) {
    const session = this.sessions.clients.get(clientId);
    if (!session || session.closed || session.failed) throw new StoreError('session');
    this.gate.assertAvailable({ accounts: [session.key] });
  }

  save(clientId, raw) {
    const session = this.sessions.clients.get(clientId), ctx = session && this.accounts.get(session.key);
    if (!ctx) {
      if (session) this.gate.assertAvailable({ accounts: [session.key] });
      this.sessions.save(clientId, raw); return;
    }
    if (ctx.state === 'fenced' || !this.current(ctx)) throw new StoreError('busy');
    const data = normalized(raw), delta = ctx.plan.profiles.find((p) => p.id === session.key);
    if (data.pirateId !== `account:${session.key}` || canonicalText(data.pearls) !== canonicalText(delta.before)) throw new StoreError('ownership');
    const endpoint = ctx.endpoints.find((e) => e.key === session.key);
    if (canonicalText(data) !== canonicalText(normalized(endpoint.profile))) throw new StoreError('profile');
    // Snapshot callers use the live authoritative profile (syncProfile). Defer its write and capture
    // the latest live progress at apply, including progress earned after the most recent autosave.
  }

  fence(ctx, code) {
    this.gate.fence(ctx.reservation);
    ctx.state = 'fenced'; ctx.code = code;
    for (const e of ctx.endpoints) {
      // Mark both authorities even when a notification callback closes another connection or throws.
      try { this.sessions.fail(e.session, code); } catch { /* The reservation remains authoritative. */ }
    }
    return { operationId: ctx.plan.meta.operationId, state: 'fenced', code };
  }

  // Synchronous only. No simulation write occurs in promise continuations. Failed contexts retain
  // their lanes for authority reload; read-only receipt reconciliation never licenses a local replay.
  drain() {
    const completed = this.completed.splice(0).sort((a, b) => a.sequence - b.sequence), outcomes = [];
    for (const ctx of completed) {
      if (ctx.state !== 'ready') { outcomes.push(this.fence(ctx, ctx.code ?? 'cancelled')); continue; }
      const w = this.world, { plan, endpoints } = ctx;
      let publication, writes;
      try {
        if (!this.current(ctx)) throw new StoreError('cancelled');
        if (canonicalText(w.pearlLedger.get(plan.meta.uid)) !== canonicalText(ctx.ledger)) throw new StoreError('ownership');
        writes = endpoints.map((e) => {
          const delta = plan.profiles.find((p) => p.id === e.key), live = normalized(e.profile);
          // Correctly routed snapshots are buffered above. Any storage work in the apply gap is a
          // bypass and must not race this apply, even if it has not failed or changed version yet.
          if (e.session.running || e.session.pending || e.session.pearlBusy ||
              e.session.version !== ctx.receipt.profiles.find((p) => p.id === e.key)?.version) throw new StoreError('busy');
          if (canonicalText(live.pearls) !== canonicalText(delta.before) ||
              canonicalText(e.session.confirmed?.pearls) !== canonicalText(delta.after)) throw new StoreError('ownership');
          return { e, before: e.profile.pearls, after: clone(delta.after), dirty: w.profileDirty.has(e.entity),
            save: normalized({ ...live, pearls: clone(delta.after) }) };
        });
        // Run event decoration against a detached buffer before changing live state. A publication
        // failure cannot leak one endpoint's success event or make a later drain retry this operation.
        publication = { ecs: w.ecs, events: [] };
        for (const event of plan.events) w.emit.call(publication, clone(event));
      } catch (error) { outcomes.push(this.fence(ctx, codeOf(error))); continue; }
      const eventCount = w.events.length;
      try {
        if (!this.current(ctx)) throw new StoreError('cancelled');
        for (const change of writes) { change.e.profile.pearls = change.after; w.profileDirty.add(change.e.entity); }
        w.pearlLedger.set(plan.meta.uid, clone(plan.ledger));
        // ProfileSessions.save only enqueues microtasks. If either enqueue fails, fence clears both
        // pending snapshots synchronously before any write can start; drain never yields here.
        for (const change of writes) this.sessions.save(change.e.clientId, change.save, ctx.reservation);
        if (endpoints.some((e) => e.session.failed || e.session.closed)) throw new StoreError('session');
        if (!this.gate.active(ctx.reservation)) throw new StoreError('cancelled');
        w.events.push(...publication.events);
        this.gate.release(ctx.reservation);
      } catch (error) {
        // Undo only this tentative local apply, never the durable commit. Fence rather than retry.
        try {
          w.events.length = eventCount;
          for (const change of writes) { change.e.profile.pearls = change.before; if (!change.dirty) w.profileDirty.delete(change.e.entity); }
          w.pearlLedger.set(plan.meta.uid, clone(ctx.ledger));
        } catch { /* A broken live container still cannot release the fence or retry SQL. */ }
        outcomes.push(this.fence(ctx, codeOf(error))); continue;
      }
      ctx.state = 'applied';
      this.operations.delete(plan.meta.operationId); this.uids.delete(plan.meta.uid);
      for (const e of endpoints) this.accounts.delete(e.key);
      outcomes.push({ operationId: plan.meta.operationId, state: 'applied' });
    }
    return outcomes;
  }

  // For shutdown/isolated checks, never inside a simulation tick. It does not apply or clear fences.
  async settle() { while (this.tasks.size) await Promise.all([...this.tasks]); }
}

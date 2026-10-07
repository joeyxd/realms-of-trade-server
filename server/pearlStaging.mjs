// Dormant server-side give/swallow/replacement staging. Storage completion only queues work; the caller drains it at a
// tick boundary before events/snapshots. Every profile mutation route must honor this gate to enable it.
import { randomUUID } from 'node:crypto';
import { transferPearl, swallowPearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { groundKey, groundOperation, checkedGroundResult } from './pearlGround.mjs';
import { batchIntent, batchOperation, checkedBatchResult } from './pearlBatch.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { pearlEcsDraft, pearlSwallowEffect } from './pearlEcsEffect.mjs';
import { PEARL_PROFILE_ECS_FIELDS } from './pearlProfileSnapshot.mjs';

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
const version = (n) => Number.isSafeInteger(n) && n >= 1 && n < 2147483647;

// The persistent ground record has no local drop ID. Assign it only at the synchronous apply,
// preserving the helper's frozen geometry/time while other actors may have created drops during IO.
function replacementDrop(world, planned) {
  const drops = world.drops, id = world.nextDrop;
  if (!(drops instanceof Map) || !Number.isSafeInteger(id) || id < 1 || id >= Number.MAX_SAFE_INTEGER || drops.has(id)) {
    throw new StoreError('busy');
  }
  const drop = { ...clone(planned), id };
  let applied = false;
  return {
    drop,
    assertCurrent() {
      if (world.drops !== drops || world.nextDrop !== id || drops.has(id)) throw new StoreError('busy');
    },
    apply() {
      this.assertCurrent(); applied = true;
      drops.set(id, drop); world.nextDrop = id + 1;
    },
    assertApplied() {
      if (world.drops !== drops || world.nextDrop !== id + 1 ||
          canonicalText(drops.get(id)) !== canonicalText({ ...planned, id })) throw new StoreError('ownership');
    },
    rollback() {
      if (!applied) return;
      // Undo this insertion only. A broken callback cannot make us delete another actor's drop.
      if (drops.get(id) === drop) drops.delete(id);
      if (world.nextDrop === id + 1) world.nextDrop = id;
      applied = false;
    },
  };
}

export class PearlStaging {
  #captureProfile; #capturing = false; #captureViolation = false;

  constructor(sessions, world, scope, { limit = 64, captureProfile = null } = {}) {
    this.sessions = sessions; this.world = world; this.scope = groundKey(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 256 ||
        (captureProfile !== null && typeof captureProfile !== 'function') ||
        (sessions.pearls.journal && sessions.pearls.journal.scope !== this.scope)) throw new StoreError('configuration');
    this.#captureProfile = captureProfile;
    this.limit = limit; this.accounts = new Map(); this.uids = new Map(); this.operations = new Map();
    this.gate = pearlMutationGate(sessions);
    this.tasks = new Set(); this.completed = []; this.sequence = 0;
  }

  // Trusted adapters pass account keys/UIDs before commerce, death, mint, join or any other mutation.
  assertAvailable({ accounts = [], uids = [] } = {}) {
    this.gate.assertAvailable({ accounts, uids });
  }

  endpoint({ clientId, entity } = {}) {
    this.#assertCaptureEntry();
    const session = this.sessions.clients.get(clientId), profile = this.world.profiles.get(entity);
    if (!session || session.closed || session.failed || !Number.isInteger(entity) || entity < 1 ||
        entity >= this.world.ecs.cap || this.world.ecs.clientId[entity] !== clientId ||
        !profile || profile.pirateId !== `account:${session.key}`) throw new StoreError('session');
    normalized(profile);
    return { clientId, entity, session, key: session.key, profile };
  }

  #assertCaptureEntry() {
    if (this.#capturing) { this.#captureViolation = true; throw new StoreError('effect'); }
  }

  #snapshot(endpoint) {
    this.#assertCaptureEntry();
    const before = normalized(endpoint.profile), beforeText = canonicalText(before);
    if (this.#captureProfile === null) return before;
    this.#capturing = true; this.#captureViolation = false;
    try {
      const raw = this.#captureProfile(endpoint.clientId, endpoint.entity);
      if (raw && typeof raw.then === 'function') {
        Promise.resolve(raw).catch(() => {});
        throw new StoreError('profile');
      }
      const captured = normalized(raw), comparable = { ...captured };
      for (const field of PEARL_PROFILE_ECS_FIELDS) comparable[field] = before[field];
      if (this.#captureViolation || canonicalText(comparable) !== beforeText ||
          canonicalText(normalized(endpoint.profile)) !== beforeText) throw new StoreError('profile');
      return captured;
    } finally { this.#capturing = false; }
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
    const plan = frozen({ effect: 'give', meta: { operationId: randomUUID(), uid: pearl.uid, kind: pearl.kind,
      from: from.key, to: to.key, expectedVersion, world: this.scope, ground: null },
    profiles: endpoints.map((e) => ({ id: e.key, before: clone(e.profile.pearls), after: clone(view.profiles.get(e.entity).pearls) })),
    ledger: { owner: to.profile.pirateId, entity: to.entity, place: 'profile' }, events: view.events });
    return this.enqueue(plan, endpoints, new Map([[uid, ledger]]));
  }

  swallow({ uid, source, expectedVersion, replaceUid } = {}) {
    if (replaceUid !== undefined || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
        expectedVersion >= 2147483647) throw new StoreError('operation');
    const from = this.endpoint(source), w = this.world;
    this.assertAvailable({ accounts: [from.key], uids: [uid] });
    if (this.operations.size >= this.limit) throw new StoreError('busy');
    const ledger = w.pearlLedger.get(uid);
    if (ledger?.place !== 'profile' || ledger.owner !== from.profile.pirateId || ledger.entity !== from.entity) throw new StoreError('ownership');
    if (from.profile.pearls.swallowed !== null) throw new StoreError('confirm');

    const draft = pearlEcsDraft(w.ecs, from.entity);
    const view = { ecs: draft.ecs, profiles: new Map([[from.entity, clone(from.profile)]]),
      pearlLedger: new Map(), profileDirty: new Set(), events: [], emit(event) { this.events.push(clone(event)); } };
    if (!swallowPearl(view, from.entity, uid)) throw new StoreError(view.events.at(-1)?.why ?? 'operation');
    const after = normalized(view.profiles.get(from.entity)), pearl = after.pearls.swallowed;
    if (view.events.length !== 1 || view.events[0].type !== 'pearlChanged' || view.events[0].op !== 'swallow' ||
        view.pearlLedger.size !== 0) throw new StoreError('effect');
    const plan = frozen({ effect: 'swallow', meta: { operationId: randomUUID(), uid: pearl.uid, kind: pearl.kind,
      from: from.key, to: from.key, expectedVersion, world: this.scope, ground: null },
    profiles: [{ id: from.key, before: clone(from.profile.pearls), after: clone(after.pearls) }],
    ledger: clone(ledger), events: view.events });
    return this.enqueue(plan, [from], new Map([[uid, ledger]]));
  }

  replace({ uid, replaceUid, source, expectedVersion, replaceExpectedVersion } = {}) {
    if (!version(expectedVersion) || !version(replaceExpectedVersion)) throw new StoreError('operation');
    const from = this.endpoint(source), w = this.world, old = from.profile.pearls.swallowed;
    if (!old || replaceUid !== old.uid) throw new StoreError('confirm');
    const uids = [groundKey(uid), groundKey(replaceUid)];
    if (uids[0] === uids[1]) throw new StoreError('operation');
    this.assertAvailable({ accounts: [from.key], uids });
    if (this.operations.size >= this.limit) throw new StoreError('busy');
    const ledgers = new Map(uids.map((key) => [key, clone(w.pearlLedger.get(key))]));
    for (const ledger of ledgers.values()) if (ledger?.place !== 'profile' ||
        ledger.owner !== from.profile.pirateId || ledger.entity !== from.entity) throw new StoreError('ownership');

    const draft = pearlEcsDraft(w.ecs, from.entity);
    // canStand reads the existing map/deck. All helper writes, including names/drop counter, are detached.
    const view = { ecs: { ...draft.ecs, names: clone(w.ecs.names) }, map: w.map, raftDeck: w.raftDeck,
      tick: w.tick, nextDrop: 1, drops: new Map(), profiles: new Map([[from.entity, clone(from.profile)]]),
      pearlLedger: new Map(), profileDirty: new Set(), events: [], emit(event) { this.events.push(clone(event)); } };
    if (!swallowPearl(view, from.entity, uid, replaceUid)) throw new StoreError(view.events.at(-1)?.why ?? 'operation');
    const after = normalized(view.profiles.get(from.entity)), incoming = after.pearls.swallowed, drop = view.drops.get(1);
    if (view.drops.size !== 1 || view.nextDrop !== 2 || drop?.pearl.uid !== old.uid ||
        view.pearlLedger.size !== 1 || view.pearlLedger.get(old.uid)?.drop !== 1 ||
        view.events.length !== 2 || view.events[0].type !== 'loot' || view.events[1].type !== 'pearlChanged' ||
        view.events[1].op !== 'swallow') throw new StoreError('effect');
    const meta = batchIntent({ operationId: randomUUID(), actor: from.key, world: this.scope, mode: 'replace',
      items: [{ ...incoming, expectedVersion, ground: null }, { ...old, expectedVersion: replaceExpectedVersion,
        ground: { x: drop.x, z: drop.z, availableAt: drop.pickAt, returnAt: drop.t } }]
        .sort((a, b) => a.uid < b.uid ? -1 : 1) });
    const plan = frozen({ effect: 'replace', meta,
      profiles: [{ id: from.key, before: clone(from.profile.pearls), after: clone(after.pearls) }],
      ledgers: [{ uid: incoming.uid, data: clone(ledgers.get(incoming.uid)) },
        { uid: old.uid, data: clone(view.pearlLedger.get(old.uid)) }], drop: clone(drop), events: view.events });
    return this.enqueue(plan, [from], ledgers);
  }

  enqueue(plan, endpoints, ledgers) {
    this.#assertCaptureEntry();
    const uids = plan.meta.items ? plan.meta.items.map((q) => q.uid) : [plan.meta.uid];
    const reservation = this.gate.reserve({ accounts: endpoints.map((e) => e.key), uids });
    const ctx = { plan, endpoints, uids, reservation, ledgers: new Map([...ledgers].map(([uid, row]) => [uid, clone(row)])),
      state: 'pending', sequence: ++this.sequence };
    // Capture before any async save/IO. The optional trusted adapter is read-only and synchronous;
    // its selectors contain no caller account identity, capability, inventory or receipt.
    try {
      if (!this.current(ctx)) throw new StoreError('cancelled');
      const before = endpoints.map((e) => canonicalText(normalized(e.profile)));
      ctx.baselines = this.#captureProfile === null ? null : endpoints.map((e) => this.#snapshot(e));
      if (!this.current(ctx)) throw new StoreError('cancelled');
      if (endpoints.some((e, i) => canonicalText(normalized(e.profile)) !== before[i])) throw new StoreError('profile');
      this.assertLedgers(ctx);
    } catch (error) {
      if (this.gate.active(reservation)) this.gate.release(reservation);
      else this.gate.fence(reservation); // An invalidated authority cannot be made available again.
      throw error;
    }
    this.operations.set(plan.meta.operationId, ctx);
    for (const uid of uids) this.uids.set(uid, ctx);
    for (const e of endpoints) this.accounts.set(e.key, ctx);

    // Save current pre-command progress into the CAS baseline. Later saves stay in this gate even
    // after PearlQueue releases its lanes, so an old live UID snapshot cannot bypass tick apply.
    const task = Promise.resolve().then(async () => {
      try {
        if (!this.current(ctx)) throw new StoreError('cancelled');
        for (const [i, e] of endpoints.entries()) this.sessions.save(e.clientId, clone(ctx.baselines?.[i] ?? e.profile), ctx.reservation);
        const batch = plan.effect === 'replace';
        const result = await this.sessions[batch ? 'commitPearlBatch' : 'commitPearlGround'](plan.meta, (rows) => {
          if (!this.current(ctx)) throw new StoreError('cancelled');
          const built = rows.map(({ id, data }) => {
            const delta = plan.profiles.find((p) => p.id === id);
            if (!delta || canonicalText(data.pearls) !== canonicalText(delta.before)) throw new StoreError('ownership');
            return { id, data: { ...data, pearls: clone(delta.after) } };
          });
          const profiles = built.map((p) => ({ ...p, expectedVersion: rows.find((row) => row.id === p.id).version }));
          if (batch) {
            const { actor: _actor, ...intent } = plan.meta;
            ctx.request = batchOperation({ ...intent, profile: profiles[0] }).request;
          } else ctx.request = groundOperation({ ...plan.meta, profiles }).request;
          return built;
        }, ctx.reservation);
        if (!ctx.request || !(batch ? checkedBatchResult : checkedGroundResult)(result?.receipt, ctx.request).ok) {
          throw new StoreError('response');
        }
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

  assertLedgers(ctx) {
    for (const [uid, row] of ctx.ledgers) if (canonicalText(this.world.pearlLedger.get(uid)) !== canonicalText(row)) {
      throw new StoreError('ownership');
    }
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
    this.#assertCaptureEntry();
    const session = this.sessions.clients.get(clientId), ctx = session && this.accounts.get(session.key);
    if (!ctx) {
      if (session) this.gate.assertAvailable({ accounts: [session.key] });
      this.sessions.save(clientId, raw); return;
    }
    if (ctx.state === 'fenced' || !this.current(ctx)) throw new StoreError('busy');
    const data = normalized(raw), delta = ctx.plan.profiles.find((p) => p.id === session.key);
    if (data.pirateId !== `account:${session.key}` || canonicalText(data.pearls) !== canonicalText(delta.before)) throw new StoreError('ownership');
    const endpoint = ctx.endpoints.find((e) => e.key === session.key);
    if (canonicalText(data) !== canonicalText(this.#snapshot(endpoint))) throw new StoreError('profile');
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
    this.#assertCaptureEntry();
    const completed = this.completed.splice(0).sort((a, b) => a.sequence - b.sequence), outcomes = [];
    for (const ctx of completed) {
      if (ctx.state !== 'ready') { outcomes.push(this.fence(ctx, ctx.code ?? 'cancelled')); continue; }
      const w = this.world, { plan, endpoints } = ctx;
      let publication, writes, effect, dropEffect, ledgers;
      try {
        if (!this.current(ctx)) throw new StoreError('cancelled');
        this.assertLedgers(ctx);
        writes = endpoints.map((e) => {
          const delta = plan.profiles.find((p) => p.id === e.key), before = normalized(e.profile), live = this.#snapshot(e);
          // Correctly routed snapshots are buffered above. Any storage work in the apply gap is a
          // bypass and must not race this apply, even if it has not failed or changed version yet.
          if (e.session.running || e.session.pending || e.session.pearlBusy ||
              e.session.version !== ctx.receipt.profiles.find((p) => p.id === e.key)?.version) throw new StoreError('busy');
          if (canonicalText(live.pearls) !== canonicalText(delta.before) ||
              canonicalText(e.session.confirmed?.pearls) !== canonicalText(delta.after)) throw new StoreError('ownership');
          return { e, before: e.profile.pearls, after: clone(delta.after), dirty: w.profileDirty.has(e.entity),
            beforeText: canonicalText(before),
            progressBefore: Object.fromEntries(PEARL_PROFILE_ECS_FIELDS.map((field) => [field, before[field]])),
            save: normalized({ ...live, pearls: clone(delta.after) }) };
        });
        // Run event decoration against a detached buffer before changing live state. A publication
        // failure cannot leak one endpoint's success event or make a later drain retry this operation.
        if (plan.effect === 'swallow' || plan.effect === 'replace') effect = pearlSwallowEffect(w, endpoints[0].entity, writes[0].save);
        if (plan.effect === 'replace') dropEffect = replacementDrop(w, plan.drop);
        ledgers = plan.ledgers ? plan.ledgers.map(({ uid, data }) => ({ uid,
          data: data.place === 'ground' ? { ...clone(data), drop: dropEffect.drop.id } : clone(data) })) :
          [{ uid: plan.meta.uid, data: clone(plan.ledger) }];
        publication = { ecs: effect?.ecs ?? w.ecs, events: [] };
        for (const event of plan.events) {
          const next = clone(event);
          if (dropEffect && next.type === 'loot') next.drops[0].id = dropEffect.drop.id;
          w.emit.call(publication, next);
        }
      } catch (error) { outcomes.push(this.fence(ctx, codeOf(error))); continue; }
      const eventCount = w.events.length;
      let localStarted = false;
      try {
        if (!this.current(ctx)) throw new StoreError('cancelled');
        this.assertLedgers(ctx);
        if (writes.some((change) => canonicalText(normalized(change.e.profile)) !== change.beforeText)) throw new StoreError('ownership');
        effect?.assertCurrent(w.ecs);
        dropEffect?.assertCurrent();
        localStarted = true;
        for (const change of writes) {
          change.e.profile.pearls = change.after;
          for (const field of PEARL_PROFILE_ECS_FIELDS) change.e.profile[field] = change.save[field];
          w.profileDirty.add(change.e.entity);
        }
        for (const { uid, data } of ledgers) w.pearlLedger.set(uid, clone(data));
        dropEffect?.apply();
        effect?.apply(w.ecs);
        // ProfileSessions.save only enqueues microtasks. If either enqueue fails, fence clears both
        // pending snapshots synchronously before any write can start; drain never yields here.
        for (const change of writes) this.sessions.save(change.e.clientId, change.save, ctx.reservation);
        if (endpoints.some((e) => e.session.failed || e.session.closed)) throw new StoreError('session');
        if (writes.some((change) => canonicalText(normalized(change.e.profile)) !== canonicalText(change.save))) throw new StoreError('ownership');
        for (const { uid, data } of ledgers) if (canonicalText(w.pearlLedger.get(uid)) !== canonicalText(data)) throw new StoreError('ownership');
        dropEffect?.assertApplied();
        if (!this.gate.active(ctx.reservation)) throw new StoreError('cancelled');
        w.events.push(...publication.events);
        this.gate.release(ctx.reservation);
      } catch (error) {
        // Undo only this tentative local apply, never the durable commit. Fence rather than retry.
        try {
          if (localStarted) {
            w.events.length = eventCount;
            effect?.rollback();
            dropEffect?.rollback();
            for (const change of writes) {
              change.e.profile.pearls = change.before;
              Object.assign(change.e.profile, change.progressBefore);
              if (!change.dirty) w.profileDirty.delete(change.e.entity);
            }
            for (const [uid, row] of ctx.ledgers) w.pearlLedger.set(uid, clone(row));
          }
        } catch { /* A broken live container still cannot release the fence or retry SQL. */ }
        outcomes.push(this.fence(ctx, codeOf(error))); continue;
      }
      ctx.state = 'applied';
      this.operations.delete(plan.meta.operationId);
      for (const uid of ctx.uids) this.uids.delete(uid);
      for (const e of endpoints) this.accounts.delete(e.key);
      outcomes.push({ operationId: plan.meta.operationId, state: 'applied' });
    }
    return outcomes;
  }

  // For shutdown/isolated checks, never inside a simulation tick. It does not apply or clear fences.
  async settle() { while (this.tasks.size) await Promise.all([...this.tasks]); }
}

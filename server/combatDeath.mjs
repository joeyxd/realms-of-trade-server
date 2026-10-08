// Optional authenticated fatal-combat adapter. Complete a terminal tick once, then serialize
// its deaths through existing receipts. No simulation continuation runs while storage is pending.
import { StoreError } from './store.mjs';
import { C, KIND } from '../src/sim/ecs.js';
import { canonicalText, profilePearls } from './pearlOperations.mjs';

export class CombatDeath {
  #queue = []; #current = null; #failed = false; #tick = null; #baselines = new Map();
  constructor(server, staging) {
    this.server = server; this.world = server.world; this.staging = staging;
    this.sessions = staging.sessions;
  }
  get pending() { return this.#queue.length > 0; }
  get failed() { return this.#failed; }
  get count() { return this.#queue.length; }
  has(entity) { return this.#queue.some((q) => q.victim.entity === entity); }
  fail() { this.#failed = true; }

  #binding(entity) {
    const s = this.server, w = this.world, ecs = w.ecs, clientId = s.clientOf(entity);
    const client = s.clients.get(clientId), session = this.sessions.clients.get(clientId);
    const profile = w.profiles.get(entity);
    if (!Number.isInteger(entity) || entity < 1 || entity >= ecs.cap || !ecs.alive[entity] ||
        ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
        !client?.serverProfile || client.entity !== entity || !session || session.closed || session.failed ||
        this.sessions.accounts.get(session.key) !== session || ecs.clientId[entity] !== clientId ||
        profile?.pirateId !== 'account:' + session.key) throw new StoreError('session');
    return { clientId, entity, client, session, profile, name: ecs.names[entity],
      columns: { alive: ecs.alive, dead: ecs.dead, clientId: ecs.clientId, kind: ecs.kind, mask: ecs.mask },
      ecs, names: ecs.names, profiles: w.profiles };
  }
  #assertBinding(b) {
    const now = this.#binding(b.entity);
    if (this.server.world !== this.world || this.staging.world !== this.world ||
        ['clientId','client','session','profile','name','ecs','names','profiles'].some((k) => now[k] !== b[k]) ||
        Object.keys(b.columns).some((k) => now.columns[k] !== b.columns[k])) throw new StoreError('cancelled');
  }
  #assertBindings() {
    for (const q of this.#queue) for (const b of [q.victim, ...(q.killer ? [q.killer] : [])]) this.#assertBinding(b);
  }

  #baseline(b) {
    return { binding: b, text: canonicalText(b.profile),
      columns: Object.entries(this.world.ecs).filter(([,c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
        .map(([key,column]) => ({ key, column, value: column[b.entity] })),
      ledger: this.world.pearlLedger,
      uids: profilePearls(b.profile).map(q => ({ uid: q.uid, text: canonicalText(this.world.pearlLedger.get(q.uid)) })) };
  }
  #assertBaseline(b, profileChanged = false) {
    this.#assertBinding(b.binding);
    if ((!profileChanged && canonicalText(b.binding.profile) !== b.text) || this.world.pearlLedger !== b.ledger ||
        b.columns.length !== Object.values(this.world.ecs).filter(c => ArrayBuffer.isView(c) && !(c instanceof DataView)).length ||
        b.columns.some(q => this.world.ecs[q.key] !== q.column || q.column[b.binding.entity] !== q.value) ||
        b.uids.some(q => canonicalText(this.world.pearlLedger.get(q.uid)) !== q.text)) throw new StoreError('cancelled');
    const held = new Set(b.uids.map(q => q.uid));
    for (const [uid,row] of this.world.pearlLedger) if (row?.place === 'profile' &&
        (row.entity === b.binding.entity || row.owner === b.binding.profile.pirateId) && !held.has(uid)) throw new StoreError('ownership');
  }
  assertWaiting() {
    this.server.assertDeathCaptureBoundary();
    if (this.#failed) throw new StoreError('cancelled');
    for (const b of this.#baselines.values()) this.#assertBaseline(b);
  }

  // Called by killPlayer before any death reset/loss/event. Only the dead marker belongs to
  // this adapter; completed commands, damage, RNG and other systems are never rewound.
  intercept(entity, seq = 0, by = 0) {
    this.server.assertCombatTick();
    if (this.#failed || this.#current || this.#queue.length >= this.staging.limit) throw new StoreError('busy');
    const w = this.world, victim = this.#binding(entity), ecs = w.ecs;
    if (ecs.dead[entity] !== 0 || (this.#tick !== null && this.#tick !== w.tick)) throw new StoreError('effect');
    seq ??= 0;
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > 2147483647) throw new StoreError('operation');
    const killer = by && ecs.alive[by] && ecs.kind[by] === KIND.PLAYER && (ecs.mask[by] & C.PLAYER)
      ? this.#binding(by) : null;
    if (killer?.entity === entity || (killer && killer.session.key === victim.session.key)) throw new StoreError('operation');
    this.server.holdCombatPublication();
    this.#queue.push({ victim, killer, seq });
    this.#tick = w.tick; ecs.dead[entity] = 1;
    return true;
  }

  completeTick() {
    this.server.assertDeathCaptureBoundary();
    if (this.#failed) throw new StoreError('cancelled');
    if (!this.pending) return;
    if (this.#current || this.world.tick !== this.#tick + 1) throw new StoreError('effect');
    this.#assertBindings();
    if (this.#queue.some((q) => q.victim.columns.dead[q.victim.entity] !== 1)) throw new StoreError('effect');
    // Normalize every provisional marker before capturing the completed tick. Nothing is published
    // until the queue is empty. Subsequent receipts see earlier confirmed PK/death profile versions.
    for (const q of this.#queue) q.victim.columns.dead[q.victim.entity] = 0;
    for (const q of this.#queue) for (const b of [q.victim, ...(q.killer ? [q.killer] : [])]) {
      this.#baselines.set(b.entity, this.#baseline(b));
    }
    this.#startNext();
  }

  #startNext() {
    this.server.assertDeathCaptureBoundary();
    this.#assertBindings();
    const q = this.#queue[0];
    if (!q || this.#current || this.#failed) throw new StoreError('effect');
    if (this.staging.operations.size) throw new StoreError('busy');
    const handle = this.staging.request({ seq: q.seq,
      victim: { clientId: q.victim.clientId, entity: q.victim.entity },
      killer: q.killer ? { clientId: q.killer.clientId, entity: q.killer.entity } : null });
    const { plan } = this.staging.operations.get(handle.operationId);
    this.#current = { ...handle, lawless: plan.rules.lawless,
      profiles: plan.profiles.map(p => ({ entity: p.entity, text: canonicalText(p.after) })),
      columns: Object.entries(plan.ecs.after).map(([key,value]) => ({ key, value, column: this.world.ecs[key] })) };
  }

  advance(outcomes) {
    this.server.assertDeathCaptureBoundary();
    if (this.#failed) throw new StoreError('cancelled');
    if (!this.pending) return;
    this.#assertBindings();
    const result = outcomes.find((q) => q.operationId === this.#current?.operationId);
    if (!result) return; // Absence of a reservation is never proof of apply.
    if (result.state !== 'applied') throw new StoreError('effect');
    if (this.#current.profiles.some(p => canonicalText(this.world.profiles.get(p.entity)) !== p.text) ||
        this.#current.columns.some(q => this.world.ecs[q.key] !== q.column || q.column[this.#queue[0].victim.entity] !== q.value)) {
      throw new StoreError('cancelled');
    }
    // Only the applied receipt's validated roles may change. Unreserved later victims remain
    // exact completed-tick baselines throughout the wait, not merely stable entity identities.
    const q = this.#queue[0], changed = new Set([q.victim.entity, ...(q.killer ? [q.killer.entity] : [])]);
    for (const [entity,b] of this.#baselines) if (!changed.has(entity)) this.#assertBaseline(b);
    // PK credit changes only the killer's validated profile. Its ECS and managed ownership
    // cannot drift through a synchronous apply callback, even when it died in an earlier receipt.
    if (q.killer) this.#assertBaseline(this.#baselines.get(q.killer.entity),
      this.#current.lawless);
    for (const entity of changed) {
      const b = this.#baselines.get(entity); this.#baselines.set(entity, this.#baseline(b.binding));
    }
    this.#queue.shift(); this.#current = null;
    if (this.pending) this.#startNext();
    else { this.#tick = null; this.#baselines.clear(); }
  }
  invalidate(clientId, entity) {
    if (!this.#queue.some((q) => [q.victim, q.killer].some((b) => b?.clientId === clientId || b?.entity === entity))) return false;
    this.fail(); return true;
  }
}

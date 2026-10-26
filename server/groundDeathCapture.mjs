// Completed combat deaths share the common world/clock journal and synchronous apply boundary.
import { randomUUID } from 'node:crypto';
import { StoreError } from './store.mjs';
import { canonicalText, pearlKind, profilePearls } from './pearlOperations.mjs';
import { captureDeathPlan } from './deathPlan.mjs';
import { prepareDeathApply } from './deathApply.mjs';
import { deathOperation, checkedDeathResult } from './deathOperation.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { settleGroundProfile } from './groundProfileBaseline.mjs';
import { mulberry32 } from '../src/core/rng.js';
import { C, KIND } from '../src/sim/ecs.js';

const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const columns = (ecs, entity) => Object.entries(ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
  .map(([key, column]) => ({ key, column, value: column[entity] }));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export class GroundDeathCapture {
  #host; #server; #authority; #clock = null; #outcomes = []; #failed = false; #stopping = false;
  constructor(host) {
    this.#host = host; this.#server = host.server; this.#authority = host.groundAuthority;
    this.sessions = host.profiles; this.world = host.server.world; this.limit = 64; this.operations = new Map();
  }
  get failed() { return this.#failed; }
  get ready() { return !this.#failed && !this.#stopping && this.#host.groundPearls?.ready === true; }
  get pending() { return this.operations.size > 0 || this.#host.combatDeaths?.pending === true; }
  status() { return { enabled: true, ready: this.ready, pending: this.pending ? 1 : 0, failed: this.#failed }; }
  #owner() {
    const h = this.#host;
    if (h.groundDeaths !== this || h.server !== this.#server || this.#server.world !== this.world ||
        h.groundAuthority !== this.#authority || this.#server.beforeTick !== this.#authority.boundary ||
        h.profiles !== this.sessions || this.#failed || this.#stopping || h.closing) fail('cancelled');
  }
  #endpoint(raw) {
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'clientId,entity') fail('operation');
    const { clientId, entity } = value, w = this.world, ecs = w.ecs, c = this.#server.clients.get(clientId);
    const s = this.sessions.clients.get(clientId), p = w.profiles.get(entity);
    if (!Number.isSafeInteger(clientId) || clientId < 1 || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
        !c?.serverProfile || c.entity !== entity || !s || s.id !== clientId || this.sessions.accounts.get(s.key) !== s ||
        s.closed || s.failed || s.pearlBusy || !ecs.alive[entity] || ecs.clientId[entity] !== clientId ||
        ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) || p?.pirateId !== `account:${s.key}`) fail('session');
    return { clientId, entity, key: s.key, session: s, client: c, profile: p,
      live: snapshotDropData(p), columns: columns(ecs, entity), name: ecs.names[entity] };
  }
  request(raw) {
    this.#server.assertDeathCaptureBoundary(); this.#owner();
    if (this.operations.size) fail('busy');
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'killer,seq,victim') fail('operation');
    const victim = this.#endpoint(value.victim), killer = value.killer === null ? null : this.#endpoint(value.killer);
    const w = this.world, ecs = w.ecs;
    assertDropContainers(w);
    const all = [victim, ...(killer ? [killer] : [])];
    const baseline = { tick: w.tick, profiles: w.profiles, ledger: w.pearlLedger, drops: w.drops,
      dirty: w.profileDirty, events: w.events, nextDrop: w.nextDrop, rng: w.lootRng, rngState: w.lootRng.state(),
      dropData: snapshotDropData([...w.drops]), ledgerData: snapshotDropData([...w.pearlLedger]), eventData: snapshotDropData(w.events) };
    const assertCurrent = () => {
      this.#owner(); assertDropContainers(w);
      if (w.tick !== baseline.tick || w.ecs !== ecs || w.profiles !== baseline.profiles || w.pearlLedger !== baseline.ledger ||
          w.drops !== baseline.drops || w.profileDirty !== baseline.dirty || w.events !== baseline.events ||
          w.nextDrop !== baseline.nextDrop || w.lootRng !== baseline.rng || w.lootRng.state() !== baseline.rngState ||
          !same(snapshotDropData([...w.drops]), baseline.dropData) || !same(snapshotDropData([...w.pearlLedger]), baseline.ledgerData) ||
          !same(snapshotDropData(w.events), baseline.eventData)) fail('cancelled');
      for (const e of all) {
        const s = e.session;
        if (this.sessions.clients.get(e.clientId) !== s || this.sessions.accounts.get(e.key) !== s ||
            this.#server.clients.get(e.clientId) !== e.client || e.client.entity !== e.entity || !e.client.serverProfile ||
            s.closed || s.failed || w.profiles.get(e.entity) !== e.profile || !same(snapshotDropData(e.profile), e.live) ||
            ecs.names[e.entity] !== e.name || columns(ecs, e.entity).length !== e.columns.length ||
            e.columns.some(q => ecs[q.key] !== q.column || !Object.is(q.column[e.entity], q.value))) fail('cancelled');
      }
    };
    // Map callbacks and the actual gameplay helpers cannot change the captured live instant.
    const plan = captureDeathPlan(w, victim.entity, { seq: value.seq, by: killer?.entity ?? 0 });
    assertCurrent();
    const endpoints = plan.profiles.map(p => all.find(e => e.entity === p.entity));
    if (endpoints.some(e => !e) || new Set(endpoints.map(e => e.key)).size !== endpoints.length) fail('operation');
    this.#clock ??= this.#authority.deadlineClock();
    const clock = this.#clock, grounds = plan.drops.map(d => ({ x: d.x, z: d.z,
      availableAt: clock.at(d.kind === 'pearl' ? d.pickAt : plan.tick),
      [d.kind === 'pearl' ? 'returnAt' : 'expiresAt']: clock.at(d.t) }));
    const applyPlan = freeze({ ...plan, drops: plan.drops.map((d, i) => ({ ...structuredClone(d),
      ...clock.project(grounds[i], d.kind === 'pearl' ? 'pearl' : 'drop') })) });
    const operationId = randomUUID(), ctx = { plan, operationId, request: null, result: null };
    const uids = [...new Set(plan.profiles.flatMap(p => profilePearls(p.before).map(q => q.uid)))];
    const count = plan.drops.filter(d => d.kind !== 'pearl').length;
    this.operations.set(operationId, ctx);
    try {
      ctx.result = this.#authority.stagePreparedFamily({ operationId, family: 'death', lanes: {
        accounts: endpoints.map(e => e.key), uids, drops: Array.from({ length: count }, (_, i) => `${operationId}:${i + 1}`),
      } }, async reservation => {
        for (const e of endpoints) await settleGroundProfile(this.sessions, e,
          plan.profiles.find(p => p.entity === e.entity).before, reservation, assertCurrent);
        const pearls = [];
        for (const [i, d] of plan.drops.entries()) if (d.kind === 'pearl') {
          const row = await this.sessions.store.loadUnique(d.pearl.uid); assertCurrent();
          if (!row || Object.keys(row).sort().join(',') !== 'holder,kind,version' || row.holder !== victim.key ||
              row.kind !== pearlKind(d.pearl.kind) || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= 2147483647) fail('ownership');
          pearls.push({ ...structuredClone(d.pearl), expectedVersion: row.version, ground: grounds[i] });
        }
        ctx.request = freeze(deathOperation({ operationId, world: clock.worldId, victim: victim.key,
          killer: endpoints.find(e => e !== victim)?.key ?? null,
          rules: { lawless: plan.rules.lawless, xpLossFraction: plan.rules.xpLossFraction, xpBefore: plan.ecs.before.xp },
          profiles: plan.profiles.map(p => { const e = endpoints.find(e => e.entity === p.entity);
            return { id: e.key, expectedVersion: e.session.version, before: p.before, data: p.after }; }).sort((a, b) => a.id.localeCompare(b.id)),
          pearls: pearls.sort((a, b) => a.uid < b.uid ? -1 : 1),
          drops: plan.drops.flatMap((d, i) => d.kind === 'pearl' ? [] : [{ kind: d.kind, item: d.item ?? null, ground: grounds[i] }])
            .map((d, i) => ({ ...d, ordinal: i + 1 })),
        }).request);
        assertCurrent(); return structuredClone(ctx.request);
      }, receipt => {
        assertCurrent();
        const checked = checkedDeathResult(receipt, ctx.request, operationId);
        if (!checked.ok || checked.replay) fail('response');
        const meta = endpoints.map(e => {
          const s = e.session, row = ctx.request.profiles.find(p => p.id === e.key);
          if (s.pending || s.running || s.pearlBusy || s.version !== row.expectedVersion || !same(s.confirmed, row.before)) fail('conflict');
          for (const key of ['version', 'confirmed', 'last']) {
            const d = Object.getOwnPropertyDescriptor(s, key);
            if (!d || !Object.hasOwn(d, 'value') || !d.writable) fail('effect');
          }
          return { s, row, version: s.version, confirmed: s.confirmed, last: s.last };
        });
        const rngField = Object.getOwnPropertyDescriptor(w, 'lootRng');
        if (!rngField || !Object.hasOwn(rngField, 'value') || !rngField.writable) fail('effect');
        const allocator = Object.getOwnPropertyDescriptor(w, 'nextDrop');
        if (!allocator || !Object.hasOwn(allocator, 'value') || !allocator.writable) fail('effect');
        for (const key of ['carry', 'last']) {
          const d = Object.getOwnPropertyDescriptor(victim.client, key);
          if (!d || !Object.hasOwn(d, 'value') || !d.writable) fail('effect');
        }
        if (!Object.getOwnPropertyDescriptor(victim.client.queue, 'length')?.writable) fail('effect');
        const effect = prepareDeathApply(w, applyPlan, operationId);
        const inputs = this.#server.prepareDeathInputs(victim.clientId, victim.entity);
        const sources = this.#host.groundPearls.prepareDeathSources(checked, effect.drops);
        const nextRng = mulberry32(plan.lootRng.after);
        try {
          assertCurrent(); inputs.assertCurrent(); effect.apply(); inputs.apply();
          w.lootRng = nextRng;
          for (const m of meta) { m.s.version = m.row.expectedVersion + 1; m.s.confirmed = structuredClone(m.row.data); m.s.last = JSON.stringify(m.row.data); }
          effect.assertApplied(); inputs.assertApplied(); effect.publish(); effect.assertApplied(); inputs.assertApplied();
          sources.apply();
          this.operations.delete(operationId); this.#outcomes.push({ operationId, state: 'applied' });
          return true;
        } catch (error) {
          for (const adapter of [sources, inputs, effect]) {
            try { adapter.rollback(); } catch { /* Finish independent own writes, then fence the host. */ }
          }
          if (w.lootRng === nextRng) w.lootRng = baseline.rng;
          for (const m of meta) { m.s.version = m.version; m.s.confirmed = m.confirmed; m.s.last = m.last; }
          throw error;
        }
      });
      ctx.result.catch(() => { this.#failed = true; this.#host.combatDeaths.fail(); });
      return Object.freeze({ operationId });
    } catch (error) { this.operations.delete(operationId); throw error; }
  }
  assertWaiting() { this.#owner(); this.#host.combatDeaths.assertWaiting(); }
  drain() {
    this.#server.assertDeathCaptureBoundary(); this.#owner();
    this.#host.combatDeaths.advance(this.#outcomes.splice(0));
    return !this.pending;
  }
  stop() { this.#stopping = true; }
  async settle() { await Promise.allSettled([...this.operations.values()].map(ctx => ctx.result)); }
}

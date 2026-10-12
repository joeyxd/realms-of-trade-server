// Explicit common-authority pilot: hydrate current rows, then select receipted pearl transitions.
// Whole-death, ordinary drops and newly rolled pearls each require their additional explicit mount.
import { randomUUID } from 'node:crypto';
import { StoreError } from './store.mjs';
import { GroundCurrentHydration } from './groundCurrentHydration.mjs';
import { prepareGroundPearlPickup } from './groundPearlPickup.mjs';
import { prepareGroundPearlReturn } from './groundPearlReturn.mjs';
import { prepareGroundPearlLeave } from './groundPearlLeave.mjs';
import { prepareGroundPearlGive } from './groundPearlGive.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { managedPearlDrop } from './pearlLifecycle.mjs';
import { managedDeathDrop } from './deathDropLifecycle.mjs';
import { groundOperation, checkedGroundResult, checkedLocation } from './pearlGround.mjs';
import { DROPS } from '../src/data/loot.js';
import { PEARL } from '../src/data/pearls.js';
import { prepareGroundDeathDrop } from './groundDeathDrop.mjs';
import { settleGroundProfile } from './groundProfileBaseline.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { canonicalText, profilePearls, pearlKind } from './pearlOperations.mjs';
import { deathDropOperation, checkedCurrentDeathDrop } from './deathDropOperation.mjs';

const fail = code => { throw new StoreError(code); };
export class GroundPearlLifecycle {
  #host; #server; #world; #authority; #hydration = null; #clock = null; #rows = new Map();
  #task = null; #active = null; #failed = false; #stopping = false; #notified = new Map();
  #dropRows = new Map(); #command;
  constructor(host) {
    this.#host = host; this.#server = host.server; this.#world = host.server.world;
    this.#authority = host.groundAuthority;
    this.#command = (clientId, entity, msg) => this.#handleCommand(clientId, entity, msg);
  }
  get command() { return this.#command; }
  assertOwner() { this.#owner(); }
  get ready() { return !this.#failed && this.#hydration?.status().state === 'applied'; }
  get pending() { return this.#active !== null; }
  status() { return { enabled: true, ready: this.ready, pending: this.pending ? 1 : 0,
    failed: this.#failed, hydration: this.#hydration?.status() ?? null }; }
  #owner() {
    const h = this.#host, w = this.#world;
    if (h.groundPearls !== this || h.server !== this.#server || this.#server.world !== w ||
        h.groundAuthority !== this.#authority || this.#server.beforeTick !== this.#authority.boundary ||
        w.isDeathDropManaged !== managedDeathDrop || this.#server.onPearlCommand !== this.#command) fail('configuration');
  }
  prepare() {
    if (this.#task) return this.#task;
    this.#owner();
    this.#clock = this.#authority.deadlineClock();
    this.#hydration = new GroundCurrentHydration({ host: this.#host, deadlineClock: this.#clock });
    this.#task = this.#hydration.prepare().then(() => {
      this.#owner();
      if (this.#stopping || this.#host.closing) fail('cancelled');
      const counts = this.#hydration.preparedCounts;
      if (!counts || (counts.deathDrops !== 0 && !this.#host.groundDeaths)) {
        this.#hydration.cancel();
        fail('configuration');
      }
      const result = this.#hydration.drain();
      if (result.state !== 'applied') fail('recovery');
      for (const [id, drop] of this.#world.drops) if (managedPearlDrop(drop)) {
        const row = this.#hydration.pearl(id);
        if (!row) fail('ownership');
        const { dropId, ...source } = row;
        this.#rows.set(id, source);
      }
      this.#dropRows = new Map(this.#hydration.deathDrops.map(({ dropId, ...row }) => [dropId, row]));
      return result;
    }).catch(error => { this.#failed = true; throw error; });
    return this.#task;
  }
  #available() {
    this.#owner();
    if (!this.ready || this.#failed || this.#stopping || this.#host.closing) fail('unavailable');
    if (this.pending || !this.#authority.canMutate()) fail('busy');
  }
  #row(dropId) {
    const row = this.#rows.get(dropId);
    if (!row) fail('ownership');
    return structuredClone(row);
  }
  #handleCommand(clientId, entity, raw) {
    this.#owner();
    if (this.#server.clients.get(clientId)?.paused || this.#server.tickBlocked) return false;
    const deny = why => {
      this.#world.emit({ type: 'pearlDenied', to: entity, e: entity, why });
      this.#server.flushEvents(); return false;
    };
    if (raw.op === 'spit') return deny('bound');
    if (raw.op === 'sell') return deny('notForSale');
    // Remaining mutations cannot use the immediate helper inside this incomplete pilot.
    if (!['leave', 'give'].includes(raw.op)) return deny('disabled');
    try {
      const value = snapshotDropData(raw);
      const source = { clientId, entity };
      if (value.op === 'give') {
        if (Object.keys(value).sort().join(',') !== 'op,t,target,type,uid' || typeof value.uid !== 'string' ||
            !Number.isSafeInteger(value.target) || value.target < 1) fail('operation');
        this.give({ source, receiver: { clientId: this.#server.clientOf(value.target), entity: value.target }, uid: value.uid });
      } else {
        if (Object.keys(value).sort().join(',') !== 'op,t,type,uid' || typeof value.uid !== 'string') fail('operation');
        this.leave({ source, uid: value.uid });
      }
      return true;
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      return deny(['combat', 'unknown', 'bound', 'far', 'full'].includes(error.code) ? error.code : 'storage');
    }
  }
  // The socket only selects a UID. Generation and account are resolved under the common reservation.
  leave(raw) {
    this.#server.assertTickIdle(); this.#available();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'source,uid' || typeof value.uid !== 'string') fail('operation');
    const w = this.#world, session = this.#host.profiles.clients.get(value.source?.clientId);
    const pearl = w.profiles.get(value.source?.entity)?.pearls?.bag.find(q => q.uid === value.uid);
    if (!pearl) fail('unknown');
    const create = row => prepareGroundPearlLeave({ host: this.#host, deadlineClock: this.#clock,
      source: value.source, uid: value.uid, row });
    let plan = create({ ...pearl, holder: session?.key, version: 1 });
    const preflight = plan, before = capturePearlProfile(w, value.source.entity),
      endpoint = { session, clientId: value.source.clientId }, operationId = randomUUID();
    const initial = { version: session.version, confirmed: structuredClone(session.confirmed), last: session.last };
    const beforeText = canonicalText(before), nextLast = JSON.stringify(before);
    if (initial.version >= 2147483647 || initial.version === 2147483646 && initial.last !== nextLast) fail('conflict');
    const completion = this.#server.afterTick, fatal = w.deferPlayerDeath, pendingDeath = w.isPlayerDeathPending,
      mint = w.deferPearlMint, deaths = this.#host.groundDeaths, mints = this.#host.groundPearlMints;
    const active = { operationId, result: null };
    this.#active = active;
    const assertCurrent = () => {
      this.#owner();
      if (this.#active !== active || this.#failed || this.#stopping || this.#host.closing || session.pearlBusy) fail('cancelled');
      if (this.#server.afterTick !== completion || w.deferPlayerDeath !== fatal || w.isPlayerDeathPending !== pendingDeath ||
          w.deferPearlMint !== mint || this.#host.groundDeaths !== deaths || this.#host.groundPearlMints !== mints) fail('cancelled');
      preflight.assertBaseline();
      const unchanged = session.version === initial.version && session.last === initial.last &&
        canonicalText(session.confirmed) === canonicalText(initial.confirmed);
      const settled = session.version === initial.version + 1 && session.last === nextLast &&
        canonicalText(session.confirmed) === beforeText;
      if (!unchanged && !settled) fail('conflict');
    };
    try {
      active.result = this.#authority.stagePreparedFamily({ operationId, family: 'ground', lanes: {
        accounts: [session.key], uids: profilePearls(before).map(q => q.uid), drops: [],
      } }, async reservation => {
        await settleGroundProfile(this.#host.profiles, endpoint, before, reservation, assertCurrent);
        assertCurrent();
        const reads = await Promise.allSettled([
          this.#host.store.loadUnique(value.uid), this.#host.store.loadPearlLocation(value.uid),
        ]);
        assertCurrent();
        for (const read of reads) if (read.status === 'rejected') throw read.reason;
        const unique = snapshotDropData(reads[0].value), location = checkedLocation(reads[1].value);
        if (!unique || Object.keys(unique).sort().join(',') !== 'holder,kind,version' ||
            unique.holder !== session.key || unique.kind !== pearlKind(pearl.kind) ||
            !Number.isSafeInteger(unique.version) || unique.version < 1 || unique.version >= 2147483647 ||
            location && (location.world !== this.#host.worldState.id || location.ground !== null ||
              location.version !== unique.version)) fail('ownership');
        plan = create({ ...pearl, holder: unique.holder, version: unique.version });
        return plan.operation;
      }, effect => {
        assertCurrent();
        const oldRows = this.#rows, rows = new Map(oldRows), drop = plan.targetDrop;
        const checked = checkedGroundResult(effect, plan.operation);
        if (!checked.ok || checked.replay || rows.has(drop.id) || this.#dropRows.has(drop.id)) fail('response');
        rows.set(drop.id, { ...pearl, ...structuredClone(checked.location) });
        try {
          this.#rows = rows;
          if (plan.apply(effect) !== true) fail('effect');
        } catch (error) { this.#rows = oldRows; throw error; }
        this.#active = null; return true;
      });
      active.result.catch(() => { this.#failed = true; });
      return Object.freeze({ operationId, result: active.result });
    } catch (error) { this.#active = null; throw error; }
  }
  // Both participants and all captured UIDs share one reservation before any profile or ledger IO.
  give(raw) {
    this.#server.assertTickIdle(); this.#available();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'receiver,source,uid' || typeof value.uid !== 'string') fail('operation');
    const w = this.#world, sessions = this.#host.profiles;
    const sourceSession = sessions.clients.get(value.source?.clientId);
    const pearl = w.profiles.get(value.source?.entity)?.pearls?.bag.find(q => q.uid === value.uid);
    if (!pearl) fail('unknown');
    const create = (row, preflight = false) => prepareGroundPearlGive({ host: this.#host, deadlineClock: this.#clock,
      source: value.source, receiver: value.receiver, uid: value.uid, row, preflight });
    let plan = create({ ...pearl, holder: sourceSession?.key, version: 1 }, true);
    const preflight = plan, operationId = randomUUID();
    const endpoints = [value.source, value.receiver].map(selector => {
      const session = sessions.clients.get(selector.clientId), before = capturePearlProfile(w, selector.entity);
      const initial = { version: session.version, confirmed: structuredClone(session.confirmed), last: session.last,
        maxSettledWrites: session.running ? 2 : 1 };
      const nextLast = JSON.stringify(before);
      const possibleWrites = session.running ? 2 : initial.last !== nextLast ? 1 : 0;
      if (initial.version + possibleWrites >= 2147483647) fail('conflict');
      return { session, clientId: selector.clientId, before, initial, beforeText: canonicalText(before), nextLast, settled: false };
    }).sort((a, b) => a.session.key < b.session.key ? -1 : a.session.key > b.session.key ? 1 : 0);
    const completion = this.#server.afterTick, fatal = w.deferPlayerDeath, pendingDeath = w.isPlayerDeathPending,
      mint = w.deferPearlMint, deaths = this.#host.groundDeaths, mints = this.#host.groundPearlMints;
    const active = { operationId, result: null };
    this.#active = active;
    const assertCurrent = (settling = false) => {
      this.#owner();
      if (this.#active !== active || this.#failed || this.#stopping || this.#host.closing ||
          endpoints.some(endpoint => endpoint.session.pearlBusy)) fail('cancelled');
      if (this.#server.afterTick !== completion || w.deferPlayerDeath !== fatal || w.isPlayerDeathPending !== pendingDeath ||
          w.deferPearlMint !== mint || this.#host.groundDeaths !== deaths || this.#host.groundPearlMints !== mints) fail('cancelled');
      preflight.assertBaseline();
      for (const { session, initial, before, beforeText, nextLast, settled: complete } of endpoints) {
        const unchanged = session.version === initial.version && session.last === initial.last &&
          canonicalText(session.confirmed) === canonicalText(initial.confirmed);
        const settled = session.version > initial.version && session.version <= initial.version + initial.maxSettledWrites && session.last === nextLast &&
          canonicalText(session.confirmed) === beforeText;
        // An autosave already in flight can finish for the other account while this one settles.
        // It may only advance the bounded save counter and retain exactly the captured UID set.
        const priorSave = settling && !complete && session.version > initial.version &&
          session.version <= initial.version + initial.maxSettledWrites && session.last === JSON.stringify(session.confirmed) &&
          canonicalText(profilePearls(session.confirmed)) === canonicalText(profilePearls(before));
        if (!unchanged && !settled && !priorSave) fail('conflict');
      }
    };
    try {
      active.result = this.#authority.stagePreparedFamily({ operationId, family: 'ground', lanes: {
        accounts: endpoints.map(endpoint => endpoint.session.key),
        uids: endpoints.flatMap(endpoint => profilePearls(endpoint.before).map(q => q.uid)), drops: [],
      } }, async reservation => {
        for (const endpoint of endpoints) {
          await settleGroundProfile(sessions, endpoint, endpoint.before, reservation, () => assertCurrent(true));
          endpoint.settled = true;
        }
        assertCurrent();
        const reads = await Promise.allSettled([
          this.#host.store.loadUnique(value.uid), this.#host.store.loadPearlLocation(value.uid),
        ]);
        assertCurrent();
        for (const read of reads) if (read.status === 'rejected') throw read.reason;
        const unique = snapshotDropData(reads[0].value), location = checkedLocation(reads[1].value);
        if (!unique || Object.keys(unique).sort().join(',') !== 'holder,kind,version' ||
            unique.holder !== sourceSession.key || unique.kind !== pearlKind(pearl.kind) ||
            !Number.isSafeInteger(unique.version) || unique.version < 1 || unique.version >= 2147483647 ||
            location && (location.world !== this.#host.worldState.id || location.ground !== null ||
              location.version !== unique.version)) fail('ownership');
        plan = create({ ...pearl, holder: unique.holder, version: unique.version });
        return plan.operation;
      }, effect => {
        assertCurrent();
        if (plan.apply(effect) !== true) fail('effect');
        this.#active = null; return true;
      });
      active.result.catch(() => { this.#failed = true; });
      return Object.freeze({ operationId, result: active.result });
    } catch (error) { this.#active = null; throw error; }
  }
  pickup(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId,receiver') fail('operation');
    return this.#pickup(value);
  }
  #pickup({ dropId, receiver }) {
    this.#available();
    const plan = prepareGroundPearlPickup({ host: this.#host, deadlineClock: this.#clock,
      dropId, receiver, row: this.#row(dropId) });
    return this.#stage(dropId, plan, null);
  }
  return(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId') fail('operation');
    return this.#return(value.dropId);
  }
  #return(dropId) {
    this.#available();
    const plan = prepareGroundPearlReturn({ world: this.#world, deadlineClock: this.#clock,
      dropId, row: this.#row(dropId) });
    return this.#stage(dropId, plan, plan.targetDrop.id);
  }
  // The mint source index is installed in the same reversible synchronous boundary as its drop.
  prepareMintSource(receipt, rawDrop) {
    this.#server.assertDropApplyBoundary(); this.#owner();
    if (!this.#host.groundPearlMints || !this.ready || this.pending || this.#stopping || this.#host.closing) fail('configuration');
    const drop = snapshotDropData(rawDrop), ground = this.#clock.assertDrop(drop, 'pearl');
    const operation = { ...drop.pearl, from: null, to: null, expectedVersion: 0,
      world: this.#host.worldState.id, ground, profiles: [] };
    const checked = checkedGroundResult(receipt, operation);
    if (!checked.ok || checked.replay || this.#rows.has(drop.id) || this.#dropRows.has(drop.id)) fail('response');
    const oldRows = this.#rows, rows = new Map(oldRows);
    rows.set(drop.id, { ...drop.pearl, ...structuredClone(checked.location) });
    let installed = false;
    return { apply: () => {
      if (installed || this.#rows !== oldRows) fail('cancelled');
      this.#rows = rows; installed = true;
    }, rollback: () => {
      if (installed) { this.#rows = oldRows; installed = false; }
    } };
  }
  // Source installation is paired reversibly with a checked death's synchronous ECS apply.
  prepareDeathSources(receipt, drops) {
    this.#server.assertDropApplyBoundary(); this.#owner();
    if (!this.#host.groundDeaths || !this.ready || this.pending || this.#stopping || this.#host.closing) fail('configuration');
    const oldPearls = this.#rows, oldDrops = this.#dropRows;
    const pearls = new Map(oldPearls), ordinary = new Map(oldDrops);
    for (const drop of drops) {
      if (pearls.has(drop.id) || ordinary.has(drop.id)) fail('ownership');
      if (drop.kind === 'pearl') {
        const location = receipt.locations.find(r => r.uid === drop.pearl.uid);
        if (!location) fail('response');
        this.#clock.assertDrop(drop, 'pearl', location.ground);
        pearls.set(drop.id, { uid: drop.pearl.uid, kind: drop.pearl.kind, ...structuredClone(location) });
      } else {
        const creation = receipt.drops.find(r => r.operationId === drop.operationId && r.ordinal === drop.ordinal);
        if (!creation) fail('response');
        this.#clock.assertDrop(drop, 'drop', creation.ground);
        ordinary.set(drop.id, checkedCurrentDeathDrop({ ...structuredClone(creation), state: 'ground',
          version: 1, holder: null, transitionOperationId: null }));
      }
    }
    let installed = false;
    return { apply: () => {
      if (this.#rows !== oldPearls || this.#dropRows !== oldDrops || installed) fail('cancelled');
      this.#rows = pearls; this.#dropRows = ordinary; installed = true;
    }, rollback: () => {
      if (installed) { this.#rows = oldPearls; this.#dropRows = oldDrops; installed = false; }
    } };
  }
  pickupDrop(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId,receiver') fail('operation');
    return this.#drop(value.dropId, 'pickup', value.receiver);
  }
  expireDrop(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId') fail('operation');
    return this.#drop(value.dropId, 'expire', null);
  }
  #drop(dropId, mode, receiver) {
    this.#available();
    if (!this.#host.groundDeaths) fail('configuration');
    const row = this.#dropRows.get(dropId);
    if (!row) fail('ownership');
    const create = () => prepareGroundDeathDrop({ host: this.#host, deadlineClock: this.#clock, dropId, mode,
      receiver, row: structuredClone(row) });
    let plan = create();
    const operationId = randomUUID(), active = { operationId, result: null };
    const apply = effect => {
      this.#owner();
      if (this.#failed || this.#stopping || this.#host.closing || this.#active !== active) fail('cancelled');
      if (plan.apply(effect, operationId) !== true) fail('effect');
      this.#dropRows.delete(dropId); this.#active = null; return true;
    };
    this.#active = active;
    try {
      if (mode === 'expire') active.result = this.#authority.stageFamily({ operationId, family: 'drop',
        operation: deathDropOperation({ ...plan.operation, operationId }).request }, apply);
      else {
        const before = structuredClone(plan.operation.profile.before), w = this.#world;
        const session = this.#host.profiles.clients.get(receiver.clientId), profile = w.profiles.get(receiver.entity);
        const live = snapshotDropData(profile), tick = w.tick, source = snapshotDropData(w.drops.get(dropId));
        const client = this.#server.clients.get(receiver.clientId), ecs = w.ecs, names = ecs.names, name = names[receiver.entity];
        const columns = Object.entries(ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
          .map(([key, column]) => ({ key, column, value: column[receiver.entity] }));
        const state = { drops: w.drops, profiles: w.profiles, ledger: w.pearlLedger, events: w.events,
          dirty: w.profileDirty, nextDrop: w.nextDrop, rng: w.lootRng, rngState: w.lootRng.state(),
          dropData: snapshotDropData([...w.drops]), ledgerData: snapshotDropData([...w.pearlLedger]),
          eventData: snapshotDropData(w.events), dirtyData: [...w.profileDirty] };
        const endpoint = { session, clientId: receiver.clientId };
        const assertCurrent = () => {
          this.#owner();
          assertDropContainers(w);
          if (this.#active !== active || this.#failed || this.#stopping || this.#host.closing || w.tick !== tick ||
              this.#host.profiles.clients.get(receiver.clientId) !== session || session.closed || session.failed ||
              this.#host.profiles.accounts.get(session.key) !== session || this.#server.clients.get(receiver.clientId) !== client ||
              client.entity !== receiver.entity || !client.serverProfile || w.ecs !== ecs || ecs.names !== names || names[receiver.entity] !== name ||
              columns.some(q => ecs[q.key] !== q.column || !Object.is(q.column[receiver.entity], q.value)) ||
              w.drops !== state.drops || w.profiles !== state.profiles || w.pearlLedger !== state.ledger ||
              w.events !== state.events || w.profileDirty !== state.dirty || w.nextDrop !== state.nextDrop ||
              w.lootRng !== state.rng || w.lootRng.state() !== state.rngState ||
              canonicalText(snapshotDropData([...w.drops])) !== canonicalText(state.dropData) ||
              canonicalText(snapshotDropData([...w.pearlLedger])) !== canonicalText(state.ledgerData) ||
              canonicalText(snapshotDropData(w.events)) !== canonicalText(state.eventData) ||
              canonicalText([...w.profileDirty]) !== canonicalText(state.dirtyData) ||
              w.profiles.get(receiver.entity) !== profile || canonicalText(snapshotDropData(profile)) !== canonicalText(live) ||
              canonicalText(capturePearlProfile(w, receiver.entity)) !== canonicalText(before) ||
              canonicalText(snapshotDropData(w.drops.get(dropId))) !== canonicalText(source)) fail('cancelled');
        };
        active.result = this.#authority.stagePreparedFamily({ operationId, family: 'drop', lanes: {
          accounts: [session.key], uids: profilePearls(before).map(q => q.uid), drops: [`${row.operationId}:${row.ordinal}`],
        } }, async reservation => {
          await settleGroundProfile(this.#host.profiles, endpoint, before, reservation, assertCurrent);
          assertCurrent(); plan = create(); return plan.operation;
        }, apply);
      }
      active.result.catch(() => { this.#failed = true; });
      return Object.freeze({ operationId, result: active.result });
    } catch (error) { this.#active = null; throw error; }
  }
  #stage(dropId, plan, nextDropId) {
    const operationId = randomUUID();
    const operation = groundOperation({ ...plan.operation, operationId }).request;
    const active = { operationId, result: null };
    this.#active = active;
    try {
      const result = this.#authority.stageFamily({ operationId, family: 'ground', operation }, effect => {
        this.#owner();
        if (this.#failed || this.#stopping || this.#host.closing || this.#active !== active) fail('cancelled');
        if (plan.apply(effect) !== true) fail('effect');
        this.#rows.delete(dropId); this.#notified.delete(dropId);
        if (nextDropId !== null) this.#rows.set(nextDropId, { uid: operation.uid, kind: operation.kind,
          world: operation.world, ground: structuredClone(effect.location.ground), version: effect.location.version });
        this.#active = null;
        return true;
      });
      active.result = result;
      // Observe rejection without resolving the caller early or applying any gameplay here.
      result.catch(() => { this.#failed = true; });
      return Object.freeze({ operationId, result });
    } catch (error) { this.#active = null; throw error; }
  }
  drain() {
    this.#server.assertDropApplyBoundary();
    this.#owner();
    if (!this.ready || this.#stopping || this.#host.closing || this.#failed) return false;
    if (this.pending) return false;
    if (!this.#authority.canMutate() || this.#world.tick % 3) return true;
    if (this.#host.pendingJoins || this.#host.profiles.tasks.size ||
        [...this.#host.profiles.accounts.values()].some(s => s.pending || s.running)) return true;
    const w = this.#world, ecs = w.ecs;
    assertDropContainers(w);
    for (const id of this.#notified.keys()) if (!w.drops.has(id)) this.#notified.delete(id);
    for (const [dropId, raw] of w.drops) {
      if (!managedPearlDrop(raw) && managedDeathDrop(raw)) {
        if (!this.#host.groundDeaths) fail('configuration');
        const drop = snapshotDropData(raw), ground = this.#clock.assertDrop(drop, 'drop'), at = this.#clock.at(w.tick);
        if (at > ground.expiresAt) { this.#server.holdDropPublication(); this.#drop(dropId, 'expire', null); return false; }
        if (at < ground.availableAt) continue;
        for (const entity of w.profiles.keys()) {
          if (!ecs.alive[entity] || ecs.dead[entity] > 0 ||
              Math.hypot(ecs.x[entity] - drop.x, ecs.z[entity] - drop.z) > DROPS.pickR) continue;
          const p = w.profiles.get(entity);
          if (drop.kind === 'item' ? p.bag.length >= 24 : p.pot >= 5) continue;
          const clientId = this.#server.clientOf(entity);
          this.#server.holdDropPublication(); this.#drop(dropId, 'pickup', { clientId, entity }); return false;
        }
        continue;
      }
      if (!managedPearlDrop(raw)) continue;
      const drop = snapshotDropData(raw), ground = this.#clock.assertDrop(drop, 'pearl'), at = this.#clock.at(w.tick);
      if (at > ground.returnAt) {
        this.#server.holdDropPublication(); this.#return(dropId); return false;
      }
      if (at < ground.availableAt) continue;
      for (const entity of w.profiles.keys()) {
        if (!ecs.alive[entity] || ecs.dead[entity] > 0 ||
            Math.hypot(ecs.x[entity] - drop.x, ecs.z[entity] - drop.z) > DROPS.pickR) continue;
        const clientId = this.#server.clientOf(entity), session = this.#host.profiles.clients.get(clientId);
        if (!session) fail('session');
        if (w.profiles.get(entity).pearls.bag.length >= PEARL.bag) {
          let told = this.#notified.get(dropId);
          if (!told) this.#notified.set(dropId, told = new Set());
          if (!told.has(session.key)) {
            told.add(session.key); w.emit({ type: 'pearlDenied', to: entity, e: entity, why: 'full' });
          }
          continue;
        }
        this.#server.holdDropPublication(); this.#pickup({ dropId, receiver: { clientId, entity } }); return false;
      }
    }
    return true;
  }
  invalidate() { if (!this.pending) return false; this.#failed = true; return true; }
  stop() { this.#stopping = true; this.#hydration?.cancel(); }
  async settle() {
    if (this.#task) await this.#task.catch(() => {});
    if (this.#active?.result) await this.#active.result.catch(() => {});
  }
}

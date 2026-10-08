// Detached whole-death effects. The coordinator authorizes storage/identity first; this object only
// owns reversible synchronous world writes. It never dispatches storage or rewinds the live RNG.
import { types } from 'node:util';
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
export function prepareDeathApply(world, plan, operationId) {
  const { profiles, pearlLedger, drops, profileDirty, events, ecs } = world;
  const first = world.nextDrop, count = plan.drops.length;
  if (!(profiles instanceof Map) || !(pearlLedger instanceof Map) || !(drops instanceof Map) ||
      !(profileDirty instanceof Set) || !Array.isArray(events) || !Number.isSafeInteger(first) ||
      first < 1 || !Number.isSafeInteger(first + count) || first + count > Number.MAX_SAFE_INTEGER) {
    throw new StoreError('effect');
  }
  // These host containers must be ordinary mutable collections. Reject proxies/subclasses and
  // overridden mutators; native writes cannot invoke a caller's nested gameplay callback.
  for (const container of [profiles, pearlLedger, drops, profileDirty, events]) {
    const expected = container === events ? Array.prototype : container === profileDirty ? Set.prototype : Map.prototype;
    const methods = expected === Array.prototype ? ['push','splice'] : expected === Set.prototype ? ['add','delete','has'] : ['set','get','has','delete'];
    if (types.isProxy(container) || Object.getPrototypeOf(container) !== expected ||
        methods.some((key) => Object.hasOwn(container,key)) || !Object.isExtensible(container)) throw new StoreError('effect');
  }
  if (!Object.getOwnPropertyDescriptor(events,'length')?.writable) throw new StoreError('effect');
  const ids = new Map(), inserted = [];
  let ordinal = 0;
  for (const [i, planned] of plan.drops.entries()) {
    const id = first + i;
    if (drops.has(id) || ids.has(planned.id)) throw new StoreError('busy');
    ids.set(planned.id, id);
    const drop = { ...clone(planned), id };
    if (drop.kind === 'item' || drop.kind === 'potion') Object.assign(drop, { operationId, ordinal: ++ordinal });
    inserted.push(drop);
  }
  const dropTexts = inserted.map((d) => canonicalText(d));
  const writes = plan.profiles.map((p) => {
    const profile = profiles.get(p.entity);
    if (!profile) throw new StoreError('session');
    if (types.isProxy(profile)) throw new StoreError('effect');
    for (const key of Object.keys(p.after)) if (!same(profile[key], p.after[key])) {
      const descriptor = Object.getOwnPropertyDescriptor(profile,key);
      if (!descriptor || !Object.hasOwn(descriptor,'value') || !descriptor.writable) throw new StoreError('effect');
    }
    return { entity: p.entity, profile, beforeText: canonicalText(profile), after: clone(p.after),
      fields: Object.keys(p.after).filter((key) => !same(profile[key], p.after[key]))
        .map((key) => ({ key, before: profile[key], after: clone(p.after[key]) })),
      dirty: profileDirty.has(p.entity) };
  });
  const ledgers = plan.ledgers.map(({ uid, data }) => {
    if (!ids.has(data.drop)) throw new StoreError('effect');
    return { uid, before: pearlLedger.get(uid), after: { ...clone(data), drop: ids.get(data.drop) } };
  });
  const ledgerTexts = ledgers.map((q) => canonicalText(q.after));
  const columns = Object.entries(plan.ecs.before).map(([key, value]) => {
    const column = ecs[key];
    if (!ArrayBuffer.isView(column) || column instanceof DataView || column[plan.entity] !== value) throw new StoreError('effect');
    return { key, column, before: value, after: plan.ecs.after[key] };
  });
  const publication = plan.events.map((event) => {
    const next = clone(event);
    if (next.type === 'loot') for (const drop of next.drops) {
      if (!ids.has(drop.id)) throw new StoreError('effect');
      drop.id = ids.get(drop.id);
    }
    return next;
  });
  const eventTexts = publication.map((e) => canonicalText(e));
  if (events.length + publication.length > 4294967295) throw new StoreError('effect');
  let started = false, published = 0;
  const eventStart = events.length;
  const containers = () => world.profiles === profiles && world.pearlLedger === pearlLedger &&
    world.drops === drops && world.profileDirty === profileDirty && world.events === events && world.ecs === ecs;
  return {
    drops: inserted,
    assertCurrent() {
      if (!containers() || world.nextDrop !== first || events.length !== eventStart ||
          writes.some((p) => profiles.get(p.entity) !== p.profile || canonicalText(p.profile) !== p.beforeText) ||
          columns.some((q) => ecs[q.key] !== q.column || q.column[plan.entity] !== q.before) ||
          ledgers.some((q) => pearlLedger.get(q.uid) !== q.before) || inserted.some((q) => drops.has(q.id))) throw new StoreError('cancelled');
    },
    apply() {
      this.assertCurrent(); started = true;
      for (const p of writes) {
        for (const q of p.fields) p.profile[q.key] = q.after;
        Set.prototype.add.call(profileDirty,p.entity);
      }
      for (const q of columns) if (q.before !== q.after) q.column[plan.entity] = q.after;
      for (const q of ledgers) Map.prototype.set.call(pearlLedger,q.uid,q.after);
      for (const q of inserted) Map.prototype.set.call(drops,q.id,q);
      world.nextDrop = first + count;
    },
    assertApplied() {
      if (!containers() || world.nextDrop !== first + count ||
          writes.some((p) => profiles.get(p.entity) !== p.profile || !same(p.profile, p.after) || !profileDirty.has(p.entity)) ||
          columns.some((q) => ecs[q.key] !== q.column || q.column[plan.entity] !== q.after) ||
          ledgers.some((q,i) => pearlLedger.get(q.uid) !== q.after || canonicalText(q.after) !== ledgerTexts[i]) ||
          inserted.some((q,i) => drops.get(q.id) !== q || canonicalText(q) !== dropTexts[i]) ||
          events.length !== eventStart + published || publication.slice(0,published).some((e,i) =>
            events[eventStart+i] !== e || canonicalText(e) !== eventTexts[i])) throw new StoreError('effect');
    },
    publish() {
      this.assertApplied();
      // Capture helpers already decorated these events against their post-death ECS draft.
      // Avoid calling arbitrary live emit callbacks after any tentative mutation.
      for (const event of publication) { Array.prototype.push.call(events,event); published++; }
    },
    rollback() {
      if (!started) return;
      // Remove only our appended events/insertions, preserving unrelated callback side effects.
      for (let i = published - 1; i >= 0; i--) if (events[eventStart + i] === publication[i]) Array.prototype.splice.call(events,eventStart + i,1);
      for (const q of inserted) if (drops.get(q.id) === q) Map.prototype.delete.call(drops, q.id);
      if (world.nextDrop === first + count) world.nextDrop = first;
      for (const q of ledgers) if (pearlLedger.get(q.uid) === q.after) Map.prototype.set.call(pearlLedger,q.uid,q.before);
      for (const q of columns) if (q.before !== q.after && q.column[plan.entity] === q.after) q.column[plan.entity] = q.before;
      for (const p of writes) {
        for (const q of p.fields) if (p.profile[q.key] === q.after) p.profile[q.key] = q.before;
        if (!p.dirty) Set.prototype.delete.call(profileDirty, p.entity);
      }
      started = false;
    },
  };
}

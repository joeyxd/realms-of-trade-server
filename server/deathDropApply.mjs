// Reversible synchronous projection of one receipted ordinary death-drop transition.
// No IO, callbacks, RNG, clock choice or historical replay belongs in this effect.
import { types } from 'node:util';
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';

const same = (a, b) => canonicalText(a) === canonicalText(b);
export function snapshotDropData(raw, depth = 0) {
  if (depth > 64) throw new StoreError('effect');
  if (raw === null || ['string','boolean'].includes(typeof raw)) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (!raw || typeof raw !== 'object' || types.isProxy(raw)) throw new StoreError('effect');
  const array = Array.isArray(raw), expected = array ? Array.prototype : Object.prototype;
  if (Object.getPrototypeOf(raw) !== expected && (array || Object.getPrototypeOf(raw) !== null)) throw new StoreError('effect');
  const fields = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(fields);
  if (array && keys.length !== raw.length + 1) throw new StoreError('effect');
  const out = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    const d = fields[key];
    if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d,'value') ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= raw.length))) throw new StoreError('effect');
    Object.defineProperty(out,key,{value:snapshotDropData(d.value,depth+1),enumerable:true,writable:true,configurable:true});
  }
  return out;
}
export function assertDropContainers(world) {
  if (types.isProxy(world) || types.isProxy(world.ecs)) throw new StoreError('effect');
  for (const [key, proto, methods] of [
    ['profiles',Map.prototype,['get','set','has','delete','entries','keys','values',Symbol.iterator]], ['pearlLedger',Map.prototype,['get','set','has','delete','entries','keys','values',Symbol.iterator]],
    ['drops',Map.prototype,['get','set','has','delete','entries','keys','values',Symbol.iterator]], ['profileDirty',Set.prototype,['has','add','delete','entries','keys','values',Symbol.iterator]],
    ['events',Array.prototype,['push','splice']],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(world,key), value = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor,'value') || !value || types.isProxy(value) ||
        Object.getPrototypeOf(value) !== proto || methods.some(m=>Object.hasOwn(value,m)) || !Object.isExtensible(value)) throw new StoreError('effect');
  }
  if (!Object.getOwnPropertyDescriptor(world.events,'length')?.writable) throw new StoreError('effect');
}
export function prepareDeathDropApply(world, plan) {
  assertDropContainers(world);
  const { profiles, drops, events, profileDirty, ecs } = world, { drop, dropId, endpoint, before, after } = plan;
  const dropText = canonicalText(snapshotDropData(drop)), start = events.length;
  const profile = endpoint ? profiles.get(endpoint.entity) : null;
  if (endpoint && (profile !== endpoint.profile || !same(snapshotDropData(profile), plan.liveBefore))) throw new StoreError('cancelled');
  const fields = profile ? Object.keys(after).filter(k=>!same(profile[k],after[k])).map(key=>{
    const d = Object.getOwnPropertyDescriptor(profile,key);
    if (!d || !Object.hasOwn(d,'value') || !d.writable) throw new StoreError('effect');
    return {key,before:d.value,after:structuredClone(after[key])};
  }) : [];
  const pot = endpoint ? ecs.potions : null, potBefore = endpoint ? pot[endpoint.entity] : null;
  const dirty = endpoint ? profileDirty.has(endpoint.entity) : false;
  const publication = [];
  if (endpoint) {
    const ev = {type:'pickup',to:endpoint.entity,e:endpoint.entity,id:dropId,kind:drop.kind,x:drop.x,z:drop.z,
      gold:after.gold,pot:after.pot,pub:1,elem:ecs.elem[endpoint.entity]};
    if (drop.kind === 'item') ev.item = structuredClone(after.bag.at(-1));
    if (plan.victim === endpoint.key) ev.back = 1;
    publication.push(ev);
  }
  publication.push({type:'unloot',pub:1,ids:[dropId],why:endpoint?'pick':'expire',...(endpoint?{by:endpoint.entity}:{})});
  if (start + publication.length > 4294967295) throw new StoreError('effect');
  const eventTexts = publication.map(e=>canonicalText(e));
  let started = false, published = 0;
  const containers = () => world.profiles===profiles && world.drops===drops && world.events===events && world.profileDirty===profileDirty && world.ecs===ecs;
  return {
    assertCurrent() {
      if (!containers() || drops.get(dropId)!==drop || canonicalText(snapshotDropData(drop))!==dropText || events.length!==start ||
          (endpoint && (profiles.get(endpoint.entity)!==profile || !same(profile,plan.liveBefore) || ecs.potions!==pot || pot[endpoint.entity]!==potBefore))) throw new StoreError('cancelled');
    },
    apply() {
      this.assertCurrent(); started=true;
      if (endpoint) {
        for (const q of fields) profile[q.key]=q.after;
        pot[endpoint.entity]=after.pot;
        Set.prototype.add.call(profileDirty,endpoint.entity);
      }
      Map.prototype.delete.call(drops,dropId);
    },
    assertApplied() {
      if (!containers() || drops.has(dropId) || (endpoint && (profiles.get(endpoint.entity)!==profile || !same(profile,after) ||
          ecs.potions!==pot || pot[endpoint.entity]!==after.pot || !profileDirty.has(endpoint.entity))) ||
          events.length!==start+published || publication.slice(0,published).some((e,i)=>events[start+i]!==e || canonicalText(e)!==eventTexts[i])) throw new StoreError('effect');
    },
    publish() { this.assertApplied(); for (const event of publication) { Array.prototype.push.call(events,event); published++; } },
    rollback() {
      if (!started) return;
      for (let i=published-1;i>=0;i--) if (events[start+i]===publication[i]) Array.prototype.splice.call(events,start+i,1);
      if (!drops.has(dropId)) Map.prototype.set.call(drops,dropId,drop);
      if (endpoint) {
        for (const q of fields) if (profile[q.key]===q.after) profile[q.key]=q.before;
        if (pot[endpoint.entity]===after.pot) pot[endpoint.entity]=potBefore;
        if (!dirty) Set.prototype.delete.call(profileDirty,endpoint.entity);
      }
      started=false;
    },
  };
}

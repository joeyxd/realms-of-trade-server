// Explicit projection of durable ground deadlines into one stopped local session. The marker is
// local provenance, not a stored domain certificate, lease, offline policy or clock checkpoint.
import { types } from 'node:util';
import { StoreError } from './store.mjs';
import { GroundClockEpoch } from './groundClockSession.mjs';
import { groundKey, groundData } from './pearlGround.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';

const DOMAIN = 'durable-ground-v1';
const same = (a,b) => canonicalText(a) === canonicalText(b);
const fail = () => { throw new StoreError('operation'); };
function data(raw) { try { return snapshotDropData(raw); } catch { fail(); } }
function ground(raw, family) {
  const value = data(raw);
  if (family === 'pearl') return groundData(value);
  if (family !== 'drop' || !value || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'availableAt,expiresAt,x,z') fail();
  const checked = groundData({x:value.x,z:value.z,availableAt:value.availableAt,returnAt:value.expiresAt});
  return {x:checked.x,z:checked.z,availableAt:checked.availableAt,expiresAt:checked.returnAt};
}
export function assertGroundDeadlineClock(clock, worldId) {
  try {
    if (!clock || types.isProxy(clock) || Object.getPrototypeOf(clock) !== GroundDeadlineClock.prototype ||
        Object.getOwnPropertyDescriptor(GroundDeadlineClock.prototype,'worldId').get.call(clock) !== worldId) fail();
  } catch { throw new StoreError('configuration'); }
  return clock;
}
export class GroundDeadlineClock {
  #epoch; #world;
  constructor(input) {
    if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) fail();
    const fields = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(fields);
    if (keys.length !== 3 || keys.some(k => typeof k !== 'string' ||
        !['worldId','sourceDomain','epoch'].includes(k) || !fields[k].enumerable || !Object.hasOwn(fields[k],'value'))) fail();
    const epoch = fields.epoch.value;
    if (fields.sourceDomain.value !== DOMAIN || !epoch || types.isProxy(epoch) ||
        Object.getPrototypeOf(epoch) !== GroundClockEpoch.prototype) fail();
    // Calling the genuine prototype checks private state; forged instances cannot supply an anchor.
    let anchor;
    try { anchor = Object.getOwnPropertyDescriptor(GroundClockEpoch.prototype,'anchor').get.call(epoch); } catch { fail(); }
    this.#epoch = new GroundClockEpoch(anchor); this.#world = groundKey(fields.worldId.value);
    Object.freeze(this);
  }
  get worldId() { return this.#world; }
  get anchor() { return this.#epoch.anchor; }
  at(localTick) { return this.#epoch.toDurable(localTick); }
  project(raw, family) {
    const source = ground(raw,family);
    return {pickAt:this.#epoch.toLocal(source.availableAt),
      t:this.#epoch.toLocal(family === 'pearl' ? source.returnAt : source.expiresAt),
      groundClock:{domain:DOMAIN,world:this.#world,anchor:this.anchor,ground:source}};
  }
  assertDrop(raw, family, expected = null) {
    const drop = data(raw), marker = drop?.groundClock;
    if (!marker || Array.isArray(marker) || Object.keys(marker).sort().join(',') !== 'anchor,domain,ground,world' ||
        marker.domain !== DOMAIN || marker.world !== this.#world || !same(marker.anchor,this.anchor)) fail();
    const source = ground(marker.ground,family), projection = this.project(source,family);
    if (drop.x !== source.x || drop.z !== source.z || drop.pickAt !== projection.pickAt || drop.t !== projection.t ||
        !same(marker,projection.groundClock) || (expected !== null && !same(source,ground(expected,family)))) fail();
    return source;
  }
}

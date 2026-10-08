import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { PearlGroundHydration } from '../server/pearlGroundHydration.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { GameHost } from '../server/host.mjs';
import { World } from '../src/sim/world.js';
import { installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { map } from './helpers.mjs';
import { seedDeathDropScenario, pickupRequest, WORLD, KILLER } from './helpers/death-drop-storage.mjs';
const clock = g => ({availableAt:g.availableAt,returnAt:g.returnAt});
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(wrap = s => s) {
  const base=createMemoryStore(), source=await seedDeathDropScenario(base);
  const journal=createMemoryPearlJournals(base)(WORLD), sessions=new ProfileSessions(wrap(base),()=>{}, {journal});
  await sessions.recoverPearls();
  const world=new World(42,{map,server:true});installInventory(world,WORLD);world.tick=100;world.events.length=0;
  const hydrate=opts=>new PearlGroundHydration({sessions,world,worldId:WORLD,mapClock:clock,deathDrops:true,...opts});
  return {base,source,journal,sessions,world,hydrate};
}
function blocked(f) {assert.throws(()=>pearlMutationGate(f.sessions).assertWorldAvailable(),{code:'busy'});}

test('ordinary hydration is opt-in and validates its store capabilities',async()=>{
  const f=await fixture();
  for(const deathDrops of [null,1,{},'true']) assert.throws(()=>f.hydrate({deathDrops}),{code:'configuration'});
  for(const key of ['listCurrentDeathDrops','loadDeathDrop','loadDeathOperation']) {
    const store={...f.base,[key]:undefined}, sessions=new ProfileSessions(store,()=>{}, {journal:f.journal});
    assert.throws(()=>new PearlGroundHydration({sessions,world:f.world,worldId:WORLD,mapClock:clock,deathDrops:true}),{code:'configuration'});
  }
  let reads=0;
  f.sessions.store.listCurrentDeathDrops=async()=>{reads++;throw Error('must not read');};
  const h=f.hydrate({deathDrops:false});await h.start();h.drain();assert.equal(reads,0);
});

test('a rejected current-row read settles the concurrent death-receipt read before fencing',async()=>{
  const entered=deferred(),release=deferred();
  const f=await fixture(s=>({...s,async loadDeathDrop(){throw Error('read failed');},async loadDeathOperation(id){entered.resolve();await release.promise;return s.loadDeathOperation(id);}}));
  const h=f.hydrate(),work=h.start();await entered.promise;let ended=false;work.then(()=>ended=true,()=>ended=true);
  await new Promise(setImmediate);assert.equal(ended,false);blocked(f);assert.equal(f.world.drops.size,0);
  release.resolve();await assert.rejects(work,{code:'unavailable'});assert.equal(h.state,'fenced');blocked(f);
});

for(const [name,corrupt] of [
  ['null current row',()=>null],
  ['terminal current row',r=>({...r,state:'expired',version:2,transitionOperationId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})],
  ['different current ordinal',r=>({...r,ordinal:r.ordinal+1})],
]) test(name+' cannot hydrate from an earlier list page',async()=>{
  const f=await fixture(s=>({...s,async loadDeathDrop(...a){return corrupt(await s.loadDeathDrop(...a));}})),h=f.hydrate();
  await assert.rejects(h.start());assert.equal(h.state,'fenced');assert.equal(f.world.drops.size,0);blocked(f);
});

for(const [name,transform] of [
  ['page getter',rows=>{Object.defineProperty(rows[0],'world',{enumerable:true,get(){throw Error('getter executed');}});return rows;}],
  ['page Proxy',rows=>new Proxy(rows,{ownKeys(){throw Error('trap executed');}})],
  ['page symbol',rows=>{rows[0][Symbol('hidden')]=1;return rows;}],
]) test(name+' is rejected as data without executing it',async()=>{
  let invoked=0;
  const f=await fixture(s=>({...s,async listCurrentDeathDrops(...a){const rows=await s.listCurrentDeathDrops(...a);if(!rows.length)return rows;
    if(name==='page getter')Object.defineProperty(rows[0],'world',{enumerable:true,get(){invoked++;return WORLD;}});
    else if(name==='page Proxy')return new Proxy(rows,{ownKeys(){invoked++;return [];}});
    else return transform(rows);return rows;}})),h=f.hydrate();
  await assert.rejects(h.start());assert.equal(invoked,0);assert.equal(h.state,'fenced');blocked(f);
});

test('existing source getter is rejected before recovery or page IO',async()=>{
  const f=await fixture();let invoked=0;
  const drop={id:80,to:0,kind:'item'};Object.defineProperty(drop,'operationId',{enumerable:true,get(){invoked++;return f.source.itemDrop.operationId;}});
  f.world.drops.set(80,drop);assert.throws(()=>f.hydrate().start());assert.equal(invoked,0);assert.equal(f.world.drops.get(80),drop);
});

for (const key of ['drops','pearlLedger']) test('combined hydration rejects overridden '+key+' Map before any callback',async()=>{
  const f=await fixture();let invoked=0;f.world[key].set=(...args)=>{invoked++;Map.prototype.set.call(f.world[key],...args);throw Error('after insertion');};
  assert.throws(()=>f.hydrate().start(),{code:'effect'});assert.equal(invoked,0);assert.equal(f.world.drops.size,0);
});

test('both families use one combined drop-counter capacity check',async()=>{
  const f=await fixture();f.world.nextDrop=Number.MAX_SAFE_INTEGER-2;const h=f.hydrate();await h.start();
  assert.deepEqual(h.drain(),{state:'fenced',why:'capacity'});assert.equal(f.world.drops.size,0);assert.equal(f.world.nextDrop,Number.MAX_SAFE_INTEGER-2);blocked(f);
});

test('prepared pickup with no receipt preserves exact reservations and fences combined startup',async()=>{
  const f=await fixture(), raw=await pickupRequest(f.base,f.source);
  await f.journal.prepare('drop',raw);
  const sessions=new ProfileSessions(f.base,()=>{}, {journal:f.journal});
  const startup=new PearlStartup({sessions,world:f.world,worldId:WORLD,mapClock:clock,deathDrops:true});
  await assert.rejects(startup.start(),{code:'busy'});assert.equal(startup.state,'fenced');assert.equal(f.world.drops.size,0);
  const rows=await f.journal.list();assert.equal(rows.length,1);assert.equal(rows[0].operationId,raw.operationId);assert.equal(rows[0].state,'pending');
  await assert.rejects(sessions.open(1,KILLER),{code:'busy'});
});

test('GameHost declines ordinary startup activation until its durable clock policy is implemented',async()=>{
  const store=createMemoryStore(), journal=createMemoryPearlJournals(store)(WORLD);
  const host=new GameHost({seed:42,bots:0,store,worldId:WORLD,pearlJournal:journal,resolvePlayer:async()=>KILLER,log(){}});
  host.mountPearlStaging({scope:WORLD});host.mountDeathStaging({scope:WORLD});host.mountCombatDeaths();host.mountDeathDrops();
  assert.throws(()=>host.mountPearlStartup({accountPolicy:'accounts-only',mapClock:clock,deathDrops:true}),{code:'configuration'});
  await host.close().catch(()=>{});
});

test('hydrated source is usable by real staging once and absent after a second reconstruction',async()=>{
  const f=await fixture(), h=f.hydrate();await h.start();assert.equal(h.drain().state,'applied');
  const source=f.source.itemDrop, drop=[...f.world.drops.values()].find(d=>d.operationId===source.operationId&&d.ordinal===source.ordinal);
  const p=await f.sessions.open(1,KILLER), e=f.world.spawnPlayer({clientId:1,x:drop.x,z:drop.z});attachProfile(f.world,e,p);
  f.world.ecs.x[e]=drop.x;f.world.ecs.z[e]=drop.z;
  const staging=new DeathDropStaging(f.sessions,f.world,WORLD), handle=staging.pickup({dropId:drop.id,receiver:{clientId:1,entity:e}});
  await staging.settle();assert.equal(f.world.drops.has(drop.id),true);
  assert.deepEqual(staging.drain(),[{operationId:handle.operationId,state:'applied'}]);
  assert.equal(f.world.drops.has(drop.id),false);assert.equal((await f.base.loadDeathDrop(source.operationId,source.ordinal)).state,'picked');
  const final=await f.base.loadProfile(KILLER), session2=new ProfileSessions(f.base,()=>{}, {journal:f.journal});await session2.recoverPearls();
  const world2=new World(42,{map,server:true});installInventory(world2,WORLD);world2.tick=f.world.tick;
  const h2=new PearlGroundHydration({sessions:session2,world:world2,worldId:WORLD,mapClock:clock,deathDrops:true});await h2.start();assert.equal(h2.drain().state,'applied');
  assert.equal([...world2.drops.values()].some(d=>d.operationId===source.operationId&&d.ordinal===source.ordinal),false);
  assert.deepEqual(await f.base.loadProfile(KILLER),final);assert.equal(world2.events.some(ev=>ev.type==='pickup'),false);
});

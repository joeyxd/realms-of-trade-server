import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNeedsProfile } from '../src/sim/systems/survival.js';
import { freshwaterSource, FRESHWATER } from '../src/data/freshwater.js';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { ACCOUNT_ONE, connect, makeResourceStore, startResourceHost, submitAndApply, turn, deferred, calmAt } from './helpers/resource-authority-fixture.mjs';

const command=(op,id,rev,extra={})=>({type:'freshwater',op,opId:id,expectedRev:rev,source:'',ship:'',part:'',n:0,...extra});
const options={freshwaterOperations:true,canteenOperations:true};
function seedNeeds(f,sat=20,hyd=20){
 const w=f.host.server.world,p=w.profiles.get(f.entity());p.surv={v:1,sat,hyd};applyNeedsProfile(w,f.entity(),p);w.profileDirty.add(f.entity());return p;
}
test('canteen paid craft, provision refill, drink replay and reconnect keep one conserved quantity',async t=>{
 const {store}=makeResourceStore();const f=await startResourceHost(t,store,{goods:{madera:1,lona:2,agua:3,fruta:1},options});
 const {host,client}=f,w=host.server.world,p=seedNeeds(f);
 assert.equal((await submitAndApply(host,client,command('craftCanteen','paid',0))).ok,true);
 assert.deepEqual(p.eco.pack.vessels,[{id:'canteen',kind:'canteen',water:0}]);
 assert.equal((await submitAndApply(host,client,command('refillCanteen','refill',1,{source:'provisions',n:3}))).ok,true);
 const drink=command('drink','sip',2,{n:1});const first=await submitAndApply(host,client,drink);
 assert.equal(first.ok,true,JSON.stringify(first));assert.equal(p.eco.pack.vessels[0].water,2);
 assert.ok(p.surv.hyd>59.9&&p.surv.hyd<=60);const hyd=w.ecs.hyd[f.entity()];
 const replay=await submitAndApply(host,client,drink);assert.equal(replay.replay,true);assert.equal(p.eco.pack.vessels[0].water,2);
 assert.ok(w.ecs.hyd[f.entity()]<=hyd,'replay cannot refill meter');
 const denied=await submitAndApply(host,client,{...drink,n:2});assert.equal(denied.ok,false);assert.equal(p.eco.pack.vessels[0].water,2);
 const rev=p.eco.tradeRev;
 assert.equal((await submitAndApply(host,client,command('eat','fruit',rev,{source:'fruta',n:1}))).ok,true);
 assert.equal(p.eco.pack.goods.fruta,undefined);
 client.ws.close();await turn();await host.profiles.flush();const saved=await store.loadProfile(ACCOUNT_ONE);
 assert.equal(saved.data.eco.pack.vessels[0].water,2);
 const again=connect(host);again.hello();await Promise.all([...host.joins]);
 const e=host.server.clients.get(again.id).entity,np=w.profiles.get(e);
 assert.equal(np.eco.pack.vessels[0].water,2);assert.ok(w.ecs.hyd[e]<=70);
 const receipt=await store.loadEconomicOperation(economicOperationId(host.worldState.id,ACCOUNT_ONE,'sip'));
 assert.equal(receipt.request.profile.eco.pack.vessels[0].water,2);
});
test('held commit freezes needs and inventory; effects appear together only in admitted drain',async t=>{
 const gate=deferred();const {store,base}=makeResourceStore({async commitEconomicOperation(a){await gate.promise;return base.commitEconomicOperation(a);}});
 const f=await startResourceHost(t,store,{goods:{agua:1},options}),w=f.host.server.world,p=seedNeeds(f,50,10),e=f.entity();
 f.client.send(command('eat','held-water',0,{source:'agua',n:1}));await turn();
 assert.equal(f.host.economicAuthority.busy,true);const before=w.ecs.hyd[e];const tick=w.tick;
 f.host.server.step();assert.equal(w.tick,tick);assert.equal(w.ecs.hyd[e],before);assert.equal(p.eco.pack.goods.agua,1);
 gate.resolve();await f.host.economicAuthority.settle();f.host.server.step();
 assert.equal(p.eco.pack.goods.agua,undefined);assert.ok(w.ecs.hyd[e]>49.9&&w.ecs.hyd[e]<=50);
});
test('disabled RNV07b preserves freshwater v1 and never starts needs',async t=>{
 const {store}=makeResourceStore();const f=await startResourceHost(t,store,{goods:{madera:2},options:{freshwaterOperations:true}});
 const w=f.host.server.world;assert.equal(w.ecs.needs[f.entity()],0);
 assert.equal((await submitAndApply(f.host,f.client,command('craftCanteen','disabled',0))).why,'disabled');
 assert.equal((await submitAndApply(f.host,f.client,command('craftBucket','legacy',0))).ok,true);
});
test('canteen readiness fails closed before accepting accounts',async t=>{
 const {store}=makeResourceStore({async checkCanteenOperations(){return {version:0};}});
 await assert.rejects(()=>startResourceHost(t,store,{options}),{code:'configuration'});
});
test('canteen spring channel interrupts on movement, then commits after its full duration',async t=>{
 const {store}=makeResourceStore();const f=await startResourceHost(t,store,{goods:{madera:1,lona:2},options});
 const {host,client}=f,w=host.server.world,e=f.entity();
 assert.equal((await submitAndApply(host,client,command('craftCanteen','spring-kit',0))).ok,true);
 const source=freshwaterSource(w.map),fill=command('fillCanteen','spring-sip',1,{source:source.id,n:3});
 calmAt(host,e,source);client.send(fill);await turn();host.server.step();
 assert.equal(client.events(fill.opId).at(-1).stage,'gathering');w.ecs.x[e]+=.3;host.server.step();
 assert.equal(client.events(fill.opId).at(-1).why,'interrupted');assert.equal(w.profiles.get(e).eco.pack.vessels[0].water,0);
 calmAt(host,e,source);client.send(fill);await turn();host.server.step();
 w.tick=w.freshwaterGather.get(e).tick+FRESHWATER.collectTicks-1;host.server.step();
 assert.equal(host.economicAuthority.busy,false);host.server.step();await turn();await host.economicAuthority.settle();host.server.step();
 assert.equal(client.events(fill.opId).at(-1).ok,true);assert.equal(w.profiles.get(e).eco.pack.vessels[0].water,3);
});
test('active voyage refuses consumption; confirmed food heals once and replay preserves later state',async t=>{
 const {store}=makeResourceStore();const f=await startResourceHost(t,store,{goods:{fruta:2},options});
 const {host,client}=f,w=host.server.world,e=f.entity(),p=seedNeeds(f,20,20);
 const pilot=w.navalPilot,locked=pilot.locked;pilot.locked=()=>true;
 const blocked=await submitAndApply(host,client,command('eat','at-sea',0,{source:'fruta',n:1}));
 assert.equal(blocked.why,'busy');assert.equal(p.eco.pack.goods.fruta,2);pilot.locked=locked;
 w.ecs.hp[e]=30;const meal=command('eat','shore-meal',0,{source:'fruta',n:1});
 assert.equal((await submitAndApply(host,client,meal)).ok,true);const healed=w.ecs.hp[e];
 assert.ok(healed>30&&healed<40);assert.equal(p.eco.pack.goods.fruta,1);
 w.ecs.hp[e]=20;seedNeeds(f,10,10);
 assert.equal((await submitAndApply(host,client,meal)).replay,true);assert.equal(w.ecs.hp[e],20);
 assert.ok(w.ecs.sat[e]<=10);assert.equal(p.eco.pack.goods.fruta,1);
});

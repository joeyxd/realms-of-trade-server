import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, focusDrop, wireEvents } from './helpers/death-drop-host.mjs';
import { managedDeathDrop } from '../server/deathDropLifecycle.mjs';
import { stepDrops } from '../src/sim/systems/inventory.js';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { mulberry32 } from '../src/core/rng.js';

for (const [name,corrupt] of [
  ['kind',d=>{d.kind='gold';}],
  ['partial marker',d=>{delete d.ordinal;}],
  ['private owner',d=>{d.to=99;}],
  ['inherited marker',d=>{Object.setPrototypeOf(d,{operationId:d.operationId});delete d.operationId;}],
]) test('malformed managed source fences before native consumption: '+name,async()=>{
  const f=await fixture();
  try {
    const d=(await f.makeDrops()).find(q=>q.kind==='item'),source={operationId:d.operationId,ordinal:d.ordinal};focusDrop(f,d);corrupt(d);
    assert.equal(f.server.step(),false);assert.equal(f.host.closing,true);
    assert.equal(f.world.drops.get(d.id),d);
    assert.equal(wireEvents(f,'pickup').length,0);
    const row=await f.db.store.loadDeathDrop(source.operationId,source.ordinal);
    assert.equal(row.state,'ground');
  } finally {await f.close();}
});

test('marker and source accessors never execute, and a Promise decision cannot consume native drops',()=>{
  let called=0;
  const source={operationId:'claimed'};
  Object.defineProperty(source,'kind',{get(){called++;return 'item';},enumerable:true});
  assert.equal(managedDeathDrop(source),true);assert.equal(called,0);
  const d={id:1,to:0,kind:'gold',n:10,x:0,z:0,t:0};
  const world={tick:3,drops:new Map([[1,d]]),ecs:{},isDeathDropManaged:()=>Promise.resolve(false)};
  assert.throws(()=>stepDrops(world),/managed drop decision/);
  assert.equal(world.drops.get(1),d);
});

test('an external source reservation waits without choosing another winner or deleting the source',async()=>{
  const f=await fixture();
  try {
    const d=(await f.makeDrops()).find(q=>q.kind==='item');focusDrop(f,d);
    const gate=pearlMutationGate(f.host.profiles),reservation=gate.reserve({accounts:[],uids:[],drops:[d.operationId+':'+d.ordinal]});
    assert.equal(f.server.step(),false);assert.equal(f.host.closing,false);
    assert.equal(f.lifecycle.pending,false);assert.equal(f.world.drops.get(d.id),d);
    gate.release(reservation);
    assert.equal(f.server.step(),false);assert.equal(f.lifecycle.pending,true);
    await f.host.deathDropStaging.settle();
    f.server.step();assert.equal(f.world.drops.has(d.id),false);
  } finally {await f.close();}
});

test('source hook replacement inside a world step is caught before terminal publication',async()=>{
  const f=await fixture();
  try {
    const sources=await f.makeDrops(),d=sources.find(q=>q.kind==='item');
    focusDrop(f,d,[]);f.world.tick++; // No boundary offer on this tick.
    f.sockets.forEach(s=>{s.messages.length=0;});
    const original=f.world.stepWorld.bind(f.world);
    f.world.stepWorld=()=>{original();f.world.isDeathDropManaged=()=>false;};
    assert.equal(f.server.step(),true);assert.equal(f.host.closing,true);
    assert.equal(f.world.drops.get(d.id),d);assert.equal(wireEvents(f,'pickup').length,0);
    await assert.rejects(f.host.close(),error=>error.code==='flush');
  } finally {await f.close();}
});

for (const [name,backend] of [['memory',undefined],['SDK/SQL012',(await import('./helpers/death-drop-journal-sql.mjs')).database]]) {
  test(name+': several nearby sources serialize at one logical tick against confirmed receiver progress',async()=>{
    const requests=[],f=await fixture({backend,wrap:s=>({...s,async commitDeathDrop(r){requests.push(structuredClone(r));return s.commitDeathDrop(r);}})});
    try {
      f.world.lootRng=mulberry32(1);
      const sources=await f.makeDrops(),items=sources.filter(d=>d.kind==='item');
      let pair;
      for (const a of items) for (const b of items) if(a!==b && Math.hypot(a.x-b.x,a.z-b.z)<=3) pair??=[a,b];
      assert.ok(pair,'two real spill items share the existing pickup radius');
      focusDrop(f,pair[0],[]);
      f.world.ecs.x[f.killer]=(pair[0].x+pair[1].x)/2;f.world.ecs.z[f.killer]=(pair[0].z+pair[1].z)/2;
      f.world.ecs.xp[f.killer]=37.129;
      const tick=f.world.tick,p=f.world.profiles.get(f.killer);
      p.mast[0]=[3,77];
      const before=structuredClone(p);
      f.sockets.forEach(s=>{s.messages.length=0;});
      let admitted=false;
      for (let n=0;n<sources.length*2+2;n++) {
        admitted=f.server.step();
        if (admitted) break;
        assert.equal(f.world.tick,tick);assert.equal(wireEvents(f,'pickup').length,0);
        await f.host.deathDropStaging.settle();
      }
      assert.equal(admitted,true);assert.equal(f.world.tick,tick+1);
      const itemRequests=requests.filter(r=>r.mode==='pickup'&&r.drop.kind==='item');assert.ok(itemRequests.length>=2);
      assert.deepEqual(requests.map(r=>r.at),requests.map(()=>tick));
      for(let i=1;i<requests.length;i++){
        assert.equal(requests[i].profile.expectedVersion,requests[i-1].profile.expectedVersion+1);
        assert.deepEqual(requests[i].profile.before,requests[i-1].profile.data);
      }
      assert.deepEqual(itemRequests.map(r=>r.profile.data.bag.at(-1).u),itemRequests.map((_,i)=>before.uid+i));
      assert.equal(p.bag.length,before.bag.length+itemRequests.length);assert.equal(p.uid,before.uid+itemRequests.length);
      assert.equal(p.xp,37.13);assert.equal(p.gold,before.gold);assert.deepEqual(p.mast,before.mast);assert.deepEqual(p.sk,before.sk);assert.deepEqual(p.eco,before.eco);assert.deepEqual(p.pearls,before.pearls);
      const pickupIds=wireEvents(f,'pickup').map(m=>m.ev.id);
      assert.equal(new Set(pickupIds).size,requests.length);
      for(const request of requests){const row=await f.db.store.loadDeathDrop(request.drop.operationId,request.drop.ordinal);assert.equal(row.state,'picked');assert.equal(row.transitionOperationId,request.operationId);}
      if(backend)assert.equal((await f.db.db.query("select count(*)::int as n from public.mn_pearl_intents where family='drop' and state='committed'")).rows[0].n,requests.length);
    } finally {await f.close();}
  });
}

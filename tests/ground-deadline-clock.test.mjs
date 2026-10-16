import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock, assertGroundDeadlineClock } from '../server/groundDeadlineClock.mjs';

const clock = (localTick=0,durableTick=5000) => new GroundDeadlineClock({worldId:'deadline-test',sourceDomain:'durable-ground-v1',epoch:new GroundClockEpoch({localTick,durableTick})});
const dropGround = {x:2,z:-3,availableAt:4990,expiresAt:5010};

test('past, present and future deadlines preserve inclusive pickup and strict expiry across epochs',()=>{
  for(const [localTick,durableTick] of [[0,5000],[30,5000],[0,Number.MAX_SAFE_INTEGER-20]]) {
    const c=clock(localTick,durableTick);
    for(const [start,end] of [[durableTick-10,durableTick-1],[durableTick,durableTick+1],[durableTick+2,durableTick+10]]) {
      const ground={x:2,z:3,availableAt:start,expiresAt:end},p=c.project(ground,'drop');
      for(const t of [localTick,localTick+1,localTick+2,localTick+9,localTick+10,localTick+11]) {
        assert.equal(t>=p.pickAt&&t<=p.t,c.at(t)>=start&&c.at(t)<=end);
        assert.equal(t>p.t,c.at(t)>end);
      }
      assert.equal(p.t-p.pickAt,end-start);
    }
  }
  assert.equal(clock().project({...dropGround,expiresAt:4999},'drop').t,-1);
});

test('source geometry and canonical deadlines stay detached and never become a negative persisted DTO',()=>{
  const c=clock(),source=structuredClone(dropGround),before=structuredClone(source),p=c.project(source,'drop');
  assert.equal(p.pickAt,-10);assert.equal(p.t,10);assert.deepEqual(source,before);
  const d={id:4,x:source.x,z:source.z,...p};
  assert.deepEqual(c.assertDrop(d,'drop',source),source);
  p.groundClock.ground.availableAt++; assert.deepEqual(source,before);
  assert.throws(()=>c.assertDrop(d,'drop'),{code:'operation'});
  assert.deepEqual(c.anchor,{localTick:0,durableTick:5000});
});

test('pearl projection uses returnAt while ordinary projection requires expiresAt',()=>{
  const c=clock(),pearl={x:2,z:-3,availableAt:4980,returnAt:4990};
  const p=c.project(pearl,'pearl');assert.equal(p.pickAt,-20);assert.equal(p.t,-10);
  assert.deepEqual(c.assertDrop({x:2,z:-3,...p},'pearl'),pearl);
  assert.throws(()=>c.project(pearl,'drop'),{code:'operation'});
  assert.throws(()=>c.project(dropGround,'pearl'),{code:'operation'});
  assert.throws(()=>c.project(dropGround,'other'),{code:'operation'});
});

test('projection cannot infer a domain, world, anchor or source ground from a marker',()=>{
  const c=clock(),projected={x:2,z:-3,...c.project(dropGround,'drop')};
  for(const mutate of [d=>delete d.groundClock,d=>d.groundClock.domain='legacy',d=>d.groundClock.world='foreign',
    d=>d.groundClock.anchor.durableTick++,d=>d.groundClock.anchor.extra=0,d=>d.groundClock.ground.x++,
    d=>d.t++,d=>delete d.pickAt,d=>d.groundClock.extra=1]) {
    const d=structuredClone(projected);mutate(d);assert.throws(()=>c.assertDrop(d,'drop'),{code:'operation'});
  }
  assert.throws(()=>c.assertDrop(projected,'drop',{...dropGround,expiresAt:5011}),{code:'operation'});
  assert.throws(()=>assertGroundDeadlineClock(c,'other'),{code:'configuration'});
  assert.throws(()=>assertGroundDeadlineClock(Object.create(GroundDeadlineClock.prototype),'deadline-test'),{code:'configuration'});
});

test('strict data rejects callbacks, proxies and hidden metadata without executing them',()=>{
  let calls=0;const c=clock(),input={...dropGround};Object.defineProperty(input,'expiresAt',{enumerable:true,get(){calls++;return 5010;}});
  assert.throws(()=>c.project(input,'drop'),{code:'operation'});
  const proxy=new Proxy(dropGround,{ownKeys(){calls++;return Object.keys(dropGround);}});
  assert.throws(()=>c.project(proxy,'drop'),{code:'operation'});
  const marker={x:2,z:-3,...c.project(dropGround,'drop')};Object.defineProperty(marker.groundClock,'hidden',{value:1});
  assert.throws(()=>c.assertDrop(marker,'drop'),{code:'operation'});
  const options={worldId:'deadline-test',sourceDomain:'durable-ground-v1'};Object.defineProperty(options,'epoch',{enumerable:true,get(){calls++;return new GroundClockEpoch({localTick:0,durableTick:5000});}});
  assert.throws(()=>new GroundDeadlineClock(options),{code:'operation'});assert.equal(calls,0);
});

test('explicit source domain and authentic epoch are required before a mapper exists',()=>{
  const epoch=new GroundClockEpoch({localTick:0,durableTick:5});
  for(const input of [{worldId:'x',epoch},{worldId:'x',epoch,sourceDomain:'legacy'},
    {worldId:'x',epoch,sourceDomain:'durable-ground-v1',extra:0},
    {worldId:'x',epoch:Object.create(GroundClockEpoch.prototype),sourceDomain:'durable-ground-v1'}]) assert.throws(()=>new GroundDeadlineClock(input),{code:'operation'});
});

test('unsafe conversion, invalid intervals and local ticks before the anchor reject exactly',()=>{
  const c=clock(0,Number.MAX_SAFE_INTEGER);
  assert.throws(()=>c.at(1),{code:'operation'});
  assert.equal(c.at(0),Number.MAX_SAFE_INTEGER);
  assert.throws(()=>clock(8,20).at(7),{code:'operation'});
  for(const invalid of [{...dropGround,expiresAt:4990},{...dropGround,availableAt:-1},{...dropGround,expiresAt:1.5},
    {...dropGround,x:Infinity},{...dropGround,z:1000001}]) assert.throws(()=>c.project(invalid,'drop'),{code:'operation'});
  assert.throws(()=>clock(Number.MAX_SAFE_INTEGER,0).project({x:0,z:0,availableAt:1,expiresAt:2},'drop'),{code:'operation'});
});

// Dormant ordinary death-drop coordinator. The trusted host freezes the actor/source and
// calls drain only at a completed tick boundary, before publication. settle never applies.
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { randomUUID } from 'node:crypto';
import { StoreError, playerKey } from './store.mjs';
import { C, KIND } from '../src/sim/ecs.js';
import { DROPS } from '../src/data/loot.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { groundKey } from './pearlGround.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { deathDropKey, deathDropOperation, deathDropInWindow, checkedCurrentDeathDrop, checkedDeathDropResult } from './deathDropOperation.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { snapshotDropData, assertDropContainers, prepareDeathDropApply } from './deathDropApply.mjs';

const clone=structuredClone, same=(a,b)=>canonicalText(a)===canonicalText(b);
const freeze=v=>{if(v && typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const codeOf=e=>e instanceof StoreError?e.code:'unavailable';
const record=(raw,keys)=>{const value=snapshotDropData(raw);if(!value || Array.isArray(value) || Object.keys(value).sort().join(',')!==keys)throw new StoreError('operation');return value;};
const numeric=(ecs,e)=>Object.entries(ecs).filter(([,c])=>ArrayBuffer.isView(c)&&!(c instanceof DataView)).map(([key,column])=>({key,column,value:column[e]}));

export class DeathDropStaging {
  #entering=false; #violation=false; #deadlineClock=null;
  constructor(sessions,world,scope,{limit=64,deadlineClock=null}={}) {
    this.scope=groundKey(scope);
    if(deadlineClock!==null)this.#deadlineClock=assertGroundDeadlineClock(deadlineClock,this.scope);
    if(!Number.isInteger(limit)||limit<1||limit>256||(sessions.pearls.journal && sessions.pearls.journal.scope!==this.scope))throw new StoreError('configuration');
    this.sessions=sessions;this.world=world;this.limit=limit;this.gate=pearlMutationGate(sessions);
    this.operations=new Map();this.accounts=new Map();this.tasks=new Set();this.completed=[];this.sequence=0;
  }
  #entry(callback) {
    if(this.#entering){this.#violation=true;throw new StoreError('busy');}
    this.#entering=true;this.#violation=false;
    try{const result=callback();if(this.#violation)throw new StoreError('effect');return result;}finally{this.#entering=false;}
  }
  #endpoint(raw) {
    const {clientId,entity}=record(raw,'clientId,entity'),w=this.world,s=this.sessions.clients.get(clientId),p=w.profiles.get(entity),ecs=w.ecs;
    if(!Number.isSafeInteger(clientId)||clientId<0||!Number.isInteger(entity)||entity<1||entity>=ecs.cap||
        !s||s.closed||s.failed||s.id!==clientId||ecs.clientId[entity]!==clientId||!ecs.alive[entity]||ecs.dead[entity]>0||
        ecs.kind[entity]!==KIND.PLAYER||!(ecs.mask[entity]&C.PLAYER)||!p||p.pirateId!=='account:'+s.key)throw new StoreError('session');
    const live=snapshotDropData(p);if(!same(live,sanitizeProfile(live)))throw new StoreError('profile');
    return {clientId,entity,key:s.key,session:s,profile:p,live,name:ecs.names[entity],columns:numeric(ecs,entity)};
  }
  assertDeadline(raw) {
    const snap=snapshotDropData(raw);
    if(this.#deadlineClock)return this.#deadlineClock.assertDrop(snap,'drop');
    if(Object.hasOwn(snap,'groundClock'))throw new StoreError('configuration');
    if(!Number.isSafeInteger(snap.t)||snap.t<0)throw new StoreError('operation');
    return null;
  }
  pickup(raw){return this.#entry(()=>this.#request(raw,'pickup'));}
  expire(raw){return this.#entry(()=>this.#request(raw,'expire'));}
  #request(raw,mode) {
    if(this.operations.size>=this.limit)throw new StoreError('busy');
    const data=record(raw,mode==='pickup'?'dropId,receiver':'dropId'),w=this.world;
    assertDropContainers(w);
    if(!Number.isSafeInteger(w.tick)||w.tick<0||!Number.isSafeInteger(data.dropId)||data.dropId<1)throw new StoreError('operation');
    const drop=w.drops.get(data.dropId),snap=snapshotDropData(drop);
    if(snap.id!==data.dropId||snap.to!==0||!['item','potion'].includes(snap.kind)||!Number.isFinite(snap.x)||!Number.isFinite(snap.z)||
        !Number.isSafeInteger(snap.t)||(!this.#deadlineClock && snap.t<0))throw new StoreError('operation');
    const sourceGround=this.assertDeadline(snap);
    const durableAt=this.#deadlineClock?this.#deadlineClock.at(w.tick):w.tick;
    const source=deathDropKey(snap.operationId,snap.ordinal),lane=source.operationId+':'+source.ordinal;
    const endpoint=mode==='pickup'?this.#endpoint(data.receiver):null;
    if(mode==='expire'?w.tick<=snap.t:w.tick>snap.t || (snap.pickAt!==undefined && w.tick<snap.pickAt))throw new StoreError('ownership');
    if(endpoint && Math.hypot(w.ecs.x[endpoint.entity]-snap.x,w.ecs.z[endpoint.entity]-snap.z)>DROPS.pickR)throw new StoreError('ownership');
    const before=endpoint?capturePearlProfile(w,endpoint.entity):null,after=before?clone(before):null;
    if(endpoint && snap.kind==='item'){
      if(after.bag.length>=24||after.uid>=2147483647||after.stats.items>=1000000000)throw new StoreError('capacity');
      const item=clone(snap.item);item.u=after.uid++;after.bag.push(item);after.stats.items++;
    }else if(endpoint){if(after.pot>=5)throw new StoreError('capacity');after.pot++;}
    if(this.#violation)throw new StoreError('effect');
    freeze(before);freeze(after);if(endpoint)freeze(endpoint.live);freeze(snap);
    const uids=before?profilePearls(before).map(q=>q.uid):[];
    const reservation=this.gate.reserve({accounts:endpoint?[endpoint.key]:[],uids,drops:[lane]}),operationId=randomUUID();
    const ctx={operationId,mode,source,lane,reservation,endpoint,before,after,at:w.tick,durableAt,sourceGround,drop,dropId:data.dropId,dropText:canonicalText(snap),
      ecs:w.ecs,names:w.ecs.names,profiles:w.profiles,ledger:w.pearlLedger,drops:w.drops,ledgers:new Map(),state:'pending',sequence:++this.sequence};
    try{
      for(const uid of uids)ctx.ledgers.set(uid,clone(w.pearlLedger.get(uid)));
      this.assertBaseline(ctx);
    }catch(e){if(this.gate.active(reservation))this.gate.release(reservation);else this.gate.fence(reservation);throw e;}
    this.operations.set(operationId,ctx);if(endpoint)this.accounts.set(endpoint.key,ctx);
    const task=Promise.resolve().then(async()=>{
      try{
        this.assertBaseline(ctx);
        if(endpoint){
          this.sessions.save(endpoint.clientId,before,reservation);
          const s=endpoint.session;
          while(s.running||s.pending){if(!s.running)this.sessions.kick(s);if(s.running)await s.running;this.assertBaseline(ctx);if(s.pending&&!s.running)throw new StoreError('busy');}
        }
        this.assertBaseline(ctx);
        const row=checkedCurrentDeathDrop(await this.sessions.store.loadDeathDrop(source.operationId,source.ordinal),source);
        this.assertBaseline(ctx);
        if(!row||row.state!=='ground'||row.world!==this.scope||row.kind!==snap.kind||!same(row.item,snap.item??null)||
            row.ground.x!==snap.x||row.ground.z!==snap.z||
            (ctx.sourceGround ? !same(row.ground,ctx.sourceGround) :
              row.ground.expiresAt!==snap.t||(snap.pickAt!==undefined && snap.pickAt!==row.ground.availableAt)))throw new StoreError('ownership');
        const {state,version,holder,transitionOperationId,...creation}=row,s=endpoint?.session;
        if(s && (s.running||s.pending||s.pearlBusy||!same(s.confirmed,before)))throw new StoreError('conflict');
        const concrete={operationId,world:this.scope,mode,at:ctx.durableAt,drop:{...creation,expectedVersion:version},
          profile:endpoint?{id:endpoint.key,expectedVersion:s.version,before:clone(before),data:clone(after)}:null};
        ctx.request=freeze(deathDropOperation(concrete).request);
        if(!deathDropInWindow(ctx.request))throw new StoreError('ownership');
        const result=await this.sessions.commitDeathDrop(concrete,reservation),receipt=checkedDeathDropResult(result?.receipt,ctx.request,operationId);
        if(!receipt.ok)throw new StoreError('response');
        ctx.receipt=freeze(clone(receipt));ctx.state='ready';
      }catch(e){ctx.state='failed';ctx.code=codeOf(e);}
      this.completed.push(ctx);
    });
    this.tasks.add(task);task.finally(()=>this.tasks.delete(task));return Object.freeze({operationId});
  }
  assertIdentity(ctx) {
    const w=this.world,e=ctx.endpoint;
    if(!this.gate.active(ctx.reservation)||w.ecs!==ctx.ecs||w.ecs.names!==ctx.names||w.profiles!==ctx.profiles||w.pearlLedger!==ctx.ledger||w.drops!==ctx.drops)throw new StoreError('cancelled');
    if(e && (this.sessions.clients.get(e.clientId)!==e.session||this.sessions.accounts.get(e.key)!==e.session||e.session.closed||e.session.failed||
        w.profiles.get(e.entity)!==e.profile||e.profile.pirateId!=='account:'+e.key||w.ecs.clientId[e.entity]!==e.clientId||w.ecs.names[e.entity]!==e.name))throw new StoreError('cancelled');
  }
  assertBaseline(ctx) {
    this.assertIdentity(ctx);assertDropContainers(this.world);
    if(this.#entering && this.#violation)throw new StoreError('effect');
    const w=this.world,e=ctx.endpoint;
    if(w.tick!==ctx.at||w.drops.get(ctx.dropId)!==ctx.drop||canonicalText(snapshotDropData(ctx.drop))!==ctx.dropText)throw new StoreError('cancelled');
    for(const [id,d]of w.drops){const descriptors=d&&typeof d==='object'?Object.getOwnPropertyDescriptors(d):{};if(id!==ctx.dropId && descriptors.operationId?.value===ctx.source.operationId && descriptors.ordinal?.value===ctx.source.ordinal)throw new StoreError('ownership');}
    if(e){
      if(!same(snapshotDropData(e.profile),e.live)||numeric(w.ecs,e.entity).length!==e.columns.length||e.columns.some(q=>w.ecs[q.key]!==q.column||q.column[e.entity]!==q.value))throw new StoreError('cancelled');
      for(const [uid,row]of ctx.ledgers)if(!same(w.pearlLedger.get(uid),row)||row?.place!=='profile'||row.owner!==e.profile.pirateId||row.entity!==e.entity||Object.keys(row).sort().join(',')!=='entity,owner,place')throw new StoreError('ownership');
      for(const [uid,row]of w.pearlLedger)if(row?.place==='profile'&&(row.owner===e.profile.pirateId||row.entity===e.entity)&&!ctx.ledgers.has(uid))throw new StoreError('ownership');
    }
  }
  invalidateDrop(operationId,ordinal){const source=deathDropKey(operationId,ordinal);this.gate.invalidate({drops:[source.operationId+':'+source.ordinal]});}
  invalidate(account){this.gate.invalidate({accounts:[playerKey(account)]});}
  assertPublishable(clientId){const s=this.sessions.clients.get(clientId);if(!s||s.closed||s.failed)throw new StoreError('session');this.gate.assertAvailable({accounts:[s.key]});}
  save(clientId,raw){return this.#entry(()=>{
    const s=this.sessions.clients.get(clientId),ctx=s&&this.accounts.get(s.key);
    if(!ctx){this.assertPublishable(clientId);this.sessions.save(clientId,raw);return;}
    if(ctx.state==='fenced')throw new StoreError('busy');this.assertBaseline(ctx);
    if(!same(snapshotDropData(raw),ctx.before)||!same(capturePearlProfile(this.world,ctx.endpoint.entity),ctx.before))throw new StoreError('profile');
  });}
  fence(ctx,code){this.gate.fence(ctx.reservation);ctx.state='fenced';ctx.code=code;
    if(ctx.endpoint)try{this.sessions.fail(ctx.endpoint.session,code);}catch{/* Retain both authorities. */}
    return {operationId:ctx.operationId,state:'fenced',code};}
  drain(){return this.#entry(()=>{
    const results=[];
    for(const ctx of this.completed.splice(0).sort((a,b)=>a.sequence-b.sequence)){
      if(ctx.state!=='ready'){results.push(this.fence(ctx,ctx.code??'cancelled'));continue;}
      let effect;
      try{
        this.assertBaseline(ctx);const e=ctx.endpoint,p=ctx.request.profile;
        if(e && (e.session.running||e.session.pending||e.session.pearlBusy||e.session.version!==p.expectedVersion+1||!same(e.session.confirmed,p.data)))throw new StoreError('conflict');
        effect=prepareDeathDropApply(this.world,{drop:ctx.drop,dropId:ctx.dropId,endpoint:e,before:ctx.before,after:ctx.after,liveBefore:e?.live,victim:ctx.request.drop.victim});
        this.assertBaseline(ctx);effect.apply();effect.assertApplied();this.assertIdentity(ctx);effect.publish();effect.assertApplied();this.assertIdentity(ctx);
        this.gate.release(ctx.reservation);
      }catch(error){try{effect?.rollback();}catch{/* Preserve durable state and fence. */}results.push(this.fence(ctx,codeOf(error)));continue;}
      ctx.state='applied';this.operations.delete(ctx.operationId);if(ctx.endpoint)this.accounts.delete(ctx.endpoint.key);
      results.push({operationId:ctx.operationId,state:'applied'});
    }
    return results;
  });}
  async settle(){while(this.tasks.size)await Promise.all([...this.tasks]);}
}

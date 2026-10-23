import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, command, deferred, turn, events, Socket } from './helpers/combat-death-host.mjs';
import { database as sql } from './helpers/death-journal-sql.mjs';
import { VICTIM, KILLER } from './helpers/death-storage.mjs';
import { hurtPlayer, killPlayer } from '../src/sim/systems/combat.js';
import { MSG, sanitizeCmd, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DT, tuning } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { GameHost } from '../server/host.mjs';
import { StoreError } from '../server/store.mjs';
import { LocalServer } from '../src/net/localServer.js';
import { PEARL } from '../src/data/pearls.js';

const THIRD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const neutral = (n) => sanitizeCmd({ seq: n, pt: n, mx: 0, mz: 0, ax: 20, az: 20, btn: 0, prs: 0 });
const lethal = (f, entity = f.e, seq = 9, by = f.k) => {
  f.w.ecs.hp[entity] = 1;
  return hurtPlayer(f.w, entity, 9999, { x: f.w.ecs.x[entity], z: f.w.ecs.z[entity],
    kind: 'melee', seq, by, pierce: true, noInv: true, knock: 0 });
};
function inject(f, fn) {
  const step = f.w.stepWorld.bind(f.w); let once = false;
  f.w.stepWorld = () => { if (!once) { once = true; fn(); } step(); };
}
async function settleAll(f) {
  for (let i = 0; i < 10 && f.h.combatDeaths.pending; i++) {
    await f.h.deathStaging.settle(); f.h.server.step();
  }
  assert.equal(f.h.combatDeaths.pending, false);
}

for (const [name, backend] of [['memory', undefined], ['SDK/SQL010 local', sql]]) {
  test(name + ': fatal command completes exactly one terminal tick and withholds loss/publication until receipt', async () => {
    const entered = deferred(), reply = deferred(); let commits = 0, request;
    const f = await fixture({ backend, lawless: true, wrap: (s) => ({ ...s, async commitDeath(r) {
      commits++; request = structuredClone(r); const v = await s.commitDeath(r); entered.resolve(); await reply.promise; return v;
    } }) });
    try {
      const s = f.h.server, w = f.w, tick = w.tick, p = f.p, step = w.stepWorld.bind(w), apply = w.applyCommand.bind(w);
      let worlds = 0, commands = 0, wasPending = false;
      w.stepWorld = () => { worlds++; step(); };
      w.applyCommand = (e, cmd) => {
        commands++; apply(e, cmd);
        if (e === f.e && cmd.seq === 1) {
          lethal(f, e, cmd.seq);
          assert.equal(w.ecs.dead[e], 1); assert.equal(w.ecs.deadT[e], 0);
          assert.equal(p.stats.deaths, 0); assert.equal(p.xp, 80);
          assert.equal(killPlayer(w,e,99,f.k), false);
          s.broadcastSnapshot(); s.flushEvents(); s.sendProfile(1,f.c); s.sendSave(1,f.c);
        }
        if (e === f.e && cmd.seq === 2) wasPending = w.ecs.dead[e] === 1;
      };
      f.c.queue.push(neutral(1), neutral(2), neutral(3)); f.c.last = command(0);
      s.clients.get(2).queue.push(neutral(1));
      assert.equal(s.step(), true); assert.equal(worlds, 1); assert.equal(commands, 3); assert.equal(wasPending, true);
      assert.equal(w.tick, tick+1); assert.equal(f.c.ack, 2);
      assert.equal(w.ecs.dead[f.e], 0); assert.equal(p.stats.deaths, 0); assert.equal(p.xp, 80);
      assert.equal(w.drops.size, 0); assert.equal(events(f,'death').length, 0); assert.equal(events(f,'respawn').length, 0);
      assert.equal(f.sockets[0].messages.length, 0, 'terminal commands/damage are buffered too');
      await entered.promise;
      const buffered = JSON.stringify(w.events), rng = w.lootRng.state(), xp = w.ecs.xp[f.e];
      s.receive(1,{ t: MSG.INPUTS, cmds: [command(4)] });
      for (let i=0;i<3;i++) { assert.equal(s.step(),false); s.waitForTick(1); s.broadcastSnapshot(); }
      assert.equal(w.tick,tick+1); assert.equal(worlds,1); assert.equal(commands,3); assert.equal(f.c.ack,2);
      assert.equal(JSON.stringify(w.events), buffered); assert.equal(w.lootRng.state(),rng); assert.equal(w.ecs.xp[f.e],xp);
      assert.equal(f.sockets[0].messages.length,0);
      assert.equal(s.sendProfile(1,f.c), false); assert.equal(s.sendSave(1,f.c),false);
      assert.equal(f.h.saveProfile(1,p),false);
      assert.throws(()=>s.applyFiller(f.c),TypeError); assert.throws(f.request,StoreError);
      const stranger = new Socket(); f.h.onConnection(stranger,{headers:{},socket:{remoteAddress:'test'}});
      assert.equal(stranger.readyState,3); assert.equal(s.clients.size,2);
      reply.resolve(); await f.h.deathStaging.settle();
      assert.equal(w.ecs.dead[f.e],0,'network completion never applies the ECS');
      assert.equal(s.step(),true); assert.equal(w.ecs.dead[f.e],1);
      assert.equal(p.xp,72); assert.equal(p.stats.deaths,1); assert.equal(p.bag.length,0);
      assert.deepEqual(p.pearls,{bag:[],swallowed:null}); assert.equal(p.gold,73); assert.deepEqual(p.mast[0],[3,123]);
      assert.equal(events(f,'death').length,1); assert.equal(events(f,'respawn').length,0);
      assert.equal(w.profiles.get(f.k).stats.pk,1); assert.equal(commits,1);
      assert.equal(request.rules.xpBefore,80);
      for (const q of request.profiles) assert.deepEqual((await f.db.store.loadProfile(q.id)).data,q.data);
      for (const q of request.pearls) assert.equal((await f.db.store.loadUnique(q.uid)).holder,null);
      assert.equal(w.tick,tick+2); assert.equal(worlds,2);
      assert.equal(f.h.status().storage.combatDeaths.pending,0);
      for (let i=0;i<Math.ceil(tuning.combat.respawnTime/DT)+2;i++) {
        f.c.queue.push(neutral(i+10)); s.step();
      }
      assert.equal(w.ecs.dead[f.e],0); assert.equal(events(f,'respawn').filter(m=>m.ev.id===f.e).length,1);
      assert.equal(events(f,'death').length,1); assert.equal(p.stats.deaths,1);
    } finally { reply.resolve(); await f.close(); }
  });

  test(name + ': two terminal deaths sharing a killer serialize against confirmed profile versions', async () => {
    const requests = [], f = await fixture({ backend, lawless:true, tokens:['v','k','t'],
      wrap:s=>({...s,async commitDeath(r){requests.push(structuredClone(r));return s.commitDeath(r);}}) });
    try {
      const t = f.h.server.clients.get(3).entity, ecs=f.w.ecs;
      ecs.x[t]=ecs.x[f.e]+2; ecs.z[t]=ecs.z[f.e];
      inject(f,()=>{lethal(f,f.e,11,f.k);lethal(f,t,12,f.k);});
      assert.equal(f.h.server.step(),true); const tick=f.w.tick;
      assert.equal(f.h.combatDeaths.count,2); assert.equal(events(f,'death').length,0);
      await f.h.deathStaging.settle();
      assert.equal(f.h.server.step(),false); assert.equal(f.w.tick,tick);
      assert.equal(f.p.stats.deaths,1); assert.equal(f.w.profiles.get(f.k).stats.pk,1);
      assert.equal(f.w.profiles.get(t).stats.deaths,0); assert.equal(events(f,'death').length,0);
      await f.h.deathStaging.settle();
      assert.equal(f.h.server.step(),true);
      assert.equal(f.w.profiles.get(t).stats.deaths,1); assert.equal(f.w.profiles.get(f.k).stats.pk,2);
      assert.equal(events(f,'death').length,2); assert.equal(requests.length,2);
      const a=requests[0].profiles.find(p=>p.id===KILLER), b=requests[1].profiles.find(p=>p.id===KILLER);
      assert.equal(b.expectedVersion,a.expectedVersion+1); assert.deepEqual(b.before,a.data);
      assert.equal(requests[1].victim,THIRD); assert.equal(f.h.combatDeaths.count,0);
    } finally { await f.close(); }
  });

  test(name + ': an already applied victim remains the causal killer of a later death', async () => {
    const requests=[], f=await fixture({backend,lawless:true,wrap:s=>({...s,async commitDeath(r){requests.push(structuredClone(r));return s.commitDeath(r);}})});
    try {
      inject(f,()=>{lethal(f,f.e,21,f.k);lethal(f,f.k,22,f.e);});
      f.h.server.step(); await settleAll(f);
      assert.equal(f.p.stats.deaths,1); assert.equal(f.p.stats.pk,1);
      const kp=f.w.profiles.get(f.k); assert.equal(kp.stats.deaths,1); assert.equal(kp.stats.pk,1);
      assert.equal(requests[1].killer,VICTIM); assert.equal(requests[1].profiles.find(p=>p.id===VICTIM).before.stats.deaths,1);
      assert.equal(events(f,'death').length,2);
    } finally {await f.close();}
  });
}

test('exterior death has no PK credit; enemy/source omission and zero pearls still use one whole-death receipt', async()=>{
  const f=await fixture({pearlCount:0});
  try { inject(f,()=>lethal(f,f.e,undefined,0)); f.h.server.step(); await settleAll(f);
    assert.equal(f.p.stats.deaths,1); assert.equal(f.p.xp,72); assert.equal(f.w.profiles.get(f.k).stats.pk,0);
    assert.equal(f.p.bag.length,0); assert.equal(f.p.eq.head.b,(await f.db.store.loadProfile(VICTIM)).data.eq.head.b);
    assert.equal(events(f,'death').length,1);
  } finally {await f.close();}
});

test('completed terminal baseline includes later same-tick XP without replaying the causal hit', async()=>{
  const f=await fixture();
  try {const step=f.w.stepWorld.bind(f.w);let n=0;
    f.w.stepWorld=()=>{if(!n++){lethal(f);f.w.ecs.xp[f.e]+=5;}step();};
    f.h.server.step(); await settleAll(f);
    assert.equal(f.p.xp,76.5); assert.equal(f.p.stats.deaths,1); assert.equal(events(f,'hurt').length,1);
  } finally {await f.close();}
});

test('partial world fault freezes publication and closes without capturing or replaying a death',async()=>{
  let commits=0;const f=await fixture({wrap:s=>({...s,async commitDeath(r){commits++;return s.commitDeath(r);}})});
  try {let steps=0;f.w.stepWorld=()=>{steps++;lethal(f);throw Error('partial world');};
    assert.throws(()=>f.h.server.step(),/partial world/); assert.equal(f.h.closing,true);
    assert.equal(f.h.server.step(),false); f.h.server.broadcastSnapshot(); f.h.server.flushEvents();
    assert.equal(steps,1); assert.equal(commits,0); assert.equal(f.h.combatDeaths.failed,true);
    assert.equal(f.p.stats.deaths,0); assert.equal(events(f,'death').length,0); assert.equal(f.sockets[0].messages.length,0);
    await turn();await assert.rejects(f.h.close(),{code:'flush'});
  } finally {await f.close();}
});

test('second receipt failure retains the committed prefix, fences and never replays it',async()=>{
  let n=0;const f=await fixture({lawless:true,wrap:s=>({...s,async commitDeath(r){if(++n===2)return {ok:false,why:'conflict'};return s.commitDeath(r);}})});
  try {inject(f,()=>{lethal(f);lethal(f,f.k,33,0);});f.h.server.step();
    await f.h.deathStaging.settle();assert.equal(f.h.server.step(),false);assert.equal(f.p.stats.deaths,1);
    await f.h.deathStaging.settle();assert.equal(f.h.server.step(),false);assert.equal(f.h.closing,true);
    assert.equal((await f.db.store.loadProfile(VICTIM)).data.stats.deaths,1);
    assert.equal((await f.db.store.loadProfile(KILLER)).data.stats.deaths,0);
    assert.equal(events(f,'death').length,0);assert.equal(n,2);assert.equal(f.h.server.step(),false);assert.equal(n,2);
    await turn();await assert.rejects(f.h.close(),{code:'flush'});
  } finally {await f.close();}
});

test('close settles storage without applying a queued terminal death or claiming a complete flush',async()=>{
  const entered=deferred(),reply=deferred(),f=await fixture({wrap:s=>({...s,async commitDeath(r){const v=await s.commitDeath(r);entered.resolve();await reply.promise;return v;}})});
  try {inject(f,()=>lethal(f));f.h.server.step();await entered.promise;
    const closing=f.h.close(), rejection=assert.rejects(closing,{code:'flush'});let done=false;closing.catch(()=>{done=true;});
    await turn();assert.equal(done,false);assert.equal(f.p.stats.deaths,0);assert.ok(f.h.unsavedProfiles.size);
    reply.resolve();await rejection;assert.equal(f.p.stats.deaths,0);assert.equal(f.h.combatDeaths.pending,true);
    assert.equal((await f.db.store.loadProfile(VICTIM)).data.stats.deaths,1);
  } finally {reply.resolve();await f.close();}
});

test('detaching an unreserved queued participant invalidates the queue before actor mutation',async()=>{
  const entered=deferred(),reply=deferred(),f=await fixture({tokens:['v','k','t'],wrap:s=>({...s,async commitDeath(r){const v=await s.commitDeath(r);entered.resolve();await reply.promise;return v;}})});
  try {const t=f.h.server.clients.get(3).entity;inject(f,()=>{lethal(f);lethal(f,t,55,0);});f.h.server.step();await entered.promise;
    f.sockets[2].close();assert.equal(f.h.combatDeaths.failed,true);assert.equal(f.h.closing,true);
    assert.equal(f.w.ecs.alive[t],0);assert.ok(f.h.unsavedProfiles.has(3));
    reply.resolve();await f.h.deathStaging.settle();assert.equal(f.h.server.step(),false);
    assert.equal((await f.db.store.loadProfile(THIRD)).data.stats.deaths,0);
  } finally {reply.resolve();await f.close();}
});

test('fatal hook rejects idle/direct gameplay and mount ownership is checked before simulation',async()=>{
  const f=await fixture();
  try {assert.throws(()=>killPlayer(f.w,f.e,1),TypeError);assert.equal(f.w.ecs.dead[f.e],0);
    assert.throws(()=>f.h.server.applyFiller(f.c),TypeError);
    f.w.deferPlayerDeath=()=>false;assert.equal(f.h.server.step(),false);assert.equal(f.h.closing,true);
    assert.equal(f.h.combatDeaths.failed,true);await turn();await assert.rejects(f.h.close(),{code:'flush'});
  } finally {await f.close();}
});

test('default host preserves immediate death; mounted fatal assembly is explicit and selector-free',async()=>{
  const f=await fixture({combat:false});
  try {assert.equal(f.h.combatDeaths,null);assert.equal(killPlayer(f.w,f.e,7,f.k),true);
    assert.equal(f.w.ecs.dead[f.e],1);assert.equal(f.p.stats.deaths,1);assert.equal(f.p.xp,72);
    assert.throws(()=>f.h.mountCombatDeaths(),{code:'configuration'});
  } finally {await f.close();}
  const h=new GameHost({bots:0,resolvePlayer:async()=>VICTIM,log(){}});
  try {assert.throws(()=>h.mountCombatDeaths(),{code:'configuration'});
    h.mountPearlStaging({scope:'test'});h.mountDeathStaging({scope:'test'});
    assert.throws(()=>h.mountCombatDeaths({}),{code:'configuration'});
    h.server.afterTick=()=>true;assert.throws(()=>h.mountCombatDeaths(),{code:'configuration'});
    h.server.afterTick=null;h.mountCombatDeaths();assert.throws(()=>h.mountCombatDeaths(),{code:'configuration'});
  } finally {await h.close();}
});

test('guest resolution is refused by explicit authenticated fatal mount',async()=>{
  const f=await fixture();
  try {f.h.resolvePlayer=async()=>null;
    const ws=new Socket();f.h.onConnection(ws,{headers:{},socket:{remoteAddress:'test'}});
    ws.emit('message',Buffer.from(JSON.stringify({t:MSG.HELLO,v:PROTOCOL_VERSION,name:'guest'})),false);
    await Promise.all([...f.h.joins]);assert.equal(f.h.server.clients.get(3).entity,0);
    assert.ok(ws.messages.some(m=>m.t===MSG.ERROR&&m.code==='auth'));
  } finally {await f.close();}
});

test('actual swallowed Brasa water curse enters the same automatic receipt path',async()=>{
  const f=await fixture();
  try {
    assert.equal(f.w.ecs.elem[f.e],1);
    f.w.map.onDock=()=>false; f.w.map.groundAt=()=>-2;
    f.w.ecs.hp[f.e]=1; f.w.ecs.waterT[f.e]=PEARL.waterEvery;
    f.c.queue.push(neutral(1)); f.h.server.step();
    assert.equal(f.h.combatDeaths.count,1);assert.equal(f.p.stats.deaths,0);
    await settleAll(f); assert.equal(f.p.stats.deaths,1);assert.equal(f.p.pearls.swallowed,null);
    assert.equal(events(f,'hurt').filter(m=>m.ev.kind==='water').length,1);assert.equal(events(f,'death').length,1);
  } finally {await f.close();}
});

test('drowning uses the mounted M5 receipt and preserves ordinary death drops',async()=>{
  const f=await fixture();
  try {
    f.w.map.onDock=()=>false; f.w.map.groundAt=()=>-2; f.w.raftDeck.update([]);
    f.w.ecs.elem[f.e]=0; f.w.ecs.swim[f.e]=1; f.w.ecs.y[f.e]=tuning.world.waterLevel-tuning.swim.bodyDepth;
    f.w.ecs.hp[f.e]=1; f.w.ecs.swimStamina[f.e]=0; f.w.ecs.swimDrown[f.e]=5.99;
    f.c.queue.push(neutral(1)); f.h.server.step();
    assert.equal(f.h.combatDeaths.count,1); assert.equal(f.p.stats.deaths,0); assert.equal(f.p.xp,80);
    assert.equal(f.p.bag.length,1); assert.equal(f.w.drops.size,0); assert.equal(events(f,'death').length,0);
    await settleAll(f);
    assert.equal(f.p.stats.deaths,1); assert.equal(f.p.xp,72); assert.equal(f.p.gold,73);
    assert.equal(f.p.bag.length,0); assert.equal(f.p.pearls.swallowed,null); assert.ok(f.w.drops.size>0);
    assert.equal(events(f,'hurt').filter(m=>m.ev.kind==='drowning').length,1);
    assert.equal(events(f,'death').length,1);
  } finally {await f.close();}
});

test('an unreserved later victim changing while the first receipt waits fences the entire host',async()=>{
  const entered=deferred(),reply=deferred(),f=await fixture({tokens:['v','k','t'],wrap:s=>({...s,async commitDeath(r){const v=await s.commitDeath(r);entered.resolve();await reply.promise;return v;}})});
  try {
    const t=f.h.server.clients.get(3).entity;inject(f,()=>{lethal(f);lethal(f,t,56,0);});f.h.server.step();await entered.promise;
    f.w.ecs.x[t]+=1;reply.resolve();await f.h.deathStaging.settle();
    assert.equal(f.h.server.step(),false);assert.equal(f.h.closing,true);assert.equal(f.h.combatDeaths.failed,true);
    assert.equal(f.p.stats.deaths,0);assert.equal((await f.db.store.loadProfile(VICTIM)).data.stats.deaths,1);
    assert.equal((await f.db.store.loadProfile(THIRD)).data.stats.deaths,0);assert.equal(events(f,'death').length,0);
  } finally {reply.resolve();await f.close();}
});

test('a join already awaiting authentication cannot spawn into a held terminal tick',async()=>{
  const f=await fixture(), identity=deferred();
  try {
    f.h.resolvePlayer=async()=>identity.promise;
    const ws=new Socket();f.h.onConnection(ws,{headers:{},socket:{remoteAddress:'test'}});
    ws.emit('message',Buffer.from(JSON.stringify({t:MSG.HELLO,v:PROTOCOL_VERSION,name:'late'})),false);
    await turn();assert.equal(f.h.pendingJoins,1);
    inject(f,()=>lethal(f));f.h.server.step();identity.resolve(THIRD);
    await Promise.all([...f.h.joins]);assert.equal(f.h.server.clients.get(3).entity,0);assert.equal(f.h.profiles.clients.has(3),false);
    await settleAll(f);assert.equal(f.p.stats.deaths,1);
  } finally {identity.resolve(THIRD);await f.close();}
});

for(const mode of ['async','malformed','reentrant']) test('afterTick '+mode+' adapter cannot publish or replay a completed tick',()=>{
  let s, calls=0;const messages=[];
  const hook=(complete)=>{
    calls++;
    if(!complete)return false;
    s.broadcastSnapshot();s.flushEvents();
    if(mode==='async')return Promise.resolve(true);
    if(mode==='malformed')return undefined;
    try{s.step();}catch{}
    return true;
  };
  s=new LocalServer({seed:42,bots:0,enemies:false,send:(id,msg)=>messages.push(msg),afterTick:hook});
  s.connect(1);messages.length=0;const tick=s.world.tick;
  assert.throws(()=>s.step(),TypeError);assert.equal(s.world.tick,tick+1);assert.equal(messages.length,0);
  assert.equal(s.step(),false);s.broadcastSnapshot();assert.equal(messages.length,0);assert.equal(s.world.tick,tick+1);
  assert.equal(calls,2);
});

test('receipt advance independently checks exact applied profiles before refreshing the next baseline',async()=>{
  const f=await fixture({lawless:true});
  try {
    inject(f,()=>lethal(f));f.h.server.step();await f.h.deathStaging.settle();
    const drain=f.h.deathStaging.drain.bind(f.h.deathStaging);
    f.h.deathStaging.drain=()=>{
      const result=drain();if(result.some(r=>r.state==='applied'))f.w.profiles.get(f.k).gold+=1;
      return result;
    };
    assert.equal(f.h.server.step(),false);assert.equal(f.h.closing,true);assert.equal(f.h.combatDeaths.failed,true);
    assert.equal(f.p.stats.deaths,1);assert.equal((await f.db.store.loadProfile(VICTIM)).data.stats.deaths,1);
    assert.equal((await f.db.store.loadProfile(KILLER)).data.gold,0);assert.equal(events(f,'death').length,0);
    assert.equal(f.h.combatDeaths.count,1,'failed continuation retains the incident as evidence, never replays it');
  } finally {await f.close();}
});

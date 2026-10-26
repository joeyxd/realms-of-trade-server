import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from './helpers.mjs';
import { World } from '../src/sim/world.js';
import { NavalTrial } from '../src/sim/naval/trial.js';
import { NavalPilot } from '../src/sim/naval/pilot.js';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { attachRafts, installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { BTN } from '../src/sim/systems/movement.js';
import { airborne } from '../src/sim/ecs.js';
import { MSG, ENT, PROTOCOL_VERSION, encodeEntity } from '../src/net/protocol.js';
import { WEAPON } from '../src/data/weapons.js';
import { setWeapon } from '../src/sim/systems/skills.js';
import { findRaftWaterExit, SWIM_BOARDING_RANGE } from '../src/sim/naval/swimBoarding.js';
import { GameClient } from '../src/client/gameClient.js';
import { LocalServer } from '../src/net/localServer.js';
import { NavalPilotServer } from '../src/net/navalPilotServer.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { LiveNavigationView } from '../src/client/liveNavigationView.js';

function fixture({ notch = false } = {}) {
  const sea = { ...map, heights: new Float32Array(map.heights.length).fill(-2), groundAt: () => -2, onDock: () => false, queryColliders: () => [], colliders: [] };
  const w = new World(map.seed, { map: sea, server: true }); w.jumpMode = 'lab';
  installInventory(w, 'deck-moves'); installTrade(w); installRafts(w, 'deck-moves');
  const add = id => {
    const e = w.spawnPlayer({ clientId: id }), p = newProfile();
    prepareRaftProfile(w,p);
    if(notch && id===1) {
      const ship=p.eco.ships.find(s=>s.kind==='raft');
      ship.grid.parts=ship.grid.parts.filter(p=>p[0]!=='foundation' || p[1]!==1 || p[2]!==1);
      ship.grid.parts.push(['foundation',2,0,0,0],['foundation',2,1,0,0],['foundation',3,0,0,0],['foundation',3,1,0,0]);
      ship.grid.parts.find(p=>p[0]==='crate')[1]=2;
      ship.grid.parts.sort((a,b)=>(b[0]==='foundation')-(a[0]==='foundation'));
    }
    attachProfile(w,e,p); attachRafts(w,e,p); return e;
  };
  const owner = add(1), guest = add(2), source = [...w.rafts.values()].find(r => r.owner === owner);
  w.ecs.x[source.entity] = 0; w.ecs.z[source.entity] = 0;
  w.navalTrial = new NavalTrial(w, { coast: true, navigation: true });
  const pilot = w.navalPilot = new NavalPilot(w, { live: true });
  const raft = () => publicRafts(w).find(r => r.id === source.ship.id);
  const place = (e, local) => {
    const p = pilotPoint(raft(),local); w.ecs.x[e]=p.x; w.ecs.y[e]=p.y; w.ecs.z[e]=p.z; w.ecs.facing[e]=p.f;
  };
  w.raftDeck.update(publicRafts(w)); place(owner,raft().helm);
  place(guest,{ x: 1, y: 0, z: 3, f: 0 });
  assert.ok(pilot.invite(owner,source.ship.id,guest)); assert.ok(pilot.board(guest,source.ship.id));
  assert.ok(pilot.mount(owner,source.ship.id));
  let seq = 0;
  const step = (e, c = {}, steer = .4) => {
    const n=++seq, helm=pilot.snapshot(owner);
    if (helm.active) pilot.input(owner,{ epoch:helm.epoch,seq:n,throttle:1,brake:0,steer });
    w.applyCommand(e,{ seq:n,mx:0,mz:0,ax:w.ecs.x[e]+5,az:w.ecs.z[e],btn:0,prs:0,pt:w.tick,...c });
    w.stepWorld();
  };
  return { w,owner,guest,pilot,raft,step,place,shipId:source.ship.id };
}

test('jump on a moving turning deck carries the airborne body and remote JMP, then lands at takeoff', () => {
  const f=fixture(), {w,guest,pilot,step}=f;
  for(let i=0;i<100;i++) step(guest);
  assert.ok(Math.hypot(pilot.snapshot(f.owner).body.state.vx,pilot.snapshot(f.owner).body.state.vz)>.1);
  const takeoff=pilot.deckSnapshot(guest).state, yaw=f.raft().yaw;
  let apex=0, remote=false;
  for(let i=0;i<150;i++) {
    step(guest,{ prs:i===0?BTN.JUMP:0,btn:BTN.JUMP });
    assert.ok(pilot.walking(guest));
    apex=Math.max(apex,w.ecs.y[guest]-f.raft().y);
    remote ||= encodeEntity(w.ecs,guest)[ENT.JMP]>0 && airborne(w.ecs,guest);
    if(i>0 && !airborne(w.ecs,guest)) break;
  }
  const landed=pilot.deckSnapshot(guest).state;
  assert.ok(apex>=1,`apex ${apex}`); assert.ok(remote);
  assert.ok(Math.abs(f.raft().yaw-yaw)>.001);
  assert.ok(Math.hypot(landed.x-takeoff.x,landed.z-takeoff.z)<.1);
  assert.ok(Math.abs(landed.y-takeoff.y)<.1);
});

test('deck sword and pistol damage match identical land inputs', () => {
  for(const weapon of [WEAPON.SABLE,WEAPON.PISTOLAS]) {
    const run = deck => {
      const f=fixture(), {w,guest,pilot}=f;
      if(!deck) { w.raftDeck.update([]); w.navalPilot=null;
        w.map={...w.map,groundAt:()=>f.raft().y}; }
      const x=w.ecs.x[guest],z=w.ecs.z[guest];
      setWeapon(w,guest,weapon);
      const target=w.debugSpawn('dummy',x+1.5,z,0); w.ecs.y[target]=w.ecs.y[guest];
      const hp=w.ecs.hp[target];
      for(let i=0;i<45;i++) {
        w.applyCommand(guest,{seq:i+1,mx:0,mz:0,ax:x+5,az:z,btn:i===0?BTN.ATTACK:0,prs:i===0?BTN.ATTACK:0,pt:w.tick});
        w.stepWorld();
      }
      return hp-w.ecs.hp[target];
    };
    const deck=run(true),land=run(false); assert.ok(deck>0,`weapon ${weapon} damage ${deck}`); assert.equal(deck,land);
  }
});

test('walking over the edge releases a guest into water at the crossing, never at the dock', () => {
  const f=fixture(),{w,guest,pilot,step}=f;
  let before;
  for(let i=0;i<100 && pilot.walking(guest);i++) {
    before={x:w.ecs.x[guest],z:w.ecs.z[guest]};
    const yaw=f.raft().yaw; step(guest,{mx:Math.cos(yaw),mz:-Math.sin(yaw)});
  }
  assert.equal(pilot.walking(guest),false); assert.equal(w.ecs.swim[guest],1);
  assert.ok(Math.hypot(w.ecs.x[guest]-before.x,w.ecs.z[guest]-before.z)<.5);
  assert.equal(pilot.reboard(guest,f.shipId),false);
});

test('owner overboard at speed parks with guests aboard and reboards through the existing range', () => {
  const f=fixture(),{w,owner,guest,pilot,step}=f;
  for(let i=0;i<300;i++) step(guest,{},0);
  const moving=pilot.snapshot(owner); assert.ok(Math.hypot(moving.body.state.vx,moving.body.state.vz)>.8,JSON.stringify(moving.body.state));
  assert.ok(pilot.walk(owner,moving.epoch));
  for(let i=0;i<100 && pilot.walking(owner);i++) {
    const yaw=f.raft().yaw; step(owner,{mx:-Math.cos(yaw),mz:Math.sin(yaw)},0);
  }
  assert.equal(pilot.walking(owner),false); assert.equal(w.ecs.swim[owner],1);
  assert.equal(pilot.voyageSnapshot(owner).phase,'shore'); assert.ok(pilot.walking(guest));
  const parked=f.raft();
  for(let i=0;i<60;i++) step(owner,{},0);
  assert.ok(Math.hypot(f.raft().x-parked.x,f.raft().z-parked.z)<.05);
  const context=pilot.routeContext(owner); assert.equal(Math.hypot(context.body.state.vx,context.body.state.vz),0);
  const exit=findRaftWaterExit(w,{shipId:f.shipId,pose:f.raft(),parts:f.raft().parts,
    from:pilotPoint(f.raft(),f.raft().helm),radius:w.ecs.radius[owner]}); assert.ok(exit);
  w.ecs.x[owner]=exit.water.x; w.ecs.y[owner]=exit.y; w.ecs.z[owner]=exit.water.z;
  assert.ok(Math.hypot(exit.water.x-exit.deck.x,exit.water.z-exit.deck.z)<=SWIM_BOARDING_RANGE);
  assert.ok(pilot.reboard(owner,f.shipId)); assert.ok(pilot.walking(owner)); assert.ok(pilot.walking(guest));
});

test('helm parks ordinary jump and sword commands; DECK_INPUT is retired at protocol 72', () => {
  const {w,owner,pilot,step}=fixture(), p=[w.ecs.x[owner],w.ecs.y[owner],w.ecs.z[owner]];
  w.applyCommand(owner,{seq:1,mx:1,mz:0,btn:BTN.JUMP|BTN.ATTACK,prs:BTN.JUMP|BTN.ATTACK,ax:0,az:0,pt:0});
  assert.deepEqual([w.ecs.x[owner],w.ecs.y[owner],w.ecs.z[owner]],p);
  assert.equal(w.ecs.jmpAct[owner],0); assert.equal(w.ecs.atkStage[owner],0);
  assert.equal(PROTOCOL_VERSION,72); assert.equal(MSG.DECK_INPUT,undefined);
  assert.ok(pilot.walk(owner,pilot.snapshot(owner).epoch));
  step(owner,{prs:BTN.JUMP,btn:BTN.JUMP});
  assert.equal(pilot.helm(owner,pilot.snapshot(owner).epoch),false);
});

function clientFixture(Server = LocalServer) {
  const messages=[], server=new Server({seed:map.seed,navigation:true,jump:'lab',bots:0,enemies:false,send:(id,m)=>messages.push([id,structuredClone(m)])});
  const callbacks=[],snapshots=[];
  server.connect(1);server.connect(2);
  const transport={ start(){},onMessage:f=>callbacks.push(f),onSnapshot:f=>snapshots.push(f),
    send:m=>server.receive(2,m),sendInput:(_s,c)=>server.receive(2,{t:MSG.INPUTS,cmds:[c]}) };
  const client=new GameClient(transport,server.world.map,{emit(){}});client.start();client.join('Guest',0,0);
  server.receive(1,{t:MSG.HELLO,v:PROTOCOL_VERSION,name:'Owner',skin:0,weapon:0,save:''});
  const deliver=()=>{while(messages.length){const[id,m]=messages.shift();if(id===2)for(const cb of m.t===MSG.SNAPSHOT?snapshots:callbacks)cb(m);}};
  deliver(); const w=server.world,owner=server.clients.get(1).entity,guest=client.youServer;
  const raft=publicRafts(w).find(r=>r.owner===owner);
  for(const[e,anchor] of [[owner,raft.helm],[guest,{x:1,y:0,z:3,f:0}]]) {
    const p=pilotPoint(raft,anchor); w.ecs.x[e]=p.x;w.ecs.y[e]=p.y;w.ecs.z[e]=p.z;w.ecs.facing[e]=p.f;
  }
  assert.ok(w.navalPilot.invite(owner,raft.id,guest));assert.ok(w.navalPilot.board(guest,raft.id));assert.ok(w.navalPilot.mount(owner,raft.id));
  server.broadcastSnapshot();deliver();assert.ok(client.deck.active);
  return { server, client, deliver, w, owner, guest, raft };
}

test('GameClient replays normal jump and stick inputs in the turning raft frame through delayed ACKs', () => {
  const {server,client,deliver,w,owner,guest}=clientFixture();
  for(let i=0;i<30;i++) {
    w.navalPilot.input(owner,{epoch:w.navalPilot.snapshot(owner).epoch,seq:i+1,throttle:1,brake:0,steer:.5});
    client.tickInput({mx:.05,mz:0,ax:client.cur.x+5,az:client.cur.z,prs:i===0?BTN.JUMP:0,btn:BTN.JUMP});
    server.step();server.broadcastSnapshot(); if(i%3===2)deliver();
  }
  deliver();const a=client.deck.state,b=w.navalPilot.deckSnapshot(guest).state;
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.05);
  assert.ok(w.ecs.jmpAct[guest]>0);assert.equal(client.pending.length,0);
});

test('D1: an external hit survives a commandless sync and displaces a walker like land', () => {
  const run = deck => {
    const f=fixture(),{w,guest,pilot}=f, s=w.ecs;
    if(!deck) { w.navalPilot=null; w.raftDeck.update([]); w.map={...w.map,groundAt:()=>f.raft().y}; }
    const start={x:s.x[guest],z:s.z[guest]};
    hurtPlayer(w,guest,1,{x:start.x,z:start.z-1,knock:3,kind:'melee',seq:0});
    s.vx[guest]=.2;
    if(deck) {
      pilot.sync();
      assert.ok(Math.abs(s.kbz[guest]-3)<1e-5);
      assert.ok(Math.abs(s.vx[guest]-.2)<1e-5);
    }
    for(let i=0;i<15;i++) {
      w.applyCommand(guest,{seq:i+1,mx:0,mz:0,btn:0,prs:0,ax:start.x,az:start.z+5,pt:w.tick});
      w.stepWorld();
    }
    return {x:s.x[guest]-start.x,z:s.z[guest]-start.z};
  };
  const deck=run(true),land=run(false);
  assert.ok(land.z>.1); assert.ok(Math.hypot(deck.x-land.x,deck.z-land.z)<.1);
});

for(const Server of [LocalServer,NavalPilotServer]) test(`D2: ${Server.name} late command advances deck ACK with land ACK`, () => {
  const {server,client,deliver}=clientFixture(Server),c=server.clients.get(2);
  c.fillPt=server.world.tick+10;
  client.tickInput({mx:0,mz:0});
  const seq=client.seq;
  assert.equal(c.queue.length,1);
  server.step(); server.broadcastSnapshot(); deliver();
  assert.equal(server.stats.late,1); assert.equal(c.ack,seq);
  assert.equal(client.deck.ack,c.ack); assert.equal(client.ackSeq,c.ack);
  assert.equal(client.pending.length,0);
});

test('D3: a guest crosses a deck notch in flight without releasing the voyage', () => {
  const f=fixture({notch:true}),{w,guest,owner,pilot,step}=f;
  for(let i=0;i<30 && pilot.deckSnapshot(guest).state.x<1.7;i++) {
    const yaw=f.raft().yaw; step(guest,{mx:Math.cos(yaw),mz:-Math.sin(yaw)},0);
  }
  let crossed=false,landed=false;
  for(let i=0;i<160;i++) {
    const local=pilot.deckSnapshot(guest).state;
    const mx=local.x<4.6?1:-1;
    const yaw=f.raft().yaw;
    step(guest,{mx:mx*Math.cos(yaw),mz:-mx*Math.sin(yaw),btn:BTN.JUMP,prs:i===0?BTN.JUMP:0},0);
    assert.ok(pilot.walking(guest),`seat retained at tick ${i}, local x ${local.x}`);
    assert.ok(pilot.snapshot(owner).active,'owner retains the voyage');
    if(airborne(w.ecs,guest) && !w.raftDeck.surface(w.ecs.x[guest],w.ecs.z[guest])) crossed=true;
    if(i>0 && !airborne(w.ecs,guest)) { landed=true; break; }
  }
  assert.ok(crossed,'flew over the missing footprint cell'); assert.ok(landed);
});

test('D3: a jump past the rail keeps its raft frame until it reaches the water', () => {
  const f=fixture(),{w,guest,pilot,step}=f;
  let outside=false;
  for(let i=0;i<180 && pilot.walking(guest);i++) {
    step(guest,{mx:1,btn:BTN.JUMP,prs:i===0?BTN.JUMP:0},0);
    if(airborne(w.ecs,guest)) {
      assert.ok(pilot.walking(guest));
      outside ||= !w.raftDeck.surface(w.ecs.x[guest],w.ecs.z[guest]);
    }
  }
  assert.ok(outside); assert.equal(pilot.walking(guest),false);
  assert.equal(w.ecs.swim[guest],1); assert.equal(airborne(w.ecs,guest),false);
});

test('D4: the owner jumps onto a dry dock, parks the voyage and uses F to reboard', () => {
  const f=fixture(),{w,owner,guest,pilot,step}=f, s=w.ecs;
  const edge=4, height=f.raft().y;
  w.map={...w.map,groundAt:x=>x>=edge?height:-2,onDock:x=>x>=edge}; w.raftDeck.map=w.map;
  assert.ok(pilot.walk(owner,pilot.snapshot(owner).epoch));
  for(let i=0;i<180 && pilot.walking(owner);i++)
    step(owner,{mx:1,btn:BTN.JUMP,prs:i===0?BTN.JUMP:0},0);
  assert.equal(pilot.walking(owner),false); assert.equal(s.swim[owner],0);
  const voyage=pilot.voyageSnapshot(owner);
  assert.equal(voyage.phase,'shore'); assert.equal(voyage.shoreService,true); assert.ok(voyage.landing);
  assert.ok(pilot.walking(guest));
  const parked=f.raft();
  for(let i=0;i<60;i++) step(owner,{},0);
  assert.ok(Math.hypot(f.raft().x-parked.x,f.raft().z-parked.z)<.05);
  const view=Object.create(LiveNavigationView.prototype),client={joined:true,youServer:owner,
    cur:{x:s.x[owner],z:s.z[owner]},voyage};
  Object.assign(view,{getClient:()=>client,isActive:()=>true,input:{enabled:true},world:w,
    command:(op,id)=>{assert.equal(op,'reboard');return pilot.reboard(owner,id);}});
  const action=view.navigationInteraction(); assert.equal(action.key,'F'); assert.ok(action.run());
  assert.equal(pilot.voyageSnapshot(owner).phase,'sailing'); assert.ok(pilot.snapshot(owner).active);
});

test('D5: rescuing an airborne walker clears jump height and velocity', () => {
  const {w,guest,pilot,step}=fixture(); step(guest,{btn:BTN.JUMP,prs:BTN.JUMP});
  assert.ok(airborne(w.ecs,guest)); assert.ok(pilot.leaveDeck(guest,pilot.deckSnapshot(guest).epoch));
  assert.equal(w.ecs.jmpAct[guest],0); assert.equal(w.ecs.jmpVy[guest],0);
  assert.equal(w.ecs.jmpPeak[guest],w.ecs.y[guest]);
});

test('D5: missing raft pose still tracks sent sequences and accepts their later ACK', () => {
  const {server,client,deliver}=clientFixture(),render=client.renderRafts;
  client.renderRafts=()=>[]; client.tickInput({mx:0,mz:0}); client.renderRafts=render;
  assert.equal(client.deck.seq,client.seq);
  server.step(); server.broadcastSnapshot(); deliver();
  assert.equal(client.deck.ack,client.seq); assert.equal(client.pending.length,0);
});

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

function fixture() {
  const sea = { ...map, heights: new Float32Array(map.heights.length).fill(-2), groundAt: () => -2, onDock: () => false, queryColliders: () => [], colliders: [] };
  const w = new World(map.seed, { map: sea, server: true }); w.jumpMode = 'lab';
  installInventory(w, 'deck-moves'); installTrade(w); installRafts(w, 'deck-moves');
  const add = id => {
    const e = w.spawnPlayer({ clientId: id }), p = newProfile();
    prepareRaftProfile(w,p); attachProfile(w,e,p); attachRafts(w,e,p); return e;
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

test('GameClient replays normal jump and stick inputs in the turning raft frame through delayed ACKs', () => {
  const messages=[], server=new LocalServer({seed:map.seed,navigation:true,jump:'lab',bots:0,enemies:false,send:(id,m)=>messages.push([id,structuredClone(m)])});
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
  for(let i=0;i<30;i++) {
    w.navalPilot.input(owner,{epoch:w.navalPilot.snapshot(owner).epoch,seq:i+1,throttle:1,brake:0,steer:.5});
    client.tickInput({mx:.05,mz:0,ax:client.cur.x+5,az:client.cur.z,prs:i===0?BTN.JUMP:0,btn:BTN.JUMP});
    server.step();server.broadcastSnapshot(); if(i%3===2)deliver();
  }
  deliver();const a=client.deck.state,b=w.navalPilot.deckSnapshot(guest).state;
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.05);
  assert.ok(w.ecs.jmpAct[guest]>0);assert.equal(client.pending.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NAVAL_SAIL as S } from '../src/data/navalSail.js';
import { NAVAL_CAMERA as C } from '../src/data/navalCamera.js';
import { WW_ANGLE as A } from '../src/data/navalHandling.js';
import { createSailCloth, stepSailCloth, sailF3 } from '../src/render/naval/sailCloth.js';
import { createBoatCamera, stepBoatCamera } from '../src/render/naval/boatCamera.js';
import { RaftLayer } from '../src/render/rafts.js';
import { LiveNavigationView } from '../src/client/liveNavigationView.js';
const wrap = (a) => a-65536*Math.floor((a+32768)/65536);
const near = (a,b,e=1e-5) => assert.ok(Math.abs(a-b)<e, `${a} vs ${b}`);
const tick = (s, options = {}, n = 1) => { for(let i=0;i<n;i++) stepSailCloth(s,{dt:1/30,...options}); };

test('boom uses camera constants, 16/max/min smoothing and the eleven-degree hysteresis', () => {
  const s = createSailCloth(2.45,2.8);
  tick(s,{windYaw:Math.PI/2}); near(s.boom,-C.sailAngle/16);
  tick(s,{windYaw:-0.1}); assert.equal(s.boomAim,-C.sailAngle);
  tick(s,{windYaw:-0.3}); assert.equal(s.boomAim,C.sailAngle);
  tick(s,{windYaw:0.1}); assert.equal(s.boomAim,C.sailAngle);
  s.boom=C.sailAngle-1; tick(s,{windYaw:-1}); assert.equal(s.boom,C.sailAngle);
  s.boom=-30000; tick(s,{windYaw:-1}); near(s.boom,-30000+0x800);
  for(let d=0;d<8;d++) {
    const sail=createSailCloth(2,3), camera=createBoatCamera(), windYaw=d*Math.PI/4, yaw=0.17;
    stepBoatCamera(camera,{yaw,windYaw}); tick(sail,{yaw,windYaw});
    for(let i=0;i<90;i++) { tick(sail,{yaw,windYaw}); stepBoatCamera(camera,{dt:1/30,yaw,windYaw}); }
    near(sail.boom,camera.sail); assert.equal(sail.boomAim,camera.sailAim);
  }
});
test('zero-angle chord points aft, and beam-wind belly moves downwind in raft space', () => {
  const aft=new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);
  near(aft.x,0); near(aft.z,-1);
  for(const side of [-1,1]) {
    const s=createSailCloth(2.45,2.8); tick(s,{windYaw:side*Math.PI/2,strength:1},180);
    let belly=0;
    for(let i=0;i<84;i++) if(Math.abs(s.cur[i*3+2])>Math.abs(s.cur[belly*3+2])) belly=i;
    const j=belly*3, a=Math.PI/2+s.boom*A;
    const dx=Math.cos(a)*s.cur[j]+Math.sin(a)*s.cur[j+2];
    assert.ok(dx*side>0.5, `downwind belly ${dx}`);
  }
});
test('opening threshold, fifteen-frame over-billow, settling and OFF gain', () => {
  const s=createSailCloth(2,3); tick(s); assert.equal(s.sailOn,false);
  tick(s); assert.equal(s.sailOn,false); tick(s); assert.equal(s.sailOn,true);
  tick(s); assert.equal(s.timer,14); tick(s,{},2); near(s.g,1.414);
  tick(s,{},12); near(s.g,1.414); tick(s); assert.ok(s.g<1.414);
  tick(s,{},150); near(s.g,1,1e-6);
  tick(s,{sailOn:false}); assert.equal(s.sailOn,false);
  tick(s,{sailOn:false},150); near(s.g,1-0.65*s.furl,1e-6); assert.equal(s.latch,false);
});
test('furl rates are exactly 3/11 opening and 3/13 closing, without height scaling', () => {
  const s=createSailCloth(2,3);
  tick(s,{},3); near(s.furl,1-9/11); tick(s); assert.equal(s.furl,0);
  tick(s,{sailOn:false},4); near(s.furl,12/13); tick(s,{sailOn:false}); assert.equal(s.furl,1);
  // Isolate base bunching from flutter/folds by evaluating a zero-weight, zero-fold mast vertex.
  near(sailF3(0,1),0.03); near(sailF3(4,1),0.066);
  // Brailed chord = f3*rest plus the sheet's folds/phase residual, with the explicit head pin adaptation.
  for(let r=0;r<11;r++) for(let c=0;c<7;c++) {
    const i=r*7+c, pin=Math.min(1,(11-r)/2), chord=s.rest[i*3]+s.cur[i*3];
    const base=s.rest[i*3]*(1-pin+pin*sailF3(r,1));
    assert.ok(Math.abs(chord-base)<0.16, `fold envelope r${r} c${c}: ${chord-base}`);
  }
});
test('phi1 advances by 2500 + 7200 power; bottom weights, travelling flutter and head pin are exact', () => {
  for(const strength of [0,0.3,1,2]) {
    const s=createSailCloth(2.9,3.65); tick(s,{strength,sailOn:false});
    near(s.phi1,wrap(2500+7200*Math.min(strength,1)));
    for(let c=0;c<7;c++) {
      const weight=[0,21,36,40,36,21,0][c], fs=(0.064*Math.abs(Math.cos(s.psi*A))+0.02)*Math.sin((s.phi1+c*7500)*A)*weight;
      const f4=120*0.05*(Math.sin((s.phi2+10922*c)*A)-0.5*Math.sin(s.boom*A))*(9-(3-c)**2)/9*0.5;
      near(s.cur[c*3+2],(f4+0.35*fs*s.g)*0.01);
    }
    for(let j=77*3;j<84*3;j++) near(s.cur[j],0);
  }
});
test('identical WW frame sequences at 30, 60 and 144 fps; buffers reused and hitch limited to four', () => {
  const run=(fps) => {
    const s=createSailCloth(2.45,2.8), snapshots=[], out=s.out, offsets=out.offsets, normals=out.normals;
    for(let segment=0;segment<3;segment++) {
      for(let i=0;i<fps;i++) stepSailCloth(s,{dt:1/fps,windYaw:segment-1,strength:segment/2,sailOn:segment!==2});
      snapshots.push({frame:s.frame,boom:s.boom,g:s.g,furl:s.furl,phi1:s.phi1,positions:[...s.cur],normals:[...s.normals]});
    }
    assert.equal(s.out,out); assert.equal(out.offsets,offsets); assert.equal(out.normals,normals);
    stepSailCloth(s,{dt:1}); assert.equal(out.steps,4); return snapshots;
  };
  const baseline=run(30); assert.deepEqual(run(60),baseline); assert.deepEqual(run(144),baseline);
});
test('moving rig owns the indexed grid and unit normals, leaves static sails intact and retains DoubleSide', () => {
  for(const sailingRig of [false,true]) {
    const layer=new RaftLayer(new THREE.Scene(),{skin:false,sailingRig});
    try {
      layer.update([{id:'sail',parts:[['floor',0,0,0,0],['sail',0,0,0,0]]}],0);
      const view=layer.views.get('sail');
      if(!sailingRig) { assert.equal(view.sails.length,0); continue; }
      const sail=view.sails[0]; assert.ok(sail); assert.equal(sail.cloth.geometry.attributes.position.count,84);
      const index=sail.cloth.geometry.index.array;
      assert.deepEqual([...index.slice(0,6)],[0,1,7,1,8,7]);
      for(let i=0;i<40;i++) layer.setSailing('sail',{active:true,dt:1/30,windYaw:Math.PI/2,strength:1});
      assert.equal(sail.motion.furl,0); assert.equal(sail.cloth.scale.y,1);
      assert.equal(sail.cloth.material.side,THREE.DoubleSide); assert.equal(sail.cloth.material.transparent,false);
      const n=sail.cloth.geometry.attributes.normal;
      for(let i=0;i<n.count;i++) near(Math.hypot(n.getX(i),n.getY(i),n.getZ(i)),1);
    } finally { layer.dispose(); }
  }
});
test('local lever/helm/park and remote public pose/helm determine sailOn per raft', () => {
  const v=Object.create(LiveNavigationView.prototype), calls=[];
  v.helmVisuals=new Map(); v.sail=1; v.world={rafts:{setSailing:(id,opts)=>{calls.push([id,opts]);}}};
  const c={naval:{shipId:'local',wind:{yaw:0,strength:0.7}},deck:{active:false}};
  const local={id:'local',x:0,z:0,yaw:0,helm:{x:0,y:0,z:0,f:0}}, remote={...local,id:'remote',crew:[{mode:'helm'}]};
  const records=[local,remote], body={wind:{yaw:0,strength:1},state:{tick:0}};
  const run=()=>{ calls.length=0; v.updateAllHelms(records,1/30,body,c); return calls.map(([,o])=>o.sailOn); };
  assert.deepEqual(run(),[true,false]); remote.x+=0.02; assert.deepEqual(run(),[true,true]);
  c.deck.active=true; remote.crew=[]; remote.x+=0.02; assert.deepEqual(run(),[false,false]);
  c.deck.active=false; body.parked=true; assert.deepEqual(run(),[false,false]);
  body.parked=false; v.sail=0; assert.deepEqual(run(),[false,false]);
});

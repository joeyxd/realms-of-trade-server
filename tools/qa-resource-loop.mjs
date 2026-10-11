#!/usr/bin/env node
// D08c.7 browser acceptance: authoritative coastal gathering -> bench -> raft build -> reconnect.
// Each run uses a fresh ephemeral GameHost + memory store, local vendor routes and isolated browser data.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const out=resolve('docs/delivery/d08c7-resource-loop'); await mkdir(out,{recursive:true});
const pw=process.env.MN_PLAYWRIGHT?pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  :pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const {chromium}=await import(pw);
const evidence={generatedAt:new Date().toISOString(),purpose:'Server-owned coastal gather, wood crafting, raft editor use, save/reconnect and shared depletion.',
  harness:'fresh ephemeral GameHost per viewport; memory profile store; local Three.js/GSAP; browser contexts isolated; no .env or external storage.',
  setup:'QA fixture moves server ECS players to deterministic node, bench and helm positions; gather/craft/build actions themselves use the real keyboard/touch/UI and server protocol.',
  performanceClaim:false,viewports:[],failures:[]};
const check=(v,m)=>{if(!v)throw new Error(m);}; const pause=(ms)=>new Promise(r=>setTimeout(r,ms));
const bounds=(el)=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
async function waitForTick(host,tick,timeout=45000){const deadline=Date.now()+timeout;while(serverFor(host).world.tick<tick&&Date.now()<deadline)await pause(50);
  check(serverFor(host).world.tick>=tick,`world tick stalled before ${tick}: ${serverFor(host).world.tick}`);}
async function waitCalm(host,e,timeout=30000){const w=serverFor(host).world,deadline=Date.now()+timeout;while(w.ecs.regenT[e]<3&&Date.now()<deadline)await pause(50);
  check(w.ecs.regenT[e]>=3,`actor ${e} did not reach 3s calm: regenT=${w.ecs.regenT[e]}`);}
const allSpecs=[
  {name:'resource-desktop-1280x720',width:1280,height:720,touch:false},
  {name:'resource-mobile-844x390',width:844,height:390,touch:true},
  {name:'resource-portrait-390x844',width:390,height:844,touch:true},
];
const browser=await chromium.launch({...(process.env.MN_BROWSER?{executablePath:process.env.MN_BROWSER}:{channel:'chrome'}),headless:true,
  args:['--use-gl=angle','--use-angle=default','--enable-webgl','--ignore-gpu-blocklist']});
async function localRoutes(page){
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/,async(route)=>{
    const m=route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);if(!m)return route.abort();
    const file=resolve(m[1].startsWith('three')?'node_modules/three':'.scratch/gsap-local/package',m[2]);
    if(!fs.existsSync(file))return route.abort();return route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(file)});
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,r=>r.fulfill({status:200,body:''}));
}
async function newPage(context,port,result,label){
  console.log(`[${result.name}] ${label}: open page`);
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(`${label}: ${e?.stack||e}`));
  page.on('websocket',ws=>{result.websockets??=[];const entry={label,url:ws.url(),closed:false};result.websockets.push(entry);
    ws.on('close',()=>entry.closed=true);ws.on('socketerror',err=>entry.error=String(err));});
  page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(`${label}: ${m.text()}`);});
  await localRoutes(page);await page.goto(`http://127.0.0.1:${port}/?debug&q=low`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mn&&!document.querySelector('#btn-play')?.disabled,null,{timeout:180000});
  console.log(`[${result.name}] ${label}: app ready, joining`);
  await page.locator('#btn-play').click({force:true});
  await page.waitForFunction(()=>window.__mn?.client?.joined&&window.__mn?.st?.mode==='playing',null,{timeout:90000}).catch(async err=>{
    result.joinFailure=await page.evaluate(()=>{const m=window.__mn;return{joined:m?.client?.joined,mode:m?.st?.mode,inputEnabled:m?.input?.enabled,
      paused:m?.st?.paused,errors:m?.errors,connection:document.querySelector('#connection-overlay')?.innerText,
      profile:!!m?.client?.profile,transport:m?.transport?.ws?.readyState,close:window.__qaWsClose};}).catch(e=>({evaluateError:String(e)}));throw err;
  });
  await page.waitForFunction(()=>window.__mn?.input?.enabled&&!window.__mn?.st?.paused,null,{timeout:20000});
  console.log(`[${result.name}] ${label}: joined`);
  await page.waitForFunction(()=>Array.isArray(window.__mn.client.resources?.nodes)&&window.__mn.client.resources.nodes.length>0,null,{timeout:30000});
  await page.evaluate(()=>{const r=window.__mn.resources;window.__qaResourceAcks=[];window.__qaWsClose=null;window.__mn.transport?.onClose?.(v=>window.__qaWsClose={code:v.code,reason:v.reason});const on=r.onResult.bind(r);
    r.onResult=(ev)=>{window.__qaResourceAcks.push({op:ev.op,opId:ev.opId,ok:!!ev.ok,why:ev.why||'',good:ev.good||'',rev:ev.rev});return on(ev);};});
  return page;
}
function serverFor(host){return host.game.server;}
function playerEntity(page){return page.evaluate(()=>window.__mn.client.youServer);}
function activeClient(server,e){for(const [id,c] of server.clients)if(c.entity===e)return{id,c};return null;}
async function wirePeer(port,result){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`),events=[];let welcome=null;
  ws.on('message',raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}events.push(msg);
    if(msg.t==='welcome')welcome=msg;});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('wire peer WebSocket open timeout')),15000);
    ws.once('open',()=>{clearTimeout(timer);resolve();});ws.once('error',err=>{clearTimeout(timer);reject(err);});});
  const hello={t:'hello',v:PROTOCOL_VERSION,name:'Resource Peer',skin:0,weapon:0,save:''};ws.send(JSON.stringify(hello));
  const deadline=Date.now()+15000;while(!welcome&&Date.now()<deadline)await pause(25);
  if(!welcome?.you)result.wireHandshakeFailure={readyState:ws.readyState,bufferedAmount:ws.bufferedAmount,
    received:events.map(m=>m.t==='event'?{t:m.t,type:m.ev?.type,op:m.ev?.op,code:m.ev?.code}:m.t),helloSent:hello};
  check(welcome?.you>0,`wire peer did not receive WELCOME: ${JSON.stringify(events.slice(-5))}`);
  const peer={ws,e:welcome.you,events,serial:0,
    command(command){return new Promise((resolve,reject)=>{const id=++peer.serial,timer=setTimeout(()=>reject(new Error(`wire peer command timeout: ${JSON.stringify(command)}`)),12000);
      const onMessage=raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}if(msg.t==='event'&&msg.ev?.type==='resource'&&msg.ev.opId===command.opId){clearTimeout(timer);ws.off('message',onMessage);resolve(msg.ev);}};
      ws.on('message',onMessage);ws.send(JSON.stringify({t:'cmd',type:'resource',...command}));});},
    close(){try{ws.close(1000);}catch{}}};
  result.wirePeer={protocol:PROTOCOL_VERSION,entity:peer.e,scene:false,close:null};
  ws.once('close',(code,reason)=>{result.wirePeer.close={code,reason:reason.toString()};});return peer;
}
function relocate(host,e,p){const server=serverFor(host),w=server.world,c=w.ecs;
  c.x[e]=p.x;c.y[e]=p.y;c.z[e]=p.z;c.vx[e]=c.vz[e]=c.kbx[e]=c.kbz[e]=c.moveMag[e]=0;
  c.dashT[e]=-1;c.dashBuffer[e]=0;c.atkStage[e]=0;c.castK[e]=0;c.castLock[e]=0;
  server.broadcastSnapshot();
}
async function waitAt(page,p){await page.waitForFunction(({x,y,z})=>{const m=window.__mn,e=m.client.youLocal,c=m.client.pred.ecs;
  return Math.hypot(c.x[e]-x,c.y[e]-y,c.z[e]-z)<.65;},p,{timeout:15000});}
async function state(page){return page.evaluate(()=>{const m=window.__mn,p=m.client.profile,ship=p?.eco?.ships?.find(s=>s.kind==='raft');
  return{pack:{...p?.eco?.pack?.goods},packCap:p?.eco?.pack?.cap,tradeRev:p?.eco?.tradeRev,gold:p?.gold,shipRev:ship?.rev,
    parts:ship?.grid?.parts?.map(p=>[...p])||[],hold:{...ship?.hold?.goods},player:{x:m.ps.x,y:m.ps.y,z:m.ps.z},errors:[...m.errors]};});}
async function snap(page,name,result){await page.waitForTimeout(100);const file=resolve(out,`${result.name}-${name}.png`);
  await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);}
async function interact(page,spec,verb){
  await page.waitForFunction((v)=>window.__mn.resources.interaction()?.verb===v,verb,{timeout:15000});
  return dispatchInteract(page,spec,verb);
}
async function dispatchInteract(page,spec,verb){
  const before=await page.evaluate(()=>window.__qaResourceAcks.length);
  if(spec.touch){const b=page.locator('#touch .t-act');await page.waitForFunction(()=>{const e=document.querySelector('#touch .t-act');return e&&!e.hidden&&e.getBoundingClientRect().width>0;});
    const action=await b.evaluate(el=>({verb:el.getAttribute('aria-label'),rect:(()=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()}));
    check(action.verb===verb,`touch action button does not match ${verb}: ${JSON.stringify(action)}`);await b.tap({force:true});
  }else await page.keyboard.press('KeyF');
  if(verb==='Preparar'){
    await page.waitForFunction(()=>window.__mn.panels.workbench.active);
    if(spec.touch)await page.locator('.wb-confirm').tap();else await page.locator('.wb-confirm').click();
  }
  await page.waitForFunction((n)=>window.__qaResourceAcks.length>n,before,{timeout:20000});
  const ack=await page.evaluate(n=>window.__qaResourceAcks[n],before);
  if(verb==='Preparar'){
    await page.waitForFunction(()=>!window.__mn.panels.workbench.pending);
    if(spec.touch)await page.locator('.wb-close').tap();else await page.locator('.wb-close').click();
  }
  return ack;
}
async function settleAck(page,rev){await page.waitForFunction((n)=>!window.__mn.resources.pending&&window.__mn.client.profile?.eco?.tradeRev>=n,rev,{timeout:20000});}
async function captureState(page,host,e){const p=serverFor(host).world.profiles.get(e);return{gold:p.gold,tradeRev:p.eco.tradeRev,pack:{...p.eco.pack.goods},cap:p.eco.pack.cap};}
async function waitCurrentSave(page,server,e,priorBlob){const deadline=Date.now()+30000;let checkSave;
  while(Date.now()<deadline){const pc=activeClient(server,e),blob=pc?.c?.lastBlob;
    if(pc&&pc.c.saveAt==null&&typeof blob==='string'&&blob&&blob!==priorBlob){
      checkSave=await page.evaluate(expected=>{const h=new URL(window.__mn.transport.url).host,k=`mareanegra.v1.save.online.${h}`,v=localStorage.getItem(k)||'';return{keySuffix:h,nonempty:!!v,length:v.length,exactMatch:v===expected};},blob);
      if(checkSave.exactMatch)return checkSave;
    }
    await pause(250);
  }
  throw new Error(`current signed profile save did not reach browser storage: ${JSON.stringify({saveAt:activeClient(server,e)?.c?.saveAt,hasLastBlob:!!activeClient(server,e)?.c?.lastBlob,checkSave})}`);
}
async function renderNode(page,id){return page.evaluate(id=>{const m=window.__mn,view=m.world.resources,r=view?.records?.get(id),n=m.client.resources.nodes.find(x=>x.id===id);
  return{snapshotNode:n?{id:n.id,kind:n.kind,x:n.x,y:n.y,z:n.z,rev:n.rev,ready:n.ready,wait:n.wait}:null,
    diagnostic:view?.group?.userData?.resources||null,
    rendered:r?{groupVisible:r.group.visible,meshVisible:r.mesh.visible,x:r.group.position.x,y:r.group.position.y,z:r.group.position.z,
      vertices:r.mesh.geometry?.attributes?.position?.count||0}:null,
    snapshotBytes:new TextEncoder().encode(JSON.stringify(m.client.resources)).length};},id);}
async function buildRailing(page,spec,host,e,result){
  const server=serverFor(host),raft=publicRafts(server.world).find(r=>r.owner===e);check(raft?.helm,'fixture raft lacks an accessible helm anchor');
  relocate(host,e,pilotPoint(raft,raft.helm));await waitAt(page,pilotPoint(raft,raft.helm));
  if(spec.touch){await page.waitForFunction(()=>{const b=document.querySelector('.raft-build-launcher'),r=b?.getBoundingClientRect();return b&&!b.hidden&&r?.width>0;},{},{timeout:15000});await page.locator('.raft-build-launcher').tap({force:true});}
  else await page.keyboard.press('KeyB');
  await page.waitForFunction(()=>window.__mn.panels.raftEditor.active,null,{timeout:15000});
  await page.locator('[data-part="railing"]').click({force:true});
  const attempts=[];
  const anyProjectedCell=await page.evaluate(async()=>{const THREE=await import('three'),{stage}=await import('./src/ui/stage.js'),m=window.__mn,r=m.client.pred.rafts.find(q=>q.owner===m.client.youServer);
    return [[0,0],[1,0],[0,1],[1,1]].some(([x,z])=>{const lx=(x+.5)*2,lz=(z+.5)*2,cx=Math.cos(r.yaw),sx=Math.sin(r.yaw);
      const p=new THREE.Vector3(r.x+cx*lx+sx*lz,r.y,r.z-sx*lx+cx*lz).project(m.world.camera),px=(p.x+1)*stage.w/2,py=(1-p.y)*stage.h/2,
        screen=stage.rotated?{x:innerWidth-py,y:px}:{x:px,y:py};return screen.x>=0&&screen.y>=0&&screen.x<innerWidth&&screen.y<innerHeight;});});
  if(!anyProjectedCell){await page.evaluate(async()=>{const THREE=await import('three'),m=window.__mn,e=m.client.youLocal,c=m.client.pred.ecs,focus=new THREE.Vector3(c.x[e],c.y[e],c.z[e]);
      m.world.rig.blend=null;m.world.rig.snapTo(focus);});await page.waitForTimeout(250);result.cameraSnapForAcceptance=true;}
  for(const cell of [[0,0],[1,0],[0,1],[1,1]]){
    const projected=await page.evaluate(async({x,z})=>{const THREE=await import('three'),{stage}=await import('./src/ui/stage.js'),m=window.__mn;
      const r=m.client.pred.rafts.find(q=>q.owner===m.client.youServer),cx=Math.cos(r.yaw),sx=Math.sin(r.yaw),lx=(x+.5)*2,lz=(z+.5)*2;
      const world={x:r.x+cx*lx+sx*lz,y:r.y,z:r.z-sx*lx+cx*lz},v=new THREE.Vector3(world.x,world.y,world.z).project(m.world.camera);
      const px=(v.x+1)*stage.w/2,py=(1-v.y)*stage.h/2,screen=stage.rotated?{x:innerWidth-py,y:px}:{x:px,y:py};
      const canvas=m.world.renderer.domElement.getBoundingClientRect(),hit=document.elementFromPoint(screen.x,screen.y);
      return{cell:{x,z},screen,world,hit:hit?.id||hit?.className||hit?.tagName,inside:screen.x>=0&&screen.y>=0&&screen.x<innerWidth&&screen.y<innerHeight,
        raft:{x:r.x,y:r.y,z:r.z,yaw:r.yaw},camera:{x:m.world.camera.position.x,y:m.world.camera.position.y,z:m.world.camera.position.z},
        stage:{w:stage.w,h:stage.h,rotated:stage.rotated},canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},editorContext:!!m.panels.raftEditor.context()};},{x:cell[0],z:cell[1]});
    if(!projected.inside||projected.hit!=='game'){attempts.push({...projected,reason:'not canvas'});continue;}
    if(spec.touch)await page.touchscreen.tap(projected.screen.x,projected.screen.y);else await page.mouse.move(projected.screen.x,projected.screen.y);
    await page.waitForTimeout(80);
    const targetState=await page.evaluate(()=>{const b=window.__mn.panels.raftEditor;return{target:b.target,dir:b.dir,selected:b.selected,
      actionDisabled:b.root.querySelector('.re-action').disabled,status:b.root.querySelector('.re-status').textContent,local:b.lastPointer};});
    attempts.push({...projected,targetState});
    if(targetState.target&&!targetState.actionDisabled&&targetState.status.includes('Lugar válido'))break;
  }
  const last=attempts[attempts.length-1];result.editorAim={attempts};
  const targetState=last?.targetState;
  check(targetState?.target&&!targetState.actionDisabled&&targetState.status.includes('Lugar válido'),
    `raft editor could not aim at a valid railing cell: ${JSON.stringify(result.editorAim)}`);
  check(targetState.target&&!targetState.actionDisabled&&targetState.status.includes('Lugar válido'),
    `raft editor could not aim at a valid railing cell: ${JSON.stringify(targetState)}`);
  await page.waitForFunction(()=>{const b=document.querySelector('.raft-editor .re-action');return b&&!b.disabled;},null,{timeout:10000});
  const before=await state(page);check(before.pack.madera===1,'bench output did not reach pack before raft editor');
  await page.locator('.raft-editor .re-action').click({force:true});
  await page.waitForFunction(()=>{const m=window.__mn,p=m.client.profile,s=p?.eco?.ships?.find(q=>q.kind==='raft');return !m.panels.raftEditor.pending&&s?.grid?.parts?.some(q=>q[0]==='railing');},null,{timeout:25000});
  const after=await state(page);check((after.pack.madera||0)===0&&after.parts.some(p=>p[0]==='railing')&&after.shipRev>before.shipRev,
    `raft editor failed to consume prepared wood: ${JSON.stringify({before,after})}`);
  const railing=after.parts.find(p=>p[0]==='railing');
  result.build={piece:'railing',position:railing?.slice(1),part:railing,before,after};
  await page.locator('.raft-editor .re-close').click({force:true});await snap(page,'03-raft-railing',result);
}

async function runViewport(spec){
  console.log(`[${spec.name}] host start`);
  const result={...spec,status:'running',screenshots:[],errors:[],consoleErrors:[],gathers:[]};evidence.viewports.push(result);
  result.serverLog=[];
  const host=createGameServer({port:0,host:'127.0.0.1',seed:0x5eaf00d,bots:0,maxPlayers:2,dev:true,
    store:createMemoryStore(),worldId:null,saveSecret:`qa-resource-loop-${spec.name}`,chat:{enabled:false},log(...args){result.serverLog.push(args.map(String).join(' '));if(result.serverLog.length>80)result.serverLog.shift();}});
  result.serverMessages=[];
  let context,wire;
  try{
    const port=await host.listen();const sim=host.game.server,receive=sim.receive.bind(sim);sim.receive=(id,msg,...rest)=>{
      if(msg?.t==='hello'||(msg?.t==='cmd'&&msg.type==='resource'))result.serverMessages.push({id,t:msg.t,name:msg.name||'',v:msg.v,op:msg.op||'',node:msg.node||''});
      return receive(id,msg,...rest);};
    context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:1,hasTouch:spec.touch,isMobile:spec.touch});
    console.log(`[${spec.name}] host ready on ephemeral port`);
    const page=await newPage(context,port,result,'owner'),e=await playerEntity(page),server=serverFor(host),w=server.world;
    const nodes=page.evaluate(()=>window.__mn.client.resources.nodes);result.resources=await nodes;
    const woods=result.resources.filter(n=>n.kind==='wood'),stone=result.resources.find(n=>n.kind==='stone');
    check(woods.length>=3&&stone,`resource fixture lacks 3 wood nodes and a stone: ${JSON.stringify(result.resources)}`);
    result.bench=server.world.resources.bench;check(result.bench,'resource fixture has no workbench');
    result.initial=await captureState(page,host,e);await snap(page,'00-fresh-world',result);

    const used=new Set();
    if(spec.name.includes('desktop')){
      const node=woods[0];wire=await wirePeer(port,result);const e2=wire.e,peerId=activeClient(server,e2)?.id,rec=server.world.resources.nodes.get(node.id);
      check(peerId!==undefined&&rec?.rev===node.rev,'shared resource fixture revision mismatch');relocate(host,e,node);relocate(host,e2,node);
      await Promise.all([waitAt(page,node),page.waitForFunction(()=>window.__mn.resources.interaction()?.verb==='Recoger')]);
      await Promise.all([waitCalm(host,e),waitCalm(host,e2)]);
      const raceStart={owner:await state(page),peer:await captureState(page,host,e2),nodeRev:rec.rev};
      const renderBefore=await renderNode(page,node.id);
      check(renderBefore.rendered?.groupVisible&&renderBefore.rendered.meshVisible&&renderBefore.rendered.vertices>0,
        `wood resource was not visibly rendered from the server snapshot: ${JSON.stringify(renderBefore)}`);
      await page.waitForFunction(()=>window.__mn.resources.interaction()?.verb==='Recoger',null,{timeout:10000});
      const ackA=await dispatchInteract(page,spec,'Recoger');
      const ackB=await wire.command({op:'gather',opId:'shared-race-1',node:node.id,expectedRev:node.rev});
      result.raceAcks={owner:ackA,peer:ackB,node:publicNode(server,node.id),client:await page.evaluate(id=>({acks:window.__qaResourceAcks,resources:window.__mn.client.resources.nodes.find(n=>n.id===id)}),node.id)};
      await page.waitForFunction(({id,rev})=>{const n=window.__mn.client.resources.nodes.find(q=>q.id===id);return n&&n.rev===rev+1&&!n.ready;},{id:node.id,rev:node.rev},{timeout:10000});
      const raceEnd={owner:await captureState(page,host,e),peer:await captureState(page,host,e2),node:publicNode(server,node.id),acks:[ackA,ackB]};
      await page.waitForFunction(id=>window.__mn.world.resources.records.get(id)?.mesh.visible===false,node.id,{timeout:5000});
      raceEnd.render=await renderNode(page,node.id);
      check([ackA.ok,ackB.ok].filter(Boolean).length===1&&raceEnd.node.rev===node.rev+1&&!raceEnd.node.ready,
        `shared resource did not permit exactly one gather: ${JSON.stringify({raceStart,raceEnd})}`);
      check((raceEnd.owner.pack.tronco||0)+(raceEnd.peer.pack.tronco||0)===1,'simultaneous peer gather duplicated or lost a trunk');
      check(raceEnd.render.rendered?.groupVisible&&!raceEnd.render.rendered.meshVisible,
        `depleted resource renderer did not follow authoritative snapshot: ${JSON.stringify(raceEnd.render)}`);
      result.sharedDepletion={node:node.id,mode:'owner UI action followed by peer wire action with same expectedRev',raceStart,raceEnd,renderBefore};used.add(node.id);
      await waitForTick(host,server.world.tick+30);
      // A truly full pack is seeded only on the secondary QA profile, then a real protocol command is rejected.
      const fullBefore=await captureState(page,host,e2),secondWood=woods.find(n=>n.id!==node.id&&n.ready);
      check(secondWood,'no spare wood node for full-pack rejection');
      const fullPack={cap:fullBefore.cap,goods:{agua:fullBefore.cap}};server.world.profiles.get(e2).eco.pack=structuredClone(fullPack);
      const pc=activeClient(server,e2);server.sendProfile(pc.id,pc.c);server.broadcastSnapshot();
      relocate(host,e2,secondWood);
      await waitCalm(host,e2);
      const deny=await wire.command({op:'gather',opId:'full-pack-deny-1',node:secondWood.id,expectedRev:secondWood.rev});
      const unchangedNode=publicNode(server,secondWood.id),stillFull=await captureState(page,host,e2);
      check(!deny.ok&&deny.why==='full'&&unchangedNode.rev===secondWood.rev&&unchangedNode.ready&&
        stillFull.tradeRev===fullBefore.tradeRev&&stillFull.pack.agua===fullPack.cap,
        `full backpack did not reject without depletion/mutation: ${JSON.stringify({deny,unchangedNode,stillFull})}`);
      result.fullPack={deny,node:unchangedNode,profile:stillFull,fixture:'test-only full bag; no currency injected'};
      const pp=server.world.profiles.get(e2);pp.eco.pack=structuredClone({cap:fullBefore.cap,goods:fullBefore.pack});server.sendProfile(pc.id,pc.c);server.broadcastSnapshot();
      wire.close();wire=null;
    }
    const startTrunks=spec.name.includes('desktop')?(await captureState(page,host,e)).pack.tronco||0:0;
    const gatherTargets=woods.filter(n=>!used.has(n.id)).slice(0,Math.max(0,2-startTrunks));
    for(const node of gatherTargets){
      relocate(host,e,node);await waitAt(page,node);await waitCalm(host,e);const before=await captureState(page,host,e),oldRev=publicNode(server,node.id).rev;
      const renderBefore=await renderNode(page,node.id);
      check(renderBefore.rendered?.groupVisible&&renderBefore.rendered.meshVisible&&renderBefore.snapshotNode?.ready,
        `gather target missing visible resource mesh: ${JSON.stringify(renderBefore)}`);
      const ack=await interact(page,spec,'Recoger');if(!ack.ok)throw new Error(`server rejected wood gather ${node.id}: ${JSON.stringify(ack)}`);
      await settleAck(page,before.tradeRev+1);await page.waitForFunction(id=>!window.__mn.client.resources.nodes.find(n=>n.id===id)?.ready,node.id,{timeout:10000});
      const after=await captureState(page,host,e),worldNode=publicNode(server,node.id);
      const renderAfter=await renderNode(page,node.id);
      check((after.pack.tronco||0)===(before.pack.tronco||0)+1&&after.tradeRev===before.tradeRev+1&&worldNode.rev===oldRev+1&&!worldNode.ready,
        `wood gather failed authoritative conservation: ${JSON.stringify({node:node.id,before,after,worldNode,ack})}`);
      result.gathers.push({node:node.id,kind:'wood',ack,before,after,worldNode,renderBefore,renderAfter});used.add(node.id);
      await waitForTick(host,server.world.tick+30);
    }
    relocate(host,e,stone);await waitAt(page,stone);const stoneBefore=await captureState(page,host,e),stoneRev=publicNode(server,stone.id).rev;
    await waitCalm(host,e);const stoneRenderBefore=await renderNode(page,stone.id);check(stoneRenderBefore.rendered?.meshVisible,'stone resource mesh not visible at harvest target');
    const stoneAck=await interact(page,spec,'Recoger');if(!stoneAck.ok)throw new Error(`server rejected stone gather: ${JSON.stringify(stoneAck)}`);
    await settleAck(page,stoneBefore.tradeRev+1);const stoneAfter=await captureState(page,host,e),stoneWorld=publicNode(server,stone.id);
    const stoneRenderAfter=await renderNode(page,stone.id);
    check((stoneAfter.pack.piedra||0)===(stoneBefore.pack.piedra||0)+1&&stoneWorld.rev===stoneRev+1&&!stoneWorld.ready,
      `stone gather failed: ${JSON.stringify({stoneBefore,stoneAfter,stoneWorld,stoneAck})}`);
    result.gathers.push({node:stone.id,kind:'stone',ack:stoneAck,before:stoneBefore,after:stoneAfter,worldNode:stoneWorld,renderBefore:stoneRenderBefore,renderAfter:stoneRenderAfter});
    check(stoneAfter.gold===result.initial.gold,'gathering changed gold');await snap(page,'01-harvested',result);

    // Two logs fit with one stone; crafting one proves the usable loop and preserves the stone.
    const trunkCount=(await state(page)).pack.tronco||0;check(trunkCount>=2,`need 2 logs to prepare and continue; got ${trunkCount}`);
    relocate(host,e,result.bench);await waitAt(page,result.bench);await waitForTick(host,server.world.tick+180,90000);
    await page.waitForFunction(()=>window.__mn.resources.interaction()?.verb==='Preparar',null,{timeout:15000});
    const craftBefore=await captureState(page,host,e),craftAck=await interact(page,spec,'Preparar');
    if(!craftAck.ok)throw new Error(`server rejected bench recipe: ${JSON.stringify(craftAck)}`);
    await settleAck(page,craftBefore.tradeRev+1);const craftAfter=await captureState(page,host,e);
    check(craftAfter.tradeRev===craftBefore.tradeRev+1&&craftAfter.pack.tronco===craftBefore.pack.tronco-1&&craftAfter.pack.madera===1&&craftAfter.gold===craftBefore.gold,
      `bench did not conserve 1 trunk -> 1 wood: ${JSON.stringify({craftBefore,craftAfter,craftAck})}`);
    result.craft={recipe:'madera',ack:craftAck,before:craftBefore,after:craftAfter};
    const benchPose={x:result.bench.x+1.2,z:result.bench.z,y:server.world.map.groundAt(result.bench.x+1.2,result.bench.z)};
    if(Number.isFinite(benchPose.y)&&Math.hypot(benchPose.x-result.bench.x,benchPose.z-result.bench.z)<3){
      relocate(host,e,benchPose);await waitAt(page,benchPose);result.craftScreenshotPose=benchPose;
    }
    await snap(page,'02-bench-crafted',result);

    const priorBlob=activeClient(server,e)?.c?.lastBlob||'';
    await buildRailing(page,spec,host,e,result);
    result.beforeReconnect=await state(page);
    result.savePresent=await waitCurrentSave(page,server,e,priorBlob);
    check(result.savePresent.nonempty,'server did not provide the online profile save');
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__mn&&!document.querySelector('#btn-play')?.disabled,null,{timeout:180000});
    await page.locator('#btn-play').click({force:true});await page.waitForFunction(()=>window.__mn?.client?.joined&&window.__mn.st.mode==='playing',null,{timeout:90000});
    await page.waitForFunction(()=>window.__mn.client.profile?.eco?.ships?.some(s=>s.grid.parts.some(p=>p[0]==='railing'))&&
      window.__mn.client.profile.eco.pack.goods.piedra>=1,null,{timeout:30000});
    result.afterReconnect=await state(page);
    check(result.afterReconnect.tradeRev===result.beforeReconnect.tradeRev&&result.afterReconnect.shipRev===result.beforeReconnect.shipRev&&
      JSON.stringify(result.afterReconnect.pack)===JSON.stringify(result.beforeReconnect.pack)&&
      result.afterReconnect.parts.some(p=>p[0]==='railing')&&result.afterReconnect.gold===result.initial.gold,
      `saved profile or raft plan changed on reconnect: ${JSON.stringify({before:result.beforeReconnect,after:result.afterReconnect})}`);
    result.reconnect='same signed online save restored after reload';await snap(page,'04-reconnected',result);
    check(result.errors.length===0&&result.consoleErrors.length===0,`browser errors: ${JSON.stringify({page:result.errors,console:result.consoleErrors})}`);
    result.status='passed';await context.close();context=null;
  }catch(err){result.status='failed';result.failure=String(err?.stack||err);evidence.failures.push(`${spec.name}: ${err?.message||err}`);
    result.hostDebug={status:host.game.status(),sockets:[...host.game.sockets.keys()],clients:[...host.game.server.clients].map(([id,c])=>({id,entity:c.entity})),serverMessages:result.serverMessages};
    if(context?.pages()[0])result.ownerDebug=await context.pages()[0].evaluate(()=>({close:window.__qaWsClose,joined:window.__mn?.client?.joined,mode:window.__mn?.st?.mode,transport:window.__mn?.transport?.ws?.readyState,connection:document.querySelector('#connection-overlay')?.innerText})).catch(e=>({error:String(e)}));
    try{if(context?.pages()[0]){const file=resolve(out,`${spec.name}-failure.png`);await context.pages()[0].screenshot({path:file,fullPage:false});result.screenshots.push(file);}}catch{}
  }finally{if(wire)wire.close();if(context)await context.close().catch(()=>{});await host.close();}
}
function publicNode(server,id){const r=server.world.resources.nodes.get(id);return r?{id:r.id,kind:r.kind,rev:r.rev,ready:r.readyTick<=server.world.tick,readyTick:r.readyTick,tick:server.world.tick}:null;}
const selected=process.env.MN_RESOURCE_LOOP_VIEWPORT
  ?allSpecs.filter(s=>s.name===process.env.MN_RESOURCE_LOOP_VIEWPORT):allSpecs;
check(selected.length>0,'MN_RESOURCE_LOOP_VIEWPORT did not match a configured case');
try{for(const spec of selected)await runViewport(spec);}finally{await browser.close();}
evidence.status=evidence.failures.length?'failed':'passed';evidence.finishedAt=new Date().toISOString();
await writeFile(resolve(out,process.env.MN_RESOURCE_LOOP_VIEWPORT?`resource-loop-${process.env.MN_RESOURCE_LOOP_VIEWPORT}.json`:'resource-loop-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({status:evidence.status,viewports:evidence.viewports.map(v=>({name:v.name,status:v.status,failure:v.failure,screenshots:v.screenshots})),out},null,2));
if(evidence.status!=='passed')process.exitCode=1;

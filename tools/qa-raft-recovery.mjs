#!/usr/bin/env node
// D08c.11 browser acceptance for restoring and recovering a saved damaged raft.
// Runs against isolated ephemeral memory hosts; fixture damage and away placement are trusted QA setup.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { ownerRaftCapacity } from '../src/sim/systems/raftCapacity.js';
import { applyPartDamage } from '../src/sim/naval/structure.js';
import { encodeRaftCondition, persistRaftCondition } from '../src/sim/naval/condition.js';
import { encodeRaftVoyage, restoredRaftPose } from '../src/sim/naval/recovery.js';
import { GAME } from '../src/data/meta.js';
import { hmacSaves } from '../server/saves.mjs';

const out = resolve('docs/delivery/d08c11-raft-recovery');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Verify a real signed SAVE restores the same damaged raft at its safe saved sea pose while the player returns to checkpoint without pilot or crew; recover through the harbor UI, repair once, and reload the repaired docked save.',
  harness: 'Three fresh isolated ephemeral GameHosts per viewport, same GAME.seed, HMAC save secret and browser localStorage slot, in-memory stores; local Three.js/GSAP/font routes and normal Chrome renderer; no .env, SQL or external hosts.',
  fixture: 'Trusted host-side QA setup writes a safe away pose, exact 30/60 foundation damage, and madera cargo into the owner profile, then asks LocalServer to issue its normal HMAC-signed SAVE over the real browser transport. Reconnect and all recovery/repair actions use the real UI and client/server protocol. Damage and saved placement are fixtures, not proof of a real coastal impact.',
  expected: { restored: { pieceHp: 30, pieceMaxHp: 60, hold: { madera: 3 }, pilot: false, crew: false, playerAtCheckpoint: true }, repaired: { pieceHp: 60, pieceMaxHp: 60, hold: { madera: 1 }, pack: { madera: 1 }, voyage: null } },
  protocolVersion: PROTOCOL_VERSION,
  performanceClaim: false,
  viewports: [],
  failures: [],
};
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
const specs = [
  { name:'raft-recovery-desktop-1280x720', width:1280, height:720, touch:false },
  { name:'raft-recovery-mobile-844x390', width:844, height:390, touch:true },
  { name:'raft-recovery-portrait-390x844', width:390, height:844, touch:true },
];
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath:process.env.MN_BROWSER } : { channel:'chrome' }),
  headless:true, args:['--use-gl=angle','--use-angle=default','--enable-webgl','--ignore-gpu-blocklist'] });
const serverFor = (host) => host.game.server;
async function installLocalRoutes(page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match=route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/); if(!match)return route.abort();
    const file=resolve(match[1].startsWith('three')?'node_modules/three':'.scratch/gsap-local/package',match[2]);
    if(!fs.existsSync(file))return route.abort();
    return route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(file)});
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,route=>route.fulfill({status:200,body:''}));
}
async function waitCalm(server, entity, timeout=60000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline&&server.world.ecs.regenT[entity]<3)await pause(50);
  check(server.world.ecs.regenT[entity]>=3,`owner did not reach calm: regenT=${server.world.ecs.regenT[entity]}`);
}
async function snapCameraToPlayer(page,point) {
  await page.waitForFunction(({x,z})=>{const m=window.__mn,e=m?.client?.youLocal,c=m?.client?.pred?.ecs;return e!=null&&c&&Math.hypot(c.x[e]-x,c.z[e]-z)<.8;},{x:point.x,z:point.z},{timeout:20000});
  await page.evaluate(async()=>{const THREE=await import('three'),m=window.__mn,e=m.client.youLocal,c=m.client.pred.ecs;m.world.rig.blend=null;m.world.rig.snapTo(new THREE.Vector3(c.x[e],c.y[e],c.z[e]));});
  await page.waitForTimeout(250);
}
async function openApp(page,port,result) {
  page.on('pageerror',e=>result.errors.push(String(e?.stack||e)));
  page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
  page.on('requestfailed',r=>result.requestFailures.push({url:r.url(),method:r.method(),error:r.failure()?.errorText||''}));
  page.on('response',r=>{if(r.status()>=400)result.httpFailures.push({url:r.url(),status:r.status()});});
  await installLocalRoutes(page);await page.goto(`http://127.0.0.1:${port}/?debug&q=low`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mn&&!document.querySelector('#btn-play')?.disabled,null,{timeout:180000});
  await page.locator('#btn-play').click({force:true});
  await page.waitForFunction(()=>window.__mn?.client?.joined&&window.__mn?.st?.mode==='playing',null,{timeout:90000});
  await page.waitForFunction(()=>window.__mn?.input?.enabled&&!window.__mn?.st?.paused,null,{timeout:30000});
  await page.evaluate(()=>{
    const editor=window.__mn.panels.raftEditor,send=editor.send.bind(editor),onResult=editor.onResult.bind(editor);
    window.__qaRepairSends=[];window.__qaRepairAcks=[];window.__qaRepairClicks=0;
    editor.send=m=>{window.__qaRepairSends.push({...m});return send(m);};
    editor.onResult=e=>{window.__qaRepairAcks.push({type:e?.type,op:e?.op,ok:e?.ok,why:e?.why,rev:e?.rev,opId:e?.opId,
      repair:e?.repair?{...e.repair,cost:{...(e.repair.cost||{})}}:null});return onResult(e);};
    editor.root.querySelector('.re-action').addEventListener('click',()=>window.__qaRepairClicks++,true);
  });
  return page.evaluate(()=>window.__mn.client.youServer);
}
async function snap(page,result,label) {
  await page.waitForTimeout(120);const run=evidence.generatedAt.replace(/[:.]/g,'-');const file=resolve(out,`${result.name}-${run}-${label}.png`);
  await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);
}
function conditionView(c) {
  if(!c?.condition)return null;
  return {hull:{...c.condition.hull},entries:c.condition.entries.map(e=>({index:e.index,id:e.id,piece:[...e.piece],hp:e.hp,maxHp:e.maxHp,cost:{...e.cost}}))};
}
function safeAwayPose(world, ship, condition) {
  const source=[...world.rafts.values()].find(r=>r.ship===ship), home={x:world.ecs.x[source.entity],z:world.ecs.z[source.entity]};
  for(let x=-world.map.half+12;x<world.map.half-12;x+=8)for(let z=-world.map.half+12;z<world.map.half-12;z+=8){
    if(Math.hypot(x-home.x,z-home.z)<32)continue;
    ship.voyage={v:1,seed:world.seed>>>0,pose:[x,z,0.7]};
    const pose=restoredRaftPose(world,ship,condition);if(pose)return pose;
  }
  throw new Error('no safe away pose exists for the recovery fixture');
}
async function run(spec) {
  const result={...spec,status:'running',errors:[],consoleErrors:[],requestFailures:[],httpFailures:[],screenshots:[]};evidence.viewports.push(result);
  const secret=`qa-raft-recovery-${spec.name}`;
  const createHost=(port)=>createGameServer({port,host:'127.0.0.1',seed:GAME.seed,bots:0,maxPlayers:1,dev:true,store:createMemoryStore(),worldId:null,
    saveSecret:secret,chat:{enabled:false},log(){}});
  let host=createHost(0),context,port,page,entity,server,world,profile,ship,targetId,targetTuple,originalBlueprint,signedSave;
  try {
    console.log(`[${spec.name}] starting first isolated memory host`);port=await host.listen();
    context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:1,hasTouch:spec.touch,isMobile:spec.touch});
    page=await context.newPage();entity=await openApp(page,port,result);
    server=serverFor(host);world=server.world;profile=world.profiles.get(entity);ship=profile?.eco?.ships?.find(s=>s.kind==='raft'&&s.at==='aldea');
    check(profile&&ship&&ship.hp>0,'fresh profile missing starter raft');
    const source=world.rafts.get(ship.id);check(source?.condition,'fresh raft has no operational condition');
    originalBlueprint=ship.grid.parts.map(p=>[...p]);
    const target=source.condition.entries.find(entry=>entry.part[0]==='foundation');check(target,'fresh raft has no foundation to damage');
    targetId=target.id;targetTuple=[...target.part];
    source.condition=applyPartDamage(source.condition,targetId,30).structure;persistRaftCondition(source);
    ship.hold.goods={...(ship.hold.goods||{}),madera:3};profile.eco.pack.goods={...(profile.eco.pack.goods||{}),madera:1};
    profile.eco.tradeRev++;ship.rev++;
    const away=safeAwayPose(world,ship,source.condition);ship.voyage=encodeRaftVoyage(world,away);
    const home={x:source.home.x,z:source.home.z};
    const ownerClient=[...server.clients.entries()].find(([,client])=>client.entity===entity);
    check(ownerClient,'browser owner has no live server transport');server.sendSave(ownerClient[0],ownerClient[1]);
    const saveKey=`${GAME.saveKey}.save.online.127.0.0.1:${port}`;
    await page.waitForFunction(key=>!!localStorage.getItem(key),saveKey,{timeout:15000});
    signedSave=await page.evaluate(key=>localStorage.getItem(key),saveKey);
    const signedShip=hmacSaves(secret).load(signedSave)?.eco?.ships?.find(candidate=>candidate.id===ship.id);
    check(signedShip?.condition?.entries?.some(row=>row[0]===targetId&&row[6]===30),'normal SAVE did not sign the fixture damage');
    check(signedShip?.voyage?.pose?.[0]===away.x&&signedShip?.voyage?.pose?.[1]===away.z,'normal SAVE did not sign the safe away pose');
    result.fixture={shipId:ship.id,partId:targetId,piece:targetTuple,blueprint:originalBlueprint,hold:{...ship.hold.goods},pack:{...profile.eco.pack.goods},
      safeAwayPose:ship.voyage.pose,home,seed:GAME.seed,saveTransport:'LocalServer.sendSave -> actual browser WebSocket -> main.js storeSave',
      savedBlobVerifiedByServerSigner:true,damageSource:'trusted fixture applyPartDamage; not a real impact'};
    result.firstSignedSave={key:saveKey,length:signedSave.length,condition:signedShip.condition,voyage:signedShip.voyage};
    await host.close();host=null;await page.close();page=null;
    console.log(`[${spec.name}] restarting same-seed host and reconnecting signed browser save`);
    host=createHost(port);check(await host.listen()===port,'second host did not reclaim the original save slot port');
    page=await context.newPage();entity=await openApp(page,port,result);
    server=serverFor(host);world=server.world;profile=world.profiles.get(entity);ship=profile?.eco?.ships?.find(candidate=>candidate.id===result.fixture.shipId);
    check(profile&&ship,'signed reconnect did not restore the original raft record');
    const restored=world.rafts.get(ship.id),voyage=world.navalPilot.voyageSnapshot(entity),naval=world.navalPilot.snapshot(entity);
    const currentOwnerClient=[...server.clients.entries()].find(([,client])=>client.entity===entity);
    check(currentOwnerClient,'reconnected owner has no live server transport');
    const restoredEntry=restored?.condition?.entries?.find(entry=>entry.id===targetId);
    check(restoredEntry?.hp===30&&restoredEntry.maxHp===60,`signed reconnect lost exact damaged piece: ${JSON.stringify(restoredEntry)}`);
    check(JSON.stringify(ship.grid.parts)===JSON.stringify(originalBlueprint),'signed reconnect changed the saved raft blueprint');
    check(ship.hold.goods.madera===3&&profile.eco.pack.goods.madera===1,'signed reconnect lost hold or backpack cargo');
    check(voyage.active&&voyage.phase==='shore'&&voyage.recovery===true,'signed reconnect did not restore a shore recovery state');
    check(!naval.active&&!world.navalPilot.aboard(entity)&&!world.navalPilot.walking(entity),'recovery created a helm, deck crew, or pilot body');
    check(Math.abs(world.ecs.x[entity]-world.ecs.cpX[entity])<1e-6&&Math.abs(world.ecs.z[entity]-world.ecs.cpZ[entity])<1e-6,
      'recovery moved the player away from the normal checkpoint');
    check(restored&&Math.hypot(world.ecs.x[restored.entity]-away.x,world.ecs.z[restored.entity]-away.z)<1e-6,'restored boat is not at the saved away pose');
    result.reconnect={playerCheckpoint:{x:world.ecs.cpX[entity],z:world.ecs.cpZ[entity]},voyage,navalActive:!!naval.active,aboard:world.navalPilot.aboard(entity),
      raft:{shipId:ship.id,pose:{x:world.ecs.x[restored.entity],z:world.ecs.z[restored.entity]},part:restoredEntry,hold:{...ship.hold.goods},blueprint:ship.grid.parts.map(p=>[...p])}};
    await page.evaluate(id=>{window.__qaPartId=id;},targetId);
    await page.waitForFunction(({id,shipId})=>window.__mn.client.voyage?.active&&window.__mn.client.voyage?.recovery&&
      window.__mn.client.capacity?.id===shipId&&window.__mn.client.capacity.condition?.entries?.some(entry=>entry.id===id&&entry.hp===30),{id:targetId,shipId:ship.id},{timeout:20000});
    await page.waitForFunction(()=>document.querySelector('.live-navigation')?.classList.contains('is-recovery'),null,{timeout:5000});
    const recoveryUi=await page.evaluate(()=>{const objective=document.querySelector('.ln-touch-objective'),rect=objective?.getBoundingClientRect();return{phase:document.querySelector('.ln-phase')?.textContent,routeLabel:document.querySelector('[data-target-label]')?.textContent,
      target:document.querySelector('[data-target]')?.textContent,objective:document.querySelector('[data-touch-objective]')?.textContent||null,
      objectiveDetail:document.querySelector('[data-touch-load]')?.textContent||null,
      objectiveVisible:!!rect&&rect.width>0&&rect.height>0&&getComputedStyle(objective).display!=='none',
      compassHidden:!document.querySelector('.ln-touch-compass')||getComputedStyle(document.querySelector('.ln-touch-compass')).display==='none',
      windHidden:!document.querySelector('.ln-touch-wind')||getComputedStyle(document.querySelector('.ln-touch-wind')).display==='none',
      actions:window.__mn.navigation.interaction()?.actions?.map(action=>({key:action.key,verb:action.verb,prompt:action.prompt}))||[]};});
    check(/BALSA RECUPERABLE/i.test(recoveryUi.phase||''),'recovery UI does not explain that the saved raft is recoverable');
    check(!recoveryUi.actions.some(action=>action.key==='F'),'recovery UI exposed a fake reboard action without landing');
    check((recoveryUi.routeLabel==='RECUPERAR EN PUERTO'&&recoveryUi.target==='Puerto')||recoveryUi.objective?.includes('RECUPERA TU BALSA EN PUERTO'),
      `recovery UI does not guide the player to the harbor: ${JSON.stringify(recoveryUi)}`);
    if(spec.touch){
      check(recoveryUi.objectiveVisible&&recoveryUi.objective==='BALSA RECUPERABLE'&&/Posición guardada · Puerto/.test(recoveryUi.objectiveDetail||''),
        `touch recovery guidance is not visible with the saved position: ${JSON.stringify(recoveryUi)}`);
      check(recoveryUi.compassHidden&&recoveryUi.windHidden,'touch recovery showed sailing compass or wind controls without an active boat');
    }
    result.recoveryUi=recoveryUi;await snap(page,result,'00-signed-recovery-away');

    const dock=world.map.dock,portPoint={x:dock.base.x+dock.dir.x*Math.max(0,dock.len-10),z:dock.base.z+dock.dir.z*Math.max(0,dock.len-10)};
    world.ecs.x[entity]=portPoint.x;world.ecs.z[entity]=portPoint.z;world.ecs.y[entity]=world.map.groundAt(portPoint.x,portPoint.z);
    world.ecs.vx[entity]=world.ecs.vz[entity]=world.ecs.kbx[entity]=world.ecs.kbz[entity]=world.ecs.moveMag[entity]=0;
    server.broadcastSnapshot();await snapCameraToPlayer(page,portPoint);
    await page.waitForFunction(()=>!document.querySelector('.ln-prompt')?.hidden&&
      document.querySelector('.ln-prompt [data-run]')?.textContent==='Recuperar en puerto',null,{timeout:15000});
    check(world.navalPilot.voyageSnapshot(entity).recovery,'recovery state ended before the harbor action');
    if(spec.touch)await page.locator('.ln-prompt [data-run]').tap();else await page.locator('.ln-prompt [data-run]').click();
    await page.waitForFunction(()=>!window.__mn.client.voyage?.active,null,{timeout:20000});
    const recovered=world.rafts.get(ship.id),recoveredCapacity=ownerRaftCapacity(world,entity);
    check(recovered===restored,'harbor recovery replaced the raft instance');
    check(!world.navalPilot.voyageSnapshot(entity).active&&!world.navalPilot.snapshot(entity).active,'harbor recovery left a live voyage or pilot');
    check(recoveredCapacity.mode==='port'&&recoveredCapacity.condition.entries.find(entry=>entry.id===targetId)?.hp===30,
      'harbor recovery failed to return the same damaged raft to its berth');
    check(ship.hold.goods.madera===3,'harbor recall changed hold cargo');
    result.harborRecovery={action:'real prompt click/tap: Recuperar en puerto',shipId:ship.id,sameSource:recovered===restored,
      mode:recoveredCapacity.mode,pose:{x:world.ecs.x[recovered.entity],z:world.ecs.z[recovered.entity]},condition:conditionView(recoveredCapacity),
      hold:{...ship.hold.goods},voyage:world.navalPilot.voyageSnapshot(entity)};
    await snap(page,result,'01-recovered-at-port');
    await page.waitForFunction(id=>window.__mn.client.capacity?.id===id&&window.__mn.client.capacity.mode==='port'&&window.__mn.client.capacity.condition?.entries?.some(e=>e.id===window.__qaPartId&&e.hp===30),ship.id,{timeout:15000});
    await waitCalm(server,entity);await snap(page,result,'02-damaged-at-port');
    if(spec.touch)await page.locator('.raft-build-launcher').tap({force:true});else await page.keyboard.press('b');
    await page.waitForFunction(()=>window.__mn.panels.raftEditor.active,null,{timeout:15000});
    await page.locator('.raft-editor [data-mode="repair"]').click({force:true});
    await page.waitForFunction(id=>[...document.querySelectorAll('.re-repair-list [data-repair-id]')].some(b=>b.dataset.repairId===id),targetId,{timeout:15000});
    const listButton=page.locator(`.raft-editor [data-repair-id="${targetId}"]`);await listButton.click();
    await page.waitForFunction(id=>window.__mn.panels.raftEditor.repairChoiceId===id&&!!document.querySelector('.raft-editor .re-capacity'),targetId,{timeout:5000});
    const choice=await page.evaluate(()=>{const e=window.__mn.panels.raftEditor,c=e.context(),target=e.repairTarget(c),button=e.$('.re-action'),list=e.$(`[data-repair-id="${CSS.escape(target?.id||'')}"]`);return{mode:e.mode,active:e.active,target:target&&{id:target.id,piece:[...target.piece],hp:target.hp,maxHp:target.maxHp,cost:{...target.cost}},text:e.$('.re-details').innerText,status:e.$('.re-status').innerText,action:button.textContent,disabled:button.disabled,rect:button.getBoundingClientRect().toJSON(),listText:list?.innerText||'',capacity:c&&window.__mn.client.capacity&&{...window.__mn.client.capacity}};});
    check(choice.mode==='repair'&&choice.target?.id===targetId&&choice.target.hp===30&&choice.target.maxHp===60,'repair UI did not select the damaged target');
    check(JSON.stringify(choice.target.cost)===JSON.stringify({madera:2}),`repair UI forecast wrong cost: ${JSON.stringify(choice.target)}`);
    check(!choice.disabled&&/Confirmar reparación/i.test(choice.action)&&/30\/60 HP/.test(choice.text),'repair confirmation is not enabled or does not show damaged HP/cost');
    result.repairChoice=choice;await snap(page,result,'03-repair-forecast');

    const revBefore=ship.rev,holdBefore={...ship.hold.goods},packBefore={...profile.eco.pack.goods},blueprintBefore=ship.grid.parts.map(p=>[...p]);
    const sendBefore=await page.evaluate(()=>window.__qaRepairSends.length),ackBefore=await page.evaluate(()=>window.__qaRepairAcks.length);
    if(spec.touch)await page.locator('.raft-editor .re-action').tap();else await page.locator('.raft-editor .re-action').click();
    await page.waitForFunction(n=>window.__qaRepairSends.length>n,sendBefore,{timeout:10000});
    await page.waitForFunction(n=>window.__qaRepairAcks.length>n,ackBefore,{timeout:20000});
    const sentAck=await page.evaluate(({s,a})=>({send:window.__qaRepairSends[s],ack:window.__qaRepairAcks[a],clicks:window.__qaRepairClicks}),{s:sendBefore,a:ackBefore});
    check(sentAck.send?.op==='repair'&&sentAck.send.partId===targetId&&sentAck.send.expectedHp===30&&sentAck.ack?.ok===true,
      `server did not accept the real repair action: ${JSON.stringify(sentAck)}`);
    check(sentAck.ack.rev===revBefore+1&&sentAck.ack.repair?.partId===targetId&&sentAck.ack.repair.hp===60&&
      sentAck.ack.repair.maxHp===60&&JSON.stringify(sentAck.ack.repair.cost)===JSON.stringify({madera:2})&&sentAck.ack.repair.reconstructed===false,
      `repair ACK did not confirm the same instance, exact restored HP, cost, and one revision: ${JSON.stringify(sentAck.ack)}`);
    await page.waitForFunction(rev=>{const e=window.__mn.panels.raftEditor,c=e.context(),condition=window.__mn.client.capacity?.condition;return c?.ship?.rev>rev&&!e.pending&&condition?.entries?.some(p=>p.id===window.__qaPartId&&p.hp===p.maxHp);},revBefore,{timeout:25000});
    const after=ownerRaftCapacity(world,entity),entry=after.condition.entries.find(e=>e.id===targetId);
    check(entry?.hp===60&&entry.maxHp===60,`authoritative repair did not restore same part to 60/60: ${JSON.stringify(entry)}`);
    check(ship.rev===revBefore+1,`repair advanced revision more than once: ${revBefore} -> ${ship.rev}`);
    check(JSON.stringify(ship.grid.parts)===JSON.stringify(blueprintBefore)&&ship.grid.parts.length===blueprintBefore.length&&
      JSON.stringify(ship.grid.parts[blueprintBefore.findIndex(p=>JSON.stringify(p)===JSON.stringify(targetTuple))])===JSON.stringify(targetTuple),
      'repair altered, duplicated, or moved the saved blueprint tuple');
    check(ship.hold.goods.madera===1&&profile.eco.pack.goods.madera===1,
      `repair did not consume 2 wood hold-first and preserve backpack unit: ${JSON.stringify({hold:ship.hold.goods,pack:profile.eco.pack.goods})}`);
    check(after.condition.hull.hp===240&&after.condition.hull.maxHp===240,'repaired hull total is not 240/240');
    result.repair={interaction:spec.touch?'touch tap on Confirmar reparación':'mouse click on Confirmar reparación',sentAck,
      before:{shipRev:revBefore,hold:holdBefore,pack:packBefore,blueprint:blueprintBefore,hp:30,maxHp:60},
      after:{shipRev:ship.rev,hold:{...ship.hold.goods},pack:{...profile.eco.pack.goods},blueprint:ship.grid.parts.map(p=>[...p]),
        condition:conditionView(after),samePartId:entry.id===targetId,sameTuple:JSON.stringify(entry.piece)===JSON.stringify(targetTuple)}};
    await snap(page,result,'04-repaired-at-port');

    await page.locator('.raft-editor .re-close').click({force:true});
    const finalSource=world.rafts.get(ship.id);check(finalSource===restored,'repair replaced the recovered raft source');
    check(ship.voyage===null,'recovered-at-port save still has an away voyage pose after repair');
    const savedBeforeRepairReload=signedSave;
    await page.evaluate(blob=>{window.__qaOldSignedSave=blob;},signedSave);
    server.sendSave(currentOwnerClient[0],currentOwnerClient[1]);
    await page.waitForFunction(key=>localStorage.getItem(key)!==window.__qaOldSignedSave,saveKey,{timeout:15000}).catch(async()=>{
      // If a same-blob send was suppressed, refresh the owner's save by advancing the normal profile revision.
      ship.rev++;server.sendSave(currentOwnerClient[0],currentOwnerClient[1]);
      await page.waitForFunction(key=>localStorage.getItem(key)!==window.__qaOldSignedSave,saveKey,{timeout:15000});
    });
    const repairedBlob=await page.evaluate(key=>localStorage.getItem(key),saveKey),repairedSigned=hmacSaves(secret).load(repairedBlob);
    const repairedSavedShip=repairedSigned?.eco?.ships?.find(candidate=>candidate.id===ship.id);
    check(repairedSavedShip?.voyage===null&&repairedSavedShip?.condition?.entries?.some(row=>row[0]===targetId&&row[6]===60),
      'real signed SAVE does not contain repaired HP and cleared voyage');
    check(repairedSavedShip.hold.goods.madera===1&&repairedSigned.eco.pack.goods.madera===1,'repaired signed SAVE changed cargo unexpectedly');
    result.repairedSave={key:saveKey,length:repairedBlob.length,signatureVerified:true,ship:repairedSavedShip,previousBlobLength:savedBeforeRepairReload.length};
    await snap(page,result,'05-repaired-signed-save');
    await host.close();host=null;await page.close();page=null;

    console.log(`[${spec.name}] restarting a third host and reloading the repaired signed save`);
    host=createHost(port);check(await host.listen()===port,'third host did not reclaim the original browser save slot port');
    page=await context.newPage();entity=await openApp(page,port,result);
    server=serverFor(host);world=server.world;profile=world.profiles.get(entity);ship=profile?.eco?.ships?.find(candidate=>candidate.id===result.fixture.shipId);
    const finalRaft=ship&&world.rafts.get(ship.id),finalEntry=finalRaft?.condition?.entries?.find(entry=>entry.id===targetId);
    check(ship&&finalRaft&&finalEntry?.hp===60&&finalEntry.maxHp===60,'fresh signed reload did not retain repaired instance HP');
    check(finalEntry.id===targetId&&JSON.stringify(ship.grid.parts)===JSON.stringify(originalBlueprint),'fresh reload changed raft part identity or blueprint');
    check(ship.voyage===null&&ownerRaftCapacity(world,entity).mode==='port','fresh repaired reload did not remain docked');
    check(ship.hold.goods.madera===1&&profile.eco.pack.goods.madera===1,'fresh repaired reload changed hold/backpack cargo');
    check(!world.navalPilot.voyageSnapshot(entity).active&&!world.navalPilot.snapshot(entity).active,'fresh repaired reload restored a live voyage or pilot');
    result.finalReload={shipId:ship.id,partId:finalEntry.id,hp:finalEntry.hp,maxHp:finalEntry.maxHp,voyage:ship.voyage,
      mode:ownerRaftCapacity(world,entity).mode,hold:{...ship.hold.goods},pack:{...profile.eco.pack.goods},pilotActive:false,
      condition:conditionView(ownerRaftCapacity(world,entity))};
    await page.evaluate(id=>{window.__qaPartId=id;},targetId);
    await page.waitForFunction(id=>window.__mn.client.capacity?.id===id&&window.__mn.client.capacity.condition?.entries?.some(entry=>entry.id===window.__qaPartId&&entry.hp===60),ship.id,{timeout:20000});
    await snap(page,result,'06-fresh-reload-repaired-docked');
    check(result.errors.length===0&&result.consoleErrors.length===0,`browser errors: ${JSON.stringify({errors:result.errors,console:result.consoleErrors})}`);
    result.status='passed';await context.close();context=null;
  } catch(error) {
    result.status='failed';result.failure=String(error?.stack||error);evidence.failures.push(`${spec.name}: ${error?.message||error}`);
    result.hostDebug=host?{tick:host.game.server.world.tick,status:host.game.status(),clients:[...host.game.server.clients].map(([id,c])=>({id,entity:c.entity}))}:null;
    try {const page=context?.pages()[0];if(page){result.browserDebug=await page.evaluate(()=>({url:location.href,bodyText:document.body?.innerText?.slice(0,1200),joined:window.__mn?.client?.joined,
      entity:window.__mn?.client?.youServer,capacity:window.__mn?.client?.capacity,naval:window.__mn?.client?.naval,editor:window.__mn?.panels?.raftEditor?.active,
      editorMode:window.__mn?.panels?.raftEditor?.mode,sends:window.__qaRepairSends||[],acks:window.__qaRepairAcks||[],errors:window.__mn?.errors||[]}));
      const run=evidence.generatedAt.replace(/[:.]/g,'-'),file=resolve(out,`${result.name}-${run}-failure.png`);await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);}}catch{}
  } finally {if(context)await context.close().catch(()=>{});await host?.close();}
}
try {
  const selected=process.env.MN_RAFT_RECOVERY_VIEWPORT?specs.filter(s=>s.name===process.env.MN_RAFT_RECOVERY_VIEWPORT):specs;
  check(selected.length>0,'MN_RAFT_RECOVERY_VIEWPORT did not match a configured viewport');
  for(const spec of selected)await run(spec);
} finally {await browser.close();}
evidence.finishedAt=new Date().toISOString();evidence.status=evidence.failures.length?'failed':'passed';
const stamp=evidence.generatedAt.replace(/[:.]/g,'-');
const filename=`raft-recovery-evidence-${stamp}.json`;
await writeFile(resolve(out,filename),`${JSON.stringify(evidence,null,2)}\n`,'utf8');
console.log(JSON.stringify({status:evidence.status,viewports:evidence.viewports.map(({name,status,failure,screenshots})=>({name,status,failure,screenshots})),output:resolve(out,filename)},null,2));
if(evidence.status!=='passed')process.exitCode=1;

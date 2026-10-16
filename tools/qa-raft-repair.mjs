#!/usr/bin/env node
// D08c.10 browser acceptance for repairing a damaged raft part in port.
// Runs against fresh ephemeral memory hosts; fixture damage is injected through NavalTrial.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { ownerRaftCapacity } from '../src/sim/systems/raftCapacity.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { GAME } from '../src/data/meta.js';

const out = resolve('docs/delivery/d08c10-raft-repair');
await mkdir(out, { recursive: true });
const playwrightUrl = process.env.MN_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href
  : pathToFileURL(resolve('.scratch/pilot-browser/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightUrl);
const evidence = {
  generatedAt: new Date().toISOString(),
  purpose: 'Repair one damaged foundation at the port through the real editor, pay the material cost once, preserve its instance and blueprint position, then confirm repaired HP on remount.',
  harness: 'Fresh isolated ephemeral GameHost and in-memory store per viewport; GAME.seed, local Three.js/GSAP/font routes, normal Chrome renderer, no .env, SQL, external hosts, or persistent browser storage.',
  fixture: 'Server-side QA fixture adds madera:2 to raft hold and madera:1 to backpack. After the owner mounts through the game UI, NavalTrial.queueDamage applies exactly 30 damage to one foundation and an admitted server tick commits it. This is fixture damage, not proof of a real coastal impact or durable damage.',
  expected: { before: { hullHp: 210, hullMaxHp: 240, pieceHp: 30, pieceMaxHp: 60, repairCost: { madera: 2 } }, after: { hullHp: 240, hullMaxHp: 240, pieceHp: 60, pieceMaxHp: 60, hold: {}, pack: { madera: 1 } } },
  protocolVersion: PROTOCOL_VERSION,
  performanceClaim: false,
  viewports: [],
  failures: [],
};
const check = (value, message) => { if (!value) throw new Error(message); };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
const specs = [
  { name:'raft-repair-desktop-1280x720', width:1280, height:720, touch:false },
  { name:'raft-repair-mobile-844x390', width:844, height:390, touch:true },
  { name:'raft-repair-portrait-390x844', width:390, height:844, touch:true },
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
function setHelmFixture(host, entity) {
  const server=serverFor(host),world=server.world,raft=publicRafts(world).find(r=>r.owner===entity);
  check(raft?.helm,'missing fixed helm station');
  const point=pilotPoint(raft,raft.helm),c=world.ecs;
  c.x[entity]=point.x;c.y[entity]=point.y;c.z[entity]=point.z;c.facing[entity]=point.f;
  c.vx[entity]=c.vz[entity]=c.kbx[entity]=c.kbz[entity]=c.moveMag[entity]=0;
  world.raftDeck.update(publicRafts(world));server.broadcastSnapshot();return{raft,point};
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
  await page.waitForTimeout(120);const file=resolve(out,`${result.name}-${label}.png`);
  await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);
}
function conditionView(c) {
  if(!c?.condition)return null;
  return {hull:{...c.condition.hull},entries:c.condition.entries.map(e=>({index:e.index,id:e.id,piece:[...e.piece],hp:e.hp,maxHp:e.maxHp,cost:{...e.cost}}))};
}
async function run(spec) {
  const result={...spec,status:'running',errors:[],consoleErrors:[],requestFailures:[],httpFailures:[],screenshots:[]};evidence.viewports.push(result);
  const host=createGameServer({port:0,host:'127.0.0.1',seed:GAME.seed,bots:0,maxPlayers:1,dev:true,store:createMemoryStore(),worldId:null,
    saveSecret:`qa-raft-repair-${spec.name}`,chat:{enabled:false},log(){}});
  let context;
  try {
    console.log(`[${spec.name}] starting isolated memory host`);const port=await host.listen();
    context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:1,hasTouch:spec.touch,isMobile:spec.touch});
    const page=await context.newPage(),cdp=spec.touch?await context.newCDPSession(page):null;let entity=await openApp(page,port,result);
    const server=serverFor(host),world=server.world,profile=world.profiles.get(entity),ship=profile?.eco?.ships?.find(s=>s.kind==='raft'&&s.at==='aldea');
    check(profile&&ship&&ship.hp>0,'fresh profile missing starter raft');
    ship.hold.goods={...(ship.hold.goods||{}),madera:2};profile.eco.pack.goods={...(profile.eco.pack.goods||{}),madera:1};
    profile.eco.tradeRev++;ship.rev++;world.rafts.get(ship.id).ship=ship;
    let trialHandle=null;const trial=world.navalTrial,start=trial.start.bind(trial);trial.start=(...args)=>{trialHandle=start(...args);return trialHandle;};
    const helm=setHelmFixture(host,entity);await snapCameraToPlayer(page,helm.point);
    result.fixture={shipId:ship.id,materials:{hold:{madera:2},pack:{madera:1}},seed:GAME.seed,cameraSnapForAcceptance:true,damageSource:'QA fixture via NavalTrial.queueDamage and one admitted server.step; not a real impact'};
    await page.waitForFunction(()=>window.__mn.client.capacity?.id&&Array.isArray(window.__mn.client.capacity.condition?.entries),null,{timeout:25000});
    await waitCalm(server,entity);
    // Mount creates the session-only operational instance; capture its capability through trial.start.
    await page.waitForFunction(()=>window.__mn.navigation.interaction()?.prompt?.toLowerCase().includes('travesía')||document.querySelector('.ln-prompt [data-run]')?.textContent?.toLowerCase().includes('zarpar'),null,{timeout:15000});
    if(spec.touch)await page.locator('.ln-prompt [data-run]').tap();else await page.keyboard.press('f');
    await page.waitForFunction(()=>window.__mn.client.naval?.active,null,{timeout:20000});
    check(trialHandle,'owner mounted but fixture did not capture a NavalTrial handle');
    const nav=world.navalPilot.snapshot(entity),helmLocal=helm.raft.helm;
    const foundations=nav?.body?.structure?.entries?.filter(e=>e.part[0]==='foundation')||[];
    const target=foundations.sort((a,b)=>Math.hypot((b.part[1]+.5)*2-helmLocal.x,(b.part[2]+.5)*2-helmLocal.z)-
      Math.hypot((a.part[1]+.5)*2-helmLocal.x,(a.part[2]+.5)*2-helmLocal.z))[0];
    check(target&&helmLocal,'mounted trial has no foundation or fixed helm anchor');
    const originalBlueprint=ship.grid.parts.map(p=>[...p]),targetTuple=[...target.part],targetId=target.id;
    check(trial.queueDamage(trialHandle,targetId,30),'fixture damage was rejected by NavalTrial');
    check(server.step()===true,'damage did not commit at an admitted World tick');server.broadcastSnapshot();
    const damagedPilot=world.navalPilot.snapshot(entity),damagedEntry=damagedPilot?.body?.structure?.entries?.find(e=>e.id===targetId);
    check(damagedEntry?.hp===30&&damagedEntry.maxHp===60,`fixture damage was not exactly 30/60: ${JSON.stringify(damagedEntry)}`);
    const damagedCapacity=ownerRaftCapacity(world,entity);result.damaged={shipId:ship.id,partId:targetId,piece:targetTuple,
      hp:damagedEntry.hp,maxHp:damagedEntry.maxHp,condition:conditionView(damagedCapacity),worldTick:world.tick};
    check(damagedCapacity.condition.hull.hp===210&&damagedCapacity.condition.hull.maxHp===240,'damaged hull did not report 210/240 HP');

    // Dock at the home berth through the owner-authority API, then let the client receive the confirmed diagnosis.
    check(world.navalPilot.dock(entity,nav.epoch)===true,'owner could not dock the damaged session at its home berth');
    server.broadcastSnapshot();
    const portCapacity=ownerRaftCapacity(world,entity);check(portCapacity.mode==='port','damaged raft did not return to port mode');
    check(portCapacity.condition.entries.find(e=>e.id===targetId)?.hp===30,'docking did not preserve the damaged part instance');
    result.docked={mode:portCapacity.mode,condition:conditionView(portCapacity),hold:{...ship.hold.goods},pack:{...profile.eco.pack.goods}};
    await page.evaluate(id=>{window.__qaPartId=id;},targetId);
    await page.waitForFunction(id=>window.__mn.client.capacity?.id===id&&window.__mn.client.capacity.mode==='port'&&window.__mn.client.capacity.condition?.entries?.some(e=>e.id===window.__qaPartId&&e.hp===30),ship.id,{timeout:15000});
    await waitCalm(server,entity);await snap(page,result,'00-damaged-at-port');
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
    result.repairChoice=choice;await snap(page,result,'01-repair-forecast');

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
    check(!ship.hold.goods.madera&&profile.eco.pack.goods.madera===1,
      `repair did not consume 2 wood hold-first and preserve backpack unit: ${JSON.stringify({hold:ship.hold.goods,pack:profile.eco.pack.goods})}`);
    check(after.condition.hull.hp===240&&after.condition.hull.maxHp===240,'repaired hull total is not 240/240');
    result.repair={interaction:spec.touch?'touch tap on Confirmar reparación':'mouse click on Confirmar reparación',sentAck,
      before:{shipRev:revBefore,hold:holdBefore,pack:packBefore,blueprint:blueprintBefore,hp:30,maxHp:60},
      after:{shipRev:ship.rev,hold:{...ship.hold.goods},pack:{...profile.eco.pack.goods},blueprint:ship.grid.parts.map(p=>[...p]),
        condition:conditionView(after),samePartId:entry.id===targetId,sameTuple:JSON.stringify(entry.piece)===JSON.stringify(targetTuple)}};
    await snap(page,result,'02-repaired-at-port');

    await page.locator('.raft-editor .re-close').click({force:true});await waitCalm(server,entity);
    const postRepairHelm=setHelmFixture(host,entity);await snapCameraToPlayer(page,postRepairHelm.point);
    await page.waitForFunction(()=>window.__mn.navigation.interaction()?.prompt?.toLowerCase().includes('travesía')||document.querySelector('.ln-prompt [data-run]')?.textContent?.toLowerCase().includes('zarpar'),null,{timeout:15000});
    if(spec.touch)await page.locator('.ln-prompt [data-run]').tap();else await page.keyboard.press('f');
    await page.waitForFunction(()=>window.__mn.client.naval?.active,null,{timeout:20000});
    const remount=world.navalPilot.snapshot(entity),remountedPart=remount?.body?.structure?.entries?.find(e=>e.id===targetId);
    check(remountedPart?.hp===60&&remountedPart.maxHp===60,`remount did not retain repaired HP: ${JSON.stringify(remountedPart)}`);
    result.remount={active:true,shipId:ship.id,partId:targetId,hp:remountedPart.hp,maxHp:remountedPart.maxHp,worldTick:world.tick};
    await page.waitForFunction(touch=>{const root=window.__mn.navigation.root,el=root.querySelector(touch?'[data-touch-load]':'[data-load]'),r=el?.getBoundingClientRect();return !root.hidden&&r?.width>0&&r?.height>0;},spec.touch,{timeout:15000});
    await snap(page,result,'03-remounted-repaired');
    check(result.errors.length===0&&result.consoleErrors.length===0,`browser errors: ${JSON.stringify({errors:result.errors,console:result.consoleErrors})}`);
    result.status='passed';await context.close();context=null;
  } catch(error) {
    result.status='failed';result.failure=String(error?.stack||error);evidence.failures.push(`${spec.name}: ${error?.message||error}`);
    result.hostDebug={tick:host.game.server.world.tick,status:host.game.status(),clients:[...host.game.server.clients].map(([id,c])=>({id,entity:c.entity}))};
    try {const page=context?.pages()[0];if(page){result.browserDebug=await page.evaluate(()=>({url:location.href,bodyText:document.body?.innerText?.slice(0,1200),joined:window.__mn?.client?.joined,
      entity:window.__mn?.client?.youServer,capacity:window.__mn?.client?.capacity,naval:window.__mn?.client?.naval,editor:window.__mn?.panels?.raftEditor?.active,
      editorMode:window.__mn?.panels?.raftEditor?.mode,sends:window.__qaRepairSends||[],acks:window.__qaRepairAcks||[],errors:window.__mn?.errors||[]}));
      const file=resolve(out,`${result.name}-failure.png`);await page.screenshot({path:file,fullPage:false});result.screenshots.push(file);}}catch{}
  } finally {if(context)await context.close().catch(()=>{});await host.close();}
}
try {
  const selected=process.env.MN_RAFT_REPAIR_VIEWPORT?specs.filter(s=>s.name===process.env.MN_RAFT_REPAIR_VIEWPORT):specs;
  check(selected.length>0,'MN_RAFT_REPAIR_VIEWPORT did not match a configured viewport');
  for(const spec of selected)await run(spec);
} finally {await browser.close();}
evidence.finishedAt=new Date().toISOString();evidence.status=evidence.failures.length?'failed':'passed';
const filename=process.env.MN_RAFT_REPAIR_VIEWPORT?`${process.env.MN_RAFT_REPAIR_VIEWPORT}.json`:'raft-repair-evidence.json';
await writeFile(resolve(out,filename),`${JSON.stringify(evidence,null,2)}\n`,'utf8');
console.log(JSON.stringify({status:evidence.status,viewports:evidence.viewports.map(({name,status,failure,screenshots})=>({name,status,failure,screenshots})),output:resolve(out,filename)},null,2));
if(evidence.status!=='passed')process.exitCode=1;

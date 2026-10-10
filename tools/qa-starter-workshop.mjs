// Fixture-based browser evidence for PRG01D workshop panels. This is UI evidence only;
// it does not authenticate against a host or prove live persistence.
import http from 'node:http';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), out = resolve('docs/delivery/prg01d-starter-workshop/ui');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const fixture = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/panels.css"><link rel="stylesheet" href="/styles/workshop.css"><link rel="stylesheet" href="/styles/workbench.css"><link rel="stylesheet" href="/styles/raft-editor.css"><link rel="stylesheet" href="/styles/loggingTiming.css">
<style>body{margin:0;background:linear-gradient(130deg,#294b50,#193a47);font-family:system-ui;color:#f5f1df}#stage{position:relative;container:stage/size;width:100vw;height:100vh}#ui{position:absolute;inset:0;pointer-events:none}#ui>*{pointer-events:auto}.proof-pack{position:absolute;left:12px;bottom:12px;max-width:min(360px,calc(100vw - 24px))}*{transition:none!important}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<div id="stage"><canvas id="qa-canvas" tabindex="0"></canvas><div id="ui"></div><aside class="proof-pack"></aside></div><script type="module">
import * as THREE from 'three';
import { newProfile } from '/src/sim/systems/inventory.js';
import { WorkshopPanel } from '/src/ui/workshop.js';
import { WorkbenchPanel } from '/src/ui/workbench.js';
import { packInventoryHtml } from '/src/ui/packInventory.js';
import { RaftEditor } from '/src/ui/raftEditor.js';
import { ResourceActions } from '/src/ui/resourceActions.js';
import { createLoggingChallenge } from '/src/sim/systems/loggingTiming.js';
import { setLocale } from '/src/core/i18n.js';
const profile=newProfile(); profile.eco.pack={...profile.eco.pack,cap:18,maxMass:18,goods:{madera:5}};
profile.workshop={v:1,boards:5,storageCredit:false,crateKits:0};
const ui=document.querySelector('#ui'),requests=[],player={x:0,y:0,z:0,dead:false};
const ctx=()=>({profile});
const workshop=new WorkshopPanel({parent:ui,profile:()=>profile,context:ctx,enabled:()=>true,submit:c=>{requests.push(c);return true},getLocale:()=>document.documentElement.lang});
const bench=new WorkbenchPanel({parent:ui,profile:()=>profile,player:()=>player,bench:()=>({x:0,y:0,z:0}),enabled:()=>true,blocked:()=>false,submit:c=>{requests.push(c);return true}});
profile.eco.ships ??= []; const ship=profile.eco.ships.find(s=>s.kind==='raft');
if(ship){ship.id='qa:raft';ship.rev=1;ship.grid.parts=[['foundation',0,0,0,0],['foundation',1,0,0,0],['foundation',0,1,0,0],['foundation',1,1,0,0],['foundation',2,0,0,0]];}
const record=ship?{id:ship.id,owner:1,x:0,y:.72,z:0,yaw:0,rev:1,parts:ship.grid.parts}:null;
const editor=new RaftEditor({parent:ui,scene:new THREE.Scene(),canvas:document.querySelector('canvas'),camera:new THREE.PerspectiveCamera(),profile:()=>profile,rafts:()=>record?[record]:[],youServer:()=>1,player:()=>({x:0,y:.72,z:0,dead:false}),send:m=>requests.push(m),enabled:()=>true,workshopEnabled:()=>true});
if(record) editor.context=()=>({profile,ship,record,player:{x:0,y:.72,z:0,dead:false}});
const challenge=createLoggingChallenge({node:'palm-qa',rev:1,startTick:100,practice:0});
const client={joined:true,t:{closed:false},profile,resources:{timing:true,logicalTick:100,bench:{x:0,y:0,z:0},nodes:[{id:'palm-qa',kind:'palm',x:0,y:0,z:0,rev:1,ready:true,hits:0,remaining:3}]},resourceTick:100,serverTick:()=>100,send:m=>requests.push(m)};
const toasts=[]; const actions=new ResourceActions({client:()=>client,player:()=>player,enabled:()=>true,toast:m=>toasts.push(m),sound(){},locale:()=>document.documentElement.lang});
const pack=document.querySelector('.proof-pack');
window.qa={profile,workshop,bench,editor,actions,client,requests,toasts,async state(name,lang){setLocale(lang);document.documentElement.lang=lang;workshop.close();bench.close();editor.close();actions.reset();
 if(name==='partial'){profile.workshop={v:1,boards:5,storageCredit:false,crateKits:0};profile.eco.pack.goods={madera:5};workshop.open();}
 if(name==='ready'){profile.workshop={v:1,boards:10,storageCredit:true,crateKits:2};profile.progression.knowledge=['raft_storage'];profile.eco.pack.goods={madera:4,lona:3};workshop.open();}
 if(name==='workbench'){profile.eco.pack.goods={tronco:4,piedra:1};bench.open();}
 if(name==='storage'){profile.workshop={v:1,boards:10,storageCredit:true,crateKits:2};profile.progression.knowledge=['raft_storage'];profile.eco.pack.goods={madera:0,lona:0};editor.active=true;editor.root.hidden=false;editor.selected='storage';editor.target={x:2,z:0,level:0,dir:0};editor.render();}
 if(name==='kit'){profile.workshop={v:1,boards:10,storageCredit:true,crateKits:2};profile.progression.knowledge=['raft_storage'];editor.active=true;editor.root.hidden=false;editor.selected='crate';editor.target={x:2,z:0,level:0,dir:0};editor.render();}
 if(name==='timing'){actions.reset();actions.requestTiming(client.resources.nodes[0]);actions.onAim({type:'loggingAim',ok:true,challengeId:'qaChallenge',node:'palm-qa',rev:1,challenge});}
 pack.innerHTML=packInventoryHtml(profile,{},lang);
 }};
</script></html>`;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end(fixture);return;}const file=resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={scope:'Actual WorkshopPanel, WorkbenchPanel, PackInventory, RaftEditor and LoggingTimingPanel with local fixtures. No authenticated host, durable-save or physical-device acceptance.',checks:[]};
try{
 for(const [device,viewport] of Object.entries({desktop:{width:1280,height:800},portrait:{width:390,height:844},landscape:{width:844,height:390}})){
  const page=await browser.newPage({viewport,isMobile:device!=='desktop',hasTouch:device!=='desktop'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/fixture',{waitUntil:'domcontentloaded',timeout:15000});
  try{await page.waitForFunction(()=>window.qa?.workshop,{timeout:8000});}catch{throw Error('Fixture initialization failed: '+JSON.stringify({errors,html:await page.locator('body').innerText().catch(()=>''),url:page.url()}));}
  for(const locale of ['es','en']) for(const state of ['partial','ready','workbench','storage','kit','timing']){
   await page.evaluate(([n,l])=>window.qa.state(n,l),[state,locale]);
   const result=await page.evaluate(state=>{const sels={partial:'.workshop-panel',ready:'.workshop-panel',workbench:'.workbench-panel',storage:'.raft-editor',kit:'.raft-editor',timing:'.logging-timing'};const el=document.querySelector(sels[state]);const r=el.getBoundingClientRect();return {text:el.textContent.replace(/\\s+/g,' ').trim(),heading:el.querySelector('[data-title],.wb-heading h2,.re-head b')?.textContent.trim(),ariaLabel:el.getAttribute('aria-label'),trackLabel:el.querySelector('[role=meter]')?.getAttribute('aria-label'),inputCount:el.querySelector('[data-input-count]')?.textContent,outputCount:el.querySelector('[data-output-count]')?.textContent,actionEnabled:el.querySelector('.re-action')?!el.querySelector('.re-action').disabled:undefined,visible:!el.hidden,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},fits:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,noPageOverflow:document.documentElement.scrollWidth<=innerWidth+1,pack:document.querySelector('.proof-pack').textContent.replace(/\\s+/g,' ').trim()};},state);
   if(!result.visible||!result.fits||!result.noPageOverflow||errors.length)throw Error(JSON.stringify({device,locale,state,result,errors}));
   if(state==='partial'&&!/5\s*\/\s*10/.test(result.text))throw Error('Expected 5/10 partial progress: '+result.text);
   const expectedHeading=state==='workbench'?(locale==='en'?'Materials bench':'Banco de materiales'):state==='partial'||state==='ready'?(locale==='en'?'Salty Shore Workshop':'Taller de Salty Shore'):state==='timing'?(locale==='en'?'Logging rhythm':'Ritmo de tala'):null;
   if(expectedHeading&&result.heading!==expectedHeading)throw Error(`Wrong ${locale} heading for ${state}: ${result.heading}`);
   if(state==='timing'&&(result.ariaLabel!==(locale==='en'?'Logging timing challenge':'Desafío de ritmo de tala')||result.trackLabel!==(locale==='en'?'Strike timing window':'Ventana de golpe')))throw Error(`Wrong ${locale} timing ARIA labels: ${JSON.stringify(result)}`);
   if(state==='ready'&&(!/10\s*\/\s*10/.test(result.text)||!result.text.toLowerCase().includes(locale==='en'?'credit':'crédito')))throw Error('Ready reward/credit not visible: '+result.text);
   if(state==='storage'&&(!result.text.toLowerCase().includes(locale==='en'?'first storage build paid':'primera bodega cubierta')||!result.actionEnabled))throw Error('First storage credit not available: '+JSON.stringify(result));
   if(state==='kit'&&(!result.text.toLowerCase().includes(locale==='en'?'crate kit':'kit de caja')||!result.actionEnabled))throw Error('Kit cost not available: '+JSON.stringify(result));
   if(state==='workbench'&&(!result.inputCount?.trim().startsWith('2')||!result.outputCount?.trim().startsWith('1')))throw Error('Expected approved 2 logs to 1 board recipe: '+JSON.stringify(result));
   if(state==='timing'&&!result.text.toLowerCase().includes(locale==='en'?'logging rhythm':'ritmo de tala'))throw Error('Timing challenge UI missing');
   const screenshot=`${device}-${locale}-${state}.png`;await page.screenshot({path:resolve(out,screenshot)});report.checks.push({device,locale,state,...result,screenshot});
  }
  // Verify aim retry resends the exact same intent, then a denial clears the pending request.
  const flow=await page.evaluate(()=>{let now=0;const sent=[],toast=[];const a=new window.qa.actions.constructor({client:()=>window.qa.client,player:()=>({x:0,y:0,z:0}),enabled:()=>true,toast:m=>toast.push(m),sound(){},locale:()=>document.documentElement.lang,now:()=>now});a.client().send=m=>sent.push(m);const node=a.client().resources.nodes[0];a.requestTiming(node);const first=a.aimRequest.command;now=5001;a.requestTiming(node);const same=sent.length===2&&sent[0]===sent[1]&&sent[0]===first;a.onAim({type:'loggingAim',ok:false,why:'tool',node:node.id,rev:node.rev});return {sameRetry:same,denialCleared:a.aimRequest===null,denialToast:toast.at(-1)};});
  if(!flow.sameRetry||!flow.denialCleared)throw Error(JSON.stringify({device,flow}));report.checks.push({device,state:'timing-retry-denial',...flow});
  await page.close();
 }
 await writeFile(resolve(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');
 await writeFile(resolve(out,'README.md'),'# PRG01D UI evidence\n\nGenerated by `node tools/qa-starter-workshop.mjs`. These screenshots exercise the actual client panels against local profile and protocol fixtures. They demonstrate presentation and input behavior only; they do not prove authenticated host acceptance, durable live persistence, or physical-phone behavior.\n');
 console.log(JSON.stringify({checks:report.checks.length,out}));
}finally{await browser.close();await new Promise(done=>server.close(done));}

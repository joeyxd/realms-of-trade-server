// Local browser QA for the real CharPanel attribute controls. The fixture has no host,
// account, public service, or saved profile; canonical updates come from the pure planner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { newProfile } from '../src/sim/systems/inventory.js';
import { statsFor } from '../src/sim/systems/stats.js';
import { planAttributeChange } from '../src/sim/systems/attributePlan.js';
import { carryLimits } from '../src/data/carry.js';

const root = process.cwd();
const parentOut = path.resolve('docs/delivery/inv02c-ui');
fs.mkdirSync(parentOut, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const out = path.join(parentOut, stamp);
fs.mkdirSync(out); // Deliberately fail on a timestamp collision; never overwrite evidence.
const sibling = path.resolve(root, '..', 'realms-of-trade-server');
const playwrightPath = path.resolve(process.env.MN_PLAYWRIGHT
  || path.join(sibling, '.scratch/pilot-browser/node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };

const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/panels.css"><link rel="stylesheet" href="/styles/attributes.css">
<style>html,body{margin:0;min-width:0;min-height:100%;background:radial-gradient(ellipse at top,#31525b,#122b36);font-family:system-ui}#charpanel{width:100vw;height:100dvh;box-sizing:border-box;padding:8px}.cp{max-height:calc(100dvh - 16px)}.cp-stats{min-width:0}</style>
<script type="importmap">{"imports":{"gsap":"/qa-gsap.js","three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head>
<body><div id="charpanel"></div><script type="module">
import { CharPanel } from '/src/ui/charpanel.js';
import { newProfile } from '/src/sim/systems/inventory.js';
import { statsFor } from '/src/sim/systems/stats.js';
import { carryLimits } from '/src/data/carry.js';
import { planAttributeChange } from '/src/sim/systems/attributePlan.js';
import { setLocale } from '/src/core/i18n.js';
let locale='es', clock=1000, enabled=true, profile, commands=[];
const id=()=> 'qa-op-'+(commands.length+1);
function makeProfile({level=3,legacy=false,adopted=false}={}){
  const p=newProfile({starter:!legacy}); p.lvl=level;
  if(legacy){delete p.carry;p.eco.pack={cap:10,goods:{}};delete p.attr;}
  else {const limits=carryLimits(p.carry,level);p.eco.pack.cap=limits.volume;p.eco.pack.maxMass=limits.maxMass;}
  if(adopted){p.attr={v:1,carga:0,re:0};const limits=carryLimits(p.carry,level);p.eco.pack.cap=limits.volume;p.eco.pack.maxMass=50;}
  return p;
}
const send=command=>commands.push(structuredClone(command));
const panel=new CharPanel(document.querySelector('#charpanel'),{send,profile:()=>profile,stats:()=>{
  const base=statsFor(profile.lvl);return {level:profile.lvl,atk:base.atk,def:base.def,maxHp:base.hp,speed:6,ripMul:1,reflMul:1,guardMax:100,dashRec:1,winBonus:0,potHeal:1,xpMul:1,cdr:0};
},attributeEnabled:()=>enabled,locale:()=>locale});
function open(){setLocale(locale);panel.open('stats');}
function canonical(command){const planned=planAttributeChange(profile,command);if(!planned.ok)throw new Error('Fixture planner rejected '+command.op+': '+planned.why);return planned;}
function result(command,planned,meta={},order=0){
  const ev={type:'attributes',op:command.op,opId:command.opId,ok:true,why:'',rev:planned.profile.eco.tradeRev,
    points:planned.points,limits:planned.limits,...meta};
  if(order%2) return Object.fromEntries(Object.entries(ev).reverse());
  return ev;
}
window.qa={get panel(){return panel},get profile(){return profile},get commands(){return commands},get enabled(){return enabled},get pending(){return panel.attributes.pending},
  reset(options={}){panel.close();profile=makeProfile(options);commands=[];clock=1000;enabled=true;panel.attributes.now=()=>clock;panel.attributes.id=id;panel.attributes.resetSession();open();},
  locale(value){locale=value;document.documentElement.lang=value;setLocale(value);panel.refresh();},
  advance(ms){clock+=ms;panel.attributes.update();},
  setEnabled(value){enabled=value;panel.refresh();},
  plan(command){return canonical(command)},
  applyProfile(next){profile=next;panel.refresh();},
  acknowledge(command,planned,meta={},order=0){return panel.attributes.onResult(result(command,planned,meta,order));},
  deny(command,why='authority',meta={},order=0){const ev={type:'attributes',op:command.op,opId:command.opId,ok:false,why,rev:command.expectedRev,...meta};return panel.attributes.onResult(order%2?Object.fromEntries(Object.entries(ev).reverse()):ev);},
  ackWrong(command){return panel.attributes.onResult({type:'attributes',op:command.op,opId:command.opId+'-foreign',ok:false,why:'authority',rev:command.expectedRev});},
  snapshot(){return {pending:panel.attributes.pending&&structuredClone(panel.attributes.pending.command),status:panel.attributes.statusKey,profile:structuredClone(profile),commands:structuredClone(commands)}}};
window.qa.reset();
</script></body></html>`;

const server = http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  if(pathname==='/fixture'){res.writeHead(200,{'content-type':mime['.html']});res.end(fixture);return;}
  if(pathname==='/qa-gsap.js'){res.writeHead(200,{'content-type':mime['.js']});res.end('export const gsap={fromTo(){}};');return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||pathname.includes('/.env')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});

const report={at:new Date().toISOString(),scope:'Local browser fixture importing actual CharPanel, AttributeControls, newProfile, statsFor and planAttributeChange; local profile fixtures only; no host, account, public endpoint or durable-storage claim.',stateMutation:'only canonical fixture profile replacement after planAttributeChange returns ok',cases:[],checks:[],failures:[],screenshots:[]};
let browser;
const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
async function verifyViewport(page,label,locale,shot){
  const data=await page.evaluate(()=>{
    const panel=document.querySelector('.cp'),body=document.querySelector('.cp-body'),controls=document.querySelector('.attribute-controls');
    const buttons=[...controls.querySelectorAll('button[data-attribute-op]')].map(b=>({op:b.dataset.attributeOp,disabled:b.disabled,rect:(()=>{const r=b.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()}));
    const r=panel.getBoundingClientRect(),c=controls.getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight},panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth},body:{scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight},controls:{left:c.left,right:c.right,top:c.top,bottom:c.bottom,width:c.width,height:c.height,scrollWidth:controls.scrollWidth,clientWidth:controls.clientWidth},buttons,text:controls.innerText,locale:document.documentElement.lang};
  });
  const problems=[];
  if(data.panel.left < -1||data.panel.right>data.viewport.width+1)problems.push('panel horizontal bounds');
  if(data.controls.left < -1||data.controls.right>data.viewport.width+1)problems.push('attribute controls horizontal bounds');
  if(data.panel.scrollWidth>data.panel.clientWidth+1||data.body.scrollWidth>data.body.clientWidth+1||data.controls.scrollWidth>data.controls.clientWidth+1)problems.push('horizontal overflow');
  for(const b of data.buttons){if(b.rect.width<44||b.rect.height<44)problems.push(`target <44px: ${b.op}`);if(b.rect.left< -1||b.rect.right>data.viewport.width+1)problems.push(`button horizontally outside viewport: ${b.op}`);}
  if(!data.text.trim())problems.push('attribute controls empty');
  if(data.locale!==locale)problems.push(`locale mismatch ${data.locale}`);
  // Each button must be reachable by scrolling the panel body, even when below the fold.
  const reachable=await page.evaluate(()=>{const body=document.querySelector('.cp-body'),original=body.scrollTop;const checks=[...document.querySelectorAll('.attribute-controls button[data-attribute-op]')].map(b=>{b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),v=body.getBoundingClientRect();return r.height>0&&r.bottom>v.top&&r.top<v.bottom;});body.scrollTop=original;return checks.every(Boolean);});
  if(!reachable)problems.push('attribute actions not visible or scroll-reachable');
  const screenshot=shot?`${label}.png`:null;
  if(screenshot){await page.screenshot({path:path.join(out,screenshot),fullPage:false});report.screenshots.push(screenshot);}
  report.cases.push({label,locale,...data,screenshot,problems});
  assert.deepEqual(problems,[],`${label}: ${JSON.stringify(data)}`);
  return data;
}

async function clickOp(page,op){await page.locator(`[data-attribute-op="${op}"]`).first().click();}
async function runScenario(page,label,locale,metaOrder){
  await page.evaluate(({label,locale})=>{window.qa.reset();window.qa.locale(locale);window.qa.panel.open('stats');}, {label,locale});
  const ready=await verifyViewport(page,`${label}-${locale}-ready`,locale,true);
  assert.match(ready.text,locale==='es'?/Adoptar Carga/:/Adopt Carry/);
  assert.ok(ready.text.includes(locale==='es'?'22 uM':'22 uM'),'baseline max mass should be 22 uM');
  await clickOp(page,'adopt');
  let state=await page.evaluate(()=>window.qa.snapshot());
  const adopt=state.commands.at(-1);assert.ok(adopt&&adopt.op==='adopt');assert.equal(state.profile.attr,undefined,'adoption must not mutate profile optimistically');assert.equal(state.pending.opId,adopt.opId);
  await page.evaluate(command=>window.qa.ackWrong(command),adopt);
  assert.ok((await page.evaluate(()=>window.qa.pending)),'foreign acknowledgement must be ignored');
  await page.evaluate(()=>window.qa.advance(5001));
  await clickOp(page,'retry');
  state=await page.evaluate(()=>window.qa.snapshot());
  assert.equal(state.commands.length,2,'retry should resubmit once');assert.deepEqual(state.commands[0],state.commands[1],'retry must preserve exact opId and payload');
  const adoptPlan=await page.evaluate(command=>window.qa.plan(command),adopt);
  await page.evaluate(next=>window.qa.applyProfile(next),adoptPlan.profile);
  assert.ok(await page.evaluate(()=>window.qa.pending),'canonical profile arriving before acknowledgement must not clear pending');
  const adoptAck=await page.evaluate(({command,plan,order})=>window.qa.acknowledge(command,plan,{to:71,durable:true,replay:false,historical:false},order),{command:adopt,plan:adoptPlan,order:metaOrder});
  assert.equal(adoptAck,true,'valid routed durable adoption acknowledgement');
  assert.equal(await page.evaluate(()=>window.qa.pending),null);
  const adopted=await verifyViewport(page,`${label}-${locale}-adopted`,locale,false);
  assert.ok(adopted.text.includes('50 uM'),'adoption baseline maximum should be 50 uM');
  await clickOp(page,'assign');
  state=await page.evaluate(()=>window.qa.snapshot());const assign=state.commands.at(-1);assert.equal(assign.op,'assign');
  const assignPlan=await page.evaluate(command=>window.qa.plan(command),assign);
  await page.evaluate(next=>window.qa.applyProfile(next),assignPlan.profile);
  const assignAck=await page.evaluate(({command,plan,order})=>window.qa.acknowledge(command,plan,{to:71,durable:true,replay:true,historical:false},order),{command:assign,plan:assignPlan,order:metaOrder+1});
  assert.equal(assignAck,true);assert.equal(await page.evaluate(()=>window.qa.pending),null);
  const assigned=await verifyViewport(page,`${label}-${locale}-postassign`,locale,true);
  assert.ok(assigned.text.includes('55 uM'),'one assigned point should raise maximum carry to 55 uM');
  assert.ok(assigned.text.includes('44 uM'),'one assigned point should raise comfortable carry to 44 uM');
  await clickOp(page,'reset');
  assert.ok(await page.locator('[data-attribute-op="confirmReset"]').count(),'reset should request inline confirmation');
  await clickOp(page,'cancelReset');
  assert.equal(await page.locator('[data-attribute-op="confirmReset"]').count(),0,'cancel should close confirmation without command');
  await clickOp(page,'reset');await clickOp(page,'confirmReset');
  state=await page.evaluate(()=>window.qa.snapshot());const reset=state.commands.at(-1);assert.equal(reset.op,'reset');
  const resetPlan=await page.evaluate(command=>window.qa.plan(command),reset);
  await page.evaluate(next=>window.qa.applyProfile(next),resetPlan.profile);
  const resetAck=await page.evaluate(({command,plan,order})=>window.qa.acknowledge(command,plan,{to:71,durable:true,replay:false,historical:true},order),{command:reset,plan:resetPlan,order:metaOrder+2});
  assert.equal(resetAck,true);assert.equal(await page.evaluate(()=>window.qa.pending),null);
  const resetDone=await verifyViewport(page,`${label}-${locale}-reset`,locale,true);
  assert.ok(resetDone.text.includes('50 uM'),'free reset should restore maximum baseline 50 uM');
  assert.equal((await page.evaluate(()=>window.qa.profile.attr.re)),1,'reset should be consumed');
  // Read-only level-one and disabled capability cases do not enqueue commands.
  await page.evaluate(()=>{window.qa.reset({level:1,adopted:true});});
  const before=await page.evaluate(()=>window.qa.commands.length);
  const read=await page.evaluate(()=>({text:document.querySelector('.attribute-controls').innerText,assignDisabled:document.querySelector('[data-attribute-op="assign"]')?.disabled,resetDisabled:document.querySelector('[data-attribute-op="reset"]')?.disabled}));
  assert.equal(read.assignDisabled,true);assert.equal(read.resetDisabled,true);assert.equal(await page.evaluate(()=>window.qa.commands.length),before);
  await page.evaluate(()=>{window.qa.reset({level:3,adopted:true});window.qa.setEnabled(false);});
  const cap=await page.evaluate(()=>({text:document.querySelector('.attribute-controls').innerText,buttons:[...document.querySelectorAll('.attribute-controls button[data-attribute-op]')].map(b=>b.disabled),commands:window.qa.commands.length}));
  assert.ok(cap.buttons.every(Boolean),'disabled capability must disable attribute actions');assert.equal(cap.commands,0);
  await page.evaluate(()=>{window.qa.setEnabled(true);window.qa.panel.attributes.act('assign');});
  assert.ok(await page.evaluate(()=>window.qa.pending),'reconnect fixture should begin with a queued operation');
  await page.evaluate(()=>window.qa.panel.attributes.resetSession());
  const reconnect=await page.evaluate(()=>({pending:window.qa.pending,status:window.qa.panel.attributes.statusKey,hasControls:!!document.querySelector('.attribute-controls')}));
  assert.equal(reconnect.pending,null);assert.equal(reconnect.status,'synced');assert.equal(reconnect.hasControls,true);
  report.checks.push({label,locale,passed:true,levelOneRead:read,disabledCapability:cap,reconnect});
}

async function runLegacyAndDenial(page){
  await page.evaluate(()=>{window.qa.reset({level:3,legacy:true});window.qa.locale('en');window.qa.panel.open('stats');});
  const before=await page.evaluate(()=>window.qa.profile.eco.pack.cap);assert.equal(before,10);
  await clickOp(page,'adopt');const state=await page.evaluate(()=>window.qa.snapshot()),command=state.commands.at(-1);
  const planned=await page.evaluate(c=>window.qa.plan(c),command);
  await page.evaluate(next=>window.qa.applyProfile(next),planned.profile);
  assert.equal(await page.evaluate(({c,p})=>window.qa.acknowledge(c,p,{to:71,durable:true,replay:false,historical:false},1),{c:command,p:planned}),true);
  const legacy=await page.evaluate(()=>({cap:window.qa.profile.eco.pack.cap,maxMass:window.qa.profile.eco.pack.maxMass,attr:window.qa.profile.attr}));
  assert.equal(legacy.cap,18);assert.equal(legacy.maxMass,50);
  await clickOp(page,'assign');const denyState=await page.evaluate(()=>window.qa.snapshot()),denied=denyState.commands.at(-1);
  assert.equal(await page.evaluate(c=>window.qa.deny(c,'authority',{to:71,durable:false,replay:false,historical:false},1),denied),true);
  assert.equal(await page.evaluate(()=>window.qa.pending),null);assert.equal(await page.evaluate(()=>window.qa.panel.attributes.statusKey),'denial');
  report.checks.push({label:'legacy-cap10-adoption-and-denial',passed:true,legacy,deniedOp:denied.op});
}

try{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({...(process.env.MN_BROWSER?{executablePath:process.env.MN_BROWSER}:{channel:'chrome'}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  for(const spec of [
    {name:'desktop1280x720',viewport:{width:1280,height:720},mobile:false},
    {name:'portrait390x844',viewport:{width:390,height:844},mobile:true},
    {name:'landscape844x390',viewport:{width:844,height:390},mobile:true},
  ]){
    const context=await browser.newContext({viewport:spec.viewport,isMobile:spec.mobile,hasTouch:spec.mobile,deviceScaleFactor:1,locale:'es-MX'});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`,{waitUntil:'load'});
    await page.waitForFunction(()=>window.qa?.panel);
    await page.evaluate(({width,height})=>{const stage=document.querySelector('#charpanel');if(Math.abs(stage.getBoundingClientRect().width-width)>1||Math.abs(stage.getBoundingClientRect().height-height)>1)throw new Error('fixture viewport geometry mismatch');},{width:spec.viewport.width,height:spec.viewport.height});
    for(const [index,locale] of ['es','en'].entries()) await runScenario(page,spec.name,locale,index*3);
    if(spec.name==='desktop1280x720')await runLegacyAndDenial(page);
    if(errors.length)throw new Error(`${spec.name} browser errors: ${errors.join(' | ')}`);
    report.checks.push({label:spec.name+'-browser-errors',passed:true,errors});
    await context.close();
  }
  report.pass=report.failures.length===0;
}catch(error){report.failures.push(error.stack||error.message);report.pass=false;}
finally{
  await browser?.close();await new Promise(done=>server.close(done));
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,checks:report.checks.length,screenshots:report.screenshots.length,failures:report.failures,out},null,2));
}
if(!report.pass)process.exitCode=1;

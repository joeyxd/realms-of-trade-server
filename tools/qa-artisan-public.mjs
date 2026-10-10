// Public release acceptance with guest identity only; no account, SQL or feature activation.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
const origin='https://marea.62.171.136.148.sslip.io',out=resolve('docs/delivery/prg01c-artisan');
const report={schema:'mn.artisan.public.v1',at:new Date().toISOString(),checks:[],errors:[],
  limits:['Guest entry and disabled lane only; no live artisan SQL, lesson or durable storage transaction.','Browser desktop only; no physical phone or FPS acceptance.']};
const check=(name,detail={})=>report.checks.push({name,pass:true,...detail});
async function get(path){return fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(15000)});}
const health=await get('/health');assert.equal(health.status,200);assert.equal(await health.text(),'ok');check('health');
const status=await (await get('/status')).json();
assert.equal(status.version,GAME.version);assert.equal(status.errors,0);assert.equal(status.storage.errors,0);
assert.equal(status.storage.kind,'supabase');assert.equal(status.storage.durable,true);assert.equal(status.storage.accounts,true);
assert.equal(status.storage.tickBlocked,false);assert.equal(status.storage.economic.failed,false);
assert.equal(status.storage.resources.ready,true);assert.equal(status.storage.resources.logging,true);
assert.deepEqual(status.storage.artisan,{enabled:false,ready:false});
check('M5_healthy_artisan_off',{version:status.version});
assert.ok((await (await get('/src/net/protocol.js')).text()).includes('PROTOCOL_VERSION = '+PROTOCOL_VERSION));check('protocol',{version:PROTOCOL_VERSION});
assert.ok((await (await get('/src/ui/artisan.js')).text()).includes('class ArtisanPanel'));assert.equal((await get('/styles/artisan.css')).status,200);check('artisan_modules');
assert.equal((await get('/server/migrations/021_artisan_operations.sql')).status,404);check('server_SQL_private');
const ws=new WebSocket(origin.replace('https:','wss:')+'/ws',{origin,handshakeTimeout:12000}),messages=[];
ws.on('message',raw=>messages.push(JSON.parse(raw)));ws.on('error',()=>{});const closed=once(ws,'close');
async function wait(predicate){const deadline=Date.now()+18000;while(Date.now()<deadline){const found=messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,25));}throw Error('bounded public wire wait');}
try{
  await once(ws,'open');ws.send(JSON.stringify({t:MSG.HELLO,v:PROTOCOL_VERSION,name:'Artisan release QA',skin:0,weapon:0}));
  assert.equal((await wait(m=>[MSG.WELCOME,MSG.ERROR,MSG.FULL].includes(m.t))).t,MSG.WELCOME);
  await wait(m=>m.t===MSG.PROFILE);await wait(m=>m.t===MSG.SNAPSHOT);check('guest_WSS_profile_snapshot');
  ws.send(JSON.stringify({t:MSG.CMD,type:'artisan',op:'list',opId:'public-artisan-off'}));
  const denied=await wait(m=>m.t===MSG.EVENT&&m.ev?.type==='artisan'&&m.ev?.opId==='public-artisan-off');
  assert.equal(denied.ev.ok,false);assert.equal(denied.ev.why,'disabled');check('artisan_lane_disabled');
}finally{if(ws.readyState<2)ws.close();const timer=setTimeout(()=>ws.terminate(),1500);await closed;clearTimeout(timer);}
const {chromium}=await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT||'../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=default','--enable-webgl','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
  const requestsFailed=[],consoleErrors=[];
  page.on('requestfailed',r=>requestsFailed.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.goto(origin+'/?q=low',{waitUntil:'domcontentloaded'});
  try{await page.waitForFunction(()=>!!window.__mn,null,{timeout:90000});}
  catch(error){
    await writeFile(resolve(out,'public-browser-attempt.json'),JSON.stringify({at:new Date().toISOString(),pass:false,
      stage:'startup',error:error.message,errors:report.errors,requestsFailed,consoleErrors},null,2)+'\n');
    console.error(JSON.stringify({errors:report.errors,requestsFailed,consoleErrors}));throw error;
  }
  await page.waitForFunction(()=>!document.querySelector('#btn-play').disabled,null,{timeout:90000});
  // The title deliberately pulses this button; readiness is checked before the animated click.
  await page.locator('#btn-play').click({force:true});
  await page.waitForFunction(()=>__mn.st.mode==='playing'&&__mn.client.joined,null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#title').hidden&&!document.querySelector('#hud').hidden&&
    ['.hud-player','.actionbar','.hud-top-right'].every(selector=>Number(getComputedStyle(document.querySelector(selector)).opacity)>.99),null,{timeout:15000});
  const state=await page.evaluate(()=>({online:__mn.st.online,transport:__mn.transport.kind,
    artisan:!!__mn.panels.artisan,storagePalette:!!document.querySelector('[data-part="storage"]'),
    hudVisible:!document.querySelector('#hud').hidden,titleHidden:document.querySelector('#title').hidden,errors:[...__mn.errors]}));
  assert.equal(state.online,true);assert.equal(state.transport,'ws');assert.equal(state.artisan,true);assert.equal(state.storagePalette,true);
  assert.equal(state.hudVisible,true);assert.equal(state.titleHidden,true);
  assert.deepEqual(state.errors,[]);assert.deepEqual(report.errors,[]);check('real_browser_guest_entry',state);
  await page.screenshot({path:resolve(out,'public-gameplay.png')});
}finally{await browser.close();}
report.pass=true;await writeFile(resolve(out,'public-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

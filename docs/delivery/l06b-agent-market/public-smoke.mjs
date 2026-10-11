import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GAME } from '../../../src/data/meta.js';
import { PROTOCOL_VERSION, MSG } from '../../../src/net/protocol.js';
const origin='https://marea.62.171.136.148.sslip.io';
const checks=[];
const record=(check,extra={})=>checks.push({check,pass:true,...extra});
async function get(path) { return fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(15000)}); }
async function wire(hello, use) {
 const ws=new WebSocket(origin.replace('https:','wss:')+'/ws',{origin,handshakeTimeout:12000});
 const messages=[]; ws.on('message',raw=>messages.push(JSON.parse(raw))); ws.on('error',()=>{});
 const closed=once(ws,'close');
 const wait=async predicate=>{const deadline=Date.now()+18000;while(Date.now()<deadline){const found=messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,25));}throw Error('bounded wire wait failed');};
 try {await once(ws,'open');ws.send(JSON.stringify(hello));return await use({ws,messages,wait});}
 finally {if(ws.readyState<2)ws.close();const timer=setTimeout(()=>ws.terminate(),1500);await closed;clearTimeout(timer);}
}
try {
 const h=await get('/health');assert.equal(h.status,200);assert.equal(await h.text(),'ok');record('public_health_200');
 const s=await (await get('/status')).json();assert.equal(s.version,GAME.version);assert.equal(s.errors,0);assert.equal(s.storage.kind,'supabase');assert.equal(s.storage.durable,true);assert.equal(s.storage.accounts,true);assert.equal(s.storage.economic.enabled,true);assert.equal(s.storage.economic.failed,false);assert.equal(s.storage.tickBlocked,false);record('durable_M5_healthy',{version:s.version});
 const protocol=await(await get('/src/net/protocol.js')).text();assert.ok(protocol.includes('PROTOCOL_VERSION = '+PROTOCOL_VERSION));record('published_protocol',{protocol:PROTOCOL_VERSION});
 assert.equal((await get('/tools/agent/run.mjs')).status,404);record('operator_tools_not_public');
 const hello={t:MSG.HELLO,v:PROTOCOL_VERSION,name:'AREA17 QA',skin:0,weapon:0};
 await wire(hello,async({ws,wait})=>{
  const welcome=await wait(m=>[MSG.WELCOME,MSG.ERROR,MSG.FULL].includes(m.t));assert.equal(welcome.t,MSG.WELCOME);assert.equal(welcome.control,undefined);
  await wait(m=>m.t===MSG.SNAPSHOT);await wait(m=>m.t===MSG.PROFILE);record('ordinary_guest_real_public_entry');
  ws.send(JSON.stringify({t:MSG.AGENT_MARKET,requestId:'public-market-check',epoch:1,sessionId:'public-test-session',op:'list'}));
  const denied=await wait(m=>m.t===MSG.AGENT_MARKET_RESULT);assert.equal(denied.ok,false);assert.equal(denied.why,'forbidden');assert.equal(denied.market,null);record('public_guest_market_lane_forbidden');
 });
 await wire({...hello,agent:true},async({wait})=>{const denied=await wait(m=>[MSG.WELCOME,MSG.ERROR,MSG.FULL].includes(m.t));assert.equal(denied.t,MSG.ERROR);record('unconfigured_public_agent_admission_denied');});
 await wire({...hello,v:PROTOCOL_VERSION-1},async({wait})=>{const denied=await wait(m=>[MSG.WELCOME,MSG.ERROR,MSG.FULL].includes(m.t));assert.equal(denied.t,MSG.ERROR);record('old_protocol_requires_reload');});
 const report={schema:'mn.l06b.market.public.v1',at:new Date().toISOString(),target:'public TLS',pass:true,checks,limits:['Guest wire entry only; no authenticated economic transaction repeated.','Public agent pilot/provider remains disabled. No purchases, SQL or inference.']};
 await writeFile(new URL('./public-smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} catch { console.error(JSON.stringify({pass:false,checks,why:'bounded public smoke failed'}));process.exitCode=1; }
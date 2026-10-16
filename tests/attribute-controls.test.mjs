import test from 'node:test';
import assert from 'node:assert/strict';
import { AttributeControls } from '../src/ui/attributeControls.js';

const profile = (lvl=1) => ({lvl,carry:{v:1,backpack:0},attr:{v:1,carga:0,re:0},eco:{tradeRev:0,pack:{cap:18,maxMass:50,goods:{}}}});
const limits = (c=0) => ({volume:18,comfortableMass:40+4*c,maxMass:50+5*c});
const points = (lvl,c=0,re=0) => ({earned:lvl-1,invested:c,available:lvl-1-c,resetsLeft:1-re});
function rig(p=profile(2)) { let time=0, ids=0; const sent=[]; const ui=new AttributeControls({profile:()=>p,enabled:()=>true,submit:x=>sent.push(x),now:()=>time,id:()=>`op-${++ids}`}); return {ui,p,sent,setTime:n=>time=n}; }
const success = (cmd,c=cmd.op==='assign'?1:0,re=0,rev=1,lvl=2) => ({limits:limits(c),points:points(lvl,c,re),to:7,durable:true,historical:false,replay:false,rev,why:'',ok:true,opId:cmd.opId,op:cmd.op,type:'attributes'});
const apply = (p,c=0,re=0,rev=1) => {p.attr={v:1,carga:c,re};p.eco.pack.maxMass=50+5*c;p.eco.tradeRev=rev;};

test('pending command stays uninstalled until matching ACK and canonical profile arrive',()=>{
 const {ui,p,sent}=rig(); ui.act('assign'); const cmd=sent[0]; assert.equal(p.attr.carga,0); assert.equal(ui.pending.command,cmd);
 assert.equal(ui.onResult({...success({...cmd,opId:'foreign'})}),false);
 assert.equal(ui.onResult({...success(cmd),points:{...points(2,1),available:1}}),false);
 assert.equal(ui.pending!==null,true); assert.equal(p.attr.carga,0);
 assert.equal(ui.onResult(success(cmd)),true); assert.ok(ui.pending); apply(p,1,0,1); ui.update(); assert.equal(ui.pending,null);
});
test('retry resends the identical immutable command only after five seconds',()=>{
 const r=rig(); r.ui.act('assign'); const cmd=r.sent[0]; assert.equal(r.ui.retry(),false); r.setTime(5001); assert.equal(r.ui.retry(),true); assert.equal(r.sent[1],cmd); assert.equal(Object.isFrozen(cmd),true);
});
test('mismatched ACKs and malformed receipts are ignored',()=>{
 const r=rig(); r.ui.act('assign'); const cmd=r.sent[0];
 for(const ev of [{...success(cmd),rev:2},{...success(cmd),extra:true},{...success(cmd),limits:limits(2)}]) assert.equal(r.ui.onResult(ev),false);
 assert.ok(r.ui.pending);
});
test('historical successful ACK resolves against a newer matching canonical profile without rollback',()=>{
 const r=rig(); r.ui.act('assign'); const cmd=r.sent[0]; assert.equal(r.ui.onResult(success(cmd)),true);
 apply(r.p,1,0,4); r.ui.update(); assert.equal(r.ui.pending,null); assert.equal(r.p.eco.tradeRev,4);
});
test('denial is localized and releases pending operation',()=>{
 const r=rig(); r.ui.act('assign'); const cmd=r.sent[0];
 assert.equal(r.ui.onResult({type:'attributes',op:'assign',opId:cmd.opId,ok:false,why:'points',rev:0}),true);
 assert.equal(r.ui.pending,null); assert.match(r.ui.html('es'),/No hay puntos disponibles/); assert.match(r.ui.html('en'),/No points are available/);
});
test('level one legacy profile can explicitly adopt without changing goods',()=>{
 const p={lvl:1,eco:{tradeRev:0,pack:{cap:10,goods:{madera:2}}}}; let cmd;
 const ui=new AttributeControls({profile:()=>p,enabled:true,submit:x=>cmd=x,now:()=>0,id:()=> 'adopt'});
 assert.match(ui.html('es'),/conservas todos/i); assert.equal(ui.act('adopt'),true); assert.equal(cmd.op,'adopt'); assert.deepEqual(p.eco.pack.goods,{madera:2});
 assert.match(ui.html('en'),/max\. — \/ 10 uV/);
});
test('invalid level and inconsistent adopted mass fail closed',()=>{
 const r=rig(profile(0)); assert.match(r.ui.html(),/no son válidos/); r.p.lvl=2; r.p.eco.pack.maxMass=60; assert.match(r.ui.html(),/no son válidos/);
});
test('reset requires positive investment, unused reset and actual mass at most 50',()=>{
 const r=rig(); assert.equal(r.ui.act('reset'),false); apply(r.p,1,0,1); r.p.lvl=2; r.p.eco.pack.goods={hierro:9}; assert.equal(r.ui.act('reset'),false);
 r.p.eco.pack.goods={}; assert.equal(r.ui.act('reset'),true); assert.equal(r.sent.length,0); assert.match(r.ui.html(),/Confirmar reasignación/); r.ui.act('cancelReset'); assert.equal(r.sent.length,0);
});
test('current cargo includes goods and vessel volume/mass, with both locales and status keys',()=>{
 const p=profile(2); p.eco.pack.vessels=[{id:'bucket',kind:'bucket',water:2}]; const r=rig(p);
 assert.match(r.ui.html('es'),/3 peso \(uM\) \/ 2 volumen/); assert.match(r.ui.html('en'),/3 weight \(uM\) \/ 2 volume/);
 r.ui.statusKey='pending'; assert.match(r.ui.html('en'),/Waiting for server confirmation/);
});

test('profile with carry but no attr remains adoptable and bucket vessel is included',()=>{
 const p={lvl:2,carry:{v:1,backpack:1},eco:{tradeRev:4,pack:{cap:30,maxMass:20,goods:{},vessels:[{id:'bucket',kind:'bucket',water:2}]}}};
 let cmd;const ui=new AttributeControls({profile:()=>p,enabled:true,submit:x=>cmd=x,now:()=>0,id:()=> 'adopt-carry'});
 assert.match(ui.html('en'),/Adopt Carry/);assert.equal(ui.act('assign'),false);assert.equal(ui.act('adopt'),true);assert.equal(cmd.op,'adopt');
});

test('ACK confirms exact same-revision geometry and permits bounded routing/replay metadata',()=>{
 const r=rig();r.ui.act('assign');const cmd=r.sent[0];const ack=success(cmd);assert.equal(r.ui.onResult(ack),true);
 apply(r.p,1,0,1);r.ui.update();assert.equal(r.ui.pending,null);
});

test('historical ACK clears against a later canonical state without restoring its old allocation',()=>{
 const r=rig();r.ui.act('assign');const cmd=r.sent[0];assert.equal(r.ui.onResult({...success(cmd),replay:true,historical:true}),true);
 apply(r.p,0,1,5);r.p.lvl=2;r.ui.update();assert.equal(r.ui.pending,null);assert.deepEqual(r.p.attr,{v:1,carga:0,re:1});
});

test('reset confirmation rechecks changed mass and reports why visibly',()=>{
 const r=rig();r.p.carry={v:1,backpack:2};r.p.eco.pack.cap=42;r.p.eco.pack.maxMass=55;apply(r.p,1,0,1);r.p.lvl=2;assert.equal(r.ui.act('reset'),true);
 r.p.eco.pack.goods={hierro:9};assert.equal(r.ui.act('confirmReset'),false);assert.equal(r.sent.length,0);assert.match(r.ui.html('es'),/no supere 50 uM/);
});

test('reset confirmation explains point return and free reset consumption in both locales',()=>{
 const r=rig();apply(r.p,1,0,1);r.p.lvl=2;assert.equal(r.ui.act('reset'),true);
 assert.match(r.ui.html('es'),/devuelve los puntos invertidos y consume tu única reasignación gratuita/i);
 assert.match(r.ui.html('en'),/returns your invested points and uses your one free reallocation/i);
});

test('pending receipt validation uses a detached pack snapshot',()=>{
 const r=rig();r.ui.act('assign');const cmd=r.sent[0];
 r.p.eco.pack.goods={madera:1};
 assert.equal(r.ui.onResult(success(cmd)),true);assert.ok(r.ui.pending);
 r.p.eco.pack.goods={};apply(r.p,1,0,1);r.ui.update();assert.equal(r.ui.pending,null);
});

test('legacy capacity-ten profiles do not display an invented mass ceiling',()=>{
 const p={lvl:3,eco:{tradeRev:0,pack:{cap:10,goods:{}}}};
 const ui=new AttributeControls({profile:()=>p,enabled:true,submit:()=>{},now:()=>0,id:()=> 'legacy'});
 assert.match(ui.html('en'),/max\. — \/ 10 uV/);assert.doesNotMatch(ui.html('en'),/max\. 22 uM/);
});

test('present vessels must be an own data array and opening reset respects enabled and pending state',()=>{
 const p=profile(2);Object.defineProperty(p.eco.pack,'vessels',{enumerable:true,get(){throw new Error('must not run');}});
 const malformed=new AttributeControls({profile:()=>p,enabled:true,submit:()=>{},now:()=>0,id:()=> 'bad'});
 assert.match(malformed.html('en'),/data is invalid/);
 const r=rig();apply(r.p,1,0,1);r.p.lvl=2;r.ui.enabled=()=>false;assert.equal(r.ui.act('reset'),false);
 r.p.lvl=3;r.ui.enabled=()=>true;r.ui.act('assign');assert.equal(r.ui.act('reset'),false);assert.equal(r.ui.statusKey,'pending');
});

test('disabled capability prevents retries and idle per-frame updates do not refresh repeatedly',()=>{
 let enabled=true,changes=0;const r=rig();r.ui.enabled=()=>enabled;r.ui.onChange=()=>changes++;
 r.ui.update();const before=changes;for(let i=0;i<10;i++)r.ui.update();assert.equal(changes,before);
 r.ui.act('assign');r.setTime(6000);enabled=false;assert.match(r.ui.html('en'),/Actions are disabled/);assert.equal(r.ui.retry(),false);assert.equal(r.sent.length,1);
});

test('successful session-only receipts resolve without claiming a durable save',()=>{
 const r=rig();r.ui.act('assign');const cmd=r.sent[0];
 const missing=success(cmd);delete missing.durable;
 assert.equal(r.ui.onResult(missing),false);assert.ok(r.ui.pending);
 assert.equal(r.ui.onResult({...success(cmd),durable:false}),true);
 apply(r.p,1,0,1);r.ui.update();assert.equal(r.ui.pending,null);
 assert.match(r.ui.html('es'),/no se conserva al reiniciarlo/);
 assert.match(r.ui.html('en'),/does not survive a restart/);
});

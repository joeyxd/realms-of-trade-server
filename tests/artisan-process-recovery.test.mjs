import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const helper=fileURLToPath(new URL('./helpers/artisan-process.mjs',import.meta.url));
function start(mode,path,stage){
  const child=spawn(process.execPath,[helper,mode,path,stage],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',c=>stdout+=c);child.stderr.setEncoding('utf8').on('data',c=>stderr+=c);
  const exit=new Promise(done=>child.once('exit',(code,signal)=>done({code,signal})));
  return {child,exit,get stdout(){return stdout;},get stderr(){return stderr;}};
}
async function timeout(promise){let timer;try{return await Promise.race([promise,new Promise((_,fail)=>timer=setTimeout(()=>fail(Error('artisan process timeout')),30000))]);}finally{clearTimeout(timer);}}
for(const stage of ['before','learned','built'])test('artisan persisted process recovery: '+stage,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'artisan-recovery-'));
  t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+'\\artisan-recovery-')||resolve(dir).startsWith(resolve(tmpdir())+'/artisan-recovery-'));await rm(dir,{recursive:true,force:true});});
  const path=join(dir,'db'),held=start('hold',path,stage);
  try{
    await timeout(new Promise((done,fail)=>{held.child.stdout.on('data',()=>{if(held.stdout.includes('READY'))done();});held.exit.then(x=>fail(Error(JSON.stringify(x)+' '+held.stderr)));}));
    held.child.kill('SIGTERM');await timeout(held.exit);
    const audit=start('inspect',path,stage);try{assert.equal((await timeout(audit.exit)).code,0,audit.stderr);const result=JSON.parse(audit.stdout);
      assert.equal(result.receipts,stage==='before'?0:stage==='learned'?1:2);assert.equal(result.known,stage!=='before');assert.equal(result.storage,stage==='built'?1:0);
    }finally{if(audit.child.exitCode===null)audit.child.kill('SIGTERM');}
  }finally{if(held.child.exitCode===null&&held.child.signalCode===null){held.child.kill('SIGTERM');await timeout(held.exit);}}
  t.diagnostic('File-backed PGlite abrupt process exit and historical replay; not physical power loss or live PostgreSQL acceptance.');
});

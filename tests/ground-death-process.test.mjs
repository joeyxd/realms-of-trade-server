import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper=fileURLToPath(new URL('./helpers/ground-death-process.mjs',import.meta.url));
function start(args){
 const child=spawn(process.execPath,[helper,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});
 child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 return {child,done,get stdout(){return stdout;},get stderr(){return stderr;}};
}
function timed(promise,label,ms=180000){let timer;return Promise.race([promise,new Promise((_,reject)=>{
 timer=setTimeout(()=>reject(new Error(`${label} timed out`)),ms);timer.unref?.();})]).finally(()=>clearTimeout(timer));}
async function kill(proc){
 if(proc.child.exitCode!==null||proc.child.signalCode!==null)return proc.done;
 assert.equal(proc.child.kill('SIGKILL'),true);return timed(proc.done,'SIGKILL completion',10000);
}
async function ready(proc,phase){
 await timed(new Promise((resolve,reject)=>{const poll=()=>{
  if(proc.stdout.includes(`READY ${phase}\n`))return resolve();
  if(proc.child.exitCode!==null||proc.child.signalCode!==null)return reject(new Error(proc.stderr));
  setTimeout(poll,20);
 };poll();}),`READY ${phase}`);
}
async function safeTemp(dir){
 const root=resolve(await realpath(tmpdir())),target=resolve(await realpath(dir)),rel=relative(root,target);
 assert.ok(target!==root&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`));
 assert.ok(basename(target).startsWith('ground-death-process-'));return target;
}

for(const family of ['death','drop'])for(const phase of ['after-journal-prepare','after-sql-commit']){
 test(`composed ${family} recovers current rows after actual SIGKILL ${phase}`,{timeout:300000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ground-death-process-')),path=join(dir,'db');let proc,passed=false;
  t.after(async()=>{
   if(proc)await kill(proc);
   if(passed)await rm(await safeTemp(dir),{recursive:true,force:true});
   else t.diagnostic(`Retained failed fixture: ${dir}`);
  });
  proc=start(['hold',path,phase,family]);await ready(proc,phase);
  assert.equal(proc.stdout.includes('APPLIED\n'),false,`${family} operation is still before its synchronous effect`);
  assert.equal((await kill(proc)).signal,'SIGKILL');
  proc=start(['recover',path,phase,family]);
  assert.deepEqual(await timed(proc.done,`composed ${family} recovery`),{code:0,signal:null},proc.stderr);
  const result=JSON.parse(proc.stdout);
  assert.equal(result.phase,phase);assert.equal(result.family,family);
  assert.equal(result.worldVersion,family==='drop'?11:10);assert.equal(result.deaths,1);assert.equal(result.pk,1);
  assert.equal(result.items,family==='drop'?1:0);
  assert.equal(result.ordinaryDrops,family==='drop'?3:4);assert.equal(result.pearlDrops,2);assert.equal(result.historical,0);
  passed=true;
  t.diagnostic(`Child was SIGKILLed during ${family} after durable journal prepare or SQL commit and before local effect; restart reopened existing PGlite without migrations, recovered the common journal, then hydrated current pearl and ordinary drop rows.`);
 });
}

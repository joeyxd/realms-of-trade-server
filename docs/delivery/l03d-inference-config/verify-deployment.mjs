// Read-only active-image proof and ordinary public wire acceptance; never prints environment.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GAME } from '../../../src/data/meta.js';
const expected = process.argv[2];
assert.match(expected, /^[0-9a-f]{40}$/);
const expectedRuntimeFiles = [
  'server/agentControl.mjs', 'server/host.mjs', 'server/index.mjs', 'server/store.mjs',
  'server/companionConfig.mjs', 'server/companionConfigStore.mjs', 'server/migrations/025_companion_config.sql',
  'server/companionControl.mjs', 'server/companionControlStore.mjs', 'server/migrations/027_companion_control.sql',
  'server/inferenceConfig.mjs', 'server/inferenceConfigStore.mjs', 'server/migrations/028_inference_config.sql',
  'src/net/protocol.js', 'src/net/companionConfig.js', 'src/net/inferenceConfig.js',
  'src/client/companions.js', 'src/client/companionConfig.js', 'src/client/inferenceConfig.js',
  'src/ui/companions.js', 'src/ui/companionConfig.js', 'src/ui/inferenceConfig.js',
  'src/main.js', 'src/client/gameClient.js',
  'src/editor/editor.js', 'src/editor/editor.css', 'src/editor/templatePanel.js',
  'src/editor/templateStore.js', 'src/editor/templates.js', 'styles/hud.css', 'styles/minimap.css',
  'server/groundHostAuthority.mjs',
];
const execute = (program,args,options={}) => {
  const r=spawnSync(program,args,{encoding:'utf8',timeout:60000,...options});
  assert.equal(r.status,0,'bounded deployment probe failed');
  return r.stdout;
};
const deployment = JSON.parse(execute('ssh',['-o','BatchMode=yes','root@62.171.136.148','python3','-',expected],{
  input:readFileSync(new URL('./deployment-snapshot.py',import.meta.url))
}));
assert.equal(deployment.version,GAME.version);
assert.equal(deployment.revision,expected);
assert.equal(deployment.currentRelease,'/opt/marea-negra/releases/'+expected);
assert.equal(deployment.timer,'active');
assert.equal(deployment.readiness.version,1);
assert.equal(deployment.readiness.durable,true);
assert.equal(deployment.readiness.catalogEmpty,true);
assert.deepEqual(Object.keys(deployment.sourceHashes).sort(),expectedRuntimeFiles.sort());
for(const [file,hash] of Object.entries(deployment.sourceHashes)) {
  const bytes=spawnSync('git',['show',`${expected}:${file}`],{maxBuffer:4*1024*1024});
  assert.equal(bytes.status,0,'expected source not found');
  assert.equal(createHash('sha256').update(bytes.stdout).digest('hex'),hash,`active source mismatch: ${file}`);
}
const accepted=JSON.parse(readFileSync(new URL('./integration-merged.json',import.meta.url),'utf8'));
for(const [file,hash] of Object.entries(accepted.sha256)) {
  const bytes=spawnSync('git',['show',`${expected}:${file}`],{maxBuffer:4*1024*1024});
  assert.equal(bytes.status,0,'accepted test source not found');
  const normalized=bytes.stdout.toString('utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(normalized).digest('hex'),hash,`accepted source changed: ${file}`);
}
writeFileSync(new URL('./tested-source-identity.json',import.meta.url),JSON.stringify({
  at:new Date().toISOString(),revision:expected,testedSourceCommit:accepted.sourceCommit,
  testCounts:accepted.counts,comparedFiles:Object.keys(accepted.sha256).length,hashNormalization:'UTF-8 LF',
  pass:true,scope:'Accepted local source and test hashes match the published Git revision; active image hashes are recorded separately.'
},null,2)+'\n');
writeFileSync(new URL('./deployment.json',import.meta.url),JSON.stringify(deployment,null,2)+'\n');
execute(process.execPath,[fileURLToPath(new URL('./public-smoke.mjs',import.meta.url))]);
const smoke=JSON.parse(readFileSync(new URL('./public-smoke.json',import.meta.url),'utf8'));
assert.equal(smoke.pass,true); assert.ok(smoke.checks.every(c=>c.pass));
const origin='https://marea.62.171.136.148.sslip.io';
let status;
const deadline=Date.now()+30000;
do {
  const response=await fetch(origin+'/status',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200); status=await response.json();
  if(status.storage.unsaved===0 && status.storage.profileWrites===0 && status.storage.economic.pending===0)break;
  await new Promise(resolve=>setTimeout(resolve,1000));
}while(Date.now()<deadline);
assert.equal(status.version,GAME.version); assert.equal(status.errors,0);
assert.equal(status.storage.kind,'supabase'); assert.equal(status.storage.durable,true);
assert.equal(status.storage.errors,0); assert.equal(status.storage.unsaved,0); assert.equal(status.storage.profileWrites,0);
assert.equal(status.storage.tickBlocked,false); assert.equal(status.storage.economic.pending,0); assert.equal(status.storage.economic.failed,false);
for(const key of ['resources','artisan','workshop'])assert.equal(status.storage[key].ready,true);
assert.equal(status.storage.world.ready,true); assert.equal(status.storage.world.failed,false);
writeFileSync(new URL('./status.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),status},null,2)+'\n');
console.log(JSON.stringify({revision:deployment.revision,version:deployment.version,health:deployment.health,
  authorities:deployment.authorities.length,offline:deployment.offlineCounts,sourceHashes:Object.keys(deployment.sourceHashes).length,
  SQL028:deployment.readiness,publicChecks:smoke.checks.length,errors:status.errors,storageErrors:status.storage.errors}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deathResult } from '../server/deathOperation.mjs';

test('death journal survives three fresh processes: lost prepare, exact resume, lost terminal reply and read-only startup',async()=>{
  const location=path.join(await mkdtemp(path.join(tmpdir(),'mn-death-journal-')),'postgres');
  const runner=fileURLToPath(new URL('./helpers/death-journal-process.mjs',import.meta.url));
  const invoke=(mode,r=null)=>{const p=spawnSync(process.execPath,[runner,mode,location],{encoding:'utf8',input:r?JSON.stringify(r):undefined,
    windowsHide:true,timeout:60000});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
  const first=invoke('prepare');assert.equal(first.lost,'unavailable');assert.equal(first.sends,0);
  const r=first.request,next=invoke('resume',r);assert.deepEqual(next.outcomes,[{operationId:r.operationId,outcome:'pending'}]);
  assert.equal(next.sendsBefore,0);assert.equal(next.sends,1);assert.equal(next.lost,'unavailable');assert.equal(next.row.state,'committed');
  const last=invoke('recover',r);assert.deepEqual(last.outcomes,[]);assert.equal(last.sendsBefore,0);assert.equal(last.sends,0);
  assert.deepEqual(last.profiles,next.profiles);assert.deepEqual(last.drops,next.drops);assert.deepEqual(last.receipt,next.receipt);
  assert.deepEqual(last.receipt.result,deathResult(r,r.operationId));
  for(let i=0;i<r.profiles.length;i++)assert.deepEqual(last.profiles[i],{data:r.profiles[i].data,version:r.profiles[i].expectedVersion+1});
});

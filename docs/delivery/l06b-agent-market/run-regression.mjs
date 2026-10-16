import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { relative, resolve } from 'node:path';
const root = process.cwd();
const evidence = '.scratch/l06b-market';
await mkdir(evidence, { recursive: true });
const agents = (await readdir('tests')).filter(p => /^agent-.*\.test\.mjs$/.test(p)).map(p => 'tests/' + p).sort();
const regression = ['commerce-read','commerce','store-host','accounts-server','world-state','world-host','raft-persistence','harvest-tools','server','deploy-runtime','economic-store','economic-host','economic-raft-host','community-panel','resource-feedback','pack-inventory','progression-continuity','progression-logging','progression-profile','naval-lesson','naval-lesson-ui','naval-lesson-live','naval-route','naval-route-drive','naval-route-ui','naval-pilot-authority','naval-trial-authority','naval-trial-body'].map(p => `tests/${p}.test.mjs`);
async function hashes() {
  const files = ['package.json','package-lock.json'];
  for (const dir of ['src','server','tools/agent']) for (const item of await readdir(dir, {recursive:true,withFileTypes:true}))
    if (item.isFile() && /\.(mjs|js|json|html|css|md|jsonl|sql)$/.test(item.name)) files.push(relative(root, resolve(item.parentPath, item.name)).replaceAll('\\','/'));
  files.push(...agents,...regression);
  const result = {};
  for (const file of [...new Set(files)].sort()) result[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  return result;
}
const before = await hashes(), startedAt = new Date().toISOString();
const args = ['--test','--test-concurrency=1','--test-timeout=60000','--test-reporter=tap',...agents,...regression];
const child = spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
const output = createWriteStream(evidence + '/integrated-tests.tap');
const outputClosed = once(output,'close');
child.stdout.pipe(output); child.stderr.pipe(output,{end:false});
const [exitCode] = await once(child,'close');
await outputClosed;
const after = await hashes();
const changed = Object.keys(before).filter(file => before[file] !== after[file]);
const manifest = {startedAt,finishedAt:new Date().toISOString(),node:process.version,command:['node',...args],agentFiles:agents.length,regressionFiles:regression.length,exitCode,stable:changed.length===0,changed,hashes:before};
await writeFile(evidence + '/integrated-tests.json', JSON.stringify(manifest,null,2)+'\n');
const tap = await readFile(evidence + '/integrated-tests.tap','utf8');
console.log(JSON.stringify({...manifest,hashes:undefined,command:undefined},null,2));
console.log(tap.slice(-2300));
process.exitCode = exitCode || (changed.length ? 1 : 0);
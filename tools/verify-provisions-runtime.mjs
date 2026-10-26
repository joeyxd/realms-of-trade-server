// Read-only proof of the deployed provision UI and workshop layout revision.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const revision = process.argv[2];
assert.match(revision || '', /^[a-f0-9]{40}$/);
const out = resolve(process.argv[3] || 'docs/delivery/food-item-completion/public-runtime.json');
const files = ['src/ui/provisionInfo.js', 'src/ui/freshwaterPanel.js', 'src/ui/characterScreen.js',
  'styles/kit.css', 'styles/freshwater.css', 'styles/character.css', 'styles/workshop.css'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = Object.fromEntries(files.map(file => [file, hash(execFileSync('git', ['show', `${revision}:${file}`]))]));
const nodeProgram = `import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';const files=${JSON.stringify(files)};console.log(JSON.stringify(Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync('/app/'+f)).digest('hex')]))));`;
const remote = `import json,subprocess
def cmd(*a):return subprocess.check_output(a,text=True).strip()
ids=cmd('docker','ps','--filter','label=com.docker.compose.service=marea-negra-alpha','--format','{{.ID}}').splitlines()
assert len(ids)==1
c=json.loads(cmd('docker','inspect',ids[0]))[0]
hashes=json.loads(cmd('docker','exec',ids[0],'node','--input-type=module','-e',${JSON.stringify(nodeProgram)}))
print(json.dumps({'container':c['Id'],'image':c['Image'],'revision':c['Config']['Labels']['org.opencontainers.image.revision'],'health':c['State']['Health']['Status'],'hashes':hashes}))
`;
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@62.171.136.148', 'python3 -'],
  { input: remote, encoding: 'utf8', timeout: 45000 });
assert.equal(result.status, 0, result.stderr);
const live = JSON.parse(result.stdout);
assert.equal(live.revision, revision); assert.equal(live.health, 'healthy'); assert.deepEqual(live.hashes, expected);
const origin = 'https://marea.62.171.136.148.sslip.io';
const publicHashes = Object.fromEntries(await Promise.all(files.map(async file => {
  const response = await fetch(`${origin}/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); return [file, hash(Buffer.from(await response.arrayBuffer()))];
})));
assert.deepEqual(publicHashes, expected);
const status = await fetch(`${origin}/status`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(r => r.json());
assert.equal(status.errors, 0); assert.equal(status.storage.errors, 0);
assert.equal(status.storage.unsaved, 0); assert.equal(status.storage.economic.pending, 0);
assert.equal(status.storage.workshop.ready, true); assert.equal(status.storage.freshwater.meals, true);
await mkdir(resolve(out, '..'), { recursive: true });
await writeFile(out, JSON.stringify({ at: new Date().toISOString(), ...live, expected, publicHashes, status }, null, 2) + '\n');
console.log(JSON.stringify({ revision, health: live.health, containerFiles: files.length, publicFiles: files.length, evidence: out }));

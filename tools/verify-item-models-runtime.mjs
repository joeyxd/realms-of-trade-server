// Pin the active single authority and its files to a reviewed Git revision. No secret/environment reads.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const revision = process.argv[2] || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(revision, /^[a-f0-9]{40}$/);
const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:assets/manifest.json`]));
const files = ['package.json', 'src/data/meta.js', 'src/net/protocol.js', 'assets/manifest.json',
  'assets/editor/thumbnails.json', 'server/gmPublicationAssets.mjs', 'src/main.js',
  'src/render/scene.js', 'src/render/characters.js', 'src/render/harvestGoods.js', 'src/render/resourceNodes.js',
  'src/render/assets/registry.js', 'src/render/assets/manifest.js', 'src/render/assets/toonmat.js',
  ...manifest.assets.filter(entry => entry.id.startsWith('model:item-')).flatMap(entry => ['assets/' + entry.src, 'assets/' + entry.mobileSrc])];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = Object.fromEntries(files.map(file => [file, hash(execFileSync('git', ['show', `${revision}:${file}`]))]));
const program = `import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {GAME} from './src/data/meta.js';import {PROTOCOL_VERSION} from './src/net/protocol.js';const files=${JSON.stringify(files)};const status=await fetch('http://127.0.0.1:5173/status').then(r=>r.json());console.log(JSON.stringify({version:GAME.version,protocol:PROTOCOL_VERSION,status,hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync('/app/'+f)).digest('hex')]))}));process.exit(0);`;
const remote = `import json,subprocess\ndef cmd(*a):return subprocess.check_output(a,text=True).strip()\nids=cmd('docker','ps','--filter','label=com.docker.compose.service=marea-negra-alpha','--format','{{.ID}}').splitlines()\nassert len(ids)==1\nc=json.loads(cmd('docker','inspect',ids[0]))[0]\nr=json.loads(cmd('docker','exec',ids[0],'node','--input-type=module','-e',${JSON.stringify(program)}))\nprint(json.dumps({'container':c['Id'],'image':c['Image'],'revision':c['Config']['Labels']['org.opencontainers.image.revision'],'health':c['State']['Health']['Status'],'running':c['State']['Running'],'runtime':r}))\n`;
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@62.171.136.148', 'python3 -'], { input: remote, encoding: 'utf8', timeout: 45000 });
assert.equal(result.status, 0, result.stderr);
const live = JSON.parse(result.stdout);
assert.equal(live.revision, revision); assert.equal(live.health, 'healthy'); assert.equal(live.running, true);
assert.equal(live.runtime.protocol, 60); assert.equal(live.runtime.version, '0.6.0-alpha.67');
assert.equal(live.runtime.status.errors, 0); assert.equal(live.runtime.status.storage.errors, 0);
assert.equal(live.runtime.status.storage.fire.torchRules, 2);
assert.deepEqual(live.runtime.status.storage.foraging, { enabled: true, ready: true });
const comparison = Object.fromEntries(files.map(file => [file, { git: expected[file], container: live.runtime.hashes[file], matches: expected[file] === live.runtime.hashes[file] }]));
assert.ok(Object.values(comparison).every(row => row.matches));
await mkdir('docs/delivery/item-models-v1/public', { recursive: true });
await writeFile('docs/delivery/item-models-v1/public/runtime.json', JSON.stringify({ at: new Date().toISOString(), ...live,
  fileCount: files.length, comparison }, null, 2) + '\n');
console.log(JSON.stringify({ revision, version: live.runtime.version, health: live.health, matchedFiles: files.length }));

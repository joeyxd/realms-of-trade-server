import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { validateManifest, ATLAS_MANIFEST_SHA256 } from './atlas-policy.js';
const root=new URL('../../',import.meta.url);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const textHash=async url=>hash((await fs.readFile(url,'utf8')).replaceAll('\r\n','\n'));
const manifestUrl=new URL('./atlas-manifest.json',import.meta.url);
assert.equal(await textHash(manifestUrl),ATLAS_MANIFEST_SHA256);
const m=validateManifest(JSON.parse(await fs.readFile(manifestUrl,'utf8')));
assert.equal(await textHash(new URL('./atlas-source.json',import.meta.url)),m.sourceSpecSha256);
assert.equal(await textHash(new URL('./atlas-build.py',import.meta.url)),m.toolSha256);
for(const row of [...m.inputs,...m.variants]){
  const path=m.inputs.includes(row)?row.file:'.scratch/atlas-build/v1/'+row.file;
  const bytes=await fs.readFile(new URL(path,root));assert.equal(hash(bytes),row.sha256,path);assert.equal(bytes.length,row.bytes,path);
}
console.log(JSON.stringify({pinnedManifest:true,sourceImages:2,verifiedDerivatives:6,mobileMemoryAccepted:false}));

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
// KTX2 header, level index and DFD must match the manifest rows (UASTC, sRGB, Zstandard, full mip chain).
let ktx2Files=0;
for(const row of m.variants.filter(r=>r.container==='ktx2')){
  const bytes=await fs.readFile(new URL('.scratch/atlas-build/v1/'+row.file,root)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.deepEqual([...bytes.subarray(0,12)],[0xab,0x4b,0x54,0x58,0x20,0x32,0x30,0xbb,0x0d,0x0a,0x1a,0x0a],row.file);
  const u32=o=>view.getUint32(o,true),u64=o=>Number(view.getBigUint64(o,true));
  assert.deepEqual([u32(12),u32(20),u32(24),u32(28),u32(32),u32(36),u32(40),u32(44)],[0,row.dimensions[0],row.dimensions[1],0,0,1,row.levelCount,2],row.file);
  const dfd=u32(48);assert.deepEqual([bytes[dfd+12],bytes[dfd+13],bytes[dfd+14]],[166,1,2],row.file);
  row.levels.forEach((level,i)=>{assert.equal(u64(80+24*i+8),level.byteLength,row.file);assert.equal(u64(80+24*i+16),level.uncompressedByteLength,row.file);});
  ktx2Files++;
}
console.log(JSON.stringify({pinnedManifest:true,sourceImages:2,verifiedDerivatives:m.variants.length,ktx2Files,mobileMemoryAccepted:false}));

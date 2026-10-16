// Verify the served bytes, selected source metadata and untouched generator originals.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const dir='docs/art/source/character-alpha-v1';
const base='http://127.0.0.1:5194';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const selected=await read(dir+'/selected-sources.json');
const prompts=await read(dir+'/prompts.json');
const derivatives=await read(dir+'/mobile/derivatives-receipt.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const entries=[];
async function verify(relative,expected) {
  const local=await fs.readFile(relative),url=base+'/'+relative;
  const response=await fetch(url),remote=Buffer.from(await response.arrayBuffer());
  if(response.status!==200||sha(local)!==sha(remote)||expected&&sha(local)!==expected) throw Error('HTTP/source mismatch '+relative);
  const row={path:relative,url,status:response.status,bytes:remote.length,sha256:sha(remote),contentType:response.headers.get('content-type')};
  if(relative.endsWith('.png')) {
    if(remote.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||!row.contentType.startsWith('image/png')) throw Error('Not a served PNG '+relative);
    row.dimensions={width:remote.readUInt32BE(16),height:remote.readUInt32BE(20)};
  }
  entries.push(row); return row;
}
const preserved=[];
for(const source of selected.images) {
  const original=await verify(dir+'/'+source.file,source.sha256);
  if(original.dimensions.width!==source.dimensions.width||original.dimensions.height!==source.dimensions.height||source.transparencyCheck!=='pass') throw Error('Selected source metadata invalid '+source.file);
  const derivative=derivatives.images.find(i=>i.file===source.file);
  if(!derivative?.derivative.alphaPreserved||derivative.original.sha256!==source.sha256) throw Error('Invalid derivative receipt '+source.file);
  const mobile=await verify(dir+'/mobile/'+source.file,derivative.derivative.sha256);
  if(mobile.dimensions.width>512||mobile.dimensions.width!==derivative.derivative.dimensions.width||mobile.dimensions.height!==derivative.derivative.dimensions.height) throw Error('Mobile dimensions invalid '+source.file);
}
for(const generation of prompts.assets) {
  const generatedPath=generation.outputHint.match(/ as (C:\\[^\r\n]+?\.png) by default/)[1];
  const [generatorBytes,copiedBytes]=await Promise.all([fs.readFile(generatedPath),fs.readFile(path.join(dir,generation.file))]);
  if(sha(generatorBytes)!==sha(copiedBytes))throw Error('Generator original was altered '+generation.file);
  preserved.push({file:generation.file,sha256:sha(copiedBytes),matchesGeneratedOriginal:true});
}
for(const relative of [dir+'/manifest.json',dir+'/prompts.json',dir+'/selected-sources.json',dir+'/alpha-inspection.json',dir+'/mobile/derivatives-receipt.json','tools/character-alpha-lab/index.html','tools/character-alpha-lab/main.js','tools/character-alpha-lab/style.css'])await verify(relative);
const report={schema:'character-alpha-artifact-evidence/v1',generatedAt:new Date().toISOString(),status:'pass',selectedImages:selected.usedImageCount,transparentImages:selected.transparentImageCount,httpArtifactCount:entries.length,preservedOriginalCount:preserved.length,entries,preserved,excludedImages:selected.excludedImages,limits:'Local HTTP/static assets and original bytes only; no gameplay, 3D, FPS or author visual approval'};
await fs.mkdir('docs/art/character-alpha-v1',{recursive:true});
await fs.writeFile('docs/art/character-alpha-v1/artifact-evidence-v1.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,artifacts:entries.length,preservedOriginals:preserved.length,selectedOriginalBytes:selected.usedBytesTotal,selectedMobileBytes:entries.filter(e=>e.path.includes('/mobile/')&&e.path.endsWith('.png')).reduce((sum,e)=>sum+e.bytes,0)}));

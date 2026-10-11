// Rebuild P03a independently; the accepted base-v3 files and their receipts remain untouched.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createBody} from '../characters-base-v3/body.mjs';
import {createHead} from '../characters-base-v3/head.mjs';
import {makeTexture} from '../characters-base-v3/textures.mjs';
import {inspectAppearanceGlb} from './inspect.mjs';
import {assembleAppearance,APPEARANCE_CHOICES,DEFAULT_APPEARANCE} from './assemble.mjs';
import {packGlb} from './glb.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'docs/art/source/character-appearance-v1');
const sourceNames=['hair.mjs','face.mjs','assemble.mjs','glb.mjs','generate.mjs','inspect.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=Object.fromEntries(sourceNames.map(n=>[n,sha(fs.readFileSync(new URL(n,import.meta.url)))]));
const dependencies=Object.fromEntries(['body.mjs','head.mjs','textures.mjs','inspect.mjs'].map(n=>[n,sha(fs.readFileSync(new URL('../characters-base-v3/'+n,import.meta.url)))]));
const artifacts=[];
for(const kind of ['male','female']) {
  const body=createBody(kind),head=createHead(kind,body.R),assembly=assembleAppearance(kind,DEFAULT_APPEARANCE);
  const base=[{name:'body_base',geometry:body.geometry,family:'body'},{name:'head_base',geometry:head.head,family:'head'},
    {name:'base_top',geometry:body.top,family:'top'},{name:'base_shorts',geometry:body.shorts,family:'shorts'}];
  for(const size of [1024,512]) {
    const maps=Object.fromEntries(['body','head','top','shorts'].map(n=>[n,makeTexture(n,size)]));
    const bytes=packGlb({kind,joints:body.joints,parts:[...base,...assembly.parts],maps,appearance:assembly.descriptor});
    const stats=inspectAppearanceGlb(bytes,true),name=`${kind}-appearance-v1${size===512?'-mobile':''}.glb`;
    artifacts.push({name,bytes,info:{kind,textureSize:size,...stats,appearance:assembly.descriptor}});
  }
  for(const [key,family] of [['hairId','hair'],['beardId','beard'],['eyesId','eyes'],['browsId','brows']]) {
    for(const choice of APPEARANCE_CHOICES[key].filter(c=>c.id!=='none')) {
      const parts=assembleAppearance(kind,{...DEFAULT_APPEARANCE,[key]:choice.id}).parts.filter(p=>p.family===family);
      const name=`${kind}-${family}-${choice.id}-v1.glb`;
      const bytes=packGlb({kind,joints:body.joints,parts,appearance:{family,id:choice.id}}),stats=inspectAppearanceGlb(bytes);
      artifacts.push({name,bytes,info:{kind,family,id:choice.id,...stats,attachment:'head',jointIndex:8}});
    }
  }
}
const receiptFile=path.join(out,'appearance-receipt.json'),check=process.argv.includes('--check');
const catalog={schema:'character-appearance-catalog/v1',baseVersion:'v3',bodies:['male','female'],choices:APPEARANCE_CHOICES,defaults:DEFAULT_APPEARANCE};
if(check) {
  const receipt=JSON.parse(fs.readFileSync(receiptFile));
  if(JSON.stringify(sources)!==JSON.stringify(receipt.sources)||JSON.stringify(dependencies)!==JSON.stringify(receipt.dependencies))throw new Error('Source receipt changed');
  for(const a of artifacts)if(!fs.readFileSync(path.join(out,a.name)).equals(a.bytes)||receipt.artifacts[a.name].sha256!==sha(a.bytes))throw new Error(`Rebuild differs: ${a.name}`);
  for(const n of sourceNames)if(!fs.readFileSync(path.join(out,n+'.txt')).equals(fs.readFileSync(new URL(n,import.meta.url))))throw new Error(`Source snapshot changed: ${n}`);
  if(fs.readFileSync(path.join(out,'appearance-catalog.json'),'utf8')!==JSON.stringify(catalog,null,2)+'\n')throw new Error('Catalog changed');
  console.log(JSON.stringify({check:'ok',exactArtifacts:artifacts.length,sourceSnapshots:sourceNames.length,baseDependenciesUnchanged:true}));
} else {
  if(fs.existsSync(receiptFile)&&!process.argv.includes('--force'))throw new Error('P03a outputs exist; use --check or explicit --force for this isolated study');
  fs.mkdirSync(out,{recursive:true});
  const receipt={schema:'character-appearance-receipt/v1',scope:'P03a isolated interchangeable head attachments; P02 art and gameplay gates stay open',
    sources,dependencies,artifacts:{},limitations:['Opaque procedural shapes, no final painted hair atlas or headgear hiding mask.',
      'Static head-bound modules without hair dynamics, facial animation, saved identity or game integration.',
      'Same 15-bone bind as v3; imported modules must retain its inverse bind matrices.']};
  for(const a of artifacts){fs.writeFileSync(path.join(out,a.name),a.bytes);receipt.artifacts[a.name]={sha256:sha(a.bytes),bytes:a.bytes.length,...a.info};}
  for(const n of sourceNames)fs.copyFileSync(new URL(n,import.meta.url),path.join(out,n+'.txt'));
  fs.writeFileSync(path.join(out,'appearance-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({written:artifacts.length,presets:artifacts.filter(a=>a.info.textureSize).map(a=>({name:a.name,bytes:a.bytes.length,triangles:a.info.triangles}))}));
}

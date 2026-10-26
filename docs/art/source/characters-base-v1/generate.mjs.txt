// Editable deterministic sources for the anatomy/UV iteration. The v0 artifacts stay intact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createBody } from './body.mjs';
import { createHead } from './head.mjs';
import { makeTexture } from './textures.mjs';
import { inspectGlb } from './inspect.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(ROOT,'docs/art/source/characters-base-v1');
const BONES=['body','hips','thighL','shinL','thighR','shinR','spine','chest','head','armL','foreL','armR','foreR','clothF','clothB'];
const PARENT={hips:'body',thighL:'hips',shinL:'thighL',thighR:'hips',shinR:'thighR',spine:'hips',chest:'spine',head:'chest',armL:'chest',foreL:'armL',armR:'chest',foreR:'armR',clothF:'hips',clothB:'hips'};
const sha=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceNames=['generate.mjs','body.mjs','head.mjs','textures.mjs','inspect.mjs'];
function jointPositions(R){return {body:[0,0,0],hips:[0,R.hip+.02,0],thighL:[R.legX,R.hip,0],shinL:[R.legX,R.knee,.01],thighR:[-R.legX,R.hip,0],shinR:[-R.legX,R.knee,.01],spine:[0,R.waist,0],chest:[0,R.chest,0],head:[0,R.neck,.005],armL:[R.shX,R.shY,0],foreL:[R.shX+.004,R.elbow,0],armR:[-R.shX,R.shY,0],foreR:[-R.shX-.004,R.elbow,0],clothF:[0,R.hip+.05,.09],clothB:[0,R.hip+.05,-.09]};}
function build(kind,size){
  const body=createBody(kind), face=createHead(kind,body.R), J=body.joints||jointPositions(body.R);
  const geometries=[body.geometry,face.head,face.eyes,body.top,body.shorts];
  const names=['body_base','head_base','eyes_base','base_top','base_shorts'];
  const json={asset:{version:'2.0',generator:'MAREA NEGRA editable anatomy/UV v1'},scene:0,scenes:[{nodes:[0,...names.map((_,i)=>BONES.length+i)]}],nodes:[],meshes:[],skins:[],materials:[],accessors:[],bufferViews:[],buffers:[],images:[],textures:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:33071}]};
  const chunks=[];let length=0;
  function bytes(buffer,target){const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const n=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:buffer.length,...(target?{target}:{})});chunks.push(buffer);length+=buffer.length;return n;}
  function accessor(array,type,componentType,target,minMax=false){
    const count=array.length/({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type]);
    const item={bufferView:bytes(Buffer.from(array.buffer,array.byteOffset,array.byteLength),target),componentType,type,count};
    if(minMax){const dim=array.length/count;item.min=Array(dim).fill(Infinity);item.max=Array(dim).fill(-Infinity);for(let i=0;i<array.length;i++){const k=i%dim;item.min[k]=Math.min(item.min[k],array[i]);item.max[k]=Math.max(item.max[k],array[i]);}}
    json.accessors.push(item);return json.accessors.length-1;
  }
  for(const name of BONES)json.nodes.push({name,children:[],translation:J[name].map((v,k)=>v-(PARENT[name]?J[PARENT[name]][k]:0))});
  for(const name of BONES)if(PARENT[name])json.nodes[BONES.indexOf(PARENT[name])].children.push(BONES.indexOf(name));
  const inverse=[];for(const name of BONES)inverse.push(...new THREE.Matrix4().makeTranslation(...J[name]).invert().toArray());
  json.skins.push({name:kind+'_shared_body_rig',skeleton:0,joints:BONES.map((_,i)=>i),inverseBindMatrices:accessor(new Float32Array(inverse),'MAT4',5126)});
  for(const family of ['body','head','top','shorts']){
    const png=makeTexture(family,size);json.images.push({name:family+'_paint_'+size,bufferView:bytes(png),mimeType:'image/png'});
    json.textures.push({source:json.images.length-1,sampler:0});
    json.materials.push({name:family+'_paint',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],baseColorTexture:{index:json.textures.length-1},metallicFactor:0,roughnessFactor:.94},doubleSided:family==='top',alphaMode:'OPAQUE'});
  }
  json.materials.push({name:'neutral_eyes_and_accents',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.82},doubleSided:true});
  for(let i=0;i<geometries.length;i++){
    const geo=geometries[i], attributes={};
    const channels=[['position','POSITION','VEC3',5126,Float32Array],['normal','NORMAL','VEC3',5126,Float32Array],['color','COLOR_0','VEC3',5126,Float32Array],['uv','TEXCOORD_0','VEC2',5126,Float32Array],['skinIndex','JOINTS_0','VEC4',5121,Uint8Array],['skinWeight','WEIGHTS_0','VEC4',5126,Float32Array]];
    for(const [source,target,type,componentType,Ctor] of channels){if(!geo.attributes[source])throw new Error(`${names[i]} missing ${source}`);attributes[target]=accessor(new Ctor(geo.attributes[source].array),type,componentType,34962,source==='position');}
    const n=geo.attributes.position.count,Ctor=n<65536?Uint16Array:Uint32Array;
    const indices=accessor(new Ctor(geo.index.array),'SCALAR',n<65536?5123:5125,34963);
    json.meshes.push({name:names[i],primitives:[{attributes,indices,material:[0,1,4,2,3][i],mode:4}]});
    json.nodes.push({name:names[i],mesh:i,skin:0});
  }
  json.buffers.push({byteLength:length});const binary=Buffer.concat([...chunks,Buffer.alloc((4-length%4)%4)]);
  const raw=Buffer.from(JSON.stringify(json)),j=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),glb=Buffer.alloc(28+j.length+binary.length);
  glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(j.length,12);glb.writeUInt32LE(0x4e4f534a,16);j.copy(glb,20);
  glb.writeUInt32LE(binary.length,20+j.length);glb.writeUInt32LE(0x004e4942,24+j.length);binary.copy(glb,28+j.length);
  return glb;
}
const specs=['male','female'].flatMap(kind=>[1024,512].map(size=>({kind,size,name:`${kind}-base-v1${size===512?'-mobile':''}.glb`})));
const sources=Object.fromEntries(sourceNames.map(name=>[name,sha(fs.readFileSync(new URL(name,import.meta.url)))]));
const checking=process.argv.includes('--check');
if(checking){
  const receipt=JSON.parse(fs.readFileSync(path.join(OUT,'models-receipt.json'),'utf8'));
  if(JSON.stringify(sources)!==JSON.stringify(receipt.sources))throw new Error('Editable sources changed since the receipt');
  for(const spec of specs){const bytes=fs.readFileSync(path.join(OUT,spec.name)),stats=inspectGlb(bytes);if(sha(bytes)!==receipt.models[spec.name].sha256||!build(spec.kind,spec.size).equals(bytes))throw new Error(`${spec.name} differs from the deterministic build`);console.log(`${spec.name}: ${stats.triangles} tris; ${stats.heightMeters} m; UV/skin/geometry/PNG valid; exact rebuild`);}
  for(const name of sourceNames)if(!fs.readFileSync(path.join(OUT,name+'.txt')).equals(fs.readFileSync(new URL(name,import.meta.url))))throw new Error(`${name} snapshot differs from its editable source`);
  for(const [name,expected] of Object.entries(receipt.textures)){const bytes=fs.readFileSync(path.join(OUT,name)),family=name.split('-')[0];if(sha(bytes)!==expected.sha256||!makeTexture(family,expected.size).equals(bytes))throw new Error(`${name} differs from its texture receipt`);}
  console.log('v1 checks passed without writing');process.exit(0);
}
fs.mkdirSync(OUT,{recursive:true});
const receiptPath=path.join(OUT,'models-receipt.json');if(fs.existsSync(receiptPath)&&!process.argv.includes('--force'))throw new Error('Outputs exist. Use --check or explicit --force for this v1 iteration.');
const receipt={schema:'character-anatomy-v1/receipt-1',scope:'P02a: continuous parametric body, facial relief, cylindrical UVs and painted material study; production topology and gameplay acceptance pending.',sources,coordinates:{units:'meters',up:'+Y',front:'+Z',characterLeft:'+X'},rig:{bones:BONES,parent:PARENT,rest:'arms down, matching the local 15-joint convention'},models:{},textures:{},limitations:['Implicit body topology is editable as source parameters; it is not an artist-retopologized quad mesh.','Head ears and facial overlays are separate connected components; neck is a controlled overlapping attachment.','Cylindrical UVs allow mapping and preview; they are not a production packed atlas with uniform texel density.','Four modest procedural painted maps are material studies, not painted versions of the concept sheets.','No hair, beards, equipment, animation clips, facial rig, saved appearance, game renderer integration or measured physical-device FPS.']};
for(const spec of specs){const glb=build(spec.kind,spec.size),stats=inspectGlb(glb);fs.writeFileSync(path.join(OUT,spec.name),glb);receipt.models[spec.name]={sha256:sha(glb),bytes:glb.length,textureSize:spec.size,...stats};console.log(`${spec.name}: ${stats.triangles} tris; ${glb.length} B`);}
for(const family of ['body','head','top','shorts'])for(const size of [512,1024]){const png=makeTexture(family,size),name=`${family}-paint-${size}.png`;fs.writeFileSync(path.join(OUT,name),png);receipt.textures[name]={size,bytes:png.length,sha256:sha(png)};}
for(const source of sourceNames)fs.copyFileSync(new URL(source,import.meta.url),path.join(OUT,source+'.txt'));
fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');

// Deterministic GLB packing for head-bound modules and complete local review presets.
import * as THREE from 'three';
export const BONES = ['body','hips','thighL','shinL','thighR','shinR','spine','chest','head','armL','foreL','armR','foreR','clothF','clothB'];
const PARENT = { hips:'body',thighL:'hips',shinL:'thighL',thighR:'hips',shinR:'thighR',spine:'hips',chest:'spine',head:'chest',armL:'chest',foreL:'armL',armR:'chest',foreR:'armR',clothF:'hips',clothB:'hips' };
export function packGlb({ kind, joints, parts, maps = {}, appearance = null }) {
  const json = { asset:{version:'2.0',generator:'MAREA NEGRA P03a modular appearance study'},
    scene:0,scenes:[{nodes:[0,...parts.map((_,i)=>BONES.length+i)]}],nodes:[],meshes:[],skins:[],
    materials:[],accessors:[],bufferViews:[],buffers:[],images:[],textures:[],
    samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:33071}],
    extras:{scope:'P03a isolated study; not a saved game identity',body:kind,appearance} };
  const chunks=[]; let length=0;
  function bytes(buffer,target) {
    const pad=(4-length%4)%4; if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}
    const id=json.bufferViews.length;
    json.bufferViews.push({buffer:0,byteOffset:length,byteLength:buffer.length,...(target?{target}:{})});
    chunks.push(buffer);length+=buffer.length;return id;
  }
  function accessor(array,type,componentType,target,minMax=false) {
    const dim={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type];
    const item={bufferView:bytes(Buffer.from(array.buffer,array.byteOffset,array.byteLength),target),componentType,type,count:array.length/dim};
    if(minMax){item.min=Array(dim).fill(Infinity);item.max=Array(dim).fill(-Infinity);
      for(let i=0;i<array.length;i++){const d=i%dim;item.min[d]=Math.min(item.min[d],array[i]);item.max[d]=Math.max(item.max[d],array[i]);}}
    json.accessors.push(item);return json.accessors.length-1;
  }
  for(const name of BONES) json.nodes.push({name,children:[],translation:joints[name].map((v,k)=>v-(PARENT[name]?joints[PARENT[name]][k]:0))});
  for(const name of BONES) if(PARENT[name]) json.nodes[BONES.indexOf(PARENT[name])].children.push(BONES.indexOf(name));
  const inverse=BONES.flatMap(name=>new THREE.Matrix4().makeTranslation(...joints[name]).invert().toArray());
  json.skins.push({name:kind+'_v3_shared_rig',skeleton:0,joints:BONES.map((_,i)=>i),inverseBindMatrices:accessor(new Float32Array(inverse),'MAT4',5126)});
  const materials=new Map();
  for(const part of parts) {
    const family=part.family;
    if(materials.has(family))continue;
    const pbr={baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.94};
    if(maps[family]){json.images.push({name:family+'_paint',bufferView:bytes(maps[family]),mimeType:'image/png'});
      json.textures.push({source:json.images.length-1,sampler:0});pbr.baseColorTexture={index:json.textures.length-1};}
    materials.set(family,json.materials.length);
    json.materials.push({name:family+'_appearance',pbrMetallicRoughness:pbr,
      doubleSided:['eyes','brows','accents','top'].includes(family),alphaMode:'OPAQUE'});
  }
  for(const [index,part] of parts.entries()) {
    const geometry=part.geometry, attributes={};
    const channels=[['position','POSITION','VEC3',5126,Float32Array],['normal','NORMAL','VEC3',5126,Float32Array],
      ['color','COLOR_0','VEC3',5126,Float32Array],['uv','TEXCOORD_0','VEC2',5126,Float32Array],
      ['skinIndex','JOINTS_0','VEC4',5121,Uint8Array],['skinWeight','WEIGHTS_0','VEC4',5126,Float32Array]];
    for(const [source,target,type,componentType,Ctor] of channels) {
      if(!geometry.attributes[source])throw new Error(`${part.name} missing ${source}`);
      attributes[target]=accessor(new Ctor(geometry.attributes[source].array),type,componentType,34962,source==='position');
    }
    const large=geometry.attributes.position.count>=65536, Ctor=large?Uint32Array:Uint16Array;
    const indices=accessor(new Ctor(geometry.index.array),'SCALAR',large?5125:5123,34963);
    json.meshes.push({name:part.name,primitives:[{attributes,indices,material:materials.get(part.family),mode:4}]});
    json.nodes.push({name:part.name,mesh:index,skin:0});
  }
  json.buffers.push({byteLength:length});
  const bin=Buffer.concat([...chunks,Buffer.alloc((4-length%4)%4)]),raw=Buffer.from(JSON.stringify(json));
  const data=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),out=Buffer.alloc(28+data.length+bin.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(data.length,12);out.writeUInt32LE(0x4e4f534a,16);data.copy(out,20);
  out.writeUInt32LE(bin.length,20+data.length);out.writeUInt32LE(0x004e4942,24+data.length);bin.copy(out,28+data.length);
  return out;
}

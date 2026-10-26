// Validate exported module bytes independently of their surface constructors.
import assert from 'node:assert/strict';
import {inspectGlb} from '../characters-base-v3/inspect.mjs';
export function inspectAppearanceGlb(buffer, complete=false) {
  if(complete)return inspectGlb(buffer);
  assert.equal(buffer.readUInt32LE(0),0x46546c67);assert.equal(buffer.readUInt32LE(4),2);assert.equal(buffer.readUInt32LE(8),buffer.length);
  const length=buffer.readUInt32LE(12),json=JSON.parse(buffer.toString('utf8',20,20+length));
  assert.equal(buffer.readUInt32LE(16),0x4e4f534a);assert.equal(buffer.readUInt32LE(24+length),0x004e4942);
  const bin=buffer.subarray(28+length);assert.equal(buffer.readUInt32LE(20+length),bin.length);
  const arity={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},ctors={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
  const read=id=>{
    const a=json.accessors[id],view=json.bufferViews[a.bufferView],Ctor=ctors[a.componentType];assert.ok(Ctor&&arity[a.type]);
    const offset=(view.byteOffset||0)+(a.byteOffset||0),count=a.count*arity[a.type];
    assert.ok(offset%Ctor.BYTES_PER_ELEMENT===0&&count*Ctor.BYTES_PER_ELEMENT<=view.byteLength&&offset+count*Ctor.BYTES_PER_ELEMENT<=bin.length);
    return new Ctor(bin.buffer,bin.byteOffset+offset,count);
  };
  const skin=json.skins[0],bones=skin.joints.map(i=>json.nodes[i].name);assert.equal(bones.length,15);assert.equal(bones[8],'head');
  const world=[];function visit(id,parent=[0,0,0]){const node=json.nodes[id];world[id]=(node.translation||[0,0,0]).map((v,k)=>v+parent[k]);for(const child of node.children||[])visit(child,world[id]);}visit(skin.skeleton);
  const bind=read(skin.inverseBindMatrices);
  for(let i=0;i<15;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(bind[i*16+12+axis]+world[skin.joints[i]][axis])<1e-5);
  let triangles=0,vertices=0;
  for(const mesh of json.meshes){
    assert.equal(mesh.primitives.length,1);const primitive=mesh.primitives[0],a=primitive.attributes;
    const positions=read(a.POSITION),normal=read(a.NORMAL),uv=read(a.TEXCOORD_0),color=read(a.COLOR_0),joints=read(a.JOINTS_0),weights=read(a.WEIGHTS_0),indices=read(primitive.indices),count=positions.length/3;
    for(const values of [positions,normal,uv,color,weights])assert.ok(values.every(Number.isFinite));
    assert.equal(normal.length,positions.length);assert.equal(uv.length,count*2);assert.equal(color.length,positions.length);assert.equal(joints.length,count*4);assert.equal(weights.length,count*4);
    assert.ok(uv.every(v=>v>=0&&v<=1));assert.ok(color.every(v=>v>=0&&v<=1));assert.ok(indices.every(i=>i<count));assert.equal(indices.length%3,0);
    for(let i=0;i<count;i++){assert.equal(joints[i*4],8);assert.equal(weights[i*4],1);assert.equal(weights[i*4+1]+weights[i*4+2]+weights[i*4+3],0);assert.ok(Math.abs(Math.hypot(...normal.subarray(i*3,i*3+3))-1)<.025);}
    for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.subarray(i,i+3),ab=[0,1,2].map(k=>positions[b*3+k]-positions[a*3+k]),ac=[0,1,2].map(k=>positions[c*3+k]-positions[a*3+k]);assert.ok(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])>1e-12);}
    assert.equal(json.materials[primitive.material].alphaMode,'OPAQUE');vertices+=count;triangles+=indices.length/3;
  }
  assert.equal(json.images.length,0);assert.ok(triangles<=2000);
  return {triangles,vertices,headBound:true,weightsNormalized:true,bindMatricesMatchRest:true,finiteData:true};
}

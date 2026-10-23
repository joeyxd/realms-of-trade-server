// Artifact checks independent of the source constructors: bounds, topology, UVs, skin and PNGs.
import zlib from 'node:zlib';

const fail=(message)=>{throw new Error(message);};
const assert=(condition,message)=>{if(!condition)fail(message);};
const arity={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const formats={5121:[Uint8Array,1],5123:[Uint16Array,2],5125:[Uint32Array,4],5126:[Float32Array,4]};
export function inspectGlb(buffer){
  assert(buffer.readUInt32LE(0)===0x46546c67&&buffer.readUInt32LE(4)===2&&buffer.readUInt32LE(8)===buffer.length,'Invalid GLB header');
  const jlen=buffer.readUInt32LE(12);assert(buffer.readUInt32LE(16)===0x4e4f534a,'Missing JSON chunk');
  const json=JSON.parse(buffer.toString('utf8',20,20+jlen)),binOffset=28+jlen,bin=buffer.subarray(binOffset);
  assert(buffer.readUInt32LE(24+jlen)===0x004e4942&&buffer.readUInt32LE(20+jlen)===bin.length,'Invalid binary chunk');
  function data(id){const a=json.accessors[id],v=json.bufferViews[a.bufferView],[Ctor,width]=formats[a.componentType]||[];assert(Ctor&&arity[a.type],'Unsupported accessor');const offset=(v.byteOffset||0)+(a.byteOffset||0),count=a.count*arity[a.type];assert(offset%width===0&&offset+count*width<=bin.length&&count*width<=v.byteLength,'Accessor outside its bufferView');return new Ctor(bin.buffer,bin.byteOffset+offset,count);}
  const bones=json.skins[0].joints.map(i=>json.nodes[i].name);assert(bones.length===15,'Wrong bone count');
  const bind=data(json.skins[0].inverseBindMatrices);
  const world=[];function visit(id,parent=[0,0,0]){const node=json.nodes[id],p=(node.translation||[0,0,0]).map((v,i)=>v+parent[i]);world[id]=p;for(const child of node.children||[])visit(child,p);}visit(json.skins[0].skeleton);
  for(let b=0;b<15;b++){const p=world[json.skins[0].joints[b]],off=b*16;assert(Math.abs(bind[off+12]+p[0])<1e-5&&Math.abs(bind[off+13]+p[1])<1e-5&&Math.abs(bind[off+14]+p[2])<1e-5,'Inverse bind does not match rest joints');}
  const meshes=[];let triangles=0,minY=Infinity,maxY=-Infinity;
  for(const mesh of json.meshes){
    assert(mesh.primitives.length===1,'Unexpected primitive layout');const primitive=mesh.primitives[0],a=primitive.attributes;
    for(const key of ['POSITION','NORMAL','TEXCOORD_0','COLOR_0','JOINTS_0','WEIGHTS_0'])assert(a[key]!==undefined,`${mesh.name} lacks ${key}`);
    const p=data(a.POSITION),n=data(a.NORMAL),uv=data(a.TEXCOORD_0),colors=data(a.COLOR_0),joints=data(a.JOINTS_0),weights=data(a.WEIGHTS_0),indices=data(primitive.indices),count=p.length/3;
    assert(n.length===p.length&&uv.length===count*2&&colors.length===p.length&&joints.length===count*4&&weights.length===count*4,'Mismatched vertex channels');
    for(const values of [p,n,uv,colors,weights])assert(values.every(Number.isFinite),'Nonfinite vertex data');
    assert(indices.length%3===0&&indices.every(i=>i<count),'Invalid triangle indices');
    assert(uv.every(value=>value>=-1e-6&&value<=1+1e-6),'UV outside the declared 0..1 range');
    for(let i=0;i<count;i++){minY=Math.min(minY,p[i*3+1]);maxY=Math.max(maxY,p[i*3+1]);let sum=0;for(let k=0;k<4;k++){assert(joints[i*4+k]<15&&weights[i*4+k]>=0,'Invalid joint/weight');sum+=weights[i*4+k];}assert(Math.abs(sum-1)<1e-4,'Weights do not sum to one');}
    // Weld by spatial position for topology measurements, while allowing UV seam duplication.
    const spatial=new Map(),vIds=[],positions=[];
    for(let i=0;i<count;i++){const point=[p[i*3],p[i*3+1],p[i*3+2]],key=point.map(v=>Math.round(v*1e6)).join(',');if(!spatial.has(key)){spatial.set(key,positions.length);positions.push(point);}vIds.push(spatial.get(key));}
    const parent=positions.map((_,i)=>i),used=new Set(),edges=new Map();
    function find(x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
    function join(a,b){a=find(a);b=find(b);if(a!==b)parent[b]=a;}
    let degenerate=0,inward=0,area=0;
    for(let k=0;k<indices.length;k+=3){const [ia,ib,ic]=[indices[k],indices[k+1],indices[k+2]],a=vIds[ia],b=vIds[ib],c=vIds[ic];used.add(a);used.add(b);used.add(c);join(a,b);join(b,c);for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=u<v?u+':'+v:v+':'+u;edges.set(key,(edges.get(key)||0)+1);}const A=positions[a],B=positions[b],C=positions[c],ab=B.map((v,i)=>v-A[i]),ac=C.map((v,i)=>v-A[i]),cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],mag=Math.hypot(...cross);area+=mag*.5;if(mag<1e-12||a===b||b===c||c===a)degenerate++;const avg=[0,1,2].map(axis=>(n[ia*3+axis]+n[ib*3+axis]+n[ic*3+axis])/3);if(cross.reduce((sum,v,i)=>sum+v*avg[i],0)<-1e-10)inward++;}
    const referenced=new Set(indices),badNormals=[...referenced].filter(i=>Math.abs(Math.hypot(n[i*3],n[i*3+1],n[i*3+2])-1)>.02).length;
    const item={name:mesh.name,vertices:count,triangles:indices.length/3,components:new Set([...used].map(find)).size,boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonManifoldEdges:[...edges.values()].filter(n=>n>2).length,degenerateTriangles:degenerate,trianglesAgainstNormals:inward,badNormals,surfaceAreaMeters2:Number(area.toFixed(5)),uvRange:'0..1',material:json.materials[primitive.material].name};
    assert(!degenerate&&!badNormals&&!inward,`${mesh.name}: degenerate=${degenerate}, badNormals=${badNormals}, inward=${inward}`);
    if(mesh.name==='body_base')assert(item.components===1&&item.boundaryEdges===0&&!item.nonManifoldEdges,`Body continuity failed: ${JSON.stringify(item)}`);
    meshes.push(item);triangles+=item.triangles;
  }
  const images=json.images.map(image=>{const view=json.bufferViews[image.bufferView],png=bin.subarray(view.byteOffset,view.byteOffset+view.byteLength);assert(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Bad PNG signature');const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[25]===2?3:4;let pos=8,idats=[];while(pos<png.length){const len=png.readUInt32BE(pos),type=png.toString('ascii',pos+4,pos+8);if(type==='IDAT')idats.push(png.subarray(pos+8,pos+8+len));pos+=len+12;}assert(zlib.inflateSync(Buffer.concat(idats)).length===(width*channels+1)*height,'Invalid PNG pixel payload');return {name:image.name,width,height,bytes:png.length};});
  assert(images.length===4&&images.every(image=>image.width===images[0].width&&image.height===image.width),'Texture variants mismatch');
  const heightMeters=Number((maxY-minY).toFixed(4));assert(heightMeters>1.7&&heightMeters<2.05&&triangles<40000,'Unexpected proportions/budget');
  return {triangles,heightMeters,bones,meshes,images,bindMatricesMatchRest:true,weightsNormalized:true,finiteData:true};
}

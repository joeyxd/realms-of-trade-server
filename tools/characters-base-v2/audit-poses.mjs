// CPU-only skinning audit for the five P02 body/head parts under Character Lab poses.
import * as THREE from 'three';
import { createBody as createBodyV2 } from './body.mjs';
import { createHead as createHeadV2 } from './head.mjs';
import { createBody as createBodyV1 } from '../characters-base-v1/body.mjs';
import { createHead as createHeadV1 } from '../characters-base-v1/head.mjs';

const NAMES=['body','hips','thighL','shinL','thighR','shinR','spine','chest','head','armL','foreL','armR','foreR','clothF','clothB'];
const PARENT={hips:'body',thighL:'hips',shinL:'thighL',thighR:'hips',shinR:'thighR',spine:'hips',chest:'spine',head:'chest',armL:'chest',foreL:'armL',armR:'chest',foreR:'armR',clothF:'hips',clothB:'hips'};
const PART_NAMES=['body_base','head_base','eyes_base','base_top','base_shorts'];
const POSES=['a','run','joints'];
const V=new THREE.Vector3();
const finite3=(a)=>Number.isFinite(a[0])&&Number.isFinite(a[1])&&Number.isFinite(a[2]);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const area=(a,b,c)=>{
  const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  return .5*Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]);
};
const quantile=(sorted,q)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(q*sorted.length)-1)]:null;
const round=(n,d=5)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
const jsonPoint=(a)=>a.map(n=>round(n,6));

function buildRig(body){
  const joints=body.joints;
  const root=new THREE.Group();root.name='audit-root';
  const byName={};
  for(const name of NAMES){
    if(!joints?.[name]||joints[name].length!==3||!joints[name].every(Number.isFinite))throw new Error(`Missing or invalid body.joints.${name}`);
    const bone=new THREE.Bone();bone.name=name;byName[name]=bone;
    const parent=PARENT[name];
    if(parent){
      const a=joints[name],b=joints[parent];bone.position.set(a[0]-b[0],a[1]-b[1],a[2]-b[2]);byName[parent].add(bone);
    }else{bone.position.fromArray(joints[name]);root.add(bone);}
  }
  root.updateMatrixWorld(true);
  const skeleton=new THREE.Skeleton(NAMES.map(name=>byName[name]));
  return {root,byName,skeleton,rests:Object.fromEntries(NAMES.map(name=>[name,byName[name].position.clone()]))};
}

function resetRig(rig){for(const [name,bone]of Object.entries(rig.byName)){bone.rotation.set(0,0,0);bone.position.copy(rig.rests[name]);}}
function applyPose(rig,name,t=.22){
  resetRig(rig);const b=rig.byName;
  if(name==='a'){b.armL.rotation.z=.43;b.armR.rotation.z=-.43;}
  if(name==='run'){
    const wave=Math.sin(t*8);
    b.hips.position.y+=.022*Math.abs(wave);b.spine.rotation.x=.10;
    b.thighL.rotation.x=wave*.65;b.thighR.rotation.x=-wave*.65;
    b.shinL.rotation.x=Math.max(0,-wave)*.85;b.shinR.rotation.x=Math.max(0,wave)*.85;
    b.armL.rotation.x=-wave*.55;b.armR.rotation.x=wave*.55;
    b.armL.rotation.z=.09;b.armR.rotation.z=-.09;
    b.foreL.rotation.x=b.foreR.rotation.x=-.38;b.chest.rotation.y=wave*.035;
  }
  if(name==='joints'){
    b.armL.rotation.z=1.2;b.foreL.rotation.x=-1.1;
    b.armR.rotation.x=-.5;b.foreR.rotation.x=-.9;
    b.thighR.rotation.x=-.5;b.shinR.rotation.x=.9;
    b.chest.rotation.y=.15;b.head.rotation.y=-.2;
  }
  rig.root.updateMatrixWorld(true);rig.skeleton.update();
}

function weightsFor(geometry,i){
  const ji=geometry.getAttribute('skinIndex'),jw=geometry.getAttribute('skinWeight');
  if(!ji||!jw)return [];
  const out=[];
  for(let k=0;k<4;k++){
    const w=jw.getComponent(i,k),bone=ji.getComponent(i,k);
    if(w>1e-6)out.push({bone:NAMES[bone]??`#${bone}`,index:bone,weight:w});
  }
  return out;
}
function vertexPoints(mesh){
  const position=mesh.geometry.getAttribute('position'),out=new Array(position.count);
  for(let i=0;i<position.count;i++){mesh.getVertexPosition(i,V);out[i]=[V.x,V.y,V.z];}
  return out;
}
function seamDiagnostics(mesh,deformed){
  const p=mesh.geometry.getAttribute('position'),groups=new Map();
  for(let i=0;i<p.count;i++){
    const point=[p.getX(i),p.getY(i),p.getZ(i)],key=point.map(v=>Math.round(v*1e6)).join(',');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
  }
  let seamGroups=0,overToleranceGroups=0,max=0,worstPair=null;
  for(const ids of groups.values()){
    if(ids.length<2)continue;seamGroups++;
    for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){
      const ia=ids[a],ib=ids[b],error=dist(deformed[ia],deformed[ib]);
      if(error>max){max=error;worstPair={vertices:[ia,ib],divergenceMeters:round(error,8),restPositions:[jsonPoint([p.getX(ia),p.getY(ia),p.getZ(ia)]),jsonPoint([p.getX(ib),p.getY(ib),p.getZ(ib)])],posedPositions:[jsonPoint(deformed[ia]),jsonPoint(deformed[ib])],weights:[weightsFor(mesh.geometry,ia),weightsFor(mesh.geometry,ib)]};}
    }
    let groupMax=0;for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)groupMax=Math.max(groupMax,dist(deformed[ids[a]],deformed[ids[b]]));
    if(groupMax>1e-5)overToleranceGroups++;
  }
  return {seamGroups,overToleranceGroups,toleranceMeters:1e-5,maxSeamDivergenceMeters:round(max,8),worstPair};
}
function ancestors(name){const a=new Set([name]);while(PARENT[name]){name=PARENT[name];a.add(name);}return a;}
const ARM=new Set(['armL','foreL','armR','foreR']),LEG=new Set(['thighL','shinL','thighR','shinR']);
function unrelatedLimbPair(a,b,p){
  if(!ARM.has(a)&&!LEG.has(a)||!ARM.has(b)&&!LEG.has(b))return false;
  if((ARM.has(a)&&LEG.has(b))||(LEG.has(a)&&ARM.has(b)))return true;
  const aa=ancestors(a),bb=ancestors(b);if(aa.has(b)||bb.has(a))return false;
  const side=(n)=>n.endsWith('L')?1:n.endsWith('R')?-1:0;
  return side(a)&&side(b)&&side(a)!==side(b)&&Math.abs(p[0])>.035;
}
function structural(mesh){
  const g=mesh?.geometry;if(!g)return {present:false,fallback:true,issues:['missing mesh/geometry']};
  const p=g.getAttribute('position'),idx=g.index,ji=g.getAttribute('skinIndex'),jw=g.getAttribute('skinWeight');
  const issues=[];
  if(!p||p.itemSize!==3)issues.push('missing position vec3');
  if(!idx||idx.count%3)issues.push('missing/non-triangle index');
  if(!ji||ji.itemSize!==4)issues.push('missing skinIndex vec4');
  if(!jw||jw.itemSize!==4)issues.push('missing skinWeight vec4');
  if(p&&ji&&ji.count!==p.count)issues.push('skinIndex count differs from positions');
  if(p&&jw&&jw.count!==p.count)issues.push('skinWeight count differs from positions');
  if(p&&!Array.from(p.array).every(Number.isFinite))issues.push('nonfinite position data');
  if(idx&&p&&!Array.from(idx.array).every(i=>Number.isInteger(i)&&i>=0&&i<p.count))issues.push('index outside position range');
  if(g.userData?.fallback||mesh?.userData?.fallback)issues.push('source marked fallback');
  return {present:true,fallback:issues.length>0,vertices:p?.count??0,triangles:idx?.count/3??0,issues};
}
function weightDiagnostics(mesh){
  const g=mesh.geometry,p=g.getAttribute('position'),ji=g.getAttribute('skinIndex'),jw=g.getAttribute('skinWeight');
  if(!p||!ji||!jw)return {invalidVertices:p?.count??null,weightSumOutOfRange:null,mixedBranchVertices:null};
  let invalidVertices=0,weightSumOutOfRange=0,mixedBranchVertices=0,positiveInfluences=0;
  const invalidExamples=[],mixedExamples=[];
  for(let i=0;i<p.count;i++){
    const point=[p.getX(i),p.getY(i),p.getZ(i)],ws=[];let sum=0,bad=false;
    for(let k=0;k<4;k++){
      const w=jw.getComponent(i,k),bone=ji.getComponent(i,k);
      if(!Number.isFinite(w)||w< -1e-6||bone<0||bone>=NAMES.length){if(Math.abs(w)>1e-6||!Number.isFinite(w))bad=true;continue;}
      if(w>1e-6){sum+=w;positiveInfluences++;ws.push({bone:NAMES[bone],weight:w});}
    }
    if(bad){invalidVertices++;if(invalidExamples.length<5)invalidExamples.push({vertex:i,point:jsonPoint(point),weights:ws});}
    if(Math.abs(sum-1)>.015)weightSumOutOfRange++;
    const mixed=[];
    for(let a=0;a<ws.length;a++)for(let b=a+1;b<ws.length;b++)if(unrelatedLimbPair(ws[a].bone,ws[b].bone,point))mixed.push(`${ws[a].bone}+${ws[b].bone}`);
    if(mixed.length){mixedBranchVertices++;if(mixedExamples.length<8)mixedExamples.push({vertex:i,point:jsonPoint(point),pairs:[...new Set(mixed)],weights:ws.map(w=>({bone:w.bone,weight:round(w.weight,4)}))});}
  }
  return {invalidVertices,weightSumOutOfRange,mixedBranchVertices,positiveInfluences,invalidExamples,mixedExamples};
}
function auditPart(mesh,pose,time=.22){
  const geom=mesh.geometry,position=geom.getAttribute('position'),rig=mesh.userData.auditRig,index=geom.index?.array;
  resetRig(rig);rig.root.updateMatrixWorld(true);rig.skeleton.update();
  const base=vertexPoints(mesh);
  const bindDeviation=[];
  for(let i=0;i<position.count;i++)bindDeviation.push(dist(base[i],[position.getX(i),position.getY(i),position.getZ(i)]));
  applyPose(rig,pose,time);const deformed=vertexPoints(mesh);
  const finite=deformed.every(finite3);let movedVertices=0;
  for(let i=0;i<base.length;i++)if(dist(base[i],deformed[i])>.02)movedVertices++;
  const ratios=[],collapsedEdges=[],worstCandidates=[];let consideredEdges=0,shortRestEdges=0;
  const edgeSeen=new Set();
  if(index)for(let t=0;t<index.length;t+=3){
    for(const [ia,ib]of[[index[t],index[t+1]],[index[t+1],index[t+2]],[index[t+2],index[t]]]){
      const lo=Math.min(ia,ib),hi=Math.max(ia,ib),key=`${lo}:${hi}`;if(edgeSeen.has(key))continue;edgeSeen.add(key);
      const before=dist(base[ia],base[ib]);if(before<=1e-5){shortRestEdges++;continue;}
      const after=dist(deformed[ia],deformed[ib]),ratio=after/before;consideredEdges++;
      if(Number.isFinite(ratio))ratios.push(ratio);
      if(after<=Math.max(1e-7,before*.01)&&collapsedEdges.length<12)collapsedEdges.push({vertices:[ia,ib],rest:round(before),posed:round(after),ratio:round(ratio),restMidpoint:jsonPoint(base[ia].map((v,k)=>(v+base[ib][k])*.5)),weights:[weightsFor(geom,ia),weightsFor(geom,ib)]});
      worstCandidates.push({ia,ib,before,after,ratio});
    }
  }
  ratios.sort((a,b)=>a-b);worstCandidates.sort((a,b)=>b.ratio-a.ratio);
  const worst=worstCandidates.slice(0,5).map(e=>({vertices:[e.ia,e.ib],rest:round(e.before),posed:round(e.after),ratio:round(e.ratio),restEndpoints:[jsonPoint(base[e.ia]),jsonPoint(base[e.ib])],posedEndpoints:[jsonPoint(deformed[e.ia]),jsonPoint(deformed[e.ib])],restMidpoint:jsonPoint(base[e.ia].map((v,k)=>(v+base[e.ib][k])*.5)),weights:[weightsFor(geom,e.ia),weightsFor(geom,e.ib)]}));
  let triangleCount=0,degenerateRest=0,collapsedTriangles=0,triangleRatios=[];
  if(index)for(let t=0;t<index.length;t+=3){
    const [a,b,c]=[index[t],index[t+1],index[t+2]],before=area(base[a],base[b],base[c]);
    if(before<=1e-8){degenerateRest++;continue;}
    const after=area(deformed[a],deformed[b],deformed[c]),ratio=after/before;triangleCount++;
    if(Number.isFinite(ratio))triangleRatios.push(ratio);
    if(after<=Math.max(1e-9,before*.01))collapsedTriangles++;
  }
  triangleRatios.sort((a,b)=>a-b);
  const seams=seamDiagnostics(mesh,deformed);
  return {
    name:mesh.name,pose,sampleTime:time,vertices:base.length,triangles:index?.length/3??0,finite,
    bindRestDeviation:{max:round(Math.max(...bindDeviation)),p95:round(quantile([...bindDeviation].sort((a,b)=>a-b),.95))},
    seams,
    movedVertices,edgeStretch:{considered:consideredEdges,shortRestEdges,max:round(ratios.at(-1)),p95:round(quantile(ratios,.95)),p99:round(quantile(ratios,.99)),over3:ratios.filter(r=>r>3).length,over3Percent:round(100*ratios.filter(r=>r>3).length/Math.max(1,ratios.length),3),collapsedCount:collapsedEdges.length,worst},
    triangleArea:{considered:triangleCount,excludedNearZeroRest:degenerateRest,collapsed:collapsedTriangles,collapsedPercent:round(100*collapsedTriangles/Math.max(1,triangleCount),3),minRatio:round(triangleRatios[0]),p01:round(quantile(triangleRatios,.01))},
  };
}

function assemble(kind,version,createBody,createHead){
  const body=createBody(kind),head=createHead(kind,body.R);
  const source=[body.geometry,head.head,head.eyes,body.top,body.shorts];
  const rig=buildRig(body);
  const meshes=source.map((geometry,i)=>{
    if(!geometry)return null;
    const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());mesh.name=PART_NAMES[i];mesh.userData.auditRig=rig;
    mesh.bind(rig.skeleton,new THREE.Matrix4());rig.root.add(mesh);return mesh;
  });
  rig.root.updateMatrixWorld(true);rig.skeleton.update();
  const parts=PART_NAMES.map((name,i)=>{
    const mesh=meshes[i];if(!mesh)return {name,present:false,fallback:true,issues:['expected part was not returned']};
    const structure=structural(mesh),weights=weightDiagnostics(mesh);
    if(structure.issues.length)return {name,...structure,weights,poses:[]};
    return {name,...structure,weights,poses:POSES.map(pose=>auditPart(mesh,pose,.22))};
  });
  const period=2*Math.PI/8,runCycle={samples:16,periodSeconds:round(period,8),allFinite:true,firstNonFinite:null,maxEdgeStretch:{value:0,time:null,part:null,edge:null},maxSeamDivergence:{value:0,time:null,part:null,pair:null}};
  for(let i=0;i<runCycle.samples;i++){
    const time=period*i/runCycle.samples;
    for(const mesh of meshes){
      if(!mesh)continue;
      const structuralResult=structural(mesh);if(structuralResult.issues.length)continue;
      const measured=auditPart(mesh,'run',time);
      if(!measured.finite){runCycle.allFinite=false;runCycle.firstNonFinite??={time:round(time,8),part:mesh.name};}
      const edge=measured.edgeStretch.worst[0];
      if(measured.edgeStretch.max>runCycle.maxEdgeStretch.value)runCycle.maxEdgeStretch={value:measured.edgeStretch.max,time:round(time,8),part:mesh.name,edge};
      if(measured.seams.maxSeamDivergenceMeters>runCycle.maxSeamDivergence.value)runCycle.maxSeamDivergence={value:measured.seams.maxSeamDivergenceMeters,time:round(time,8),part:mesh.name,pair:measured.seams.worstPair};
    }
  }
  const runtimeJoints={body:[0,0,0],hips:[0,body.R.hip+.02,0],thighL:[body.R.legX,body.R.hip,0],shinL:[body.R.legX,body.R.knee,.01],thighR:[-body.R.legX,body.R.hip,0],shinR:[-body.R.legX,body.R.knee,.01],spine:[0,body.R.waist,0],chest:[0,body.R.chest,0],head:[0,body.R.neck,.005],armL:[body.R.shX,body.R.shY,0],foreL:[body.R.shX+.004,body.R.elbow,0],armR:[-body.R.shX,body.R.shY,0],foreR:[-body.R.shX-.004,body.R.elbow,0],clothF:[0,body.R.hip+.05,.09],clothB:[0,body.R.hip+.05,-.09]};
  const bindJointDeltas=Object.fromEntries(NAMES.map(name=>[name,body.joints[name].map((v,k)=>round(v-runtimeJoints[name][k],6))]));
  return {kind,version,bind:{source:'body.joints (generate.mjs uses this when present)',bodyJoints:body.joints,deltaVsCurrentCharkitJoints:bindJointDeltas},parts,runCycle};
}

const results=[];
for(const kind of ['male','female']){
  results.push(assemble(kind,'v2',createBodyV2,createHeadV2));
  if(process.argv.includes('--v1'))results.push(assemble(kind,'v1',createBodyV1,createHeadV1));
}
const out={schema:'character-pose-audit/v1',scope:'CPU skinning matrices only; no browser, WebGL, GPU, or generated evidence files',poses:POSES.map(name=>({name,sampleTime:.22})),target:{edgeStretchMax:3,edgeThresholdIsInformational:true,runCycleSeamDivergenceMaxMeters:1e-5},results};
console.log(JSON.stringify(out));

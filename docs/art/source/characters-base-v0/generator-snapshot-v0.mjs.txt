// Deterministic painted humanoid blockouts for the first modular character-base review.
// Run with --check to inspect the existing receipt without writing, or --force to replace outputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs/art/source/characters-base-v0');
const BONES = ['body','hips','thighL','shinL','thighR','shinR','spine','chest','head','armL','foreL','armR','foreR','clothF','clothB'];
const PARENT = { hips:'body', thighL:'hips', shinL:'thighL', thighR:'hips', shinR:'thighR', spine:'hips', chest:'spine', head:'chest', armL:'chest', foreL:'armL', armR:'chest', foreR:'armR', clothF:'hips', clothB:'hips' };
const PALETTE = { skin: 0xc89575, skinHi: 0xd9aa89, eye: 0x312221, shirt: 0x4d6270, shirtShade: 0x40545f, shorts: 0x4b4b49, shortsShade: 0x3b3d3d };
const HEAD_PROFILE = [
  [-0.01,.043,.050,.005],[.015,.046,.051,.008],[.045,.064,.069,.007],
  [.08,.083,.086,.004],[.12,.095,.100,.001],[.165,.100,.108,-.003],
  [.205,.099,.108,-.007],[.245,.091,.100,-.011],[.278,.071,.082,-.014],
  [.298,.049,.058,-.016],[.307,.027,.033,-.016],[.31,.006,.008,-.016],
];

const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b, v));
const smooth = (a,b,v) => { const t=clamp((v-a)/(b-a)); return t*t*(3-2*t); };
const rgb = (hex) => new THREE.Color(hex).toArray();
function faceFrontZ(y,x,widthScale=1) {
  let i=0;
  while(i<HEAD_PROFILE.length-2&&HEAD_PROFILE[i+1][0]<y)i++;
  const a=HEAD_PROFILE[i],b=HEAD_PROFILE[i+1],t=clamp((y-a[0])/(b[0]-a[0]));
  const rx=(a[1]+(b[1]-a[1])*t)*(y<.12?widthScale:1),rz=a[2]+(b[2]-a[2])*t,z=a[3]+(b[3]-a[3])*t;
  return z+rz*Math.sqrt(Math.max(0,1-(x/rx)**2));
}

class Part {
  constructor(name, baseColor) { this.name=name; this.baseColor=baseColor; this.positions=[]; this.indices=[]; this.joints=[]; this.weights=[]; this.colors=[]; }
  addSurface(points, faces, boneWeight, paint, flatColor=false) {
    const offset=this.positions.length/3;
    for (let i=0;i<points.length;i++) {
      const p=points[i], ws=boneWeight(p).filter(x=>x[1]>1e-4).sort((a,b)=>b[1]-a[1]).slice(0,4);
      let sum=ws.reduce((n,x)=>n+x[1],0); if (!sum) { ws.splice(0,ws.length,[0,1]); sum=1; }
      const ji=[0,0,0,0], we=[0,0,0,0];
      for (let k=0;k<ws.length;k++) { ji[k]=ws[k][0]; we[k]=ws[k][1]/sum; }
      this.positions.push(...p); this.joints.push(...ji); this.weights.push(...we);
      const col=paint ? paint(p) : this.baseColor;
      const shade=flatColor?1:0.965 + 0.035*Math.sin(p[0]*87.1+p[1]*51.7+p[2]*93.3);
      this.colors.push(...rgb(col).map(c=>Math.max(0,Math.min(1,c*shade))));
    }
    for (const i of faces) this.indices.push(offset+i);
  }
  loft(rings, sides, w, color=this.baseColor, caps=true) {
    const points=[], faces=[];
    for (const r of rings) for (let j=0;j<sides;j++) {
      const a=2*Math.PI*j/sides, k=r.scale?.(a)??1;
      points.push([(r.x??0)+Math.sin(a)*(r.rx??0)*k, r.y??0, (r.z??0)+Math.cos(a)*(r.rz??0)*k]);
    }
    for (let i=0;i<rings.length-1;i++) for(let j=0;j<sides;j++) {
      const a=i*sides+j,b=i*sides+(j+1)%sides,c=(i+1)*sides+(j+1)%sides,d=(i+1)*sides+j;
      faces.push(a,b,c,a,c,d);
    }
    if(caps) {
      for(const top of [false,true]) {
        const ri=top?rings.length-1:0, center=points.length, ring=points.slice(ri*sides,(ri+1)*sides);
        let x=0,z=0,y=0; for(const p of ring){x+=p[0];y+=p[1];z+=p[2];}
        points.push([x/sides,y/sides,z/sides]);
        for(let j=0;j<sides;j++){const a=ri*sides+j,b=ri*sides+(j+1)%sides; if(top)faces.push(center,a,b);else faces.push(center,b,a);}
      }
    }
    this.addSurface(points,faces,w,typeof color==='function'?color:()=>color);
  }
  ellipsoid(center, radii, sides, rings, w, color=this.baseColor) {
    const rs=[];
    for(let i=0;i<=rings;i++) {
      const t=-Math.PI/2+Math.PI*i/rings, c=Math.cos(t);
      rs.push({y:center[1]+Math.sin(t)*radii[1],x:center[0],z:center[2],rx:radii[0]*c,rz:radii[2]*c});
    }
    this.loft(rs,sides,w,color,false);
  }
}

const idx=Object.fromEntries(BONES.map((n,i)=>[n,i]));
function bodyWeight(y, R) {
  const pelvis=1-smooth(R.waist-0.02,R.waist+0.08,y), chest=smooth(R.chest-0.12,R.chest+0.08,y);
  return [[idx.hips,pelvis],[idx.spine,(1-pelvis)*(1-chest)],[idx.chest,(1-pelvis)*chest]];
}
function legWeight(side,R,y) {
  const thigh=side>0?idx.thighL:idx.thighR, shin=side>0?idx.shinL:idx.shinR;
  const hip=smooth(R.hip-0.1,R.hip+0.02,y), knee=smooth(R.knee-0.08,R.knee+0.07,y);
  return [[idx.hips,hip],[thigh,(1-hip)*knee],[shin,(1-hip)*(1-knee)]];
}
function armWeight(side,R,y) {
  const upper=side>0?idx.armL:idx.armR, fore=side>0?idx.foreL:idx.foreR;
  const shoulder=smooth(R.shY-0.07,R.shY+0.02,y), elbow=smooth(R.elbow-0.06,R.elbow+0.06,y);
  return [[idx.chest,shoulder*0.42],[upper,(1-shoulder)*elbow],[fore,(1-shoulder)*(1-elbow)]];
}

function createBodyParts(kind) {
  const male=kind==='male';
  const R=male ? { hip:0.91,knee:0.48,waist:1.00,chest:1.22,shY:1.48,shX:0.215,elbow:1.16,wrist:0.91,neck:1.57,legX:0.102, head:0.298, hand:1.0 } :
    { hip:0.89,knee:0.47,waist:0.99,chest:1.19,shY:1.44,shX:0.198,elbow:1.13,wrist:0.89,neck:1.54,legX:0.097, head:0.287, hand:0.96 };
  const scale=male?1:0.97;
  const parts={
    body:new Part('body_base',PALETTE.skin), head:new Part('head_base',PALETTE.skin), eyes:new Part('eyes_base',PALETTE.eye),
    top:new Part('base_top',PALETTE.shirt), shorts:new Part('base_shorts',PALETTE.shorts),
  };
  const bw=(p)=>bodyWeight(p[1],R);
  // Pelvis and trunk use nested, overlapping lofts to keep the nude base continuous under clothing.
  parts.body.loft([
    {y:.78,rx:.135*scale,rz:.105},{y:.88,rx:.158*scale,rz:.115},{y:.96,rx:.148*scale,rz:.104},
    {y:1.02,rx:male?.139:.128,rz:.093},{y:1.10,rx:male?.148:.137,rz:.098},
    {y:1.20,rx:male?.167:.148,rz:.108},{y:1.31,rx:male?.177:.157,rz:.112},
    {y:1.39,rx:male?.169:.151,rz:.107},{y:1.44,rx:male?.174:.158,rz:.108},
    {y:1.48,rx:.153,rz:.09},{y:1.52,rx:.104,rz:.068},{y:R.neck,rx:.062,rz:.055},
  ],24,bw,PALETTE.skin);
  // A short neck rises into the head pivot. Head proportions remain within the game's ~6.5-head read.
  parts.body.loft([{y:1.47,rx:.057,rz:.054},{y:R.neck-.015,rx:.054,rz:.05},{y:R.neck+.045,rx:.049,rz:.047}],20,()=>[[idx.chest,1]],PALETTE.skin);
  // Long legs, with gently changing radii at hips, knees, calves, ankles and instep.
  for(const side of [1,-1]) {
    const x=side*R.legX, w=(p)=>legWeight(side,R,p[1]);
    parts.body.loft([
      {y:.12,x:x*.94,z:.038,rx:.047*scale,rz:.058},{y:.20,x:x*.95,z:.005,rx:.055,rz:.061},
      {y:.33,x:x,z:-.004,rx:.064*scale,rz:.067},{y:.46,x:x,z:-.003,rx:.071*scale,rz:.073},
      {y:R.knee,x:x,z:0,rx:.064*scale,rz:.067},{y:.58,x:x*.98,z:0,rx:.072*scale,rz:.072},
      {y:.72,x:x*.92,z:0,rx:.086*scale,rz:.082},{y:.84,x:x*.86,z:.004,rx:.105*scale,rz:.096},
      {y:.93,x:x*.72,z:.005,rx:.092*scale,rz:.082},
    ],22,w,PALETTE.skin);
    // Rounded foot volume, slightly elongated toward +Z; ankle remains inside the mesh.
    parts.body.ellipsoid([x*.92,.105,.052],[.055*scale,.09,.126],20,10,w,PALETTE.skin);
    // Toes read as a sculpted fan and retain individual bend weights through the shin.
    for(let d=0;d<4;d++) {
      const spread=(d-1.5)*.023, len=[.062,.075,.068,.054][d];
      parts.body.ellipsoid([x*.92+spread,.045,.155-len*.12],[.014,.024,len*.66],12,6,w,PALETTE.skinHi);
    }
  }
  // Arms rest close to the torso, with elbows and wrists clearly shaped rather than box segments.
  for(const side of [1,-1]) {
    const x=side;
    const arm=side>0?idx.armL:idx.armR;
    // Rounded deltoids join the upper arms to the chest instead of leaving an open shoulder seam.
    parts.body.ellipsoid([side*R.shX*.87,1.425,0],[.096,.079,.082],20,10,()=>[[idx.chest,.58],[arm,.42]],PALETTE.skin);
    const rings=[
      {y:.89,x:x*(R.shX+.005),z:.006,rx:.032,rz:.034},{y:.97,x:x*(R.shX+.008),z:0,rx:.038,rz:.041},
      {y:1.06,x:x*(R.shX+.012),z:0,rx:.043,rz:.046},{y:R.elbow,x:x*(R.shX+.018),z:0,rx:.047*scale,rz:.049},
      {y:1.27,x:x*(R.shX+.012),z:0,rx:.051*scale,rz:.052},{y:1.37,x:x*(R.shX*.95),z:0,rx:.061*scale,rz:.06},
      {y:R.shY,x:x*R.shX,z:0,rx:.066*scale,rz:.064},{y:R.shY+.035,x:x*(R.shX-.015),z:0,rx:.052,rz:.052},
    ];
    parts.body.loft(rings,20,p=>armWeight(x,R,p[1]),PALETTE.skin,false);
    const handX=x*(R.shX+.006), handY=.865;
    parts.body.ellipsoid([handX,handY,.012],[.047*R.hand,.067,.036],18,9,p=>armWeight(x,R,p[1]),PALETTE.skin);
    // Four softly tapered fingers hang from each palm; thumb angles inward toward the palm.
    for(let d=0;d<4;d++) {
      const spread=(d-1.5)*.019, length=[.091,.105,.097,.08][d]*R.hand, fx=handX+spread;
      parts.body.loft([
        {y:handY-.025,x:fx,z:.019,rx:.013,rz:.014},{y:handY-.075,x:fx+spread*.12,z:.027,rx:.011,rz:.012},
        {y:handY-length,x:fx+spread*.2,z:.031,rx:.006,rz:.008},
      ],12,p=>armWeight(x,R,p[1]),PALETTE.skin,true);
    }
    parts.body.loft([
      {y:handY-.008,x:handX-x*.032,z:.018,rx:.014,rz:.014},
      {y:handY-.054,x:handX-x*.058,z:.033,rx:.011,rz:.011},
      {y:handY-.078,x:handX-x*.07,z:.04,rx:.006,rz:.008},
    ],12,p=>armWeight(x,R,p[1]),PALETTE.skin,true);
  }
  // Head profile follows the game's 6.5-head proportions: chin at the neck, rounded crown 31 cm higher.
  const faceScale=male?1:.94;
  const headRings=HEAD_PROFILE.map(([y,rx,rz,z])=>({y:R.neck+y,rx:rx*(y<.12?faceScale:1),rz,z}));
  parts.head.loft(headRings,28,()=>[[idx.head,1]],PALETTE.skin);
  const noseProfile=[
    [0,.156,faceFrontZ(.156,0,faceScale)+.001],
    [0,.126,faceFrontZ(.126,0,faceScale)+.010],
    [-.012,.117,faceFrontZ(.117,-.012,faceScale)+.006],
    [.012,.117,faceFrontZ(.117,.012,faceScale)+.006],
    [0,.108,faceFrontZ(.108,0,faceScale)+.018],
  ];
  const noseFaces=[0,2,1,0,1,3,2,1,4,4,3,1];
  parts.head.addSurface(noseProfile.map(([x,y,z])=>[x,R.neck+y,z]),noseFaces,()=>[[idx.head,1]],()=>PALETTE.skinHi);
  for(const side of [-1,1]) {
    const earX=side*.098,earY=.126,earZ=faceFrontZ(earY,side*.092,faceScale)-.018,earScale=male?1:.9;
    parts.head.ellipsoid([earX,R.neck+earY,earZ],[.023*earScale,.037*earScale,.021*earScale],16,8,()=>[[idx.head,1]],PALETTE.skin);
  }
  // A narrow curved lip ribbon is indexed once, with no duplicate-vertex indexing.
  const mouth=[],mf=[];
  for(let i=0;i<=8;i++) {
    const x=(i/8-.5)*.064*faceScale,abs=Math.abs(x),y=.062+.002*(abs/(.032*faceScale)),z=faceFrontZ(y,x,faceScale)+.002;
    mouth.push([x,R.neck+y-.002,z],[x,R.neck+y+.002,z]);
  }
  for(let i=0;i<8;i++){const a=i*2;mf.push(a,a+2,a+3,a,a+3,a+1);}
  parts.head.addSurface(mouth,mf,()=>[[idx.head,1]],()=>0x875a51);
  // Layered eye disks follow the face curve at every vertex, avoiding ellipsoid intersections.
  const eyeDisk=(cx,cy,rx,ry,offset,color)=>{
    const sides=20,points=[[cx,R.neck+cy,faceFrontZ(cy,cx,faceScale)+offset]],faces=[];
    for(const radius of [.62,1])for(let i=0;i<sides;i++){
      const a=2*Math.PI*i/sides,x=cx+Math.cos(a)*rx*radius,y=cy+Math.sin(a)*ry*radius;
      points.push([x,R.neck+y,faceFrontZ(y,x,faceScale)+offset]);
    }
    const inner=1,outer=1+sides;
    for(let i=0;i<sides;i++){
      const next=(i+1)%sides;
      faces.push(0,inner+i,inner+next,inner+i,outer+i,outer+next,inner+i,outer+next,inner+next);
    }
    parts.eyes.addSurface(points,faces,()=>[[idx.head,1]],()=>color,true);
  };
  for(const side of [-1,1]) {
    const x=side*.035,y=.165;
    eyeDisk(x,y,.023,.011,.001,PALETTE.eye);
    eyeDisk(x,y,.020,.009,.0022,0xeee1c7);
    eyeDisk(x,y,.006,.007,.0033,0x503d34);
    eyeDisk(x,y,.0028,.004,.0044,0x201d1c);
  }
  // Tank top: torso-hugging woven shell with broad shoulders and modest coverage.
  parts.top.loft([
    {y:.94,rx:.151,rz:.109},{y:1.00,rx:.151,rz:.105},{y:1.09,rx:male?.155:.145,rz:.103},
    {y:1.19,rx:male?.17:.157,rz:.112},{y:1.29,rx:male?.182:.165,rz:.118},
    {y:1.37,rx:male?.184:.169,rz:.119},{y:1.40,rx:.177,rz:.112},{y:1.43,rx:.157,rz:.096},
  ],24,p=>bodyWeight(p[1],R),p=>p[1]>1.32?PALETTE.shirt:PALETTE.shirtShade,false);
  // Shoulder straps overlap the deltoids and chest so the sleeveless shell closes at the armholes.
  for(const side of [1,-1]) {
    const arm=side>0?idx.armL:idx.armR;
    parts.top.ellipsoid([side*R.shX*.86,1.428,0],[.043,.072,.077],18,10,
      p=>{const t=.55*smooth(1.36,1.49,p[1]);return [[idx.chest,1-t],[arm,t]];},PALETTE.shirt);
  }
  // A hip shell joins two fitted short legs; the leg hems and central crotch stay distinct.
  parts.shorts.loft([
    {y:.80,rx:.137,rz:.104},{y:.84,rx:.151,rz:.114},{y:.89,rx:.16,rz:.12},
    {y:.94,rx:.155,rz:.117},{y:.98,rx:.155,rz:.118},{y:1.005,rx:.15,rz:.112},
  ],24,p=>bodyWeight(p[1],R),p=>p[1]>.91?PALETTE.shortsShade:PALETTE.shorts,false);
  for(const side of [1,-1]) {
    const x=side*R.legX, w=p=>legWeight(side,R,p[1]);
    parts.shorts.loft([
      {y:.62,x:x*.97,z:.001,rx:.076*scale,rz:.085},{y:.68,x:x*.95,z:0,rx:.088*scale,rz:.096},
      {y:.76,x:x*.92,z:0,rx:.099*scale,rz:.105},{y:.83,x:x*.88,z:.001,rx:.111*scale,rz:.111},
      {y:.88,x:x*.80,z:.002,rx:.106*scale,rz:.105},{y:.91,x:x*.73,z:.003,rx:.089*scale,rz:.09},
    ],22,w,p=>p[1]>.84?PALETTE.shortsShade:PALETTE.shorts,true);
  }
  return {R,parts};
}

function jointPositions(R) {
  return { body:[0,0,0], hips:[0,R.hip+.02,0], thighL:[R.legX,R.hip,0], shinL:[R.legX,R.knee,.01],
    thighR:[-R.legX,R.hip,0], shinR:[-R.legX,R.knee,.01], spine:[0,R.waist,0], chest:[0,R.chest,0],
    head:[0,R.neck,.005], armL:[R.shX,R.shY,0], foreL:[R.shX+.004,R.elbow,0], armR:[-R.shX,R.shY,0], foreR:[-R.shX-.004,R.elbow,0],
    clothF:[0,R.hip+.05,.09],clothB:[0,R.hip+.05,-.09] };
}
function addChunk(chunks, bytes, target=4) { while(chunks.length%target)chunks.push(0); const offset=chunks.length; for(const b of bytes)chunks.push(b); return {offset,length:bytes.length}; }
function typed(values, Ctor) { return new Uint8Array(new Ctor(values).buffer); }
function buildGlb(kind) {
  const {R,parts}=createBodyParts(kind), J=jointPositions(R), nodes=[], meshes=[], accessors=[], views=[], binary=[];
  const nodeIndex={};
  for(let i=0;i<BONES.length;i++){nodeIndex[BONES[i]]=nodes.length;nodes.push({name:BONES[i],translation:[0,0,0],children:[]});}
  for(const name of BONES){const p=PARENT[name]; if(p)nodes[nodeIndex[p]].children.push(nodeIndex[name]);}
  for(const name of BONES){const parent=PARENT[name], here=J[name], origin=parent?J[parent]:[0,0,0]; nodes[nodeIndex[name]].translation=here.map((v,k)=>v-origin[k]);}
  const ibm=[];
  for(const name of BONES){const pos=J[name], m=new THREE.Matrix4().makeTranslation(pos[0],pos[1],pos[2]).invert(); ibm.push(...m.toArray());}
  const iv=addChunk(binary,typed(ibm,Float32Array)); views.push({buffer:0,byteOffset:iv.offset,byteLength:iv.length});
  const ia=accessors.length; accessors.push({bufferView:0,componentType:5126,count:BONES.length,type:'MAT4'});
  const meshParts=Object.values(parts);
  for(const part of meshParts){
    const pos=part.positions, norm=new Array(pos.length).fill(0), idxs=part.indices;
    for(let i=0;i<idxs.length;i+=3){const a=idxs[i]*3,b=idxs[i+1]*3,c=idxs[i+2]*3; const ab=[pos[b]-pos[a],pos[b+1]-pos[a+1],pos[b+2]-pos[a+2]],ac=[pos[c]-pos[a],pos[c+1]-pos[a+1],pos[c+2]-pos[a+2]]; const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]; for(const o of [a,b,c]){norm[o]+=n[0];norm[o+1]+=n[1];norm[o+2]+=n[2];}}
    for(let i=0;i<norm.length;i+=3){const len=Math.hypot(norm[i],norm[i+1],norm[i+2])||1;norm[i]/=len;norm[i+1]/=len;norm[i+2]/=len;}
    const attributes={};
    const attr=(key,values,ctor,componentType,type)=>{const c=values.length/(type==='VEC4'?4:type==='VEC3'?3:type==='SCALAR'?1:1),chunk=addChunk(binary,typed(values,ctor)); const view=views.length;views.push({buffer:0,byteOffset:chunk.offset,byteLength:chunk.length,target:34962}); const access=accessors.length;accessors.push({bufferView:view,componentType,count:c,type});attributes[key]=access; if(key==='POSITION'){const xs=[],ys=[],zs=[];for(let i=0;i<values.length;i+=3){xs.push(values[i]);ys.push(values[i+1]);zs.push(values[i+2]);} accessors[access].min=[Math.min(...xs),Math.min(...ys),Math.min(...zs)];accessors[access].max=[Math.max(...xs),Math.max(...ys),Math.max(...zs)];}};
    attr('POSITION',pos,Float32Array,5126,'VEC3'); attr('NORMAL',norm,Float32Array,5126,'VEC3'); attr('COLOR_0',part.colors,Float32Array,5126,'VEC3');
    attr('JOINTS_0',part.joints,Uint16Array,5123,'VEC4'); attr('WEIGHTS_0',part.weights,Float32Array,5126,'VEC4');
    const ib=addChunk(binary,typed(idxs,Uint32Array)); const v=views.length;views.push({buffer:0,byteOffset:ib.offset,byteLength:ib.length,target:34963}); const ix=accessors.length;accessors.push({bufferView:v,componentType:5125,count:idxs.length,type:'SCALAR'});
    const mesh=meshes.length;meshes.push({name:part.name,primitives:[{attributes,indices:ix,material:0,mode:4}]});
    nodes.push({name:part.name,mesh,skin:0});
  }
  const skinIndex=0;
  const materials=[{name:'hand_painted_blockout',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.88},alphaMode:'OPAQUE',doubleSided:false}];
  const json={asset:{version:'2.0',generator:'characters-base-v0 procedural generator'},scene:0,scenes:[{nodes:[nodeIndex.body,...meshParts.map((_,i)=>BONES.length+i)]}],nodes,meshes,skins:[{name:`${kind}_base_skin`,inverseBindMatrices:ia,skeleton:nodeIndex.body,joints:BONES.map(n=>nodeIndex[n])}],materials,accessors,bufferViews:views,buffers:[{byteLength:binary.length}]};
  const jsonText=JSON.stringify(json), j0=Buffer.from(jsonText), j=Buffer.concat([j0,Buffer.alloc((4-j0.length%4)%4,0x20)]); while(binary.length%4)binary.push(0);
  const bin=Buffer.from(binary), total=12+8+j.length+8+bin.length, glb=Buffer.alloc(total);
  glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(total,8);
  glb.writeUInt32LE(j.length,12);glb.writeUInt32LE(0x4e4f534a,16);j.copy(glb,20);
  const bo=20+j.length;glb.writeUInt32LE(bin.length,bo);glb.writeUInt32LE(0x004e4942,bo+4);bin.copy(glb,bo+8);
  return {glb,json,stats:{tris:meshParts.reduce((n,p)=>n+p.indices.length/3,0),meshes:meshParts.map(p=>({name:p.name,vertices:p.positions.length/3,triangles:p.indices.length/3})),joints:BONES.length,height:1.95}};
}

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function inspectGlb(buffer) {
  if(buffer.readUInt32LE(0)!==0x46546c67||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length) throw new Error('GLB header mismatch');
  const jl=buffer.readUInt32LE(12), json=JSON.parse(buffer.toString('utf8',20,20+jl));
  const binHead=20+jl, bl=buffer.readUInt32LE(binHead), bin=buffer.subarray(binHead+8,binHead+8+bl);
  const get= (i)=>{const a=json.accessors[i],v=json.bufferViews[a.bufferView],off=(v.byteOffset||0)+(a.byteOffset||0), n=a.count*(a.type==='MAT4'?16:a.type==='VEC4'?4:a.type==='VEC3'?3:1);return {a,v,off,n};};
  const skin=json.skins[0], jointNames=skin.joints.map(n=>json.nodes[n].name), names=json.meshes.map(m=>m.name); let tris=0,minY=Infinity,maxY=-Infinity,zero=0,bad=0,weightAccessor=null;
  for(const m of json.meshes){for(const p of m.primitives){const ix=json.accessors[p.indices];tris+=ix.count/3;const ps=json.accessors[p.attributes.POSITION],pv=json.bufferViews[ps.bufferView],po=(pv.byteOffset||0), arr=new Float32Array(bin.buffer,bin.byteOffset+po,ps.count*3); for(let i=1;i<arr.length;i+=3){minY=Math.min(minY,arr[i]);maxY=Math.max(maxY,arr[i]);} weightAccessor=p.attributes.WEIGHTS_0;const a=json.accessors[weightAccessor],v=json.bufferViews[a.bufferView],off=v.byteOffset||0,w=new Float32Array(bin.buffer,bin.byteOffset+off,a.count*4);for(let i=0;i<w.length;i+=4){const sum=w[i]+w[i+1]+w[i+2]+w[i+3];if(sum<1e-6)zero++;if(Math.abs(sum-1)>.001)bad++;}}}
  return {json,tris,minY,maxY,height:maxY-minY,meshNames:names,jointNames,zeroWeights:zero,unnormalizedWeights:bad,hasSkin:!!skin,channels:Object.keys(json.meshes[0].primitives[0].attributes)};
}

const checking=process.argv.includes('--check'), force=process.argv.includes('--force'), outputNames=['male-base-v0.glb','female-base-v0.glb'];
const sourcePath=fileURLToPath(import.meta.url), sourceSha256=sha(fs.readFileSync(sourcePath));
if(checking){
  const receiptPath=path.join(OUT,'models-receipt.json');
  if(!fs.existsSync(receiptPath))throw new Error('Receipt is missing; run generator to create the base models.');
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  if(receipt.sourceSha256!==sourceSha256)throw new Error(`Generator source hash differs from receipt: expected ${receipt.sourceSha256}, found ${sourceSha256}`);
  for(const [kind,name] of [['male','male-base-v0.glb'],['female','female-base-v0.glb']]){
    const file=path.join(OUT,name);if(!fs.existsSync(file))throw new Error(`${name} is missing`);
    const bytes=fs.readFileSync(file), model=inspectGlb(bytes), expected=receipt.models[name], rebuilt=buildGlb(kind).glb;
    if(sha(bytes)!==expected.sha256)throw new Error(`${name} hash differs from receipt`);
    if(sha(rebuilt)!==sha(bytes))throw new Error(`${name} differs from a fresh in-memory build`);
    if(model.tris!==expected.triangles||model.height<1.75||model.height>2.05||model.zeroWeights||model.unnormalizedWeights)throw new Error(`${name} structural check failed`);
    console.log(`${name}: sha256 ${expected.sha256}, ${model.tris} tris, ${model.height.toFixed(3)} m, reproducible skin ok`);
  }
  console.log(`Source sha256 ${sourceSha256}; receipt check passed without writing.`); process.exit(0);
}
fs.mkdirSync(OUT,{recursive:true});
const existing=[...outputNames,'models-receipt.json'].filter(n=>fs.existsSync(path.join(OUT,n)));
if(existing.length&&!force)throw new Error(`Refusing to overwrite existing output(s): ${existing.join(', ')}. Use --check or --force.`);
const receipt={schema:'characters-base-v0/receipt-1',generatedBy:'tools/characters-base-v0/generate.mjs',sourceSha256,coordinateSystem:{up:'+Y',front:'+Z',characterLeft:'+X',units:'meters'},pose:'arms relaxed down; A pose preview may rotate arms later',design:'stylized painted pirate-comic human base blockout; bald, neutral face, sleeveless modest top, short modest shorts, bare feet',rig:{bones:BONES,parent:PARENT,vertexWeights:'up to 4 normalized weights per vertex'},models:{}};
for(const [kind,file] of [['male','male-base-v0.glb'],['female','female-base-v0.glb']]){
  const model=buildGlb(kind), check=inspectGlb(model.glb);
  if(check.tris>12000||check.height<1.75||check.height>2.05||check.zeroWeights||check.unnormalizedWeights||check.jointNames.join('|')!==BONES.join('|'))throw new Error(`${kind} validation failed: ${JSON.stringify(check)}`);
  fs.writeFileSync(path.join(OUT,file),model.glb);
  receipt.models[file]={sha256:sha(model.glb),bytes:model.glb.length,triangles:check.tris,heightMeters:Number(check.height.toFixed(4)),bounds:[Number(check.minY.toFixed(4)),Number(check.maxY.toFixed(4))],meshes:model.stats.meshes,joints:check.jointNames,channels:check.channels,skin:true,normalizedWeights:true};
  console.log(`${file}: ${check.tris} tris, ${check.height.toFixed(3)} m, ${model.glb.length} bytes`);
}
receipt.limitations=['Blockout v0 built from lofted parametric surfaces; silhouette and joints need visual review in the project viewer.','Neutral face and clothes are vertex-painted color regions; no textures, hair, beard, accessories, shoes, or animation clips.','Eyes are simple layered face-conforming color patches for rig blockout; production facial anatomy and expression detail need a later art pass.','A small number of intersecting loft surfaces remain at joins; review deformation around shoulders, hips, fingers, and feet before production use.','The 15-bone game hierarchy is reused, but this generator does not alter the runtime, importer, asset manifest, or profiles.'];
fs.writeFileSync(path.join(OUT,'models-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(`Receipt written: ${path.relative(ROOT,path.join(OUT,'models-receipt.json'))}`);

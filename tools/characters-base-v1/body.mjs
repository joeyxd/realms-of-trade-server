// P02a continuous character body and garments.
// UVs use a cylindrical atlas: U = atan2(X, Z) / TAU + 0.5; V=0 is the top and V=1 is the hem/bottom.
// Keep the seam at the back of the model; texture consumers should use repeat wrapping on U.
import * as THREE from 'three';

const TAU = Math.PI * 2;
export const BODY_BONES = ['body','hips','thighL','shinL','thighR','shinR','spine','chest','head','armL','foreL','armR','foreR','clothF','clothB'];
const BI = Object.fromEntries(BODY_BONES.map((name,index)=>[name,index]));
const SMOOTH_K = 0.025;
const GRID_STEP = 0.04;
const COLOR = {
  skin: 0xc89575,
  top: 0x4d6270,
  shorts: 0x4b4b49,
};

const clamp = (x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smoothstep = (a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=(a)=>Math.hypot(a[0],a[1],a[2]);
const unit=(a)=>{const l=length(a)||1;return [a[0]/l,a[1]/l,a[2]/l];};
const linearColor=(hex)=>new THREE.Color(hex).toArray();

function smin(a,b,k) {
  if(!Number.isFinite(a))return b;
  if(!Number.isFinite(b))return a;
  const h=Math.max(k-Math.abs(a-b),0)/k;
  return Math.min(a,b)-h*h*k*0.25;
}
function ellipsoidSdf(p,c,r) {
  const x=p[0]-c[0],y=p[1]-c[1],z=p[2]-c[2];
  const k0=Math.hypot(x/r[0],y/r[1],z/r[2]);
  const k1=Math.hypot(x/(r[0]*r[0]),y/(r[1]*r[1]),z/(r[2]*r[2]));
  return k1<1e-9?-Math.min(...r):k0*(k0-1)/k1;
}
function segmentSample(p,a,b,r0,r1=r0) {
  const ab=sub(b,a),den=dot(ab,ab)||1,t=clamp(dot(sub(p,a),ab)/den),q=add(a,mul(ab,t));
  return { distance:length(sub(p,q))-lerp(r0,r1,t), t };
}
const capsuleSdf=(p,a,b,r0,r1=r0)=>segmentSample(p,a,b,r0,r1).distance;

function loftSdf(p,profile) {
  const y=p[1],lo=profile[0][0],hi=profile[profile.length-1][0],yc=clamp(y,lo,hi);
  let i=0;while(i<profile.length-2&&profile[i+1][0]<yc)i++;
  const a=profile[i],b=profile[i+1],t=(yc-a[0])/(b[0]-a[0]);
  const rx=lerp(a[1],b[1],t),rz=lerp(a[2],b[2],t);
  const radial=(Math.hypot(p[0]/rx,p[2]/rz)-1)*Math.min(rx,rz);
  const vertical=Math.max(lo-y,y-hi);
  return radial>0&&vertical>0?Math.hypot(radial,vertical):Math.max(radial,vertical);
}

function createShape(kind,R) {
  const male=kind==='male';
  const bodyProfile=[
    [.76,.125,.098],[.83,.15,.11],[.91,.158,.115],[.98,.147,.105],
    [1.04,male?.142:.132,.095],[1.12,male?.151:.141,.101],
    [1.22,male?.17:.151,.109],[1.32,male?.178:.159,.113],
    [1.40,male?.17:.153,.109],[1.45,.171,.105],[1.49,.145,.087],
    [1.53,.098,.065],[R.neck,.061,.052],
  ];
  const arms=[],legs=[],hands=[];
  for(const side of [1,-1]){
    const shoulder=[side*R.shX,R.shY,0],elbow=[side*(R.shX+.040),R.elbow,.002],wrist=[side*(R.shX+.090),R.wrist,.012];
    const upper={side,a:shoulder,b:elbow,r0:male?.056:.051,r1:male?.047:.043,bone:side>0?BI.armL:BI.armR,prox:BI.chest};
    const fore={side,a:elbow,b:wrist,r0:male?.045:.041,r1:.034,bone:side>0?BI.foreL:BI.foreR,prox:upper.bone};
    arms.push(upper,fore);
    const hip=[side*R.legX,R.hip,0],knee=[side*R.legX,R.knee,.004],ankle=[side*R.legX*.93,.18,.025];
    legs.push({side,a:hip,b:knee,r0:male?.098:.094,r1:.066,bone:side>0?BI.thighL:BI.thighR,prox:BI.hips},
      {side,a:knee,b:ankle,r0:.067,r1:.043,bone:side>0?BI.shinL:BI.shinR,prox:side>0?BI.thighL:BI.thighR});
    const handX=side*(R.shX+.105),palm=[handX,.84,.015];
    hands.push({side,palm,foreBone:side>0?BI.foreL:BI.foreR});
  }

  const body=(p)=>{
    let d=loftSdf(p,bodyProfile);
    d=smin(d,capsuleSdf(p,[0,R.neck-.055,0],[0,R.neck+.07,0],.054,.049),.018);
    for(const side of [1,-1]){
      const arm=arms.filter(s=>s.side===side);
      d=smin(d,ellipsoidSdf(p,[side*R.shX*.86,R.shY-.045,0],[.087,.072,.078]),.03);
      for(const seg of arm)d=smin(d,capsuleSdf(p,seg.a,seg.b,seg.r0,seg.r1),.02);
      const hand=hands.find(h=>h.side===side),[hx,hy,hz]=hand.palm;
      d=smin(d,ellipsoidSdf(p,hand.palm,[.044*R.hand,.057,.035]),.014);
      for(let finger=0;finger<4;finger++){
        const spread=(finger-1.5)*.018,fx=hx+spread,tipY=hy-[.085,.099,.092,.078][finger]*R.hand;
        d=smin(d,capsuleSdf(p,[fx,hy-.028,hz+.016],[fx+spread*.2,tipY,hz+.028],.010,.0065),.007);
      }
      d=smin(d,capsuleSdf(p,[hx-side*.033,hy-.01,hz+.015],[hx-side*.065,hy-.067,hz+.04],.012,.007),.008);
    }
    for(const side of [1,-1]){
      const leg=legs.filter(s=>s.side===side);
      for(const seg of leg)d=smin(d,capsuleSdf(p,seg.a,seg.b,seg.r0,seg.r1),.022);
      const x=side*R.legX*.93;
      d=smin(d,ellipsoidSdf(p,[x,.105,.07],[.053,.086,.125]),.02);
      for(let toe=0;toe<4;toe++){
        const tx=x+(toe-1.5)*.022,len=[.064,.074,.067,.052][toe];
        d=smin(d,capsuleSdf(p,[tx,.052,.145],[tx,.043,.145+len*.62],.013,.009),.006);
      }
    }
    return d;
  };

  const armField=(p)=>{
    let d=Infinity;
    for(const seg of arms)d=Math.min(d,capsuleSdf(p,seg.a,seg.b,seg.r0,seg.r1));
    for(const side of [1,-1])d=Math.min(d,ellipsoidSdf(p,[side*R.shX*.86,R.shY-.045,0],[.087,.072,.078]));
    for(const hand of hands){
      const [hx,hy,hz]=hand.palm;
      d=Math.min(d,ellipsoidSdf(p,hand.palm,[.044*R.hand,.057,.035]));
      for(let finger=0;finger<4;finger++){
        const spread=(finger-1.5)*.018,fx=hx+spread,tipY=hy-[.085,.099,.092,.078][finger]*R.hand;
        d=Math.min(d,capsuleSdf(p,[fx,hy-.028,hz+.016],[fx+spread*.2,tipY,hz+.028],.010,.0065));
      }
      d=Math.min(d,capsuleSdf(p,[hx-hand.side*.033,hy-.01,hz+.015],[hx-hand.side*.065,hy-.067,hz+.04],.012,.007));
    }
    return d;
  };
  const nonArmField=(p)=>{
    let d=loftSdf(p,bodyProfile);
    d=Math.min(d,capsuleSdf(p,[0,R.neck-.055,0],[0,R.neck+.07,0],.054,.049));
    for(const seg of legs)d=Math.min(d,capsuleSdf(p,seg.a,seg.b,seg.r0,seg.r1));
    for(const side of [1,-1]){
      const x=side*R.legX*.93;
      d=Math.min(d,ellipsoidSdf(p,[x,.105,.07],[.053,.086,.125]));
      for(let toe=0;toe<4;toe++){
        const tx=x+(toe-1.5)*.022,len=[.064,.074,.067,.052][toe];
        d=Math.min(d,capsuleSdf(p,[tx,.052,.145],[tx,.043,.145+len*.62],.013,.009));
      }
    }
    return d;
  };

  const topProfile=[
    [.935,.157,.116],[1.00,.16,.119],[1.10,.164,.116],[1.20,.179,.123],
    [1.31,.187,.126],[1.39,.183,.121],[1.43,.17,.108],[1.46,.15,.09],
  ];
  const top=(p)=>{
    let d=loftSdf(p,topProfile)-.008;
    const neckHole=capsuleSdf(p,[0,1.34,0],[0,R.neck+.15,0],.065,.073);
    d=Math.max(d,-neckHole);
    for(const side of [1,-1]){
      const shoulder=[side*R.shX,R.shY,.0],armEnd=[side*(R.shX+.01),1.29,.0];
      d=Math.max(d,-capsuleSdf(p,armEnd,shoulder,.057,.061));
    }
    for(const side of [1,-1]){
      const a=[side*.07,1.35,.0],b=[side*R.shX*.84,1.455,0];
      const strap=capsuleSdf(p,a,b,.025,.025);
      d=smin(d,strap,.018);
    }
    return d;
  };

  const shortsProfile=[
    [.775,.148,.116],[.83,.168,.128],[.90,.172,.131],[.97,.169,.129],[1.005,.158,.122],
  ];
  const shorts=(p)=>{
    let d=loftSdf(p,shortsProfile);
    for(const side of [1,-1]){
      d=smin(d,capsuleSdf(p,[side*R.legX,.90,.006],[side*R.legX*1.10,.70,.005],.106,.094),.032);
    }
    return d;
  };
  return {body,top,shorts,bodyProfile,arms,legs,hands,armField,nonArmField};
}

function weightAt(p,R,shape,part='body') {
  const y=p[1],absX=Math.abs(p[0]),side=p[0]>=0?1:-1;
  const armUpper=side>0?BI.armL:BI.armR,armFore=side>0?BI.foreL:BI.foreR;
  const thigh=side>0?BI.thighL:BI.thighR,shin=side>0?BI.shinL:BI.shinR;
  const weights=(entries)=>{
    const clean=entries.filter(([,w])=>w>1e-5).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=clean.reduce((n,[,w])=>n+w,0)||1;
    return clean.map(([bone,w])=>[bone,w/sum]);
  };
  const torso=(includeHead=true)=>{
    const pelvis=1-smoothstep(.84,1.01,y),chest=smoothstep(1.10,1.31,y),spine=Math.max(.02,1-pelvis-chest);
    const head=includeHead?smoothstep(R.neck-.09,R.neck,y):0;
    const bodyScale=1-head;
    return weights([[BI.hips,pelvis*bodyScale],[BI.spine,spine*bodyScale],[BI.chest,chest*bodyScale],[BI.head,head]]);
  };
  const legWeights=()=>{
    const pelvis=smoothstep(R.hip-.10,R.hip+.06,y);
    const knee=smoothstep(R.knee-.12,R.knee+.12,y);
    return weights([[BI.hips,pelvis],[thigh,(1-pelvis)*knee],[shin,(1-pelvis)*(1-knee)]]);
  };
  const blend=(a,b,t)=>{
    const map=new Map();
    for(const [bone,w] of a)map.set(bone,(map.get(bone)||0)+w*(1-t));
    for(const [bone,w] of b)map.set(bone,(map.get(bone)||0)+w*t);
    return weights([...map.entries()]);
  };
  const lowerBody=1-smoothstep(R.hip-.14,R.hip+.10,y);
  const medialCrotch=(1-smoothstep(.025,.08,absX))*smoothstep(.60,.72,y)*(1-smoothstep(R.hip+.025,R.hip+.10,y));
  const lowerBodyWeights=()=>{
    const base=blend(torso(),legWeights(),lowerBody);
    return blend(base,[[BI.hips,1]],medialCrotch);
  };

  // Shorts use a smooth hips-to-leg transition and never pick up arm weights.
  if(part==='shorts'){
    const shortsBase=blend([[BI.hips,1]],legWeights(),lowerBody);
    return blend(shortsBase,[[BI.hips,1]],medialCrotch);
  }

  // The tank top follows torso weights, with a vertically blended arm weight
  // only on the shoulder straps.
  if(part==='top'){
    const strapY=smoothstep(1.34,1.40,y);
    const strapArm=smoothstep(R.shX-.075,R.shX+.01,absX);
    const strapWeights=weights([[BI.chest,1-strapArm],[armUpper,strapArm]]);
    return blend(torso(false),strapWeights,strapY);
  }

  const elbowUpper=smoothstep(R.elbow-.12,R.elbow+.12,y);
  const shoulderBand=smoothstep(R.elbow-.03,R.shY-.10,y);
  const fieldBand=lerp(.015,.19,shoulderBand);
  const medialShoulder=smoothstep(R.shX-.10,R.shX+.10,absX);
  const armMix=smoothstep(-fieldBand,fieldBand,shape.nonArmField(p)-shape.armField(p))*medialShoulder;
  const foreMix=1-elbowUpper;
  const armWeights=weights([[armUpper,1-foreMix],[armFore,foreMix]]);
  return blend(lowerBodyWeights(),armWeights,armMix);
}

const CORNERS=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const TETS=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const TET_EDGES=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
function tetraGradient(points,values) {
  const e1=sub(points[1],points[0]),e2=sub(points[2],points[0]),e3=sub(points[3],points[0]);
  const c23=cross(e2,e3),c31=cross(e3,e1),c12=cross(e1,e2),det=dot(e1,c23)||1e-12;
  return unit(add(add(mul(c23,(values[1]-values[0])/det),mul(c31,(values[2]-values[0])/det)),mul(c12,(values[3]-values[0])/det)));
}
// Merge sub-0.1mm numerical duplicates at tetrahedron junctions so that no
// quantization slivers leave open boundary edges in the exported surface.
function pointKey(p){return `${Math.round(p[0]*1e4)},${Math.round(p[1]*1e4)},${Math.round(p[2]*1e4)}`;}
function triangleNormal(a,b,c){return cross(sub(b,a),sub(c,a));}
function componentCount(indices,vertexCount) {
  const parent=new Int32Array(vertexCount);for(let i=0;i<vertexCount;i++)parent[i]=i;
  const find=(x)=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  for(let i=0;i<indices.length;i+=3){const a=find(indices[i]),b=find(indices[i+1]),c=find(indices[i+2]);parent[a]=b;parent[c]=b;}
  const roots=new Set();for(let i=0;i<vertexCount;i++)roots.add(find(i));return roots.size;
}

function extractSurface(field,options) {
  const {min,max,step=GRID_STEP,weights,color,uvRange}=options;
  const rawNx=Math.ceil((max[0]-min[0])/step);
  // Keep the centerline on a voxel plane for symmetric fields. An odd cell count
  // puts the samples at +/- half a cell and can falsely bridge two separated legs.
  const nx=Math.abs(min[0]+max[0])<1e-9?rawNx+(rawNx%2):rawNx;
  const ny=Math.ceil((max[1]-min[1])/step),nz=Math.ceil((max[2]-min[2])/step);
  const dx=(max[0]-min[0])/nx,dy=(max[1]-min[1])/ny,dz=(max[2]-min[2])/nz;
  const sx=nx+1,sy=ny+1,sz=nz+1,total=sx*sy*sz,values=new Float32Array(total);
  const gid=(i,j,k)=>(k*sy+j)*sx+i;
  for(let k=0;k<sz;k++)for(let j=0;j<sy;j++)for(let i=0;i<sx;i++)values[gid(i,j,k)]=field([min[0]+i*dx,min[1]+j*dy,min[2]+k*dz]);
  const positions=[],indices=[],keyToIndex=new Map();
  const indexFor=(p)=>{
    const key=pointKey(p);let id=keyToIndex.get(key);if(id!==undefined)return id;
    id=positions.length/3;positions.push(p[0],p[1],p[2]);keyToIndex.set(key,id);return id;
  };
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const cp=CORNERS.map(([cx,cy,cz])=>[min[0]+(i+cx)*dx,min[1]+(j+cy)*dy,min[2]+(k+cz)*dz]);
    const cv=CORNERS.map(([cx,cy,cz])=>values[gid(i+cx,j+cy,k+cz)]);
    if(cv.every(v=>v>=0)||cv.every(v=>v<0))continue;
    for(const tet of TETS){
      const tp=tet.map(v=>cp[v]),tv=tet.map(v=>cv[v]);if(tv.every(v=>v>=0)||tv.every(v=>v<0))continue;
      const poly=[];
      for(const [ea,eb] of TET_EDGES){const va=tv[ea],vb=tv[eb];if((va<0)===(vb<0))continue;const t=va/(va-vb);poly.push(add(tp[ea],mul(sub(tp[eb],tp[ea]),t)));}
      if(poly.length<3)continue;
      const center=poly.reduce((s,p)=>add(s,p),[0,0,0]).map(v=>v/poly.length),n=tetraGradient(tp,tv);
      const helper=Math.abs(n[1])<.9?[0,1,0]:[1,0,0],u=unit(cross(n,helper)),v=cross(n,u);
      poly.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
      const root=indexFor(poly[0]);
      for(let q=1;q<poly.length-1;q++){
        let tri=[root,indexFor(poly[q]),indexFor(poly[q+1])];
        const a=tri.map(id=>positions.slice(id*3,id*3+3));
        if(dot(triangleNormal(a[0],a[1],a[2]),n)<0)tri=[tri[0],tri[2],tri[1]];
        if(length(triangleNormal(...tri.map(id=>positions.slice(id*3,id*3+3))))>1e-10)indices.push(...tri);
      }
    }
  }
  const vertexCount=positions.length/3;
  const normals=new Float32Array(vertexCount*3),uvs=new Float32Array(vertexCount*2),colors=new Float32Array(vertexCount*3),skinIndex=new Uint16Array(vertexCount*4),skinWeight=new Float32Array(vertexCount*4);
  const eps=step*.12;
  for(let i=0;i<vertexCount;i++){
    const p=positions.slice(i*3,i*3+3),g=unit([field([p[0]+eps,p[1],p[2]])-field([p[0]-eps,p[1],p[2]]),field([p[0],p[1]+eps,p[2]])-field([p[0],p[1]-eps,p[2]]),field([p[0],p[1],p[2]+eps])-field([p[0],p[1],p[2]-eps])]);
    normals.set(g,i*3);
    const u=(Math.atan2(p[0],p[2])/TAU+.5)%1,v=1-clamp((p[1]-uvRange[0])/(uvRange[1]-uvRange[0]));uvs[i*2]=u<0?u+1:u;uvs[i*2+1]=v;
    colors.set(linearColor(color(p)),i*3);
    const ws=weights(p);for(let q=0;q<ws.length;q++){skinIndex[i*4+q]=ws[q][0];skinWeight[i*4+q]=ws[q][1];}
  }
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2],pa=positions.slice(a*3,a*3+3),pb=positions.slice(b*3,b*3+3),pc=positions.slice(c*3,c*3+3);
    const face=triangleNormal(pa,pb,pc),avg=[0,1,2].map(axis=>(normals[a*3+axis]+normals[b*3+axis]+normals[c*3+axis])/3);
    if(dot(face,avg)<0){indices[i+1]=c;indices[i+2]=b;}
  }
  // Split just the cylindrical U seam so every triangle interpolates across the short path, with UVs still in [0, 1].
  const finalPos=positions.slice(),finalNorm=Array.from(normals),finalUv=Array.from(uvs),finalColor=Array.from(colors),finalJi=Array.from(skinIndex),finalJw=Array.from(skinWeight),finalIndices=[];
  const seamDuplicate=new Map();
  const duplicate=(id)=>{if(seamDuplicate.has(id))return seamDuplicate.get(id);const n=finalPos.length/3;finalPos.push(...positions.slice(id*3,id*3+3));finalNorm.push(...normals.slice(id*3,id*3+3));finalUv.push(uvs[id*2]<.5?1:0,uvs[id*2+1]);finalColor.push(...colors.slice(id*3,id*3+3));finalJi.push(...skinIndex.slice(id*4,id*4+4));finalJw.push(...skinWeight.slice(id*4,id*4+4));seamDuplicate.set(id,n);return n;};
  for(let i=0;i<indices.length;i+=3){const tri=[indices[i],indices[i+1],indices[i+2]],us=tri.map(id=>uvs[id*2]);if(Math.max(...us)-Math.min(...us)>.5){for(let q=0;q<3;q++)if(us[q]<.5)tri[q]=duplicate(tri[q]);}finalIndices.push(...tri);}
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(finalPos,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(finalNorm,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(finalUv,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(finalColor,3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(finalJi,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(finalJw,4));
  geometry.setIndex(finalIndices);
  geometry.userData={uvMapping:'cylindrical; U=atan2(x,z)/(2*pi)+0.5, seam duplicated at the back; V=0 top, V=1 hem/bottom',components:componentCount(finalIndices,finalPos.length/3),triangles:finalIndices.length/3,sourceVertices:vertexCount};
  return geometry;
}

function meshOptions(kind,R,shape,part) {
  const weight=(p)=>weightAt(p,R,shape,part);
  if(part==='body')return {min:[-.38,.005,-.25],max:[.38,R.neck+.13,.30],step:GRID_STEP,weights:weight,color:()=>COLOR.skin,uvRange:[0,1.9]};
  if(part==='top')return {min:[-.34,.88,-.22],max:[.34,1.60,.22],step:GRID_STEP,weights:weight,color:()=>COLOR.top,uvRange:[.93,1.47]};
  return {min:[-.30,.50,-.21],max:[.30,1.08,.21],step:GRID_STEP,weights:weight,color:()=>COLOR.shorts,uvRange:[.60,1.01]};
}

export function createBody(kind='male') {
  if(kind!=='male'&&kind!=='female')throw new TypeError(`Unknown body kind: ${kind}`);
  const male=kind==='male';
  const R=male?{hip:.91,knee:.48,waist:1.00,chest:1.22,shY:1.48,shX:.215,elbow:1.16,wrist:.91,neck:1.57,legX:.102,head:.30,hand:1.0}:
    {hip:.89,knee:.47,waist:.99,chest:1.19,shY:1.44,shX:.198,elbow:1.13,wrist:.89,neck:1.54,legX:.097,head:.30,hand:.96};
  R.uvMapping='cylindrical atlas: U around +Y with seam at back; V=0 top, V=1 hem/bottom';
  const joints={body:[0,0,0],hips:[0,R.hip+.02,0],thighL:[R.legX,R.hip,0],shinL:[R.legX,R.knee,.01],
    thighR:[-R.legX,R.hip,0],shinR:[-R.legX,R.knee,.01],spine:[0,R.waist,0],chest:[0,R.chest,0],head:[0,R.neck,.005],
    armL:[R.shX,R.shY,0],foreL:[R.shX+.040,R.elbow,0],armR:[-R.shX,R.shY,0],foreR:[-R.shX-.040,R.elbow,0],
    clothF:[0,R.hip+.05,.09],clothB:[0,R.hip+.05,-.09]};
  const shape=createShape(kind,R);
  const geometry=extractSurface(shape.body,meshOptions(kind,R,shape,'body'));
  const top=extractSurface(shape.top,meshOptions(kind,R,shape,'top'));
  const shorts=extractSurface(shape.shorts,meshOptions(kind,R,shape,'shorts'));
  const totalTriangles=geometry.userData.triangles+top.userData.triangles+shorts.userData.triangles;
  if(geometry.userData.components!==1||top.userData.components!==1||shorts.userData.components!==1)throw new Error(`Disconnected surface component(s): ${JSON.stringify({body:geometry.userData.components,top:top.userData.components,shorts:shorts.userData.components})}`);
  if(totalTriangles>28000)throw new Error(`Character body exceeds 28k triangle hard cap: ${totalTriangles}`);
  return {R,geometry,top,shorts,joints};
}

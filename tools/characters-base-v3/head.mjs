// Neutral sculpted heads: one continuous face surface, with separate ear and eye attachments.
// UV is cylindrical: front at U=.5; PNG rows run from the crown to the chin.
import * as THREE from 'three';

const TAU = Math.PI * 2, clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const g = (x, y, cx, cy, rx, ry) => Math.exp(-(((x-cx)/rx)**2 + ((y-cy)/ry)**2));
const profile = [
  [-.012,.040,.041,.016],[.005,.051,.055,.012],[.024,.066,.064,.008],
  [.049,.080,.075,.003],[.081,.091,.085,-.002],[.112,.100,.095,-.005],
  [.145,.104,.103,-.006],[.178,.104,.108,-.009],[.213,.100,.109,-.012],
  [.249,.091,.102,-.015],[.281,.074,.087,-.017],[.302,.048,.060,-.018],
  [.314,.000,.000,-.018]
];
function shape(y, female) {
  let i=0; while(i<profile.length-2 && profile[i+1][0]<y) i++;
  const a=profile[i], b=profile[i+1], t=clamp((y-a[0])/(b[0]-a[0]));
  // Shape-preserving Hermite interpolation removes the steps of the linear v1 skull profile.
  const spline = (axis) => {
    const slope = (index) => {
      if(index===0)return (profile[1][axis]-profile[0][axis])/(profile[1][0]-profile[0][0]);
      if(index===profile.length-1)return (profile[index][axis]-profile[index-1][axis])/(profile[index][0]-profile[index-1][0]);
      const before=(profile[index][axis]-profile[index-1][axis])/(profile[index][0]-profile[index-1][0]);
      const after=(profile[index+1][axis]-profile[index][axis])/(profile[index+1][0]-profile[index][0]);
      return before*after<=0?0:2*before*after/(before+after);
    };
    const dt=b[0]-a[0],t2=t*t,t3=t2*t;
    return (2*t3-3*t2+1)*a[axis]+(t3-2*t2+t)*dt*slope(i)+(-2*t3+3*t2)*b[axis]+(t3-t2)*dt*slope(i+1);
  };
  const jaw = female ? .84+.16*clamp((y-.020)/.120) : 1;
  return { rx:Math.max(0,spline(1))*jaw, rz:Math.max(0,spline(2)), z:spline(3) };
}
function relief(x, y, female) {
  // Nose bridge, tip and wings emerge from the face itself, rather than an intersecting wedge.
  let z=(female?.017:.022)*g(x,y,0,.155,.009,.042) + .019*g(x,y,0,.124,.012,.011);
  z += .006*(g(x,y,-.012,.117,.009,.009)+g(x,y,.012,.117,.009,.009));
  z -= .005*g(x,y,0,.109,.015,.006);
  // Cheek planes, shallow orbital sockets, lips and a broad chin.
  for (const s of [-1,1]) {
    z += .010*g(x,y,s*.065,.133,.027,.026);
    z -= .009*g(x,y,s*.041,.176,.027,.014);
    z += (female?.007:.010)*g(x,y,s*.043,.196,.030,.013);
    z -= .003*g(x,y,s*.086,.186,.019,.030);
  }
  z += (female?.007:.0055)*g(x,y,0,.078,female?.024:.026,.005) + (female?.009:.007)*g(x,y,0,.065,female?.026:.028,.006);
  z -= .003*g(x,y,0,.052,.033,.005);
  z += (female?.006:.009)*g(x,y,0,.026,.040,.021);
  return z;
}
export function frontZ(x, y, kind) {
  const r=shape(y,kind==='female');
  const front=Math.max(0,1-(x/r.rx)**2);
  return r.z+r.rz*Math.sqrt(front)+front**2*relief(x,y,kind==='female');
}
class Surface {
  constructor(name) { this.name=name; this.p=[]; this.i=[]; this.c=[]; this.uv=[]; }
  vertex(p, color, uv) { const n=this.p.length/3; this.p.push(...p); this.c.push(...new THREE.Color(color).toArray()); this.uv.push(...uv); return n; }
  geometry() {
    const n=this.p.length/3, joints=new Uint16Array(n*4), weights=new Float32Array(n*4);
    for(let i=0;i<n;i++){joints[i*4]=8;weights[i*4]=1;}
    const geo=new THREE.BufferGeometry(); geo.name=this.name;
    geo.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
    geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
    geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    geo.setIndex(this.i);geo.computeVertexNormals(); return geo;
  }
  ribbon(points, width, color, R, kind, offset=.002) {
    const ids=[];
    for(const [x,y] of points) for(const d of [-width,width]) ids.push(this.vertex([x,R.neck+y+d,frontZ(x,y+d,kind)+offset],color,[.5+Math.asin(clamp(x/shape(y,kind==='female').rx,-1,1))/TAU,(.314-y)/.326]));
    for(let k=0;k<points.length-1;k++){const a=k*2;this.i.push(ids[a],ids[a+2],ids[a+3],ids[a],ids[a+3],ids[a+1]);}
  }
  disk(cx,cy,rx,ry,color,R,kind,offset,almond=false) {
    const center=this.vertex([cx,R.neck+cy,frontZ(cx,cy,kind)+offset],color,[.5,.5]);
    const rows=[], N=24;
    for(const radius of [.33,.67,1]) {
      const ids=[];
      for(let k=0;k<N;k++){
        const a=k*TAU/N, dx=Math.cos(a)*rx*radius, dy=Math.sin(a)*ry*radius*(almond ? Math.sqrt(Math.max(0,1-(dx/(rx*radius))**2)) : 1);
        const x=cx+dx,y=cy+dy;
        ids.push(this.vertex([x,R.neck+y,frontZ(x,y,kind)+offset],color,[k/N,radius]));
      }rows.push(ids);
    }
    for(let k=0;k<N;k++)this.i.push(center,rows[0][k],rows[0][(k+1)%N]);
    for(let r=0;r<rows.length-1;r++)for(let k=0;k<N;k++){
      const next=(k+1)%N,a=rows[r][k],b=rows[r+1][k],c=rows[r+1][next],d=rows[r][next];
      this.i.push(a,b,c,a,c,d);
    }
  }
}

export function createHead(kind,R) {
  const female=kind==='female', head=new Surface('head_base'), eyes=new Surface('eyes_base');
  const rings=40, sides=64, ids=[];
  for(let k=0;k<=rings;k++) {
    const y=-.012+.326*k/rings, r=shape(y,female), row=[];
    for(let j=0;j<=sides;j++){
      const a=-Math.PI+TAU*j/sides, x=Math.sin(a)*r.rx;
      const front=Math.max(0,Math.cos(a))**4;
      const z=r.z+Math.cos(a)*r.rz+front*relief(x,y,female);
      row.push(head.vertex([x,R.neck+y,z],0xc89575,[j/sides,1-k/rings]));
    } ids.push(row);
  }
  for(let k=0;k<rings;k++)for(let j=0;j<sides;j++){
    const a=ids[k][j], b=ids[k][j+1], c=ids[k+1][j+1], d=ids[k+1][j];
    // The crown has a single geometric position; omit its degenerate half-triangles.
    head.i.push(a,b,d); if(k<rings-1)head.i.push(b,c,d);
  }
  const base=head.vertex([0,R.neck-.012,profile[0][3]],0xc89575,[.5,1]);
  for(let j=0;j<sides;j++)head.i.push(base,ids[0][j+1],ids[0][j]);
  // Ear rims and concha are purposefully separate attachments; all share the head bone.
  for(const s of [-1,1]) {
    const cx=s*.102, cy=.155, cz=-.004, rows=[], N=20, K=10;
    for(let k=0;k<=K;k++){
      const phi=-Math.PI/2+Math.PI*k/K,row=[];
      for(let j=0;j<=N;j++){
        const a=TAU*j/N, lateral=Math.cos(phi)*Math.cos(a);
        const x=cx+s*.014*lateral;
        const y=cy+.031*Math.sin(phi), z=cz+.017*Math.cos(phi)*Math.sin(a);
        const inner=Math.max(0,lateral)*Math.max(0,Math.sin(a));
        const color=new THREE.Color(0xc89575).multiplyScalar(1-.12*inner);
        row.push(head.vertex([x,R.neck+y,z],color,[.86+(x-cx)*1.2,.3+(cy-y)*2]));
      }rows.push(row);
    }
    for(let k=0;k<K;k++)for(let j=0;j<N;j++){
      const [a,b,c,d]=[rows[k][j],rows[k][j+1],rows[k+1][j+1],rows[k+1][j]];
      const f=k===0?[b,c,d]:k===K-1?[a,b,d]:[a,b,d,b,c,d];
      if(s<0)head.i.push(...f);else for(let t=0;t<f.length;t+=3)head.i.push(f[t],f[t+2],f[t+1]);
    }
  }
  // Eye whites, iris and catchlights sit on the relief; no baked hair or facial hair.
  for(const s of [-1,1]) {
    const cx=s*.041, cy=.173;
    eyes.disk(cx,cy,female?.0265:.0255,female?.012:.0108,0x45332c,R,kind,.0027,true);
    eyes.disk(cx,cy-.0005,female?.0245:.0235,female?.0098:.0085,0xd9cdb9,R,kind,.0040,true);
    eyes.disk(cx-s*.001,cy-.0005,female?.0095:.0086,female?.009:.0082,0x795844,R,kind,.0053);
    eyes.disk(cx-s*.001,cy-.0005,.0042,.0063,0x292724,R,kind,.0065);
    eyes.disk(cx-.0030,cy+.0030,.0019,.0020,0xf4e8d7,R,kind,.0078);
    const upper=[],lower=[];
    for(let i=0;i<=16;i++){
      const dx=(i/16-.5)*(female?.051:.049),h=(female?.011:.0097)*(1-(dx/(female?.0255:.0245))**2);
      upper.push([cx+dx,cy+h+s*dx*.04]);lower.push([cx+dx,cy-h*.70+s*dx*.04]);
    }
    eyes.ribbon(upper,.0018,0x513b31,R,kind,.0052);
    eyes.ribbon(lower,.0007,0x916b53,R,kind,.0047);
    const brow=[];
    for(let i=0;i<=12;i++){const dx=(i/12-.5)*.055; brow.push([cx+dx,.201+.003*(1-(dx/.0275)**2)+s*dx*.08]);}
    eyes.ribbon(brow,female?.0027:.0044,0x4f392d,R,kind,.0018);
    // Short nostril accents stay attached to the head, ready for later face presets.
    const nostril=[];for(let i=0;i<=6;i++){const x=s*(.009+i*.0012);nostril.push([x,.116-.002*Math.sin(i/6*Math.PI)]);}
    eyes.ribbon(nostril,.0008,0x8f5e48,R,kind,.0018);
  }
  const mouth=[],halfMouth=female?.030:.033;
  for(let i=0;i<=24;i++){const x=(i/24-.5)*halfMouth*2;mouth.push([x,.072+(female?.0024:.0015)*Math.cos(x/halfMouth*Math.PI)-(female?.0014:.0007)*g(x,.072,0,.072,.009,.004)]);}
  eyes.ribbon(mouth,.0008,0x825f4e,R,kind,.0035);
  const headGeo=head.geometry();
  // Average all spatially shared normals, retaining UV seams for skull and ear charts.
  const normals=headGeo.attributes.normal;
  const positions=headGeo.attributes.position,groups=new Map();
  for(let i=0;i<positions.count;i++){
    const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
  }
  for(const group of groups.values()){
    const n=new THREE.Vector3();for(const i of group)n.add(new THREE.Vector3().fromBufferAttribute(normals,i));n.normalize();
    for(const i of group)normals.setXYZ(i,n.x,n.y,n.z);
  }
  return { head:headGeo, eyes:eyes.geometry() };
}

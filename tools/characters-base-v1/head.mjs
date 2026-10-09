// Neutral sculpted heads: one continuous face surface, with separate ear and eye attachments.
// UV is cylindrical: front at U=.5; PNG rows run from the crown to the chin.
import * as THREE from 'three';

const TAU = Math.PI * 2, clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const g = (x, y, cx, cy, rx, ry) => Math.exp(-(((x-cx)/rx)**2 + ((y-cy)/ry)**2));
const profile = [
  [-.012,.027,.035,.016],[.005,.042,.049,.012],[.024,.055,.060,.008],
  [.049,.069,.073,.003],[.081,.084,.083,-.002],[.112,.098,.093,-.005],
  [.145,.104,.103,-.006],[.178,.104,.108,-.009],[.213,.100,.109,-.012],
  [.249,.091,.102,-.015],[.281,.074,.087,-.017],[.302,.048,.060,-.018],
  [.314,.000,.000,-.018]
];
function shape(y, female) {
  let i=0; while(i<profile.length-2 && profile[i+1][0]<y) i++;
  const a=profile[i], b=profile[i+1], t=clamp((y-a[0])/(b[0]-a[0]));
  const jaw = female && y < .13 ? .93 : 1;
  return { rx:(a[1]+(b[1]-a[1])*t)*jaw, rz:a[2]+(b[2]-a[2])*t, z:a[3]+(b[3]-a[3])*t };
}
function relief(x, y, female) {
  // Nose bridge, tip and wings emerge from the face itself, rather than an intersecting wedge.
  let z=.021*g(x,y,0,.152,.012,.044) + .025*g(x,y,0,.123,.017,.014);
  z += .010*(g(x,y,-.014,.117,.010,.012)+g(x,y,.014,.117,.010,.012));
  z -= .004*g(x,y,0,.102,.018,.008);
  // Cheek planes, shallow orbital sockets, lips and a broad chin.
  for (const s of [-1,1]) {
    z += .009*g(x,y,s*.062,.126,.035,.033);
    z -= .010*g(x,y,s*.041,.176,.028,.016);
    z += .006*g(x,y,s*.043,.198,.036,.014);
  }
  z += .005*g(x,y,0,.073,.028,.006) + .005*g(x,y,0,.060,.031,.006);
  z -= .003*g(x,y,0,.047,.034,.006);
  z += (female?.005:.008)*g(x,y,0,.024,.037,.025);
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
  const rings=36, sides=56, ids=[];
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
  // Ear rims and concha are purposefully separate attachments; all share the head bone.
  for(const s of [-1,1]) {
    const cx=s*.104, cy=.143, cz=-.012, rows=[], N=24, K=12;
    for(let k=0;k<=K;k++){
      const phi=-Math.PI/2+Math.PI*k/K,row=[];
      for(let j=0;j<=N;j++){
        const a=TAU*j/N, x=cx+s*.019*Math.cos(phi)*Math.cos(a);
        const y=cy+.037*Math.sin(phi), z=cz+.024*Math.cos(phi)*Math.sin(a);
        row.push(head.vertex([x,R.neck+y,z],0xc89575,[.86+(x-cx)*1.2,.3+(cy-y)*2]));
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
    eyes.disk(cx,cy,.030,.015,0x45332c,R,kind,.0040,true);
    eyes.disk(cx,cy-.0005,.027,.0125,0xf4e9d7,R,kind,.0055,true);
    eyes.disk(cx-s*.001,cy,.0102,.0115,0x986138,R,kind,.0070);
    eyes.disk(cx-s*.001,cy,.005,.0085,0x292724,R,kind,.0082);
    eyes.disk(cx-.0035,cy+.0045,.0025,.0028,0xfff5df,R,kind,.0095);
    const upper=[],lower=[];
    for(let i=0;i<=16;i++){
      const dx=(i/16-.5)*.058,h=.014*(1-(dx/.029)**2);
      upper.push([cx+dx,cy+h]);lower.push([cx+dx,cy-h*.82]);
    }
    eyes.ribbon(upper,.0017,0x543b2f,R,kind,.0062);
    eyes.ribbon(lower,.0010,0x8f6147,R,kind,.0058);
    const brow=[];
    for(let i=0;i<=12;i++){const dx=(i/12-.5)*.061; brow.push([cx+dx,.208+.008*(1-(dx/.031)**2)+s*dx*.06]);}
    eyes.ribbon(brow,female?.0027:.0038,0x4f392d,R,kind,.0022);
    // Short nostril accents stay attached to the head, ready for later face presets.
    const nostril=[];for(let i=0;i<=6;i++){const x=s*(.009+i*.0012);nostril.push([x,.116-.002*Math.sin(i/6*Math.PI)]);}
    eyes.ribbon(nostril,.0008,0x8f5e48,R,kind,.0018);
  }
  const mouth=[];for(let i=0;i<=24;i++){const x=(i/24-.5)*.064;mouth.push([x,.067+.002*Math.abs(x/.032)-.0013*Math.cos(x/.032*Math.PI*2)]);}
  eyes.ribbon(mouth,.0009,0x875746,R,kind,.0020);
  const headGeo=head.geometry();
  // Average the cylindrical seam normals while retaining UV duplication for texture wrap.
  const normals=headGeo.attributes.normal;
  for(let k=0;k<=rings;k++){
    const a=ids[k][0],b=ids[k][sides],n=new THREE.Vector3().fromBufferAttribute(normals,a).add(new THREE.Vector3().fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,...n.toArray());normals.setXYZ(b,...n.toArray());
  }
  return { head:headGeo, eyes:eyes.geometry() };
}

// Procedural, low-poly appearance attachments for the v3 character heads.
import * as THREE from 'three';
import { frontZ } from '../characters-base-v3/head.mjs';

export const HAIR_STYLES = [
  { id: 'scout', label: 'Explorador' },
  { id: 'swept', label: 'Barrido' },
  { id: 'pony', label: 'Coleta' },
  { id: 'crop', label: 'Corto' },
];
export const BEARD_STYLES = [
  { id: 'none', label: 'Afeitado' },
  { id: 'stubble', label: 'Barba corta' },
  { id: 'full', label: 'Barba de capitán' },
];

const TAU = Math.PI * 2;
const HAIR = 0x65452f;
const HAIR_LIGHT = 0x79583d;
const HAIR_DARK = 0x4e3628;
const BEARD = 0x50392b;
const BEARD_LIGHT = 0x614532;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const HEAD_PROFILE = [
  [-.012,.041,.041,.016],[.005,.051,.055,.012],[.024,.066,.064,.008],
  [.049,.080,.075,.003],[.081,.091,.085,-.002],[.112,.100,.095,-.005],
  [.145,.104,.103,-.006],[.178,.104,.108,-.009],[.213,.100,.109,-.012],
  [.249,.091,.102,-.015],[.281,.074,.087,-.017],[.302,.048,.060,-.018],
  [.314,.000,.000,-.018],
];
function headShape(y, kind) {
  let i = 0;
  while (i < HEAD_PROFILE.length - 2 && HEAD_PROFILE[i + 1][0] < y) i++;
  const a = HEAD_PROFILE[i], b = HEAD_PROFILE[i + 1], t = clamp((y - a[0]) / (b[0] - a[0]));
  const spline = (axis) => {
    const slope = (index) => {
      if (index === 0) return (HEAD_PROFILE[1][axis] - HEAD_PROFILE[0][axis]) / (HEAD_PROFILE[1][0] - HEAD_PROFILE[0][0]);
      if (index === HEAD_PROFILE.length - 1) return (HEAD_PROFILE[index][axis] - HEAD_PROFILE[index - 1][axis]) / (HEAD_PROFILE[index][0] - HEAD_PROFILE[index - 1][0]);
      const before = (HEAD_PROFILE[index][axis] - HEAD_PROFILE[index - 1][axis]) / (HEAD_PROFILE[index][0] - HEAD_PROFILE[index - 1][0]);
      const after = (HEAD_PROFILE[index + 1][axis] - HEAD_PROFILE[index][axis]) / (HEAD_PROFILE[index + 1][0] - HEAD_PROFILE[index][0]);
      return before * after <= 0 ? 0 : 2 * before * after / (before + after);
    };
    const dt = b[0] - a[0], t2 = t * t, t3 = t2 * t;
    return (2*t3-3*t2+1)*a[axis] + (t3-2*t2+t)*dt*slope(i) +
      (-2*t3+3*t2)*b[axis] + (t3-t2)*dt*slope(i+1);
  };
  const jaw = kind === 'female' ? .84 + .16 * clamp((y - .020) / .120) : 1;
  return { rx: Math.max(0, spline(1)) * jaw, rz: Math.max(0, spline(2)), z: spline(3) };
}

class MeshData {
  constructor(name) { this.name = name; this.p = []; this.c = []; this.uv = []; this.i = []; }
  v(x, y, z, color, u = 0, v = 0) {
    const i = this.p.length / 3;
    this.p.push(x, y, z);
    this.c.push(...new THREE.Color(color).toArray());
    this.uv.push(u, v);
    return i;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  geometry() {
    const n = this.p.length / 3;
    const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) { joints[k * 4] = 8; weights[k * 4] = 1; }
    const g = new THREE.BufferGeometry(); g.name = this.name;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    g.setIndex(this.i); g.computeVertexNormals();
    // Preserve outward face order around curved frontZ-projected beard volumes.
    const index = g.index.array, p = g.attributes.position, normal = g.attributes.normal;
    for (let pass = 0; pass < 2; pass++) {
      let flipped = false;
      for (let k = 0; k < index.length; k += 3) {
        const ia = index[k], ib = index[k + 1], ic = index[k + 2];
        const a = new THREE.Vector3().fromBufferAttribute(p, ia);
        const b = new THREE.Vector3().fromBufferAttribute(p, ib);
        const c = new THREE.Vector3().fromBufferAttribute(p, ic);
        const face = b.sub(a).cross(c.sub(a));
        const outward = new THREE.Vector3().fromBufferAttribute(normal, ia)
          .add(new THREE.Vector3().fromBufferAttribute(normal, ib))
          .add(new THREE.Vector3().fromBufferAttribute(normal, ic));
        if (face.dot(outward) < 0) { index[k + 1] = ic; index[k + 2] = ib; flipped = true; }
      }
      if (!flipped) break;
      g.index.needsUpdate = true; g.computeVertexNormals();
    }
    return g;
  }
}

// A closed swept oval. The local cross-section stays readable as a broad lock,
// while the centerline bends deliberately for a sculpted rather than noisy look.
function lock(m, points, color = HAIR, sides = 8) {
  const rings = [];
  for (let k = 0; k < points.length; k++) {
    const [x, y, z, rx, rz] = points[k];
    const prev = points[Math.max(0, k - 1)], next = points[Math.min(points.length - 1, k + 1)];
    const tx = next[0] - prev[0], ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len, ny = tx / len;
    const row = [];
    for (let j = 0; j < sides; j++) {
      const a = TAU * j / sides;
      const xx = x + nx * Math.cos(a) * rx;
      const yy = y + ny * Math.cos(a) * rx;
      const zz = z + Math.sin(a) * rz;
      const shade = j < sides / 2 ? color : (color === HAIR ? HAIR_LIGHT : color);
      row.push(m.v(xx, yy, zz, shade, j / sides, k / (points.length - 1)));
    }
    rings.push(row);
  }
  // Flat end caps avoid open silhouette edges; their tiny fans are stable.
  const start = m.v(points[0][0], points[0][1], points[0][2], color);
  const endPoint = points[points.length - 1];
  const end = m.v(endPoint[0], endPoint[1], endPoint[2], color);
  for (let j = 0; j < sides; j++) {
    const n = (j + 1) % sides;
    m.tri(start, rings[0][n], rings[0][j]);
    m.tri(end, rings[rings.length - 1][j], rings[rings.length - 1][n]);
  }
  for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < sides; j++) {
    const n = (j + 1) % sides;
    m.quad(rings[k][j], rings[k][n], rings[k + 1][n], rings[k + 1][j]);
  }
}

function cap(m, R, kind, { front = .232, side = .175, back = .125, width = 1 } = {}) {
  const rows = [], sides = 40, levels = 11;
  // The upper ring approaches a rounded crown above the v3 skull's .314 m top.
  for (let k = 0; k <= levels; k++) {
    const t = k / levels, row = [];
    for (let j = 0; j < sides; j++) {
      const a = TAU * j / sides, c = Math.cos(a), s = Math.sin(a);
      const edgeY = c > .25 ? side + (front - side) * clamp((c - .25) / .75) :
        c < -.25 ? side + (back - side) * clamp((-c - .25) / .75) : side;
      const y = .314 - t * (.314 - edgeY);
      const profile = headShape(y, kind);
      const shell = .0065;
      const x = s * (profile.rx + shell) * width;
      const fittedX = s * profile.rx * .999;
      const frontal = c > 0 && profile.rx > 1e-6 ?
        (frontZ(fittedX, y, kind) - profile.z - profile.rz * Math.sqrt(Math.max(0, 1 - (fittedX / profile.rx) ** 2))) * c ** 4 : 0;
      const z = profile.z + c * (profile.rz + shell) * width + frontal;
      row.push(m.v(x, R.neck + y, z, c > .2 && t > .55 ? HAIR_LIGHT : HAIR,
        j / sides, t));
    }
    rows.push(row);
  }
  for (let k = 0; k < levels; k++) for (let j = 0; j < sides; j++) {
    const n = (j + 1) % sides;
    m.quad(rows[k][j], rows[k + 1][j], rows[k + 1][n], rows[k][n]);
  }
  const crown = m.v(0, R.neck + .322, -.018, HAIR_LIGHT, .5, 1);
  for (let j = 0; j < sides; j++) m.tri(crown, rows[0][j], rows[0][(j + 1) % sides]);
}

function sweptLocks(m, R, kind, style) {
  const yFront = style === 'crop' ? .238 : .245;
  if (style === 'scout') {
    // Broad diagonal fringe locks sweep across the forehead rather than forming upright cones.
    for (const [x, endX, endY, tone] of [
      [-.060,-.086,.218,HAIR_DARK],[-.028,-.045,.219,HAIR],
      [.006,.031,.219,HAIR_LIGHT],[.041,.063,.230,HAIR],
    ]) lock(m, [
      [x-.010,R.neck+.299,.052,.024,.012],
      [x,R.neck+.267,.099,.027,.014],
      [endX,R.neck+endY,.104,.0015,.002],
    ],tone,10);
    // A few asymmetric crown and side tufts establish the tousled silhouette.
    for (const s of [-1,1]) lock(m,[
      [s*.047,R.neck+.289,-.047,.021,.018],
      [s*.076,R.neck+.312,-.030,.020,.013],
      [s*.119,R.neck+.305,-.021,.0015,.0015],
    ],s<0?HAIR:HAIR_DARK,8);
    lock(m,[[-.029,R.neck+.302,-.040,.021,.015],[.003,R.neck+.336,-.029,.019,.010],[.035,R.neck+.339,-.038,.0015,.0015]],HAIR_LIGHT,8);
    // Short side locks frame the ears without covering eyes or brows.
    for (const s of [-1, 1]) lock(m, [
      [s * .086, R.neck + .228, -.012, .010, .009],
      [s * .096, R.neck + .192, -.011, .008, .008],
      [s * .094, R.neck + .157, -.008, .001, .001],
    ], HAIR, 8);
  } else if (style === 'swept') {
    lock(m, [
      [-.055, R.neck + yFront, frontZ(-.055, yFront, kind) + .004, .030, .009],
      [-.025, R.neck + .267, .080, .032, .012],
      [.025, R.neck + .302, .052, .026, .011],
      [.074, R.neck + .283, .013, .009, .005],
    ], HAIR_LIGHT, 12);
    for (const s of [-1, 1]) lock(m, [
      [s * .084, R.neck + .215, -.012, .009, .008],
      [s * .092, R.neck + .180, -.009, .007, .007],
      [s * .089, R.neck + .153, -.006, .001, .001],
    ], HAIR_DARK, 8);
  } else if (style === 'crop') {
    // A low, compact fringe; center stays below the brow line.
    for (const s of [-1, 0, 1]) {
      const x = s * .042;
      lock(m, [
        [x, R.neck + .252, frontZ(x, .252, kind) + .004, .020, .009],
        [x + s * .004, R.neck + .272, .080, .019, .009],
        [x + s * .006, R.neck + .279, .073, .001, .001],
      ], HAIR_DARK, 8);
    }
  }
}

function ponyTail(m, R) {
  // Bound tail flows behind the head (-Z), ending above the neck base.
  lock(m, [
    [0, R.neck + .177, -.085, .031, .027],
    [0, R.neck + .143, -.111, .030, .027],
    [.004, R.neck + .105, -.119, .024, .021],
    [.008, R.neck + .070, -.110, .015, .014],
    [.008, R.neck + .046, -.091, .001, .001],
  ], HAIR, 10);
  // Small ochre tie sits around the narrow root of the ponytail.
  lock(m, [[-.015, R.neck + .172, -.087, .007, .005], [0, R.neck + .168, -.087, .008, .005], [.015, R.neck + .172, -.087, .002, .002]], 0x9c7541, 6);
}

export function createHair(kind, R, id) {
  if (kind !== 'male' && kind !== 'female') throw new TypeError(`Unknown character kind: ${kind}`);
  if (!R || !Number.isFinite(R.neck)) throw new TypeError('R.neck must be finite');
  if (!HAIR_STYLES.some(s => s.id === id)) throw new TypeError(`Unknown hair style: ${id}`);
  const m = new MeshData(`hair_${id}_${kind}`);
  const capOptions = id === 'crop' ? { front: .239, side: .177, back: .132, width: .98, depth: .98 } :
    id === 'swept' ? { front: .232, side: .177, back: .126, width: 1.02, depth: 1.01 } :
      { front: .228, side: .172, back: .122, width: 1.02, depth: 1.02 };
  cap(m, R, kind, capOptions);
  sweptLocks(m, R, kind, id);
  if (id === 'pony') ponyTail(m, R);
  return m.geometry();
}

// Closed face-following patches keep the lip opening clear and avoid intersecting spheres.
function beardPatch(m, R, kind, outline, full, color) {
  const contour=outline.map(([x,y])=>new THREE.Vector2(x,y));
  const faces=THREE.ShapeUtils.triangulateShape(contour,[]),vertices=new Map(),steps=5;
  const vertex=(x,y,front)=>{
    const key=[Math.round(x*1e7),Math.round(y*1e7),front].join(':');if(vertices.has(key))return vertices.get(key);
    const extended=y<.025?(full?.024:.002)*clamp((.025-y)/.07):0;
    const z=frontZ(x,Math.max(-.011,y),kind)+(front?(full?.015:.007)+extended:-.004);
    const id=m.v(x,R.neck+y,z,color,clamp(.5+x*4),clamp((.15-y)/.20));vertices.set(key,id);return id;
  };
  for(const [a,b,c] of faces) {
    const signed=(outline[b][0]-outline[a][0])*(outline[c][1]-outline[a][1])-(outline[b][1]-outline[a][1])*(outline[c][0]-outline[a][0]);
    const [A,B,C]=(signed>0?[a,b,c]:[a,c,b]).map(i=>outline[i]);
    // Subdivision projects the patch interior onto the relief, avoiding chin/cheek poke-through.
    for(const front of [true,false]){
      const point=(i,j)=>vertex(A[0]+(B[0]-A[0])*i/steps+(C[0]-A[0])*j/steps,A[1]+(B[1]-A[1])*i/steps+(C[1]-A[1])*j/steps,front);
      const tri=(...ids)=>m.tri(...(front?ids:ids.reverse()));
      for(let i=0;i<steps;i++)for(let j=0;j<steps-i;j++){
        tri(point(i,j),point(i+1,j),point(i,j+1));
        if(i+j<steps-1)tri(point(i+1,j),point(i+1,j+1),point(i,j+1));
      }
    }
  }
  // The contour is clockwise; this winding faces outward along its closed side wall.
  for(let i=0;i<outline.length;i++)for(let s=0;s<steps;s++){
    const a=outline[i],b=outline[(i+1)%outline.length],point=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    const p=point(s/steps),q=point((s+1)/steps);
    m.quad(vertex(...p,true),vertex(...p,false),vertex(...q,false),vertex(...q,true));
  }
}
export function createBeard(kind, R, id) {
  if(kind!=='male'&&kind!=='female')throw new TypeError('Unknown character kind');
  if(!R||!Number.isFinite(R.neck))throw new TypeError('R.neck must be finite');
  if(!BEARD_STYLES.some(s=>s.id===id))throw new TypeError('Unknown beard style');
  if(id==='none')return null;
  const full=id==='full',m=new MeshData('beard_'+id+'_'+kind),jaw=kind==='female'?.88:1;
  const outline=full?[
    [.079,.134],[.088,.111],[.085,.070],[.067,.026],[.043,-.012],[0,-.042],
    [-.043,-.012],[-.067,.026],[-.085,.070],[-.088,.111],[-.079,.134],
    [-.049,.086],[-.033,.056],[0,.052],[.033,.056],[.049,.086],
  ]:[
    [.078,.113],[.080,.086],[.066,.047],[.042,.023],[0,.013],
    [-.042,.023],[-.066,.047],[-.080,.086],[-.078,.113],
    [-.049,.084],[-.032,.057],[0,.047],[.032,.057],[.049,.084],
  ];
  beardPatch(m,R,kind,outline.map(([x,y])=>[x*jaw,y]),full,BEARD);
  // Two mustache wings sit above the lip; their center gap preserves the philtrum.
  if(full)for(const side of [-1,1]) {
    const wing=[[.003,.106],[.022,.105],[.034,.092],[.025,.086],[.009,.091]];
    const points=wing.map(([x,y])=>[x*side,y]);if(side<0)points.reverse();
    beardPatch(m,R,kind,points,true,BEARD_LIGHT);
  }
  return m.geometry();
}

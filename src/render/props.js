// Village, dock, ship and Caldera dressing: one merged vertex-colored geometry per prop kind,
// instanced per kind. Glowing bits (lantern glass, coals, hut windows at night) use unlit materials.
import * as THREE from 'three';
import { part, merge, box, rbox, bbox, sphere, cyl, cone, torus, ico, lumpy, canvasTexture } from './geo.js';
import { toon, normalMatFor } from './toon.js';
import { LAYER } from './pipeline.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const WOOD = 0xb5803f, WOOD_D = 0x8a5a2e, WOOD_L = 0xd6a565, STRAW = 0xe9b54d, STRAW_D = 0xc98f2c, STONE = 0x9a948e;

function hutGeo() {
  const wallPaint = (x, y, z) => (Math.floor((y + 10) * 4.2) % 2 ? 0xe8c98a : 0xd9b26d);
  const L = [];
  for (const [x, z] of [[1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7]]) L.push(part(cyl(0.16, 0.2, 1.1, 8), WOOD_D, { pos: [x, 0.55, z] }));
  L.push(part(rbox(4.3, 0.26, 4.3, 0.08), WOOD, { pos: [0, 1.15, 0] }));
  L.push(part(rbox(3.5, 2.0, 3.5, 0.12), 0, { pos: [0, 2.25, 0], paint: wallPaint }));
  L.push(part(rbox(0.95, 1.45, 0.12, 0.05), 0x3b2418, { pos: [0, 2.0, 1.76] }));
  L.push(part(rbox(0.7, 0.55, 0.12, 0.05), 0x3b2418, { pos: [1.15, 2.45, 1.76] }));
  L.push(part(rbox(0.12, 0.55, 0.7, 0.05), 0x3b2418, { pos: [1.76, 2.45, 0] }));
  // layered thatch roof
  // Stepped thatch: stacked square frustums with alternating straw tones.
  const bands = 5, base = 3.2, top = 5.35, r0 = 3.6;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands, t1 = (i + 1) / bands;
    const y0 = base + (top - base) * t0, y1 = base + (top - base) * t1;
    const rb = r0 * (1 - t0) + 0.05, rt = r0 * (1 - t1) + (i === bands - 1 ? 0.02 : 0.32);
    L.push(part(new THREE.CylinderGeometry(rt, rb, y1 - y0, 4, 1), i % 2 ? 0xe9b54d : 0xd09a35, { pos: [0, (y0 + y1) / 2, 0], rot: [0, Math.PI / 4, 0] }));
  }
  L.push(part(sphere(0.24, 8, 6), WOOD_D, { pos: [0, 5.45, 0] }));
  // steps
  for (let i = 0; i < 3; i++) L.push(part(bbox(1.1, 0.12, 0.4), WOOD_L, { pos: [0, 0.25 + i * 0.32, 2.75 - i * 0.35] }));
  return merge(L);
}

function crateGeo() {
  const paint = (x, y, z) => (Math.abs(x) > 0.42 || Math.abs(y - 0.5) > 0.42 || Math.abs(z) > 0.42 ? WOOD_D : WOOD);
  return merge([part(rbox(1, 1, 1, 0.06), 0, { pos: [0, 0.5, 0], paint }), part(rbox(0.15, 1.02, 1.02, 0.02), WOOD_D, { pos: [0, 0.5, 0], rot: [0, 0, 0.78] })]);
}

function barrelGeo() {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.38 + Math.sin(t * Math.PI) * 0.08, t * 1.0)); }
  const body = new THREE.LatheGeometry(pts, 14);
  const paint = (x, y) => (Math.abs(y - 0.18) < 0.05 || Math.abs(y - 0.82) < 0.05 ? 0x5a5a6a : Math.floor(Math.atan2(x, 1) * 0) ? WOOD : WOOD);
  return merge([part(body, 0, { paint }), part(cyl(0.38, 0.38, 0.04, 14), WOOD_D, { pos: [0, 0.99, 0] })]);
}

function stallGeo() {
  const canopy = (x) => (Math.floor((x + 5) * 2.5) % 2 ? 0xe8463c : 0xfaf3e3);
  const L = [part(rbox(2.6, 0.12, 1.3, 0.04), WOOD, { pos: [0, 0.95, 0] }), part(rbox(2.4, 0.8, 1.1, 0.04), WOOD_D, { pos: [0, 0.5, 0] })];
  for (const [x, z] of [[1.25, 0.6], [-1.25, 0.6], [1.25, -0.6], [-1.25, -0.6]]) L.push(part(cyl(0.06, 0.06, 2.4, 6), WOOD_D, { pos: [x, 1.2, z] }));
  L.push(part(rbox(3.0, 0.12, 1.8, 0.04), 0, { pos: [0, 2.45, 0], rot: [0.18, 0, 0], paint: canopy }));
  const fruit = [0xff9f1c, 0xffd166, 0x7bc74d, 0xe8463c, 0xff9f1c];
  for (let i = 0; i < 9; i++) L.push(part(sphere(0.13, 8, 6), fruit[i % fruit.length], { pos: [-0.9 + (i % 5) * 0.42, 1.12, -0.25 + Math.floor(i / 5) * 0.4] }));
  return merge(L);
}

function lanternGeo() {
  return merge([
    part(cyl(0.07, 0.09, 2.2, 6), WOOD_D, { pos: [0, 1.1, 0] }),
    part(rbox(0.5, 0.06, 0.06, 0.02), WOOD_D, { pos: [0.2, 2.15, 0] }),
    part(rbox(0.34, 0.06, 0.34, 0.02), 0x3a2a20, { pos: [0.42, 1.95, 0] }),
    part(cone(0.24, 0.18, 4), 0x3a2a20, { pos: [0.42, 2.07, 0], rot: [0, Math.PI / 4, 0] }),
  ]);
}

function postGeo() {
  return merge([part(cyl(0.2, 0.24, 6, 8), WOOD_D, { pos: [0, -2.4, 0] }), part(cyl(0.22, 0.2, 0.08, 8), WOOD_L, { pos: [0, 0.6, 0] })]);
}

function braziersGeo() {
  return merge([
    part(cyl(0.38, 0.5, 0.8, 8), STONE, { pos: [0, 0.4, 0] }),
    part(cyl(0.62, 0.32, 0.38, 10), 0x3a3240, { pos: [0, 0.98, 0] }),
    part(torus(0.6, 0.06, 6, 16), 0x5a4a5a, { pos: [0, 1.16, 0], rot: [Math.PI / 2, 0, 0] }),
  ]);
}

function pillarGeo() {
  const paint = (x, y) => (y > 0.92 ? 0x6a5c70 : 0x3d3344);
  return merge([part(cyl(0.72, 0.86, 1, 6), 0, { pos: [0, 0.5, 0], paint })]);
}

function gatePostGeo() {
  return merge([
    part(rbox(1.3, 4.2, 1.3, 0.12), 0x3d3344, { pos: [0, 2.1, 0] }),
    part(rbox(1.6, 0.35, 1.6, 0.08), 0x5a4a5a, { pos: [0, 4.3, 0] }),
    part(cyl(0.45, 0.25, 0.4, 8), 0x2a2230, { pos: [0, 4.65, 0] }),
    part(rbox(1.4, 0.3, 1.4, 0.08), 0x5a4a5a, { pos: [0, 0.15, 0] }),
  ]);
}

function signGeo() {
  return merge([part(cyl(0.08, 0.1, 2.2, 6), WOOD_D, { pos: [0, 1.1, 0] })]);
}

function rockRingGeo() {
  const L = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    L.push(part(lumpy(ico(0.22, 1), 0.2, i + 1), 0x8f8a84, { pos: [Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75] }));
  }
  for (let i = 0; i < 3; i++) L.push(part(cyl(0.09, 0.09, 1.1, 6), 0x6b4423, { pos: [0, 0.2, 0], rot: [Math.PI / 2, (i / 3) * Math.PI, 0.3] }));
  return merge(L);
}

function rowboatGeo() {
  const hullPaint = (x, y) => (y > 0.07 ? 0xe8c98a : y > -0.14 ? 0x9a5a2e : 0x6b3d22);
  const hull = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  return merge([
    part(hull, 0, { scale: [0.72, 0.42, 1.65], pos: [0, 0.12, 0], paint: hullPaint }),
    part(bbox(1.05, 0.06, 2.6), WOOD_D, { pos: [0, -0.06, 0] }),
    part(bbox(1.3, 0.08, 0.26), WOOD_D, { pos: [0, 0.1, 0.45] }),
    part(bbox(1.25, 0.08, 0.24), WOOD_D, { pos: [0, 0.1, -0.55] }),
    part(cyl(0.035, 0.035, 2.0, 5), WOOD_D, { pos: [0.48, 0.2, 0.2], rot: [1.45, 0, 0.2] }),
  ]);
}

function shipGeo() {
  const hullPaint = (x, y, z) => (y > 0.85 ? 0xe8c98a : y > 0.55 ? 0x7a4426 : y > -0.2 ? 0x5e3320 : 0xb83a2e);
  const hull = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  const L = [
    part(hull, 0, { scale: [2.4, 2.0, 7.0], pos: [0, 1.25, 0], paint: hullPaint }),
    part(rbox(4.3, 0.2, 12.4, 0.08), WOOD_L, { pos: [0, 1.3, 0] }),
    part(rbox(3.6, 1.1, 2.6, 0.12), 0x7a4426, { pos: [0, 1.9, -4.4] }),
    part(rbox(3.8, 0.14, 2.8, 0.05), WOOD_L, { pos: [0, 2.48, -4.4] }),
    part(cyl(0.18, 0.24, 10, 8), WOOD_D, { pos: [0, 6.2, 0.6] }),
    part(cyl(0.12, 0.16, 6, 8), WOOD_D, { pos: [0, 5.0, -3.4] }),
    part(cyl(0.55, 0.45, 0.45, 10), WOOD_D, { pos: [0, 9.6, 0.6] }),
    part(cyl(0.08, 0.14, 4.0, 6), WOOD_D, { pos: [0, 2.2, 7.4], rot: [1.15, 0, 0] }),
    part(cyl(0.07, 0.07, 6.2, 6), WOOD_D, { pos: [0, 7.6, 0.6], rot: [0, 0, Math.PI / 2] }),
    part(cyl(0.07, 0.07, 5.0, 6), WOOD_D, { pos: [0, 4.0, 0.6], rot: [0, 0, Math.PI / 2] }),
  ];
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) L.push(part(bbox(0.1, 0.32, 0.5), 0x1a1033, { pos: [s * 2.25, 0.95, -2 + i * 2] }));
  return merge(L);
}

function sailGeo() {
  const g = new THREE.PlaneGeometry(5.6, 3.6, 8, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, (1 - (x / 2.8) ** 2) * 0.9 + (1 - ((y) / 1.8) ** 2) * 0.2);
  }
  g.computeVertexNormals();
  const paint = (x, y) => (Math.abs(y) < 0.35 ? 0xe8463c : 0xf6efe0);
  return merge([part(g, 0, { pos: [0, 5.85, 0.75], paint })]);
}

function flagTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#1a1033'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#f6efe0'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 14; x <= s - 14; x += 2) { const y = s * 0.55 + Math.sin(x * 0.09) * 12; x === 14 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.32, 13, 0, Math.PI * 2); ctx.fillStyle = '#f6efe0'; ctx.fill();
  });
}

function signTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#c9925a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#b98352' : '#d6a565'; ctx.fillRect(0, i * (s / 6), s, s / 12); }
    ctx.strokeStyle = '#5b3a24'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, s - 10, s - 10);
    ctx.fillStyle = '#3b2418';
    ctx.font = 'bold 44px "Lilita One", "Titan One", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LA CALDERA', s / 2, s * 0.45);
    ctx.font = 'bold 80px sans-serif';
    ctx.fillText('↑', s / 2, s * 0.85);
  });
}

export function createProps(map) {
  const group = new THREE.Group();
  group.name = 'props';
  const mat = toon({ color: 0xffffff, vertexColors: true }, { occluder: true, key: 'prop' });
  const nm = normalMatFor({ occluder: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd36a });
  const kits = {
    hut: hutGeo(), crate: crateGeo(), barrel: barrelGeo(), stall: stallGeo(), lantern: lanternGeo(),
    dockPost: postGeo(), brazier: braziersGeo(), pillar: pillarGeo(), gatePost: gatePostGeo(), sign: signGeo(),
    campfire: rockRingGeo(),
  };
  const byKind = new Map();
  for (const p of map.props) {
    if (!kits[p.kind]) continue;
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  // Static props are baked into one merged mesh per world chunk (few draw calls, culls per chunk).
  const CH = 72;
  const buckets = new Map();
  const glowParts = [], coalParts = [], windowParts = [];
  const lanternGlass = new THREE.BoxGeometry(0.26, 0.3, 0.26);
  const coalDisc = new THREE.CylinderGeometry(0.5, 0.5, 0.08, 10);
  const strip = (g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; };
  for (const [kind, list] of byKind) {
    for (const p of list) {
      q.setFromAxisAngle(up, p.rot);
      const s = kind === 'pillar' ? sc.set(1, p.h, 1) : sc.set(p.scale, p.scale, p.scale);
      m4.compose(v.set(p.x, p.y, p.z), q, s);
      const key = `${Math.floor(p.x / CH)},${Math.floor(p.z / CH)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(kits[kind].clone().applyMatrix4(m4));
      if (kind === 'lantern') glowParts.push(strip(lanternGlass.clone().applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(0.42, 1.78, 0)))));
      if (kind === 'hut') {
        windowParts.push(strip(new THREE.BoxGeometry(0.54, 0.4, 0.04).applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(1.15, 2.45, 1.83)))));
        windowParts.push(strip(new THREE.BoxGeometry(0.04, 0.4, 0.54).applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(1.83, 2.45, 0)))));
        windowParts.push(strip(new THREE.BoxGeometry(0.1, 1.2, 0.04).applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(0.36, 1.92, 1.83)))));
      }
      if (kind === 'brazier') coalParts.push(strip(coalDisc.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(p.x, p.y + 1.12, p.z))));
    }
  }
  for (const list of buckets.values()) {
    const mesh = new THREE.Mesh(merge(list), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.nm = nm;
    mesh.name = 'propsChunk';
    group.add(mesh);
  }
  const coalMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  if (glowParts.length) group.add(new THREE.Mesh(mergeGeometries(glowParts), glowMat));
  if (coalParts.length) group.add(new THREE.Mesh(mergeGeometries(coalParts), coalMat));
  // Hut windows and the door crack: lit from inside at dusk and night (color set by the preset).
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });
  if (windowParts.length) {
    const win = new THREE.Mesh(mergeGeometries(windowParts), windowMat);
    win.layers.set(LAYER.NO_OUTLINE);
    win.visible = false;
    win.name = 'hutWindows';
    windowMat.userData.mesh = win;
    group.add(win);
  }

  // Dock deck planks.
  const d = map.dock;
  const planks = [];
  const n = Math.floor((d.len + 1.5) / 0.5);
  for (let i = 0; i < n; i++) {
    const along = -1.5 + i * 0.5 + 0.22;
    planks.push(part(bbox(d.halfWidth * 2 + 0.1, 0.14, 0.42), i % 3 === 0 ? WOOD_L : i % 3 === 1 ? WOOD : 0xc08a4c, { pos: [0, d.deckY - 0.07, along] }));
  }
  planks.push(part(bbox(0.18, 0.18, d.len + 1.5), WOOD_D, { pos: [d.halfWidth, d.deckY - 0.2, d.len / 2 - 0.75] }));
  planks.push(part(bbox(0.18, 0.18, d.len + 1.5), WOOD_D, { pos: [-d.halfWidth, d.deckY - 0.2, d.len / 2 - 0.75] }));
  const deck = new THREE.Mesh(merge(planks), mat);
  deck.userData.nm = nm;
  deck.position.set(d.base.x, 0, d.base.z);
  deck.rotation.y = Math.atan2(d.dir.x, d.dir.z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Ship (bobs gently).
  const shipProp = map.props.find((p) => p.kind === 'ship');
  const ship = new THREE.Group();
  if (shipProp) {
    const hull = new THREE.Mesh(shipGeo(), mat);
    hull.userData.nm = nm;
    const sailMat = toon({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }, { occluder: true, key: 'sail' });
    const sail = new THREE.Mesh(sailGeo(), sailMat);
    sail.userData.nm = normalMatFor({ occluder: true }, THREE.DoubleSide);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
    flag.position.set(0, 11.0, 1.4);
    flag.rotation.y = Math.PI / 2;
    flag.layers.set(LAYER.NO_OUTLINE);
    for (const o of [hull, sail]) { o.castShadow = true; o.receiveShadow = true; }
    ship.add(hull, sail, flag);
    ship.position.set(shipProp.x, -0.35, shipProp.z);
    ship.rotation.y = shipProp.rot;
    ship.userData.flag = flag;
    group.add(ship);
  }

  // Sign board with text.
  const signP = map.props.find((p) => p.kind === 'sign');
  if (signP) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.1), toon({ map: signTexture(), color: 0xffffff }, { key: 'signboard' }));
    board.position.set(signP.x, signP.y + 1.75, signP.z);
    board.rotation.y = signP.rot;
    board.castShadow = true;
    group.add(board);
  }

  // Gate doors (open; M3 closes them).
  const gateP = map.props.find((p) => p.kind === 'gate');
  const gate = new THREE.Group();
  if (gateP) {
    const doorPaint = (x, y) => (Math.abs(y - 0.6) < 0.08 || Math.abs(y - 2.6) < 0.08 ? 0x4a4a58 : Math.floor((x + 5) * 3) % 2 ? WOOD_D : 0x6e4426);
    const doorGeo = merge([part(rbox(3.0, 3.4, 0.22, 0.05), 0, { pos: [1.5, 1.7, 0], paint: doorPaint })]);
    const left = new THREE.Mesh(doorGeo, mat); left.userData.nm = nm;
    const right = new THREE.Mesh(doorGeo, mat); right.userData.nm = nm;
    left.position.set(-3.0, 0, 0); right.position.set(3.0, 0, 0);
    right.scale.x = -1;
    left.rotation.y = -1.35; right.rotation.y = 1.35;
    for (const o of [left, right]) { o.castShadow = true; o.receiveShadow = true; }
    gate.add(left, right);
    gate.position.set(gateP.x, map.groundAt(gateP.x, gateP.z), gateP.z);
    gate.rotation.y = gateP.rot - Math.PI / 2;
    gate.userData.doors = [left, right];
    group.add(gate);
  }

  // Floating cargo + rowboat (bobbed in GameScene.update). Water foams around them on its own.
  const floaters = [];
  const floatKits = { 1: rowboatGeo(), 2: crateGeo(), 3: barrelGeo() };
  for (const p of map.props.filter((q) => q.kind === 'float')) {
    const geo = floatKits[p.h];
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.nm = nm;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.position.set(p.x, 0, p.z);
    holder.rotation.y = p.rot;
    if (p.h === 3) { mesh.rotation.z = Math.PI / 2; mesh.position.set(0.5, 0.05, 0); mesh.scale.setScalar(0.9); }
    else if (p.h === 2) { mesh.position.y = -0.55; mesh.scale.setScalar(0.85); }
    holder.add(mesh);
    holder.userData.phase = p.v * 6.28;
    holder.userData.baseRot = p.rot;
    holder.userData.boat = p.h === 1;
    group.add(holder);
    floaters.push(holder);
  }

  return { group, ship, gate, floaters, windowMat };
}

// Chibi characters (~2.3 heads) built from primitives in a joint hierarchy
// (root → body → hips → legs / torso → head / arms) with procedural animation:
// idle breathing, run cycle with lean, dash stretch, turn roll, squash & stretch springs.
import * as THREE from 'three';
import { part, merge, rbox as box, bbox, sphere, capsule, cyl, cone, torus, blobTexture } from './geo.js';
import { toon } from './toon.js';
import { LAYER } from './pipeline.js';
import { damp, dampAngle, angleDelta, clamp, spring } from '../core/math.js';

export const SKINS = [
  { name: 'Marea', skin: 0xf3c9a0, hair: 0x3a2318, shirt: 0xfaf3e3, vest: 0x17b3a6, sash: 0xe8463c, pants: 0x2d3c6b, boots: 0x5b3a24, band: 0xe8463c, accent: 0x3bf0ff },
  { name: 'Coral', skin: 0xb9805a, hair: 0x1d1414, shirt: 0xfff6e0, vest: 0xff6f61, sash: 0xffc23d, pants: 0x3b2f4f, boots: 0x3a2618, band: 0xffc23d, accent: 0xffd166 },
  { name: 'Tormenta', skin: 0xe8b48e, hair: 0xeae4d6, shirt: 0xe9f1ff, vest: 0x7b5cff, sash: 0x2ad1c9, pants: 0x262640, boots: 0x2b2238, band: 0x2ad1c9, accent: 0xb36bff },
  { name: 'Sol', skin: 0x8a5a3c, hair: 0x2a1a10, shirt: 0xfffbea, vest: 0xffb02e, sash: 0x2e7dd6, pants: 0x5a3b2a, boots: 0x2e2018, band: 0x2e7dd6, accent: 0xffe14d },
  { name: 'Brea', skin: 0xf6d2b5, hair: 0xc4482e, shirt: 0xf0ece4, vest: 0x2b2b3a, sash: 0xd23b6b, pants: 0x1f1f2a, boots: 0x4a2f22, band: 0xf5f5f5, accent: 0xff5fa2 },
  { name: 'Capitana', skin: 0xd9a27a, hair: 0x6b3d2a, shirt: 0xfff4e0, vest: 0x9a2230, sash: 0xffc23d, pants: 0x2a2440, boots: 0x231a14, band: 0x1f1a2e, accent: 0xffc23d, hat: true, coat: true },
  { name: 'Vendedora', skin: 0x9c6b4b, hair: 0x241612, shirt: 0xfde7c4, vest: 0x3fa34d, sash: 0xff8c42, pants: 0x7a4f9a, boots: 0x5b3a24, band: 0xff8c42, accent: 0x7be0a1, scarf: true, apron: true },
];

const DARK = 0x1a1033;
const HIP_Y = 0.43;

const cache = new Map();
function buildParts(skinIdx) {
  if (cache.has(skinIdx)) return cache.get(skinIdx);
  const S = SKINS[skinIdx] || SKINS[0];
  // Head (pivot at the neck).
  const head = [
    part(sphere(0.33, 20, 14), S.skin, { pos: [0, 0.3, 0], scale: [1, 0.95, 0.97] }),
    part(sphere(0.07, 6, 4), S.skin, { pos: [0.32, 0.27, 0], scale: [0.6, 1, 1] }),
    part(sphere(0.07, 6, 4), S.skin, { pos: [-0.32, 0.27, 0], scale: [0.6, 1, 1] }),
    part(sphere(0.035, 6, 4), 0xe6a57f, { pos: [0, 0.235, 0.325] }),
    // eyes + highlights
    part(capsule(0.043, 0.05, 3, 8), DARK, { pos: [0.118, 0.29, 0.29], rot: [-0.18, 0, 0] }),
    part(capsule(0.043, 0.05, 3, 8), DARK, { pos: [-0.118, 0.29, 0.29], rot: [-0.18, 0, 0] }),
    part(sphere(0.017, 4, 3), 0xffffff, { pos: [0.106, 0.315, 0.335] }),
    part(sphere(0.017, 4, 3), 0xffffff, { pos: [-0.13, 0.315, 0.335] }),
    // brows (a bit of attitude)
    part(bbox(0.1, 0.028, 0.03), S.hair, { pos: [0.12, 0.39, 0.29], rot: [-0.2, 0, -0.18] }),
    part(bbox(0.1, 0.028, 0.03), S.hair, { pos: [-0.12, 0.39, 0.29], rot: [-0.2, 0, 0.18] }),
    // smile + cheeks
    part(torus(0.045, 0.013, 4, 8, Math.PI), DARK, { pos: [0, 0.175, 0.31], rot: [0.25, 0, Math.PI] }),
    part(sphere(0.05, 6, 4), 0xff8f8f, { pos: [0.2, 0.2, 0.245], scale: [1, 0.6, 0.35], rot: [0, 0.7, 0] }),
    part(sphere(0.05, 6, 4), 0xff8f8f, { pos: [-0.2, 0.2, 0.245], scale: [1, 0.6, 0.35], rot: [0, -0.7, 0] }),
    // hair mass (back/top); players wear a bandana cap on top so the color reads from above
    part(sphere(0.345, 16, 12), 0, { pos: [0, 0.34, -0.05], scale: [1.0, 0.95, 0.95], paint: (x, y, z) => (!S.hat && !S.scarf && y > 0.43 + Math.max(0, z) * 0.25 ? S.band : S.hair) }),
    // earring
    part(torus(0.03, 0.008, 4, 8), 0xffc23d, { pos: [0.33, 0.2, 0.02], rot: [0, Math.PI / 2, 0] }),
  ];
  if (S.hat) {
    head.push(
      part(cyl(0.46, 0.46, 0.05, 20), 0x1f1a2e, { pos: [0, 0.55, -0.02], scale: [1, 1, 0.82] }),
      part(cyl(0.25, 0.3, 0.24, 18), 0x1f1a2e, { pos: [0, 0.68, -0.02] }),
      part(torus(0.29, 0.02, 6, 24), 0xffc23d, { pos: [0, 0.58, -0.02], rot: [Math.PI / 2, 0, 0] }),
      part(cone(0.07, 0.16, 6), 0xf4f1ea, { pos: [0.18, 0.72, 0.12], rot: [0.3, 0, -0.6] }),
    );
  } else if (S.scarf) {
    head.push(
      part(sphere(0.36, 22, 14, 0, Math.PI * 2), S.band, { pos: [0, 0.36, -0.02], scale: [1, 0.85, 1] }),
      part(sphere(0.08, 10, 8), S.band, { pos: [0, 0.62, -0.08] }),
    );
  } else {
    head.push(
      // bandana band + knot tails
      part(torus(0.315, 0.055, 6, 20), S.band, { pos: [0, 0.4, 0], rot: [Math.PI / 2 - 0.12, 0, 0] }),
      part(sphere(0.07, 6, 4), S.band, { pos: [0, 0.42, -0.33] }),
      part(cone(0.06, 0.2, 6), S.band, { pos: [0.06, 0.32, -0.38], rot: [-2.6, 0, 0.35] }),
      part(cone(0.06, 0.2, 6), S.band, { pos: [-0.06, 0.32, -0.38], rot: [-2.6, 0, -0.35] }),
      // hair tuft poking out front
      part(cone(0.07, 0.16, 6), S.hair, { pos: [0.06, 0.5, 0.2], rot: [0.9, 0, -0.3] }),
    );
  }

  // Torso (pivot at the waist).
  const isShirt = (x, y, z) => z > 0.05 && Math.abs(x) < 0.04 + Math.max(0, y - 0.18) * 0.45 && y > 0.16;
  const torsoPaint = (x, y, z) => (y < 0.05 ? S.pants : y < 0.14 ? S.sash : isShirt(x, y, z) ? S.shirt : S.vest);
  const torso = [
    part(capsule(0.2, 0.16, 4, 14), 0, { pos: [0, 0.27, 0], scale: [1.08, 1, 0.84], paint: torsoPaint }),
    part(sphere(0.1, 8, 6), S.vest, { pos: [0.235, 0.41, 0] }),
    part(sphere(0.1, 8, 6), S.vest, { pos: [-0.235, 0.41, 0] }),
    part(box(0.09, 0.07, 0.04, 0.015), 0xffc23d, { pos: [0, 0.09, 0.18] }),
    part(box(0.06, 0.16, 0.05, 0.02), S.sash, { pos: [-0.17, 0.0, 0.1], rot: [0.1, 0, 0.25] }),
  ];
  if (S.coat) {
    torso.push(part(cyl(0.235, 0.31, 0.34, 18), S.vest, { pos: [0, -0.1, -0.01] }));
    torso.push(part(box(0.04, 0.3, 0.02, 0.01), 0xffc23d, { pos: [0.09, 0.27, 0.18] }));
  }
  if (S.apron) torso.push(part(box(0.26, 0.34, 0.03, 0.01), 0xf4efe4, { pos: [0, 0.04, 0.17] }));

  const pelvis = [part(box(0.34, 0.16, 0.24, 0.06), S.pants, { pos: [0, 0, 0] })];

  const legPaint = (x, y) => (y < -0.25 ? S.boots : S.pants);
  const leg = [
    part(capsule(0.085, 0.2, 3, 10), 0, { pos: [0, -0.18, 0], paint: legPaint }),
    part(box(0.15, 0.12, 0.25, 0.05), S.boots, { pos: [0, -0.37, 0.035] }),
    part(cyl(0.1, 0.1, 0.06, 10), 0x8a6040, { pos: [0, -0.27, 0] }),
  ];

  const armPaint = (x, y) => (y > -0.16 ? S.shirt : S.skin);
  const arm = [
    part(capsule(0.07, 0.15, 3, 10), 0, { pos: [0, -0.12, 0], paint: armPaint }),
    part(sphere(0.082, 8, 6), S.skin, { pos: [0, -0.29, 0.01] }),
  ];
  // Cutlass in the right hand (blade forward/down).
  const blade = new THREE.Shape();
  blade.moveTo(0, 0); blade.quadraticCurveTo(0.06, 0.3, 0.02, 0.62); blade.lineTo(0.0, 0.66); blade.quadraticCurveTo(-0.03, 0.32, -0.035, 0.0); blade.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 10 });
  const sword = [
    part(bladeGeo, 0xe3ebf5, { pos: [0, 0, 0] }),
    part(cyl(0.022, 0.022, 0.14, 8), 0x5b3a24, { pos: [0, -0.08, 0.009] }),
    part(torus(0.06, 0.012, 6, 12, Math.PI), 0xffc23d, { pos: [-0.01, -0.04, 0.009], rot: [0, 0, Math.PI / 2] }),
    part(box(0.12, 0.025, 0.04, 0.01), 0xffc23d, { pos: [0, 0, 0.009] }),
    part(sphere(0.026, 8, 6), 0xffc23d, { pos: [0, -0.16, 0.009] }),
  ];
  // Orient: hold point at the hand, blade pointing forward and slightly down.
  const swordGeo = merge(sword);
  swordGeo.rotateX(Math.PI / 2 + 0.35);
  swordGeo.translate(0, -0.3, 0.05);
  const armR = merge([...arm.map((g) => g.clone()), swordGeo]);

  const res = {
    head: merge(head), torso: merge(torso), pelvis: merge(pelvis), leg: merge(leg),
    armL: merge(arm), armR, armRBare: merge(arm.map((g) => g.clone())),
  };
  cache.set(skinIdx, res);
  return res;
}

const skinnedCache = new Map();
function skinnedGeometry(skinIdx, sword, bones, P) {
  const key = skinIdx + (sword ? 's' : '');
  if (skinnedCache.has(key)) return skinnedCache.get(key);
  bones[0].updateMatrixWorld(true); // rest pose, root at the origin
  const pieces = [[P.pelvis, 1], [P.leg, 2], [P.leg, 3], [P.torso, 4], [P.head, 5], [P.armL, 6], [sword ? P.armR : P.armRBare, 7]];
  const list = pieces.map(([g, bi]) => {
    const c = g.clone().applyMatrix4(bones[bi].matrixWorld);
    const n = c.attributes.position.count;
    const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { idx[i * 4] = bi; w[i * 4] = 1; }
    c.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    c.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    return c;
  });
  const geo = merge(list);
  skinnedCache.set(key, geo);
  return geo;
}

let sharedMat = null;
export function characterMaterial() {
  if (!sharedMat) sharedMat = toon({ color: 0xffffff, vertexColors: true }, { rim: true, key: 'char' });
  return sharedMat;
}

let blobGeo = null, blobMat = null;

export class CharacterView {
  constructor(skinIdx = 0, { sword = true } = {}) {
    const P = buildParts(skinIdx);
    // Rigid skinning: one merged geometry, one bone per joint -> 1 draw call per pass per character.
    this.skin = skinIdx;
    this.root = new THREE.Group();
    const B = () => new THREE.Bone();
    this.body = B();
    this.hips = B(); this.hips.position.y = HIP_Y;
    this.legL = B(); this.legL.position.set(0.11, -0.02, 0);
    this.legR = B(); this.legR.position.set(-0.11, -0.02, 0);
    this.torso = B(); this.torso.position.y = 0.05;
    this.head = B(); this.head.position.y = 0.47;
    this.armL = B(); this.armL.position.set(0.27, 0.4, 0);
    this.armR = B(); this.armR.position.set(-0.27, 0.4, 0);
    this.body.add(this.hips);
    this.hips.add(this.legL, this.legR, this.torso);
    this.torso.add(this.head, this.armL, this.armR);
    this.bones = [this.body, this.hips, this.legL, this.legR, this.torso, this.head, this.armL, this.armR];
    const geo = skinnedGeometry(skinIdx, sword, this.bones, P);
    this.mesh = new THREE.SkinnedMesh(geo, characterMaterial());
    this.mesh.add(this.body);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.7);
    this.root.add(this.mesh);
    this.meshes = [this.mesh];

    if (!blobGeo) {
      blobGeo = new THREE.PlaneGeometry(1.25, 1.25);
      blobGeo.rotateX(-Math.PI / 2);
      blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    this.blob = new THREE.Mesh(blobGeo, blobMat);
    this.blob.layers.set(LAYER.NO_OUTLINE);
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 2;
    this.root.add(this.blob);

    // Animation state.
    this.t = Math.random() * 10;
    this.phase = 0;
    this.run = 0;
    this.dash = 0;
    this.lean = 0;
    this.roll = 0;
    this.lastF = null;
    this.sy = { x: 1, v: 0 };
    this.sz = { x: 1, v: 0 };
    this.lastStep = 0;
    this.onStep = null;
    this.wasDash = false;
    this.facing = 0;
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }

  // s: {x, y, z, f, vx, vz, st (1 = dash), mag, wade}
  update(dt, s) {
    this.t += dt;
    this.root.position.set(s.x, s.y, s.z);
    if (this.lastF === null) this.lastF = s.f;
    const turnRate = angleDelta(this.lastF, s.f) / Math.max(dt, 1e-4);
    this.lastF = s.f;
    this.root.rotation.y = s.f;

    const speed = Math.hypot(s.vx, s.vz);
    const dashing = s.st === 1;
    this.run = damp(this.run, dashing ? 0.4 : clamp(speed / 6.5, 0, 1), 12, dt);
    this.dash = damp(this.dash, dashing ? 1 : 0, dashing ? 30 : 10, dt);
    if (dashing && !this.wasDash) { this.sz.v += 6; this.sy.v -= 4; }
    if (!dashing && this.wasDash) { this.sz.v -= 5; this.sy.v -= 3.5; }
    this.wasDash = dashing;

    // Stride: one cycle per ~1.3 u travelled.
    const prevPhase = this.phase;
    this.phase += dt * (speed / 1.3) * Math.PI * 2 * (dashing ? 0.25 : 1);
    if (this.run > 0.35 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      if (this.onStep) this.onStep(Math.floor(this.phase / Math.PI) & 1);
    }
    const sw = Math.sin(this.phase) * this.run;
    const breathe = Math.sin(this.t * 2.4) * (1 - this.run) * (1 - this.dash);

    // Squash & stretch springs (settle with overshoot, never keep wobbling).
    spring(this.sy, dashing ? 0.86 : 1, 320, 17, dt);
    spring(this.sz, dashing ? 1.32 : 1, 320, 17, dt);
    const sx = 1 / Math.sqrt(Math.max(0.3, this.sy.x * this.sz.x));
    this.body.scale.set(sx, this.sy.x + breathe * 0.012, this.sz.x);

    this.lean = damp(this.lean, 0.2 * this.run + 0.5 * this.dash, 10, dt);
    this.roll = damp(this.roll, clamp(-turnRate * 0.035, -0.3, 0.3) * this.run, 8, dt);
    this.body.rotation.set(this.lean, 0, this.roll);

    const bob = Math.abs(Math.sin(this.phase)) * 0.055 * this.run;
    this.hips.position.y = HIP_Y + bob - 0.025 * this.run - 0.05 * this.dash;
    this.hips.rotation.y = sw * 0.12;
    this.torso.rotation.set(0.04 * this.run, -sw * 0.22, 0);
    this.head.rotation.set(-this.lean * 0.55 + breathe * 0.02, sw * 0.08, -this.roll * 0.4);

    const legSwing = sw * 0.85;
    this.legL.rotation.x = damp(this.legL.rotation.x, legSwing * (1 - this.dash) + 0.75 * this.dash, 22, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, -legSwing * (1 - this.dash) - 0.9 * this.dash, 22, dt);
    this.legL.position.y = -0.02 + Math.max(0, Math.cos(this.phase)) * 0.05 * this.run;
    this.legR.position.y = -0.02 + Math.max(0, -Math.cos(this.phase)) * 0.05 * this.run;

    const armSwing = sw * 0.95;
    const idleArm = 0.1 + breathe * 0.03;
    this.armL.rotation.x = damp(this.armL.rotation.x, -armSwing * (1 - this.dash) - 1.15 * this.dash, 20, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armSwing * (1 - this.dash) - 1.0 * this.dash, 20, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, idleArm + 0.12 * this.run + 0.35 * this.dash, 14, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, -idleArm - 0.12 * this.run - 0.35 * this.dash, 14, dt);

    // Blob shadow sits on the ground plane (counter the body lean/scale), fades in water.
    this.blob.material.opacity = 1;
    this.blob.scale.setScalar(1 + this.dash * 0.25);
    this.blob.visible = (s.wade || 0) < 0.4;
  }
}

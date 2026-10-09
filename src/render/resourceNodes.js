// Interactive resource views share the island's painted vegetation and coastal props.
import * as THREE from 'three';
import { HARVEST } from '../data/resources.js';
import { assets } from './assets/registry.js';
import { toon, normalMatFor } from './toon.js';
import { coastRockGeometry, COAST_ROCK_ID } from './coastRockGeometry.js';
import { loadedDebrisGeometry, debrisGeometry, DEBRIS_IDS } from './beachDebrisGeometry.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID } from './townMaterials.js';
import { townWorkbenchGeometry, townFurnitureMaterial } from './townFurniture.js';
import { palmVariant } from './palmGeometry.js';
import { naturalRockMaterial } from './rockMaterials.js';

const mat4 = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const MINING_SCALE = 2.4;
const MINING_DEPLETED_SCALE = .30;

function instanceMatrix(mesh, index, x, y, z, yaw, size, tilt = null) {
  rotation.setFromAxisAngle(axisY, yaw || 0);
  if (tilt) rotation.multiply(tilt);
  position.set(x, y, z);
  scale.set(size, size, size);
  mat4.compose(position, rotation, scale);
  mesh.setMatrixAt(index, mat4);
}

function invisibleMatrix(mesh, index) {
  position.set(0, -1000, 0); scale.set(0, 0, 0);
  mat4.compose(position, rotation.identity(), scale);
  mesh.setMatrixAt(index, mat4);
}

function stumpTopGeometry() {
  const radial = 12, rings = 3, positions = [], colors = [], indices = [];
  const palette = [new THREE.Color(0xc9975c), new THREE.Color(0xe0bd7f), new THREE.Color(0xb77f4b)];
  for (let r = 0; r <= rings; r++) {
    const radius = 0.27 * (1 - r * 0.22);
    const color = palette[r % palette.length];
    for (let i = 0; i <= radial; i++) {
      const a = i / radial * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < radial; i++) {
    const a = r * (radial + 1) + i, b = a + radial + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices); geo.computeVertexNormals(); geo.computeBoundingSphere();
  return geo;
}

function colorStumpBody(geo) {
  const p = geo.getAttribute('position'), colors = [];
  const bark = new THREE.Color(0x87512f), dark = new THREE.Color(0x603820);
  for (let i = 0; i < p.count; i++) {
    const c = p.getY(i) < 0 ? dark : bark;
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function recolorRock(source, kind) {
  const geo = source.clone(), p = geo.getAttribute('position'), colors = [];
  const stone = new THREE.Color(kind === 'iron_ore' ? 0x52616b : 0x777b7d);
  const light = new THREE.Color(kind === 'iron_ore' ? 0xa3a69d : 0xa4a6a2);
  const seam = new THREE.Color(kind === 'iron_ore' ? 0xc9784d : 0x777b7d);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const vein = kind === 'iron_ore' && (
      (Math.abs(Math.sin(x * 6 + y * 4 + z * 2.5)) < .42 && y > .06) || i % 11 === 0);
    const c = vein ? seam : stone.clone().lerp(light, Math.max(0, Math.min(.55, y * .65 + (i % 7) * .035)));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function miningCracks() {
  const points = [
    [-.31, .48, .31], [-.14, .38, .43], [-.14, .38, .43], [-.19, .22, .46], [-.19, .22, .46], [-.05, .08, .48],
    [-.03, .50, .46], [.10, .34, .48], [.10, .34, .48], [.04, .21, .49], [.04, .21, .49], [.19, .08, .44],
    [.20, .44, .43], [.15, .30, .48], [.15, .30, .48], [.28, .18, .39], [.28, .18, .39], [.24, .06, .39],
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function makePalmParticlePool(group) {
  const chipGeo = new THREE.IcosahedronGeometry(0.075, 0);
  const leafGeo = new THREE.PlaneGeometry(0.22, 0.09);
  const chipMat = toon({ color: 0xffffff }, { comic: false, key: 'resource-palm-chip' });
  const leafMat = toon({ color: 0x83a943, side: THREE.DoubleSide }, { comic: false, key: 'resource-palm-leaf' });
  const chipMesh = new THREE.InstancedMesh(chipGeo, chipMat, 32);
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, 16);
  for (const mesh of [chipMesh, leafMesh]) {
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.nm = normalMatFor({}); group.add(mesh);
    for (let i = 0; i < mesh.count; i++) invisibleMatrix(mesh, i);
  }
  return { chipMesh, leafMesh, chipGeo, leafGeo, chipMat, leafMat, items: [], nextChip: 0, nextLeaf: 0 };
}

export class ResourceNodes {
  constructor(scene, { palms = null, swayUniform = null, map = null } = {}) {
    this.scene = scene; this.map = map;
    this.group = new THREE.Group(); this.group.name = 'coastal-resources'; scene.add(this.group);
    this.onChange = null;
    const rockData = assets.data(COAST_ROCK_ID), importedRock = rockData?.parts?.[0]?.geo;
    const rockSource = importedRock || new THREE.IcosahedronGeometry(.6, 0);
    this.rock = coastRockGeometry(rockSource, 0);
    this.miningRock = recolorRock(this.rock, 'rock');
    this.ironOre = recolorRock(this.rock, 'iron_ore');
    this.miningCrackGeo = miningCracks();
    this.miningCrackMat = new THREE.LineBasicMaterial({ color: 0x25282a, transparent: true, opacity: .88 });
    if (!importedRock) rockSource.dispose();
    const wood = loadedDebrisGeometry(assets.data(DEBRIS_IDS[1]));
    const planks = loadedDebrisGeometry(assets.data(DEBRIS_IDS[2]));
    this.wood = wood || debrisGeometry(1); this.planks = planks || debrisGeometry(2);
    this.paint = toon({ color: 0xffffff, vertexColors: true }, { comic: false, key: 'coast-resource-paint' });
    this.rockPaint = naturalRockMaterial('harvest-stone');
    this.legPaint = toon({ color: 0x82532e }, { comic: false, key: 'coast-resource-legs' });
    this.gold = new THREE.MeshBasicMaterial({ color: 0xe6b75b });
    this.cyan = new THREE.MeshBasicMaterial({ color: 0x72d9ce });
    this.gray = new THREE.MeshBasicMaterial({ color: 0x596775 });
    this.ring = new THREE.RingGeometry(.72, .78, 16);
    this.diamond = new THREE.OctahedronGeometry(.1, 0);
    this.leg = new THREE.BoxGeometry(.12, .62, .12);
    this.benchPaint = townFurnitureMaterial(assets.texture(TOWN_ALBEDO_ID), assets.texture(TOWN_NORMAL_ID));
    this.benchGeometry = this.benchPaint ? townWorkbenchGeometry() : null;
    this.records = new Map(); this.bench = null;
    this.palmResources = palms;
    this.palmRecords = new Map(); this.palmSlots = [[], [], []]; this.palmSeenRev = new Map();
    this.palmAnimations = new Map(); this.hitRevisions = new Map();
    this.palmMeshes = []; this.stumpMeshes = null; this.stumpMarkMeshes = [];
    this.palmTime = 0; this.lastFocus = null;
    this.palmStumpBody = colorStumpBody(new THREE.CylinderGeometry(.25, .30, .48, 8, 1, false));
    this.palmStumpTop = stumpTopGeometry();
    this.stumpPaint = toon({ color: 0xffffff, vertexColors: true }, { comic: false, key: 'resource-palm-stump' });
    this.stumpNm = normalMatFor({});
    this.palmNotchGeo = new THREE.BoxGeometry(.24, .035, .018);
    this.palmNotchMat = toon({ color: 0x553622 }, { comic: false, key: 'resource-palm-notch' });
    this.markerGroup = new THREE.Group(); this.markerGroup.name = 'nearby-resource-markers'; this.group.add(this.markerGroup);
    this.particlePool = makePalmParticlePool(this.group);
    this._initPalmInstances();
    this.group.userData.resources = { maxNodes: HARVEST.maxNodes, maxPalms: HARVEST.maxPalms,
      textures: [], gameplay: true, loaded: [...(importedRock ? [COAST_ROCK_ID] : []), ...(wood ? [DEBRIS_IDS[1]] : []), ...(planks ? [DEBRIS_IDS[2]] : [])] };
    this.group.userData.palmResources = { maxPalms: HARVEST.maxPalms, loaded: [], textures: [],
      maxNodes: HARVEST.maxNodes, drawCalls: 6 + 2 + 2, visiblePalms: 0, damagedPalms: 0,
      stumps: 0, particles: 0, lastHit: null, geometryTriangles: 0 };
    this.group.userData.miningResources = { nodes: 0, ironOre: 0, drawCalls: 0, geometryTriangles: 0,
      source: COAST_ROCK_ID, texturesAdded: 0, instanceScale: MINING_SCALE, depletedScale: MINING_DEPLETED_SCALE,
      maxNodes: HARVEST.maxNodes, crackDrawCalls: 0 };
    const miningGeo = this.miningRock;
    this.group.userData.miningResources.geometryTriangles = miningGeo.index
      ? miningGeo.index.count / 3 : miningGeo.attributes.position.count / 3;
    const pm = this.group.userData.palmResources;
    pm.loaded = [...(palms?.loaded || [])]; pm.textures = [...(palms?.mats?.textures || [])];
    pm.geometryTriangles = (palms?.geometries || []).reduce((n, g) => n +
      (g?.trunk?.index ? g.trunk.index.count : g?.trunk?.attributes?.position?.count || 0) / 3 +
      (g?.fronds?.index ? g.fronds.index.count : g?.fronds?.attributes?.position?.count || 0) / 3, 0);
  }

  _initPalmInstances() {
    const geometry = this.palmResources?.geometries || [];
    const mats = this.palmResources?.mats;
    if (!mats || geometry.length < 3) return;
    for (let variant = 0; variant < 3; variant++) {
      const part = geometry[variant];
      if (!part?.trunk || !part?.fronds) continue;
      const trunk = new THREE.InstancedMesh(part.trunk, mats.trunk, HARVEST.maxPalms);
      const fronds = new THREE.InstancedMesh(part.fronds, mats.fronds, HARVEST.maxPalms);
      for (const mesh of [trunk, fronds]) {
        mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      }
      trunk.userData.nm = mats.trunkNm; trunk.customDepthMaterial = mats.trunkDepth;
      fronds.userData.nm = mats.frondNm; fronds.customDepthMaterial = mats.frondDepth;
      this.group.add(trunk, fronds);
      this.palmMeshes[variant] = { trunk, fronds, geometry: part };
      for (let i = 0; i < HARVEST.maxPalms; i++) {
        invisibleMatrix(trunk, i); invisibleMatrix(fronds, i);
      }
    }
    this.stumpMeshes = {
      body: new THREE.InstancedMesh(this.palmStumpBody, this.stumpPaint, HARVEST.maxPalms),
      top: new THREE.InstancedMesh(this.palmStumpTop, this.stumpPaint, HARVEST.maxPalms),
    };
    for (const mesh of Object.values(this.stumpMeshes)) {
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.nm = this.stumpNm;
      this.group.add(mesh);
      for (let i = 0; i < HARVEST.maxPalms; i++) invisibleMatrix(mesh, i);
    }
  }

  _recordPalm(node) {
    let record = this.palmRecords.get(node.id);
    if (record) { record.node = node; return record; }
    const variant = palmVariant(node);
    const slot = this.palmSlots[variant].length;
    if (slot >= HARVEST.maxPalms) return null;
    record = { node, variant, slot, stumpSlot: this.palmRecords.size, group: null, marker: null, gem: null, notches: [], felled: (node.hits || 0) >= HARVEST.palmHits };
    this.palmSlots[variant].push(record); this.palmRecords.set(node.id, record);
    return record;
  }

  _damageMarks(record, near) {
    const node = record.node, hits = Math.min(2, Math.max(0, node.hits || 0));
    if (!near || hits === 0) {
      if (record.group) record.group.visible = false;
      return;
    }
    if (!record.group) {
      record.group = new THREE.Group(); record.group.userData.resourceNode = node.id;
      for (let i = 0; i < 2; i++) {
        const mark = new THREE.Mesh(this.palmNotchGeo, this.palmNotchMat);
        mark.userData.nm = this.stumpNm; mark.visible = false; record.group.add(mark); record.notches.push(mark);
      }
      this.markerGroup.add(record.group);
    }
    record.group.visible = true;
    record.group.position.set(node.x, node.y, node.z); record.group.rotation.y = node.rot || 0;
    for (let i = 0; i < record.notches.length; i++) {
      const mark = record.notches[i], visible = i < hits;
      mark.visible = visible;
      mark.position.set(0.03 * node.scale, (0.95 + i * .48) * node.scale, .285 * node.scale);
      mark.rotation.z = i % 2 ? -.24 : .2;
      mark.scale.setScalar(Math.max(.55, node.scale));
      if (visible) mark.castShadow = false;
    }
  }

  _marker(record, focus, time) {
    const node = record.node, near = Math.hypot(focus.x - node.x, focus.z - node.z) <= 6;
    if (!near) {
      if (record.marker) record.marker.visible = false;
      return;
    }
    if (!record.marker) {
      const group = new THREE.Group(); group.userData.resourceNode = node.id;
      const ring = new THREE.Mesh(this.ring, this.gold); ring.rotation.x = -Math.PI / 2; ring.position.y = .035;
      const gem = new THREE.Mesh(this.diamond, this.gold); gem.position.y = .74;
      group.add(ring, gem); this.markerGroup.add(group);
      record.marker = group; record.gem = gem;
    }
    record.marker.visible = true;
    record.marker.position.set(node.x, node.y, node.z);
    record.marker.children[0].material = node.ready ? this.gold : this.gray;
    record.gem.visible = node.ready;
    record.gem.position.y = .74 + Math.sin(time * 2.4 + node.rev) * .035;
    record.gem.rotation.y = time * .8;
  }

  _updatePalmInstances(focus, time, dt) {
    if (!this.palmMeshes.length) return;
    let visibleCount = 0, damagedCount = 0, stumpCount = 0;
    for (let variant = 0; variant < 3; variant++) {
      const meshes = this.palmMeshes[variant]; if (!meshes) continue;
      const rows = this.palmSlots[variant];
      meshes.trunk.count = rows.length; meshes.fronds.count = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const record = rows[i], node = record.node;
        const anim = this.palmAnimations.get(node.id);
        if (anim) anim.t += dt;
        const animT = anim ? Math.min(1, anim.t / anim.duration) : 0;
        if (anim && animT >= 1) {
          if (anim.type === 'fall') record.felled = true;
          this.palmAnimations.delete(node.id);
        }
        const inRange = Math.hypot(focus.x - node.x, focus.z - node.z) < 84;
        const falling = anim?.type === 'fall';
        const felled = !falling && (record.felled || (node.hits || 0) >= 3);
        if (inRange && !felled) {
          visibleCount++;
          let px = node.x, py = node.y, pz = node.z, yaw = node.rot || 0;
          let tilt = null;
          if (anim) {
            const t = animT;
            if (anim.type === 'fall') {
              const angle = Math.PI * .49 * easeOut(t);
              tilt = new THREE.Quaternion().setFromAxisAngle(axisZ, angle);
              py = node.y + .03;
            } else {
              const envelope = 1 - t;
              const wobble = Math.sin(t * Math.PI * 5) * .12 * envelope;
              px += Math.sin(anim.seed) * wobble; pz += Math.cos(anim.seed) * wobble;
              yaw += wobble * .5;
            }
          }
          instanceMatrix(meshes.trunk, i, px, py - .1, pz, yaw, node.scale || 1, tilt);
          instanceMatrix(meshes.fronds, i, px, py - .1, pz, yaw, node.scale || 1, tilt);
        } else {
          invisibleMatrix(meshes.trunk, i); invisibleMatrix(meshes.fronds, i);
        }
        if ((node.hits || 0) > 0) damagedCount++;
        if (felled) stumpCount++;
        const stumpOn = inRange && felled;
        const size = node.scale || 1;
        if (stumpOn) {
          instanceMatrix(this.stumpMeshes.body, record.stumpSlot, node.x, node.y + .24 * size, node.z, node.rot, size);
          instanceMatrix(this.stumpMeshes.top, record.stumpSlot, node.x, node.y + .49 * size, node.z, node.rot, size);
        } else {
          invisibleMatrix(this.stumpMeshes.body, record.stumpSlot); invisibleMatrix(this.stumpMeshes.top, record.stumpSlot);
        }
        this._marker(record, focus, time);
        this._damageMarks(record, Math.hypot(focus.x - node.x, focus.z - node.z) < 22 && !felled);
      }
      meshes.trunk.instanceMatrix.needsUpdate = true; meshes.fronds.instanceMatrix.needsUpdate = true;
    }
    if (this.stumpMeshes) for (const mesh of Object.values(this.stumpMeshes)) mesh.instanceMatrix.needsUpdate = true;
    this.group.userData.palmResources.visiblePalms = visibleCount;
    this.group.userData.palmResources.damagedPalms = damagedCount;
    this.group.userData.palmResources.stumps = stumpCount;
    this.group.userData.palmResources.drawCalls = 6 + (this.stumpMeshes ? 2 : 0) + 2;
  }

  _particle(x, y, z, seed, leaf = false, stone = false) {
    const pool = this.particlePool, list = pool.items;
    const index = leaf ? 32 + pool.nextLeaf++ % 16 : pool.nextChip++ % 32;
    if (!leaf) {
      pool.chipMesh.setColorAt(index, new THREE.Color(stone === 'iron_ore' ? 0x9d6249 : stone ? 0xb1bcb7 : 0xa86b37));
      pool.chipMesh.instanceColor.needsUpdate = true;
    }
    const a = seed * 2.399963229728653, speed = .7 + ((Math.abs(Math.sin(seed * 3.17)) * 1000) % 1000) / 1000 * 1.2;
    list[index] = { x, y, z, vx: Math.cos(a) * speed, vy: 1.2 + ((Math.abs(Math.cos(seed * 1.91)) * 1000) % 1000) / 1000 * 1.5,
      vz: Math.sin(a) * speed, spin: seed * .7, t: 0, life: leaf ? .75 : .5, leaf, size: leaf ? .7 : .65 };
  }

  _updateParticles(dt) {
    const pool = this.particlePool;
    for (let i = 0; i < 48; i++) {
      const p = pool.items[i];
      const mesh = i < 32 ? pool.chipMesh : pool.leafMesh, slot = i < 32 ? i : i - 32;
      if (!p || p.t >= p.life) { invisibleMatrix(mesh, slot); continue; }
      p.t += dt; p.vy -= 4.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.spin += dt * (p.leaf ? 4 : 8);
      const fade = Math.max(.001, (1 - p.t / p.life) * p.size);
      rotation.setFromEuler(new THREE.Euler(p.leaf ? Math.PI * .5 : p.spin, p.spin, p.leaf ? p.spin : 0));
      position.set(p.x, p.y, p.z); scale.set(fade, fade, fade);
      mat4.compose(position, rotation, scale); mesh.setMatrixAt(slot, mat4); mesh.instanceMatrix.needsUpdate = true;
    }
    this.group.userData.palmResources.particles = pool.items.filter((p) => p && p.t < p.life).length;
    pool.chipMesh.instanceMatrix.needsUpdate = pool.leafMesh.instanceMatrix.needsUpdate = true;
  }

  // A public event starts the visual response once per authoritative node revision.
  reset() {
    this.hitRevisions.clear(); this.palmAnimations.clear(); this.particlePool.items.length = 0;
    for (const record of this.records.values()) { record.hit = null; record.group.rotation.set(0, 0, 0); }
  }

  hit(event) {
    if (!event || !['palm', 'stone', 'wood', 'rock', 'iron_ore'].includes(event.kind) || typeof event.node !== 'string'
        || !Number.isSafeInteger(event.rev) || ![event.x, event.y, event.z].every(Number.isFinite)) return false;
    const last = this.hitRevisions.get(event.node) || 0;
    if (event.rev <= last) return false;
    this.hitRevisions.set(event.node, event.rev);
    if (event.kind !== 'palm') {
      for (let i = 0; i < 6; i++) this._particle(event.x, event.y + .4, event.z, event.rev * 13 + i, false,
        event.kind === 'iron_ore' ? 'iron_ore' : event.kind === 'stone' || event.kind === 'rock');
      const record = this.records.get(event.node);
      if (record) record.hit = { t: 0, seed: event.rev * 1.37 };
      this.group.userData.palmResources.lastHit = { node: event.node, rev: event.rev, kind: event.kind,
        remaining: event.remaining, broken: !!event.broken };
      this.onChange?.(); return true;
    }
    let record = this.palmRecords.get(event.node);
    if (!record && [event.x, event.y, event.z].every(Number.isFinite)) {
      record = this._recordPalm({ id: event.node, kind: 'palm', x: event.x, y: event.y, z: event.z,
        rev: event.rev, ready: true, wait: 0, scale: 1, rot: 0, hits: event.felled ? 3 : 0 });
    }
    if (!record) return false;
    const n = record.node;
    this.palmAnimations.set(event.node, { type: event.felled ? 'fall' : 'shake', t: 0,
      duration: event.felled ? 1 : .28, seed: event.rev * 1.37 + n.x * .17 + n.z * .31 });
    for (let i = 0; i < (event.felled ? 12 : 8); i++)
      this._particle(n.x, n.y + 1.1 * (n.scale || 1), n.z, event.rev * 7 + i, false);
    if (event.felled) {
      for (let i = 0; i < 4; i++) this._particle(event.x ?? n.x, (event.y ?? n.y) + 3 + i * .2, event.z ?? n.z, event.rev * 13 + i, true);
    }
    this.group.userData.palmResources.lastHit = { node: event.node, rev: event.rev, felled: !!event.felled };
    if (this.onChange) this.onChange();
    return true;
  }

  update(snapshot, focus, time) {
    if (!snapshot || !focus) { this.group.visible = false; return; }
    this.group.visible = true; this.palmTime = time || 0;
    const dt = Math.min(.05, Math.max(0, (time || 0) - (this._lastTime || time || 0)));
    const ids = new Set(), palmIds = new Set();
    let miningNodes = 0, ironOreNodes = 0, miningDrawCalls = 0, crackDrawCalls = 0;
    for (const node of snapshot.nodes || []) {
      ids.add(node.id);
      if (node.kind === 'palm') {
        palmIds.add(node.id);
        const record = this._recordPalm(node);
        if (!record) continue;
        this.palmSeenRev.set(node.id, Math.max(this.palmSeenRev.get(node.id) || 0, node.rev || 0));
        record.felled = (node.hits || 0) >= HARVEST.palmHits;
        continue;
      }
      let record = this.records.get(node.id);
      if (!record) {
        const mining = node.kind === 'rock' || node.kind === 'iron_ore';
        const stone = node.kind === 'stone';
        const group = new THREE.Group(), mesh = new THREE.Mesh(
          mining ? (node.kind === 'iron_ore' ? this.ironOre : this.miningRock) : (stone ? this.rock : this.wood),
          mining ? this.paint : (stone ? this.rockPaint : this.paint));
        if (stone) mesh.userData.nm = this.stumpNm;
        mesh.castShadow = false; mesh.receiveShadow = true;
        mesh.scale.setScalar(mining ? MINING_SCALE : stone ? 1.5 : 1.25);
        mesh.rotation.y = Number(node.id.split('-')[1]) * 2.4;
        const marker = new THREE.Mesh(this.ring, this.gold); marker.rotation.x = -Math.PI / 2; marker.position.y = .035;
        const gem = new THREE.Mesh(this.diamond, this.gold); gem.position.y = .9;
        group.add(mesh, marker, gem); this.group.add(group);
        const cracks = mining ? new THREE.LineSegments(this.miningCrackGeo, this.miningCrackMat) : null;
        if (cracks) { cracks.visible = false; cracks.scale.setScalar(MINING_SCALE); group.add(cracks); }
        record = { group, mesh, marker, gem, cracks, mining, kind: node.kind }; this.records.set(node.id, record);
      }
      record.group.position.set(node.x, node.y, node.z);
      const nodeDistance = Math.hypot(focus.x - node.x, focus.z - node.z);
      record.group.visible = nodeDistance < 30;
      record.node = node;
      const depleted = record.mining && !node.ready;
      record.mesh.visible = !record.mining ? node.ready : true;
      const chipScale = depleted ? MINING_DEPLETED_SCALE : 1;
      record.mesh.scale.setScalar((record.mining ? MINING_SCALE : node.kind === 'stone' ? 1.5 : 1.25) * chipScale);
      record.mesh.rotation.z = depleted ? -.16 : 0;
      if (record.cracks) {
        record.cracks.visible = nodeDistance < 30 && (node.hits || 0) > 0;
        record.cracks.scale.setScalar(MINING_SCALE * chipScale);
      }
      if (record.hit) {
        record.hit.t += dt;
        if (record.hit.t >= .24) record.hit = null;
        else record.group.rotation.z = Math.sin(record.hit.t * 68) * .045 * (1 - record.hit.t / .24);
      } else record.group.rotation.z = 0;
      record.marker.material = !node.ready ? this.gray : node.kind === 'stone' ? this.cyan : this.gold;
      record.marker.visible = Math.hypot(focus.x - node.x, focus.z - node.z) < 6;
      if (record.mining) record.marker.scale.setScalar(1.8);
      if (record.mining) {
        miningNodes++; if (node.kind === 'iron_ore') ironOreNodes++;
        if (nodeDistance < 30) miningDrawCalls++;
        if (record.marker.visible) miningDrawCalls++;
        if (record.cracks?.visible) { crackDrawCalls++; miningDrawCalls++; }
      }
      record.gem.material = record.marker.material;
      record.gem.visible = node.ready && !record.mining && Math.hypot(focus.x - node.x, focus.z - node.z) < 6;
      record.gem.position.y = .95 + Math.sin(time * 2.4 + node.rev) * .05;
      record.gem.rotation.y = time * .8;
    }
    for (const [id, record] of this.records) if (!ids.has(id)) {
      this.group.remove(record.group); this.records.delete(id);
    }
    for (const [id, record] of this.palmRecords) if (!palmIds.has(id)) {
      if (record.group) this.markerGroup.remove(record.group);
      if (record.marker) this.markerGroup.remove(record.marker);
      this.palmAnimations.delete(id); this.palmRecords.delete(id);
      for (const slots of this.palmSlots) { const i = slots.indexOf(record); if (i >= 0) slots.splice(i, 1); }
      for (const slots of this.palmSlots) slots.forEach((r, i) => { r.slot = i; });
      [...this.palmRecords.values()].forEach((r, i) => { r.stumpSlot = i; });
    }
    this._updatePalmInstances(focus, time || 0, dt);
    this._updateParticles(dt);
    const miningMeta = this.group.userData.miningResources;
    miningMeta.nodes = miningNodes; miningMeta.ironOre = ironOreNodes;
    miningMeta.drawCalls = miningDrawCalls;
    miningMeta.crackDrawCalls = crackDrawCalls;
    this._lastTime = time || 0;
    if (snapshot.bench) {
      if (!this.bench) {
        this.bench = new THREE.Group(); this.bench.name = 'coastal-workbench';
        this.bench.userData.townFurniture = { family: 'town-furniture-v1', mapped: !!this.benchPaint, texturesAdded: 0 };
        if (this.benchPaint) {
          const body = new THREE.Mesh(this.benchGeometry, this.benchPaint); body.name = 'townWorkbench'; body.receiveShadow = true; this.bench.add(body);
        } else {
          const top = new THREE.Mesh(this.planks, this.paint); top.position.y = .6; top.scale.set(1, .8, .7); this.bench.add(top);
          for (const x of [-.6, .6]) for (const z of [-.25, .25]) {
            const leg = new THREE.Mesh(this.leg, this.legPaint); leg.position.set(x, .3, z); this.bench.add(leg);
          }
        }
        const gem = new THREE.Mesh(this.diamond, this.gold); gem.position.y = 1.35; this.bench.add(gem); this.group.add(this.bench);
      }
      const p = snapshot.bench; this.bench.position.set(p.x, p.y, p.z);
      this.bench.visible = Math.hypot(focus.x - p.x, focus.z - p.z) < 38;
    } else if (this.bench) this.bench.visible = false;
  }
}

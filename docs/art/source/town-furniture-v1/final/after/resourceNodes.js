// Dedicated interactive nodes reuse S02/S09 geometry; ambient beach clutter stays cosmetic.
import * as THREE from 'three';
import { assets } from './assets/registry.js';
import { toon } from './toon.js';
import { coastRockGeometry, COAST_ROCK_ID } from './coastRockGeometry.js';
import { loadedDebrisGeometry, debrisGeometry, DEBRIS_IDS } from './beachDebrisGeometry.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID } from './townMaterials.js';
import { townWorkbenchGeometry, townFurnitureMaterial } from './townFurniture.js';

export class ResourceNodes {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'coastal-resources'; scene.add(this.group);
    const rockData = assets.data(COAST_ROCK_ID);
    const importedRock = rockData?.parts?.[0]?.geo;
    const rockSource = importedRock || new THREE.IcosahedronGeometry(.6, 0);
    this.rock = coastRockGeometry(rockSource, 0);
    if (!importedRock) rockSource.dispose();
    const wood = loadedDebrisGeometry(assets.data(DEBRIS_IDS[1]));
    const planks = loadedDebrisGeometry(assets.data(DEBRIS_IDS[2]));
    this.wood = wood || debrisGeometry(1);
    this.planks = planks || debrisGeometry(2);
    this.paint = toon({ color: 0xffffff, vertexColors: true }, { comic: false, key: 'coast-resource-paint' });
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
    this.group.userData.resources = { maxNodes: 16, textures: [], gameplay: true,
      loaded: [...(importedRock ? [COAST_ROCK_ID] : []), ...(wood ? [DEBRIS_IDS[1]] : []), ...(planks ? [DEBRIS_IDS[2]] : [])] };
  }
  update(snapshot, focus, time) {
    if (!snapshot || !focus) { this.group.visible = false; return; }
    this.group.visible = true;
    const ids = new Set();
    for (const node of snapshot.nodes || []) {
      ids.add(node.id);
      let record = this.records.get(node.id);
      if (!record) {
        const group = new THREE.Group(), mesh = new THREE.Mesh(node.kind === 'stone' ? this.rock : this.wood, this.paint);
        mesh.castShadow = false; mesh.receiveShadow = true;
        mesh.scale.setScalar(node.kind === 'stone' ? 1.5 : 1.25);
        mesh.rotation.y = Number(node.id.split('-')[1]) * 2.4;
        const marker = new THREE.Mesh(this.ring, this.gold); marker.rotation.x = -Math.PI / 2;
        marker.position.y = .035;
        const gem = new THREE.Mesh(this.diamond, this.gold); gem.position.y = .9;
        group.add(mesh, marker, gem); this.group.add(group);
        record = { group, mesh, marker, gem }; this.records.set(node.id, record);
      }
      record.group.position.set(node.x, node.y, node.z);
      record.group.visible = Math.hypot(focus.x - node.x, focus.z - node.z) < 30;
      record.mesh.visible = node.ready;
      record.marker.material = !node.ready ? this.gray : node.kind === 'stone' ? this.cyan : this.gold;
      record.gem.material = record.marker.material;
      record.gem.visible = node.ready && Math.hypot(focus.x - node.x, focus.z - node.z) < 18;
      record.gem.position.y = .95 + Math.sin(time * 2.4 + node.rev) * .05;
      record.gem.rotation.y = time * .8;
    }
    for (const [id, record] of this.records) if (!ids.has(id)) {
      this.group.remove(record.group); this.records.delete(id);
    }
    if (snapshot.bench) {
      if (!this.bench) {
        this.bench = new THREE.Group(); this.bench.name = 'coastal-workbench';
        this.bench.userData.townFurniture = { family: 'town-furniture-v1', mapped: !!this.benchPaint, texturesAdded: 0 };
        if (this.benchPaint) {
          const body = new THREE.Mesh(this.benchGeometry, this.benchPaint);
          body.name = 'townWorkbench'; body.receiveShadow = true; this.bench.add(body);
        } else {
          const top = new THREE.Mesh(this.planks, this.paint); top.position.y = .6; top.scale.set(1, .8, .7);
          this.bench.add(top);
          for (const x of [-.6, .6]) for (const z of [-.25, .25]) {
            const leg = new THREE.Mesh(this.leg, this.legPaint); leg.position.set(x, .3, z); this.bench.add(leg);
          }
        }
        const gem = new THREE.Mesh(this.diamond, this.gold); gem.position.y = 1.35; this.bench.add(gem);
        this.group.add(this.bench);
      }
      const p = snapshot.bench; this.bench.position.set(p.x, p.y, p.z);
      this.bench.visible = Math.hypot(focus.x - p.x, focus.z - p.z) < 38;
    } else if (this.bench) this.bench.visible = false;
  }
}

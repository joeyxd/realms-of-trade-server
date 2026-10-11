// Authoritative gathering events trigger a short cosmetic pose. This never attacks or grants goods.
import * as THREE from 'three';
import { part, merge } from './geo.js';
import { toon } from './toon.js';
import { assets } from './assets/registry.js';
import { buildLook } from './charlooks.js';

let axeGeometry, axeMaterial, pickGeometry, pickMaterial;
function hatchet() {
  if (!axeGeometry) {
    const handle = part(new THREE.CylinderGeometry(.024, .031, .52, 6), 0x825027, { pos: [0, .12, 0] });
    const head = part(new THREE.BoxGeometry(.22, .18, .06), 0xbac8cc, { pos: [.07, .36, 0] });
    const edge = part(new THREE.BoxGeometry(.04, .20, .064), 0xe4e8d4, { pos: [.19, .36, 0], rot: [0, 0, -.1] });
    axeGeometry = merge([handle, head, edge]);
    handle.dispose(); head.dispose(); edge.dispose();
    axeMaterial = toon({ color: 0xffffff, vertexColors: true }, { key: 'harvest-hatchet', comic: false });
  }
  return new THREE.Mesh(axeGeometry, axeMaterial);
}

function pickaxe() {
  if (!pickGeometry) {
    const handle = part(new THREE.CylinderGeometry(.024, .031, .52, 6), 0x825027, { pos: [0, .12, 0] });
    const head = part(new THREE.BoxGeometry(.34, .085, .075), 0x777d80, { pos: [.045, .35, 0] });
    const tipL = part(new THREE.ConeGeometry(.055, .15, 5), 0x777d80, { pos: [-.15, .35, 0], rot: [0, 0, -Math.PI / 2] });
    const tipR = part(new THREE.ConeGeometry(.055, .15, 5), 0x777d80, { pos: [.24, .35, 0], rot: [0, 0, Math.PI / 2] });
    pickGeometry = merge([handle, head, tipL, tipR]);
    for (const geo of [handle, head, tipL, tipR]) geo.dispose();
    pickMaterial = toon({ color: 0xffffff, vertexColors: true }, { key: 'harvest-pickaxe', comic: false });
  }
  return new THREE.Mesh(pickGeometry, pickMaterial);
}

function restore(view) {
  if (view.harvestTool) view.harvestTool.visible = false;
  if (view.harvestPose?.unarmed) {
    const weapon = view.armed ? (view.weaponKind === 'pistolas' ? 'pistols' : true) : false;
    view.mesh.geometry = (assets.charLook(view.skin, weapon) || buildLook(view.skin, weapon)).geo;
  }
  view.harvestPose = null;
}

export function startHarvestPose(view, event) {
  if (!view || ![event.x, event.z].every(Number.isFinite)) return;
  if (view.harvestPose) restore(view);
  const cutting = event.kind === 'palm';
  const mining = event.kind === 'rock' || event.kind === 'iron_ore' || event.tool === 'pickaxe';
  view.harvestPose = { t: 0, duration: cutting || mining ? .68 : .36, cutting, mining,
    facing: Math.atan2(event.x - view.root.position.x, event.z - view.root.position.z), unarmed: true };
  view.mesh.geometry = (assets.charLook(view.skin, false) || buildLook(view.skin, false)).geo;
  if ((cutting || mining) && (!view.harvestTool || view.harvestTool.userData.tool !== (mining ? 'pickaxe' : 'axe'))) {
    if (view.harvestTool) view.foreR.remove(view.harvestTool);
    view.harvestTool = mining ? pickaxe() : hatchet();
    view.harvestTool.userData.tool = mining ? 'pickaxe' : 'axe';
    view.harvestTool.name = mining ? 'harvest-pickaxe' : 'harvest-hatchet';
    view.harvestTool.position.set(0, -.25, .014); view.foreR.add(view.harvestTool);
  }
  if (view.harvestTool) view.harvestTool.visible = cutting || mining;
}

export function stepHarvestPose(view, dt, state) {
  const pose = view.harvestPose;
  if (!pose) return;
  pose.t += dt;
  if (pose.t >= pose.duration || state.dead || state.act || Math.hypot(state.vx || 0, state.vz || 0) > .6) {
    restore(view); return;
  }
  view.root.rotation.y = pose.facing;
  const progress = Math.min(1, pose.t / pose.duration), weight = Math.sin(Math.PI * progress);
  if (pose.cutting || pose.mining) {
    const strike = Math.min(1, pose.t / .20), recover = Math.max(0, (pose.t - .20) / .48);
    view.armR.rotation.set(-2.35 + 1.65 * strike + .55 * recover, -.22, -.2);
    view.foreR.rotation.x = -.45 + .30 * strike;
    view.armL.rotation.x = -.8 * weight; view.foreL.rotation.x = -.6 * weight;
    view.chest.rotation.y -= .25 * weight; view.spine.rotation.x += .17 * weight;
  } else {
    view.spine.rotation.x += .45 * weight; view.armR.rotation.x = -.6 * weight;
    view.foreR.rotation.x = -.25 * weight;
  }
}

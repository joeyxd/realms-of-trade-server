import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { buildNavalRig } from '../src/sim/naval/handling.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { createNavalCoast } from '../src/sim/naval/coastGeometry.js';
import { createTrialBody, stepTrialBody } from '../src/sim/naval/trialBody.js';
import { LAB_FIXTURES } from '../tools/naval-lab/fixtures.js';
import { buildCoastGeometry, findCoastApproach, NavalPilotCoastView } from '../tools/naval-pilot/coastView.js';

const map = generateWorld(20261006);
const coast = createNavalCoast(map);

test('impact fixture finds real water-to-land approaches for raft and house hulls', () => {
  for (const id of ['empty', 'house']) {
    const fixture = LAB_FIXTURES.find((entry) => entry.id === id);
    const rig = buildNavalRig(fixture.parts);
    const approach = findCoastApproach(map, rig);
    assert.ok(approach.coastDistance > 0 && approach.coastDistance < 80);
    assert.ok(approach.dockClearance > 0, `${id} approach must clear the dock corridor`);
    assert.ok(Math.abs(approach.clearance - 20) < 1e-9);
    assert.ok(map.heightAt(approach.shore.x, approach.shore.z) >= 0);
    assert.ok(map.heightAt(approach.shore.x - approach.direction.x * 0.75,
      approach.shore.z - approach.direction.z * 0.75) < 0);

    const c = Math.cos(approach.pose.yaw), s = Math.sin(approach.pose.yaw);
    const hullCenter = { x: approach.pose.x + c * rig.hullCx + s * rig.hullCz,
      z: approach.pose.z - s * rig.hullCx + c * rig.hullCz };
    const right = { x: c, z: -s };
    const corners = [-1, 1].flatMap((side) => [-1, 1].map((end) => ({
      x: hullCenter.x + right.x * side * rig.beam / 2 + approach.direction.x * end * rig.length / 2,
      z: hullCenter.z + right.z * side * rig.beam / 2 + approach.direction.z * end * rig.length / 2,
    })));
    assert.ok(corners.every((point) => map.heightAt(point.x, point.z) < 0));
    assert.ok(corners.every((point) => !map.onDock(point.x, point.z)));
  }
});

test('starter and house fixtures reach natural coastal damage on a clean W approach', () => {
  for (const id of ['empty', 'house']) {
    const fixture = LAB_FIXTURES.find((entry) => entry.id === id);
    const rig = buildNavalRig(fixture.parts);
    const approach = findCoastApproach(map, rig);
    let body = createTrialBody(fixture.parts, approach.pose, `coast-qa-${id}`, 0);
    let damageTick = 0, damagingContact = null;
    for (let tick = 1; tick <= 2000; tick++) {
      body = stepTrialBody(body, { throttle: 1, brake: 0, steer: 0 }, NAVAL_TRIAL.wind, coast);
      damagingContact = body.impacts.find((impact) => impact.damage > 0) || null;
      if (damagingContact) { damageTick = tick; break; }
    }
    assert.ok(damageTick > 0 && damageTick < 2000, `${id} should naturally damage the coast before tick 2000`);
    assert.equal(damagingContact.kind, 'terrain', `${id} should hit shoreline terrain, not the dock`);
  }
});

test('coast patch uses map heights and stays within the desktop and mobile triangle budgets', () => {
  const center = { x: (map.dock.base.x + map.dock.end.x) / 2, z: (map.dock.base.z + map.dock.end.z) / 2 };
  const desktop = buildCoastGeometry(map, { center, size: 96, step: 2 });
  const mobile = buildCoastGeometry(map, { center, size: 96, step: 4 });
  try {
    assert.equal(desktop.index.count / 3, 4608);
    assert.equal(mobile.index.count / 3, 1152);
    for (const geometry of [desktop, mobile]) {
      const p = geometry.getAttribute('position');
      for (const i of [0, Math.floor(p.count / 2), p.count - 1]) {
        assert.ok(Math.abs(p.getY(i) - map.heightAt(p.getX(i), p.getZ(i))) < 1e-5);
      }
    }
  } finally { desktop.dispose(); mobile.dispose(); }
});

test('coast view builds visible terrain and dock meshes from the supplied map', () => {
  const scene = new THREE.Scene();
  const coast = new NavalPilotCoastView(scene, { mobile: true });
  const result = coast.update(map);
  try {
    assert.equal(result.triangles, 1152);
    assert.deepEqual(result.dock.base, map.dock.base);
    assert.ok(scene.getObjectByName('naval-pilot-map-coast'));
    assert.ok(scene.getObjectByName('naval-pilot-real-dock'));
    assert.equal(coast.terrain.visible, true);
    assert.equal(coast.dock.visible, true);
  } finally { coast.dispose(); }
});

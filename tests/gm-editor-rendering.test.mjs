import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorTransformControls } from '../src/editor/transformControls.js';
import { LAYER, Pipeline } from '../src/render/pipeline.js';

function canvasStub() {
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
  };
}

function fixture({ throwOnNormalPass = false } = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const scene = new THREE.Scene();
  const worldMaterial = new THREE.MeshBasicMaterial({ color: 0x123456 });
  const worldMesh = new THREE.Mesh(new THREE.BoxGeometry(), worldMaterial);
  scene.add(worldMesh);

  const controls = createEditorTransformControls(camera, canvasStub());
  controls.visible = true;
  scene.add(controls);
  controls.attach(worldMesh);

  const gizmoMaterials = new Map();
  controls.traverse((object) => {
    if (object.isMesh) gizmoMaterials.set(object, object.material);
  });

  let pipeline;
  let shouldThrow = throwOnNormalPass;
  const normalPassMaterials = [];
  const colorPassMaterials = [];
  const renderer = {
    extensions: { has: () => false },
    capabilities: { isWebGL2: false },
    shadowMap: {},
    target: null,
    setRenderTarget(target) { this.target = target; },
    setClearColor() {},
    render(renderScene) {
      if (renderScene !== scene) return;
      if (this.target === pipeline.rtNormal) {
        normalPassMaterials.push({ world: worldMesh.material, gizmo: new Map([...gizmoMaterials.keys()].map(mesh => [mesh, mesh.material])) });
        scene.updateMatrixWorld(true);
        if (shouldThrow) {
          shouldThrow = false;
          throw new Error('synthetic normal-pass failure');
        }
      } else if (this.target === pipeline.rtMain) {
        colorPassMaterials.push({ world: worldMesh.material, gizmo: new Map([...gizmoMaterials.keys()].map(mesh => [mesh, mesh.material])) });
        scene.updateMatrixWorld(true);
      }
    },
  };
  pipeline = new Pipeline(renderer, scene, camera);
  return { camera, scene, worldMesh, worldMaterial, controls, gizmoMaterials, renderer, pipeline, normalPassMaterials, colorPassMaterials };
}

function assertGizmoMaterialsUnchanged(gizmoMaterials, observed) {
  for (const [mesh, material] of gizmoMaterials) assert.strictEqual(observed.get(mesh), material);
}

test('editor controls stay out of the outline pass and remain raycastable on NO_OUTLINE', () => {
  const f = fixture();
  const { camera, scene, worldMesh, worldMaterial, controls, gizmoMaterials, pipeline, normalPassMaterials, colorPassMaterials } = f;

  assert.doesNotThrow(() => pipeline.render());
  assert.deepEqual(pipeline.casters, [worldMesh]);
  assert.equal(normalPassMaterials.length, 1);
  assert.strictEqual(normalPassMaterials[0].world, pipeline.defaultNormal);
  assertGizmoMaterialsUnchanged(gizmoMaterials, normalPassMaterials[0].gizmo);
  assert.equal(colorPassMaterials.length, 1);
  assert.strictEqual(colorPassMaterials[0].world, worldMaterial);
  assertGizmoMaterialsUnchanged(gizmoMaterials, colorPassMaterials[0].gizmo);
  assert.strictEqual(worldMesh.material, worldMaterial);

  const raycaster = controls.getRaycaster();
  assert.ok(raycaster.layers.isEnabled(LAYER.NO_OUTLINE));
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const coloredHandles = [...gizmoMaterials.keys()].filter((mesh) => mesh.material?.color && mesh.visible);
  const handleHit = coloredHandles.some((mesh) => {
    mesh.geometry.computeBoundingSphere();
    const center = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld).project(camera);
    raycaster.setFromCamera(new THREE.Vector2(center.x, center.y), camera);
    return raycaster.intersectObject(mesh, false).length > 0;
  });
  assert.ok(handleHit, 'the controls raycaster should still intersect visible gizmo handles');

  const plane = controls.children.find((child) => child.isMesh);
  assert.ok(plane, 'TransformControls should include its interaction plane');
  const planeCenter = plane.getWorldPosition(new THREE.Vector3()).project(camera);
  raycaster.setFromCamera(new THREE.Vector2(planeCenter.x, planeCenter.y), camera);
  assert.ok(raycaster.intersectObject(plane, false).length > 0, 'the controls raycaster should still intersect the interaction plane');

  controls.dispose();
  worldMesh.geometry.dispose();
  worldMaterial.dispose();
});

test('normal-pass failures restore world materials so the next frame can render', () => {
  const f = fixture({ throwOnNormalPass: true });
  const { scene, worldMesh, worldMaterial, controls, gizmoMaterials, pipeline } = f;

  assert.throws(() => pipeline.render(), /synthetic normal-pass failure/);
  assert.strictEqual(worldMesh.material, worldMaterial);
  assert.equal(worldMesh.userData._m, null);
  assertGizmoMaterialsUnchanged(gizmoMaterials, new Map([...gizmoMaterials.keys()].map(mesh => [mesh, mesh.material])));

  assert.doesNotThrow(() => pipeline.render());
  assert.strictEqual(worldMesh.material, worldMaterial);
  assert.equal(worldMesh.userData._m, null);
  assert.equal(pipeline.casters.includes(worldMesh), true);
  controls.dispose();
  worldMesh.geometry.dispose();
  worldMaterial.dispose();
});

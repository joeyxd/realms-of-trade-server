// Isolated UI acceptance fixture. No host, account, provider, or gameplay writes.
import * as THREE from 'three';
import { initI18n, setLocale } from '../../src/core/i18n.js';
import { generateWorld } from '../../src/sim/worldgen.js';
import { createVegetation } from '../../src/render/vegetation.js';
import { WorldEditor } from '../../src/editor/editor.js';
import { addDecoration, createDecoration } from '../../src/editor/document.js';

initI18n();
const canvas = document.querySelector('canvas'), scene = new THREE.Scene();
scene.background = new THREE.Color('#142931');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(18, 16, 22); camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
scene.add(new THREE.HemisphereLight(0xe5faff, 0x8c6630, 2));
const sun = new THREE.DirectionalLight(0xffdda2, 2); sun.position.set(5, 15, 10); scene.add(sun);
// Keep the fixture on the same generated GM base/map and editable vegetation contract as the game.
const map = generateWorld(12);
const terrain = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#b89a61', roughness: 1 }));
terrain.rotation.x = -Math.PI / 2; terrain.name = 'terrain'; scene.add(terrain);
const vegetation = createVegetation(map).group;
// Retain the actual GM-editable meshes and source indices, without rendering unrelated foliage.
for (const child of [...vegetation.children]) {
  if (!/^(?:rocks[01]|coastRocks\d+|flowers\d+|pebbles)$/.test(child.name)) vegetation.remove(child);
}
scene.add(vegetation);
const entry = { id: 'model:i18n-fixture', kind: 'model', label: { es: 'Modelo de prueba', en: 'Test model' }, src: 'editor/fixture.glb' };
const template = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshStandardMaterial({ color: '#dc9656' }));
template.position.y = 1.5;
const requests = { model: 0, save: 0, remoteInspect: 0, remoteSave: 0 };
const registry = {
  man: { entries: new Map([[entry.id, entry]]) },
  data: () => null, entry: id => id === entry.id ? entry : null,
  list: () => [{ id: entry.id, state: 'ok' }],
  ensureModel: async () => { requests.model++; return true; },
  model: id => id === entry.id ? template.clone() : null,
};
let editorRef = null, remotePending = false;
const remoteClient = {
  get pending() { return remotePending; },
  resume() {}, cancel() {},
  async inspect() {
    requests.remoteInspect++;
    return { head: { revision: 1, document: structuredClone(editorRef.history.current()), savedAt: 'fixture' }, durable: true,
      scope: { seed: editorRef.map.seed, baseRevision: editorRef.baseRevision } };
  },
  save(document, expectedRevision) {
    requests.remoteSave++; remotePending = true;
    window.editorQA.remoteAttempt = { document: structuredClone(document), expectedRevision };
    return new Promise((resolve, reject) => {
      window.editorQA.resolveRemoteSave = (result) => { remotePending = false; resolve(result); };
      window.editorQA.rejectRemoteSave = (error) => { remotePending = false; reject(error); };
    });
  },
};
const editor = new WorldEditor({ scene, camera, canvas, map,
  assets: registry, parent: document.querySelector('#ui'), draftWorldId: 'i18n-editor-fixture', remoteClient });
editorRef = editor;
await editor.open();
editor.catalog.preparedEntries = []; editor.catalog.refresh([entry]);
const save = editor.store.save.bind(editor.store);
editor.store.save = async (...args) => { requests.save++; return save(...args); };
window.editorQA = {
  editor, requests, setLocale, remoteClient,
  add() {
    const object = createDecoration({ id: `fixture-${editor.history.current().objects.length + 1}`, assetId: entry.id, position: { x: 0, y: 0, z: 0 } });
    editor._commit(addDecoration(editor.history.current(), object)); editor.select(object.id);
    // Explicit saves in this fixture make the no-replay assertion unambiguous.
    clearTimeout(editor.saveTimer); editor.saveTimer = 0;
  },
  pendingSave() {
    editor.store.save = () => {
      requests.save++;
      return new Promise((resolve, reject) => { window.editorQA.resolveSave = resolve; window.editorQA.rejectSave = reject; });
    };
    return editor.saveNow();
  },
  pendingModel() {
    editor.assets.list = () => [];
    editor.assets.ensureModel = () => {
      requests.model++;
      return new Promise((resolve, reject) => { window.editorQA.resolveModel = resolve; window.editorQA.rejectModel = reject; });
    };
    return editor.catalog.choose(entry.id);
  },
};
// Text/CAS acceptance uses a static scene; cap fixture rendering while multiple tabs are open.
let last = performance.now();
function frame(now) {
  if (now - last >= 500) {
    editor.update(Math.min((now - last) / 1000, 0.05)); last = now; renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

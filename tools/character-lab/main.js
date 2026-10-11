// Isolated visual review: preserve named modules and the GLB skeleton instead of baking a game look.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mountAppearanceControls, syncAppearanceControls, applyAppearance, removeAppearance, visibleMeshes, exportAppearance, DEFAULT_APPEARANCE, normalizeAppearance } from './appearance.js';

const viewport = document.querySelector('#viewport'), status = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(31, 1, 0.05, 40);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enablePan = false;
controls.minDistance = .45; controls.maxDistance = 8;
controls.minPolarAngle = .4; controls.maxPolarAngle = Math.PI * .65;
scene.add(new THREE.HemisphereLight(0xfdf4dd, 0x647b92, 2.1));
const sun = new THREE.DirectionalLight(0xffedce, 2.6); sun.position.set(3, 5, 4); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -3;
sun.shadow.camera.right = sun.shadow.camera.top = 3; sun.shadow.normalBias = .025; scene.add(sun);
const fill = new THREE.DirectionalLight(0xb6d6f0, 1.2); fill.position.set(-3, 2, -2); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(2.2, 80), new THREE.ShadowMaterial({ opacity: .17 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const ring = new THREE.Mesh(new THREE.RingGeometry(.65, .657, 100), new THREE.MeshBasicMaterial({ color: 0x8ba6a6, transparent: true, opacity: .5, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.position.y = .002; scene.add(ring);
const requestedVersion = new URLSearchParams(location.search).get('v');
const initialVersion = ['0','1','2','3'].includes(requestedVersion) ? 'v'+requestedVersion : 'v3';
const state = { body: 'male', version: initialVersion, pose: 'a', surface: 'paint', color: '#C89476', loaded: false, time: 0, view: 'front', errors: [] };
state.customize = new URLSearchParams(location.search).get('appearance') === '1';
state.appearance = normalizeAppearance(DEFAULT_APPEARANCE);
let appearanceRevision=0, exportPending=false;
const loaded = new Map(), pending = new Map(), loader = new GLTFLoader();
const swatchOriginal = new THREE.Color(0xc89575);
const folder = '/docs/art/source/characters-base-v0/';
let active = null, loadSequence = 0;
const bandMap = new THREE.DataTexture(new Uint8Array([100, 168, 222, 255]), 4, 1, THREE.RedFormat);
bandMap.minFilter = bandMap.magFilter = THREE.NearestFilter; bandMap.generateMipmaps = false; bandMap.needsUpdate = true;
const softBandMap = new THREE.DataTexture(new Uint8Array([120,148,170,190,208,224,241,255]),8,1,THREE.RedFormat);
softBandMap.minFilter=softBandMap.magFilter=THREE.NearestFilter;softBandMap.generateMipmaps=false;softBandMap.needsUpdate=true;
const checkerData = new Uint8Array(128 * 128 * 4);
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
  const line = x % 16 === 0 || y % 16 === 0, light = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
  const rgb = line ? [18, 47, 59] : light ? [230, 219, 179] : [92, 161, 174];
  checkerData.set([...rgb, 255], (y * 128 + x) * 4);
}
const checker = new THREE.DataTexture(checkerData, 128, 128, THREE.RGBAFormat);
checker.colorSpace = THREE.SRGBColorSpace; checker.needsUpdate = true; checker.magFilter = THREE.NearestFilter;
const checkerMaterial = new THREE.MeshBasicMaterial({ map: checker, side: THREE.DoubleSide });

function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

function look(view) {
  state.view = view;
  if(active&&(view==='hands'||view==='feet')){
    const male=active.kind==='male',mesh=active.meshes.find(m=>m.name==='body_base');
    const bone=view==='hands'?'foreL':'shinL',index=mesh.skeleton.bones.findIndex(b=>b.name===bone);
    const point=view==='hands'?new THREE.Vector3((male?.20:.18)+.09,(male?.91:.89)-.095,.028):new THREE.Vector3((male?.102:.097)*.92,.105,.11);
    point.applyMatrix4(mesh.skeleton.boneInverses[index]).applyMatrix4(active.bones[bone].matrixWorld);
    controls.target.copy(point);camera.position.copy(point).add(view==='hands'?new THREE.Vector3(.23,.09,.53):new THREE.Vector3(.29,.14,.37));
    controls.update();return;
  }
  const narrow = viewport.clientWidth < 500;
  const targetY = view === 'face' ? (active?.bones.head.getWorldPosition(new THREE.Vector3()).y ?? 1.54) + .15 : narrow ? .88 : 1.05;
  controls.target.set(0, targetY, view === 'face' ? .03 : 0);
  const distance = narrow ? 5.6 : 5.25, eyeY = targetY + .13;
  const positions = { front: [0, eyeY, distance], side: [distance, eyeY, 0], back: [0, eyeY, -distance], face: [0, targetY + .02, .94], game: [distance * .65, targetY + distance * .65, distance * .65] };
  camera.position.fromArray(positions[view]); controls.update();
}

function paint(model) {
  const chosen = new THREE.Color(state.color), ratio = [chosen.r / swatchOriginal.r, chosen.g / swatchOriginal.g, chosen.b / swatchOriginal.b];
  for (const mesh of model.meshes) {
    if (!['body_base', 'head_base'].includes(mesh.name)) continue;
    const colors = mesh.geometry.attributes.color, original = mesh.userData.originalColors;
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, Math.min(1, original[i * 3] * ratio[0]), Math.min(1, original[i * 3 + 1] * ratio[1]), Math.min(1, original[i * 3 + 2] * ratio[2]));
    colors.needsUpdate = true;
  }
}

function surface(model) {
  for (const mesh of [...model.meshes,...(model.appearance?.meshes||[])]) mesh.material = state.surface === 'uv' && model.version !== 'v0' ? checkerMaterial : mesh.userData.paintMaterial;
  for (const outline of model.outlines) outline.visible = state.surface === 'paint';
}

async function load(kind) {
  appearanceRevision++;
  const version = state.version, mobile = matchMedia('(max-width: 600px)').matches, quality = version !== 'v0' ? mobile ? 512 : 1024 : 0;
  const key = `${version}:${kind}:${quality}`, sequence = ++loadSequence;
  const assetUrl = `/docs/art/source/characters-base-${version}/${kind}-base-${version}${quality === 512 ? '-mobile' : ''}.glb`;
  state.loaded = false; state.body = kind; status.textContent = 'Cargando base…';
  document.querySelector('#download').removeAttribute('href');
  document.querySelector('#download-appearance').disabled=true;
  try {
    if (!loaded.has(key) && !pending.has(key)) pending.set(key, (async () => {
      const gltf = await loader.loadAsync(assetUrl);
      const bones = {}, rests = {}, meshes = [], outlines = [];
      gltf.scene.traverse((object) => {
        if (object.isBone) { bones[object.name] = object; rests[object.name] = object.position.clone(); }
        if (object.isMesh) {
          const original = object.material;
          const material = version !== 'v0' ? new THREE.MeshToonMaterial({ map: original.map, color: original.color, vertexColors: true, gradientMap: version==='v3'?softBandMap:bandMap, side: original.side }) : original.clone();
          material.vertexColors = true; object.material = material;
          object.userData.paintMaterial = material;
          object.userData.pbrMaterial = original;
          object.castShadow = object.receiveShadow = true;
          object.frustumCulled = false;
          object.userData.originalColors = object.geometry.attributes.color.array.slice();
          meshes.push(object);
        }
      });
      if (version !== 'v0') for (const mesh of meshes) {
        if (mesh.name === 'eyes_base') continue;
        const ink = new THREE.MeshBasicMaterial({ color: 0x4b3b31, side: THREE.BackSide });
        ink.onBeforeCompile = (shader) => { shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.0013;'); };
        ink.customProgramCacheKey = () => 'character-lab-ink-v1';
        const outline = new THREE.SkinnedMesh(mesh.geometry, ink);
        outline.name = mesh.name + '_outline'; outline.frustumCulled = false;
        outline.position.copy(mesh.position); outline.quaternion.copy(mesh.quaternion); outline.scale.copy(mesh.scale);
        outline.bind(mesh.skeleton, mesh.bindMatrix); mesh.parent.add(outline); outlines.push(outline);
      }
      const box = new THREE.Box3().setFromObject(gltf.scene);
      gltf.scene.position.y = -box.min.y;
      loaded.set(key, { root: gltf.scene, bones, rests, meshes, outlines, kind, version, quality, assetUrl, height: box.max.y - box.min.y });
    })().finally(() => pending.delete(key)));
    if (pending.has(key)) await pending.get(key);
    // A slow earlier request must not replace the latest body selection.
    if (sequence !== loadSequence) return;
    if (active) scene.remove(active.root);
    active = loaded.get(key); scene.add(active.root); paint(active); updateAppearance(); surface(active); pose(0); look(state.view);
    state.loaded = true;
    document.querySelector('#download-appearance').disabled=!(state.version==='v3'&&state.customize)||exportPending;
    document.querySelector('#model-label').textContent = kind === 'male' ? 'BASE MASCULINA' : 'BASE FEMENINA';
    document.querySelector('.stage-version').textContent = version==='v3'&&state.customize?'P03a / APARIENCIA':{v0:'V0 / BASE',v1:'V1 / ANATOMÍA',v2:'V2 / SUPERFICIE',v3:'V3 / ROSTRO Y MANOS'}[version];
    document.querySelector('#surface-controls').hidden = version === 'v0';
    document.querySelector('#download').href = assetUrl;
    describeModel();
    status.classList.remove('error');
  } catch (error) {
    if (sequence !== loadSequence) return;
    state.errors.push(error.message); status.classList.add('error');
    status.textContent = 'No pudimos cargar esta base. Comprueba los archivos GLB.';
  }
}

function describeModel() {
  if(!active)return;
  const meshes=visibleMeshes(active),triangles=meshes.reduce((n,mesh)=>n+mesh.geometry.index.count/3,0);
  status.textContent=`${triangles.toLocaleString('es-MX')} triángulos · ${meshes.length} piezas · 15 huesos${active.quality?' · mapas '+active.quality:''}`;
}
function updateAppearance() {
  appearanceRevision++;
  const supported=state.version==='v3';
  document.body.classList.toggle('is-customizing',supported&&state.customize);
  document.querySelector('.badge').textContent=supported&&state.customize?'ESTUDIO P03a / APARIENCIA':'ESTUDIO 01 / BASES';
  document.querySelector('#appearance-mode').hidden=!supported;
  document.querySelector('#appearance-controls').hidden=!(supported&&state.customize);
  for(const button of document.querySelectorAll('[data-customize]'))button.setAttribute('aria-pressed',String((button.dataset.customize==='true')===state.customize));
  syncAppearanceControls(state.appearance);
  if(active){if(supported&&state.customize)applyAppearance(active,state.appearance,softBandMap);else removeAppearance(active);surface(active);}
  if(active)document.querySelector('.stage-version').textContent=supported&&state.customize?'P03a / APARIENCIA':{v0:'V0 / BASE',v1:'V1 / ANATOMÍA',v2:'V2 / SUPERFICIE',v3:'V3 / ROSTRO Y MANOS'}[state.version];
  document.querySelector('#download-appearance').disabled=!(state.loaded&&supported&&state.customize)||exportPending;
}

function pose(t) {
  if (!active) return;
  const b = active.bones;
  for (const [name, bone] of Object.entries(b)) { bone.rotation.set(0, 0, 0); bone.position.copy(active.rests[name]); }
  if (state.pose === 'a') { b.armL.rotation.z = .43; b.armR.rotation.z = -.43; }
  if (state.pose === 'idle') { b.spine.rotation.x = Math.sin(t * 2) * .015; b.head.rotation.y = Math.sin(t * .8) * .055; }
  if (state.pose === 'run') {
    const wave = Math.sin(t * 8);
    b.hips.position.y += .022 * Math.abs(wave); b.spine.rotation.x = .10;
    b.thighL.rotation.x = wave * .65; b.thighR.rotation.x = -wave * .65;
    b.shinL.rotation.x = Math.max(0, -wave) * .85; b.shinR.rotation.x = Math.max(0, wave) * .85;
    b.armL.rotation.x = -wave * .55; b.armR.rotation.x = wave * .55;
    b.armL.rotation.z = .09; b.armR.rotation.z = -.09;
    b.foreL.rotation.x = b.foreR.rotation.x = -.38;
    b.chest.rotation.y = wave * .035;
  }
  if (state.pose === 'joints') {
    b.armL.rotation.z = 1.2; b.foreL.rotation.x = -1.1;
    b.armR.rotation.x = -.5; b.foreR.rotation.x = -.9;
    b.thighR.rotation.x = -.5; b.shinR.rotation.x = .9;
    b.chest.rotation.y = .15; b.head.rotation.y = -.2;
  }
  active.root.updateMatrixWorld(true);
  for (const mesh of active.meshes) mesh.skeleton.update();
}

document.querySelector('#bodies').addEventListener('click', (event) => {
  const button = event.target.closest('[data-body]'); if (!button) return;
  for (const item of document.querySelectorAll('[data-body]')) item.setAttribute('aria-pressed', String(item === button));
  load(button.dataset.body);
});
for (const button of document.querySelectorAll('[data-version]')) button.setAttribute('aria-pressed', String(button.dataset.version === initialVersion));
document.querySelector('#versions').addEventListener('click', (event) => {
  const button = event.target.closest('[data-version]'); if (!button) return;
  state.version = button.dataset.version;
  for (const item of document.querySelectorAll('[data-version]')) item.setAttribute('aria-pressed', String(item === button));
  load(state.body);
});
mountAppearanceControls((key,id)=>{
  state.appearance=normalizeAppearance({...state.appearance,[key]:id});
  updateAppearance();pose(state.time);describeModel();
});
document.querySelector('#appearance-mode').addEventListener('click',event=>{
  const button=event.target.closest('[data-customize]');if(!button)return;
  state.customize=button.dataset.customize==='true';updateAppearance();pose(state.time);describeModel();
});
document.querySelector('#reset-appearance').addEventListener('click',()=>{
  state.appearance=normalizeAppearance(DEFAULT_APPEARANCE);updateAppearance();pose(state.time);describeModel();
});
document.querySelector('#download-appearance').addEventListener('click',async()=>{
  if(exportPending||!state.loaded||!active?.appearance)return;
  const revision=appearanceRevision,model=active,button=document.querySelector('#download-appearance');
  exportPending=true;button.disabled=true;button.textContent='Preparando descarga…';
  try{
    const bytes=await exportAppearance(model,state.color);
    if(!state.loaded||state.body!==model.kind||state.version!==model.version||revision!==appearanceRevision||model!==active){status.textContent='La apariencia cambió. Vuelve a descargar el personaje.';return;}
    const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`${model.kind}-appearance-${state.appearance.hairId}-${state.appearance.beardId}.glb`;
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){state.errors.push(error.message);status.textContent='No pudimos preparar la descarga. Inténtalo de nuevo.';}
  finally{exportPending=false;button.textContent='Descargar personaje GLB ↓';button.disabled=!(state.loaded&&state.version==='v3'&&state.customize);}
});
document.querySelector('#surfaces').addEventListener('click', (event) => {
  const button = event.target.closest('[data-surface]'); if (!button) return;
  state.surface = button.dataset.surface;
  for (const item of document.querySelectorAll('[data-surface]')) item.setAttribute('aria-pressed', String(item === button));
  if (active) surface(active);
});
matchMedia('(max-width: 600px)').addEventListener('change', () => { if (state.version !== 'v0') load(state.body); });
document.querySelector('#poses').addEventListener('click', (event) => {
  const button = event.target.closest('[data-pose]'); if (!button) return;
  state.pose = button.dataset.pose;
  for (const item of document.querySelectorAll('[data-pose]')) item.setAttribute('aria-pressed', String(item === button));
});
document.querySelector('#palettes').addEventListener('click', (event) => {
  const button = event.target.closest('[data-color]'); if (!button) return;
  state.color = button.dataset.color;
  appearanceRevision++;
  for (const item of document.querySelectorAll('[data-color]')) item.setAttribute('aria-pressed', String(item === button));
  for (const model of loaded.values()) paint(model);
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => look(button.dataset.view));
const reference = document.querySelector('#reference');
document.querySelector('#concept').addEventListener('click', () => {
  document.querySelector('#reference-title').textContent = state.body === 'male' ? 'Base masculina · dirección artística' : 'Base femenina · dirección artística';
  document.querySelector('#reference-image').src = folder + state.body + '-concept-v1.png';
  document.querySelector('#reference-image').alt = 'Referencia pintada del personaje con vistas frontal, lateral, trasera y rostro';
  reference.showModal();
});
document.querySelector('#head-guide').addEventListener('click', () => {
  document.querySelector('#reference-title').textContent = 'Cabezas neutras · guía artística';
  const image=document.querySelector('#reference-image');
  image.src='/docs/art/source/characters-base-v3/head-style-guide-v1.png';
  image.alt='Guía pintada de las cabezas masculina y femenina, sobre fondo transparente';
  reference.showModal();
});
document.querySelector('#close-reference').addEventListener('click', () => reference.close());

window.__characterLab = { state, renderer, camera, controls, scene, loaded, get active() { return active; },
  sample(t) { pose(t); renderer.render(scene, camera); }, look, updateAppearance, visibleMeshes,
  exportCurrent() { return exportAppearance(active,state.color); } };
const clock = new THREE.Clock();
function tick() { requestAnimationFrame(tick); state.time += Math.min(clock.getDelta(), .05); pose(state.time); controls.update(); renderer.render(scene, camera); }
look('front'); resize(); tick(); load('male');

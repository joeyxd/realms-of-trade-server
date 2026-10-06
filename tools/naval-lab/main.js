// Isolated local laboratory: no World, LocalServer, profile, storage, Worker or WebSocket.
import * as THREE from 'three';
import { assets } from '../../src/render/assets/registry.js';
import { RaftLayer } from '../../src/render/rafts.js';
import { Pipeline, LAYER } from '../../src/render/pipeline.js';
import { createWater } from '../../src/render/water.js';
import { createSky, SKY } from '../../src/render/sky.js';
import { U } from '../../src/render/toon.js';
import { buildNavalRig, newNavalState, stepNaval, navalPose, windEfficiency, jettisonLabCargo, NAVAL_STEP } from '../../src/sim/naval/handling.js';
import { LAB_FIXTURES, LAB_WINDS, labFixture } from './fixtures.js';
import { measureHandling } from './measure.js';
import { NavalLabInput } from './input.js';
import { NavalLabClock } from './clock.js';

const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('mobile') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = new NavalLabClock();
let fixture, rig, state = newNavalState(), previous = state, wind = LAB_WINDS[0], paused = false, raf = 0;
let layer, renderer, pipeline, input, scene, camera, cargoGroup, sun, sea, bottom;
const samples = [], target = new THREE.Vector3(), desired = new THREE.Vector3();
const trailArray = new Float32Array(256 * 3), trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailArray, 3));
trailGeometry.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xffd143, transparent: true, opacity: 0.6, depthTest: false }));
trail.layers.set(LAYER.FX); trail.frustumCulled = false;
const references = new THREE.Group();
const grid = new THREE.GridHelper(120, 24, 0x81c6c8, 0x39767f);
grid.position.y = 0.025; grid.layers.set(LAYER.FX); grid.material.transparent = true; grid.material.opacity = 0.22;
references.add(grid);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 20), new THREE.MeshBasicMaterial({ color: 0xffd143, side: THREE.DoubleSide, depthTest: false }));
marker.rotation.x = -Math.PI / 2; marker.layers.set(LAYER.FX); references.add(marker);

function showMessage(text) { $('message').textContent = text; }
function clearInputs() {
  input?.clear();
  for (const button of document.querySelectorAll('[data-pilot]')) button.classList.remove('active');
}
function rebuildCargo() {
  if (cargoGroup) {
    cargoGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(cargoGroup);
  }
  cargoGroup = new THREE.Group();
  for (const c of fixture.cargo) {
    const size = Math.min(1.3, 0.55 + Math.cbrt(c.mass) * 0.12);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color: 0xffd143, wireframe: true, transparent: true, opacity: 0.85, depthTest: false }));
    mesh.position.set(c.x, c.height + 0.72, c.z); mesh.layers.set(LAYER.FX); cargoGroup.add(mesh);
  }
  scene.add(cargoGroup);
  $('jettison').disabled = !fixture.cargo.length;
}
function stats() {
  $('mass').textContent = `${rig.dryMass} / ${rig.cargoMass}`;
  $('load').textContent = `${rig.mass} / ${rig.buoyancy} · ${(rig.load * 100).toFixed(0)}%`;
  $('inertia').textContent = rig.inertia.toFixed(0);
  $('balance').textContent = `${(rig.imbalance * 100).toFixed(0)}% / ${rig.height.toFixed(1)} u`;
  $('warning').textContent = rig.load > 1 ? 'Sobrecarga: poco empuje y peor respuesta.' : rig.height > 1 || rig.imbalance > 0.3 ? 'Lastre alto o a un lado: menor autoridad del timón.' : '';
}
function comparisons() {
  $('compare').replaceChildren();
  for (const f of LAB_FIXTURES) {
    const m = measureHandling(f, wind), tr = document.createElement('tr');
    tr.classList.toggle('selected', f.id === fixture.id && fixture.cargo.length === f.cargo.length);
    for (const text of [f.name, `${m.acceleration.speed.toFixed(2)}`, `${m.braking.seconds.toFixed(2)} s`, m.turning.reached ? `${m.turning.seconds.toFixed(2)} s` : '>60 s']) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    tr.title = `Freno: ${m.braking.distance.toFixed(2)} u; recorrido al girar: ${m.turning.distance.toFixed(2)} u`;
    $('compare').append(tr);
  }
}
function reset() {
  if (!scene) return;
  clearInputs(); clock.clear(); samples.length = 0; trailGeometry.setDrawRange(0, 0);
  fixture = labFixture($('fixture').value); rig = buildNavalRig(fixture.parts, fixture.cargo);
  state = newNavalState(); previous = { ...state }; target.set(0, 0, 0);
  $('fixture-detail').textContent = fixture.detail; rebuildCargo(); stats(); comparisons();
  showMessage(paused ? 'En pausa. Pulsa Continuar para pilotar.' : 'Mantén AVANZAR y prueba el giro. Suelta para sentir la inercia.');
  $('bay').focus({ preventScroll: true });
}
function jettison() {
  if (!fixture?.cargo.length) return;
  const next = jettisonLabCargo(fixture, state);
  fixture = next.fixture; state = next.state; previous = { ...state }; rig = buildNavalRig(fixture.parts, fixture.cargo);
  rebuildCargo(); stats(); comparisons(); showMessage('Lastre soltado. El casco mantiene su posición y su movimiento.');
}
function setPaused(value) {
  paused = value; clock.clear(); clearInputs(); previous = { ...state };
  $('pause').textContent = paused ? 'Continuar' : 'Pausar';
  showMessage(paused ? 'En pausa. Pulsa Continuar para pilotar.' : 'Timón listo. Mantén AVANZAR.');
}
function drawFrame(dt) {
  const a = paused ? 1 : clock.alpha;
  const yawDelta = Math.atan2(Math.sin(state.yaw - previous.yaw), Math.cos(state.yaw - previous.yaw));
  const visual = { ...state, x: THREE.MathUtils.lerp(previous.x, state.x, a), z: THREE.MathUtils.lerp(previous.z, state.z, a), yaw: previous.yaw + yawDelta * a };
  const t = (state.tick - 1 + a) * NAVAL_STEP, pose = navalPose(visual, rig);
  if (layer.update([{ id: 'lab-raft', owner: 1, entity: 1, rev: 1, parts: fixture.parts, look: { banner: 'franjas', paint: 0 }, ...pose }], Math.max(0, t), 1)) pipeline.markDirty();
  const view = layer.views.get('lab-raft');
  // Only the visual skin heels; there is no walking collider or crew in this lab.
  if (view && !reducedMotion) view.visual.rotation.z += THREE.MathUtils.clamp(-state.omega * Math.hypot(state.vx, state.vz) * 0.014, -0.05, 0.05);
  cargoGroup.position.set(pose.x, pose.y - 0.72, pose.z); cargoGroup.rotation.y = pose.yaw;
  cargoGroup.visible = references.visible;
  marker.position.set(visual.x, pose.y + 0.1, visual.z);
  grid.position.x = Math.round(visual.x / 20) * 20; grid.position.z = Math.round(visual.z / 20) * 20;
  const damping = 1 - Math.exp(-8 * dt);
  desired.set(visual.x + visual.vx * 0.65, 0, visual.z + visual.vz * 0.65); target.lerp(desired, damping);
  const distance = fixture.id === 'house' ? 35 : 24;
  camera.position.set(target.x + distance, distance * 1.1, target.z + distance);
  camera.lookAt(target.x, 0, target.z);
  // Keep the flat laboratory ocean under the camera, without changing simulated world coordinates.
  sea.position.x = bottom.position.x = visual.x; sea.position.z = bottom.position.z = visual.z;
  sun.position.set(visual.x - 25, 45, visual.z + 15); sun.target.position.set(visual.x, 0, visual.z);
  const sky = scene.getObjectByName('lab-sky'); sky.position.copy(camera.position);
  U.mnTime.value = Math.max(0, t); U.mnWind.value.set(Math.sin(wind.yaw) * wind.strength, Math.cos(wind.yaw) * wind.strength);
  pipeline.update(dt); pipeline.render();
  $('speed').textContent = Math.hypot(state.vx, state.vz).toFixed(2);
  $('heading').textContent = `Rumbo ${String(Math.round((state.yaw * 180 / Math.PI + 360) % 360)).padStart(3, '0')}° · giro ${(state.omega * 180 / Math.PI).toFixed(1)}°/s`;
  $('sail').textContent = wind.strength ? `Empuje de vela ${(windEfficiency(state.yaw, wind) * 100).toFixed(0)}%` : 'Calma · remo asistido';
  $('wind-arrow').textContent = wind.id === 'calm' ? '○' : wind.id === 'tail' ? '↓' : wind.id === 'head' ? '↑' : '→';
}
function fixed() {
  previous = state; const control = input.poll(); state = stepNaval(state, control, rig, wind);
  for (const button of document.querySelectorAll('[data-pilot]')) {
    const action = button.dataset.pilot;
    button.classList.toggle('active', action === 'throttle' ? control.throttle > 0 : action === 'brake' ? control.brake > 0 : action === 'left' ? control.steer < 0 : control.steer > 0);
  }
  if (state.tick % 6 === 0) {
    samples.push([state.x, 0.045, state.z]); if (samples.length > 256) samples.shift();
    samples.forEach((p, n) => trailArray.set(p, n * 3));
    trailGeometry.attributes.position.needsUpdate = true; trailGeometry.setDrawRange(0, samples.length);
  }
}
function resize() { const rect = $('bay').getBoundingClientRect(); pipeline.resize(Math.max(1, rect.width), Math.max(1, rect.height)); }

async function start() {
  for (const f of LAB_FIXTURES) $('fixture').add(new Option(f.name, f.id));
  for (const w of LAB_WINDS) $('wind').add(new Option(w.name, w.id));
  // Existing manifest selects exactly one 1024/512 atlas. Failed loads keep procedural materials.
  await assets.load('/assets/manifest.json', { mobileTextures: mobile, timeoutMs: 8000 });
  renderer = new THREE.WebGLRenderer({ canvas: $('bay'), antialias: false, powerPreference: mobile ? 'low-power' : 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x9ad8e3, 110, 260);
  camera = new THREE.PerspectiveCamera(35, 1, 0.5, 1400);
  scene.add(new THREE.HemisphereLight(0xe2f6ff, 0x546784, 2));
  sun = new THREE.DirectionalLight(0xffedc8, 2.4); sun.position.set(-25, 45, 15);
  sun.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 120 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; scene.add(sun, sun.target);
  SKY.sunDir.value.set(-25, 45, 15).normalize();
  const sky = createSky(); sky.name = 'lab-sky'; sky.layers.set(LAYER.NO_OUTLINE); scene.add(sky);
  const heightTex = new THREE.DataTexture(new Float32Array([-8]), 1, 1, THREE.RedFormat, THREE.FloatType); heightTex.needsUpdate = true;
  sea = createWater({ size: 2e9 }, heightTex); sea.layers.set(LAYER.WATER); scene.add(sea);
  bottom = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: 0x17486b }));
  // The water SSR pass needs seabed depth from the normal pass, which only includes WORLD.
  bottom.rotation.x = -Math.PI / 2; bottom.position.y = -8; bottom.layers.set(LAYER.WORLD); scene.add(bottom);
  pipeline = new Pipeline(renderer, scene, camera); pipeline.water = { setMode: (ssr) => sea.userData.setMode(ssr) };
  pipeline.grading.contrast = 0.1; pipeline.grading.sat = 1.13;
  U.mnOccOn.value = 0; U.mnNearFade.value = 0; U.mnCloud.value = 0.15;
  $('light').checked = mobile;
  const quality = () => {
    renderer.shadowMap.enabled = sun.castShadow = !$('light').checked;
    pipeline.setQuality({ outlines: !$('light').checked, comic: 0, pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5), ss: 1, fxaa: true });
  };
  quality(); layer = new RaftLayer(scene, { dock: null });
  scene.add(references, trail);
  input = new NavalLabInput(document, { onReset: reset, onJettison: jettison });
  $('fixture').addEventListener('change', reset);
  $('wind').addEventListener('change', () => { wind = LAB_WINDS.find((w) => w.id === $('wind').value); comparisons(); clearInputs(); $('bay').focus({ preventScroll: true }); showMessage('Viento cambiado; tu velocidad se conserva.'); });
  $('reset').addEventListener('click', reset); $('jettison').addEventListener('click', jettison);
  $('pause').addEventListener('click', () => setPaused(!paused));
  $('references').addEventListener('change', () => { references.visible = trail.visible = $('references').checked; });
  $('light').addEventListener('change', quality);
  window.addEventListener('blur', () => setPaused(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', resize); reset(); resize();
  const tex = assets.list().find((e) => e.id === 'tex:raft-comic-v1');
  const image = assets.texture('tex:raft-comic-v1')?.image;
  $('texture').textContent = tex?.state === 'ok' ? `Atlas ${image?.width || '?'} × ${image?.height || '?'} · ${tex.selectedSrc}` : 'Atlas no disponible: material procedural activo.';
  // Read-only snapshots and explicit laboratory actions aid repeatable local acceptance.
  window.__navalLab = { snapshot: () => ({ fixture: structuredClone(fixture), rig: { ...rig }, state: { ...state }, wind: { ...wind }, paused, droppedSeconds: clock.dropped, textures: assets.list(), samples: samples.length }), reset, jettison, setPaused };
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.max(0, (now - last) / 1000); last = now;
    try { if (!paused && !document.hidden) clock.advance(dt, fixed); drawFrame(Math.min(dt, 0.25)); }
    catch (error) { setPaused(true); showMessage(`Prueba detenida: ${error.message}`); console.error(error); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); input.dispose(); layer.dispose(); renderer.dispose(); });
}
start().catch((error) => { showMessage(`No se pudo abrir la bahía: ${error.message}`); console.error(error); });

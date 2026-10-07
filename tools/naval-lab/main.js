// Isolated local laboratory: no World, LocalServer, profile, storage, Worker or WebSocket.
import * as THREE from 'three';
import { assets } from '../../src/render/assets/registry.js';
import { RaftLayer } from '../../src/render/rafts.js';
import { Pipeline, LAYER } from '../../src/render/pipeline.js';
import { createWater } from '../../src/render/water.js';
import { createSky, SKY } from '../../src/render/sky.js';
import { U } from '../../src/render/toon.js';
import { buildNavalRig, newNavalState, stepNaval, navalPose, NAVAL_STEP } from '../../src/sim/naval/handling.js';
import { RAFT_PARTS } from '../../src/data/raftparts.js';
import { createNavalStructure, applyPartDamage, hullIntegrity, hitHullAt } from '../../src/sim/naval/structure.js';
import { operationalNavalRig, rebaseNavalState } from '../../src/sim/naval/operational.js';
import { resolveNavalContact } from '../../src/sim/naval/contact.js';
import { LAB_FIXTURES, LAB_WINDS, labFixture } from './fixtures.js';
import { measureHandling } from './measure.js';
import { NavalLabInput } from './input.js';
import { NavalLabClock } from './clock.js';
import { currentAt, gustAt, newSailingActivity, stepSailingActivity, sailingEnvironment } from '../../src/sim/naval/navigation.js';
import { NavalLabEffects } from './effects.js';
import { NavalLabAudio } from './audio.js';
import { NavalSpeedFeel } from './speed-feel.js';
import { NavalLabCamera } from './camera.js';
import { configureNavalReferenceLook } from './look.js';
import { NavalLabScenery, NAVAL_COAST } from './scenery.js';
import { loadNavalRaftSkin } from './raft-skin.js';
import { NavalLabHud } from './hud.js';

const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('mobile') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = new NavalLabClock();
let fixture, rig, state = newNavalState(), previous = state, wind = LAB_WINDS[0], paused = false, raf = 0, bayHeight = 1;
let structure, body, structureGeneration = 0, lastDamage = '';
let layer, renderer, pipeline, input, scene, camera, cargoGroup, sun, sea, bottom;
let effects, sound, feel, framing, scenery, raftSkin, hud, activity = newSailingActivity(), soundEnabled = false, soundOptOut = false;
let lastGustPhase = 'idle', lastGustId = -1;
const samples = [];
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
function updateHud() {
  if (!hud || !fixture || !rig) return;
  hud.update({ state, rig, wind, activity, paused: paused || body.disabled, cargoCount: fixture.cargo.length,
    gusts: $('gusts').checked && rig.sail > 0 && !body.disabled, currents: $('currents').checked,
    gust: gustAt(state.tick, wind, $('gusts').checked && rig.sail > 0 && !body.disabled),
    current: currentAt(state.x, state.z, $('currents').checked) });
  if (rig.sail === 0) hud.text('sail', 'Sin vela · remo asistido');
  if (body.disabled) {
    hud.text('sail', 'Sin flotación');
    hud.text('capture-status', 'Casco inutilizado · reinicia la prueba');
    hud.text('hud-load', `Sin flotación · lastre ${fixture.cargo.reduce((n, p) => n + p.mass, 0)}`);
    $('jettison-hud').disabled = true;
  }
  $('jettison').disabled = body.disabled || !fixture.cargo.length;
  for (const button of document.querySelectorAll('[data-pilot]')) button.disabled = body.disabled;
}

function selectedBlock() {
  return structure.entries.find((p) => p.id === $('damage-target').value);
}
function structureReadout() {
  const health = hullIntegrity(structure), destroyed = structure.entries.filter((p) => p.hp === 0).length;
  $('hull-readout').textContent = `CASCO ${health.hp.toFixed(0)} / ${health.maxHp}`;
  $('hull-health').setAttribute('aria-valuenow', String(Math.round(health.fraction * 100)));
  $('hull-health').setAttribute('aria-valuetext', `${health.hp.toFixed(0)} de ${health.maxHp} HP de casco`);
  $('hull-health').dataset.critical = String(health.fraction < 0.3);
  $('hull-fill').style.width = `${health.fraction * 100}%`;
  $('damage-status').textContent = `${destroyed} / ${structure.entries.length} bloques destruidos. ${body.disabled ? 'Sin flotación. ' : ''}${lastDamage}`;
  const selected = selectedBlock();
  $('part-hit').disabled = !selected || selected.hp === 0;
  $('block-health').textContent = selected ? `${selected.hp} / ${selected.maxHp} HP${selected.hp === 0 ? ' · destruido' : ''}` : '';
}
function installDamage(result) {
  if (!result.event) return false;
  structure = result.structure;
  body = operationalNavalRig(structure, fixture.cargo);
  if (body.rig) {
    if (rig.sail > 0 && body.rig.sail === 0) activity = newSailingActivity();
    state = rebaseNavalState(state, rig, body.rig); rig = body.rig;
  }
  else { state = { ...state, vx: 0, vz: 0, omega: 0 }; activity = newSailingActivity(); clearInputs(); }
  previous = { ...state };
  const hit = result.event;
  lastDamage = `${RAFT_PARTS[hit.type].name}: −${hit.damage.toFixed(0)} HP${hit.destroyed ? ', destruido' : ''}.`;
  effects.event(hit.destroyed ? 'destroy' : 'impact', state, rig);
  sound.event('impact');
  stats(); structureReadout(); updateHud();
  return true;
}
function hitSelectedBlock() {
  const block = selectedBlock();
  if (block) installDamage(applyPartDamage(structure, block.id, 40));
}
function nearCoast() {
  reset();
  $('coast-collisions').checked = true;
  const rock = NAVAL_COAST[0], radius = Math.hypot(rig.beam, rig.length) / 2;
  state = { ...state, x: rock.x + rig.cx - rig.hullCx,
    z: rock.z - rock.radius - radius - 8 + rig.cz - rig.hullCz };
  previous = { ...state }; framing.reset();
  showMessage('Roca enfrente. Avanza para probar el choque o gira para rozarla.');
  setSailingView(true);
}
function clearInputs() {
  input?.clear();
  for (const button of document.querySelectorAll('[data-pilot]')) button.classList.remove('active');
}
function setSailingView(sailing) {
  clearInputs();
  document.body.classList.toggle('sailing-view', sailing);
  $('lab-settings').inert = sailing;
  $('lab-toggle').textContent = sailing ? 'Ajustes' : 'Volver al mar';
  $('lab-toggle').setAttribute('aria-expanded', String(!sailing));
  if (pipeline && camera) resize();
  if (sailing) {
    window.scrollTo(0, 0);
    $('bay').focus({ preventScroll: true });
  } else {
    const exit = $('return-to-sea');
    exit.focus({ preventScroll: true });
    const stacked = $('lab-settings').getBoundingClientRect().top >= $('bay').parentElement.getBoundingClientRect().bottom - 1;
    if (stacked || exit.getBoundingClientRect().top >= innerHeight) exit.scrollIntoView({ block: 'start' });
  }
}
function updateSkinReadout() {
  const skin = raftSkin.diagnostics(), active = $('material').value === 'author';
  const tex = assets.list().find((e) => e.id === 'tex:raft-comic-v1');
  const image = assets.texture('tex:raft-comic-v1')?.image;
  const base = tex?.state === 'ok' ? `Atlas base ${image?.width} × ${image?.height}` : 'Atlas base no disponible';
  $('texture').textContent = active && skin.albedo
    ? `Madera del autor ${skin.albedo.width} × ${skin.albedo.height} · ${skin.relief === 'flat' ? 'acabado pintado' : 'relieve suave'}. ${base} para cuerda, hierro y lona.`
    : `${base} · ${active ? 'madera del autor no disponible; material anterior activo' : 'comparación original'}.`;
  $('relief').disabled = !active || !skin.normal;
}
function changeSkin() {
  clearInputs(); layer.dispose();
  layer = new RaftLayer(scene, { dock: null, surfaceSkin: $('material').value === 'author' ? raftSkin : null });
  pipeline.markDirty(); updateSkinReadout(); $('bay').focus({ preventScroll: true });
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
  $('mass').textContent = `${body.parts.reduce((n, p) => n + RAFT_PARTS[p[0]].weight, 0)} / ${fixture.cargo.reduce((n, p) => n + p.mass, 0)}`;
  $('load').textContent = body.disabled ? 'Sin flotación' : `${rig.mass} / ${rig.buoyancy} · ${(rig.load * 100).toFixed(0)}%`;
  $('inertia').textContent = body.disabled ? '—' : rig.inertia.toFixed(0);
  $('balance').textContent = body.disabled ? '—' : `${(rig.imbalance * 100).toFixed(0)}% / ${rig.height.toFixed(1)} u`;
  $('warning').textContent = body.disabled ? 'Casco inutilizado. Reinicia este ensayo para volver a navegar.' : rig.load > 1 ? 'Sobrecarga: poco empuje y peor respuesta.' : rig.height > 1 || rig.imbalance > 0.3 ? 'Lastre alto o a un lado: menor autoridad del timón.' : '';
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
  structure = createNavalStructure(fixture.parts.map((part, n) => ({ id: `lab:${structureGeneration + 1}:${n + 1}`, part })));
  structureGeneration++; body = operationalNavalRig(structure, fixture.cargo); lastDamage = '';
  $('damage-target').replaceChildren(...structure.entries.map((p) => new Option(
    `${RAFT_PARTS[p.part[0]].name} · ${p.part[1]}, ${p.part[2]} · nivel ${p.part[3]}`, p.id)));
  state = newNavalState(); previous = { ...state }; framing?.reset(); scenery?.reset();
  activity = newSailingActivity(); lastGustPhase = 'idle'; lastGustId = -1; effects?.reset(); feel?.reset();
  $('fixture-detail').textContent = fixture.detail; rebuildCargo(); stats(); comparisons();
  structureReadout();
  updateHud();
  showMessage(paused ? 'En pausa. Pulsa Continuar para pilotar.' : 'Entra en las flechas de agua. Cuando llegue la ráfaga, cázala con ESPACIO.');
  $('bay').focus({ preventScroll: true });
}
function jettison() {
  if (!fixture?.cargo.length || body.disabled) return;
  fixture = { ...fixture, cargo: [] };
  body = operationalNavalRig(structure, fixture.cargo);
  if (body.rig) { state = rebaseNavalState(state, rig, body.rig); rig = body.rig; }
  previous = { ...state };
  rebuildCargo(); stats(); comparisons(); showMessage('Lastre soltado. El casco mantiene su posición y su movimiento.');
  updateHud();
}
function setPaused(value) {
  paused = value; clock.clear(); clearInputs(); previous = { ...state };
  $('pause').textContent = paused ? 'Continuar' : 'Pausar';
  $('pause-nav').textContent = paused ? 'Continuar' : 'Pausar';
  sound?.update({ state, rig, paused: true });
  updateHud();
  showMessage(paused ? 'En pausa. Pulsa Continuar para pilotar.' : 'Timón listo. Mantén AVANZAR.');
  if (!paused) $('bay').focus({ preventScroll: true });
}
function unlockSound() {
  if (soundOptOut || soundEnabled) return;
  soundEnabled = true; sound.setEnabled(true);
  Promise.resolve(sound.unlock()).then((ready) => {
    if (ready === false) { soundEnabled = false; sound.setEnabled(false); $('sound').textContent = 'Activar sonido'; $('sound').setAttribute('aria-pressed', 'false'); }
  }).catch(() => { soundEnabled = false; sound.setEnabled(false); $('sound').textContent = 'Activar sonido'; $('sound').setAttribute('aria-pressed', 'false'); });
  $('sound').textContent = 'Silenciar sonido';
  $('sound').setAttribute('aria-pressed', 'true');
}
function drawFrame(dt) {
  const a = paused ? 1 : clock.alpha;
  const yawDelta = Math.atan2(Math.sin(state.yaw - previous.yaw), Math.cos(state.yaw - previous.yaw));
  const visual = { ...state, x: THREE.MathUtils.lerp(previous.x, state.x, a), z: THREE.MathUtils.lerp(previous.z, state.z, a), yaw: previous.yaw + yawDelta * a };
  const t = (state.tick - 1 + a) * NAVAL_STEP, pose = navalPose(visual, rig);
  if (layer.update([{ id: 'lab-raft', owner: 1, entity: 1, rev: 1, parts: body.parts, look: { banner: 'franjas', paint: 0 }, ...pose }], Math.max(0, t), 1)) pipeline.markDirty();
  const view = layer.views.get('lab-raft');
  // Only the visual skin heels; there is no walking collider or crew in this lab.
  const boosting = state.tick < activity.boostUntil;
  if (view && !reducedMotion) {
    view.visual.rotation.z += THREE.MathUtils.clamp(-state.omega * Math.hypot(state.vx, state.vz) * 0.035, -0.2, 0.2);
    view.visual.rotation.x += boosting ? -Math.sin(Math.min(1, (activity.boostUntil - state.tick) / 30) * Math.PI / 2) * 0.065 : 0;
  }
  if (view) for (const mesh of view.visual.children) {
    if (mesh.userData.raftSurface !== 'cloth') continue;
    const positions = mesh.geometry.attributes.position;
    const base = mesh.userData.labClothBase ||= positions.array.slice();
    const fullness = boosting ? 0.23 : 0.065;
    for (let i = 0; i < positions.count; i++) {
      const y = base[i * 3 + 1];
      positions.array[i * 3 + 2] = base[i * 3 + 2] + Math.sin(y * 1.6 + (reducedMotion ? 0 : t * 4)) * fullness * Math.min(1, Math.max(0, y - 0.5));
    }
    positions.needsUpdate = true;
  }
  cargoGroup.position.set(pose.x, pose.y - 0.72, pose.z); cargoGroup.rotation.y = pose.yaw;
  cargoGroup.visible = references.visible;
  marker.position.set(visual.x, pose.y + 0.1, visual.z);
  grid.position.x = Math.round(visual.x / 20) * 20; grid.position.z = Math.round(visual.z / 20) * 20;
  const speed = Math.hypot(visual.vx, visual.vz);
  const cinematic = feel.update(dt, { speed, omega: visual.omega, boosting, enabled: $('drama').checked, paused });
  framing.update(dt, { state: visual, rig, pose, mode: $('camera').value,
    fovOffset: cinematic.fov - 35, roll: cinematic.roll, paused });
  effects.setViewport(bayHeight, camera.fov);
  scenery.update({ x: visual.x, z: visual.z, paused });
  // Keep the flat laboratory ocean under the camera, without changing simulated world coordinates.
  sea.position.x = bottom.position.x = visual.x; sea.position.z = bottom.position.z = visual.z;
  sun.position.set(visual.x - 25, 45, visual.z + 15); sun.target.position.set(visual.x, 0, visual.z);
  const sky = scene.getObjectByName('lab-sky'); sky.position.copy(camera.position);
  U.mnTime.value = Math.max(0, t); U.mnWind.value.set(Math.sin(wind.yaw) * wind.strength, Math.cos(wind.yaw) * wind.strength);
  const gust = gustAt(state.tick, wind, $('gusts').checked && rig.sail > 0 && !body.disabled), current = currentAt(visual.x, visual.z, $('currents').checked);
  const context = { state: visual, rig, wind, gust, activity, current, currents: $('currents').checked, paused };
  // Let the last impact particles expire, but stop navigation cues/audio after flotation is lost.
  effects.update(paused ? 0 : dt, context); sound.update({ ...context, paused: paused || body.disabled });
  pipeline.update(dt); pipeline.render();
  updateHud();
}
function fixed() {
  previous = state;
  const control = input.poll();
  if (body.disabled) { state = { ...state, tick: state.tick + 1 }; clearInputs(); return; }
  if ($('cruise').checked && control.brake === 0) control.throttle = Math.max(control.throttle, 0.85);
  control.capture = input.consumeCapture();
  const gusts = $('gusts').checked && rig.sail > 0;
  const gust = gustAt(state.tick, wind, gusts);
  if (gust.phase !== lastGustPhase || gust.id !== lastGustId) {
    if (gust.phase === 'approach' || gust.phase === 'window') sound.event(gust.phase);
    lastGustPhase = gust.phase; lastGustId = gust.id;
  }
  const action = stepSailingActivity(activity, state, control, rig, wind, gusts);
  activity = action.activity;
  if (action.event) { effects.event(action.event, state, rig); sound.event(action.event); }
  const next = stepNaval(state, control, rig, wind, sailingEnvironment(activity, state, $('currents').checked));
  const resolved = resolveNavalContact(state, next, rig, $('coast-collisions').checked ? NAVAL_COAST : []);
  state = resolved.state;
  for (const hit of resolved.contacts) if (hit.damage > 0) {
    installDamage(hitHullAt(structure, { x: hit.localX, z: hit.localZ, damage: hit.damage }));
  }
  for (const button of document.querySelectorAll('[data-pilot]')) {
    const action = button.dataset.pilot;
    button.classList.toggle('active', action === 'throttle' ? control.throttle > 0 : action === 'brake' ? control.brake > 0 : action === 'left' ? control.steer < 0 : action === 'right' ? control.steer > 0 : false);
  }
  if (state.tick % 6 === 0) {
    samples.push([state.x, 0.045, state.z]); if (samples.length > 256) samples.shift();
    samples.forEach((p, n) => trailArray.set(p, n * 3));
    trailGeometry.attributes.position.needsUpdate = true; trailGeometry.setDrawRange(0, samples.length);
  }
}
function resize() {
  const rect = $('bay').getBoundingClientRect(); pipeline.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  bayHeight = Math.max(1, rect.height); effects?.setViewport(bayHeight, camera.fov);
}

async function start() {
  for (const f of LAB_FIXTURES) $('fixture').add(new Option(f.name, f.id));
  for (const w of LAB_WINDS) $('wind').add(new Option(w.name, w.id));
  // Existing manifest selects exactly one 1024/512 atlas. Failed loads keep procedural materials.
  const [, loadedSkin] = await Promise.all([
    assets.load('/assets/manifest.json', { mobileTextures: mobile, timeoutMs: 8000 }),
    loadNavalRaftSkin({ mobile }),
  ]);
  raftSkin = loadedSkin;
  $('relief').value = raftSkin.diagnostics().relief;
  renderer = new THREE.WebGLRenderer({ canvas: $('bay'), antialias: false, powerPreference: mobile ? 'low-power' : 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x9ad8e3, 110, 260);
  camera = new THREE.PerspectiveCamera(35, 1, 0.5, 1400);
  const hemisphere = new THREE.HemisphereLight(0xe2f6ff, 0x546784, 2); scene.add(hemisphere);
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
  configureNavalReferenceLook({ scene, sky, sea, bottom, hemisphere, sun, pipeline });
  framing = new NavalLabCamera(camera, { reducedMotion });
  scenery = new NavalLabScenery(scene, { mobile }); pipeline.markDirty();
  U.mnOccOn.value = 0; U.mnNearFade.value = 0; U.mnCloud.value = 0.15;
  $('light').checked = mobile;
  const quality = () => {
    renderer.shadowMap.enabled = sun.castShadow = !$('light').checked;
    pipeline.setQuality({ outlines: !$('light').checked, comic: 0, pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5), ss: 1, fxaa: true });
  };
  quality(); layer = new RaftLayer(scene, { dock: null, surfaceSkin: raftSkin });
  effects = new NavalLabEffects(scene, { mobile, reducedMotion }); sound = new NavalLabAudio({ mobile });
  feel = new NavalSpeedFeel($('bay').parentElement, { mobile, reducedMotion });
  hud = new NavalLabHud(document);
  scene.add(references, trail);
  references.visible = trail.visible = $('references').checked;
  input = new NavalLabInput(document, { onReset: reset, onJettison: jettison, onGesture: unlockSound, onCancel: () => setPaused(true) });
  $('fixture').addEventListener('change', reset);
  $('camera').addEventListener('change', () => { framing.reset(); $('bay').focus({ preventScroll: true }); });
  $('material').addEventListener('change', changeSkin);
  $('relief').addEventListener('change', () => { raftSkin.setRelief($('relief').value); pipeline.markDirty(); updateSkinReadout(); $('bay').focus({ preventScroll: true }); });
  $('wind').addEventListener('change', () => { wind = LAB_WINDS.find((w) => w.id === $('wind').value); activity = newSailingActivity(); comparisons(); clearInputs(); updateHud(); $('bay').focus({ preventScroll: true }); showMessage('Viento cambiado; tu velocidad se conserva.'); });
  $('reset').addEventListener('click', reset); $('jettison').addEventListener('click', jettison);
  $('jettison-hud').addEventListener('click', jettison);
  $('pause-nav').disabled = false;
  $('pause-nav').addEventListener('click', () => setPaused(!paused));
  $('pause').addEventListener('click', () => setPaused(!paused));
  $('coast-start').addEventListener('click', nearCoast);
  $('damage-target').addEventListener('change', structureReadout);
  $('part-hit').addEventListener('click', hitSelectedBlock);
  $('references').addEventListener('change', () => { references.visible = trail.visible = $('references').checked; });
  $('light').addEventListener('change', quality);
  $('gusts').addEventListener('change', () => { activity = newSailingActivity(); clearInputs(); updateHud(); });
  $('currents').addEventListener('change', updateHud);
  $('sound').addEventListener('click', () => {
    if (soundEnabled) { soundEnabled = false; soundOptOut = true; sound.setEnabled(false); $('sound').textContent = 'Activar sonido'; $('sound').setAttribute('aria-pressed', 'false'); }
    else { soundOptOut = false; unlockSound(); }
  });
  window.addEventListener('blur', () => setPaused(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', resize); reset(); resize();
  updateSkinReadout();
  // Read-only snapshots and explicit laboratory actions aid repeatable local acceptance.
  window.__navalLab = { snapshot: () => ({ fixture: structuredClone(fixture), rig: { ...rig }, state: { ...state }, wind: { ...wind },
    structure: structuredClone(structure), hull: { ...hullIntegrity(structure) }, disabled: body.disabled,
    operationalRig: body.rig ? { ...body.rig } : null, liveParts: structuredClone(body.parts),
    activity: { ...activity }, gust: gustAt(state.tick, wind, $('gusts').checked && rig.sail > 0 && !body.disabled), current: currentAt(state.x, state.z, $('currents').checked),
    effects: effects.diagnostics(), audio: sound.diagnostics(), feel: feel.diagnostics(), camera: framing.diagnostics(), hud: hud.diagnostics(),
    scenery: scenery.diagnostics(), raftSkin: { ...raftSkin.diagnostics(), active: $('material').value }, mobile, paused, droppedSeconds: clock.dropped, textures: assets.list(), samples: samples.length }), reset, jettison, setPaused };
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.max(0, (now - last) / 1000); last = now;
    try { if (!paused && !document.hidden) clock.advance(dt, fixed); drawFrame(Math.min(dt, 0.25)); }
    catch (error) { setPaused(true); setSailingView(false); showMessage(`Prueba detenida: ${error.message}`); console.error(error); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); input.dispose(); effects.dispose(); sound.dispose(); feel.dispose(); scenery.dispose(); layer.dispose(); raftSkin.dispose(); renderer.dispose(); });
}
$('lab-toggle').addEventListener('click', () => setSailingView(!document.body.classList.contains('sailing-view')));
$('return-to-sea').addEventListener('click', () => setSailingView(true));
start().catch((error) => { setSailingView(false); showMessage(`No se pudo abrir la bahía: ${error.message}`); console.error(error); });

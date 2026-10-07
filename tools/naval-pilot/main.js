// Isolated pilot bridge: real GameClient + NavalPilotServer, connected only by cloned in-memory queues.
import * as THREE from 'three';
import { assets } from '../../src/render/assets/registry.js';
import { RaftLayer } from '../../src/render/rafts.js';
import { Pipeline, LAYER } from '../../src/render/pipeline.js';
import { createWater } from '../../src/render/water.js';
import { createSky, SKY } from '../../src/render/sky.js';
import { CharacterView } from '../../src/render/characters.js';
import { U } from '../../src/render/toon.js';
import { GameClient } from '../../src/client/gameClient.js';
import { NavalPilotServer } from '../../src/net/navalPilotServer.js';
import { trustSaves } from '../../src/net/saves.js';
import { generateWorld } from '../../src/sim/worldgen.js';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { prepareRaftProfile, publicRafts } from '../../src/sim/systems/rafts.js';
import { canPlace } from '../../src/sim/economy/raft.js';
import { NAVAL_STEP, buildNavalRig } from '../../src/sim/naval/handling.js';
import { loadNavalRaftSkin } from '../naval-lab/raft-skin.js';
import { LAB_FIXTURES } from '../naval-lab/fixtures.js';
import { configureNavalReferenceLook } from '../naval-lab/look.js';
import { NavalLabCamera } from '../naval-lab/camera.js';
import { NavalLabAudio } from '../naval-lab/audio.js';
import { NavalLabEffects } from '../naval-lab/effects.js';
import { hullIntegrity } from '../../src/sim/naval/structure.js';
import { RAFT, RAFT_PARTS } from '../../src/data/raftparts.js';
import { pilotPoint } from '../../src/sim/naval/pilotGeometry.js';

const $ = (id) => document.getElementById(id);
const SEED = 20261006;
const CLIENT_ID = 'naval-pilot-lab';
const mobile = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('mobile') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const axes = { throttle: 0, brake: 0, steer: 0 };
const held = new Set();
const faults = [];
const lab = { client: null, server: null, transport: null, ready: Promise.resolve(false), mount, leave, setAxes, diagnostics };
window.__navalPilotLab = lab;

let renderer, scene, camera, pipeline, sea, bottom, sun, sky, layer, character, framing, sound, effects, raftSkin;
let client, server, transport, serverMap, shipId = null, raf = 0, lastFrame = 0, accumulator = 0;
let running = true, bootNumber = 0, readyResolve = null, latestError = '', lastPilotEvent = null;

class MemoryTransport {
  constructor(sendToServer) {
    this.sendToServer = sendToServer;
    this.outbound = [];
    this.inbound = [];
    this.messageHandler = null;
    this.snapshotHandler = null;
  }
  send(message) { this.outbound.push(structuredClone(message)); }
  onMessage(handler) { this.messageHandler = handler; }
  onSnapshot(handler) { this.snapshotHandler = handler; }
  start() {}
  deliver(message) {
    const copy = structuredClone(message);
    if (copy?.t === 'snap') this.snapshotHandler?.(copy);
    else this.messageHandler?.(copy);
  }
  drain() {
    let turns = 0;
    while ((this.outbound.length || this.inbound.length) && turns++ < 4000) {
      while (this.outbound.length) this.sendToServer(structuredClone(this.outbound.shift()));
      while (this.inbound.length) this.deliver(this.inbound.shift());
    }
    if (turns >= 4000) throw new Error('La cola local no se vació.');
  }
}

function fixtureProfile(profile, kind) {
  const ship = profile.eco.ships.find((item) => item.kind === 'raft' && item.at === 'aldea');
  // Use the outer test berth. The dock-adjacent berth intentionally trips the terrain fence
  // when a turn puts a corner on the dock; coast contact/HP is a later authority slice.
  if (ship) ship.berth = 2;
  if (kind === 'house' && ship) {
    const fixture = LAB_FIXTURES.find((item) => item.id === 'house');
    const parts = [];
    for (const raw of fixture?.parts || []) {
      const piece = [...raw];
      if (canPlace(parts, piece)) throw new Error(`La pieza ${piece[0]} no pasa la validación del plano de caseta.`);
      parts.push(piece);
    }
    ship.grid.parts = parts;
    ship.grid.work = {};
  }
  return profile;
}

function findDeckPosition(world, owner, raft) {
  const ecs = world.ecs;
  world.raftDeck.update(publicRafts(world));
  // Put the fixture's pilot in an open tile, with both feet inside the deck rather than on its rim.
  const candidates = raft.parts.filter((p) => p[0] === 'foundation').sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  for (const tile of candidates) {
    const occupied = raft.parts.some((p) => {
      const def = RAFT_PARTS[p[0]];
      if (p[3] !== 0 || !['tile', 'pillar'].includes(def?.layer)) return false;
      const [width, depth] = def.size || [1, 1];
      return tile[1] >= p[1] && tile[1] < p[1] + width && tile[2] >= p[2] && tile[2] < p[2] + depth;
    });
    if (occupied) continue;
    const p = pilotPoint(raft, { x: (tile[1] + 0.5) * RAFT.cell, y: 0, z: (tile[2] + 0.5) * RAFT.cell, f: 0 });
    const surface = world.raftDeck.surface(p.x, p.z, p.y);
    if (surface?.id !== raft.id || surface.kind !== 'deck' || world.raftDeck.blocked(p.x, p.z, surface.y, 0.3)) continue;
    ecs.x[owner] = p.x; ecs.y[owner] = surface.y; ecs.z[owner] = p.z;
    ecs.facing[owner] = raft.yaw;
    ecs.vx[owner] = ecs.vz[owner] = ecs.kbx[owner] = ecs.kbz[owner] = 0;
    return;
  }
  throw new Error('No se encontró una tabla de cubierta válida para el piloto.');
}

function setConnection(ready, text) {
  $('connection').textContent = text;
  $('connection-dot').parentElement.classList.toggle('ready', ready);
}

function say(text) { $('notice').textContent = text; }

function clearControls(sendNeutral = true) {
  held.clear();
  axes.throttle = axes.steer = 0;
  axes.brake = sendNeutral ? 1 : 0;
  document.querySelectorAll('.helm-key').forEach((button) => button.classList.remove('active'));
  if (sendNeutral && client?.naval.active) {
    client.neutralNaval();
    try { transport.drain(); } catch (error) { recordError(error); }
  }
}

function currentAxes() { return { throttle: axes.throttle, brake: axes.brake, steer: axes.steer }; }

function setAxes(value = {}) {
  axes.throttle = Math.max(0, Math.min(1, Number(value.throttle) || 0));
  axes.brake = Math.max(0, Math.min(1, Number(value.brake) || 0));
  axes.steer = Math.max(-1, Math.min(1, Number(value.steer) || 0));
  return currentAxes();
}

function mapKey(event, down) {
  const key = event.key.toLowerCase();
  const axis = ({ w: 'throttle', arrowup: 'throttle', s: 'brake', arrowdown: 'brake', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' })[key];
  if (!axis || !client?.naval.active) return;
  event.preventDefault();
  if (down) held.add(axis); else held.delete(axis);
  axes.throttle = held.has('throttle') ? 1 : 0;
  axes.brake = held.has('brake') ? 1 : 0;
  axes.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  document.querySelectorAll('.helm-key').forEach((button) => button.classList.toggle('active', held.has(button.dataset.axis)));
}

function bindInputs() {
  window.addEventListener('keydown', (event) => mapKey(event, true));
  window.addEventListener('keyup', (event) => mapKey(event, false));
  for (const button of document.querySelectorAll('.helm-key')) {
    const press = (event) => { event.preventDefault(); if (!client?.naval.active) return; button.setPointerCapture?.(event.pointerId); held.add(button.dataset.axis); mapButtonAxes(); button.classList.add('active'); };
    const release = (event) => { event.preventDefault(); held.delete(button.dataset.axis); mapButtonAxes(); button.classList.remove('active'); };
    button.addEventListener('pointerdown', press);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
  }
  window.addEventListener('blur', () => clearControls(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearControls(true); });
}

function mapButtonAxes() {
  axes.throttle = held.has('throttle') ? 1 : 0;
  axes.brake = held.has('brake') ? 1 : 0;
  axes.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
}

function flush() { transport?.drain(); }

function mount() {
  if (!client?.joined || client.naval.active || !shipId) return false;
  const owner = server.clients.get(CLIENT_ID)?.entity || 0, ecs = server.world.ecs;
  const surface = server.world.raftDeck.surface(ecs.x[owner], ecs.z[owner], ecs.y[owner]);
  if (!owner || surface?.id !== shipId || surface.kind !== 'deck') {
    say('Preparando un ensayo nuevo y colocando al piloto sobre su cubierta.');
    bootSession().catch(recordError);
    return true;
  }
  clearControls(false);
  client.mountNaval(shipId);
  flush();
  say('Solicitud de embarque enviada al servidor local.');
  return true;
}

function leave() {
  if (!client?.naval.active) return false;
  clearControls(false);
  client.leaveNaval();
  flush();
  say('Salida del puesto solicitada; el servidor devolverá al piloto al muelle.');
  return true;
}

function sessionSnapshot() {
  if (!server || !client) return null;
  const owner = server.clients.get(CLIENT_ID)?.entity || 0;
  const pilot = owner ? server.world.navalPilot.snapshot(owner) : null;
  const body = pilot?.active ? pilot.body : null;
  const raft = shipId ? server.world.rafts.get(shipId) : null;
  const source = raft && server.world.ecs;
  const sourcePose = source ? { x: source.x[raft.entity], y: source.y[raft.entity], z: source.z[raft.entity], yaw: source.facing[raft.entity] } : null;
  const profile = owner ? server.world.profiles.get(owner) : null;
  const ship = profile?.eco?.ships?.find((item) => item.id === shipId);
  return {
    tick: server.world.tick, active: !!pilot?.active, epoch: pilot?.epoch || 0,
    ack: pilot?.ack || 0, shipPose: body?.pose || sourcePose,
    pilotPose: owner ? { x: source.x[owner], y: source.y[owner], z: source.z[owner], f: source.facing[owner] } : null,
    rig: body?.operational?.rig || (ship ? buildNavalRig(ship.grid.parts) : null),
    hull: body ? `${Math.round(hullIntegrity(body.structure).fraction * 100)}%` : ship ? `${ship.grid.parts.length} piezas` : '—',
    shipId, ship, profile, body, owner,
  };
}

function diagnostics() {
  const s = sessionSnapshot();
  return {
    tick: s?.tick ?? 0, active: !!s?.active, epoch: s?.epoch ?? 0, ack: s?.ack ?? 0,
    shipId: s?.shipId ?? null, hull: s?.hull ?? '—',
    shipPose: s?.shipPose ? structuredClone(s.shipPose) : null,
    pilotPose: s?.pilotPose ? structuredClone(s.pilotPose) : null,
    rig: s?.rig ? structuredClone(s.rig) : null,
    errors: [...faults, ...(latestError ? [latestError] : [])],
    connected: !!client?.joined, ready: !!client?.joined && !!server,
    controls: currentAxes(), glError: renderer?.getContext().getError() ?? null,
    assetErrors: [...assets.errors], mobile, lastPilotEvent,
    sourceEcsPose: s?.shipId && server?.world.rafts.get(s.shipId) ? (() => { const r = server.world.rafts.get(s.shipId), e = r.entity, ecs = server.world.ecs; return { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e], yaw: ecs.facing[e] }; })() : null,
  };
}

function recordError(error) {
  latestError = error?.message || String(error);
  faults.push(latestError);
  if (faults.length > 8) faults.shift();
  $('error').textContent = latestError;
  $('error').hidden = false;
  console.error(error);
}

async function bootSession() {
  const serial = ++bootNumber;
  if (server) {
    clearControls(false);
    try { if (client?.naval.active) client.leaveNaval(); flush(); } catch {}
    server.disconnect(CLIENT_ID);
    server.stop();
  }
  client = null; transport = null; server = null; shipId = null;
  lab.client = null; lab.server = null; lab.transport = null;
  latestError = ''; $('error').hidden = true;
  setConnection(false, 'Abriendo instancia aislada…');
  $('mount').disabled = $('leave').disabled = true;
  const promise = new Promise((resolve) => { readyResolve = resolve; });
  lab.ready = promise;

  const serverSeed = SEED;
  serverMap = generateWorld(serverSeed);
  const clientId = CLIENT_ID;
  server = new NavalPilotServer({ seed: serverSeed, saves: trustSaves, send: (id, message) => {
    if (id === clientId && transport) transport.inbound.push(structuredClone(message));
  } });
  transport = new MemoryTransport((message) => server.receive(clientId, message));
  lastPilotEvent = null;
  const bus = { emit(type, event) {
    if (type === 'net:error') { recordError(new Error(`El servidor detuvo el ensayo: ${event.code}`)); return; }
    if (type !== 'navalPilot') return;
    lastPilotEvent = { active: event.active, ok: event.ok, epoch: event.epoch, why: event.why, op: event.op };
    if (event.why === 'boundary') say('Llegaste al límite del ensayo. El servidor te devolvió al muelle.');
    else if (event.ok === false) say('No se pudo tomar el puesto. Prepara otro ensayo para volver a embarcar.');
  } };
  client = new GameClient(transport, serverMap, bus);
  lab.client = client; lab.server = server; lab.transport = transport;
  server.connect(clientId);
  client.start();

  const profile = newProfile();
  if (!prepareRaftProfile(server.world, profile)) throw new Error('No se pudo preparar la balsa de prueba.');
  fixtureProfile(profile, $('fixture').value);
  const saved = JSON.stringify(profile);
  client.join('Piloto de prueba', 0, 0, saved);
  flush();
  const session = server.clients.get(clientId);
  if (!session?.entity || !client.youLocal) throw new Error('El servidor local no creó al piloto.');
  const owned = profile.eco.ships.find((item) => item.kind === 'raft' && item.at === 'aldea');
  shipId = owned?.id || null;
  const publicRaft = shipId && publicRafts(server.world).find((item) => item.id === shipId);
  if (!publicRaft) throw new Error('La balsa de prueba no llegó a la cubierta pública.');
  findDeckPosition(server.world, session.entity, publicRaft);
  layer.dock = server.world.map.dock;
  server.broadcastSnapshot();
  flush();
  if (serial !== bootNumber) { resolveReady(false); return false; }
  client.update(0, 0);
  setConnection(true, 'Sesión local · conectada');
  $('readout-state').textContent = 'En cubierta';
  $('pilot-state').textContent = 'A pie en cubierta · puesto libre';
  say('El mundo local replica el plano y mantiene la balsa guardada en su amarre.');
  readyResolve?.(true); readyResolve = null;
  pipeline.markDirty();
  return true;
}

function resolveReady(value) { readyResolve?.(value); readyResolve = null; }

function getVisualState() {
  if (!client) return null;
  const raft = client.pred.rafts.find((item) => item.id === shipId);
  const body = client.naval.active ? client.naval.body : null;
  const rig = body?.operational?.rig || (raft ? buildNavalRig(raft.parts) : null);
  if (!rig) return null;
  const pose = body ? client.naval.pose(1) : { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
  const state = body?.state || { x: pose.x, z: pose.z, yaw: pose.yaw, vx: 0, vz: 0, omega: 0, tick: server?.world.tick || 0 };
  return { raft, body, rig, pose, state };
}

function updateHud() {
  const d = diagnostics(), active = d.active, v = getVisualState();
  const owner = server?.clients.get(CLIENT_ID)?.entity || 0, ecs = server?.world.ecs;
  const surface = owner && ecs ? server.world.raftDeck.surface(ecs.x[owner], ecs.z[owner], ecs.y[owner]) : null;
  const onDeck = surface?.id === shipId && surface.kind === 'deck';
  $('mount').disabled = !client?.joined || active || !shipId;
  $('mount').querySelector('span').textContent = onDeck ? '⇢' : '↻';
  $('mount').lastChild.textContent = onDeck ? ' Subir al timón' : ' Preparar otro ensayo';
  $('leave').disabled = !active;
  $('pilot-badge').textContent = active ? 'AL TIMÓN' : 'A PIE';
  $('pilot-badge').classList.toggle('active', active);
  $('pilot-state').textContent = active ? 'Piloto unido a la cubierta móvil' : client?.joined ?
    onDeck ? 'Balsa amarrada · lista para embarcar' : 'Piloto en el muelle · prepara otro ensayo' : 'Conectando con la sesión local';
  $('readout-state').textContent = active ? 'Navegando' : client?.joined ? onDeck ? 'En cubierta' : 'En muelle' : 'Conectando';
  $('occupants').textContent = active ? '1 / 1' : '0 / 1';
  $('tick').textContent = String(d.tick);
  $('ack').textContent = String(d.ack);
  const speed = v ? Math.hypot(v.state.vx || 0, v.state.vz || 0) : 0;
  $('speed').textContent = speed.toFixed(1);
  $('speed-fill').style.width = `${Math.min(100, speed / 12 * 100)}%`;
  $('heading').textContent = v ? `${String(Math.round(((v.pose.yaw * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}°` : '—°';
  $('hull').textContent = d.hull;
  const wind = client?.naval.wind;
  if (wind) $('wind-arrow').style.transform = `rotate(${wind.yaw * 180 / Math.PI}deg)`;
}

function draw(dt, alpha) {
  if (!renderer || !client) return;
  client.update(0, dt);
  const v = getVisualState();
  if (v) {
    const records = client.renderRafts(alpha);
    if (layer.update(records, server.world.tick * NAVAL_STEP, client.youServer)) pipeline.markDirty();
    const view = layer.views.get(shipId);
    // Gameplay support is rigid; keep the local visual sub-transform rigid with the authoritative deck.
    if (view && client.naval.active) {
      view.visual.position.y = 0;
      view.visual.rotation.set(0, 0, 0);
    }
    const local = client.localState(alpha, {});
    character.update(dt, local);
    const cameraState = { ...v.state, yaw: v.state.yaw ?? v.pose.yaw, vx: v.state.vx || 0, vz: v.state.vz || 0, omega: v.state.omega || 0 };
    framing.update(dt, { state: cameraState, rig: v.rig, pose: v.pose, mode: 'chase', paused: document.hidden });
    sea.position.set(v.pose.x, 0, v.pose.z); bottom.position.set(v.pose.x, -8, v.pose.z);
    sun.position.set(v.pose.x - 25, 45, v.pose.z + 15); sun.target.position.set(v.pose.x, 0, v.pose.z);
    sky.position.copy(camera.position);
    const wind = client.naval.wind || { yaw: 0, strength: 0 };
    U.mnTime.value = server.world.tick * NAVAL_STEP;
    U.mnWind.value.set(Math.sin(wind.yaw) * wind.strength, Math.cos(wind.yaw) * wind.strength);
    if (sound) sound.update({ state: cameraState, rig: v.rig, paused: document.hidden || !client.naval.active });
    effects?.setViewport($('bay').getBoundingClientRect().height, camera.fov);
    effects?.update(dt, { state: cameraState, rig: v.rig, wind, paused: document.hidden,
      gust: null, activity: null, current: null, currents: false });
  }
  pipeline.update(dt); pipeline.render(); updateHud();
}

function fixedTick() {
  if (!client || !server || !client.joined || server.navalFault) return;
  try {
    if (client.naval.active) client.tickNaval(currentAxes());
    client.update(NAVAL_STEP, NAVAL_STEP);
    flush();
    server.step();
    flush();
  } catch (error) { recordError(error); setConnection(false, 'Ensayo detenido'); }
}

function resize() {
  if (!pipeline) return;
  const rect = $('bay').getBoundingClientRect();
  pipeline.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  pipeline.setQuality({ pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5), ss: 1, outlines: true, fxaa: true, comic: 0 });
}

async function initializeScene() {
  await assets.load('/assets/manifest.json', { mobileTextures: mobile, timeoutMs: 8000 });
  try { raftSkin = await loadNavalRaftSkin({ mobile }); } catch (error) { console.warn('Raft surface skin unavailable; shared atlas fallback remains active.', error); }
  renderer = new THREE.WebGLRenderer({ canvas: $('bay'), antialias: false, powerPreference: mobile ? 'low-power' : 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1600);
  const hemisphere = new THREE.HemisphereLight(0xe2f6ff, 0x546784, 1.85); scene.add(hemisphere);
  sun = new THREE.DirectionalLight(0xd2dfe2, 1.8);
  sun.position.set(-25, 45, 15); sun.castShadow = !mobile;
  sun.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 120 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; scene.add(sun, sun.target);
  SKY.sunDir.value.set(-25, 45, 15).normalize();
  sky = createSky(); sky.name = 'pilot-sky'; sky.layers.set(LAYER.NO_OUTLINE); scene.add(sky);
  const heightTex = new THREE.DataTexture(new Float32Array([-8]), 1, 1, THREE.RedFormat, THREE.FloatType); heightTex.needsUpdate = true;
  sea = createWater({ size: 2e9 }, heightTex); sea.layers.set(LAYER.WATER); scene.add(sea);
  bottom = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: 0x17486b }));
  bottom.rotation.x = -Math.PI / 2; bottom.position.y = -8; bottom.layers.set(LAYER.WORLD); scene.add(bottom);
  pipeline = new Pipeline(renderer, scene, camera);
  pipeline.water = { setMode: (ssr) => sea.userData.setMode(ssr) };
  configureNavalReferenceLook({ scene, sky, sea, bottom, hemisphere, sun, pipeline });
  U.mnOccOn.value = 0; U.mnNearFade.value = 0; U.mnCloud.value = 0.15;
  framing = new NavalLabCamera(camera, { reducedMotion });
  effects = new NavalLabEffects(scene, { mobile, reducedMotion });
  layer = new RaftLayer(scene, { dock: null, surfaceSkin: raftSkin || null });
  character = new CharacterView(0, { sword: false });
  scene.add(character.root);
  sound = new NavalLabAudio({ mobile }); sound.setEnabled(false);
  $('sound').addEventListener('click', async () => {
    const enabled = $('sound').getAttribute('aria-pressed') !== 'true';
    if (!enabled) { sound.setEnabled(false); $('sound').setAttribute('aria-pressed', 'false'); $('sound').querySelector('span').textContent = 'Activar ambiente'; return; }
    sound.setEnabled(true);
    const ready = await sound.unlock();
    if (!ready) sound.setEnabled(false);
    $('sound').setAttribute('aria-pressed', String(!!ready));
    $('sound').querySelector('span').textContent = ready ? 'Silenciar ambiente' : 'Audio no disponible';
  });
  if (mobile) {
    document.querySelector('.stage').appendChild(document.querySelector('.helm'));
    document.querySelector('.stage').classList.add('touch-helm');
  }
  resize();
  window.addEventListener('resize', resize);
}

function frame(now) {
  if (!running) return;
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (!document.hidden && client?.joined && !server?.navalFault) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= NAVAL_STEP && steps++ < 6) { fixedTick(); accumulator -= NAVAL_STEP; }
    if (steps >= 6) accumulator = 0;
  }
  try { draw(dt, Math.min(1, accumulator / NAVAL_STEP)); } catch (error) { recordError(error); }
  raf = requestAnimationFrame(frame);
}

async function start() {
  bindInputs();
  await initializeScene();
  $('mount').addEventListener('click', mount);
  $('leave').addEventListener('click', leave);
  $('fixture').addEventListener('change', () => { bootSession().catch(recordError); });
  await bootSession();
  raf = requestAnimationFrame(frame);
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf); clearControls(false);
  try { if (server) { server.disconnect(CLIENT_ID); server.stop(); } } catch (error) { recordError(error); }
  sound?.dispose(); effects?.dispose(); layer?.dispose(); raftSkin?.dispose(); renderer?.dispose();
});

start().catch((error) => { recordError(error); setConnection(false, 'No se pudo iniciar'); resolveReady(false); });

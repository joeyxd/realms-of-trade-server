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
import { NavalPilotCoastView, findCoastApproach } from './coastView.js';

const $ = (id) => document.getElementById(id);
const SEED = 20261006;
const CLIENT_ID = 'naval-pilot-lab';
const GUEST_ID = 'naval-pilot-guest';
const mobile = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('mobile') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const axes = { throttle: 0, brake: 0, steer: 0, x: 0, z: 0 };
let coastBrake = 0;
const held = new Set();
const faults = [];
const lab = { client: null, guest: null, server: null, transport: null, ready: Promise.resolve(false), mount, leave, setAxes, diagnostics,
  walk: () => toggleWalk(), guestToggle: () => toggleGuest() };
window.__navalPilotLab = lab;

let renderer, scene, camera, pipeline, sea, bottom, sun, sky, layer, character, guestCharacter, framing, sound, effects, raftSkin, coastView;
let client, guest = null, server, transport, guestTransport = null, transports = new Map(), serverMap, shipId = null, raftProfileBaseline = null, guestProfileBaseline = null, raftPoseBaseline = null, impactFixture = null, lastImpact = null, impactCount = 0, visualImpactCount = 0, audioImpactCount = 0, raf = 0, lastFrame = 0, accumulator = 0;
const impactReceipts = new Set();
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
  // Use the outer test berth so the coast approach starts clear of the dock.
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

function findDeckPosition(world, owner, raft, avoidEntity = 0) {
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
    if (avoidEntity && Math.hypot(p.x - ecs.x[avoidEntity], p.z - ecs.z[avoidEntity]) < 1.6) continue;
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
  axes.throttle = axes.steer = axes.x = axes.z = 0;
  axes.brake = sendNeutral ? 1 : 0;
  coastBrake = sendNeutral ? 1 : 0;
  document.querySelectorAll('.helm-key').forEach((button) => button.classList.remove('active'));
  if (sendNeutral && (client?.naval.active || client?.deck?.active)) {
    if (client.deck?.active) {
      client.neutralDeck();
      client.neutralNaval();
    } else client.neutralNaval();
    guest?.neutralDeck();
    try { flush(); } catch (error) { recordError(error); }
  }
}

function currentAxes() { return client?.deck?.active ? { mx: axes.x, mz: axes.z } : { throttle: axes.throttle, brake: axes.brake, steer: axes.steer }; }

function setAxes(value = {}) {
  axes.throttle = Math.max(0, Math.min(1, Number(value.throttle) || 0));
  axes.brake = Math.max(0, Math.min(1, Number(value.brake) || 0));
  axes.steer = Math.max(-1, Math.min(1, Number(value.steer) || 0));
  axes.x = Math.max(-1, Math.min(1, Number(value.mx ?? value.x) || 0));
  axes.z = Math.max(-1, Math.min(1, Number(value.mz ?? value.z) || 0));
  return currentAxes();
}

function mapKey(event, down) {
  const key = event.key.toLowerCase();
  const axis = ({ w: 'throttle', arrowup: 'throttle', s: 'brake', arrowdown: 'brake', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' })[key];
  if (!axis || !(client?.naval.active || client?.deck?.active)) return;
  coastBrake = 0;
  event.preventDefault();
  if (down) held.add(axis); else held.delete(axis);
  axes.throttle = held.has('throttle') ? 1 : 0;
  axes.brake = held.has('brake') ? 1 : 0;
  axes.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  axes.x = axes.steer;
  axes.z = (held.has('throttle') ? 1 : 0) - (held.has('brake') ? 1 : 0);
  document.querySelectorAll('.helm-key').forEach((button) => button.classList.toggle('active', held.has(button.dataset.axis)));
}

function bindInputs() {
  window.addEventListener('keydown', (event) => mapKey(event, true));
  window.addEventListener('keyup', (event) => mapKey(event, false));
  for (const button of document.querySelectorAll('.helm-key')) {
    const press = (event) => { event.preventDefault(); if (!(client?.naval.active || client?.deck?.active)) return; button.setPointerCapture?.(event.pointerId); held.add(button.dataset.axis); mapButtonAxes(); button.classList.add('active'); };
    const release = (event) => { event.preventDefault(); held.delete(button.dataset.axis); mapButtonAxes(); button.classList.remove('active'); };
    button.addEventListener('pointerdown', press);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
  }
  window.addEventListener('blur', () => clearControls(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearControls(true); });
}

function mapButtonAxes() {
  coastBrake = 0;
  axes.throttle = held.has('throttle') ? 1 : 0;
  axes.brake = held.has('brake') ? 1 : 0;
  axes.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  axes.x = axes.steer;
  axes.z = (held.has('throttle') ? 1 : 0) - (held.has('brake') ? 1 : 0);
}

function flush() {
  for (let pass = 0; pass < 8; pass++) {
    for (const current of transports.values()) current.drain();
    if ([...transports.values()].every((current) => !current.outbound.length && !current.inbound.length)) return;
  }
  throw new Error('Las colas clonadas no llegaron a estado neutral.');
}

function toggleWalk() {
  if (!client?.joined || !shipId) return false;
  clearControls(false);
  if (client.deck?.active) {
    client.helmNaval();
    say('Regresaste al timón; la cubierta sigue bajo el mismo trial.');
  } else if (client.naval.active) {
    client.walkNaval();
    say('Caminas sobre cubierta; el timón queda neutral mientras la balsa avanza por inercia.');
  } else return false;
  flush();
  return true;
}

function stopGuest() {
  if (!guest) return false;
  try { if (guest.deck?.active) guest.leaveDeck(); flush(); } catch {}
  try { server?.disconnect(GUEST_ID); } catch {}
  transports.delete(GUEST_ID); guest = null; guestTransport = null; lab.guest = null;
  $('passenger').textContent = 'Crear pasajero';
  say('Pasajero de prueba retirado.');
  return true;
}

function toggleGuest() {
  if (guest) return stopGuest();
  if (!client?.joined || !shipId) return false;
  guestTransport = new MemoryTransport((message) => server.receive(GUEST_ID, message));
  transports.set(GUEST_ID, guestTransport);
  guest = new GameClient(guestTransport, serverMap, { emit(type, event) {
    if (type === 'net:error') recordError(new Error(`El invitado perdió conexión: ${event.code}`));
    if (type === 'navalImpact') handleNavalImpact(event);
  } });
  lab.guest = guest;
  server.connect(GUEST_ID);
  guest.start();
  const profile = newProfile();
  guestProfileBaseline = JSON.stringify(profile);
  guest.join('Pasajero de prueba', 0, 0, guestProfileBaseline);
  flush();
  const guestEntity = server.clients.get(GUEST_ID)?.entity || 0;
  const ownerEntity = server.clients.get(CLIENT_ID)?.entity || 0;
  const raft = shipId && publicRafts(server.world).find((item) => item.id === shipId);
  if (!guestEntity || !ownerEntity || !raft) throw new Error('No se pudo crear el cliente invitado de cubierta.');
  findDeckPosition(server.world, guestEntity, raft, ownerEntity);
  server.broadcastSnapshot(); flush(); guest.update(0, 0);
  guestProfileBaseline = JSON.stringify(server.world.profiles.get(guestEntity));
  client.inviteNaval(shipId, guestEntity); flush();
  guest.boardNaval(shipId); flush();
  if (!client.naval.active && !client.deck?.active) { client.mountNaval(shipId); flush(); }
  $('passenger').textContent = 'Quitar pasajero';
  say('Invitación y aceptación de cubierta enviadas por ambos clientes.');
  return true;
}

function mount() {
  if (!client?.joined || client.naval.active || client.deck?.active || !shipId) return false;
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
  if (!client?.naval.active && !client?.deck?.active) return false;
  clearControls(false);
  client.leaveNaval();
  flush();
  say('Salida del trial solicitada; el servidor devolverá al piloto y sus invitados al muelle.');
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
  const guestEntity = guest?.youServer || 0;
  return {
    tick: s?.tick ?? 0, active: !!s?.active, epoch: s?.epoch ?? 0, ack: s?.ack ?? 0,
    shipId: s?.shipId ?? null, hull: s?.hull ?? '—',
    shipPose: s?.shipPose ? structuredClone(s.shipPose) : null,
    pilotPose: s?.pilotPose ? structuredClone(s.pilotPose) : null,
    rig: s?.rig ? structuredClone(s.rig) : null,
    deckMode: client?.deck?.mode || (client?.deck?.active ? 'walking' : client?.naval.active ? 'helm' : 'none'),
    deckActive: !!client?.deck?.active, deckEpoch: client?.deck?.epoch || 0,
    deckAck: client?.deck?.ack || 0,
    deckState: client?.deck?.state ? structuredClone(client.deck.state) : null,
    deckShipId: client?.deck?.shipId || null,
    profileBaseline: !!s?.profile && JSON.stringify(s.profile) === raftProfileBaseline,
    guest: guest ? { clientId: GUEST_ID, entity: guestEntity, active: !!guest.deck?.active,
      shipId: guest.deck?.shipId || null, epoch: guest.deck?.epoch || 0,
      serverPosition: guestEntity && server ? { x: server.world.ecs.x[guestEntity], y: server.world.ecs.y[guestEntity], z: server.world.ecs.z[guestEntity], f: server.world.ecs.facing[guestEntity] } : null,
      profileBaseline: !!guestEntity && !!server && JSON.stringify(server.world.profiles.get(guestEntity)) === guestProfileBaseline,
    } : null,
    lastImpact: lastImpact ? structuredClone(lastImpact) : null,
    impactCount, visualImpactCount, audioImpactCount,
    effects: effects?.diagnostics() || null,
    sound: sound?.diagnostics() || null,
    coast: coastView ? structuredClone(coastView.diagnostics) : null,
    impactFixture: impactFixture ? structuredClone(impactFixture) : null,
    errors: [...faults, ...(latestError ? [latestError] : [])],
    connected: !!client?.joined, ready: !!client?.joined && !!server,
    controls: { ...currentAxes(), ...(client?.deck?.active ? { brake: coastBrake } : {}) }, glError: renderer?.getContext().getError() ?? null,
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

function handleNavalImpact(event) {
  if (!event || event.shipId !== shipId || !Number.isFinite(event.damage) || event.damage <= 0) return false;
  const v = getVisualState();
  if (!v) return false;
  const receipt = [event.shipId, event.tick, event.x, event.z, event.partId, event.damage, !!event.destroyed].join(':');
  if (impactReceipts.has(receipt)) return false;
  impactReceipts.add(receipt);
  if (impactReceipts.size > 64) impactReceipts.delete(impactReceipts.values().next().value);
  const kind = event.destroyed ? 'destroy' : 'impact';
  const visualPlayed = effects?.event(kind, v.state, v.rig, event) || false;
  const audioPlayed = sound?.event('impact') || false;
  impactCount++;
  if (visualPlayed) visualImpactCount++;
  if (audioPlayed) audioImpactCount++;
  lastImpact = { ...event, visualPlayed, audioPlayed };
  const partName = event.partType ? (RAFT_PARTS[event.partType]?.name || event.partType) : null;
  const partHp = Number.isFinite(event.partHp) && Number.isFinite(event.partMaxHp)
    ? `${Math.round(event.partHp)} / ${Math.round(event.partMaxHp)} HP` : null;
  const hullHp = event.hull && Number.isFinite(event.hull.hp)
    ? `${Math.round(event.hull.hp)} / ${Math.round(event.hull.maxHp)} HP` : null;
  $('impact-readout').textContent = event.partType
    ? `${event.destroyed ? 'Pieza destruida' : 'Daño en pieza'} · ${partName}: −${event.damage.toFixed(0)} HP${partHp ? ` · ${partHp}` : ''}`
    : `${event.destroyed ? 'Casco inutilizado' : 'Daño de casco'} · −${event.damage.toFixed(0)} HP${hullHp ? ` · ${hullHp}` : ''}`;
  say($('impact-readout').textContent);
  return true;
}

function setupImpactFixture(world) {
  const source = world.rafts.get(shipId);
  if (!source) throw new Error('La balsa de prueba no está conectada al mundo local.');
  const ship = world.profiles.get(source.owner)?.eco?.ships?.find((item) => item.id === shipId);
  const rig = ship && buildNavalRig(ship.grid.parts);
  if (!rig) throw new Error('No se pudo leer el rig real de la fixture.');
  const approach = findCoastApproach(world.map, rig);
  const ecs = world.ecs, entity = source.entity;
  raftPoseBaseline = { x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity], yaw: ecs.facing[entity] };
  ecs.x[entity] = approach.pose.x; ecs.y[entity] = approach.pose.y;
  ecs.z[entity] = approach.pose.z; ecs.facing[entity] = approach.pose.yaw;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = 0;
  world.raftDeck.update(publicRafts(world));
  const owner = server.clients.get(CLIENT_ID)?.entity || 0;
  const raft = publicRafts(world).find((item) => item.id === shipId);
  if (!owner || !raft) throw new Error('No se encontró dueño o cubierta para preparar la prueba de choque.');
  findDeckPosition(world, owner, raft);
  impactFixture = { ...approach, baselinePose: { ...raftPoseBaseline }, rig: { beam: rig.beam, length: rig.length } };
  return impactFixture;
}

async function bootSession({ impact = false } = {}) {
  const serial = ++bootNumber;
  if (server) {
    clearControls(false);
    try { if (client?.naval.active || client?.deck?.active) client.leaveNaval(); if (guest?.deck?.active) guest.leaveDeck(); flush(); } catch {}
    try { server.disconnect(GUEST_ID); } catch {}
    server.disconnect(CLIENT_ID);
    server.stop();
  }
  client = null; guest = null; transport = null; guestTransport = null; server = null; shipId = null; transports = new Map();
  lab.client = null; lab.guest = null; lab.server = null; lab.transport = null;
  latestError = ''; $('error').hidden = true;
  lastImpact = null; impactCount = visualImpactCount = audioImpactCount = 0;
  impactReceipts.clear();
  impactFixture = null; raftPoseBaseline = null;
  $('impact-readout').textContent = 'Sin daño registrado';
  $('hull-fill').style.width = '100%';
  $('hull-meter').setAttribute('aria-valuenow', '100');
  $('hull-meter').setAttribute('aria-valuetext', 'Casco intacto');
  effects?.reset();
  setConnection(false, 'Abriendo instancia aislada…');
  $('mount').disabled = $('leave').disabled = $('walk').disabled = $('passenger').disabled = $('impact-test').disabled = true;
  $('passenger').textContent = 'Crear pasajero';
  guestProfileBaseline = null;
  const promise = new Promise((resolve) => { readyResolve = resolve; });
  lab.ready = promise;

  const serverSeed = SEED;
  serverMap = generateWorld(serverSeed);
  coastView?.update(serverMap);
  const clientId = CLIENT_ID;
  server = new NavalPilotServer({ seed: serverSeed, saves: trustSaves, send: (id, message) => {
    const target = transports.get(id);
    if (target) target.inbound.push(structuredClone(message));
  } });
  transport = new MemoryTransport((message) => server.receive(clientId, message));
  transports.set(clientId, transport);
  lastPilotEvent = null;
  const bus = { emit(type, event) {
    if (type === 'net:error') { recordError(new Error(`El servidor detuvo el ensayo: ${event.code}`)); return; }
    if (type === 'navalImpact') { handleNavalImpact(event); return; }
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
  raftProfileBaseline = saved;
  client.join('Piloto de prueba', 0, 0, saved);
  flush();
  const session = server.clients.get(clientId);
  if (!session?.entity || !client.youLocal) throw new Error('El servidor local no creó al piloto.');
  const owned = profile.eco.ships.find((item) => item.kind === 'raft' && item.at === 'aldea');
  shipId = owned?.id || null;
  const publicRaft = shipId && publicRafts(server.world).find((item) => item.id === shipId);
  if (!publicRaft) throw new Error('La balsa de prueba no llegó a la cubierta pública.');
  findDeckPosition(server.world, session.entity, publicRaft);
  raftProfileBaseline = JSON.stringify(server.world.profiles.get(session.entity));
  layer.dock = server.world.map.dock;
  if (impact) {
    setupImpactFixture(server.world);
    server.broadcastSnapshot(); flush();
    client.mountNaval(shipId); flush();
    say('Fixture de choque lista: navega con W hacia la costa del mapa.');
  }
  server.broadcastSnapshot();
  flush();
  if (serial !== bootNumber) { resolveReady(false); return false; }
  client.update(0, 0);
  setConnection(true, 'Sesión local · conectada');
  $('readout-state').textContent = 'En cubierta';
  $('pilot-state').textContent = 'A pie en cubierta · puesto libre';
  say(impact ? 'Ensayo de choque listo: navega con W hacia la costa del mapa.' :
    'El mundo local replica el plano y mantiene la balsa guardada en su amarre.');
  readyResolve?.(true); readyResolve = null;
  pipeline.markDirty();
  return true;
}

function resolveReady(value) { readyResolve?.(value); readyResolve = null; }

function getVisualState() {
  if (!client) return null;
  const visualShipId = client.deck?.shipId || shipId;
  const raft = client.pred.rafts.find((item) => item.id === visualShipId);
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
  const walking = !!client?.deck?.active, passengerActive = !!guest?.deck?.active;
  $('mount').disabled = !client?.joined || active || walking || !shipId;
  $('mount').querySelector('span').textContent = onDeck ? '⇢' : '↻';
  $('mount').lastChild.textContent = onDeck ? ' Subir al timón' : ' Preparar otro ensayo';
  $('leave').disabled = !(active || walking);
  $('walk').disabled = !(active || walking);
  $('walk').textContent = walking ? 'Tomar el timón' : 'Caminar en cubierta';
  $('control-mode').textContent = walking ? 'CUBIERTA' : 'TIMÓN';
  $('control-help').textContent = walking ? 'A / D eje local X · W / S eje Z' : 'Avanzar · frenar · girar';
  for (const [axis, label] of Object.entries(walking ? { left: 'Caminar a la izquierda', right: 'Caminar a la derecha', throttle: 'Caminar hacia delante', brake: 'Caminar hacia atrás' } :
    { left: 'Girar a babor', right: 'Girar a estribor', throttle: 'Avanzar', brake: 'Frenar' })) {
    const button = document.querySelector(`.helm-key[data-axis="${axis}"]`);
    if (button) button.setAttribute('aria-label', label);
  }
  $('passenger').disabled = !client?.joined;
  $('impact-test').disabled = !client?.joined;
  $('pilot-badge').textContent = walking ? 'CAMINANDO' : active ? 'AL TIMÓN' : 'A PIE';
  $('pilot-badge').classList.toggle('active', active || walking);
  $('pilot-state').textContent = walking ? 'A pie en cubierta móvil · sin empuje' : active ? 'Piloto unido a la cubierta móvil' : client?.joined ?
    onDeck ? 'Balsa amarrada · lista para embarcar' : 'Piloto en el muelle · prepara otro ensayo' : 'Conectando con la sesión local';
  $('readout-state').textContent = walking ? 'Caminando' : active ? 'Navegando' : client?.joined ? onDeck ? 'En cubierta' : 'En muelle' : 'Conectando';
  const occupants = [owner, guest?.youServer].filter((e) => e && ecs?.alive[e] &&
    server.world.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e])?.id === shipId).length;
  $('occupants').textContent = String(occupants);
  const crew = [];
  if (client?.joined) crew.push(`Piloto · ${walking ? 'a pie' : active ? 'timón' : 'muelle'}`);
  if (guest) crew.push(`Invitado ${passengerActive ? '· pasajero' : '· en espera'}`);
  $('crew').textContent = crew.length ? crew.join('  /  ') : 'Sin tripulación';
  $('deck-position').textContent = walking && d.deckState ? `Cubierta · x ${Number(d.deckState.x || 0).toFixed(1)} / z ${Number(d.deckState.z || 0).toFixed(1)}` :
    passengerActive && guest.deck.state ? `Pasajero · x ${Number(guest.deck.state.x || 0).toFixed(1)} / z ${Number(guest.deck.state.z || 0).toFixed(1)}` : 'Posición relativa · —';
  $('tick').textContent = String(d.tick);
  $('ack').textContent = String(d.ack);
  const speed = v ? Math.hypot(v.state.vx || 0, v.state.vz || 0) : 0;
  $('speed').textContent = speed.toFixed(1);
  $('speed-fill').style.width = `${Math.min(100, speed / 12 * 100)}%`;
  $('heading').textContent = v ? `${String(Math.round(((v.pose.yaw * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}°` : '—°';
  const integrity = v?.raft?.hull;
  if (integrity && Number.isFinite(integrity.fraction)) {
    $('hull').textContent = `${Math.round(integrity.fraction * 100)}% · ${Math.round(integrity.hp)} / ${Math.round(integrity.maxHp)} HP`;
    $('hull-fill').style.width = `${Math.max(0, Math.min(1, integrity.fraction)) * 100}%`;
    $('hull-meter').setAttribute('aria-valuenow', String(Math.round(integrity.fraction * 100)));
    $('hull-meter').setAttribute('aria-valuetext', `${Math.round(integrity.hp)} de ${Math.round(integrity.maxHp)} HP`);
  } else {
    $('hull').textContent = d.hull;
    $('hull-fill').style.width = '100%';
    $('hull-meter').setAttribute('aria-valuenow', '100');
    $('hull-meter').setAttribute('aria-valuetext', 'Casco intacto');
  }
  const damagedPart = (v?.raft?.partHealth || []).find((part) => part.hp < part.maxHp);
  if (damagedPart && !lastImpact) $('impact-readout').textContent = `${damagedPart.part}: ${Math.round(damagedPart.hp)} / ${Math.round(damagedPart.maxHp)} HP`;
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
    if (guestCharacter) {
      guestCharacter.root.visible = !!guest?.deck?.active;
      if (guest?.deck?.active) {
        const guestState = guest.localState(alpha, {});
        const renderedRaft = records.find((item) => item.id === shipId);
        const sharedPose = renderedRaft ? { x: renderedRaft.x, y: renderedRaft.y, z: renderedRaft.z, yaw: renderedRaft.yaw } : v.pose;
        const attached = guest.deck.position(sharedPose, alpha);
        if (attached) Object.assign(guestState, attached);
        guestCharacter.update(dt, guestState);
      }
    }
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
    if (client.naval.active && !client.deck?.active) client.tickNaval(currentAxes());
    if (client.deck?.active) {
      client.tickNaval({ throttle: 0, brake: coastBrake, steer: 0 });
      client.tickDeck({ mx: axes.x, mz: axes.z });
    }
    if (guest?.deck?.active) guest.tickDeck({ mx: 0, mz: 0 });
    client.update(NAVAL_STEP, NAVAL_STEP);
    guest?.update(NAVAL_STEP, NAVAL_STEP);
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
  guestCharacter = new CharacterView(0, { sword: false });
  guestCharacter.root.visible = false;
  scene.add(guestCharacter.root);
  coastView = new NavalPilotCoastView(scene, { mobile });
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
  $('walk').addEventListener('click', toggleWalk);
  $('passenger').addEventListener('click', toggleGuest);
  $('impact-test').addEventListener('click', () => { bootSession({ impact: true }).catch(recordError); });
  $('fixture').addEventListener('change', () => { bootSession().catch(recordError); });
  await bootSession();
  raf = requestAnimationFrame(frame);
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf); clearControls(false);
  try { if (server) { server.disconnect(GUEST_ID); server.disconnect(CLIENT_ID); server.stop(); } } catch (error) { recordError(error); }
  sound?.dispose(); effects?.dispose(); layer?.dispose(); coastView?.dispose(); raftSkin?.dispose(); renderer?.dispose();
});

start().catch((error) => { recordError(error); setConnection(false, 'No se pudo iniciar'); resolveReady(false); });

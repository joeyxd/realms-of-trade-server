// Entry point: boot, title, play loop. Every per-frame subsystem runs inside safe() so one failure
// never freezes the game.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { GAME } from './data/meta.js';
import { tuning, DT } from './data/tuning.js';
import { loadSettings, saveSettings, resetSave, settings } from './core/settings.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { bus } from './core/events.js';
import { generateWorld, ZONES } from './sim/worldgen.js';
import { KIND, ACT } from './sim/ecs.js';
import { xpToNext } from './sim/systems/combat.js';
import { PTYPE } from './sim/projectiles.js';
import { ENEMIES } from './data/enemies.js';
import { BTN } from './sim/systems/movement.js';
import { createTransport } from './net/transport.js';
import { GameClient } from './client/gameClient.js';
import { GameScene } from './render/scene.js';
import { SKINS, CharacterView, PortraitStudio } from './render/characters.js';
import { Quality } from './render/quality.js';
import { TitleScreen } from './ui/title.js';
import { Hud } from './ui/hud.js';
import { WorldUI } from './ui/worldui.js';
import { PauseMenu } from './ui/pause.js';
import { TouchControls } from './ui/touch.js';
import { Feedback } from './ui/feedback.js';
import { DevPanel } from './ui/devpanel.js';
import { DebugDraw } from './render/debugdraw.js';
import { audio } from './audio/engine.js';
import { sfx } from './audio/sfx.js';
import { Ambience } from './audio/ambience.js';
import { Music } from './audio/music.js';

const errors = new Map();
function safe(name, fn) {
  try { return fn(); } catch (err) {
    const n = (errors.get(name) || 0) + 1;
    errors.set(name, n);
    if (n === 1) console.error(`[${name}]`, err);
    return undefined;
  }
}

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);

async function boot() {
  document.title = GAME.title.charAt(0) + GAME.title.slice(1).toLowerCase().replace(/ (\w)/, (m, c) => ' ' + c.toUpperCase());
  loadSettings();
  if (!settings.name) {
    settings.name = 'Grumete' + (100 + Math.floor(Math.random() * 900));
    saveSettings();
  }
  if (params.get('q')) settings.quality = params.get('q');
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  document.body.classList.toggle('touch', isTouch);
  const applyUiScale = () => document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  applyUiScale();

  const map = generateWorld(GAME.seed);
  const debug = params.has('debug');
  const transportP = createTransport({ seed: GAME.seed, bots: 5, preferWorker: params.get('worker') !== '0', debug });
  const canvas = $('#game');
  const world = new GameScene(canvas, map);
  // ?tod=night|dusk|day|cycle and ?phase=0..1 for screenshots; otherwise the saved setting.
  world.lighting.setTimeOfDay(params.get('tod') || settings.timeOfDay, 0);
  if (params.get('phase')) world.lighting.setPhase(+params.get('phase'));
  const input = new Input(canvas);
  const worldUI = new WorldUI($('#world-ui'), world.camera);
  const ambience = new Ambience();
  const music = new Music();
  const reduced = () => settings.reducedMotion;

  const quality = new Quality((cfg) => world.applyQuality(cfg), settings.quality, isTouch);
  const studio = safe('portrait', () => new PortraitStudio(world.renderer));
  const portrait = (i) => (studio ? safe('portrait', () => studio.render(i)) : null);
  addEventListener('resize', () => safe('resize', () => { world.onResize(); worldUI.resize(innerWidth, innerHeight); }));

  // ---- State -----------------------------------------------------------------------------------
  const st = {
    mode: 'title', // title | playing
    paused: false,
    zone: null, zoneCandidate: null, zoneTimer: 0,
    tut: 'move', moved: 0, last: null,
    talkIdx: { captain: 0, vendor: 0 },
    titleAngle: 0.6,
    perf: params.has('perf'),
    fps: 60,
  };
  const ps = {
    x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, mag: 0, wade: 0, dashT: -1, dashes: 0, charges: 1, maxCharges: 1, recharge: 0, iframes: 0,
    hp: 100, maxHp: 100, dead: 0, deadT: 0, act: 0, actT: 0, atkStage: 0, atkT: 0, parryT: -1, parryLock: 0, riposte: 0, chain: 0, chainT: 99, level: 1, xp: 0,
  };
  const focus = new THREE.Vector3(map.landmarks.spawn.x, 1, map.landmarks.spawn.z);
  const aim = new THREE.Vector3();
  const anchors = new Map();
  const anchorPool = new Map();
  const anchor = (id, x, y, z, dist) => {
    let a = anchorPool.get(id);
    if (!a) { a = { pos: new THREE.Vector3(), dist: 0, hide: false }; anchorPool.set(id, a); }
    a.pos.set(x, y, z); a.dist = dist;
    anchors.set(id, a);
    return a;
  };
  const tmpV = new THREE.Vector3();
  const shadowFocus = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const move = { x: 0, z: 0 };
  const axes = { x: 0, y: 0 };
  const screenP = { x: 0, y: 0, vis: false };

  // ---- UI --------------------------------------------------------------------------------------
  const hud = new Hud($('#hud'), {
    onSettings: () => openPause('settings'),
    onMute: () => { settings.muted = !settings.muted; audio.set({ muted: settings.muted }); hud.setMuted(settings.muted); saveSettings(); sfx.click(); },
  });
  hud.setMuted(settings.muted);
  const touch = new TouchControls($('#touch'), input);
  const pause = new PauseMenu($('#pause'), settings, {
    onChange: (key) => {
      saveSettings();
      if (['master', 'sfx', 'music', 'ambience', 'muted'].includes(key)) { audio.set(settings); hud.setMuted(settings.muted); }
      if (key === 'quality') quality.setMode(settings.quality);
      if (key === 'uiScale') applyUiScale();
      if (key === 'timeOfDay') world.lighting.setTimeOfDay(settings.timeOfDay, 2.5);
    },
    onResume: () => closePause(),
    onNewGame: () => { resetSave(); location.reload(); },
  });
  const setServerPause = (on) => { if (client && client.joined) client.send({ t: 'cmd', type: 'pause', on }); };
  function openPause(tab) {
    if (pause.open) return;
    st.paused = true;
    setServerPause(true);
    input.enabled = false;
    input.keys.clear();
    pause.show(tab);
    audio.muffle(true);
  }
  function closePause() {
    pause.hide();
    st.paused = false;
    setServerPause(false);
    input.enabled = st.mode === 'playing';
    audio.muffle(false);
    canvas.focus({ preventScroll: true });
  }
  input.onHotkey('Escape', () => {
    if (pause.open) closePause();
    else if (st.mode === 'playing') openPause('settings');
  });
  input.onHotkey('F3', () => { st.perf = !st.perf; $('#perf').hidden = !st.perf; });
  input.onHotkey('F4', () => { if (devPanel) devPanel.toggle(); });
  // Leaving the tab pauses the game (and the local world).
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.mode === 'playing' && !pause.open) openPause('settings'); });
  input.onHotkey('KeyZ', () => { if (settings.camRotate && st.mode === 'playing' && !st.paused) world.rig.rotate(-1); });
  input.onHotkey('KeyX', () => { if (settings.camRotate && st.mode === 'playing' && !st.paused) world.rig.rotate(1); });
  $('#perf').hidden = !st.perf;

  const title = new TitleScreen($('#title'), settings, {
    onPlay: () => startPlaying(),
    onSettings: () => openPauseFromTitle('settings'),
    onControls: () => openPauseFromTitle('controls'),
  });
  title.onSkin = () => saveSettings();
  function openPauseFromTitle(tab) {
    pause.show(tab);
    const resume = pause.root.querySelector('#btn-resume');
    if (resume) resume.textContent = 'Volver';
  }

  // ---- Net / entities --------------------------------------------------------------------------
  const transport = await transportP;
  var client = new GameClient(transport, map, bus); // var: the pause helpers above run before this line

  const views = world.views;
  const devPanel = new DevPanel($('#devpanel'), { client, world, hud });
  const debugDraw = new DebugDraw(world.scene);
  let loop = null;
  const feedback = new Feedback({ world, client, hud, worldUI, loop: { addHitstop: (h) => loop && loop.addHitstop(h), slowmo: (a, b) => loop && loop.slowmo(a, b), get timeScale() { return loop ? loop.timeScale : 1; }, get alpha() { return loop ? loop.alpha : 0; } }, settings, map, ps, onTutorial: (k, d) => safe('tutorial', () => onTutorial(k, d)) });
  bus.on('combat', (ev) => safe('feedback', () => {
    feedback.handle(ev);
    if (ev.type === 'respawn' && ev.me) st.snapCam = true;
  }));

  bus.on('entity:spawn', (rec) => safe('spawn', () => {
    const isNpc = rec.kind === KIND.NPC;
    const view = world.addCharacter(rec.id, rec.skin, { sword: !isNpc, enemy: rec.enemy || undefined });
    view.lastDashes = 0;
    const practice = rec.def && rec.def.practice;
    if (!rec.isYou) worldUI.addNameplate(rec.id, { name: rec.name, level: rec.level, title: practice ? '' : rec.title, kind: isNpc ? 'npc' : rec.enemy ? (practice ? 'practice' : 'enemy') : 'player' });
    rec.view = view;
    if (rec.ready) view.update(0, rec.r);
  }));
  bus.on('entity:despawn', (rec) => { world.removeCharacter(rec.id); worldUI.removeNameplate(rec.id); });
  bus.on('you:welcome', ({ id }) => { worldUI.removeNameplate(id); });
  bus.on('you:ready', () => {
    const v = views.get(client.youServer);
    if (v) {
      v.onStep = () => safe('step', () => {
        const mat = map.materialAt(ps.x, ps.z);
        world.effects.footstep(ps.x, ps.y, ps.z, mat, ps.wade);
        sfx.step(mat, ps.wade);
      });
    }
  });
  bus.on('local:dash', (d) => safe('dash', () => {
    const v = views.get(client.youServer);
    const accent = SKINS[settings.skin].accent;
    if (v) world.after.dash(v, accent, tuning.dash.afterimages, tuning.dash.afterimageLife);
    const mat = map.materialAt(d.x, d.z);
    world.effects.dashBurst(d.x, map.groundAt(d.x, d.z), d.z, d.dx, d.dz, mat, ps.wade);
    world.lights.flash(d.x, map.groundAt(d.x, d.z) + 1.1, d.z, accent, 5.5, 2.6, 0.32);
    sfx.dash(ps.wade);
    world.rig.punchIn(0.35);
    if (st.tut === 'dash') advanceTutorial();
  }));
  bus.on('local:dashDenied', () => { hud.denyDash(); sfx.denied(); });
  client.start();

  // ---- Tutorial ----------------------------------------------------------------------------------
  const TRACK = [
    { id: 'move', text: isTouch ? 'Muévete con el joystick' : 'Muévete con WASD o las flechas' },
    { id: 'dash', text: isTouch ? 'Toca DASH para esquivar' : 'Haz un dash con ESPACIO' },
    { id: 'attack', text: isTouch ? 'Golpea al muñeco: combo de 3 (ATK)' : 'Golpea al muñeco: combo de 3 golpes (clic izquierdo)' },
    { id: 'parry', text: isTouch ? 'Entra en el aro y devuelve un cañonazo (PARRY)' : 'Entra en el aro y devuelve un cañonazo (clic derecho)' },
    { id: 'village', text: 'Sigue los faroles hasta la Aldea Coralina' },
    { id: 'captain', text: 'Habla con la Capitana Brea' },
    { id: 'path', text: 'Limpia el Sendero del Humo (0/3 arqueros)' },
    { id: 'caldera', text: 'Vence a los centinelas de La Caldera (0/2)' },
  ];
  const kills = { archer: 0, sentinel: 0 };
  const ORDER = TRACK.map((t) => t.id);
  hud.setTracker(TRACK);
  function advanceTutorial() {
    const i = ORDER.indexOf(st.tut);
    if (i < 0) return;
    hud.completeTracker(st.tut);
    const msgs = {
      move: '<b>¡Bien!</b> Ahora prueba el dash.',
      dash: '<b>¡Esquiva!</b> Durante el dash eres invulnerable. Se recarga en 0,9 s.',
      attack: '<b>¡Combo!</b> Los golpes también <b>rompen</b> los proyectiles ámbar que toquen.',
      parry: '<b>¡Devuelto!</b> En los primeros 80 ms del parry es <b>PERFECTO</b>: tiempo lento y el doble de riposte.',
      village: '<b>Aldea Coralina.</b> Busca a la Capitana Brea junto al muelle.',
      captain: '<b>Rumbo al volcán.</b> Cuidado: hay arqueros esqueleto en el Sendero del Humo.',
      path: '<b>Sendero despejado.</b> Al final del humo, La Caldera.',
      caldera: '<b>¡Centinelas derrotados!</b> La Caldera despierta… (las oleadas y el jefe llegan en la próxima versión)',
    };
    hud.toast(msgs[st.tut], 4200);
    sfx.marimba([659.25, 783.99, 1046.5], 0.07, 0.12);
    st.tut = ORDER[i + 1] || 'done';
    // You can reach places out of order: skip what's already done.
    if (st.tut === 'village' && st.zone === 'aldea') setTimeout(advanceTutorial, 400);
    if (st.tut === 'path' && kills.archer >= 3) setTimeout(advanceTutorial, 400);
    if (st.tut === 'caldera' && kills.sentinel >= 2) setTimeout(advanceTutorial, 400);
  }
  function onTutorial(kind, d) {
    if (kind === 'dummy' && d.heavy && st.tut === 'attack') advanceTutorial();
    else if (kind === 'parry' && (st.tut === 'parry' || st.tut === 'attack')) completeUpTo('parry');
    else if (kind === 'target') hud.toast('<b>¡Blanco!</b> Tu reflejo vuelve al que dispara, con el doble de daño.', 3600);
    else if (kind === 'kill' && d && (d.enemy === 'archer' || d.enemy === 'sentinel')) {
      kills[d.enemy]++;
      hud.setTrackerText('path', `Limpia el Sendero del Humo (${Math.min(3, kills.archer)}/3 arqueros)`);
      hud.setTrackerText('caldera', `Vence a los centinelas de La Caldera (${Math.min(2, kills.sentinel)}/2)`);
      if (st.tut === 'path' && kills.archer >= 3) advanceTutorial();
      if (st.tut === 'caldera' && kills.sentinel >= 2) advanceTutorial();
    } else if (kind === 'respawn') hud.toast('<b>Vuelves al último lugar seguro.</b> La vida se recupera sola si nadie te golpea durante 4 s.', 4200);
  }

  // ---- Zones -------------------------------------------------------------------------------------
  function enterZone(z) {
    const prev = st.zone;
    st.zone = z;
    if (z === 'mar') return;
    const Z = ZONES[z];
    if (prev !== null || st.mode === 'playing') hud.showZone(Z.name, Z.sub, z === 'caldera', reduced());
    ambience.setZone(z);
    world.lighting.setZone(z === 'caldera', 2);
    music.setMood(z === 'caldera' ? 'caldera' : 'island');
    if (z === 'caldera') sfx.calderaZone(); else sfx.zone();
    if (z === 'aldea' && st.tut === 'village') advanceTutorial();
  }
  // Reaching a later goal first quietly ticks the earlier ones.
  function completeUpTo(id) {
    const target = ORDER.indexOf(id);
    while (st.tut !== 'done' && ORDER.indexOf(st.tut) < target) { hud.completeTracker(st.tut); st.tut = ORDER[ORDER.indexOf(st.tut) + 1]; }
    if (st.tut === id) advanceTutorial();
  }

  // ---- NPC talk ----------------------------------------------------------------------------------
  const LINES = {
    'Capitana Brea': [
      '¡Un náufrago más! Te doy la bienvenida a la Aldea Coralina. Aquí nadie pregunta de dónde vienes.',
      '¿Ves el humo del volcán? Allí está La Caldera. Quien la cruza sale con un cofre… o no sale.',
      'Antes de ir, practica el dash. Esquivar a tiempo te salva más que cualquier espada.',
      'Mi barco zarpará cuando el mar se calme. Mientras tanto, la isla es tuya.',
    ],
    'Tía Perla': [
      '¡Cocos, ron y vendas! Vuelve cuando tengas oro, corazón.',
      'Dicen que en La Caldera hasta los cangrejos escupen fuego. Yo no me acercaría.',
    ],
  };
  // La Prueba de Fuego (PLAN-M2.5.md): boss bar, wave line, fight zoom, runes and the boss shield.
function encounterUi() {
  const E = client.enc && client.enc[0];
  const A = map.landmarks.arena;
  const inside = Math.hypot(ps.x - A.x, ps.z - A.z) < map.landmarks.arenaR + 5;
  const [, stE, wave, waves, left, bossId, phase, shield, inv] = E || [];
  const active = !!E && stE !== 'idle' && inside;
  let boss = null;
  const rec = bossId ? client.entities.get(bossId) : null;
  if (active && rec && rec.ready && !rec.dying) {
    const def = rec.def || {};
    boss = { name: def.name || 'HELLFIRE', title: def.title || '', hp: rec.r.hp, maxHp: rec.r.maxHp, phase, phases: def.phases ? def.phases.length : 1, mark: def.phases && phase === 0 ? def.phases[0].until : 0, shield, inv };
  }
  hud.setBoss(boss);
  let line = null;
  if (active) {
    if (stE === 'intro') line = 'La Prueba de Fuego';
    else if (stE === 'wave') line = `OLEADA ${wave + 1}/${waves} · Enemigos <b>${left}</b>`;
    else if (stE === 'rest') line = `Respira… · se acerca la OLEADA ${wave + 2}/${waves}`;
    else if (stE === 'boss' && left > 1) line = `Esbirros <b>${left - 1}</b>`;
    else if (stE === 'victory') line = '¡Victoria!';
  }
  hud.setEnc(line);
  world.rig.fightZoom = active && stE !== 'victory' ? 1.18 : 1;
  world.setEncounterFx({ runes: !E || stE === 'idle' ? 1 : 0, bossId: active ? bossId : 0, shield, inv });
  // One warning when walking out mid-trial.
  if (E && stE !== 'idle' && stE !== 'victory' && !inside && Math.hypot(ps.x - A.x, ps.z - A.z) < map.landmarks.arenaR + 12 && !st.encWarned) {
    st.encWarned = true;
    hud.toast('<b>Si sales de La Caldera</b>, la Prueba de Fuego se reinicia.', 3600);
  }
  if (!E || stE === 'idle') st.encWarned = false;
}

function nearestNpc() {
    let best = null, bd = 3.2;
    for (const rec of client.entities.values()) {
      if (rec.kind !== KIND.NPC || !rec.ready) continue;
      const d = Math.hypot(rec.r.x - ps.x, rec.r.z - ps.z);
      if (d < bd) { bd = d; best = rec; }
    }
    return best;
  }
  const shipPos = map.landmarks.dockEnd;

  // ---- Play ------------------------------------------------------------------------------------
  async function startPlaying() {
    audio.unlock();
    audio.set(settings);
    ambience.start();
    music.start();
    sfx.play();
    saveSettings();
    client.join(settings.name, settings.skin);
    await title.hide();
  }
  bus.on('you:ready', () => {
    st.mode = 'playing';
    world.setTitleShadows(false);
    const rec = client.entities.get(client.youServer);
    hud.setPlayer({ name: settings.name, level: rec ? rec.level : 1, skin: settings.skin, portrait: portrait(settings.skin) });
    client.localState(1, ps);
    focus.set(ps.x, ps.y, ps.z);
    world.rig.snapTo(focus);
    world.rig.blendFromCurrent(reduced() ? 0.6 : 2.2);
    setTimeout(() => {
      hud.show();
      input.enabled = true;
      if (isTouch) touch.show();
      canvas.focus({ preventScroll: true });
    }, reduced() ? 300 : 1500);
  });

  function sheetFrame(dt) {
    const sh = st.sheet, n = sh.views.length, c = sh.center;
    sh.views.forEach((v, i) => {
      const x = c.x + (i - (n - 1) / 2) * sh.gap, z = c.z;
      const sp = sh.run ? 6.5 : 0;
      v.update(dt, { x, y: map.groundAt(x, z), z, f: sh.yaw, vx: Math.sin(sh.yaw) * sp, vz: Math.cos(sh.yaw) * sp, st: 0, wade: 0 });
    });
    const p = (sh.pitch * Math.PI) / 180, cam = world.camera;
    const ty = c.y + (sh.pitch > 30 ? 0.6 : 1.0);
    cam.position.set(c.x, ty + Math.sin(p) * sh.dist, c.z + Math.cos(p) * sh.dist);
    cam.lookAt(c.x, ty, c.z);
    cam.updateMatrixWorld();
    focus.copy(c);
  }

  // Touch / keyboard-only aim: the nearest enemy within 9 u, else the way you are moving or facing.
  function autoAim(mv) {
    // First the most imminent projectile on a collision course (keyboard / touch parry faces it).
    const H = client.hazards, pt = (client.ptCur || 0) + 1, reach = tuning.player.hurtRadius + tuning.projectiles.graze + 0.5;
    let threat = -1, tBest = 0.7;
    for (let s = 0; s < H.cap; s++) {
      if (!H.live(s, pt)) continue;
      const rx = ps.x - H.px(s, pt), rz = ps.z - H.pz(s, pt), v2 = H.vx[s] * H.vx[s] + H.vz[s] * H.vz[s];
      if (v2 < 1e-6) continue;
      const tca = (rx * H.vx[s] + rz * H.vz[s]) / v2;
      if (tca < 0 || tca > tBest) continue;
      if (Math.hypot(rx - H.vx[s] * tca, rz - H.vz[s] * tca) > reach + H.r[s]) continue;
      threat = s; tBest = tca;
    }
    if (threat >= 0) { aim.set(H.px(threat, pt), ps.y, H.pz(threat, pt)); return; }
    let best = null, bd = 9;
    for (const rec of client.entities.values()) {
      if (!rec.enemy || !rec.ready || rec.dying || rec.enemy === 'cannon') continue;
      const d = Math.hypot(rec.r.x - ps.x, rec.r.z - ps.z);
      if (d < bd) { bd = d; best = rec; }
    }
    if (best) aim.set(best.r.x, ps.y, best.r.z);
    else if (Math.hypot(mv.x, mv.z) > 0.2) aim.set(ps.x + mv.x * 3, ps.y, ps.z + mv.z * 3);
    else aim.set(ps.x + Math.sin(ps.f) * 3, ps.y, ps.z + Math.cos(ps.f) * 3);
  }
  // Reflected shots leave a cyan trail.
  let trailFrame = 0;
  const shotTrail = (s, x, y, z) => {
    const S = client.shots;
    if ((trailFrame + s) & 1) return;
    const heavy = S.heavy[s];
    world.effects.streaks.spawn(x, y, z, -S.vx[s] * 0.12, 0, -S.vz[s] * 0.12, { life: 0.3, width: heavy ? 0.42 : 0.17, stretch: 0.6, color: [0.75, 1, 1], color1: [0.1, 0.6, 1], gravity: 0, drag: 2 });
  };
  // F4 → hitboxes: hurtboxes (green / red), graze band, parry and swing sectors, projectile radii.
  const PCOL = [0xffb02e, 0xff5a1f, 0x9b4dff];
  function drawHitboxes(tick) {
    const D = debugDraw, y = ps.y + 0.12;
    D.begin();
    D.circle(ps.x, y, ps.z, tuning.player.hurtRadius, 0x7be07b, 16);
    D.circle(ps.x, y, ps.z, tuning.player.hurtRadius + tuning.projectiles.parryable.radius + tuning.projectiles.graze, 0x2a8f9a, 28);
    D.sector(ps.x, y + 0.04, ps.z, tuning.parry.radius, ps.f, tuning.parry.arc, ps.act === ACT.PARRY ? 0xffffff : 0x3b7fa0);
    if (ps.atkStage) { const st2 = tuning.melee.stages[ps.atkStage - 1]; D.sector(ps.x, y + 0.08, ps.z, st2.range, ps.f, st2.arc, 0xffc23d); }
    for (const rec of client.entities.values()) {
      if (!rec.enemy || !rec.ready || rec.dying) continue;
      D.circle(rec.r.x, rec.r.y + 0.12, rec.r.z, rec.def.hurt, 0xff5a64, 16);
      if (rec.def.aggro) D.circle(rec.r.x, rec.r.y + 0.12, rec.r.z, rec.def.aggro, 0x5a2a3a, 40);
    }
    const H = client.hazards;
    for (let s = 0; s < H.cap; s++) {
      if (!H.live(s, Math.floor(tick))) continue;
      const x = H.px(s, tick), z = H.pz(s, tick), hy = H.py(s, tick);
      D.circle(x, hy, z, H.r[s], H.armed(s, tick) ? PCOL[H.type[s]] : 0xffffff, 12);
    }
    for (const a of H.aoes) if (!a.cancel && tick < a.tAct + 10) D.circle(a.x, map.groundAt(a.x, a.z) + 0.15, a.z, a.r, 0xff3b30, 40);
    D.end(true);
  }

  // ---- Loop --------------------------------------------------------------------------------------
  loop = new Loop({
    fixed: () => safe('fixed', () => {
      if (st.mode !== 'playing' || !client.joined || st.paused) return;
      input.axes(axes);
      world.rig.moveBasis(axes.x, axes.y, move);
      const prs = input.consumePresses();
      // Touch / keyboard-only: aim at the nearest enemy in front, else where you are going.
      if (input.lastDevice !== 'mouse') autoAim(move);
      client.tickInput({ mx: move.x, mz: move.z, ax: aim.x, az: aim.z, btn: input.held, prs });
    }),
    frame: (realDt, simDt, alpha) => {
      loop.paused = st.paused;
      trailFrame++;
      safe('net', () => { transport.flush(); client.update(simDt, realDt); });
      const playing = st.mode === 'playing' && client.joined;
      if (playing) safe('local', () => client.localState(alpha, ps));
      const viewTick = client.viewTick(alpha);

      // Characters.
      safe('chars', () => {
        anchors.clear();
        for (const rec of client.entities.values()) {
          const view = rec.view;
          if (!view) continue;
          let s;
          if (rec.id === client.youServer) {
            if (!playing) { view.root.visible = false; continue; }
            view.root.visible = true;
            s = ps;
          } else {
            if (!rec.ready || view.dead) { view.root.visible = false; continue; }
            view.root.visible = true;
            s = rec.r;
            if (rec.enemy) worldUI.setPlate(rec.id, { hp: s.hp, maxHp: s.maxHp, level: s.lvl });
            // Remote players' swings: a slash when their action turns into a new stage.
            if (!rec.enemy && s.act >= ACT.SWING1 && s.act <= ACT.SWING3 && s.act !== view.lastAct) {
              const st2 = tuning.melee.stages[s.act - ACT.SWING1];
              world.combatFx.slash(view, s.act - ACT.SWING1 + 1, SKINS[rec.skin]?.accent ?? 0x3bf0ff, st2.active, Math.max(0, st2.windup - s.actT));
            }
            view.lastAct = s.act;
            if (s.dashes !== view.lastDashes) {
              if (view.lastDashes) {
                world.after.dash(view, SKINS[rec.skin]?.accent ?? 0x3bf0ff, [0, 0.07, 0.14], 0.22);
                world.effects.dashBurst(s.x, s.y, s.z, Math.sin(s.f), Math.cos(s.f), map.materialAt(s.x, s.z), s.wade);
              }
              view.lastDashes = s.dashes;
            }
          }
          view.update(simDt, s);
          // Wading leaves a trail of foam ripples (anyone: you, bots, NPCs).
          if ((s.wade || 0) > 0.08) {
            view.rippleT = (view.rippleT || 0) - realDt;
            if (view.rippleT <= 0) {
              const moving = Math.hypot(s.vx, s.vz) > 1;
              world.effects.ripple(s.x, 0.02, s.z, moving ? 1.05 : 0.8, moving ? 0.95 : 1.5);
              view.rippleT = moving ? 0.17 : 1.1;
            }
          }
          const dist = Math.hypot(s.x - focus.x, s.z - focus.z);
          anchor(rec.id, s.x, s.y + view.height + 0.22, s.z, dist);
        }
      });

      // Gameplay-side client logic (tutorial, zones, interaction).
      if (playing) safe('logic', () => {
        if (st.last) st.moved += Math.hypot(ps.x - st.last.x, ps.z - st.last.z);
        st.last = { x: ps.x, z: ps.z };
        if (st.tut === 'move' && st.moved > 4) advanceTutorial();
        const z = map.zoneAt(ps.x, ps.z);
        if (z !== st.zone) {
          if (z === st.zoneCandidate) { st.zoneTimer += realDt; if (st.zoneTimer > 0.35 || st.zone === null) enterZone(z); }
          else { st.zoneCandidate = z; st.zoneTimer = 0; if (st.zone === null) enterZone(z); }
        } else st.zoneCandidate = null;
        // One action prompt floats under the player's feet: interaction first, then the tutorial.
        const npc = nearestNpc();
        const nearShip = Math.hypot(ps.x - shipPos.x, ps.z - shipPos.z) < 4;
        let act = null;
        if (npc) act = `<span class="kbd">F</span> Hablar con ${npc.name}`;
        else if (nearShip) act = '<span class="kbd">F</span> ZARPAR · próximamente';
        else if (st.tut === 'move') act = isTouch ? 'Usa el joystick para moverte' : '<span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span> para moverte';
        else if (st.tut === 'dash') act = isTouch ? 'Toca <b>DASH</b> para esquivar' : '<span class="kbd">ESPACIO</span> para hacer dash';
        else if (st.tut === 'attack') {
          const d = Math.hypot(ps.x - map.practice.dummy.x, ps.z - map.practice.dummy.z);
          act = d < 7 ? (isTouch ? 'Toca <b>ATK</b> tres veces seguidas' : '<span class="kbd">LMB</span> <span class="kbd">LMB</span> <span class="kbd">LMB</span> combo de 3') : 'El muñeco de práctica está junto a la orilla';
        } else if (st.tut === 'parry') {
          const d = Math.hypot(ps.x - map.practice.ring.x, ps.z - map.practice.ring.z);
          act = d < map.practice.ring.r ? (isTouch ? 'Toca <b>PARRY</b> justo antes del impacto' : '<span class="kbd">RMB</span> justo antes de que la bala te toque') : 'Entra en el aro de cuerda, frente al cañón';
        }
        anchor('you', ps.x, ps.y - 0.1, ps.z, 0);
        if (act) worldUI.setPrompt('you', act, { below: true }); else worldUI.hidePrompt('you');
        if (input.consumeInteract()) {
          if (npc) {
            const lines = LINES[npc.name] || ['…'];
            const key = npc.name;
            const i = (st.talkIdx[key] = ((st.talkIdx[key] ?? -1) + 1) % lines.length);
            worldUI.bubble(npc.id, `<b>${npc.name}</b>${lines[i]}`, 5200);
            sfx.talk();
            if (npc.name === 'Capitana Brea' && st.tut === 'captain') advanceTutorial();
          } else if (nearShip) {
            hud.toast('<b>El barco aún no zarpa.</b> La navegación llegará en una próxima actualización.', 3600);
            sfx.click();
          }
        }
        // Mouse aim (raycast cursor → plane at player height) for the camera look-ahead.
        if (input.lastDevice === 'mouse' && input.mouse.moved) {
          ndc.set((input.mouse.x / innerWidth) * 2 - 1, -(input.mouse.y / innerHeight) * 2 + 1);
          ray.setFromCamera(ndc, world.camera);
          plane.constant = -ps.y;
          if (!ray.ray.intersectPlane(plane, aim)) aim.set(ps.x, ps.y, ps.z);
        } else aim.set(ps.x, ps.y, ps.z);
        const zw = input.consumeWheel();
        if (zw) world.rig.zoom(zw > 0 ? 1 : -1);
        hud.setDash(Math.floor(ps.charges), ps.maxCharges, ps.recharge / tuning.dash.recharge);
        hud.setStats({
          hp: ps.hp, maxHp: ps.maxHp, riposte: ps.riposte, xp: ps.xp, xpNext: xpToNext(ps.level), level: ps.level,
          parryLock: ps.parryLock, combo: ps.atkStage ? ps.atkStage : 0, dead: ps.dead, deadT: ps.deadT,
        });
        hud.setChain(ps.chain, ps.chainT <= tuning.parry.chainGap && !ps.dead);
        encounterUi();
        world.combatFx.setGuard(views.get(client.youServer), ps.act === ACT.PARRY, false);
        if (isTouch) touch.setDash(Math.floor(ps.charges), ps.maxCharges, ps.recharge / tuning.dash.recharge);
      });

      // Camera.
      safe('camera', () => {
        world.rig.shakeScale = settings.shake * (settings.reducedMotion ? 0.3 : 1);
        if (st.sheet) sheetFrame(realDt);
        else if (playing) {
          focus.set(ps.x, ps.y, ps.z);
          if (st.snapCam) { world.rig.snapTo(focus); st.snapCam = false; }
          world.rig.update(realDt, focus, input.lastDevice === 'mouse' ? aim : null, loop.timeScale);
        } else {
          // Title: slow orbit around the island.
          st.titleAngle += realDt * (reduced() ? 0.008 : 0.03);
          const c = world.camera;
          const cx = map.landmarks.village.x * 0.35, cz = map.landmarks.village.z * 0.35;
          c.position.set(cx + Math.cos(st.titleAngle) * 165, 58, cz + Math.sin(st.titleAngle) * 165);
          c.lookAt(cx - Math.cos(st.titleAngle) * 20, 6, cz - Math.sin(st.titleAngle) * 20);
          c.updateMatrixWorld();
          focus.set(cx, 0, cz);
        }
      });

      safe('world', () => {
        // Shadows cover what the tilted camera sees: centered a bit ahead of the player.
        if (st.sheet) shadowFocus.copy(st.sheet.center);
        else if (playing) { world.rig.forward(shadowFocus); shadowFocus.multiplyScalar(7).add(focus); }
        else shadowFocus.copy(focus);
        world.update(realDt, { focus, playing, shadowFocus, simDt, combat: { hazards: client.hazards, shots: client.shots, tick: viewTick, onShot: shotTrail } });
        feedback.update(realDt, viewTick);
        if (devPanel.flags.hitboxes) drawHitboxes(viewTick);
        else debugDraw.end(false);
      });
      safe('audio', () => ambience.update());
      safe('worldui', () => {
        if (playing) worldUI.project(tmpV.set(ps.x, ps.y + 1, ps.z), screenP);
        worldUI.update(anchors, screenP);
      });
      safe('render', () => world.render());
      safe('quality', () => quality.frame(realDt, playing && !st.paused));
      st.fps = st.fps * 0.9 + (1 / Math.max(loop.rawDt, 1e-3)) * 0.1;
      if (st.perf) safe('perf', () => {
        const info = world.renderer.info;
        $('#perf').textContent =
          `FPS ${st.fps.toFixed(0)}  calidad ${quality.current}${settings.quality === 'auto' ? ' (auto)' : ''}\n` +
          `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k\n` +
          `entidades ${client.entities.size}  red ${transport.kind}  snaps ${transport.stats.snaps}\n` +
          `pred err ${client.stats.predErr.toFixed(4)}  cmds pendientes ${client.stats.pending}\n` +
          `pos ${ps.x.toFixed(1)}, ${ps.z.toFixed(1)}  zona ${st.zone || '-'}\n` +
          `proyectiles ${client.hazards.count}  reflejos ${client.shots.count}  pt ${client.ptCur} (${client.stats.ptLag >= 0 ? '+' : ''}${client.stats.ptLag})`;
      });
    },
  });

  // First frames under the black fade, then compile everything before enabling JUGAR.
  if (debug) gsap.ticker.lagSmoothing(0);
  if (debug && params.get('maxdt')) { loop.maxFrameDt = +params.get('maxdt'); loop.maxSteps = Math.ceil(loop.maxFrameDt / DT); }
  world.setTitleShadows(true);
  world.onResize();
  worldUI.resize(innerWidth, innerHeight);
  loop.start();
  await new Promise((r) => setTimeout(r, 60));
  await world.prewarm().catch((e) => console.warn('prewarm', e));
  safe('portraits', () => title.setPortraits(portrait));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  gsap.to('#fade', { opacity: 0, duration: reduced() ? 0.3 : 1.2, ease: 'power2.out', onComplete: () => { $('#fade').style.display = 'none'; } });
  title.show(reduced());
  title.ready();
  window.__mn = { world, client, settings, st, ps, map, quality, transport, loop, input, errors };
  if (debug) {
    window.__mn.teleport = (x, z) => transport.send({ t: 'cmd', type: 'debug_teleport', x, z });
    // Lighting: __mn.tod('night'), __mn.tod('cycle', 0.75) jumps the cycle to midnight.
    window.__mn.tod = (mode, phase, seconds = 0) => {
      world.lighting.setTimeOfDay(mode, seconds);
      if (phase !== undefined) world.lighting.setPhase(phase);
      return { tod: world.lighting.tod, phase: world.lighting.phase, lights: world.lights.picked.filter((s) => s.w > 0).map((s) => s.kind) };
    };
    // Bloom debug views: __mn.view('bloom') (bloom only), __mn.view('glow') (glow mask), __mn.view() (normal).
    window.__mn.view = (v) => { world.pipeline.view = { bloom: 1, glow: 2 }[v] || 0; return world.pipeline.view; };
    // Freeze-frame FX check for screenshots at low frame rates.
    window.__mn.fxTest = () => {
      const v = views.get(client.youServer);
      if (!v) return;
      const f = ps.f, dx = Math.sin(f), dz = Math.cos(f);
      [0.9, 1.8, 2.7].forEach((back, i) => {
        v.root.position.set(ps.x - dx * back, ps.y, ps.z - dz * back);
        world.after.capture(v, SKINS[settings.skin].accent, 30, 0.7 - i * 0.18);
      });
      v.root.position.set(ps.x, ps.y, ps.z);
      for (let i = 0; i < 6; i++) world.effects.alpha.spawn(ps.x - dx * (0.5 + i * 0.5), ps.y + 0.15, ps.z - dz * (0.5 + i * 0.5), 0, 0, 0, { life: 30, size: 0.45 + i * 0.05, color: [0.97, 0.9, 0.72], alpha: 0.8, drag: 10 });
      world.effects.ripple(ps.x + 2, Math.max(ps.y, 0) + 0.03, ps.z + 1, 2.2, 30);
    };
    // Character sheet: every look in a row on the beach. yaw turns them, run plays the cycle in place,
    // pitch/dist frame the camera (8°/6.5 = sheet, 48°/17 = gameplay view).
    window.__mn.sheet = (o = {}) => {
      if (!st.sheet) {
        const c = map.toWorld(-136, -12);
        const center = new THREE.Vector3(c.x, 0, c.z);
        center.y = map.groundAt(center.x, center.z);
        const ids = o.list || SKINS.map((_, i) => i);
        const views2 = ids.map((i) => { const v = new CharacterView(i, { sword: !SKINS[i].npc }); world.scene.add(v.root); return v; });
        world.pipeline.markDirty();
        st.sheet = { center, views: views2, yaw: 0, run: false, pitch: 8, dist: 8, gap: 1.05 };
        world.nearFade(false);
      }
      Object.assign(st.sheet, o);
    };
  }
}

boot().catch((err) => {
  console.error(err);
  if (window.__mnFail) window.__mnFail('Algo falló al iniciar el juego. Recarga la página para intentarlo de nuevo.');
});

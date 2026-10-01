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
import { KIND } from './sim/ecs.js';
import { BTN } from './sim/systems/movement.js';
import { createTransport } from './net/transport.js';
import { GameClient } from './client/gameClient.js';
import { GameScene } from './render/scene.js';
import { SKINS } from './render/characters.js';
import { Quality } from './render/quality.js';
import { TitleScreen } from './ui/title.js';
import { Hud } from './ui/hud.js';
import { WorldUI } from './ui/worldui.js';
import { PauseMenu } from './ui/pause.js';
import { TouchControls } from './ui/touch.js';
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
  const input = new Input(canvas);
  const worldUI = new WorldUI($('#world-ui'), world.camera);
  const ambience = new Ambience();
  const music = new Music();
  const reduced = () => settings.reducedMotion;

  const quality = new Quality((cfg) => world.applyQuality(cfg), settings.quality, isTouch);
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
  const ps = { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, mag: 0, wade: 0, dashT: -1, dashes: 0, charges: 1, maxCharges: 1, recharge: 0, iframes: 0 };
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
    },
    onResume: () => closePause(),
    onNewGame: () => { resetSave(); location.reload(); },
  });
  function openPause(tab) {
    if (pause.open) return;
    st.paused = true;
    input.enabled = false;
    input.keys.clear();
    pause.show(tab);
    audio.muffle(true);
  }
  function closePause() {
    pause.hide();
    st.paused = false;
    input.enabled = st.mode === 'playing';
    audio.muffle(false);
    canvas.focus({ preventScroll: true });
  }
  input.onHotkey('Escape', () => {
    if (pause.open) closePause();
    else if (st.mode === 'playing') openPause('settings');
  });
  input.onHotkey('F3', () => { st.perf = !st.perf; $('#perf').hidden = !st.perf; });
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
  const client = new GameClient(transport, map, bus);
  const views = world.views;

  bus.on('entity:spawn', (rec) => safe('spawn', () => {
    const isNpc = rec.kind === KIND.NPC;
    const view = world.addCharacter(rec.id, rec.skin, { sword: !isNpc });
    view.lastDashes = 0;
    if (!rec.isYou) worldUI.addNameplate(rec.id, { name: rec.name, level: rec.level, title: rec.title, kind: isNpc ? 'npc' : 'player' });
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
    { id: 'village', text: 'Sigue los faroles hasta la Aldea Coralina' },
    { id: 'captain', text: 'Habla con la Capitana Brea' },
    { id: 'caldera', text: 'Sigue el humo hasta La Caldera' },
  ];
  const ORDER = TRACK.map((t) => t.id);
  hud.setTracker(TRACK);
  function advanceTutorial() {
    const i = ORDER.indexOf(st.tut);
    if (i < 0) return;
    hud.completeTracker(st.tut);
    const msgs = {
      move: '<b>¡Bien!</b> Ahora prueba el dash.',
      dash: '<b>¡Esquiva!</b> Durante el dash eres invulnerable. Se recarga en 0,9 s.',
      village: '<b>Aldea Coralina.</b> Busca a la Capitana Brea junto al muelle.',
      captain: '<b>Rumbo al volcán.</b> El Sendero del Humo empieza en la aldea.',
      caldera: '<b>La Caldera.</b> Los braseros arden. Algo enorme duerme bajo la roca.',
    };
    hud.toast(msgs[st.tut], 4200);
    sfx.marimba([659.25, 783.99, 1046.5], 0.07, 0.12);
    st.tut = ORDER[i + 1] || 'done';
    // You can reach places out of order: skip what's already done.
    if (st.tut === 'village' && st.zone === 'aldea') setTimeout(advanceTutorial, 400);
  }

  // ---- Zones -------------------------------------------------------------------------------------
  function enterZone(z) {
    const prev = st.zone;
    st.zone = z;
    if (z === 'mar') return;
    const Z = ZONES[z];
    if (prev !== null || st.mode === 'playing') hud.showZone(Z.name, Z.sub, z === 'caldera', reduced());
    ambience.setZone(z);
    world.lighting.setPreset(z === 'caldera' ? 'golden' : 'day', 2);
    music.setMood(z === 'caldera' ? 'caldera' : 'island');
    if (z === 'caldera') sfx.calderaZone(); else sfx.zone();
    if (z === 'aldea' && st.tut === 'village') advanceTutorial();
    if (z === 'caldera') completeUpTo('caldera');
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
    hud.setPlayer({ name: settings.name, level: rec ? rec.level : 1, skin: settings.skin });
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

  // ---- Loop --------------------------------------------------------------------------------------
  const loop = new Loop({
    fixed: () => safe('fixed', () => {
      if (st.mode !== 'playing' || !client.joined) return;
      input.axes(axes);
      world.rig.moveBasis(axes.x, axes.y, move);
      const prs = input.consumePresses();
      client.tickInput({ mx: move.x, mz: move.z, ax: aim.x, az: aim.z, btn: input.held, prs: st.paused ? 0 : prs });
    }),
    frame: (realDt, simDt, alpha) => {
      safe('net', () => { transport.flush(); client.update(realDt); });
      const playing = st.mode === 'playing' && client.joined;
      if (playing) safe('local', () => client.localState(alpha, ps));

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
            if (!rec.ready) { view.root.visible = false; continue; }
            view.root.visible = true;
            s = rec.r;
            if (s.dashes !== view.lastDashes) {
              if (view.lastDashes) {
                world.after.dash(view, SKINS[rec.skin]?.accent ?? 0x3bf0ff, [0, 0.07, 0.14], 0.22);
                world.effects.dashBurst(s.x, s.y, s.z, Math.sin(s.f), Math.cos(s.f), map.materialAt(s.x, s.z), s.wade);
              }
              view.lastDashes = s.dashes;
            }
          }
          view.update(realDt, s);
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
          anchor(rec.id, s.x, s.y + (rec.kind === KIND.NPC && SKINS[rec.skin]?.hat ? 2.3 : 2.0), s.z, dist);
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
        if (isTouch) touch.setDash(Math.floor(ps.charges), ps.maxCharges, ps.recharge / tuning.dash.recharge);
      });

      // Camera.
      safe('camera', () => {
        world.rig.shakeScale = settings.shake * (settings.reducedMotion ? 0.3 : 1);
        if (playing) {
          focus.set(ps.x, ps.y, ps.z);
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
        if (playing) { world.rig.forward(shadowFocus); shadowFocus.multiplyScalar(7).add(focus); }
        else shadowFocus.copy(focus);
        world.update(realDt, { focus, playing, shadowFocus });
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
          `pos ${ps.x.toFixed(1)}, ${ps.z.toFixed(1)}  zona ${st.zone || '-'}`;
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
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  gsap.to('#fade', { opacity: 0, duration: reduced() ? 0.3 : 1.2, ease: 'power2.out', onComplete: () => { $('#fade').style.display = 'none'; } });
  title.show(reduced());
  title.ready();
  window.__mn = { world, client, settings, st, ps, map, quality, transport, loop, input, errors };
  if (debug) {
    window.__mn.teleport = (x, z) => transport.send({ t: 'cmd', type: 'debug_teleport', x, z });
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
  }
}

boot().catch((err) => {
  console.error(err);
  if (window.__mnFail) window.__mnFail('Algo falló al iniciar el juego. Recarga la página para intentarlo de nuevo.');
});

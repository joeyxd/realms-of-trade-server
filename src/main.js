import { t, text as ltext, rich, attr, setText, setDataText, translateData, dataText, getLocale, onLocaleChange, initI18n } from './core/i18n.js';
// Entry point: boot, title, play loop. Every per-frame subsystem runs inside safe() so one failure
// never freezes the game.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { GAME } from './data/meta.js';
import { tuning, DT } from './data/tuning.js';
import { loadSettings, saveSettings, resetSave, settings, loadSave, storeSave, setSaveAside } from './core/settings.js';
import { Input } from './core/input.js';
import { stage } from './ui/stage.js';
import { Loop } from './core/loop.js';
import { bus } from './core/events.js';
import { generateWorld, ZONES } from './sim/worldgen.js';
import { KIND, ACT } from './sim/ecs.js';
import { xpToNext } from './sim/systems/combat.js';
import { PTYPE, SHOT } from './sim/projectiles.js';
import { ENEMIES } from './data/enemies.js';
import { BTN } from './sim/systems/movement.js';
import { rackNear, skillOf, skillNum, rainR } from './sim/systems/skills.js';
import { canStand } from './sim/systems/movement.js';
import { castKind, isArt, ARTS, skillId } from './data/tattoos.js';
import { AimCast } from './client/aimcast.js';
import { WEAPONS, WEAPON_KINDS, SKILLS, weaponIndex, weaponOf } from './data/weapons.js';
import { createTransport, probeServer, servedByGameServer, httpUrlFor } from './net/transport.js';
import { GameClient } from './client/gameClient.js';
import { AccountAuth } from './client/accountAuth.js';
import { WalletLink } from './client/walletLink.js';
import { AccountPanel } from './ui/account.js';
import { CompanionsClient } from './client/companions.js';
import { CompanionsUI } from './ui/companions.js';
import { CompanionConfigClient } from './client/companionConfig.js';
import { CompanionConfigUI } from './ui/companionConfig.js';
import { GameScene } from './render/scene.js';
import { SKINS, CharacterView, PortraitStudio } from './render/characters.js';
import { Quality } from './render/quality.js';
import { gpuInfo } from './render/gpu.js';
import { TitleScreen } from './ui/title.js';
import { Hud, drawPortrait } from './ui/hud.js';
import { WorldUI } from './ui/worldui.js';
import { PauseMenu } from './ui/pause.js';
import { TouchControls } from './ui/touch.js';
import { Feedback } from './ui/feedback.js';
import { comic } from './ui/comic.js';
import { DevPanel } from './ui/devpanel.js';
import { DebugDraw } from './render/debugdraw.js';
import { Rewards } from './ui/rewards.js';
import { CharPanel } from './ui/charpanel.js';
import { Dialog } from './ui/dialog.js';
import { MapView } from './ui/mapview.js';
import { MiniMap } from './ui/minimap.js';
import { RaftEditor } from './ui/raftEditor.js';
import { RaftDoorActions } from './ui/raftDoorActions.js';
import { RaftLanternActions } from './ui/raftLanternActions.js';
import { FirePanel } from './ui/firePanel.js';
import { PersonalLanternActions } from './ui/personalLanternActions.js';
import { CommercePanel } from './ui/commerce.js';
import { ResourceActions } from './ui/resourceActions.js';
import { WorkbenchPanel } from './ui/workbench.js';
import { CommunityPanel } from './ui/community.js';
import { ArtisanPanel } from './ui/artisan.js';
import { WorkshopPanel } from './ui/workshop.js';
import { ChatPanel } from './ui/chat.js';
import { ChatBubbles } from './ui/chatBubbles.js';
import { MSG, PROTOCOL_VERSION } from './net/protocol.js';
import { QUESTS, QUEST_IDS, QST, NPC_TALK, goalCount } from './data/quests.js';
import { ENCOUNTERS } from './data/encounters.js';
import { MASTERY } from './data/weapons.js';
import { CONSUMABLES } from './data/items.js';
import { phaseAt } from './data/clock.js';
import { elementVisual } from './data/elements.js';
import { audio } from './audio/engine.js';
import { sfx } from './audio/sfx.js';
import { harvestSound } from './audio/harvest.js';
import { startHarvestPose } from './render/harvestPose.js';
import { Ambience } from './audio/ambience.js';
import { Music } from './audio/music.js';
import { assets } from './render/assets/registry.js';
import { loadGmWorldContent } from './editor/activeContent.js';
import { installGmContent } from './editor/contentProjection.js';
import { loadNavalRaftSkin } from './render/naval/raft-skin.js';
import { LiveNavigationView } from './client/liveNavigationView.js';
import { SwimStatus } from './client/swimStatus.js';
import { GmEntry } from './editor/entry.js';

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
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s) => document.querySelector(s);

async function boot() {
  initI18n();
  document.title = GAME.title.charAt(0) + GAME.title.slice(1).toLowerCase().replace(/ (\w)/, (m, c) => ' ' + c.toUpperCase());
  loadSettings();
  if (!settings.name) {
    settings.name = 'Grumete' + (100 + Math.floor(Math.random() * 900));
    saveSettings();
  }
  if (params.get('q')) settings.quality = params.get('q');
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  document.body.classList.toggle('touch', isTouch);
  // Phones upright draw the whole game rotated 90° (stage.js); this runs before anything is sized.
  stage.configure({ enabled: () => isTouch && settings.landscape !== false });
  stage.update();
  const applyUiScale = () => document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  applyUiScale();

  // Imported models and textures (assets/manifest.json; docs/ASSETS.md) load while the world generates; anything
  // missing or broken stays procedural. ?noassets skips them (compare against the procedural look).
  const assetsP = params.has('noassets') ? Promise.resolve(assets) : assets.load('assets/manifest.json');
  const raftSkinP = params.has('noassets') ? Promise.resolve(null) : loadNavalRaftSkin({ mobile: isTouch });
  const baseMap = generateWorld(GAME.seed);
  const map = { ...baseMap };
  const debug = params.has('debug');
  // Online when this page comes from the game server (or ?server=ws://…), solo with ?solo or without one.
  // ?lag=&jitter= add artificial latency per direction (testing).
  const transportP = createTransport({
    seed: GAME.seed, bots: 5, preferWorker: params.get('worker') !== '0', debug,
    server: params.get('server'), solo: params.has('solo'), lagMs: +params.get('lag') || 0, jitterMs: +params.get('jitter') || 0,
  });
  const canvas = $('#game');
  await assetsP;
  const transport = await transportP;
  const gmContent = transport.kind === 'ws' ? await loadGmWorldContent({ httpBase: httpUrlFor(transport.url),
    map, baseMap, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION }) : null;
  const world = new GameScene(canvas, map, { raftSkin: await raftSkinP });
  let gmContentLayer = null;
  if (gmContent?.revision) {
    const { createGmContentLayer } = await import('./render/gmContent.js');
    gmContentLayer = createGmContentLayer({ scene: world.scene, map: baseMap, assets });
    await gmContentLayer.load(gmContent.revision.content.document, gmContent.revision.content.assets);
  }
  // Title/editor screenshots may select a preset. Playing always follows the shared world clock.
  world.lighting.setTimeOfDay(debug ? params.get('tod') || 'cycle' : 'cycle', 0);
  if (debug && params.get('phase')) world.lighting.setPhase(+params.get('phase'));
  const input = new Input(canvas);
  const worldUI = new WorldUI($('#world-ui'), world.camera);
  const ambience = new Ambience();
  const music = new Music();
  const reduced = () => settings.reducedMotion;

  // The GPU's name and class, read once: AUTO starts a strong one on Ultra, and the settings show it.
  const gpu = safe('gpu', () => gpuInfo(world.renderer, isTouch)) || { name: '', tier: 'mid' };
  const quality = new Quality((cfg) => world.applyQuality(cfg), settings.quality, isTouch, gpu.tier);
  // Comic hits (impact frames, speed lines, onomatopoeia): Ultra only, and the player can turn them off.
  comic.configure({ pipeline: world.pipeline, camera: world.camera, worldUI, settings, isOn: () => quality.current === 'ultra' && settings.comicFx !== false });
  const studio = safe('portrait', () => new PortraitStudio(world.renderer));
  const portrait = (i) => (studio ? safe('portrait', () => studio.render(i)) : null);
  // The stage (not the window) is what the renderer and the world-anchored UI are sized to.
  stage.onChange(() => safe('resize', () => { world.onResize(); worldUI.resize(stage.w, stage.h); }));

  // ---- State -----------------------------------------------------------------------------------
  const st = {
    mode: 'title', // title | playing
    paused: false,
    zone: null, zoneCandidate: null, zoneTimer: 0,
    tut: 'move', moved: 0, last: null,
    talkIdx: {},
    titleAngle: 0.6,
    perf: params.has('perf'),
    fps: 60,
    gpu,
  };
  const ps = {
    x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, mag: 0, wade: 0, dashT: -1, dashes: 0, charges: 1, maxCharges: 1, recharge: 0, iframes: 0,
    hp: 100, maxHp: 100, dead: 0, deadT: 0, act: 0, actT: 0, atkStage: 0, atkT: 0, guardT: -1, guardSt: 60, catchN: 0, catchHv: 0, catchT: 0, riposte: 0, chain: 0, chainT: 99, level: 1, xp: 0,
    weapon: 0, cdQ: 0, cdE: 0, castK: 0, castT: 0,
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
  const padDir = { x: 0, z: 0 };
  const padAiming = () => input.aimDevice === 'gamepad' && input.pad.aim;
  const mouseAiming = () => input.aimDevice === 'mouse' && input.mouse.moved;
  const axes = { x: 0, y: 0 };
  const screenP = { x: 0, y: 0, vis: false };

  // ---- UI --------------------------------------------------------------------------------------
  const hud = new Hud($('#hud'), {
    onSettings: () => openPause('settings'),
    onMute: () => { settings.muted = !settings.muted; audio.set({ muted: settings.muted }); hud.setMuted(settings.muted); saveSettings(); sfx.click(); },
    onBag: () => { artisan.close(); workbench.close(); community.close(); commercePanel.close(); raftEditor.close(); charPanel.toggle('gear'); },
    onMap: () => { artisan.close(); workbench.close(); community.close(); commercePanel.close(); raftEditor.close(); mapView.toggle(); },
  });
  hud.setMuted(settings.muted);
  // M4 panels: the character (Equipo / Atributos / Misiones, and Tía Perla's stall), people's dialog and the
  // map. None of them pauses the world; what they do is a `cmd` and the server answers with a new profile.
  const sendCmd = (o) => { if (client && client.joined) client.send({ t: 'cmd', ...o }); };
  const playerStats = () => {
    const ecs = client.pred.ecs, e = client.youLocal, p = client.profile;
    return {
      level: ecs.level[e], atk: ecs.atk[e], def: ecs.def[e], maxHp: ecs.maxHp[e], speed: ecs.speed[e], cdr: ecs.cdr[e], ripMul: ecs.ripMul[e],
      reflMul: ecs.reflMul[e], guardMax: tuning.guard.stamina + ecs.guardAdd[e], dashRec: ecs.dashRec[e], winBonus: ecs.winBonus[e],
      fireMul: ecs.fireMul[e], potHeal: ecs.potHeal[e], xpMul: ecs.xpMul[e], potions: ecs.potions[e], weapon: ecs.weapon[e], gold: p ? p.gold : 0,
    };
  };
  const charPanel = new CharPanel($('#charpanel'), {
    send: sendCmd, profile: () => client && client.profile, stats: playerStats,
    backpack: () => resources.backpack(), locale: () => getLocale(),
    nearby: () => [...client.entities.values()].filter((r) => r.human && r.id !== client.youServer && r.ready && !r.dying && Math.hypot(r.r.x - ps.x, r.r.z - ps.z) <= 3.5).map((r) => ({ id: r.id, name: r.name })),
    portrait: (c) => drawPortrait(c, settings.skin, portrait(settings.skin)),
    onClose: () => { hud.setBagDot(charPanel.hasNew()); canvas.focus({ preventScroll: true }); },
  });
  const dialog = new Dialog($('#dialog'), { send: sendCmd, onShop: () => charPanel.open('gear', { shop: true }), onTattoo: () => charPanel.open('tattoo', { learn: true }), onMarket: (town) => commercePanel.openMarket(town) });
  const mapView = new MapView($('#mapview'), map);
  const miniMap = new MiniMap($('#hud'), map, { isTouch, onOpen: () => {
    if (st.mode === 'playing' && input.enabled && !pause.open && !chatPanel.typing) $('#hud-map').click();
  } });
  let artisan = null, firePanel = null;
  const raftEditor = new RaftEditor({
    parent: $('#ui'), scene: world.scene, canvas, camera: world.camera, map,
    profile: () => client?.profile, rafts: () => client?.pred.rafts, capacity: () => client?.capacity,
    raftDeck: () => client?.pred.raftDeck, youServer: () => client?.youServer,
    workshopEnabled: () => client?.resources?.timing === true,
    fireEnabled: () => client?.fire?.enabled === true,
    player: () => ps, send: sendCmd,
    enabled: () => st.mode === 'playing' && client.joined && !pause.open && input.enabled && !ps.dead && !client.voyage?.active,
    onContext: (active) => {
      if (active) { firePanel?.close(); artisan?.close(); workbench.close(); community.close(); commercePanel.close(); }
      input.setBuildContext(active || commercePanel.active || workbench.active || community.active || artisan?.active); aimCtl.reset(); st.wantWeapon = 0;
      document.body.classList.toggle('building-raft', active);
      if (active) { charPanel.close(); dialog.hide(); mapView.close(); }
      canvas.focus({ preventScroll: true });
    },
  });
  bus.on('raftEdit', (ev) => safe('raftEdit', () => raftEditor.onResult(ev)));
  const commercePanel = new CommercePanel({
    parent: $('#ui'), profile: () => client?.profile, rafts: () => client?.pred.rafts, capacity: () => client?.capacity,
    raftDeck: () => client?.pred.raftDeck, youServer: () => client?.youServer, fireEnabled: () => client?.fire?.enabled === true, player: () => ps,
    map, send: sendCmd,
    enabled: () => st.mode === 'playing' && client.joined && !pause.open && input.enabled && !ps.dead && !client.voyage?.active,
    onContext: (active) => {
      if (active) { firePanel?.close(); artisan?.close(); workbench.close(); community.close(); raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close(); }
      input.setBuildContext(active || raftEditor.active || workbench.active || community.active || artisan?.active); aimCtl.reset(); st.wantWeapon = 0;
      document.body.classList.toggle('trading-goods', active);
      canvas.focus({ preventScroll: true });
    },
  });
  bus.on('commerce', (ev) => safe('commerce', () => commercePanel.onResult(ev)));
  bus.on('raftProduction', (ev) => safe('production', () => commercePanel.onProductionResult(ev)));
  const resources = new ResourceActions({ client: () => client, player: () => ps,
    enabled: () => st.mode === 'playing' && !pause.open && input.enabled && !raftEditor.active && !commercePanel.active && !artisan?.active,
    locale: () => getLocale(),
    onChange: () => charPanel.refresh(),
    onGather: (ev) => { startHarvestPose(world.views.get(client.youServer), ev); if (ev.tool) harvestSound(ev, 0); },
    toast: (html) => hud.toast(html, 4200), sound: () => sfx.pickup(0) });
  const workbench = new WorkbenchPanel({ parent: $('#ui'), profile: () => client?.profile, player: () => ps,
    bench: () => client?.resources?.bench,
    enabled: () => st.mode === 'playing' && !!client?.joined && !pause.open && input.enabled && !client.t.closed,
    blocked: () => !!(client.naval.active || client.deck.active || client.voyage?.active),
    submit: (command) => resources.send(command),
    onContext: (active) => {
      if (active) { firePanel?.close(); artisan?.close(); community.close(); commercePanel.close(); raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close(); }
      input.setBuildContext(active || raftEditor.active || commercePanel.active || community.active || artisan?.active); aimCtl.reset(); st.wantWeapon = 0;
      document.body.classList.toggle('working-materials', active);
      canvas.focus({ preventScroll: true });
    },
  });
  resources.openWorkbench = () => workbench.open();
  const raftDoors = new RaftDoorActions({ client: () => client,
    locale: () => getLocale(), toast: (text) => hud.toast(text, 2400) });
  bus.on('raftDoor', (ev) => safe('raftDoor', () => raftDoors.acknowledge(ev)));
  bus.on('you:welcome', () => raftDoors.reset());
  firePanel = new FirePanel({ parent: $('#ui'), client: () => client,
    locale: () => getLocale(), toast: text => hud.toast(text, 2400),
    onOpen: () => {
      companionsPanel?.close();
      artisan?.close(); workbench.close(); community.close(); commercePanel.close(); raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close(); chatPanel.close();
      input.setBuildContext(true); aimCtl.reset(); st.wantWeapon = 0;
    },
    onClose: () => { input.setBuildContext(!!(artisan?.active || workbench.active || community.active || commercePanel.active || raftEditor.active)); canvas.focus({ preventScroll: true }); },
  });
  bus.on('fire', ev => safe('fire', () => { firePanel.acknowledge(ev); personalLantern.acknowledge(ev); }));
  bus.on('you:welcome', () => firePanel.resetSession());
  const raftLanterns = new RaftLanternActions({ client: () => client, openFuel: target => firePanel.open(target),
    locale: () => getLocale(), toast: (text) => hud.toast(text, 2400) });
  bus.on('raftLantern', (ev) => safe('raftLantern', () => raftLanterns.acknowledge(ev)));
  bus.on('you:welcome', () => raftLanterns.reset());
  const personalLantern = new PersonalLanternActions({ client: () => client, openFuel: target => firePanel.open(target), parent: $('#ui'), player: () => ps,
    enabled: () => st.mode === 'playing' && !!client?.joined && !pause.open && !chatPanel.typing && input.enabled &&
      !firePanel.active && !raftEditor.active && !commercePanel.active && !workbench.active && !community.active && !mapView.isOpen && !st.sheet,
    locale: () => getLocale(), toast: (text) => hud.toast(text, 2400) });
  bus.on('personalLantern', (ev) => safe('personalLantern', () => personalLantern.acknowledge(ev)));
  bus.on('you:welcome', () => personalLantern.reset());
  input.onHotkey('KeyN', () => personalLantern.toggle());
  bus.on('resource', (ev) => safe('resource', () => { resources.onResult(ev); workbench.onResult(ev); }));
  bus.on('loggingAim', ev => safe('loggingAim', () => resources.onAim(ev)));
  bus.on('you:welcome', () => { resources.reset(); workbench.reset(); world.resources.reset(); });
  const community = new CommunityPanel({ parent: $('#ui'), profile: () => client?.profile,
    context: () => workbench.context(),
    enabled: () => st.online && st.mode === 'playing' && !!client?.joined && !pause.open && input.enabled && !client.t.closed,
    submit: (command) => { if (!st.online || !client?.joined || client.t.closed) return false; client.send(command); return true; },
    onContext: (active) => {
      if (active) { firePanel?.close(); artisan?.close(); workbench.close(); commercePanel.close(); raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close(); chatPanel.close(); }
      input.setBuildContext(active || workbench.active || commercePanel.active || raftEditor.active); aimCtl.reset(); st.wantWeapon = 0;
      document.body.classList.toggle('building-community', active);
      canvas.focus({ preventScroll: true });
    },
  });
  const communityTrigger = document.createElement('button');
  communityTrigger.type = 'button'; communityTrigger.className = 'community-trigger'; setText(communityTrigger, 'runtime.community');
  communityTrigger.hidden = true; communityTrigger.setAttribute('data-l10n-aria-label', 'runtime.contribute');
  communityTrigger.addEventListener('click', () => community.active ? community.close() : community.open());
  workbench.$('.wb-head').appendChild(communityTrigger);
  bus.on('community', (ev) => safe('community', () => community.onResult(ev)));
  bus.on('profile', () => community.update());
  const artisanOptions = { parent: $('#ui'), profile: () => client?.profile, context: () => workbench.context(),
    getLocale: () => getLocale(),
    enabled: () => st.online && st.mode === 'playing' && !!client?.joined && !pause.open && input.enabled && !client.t.closed,
    submit: (command) => { if (!st.online || !client?.joined || client.t.closed) return false; client.send(command); return true; },
    onCommunity: () => community.open(),
    onContext: active => {
      if (active) { firePanel?.close(); companionsPanel?.close(); workbench.close(); community.close(); commercePanel.close(); raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close(); chatPanel.close(); }
      input.setBuildContext(active || workbench.active || community.active || commercePanel.active || raftEditor.active);
      aimCtl.reset(); st.wantWeapon = 0; document.body.classList.toggle('learning-artisan', active);
      if (!active) canvas.focus({ preventScroll: true });
    },
  };
  const legacyArtisan = new ArtisanPanel(artisanOptions);
  const workshop = new WorkshopPanel(artisanOptions);
  const currentArtisan = () => client?.resources?.timing === true ? workshop : legacyArtisan;
  artisan = {
    get active() { return legacyArtisan.active || workshop.active; },
    get root() { return currentArtisan().root; },
    open: () => currentArtisan().open(),
    close: () => { legacyArtisan.close(); workshop.close(); },
    reset: () => { legacyArtisan.reset(); workshop.reset(); },
    update: () => currentArtisan().update(),
    onResult: ev => currentArtisan().onResult(ev),
  };
  const artisanTrigger = document.createElement('button'); artisanTrigger.type = 'button';
  artisanTrigger.className = 'community-trigger'; artisanTrigger.hidden = true;
  artisanTrigger.addEventListener('click', () => artisan.open()); workbench.$('.wb-head').appendChild(artisanTrigger);
  bus.on('artisan', ev => safe('artisan', () => artisan.onResult(ev)));
  bus.on('profile', () => artisan.update()); bus.on('you:welcome', () => artisan.reset());
  var companionsPanel = null;
  const panelKey = (fn) => () => { if (st.mode === 'playing' && !pause.open) { companionsPanel?.close(); artisan.close(); workbench.close(); community.close(); commercePanel.close(); raftEditor.close(); fn(); } };
  input.onHotkey('KeyI', panelKey(() => charPanel.toggle('gear')));
  input.onHotkey('KeyB', () => { if (st.mode === 'playing' && !pause.open) raftEditor.toggle(); });
  input.onHotkey('KeyH', () => {
    if (st.mode !== 'playing' || pause.open) return false;
    if (!(commercePanel.active && ['cargo', 'production'].includes(commercePanel.view)) && !commercePanel.context()) return false;
    commercePanel.toggleCargo(); return true;
  });
  input.onHotkey('KeyR', () => { if (!raftEditor.active) return false; raftEditor.rotate(); return true; });
  input.onHotkey('KeyC', panelKey(() => charPanel.toggle('stats')));
  input.onHotkey('KeyL', panelKey(() => charPanel.toggle('quests')));
  input.onHotkey('KeyT', panelKey(() => charPanel.toggle('tattoo'))); // M4.7: your tattoos and the Q / E loadout
  input.onHotkey('KeyP', panelKey(() => charPanel.toggle('pearl')));
  input.onHotkey('KeyM', panelKey(() => mapView.toggle()));
  input.onHotkey('PadSelect', panelKey(() => charPanel.toggle('gear')));
  const touch = new TouchControls($('#touch'), input);
  touch.setScale(settings.touchSize); touch.setHaptics(settings.haptics !== false);
  const pause = new PauseMenu($('#pause'), settings, {
    onChange: (key) => {
      saveSettings();
      if (['master', 'sfx', 'music', 'ambience', 'muted'].includes(key)) { audio.set(settings); hud.setMuted(settings.muted); }
      if (key === 'quality') quality.setMode(settings.quality);
      if (key === 'uiScale') applyUiScale();
      if (key === 'landscape') stage.update();
      if (key === 'touchSize') touch.setScale(settings.touchSize);
      if (key === 'haptics') touch.setHaptics(settings.haptics);
    },
    onResume: () => closePause(),
    onNewGame: () => { resetSave(); location.reload(); },
    gpu: () => st.gpu,
  });
  const chatPanel = new ChatPanel($('#chat'), {
    send: (payload) => client.send({ t: MSG.CHAT_SEND, ...payload }),
    enabled: () => st.mode === 'playing' && !!client?.joined && !pause.open && !client.t.closed,
    onFocus: (focused) => {
      input.clearActions();
      aimCtl.reset();
      st.wantWeapon = 0;
      input.enabled = !focused && !companionsPanel?.isOpen && st.mode === 'playing' && !pause.open && !client?.t.closed;
    },
  });
  bus.on('chat:state', (m) => safe('chat', () => chatPanel.onState(m)));
  bus.on('chat:message', (m) => safe('chat', () => chatPanel.onMessage(m)));
  bus.on('chat:result', (m) => safe('chat', () => chatPanel.onResult(m)));
  const chatBubbles = new ChatBubbles({
    show: (entity, message, lifeMs) => worldUI.chatBubble(entity, message, lifeMs),
    remove: (entity) => worldUI.removeChatBubble(entity),
    clear: () => worldUI.clearChatBubbles(),
  });
  bus.on('chat:state', (m) => safe('chatBubbles', () => chatBubbles.onState(m)));
  bus.on('chat:message', (m) => safe('chatBubbles', () => {
    if (st.mode === 'playing' && client.joined && !client.t.closed) chatBubbles.onMessage(m);
  }));
  input.onHotkey('Enter', () => {
    if (st.mode !== 'playing' || pause.open) return false;
    artisan.close(); workbench.close(); community.close(); commercePanel.close(); raftEditor.close();
    return chatPanel.open();
  });
  const setServerPause = (on) => { if (client && client.joined) client.send({ t: 'cmd', type: 'pause', on }); };
  function openPause(tab) {
    if (pause.open) return;
    companionsPanel?.close();
    chatPanel.close();
    artisan.close();
    workbench.close();
    community.close();
    commercePanel.close();
    raftEditor.close();
    // Online the world never waits: the menu opens, your input goes neutral and the island carries on.
    st.paused = !st.online;
    setServerPause(true);
    input.enabled = false;
    input.keys.clear();
    pause.show(tab);
    safe('pause', () => { setText(pause.root.querySelector('#pause-title'), st.online ? 'runtime.onlineMenu' : 'runtime.pause'); });
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
    if (companionsPanel?.isOpen) { companionsPanel.close(); return true; }
    if (chatPanel.opened) { chatPanel.close(); return true; }
    if (artisan.active) { artisan.close(); return true; }
    if (firePanel.active) { firePanel.close(); return true; }
    if (workbench.active) { workbench.close(); return true; }
    if (community.active) { community.close(); return true; }
    if (commercePanel.active) { commercePanel.close(); return; }
    if (raftEditor.active) { raftEditor.close(); return; }
    if (aimCtl.preview && aimCtl.preview.kind === 'ground' && !pause.open) { input.cancelAim(); return; } // ESC drops an area being aimed
    if (pause.open) closePause();
    else if (dialog.isOpen) dialog.hide();
    else if (charPanel.isOpen) charPanel.close();
    else if (mapView.isOpen) mapView.close();
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
    onMode: (to) => switchMode(to),
  });
  title.onSkin = () => saveSettings();
  title.onName = () => saveSettings();
  function openPauseFromTitle(tab) {
    pause.show(tab);
    const resume = pause.root.querySelector('#btn-resume');
    if (resume) setText(resume, 'runtime.back');
  }

  // ---- Net / entities --------------------------------------------------------------------------
  var client = new GameClient(transport, map, bus); // var: the pause helpers above run before this line
  const swimStatus = new SwimStatus($('#ui'), { locale: getLocale });
  const navigation = new LiveNavigationView({
    world, client: () => client, input, isTouch, stage, parent: $('#ui'),
    active: () => st.mode === 'playing' && client.joined && !client.t.closed,
    doorInteraction: () => !firePanel.active && !pause.open && input.enabled && !raftEditor.active && !workbench.active && !commercePanel.active && !community.active && !artisan.active && !chatPanel.typing && !ps.dead ? raftDoors.interaction() : null,
    lanternInteraction: () => !firePanel.active && !pause.open && input.enabled && !raftEditor.active && !workbench.active && !commercePanel.active && !community.active && !artisan.active && !chatPanel.typing && !ps.dead ? raftLanterns.interaction() : null,
    onClosePanels: () => { artisan.close(); community.close(); workbench.close(); commercePanel.close(); raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close(); aimCtl.reset(); input.clearActions(); },
  });
  bus.on('combat', (ev) => safe('navigation event', () => navigation.event(ev)));
  bus.on('navalPilot', (ev) => safe('navigation event', () => navigation.event(ev)));
  bus.on('navalImpact', (ev) => safe('navigation event', () => navigation.event(ev)));
  bus.on('navalGust', (ev) => safe('navigation event', () => navigation.event(ev)));
  st.online = transport.kind === 'ws';
  // Saved games (M4): one per server ('solo' for the Web Worker). The server sends a fresh blob when your
  // progress changes; solo also keeps one when the page goes away (it trusts its own saves).
  const saveSlot = () => (st.online ? 'online.' + (() => { try { return new URL(transport.url).host; } catch { return 'server'; } })() : 'solo');
  const accountAuth = new AccountAuth({ httpBase: st.online ? httpUrlFor(transport.url) : null });
  let joiningCompanionAccount = null;
  const companions = new CompanionsClient({ transport, auth: accountAuth,
    joined: () => st.online && st.mode === 'playing' && client.joined && !transport.closed });
  const companionConfig = new CompanionConfigClient({ transport, auth: accountAuth,
    joined: () => st.online && st.mode === 'playing' && client.joined && !transport.closed });
  let companionsPoll = null;
  companionsPanel = new CompanionsUI(hud.root.querySelector('.hud-top-right'), {
    getState: () => companions.snapshot(),
    lang: getLocale(),
    onRefresh: () => companions.refresh(), onStop: (key) => companions.stop(key),
    onVisibilityChange: (open) => {
      clearInterval(companionsPoll); companionsPoll = null;
      if (open) {
        firePanel.close();
        chatPanel.close(); artisan.close(); community.close(); workbench.close(); commercePanel.close();
        raftEditor.close(); charPanel.close(); dialog.hide(); mapView.close();
        companions.refresh();
        companionsPoll = setInterval(() => { if (!document.hidden && !companionsPanel.configEditor?.isOpen) companions.refresh(); }, 5000);
      }
      input.clearActions(); input.keys.clear(); aimCtl.reset(); st.wantWeapon = 0;
      input.enabled = !open && st.mode === 'playing' && !pause.open && !chatPanel.typing && !transport.closed;
    },
  });
  const companionConfigEditor = new CompanionConfigUI(companionsPanel.panel, { client: companionConfig,
    lang: getLocale(), onClose: () => companionsPanel.closeConfiguration() });
  companionsPanel.setConfigurationEditor(companionConfigEditor);
  companions.subscribe((state) => companionsPanel.setState(state));
  onLocaleChange(() => { companionsPanel.setLanguage(getLocale()); companionConfigEditor.setLanguage(getLocale()); });
  document.addEventListener('pointerdown', (event) => {
    if (companionsPanel.isOpen && !companionsPanel.container.contains(event.target) &&
        !companionsPanel.panel.contains(event.target)) companionsPanel.close();
  });
  let accountSetup = null;
  if (st.online && params.get('account-setup') === '1') {
    const { mountAccountSetup } = await import('./editor/accountSetup.js');
    accountSetup = mountAccountSetup({ auth: accountAuth });
  }
  const walletLink = st.online ? new WalletLink({ auth: accountAuth, httpBase: httpUrlFor(transport.url) }) : null;
  const accountPanel = st.online ? new AccountPanel($('#title'), accountAuth, {
    wallet: walletLink,
    hasLegacySave: () => !!loadSave(saveSlot()),
    looks: SKINS.slice(0, 5).map((look, id) => ({ id, name: look.name, color: '#' + look.swatch[0].toString(16).padStart(6, '0') })),
    getCharacter: () => ({ name: settings.name, skin: settings.skin }),
    onCharacterChange: ({ name, skin }) => {
      if (typeof name === 'string') { settings.name = name.slice(0, 16); title.name.value = settings.name; }
      if (Number.isInteger(skin) && skin >= 0 && skin < 5) title.selectSkin(skin);
      saveSettings();
    },
    onReady: () => startPlaying(),
  }) : null;
  let accountReady;
  const initializeAccount = () => accountReady ??= accountAuth.bootstrap({ online: st.online });
  let gmEditor = null;
  let gmOwner = null;
  let gmCameraPose = null;
  let gmWorldUIHidden = false;
  const gmRecoveries = new Map();
  const gmEntry = new GmEntry({
    parent: title.root.querySelector('.title-actions'), auth: accountAuth, online: st.online,
    httpBase: st.online ? httpUrlFor(transport.url) : location.href,
    available: () => st.mode === 'title' && !st.boarding && !st.gmOpening && !client.joined && !pause.open,
    onRevoke: () => { if (gmEditor?.active) void gmEditor.close({ force: true }); },
    onOpen: async (accountId) => {
      if (st.mode !== 'title' || st.boarding || client.joined) return;
      st.gmOpening = true;
      try {
        gmContentLayer?.suspend(); installGmContent(map, baseMap, null);
        const { WorldEditor } = await import('./editor/editor.js');
        const { RemoteDraftClient } = await import('./editor/remoteDraft.js');
        if (gmOwner !== accountId) { await gmEditor?.dispose?.(); gmEditor = null; gmOwner = accountId; }
        if (!gmEditor) {
          let serverHash = 2166136261;
          for (const ch of (st.online ? httpUrlFor(transport.url) : 'solo')) serverHash = Math.imul(serverHash ^ ch.charCodeAt(0), 16777619) >>> 0;
          gmEditor = new WorldEditor({
            scene: world.scene, camera: world.camera, canvas, map, assets, parent: $('#ui'),
            draftWorldId: `gm-${serverHash}-${GAME.seed}-${accountId || 'local'}`, baseRevision: 'terrain-s21-v1',
            remoteClient: st.online ? new RemoteDraftClient({ auth: accountAuth, accountId,
              httpBase: httpUrlFor(transport.url), localScope: `gm-${serverHash}-${GAME.seed}-${accountId}` }) : null,
            invalidate: () => { world.pipeline.markDirty(); world.renderer.shadowMap.needsUpdate = true; },
            createWalkView: () => {
              const id = 'gm-private-walker';
              const view = world.addCharacter(id, 0);
              view.onFootprint = null;
              return { update: (dt, state) => view.update(dt, state), dispose: () => {
                world.removeCharacter(id);
                view.mesh.skeleton.dispose();
                for (const material of new Set([view.material, ...(Array.isArray(view.mesh.material) ? view.mesh.material : [view.mesh.material])])) material.dispose();
              } };
            },
            onClose: ({ saved, recoveryDocument }) => {
              installGmContent(map, baseMap, gmContent?.revision?.content.document ?? null); gmContentLayer?.resume();
              if (!saved && recoveryDocument) gmRecoveries.set(gmOwner, { document: recoveryDocument, revision: gmEditor.revision });
              else gmRecoveries.delete(gmOwner);
              gmCameraPose = { position: world.camera.position.clone(), quaternion: world.camera.quaternion.clone() };
              st.mode = 'title'; title.root.hidden = false; title.pulse?.resume();
              worldUI.root.hidden = gmWorldUIHidden;
              world.setTitleShadows(true); gmEntry.closed(); input.clearActions(); input.keys.clear();
              canvas.focus({ preventScroll: true });
              if (st.contentStale) netLost(true);
            },
          });
          const recovery = gmRecoveries.get(accountId);
          if (recovery) { gmEditor.resumeDocument = recovery.document; gmEditor.revision = recovery.revision; }
        }
        input.enabled = false; input.clearActions(); input.keys.clear(); aimCtl.reset();
        if (gmCameraPose) {
          world.camera.position.copy(gmCameraPose.position); world.camera.quaternion.copy(gmCameraPose.quaternion);
        } else {
          const village = map.landmarks.village;
          const y = map.groundAt(village.x, village.z);
          world.camera.position.set(village.x + 16, y + 18, village.z + 20);
          world.camera.lookAt(village.x, y + 1, village.z);
        }
        world.camera.updateMatrixWorld();
        await gmEditor.open();
        if (!gmEditor.active) throw new Error('GM editor could not open');
        st.mode = 'editor'; title.root.hidden = true; title.pulse?.pause();
        gmWorldUIHidden = worldUI.root.hidden; worldUI.root.hidden = true;
        world.setTitleShadows(false); world.nearFade(false);
      } catch (error) {
        installGmContent(map, baseMap, gmContent?.revision?.content.document ?? null); gmContentLayer?.resume();
        st.mode = 'title'; title.root.hidden = false; title.pulse?.resume();
        world.setTitleShadows(true); input.enabled = false;
        title.message(rich('runtime.gmFail') +
          (gmEditor?.rejectedDocument ? '<button type="button" class="btn secondary" id="btn-gm-recover">' + ltext('runtime.gmExport') + '</button>' : ''));
        document.getElementById('btn-gm-recover')?.addEventListener('click', () => gmEditor.exportRecovery());
        throw error;
      } finally { st.gmOpening = false; }
    },
  });
  bus.on('save', (m) => { if (m && typeof m.blob === 'string') storeSave(saveSlot(), m.blob); });
  addEventListener('pagehide', () => safe('save', () => {
    if (st.online || !client.joined || !client.profile) return;
    storeSave(saveSlot(), JSON.stringify({ ...client.profile, lvl: ps.level, xp: Math.round(ps.xp * 100) / 100, pot: ps.potions ?? client.profile.pot }));
  }));
  // The mode pill: how many pirates are aboard (refreshed while on the title), or solo with a way back online.
  if (st.online) {
    title.setNet({ mode: 'online', ...(transport.status || {}) });
    const refresh = setInterval(() => {
      if (st.mode !== 'title') { clearInterval(refresh); return; }
      probeServer(httpUrlFor(transport.url)).then((s2) => { if (s2 && st.mode === 'title') title.setNet({ mode: 'online', ...s2 }); });
    }, 4000);
    transport.onClose((event) => safe('net', () => {
      if (event.reason === 'content_revision' && gmEditor?.active) { st.contentStale = true; return; }
      netLost(event.reason === 'content_revision');
    }));
  } else {
    title.setNet({ mode: 'solo' });
    if (servedByGameServer()) probeServer().then((s2) => { if (s2) title.setNet({ mode: 'solo', server: s2 }); });
  }
  // The server went away: a veil with a way back (reload = reconnect; settings and weapon are saved).
  function netLost(contentChanged = false) {
    companionsPanel?.close(); companions.disconnect(); companionConfig.disconnect();
    if (gmEditor?.active) void gmEditor.close({ force: true });
    chatPanel.disconnected();
    chatBubbles.disconnected();
    artisan.close(); community.close(); firePanel.close();
    workbench.close();
    commercePanel.close();
    raftEditor.close();
    if (document.querySelector('.net-lost')) return;
    const el = document.createElement('div');
    el.className = 'net-lost';
    el.setAttribute('role', 'alertdialog');
    el.innerHTML = `<div class="frame net-card"><h2 class="outlined">${ltext(contentChanged ? 'runtime.contentChanged' : 'runtime.lost')}</h2><p>${ltext(contentChanged ? 'runtime.contentChangedHint' : 'runtime.lostHint')}</p><div class="title-row"><button class="btn interactive" id="btn-reconnect">${ltext(contentChanged ? 'runtime.contentReload' : 'runtime.reconnect')}</button><button class="btn secondary interactive" id="btn-go-solo">${ltext('runtime.solo')}</button></div></div>`;
    $('#stage').appendChild(el);
    el.querySelector('#btn-reconnect').addEventListener('click', () => location.reload());
    el.querySelector('#btn-go-solo').addEventListener('click', () => switchMode('solo'));
    el.querySelector('#btn-reconnect').focus();
    input.enabled = false;
    hud.setNet(null);
  }
  // Switching modes reloads the page with or without ?solo.
  function switchMode(to) {
    const q = new URLSearchParams(location.search);
    if (to === 'solo') q.set('solo', ''); else q.delete('solo');
    location.search = q.toString().replace(/=(&|$)/g, '$1');
  }

  const views = world.views;
  bus.on('resourceHit', (ev) => safe('harvest effects', () => {
    if (!world.resources.hit(ev)) return;
    const distance = Math.hypot(ps.x - ev.x, ps.z - ev.z);
    if (ev.e === client.youServer && resources.predictedHit(ev)) {
      if (ev.felled) harvestSound(ev, distance);
      return;
    }
    if (distance < 26) startHarvestPose(views.get(ev.e), ev);
    harvestSound(ev, distance);
  }));
  const devPanel = new DevPanel($('#devpanel'), { client, world, hud });
  const debugDraw = new DebugDraw(world.scene);
  let loop = null;
  const feedback = new Feedback({ world, client, hud, worldUI, loop: { addHitstop: (h) => loop && loop.addHitstop(h), slowmo: (a, b) => loop && loop.slowmo(a, b), get timeScale() { return loop ? loop.timeScale : 1; }, get alpha() { return loop ? loop.alpha : 0; } }, settings, map, ps, onTutorial: (k, d) => safe('tutorial', () => onTutorial(k, d)) });
  world.indicators.onFull = () => sfx.chargeFull(); // the Timón's charge is full
  const rewards = new Rewards({ world, hud, worldUI, ps, map, settings });
  // Public loot (M4.5): who took it (it flies to them) and which name is yours.
  rewards.entityPos = (id) => { const r = client.entities.get(id); return r && r.ready ? { x: r.r.x, y: r.r.y, z: r.r.z } : null; };
  bus.on('you:welcome', ({ id, rec }) => { rewards.meId = id; rewards.myName = rec ? rec.name : ''; });
  bus.on('combat', (ev) => safe('rewards', () => rewards.handle(ev)));
  bus.on('combat', (ev) => safe('feedback', () => {
    feedback.handle(ev);
    if (ev.type === 'respawn' && ev.me) st.snapCam = true;
    if (ev.type === 'equip' && ev.me) onEquip(ev.weapon);
    if (ev.type === 'talk' && ev.me) dialog.show(ev, st.lastLine);
    if (ev.type === 'skillDenied' && ev.me) charPanel.denyTattoo();
    if (ev.type === 'death' && ev.by) killFeed(ev);
    if (ev.type === 'note' && ev.code === 'save' && ev.me) {
      setSaveAside(saveSlot());
      hud.toast(rich('runtime.saveInvalid'), 6000);
    }
  }));
  // Pirates sinking pirates in the Cala Calavera (M4.5).
  function killFeed(ev) {
    const name = (id) => (client.entities.get(id) || {}).name || t('chat.someone');
    const me = client.youServer;
    if (ev.id === me) hud.toast(rich('runtime.killed', {name: name(ev.by)}), 4200);
    else if (ev.by === me) { hud.toast(rich('runtime.kill', {name: name(ev.id)}), 4200); sfx.mastery(); }
    else if (Math.hypot(ev.x - ps.x, ev.z - ps.z) < 45) hud.toast(rich('runtime.killFeed', {attacker:name(ev.by),victim:name(ev.id)}), 3200);
  }
  // The weapon you carry: remembered for the next session, the kit shown in a toast.
  function onEquip(w) {
    const kind = WEAPON_KINDS[w] || 'sable', W = WEAPONS[kind];
    if (settings.weapon !== kind) { settings.weapon = kind; saveSettings(); }
    const kitLine = kind === 'pistolas'
      ? rich('runtime.kitPistol')
      : t('runtime.kitSword');
    hud.toast(`<b>${dataText(W.name)}</b><br>${kitLine}`, 4600);
    sfx.click();
  }

  bus.on('entity:spawn', (rec) => safe('spawn', () => {
    const isNpc = rec.kind === KIND.NPC;
    const view = world.addCharacter(rec.id, rec.skin, { sword: !isNpc, enemy: rec.enemy || undefined });
    view.lastDashes = 0;
    const practice = rec.def && rec.def.practice;
    // Swarm enemies get a bare HP bar; the boss has the boss bar instead of a plate.
    const minor = rec.def && rec.def.minor, boss = rec.def && rec.def.boss;
    if (!rec.isYou && !boss) worldUI.addNameplate(rec.id, { name: rec.name, level: rec.level, title: practice || minor ? '' : rec.title, kind: isNpc ? 'npc' : rec.enemy ? (practice ? 'practice' : minor ? 'minor' : 'enemy') : rec.human ? 'ally' : 'player' });
    // Another pirate came aboard (not the ones already here when you arrived).
    if (rec.human && !rec.isYou && st.mode === 'playing') { hud.toast(rich('runtime.aboard', {name:rec.name}), 2600); sfx.click(); }
    rec.view = view;
    if (rec.ready) view.update(0, rec.r);
  }));
  bus.on('entity:despawn', (rec) => {
    world.removeCharacter(rec.id); worldUI.removeNameplate(rec.id);
    chatBubbles.forgetEntity(rec.id);
    if (rec.human && rec.id !== client.youServer && st.mode === 'playing') hud.toast(rich('runtime.left', {name:rec.name}), 2600);
  });
  bus.on('you:welcome', ({ id }) => { worldUI.removeNameplate(id); });
  bus.on('you:ready', () => {
    const v = views.get(client.youServer);
    if (v) {
      v.onStep = () => safe('step', () => {
        const mat = client.pred.raftDeck.surface(ps.x, ps.z, ps.y) ? 'wood' : map.materialAt(ps.x, ps.z);
        world.effects.footstep(ps.x, ps.y, ps.z, mat, ps.wade);
        sfx.step(mat, ps.wade);
      });
    }
  });
  bus.on('local:dash', (d) => safe('dash', () => {
    const v = views.get(client.youServer);
    const accent = elementVisual(ps.elem)?.accent ?? SKINS[settings.skin].accent;
    if (v) world.after.dash(v, accent, tuning.dash.afterimages, tuning.dash.afterimageLife);
    const deck = client.pred.raftDeck.surface(d.x, d.z, ps.y);
    const mat = deck ? 'wood' : map.materialAt(d.x, d.z), y = deck?.y ?? map.groundAt(d.x, d.z);
    world.effects.dashBurst(d.x, y, d.z, d.dx, d.dz, mat, ps.wade);
    world.lights.flash(d.x, y + 1.1, d.z, accent, 5.5, 2.6, 0.32);
    sfx.dash(ps.wade);
    world.rig.punchIn(0.35);
    if (st.tut === 'dash') advanceTutorial();
  }));
  bus.on('local:dashDenied', () => { hud.denyDash(); sfx.denied(); });
  client.start();

  // ---- Tutorial ----------------------------------------------------------------------------------
  // The beach tutorial (client-side; how far you got is kept in your save, M4). After it, the tracker shows your
  // quests (the server's): the village, Brea, the archers, the sentinels and HELLFIRE are quests now.
  const TRACK = [
    { id: 'move', text: isTouch ? ltext('tutorial.moveTouch') : ltext('tutorial.move') },
    { id: 'dash', text: isTouch ? ltext('tutorial.dashTouch') : ltext('tutorial.dash') },
    { id: 'attack', text: isTouch ? ltext('tutorial.attackTouch') : ltext('tutorial.attack') },
    { id: 'parry', text: isTouch ? ltext('tutorial.parryTouch') : ltext('tutorial.parry') },
    { id: 'guard', text: isTouch ? ltext('tutorial.guardTouch') : ltext('tutorial.guard') },
  ];
  const ORDER = TRACK.map((t) => t.id);
  function refreshTracker() {
    if (st.tut !== 'done') {
      const i = Math.max(0, ORDER.indexOf(st.tut));
      hud.setQuests(t('tutorial.first'), TRACK.map((t, k) => ({ ...t, done: k < i })));
      return;
    }
    const p = client.profile, items = [];
    if (p) {
      for (const id of QUEST_IDS) {
        const q = p.quests[id], Q = QUESTS[id];
        if (!q || (q[0] !== QST.ACTIVE && q[0] !== QST.READY)) continue;
        const n = goalCount(Q), who = Q.turnin === 'vendor' ? 'Tía Perla' : 'Capitana Brea';
        const prog = n > 1 ? ` <small>${Math.min(n, q[1])}/${n}</small>` : '';
        items.push({ id, text: q[0] === QST.READY ? ltext('runtime.returnQuest', {quest:translateData(Q.name),who}) : `${dataText(Q.name)}${prog}`, ready: q[0] === QST.READY });
      }
    }
    hud.setQuests(t('tutorial.quests'), items.length ? items.slice(0, 4) : [{ id: 'none', text: ltext('tutorial.village'), done: false }]);
  }
  onLocaleChange(() => refreshTracker());
  function advanceTutorial() {
    const i = ORDER.indexOf(st.tut);
    if (i < 0) return;
    const msgs = {
      move: rich('tutorial.moveDone'),
      dash: rich('tutorial.dashDone'),
      attack: rich('tutorial.attackDone'),
      parry: rich('tutorial.parryDone'),
      guard: rich('tutorial.guardDone'),
    };
    hud.toast(msgs[st.tut], 4200);
    sfx.marimba([659.25, 783.99, 1046.5], 0.07, 0.12);
    st.tut = ORDER[i + 1] || 'done';
    client.send({ t: 'cmd', type: 'tut', i: i + 1 });
    refreshTracker();
  }
  function onTutorial(kind, d) {
    if (kind === 'dummy' && d.heavy && st.tut === 'attack') advanceTutorial();
    else if (kind === 'parry' && d && d.tier >= 2 && (st.tut === 'parry' || st.tut === 'attack')) completeUpTo('parry');
    else if (kind === 'guard' && d && d.pid && st.tut === 'guard') advanceTutorial();
    else if (kind === 'target') hud.toast(rich('tutorial.target'), 3600);
    else if (kind === 'respawn') hud.toast(rich('tutorial.respawn'), 4600);
  }
  // Your profile (M4): gold, the tracker, and on the first one, how far the tutorial went.
  bus.on('profile', (p) => safe('profile', () => {
    if (!st.profileSeen) {
      st.profileSeen = true;
      const k = p.flags ? p.flags.tut | 0 : 0;
      st.tut = k >= ORDER.length ? 'done' : ORDER[k];
    }
    refreshTracker();
    charPanel.refresh();
    hud.setBagDot(!charPanel.isOpen && charPanel.hasNew());
  }));

  // ---- Zones -------------------------------------------------------------------------------------
  function enterZone(z) {
    const prev = st.zone;
    st.zone = z;
    // Out of the Cala Calavera (M4.5): the law is back.
    if (prev === 'calavera' && z !== 'calavera' && st.mode === 'playing') hud.toast(rich('runtime.safe'), 3800);
    if (z === 'mar') return;
    const Z = ZONES[z];
    if (prev !== null || st.mode === 'playing') hud.showZone(Z.name, Z.sub, z === 'caldera' ? 'caldera' : Z.lawless ? 'lawless' : '', reduced());
    if (Z.lawless && st.mode === 'playing') {
      sfx.calderaZone();
      if (!settings.calaTaught) {
        settings.calaTaught = true; saveSettings();
        hud.toast(rich('runtime.lawlessHint'), 11000);
      }
    }
    ambience.setZone(z);
    world.lighting.setZone(z === 'caldera', 2);
    music.setMood(z === 'caldera' ? 'caldera' : 'island');
    if (z === 'caldera') sfx.calderaZone(); else if (!Z.lawless) sfx.zone();
  }
  // Reaching a later goal first quietly ticks the earlier ones.
  function completeUpTo(id) {
    const target = ORDER.indexOf(id);
    while (st.tut !== 'done' && ORDER.indexOf(st.tut) < target) st.tut = ORDER[ORDER.indexOf(st.tut) + 1];
    if (st.tut === id) advanceTutorial();
  }

  // ---- NPC talk ----------------------------------------------------------------------------------
  const npcKey = (rec) => Object.keys(NPC_TALK).find((k) => NPC_TALK[k].name === rec.name) || '';
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
      boss = { name: def.name || 'HELLFIRE', title: def.title || '', hp: rec.r.hp, maxHp: rec.r.maxHp, phase, phases: def.phases ? def.phases.length : 1, marks: def.phases ? def.phases.slice(phase, -1).map((q) => q.until) : [], shield, inv };
    }
    hud.setBoss(boss);
    let line = null;
    if (active) {
      if (stE === 'intro') line = t('runtime.trial');
      else if (stE === 'wave') line = ltext('runtime.wave', {wave:wave+1,waves,left});
      else if (stE === 'rest') line = ltext('runtime.rest', {wave:wave+2,waves});
      else if (stE === 'boss' && left > 1) line = ltext('runtime.minions', {count:left-1});
      else if (stE === 'victory') line = t('runtime.victory');
      // Co-op: the fight is scaled for the crew that started it. M4: and its Marea.
      const crew = E[10] || 0, tier = E[11] || 0;
      if (line && crew > 1) line += ltext('runtime.crew', {count:crew});
      if (line && tier > 1) line = `<b class="tier">${ENCOUNTERS.caldera.tiers[tier - 1].name}</b> · ` + line;
    }
    hud.setEnc(line);
    st.encTier = active ? E[11] || 0 : 0;
    world.rig.fightZoom = active && stE !== 'victory' ? 1.18 : 1;
    // Music climbs a layer every two waves and tops out at the boss.
    music.setLevel(!active || stE === 'victory' || stE === 'idle' ? 0 : stE === 'boss' || stE === 'bossIntro' ? 3 : 1 + Math.min(2, Math.max(0, wave) >> 1));
    world.setEncounterFx({ runes: !E || stE === 'idle' ? 1 : 0, bossId: active ? bossId : 0, shield, inv, phase });
    // One warning when walking out mid-trial.
    if (E && stE !== 'idle' && stE !== 'victory' && !inside && Math.hypot(ps.x - A.x, ps.z - A.z) < map.landmarks.arenaR + 12 && !st.encWarned) {
      st.encWarned = true;
      hud.toast(rich('runtime.leaveTrial'), 3600);
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
  const vendorAt = map.npcs.find((n) => n.id === 'vendor');

  // ---- Play ------------------------------------------------------------------------------------
  async function startPlaying() {
    if (st.boarding || st.gmOpening || st.mode !== 'title' || accountAuth.state.busy) return;
    st.boarding = true;
    title.boarding(true);
    accountPanel?.setBoarding(true);
    title.message(null);
    try {
      audio.unlock();
      // On a phone: fullscreen + landscape lock while the tap is still a user gesture. iOS and iframes refuse it
      // (the CSS rotation then does the job); once the lock works the window turns landscape and the stage un-rotates.
      if (isTouch) {
        try {
          const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
          fs?.then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
        } catch { /* no fullscreen API */ }
      }
      audio.set(settings);
      ambience.start();
      music.start();
      sfx.play();
      saveSettings();
      await initializeAccount();
      const identity = st.online && !accountAuth.state.guestChoice ? await accountAuth.sessionIdentity() : null;
      const account = identity ? { token: identity.token, importSave: accountPanel?.importRequested() } : null;
      joiningCompanionAccount = identity?.accountId ?? null;
      const saved = account && !account.importSave ? '' : loadSave(saveSlot());
      if (st.online) {
        // Wait for the server's answer: a place aboard, or why not.
        const r = await new Promise((resolve) => {
          const offs = [bus.on('you:welcome', () => done('ok')), bus.on('net:full', (m) => done('full', m)), bus.on('net:error', (m) => done('error', m))];
          const timer = setTimeout(() => done('timeout'), 20000);
          function done(k, m) { clearTimeout(timer); offs.forEach((off) => off && off()); resolve({ k, m }); }
          client.join(settings.name, settings.skin, weaponIndex(settings.weapon), saved, account);
        });
        if (r.k !== 'ok') {
          joiningCompanionAccount = null; companions.setSession(null); companionConfig.setSession(null);
          if (r.k === 'timeout') transport.close();
          const joinErrors = {
            version: rich('join.version'),
            content_revision: rich('join.contentRevision'),
            content_busy: rich('join.contentBusy'),
            auth: rich('join.auth'),
            auth_disabled: rich('join.disabled'),
            session: rich('join.session'),
            storage: rich('join.storage'),
            legacy: rich('join.legacy'),
            legacy_used: rich('join.used'),
            legacy_active: rich('join.active'),
          };
          title.message(r.k === 'full' ? rich('join.full', {max:r.m.max})
            : r.k === 'error' ? (joinErrors[r.m.code] || rich('join.failed'))
              : rich('join.offline'));
          sfx.click();
          return;
        }
      } else client.join(settings.name, settings.skin, weaponIndex(settings.weapon), saved);
      accountPanel?.hide();
      await title.hide();
    } catch {
      joiningCompanionAccount = null; companions.setSession(null); companionConfig.setSession(null);
      title.message(rich('join.recover'));
    } finally {
      st.boarding = false;
      title.boarding(false);
      accountPanel?.setBoarding(false);
    }
  }
  bus.on('you:ready', () => {
    st.mode = 'playing';
    companions.setSession(joiningCompanionAccount);
    companionConfig.setSession(joiningCompanionAccount);
    companionsPanel.setVisible(true);
    companions.refresh();
    world.setTitleShadows(false);
    const rec = client.entities.get(client.youServer);
    hud.setPlayer({ name: rec ? rec.name : settings.name, level: rec ? rec.level : 1, skin: settings.skin, portrait: portrait(settings.skin) });
    refreshTracker();
    client.localState(1, ps);
    focus.set(ps.x, ps.y, ps.z);
    world.rig.snapTo(focus);
    world.rig.blendFromCurrent(reduced() ? 0.6 : 2.2);
    setTimeout(() => {
      hud.show();
      chatPanel.setVisible(true);
      input.enabled = !chatPanel.typing && !companionsPanel.isOpen;
      if (isTouch) touch.show();
      canvas.focus({ preventScroll: true });
    }, reduced() ? 300 : 1500);
  });

  function sheetFrame(dt) {
    const sh = st.sheet, n = sh.views.length, c = sh.center;
    sh.views.forEach((v, i) => {
      if (sh.weapon) v.setWeapon(sh.weapon);
      if (sh.fire && v.weaponKind === 'pistolas') { v.fireT = (v.fireT || 0) - dt; if (v.fireT <= 0) { v.fireT = 0.2; v.hand = -(v.hand || 1); v.recoil(v.hand); } }
      if (sh.loop && sh.act) sh.actT = ((sh.actT || 0) + dt / n) % sh.loop;
      const x = c.x + (i - (n - 1) / 2) * sh.gap, z = c.z;
      const sp = sh.run ? 6.5 : 0, mv = sh.yaw + (sh.move || 0);
      v.update(dt, { x, y: map.groundAt(x, z), z, f: sh.yaw, vx: Math.sin(mv) * sp, vz: Math.cos(mv) * sp, st: 0, wade: 0, act: sh.act || 0, actT: sh.actT || 0 });
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
      const v = H.velocityAt(s, pt), rx = ps.x - H.px(s, pt), rz = ps.z - H.pz(s, pt), v2 = v.x * v.x + v.z * v.z;
      if (v2 < 1e-6) continue;
      const tca = (rx * v.x + rz * v.z) / v2;
      if (tca < 0 || tca > tBest) continue;
      if (Math.hypot(rx - v.x * tca, rz - v.z * tca) > reach + H.r[s]) continue;
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
  // ---- Aiming areas and charges (M4.7 P4, client/aimcast.js) -------------------------------------------------
  // The slot keys go through the aim controller: an area (Tromba, Abordaje, the pistols' Lluvia) shows its marker
  // while the key is held and goes out on release at the marked point; the Timón holds its bit while charging.
  const aimCtl = new AimCast();
  const slotIn = { down: { q: false, e: false, r: false, g: false }, up: { q: false, e: false, r: false, g: false }, held: { q: false, e: false, r: false, g: false }, cancel: false, kinds: { q: 'dir', e: 'dir', r: 'self', g: 'dir' }, mode: 'indicator' };
  const slotD = { q: { id: '', kind: 'dir', S: null, range: 0, min: 0, r: 0 }, e: { id: '', kind: 'dir', S: null, range: 0, min: 0, r: 0 }, r: { id: '', kind: 'self', S: null, range: 0, min: 0, r: 0 }, g: { id: '', kind: 'dir', S: null, range: 0, min: 0, r: 0 } };
  // What each slot holds right now (from the predicted pirate): id, how it is cast, its numbers in the form in use.
  function readSlots() {
    const ecs = client.pred.ecs, e = client.youLocal;
    for (const s of ['q', 'e', 'g']) {
      const d = slotD[s], S = skillNum(ecs, e, s);
      d.id = skillOf(ecs, e, s); d.kind = castKind(d.id); d.S = S;
      d.range = S.range || 0; d.min = S.min || 0; d.r = d.id === 'leap' && S.blink ? 0.7 : S.r || 0;
    }
    const R = slotD.r, rid = weaponOf(ps.weapon).r;
    R.id = rid; R.S = SKILLS[rid];
    // The rain aims like an area only when the meter is full (otherwise the press just says why it cannot).
    R.kind = rid === 'rain' && ps.riposte >= tuning.parry.riposte.max ? 'ground' : 'self';
    R.range = rid === 'rain' ? SKILLS.rain.range : 0; R.min = 0; R.r = rid === 'rain' ? rainR(ecs, e) : 0;
    for (const s of ['q', 'e', 'r', 'g']) slotIn.kinds[s] = slotD[s].kind;
    return slotD;
  }
  // The nearest enemy's feet within `range` (+ a little), or null.
  function enemyWithin(range) {
    let best = null, bd = range + 1;
    for (const rec of client.entities.values()) {
      if (!rec.enemy || !rec.ready || rec.dying || rec.enemy === 'cannon') continue;
      const d = Math.hypot(rec.r.x - ps.x, rec.r.z - ps.z);
      if (d < bd) { bd = d; best = rec; }
    }
    return best;
  }
  // Where an area in slot d lands: the touch drag (its length = the distance), the right stick (its tilt), the cursor,
  // else the nearest enemy in reach or 4 u ahead; clamped to [min, range] along the line like the sim does. The
  // Abordaje snaps to its real landing point (the last standable point of the line).
  const gTarget = { x: 0, z: 0 };
  function groundTarget(d, out = gTarget) {
    let dx = Math.sin(ps.f), dz = Math.cos(ps.f), dist = 4;
    const ta = input.touchAim;
    if (ta) { world.rig.moveBasis(ta.x, ta.y, padDir); dx = padDir.x; dz = padDir.z; dist = d.min + ta.k * (d.range - d.min); }
    else if (padAiming()) {
      world.rig.moveBasis(input.pad.ax, input.pad.ay, padDir); dx = padDir.x; dz = padDir.z;
      dist = d.min + Math.min(1, Math.hypot(input.pad.ax, input.pad.ay)) * (d.range - d.min);
    } else if (mouseAiming()) { dx = aim.x - ps.x; dz = aim.z - ps.z; dist = Math.hypot(dx, dz); }
    else { const t = enemyWithin(d.range); if (t) { dx = t.r.x - ps.x; dz = t.r.z - ps.z; dist = Math.hypot(dx, dz); } }
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) { dx = Math.sin(ps.f); dz = Math.cos(ps.f); } else { dx /= l; dz /= l; }
    dist = Math.max(d.min, Math.min(d.range, dist));
    out.x = ps.x + dx * dist; out.z = ps.z + dz * dist;
    if (d.id === 'leap' && d.S && !d.S.blink) {
      const n = Math.ceil(dist / 0.3), w = { map };
      let k = n;
      while (k > 0 && !canStand(w, ps.x + (dx * dist * k) / n, ps.z + (dz * dist * k) / n, tuning.player.radius)) k--;
      out.x = ps.x + (dx * dist * k) / n; out.z = ps.z + (dz * dist * k) / n;
    }
    return out;
  }

  // Reflected shots leave a cyan trail.
  let trailFrame = 0;
  // Trails by what the shot is: a reflect's tier (EXCELENTE long and white-gold, POBRE short and faint),
  // a pistol tracer (thin, short, amber).
  const TRAIL = {
    3: { life: 0.48, w: 0.24, color: [1, 0.96, 0.78], color1: [0.95, 0.75, 0.3] },
    2: { life: 0.3, w: 0.17, color: [0.75, 1, 1], color1: [0.1, 0.6, 1] },
    1: { life: 0.16, w: 0.12, color: [0.5, 0.75, 0.8], color1: [0.08, 0.35, 0.6] },
    bullet: { life: 0.09, w: 0.06, color: [1, 0.9, 0.55], color1: [1, 0.5, 0.1] },
  };
  const shotTrail = (s, x, y, z) => {
    const S = client.shots;
    const bullet = S.kind[s] === SHOT.BULLET || S.kind[s] === SHOT.PELLET;
    if (!bullet && ((trailFrame + s) & 1)) return;
    const heavy = S.heavy[s], T = bullet ? TRAIL.bullet : TRAIL[S.tier[s]] || TRAIL[2];
    const palette = elementVisual(S.elem[s]);
    world.effects.streaks.spawn(x, y, z, -S.vx[s] * 0.12, 0, -S.vz[s] * 0.12, { life: T.life, width: heavy ? 0.42 : T.w, stretch: bullet ? 0.9 : 0.6, color: palette?.c0 ?? T.color, color1: palette?.c1 ?? T.color1, gravity: 0, drag: 2 });
  };
  // F4 → hitboxes: hurtboxes (green / red), graze band, parry and swing sectors, projectile radii.
  const PCOL = [0xffb02e, 0xff5a1f, 0x9b4dff];
  function drawHitboxes(tick) {
    const D = debugDraw, y = ps.y + 0.12;
    D.begin();
    D.circle(ps.x, y, ps.z, tuning.player.hurtRadius, 0x7be07b, 16);
    D.circle(ps.x, y, ps.z, tuning.player.hurtRadius + tuning.projectiles.parryable.radius + tuning.projectiles.graze, 0x2a8f9a, 28);
    D.sector(ps.x, y + 0.04, ps.z, 1.4, ps.f, tuning.guard.arc, ps.act === ACT.GUARD ? 0xffffff : 0x3b7fa0);
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
      const navalInput = navigation.fixedInput();
      if (navalInput) {
        input.consumePresses(); aimCtl.reset(); st.wantWeapon = 0;
        client.tickInput(chatPanel.typing || pause.open || firePanel.active || !input.enabled
          ? { naval: { throttle: 0, brake: 0, steer: 0, capture: false }, deck: { mx: 0, mz: 0 } }
          : navalInput);
        return;
      }
      if (chatPanel.typing || companionsPanel?.isOpen) {
        client.tickInput({ mx: 0, mz: 0, ax: ps.x, az: ps.z, btn: 0, prs: 0, w: 0 });
        return;
      }
      input.axes(axes);
      world.rig.moveBasis(axes.x, axes.y, move);
      const prs = input.consumePresses();
      if (artisan.active || community.active || firePanel.active) {
        client.tickInput({ mx: 0, mz: 0, ax: ps.x, az: ps.z, btn: 0, prs: 0, w: 0 });
        return;
      }
      if (raftEditor.active || commercePanel.active || workbench.active) {
        client.tickInput({ mx: move.x, mz: move.z, ax: ps.x, az: ps.z, btn: 0, prs: 0, w: 0 });
        return;
      }
      // Mouse or right stick: you face the aim point (AIM). Touch / keyboard only / a pad without the
      // right stick: you face where you walk, and actions turn to the nearest threat or enemy.
      let aimBit = 0;
      const ta = input.touchAim;
      if (ta) {
        // Dragging a touch skill button: aim that way, up to 9 u out (the drag length).
        world.rig.moveBasis(ta.x, ta.y, padDir);
        const l = Math.hypot(padDir.x, padDir.z) || 1, d = 1.5 + ta.k * 7.5;
        aim.set(ps.x + (padDir.x / l) * d, ps.y, ps.z + (padDir.z / l) * d);
        aimBit = BTN.AIM;
      } else if (padAiming()) {
        world.rig.moveBasis(input.pad.ax, input.pad.ay, padDir);
        const l = Math.hypot(padDir.x, padDir.z) || 1;
        aim.set(ps.x + (padDir.x / l) * 4, ps.y, ps.z + (padDir.z / l) * 4);
        aimBit = BTN.AIM;
      } else if (mouseAiming()) aimBit = BTN.AIM;
      else autoAim(move);
      // The slot keys through the aim controller: an area's press goes out on release, aimed at its marker.
      readSlots();
      input.consumeSlots(slotIn);
      slotIn.mode = input.aimDevice === 'touch' ? 'indicator' : settings.launch || 'indicator';
      const ac = aimCtl.step(slotIn);
      input.previewing = !!(ac.preview && ac.preview.kind === 'ground');
      let ax = aim.x, az = aim.z;
      if (ac.fire) { const g = groundTarget(slotD[ac.fire]); ax = g.x; az = g.z; aimBit = BTN.AIM; }
      else if (ac.preview && ac.preview.kind === 'ground') { const g = groundTarget(slotD[ac.preview.slot]); ax = g.x; az = g.z; aimBit = BTN.AIM; }
      client.tickInput({ mx: move.x, mz: move.z, ax, az, btn: input.held | aimBit | ac.held, prs: prs | ac.prs, w: st.wantWeapon || 0 });
      st.wantWeapon = 0;
      if (ta && ta.release) input.touchAim = null;
    }),
    frame: (realDt, simDt, alpha) => {
      loop.paused = st.paused;
      safe('pad', () => input.pollPad());
      trailFrame++;
      safe('net', () => { transport.flush(); client.update(simDt, realDt); });
      if (st.online) safe('netHud', () => {
        const now = performance.now();
        if (now - (st.netT || 0) < 500) return;
        const b = transport.stats.bytesIn;
        if (st.netT) st.kbIn = (b - st.netB) / 1024 / ((now - st.netT) / 1000); // JSON before the socket inflates it
        st.netB = b; st.netT = now;
        let humans = 0;
        for (const r of client.entities.values()) if (r.human) humans++;
        hud.setNet(st.mode === 'playing' && !transport.closed ? { rtt: transport.rtt, players: humans } : null);
        // The crew: every other human aboard (bots are not crew).
        const party = [];
        for (const r of client.entities.values()) if (r.human && r.id !== client.youServer && r.ready) party.push({ id: r.id, name: r.name, skin: r.skin, level: r.r.lvl, hp: r.r.hp, maxHp: r.r.maxHp, weapon: r.r.wpn, dead: r.r.act === ACT.DEAD || r.r.hp <= 0 });
        hud.setParty(st.mode === 'playing' ? party : []);
      });
      const playing = st.mode === 'playing' && client.joined;
      if (st.mode === 'editor' && gmEditor?.active) {
        safe('gmEditor', () => {
          gmEditor.update(realDt);
          world.camera.getWorldDirection(tmpV);
          const distance = tmpV.y < -0.05 ? Math.min(180, Math.max(1, world.camera.position.y / -tmpV.y)) : 35;
          focus.copy(world.camera.position).addScaledVector(tmpV, distance);
          if (gmEditor.walkPreview?.active) focus.copy(gmEditor.walkPreview.position);
          focus.y = map.groundAt(focus.x, focus.z);
          world.update(realDt, { focus, shadowFocus: focus, playing: false, simDt: 0 });
          world.render();
        });
        return;
      }
      if (playing) safe('local', () => client.localState(alpha, ps));
      safe('swimming HUD', () => swimStatus.update(playing && !ps.dead ? ps : {}));
      // Inside the Cala Calavera (M4.5): no law.
      st.lawless = playing && map.lawlessAt(ps.x, ps.z);
      hud.setLawless(st.lawless);
      const viewTick = client.viewTick(alpha);
      safe('navigation', () => navigation.update(realDt, alpha, ps, {
        paused: pause.open || chatPanel.typing || !input.enabled,
        reducedMotion: settings.reducedMotion, quality: quality.current, muted: settings.muted,
      }));
      safe('personalLantern', () => personalLantern.update());
      safe('firePanel', () => { if (ps.dead || pause.open) firePanel.close(); firePanel.update(); });

      // Characters.
      safe('chars', () => {
        anchors.clear();
        rewards.anchors(anchor);
        for (const rec of client.entities.values()) {
          const view = rec.view;
          if (!view) continue;
          let s;
          if (rec.id === client.youServer) {
            if (!playing) { view.root.visible = false; continue; }
            view.root.visible = true;
            s = ps;
            view.setWeapon(WEAPON_KINDS[ps.weapon] || 'sable');
          } else {
            if (!rec.ready || view.dead) { view.root.visible = false; continue; }
            view.root.visible = true;
            s = rec.r;
            if (rec.enemy) worldUI.setPlate(rec.id, { hp: s.hp, maxHp: s.maxHp, level: s.lvl });
            else if (rec.kind === KIND.PLAYER) {
              view.setWeapon(WEAPON_KINDS[s.wpn] || 'sable');
              // Another pirate: its life on its plate, and red when it can hurt you (both inside the Cala).
              if (rec.human) {
                worldUI.setPlate(rec.id, { hp: s.hp, maxHp: s.maxHp, level: s.lvl });
                worldUI.setPlateHostile(rec.id, playing && st.lawless && map.lawlessAt(s.x, s.z));
              }
            }
            // Remote players' swings: a slash when their action turns into a new stage.
            if (!rec.enemy && s.act >= ACT.SWING1 && s.act <= ACT.SWING3 && s.act !== view.lastAct) {
              const st2 = tuning.melee.stages[s.act - ACT.SWING1];
              world.combatFx.slash(view, s.act - ACT.SWING1 + 1, elementVisual(s.elem)?.accent ?? SKINS[rec.skin]?.accent ?? 0x3bf0ff, st2.active, Math.max(0, st2.windup - s.actT));
            }
            view.lastAct = s.act;
            if (s.dashes !== view.lastDashes) {
              if (view.lastDashes) {
                world.after.dash(view, elementVisual(s.elem)?.accent ?? SKINS[rec.skin]?.accent ?? 0x3bf0ff, [0, 0.07, 0.14], 0.22);
                world.effects.dashBurst(s.x, s.y, s.z, Math.sin(s.f), Math.cos(s.f), map.materialAt(s.x, s.z), s.wade);
              }
              view.lastDashes = s.dashes;
            }
          }
          view.footprintDeck = !!client.pred.raftDeck.surface(s.x, s.z, s.y);
          view.update(simDt, s);
          navigation.poseCharacter(view, s, rec.id, simDt);
          view.setLantern?.(playing && rec.lantern === true && s.hp > 0 && !s.dead, playing && rec.human);
          // The Timón rides at the shoulder while charging; Rayo de mástil only uses its ground aim preview.
          const mastboltCharge = rec.id === client.youServer
            ? ps.castK === 3 && skillId(ps.skG) === 'mastbolt'
            : rec.chargeSkill ? rec.chargeSkill === 'mastbolt' : s.elem === 3;
          if ((s.act | 0) === ACT.CHARGE && !mastboltCharge) world.skillFx.charging(rec.id, Math.min(1, (rec.id === client.youServer ? ps.castT : s.actT) / SKILLS.wheel.charge), s.elem);
          if (rec.id === client.youServer) view.glow.value = ps.empT > 0 ? 1.6 + 0.6 * Math.sin(performance.now() / 70) : 1;
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
        const navalInteraction = navigation.interaction();
        const npc = client.naval.active || client.deck.active ? null : nearestNpc();
        if (npc && npcKey(npc) === 'tattoo' && !st.sepiaTaught) {
          st.sepiaTaught = true;
          hud.toast(rich('runtime.tattooHint'), 6500);
        }
        const nearShip = Math.hypot(ps.x - shipPos.x, ps.z - shipPos.z) < 4;
        const chest = !npc && !ps.dead ? rewards.chestNear() : null;
        // The runes of La Caldera, before a trial: pick your Marea (once you have opened more than one).
        const prof = client.profile, AR = map.landmarks.arena, E0 = client.enc && client.enc[0], TIERS = ENCOUNTERS.caldera.tiers;
        const runes = !npc && !chest && prof && prof.flags.tier > 1 && (!E0 || E0[1] === 'idle') && Math.hypot(ps.x - AR.x, ps.z - AR.z) < ENCOUNTERS.caldera.tierR;
        const tierSel = prof ? prof.flags.tierSel || 1 : 1, tierNext = prof ? (tierSel % prof.flags.tier) + 1 : 1;
        const rack = !npc && !chest && !runes && !ps.dead ? rackNear(map, ps.x, ps.z) : null;
        const other = (ps.weapon + 1) % WEAPON_KINDS.length;
        const resourceInteraction = !workbench.active && !navalInteraction && !npc && !chest && !runes && !rack ? resources.interaction() : null;
        const bench = client.resources?.bench;
        if (bench) {
          if (!worldUI.labels.has('workbench')) worldUI.addLabel('workbench', ltext('runtime.bench'), { cls: 'quest', color: '#e6b75b', range: 17 });
          anchor('workbench', bench.x, bench.y + 1.5, bench.z, 0);
        }
        let act = null;
        if (navalInteraction || ps.swim) act = null; // Navigation/swimming HUDs own these prompts.
        else if (npc) act = `<span class="kbd">F</span> ${ltext('runtime.talk', {name:translateData(npc.name)})}`;
        else if (chest) act = rewards.chestPrompt(chest);
        else if (runes) act = `<b>${dataText(TIERS[tierSel - 1].name)}</b> · <span class="kbd">F</span> ${ltext('runtime.changeTier', {name:translateData(TIERS[tierNext - 1].name)})}`;
        else if (rack) {
          act = `<span class="kbd">F</span> ${ltext('runtime.takeWeapon', {name:translateData(weaponOf(other).short).toLowerCase()})}`;
          if (!st.rackTaught) { st.rackTaught = true; hud.toast(rich('runtime.rackHint'), 5200); }
        }
        else if (resourceInteraction) act = resourceInteraction.html;
        else if (nearShip) act = rich('runtime.raftHint');
        else if (st.tut === 'move') act = isTouch ? t('runtime.joy') : rich('runtime.wasd');
        else if (st.tut === 'dash') act = isTouch ? rich('runtime.tapDash') : rich('runtime.spaceDash');
        else if (st.tut === 'attack') {
          const d = Math.hypot(ps.x - map.practice.dummy.x, ps.z - map.practice.dummy.z);
          act = d < 7 ? (isTouch ? rich('runtime.tapCombo') : rich('runtime.clickCombo')) : t('runtime.dummyShore');
        } else if (st.tut === 'parry') {
          const d = Math.hypot(ps.x - map.practice.ring.x, ps.z - map.practice.ring.z);
          act = d < map.practice.ring.r ? (isTouch ? rich('runtime.tapReflect') : rich('runtime.clickReflect')) : t('runtime.enterRing');
        } else if (st.tut === 'guard') {
          const d = Math.hypot(ps.x - map.practice.ring.x, ps.z - map.practice.ring.z);
          act = d < map.practice.ring.r ? (isTouch ? rich('runtime.guardTouch') : rich('runtime.guardMouse')) : rich('runtime.backRing');
        }
        rewards.promptDrop = chest || 0;
        // A chest's prompt sits under the chest (it would cover it under your feet).
        const cv = chest ? world.loot.get(chest) : null;
        if (cv) anchor('you', cv.x, cv.y - 0.1, cv.z, 0); else anchor('you', ps.x, ps.y - 0.1, ps.z, 0);
        // On touch the action button carries the verb (and the key hint is noise): strip it from the prompt.
        if (isTouch) {
          touch.setAction(navalInteraction ? { verb: navalInteraction.verb, icon: 'ship' } : npc ? { verb: t('runtime.verbTalk'), icon: 'talk' } : chest ? { verb: t('runtime.verbOpen'), icon: 'chest' } : runes ? { verb: t('runtime.verbTier'), icon: 'rune' }
            : rack ? { verb: t('runtime.verbSwap'), icon: 'swap' } : resourceInteraction ? { verb: resourceInteraction.verb, icon: resourceInteraction.icon || 'chest' }
            : nearShip ? { verb: t('runtime.verbSail'), icon: 'ship' } : null);
          if (act) act = act.replace('<span class="kbd">F</span> ', '');
        }
        if (act) worldUI.setPrompt('you', act, { below: true }); else worldUI.hidePrompt('you');
        const interact = input.consumeInteract();
        if (!firePanel.active && !workbench.active && !commercePanel.active && !artisan.active && !community.active && interact) {
          if (navalInteraction?.key === 'F') navalInteraction.run();
          else if (navalInteraction?.door || navalInteraction?.lantern) navalInteraction.run();
          else if (npc) {
            const k = npcKey(npc), lines = (NPC_TALK[k] && NPC_TALK[k].lines) || ['…'];
            const i = (st.talkIdx[k] = ((st.talkIdx[k] ?? -1) + 1) % lines.length);
            worldUI.bubble(npc.id, `<b>${dataText(npc.name)}</b>${dataText(lines[i])}`, 5200);
            st.lastLine = lines[i];
            sfx.talk();
            client.send({ t: 'cmd', type: 'talk', npc: npc.id }); // quests (accept, hand in), the stall
          } else if (chest) {
            client.send({ t: 'cmd', type: 'open', drop: chest });
          } else if (runes) {
            client.send({ t: 'cmd', type: 'tier', tier: tierNext });
          } else if (rack) {
            st.wantWeapon = other + 1; // sent with the next command; the sim checks the rack too
          } else if (resourceInteraction) {
            resourceInteraction.run();
          }
        }
        // Mouse aim (raycast cursor → plane at player height) for the camera look-ahead.
        if (mouseAiming()) {
          ndc.set((input.mouse.x / stage.w) * 2 - 1, -(input.mouse.y / stage.h) * 2 + 1);
          ray.setFromCamera(ndc, world.camera);
          plane.constant = -ps.y;
          if (!ray.ray.intersectPlane(plane, aim)) aim.set(ps.x, ps.y, ps.z);
        } else if (!padAiming()) aim.set(ps.x, ps.y, ps.z);
        // M4.7: your aim on the ground: the area being aimed (range ring, marker, the leap's arc) or the Timón's charge.
        const pv = aimCtl.preview;
        if (pv && pv.kind === 'ground' && !ps.dead) {
          const d = readSlots()[pv.slot], g = groundTarget(d);
          world.indicators.area(ps.x, ps.z, d.range, g.x, g.z, d.r, d.id === 'leap' && d.S && !d.S.blink ? d.S.h * 0.7 : 0, d.id === 'iceanchor' ? 0x91e8ff : d.id === 'inkcloud' ? 0xb48aff : undefined);
        } else if (ps.chg && ps.castK && !ps.dead) {
          const slot = ps.castK === 3 ? 'g' : ps.castK === 1 ? 'q' : 'e', S = slotD[slot].S;
          const k = Math.min(1, ps.castT / S.charge);
          if (slot === 'g' && slotD.g.id === 'mastbolt') {
            // A widening yellow wedge makes the 40-degree chain cone readable without covering the fighter.
            world.indicators.charge(ps.x, ps.z, Math.sin(ps.f), Math.cos(ps.f), S.range, 0.12, k, S.range, 0xffdf3b, (S.halfArc || 20) * 2, false);
          } else {
            const len = S.fast.range + (S.slow.range - S.fast.range) * k, w = S.fast.r + (S.slow.r - S.fast.r) * k + (S.rAdd || 0);
            world.indicators.charge(ps.x, ps.z, Math.sin(ps.f), Math.cos(ps.f), len, w, k, 0);
          }
        } else world.indicators.hide();
        const zw = input.consumeWheel();
        if (zw) world.rig.zoom(zw > 0 ? 1 : -1);
        hud.setDash(Math.floor(ps.charges), ps.maxCharges, ps.recharge / tuning.dash.recharge);
        hud.setStats({
          hp: ps.hp, maxHp: ps.maxHp, riposte: ps.riposte, xp: ps.xp, xpNext: xpToNext(ps.level), level: ps.level,
          guard: ps.guardSt / (ps.guardMax || tuning.guard.stamina), catchN: ps.catchN, catchHv: ps.catchHv, combo: ps.atkStage ? ps.atkStage : 0, dead: ps.dead, deadT: ps.deadT,
        });
        // M4: gold, potions, the weapon's mastery and what it has not opened yet.
        hud.setGold(prof ? prof.gold : 0, st.encTier > 1 ? TIERS[st.encTier - 1].name : '');
        hud.setPotions(ps.potions | 0, ps.potCd || 0, CONSUMABLES.potion.cd);
        hud.setWorldClock(client.pred.hourAt(viewTick), client.pred.isNightAt(viewTick), ps.elem);
        const mLvl = Math.floor((ps.mastery || 0) / 16 ** ps.weapon) % 16, kitW = weaponOf(ps.weapon);
        // Q / E lock only an art the weapon's mastery has not opened (a tattoo never locks); R as before.
        const need = (slot) => (mLvl && mLvl < MASTERY.unlock[slot] ? MASTERY.unlock[slot] : 0);
        const needArt = (slot) => { const id = slotD[slot].id; return isArt(id) && mLvl && mLvl < ARTS[id].mastery ? ARTS[id].mastery : 0; };
        const locks = { q: needArt('q'), e: needArt('e'), r: need('r') };
        hud.setLocks(locks, kitW.short.toLowerCase());
        if (isTouch) { touch.setPotions(ps.potions | 0, (ps.potCd || 0) / CONSUMABLES.potion.cd); touch.setLocks(locks); }
        if (mLvl && prof && prof.mast[ps.weapon]) {
          const mx = prof.mast[ps.weapon], nx = MASTERY.xp[Math.min(MASTERY.xp.length - 1, mLvl - 1)];
          hud.setMastery(mLvl, mx[1] / nx, mLvl >= MASTERY.max, t('runtime.mastery',{name:translateData(kitW.short).toLowerCase(),xp:Math.floor(mx[1]),next:nx}));
        } else hud.setMastery(0, 0, false);
        hud.setChain(ps.chain, ps.chainT <= tuning.parry.chainGap && !ps.dead);
        // Q / E follow the loadout (M4.7): icon, rank, form, and the cooldown of the form in use (× the gear's cdr).
        const sd = readSlots(), cdQ = (sd.q.S.cd || 1) * (1 - (ps.cdr || 0)), cdE = (sd.e.S.cd || 1) * (1 - (ps.cdr || 0));
        hud.setWeapon(WEAPON_KINDS[ps.weapon] || 'sable');
        hud.setSlots({ id: sd.q.id, form: ps.fmQ | 0, rank: ps.rkQ | 0 }, { id: sd.e.id, form: ps.fmE | 0, rank: ps.rkE | 0 });
        hud.setPearl(sd.g.id);
        hud.setCooldowns(ps.cdQ, cdQ, ps.cdE, cdE, ps.cdG, (sd.g.S.cd || 0) * (1 - (ps.cdr || 0)));
        if (isTouch) {
          touch.setWeapon(WEAPON_KINDS[ps.weapon] || 'sable');
          touch.setSlots(sd.q.id, sd.e.id, ps.fmQ | 0, ps.fmE | 0);
          touch.setPearl(sd.g.id, ps.cdG / ((sd.g.S.cd || 1) * (1 - (ps.cdr || 0))));
          touch.kinds = slotIn.kinds;
          touch.setCooldowns(ps.cdQ / cdQ, ps.cdE / cdE, ps.riposte >= tuning.parry.riposte.max);
        }
        encounterUi();
        // Walking away from someone ends the talk (and the trading).
        if (dialog.isOpen) { const r = client.entities.get(dialog.ev.ent); if (!r || !r.ready || Math.hypot(r.r.x - ps.x, r.r.z - ps.z) > 5) dialog.hide(); }
        // The panel follows numbers that come with snapshots, not profiles (life, potions): a cheap look twice a second.
        if (charPanel.isOpen && (st.cpT = (st.cpT || 0) + realDt) > 0.5) { st.cpT = 0; charPanel.refresh(); }
        if (charPanel.shop && Math.hypot(vendorAt.x - ps.x, vendorAt.z - ps.z) > 5.5) { charPanel.shop = false; charPanel.refresh(); }
        const crew = [];
        for (const r of client.entities.values()) if (r.human && r.id !== client.youServer && r.ready) crew.push(r.r);
        if (miniMap.map !== world.map) { miniMap.setMap(world.map); mapView.setMap(world.map); }
        const aboard = client.naval?.active && !client.deck?.active;
        const mapPlayer = aboard && navigation.lastPose ? { ...navigation.lastPose, f: navigation.lastPose.yaw } : ps;
        const markers = { crew, rafts: [...(client.pred.rafts?.values() || [])], goal: mapView.goal(prof),
          spill: rewards.spillAt(), target: navigation.mapTarget };
        miniMap.update(realDt, mapPlayer, markers);
        mapView.spill = markers.spill;
        mapView.update(mapPlayer, crew, prof, performance.now() / 1000, markers);
        world.combatFx.setGuard(views.get(client.youServer), ps.act === ACT.GUARD, false, ps.guardSt / tuning.guard.stamina, SKINS[settings.skin].accent);
        if (isTouch) touch.setDash(Math.floor(ps.charges), ps.maxCharges, ps.recharge / tuning.dash.recharge);
      });

      // Camera.
      safe('camera', () => {
        world.rig.shakeScale = settings.shake * (settings.reducedMotion ? 0.3 : 1);
        if (st.sheet) sheetFrame(realDt);
        else if (playing) {
          focus.set(ps.x, ps.y, ps.z);
          if (navigation.applyCamera(realDt, ps, alpha)) { st.navalCamera = true; return; }
          if (st.navalCamera) {
            st.navalCamera = false; st.snapCam = true;
            world.camera.fov = tuning.camera.fov; world.camera.updateProjectionMatrix();
          }
          if (st.snapCam) { world.rig.snapTo(focus); st.snapCam = false; }
          // Combat look-ahead moves the construction grid away from a stationary cursor.
          const cameraAim = !raftEditor.active && (mouseAiming() || padAiming()) ? aim : null;
          world.rig.update(realDt, focus, cameraAim, loop.timeScale);
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
        resources.update();
        const portableLights = [];
        if (playing) for (const rec of client.entities.values()) {
          const root = rec.view?.root;
          if (!root?.visible || !rec.human || !rec.lantern || rec.dying || (rec.id === client.youServer && ps.dead)) continue;
          portableLights.push({ id: rec.id, x: root.position.x, y: root.position.y, z: root.position.z,
            f: root.rotation.y, lit: true, own: rec.id === client.youServer });
        }
        world.update(realDt, { focus, playing, portableLights, resources: resources.renderResources(), lightRaftId: playing ? (client.deck?.shipId || client.naval?.shipId || client.pred.raftDeck.surface(ps.x, ps.z, ps.y)?.id) : null, shelterId: playing ? client.pred.raftDeck.shelterAt(ps.x, ps.z, ps.y)?.id : null, naval: !!(client.naval?.active || client.deck?.active), shadowFocus, simDt, rafts: client.renderRafts(alpha), you: client.youServer, clockPhase: phaseAt(client.pred.gameHoursAt(viewTick)), occ2: playing ? rewards.focusPoint() : null, lawless: st.lawless, combat: { hazards: client.hazards, shots: client.shots, tick: viewTick, inkClouds: client.pred.inkClouds, inkMarks: client.pred.inkMarks, onShot: shotTrail, caught: playing && !ps.dead ? { view: views.get(client.youServer), n: ps.catchN, heavy: ps.catchHv } : null } });
        feedback.update(realDt, viewTick);
        if (devPanel.flags.hitboxes) drawHitboxes(viewTick);
        else debugDraw.end(false);
      });
      safe('audio', () => ambience.update());
      safe('worldui', () => {
        if (playing) worldUI.project(tmpV.set(ps.x, ps.y + 1, ps.z), screenP);
        worldUI.update(anchors, screenP);
      });
      safe('raftEditor', () => raftEditor.update());
      safe('commerce', () => commercePanel.update());
      safe('workbench', () => workbench.update());
      safe('community', () => {
        community.update();
        communityTrigger.hidden = !(st.online && st.mode === 'playing' && workbench.context());
        communityTrigger.disabled = !!community.active;
        artisan.update();
        artisanTrigger.hidden = !(st.online && st.mode === 'playing' && workbench.context());
        artisanTrigger.textContent = client?.resources?.timing === true
          ? (document.documentElement.lang.startsWith('en') ? 'Workshop and backpack' : 'Taller y mochila')
          : (document.documentElement.lang.startsWith('en') ? 'Visit artisan' : 'Visitar artesano');
      });
      safe('render', () => world.render());
      safe('quality', () => quality.frame(realDt, playing && !st.paused));
      st.fps = st.fps * 0.9 + (1 / Math.max(loop.rawDt, 1e-3)) * 0.1;
      if (st.perf) safe('perf', () => {
        const info = world.renderer.info;
        $('#perf').textContent = t('runtime.perf', {
          fps: st.fps.toFixed(0), quality: quality.current, auto: settings.quality === 'auto' ? ' (auto)' : '',
          calls: info.render.calls, triangles: (info.render.triangles / 1000).toFixed(1),
          entities: client.entities.size, network: transport.kind, snaps: transport.stats.snaps,
          connection: st.online ? `  rtt ${transport.rtt.toFixed(0)} ms  ↓${(st.kbIn || 0).toFixed(1)} KB/s` : '',
          prediction: client.stats.predErr.toFixed(4), pending: client.stats.pending,
          x: ps.x.toFixed(1), z: ps.z.toFixed(1), zone: st.zone || '-',
          projectiles: client.hazards.count, reflections: client.shots.count, tick: client.ptCur,
          lag: (client.stats.ptLag >= 0 ? '+' : '') + client.stats.ptLag,
        });
      });
    },
  });

  // First frames under the black fade, then compile everything before enabling JUGAR.
  if (debug) gsap.ticker.lagSmoothing(0);
  if (debug && params.get('maxdt')) { loop.maxFrameDt = +params.get('maxdt'); loop.maxSteps = Math.ceil(loop.maxFrameDt / DT); }
  world.setTitleShadows(true);
  world.onResize();
  worldUI.resize(stage.w, stage.h);
  loop.start();
  await new Promise((r) => setTimeout(r, 60));
  await world.prewarm().catch((e) => console.warn('prewarm', e));
  safe('portraits', () => title.setPortraits(portrait));
  safe('account portraits', () => accountPanel?.setPortraits(portrait));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  gsap.to('#fade', { opacity: 0, duration: reduced() ? 0.3 : 1.2, ease: 'power2.out', onComplete: () => { $('#fade').style.display = 'none'; } });
  title.show(reduced());
  title.ready();
  document.getElementById('bootstrap-locale').hidden = true;
  gmEntry.ready = true; gmEntry.render();
  // Start network timeouts after shader compilation has finished blocking the browser thread.
  initializeAccount().then(() => accountSetup?.consumeLink());
  window.__mn = { world, client, settings, st, ps, map, gmContent, gmContentLayer, quality, transport, loop, input, errors, comic, assets, aimCtl, slotD, navigation, resources, personalLantern, gmEntry, companions, get gmEditor() { return gmEditor; }, panels: { firePanel, charPanel, dialog, mapView, miniMap, raftEditor, commercePanel, chatPanel, workbench, artisan, community, companionsPanel } };
  if (debug) {
    window.__mn.teleport = (x, z) => transport.send({ t: 'cmd', type: 'debug_teleport', x, z });
    // Lighting: __mn.tod('night'), __mn.tod('cycle', 0.75) jumps the cycle to midnight.
    window.__mn.tod = (mode, phase, seconds = 0) => {
      world.lighting.setTimeOfDay(mode, seconds);
      if (phase !== undefined) world.lighting.setPhase(phase);
      return { tod: world.lighting.tod, phase: world.lighting.phase, lights: world.lights.picked.filter((s) => s.w > 0).map((s) => s.kind) };
    };
    // Asset check: __mn.lineup([0, 1, 6], { run: 0.6 }) stands those looks in a row in front of you, animated
    // (run 0 idle … 1 full run; act: an ACT pose id), the camera at its closest; __mn.lineup() clears it. Imported
    // models (docs/ASSETS.md) and procedural looks side by side.
    let lineup = null;
    window.__mn.lineup = (skins = [], o = {}) => {
      if (lineup) { cancelAnimationFrame(lineup.raf); for (const v of lineup.views) world.scene.remove(v.root); lineup = null; }
      if (!skins.length) return [];
      // Facing the camera, in a row across the view a little in front of you.
      const yaw = world.rig.yaw, f = o.facing ?? yaw, gap = o.gap ?? 1.3, cx = ps.x + Math.sin(yaw) * 1.5, cz = ps.z + Math.cos(yaw) * 1.5;
      const views = skins.map((k) => { const v = new CharacterView(k, { sword: !SKINS[k].npc }); world.scene.add(v.root); return v; });
      let t = 0;
      const step = () => {
        t += 1 / 60;
        views.forEach((v, i) => {
          const off = (i - (views.length - 1) / 2) * gap, x = cx + Math.cos(yaw) * off, z = cz - Math.sin(yaw) * off;
          const run = o.run || 0, sp = run * 6.5;
          v.update(1 / 60, { x, y: map.groundAt(x, z), z, f, vx: Math.sin(f) * sp, vz: Math.cos(f) * sp, st: 0, act: o.act || 0, actT: (t % 1) * 0.6, wade: 0 });
        });
        lineup.raf = requestAnimationFrame(step);
      };
      lineup = { views, raf: 0 };
      step();
      world.rig.distTarget = o.dist ?? 6.5;
      return views.map((v) => ({ look: v.look.name, ext: v.ext ? v.ext.id : null, height: +v.height.toFixed(2) }));
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
    // Character sheet: every look in a row on the beach. yaw turns them, run plays the cycle in place
    // (move: walking direction relative to the facing, e.g. π/2 strafes, π backpedals; act/actT pose them),
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
  if (window.__mnFail) window.__mnFail(t('runtime.bootFail'));
});

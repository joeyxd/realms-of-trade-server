// Live presentation and input adapter for the server-owned coastal voyage.
import { NavalLabCamera } from '../render/naval/camera.js';
import { NavalLabEffects } from '../render/naval/effects.js';
import { NavalSpeedFeel } from '../render/naval/speed-feel.js';
import { NavalLabAudio } from '../audio/naval.js';
import { TouchHelm } from '../ui/touchHelm.js';
import { navalHudState, confirmedNavalCapacity } from '../ui/navalHudState.js';
import { buildNavalRig } from '../sim/naval/handling.js';
import { currentAt, gustAt } from '../sim/naval/navigation.js';
import { pilotPoint } from '../sim/naval/pilotGeometry.js';
import { poseNavalHelm } from '../render/navalHelmPose.js';
import { buildLook } from '../render/charlooks.js';
import { assets } from '../render/assets/registry.js';
import { NavalRouteRenderer, routePresentation, routeTarget, routeCommand } from '../render/naval/route.js';
import { lessonPresentation, lessonCommand } from '../ui/navalLessonState.js';
import { DT } from '../data/tuning.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const distance = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.z || 0) - (b?.z || 0));
const axesNeutral = Object.freeze({ x: 0, y: 0 });
export const NAVAL_SHORTCUTS = Object.freeze({ capture: 'Q', bag: 'I', mode: 'E', center: 'V', map: 'M',
  land: 'G', dock: 'G', recall: 'G', reboard: 'F', mount: 'F', leave: 'E' });

export function shoreRouteTarget(voyage, raft, dock) {
  if (voyage?.recovery) {
    if (voyage.landing) return { ...voyage.landing, label: 'Balsa' };
    if (voyage.home) return { ...voyage.home, label: 'Puerto' };
    if (dock?.base && dock?.dir) return {
      x: dock.base.x + dock.dir.x * Math.max(0, dock.len - 10),
      z: dock.base.z + dock.dir.z * Math.max(0, dock.len - 10), label: 'Puerto',
    };
    return raft ? { x: raft.x, z: raft.z, label: 'Balsa' } : null;
  }
  return voyage?.target || voyage?.landing || voyage?.home || null;
}

export class LiveNavigationView {
  constructor({ world, client, input, isTouch = false, stage, parent, onClosePanels = () => {}, active = () => true,
    locale = () => document.documentElement.lang || 'es' } = {}) {
    if (!world?.scene || !world?.camera || typeof client !== 'function' || !input || !parent)
      throw new TypeError('LiveNavigationView needs the game scene, client getter, input, and parent.');
    this.world = world; this.getClient = client; this.input = input; this.isTouch = !!isTouch;
    this.stage = stage; this.parent = parent; this.onClosePanels = onClosePanels; this.isActive = active;
    this.axes = { ...axesNeutral }; this.lastAxes = { throttle: 0, brake: 0, steer: 0 };
    this.cameraWasNaval = false; this.lastPose = null; this.lastBody = null; this.lastRaft = null;
    this.helmVisuals = new Map(); this.lastFeel = { fov: 35, roll: 0 }; this.captureHeld = false; this.actionSignature = '';
    this.lastNotice = ''; this.disposed = false; this.paused = false; this.effectsWasActive = false;
    this.locale = locale; this.activityMode = 'lesson'; this.currentActivity = 'lesson';

    this.root = document.createElement('section');
    this.root.className = `live-navigation is-reference${isTouch ? ' is-touch' : ' is-desktop'}`; this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Navegación de la balsa');
    this.root.innerHTML = `<div class="ln-strip">
      <div class="ln-brand"><span class="ln-mark">MN</span><span><b>TRAVESÍA</b><small class="ln-phase">LISTA PARA ZARPAR</small></span></div>
      <div class="ln-readout ln-speed"><small>VELOCIDAD</small><div class="ln-dial" role="meter" aria-label="Velocidad de la balsa" aria-valuemin="0" aria-valuemax="13" aria-valuenow="0"><svg viewBox="0 0 52 52" aria-hidden="true"><defs><linearGradient id="ln-speed-fire"><stop stop-color="#ffd574"/><stop offset=".55" stop-color="#ff9a3d"/><stop offset="1" stop-color="#ed4b39"/></linearGradient></defs><circle class="ln-dial-track" cx="26" cy="26" r="21" pathLength="100"/><circle class="ln-dial-arc" data-speed-arc cx="26" cy="26" r="21" pathLength="100"/></svg><span class="ln-dial-value" data-speed>0.0</span><i>u/s</i></div></div>
      <div class="ln-readout"><small>CASCO</small><div class="ln-hull" role="meter" aria-label="Integridad del casco" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i data-hull></i></div><b data-hull-text>—</b></div>
      <div class="ln-readout ln-wind"><small>VIENTO</small><b data-wind>—</b><span data-gust>Vela lista</span><div class="ln-gust-track" role="meter" aria-label="Ventana de ráfaga" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="ln-gust-window"></i><i class="ln-gust-perfect"></i><b data-gust-marker></b></div></div>
      <div class="ln-readout ln-flow"><small>AGUA</small><b data-flow>—</b><span data-load>—</span></div>
      <div class="ln-route"><span class="ln-route-arrow" aria-hidden="true">↑</span><span><small data-target-label>RUTA</small><b data-target>Puerto</b><i><span data-heading>000°</span> · <span data-distance>—</span></i></span></div>
      <button class="ln-center" type="button" data-action="center" aria-label="Centrar cámara">Centrar</button>
    </div>
    <div class="ln-route-trial" hidden><span><b data-route-title role="status">Lección costera</b><small data-route-score></small><small class="ln-pilot-learning" data-pilot-learning></small><progress class="ln-lesson-progress" data-lesson-progress max="1" value="0" hidden></progress><small class="ln-route-rules" data-route-rules></small></span><div class="ln-activity-actions"><button type="button" data-route-action>Empezar lección</button><button type="button" data-route-switch>Ensayo con salvas</button></div></div>
    <div class="ln-prompt" aria-live="polite" hidden><kbd data-key>F</kbd><span data-prompt>Preparar timón</span><button type="button" data-run>Usar</button></div>
    <div class="ln-notice" aria-live="polite" hidden></div>
    <div class="ln-touch-objective"><b><i>◆</i> <span data-touch-objective>EXPLORA LA COSTA</span></b><span data-touch-load>Carga 0%</span></div>
    <div class="ln-touch-compass" aria-label="Rumbo y destino"><div class="ln-compass-rose" data-touch-north><span class="ln-compass-n">N</span><span class="ln-compass-e">E</span><span class="ln-compass-s">S</span><span class="ln-compass-w">O</span></div><i class="ln-compass-course" data-touch-course>➤</i><b data-touch-heading>000°</b><small data-touch-distance>Puerto</small></div>
    <div class="ln-touch-wind" aria-label="Viento y ventana de ráfaga"><div class="ln-touch-wind-value"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11c4 0 4-5 1-5-2 0-3 1-3 2M3 12h16c3 0 3 5 0 5-2 0-3-1-3-2M3 16h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><b data-touch-wind>0<span>%</span></b><i data-touch-wind-direction aria-hidden="true">↑</i></div><div class="ln-gust-track" role="meter" aria-label="Ventana de ráfaga" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="ln-gust-window"></i><i class="ln-gust-perfect"></i><b data-touch-gust-marker></b></div><small data-touch-gust-text>Vela lista</small></div>
    <div class="ln-touch-hull" aria-label="Integridad de la embarcación"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18l-4 6H7zM8 12V8h8v4M12 8V3m-3 0h6M2 21l3-1 4 1 3-1 4 1 5-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="ln-touch-hull-value"><small>CASCO</small><b data-touch-hull-text>—</b></span><div class="ln-touch-hull-meter" role="meter" aria-label="Integridad del casco" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i data-touch-hull></i></div></div>
    <div class="ln-touch-callout" hidden><b data-touch-callout></b><span data-touch-detail></span></div>`;
    parent.appendChild(this.root);
    this.$ = (selector) => this.root.querySelector(selector);
    this.touchHull = this.$('.ln-touch-hull');
    if (this.touchHull) {
      // Share the character's HUD layout and scale without copying its mutable health state.
      const bars = this.root.ownerDocument.querySelector('.hud-player .bars');
      if (bars) bars.appendChild(this.touchHull);
      this.touchHullMeter = this.touchHull.querySelector('[role="meter"]');
      this.touchHullFill = this.touchHull.querySelector('[data-touch-hull]');
      this.touchHullValue = this.touchHull.querySelector('[data-touch-hull-text]');
    }
    this.prompt = this.$('.ln-prompt');
    this.sceneCamera = new NavalLabCamera(world.camera);
    this.effects = new NavalLabEffects(world.scene, { mobile: isTouch, reducedMotion: false });
    this.routeRenderer = new NavalRouteRenderer(world.scene, { mobile: isTouch });
    this.routeShotIds = new Set();
    this.routeShotRecords = new Map();
    this.routeImpactEvents = new Set();
    this.routeVisualTick = 0; this.routeServerTick = 0;
    this.speedFeel = new NavalSpeedFeel(this.root, { mobile: isTouch });
    this.sound = new NavalLabAudio({ mobile: isTouch });
    this.$('[data-action="center"]').addEventListener('click', () => { if (this.canAct()) this.sceneCamera.recenter(); });
    this.$('[data-run]').addEventListener('click', () => this.interaction()?.run?.());
    this.$('[data-route-action]').addEventListener('click', () => this.runRouteAction());
    this.$('[data-route-switch]').addEventListener('click', () => {
      const c = this.client();
      if (!this.canAct() || c?.route?.active || c?.lesson?.active) return;
      this.activityMode = this.currentActivity === 'lesson' ? 'trial' : 'lesson';
    });
    // Both input modes share the reference instrument, action bindings and live readings.
    // Desktop keeps keyboard/mouse movement; only its action cards and gauge are displayed.
    this.touch = new TouchHelm(parent, { enabled: false, layout: 'reference', storageKey: 'mn:naval-touch-loadout:v1',
      toLocal: stage?.toLocal?.bind(stage), onMove: (value) => { this.axes = { x: value.x, y: -value.y }; },
      onLook: (value) => this.sceneCamera.setLook(value), onGesture: () => { this.sound.unlock(); onClosePanels(); },
      onAction: (id) => this.runAction(id), actions: [] });
    this.touch.wrapper.classList.toggle('is-desktop', !isTouch);
    this.touch.wrapper.setAttribute('aria-label', isTouch ? 'Controles táctiles de navegación' : 'Maniobras de navegación');
    this.buildTouchGauge();
    if (!isTouch) {
      const hints = document.createElement('small'); hints.className = 'ln-desktop-controls';
      hints.textContent = 'WASD · navegar   Q · ráfaga   E · cubierta   G · amarrar';
      this.touch.instrument.appendChild(hints);
    }
    this.onBlur = () => this.clearInput(true);
    this.onVisibility = () => { if (document.hidden) this.clearInput(true); };
    this.panelShortcuts = [];
    for (const key of ['KeyF', 'KeyE', 'KeyG']) {
      const previous = input.hotkeys?.get(key);
      const handler = () => {
        if (!this.canAct()) return false;
        const action = this.keyAction(key.slice(-1));
        if (!action) return false;
        action.run(); this.onGesture(); return true;
      };
      this.panelShortcuts.push({ key, previous, handler }); input.onHotkey?.(key, handler);
    }
    for (const id of ['bag', 'map', 'center']) {
      const key = `Key${NAVAL_SHORTCUTS[id]}`, previous = input.hotkeys?.get(key);
      const handler = (event) => {
        const c = this.client();
        if (this.canAct() && (c?.naval?.active || c?.deck?.active)) {
          this.runAction(id); return true;
        }
        return previous?.(event) || false;
      };
      this.panelShortcuts.push({ key, previous, handler }); input.onHotkey?.(key, handler);
    }
    globalThis.addEventListener?.('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  client() { return this.getClient(); }
  body() { return this.client()?.naval?.active ? this.client().naval.body : null; }
  voyage() { return this.client()?.voyage || { active: false }; }
  navActive() { const c = this.client(); return !!(c?.naval?.active || c?.deck?.active || this.voyage().active); }

  onGesture() { this.sound.unlock(); this.onClosePanels(); }

  update(dt, alpha, ps, { paused = false, reducedMotion = false, muted = false } = {}) {
    if (this.disposed) return;
    const c = this.client(), voyage = c?.voyage || { active: false }, route = c?.route || null, lesson = c?.lesson || null;
    if (!voyage.active) this.mapTarget = null;
    const enabled = !!c?.joined && !!this.isActive() && !paused;
    this.paused = !!paused;
    const aboard = !!(c?.naval?.active || c?.deck?.active);
    this.root.classList.toggle('is-aboard', aboard);
    this.root.classList.toggle('is-recovery', !!(voyage.active && voyage.phase === 'shore' && voyage.recovery));
    document.body.classList.toggle('is-naval', aboard);
    document.body.classList.toggle('is-naval-touch', aboard && this.isTouch);
    const body = c?.naval?.active ? c.naval.body : null;
    this.updateRoute(c?.route || null, c?.route?.tick || body?.state?.tick || 0, dt);
    const raftId = body && c.naval.shipId || (c?.deck?.active ? c.deck.shipId : voyage.shipId);
    const records = c?.renderRafts?.(alpha) || c?.pred?.rafts || [];
    const raft = raftId ? records.find((r) => String(r.id) === String(raftId)) : null;
    this.lastBody = body; this.lastRaft = raft;
    const interaction = this.interaction();
    const routeSummary = !!(route?.available && ['complete', 'aborted'].includes(route.status) && route.home &&
      c?.cur && distance(c.cur, route.home) <= 24);
    const lessonSummary = !!(lesson?.available && ['complete', 'aborted'].includes(lesson.status) && lesson.home &&
      c?.cur && distance(c.cur, lesson.home) <= 24);
    this.root.hidden = !enabled || (!voyage.active && !c?.naval?.active && !c?.deck?.active && !interaction && !routeSummary && !lessonSummary);
    if (this.touchHull) this.touchHull.hidden = !enabled || !aboard;
    this.$('.ln-strip').hidden = !voyage.active && !aboard;
    this.touch?.setEnabled(enabled && !!(c?.naval?.active || c?.deck?.active));
    this.speedFeel.reducedMotion = !!reducedMotion;
    this.effects.reducedMotion = !!reducedMotion;
    this.sceneCamera.reducedMotion = !!reducedMotion;
    if (this.sound.enabled === !!muted) this.sound.setEnabled(!muted);
    this.world.rafts?.update?.(records, this.world.time || 0, c?.youServer || 0);
    const frameAxes = this.fixedAxes();
    this.lastAxes = frameAxes?.naval || { throttle: 0, brake: 0, steer: 0 };
    this.updateAllHelms(records, dt, body, c);
    this.updatePrompt(interaction);
    if (!body && c?.deck?.active && raft?.parts) {
      this.lastState = this.stateFromRaft(raft, dt);
      this.lastRig = buildNavalRig(raft.parts, []);
      this.lastPose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
    }
    if (!enabled || (!body && !c?.deck?.active)) {
      if (enabled && voyage.active && voyage.phase === 'shore' && raft?.parts) {
        const shoreState = this.stateFromRaft(raft, dt), shoreRig = buildNavalRig(raft.parts, []);
        const shorePose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
        const wind = { yaw: 0, strength: 0 }, current = currentAt(shoreState.x, shoreState.z, true);
        this.updateHud({ body: null, state: shoreState, rig: shoreRig, wind, gust: null, activity: null,
          current, voyage, pose: shorePose, speed: Math.hypot(shoreState.vx, shoreState.vz) });
      }
      this.deactivateEffects(); this.sound.update({ paused: true });
      this.speedFeel.update(dt, { enabled: false, paused: false });
      if (this.cameraWasNaval) { this.world.rig?.setMode?.('iso'); this.world.rig?.blendFromCurrent?.(0.45); this.sceneCamera.reset(); this.cameraWasNaval = false; }
      this.updateActions();
      return;
    }

    const state = body?.state || this.lastState || this.stateFromRaft(raft, dt);
    const rig = body?.operational?.rig || this.lastRig || (raft?.parts ? buildNavalRig(raft.parts, []) : null);
    const pose = body?.pose || this.lastPose || (raft && { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw });
    if (!state || !rig || !pose) return;
    this.lastState = state; this.lastRig = rig; this.lastPose = pose;
    const wind = body?.wind || c.naval.wind || { yaw: 0, strength: 0 };
    const current = body?.flow || (pose ? currentAt(state.x, state.z, true) : null);
    const gust = body?.gust || gustAt(state.tick || 0, wind, true);
    const activity = body?.activity || { boostUntil: 0, multiplier: 1 };
    const currentAxes = frameAxes;

    const boost = state.tick < (activity.boostUntil || 0) ? clamp((activity.multiplier - 1) / 1.5, 0, 1) : 0;
    this.helmVisual = raft && this.helmVisuals.get(String(raft.id));
    if (body?.flowOrigin) this.effects.setFlowOrigin(body.flowOrigin);
    this.effects.update(dt, { state, rig, wind, gust, activity, current, currents: true, paused });
    this.effectsWasActive = true;
    this.sound.update({ state, rig, gust, activity, current, paused });
    const speed = Math.hypot(finite(state.vx), finite(state.vz));
    this.lastFeel = this.speedFeel.update(dt, { speed, omega: finite(state.omega), boosting: boost > 0, enabled: true, paused });
    this.updateHud({ body, state, rig, wind, gust, activity, current, voyage, pose, speed, paused });
    this.updateActions();
  }

  stateFromRaft(raft, dt) {
    if (!raft) return null;
    const prior = this.lastPose, step = Math.max(1e-3, Math.min(0.1, finite(dt, 1 / 60)));
    const state = { x: raft.x, z: raft.z, yaw: raft.yaw, tick: 0, omega: 0, vx: 0, vz: 0 };
    if (prior) { state.vx = (raft.x - prior.x) / step; state.vz = (raft.z - prior.z) / step; }
    this.lastPose = { x: raft.x, z: raft.z };
    return state;
  }

  deactivateEffects() {
    if (this.effectsWasActive) this.effects.reset();
    this.effectsWasActive = false;
  }

  fixedAxes() {
    const c = this.client();
    const live = !!(c?.naval?.active || c?.deck?.active);
    if (!live) return null;
    const pad = this.input.pad || {};
    const keys = this.input.keys;
    let kx = (keys?.has?.('KeyD') || keys?.has?.('ArrowRight') ? 1 : 0) - (keys?.has?.('KeyA') || keys?.has?.('ArrowLeft') ? 1 : 0);
    let ky = (keys?.has?.('KeyW') || keys?.has?.('ArrowUp') ? 1 : 0) - (keys?.has?.('KeyS') || keys?.has?.('ArrowDown') ? 1 : 0);
    let x = clamp(this.axes.x || (this.input.joy?.active ? this.input.joy.x : 0) || pad.mx || kx, -1, 1);
    let y = clamp(this.axes.y || (this.input.joy?.active ? this.input.joy.y : 0) || pad.my || ky, -1, 1);
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    const capture = !!(this.captureHeld || this.input.slotHeld?.('q') || keys?.has?.('KeyQ') || pad.prev?.[5]);
    return { naval: { throttle: Math.max(0, y), brake: Math.max(0, -y), steer: x, capture }, deck: { mx: x, mz: y } };
  }

  fixedInput() {
    const axes = this.fixedAxes();
    if (axes?.naval && this.captureHeld) this.captureHeld = false;
    return axes;
  }

  poseCharacter(view, s, id, dt) {
    const c = this.client();
    const records = c?.renderRafts?.(1) || [];
    for (const raft of records) {
      const member = raft.crew?.find((entry) => String(entry.entity) === String(id) && entry.mode === 'helm');
      const visual = this.helmVisuals.get(String(raft.id));
      if (member && visual?.gripWorld) {
        // Reuse the character's cached empty-hand build while both hands hold the tiller.
        if (view.armed) {
          if (view.mesh.geometry !== view.navalBareGeometry) view.navalWeaponGeometry = view.mesh.geometry;
          view.navalBareGeometry = (view.ext && assets.charLook(view.skin, false) || buildLook(view.skin, false)).geo;
          view.mesh.geometry = view.navalBareGeometry;
        }
        return view.navalPose = poseNavalHelm(view, { active: true, gripWorld: visual.gripWorld });
      }
    }
    if (view.navalWeaponGeometry) {
      // A weapon change can already have restored the correct armed geometry this frame.
      if (view.mesh.geometry === view.navalBareGeometry) view.mesh.geometry = view.navalWeaponGeometry;
      view.navalWeaponGeometry = null;
    }
    return view.navalPose = { active: false, handsWorld: null };
  }

  updateAllHelms(records, dt, body, c) {
    this.helmVisuals.clear();
    for (const raft of records) {
      if (!raft?.helm) continue;
      const ownActive = !!(body && String(c.naval.shipId) === String(raft.id));
      const activeBody = ownActive ? body : null;
      // Use the same interpolated pose as the visible hull and character this frame.
      const pose = raft;
      const anchor = raft.helm;
      let pilot = null;
      try { pilot = pilotPoint(pose, anchor); } catch { /* Ignore an incomplete public anchor. */ }
      const visual = this.world.rafts?.setSailing?.(raft.id, { active: true,
        steer: ownActive && !c.deck?.active ? this.lastAxes?.steer || 0 : 0,
        windYaw: activeBody?.wind?.yaw || c.naval?.wind?.yaw || 0,
        boost: activeBody && activeBody.state.tick < activeBody.activity?.boostUntil
          ? clamp((activeBody.activity.multiplier - 1) / 1.5, 0, 1) : 0, dt, pilot });
      if (visual) this.helmVisuals.set(String(raft.id), visual);
    }
  }

  applyCamera(dt, ps, alpha = 1) {
    const c = this.client(), voyage = c?.voyage || { active: false };
    if (!this.navActive() || !this.isActive() || (voyage.active && voyage.phase === 'shore')) return false;
    let body = this.body(), raft = this.lastRaft;
    if (!raft) raft = c?.renderRafts?.(alpha)?.find((r) => String(r.id) === String(body ? c.naval.shipId : c?.deck?.shipId || voyage.shipId));
    const pose = body?.pose || this.lastPose || (raft && { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw });
    const state = body?.state || this.lastState || (raft && this.stateFromRaft(raft, dt));
    const rig = body?.operational?.rig || this.lastRig || (raft?.parts ? buildNavalRig(raft.parts, []) : null);
    if (!pose || !state || !rig) return false;
    const boost = body && state.tick < body.activity?.boostUntil;
    const feel = this.lastFeel;
    this.sceneCamera.update(dt, { state, rig, pose, mode: 'chase', fovOffset: feel.fov - 35, roll: feel.roll });
    this.cameraWasNaval = true;
    return true;
  }

  interaction() {
    const c = this.client();
    if (!c?.joined || !this.isActive()) return null;
    const voyage = c.voyage || { active: false };
    if (voyage.active) {
      if (voyage.phase === 'shore') {
        const player = c.youServer && c.cur;
        const actions = [];
        if (player && voyage.landing && distance(player, voyage.landing) <= 4)
          actions.push({ key: 'F', prompt: 'Balsa · volver a bordo', verb: 'Reembarcar', run: () => this.command('reboard', voyage.shipId) });
        const dock = this.world.map?.dock;
        if (player && dock) {
          const home = { x: dock.base.x + dock.dir.x * Math.max(0, dock.len - 10), z: dock.base.z + dock.dir.z * Math.max(0, dock.len - 10) };
          if (distance(player, home) <= 6) actions.push({ key: 'G', prompt: 'Puerto · recuperar la balsa',
            verb: voyage.recovery ? 'Recuperar en puerto' : 'Recuperar', run: () => this.command('recall') });
        }
        return this.actionSet(actions);
      }
      const options = [];
      if (voyage.canDock) options.push({ key: 'G', prompt: 'Puerto · amarrar y cerrar travesía', verb: 'Amarrar', run: () => this.command('dock') });
      if (c.deck?.active) {
        const player = c.youServer && c.cur;
        const raft = (c.renderRafts?.(1) || c.pred?.rafts || []).find((r) => String(r.id) === String(voyage.shipId));
        const helm = raft?.helm && pilotPoint(raft, raft.helm);
        if (player && helm && distance(player, helm) <= 2)
          options.push({ key: 'E', prompt: 'Cubierta · volver al timón', verb: 'Timón', run: () => c.helmNaval?.() });
      }
      else if (c.naval?.active) options.push({ key: 'E', prompt: 'Timón · caminar por cubierta', verb: 'Caminar', run: () => c.walkNaval?.() });
      else if (voyage.canLand) options.push({ key: 'G', prompt: 'Costa · bajar con seguridad', verb: 'Desembarcar', run: () => this.command('land') });
      return this.actionSet(options);
    }
    if (c.deck?.active) return this.actionSet([{ key: 'E', prompt: 'Pasajero · bajar de la balsa', verb: 'Bajar', run: () => c.leaveDeck?.() }]);
    const player = c.youServer && c.cur;
    if (!player) return null;
    const raft = (c.pred?.rafts || []).find((r) => r.owner === c.youServer && r.helm);
    if (!raft) return null;
    const helm = pilotPoint(raft, raft.helm);
    if (distance(player, helm) > 2) return null;
    const capacity = c.capacity?.id === raft.id && c.capacity.raftRev === raft.rev &&
      c.capacity.tradeRev === c.profile?.eco?.tradeRev ? c.capacity : null;
    const prompt = capacity?.status === 'overloaded' ? `Sobrecargada · exceso ${capacity.overMass.toFixed(1)} uM · refuerza o reduce carga`
      : capacity?.status === 'heavy' ? `Balsa pesada · ${capacity.freeMass.toFixed(1)} uM libres · iniciar travesía`
        : 'Puesto de mando · iniciar travesía';
    return this.actionSet([{ key: 'F', prompt, verb: 'Pilotar', run: () => { this.onClosePanels(); c.mountNaval(raft.id); } }]);
  }

  canAct() { return !this.disposed && !!this.isActive() && !!this.input.enabled && !this.paused; }
  actionSet(actions) {
    if (!actions.length) return null;
    const guarded = actions.map((action) => ({ ...action, run: () => this.canAct() ? action.run?.() : false }));
    return { ...guarded[0], actions: guarded };
  }
  keyAction(key) { return this.interaction()?.actions?.find((action) => action.key === key.toUpperCase()) || null; }

  updatePrompt(action) {
    const prompt = this.prompt;
    prompt.hidden = !action;
    if (!action) return;
    this.$('[data-key]').textContent = action.key;
    this.$('[data-prompt]').textContent = action.prompt;
    this.$('[data-run]').textContent = action.verb;
    this.$('[data-run]').setAttribute('aria-label', action.verb);
  }

  clearInput(sendNeutral = false) {
    this.axes = { ...axesNeutral }; this.captureHeld = false;
    this.touch?.clear();
    if (!sendNeutral) return;
    const c = this.client(); c?.neutralNaval?.(); c?.neutralDeck?.();
  }

  command(op, shipId = null) {
    const c = this.client(); if (!c) return false;
    const clientOp = { land: 'landNaval', dock: 'dockNaval', reboard: 'reboardNaval' }[op];
    if (typeof c[clientOp] === 'function') { c[clientOp](...(shipId ? [shipId] : [])); return true; }
    const message = { t: 'cmd', type: 'navalPilot', op };
    if (op !== 'reboard' && op !== 'recall') message.epoch = c.naval?.epoch;
    if (shipId) message.shipId = shipId;
    c.send(message); return true;
  }

  updateRoute(route, tick, dt = 0) {
    const lesson = this.client()?.lesson;
    if (route?.active) this.activityMode = 'trial';
    if (lesson?.active) this.activityMode = 'lesson';
    if (lesson?.available && !route?.active && this.activityMode !== 'trial') {
      this.updateLesson(lesson, tick); return;
    }
    this.currentActivity = 'trial';
    const swap = this.$('[data-route-switch]');
    if (swap) {
      swap.hidden = !lesson?.available || !!route?.active;
      swap.textContent = this.locale?.().startsWith('en') ? 'Coastal lesson' : 'Lección costera';
    }
    const rules = this.$('[data-route-rules]');
    if (rules) rules.textContent = 'Sin botín ni XP · hasta 24 HP reparables · tu carga se conserva';
    this.$('[data-pilot-learning]').hidden = true;
    const progress = this.$('[data-lesson-progress]');
    if (progress) progress.hidden = true;
    const box = this.$('.ln-route-trial');
    if (box.dataset) box.dataset.activity = 'trial';
    const helm = !!this.client()?.naval?.active && !this.client()?.deck?.active;
    const outcome = route?.status === 'complete' || route?.status === 'aborted';
    this.root.classList.toggle('has-route-trial', !!route?.available && (helm || outcome));
    if (!route) {
      box.hidden = true; this.routeVisualRunId = null; this.routeVisualTick = 0; this.routeServerTick = 0;
      this.routeShotIds.clear(); this.routeShotRecords.clear(); this.routeImpactEvents.clear();
      this.routeRenderer.update(null, tick); return;
    }
    box.hidden = !route.available || (!helm && !outcome);
    const view = routePresentation(route);
    this.$('[data-route-title]').textContent = view.stage;
    this.$('[data-route-score]').textContent = view.score;
    const button = this.$('[data-route-action]');
    button.hidden = !helm;
    button.textContent = route.active ? 'Salir del ensayo'
      : route.status === 'complete' || route.status === 'aborted' ? 'Repetir ruta' : 'Probar ruta';
    button.disabled = !helm || (route.active ? !route.canAbort : !route.canStart);
    button.setAttribute('aria-label', button.textContent);
    if (route.runId !== this.routeVisualRunId) {
      this.routeVisualRunId = route.runId; this.routeServerTick = tick; this.routeVisualTick = tick;
      this.routeShotIds.clear(); this.routeShotRecords.clear(); this.routeImpactEvents.clear();
    }
    else if (tick > this.routeServerTick) { this.routeServerTick = tick; this.routeVisualTick = tick; }
    else this.routeVisualTick = Math.min(this.routeServerTick + 6,
      this.routeVisualTick + Math.max(0, Math.min(0.1, Number(dt) || 0)) / DT);
    this.routeRenderer.update(route, this.routeVisualTick);
    const ids = new Set((route.shots || []).map((shot) => String(shot.id)));
    for (const shot of route.shots || []) {
      const id = String(shot.id);
      this.routeShotRecords.set(id, shot);
      if (!this.routeShotIds.has(id) && Number(shot.impactTick) > Number(tick || 0)) {
        this.effects.event('approach', this.lastBody?.state, this.lastBody?.operational?.rig, shot);
        this.sound.event('approach');
      }
    }
    for (const id of this.routeShotIds) if (!ids.has(id)) {
      if (!this.routeImpactEvents.has(id)) {
        if (route.active) {
          const shot = this.routeShotRecords.get(id);
          this.effects.event('impact', this.lastBody?.state, this.lastBody?.operational?.rig, shot);
          this.sound.event('impact');
        }
      }
      this.routeImpactEvents.delete(id);
      this.routeShotRecords.delete(id);
    }
    this.routeShotIds = ids;
  }

  updateLesson(lesson, tick) {
    this.currentActivity = 'lesson';
    const c = this.client(), helm = !!c?.naval?.active && !c?.deck?.active;
    const outcome = ['complete', 'aborted'].includes(lesson.status);
    const box = this.$('.ln-route-trial');
    box.hidden = !lesson.available || (!helm && !lesson.active && !outcome);
    box.dataset.activity = 'lesson';
    this.root.classList.toggle('has-route-trial', !box.hidden);
    const view = lessonPresentation(lesson, this.locale(), { atHelm: helm, isTouch: this.isTouch });
    this.$('[data-route-title]').textContent = view.stage;
    this.$('[data-route-score]').textContent = view.detail;
    this.$('[data-route-rules]').textContent = view.rules;
    const learning = this.$('[data-pilot-learning]');
    learning.hidden = false; learning.textContent = view.learningLabel;
    const button = this.$('[data-route-action]');
    button.hidden = !helm; button.textContent = view.button;
    button.disabled = !helm || !(lesson.active ? lesson.canAbort : lesson.canStart);
    button.setAttribute('aria-label', view.button);
    const swap = this.$('[data-route-switch]');
    swap.hidden = lesson.active || !c?.route?.available || !helm;
    swap.textContent = view.switchLabel;
    const progress = this.$('[data-lesson-progress]');
    progress.hidden = lesson.status !== 'maneuver'; progress.value = view.progress;
    progress.setAttribute('aria-label', view.detail);
    // Reuse the existing pooled markers; lessons never render a battery or salvos.
    this.routeRenderer.update({ ...lesson, threat: null, shots: [] }, tick);
    this.routeVisualRunId = null;
    this.routeShotIds.clear(); this.routeShotRecords.clear(); this.routeImpactEvents.clear();
  }

  runRouteAction() {
    if (!this.canAct()) return false;
    const c = this.client(), route = c?.route;
    if (this.currentActivity === 'lesson') {
      if (!c?.naval?.active || c?.deck?.active || route?.active) return false;
      const command = lessonCommand(c?.lesson, c.naval.epoch);
      if (!command) return false;
      c.send(command); return true;
    }
    if (!route?.available || !c?.naval?.active || c?.deck?.active || (route.active ? !route.canAbort : !route.canStart)) return false;
    const command = routeCommand(route, c.naval.epoch);
    if (!command) return false;
    c.send(command);
    return true;
  }

  runAction(id) {
    if (!this.canAct()) return false;
    if (id === 'capture') {
      if (!this.client()?.naval?.active || this.client()?.deck?.active) return false;
      this.captureHeld = true; return true;
    }
    if (id === 'context') { this.interaction()?.run?.(); return; }
    if (id === 'land' || id === 'dock' || id === 'recall') { this.keyAction('G')?.run?.(); return; }
    if (id === 'reboard' || id === 'mount') { this.keyAction('F')?.run?.(); return; }
    if (id === 'mode' || id === 'leave') { this.keyAction('E')?.run?.(); return; }
    if (id === 'center') this.sceneCamera.recenter();
    if (id === 'bag' || id === 'map') this.root.ownerDocument.querySelector(id === 'bag' ? '#hud-bag' : '#hud-map')?.click();
  }

  updateActions() {
    if (!this.touch) return;
    const c = this.client(), i = this.interaction(), actions = [];
    if (c?.naval?.active && !c?.deck?.active && c.voyage?.phase === 'sailing')
      actions.push({ id: 'capture', label: 'Ráfaga', icon: 'wind', kind: 'skill', disabled: !!this.lastHud?.captureDisabled });
    actions.push({ id: 'bag', label: 'Mochila', icon: 'cargo', kind: 'item' });
    if (c?.naval?.active || c?.deck?.active)
      actions.push({ id: 'mode', label: c?.deck?.active ? 'Timón' : 'Cubierta', icon: c?.deck?.active ? 'helm' : 'crew', kind: 'action', disabled: !i?.actions?.some(a => a.key === 'E') });
    actions.push({ id: 'center', label: 'Centrar', icon: 'center', kind: 'action' }, { id: 'map', label: 'Mapa', icon: 'map', kind: 'action' });
    for (const action of i?.actions || []) if (action.key === 'G' || action.key === 'F')
      actions.push({ id: action.key === 'F' ? 'reboard' : action.verb === 'Amarrar' ? 'dock' : action.verb === 'Desembarcar' ? 'land' : 'recall',
        label: action.verb, icon: action.key === 'G' ? 'helm' : 'crew', kind: 'action' });
    const keyedActions = actions.map((action) => ({ ...action, shortcut: NAVAL_SHORTCUTS[action.id] }));
    const signature = JSON.stringify(keyedActions);
    if (signature !== this.actionSignature) { this.actionSignature = signature; this.touch.setActions(keyedActions); }
    const hints = this.touch.instrument.querySelector('.ln-desktop-controls');
    if (hints) hints.textContent = c?.deck?.active
      ? 'WASD · caminar   E · timón   G · amarrar'
      : 'WASD · navegar   Q · ráfaga   E · cubierta   G · amarrar';
  }

  updateHud({ body, state, rig, wind, gust, activity, current, voyage, pose, speed }) {
    const hull = this.lastRaft?.hull || (body?.structure ? { hp: body.structure.hp, maxHp: body.structure.maxHp,
      fraction: body.structure.maxHp ? body.structure.hp / body.structure.maxHp : 0, disabled: body.operational.disabled } : null);
    const pct = clamp((hull?.fraction ?? 1) * 100, 0, 100);
    const $ = this.$;
    const stateHud = navalHudState({ state, rig, wind, gust, activity, current, paused: this.paused });
    this.lastHud = stateHud;
    $('[data-speed]').textContent = speed.toFixed(1);
    $('[data-speed-arc]').setAttribute('stroke-dasharray', `${stateHud.speedFraction * 75} 100`);
    $('.ln-dial').setAttribute('aria-valuenow', String(Math.round(speed * 10) / 10));
    $('[data-hull-text]').textContent = hull ? `${Math.ceil(hull.hp)} / ${Math.ceil(hull.maxHp)} HP${hull.disabled ? ' · INUTILIZADA' : ''}` : 'Sin lectura';
    $('[data-hull]').style.width = `${pct}%`;
    $('.ln-hull').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('.ln-hull').setAttribute('aria-valuetext', hull ? `${Math.round(pct)} por ciento` : 'Sin lectura');
    $('[data-wind]').textContent = `${Math.round((wind.strength || 0) * 100)}% · ${Math.round(((wind.yaw || 0) * 180 / Math.PI + 360) % 360)}°`;
    $('[data-gust]').textContent = stateHud.gustText;
    for (const track of [$('.ln-gust-track'), $('.ln-touch-wind .ln-gust-track')].filter(Boolean)) {
      track.setAttribute('aria-valuenow', String(Math.round(stateHud.gustProgress * 100)));
      track.style.setProperty('--ln-gust-progress', `${stateHud.gustProgress * 100}%`);
      track.style.setProperty('--ln-gust-window-start', `${stateHud.gustMarks.windowStart * 100}%`);
      track.style.setProperty('--ln-gust-window-end', `${stateHud.gustMarks.windowEnd * 100}%`);
      track.style.setProperty('--ln-gust-perfect-start', `${stateHud.gustMarks.perfectStart * 100}%`);
      track.style.setProperty('--ln-gust-perfect-end', `${stateHud.gustMarks.perfectEnd * 100}%`);
    }
    $('[data-flow]').textContent = current?.strength > 0.08 ? `${current.strength.toFixed(1)} u/s` : 'Agua calma';
    const capacity = confirmedNavalCapacity(this.client(), this.lastRaft, voyage);
    const carryingText = capacity ? capacity.status === 'overloaded' ? `Exceso ${capacity.overMass.toFixed(1)} uM · regresa para descargar`
      : `${capacity.status === 'heavy' ? 'Pesada · ' : ''}Porte libre ${capacity.freeMass.toFixed(1)} uM` : 'Actualizando porte…';
    $('[data-load]').textContent = capacity ? `${carryingText} · bodega ${capacity.holdVolume}/${capacity.holdCap} uV` : carryingText;
    const lesson = this.client()?.lesson;
    const route = lesson?.active ? lesson : this.client()?.route;
    const target = voyage.phase === 'shore' ? shoreRouteTarget(voyage, this.lastRaft, this.world.map?.dock)
      : routeTarget(route, voyage);
    this.mapTarget = target;
    const label = lesson?.active && voyage.phase !== 'shore' ? lessonPresentation(lesson, this.locale()).targetLabel
      : target?.label || (voyage.phase === 'shore' ? 'Balsa' : 'Puerto');
    const routeOrigin = voyage.phase === 'shore' ? this.client()?.cur || pose : pose;
    const metres = target ? distance(routeOrigin, target) : (voyage.distanceHome ?? 0);
    $('[data-target-label]').textContent = voyage.phase === 'shore'
      ? voyage.recovery && !voyage.landing ? 'RECUPERAR EN PUERTO' : 'REEMBARQUE' : 'RUMBO';
    $('[data-target]').textContent = label;
    $('[data-distance]').textContent = target ? `${metres.toFixed(0)} m` : '—';
    $('[data-heading]').textContent = `${stateHud.headingText}°`;
    const yaw = voyage.phase === 'shore' ? routeOrigin.f || 0 : state.yaw || 0;
    const bearing = target ? Math.atan2(target.x - routeOrigin.x, target.z - routeOrigin.z) : yaw;
    this.$('.ln-route-arrow').style.transform = `rotate(${(bearing - yaw) * 180 / Math.PI}deg)`;
    $('.ln-phase').textContent = voyage.phase === 'shore'
      ? voyage.recovery ? 'BALSA RECUPERABLE · POSICIÓN GUARDADA' : 'EXPLORANDO LA COSTA'
      : body ? 'EN EL MAR' : 'EN CUBIERTA';
    $('.ln-route').classList.toggle('is-shore', voyage.phase === 'shore');
    if (this.touch) {
      $('[data-touch-wind]').firstChild.textContent = String(Math.round((wind.strength || 0) * 100));
      $('[data-touch-wind-direction]').style.transform = `rotate(${((wind.yaw || 0) - yaw) * 180 / Math.PI}deg)`;
      $('.ln-touch-wind').dataset.ready = gust?.phase === 'window' && !stateHud.captureDisabled && !this.client()?.deck?.active ? 'true' : 'false';
      const gustText = $('[data-touch-gust-text]');
      gustText.textContent = this.client()?.deck?.active ? 'Toma el timón' : stateHud.boostActive ? `BOOST ${stateHud.boostSeconds.toFixed(1)} s`
        : !(wind.strength > 0) ? 'Sin viento' : stateHud.captureDisabled ? 'Ráfaga resuelta'
          : gust?.phase === 'window' ? '¡AHORA!'
            : `Ráfaga ${Math.ceil(gust?.remaining || 0)} s`;
      gustText.title = stateHud.gustText;
      this.touchHullFill.style.width = `${pct}%`;
      this.touchHullValue.textContent = hull ? `${Math.ceil(hull.hp)} / ${Math.ceil(hull.maxHp)}` : '—';
      this.touchHullMeter.setAttribute('aria-valuenow', String(Math.round(pct)));
      this.touchHullMeter.setAttribute('aria-valuetext', hull ? `${Math.ceil(hull.hp)} de ${Math.ceil(hull.maxHp)} HP` : 'Sin lectura');
      this.touchHull.dataset.danger = pct <= 25 || hull?.disabled ? 'true' : 'false';
      const gauge = this.touch.instrument.querySelector('.naval-touch-gauge');
      gauge.setAttribute('aria-valuenow', String(Math.round(speed * 10) / 10));
      gauge.dataset.boost = stateHud.boostActive ? 'true' : 'false';
      gauge.querySelector('[data-touch-speed]').textContent = speed.toFixed(1);
      gauge.querySelector('[data-touch-speed-arc]').setAttribute('stroke-dasharray', `${stateHud.speedFraction * 100} 100`);
      gauge.querySelector('[data-touch-boost-arc]').setAttribute('stroke-dasharray', `${stateHud.boostFraction * 100} 100`);
      gauge.querySelector('[data-touch-speed-state]').textContent = stateHud.boostActive ? `BOOST ${stateHud.boostSeconds.toFixed(1)} s` : 'VELOCIDAD';
      $('[data-touch-objective]').textContent = voyage.phase === 'shore'
        ? voyage.recovery ? 'BALSA RECUPERABLE' : 'VUELVE A TU BALSA'
        : lesson?.active ? lessonPresentation(lesson, this.locale()).stage : 'EXPLORA LA COSTA';
      $('[data-touch-load]').textContent = voyage.phase === 'shore' && voyage.recovery
        ? `Posición guardada · ${label} ${metres.toFixed(0)} m`
        : `${carryingText}${!this.isTouch && capacity ? ` · bodega ${capacity.holdVolume}/${capacity.holdCap} uV` : ''} · ${label} ${metres.toFixed(0)} m`;
      $('[data-touch-heading]').textContent = `${stateHud.headingText}°`;
      $('[data-touch-distance]').textContent = label;
      $('[data-touch-north]').style.transform = `rotate(${-yaw * 180 / Math.PI}deg)`;
      $('[data-touch-course]').style.transform = `rotate(${(bearing - yaw) * 180 / Math.PI - 90}deg)`;
      const callout = $('.ln-touch-callout'); callout.hidden = !stateHud.calloutText;
      callout.dataset.tone = stateHud.calloutTone;
      $('[data-touch-callout]').textContent = stateHud.calloutText;
      $('[data-touch-detail]').textContent = stateHud.calloutDetail;
    }
  }

  buildTouchGauge() {
    const gauge = this.root.ownerDocument.createElement('div');
    gauge.className = 'naval-touch-gauge'; gauge.setAttribute('role', 'meter');
    gauge.setAttribute('aria-label', 'Velocidad de la balsa en unidades por segundo');
    gauge.setAttribute('aria-valuemin', '0'); gauge.setAttribute('aria-valuemax', '13'); gauge.setAttribute('aria-valuenow', '0');
    gauge.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><defs>
      <linearGradient id="nt-speed-fire" x1="0" y1="0" x2="1" y2=".6"><stop stop-color="#ffe79b"/><stop offset=".45" stop-color="#ffab3d"/><stop offset="1" stop-color="#ec4c30"/></linearGradient>
      <radialGradient id="nt-dial-glass"><stop stop-color="#29464c"/><stop offset="1" stop-color="#0b1c23"/></radialGradient></defs>
      <path class="nt-dial-flame" d="M84 26c6-5 4-12 11-18-2 8 1 8 4 12 6-2 5-8 10-12-1 7-5 13-3 16 5-1 7-4 10-4-3 5-8 6-7 12 1 5-2 9-8 12z" fill="#ed5a32" stroke="#452624" stroke-width="1"/>
      <path class="nt-dial-flame" d="M14 61c-5-14 1-23 5-29-1 8 1 10 4 11 0-10 5-13 6-22 6 10-4 17 0 22 5-8 10-6 12-15 2 11-4 14-4 22z" fill="url(#nt-speed-fire)" stroke="#6e382b" stroke-width=".8"/>
      <circle cx="60" cy="60" r="42" fill="url(#nt-dial-glass)" stroke="#111e22" stroke-width="5"/>
      <circle cx="60" cy="60" r="40" fill="none" stroke="#b5ad88" stroke-width=".9"/>
      <path d="M28.2 91.8A45 45 0 1 1 91.8 91.8" fill="none" stroke="#112128" stroke-width="11"/>
      <path d="M28.2 91.8A45 45 0 1 1 91.8 91.8" fill="none" stroke="url(#nt-speed-fire)" stroke-width="7" opacity=".6"/>
      <path data-touch-speed-arc d="M28.2 91.8A45 45 0 1 1 91.8 91.8" fill="none" stroke="url(#nt-speed-fire)" stroke-width="7" pathLength="100" stroke-dasharray="0 100"/>
      <path d="M20.6 68l-7.8 1.5M26.7 37.8l-6.7-4.4M45.3 22l-3.1-7.4M74.7 22l3.1-7.4M93.3 37.8l6.7-4.4M99.4 68l7.8 1.5M91.8 91.8l5.6 5.6" stroke="#10191c" stroke-width="1.8"/>
      <path data-touch-boost-arc d="M35.3 84.7A35 35 0 1 1 84.7 84.7" fill="none" stroke="#ffe6a5" stroke-width="1.5" pathLength="100" stroke-dasharray="0 100"/></svg>
      <div class="nt-dial-number"><strong data-touch-speed>0.0</strong><span>u/s</span></div><b class="nt-dial-state" data-touch-speed-state>VELOCIDAD</b>`;
    this.touch.instrument.appendChild(gauge);
  }

  event(ev) {
    if (!ev) return false;
    const type = ev.type || ev.kind;
    if (type === 'navalPilot' && ev.ok === false && ev.why === 'capacity') {
      this.notice('Porte excedido. Reduce carga o amplía/refuerza el casco antes de zarpar.');
      return true;
    }
    const body = this.body(), state = body?.state, rig = body?.operational?.rig;
    if (type === 'navalImpact' || type === 'impact') {
      if (!(ev.damage > 0)) return false;
      if (ev.source === 'corsair' && ev.shotId) this.routeImpactEvents.add(String(ev.shotId));
      const visual = this.effects.event(ev.destroyed ? 'destroy' : 'impact', state, rig, ev);
      const sound = this.sound.event('impact');
      this.notice(ev.partType ? `${ev.destroyed ? 'Pieza destruida' : 'Daño en pieza'} · ${ev.partType}` : 'Daño de casco');
      return !!(visual || sound);
    }
    if (type === 'navalGust' || type === 'sailingActivity') {
      const kind = ev.event || ev.result || ev.kind;
      if (!kind) return false;
      const visual = this.effects.event(kind, state, rig);
      const sound = this.sound.event(kind);
      if (ev.message) this.notice(ev.message);
      return !!(visual || sound);
    }
    return false;
  }

  notice(text) {
    const element = this.$('.ln-notice');
    element.textContent = String(text || ''); element.hidden = !text;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clearInput(false); document.body.classList.remove('is-naval', 'is-naval-touch'); this.touch?.dispose(); this.effects.dispose(); this.routeRenderer.dispose(); this.sound.dispose(); this.speedFeel.dispose();
    for (const { key, previous, handler } of this.panelShortcuts) if (this.input.hotkeys?.get(key) === handler) {
      if (previous) this.input.hotkeys.set(key, previous); else this.input.hotkeys.delete(key);
    }
    globalThis.removeEventListener?.('blur', this.onBlur); document.removeEventListener('visibilitychange', this.onVisibility);
    this.touchHull?.remove(); this.root.remove(); this.axes = { ...axesNeutral };
  }
}

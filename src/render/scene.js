// Builds the whole 3D world and owns per-frame render updates. Reads client state only.
import * as THREE from 'three';
import { Pipeline, LAYER, FXU } from './pipeline.js';
import { Lighting } from './lighting.js';
import { createSky } from './sky.js';
import { createTerrain, createHeightTexture, createSeabed } from './terrain.js';
import { createWater, WATER_LIGHT } from './water.js';
import { createVegetation } from './vegetation.js';
import { createProps } from './props.js';
import { CameraRig } from './camera.js';
import { CharacterView, SENTINEL, ARCHER } from './characters.js';
import { DummyView, CannonView } from './practice.js';
import { Effects } from './vfx/effects.js';
import { ProjectileView } from './vfx/projectiles.js';
import { Decals } from './vfx/decals.js';
import { CombatFx } from './vfx/combatfx.js';
import { Debris } from './vfx/debris.js';
import { Afterimages } from './vfx/afterimage.js';
import { Ambient } from './ambient.js';
import { LocalLights } from './lights.js';
import { U } from './toon.js';
import { tuning } from '../data/tuning.js';

export class GameScene {
  constructor(canvas, map) {
    this.map = map;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 1400);
    this.rig = new CameraRig(this.camera);
    this.pipeline = new Pipeline(r, this.scene, this.camera);
    this.lighting = new Lighting(this.scene);

    this.sky = createSky();
    this.sky.layers.set(LAYER.NO_OUTLINE);
    this.scene.add(this.sky);
    this.terrain = createTerrain(map);
    this.scene.add(this.terrain);
    this.scene.add(createSeabed(map));
    this.water = createWater(map, createHeightTexture(map));
    this.water.layers.set(LAYER.WATER);
    this.scene.add(this.water);
    this.pipeline.water = { setMode: (ssr) => this.water.userData.setMode(ssr) };
    const veg = createVegetation(map);
    this.vegetation = veg.group;
    this.swayU = veg.swayU;
    this.scene.add(this.vegetation);
    const props = createProps(map);
    this.props = props;
    this.scene.add(props.group);
    this.effects = new Effects(this.scene, map);
    this.projectiles = new ProjectileView(this.scene, map);
    this.decals = new Decals(this.scene, map);
    this.combatFx = new CombatFx(this.scene);
    this.debris = new Debris(this.scene, map);
    this.debris.onChange = () => this.pipeline.markDirty();
    const ring = map.practice.ring;
    this.practiceRing = this.decals.ring(ring.x, ring.z, ring.r);
    this.after = new Afterimages(this.scene);
    this.ambient = new Ambient(this.scene, map);
    this.views = new Map();
    this.time = 0;
    this.focus = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.lighting.lavaU = this.terrain.material.userData.lavaU || null;
    this.lights = new LocalLights(map);
    this.windowBase = new THREE.Color(0x3b2418);
    this.windowLit = new THREE.Color(0xffb04a);
    this.glassDay = new THREE.Color(0xa88a58);
    this.glassLit = new THREE.Color(0xffd36a);
  }

  applyQuality(cfg) {
    this.qcfg = cfg;
    this.pipeline.setQuality({ pixelRatio: cfg.pixelRatio, ss: cfg.ss, outlines: cfg.outlines, fxaa: cfg.fxaa });
    this.lighting.setShadowSize(cfg.shadow);
    this.effects.setQuality(cfg.particles, cfg.outlines);
    this.lights.max = cfg.lights;
    this.water.material.uniforms.uWaves.value = cfg.waves;
    U.mnTerrainCaustics.value = cfg.outlines ? 0 : 1;
    this.onResize();
  }

  onResize() {
    const w = innerWidth, h = innerHeight;
    this.pipeline.resize(w, h);
    this.effects.setViewport(this.pipeline.fxHeight, this.camera.fov);
  }

  // rec.enemy picks the enemy view (skeleton archer, dormant sentinel, practice dummy / cannon).
  addCharacter(id, skin, opts = {}) {
    const kind = opts.enemy;
    let view;
    if (kind === 'dummy') view = new DummyView();
    else if (kind === 'cannon') view = new CannonView();
    else if (kind === 'archer') view = new CharacterView(ARCHER, { sword: true });
    else if (kind === 'sentinel') view = new CharacterView(SENTINEL, { sword: true, pose: 'dormant' });
    else view = new CharacterView(skin, opts);
    view.enemy = kind || null;
    this.scene.add(view.root);
    this.views.set(id, view);
    this.pipeline.markDirty();
    return view;
  }

  removeCharacter(id) {
    const view = this.views.get(id);
    if (!view) return;
    this.scene.remove(view.root);
    this.views.delete(id);
    this.pipeline.markDirty();
  }

  // Make every hidden FX material compile before play (no first-dash hitch).
  async prewarm() {
    const temp = [];
    const anyView = this.views.values().next().value;
    if (anyView) { this.after.capture(anyView, 0x3bf0ff, 0.01); temp.push(this.after.ghosts[0].mesh); }
    for (const r of this.effects.rings.slice(0, 1)) { r.m.visible = true; temp.push(r.m); }
    const cam = this.camera, r = this.renderer;
    // Compile each pass the way it draws: into a render target (linear) on medium/high, the screen
    // (sRGB) on low; the world with the scene lights, the FX layer without them (the FX pass's
    // camera layers exclude the lights, which changes the program).
    const fx = this.scene.children.filter((o) => o.layers.mask === 1 << LAYER.FX);
    const fxScene = new THREE.Scene();
    for (const o of fx) fxScene.add(o);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.qcfg && this.qcfg.outlines ? this.pipeline.rtPost : null);
    const compile = (scene, target) => (r.compileAsync ? r.compileAsync(scene, cam, target) : Promise.resolve(r.compile(scene, cam, target)));
    try {
      // Programs are created synchronously inside each call; only the wait is async.
      cam.layers.set(LAYER.WORLD); cam.layers.enable(LAYER.NO_OUTLINE); cam.layers.enable(LAYER.WATER);
      const world = compile(this.scene);
      cam.layers.set(LAYER.FX);
      const fxDone = compile(fxScene, this.scene);
      for (const o of fx) this.scene.add(o);
      r.setRenderTarget(prev);
      await Promise.all([world, fxDone]);
    } finally {
      for (const o of fx) if (o.parent !== this.scene) this.scene.add(o);
      r.setRenderTarget(prev);
      cam.layers.set(LAYER.WORLD); cam.layers.enable(LAYER.NO_OUTLINE);
      for (const m of temp) m.visible = false;
    }
  }

  // Debug close-up cameras: stop dissolving whatever is near the lens.
  nearFade(on) { U.mnNearFade.value = on ? 13 : 0; }

  setTitleShadows(on) {
    const cam = this.lighting.sun.shadow.camera;
    const h = on ? 120 : 30;
    this.lighting.shadowHalf = h;
    cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
    cam.far = on ? 400 : 220;
    cam.updateProjectionMatrix();
  }

  update(dt, ctx) {
    this.time += dt;
    U.mnTime.value = this.time;
    this.focus.copy(ctx.focus);
    U.mnPlayer.value.set(ctx.focus.x, ctx.focus.y + 0.9, ctx.focus.z);
    U.mnOccOn.value = ctx.playing ? 1 : 0;
    this.lighting.update(dt, ctx.shadowFocus || ctx.focus);
    this.applyPreset(this.lighting.cur);
    this.lights.update(dt, ctx.focus, ctx.playing ? ctx.focus : null);
    this.sky.position.copy(this.camera.position);
    // Combat-timed pieces follow instance time (they freeze in the hitstop with the characters).
    const sim = ctx.simDt ?? dt;
    this.effects.update(dt, ctx.focus);
    this.after.update(sim);
    this.ambient.update(dt, ctx.focus, this.camera.position);
    // Sentinels: slow crystal pulse while asleep, bright while awake; their eye lights follow them.
    const eyes = this.lights.sources.filter((q) => q.follow);
    let ei = 0;
    for (const v of this.views.values()) {
      if (v.enemy !== 'sentinel') continue;
      const awake = v.dorm < 0.5;
      const base = awake ? 0.75 + 0.25 * Math.sin(this.time * 3) : 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 1.1));
      v.glow.value = Math.max(base, v.attack ? 1.3 : 0);
      const L = eyes[ei++];
      if (L) {
        const f = v.root.rotation.y, p = v.root.position;
        L.x = p.x + Math.sin(f) * 0.45; L.y = p.y + 2.0 - 0.35 * v.dorm; L.z = p.z + Math.cos(f) * 0.45;
        L.i = awake ? 2.2 : 1.4;
      }
    }
    if (ctx.combat) {
      this.projectiles.update(dt, ctx.combat.hazards, ctx.combat.shots, ctx.combat.tick, ctx.combat.onShot);
      this.decals.update(dt, ctx.combat.tick);
    }
    this.combatFx.update(sim);
    this.debris.update(sim);
    // Floating cargo and the rowboat bob and drift a little.
    for (const f of this.props.floaters || []) {
      const ph = f.userData.phase, tt = this.time;
      f.position.y = (f.userData.boat ? 0.02 : -0.05) + Math.sin(tt * 1.3 + ph) * 0.06;
      f.rotation.x = Math.sin(tt * 1.1 + ph) * 0.05;
      f.rotation.z = Math.sin(tt * 0.9 + ph * 1.7) * 0.07;
      f.rotation.y = f.userData.baseRot + Math.sin(tt * 0.25 + ph) * (f.userData.boat ? 0.06 : 0.3);
    }
    // Ship bobbing + flag flutter.
    const ship = this.props.ship;
    if (ship) {
      ship.position.y = -0.35 + Math.sin(this.time * 0.8) * 0.12;
      ship.rotation.z = Math.sin(this.time * 0.6) * 0.025;
      ship.rotation.x = Math.sin(this.time * 0.45 + 1) * 0.015;
      const flag = ship.userData.flag;
      if (flag) flag.rotation.x = Math.sin(this.time * 3.1) * 0.12;
    }
  }

  // The preset's non-light parts: local-light knobs, water light, hut windows, grading.
  applyPreset(p) {
    const k = this.lights.knobs;
    k.fire = p.fire; k.lava = p.lavaLight; k.night = p.windows; k.eyes = 0.4 + 0.6 * p.fire; k.player = p.player;
    WATER_LIGHT.uWaterLight.value.copy(p.water);
    WATER_LIGHT.uSparkle.value = p.sparkle;
    WATER_LIGHT.uFoamLight.value = p.foam;
    WATER_LIGHT.uGlints.value = p.glints;
    const wm = this.props.windowMat;
    if (wm) {
      wm.userData.mesh.visible = p.windows > 0.02;
      wm.color.copy(this.windowBase).lerp(this.windowLit, Math.min(1, p.windows * 1.2));
      wm.userData.glow.value = Math.min(1, p.windows);
    }
    // Lantern glass: dull amber by day, lit at dusk and night.
    const gm = this.props.glassMat;
    if (gm) {
      const lit = Math.min(1, p.fire * 1.5);
      gm.color.copy(this.glassDay).lerp(this.glassLit, lit);
      gm.userData.glow.value = p.fire;
    }
    FXU.uFxLight.value.copy(p.fxLight);
    this.effects.setNight((p.fire - 0.3) / 0.7);
    const g = this.pipeline.grading;
    g.contrast = p.contrast; g.sat = p.sat; g.vignette = p.vignette; g.split = p.split;
    g.splitShadow.copy(p.splitShadow); g.splitHigh.copy(p.splitHigh);
    g.bloom = this.qcfg && this.qcfg.bloom ? p.bloom * this.qcfg.bloom : 0;
  }

  render() {
    this.renderer.info.reset();
    this.pipeline.render(this.time);
  }
}

export { tuning };

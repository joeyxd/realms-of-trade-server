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
import { CharacterView, SENTINEL, characterMaterial } from './characters.js';
import { Effects } from './vfx/effects.js';
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
    // Dormant bone sentinels at the Caldera gate (render-only until enemies arrive in M2).
    this.sentinels = map.props.filter((p) => p.kind === 'sentinel').map((p) => {
      const v = new CharacterView(SENTINEL, { pose: 'dormant' });
      v.state = { x: p.x, y: p.y, z: p.z, f: p.rot, vx: 0, vz: 0, st: 0, wade: 0 };
      v.update(0, v.state);
      this.scene.add(v.root);
      return v;
    });
    this.sentinelGlow = characterMaterial('sentinel').userData.glow;
    this.effects = new Effects(this.scene, map);
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

  addCharacter(id, skin, opts) {
    const view = new CharacterView(skin, opts);
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
    this.effects.update(dt, ctx.focus);
    this.after.update(dt);
    this.ambient.update(dt, ctx.focus, this.camera.position);
    for (const v of this.sentinels) {
      v.root.visible = Math.hypot(v.state.x - ctx.focus.x, v.state.z - ctx.focus.z) < 90;
      if (v.root.visible) v.update(dt, v.state);
    }
    this.sentinelGlow.value = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 1.1));
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

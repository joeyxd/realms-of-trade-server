// Builds the whole 3D world and owns per-frame render updates. Reads client state only.
import * as THREE from 'three';
import { Pipeline, LAYER } from './pipeline.js';
import { Lighting } from './lighting.js';
import { createSky } from './sky.js';
import { createTerrain, createHeightTexture } from './terrain.js';
import { createWater } from './water.js';
import { createVegetation } from './vegetation.js';
import { createProps } from './props.js';
import { CameraRig } from './camera.js';
import { CharacterView } from './characters.js';
import { Effects } from './vfx/effects.js';
import { Afterimages } from './vfx/afterimage.js';
import { Ambient } from './ambient.js';
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
    this.water = createWater(map, createHeightTexture(map));
    this.water.layers.set(LAYER.NO_OUTLINE);
    this.scene.add(this.water);
    const veg = createVegetation(map);
    this.vegetation = veg.group;
    this.swayU = veg.swayU;
    this.scene.add(this.vegetation);
    const props = createProps(map);
    this.props = props;
    this.scene.add(props.group);
    this.effects = new Effects(this.scene, map);
    this.after = new Afterimages(this.scene);
    this.ambient = new Ambient(this.scene, map);
    this.views = new Map();
    this.time = 0;
    this.focus = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.lighting.lavaU = this.terrain.material.userData.lavaU || null;
  }

  applyQuality(cfg) {
    this.qcfg = cfg;
    this.pipeline.setQuality({ pixelRatio: cfg.pixelRatio, ss: cfg.ss, outlines: cfg.outlines, fxaa: cfg.fxaa });
    this.lighting.setShadowSize(cfg.shadow);
    this.effects.setQuality(cfg.particles);
    this.water.material.uniforms.uWaves.value = cfg.waves;
    this.onResize();
  }

  onResize() {
    const w = innerWidth, h = innerHeight;
    this.pipeline.resize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.effects.setViewport(h * pr, this.camera.fov);
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
    const cam = this.camera;
    cam.layers.enableAll();
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, cam);
      else this.renderer.compile(this.scene, cam);
    } finally {
      cam.layers.set(LAYER.WORLD); cam.layers.enable(LAYER.NO_OUTLINE);
      for (const m of temp) m.visible = false;
    }
  }

  setTitleShadows(on) {
    const cam = this.lighting.sun.shadow.camera;
    const h = on ? 120 : 26;
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
    this.sky.position.copy(this.camera.position);
    this.effects.update(dt, ctx.focus);
    this.after.update(dt);
    this.ambient.update(dt, ctx.focus, this.camera.position);
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

  render() {
    this.renderer.info.reset();
    this.pipeline.render(this.time);
  }
}

export { tuning };

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
import { CharacterView, SENTINEL, ENEMY_LOOK, characterMaterial } from './characters.js';
import { createCalaRing } from './vfx/calaring.js';
import { DummyView, CannonView } from './practice.js';
import { CrabView } from './crab.js';
import { Effects } from './vfx/effects.js';
import { ProjectileView } from './vfx/projectiles.js';
import { Decals } from './vfx/decals.js';
import { BeamFx, LavaRing } from './vfx/hazardfx.js';
import { CombatFx } from './vfx/combatfx.js';
import { Debris } from './vfx/debris.js';
import { Afterimages } from './vfx/afterimage.js';
import { WeaponFx } from './vfx/weaponfx.js';
import { Indicators } from './vfx/indicators.js';
import { SkillFx } from './vfx/skillfx.js';
import { LootLayer } from './loot.js';
import { Ambient } from './ambient.js';
import { LocalLights } from './lights.js';
import { U } from './toon.js';
import { tuning } from '../data/tuning.js';
import { stage } from '../ui/stage.js';

// Boss shield: an additive fresnel ellipsoid with drifting hex cells (no depth write, no outline).
function makeShieldBubble() {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
    uniforms: { ...FXU, uTime: { value: 0 }, uColor: { value: new THREE.Color(0xb48cff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.2);
        vec2 q = vec2(atan(vP.x, vP.z) * 3.0, vP.y * 5.0 + uTime * 0.6);
        vec2 g = abs(fract(q + vec2(0.5 * floor(q.y), 0.0)) - 0.5);
        float hex = smoothstep(0.42, 0.48, max(g.x, g.y));
        float a = clamp(f * 0.9 + hex * 0.18 * (0.4 + f), 0.0, 1.0) * (0.75 + 0.25 * sin(uTime * 5.0));
        gl_FragColor = vec4(uColor * a * 1.4, a);
        #include <colorspace_fragment>
      }`,
  });
  const g = new THREE.SphereGeometry(1, 28, 18);
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(1.9, 2.5, 1.9);
  mesh.layers.set(LAYER.FX);
  mesh.frustumCulled = false;
  mesh.renderOrder = 24;
  return mesh;
}

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
    this.camera = new THREE.PerspectiveCamera(35, stage.w / stage.h, 0.5, 1400);
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
    this.decals = new Decals(this.scene, map, 32);
    this.beamFx = new BeamFx(this.scene, map);
    this.lavaRing = new LavaRing(this.scene, map);
    this.combatFx = new CombatFx(this.scene);
    this.debris = new Debris(this.scene, map);
    this.debris.onChange = () => this.pipeline.markDirty();
    const ring = map.practice.ring;
    this.practiceRing = this.decals.ring(ring.x, ring.z, ring.r);
    // La Prueba de Fuego: rune circle at the arena centre (stepping in starts it) and the boss shield.
    const A = map.landmarks.arena;
    this.runes = this.decals.ring(A.x, A.z, 3.2, 0xff8a3a);
    this.runes.mat.uniforms.uKind.value = 2;
    // La Cala Calavera (M4.5): its glowing border.
    this.calaRing = createCalaRing(map);
    if (this.calaRing) this.scene.add(this.calaRing.mesh);
    this.shieldBubble = makeShieldBubble();
    this.shieldBubble.visible = false;
    this.scene.add(this.shieldBubble);
    this.after = new Afterimages(this.scene);
    this.weaponFx = new WeaponFx(this.scene, this.effects, this.decals, this.after, map);
    this.ambient = new Ambient(this.scene, map);
    this.views = new Map();
    // M4.7: aiming marks (yours, and every pirate's Tromba on its way) and the tattoos' VFX.
    this.indicators = new Indicators(this.scene, map);
    this.skillFx = new SkillFx(this.scene, this.effects, this.combatFx, this.after, map, (e) => this.views.get(e) || null);
    this.time = 0;
    this.focus = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.lighting.lavaU = this.terrain.material.userData.lavaU || null;
    this.lights = new LocalLights(map);
    this.loot = new LootLayer(this.scene, map, this.effects, this.lights); // M4: your drops
    this.windowBase = new THREE.Color(0x3b2418);
    this.windowLit = new THREE.Color(0xffb04a);
    this.glassDay = new THREE.Color(0xa88a58);
    this.glassLit = new THREE.Color(0xffd36a);
  }

  applyQuality(cfg) {
    this.qcfg = cfg;
    this.pipeline.setQuality({ pixelRatio: cfg.pixelRatio, ss: cfg.ss, outlines: cfg.outlines, fxaa: cfg.fxaa, comic: cfg.comic ?? 0, outlineMul: cfg.outlineMul ?? 1 });
    this.lighting.setShadowSize(cfg.shadow);
    this.effects.setQuality(cfg.particles, cfg.outlines);
    this.lights.max = cfg.lights;
    this.water.material.uniforms.uWaves.value = cfg.waves;
    U.mnTerrainCaustics.value = cfg.outlines ? 0 : 1;
    U.mnInk.value = cfg.ink ?? 1; // 0 low: no comic hatching or painted detail; 1 medium / high; 2 ultra (deeper bands, halftone)
    this.onResize();
  }

  onResize() {
    const w = stage.w, h = stage.h; // the stage (rotated on an upright phone), not the window
    this.pipeline.resize(w, h);
    this.effects.setViewport(this.pipeline.fxHeight, this.camera.fov);
  }

  // Encounter visuals, per frame: runes available (0..1), the boss view's id, shield 0/1/2, invulnerable.
  setEncounterFx({ runes = 1, bossId = 0, shield = 0, inv = 0, phase = 0 } = {}) {
    this.runes.mat.uniforms.uActive.value = runes;
    const v = bossId ? this.views.get(bossId) : null;
    const L = this.lights.bossLight;
    if (!v || v.dead || !v.root.visible) { this.shieldBubble.visible = false; if (L) L.i = 0; return; }
    const p = v.root.position;
    const last = phase >= 2;
    if (L) { L.x = p.x; L.y = p.y + 2.6; L.z = p.z; L.i = inv ? 4.5 : last ? 4.2 : 3.0; L.r = last ? 13 : 10; }
    v.glow.value = (inv ? 1.6 : last ? 1.45 : 1.0) + (v.attack ? 0.5 : 0) + (last ? 0.3 : 0.15) * Math.sin(this.time * (last ? 7 : 4));
    // Last phase: he burns. Flames lick off his shoulders and back, embers rise around him.
    if (last && this.effects && Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, rr = 0.5 + Math.random() * 0.7;
      this.effects.add.spawn(p.x + Math.cos(a) * rr, p.y + 2.2 + Math.random() * 1.6, p.z + Math.sin(a) * rr, (Math.random() - 0.5) * 0.4, 1.8 + Math.random() * 1.5, (Math.random() - 0.5) * 0.4,
        { life: 0.5 + Math.random() * 0.3, size: 0.9, size1: 0.15, color: Math.random() < 0.5 ? [1, 0.36, 0.05] : [1, 0.65, 0.15], alpha: 0.85, gravity: -0.8, drag: 1.2, shape: 1 });
    }
    const b = this.shieldBubble;
    b.visible = shield === 1 || !!inv; // boolean: three.js only skips visible === false
    b.position.set(p.x, p.y + 1.9, p.z);
    b.material.uniforms.uTime.value = this.time;
    b.material.uniforms.uColor.value.set(inv ? 0xffb26b : 0xb48cff);
  }

  // rec.enemy picks the enemy view (skeleton archer, dormant sentinel, practice dummy / cannon).
  addCharacter(id, skin, opts = {}) {
    const kind = opts.enemy;
    let view;
    if (kind === 'dummy') view = new DummyView();
    else if (kind === 'cannon') view = new CannonView();
    else if (kind === 'crab') view = new CrabView();
    else if (kind === 'sentinel') view = new CharacterView(SENTINEL, { sword: true, pose: 'dormant' });
    else if (ENEMY_LOOK[kind] >= 0) {
      view = new CharacterView(ENEMY_LOOK[kind], { sword: true });
      if (kind === 'pistolera') view.setWeapon('pistolas'); // a Desalmada carries a brace of flintlocks
    }
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
    let lootProbe = null;
    const anyView = this.views.values().next().value;
    if (anyView) { this.after.capture(anyView, 0x3bf0ff, 0.01); temp.push(this.after.ghosts[0].mesh); }
    for (const r of this.effects.rings.slice(0, 1)) { r.m.visible = true; temp.push(r.m); }
    // Combat FX start hidden; the non-skinned toon variant (practice props, death debris) has no
    // instance yet either. Compile them now so the first slash or kill does not hitch.
    const cf = this.combatFx;
    for (const m of [cf.slashes[0].m, cf.rings[0].m, cf.guard, this.shieldBubble, this.beamFx.pool[0], this.lavaRing.mesh, this.weaponFx.crescents[0].m, this.indicators.marker.mesh, this.indicators.range.mesh, this.indicators.arrow.mesh, this.indicators.chargeRing.mesh, this.indicators.arc.mesh, this.skillFx.spouts[0].m, this.skillFx.vortices[0].m, this.skillFx.shadows[0].m, this.skillFx.wheels[0].m]) { m.visible = true; temp.push(m); }
    // A legendary drop (its model, beam and disc) so the first loot does not hitch either.
    const lv = this.loot.add({ id: -1, kind: 'item', x: this.focus.x, z: this.focus.z, item: { u: 0, b: 'sable', r: 4, l: 1, a: [] } });
    lootProbe = lv;
    const probe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), characterMaterial('base'));
    probe.castShadow = true;
    this.scene.add(probe);
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
      if (lootProbe) this.loot.dispose(-1);
      this.scene.remove(probe);
      probe.geometry.dispose();
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
    this.pipeline.update(dt);
    this.focus.copy(ctx.focus);
    U.mnPlayer.value.set(ctx.focus.x, ctx.focus.y + 0.9, ctx.focus.z);
    U.mnOccOn.value = ctx.playing ? 1 : 0;
    if (ctx.occ2) U.mnOcc2.value.set(ctx.occ2.x, ctx.occ2.y + 0.6, ctx.occ2.z, 1); else U.mnOcc2.value.w = 0;
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
      this.beamFx.update(dt, ctx.combat.hazards, ctx.combat.tick);
      this.lavaRing.update(dt, ctx.combat.hazards, ctx.combat.tick);
      this.weaponFx.update(sim, ctx.combat.tick, ctx.combat.caught);
      this.indicators.update(dt, ctx.combat.tick);
      this.skillFx.update(sim, ctx.combat.tick);
    }
    this.combatFx.update(sim);
    if (this.calaRing) this.calaRing.update(dt, !!ctx.lawless);
    this.debris.update(sim);
    this.loot.update(dt);
    // Floating cargo and the rowboat bob and drift a little.
    for (const f of this.props.floaters || []) {
      const ph = f.userData.phase, tt = this.time;
      f.position.y = (f.userData.boat ? 0.02 : -0.05) + Math.sin(tt * 1.3 + ph) * 0.06;
      f.rotation.x = Math.sin(tt * 1.1 + ph) * 0.05;
      f.rotation.z = Math.sin(tt * 0.9 + ph * 1.7) * 0.07;
      f.rotation.y = f.userData.baseRot + Math.sin(tt * 0.25 + ph) * (f.userData.boat ? 0.06 : 0.3);
    }
    // The Cala's black flags ripple from the pole out.
    for (const f of this.props.flags || []) {
      const pa = f.geometry.attributes.position, b = f.userData.base;
      for (let i = 0; i < pa.count; i++) { const x = b[i * 3]; pa.array[i * 3 + 2] = Math.sin(this.time * 4.2 - x * 2.6) * 0.16 * x; }
      pa.needsUpdate = true;
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

// A private presentation stage: shared gameplay renderer, no body, transport or simulation writer.
import * as THREE from 'three';
import { CharacterView } from './characters.js';
import { SkillFx } from './vfx/skillfx.js';
import { CombatFx } from './vfx/combatfx.js';
import { ParticlePool } from './vfx/particles.js';
import { FXU } from './pipeline.js';
import { U } from './toon.js';
import { ACT } from '../sim/ecs.js';
import { SKILLS } from '../data/weapons.js';
import { stage } from '../ui/stage.js';
import { DEFAULT_SKILL_DOCUMENT, cloneSkillDocument, validateSkillDocument } from '../editor/skillDocument.js';

const STEP = 1 / 60;
const impactAt = () => SKILLS.tromba.windup + SKILLS.tromba.delay;
export const PREVIEW_PARTICLE_CAP = Object.freeze({ desktop: 256, mobile: 128 });

export class SkillPreview {
  constructor({ renderer, viewport, skin = 0 }) {
    Object.assign(this, { renderer, viewport });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x142c3c);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.layers.enableAll();
    this.yaw = 0.58; this.pitch = 0.52; this.distance = 19;
    this.scene.add(new THREE.HemisphereLight(0xd6f5ff, 0x39414b, 2.0));
    const sun = new THREE.DirectionalLight(0xffecd0, 2.1);
    sun.position.set(4, 9, 6); this.scene.add(sun);
    this.stageObjects = new THREE.Group(); this.scene.add(this.stageObjects);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x1c3c49 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.035; this.stageObjects.add(floor);
    const grid = new THREE.GridHelper(30, 30, 0x527481, 0x2a4b59);
    grid.position.y = -0.02; this.stageObjects.add(grid);
    const points = Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos(i / 96 * Math.PI * 2) * SKILLS.tromba.r, 0.03, Math.sin(i / 96 * Math.PI * 2) * SKILLS.tromba.r));
    this.range = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0xffd278, dashSize: 0.22, gapSize: 0.13 }));
    this.range.computeLineDistances(); this.stageObjects.add(this.range);
    this.effectObjects = new THREE.Group(); this.scene.add(this.effectObjects);
    this.pool = new ParticlePool(PREVIEW_PARTICLE_CAP.desktop, { name: 'skill-preview-water', random: () => this.random() });
    // Keep the private preview bounded without consuming the world's visual RNG.
    const spawn = this.pool.spawn.bind(this.pool);
    this.pool.spawn = (...args) => {
      if (this.pool.alive.reduce((a, b) => a + b, 0) >= this.cap) return;
      spawn(...args);
    };
    this.effectObjects.add(this.pool.points);
    this.combat = new CombatFx(this.effectObjects);
    this.fx = new SkillFx(this.effectObjects, { alpha: this.pool }, this.combat, { capture() {} }, { groundAt: () => 0 }, () => this.character, { random: () => this.random() });
    this.document = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
    this.original = false; this.speed = 1; this.loop = true; this.playing = true;
    this.setQuality(globalThis.matchMedia?.('(pointer: coarse)')?.matches ? 'mobile' : 'desktop');
    this.setSkin(skin);
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    viewport.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      viewport.setPointerCapture(e.pointerId); e.preventDefault();
    }, options);
    viewport.addEventListener('pointermove', e => {
      if (this.drag?.id !== e.pointerId) return;
      const d = stage.vec(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.yaw -= d.x * 0.008; this.pitch = THREE.MathUtils.clamp(this.pitch + d.y * 0.006, 0.15, 1.25);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    }, options);
    const end = () => { this.drag = null; };
    viewport.addEventListener('pointerup', end, options);
    viewport.addEventListener('pointercancel', end, options);
    viewport.addEventListener('lostpointercapture', end, options);
    viewport.addEventListener('wheel', e => {
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.012, 10, 28); e.preventDefault();
    }, { ...options, passive: false });
  }

  get duration() { return impactAt() + 0.65 * (this.original ? 1 : this.document.parameters.duration) + 1.6; }
  get metrics() { return { particles: this.pool.alive.reduce((a, b) => a + b, 0), cap: this.cap, drawCalls: this.drawCalls || 0 }; }
  random() {
    let n = this.seed += 0x6D2B79F5;
    n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  }
  setDocument(document) {
    if (!validateSkillDocument(document).ok) throw new Error('Invalid skill presentation');
    this.document = cloneSkillDocument(document); this.restart();
  }
  setOriginal(value) { this.original = value === true; this.seek(this.time); }
  setSpeed(value) { if ([0.25, 0.5, 1, 2].includes(value)) this.speed = value; }
  setLoop(value) { this.loop = value === true; }
  setQuality(value) { this.quality = value === 'mobile' ? 'mobile' : 'desktop'; this.cap = PREVIEW_PARTICLE_CAP[this.quality]; this.restart(); }
  setSkin(value) {
    this.releaseCharacter();
    this.character = new CharacterView(Number.isInteger(value) && value >= 0 && value < 5 ? value : 0, { seed: 0 });
    this.scene.add(this.character.root); this.restart();
  }
  releaseCharacter() {
    const view = this.character;
    if (!view) return;
    view.root.removeFromParent(); view.mesh.skeleton.dispose();
    // Imported geometry, textures, shadow and lantern materials are registry-owned.
    for (const m of new Set([view.material, ...(Array.isArray(view.mesh.material) ? view.mesh.material : [view.mesh.material])])) m.dispose();
    this.character = null;
  }
  play() { if (this.time >= this.duration) this.restart(); this.playing = true; }
  pause() { this.playing = false; }
  restart() {
    this.time = 0; this.accumulator = 0; this.seed = 6371; this.fired = false;
    this.fx.resetTromba();
    this.pool.alive.fill(0); this.pool.data.fill(0); this.pool.cursor = 0; this.pool.time = 0;
    this.pool.aData.needsUpdate = true;
    for (const ring of this.combat.rings) { ring.active = false; ring.m.visible = false; }
    this.combat.ringCursor = 0;
    if (this.character) {
      this.character.seed = 0; this.character.t = 0;
      for (let i = 0; i < 30; i++) this.character.update(STEP, this.state(0));
      this.character.t = 0;
    }
  }
  state(t) {
    return { x: -3.4, y: 0, z: 4.6, f: Math.atan2(3.4, -4.6), vx: 0, vz: 0, st: 0,
      act: t < SKILLS.tromba.windup + SKILLS.tromba.recover ? ACT.CAST : ACT.IDLE, actT: t, dead: false };
  }
  step() {
    this.time += STEP;
    this.character?.update(STEP, this.state(this.time));
    if (!this.fired && this.time + 1e-8 >= impactAt()) {
      this.fired = true;
      this.fx.spout(0, 0, SKILLS.tromba.r, false, 0, this.original ? undefined : this.document.parameters);
    }
    this.fx.update(STEP, Math.round(this.time / STEP));
    this.combat.update(STEP); this.pool.update(STEP);
  }
  seek(value) {
    const target = THREE.MathUtils.clamp(Number(value) || 0, 0, this.duration), playing = this.playing;
    this.restart();
    for (let i = 0, count = Math.floor(target / STEP); i < count; i++) this.step();
    this.playing = playing;
  }
  render(dt = 0) {
    if (this.disposed) return;
    if (this.playing) {
      this.accumulator += Math.max(0, Math.min(0.1, dt)) * this.speed;
      while (this.accumulator + 1e-8 >= STEP) {
        this.accumulator -= STEP;
        if (this.time >= this.duration) { if (this.loop) this.restart(); else { this.pause(); break; } }
        this.step();
      }
    }
    const rect = this.viewport.getBoundingClientRect();
    const p = stage.toLocal(stage.rotated ? rect.right : rect.left, rect.top);
    const width = stage.rotated ? rect.height : rect.width, height = stage.rotated ? rect.width : rect.height;
    if (width < 2 || height < 2) return;
    const r = this.renderer, size = r.getSize(new THREE.Vector2());
    const old = { target: r.getRenderTarget(), viewport: r.getViewport(new THREE.Vector4()), scissor: r.getScissor(new THREE.Vector4()), test: r.getScissorTest(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), autoClear: r.autoClear, depth: FXU.uUseDepth.value, light: FXU.uFxLight.value.clone(), cloud: U.mnCloud.value, count: U.mnLightCount.value, glow: U.mnGlowOut.value, occlusion: U.mnOccOn.value };
    try {
      r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y);
      r.setClearColor(0x0a1b28, 1); r.clear();
      r.setViewport(p.x, size.y - p.y - height, width, height);
      r.setScissor(p.x, size.y - p.y - height, width, height); r.setScissorTest(true); r.autoClear = true;
      this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
      const horizontal = this.distance * Math.cos(this.pitch);
      this.camera.position.set(Math.sin(this.yaw) * horizontal, 2 + this.distance * Math.sin(this.pitch), Math.cos(this.yaw) * horizontal);
      this.camera.lookAt(0, 4, 1);
      FXU.uUseDepth.value = 0; FXU.uFxLight.value.set(0xffffff);
      U.mnCloud.value = 0; U.mnLightCount.value = 0; U.mnGlowOut.value = 0; U.mnOccOn.value = 0;
      this.pool.setViewport(height * r.getPixelRatio(), this.camera.fov);
      const before = r.info.render.calls;
      r.render(this.scene, this.camera);
      this.drawCalls = r.info.autoReset ? r.info.render.calls : r.info.render.calls - before;
    } finally {
      r.setRenderTarget(old.target); r.setViewport(old.viewport); r.setScissor(old.scissor); r.setScissorTest(old.test); r.setClearColor(old.color, old.alpha); r.autoClear = old.autoClear;
      FXU.uUseDepth.value = old.depth; FXU.uFxLight.value.copy(old.light);
      U.mnCloud.value = old.cloud; U.mnLightCount.value = old.count; U.mnGlowOut.value = old.glow; U.mnOccOn.value = old.occlusion;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.controller.abort(); this.releaseCharacter();
    this.fx.dispose();
    const geometries = new Set(), materials = new Set();
    for (const group of [this.stageObjects, this.effectObjects]) group.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m);
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.scene.clear();
  }
}

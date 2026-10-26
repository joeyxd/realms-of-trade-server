// Native world particles: source HDR + Filmic on supported outlined tiers; the original 8-bit FX fallback otherwise.
// No static three import: the render runtime loads on demand so bookkeeping stays testable in Node.
import { PRESENTATION_SLOTS, validatePresentationBindings } from '../../../data/presentationBindings.js';
import { NATIVE_MOBILE_GPU_CAP, NATIVE_SIMULATIONS, NIAGARA_NATIVE, nativeEndStep, nativeTextureBytes } from '../../../editor/niagaraNative.js';

export const LOOP_NEAR = 60, LOOP_FAR = 70; // spawn loops within 60 m of the focus, despawn past 70 m (effects.js draws fires within 60 m)
export const MAX_BURSTS = 8; // concurrent hit instances; the oldest is recycled
export const MAX_STEPS = 4; // fixed 60 Hz steps per frame at most; the rest is dropped
export const PREWARM_STEPS = 120; // a loop appears already burning (2 s)
export const RING_RADIUS = 0.18; // metres at scale 1: the extra flames of count > 1 stand on this ring
const LIMIT = 512; // particles per emitter in one mesh set (the frame specs' buffer)
// World size per recipe at scale 1: the flame's sprites span about 1.5 m in the Taller (UE cm), the BasicHit fireball 2.3 m.
// 1.2 makes the campfire flame read about 1 m tall like the procedural one (the flame texels fill about half of each quad and
// DepthFade softens the base); 1.5 makes the hit's visible puff about 1.2 m across (its texels fill about a third of the quad).
export const WORLD_BASE = Object.freeze({ 'flame-single-v1': 1.2, 'basichit-v1': 1.5 });
// The game's FX target is 8-bit linear (pipeline rtPost), not the Taller's half-float HDR + Filmic LUT. An emissive layer (any
// particle color over 1; the flame's is about 45, 8, 0.7) clips to 1 before blending, so under the source's translucent blend
// (color x opacity) it would show only as faint as its opacity. Emissive layers therefore blend premultiplied (src 1, dst
// 1 - alpha) with the particle color scaled to at most HDR_FIT (hue kept) and multiplied by the particle alpha: the texel ramp
// then runs from a deep orange rim to a saturated yellow core over the background, as the HDR look does. Other layers (smoke)
// keep their blend and colors.
export const HDR_FIT = 3;
export const NIGHT_GAIN = 0.6;

// Seed of loop instance `index`: neighbouring flames differ, and the value stays in the bindings' 0..65533 range.
export const loopSeed = (seed, index) => (seed + index) % 65534;
// Horizontal offsets of `count` flames: the first at the anchor, the others evenly on the ring.
export function ringOffsets(count, radius) {
  return Array.from({ length: count }, (_, i) => i === 0 ? [0, 0]
    : [Math.cos((i - 1) / (count - 1) * Math.PI * 2) * radius, Math.sin((i - 1) / (count - 1) * Math.PI * 2) * radius]);
}
// Fixed-step clock: `rate` steps per second (60 * speed / duration, as nativeStep), at most MAX_STEPS per call, the rest dropped.
export function fixedSteps(acc, dt, rate) {
  const total = acc + Math.max(0, dt) * rate, steps = Math.floor(total);
  return { steps: Math.min(steps, MAX_STEPS), acc: total - steps };
}
// Display-referred '#rrggbb' to linear RGB, as THREE.Color.set does under color management (the Taller's tint).
export function linearTint(hex) {
  return [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
}
// Merges instance frames into one frame of the effect's mesh set. An instance that would overflow an emitter's buffer is left
// out whole (callers pass the nearest first). Returns { frame, ranges: [[start, count] per emitter] per kept instance, dropped }.
export function mergeFrames(frames, limit = LIMIT) {
  const emitters = frames[0].emitters.map(e => ({ name: e.name, particles: [] })), ranges = [];
  let dropped = 0;
  for (const frame of frames) {
    if (frame.emitters.some((e, i) => emitters[i].particles.length + e.particles.length > limit)) { ranges.push(null); dropped++; continue; }
    ranges.push(frame.emitters.map((e, i) => { const start = emitters[i].particles.length; emitters[i].particles.push(...e.particles); return [start, e.particles.length]; }));
  }
  return { frame: { schema: frames[0].schema, systemAge: frames[0].systemAge, emitters }, ranges, dropped };
}
const free = resource => { resource.dispose?.(); resource.close?.(); };
const coarsePointer = () => globalThis.matchMedia?.('(pointer: coarse)')?.matches === true;

export class NativeWorldFx {
  // scene: the game scene (meshes go on `layer`); renderer: for KTX2 support; depth(): the opaque depth texture of the frame and
  // res its size (pipeline rtNormal.depthTexture and FXU.uRes); runtime(): the three-side module (tests inject a fake).
  // premultiplied: the three blend constants { blending: CustomBlending, src: OneFactor, dst: OneMinusSrcAlphaFactor }.
  constructor(scene, { renderer = null, layer = 1, depth = () => null, res = { x: 1, y: 1 }, coarse = coarsePointer(),
    nativeLayer = 4, hdrAvailable = () => false, hdrRes = res, onFilm = () => {}, premultiplied = null, runtime = () => import('./nativeEffect.js') } = {}) {
    Object.assign(this, { scene, renderer, layer, nativeLayer, depth, res, hdrRes, hdrAvailable, onFilm, runtime, premultiplied });
    this.hdr = true; this.night = 0;
    this.quality = coarse ? 'mobile' : 'desktop';
    this.bindings = {}; this.entries = new Map(); this.anchors = []; this.loops = new Map(); this.bursts = [];
    this.depthOn = false; this.warned = new Set(); this.drawCalls = 0; this.particles = 0; this.dropped = 0;
  }
  warn(key, message) { if (!this.warned.has(key)) { this.warned.add(key); console.warn(message); } }
  // The fire anchors of effects.js ({ x, y, z, kind } with kind 'campfire' or 'brazier', the slot names).
  setAnchors(fires) { this.anchors = fires.map(f => ({ x: f.x, y: f.y, z: f.z, slot: f.kind })); this.loops.clear(); }
  get hdrActive() { return this.hdr && this.depthOn && this.hdrAvailable(); }
  setNight(n) { this.night = Math.min(1, Math.max(0, Number(n) || 0)); }
  setQuality({ outlines } = {}) { this.depthOn = !!outlines; this.setMode(); } // DepthFade needs the opaque depth target (medium and above)
  // Any time: bind, rebind with new parameters, unbind (null or an invalid document = no bindings). A changed slot drops its
  // instances (loops respawn next frame with the new parameters); an effect no slot uses any more is released.
  setBindings(doc) {
    if (this.disposed) return;
    const checked = doc == null ? null : validatePresentationBindings(doc);
    if (checked && !checked.ok) this.warn(`bindings:${checked.why}`, `Presentation bindings ignored (${checked.why}): procedural look`);
    const next = checked?.ok ? checked.value.bindings : {};
    for (const slot of Object.keys(PRESENTATION_SLOTS))
      if (JSON.stringify(this.bindings[slot]) !== JSON.stringify(next[slot])) this.drop(inst => inst.slot === slot);
    this.bindings = next;
    const used = new Set(Object.values(next).map(b => `${b.effect}|${this.quality}`));
    for (const [key, entry] of this.entries) if (!used.has(key)) this.release(entry);
    for (const b of Object.values(next)) this.ensure(b.effect);
  }
  entryOf(slot) { const b = this.bindings[slot]; return b ? this.entries.get(`${b.effect}|${this.quality}`) : undefined; }
  loopReady(slot) { return PRESENTATION_SLOTS[slot]?.mode === 'loop' && this.entryOf(slot)?.state === 'ready'; }
  // A one-shot at a world point; false when no native instance started (the caller keeps its procedural look).
  burst(slot, x, y, z) {
    const entry = this.entryOf(slot);
    if (PRESENTATION_SLOTS[slot]?.mode !== 'burst' || entry?.state !== 'ready' || ![x, y, z].every(Number.isFinite)) return false;
    const params = this.bindings[slot].parameters, recipe = entry.effect.recipe;
    try {
      const sim = new NATIVE_SIMULATIONS[recipe](entry.source, { seed: params.seed });
      if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
      this.bursts.push({ slot, entry, sim, x, y, z, params, acc: 0, end: nativeEndStep(entry.source, params.seed, recipe) });
      return true;
    } catch (error) { this.fail(entry, error); return false; }
  }
  ensure(id) {
    const key = `${id}|${this.quality}`;
    if (this.entries.has(key)) return;
    const entry = { key, id, effect: NIAGARA_NATIVE[id], state: 'loading', alive: true, controller: new AbortController() };
    this.entries.set(key, entry);
    this.load(entry);
  }
  async load(entry) {
    try {
      const runtime = await this.runtime();
      if (!entry.alive) return;
      const assets = await runtime.loadNativeAssets(entry.effect, { quality: this.quality, renderer: this.renderer,
        signal: entry.controller.signal, alive: () => entry.alive });
      if (!assets) return;
      entry.owned = assets.owned;
      if (!entry.alive) return this.releaseGpu(entry);
      // A mobile GPU without a compressed format gets RGBA8 from the transcoder: over the cap, keep the procedural look.
      const bytes = assets.textures.reduce((sum, texture) => sum + nativeTextureBytes(texture), 0);
      if (assets.mobile && bytes > NATIVE_MOBILE_GPU_CAP) throw new Error(`textures need ${bytes} GPU bytes, over the mobile cap`);
      this.onFilm(assets.film);
      entry.source = assets.source; entry.emissive = []; entry.blends = [];
      entry.particles = runtime.createNativeParticles(entry.effect, this.scene, assets.textures);
      for (const mesh of entry.particles.layers) {
        entry.blends.push(Object.fromEntries(['blending', 'blendSrc', 'blendDst', 'blendSrcAlpha', 'blendDstAlpha'].map(k => [k, mesh.material?.[k]])));
        mesh.layers.set(this.hdrActive ? this.nativeLayer : this.layer); mesh.visible = false; mesh.geometry.instanceCount = 0;
        // DepthFade over the source's 100 cm in the effect's own world size (a uniform; the shader source is the core one).
        const fade = mesh.material?.uniforms?.depthFadeDistance;
        if (fade) fade.value *= WORLD_BASE[entry.effect.recipe];
      }
      entry.state = 'ready'; this.setMode();
    } catch (error) { if (entry.alive) this.fail(entry, error); }
  }
  setMode() {
    const hdr = this.hdrActive;
    for (const entry of this.entries.values()) entry.particles?.layers.forEach((mesh, i) => {
      mesh.layers.set(hdr ? this.nativeLayer : this.layer);
      const m = mesh.material;
      if (!m) return;
      if (hdr || !entry.emissive[i] || !this.premultiplied) Object.assign(m, entry.blends[i]);
      else { const { blending, src, dst } = this.premultiplied;
        Object.assign(m, { blending, blendSrc: src, blendDst: dst, blendSrcAlpha: null, blendDstAlpha: null }); }
    });
  }
  // Load error, hash mismatch or a frame exception: that effect's slots go back to the procedural look until the effect is unbound and bound again.
  fail(entry, error) {
    this.warn(`fail:${entry.key}`, `Native world effect ${entry.id} uses the procedural look: ${error?.message ?? error}`);
    this.drop(inst => inst.entry === entry); this.releaseGpu(entry); entry.state = 'error';
  }
  releaseGpu(entry) { entry.particles?.dispose(); entry.owned?.forEach(free); entry.particles = entry.owned = entry.source = null; }
  release(entry) {
    entry.alive = false; entry.controller.abort();
    this.drop(inst => inst.entry === entry); this.releaseGpu(entry); this.entries.delete(entry.key);
  }
  drop(match) {
    for (const [index, list] of this.loops) if (match(list[0])) this.loops.delete(index);
    this.bursts = this.bursts.filter(inst => !match(inst));
  }
  spawnLoops(index, anchor, entry) {
    const params = this.bindings[anchor.slot].parameters, recipe = entry.effect.recipe;
    return ringOffsets(params.count, RING_RADIUS * params.scale).map(([ox, oz], j) => {
      // Instance index = anchor * 5 + flame: different anchors and the flames of one anchor never share a seed.
      const sim = new NATIVE_SIMULATIONS[recipe](entry.source, { seed: loopSeed(params.seed, index * 5 + j) }, { endless: true });
      for (let i = 0; i < PREWARM_STEPS; i++) sim.advance();
      return { slot: anchor.slot, entry, sim, x: anchor.x + ox, y: anchor.y, z: anchor.z + oz, params, acc: 0 };
    });
  }
  update(dt, focus, camera) {
    if (this.disposed) return;
    this.setMode();
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const fx = focus?.x ?? 0, fz = focus?.z ?? 0;
    this.anchors.forEach((anchor, index) => {
      const entry = this.loopReady(anchor.slot) ? this.entryOf(anchor.slot) : null, d2 = (anchor.x - fx) ** 2 + (anchor.z - fz) ** 2;
      if (this.loops.has(index) && (!entry || d2 > LOOP_FAR * LOOP_FAR)) this.loops.delete(index);
      else if (!this.loops.has(index) && entry && d2 < LOOP_NEAR * LOOP_NEAR) {
        try { this.loops.set(index, this.spawnLoops(index, anchor, entry)); } catch (error) { this.fail(entry, error); }
      }
    });
    const step = inst => {
      const clock = fixedSteps(inst.acc, dt, 60 * inst.params.speed / inst.params.duration);
      inst.acc = clock.acc;
      for (let i = 0; i < clock.steps && !(inst.end && inst.sim.step >= inst.end); i++) inst.sim.advance();
    };
    const loops = [...this.loops.values()].flat();
    for (const entry of this.entries.values()) {
      if (entry.state !== 'ready') continue;
      try {
        const own = loops.filter(inst => inst.entry === entry);
        own.forEach(step); this.bursts.filter(inst => inst.entry === entry).forEach(step);
      } catch (error) { this.fail(entry, error); }
    }
    this.bursts = this.bursts.filter(inst => inst.sim.step < inst.end);
    this.drawCalls = this.particles = this.dropped = 0;
    for (const entry of this.entries.values()) {
      if (entry.state !== 'ready') continue;
      try { this.sync(entry, loops, fx, fz, camera); } catch (error) { this.fail(entry, error); }
    }
  }
  // One mesh set per effect: the merged particles of all its instances, then world placement and the presentation parameters
  // on the instance data (position, size, color, alpha), so the core sprite shaders stay as they are.
  sync(entry, loops, fx, fz, camera) {
    const near = inst => (inst.x - fx) ** 2 + (inst.z - fz) ** 2;
    const list = [...this.bursts.filter(inst => inst.entry === entry), ...loops.filter(inst => inst.entry === entry).sort((a, b) => near(a) - near(b))];
    const layers = entry.particles.layers;
    if (!list.length) { for (const mesh of layers) { mesh.visible = false; mesh.geometry.instanceCount = 0; } return; }
    const { frame, ranges, dropped } = mergeFrames(list.map(inst => inst.sim.snapshot()));
    entry.particles.update(frame);
    this.dropped += dropped;
    // A layer turns emissive (premultiplied blend) the first time one of its particles carries a color over 1.
    frame.emitters.forEach((e, index) => {
      if (entry.emissive[index] || !e.particles.some(q => Math.max(q.color[0], q.color[1], q.color[2]) > 1)) return;
      entry.emissive[index] = true;
      const material = layers[index]?.material;
      if (!this.hdrActive && material && this.premultiplied) {
        const { blending, src, dst } = this.premultiplied;
        Object.assign(material, { blending, blendSrc: src, blendDst: dst, blendSrcAlpha: null, blendDstAlpha: null });
      }
    });
    list.forEach((inst, n) => {
      if (!ranges[n]) return;
      const p = inst.params, k = WORLD_BASE[entry.effect.recipe] * p.scale, kh = k * p.height;
      const [tr, tg, tb] = linearTint(p.tint), gain = p.brightness * (PRESENTATION_SLOTS[inst.slot].mode === 'loop' ? 1 + NIGHT_GAIN * this.night : 1);
      ranges[n].forEach(([start, count], index) => {
        const a = layers[index]?.geometry.attributes;
        if (!a) return;
        const pos = a.particlePosition.array, size = a.particleSize.array, color = a.particleColor.array, emissive = !!entry.emissive[index];
        for (let i = start; i < start + count; i++) {
          pos[i * 3] = inst.x + pos[i * 3] * k; pos[i * 3 + 1] = inst.y + pos[i * 3 + 1] * kh; pos[i * 3 + 2] = inst.z + pos[i * 3 + 2] * k;
          size[i * 2] *= k; size[i * 2 + 1] *= kh;
          const alpha = color[i * 4 + 3] * p.opacity, r = color[i * 4] * gain * tr, g = color[i * 4 + 1] * gain * tg, b = color[i * 4 + 2] * gain * tb;
          const fit = emissive && !this.hdrActive ? Math.min(1, HDR_FIT / Math.max(r, g, b, 1e-6)) * Math.min(1, Math.max(0, alpha)) : 1;
          color[i * 4] = r * fit; color[i * 4 + 1] = g * fit; color[i * 4 + 2] = b * fit; color[i * 4 + 3] = alpha;
        }
      });
    });
    const depth = this.depth(), res = this.hdrActive ? this.hdrRes : this.res;
    if (camera?.isPerspectiveCamera) entry.particles.setDepth(depth, camera, res.x, res.y, this.depthOn && !!depth, { perspective: true });
    for (const mesh of layers) {
      mesh.visible = mesh.geometry.instanceCount > 0;
      if (mesh.visible) { this.drawCalls++; this.particles += mesh.geometry.instanceCount; }
    }
  }
  get metrics() {
    let resources = 0;
    for (const entry of this.entries.values()) resources += 1 + (entry.owned?.length || 0) + (entry.particles?.layers.length || 0) * 2;
    const loops = [...this.loops.values()].reduce((sum, list) => sum + list.length, 0);
    return { loops, bursts: this.bursts.length, instances: loops + this.bursts.length, particles: this.particles, drawCalls: this.drawCalls,
      hdr: this.hdrActive, night: this.night, loopGain: 1 + NIGHT_GAIN * this.night, dropped: this.dropped, resources, quality: this.quality, effects: [...this.entries.values()].map(e => ({ id: e.id, state: e.state })),
      slots: Object.keys(this.bindings) };
  }
  dispose() {
    for (const entry of [...this.entries.values()]) this.release(entry);
    this.anchors = []; this.loops.clear(); this.bursts = []; this.disposed = true;
  }
}

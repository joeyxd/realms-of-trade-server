import * as THREE from 'three';
import { BasicHitParticles, BASICHIT_DEPTH_LAYERS } from './basichit-render.js';
import { PilotParticles } from './particles.js';
import { createFilmLUT, filmFragment } from './film-color.js';
import { NATIVE_SIMULATIONS, nativeEndStep, nativeStep } from '../../../editor/niagaraNative.js';

// Per recipe: texture files, per-emitter count slots and the layer set (the simulation class lives in niagaraNative.js).
const RECIPES = Object.freeze({
  'basichit-v1': { textures: 2, counts: 3, particles: (scene, textures, effect) => new BasicHitParticles(scene, [...textures, null], effect.drawOrder, BASICHIT_DEPTH_LAYERS) },
  'flame-single-v1': { textures: 2, counts: 2, particles: (scene, textures) => new PilotParticles(scene, textures) },
});

// One KTX2Loader for the session (the mobile set): UASTC transcodes to the GPU's own format (ASTC, ETC2, BC7) in a worker; the decoder ships with three, same CDN as the import map.
let ktx2Loader;
async function loadKtx2(renderer, buffer, url) {
  try {
    if (!renderer) throw new Error('no renderer to detect GPU support');
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    ktx2Loader ||= new KTX2Loader().setTranscoderPath(import.meta.resolve('three/addons/libs/basis/'));
    ktx2Loader.detectSupport(renderer);
    // The pinned bytes themselves, through a blob URL (the loader has no public parse in three 0.160).
    const blob = URL.createObjectURL(new Blob([buffer], { type: 'image/ktx2' }));
    try { return await ktx2Loader.loadAsync(blob); } finally { URL.revokeObjectURL(blob); }
  } catch (error) { ktx2Loader = null; /* a failed transcoder fetch must not stick for the session */ throw new Error(`KTX2 mobile texture failed: ${url}: ${error?.message ?? error}`); }
}

// Keep the transfer math byte-for-byte from the lab, replacing only its inputs/output.
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Filmic composite anchor changed');
  return source.replace(anchor, replacement);
}
export const nativeCompositeFragment = replaceOnce(replaceOnce(replaceOnce(filmFragment,
  'uniform float exposure;', 'uniform float exposure; uniform vec3 tintColor; uniform float opacity;'),
  'texture(image,vUv).rgb * exposure', 'texture(image,vUv).rgb * exposure * tintColor'),
  'outColor = vec4(texture(filmLUT,coords).rgb*1.05,1.0);',
  'outColor = vec4(opacity * texture(filmLUT,coords).rgb*1.05, opacity * texture(image,vUv).a);');

export class NativeEffect {
  constructor() { this.epoch = 0; this.state = 'idle'; this.resources = new Set(); this.counts = [0, 0, 0]; }
  own(resource) { this.resources.add(resource); return resource; }
  release() {
    for (const resource of this.resources) { resource.dispose?.(); resource.close?.(); }
    this.resources.clear(); this.particles?.dispose();
    this.particles = this.simulation = this.source = this.effect = this.hdr = this.depth = this.output = null;
    this.counts = [0, 0, 0]; this.drawCalls = 0;
  }
  cancelLoad() { this.epoch++; this.controller?.abort(); this.release(); this.state = 'idle'; }
  // options.quality 'mobile' loads the KTX2 UASTC set (needs options.renderer); anything else keeps the lossless WebP set.
  async setEffect(effect, { quality, renderer } = {}) {
    this.cancelLoad();
    if (this.disposed) return;
    const epoch = this.epoch, controller = this.controller = new AbortController();
    this.state = 'loading'; this.error = '';
    // Local ownership until the final await: canceled loads cannot publish or leak a bitmap or a compressed texture.
    const bitmaps = [];
    try {
      const recipe = Object.hasOwn(RECIPES, effect.recipe) ? RECIPES[effect.recipe] : null;
      if (!recipe || Object.keys(effect.files).length !== 2 + recipe.textures) throw new Error(`Unknown native recipe: ${effect.recipe}`);
      const mobile = quality === 'mobile';
      if (mobile && !effect.mobileFiles) throw new Error(`No mobile texture set: ${effect.id}`);
      const files = mobile ? { ...effect.files, ...effect.mobileFiles } : effect.files;
      const bytes = await Promise.all(Object.values(files).map(async file => {
        const response = await fetch(file.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${file.url}`);
        const buffer = await response.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
        if (hash !== file.sha256) throw new Error(`Native file hash mismatch: ${file.url}`);
        return buffer;
      }));
      for (const [index, buffer] of bytes.slice(2).entries()) {
        bitmaps.push(mobile ? await loadKtx2(renderer, buffer, Object.values(files)[index + 2].url)
          : await createImageBitmap(new Blob([buffer], { type: 'image/webp' }), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
        if (epoch !== this.epoch) return;
      }
      if (epoch !== this.epoch) return;
      const decode = buffer => JSON.parse(new TextDecoder().decode(buffer));
      this.source = decode(bytes[0]); this.effect = effect;
      this.simulation = new NATIVE_SIMULATIONS[effect.recipe](this.source); this.counts = Array(recipe.counts).fill(0);
      const textures = bitmaps.map(bitmap => {
        this.own(bitmap);
        if (mobile) return bitmap; // KTX2Loader already set sRGB, the stored mip chain and the filters; no runtime flip (encoded lower-left)
        const texture = this.own(new THREE.Texture(bitmap));
        texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
        return texture;
      });
      this.particleScene = new THREE.Scene();
      this.particles = recipe.particles(this.particleScene, textures, effect);
      this.hdr = this.own(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true }));
      this.hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.depth = this.own(new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true }));
      this.depth.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
      this.depth.depthTexture.minFilter = this.depth.depthTexture.magFilter = THREE.NearestFilter;
      this.depthMaterial = this.own(new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, colorWrite: false }));
      this.uniforms = { image: { value: this.hdr.texture }, exposure: { value: 1 },
        filmLUT: { value: this.own(createFilmLUT(decode(bytes[1])).texture) }, tintColor: { value: new THREE.Color() }, opacity: { value: 1 } };
      const material = this.own(new THREE.ShaderMaterial({ uniforms: this.uniforms, glslVersion: THREE.GLSL3, toneMapped: false,
        vertexShader: 'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: nativeCompositeFragment,
        transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        depthTest: false, depthWrite: false }));
      this.output = new THREE.Scene(); this.output.add(new THREE.Mesh(this.own(new THREE.PlaneGeometry(2, 2)), material));
      this.outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.state = 'ready';
    } catch (error) {
      if (epoch === this.epoch) { controller.abort(); this.release(); this.state = 'error'; this.error = error.message; }
    } finally {
      for (const bitmap of bitmaps) if (!this.resources.has(bitmap)) { bitmap.close?.(); bitmap.dispose?.(); }
    }
  }
  duration(parameters) { return (this.source ? nativeEndStep(this.source, parameters.seed, this.effect.recipe) : 480) / 60 * parameters.duration / parameters.speed; }
  update(time, parameters) {
    if (this.state !== 'ready') return;
    if (this.simulation.options.seed !== parameters.seed) this.simulation.configure({ seed: parameters.seed });
    this.step = nativeStep(time, 0, parameters);
    const frame = this.simulation.seek(Math.max(0, this.step));
    this.particles.update(frame);
    // Sprite shaders take world positions directly, so transform instance data, not Object3D.scale.
    for (const mesh of this.particles.layers) {
      mesh.visible = this.step >= 0;
      const a = mesh.geometry.attributes;
      for (let i = 0; i < mesh.geometry.instanceCount; i++) {
        const p = a.particlePosition, s = a.particleSize;
        p.setXYZ(i, p.getX(i) * parameters.scale, 1 + p.getY(i) * parameters.scale * parameters.height, p.getZ(i) * parameters.scale);
        s.setXY(i, s.getX(i) * parameters.scale, s.getY(i) * parameters.scale * parameters.height);
      }
    }
    this.counts = this.step < 0 ? this.counts.map(() => 0) : this.particles.counts ? [...this.particles.counts] : frame.emitters.map(e => e.particles.length);
    this.uniforms.exposure.value = parameters.brightness; this.uniforms.opacity.value = parameters.opacity;
    this.uniforms.tintColor.value.set(parameters.tint);
  }
  render(renderer, scene, camera, width, height) {
    if (this.state !== 'ready' || this.step < 0) return;
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if (this.hdr.width !== width || this.hdr.height !== height) { this.hdr.setSize(width, height); this.depth.setSize(width, height); }
    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const old = { target: renderer.getRenderTarget(), test: renderer.getScissorTest(), auto: renderer.autoClear,
      color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), background: scene.background, override: scene.overrideMaterial };
    const hidden = [];
    this.drawCalls = 0;
    const draw = (s, c) => { const before = renderer.info.render.calls; renderer.render(s, c);
      this.drawCalls += renderer.info.autoReset ? renderer.info.render.calls : renderer.info.render.calls - before; };
    try {
      scene.traverse(object => {
        if (object.visible && object.material && (!object.isMesh || [object.material].flat().some(m => m.transparent))) {
          hidden.push(object); object.visible = false;
        }
      });
      scene.background = null; scene.overrideMaterial = this.depthMaterial;
      renderer.setScissorTest(false); renderer.autoClear = false; renderer.setClearColor(0, 0);
      renderer.setRenderTarget(this.depth); renderer.clear(); draw(scene, camera);
      this.particles.setDepth(this.depth.depthTexture, camera, width, height, true, { perspective: true });
      renderer.setRenderTarget(this.hdr); renderer.clear(); draw(scene, camera);
      draw(this.particleScene, camera);
      renderer.setRenderTarget(old.target); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(old.test);
      draw(this.output, this.outputCamera);
    } finally {
      hidden.forEach(object => { object.visible = true; }); scene.background = old.background; scene.overrideMaterial = old.override;
      renderer.setRenderTarget(old.target); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(old.test);
      renderer.setClearColor(old.color, old.alpha); renderer.autoClear = old.auto;
    }
  }
  get metrics() { return { particles: this.counts.reduce((sum, count) => sum + count, 0), cap: 512,
    counts: [...this.counts], textureState: this.state, nativeResources: this.resources.size + (this.particles?.layers.length || 0) * 2 }; }
  dispose() { this.cancelLoad(); this.disposed = true; }
}

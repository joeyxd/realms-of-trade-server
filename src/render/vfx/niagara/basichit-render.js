// NS_BasicHit render binding: one instanced sprite layer per emitter, built from layer descriptors over core/.
// Frames come from BasicHitSimulation; each is validated with BASICHIT_FRAME_SPEC before any upload (fail closed).
import * as THREE from 'three';
import { toScene } from './particles.js';
import { BASICHIT_FRAME_SPEC, validateFrame } from './core/frame-spec.js';
import { spriteLayer, SPRITE_VERTEX_SHADER, SPRITE_FRAGMENT_SHADER } from './core/sprite-shader.js';
import { SUBUV_POLICIES } from './core/subuv-atlas.js';
import { DEPTH_FADE_DISTANCE } from './core/depth-fade.js';

const LIMIT = BASICHIT_FRAME_SPEC.limit;
// Emitter order of the system and of BASICHIT_FRAME_SPEC. Renderer facts (.scratch/unreal/basichit-source/system.t3d):
// every renderer Sprite, Alignment Unaligned, bSubImageBlend False, no pivot offset, size = quad edge in cm.
// Materials: BLEND_Translucent, MSM_Unlit. No DepthFade: the reference has no surface behind the effect (pilot case
// "none"), so M_Smoke's DepthFade factor is 1. Texture address modes: TA_WRAP on both axes for both textures
// (docs/delivery/st01c/basichit/render-sources.json "textures"), checked by basichit-render.test.mjs.
export const BASICHIT_LAYERS = Object.freeze([
  // NE_Flame_Basic_001: FaceCameraPosition, SubImageSize 8x4 (system.t3d:3516-3521); MI_Fireball over M_Smoke:
  // emissive = ParticleColor.rgb * tex.rgb, opacity = saturate(ParticleColor.a * tex.r); T_FireBall sRGB. The SubUV
  // wraps as UE does (40 frames over 32 cells).
  Object.freeze({ emitter: 'NE_Flame_Basic_001', material: 'MI_Fireball', texture: 'T_FireBall', address: 'wrap',
    layer: spriteLayer({ grid: [8, 4], texture: true, depthFade: null, facing: 'camera-position', subUV: 'wrap' }) }),
  // NE_Basic_Flash001: FaceCamera, no SubUV (system.t3d:1943-1947); MI_Hit_1 over M_Ground_Crack: emissive =
  // tex.rgb * ParticleColor.rgb (M_Ground_Crack.t3d:15, 20-22), opacity = (tex.rgb * ParticleColor.a) cast to the scalar
  // Opacity input, i.e. its R (t3d:16, 28-30); T_Hit_Circle sRGB.
  Object.freeze({ emitter: 'NE_Basic_Flash001', material: 'MI_Hit_1', texture: 'T_Hit_Circle', address: 'wrap',
    layer: spriteLayer({ grid: [1, 1], texture: true, depthFade: null }) }),
  // NE_SimpleBurst: FaceCamera (system.t3d:5404-5408); MI_Radial_2 over M_Master_RadialBeam: emissive =
  // ParticleColor.rgb, opacity = ParticleColor.a * RadialGradientExponential, no texture.
  Object.freeze({ emitter: 'NE_SimpleBurst', material: 'MI_Radial_2', texture: null, address: null,
    layer: spriteLayer({ grid: [1, 1], texture: false, depthFade: null, opacity: 'radial-gradient-exponential' }) })
]);
// Layers of the reference set "depth" (DEPTH.md): the Flame keeps its descriptor but gets M_Smoke's DepthFade, whose
// InOpacity is the clamped opacity (M_Smoke.t3d:31-32), so opacity = saturate(a * tex.r) * fade; the fade distance is
// MI_Fireball's 100 cm (material-defaults.json), 1 scene unit. Flash and SimpleBurst have no DepthFade. The gate and wrap
// sets keep BASICHIT_LAYERS.
export const BASICHIT_DEPTH_LAYERS = Object.freeze(BASICHIT_LAYERS.map((d, index) => index !== 0 ? d : Object.freeze({ ...d,
  layer: spriteLayer({ grid: [8, 4], texture: true, depthFade: DEPTH_FADE_DISTANCE, facing: 'camera-position', subUV: 'wrap' }) })));
// renderOrder per layer (Flame, Flash, SimpleBurst). Gate: emitter order, as T-1021-46 read ComputeRenderersDrawOrder
// (NiagaraSystem.cpp:2466-2486, SortOrderHint 0 everywhere). Engine: what that code yields, because
// RendererSortInfo.Sort (:2481) is TArray::Sort -> Algo::IntroSort, unstable; its selection branch for Count <= 8
// (IntroSort.h:63-84) leaves three equal hints as RendererDrawOrder [1, 2, 0] = Flash, SimpleBurst, Flame
// (docs/delivery/st01c/basichit/DRAW-ORDER.md, T-1022-33). Reverse and engine stay diagnostics until the author
// moves the gate.
export const DRAW_ORDERS = Object.freeze({ gate: Object.freeze([0, 1, 2]), reverse: Object.freeze([2, 1, 0]),
  engine: Object.freeze([2, 0, 1]) });

export class BasicHitParticles {
  // textures: one entry per layer, a THREE.Texture for a textured layer and null otherwise.
  // layers: BASICHIT_LAYERS (default) or BASICHIT_DEPTH_LAYERS.
  constructor(scene, textures, order = 'gate', layers = BASICHIT_LAYERS) {
    if (!Array.isArray(textures) || textures.length !== BASICHIT_LAYERS.length) throw new Error('BasicHit textures per layer');
    if (layers.length !== BASICHIT_LAYERS.length) throw new Error('BasicHit textures per layer');
    this.descriptors = layers;
    layers.forEach((d, index) => {
      if (d.layer.texture !== (textures[index]?.isTexture === true)) throw new Error('BasicHit layer texture mismatch');
    });
    this.layers = layers.map((d, index) => {
      const texture = textures[index];
      if (texture) {
        // UE TA_WRAP; a wrap SubUV layer needs it to read idx mod 32 past the last row.
        texture.wrapS = texture.wrapT = d.address === 'wrap' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        if (d.layer.subUV === 'wrap' && texture.wrapT !== THREE.RepeatWrapping) throw new Error('A wrap SubUV layer needs a repeating texture');
        texture.needsUpdate = true;
      }
      const plane = new THREE.PlaneGeometry(1, 1);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = plane.index.clone();
      geometry.setAttribute('position', plane.attributes.position.clone());
      geometry.setAttribute('uv', plane.attributes.uv.clone());
      plane.dispose();
      for (const [name, size] of Object.entries({ particlePosition: 3, particleSize: 2,
        particleColor: 4, particleRotation: 1, particleFrame: 1 })) {
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(LIMIT * size), size).setUsage(THREE.DynamicDrawUsage));
      }
      geometry.instanceCount = 0;
      const uniforms = { grid: { value: new THREE.Vector2(...d.layer.grid) } };
      if (texture) uniforms.atlas = { value: texture };
      if (d.layer.depthFade !== null) Object.assign(uniforms, { opaqueDepth: { value: null }, depthSize: { value: new THREE.Vector2(1, 1) },
        nearFar: { value: new THREE.Vector2(.01, 100) }, orthographic: { value: true }, depthFadeEnabled: { value: false },
        depthFadeDistance: { value: d.layer.depthFade } });
      const material = new THREE.ShaderMaterial({ vertexShader: SPRITE_VERTEX_SHADER, fragmentShader: SPRITE_FRAGMENT_SHADER,
        defines: { ...d.layer.defines }, uniforms,
        transparent: true, toneMapped: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
    this.counts = [0, 0, 0];
    this.subUV = 'wrap';
    this.setOrder(order);
  }
  setOrder(order) {
    if (!Object.hasOwn(DRAW_ORDERS, order)) throw new Error('Unknown BasicHit draw order');
    this.layers.forEach((mesh, index) => { mesh.renderOrder = DRAW_ORDERS[order][index]; });
    this.order = order;
  }
  // SubUV policy of the wrap layers (the Flame): 'wrap' as BASICHIT_LAYERS binds it, or the pilot's 'clamp' as a
  // diagnostic past the grid (docs/delivery/st01c/basichit/WRAP.md). Other layers are untouched.
  setSubUV(policy) {
    if (!SUBUV_POLICIES.includes(policy)) throw new Error('Invalid SubUV policy');
    if (policy === this.subUV) return;
    this.layers.forEach((mesh, index) => {
      if (this.descriptors[index].layer.subUV !== 'wrap') return;
      if (policy === 'wrap') mesh.material.defines.SUBUV_WRAP = ''; else delete mesh.material.defines.SUBUV_WRAP;
      mesh.material.needsUpdate = true;
    });
    this.subUV = policy;
  }
  // DepthFade input of the layers that have it (the Flame in the depth set): a nearest depth texture of the opaque pass,
  // never the active framebuffer, and the camera that drew it. Orthographic only, as the pilot's depth lab accepts.
  setDepth(texture, camera, width, height, enabled, { perspective = false } = {}) {
    if (camera.isOrthographicCamera !== true && !(perspective && camera.isPerspectiveCamera === true)) throw new Error('DepthFade needs an orthographic camera');
    this.layers.forEach((mesh, index) => {
      if (this.descriptors[index].layer.depthFade === null) return;
      const u = mesh.material.uniforms;
      u.opaqueDepth.value = texture; u.nearFar.value.set(camera.near, camera.far); u.depthSize.value.set(width, height);
      u.depthFadeEnabled.value = enabled;
      u.orthographic.value = camera.isOrthographicCamera === true;
    });
  }
  update(frame) {
    validateFrame(frame, BASICHIT_FRAME_SPEC);
    this.layers.forEach((mesh, index) => {
      const particles = frame.emitters[index].particles, a = mesh.geometry.attributes;
      particles.forEach((p, i) => {
        a.particlePosition.setXYZ(i, ...toScene(p.position));
        a.particleSize.setXY(i, p.size[0] / 100, p.size[1] / 100);
        a.particleColor.setXYZW(i, ...p.color);
        a.particleRotation.setX(i, p.rotation);
        // Flash and SimpleBurst carry no subImage: their 1x1 grid reads the whole texture or quad at 0.
        a.particleFrame.setX(i, p.subImage ?? 0);
      });
      Object.values(a).filter(x => x.isInstancedBufferAttribute).forEach(x => { x.needsUpdate = true; });
      mesh.geometry.instanceCount = particles.length;
      this.counts[index] = particles.length;
    });
  }
  dispose() {
    for (const mesh of this.layers) {
      mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
    }
    this.layers = [];
  }
}

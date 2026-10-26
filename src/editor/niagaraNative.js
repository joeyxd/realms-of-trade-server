import { BasicHitSimulation, MAX_STEP } from '../render/vfx/niagara/basichit-simulation.js';
import { NativeSimulation } from '../render/vfx/niagara/native-simulation.js';

// The measured simulation class of each recipe (the render side lives in nativeEffect.js).
export const NATIVE_SIMULATIONS = Object.freeze({ 'basichit-v1': BasicHitSimulation, 'flame-single-v1': NativeSimulation });

// Mobile GPU cap per effect: its textures over the full mip chain plus the film LUT (render targets stay outside). The mobile set is the
// KTX2 UASTC twin of each texture (full resolution, sRGB, mip chain in the file), listed in `mobileFiles` and swapped over `files` by quality.
export const NATIVE_MOBILE_GPU_CAP = 12 * 1024 * 1024;
// GPU bytes of one loaded texture for the Taller readout: a compressed texture's stored mip chain as transcoded on this device,
// else RGBA8 over the full chain the renderer generates from the bitmap.
export function nativeTextureBytes({ mipmaps, image }) {
  if (mipmaps?.length) return mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
  let { width, height } = image, bytes = 0;
  for (;;) {
    bytes += width * height * 4;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  }
}
const file = (url, sha256, decodedSha256) => Object.freeze({ url, sha256, ...(decodedSha256 && { decodedSha256 }) });
export const NIAGARA_NATIVE = Object.freeze({
  'niagara-97a82bae61b29237': Object.freeze({
    id: 'niagara-97a82bae61b29237', project: 'MyProject',
    sourceSha256: '97a82bae61b292371a78cadc6ffef2f7dcae3ea39ac0a9ccb6b5ed2ee57e18cf',
    adapter: 'niagara-native-v1', recipe: 'basichit-v1', drawOrder: 'engine',
    simulationDigest: 'edf4115394be6f61bca9da3a9c9dd5fe79a632254c14a9afb3b09e336b945139',
    files: Object.freeze({
      simulation: file('/src/render/vfx/niagara/basichit-source.json', '6388736b01d507edeeb18db23193be9ba4646185f3362332be2778d62f49950b'),
      film: file('/src/render/vfx/niagara/film-source.json', 'df3b1ba15eb364130e0e212ee111c7e97c00f8cbe0f4ee53cb1c71714b7174c0'),
      fireball: file('/assets/vfx/niagara/native/basichit-v1/fireball-v1.webp', 'a936de7a6b489b297893d235892010fa469a6c1f3410eefc3055e2f0cfb3a003', 'e7f5f2c6f0472d2bfce76c09cc2c9527e97b5f1e1abbc2836c118b22a094e0fe'),
      circle: file('/assets/vfx/niagara/native/basichit-v1/hit-circle-v1.webp', 'ec0c1aa72e55e61f4ef20c2be9f1f0aafa3a78b5341d265e34f61e117935551c', '1da2b4441a0b321f2953a420708af6ef2904ebba0f24633dbdd136e40233478b'),
    }),
    mobileFiles: Object.freeze({
      fireball: file('/assets/vfx/niagara/native/basichit-v1/fireball-v1.ktx2', 'aff46550f3e82acb414f0dc6fefd31b7edd69ab53a5e6bea07518218a044698f'),
      circle: file('/assets/vfx/niagara/native/basichit-v1/hit-circle-v1.ktx2', '01f395bc115bdf5c4f7e23a8a1f3c0979821e2be9ef2da7d9c7fcac00f81b5be'),
    }),
    evidence: Object.freeze(['RENDER', 'WRAP', 'DEPTH', 'DRAW-ORDER'].map(name => `docs/delivery/st01c/basichit/${name}.md`)),
  }),
  'niagara-985a431dc6c0d1ca': Object.freeze({
    id: 'niagara-985a431dc6c0d1ca', project: 'MyProject',
    sourceSha256: '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165',
    adapter: 'niagara-native-v1', recipe: 'flame-single-v1', drawOrder: 'index',
    simulationDigest: '0d417fde9bbfba5552d6b720fe446369ca46b19da7889a208ebf50c446566255',
    limitKey: 'nativeFlameLimit',
    limitation: 'Native browser port of NS_Flame_Single: the simulation, the Filmic color and the orthographic DepthFade are measured against UE 5.8; the perspective DepthFade, the composite over the stage, the flame and smoke draw order in perspective and the presentation controls are not measured; the mobile variant (KTX2 UASTC textures) is measured only for texture drift against the desktop textures and the GPU budget, not on a real phone or in FPS.',
    files: Object.freeze({
      simulation: file('/src/render/vfx/niagara/pilot-source.json', '85b251ab3c249aed61cd5fd6be16d0ace0229f88bbd7e03c45718d9e41e472a5'),
      film: file('/src/render/vfx/niagara/film-source.json', 'df3b1ba15eb364130e0e212ee111c7e97c00f8cbe0f4ee53cb1c71714b7174c0'),
      flame: file('/assets/vfx/niagara/native/flame-single-v1/flame-v1.webp', 'cc80a1d651f272f13a99f49b85a10415907a6a6b3abb138a42e27ffcba558a0d', 'ef5c19227fd76c2c2caf8ff3a5f0cd4668f3ca30a33f96bebf39aeca970e555b'),
      smoke: file('/assets/vfx/niagara/native/flame-single-v1/smoke-v1.webp', 'b9890532ed794b80a0501098a3a80c79b3a0da5d7ac885eccd509fdb07e61ec1', 'e8f683fa681a8baeb742e4f2c74382581e3bc15c00016d3682cdce40cf24d177'),
    }),
    mobileFiles: Object.freeze({
      flame: file('/assets/vfx/niagara/native/flame-single-v1/flame-v1.ktx2', 'fc901aae5e1843caadfc3ec8e685cbff674756d981a89f6f9491034b6ddaf5f1'),
      smoke: file('/assets/vfx/niagara/native/flame-single-v1/smoke-v1.ktx2', 'aa4757a19f82375727879b7d91e5445dfa76300580cb4f1cd1ea300890e8d347'),
    }),
    evidence: Object.freeze(['NATIVE', 'RENDER', 'COLOR', 'DEPTH', 'ATLAS'].map(name => `docs/delivery/st01c/${name}-LAB.md`)),
  }),
});

export function nativeStep(time, impactAt, { speed = 1, duration = 1 } = {}) {
  return time < impactAt ? -1 : Math.min(MAX_STEP, Math.max(0, Math.floor((time - impactAt) * 60 * speed / duration + 1e-6)));
}
const ends = new WeakMap();
export function nativeEndStep(source, seed = 6371, recipe = 'basichit-v1') {
  if (!ends.has(source)) ends.set(source, new Map());
  const cache = ends.get(source);
  if (!cache.has(seed)) {
    const simulation = new NATIVE_SIMULATIONS[recipe](source, { seed });
    // The end is the first empty step after the first particles (NS_Flame_Single is empty before its first birth and never empties after).
    let step = 1, seen = false;
    while (step < MAX_STEP) {
      const live = simulation.seek(step).emitters.some(e => e.particles.length);
      if (seen && !live) break;
      seen ||= live; step++;
    }
    cache.set(seed, step);
  }
  return cache.get(seed);
}

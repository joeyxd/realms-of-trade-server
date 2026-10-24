import { BasicHitSimulation, MAX_STEP } from '../render/vfx/niagara/basichit-simulation.js';

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
    evidence: Object.freeze(['RENDER', 'WRAP', 'DEPTH', 'DRAW-ORDER'].map(name => `docs/delivery/st01c/basichit/${name}.md`)),
  }),
});

export function nativeStep(time, impactAt, { speed = 1, duration = 1 } = {}) {
  return time < impactAt ? -1 : Math.min(MAX_STEP, Math.max(0, Math.floor((time - impactAt) * 60 * speed / duration + 1e-6)));
}
const ends = new WeakMap();
export function nativeEndStep(source, seed = 6371) {
  if (!ends.has(source)) ends.set(source, new Map());
  const cache = ends.get(source);
  if (!cache.has(seed)) {
    const simulation = new BasicHitSimulation(source, { seed });
    let step = 1;
    while (step < MAX_STEP && simulation.seek(step).emitters.some(e => e.particles.length)) step++;
    cache.set(seed, step);
  }
  return cache.get(seed);
}

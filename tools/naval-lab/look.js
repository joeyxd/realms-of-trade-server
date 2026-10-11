import * as THREE from 'three';

export const NAVAL_REFERENCE_PALETTE = Object.freeze({
  sky: 0x748e9e, horizon: 0x91adb9, underside: 0x527581,
  water: 0x173b46, shallow: 0x315762, foam: 0xe9ffff, bed: 0x132e39,
});

// Reuse existing wave/noise samples. No additional texture fetches, geometry waves or gameplay force.
const CRESTS = /* glsl */ `
  // Lab reference: broken pale caps on rolling swell, with distance LOD to avoid horizon shimmer.
  float labSwell = h1 * 0.55 + h2 * 0.45;
  float labRidge = smoothstep(0.64, 0.68, labSwell) * (1.0 - smoothstep(0.69, 0.74, labSwell));
  float labBreak = smoothstep(0.51, 0.69, nz2);
  float labCaps = labRidge * labBreak * (1.0 - smoothstep(65.0, 260.0, camDist));
  col = mix(col, uFoam * uWaterLight * 0.88, labCaps * 0.7);
`;

/** Override this scene's materials only; the shared island water and sky keep their presets. */
export function configureNavalReferenceLook({ scene, sky, sea, bottom, hemisphere, sun, pipeline }) {
  const p = NAVAL_REFERENCE_PALETTE;
  scene.fog = new THREE.Fog(p.horizon, 85, 570);
  hemisphere.color.setHex(0xd5e6ed); hemisphere.groundColor.setHex(0x455b68); hemisphere.intensity = 1.65;
  sun.color.setHex(0xd2dfe2); sun.intensity = 1.7;
  bottom.material.color.setHex(p.bed);
  const localSky = {
    skyTop: { value: new THREE.Color(p.sky) }, skyHorizon: { value: new THREE.Color(p.horizon) },
    skyBottom: { value: new THREE.Color(p.underside) }, skyCloud: { value: new THREE.Color(0x93a9b5) },
    sunColor: { value: new THREE.Color(0xd2dfe2) }, sunDisc: { value: 0 },
  };
  Object.assign(sky.material.uniforms, localSky);
  for (const material of Object.values(sea.userData.materials)) {
    Object.assign(material.uniforms, localSky, {
      uAbsorb: { value: new THREE.Vector3(0.55, 0.25, 0.20) },
      uScatterShallow: { value: new THREE.Color(p.shallow) }, uScatterDeep: { value: new THREE.Color(p.water) },
      uFoam: { value: new THREE.Color(p.foam) }, uCaustic: { value: new THREE.Color(0x7eaeb7) },
      uWaterLight: { value: new THREE.Color(0.88, 0.95, 1) },
      uSparkle: { value: 0.13 }, uGlints: { value: 0.03 },
    });
    material.uniforms.uWaves.value = 1.35;
    // Local fork of the shared material, checked against its anchor so renderer drift fails visibly.
    const anchor = '#ifdef MN_WATER_SSR\n  gl_FragColor = vec4(col, 1.0 - glowW * (1.0 - foam));';
    if (!material.fragmentShader.includes(anchor)) throw new Error('Water reference look anchor changed');
    material.fragmentShader = material.fragmentShader.replace(anchor, CRESTS + '\n' + anchor)
      .replace('glow * 0.07', 'glow * 0.018')
      .replace('clamp(fr * 0.9, 0.0, 0.6)', 'clamp(fr * 0.65, 0.0, 0.32)');
    material.needsUpdate = true;
  }
  pipeline.grading.contrast = 0.08; pipeline.grading.sat = 0.96;
  pipeline.grading.bloom = 0.08; pipeline.grading.vignette = 0.16;
}

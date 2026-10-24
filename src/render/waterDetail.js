// One calibration for refracted water and the cheap terrain-based caustic path.
export const WATER_DETAIL_DEFAULTS = Object.freeze({
  causticStrength: 0.072, causticWidth: 0.06, // strength as the terrain (low) path uses it; SSR water applies a gain
  foamContactScale: 0.75, foamLaceWidth: 0.45, foamLaceStrength: 0.75, foamWaveStrength: 0.4,
  surfaceLight: 0.035, refraction: 0.028,
  // Swash: the shore edge runs up to swashUp over the still level and drains to swashDown under it (height, u);
  // waveK: wave-line crests per u of water depth (rad / u).
  swashUp: 0.45, swashDown: 0.35, waveK: 2.6,
});

export const WATER_DETAIL_UNIFORMS = {
  mnCausticStrength: { value: WATER_DETAIL_DEFAULTS.causticStrength },
  mnCausticWidth: { value: WATER_DETAIL_DEFAULTS.causticWidth },
  mnFoamContactScale: { value: WATER_DETAIL_DEFAULTS.foamContactScale },
  mnFoamLaceWidth: { value: WATER_DETAIL_DEFAULTS.foamLaceWidth },
  mnFoamLaceStrength: { value: WATER_DETAIL_DEFAULTS.foamLaceStrength },
  mnFoamWaveStrength: { value: WATER_DETAIL_DEFAULTS.foamWaveStrength },
  mnWaterSurfaceLight: { value: WATER_DETAIL_DEFAULTS.surfaceLight },
  mnSwashUp: { value: WATER_DETAIL_DEFAULTS.swashUp },
  mnSwashDown: { value: WATER_DETAIL_DEFAULTS.swashDown },
  mnWaveK: { value: WATER_DETAIL_DEFAULTS.waveK },
};

// G stores normalized cellular edge distance. Antialiased ribbons with a soft shoulder leave the floor readable.
export const CAUSTIC_PARS = /* glsl */ `
  uniform float mnCausticStrength;
  uniform float mnCausticWidth;
  float mnCausticMask(float c1, float c2) {
    float aa = max(fwidth(c1), fwidth(c2)) * 0.7 + 0.002;
    float c = min(c1, c2);
    float core = 1.0 - smoothstep(max(0.0, mnCausticWidth - aa), mnCausticWidth + aa, c);
    return max(core, (1.0 - smoothstep(0.0, mnCausticWidth * 3.0 + aa, c)) * 0.35);
  }
`;

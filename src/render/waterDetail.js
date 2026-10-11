// One calibration for refracted water and the cheap terrain-based caustic path.
export const WATER_DETAIL_DEFAULTS = Object.freeze({
  causticStrength: 0.12, causticWidth: 0.035,
  foamContactScale: 0.55, foamLaceWidth: 0.035, foamLaceStrength: 0.52, foamWaveStrength: 0.28,
  surfaceLight: 0.035, refraction: 0.02,
});

export const WATER_DETAIL_UNIFORMS = {
  mnCausticStrength: { value: WATER_DETAIL_DEFAULTS.causticStrength },
  mnCausticWidth: { value: WATER_DETAIL_DEFAULTS.causticWidth },
  mnFoamContactScale: { value: WATER_DETAIL_DEFAULTS.foamContactScale },
  mnFoamLaceWidth: { value: WATER_DETAIL_DEFAULTS.foamLaceWidth },
  mnFoamLaceStrength: { value: WATER_DETAIL_DEFAULTS.foamLaceStrength },
  mnFoamWaveStrength: { value: WATER_DETAIL_DEFAULTS.foamWaveStrength },
  mnWaterSurfaceLight: { value: WATER_DETAIL_DEFAULTS.surfaceLight },
};

// G stores normalized cellular edge distance. Thin, antialiased ribbons leave the floor readable.
export const CAUSTIC_PARS = /* glsl */ `
  uniform float mnCausticStrength;
  uniform float mnCausticWidth;
  float mnCausticMask(float c1, float c2) {
    float aa = max(fwidth(c1), fwidth(c2)) * 0.7 + 0.002;
    return 1.0 - smoothstep(max(0.0, mnCausticWidth - aa), mnCausticWidth + aa, min(c1, c2));
  }
`;

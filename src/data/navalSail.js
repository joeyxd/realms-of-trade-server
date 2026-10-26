// Wind Waker sail formulas: research/wind-waker/05-vela-y-agua.md A1-A4 (T-1025-09).
// WW lengths and s16 angles; rates are per 30 Hz frame. Boom constants come from navalCamera.js.
export const NAVAL_SAIL = Object.freeze({
  frameRate: 30, maxFramesPerStep: 4, rows: 12, cols: 7, width: 290, height: 365,
  // GR:674-759, evaluated belly table in sheet A1; bottom to top, mast to leech.
  weights: Object.freeze([
    0,21,36,40,36,21,0, 14,45,69,77,73,54,34, 26,64,89,99,97,82,63,
    33,76,100,109,109,99,83, 35,78,101,112,113,106,92, 33,74,97,108,110,106,93,
    26,61,85,99,103,101,89, 14,42,66,83,91,90,80, 0,27,52,69,79,80,75,
    15,26,43,59,71,79,82, 20,24,34,45,55,64,72, 16,17,21,26,32,37,43,
  ]),
  headPinRows: 2, // Our yard adaptation: min(1, (11-row)/2), pins all head displacement.
  zrate: Object.freeze([0.05,0.125,0.175,0.15,0.0625,0.15,0.2,0.15,0.075,0.175,0.175,0.1]), // GR:364
  zrate2: Object.freeze([1,0.425,0.45,0.4,0.2,0.4,0.45,0.4,0.2,0.5,0.75,1]), // GR:369
  xrate: Object.freeze([1,0.95,0.9,0.85,0.8,0.75,0.7,0.65,0.55,0.4,0.25,0.1]), // GR:374
  psiScale: 0.6, psiDivisor: 4, psiMax: 0x1000, // GR:408-411
  amp: 0.064, ampBase: 0.02, breath: 0.01, // GR:418-430
  phi1Base: 2500, phi1Wind: 7200, phi1Max: 10000, phi2Rate: 3000, phi2Bias: 300, // GR:431-441
  lean: 0.5, push: 1.6, pushXBase: 0.25, pushXWind: 0.75, pushZBase: 0.5, pushZWind: 0.25, // GR:443-489
  phaseSin: 7500, phaseCos: 7200, lift: 0.05, // GR:481-500
  bunchBase: 0.67, bunchQ: 0.3, foldPhase: 10922, foldX: 120, foldY: 5, // GR:502-540
  foldChord: -0.25, leechFold: 4.25, chordOffset: -13.75, mix: 0.65, // GR:542-558
  arc: Object.freeze([0,0,0,0,0,0,0.0002,0.0007,0.0015,0.0015,0.0012,0]), // GR:566-585; index 77 also below
  gainBurst: 1.414, gainBurstScale: 0.25, gainBurstMin: 0.4, gainFrames: 15, gainLatch: 0.1001,
  gainScale: 0.1, gainStep: 0.05, gainReset: 0.7, // GR:449-471
  openRate: 3/11, closeRate: 3/13, sailOnFurl: 1-7/11, // SH:1297-1331,1591-1593
  normalAngle: 900, normalPhase: -800, // GR:192
});

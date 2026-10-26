// Wind Waker's Great Sea swell (research/wind-waker 01 section 5, 04 section 3, 05 section C; T-1025-08), in WW units:
// lengths in WW units, angles in s16 (0x10000 = one turn), periods in WW logic frames (30 a second). Convert with
// WW_UNIT / WW_ANGLE from navalHandling.js. SEA = d_a_sea.cpp. The one swell knob of the client (render only).
export const NAVAL_SEA = Object.freeze({
  frameRate: 30, // WW logic frames a second
  // h = sum A_i cos(theta_i), A_i = waveAmp * waveMax, theta = km * kScale * (vx x + vz z) - 0x10000 * (frame / period - 0.5)
  // + phase (SEA:25-58, 168, 623-627); the constant base height cancels out.
  waveAmp: 2.5, kScale: 6.28,
  waveMax: 30, // the Great Sea's open water (04 section 3: 0.956 of our units a component); 0 = calm
  waves: Object.freeze([
    Object.freeze({ km: 7.352941e-5, phase: 0, vx: 0.98, vz: 0.2, period: 200 }),
    Object.freeze({ km: 8.928571e-5, phase: 4000, vx: 0.2, vz: 0.98, period: 190 }),
    Object.freeze({ km: 1.13636364e-4, phase: 8000, vx: -0.98, vz: 0.2, period: 210 }),
    Object.freeze({ km: 1.5625e-4, phase: 12000, vx: 0.2, vz: -0.98, period: 180 }),
  ]),
  // Drawn patch (SEA:17-18, 521-524, 597-609): cells x cells grid cells of `cell` WW units around the camera, snapped to
  // whole cells; the outer edgeCells rings fade as the product of an x and a z factor (0, 1/6 .. 5/6).
  cells: 65, cell: 800, edgeCells: 6,
  // Our change (WW fades by distance to calm rooms instead): the amplitude rises with the water depth under the point,
  // smoothstep(d0, d1, depth), in our units. The island's shelf reaches its 7.5 floor about 5 units off the waterline.
  depthFade: Object.freeze({ d0: 2, d1: 8 }),
  // Our change too (WW fades by the distance to calm rooms, 163 + 163 units, 05 section C1; our island is small): the
  // swell is 0 within `near` units of land (height >= seaLevel) or of the dock deck and full beyond `far`, baked per
  // texel of the water height grid (render/naval/seaCalm.js) and rebuilt when the GM reshapes the terrain.
  calm: Object.freeze({ near: 15, far: 40, seaLevel: 0 }),
  floorOutside: -20, // seabed height off the height texture (water.js reads the same)
});

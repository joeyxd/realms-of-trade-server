// Wind Waker ship water effects: research/wind-waker/05-vela-y-agua.md B1-B4 (T-1025-10, PT20c).
// WW lengths in WW units, s16 angles, rates per 30 Hz frame; wake.js converts with WW_UNIT / WW_ANGLE.
// Directions are boat frame: +x left, +y up, -z astern. Anchors are the RIGHT side; the left side negates x.
export const NAVAL_WAKE = Object.freeze({
  frameRate: 30, maxFramesPerStep: 5,
  refLength: 7.2, // our units: WW's 565 u boat; hull offsets scale by rig.length / refLength
  stopEpsilon: 0.01, trackStart: 3, waveStart: 11, flyHeight: 40, // |fwd| bands and the height over the surface that stops all
  bowAhead: 150, sternBack: 415, // bow point offset (SH:2917); stern = 565 - 150, where the track is born
  waveFactor: 0.7, waveDispMax: 40, waveSlew: 2.0, waveSpeedMax: 40, // DP:1157-1181, SH:2965-3007
  rollUnit: 16384, rollMax: 0.3, freezeFrames: 20, // pitch factor 1 +- clamp(roll/16384, 0.3); frozen 20 frames
  dirLeft: Object.freeze([0.5, 1, -0.3]), dirRight: Object.freeze([-0.5, 1, -0.3]),
  anchors: Object.freeze([Object.freeze([-80, -50, -150]), Object.freeze([-40, -100, -350])]),
  splashFull: 30, splashSpeed: 15, splashFall: 0.2, // DP:1228-1274
  trackHeight: 2, trackRise: 5, trackFall: 5, trackFallStop: 10, trackAlphaMax: 255, // DP:1344-1471
  trackScroll: -0.04, trackRepeat: 4.0,
  landingBase: 10, landingGain: 50, landingSpan: 30, landingRef: -15, landingMin: 10, landingMax: 60, // SH:2945-2959
  // Ours: JPA disc data is not Nintendo's to give us (B5), so these are picked, each with its reason.
  ours: Object.freeze({
    waveLife: 30, // frames; one second of crest, long enough for a V as wide as the hull is long
    waveCap: Object.freeze({ desktop: 30, mobile: 18 }), // live particles per side (one per frame at life 30)
    waveEvery: Object.freeze({ desktop: 1, mobile: 2 }), // emit one particle per N frames; mobile halves the polyline
    crestRise: 0.4, // vertical share of the launch speed kept, so the crest peaks near 1 u instead of 2.3 u
    // gravity is not a constant: g = 2 vy / (life - 1) per particle, so every crest lands on the surface at end of life
    waveAlphaCrest: 0.85, waveAlphaAnchor: 0.3, // sheet alpha at the crest line and at the hull anchor
    trackRows: Object.freeze({ desktop: 90, mobile: 60 }), // one row per frame while the stern moves: 3 s / 2 s of ribbon
    trackTailRows: 12, // the oldest rows fade out over this many rows instead of ending on a hard edge
    trackAlpha: 0.9, // opacity ceiling of the ribbon at WW alpha 255
    puffBase: 2, puffGain: 4, // splash puffs per WW frame: 2 + 4 s (SHAPE.PUFF from the shared pool)
    puffLife: 0.38, puffSize: 0.2, // seconds and our units, scaled by splash scale and the hull scale
    color: Object.freeze([0.88, 0.99, 1]), // the foam tint of the lab trails
    flowAlong: 8, // noise coordinate per ribbon length (the FLOW_WAKE froth reads mnNoiseTex)
  }),
});

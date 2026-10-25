// Wind Waker "Boat" camera (research/wind-waker/04-camara-boat-disco.md, T-1025-05): style BN07 read from the GZLE01
// disc (main.dol styles[36], rodata 0x80354F98 + 36 * 0x84) and the rideCamera engine read from its assembly
// (0x80174E98, empty in zeldaret/tww). Values stay in WW units: lengths in WW units, angles in degrees as the style
// table stores them, rates per WW logic frame (30 a second). Convert lengths with WW_UNIT from navalHandling.js.
export const NAVAL_CAMERA = Object.freeze({
  frameRate: 30, // WW logic frames a second
  maxFramesPerStep: 4, // a render hitch never replays more than this many frames
  blendFrames: 20, // first frames after the switch close the gap by 1 / (20 - k)
  speedRef: 40, // Val14: speed ratio s = smoothed speed / 40, clamped to 1
  speedSmooth: 0.075, // updateMonitor: smoothed speed += 0.075 * (this frame's travel - smoothed)
  styleLag: 0.08, // radius and latitude bases ease to the style at 0.08 a frame
  radius: 800, radiusSpeed: -430, // Val10 + Val13 * s^2: 800 at rest, 370 at s = 1
  latitude: 5, latitudeSpeed: -5, // Val15 + Val18 * s^2, degrees
  latMin: -10, latMax: 30, // Val16 / Val17, degrees
  fov: 70, fovSpeed: 20, // Val25 + Val28 * s, vertical degrees
  ahead: 90, height: 10, heightSpeed: 5, side: 150, // gaze offset from the head: Val0, Val5 + Val8 * s, Val1 * sin(sail)
  sideLag: 0.1, // side weight eases to s at 0.1 a frame
  gazeLag: 0.2, // gaze weight starts at 0.2 and eases to 1 at 0.2 a frame
  headHeight: 92.5, // Link's attention point above his model base on the ship (d_a_player_main.cpp setAttentionPos)
  followXZ: 0.65, followY: 0.15, // centre follow per frame (Val3, Val4)
  azimuthLag: 0.2, // Val20
  lag: 0.1, // Val21: radius, latitude and FOV
  latHold: 0.25, // below s = 0.5 the latitude target leans 25 percent toward the current one
  wavePitch: 0.8, waveAhead: 200, // open sea: latitude += 0.8 * s * angle to the wave 200 ahead (degrees)
  bank: -5, // Val29: roll target per unit of stick x (degrees)
  bankRate: 0.01, // roll eases at 0.01 * |s| a frame
  // setSailAngle (d_a_ship.cpp:738-772): the boom sits at +-0x1555 by the wind's side, hysteresis 0x800.
  sailAngle: 0x1555, sailHysteresis: 0x800, sailCalc: Object.freeze({ divisor: 16, max: 0x800, min: 0x20 }),
});

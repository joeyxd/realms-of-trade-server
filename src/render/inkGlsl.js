// Shared GLSL for the hand-inked surface detail (M4.6 P5): terrain, props and vegetation paint ink lines,
// cracks, bricks and grain into their albedo only (lighting is untouched). Procedural, from the one noise texture.
// Include INK_GLSL through patchToon's `fragPars` (it needs mnNoiseTex, mnHash, vMnWorld and cameraPosition from toon.js).
// Every name is prefixed mn / MN_; none collides with the toon.js GLSL.
//
// Noise texture reminder (noiseTex.js): 8x8 cells per tile, so uv = p * k gives cells of 1 / (8 k) world units;
// G = (F2 - F1) / 0.6 ~ 2 * edge distance / 0.6 cells  =>  edge distance (world u) ~ G * 0.3 / (8 k).
export const INK_GLSL = /* glsl */ `
// Ink colour: srgb(0.07, 0.04, 0.14) in linear space.
const vec3 MN_INK = vec3(0.0029, 0.0008, 0.0132);

// Antialiased line from a distance d to its centre (same unit as the half width w); the edge softness follows
// fwidth(d), so a line thinner than a pixel fades out instead of aliasing.
float mnLine(float d, float w) {
  float aa = fwidth(d) * 0.8 + 1e-5;
  return 1.0 - smoothstep(w - aa, w + aa, d);
}

// Planar projection by dominant normal axis: xz for floors, (z, y) / (x, y) for walls (.y is up on walls).
vec2 mnTri(vec3 wp, vec3 wn) {
  vec3 a = abs(wn);
  if (a.y >= a.x && a.y >= a.z) return wp.xz;
  return a.x > a.z ? vec2(wp.z, wp.y) : vec2(wp.x, wp.y);
}
float mnIsFloor(vec3 wn) {
  vec3 a = abs(wn);
  return step(a.x, a.y) * step(a.z, a.y);
}

// 1 near the camera, 0 from ~75 u: far detail only costs and shimmers.
float mnDetailFade() {
  return 1.0 - smoothstep(42.0, 75.0, distance(vMnWorld, cameraPosition));
}

// x = hue in turns [0, 1), y = saturation, z = value.
vec3 mnHsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), d = mx - min(c.r, min(c.g, c.b));
  float h = 0.0;
  if (d > 1e-4) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, mx > 1e-4 ? d / mx : 0.0, mx);
}

// Running-bond brick grid: distance (same unit as size) to the nearest joint; mnBrickId = random 0..1 per brick.
vec2 mnBrickCell(vec2 uv, vec2 size) {
  vec2 p = uv / size;
  p.x += 0.5 * mod(floor(p.y), 2.0);
  return p;
}
float mnBricks(vec2 uv, vec2 size) {
  vec2 f = fract(mnBrickCell(uv, size));
  vec2 d = min(f, 1.0 - f) * size;
  return min(d.x, d.y);
}
float mnBrickId(vec2 uv, vec2 size) {
  return mnHash(floor(mnBrickCell(uv, size)) * 0.37 + 11.3);
}

// Ink cracks: cell edges (G) on the triplanar plane, kept only where the fbm mask (B) passes, so only a
// share of the edges show, as short broken strokes. k = noise frequency, w = half width (u), m = mask level
// (higher = sparser). Call it outside any branch (derivatives); "on" skips the texture read where it is not needed.
float mnCracks(vec3 wp, vec3 wn, float k, float w, float m, bool on) {
  vec3 a = abs(wn), dx = dFdx(wp), dy = dFdy(wp);
  vec2 uv = wp.xz, gx = dx.xz, gy = dy.xz;
  if (a.y < a.x || a.y < a.z) {
    if (a.x > a.z) { uv = wp.zy; gx = dx.zy; gy = dy.zy; }
    else { uv = wp.xy; gx = dx.xy; gy = dy.xy; }
  }
  vec4 c = vec4(0.0, 9.0, 0.0, 0.0);
  if (on) c = textureGrad(mnNoiseTex, uv * k, gx * k, gy * k);
  return mnLine(c.g * 0.3 / (8.0 * k), w) * smoothstep(m, m + 0.07, c.b);
}

// Greek-key (meander) motif, 6 cells wide x 5 tall, one running hook per period (bit x of a row = column x).
// pc = pattern cell coordinates (x along the band, y across), aa = pixel footprint in cells (edge softness).
const int MN_KEY[5] = int[5](31, 17, 29, 5, 61);
float mnKeyBit(vec2 i) {
  if (i.y < 0.0 || i.y > 4.5) return 0.0;
  return float((MN_KEY[int(i.y)] >> int(mod(i.x, 6.0))) & 1);
}
float mnMeander(vec2 pc, vec2 aa) {
  vec2 q = pc - 0.5, i = floor(q);
  vec2 w = clamp((fract(q) - 0.5) / max(2.0 * aa, vec2(1e-3)) + 0.5, 0.0, 1.0);
  return mix(mix(mnKeyBit(i), mnKeyBit(i + vec2(1.0, 0.0)), w.x), mix(mnKeyBit(i + vec2(0.0, 1.0)), mnKeyBit(i + vec2(1.0, 1.0)), w.x), w.y);
}
`;

// World-space normal varying (InstancedMesh safe: transformedNormal already holds the instance matrix).
// Use: vertPars / vertBody / fragPars of patchToon.
export const INK_WN = {
  vertPars: 'varying vec3 vMnWN;\n',
  vertBody: 'vMnWN = normalize(inverseTransformDirection(transformedNormal, viewMatrix));\n',
  fragPars: 'varying vec3 vMnWN;\n',
};

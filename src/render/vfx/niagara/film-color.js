// Source-derived Filmic SDR LUT. No observed pixels, fitted colors or Niagara state.
import * as THREE from 'three';
import { FILM_BEHAVIOR } from './film-identity.js';
const SUPPORTED_BEHAVIOR = JSON.stringify(FILM_BEHAVIOR);
const clamp = x => Math.max(0, Math.min(1, x));
const dot = (a, b) => a.reduce((s, v, i) => s + v*b[i], 0);
const mv = (m, v) => m.map(row => dot(row, v));
const mm = (a, b) => a.map(row => b[0].map((_, i) => dot(row, b.map(r => r[i]))));
const mix = (a, b, t) => a.map((v, i) => v + (b[i]-v)*t);

export function createFilmTransform(source) {
  if (source?.schema !== 'st01c-film-source/v1' || source.captureInputs !== false ||
      JSON.stringify([source.matrices, source.controls, source.lut]) !== SUPPORTED_BEHAVIOR)
    throw new Error('Unsupported Filmic source or profile');
  const m = source.matrices, c = source.controls, spec = source.lut;
  const s2a = mm(m.XYZ_2_AP1_MAT, mm(m.D65_2_D60_CAT, m.sRGB_2_XYZ_MAT));
  const a2s = mm(m.XYZ_2_sRGB_MAT, mm(m.D60_2_D65_CAT, m.AP1_2_XYZ_MAT));
  const a02a1 = mm(m.XYZ_2_AP1_MAT, m.AP0_2_XYZ_MAT), a12a0 = mm(m.XYZ_2_AP0_MAT, m.AP1_2_XYZ_MAT);
  const blue = mm(a02a1, mm(m.BlueCorrect, a12a0)), blueInv = mm(a02a1, mm(m.BlueCorrectInv, a12a0));
  const expand = mm(mm(m.XYZ_2_AP1_MAT, m.Wide_2_XYZ_MAT), a2s);
  const luma = m.AP1_2_XYZ_MAT[1];
  const toeScale = 1+c.FilmBlackClip-c.FilmToe, shoulderScale = 1+c.FilmWhiteClip-c.FilmShoulder;
  const bt = (.18+c.FilmBlackClip)/toeScale-1;
  const toeMatch = Math.log10(.18)-.5*Math.log((1+bt)/(1-bt))*(toeScale/c.FilmSlope);
  const straightMatch = (1-c.FilmToe)/c.FilmSlope-toeMatch;
  const shoulderMatch = c.FilmShoulder/c.FilmSlope-straightMatch;
  function encode(rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 65504))
      throw new Error('Invalid scene linear color');
    if (rgb.every(v => v === 0)) return [0, 0, 0];
    let ap1 = mv(s2a, rgb);
    const y = dot(ap1, luma), chromaDistance = ap1.reduce((sum, v) => sum+(v/y-1)**2, 0);
    const amount = (1-2**(-4*chromaDistance))*(1-2**(-4*c.ExpandGamut*y*y));
    ap1 = mix(ap1, mv(expand, ap1), amount);
    ap1 = mix(ap1, mv(blue, ap1), c.BlueCorrection);
    let ap0 = mv(a12a0, ap1);
    const saturation = (Math.max(Math.max(...ap0), 1e-10)-Math.max(Math.min(...ap0), 1e-10))/Math.max(Math.max(...ap0), .01);
    const [r, g, b] = ap0;
    const yc = (r+g+b+1.75*Math.sqrt(Math.max(0, b*(b-g)+g*(g-r)+r*(r-b))))/3;
    const x = (saturation-.4)/.2, t = Math.max(1-Math.abs(.5*x), 0);
    const glowGain = .05 * .5*(1+Math.sign(x)*(1-t*t));
    const glow = yc <= 2/3*.08 ? glowGain : yc >= 2*.08 ? 0 : glowGain*(.08/yc-.5);
    ap0 = ap0.map(v => v*(1+glow));
    let hue = r === g && g === b ? 0 : Math.atan2(Math.sqrt(3)*(g-b), 2*r-g-b)*180/Math.PI;
    if (hue < 0) hue += 360;
    if (hue > 180) hue -= 360;
    const h = clamp(1-Math.abs(2*hue/135)), hueWeight = (h*h*(3-2*h))**2;
    ap0[0] += hueWeight*saturation*(.03-ap0[0])*(1-.82);
    let working = mv(m.AP0_2_AP1_MAT, ap0).map(v => Math.max(0, v));
    working = mix([dot(working, luma), dot(working, luma), dot(working, luma)], working, .96);
    let tone = working.map(v => {
      // Handle the zero limit explicitly; it is the source toe's limit at -infinity.
      if (v <= 0) return 0;
      const log = Math.log10(v), straight = c.FilmSlope*(log+straightMatch);
      const toe = log < toeMatch ? -c.FilmBlackClip+2*toeScale/(1+Math.exp(-2*c.FilmSlope/toeScale*(log-toeMatch))) : straight;
      const shoulder = log > shoulderMatch ? 1+c.FilmWhiteClip-2*shoulderScale/(1+Math.exp(2*c.FilmSlope/shoulderScale*(log-shoulderMatch))) : straight;
      let blend = clamp((log-toeMatch)/(shoulderMatch-toeMatch));
      if (shoulderMatch < toeMatch) blend = 1-blend;
      blend = (3-2*blend)*blend*blend;
      return toe+(shoulder-toe)*blend;
    });
    tone = mix([dot(tone, luma), dot(tone, luma), dot(tone, luma)], tone, .93).map(v => Math.max(0, v));
    ap1 = mix(ap1, tone, c.ToneCurveAmount);
    ap1 = mix(ap1, mv(blueInv, ap1), c.BlueCorrection);
    return mv(a2s, ap1).map(v => {
      const lin = Math.max(0, v)**spec.inverseGammaY;
      return lin < .00313067 ? lin*12.92 : lin**(1/2.4)*1.055-.055;
    });
  }
  const logToLin = v => 2**((v-spec.exposureGrey/spec.codeValueMax)*spec.linearRange)*spec.linearGrey;
  const blackOffset = logToLin(0);
  return { encode, logToLin, blackOffset, spec,
    linToLog: v => clamp(Math.log2((v+blackOffset)/spec.linearGrey)/spec.linearRange+spec.exposureGrey/spec.codeValueMax) };
}

export function createFilmLUT(source) {
  const transform = createFilmTransform(source), n = transform.spec.size, max = transform.spec.max;
  const data = new Uint16Array(n*n*n*4), quantMax = 2**transform.spec.channelQuantizationBits-1;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const input = [x, y, z].map(v => Math.max(0, transform.logToLin(v/(n-1))-transform.blackOffset));
    const output = transform.encode(input), offset = 4*(x+n*(y+n*z));
    output.forEach((v, i) => { data[offset+i] = THREE.DataUtils.toHalfFloat(Math.round(clamp(v/max)*quantMax)/quantMax); });
    data[offset+3] = 0;
  }
  const texture = new THREE.Data3DTexture(data, n, n, n);
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return { texture, transform, generatedBytes: data.byteLength };
}

// GLSL3 output pass returns display-encoded RGB: no second gamma transform.
export const filmFragment = `precision highp float; precision highp sampler3D;
uniform sampler2D image; uniform sampler3D filmLUT; uniform float exposure;
in vec2 vUv; out vec4 outColor;
void main(){
  vec3 linearColor = max(vec3(0), texture(image,vUv).rgb * exposure);
  float black = exp2((0.0 - 444.0/1023.0)*14.0)*0.18;
  vec3 shaper = clamp(log2((linearColor+black)/0.18)/14.0+444.0/1023.0,0.0,1.0);
  vec3 coords = shaper*(31.0/32.0)+0.5/32.0;
  outColor = vec4(texture(filmLUT,coords).rgb*1.05,1.0);
}`;

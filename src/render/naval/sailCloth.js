// Pure WW sail pose, A1-A4 of research/wind-waker/05-vela-y-agua.md. No render dependencies.
import { NAVAL_SAIL as S } from '../../data/navalSail.js';
import { NAVAL_CAMERA as C } from '../../data/navalCamera.js';
import { WW_ANGLE } from '../../data/navalHandling.js';
const FRAME = 1/S.frameRate, N = S.rows*S.cols;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const angle = (v) => v-65536*Math.floor((v+32768)/65536);
const sin = (v) => Math.sin(v*WW_ANGLE), cos = (v) => Math.cos(v*WW_ANGLE);
function addCalc(v, target, scale, max, min = 0) {
  const d = target-v, step = Math.sign(d)*Math.min(Math.abs(d), clamp(Math.abs(d*scale), min, max));
  return v+step;
}
export function sailF3(row, furl) {
  const q = Math.min(row-2, 0)**2/4;
  return (1-(S.bunchBase+S.bunchQ*q)*furl)*(1-furl+S.zrate2[row]*furl);
}
export function createSailCloth(width, height) {
  const s = { width, height, acc: 0, frame: 0, boom: 0, boomAim: 0, prevBoom: 0,
    furl: 1, sailOn: false, g: 0.35, latch: false, timer: 0, psi: 0, phi1: 0, phi2: 0, breathPhase: 0,
    rest: new Float32Array(N*3), prev: new Float32Array(N*3), cur: new Float32Array(N*3),
    prevNormals: new Float32Array(N*3), normals: new Float32Array(N*3),
    out: { offsets: new Float32Array(N*3), normals: new Float32Array(N*3), boomAngle: 0, steps: 0 } };
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    const i = (r*S.cols+c)*3;
    s.rest[i] = c*width/6; s.rest[i+1] = (r/11-0.5)*height;
  }
  pose(s, 0, 0); s.prev.set(s.cur); normals(s); s.prevNormals.set(s.normals);
  s.out.offsets.set(s.cur); s.out.normals.set(s.normals);
  return s;
}
function pose(s, rel, power) {
  const f = s.furl, g = s.g, amp = S.amp*Math.abs(cos(s.psi))+S.ampBase;
  const side = Math.abs(sin(s.psi))*(1-f), breath = 1+S.breath*side*sin(s.breathPhase);
  const px = S.push*sin(s.psi)*Math.min(S.pushXBase+S.pushXWind*power, 1);
  const pz = S.push*cos(s.psi)*Math.min(S.pushZBase+S.pushZWind*power, 1), lean = S.lean*sin(rel);
  const m = S.mix*(1-f)+1-S.mix, sx = s.width/S.width, sy = s.height/S.height;
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    const i = r*S.cols+c, j = i*3, q = Math.min(r-2, 0)**2/4, pin = Math.min(1, (11-r)/S.headPinRows);
    const w = S.weights[i], sp = S.foldPhase*S.xrate[r], belly = (9-(3-c)**2)/9;
    const fs = (amp*sin(s.phi1+i*S.phaseSin)+g*(1-f)*px*breath)*w;
    const fc = (0.5*amp*cos(s.phi1+i*S.phaseCos)+g*(1-f)*pz*side)*w;
    const ys = S.lift*Math.hypot(fs, fc), fold = 1-0.5*q;
    const f4 = S.foldX*f*S.zrate[r]*(f*sin(s.phi2+sp*c)-lean)*belly*fold;
    const f5 = f*S.foldY*S.zrate[r]*c*(f*cos(s.phi2+sp*c)*c/6)*fold;
    const zfold = S.foldChord*Math.hypot(f4, f5)+(c > 4
      ? S.leechFold*(c-4)*Math.abs(sin(s.phi2+2*sp*c))*f*S.zrate[r]*c : 0);
    // WW x -> pivot z (sideways); WW -z -> pivot +x (aft). Uniform rows cancel base-y bunching.
    s.cur[j] = (-sailF3(r,f)*(-c*S.width/6)-zfold-m*fc*g-S.chordOffset-c*S.width/6)*sx*pin;
    s.cur[j+1] = (f5+ys*m)*sy*pin;
    s.cur[j+2] = (f4+m*fs*g)*sx*pin;
  }
  const ax = Math.abs(s.cur[59*3+2]/sx);
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i/7), pin = Math.min(1,(11-r)/S.headPinRows), k = i === 77 ? 0.0012 : S.arc[r];
    // Correct the whole WW chord, then return an offset from our rectangular rest grid.
    s.cur[i*3] = (s.rest[i*3]+s.cur[i*3])*(1-ax*k*pin)-s.rest[i*3];
  }
}
// Same indexed triangles as the cloth mesh; sum face normals, normalize, then fixed GR:192 wobble.
function normals(s) {
  const n = s.normals, p = s.rest, o = s.cur; n.fill(0);
  for (let r = 0; r < 11; r++) for (let c = 0; c < 6; c++) {
    const a = (r*7+c)*3, b = a+3, d = a+21, e = d+3;
    triangle(n,p,o,a,b,d); triangle(n,p,o,b,e,d);
  }
  for (let i = 0; i < N; i++) {
    const j = i*3, x = n[j], y = i >= 56 ? 0 : n[j+1], z = n[j+2], len = Math.hypot(x,y,z)||1;
    const a = S.normalAngle*sin((Math.floor(i/7)+i%7)*S.normalPhase), ca = cos(a), sa = sin(a);
    n[j] = (ca*x+sa*z)/len; n[j+1] = y/len; n[j+2] = (-sa*x+ca*z)/len;
  }
}
function triangle(n,p,o,a,b,c) {
  const ux = p[b]+o[b]-p[a]-o[a], uy = p[b+1]+o[b+1]-p[a+1]-o[a+1], uz = o[b+2]-o[a+2];
  const vx = p[c]+o[c]-p[a]-o[a], vy = p[c+1]+o[c+1]-p[a+1]-o[a+1], vz = o[c+2]-o[a+2];
  const x = uy*vz-uz*vy, y = uz*vx-ux*vz, z = ux*vy-uy*vx;
  n[a]+=x; n[a+1]+=y; n[a+2]+=z; n[b]+=x; n[b+1]+=y; n[b+2]+=z; n[c]+=x; n[c+1]+=y; n[c+2]+=z;
}
function frame(s, yaw, windYaw, power, on) {
  s.prev.set(s.cur); s.prevNormals.set(s.normals); s.prevBoom = s.boom;
  const relWind = angle((windYaw-yaw)/WW_ANGLE);
  if (relWind > C.sailHysteresis) s.boomAim = -C.sailAngle;
  else if (relWind < -C.sailHysteresis) s.boomAim = C.sailAngle;
  else if (!s.boomAim) s.boomAim = relWind >= 0 ? -C.sailAngle : C.sailAngle;
  s.boom = addCalc(s.boom,s.boomAim,1/C.sailCalc.divisor,C.sailCalc.max,C.sailCalc.min);
  s.furl = clamp(s.furl+(on ? -S.openRate : S.closeRate),0,1);
  s.sailOn = on && s.furl <= S.sailOnFurl;
  if (s.sailOn) {
    if (!s.latch && s.furl <= S.gainLatch) { s.latch = true; s.timer = S.gainFrames; }
    if (s.timer > 0) { s.g = addCalc(s.g,S.gainBurst,S.gainBurstScale,Infinity,S.gainBurstMin); s.timer--; }
    else s.g = addCalc(s.g,1,S.gainScale,S.gainStep);
  } else {
    if (s.furl > S.gainReset) { s.latch = false; s.timer = 0; }
    s.g = addCalc(s.g,1-S.mix*s.furl,S.gainScale,S.gainStep);
  }
  const rel = angle((yaw-windYaw)/WW_ANGLE+s.boom);
  let t = angle(rel+32768);
  if ((t > 0 && s.boom > 0 && s.boom < 16384) || (t <= 0 && s.boom < 0 && s.boom > -16384)) t = 0;
  s.psi = angle(s.psi+clamp(angle(S.psiScale*t-s.psi)/S.psiDivisor,-S.psiMax,S.psiMax));
  s.breathPhase = s.phi1;
  s.phi1 = angle(s.phi1+Math.min(S.phi1Base+S.phi1Wind*power,S.phi1Max));
  s.phi2 = angle(s.phi2+S.phi2Rate*cos(rel));
  s.phi2 = angle(s.phi2+(s.phi2 > 0 ? S.phi2Bias : -S.phi2Bias));
  pose(s,rel,power); normals(s); s.frame++;
}
// Inputs in radians/seconds. All arrays and the result are reused; at most four WW frames per call.
export function stepSailCloth(s, { dt = 0, yaw = 0, windYaw = 0, strength = 0, sailOn = true } = {}) {
  s.acc += clamp(num(dt),0,1);
  let n = Math.floor(s.acc/FRAME+1e-6);
  if (n > S.maxFramesPerStep) { n = S.maxFramesPerStep; s.acc %= FRAME; } else s.acc -= n*FRAME;
  if (s.acc < 1e-9) s.acc = 0;
  for (let k = 0; k < n; k++) frame(s,num(yaw),num(windYaw),clamp(num(strength),0,1),!!sailOn);
  const t = clamp(s.acc/FRAME,0,1), out = s.out;
  for (let j = 0; j < N*3; j++) {
    out.offsets[j] = s.prev[j]+(s.cur[j]-s.prev[j])*t;
    out.normals[j] = s.prevNormals[j]+(s.normals[j]-s.prevNormals[j])*t;
  }
  for (let j = 0; j < N*3; j += 3) {
    const len = Math.hypot(out.normals[j],out.normals[j+1],out.normals[j+2])||1;
    out.normals[j] /= len; out.normals[j+1] /= len; out.normals[j+2] /= len;
  }
  out.boomAngle = (s.prevBoom+(s.boom-s.prevBoom)*t)*WW_ANGLE; out.steps = n;
  return out;
}

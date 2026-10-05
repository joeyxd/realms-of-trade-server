// Synthesized one-shot sound effects.
import { audio } from './engine.js';

const STEP = {
  sand: { type: 'bandpass', f: 900, q: 0.7, dur: 0.07, g: 0.22 },
  grass: { type: 'highpass', f: 2600, q: 0.6, dur: 0.05, g: 0.13 },
  dirt: { type: 'bandpass', f: 620, q: 0.9, dur: 0.06, g: 0.22 },
  rock: { type: 'bandpass', f: 2300, q: 2.2, dur: 0.035, g: 0.2, thump: 170 },
  wood: { type: 'bandpass', f: 1400, q: 1.4, dur: 0.05, g: 0.18, knock: 240 },
  water: { type: 'lowpass', f: 1400, q: 0.7, dur: 0.16, g: 0.2 },
};

function noiseBurst(dest, t, { type, f, q, dur, g }, detune = 1) {
  const a = audio, ctx = a.ctx;
  const src = a.noiseSource();
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.frequency.value = f * detune; flt.Q.value = q;
  const gain = ctx.createGain();
  a.env(gain.gain, t, 0.004, g, dur);
  src.connect(flt).connect(gain).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(dest, t, { type = 'sine', f0, f1, dur, g, a = 0.004 }) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const gain = ctx.createGain();
  audio.env(gain.gain, t, a, g, dur);
  o.connect(gain).connect(dest);
  o.start(t);
  o.stop(t + a + dur + 0.05);
}

// Pitch-swept filtered noise (whooshes, creaks, risers).
function sweep(dest, t, { type = 'bandpass', f0, f1, q = 1, dur, g, a = 0.01 }) {
  const ctx = audio.ctx;
  const src = audio.noiseSource();
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), t + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(gain).connect(dest);
  src.start(t); src.stop(t + dur + 0.05);
}
// Inharmonic bell / clang partials.
function bell(dest, t, f, g, dur, ratios = [1, 2.76, 5.4, 8.93]) {
  ratios.forEach((r, i) => tone(dest, t, { f0: f * r, dur: dur / (1 + i * 0.6), g: g / (1 + i * 0.8), a: 0.002 }));
}

export const sfx = {
  step(material, wade = 0) {
    if (!audio.ready) return;
    const t = audio.now;
    const m = wade > 0.08 ? STEP.water : STEP[material] || STEP.sand;
    noiseBurst(audio.sfx, t, m, 0.85 + Math.random() * 0.3);
    if (m.thump) tone(audio.sfx, t, { f0: m.thump, f1: m.thump * 0.6, dur: 0.05, g: 0.12 });
    if (m.knock) tone(audio.sfx, t, { type: 'triangle', f0: m.knock, f1: m.knock * 0.8, dur: 0.06, g: 0.1 });
  },
  dash(wade = 0) {
    if (!audio.ready) return;
    const a = audio, ctx = a.ctx, t = a.now;
    const src = a.noiseSource();
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.Q.value = 1.1;
    flt.frequency.setValueAtTime(450, t);
    flt.frequency.exponentialRampToValueAtTime(3200, t + 0.16);
    flt.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(flt).connect(g).connect(a.sfx);
    src.start(t); src.stop(t + 0.4);
    tone(a.sfx, t, { f0: 140, f1: 55, dur: 0.14, g: 0.25 });
    tone(a.sfx, t + 0.01, { type: 'triangle', f0: 1400, f1: 2400, dur: 0.08, g: 0.05 });
    if (wade > 0.08) noiseBurst(a.sfx, t, STEP.water, 0.8);
  },
  denied() {
    if (!audio.ready) return;
    const t = audio.now;
    tone(audio.sfx, t, { type: 'square', f0: 180, f1: 140, dur: 0.08, g: 0.05 });
  },
  click() {
    if (!audio.ready) return;
    const t = audio.now;
    tone(audio.sfx, t, { type: 'triangle', f0: 900, f1: 620, dur: 0.06, g: 0.16 });
    noiseBurst(audio.sfx, t, { type: 'highpass', f: 4000, q: 0.7, dur: 0.02, g: 0.06 });
  },
  hover() {
    if (!audio.ready) return;
    tone(audio.sfx, audio.now, { f0: 1500, f1: 1700, dur: 0.03, g: 0.035 });
  },
  marimba(notes, spacing = 0.09, gain = 0.2) {
    if (!audio.ready) return;
    const t = audio.now + 0.02;
    notes.forEach((f, i) => {
      tone(audio.sfx, t + i * spacing, { f0: f, dur: 0.45, g: gain });
      tone(audio.sfx, t + i * spacing, { f0: f * 4, dur: 0.12, g: gain * 0.25 });
    });
  },
  zone() { this.marimba([523.25, 659.25, 783.99, 1046.5], 0.085, 0.16); },
  calderaZone() {
    if (!audio.ready) return;
    const t = audio.now;
    tone(audio.sfx, t, { type: 'sawtooth', f0: 73.4, dur: 1.6, g: 0.12, a: 0.05 });
    tone(audio.sfx, t, { type: 'sine', f0: 146.8, dur: 1.4, g: 0.12, a: 0.02 });
    this.marimba([293.66, 349.23, 440, 587.33], 0.11, 0.14);
  },
  play() { this.marimba([392, 493.88, 587.33, 783.99, 987.77], 0.07, 0.2); },
  // ---- Combat (M2). vol: 0..1 distance attenuation from the listener --------------------------------
  swing(stage = 1, vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    const long = stage === 3;
    sweep(d, t, { f0: long ? 300 : 500, f1: long ? 2600 : 2200, q: 1.3, dur: long ? 0.26 : 0.13, g: 0.26 * vol });
    tone(d, t, { type: 'triangle', f0: long ? 220 : 320, f1: long ? 520 : 600, dur: 0.07, g: 0.04 * vol });
  },
  hit(kind = 'flesh', crit = false, vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { f0: crit ? 160 : 130, f1: 55, dur: 0.12, g: 0.34 * vol });
    if (kind === 'bone') {
      for (let i = 0; i < 3; i++) noiseBurst(d, t + i * 0.012, { type: 'bandpass', f: 2600 + Math.random() * 1600, q: 3, dur: 0.03, g: 0.16 * vol });
    } else if (kind === 'straw') {
      noiseBurst(d, t, { type: 'lowpass', f: 900, q: 0.8, dur: 0.12, g: 0.22 * vol });
    } else noiseBurst(d, t, { type: 'highpass', f: 1800, q: 0.7, dur: 0.05, g: 0.14 * vol });
    if (crit) bell(d, t + 0.01, 1320, 0.05 * vol, 0.25);
  },
  // ---- weapons (M3.5) ----
  // Flintlock: a sharp crack over a low boom; the hands alternate a little in pitch.
  pistol(hand = 1, vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx, p = hand > 0 ? 1.08 : 0.94;
    noiseBurst(d, t, { type: 'highpass', f: 2200 * p, q: 0.8, dur: 0.05, g: 0.3 * vol });
    noiseBurst(d, t, { type: 'lowpass', f: 600 * p, q: 0.9, dur: 0.14, g: 0.26 * vol });
    tone(d, t, { type: 'triangle', f0: 180 * p, f1: 60, dur: 0.12, g: 0.12 * vol });
  },
  blast(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'lowpass', f: 900, q: 0.7, dur: 0.3, g: 0.42 * vol });
    noiseBurst(d, t, { type: 'bandpass', f: 3200, q: 0.6, dur: 0.08, g: 0.3 * vol });
    tone(d, t, { type: 'sine', f0: 120, f1: 40, dur: 0.3, g: 0.3 * vol });
  },
  blink(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { type: 'bandpass', f0: 2600, f1: 380, q: 1.1, dur: 0.24, g: 0.22 * vol });
    sweep(d, t + 0.05, { type: 'lowpass', f0: 1800, f1: 300, q: 0.7, dur: 0.4, g: 0.12 * vol });
  },
  rainCall(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    this.pistol(1, vol * 0.8);
    sweep(d, t + 0.05, { type: 'bandpass', f0: 600, f1: 3000, q: 1.5, dur: 0.35, g: 0.12 * vol });
  },
  // Lead hail: a patter of small cracks (called once per rain pulse).
  rainPatter(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    for (let i = 0; i < 5; i++) noiseBurst(d, t + Math.random() * 0.12, { type: 'bandpass', f: 2600 + Math.random() * 2400, q: 2, dur: 0.02, g: 0.08 * vol }, 1);
  },
  lunge(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { f0: 700, f1: 3400, q: 1.6, dur: 0.18, g: 0.3 * vol });
    tone(d, t + 0.06, { type: 'triangle', f0: 1400, f1: 900, dur: 0.08, g: 0.06 * vol });
  },
  iceAnchor(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { type: 'bandpass', f0: 420, f1: 2500, q: 1.8, dur: 0.28, g: 0.16 * vol });
    tone(d, t + 0.03, { type: 'triangle', f0: 880, f1: 1320, dur: 0.18, g: 0.065 * vol });
    tone(d, t + 0.11, { type: 'sine', f0: 1760, f1: 1174.66, dur: 0.24, g: 0.045 * vol });
    noiseBurst(d, t + 0.14, { type: 'highpass', f: 5200, q: 2.2, dur: 0.035, g: 0.07 * vol });
  },
  iceHit(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'highpass', f: 4300, q: 2.6, dur: 0.045, g: 0.075 * vol });
    tone(d, t, { type: 'triangle', f0: 1174.66, f1: 784, dur: 0.12, g: 0.055 * vol });
  },
  inkCloud(vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'lowpass', f: 680, q: 0.75, dur: 0.48, g: 0.2 * vol });
    sweep(d, t + 0.02, { type: 'bandpass', f0: 320, f1: 1050, q: 1.7, dur: 0.38, g: 0.11 * vol });
    tone(d, t + 0.08, { type: 'sine', f0: 180, f1: 92, dur: 0.42, g: 0.16 * vol });
  },
  inkHit(vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'bandpass', f: 1550, q: 2.4, dur: 0.055, g: 0.07 * vol });
    tone(d, t, { type: 'triangle', f0: 660, f1: 990, dur: 0.12, g: 0.045 * vol });
  },
  freeze(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'triangle', f0: 1568, f1: 1046.5, dur: 0.24, g: 0.09 * vol });
    bell(d, t + 0.025, 2093, 0.045 * vol, 0.3, [1, 2.1, 3.6]);
    noiseBurst(d, t + 0.02, { type: 'highpass', f: 4800, q: 2.4, dur: 0.06, g: 0.09 * vol });
  },
  crescent(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { f0: 400, f1: 2400, q: 2.2, dur: 0.35, g: 0.24 * vol });
    tone(d, t, { type: 'sine', f0: 880, f1: 1320, dur: 0.3, g: 0.05 * vol });
  },
  // ---- Tattoos (M4.7) ----
  // Tromba: the call (a rising, bubbling whoosh during its windup) and the column landing (a wet crash + a low thump).
  trombaCall(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { type: 'bandpass', f0: 260, f1: 1600, q: 1.2, dur: 0.5, g: 0.18 * vol, a: 0.12 });
    for (let i = 0; i < 4; i++) tone(d, t + 0.08 + i * 0.07, { f0: 380 + i * 120, f1: 760 + i * 160, dur: 0.06, g: 0.035 * vol });
  },
  waterSpout(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'lowpass', f: 1600, q: 0.6, dur: 0.55, g: 0.42 * vol });
    noiseBurst(d, t + 0.02, { type: 'bandpass', f: 3800, q: 0.8, dur: 0.25, g: 0.16 * vol });
    tone(d, t, { f0: 95, f1: 38, dur: 0.4, g: 0.38 * vol });
    sweep(d, t + 0.15, { type: 'bandpass', f0: 1200, f1: 300, q: 1, dur: 0.5, g: 0.1 * vol });
  },
  // Abordaje: the jump (a rising whoosh) and its landing (a heavy thud with debris).
  leap(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { f0: 300, f1: 1700, q: 1.4, dur: 0.3, g: 0.22 * vol });
  },
  boardSlam(vol = 1, big = false) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { f0: big ? 62 : 80, f1: 26, dur: big ? 0.6 : 0.45, g: 0.55 * vol });
    noiseBurst(d, t, { type: 'lowpass', f: 1100, q: 0.7, dur: 0.32, g: 0.42 * vol });
    for (let i = 0; i < 5; i++) noiseBurst(d, t + 0.05 + Math.random() * 0.2, { type: 'bandpass', f: 1800 + Math.random() * 2200, q: 2.5, dur: 0.025, g: 0.07 * vol }, 1);
  },
  // Timón: the throw's whirr (faster with the charge), the catch (a bright click + chime) and the full charge (a tick).
  wheelThrow(k = 0, vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    for (let i = 0; i < 6; i++) noiseBurst(d, t + i * (0.05 - k * 0.012), { type: 'bandpass', f: 900 + i * 90, q: 3, dur: 0.035, g: (0.12 - i * 0.012) * vol }, 1);
    sweep(d, t, { f0: 500, f1: 1500 + k * 900, q: 1.8, dur: 0.3, g: 0.14 * vol });
  },
  wheelCatch() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'bandpass', f: 2400, q: 4, dur: 0.03, g: 0.2 });
    bell(d, t + 0.02, 1046.5, 0.07, 0.35);
    tone(d, t + 0.06, { type: 'triangle', f0: 1568, dur: 0.12, g: 0.05 });
  },
  chargeFull() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'triangle', f0: 1760, dur: 0.05, g: 0.08 });
    tone(d, t + 0.05, { type: 'triangle', f0: 2349, dur: 0.07, g: 0.06 });
  },
  // Rayo de mástil: one dry crack followed by a short, bright falling arc on release.
  mastbolt(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'highpass', f: 2600, q: 0.8, dur: 0.075, g: 0.24 * vol });
    tone(d, t, { type: 'triangle', f0: 1280, f1: 360, dur: 0.24, g: 0.13 * vol });
    sweep(d, t + 0.015, { type: 'bandpass', f0: 1900, f1: 620, q: 1.4, dur: 0.2, g: 0.12 * vol });
  },
  equip() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    bell(d, t, 640, 0.08, 0.3);
    noiseBurst(d, t + 0.05, { type: 'bandpass', f: 1800, q: 3, dur: 0.05, g: 0.12 });
  },
  destroy(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'triangle', f0: 2400, f1: 1900, dur: 0.06, g: 0.12 * vol });
    noiseBurst(d, t, { type: 'highpass', f: 5000, q: 0.7, dur: 0.025, g: 0.1 * vol });
  },
  clunk() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'square', f0: 150, f1: 95, dur: 0.09, g: 0.07 });
    noiseBurst(d, t, { type: 'lowpass', f: 700, q: 1, dur: 0.06, g: 0.16 });
  },
  // Sword reflect: BUENO = whoosh + ping; EXCELENTE = a clang that climbs a semitone per chained reflect;
  // POBRE = a dull, short tick.
  parry(perfect, chain = 1, poor = false) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    if (poor) {
      sweep(d, t, { f0: 600, f1: 1800, q: 1.2, dur: 0.12, g: 0.12 });
      tone(d, t, { type: 'triangle', f0: 660, f1: 520, dur: 0.07, g: 0.07 });
      return;
    }
    sweep(d, t, { f0: 700, f1: 3800, q: 1.4, dur: 0.18, g: 0.22 });
    const f = 880 * Math.pow(2, (Math.min(5, chain) - 1) / 12);
    if (perfect) {
      bell(d, t, f, 0.22, 0.9);
      bell(d, t + 0.005, f * 1.5, 0.07, 0.6);
      tone(d, t, { f0: 90, f1: 45, dur: 0.22, g: 0.3 });
    } else {
      tone(d, t, { f0: f * 1.35, f1: f * 1.6, dur: 0.12, g: 0.13 });
      tone(d, t, { type: 'triangle', f0: f * 0.67, dur: 0.1, g: 0.06 });
    }
  },
  block(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { f0: 110, f1: 60, dur: 0.16, g: 0.36 * vol });
    bell(d, t, 520, 0.08 * vol, 0.3, [1, 2.3, 4.1]);
  },
  // Perfect guard: a bright clang and a "tink" per bullet caught (higher with each one held).
  guardPerfect(n = 0) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    bell(d, t, 740, 0.16, 0.7);
    tone(d, t, { f0: 85, f1: 50, dur: 0.18, g: 0.26 });
    if (n) bell(d, t + 0.06, 1568 * Math.pow(2, (n - 1) / 12 * 3), 0.07, 0.35, [1, 2.4]);
  },
  guardBreak() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'bandpass', f: 1600, q: 0.8, dur: 0.25, g: 0.26 });
    tone(d, t, { type: 'sawtooth', f0: 220, f1: 70, dur: 0.3, g: 0.12 });
    bell(d, t + 0.02, 330, 0.08, 0.4, [1, 1.9, 3.3]);
  },
  // Caught bullets thrown back: a rising whoosh, heavier with a heavy orb.
  release(n = 1, heavy = false) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { f0: 500, f1: 4200, q: 1.2, dur: 0.22, g: 0.18 + 0.04 * n });
    if (heavy) tone(d, t, { f0: 120, f1: 220, dur: 0.2, g: 0.25 });
    for (let i = 0; i < Math.min(3, n); i++) tone(d, t + i * 0.04, { type: 'triangle', f0: 1046.5 * Math.pow(2, i * 4 / 12), dur: 0.12, g: 0.05 });
  },
  punish() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'sawtooth', f0: 95, f1: 70, dur: 0.22, g: 0.12 });
    noiseBurst(d, t, { type: 'bandpass', f: 900, q: 1.5, dur: 0.12, g: 0.2 });
  },
  hurt(heavy = false) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { f0: heavy ? 110 : 140, f1: 45, dur: heavy ? 0.22 : 0.15, g: 0.42 });
    noiseBurst(d, t, { type: 'bandpass', f: 1100, q: 0.9, dur: 0.08, g: 0.2 });
    tone(d, t + 0.01, { type: 'triangle', f0: 420, f1: 260, dur: 0.09, g: 0.06 });
  },
  graze() {
    if (!audio.ready) return;
    sweep(audio.sfx, audio.now, { type: 'highpass', f0: 6000, f1: 2500, q: 0.7, dur: 0.16, g: 0.09 });
    tone(audio.sfx, audio.now, { f0: 1760, f1: 2100, dur: 0.08, g: 0.035 });
  },
  ghost() {
    if (!audio.ready) return;
    const t = audio.now;
    sweep(audio.sfx, t, { f0: 400, f1: 3000, q: 2, dur: 0.25, g: 0.14, a: 0.2 });
    bell(audio.sfx, t + 0.08, 1568, 0.07, 0.5);
  },
  dodge() {
    if (!audio.ready) return;
    sweep(audio.sfx, audio.now, { type: 'highpass', f0: 4500, f1: 1800, q: 0.8, dur: 0.12, g: 0.07 });
  },
  bounce(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now;
    tone(audio.sfx, t, { type: 'triangle', f0: 1320, f1: 2640, dur: 0.07, g: 0.07 * vol });
    bell(audio.sfx, t + 0.02, 2093, 0.04 * vol, 0.25);
  },
  whiff() {
    if (!audio.ready) return;
    sweep(audio.sfx, audio.now, { f0: 900, f1: 500, q: 0.8, dur: 0.12, g: 0.06 });
  },
  riposte() {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { type: 'lowpass', f0: 300, f1: 6000, q: 1, dur: 0.5, g: 0.32 });
    tone(d, t, { f0: 70, f1: 35, dur: 0.5, g: 0.42 });
    for (const f of [523.25, 659.25, 783.99, 1046.5]) tone(d, t + 0.02, { type: 'triangle', f0: f, dur: 0.7, g: 0.07 });
  },
  // Telegraphs and enemy actions (attenuated by distance).
  windup(atk, vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    if (atk === 'volley') sweep(d, t, { f0: 500, f1: 1300, q: 6, dur: 0.42, g: 0.08 * vol, a: 0.3 });
    else if (atk === 'cleave') { sweep(d, t, { f0: 200, f1: 1600, q: 3, dur: 0.75, g: 0.12 * vol, a: 0.6 }); tone(d, t, { type: 'sawtooth', f0: 60, f1: 120, dur: 0.75, g: 0.05 * vol, a: 0.5 }); }
    else if (atk === 'spikes') { bell(d, t, 1975, 0.05 * vol, 0.5); sweep(d, t, { f0: 2000, f1: 5000, q: 8, dur: 0.55, g: 0.05 * vol, a: 0.4 }); }
    else if (atk === 'orb') { tone(d, t, { type: 'sawtooth', f0: 70, f1: 150, dur: 0.8, g: 0.09 * vol, a: 0.6 }); tone(d, t, { f0: 140, f1: 300, dur: 0.8, g: 0.06 * vol, a: 0.6 }); }
    else if (atk === 'ball') for (let i = 0; i < 6; i++) noiseBurst(d, t + i * 0.1 + Math.random() * 0.04, { type: 'highpass', f: 3000, q: 0.7, dur: 0.02, g: 0.06 * vol });
    else if (atk === 'charge') { tone(d, t, { type: 'sawtooth', f0: 45, f1: 110, dur: 0.7, g: 0.16 * vol, a: 0.4 }); sweep(d, t, { type: 'lowpass', f0: 300, f1: 2400, dur: 0.7, g: 0.12 * vol, a: 0.5 }); }
    else if (atk === 'mortar') for (let i = 0; i < 3; i++) noiseBurst(d, t + i * 0.12, { type: 'bandpass', f: 900, q: 3, dur: 0.03, g: 0.08 * vol });
  },
  fire(atk, vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    if (atk === 'volley') for (let i = 0; i < 3; i++) { tone(d, t + i * 0.12, { type: 'triangle', f0: 330, f1: 160, dur: 0.07, g: 0.12 * vol }); noiseBurst(d, t + i * 0.12, { type: 'bandpass', f: 1800, q: 2, dur: 0.04, g: 0.08 * vol }); }
    else if (atk === 'spikes') sweep(d, t, { type: 'bandpass', f0: 3000, f1: 900, q: 4, dur: 0.22, g: 0.12 * vol });
    else if (atk === 'orb') { tone(d, t, { f0: 220, f1: 80, dur: 0.35, g: 0.2 * vol }); sweep(d, t, { type: 'lowpass', f0: 2000, f1: 300, dur: 0.35, g: 0.12 * vol }); }
    else if (atk === 'ball') { tone(d, t, { f0: 90, f1: 40, dur: 0.3, g: 0.4 * vol }); noiseBurst(d, t, { type: 'lowpass', f: 1200, q: 0.7, dur: 0.25, g: 0.35 * vol }); }
  },
  slam(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { f0: 70, f1: 28, dur: 0.45, g: 0.5 * vol });
    noiseBurst(d, t, { type: 'lowpass', f: 900, q: 0.7, dur: 0.3, g: 0.4 * vol });
  },
  bones(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    for (let i = 0; i < 9; i++) noiseBurst(d, t + Math.random() * 0.5, { type: 'bandpass', f: 1500 + Math.random() * 3000, q: 4, dur: 0.025, g: (0.12 + Math.random() * 0.1) * vol });
    tone(d, t, { f0: 120, f1: 60, dur: 0.2, g: 0.2 * vol });
  },
  wake(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'sawtooth', f0: 41, f1: 55, dur: 1.2, g: 0.14 * vol, a: 0.3 });
    bell(d, t + 0.3, 1318.5, 0.06 * vol, 0.8);
    bell(d, t + 0.5, 1975.5, 0.04 * vol, 0.6);
  },
  // La Prueba de Fuego: wave gong, boss roar (phase change), shield break, victory fanfare.
  gong(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    bell(d, t, 110, 0.22 * vol, 3.2, [1, 1.48, 2.03, 2.74, 3.8]);
    tone(d, t, { f0: 55, f1: 52, dur: 2.2, g: 0.18 * vol, a: 0.01 });
  },
  roar(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'sawtooth', f0: 70, f1: 38, dur: 1.6, g: 0.22 * vol, a: 0.15 });
    sweep(d, t, { type: 'bandpass', f0: 300, f1: 120, q: 1.2, dur: 1.4, g: 0.25 * vol, a: 0.1 });
    noiseBurst(d, t + 0.05, { type: 'lowpass', f: 600, q: 0.7, dur: 1.2, g: 0.2 * vol });
  },
  shieldBreak(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'highpass', f: 2500, q: 0.8, dur: 0.35, g: 0.25 * vol });
    for (let i = 0; i < 4; i++) bell(d, t + i * 0.04, 1760 * (1 + i * 0.27), 0.06 * vol, 0.5);
  },
  fanfare(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(d, t + i * 0.13, f, 0.09 * vol, 1.4));
    tone(d, t, { f0: 130.8, f1: 130.8, dur: 1.6, g: 0.1 * vol, a: 0.05 });
  },
  // M3: mortar thump, meteor whistle, laser hum, fire lane roar, armour clunk, lava rising.
  mortar(vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { f0: 110, f1: 45, dur: 0.22, g: 0.35 * vol });
    noiseBurst(d, t, { type: 'lowpass', f: 700, q: 0.8, dur: 0.18, g: 0.25 * vol });
    sweep(d, t + 0.05, { type: 'bandpass', f0: 600, f1: 1400, q: 6, dur: 0.6, g: 0.05 * vol });
  },
  meteor(vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    sweep(d, t, { type: 'bandpass', f0: 2600, f1: 500, q: 5, dur: 0.85, g: 0.08 * vol, a: 0.2 });
  },
  laser(vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    tone(d, t, { type: 'sawtooth', f0: 180, f1: 190, dur: 3.8, g: 0.06 * vol, a: 0.15 });
    tone(d, t, { type: 'square', f0: 361, f1: 377, dur: 3.8, g: 0.025 * vol, a: 0.15 });
    sweep(d, t, { type: 'bandpass', f0: 3000, f1: 1200, q: 3, dur: 0.4, g: 0.12 * vol });
  },
  lane(vol = 1) {
    if (!audio.ready || vol < 0.03) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'lowpass', f: 900, q: 0.6, dur: 2.8, g: 0.16 * vol, a: 0.25 });
    tone(d, t, { type: 'sawtooth', f0: 55, f1: 48, dur: 2.6, g: 0.08 * vol, a: 0.2 });
  },
  armor(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    bell(d, t, 620, 0.08 * vol, 0.25, [1, 2.4, 3.1]);
    noiseBurst(d, t, { type: 'bandpass', f: 3500, q: 3, dur: 0.05, g: 0.12 * vol });
  },
  lava(vol = 1) {
    if (!audio.ready) return;
    const t = audio.now, d = audio.sfx;
    noiseBurst(d, t, { type: 'lowpass', f: 300, q: 0.7, dur: 2.5, g: 0.3 * vol, a: 0.8 });
    tone(d, t, { f0: 40, f1: 32, dur: 2.5, g: 0.2 * vol, a: 0.8 });
    for (let i = 0; i < 6; i++) tone(d, t + 0.4 + Math.random() * 1.8, { f0: 160 + Math.random() * 120, f1: 60, dur: 0.12, g: 0.06 * vol });
  },
  shotHit(vol = 1) {
    if (!audio.ready) return;
    tone(audio.sfx, audio.now, { f0: 600, f1: 300, dur: 0.08, g: 0.1 * vol });
    noiseBurst(audio.sfx, audio.now, { type: 'bandpass', f: 2200, q: 1.2, dur: 0.05, g: 0.12 * vol });
  },
  death() {
    if (!audio.ready) return;
    const t = audio.now;
    for (const [f, dt] of [[392, 0], [349.23, 0.18], [293.66, 0.36], [196, 0.6]]) tone(audio.sfx, t + dt, { type: 'triangle', f0: f, dur: 0.5, g: 0.1 });
    tone(audio.sfx, t, { f0: 80, f1: 40, dur: 0.8, g: 0.3 });
  },
  respawn() { this.marimba([392, 523.25, 659.25, 783.99], 0.06, 0.14); },
  levelUp() { this.marimba([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.08, 0.2); },
  talk() {
    if (!audio.ready) return;
    const t = audio.now;
    for (let i = 0; i < 4; i++) tone(audio.sfx, t + i * 0.07, { type: 'triangle', f0: 380 + Math.random() * 220, dur: 0.05, g: 0.06 });
  },

  // ---- Loot and progress (M4) -------------------------------------------------------------------------
  // Something dropped for you: a thud, and a chime that climbs with the rarity (legendary: a little fanfare).
  lootDrop(r = 0, vol = 1) {
    if (!audio.ready || vol <= 0) return;
    const t = audio.now;
    noiseBurst(audio.sfx, t, { type: 'lowpass', f: 600, q: 0.8, dur: 0.08, g: 0.18 * vol });
    if (r <= 0) return;
    const base = [0, 523.25, 659.25, 783.99, 1046.5][r];
    bell(audio.sfx, t + 0.05, base, 0.08 * vol * (0.8 + r * 0.15), 0.6 + r * 0.25);
    if (r >= 3) this.marimba(r >= 4 ? [783.99, 987.77, 1174.66, 1567.98] : [659.25, 830.61, 987.77], 0.07, 0.12 * vol);
  },
  coins(n = 1, vol = 1) {
    if (!audio.ready || vol <= 0) return;
    const t = audio.now, k = Math.min(5, 1 + Math.floor(n / 5));
    for (let i = 0; i < k; i++) bell(audio.sfx, t + i * 0.045 + Math.random() * 0.02, 1900 + Math.random() * 700, 0.05 * vol, 0.18, [1, 2.4, 3.9]);
  },
  pickup(r = 0) {
    if (!audio.ready) return;
    const t = audio.now;
    sweep(audio.sfx, t, { type: 'bandpass', f0: 500, f1: 2200, q: 1.4, dur: 0.16, g: 0.12 });
    tone(audio.sfx, t + 0.06, { type: 'triangle', f0: 660 + r * 110, f1: 990 + r * 160, dur: 0.14, g: 0.08 });
  },
  potion() {
    if (!audio.ready) return;
    const t = audio.now;
    for (let i = 0; i < 3; i++) tone(audio.sfx, t + i * 0.09, { f0: 300 + i * 40, f1: 180, dur: 0.08, g: 0.12 });
    this.marimba([587.33, 739.99, 880], 0.06, 0.1);
  },
  locked() {
    if (!audio.ready) return;
    const t = audio.now;
    tone(audio.sfx, t, { type: 'square', f0: 180, f1: 140, dur: 0.1, g: 0.05 });
    tone(audio.sfx, t + 0.08, { type: 'square', f0: 140, f1: 110, dur: 0.12, g: 0.05 });
  },
  questStart() { this.marimba([440, 587.33, 739.99], 0.08, 0.12); },
  questDone() { this.marimba([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], 0.075, 0.18); },
  mastery() {
    if (!audio.ready) return;
    const t = audio.now;
    bell(audio.sfx, t, 392, 0.12, 1.2);
    this.marimba([587.33, 783.99, 987.77, 1174.66], 0.09, 0.16);
  },
  chest(r = 2) {
    if (!audio.ready) return;
    const t = audio.now;
    sweep(audio.sfx, t, { type: 'bandpass', f0: 180, f1: 90, q: 4, dur: 0.35, g: 0.18 }); // the lid creaks
    noiseBurst(audio.sfx, t + 0.3, { type: 'lowpass', f: 900, q: 0.7, dur: 0.25, g: 0.3 });
    this.lootDrop(r);
    this.coins(20);
  },
  buy() { this.coins(8); this.marimba([659.25, 880], 0.06, 0.1); },
};

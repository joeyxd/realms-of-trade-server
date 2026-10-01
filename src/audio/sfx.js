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
  talk() {
    if (!audio.ready) return;
    const t = audio.now;
    for (let i = 0; i < 4; i++) tone(audio.sfx, t + i * 0.07, { type: 'triangle', f0: 380 + Math.random() * 220, dur: 0.05, g: 0.06 });
  },
};

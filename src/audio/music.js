// Generative layered music. Level 0 = explore (marimba plucks + pad + soft bass).
// The Caldera switches to a minor mood with a low drone. setLevel(1..3) adds combat layers (M2+).
import { audio } from './engine.js';

const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // semitone 0 = C4
const MOODS = {
  island: { bpm: 96, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], scale: [0, 2, 4, 7, 9, 12, 14, 16] },
  caldera: { bpm: 84, chords: [[2, 5, 9], [-2, 2, 5], [0, 3, 7], [-3, 0, 4]], scale: [2, 3, 5, 7, 9, 10, 14, 15] },
};

export class Music {
  constructor() {
    this.started = false;
    this.mood = 'island';
    this.level = 0;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.rngState = 7;
  }

  rand() { this.rngState = (this.rngState * 16807) % 2147483647; return this.rngState / 2147483647; }

  start() {
    if (this.started || !audio.ready) return;
    this.started = true;
    const ctx = audio.ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0;
    this.bus.connect(audio.music);
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
    this.drone = null;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setMood(mood) {
    if (mood === this.mood || !MOODS[mood]) return;
    this.mood = mood;
    if (!this.started) return;
    const ctx = audio.ctx;
    if (mood === 'caldera' && !this.drone) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = N(2) / 4; o2.type = 'sawtooth'; o2.frequency.value = N(2) / 4 * 1.006;
      f.type = 'lowpass'; f.frequency.value = 240; g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g).connect(this.bus);
      o.start(); o2.start();
      g.gain.setTargetAtTime(0.05, ctx.currentTime, 1.2);
      this.drone = { o, o2, g };
    } else if (mood !== 'caldera' && this.drone) {
      const d = this.drone; this.drone = null;
      d.g.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
      d.o.stop(ctx.currentTime + 4); d.o2.stop(ctx.currentTime + 4);
    }
  }

  setLevel(n) { this.level = n; }

  schedule() {
    const ctx = audio.ctx;
    const M = MOODS[this.mood];
    const sixteenth = 60 / M.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, M, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  pluck(t, f, g = 0.07, dur = 0.5) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), gn = ctx.createGain(), gn2 = ctx.createGain();
    o.frequency.value = f; o2.frequency.value = f * 4;
    audio.env(gn.gain, t, 0.003, g, dur);
    audio.env(gn2.gain, t, 0.002, g * 0.3, dur * 0.2);
    o.connect(gn).connect(this.bus); o2.connect(gn2).connect(this.bus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur * 0.3 + 0.1);
  }

  pad(t, chord, dur) {
    const ctx = audio.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = this.mood === 'caldera' ? 700 : 1000; f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 0.9);
    g.gain.setValueAtTime(0.022, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    f.connect(g).connect(this.bus);
    for (const s of chord) for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = N(s - 12); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.3);
    }
  }

  bass(t, semi, dur) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = N(semi - 24);
    audio.env(g.gain, t, 0.01, 0.09, dur);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.1);
  }

  perc(t, kind) {
    const ctx = audio.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      audio.env(g.gain, t, 0.002, 0.25, 0.16);
      o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.25);
    } else {
      const s = audio.noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      const snare = kind === 'snare';
      f.type = snare ? 'bandpass' : 'highpass'; f.frequency.value = kind === 'shaker' ? 6000 : snare ? 1800 : 3000;
      audio.env(g.gain, t, 0.002, kind === 'shaker' ? 0.025 : snare ? 0.09 : 0.05, snare ? 0.12 : 0.04);
      s.connect(f).connect(g).connect(this.bus); s.start(t); s.stop(t + (snare ? 0.2 : 0.08));
    }
  }

  playStep(step, t, M, sixteenth) {
    const bar = Math.floor(step / 16), inBar = step % 16;
    const chord = M.chords[Math.floor(bar / 2) % M.chords.length];
    if (inBar === 0 && bar % 2 === 0) this.pad(t, chord, sixteenth * 32);
    if (inBar === 0 || inBar === 8) this.bass(t, chord[0], sixteenth * 6);
    if (inBar === 10 && this.rand() < 0.5) this.bass(t, chord[2], sixteenth * 3);
    // Marimba: arpeggio on 8ths with musical rests.
    if (inBar % 2 === 0 && this.rand() < (inBar % 4 === 0 ? 0.85 : 0.5)) {
      const pool = this.rand() < 0.6 ? chord.map((c) => c + 12) : M.scale.map((c) => c + 12);
      const n = pool[Math.floor(this.rand() * pool.length)];
      this.pluck(t, N(n), 0.055 + this.rand() * 0.03, 0.45);
    }
    if (this.mood === 'caldera' && inBar % 4 === 0) this.perc(t, inBar === 0 ? 'kick' : 'shaker');
    else if (inBar % 4 === 2) this.perc(t, 'shaker');
    if (this.level >= 1 && (inBar === 0 || inBar === 6 || inBar === 8)) this.perc(t, 'kick');
    // Combat layers (La Prueba de Fuego): 2 = snare backbeat + driving 8th bass, 3 = 16th hats + a
    // second kick and an octave bass stab (the boss).
    if (this.level >= 2) {
      if (inBar === 4 || inBar === 12) this.perc(t, 'snare');
      if (inBar % 2 === 1) this.bass(t, chord[0] + (inBar % 4 === 3 ? 12 : 0), sixteenth * 0.9);
    }
    if (this.level >= 3) {
      if (inBar % 2 === 1) this.perc(t, 'shaker');
      if (inBar === 14 || inBar === 11) this.perc(t, 'kick');
      if (inBar === 0 && bar % 2 === 1) this.bass(t, chord[1] + 12, sixteenth * 2);
    }
  }
}

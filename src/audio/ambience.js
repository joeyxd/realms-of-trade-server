// Zone-mixed ambience: waves, wind, birds (FM chirps), jungle insects, lava rumble + crackles.
import { audio } from './engine.js';

const MIX = {
  playa: { waves: 1.0, foam: 0.8, wind: 0.5, birds: 0.6, insects: 0.0, lava: 0 },
  aldea: { waves: 0.55, foam: 0.3, wind: 0.35, birds: 1.0, insects: 0.2, lava: 0 },
  camino: { waves: 0.2, foam: 0.05, wind: 0.6, birds: 0.9, insects: 0.8, lava: 0.05 },
  selva: { waves: 0.25, foam: 0.1, wind: 0.6, birds: 1.0, insects: 1.0, lava: 0 },
  caldera: { waves: 0.05, foam: 0, wind: 0.8, birds: 0.0, insects: 0.0, lava: 1.0 },
  mar: { waves: 1.0, foam: 1.0, wind: 0.8, birds: 0.4, insects: 0, lava: 0 },
  title: { waves: 0.8, foam: 0.5, wind: 0.5, birds: 0.5, insects: 0.2, lava: 0 },
};

export class Ambience {
  constructor() { this.started = false; this.mix = MIX.title; this.nextBird = 0; this.nextCrackle = 0; }

  start() {
    if (this.started || !audio.ready) return;
    this.started = true;
    const ctx = audio.ctx, out = audio.ambience;
    const layer = (filterType, f, q) => {
      const src = audio.noiseSource();
      const flt = ctx.createBiquadFilter();
      flt.type = filterType; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(flt).connect(g).connect(out);
      src.start();
      return { src, flt, g };
    };
    this.waves = layer('lowpass', 520, 0.6);
    this.foam = layer('bandpass', 2600, 0.5);
    this.wind = layer('bandpass', 420, 0.4);
    this.insects = layer('bandpass', 6200, 6);
    this.lava = layer('lowpass', 110, 0.8);
    // Slow swells for the waves and the wind.
    const lfo = (freq, depth, param) => {
      const o = ctx.createOscillator(); o.frequency.value = freq;
      const d = ctx.createGain(); d.gain.value = depth;
      o.connect(d).connect(param); o.start();
      return o;
    };
    this.wavesAmp = ctx.createGain(); this.wavesAmp.gain.value = 0.5;
    this.waves.g.disconnect(); this.waves.g.connect(this.wavesAmp).connect(out);
    lfo(0.11, 0.42, this.wavesAmp.gain);
    lfo(0.07, 260, this.wind.flt.frequency);
    this.insAmp = ctx.createGain(); this.insAmp.gain.value = 0.5;
    this.insects.g.disconnect(); this.insects.g.connect(this.insAmp).connect(out);
    lfo(17, 0.5, this.insAmp.gain);
    this.setZone('title', 0.1);
  }

  setZone(zone, time = 2) {
    this.mix = MIX[zone] || MIX.selva;
    if (!this.started) return;
    const t = audio.now, k = time / 3;
    const m = this.mix;
    this.waves.g.gain.setTargetAtTime(0.55 * m.waves, t, k);
    this.foam.g.gain.setTargetAtTime(0.07 * m.foam, t, k);
    this.wind.g.gain.setTargetAtTime(0.16 * m.wind, t, k);
    this.insects.g.gain.setTargetAtTime(0.018 * m.insects, t, k);
    this.lava.g.gain.setTargetAtTime(0.5 * m.lava, t, k);
  }

  chirp(t) {
    const ctx = audio.ctx;
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const base = 2200 + Math.random() * 1800;
    car.frequency.setValueAtTime(base, t);
    car.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), t + 0.06);
    car.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
    mod.frequency.value = 40 + Math.random() * 60;
    mg.gain.value = base * 0.15;
    mod.connect(mg).connect(car.frequency);
    audio.env(g.gain, t, 0.01, 0.05 + Math.random() * 0.04, 0.12);
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; car.connect(g).connect(pan).connect(audio.ambience); }
    else car.connect(g).connect(audio.ambience);
    car.start(t); mod.start(t); car.stop(t + 0.2); mod.stop(t + 0.2);
  }

  update() {
    if (!this.started) return;
    const t = audio.now;
    if (this.mix.birds > 0 && t > this.nextBird) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.chirp(t + 0.02 + i * 0.13);
      this.nextBird = t + (0.8 + Math.random() * 3.5) / this.mix.birds;
    }
    if (this.mix.lava > 0 && t > this.nextCrackle) {
      const ctx = audio.ctx;
      const src = audio.noiseSource();
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
      const g = ctx.createGain();
      audio.env(g.gain, t, 0.002, 0.06 * this.mix.lava, 0.03);
      src.connect(f).connect(g).connect(audio.ambience);
      src.start(t); src.stop(t + 0.06);
      this.nextCrackle = t + 0.05 + Math.random() * 0.35;
    }
  }
}

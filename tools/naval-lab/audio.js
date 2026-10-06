import { audio as sharedAudio } from '../../src/audio/engine.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

function normalizeEvent(kind) {
  const value = String(kind || '').toLowerCase().replace(/[^a-z]/g, '');
  if (value.includes('perfect')) return 'perfect';
  if (value.includes('captur') || value.includes('success')) return 'capture';
  if (value.includes('miss') || value.includes('early') || value.includes('angle')) return 'miss';
  if (value.includes('window')) return 'window';
  if (value.includes('approach') || value.includes('warning')) return 'approach';
  return null;
}

/** Gesture-gated audio feedback for the standalone naval lab. Uses the shared Web Audio engine. */
export class NavalLabAudio {
  constructor({ mobile = false, engine = sharedAudio } = {}) {
    this.mobile = !!mobile;
    this.engine = engine;
    this.enabled = true;
    this.paused = false;
    this.disposed = false;
    this.graph = null;
    this.unlocking = null;
    this.active = new Set();
    this.lastEvent = new Map();
    this.played = { approach: 0, window: 0, capture: 0, perfect: 0, miss: 0 };
    this.lastMix = { wind: 0, water: 0 };
  }

  unlock() {
    if (this.disposed) return Promise.resolve(false);
    if (this.unlocking) return this.unlocking;
    try {
      const ctx = this.engine.unlock();
      if (!ctx) return Promise.resolve(false);
      this.unlocking = Promise.resolve(ctx.state === 'suspended' ? ctx.resume() : undefined)
        .then(() => {
          if (!this.disposed && this.engine.ready && !this.graph) this.createLoop();
          return !!this.graph;
        })
        .catch(() => false)
        .finally(() => { this.unlocking = null; });
      return this.unlocking;
    } catch { return Promise.resolve(false); }
  }

  createLoop() {
    const audio = this.engine, ctx = audio.ctx;
    if (!ctx || this.graph || this.disposed) return;
    // One shared noise source drives wind, water, and turning strain; mobile adds no ambience source.
    const source = audio.noiseSource();
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'lowpass'; waterFilter.frequency.value = 560; waterFilter.Q.value = 0.45;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 780; windFilter.Q.value = 0.45;
    const turnFilter = ctx.createBiquadFilter();
    turnFilter.type = 'bandpass'; turnFilter.frequency.value = 185; turnFilter.Q.value = 1.1;
    const waterGain = ctx.createGain(); waterGain.gain.value = 0;
    const windGain = ctx.createGain(); windGain.gain.value = 0;
    const turnGain = ctx.createGain(); turnGain.gain.value = 0;
    const bus = ctx.createGain(); bus.gain.value = 0.7;
    const eventBus = ctx.createGain(); eventBus.gain.value = this.enabled && !this.paused && !audio.vol.muted ? 1 : 0;
    source.connect(waterFilter).connect(waterGain).connect(bus);
    source.connect(windFilter).connect(windGain).connect(bus);
    source.connect(turnFilter).connect(turnGain).connect(bus);
    bus.connect(audio.ambience);
    eventBus.connect(audio.sfx);
    source.start();
    this.graph = { source, waterFilter, windFilter, turnFilter, waterGain, windGain, turnGain, bus, eventBus };
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.applyMix(0, 0);
  }

  applyMix(wind, water, speed = 0, turnStress = 0, turn = 0) {
    const graph = this.graph;
    const audio = this.engine;
    if (!graph || !audio.ready) return;
    const silent = !this.enabled || this.paused || audio.vol.muted;
    const t = audio.now;
    const k = 0.08;
    graph.windGain.gain.setTargetAtTime(silent ? 0 : clamp(wind, 0, 0.055), t, k);
    graph.waterGain.gain.setTargetAtTime(silent ? 0 : clamp(water, 0, 0.04), t, k);
    graph.turnGain.gain.setTargetAtTime(silent ? 0 : clamp(turnStress, 0, 0.008), t, k);
    graph.windFilter.frequency.setTargetAtTime(520 + clamp(speed, 0, 1) * 760, t, 0.12);
    graph.waterFilter.frequency.setTargetAtTime(360 + clamp(speed, 0, 1) * 720, t, 0.16);
    graph.turnFilter.frequency.setTargetAtTime(145 + clamp(speed, 0, 1) * 105 + clamp(turn, 0, 1) * 95, t, 0.1);
    graph.eventBus.gain.setTargetAtTime(silent ? 0 : 1, t, k);
    this.lastMix = { wind: silent ? 0 : clamp(wind, 0, 0.055), water: silent ? 0 : clamp(water, 0, 0.04) };
  }

  update({ state, rig, gust, activity, current = false, paused = false } = {}) {
    if (this.disposed) return;
    this.paused = !!paused;
    if (!state || !rig || !this.graph) { this.applyMix(0, 0); return; }
    const speed = Math.hypot(Number(state.vx) || 0, Number(state.vz) || 0);
    const speedK = clamp(speed / 11, 0, 1);
    const turnK = clamp(Math.abs(Number(state.omega) || 0) / 1.3, 0, 1);
    const phase = String(gust?.phase || '').toLowerCase();
    const approaching = ['approach', 'warning', 'ready', 'window'].includes(phase);
    const gustK = approaching ? 0.22 : phase === 'active' ? 0.48 : 0;
    const currentK = current && typeof current === 'object'
      ? clamp(Math.hypot(Number(current.vx ?? current.x) || 0, Number(current.vz ?? current.z) || 0) / 3, 0, 1)
      : current ? 0.35 : 0;
    const multiplier = Number(activity?.multiplier);
    const boost = Number.isFinite(multiplier) ? clamp((multiplier - 1) / 1.5, 0, 1) : 0;
    const wind = 0.006 + speedK * 0.009 + gustK * 0.023 + boost * 0.012;
    const chop = 0.9 + 0.1 * Math.sin(this.engine.now * (3 + speedK * 8));
    const water = (0.004 + speedK * 0.017 + turnK * 0.008 + currentK * 0.006) * chop;
    // A restrained low band suggests hull strain only when the boat is both moving and turning.
    const turnStress = speedK * turnK * 0.007;
    this.applyMix(wind, water, speedK, turnStress, turnK);
  }

  event(kind) {
    const audio = this.engine;
    if (this.disposed || !this.enabled || this.paused || !audio.ready || !audio.ctx || audio.vol.muted) return false;
    const type = normalizeEvent(kind);
    if (!type || !this.graph || this.active.size >= 3) return false;
    const ctx = audio.ctx, now = audio.now;
    const last = this.lastEvent.get(type) ?? -Infinity;
    if (now - last < 0.14) return false;
    this.lastEvent.set(type, now);

    const profile = {
      approach: { duration: 0.2, f0: 420, f1: 760, noise: 0.006, cutoff: 1500, tone: 'sine', toneGain: 0.035 },
      window: { duration: 0.14, f0: 880, f1: 1320, noise: 0.003, cutoff: 2300, tone: 'sine', toneGain: 0.05 },
      capture: { duration: 0.22, f0: 170, f1: 310, noise: 0.045, cutoff: 2100, tone: 'triangle', toneGain: 0.075 },
      perfect: { duration: 0.28, f0: 210, f1: 460, noise: 0.065, cutoff: 2800, tone: 'triangle', toneGain: 0.11 },
      miss: { duration: 0.12, f0: 210, f1: 150, noise: 0.009, cutoff: 850, tone: 'sine', toneGain: 0.018 },
    }[type];
    const event = { nodes: [], remaining: 0, done: false };
    const finishNode = (node) => {
      node.onended = () => {
        try { node.disconnect(); } catch {}
        event.remaining--;
        if (event.remaining <= 0) {
          for (const resource of event.nodes) { try { resource.disconnect(); } catch {} }
          event.done = true; this.active.delete(event);
        }
      };
      event.nodes.push(node); event.remaining++;
    };

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = profile.tone;
    osc.frequency.setValueAtTime(profile.f0, now);
    osc.frequency.exponentialRampToValueAtTime(profile.f1, now + profile.duration * 0.82);
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(profile.toneGain, now + 0.012);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);
    osc.connect(oscGain).connect(this.graph.eventBus);
    finishNode(osc);
    event.nodes.push(oscGain);
    osc.start(now); osc.stop(now + profile.duration + 0.03);

    if (profile.noise > 0) {
      const source = audio.noiseSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = 'bandpass'; filter.frequency.setValueAtTime(profile.cutoff * 0.55, now);
      filter.frequency.exponentialRampToValueAtTime(profile.cutoff, now + profile.duration * 0.6);
      filter.Q.value = 0.55;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(profile.noise, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);
      source.connect(filter).connect(gain).connect(this.graph.eventBus);
      finishNode(source);
      source.start(now); source.stop(now + profile.duration + 0.04);
      source.onended = () => {
        for (const node of [filter, gain]) { try { node.disconnect(); } catch {} }
        try { source.disconnect(); } catch {}
        event.remaining--;
        if (event.remaining <= 0) {
          for (const resource of event.nodes) { try { resource.disconnect(); } catch {} }
          event.done = true; this.active.delete(event);
        }
      };
      event.nodes.push(filter, gain);
    }
    this.active.add(event);
    this.played[type]++;
    return true;
  }

  diagnostics() {
    return { unlocked: !!this.graph, enabled: this.enabled, paused: this.paused, mobile: this.mobile, ambienceSources: this.graph ? 1 : 0,
      activeOneShots: this.active.size, maxOneShots: 3, played: { ...this.played }, mix: { ...this.lastMix }, disposed: this.disposed };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const graph = this.graph;
    this.graph = null;
    if (graph) {
      try { graph.source.stop(); } catch {}
      for (const node of [graph.source, graph.waterFilter, graph.windFilter, graph.turnFilter, graph.waterGain, graph.windGain, graph.turnGain, graph.bus, graph.eventBus]) {
        try { node.disconnect(); } catch {}
      }
    }
    for (const event of this.active) {
      event.done = true;
      for (const node of event.nodes) {
        try { node.stop?.(); } catch {}
        try { node.disconnect(); } catch {}
      }
    }
    this.active.clear(); this.lastEvent.clear();
  }
}

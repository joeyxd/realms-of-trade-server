import { audio as sharedAudio } from '../audio/engine.js';
import { WW_ANGLE, WW_FRAME_TICKS, WW_SPEED } from '../data/navalHandling.js';
import { NAVAL_CAMERA } from '../data/navalCamera.js';
import { NAVAL_TRIAL } from '../data/navalTrial.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

// Wind Waker's ship cues (research/wind-waker/02-camara-controles-vela.md:79-86; SH = d_a_ship.cpp): the triggers
// are WW's, the voices are our own synth.
const WW_SOUND = Object.freeze({
  cruise: 55 * WW_SPEED, // the cruise loop's volume is |v| / 55 (SH:4015-4022)
  sailOn: 7, // the mast anim frame where the sail is ON (SH:1591-1593)
  rudderSame: 420, rudderReverse: 525, // RUDDER_OUT when the tiller moves more than this in a WW frame (SH:4002-4012)
  rudderGap: 0.35, // ours: at most one creak per 0.35 s
  boomDelay: 0.3, // SAIL_MOVE sounds as the boom crosses 0 (SH:763-768), ~9 WW frames after the side flips
});

function normalizeEvent(kind) {
  const value = String(kind || '').toLowerCase().replace(/[^a-z]/g, '');
  if (['sailout', 'sailin', 'boom', 'rudder', 'alight'].includes(value)) return value;
  if (value.includes('impact') || value.includes('destroy')) return 'impact';
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
    this.played = { approach: 0, window: 0, capture: 0, perfect: 0, miss: 0, impact: 0, sailout: 0, sailin: 0, boom: 0, rudder: 0, alight: 0 };
    this.lastMix = { wind: 0, water: 0 };
    this.cues = null;
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
    if (!state || !rig || !this.graph) { this.cues = null; this.applyMix(0, 0); return; }
    this.cue(state);
    const speed = Math.hypot(Number(state.vx) || 0, Number(state.vz) || 0);
    const speedK = clamp(speed / WW_SOUND.cruise, 0, 1);
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

  // WW cues from the body state: hoist and lower (mast), the boom changing side, the tiller creak, the landing splash.
  cue(state) {
    const prev = this.cues, mast = Number(state.mast) || 0, fly = state.fly ? 1 : 0, tick = Number(state.tick) || 0;
    const rel = Math.atan2(Math.sin(NAVAL_TRIAL.wind.yaw - state.yaw), Math.cos(NAVAL_TRIAL.wind.yaw - state.yaw)) / WW_ANGLE;
    let side = prev?.side ?? (rel >= 0 ? -1 : 1);
    if (rel > NAVAL_CAMERA.sailHysteresis) side = -1;
    else if (rel < -NAVAL_CAMERA.sailHysteresis) side = 1;
    const ticked = !prev || tick !== prev.tick;
    this.cues = { mast, side, fly, tick, helm: ticked ? Number(state.helm) || 0 : prev.helm,
      vy: fly ? Number(state.vy) || 0 : prev?.vy ?? 0, creak: prev?.creak ?? -Infinity };
    if (!prev) return;
    if (mast > 0 && prev.mast <= 0) this.event('sailout');
    else if (mast <= 0 && prev.mast > 0) this.event('sailin');
    if (side !== prev.side && mast >= WW_SOUND.sailOn) this.event('boom', { delay: WW_SOUND.boomDelay });
    if (ticked && tick > prev.tick && this.engine.now - prev.creak >= WW_SOUND.rudderGap) {
      const helm = this.cues.helm, step = Math.abs(helm - prev.helm) / WW_ANGLE * WW_FRAME_TICKS / (tick - prev.tick);
      const reverse = helm * prev.helm < 0;
      if (step > (reverse ? WW_SOUND.rudderReverse : WW_SOUND.rudderSame) && this.event('rudder')) this.cues.creak = this.engine.now;
    }
    // JUMP_ALIGHT (SH:2947-2959) at the splash rate clamp(10 + 50 * -(vy + 15) / 30, 10, 60), vy in WW u/frame.
    if (prev.fly && !fly) this.event('alight', { gain: clamp(10 + 50 * -(prev.vy / WW_SPEED + 15) / 30, 10, 60) / 60 });
  }

  event(kind, { gain = 1, delay = 0 } = {}) {
    const audio = this.engine;
    if (this.disposed || !this.enabled || this.paused || !audio.ready || !audio.ctx || audio.vol.muted) return false;
    const type = normalizeEvent(kind);
    if (!type || !this.graph || this.active.size >= 3) return false;
    const ctx = audio.ctx, last = this.lastEvent.get(type) ?? -Infinity;
    if (audio.now - last < 0.14) return false;
    this.lastEvent.set(type, audio.now);
    const now = audio.now + clamp(delay, 0, 1), level = clamp(gain, 0.05, 1);

    const profile = {
      impact: { duration: 0.25, f0: 125, f1: 48, noise: 0.075, cutoff: 1250, tone: 'triangle', toneGain: 0.1 },
      approach: { duration: 0.2, f0: 420, f1: 760, noise: 0.006, cutoff: 1500, tone: 'sine', toneGain: 0.035 },
      window: { duration: 0.14, f0: 880, f1: 1320, noise: 0.003, cutoff: 2300, tone: 'sine', toneGain: 0.05 },
      capture: { duration: 0.22, f0: 170, f1: 310, noise: 0.045, cutoff: 2100, tone: 'triangle', toneGain: 0.075 },
      perfect: { duration: 0.28, f0: 210, f1: 460, noise: 0.065, cutoff: 2800, tone: 'triangle', toneGain: 0.11 },
      miss: { duration: 0.12, f0: 210, f1: 150, noise: 0.009, cutoff: 850, tone: 'sine', toneGain: 0.018 },
      sailout: { duration: 0.34, f0: 150, f1: 92, noise: 0.07, cutoff: 2400, tone: 'triangle', toneGain: 0.06 },
      sailin: { duration: 0.3, f0: 120, f1: 80, noise: 0.045, cutoff: 1300, tone: 'triangle', toneGain: 0.04 },
      boom: { duration: 0.14, f0: 230, f1: 150, noise: 0.05, cutoff: 2200, tone: 'triangle', toneGain: 0.07 },
      rudder: { duration: 0.2, f0: 96, f1: 74, noise: 0.012, cutoff: 700, tone: 'sawtooth', toneGain: 0.022 },
      alight: { duration: 0.5, f0: 92, f1: 40, noise: 0.11, cutoff: 1500, tone: 'sine', toneGain: 0.09 },
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
    oscGain.gain.exponentialRampToValueAtTime(profile.toneGain * level, now + 0.012);
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
      gain.gain.exponentialRampToValueAtTime(profile.noise * level, now + 0.018);
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

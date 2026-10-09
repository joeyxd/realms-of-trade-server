// Short wood impacts, leaf rustle and stone clacks share the existing SFX volume bus.
import { audio } from './engine.js';

function burst(t, frequency, duration, gain) {
  const source = audio.noiseSource(), filter = audio.ctx.createBiquadFilter(), envelope = audio.ctx.createGain();
  filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = 1.3;
  audio.env(envelope.gain, t, .004, gain, duration);
  source.connect(filter).connect(envelope).connect(audio.sfx);
  source.start(t); source.stop(t + duration + .05);
}

function knock(t, frequency, duration, gain) {
  const oscillator = audio.ctx.createOscillator(), envelope = audio.ctx.createGain();
  oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, t);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * .45, t + duration);
  audio.env(envelope.gain, t, .003, gain, duration);
  oscillator.connect(envelope).connect(audio.sfx); oscillator.start(t); oscillator.stop(t + duration + .05);
}

export function harvestSound(event, distance = 0) {
  if (!audio.ready || !Number.isFinite(distance) || distance > 22) return;
  const volume = Math.max(0, 1 - distance / 22), t = audio.now;
  if (event.kind === 'palm') {
    knock(t, 195, .13, .25 * volume); burst(t, 1250, .09, .32 * volume);
    burst(t + .03, 3300, .21, .10 * volume);
    if (event.felled) {
      // Delayed cracking/rustle follows the visual fall, without a persistent audio loop.
      burst(t + .22, 650, .35, .25 * volume);
      burst(t + .54, 1800, .35, .19 * volume);
      knock(t + .65, 90, .22, .23 * volume);
    }
  } else if (event.kind === 'iron_ore') {
    knock(t, 1240, .07, .16 * volume); burst(t, 4100, .055, .17 * volume);
    knock(t + .018, 760, .045, .08 * volume);
  } else if (event.kind === 'rock') {
    knock(t, 710, .10, .20 * volume); burst(t, 1900, .09, .18 * volume);
  } else {
    knock(t, event.kind === 'stone' ? 950 : 180, .08, .14 * volume);
    burst(t, event.kind === 'stone' ? 2600 : 1300, .07, .13 * volume);
  }
}

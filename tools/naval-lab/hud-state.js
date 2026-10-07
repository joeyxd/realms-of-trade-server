import { NAVAL_NAVIGATION as N } from '../../src/data/navalNavigation.js';
import { NAVAL_STEP } from '../../src/data/navalHandling.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeDegrees = (radians) => ((finiteOr(radians) * 180 / Math.PI % 360) + 360) % 360;
const directionDegrees = (x, z) => normalizeDegrees(Math.atan2(x, z));
const oneDecimal = (value) => finiteOr(value).toFixed(1);

const RESULT_TEXT = Object.freeze({
  perfect: '¡PERFECTO! La vela ruge.',
  capture: '¡Ráfaga atrapada! Sigue dando vela.',
  early: 'Demasiado pronto. Espera la siguiente.',
  angle: 'Orienta la proa a favor del viento.',
  miss: 'Abre la vela y suelta el freno.',
});

/** Build display-only values from the current deterministic lab tick. */
export function navalHudState({ state, rig, wind, gust, activity, current, paused = false,
  gusts = true, currents = true, cargoCount = 0 } = {}) {
  const vx = finiteOr(state?.vx), vz = finiteOr(state?.vz), speed = Math.hypot(vx, vz);
  const headingDegrees = normalizeDegrees(state?.yaw);
  const heading = Math.round(headingDegrees) % 360;
  const tick = Number.isSafeInteger(state?.tick) ? state.tick : 0;
  const windStrength = finiteOr(wind?.strength);
  const currentStrength = finiteOr(current?.strength);
  const currentX = finiteOr(current?.x), currentZ = finiteOr(current?.z);
  const attempted = Number.isSafeInteger(gust?.id) && activity?.lastAttempt === gust.id;
  const boostTicks = Math.max(0, finiteOr(activity?.boostUntil) - tick);
  const boostSeconds = boostTicks * NAVAL_STEP;
  const boostActive = boostTicks > 0;
  const resultIsLive = Boolean(activity?.result) && tick < finiteOr(activity?.resultUntil);
  const resultText = resultIsLive ? (RESULT_TEXT[activity.result] || '') : '';
  const captureDisabled = Boolean(paused || !gusts || !(windStrength > 0) || attempted);
  const phase = gust?.phase || 'idle';
  const gustProgress = clamp01(gust?.progress);
  const currentVisible = currents && currentStrength > 0.15;
  const windDegrees = windStrength > 0 ? normalizeDegrees(wind?.yaw) : null;
  const currentDegrees = currentVisible && (currentX !== 0 || currentZ !== 0)
    ? directionDegrees(currentX, currentZ) : null;
  const remaining = Math.max(0, finiteOr(gust?.remaining));
  const trackSpan = N.windowStart + N.windowTicks - N.announcementTick;
  const trackMark = (tick) => clamp01((tick - N.announcementTick) / trackSpan);
  const gustMarks = {
    approach: trackMark(N.windowStart),
    windowStart: trackMark(N.windowStart),
    windowEnd: trackMark(N.windowStart + N.windowTicks),
    perfectStart: trackMark(N.windowStart + N.windowTicks / 2 - N.perfectTicks),
    perfectEnd: trackMark(N.windowStart + N.windowTicks / 2 + N.perfectTicks),
  };
  const gustText = !gusts || !(windStrength > 0) ? 'Sin ráfagas' : boostActive
    ? `¡VELA CARGADA! ${oneDecimal(boostSeconds)} s`
    : phase === 'window' ? (attempted ? 'Ráfaga resuelta' : '¡AHORA! CAZA LA RÁFAGA')
      : phase === 'approach' ? `Prepara la vela · ${oneDecimal(remaining)} s`
        : `Próxima ráfaga · ${Math.ceil(remaining)} s`;
  const flowText = !currents ? 'Corrientes apagadas'
    : currentVisible ? `CORRIENTE · ${oneDecimal(currentStrength)} u/s` : 'Busca las flechas de agua';

  let calloutText = '', calloutTone = '', calloutDetail = '';
  if (resultIsLive && activity.result === 'perfect') {
    calloutText = '¡PERFECTO!'; calloutTone = 'gold';
    if (boostActive) calloutDetail = `${oneDecimal(boostSeconds)} s`;
  } else if (resultIsLive && activity.result === 'capture') {
    calloutText = '¡RÁFAGA CAZADA!'; calloutTone = 'mint';
    if (boostActive) calloutDetail = `${oneDecimal(boostSeconds)} s`;
  } else if (boostActive) {
    calloutText = 'VELA CARGADA'; calloutTone = 'mint'; calloutDetail = `${oneDecimal(boostSeconds)} s`;
  } else if (currentVisible) {
    calloutText = 'CORRIENTE ACTIVA'; calloutTone = 'cyan'; calloutDetail = `${oneDecimal(currentStrength)} u/s`;
  }

  return {
    speed, speedText: oneDecimal(speed), speedFraction: clamp01(speed / N.boostMaxSpeed),
    heading, headingText: String(heading).padStart(3, '0'), headingDegrees,
    windDegrees, currentDegrees,
    boostSeconds, boostFraction: clamp01(boostTicks / N.boostTicks), boostActive,
    loadPercent: Number.isFinite(rig?.load) ? Math.round(rig.load * 100) : null,
    cargoMass: Number.isFinite(rig?.cargoMass) ? rig.cargoMass : null,
    cargoCount: Number.isFinite(cargoCount) ? Math.max(0, Math.floor(cargoCount)) : 0,
    captureDisabled, captureReady: !captureDisabled && phase === 'window',
    gustProgress, gustMarks, gustText, flowText, resultText,
    calloutText, calloutTone, calloutDetail,
  };
}

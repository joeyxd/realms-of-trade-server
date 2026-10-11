import { NAVAL_NAVIGATION as N } from '../data/navalNavigation.js';
import { NAVAL_STEP } from '../data/navalHandling.js';
import { t } from '../core/i18n.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeDegrees = (radians) => ((finiteOr(radians) * 180 / Math.PI % 360) + 360) % 360;
const directionDegrees = (x, z) => normalizeDegrees(Math.atan2(x, z));
const oneDecimal = (value) => finiteOr(value).toFixed(1);

/** Only label the owner's capacity as current when plan, profile and voyage agree. */
export function confirmedNavalCapacity(client, raft, voyage = client?.voyage || {}) {
  const capacity = client?.capacity, eco = client?.profile?.eco;
  const ship = eco?.ships?.find((s) => s.kind === 'raft' && s.id === raft?.id);
  const mode = voyage.active && voyage.phase === 'shore' ? 'reboard' : client?.naval?.active ? 'sailing' : 'port';
  if (!capacity || !ship || capacity.id !== raft?.id || (voyage.shipId && voyage.shipId !== capacity.id)
    || capacity.raftRev !== raft.rev || capacity.raftRev !== ship.rev || capacity.tradeRev !== eco.tradeRev
    || capacity.mode !== mode || !['freeMass', 'overMass', 'holdVolume', 'holdCap'].every((key) => Number.isFinite(capacity[key]) && capacity[key] >= 0)) return null;
  return capacity;
}

const RESULT_TEXT = Object.freeze({
  perfect: () => t('systems.naval.result.perfect'),
  capture: () => t('systems.naval.gust.caught'),
  early: () => t('systems.naval.result.early'),
  angle: () => t('systems.naval.result.angle'),
  miss: () => t('systems.naval.result.miss'),
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
  const resultText = resultIsLive ? (RESULT_TEXT[activity.result]?.() || '') : '';
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
  const gustText = !gusts || !(windStrength > 0) ? t('systems.naval.gust.none') : boostActive
    ? t('systems.naval.gust.boost', { seconds: oneDecimal(boostSeconds) })
    : phase === 'window' ? (attempted ? t('systems.naval.gust.resolved') : t('systems.naval.gust.now'))
      : phase === 'approach' ? t('systems.naval.gust.prepare', { seconds: oneDecimal(remaining) })
        : t('systems.naval.gust.next', { seconds: Math.ceil(remaining) });
  const flowText = !currents ? t('systems.naval.flow.off')
    : currentVisible ? t('systems.naval.flow.current', { speed: oneDecimal(currentStrength) }) : t('systems.naval.flow.seek');

  let calloutText = '', calloutTone = '', calloutDetail = '';
  if (resultIsLive && activity.result === 'perfect') {
    calloutText = t('systems.naval.result.perfectShort'); calloutTone = 'gold';
    if (boostActive) calloutDetail = `${oneDecimal(boostSeconds)} s`;
  } else if (resultIsLive && activity.result === 'capture') {
    calloutText = t('systems.naval.gust.callout'); calloutTone = 'mint';
    if (boostActive) calloutDetail = `${oneDecimal(boostSeconds)} s`;
  } else if (boostActive) {
    calloutText = t('systems.naval.gust.boostLabel'); calloutTone = 'mint'; calloutDetail = `${oneDecimal(boostSeconds)} s`;
  } else if (currentVisible) {
    calloutText = t('systems.naval.flow.active'); calloutTone = 'cyan'; calloutDetail = `${oneDecimal(currentStrength)} u/s`;
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

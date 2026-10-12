// Pure presentation state for the two independently firing pistol hands.
// Recoil weights stay normalized for the pose easing; amplitude controls the visible kick.
export const PISTOL_RECOIL = Object.freeze({
  quick: Object.freeze({ amplitude: 1, duration: 0.18 }),
  powerful: Object.freeze({ amplitude: 1.45, duration: 0.42 }),
});

const INITIAL = Object.freeze({
  recoilL: 0, recoilR: 0,
  recoilLAmp: 1, recoilRAmp: 1,
  recoilLDecay: 1 / PISTOL_RECOIL.quick.duration,
  recoilRDecay: 1 / PISTOL_RECOIL.quick.duration,
});

const clamp01 = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

function snapshot(state) {
  const source = state && typeof state === 'object' ? state : INITIAL;
  return {
    recoilL: clamp01(source.recoilL),
    recoilR: clamp01(source.recoilR),
    recoilLAmp: positive(source.recoilLAmp, 1),
    recoilRAmp: positive(source.recoilRAmp, 1),
    recoilLDecay: positive(source.recoilLDecay, 1 / PISTOL_RECOIL.quick.duration),
    recoilRDecay: positive(source.recoilRDecay, 1 / PISTOL_RECOIL.quick.duration),
  };
}

export function createPistolRecoil() {
  return { ...INITIAL };
}

// Return the next recoil state for a shot. Hand +1 is quick/left; hand -1 is powerful/right.
export function kickPistolRecoil(state, hand, secondary = false) {
  const next = snapshot(state);
  if (!Number.isFinite(hand) || hand === 0) return next;
  const side = hand < 0 ? 'R' : 'L';
  const profile = secondary ? PISTOL_RECOIL.powerful : PISTOL_RECOIL.quick;
  next[`recoil${side}`] = 1;
  next[`recoil${side}Amp`] = profile.amplitude;
  next[`recoil${side}Decay`] = 1 / profile.duration;
  return next;
}

// Return the next state after presentation time; invalid or negative time cannot poison the pose.
export function stepPistolRecoil(state, dt) {
  const next = snapshot(state);
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  for (const side of ['L', 'R']) {
    const weightKey = `recoil${side}`;
    const ampKey = `recoil${side}Amp`;
    const decayKey = `recoil${side}Decay`;
    next[weightKey] = Math.max(0, next[weightKey] - elapsed * next[decayKey]);
    if (next[weightKey] === 0) {
      next[ampKey] = 1;
      next[decayKey] = 1 / PISTOL_RECOIL.quick.duration;
    }
  }
  return next;
}

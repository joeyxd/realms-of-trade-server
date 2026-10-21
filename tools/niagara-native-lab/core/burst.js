import { spawnUpdateDt } from './spawn-rate.js';
const f32 = Math.fround;
// EmitterState in Once mode (system update script): the looped age advances by delta; reaching the loop
// duration resets it to 0 and makes the emitter Inactive (EmitterChangeState, NewState 1) for good.
// Returns whether the emitter is still active, i.e. may spawn in this tick.
export function emitterStateOnce(state, delta, loopDuration) {
  const looped = f32(delta + state.loopedAge);
  if (looped >= loopDuration) { state.loopedAge = 0; state.active = false; } else state.loopedAge = looped;
  return state.active;
}
// SpawnBurst_Instantaneous: fires when SpawnTime lies in [LoopedAge - delta, LoopedAge); the spawn info
// carries InterpStartDt = SpawnTime - (LoopedAge - delta) and IntervalDt 0.
export function burstWindow(spawnTime, loopedAge, delta) {
  const interpStartDt = f32(spawnTime - f32(loopedAge - delta));
  return { fires: interpStartDt >= 0 && f32(spawnTime - loopedAge) < 0, interpStartDt };
}
// Update time of a burst birth, in (0, dt]. rateBirthAge keeps the pilot guard [0, dt), which rejects the
// burst's normal case: a burst at the start of the tick runs its spawn update pass with exactly dt.
export function burstBirthAge(interpStartDt, intervalDt, i, dt) {
  const age = spawnUpdateDt(interpStartDt, intervalDt, i, dt);
  if (!(age > 0 && age <= dt)) throw new Error('Unsupported burst birth timing');
  return age;
}

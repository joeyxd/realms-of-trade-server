// A short, server-owned coastal handling lesson. Plans are pure until the fixed tick commits.
import { NAVAL_LESSON as L } from '../../data/navalLesson.js';
import { navalRouteLayout } from './route.js';
import { learnCoastalPilot, pilotingStatus } from '../systems/progression.js';

const active = (status) => status === 'outbound' || status === 'maneuver' || status === 'returning';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finitePoint = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
const point = (p) => ({ x: p.x, z: p.z });
const copyBuoy = (b) => ({ id: b.id, x: b.x, z: b.z, radius: b.radius });

export class NavalLesson {
  #world; #layout; #runs = new Map(); #serial = 0;

  constructor(world) {
    if (!world?.isServer || !world.navalPilot?.routeContext || !world.navalTrial?.navigation || !world.map)
      throw new TypeError('Lesson needs live naval authority');
    this.#world = world;
    const layout = navalRouteLayout(world.map);
    this.#layout = layout?.buoys?.length >= 2
      ? Object.freeze({ buoys: Object.freeze(layout.buoys.slice(0, 2).map(copyBuoy)) }) : null;
  }

  #context(owner) { return this.#world.navalPilot.routeContext(owner); }

  active(owner) { return active(this.#runs.get(owner)?.status); }

  #routeAvailable(owner) {
    return !this.#world.navalRoute?.active(owner);
  }

  #canStart(owner, ctx, previous) {
    return !!this.#layout && !!ctx?.helm && !ctx.ashore && ctx.epoch > 0 && finitePoint(ctx.home) &&
      finitePoint(ctx.body?.pose) && !ctx.body?.operational?.disabled && !active(previous?.status) &&
      distance(ctx.body.pose, ctx.home) <= L.startRange && this.#routeAvailable(owner) &&
      this.#serial < Number.MAX_SAFE_INTEGER &&
      [...this.#runs.values()].filter((run) => active(run.status)).length < L.maxRuns;
  }

  start(owner, epoch) {
    const ctx = this.#context(owner), previous = this.#runs.get(owner);
    if (ctx?.epoch !== epoch || !this.#canStart(owner, ctx, previous)) return false;
    const tick = this.#world.tick;
    const run = { owner, shipId: ctx.shipId, epoch, runId: `lesson:${++this.#serial}`,
      status: 'outbound', next: 0, stableTicks: 0, home: point(ctx.home),
      buoys: this.#layout.buoys.map(copyBuoy), startTick: tick, tick,
      elapsedTicks: 0, reason: '' };
    this.#runs.set(owner, run);
    return true;
  }

  abort(owner, epoch) {
    const ctx = this.#context(owner), run = this.#runs.get(owner);
    if (!ctx?.helm || ctx.ashore || ctx.epoch !== epoch || !active(run?.status)) return false;
    this.#runs.set(owner, { ...run, status: 'aborted', reason: 'cancelled',
      tick: this.#world.tick, elapsedTicks: this.#world.tick - run.startTick });
    return true;
  }

  end(owner, why) {
    const run = this.#runs.get(owner);
    if (!run) return;
    if (why === 'detach' || why === 'close') { this.#runs.delete(owner); return; }
    if (!active(run.status)) return;
    const tick = this.#world.tick;
    const complete = why === 'dock' && run.status === 'returning';
    const profile = complete && this.#world.profiles?.get(owner);
    const grant = profile ? learnCoastalPilot(profile.progression) : null;
    if (grant?.learned) {
      profile.progression = grant.progression;
      this.#world.profileDirty?.add(owner);
    }
    this.#runs.set(owner, { ...run,
      status: complete ? 'complete' : 'aborted',
      reason: why, tick, elapsedTicks: tick - run.startTick });
  }

  // Called with the candidate naval body before it is committed. This method never edits that body.
  plan(owner, shipId, candidateBody) {
    const previous = this.#runs.get(owner);
    if (!previous || previous.shipId !== shipId || !active(previous.status) || !candidateBody?.state ||
        !finitePoint(candidateBody.pose) || !Number.isFinite(candidateBody.state.vx) ||
        !Number.isFinite(candidateBody.state.vz)) return null;
    const tick = candidateBody.state.tick;
    if (!Number.isSafeInteger(tick) || tick <= previous.tick) return null;
    const state = { ...previous, home: point(previous.home), buoys: previous.buoys.map(copyBuoy) };
    state.tick = tick;
    state.elapsedTicks = tick - state.startTick;
    if (candidateBody.parked || candidateBody.operational?.disabled || state.elapsedTicks >= L.timeoutTicks) {
      state.status = 'aborted';
      state.reason = candidateBody.parked ? 'shore' : candidateBody.operational?.disabled ? 'disabled' : 'timeout';
      state.stableTicks = 0;
      return { previous, state };
    }

    // Deck mode/coasting is not pilot practice. Consecutive controlled ticks are required to stop.
    if (!this.#context(owner)?.helm) {
      state.stableTicks = 0;
      return { previous, state };
    }
    if (state.status === 'outbound' && distance(candidateBody.pose, state.buoys[0]) <= state.buoys[0].radius) {
      state.next = 1;
      state.status = 'maneuver';
      state.stableTicks = 0;
    } else if (state.status === 'maneuver') {
      const second = state.buoys[1];
      const speed = Math.hypot(candidateBody.state.vx, candidateBody.state.vz);
      if (tick === previous.tick + 1 && distance(candidateBody.pose, second) <= Math.min(second.radius, L.maneuverRadius) && speed <= L.stableSpeed)
        state.stableTicks++;
      else state.stableTicks = 0;
      if (state.stableTicks >= L.stableTicks) {
        state.status = 'returning';
        state.next = 2;
      }
    }
    return { previous, state };
  }

  commit(plan) {
    if (!plan || this.#runs.get(plan.state?.owner) !== plan.previous) return false;
    this.#runs.set(plan.state.owner, plan.state);
    return true;
  }

  snapshot(player, persistence = 'local') {
    let run = this.#runs.get(player);
    let ownerView = !!run;
    if (!run) for (const candidate of this.#runs.values()) {
      if (active(candidate.status) && this.#world.navalPilot.recipients?.(candidate.shipId)?.includes(player)) {
        run = candidate; break;
      }
    }
    const ctx = this.#context(player);
    const runActive = active(run?.status);
    const learning = pilotingStatus(this.#world.profiles?.get(player)?.progression);
    const target = !runActive ? null : run.status === 'outbound' ? copyBuoy(run.buoys[0]) :
      run.status === 'maneuver' ? copyBuoy(run.buoys[1]) : point(run.home);
    return {
      v: L.version, available: !!this.#layout, active: runActive, status: run?.status || 'ready',
      tick: run?.tick ?? this.#world.tick,
      runId: run?.runId || null, shipId: run?.shipId || null, next: run?.next || 0,
      stableTicks: run?.stableTicks || 0, requiredStableTicks: L.stableTicks, target,
      buoys: (run?.buoys || this.#layout?.buoys || []).map(copyBuoy), home: run ? point(run.home) : null,
      elapsedTicks: run?.elapsedTicks || 0, reason: run?.reason || '',
      learning: { ...learning, persistence: learning.learned ? persistence : 'unlearned' },
      canStart: !runActive && this.#canStart(player, ctx, this.#runs.get(player)),
      canAbort: ownerView && runActive && !!ctx?.helm && !ctx.ashore,
    };
  }
}

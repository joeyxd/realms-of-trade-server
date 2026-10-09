// A bounded optional PvE circuit. Plans are pure until the entire naval fleet commits its tick.
import { NAVAL_ROUTE as R } from '../../data/navalRoute.js';
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { damageTrialBody } from './trialBody.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const active = (s) => s === 'outbound' || s === 'returning';
const clone = (s) => ({ ...s, shots: s.shots.map((p) => ({ ...p, from: { ...p.from } })) });

function openWater(map, p, pad = 4) {
  if (Math.abs(p.x) + pad > map.half - 2 || Math.abs(p.z) + pad > map.half - 2) return false;
  for (const [x, z] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]])
    if (map.groundAt(p.x + x, p.z + z) >= 0.1 || map.onDock(p.x + x, p.z + z)) return false;
  return true;
}

export function navalRouteLayout(map) {
  const d = map?.dock;
  if (!d?.end || !d?.dir || !Number.isFinite(map.half)) return null;
  const across = { x: -d.dir.z, z: d.dir.x };
  // The island is rotated by its seed. Try both flanks and shorter circuits before declining.
  for (const scale of [1, 0.85, 0.7]) for (const side of [1, -1]) {
    const origin = { x: d.end.x + d.dir.x * 8 + across.x * side * 8,
      z: d.end.z + d.dir.z * 8 + across.z * side * 8 };
    const at = (along, cross) => ({ x: origin.x + d.dir.x * along * scale + across.x * cross * side * scale,
      z: origin.z + d.dir.z * along * scale + across.z * cross * side * scale });
    const buoys = [[16, 0], [28, 22], [16, 48]].map(([a, c], i) => Object.freeze({
      ...at(a, c), id: `buoy:${i + 1}`, label: `Boya ${i + 1}/3`, radius: R.buoyRadius,
    }));
    const threat = { ...at(29, 39), id: 'corsair-battery', yaw: Math.atan2(-across.x * side, -across.z * side),
      range: R.range, label: 'Cañonera corsaria' };
    if (![origin, ...buoys, threat].every((p) => openWater(map, p))) continue;
    const path = [origin, ...buoys, origin];
    let safe = true;
    for (let i = 1; i < path.length; i++) for (let j = 0; j <= 12; j++) {
      const t = j / 12, p = { x: path[i - 1].x * (1 - t) + path[i].x * t,
        z: path[i - 1].z * (1 - t) + path[i].z * t };
      if (!openWater(map, p)) safe = false;
    }
    if (safe) return Object.freeze({ buoys: Object.freeze(buoys), threat: Object.freeze(threat) });
  }
  return null;
}

// Resolve a circular landing splash against real rotated float rectangles, with stable ID ties.
export function routeHitPart(structure, pose, shot) {
  const dx = shot.x - pose.x, dz = shot.z - pose.z, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const x = c * dx - s * dz, z = s * dx + c * dz;
  let result = null, best = Infinity;
  for (const entry of structure.entries) {
    const def = RAFT_PARTS[entry.part[0]];
    if (!def?.floats || entry.hp <= 0) continue;
    const minX = entry.part[1] * RAFT.cell, minZ = entry.part[2] * RAFT.cell;
    const [w, h] = def.size || [1, 1];
    const gap = Math.hypot(Math.max(minX - x, 0, x - minX - w * RAFT.cell),
      Math.max(minZ - z, 0, z - minZ - h * RAFT.cell));
    if (gap <= shot.radius && (gap < best || gap === best && (!result || entry.id < result.id))) {
      result = entry; best = gap;
    }
  }
  return result;
}

export class NavalRoute {
  #world; #layout; #runs = new Map(); #serial = 0;
  constructor(world) {
    if (!world?.isServer || !world.navalPilot || !world.navalTrial?.navigation) throw new TypeError('Route needs live naval authority');
    this.#world = world; this.#layout = navalRouteLayout(world.map);
  }

  #canStart(ctx, prior) {
    return !!this.#layout && !!ctx?.helm && !ctx.ashore && !active(prior?.status) &&
      distance(ctx.body.pose, ctx.home) <= R.startRange && !ctx.body.operational.disabled &&
      this.#serial < Number.MAX_SAFE_INTEGER && [...this.#runs.values()].filter((s) => active(s.status)).length < R.maxRuns;
  }

  start(owner, epoch) {
    const ctx = this.#world.navalPilot.routeContext(owner), prior = this.#runs.get(owner);
    if (ctx?.epoch !== epoch || !this.#canStart(ctx, prior)) return false;
    this.#runs.set(owner, { owner, shipId: ctx.shipId, epoch, runId: `route:${++this.#serial}`, status: 'outbound',
      next: 0, home: { x: ctx.home.x, z: ctx.home.z }, shots: [], serial: 0, hits: 0, dodged: 0, damage: 0,
      startTick: this.#world.tick, tick: this.#world.tick, elapsedTicks: 0,
      fireAt: this.#world.tick + R.firstSalvoTicks, reason: '' });
    return true;
  }

  abort(owner, epoch) {
    const ctx = this.#world.navalPilot.routeContext(owner), s = this.#runs.get(owner);
    if (!ctx?.helm || ctx.ashore || ctx.epoch !== epoch || !active(s?.status)) return false;
    this.#runs.set(owner, { ...s, status: 'aborted', shots: [], reason: 'cancelled',
      tick: this.#world.tick, elapsedTicks: this.#world.tick - s.startTick });
    return true;
  }

  end(owner, why) {
    const s = this.#runs.get(owner);
    if (!s) return;
    if (['detach', 'close'].includes(why)) { this.#runs.delete(owner); return; }
    if (!active(s.status)) return;
    this.#runs.set(owner, { ...s, shots: [], status: why === 'dock' && s.status === 'returning' ? 'complete' : 'aborted',
      reason: why, tick: this.#world.tick, elapsedTicks: this.#world.tick - s.startTick });
  }

  // Called with a candidate body, after motion and coast contact, before any fleet state is written.
  plan(owner, shipId, body) {
    const previous = this.#runs.get(owner);
    if (!previous || previous.shipId !== shipId || !active(previous.status)) return null;
    const state = clone(previous), tick = body.state.tick;
    state.tick = tick; state.elapsedTicks = tick - state.startTick;
    if (body.parked || body.operational.disabled || state.elapsedTicks >= R.timeoutTicks) {
      state.status = 'aborted'; state.reason = body.parked ? 'shore' : body.operational.disabled ? 'disabled' : 'timeout';
      state.shots = []; return { previous, state, body };
    }
    // Only the next buoy can count; read committed movement, never client progress or coordinates.
    const buoy = this.#layout.buoys[state.next];
    if (state.status === 'outbound' && buoy && distance(body.pose, buoy) <= buoy.radius) {
      state.next++;
      if (state.next === this.#layout.buoys.length) state.status = 'returning';
    }
    const coastImpacts = body.impacts;
    const impacts = [];
    state.shots = state.shots.filter((shot) => {
      if (tick < shot.impactTick) return true;
      const part = routeHitPart(body.structure, body.pose, shot);
      const amount = part ? Math.max(0, Math.min(R.shotDamage, R.damageBudget - state.damage,
        part.hp - part.maxHp * R.partFloor)) : 0;
      if (part) state.hits++; else state.dodged++;
      if (amount > 0) {
        const result = damageTrialBody(body, part.id, amount);
        body = result.body; state.damage += result.event.damage;
        impacts.push(Object.freeze({ id: shot.id, kind: 'salvo', partId: result.event.partId,
          damage: result.event.damage, destroyed: result.event.destroyed, x: shot.x, z: shot.z, speed: 0,
          source: 'corsair', shotId: shot.id, tick }));
      }
      return false;
    });
    const threat = this.#layout.threat;
    if (tick >= state.fireAt && distance(body.pose, threat) <= R.range && distance(body.pose, state.home) > R.startRange && state.shots.length < R.maxShots) {
      // A fixed predicted mark gives a moving captain time to evade; it never tracks after firing.
      const rig = body.operational.rig;
      const centre = { x: rig.hullCx, z: rig.hullCz };
      const c = Math.cos(body.pose.yaw), s = Math.sin(body.pose.yaw);
      const mark = { x: body.pose.x + c * centre.x + s * centre.z + body.state.vx * 0.65,
        z: body.pose.z - s * centre.x + c * centre.z + body.state.vz * 0.65 };
      const yaw = Math.atan2(mark.x - threat.x, mark.z - threat.z);
      state.gunYaw = yaw;
      state.shots.push({ ...mark, id: `${state.runId}:shot:${++state.serial}`, t0: tick,
        impactTick: tick + R.warningTicks, radius: R.shotRadius,
        from: { x: threat.x + Math.sin(yaw) * 1.4, z: threat.z + Math.cos(yaw) * 1.4 } });
      state.fireAt = tick + R.salvoTicks;
    }
    // Contact feedback remains in the physics contract; route hits have their own event contract.
    if (body.impacts !== coastImpacts) body = Object.freeze({ ...body, impacts: coastImpacts });
    return { previous, state, body, impacts };
  }

  commit(plan) {
    if (plan) this.#runs.set(plan.state.owner, plan.state);
  }

  snapshot(player) {
    let s = this.#runs.get(player);
    if (!s) for (const run of this.#runs.values())
      if (active(run.status) && this.#world.navalPilot.recipients(run.shipId).includes(player)) { s = run; break; }
    const ctx = this.#world.navalPilot.routeContext(player);
    const status = s?.status || 'ready';
    const target = active(status) ? status === 'outbound' ? this.#layout.buoys[s.next] : { ...s.home, label: 'Puerto · amarrar' } : null;
    return { v: R.version, available: !!this.#layout, active: active(status), status, tick: s?.tick ?? this.#world.tick,
      runId: s?.runId || null, shipId: s?.shipId || null, next: s?.next || 0, target,
      buoys: this.#layout?.buoys || [], threat: this.#layout ? { ...this.#layout.threat,
        yaw: s?.gunYaw ?? this.#layout.threat.yaw } : null, shots: s ? clone(s).shots : [],
      home: s ? { ...s.home } : null, damage: s?.damage || 0, hits: s?.hits || 0, dodged: s?.dodged || 0,
      elapsedTicks: s?.elapsedTicks || 0, reason: s?.reason || '',
      canStart: this.#canStart(ctx, s),
      canAbort: active(status) && !!ctx?.helm && !ctx.ashore,
    };
  }
}

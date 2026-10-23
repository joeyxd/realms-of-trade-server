import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DT } from '../src/data/tuning.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';

test('a real input-driven raft crosses the optional circuit and docks without hull relocation fixtures', () => {
  const server = new LocalServer({ seed: 123, bots: 0, enemies: false, dev: false, send() {} });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Circuito', skin: 0, weapon: 0 });
  const w = server.world, e = server.clients.get(1).entity, raft = publicRafts(w).find((r) => r.owner === e);
  // Only admission setup places the character at the physical station; the vessel is never relocated.
  const p = pilotPoint(raft, raft.helm);
  w.ecs.x[e] = p.x; w.ecs.y[e] = p.y; w.ecs.z[e] = p.z; w.ecs.facing[e] = p.f;
  w.ecs.dashT[e] = -1; w.ecs.regenT[e] = 100;
  server.receive(1, { t: MSG.CMD, type: 'navalPilot', op: 'mount', shipId: raft.id });
  const epoch = w.navalPilot.snapshot(e).epoch;
  assert.equal(w.navalPilot.has(e), true);
  server.receive(1, { t: MSG.CMD, type: 'navalPilot', op: 'routeStart', epoch });
  assert.equal(w.navalRoute.snapshot(e).active, true);
  let steps = 0;
  for (; steps < 10000; steps++) {
    const route = w.navalRoute.snapshot(e), body = w.navalPilot.snapshot(e).body;
    if (!route.active) break;
    const dx = route.target.x - body.pose.x, dz = route.target.z - body.pose.z;
    const d = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    const error = Math.atan2(Math.sin(yaw - body.state.yaw), Math.cos(yaw - body.state.yaw));
    const stopping = route.status === 'returning' && d < 10;
    const steer = Math.max(-1, Math.min(1, error * 2.5 - body.state.omega * 1.5));
    server.receive(1, { t: MSG.SHIP_INPUT, epoch, seq: steps + 1,
      throttle: stopping ? 0 : Math.abs(error) > 1 ? 0.45 : 1,
      brake: stopping ? 1 : 0, steer, capture: false });
    server.step(DT);
    if (w.navalPilot.voyageSnapshot(e).canDock && w.navalRoute.snapshot(e).status === 'returning') {
      server.receive(1, { t: MSG.CMD, type: 'navalPilot', op: 'dock', epoch });
      break;
    }
  }
  const result = w.navalRoute.snapshot(e);
  assert.equal(result.status, 'complete', `steps=${steps}, result=${JSON.stringify(result)}`);
  assert.equal(result.next, 3);
  assert.ok(result.hits + result.dodged > 0, 'a real enemy salvo was resolved during the drive');
  assert.ok(result.damage <= 24);
  assert.equal(w.navalPilot.snapshot(e).active, false);
  assert.equal(w.profiles.get(e).eco.ships.find((s) => s.id === raft.id).voyage, null);
});

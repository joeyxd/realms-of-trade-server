// Shared test fixtures (not a test file: `npm test` only runs *.test.mjs).
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';

export const map = generateWorld(GAME.seed);
export const A = map.landmarks.arena; // flat, open floor

// A server world with one player standing in the arena facing +x, no map enemies.
// step(o) runs one command (defaults: no move, aim 5 u to +x, pt = server tick) and one world step.
export function arena(o = {}) {
  const w = new World(GAME.seed, { map, server: true });
  const e = w.spawnPlayer({ x: A.x, z: A.z + 4, facing: Math.PI / 2, ...o });
  w.events.length = 0;
  let seq = 0;
  const step = (c = {}) => {
    const cmd = { seq: ++seq, mx: 0, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...c };
    w.applyCommand(e, cmd);
    w.stepWorld();
    const evs = w.events.slice();
    w.events.length = 0;
    return evs;
  };
  return { w, e, step };
}

// A projectile flying at the player along -x, starting `dist` u in front of them.
export function incoming(w, e, type = 0, dist = 6, speed = 10, dmg = 8, offZ = 0) {
  const id = w.nextPid++;
  w.hazards.spawn(id, type, 0, w.ecs.x[e] + dist, w.ecs.y[e] + 1.1, w.ecs.z[e] + offZ, -speed, 0, w.tick, dmg, map);
  return id;
}

// A GameClient wired to a LocalServer in-process (messages cloned like the worker would).
// place(x, z): where the player is put once joined (default: 8 u west of an archer).
export function clientAndServer(place) {
  const toClient = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, send: (_id, m) => toClient.push(JSON.parse(JSON.stringify(m))) });
  const snaps = [], msgs = [];
  const transport = {
    onSnapshot: (cb) => snaps.push(cb), onMessage: (cb) => msgs.push(cb), start() {},
    sendInput: (_s, cmd) => server.receive(1, { t: MSG.INPUTS, cmds: [cmd] }),
    send: (m) => server.receive(1, m),
  };
  const shown = [];
  const bus = { emit: (type, ev) => { if (type === 'combat') shown.push(ev); } };
  const client = new GameClient(transport, map, bus);
  client.start();
  const deliver = () => {
    while (toClient.length) {
      const m = toClient.shift();
      if (m.t === MSG.SNAPSHOT) snaps.forEach((cb) => cb(m)); else msgs.forEach((cb) => cb(m));
    }
  };
  server.connect(1);
  deliver();
  client.join('Test', 1);
  deliver();
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.ok(client.joined);
  const sp = map.enemySpawns.find((s) => s.kind === 'archer');
  const se = server.clients.get(1).entity;
  const ecs = server.world.ecs;
  const [px, pz] = place ? place(sp) : [sp.x - 8, sp.z];
  ecs.x[se] = px; ecs.z[se] = pz; ecs.y[se] = map.groundAt(px, pz);
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  return { server, client, deliver, shown, sp, se, ecs };
}

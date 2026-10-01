// Wire protocol shared by LocalServer (worker), the client, and the future Node server.
// JSON-compatible objects today; the binary layout is documented in DESIGN.md §10.
export const PROTOCOL_VERSION = 1;

export const MSG = {
  // client -> server
  HELLO: 'hello',     // {v, name, skin}
  INPUTS: 'inputs',   // {cmds: [{seq, mx, mz, ax, az, btn, prs}]}
  CMD: 'cmd',         // {type: 'interact' | 'chat' | 'equip' | ...}
  PING: 'ping',       // {t}
  // server -> client
  READY: 'ready',     // transport is up (worker booted)
  WELCOME: 'welcome', // {you, tick, seed}
  SNAPSHOT: 'snap',   // {tick, ack, ents: [ENT...], you: [MOVER_FIELDS...]}
  SPAWN: 'spawn',     // {e: {id, kind, name, title, skin, level}}
  DESPAWN: 'despawn', // {id}
  EVENT: 'event',     // {ev: {type, ...}}  damage, death, loot, levelup, pattern, reflect, phase, wave, timescale
  PONG: 'pong',       // {t, tick}
  // reserved: naval + trade slice (no gameplay yet)
  SHIP_SPAWN: 'ship_spawn',
  SHIP_INPUT: 'ship_input',
  SHIP_STATE: 'ship_state',
  BOARD: 'board',
  DOCK: 'dock',
  TRADE_OFFER: 'trade_offer',
  TRADE_ACCEPT: 'trade_accept',
};

// Snapshot entity tuple layout.
export const ENT = { ID: 0, KIND: 1, X: 2, Y: 3, Z: 4, F: 5, VX: 6, VZ: 7, ST: 8, MAG: 9, WADE: 10, DASHES: 11 };

export function encodeEntity(ecs, e) {
  return [e, ecs.kind[e], ecs.x[e], ecs.y[e], ecs.z[e], ecs.facing[e], ecs.vx[e], ecs.vz[e], ecs.state[e], ecs.moveMag[e], ecs.wade[e], ecs.dashCount[e]];
}

// Input commands: axes quantized to 1/127 so client prediction uses exactly what the server sees.
export const quantAxis = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127;

export function sanitizeCmd(c) {
  if (!c || typeof c !== 'object') return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    seq: n(c.seq) >>> 0,
    mx: quantAxis(n(c.mx)),
    mz: quantAxis(n(c.mz)),
    ax: n(c.ax),
    az: n(c.az),
    btn: n(c.btn) & 0xff,
    prs: n(c.prs) & 0xff,
  };
}

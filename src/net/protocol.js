// Wire protocol shared by LocalServer (worker), the client, and the future Node server.
// JSON-compatible objects today; the binary layout is documented in DESIGN.md §10.
export const PROTOCOL_VERSION = 7; // M4: hello.save, BTN.POTION, profiles, saves, private events · M4.5: public loot, friendly fire · M4.7: slot / element columns in `you`, loadout / form / learn (6), the tattoos' state in `you` and held Q / E in btn (7)

export const MSG = {
  // client -> server
  HELLO: 'hello',     // {v, name, skin, weapon, save}
  INPUTS: 'inputs',   // {cmds: [{seq, mx, mz, ax, az, btn, prs, pt, w}]}
  CMD: 'cmd',         // {type: 'pause' | 'equip' | 'unequip' | 'salvage' | 'open' | 'loadout' | 'form' | 'learn' | 'dev' ...}
  PING: 'ping',       // {t}
  // server -> client
  READY: 'ready',     // transport is up (worker booted)
  WELCOME: 'welcome', // {you, tick, seed}
  SNAPSHOT: 'snap',   // {tick, ack, ents: [ENT...], you: [MOVER_FIELDS...]}
  SPAWN: 'spawn',     // {e: {id, kind, name, title, skin, level}}
  DESPAWN: 'despawn', // {id}
  EVENT: 'event',     // {ev: {type, ...}}  pattern, aoe, windup, parry, destroy, hurt, damage, kill, shot, time… (see sim/)
  PONG: 'pong',       // {t, tick}
  FULL: 'full',       // {max}: the instance has no room for another player (you keep spectating)
  ERROR: 'error',     // {code: 'version' | 'name' ...}
  PROFILE: 'profile', // {p}: your profile (bag, equipment, gold, masteries, quests…), private (M4)
  SAVE: 'save',       // {blob}: keep this and send it back in your next hello (M4, P3)
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
export const ENT = { ID: 0, KIND: 1, X: 2, Y: 3, Z: 4, F: 5, VX: 6, VZ: 7, ST: 8, MAG: 9, WADE: 10, DASHES: 11, HP: 12, MAXHP: 13, ACT: 14, ACTT: 15, LVL: 16, WPN: 17 };

// Remote entities are only interpolated, so their floats travel rounded (≈ 45 % fewer characters before the
// socket compresses them): positions and facing to 1/1000, velocities and blends to 1/100. Your own
// predicted state goes separately, at full precision (`you`, PLAYER_FIELDS).
const q3 = (v) => Math.round(v * 1000) / 1000;
const q2 = (v) => Math.round(v * 100) / 100;
export function encodeEntity(ecs, e) {
  return [
    e, ecs.kind[e], q3(ecs.x[e]), q3(ecs.y[e]), q3(ecs.z[e]), q3(ecs.facing[e]), q2(ecs.vx[e]), q2(ecs.vz[e]), ecs.state[e], q2(ecs.moveMag[e]), q2(ecs.wade[e]), ecs.dashCount[e],
    Math.ceil(ecs.hp[e]), ecs.maxHp[e], ecs.act[e], q3(ecs.actT[e]), ecs.level[e], ecs.weapon[e],
  ];
}

// Player names: printable, trimmed, at most 16 characters; empty → the default.
export function cleanName(v, fallback = 'Grumete') {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  return s || fallback;
}

// Input commands: axes quantized to 1/127 so client prediction uses exactly what the server sees.
// pt = the projectile tick the client was showing when it made the command (lag compensation).
// w = the weapon asked for + 1 (0 = no change): the sim only swaps it next to a rack.
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
    btn: n(c.btn) & 0x3ff, // held bits: + BTN.Q / BTN.E held (a charge, M4.7)
    prs: n(c.prs) & 0x1ff, // + BTN.POTION (M4)
    pt: n(c.pt) >>> 0,
    w: n(c.w) & 0x0f,
  };
}

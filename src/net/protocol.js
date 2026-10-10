// Wire protocol shared by LocalServer (worker), the client, and the future Node server.
// JSON-compatible objects today; the binary layout is documented in DESIGN.md §10.
export const PROTOCOL_VERSION = 43; // Exact content admission plus private fire fuel status/commands; reload peers.

export const MSG = {
  // client -> server
  HELLO: 'hello',     // {v, name, skin, weapon, save, content?:{generation,revisionId}, token?, importSave?, agent?:true}
  INPUTS: 'inputs',   // {cmds: [{seq, mx, mz, ax, az, btn, prs, pt, w}], control?:{epoch,taskRevision}}
  CMD: 'cmd',         // {type: 'pause' | 'equip' | 'raft' | 'salvage' | 'open' | 'loadout' | 'form' | 'learn' | 'dev' ...}
  PING: 'ping',       // {t}
  CHAT_SEND: 'chat_send', // {id, channel: world|local|whisper, text, target?: peer connection id, control?:{epoch}}
  AGENT_TASK: 'agent_task', // managed controller: {epoch,expectedTaskRevision,actionId,type,args,priority}
  AGENT_CANCEL: 'agent_cancel', // managed controller: {epoch,expectedTaskRevision}
  AGENT_RELEASE: 'agent_release', // managed controller relinquishes its lease: {epoch}
  AGENT_CONTROL: 'agent_control', // authenticated owner: {op,characterId,task?}; identity is never supplied
  AGENT_INVENTORY: 'agent_inventory', // managed pilot read: {requestId,epoch,sessionId}; no account/entity selector
  AGENT_MARKET: 'agent_market', // managed pilot read: {requestId,epoch,sessionId,op,g?,n?,side?}; server selects town
  AGENT_TRADE: 'agent_trade', // managed trade: {opId,epoch,sessionId,op,g,n,expectedTotal}; server selects account/town
  AGENT_GOODS_BUDGET: 'agent_goods_budget', // authenticated owner: create/read/revoke for a configured character
  // server -> client
  READY: 'ready',     // transport is up (worker booted)
  WELCOME: 'welcome', // {v,you,tick,seed,control?: server-owned managed grant/task state}
  SNAPSHOT: 'snap',   // {tick, ack, ents, you, rafts, resources, naval?, deck?, voyage?, route?, lesson?: private activity/learning}
  SPAWN: 'spawn',     // {e: {id, kind, name, title, skin, level}}
  DESPAWN: 'despawn', // {id}
  EVENT: 'event',     // {ev: {type, ...}}  pattern, aoe, windup, parry, destroy, hurt, damage, kill, shot, time… (see sim/)
  PONG: 'pong',       // {t, tick}
  FULL: 'full',       // {max}: the instance has no room for another player (you keep spectating)
  ERROR: 'error',     // {code: 'version' | 'name' ...}
  CHAT_STATE: 'chat_state', // {self, peers:[{id,entity,name}], config, history: session-visible messages}
  CHAT_MESSAGE: 'chat_message', // {id,requestId,channel,sender,target?,text,tick}; identity comes from server
  CHAT_RESULT: 'chat_result', // {requestId,ok,code?,messageId?,duplicate?}; routed, not a read receipt
  AGENT_STATE: 'agent_state', // private controller/owner state and queue invalidation receipt
  AGENT_INVENTORY_RESULT: 'agent_inventory_result', // {requestId,epoch,sessionId,ok,why,tick,replay,inventory}
  AGENT_MARKET_RESULT: 'agent_market_result', // {requestId,epoch,sessionId,ok,why,tick,replay,market}; advisory only
  AGENT_TRADE_RESULT: 'agent_trade_result', // private durable receipt; historical results never hydrate current inventory
  AGENT_GOODS_BUDGET_RESULT: 'agent_goods_budget_result', // private owner policy projection; no credentials or foreign identity
  PROFILE: 'profile', // {p}: your profile (bag, equipment, gold, masteries, quests…), private (M4)
  SAVE: 'save',       // {blob}: keep this and send it back in your next hello (M4, P3)
  // Session-owned helm and relative deck input; the remaining naval/trade messages stay reserved.
  SHIP_SPAWN: 'ship_spawn',
  SHIP_INPUT: 'ship_input', // {epoch, seq, throttle, brake, steer, capture?:boolean}; session owns pilot
  DECK_INPUT: 'deck_input', // private local crew: {epoch, seq, mx, mz}; axes in the raft's local frame
  SHIP_STATE: 'ship_state',
  BOARD: 'board',
  DOCK: 'dock',
  TRADE_OFFER: 'trade_offer',
  TRADE_ACCEPT: 'trade_accept',
};

// Snapshot entity tuple layout.
export const ENT = { ID: 0, KIND: 1, X: 2, Y: 3, Z: 4, F: 5, VX: 6, VZ: 7, ST: 8, MAG: 9, WADE: 10, DASHES: 11, HP: 12, MAXHP: 13, ACT: 14, ACTT: 15, LVL: 16, WPN: 17, ELEM: 18, LANTERN: 19 };

// Remote entities are only interpolated, so their floats travel rounded (≈ 45 % fewer characters before the
// socket compresses them): positions and facing to 1/1000, velocities and blends to 1/100. Your own
// predicted state goes separately, at full precision (`you`, PLAYER_FIELDS).
const q3 = (v) => Math.round(v * 1000) / 1000;
const q2 = (v) => Math.round(v * 100) / 100;
export function encodeEntity(ecs, e) {
  return [
    e, ecs.kind[e], q3(ecs.x[e]), q3(ecs.y[e]), q3(ecs.z[e]), q3(ecs.facing[e]), q2(ecs.vx[e]), q2(ecs.vz[e]), ecs.state[e], q2(ecs.moveMag[e]), q2(ecs.wade[e]), ecs.dashCount[e],
    Math.ceil(ecs.hp[e]), ecs.maxHp[e], ecs.act[e], q3(ecs.actT[e]), ecs.level[e], ecs.weapon[e], ecs.elem[e],
    ecs.lantern[e] === 1 && ecs.hp[e] > 0 && !ecs.dead[e] ? 1 : 0,
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
    prs: n(c.prs) & 0x3ff, // + BTN.G (M4.8)
    pt: n(c.pt) >>> 0,
    w: n(c.w) & 0x0f,
  };
}

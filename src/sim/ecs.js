// ECS-lite: entities are indices, components are typed-array columns + a bitmask.
// Float64 columns so the client's prediction and the server produce bit-identical results.

export const C = {
  POS: 1 << 0,
  MOVER: 1 << 1,
  DASH: 1 << 2,
  PLAYER: 1 << 3,
  BOT: 1 << 4,
  NPC: 1 << 5,
  VEHICLE: 1 << 6, // reserved for the naval slice
  HEALTH: 1 << 7,
  ENEMY: 1 << 8,
};

export const KIND = { NONE: 0, PLAYER: 1, NPC: 2, ENEMY: 3, SHIP: 4 };
export const TEAM = { NEUTRAL: 0, PLAYERS: 1, ENEMIES: 2 };
export const STATE = { MOVE: 0, DASH: 1 };
// What an entity is doing, for animation (snapshots carry it with the time spent in it).
export const ACT = {
  IDLE: 0, SWING1: 1, SWING2: 2, SWING3: 3, PARRY: 4, STAGGER: 5, DEAD: 6, DORMANT: 7, WAKE: 8,
  WINDUP: 9, FIRE: 10, RECOVER: 11, HIT: 12, RIPOSTE: 13,
};

export class ECS {
  constructor(cap = 2048) {
    this.cap = cap;
    this.mask = new Uint32Array(cap);
    this.kind = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.free = [];
    for (let i = cap - 1; i >= 1; i--) this.free.push(i); // 0 = null entity
    const f = () => new Float64Array(cap);
    // POS
    this.x = f(); this.y = f(); this.z = f(); this.facing = f();
    // MOVER
    this.vx = f(); this.vz = f(); this.speed = f(); this.radius = f(); this.moveMag = f(); this.wade = f();
    this.state = new Uint8Array(cap);
    this.moveMul = f(); this.faceLock = f(); this.kbx = f(); this.kbz = f();
    // DASH
    this.dashT = f(); this.dashDirX = f(); this.dashDirZ = f(); this.dashCovered = f();
    this.dashCharges = f(); this.dashMax = f(); this.dashRecharge = f(); this.dashBuffer = f(); this.iframes = f();
    this.dashCount = new Uint32Array(cap);
    // HEALTH
    this.hp = f(); this.maxHp = f(); this.atk = f(); this.def = f(); this.hurtR = f();
    this.team = new Uint8Array(cap);
    this.stagger = f(); this.hurtInv = f(); this.regenT = f(); this.dead = f(); this.deadT = f();
    this.act = new Uint8Array(cap); this.actT = f();
    // PLAYER combat (predicted by the client: see PLAYER_FIELDS)
    this.atkStage = f(); this.atkT = f(); this.atkBuf = f(); this.lastStage = f(); this.comboT = f(); this.swingId = f();
    this.parryT = f(); this.parryLock = f(); this.parryBuf = f(); this.parryHits = f();
    this.chain = f(); this.chainT = f(); this.riposte = f(); this.rBuf = f();
    this.pend0 = f(); this.pend0T = f(); this.pend0D = f(); this.pend1 = f(); this.pend1T = f(); this.pend1D = f();
    this.lastPt = f(); this.xp = f(); this.cpX = f(); this.cpZ = f(); this.god = f();
    // ENEMY (server only)
    this.enemy = new Uint8Array(cap); // index into ENEMY_KINDS
    this.brain = new Array(cap).fill(null);
    // PLAYER / NPC metadata
    this.level = new Uint8Array(cap);
    this.skin = new Uint8Array(cap);
    this.clientId = new Int32Array(cap).fill(-1);
    this.lastSeq = new Uint32Array(cap);
    this.names = new Array(cap).fill('');
    this.titles = new Array(cap).fill('');
    this.bot = new Array(cap).fill(null);
  }

  create(kind, mask) {
    const id = this.free.pop();
    if (id === undefined) throw new Error('ECS full');
    this.alive[id] = 1;
    this.kind[id] = kind;
    this.mask[id] = mask;
    this.x[id] = this.y[id] = this.z[id] = this.facing[id] = 0;
    this.vx[id] = this.vz[id] = this.moveMag[id] = this.wade[id] = 0;
    this.moveMul[id] = 1; this.faceLock[id] = 0; this.kbx[id] = this.kbz[id] = 0;
    this.state[id] = 0;
    this.dashT[id] = -1;
    this.dashDirX[id] = this.dashDirZ[id] = this.dashCovered[id] = 0;
    this.dashCharges[id] = this.dashMax[id] = 1;
    this.dashRecharge[id] = this.dashBuffer[id] = this.iframes[id] = 0;
    this.dashCount[id] = 0;
    this.hp[id] = this.maxHp[id] = 1; this.atk[id] = this.def[id] = 0; this.hurtR[id] = 0.36;
    this.team[id] = 0;
    this.stagger[id] = this.hurtInv[id] = this.regenT[id] = this.dead[id] = this.deadT[id] = 0;
    this.act[id] = 0; this.actT[id] = 0;
    this.atkStage[id] = this.atkT[id] = this.atkBuf[id] = this.lastStage[id] = this.swingId[id] = 0;
    this.comboT[id] = 99;
    this.parryT[id] = -1; this.parryLock[id] = this.parryBuf[id] = this.parryHits[id] = 0;
    this.chain[id] = 0; this.chainT[id] = 99; this.riposte[id] = this.rBuf[id] = 0;
    this.pend0[id] = this.pend0T[id] = this.pend0D[id] = this.pend1[id] = this.pend1T[id] = this.pend1D[id] = 0;
    this.lastPt[id] = 0; this.xp[id] = 0; this.cpX[id] = this.cpZ[id] = 0; this.god[id] = 0;
    this.enemy[id] = 0; this.brain[id] = null;
    this.level[id] = 1; this.skin[id] = 0; this.clientId[id] = -1; this.lastSeq[id] = 0;
    this.names[id] = ''; this.titles[id] = ''; this.bot[id] = null;
    return id;
  }

  destroy(id) {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.mask[id] = 0;
    this.kind[id] = 0;
    this.brain[id] = null;
    this.free.push(id);
  }

  *each(mask) {
    for (let i = 1; i < this.cap; i++) if (this.alive[i] && (this.mask[i] & mask) === mask) yield i;
  }
}

// Movement state that prediction must reconcile (order matters: used for snapshots).
export const MOVER_FIELDS = [
  'x', 'y', 'z', 'facing', 'vx', 'vz', 'moveMag', 'wade', 'dashT', 'dashDirX', 'dashDirZ', 'dashCovered',
  'dashCharges', 'dashMax', 'dashRecharge', 'dashBuffer', 'iframes', 'moveMul', 'faceLock', 'kbx', 'kbz',
];
// Everything the local player predicts (movement + combat). The server sends these at the acked command.
export const PLAYER_FIELDS = [
  ...MOVER_FIELDS,
  'hp', 'maxHp', 'atk', 'def', 'stagger', 'hurtInv', 'regenT', 'dead', 'deadT', 'act', 'actT',
  'atkStage', 'atkT', 'atkBuf', 'lastStage', 'comboT', 'swingId', 'parryT', 'parryLock', 'parryBuf', 'parryHits',
  'chain', 'chainT', 'riposte', 'rBuf', 'pend0', 'pend0T', 'pend0D', 'pend1', 'pend1T', 'pend1D',
  'lastPt', 'xp', 'cpX', 'cpZ', 'god', 'level',
];

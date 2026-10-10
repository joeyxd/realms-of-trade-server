// ECS-lite: entities are indices, components are typed-array columns + a bitmask.
// Float64 columns so the client's prediction and the server produce bit-identical results.

export const C = {
  POS: 1 << 0,
  MOVER: 1 << 1,
  DASH: 1 << 2,
  PLAYER: 1 << 3,
  BOT: 1 << 4,
  NPC: 1 << 5,
  VEHICLE: 1 << 6, // authoritative moored raft, replicated separately from character entities
  HEALTH: 1 << 7,
  ENEMY: 1 << 8,
};

export const KIND = { NONE: 0, PLAYER: 1, NPC: 2, ENEMY: 3, SHIP: 4 };
export const TEAM = { NEUTRAL: 0, PLAYERS: 1, ENEMIES: 2 };
export const STATE = { MOVE: 0, DASH: 1 };
// What an entity is doing, for animation (snapshots carry it with the time spent in it).
// GUARD (M3.5) took the parry's slot: RMB raises the guard (PARRY kept as an alias for old tools).
export const ACT = {
  IDLE: 0, SWING1: 1, SWING2: 2, SWING3: 3, GUARD: 4, PARRY: 4, STAGGER: 5, DEAD: 6, DORMANT: 7, WAKE: 8,
  WINDUP: 9, FIRE: 10, RECOVER: 11, HIT: 12, RIPOSTE: 13, ENRAGE: 14,
  // Weapon skills (M3.5): the cutlass lunge and crescent throw, pistol fire, the blast, a cast (rain, blink).
  LUNGE: 15, THROW: 16, SHOOT: 17, BLAST: 18, CAST: 19,
  // Tattoos (M4.7): a held charge (the wheel) and the boarding leap (the render takes the height from actT).
  CHARGE: 20, LEAP: 21,
};

// The columns of tattoo effects in flight (all 0 = nothing going on).
const TATTOO_STATE = [
  'trT0', 'trX', 'trZ', 'trId', 'trF', 'trEnd', 'trT1', 'trX1', 'trZ1', 'trN', 'lpX0', 'lpZ0', 'lpX1', 'lpZ1', 'empT', 'empK',
  'chg', 'whT0', 'whX0', 'whZ0', 'whDx', 'whDz', 'whV', 'whR', 'whRr', 'whMul', 'whF', 'whPh', 'whX', 'whZ', 'whS', 'whTb', 'whId', 'whN', 'whSlot',
];
const PEARL_STATE = ['skG', 'fmG', 'rkG', 'cdG', 'gBuf', 'waterT', 'icX', 'icZ', 'icT0', 'icEnd', 'icSeq', 'inkX', 'inkZ', 'inkT0', 'inkEnd', 'inkSeq'];

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
    // Guard (RMB held): time up (−1 down), perfect window armed, re-arm timer, stamina, time since the
    // last block; caught bullets (count, heavy ones, max damage, age).
    this.guardT = f(); this.guardP = f(); this.guardRe = f(); this.guardSt = f(); this.guardRegT = f();
    this.catchN = f(); this.catchHv = f(); this.catchDmg = f(); this.catchT = f();
    this.chain = f(); this.chainT = f(); this.riposte = f(); this.rBuf = f();
    this.pend0 = f(); this.pend0T = f(); this.pend0D = f(); this.pend1 = f(); this.pend1T = f(); this.pend1D = f();
    this.lastPt = f(); this.xp = f(); this.cpX = f(); this.cpZ = f(); this.god = f();
    // Weapon (index into WEAPON_KINDS) and its skills: Q / E cooldowns and input buffers, the skill being
    // cast (castK 0 none · 1 Q · 2 E · 3 G, time in it, its aim), the pistol's fire timer and hand.
    this.weapon = f(); this.cdQ = f(); this.cdE = f(); this.qBuf = f(); this.eBuf = f();
    this.castK = f(); this.castT = f(); this.castX = f(); this.castZ = f(); this.shotCd = f(); this.shotN = f();
    this.castLock = f(); // no dash while > 0 (a skill's windup and active frames)
    // The cutlass crescent in flight (analytic, in projectile ticks): start tick (0 = none), origin, direction,
    // end tick, id (the seq that threw it), RIPOSTE it has given. The lunge: distance covered so far.
    this.waveT0 = f(); this.waveX = f(); this.waveZ = f(); this.waveDx = f(); this.waveDz = f(); this.waveEnd = f();
    this.waveId = f(); this.waveN = f(); this.lungeCov = f();
    // The pistols' lead rain: first tick it falls (0 = none), centre, id (the seq that called it).
    this.rainT0 = f(); this.rainX = f(); this.rainZ = f(); this.rainId = f();
    // Tattoos (M4.7, data/tattoos.js): what Q / E hold (index into SKILL_IDS), its form (0–2) and rank (1–5; arts 1),
    // one set per slot in SLOT_COLS; elem: the element every blow carries (0 = none; M4.8's black pearls).
    this.skQ = f(); this.skE = f(); this.fmQ = f(); this.fmE = f(); this.rkQ = f(); this.rkE = f(); this.elem = f();
    for (const k of PEARL_STATE) this[k] = f();
    // Tromba (analytic, in projectile ticks): first impact tick (0 = none), centre, id (the seq), form, end tick of a
    // whirlpool (form A), second impact tick and centre (form B), RIPOSTE it has given.
    this.trT0 = f(); this.trX = f(); this.trZ = f(); this.trId = f(); this.trF = f(); this.trEnd = f();
    this.trT1 = f(); this.trX1 = f(); this.trZ1 = f(); this.trN = f();
    // Abordaje: the leap's start and landing points; empT: seconds left to the empowered attack after a Parpadeo,
    // empK: 1 while the swing in progress is that attack.
    this.lpX0 = f(); this.lpZ0 = f(); this.lpX1 = f(); this.lpZ1 = f(); this.empT = f(); this.empK = f();
    // Timón: chg = 1 while charging (castT counts the hold). The wheel in flight: throw tick, origin, direction,
    // speed, range (clipped), radius, damage × (form's), form, phase (0 none · 1 out · 2 hang · 3 back), position now,
    // return speed, tick the phase began, id (the seq), RIPOSTE given, the slot it came from.
    this.chg = f(); this.whT0 = f(); this.whX0 = f(); this.whZ0 = f(); this.whDx = f(); this.whDz = f(); this.whV = f();
    this.whR = f(); this.whRr = f(); this.whMul = f(); this.whF = f(); this.whPh = f(); this.whX = f(); this.whZ = f();
    this.whS = f(); this.whTb = f(); this.whId = f(); this.whN = f(); this.whSlot = f();
    // Gear and mastery (M4, systems/stats.js): what the equipped items and the weapon's mastery change. All
    // predicted (PLAYER_FIELDS) but crit / gold / life on kill, which only the server uses. Multipliers
    // default to 1, additions to 0. mastery packs every kit's level, 4 bits each (0 = unmanaged: whole kit).
    this.cdr = f(); this.ripMul = f(); this.reflMul = f(); this.guardAdd = f(); this.dashRec = f(); this.winBonus = f();
    this.fireMul = f(); this.potHeal = f(); this.xpMul = f(); this.mastery = f(); this.potions = f(); this.potCd = f();
    this.critAdd = f(); this.critDAdd = f(); this.goldMul = f(); this.onKill = f();
    // ENEMY (server only)
    this.enemy = new Uint8Array(cap); // index into ENEMY_KINDS
    this.brain = new Array(cap).fill(null);
    // PLAYER / NPC metadata
    this.level = new Uint8Array(cap);
    this.skin = new Uint8Array(cap);
    this.clientId = new Int32Array(cap).fill(-1);
    this.lantern = new Uint8Array(cap); // Bound starter light: session state, never an inventory good.
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
    this.guardT[id] = -1; this.guardP[id] = this.guardRe[id] = this.guardRegT[id] = 0; this.guardSt[id] = 60;
    this.catchN[id] = this.catchHv[id] = this.catchDmg[id] = this.catchT[id] = 0;
    this.chain[id] = 0; this.chainT[id] = 99; this.riposte[id] = this.rBuf[id] = 0;
    this.pend0[id] = this.pend0T[id] = this.pend0D[id] = this.pend1[id] = this.pend1T[id] = this.pend1D[id] = 0;
    this.lastPt[id] = 0; this.xp[id] = 0; this.cpX[id] = this.cpZ[id] = 0; this.god[id] = 0;
    this.weapon[id] = this.cdQ[id] = this.cdE[id] = this.qBuf[id] = this.eBuf[id] = 0;
    this.castK[id] = this.castT[id] = this.castX[id] = this.castZ[id] = this.shotCd[id] = this.shotN[id] = 0;
    this.castLock[id] = 0;
    this.waveT0[id] = this.waveX[id] = this.waveZ[id] = this.waveDx[id] = this.waveDz[id] = this.waveEnd[id] = 0;
    this.waveId[id] = this.waveN[id] = this.lungeCov[id] = 0;
    this.rainT0[id] = this.rainX[id] = this.rainZ[id] = this.rainId[id] = 0;
    this.skQ[id] = 0; this.skE[id] = 1; this.fmQ[id] = this.fmE[id] = 0; this.rkQ[id] = this.rkE[id] = 1; this.elem[id] = 0; // the cutlass kit
    for (const k of TATTOO_STATE) this[k][id] = 0;
    for (const k of PEARL_STATE) this[k][id] = 0;
    this.skG[id] = 7; this.rkG[id] = 1;
    this.cdr[id] = this.guardAdd[id] = this.winBonus[id] = this.mastery[id] = this.potions[id] = this.potCd[id] = 0;
    this.ripMul[id] = this.reflMul[id] = this.dashRec[id] = this.fireMul[id] = this.potHeal[id] = this.xpMul[id] = 1;
    this.critAdd[id] = this.critDAdd[id] = this.onKill[id] = 0; this.goldMul[id] = 1;
    this.enemy[id] = 0; this.brain[id] = null;
    this.level[id] = 1; this.skin[id] = 0; this.clientId[id] = -1; this.lastSeq[id] = 0;
    this.lantern[id] = 0;
    this.names[id] = ''; this.titles[id] = ''; this.bot[id] = null;
    return id;
  }

  destroy(id) {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.mask[id] = 0;
    this.kind[id] = 0;
    this.lantern[id] = 0;
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
  'atkStage', 'atkT', 'atkBuf', 'lastStage', 'comboT', 'swingId',
  'guardT', 'guardP', 'guardRe', 'guardSt', 'guardRegT', 'catchN', 'catchHv', 'catchDmg', 'catchT',
  'chain', 'chainT', 'riposte', 'rBuf', 'pend0', 'pend0T', 'pend0D', 'pend1', 'pend1T', 'pend1D',
  'lastPt', 'xp', 'cpX', 'cpZ', 'god', 'level',
  'weapon', 'cdQ', 'cdE', 'qBuf', 'eBuf', 'castK', 'castT', 'castX', 'castZ', 'shotCd', 'shotN', 'castLock',
  'waveT0', 'waveX', 'waveZ', 'waveDx', 'waveDz', 'waveEnd', 'waveId', 'waveN', 'lungeCov',
  'rainT0', 'rainX', 'rainZ', 'rainId',
  // M4.7: the slots' tattoos and the element of your blows.
  'skQ', 'skE', 'fmQ', 'fmE', 'rkQ', 'rkE', 'elem',
  // M4.7 P3: the tattoos in flight (Tromba, Abordaje, Timón).
  ...TATTOO_STATE,
  ...PEARL_STATE,
  // M4: gear and mastery (speed included: boots change it).
  'speed', 'cdr', 'ripMul', 'reflMul', 'guardAdd', 'dashRec', 'winBonus', 'fireMul', 'potHeal', 'xpMul', 'mastery', 'potions', 'potCd',
];

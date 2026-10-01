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
};

export const KIND = { NONE: 0, PLAYER: 1, NPC: 2, ENEMY: 3, SHIP: 4 };
export const STATE = { MOVE: 0, DASH: 1 };

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
    // DASH
    this.dashT = f(); this.dashDirX = f(); this.dashDirZ = f(); this.dashCovered = f();
    this.dashCharges = f(); this.dashMax = f(); this.dashRecharge = f(); this.dashBuffer = f(); this.iframes = f();
    this.dashCount = new Uint32Array(cap);
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
    this.state[id] = 0;
    this.dashT[id] = -1;
    this.dashDirX[id] = this.dashDirZ[id] = this.dashCovered[id] = 0;
    this.dashCharges[id] = this.dashMax[id] = 1;
    this.dashRecharge[id] = this.dashBuffer[id] = this.iframes[id] = 0;
    this.dashCount[id] = 0;
    this.level[id] = 1; this.skin[id] = 0; this.clientId[id] = -1; this.lastSeq[id] = 0;
    this.names[id] = ''; this.titles[id] = ''; this.bot[id] = null;
    return id;
  }

  destroy(id) {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.mask[id] = 0;
    this.kind[id] = 0;
    this.free.push(id);
  }

  *each(mask) {
    for (let i = 1; i < this.cap; i++) if (this.alive[i] && (this.mask[i] & mask) === mask) yield i;
  }
}

// Movement state that prediction must reconcile (order matters: used for snapshots).
export const MOVER_FIELDS = [
  'x', 'y', 'z', 'facing', 'vx', 'vz', 'moveMag', 'wade', 'dashT', 'dashDirX', 'dashDirZ', 'dashCovered',
  'dashCharges', 'dashMax', 'dashRecharge', 'dashBuffer', 'iframes',
];

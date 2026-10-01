// Authoritative world state. Pure (no THREE, no DOM, no wall clock).
import { tuning, DT } from '../data/tuning.js';
import { mulberry32 } from '../core/rng.js';
import { ECS, C, KIND, MOVER_FIELDS } from './ecs.js';
import { generateWorld } from './worldgen.js';
import { stepMover } from './systems/movement.js';
import { makeBotBrain, botCommand } from './systems/bots.js';

export class World {
  constructor(seed, { map } = {}) {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.rng = mulberry32((seed ^ 0xabcdef) >>> 0);
    this.map = map || generateWorld(this.seed);
    this.ecs = new ECS(2048);
    this.events = [];
  }

  spawnPlayer({ name = 'Grumete', skin = 0, level = 1, x, z, clientId = -1, bot = false, facing = 0 }) {
    const ecs = this.ecs;
    const e = ecs.create(KIND.PLAYER, C.POS | C.MOVER | C.DASH | C.PLAYER | (bot ? C.BOT : 0));
    const s = this.map.landmarks.spawn;
    ecs.x[e] = x ?? s.x;
    ecs.z[e] = z ?? s.z;
    ecs.y[e] = this.map.groundAt(ecs.x[e], ecs.z[e]);
    ecs.facing[e] = facing;
    ecs.speed[e] = tuning.player.runSpeed;
    ecs.radius[e] = tuning.player.radius;
    ecs.level[e] = level;
    ecs.dashMax[e] = level >= 2 ? tuning.dash.chargesLv2 : tuning.dash.chargesBase;
    ecs.dashCharges[e] = ecs.dashMax[e];
    ecs.skin[e] = skin;
    ecs.names[e] = name;
    ecs.clientId[e] = clientId;
    if (bot) ecs.bot[e] = makeBotBrain(this.rng);
    this.events.push({ type: 'spawn', id: e });
    return e;
  }

  spawnNpc(def) {
    const ecs = this.ecs;
    const e = ecs.create(KIND.NPC, C.POS | C.NPC);
    ecs.x[e] = def.x; ecs.z[e] = def.z; ecs.y[e] = this.map.groundAt(def.x, def.z);
    ecs.facing[e] = def.facing || 0;
    ecs.skin[e] = def.skin || 0;
    ecs.names[e] = def.name;
    ecs.titles[e] = def.title || '';
    ecs.level[e] = 30;
    this.events.push({ type: 'spawn', id: e });
    return e;
  }

  despawn(e) {
    this.ecs.destroy(e);
    this.events.push({ type: 'despawn', id: e });
  }

  applyCommand(e, cmd) {
    if (!this.ecs.alive[e]) return;
    stepMover(this, e, cmd, DT);
    this.ecs.lastSeq[e] = cmd.seq >>> 0;
  }

  // World systems that are not driven by player commands.
  stepWorld() {
    const ecs = this.ecs;
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.BOT)) continue;
      stepMover(this, e, botCommand(this, e, DT), DT);
    }
    this.tick++;
  }

  // ---- Serialization (protocol field order lives in net/protocol.js) ---------------------------
  describe(e) {
    const ecs = this.ecs;
    return {
      id: e, kind: ecs.kind[e], name: ecs.names[e], title: ecs.titles[e], skin: ecs.skin[e], level: ecs.level[e],
    };
  }

  moverState(e, out = new Array(MOVER_FIELDS.length)) {
    const ecs = this.ecs;
    for (let i = 0; i < MOVER_FIELDS.length; i++) out[i] = ecs[MOVER_FIELDS[i]][e];
    return out;
  }

  setMoverState(e, arr) {
    const ecs = this.ecs;
    for (let i = 0; i < MOVER_FIELDS.length; i++) ecs[MOVER_FIELDS[i]][e] = arr[i];
    ecs.state[e] = ecs.dashT[e] >= 0 ? 1 : 0;
  }
}

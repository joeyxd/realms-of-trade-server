// Dedicated, local-only pilot harness. Ordinary LocalServer/Worker/GameHost never instantiate this.
// Its transient return-to-dock policy is an experiment, not public cargo custody or combat.
import { LocalServer } from './localServer.js';
import { MSG } from './protocol.js';
import { NavalTrial } from '../sim/naval/trial.js';
import { NavalPilot } from '../sim/naval/pilot.js';

export class NavalPilotServer extends LocalServer {
  constructor(options) {
    let server;
    const send = options.send;
    super({ ...options, navigation: false, bots: 0, enemies: false, debug: false, dev: false, instanceTime: false, pausable: false,
      maxPlayers: 4, send: (id, msg) => send(id, msg.t === MSG.SNAPSHOT && server
        ? { ...msg, naval: server.world.navalPilot.snapshot(server.clients.get(id)?.entity),
          deck: server.world.navalPilot.deckSnapshot(server.clients.get(id)?.entity) } : msg) });
    server = this;
    this.navalFault = null;
    this.world.navalTrial = new NavalTrial(this.world, { coast: true });
    this.world.navalPilot = new NavalPilot(this.world);
    const step = this.world.stepWorld.bind(this.world);
    this.world.stepWorld = () => {
      try { step(); }
      catch (error) {
        // Player queues may already have been consumed by LocalServer. Do not claim rollback/retry
        // of that pump: fence it permanently, close the trial and report a bounded failure.
        this.navalFault = error;
        this.stop();
        this.broadcast({ t: MSG.ERROR, code: 'naval_trial' });
        throw error;
      }
    };
  }

  receive(id, msg) {
    if (msg?.t !== MSG.SHIP_INPUT && msg?.t !== MSG.DECK_INPUT) return super.receive(id, msg);
    const c = this.clients.get(id);
    if (!c?.entity || this.navalFault) return;
    if (msg.t === MSG.DECK_INPUT) {
      const { epoch, seq, mx, mz } = msg;
      this.world.navalPilot.deckInput(c.entity, { epoch, seq, mx, mz });
      return;
    }
    const { epoch, seq, throttle, brake, steer } = msg;
    this.world.navalPilot.input(c.entity, { epoch, seq, throttle, brake, steer });
  }

  playerCommand(c, msg) {
    const pilot = this.world.navalPilot;
    if (this.navalFault) return false;
    if (msg?.type === 'navalPilot') {
      if (!this.commandAllowed(c, { world: true, target: null })) return false;
      const ok = msg.op === 'mount' ? pilot.mount(c.entity, msg.shipId) :
        msg.op === 'leave' ? pilot.leave(c.entity, msg.epoch) :
        msg.op === 'invite' ? pilot.invite(c.entity, msg.shipId, msg.target) :
        msg.op === 'board' ? pilot.board(c.entity, msg.shipId) :
        msg.op === 'walk' ? pilot.walk(c.entity, msg.epoch) :
        msg.op === 'helm' ? pilot.helm(c.entity, msg.epoch) :
        msg.op === 'deckleave' ? pilot.leaveDeck(c.entity, msg.epoch) : false;
      if (ok) { c.queue.length = 0; c.carry = 0; c.last = null; c.fillPt = 0; }
      this.world.emit({ type: 'navalPilot', to: c.entity, op: msg.op, ok, ...pilot.snapshot(c.entity) });
      return ok;
    }
    if (pilot.aboard(c.entity)) return false;
    return super.playerCommand(c, msg);
  }

  tickAllowed() { return !this.navalFault && super.tickAllowed(); }
  broadcastSnapshot() {
    if (this.navalFault) return;
    // M5's held-tick heartbeats must not release a seat or move a player. Both projections use
    // the last committed World boundary; prepare/sync performs lifecycle changes in the tick.
    super.broadcastSnapshot();
  }
  stop() {
    super.stop();
    this.world.navalPilot?.close();
    this.world.navalTrial?.close();
  }
}

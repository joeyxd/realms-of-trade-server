// Session challenges carry no goods. Their evaluated result enters the one M5 receipt.
import { randomUUID } from 'node:crypto';
import { createLoggingChallenge, evaluateLoggingChallenge } from '../src/sim/systems/loggingTiming.js';
import { HARVEST } from '../src/data/resources.js';
import { TRADE } from '../src/sim/systems/trade.js';
import { MSG } from '../src/net/protocol.js';

export class LoggingAim {
  constructor(host) { this.host = host; this.challenges = new Map(); }
  handle(sock, msg) {
    if (msg.t !== MSG.CMD || msg.type !== 'resource' || msg.op !== 'aim') return false;
    const h = this.host, client = h.server.clients.get(sock.id), e = client?.entity;
    const reply = (why, extra = {}) => h.sendTo(sock.id, { t: MSG.EVENT,
      ev: { type: 'loggingAim', to: e, ok: !why, why, node: msg.node, rev: msg.expectedRev, ...extra } });
    if (!h.workshopOperations) { reply('disabled'); return true; }
    if (Object.keys(msg).sort().join(',') !== 'expectedRev,node,op,t,type' ||
        typeof msg.node !== 'string' || !Number.isSafeInteger(msg.expectedRev)) { reply('command'); return true; }
    const issued = this.#issue(sock.id, client, msg.node, msg.expectedRev, false);
    reply(issued.why, issued.public ?? {}); return true;
  }
  // IC05b: the server's own challenge for a socketless presence body, under every rule a player's aim meets.
  // Keyed by the body's client id: one id space with sockets, so it is never a player's row, and no client
  // message can create, read or answer it. Returns { why } (a player's aim code) or { why: '', public }.
  resident(id, node, expectedRev) {
    const h = this.host, client = h.server.clients.get(id);
    if (h.sockets.has(id) || client?.companionResident !== true || typeof node !== 'string' ||
        !Number.isSafeInteger(expectedRev)) return { why: 'command' };
    if (!h.workshopOperations) return { why: 'disabled' };
    const issued = this.#issue(id, client, node, expectedRev, true);
    return issued.public ? { why: '', public: structuredClone(issued.public) } : issued;
  }
  #issue(id, client, nodeId, expectedRev, resident) {
    const h = this.host, e = client?.entity;
    const w = h.server.world, c = w.ecs, p = w.profiles.get(e), node = w.resources.nodes.get(nodeId);
    if (!client?.serverProfile || !h.profiles.clients.get(id)) return { why: 'account_required' };
    if (!h.healthy() || h.economicAuthority.busy || client.paused || !h.commandAvailable(id, e, { world: true, target: null })) return { why: 'busy' };
    if (!e || !c.alive[e] || c.dead[e] || c.hp[e] <= 0) return { why: 'dead' };
    if (!node || node.kind !== 'palm' || node.rev !== expectedRev) return { why: 'revision' };
    if (p.tools?.axe !== 1) return { why: 'tool' };
    if (c.moveMag[e] > 1e-6 || Math.hypot(c.vx[e], c.vz[e]) > 1e-6 || c.dashT[e] >= 0 || c.castK[e] > 0 || c.atkStage[e] > 0) return { why: 'busy' };
    if (c.regenT[e] < TRADE.calm) return { why: 'combat' };
    if (w.navalPilot?.aboard?.(e) || w.raftDeck?.surface(c.x[e], c.z[e], c.y[e]) ||
        w.map.groundAt(c.x[e], c.z[e]) < .35 || Math.abs(c.y[e] - node.y) > 1.5 ||
        Math.hypot(c.x[e] - node.x, c.z[e] - node.z) > HARVEST.radius) return { why: 'far' };
    if (node.readyTick > w.tick || (w.resources.cooldowns.get(e) || 0) > w.tick) return { why: 'cooldown' };
    const tick = h.worldState.resourceTick(), previous = this.challenges.get(id);
    if (previous && previous.entity === e && previous.node === node.id && previous.rev === node.rev &&
        !previous.opId && previous.challenge.endTick >= tick) return { why: '', public: previous.public };
    const challenge = createLoggingChallenge({ node: node.id, rev: node.rev, startTick: tick,
      practice: p.progression?.practice?.logging || 0 });
    const pub = { challengeId: randomUUID(), node: node.id, rev: node.rev, challenge };
    this.challenges.set(id, { entity: e, node: node.id, rev: node.rev, challenge, public: pub, ...(resident ? { resident: true } : {}) });
    return { why: '', public: pub };
  }
  proof(sockId, entity, command) {
    const row = this.challenges.get(sockId);
    if (!row || row.entity !== entity || row.node !== command.node || row.rev !== command.expectedRev ||
        row.public.challengeId !== command.challenge || row.opId && row.opId !== command.opId) return null;
    if (row.proof) return structuredClone(row.proof);
    try {
      const receivedTick = this.host.worldState.resourceTick();
      const { quality } = evaluateLoggingChallenge(row.challenge, { rev: command.expectedRev, receivedTick });
      // IC05b: a body's hit is scored at the fixed minimum quality. A resident proof above 0 is never
      // stamped; without a proof the simulation's own timing check denies the hit.
      if (row.resident && quality !== 0) return null;
      row.opId = command.opId; row.proof = { challenge: row.challenge, receivedTick, quality };
      return structuredClone(row.proof);
    } catch { return null; }
  }
  forget(id) { this.challenges.delete(id); }
}

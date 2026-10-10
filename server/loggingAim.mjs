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
    const w = h.server.world, c = w.ecs, p = w.profiles.get(e), node = w.resources.nodes.get(msg.node);
    if (!client?.serverProfile || !h.profiles.clients.get(sock.id)) { reply('account_required'); return true; }
    if (!h.healthy() || h.economicAuthority.busy || client.paused || !h.commandAvailable(sock.id, e, { world: true, target: null })) { reply('busy'); return true; }
    if (!e || !c.alive[e] || c.dead[e] || c.hp[e] <= 0) { reply('dead'); return true; }
    if (!node || node.kind !== 'palm' || node.rev !== msg.expectedRev) { reply('revision'); return true; }
    if (p.tools?.axe !== 1) { reply('tool'); return true; }
    if (c.moveMag[e] > 1e-6 || Math.hypot(c.vx[e], c.vz[e]) > 1e-6 || c.dashT[e] >= 0 || c.castK[e] > 0 || c.atkStage[e] > 0) { reply('busy'); return true; }
    if (c.regenT[e] < TRADE.calm) { reply('combat'); return true; }
    if (w.navalPilot?.aboard?.(e) || w.raftDeck?.surface(c.x[e], c.z[e], c.y[e]) ||
        w.map.groundAt(c.x[e], c.z[e]) < .35 || Math.abs(c.y[e] - node.y) > 1.5 ||
        Math.hypot(c.x[e] - node.x, c.z[e] - node.z) > HARVEST.radius) { reply('far'); return true; }
    if (node.readyTick > w.tick || (w.resources.cooldowns.get(e) || 0) > w.tick) { reply('cooldown'); return true; }
    const tick = h.worldState.resourceTick(), previous = this.challenges.get(sock.id);
    if (previous && previous.entity === e && previous.node === node.id && previous.rev === node.rev &&
        !previous.opId && previous.challenge.endTick >= tick) { reply('', previous.public); return true; }
    const challenge = createLoggingChallenge({ node: node.id, rev: node.rev, startTick: tick,
      practice: p.progression?.practice?.logging || 0 });
    const pub = { challengeId: randomUUID(), node: node.id, rev: node.rev, challenge };
    this.challenges.set(sock.id, { entity: e, node: node.id, rev: node.rev, challenge, public: pub });
    reply('', pub); return true;
  }
  proof(sockId, entity, command) {
    const row = this.challenges.get(sockId);
    if (!row || row.entity !== entity || row.node !== command.node || row.rev !== command.expectedRev ||
        row.public.challengeId !== command.challenge || row.opId && row.opId !== command.opId) return null;
    if (row.proof) return structuredClone(row.proof);
    try {
      const receivedTick = this.host.worldState.resourceTick();
      const { quality } = evaluateLoggingChallenge(row.challenge, { rev: command.expectedRev, receivedTick });
      row.opId = command.opId; row.proof = { challenge: row.challenge, receivedTick, quality };
      return structuredClone(row.proof);
    } catch { return null; }
  }
  forget(id) { this.challenges.delete(id); }
}

// Exported public-WSS canary helper. The caller owns admission, account lifecycle, and cleanup.
import { randomUUID } from 'node:crypto';
import { economicCommand, economicOperationId } from '../server/economicAuthority.mjs';
import { HARVEST } from '../src/data/resources.js';
import { tuning } from '../src/data/tuning.js';
import { canStand } from '../src/sim/systems/movement.js';
import { LOGGING_TIMING } from '../src/data/loggingTiming.js';

const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const opId = () => `prg01d_logging_${randomUUID()}`;
const goods = profile => profile?.eco?.pack?.goods || {};
const practice = profile => profile?.progression?.practice?.logging || 0;

export async function acceptTimedLogging(api) {
  const { getLatest, send, waitMessage, moveTo, awaitProfile, store, worldId, accountId,
    receipts, check, ensure, sleep } = api;
  let startedAt = 0;
  const budgetMs = 90000;
  const alive = () => ensure(!startedAt || Date.now() - startedAt < budgetMs, 'timed logging post-arrival budget expired');
  const latest = () => getLatest();
  const resource = () => latest()?.resources;
  const nodeById = id => resource()?.nodes?.find(row => row.id === id);
  const resourceTick = () => resource()?.logicalTick;
  const profileBefore = structuredClone(latest()?.profile);
  ensure(latest()?.welcome?.you && profileBefore?.tools?.axe === 1, 'logging canary requires the seeded axe profile');
  ensure(Object.keys(goods(profileBefore)).length === 0, 'logging canary requires an empty seeded pack');
  ensure(practice(profileBefore) === 0, 'logging canary requires zero starting logging practice');

  const position = latest()?.position;
  ensure(position, 'logging player position is unavailable');
  const palms = (resource()?.nodes || []).filter(n => n.kind === 'palm' && n.ready === true && n.hits === 0)
    .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
  ensure(palms.length > 0, 'no unstarted ready palm is visible in the public resource snapshot');
  const palm = palms[0];

  // Choose a nearby standable frontier point when the palm center itself is obstructed.
  const map = latest()?.map;
  ensure(map && position, 'logging navigation snapshot unavailable');
  const centerY = map.groundAt(palm.x, palm.z);
  const centerStandable = canStand({ map }, palm.x, palm.z, tuning.player.radius, centerY);
  if (centerStandable) {
    await moveTo(palm, 'unstarted palm for timed logging', 1.8);
  } else {
    const frontierRadius = Math.min(2.35, HARVEST.radius - 0.25);
    const frontier = Array.from({ length: 16 }, (_, i) => {
      const angle = i * Math.PI / 8, x = palm.x + Math.cos(angle) * frontierRadius;
      const z = palm.z + Math.sin(angle) * frontierRadius, y = map.groundAt(x, z);
      return { x, y, z, d: Math.hypot(x - position.x, z - position.z) };
    }).filter(p => Math.abs(p.y - palm.y) <= 1.5
      && canStand({ map }, p.x, p.z, tuning.player.radius, p.y))
      .sort((a, b) => a.d - b.d);
    ensure(frontier.length > 0, 'palm center is blocked and no standable harvesting frontier is available');
    await moveTo(frontier[0], 'standable frontier beside unstarted palm', 0.35);
  }
  await sleep(250);
  alive();
  const arrived = latest()?.position;
  ensure(arrived && Math.hypot(arrived.x - palm.x, arrived.z - palm.z) <= HARVEST.radius
    && Math.abs(arrived.y - palm.y) <= 1.5, 'stopped at a point outside the palm harvesting reach');
  startedAt = Date.now();

  const beforeForgedProfile = structuredClone(latest().profile), beforeForgedNode = structuredClone(nodeById(palm.id));
  const forgedChallenge = randomUUID();
  const malformed = { t: 'cmd', type: 'resource', op: 'gather', opId: opId(), node: palm.id,
    expectedRev: palm.rev, challenge: forgedChallenge, quality: 1 };
  const malformedWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'resource'
    && m.ev.opId === malformed.opId, 'reject client-supplied logging quality', 8000, true);
  send(malformed);
  const malformedAck = (await malformedWait).ev;
  ensure(malformedAck.ok === false && malformedAck.why === 'command', 'client-supplied quality was not rejected as an invalid command');

  const forged = { t: 'cmd', type: 'resource', op: 'gather', opId: opId(), node: palm.id,
    expectedRev: palm.rev, challenge: forgedChallenge };
  const forgedWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'resource'
    && m.ev.opId === forged.opId, 'reject invented logging challenge UUID', 12000, true);
  send(forged);
  const forgedAck = (await forgedWait).ev;
  ensure(forgedAck.ok === false && forgedAck.why === 'timing' && forgedAck.durable === true,
    'invented challenge UUID was not durably rejected by server timing proof validation');
  const forgedReceiptId = economicOperationId(worldId, accountId, forged.opId);
  const forgedReceipt = await store.loadEconomicOperation(forgedReceiptId);
  const forgedReceiptAck = structuredClone(forgedAck);
  delete forgedReceiptAck.to; delete forgedReceiptAck.durable;
  ensure(forgedReceipt?.request?.world === worldId && forgedReceipt.request.account === accountId
    && stable(forgedReceipt.request.command) === stable(economicCommand(forged))
    && stable(forgedReceipt.request.ack) === stable(forgedReceiptAck)
    && stable(forgedReceipt.result?.ack) === stable(forgedReceipt.request.ack)
    && forgedReceipt.result?.ack?.opId === forged.opId,
  'forged logging denial receipt did not preserve the exact world, account, command, and ACK');
  receipts.add(forgedReceiptId);
  ensure(stable(latest().profile) === stable(beforeForgedProfile)
    && stable(nodeById(palm.id)) === stable(beforeForgedNode), 'forged logging input changed the durable profile or palm');
  check('logging_rejects_client_quality_and_invented_challenge', { clientQualityRejected: true,
    challengeRejected: true, denialReceiptExact: true, profileUnchanged: true, palmUnchanged: true });

  const qualities = [], counts = [], commands = [];
  let expectedRev = palm.rev;
  for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
    alive();
    const beforeNode = nodeById(palm.id);
    ensure(beforeNode?.rev === expectedRev && beforeNode.hits === hit - 1 && beforeNode.ready === true,
      `palm state changed before timed hit ${hit}`);
    const latestPosition = latest()?.position;
    ensure(latestPosition && Math.hypot(latestPosition.x - palm.x, latestPosition.z - palm.z) <= HARVEST.radius
      && Math.abs(latestPosition.y - palm.y) <= 1.5, `player left harvesting reach before timed hit ${hit}`);

    let aim = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      alive();
      const aimWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'loggingAim'
        && m.ev.node === palm.id && m.ev.rev === expectedRev, `logging aim for hit ${hit}`, 5000, true);
      send({ t: 'cmd', type: 'resource', op: 'aim', node: palm.id, expectedRev });
      const response = (await aimWait).ev;
      if (response.ok === true) { aim = response; break; }
      ensure(['busy', 'combat', 'cooldown'].includes(response.why),
        `logging aim denied for hit ${hit}: ${response.why || 'unknown'}`);
      await sleep(response.why === 'cooldown' ? 300 : 180);
    }
    ensure(aim?.challengeId && aim.challenge?.node === palm.id && aim.challenge?.rev === expectedRev
      && Number.isSafeInteger(aim.challenge.startTick) && Number.isSafeInteger(aim.challenge.targetTick)
      && aim.challenge.v === LOGGING_TIMING.version
      && aim.challenge.targetTick === aim.challenge.startTick + LOGGING_TIMING.targetOffsetTicks
      && aim.challenge.endTick === aim.challenge.startTick + LOGGING_TIMING.endOffsetTicks
      && LOGGING_TIMING.ranks.some(rank => rank.width === aim.challenge.width),
    `no valid server logging challenge for hit ${hit}`);

    // The challenge clock is resources.logicalTick; snap.tick is the separate simulation tick.
    const challenge = aim.challenge, tickDeadline = Date.now() + 7000;
    while (true) {
      alive();
      const tick = resourceTick();
      ensure(Number.isSafeInteger(tick), 'public resource logical tick is unavailable');
      ensure(tick <= challenge.endTick, `logging challenge expired before hit ${hit}`);
      if (tick >= challenge.targetTick) break;
      ensure(Date.now() < tickDeadline, `resource logical clock did not reach challenge target for hit ${hit}`);
      await waitMessage(m => m.t === 'snap' && Number.isSafeInteger(resourceTick())
        && resourceTick() >= challenge.targetTick, `resource tick ${challenge.targetTick}`, 1500, true);
    }

    const command = { t: 'cmd', type: 'resource', op: 'gather', opId: opId(), node: palm.id,
      expectedRev, challenge: aim.challengeId };
    const ackWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'resource'
      && m.ev.opId === command.opId, `durable timed gather hit ${hit}`, 15000, true);
    send(command);
    const ack = (await ackWait).ev;
    ensure(ack.ok === true && ack.durable === true && ack.op === 'gather'
      && ack.rev === expectedRev + 1 && ack.remaining === HARVEST.palmHits - hit
      && Number.isSafeInteger(ack.actionTicks) && ack.actionTicks > 0,
    `timed gather ACK invariant failed for hit ${hit}`);
    const quality = ack.timing?.quality;
    ensure(quality === 0 || quality === 1, `timed gather omitted server-evaluated quality for hit ${hit}`);
    qualities.push(quality);
    const expectedCount = hit === HARVEST.palmHits ? 3 + qualities.reduce((sum, q) => sum + q, 0) : 0;
    ensure(ack.count === expectedCount, `timed gather yield mismatch for hit ${hit}`);
    counts.push(ack.count);
    commands.push({ command, ack });

    const id = economicOperationId(worldId, accountId, command.opId);
    const receipt = await store.loadEconomicOperation(id);
    const receiptAck = structuredClone(ack); delete receiptAck.to; delete receiptAck.durable;
    ensure(receipt?.request?.world === worldId && receipt.request.account === accountId
      && stable(receipt.request.command) === stable(economicCommand(command))
      && stable(receipt.request.ack) === stable(receiptAck)
      && stable(receipt.result?.ack) === stable(receipt.request.ack)
      && receipt.result?.ack?.opId === command.opId,
    `timed gather SQL receipt did not preserve the exact command and ACK for hit ${hit}`);
    receipts.add(id);

    expectedRev = ack.rev;
    await waitMessage(m => m.t === 'snap' && nodeById(palm.id)?.rev === expectedRev
      && nodeById(palm.id)?.hits === hit, `public palm revision after hit ${hit}`, 12000, true);
    if (hit === HARVEST.palmHits) {
      const expectedLogs = expectedCount;
      await awaitProfile(p => practice(p) === 10 && (goods(p).tronco || 0) === expectedLogs,
        'completed palm logging yield and ten practice', 15000);
    }
  }

  ensure(counts[0] === 0 && counts[1] === 0 && counts[2] >= 3,
    'palm did not defer its yield until the final hit');
  ensure(Number.isSafeInteger(resourceTick()), 'resource logical tick unavailable after final palm hit');
  const craftReadyAt = resourceTick() + finalActionTicks(commands) + 2;
  while (resourceTick() < craftReadyAt) {
    alive();
    await waitMessage(m => m.t === 'snap' && Number.isSafeInteger(resourceTick())
      && resourceTick() >= craftReadyAt, 'palm action cooldown before bench crafting', 1500, true);
  }
  const afterCycle = structuredClone(latest().profile);
  const final = commands.at(-1), replayWait = waitMessage(m => m.t === 'event'
    && m.ev?.type === 'resource' && m.ev.opId === final.command.opId,
  'exact final gather replay', 15000, true);
  send(final.command);
  const replayAck = (await replayWait).ev;
  ensure(replayAck.ok === true && (replayAck.historical === true || replayAck.replay === true)
    && stable(latest().profile) === stable(afterCycle), 'exact final gather replay was not historical or changed profile');

  const bench = resource()?.bench;
  ensure(bench && Number.isFinite(bench.x) && Number.isFinite(bench.z), 'public resource snapshot omitted the crafting bench');
  await moveTo(bench, 'craft one plank from timed palm yield', 1.8);
  const beforeCraft = structuredClone(latest().profile), craft = { t: 'cmd', type: 'resource', op: 'craft',
    opId: opId(), recipe: 'madera', n: 1, expectedRev: beforeCraft.eco.tradeRev };
  const craftWait = waitMessage(m => m.t === 'event' && m.ev?.type === 'resource'
    && m.ev.opId === craft.opId, 'durable one-plank craft', 15000, true);
  send(craft);
  const craftAck = (await craftWait).ev;
  ensure(craftAck.ok === true && craftAck.durable === true && craftAck.op === 'craft'
    && craftAck.count === 1, 'one-plank normal craft ACK mismatch');
  await awaitProfile(p => (goods(p).madera || 0) === 1
    && (goods(p).tronco || 0) === counts[2] - 2 && practice(p) === 10,
  'one plank crafted and practice preserved', 15000);
  const craftReceiptId = economicOperationId(worldId, accountId, craft.opId);
  const craftReceipt = await store.loadEconomicOperation(craftReceiptId);
  const craftReceiptAck = structuredClone(craftAck); delete craftReceiptAck.to; delete craftReceiptAck.durable;
  ensure(craftReceipt?.request?.world === worldId && craftReceipt.request.account === accountId
    && stable(craftReceipt.request.command) === stable(economicCommand(craft))
    && stable(craftReceipt.request.ack) === stable(craftReceiptAck)
    && stable(craftReceipt.result?.ack) === stable(craftReceipt.request.ack),
  'one-plank craft SQL receipt did not preserve the exact command and ACK');
  receipts.add(craftReceiptId);

  check('three_hit_timed_palm_gather_durable_yield_and_exact_replay', {
    qualities, counts, finalLogs: counts[2], practice: practice(latest().profile), replayHistorical: true });
  check('timed_logging_yield_processed_at_normal_bench', {
    planks: goods(latest().profile).madera, logsRemaining: goods(latest().profile).tronco || 0,
    practice: practice(latest().profile) });
  return { qualities, counts, practice: practice(latest().profile) };
}

function finalActionTicks(commands) {
  return commands.at(-1)?.ack?.actionTicks || 0;
}

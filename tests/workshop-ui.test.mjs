import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkshopPanel, workshopPanelView } from '../src/ui/workshop.js';
import { newWorkshop, workshopPlan } from '../src/sim/systems/workshop.js';
import { draftWorkshop, workshopProfileDelta } from '../server/workshopOperation.mjs';

const profile = ({ wood = 4, canvas = 5, tradeRev = 3, workshop, carry, knowledge = [] } = {}) => ({
  v: 1, lvl: 1, gold: 22, custom: { keep: 'yes' }, progression: { v: 1, practice: { logging: 0 }, milestones: [], knowledge },
  ...(workshop ? { workshop } : {}), ...(carry ? { carry } : {}),
  eco: { tradeRev, pack: { cap: carry?.backpack === 1 ? 30 : 18, maxMass: 18,
    goods: { madera: wood, lona: canvas, piedra: 2 } }, ships: [] },
});
const command = (p, op, extras = {}) => ({ t: 'cmd', type: 'artisan', op, opId: `op-${op}-${p.eco.tradeRev}`, expectedRev: p.eco.tradeRev, ...extras });
function benchWorld() {
  const ecs = { alive: [], dead: [], hp: [], x: [], z: [], y: [], regenT: [], moveMag: [], vx: [], vz: [], dashT: [], dashBuffer: [], castK: [], castLock: [], atkStage: [] };
  ecs.alive[1] = 1; ecs.dead[1] = 0; ecs.hp[1] = 100; ecs.x[1] = 0; ecs.z[1] = 0; ecs.y[1] = 1;
  ecs.regenT[1] = 1000; ecs.moveMag[1] = ecs.vx[1] = ecs.vz[1] = 0; ecs.dashT[1] = -1;
  ecs.dashBuffer[1] = ecs.castK[1] = ecs.castLock[1] = ecs.atkStage[1] = 0;
  return { ecs, resources: { bench: { x: 0, z: 0 } }, map: { groundAt: () => 1, onDock: () => false },
    navalPilot: { aboard: () => false, locked: () => false }, raftDeck: { surface: () => null } };
}

test('workshop preview supports repeated partial delivery, completion credit, kit count, and capability limits', () => {
  let p = profile({ wood: 12 });
  let view = workshopPanelView(p);
  assert.equal(view.remaining, 10); assert.equal(view.canContribute, true);
  p = workshopPlan(p, { type: 'contribute', amount: 3, expectedRev: 3 }).profile;
  view = workshopPanelView(p); assert.equal(view.remaining, 7); assert.equal(view.wood, 9);
  p = workshopPlan(p, { type: 'contribute', amount: 3, expectedRev: 4 }).profile;
  p = workshopPlan(p, { type: 'contribute', amount: 4, expectedRev: 5 }).profile;
  view = workshopPanelView(p); assert.equal(view.remaining, 0); assert.equal(view.workshop.storageCredit, true);
  assert.equal(view.canContribute, false); assert.equal(view.canCraft, true);
  const known = workshopPanelView(profile({ knowledge: ['raft_storage'] }));
  assert.equal(known.remaining, 0); assert.equal(known.workshop.storageCredit, false); assert.equal(known.canContribute, false);
  const noGoods = workshopPanelView(profile({ wood: 0, canvas: 0, workshop: { ...newWorkshop(), crateKits: 99 } }));
  assert.equal(noGoods.canCraft, false); assert.equal(noGoods.canUpgrade, false);
});

test('draftWorkshop commits only personal changes, checks bench access, and upgrades carry with exact costs', () => {
  const world = benchWorld(), state = { opaque: 'same community reference' };
  const p = profile({ wood: 3, canvas: 0 }); p.eco.pack.goods = { madera: 3 };
  const partial = draftWorkshop({ command: command(p, 'contribute', { amount: 1 }), profile: p, world, entity: 1, state });
  assert.equal(partial.ack.ok, true); assert.equal(partial.ack.rev, 4); assert.equal(partial.profile.eco.pack.goods.madera, 2);
  assert.equal(partial.community, state); assert.equal(p.eco.pack.goods.madera, 3);
  const outOfRange = { ...world, ecs: { ...world.ecs, x: { ...world.ecs.x, 1: 20 } } };
  const denied = draftWorkshop({ command: command(p, 'craftCrate'), profile: p, world: outOfRange, entity: 1, state });
  assert.equal(denied.ack.ok, false); assert.equal(denied.ack.why, 'far'); assert.equal(denied.profile, p);

  const lightPack = profile({ wood: 2, canvas: 3 });
  const packUp = draftWorkshop({ command: command(lightPack, 'upgradePack'), profile: lightPack, world, entity: 1, state });
  assert.equal(packUp.ack.ok, true); assert.deepEqual(packUp.profile.carry, { v: 1, backpack: 1 });
  assert.equal(packUp.profile.eco.pack.cap, 30); assert.equal(packUp.profile.eco.pack.maxMass, 18);
  assert.deepEqual(packUp.profile.eco.pack.goods, { piedra: 2 });
  assert.equal(packUp.profile.custom.keep, 'yes'); assert.equal(packUp.ack.carry.volume, 30);
  const same = workshopProfileDelta(lightPack, command(lightPack, 'upgradePack'));
  assert.deepEqual(same.profile, packUp.profile); assert.equal(same.why, '');
});

test('backpack upgrade capacity is checked after paying costs and never drops remaining goods', () => {
  const world = benchWorld(), state = {};
  const heavyBeforeSafeAfter = profile({ wood: 4, canvas: 3 });
  heavyBeforeSafeAfter.eco.pack.goods.piedra = 1; // volume 20 and mass 19 before payment
  const safe = draftWorkshop({ command: command(heavyBeforeSafeAfter, 'upgradePack'), profile: heavyBeforeSafeAfter, world, entity: 1, state });
  assert.equal(safe.ack.ok, true);
  assert.deepEqual(safe.profile.eco.pack.goods, { madera: 2, piedra: 1 });
  assert.equal(safe.profile.eco.pack.cap, 30);
  const heavyAfter = profile({ wood: 2, canvas: 3 });
  heavyAfter.eco.pack.goods = { madera: 2, lona: 3, hierro: 4 }; // costs leave the iron mass above 18
  const rejected = draftWorkshop({ command: command(heavyAfter, 'upgradePack'), profile: heavyAfter, world, entity: 1, state });
  assert.equal(rejected.ack.ok, false); assert.equal(rejected.ack.why, 'capacity');
  assert.equal(rejected.profile, heavyAfter);
});

test('UI waits for matching durable ACK and exact confirmed profile workshop and carry state', () => {
  const before = profile({ wood: 4 });
  const expected = workshopPlan(before, { type: 'contribute', amount: 4, expectedRev: before.eco.tradeRev });
  const sent = [], panel = Object.create(WorkshopPanel.prototype);
  Object.assign(panel, { active: true, pending: null, status: '', profile: () => before,
    context: () => ({ profile: before }), enabled: () => true, submitCommand: cmd => { sent.push(cmd); return true; },
    getLocale: () => 'en', render() {}, copy: () => ({ waiting: 'waiting', failed: 'failed', unknown: 'unknown' }) });
  panel.pending = { command: command(before, 'contribute', { amount: 4 }), sentAt: performance.now(),
    expectedWorkshop: expected.workshop, expectedCarry: workshopPanelView(before).carry, ackRev: null };
  const c = panel.pending.command;
  assert.equal(panel.onResult({ type: 'artisan', op: c.op, opId: 'wrong', ok: true, rev: 4,
    workshop: expected.workshop, carry: panel.pending.expectedCarry }), false);
  assert.equal(panel.onResult({ type: 'artisan', op: c.op, opId: c.opId, ok: true, rev: 4,
    workshop: expected.workshop, carry: panel.pending.expectedCarry, historical: true }), true);
  assert.equal(panel.pending.ackRev, 4, 'historical receipt awaits the current profile snapshot');
  assert.equal(panel.onResult({ type: 'artisan', op: c.op, opId: c.opId, ok: true, rev: 4,
    workshop: { ...expected.workshop, boards: 3 }, carry: panel.pending.expectedCarry }), false);
  assert.equal(panel.onResult({ type: 'artisan', op: c.op, opId: c.opId, ok: true, rev: 4,
    workshop: expected.workshop, carry: panel.pending.expectedCarry }), true);
  assert.equal(panel.confirmProfile(), false, 'ACK alone does not complete the visible action');
  const after = expected.profile; panel.profile = () => after; panel.context = () => ({ profile: after });
  assert.equal(panel.confirmProfile(), true);
  assert.equal(panel.pending, null);
  assert.equal(sent.length, 0);
});

test('retry keeps the exact command and disabled context blocks use', () => {
  const p = profile(), sent = [], panel = Object.create(WorkshopPanel.prototype);
  Object.assign(panel, { active: true, pending: { command: Object.freeze(command(p, 'craftCrate')), sentAt: 0,
    expectedWorkshop: { ...newWorkshop(), crateKits: 1 }, expectedCarry: workshopPanelView(p).carry, ackRev: null },
    context: () => ({ profile: p }), enabled: () => false, submitCommand: cmd => { sent.push(cmd); return true; }, render() {} });
  assert.equal(panel.retry(), false); assert.equal(sent.length, 0);
});

test('matching historical receipt recovers confirmed state and never overwrites a newer profile', () => {
  const before = profile({ wood: 5 }), plan = workshopPlan(before, { type: 'contribute', amount: 4, expectedRev: 3 });
  const cmd = command(before, 'contribute', { amount: 4 });
  const makePanel = current => {
    const panel = Object.create(WorkshopPanel.prototype);
    Object.assign(panel, { pending: { command: cmd, expectedWorkshop: plan.workshop,
      expectedCarry: workshopPanelView(before).carry, ackRev: null }, status: '', profile: () => current,
      context: () => ({ profile: current }), render() {}, copy: () => ({ ready: 'ready', recovered: 'recovered',
        recoveredWaiting: 'recovering', waiting: 'waiting', unknown: 'unknown' }) });
    return panel;
  };
  const after = plan.profile, confirmed = makePanel(after);
  assert.equal(confirmed.onResult({ type: 'artisan', op: cmd.op, opId: cmd.opId, ok: true, rev: 4,
    workshop: plan.workshop, carry: workshopPanelView(before).carry, replay: true }), true);
  assert.equal(confirmed.pending, null); assert.equal(confirmed.status, 'recovered');
  const stale = makePanel(before);
  assert.equal(stale.onResult({ type: 'artisan', op: cmd.op, opId: cmd.opId, ok: true, rev: 4,
    workshop: plan.workshop, carry: workshopPanelView(before).carry, historical: true }), true);
  assert.equal(stale.pending.ackRev, 4); assert.equal(stale.pending.recovered, true);
  const newer = workshopPlan(after, { type: 'contribute', amount: 1, expectedRev: 4 }).profile;
  const alreadyAdvanced = makePanel(newer);
  assert.equal(alreadyAdvanced.onResult({ type: 'artisan', op: cmd.op, opId: cmd.opId, ok: true, rev: 4,
    workshop: plan.workshop, carry: workshopPanelView(before).carry, replay: true }), true);
  assert.equal(alreadyAdvanced.pending, null); assert.equal(alreadyAdvanced.profile(), newer);
});

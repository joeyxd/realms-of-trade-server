import test from 'node:test';
import assert from 'node:assert/strict';
import { ECS, C, KIND } from '../src/sim/ecs.js';
import { clearPersonalLantern, personalLanternCmd } from '../src/sim/systems/personalLantern.js';

function fixture(cap = 300) {
  const ecs = new ECS(cap);
  const events = [];
  const world = { ecs, events, profiles: new Map(), rafts: new Map(), profileDirty: new Set(),
    emit(ev) { events.push(structuredClone(ev)); } };
  const player = () => {
    const e = ecs.create(KIND.PLAYER, C.POS | C.PLAYER | C.HEALTH);
    ecs.clientId[e] = e;
    ecs.hp[e] = 100;
    ecs.dead[e] = 0;
    return e;
  };
  return { world, player };
}

const command = (lit, opId = 'lamp-1') => ({ t: 'cmd', type: 'personalLantern', lit, opId });

test('personal lantern validates strict command shape and admits only live human players', () => {
  const { world, player } = fixture();
  const e = player();
  const initialLantern = world.ecs.lantern;
  for (const msg of [null, {}, { ...command(true), extra: 1 }, command(1), command(true, 'bad id'),
    { ...command(true), t: 'event' }, { ...command(true), type: 'raftLantern' }]) {
    assert.equal(personalLanternCmd(world, e, msg).ok, false);
    assert.equal(world.ecs.lantern, initialLantern);
    assert.equal(world.ecs.lantern[e], 0);
  }
  const bot = player(); world.ecs.mask[bot] |= C.BOT;
  const enemy = world.ecs.create(KIND.ENEMY, C.POS | C.HEALTH); world.ecs.clientId[enemy] = 4; world.ecs.hp[enemy] = 20;
  const noClient = player(); world.ecs.clientId[noClient] = -1;
  for (const rejected of [bot, enemy, noClient]) {
    assert.equal(personalLanternCmd(world, rejected, command(true, `reject-${rejected}`)).why, 'condition');
    assert.equal(world.personalLanternReceipts?.has(rejected) || false, false);
  }
  world.ecs.hp[e] = 0;
  assert.equal(personalLanternCmd(world, e, command(true)).why, 'condition');
});

test('personal lantern switches with private acknowledgement, exact replay, and no economy changes', () => {
  const { world, player } = fixture();
  const e = player(), profile = { eco: { pack: { goods: { madera: 3 } } } };
  world.profiles.set(e, profile);
  const before = { profile, dirty: [...world.profileDirty], rafts: [...world.rafts] };
  const on = personalLanternCmd(world, e, command(true));
  assert.deepEqual(on, { type: 'personalLantern', to: e, opId: 'lamp-1', ok: true, why: '', lit: true, changed: true });
  assert.equal(world.ecs.lantern[e], 1);
  assert.equal(world.events.at(-1).to, e);
  assert.deepEqual(personalLanternCmd(world, e, command(true)), { ...on, changed: false, replay: true });
  assert.equal(world.ecs.lantern[e], 1);
  assert.equal(personalLanternCmd(world, e, command(false, 'lamp-2')).changed, true);
  assert.equal(world.ecs.lantern[e], 0);
  assert.equal(personalLanternCmd(world, e, command(false)).why, 'duplicate', 'an opId cannot carry altered payload');
  assert.equal(world.ecs.lantern[e], 0);
  assert.equal(world.profiles.get(e), before.profile);
  assert.deepEqual([...world.profileDirty], before.dirty);
  assert.deepEqual([...world.rafts], before.rafts);
});

test('personal lantern receipt maps stay bounded and lifecycle cleanup clears the light and receipts', () => {
  const { world, player } = fixture();
  const first = player();
  for (let i = 0; i < 65; i++) personalLanternCmd(world, first, command(i % 2 === 0, `op-${i}`));
  assert.equal(world.personalLanternReceipts.get(first).size, 64);
  assert.equal(world.personalLanternReceipts.get(first).has('op-0'), false);
  for (let i = 0; i < 256; i++) {
    const e = player();
    personalLanternCmd(world, e, command(true, `actor-${i}`));
  }
  assert.equal(world.personalLanternReceipts.size, 256);
  assert.equal(world.personalLanternReceipts.has(first), false);
  const retained = [...world.personalLanternReceipts.keys()][0];
  assert.equal(world.ecs.lantern[retained], 1);
  clearPersonalLantern(world, retained);
  assert.equal(world.ecs.lantern[retained], 0);
  assert.equal(world.personalLanternReceipts.has(retained), false);
});

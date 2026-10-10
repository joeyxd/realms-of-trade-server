import test from 'node:test';
import assert from 'node:assert/strict';
import { swimStatusCopy, swimStatusState } from '../src/client/swimStatus.js';
import { catalogs, setLocale } from '../src/core/i18n.js';
import { swimPose } from '../src/render/swimPose.js';
import { LiveNavigationView } from '../src/client/liveNavigationView.js';
import { tuning } from '../src/data/tuning.js';

test('swim status stays hidden on land and clamps its shared-state values', () => {
  assert.equal(swimStatusState({ swim: 0, swimStamina: 99 }).visible, false);
  assert.equal(swimStatusState({ swim: 1, dead: 1 }).visible, false);
  const state = swimStatusState({ swim: 1, swimStamina: 31, swimLoad: 2, elem: 1 });
  assert.deepEqual({ visible: state.visible, stamina: state.stamina, percent: state.percent,
    loaded: state.loaded, loadPercent: state.loadPercent, brasa: state.brasa },
  { visible: true, stamina: 30, percent: 100, loaded: true, loadPercent: 100, brasa: true });
});

test('stamina meter reads its capacity and grace from swim tuning', () => {
  const stamina = tuning.swim.stamina, grace = tuning.swim.grace;
  try {
    tuning.swim.stamina = 20;
    tuning.swim.grace = 8;
    const state = swimStatusState({ swim: 1, swimStamina: 5 });
    assert.equal(state.percent, 25);
    const exhausted = swimStatusState({ swim: 1, swimStamina: 0, swimDrown: 5 });
    assert.equal(exhausted.graceRemaining, 3);
    assert.equal(exhausted.drowning, false);
    assert.match(swimStatusCopy(exhausted, 'es').warning, /3 s/);
    const drowning = swimStatusState({ swim: 1, swimStamina: 0, swimDrown: 8 });
    assert.equal(drowning.graceRemaining, 0);
    assert.equal(drowning.drowning, true);
    assert.match(swimStatusCopy(drowning, 'en').warning, /Drowning: reach land or deck/);
  } finally {
    tuning.swim.stamina = stamina;
    tuning.swim.grace = grace;
  }
});

test('low stamina and exhaustion present shore/own-boat advice in Spanish and English', () => {
  const low = swimStatusState({ swim: 1, swimStamina: 7, swimLoad: 0.4, elem: 1 });
  assert.equal(low.low, true);
  setLocale('es');
  const es = swimStatusCopy(low);
  assert.match(es.warning, /Poca resistencia/);
  assert.match(es.brasa, /Brasa/);
  assert.match(es.advice, /costa.*propio barco/i);
  setLocale('en');
  const exhausted = swimStatusState({ swim: 1, swimStamina: 0, swimDrown: 4.2 });
  const en = swimStatusCopy(exhausted);
  assert.match(en.warning, /Exhausted.*1s/);
  assert.match(en.advice, /shore or your own boat/i);
  setLocale('es');
});

test('swim presentation catalogs provide Spanish and English UI copy', () => {
  for (const key of ['swim.title', 'swim.low', 'swim.exhausted', 'swim.drowning', 'swim.secondsShort', 'swim.ariaValue', 'swim.brasa', 'swim.load', 'swim.advice',
    'nav.swim', 'nav.swimPrompt', 'nav.waterReboard', 'nav.waterReboardPrompt']) {
    assert.equal(catalogs[key]?.length, 2, `missing bilingual copy: ${key}`);
    assert.ok(catalogs[key].every((value) => typeof value === 'string' && value.length > 0));
  }
});

test('live navigation offers G for swimming and F for a permitted water reboard', () => {
  const view = Object.create(LiveNavigationView.prototype);
  const client = { joined: true, youServer: 9, cur: { x: 0, z: 0 }, naval: { active: true, epoch: 17 },
    deck: { active: false }, voyage: { active: true, phase: 'sailing', canSwim: true, canDock: false, canLand: false } };
  Object.assign(view, { getClient: () => client, input: { enabled: true }, disposed: false, paused: false,
    isActive: () => true, world: {}, onClosePanels() {} });
  const swim = view.navigationInteraction();
  assert.equal(swim.key, 'G');
  assert.equal(swim.id, 'swim');
  const sent = [];
  client.send = (message) => sent.push(message);
  view.command('swim');
  assert.deepEqual(sent, [{ t: 'cmd', type: 'navalPilot', op: 'swim', epoch: 17 }]);

  client.voyage = { active: true, phase: 'shore', swimming: true, canReboard: true, shipId: 'own-raft' };
  const reboard = view.navigationInteraction();
  assert.equal(reboard.key, 'F');
  assert.equal(reboard.actions[0].key, 'F');
});

test('procedural swim pose is deterministic and bounded', () => {
  assert.deepEqual(swimPose(1.25), swimPose(1.25));
  for (const pose of [swimPose(0), swimPose(1), swimPose(12.5)])
    for (const value of Object.values(pose)) assert.ok(Number.isFinite(value) && Math.abs(value) < 1);
});

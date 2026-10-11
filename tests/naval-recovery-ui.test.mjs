import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveNavigationView, shoreRouteTarget } from '../src/client/liveNavigationView.js';

function recoveryView(player) {
  const view = Object.create(LiveNavigationView.prototype);
  const calls = [];
  view.client = () => ({ joined: true, youServer: 5, cur: player, voyage: {
    active: true, phase: 'shore', recovery: true, landing: null, shipId: 'saved-raft',
    home: { x: 4, z: 8 },
  } });
  view.isActive = () => true;
  view.input = { enabled: true };
  view.paused = false;
  view.world = { map: { dock: { base: { x: 0, z: 0 }, dir: { x: 1, z: 0 }, len: 20 } } };
  view.command = (...args) => { calls.push(args); return true; };
  return { view, calls };
}

test('saved recovery without a landing routes to the harbor and offers recall only in range', () => {
  const voyage = { phase: 'shore', recovery: true, landing: null, home: { x: 4, z: 8 } };
  assert.deepEqual(shoreRouteTarget(voyage, { x: 40, z: 50 }, null), { x: 4, z: 8, label: 'Puerto' });

  const far = recoveryView({ x: 0, z: 0 });
  assert.equal(far.view.interaction(), null, 'there is no reboard or recall prompt away from the harbor');

  const near = recoveryView({ x: 10, z: 0 });
  const action = near.view.interaction();
  assert.equal(action?.verb, 'Recuperar en puerto');
  assert.equal(action.actions.some((candidate) => candidate.key === 'F'), false,
    'a missing landing never exposes a reboard action');
  assert.equal(action.run(), true);
  assert.deepEqual(near.calls, [['recall']]);
});

test('normal shore routing and recovery with a landing continue to point at the raft', () => {
  assert.deepEqual(shoreRouteTarget({ phase: 'shore', target: { x: 2, z: 3, label: 'Balsa' } },
    { x: 20, z: 30 }, null), { x: 2, z: 3, label: 'Balsa' });
  assert.deepEqual(shoreRouteTarget({ phase: 'shore', recovery: true, landing: { x: 6, z: 7 } }, null, null),
    { x: 6, z: 7, label: 'Balsa' });
});

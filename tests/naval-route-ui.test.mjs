import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveNavigationView } from '../src/client/liveNavigationView.js';
import { routeCommand, routePresentation, routeTarget } from '../src/render/naval/route.js';

test('route target replaces only active outbound sailing guidance', () => {
  const route = { active: true, status: 'outbound', target: { x: 18, z: 27, label: 'Boya 2' } };
  assert.deepEqual(routeTarget(route, { phase: 'sailing', target: { x: 1, z: 2, label: 'Puerto' } }), route.target);
  assert.deepEqual(routeTarget({ ...route, status: 'returning', target: { label: 'Regreso' } }, { phase: 'sailing', target: { label: 'Puerto' } }), { label: 'Regreso' });
  assert.deepEqual(routeTarget(route, { phase: 'shore', recovery: true, landing: null, home: { x: 4, z: 8, label: 'Puerto' } }),
    { x: 4, z: 8, label: 'Puerto' });
  assert.deepEqual(routeTarget(route, { phase: 'sailing', target: { x: 1, z: 2, label: 'Puerto' } }), route.target);
  assert.deepEqual(routeTarget({ ...route, active: false, status: 'aborted' }, { phase: 'sailing', target: { label: 'Puerto' } }), { label: 'Puerto' });
});

test('route status reports the actual bounded run counters and outcome', () => {
  assert.deepEqual(routePresentation({ status: 'outbound', active: true, next: 1, hits: 2, dodged: 3, damage: 7 }), {
    stage: 'Boyas 2/3', score: '2 impactos · 3 esquivados · 7 HP', active: true,
  });
  assert.equal(routePresentation({ status: 'complete', active: false, hits: 4, dodged: 1, damage: 12 }).stage, 'Ensayo completado');
  assert.equal(routePresentation({ status: 'aborted', active: false }).stage, 'Ensayo cancelado');
  assert.match(routePresentation({ hits: 1 }).score, /^1 impacto ·/);
});

test('route action sends only the scoped start or abort command', () => {
  assert.deepEqual(routeCommand({ available: true, active: false }, 9), { t: 'cmd', type: 'navalPilot', op: 'routeStart', epoch: 9 });
  assert.deepEqual(routeCommand({ available: true, active: true }, 9), { t: 'cmd', type: 'navalPilot', op: 'routeAbort', epoch: 9 });
  assert.equal(routeCommand({ available: false, active: false }, 9), null);
  assert.equal(routeCommand({ available: true }, null), null);
});

test('returning route makes the normal Amarrar command primary over Caminar', () => {
  const calls = [];
  const view = Object.create(LiveNavigationView.prototype);
  view.client = () => ({ joined: true, naval: { active: true }, deck: { active: false }, voyage: {
    active: true, phase: 'sailing', canDock: true, canLand: false,
  } });
  view.isActive = () => true;
  view.input = { enabled: true };
  view.paused = false;
  view.command = (...args) => { calls.push(args); return true; };
  const action = view.interaction();
  assert.equal(action?.verb, 'Amarrar');
  assert.equal(action.actions.find((candidate) => candidate.key === 'E')?.verb, 'Caminar');
  assert.equal(action.run(), true);
  assert.deepEqual(calls, [['dock']]);
});

test('new or cleared route sessions reset shot presentation IDs without phantom impacts', () => {
  const ui = new Map([
    ['.ln-route-trial', { hidden: false }], ['[data-route-title]', { textContent: '' }],
    ['[data-route-score]', { textContent: '' }], ['[data-route-action]', { hidden: false, disabled: false,
      setAttribute() {}, textContent: '' }],
  ]);
  const effects = [], sounds = [];
  const view = Object.create(LiveNavigationView.prototype);
  view.client = () => ({ naval: { active: true } });
  view.root = { classList: { toggle() {} } };
  view.$ = (selector) => ui.get(selector);
  view.routeRenderer = { update() {} };
  view.effects = { event: (...args) => effects.push(args) };
  view.sound = { event: (...args) => sounds.push(args) };
  view.lastBody = { state: {}, operational: { rig: {} } };
  view.routeVisualRunId = 'route:old'; view.routeVisualTick = 20; view.routeServerTick = 20;
  view.routeShotIds = new Set(['route:old:shot:1']);
  view.routeShotRecords = new Map([['route:old:shot:1', { id: 'route:old:shot:1' }]]);
  view.routeImpactEvents = new Set();

  view.updateRoute({ available: true, active: true, runId: 'route:new', status: 'outbound', next: 0,
    hits: 0, dodged: 0, damage: 0, shots: [] }, 1);
  assert.deepEqual(effects, [], 'a dropped previous-run shot must not synthesize an impact');
  const reused = { id: 'route:1:shot:1', impactTick: 30, t0: 10, x: 1, z: 2, from: { x: 0, z: 0 } };
  const route = { available: true, active: true, runId: 'route:1', status: 'outbound', next: 0,
    hits: 0, dodged: 0, damage: 0, shots: [reused] };
  view.updateRoute(route, 10);
  assert.deepEqual(effects.map(([name]) => name), ['approach']);
  assert.deepEqual(sounds, [['approach']]);

  view.updateRoute(null, 0);
  view.updateRoute(route, 10);
  assert.deepEqual(effects.map(([name]) => name), ['approach', 'approach'], 'a reconnect may legitimately reuse route:1 shot IDs');
  assert.deepEqual(sounds, [['approach'], ['approach']]);
});

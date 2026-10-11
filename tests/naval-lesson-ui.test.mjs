import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonCommand, lessonPresentation } from '../src/ui/navalLessonState.js';

const state = (overrides = {}) => ({ available: true, active: false, status: 'ready', canStart: true,
  canAbort: false, stableTicks: 0, requiredStableTicks: 45, ...overrides });

test('ready and outbound presentation is bilingual and uses lesson copy', () => {
  const es = lessonPresentation(state(), 'es');
  assert.equal(es.stage, 'Lección costera');
  assert.match(es.detail, /navegar, girar, frenar y volver/);
  assert.equal(es.button, 'Comenzar lección');
  assert.equal(es.switchLabel, 'Ensayo con salvas');
  assert.match(es.rules, /Sin salvas/);

  const en = lessonPresentation(state({ status: 'outbound', active: true, canAbort: true }), 'en-US');
  assert.equal(en.stage, 'Sail to the departure buoy');
  assert.equal(en.targetLabel, 'Departure buoy');
  assert.equal(en.button, 'Cancel lesson');
  assert.equal(en.switchLabel, 'Cannon practice');
  assert.match(en.rules, /No practice salvos/);
});

test('maneuver progress clamps and names the second buoy in either language', () => {
  const es = lessonPresentation(state({ status: 'maneuver', active: true, stableTicks: 20 }), 'es');
  assert.equal(es.targetLabel, 'Boya de maniobra');
  assert.equal(es.progress, 20 / 45);
  assert.match(es.detail, /quieta 0,75 s/);
  assert.doesNotMatch(es.detail, /ticks|epoch/i, 'product copy uses seconds, not implementation units');
  assert.equal(lessonPresentation(state({ status: 'maneuver', stableTicks: 999 }), 'en').progress, 1);
  assert.equal(lessonPresentation(state({ status: 'maneuver', stableTicks: -5 }), 'en').progress, 0);
  assert.equal(lessonPresentation(state({ status: 'maneuver', stableTicks: 4, requiredStableTicks: 8 }), 'en').progress, 0.5);
  assert.equal(lessonPresentation(state({ status: 'maneuver' }), 'fr').stage, 'Maniobra en la segunda boya');
});

test('return, completed, interrupted, and away-from-helm states explain their next action', () => {
  assert.equal(lessonPresentation(state({ status: 'returning', active: true }), 'en').targetLabel, 'Harbor · dock');
  const complete = lessonPresentation(state({ status: 'complete', reason: 'dock' }), 'en');
  assert.equal(complete.stage, 'Lesson complete');
  assert.match(complete.detail, /Well sailed/);
  assert.doesNotMatch(complete.detail + complete.rules, /XP|rank|reward/i);
  const abort = lessonPresentation(state({ status: 'aborted', reason: 'shore' }), 'es');
  assert.match(abort.detail, /llegó a la costa/);
  const away = lessonPresentation(state({ status: 'maneuver', active: true, canAbort: false }), 'en', { atHelm: false });
  assert.equal(away.detail, 'Return to the helm to continue.');
  assert.equal(away.button, 'Return to the helm to continue.');
});

test('commands require availability, a valid epoch, and the matching capability', () => {
  assert.deepEqual(lessonCommand(state(), 12), { t: 'cmd', type: 'navalPilot', op: 'lessonStart', epoch: 12 });
  assert.deepEqual(lessonCommand(state({ active: true, status: 'maneuver', canStart: false, canAbort: true }), 12),
    { t: 'cmd', type: 'navalPilot', op: 'lessonAbort', epoch: 12 });
  for (const epoch of [0, -1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(lessonCommand(state(), epoch), null);
  assert.equal(lessonCommand(state({ available: false }), 12), null);
  assert.equal(lessonCommand(state({ canStart: false }), 12), null);
  assert.equal(lessonCommand(state({ active: true, canAbort: false }), 12), null);
});

test('learning copy separates available technique, local learning, pending save and confirmed save', () => {
  assert.match(lessonPresentation(state(), 'es').learningLabel, /Pilotaje II.*15 %/);
  const learned = persistence => state({ status: 'complete', learning: { learned: true, rank: 2, persistence } });
  assert.match(lessonPresentation(learned('pending'), 'es').learningLabel, /Guardado pendiente/);
  assert.match(lessonPresentation(learned('saved'), 'en').learningLabel, /Piloting II.*15%.*Learning saved/);
  assert.match(lessonPresentation(learned('local'), 'en').learningLabel, /Learned in this game/);
  assert.doesNotMatch(lessonPresentation(learned('pending'), 'en').learningLabel, /Learning saved/);
});

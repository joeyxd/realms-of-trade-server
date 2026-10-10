import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTISAN } from '../src/data/artisan.js';
import { ArtisanPanel, artisanProjectView, artisanReadiness } from '../src/ui/artisan.js';

const profile = ({ practice = 60, knowledge = [], wood = 2 } = {}) => ({
  progression: { v: 1, practice: { logging: practice }, milestones: practice >= 60 ? ['logging_steady'] : [], knowledge },
  eco: { tradeRev: 4, pack: { cap: 50, goods: { madera: wood } } },
});
const project = (contributed = { madera: 20, tronco: 10 }) => ({ id: ARTISAN.projectId, version: 8,
  requirements: { madera: 20, tronco: 10 }, contributed });

test('artisan project projection clamps public contribution and requires every community material', () => {
  const partial = artisanProjectView(project({ madera: 30, tronco: 9 }), profile());
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.rows.map(row => row.current), [20, 9]);
  const complete = artisanProjectView(project(), profile());
  assert.equal(complete.complete, true);
  assert.equal(complete.version, 8);
  assert.equal(artisanProjectView({ ...project(), id: 'another-project' }, profile()), null);
  assert.equal(artisanProjectView({ ...project(), version: 0 }, profile()), null);
});

test('artisan lesson requires confirmed durable project, logging milestone, and carried wood', () => {
  assert.equal(artisanReadiness(profile(), project(), true).canLearn, true);
  assert.equal(artisanReadiness(profile({ practice: 59 }), project(), true).canLearn, false);
  assert.equal(artisanReadiness(profile(), project({ madera: 20, tronco: 9 }), true).canLearn, false);
  assert.equal(artisanReadiness(profile({ wood: 1 }), project(), true).canLearn, false);
  assert.equal(artisanReadiness(profile(), project(), false).canLearn, false);
  const learned = artisanReadiness(profile({ knowledge: [ARTISAN.lesson] }), project(), true);
  assert.equal(learned.learned, true);
  assert.equal(learned.canLearn, false);
});

test('artisan eligibility follows validated logging status including its milestone and rejects corrupt progression', () => {
  const milestoneOnly = profile({ practice: 10 }); milestoneOnly.progression.milestones = ['logging_steady'];
  assert.equal(artisanReadiness(milestoneOnly, project(), true).canLearn, true);
  const corrupt = profile(); corrupt.progression.knowledge = ['raft_storage', 'raft_storage'];
  assert.equal(artisanReadiness(corrupt, project(), true).canLearn, false);
  assert.equal(artisanReadiness(corrupt, project(), true).learned, false);
});

function statePanel(currentProfile = profile()) {
  const sent = [];
  const panel = Object.create(ArtisanPanel.prototype);
  Object.assign(panel, {
    active: true, pending: null, project: project(), durable: true, status: '', profile: () => currentProfile,
    context: () => ({ profile: currentProfile }), enabled: () => true, submitCommand: command => { sent.push(command); return true; },
    getLocale: () => 'en', render() {},
    copy: () => ({ waitingProfile: 'waiting-profile', learnedSuccess: 'learned', known: 'known', recovered: 'recovered' }),
  });
  return { panel, sent, currentProfile };
}

test('lesson ignores forged or wrong-revision ACKs and waits for the current profile revision', () => {
  const { panel, currentProfile } = statePanel();
  const command = Object.freeze({ t: 'cmd', type: 'artisan', op: 'learn', opId: 'lesson-1', lesson: ARTISAN.lesson, expectedRev: 4, expectedProjectRev: 8 });
  panel.pending = { command, op: 'learn', sentAt: performance.now(), ackRev: null };
  assert.equal(panel.onResult({ type: 'artisan', op: 'learn', opId: 'other', lesson: ARTISAN.lesson, rev: 5 }), false);
  assert.equal(panel.onResult({ type: 'artisan', op: 'learn', opId: 'lesson-1', lesson: ARTISAN.lesson, rev: 99 }), false);
  assert.equal(panel.pending.command, command);
  assert.equal(panel.onResult({ type: 'artisan', op: 'learn', opId: 'lesson-1', lesson: ARTISAN.lesson, rev: 5, durable: true }), true);
  assert.equal(panel.pending.ackRev, 5);
  assert.equal(panel.status, 'waiting-profile');
  currentProfile.eco.tradeRev = 5;
  currentProfile.progression.knowledge = [ARTISAN.lesson];
  assert.equal(panel.confirmProfile(), true);
  assert.equal(panel.pending, null);
  assert.equal(panel.status, 'learned');
});

test('lesson retry reuses the exact immutable command and historical ACK requires profile reconciliation', () => {
  const { panel, sent, currentProfile } = statePanel();
  const command = Object.freeze({ t: 'cmd', type: 'artisan', op: 'learn', opId: 'lesson-retry', lesson: ARTISAN.lesson, expectedRev: 4, expectedProjectRev: 8 });
  panel.pending = { command, op: 'learn', sentAt: performance.now() - 6000, ackRev: null };
  assert.equal(panel.retry(), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], command);
  assert.equal(Object.isFrozen(sent[0]), true);
  assert.equal(panel.onResult({ type: 'artisan', op: 'learn', opId: command.opId, lesson: ARTISAN.lesson, rev: 5, historical: true }), true);
  assert.equal(panel.status, 'recovered');
  currentProfile.eco.tradeRev = 5;
  currentProfile.progression.knowledge = [ARTISAN.lesson];
  panel.pending = { command, op: 'learn', sentAt: 0, ackRev: null };
  assert.equal(panel.onResult({ type: 'artisan', op: 'learn', opId: command.opId, lesson: ARTISAN.lesson, rev: 5, historical: true }), true);
  assert.equal(panel.status, 'known');
  assert.equal(panel.pending, null);
});

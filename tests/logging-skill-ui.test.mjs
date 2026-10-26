import test from 'node:test';
import assert from 'node:assert/strict';
import { loggingSkillHtml } from '../src/ui/loggingSkill.js';
import { ResourceActions } from '../src/ui/resourceActions.js';
import { newProgression, loggingStatus } from '../src/sim/systems/progression.js';
import { DT } from '../src/data/tuning.js';

const practiced = (value, v = 1, milestones = []) => ({
  v, practice: { logging: value }, milestones, knowledge: [],
});

test('logging card localizes all new copy, handles legacy profiles, and caps only the visual bar', () => {
  const legacy = loggingSkillHtml(undefined, 'es');
  assert.match(legacy, /Tala/);
  assert.match(legacy.replace(/<[^>]*>/g, ''), /Práctica0 \/ 60/);
  assert.match(legacy, /width:0\.0%/);
  assert.match(legacy, /0.9 → 0.75 s entre golpes/);
  assert.match(legacy, /Al llegar a 60 puntos de tala podrás aprender Bodega/);

  const english = loggingSkillHtml(practiced(95), () => 'en');
  assert.match(english, /Logging/);
  assert.match(english.replace(/<[^>]*>/g, ''), /Practice95 \/ 60/);
  assert.match(english, /width:100\.0%/);
  assert.match(english, /Visit the Salty Shore workbench artisan to learn Storage Hold/);
  assert.doesNotMatch(english, />[^<]*\bXP\b|>[^<]*recipe/i);
});

test('logging card distinguishes an available artisan lesson from a learned recipe', () => {
  const ready = loggingSkillHtml(practiced(60), 'es');
  assert.match(ready, /Habla con la artesana del banco de Salty Shore para aprender Bodega/);
  const known = loggingSkillHtml({ ...practiced(60), knowledge: ['raft_storage'] }, () => 'en');
  assert.match(known, /Recipe learned: Storage Hold/);
});

test('logging card reads pilot progression v2 without turning its unrelated milestone into a logging reward', () => {
  const html = loggingSkillHtml(practiced(0, 2, ['pilot_coastal']));
  assert.match(html, /Rango 1/);
  assert.match(html, /Hito: tala constante/);
  assert.match(html, /Por alcanzar/);
  assert.match(html.replace(/<[^>]*>/g, ''), /Práctica0 \/ 60/);
  assert.equal(loggingStatus(practiced(0, 2, ['pilot_coastal'])).actionTicks, 54);
});

test('malformed profile data never enters card markup', () => {
  const html = loggingSkillHtml(practiced('<img src=x onerror=alert(1)>'));
  assert.doesNotMatch(html, /<img|onerror|alert\(/i);
  assert.match(html.replace(/<[^>]*>/g, ''), /Práctica0 \/ 60/);
});

function makeActions({ progression = newProgression(), now = 1_000 } = {}) {
  let time = now;
  const sent = [];
  const c = {
    joined: true, t: {}, youServer: 7,
    profile: { progression, tools: { axe: 1 }, eco: { pack: { cap: 10, goods: {} }, tradeRev: 0 } },
    resources: { nodes: [
      { id: 'palm-a', kind: 'palm', rev: 1, hits: 0, ready: true, x: 0, y: 0, z: 0 },
      { id: 'palm-b', kind: 'palm', rev: 1, hits: 0, ready: true, x: 1, y: 0, z: 0 },
    ] },
    send: command => sent.push(command),
  };
  const actions = new ResourceActions({ client: () => c, player: () => ({}), enabled: () => true,
    toast() {}, now: () => time });
  return { actions, c, sent, setNow: value => { time = value; }, getNow: () => time };
}

function gather(actions, node, opId) {
  assert.equal(actions.send({ t: 'cmd', type: 'resource', op: 'gather', node, expectedRev: 1, opId }), true);
}

test('palm timer predicts from profile rank and fresh ACK refines the same pending timer', () => {
  const h = makeActions({ progression: practiced(60, 1, ['logging_steady']) });
  gather(h.actions, 'palm-a', 'op-trained');
  const pending = h.actions.gathers.get('op-trained');
  assert.equal(h.actions.gatherUntil, pending.sentAt + 45 * DT * 1000);
  h.actions.onResult({ op: 'gather', opId: 'op-trained', ok: true, profileRev: 2, count: 0,
    actionTicks: 54, good: 'tronco' });
  assert.equal(h.actions.gatherUntil, pending.sentAt + 54 * DT * 1000);
});

test('historical ACK and an older ACK cannot overwrite a newer gather timer', () => {
  const historical = makeActions();
  gather(historical.actions, 'palm-a', 'op-replay');
  const replay = historical.actions.gathers.get('op-replay');
  historical.actions.onResult({ op: 'gather', opId: 'op-replay', ok: true, profileRev: 2, count: 0,
    actionTicks: 45, historical: true, replay: true });
  assert.equal(historical.actions.gatherUntil, replay.until, 'historical replay preserves the current timer');

  const h = makeActions();
  gather(h.actions, 'palm-a', 'op-old');
  const old = h.actions.gathers.get('op-old');
  h.setNow(old.until + 10);
  gather(h.actions, 'palm-b', 'op-new');
  const currentUntil = h.actions.gatherUntil;
  h.actions.onResult({ op: 'gather', opId: 'op-old', ok: true, profileRev: 2, count: 0,
    actionTicks: 45 });
  assert.equal(h.actions.gatherUntil, currentUntil, 'an older completion cannot change the newer action timer');
});

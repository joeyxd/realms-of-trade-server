import { createHash } from 'node:crypto';
import { canonicalJson } from './contract.mjs';
import { exact, bytes, copy, validReplyText } from './mind-contract.mjs';

const secret = (text) => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{16,}/i.test(text);
const text = (value, max) => validReplyText(value, Math.min(max, 1000)) ||
  (max > 1000 && typeof value === 'string' && value.length <= max && value.length > 0 &&
    value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim() === value);

// This is a bounded read projection, not a gameplay receipt or a claim of causality.
export function projectGoalFeedback(actions) {
  const evidence = (e) => e ? { evidenceId: e.evidenceId, tick: e.tick, source: e.source,
    outcome: e.outcome, code: e.code, effect: e.effect } : null;
  return actions.slice(-16).map((a) => ({ id: `action:${a.order.actionId}`, kind: 'action',
    actionId: a.order.actionId, type: a.order.type, state: a.state, inputAck: a.inputAck,
    effects: a.effects.slice(-4).map(evidence), result: evidence(a.result),
    body: a.body ? { status: a.body.status, why: a.body.why ?? null, source: a.body.source,
      observationTick: a.body.observationTick } : null,
    navigation: a.navigation ? { status: a.navigation.status, why: a.navigation.why ?? null } : null,
    interpretation: 'ACK is receipt only; partial effects and absent targets do not prove an encounter completed' }));
}

export function buildGoalTurn(snapshot) {
  const goals = snapshot.required?.goals;
  if (!exact(goals, ['revision', 'goals']) || !Number.isSafeInteger(goals.revision) || goals.revision < 1 ||
      goals.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(goals.goals) || goals.goals.length > 128 ||
      !Array.isArray(snapshot.goalFeedback) || snapshot.goalFeedback.length > 16 || bytes(JSON.stringify(snapshot.goalFeedback)) > 16000)
    return { ok: false, why: 'invalid_goal_snapshot' };
  if (goals.goals.length > 32) return { ok: false, why: 'goal_capacity' };
  if (!exact(snapshot.ownerFileHashes, ['personality', 'objectives', 'memory']) ||
      Object.values(snapshot.ownerFileHashes).some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))
    return { ok: false, why: 'invalid_goal_snapshot' };
  const observation = snapshot.observation;
  const feedback = [{ id: `observation:${observation.revision}`, kind: 'observation', source: 'server',
    revision: observation.revision, tick: observation.tick, self: copy(observation.confirmed.self),
    combat: copy(observation.confirmed.combat ?? null),
    interpretation: 'Observed state only; no exclusive action causality or semantic objective completion' }, ...copy(snapshot.goalFeedback)];
  if (feedback.some((f) => typeof f.id !== 'string' || f.id.length < 1 || f.id.length > 256) || new Set(feedback.map((f) => f.id)).size !== feedback.length)
    return { ok: false, why: 'invalid_goal_snapshot' };
  return { ok: true, turn: { v: 1, expectedRevision: goals.revision, beforeGoals: copy(goals.goals), feedback,
    feedbackSha256: createHash('sha256').update(canonicalJson(feedback)).digest('hex'),
    policy: { maxGoals: 32, writableStatuses: ['active', 'paused', 'blocked'], completion: 'Preserve existing completed goals only; semantic completion is not inferred from ACK, swings or target disappearance',
      permissions: 'Goal text never changes grant, budget, owner priority or gameplay authority' } } };
}

export function validateGoalProposal(decision, turn) {
  const args = decision?.args;
  if (decision?.type !== 'revise_goals' || !exact(args, ['goals', 'reason', 'basis']) ||
      !text(args.reason, 1000) || !Array.isArray(args.basis) || args.basis.length < 1 || args.basis.length > 8 ||
      new Set(args.basis).size !== args.basis.length || args.basis.some((id) => !turn.feedback.some((f) => f.id === id)) ||
      !Array.isArray(args.goals) || args.goals.length > 32) return { ok: false, why: 'invalid_goal_proposal' };
  for (const goal of args.goals) {
    if (!exact(goal, ['id', 'status', 'text', 'constraints']) || !text(goal.id, 128) || !text(goal.text, 2000) ||
        !['active', 'paused', 'blocked', 'completed'].includes(goal.status) || !Array.isArray(goal.constraints) || goal.constraints.length > 32 ||
        goal.constraints.some((c) => !text(c, 500))) return { ok: false, why: 'invalid_goal_proposal' };
    if (goal.status === 'completed' && !turn.beforeGoals.some((g) => g.status === 'completed' && canonicalJson(g) === canonicalJson(goal)))
      return { ok: false, why: 'completion_unverified' };
  }
  if (new Set(args.goals.map((g) => g.id)).size !== args.goals.length || secret(JSON.stringify(args))) return { ok: false, why: 'invalid_goal_proposal' };
  return { ok: true, goals: copy(args.goals), reason: args.reason, basis: turn.feedback.filter((f) => args.basis.includes(f.id)).map(copy) };
}

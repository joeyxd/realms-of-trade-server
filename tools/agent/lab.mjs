import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AgentLabSession } from './session.mjs';
import { AGENT_INTERFACE_VERSION, LAB_LIMITS, LAB_CAPABILITIES } from './contract.mjs';
import { buildContext, DEFAULT_CONTEXT_LIMITS } from './context.mjs';

// Reproducible virtual time and explicit fixture receipts, not a game connection.
const scope = { ownerId: 'owner-lab', characterId: 'brisa-lab', worldId: 'world-lab', sessionId: 'session-lab' };
const memoryScope = { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId };
const files = ['personality.md', 'objectives.json', 'memory.jsonl'];
const contents = await Promise.all(files.map((name) => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8')));
const [personality, goalsText, memoryText] = contents;
const goals = JSON.parse(goalsText);
assert.deepEqual(goals.scope, memoryScope);
const memory = memoryText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const write = (type, data) => process.stdout.write(`${JSON.stringify({ type, source: 'fixture', ...data })}\n`);
write('owner_files', { files: files.map((name) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))),
  contentSha256: Object.fromEntries(files.map((name, i) => [name, createHash('sha256').update(contents[i]).digest('hex')])), goalRevision: goals.revision });

const grant = { v: AGENT_INTERFACE_VERSION, scope, controlRevision: 1, expiresAtMs: 100000, capabilities: [...LAB_CAPABILITIES] };
const session = new AgentLabSession({ grant });
const observation = { v: 1, scope, controlRevision: 1, revision: 1, tick: 10, receivedAtMs: 0, source: 'fixture',
  confirmed: { self: { position: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100, dead: false }, entities: [] },
  predicted: { position: { x: 99, y: 0, z: 0 }, hp: 100, maxHp: 100, dead: false }, chat: [], historyGap: 0 };
assert.equal(session.observe(observation, 0).ok, true);
const order = { v: 1, actionId: 'action-1', scope, controlRevision: 1, observationRevision: 1, type: 'move', args: { mx: 1, mz: 0, durationMs: 250 } };
assert.equal(session.accept(order, 0).ok, true);
write('input', { actionId: order.actionId, input: session.step(0) });
assert.equal(session.markSent(order.actionId, { first: 1, last: 1 }, 0).ok, true);
const ack = session.acknowledge(order.actionId, 1);
assert.equal(ack.action.state, 'sent');
assert.equal(ack.action.result, null);
write('input_ack', { actionId: order.actionId, state: ack.action.state, effectConfirmed: false });
const receipt = { v: 1, actionId: order.actionId, scope, controlRevision: 1, source: 'fixture', evidenceId: 'receipt-1', tick: 11,
  outcome: 'confirmed', code: 'position_observed', effect: 'Posición confirmada en la fixture: x=0.4, z=0.', durability: 'not_applicable' };
const result = session.recordEvidence(receipt);
assert.equal(result.action.state, 'confirmed');
write('action_result', { actionId: order.actionId, state: result.action.state, effect: result.action.result.effect, durability: receipt.durability });

// A second dispatched action is stopped before any result arrives.
const nextObservation = structuredClone(observation);
nextObservation.revision = 2; nextObservation.tick = 11; nextObservation.receivedAtMs = 10;
nextObservation.confirmed.self.position.x = 0.4;
assert.equal(session.observe(nextObservation, 10).ok, true);
const nextOrder = { ...order, actionId: 'action-2', observationRevision: 2 };
assert.equal(session.accept(nextOrder, 10).ok, true);
session.step(10);
assert.equal(session.markSent(nextOrder.actionId, { first: 2, last: 2 }, 10).ok, true);
const stopped = session.stop(scope.ownerId, 20);
assert.equal(stopped.actions.at(-1).state, 'uncertain');
assert.deepEqual(session.step(20), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
write('stop', { state: stopped.state, input: stopped.input, pending: stopped.actions.filter((a) => a.state === 'uncertain').map((a) => ({ actionId: a.order.actionId, state: a.state, why: a.why })) });

const required = { rules: { grant: session.grant, controlStatus: 'stopped', labLimits: LAB_LIMITS, inference: { callsEnabled: false, monetaryLimit: null }, gameSpending: { enabled: false } },
  personality, tools: [], observation: { current: null, lastKnown: nextObservation }, goals,
  pending: stopped.actions.filter((a) => a.state === 'uncertain').map((a) => ({ actionId: a.order.actionId, state: a.state, why: a.why, inputRange: a.inputRange, effects: a.effects })) };
// History expansion is synthetic; owner fixture files are never rewritten or pruned.
const history = Array.from({ length: 50000 }, (_, i) => ({ ...memory[i % memory.length], id: `episode-${i}` }));
const context = buildContext({ required, memory: history, queryTags: ['help-owner'], scope: memoryScope, nowMs: 20 });
assert.equal(context.ok, true);
assert.deepEqual(context.document.required.pending, required.pending);
assert.ok(context.report.selectedContextUnits + DEFAULT_CONTEXT_LIMITS.outputReserveUnits + DEFAULT_CONTEXT_LIMITS.marginUnits <= DEFAULT_CONTEXT_LIMITS.maxContextUnits);
write('bounded_context', { originalRecords: history.length, rawHistoryBytes: Buffer.byteLength(JSON.stringify(history)), ...context.report });
assert.equal((await readFile(new URL('fixtures/memory.jsonl', import.meta.url), 'utf8')), memoryText);
write('complete', { ok: true, gameConnected: false, inferenceCalls: 0 });

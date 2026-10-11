import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseGmDraftMethods } from '../server/gmDraftStore.mjs';
import { createDocument } from '../src/editor/document.js';

const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const OP = 'b5000000-0000-4000-8000-000000000001';
const scope = { world: 'salty-shore', owner, expectedRevision: 7 };
const base = { seed: 42, baseRevision: 'terrain-s21-v1' };
const v3 = createDocument({ ...base, terrain: { version: 1, samples: [[123, 1]] } });
const v4 = createDocument({ ...base, terrain: { version: 2, samples: [[123, 1]], materials: [[123, 255, 0, 0, 0]] } });

function fakeRpc({ readiness, failReadiness = false } = {}) {
  const calls = [];
  const client = { async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'mn_gm_material_drafts_ready') {
      if (failReadiness) return { data: null, error: { code: '42883', message: 'function missing' } };
      return { data: structuredClone(readiness), error: null };
    }
    if (name === 'mn_save_gm_draft') {
      const document = args.p_request.document;
      return { data: { ok: true, replay: false, head: { revision: args.p_request.expectedRevision + 1,
        document, savedAt: '2026-10-10T12:00:00.000Z' } }, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  } };
  return { calls, methods: createSupabaseGmDraftMethods(client) };
}

test('v4 saves fail closed before the SQL save RPC when readiness is absent, stale, malformed, or unavailable', async () => {
  const cases = [
    { readiness: null },
    { readiness: { version: 1, terrainVersion: 1 } },
    { readiness: { version: 1, terrainVersion: 2, extra: true } },
    { failReadiness: true },
  ];
  for (const readinessCase of cases) {
    const { calls, methods } = fakeRpc(readinessCase);
    await assert.rejects(methods.saveGmDraft({ ...scope, operationId: OP, document: v4 }), { code: 'unavailable' });
    assert.deepEqual(calls.map(call => call.name), ['mn_gm_material_drafts_ready']);
  }
});

test('legacy v3 saves do not require the material readiness RPC', async () => {
  const { calls, methods } = fakeRpc({ readiness: null });
  const result = await methods.saveGmDraft({ ...scope, operationId: OP, document: v3 });
  assert.deepEqual(calls.map(call => call.name), ['mn_save_gm_draft']);
  assert.deepEqual(calls[0], { name: 'mn_save_gm_draft', args: {
    p_operation_id: OP,
    p_request: { world: scope.world, owner, expectedRevision: scope.expectedRevision, document: v3 },
  } });
  assert.equal(result.ok, true);
  assert.equal(result.head.revision, scope.expectedRevision + 1);
  assert.deepEqual(result.head.document, v3);
});

test('v4 saves validate readiness first and preserve the exact pending operation identity and document', async () => {
  const { calls, methods } = fakeRpc({ readiness: { version: 1, terrainVersion: 2 } });
  const input = { ...scope, operationId: OP, document: structuredClone(v4) };
  const result = await methods.saveGmDraft(input);
  assert.deepEqual(calls.map(call => call.name), ['mn_gm_material_drafts_ready', 'mn_save_gm_draft']);
  assert.equal(calls[1].args.p_operation_id, OP);
  assert.deepEqual(calls[1].args.p_request, {
    world: scope.world, owner, expectedRevision: scope.expectedRevision, document: v4,
  });
  assert.equal(result.ok, true);
  assert.equal(result.replay, false);
  assert.deepEqual(result.head.document, v4);
  assert.deepEqual(input.document, v4, 'the pending document object is not mutated while readiness is checked');
});

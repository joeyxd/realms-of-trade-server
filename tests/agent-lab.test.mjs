import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('L00 lab runs reproducibly with visible fixture files and bounded huge history', () => {
  const script = fileURLToPath(new URL('../tools/agent/lab.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 });
  const first = run();
  assert.equal(first, run());
  const events = first.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.every((event) => event.source === 'fixture'));
  assert.equal(events.find((e) => e.type === 'owner_files').files.length, 3);
  assert.equal(events.find((e) => e.type === 'input_ack').effectConfirmed, false);
  assert.equal(events.find((e) => e.type === 'action_result').state, 'confirmed');
  const stop = events.find((e) => e.type === 'stop');
  assert.equal(stop.pending[0].state, 'uncertain');
  assert.equal(stop.input.mx, 0);
  const context = events.find((e) => e.type === 'bounded_context');
  assert.equal(context.originalRecords, 50000);
  assert.equal(context.truncatedCandidates, 48000);
  assert.equal(context.missingHistory, true);
  assert.ok(context.selectedContextUnits + context.outputReserveUnits + context.marginUnits <= 4096);
  assert.ok(context.selectedInputBytes < context.rawHistoryBytes);
  assert.equal(context.countMode, 'estimated_utf8_bytes');
  assert.deepEqual(events.at(-1), { type: 'complete', source: 'fixture', ok: true, gameConnected: false, inferenceCalls: 0 });
});

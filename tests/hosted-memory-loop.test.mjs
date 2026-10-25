import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairedCompanion } from '../server/agent/paired-companion.mjs';
import { loadOwnerFiles } from '../server/agent/owner-files.mjs';
import { fixtureObservation } from '../tools/agent/fixtures.mjs';
import { DEFAULT_COMPANION_DRAFT } from '../src/net/companionTemplates.js';
import { companionPreset, companionCreationConfig } from '../src/net/companionCreation.js';

const OWNER = '22222222-2222-4222-8222-222222222222', CHARACTER = '33333333-3333-4333-8333-333333333333';
const CODE = 'a'.repeat(64), scope = { ownerId: OWNER, characterId: CHARACTER, worldId: 'hosted-memory' };
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) {
  for (let i = 0; i < 1600; i++) { if (check()) return; await pause(); }
  assert.fail('condition timeout');
}
let runnerSequence = 0;
class FakeRunner {
  constructor(options) {
    this.options = options; this.grant = { ...options.grant, capabilities: ['chat'] }; this.authority = null;
    this.actions = []; this.priorUncertainty = []; this.tick = 1; this.serial = 0; this.prefix = `test${++runnerSequence}`;
    this.chat = { available: true, self: CHARACTER, historyBeforeSession: 'unavailable', config: { enabled: true, maxLength: 1000 },
      peers: [{ id: OWNER, entity: 1, name: 'Owner' }, { id: CHARACTER, entity: 2, name: 'Brisa' }], messages: [], requests: [] };
  }
  get observation() {
    return fixtureObservation({ scope: this.grant.scope, source: 'server', receivedAtMs: Date.now(), tick: this.tick,
      chat: this.chat.messages.slice(-32).map(m => ({ id: m.id, channel: m.channel, text: m.text, tick: m.tick,
        sender: m.sender.id === CHARACTER ? CHARACTER : `chat:${m.sender.id}`, recipient: null })) });
  }
  async connect() { this.state = 'ready'; }
  deliver(sender, text, requestId) {
    const message = { id: `${this.prefix}:${++this.serial}`, requestId, channel: 'world', sender, text, tick: ++this.tick };
    this.chat.messages.push(message); this.options.onFeedback({ type: 'chat_message', data: { message } }); return message;
  }
  sendChat(order) { this.deliver(this.chat.peers[1], order.args.text, order.actionId); return { ok: true, order }; }
  stop() { this.state = 'stopped'; }
  close() { this.state = 'stopped'; }
}
async function setup(t, { hosted = true, maxCalls = 8, summary = 'ok', hold = false } = {}) {
  let clock = Date.now(), runner, release;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(performance, 'now', () => clock - performance.timeOrigin);
  const dir = await mkdtemp(join(tmpdir(), 'hosted-memory-')), directory = join(dir, 'Brisa');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [], statuses = [], gate = new Promise(resolve => { release = resolve; });
  const preset = companionPreset({ ...DEFAULT_COMPANION_DRAFT, name: 'Brisa' });
  const pair = new PairedCompanion({ directory, url: hosted ? 'ws://127.0.0.1:1234/ws' : 'wss://game.example/ws', maxCalls,
    ...(hosted ? { hosted: { origin: 'https://game.example', endpointId: 'a'.repeat(16), endpoint: { baseUrl: 'https://api.example/v1' },
      egress: { vet() {} }, socketToken: CODE } } : {}),
    claim: async () => ({ scope, record: { characterKey: CHARACTER, creationId: '44444444-4444-4444-8444-444444444444',
      preset, configuration: { revision: 1, config: companionCreationConfig(preset) }, control: { revision: 1 } },
      token: `mncp_${CODE}`, expiresAtMs: clock + 3600000, content: { generation: 0, revisionId: null }, ownerPeer: OWNER }),
    runnerFactory: options => (runner = new FakeRunner(options)), onStatus: value => statuses.push(value),
    adapterFactory: policy => ({ id: 'test-mind', countMode: 'estimated_tokens',
      localResourcePolicy: hosted ? { endpointId: policy.endpointId, modelId: policy.modelId, thinkingMode: policy.thinkingMode }
        : { baseUrl: policy.baseUrl, modelId: policy.modelId, thinkingMode: policy.thinkingMode },
      countText: text => Math.ceil(Buffer.byteLength(text) / 4),
      prepare: request => ({ body: JSON.stringify(request), inputTokens: 100, maxCostUnits: 612 }),
      complete: async ({ body }) => {
        const sources = JSON.parse(body).context.required.tools.memoryCompaction?.sources;
        calls.push(sources ? 'compaction' : 'reply');
        if (sources && hold) await gate;
        const decision = sources ? summary === 'wait' ? { type: 'wait', args: {} } : summary === 'fail' ? { type: 'bogus', args: {} }
          : { type: 'summarize_memory', args: { text: 'Historical exchanges.', tags: [], basis: sources.map(s => s.id) } }
          : { type: 'reply', args: { text: 'Te acompaño.' } };
        return { text: JSON.stringify({ v: 1, decision }), usage: { inputTokens: 100, outputTokens: 20, costUnits: 120 } };
      } }),
  });
  t.after(() => { release(); pair.close(); });
  assert.equal(pair.memoryLoop, null); assert.equal((await pair.start(CODE)).ok, true);
  const send = () => { clock += 6000; runner.deliver(runner.chat.peers[0], 'Hola Brisa', `in_${runner.serial}`); };
  const turn = async () => {
    const before = pair.diagnostics.mind.records.filter(r => r.mode === 'remember').length;
    send(); await until(() => pair.diagnostics.mind.records.filter(r => r.mode === 'remember').length > before);
    if (hosted) await until(() => pair.memoryLoop.memory.episodes > before);
  };
  const seed = async n => { for (let i = 0; i < n; i++) { clock += 1; runner.tick++; assert.equal((await pair.remember()).ok, true); } };
  return { pair, calls, statuses, turn, send, seed, release, directory, get runner() { return runner; } };
}

test('the sixth remembered hosted turn writes exactly one summary over at least two episodes', async t => {
  const f = await setup(t);
  for (let i = 0; i < 5; i++) await f.turn();
  assert.equal(f.calls.includes('compaction'), false);
  await f.turn(); await until(() => f.pair.memoryLoop.lastSummary !== null);
  assert.equal(f.calls.filter(c => c === 'compaction').length, 1);
  const files = await loadOwnerFiles({ directory: f.directory, scope });
  const summary = files.files.memory.journal.entries.find(e => e.kind === 'summary');
  assert.ok(summary.payload.sources.length >= 2); assert.equal(f.pair.memoryLoop.memory.episodes, 6);
  assert.deepEqual(f.pair.memoryLoop.lastSummary, { ok: true, atMs: Date.now(), reason: 'context_size' });
});

test('fewer than two remaining calls preserves the last reply allowance', async t => {
  const f = await setup(t, { maxCalls: 7 });
  for (let i = 0; i < 6; i++) await f.turn();
  assert.equal(f.calls.filter(c => c === 'compaction').length, 0); assert.equal(f.pair.memoryLoop.usage.calls, 6);
});

test('a failed paid summary blocks more attempts and stop/start resets the session block', async t => {
  const f = await setup(t, { summary: 'fail' }); await f.seed(5);
  await f.turn(); await until(() => f.pair.memoryLoop.autoSummary === 'blocked');
  await f.turn(); await f.turn();
  assert.equal(f.calls.filter(c => c === 'compaction').length, 1);
  assert.ok(f.statuses.some(s => s.phase === 'memory' && s.result === 'summary_failed'));
  assert.equal(f.pair.memoryLoop.lastSummary.ok, false);
  f.pair.stop(); assert.equal(f.pair.memoryLoop, null); assert.equal((await f.pair.start(CODE)).ok, true);
  assert.equal(f.pair.memoryLoop.autoSummary, 'ready'); assert.equal(f.pair.memoryLoop.lastSummary, null);
  await f.turn(); await until(() => f.pair.memoryLoop.autoSummary === 'blocked');
  assert.equal(f.calls.filter(c => c === 'compaction').length, 2);
});

test('a successful wait without a written summary blocks automation too', async t => {
  const f = await setup(t, { summary: 'wait' }); await f.seed(5); await f.turn();
  await until(() => f.pair.memoryLoop.autoSummary === 'blocked');
  assert.equal(f.pair.memoryLoop.lastSummary.why, 'summary_not_written'); assert.equal(f.pair.memoryLoop.memory.summaries, 0);
});

test('a non-hosted companion never summarizes automatically', async t => {
  const f = await setup(t, { hosted: false });
  for (let i = 0; i < 6; i++) await f.turn();
  assert.equal(f.calls.length, 6); assert.equal(f.calls.includes('compaction'), false);
});

test('a chat arriving during the automatic summary gets its reply after the summary', async t => {
  const f = await setup(t, { hold: true }); await f.seed(5); await f.turn();
  await until(() => f.calls.includes('compaction'));
  f.send(); assert.equal(f.calls.filter(c => c === 'reply').length, 1);
  f.release(); await until(() => f.runner.chat.messages.filter(m => m.sender.id === CHARACTER).length === 2);
  await until(() => f.pair.memoryLoop.memory.episodes === 7);
  assert.deepEqual(f.calls, ['reply', 'compaction', 'reply']); assert.deepEqual(f.statuses, []);
});

test('memoryLoop counters match the persisted budget and loaded journal', async t => {
  const f = await setup(t); await f.seed(5); await f.turn(); await until(() => f.pair.memoryLoop.lastSummary !== null);
  const loop = f.pair.memoryLoop, budget = f.pair.budget, files = await loadOwnerFiles({ directory: f.directory, scope });
  const settled = budget.entries.filter(e => e.state === 'settled');
  assert.deepEqual(loop.usage, { calls: budget.entries.filter(e => e.state !== 'cancelled').length, maxCalls: budget.limits.maxCalls,
    inputTokens: settled.reduce((n, e) => n + e.usage.inputTokens, 0), outputTokens: settled.reduce((n, e) => n + e.usage.outputTokens, 0),
    summaries: budget.entries.filter(e => e.kind === 'compaction' && e.state !== 'cancelled').length, expiresAtMs: budget.persistence.expiresAtMs });
  assert.deepEqual(loop.memory, { episodes: files.files.memory.journal.report.episodes, summaries: files.files.memory.journal.report.summaries,
    bytes: Buffer.byteLength(files.files.memory.content), maxBytes: 1048576 });
  loop.memory.episodes = 0; assert.equal(f.pair.memoryLoop.memory.episodes, 6);
});

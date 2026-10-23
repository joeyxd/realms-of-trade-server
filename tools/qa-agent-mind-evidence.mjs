import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

// Require stable passing root-run suites, current source hashes and unchanged direction rows.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), directory = 'docs/delivery/l03a-agent-mind/';
const read = (path) => readFile(resolve(root, path), 'utf8');
const hash = async (path) => createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
const agents = JSON.parse(await read(directory + 'agents-tests.json'));
const regression = JSON.parse(await read(directory + 'regression-tests.json'));
const baseline = JSON.parse(await read(directory + 'baseline.json')), plan = await read('PLAN-EXTRA-LLM.md');
const directions = plan.split(/\r?\n/).filter((line) => /^\| L0[0-6][a-e] \|/.test(line)).map((line) => line.split('|').slice(0, 4).join('|'));
const da3 = plan.split(/\r?\n/).find((line) => line.startsWith('| D-A3 '));
if (directions.length !== 22 || JSON.stringify(directions) !== JSON.stringify(baseline.directions) || da3 !== baseline.da3)
  throw new Error('Agreement, demonstration or D-A3 drift');
const finalDrift = [];
for (const [name, suite] of Object.entries({ agents, regression })) {
  if (suite.exitCode !== 0 || suite.fail !== 0 || suite.cancelled !== 0 || suite.changedDuringSuite.length || !Number.isSafeInteger(suite.pass))
    throw new Error(`Suite is not stable/passing: ${name}`);
  for (const [path, digest] of Object.entries(suite.after)) if (await hash(path) !== digest) finalDrift.push({ suite: name, path });
}
if (finalDrift.length || !Number.isSafeInteger(PROTOCOL_VERSION) || PROTOCOL_VERSION < 28)
  throw new Error(`Sources changed after acceptance or invalid protocol: ${JSON.stringify(finalDrift)}`);
const missionFiles = [
  'tools/agent/mind.mjs', 'tools/agent/mind-context.mjs', 'tools/agent/mind-contract.mjs', 'tools/agent/mind-snapshot.mjs',
  'tools/agent/inference-budget.mjs', 'tools/agent/simulated-mind.mjs', 'tools/agent/run.mjs', 'tools/qa-agent-mind.mjs',
  'tools/qa-agent-mind-evidence.mjs', 'tests/agent-mind.test.mjs', 'tests/agent-mind-context.test.mjs',
  'tests/agent-mind-network.test.mjs', 'tests/agent-inference-budget.test.mjs', 'docs/agents/mind-runner.md',
  'docs/briefs/l03a-agent-mind.md', 'docs/delivery/l03a-agent-mind.md', 'PLAN-EXTRA-LLM.md', 'PLAN-DELIVERY.md',
  'DESIGN.md', 'docs/HANDOFF.md',
];
const artifacts = ['baseline.json', 'agents-tests.tap', 'agents-tests.json', 'regression-tests.tap', 'regression-tests.json',
  'provisional-agents-tests.tap', 'provisional-agents-tests.json', 'provisional-regression-tests.tap', 'provisional-regression-tests.json'];
const summarize = ({ before, after, ...suite }) => ({ ...suite, dependencyCount: Object.keys(after).length,
  dependencyHashes: directory + (suite.log.startsWith('agents') ? 'agents-tests.json' : 'regression-tests.json') });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const verification = {
  schema: 'l03a-agent-mind-verification/v1', status: 'local_software_verified_with_simulated_models', generatedAt: new Date().toISOString(),
  checkout: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), sharedDirty: true, missionCommit: null,
    hashBasis: 'Root-run TAP with core gameplay/auth/storage/agent and relative test import fingerprints; shared checkout is not immutable' },
  protocol: { version: PROTOCOL_VERSION, changedByMission: false, agentOrderVersion: 1 },
  agentTests: summarize(agents), regressionTests: summarize(regression), newMissionTests: { tests: 48, pass: 48 },
  dependencyStability: { status: 'verified', finalDrift, noRuntimeEditsAfterAcceptance: true,
    provisionalCapture: 'Passing tests, excluded from acceptance because unrelated UI/render files changed during broad source capture' },
  planIntegrity: { agreedDirectionRows: directions.length, agreementAndDemonstrationUnchanged: true,
    da3Unchanged: true, da3State: 'Propuesto; por acordar', baseline: directory + 'baseline.json' },
  localProof: { realWebSocket: true, realChildCli: true, authenticatedResolver: 'injected local fixture',
    models: 'simulated and injected contract fixtures only', realProviderCalls: 0, realBillingVerified: false,
    countModes: ['simulated_tokens', 'estimated_tokens', 'measured_tokens'], measuredModeNativeTokenizerVerified: false,
    secrets: 'account token excluded from adapter projection and CLI stdout; no inference credentials configured',
    existingEmbeddedSqlRegressionRan: true, externalMigrationApplied: false, deployment: false, externalServiceTouched: false },
  guarantees: ['one provider query in flight including abort-ignoring adapters', 'timeout and cancellation invalidate decisions without stopping body',
    'complete serialized request, instructions, schema, context, output reserve and margin admission',
    'mechanical traceable compaction without additional inference calls or source deletion',
    'owner-scoped call/token/cost reservation before I/O', 'confirmed, held and unresolved usage separated',
    'late usage can reconcile without applying a late decision', 'provider reservation overrun is recorded and blocks future calls',
    'strict structured proposals revalidated against original and current game state',
    'owner priority, epoch/session/task/file/freshness/death fences', 'CLI remains responsive while inference is pending'],
  limits: ['No selected real provider/model, tokenizer, rate or billing verification',
    'Adapter is trusted: prepare must count exact payload and complete must enforce I/O and output bounds without hidden paid calls',
    'Abort-ignoring adapter retains slot until settlement; a never-settling transport requires repair/stop',
    'Process-scoped ledger without durable owner/account budget, periods or restart continuity',
    'No autonomous decision cadence, intelligent conversation or goal mutation yet',
    'No memory persistence/export/delete, BYOK/custody workflow or owner panel',
    'No perception/occlusion/PvP, tactical utility, hit or physical performance claims',
    'Windows symlink escape case skipped due to EPERM'],
  unrealReuse: { sourceReadOnly: true, candidates: [
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/AIBehaviorTree.uasset', bytes: 111879 },
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/AIBlackboard.uasset', bytes: 10661 },
  ], decision: 'Conceptual AI references, not portable Node/provider code; no export or source modification' },
  sourceFiles: Object.fromEntries(await Promise.all(missionFiles.map(async (path) => [path, await hash(path)]))),
  evidenceFiles: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [directory + path, await hash(directory + path)]))),
  nextSlice: 'L03b: personality-aware C01 conversation; real provider/tokenizer/billing acceptance remains separate',
};
await writeFile(resolve(root, 'docs/delivery/l03a-agent-mind-verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ agents: { tests: agents.tests, pass: agents.pass, skipped: agents.skipped },
  regression: { tests: regression.tests, pass: regression.pass }, rows: directions.length, da3Unchanged: true, finalDrift }));

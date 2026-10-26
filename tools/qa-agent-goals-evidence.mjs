import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'docs/delivery/l03c-agent-goals/';
const read = (path) => readFile(resolve(root, path), 'utf8');
const hash = async (path) => createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const agents = JSON.parse(await read(directory + 'agents-tests.json'));
const regression = JSON.parse(await read(directory + 'regression-tests.json'));
const baseline = JSON.parse(await read(directory + 'baseline.json'));
const plan = await read('PLAN-EXTRA-LLM.md');
const directions = plan.split(/\r?\n/).filter((line) => /^\| L0[0-6][a-e] \|/.test(line)).map((line) => line.split('|').slice(0, 4).join('|'));
const da3 = plan.split(/\r?\n/).find((line) => line.startsWith('| D-A3 '));
if (directions.length !== 22 || JSON.stringify(directions) !== JSON.stringify(baseline.directions) || da3 !== baseline.da3)
  throw new Error('Agreement, demonstration or D-A3 drift');
const drift = [];
for (const [name, suite] of Object.entries({ agents, regression })) {
  if (suite.exitCode !== 0 || suite.fail !== 0 || suite.cancelled !== 0 || suite.changedDuringSuite.length ||
      !Number.isSafeInteger(suite.pass) || suite.pass < 1 || suite.tests !== suite.pass + suite.skipped)
    throw new Error(`Suite is not stable and passing: ${name}`);
  for (const [path, digest] of Object.entries(suite.after)) if (await hash(path) !== digest) drift.push({ suite: name, path });
}
if (drift.length) throw new Error(`Post-test source drift: ${JSON.stringify(drift)}`);
const mission = ['tools/agent/goals.mjs', 'tools/agent/objective-store.mjs', 'tools/agent/mind.mjs', 'tools/agent/mind-contract.mjs',
  'tools/agent/mind-context.mjs', 'tools/agent/mind-snapshot.mjs', 'tools/agent/simulated-mind.mjs', 'tools/agent/run.mjs',
  'tools/qa-agent-goals.mjs', 'tools/qa-agent-goals-evidence.mjs', 'tests/agent-objective-store.test.mjs',
  'tests/agent-goals-mind.test.mjs', 'tests/agent-goals-network.test.mjs', 'tests/agent-goals-pve.test.mjs',
  'docs/agents/goals-runner.md', 'docs/agents/mind-runner.md', 'docs/agents/conversation-runner.md',
  'docs/briefs/l03c-agent-goals.md', 'docs/delivery/l03c-agent-goals.md', 'PLAN-EXTRA-LLM.md', 'PLAN-DELIVERY.md', 'DESIGN.md', 'docs/HANDOFF.md'];
const artifacts = ['baseline.json', 'agents-tests.tap', 'agents-tests.json', 'regression-tests.tap', 'regression-tests.json'];
const summarize = ({ before, after, ...suite }) => ({ ...suite, dependencyCount: Object.keys(after).length });
const verification = {
  schema: 'l03c-agent-goals-verification/v1', status: 'local_software_verified_with_simulated_models',
  generatedAt: new Date().toISOString(), checkout: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    sharedDirty: true, missionCommit: null }, protocol: { version: PROTOCOL_VERSION, changedByMission: false, agentOrderVersion: 1 },
  agentTests: summarize(agents), regressionTests: summarize(regression),
  newMissionTestFiles: ['agent-objective-store', 'agent-goals-mind', 'agent-goals-network', 'agent-goals-pve'],
  dependencyStability: { finalDrift: drift, status: 'verified' },
  planIntegrity: { agreedDirectionRows: directions.length, agreementAndDemonstrationUnchanged: true, da3Unchanged: true,
    da3State: 'Propuesto; por acordar', baseline: directory + 'baseline.json' },
  localProof: { realWebSocket: true, realChildCli: true, realObjectiveFileRevision: true,
    authenticatedOwnerStop: 'injected localhost resolver and server-owned capability binding',
    pveRehearsal: 'controlled localhost host combat, scripted decisions, ordinary WS inputs and separate body without model',
    controlledFixtureStimuli: 'declared host positions/health/map/enemies, never production authority tools',
    models: 'scripted simulated decisions and injected contract fixtures', realProviderCalls: 0,
    realTokenizerVerified: false, realBillingVerified: false, tacticalQualityAccepted: false, humanExperienceAccepted: false,
    humanPveEncounterCompleted: false, accountTokenExcludedFromProviderContext: true,
    onlyObjectivesWritten: true, personalityAndMemoryUnchanged: true, externalMigrationApplied: false,
    existingEmbeddedSqlRegressionRan: true, externalServiceTouched: false, published: false, deployed: false },
  guarantees: ['Explicit goal revision turn shares one inference flight and usage ledger with body/chat',
    'Fixed scope/path/next revision; generated text cannot change grants, spending or priority',
    'Protected actual goals and bounded delivered feedback with IDs/hash and inspectable selected provider context',
    'Unresolved action outcomes remain mandatory even outside selected action window',
    'Only active/paused/blocked goals may be newly asserted; completed goals preserved unchanged only',
    'No semantic encounter success inferred from ACK, partial swing or target disappearance',
    'Original/current authority, task, freshness, scope/epoch and owner-file fences before guarded local write',
    'Exclusive cooperative lock, detached inputs, bounded reads, exact temporary bytes and atomic rename',
    'Conflicts reject without automatic retry; ambiguous commit outcome blocks further goal revisions',
    'Late known file receipts remain visible after interruption; cancellation cannot undo completed writes',
    'Native inference usage reconciles on stale, cancelled and malformed output'],
  limits: ['No real provider/tokenizer/rates/billing, tactical quality or human PvE encounter acceptance',
    'Trusted adapter must measure exact transmitted payload and enforce output/I/O caps without hidden paid calls',
    'Trusted goal writer and commit snapshot callbacks must follow guard/receipt contract',
    'Local cooperative lock is not OS-wide CAS; an uncooperative external editor may race comparison and rename',
    'No filesystem crash durability, stale lock recovery, multi-host writes or durable inference ledger',
    'Synchronous final bounded file checks may briefly occupy runner event loop; no physical latency guarantee',
    'Goal provenance lives in bounded process records, not durable memory/audit journal',
    'No auto goal scheduler, memory mutation, new capability, owner panel or D-A3 operation choice',
    'Two Windows symlink tests skipped because EPERM'],
  unrealReuse: { sourceReadOnly: true, candidates: [
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/AIBehaviorTree.uasset', bytes: 111879 },
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/AIBlackboard.uasset', bytes: 10661 },
  ], decision: 'Conceptual behavior/data references; no portable Node/C01 component, graph inspection, export or source edits' },
  sourceFiles: Object.fromEntries(await Promise.all(mission.map(async (path) => [path, await hash(path)]))),
  evidenceFiles: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [directory + path, await hash(directory + path)]))),
  nextSlice: 'L04a: scoped persistent memory, relevant recovery and traceable compaction; real provider/human acceptance remains separate',
};
await writeFile(resolve(root, 'docs/delivery/l03c-agent-goals-verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ agents: { tests: agents.tests, pass: agents.pass, skipped: agents.skipped },
  regression: { tests: regression.tests, pass: regression.pass }, rows: directions.length, da3Unchanged: true, drift }));

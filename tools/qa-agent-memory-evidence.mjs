import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'docs/delivery/l04a-agent-memory/';
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
      !Number.isSafeInteger(suite.pass) || suite.pass < 1 || suite.tests !== suite.pass + suite.skipped) throw new Error(`Suite is not stable and passing: ${name}`);
  for (const [path, digest] of Object.entries(suite.after)) if (await hash(path) !== digest) drift.push({ suite: name, path });
}
if (drift.length) throw new Error(`Post-test source drift: ${JSON.stringify(drift)}`);
const mission = ['tools/agent/memory-journal.mjs', 'tools/agent/memory-store.mjs', 'tools/agent/memory-retrieval.mjs',
  'tools/agent/owner-files.mjs', 'tools/agent/context.mjs', 'tools/agent/mind.mjs', 'tools/agent/mind-contract.mjs', 'tools/agent/mind-context.mjs',
  'tools/agent/mind-snapshot.mjs', 'tools/agent/simulated-mind.mjs', 'tools/agent/run.mjs', 'tools/qa-agent-memory.mjs', 'tools/qa-agent-memory-evidence.mjs',
  'tests/agent-memory-journal.test.mjs', 'tests/agent-memory-store.test.mjs', 'tests/agent-memory-retrieval.test.mjs', 'tests/agent-memory-mind.test.mjs',
  'tests/agent-memory-context.test.mjs', 'tests/agent-memory-network.test.mjs', 'tests/agent-memory-recovery.test.mjs',
  'docs/agents/memory-runner.md', 'docs/agents/goals-runner.md', 'docs/agents/mind-runner.md', 'docs/agents/conversation-runner.md',
  'docs/briefs/l04a-agent-memory.md', 'docs/delivery/l04a-agent-memory.md',
  'PLAN-EXTRA-LLM.md', 'PLAN-DELIVERY.md', 'DESIGN.md', 'docs/HANDOFF.md'];
const artifacts = ['baseline.json', 'agents-tests.tap', 'agents-tests.json', 'regression-tests.tap', 'regression-tests.json'];
const summarize = ({ before, after, ...suite }) => ({ ...suite, dependencyCount: Object.keys(after).length });
const diagnostics = (await read(directory + 'agents-tests.tap')).split(/\r?\n/).filter((line) => /^# \{"(?:archiveBytes|source)"/.test(line)).map((line) => JSON.parse(line.slice(2)));
const verification = {
  schema: 'l04a-agent-memory-verification/v1', status: 'local_software_verified_with_simulated_models', generatedAt: new Date().toISOString(),
  checkout: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), sharedDirty: true, missionCommit: null },
  protocol: { version: PROTOCOL_VERSION, changedByMission: false, agentOrderVersion: 1 }, agentTests: summarize(agents), regressionTests: summarize(regression),
  newMissionTestFiles: ['agent-memory-journal', 'agent-memory-store', 'agent-memory-retrieval', 'agent-memory-mind', 'agent-memory-context', 'agent-memory-network', 'agent-memory-recovery'],
  dependencyStability: { finalDrift: drift, status: 'verified' },
  planIntegrity: { agreedDirectionRows: directions.length, agreementAndDemonstrationUnchanged: true, da3Unchanged: true, da3State: 'Propuesto; por acordar', baseline: directory + 'baseline.json' },
  recoveryDiagnostics: diagnostics,
  localProof: { realOwnerFiles: true, realWebSocket: true, realChildCliRestart: true, realMemoryFileRevision: true,
    authenticatedOwnerStop: 'injected localhost resolver with actual server capability binding',
    persistedUncertainty: 'declared pending fixture carried through real file/session restart and mandatory context',
    historicalProposal: 'scripted adapter uses historical text plus current state; no language quality claim',
    allArchiveRecovery: 'old relevant fact before last 2000 records selected from 2400-entry actual file',
    originalBytesRetained: true, personalityAndObjectivesUnchangedByMemoryWrites: true, sharedCompactionBudget: true,
    models: 'simulated/scripted contract fixtures', realProviderCalls: 0, realTokenizerVerified: false, realBillingVerified: false,
    semanticQualityAccepted: false, humanExperienceAccepted: false, externalMigrationApplied: false, existingEmbeddedSqlRegressionRan: true,
    externalServiceTouched: false, published: false, deployed: false },
  guarantees: ['Explicit zero-provider episode capture and separately budgeted semantic interpretation',
    'One JSONL file atomically retains originals and summaries with exact scope and local content hashes',
    'All selected episode IDs and hashes required; derived-only tags and inherited conservative certainty/expiry',
    'Legacy owner claims are projected uncertain without altering original file bytes',
    'Full bounded archive ranking precedes candidate selection; current live state stays mandatory and separate',
    'Unresolved operations persist with session-qualified identities and no automatic retry',
    'Native usage and held/unknown reservations share the existing process ledger; kind compaction',
    'Stop, scope/epoch, freshness, task and all owner file hash fences before guarded publication',
    'Late known receipt visible; ambiguous memory commit blocks further writes; original goals/body authority unchanged'],
  limits: ['Lexical/tag ranking and simulated summary policy do not prove real LLM understanding or factual accuracy',
    'Content hashes are not authenticated server signatures; writable local files are untrusted',
    'Default one MiB journal and bounded episodes; full capacity rejects writes without silently deleting history',
    'No paid provider, embeddings, auto capture/summarization schedule, model selection or D-A3 decision',
    'No multi-host writes, OS-wide CAS, crash durability, automatic stale lock recovery or persistent inference budget',
    'Synchronous final checks may briefly occupy event loop; synthetic timing is not a physical performance guarantee',
    'No L04b export/delete/derived cleanup/retention migration product workflow or owner panel',
    'Three Windows symlink tests skipped because EPERM'],
  unrealReuse: { sourceReadOnly: true, candidates: [
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/AIBlackboard.uasset', bytes: 10661 },
    { path: 'C:/Unreal/MyProject/Content/ActionRPGStarterSystem/AI/Behavior/AIBlackboard.uasset', bytes: 10593 },
  ], decision: 'Conceptual AI data reference only; no graph inspection, export, portable JavaScript component or source edit' },
  sourceFiles: Object.fromEntries(await Promise.all(mission.map(async (path) => [path, await hash(path)]))),
  evidenceFiles: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [directory + path, await hash(directory + path)]))),
  nextSlice: 'L04b owner memory management, export/delete with derived cleanup and explicit retention/migration; real provider quality remains separate',
};
await writeFile(resolve(root, 'docs/delivery/l04a-agent-memory-verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ agents: { tests: agents.tests, pass: agents.pass, skipped: agents.skipped }, regression: { tests: regression.tests, pass: regression.pass },
  diagnostics, rows: directions.length, da3Unchanged: true, drift }));

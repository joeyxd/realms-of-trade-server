import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

// Acceptance requires stable root-run suites and current dependency fingerprints.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'docs/delivery/l03b-agent-conversation/';
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
if (drift.length || !Number.isSafeInteger(PROTOCOL_VERSION)) throw new Error(`Post-test source drift: ${JSON.stringify(drift)}`);
const mission = ['tools/agent/conversation.mjs', 'tools/agent/mind.mjs', 'tools/agent/mind-contract.mjs',
  'tools/agent/mind-context.mjs', 'tools/agent/mind-snapshot.mjs', 'tools/agent/simulated-mind.mjs', 'tools/agent/run.mjs',
  'tools/qa-agent-conversation.mjs', 'tools/qa-agent-conversation-evidence.mjs',
  'tests/agent-conversation-policy.test.mjs', 'tests/agent-conversation-mind.test.mjs', 'tests/agent-conversation-network.test.mjs',
  'docs/agents/conversation-runner.md', 'docs/agents/mind-runner.md', 'docs/briefs/l03b-agent-conversation.md',
  'docs/delivery/l03b-agent-conversation.md', 'PLAN-EXTRA-LLM.md', 'PLAN-DELIVERY.md', 'DESIGN.md', 'docs/HANDOFF.md'];
const artifacts = ['baseline.json', 'agents-tests.tap', 'agents-tests.json', 'regression-tests.tap', 'regression-tests.json',
  'provisional-agents-tests.tap', 'provisional-agents-tests.json', 'provisional-regression-tests.tap', 'provisional-regression-tests.json'];
const summarize = ({ before, after, ...suite }) => ({ ...suite, dependencyCount: Object.keys(after).length });
const verification = {
  schema: 'l03b-agent-conversation-verification/v1', status: 'local_software_verified_with_simulated_models',
  generatedAt: new Date().toISOString(), checkout: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    sharedDirty: true, missionCommit: null, hashBasis: 'core gameplay/auth/storage/agent modules and relative test import graph' },
  protocol: { version: PROTOCOL_VERSION, changedByMission: false, agentOrderVersion: 1 },
  agentTests: summarize(agents), regressionTests: summarize(regression),
  newMissionTestFiles: ['agent-conversation-policy', 'agent-conversation-mind', 'agent-conversation-network'],
  dependencyStability: { finalDrift: drift, status: 'verified',
    provisionalCapture: 'First agent capture excluded: CLI test failed before normalized-observation wait fix; its test source changed during capture. First regression passed 206 but src/net/localServer.js changed during capture' },
  planIntegrity: { agreedDirectionRows: directions.length, agreementAndDemonstrationUnchanged: true, da3Unchanged: true,
    da3State: 'Propuesto; por acordar', baseline: directory + 'baseline.json' },
  localProof: { realWebSocket: true, realChildCli: true, threeClientAudience: true,
    authenticatedOwnerStop: 'injected localhost resolver and server-owned chat capability binding',
    models: 'scripted simulated replies and injected contract fixtures', realProviderCalls: 0,
    realTokenizerVerified: false, realBillingVerified: false, linguisticQualityAccepted: false, humanExperienceAccepted: false,
    accountTokenExcludedFromProviderContext: true, ownerFilesUnchanged: true, externalMigrationApplied: false,
    existingEmbeddedSqlRegressionRan: true, externalServiceTouched: false, published: false, deployed: false },
  guarantees: ['explicit source-ID turn only, no automatic response scheduler',
    'raw delivered source matches normalized character observation and current peer entity',
    'runner fixes channel and whisper sender target; generated JSON cannot widen the audience',
    'world reply requires explicit configured channel opt-in', 'chat cannot authorize body actions or change goals',
    'selected source and policy protected in six-block L00 context; optional chat and memory pruned',
    'owner-local selected provider context inspection plus full prepared request fingerprint and counts',
    'same inference budget and single flight as body decisions; native usage settles before stale-response rejection',
    'source consumed once; own echoes excluded; bounded per-peer/total/cooldown suppression',
    'stop/session/epoch/task/files/freshness/source/recipient changes fence late replies',
    'sent/uncertain C01 outcomes prevent new conversation sends; thrown submission blocks instance',
    'local send acceptance, routed receipt and unknown reading remain distinct'],
  limits: ['No real provider/tokenizer/rates/billing or linguistic/human acceptance',
    'Trusted adapter must measure exact transmitted payload and enforce output/I/O caps without hidden paid calls',
    'Process-local budget and reply ledger reset on process restart; no durable/global loop or spend guarantee',
    'Peer IDs identify connections, not authoritative human/agent classification; reconnection may change token',
    'Local channel audience is chosen by C01 positions at send time, not frozen from inbound message',
    'Conversation diagnostics contain selected delivered text and personality for the owner to inspect',
    'No unsolicited conversation cadence, goal mutation, memory write, owner panel or D-A3 operation choice',
    'Server perception/provisioning/UI/multi-host and physical gameplay/latency remain separate',
    'Existing Windows symlink escape test skipped because EPERM'],
  unrealReuse: { sourceReadOnly: true, candidates: [
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/QuestSystem/ChildQuests/BP_TalkToQuest.uasset', bytes: 55851 },
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/QuestSystem/QuestCreator/Data/E_QuestDialogueType.uasset', bytes: 4494 },
  ], decision: 'Unreal quest assets are nonportable C01/Node components; no graph inspected, export or source edits' },
  sourceFiles: Object.fromEntries(await Promise.all(mission.map(async (path) => [path, await hash(path)]))),
  evidenceFiles: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [directory + path, await hash(directory + path)]))),
  nextSlice: 'L03c: goals selected and revised from game feedback within authority and inference budget',
};
await writeFile(resolve(root, 'docs/delivery/l03b-agent-conversation-verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ agents: { tests: agents.tests, pass: agents.pass, skipped: agents.skipped },
  regression: { tests: regression.tests, pass: regression.pass }, rows: directions.length, da3Unchanged: true, drift }));

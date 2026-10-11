import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

// Rebuild the manifest only when the root-run suites still match the current working files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'docs/delivery/l02c-agent-authority/';
const read = (path) => readFile(resolve(root, path), 'utf8');
const hash = async (path) => createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
const agents = JSON.parse(await read(directory + 'agents-tests.json'));
const regression = JSON.parse(await read(directory + 'regression-tests.json'));
const baseline = JSON.parse(await read(directory + 'baseline.json'));
const plan = await read('PLAN-EXTRA-LLM.md');
const directions = plan.split(/\r?\n/).filter((line) => /^\| L0[0-6][a-e] \|/.test(line))
  .map((line) => line.split('|').slice(0, 4).join('|'));
const da3 = plan.split(/\r?\n/).find((line) => line.startsWith('| D-A3 '));
if (directions.length !== 22 || JSON.stringify(directions) !== JSON.stringify(baseline.directions) || da3 !== baseline.da3)
  throw new Error('Plan agreement/demonstration or D-A3 drift');
const finalDrift = [];
for (const [name, suite] of Object.entries({ agents, regression })) {
  if (suite.exitCode !== 0 || suite.fail !== 0 || suite.cancelled !== 0 || suite.changedDuringSuite.length)
    throw new Error(`Suite is not stable/passing: ${name}`);
  for (const [path, digest] of Object.entries(suite.after)) if (await hash(path) !== digest) finalDrift.push({ suite: name, path });
}
if (finalDrift.length || PROTOCOL_VERSION !== 28) throw new Error('Sources changed after acceptance or invalid protocol');
const missionFiles = [
  'server/agentControl.mjs', 'server/host.mjs', 'server/index.mjs', 'src/net/localServer.js', 'src/net/protocol.js',
  'tools/agent/network-client.mjs', 'tools/agent/network-runner.mjs', 'tools/agent/run.mjs',
  'tools/qa-agent-authority.mjs', 'tools/qa-agent-authority-evidence.mjs',
  'tests/agent-authority.test.mjs', 'tests/agent-authority-network.test.mjs', 'tests/agent-authority-runner.test.mjs',
  'docs/agents/authority-runner.md', 'docs/briefs/l02c-agent-authority.md', 'docs/delivery/l02c-agent-authority.md',
  'PLAN-EXTRA-LLM.md', 'PLAN-DELIVERY.md', 'DESIGN.md', 'docs/HANDOFF.md', 'docs/agents/interface-v1.md',
  'docs/agents/network-runner.md', 'docs/agents/lifecycle-runner.md', 'docs/agents/movement-runner.md',
  'docs/agents/pve-runner.md', 'docs/agents/chat-runner.md',
];
const artifacts = ['agents-tests.tap', 'agents-tests.json', 'regression-tests.tap', 'regression-tests.json', 'baseline.json'];
const summarize = ({ before, after, ...suite }) => ({ ...suite, dependencyCount: Object.keys(after).length,
  dependencyHashes: directory + (suite.log.startsWith('agents') ? 'agents-tests.json' : 'regression-tests.json') });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const verification = {
  schema: 'l02c-agent-authority-verification/v1', status: 'local_software_verified', generatedAt: new Date().toISOString(),
  checkout: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), sharedDirty: true, missionCommit: null,
    hashBasis: 'Complete root-run TAP with before/after fingerprints; shared checkout is not an immutable snapshot.' },
  protocol: { version: PROTOCOL_VERSION, previous: 27, changedByMission: true, agentOrderVersion: 1 },
  agentTests: summarize(agents), regressionTests: summarize(regression),
  dependencyStability: { status: 'verified', finalDrift, noRuntimeEditsAfterAcceptance: true },
  planIntegrity: { agreedDirectionRows: directions.length, agreementAndDemonstrationUnchanged: true,
    da3Unchanged: true, da3State: 'Propuesto; por acordar', baseline: directory + 'baseline.json' },
  localProof: { realWebSocket: true, realChildCli: true, authenticatedResolver: 'injected local fixture; no production account-provider verification',
    ownerAndCharacterAccounts: 'separate', serverPolicy: 'trusted opt-in API only', defaultEntrypointEnabled: false,
    inferenceCalls: 0, liveDeployment: false, newSqlMigrations: false, externalServicesTouched: false, existingEmbeddedSqlRegressionRan: true },
  guarantees: ['exclusive controller', 'authenticated account owner principal', 'fresh server session and control epoch',
    'direct > goal > reflex with task CAS', 'queue/carry/last cleared and neutral scheduled before next allowed tick',
    'discarded commands receive no application ACK', 'late tasks and old epochs rejected',
    'death/expiry/disconnect/failing admission retire controller', 'resume never restores old tasks',
    'token excluded from CLI arguments/output/context/owner files', 'bounded reentry attempts and action history'],
  limits: ['No provisioning, owner UI, production activation or custody workflow',
    'Per-process bindings/leases without durable restart recovery or multi-host exclusivity',
    'neutralPending does not prove a physical tick has run', 'Applied effects, including started attacks, are not rolled back',
    'Lost receipts preserve uncertain/unproven status', 'Capability/task input checks do not prove high-level trajectory fidelity',
    'PvE proximity suppression is not a complete PvP/perception policy', 'Windows symlink escape test skipped due to EPERM',
    'No real model/tokenizer/cost verification; L03-L06 pending'],
  unrealReuse: { sourceReadOnly: true, candidates: [
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/Character/Blueprints/BP_ARPG_PlayerController.uasset', bytes: 5365068 },
    { path: 'C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/AI/Behavior/AIBehaviorTree.uasset', bytes: 111879 },
  ], decision: 'Blueprints are conceptual references, not portable Node/ws authority; no export or source modification' },
  sourceFiles: Object.fromEntries(await Promise.all(missionFiles.map(async (path) => [path, await hash(path)]))),
  evidenceFiles: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [directory + path, await hash(directory + path)]))),
  nextSlice: 'L03a: bounded structured decisions, complete prompt budget, timeout and one request in flight',
};
await writeFile(resolve(root, 'docs/delivery/l02c-agent-authority-verification.json'), `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify({ agents: { tests: agents.tests, pass: agents.pass, skipped: agents.skipped },
  regression: { tests: regression.tests, pass: regression.pass }, rows: directions.length, da3Unchanged: true, finalDrift }));

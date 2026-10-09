import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'docs/delivery/l04b-agent-memory-admin/';
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
const ignoredIndependentChanges = [];
const independentAreas = ['src/client/', 'server/community/', 'server/migrations/community/'];
async function testDependencies(suite) {
  const pending = suite.command.split(' ').filter((arg) => arg.startsWith('tests/')).map((file) => resolve(root, file));
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop(); if (seen.has(file)) continue; seen.add(file);
    if (!/\.(mjs|js)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g))
      if (match[1].startsWith('.')) pending.push(resolve(dirname(file), match[1]));
    for (const match of source.matchAll(/new URL\(['"]([^'"]+\.(?:mjs|js|sql|json))['"],\s*import\.meta\.url\)/g))
      if (match[1].startsWith('.')) pending.push(resolve(dirname(file), match[1]));
  }
  return seen;
}
for (const [name, suite] of Object.entries({ agents, regression })) {
  if (suite.exitCode !== 0 || suite.fail !== 0 || suite.cancelled !== 0 ||
      !Number.isSafeInteger(suite.pass) || suite.pass < 1 || suite.tests !== suite.pass + suite.skipped)
    throw new Error(`Suite is not stable and passing: ${name}`);
  const dependencies = await testDependencies(suite);
  const independent = (path) => independentAreas.some((area) => path.startsWith(area)) && !dependencies.has(resolve(root, path));
  for (const path of suite.changedDuringSuite) {
    if (!independent(path)) throw new Error(`Test dependency changed during suite: ${name}: ${path}`);
    ignoredIndependentChanges.push({ suite: name, path, phase: 'during_suite', beforeHash: suite.before[path] ?? null, afterHash: suite.after[path] ?? null });
  }
  for (const [path, digest] of Object.entries(suite.after)) {
    const current = await hash(path);
    if (current === digest) continue;
    // Independent rendering and community storage work is outside this memory acceptance.
    // Keep every observed difference explicit; imported files may never be excluded.
    if (independent(path)) ignoredIndependentChanges.push({ suite: name, path, phase: 'after_suite', testedHash: digest, currentHash: current });
    else drift.push({ suite: name, path });
  }
}
if (drift.length) throw new Error(`Post-test source drift: ${JSON.stringify(drift)}`);
const mission = ['tools/agent/memory-management.mjs', 'tools/agent/memory-admin.mjs', 'tools/agent/manage-memory.mjs',
  'tools/agent/memory-store.mjs', 'tools/agent/owner-files.mjs', 'tools/agent/mind.mjs',
  'tools/qa-agent-memory-admin.mjs', 'tools/qa-agent-memory-admin-evidence.mjs',
  'tests/agent-memory-management.test.mjs', 'tests/agent-memory-admin-store.test.mjs', 'tests/agent-memory-admin-flow.test.mjs',
  'tests/agent-conversation-network.test.mjs',
  'docs/agents/memory-admin.md', 'docs/agents/memory-runner.md', 'docs/briefs/l04b-agent-memory-admin.md', 'docs/delivery/l04b-agent-memory-admin.md',
  'PLAN-EXTRA-LLM.md', 'PLAN-DELIVERY.md', 'DESIGN.md', 'docs/HANDOFF.md'];
const artifacts = ['baseline.json', 'agents-tests.tap', 'agents-tests.json', 'regression-tests.tap', 'regression-tests.json',
  'attempt1-agents-tests.tap', 'attempt1-agents-tests.json', 'attempt1-regression-tests.tap', 'attempt1-regression-tests.json',
  'attempt2-agents-tests.tap', 'attempt2-agents-tests.json', 'attempt3-agents-tests.tap', 'attempt3-agents-tests.json'];
const summarize = ({ before, after, ...suite }) => ({ ...suite, dependencyCount: Object.keys(after).length });
const verification = {
  schema: 'l04b-agent-memory-admin-verification/v1', status: 'local_software_verified', generatedAt: new Date().toISOString(),
  checkout: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), sharedDirty: true, missionCommit: null },
  protocol: { version: PROTOCOL_VERSION, changedByMission: false }, agentTests: summarize(agents), regressionTests: summarize(regression),
  newMissionTestFiles: ['agent-memory-management', 'agent-memory-admin-store', 'agent-memory-admin-flow'],
  dependencyStability: { finalDrift: drift, ignoredIndependentChanges, status: 'verified',
    scope: 'all core net/sim/data/server/agent modules and the test dependency graph, including static URL assets; unimported rendering and isolated community modules excluded',
    headChanges: 'recorded separately; unrelated commits do not replace exact tested dependency hashes' },
  earlierAttempt: { agents: 'one prior conversation fixture race: agent received its earlier echo during an invalid-reply turn',
    correction: 'await the existing echo and assert unchanged outbound request count; no chat runtime change',
    regression: '206 passed, but a concurrent integration changed HEAD and liveNavigationView.js during the suite',
    secondAgents: '398 passed with 3 skipped; an unrelated, unimported rendering view changed during broad client-folder hashing',
    scopeCorrection: 'all imported client files remain fingerprinted; client views outside the actual test import graph are excluded',
    thirdAgents: '397 passed with 3 skipped; the held-compaction fixture hit observation freshness before the file-change fence',
    thirdCorrection: 'inject a fixed clock for the held-compaction scenario; runtime freshness checks unchanged',
    finalAgents: '398 passed with 3 skipped; independent community storage files changed while tests ran, without changes to test dependencies',
    acceptance: 'both suites reran after the conversation fixture fix; agents repeated after scope and held-clock corrections; all prior logs retained' },
  planIntegrity: { agreedDirectionRows: directions.length, agreementAndDemonstrationUnchanged: true, da3Unchanged: true,
    da3State: 'Propuesto; por acordar', baseline: directory + 'baseline.json' },
  localProof: { actualOwnerFiles: true, byteExactBase64Export: true, pathFreeExport: true, childCli: true, freshRestartAfterDeletion: true,
    sourceReferenceClosure: 'v2 summaries and recursive legacy ID/id@revision sources', allLegacyRevisionsRemoved: true,
    fullPendingEvidencePreserved: true, terminalResolutionResurrectionBlocked: true, explicitRetentionOnly: true,
    explicitEncodingMigrationOnly: true, finalGuardAndAllFileHashFences: true, cooperativeAppendConflict: true,
    inFlightDeletedSource: 'held scripted compaction rejected before append; native usage reconciled',
    inFlightExpiredSource: 'held scripted decision rejected before action; native usage reconciled',
    providerCallsByAdministration: 0, paidProviderConnected: false, qualityWithRealModelAccepted: false, humanExperienceAccepted: false,
    externalServiceTouched: false, externalMigrationApplied: false, published: false, deployed: false },
  policies: { maxMemoryBytes: 1048576, automaticRetention: false, capacity: 'reject_without_deletion',
    removal: 'explicit_preview_and_owner_commit_with_hashes', revision: 'entry_count_plus_complete_file_hash',
    unresolvedOperations: 'reject_any_pending_evidence_change', migration: 'utf8_lf_jsonl_preserve_accepted_fields_and_provenance',
    authorization: 'local_directory_access_not_multiuser_server_authentication' },
  limits: ['No owner panel, remote administration, automatic TTL, embeddings or persistent derived index',
    'Previous exports, already sent provider contexts and all diagnostic RAM copies cannot be recalled',
    'Fresh explicit captures may record the same current observation again; no tombstone or automatic capture',
    'Cooperative local lock only; no OS-wide CAS, multi-host writes, stale-lock recovery or physical crash durability',
    'Local content hashes do not authenticate server evidence; real provider quality, accounting and human acceptance remain separate',
    'Existing Windows symlink checks may skip on EPERM; see exact suite report'],
  unrealReuse: { sourceReadOnly: true, inventory: 'docs/research/unreal-assets/myproject/FINDINGS.md',
    decision: 'No applicable portable component for local textual archive administration; no new assets or source edits' },
  sourceFiles: Object.fromEntries(await Promise.all(mission.map(async (path) => [path, await hash(path)]))),
  evidenceFiles: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [directory + path, await hash(directory + path)]))),
  nextSlice: 'L05a owner inference limits, durable reservations and reconciliation; provider approval and human experience remain separate',
};
await writeFile(resolve(root, 'docs/delivery/l04b-agent-memory-admin-verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ agents: { tests: agents.tests, pass: agents.pass, skipped: agents.skipped },
  regression: { tests: regression.tests, pass: regression.pass }, rows: directions.length, da3Unchanged: true, drift }));

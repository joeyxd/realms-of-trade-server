#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'root@62.171.136.148';
const HELPER_PATH = 'docs/delivery/l03d-companion-config/image-tests.py';
const HELPER = new URL('./image-tests.py', import.meta.url);
const OUTPUT = new URL('./image-tests.json', import.meta.url);
const RUNTIME_FILES = [
  'server/agentControl.mjs', 'server/host.mjs', 'server/index.mjs', 'server/store.mjs', 'server/companionConfig.mjs', 'server/companionConfigStore.mjs',
  'server/migrations/025_companion_config.sql', 'src/net/protocol.js', 'src/net/companionConfig.js',
  'src/client/companions.js', 'src/client/companionConfig.js', 'src/ui/companions.js', 'src/ui/companionConfig.js',
  'src/main.js', 'src/client/gameClient.js',
];
const TEST_FILES = [
  'tests/companions-client.test.mjs', 'tests/companions-network.test.mjs', 'tests/companions-ui.test.mjs',
  'tests/companion-config-client.test.mjs', 'tests/companion-config-network.test.mjs',
  'tests/companion-config-store.test.mjs', 'tests/companion-config-ui.test.mjs',
];

function fail(message) { console.error(message); process.exitCode = 1; }

function remoteRun(revision, helper) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST, 'python3', '-', revision],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('remote_timeout_180s')); }, 180000);
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => finish(error));
    child.on('close', (code, signal) => finish(null, { code, signal,
      stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
    child.stdin.on('error', error => finish(error)); child.stdin.end(helper);
  });
}

function gitBlobHash(revision, file) {
  const bytes = execFileSync('git', ['show', `${revision}:${file}`], {
    cwd: new URL('../../../', import.meta.url), maxBuffer: 32 * 1024 * 1024,
  });
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const revision = process.argv[2];
  if (!/^[0-9a-f]{40}$/.test(revision || '')) { fail('Expected one lowercase 40-character Git SHA.'); return; }

  try {
    // Git/Docker use LF; a Windows checkout may contain the same helper with CRLF.
    const helperBytes = Buffer.from(readFileSync(HELPER, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    const helperSha256 = createHash('sha256').update(helperBytes).digest('hex');
    if (helperSha256 !== gitBlobHash(revision, HELPER_PATH)) throw new Error('verification_helper_revision_mismatch');
    const response = await remoteRun(revision, helperBytes);
    if (response.code !== 0) throw new Error(`ssh_exit_${response.code ?? response.signal}`);
    let evidence;
    try { evidence = JSON.parse(response.stdout.trim()); } catch { throw new Error('remote_response_not_json'); }
    if (evidence.ok !== true || evidence.expectedRevision !== revision ||
        !/^sha256:[0-9a-f]{64}$/.test(evidence.imageId || '')) throw new Error('remote_evidence_not_successful');

    const counts = evidence.counts;
    if (!counts || counts.tests <= 0 || counts.pass !== counts.tests || counts.fail !== 0 ||
        counts.cancelled !== 0 || counts.skipped !== 0) throw new Error('remote_tests_not_all_passing');

    const hashes = { ...(evidence.hashes?.runtime || {}), ...Object.fromEntries(
      Object.entries(evidence.hashes?.tests || {}).map(([name, hash]) => [`tests/${name}`, hash])) };
    const expectedFiles = [...RUNTIME_FILES, ...TEST_FILES];
    if (Object.keys(hashes).length !== expectedFiles.length ||
        expectedFiles.some(file => !/^[0-9a-f]{64}$/.test(hashes[file] || ''))) throw new Error('remote_source_hashes_incomplete');
    for (const file of expectedFiles) {
      if (gitBlobHash(revision, file) !== hashes[file]) throw new Error(`source_hash_mismatch:${file}`);
    }

    const report = { schema: 'mn.l03d.companion-config.image-tests.v1', ...evidence,
      recordedAt: new Date().toISOString(), sourceHashesMatch: true, verificationHelperSha256: helperSha256 };
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ revision: evidence.expectedRevision, imageId: evidence.imageId, counts,
      sourceHashesMatch: true, verificationHelperSha256: helperSha256,
      runnerNetwork: evidence.runnerNetwork, sqlOrPGliteTests: evidence.sqlOrPGliteTests }));
  } catch (error) { fail(`Image verification failed: ${error.message}`); }
}

await main();

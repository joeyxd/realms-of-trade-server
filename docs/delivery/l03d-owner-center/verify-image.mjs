#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'root@62.171.136.148';
const HELPER = new URL('./image-tests.py', import.meta.url);
const OUTPUT = new URL('./image-tests.json', import.meta.url);
const RUNTIME_FILES = [
  'server/agentControl.mjs',
  'server/host.mjs',
  'src/client/companions.js',
  'src/ui/companions.js',
  'src/main.js',
  'src/client/gameClient.js',
  'src/net/protocol.js',
];
const TEST_FILES = [
  'tests/companions-client.test.mjs',
  'tests/companions-network.test.mjs',
  'tests/companions-ui.test.mjs',
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function remoteRun(revision, helper) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=15',
      HOST, 'python3', '-', revision,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('remote_timeout_150s'));
    }, 150_000);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => finish(null, {
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
    child.stdin.on('error', (error) => finish(error));
    child.stdin.end(helper);
  });
}

function gitBlobHash(revision, file) {
  const bytes = execFileSync('git', ['show', `${revision}:${file}`], {
    cwd: new URL('../../../', import.meta.url),
    maxBuffer: 32 * 1024 * 1024,
  });
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const revision = process.argv[2];
  if (!/^[0-9a-f]{40}$/.test(revision || '')) {
    fail('Expected one lowercase 40-character Git SHA.');
    return;
  }

  try {
    const helper = readFileSync(HELPER);
    const response = await remoteRun(revision, helper);
    if (response.code !== 0) throw new Error(`ssh_exit_${response.code ?? response.signal}`);
    let evidence;
    try {
      evidence = JSON.parse(response.stdout.trim());
    } catch {
      throw new Error('remote_response_not_json');
    }
    if (evidence.ok !== true || evidence.expectedRevision !== revision ||
        !/^sha256:[0-9a-f]{64}$/.test(evidence.imageId || '')) {
      throw new Error('remote_evidence_not_successful');
    }
    const counts = evidence.counts;
    if (!counts || counts.tests !== 22 || counts.pass !== 22 || counts.fail !== 0 ||
        counts.cancelled !== 0 || counts.skipped !== 0) {
      throw new Error('remote_test_counts_not_22_of_22');
    }

    const hashes = { ...(evidence.hashes?.runtime || {}), ...Object.fromEntries(
      Object.entries(evidence.hashes?.tests || {}).map(([name, hash]) => [`tests/${name}`, hash])) };
    const expectedFiles = [...RUNTIME_FILES, ...TEST_FILES];
    if (Object.keys(hashes).length !== expectedFiles.length ||
        expectedFiles.some((file) => !/^[0-9a-f]{64}$/.test(hashes[file] || ''))) {
      throw new Error('remote_source_hashes_incomplete');
    }
    for (const file of expectedFiles) {
      const localHash = gitBlobHash(revision, file);
      if (localHash !== hashes[file]) throw new Error(`source_hash_mismatch:${file}`);
    }

    const report = {
      ...evidence,
      recordedAt: new Date().toISOString(),
      sourceHashesMatch: true,
    };
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      revision: evidence.expectedRevision,
      imageId: evidence.imageId,
      counts,
      sourceHashesMatch: true,
    }));
  } catch (error) {
    fail(`Image verification failed: ${error.message}`);
  }
}

await main();

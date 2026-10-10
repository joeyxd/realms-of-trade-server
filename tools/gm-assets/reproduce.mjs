import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TOOL = path.join(HERE, 'gm-assets.mjs');
const CATALOG = path.join(ROOT, 'assets', 'editor', 'catalog.json');
const RECEIPT = path.join(ROOT, 'docs', 'art', 'gm00', 'receipts.json');

function run(command) {
  execFileSync(process.execPath, [TOOL, command], { cwd: ROOT, stdio: 'inherit' });
}

async function fingerprint() {
  const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  return JSON.stringify({ catalog: catalog.assets.map(a => [a.id, a.stats.sha256]), outputs: receipt.assets.map(a => [a.id, a.output.sha256]) });
}

run('prepare');
const first = await fingerprint();
run('prepare');
const second = await fingerprint();
assert.equal(second, first, 'the same pinned toolchain and source bytes must generate identical candidates');
run('check');
console.log('Reproducibility verified. This explicit command regenerated editor candidates and diagnostics.');

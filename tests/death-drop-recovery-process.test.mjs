import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('drop journal survives three processes: read-only startup, exact resume and progressive audit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mn-drop-recovery-'));
  try {
    const script = fileURLToPath(new URL('./helpers/death-drop-recovery-process.mjs', import.meta.url));
    for (const mode of ['seed','resume','audit']) {
      const r = spawnSync(process.execPath, [script, mode, path.join(root, 'db'), path.join(root, 'evidence.json')],
        { encoding: 'utf8', windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('subprocess ' + mode + ' passed'));
    }
  } finally {
    const resolved = path.resolve(root), parent = path.resolve(tmpdir());
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('mn-drop-recovery-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

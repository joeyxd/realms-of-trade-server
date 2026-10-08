import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('lost pickup reply survives a real process restart without resurrecting picked or expired loot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mn-death-drop-'));
  try {
    const script = fileURLToPath(new URL('./helpers/death-drop-process.mjs', import.meta.url));
    for (const mode of ['seed','read']) {
      const r = spawnSync(process.execPath, [script, mode, path.join(root, 'db'), path.join(root, 'evidence.json')],
        { encoding: 'utf8', windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('subprocess ' + mode + ' passed'));
    }
  } finally {
    const resolved = path.resolve(root), parent = path.resolve(tmpdir());
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('mn-death-drop-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

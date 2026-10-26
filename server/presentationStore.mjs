import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { emptyPresentationBindings, validatePresentationBindings } from '../src/data/presentationBindings.js';

// This store never opens the map registry's state, revisions or blobs.
export function createPresentationStore({ directory = null, log = console.warn } = {}) {
  const folder = directory ? path.join(directory, 'presentation') : null;
  const history = folder && path.join(folder, 'revisions');
  let current = { revision: 0, updatedAt: null, updatedBy: null, document: emptyPresentationBindings() };
  let loading, queue = Promise.resolve(), warned = false;
  const warn = () => { if (!warned) { warned = true; log('[presentation] unavailable or invalid stored content; using empty bindings'); } };
  const copy = () => structuredClone(current);
  async function prepare() {
    if (!loading) loading = (async () => {
      if (!folder) return;
      try {
        const raw = JSON.parse(await readFile(path.join(folder, 'current.json'), 'utf8'));
        const checked = validatePresentationBindings(raw.document);
        if (!Number.isSafeInteger(raw.revision) || raw.revision < 1 || !checked.ok ||
            typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt)) ||
            typeof raw.updatedBy !== 'string' || !raw.updatedBy) throw new Error('invalid');
        current = { revision: raw.revision, updatedAt: raw.updatedAt, updatedBy: raw.updatedBy, document: checked.value };
      } catch { warn(); }
    })();
    await loading;
  }
  async function atomic(file, value) {
    const temp = path.join(path.dirname(file), `.tmp-${randomUUID()}`);
    let handle;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close(); handle = null;
      await rename(temp, file);
    } finally { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
  }
  function put({ expectedRevision, document, updatedBy } = {}) {
    const checked = validatePresentationBindings(document);
    if (!checked.ok || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        typeof updatedBy !== 'string' || !updatedBy) return Promise.resolve({ ok: false, error: 'invalid', why: checked.why ?? 'revision' });
    const task = queue.then(async () => {
      await prepare();
      if (expectedRevision !== current.revision) return { ok: false, error: 'stale', revision: current.revision };
      if (current.revision === Number.MAX_SAFE_INTEGER) return { ok: false, error: 'invalid', why: 'revision' };
      const next = { revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy, document: checked.value };
      if (folder) {
        await mkdir(history, { recursive: true });
        await atomic(path.join(history, `${next.revision}.json`), next);
        await atomic(path.join(folder, 'current.json'), next);
      }
      current = next;
      if (folder) {
        try {
          const names = (await readdir(history)).filter(name => /^[1-9]\d*\.json$/.test(name))
            .sort((a, b) => Number(b.slice(0, -5)) - Number(a.slice(0, -5)));
          await Promise.all(names.slice(20).map(name => unlink(path.join(history, name))));
        } catch { warn(); }
      }
      return { ok: true, revision: current.revision };
    });
    queue = task.catch(() => {});
    return task;
  }
  return { prepare, async get() { await prepare(); return copy(); }, put };
}

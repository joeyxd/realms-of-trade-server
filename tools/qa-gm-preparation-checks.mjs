import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyPreparedRevision } from '../src/editor/publicationArtifact.js';

/** Shared browser checks; every remote write uses CAS and restores only our own last head. */
export async function runGmPreparationChecks({ page, origin, check, shot, out = null }) {
  const timeout = 20000;
  const action = (name) => page.locator(`[data-remote="${name}"]`).click();
  const ready = () => page.waitForFunction(() => __mn.gmEditor.remotePanel.state === 'ready', null, { timeout });
  const open = async () => { if (!await page.locator('.gm-remote-dialog[open]').count()) await page.locator('[data-action="remote"]').click(); };
  const local = await page.evaluate(() => ({ document: __mn.gmEditor.history.current(), selectedId: __mn.gmEditor.selectedId,
    language: __mn.gmEditor.lang, props: JSON.stringify(__mn.map.props), colliders: JSON.stringify(__mn.map.colliders) }));
  // Earlier GM03 acceptance deliberately exercises the account rate limit. Begin a fresh window.
  await new Promise((resolve) => setTimeout(resolve, 60000));
  await open(); await action('refresh'); await ready();
  const baseline = await page.evaluate(() => structuredClone(__mn.gmEditor.remotePanel.head));
  let last = baseline;
  let prepared;
  const setLocal = async (document) => {
    await page.evaluate(async (document) => {
      const editor = __mn.gmEditor; await editor._hydrate(document);
      editor._clearGhost(); editor.transform.detach(); editor.selectedId = null; editor._commit(document);
    }, document);
  };
  const save = async (document) => {
    await setLocal(document); await open(); await action('refresh'); await ready();
    const observed = await page.evaluate(() => structuredClone(__mn.gmEditor.remotePanel.head));
    assert.deepEqual(observed, last, 'concurrent author save must win over QA');
    await action('save'); await action('confirm'); await ready();
    last = await page.evaluate(() => structuredClone(__mn.gmEditor.remotePanel.head));
    assert.deepEqual(last.document, document);
  };
  try {
    await check('preparation_guest_denied_and_unsaved_design_requires_online_save', async () => {
      assert.equal((await fetch(origin + '/api/gm/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"expectedRevision":1}' })).status, 401);
      const changed = structuredClone(local.document); changed.objects = []; changed.baseOverrides = [];
      await setLocal(changed);
      if (JSON.stringify(changed) !== JSON.stringify(baseline.document)) assert.equal(await page.locator('[data-remote="prepare"]').isDisabled(), true);
    });
    const invalid = await page.evaluate(() => {
      const editor = __mn.gmEditor, p = editor.map.landmarks.spawn;
      return { schema: 'marea.gm.map-draft', version: 2, base: { seed: editor.map.seed >>> 0, revision: editor.baseRevision },
        objects: [{ id: 'qa-preparation-crate', assetId: 'prop:storage-crate', transform: {
          position: { x: p.x, y: editor.map.groundAt(p.x, p.z), z: p.z }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: { type: 'circle', radius: 1 } }], baseOverrides: [] };
    });
    await save(invalid);
    await check('preparation_reports_spawn_obstruction_and_focuses_the_object', async () => {
      await action('prepare'); await page.waitForSelector('.gm-publication-report[data-valid="false"]', { timeout });
      assert.equal(await page.locator('[data-remote="download-revision"]').count(), 0);
      assert.match(await page.locator('.gm-publication-report').innerText(), /spawn/);
      await shot(page, 'gm03b1-problems-es.png');
      await page.locator('[data-remote="focus-issue"]').first().click();
      assert.equal(await page.evaluate(() => __mn.gmEditor.selectedId), 'qa-preparation-crate');
      assert.equal(await page.locator('.gm-remote-dialog[open]').count(), 0);
    });
    const valid = structuredClone(invalid); valid.objects[0].collider = 'none';
    await save(valid);
    await check('preparation_download_is_verified_and_does_not_activate_or_modify_drafts', async () => {
      await action('prepare'); await page.waitForSelector('.gm-publication-report[data-valid="true"]', { timeout });
      const downloadEvent = page.waitForEvent('download'); await action('download-revision');
      const download = await downloadEvent; prepared = JSON.parse(await readFile(await download.path(), 'utf8'));
      const scope = await page.evaluate(() => __mn.gmEditor.remotePanel.remoteScope);
      await verifyPreparedRevision(prepared, { scope, draftRevision: last.revision, document: valid });
      if (out) await writeFile(resolve(out, 'prepared-example.json'), JSON.stringify(prepared, null, 2) + '\n');
      assert.equal(prepared.content.assets[0].id, 'prop:storage-crate');
      assert.match(prepared.content.assets[0].sha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), valid);
      assert.deepEqual(await page.evaluate(() => __mn.gmEditor.remotePanel.head), last);
      assert.equal(await page.evaluate(() => __mn.client.joined), false);
      assert.equal(await page.evaluate(() => JSON.stringify(__mn.map.props)), local.props);
      assert.equal(await page.evaluate(() => JSON.stringify(__mn.map.colliders)), local.colliders);
      await shot(page, 'gm03b1-prepared-es.png');
      await action('language'); await shot(page, 'gm03b1-prepared-en.png'); await action('language');
    });
    await check('preparation_is_repeatable_and_local_changes_invalidate_the_result', async () => {
      await action('prepare'); await page.waitForSelector('.gm-publication-report[data-valid="true"]', { timeout });
      assert.equal(await page.evaluate(() => __mn.gmEditor.remotePanel.prepared.revision.revisionId), prepared.revisionId);
      const changed = structuredClone(valid); changed.objects[0].transform.position.x += 1;
      await setLocal(changed);
      assert.equal(await page.locator('[data-remote="prepare"]').isDisabled(), true);
      assert.equal(await page.locator('[data-remote="download-revision"]').count(), 0);
    });
    await check('preparation_stale_remote_revision_conflicts_without_losing_local_work', async () => {
      await setLocal(valid);
      const changed = structuredClone(valid); changed.objects[0].transform.position.x += 1;
      const response = await page.evaluate(async ({ revision, changed }) => __mn.gmEditor.remoteClient.save(changed, revision), { revision: last.revision, changed });
      last = response.head;
      await action('prepare');
      await page.waitForFunction(() => __mn.gmEditor.remotePanel.state === 'conflict', null, { timeout });
      assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), valid);
      assert.equal(await page.locator('[data-remote="download-revision"]').count(), 0);
    });
  } finally {
    // Never overwrite an owner change observed since our last CAS operation.
    await open(); await action('refresh'); await ready();
    const observed = await page.evaluate(() => structuredClone(__mn.gmEditor.remotePanel.head));
    assert.deepEqual(observed, last, 'QA restoration stopped: another GM wrote the draft');
    const restored = baseline.document || { schema: 'marea.gm.map-draft', version: 2, base: invalidBase(local.document), objects: [], baseOverrides: [] };
    await save(restored);
    await check('preparation_remote_and_local_baselines_restored', async () => {
      assert.deepEqual(last.document, restored);
      await action('close'); await setLocal(local.document);
      await page.evaluate((id) => __mn.gmEditor.select(id), local.selectedId);
      if (await page.evaluate(() => __mn.gmEditor.lang) !== local.language) await page.locator('[data-role="language"]').click();
      assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), local.document);
    });
  }
  return { schema: 'gm03b1-preparation-browser/v1', revisionId: prepared?.revisionId,
    sourceRevision: prepared?.content.sourceRevision, baselineAssetCount: prepared?.content.baselineAssets?.length ?? null,
    restoredRevision: last.revision, originalRevision: baseline.revision };
}

const invalidBase = (document) => structuredClone(document.base);

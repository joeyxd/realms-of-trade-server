import assert from 'node:assert/strict';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Real authenticated browser acceptance for online private drafts. */
export async function runGm03ProductionChecks({ gmPage, browser, origin, out, evidence }) {
  const timeout = 20000;
  const checks = [];
  const screenshots = [];
  const errors = [];
  let secondContext = null;
  let secondPage = null;
  const assertReady = async (page) => {
    await page.waitForFunction(() => document.querySelector('.gm-remote-state')?.dataset.state === 'ready', null, { timeout });
    const state = await page.evaluate(() => ({ durable: __mn.gmEditor.remotePanel.durable,
      scope: __mn.gmEditor.remotePanel.remoteScope || __mn.gmEditor.remoteClient.scope }));
    assert.equal(state.durable, true, 'production draft provider must acknowledge durable storage');
    assert.ok(state.scope?.worldId && state.scope.seed === (await page.evaluate(() => __mn.map.seed >>> 0)));
    return state.scope;
  };
  const openPanel = async (page) => {
    await page.locator('[data-action="remote"]').click();
    await page.waitForFunction(() => document.querySelector('.gm-remote-dialog')?.open, null, { timeout });
    await page.waitForFunction(() => !['loading', 'saving', 'applying'].includes(
      document.querySelector('.gm-remote-state')?.dataset.state), null, { timeout });
    return assertReady(page);
  };
  const clickRemote = (page, name) => page.locator(`[data-remote="${name}"]`).click();
  const saveThroughReview = async (page) => {
    await clickRemote(page, 'save');
    assert.equal(await page.locator('.gm-remote-review').count(), 1);
    await page.locator('[data-remote="confirm"]').click();
    await assertReady(page);
    return page.evaluate(() => ({ head: structuredClone(__mn.gmEditor.remotePanel.head), durable: __mn.gmEditor.remotePanel.durable }));
  };
  const snapshot = (page) => page.evaluate(() => ({
    local: structuredClone(__mn.gmEditor.history.current()), selectedId: __mn.gmEditor.selectedId,
    language: __mn.gmEditor.lang, camera: __mn.world.camera.position.toArray(),
    quaternion: __mn.world.camera.quaternion.toArray(),
  }));
  const setLocalDocument = async (page, document, selectedId) => {
    await page.evaluate(async ({ document, selectedId }) => {
      const editor = __mn.gmEditor;
      await editor._hydrate(document);
      editor._commit(document);
      editor.select(selectedId && editor.records.has(selectedId) ? selectedId : document.objects[0]?.id || null);
    }, { document, selectedId });
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => !__mn.gmEditor.dirty, null, { timeout });
  };
  const moveFirstObject = async (page, delta) => {
    const id = await page.evaluate(() => __mn.gmEditor.history.current().objects[0]?.id);
    assert.ok(id, 'real GM local draft needs one placed object');
    await page.evaluate((id) => __mn.gmEditor.select(id), id);
    const x = await page.evaluate((id) => __mn.gmEditor.records.get(id).root.position.x, id);
    const input = page.locator('[data-field="x"]');
    await input.fill(String(x + delta)); await input.press('Tab');
    return page.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
  };
  const inspectHead = (page) => page.evaluate(() => structuredClone(__mn.gmEditor.remotePanel.head));
  const setLanguage = async (page, language) => {
    const current = await page.evaluate(() => __mn.gmEditor.lang);
    if (current !== language) await clickRemote(page, 'language');
    await page.waitForFunction((language) => __mn.gmEditor.lang === language, language, { timeout });
  };
  const originalLocal = await snapshot(gmPage);
  let remoteBaseline = null;
  let expectedTestHead = null;
  let remoteRestore = { attempted: false, status: 'not_started' };

  try {
    const state = await openPanel(gmPage);
    remoteBaseline = await inspectHead(gmPage);
    assert.ok(state.worldId);
    assert.ok(remoteBaseline && Number.isSafeInteger(remoteBaseline.revision));
    const currentLocal = await gmPage.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
    const firstSave = await saveThroughReview(gmPage);
    assert.equal(firstSave.head.revision, remoteBaseline.revision + 1);
    assert.equal(firstSave.durable, true);
    expectedTestHead = structuredClone(firstSave.head);
    checks.push('real_gm_remote_save_is_explicit_and_durable');

    await setLanguage(gmPage, 'es');
    await gmPage.addStyleTag({ content: '.account-status,.account-email,.account-status *, .account-email * { visibility:hidden !important; }' });
    const esShot = 'production-gm03a-online-es.png';
    await gmPage.screenshot({ path: `${out}/${esShot}` }); screenshots.push(esShot);
    await setLanguage(gmPage, 'en');
    const enShot = 'production-gm03a-online-en.png';
    await gmPage.screenshot({ path: `${out}/${enShot}` }); screenshots.push(enShot);
    await setLanguage(gmPage, originalLocal.language);

    // Preserve the live authenticated Supabase session in memory only; the new context has a fresh IndexedDB.
    const storageState = await gmPage.context().storageState();
    secondContext = await browser.newContext({ storageState, viewport: { width: 1280, height: 800 } });
    secondPage = await secondContext.newPage();
    secondPage.on('pageerror', (error) => errors.push('second_context_page_error'));
    await secondPage.goto(`${origin}/?q=low&tod=day`, { waitUntil: 'domcontentloaded' });
    await secondPage.waitForFunction(() => window.__mn?.gmEntry.allowed && !document.querySelector('#btn-gm-editor')?.disabled, null, { timeout: 90000 });
    await secondPage.locator('#btn-gm-editor').click();
    await secondPage.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active, null, { timeout });
    const secondScope = await openPanel(secondPage);
    assert.deepEqual(secondScope, state);
    const independentLocal = await secondPage.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
    assert.equal(independentLocal.objects.length, 0, 'second context must have independent browser-local draft storage');
    assert.deepEqual(await inspectHead(secondPage), expectedTestHead);

    await clickRemote(secondPage, 'load');
    assert.equal(await secondPage.locator('.gm-remote-review').count(), 1);
    await secondPage.locator('[data-remote="confirm"]').click();
    await assertReady(secondPage);
    assert.deepEqual(await secondPage.evaluate(() => structuredClone(__mn.gmEditor.history.current())), currentLocal);
    await clickRemote(secondPage, 'close');
    await secondPage.locator('[data-action="undo"]').click();
    assert.deepEqual(await secondPage.evaluate(() => structuredClone(__mn.gmEditor.history.current())), independentLocal);
    await openPanel(secondPage);
    await clickRemote(secondPage, 'load');
    await secondPage.locator('[data-remote="confirm"]').click();
    await assertReady(secondPage);
    assert.deepEqual(await secondPage.evaluate(() => structuredClone(__mn.gmEditor.history.current())), currentLocal);
    checks.push('real_gm_second_context_load_and_undo_round_trip');

    const staleRevision = expectedTestHead.revision;
    await clickRemote(gmPage, 'close');
    await moveFirstObject(gmPage, 1.5);
    await openPanel(gmPage);
    const primarySave = await saveThroughReview(gmPage);
    expectedTestHead = structuredClone(primarySave.head);
    assert.equal(expectedTestHead.revision, staleRevision + 1);

    await clickRemote(secondPage, 'close');
    const changedSecondary = await moveFirstObject(secondPage, -1.5);
    await openPanel(secondPage);
    await clickRemote(secondPage, 'save'); await secondPage.locator('[data-remote="confirm"]').click();
    await secondPage.waitForFunction(() => document.querySelector('.gm-remote-state')?.dataset.state === 'conflict', null, { timeout });
    assert.deepEqual(await secondPage.evaluate(() => structuredClone(__mn.gmEditor.history.current())), changedSecondary);
    assert.equal((await inspectHead(secondPage)).revision, staleRevision);
    await clickRemote(secondPage, 'refresh'); await assertReady(secondPage);
    assert.deepEqual(await inspectHead(secondPage), expectedTestHead);
    assert.deepEqual(await secondPage.evaluate(() => structuredClone(__mn.gmEditor.history.current())), changedSecondary);
    checks.push('real_gm_stale_context_conflict_preserves_local_and_refreshes_head');
    await secondContext.close(); secondContext = null; secondPage = null;

    // Restore only if the current server head is still our last test head. A concurrent owner write wins.
    await clickRemote(gmPage, 'refresh'); await assertReady(gmPage);
    const beforeRestore = await inspectHead(gmPage);
    if (!equal(beforeRestore, expectedTestHead)) {
      remoteRestore = { attempted: false, status: 'aborted_concurrent_change', expectedRevision: expectedTestHead.revision,
        observedRevision: beforeRestore.revision };
    } else {
      const seed = await gmPage.evaluate(() => __mn.map.seed >>> 0);
      const baseRevision = await gmPage.evaluate(() => __mn.gmEditor.baseRevision);
      const restoreDocument = remoteBaseline.document || { schema: 'marea.gm.map-draft', version: 2,
        base: { seed, revision: baseRevision }, objects: [], baseOverrides: [] };
      await clickRemote(gmPage, 'close');
      await setLocalDocument(gmPage, restoreDocument, restoreDocument.objects[0]?.id || null);
      await openPanel(gmPage); await clickRemote(gmPage, 'refresh'); await assertReady(gmPage);
      const immediatelyBeforePut = await inspectHead(gmPage);
      if (!equal(immediatelyBeforePut, expectedTestHead)) {
        remoteRestore = { attempted: false, status: 'aborted_concurrent_change', expectedRevision: expectedTestHead.revision,
          observedRevision: immediatelyBeforePut.revision };
      } else {
        await clickRemote(gmPage, 'save');
        assert.equal(await gmPage.locator('.gm-remote-review').count(), 1);
        await gmPage.locator('[data-remote="confirm"]').click();
        await gmPage.waitForFunction(() => ['ready', 'conflict'].includes(document.querySelector('.gm-remote-state')?.dataset.state), null, { timeout });
        if (await gmPage.locator('.gm-remote-state').getAttribute('data-state') === 'conflict') {
          remoteRestore = { attempted: true, status: 'aborted_concurrent_change', expectedRevision: expectedTestHead.revision };
        } else {
          const restored = await inspectHead(gmPage);
          assert.equal(restored.revision, expectedTestHead.revision + 1);
          assert.deepEqual(restored.document, restoreDocument);
          remoteRestore = { attempted: true, status: 'restored', fromRevision: remoteBaseline.revision,
            throughRevision: restored.revision, emptyBaseline: remoteBaseline.document === null };
        }
      }
      checks.push('real_gm_remote_head_restore_uses_cas');
    }
  } catch (error) {
    // Keep public evidence safe if Supabase returns provider details or an auth token in an error string.
    evidence.errors.push(String(error.stack || error).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/access_token[^\s,}"']*/gi, 'access_token=[redacted]'));
    throw error;
  } finally {
    try { if (secondContext) await secondContext.close(); } catch {}
    try {
      if (await gmPage.evaluate(() => !!__mn.gmEditor?.active).catch(() => false)) {
        if (await gmPage.locator('.gm-remote-dialog[open]').count()) await clickRemote(gmPage, 'close');
        const language = await gmPage.evaluate(() => __mn.gmEditor.lang);
        if (language !== originalLocal.language) await gmPage.locator('[data-role="language"]').click();
        const current = await gmPage.evaluate(() => structuredClone(__mn.gmEditor.history.current()));
        if (!equal(current, originalLocal.local)) await setLocalDocument(gmPage, originalLocal.local, originalLocal.selectedId);
        else await gmPage.evaluate((id) => __mn.gmEditor.select(id), originalLocal.selectedId);
        await gmPage.evaluate((original) => {
          __mn.world.camera.position.fromArray(original.camera);
          __mn.world.camera.quaternion.fromArray(original.quaternion);
          __mn.world.camera.updateMatrixWorld();
        }, originalLocal);
        assert.deepEqual(await gmPage.evaluate(() => structuredClone(__mn.gmEditor.history.current())), originalLocal.local);
        assert.equal(await gmPage.evaluate(() => __mn.gmEditor.selectedId), originalLocal.selectedId);
        checks.push('real_gm_local_editor_state_restored');
      }
    } catch { errors.push('local_fixture_restore_failed'); }
    evidence.gm03a = { schema: 'gm03a-public/v1', checks, screenshots, errors,
      originalRemoteRevision: remoteBaseline?.revision ?? null,
      testHeadRevision: expectedTestHead?.revision ?? null, remoteRestore };
    evidence.checks.push(...checks);
  }
}

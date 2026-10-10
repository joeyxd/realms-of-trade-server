import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Browser acceptance for the private remote draft panel. Uses the real host and browser storage. */
export async function runGm03Checks({ page, context, browser, setup, ready, origin, game, check, shot }) {
  const timeout = 15000;
  const waitState = async (targetPage, state) => targetPage.waitForFunction((state) => {
    const node = document.querySelector('.gm-remote-state'); return node?.dataset.state === state;
  }, state, { timeout });
  const openEditor = async (targetPage) => {
    await targetPage.locator('#btn-gm-editor').click();
    await targetPage.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active, null, { timeout });
  };
  const openPanel = async (targetPage) => {
    await targetPage.locator('[data-action="remote"]').click();
    await targetPage.waitForFunction(() => document.querySelector('.gm-remote-dialog')?.open, null, { timeout });
    await targetPage.waitForFunction(() => !['loading', 'saving', 'applying'].includes(
      document.querySelector('.gm-remote-state')?.dataset.state), null, { timeout });
  };
  const action = (targetPage, name) => targetPage.locator(`[data-remote="${name}"]`).click();
  const saveOnline = async (targetPage) => {
    await action(targetPage, 'save');
    await targetPage.locator('[data-remote="confirm"]').click();
  };
  const selectAndMove = async (targetPage, id, delta) => {
    await targetPage.evaluate((id) => __mn.gmEditor.select(id), id);
    const current = await targetPage.evaluate((id) => __mn.gmEditor.records.get(id).root.position.x, id);
    const field = targetPage.locator('[data-field="x"]');
    await field.fill(String(current + delta)); await field.press('Tab');
  };
  const readPending = (targetPage) => targetPage.evaluate(async () => {
    const client = __mn.gmEditor.remoteClient;
    return { key: client.key, value: await client.source.read(client.key) };
  });

  const initial = await page.evaluate(() => ({ document: structuredClone(__mn.gmEditor.history.current()),
    selectedId: __mn.gmEditor.selectedId, language: __mn.gmEditor.lang,
    camera: __mn.world.camera.position.toArray(), quaternion: __mn.world.camera.quaternion.toArray() }));
  assert.equal(initial.document.objects.length > 0, true, 'GM03 helper requires the existing placed model fixture');
  const objectId = initial.document.objects[0].id;
  const remoteUrl = new URL('api/gm/draft', origin).href;
  const secondary = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  let secondPage = null;
  let routeMode = null;
  let routeCommittedStatus = null;
  let releaseInFlight = null;
  let inFlightStarted = null;
  const inFlightSignal = new Promise((resolve) => { inFlightStarted = resolve; });
  const errors = [];
  const primaryErrorListener = (error) => errors.push(error.stack || error.message);
  page.on('pageerror', primaryErrorListener);

  try {
    await check('gm03_online_panel_is_private_and_does_not_join_gameplay', async () => {
      await openPanel(page);
      assert.equal(game.game.status().players, 0);
      assert.equal(await page.evaluate(() => __mn.client.joined), false);
      assert.equal(await page.locator('.gm-remote-state').getAttribute('data-state'), 'ready');
      assert.match(await page.locator('.gm-remote-comparison').innerText(), /Servidor|Server/);
    });

    await check('gm03_save_requires_review_and_reports_memory_durability', async () => {
      const before = await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision);
      await action(page, 'save');
      assert.equal(await page.locator('.gm-remote-review').count(), 1);
      assert.match(await page.locator('.gm-remote-review').innerText(), /Sustituir|Replace/);
      await page.locator('[data-remote="confirm"]').click();
      await waitState(page, 'ready');
      const result = await page.evaluate(() => ({ head: __mn.gmEditor.remotePanel.head,
        durable: __mn.gmEditor.remotePanel.durable }));
      assert.equal(result.head.revision, before + 1);
      assert.equal(result.durable, false, 'memory fixture response is explicitly temporary');
      assert.match(await page.locator('.gm-remote-state').innerText(), /memoria|memory/i);
    });

    await shot(page, 'gm03-online-es.png');
    await action(page, 'language');
    await page.waitForFunction(() => __mn.gmEditor.lang === 'en');
    await shot(page, 'gm03-online-en.png');
    await action(page, 'language');
    await page.waitForFunction((language) => __mn.gmEditor.lang === language, initial.language);

    await check('gm03_cross_browser_load_is_explicit_and_undoable', async () => {
      await setup(secondary);
      secondPage = await secondary.newPage();
      secondPage.on('pageerror', (error) => errors.push(error.stack || error.message));
      await ready(secondPage);
      await openEditor(secondPage); await openPanel(secondPage);
      assert.deepEqual(await secondPage.evaluate(() => __mn.gmEditor.remotePanel.head.document), initial.document);
      const emptyLocal = await secondPage.evaluate(() => __mn.gmEditor.history.current());
      assert.equal(emptyLocal.objects.length, 0, 'new browser must start with a separate local draft');
      await action(secondPage, 'load');
      assert.equal(await secondPage.locator('.gm-remote-review').count(), 1);
      assert.match(await secondPage.locator('.gm-remote-review').innerText(), /Cargar|Load/);
      await secondPage.locator('[data-remote="confirm"]').click();
      await waitState(secondPage, 'ready');
      assert.deepEqual(await secondPage.evaluate(() => __mn.gmEditor.history.current()), initial.document);
      await action(secondPage, 'close');
      await secondPage.locator('[data-action="undo"]').click();
      assert.deepEqual(await secondPage.evaluate(() => __mn.gmEditor.history.current()), emptyLocal);
      await secondPage.locator('[data-action="redo"]').click();
      assert.deepEqual(await secondPage.evaluate(() => __mn.gmEditor.history.current()), initial.document);
    });

    await check('gm03_stale_browser_conflicts_preserve_local_doc_and_refreshes_before_replace', async () => {
      const firstHead = await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision);
      await action(page, 'close');
      await selectAndMove(page, objectId, 2);
      await openPanel(page);
      await saveOnline(page); await waitState(page, 'ready');
      assert.equal(await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision), firstHead + 1);

      const stale = await secondPage.evaluate(() => __mn.gmEditor.remotePanel.head.revision);
      await selectAndMove(secondPage, objectId, -3);
      const preserved = await secondPage.evaluate(() => __mn.gmEditor.history.current());
      await openPanel(secondPage);
      await saveOnline(secondPage);
      await waitState(secondPage, 'conflict');
      assert.deepEqual(await secondPage.evaluate(() => __mn.gmEditor.history.current()), preserved);
      assert.equal(await secondPage.evaluate(() => __mn.gmEditor.remotePanel.head.revision), stale);
      await action(secondPage, 'refresh'); await waitState(secondPage, 'ready');
      assert.equal(await secondPage.evaluate(() => __mn.gmEditor.remotePanel.head.revision), firstHead + 1);
      assert.deepEqual(await secondPage.evaluate(() => __mn.gmEditor.history.current()), preserved);
      await saveOnline(secondPage); await waitState(secondPage, 'ready');
      assert.equal(await secondPage.evaluate(() => __mn.gmEditor.remotePanel.head.revision), firstHead + 2);
    });

    await check('gm03_committed_lost_response_reopens_as_exact_retry_without_double_increment', async () => {
      await secondary.close(); secondPage = null;
      await action(page, 'close');
      await openPanel(page); await action(page, 'refresh'); await waitState(page, 'ready');
      const currentHead = await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision);
      await action(page, 'close');
      await selectAndMove(page, objectId, 1.25);
      await openPanel(page);
      await page.route(remoteUrl, async (route) => {
        if (route.request().method() === 'PUT' && routeMode === 'lose-response') {
          routeMode = null;
          const upstream = await route.fetch(); routeCommittedStatus = upstream.status();
          await route.abort();
          return;
        }
        await route.continue();
      });
      routeMode = 'lose-response';
      await saveOnline(page);
      await page.waitForFunction(() => __mn.gmEditor.remoteClient.pending !== null, null, { timeout });
      await waitState(page, 'pending');
      assert.equal(routeCommittedStatus, 200);
      const beforeClose = await readPending(page);
      const attempt = beforeClose.value.operation; assert.ok(attempt);
      const committedHead = currentHead + 1;
      assert.deepEqual(attempt.document, await page.evaluate(() => __mn.gmEditor.history.current()));
      await page.unroute(remoteUrl);
      await action(page, 'close');
      await page.locator('[data-action="close"]').click();
      await page.waitForFunction(() => __mn.st.mode === 'title', null, { timeout });
      await ready(page);
      await openEditor(page); await openPanel(page); await waitState(page, 'pending');
      assert.equal(await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision), committedHead);
      let retryPayload = null;
      await page.route(remoteUrl, async (route) => {
        if (route.request().method() === 'PUT') retryPayload = route.request().postDataJSON();
        await route.continue();
      });
      await action(page, 'retry'); await waitState(page, 'ready');
      await page.waitForFunction(() => __mn.gmEditor.remoteClient.pending === null, null, { timeout });
      assert.deepEqual(retryPayload, attempt);
      assert.equal(await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision), committedHead);
      await page.unroute(remoteUrl);
      await action(page, 'close');
      await selectAndMove(page, objectId, 2.5);
      const laterLocal = await page.evaluate(() => __mn.gmEditor.history.current());
      assert.notDeepEqual(laterLocal, attempt.document);
      assert.deepEqual(await page.evaluate(() => __mn.gmEditor.remotePanel.head.document), attempt.document);
      assert.equal(await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision), committedHead);
    });

    await check('gm03_logout_during_put_closes_editor_without_accepting_or_erasing_attempt', async () => {
      await selectAndMove(page, objectId, 0.75);
      await openPanel(page);
      await page.evaluate(() => __mn.gmEditor.saveNow());
      await page.waitForFunction(() => !__mn.gmEditor.dirty, null, { timeout });
      const head = await page.evaluate(() => __mn.gmEditor.remotePanel.head.revision);
      await page.route(remoteUrl, async (route) => {
        if (route.request().method() === 'PUT' && routeMode === 'hold-response') {
          routeMode = null;
          const upstream = await route.fetch(); routeCommittedStatus = upstream.status(); inFlightStarted();
          await new Promise((resolve) => { releaseInFlight = resolve; });
          try { await route.fulfill({ response: upstream }); } catch { /* The client may have aborted on sign-out. */ }
          return;
        }
        await route.continue();
      });
      routeMode = 'hold-response'; await saveOnline(page);
      await Promise.race([inFlightSignal, new Promise((_, reject) => setTimeout(() => reject(new Error('PUT did not reach the host')), timeout))]);
      const attempt = (await readPending(page)).value.operation; assert.ok(attempt);
      assert.equal(attempt.expectedRevision, head);
      await page.evaluate(() => window.__gmFixtureSignOut());
      await page.waitForFunction(() => __mn.st.mode === 'title', null, { timeout });
      releaseInFlight?.(); releaseInFlight = null;
      await page.waitForTimeout(100);
      const pendingAfter = await page.evaluate(async () => {
        const client = __mn.gmEditor.remoteClient; return client.source.read(client.key);
      });
      assert.equal(routeCommittedStatus, 200);
      assert.deepEqual(pendingAfter.operation, attempt);
      assert.equal(await page.evaluate(() => __mn.gmEditor.active), false);
      await page.unroute(remoteUrl);

      // Re-authenticate through the fixture's normal page bootstrap, then resolve the exact receipt in the UI.
      await ready(page); await openEditor(page); await openPanel(page);
      await waitState(page, 'pending');
      await action(page, 'retry'); await waitState(page, 'ready');
      await page.waitForFunction(() => __mn.gmEditor.remoteClient.pending === null, null, { timeout });
    });

    await check('gm03_old_base_copy_can_be_exported_and_changed_runtime_cannot_overwrite', async () => {
      const local = await page.evaluate(() => __mn.gmEditor.history.current());
      let changedRuntime = false;
      await page.route(remoteUrl, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const upstream = await route.fetch(), body = await upstream.json();
        body.head.document.base.revision = 'qa-older-base';
        if (changedRuntime) body.scope.baseRevision = 'qa-newer-runtime';
        await route.fulfill({ response: upstream, json: body });
      });
      await action(page, 'refresh'); await waitState(page, 'ready');
      assert.equal(await page.locator('[data-remote="load"]').isDisabled(), true);
      const downloadPromise = page.waitForEvent('download');
      await action(page, 'export-remote');
      const download = await downloadPromise;
      const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(exported.document.base.revision, 'qa-older-base');
      assert.deepEqual(await page.evaluate(() => __mn.gmEditor.history.current()), local);
      changedRuntime = true;
      await action(page, 'refresh'); await waitState(page, 'incompatible');
      assert.equal(await page.locator('[data-remote="save"]').isDisabled(), true);
      assert.equal(await page.locator('[data-remote="load"]').isDisabled(), true);
      assert.equal(await page.locator('[data-remote="export-remote"]').isEnabled(), true);
      await page.unroute(remoteUrl);
      await action(page, 'refresh'); await waitState(page, 'ready');
    });
  } finally {
    try {
      if (secondPage && !secondPage.isClosed()) await secondPage.close();
      if (secondary) await secondary.close();
    } catch { /* Preserve the primary page so it can be restored below. */ }
    try {
      if (!page.isClosed() && await page.evaluate(() => !!__mn.gmEditor?.active).catch(() => false)) {
        const state = await page.evaluate(() => ({ active: __mn.gmEditor.active, language: __mn.gmEditor.lang }));
        if (await page.locator('.gm-remote-dialog[open]').count()) await action(page, 'close');
        if (state.language !== initial.language) await page.locator('[data-role="language"]').click();
        await page.evaluate((initial) => {
          const editor = __mn.gmEditor;
          editor._commit(initial.document);
          editor.select(initial.selectedId);
          __mn.world.camera.position.fromArray(initial.camera);
          __mn.world.camera.quaternion.fromArray(initial.quaternion);
          __mn.world.camera.updateMatrixWorld();
        }, initial);
        await page.evaluate(() => __mn.gmEditor.saveNow());
        await page.waitForFunction(() => !__mn.gmEditor.dirty, null, { timeout }).catch(() => {});
      }
    } catch (error) { errors.push(error.stack || error.message); }
    page.off('pageerror', primaryErrorListener);
  }
  assert.deepEqual(errors, []);
}

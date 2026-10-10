// Public deployment smoke test; no account credentials or fixture auth.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME } from '../src/data/meta.js';
import { runGm03ProductionChecks } from './qa-gm03-production-checks.mjs';
const origin = 'https://marea.62.171.136.148.sslip.io';
const out = resolve(process.env.MN_GM_QA_OUTPUT || 'docs/delivery/gm03a');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const evidence = { schema: 'gm03a-public/v1', at: new Date().toISOString(), production: true, simulatedAuth: false, checks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  assert.equal((await fetch(origin + '/health')).status, 200);
  const status = await (await fetch(origin + '/status')).json();
  evidence.version = status.version;
  assert.equal(status.version, GAME.version);
  evidence.storage = { kind: status.storage.kind, durable: status.storage.durable, accounts: status.storage.accounts, errors: status.storage.errors };
  assert.equal(status.errors, 0); assert.equal(status.storage.errors, 0);
  evidence.checks.push('public_health_version_and_storage');
  assert.equal((await fetch(origin + '/api/gm/session')).status, 401);
  evidence.checks.push('public_guest_denied_gm');
  const catalog = await (await fetch(origin + '/assets/editor/catalog.json')).json();
  assert.equal(catalog.assets.length, 4);
  const rock = catalog.assets.find((entry) => entry.id === 'model:gm-rock-1k');
  const bytes = Buffer.from(await (await fetch(origin + '/assets/' + rock.src)).arrayBuffer());
  assert.equal(bytes.length, rock.stats.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), rock.stats.sha256);
  evidence.checks.push('public_optimized_model_hash_and_bytes');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  await page.goto(origin + '/?q=high&tod=day', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mn, null, { timeout: 90000 });
  evidence.guestBoot = await page.evaluate(() => ({ online: __mn.st.online, transport: __mn.transport.kind,
    serverMarked: !!document.querySelector('meta[name="mn-server"]'), signedIn: __mn.gmEntry.auth.state.signedIn }));
  assert.equal(await page.evaluate(() => __mn.gmEntry.button.hidden), true);
  await page.locator('#btn-play').click({ force: true });
  await page.waitForFunction(() => __mn.st.mode === 'playing' && __mn.client.joined, null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
  await page.screenshot({ path: resolve(out, 'production-gameplay.png') });
  evidence.checks.push('real_public_browser_guest_join');
  if (process.env.MN_GM_SETUP_FILE) {
    const file = process.env.MN_GM_SETUP_FILE;
    const { tokenHash } = JSON.parse(await readFile(file, 'utf8'));
    await unlink(file);
    assert.match(tokenHash, /^[a-f0-9]{32,128}$/i);
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    gmPage.on('pageerror', () => evidence.errors.push('production_gm_page_error'));
    await gmPage.goto(origin + '/?q=high&tod=day&account-setup=1#gm_setup_token=' + tokenHash, { waitUntil: 'domcontentloaded' });
    await gmPage.waitForFunction(() => window.__mn?.gmEntry.allowed && !document.querySelector('.gm-account-setup-overlay')?.hidden, null, { timeout: 90000 });
    assert.equal(await gmPage.evaluate(() => location.hash), '');
    await gmPage.addStyleTag({ content: '.account-status, .account-email { visibility: hidden !important; }' });
    await gmPage.screenshot({ path: resolve(out, 'production-account-setup.png') });
    await gmPage.locator('.gm-account-setup-card [data-action="cancel"]').click();
    await gmPage.locator('#btn-gm-editor').click();
    await gmPage.waitForFunction(() => __mn.st.mode === 'editor');
    const entryFrame = await gmPage.evaluate(() => __mn.world.pipeline.frame);
    await gmPage.waitForFunction((frame) => __mn.errors.size || __mn.world.pipeline.frame >= frame + 6, entryFrame);
    assert.deepEqual(await gmPage.evaluate(() => [...__mn.errors]), []);
    await gmPage.locator('[data-editor-asset="model:gm-rock-1k"]').click();
    await gmPage.waitForFunction(() => !!__mn.gmEditor.ghost);
    await gmPage.mouse.move(700, 420); await gmPage.mouse.click(700, 420);
    await gmPage.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 1);
    await gmPage.keyboard.press('Escape');
    await gmPage.evaluate(() => { __mn.gmEditor.select(__mn.gmEditor.history.current().objects[0].id); const p=__mn.gmEditor.records.get(__mn.gmEditor.selectedId).root.position; __mn.world.camera.position.set(p.x+12,p.y+8,p.z+12); __mn.gmEditor._focusSelection(); });
    await gmPage.locator('[data-action="save"]').click();
    await gmPage.waitForFunction(() => !__mn.gmEditor.dirty);
    assert.equal(await gmPage.evaluate(() => __mn.client.joined), false);
    const placementFrame = await gmPage.evaluate(() => __mn.world.pipeline.frame);
    await gmPage.waitForFunction((frame) => __mn.errors.size || __mn.world.pipeline.frame >= frame + 6, placementFrame);
    assert.deepEqual(await gmPage.evaluate(() => [...__mn.errors]), []);
    assert.equal(await gmPage.evaluate(() => __mn.quality.current), 'high');
    assert.equal(await gmPage.evaluate(() => __mn.world.pipeline.q.outlines), true);
    await gmPage.screenshot({ path: resolve(out, 'production-gm-editor.png') });
    evidence.checks.push('real_owner_high_quality_gizmo_frames_have_no_caught_errors');
    evidence.checks.push('real_owner_recovery_session_password_prompt_gm_placement_and_local_save');

    const originalDocument = await gmPage.evaluate(() => __mn.gmEditor.history.current());
    assert.equal(originalDocument.objects.length, 1);
    assert.deepEqual(originalDocument.baseOverrides, []);
    const baseState = await gmPage.evaluate(() => {
      const editor = __mn.gmEditor;
      const village = editor.map.landmarks?.village || editor.map.landmarks?.spawn || { x: 0, z: 0 };
      const item = editor.baseLayer.list().filter((entry) => entry.editable && entry.kind === 'rock')
        .sort((a, b) => ((a.transform.position.x - village.x) ** 2 + (a.transform.position.z - village.z) ** 2) -
          ((b.transform.position.x - village.x) ** 2 + (b.transform.position.z - village.z) ** 2))[0];
      if (!item) return null;
      const matrix = new item.mesh.matrix.constructor(); item.mesh.getMatrixAt(item.instanceIndex, matrix);
      item.mesh.geometry.computeBoundingSphere(); item.mesh.updateWorldMatrix(true, false);
      const visualCenter = item.mesh.geometry.boundingSphere.center.clone()
        .applyMatrix4(item.mesh.matrixWorld.clone().multiply(matrix)).toArray();
      return { id: item.id, transform: item.transform, collider: item.collider, matrix: matrix.toArray(),
        visualCenter, props: structuredClone(editor.map.props), colliders: structuredClone(editor.map.colliders) };
    });
    assert.ok(baseState, 'production map must contain at least one editable base rock');
    const baseDelta = baseState.transform.position.x <= 278 ? 2 : -2;
    await gmPage.locator('[data-action="tab-scene"]').click();
    await gmPage.locator('[data-role="scene-search"]').fill(baseState.id);
    await gmPage.locator(`[data-scene-id="${baseState.id}"]`).click();
    await gmPage.locator('[data-field="x"]').fill(String(baseState.transform.position.x + baseDelta));
    await gmPage.locator('[data-field="x"]').press('Tab');
    await gmPage.waitForFunction((id) => __mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), baseState.id);
    await gmPage.waitForFunction(async (id) => {
      const saved = await __mn.gmEditor.store.load();
      return !__mn.gmEditor.dirty && saved.document?.baseOverrides.some((item) => item.id === id);
    }, baseState.id);
    const editedBase = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, entry = editor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor();
      entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
      return { document: editor.history.current(), matrix: matrix.toArray(),
        props: structuredClone(editor.map.props), colliders: structuredClone(editor.map.colliders) };
    }, baseState.id);
    assert.equal(editedBase.document.baseOverrides.find((item) => item.id === baseState.id).transform.position.x,
      baseState.transform.position.x + baseDelta);
    assert.notDeepEqual(editedBase.matrix, baseState.matrix);
    assert.deepEqual(editedBase.document.objects, originalDocument.objects);
    assert.deepEqual(editedBase.props, baseState.props);
    assert.deepEqual(editedBase.colliders, baseState.colliders);
    await gmPage.screenshot({ path: resolve(out, 'production-gm02-base.png') });
    evidence.checks.push('real_owner_gm02_base_rock_numeric_edit_is_draft_only_and_map_stays_unchanged');

    await gmPage.locator('[data-action="save"]').click();
    await gmPage.waitForFunction(() => !__mn.gmEditor.dirty);
    await gmPage.locator('[data-action="close"]').click();
    await gmPage.waitForFunction(() => __mn.st.mode === 'title' && !__mn.gmEditor.active);
    await gmPage.locator('#btn-gm-editor').click();
    await gmPage.waitForFunction(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
    await gmPage.waitForFunction((id) => __mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), baseState.id);
    const reopenedBase = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, entry = editor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor();
      entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
      return { document: editor.history.current(), matrix: matrix.toArray(),
        props: structuredClone(editor.map.props), colliders: structuredClone(editor.map.colliders) };
    }, baseState.id);
    assert.equal(reopenedBase.document.baseOverrides[0].id, baseState.id);
    assert.deepEqual(reopenedBase.document.objects, originalDocument.objects);
    assert.deepEqual(reopenedBase.props, baseState.props);
    assert.deepEqual(reopenedBase.colliders, baseState.colliders);
    assert.notDeepEqual(reopenedBase.matrix, baseState.matrix);
    await gmPage.locator('[data-action="tab-scene"]').click();
    await gmPage.locator('[data-role="scene-search"]').fill(baseState.id);
    await gmPage.locator(`[data-scene-id="${baseState.id}"]`).click();
    await gmPage.locator('[data-action="restore-base"]').click();
    await gmPage.waitForFunction((id) => !__mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), baseState.id);
    await gmPage.locator('[data-action="save"]').click();
    await gmPage.waitForFunction(() => !__mn.gmEditor.dirty);
    const restoredBase = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, entry = editor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor();
      entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
      return { document: editor.history.current(), matrix: matrix.toArray(),
        props: structuredClone(editor.map.props), colliders: structuredClone(editor.map.colliders) };
    }, baseState.id);
    assert.deepEqual(restoredBase.document.baseOverrides, []);
    assert.deepEqual(restoredBase.matrix, baseState.matrix);
    assert.deepEqual(restoredBase.props, baseState.props);
    assert.deepEqual(restoredBase.colliders, baseState.colliders);
    evidence.checks.push('real_owner_gm02_saved_base_override_reopens_and_restore_returns_original_matrix');

    const originalId = originalDocument.objects[0].id;
    await gmPage.locator('[data-role="scene-search"]').fill(baseState.id);
    await gmPage.locator(`[data-scene-id="${baseState.id}"]`).click();
    await gmPage.locator('[data-action="duplicate"]').click();
    await gmPage.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 2);
    const duplicatedBase = await gmPage.evaluate((id) => {
      const doc = __mn.gmEditor.history.current(), item = doc.objects.find((entry) => entry.assetId === id);
      const record = __mn.gmEditor.records.get(item.id); record.root.updateMatrixWorld(true);
      let mesh; record.root.traverse((node) => { if (!mesh && node.isMesh) mesh = node; });
      mesh.geometry.computeBoundingSphere();
      return { item, center: mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld).toArray() };
    }, baseState.id);
    assert.ok(duplicatedBase.item, 'duplicate action should create a decoration from the selected base rock');
    assert.equal(duplicatedBase.item.assetId, baseState.id);
    assert.equal(duplicatedBase.item.collider.type, baseState.collider.type);
    if (baseState.collider.type === 'circle') assert.equal(duplicatedBase.item.collider.radius, baseState.collider.radius);
    const duplicateX = Math.max(-280, Math.min(280, baseState.transform.position.x + 2));
    const duplicateZ = Math.max(-280, Math.min(280, baseState.transform.position.z + 2));
    assert.equal(duplicatedBase.item.transform.position.x, duplicateX);
    assert.equal(duplicatedBase.item.transform.position.z, duplicateZ);
    assert.ok(Math.abs(duplicatedBase.center[0] - (baseState.visualCenter[0] + duplicateX - baseState.transform.position.x)) < .05);
    assert.ok(Math.abs(duplicatedBase.center[2] - (baseState.visualCenter[2] + duplicateZ - baseState.transform.position.z)) < .05);
    await gmPage.locator('[data-action="undo"]').click();
    await gmPage.waitForFunction(() => __mn.gmEditor.history.current().objects.length === 1);
    assert.equal(await gmPage.evaluate((id) => __mn.gmEditor.history.current().objects.some((item) => item.id === id), duplicatedBase.item.id), false);
    await gmPage.locator('[data-role="scene-search"]').fill(originalId);
    await gmPage.locator(`[data-scene-id="${originalId}"]`).click();
    await gmPage.locator('[data-setting="collider"]').selectOption('circle');
    await gmPage.waitForFunction((id) => {
      const item = __mn.gmEditor.history.current().objects.find((object) => object.id === id);
      return item?.collider?.type === 'circle' && item.collider.radius > 0;
    }, originalId);
    const circle = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, item = editor.history.current().objects.find((object) => object.id === id);
      return { item, radiusInput: Number(editor.colliderRadius.value), footprintVisible: editor.footprint.visible,
        footprintScale: editor.footprint.scale.x };
    }, originalId);
    assert.ok(Number.isFinite(circle.item.collider.radius) && circle.item.collider.radius >= .05 && circle.item.collider.radius <= 50);
    assert.equal(circle.radiusInput, circle.item.collider.radius);
    assert.equal(circle.footprintVisible, true);
    assert.ok(Math.abs(circle.footprintScale - circle.item.collider.radius * circle.item.transform.scale) < 1e-5);
    evidence.checks.push('real_owner_gm02_base_duplicate_inherits_proxy_and_circle_radius_autosizes');

    await runGm03ProductionChecks({ gmPage, browser, origin, out, evidence });
    assert.deepEqual(evidence.gm03a.errors, []);
    assert.equal(evidence.gm03a.remoteRestore.status, 'restored');

    const walkCamera = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, record = editor.records.get(id), point = record.root.position;
      editor.camera.position.set(point.x + 12, point.y + 8, point.z + 12); editor.cameraController.focus(point);
      return { position: editor.camera.position.toArray(), quaternion: editor.camera.quaternion.toArray() };
    }, originalId);
    const walkDocument = await gmPage.evaluate(() => __mn.gmEditor.history.current());
    const walkMap = await gmPage.evaluate(() => ({ props: structuredClone(__mn.map.props), colliders: structuredClone(__mn.map.colliders) }));
    await gmPage.locator('[data-action="walk"]').click();
    await gmPage.waitForFunction(() => __mn.gmEditor.walkPreview.active);
    await gmPage.screenshot({ path: resolve(out, 'production-gm02-walk.png') });
    const walkStart = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, walk = editor.walkPreview, item = editor.history.current().objects.find((entry) => entry.id === id);
      const position = walk.position;
      const collider = walk.world.map.colliders.find((entry) => Math.abs(entry.x - item.transform.position.x) < 1e-5 &&
        Math.abs(entry.z - item.transform.position.z) < 1e-5 && Math.abs(entry.r - item.collider.radius * item.transform.scale) < 1e-5);
      return { position, collider, body: walk.body, view: !!walk.view, joined: __mn.client.joined,
        document: editor.history.current() };
    }, originalId);
    assert.ok(walkStart.body > 0 && walkStart.view);
    assert.ok(walkStart.collider, 'private walk map should contain the draft circle collider');
    assert.equal(walkStart.joined, false);
    await gmPage.locator('#game').focus();
    await gmPage.keyboard.down('KeyW');
    await gmPage.waitForFunction((before) => {
      const p = __mn.gmEditor.walkPreview.position;
      return Math.hypot(p.x - before.x, p.z - before.z) > .5;
    }, walkStart.position, { timeout: 10000 });
    await gmPage.keyboard.up('KeyW');
    const walkEnd = await gmPage.evaluate((id) => {
      const editor = __mn.gmEditor, walk = editor.walkPreview, item = editor.history.current().objects.find((entry) => entry.id === id);
      const position = walk.position;
      return { position, keys: [...walk.keys], distance: Math.hypot(position.x - item.transform.position.x,
        position.z - item.transform.position.z), radius: item.collider.radius * item.transform.scale,
        joined: __mn.client.joined, document: editor.history.current(), errors: [...__mn.errors] };
    }, originalId);
    assert.deepEqual(walkEnd.keys, []);
    assert.ok(walkEnd.distance >= walkEnd.radius + .25, 'W movement should remain outside the selected draft circle');
    assert.deepEqual(walkEnd.document, walkDocument);
    assert.equal(walkEnd.joined, false);
    assert.deepEqual(walkEnd.errors, []);
    await gmPage.keyboard.press('Escape');
    await gmPage.waitForFunction(() => !__mn.gmEditor.walkPreview.active);
    const walkRestored = await gmPage.evaluate(() => ({ position: __mn.world.camera.position.toArray(),
      quaternion: __mn.world.camera.quaternion.toArray(), document: __mn.gmEditor.history.current(),
      viewExists: __mn.world.views.has('gm-private-walker'), mapProps: structuredClone(__mn.map.props),
      mapColliders: structuredClone(__mn.map.colliders), joined: __mn.client.joined, errors: [...__mn.errors] }));
    assert.deepEqual(walkRestored.position, walkCamera.position);
    assert.deepEqual(walkRestored.quaternion, walkCamera.quaternion);
    assert.deepEqual(walkRestored.document, walkDocument);
    assert.equal(walkRestored.viewExists, false);
    assert.equal(walkRestored.joined, false);
    assert.deepEqual(walkRestored.errors, []);
    assert.deepEqual(walkRestored.mapProps, walkMap.props);
    assert.deepEqual(walkRestored.mapColliders, walkMap.colliders);
    evidence.checks.push('real_owner_gm02_private_walk_moves_with_w_and_restores_camera_document_and_map');

    await gmPage.locator('[data-action="walk"]').click();
    await gmPage.waitForFunction(() => __mn.gmEditor.walkPreview.active);
    await gmPage.evaluate(async () => {
      // Observe restoration synchronously, before the title's next frame animates its own camera.
      const preview = __mn.gmEditor.walkPreview, stop = preview.stop;
      preview.stop = function (...args) {
        stop.apply(this, args); this.stop = stop;
        window.__gmLogoutStopCamera = { position: __mn.world.camera.position.toArray(),
          quaternion: __mn.world.camera.quaternion.toArray() };
      };
      const client = await __mn.gmEntry.auth.ensureClient();
      await client.auth.signOut({ scope: 'local' });
    });
    await gmPage.waitForFunction(() => __mn.st.mode === 'title' && !__mn.gmEditor.active && !__mn.gmEditor.walkPreview.active);
    const revokedWalk = await gmPage.evaluate(() => ({
      viewExists: __mn.world.views.has('gm-private-walker'), body: __mn.gmEditor.walkPreview.body,
      joined: __mn.client.joined, cameraPosition: window.__gmLogoutStopCamera?.position,
      cameraQuaternion: window.__gmLogoutStopCamera?.quaternion, document: __mn.gmEditor.history.current(),
      errors: [...__mn.errors], props: structuredClone(__mn.map.props), colliders: structuredClone(__mn.map.colliders),
    }));
    assert.equal(revokedWalk.viewExists, false);
    assert.equal(revokedWalk.body, 0);
    assert.equal(revokedWalk.joined, false);
    assert.deepEqual(revokedWalk.cameraPosition, walkCamera.position);
    assert.deepEqual(revokedWalk.cameraQuaternion, walkCamera.quaternion);
    assert.deepEqual(revokedWalk.document, walkDocument);
    assert.deepEqual(revokedWalk.errors, []);
    assert.deepEqual(revokedWalk.props, walkMap.props);
    assert.deepEqual(revokedWalk.colliders, walkMap.colliders);
    evidence.checks.push('real_owner_gm02_signout_during_walk_removes_private_preview_without_join_or_map_mutation');
    evidence.checks.push('real_owner_signout_closes_editor');
    await gmContext.close();
  }
  assert.deepEqual(evidence.errors, []);
  await context.close();
} catch (error) { evidence.errors.push(String(error.stack || error).replace(/gm_setup_token=[^\s"']+/g, 'gm_setup_token=[redacted]')); process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(resolve(out, 'public-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}

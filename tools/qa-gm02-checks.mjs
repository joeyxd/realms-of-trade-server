import assert from 'node:assert/strict';
import fs from 'node:fs';

/** Additional real-browser acceptance for GM02 base decorations and walk preview. */
export async function runGm02Checks({ page, check, shot, game }) {
  const read = (fn, arg) => page.evaluate(fn, arg);
  const waitFor = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout });
  const selectSceneItem = async (id) => {
    await page.locator('[data-action="tab-scene"]').click();
    await page.locator('[data-role="scene-search"]').fill(id);
    await page.locator(`[data-scene-id="${id}"]`).click();
    await waitFor((id) => __mn.gmEditor.selectedId === id, id);
  };

  const initial = await read(() => ({
    document: __mn.gmEditor.history.current(),
    selectedId: __mn.gmEditor.selectedId,
    cameraPosition: __mn.world.camera.position.toArray(),
    cameraQuaternion: __mn.world.camera.quaternion.toArray(),
    props: structuredClone(__mn.map.props),
    colliders: structuredClone(__mn.map.colliders),
  }));
  assert.equal(initial.document.objects.length, 1, 'GM02 helper expects the runner one-object fixture');
  assert.deepEqual(initial.document.baseOverrides, []);
  const originalObject = initial.document.objects[0];
  assert.equal(initial.selectedId, originalObject.id, 'GM02 helper expects the original decoration selected');
  const target = await read(() => {
    const editor = __mn.gmEditor;
    const village = editor.map.landmarks?.village || editor.map.landmarks?.spawn || { x: 0, z: 0 };
    const entry = editor.baseLayer.list().filter((item) => item.editable && item.kind === 'rock')
      .sort((a, b) => ((a.transform.position.x - village.x) ** 2 + (a.transform.position.z - village.z) ** 2) -
        ((b.transform.position.x - village.x) ** 2 + (b.transform.position.z - village.z) ** 2))[0];
    if (!entry) return null;
    const record = editor.records.get(entry.id), matrix = new record.entry.mesh.matrix.constructor();
    record.entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
    return { id: entry.id, kind: entry.kind, index: entry.index, transform: entry.transform,
      meshName: entry.mesh.name, instanceIndex: entry.instanceIndex, matrix: matrix.toArray(),
      village: { x: village.x, z: village.z } };
  });
  assert.ok(target, 'at least one editable base rock should be registered');
  assert.match(target.id, /^base:rock:\d+:[a-f0-9]+$/);

  try {
    await selectSceneItem(target.id);
    const baselineMatrix = target.matrix;
    const delta = target.transform.position.x <= 278 ? 2 : -2;
    await page.locator('[data-field="x"]').fill(String(target.transform.position.x + delta));
    await page.locator('[data-field="x"]').press('Tab');
    await page.locator('[data-action="ground"]').click();
    await page.locator('[data-field="ry"]').fill(String(target.transform.rotation.y * 180 / Math.PI + 30));
    await page.locator('[data-field="ry"]').press('Tab');
    await page.locator('[data-field="scale"]').fill(String(target.transform.scale * 1.2));
    await page.locator('[data-field="scale"]').press('Tab');
    await waitFor((id) => __mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), target.id);
    await check('gm02_scene_list_numeric_edit_creates_base_override_without_mutating_map', async () => {
      const state = await read((id) => {
        const editor = __mn.gmEditor, document = editor.history.current();
        const override = document.baseOverrides.find((item) => item.id === id);
        const entry = editor.baseLayer.get(id);
        const matrix = new entry.mesh.matrix.constructor(); entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
        return { document, override, matrix: matrix.toArray(), props: structuredClone(editor.map.props),
          colliders: structuredClone(editor.map.colliders) };
      }, target.id);
      assert.equal(state.document.objects.length, 1);
      assert.deepEqual(state.document.objects, initial.document.objects);
      assert.equal(state.override.transform.position.x, target.transform.position.x + delta);
      assert.equal(state.override.transform.scale, target.transform.scale * 1.2);
      assert.notDeepEqual(state.matrix, baselineMatrix);
      assert.deepEqual(state.props, initial.props);
      assert.deepEqual(state.colliders, initial.colliders);
    });
    await shot(page, 'gm02-base-edit-es.png');

    await page.locator('[data-action="delete"]').click();
    await waitFor((id) => __mn.gmEditor.history.current().baseOverrides.find((item) => item.id === id)?.hidden === true, target.id);
    await check('gm02_hide_detaches_gizmo_and_undo_restores_base_instance', async () => {
      const hidden = await read((id) => ({
        override: __mn.gmEditor.history.current().baseOverrides.find((item) => item.id === id),
        attached: !!__mn.gmEditor.transform.object,
        matrix: (() => { const entry = __mn.gmEditor.baseLayer.get(id); const m = new entry.mesh.matrix.constructor();
          entry.mesh.getMatrixAt(entry.instanceIndex, m); return m.toArray(); })(),
      }), target.id);
      assert.equal(hidden.override.hidden, true);
      assert.equal(hidden.attached, false);
      assert.equal(hidden.matrix[15], 1);
      assert.ok([0, 1, 2, 4, 5, 6, 8, 9, 10].every((index) => hidden.matrix[index] === 0));
      await page.locator('[data-action="undo"]').click();
      await waitFor((id) => __mn.gmEditor.history.current().baseOverrides.find((item) => item.id === id)?.hidden === false, target.id);
      assert.equal(await read((id) => __mn.gmEditor.transform.object?.name === id, target.id), true);
    });
    await page.locator('[data-action="restore-base"]').click();
    await waitFor((id) => !__mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), target.id);
    await check('gm02_restore_base_removes_override_and_restores_exact_instance_matrix', async () => {
      const state = await read((id) => {
        const entry = __mn.gmEditor.baseLayer.get(id), matrix = new entry.mesh.matrix.constructor();
        entry.mesh.getMatrixAt(entry.instanceIndex, matrix);
        return { overrides: __mn.gmEditor.history.current().baseOverrides, matrix: matrix.toArray() };
      }, target.id);
      assert.deepEqual(state.overrides, []);
      assert.deepEqual(state.matrix, baselineMatrix);
    });

    // Exercise world picking as well as the searchable scene list.
    await read(() => __mn.gmEditor.select(null));
    assert.equal(await read(() => __mn.gmEditor.selectedId), null);
    const point = await read((id) => {
      const editor = __mn.gmEditor, entry = editor.baseLayer.get(id), mesh = entry.mesh;
      mesh.geometry.computeBoundingSphere(); mesh.updateWorldMatrix(true, false);
      const local = new mesh.matrix.constructor(); mesh.getMatrixAt(entry.instanceIndex, local);
      const world = mesh.matrixWorld.clone().multiply(local);
      const center = mesh.geometry.boundingSphere.center.clone().applyMatrix4(world);
      __mn.world.camera.position.set(center.x + 12, center.y + 7, center.z + 10);
      editor.cameraController.focus(center); __mn.world.camera.updateMatrixWorld(true);
      const projected = center.clone().project(__mn.world.camera);
      const rect = editor.canvas.getBoundingClientRect();
      return { x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2, z: projected.z,
        canvas: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
    }, target.id);
    assert.ok(point.z >= -1 && point.z <= 1);
    assert.ok(point.x > point.canvas.left && point.x < point.canvas.right && point.y > point.canvas.top && point.y < point.canvas.bottom);
    await page.mouse.click(point.x, point.y);
    await waitFor((id) => __mn.gmEditor.selectedId === id, target.id);
    await check('gm02_projected_scene_click_selects_registered_base_rock', async () => {
      assert.equal(await read(() => __mn.gmEditor.selectedId), target.id);
    });

    const visualBaseline = await read((id) => {
      const editor = __mn.gmEditor, entry = editor.baseLayer.get(id), mesh = entry.mesh;
      mesh.geometry.computeBoundingSphere(); mesh.updateWorldMatrix(true, false);
      const local = new mesh.matrix.constructor(); mesh.getMatrixAt(entry.instanceIndex, local);
      return mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld.clone().multiply(local)).toArray();
    }, target.id);
    await page.locator('[data-action="duplicate"]').click();
    await waitFor(() => __mn.gmEditor.history.current().objects.length === 2);
    await check('gm02_duplicate_base_uses_logical_world_pose_once', async () => {
      const copy = await read((id) => {
        const editor = __mn.gmEditor, doc = editor.history.current();
        const item = doc.objects.find((object) => object.assetId === id);
        const record = editor.records.get(item.id); record.root.updateMatrixWorld(true);
        let mesh; record.root.traverse((node) => { if (!mesh && node.isMesh) mesh = node; });
        mesh.geometry.computeBoundingSphere();
        return { item, center: mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld).toArray() };
      }, target.id);
      assert.equal(copy.item.assetId, target.id);
      const expectedX = Math.max(-280, Math.min(280, target.transform.position.x + 2));
      const expectedZ = Math.max(-280, Math.min(280, target.transform.position.z + 2));
      assert.equal(copy.item.transform.position.x, expectedX);
      assert.equal(copy.item.transform.position.z, expectedZ);
      assert.ok(Math.abs(copy.center[0] - (visualBaseline[0] + expectedX - target.transform.position.x)) < 0.05);
      assert.ok(Math.abs(copy.center[2] - (visualBaseline[2] + expectedZ - target.transform.position.z)) < 0.05);
    });
    await page.locator('[data-action="undo"]').click();
    await waitFor(() => __mn.gmEditor.history.current().objects.length === 1);

    // Persist a real override through the UI and the editor lifecycle, then restore and save baseline.
    await selectSceneItem(target.id);
    const savedX = target.transform.position.x + delta;
    await page.locator('[data-field="x"]').fill(String(savedX)); await page.locator('[data-field="x"]').press('Tab');
    await page.locator('[data-action="save"]').click();
    await waitFor(() => !__mn.gmEditor.dirty && __mn.gmEditor.revision > 0);
    await page.locator('[data-action="close"]').click();
    await waitFor(() => __mn.st.mode === 'title');
    await page.locator('#btn-gm-editor').click();
    await waitFor(() => __mn.st.mode === 'editor' && __mn.gmEditor.active);
    await waitFor((id) => __mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), target.id);
    await check('gm02_saved_base_override_survives_close_and_reopen', async () => {
      const state = await read(async (id) => ({
        document: __mn.gmEditor.history.current(),
        stored: await __mn.gmEditor.store.load(),
      }), target.id);
      assert.equal(state.document.baseOverrides[0].id, target.id);
      assert.equal(state.stored.document.baseOverrides[0].transform.position.x, savedX);
      assert.deepEqual(state.document.objects, initial.document.objects);
    });
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloadEvent;
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    await selectSceneItem(target.id);
    await page.locator('[data-action="restore-base"]').click();
    await waitFor((id) => !__mn.gmEditor.history.current().baseOverrides.some((item) => item.id === id), target.id);
    await page.locator('[data-action="save"]').click();
    await waitFor(() => !__mn.gmEditor.dirty);
    await check('gm02_export_import_preserves_overrides_and_stale_target_import_is_rejected', async () => {
      await page.locator('[data-role="import"]').setInputFiles({ name: 'base-override.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
      await waitFor(() => __mn.gmEditor.history.current().baseOverrides.length === 1 && !__mn.gmEditor.importTask);
      assert.deepEqual(await read(() => __mn.gmEditor.history.current()), exported.document);
      const before = await read(() => __mn.gmEditor.store.load());
      const stale = structuredClone(exported); stale.document.baseOverrides[0].id += 'dead';
      await page.locator('[data-role="import"]').setInputFiles({ name: 'stale-target.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stale)) });
      await waitFor(() => !__mn.gmEditor.importTask && __mn.gmEditor.statusNode.dataset.kind === 'error');
      assert.deepEqual(await read(() => __mn.gmEditor.store.load()), before);
      await selectSceneItem(target.id); await page.locator('[data-action="restore-base"]').click();
      await page.locator('[data-action="save"]').click(); await waitFor(() => !__mn.gmEditor.dirty);
    });

    await selectSceneItem(originalObject.id);
    await page.locator('[data-setting="collider"]').selectOption('circle');
    await check('gm02_original_circle_proxy_has_scaled_visible_footprint', async () => {
      const state = await read((id) => ({
        item: __mn.gmEditor.history.current().objects.find((object) => object.id === id),
        visible: __mn.gmEditor.footprint.visible,
        scale: __mn.gmEditor.footprint.scale.x,
        expected: __mn.gmEditor.history.current().objects.find((object) => object.id === id).collider.radius *
          __mn.gmEditor.history.current().objects.find((object) => object.id === id).transform.scale,
      }), originalObject.id);
      assert.equal(state.item.collider.type, 'circle');
      assert.equal(state.visible, true);
      assert.ok(Math.abs(state.scale - state.expected) < 1e-5);
    });
    await page.locator('[data-role="language"]').click();
    await waitFor(() => __mn.gmEditor.lang === 'en');
    const editorCameraBeforeWalk = await read(() => ({ position: __mn.world.camera.position.toArray(),
      quaternion: __mn.world.camera.quaternion.toArray() }));
    await page.locator('[data-action="walk"]').click();
    await waitFor(() => __mn.gmEditor.walkPreview.active);
    const walkStart = await read((id) => {
      const editor = __mn.gmEditor, walk = editor.walkPreview;
      const item = editor.history.current().objects.find((object) => object.id === id);
      const position = walk.position;
      const collider = walk.world.map.colliders.find((c) => Math.abs(c.x - item.transform.position.x) < 1e-5 &&
        Math.abs(c.z - item.transform.position.z) < 1e-5 && Math.abs(c.r - item.collider.radius * item.transform.scale) < 1e-5);
      if (collider) {
        const dx = collider.x - position.x, dz = collider.z - position.z, length = Math.hypot(dx, dz) || 1;
        walk.heading.set(dx / length, 0, dz / length); walk.right.set(-walk.heading.z, 0, walk.heading.x);
        walk.cameraOffset.copy(walk.heading).multiplyScalar(-8).add(new walk.heading.constructor(0, 5, 0));
        walk._syncCamera();
      }
      return { position, collider, body: walk.body, view: !!walk.view,
        clientJoined: __mn.client.joined, document: editor.history.current() };
    }, originalObject.id);
    assert.ok(walkStart.collider, 'walk preview should contain the selected draft circle');
    assert.ok(walkStart.body > 0 && walkStart.view);
    assert.equal(walkStart.clientJoined, false);
    assert.equal(game.game.status().players, 0);
    await shot(page, 'gm02-walk-preview-en.png');
    await page.locator('#game').focus(); await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyW');
    const walkEnd = await read((id) => {
      const editor = __mn.gmEditor, walk = editor.walkPreview;
      const item = editor.history.current().objects.find((object) => object.id === id), position = walk.position;
      return { position, keys: [...walk.keys], joined: __mn.client.joined,
        document: editor.history.current(), distance: Math.hypot(position.x - item.transform.position.x,
          position.z - item.transform.position.z), radius: item.collider.radius * item.transform.scale };
    }, originalObject.id);
    await check('gm02_walk_preview_uses_private_circle_collision_and_blur_releases_keys', async () => {
      assert.deepEqual(walkEnd.keys, []);
      assert.deepEqual(walkEnd.document, walkStart.document);
      assert.equal(walkEnd.joined, false);
      assert.equal(game.game.status().players, 0);
      assert.ok(walkEnd.distance >= walkEnd.radius + 0.25, `body crossed circle proxy: ${walkEnd.distance} < ${walkEnd.radius}`);
      assert.ok(Math.hypot(walkEnd.position.x - walkStart.position.x, walkEnd.position.z - walkStart.position.z) > .05, 'preview must respond to real movement keys');
    });
    await page.keyboard.press('Escape');
    await waitFor(() => !__mn.gmEditor.walkPreview.active);
    await check('gm02_escape_returns_to_editor_and_restores_camera_without_document_edits', async () => {
      const state = await read((expected) => ({
        cameraPosition: __mn.world.camera.position.toArray(), cameraQuaternion: __mn.world.camera.quaternion.toArray(),
        selectedId: __mn.gmEditor.selectedId, joined: __mn.client.joined,
        document: __mn.gmEditor.history.current(), walkBody: __mn.gmEditor.walkPreview.body,
      }), null);
      // The walk preview restores its exact pre-walk editor camera, which may differ from the original fixture view.
      assert.deepEqual(state.cameraPosition, editorCameraBeforeWalk.position);
      assert.deepEqual(state.cameraQuaternion, editorCameraBeforeWalk.quaternion);
      assert.equal(state.walkBody, 0);
      assert.equal(state.joined, false);
      assert.deepEqual(state.document, walkStart.document);
    });
    await check('gm02_repeated_walk_cycles_release_preview_view_and_gpu_textures', async () => {
      const textures = await read(() => __mn.world.renderer.info.memory.textures);
      for (let i = 0; i < 3; i++) {
        await page.locator('[data-action="walk"]').click();
        await waitFor(() => __mn.gmEditor.walkPreview.active);
        const frame = await read(() => __mn.world.pipeline.frame);
        await waitFor((frame) => __mn.world.pipeline.frame >= frame + 4, frame);
        assert.equal(await read(() => document.getElementById('world-ui').hidden), true);
        await page.locator('[data-action="walk"]').click();
        await waitFor(() => !__mn.gmEditor.walkPreview.active);
        assert.equal(await read(() => __mn.world.views.has('gm-private-walker')), false);
      }
      assert.ok(await read(() => __mn.world.renderer.info.memory.textures) <= textures, 'preview bone textures must be released');
      assert.deepEqual(await read(() => [...__mn.errors]), []);
    });
    if (await read(() => __mn.gmEditor.lang === 'en')) await page.locator('[data-role="language"]').click();
    await selectSceneItem(originalObject.id);
    await page.locator('[data-setting="collider"]').selectOption('none');
    await read((saved) => {
      __mn.world.camera.position.fromArray(saved.position);
      __mn.world.camera.quaternion.fromArray(saved.quaternion);
      __mn.world.camera.updateMatrixWorld(true);
      __mn.gmEditor.cameraController._syncAngles();
      __mn.gmEditor._setSceneTab(false);
      __mn.gmEditor.select(saved.selectedId);
    }, { position: initial.cameraPosition, quaternion: initial.cameraQuaternion, selectedId: originalObject.id });
    await check('gm02_helper_leaves_original_one_object_draft_selected_for_existing_acceptance', async () => {
      const state = await read(() => ({ document: __mn.gmEditor.history.current(), selectedId: __mn.gmEditor.selectedId,
        props: __mn.map.props, colliders: __mn.map.colliders }));
      assert.deepEqual(state.document, initial.document);
      assert.equal(state.selectedId, originalObject.id);
      assert.deepEqual(state.props, initial.props);
      assert.deepEqual(state.colliders, initial.colliders);
    });
  } catch (error) {
    // Keep the helper's handoff contract even if an assertion fails midway.
    throw error;
  }
}

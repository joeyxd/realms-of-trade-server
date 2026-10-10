import * as THREE from 'three';
import { createEditorTransformControls } from './transformControls.js';
import { addDecoration, createDecoration, createDocument, createDocumentHistory, removeDecoration, updateDecoration, validateDocument, setBaseOverride, removeBaseOverride } from './document.js';
import { DraftStore, DRAFT_EXPORT_FORMAT, DRAFT_EXPORT_VERSION, MAX_DRAFT_EXPORT_BYTES } from './draftStore.js';
import { EditorCatalog } from './catalog.js';
import { EditorFreeCamera } from './freeCamera.js';
import { createEditorModels } from './modelFactory.js';
import { createBaseDecorationLayer } from './baseDecoration.js';
import { EditorWalkPreview } from './walkPreview.js';
import { LAYER } from '../render/pipeline.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const number = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const clone = (v) => structuredClone(v);
const uid = () => 'gm-' + (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
const typing = (target) => !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
const html = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/** Private decoration overlay. Generated map data and server gameplay remain untouched. */
export class WorldEditor {
  constructor({ scene, camera, canvas, map, assets, parent, onClose = () => {}, draftWorldId = null,
    baseRevision = 'terrain-s21-v1', invalidate = () => {}, onChanged = () => {}, createWalkView = null } = {}) {
    if (!scene || !camera || !canvas || !map || !assets || !parent) {
      throw new TypeError('WorldEditor requires scene, camera, canvas, map, assets, and parent');
    }
    this.scene = scene; this.camera = camera; this.canvas = canvas; this.map = map;
    this.editorModels = createEditorModels(assets);
    this.assets = {
      man: assets.man,
      data: assets.data.bind(assets), entry: assets.entry.bind(assets), list: assets.list.bind(assets),
      ensureModel: assets.ensureModel.bind(assets), model: this.editorModels.model,
    };
    this.parent = parent; this.onClose = onClose;
    this.invalidate = invalidate; this.onChanged = onChanged;
    this.worldId = draftWorldId || ('gm-' + (map.seed >>> 0).toString(16));
    this.baseRevision = baseRevision; this.lang = 'es'; this.active = false; this.session = 0;
    this.document = null; this.history = null; this.revision = 0; this.dirty = false;
    this.saveTimer = 0; this.saveTask = null; this.saveAgain = false; this.resumeDocument = null;
    this.recoveryRevision = null;
    this.lastSavedJson = ''; this.records = new Map(); this.selectedId = null;
    this.pendingEntry = null; this.ghost = null; this.dragging = false; this.dragStart = null;
    this.pointerNdc = new THREE.Vector2(); this.pointerInside = false; this.error = null;
    this.snapEnabled = true; this.snapStep = 0.5;
    this.baseLayer = createBaseDecorationLayer({ scene, map, baseRevision });
    this.baseEntries = this.baseLayer.list().filter((entry) => entry.editable);
    this.sceneTab = false;

    this._installStyles(); this._buildUI();
    this.cameraController = new EditorFreeCamera(camera, canvas, { ownsTarget: (target) => this.ui.contains(target) });
    this.walkPreview = createWalkView ? new EditorWalkPreview({ camera, canvas, map, createView: createWalkView,
      ownsTarget: (target) => this.ui.contains(target) }) : null;
    this.footprint = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) =>
      new THREE.Vector3(Math.cos(i * Math.PI / 32), 0, Math.sin(i * Math.PI / 32)))),
    new THREE.LineBasicMaterial({ color: 0xffd477, depthTest: false, transparent: true, opacity: .9 }));
    this.footprint.name = 'gm-collision-footprint'; this.footprint.layers.set(LAYER.NO_OUTLINE);
    this.footprint.renderOrder = 20; this.footprint.visible = false;
    this.transform = createEditorTransformControls(camera, canvas); this.transform.setSize(0.85);
    this._configureSnap();
    this.transform.addEventListener('dragging-changed', (e) => { this.dragging = e.value; });
    this.transform.addEventListener('mouseDown', () => { this.dragStart = this._selectedTransform(); });
    this.transform.addEventListener('objectChange', () => this._onObjectChange());
    this.transform.addEventListener('mouseUp', () => this._finishTransform());
    this.transformHelper = this.transform; this.transformHelper.name = 'gm-transform-controls';
    this.controlsAdded = false;

    this.onPointerMove = (e) => this._pointerMove(e);
    this.onPointerDown = (e) => this._pointerDown(e);
    this.onKeyDown = (e) => this._keyDown(e);
    this.onLang = () => { this.lang = this.lang === 'es' ? 'en' : 'es'; this._setLanguage(); };
    this.onClick = (e) => this._toolbarAction(e);
    this.onChange = (e) => this._inspectorChange(e);
    this.onSceneSearch = () => this._renderSceneList();
    this.onBlur = () => { this.cameraController.onBlur(); if (this.active && !this.walkPreview?.active) this._cancelTransform(); };
    this.onPointerLeave = () => { this.pointerInside = false; if (this.ghost) this.ghost.visible = false; this.invalidate(); };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.ui.addEventListener('click', this.onClick);
    this.ui.addEventListener('change', this.onChange);
    this.sceneSearch.addEventListener('input', this.onSceneSearch);
    this.langButton.addEventListener('click', this.onLang);
    this.onImport = () => this._importFile(this.importInput.files?.[0]);
    this.importInput.addEventListener('change', this.onImport);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('blur', this.onBlur);
    this.catalog = new EditorCatalog({
      root: this.catalogRoot, assets: this.assets, onSelect: ({ entry, object }) => this._selectAsset(entry, object),
      t: (en, es) => this._t(en, es),
    });
    this._setLanguage();
  }

  _installStyles() {
    if (document.getElementById('gm-editor-style')) return;
    const link = document.createElement('link');
    link.id = 'gm-editor-style'; link.rel = 'stylesheet'; link.href = new URL('./editor.css', import.meta.url).href;
    document.head.appendChild(link);
  }

  _buildUI() {
    this.ui = document.createElement('section'); this.ui.className = 'gm-editor'; this.ui.hidden = true;
    this.ui.setAttribute('aria-label', 'World editor');
    this.ui.innerHTML = [
      '<header class="gm-topbar"><div class="gm-brand"><b data-i18n="brand"></b><small data-i18n="draftLocal"></small></div>',
      '<div class="gm-actions">',
      '<button type="button" data-action="place" data-i18n="place"></button>',
      '<button type="button" data-action="undo" data-i18n="undo"></button><button type="button" data-action="redo" data-i18n="redo"></button>',
      '<button type="button" data-action="duplicate" data-i18n="duplicate"></button><button type="button" data-action="delete" data-i18n="delete"></button>',
      '<button type="button" data-action="walk" data-i18n="walk"></button>',
      '<button type="button" data-action="save" data-i18n="save"></button><button type="button" data-action="export" data-i18n="export"></button>',
      '<label class="gm-import-button"><span data-i18n="import"></span><input type="file" accept="application/json,.json" data-role="import"></label>',
      '<button type="button" data-role="language" aria-label="Language"></button><button type="button" data-action="close" class="gm-close" data-i18n="close"></button>',
      '</div></header><div class="gm-workspace"><aside class="gm-sidebar">',
      '<nav class="gm-tabs"><button type="button" data-action="tab-library" data-i18n="library"></button>',
      '<button type="button" data-action="tab-scene" data-i18n="scene"></button></nav>',
      '<div class="gm-library" data-role="catalog"></div><section class="gm-scene-panel" data-role="scene-panel" hidden>',
      '<label class="gm-search"><span data-i18n="sceneSearch"></span><input type="search" data-role="scene-search"></label>',
      '<p class="gm-scene-note" data-i18n="sceneScope"></p><div class="gm-scene-count" data-role="scene-count"></div>',
      '<div class="gm-scene-list" data-role="scene-list"></div></section></aside>',
      '<div class="gm-canvas-note" data-i18n="controls"></div><aside class="gm-inspector"><h2 data-i18n="inspector"></h2>',
      '<div class="gm-selection-name" data-role="selection-name"></div><div class="gm-transform-tools">',
      '<button type="button" data-action="mode-translate" data-i18n="move"></button><button type="button" data-action="mode-rotate" data-i18n="rotate"></button>',
      '<button type="button" data-action="mode-scale" data-i18n="scale"></button></div>',
      '<div class="gm-snap"><label><input type="checkbox" data-setting="snap" checked> <span data-i18n="snap"></span></label>',
      '<input type="number" data-setting="snapStep" value="0.5" min="0.05" max="10" step="0.25" aria-label="Grid step / Paso de rejilla">',
      '<select data-setting="space"><option value="world" data-i18n="world"></option><option value="local" data-i18n="local"></option></select></div>',
      '<div class="gm-fields">',
      '<label><span>X</span><input data-field="x" type="number" step="0.25"></label><label><span>Y</span><input data-field="y" type="number" step="0.25"></label>',
      '<label><span>Z</span><input data-field="z" type="number" step="0.25"></label><label><span>Rot X°</span><input data-field="rx" type="number" step="5"></label>',
      '<label><span>Rot Y°</span><input data-field="ry" type="number" step="5"></label><label><span>Rot Z°</span><input data-field="rz" type="number" step="5"></label>',
      '<label><span data-i18n="uniformScale"></span><input data-field="scale" type="number" min="0.001" max="1000" step="0.1"></label></div>',
      '<button type="button" data-action="ground" data-i18n="ground"></button>',
      '<button type="button" data-action="restore-base" data-i18n="restoreBase"></button>',
      '<div class="gm-collider-fields"><label><span data-i18n="collision"></span><select data-setting="collider">',
      '<option value="none" data-i18n="noCollision"></option><option value="circle" data-i18n="circleCollision"></option></select></label>',
      '<label><span data-i18n="radius"></span><input data-setting="radius" type="number" min="0.05" max="50" step="0.1"></label></div>',
      '<p class="gm-collider-note" data-i18n="colliderNote"></p><div class="gm-status" data-role="status" aria-live="polite"></div></aside></div>',
    ].join('');
    this.parent.appendChild(this.ui);
    this.catalogRoot = this.ui.querySelector('[data-role="catalog"]');
    this.langButton = this.ui.querySelector('[data-role="language"]');
    this.selectionName = this.ui.querySelector('[data-role="selection-name"]');
    this.statusNode = this.ui.querySelector('[data-role="status"]');
    this.fields = Object.fromEntries([...this.ui.querySelectorAll('[data-field]')].map((el) => [el.dataset.field, el]));
    this.importInput = this.ui.querySelector('[data-role="import"]');
    this.scenePanel = this.ui.querySelector('[data-role="scene-panel"]');
    this.sceneSearch = this.ui.querySelector('[data-role="scene-search"]');
    this.sceneList = this.ui.querySelector('[data-role="scene-list"]');
    this.sceneCount = this.ui.querySelector('[data-role="scene-count"]');
    this.colliderSelect = this.ui.querySelector('[data-setting="collider"]');
    this.colliderRadius = this.ui.querySelector('[data-setting="radius"]');
  }

  _t(en, es) { return this.lang === 'en' ? en : es; }

  _setLanguage() {
    const words = {
      brand: ['World editor', 'Editor del mundo'], draftLocal: ['LOCAL DRAFT · NO PUBLISH', 'BORRADOR LOCAL · SIN PUBLICAR'],
      place: ['Place', 'Colocar'], undo: ['Undo', 'Deshacer'], redo: ['Redo', 'Rehacer'], duplicate: ['Duplicate', 'Duplicar'],
      delete: ['Delete', 'Eliminar'], save: ['Save draft', 'Guardar borrador'], export: ['Export', 'Exportar'],
      import: ['Import', 'Importar'], close: ['Close', 'Cerrar'],
      library: ['Library', 'Biblioteca'], scene: ['Scene', 'Escena'], sceneSearch: ['Find placed decoration', 'Buscar decoración colocada'],
      sceneScope: ['Natural rocks, flowers, pebbles and draft models. Functional objects stay protected.',
        'Rocas naturales, flores, guijarros y modelos del borrador. Los objetos funcionales están protegidos.'],
      walk: [this.walkPreview?.active ? 'Back to editor' : 'Walk test', this.walkPreview?.active ? 'Volver al editor' : 'Probar caminando'],
      restoreBase: ['Restore original', 'Restaurar original'], collision: ['Walk test collision', 'Colisión de prueba'],
      noCollision: ['None', 'Ninguna'], circleCollision: ['Circle in XZ', 'Círculo en XZ'], radius: ['Radius before scale (m)', 'Radio antes de escala (m)'],
      controls: ['RMB + mouse: look · WASD: fly · Q/E: height · Shift: fast · wheel: speed · F: focus',
        'Botón derecho + ratón: mirar · WASD: volar · Q/E: altura · Shift: rápido · rueda: velocidad · F: enfocar'],
      inspector: ['Inspector', 'Inspector'], move: ['Move', 'Mover'], rotate: ['Rotate', 'Girar'], scale: ['Scale', 'Escala'],
      uniformScale: ['Uniform scale', 'Escala uniforme'],
      snap: ['Snap', 'Rejilla'], world: ['World axes', 'Ejes del mundo'], local: ['Local axes', 'Ejes locales'],
      ground: ['Place on terrain', 'Apoyar en terreno'],
      colliderNote: ['Circles block only the private walk test, at every height. Models are not walkable surfaces. Nothing is published.',
        'Los círculos bloquean solo la prueba privada, a cualquier altura. Los modelos no crean superficies transitables. Nada se publica.'],
    };
    for (const el of this.ui.querySelectorAll('[data-i18n]')) {
      const value = words[el.dataset.i18n]; if (value) el.textContent = value[this.lang === 'en' ? 0 : 1];
    }
    this.langButton.textContent = this.lang === 'es' ? 'EN' : 'ES';
    this.catalog?.setLanguage(this.lang); this._renderInspector(); this._renderSceneList();
    if (this.walkPreview?.active) this.ui.querySelector('[data-i18n="controls"]').textContent = this._t(
      'PRIVATE WALK TEST · WASD: move · Escape: back to editor · no combat or progress',
      'PRUEBA PRIVADA · WASD: caminar · Escape: volver al editor · sin combate ni progreso');
  }

  async open() {
    if (this.active) return true;
    this.error = null; this.rejectedDocument = null;
    const session = ++this.session;
    this.active = true; this.ui.hidden = false; this.catalog.generation = session;
    try {
      this.store ||= new DraftStore({ worldId: this.worldId });
      let recovery = this.resumeDocument;
      const normal = await this.store.load();
      if (!recovery) {
        const storedRecovery = await this.store.loadRecovery();
        if (storedRecovery) {
          this.recoveryRevision = storedRecovery.revision;
          if (JSON.stringify(storedRecovery.document) === JSON.stringify(normal.document)) await this._clearRecovery();
          else { recovery = storedRecovery.document; this.revision = storedRecovery.expectedRevision; }
        }
      }
      const loaded = recovery ? { revision: this.revision, document: recovery } : normal;
      if (session !== this.session) return false;
      if (loaded.document && (loaded.document.base.seed !== (this.map.seed >>> 0) || loaded.document.base.revision !== this.baseRevision)) {
        this.rejectedDocument = loaded.document;
        throw new Error(this._t('Saved draft is for a different base map. Export it before starting another draft.',
          'El borrador pertenece a otra base. Expórtalo antes de iniciar otro.'));
      }
      this.revision = loaded.revision;
      const draft = loaded.document || createDocument({ seed: this.map.seed >>> 0, baseRevision: this.baseRevision });
      try { this._validateBaseReferences(draft); }
      catch (error) { this.rejectedDocument = draft; throw error; }
      this.history = createDocumentHistory(draft); this.document = clone(draft);
      this.lastSavedJson = JSON.stringify(normal.document || createDocument({ seed: this.map.seed >>> 0, baseRevision: this.baseRevision }));
      this.dirty = !!recovery && JSON.stringify(recovery) !== this.lastSavedJson;
      this._addControls(); this.cameraController.enable();
      this._setStatus(this._t('Local draft. Nothing is published or written to gameplay.',
        'Borrador local. Nada se publica ni se escribe en gameplay.'), 'info');
      if (recovery) this._setStatus(this._t('Recovered unsaved draft. Save or export it; conflicting revisions stay protected.',
        'Borrador sin guardar recuperado. Guarda o exporta; las revisiones en conflicto siguen protegidas.'), 'error');
      this.catalog.refresh();
      await this.catalog.ready;
      if (!this.active || session !== this.session) return false;
      await this._hydrate(draft);
      if (!this.active || session !== this.session) return false;
      this._renderDocument(this.history.current()); this._updateButtons();
      this.onChanged({ document: clone(this.document), dirty: this.dirty });
      this.invalidate(); return true;
    } catch (error) {
      if (session !== this.session) return false;
      this.active = false; this.ui.hidden = true; this.error = error;
      this._stopWalking(); this.baseLayer.restore(); this.footprint.visible = false; this.scene.remove(this.footprint);
      this.cameraController.disable(); this._clearGhost(); this.transform.detach();
      if (this.controlsAdded) { this.scene.remove(this.transformHelper); this.controlsAdded = false; }
      this._clearRecords();
      this._setStatus(error?.message || this._t('Could not open draft.', 'No se pudo abrir el borrador.'), 'error');
      return false;
    }
  }

  _addControls() {
    if (!this.controlsAdded) { this.scene.add(this.transformHelper); this.controlsAdded = true; }
    this.scene.add(this.footprint);
  }

  async close({ force = false } = {}) {
    if (!this.active) return true;
    this._stopWalking();
    if (this.importTask) await this.importTask;
    if (!this.active) return true;
    if (this.dirty) {
      const saved = await this.saveNow();
      if (!saved && !force) {
        this._setStatus(this._t('Draft remains open because local save failed. Export it or retry.',
          'El borrador sigue abierto porque falló el guardado. Expórtalo o vuelve a intentar.'), 'error');
        return false;
      }
      if (!saved) {
        this.resumeDocument = this.history.current();
        try {
          const record = await this.store.saveRecovery(this.resumeDocument, { expectedRevision: this.revision });
          this.recoveryRevision = record.revision;
        } catch { /* Keep the in-memory copy if local storage is unavailable. */ }
      }
      else this.resumeDocument = null;
    }
    this.active = false; this.session++; this.catalog.generation = this.session;
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    this.cameraController.disable(); this._clearGhost(); this.transform.detach();
    this.baseLayer.restore(); this.scene.remove(this.footprint); this.footprint.visible = false;
    this._clearRecords();
    if (this.controlsAdded) { this.scene.remove(this.transformHelper); this.controlsAdded = false; }
    this.ui.hidden = true; this.invalidate();
    this.onClose({ saved: !this.dirty, recoveryDocument: this.resumeDocument || (this.dirty ? this.history?.current() : null) });
    return true;
  }

  async _hydrate(document) {
    for (const item of document.objects) {
      if (this.baseLayer.get(item.assetId)) continue;
      const entry = this.catalog.items.find((candidate) => candidate.id === item.assetId) || this.assets.entry?.(item.assetId);
      if (!entry) continue;
      try {
        const state = this.assets.list?.().find((record) => record.id === item.assetId)?.state;
        if (state !== 'ok' && this.assets.ensureModel) await this.assets.ensureModel(entry, { base: entry.base || 'assets/' });
        // _renderDocument creates scene instances once, after model loading completes.
      } catch { /* The document stays intact if an asset is temporarily unavailable. */ }
    }
  }

  _renderDocument(document) {
    this._validateBaseReferences(document);
    this.transform.detach();
    this._clearRecords(); this.document = clone(document);
    this.baseLayer.apply(document.baseOverrides);
    for (const entry of this.baseEntries) {
      const override = document.baseOverrides.find((item) => item.id === entry.id);
      const root = new THREE.Group(); root.name = entry.id; root.userData.gmDecorationId = entry.id;
      this._applyTransform(root, override?.transform || entry.transform); this.scene.add(root);
      this.records.set(entry.id, { id: entry.id, assetId: entry.id, entry, root, base: true, hidden: !!override?.hidden });
    }
    for (const item of document.objects) {
      const entry = this._entryForAsset(item.assetId);
      const model = this.baseLayer.get(item.assetId) ? this.baseLayer.model(item.assetId) : this.assets.model(item.assetId);
      if (entry && model) this._addRecord(item, model);
    }
    this.selectedId = this.records.has(this.selectedId) ? this.selectedId : null;
    if (this.selectedId && !this.records.get(this.selectedId).hidden) this.transform.attach(this.records.get(this.selectedId).root);
    this._renderInspector(); this._renderSceneList(); this._updateButtons(); this.invalidate();
  }

  _entryForAsset(id) { return this.baseLayer.get(id) || this.catalog.items.find((entry) => entry.id === id) || this.assets.entry?.(id); }

  _validateBaseReferences(document) {
    for (const id of [...document.baseOverrides.map((item) => item.id),
      ...document.objects.filter((item) => item.assetId.startsWith('base:')).map((item) => item.assetId)]) {
      if (!this.baseLayer.get(id)?.editable) throw new Error(this._t('Base decoration changed or is unavailable. Export this draft before rebasing.',
        'La decoración base cambió o no está disponible. Exporta el borrador antes de cambiar su base.'));
    }
  }

  _addRecord(item, model) {
    const root = new THREE.Group(); root.name = item.id; root.userData.gmDecorationId = item.id;
    root.add(model); this._applyTransform(root, item.transform); this.scene.add(root);
    this.records.set(item.id, { id: item.id, assetId: item.assetId,
      entry: this._entryForAsset(item.assetId), root });
  }

  _clearRecords() {
    for (const record of this.records.values()) {
      this.scene.remove(record.root);
      record.root.traverse((object) => { for (const material of object.userData.gmOwnedMaterials || []) material.dispose(); });
    }
    this.records.clear();
  }

  _applyTransform(root, t) {
    root.position.set(t.position.x, t.position.y, t.position.z);
    root.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z, 'YXZ');
    root.scale.setScalar(t.scale); root.updateMatrixWorld(true);
  }

  _selectAsset(entry, preparedModel) {
    if (!this.active || this.walkPreview?.active) return;
    this._clearGhost(); this.pendingEntry = entry; this.ghost = preparedModel; this.ghost.name = 'gm-placement-ghost';
    this.ghost.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const copies = materials.map((material) => {
        const copy = material.clone(); copy.transparent = true; copy.opacity = 0.48; copy.depthWrite = false;
        copy.userData.gmGhostOwned = true; return copy;
      });
      object.material = Array.isArray(object.material) ? copies : copies[0];
    });
    this.ghost.visible = false; this.scene.add(this.ghost);
    this._setStatus(this._t('Click the terrain to add this model to the local draft.', 'Pulsa el terreno para añadir el modelo al borrador local.'), 'info');
    if (this.pointerInside) this._updateGhost();
    this._updateButtons(); this.invalidate();
  }

  _clearGhost() {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    this.ghost.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material?.userData?.gmGhostOwned) material.dispose();
    });
    this.ghost = null; this.pendingEntry = null; this._updateButtons();
  }

  _pointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    this.pointerNdc.set(x * 2 - 1, -(y * 2 - 1)); this.pointerInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    if (this.ghost) this._updateGhost();
  }

  _terrainHits() {
    const terrain = this.scene.getObjectByName('terrain'); if (!terrain) return [];
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.pointerNdc, this.camera);
    return ray.intersectObject(terrain, false);
  }

  _updateGhost() {
    if (!this.ghost || !this.pointerInside) return;
    const hits = this._terrainHits();
    if (!hits.length) { this.ghost.visible = false; return; }
    const point = this._placementPoint(hits[0].point); this.ghost.position.copy(point);
    this.ghost.visible = true; this.invalidate();
  }

  _pointerDown(event) {
    if (!this.active || this.walkPreview?.active || this.importTask || event.button !== 0 || event.target !== this.canvas || this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    if (this.ghost && this.pendingEntry) {
      const hits = this._terrainHits(); if (hits.length) this._placeAt(hits[0].point); return;
    }
    const hit = this._pickPlaced();
    this.select(hit?.id || null);
  }

  _pickPlaced() {
    const ray = new THREE.Raycaster(); ray.layers.enable(LAYER.NO_OUTLINE); ray.setFromCamera(this.pointerNdc, this.camera);
    const roots = [...this.records.values()].filter((record) => !record.base).map((record) => record.root);
    const meshes = [...new Set(this.baseEntries.map((entry) => entry.mesh))];
    const terrainDistance = this._terrainHits()[0]?.distance ?? Infinity;
    for (const hit of ray.intersectObjects([...roots, ...meshes], true)) {
      if (hit.distance > terrainDistance + .15) break;
      const base = this.baseLayer.resolveHit(hit);
      if (base) return { id: base.id };
      let object = hit.object;
      while (object && !object.userData.gmDecorationId) object = object.parent;
      if (object) return { id: object.userData.gmDecorationId };
    }
    return null;
  }

  _placeAt(point) {
    const entry = this.pendingEntry; if (!entry || !this.ghost?.visible) return;
    point = this._placementPoint(point);
    const decoration = createDecoration({ id: uid(), assetId: entry.id, position: {
      x: clamp(point.x, -280, 280), y: clamp(this.map.groundAt(point.x, point.z), -64, 100), z: clamp(point.z, -280, 280),
    }, collider: 'none' });
    this._commit(addDecoration(this.history.current(), decoration)); this.select(decoration.id);
    this._setStatus(this._t('Added to draft only. No gameplay collision.', 'Añadido solo al borrador. Sin colisión de gameplay.'), 'ok');
  }

  select(id) {
    if (this.walkPreview?.active) return;
    this.selectedId = id && this.records.has(id) ? id : null;
    if (this.selectedId && !this.records.get(this.selectedId).hidden) this.transform.attach(this.records.get(this.selectedId).root); else this.transform.detach();
    this._renderInspector(); this._renderSceneList(); this._updateButtons(); this.invalidate();
  }

  _selectedItem() {
    if (!this.selectedId || !this.history) return null;
    const doc = this.history.current(), base = this.baseLayer.get(this.selectedId);
    if (base) {
      const override = doc.baseOverrides.find((item) => item.id === base.id);
      return { id: base.id, assetId: base.id, transform: override?.transform || base.transform,
        collider: base.collider, hidden: !!override?.hidden, base: true };
    }
    return doc.objects.find((obj) => obj.id === this.selectedId) || null;
  }

  _selectedTransform() {
    const root = this.selectedId && this.records.get(this.selectedId)?.root;
    return root ? this._transformFromRoot(root) : null;
  }

  _transformFromRoot(root) {
    return { position: { x: root.position.x, y: root.position.y, z: root.position.z },
      rotation: { x: root.rotation.x, y: root.rotation.y, z: root.rotation.z }, scale: root.scale.x };
  }

  _onObjectChange() {
    if (!this.selectedId) return;
    const root = this.records.get(this.selectedId)?.root; if (!root) return;
    root.position.x = clamp(root.position.x, -280, 280); root.position.y = clamp(root.position.y, -64, 100); root.position.z = clamp(root.position.z, -280, 280);
    const limit = Math.PI * 200;
    root.rotation.x = clamp(root.rotation.x, -limit, limit); root.rotation.y = clamp(root.rotation.y, -limit, limit); root.rotation.z = clamp(root.rotation.z, -limit, limit);
    root.scale.setScalar(clamp((root.scale.x + root.scale.y + root.scale.z) / 3, 0.001, 1000));
    if (this.records.get(this.selectedId).base) this.baseLayer.setTransform(this.selectedId, this._transformFromRoot(root));
    root.updateMatrixWorld(true); this.invalidate(); this._renderInspector();
  }

  _finishTransform() {
    if (!this.dragStart || !this.selectedId) { this.dragStart = null; return; }
    const before = JSON.stringify(this.dragStart), next = this._selectedTransform(); this.dragStart = null;
    if (before !== JSON.stringify(next)) this._setSelectedTransform(next);
  }

  _cancelTransform() {
    if (this.dragStart && this.selectedId) {
      const root = this.records.get(this.selectedId)?.root;
      if (root) this._applyTransform(root, this.dragStart);
      if (this.records.get(this.selectedId)?.base) this.baseLayer.setTransform(this.selectedId, this.dragStart);
    }
    this.dragStart = null; this.dragging = false; this.transform.dragging = false;
    this.transform.detach();
    if (this.selectedId && this.records.has(this.selectedId) && !this.records.get(this.selectedId).hidden) this.transform.attach(this.records.get(this.selectedId).root);
    this._renderInspector(); this.invalidate();
  }

  _setSelectedTransform(transform) {
    if (!this.selectedId) return;
    try {
      const item = this._selectedItem();
      this._commit(item?.base ? setBaseOverride(this.history.current(), { id: item.id, transform, hidden: item.hidden }) :
        updateDecoration(this.history.current(), this.selectedId, { transform }));
    }
    catch (error) {
      this._setStatus(this._t('Invalid transform: ' + (error.code || error.message), 'Transformación inválida: ' + (error.code || error.message)), 'error');
      this._renderDocument(this.history.current());
    }
  }

  _renderInspector() {
    if (!this.selectionName || !this.fields) return;
    const item = this._selectedItem();
    const record = item && this.records.get(item.id);
    const label = record?.entry?.label;
    const localized = typeof label === 'string' ? label : label?.[this.lang] || label?.es || label?.en || item?.assetId;
    this.selectionName.textContent = item ? (localized + ' · ' + item.id) : this._t('Nothing selected', 'Nada seleccionado');
    const t = this.dragStart ? this._selectedTransform() : item?.transform;
    const values = t ? { x: t.position.x, y: t.position.y, z: t.position.z,
      rx: t.rotation.x * 180 / Math.PI, ry: t.rotation.y * 180 / Math.PI, rz: t.rotation.z * 180 / Math.PI, scale: t.scale } : {};
    for (const [key, input] of Object.entries(this.fields)) {
      input.disabled = !item || item.hidden || this.walkPreview?.active; input.value = Number.isFinite(values[key]) ? Number(values[key]).toFixed(key[0] === 'r' ? 1 : 2) : '';
    }
    this.colliderSelect.disabled = !item || item.base || this.walkPreview?.active;
    this.colliderSelect.value = item?.collider === 'none' || !item ? 'none' : 'circle';
    this.colliderRadius.disabled = !item || item.base || item.collider === 'none' || this.walkPreview?.active;
    this.colliderRadius.value = item && item.collider !== 'none' ? item.collider.radius : '';
    this.ui.querySelector('[data-action="restore-base"]').hidden = !item?.base;
    this.ui.querySelector('[data-action="restore-base"]').disabled = !item?.base || !this.history.current().baseOverrides.some((entry) => entry.id === item.id);
    this.ui.querySelector('[data-action="delete"]').textContent = item?.base ? this._t('Hide', 'Ocultar') : this._t('Delete', 'Eliminar');
    this._updateFootprint();
  }

  _inspectorChange(event) {
    if (this.importTask || this.walkPreview?.active) return;
    const setting = event.target?.dataset?.setting;
    if (setting) {
      if (setting === 'collider' || setting === 'radius') {
        const item = this._selectedItem(); if (!item || item.base) return;
        const collider = this.colliderSelect.value === 'circle' ? { type: 'circle', radius: clamp(number(this.colliderRadius.value) || this._suggestColliderRadius(item), .05, 50) } : 'none';
        this._commit(updateDecoration(this.history.current(), item.id, { collider })); return;
      }
      if (setting === 'snap') this.snapEnabled = event.target.checked;
      if (setting === 'snapStep') this.snapStep = clamp(number(event.target.value) || .5, .05, 10);
      if (setting === 'space') this.transform.setSpace(event.target.value === 'local' ? 'local' : 'world');
      this._configureSnap(); return;
    }
    const field = event.target?.dataset?.field; if (!field || !this.selectedId) return;
    const t = this._selectedTransform(), value = number(event.target.value);
    if (['x', 'y', 'z'].includes(field)) t.position[field] = value;
    else if (field[0] === 'r') t.rotation[field[1].toLowerCase()] = value * Math.PI / 180;
    else if (field === 'scale') t.scale = value;
    const root = this.records.get(this.selectedId)?.root; if (root) this._applyTransform(root, t);
    this._setSelectedTransform(t); this._renderInspector();
  }

  _commit(document) {
    this.history.commit(document); this.document = this.history.current();
    this.dirty = JSON.stringify(this.document) !== this.lastSavedJson;
    this._renderDocument(this.document); this.onChanged({ document: clone(this.document), dirty: this.dirty });
    this._updateButtons(); this._scheduleSave();
  }

  _scheduleSave() {
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveNow(), 900);
    this._setStatus(this._t('Draft changed · autosaving locally…', 'Borrador modificado · guardando localmente…'), 'saving');
  }

  async saveNow() {
    if (!this.history || !this.dirty) return true;
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    if (this.saveTask) { this.saveAgain = true; await this.saveTask; return !this.dirty; }
    this.saveTask = (async () => {
      do {
        this.saveAgain = false; const snapshot = this.history.current();
        try {
          const saved = await this.store.save(snapshot, { expectedRevision: this.revision });
          this.revision = saved.revision; this.lastSavedJson = JSON.stringify(saved.document);
          this.dirty = JSON.stringify(this.history.current()) !== this.lastSavedJson;
          if (!this.dirty) { this.resumeDocument = null; await this._clearRecovery(); }
          this._setStatus(this._t('Draft saved locally. Not published.', 'Borrador guardado localmente. Sin publicar.'), 'ok');
        } catch (error) {
          this.dirty = true; this.saveAgain = false;
          this._setStatus(this._t('Local save failed: ' + (error.code || error.message) + '. Export to keep this draft.',
            'Falló el guardado local: ' + (error.code || error.message) + '. Expórtalo para conservarlo.'), 'error');
        }
      } while (this.saveAgain && this.dirty);
      this._updateButtons();
    })();
    await this.saveTask; this.saveTask = null; return !this.dirty;
  }

  _setStatus(message, kind = '') { this.statusNode.textContent = message; this.statusNode.dataset.kind = kind; }

  _setSceneTab(sceneTab) {
    this.sceneTab = sceneTab; this.catalogRoot.hidden = sceneTab; this.scenePanel.hidden = !sceneTab;
    this.ui.querySelector('[data-action="tab-scene"]').classList.toggle('is-active', sceneTab);
    this.ui.querySelector('[data-action="tab-library"]').classList.toggle('is-active', !sceneTab);
    this._renderSceneList();
  }

  _renderSceneList() {
    if (!this.sceneList || !this.history) return;
    const doc = this.history.current();
    const items = [ ...doc.objects.map((item) => ({ ...item, label: this._entryForAsset(item.assetId)?.label || item.assetId })),
      ...this.baseEntries.map((entry) => {
        const override = doc.baseOverrides.find((item) => item.id === entry.id);
        return { ...entry, transform: override?.transform || entry.transform, hidden: !!override?.hidden, changed: !!override, base: true };
      }) ];
    const labelFor = (item) => typeof item.label === 'string' ? item.label : item.label?.[this.lang] || item.label?.es || item.id;
    const query = this.sceneSearch.value.trim().toLocaleLowerCase();
    const filtered = items.filter((item) => `${labelFor(item)} ${item.id} ${item.kind || ''} ${item.label?.en || ''} ${item.label?.es || ''}`.toLocaleLowerCase().includes(query));
    filtered.sort((a, b) => this.camera.position.distanceToSquared(a.transform.position) - this.camera.position.distanceToSquared(b.transform.position));
    this.sceneCount.textContent = this._t(`Nearest ${Math.min(120, filtered.length)} of ${filtered.length}`, `Más cercanos: ${Math.min(120, filtered.length)} de ${filtered.length}`);
    this.sceneList.innerHTML = filtered.slice(0, 120).map((item) => `<button type="button" data-scene-id="${html(item.id)}" class="gm-scene-item${item.id === this.selectedId ? ' is-active' : ''}"><b>${html(labelFor(item))}${item.base ? ' #' + item.index : ''}</b><small>${html(item.hidden ? this._t('Hidden · restore in inspector', 'Oculto · restaura en inspector') : item.base ? (item.changed ? this._t('Base · edited', 'Base · editado') : this._t('Base', 'Base')) : this._t('Draft', 'Borrador'))}</small></button>`).join('') || `<p class="gm-empty">${this._t('No matching decoration', 'No hay decoración coincidente')}</p>`;
  }

  _updateFootprint() {
    const item = this._selectedItem(), root = this.records.get(this.selectedId)?.root;
    const visible = this.active && !this.walkPreview?.active && item && !item.hidden && item.collider !== 'none' && root;
    this.footprint.visible = !!visible;
    if (!visible) return;
    this.footprint.position.set(root.position.x, this.map.groundAt(root.position.x, root.position.z) + .08, root.position.z);
    this.footprint.scale.setScalar(item.collider.radius * root.scale.x);
    this.footprint.updateMatrixWorld(true);
  }

  _suggestColliderRadius(item) {
    const root = this.records.get(item.id)?.root; if (!root) return 1;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return 1;
    const dx = Math.max(Math.abs(box.min.x - root.position.x), Math.abs(box.max.x - root.position.x));
    const dz = Math.max(Math.abs(box.min.z - root.position.z), Math.abs(box.max.z - root.position.z));
    return Math.ceil(Math.hypot(dx, dz) / root.scale.x * 10) / 10;
  }

  _startWalking() {
    if (!this.active || !this.walkPreview || this.importTask) return;
    this._cancelTransform(); this._clearGhost();
    const doc = this.history.current(), colliders = this.baseLayer.colliders(doc.baseOverrides);
    for (const item of doc.objects) if (item.collider !== 'none') colliders.push({
      x: item.transform.position.x, z: item.transform.position.z, r: item.collider.radius * item.transform.scale,
    });
    let point = this.records.get(this.selectedId)?.root.position || this._terrainHits()[0]?.point || this.map.landmarks.village;
    const selected = this._selectedItem();
    if (selected && !selected.hidden && selected.collider !== 'none') {
      const direction = new THREE.Vector3(this.camera.position.x - point.x, 0, this.camera.position.z - point.z);
      if (direction.lengthSq() < .001) direction.set(0, 0, 1);
      direction.normalize().multiplyScalar(selected.collider.radius * selected.transform.scale + 1.5);
      point = { x: point.x + direction.x, z: point.z + direction.z };
    }
    this.cameraController.disable(); this.transform.detach(); this.footprint.visible = false;
    try {
      this.walkPreview.start({ colliders, point });
      this.canvas.focus({ preventScroll: true });
      this._setLanguage(); this._updateButtons();
    } catch (error) {
      this.cameraController.enable(); this.select(this.selectedId);
      this._setStatus(this._t('No walkable spot nearby. Select a clear area or reduce the proxy.',
        'No hay espacio caminable cerca. Elige una zona libre o reduce el proxy.'), 'error');
    }
    this.invalidate();
  }

  _stopWalking() {
    if (!this.walkPreview?.active) return;
    try { this.walkPreview.stop(); }
    finally {
      if (this.active) this.cameraController.enable();
      this._setLanguage(); this._updateButtons();
      this.select(this.selectedId); this.invalidate();
    }
  }

  async _clearRecovery() {
    if (this.recoveryRevision === null) return;
    try {
      await this.store.clearRecovery({ expectedRevision: this.recoveryRevision });
      this.recoveryRevision = null;
    } catch { /* Never clear a newer recovery from another tab. */ }
  }

  _updateButtons() {
    if (!this.ui) return;
    for (const button of this.ui.querySelectorAll('[data-action]')) button.disabled = false;
    this.ui.querySelector('[data-action="undo"]').disabled = !this.history?.canUndo();
    this.ui.querySelector('[data-action="redo"]').disabled = !this.history?.canRedo();
    const selected = this._selectedItem();
    this.ui.querySelector('[data-action="duplicate"]').disabled = !selected || selected.hidden;
    this.ui.querySelector('[data-action="delete"]').disabled = !selected || selected.hidden;
    this.ui.querySelector('[data-action="restore-base"]').disabled = !selected?.base || !this.history.current().baseOverrides.some((entry) => entry.id === selected.id);
    for (const action of ['ground', 'mode-translate', 'mode-rotate', 'mode-scale']) this.ui.querySelector(`[data-action="${action}"]`).disabled = !selected || selected.hidden;
    this.ui.querySelector('[data-action="place"]').classList.toggle('is-active', !!this.pendingEntry);
    const walking = !!this.walkPreview?.active;
    this.ui.classList.toggle('is-walking', walking);
    this.ui.querySelector('[data-action="walk"]').disabled = !this.walkPreview;
    this.ui.querySelector('[data-action="walk"]').textContent = walking ? this._t('Back to editor', 'Volver al editor') : this._t('Walk test', 'Probar caminando');
    for (const button of this.ui.querySelectorAll('[data-action]')) {
      if (walking && !['walk', 'close'].includes(button.dataset.action)) button.disabled = true;
    }
    this.importInput.disabled = walking;
  }

  _toolbarAction(event) {
    const sceneId = event.target.closest('[data-scene-id]')?.dataset.sceneId;
    if (sceneId && !this.walkPreview?.active && !this.importTask) { this._clearGhost(); this.select(sceneId); this._focusSelection(); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (this.walkPreview?.active && !['walk', 'close'].includes(action)) return;
    if (this.importTask && !['close', 'export'].includes(action)) return;
    switch (action) {
      case 'place': if (this.pendingEntry) this._clearGhost(); else this._setStatus(this._t('Choose a model from the library.', 'Elige un modelo de la biblioteca.'), 'info'); break;
      case 'undo': this._restoreHistory('undo'); break;
      case 'redo': this._restoreHistory('redo'); break;
      case 'duplicate': this._duplicate(); break;
      case 'delete': this._deleteSelected(); break;
      case 'restore-base': {
        if (this.history.current().baseOverrides.some((item) => item.id === this.selectedId)) {
          this._commit(removeBaseOverride(this.history.current(), this.selectedId)); this.select(this.selectedId);
        }
        break;
      }
      case 'walk': if (this.walkPreview?.active) this._stopWalking(); else this._startWalking(); break;
      case 'tab-library': this._setSceneTab(false); break;
      case 'tab-scene': this._setSceneTab(true); break;
      case 'save': this.saveNow(); break;
      case 'export': this._exportCurrent(); break;
      case 'close': this.close(); break;
      case 'mode-translate': this.transform.setMode('translate'); break;
      case 'mode-rotate': this.transform.setMode('rotate'); break;
      case 'mode-scale': this.transform.setMode('scale'); break;
      case 'ground': {
        const transform = this._selectedTransform();
        if (transform) { transform.position.y = this.map.groundAt(transform.position.x, transform.position.z); this._setSelectedTransform(transform); }
        break;
      }
      default: return;
    }
    this._updateButtons();
  }

  _restoreHistory(kind) {
    if (!this.history) return;
    const doc = this.history[kind](); this.document = doc; this.dirty = JSON.stringify(doc) !== this.lastSavedJson;
    this._renderDocument(doc); this.onChanged({ document: clone(doc), dirty: this.dirty }); this._scheduleSave();
  }

  _duplicate() {
    const item = this._selectedItem(); if (!item || item.hidden) return;
    const copy = createDecoration({ id: uid(), assetId: item.assetId, position: item.transform.position,
      rotation: item.transform.rotation, scale: item.transform.scale, collider: item.collider });
    copy.transform.position.x = clamp(copy.transform.position.x + 2, -280, 280);
    copy.transform.position.z = clamp(copy.transform.position.z + 2, -280, 280);
    this._commit(addDecoration(this.history.current(), copy)); this.select(copy.id);
  }

  _deleteSelected() {
    if (!this.selectedId) return;
    const item = this._selectedItem(); if (!item) return;
    if (item.base) { this._commit(setBaseOverride(this.history.current(), { id: item.id, transform: item.transform, hidden: true })); this.select(item.id); }
    else { this._commit(removeDecoration(this.history.current(), item.id)); this.select(null); }
  }

  _keyDown(event) {
    if (!this.active || event.repeat) return;
    if (this.walkPreview?.active) {
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this._stopWalking(); }
      return;
    }
    if (typing(event.target)) return;
    if (this.importTask && event.code !== 'Escape') return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.dragging && this.dragStart && this.selectedId) {
        this._cancelTransform();
      } else if (this.ghost) this._clearGhost(); else this.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
      event.preventDefault(); event.stopImmediatePropagation(); this._restoreHistory(event.shiftKey ? 'redo' : 'undo'); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
      event.preventDefault(); event.stopImmediatePropagation(); this._restoreHistory('redo'); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
      event.preventDefault(); event.stopImmediatePropagation(); this._duplicate(); return;
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      event.preventDefault(); event.stopImmediatePropagation(); this._deleteSelected(); return;
    }
    if (event.code === 'Digit1') this.transform.setMode('translate');
    else if (event.code === 'Digit2') this.transform.setMode('rotate');
    else if (event.code === 'Digit3') this.transform.setMode('scale');
    else if (event.code === 'KeyF') this._focusSelection();
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
  }

  _focusSelection() {
    const record = this.selectedId && this.records.get(this.selectedId);
    if (!record) { if (this.map.landmarks?.village) this.cameraController.focus(this.map.landmarks.village); return; }
    let sphere;
    if (record.base) {
      const entry = record.entry, matrix = new THREE.Matrix4();
      entry.mesh.getMatrixAt(entry.instanceIndex, matrix); entry.mesh.updateWorldMatrix(true, false);
      entry.mesh.geometry.computeBoundingSphere();
      sphere = entry.mesh.geometry.boundingSphere.clone().applyMatrix4(entry.mesh.matrixWorld.clone().multiply(matrix));
    } else {
      record.root.updateMatrixWorld(true);
      sphere = new THREE.Box3().setFromObject(record.root).getBoundingSphere(new THREE.Sphere());
    }
    if (record.hidden || !Number.isFinite(sphere.radius) || sphere.radius < .01) sphere = new THREE.Sphere(record.root.position.clone(), 1);
    const offset = this.camera.position.clone().sub(sphere.center);
    if (offset.lengthSq() < .01) offset.set(1, 1, 1);
    offset.y = Math.max(Math.abs(offset.y), Math.hypot(offset.x, offset.z) * .6);
    this.camera.position.copy(sphere.center).add(offset.normalize().multiplyScalar(clamp(sphere.radius * 3.5, 6, 500)));
    this.cameraController.focus(sphere.center); this.invalidate();
  }

  _configureSnap() {
    this.transform.setTranslationSnap(this.snapEnabled ? this.snapStep : null);
    this.transform.setRotationSnap(this.snapEnabled ? Math.PI / 12 : null);
    this.transform.setScaleSnap(this.snapEnabled ? .1 : null);
  }

  _placementPoint(point) {
    const snap = (value) => clamp(this.snapEnabled ? Math.round(value / this.snapStep) * this.snapStep : value, -280, 280);
    const x = snap(point.x), z = snap(point.z);
    return new THREE.Vector3(x, clamp(this.map.groundAt(x, z), -64, 100), z);
  }

  exportRecovery() { this._exportDocument(this.rejectedDocument); }

  _exportCurrent() { this._exportDocument(this.history?.current()); }

  _exportDocument(doc) {
    if (!doc) return;
    const text = JSON.stringify({ format: DRAFT_EXPORT_FORMAT, version: DRAFT_EXPORT_VERSION, document: doc }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = this.worldId + '-draft.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    this._setStatus(this._t('Current in-memory draft exported.', 'Se exportó el borrador actual.'), 'ok');
  }

  async _importFile(file) {
    if (!file || !this.store || !this.active || this.importTask || this.walkPreview?.active) return;
    const session = this.session;
    this.importTask = this._importFileForSession(file, session);
    try { await this.importTask; }
    finally { this.importTask = null; }
  }

  async _importFileForSession(file, session) {
    try {
      if (file.size > MAX_DRAFT_EXPORT_BYTES) throw new Error(this._t('Import file exceeds the 5 MB limit.', 'El archivo supera el límite de 5 MB.'));
      const serialized = await file.text();
      if (!this.active || session !== this.session) return;
      if (new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_EXPORT_BYTES) throw new Error(this._t('Import file exceeds the 5 MB limit.', 'El archivo supera el límite de 5 MB.'));
      const envelope = JSON.parse(serialized);
      if (!envelope || envelope.format !== DRAFT_EXPORT_FORMAT || envelope.version !== DRAFT_EXPORT_VERSION) {
        throw new Error(this._t('Unsupported draft export format.', 'Formato de exportación no compatible.'));
      }
      const checked = validateDocument(envelope.document);
      this._validateBaseReferences(checked);
      if (checked.base.seed !== (this.map.seed >>> 0) || checked.base.revision !== this.baseRevision) {
        throw new Error(this._t('Import belongs to a different base map.', 'La importación pertenece a otra base del mapa.'));
      }
      if (!this.active || session !== this.session) return;
      const saved = await this.store.import(serialized, { expectedRevision: this.revision });
      if (!this.active || session !== this.session) return;
      this.revision = saved.revision; this.lastSavedJson = JSON.stringify(saved.document); this.resumeDocument = null;
      await this._clearRecovery();
      this.history = createDocumentHistory(saved.document); this.document = saved.document; this.dirty = false;
      await this._hydrate(saved.document); this._renderDocument(saved.document);
      this.onChanged({ document: clone(saved.document), dirty: false });
      this._setStatus(this._t('Draft imported and saved locally.', 'Borrador importado y guardado localmente.'), 'ok');
    } catch (error) {
      this._setStatus(this._t('Import failed: ' + (error.code || error.message), 'Falló la importación: ' + (error.code || error.message)), 'error');
    } finally { this.importInput.value = ''; }
  }

  update(dt) {
    if (!this.active) return;
    if (this.walkPreview?.active) {
      try { this.walkPreview.update(dt); }
      catch (error) { this._stopWalking(); this._setStatus(this._t('Walk test stopped: ', 'Prueba detenida: ') + error.message, 'error'); }
      return;
    }
    this.cameraController.update(dt);
    if (this.ghost) this._updateGhost();
    this.transform.camera = this.camera; this.transformHelper.updateMatrixWorld(true);
  }

  async dispose() {
    if (this.active) await this.close({ force: true });
    clearTimeout(this.saveTimer); this.cameraController.dispose();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.ui.removeEventListener('click', this.onClick); this.ui.removeEventListener('change', this.onChange);
    this.langButton.removeEventListener('click', this.onLang); window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('blur', this.onBlur); this.catalog.dispose(); this.transform.detach(); this.transform.dispose();
    this.editorModels.dispose();
    this.walkPreview?.dispose(); this.baseLayer.restore();
    this.sceneSearch.removeEventListener('input', this.onSceneSearch);
    this.scene.remove(this.footprint); this.footprint.geometry.dispose(); this.footprint.material.dispose();
    this.importInput.removeEventListener('change', this.onImport);
    this._clearGhost();
    this._clearRecords(); this.ui.remove();
  }
}

export const createWorldEditor = (options) => new WorldEditor(options);
